import json
from contextlib import asynccontextmanager

import anyio
import pytest

from sieve_bench import canaries_path, tasks_path
from sieve_bench.agent import Limits, RunPlan, run_tasks
from sieve_bench.baseline_server import build_server
from sieve_bench.cli import main
from sieve_bench.fake_adapter import factory_from_script, load_script
from sieve_bench.log import Transcript, base_manifest, now_iso, write_json, write_jsonl
from sieve_bench.mcp_client import connect_in_process
from sieve_bench.report import (
    APPROVAL_LINES,
    LINE_MARKER,
    NOT_MEASURED,
    NOT_MEASURED_BLOCK,
    NotMeasured,
    SetError,
    comparison_table,
    compute,
    find_claims,
    lines,
    readme_block,
    replace_readme_block,
    write_report,
)

from conftest import FAKE_SCRIPT, FIXTURE_DATA, FIXTURES

PERSON = "Sieve ran at its defaults, with a person approving every request as proposed."


@pytest.fixture
def summary():
    return json.loads((FIXTURES / "summary-complete.json").read_text())


def test_readme_block_fills_from_summary_json(summary):
    block = readme_block(summary)
    assert block.startswith("<!-- bench:start -->\n### The measured number\n") and block.endswith("<!-- bench:end -->")
    assert "Same assistant (gemini-test-flash through the Gemini API, temperature 0)" in block
    assert f"search, then read whole items. {PERSON} Median of 3 runs each, range in brackets." in block
    assert "Measured November 24, 2026." in block
    assert "| Characters received | 41,250 [39,870 to 44,102] | 1,630 [1,512 to 1,708] |" in block
    assert "| Items whose verbatim text reached the model | 33 | 1 |" in block
    assert "| Health or Money items whose content reached the model (verbatim or as an approved answer) | 6 | 1 |" in block
    assert "| Health or Money items listed in search results | 4 | 0 |" in block
    assert "| Tasks where the hidden instruction reached the model | 1 of 10 | 0 of 10 |" in block
    assert "| Tasks answered correctly | 8 of 10 | 9 of 10 |" in block
    assert summary["headline"] in block
    assert "[bench/results/2026-11-24-set1/report.md](bench/results/2026-11-24-set1/report.md)" in block
    assert "{" not in block and "}" not in block


def test_readme_block_prints_the_real_run_count_and_who_approved(summary):
    five = readme_block(summary | {"n_runs": 5, "runs_required": 5})
    assert "Median of 5 runs each" in five and "Median of 3" not in five
    auto = readme_block(summary | {"approval": "auto", "approval_line": APPROVAL_LINES["auto"]})
    assert APPROVAL_LINES["auto"] in auto
    assert "a person approving every request" not in auto
    with pytest.raises(NotMeasured):
        readme_block(summary | {"approval_line": None})
    with pytest.raises(NotMeasured):
        readme_block({k: v for k, v in summary.items() if k != "n_runs"})


def test_the_not_measured_block_is_exact():
    assert NOT_MEASURED_BLOCK == (
        "<!-- bench:start -->\n### The measured number\n\n"
        "Not measured yet. The method is described below; results appear here only after the bench has run.\n"
        "<!-- bench:end -->"
    )


def test_incomplete_or_rehearsal_sets_never_fill_the_readme_or_lines(summary):
    for change in ({"complete": False}, {"complete": False, "rehearsal": True}):
        s = summary | change
        with pytest.raises(NotMeasured):
            readme_block(s)
        with pytest.raises(NotMeasured):
            lines(s)
    with pytest.raises(NotMeasured, match="Sieve has 2 counted runs"):
        readme_block(summary | {"complete": False, "incomplete_reasons": ["Sieve has 2 counted runs; exactly 3 are needed"]})


def test_replace_readme_block():
    readme = "# Sieve\n\nIntro.\n\n" + NOT_MEASURED_BLOCK + "\n\nMore.\n"
    out = replace_readme_block(readme, "<!-- bench:start -->\nNEW\n<!-- bench:end -->")
    assert out == "# Sieve\n\nIntro.\n\n<!-- bench:start -->\nNEW\n<!-- bench:end -->\n\nMore.\n"
    with pytest.raises(ValueError):
        replace_readme_block("# No block here\n", "x")


