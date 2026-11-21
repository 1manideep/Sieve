"""Request lifecycle: create, wait, collect, check, receipts (30 section 9; 70 R-MCP-06; 00 D6)."""
from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Literal, Mapping

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import ValidationError

from . import config, fb, logs, push, tools
from .models import GrantMeta, RelayPayload, ToolResult

WAIT_DONE = frozenset({"answered", "declined", "blocked", "no-match", "unsupported", "error", "expired", "revoked",
                       "collected", "offline"})
OPEN_STATUSES = ("queued", "claimed", "awaiting-person")
OPEN_AND_ANSWERED = ["queued", "claimed", "awaiting-person", "answered"]
# 30 section 9.4. Without a client key, only a request that is still waiting or holds an uncollected answer is
# reused, so asking again after a delivered or declined answer makes a new request. With a client key, any
# request is reused except one that ended without a decision by the person: then a retry asks again.
REUSED_WITHOUT_KEY = frozenset(OPEN_AND_ANSWERED)
NOT_REUSED = frozenset({"offline", "error", "expired", "revoked"})
MSG_DECISION_EXPIRED = "The person did not answer in time."
MSG_COLLECT_EXPIRED = "The answer was not collected in time."
MSG_UNDELIVERABLE = "Sieve could not deliver this answer."
MSG_REVOKED_AT_DELIVERY = "The person changed this connection, so this request was cancelled."


@dataclass(frozen=True)
class CallCtx:
    uid: str
    grant_id: str
    link_hash: str
    grant: GrantMeta

    @property
    def playground(self) -> bool:
        return list(self.grant.allowed_sources) == list(config.PLAYGROUND_SOURCES)


def is_playground(data: Mapping[str, Any]) -> bool:
    return list(data.get("allowedSources") or []) == list(config.PLAYGROUND_SOURCES)


def _requests(db: Any, uid: str) -> Any:
    return db.collection(f"users/{uid}/requests")


def home_base_online(presence: Mapping[str, Any] | None) -> bool:
    if not isinstance(presence, Mapping):
        return False
    return any(isinstance(v, Mapping) and v.get("state") == "online" and v.get("isHomeBase") is True
               for v in presence.values())


def question_key(question: str) -> str:
    return " ".join(question.split()).casefold()


