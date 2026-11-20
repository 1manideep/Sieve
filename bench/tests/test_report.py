import json
from contextlib import asynccontextmanager

import anyio
import pytest

from sieve_bench.agent import Limits, RunPlan, run_tasks
from sieve_bench.baseline_server import build_server
from sieve_bench.fake_adapter import factory_from_script, load_script
from sieve_bench.log import Transcript, base_manifest, now_iso, write_json
from sieve_bench.mcp_client import connect_in_process
from sieve_bench.report import (
    LINE_MARKER,
    NOT_MEASURED,
    NOT_MEASURED_BLOCK,
    NotMeasured,
    comparison_table,
    find_claims,
    lines,
    readme_block,
    replace_readme_block,
    write_report,
)

from conftest import FAKE_SCRIPT, FIXTURES


@pytest.fixture
def summary():
    return json.loads((FIXTURES / "summary-complete.json").read_text())


def test_readme_block_fills_from_summary_json(summary):
    block = readme_block(summary)
    assert block.startswith("<!-- bench:start -->\n### The measured number\n") and block.endswith("<!-- bench:end -->")
    assert "Same assistant (gemini-test-flash through the Gemini API, temperature 0)" in block
    assert "Measured November 24, 2026." in block
    assert "| Characters received | 41,250 [39,870 to 44,102] | 1,630 [1,512 to 1,708] |" in block
    assert "| Tasks where the hidden instruction reached the model | 1 of 10 | 0 of 10 |" in block
    assert "| Tasks answered correctly | 8 of 10 | 9 of 10 |" in block
    assert summary["headline"] in block
    assert "[bench/results/2026-11-24-set1/report.md](bench/results/2026-11-24-set1/report.md)" in block
    assert "{" not in block and "}" not in block


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
    assert "in 1 of 10 tasks through direct access and in 0 of 10 through Sieve" in out[3]


def make_baseline_run(set_dir, dataset, tasks, server_log, *, task_ids):
    set_id = set_dir.name
    run_id = f"{set_id}-baseline-1"
    run_dir = set_dir / "runs" / run_id
    chosen = [t for t in tasks if t.id in task_ids]
    from sieve_bench import canaries_path, tasks_path

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


def test_report_refuses_a_number_for_an_arm_without_completed_runs(dataset, tasks, canaries, tmp_path, server_log):
    set_dir = tmp_path / "2026-11-18-set1"
    make_baseline_run(set_dir, dataset, tasks, server_log, task_ids={"T01"})
    summary = write_report(set_dir, dataset=dataset, tasks=tasks, canaries=canaries)
    assert summary["arms"]["baseline"]["measured"] and not summary["arms"]["sieve"]["measured"]
    assert summary["rehearsal"] and not summary["complete"] and summary["headline"] is None
    assert summary["s"] == {}
    table = comparison_table(summary)
    for row in table.splitlines()[2:]:
        assert row.rstrip(" |").endswith(NOT_MEASURED)
    report = (set_dir / "report.md").read_text()
    assert "Rehearsal with a scripted model, not a measurement." in report
    assert "Sieve: not measured (no completed run in this set)." in report
    assert "[transcript](runs/2026-11-18-set1-baseline-1/transcript.jsonl)" in report
    assert "server log missing" in report        # in-process runs have no server log copy: shown, not hidden
    with pytest.raises(NotMeasured):
        readme_block(summary)


def test_an_unfinished_run_does_not_count(dataset, tasks, canaries, tmp_path, server_log):
    set_dir = tmp_path / "2026-11-18-set2"
    run_dir = make_baseline_run(set_dir, dataset, tasks, server_log, task_ids={"T01", "T02"})
    manifest = json.loads((run_dir / "manifest.json").read_text())
    manifest["ended_at"] = None
    write_json(run_dir / "manifest.json", manifest)
    summary = write_report(set_dir, dataset=dataset, tasks=tasks, canaries=canaries)
    assert not summary["arms"]["baseline"]["measured"]
    assert summary["arms"]["baseline"]["unfinished_runs"] == ["2026-11-18-set2-baseline-1"]
