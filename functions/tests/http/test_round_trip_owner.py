"""WP6 done-when: a real MCP client (the official SDK) completes a relay round trip while a script plays the
home base as the signed-in owner, so every home-base write goes through firestore.rules and the RTDB rules."""
import asyncio

import pytest
from mcp import Client

from tests.helpers import emulator as emu
from tests.helpers.home_base import OwnerHomeBase, RulesDenied
from tests.http._setup import FID, QUESTION

PAYLOAD = "Your landlord said the $1,200 deposit comes back within 30 days of move-out."


def _setup():
    uid, token = emu.sign_up()
    grant = emu.grant_for(token, max_step="full")
    home = OwnerHomeBase(uid, token)
    home.register_device(fid=FID)
    assert home.go_online().ok
    return uid, home, emu.secret_from_link(grant["link"])


async def _ask_then_collect(url: str, mode: str, db, uid: str, home: OwnerHomeBase):
    async with Client(url, mode=mode, read_timeout_seconds=60) as client:
        first = (await client.call_tool("sieve_answer", {"question": QUESTION})).structured_content
        assert first["status"] == "pending"
        rid = first["request_id"]
        data = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
        home.claim(rid)
        home.present(rid)
        home.answer(rid, data, PAYLOAD, step="answer")
        second = (await client.call_tool("sieve_check", {"request_id": rid})).structured_content
        third = (await client.call_tool("sieve_check", {"request_id": rid})).structured_content
        return rid, second, third


@pytest.mark.parametrize("mode", ["legacy", "2026-07-28"])
def test_owner_round_trip(db, mode):
    uid, home, secret = _setup()
    rid, second, third = asyncio.run(_ask_then_collect(emu.mcp_url(secret), mode, db, uid, home))
    assert second == {"status": "answered", "request_id": rid, "step": "answer", "text": PAYLOAD,
                      "message": "The person approved sharing this answer."}
    assert third["status"] == "error" and "already delivered" in third["message"]
    doc = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
    assert doc["status"] == "collected" and "response" not in doc and doc["claimedBy"] == home.device
    assert db.collection(f"users/{uid}/receipts").document(rid).get().get("status") == "delivered"
    assert len(list(db.collection("debug_pushes").stream())) == 1


async def _ask(url: str, question: str) -> str:
    async with Client(url, mode="legacy", read_timeout_seconds=60) as client:
        return (await client.call_tool("sieve_answer", {"question": question})).structured_content["request_id"]


async def _check(url: str, rid: str) -> dict:
    async with Client(url, mode="legacy", read_timeout_seconds=60) as client:
        return (await client.call_tool("sieve_check", {"request_id": rid})).structured_content


def test_owner_revokes_answer_before_collection(db):
    uid, home, secret = _setup()
    url = emu.mcp_url(secret)
    rid = asyncio.run(_ask(url, QUESTION))
    data = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
    home.claim(rid)
    with pytest.raises(RulesDenied):
        home.answer(rid, data, PAYLOAD)              # claimed -> answered skips the person: refused
    home.present(rid)
    home.answer(rid, data, PAYLOAD)
    home.revoke_answer(rid)                          # 01 section 11.6
    doc = db.collection(f"users/{uid}/requests").document(rid).get().to_dict()
    assert doc["status"] == "revoked" and "response" not in doc
    assert db.collection(f"users/{uid}/receipts").document(rid).get().get("status") == "revoked"
    out = asyncio.run(_check(url, rid))
    assert out["status"] == "not-allowed" and "text" not in out
