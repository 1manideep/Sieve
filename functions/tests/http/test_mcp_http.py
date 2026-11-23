"""H1, H3 to H14, H17, H18 and the R-MCP cases, through the Functions emulator over real HTTP."""
import json
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from sieve import config, links, tools
from tests.emulator._grants import put_request
from tests.helpers import emulator as emu
from tests.helpers.home_base import HomeBaseSim, answer, blocked, decline, never, no_match
from tests.http._setup import QUESTION, check, ladder, owner

PAYLOAD = "Your deposit was $1,200."


def test_h1_full_round_trip(db):
    o = owner(db)
    s = emu.LegacySession(o.secret)
    assert s.initialize_result["protocolVersion"] == "2025-11-25"
    assert s.initialize_result["serverInfo"] == {"name": "sieve", "title": "Sieve", "version": "1.0.0"}
    listed = s.post("tools/list").json()["result"]["tools"]
    assert [t["name"] for t in listed] == ["sieve_answer", "sieve_excerpt", "sieve_full_item", "sieve_check"]
    with HomeBaseSim(db, o.uid, o.device, answer(PAYLOAD, "answer", delay=1)):
        result, out = ladder(s)
    assert out["status"] == "answered" and out["text"] == PAYLOAD and out["step"] == "answer"
    assert result["structuredContent"]["text"] == PAYLOAD and result["isError"] is False
    rid = out["request_id"]
    doc = db.collection(f"users/{o.uid}/requests").document(rid).get().to_dict()
    assert doc["status"] == "collected" and "response" not in doc and doc["collectedAt"]
    assert db.collection(f"users/{o.uid}/receipts").document(rid).get().get("status") == "delivered"
    entries = emu.audit_entries(db, o.uid)
    assert any(e["tool_name"] == "sieve_answer" and e["decision"] == "ALLOW" for e in entries)
    pushes = [p.to_dict() for p in db.collection("debug_pushes").stream()]
    assert len(pushes) == 1 and pushes[0]["requestId"] == rid and pushes[0]["tokenCount"] == 1
    assert pushes[0]["data"] == {"kind": "request-waiting"}
    assert pushes[0]["notification"] == {"title": "Sieve", "body": "A request is waiting"}
    assert QUESTION not in json.dumps(pushes[0], default=str)


def test_h3_offline(db):
    o = owner(db, online=False)
    s = emu.LegacySession(o.secret)
    t = time.monotonic()
    _, out = ladder(s)
    assert time.monotonic() - t < 3
    assert out == {"status": "offline", "message": tools.MSG_OFFLINE}
    docs = emu.requests_of(db, o.uid)
    assert len(docs) == 1 and docs[0].get("status") == "offline"
    assert not list(db.collection("debug_pushes").stream())


def test_h4_wait_then_check(db):
    o = owner(db)
    s = emu.LegacySession(o.secret)
    with HomeBaseSim(db, o.uid, o.device, answer(PAYLOAD, delay=9)):
        t = time.monotonic()
        _, first = ladder(s)
        assert 5 < time.monotonic() - t < 12
        assert first["status"] == "pending"
        rid = first["request_id"]
        # the first pending result asks the assistant to tell the person, once
        assert first["message"].startswith(tools.MSG_PENDING.replace("{id}", rid))
        _, second = check(s, rid)
        assert second["status"] == "answered" and second["text"] == PAYLOAD
        _, third = check(s, rid)
    assert third == {"status": "error", "request_id": rid, "message": tools.MSG_COLLECTED}


def test_h5_check_waits(db):
    o = owner(db)
    s = emu.LegacySession(o.secret)
    with HomeBaseSim(db, o.uid, o.device, answer(PAYLOAD, delay=10)):
        _, first = ladder(s)
        assert first["status"] == "pending"
        t = time.monotonic()
        _, second = check(s, first["request_id"])
        assert second["status"] == "answered" and time.monotonic() - t > 1


def test_h6_revoked_grant(db):
    o = owner(db)
    emu.call("revokeGrant", {"grantId": o.grant["grantId"]}, o.token)
    s = emu.LegacySession(o.secret)
    result, out = ladder(s)
    assert out == {"status": "not-allowed", "message": tools.MSG_GRANT_REVOKED} and result["isError"] is True
    assert emu.requests_of(db, o.uid) == []
    last = emu.audit_entries(db, o.uid)[-1]
    assert (last["decision"], last["reason_code"]) == ("DENY", "REVOKED")


