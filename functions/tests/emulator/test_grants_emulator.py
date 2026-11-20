"""E1, E4 to E8: issue, revoke, expiry, step caps, narrowing (in-process code on the emulators)."""
import time
from datetime import timedelta

import pytest
from ratchet_core import deserialize_token

from sieve import authz, config, fb, grants, links
from sieve.errors import InputError, LimitReached
from tests.emulator._grants import ALL, connector_of, new_uid, put_request, short_grant
from tests.helpers import emulator as emu


def _authorize(db, secret, uid, link_secret, tool, args=None):
    conn = connector_of(db, link_secret)
    return authz.authorize_call(db, secret=secret, uid=uid, link_hash=links.link_hash(link_secret), connector=conn,
                                link_secret=link_secret, tool_name=tool,
                                args=args if args is not None else {"question": "Q"})


def test_e1_issue_grant(db, broker_secret):
    uid = new_uid()
    out, link_secret, conn = short_grant(db, uid, broker_secret, step="excerpt")
    assert len(link_secret) == 43 and out["link"].endswith("/mcp/" + link_secret)
    assert db.collection("connectors").document(links.link_hash(link_secret)).get().exists
    assert link_secret not in str(conn) and conn["uid"] == uid and conn["grantId"] == out["grantId"]
    kinds = [c.kind.value for c in deserialize_token(conn["token"]).caveats]
    assert kinds == ["bound_to", "expires_at", "tool_name", "resource", "max_depth"]
    grant = db.collection(f"users/{uid}/grants").document(out["grantId"]).get().to_dict()
    assert grant["linkHint"] == link_secret[-4:] and grant["maxStep"] == "excerpt"
    entries = emu.audit_entries(db, uid)
    assert len(entries) == 1 and entries[0]["seq"] == 1 and entries[0]["reason_code"] == "GRANT_ISSUED"
    assert entries[0]["tool_name"] == "sieve.grant.issued"
    assert set(out) == {"grantId", "link", "linkHint", "maxStep", "allowedCategories", "allowedSources", "expiresAt"}


def test_active_grant_limit(db, broker_secret):
    uid = new_uid()
    for _ in range(config.MAX_ACTIVE_GRANTS):
        short_grant(db, uid, broker_secret)
    with pytest.raises(LimitReached):
        short_grant(db, uid, broker_secret)


def test_e4_revoke(db, broker_secret):
    uid = new_uid()
    out, link_secret, conn = short_grant(db, uid, broker_secret)
    gid = out["grantId"]
    queued = put_request(db, uid, gid)
    answered = put_request(db, uid, gid, status="answered", receipt=True)
    res = grants.revoke_grant(db, uid=uid, grant_id=gid, now=fb.now())
    assert res["requestsRevoked"] == 2
    conn = connector_of(db, link_secret)
    assert deserialize_token(conn["token"]).root_id in conn["revokedRootIds"] and conn.get("revokedAt")
    d = _authorize(db, broker_secret, uid, link_secret, "sieve_answer")
    assert (d.allowed, d.reason_code) == (False, "REVOKED")
    last = emu.audit_entries(db, uid)[-1]
    assert last["decision"] == "DENY" and last["reason_code"] == "REVOKED"
    for rid in (queued, answered):
        doc = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
        assert doc["status"] == "revoked" and "response" not in doc
    assert db.collection(f"users/{uid}/receipts").document(answered).get().get("status") == "revoked"
    again = grants.revoke_grant(db, uid=uid, grant_id=gid, now=fb.now())
    assert again["requestsRevoked"] == 0 and again["revokedAt"] == res["revokedAt"]
    reasons = [e["reason_code"] for e in emu.audit_entries(db, uid)]
    assert reasons.count("GRANT_REVOKED") == 1