def request_key(grant_id: str, tool: str, args: tools.LadderArgs) -> str:
    """The idempotency key stored on the request doc: sha256 hex, scoped to the grant and the tool.
    With the client's idempotency_key it is that key; without one it is derived from the question (whitespace
    and case folded, 70 R-MCP-06) and the hints. The client's raw key is never stored."""
    if args.idempotency_key is not None:
        material: list[Any] = ["key", grant_id, tool, args.idempotency_key]
    else:
        hints = args.hints.to_firestore() if args.hints is not None else {}
        material = ["derived", grant_id, tool, question_key(args.question), hints]
    canonical = json.dumps(material, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def reusable_status(status: Any, *, explicit_key: bool) -> bool:
    if explicit_key:
        return isinstance(status, str) and status not in NOT_REUSED
    return status in REUSED_WITHOUT_KEY


def pick_reusable(snaps: list[Any], *, key: str, grant_id: str, tool: str, now: datetime,
                  explicit_key: bool) -> Any | None:
    """The newest request with this key, grant and tool, created within IDEMPOTENCY_WINDOW_SECONDS, whose status
    reusable_status accepts."""
    cutoff = now - timedelta(seconds=config.IDEMPOTENCY_WINDOW_SECONDS)
    best, best_at = None, None
    for snap in snaps:
        d = snap.to_dict() or {}
        created = d.get("createdAt")
        if (d.get("idempotencyKey") != key or (d.get("requester") or {}).get("grantId") != grant_id
                or d.get("tool") != tool or not reusable_status(d.get("status"), explicit_key=explicit_key)
                or not isinstance(created, datetime) or created < cutoff):
            continue
        if best_at is None or created > best_at:
            best, best_at = snap, created
    return best


def request_data(ctx: CallCtx, *, tool: str, args: tools.LadderArgs, status: Literal["queued", "offline"],
                 now: datetime, key: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "requester": {"kind": "outside", "grantId": ctx.grant_id, "aiName": ctx.grant.ai_name},
        "tool": tool,
        "requestedStep": config.TOOL_STEP[tool],
        "maxStep": ctx.grant.max_step,
        "allowedCategories": list(ctx.grant.allowed_categories),
        "allowedSources": list(ctx.grant.allowed_sources),
        "question": args.question,
        "status": status,
        "createdAt": now,
        "expireAt": now + timedelta(hours=config.REQUEST_TTL_HOURS),
        "idempotencyKey": key,
    }
    if args.hints is not None:
        data["hints"] = args.hints.to_firestore()
    return data


def create_request(db: Any, ctx: CallCtx, *, tool: str, args: tools.LadderArgs,
                   status: Literal["queued", "offline"], now: datetime) -> str:
    ref = _requests(db, ctx.uid).document()
    ref.create(request_data(ctx, tool=tool, args=args, status=status, now=now,
                            key=request_key(ctx.grant_id, tool, args)))
    return ref.id


def wait_deadline(t0: float, wait_seconds: int, cap: float = config.WAIT_CAP_SECONDS) -> float:
    """t0 plus the shortest of the configured wait, the cap for this kind of call and WAIT_CAP_SECONDS."""
    return t0 + min(wait_seconds, cap, config.WAIT_CAP_SECONDS)


def ladder_deadline(t0: float, wait_seconds: int) -> float:
    return wait_deadline(t0, wait_seconds, config.SHORT_WAIT_SECONDS)


def check_deadline(t0: float, wait_seconds: int) -> float:
    return wait_deadline(t0, wait_seconds, config.CHECK_WAIT_SECONDS)


@dataclass(frozen=True)
class Admitted:
    kind: Literal["created", "offline", "existing", "key-reused", "limit"]
    request_id: str | None = None
    snap: Any = None
    waiting: tuple[str, ...] = ()


def _admit_request_txn(txn: Any, coll: Any, new_ref: Any, *, key: str, grant_id: str, tool: str, question: str,
                       explicit_key: bool, online: bool, data: dict[str, Any], now: datetime) -> Admitted:
    """One transaction: find a request with this key, else check the pending limit and create the new one.
    The key lookup and the create commit together, so parallel retries never make two requests."""
    hits = list(coll.where(filter=FieldFilter("idempotencyKey", "==", key)).limit(20).stream(transaction=txn))
    match = pick_reusable(hits, key=key, grant_id=grant_id, tool=tool, now=now, explicit_key=explicit_key)
    if match is not None:
        asked = (match.to_dict() or {}).get("question")
        if explicit_key and (not isinstance(asked, str) or question_key(asked) != question_key(question)):
            return Admitted("key-reused")
        return Admitted("existing", request_id=match.id, snap=match)
    if not online:
        txn.create(new_ref, {**data, "status": "offline"})
        return Admitted("offline", request_id=new_ref.id)
    waiting = list(coll.where(filter=FieldFilter("requester.grantId", "==", grant_id))
                   .where(filter=FieldFilter("status", "in", list(OPEN_STATUSES)))
                   .limit(config.MAX_OPEN_REQUESTS_PER_GRANT).stream(transaction=txn))
    if len(waiting) >= config.MAX_OPEN_REQUESTS_PER_GRANT:
        return Admitted("limit", waiting=tuple(s.id for s in waiting))
    txn.create(new_ref, data)
    return Admitted("created", request_id=new_ref.id)


def admit_request(db: Any, ctx: CallCtx, *, tool: str, args: tools.LadderArgs, online: bool,
                  now: datetime) -> Admitted:
    coll = _requests(db, ctx.uid)
    key = request_key(ctx.grant_id, tool, args)
    data = request_data(ctx, tool=tool, args=args, status="queued", now=now, key=key)
    return fb.transact(db, _admit_request_txn, coll, coll.document(), key=key, grant_id=ctx.grant_id, tool=tool,
                       question=args.question, explicit_key=args.idempotency_key is not None, online=online,
                       data=data, now=now, lock_key=f"users/{ctx.uid}/requests#{ctx.grant_id}")


def handle_ladder_tool(deps: Any, ctx: CallCtx, *, tool: str, args: tools.LadderArgs, t0: float) -> ToolResult:
    """Create the request (or find the one a retry refers to), wait at most SHORT_WAIT_SECONDS, then answer
    or return pending with the request_id. 30 section 9.4."""
    db = deps.db
    if ctx.playground:
        online = True          # the Playground page is its own home base and is the caller
    else:
        try:
            online = home_base_online(deps.presence(ctx.uid))
        except Exception as exc:  # noqa: BLE001 - presence is advisory: queue and let sieve_check collect later
            logs.log_exception("presence_error", exc, grant=ctx.grant_id)
            online = True
    admitted = admit_request(db, ctx, tool=tool, args=args, online=online, now=deps.now())
    if admitted.kind == "offline":
        return tools.offline_result()
    if admitted.kind == "key-reused":
        return tools.key_reused_result()
    if admitted.kind == "limit":
        return tools.open_limit_result(list(admitted.waiting))
    request_id = str(admitted.request_id)
    ref = _requests(db, ctx.uid).document(request_id)
    if admitted.kind == "existing":
        data = admitted.snap.to_dict() or {}
        logs.log_event("tool_call_deduped", grant=ctx.grant_id, tool=tool, status=str(data.get("status")))
        if data.get("status") not in OPEN_STATUSES:
            return finish(deps, ctx, request_id, data, t0)
    elif not ctx.playground:
        try:
            push.notify_request_waiting(db, deps.push, uid=ctx.uid, request_id=request_id)
        except Exception as exc:  # noqa: BLE001 - a missed push never fails the request
            logs.log_exception("push_error", exc, grant=ctx.grant_id)
    outcome = wait_for_change(ref, deadline=ladder_deadline(t0, deps.wait_seconds()), monotonic=deps.monotonic)
    return finish(deps, ctx, request_id, outcome, t0)


# ---------- waiting ----------

def _done(data: Mapping[str, Any] | None) -> bool:
    return isinstance(data, Mapping) and data.get("status") in WAIT_DONE


def wait_for_change(ref: Any, *, deadline: float, monotonic: Callable[[], float],
                    poll_seconds: float = config.SAFETY_POLL_SECONDS) -> dict | None:
    """Wait until the request reaches a status in WAIT_DONE (or vanishes), or until the deadline.
    A listener delivers changes at once; a direct get() every poll_seconds guards against a stalled
    listener. Returns the document data, {"status": "expired"} when it is gone, or None at the deadline."""
    event = threading.Event()
    box: dict[str, Any] = {}

    def on_snapshot(docs: Any, _changes: Any, _read_time: Any) -> None:
        try:
            doc = docs[0] if docs else None
            if doc is None or not doc.exists:
                box["data"] = {"status": "expired"}
                event.set()
                return
            data = doc.to_dict() or {}
            if _done(data):
                box["data"] = data
                event.set()
        except Exception:  # noqa: BLE001 - the safety poll covers a bad callback
            pass

    watch = None
    poll = poll_seconds
    try:
        try:
            watch = ref.on_snapshot(on_snapshot)
        except Exception as exc:  # noqa: BLE001
            logs.log_exception("listener_error", exc)
            poll = min(poll_seconds, 1.0)
        while True:
            remaining = deadline - monotonic()
            if remaining <= 0:
                return None
            if event.wait(timeout=max(0.0, min(poll, remaining))):
                return box.get("data")
            if deadline - monotonic() <= 0:
                return None
            snap = ref.get()
            if not snap.exists:
                return {"status": "expired"}
            data = snap.to_dict() or {}
            if _done(data):
                return data
    finally:
        if watch is not None:
            try:
                watch.unsubscribe()
            except Exception:  # noqa: BLE001
                pass


# ---------- collecting ----------

@dataclass(frozen=True)
class Collected:
    kind: Literal["delivered", "not-answered", "missing", "revoked"]
    payload: RelayPayload | None = None
    data: dict | None = None


def _collect_txn(txn: Any, ref: Any, grant_ref: Any, now: datetime, max_step: str) -> Collected:
    snap = ref.get(transaction=txn)
    if not snap.exists:
        return Collected("missing")
    data = snap.to_dict() or {}
    if data.get("status") != "answered":
        return Collected("not-answered", data=data)
    # 70 R-RLY-08: re-check the grant at the moment of delivery; a revoke that raced this call wins.
    grant_snap = grant_ref.get(transaction=txn)
    grant = grant_snap.to_dict() if grant_snap.exists else None
    if not grant or grant.get("revokedAt"):
        txn.update(ref, {"status": "revoked", "message": MSG_REVOKED_AT_DELIVERY, "response": firestore.DELETE_FIELD})
        data = {k: v for k, v in data.items() if k != "response"}
        data.update({"status": "revoked", "message": MSG_REVOKED_AT_DELIVERY})
        return Collected("revoked", data=data)
    rank = config.STEP_RANK
    cap = min(rank.get(max_step, 0), rank.get(data.get("maxStep"), 0), rank.get(grant.get("maxStep"), 0))
    try:
        payload = RelayPayload.model_validate(data.get("response"))
        ok = rank[payload.step] <= cap
    except ValidationError:
        payload, ok = None, False
    if not ok:
        txn.update(ref, {"status": "error", "message": MSG_UNDELIVERABLE, "response": firestore.DELETE_FIELD})
        data = {k: v for k, v in data.items() if k != "response"}
        data.update({"status": "error", "message": MSG_UNDELIVERABLE})
        return Collected("not-answered", data=data)
    txn.update(ref, {"status": "collected", "collectedAt": now, "response": firestore.DELETE_FIELD})
    return Collected("delivered", payload=payload, data=data)


def collect_answer(db: Any, uid: str, request_id: str, max_step: str, now: datetime) -> Collected:
    ref = _requests(db, uid).document(request_id)
    grant_id = None
    snap = ref.get()
    if snap.exists:
        grant_id = ((snap.to_dict() or {}).get("requester") or {}).get("grantId")
    grant_ref = db.collection(f"users/{uid}/grants").document(str(grant_id or "-"))
    return fb.transact(db, _collect_txn, ref, grant_ref, now, max_step, lock_key=ref.path)


def _nothing_delay(deps: Any, data: Mapping[str, Any], t0: float) -> None:
    """00 D6: blocked and no-match leave no earlier than the same minimum time after the request was made,
    so an assistant cannot tell a never-shared item from no match by timing."""
    created = data.get("createdAt")
    if not isinstance(created, datetime):
        return
    min_delay = min(config.NOTHING_MIN_DELAY_SECONDS, float(deps.wait_seconds()))
    remaining = min_delay - (deps.now() - created).total_seconds()
    remaining = min(remaining, t0 + config.COLLECT_CUTOFF_SECONDS - deps.monotonic())
    if remaining > 0:
        deps.sleep(remaining)


def finish(deps: Any, ctx: CallCtx, request_id: str, data: dict | None, t0: float) -> ToolResult:
    if data is None:
        return tools.pending_result(request_id)
    status = data.get("status")
    if status == "answered":
        if deps.monotonic() - t0 >= config.COLLECT_CUTOFF_SECONDS:
            return tools.pending_result(request_id)   # the payload stays for sieve_check
        got = collect_answer(deps.db, ctx.uid, request_id, ctx.grant.max_step, deps.now())
        if got.kind == "delivered" and got.payload is not None:
            if not ctx.playground:
                mark_receipt(deps.db, ctx.uid, request_id, "delivered")
            return tools.answered_result(request_id, got.payload.step, got.payload.text, got.payload.image)
        if got.kind == "missing":
            return tools.unknown_request_result()
        if got.kind == "revoked" and not ctx.playground:
            mark_receipt(deps.db, ctx.uid, request_id, "revoked")
        return tools.result_from_request(request_id, got.data or {})
    if status in ("blocked", "no-match"):
        _nothing_delay(deps, data, t0)
    return tools.result_from_request(request_id, data)


# ---------- sieve_check ----------

def _older(value: Any, now: datetime, minutes: int) -> bool:
    return isinstance(value, datetime) and value < now - timedelta(minutes=minutes)


def _expire_txn(txn: Any, ref: Any, seen_status: str, message: str) -> bool:
    snap = ref.get(transaction=txn)
    if not snap.exists or (snap.to_dict() or {}).get("status") != seen_status:
        return False
    txn.update(ref, {"status": "expired", "message": message, "response": firestore.DELETE_FIELD})
    return True


def expire_if_stale(db: Any, ref: Any, data: Mapping[str, Any], now: datetime) -> bool:
    status = data.get("status")
    if status in OPEN_STATUSES and _older(data.get("createdAt"), now, config.DECISION_WINDOW_MINUTES):
        return fb.transact(db, _expire_txn, ref, status, MSG_DECISION_EXPIRED, lock_key=ref.path)
    if status == "answered" and _older(data.get("answeredAt"), now, config.COLLECT_WINDOW_MINUTES):
        done = fb.transact(db, _expire_txn, ref, status, MSG_COLLECT_EXPIRED, lock_key=ref.path)
        if done and not is_playground(data):
            uid = ref.parent.parent.id
            mark_receipt(db, uid, ref.id, "expired")
        return done
    return False


def handle_check(deps: Any, ctx: CallCtx, request_id: str, *, t0: float) -> ToolResult:
    ref = _requests(deps.db, ctx.uid).document(request_id)
    snap = ref.get()
    data = snap.to_dict() if snap.exists else None
    if not data or (data.get("requester") or {}).get("grantId") != ctx.grant_id:
        return tools.unknown_request_result()
    if expire_if_stale(deps.db, ref, data, deps.now()):
        return ToolResult(status="expired", request_id=request_id, message=tools.MSG_REQUEST_EXPIRED)
    status = data.get("status")
    if status in OPEN_STATUSES:
        data = wait_for_change(ref, deadline=check_deadline(t0, deps.wait_seconds()), monotonic=deps.monotonic)
    elif status == "collected":
        return tools.error_result(tools.MSG_COLLECTED, request_id)
    return finish(deps, ctx, request_id, data, t0)


# ---------- receipts ----------

def _mark_txn(txn: Any, ref: Any, status: str) -> bool:
    snap = ref.get(transaction=txn)
    if not snap.exists or (snap.to_dict() or {}).get("status") != "pending-collection":
        return False
    txn.update(ref, {"status": status})
    return True


def _find_receipt(db: Any, uid: str, request_id: str) -> Any | None:
    ref = db.collection(f"users/{uid}/receipts").document(request_id)
    if ref.get().exists:
        return ref
    hits = list(db.collection(f"users/{uid}/receipts")
                .where(filter=FieldFilter("requestId", "==", request_id)).limit(1).stream())
    return hits[0].reference if hits else None


def mark_receipt(db: Any, uid: str, request_id: str, status: Literal["delivered", "expired", "revoked"],
                 *, sleep: Callable[[float], None] | None = None) -> bool:
    """Update only `status`, and only from pending-collection. Functions never create receipts."""
    import time

    ref = _find_receipt(db, uid, request_id)
    if ref is None:
        (sleep or time.sleep)(1.0)
        ref = _find_receipt(db, uid, request_id)
    if ref is None:
        logs.log_warning("receipt_missing", user=logs.user_ref(uid))
        return False
    return fb.transact(db, _mark_txn, ref, status, lock_key=ref.path)
