"""Ratchet backed by Firestore: revocation store, serialized audit sink, chain verification (30 sections 6.3 to 6.6).

Audit layout (01 section 3): head audit/{uid} = {lastHash, seq}; entries audit/{uid}/entries/{seq:010d} with
Ratchet's canonical snake_case keys plus `seq`. The sink appends inside a transaction on the head and
re-chains the entry onto the head it reads, so parallel calls can never fork the chain.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from typing import Any, Iterable, Literal, Mapping

from google.cloud import firestore
from ratchet_core import GENESIS_HASH, AuditEntry, AuditSink, RevocationStore, build_entry

from . import fb, logs
from .links import identity_uri

CANONICAL_KEYS = ("timestamp", "delegation_chain", "tool_name", "args_digest", "resource", "decision",
                  "reason_code", "token_id")
_BODY_KEYS = frozenset(CANONICAL_KEYS)


# ---------- revocation ----------

class ConnectorRevocationStore(RevocationStore):
    """Revocation state lives inside connectors/{linkHash} (functions only), read with the admission
    transaction, so the per-call check costs no extra read."""

    def __init__(self, db: Any, link_hash: str, connector: Mapping[str, Any]) -> None:
        self._ref = db.collection("connectors").document(link_hash)
        self._roots = set(connector.get("revokedRootIds") or [])
        self._tokens = set(connector.get("revokedTokenIds") or [])

    def revoke_root(self, root_id: str) -> None:
        self._ref.update({"revokedRootIds": firestore.ArrayUnion([root_id])})
        self._roots.add(root_id)

    def revoke_token(self, token_id: str) -> None:
        """Not used by Sieve flows: narrowing replaces the stored token instead, because revoking the parent
        token id would also revoke its attenuated child."""
        self._ref.update({"revokedTokenIds": firestore.ArrayUnion([token_id])})
        self._tokens.add(token_id)

    def is_root_revoked(self, root_id: str) -> bool:
        return root_id in self._roots

    def is_any_token_revoked(self, chain: Iterable[str]) -> bool:
        return any(t in self._tokens for t in chain)


# ---------- hashing (identical to ratchet_core.audit) ----------

def canonical_json(obj: object) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def entry_hash(prev_hash: str, body: Mapping[str, Any]) -> str:
    """sha256(canonical_json({**body, "prev_hash": prev_hash})); body is the eight fields other than
    prev_hash and entry_hash."""
    return hashlib.sha256(canonical_json({**body, "prev_hash": prev_hash}).encode("utf-8")).hexdigest()


def _body(entry: AuditEntry) -> dict[str, Any]:
    d = entry.to_canonical_dict()
    return {k: d[k] for k in CANONICAL_KEYS}


def rechain(entry: AuditEntry, prev_hash: str) -> AuditEntry:
    """Same timestamp, chain, tool, digest, resource, decision, reason, token id; new prev_hash and entry_hash."""
    return replace(entry, prev_hash=prev_hash, entry_hash=entry_hash(prev_hash, _body(entry)))


# ---------- audit sink ----------

def _append_txn(txn: Any, head_ref: Any, entries_ref: Any, entry: AuditEntry) -> tuple[int, str]:
    snap = head_ref.get(transaction=txn)
    seq = int(snap.get("seq")) if snap.exists else 0
    prev = snap.get("lastHash") if snap.exists else GENESIS_HASH
    final = entry if entry.prev_hash == prev else rechain(entry, prev)
    txn.create(entries_ref.document(f"{seq + 1:010d}"), {**final.to_canonical_dict(), "seq": seq + 1})
    txn.set(head_ref, {"seq": seq + 1, "lastHash": final.entry_hash})
    return seq + 1, final.entry_hash


class FirestoreAuditSink(AuditSink):
    def __init__(self, db: Any, uid: str, *, max_attempts: int = 10) -> None:
        self._db = db
        self._uid = uid
        self.max_attempts = max_attempts
        self._head_ref = db.collection("audit").document(uid)
        self._entries_ref = self._head_ref.collection("entries")
        self.last_seq: int | None = None

    def last_hash(self) -> str:
        snap = self._head_ref.get()
        return snap.get("lastHash") if snap.exists else GENESIS_HASH

    def append(self, entry: AuditEntry) -> None:
        try:
            seq, _ = fb.transact(self._db, _append_txn, self._head_ref, self._entries_ref, entry,
                                 attempts=self.max_attempts, lock_key=f"audit/{self._uid}")
            self.last_seq = seq
        except Exception as exc:
            logs.log_exception("audit_append_failed", exc, user=logs.user_ref(self._uid))
            raise


def append_lifecycle(db: Any, uid: str, *, event: Literal["issued", "narrowed", "revoked"], agent_id: str,
                     fingerprint: str, token_id: str, resource: str, args: Mapping[str, Any]) -> None:
    """Grant issue, narrow and revoke go into the same chain. Failures are logged and swallowed,
    matching Ratchet's policy for authorization entries."""
    try:
        sink = FirestoreAuditSink(db, uid)
        sink.append(build_entry(prev_hash=sink.last_hash(), delegation_chain=(identity_uri(agent_id, fingerprint),),
                                tool_name=f"sieve.grant.{event}", args=dict(args), resource=resource,
                                decision="ALLOW", reason_code=f"GRANT_{event.upper()}", token_id=token_id))
    except Exception:  # noqa: BLE001 - already logged by the sink
        pass


# ---------- verification ----------

@dataclass(frozen=True)
class ChainStatus:
    intact: bool
    entries: int
    last_seq: int
    last_hash: str
    broken_at_seq: int | None
    truncated: bool


def verify_chain(db: Any, uid: str, *, max_entries: int = 20_000, page_size: int = 500) -> ChainStatus:
    head_ref = db.collection("audit").document(uid)
    entries_ref = head_ref.collection("entries")
    prev = GENESIS_HASH
    expected = 1
    count = 0
    last_seq = 0
    broken: int | None = None
    truncated = False
    cursor: int | None = None
    while broken is None:
        query = entries_ref.order_by("seq")
        if cursor is not None:
            query = query.start_after({"seq": cursor})
        page = list(query.limit(page_size).stream())
        if not page:
            break
        for snap in page:
            if count >= max_entries:
                truncated = True
                break
            data = snap.to_dict() or {}
            seq = data.get("seq")
            body = {k: v for k, v in data.items() if k not in ("prev_hash", "entry_hash", "seq")}
            ok = (snap.id == f"{expected:010d}" and seq == expected and data.get("prev_hash") == prev
                  and set(body) == _BODY_KEYS and entry_hash(prev, body) == data.get("entry_hash"))
            if not ok:
                broken = expected
                break
            prev = data["entry_hash"]
            last_seq = expected
            expected += 1
            count += 1
        if truncated or broken is not None or len(page) < page_size:
            break
        cursor = last_seq
    if broken is None and not truncated:
        head = head_ref.get()
        if head.exists:
            if head.get("seq") != last_seq or head.get("lastHash") != prev:
                broken = last_seq + 1 if head.get("seq") != last_seq else last_seq
        elif count:
            broken = last_seq + 1
    return ChainStatus(intact=broken is None, entries=count, last_seq=last_seq, last_hash=prev,
                       broken_at_seq=broken, truncated=truncated)
