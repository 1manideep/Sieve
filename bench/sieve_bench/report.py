"""report.md, summary.json, the README block, and the video and Devpost lines (60 section 4.12).

The "no number until measured" rule lives here:
- a run counts only if it finished, covers every task in tasks.json and is valid: no task stopped with an
  error or timed out, no Sieve result was offline, no Sieve call was rate-limited. Every other run is
  listed in report.md with the reason it was left out;
- an arm with no counted run shows "not measured" in every cell, never a number;
- the README block and the `lines` sentences are produced only for a complete set: exactly N counted runs
  per arm (N is 3 unless `report --runs` says otherwise), the real model, one model id, and Sieve runs that
  all record the same auto-approve setting. A scripted rehearsal never qualifies;
- a set whose runs were planned with different task lists or different tasks.json files is refused;
- before any set exists the README block is exactly NOT_MEASURED_BLOCK.
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from . import DEFAULT_RUNS_PER_ARM, REPO_DIR
from .agent import SYSTEM_PROMPT, Task
from .count import (
    ATTRIBUTION_KINDS,
    Canary,
    ItemIndex,
    aggregate,
    baseline_cross_check,
    run_metrics,
    sieve_cross_check,
)
from .dataset import Dataset, placeholder_photos
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

# Who approved the Sieve requests, from the run manifests' `auto_approve` (the operator records it with
# `run --auto-approve on|off` or SIEVE_AUTO_APPROVE). "A person approved" is said only when it was off.
APPROVAL_LINES = {
    "person": "Sieve ran at its defaults, with a person approving every request as proposed.",
    "auto": (
        "Sieve ran at its defaults with the web app's auto-approve testing switch on: clean answer-only requests "
        "were approved without a person, the rest by a person as proposed."
    ),
}

README_TEMPLATE = """<!-- bench:start -->
### The measured number

Same assistant ({model_id} through the Gemini API, temperature 0), same 10 tasks, same sample data. "Direct access" is a typical mail and files connector: search, then read whole items. {approval_line} Median of {n_runs} runs each, range in brackets. Measured {date}.

| What crossed into the outside model | Direct access | Sieve |
|---|---|---|
| Characters received | {b.chars} [{b.chars_min} to {b.chars_max}] | {s.chars} [{s.chars_min} to {s.chars_max}] |
| Whole items received | {b.whole} | {s.whole} |
| Excerpts received | {b.excerpts} | {s.excerpts} |
| Answer-only replies | {b.answers} | {s.answers} |
| Item summaries received | {b.summaries} | {s.summaries} |
| Items whose verbatim text reached the model | {b.items} | {s.items} |
| Health or Money items whose content reached the model (verbatim or as an approved answer) | {b.private} | {s.private} |
| Health or Money items listed in search results | {b.private_listed} | {s.private_listed} |
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
    "Health or Money items whose content reached the model (verbatim or as an approved answer): "
    "{b.private} through direct access and {s.private} through Sieve.",
    "The hidden instruction reached the model in {b.inj} of 10 tasks through direct access and in {s.inj} of 10 through Sieve.",
    "Tasks answered correctly: {b.correct} of 10 through direct access and {s.correct} of 10 through Sieve.",
)

APPROVAL_POLICY = """1. Keep the side panel open next to the runner's terminal window.
2. Approve every approvable request at the step the panel selects by default. Never change the step.
3. Approve ask-first requests too, after the warning shows.
4. Never deny an approvable request.
5. Decide within 30 seconds of the badge lighting.
6. If the panel offers only "Open Sieve" (blocked, needs consent, model unavailable), do nothing."""

APPROVAL_FAIRNESS = {
    "person": "Sieve ran with a person approving by a written policy and the web app's auto-approve switch off; "
    "a person who lowers steps would share less, one who raises them more.",
    "auto": "Sieve ran with the web app's auto-approve testing switch on: clean answer-only requests were approved "
    "without a person, the rest by a person following the written policy. A person who lowers steps would share "
    "less, one who raises them more.",
    None: "The Sieve runs do not all record the same auto-approve setting, so this report does not say who approved.",
}

