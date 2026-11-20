"""E9 to E12: admission window, cleanup, collect once, payload above the cap; receipts and stale expiry."""
import threading
from datetime import timedelta

from sieve import cleanup, fb, links, ratelimit, relay, tools
from sieve.models import GrantMeta
from tests.emulator._grants import new_uid, put_request, short_grant


def test_e9_admission_window(db, broker_secret):
    uid = new_uid()
    out, link_secret, _ = short_grant(db, uid, broker_secret)
    lh = links.link_hash(link_secret)
    results = [ratelimit.admit(db, lh, fb.now()) for _ in range(31)]
    assert all(r.allowed for r in results[:30]) and not results[30].allowed
    assert results[30].grant.ai_name == "Test AI" and 0 < results[30].retry_after_seconds <= 600
    db.collection("connectors").document(lh).update({"rateWindowStart": fb.now() - timedelta(minutes=11)})
    assert ratelimit.admit(db, lh, fb.now()).allowed
    assert db.collection(f"users/{uid}/grants").document(out["grantId"]).get().get("lastUsedAt")
    assert ratelimit.admit(db, "0" * 64, fb.now()) is None


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
