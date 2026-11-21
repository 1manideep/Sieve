"""Request id first, safe retries, statuses and the pending limit, in-process against the Firestore emulator
(30 sections 8.6, 9.4 and 9.7; 70 R-MCP-06, R-MCP-07, R-MCP-11). The creating transaction runs for real here."""
from __future__ import annotations

import threading
import time
from datetime import timedelta
from typing import Any

from google.cloud import firestore

from sieve import fb, mcp_server, relay, tools
from sieve.models import GrantMeta
from tests.emulator._grants import new_uid, put_request, short_grant
from tests.helpers import emulator as emu

Q = "What did my landlord say about the deposit?"
PAYLOAD = "Your deposit was $1,200."
FID = "cGVyc29uYWwtZmlkLTAx22"
ONLINE = {"device-test-1": {"state": "online", "isHomeBase": True}}


class Pushes:
    def __init__(self) -> None:
        self.request_ids: list[str] = []

    def send(self, targets, payload, *, uid: str, request_id: str):
        self.request_ids.append(request_id)
        return [None for _ in targets]


class Setup:
    def __init__(self, db: Any, secret: bytes, *, step: str = "full") -> None:
        self.db = db
        self.uid = new_uid()
        out, _, _ = short_grant(db, self.uid, secret, step=step)
        self.grant_id = out["grantId"]
        grant = GrantMeta.model_validate(db.collection(f"users/{self.uid}/grants").document(self.grant_id).get()
                                         .to_dict())
        self.ctx = relay.CallCtx(uid=self.uid, grant_id=self.grant_id, link_hash="h", grant=grant)
        emu.add_device(db, self.uid, "device-test-1", FID)
        self.presence: dict | None = ONLINE
        self.pushes = Pushes()
        self.deps = mcp_server.Deps(db=db, presence=lambda uid: self.presence, push=self.pushes,
                                    secret=lambda: secret, wait_seconds=lambda: 1, now=fb.now,
                                    monotonic=time.monotonic, sleep=time.sleep)

    def ask(self, question: str = Q, tool: str = "sieve_answer", **extra: Any):
        args = tools.parse_ladder_args({"question": question, **extra}, today=fb.now().date())
        return relay.handle_ladder_tool(self.deps, self.ctx, tool=tool, args=args, t0=time.monotonic())

    def check(self, request_id: str):
        return relay.handle_check(self.deps, self.ctx, request_id, t0=time.monotonic())

    def docs(self) -> list[Any]:
        return emu.requests_of(self.db, self.uid)

    def ref(self, rid: str):
        return self.db.collection(f"users/{self.uid}/requests").document(rid)

    def approve(self, rid: str, text: str = PAYLOAD) -> None:
        """The home base's answer: the request update and its receipt in one batch (30 section 9.1)."""
        data = self.ref(rid).get().to_dict()
        batch = self.db.batch()
        batch.update(self.ref(rid), {"status": "answered", "answeredAt": fb.now(),
                                     "response": {"step": "answer", "text": text, "chars": len(text), "itemCount": 1}})
        batch.set(self.db.collection(f"users/{self.uid}/receipts").document(rid), {
            "id": rid, "requestId": rid, "requester": data["requester"], "question": data["question"],
            "step": "answer", "itemRefs": ["a" * 64], "status": "pending-collection", "decidedBy": "app",
            "chars": len(text), "createdAt": firestore.SERVER_TIMESTAMP})
        batch.commit()


def test_retry_with_the_same_arguments_returns_the_existing_request(db, broker_secret):
    s = Setup(db, broker_secret)
    t = time.monotonic()
    first = s.ask()
    assert time.monotonic() - t < 5                           # pending with the id, not a long hold
    assert first.status == "pending" and first.request_id
    rid = first.request_id
    again = s.ask("  what did my LANDLORD say   about the deposit? ")
    assert (again.status, again.request_id) == ("pending", rid)
    assert len(s.docs()) == 1 and s.pushes.request_ids == [rid]   # no second card, no second push
    doc = s.ref(rid).get().to_dict()
    assert doc["idempotencyKey"] == relay.request_key(s.grant_id, "sieve_answer",
                                                      tools.parse_ladder_args({"question": Q}, today=fb.now().date()))

    # the person approves while the assistant's connection is broken; the retry finds the answer
    s.approve(rid)
    found = s.ask()
    assert (found.status, found.request_id, found.text) == ("answered", rid, PAYLOAD)
    doc = s.ref(rid).get().to_dict()
    assert doc["status"] == "collected" and "response" not in doc
    assert db.collection(f"users/{s.uid}/receipts").document(rid).get().get("status") == "delivered"

    # delivered once: sieve_check says so, and asking again without a key makes a new request
    assert s.check(rid).to_wire() == {"status": "error", "request_id": rid, "message": tools.MSG_COLLECTED}
    fresh = s.ask()
    assert fresh.status == "pending" and fresh.request_id != rid
    assert len(s.docs()) == 2 and s.pushes.request_ids == [rid, fresh.request_id]


def test_other_hints_or_tool_make_a_new_request(db, broker_secret):
    s = Setup(db, broker_secret)
    a = s.ask()
    b = s.ask(**{"from": "landlord"})
    c = s.ask(tool="sieve_excerpt")
    assert len({a.request_id, b.request_id, c.request_id}) == 3 and len(s.docs()) == 3