def test_h7_expired_grant(db, broker_secret):
    from tests.emulator._grants import short_grant
    uid, _ = emu.sign_up()
    out, link_secret, _ = short_grant(db, uid, broker_secret, ttl_seconds=2)
    time.sleep(3)
    s = emu.LegacySession(link_secret)
    result, res = ladder(s)
    assert res["status"] == "expired" and res["message"] == tools.MSG_GRANT_EXPIRED and result["isError"] is False
    last = emu.audit_entries(db, uid)[-1]
    assert (last["decision"], last["reason_code"]) == ("DENY", "EXPIRED")


def test_h8_step_above_cap(db):
    o = owner(db, max_step="answer")
    s = emu.LegacySession(o.secret)
    assert [t["name"] for t in s.post("tools/list").json()["result"]["tools"]] == ["sieve_answer", "sieve_check"]
    result, out = ladder(s, tool="sieve_full_item")
    assert out["status"] == "not-allowed" and result["isError"] is True
    assert out["message"] == "This connection only allows sieve_answer and sieve_check. Use sieve_answer instead."


def test_h9_unknown_link():
    body = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    r = emu.mcp_post(emu.random_secret(), body)
    assert r.status_code == 404 and r.json() == {"error": "unknown_connector"}
    assert emu.mcp_post("abc", body).status_code == 404


def test_h10_declined(db):
    o = owner(db)
    s = emu.LegacySession(o.secret)
    with HomeBaseSim(db, o.uid, o.device, decline("The person chose not to share this.")):
        _, out = ladder(s)
    assert out["status"] == "declined" and out["message"] == "The person chose not to share this."
    assert db.collection(f"users/{o.uid}/receipts").document(out["request_id"]).get().get("status") == "declined"


