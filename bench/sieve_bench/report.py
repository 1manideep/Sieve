"""report.md, summary.json, the README block, and the video and Devpost lines (60 section 4.12).

The "no number until measured" rule lives here:
- an arm with no completed run shows "not measured" in every cell, never a number;
- the README block and the `lines` sentences are produced only for a complete set: both arms
  measured on all ten tasks with the real model (a scripted rehearsal never qualifies);
- before any set exists the README block is exactly NOT_MEASURED_BLOCK.
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from . import REPO_DIR
from .agent import SYSTEM_PROMPT, Task
from .count import (
    Canary,
    ItemIndex,
    aggregate,
    baseline_cross_check,
    run_metrics,
    sieve_cross_check,
)
from .dataset import Dataset
from .log import read_json, read_jsonl, run_dirs, write_json

README_START = "<!-- bench:start -->"
README_END = "<!-- bench:end -->"
LINE_MARKER = "<!-- bench -->"
NOT_MEASURED = "not measured"
FULL_TASK_COUNT = 10

NOT_MEASURED_BLOCK = (
    "<!-- bench:start -->\n"
    "### The measured number\n"
    "\n"
    "Not measured yet. The method is described below; results appear here only after the bench has run.\n"
    "<!-- bench:end -->"
)

README_TEMPLATE = """<!-- bench:start -->
### The measured number

Same assistant ({model_id} through the Gemini API, temperature 0), same 10 tasks, same sample data. "Direct access" is a typical mail and files connector: search, then read whole items. Sieve ran at its defaults, with every request approved as proposed. Median of 3 runs each, range in brackets. Measured {date}.

| What crossed into the outside model | Direct access | Sieve |
|---|---|---|
| Characters received | {b.chars} [{b.chars_min} to {b.chars_max}] | {s.chars} [{s.chars_min} to {s.chars_max}] |
| Whole items received | {b.whole} | {s.whole} |
| Excerpts received | {b.excerpts} | {s.excerpts} |
| Answer-only replies | {b.answers} | {s.answers} |
| Item summaries received | {b.summaries} | {s.summaries} |
| Items whose text reached the model | {b.items} | {s.items} |
| Health or Money items whose text reached the model | {b.private} | {s.private} |
| Photos received | {b.photos} | {s.photos} |
| Tasks where the hidden instruction reached the model | {b.inj} of 10 | {s.inj} of 10 |
| Tasks answered correctly | {b.correct} of 10 | {s.correct} of 10 |

{headline}

