"""30 section 17.4: neither the question nor the payload text appears in any emulator log line."""
import os
import pathlib
import time
import uuid

import pytest

from tests.helpers import emulator as emu
from tests.helpers.home_base import HomeBaseSim, answer
from tests.http._setup import check, ladder, owner

LOG = pathlib.Path(os.environ.get("SIEVE_DEBUG_LOG") or emu.REPO_ROOT / "firebase-debug.log")


def _read_from(offset: int) -> str:
    with LOG.open("r", encoding="utf-8", errors="replace") as fh:
        fh.seek(offset)
        return fh.read()


def test_no_content_in_logs(db):
    if not LOG.exists():
        pytest.skip("firebase-debug.log not found (run through firebase emulators:exec from the repo root)")
    start = LOG.stat().st_size
    marker = uuid.uuid4().hex[:12]
    question = f"Where is the parcel {marker} that my sister mailed?"
    payload = f"It arrived on Tuesday, tracking {marker[::-1]}."
    o = owner(db)
    s = emu.LegacySession(o.secret)
    with HomeBaseSim(db, o.uid, o.device, answer(payload, delay=8)):      # H4 shape: pending, then sieve_check
        _, first = ladder(s, question=question)
        _, second = check(s, first["request_id"])
    assert second["text"] == payload
    time.sleep(1.5)
    text = _read_from(start)
    if "mcp_http" not in text:
        pytest.skip("function logs are not written to firebase-debug.log by this CLI version")
    assert marker not in text and marker[::-1] not in text
    # Sieve's own structured lines never carry the link secret (the emulator's routing lines show the path,
    # which production keeps out of Cloud Logging with the exclusion in 30 section 14.3).
    ours = [line for line in text.splitlines() if '\\"event\\"' in line or '"event"' in line]
    assert ours and not any(o.secret in line for line in ours)