def test_claims_regexes_catch_the_examples_and_pass_the_generated_lines(summary):
    claims = [
        "Sieve sends 90% less data to the model.",
        "The model saw 5x fewer emails.",
        "It shares 3 times less than a connector.",
        "Far fewer characters leave your device.",
        "Sieve shares much smaller items.",
    ]
    for c in claims:
        assert find_claims(c) == [c]
    generated = lines(summary)
    assert all(line.endswith(LINE_MARKER) for line in generated)
    text = "\n".join(["# Sieve", "Give AI the answer, not your inbox.", *generated, readme_block(summary)])
    assert find_claims(text) == []
    # without the marker the same sentences are caught
    stripped = [line.removesuffix(" " + LINE_MARKER) for line in generated]
    assert find_claims("Sieve shares 40% fewer emails than direct access.\n" + stripped[0]) != []


def test_lines_are_filled_only_from_summary_json(summary):
    out = lines(summary)
    assert out[0] == (
        "Across the 10 tasks, the outside model received 41,250 characters through direct access and 1,630 through Sieve. "
        + LINE_MARKER
    )
    assert out[2].startswith("Health or Money items whose content reached the model (verbatim or as an approved answer): 6 through")
    assert "in 1 of 10 tasks through direct access and in 0 of 10 through Sieve" in out[3]


# ---- Sets on disk ---------------------------------------------------------------------------

def make_baseline_run(set_dir, dataset, tasks, server_log, *, task_ids):
    set_id = set_dir.name
    run_id = f"{set_id}-baseline-1"
    run_dir = set_dir / "runs" / run_id
    chosen = [t for t in tasks if t.id in task_ids]

    manifest = base_manifest(
        run_id=run_id, set_id=set_id, arm="baseline", model_id="fake-scripted", adapter="fake", data_root=dataset.root,
        data_sha256="0" * 64, tasks_file=tasks_path(), canaries_file=canaries_path(), system_prompt="p",
        limits=Limits().to_dict(), task_ids=[t.id for t in chosen], server_url="in-process",
    )
    write_json(run_dir / "manifest.json", manifest)
    server = build_server(dataset)

    @asynccontextmanager
    async def tools_factory(rid):
        async with connect_in_process(server) as tools:
            yield tools

    plan = RunPlan("baseline", set_dir, run_id, chosen, factory_from_script(load_script(FAKE_SCRIPT)), tools_factory)
    anyio.run(run_tasks, plan, Transcript(run_dir / "transcript.jsonl"))
    manifest["ended_at"] = now_iso()
    write_json(run_dir / "manifest.json", manifest)
    return run_dir


GOOD_ANSWER = {
    "T01": "The $1,200 deposit was paid on March 3.", "T02": "Yes: dogs under 40 pounds, with a $300 fee.",
    "T03": "It leaves at 7:45 on December 4.", "T04": "It is due November 28.", "T05": "I could not find your test results.",
    "T06": "Pay a $2 redelivery fee.", "T07": "It was July 4.", "T08": "PR #212.", "T09": "Order 88231.",
    "T10": "I could not find a wifi password.",
}