Method, per-task results and raw logs: [bench/results/{set_id}/report.md](bench/results/{set_id}/report.md).
<!-- bench:end -->"""

HEADLINE_TEMPLATE = (
    "Across the 10 tasks, the outside model received {b.chars} characters through direct access and {s.chars} through Sieve."
)

LINES_TEMPLATES = (
    HEADLINE_TEMPLATE,
    "Through direct access the model received {b.whole} whole items and summaries of {b.summaries} items; "
    "through Sieve it received {s.whole} whole items, {s.excerpts} excerpts and {s.answers} answer-only replies.",
    "Health or Money items whose text reached the model: {b.private} through direct access and {s.private} through Sieve.",
    "The hidden instruction reached the model in {b.inj} of 10 tasks through direct access and in {s.inj} of 10 through Sieve.",
    "Tasks answered correctly: {b.correct} of 10 through direct access and {s.correct} of 10 through Sieve.",
)

APPROVAL_POLICY = """1. Keep the side panel open next to the runner's terminal window.
2. Approve every approvable request at the step the panel selects by default. Never change the step.
3. Approve ask-first requests too, after the warning shows.
4. Never deny an approvable request.
5. Decide within 30 seconds of the badge lighting.
6. If the panel offers only "Open Sieve" (blocked, needs consent, model unavailable), do nothing."""

FAIRNESS = """- Same model, prompt, limits and tasks in both arms; only the connector differs.
- The baseline models a typical connector (search returns summaries, read returns whole items, HTML converted without CSS); it is not any specific product. Its search is generous.
- Sieve ran with a person approving by a written policy; a person who lowers steps would share less, one who raises them more.
- Ten tasks on 46 made-up items is small and synthetic. The bench shows the mechanism and its size on this data, not a general rate.
- Model behaviour varies between runs and model versions; hence 3 runs, medians, ranges and the model id.
- Characters are a proxy for exposure; the table also counts items, private items and photos."""

ROWS = (
    ("Characters received", "chars"),
    ("Whole items received", "whole"),
    ("Excerpts received", "excerpts"),
    ("Answer-only replies", "answers"),
    ("Item summaries received", "summaries"),
    ("Items whose text reached the model", "items"),
    ("Health or Money items whose text reached the model", "private"),
    ("Photos received", "photos"),
    ("Tasks where the hidden instruction reached the model", "inj"),
    ("Tasks answered correctly", "correct"),
)
ARM_LABELS = {"baseline": "Direct access", "sieve": "Sieve"}

# The claims check (60 section 4.12), mirrored from check:repo so tests can prove the generated lines pass.
CLAIM_PATTERNS = (
    re.compile(r"\d[\d,.]*\s*(%|x\b|times\b)", re.IGNORECASE),
    re.compile(r"\b(fewer|less|more|smaller)\b.{0,40}\b(characters|emails|items|data)\b", re.IGNORECASE),
)


class NotMeasured(RuntimeError):
    """Raised instead of printing a number that the bench has not produced."""


# ---- Formatting -----------------------------------------------------------------------------

def fmt(value: Any) -> str:
    if value is None:
        return NOT_MEASURED
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        return f"{value:,.0f}" if value.is_integer() else f"{value:,.1f}"
    return str(value)


class _Arm:
    """Template access `{b.chars}`: formatted values from summary.json only."""

    def __init__(self, data: dict):
        self._data = data

    def __getattr__(self, name: str) -> str:
        if name not in self._data:
            raise NotMeasured(f"summary.json has no value for {name}")
        return fmt(self._data[name])


def human_date(iso: str | None) -> str:
    if not iso:
        return "on an unknown date"
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return f"{d.strftime('%B')} {d.day}, {d.year}"


# ---- Reading a set --------------------------------------------------------------------------

def load_runs(set_dir: Path) -> list[dict]:
    runs = []
    for d in run_dirs(set_dir):
        manifest = read_json(d / "manifest.json")
        receipts_path = d / "receipts.json"
        server_log_path = d / "server-log.jsonl"
        runs.append(
            {
                "dir": d,
                "manifest": manifest,
                "events": read_jsonl(d / "transcript.jsonl"),
                "receipts": read_json(receipts_path) if receipts_path.exists() else None,
                "server_log": read_jsonl(server_log_path) if server_log_path.exists() else None,
            }
        )
    return runs


def compute(set_dir: Path, *, dataset: Dataset, tasks: list[Task], canaries: list[Canary]) -> tuple[dict, dict]:
    """Returns (metrics, summary). metrics has every run; summary has only what the report prints."""
    set_dir = Path(set_dir)
    set_id = set_dir.name
    index = ItemIndex(dataset)
    by_id = {t.id: t for t in tasks}
    run_rows: list[dict] = []
    for run in load_runs(set_dir):
        m = run["manifest"]
        arm = m.get("arm")
        run_tasks = [by_id[t] for t in m.get("tasks", []) if t in by_id]
        metrics = run_metrics(
            run["events"], arm=arm, tasks=run_tasks, dataset=dataset, canaries=canaries, receipts=run["receipts"], index=index
        )
        completed = bool(m.get("ended_at")) and metrics["complete"]
        if arm == "baseline":
            check = baseline_cross_check(run["events"], run["server_log"])
        else:
            check = sieve_cross_check(run["events"], run["receipts"])
        run_rows.append(
            {
                "run_id": m.get("run_id"),
                "arm": arm,
                "adapter": m.get("adapter"),
                "model_id": m.get("model_id"),
                "started_at": m.get("started_at"),
                "ended_at": m.get("ended_at"),
                "completed": completed,
                "metrics": metrics,
                "cross_check": check,
                "transcript": f"runs/{run['dir'].name}/transcript.jsonl",
            }
        )

    arms: dict[str, dict] = {}
    for arm in ARM_LABELS:
        done = [r for r in run_rows if r["arm"] == arm and r["completed"]]
        unfinished = [r["run_id"] for r in run_rows if r["arm"] == arm and not r["completed"]]
        if not done:
            arms[arm] = {"measured": False, "runs": [], "unfinished_runs": unfinished}
            continue
        agg = aggregate([r["metrics"] for r in done])
        agg.update(
            {
                "measured": True,
                "runs": [r["run_id"] for r in done],
                "unfinished_runs": unfinished,
                "rehearsal": any(r["adapter"] != "gemini" for r in done),
                "model_ids": sorted({r["model_id"] for r in done if r["model_id"]}),
            }
        )
        arms[arm] = agg

    measured = [a for a in arms.values() if a["measured"]]
    model_ids = sorted({mid for a in measured for mid in a["model_ids"]})
    ended = [r["ended_at"] for r in run_rows if r["completed"] and r["ended_at"]]
    rehearsal = any(a.get("rehearsal") for a in measured)
    complete = (
        len(measured) == len(ARM_LABELS)
        and not rehearsal
        and len(model_ids) == 1
        and all(a["n_tasks"] == FULL_TASK_COUNT for a in measured)
    )
    summary = {
        "version": 1,
        "set_id": set_id,
        "complete": complete,
        "rehearsal": rehearsal,
        "model_id": model_ids[0] if len(model_ids) == 1 else (", ".join(model_ids) if model_ids else None),
        "date": max(ended) if ended else None,
        "arms": arms,
    }
    summary["b"] = _template_values(arms["baseline"])
    summary["s"] = _template_values(arms["sieve"])
    summary["headline"] = HEADLINE_TEMPLATE.format(b=_Arm(summary["b"]), s=_Arm(summary["s"])) if complete else None
    metrics = {"set_id": set_id, "runs": [_strip_dir(r) for r in run_rows]}
    return metrics, summary


def _strip_dir(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != "dir"}


def _template_values(arm: dict) -> dict:
    if not arm.get("measured"):
        return {}
    keys = ("chars", "chars_min", "chars_max", "whole", "excerpts", "answers", "summaries", "items", "private", "photos", "inj", "correct")
    return {k: arm[k] for k in keys}


# ---- README block and lines ---------------------------------------------------------------

def readme_block(summary: dict) -> str:
    if not summary.get("complete"):
        raise NotMeasured(
            "This set is not a complete measurement (both arms, all 10 tasks, the real model, one model id), "
            "so it cannot fill the README block."
        )
    return README_TEMPLATE.format(
        model_id=summary["model_id"],
        date=human_date(summary["date"]),
        b=_Arm(summary["b"]),
        s=_Arm(summary["s"]),
        headline=summary["headline"],
        set_id=summary["set_id"],
    )


def lines(summary: dict) -> list[str]:
    if not summary.get("complete"):
        raise NotMeasured("No lines: this set is not a complete measurement.")
    b, s = _Arm(summary["b"]), _Arm(summary["s"])
    return [t.format(b=b, s=s) + " " + LINE_MARKER for t in LINES_TEMPLATES]


def replace_readme_block(readme_text: str, block: str) -> str:
    start = readme_text.find(README_START)
    end = readme_text.find(README_END)
    if start < 0 or end < 0 or end < start:
        raise ValueError("README.md has no bench block (<!-- bench:start --> ... <!-- bench:end -->)")
    return readme_text[:start] + block + readme_text[end + len(README_END) :]


def find_claims(text: str) -> list[str]:
    """Lines outside the bench block that look like a measured claim and are not generated lines."""
    out = []
    inside = False
    for line in text.splitlines():
        if README_START in line:
            inside = True
        if not inside and not line.rstrip().endswith(LINE_MARKER):
            if any(p.search(line) for p in CLAIM_PATTERNS):
                out.append(line)
        if README_END in line:
            inside = False
    return out


# ---- report.md ------------------------------------------------------------------------------

def _cell(arm: dict, key: str, n_tasks_suffix: bool = False) -> str:
    if not arm.get("measured"):
        return NOT_MEASURED
    value = fmt(arm[key])
    if key == "chars" and arm.get("n_runs", 0) > 1:
        value += f" [{fmt(arm['chars_min'])} to {fmt(arm['chars_max'])}]"
    if n_tasks_suffix:
        value += f" of {arm['n_tasks']}"
    return value


def comparison_table(summary: dict) -> str:
    arms = summary["arms"]
    out = ["| What crossed into the outside model | Direct access | Sieve |", "|---|---|---|"]
    for label, key in ROWS:
        suffix = key in ("inj", "correct")
        out.append(f"| {label} | {_cell(arms['baseline'], key, suffix)} | {_cell(arms['sieve'], key, suffix)} |")
    return "\n".join(out)


def per_task_table(summary: dict, tasks: list[Task]) -> str:
    arms = summary["arms"]
    out = [
        "| Task | Question | Direct access: chars | items | hidden instruction | correct | Sieve: chars | items | hidden instruction | correct |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for t in tasks:
        cells = []
        for arm in ("baseline", "sieve"):
            a = arms[arm]
            pt = a.get("per_task", {}).get(t.id) if a.get("measured") else None
            if pt is None:
                cells += [NOT_MEASURED, "", "", ""]
            else:
                cells += [fmt(pt["chars"]), fmt(pt["items"]), f"{pt['inj']} of {pt['runs']}", f"{pt['correct']} of {pt['runs']}"]
        out.append(f"| {t.id} | {t.question} | " + " | ".join(cells) + " |")
    return "\n".join(out)


def run_table(metrics: dict) -> str:
    out = [
        "| Run | Arm | Model | Completed | Characters | Whole items | Items reached | Health or Money | Photos | Hidden instruction | Correct | Tool calls | Seconds | Stopped | Transcript |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in metrics["runs"]:
        m = r["metrics"]
        stopped = ", ".join(f"{k}: {v}" for k, v in m["stopped"].items()) or "none"
        out.append(
            f"| {r['run_id']} | {ARM_LABELS.get(r['arm'], r['arm'])} | {r['model_id']} ({r['adapter']}) | {'yes' if r['completed'] else 'no'} | "
            f"{fmt(m['chars'])} | {fmt(m['whole'])} | {fmt(m['items'])} | {fmt(m['private'])} | {fmt(m['photos'])} | "
            f"{m['inj']} of {m['n_tasks']} | {m['correct']} of {m['n_tasks']} | {fmt(m['tool_calls'])} | {fmt(m['seconds'])} | {stopped} | "
            f"[transcript]({r['transcript']}) |"
        )
    return "\n".join(out)


def cross_check_lines(metrics: dict) -> list[str]:
    out = []
    for r in metrics["runs"]:
        c = r["cross_check"]
        if r["arm"] == "baseline":
            if c["ok"] is None:
                out.append(f"- {r['run_id']}: {c.get('note')}; the runner counted {fmt(c['runner_chars'])} characters in {c['runner_calls']} calls.")
            else:
                verdict = "match" if c["ok"] else "MISMATCH"
                out.append(
                    f"- {r['run_id']}: server log {fmt(c['server_chars'])} characters in {c['server_calls']} calls, "
                    f"runner {fmt(c['runner_chars'])} characters in {c['runner_calls']} calls: {verdict}."
                )
        else:
            if c["ok"] is None:
                out.append(f"- {r['run_id']}: {c.get('note')}; {c['answered']} answered results not checked.")
            elif not c["rows"]:
                out.append(f"- {r['run_id']}: no answered results to check.")
            else:
                bad = [row for row in c["rows"] if not row["ok"]]
                verdict = "all match" if not bad else f"{len(bad)} MISMATCH: " + ", ".join(
                    f"{row['request_id']} payload {row['payload_chars']} vs receipt {row['receipt_chars']}" for row in bad
                )
                out.append(f"- {r['run_id']}: {len(c['rows'])} answered payloads against receipts: {verdict}.")
    return out or ["- No runs."]


def report_md(summary: dict, metrics: dict, tasks: list[Task]) -> str:
    arms = summary["arms"]
    parts = [f"# Bench report: {summary['set_id']}", ""]
    if summary["rehearsal"]:
        parts += [
            "**Rehearsal with a scripted model, not a measurement.** These numbers come from a scripted adapter "
            "and never go into the README, the video or the Devpost text.",
            "",
        ]
    for arm, label in ARM_LABELS.items():
        if not arms[arm]["measured"]:
            parts += [f"{label}: not measured (no completed run in this set).", ""]
    parts += [
        "## Method",
        "",
        "For the same tasks, the same model and the same sample data, the runner counts what crosses into the outside "
        "model: the tool results it hands over, logged at that boundary. What Sieve reads on the device is not counted. "
        "Each figure is the median over the completed runs of an arm, with the range for characters.",
        "",
        f"Model: {summary['model_id'] or 'none'}. Last run ended: {human_date(summary['date']) if summary['date'] else 'no completed run'}.",
        "",
        "### Fairness and limits",
        "",
        FAIRNESS,
        "",
        "## What crossed into the outside model",
        "",
        comparison_table(summary),
        "",
    ]
    if summary["headline"]:
        parts += [summary["headline"], ""]
    followed = sorted({t for a in arms.values() if a["measured"] for t in a.get("followed", [])})
    parts += [
        "Hidden instruction followed (flagged automatically, confirm by reading the transcript): "
        + (", ".join(followed) + " flagged" if followed else "not observed")
        + ".",
        "",
        "## Per task (median over runs)",
        "",
        per_task_table(summary, tasks),
        "",
        "## Runs",
        "",
        run_table(metrics),
        "",
        "## Cross-checks",
        "",
        *cross_check_lines(metrics),
        "",
        "## System prompt (identical in both arms)",
        "",
        "```",
        SYSTEM_PROMPT,
        "```",
        "",
        "## Approval policy for Sieve runs (version 1)",
        "",
        APPROVAL_POLICY,
        "",
    ]
    return "\n".join(parts)


def write_report(set_dir: Path, *, dataset: Dataset, tasks: list[Task], canaries: list[Canary]) -> dict:
    set_dir = Path(set_dir)
    metrics, summary = compute(set_dir, dataset=dataset, tasks=tasks, canaries=canaries)
    write_json(set_dir / "metrics.json", metrics)
    write_json(set_dir / "summary.json", summary)
    (set_dir / "report.md").write_text(report_md(summary, metrics, tasks), encoding="utf-8")
    return summary


def update_readme(summary: dict, *, readme: Path | None = None, results: Path) -> Path:
    block = readme_block(summary)  # raises NotMeasured first, before touching any file
    readme = readme or (REPO_DIR / "README.md")
    text = readme.read_text(encoding="utf-8")
    readme.write_text(replace_readme_block(text, block), encoding="utf-8")
    (results / "LATEST").write_text(summary["set_id"] + "\n", encoding="utf-8")
    return readme
