"""U9: the wait and finish never pass the reply budget; presence, dedupe keys and the D6 delay."""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sieve import config, relay, tools
from sieve.models import GrantMeta

NOW = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


class StubSnap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class StubRef:
    """No listener events; each safety poll advances the fake clock by 5 s."""

    def __init__(self, clock: Clock, data: dict, *, answer_at: float | None = None, step: float = 5.0) -> None:
        self.clock = clock
        self.data = data
        self.answer_at = answer_at
        self.step = step
        self.gets = 0

    def on_snapshot(self, _cb):
        class W:
            def unsubscribe(self_inner):
                pass
        return W()

    def get(self, transaction=None):
        self.gets += 1
        self.clock.t += self.step
        if self.answer_at is not None and self.clock.t >= self.answer_at:
            return StubSnap({**self.data, "status": "answered"})
        return StubSnap(self.data)


def test_u9_wait_honours_deadline():
    clock = Clock()
    ref = StubRef(clock, {"status": "awaiting-person"})
    out = relay.wait_for_change(ref, deadline=relay.ladder_deadline(0.0, 45), monotonic=clock, poll_seconds=0.0001)
    assert out is None and 15 <= clock.t <= 15 + 5
    clock2 = Clock()
    assert relay.wait_deadline(0.0, 120) == config.WAIT_CAP_SECONDS == 20
    ref2 = StubRef(clock2, {"status": "queued"})
    assert relay.wait_for_change(ref2, deadline=relay.check_deadline(0.0, 120), monotonic=clock2,
                                 poll_seconds=0.0001) is None
    assert 20 <= clock2.t <= 25


def test_wait_caps_per_call_kind():
    """A ladder tool waits at most 15 s, sieve_check at most 20 s; RELAY_WAIT_SECONDS can only shorten them."""
    assert relay.ladder_deadline(100.0, 45) == 115.0
    assert relay.check_deadline(100.0, 45) == 120.0
    assert relay.ladder_deadline(0.0, 6) == relay.check_deadline(0.0, 6) == 6.0
    assert relay.check_deadline(0.0, 10_000) == config.WAIT_CAP_SECONDS


def _grant():
    return GrantMeta(ai_name="Test", max_step="full", allowed_categories=["Home"], allowed_sources=["gmail"],
                     created_at=NOW, expires_at=NOW + timedelta(days=1), link_hint="abcd")


@dataclass
class StubDeps:
    clock: Clock
    slept: list = field(default_factory=list)
    db: Any = None
    wait: int = 45

    def monotonic(self) -> float:
        return self.clock.t

    def now(self) -> datetime:
        return NOW + timedelta(seconds=self.clock.t)

    def wait_seconds(self) -> int:
        return self.wait

    def sleep(self, s: float) -> None:
        self.slept.append(s)
        self.clock.t += s


def test_u9_answered_after_cutoff_is_pending_and_not_collected():
    clock = Clock()
    clock.t = config.COLLECT_CUTOFF_SECONDS + 0.5
    deps = StubDeps(clock)
    ctx = relay.CallCtx(uid="u", grant_id="g", link_hash="h", grant=_grant())
    result = relay.finish(deps, ctx, "a" * 20, {"status": "answered"}, t0=0.0)
    assert result.status == "pending"       # deps.db is None: a collect would have raised


class StubColl:
    def __init__(self, ref: StubRef) -> None:
        self.ref = ref

    def document(self, _rid: str) -> StubRef:
        return self.ref


class StubDb:
    def __init__(self, ref: StubRef) -> None:
        self.ref = ref

    def collection(self, _path: str) -> StubColl:
        return StubColl(self.ref)


