"""Setup shared by the HTTP tests: a signed-in owner with a grant issued through the callable."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tests.helpers import emulator as emu

FID = "cGVyc29uYWwtZmlkLTAx22"
QUESTION = "What did my landlord say about the deposit?"


@dataclass
class Owner:
    uid: str
    token: str
    grant: dict[str, Any]
    secret: str
    device: str | None = None


def owner(db: Any, *, online: bool = True, max_step: str = "full", sources: list[str] | None = None) -> Owner:
    uid, token = emu.sign_up()
    grant = emu.grant_for(token, max_step=max_step, sources=sources)
    o = Owner(uid=uid, token=token, grant=grant, secret=emu.secret_from_link(grant["link"]))
    if online:
        o.device = emu.online_home_base(db, uid, fcm_token=FID)
    return o


def ladder(session: emu.LegacySession, question: str = QUESTION, tool: str = "sieve_answer", **hints: Any):
    result = session.call_tool(tool, {"question": question, **hints})
    return result, emu.structured(result)


def check(session: emu.LegacySession, request_id: str):
    result = session.call_tool("sieve_check", {"request_id": request_id})
    return result, emu.structured(result)