def write_run(
    set_dir, arm, n, tasks, *, task_ids=None, adapter="gemini", model_id="gemini-test-flash", ended=True,
    auto_approve=False, trouble=None, grant_id=None, placeholders=None, tasks_sha256=None,
):
    """A synthetic run folder: one model turn and a final answer per task, no tool calls. `trouble` maps a task id
    to "error", "timeout", "offline" or "rate-limited"."""
    set_id = set_dir.name
    run_id = f"{set_id}-{arm}-{n}"
    run_dir = set_dir / "runs" / run_id
    chosen = [t for t in tasks if task_ids is None or t.id in task_ids]
    manifest = base_manifest(
        run_id=run_id, set_id=set_id, arm=arm, model_id=model_id, adapter=adapter, data_root=FIXTURE_DATA,
        data_sha256="0" * 64, tasks_file=tasks_path(), canaries_file=canaries_path(), system_prompt="p",
        limits=Limits().to_dict(), task_ids=[t.id for t in chosen], server_url="http://127.0.0.1/mcp",
        extra={"auto_approve": auto_approve, "grant": {"grantId": grant_id or f"g-{n}"}} if arm == "sieve" else None,
    )
    if tasks_sha256:
        manifest["tasks_sha256"] = tasks_sha256
    if placeholders is not None:
        manifest["data"]["placeholder_photos"] = placeholders
    if ended:
        manifest["ended_at"] = now_iso()
    events = []
    trouble = trouble or {}
    for t in chosen:
        events.append({"ev": "task_start", "run": run_id, "arm": arm, "task": t.id, "ts": 0})
        kind = trouble.get(t.id)
        if kind in ("offline", "rate-limited"):
            data = (
                {"status": "offline", "message": "Sieve is not open on the person's computer right now."}
                if kind == "offline"
                else {"status": "error", "message": "Too many requests from this connection. Wait about 10 seconds, then try again."}
            )
            text = json.dumps(data)
            events.append({"ev": "tool_result", "task": t.id, "call_id": "c", "tool": "sieve_answer", "text": text, "chars": len(text),
                           "images": [], "status": data["status"], "step": None, "ms": 1, "structured": data,
                           "rate_limited": kind == "rate-limited"})
        stopped = kind if kind in ("error", "timeout") else None
        final = None if stopped else GOOD_ANSWER[t.id]
        events.append({"ev": "model_turn", "task": t.id, "n": 1, "text": final, "calls": [], "usage": {"input": 10, "output": 2}})
        events.append({"ev": "task_end", "task": t.id, "final": final, "stopped": stopped, "tool_calls": 0, "ms": 100})
    write_json(run_dir / "manifest.json", manifest)
    write_jsonl(run_dir / "transcript.jsonl", events)
    return run_id


def full_set(set_dir, tasks, *, baseline=3, sieve=3, **kw):
    for n in range(1, baseline + 1):
        write_run(set_dir, "baseline", n, tasks)
    for n in range(1, sieve + 1):
        write_run(set_dir, "sieve", n, tasks, **kw)


def report(set_dir, dataset, tasks, canaries, **kw):
    return compute(set_dir, dataset=dataset, tasks=tasks, canaries=canaries, **kw)


def test_a_complete_set_fills_the_readme_with_its_run_count(dataset, tasks, canaries, tmp_path):
    set_dir = tmp_path / "2026-11-24-set1"
    full_set(set_dir, tasks)
    _, summary = report(set_dir, dataset, tasks, canaries)
    assert summary["complete"] and summary["incomplete_reasons"] == []
    assert summary["n_runs"] == 3 and summary["approval"] == "person" and summary["approval_line"] == PERSON
    assert summary["arms"]["baseline"]["n_runs"] == 3 and summary["arms"]["sieve"]["correct"] == 10
    block = readme_block(summary)
    assert f"{PERSON} Median of 3 runs each" in block

    two = tmp_path / "2026-11-24-set2"
    full_set(two, tasks, baseline=2, sieve=2)
    _, s2 = report(two, dataset, tasks, canaries, runs_required=2)
    assert s2["complete"] and "Median of 2 runs each" in readme_block(s2)


def test_too_few_or_too_many_runs_never_fill_the_readme(dataset, tasks, canaries, tmp_path):
    few = tmp_path / "few"
    full_set(few, tasks, baseline=2, sieve=3)
    _, s = report(few, dataset, tasks, canaries)
    assert not s["complete"] and s["n_runs"] is None
    assert s["incomplete_reasons"] == ["Direct access has 2 counted runs; exactly 3 are needed"]
    with pytest.raises(NotMeasured, match="Direct access has 2 counted runs"):
        readme_block(s)
    many = tmp_path / "many"
    full_set(many, tasks, baseline=4, sieve=3)
    _, s = report(many, dataset, tasks, canaries)
    assert s["incomplete_reasons"] == ["Direct access has 4 counted runs; exactly 3 are needed"]