def test_no_tool_call_passes_25_seconds(monkeypatch):
    """End to end with a fake clock where every read costs 1 s: the ladder tool returns pending with the
    request_id by t0 + 15 (plus one read), sieve_check by t0 + 20 (plus one read), never past 25 s."""
    ctx = relay.CallCtx(uid="u", grant_id="g", link_hash="h", grant=_grant())
    rid = "R" * 20
    real_wait = relay.wait_for_change
    monkeypatch.setattr(relay, "wait_for_change", lambda ref, **kw: real_wait(ref, poll_seconds=0.0001, **kw))

    clock = Clock()
    deps = StubDeps(clock, db=StubDb(StubRef(clock, {"status": "queued"}, step=1.0)))
    deps.presence = lambda uid: {"d1": {"state": "online", "isHomeBase": True}}
    deps.push = None
    monkeypatch.setattr(relay, "admit_request", lambda *a, **k: relay.Admitted("created", request_id=rid))
    monkeypatch.setattr(relay.push, "notify_request_waiting", lambda *a, **k: 0)
    args = tools.parse_ladder_args({"question": "Q"}, today=NOW.date())
    out = relay.handle_ladder_tool(deps, ctx, tool="sieve_answer", args=args, t0=0.0)
    assert out.status == "pending" and out.request_id == rid
    assert config.SHORT_WAIT_SECONDS <= clock.t <= config.SHORT_WAIT_SECONDS + 1 < config.REPLY_DEADLINE_SECONDS

    clock2 = Clock()
    deps2 = StubDeps(clock2, db=StubDb(StubRef(clock2, {"status": "awaiting-person",
                                                         "requester": {"grantId": "g"}}, step=1.0)))
    out2 = relay.handle_check(deps2, ctx, rid, t0=0.0)
    assert out2.status == "pending" and out2.request_id == rid
    assert config.CHECK_WAIT_SECONDS <= clock2.t <= config.CHECK_WAIT_SECONDS + 1 < config.REPLY_DEADLINE_SECONDS


def test_check_unknown_id_is_its_own_status():
    clock = Clock()
    ctx = relay.CallCtx(uid="u", grant_id="g", link_hash="h", grant=_grant())
    for data in (None, {"status": "queued", "requester": {"grantId": "other"}}):
        deps = StubDeps(clock, db=StubDb(StubRef(clock, data, step=0.0)))
        out = relay.handle_check(deps, ctx, "Q" * 20, t0=0.0)
        assert out.to_wire() == {"status": "unknown", "message": tools.MSG_UNKNOWN_ID}
    stale = {"status": "expired", "requester": {"grantId": "g"}}
    deps = StubDeps(clock, db=StubDb(StubRef(clock, stale, step=0.0)))
    out = relay.handle_check(deps, ctx, "Q" * 20, t0=0.0)
    assert out.to_wire() == {"status": "expired", "request_id": "Q" * 20, "message": tools.MSG_REQUEST_EXPIRED}


def test_d6_nothing_results_share_a_minimum_delay():
    clock = Clock()
    deps = StubDeps(clock)
    ctx = relay.CallCtx(uid="u", grant_id="g", link_hash="h", grant=_grant())
    created = NOW
    blocked = relay.finish(deps, ctx, "a" * 20, {"status": "blocked", "createdAt": created}, t0=0.0)
    assert deps.slept == [config.NOTHING_MIN_DELAY_SECONDS]
    assert blocked.to_wire() == {"status": "no-match", "request_id": "a" * 20, "message": tools.MSG_NOTHING}
    clock.t = 30.0       # long after: no extra delay
    relay.finish(deps, ctx, "a" * 20, {"status": "no-match", "createdAt": created}, t0=25.0)
    assert deps.slept == [config.NOTHING_MIN_DELAY_SECONDS]
    deps_short = StubDeps(Clock(), wait=6)
    relay.finish(deps_short, ctx, "a" * 20, {"status": "no-match", "createdAt": NOW}, t0=0.0)
    assert deps_short.slept == [6.0]


def test_home_base_online():
    assert relay.home_base_online({"d1": {"state": "online", "isHomeBase": True}})
    assert not relay.home_base_online({"d1": {"state": "online", "isHomeBase": False}})
    assert not relay.home_base_online({"d1": {"state": "offline", "isHomeBase": True}})
    assert not relay.home_base_online(None)
    assert not relay.home_base_online({"d1": "online"})


class _Snap:
    def __init__(self, data):
        self._d = data

    def to_dict(self):
        return self._d


Q = "What did my landlord say about the deposit?"


