"""`run` command rules that need no network: the auto-approve record, one grant per Sieve run, one task list
per set, and the per-call rate-limit record. The MCP connection, the emulator reads and the probe are stood in."""

import argparse
import json
from contextlib import asynccontextmanager

import pytest

from sieve_bench import cli, collect, mcp_client, tasks_path
from sieve_bench.agent import load_tasks
from sieve_bench.cli import main
from sieve_bench.log import read_json, read_jsonl, sha256_file, write_json
from sieve_bench.mcp_client import ToolOutcome

from conftest import FAKE_SCRIPT, FIXTURE_DATA

SECRET_1, SECRET_2 = "s" * 43, "t" * 43
LINK_1 = f"http://127.0.0.1:5001/demo-sieve/us-central1/mcp/{SECRET_1}"
LINK_2 = f"http://127.0.0.1:5001/demo-sieve/us-central1/mcp/{SECRET_2}"
RATE_LIMITED = {"status": "error", "message": "Too many requests from this connection. Wait about 10 seconds, then try again."}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.setattr(cli, "_load_env", lambda: None)
    for name in ("SIEVE_MCP_URL", "SIEVE_MCP_URLS", "SIEVE_AUTO_APPROVE", "SIEVE_PROJECT_ID", "BASELINE_URL"):
        monkeypatch.delenv(name, raising=False)


def run_cli(tmp_path, *args):
    return main(["--data", str(FIXTURE_DATA), "--results", str(tmp_path), "run", *args])


def fake_run_args(*extra):
    return ("--adapter", "fake", "--fake-script", str(FAKE_SCRIPT), *extra)


def existing_run(set_dir, run_id, arm, task_ids, **fields):
    write_json(
        set_dir / "runs" / run_id / "manifest.json",
        {"run_id": run_id, "arm": arm, "tasks": task_ids, "tasks_sha256": sha256_file(tasks_path()), **fields},
    )


@pytest.fixture
def stood_in(monkeypatch):
    """Probe, emulator reads and receipts collection stood in; returns the grant ids handed out."""
    grants = iter(["g-new-1", "g-new-2", "g-new-3"])

    async def probe(url, headers):
        return None

    monkeypatch.setattr(cli, "_probe", probe)
    monkeypatch.setattr(collect, "grant_config", lambda url, project: {"grantId": next(grants), "maxStep": "answer"})
    monkeypatch.setattr(collect, "audit_count", lambda url, project: 0)
    monkeypatch.setattr(collect, "collect_run", lambda url, **kw: {"receipts": [], "requests": []})


def test_a_sieve_run_must_say_whether_auto_approve_was_on(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("SIEVE_MCP_URL", LINK_1)
    assert run_cli(tmp_path, "--arm", "sieve", "--runs", "1", "--set", "s1") == 1
    assert "--auto-approve on|off" in capsys.readouterr().err
    assert not (tmp_path / "s1").exists()
    monkeypatch.setenv("SIEVE_AUTO_APPROVE", "maybe")
    with pytest.raises(SystemExit):
        run_cli(tmp_path, "--arm", "sieve", "--runs", "1", "--set", "s1")


def test_one_grant_per_sieve_run(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("SIEVE_MCP_URL", LINK_1)
    assert run_cli(tmp_path, "--arm", "sieve", "--runs", "3", "--set", "s1", "--auto-approve", "off") == 1
    err = capsys.readouterr().err
    assert "One grant per Sieve run: 3 runs need 3 connector links, and 1 was given" in err
    assert SECRET_1 not in err
    assert not (tmp_path / "s1").exists()


def test_links_come_from_repeated_url_or_sieve_mcp_urls(monkeypatch):
    ns = argparse.Namespace(arm="sieve", url=[LINK_1, LINK_2])
    assert cli._server_urls(ns) == [LINK_1, LINK_2]
    monkeypatch.setenv("SIEVE_MCP_URLS", f"{LINK_1}, {LINK_2}")
    monkeypatch.setenv("SIEVE_MCP_URL", "http://ignored")
    assert cli._server_urls(argparse.Namespace(arm="sieve", url=None)) == [LINK_1, LINK_2]
    with pytest.raises(SystemExit):
        cli._server_urls(argparse.Namespace(arm="baseline", url=[LINK_1, LINK_2]))


def test_a_grant_already_used_in_the_set_is_refused(tmp_path, capsys, stood_in, monkeypatch):
    set_dir = tmp_path / "s1"
    all_ids = [t.id for t in load_tasks(tasks_path())]
    existing_run(set_dir, "s1-sieve-1", "sieve", all_ids, grant={"grantId": "g-new-1"})
    code = run_cli(tmp_path, "--arm", "sieve", "--runs", "1", "--set", "s1", "--auto-approve", "off", "--url", LINK_1, *fake_run_args())
    assert code == 1
    assert "belongs to grant g-new-1, which s1-sieve-1 already used" in capsys.readouterr().err
    assert sorted(p.name for p in (set_dir / "runs").iterdir()) == ["s1-sieve-1"]


def test_run_refuses_to_mix_task_lists_in_one_set(tmp_path, capsys):
    set_dir = tmp_path / "s1"
    existing_run(set_dir, "s1-baseline-1", "baseline", ["T01"])
    assert run_cli(tmp_path, "--arm", "baseline", "--runs", "1", "--set", "s1", *fake_run_args()) == 1
    assert "already has runs with another task list or tasks.json (s1-baseline-1)" in capsys.readouterr().err
    assert sorted(p.name for p in (set_dir / "runs").iterdir()) == ["s1-baseline-1"]


class RateLimitedTools:
    async def list_tools(self):
        return [{"name": n, "description": n, "parameters": {"type": "object", "properties": {}}} for n in ("search_mail", "read_mail")]

    async def call(self, name, args):
        return ToolOutcome(text=json.dumps(RATE_LIMITED), structured=RATE_LIMITED, is_error=True)


def test_a_sieve_rehearsal_records_auto_approve_grants_and_rate_limits(tmp_path, capsys, stood_in, monkeypatch):
    @asynccontextmanager
    async def fake_connect(url, headers=None, timeout=None):
        yield RateLimitedTools()

    monkeypatch.setattr(mcp_client, "connect", fake_connect)
    code = run_cli(
        tmp_path, "--arm", "sieve", "--runs", "2", "--set", "s1", "--auto-approve", "on", "--url", LINK_1, "--url", LINK_2,
        "--tasks", "T01", *fake_run_args(),
    )
    assert code == 0
    captured = capsys.readouterr()
    assert "not a valid measurement (2 Sieve calls were rate-limited (T01))" in captured.err
    assert SECRET_1 not in captured.out + captured.err and SECRET_2 not in captured.out + captured.err
    runs = tmp_path / "s1" / "runs"
    manifests = [read_json(runs / f"s1-sieve-{n}" / "manifest.json") for n in (1, 2)]
    assert [m["auto_approve"] for m in manifests] == [True, True]
    assert [m["grant"]["grantId"] for m in manifests] == ["g-new-1", "g-new-2"]   # one grant per run
    assert manifests[0]["server_url"].endswith("/mcp/<link secret>")
    assert manifests[0]["data"]["placeholder_photos"] == []
    results = [e for e in read_jsonl(runs / "s1-sieve-1" / "transcript.jsonl") if e["ev"] == "tool_result"]
    assert results and all(e["rate_limited"] is True for e in results)
