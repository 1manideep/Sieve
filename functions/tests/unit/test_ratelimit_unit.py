"""U18: the rate limit (30 section 11). The real wait, half-weight polls, refused calls not counted, the budget."""
import time
from datetime import datetime, timedelta, timezone

import pytest

from sieve import authz, config, links, mcp_server, ratelimit, relay, tools
from sieve.models import GrantMeta
from tests.helpers.fakes import FakeDb

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
CAP = config.RATE_LIMIT_CALLS
CHECK = config.CHECK_CALL_WEIGHT


def _at(seconds: float) -> datetime:
    return NOW + timedelta(seconds=seconds)


def _full(at: datetime = NOW) -> ratelimit.Bucket:
    return ratelimit.Bucket(used=float(CAP), refunds=0.0, at=at)


# ---------- the wait ----------

def test_stated_wait_rounds_up_to_five_seconds():
    assert [ratelimit.stated_wait(s) for s in (0.01, 3.75, 5.0, 5.01, 7.5, 10.0, 12.0, 61.0)] == \
        [5, 5, 5, 10, 10, 10, 15, 65]
    assert ratelimit.max_stated_wait() == 10
    assert ratelimit.drain_per_second() == pytest.approx(CAP / 600)


def test_the_wait_is_the_real_wait():
    """A full bucket refuses a call with the exact time it needs to drain, and the call goes through after it."""
    for weight, real in ((1.0, 600 / CAP), (CHECK, CHECK * 600 / CAP)):
        after, wait = ratelimit.take(_full(), weight, NOW)
        assert wait == pytest.approx(real) and after.used == CAP
        assert ratelimit.take(_full(), weight, _at(real - 0.1))[1] == pytest.approx(0.1)
        assert ratelimit.take(_full(), weight, _at(real))[1] == 0
        stated = ratelimit.stated_wait(wait)
        assert stated % 5 == 0 and real <= stated < real + 5
        assert ratelimit.take(_full(), weight, _at(stated))[1] == 0
    assert ratelimit.stated_wait(ratelimit.take(_full(), 1.0, NOW)[1]) == 10
    assert ratelimit.stated_wait(ratelimit.take(_full(), CHECK, NOW)[1]) == 5


def test_rate_limit_message_states_the_wait():
    out = tools.rate_limited_result(10)
    assert (out.status, out.request_id, out.refused) == ("error", None, False)
    assert out.message == "Too many requests from this connection. Wait about 10 seconds, then try again."
    assert "minute" not in tools.MSG_RATE_LIMITED and "{seconds}" in tools.MSG_RATE_LIMITED
    for seconds in (5, 10, 15):
        assert f"Wait about {seconds} seconds, then try again." in tools.rate_limited_result(seconds).message


def test_the_description_states_the_limit_and_the_wait_in_one_sentence():
    sentence = ("A connection may make 80 calls per 10 minutes, and each sieve_check counts as half a call; past "
                "that, the result says how many seconds to wait, at most 10.")
    for step in ("answer", "excerpt", "full"):
        assert sentence in tools.description("sieve_answer", step)
    assert sentence.count(".") == 1 and CHECK == 0.5 and ratelimit.max_stated_wait() == 10


# ---------- weights ----------

def test_sieve_check_counts_half():
    assert ratelimit.call_weight("sieve_check") == CHECK == 0.5
    assert {ratelimit.call_weight(n) for n in ("sieve_answer", "sieve_excerpt", "sieve_full_item", "other")} == {1.0}
    b = ratelimit.Bucket()
    for i in range(int(CAP / CHECK)):              # 160 polls at one instant fit
        b, wait = ratelimit.take(b, CHECK, NOW)
        assert wait == 0, i
    assert ratelimit.take(b, CHECK, NOW)[1] > 0
    b = ratelimit.Bucket()
    for _ in range(CAP):                           # 80 questions at one instant fit
        b, wait = ratelimit.take(b, 1.0, NOW)
        assert wait == 0
    assert ratelimit.take(b, 1.0, NOW)[1] > 0


def test_one_request_polled_every_20_seconds_never_reaches_the_limit():
    b, peak = ratelimit.Bucket(), 0.0
    for i in range(3 * 60 * 3):                    # three hours of polls, one every 20 s
        b, wait = ratelimit.take(b, CHECK, _at(20 * i))
        assert wait == 0
        peak = max(peak, b.used)
    assert peak <= CHECK + 1e-9


# ---------- refused calls ----------

def test_a_refused_call_adds_nothing():
    full = _full()
    after, wait = ratelimit.take(full, 1.0, NOW)
    assert wait > 0 and after == full
    for _ in range(50):                            # a client hammering the limit does not push the wait out
        after, again = ratelimit.take(after, 1.0, NOW)
        assert again == pytest.approx(wait) and after.used == CAP


