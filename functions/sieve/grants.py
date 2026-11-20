"""Grants: issue, narrow, revoke (30 section 7). Wrapped by callables.py."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from ratchet_core import (
    Broker,
    RatchetMalformedToken,
    RatchetNotNarrowing,
    attenuate,
    deserialize_token,
    expires_at_caveat,
    extract_expires_at,
    serialize_token,
    tool_name_caveat,
)

from . import config, fb, logs
from .authz import grant_caveats, resource_uri, tool_pattern
from .errors import InputError, LimitReached, NotFound, Precondition
from .links import build_link, derive_connector_identity, link_hash, link_hint, new_link_secret
from .models import GrantMeta
from .ratchet_fs import ConnectorRevocationStore, append_lifecycle

NARROW_ONLY = "A connection can only be narrowed. To give more access, make a new connection."
CANCELLED_MESSAGE = "The person changed this connection, so this request was cancelled."
OPEN_AND_ANSWERED = ["queued", "claimed", "awaiting-person", "answered"]


@dataclass(frozen=True)
class GrantRequest:
    ai_name: str
    max_step: str
    allowed_categories: tuple[str, ...]
    allowed_sources: tuple[str, ...]
    days: int


@dataclass(frozen=True)
class NarrowRequest:
    grant_id: str
    max_step: str | None
    allowed_categories: tuple[str, ...] | None
    allowed_sources: tuple[str, ...] | None
    days: int | None


# ---------- input parsing ----------

def _has_control(s: str, categories: tuple[str, ...] = ("Cc", "Cf")) -> bool:
    return any(unicodedata.category(ch) in categories for ch in s)


def _ai_name(value: Any) -> str:
    if not isinstance(value, str):
        raise InputError("The AI's name must be 1 to 40 characters of plain text.")
    name = re.sub(r"\s+", " ", value.strip())
    if not 1 <= config.utf16_len(name) <= config.AI_NAME_MAX_CHARS or _has_control(name):
        raise InputError("The AI's name must be 1 to 40 characters of plain text.")
    return name


def _step(value: Any) -> str:
    if not isinstance(value, str) or value not in config.LADDER_STEPS:
        raise InputError("maxStep must be one of: answer, excerpt, full.")
    return value


def _unique_list(value: Any, allowed: tuple[str, ...], max_len: int, message: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not 1 <= len(value) <= max_len:
        raise InputError(message)
    if any(not isinstance(v, str) or v not in allowed for v in value) or len(set(value)) != len(value):
        raise InputError(message)
    return tuple(value)


def _categories(value: Any) -> tuple[str, ...]:
    return _unique_list(value, config.CATEGORIES, len(config.CATEGORIES),
                        "allowedCategories must list 1 to 9 different categories from the fixed set.")


def _sources(value: Any) -> tuple[str, ...]:
    return _unique_list(value, config.REAL_SOURCES, len(config.REAL_SOURCES),
                        "allowedSources must list 1 to 3 different sources: gmail, folder, upload.")


def _days(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= config.GRANT_MAX_DAYS:
        raise InputError("days must be a whole number from 1 to 90.")
    return value


def _object(data: Any) -> Mapping[str, Any]:
    if not isinstance(data, Mapping):
        raise InputError("Send the connection details as an object.")
    return data


def parse_issue_request(data: Any) -> GrantRequest:
    d = _object(data)
    days = d.get("days")
    return GrantRequest(ai_name=_ai_name(d.get("aiName")), max_step=_step(d.get("maxStep")),
                        allowed_categories=_categories(d.get("allowedCategories")),
                        allowed_sources=_sources(d.get("allowedSources")),
                        days=config.GRANT_DEFAULT_DAYS if days is None else _days(days))


def parse_playground_request(data: Any) -> GrantRequest:
    """issuePlaygroundGrant (00 D1, 30 section 16): one day, Playground sample data only."""
    d = _object(data if data is not None else {})
    name = d.get("aiName")
    cats = d.get("allowedCategories")
    step = d.get("maxStep")
    return GrantRequest(ai_name=config.PLAYGROUND_AI_NAME if name is None else _ai_name(name),
                        max_step="full" if step is None else _step(step),
                        allowed_categories=config.CATEGORIES if cats is None else _categories(cats),
                        allowed_sources=config.PLAYGROUND_SOURCES, days=config.PLAYGROUND_GRANT_DAYS)


def _grant_id(value: Any) -> str:
    if not isinstance(value, str) or not config.GRANT_ID_RE.fullmatch(value):
        raise InputError("grantId must be the id of one of your connections.")
    return value


def parse_narrow_request(data: Any) -> NarrowRequest:
    d = _object(data)
    grant_id = _grant_id(d.get("grantId"))
    step = None if d.get("maxStep") is None else _step(d.get("maxStep"))
    cats = None if d.get("allowedCategories") is None else _categories(d.get("allowedCategories"))
    srcs = None
    if d.get("allowedSources") is not None:
        srcs = _unique_list(d.get("allowedSources"), config.REAL_SOURCES + config.PLAYGROUND_SOURCES, 4,
                            "allowedSources must list 1 to 3 different sources: gmail, folder, upload.")
    days = None if d.get("days") is None else _days(d.get("days"))
    if step is None and cats is None and srcs is None and days is None:
        raise InputError("Say what to narrow: maxStep, allowedCategories, allowedSources or days.")
    return NarrowRequest(grant_id=grant_id, max_step=step, allowed_categories=cats, allowed_sources=srcs, days=days)


def parse_grant_id(data: Any) -> str:
    return _grant_id(_object(data).get("grantId"))


# ---------- issue ----------

def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def count_active_grants(db: Any, uid: str, now: datetime) -> int:
    snaps = db.collection(f"users/{uid}/grants").where(filter=FieldFilter("expiresAt", ">", now)).stream()
    return sum(1 for s in snaps if not (s.to_dict() or {}).get("revokedAt"))


def create_grant_records(db: Any, *, uid: str, req: GrantRequest, secret: bytes, base_url: str, now: datetime,
                         ttl_seconds: float) -> dict[str, Any]:
    if count_active_grants(db, uid, now) >= config.MAX_ACTIVE_GRANTS:
        raise LimitReached("You already have 10 connected AIs. Remove one first.")
    grant_ref = db.collection(f"users/{uid}/grants").document()
    grant_id = grant_ref.id
    secret_link = new_link_secret()
    lh = link_hash(secret_link)
    identity = derive_connector_identity(secret_link, grant_id)
    token = Broker(secret=secret).issue(human_identity=uid, primary_identity=identity,
                                        caveats=grant_caveats(uid, grant_id, req.max_step), ttl_seconds=ttl_seconds)
    expires_at = datetime.fromtimestamp(extract_expires_at(token.caveats), timezone.utc)
    batch = db.batch()
    batch.create(db.collection("connectors").document(lh), {
        "uid": uid, "grantId": grant_id, "token": serialize_token(token),
        "identity": {"agentId": identity.agent_id, "fingerprint": identity.fingerprint},
        "createdAt": now, "expiresAt": expires_at, "revokedRootIds": [], "revokedTokenIds": [], "rateCount": 0,
    })
    batch.set(grant_ref, {
        "aiName": req.ai_name, "maxStep": req.max_step, "allowedCategories": list(req.allowed_categories),
        "allowedSources": list(req.allowed_sources), "createdAt": now, "expiresAt": expires_at,
        "linkHint": link_hint(secret_link),
    })
    batch.commit()
    append_lifecycle(db, uid, event="issued", agent_id=identity.agent_id, fingerprint=identity.fingerprint,
                     token_id=token.token_id, resource=resource_uri(uid, grant_id),
                     args={"maxStep": req.max_step, "days": req.days,
                           "allowedCategories": list(req.allowed_categories),
                           "allowedSources": list(req.allowed_sources)})
    logs.log_event("grant_issued", grant=grant_id, user=logs.user_ref(uid), step=req.max_step, days=req.days)
    return {"grantId": grant_id, "link": build_link(base_url, secret_link), "linkHint": link_hint(secret_link),
            "maxStep": req.max_step, "allowedCategories": list(req.allowed_categories),
            "allowedSources": list(req.allowed_sources), "expiresAt": _ms(expires_at)}


def issue_grant(db: Any, *, uid: str, req: GrantRequest, secret: bytes, base_url: str, now: datetime) -> dict[str, Any]:
    return create_grant_records(db, uid=uid, req=req, secret=secret, base_url=base_url, now=now,
                                ttl_seconds=req.days * 86400)


# ---------- narrow ----------

def find_connector(db: Any, *, uid: str, grant_id: str) -> tuple[Any, dict[str, Any]] | None:
    snaps = list(db.collection("connectors").where(filter=FieldFilter("grantId", "==", grant_id)).limit(2).stream())
    mine = [s for s in snaps if (s.to_dict() or {}).get("uid") == uid]
    if len(snaps) != 1 or len(mine) != 1:
        return None
    return mine[0].reference, mine[0].to_dict()


def _narrow_txn(txn: Any, grant_ref: Any, connector_ref: Any, req: NarrowRequest, secret: bytes,
                now: datetime) -> tuple[GrantMeta, str]:
    grant_snap = grant_ref.get(transaction=txn)
    conn_snap = connector_ref.get(transaction=txn)
    if not grant_snap.exists or not conn_snap.exists:
        raise NotFound("That connection does not exist.")
    grant = grant_snap.to_dict()
    conn = conn_snap.to_dict()
    if grant.get("revokedAt") or conn.get("revokedAt"):
        raise Precondition("That connection is already turned off.")
    expires = grant["expiresAt"]
    if expires <= now:
        raise Precondition("That connection has expired.")

    step = req.max_step or grant["maxStep"]
    cats = list(req.allowed_categories) if req.allowed_categories is not None else list(grant["allowedCategories"])
    srcs = list(req.allowed_sources) if req.allowed_sources is not None else list(grant["allowedSources"])
    new_expiry = expires
    if config.STEP_RANK[step] > config.STEP_RANK[grant["maxStep"]]:
        raise InputError(NARROW_ONLY)
    if not cats or not set(cats) <= set(grant["allowedCategories"]):
        raise InputError(NARROW_ONLY)
    if not srcs or not set(srcs) <= set(grant["allowedSources"]):
        raise InputError(NARROW_ONLY)
    if req.days is not None:
        new_expiry = now + timedelta(days=req.days)
        if new_expiry >= expires:
            raise InputError(NARROW_ONLY)

    caveats = []
    if config.STEP_RANK[step] < config.STEP_RANK[grant["maxStep"]]:
        caveats.append(tool_name_caveat(tool_pattern(step)))
    if req.days is not None:
        caveats.append(expires_at_caveat(new_expiry.timestamp()))
    try:
        token = deserialize_token(conn["token"])
    except RatchetMalformedToken as exc:
        raise Precondition("That connection can no longer be changed. Make a new one.") from exc
    if caveats:
        try:
            token = attenuate(token, secret=secret, new_caveats=caveats)
        except RatchetNotNarrowing as exc:
            raise InputError(NARROW_ONLY) from exc
        txn.update(connector_ref, {"token": serialize_token(token), "expiresAt": new_expiry})
    txn.update(grant_ref, {"maxStep": step, "allowedCategories": cats, "allowedSources": srcs,
                           "expiresAt": new_expiry})
    meta = GrantMeta.model_validate({**grant, "maxStep": step, "allowedCategories": cats, "allowedSources": srcs,
                                     "expiresAt": new_expiry})
    return meta, token.token_id


def narrow_grant(db: Any, *, uid: str, req: NarrowRequest, secret: bytes, now: datetime) -> dict[str, Any]:
    found = find_connector(db, uid=uid, grant_id=req.grant_id)
    if found is None:
        raise NotFound("That connection does not exist.")
    connector_ref, conn = found
    grant_ref = db.collection(f"users/{uid}/grants").document(req.grant_id)
    meta, token_id = fb.transact(db, _narrow_txn, grant_ref, connector_ref, req, secret, now,
                                 lock_key=f"connectors/{connector_ref.id}")
    revoked, updated = apply_grant_change_to_requests(db, uid=uid, grant_id=req.grant_id, grant=meta,
                                                      revoke_all=False, now=now)
    identity = conn.get("identity") or {}
    append_lifecycle(db, uid, event="narrowed", agent_id=identity.get("agentId", f"grant-{req.grant_id}"),
                     fingerprint=identity.get("fingerprint", ""), token_id=token_id,
                     resource=resource_uri(uid, req.grant_id),
                     args={"maxStep": meta.max_step, "expiresAt": _ms(meta.expires_at),
                           "allowedCategories": list(meta.allowed_categories),
                           "allowedSources": list(meta.allowed_sources)})
    logs.log_event("grant_narrowed", grant=req.grant_id, user=logs.user_ref(uid), step=meta.max_step,
                   days=req.days)
    return {"grantId": req.grant_id, "maxStep": meta.max_step, "allowedCategories": list(meta.allowed_categories),
            "allowedSources": list(meta.allowed_sources), "expiresAt": _ms(meta.expires_at),
            "requestsRevoked": revoked, "requestsUpdated": updated}


def _change_txn(txn: Any, ref: Any, seen_status: str, grant: GrantMeta | None, revoke_all: bool) -> str:
    snap = ref.get(transaction=txn)
    if not snap.exists:
        return "skip"
    data = snap.to_dict() or {}
    status = data.get("status")
    if status != seen_status:
        return "skip"
    rank = config.STEP_RANK
    revoke = revoke_all or grant is None or rank.get(data.get("requestedStep"), 2) > rank[grant.max_step]
    if not revoke and status == "answered":
        step = (data.get("response") or {}).get("step")
        revoke = rank.get(step, 2) > rank[grant.max_step]
    if revoke:
        txn.update(ref, {"status": "revoked", "message": CANCELLED_MESSAGE, "response": firestore.DELETE_FIELD})
        return "revoked"
    txn.update(ref, {"maxStep": grant.max_step, "allowedCategories": list(grant.allowed_categories),
                     "allowedSources": list(grant.allowed_sources)})
    return "updated"


def apply_grant_change_to_requests(db: Any, *, uid: str, grant_id: str, grant: GrantMeta | None,
                                   revoke_all: bool, now: datetime) -> tuple[int, int]:
    from .relay import is_playground, mark_receipt   # relay imports nothing from here; avoids a cycle at import

    query = (db.collection(f"users/{uid}/requests")
             .where(filter=FieldFilter("requester.grantId", "==", grant_id))
             .where(filter=FieldFilter("status", "in", OPEN_AND_ANSWERED)))
    revoked = updated = 0
    for snap in query.stream():
        data = snap.to_dict() or {}
        outcome = fb.transact(db, _change_txn, snap.reference, data.get("status"), grant, revoke_all,
                              lock_key=snap.reference.path)
        if outcome == "revoked":
            revoked += 1
            if data.get("status") == "answered" and not is_playground(data):
                mark_receipt(db, uid, snap.id, "revoked")
        elif outcome == "updated":
            updated += 1
    return revoked, updated


# ---------- revoke ----------

def revoke_grant(db: Any, *, uid: str, grant_id: str, now: datetime) -> dict[str, Any]:
    found = find_connector(db, uid=uid, grant_id=grant_id)
    if found is None:
        raise NotFound("That connection does not exist.")
    connector_ref, conn = found
    grant_ref = db.collection(f"users/{uid}/grants").document(grant_id)
    grant_snap = grant_ref.get()
    grant = grant_snap.to_dict() if grant_snap.exists else {}
    already = grant.get("revokedAt") or conn.get("revokedAt")
    if already:
        return {"grantId": grant_id, "revokedAt": _ms(already), "requestsRevoked": 0}
    token_id = ""
    try:
        token = deserialize_token(conn["token"])
        token_id = token.token_id
        ConnectorRevocationStore(db, connector_ref.id, conn).revoke_root(token.root_id)   # security first
    except RatchetMalformedToken:
        pass   # a malformed token is denied on every call anyway
    batch = db.batch()
    batch.update(connector_ref, {"revokedAt": now})
    if grant_snap.exists:
        batch.update(grant_ref, {"revokedAt": now})
    batch.commit()
    revoked, _ = apply_grant_change_to_requests(db, uid=uid, grant_id=grant_id, grant=None, revoke_all=True, now=now)
    identity = conn.get("identity") or {}
    append_lifecycle(db, uid, event="revoked", agent_id=identity.get("agentId", f"grant-{grant_id}"),
                     fingerprint=identity.get("fingerprint", ""), token_id=token_id,
                     resource=resource_uri(uid, grant_id), args={})
    logs.log_event("grant_revoked", grant=grant_id, user=logs.user_ref(uid))
    return {"grantId": grant_id, "revokedAt": _ms(now), "requestsRevoked": revoked}
