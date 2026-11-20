"""Request lifecycle: create, wait, collect, check, receipts (30 section 9; 70 R-MCP-06; 00 D6)."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Literal, Mapping

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import ValidationError

from . import config, fb, logs, push, tools
from .models import GrantMeta, RelayPayload, ToolResult

WAIT_DONE = frozenset({"answered", "declined", "blocked", "no-match", "error", "expired", "revoked", "collected",
                       "offline"})
OPEN_STATUSES = ("queued", "claimed", "awaiting-person")
OPEN_AND_ANSWERED = ["queued", "claimed", "awaiting-person", "answered"]
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


def open_requests(db: Any, uid: str, grant_id: str, limit: int) -> list[Any]:
    query = (_requests(db, uid).where(filter=FieldFilter("requester.grantId", "==", grant_id))
             .where(filter=FieldFilter("status", "in", OPEN_AND_ANSWERED)).limit(limit))
    return list(query.stream())


def count_open_requests(db: Any, uid: str, grant_id: str, limit: int) -> int:
    return len(open_requests(db, uid, grant_id, limit))


def question_key(question: str) -> str:
    return " ".join(question.split()).casefold()


def find_duplicate(snaps: list[Any], *, tool: str, question: str, now: datetime) -> Any | None:
    """70 R-MCP-06: an open (queued, claimed, awaiting-person) request of this grant with the same tool and
    question asked within DEDUPE_WINDOW_SECONDS."""
    key = question_key(question)
    cutoff = now - timedelta(seconds=config.DEDUPE_WINDOW_SECONDS)
    for snap in snaps:
        d = snap.to_dict() or {}
        created = d.get("createdAt")
        if (d.get("status") in OPEN_STATUSES and d.get("tool") == tool and isinstance(d.get("question"), str)
                and question_key(d["question"]) == key and isinstance(created, datetime) and created >= cutoff):
            return snap
    return None


def create_request(db: Any, ctx: CallCtx, *, tool: str, args: tools.LadderArgs,
                   status: Literal["queued", "offline"], now: datetime) -> str:
    ref = _requests(db, ctx.uid).document()
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
    }
    if args.hints is not None:
        data["hints"] = args.hints.to_firestore()
    ref.create(data)
    return ref.id


def wait_deadline(t0: float, wait_seconds: int) -> float:
    return t0 + min(wait_seconds, config.WAIT_CAP_SECONDS)


def handle_ladder_tool(deps: Any, ctx: CallCtx, *, tool: str, args: tools.LadderArgs, t0: float) -> ToolResult:
    db = deps.db
    if ctx.playground:
        online = True          # the Playground page is its own home base and is the caller
    else:
        try:
            online = home_base_online(deps.presence(ctx.uid))
        except Exception as exc:  # noqa: BLE001 - presence is advisory: queue and let sieve_check collect later
            logs.log_exception("presence_error", exc, grant=ctx.grant_id)
            online = True
    now = deps.now()
    if not online:
        create_request(db, ctx, tool=tool, args=args, status="offline", now=now)
        return tools.offline_result()

    open_snaps = open_requests(db, ctx.uid, ctx.grant_id, limit=20)
    dup = find_duplicate(open_snaps, tool=tool, question=args.question, now=now)
    if dup is not None:
        logs.log_event("tool_call_deduped", grant=ctx.grant_id, tool=tool)
        outcome = wait_for_change(dup.reference, deadline=wait_deadline(t0, deps.wait_seconds()),
                                  monotonic=deps.monotonic)
        return finish(deps, ctx, dup.id, outcome, t0)
    if len(open_snaps) >= config.MAX_OPEN_REQUESTS_PER_GRANT:
        return tools.error_result(tools.MSG_OPEN_LIMIT)

    request_id = create_request(db, ctx, tool=tool, args=args, status="queued", now=now)
    if not ctx.playground:
        try:
            push.notify_request_waiting(db, deps.push, uid=ctx.uid, request_id=request_id)
        except Exception as exc:  # noqa: BLE001 - a missed push never fails the request
            logs.log_exception("push_error", exc, grant=ctx.grant_id)
    ref = _requests(db, ctx.uid).document(request_id)
    outcome = wait_for_change(ref, deadline=wait_deadline(t0, deps.wait_seconds()), monotonic=deps.monotonic)
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
        data = wait_for_change(ref, deadline=wait_deadline(t0, deps.wait_seconds()), monotonic=deps.monotonic)
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