def test_give_back_returns_the_weight_up_to_the_free_refusals():
    b, _ = ratelimit.take(ratelimit.Bucket(), 1.0, NOW)
    b, _ = ratelimit.take(b, CHECK, NOW)
    back = ratelimit.give_back(b, CHECK, NOW)
    assert back is not None and back.used == pytest.approx(1.0) and back.refunds == 1
    b = ratelimit.Bucket(used=40.0, refunds=0.0, at=NOW)
    for i in range(config.RATE_LIMIT_FREE_REFUSALS):
        b = ratelimit.give_back(ratelimit.take(b, 1.0, NOW)[0], 1.0, NOW)
        assert b is not None and b.used == pytest.approx(40.0), i
    assert ratelimit.give_back(ratelimit.take(b, 1.0, NOW)[0], 1.0, NOW) is None
    later = ratelimit.give_back(b, 1.0, _at(600 / config.RATE_LIMIT_FREE_REFUSALS))   # one free refusal back
    assert later is not None
    assert ratelimit.give_back(ratelimit.Bucket(), 1.0, NOW).used == 0      # never below empty


def test_bucket_from_doc():
    assert ratelimit.Bucket.from_doc({}) == ratelimit.Bucket()
    assert ratelimit.Bucket.from_doc({"rateWindowStart": NOW, "rateCount": 30}) == ratelimit.Bucket()  # old fields
    assert ratelimit.Bucket.from_doc({"rateUsed": 5, "rateAt": "x"}) == ratelimit.Bucket()
    weird = ratelimit.Bucket.from_doc({"rateUsed": True, "rateRefunds": float("nan"), "rateAt": NOW})
    assert (weird.used, weird.refunds) == (0.0, 0.0)
    assert ratelimit.Bucket.from_doc({"rateUsed": -3, "rateAt": NOW}).used == 0.0
    assert ratelimit.Bucket.from_doc({"rateUsed": 500.0, "rateRefunds": 99, "rateAt": NOW}) == \
        ratelimit.Bucket(used=float(CAP), refunds=float(config.RATE_LIMIT_FREE_REFUSALS), at=NOW)
    b = ratelimit.Bucket(used=10.0, refunds=2.0, at=NOW)
    assert ratelimit.Bucket.from_doc(b.to_doc()) == b
    assert b.drained(_at(-30)) == b                # a clock behind rateAt drains nothing and keeps rateAt
    assert b.drained(_at(30)).used == pytest.approx(10.0 - 30 * CAP / 600)


# ---------- the budget (30 section 11) ----------

POLL_EVERY = 20
WINDOW = config.RATE_LIMIT_WINDOW_SECONDS
QUESTIONS = 20
PENDING = config.MAX_OPEN_REQUESTS_PER_GRANT