def test_a_run_counts_only_if_it_covers_every_task(dataset, tasks, canaries, tmp_path):
    set_dir = tmp_path / "partial"
    full_set(set_dir, tasks)
    # A run that planned all ten tasks but ended only two of them.
    run_id = write_run(set_dir, "sieve", 4, tasks)
    path = set_dir / "runs" / run_id / "transcript.jsonl"
    keep = [line for line in path.read_text().splitlines() if json.loads(line)["task"] in ("T01", "T02")]
    path.write_text("\n".join(keep) + "\n")
    metrics, s = report(set_dir, dataset, tasks, canaries)
    assert s["complete"] and s["arms"]["sieve"]["n_runs"] == 3
    assert s["arms"]["sieve"]["excluded_runs"] == {run_id: ["it covers 2 of 10 tasks"]}


def test_mixed_task_sets_are_refused(dataset, tasks, canaries, tmp_path, capsys):
    set_dir = tmp_path / "mixed"
    full_set(set_dir, tasks)
    write_run(set_dir, "baseline", 4, tasks, task_ids={"T01"})
    with pytest.raises(SetError, match="mixes task sets"):
        report(set_dir, dataset, tasks, canaries)
    other = tmp_path / "other-tasks-json"
    full_set(other, tasks)
    write_run(other, "baseline", 4, tasks, tasks_sha256="f" * 64)
    with pytest.raises(SetError, match="tasks.json ffffffffffff"):
        report(other, dataset, tasks, canaries)
    # The CLI refuses too, and writes nothing.
    code = main(["--data", str(FIXTURE_DATA), "--results", str(tmp_path), "report", "--set", "mixed", "--update-readme"])
    assert code == 1 and "mixes task sets" in capsys.readouterr().err
    assert not (set_dir / "report.md").exists() and not (set_dir / "summary.json").exists()


def test_invalid_runs_are_left_out_with_the_reason(dataset, tasks, canaries, tmp_path):
    set_dir = tmp_path / "invalid"
    full_set(set_dir, tasks)
    bad = {
        write_run(set_dir, "sieve", 4, tasks, trouble={"T04": "error"}): ["T04 stopped with an error"],
        write_run(set_dir, "sieve", 5, tasks, trouble={"T03": "timeout"}): ["T03 timed out"],
        write_run(set_dir, "sieve", 6, tasks, trouble={"T01": "offline"}): ["1 Sieve result was offline (T01)"],
        write_run(set_dir, "sieve", 7, tasks, trouble={"T02": "rate-limited", "T08": "rate-limited"}): ["2 Sieve calls were rate-limited (T02, T08)"],
        write_run(set_dir, "sieve", 8, tasks, ended=False): ["it did not finish (no end time in its manifest)"],
    }
    summary = write_report(set_dir, dataset=dataset, tasks=tasks, canaries=canaries)
    assert summary["complete"] and summary["arms"]["sieve"]["n_runs"] == 3
    assert summary["arms"]["sieve"]["excluded_runs"] == bad
    assert any("rate-limited in invalid-sieve-7 (2)" in f for f in summary["flags"])
    md = (set_dir / "report.md").read_text()
    assert "- invalid-sieve-4: left out because T04 stopped with an error." in md
    assert "- invalid-sieve-7: left out because 2 Sieve calls were rate-limited (T02, T08)." in md
    assert "Counted here: direct access 3, Sieve 3." in md


