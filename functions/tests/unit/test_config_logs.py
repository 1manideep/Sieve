"""Config helpers and U12: logs never carry content."""
import json

import pytest

from sieve import config, logs


def test_utf16_len_counts_code_units():
    assert config.utf16_len("abc") == 3
    assert config.utf16_len("\U0001F382") == 2          # one emoji, two units
    assert config.utf16_len("日本") == 2        # BMP characters, one unit each


def test_broker_secret_validation(monkeypatch):
    monkeypatch.setenv("RATCHET_BROKER_SECRET", "ab" * 32)
    assert config.broker_secret_bytes() == bytes.fromhex("ab" * 32)
    for bad in ("AB" * 32, "ab" * 31, "zz" * 32, ""):
        monkeypatch.setenv("RATCHET_BROKER_SECRET", bad)
        with pytest.raises(config.ConfigError):
            config.broker_secret_bytes()


def test_relay_wait_clamped(monkeypatch):
    for raw, expected in (("45", 20), ("120", 20), ("6", 6), ("1", 3), ("bad", 20)):
        monkeypatch.setenv("RELAY_WAIT_SECONDS", raw)
        assert config.relay_wait_seconds() == expected


def test_call_budget_constants():
    """Request id first: every wait and the last collect fit inside the 25 s budget, below 30 s gateways."""
    assert (config.SHORT_WAIT_SECONDS, config.CHECK_WAIT_SECONDS, config.REPLY_DEADLINE_SECONDS) == (15, 20, 25)
    assert config.SHORT_WAIT_SECONDS <= config.WAIT_CAP_SECONDS
    assert config.CHECK_WAIT_SECONDS <= config.WAIT_CAP_SECONDS < config.COLLECT_CUTOFF_SECONDS
    assert config.COLLECT_CUTOFF_SECONDS + 2 <= config.REPLY_DEADLINE_SECONDS <= 25
    assert config.IDEMPOTENCY_WINDOW_SECONDS == 600 and config.IDEMPOTENCY_KEY_MAX_CHARS == 64


def test_public_base_url_trims(monkeypatch):
    monkeypatch.setenv("SIEVE_PUBLIC_BASE_URL", "https://example.test/")
    assert config.public_base_url() == "https://example.test"


def test_u12_unknown_fields_are_dropped(capsys):
    logs.log_event("tool_call", grant="g1", question="What did my landlord say about the deposit?", status="ok")
    out = capsys.readouterr().out
    assert "landlord" not in out
    lines = [json.loads(line) for line in out.strip().splitlines()]
    assert any(l.get("event") == "log_field_dropped" and l.get("field") == "question" for l in lines)
    main = [l for l in lines if l.get("event") == "tool_call"][0]
    assert main["grant"] == "g1" and "question" not in main


def test_log_exception_has_no_message(capsys):
    try:
        raise ValueError("secret question text")
    except ValueError as exc:
        logs.log_exception("relay_error", exc)
    err = capsys.readouterr().err
    assert "secret question text" not in err and "ValueError" in err and "test_config_logs.py:" in err


def test_strings_are_cut():
    kept, _ = logs._keep({"reason": "x" * 200})
    assert len(kept["reason"]) == 64