def test_client_key(db, broker_secret):
    s = Setup(db, broker_secret)
    first = s.ask(idempotency_key="ask-1")
    rid = first.request_id
    assert first.status == "pending" and s.ask(idempotency_key="ask-1").request_id == rid
    s.approve(rid)
    assert s.ask(idempotency_key="ask-1").status == "answered"
    # with a key, a finished request is reused too: delivered once, then "already delivered"
    assert s.ask(idempotency_key="ask-1").to_wire() == {"status": "error", "request_id": rid,
                                                        "message": tools.MSG_COLLECTED}
    # the same key for another question is refused, and nothing is created
    reused = s.ask("When is the rent due?", idempotency_key="ask-1")
    assert reused.to_wire() == {"status": "error", "message": tools.MSG_KEY_REUSED} and len(s.docs()) == 1
    # a new key asks the same question again on purpose
    again = s.ask(idempotency_key="ask-2")
    assert again.status == "pending" and again.request_id != rid and len(s.docs()) == 2
    # a declined request with a key returns the decline, without a new card
    third = s.ask("When is the rent due?", idempotency_key="ask-3")
    s.ref(third.request_id).update({"status": "declined", "message": "Not this one."})
    out = s.ask("When is the rent due?", idempotency_key="ask-3")
    assert out.to_wire() == {"status": "declined", "request_id": third.request_id, "message": "Not this one."}
    assert len(s.docs()) == 3
    raw = [d.to_dict() for d in s.docs()]
    assert all(len(d["idempotencyKey"]) == 64 for d in raw) and "ask-1" not in str(raw)


def test_parallel_retries_make_one_request(db, broker_secret):
    s = Setup(db, broker_secret)
    outs: list[Any] = []
    threads = [threading.Thread(target=lambda: outs.append(s.ask())) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert [o.status for o in outs] == ["pending"] * 4
    assert len({o.request_id for o in outs}) == 1 and len(s.docs()) == 1 and len(s.pushes.request_ids) == 1


def test_offline_and_errors_are_not_reused(db, broker_secret):
    s = Setup(db, broker_secret)
    s.presence = None
    assert s.ask().to_wire() == {"status": "offline", "message": tools.MSG_OFFLINE}
    assert [d.get("status") for d in s.docs()] == ["offline"]
    s.presence = ONLINE                                        # the person opened Sieve; asking again works
    back = s.ask()
    assert back.status == "pending" and len(s.docs()) == 2
    s.ref(back.request_id).update({"status": "error", "message": "Sieve could not read that email."})
    retry = s.ask()
    assert retry.status == "pending" and retry.request_id != back.request_id and len(s.docs()) == 3


def test_pending_limit_lists_the_waiting_ids(db, broker_secret):
    s = Setup(db, broker_secret)
    waiting = [s.ask(f"Different question {i}?").request_id for i in range(10)]
    over = s.ask("An eleventh question?")
    assert over.status == "error" and over.request_id is None
    assert over.message.startswith("At most 10 requests can wait per connection, and 10 are waiting now: ")
    assert over.message.endswith(". Call sieve_check on those first, then ask again.")
    assert all(f"\"{rid}\"" in over.message for rid in waiting)
    assert len(s.docs()) == 10
    # a retry of a waiting question still finds its request at the limit
    assert s.ask("Different question 0?").request_id == waiting[0]


def test_an_approved_answer_not_yet_collected_holds_no_slot(db, broker_secret):
    s = Setup(db, broker_secret)
    for _ in range(10):
        put_request(db, s.uid, s.grant_id, status="answered")
    assert s.ask("One more question?").status == "pending"


def test_check_statuses(db, broker_secret):
    s = Setup(db, broker_secret)
    other = Setup(db, broker_secret)
    foreign = other.ask().request_id
    for rid in (foreign, "Q" * 20):
        assert s.check(rid).to_wire() == {"status": "unknown", "message": tools.MSG_UNKNOWN_ID}
    stale = put_request(db, s.uid, s.grant_id, status="awaiting-person", created_ago=timedelta(minutes=125))
    assert s.check(stale).to_wire() == {"status": "expired", "request_id": stale,
                                        "message": tools.MSG_REQUEST_EXPIRED}
    counted = put_request(db, s.uid, s.grant_id, status="claimed")
    say = "Sieve answers about one item at a time, so it cannot count emails."
    s.ref(counted).update({"status": "unsupported", "message": say})
    assert s.check(counted).to_wire() == {"status": "unsupported", "request_id": counted, "message": say}


def test_unsupported_ends_the_wait(db, broker_secret):
    s = Setup(db, broker_secret)
    s.deps.wait_seconds = lambda: 15
    holder: dict[str, Any] = {}

    def ask() -> None:
        holder["out"] = s.ask("How many emails did my landlord send?")

    t = threading.Thread(target=ask)
    started = time.monotonic()
    t.start()
    for _ in range(50):
        docs = s.docs()
        if docs:
            break
        time.sleep(0.1)
    s.ref(docs[0].id).update({"status": "unsupported"})
    t.join()
    assert time.monotonic() - started < 10
    assert holder["out"].to_wire() == {"status": "unsupported", "request_id": docs[0].id,
                                       "message": tools.MSG_UNSUPPORTED}
