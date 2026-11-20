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
    out = relay.wait_for_change(ref, deadline=relay.wait_deadline(0.0, 45), monotonic=clock, poll_seconds=0.0001)
    assert out is None and clock.t <= 45 + 5 and clock.t >= 45
    clock2 = Clock()
    assert relay.wait_deadline(0.0, 120) == config.WAIT_CAP_SECONDS
    ref2 = StubRef(clock2, {"status": "queued"})
    assert relay.wait_for_change(ref2, deadline=relay.wait_deadline(0.0, 120), monotonic=clock2,
                                 poll_seconds=0.0001) is None
    assert 50 <= clock2.t <= 55


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
    clock.t = 53.5
    deps = StubDeps(clock)
    ctx = relay.CallCtx(uid="u", grant_id="g", link_hash="h", grant=_grant())
    result = relay.finish(deps, ctx, "a" * 20, {"status": "answered"}, t0=0.0)
    assert result.status == "pending"       # deps.db is None: a collect would have raised


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


def test_r_mcp_06_duplicate_detection():
    q = "What did my landlord say about the deposit?"
    base = {"tool": "sieve_answer", "question": q, "status": "queued", "createdAt": NOW}
    same = _Snap(dict(base, question="  what did my LANDLORD say   about the deposit? "))
    assert relay.find_duplicate([same], tool="sieve_answer", question=q, now=NOW) is same
    assert relay.find_duplicate([_Snap(dict(base, tool="sieve_excerpt"))], tool="sieve_answer", question=q,
                                now=NOW) is None
    assert relay.find_duplicate([_Snap(dict(base, status="answered"))], tool="sieve_answer", question=q,
                                now=NOW) is None
    old = _Snap(dict(base, createdAt=NOW - timedelta(seconds=601)))
    assert relay.find_duplicate([old], tool="sieve_answer", question=q, now=NOW) is None