ROWS = (
    ("Characters received", "chars"),
    ("Whole items received", "whole"),
    ("Excerpts received", "excerpts"),
    ("Answer-only replies", "answers"),
    ("Item summaries received", "summaries"),
    ("Items whose verbatim text reached the model", "items"),
    ("Health or Money items whose content reached the model (verbatim or as an approved answer)", "private"),
    ("Health or Money items listed in search results", "private_listed"),
    ("Photos received", "photos"),
    ("Tasks where the hidden instruction reached the model", "inj"),
    ("Tasks answered correctly", "correct"),
)
ARM_LABELS = {"baseline": "Direct access", "sieve": "Sieve"}
ATTRIBUTION_WORDS = {
    "receipt": "by the receipt's item ids",
    "verbatim": "by shared wording with an item",
    "task": "to the task's own item (an answer-only reply, matched by the task)",
    "none": "to no item",
}

# The claims check (60 section 4.12), mirrored from check:repo so tests can prove the generated lines pass.
CLAIM_PATTERNS = (
    re.compile(r"\d[\d,.]*\s*(%|x\b|times\b)", re.IGNORECASE),
    re.compile(r"\b(fewer|less|more|smaller)\b.{0,40}\b(characters|emails|items|data)\b", re.IGNORECASE),
)


class NotMeasured(RuntimeError):
    """Raised instead of printing a number that the bench has not produced."""


class SetError(ValueError):
    """The run set cannot be reported as one measurement (its runs were planned with different task sets)."""


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


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


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


def task_signature(manifest: dict) -> tuple[tuple[str, ...], str | None]:
    """What a run set out to measure: its planned task list and the tasks.json it read."""
    return tuple(manifest.get("tasks") or ()), manifest.get("tasks_sha256")


def check_task_sets(manifests: list[dict]) -> None:
    """Raises SetError when the runs were planned with different task lists or tasks.json files."""
    groups: dict[tuple, list[str]] = {}
    for m in manifests:
        groups.setdefault(task_signature(m), []).append(str(m.get("run_id")))
    if len(groups) <= 1:
        return
    parts = [
        f"{', '.join(ids)} planned {', '.join(task_ids) or 'no tasks'} (tasks.json {sha[:12] if sha else 'unknown'})"
        for (task_ids, sha), ids in groups.items()
    ]
    raise SetError(
        "This set mixes task sets, so its runs did not measure the same thing: "
        + "; ".join(parts)
        + ". Keep one task list per set: move the other runs into a set of their own."
    )


def sieve_approval(rows: list[dict]) -> tuple[str | None, str | None]:
    """("person" or "auto", None), or (None, the problem) when the counted Sieve runs disagree or did not record it."""
    if not rows:
        return None, None
    missing = [r["run_id"] for r in rows if r["auto_approve"] is None]
    if missing:
        return None, f"{', '.join(missing)}: no record of whether the web app's auto-approve switch was on"
    values = {bool(r["auto_approve"]) for r in rows}
    if len(values) > 1:
        return None, "the counted Sieve runs mix auto-approve on and off"
    return ("auto" if values.pop() else "person"), None


def _flags(run_rows: list[dict], placeholders: list[str]) -> list[str]:
    flags: list[str] = []
    by_grant: dict[str, list[str]] = {}
    for r in run_rows:
        if r["arm"] == "sieve" and r["grant_id"]:
            by_grant.setdefault(r["grant_id"], []).append(r["run_id"])
    for grant_id, ids in sorted(by_grant.items()):
        if len(ids) > 1:
            flags.append(
                f"Runs {', '.join(ids)} used the same grant ({grant_id}). Use one grant per Sieve run, so the "
                "per-connection rate limit starts fresh each run."
            )
    no_grant = [r["run_id"] for r in run_rows if r["arm"] == "sieve" and r["grant_error"]]
    if no_grant:
        flags.append(f"The grant could not be read from the emulator for {', '.join(no_grant)}, so one grant per run is not checked there.")
    limited = [f"{r['run_id']} ({r['metrics']['rate_limited']})" for r in run_rows if r["metrics"].get("rate_limited")]
    if limited:
        flags.append(f"Sieve calls were rate-limited in {', '.join(limited)}. Those runs are left out.")
    unattributed = sum(r["metrics"].get("attribution", {}).get("none", 0) for r in run_rows if r["counted"])
    if unattributed:
        flags.append(
            f"{unattributed} approved Sieve {_plural(unattributed, 'answer', 'answers')} in counted runs could not be "
            f"matched to an item, so {_plural(unattributed, 'it does', 'they do')} not count toward Health or Money "
            "items. Read those transcripts."
        )
    if placeholders:
        flags.append(
            f"{len(placeholders)} sample {_plural(len(placeholders), 'photo is', 'photos are')} still a placeholder "
            f"({', '.join(placeholders)}; check:repo warns about them). Photo tasks such as T07 may give other results "
            "once the real pictures are in."
        )
    return flags