def _args(arguments):
    return tools.parse_ladder_args(arguments, today=NOW.date())


def test_r_mcp_06_derived_key():
    """Without a client key: grant, tool, question (case and spaces folded) and hints."""
    key = relay.request_key("g", "sieve_answer", _args({"question": Q}))
    assert len(key) == 64 and all(c in "0123456789abcdef" for c in key)
    assert relay.request_key("g", "sieve_answer", _args({"question": "  what did my LANDLORD say   about the deposit? "})) == key
    assert relay.request_key("g", "sieve_excerpt", _args({"question": Q})) != key
    assert relay.request_key("g2", "sieve_answer", _args({"question": Q})) != key
    assert relay.request_key("g", "sieve_answer", _args({"question": Q, "from": "landlord"})) != key
    assert relay.request_key("g", "sieve_answer", _args({"question": "When is the rent due?"})) != key
    hinted = _args({"question": Q, "after": "2026-10-01", "terms": ["A1"]})
    assert relay.request_key("g", "sieve_answer", hinted) == relay.request_key(
        "g", "sieve_answer", _args({"terms": ["A1"], "after": "2026-10-01", "question": Q}))


def test_client_key_scopes_and_is_never_stored_raw():
    with_key = relay.request_key("g", "sieve_answer", _args({"question": Q, "idempotency_key": "ask-1"}))
    assert with_key == relay.request_key("g", "sieve_answer", _args({"question": "Other?", "idempotency_key": "ask-1"}))
    assert with_key != relay.request_key("g", "sieve_answer", _args({"question": Q}))
    assert with_key != relay.request_key("g", "sieve_answer", _args({"question": Q, "idempotency_key": "ask-2"}))
    assert with_key != relay.request_key("g", "sieve_excerpt", _args({"question": Q, "idempotency_key": "ask-1"}))
    ctx = relay.CallCtx(uid="u", grant_id="g", link_hash="h", grant=_grant())
    args = _args({"question": Q, "idempotency_key": "ask-1"})
    data = relay.request_data(ctx, tool="sieve_answer", args=args, status="queued", now=NOW,
                              key=relay.request_key("g", "sieve_answer", args))
    assert data["idempotencyKey"] == with_key and "ask-1" not in str(data)


def test_pick_reusable_rules():
    key = "k" * 64
    base = {"idempotencyKey": key, "requester": {"grantId": "g"}, "tool": "sieve_answer", "question": Q,
            "createdAt": NOW - timedelta(seconds=30)}

    def pick(snaps, explicit=False, now=NOW):
        return relay.pick_reusable(snaps, key=key, grant_id="g", tool="sieve_answer", now=now, explicit_key=explicit)

    # without a client key: only a request still waiting or holding an uncollected answer
    for status in ("queued", "claimed", "awaiting-person", "answered"):
        s = _Snap(dict(base, status=status))
        assert pick([s]) is s
    for status in ("collected", "declined", "blocked", "no-match", "unsupported", "offline", "error", "expired",
                   "revoked"):
        assert pick([_Snap(dict(base, status=status))]) is None
    # with a client key: everything except a request that ended without a decision
    for status in ("queued", "answered", "collected", "declined", "blocked", "no-match", "unsupported"):
        s = _Snap(dict(base, status=status))
        assert pick([s], explicit=True) is s
    for status in ("offline", "error", "expired", "revoked"):
        assert pick([_Snap(dict(base, status=status))], explicit=True) is None
    # the 10 minute window, the grant, the tool, the newest wins
    assert pick([_Snap(dict(base, status="queued", createdAt=NOW - timedelta(seconds=601)))]) is None
    assert pick([_Snap(dict(base, status="queued", requester={"grantId": "other"}))]) is None
    assert pick([_Snap(dict(base, status="queued", tool="sieve_excerpt"))]) is None
    older = _Snap(dict(base, status="queued", createdAt=NOW - timedelta(seconds=200)))
    newer = _Snap(dict(base, status="awaiting-person", createdAt=NOW - timedelta(seconds=20)))
    assert pick([older, newer]) is newer and pick([newer, older]) is newer
