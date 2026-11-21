"""E9 to E12: admission bucket, cleanup, collect once, payload above the cap; receipts and stale expiry."""
import threading
from datetime import timedelta

import pytest

from sieve import cleanup, config, fb, links, ratelimit, relay, tools
from sieve.models import GrantMeta
from tests.emulator._grants import new_uid, put_request, short_grant


def test_e9_admission_bucket(db, broker_secret):
    uid = new_uid()
    out, link_secret, connector = short_grant(db, uid, broker_secret)
    assert (connector["rateUsed"], connector["rateRefunds"]) == (0.0, 0.0) and "rateCount" not in connector
    lh = links.link_hash(link_secret)
    ref = db.collection("connectors").document(lh)
    now = fb.now()                                  # one instant: no draining between the calls
    results = [ratelimit.admit(db, lh, now) for _ in range(config.RATE_LIMIT_CALLS + 1)]
    assert all(r.allowed for r in results[:-1]) and not results[-1].allowed
    assert results[-1].grant.ai_name == "Test AI" and results[-1].retry_after_seconds == 5
    assert ref.get().get("rateUsed") == config.RATE_LIMIT_CALLS      # the refused call added nothing
    check = ratelimit.admit(db, lh, now, weight=config.CHECK_CALL_WEIGHT)
    assert not check.allowed and check.retry_after_seconds == 5
    assert ratelimit.refund(db, lh, 1.0, now) is True                 # a refused call given back
    assert ref.get().get("rateUsed") == config.RATE_LIMIT_CALLS - 1 and ref.get().get("rateRefunds") == 1
    assert ratelimit.admit(db, lh, now, weight=0.5).allowed and ratelimit.admit(db, lh, now, weight=0.5).allowed
    assert not ratelimit.admit(db, lh, now, weight=0.5).allowed
    later = now + timedelta(seconds=3)              # the stated wait was 5 s; the real one is 3 s
    assert ratelimit.admit(db, lh, later).allowed
    assert ref.get().get("rateUsed") == pytest.approx(config.RATE_LIMIT_CALLS)
    assert db.collection(f"users/{uid}/grants").document(out["grantId"]).get().get("lastUsedAt")
    assert ratelimit.admit(db, "0" * 64, now) is None and ratelimit.refund(db, "0" * 64, 1.0, now) is False


def test_e9b_free_refusals_and_old_fields(db, broker_secret):
    uid = new_uid()
    _, link_secret, _ = short_grant(db, uid, broker_secret)
    lh = links.link_hash(link_secret)
    ref = db.collection("connectors").document(lh)
    now = fb.now()
    for _ in range(config.RATE_LIMIT_FREE_REFUSALS):
        assert ratelimit.admit(db, lh, now).allowed and ratelimit.refund(db, lh, 1.0, now)
    assert ref.get().get("rateUsed") == 0 and ref.get().get("rateRefunds") == config.RATE_LIMIT_FREE_REFUSALS
    assert ratelimit.admit(db, lh, now).allowed and ratelimit.refund(db, lh, 1.0, now) is False
    assert ref.get().get("rateUsed") == 1           # past the free refusals a refused call stays counted
    ref.update({"rateUsed": 0.0, "rateRefunds": 0.0, "rateAt": None, "rateWindowStart": now, "rateCount": 30})
    assert ratelimit.admit(db, lh, now).allowed     # a connector from before the bucket starts empty
    assert ref.get().get("rateUsed") == 1


def test_e10_cleanup(db, broker_secret):
    uid = new_uid()
    out, _, _ = short_grant(db, uid, broker_secret)
    gid = out["grantId"]
    stale_open = put_request(db, uid, gid, created_ago=timedelta(minutes=121))
    stale_answer = put_request(db, uid, gid, status="answered", created_ago=timedelta(minutes=70),
                               answered_ago=timedelta(minutes=61), receipt=True)
    recent_claim = put_request(db, uid, gid, status="claimed", created_ago=timedelta(minutes=30))
    now = fb.now()
    old = db.collection("connectors").document("a" * 64)
    old.set({"uid": uid, "grantId": "X" * 20, "expiresAt": now - timedelta(days=8)})
    young = db.collection("connectors").document("b" * 64)
    young.set({"uid": uid, "grantId": "Y" * 20, "expiresAt": now - timedelta(days=2)})
    report = cleanup.run_cleanup(db, now)
    reqs = db.collection(f"users/{uid}/requests")
    a = reqs.document(stale_open).get().to_dict()
    b = reqs.document(stale_answer).get().to_dict()
    assert a["status"] == "expired" and a["message"] == "The person did not answer in time."
    assert b["status"] == "expired" and "response" not in b
    assert db.collection(f"users/{uid}/receipts").document(stale_answer).get().get("status") == "expired"
    assert reqs.document(recent_claim).get().get("status") == "claimed"
    assert not old.get().exists and young.get().exists
    assert (report.expired_open, report.expired_answered, report.receipts_expired, report.connectors_deleted) == (
        1, 1, 1, 1)


