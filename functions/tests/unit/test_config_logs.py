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
    for raw, expected in (("45", 45), ("120", 50), ("1", 3), ("bad", 45)):
        monkeypatch.setenv("RELAY_WAIT_SECONDS", raw)
        assert config.relay_wait_seconds() == expected


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