def test_the_auto_approve_setting_is_recorded_and_printed(dataset, tasks, canaries, tmp_path):
    on = tmp_path / "on"
    full_set(on, tasks, auto_approve=True)
    summary = write_report(on, dataset=dataset, tasks=tasks, canaries=canaries)
    assert summary["complete"] and summary["approval"] == "auto"
    block = readme_block(summary)
    assert APPROVAL_LINES["auto"] in block and "a person approving every request" not in block
    md = (on / "report.md").read_text()
    assert "Web app auto-approve switch: on in every counted Sieve run" in md
    assert "Sieve ran with the web app's auto-approve testing switch on" in md
    assert "Sieve ran with a person approving" not in md
    assert "| on | [transcript]" in md

    off = tmp_path / "off"
    full_set(off, tasks, auto_approve=False)
    write_report(off, dataset=dataset, tasks=tasks, canaries=canaries)
    md = (off / "report.md").read_text()
    assert "Web app auto-approve switch: off in every counted Sieve run" in md
    assert "Sieve ran with a person approving by a written policy and the web app's auto-approve switch off" in md

    mixed = tmp_path / "mixed-approval"
    full_set(mixed, tasks, sieve=2, auto_approve=False)
    write_run(mixed, "sieve", 3, tasks, auto_approve=True)
    _, s = report(mixed, dataset, tasks, canaries)
    assert not s["complete"] and s["approval_line"] is None
    assert "the counted Sieve runs mix auto-approve on and off" in s["incomplete_reasons"]

    unknown = tmp_path / "unknown"
    full_set(unknown, tasks, auto_approve=None)
    _, s = report(unknown, dataset, tasks, canaries)
    assert not s["complete"]
    assert any("no record of whether the web app's auto-approve switch was on" in r for r in s["incomplete_reasons"])


def test_placeholder_photos_and_shared_grants_are_flagged(dataset, tasks, canaries, tmp_path):
    set_dir = tmp_path / "flags"
    for n in (1, 2, 3):
        write_run(set_dir, "baseline", n, tasks, placeholders=["IMG_4821.jpg"])
        write_run(set_dir, "sieve", n, tasks, grant_id="same-grant" if n < 3 else "g-3", placeholders=["IMG_4821.jpg"])
    summary = write_report(set_dir, dataset=dataset, tasks=tasks, canaries=canaries)
    assert summary["placeholder_photos"] == ["IMG_4821.jpg"]
    md = (set_dir / "report.md").read_text()
    assert "1 sample photo is still a placeholder (IMG_4821.jpg; check:repo warns about them)" in md
    assert "Runs flags-sieve-1, flags-sieve-2 used the same grant (same-grant)" in md


def test_report_refuses_a_number_for_an_arm_without_counted_runs(dataset, tasks, canaries, tmp_path, server_log):
    set_dir = tmp_path / "2026-11-18-set1"
    make_baseline_run(set_dir, dataset, tasks, server_log, task_ids={"T01"})
    summary = write_report(set_dir, dataset=dataset, tasks=tasks, canaries=canaries)
    # One task of ten: the run is listed, but it does not count, so neither arm has a number.
    assert not summary["arms"]["baseline"]["measured"] and not summary["arms"]["sieve"]["measured"]
    assert summary["arms"]["baseline"]["excluded_runs"] == {"2026-11-18-set1-baseline-1": ["it covers 1 of 10 tasks"]}
    assert summary["rehearsal"] and not summary["complete"] and summary["headline"] is None
    assert summary["s"] == {} and summary["b"] == {}
    table = comparison_table(summary)
    for row in table.splitlines()[2:]:
        assert row.rstrip(" |").endswith(NOT_MEASURED)
    report_text = (set_dir / "report.md").read_text()
    assert "Rehearsal with a scripted model, not a measurement." in report_text
    assert "Sieve: not measured (no counted run in this set)." in report_text
    assert "[transcript](runs/2026-11-18-set1-baseline-1/transcript.jsonl)" in report_text
    assert "server log missing" in report_text        # in-process runs have no server log copy: shown, not hidden
    with pytest.raises(NotMeasured):
        readme_block(summary)


def test_an_unfinished_run_does_not_count(dataset, tasks, canaries, tmp_path, server_log):
    set_dir = tmp_path / "2026-11-18-set2"
    run_dir = make_baseline_run(set_dir, dataset, tasks, server_log, task_ids={t.id for t in tasks})
    manifest = json.loads((run_dir / "manifest.json").read_text())
    manifest["ended_at"] = None
    write_json(run_dir / "manifest.json", manifest)
    summary = write_report(set_dir, dataset=dataset, tasks=tasks, canaries=canaries)
    assert not summary["arms"]["baseline"]["measured"]
    assert summary["arms"]["baseline"]["excluded_runs"] == {
        "2026-11-18-set2-baseline-1": ["it did not finish (no end time in its manifest)"]
    }
