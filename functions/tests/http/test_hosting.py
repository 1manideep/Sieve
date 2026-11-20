"""The Hosting rewrite /mcp/** -> mcp (30 section 2.4). Runs only when the Hosting emulator serves it
(port 5000 belongs to the AirPlay Receiver on macOS; see SIEVE_HOSTING_BASE)."""
import pytest

from tests.helpers import emulator as emu
from tests.helpers.home_base import HomeBaseSim, answer
from tests.http._setup import owner

pytestmark = pytest.mark.skipif(not emu.hosting_up(), reason="Hosting emulator with the /mcp rewrite not reachable")


def test_round_trip_through_hosting(db):
    o = owner(db)
    s = emu.LegacySession(o.secret, via="hosting")
    with HomeBaseSim(db, o.uid, o.device, answer("Your deposit was $1,200.", delay=1)):
        result = s.call_tool("sieve_answer", {"question": "What did my landlord say about the deposit?"})
    assert emu.structured(result)["status"] == "answered"


def test_unknown_link_through_hosting():
    body = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    assert emu.mcp_post(emu.random_secret(), body, via="hosting").status_code == 404
    assert emu.mcp_post("abc", body, via="hosting").status_code == 404