def test_h11_parallel_calls(db):
    o = owner(db)
    results = []

    def one(i):
        s = emu.LegacySession(o.secret)
        results.append(ladder(s, question=f"Question number {i} about the deposit?")[1])

    with HomeBaseSim(db, o.uid, o.device, answer(PAYLOAD, delay=1)):
        threads = [threading.Thread(target=one, args=(i,)) for i in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    assert [r["status"] for r in results] == ["answered"] * 3
    status = emu.call("getAuditStatus", {}, o.token)
    assert status["intact"] is True and status["truncated"] is False and status["entries"] == 4


def test_h12_open_request_limit(db):
    o = owner(db)
    s = emu.LegacySession(o.secret)
    # nine requests already wait for this connection; one real call takes the tenth slot
    waiting = [put_request(db, o.uid, o.grant["grantId"], status="queued") for _ in range(9)]
    with HomeBaseSim(db, o.uid, o.device, never()):
        tenth = ladder(s, question="Different question 0?")[1]
        over = ladder(s, question="An eleventh question?")[1]
    assert tenth["status"] == "pending"
    assert over["status"] == "error" and "request_id" not in over
    assert over["message"].startswith("At most 10 requests can wait per connection, and 10 are waiting now: ")
    assert all(f"\"{rid}\"" in over["message"] for rid in [*waiting, tenth["request_id"]])
    rate = db.collection("connectors").document(links.link_hash(o.secret)).get().to_dict()
    assert rate["rateRefunds"] > 0.9                 # the refused eleventh call was given back (30 section 11)


def test_h12b_pending_says_when_there_is_nothing_to_approve(db):
    """Still queued or claimed: being prepared on the person's computer, so nothing to approve yet (and after 150 s
    the Sieve tab may be in the background). Only awaiting-person keeps the approval wording."""
    o = owner(db)
    s = emu.LegacySession(o.secret)
    grant = o.grant["grantId"]
    young = put_request(db, o.uid, grant, status="claimed", created_ago=timedelta(seconds=10))
    old = put_request(db, o.uid, grant, status="queued", created_ago=timedelta(seconds=200))
    waiting = put_request(db, o.uid, grant, status="awaiting-person", created_ago=timedelta(seconds=200))
    out = {rid: check(s, rid)[1] for rid in (young, old, waiting)}
    assert all(r["status"] == "pending" and r["request_id"] == rid for rid, r in out.items())
    assert out[young]["message"] == tools.MSG_PREPARING.replace("{id}", young)
    assert out[old]["message"] == tools.MSG_PREPARING_SLOW.replace("{id}", old)
    # a check on a request that waits for the person: not told again, and how long it can still be approved
    assert out[waiting]["message"] == (tools.MSG_PENDING_AGAIN.replace("{id}", waiting)
                                       + tools.MSG_PENDING_LEFT.replace("{left}", "117"))
    # a new question that no home base picks up stays queued: the ladder tool says it is still being prepared
    _, fresh = ladder(s, question="A question nobody prepares?")
    assert fresh["status"] == "pending"
    assert fresh["message"] == tools.MSG_PREPARING.replace("{id}", fresh["request_id"])


def test_h13_modern_header_mismatch(db):
    o = owner(db, online=False)
    r = emu.modern_call(o.secret, "tools/call", {"name": "sieve_answer", "arguments": {"question": "Q"}},
                        headers={"Mcp-Name": "other"})
    assert r.status_code == 400 and r.json()["error"]["code"] == -32020


def test_h14_unknown_tool(db):
    o = owner(db, online=False)
    s = emu.LegacySession(o.secret)
    r = s.post("tools/call", {"name": "delete_everything", "arguments": {}})
    assert r.status_code == 200 and r.json()["error"] == {"code": -32602, "message": "Unknown tool: delete_everything"}
    last = emu.audit_entries(db, o.uid)[-1]
    assert (last["tool_name"], last["decision"], last["reason_code"]) == (
        "delete_everything", "DENY", "CAVEAT_NOT_SATISFIED")


def test_h17_hints(db):
    o = owner(db)
    s = emu.LegacySession(o.secret)
    with HomeBaseSim(db, o.uid, o.device, never()):
        _, out = ladder(s, after="2026-10-01", before="2026-10-31", **{"from": "landlord"})
    docs = emu.requests_of(db, o.uid)
    assert len(docs) == 1
    assert docs[0].get("hints") == {"after": "2026-10-01", "before": "2026-10-31", "from": "landlord"}
    assert docs[0].get("question") == QUESTION
    result, bad = ladder(s, question="Another question?", after="2026-02-30")
    assert bad == {"status": "error",
                   "message": "after must be a real date written as YYYY-MM-DD, for example 2026-10-01."}
    assert result["isError"] is True and len(emu.requests_of(db, o.uid)) == 1
    last = emu.audit_entries(db, o.uid)[-1]
    assert (last["tool_name"], last["decision"]) == ("sieve_answer", "ALLOW")


def test_h18_instructions(db):
    o = owner(db, online=False)
    s = emu.LegacySession(o.secret)
    today = datetime.now(timezone.utc).date()
    assert s.initialize_result["instructions"] == tools.instructions(today, "full")
    r = emu.modern_call(o.secret, "server/discover")
    assert r.status_code == 200 and r.json()["result"]["instructions"] == tools.instructions(today, "full")
    low = owner(db, online=False, max_step="answer")
    text = emu.LegacySession(low.secret).initialize_result["instructions"]
    assert text == tools.instructions(today, "answer")
    assert "sieve_excerpt" not in text and "sieve_full_item" not in text


def test_r_mcp_01_malformed(db):
    o = owner(db, online=False)
    assert emu.mcp_post(o.secret, None, raw=b"{nope").json()["error"]["code"] == -32700
    r = emu.mcp_post(o.secret, [{"jsonrpc": "2.0", "id": 1, "method": "ping"}])
    assert r.status_code == 400 and r.json()["error"]["message"] == "Batching is not supported"
    import requests
    g = requests.get(emu.mcp_url(o.secret), timeout=10)
    assert g.status_code == 405 and g.headers["Allow"] == "POST"
    assert emu.mcp_post(o.secret, None, raw=b" " * 17_000).status_code == 413
    assert emu.mcp_post(o.secret, {"jsonrpc": "2.0", "id": 1, "method": "ping"},
                        {"Content-Type": "text/plain"}).status_code == 415
    r = emu.mcp_post(o.secret, {"jsonrpc": "2.0", "id": None, "method": "ping"})
    assert r.status_code == 400 and r.json()["error"]["code"] == -32600
    r = emu.mcp_post(o.secret, {"jsonrpc": "2.0", "id": 1, "method": "ping"}, {"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_r_mcp_05_question_length_in_utf16_units(db):
    o = owner(db, online=False)
    s = emu.LegacySession(o.secret)
    _, too_long = ladder(s, question="\U0001F382" * 300)
    assert too_long["message"] == "The question must be 1 to 500 characters of plain text."
    _, ok = ladder(s, question="\U0001F382" * 250)
    assert ok["status"] == "offline"


def test_r_mcp_06_dedupe(db):
    o = owner(db)
    outs = {}

    def first():
        outs["a"] = ladder(emu.LegacySession(o.secret))[1]

    with HomeBaseSim(db, o.uid, o.device, never()):
        t = threading.Thread(target=first)
        t.start()
        time.sleep(3)
        outs["b"] = ladder(emu.LegacySession(o.secret), question="  what did my LANDLORD say about the deposit? ")[1]
        t.join()
        outs["c"] = ladder(emu.LegacySession(o.secret), question="When is the rent due?")[1]
    assert outs["a"]["status"] == outs["b"]["status"] == "pending"
    assert outs["a"]["request_id"] == outs["b"]["request_id"] != outs["c"]["request_id"]
    assert len(emu.requests_of(db, o.uid)) == 2
    assert len(list(db.collection("debug_pushes").stream())) == 2


def test_r_mcp_07_foreign_and_unknown_ids(db):
    a = owner(db, online=False)
    b_token = a.token
    other = emu.grant_for(b_token, ai_name="Other AI")
    s_other = emu.LegacySession(emu.secret_from_link(other["link"]))
    _, offline = ladder(s_other)
    foreign_id = emu.requests_of(db, a.uid)[0].id
    s = emu.LegacySession(a.secret)
    for rid in (foreign_id, "Q" * 20):
        _, out = check(s, rid)
        assert out == {"status": "unknown", "message": tools.MSG_UNKNOWN_ID}
    assert offline["status"] == "offline"


def _seed_bucket(db, secret, used):
    ref = db.collection("connectors").document(links.link_hash(secret))
    ref.update({"rateUsed": float(used), "rateRefunds": 0.0, "rateAt": datetime.now(timezone.utc)})
    return ref


def test_r_mcp_08_refused_calls_do_not_count(db):
    o = owner(db, online=False)
    s = emu.LegacySession(o.secret)
    ref = _seed_bucket(db, o.secret, config.RATE_LIMIT_CALLS - 2)
    outs = [check(s, f"{i:020d}")[1] for i in range(6)]
    outs += [ladder(s, question=f"Question {i}?", after="2026-13-01")[1] for i in range(3)]
    assert [x["status"] for x in outs] == ["unknown"] * 6 + ["error"] * 3
    rate = ref.get().to_dict()
    assert rate["rateUsed"] <= config.RATE_LIMIT_CALLS - 2 and 8 < rate["rateRefunds"] <= 9
    assert ladder(s, question="Counted?")[1]["status"] == "offline"          # a real result counts
    assert ref.get().get("rateUsed") > rate["rateUsed"]


def test_r_mcp_08_rate_limit_states_the_real_wait(db):
    o = owner(db, online=False)
    s = emu.LegacySession(o.secret)
    _seed_bucket(db, o.secret, config.RATE_LIMIT_CALLS)
    _, poll = check(s, "Q" * 20)
    assert poll == {"status": "error", "message": "Too many requests from this connection. Wait about 5 seconds, "
                                                  "then try again."}
    ref = _seed_bucket(db, o.secret, config.RATE_LIMIT_CALLS)
    _, out = ladder(s)
    assert out["status"] == "error" and "request_id" not in out
    m = re.fullmatch(r"Too many requests from this connection\. Wait about (\d+) seconds, then try again\.",
                     out["message"])
    wait = int(m.group(1))
    assert wait in (5, 10)
    assert ref.get().get("rateUsed") == config.RATE_LIMIT_CALLS          # the refused call added nothing
    time.sleep(wait)
    assert ladder(s)[1]["status"] == "offline"                           # through after the stated wait
    assert len(emu.requests_of(db, o.uid)) == 1                          # only that call made a request


def test_d6_blocked_and_no_match_look_the_same(db):
    o = owner(db)
    seen = []
    for behaviour in (blocked(), no_match()):
        with HomeBaseSim(db, o.uid, o.device, behaviour):
            t = time.monotonic()
            _, out = ladder(emu.LegacySession(o.secret), question=f"Question for {behaviour.kind}?")
            seen.append((out["status"], out["message"], time.monotonic() - t))
    assert [x[:2] for x in seen] == [("no-match", "Nothing to share for that.")] * 2
    assert all(x[2] >= 5.5 for x in seen)