def test_ttl_field_is_set_on_create(db, broker_secret):
    uid = new_uid()
    out, _, _ = short_grant(db, uid, broker_secret)
    grant = GrantMeta.model_validate(db.collection(f"users/{uid}/grants").document(out["grantId"]).get().to_dict())
    ctx = relay.CallCtx(uid=uid, grant_id=out["grantId"], link_hash="h", grant=grant)
    now = fb.now()
    rid = relay.create_request(db, ctx, tool="sieve_answer",
                               args=tools.parse_ladder_args({"question": "Q"}, today=now.date()), status="queued",
                               now=now)
    doc = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
    assert doc["expireAt"] - doc["createdAt"] == timedelta(hours=24) and "hints" not in doc


def test_e11_collect_once(db, broker_secret):
    uid = new_uid()
    out, _, _ = short_grant(db, uid, broker_secret)
    rid = put_request(db, uid, out["grantId"], status="answered")
    got = []
    threads = [threading.Thread(target=lambda: got.append(relay.collect_answer(db, uid, rid, "full", fb.now())))
               for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(g.kind for g in got) == ["delivered", "not-answered"]
    doc = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
    assert doc["status"] == "collected" and "response" not in doc and doc["collectedAt"]


def test_e12_payload_above_cap_is_not_delivered(db, broker_secret):
    uid = new_uid()
    out, _, _ = short_grant(db, uid, broker_secret)
    rid = put_request(db, uid, out["grantId"], status="answered", response_step="full", max_step="excerpt")
    got = relay.collect_answer(db, uid, rid, "excerpt", fb.now())
    assert got.kind == "not-answered"
    doc = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
    assert doc["status"] == "error" and "response" not in doc


def test_mark_receipt_only_from_pending(db, broker_secret):
    uid = new_uid()
    out, _, _ = short_grant(db, uid, broker_secret)
    rid = put_request(db, uid, out["grantId"], status="declined", receipt=True)
    assert relay.mark_receipt(db, uid, rid, "delivered") is False
    assert db.collection(f"users/{uid}/receipts").document(rid).get().get("status") == "declined"
    assert relay.mark_receipt(db, uid, "Z" * 20, "delivered", sleep=lambda s: None) is False


def test_expire_if_stale(db, broker_secret):
    uid = new_uid()
    out, _, _ = short_grant(db, uid, broker_secret)
    rid = put_request(db, uid, out["grantId"], status="awaiting-person", created_ago=timedelta(minutes=125))
    ref = db.collection(f"users/{uid}/requests").document(rid)
    assert relay.expire_if_stale(db, ref, ref.get().to_dict(), fb.now())
    assert ref.get().get("status") == "expired"
    fresh = put_request(db, uid, out["grantId"], status="queued")
    fref = db.collection(f"users/{uid}/requests").document(fresh)
    assert not relay.expire_if_stale(db, fref, fref.get().to_dict(), fb.now())


def test_r_rly_08_collect_rechecks_the_grant(db, broker_secret):
    """A revoke that raced an in-flight call: the answer lands after the revoke's sweep and is never delivered."""
    uid = new_uid()
    out, _, _ = short_grant(db, uid, broker_secret)
    rid = put_request(db, uid, out["grantId"], status="answered", receipt=True)
    db.collection(f"users/{uid}/grants").document(out["grantId"]).update({"revokedAt": fb.now()})
    got = relay.collect_answer(db, uid, rid, "full", fb.now())
    assert got.kind == "revoked"
    doc = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
    assert doc["status"] == "revoked" and "response" not in doc


def test_collect_uses_the_current_grant_step(db, broker_secret):
    uid = new_uid()
    out, _, _ = short_grant(db, uid, broker_secret, step="full")
    rid = put_request(db, uid, out["grantId"], status="answered", response_step="full")
    db.collection(f"users/{uid}/grants").document(out["grantId"]).update({"maxStep": "answer"})
    assert relay.collect_answer(db, uid, rid, "full", fb.now()).kind == "not-answered"
    assert db.collection(f"users/{uid}/requests").document(rid).get().get("status") == "error"