def test_e5_expired(db, broker_secret):
    uid = new_uid()
    _, link_secret, _ = short_grant(db, uid, broker_secret, ttl_seconds=2)
    time.sleep(3)
    assert _authorize(db, broker_secret, uid, link_secret, "sieve_answer").reason_code == "EXPIRED"


def test_e6_step_cap(db, broker_secret):
    uid = new_uid()
    _, link_secret, _ = short_grant(db, uid, broker_secret, step="answer")
    assert _authorize(db, broker_secret, uid, link_secret, "sieve_excerpt").reason_code == "CAVEAT_NOT_SATISFIED"
    ok = _authorize(db, broker_secret, uid, link_secret, "sieve_check", {"request_id": "a" * 20})
    assert ok.allowed and ok.reason_code == "OK"


def test_e7_narrow(db, broker_secret):
    uid = new_uid()
    out, link_secret, _ = short_grant(db, uid, broker_secret, step="full", ttl_seconds=3 * 86400)
    gid = out["grantId"]
    excerpt_req = put_request(db, uid, gid, tool="sieve_excerpt")
    answer_req = put_request(db, uid, gid, tool="sieve_answer")
    res = grants.narrow_grant(db, uid=uid, req=grants.parse_narrow_request({"grantId": gid, "maxStep": "answer"}),
                              secret=broker_secret, now=fb.now())
    assert (res["requestsRevoked"], res["requestsUpdated"]) == (1, 1) and res["maxStep"] == "answer"
    conn = connector_of(db, link_secret)
    assert len(deserialize_token(conn["token"]).chain) == 2
    assert db.collection(f"users/{uid}/requests").document(excerpt_req).get().get("status") == "revoked"
    assert db.collection(f"users/{uid}/requests").document(answer_req).get().get("maxStep") == "answer"
    assert _authorize(db, broker_secret, uid, link_secret, "sieve_full_item").reason_code == "CAVEAT_NOT_SATISFIED"
    assert _authorize(db, broker_secret, uid, link_secret, "sieve_answer").allowed
    assert "GRANT_NARROWED" in [e["reason_code"] for e in emu.audit_entries(db, uid)]
    # categories and a sooner expiry narrow too
    res = grants.narrow_grant(db, uid=uid, req=grants.parse_narrow_request(
        {"grantId": gid, "allowedCategories": ["Home"], "days": 1}), secret=broker_secret, now=fb.now())
    assert res["allowedCategories"] == ["Home"]
    assert db.collection(f"users/{uid}/requests").document(answer_req).get().get("allowedCategories") == ["Home"]


@pytest.mark.parametrize("change", [{"maxStep": "full"}, {"allowedCategories": ["Health"]}, {"days": 30}])
def test_e8_no_widening(db, broker_secret, change):
    uid = new_uid()
    out, link_secret, before_conn = short_grant(db, uid, broker_secret, step="answer", categories=["Home"],
                                                ttl_seconds=86400)
    gid = out["grantId"]
    before = db.collection(f"users/{uid}/grants").document(gid).get().to_dict()
    with pytest.raises(InputError) as err:
        grants.narrow_grant(db, uid=uid, req=grants.parse_narrow_request({"grantId": gid, **change}),
                            secret=broker_secret, now=fb.now())
    assert str(err.value) == "A connection can only be narrowed. To give more access, make a new connection."
    assert db.collection(f"users/{uid}/grants").document(gid).get().to_dict() == before
    assert connector_of(db, link_secret)["token"] == before_conn["token"]


def test_playground_grant(db, broker_secret):
    uid = new_uid()
    req = grants.parse_playground_request({})
    out = grants.create_grant_records(db, uid=uid, req=req, secret=broker_secret, base_url="http://127.0.0.1:5000",
                                      now=fb.now(), ttl_seconds=req.days * 86400)
    assert out["allowedSources"] == ["playground"] and out["maxStep"] == "full"
    assert out["expiresAt"] - int(fb.now().timestamp() * 1000) <= 86_400_000
