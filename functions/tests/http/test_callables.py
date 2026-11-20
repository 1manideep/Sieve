"""H15, H16 and the callable surface: issueGrant, narrowGrant, revokeGrant, getAuditStatus, deleteAccount,
issuePlaygroundGrant (anonymous)."""
import pytest

from tests.helpers import emulator as emu
from tests.helpers.home_base import HomeBaseSim, answer
from tests.http._setup import QUESTION, ladder


def test_h15_callable_guards():
    _, anon = emu.sign_up(anonymous=True)
    data = {"aiName": "X", "maxStep": "answer", "allowedCategories": ["Home"], "allowedSources": ["gmail"]}
    with pytest.raises(emu.CallableError) as err:
        emu.call("issueGrant", data, anon)
    assert (err.value.status, err.value.message) == ("PERMISSION_DENIED", "Sign in with Google to connect an AI.")
    with pytest.raises(emu.CallableError) as err:
        emu.call("issueGrant", data)
    assert (err.value.status, err.value.message) == ("UNAUTHENTICATED", "Sign in first.")
    _, real = emu.sign_up()
    with pytest.raises(emu.CallableError) as err:
        emu.call("issueGrant", {**data, "days": 91}, real)
    assert err.value.status == "INVALID_ARGUMENT"


def test_issue_narrow_revoke_and_audit(db):
    uid, token = emu.sign_up()
    g = emu.grant_for(token, max_step="full", days=30)
    assert g["link"].startswith("http://127.0.0.1:5000/mcp/") and len(emu.secret_from_link(g["link"])) == 43
    assert g["linkHint"] == g["link"][-4:]
    n = emu.call("narrowGrant", {"grantId": g["grantId"], "maxStep": "excerpt"}, token)
    assert n["maxStep"] == "excerpt" and n["requestsRevoked"] == 0
    with pytest.raises(emu.CallableError) as err:
        emu.call("narrowGrant", {"grantId": g["grantId"], "maxStep": "full"}, token)
    assert err.value.status == "INVALID_ARGUMENT"
    with pytest.raises(emu.CallableError) as err:
        emu.call("narrowGrant", {"grantId": "A" * 20, "maxStep": "answer"}, token)
    assert err.value.status == "NOT_FOUND"
    r = emu.call("revokeGrant", {"grantId": g["grantId"]}, token)
    assert r["grantId"] == g["grantId"] and r["revokedAt"] > 0
    with pytest.raises(emu.CallableError) as err:
        emu.call("narrowGrant", {"grantId": g["grantId"], "maxStep": "answer"}, token)
    assert err.value.status == "FAILED_PRECONDITION"
    status = emu.call("getAuditStatus", {}, token)
    assert status["intact"] and status["entries"] == 3 and status["brokenAtSeq"] is None
    reasons = [e["reason_code"] for e in emu.audit_entries(db, uid)]
    assert reasons == ["GRANT_ISSUED", "GRANT_NARROWED", "GRANT_REVOKED"]
    # another user cannot touch it
    _, other = emu.sign_up()
    with pytest.raises(emu.CallableError) as err:
        emu.call("revokeGrant", {"grantId": g["grantId"]}, other)
    assert err.value.status == "NOT_FOUND"


def test_h16_delete_account(db):
    uid, token = emu.sign_up()
    g = emu.grant_for(token)
    secret = emu.secret_from_link(g["link"])
    emu.set_presence(uid, "device-test-1", True)
    assert emu.call("deleteAccount", {}, token) == {"deleted": True}
    assert not list(db.collection("connectors").stream())
    assert not emu.auth_user_exists(uid)
    assert not db.collection(f"users/{uid}/grants").document(g["grantId"]).get().exists
    assert not list(db.collection(f"audit/{uid}/entries").stream())
    r = emu.mcp_post(secret, {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                              "params": {"name": "sieve_answer", "arguments": {"question": "Q"}}})
    assert r.status_code == 404


def test_playground_grant_round_trip_anonymous(db):
    uid, anon = emu.sign_up(anonymous=True)
    g = emu.call("issuePlaygroundGrant", {}, anon)
    assert g["allowedSources"] == ["playground"] and g["maxStep"] == "full"
    s = emu.LegacySession(emu.secret_from_link(g["link"]))
    with HomeBaseSim(db, uid, "playground-tab-01", answer("The deposit is $1,200.", delay=1)):
        _, out = ladder(s, question=QUESTION)
    assert out["status"] == "answered" and out["text"] == "The deposit is $1,200."
    assert not list(db.collection("debug_pushes").stream())
    r = emu.call("revokeGrant", {"grantId": g["grantId"]}, anon)
    assert r["grantId"] == g["grantId"]
