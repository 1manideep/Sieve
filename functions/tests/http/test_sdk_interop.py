"""H2: the official MCP Python SDK (test dependency only) as the client, in all three modes."""
import asyncio

import pytest
from mcp import Client

from tests.helpers import emulator as emu
from tests.helpers.home_base import HomeBaseSim, answer
from tests.http._setup import QUESTION, owner

PAYLOAD = "Your deposit was $1,200."


async def _round_trip(url: str, mode: str):
    async with Client(url, mode=mode, read_timeout_seconds=60) as client:
        listed = await client.list_tools()
        result = await client.call_tool("sieve_answer", {"question": QUESTION})
        return client.protocol_version, [t.name for t in listed.tools], result


@pytest.mark.parametrize("mode, expected_version", [("legacy", "2025-11-25"), ("2026-07-28", "2026-07-28"),
                                                    ("auto", "2026-07-28")])
def test_h2_sdk_interop(db, mode, expected_version):
    o = owner(db)
    with HomeBaseSim(db, o.uid, o.device, answer(PAYLOAD, delay=1)):
        version, names, result = asyncio.run(_round_trip(emu.mcp_url(o.secret), mode))
    assert version == expected_version
    assert names == ["sieve_answer", "sieve_excerpt", "sieve_full_item", "sieve_check"]
    assert result.structured_content["status"] == "answered"
    assert result.structured_content["text"] == PAYLOAD and result.is_error is False