def _workload(windows: int) -> list[tuple[float, float]]:
    """(time, weight): 3 pending requests polled every 20 s, plus 20 new questions per 10 minutes sent at once
    at the start of each window, the worst place for them."""
    calls = [(w * WINDOW + 0.001 * q, 1.0) for w in range(windows) for q in range(QUESTIONS)]
    calls += [(i * POLL_EVERY + 0.01 * p, CHECK) for p in range(PENDING)
              for i in range(windows * WINDOW // POLL_EVERY)]
    return sorted(calls)


def _run(calls: list[tuple[float, float]]) -> tuple[int, float]:
    b, refused, peak = ratelimit.Bucket(), 0, 0.0
    for t, weight in calls:
        after, wait = ratelimit.take(b, weight, _at(t))
        if wait:
            refused += 1
        b = after
        peak = max(peak, b.used)
    return refused, peak


def test_budget_arithmetic():
    polls = PENDING * (WINDOW // POLL_EVERY)       # 3 x 30 = 90 polls in 10 minutes
    units = polls * CHECK + QUESTIONS              # 45 + 20 = 65 call units
    assert (polls, units) == (90, 65.0)
    assert units < CAP == 80                        # 15 units, about a fifth of the budget, to spare


def test_budget_holds_for_the_heaviest_normal_use():
    refused, peak = _run(_workload(windows=6))      # an hour of it
    assert refused == 0
    assert peak <= QUESTIONS + PENDING * CHECK + 1e-6   # the bucket never holds more than the burst: 21.5 of 80


def test_the_old_budget_fails_the_same_use(monkeypatch):
    """The fixed 30 calls per 10 minutes, with polls at full weight, refuses this use within the first window."""
    monkeypatch.setattr(config, "RATE_LIMIT_CALLS", 30)
    calls = [(t, 1.0) for t, _ in _workload(windows=1)]
    assert _run(calls)[0] > 0


# ---------- the dispatch: what counts and what is given back ----------

GRANT = GrantMeta(ai_name="Test AI", max_step="full", allowed_categories=["Home"], allowed_sources=["gmail"],
                  created_at=NOW, expires_at=NOW + timedelta(days=1), link_hint="abcd")
RID = "R" * 20


class MemLimiter:
    """ratelimit.admit and ratelimit.refund over one in-memory bucket, with the real take and give_back."""

    def __init__(self) -> None:
        self.bucket = ratelimit.Bucket()
        self.refunds = 0

    def admit(self, db, link_hash, now, weight=1.0):
        after, wait = ratelimit.take(self.bucket, weight, now)
        if wait == 0:
            self.bucket = after
        return ratelimit.Admission(allowed=wait == 0, connector={"uid": "u1", "grantId": "G" * 20, "token": "x"},
                                   grant=GRANT, retry_after_seconds=ratelimit.stated_wait(wait) if wait else 0,
                                   weight=weight)

    def refund(self, db, link_hash, weight, now):
        self.refunds += 1
        after = ratelimit.give_back(self.bucket, weight, now)
        if after is None:
            return False
        self.bucket = after
        return True


@pytest.fixture
def limiter(monkeypatch):
    mem = MemLimiter()
    monkeypatch.setattr(ratelimit, "admit", mem.admit)
    monkeypatch.setattr(ratelimit, "refund", mem.refund)
    monkeypatch.setattr(authz, "authorize_call", lambda db, **kw: authz.AuthzOutcome(
        kw["tool_name"] != "sieve_full_item", "OK" if kw["tool_name"] != "sieve_full_item" else
        "CAVEAT_NOT_SATISFIED"))
    return mem


def _call(name, arguments):
    deps = mcp_server.Deps(db=FakeDb(), presence=lambda uid: None, push=None, secret=lambda: b"k" * 32,
                           wait_seconds=lambda: 6, now=lambda: NOW, monotonic=time.monotonic, sleep=lambda s: None)
    msg = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    reply = mcp_server.call_tool(msg, era="legacy", version="2025-11-25", link_secret=links.new_link_secret(),
                                 link_hash="h" * 64, deps=deps, t0=time.monotonic())
    return reply.body["result"]["structuredContent"]


def test_refused_calls_are_given_back(limiter, monkeypatch):
    monkeypatch.setattr(relay, "handle_check", lambda deps, ctx, rid, t0: tools.unknown_request_result())
    assert _call("sieve_check", {"request_id": RID})["status"] == "unknown"
    assert _call("sieve_check", {"request_id": "bad"})["message"] == tools.MSG_REQUEST_ID
    assert _call("sieve_answer", {"question": "Q", "after": "2026-13-01"})["status"] == "error"
    assert _call("sieve_answer", {"question": "Q", "colour": "red"})["status"] == "error"
    monkeypatch.setattr(relay, "handle_ladder_tool", lambda deps, ctx, tool, args, t0: tools.open_limit_result(
        ["A" * 20, "B" * 20, "C" * 20]))
    assert _call("sieve_answer", {"question": "Q"})["message"].startswith("At most 3 requests can wait")
    monkeypatch.setattr(relay, "handle_ladder_tool", lambda deps, ctx, tool, args, t0: tools.key_reused_result())
    assert _call("sieve_answer", {"question": "Q", "idempotency_key": "k"})["message"] == tools.MSG_KEY_REUSED
    assert limiter.refunds == 6 and limiter.bucket.used == 0 and limiter.bucket.refunds == 6


def test_answered_pending_and_denied_calls_count(limiter, monkeypatch):
    monkeypatch.setattr(relay, "handle_check", lambda deps, ctx, rid, t0: tools.pending_result(rid))
    monkeypatch.setattr(relay, "handle_ladder_tool", lambda deps, ctx, tool, args, t0: tools.pending_result(RID))
    assert _call("sieve_check", {"request_id": RID})["status"] == "pending"
    assert limiter.bucket.used == CHECK
    assert _call("sieve_answer", {"question": "Q"})["status"] == "pending"
    assert limiter.bucket.used == CHECK + 1
    assert _call("sieve_full_item", {"question": "Q"})["status"] == "not-allowed"     # a step-cap denial counts
    assert limiter.bucket.used == CHECK + 2 and limiter.refunds == 0


def test_a_rate_limited_call_states_the_wait_and_is_not_counted(limiter, monkeypatch):
    monkeypatch.setattr(relay, "handle_ladder_tool", lambda deps, ctx, tool, args, t0: tools.pending_result(RID))
    monkeypatch.setattr(relay, "handle_check", lambda deps, ctx, rid, t0: tools.pending_result(rid))
    limiter.bucket = _full()
    out = _call("sieve_answer", {"question": "Q"})
    assert out == {"status": "error", "message": "Too many requests from this connection. Wait about 10 seconds, "
                                                 "then try again."}
    assert _call("sieve_check", {"request_id": RID})["message"].endswith("Wait about 5 seconds, then try again.")
    assert limiter.bucket == _full() and limiter.refunds == 0