def compute(
    set_dir: Path,
    *,
    dataset: Dataset,
    tasks: list[Task],
    canaries: list[Canary],
    runs_required: int = DEFAULT_RUNS_PER_ARM,
) -> tuple[dict, dict]:
    """Returns (metrics, summary). metrics has every run; summary has only what the report prints.

    `tasks` is all of tasks.json: a run counts only if it covers every one of them."""
    if runs_required < 1:
        raise ValueError("runs_required must be at least 1")
    set_dir = Path(set_dir)
    set_id = set_dir.name
    index = ItemIndex(dataset)
    runs = load_runs(set_dir)
    check_task_sets([r["manifest"] for r in runs])
    run_rows: list[dict] = []
    for run in runs:
        m = run["manifest"]
        arm = m.get("arm")
        metrics = run_metrics(
            run["events"], arm=arm, tasks=tasks, dataset=dataset, canaries=canaries, receipts=run["receipts"], index=index
        )
        excluded: list[str] = []
        if not m.get("ended_at"):
            excluded.append("it did not finish (no end time in its manifest)")
        if not metrics["complete"]:
            excluded.append(f"it covers {metrics['tasks_ended']} of {metrics['tasks_expected']} tasks")
        excluded += metrics["problems"]
        if arm == "baseline":
            check = baseline_cross_check(run["events"], run["server_log"])
        else:
            check = sieve_cross_check(run["events"], run["receipts"])
        grant = m.get("grant") if isinstance(m.get("grant"), dict) else {}
        run_rows.append(
            {
                "run_id": m.get("run_id"),
                "arm": arm,
                "adapter": m.get("adapter"),
                "model_id": m.get("model_id"),
                "started_at": m.get("started_at"),
                "ended_at": m.get("ended_at"),
                "counted": not excluded,
                "excluded": excluded,
                "auto_approve": m.get("auto_approve") if arm == "sieve" else None,
                "grant_id": grant.get("grantId"),
                "grant_error": grant.get("error"),
                "metrics": metrics,
                "cross_check": check,
                "transcript": f"runs/{run['dir'].name}/transcript.jsonl",
            }
        )

    arms: dict[str, dict] = {}
    for arm in ARM_LABELS:
        rows = [r for r in run_rows if r["arm"] == arm]
        counted = [r for r in rows if r["counted"]]
        base = {
            "n_runs": len(counted),
            "runs": [r["run_id"] for r in counted],
            "excluded_runs": {r["run_id"]: r["excluded"] for r in rows if not r["counted"]},
        }
        if not counted:
            arms[arm] = {"measured": False, **base}
            continue
        agg = aggregate([r["metrics"] for r in counted])
        agg.update(
            {
                "measured": True,
                **base,
                "rehearsal": any(r["adapter"] != "gemini" for r in counted),
                "model_ids": sorted({r["model_id"] for r in counted if r["model_id"]}),
            }
        )
        arms[arm] = agg

    counted_rows = [r for r in run_rows if r["counted"]]
    model_ids = sorted({r["model_id"] for r in counted_rows if r["model_id"]})
    ended = [r["ended_at"] for r in counted_rows if r["ended_at"]]
    rehearsal = any(r["adapter"] != "gemini" for r in run_rows)
    approval, approval_problem = sieve_approval([r for r in counted_rows if r["arm"] == "sieve"])
    recorded = [r["manifest"].get("data", {}).get("placeholder_photos") for r in runs]
    recorded_lists = [x for x in recorded if isinstance(x, list)]
    placeholders = sorted({p for x in recorded_lists for p in x}) if recorded_lists else placeholder_photos(dataset.root)

    reasons: list[str] = []
    if len(tasks) != FULL_TASK_COUNT:
        reasons.append(f"tasks.json has {len(tasks)} tasks, not {FULL_TASK_COUNT}")
    for arm, label in ARM_LABELS.items():
        n = arms[arm]["n_runs"]
        if n != runs_required:
            reasons.append(
                f"{label} has {n} counted {_plural(n, 'run', 'runs')}; exactly {runs_required} "
                f"{_plural(runs_required, 'is', 'are')} needed"
            )
    if rehearsal:
        reasons.append("the set has runs made with the scripted adapter (a rehearsal)")
    if len(model_ids) > 1:
        reasons.append(f"the counted runs used more than one model ({', '.join(model_ids)})")
    elif counted_rows and not model_ids:
        reasons.append("the counted runs record no model id")
    if approval_problem:
        reasons.append(approval_problem)
    complete = not reasons

    summary = {
        "version": 2,
        "set_id": set_id,
        "complete": complete,
        "incomplete_reasons": reasons,
        "rehearsal": rehearsal,
        "model_id": model_ids[0] if len(model_ids) == 1 else (", ".join(model_ids) if model_ids else None),
        "date": max(ended) if ended else None,
        "runs_required": runs_required,
        "n_runs": runs_required if complete else None,
        "approval": approval,
        "approval_line": APPROVAL_LINES.get(approval) if approval else None,
        "placeholder_photos": placeholders,
        "flags": _flags(run_rows, placeholders),
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
    keys = (
        "chars", "chars_min", "chars_max", "whole", "excerpts", "answers", "summaries", "items", "private",
        "private_listed", "photos", "inj", "correct",
    )
    return {k: arm[k] for k in keys}


# ---- README block and lines ---------------------------------------------------------------

def _not_complete(summary: dict, what: str) -> NotMeasured:
    reasons = summary.get("incomplete_reasons") or []
    why = ("; ".join(reasons) + ".") if reasons else "it is not a complete measurement."
    return NotMeasured(f"{what}: {why}")


def _required(summary: dict, key: str) -> Any:
    value = summary.get(key)
    if value is None:
        raise NotMeasured(f"summary.json has no value for {key}")
    return value


def readme_block(summary: dict) -> str:
    if not summary.get("complete"):
        raise _not_complete(summary, "This set cannot fill the README block")
    return README_TEMPLATE.format(
        model_id=summary["model_id"],
        approval_line=_required(summary, "approval_line"),
        n_runs=int(_required(summary, "n_runs")),
        date=human_date(summary["date"]),
        b=_Arm(summary["b"]),
        s=_Arm(summary["s"]),
        headline=summary["headline"],
        set_id=summary["set_id"],
    )


def lines(summary: dict) -> list[str]:
    if not summary.get("complete"):
        raise _not_complete(summary, "No lines")
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
        "| Task | Question | Direct access: chars | verbatim items | hidden instruction | correct | Sieve: chars | verbatim items | hidden instruction | correct |",
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


def _auto_approve_cell(row: dict) -> str:
    if row["arm"] != "sieve":
        return ""
    if row["auto_approve"] is None:
        return "not recorded"
    return "on" if row["auto_approve"] else "off"


def run_table(metrics: dict) -> str:
    out = [
        "| Run | Arm | Model | Counted | Characters | Whole items | Verbatim items | Health or Money | Photos | Hidden instruction | Correct | Tool calls | Seconds | Stopped | Offline results | Rate-limited calls | Auto-approve | Transcript |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in metrics["runs"]:
        m = r["metrics"]
        stopped = ", ".join(f"{k}: {v}" for k, v in m["stopped"].items()) or "none"
        out.append(
            f"| {r['run_id']} | {ARM_LABELS.get(r['arm'], r['arm'])} | {r['model_id']} ({r['adapter']}) | {'yes' if r['counted'] else 'no'} | "
            f"{fmt(m['chars'])} | {fmt(m['whole'])} | {fmt(m['items'])} | {fmt(m['private'])} | {fmt(m['photos'])} | "
            f"{m['inj']} of {m['n_tasks']} | {m['correct']} of {m['n_tasks']} | {fmt(m['tool_calls'])} | {fmt(m['seconds'])} | {stopped} | "
            f"{fmt(m.get('offline', 0))} | {fmt(m.get('rate_limited', 0))} | {_auto_approve_cell(r)} | [transcript]({r['transcript']}) |"
        )
    return "\n".join(out)


def excluded_lines(metrics: dict) -> list[str]:
    out = [f"- {r['run_id']}: left out because " + "; ".join(r["excluded"]) + "." for r in metrics["runs"] if not r["counted"]]
    return out or ["- None. Every run in this set counts."]


def attribution_lines(metrics: dict) -> list[str]:
    totals = {k: 0 for k in ATTRIBUTION_KINDS}
    for r in metrics["runs"]:
        if r["counted"] and r["arm"] == "sieve":
            for k in ATTRIBUTION_KINDS:
                totals[k] += r["metrics"].get("attribution", {}).get(k, 0)
    if not any(totals.values()):
        return ["- No approved Sieve answers in the counted runs."]
    return [f"- {totals[k]} matched {ATTRIBUTION_WORDS[k]}." for k in ATTRIBUTION_KINDS if totals[k]]


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


def fairness(summary: dict) -> str:
    n = summary.get("runs_required") or DEFAULT_RUNS_PER_ARM
    approval = summary.get("approval")
    bullets = [
        "Same model, prompt, limits and tasks in both arms; only the connector differs.",
        "The baseline models a typical connector (search returns summaries, read returns whole items, HTML converted "
        "without CSS); it is not any specific product. Its search is generous.",
        APPROVAL_FAIRNESS.get(approval, APPROVAL_FAIRNESS[None]),
        "Ten tasks on 46 made-up items is small and synthetic. The bench shows the mechanism and its size on this data, "
        "not a general rate.",
        f"Model behaviour varies between runs and model versions; hence {n} runs per arm, medians, ranges and the model id.",
        "Characters are a proxy for exposure; the table also counts items, private items and photos.",
    ]
    return "\n".join(f"- {b}" for b in bullets)


def report_md(summary: dict, metrics: dict, tasks: list[Task]) -> str:
    arms = summary["arms"]
    n = summary.get("runs_required") or DEFAULT_RUNS_PER_ARM
    parts = [f"# Bench report: {summary['set_id']}", ""]
    if summary["rehearsal"]:
        parts += [
            "**Rehearsal with a scripted model, not a measurement.** These numbers come from a scripted adapter "
            "and never go into the README, the video or the Devpost text.",
            "",
        ]
    if not summary["complete"]:
        parts += [
            "**Not a complete measurement.** This set cannot fill the README block or the lines: "
            + "; ".join(summary.get("incomplete_reasons") or ["unknown"])
            + ".",
            "",
        ]
    for arm, label in ARM_LABELS.items():
        if not arms[arm]["measured"]:
            parts += [f"{label}: not measured (no counted run in this set).", ""]
    approval = summary.get("approval")
    approval_text = {
        "person": "off in every counted Sieve run. A person approved every request by the written policy.",
        "auto": "on in every counted Sieve run (a testing mode). Clean answer-only requests were approved without a person.",
    }.get(approval, "not recorded the same way in every counted Sieve run.")
    parts += [
        "## Method",
        "",
        "For the same tasks, the same model and the same sample data, the runner counts what crosses into the outside "
        "model: the tool results it hands over, logged at that boundary. What Sieve reads on the device is not counted. "
        "Each figure is the median over the counted runs of an arm, with the range for characters.",
        "",
        f"A run counts only if it finished, covers all {len(tasks)} tasks in tasks.json, and is valid: no task stopped "
        "with an error or timed out, no Sieve result was offline, and no Sieve call was rate-limited. "
        f"The README needs exactly {n} counted runs per arm. Counted here: direct access {arms['baseline']['n_runs']}, "
        f"Sieve {arms['sieve']['n_runs']}.",
        "",
        f"Model: {summary['model_id'] or 'none'}. Last counted run ended: {human_date(summary['date']) if summary['date'] else 'no counted run'}.",
        "",
        f"Web app auto-approve switch: {approval_text}",
        "",
        "Items whose verbatim text reached the model: items read whole, plus items sharing two eight-word runs with "
        "any received text. Search listings are counted on their own rows. Health or Money items whose content "
        "reached the model adds the items that approved Sieve answers came from, so a paraphrased answer counts too.",
        "",
        "### Fairness and limits",
        "",
        fairness(summary),
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
        "## Flags",
        "",
        *([f"- {f}" for f in summary.get("flags") or []] or ["- None."]),
        "",
        "## Per task (median over counted runs)",
        "",
        per_task_table(summary, tasks),
        "",
        "## Runs",
        "",
        run_table(metrics),
        "",
        "### Runs left out",
        "",
        *excluded_lines(metrics),
        "",
        "### Approved Sieve answers and their items (counted runs)",
        "",
        *attribution_lines(metrics),
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


def write_report(
    set_dir: Path,
    *,
    dataset: Dataset,
    tasks: list[Task],
    canaries: list[Canary],
    runs_required: int = DEFAULT_RUNS_PER_ARM,
) -> dict:
    set_dir = Path(set_dir)
    metrics, summary = compute(set_dir, dataset=dataset, tasks=tasks, canaries=canaries, runs_required=runs_required)
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
