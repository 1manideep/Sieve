"""`python -m sieve_bench <command>` (60 section 4.4)."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import anyio

from . import (
    ARMS,
    BENCH_DIR,
    DEFAULT_BASELINE_PORT,
    DEFAULT_BASELINE_URL,
    DEFAULT_DEMO_PORT,
    canaries_path,
    results_dir,
    server_log_path,
    tasks_path,
)


def _load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover
        return
    load_dotenv(BENCH_DIR / ".env", override=False)


def _fail(message: str, code: int = 1) -> int:
    print(message, file=sys.stderr)
    return code


def _dataset(path: str | None):
    from .dataset import DatasetMissing, load

    try:
        return load(path)
    except DatasetMissing as e:
        raise SystemExit(f"{e}. The bench reads data/playground (or --data / SIEVE_BENCH_DATA).")


# ---- serve-baseline -------------------------------------------------------------------------

def cmd_serve_baseline(args: argparse.Namespace) -> int:
    from .baseline_server import serve

    ds = _dataset(args.data)
    print(f"Baseline connector on http://127.0.0.1:{args.port}/mcp ({len(ds)} items from {ds.root})", flush=True)
    print(f"Call log: {server_log_path()}", flush=True)
    serve(ds, host="127.0.0.1", port=args.port)
    return 0


# ---- check-dataset --------------------------------------------------------------------------

def cmd_check_dataset(args: argparse.Namespace) -> int:
    from .agent import load_tasks
    from .count import load_canaries
    from .dataset import check_dataset

    ds = _dataset(args.data)
    problems = check_dataset(ds, load_tasks(tasks_path()), load_canaries(canaries_path()))
    if problems:
        print(f"check-dataset: {len(problems)} problems in {ds.root}")
        for p in problems:
            print(f"- {p}")
        return 1
    print(f"check-dataset: tasks.json and canaries.json agree with {ds.root} ({len(ds)} items).")
    return 0


# ---- run ------------------------------------------------------------------------------------

def _adapter_factory(args: argparse.Namespace):
    """Returns (factory, adapter name, model id, public settings)."""
    if args.adapter == "fake":
        from .fake_adapter import FAKE_MODEL_ID, factory_from_script, load_script

        if not args.fake_script:
            raise SystemExit("--adapter fake needs --fake-script <file>")
        return factory_from_script(load_script(Path(args.fake_script))), "fake", FAKE_MODEL_ID, {"script": str(args.fake_script)}
    from .gemini import GeminiAdapter, MissingConfig, public_settings, settings_from_env

    try:
        s = settings_from_env()
    except MissingConfig as e:
        raise SystemExit(str(e))

    def make(task):
        return GeminiAdapter(s["model_id"], s["api_key"], image_mode=s["image_mode"], thinking_level=s["thinking_level"])

    return make, "gemini", s["model_id"], public_settings(s)


def _server_url(args: argparse.Namespace) -> str:
    if args.url:
        return args.url
    if args.arm == "baseline":
        return os.environ.get("BASELINE_URL", "").strip() or DEFAULT_BASELINE_URL
    url = os.environ.get("SIEVE_MCP_URL", "").strip()
    if not url:
        raise SystemExit("Set SIEVE_MCP_URL in bench/.env to the Bench assistant's connector link (see bench/README.md).")
    return url


async def _probe(url: str, headers: dict) -> str | None:
    from .mcp_client import connect

    try:
        async with connect(url, headers=headers, timeout=15.0) as tools:
            specs = await tools.list_tools()
            return None if specs else "the server lists no tools"
    except Exception as e:
        return f"{type(e).__name__}: {e}"


def _copy_server_log(run_id: str, dest: Path) -> int:
    from .log import read_jsonl, write_jsonl

    rows = [r for r in read_jsonl(server_log_path()) if r.get("run") == run_id]
    if rows:
        write_jsonl(dest, rows)
    return len(rows)


def cmd_run(args: argparse.Namespace) -> int:
    from .agent import SYSTEM_PROMPT, Limits, RunPlan, load_tasks, run_tasks
    from .count import load_canaries
    from .dataset import check_dataset, dataset_sha256
    from .log import APPROVAL_POLICY_VERSION, Transcript, base_manifest, check_set_id, new_set_id, next_run_id, now_iso, read_json, write_json
    from .mcp_client import connect

    ds = _dataset(args.data)
    tasks = load_tasks(tasks_path(), args.tasks.split(",") if args.tasks else None)
    canaries = load_canaries(canaries_path())
    problems = check_dataset(ds, tasks, canaries)
    if problems:
        print("The tasks do not match the dataset, so the run would measure the wrong thing:", file=sys.stderr)
        for p in problems:
            print(f"- {p}", file=sys.stderr)
        return 1
    factory, adapter_name, model_id, model_settings = _adapter_factory(args)
    url = _server_url(args)

    results = Path(args.results).expanduser().resolve() if args.results else results_dir()
    set_id = check_set_id(args.set) if args.set else new_set_id(results)
    set_dir = results / set_id
    set_dir.mkdir(parents=True, exist_ok=True)
    set_manifest_path = set_dir / "manifest.json"
    set_manifest = read_json(set_manifest_path) if set_manifest_path.exists() else {"set_id": set_id, "created_at": now_iso(), "runs": []}

    headers_for = (lambda rid: {"X-Bench-Run": rid}) if args.arm == "baseline" else (lambda rid: {})
    problem = anyio.run(_probe, url, headers_for("probe"))
    if problem:
        hint = "Start it with: npm run bench:baseline" if args.arm == "baseline" else "Start the bench stack (npm run bench:stack) and open the home base."
        return _fail(f"Cannot reach the {args.arm} MCP server at {url}: {problem}. {hint}")

    project = os.environ.get("SIEVE_PROJECT_ID", "").strip()
    if args.arm == "sieve" and not (args.chrome_version and args.nano_status):
        print("Note: pass --chrome-version and --nano-status so the manifest records the browser and model state.", file=sys.stderr)

    data_sha = dataset_sha256(ds.root)
    limits = Limits()
    for _ in range(args.runs):
        run_id = next_run_id(set_dir, set_id, args.arm)
        run_dir = set_dir / "runs" / run_id
        run_dir.mkdir(parents=True)
        extra: dict = {"model_settings": model_settings}
        audit_before = None
        if args.arm == "sieve":
            from .collect import audit_count, grant_config

            try:
                extra["grant"] = grant_config(url, project=project)
                audit_before = audit_count(url, project=project)
            except Exception as e:  # CollectError, connection refused, HTTP errors
                extra["grant"] = {"error": f"{type(e).__name__}: {e}"}
            extra.update(
                {
                    "chrome_version": args.chrome_version,
                    "nano_status": args.nano_status,
                    "approval_policy_version": APPROVAL_POLICY_VERSION,
                }
            )
        manifest = base_manifest(
            run_id=run_id,
            set_id=set_id,
            arm=args.arm,
            model_id=model_id,
            adapter=adapter_name,
            data_root=ds.root,
            data_sha256=data_sha,
            tasks_file=tasks_path(),
            canaries_file=canaries_path(),
            system_prompt=SYSTEM_PROMPT,
            limits=limits.to_dict(),
            task_ids=[t.id for t in tasks],
            server_url=url,
            extra=extra,
        )
        write_json(run_dir / "manifest.json", manifest)
        transcript = Transcript(run_dir / "transcript.jsonl")

        def tools_factory(rid: str):
            return connect(url, headers=headers_for(rid))

        plan = RunPlan(arm=args.arm, set_dir=set_dir, run_id=run_id, tasks=tasks, adapter_factory=factory, tools_factory=tools_factory, limits=limits)
        print(f"{run_id}: {len(tasks)} tasks against {args.arm} ({model_id})")
        try:
            ends = anyio.run(run_tasks, plan, transcript)
        except KeyboardInterrupt:
            print(f"{run_id}: interrupted; the run stays incomplete and the report will not count it.", file=sys.stderr)
            return 130
        manifest["ended_at"] = now_iso()
        write_json(run_dir / "manifest.json", manifest)

        if args.arm == "baseline":
            n = _copy_server_log(run_id, run_dir / "server-log.jsonl")
            if not n:
                print(f"{run_id}: no server log lines found at {server_log_path()} (the report will say so).", file=sys.stderr)
        else:
            from .collect import collect_run

            try:
                receipts = collect_run(url, project=project, since=manifest["started_at"], until=manifest["ended_at"], audit_before=audit_before)
            except Exception as e:
                receipts = {"error": f"{type(e).__name__}: {e}"}
            write_json(run_dir / "receipts.json", receipts)

        set_manifest["runs"].append({"run_id": run_id, "arm": args.arm, "adapter": adapter_name, "model_id": model_id})
        write_json(set_manifest_path, set_manifest)
        stopped = [f"{e.task} {e.stopped}" for e in ends if e.stopped]
        print(f"{run_id}: done, {sum(e.tool_calls for e in ends)} tool calls" + (f"; stopped: {', '.join(stopped)}" if stopped else ""))
    print(f"Set {set_id} in {set_dir}. Next: python -m sieve_bench report --set {set_id}")
    return 0


# ---- report and lines ----------------------------------------------------------------------

def _set_dir(args: argparse.Namespace) -> Path:
    from .log import check_set_id

    results = Path(args.results).expanduser().resolve() if args.results else results_dir()
    set_dir = results / check_set_id(args.set)
    if not (set_dir / "runs").is_dir():
        raise SystemExit(f"No run set at {set_dir}")
    return set_dir


def cmd_report(args: argparse.Namespace) -> int:
    from .agent import load_tasks
    from .count import load_canaries
    from .report import ARM_LABELS, NotMeasured, comparison_table, update_readme, write_report

    set_dir = _set_dir(args)
    tasks = load_tasks(tasks_path())
    summary = write_report(set_dir, dataset=_dataset(args.data), tasks=tasks, canaries=load_canaries(canaries_path()))
    print(f"Wrote {set_dir / 'report.md'} and summary.json")
    if summary["rehearsal"]:
        print("Rehearsal with a scripted model, not a measurement.")
    print()
    print(comparison_table(summary))
    for arm, label in ARM_LABELS.items():
        if not summary["arms"][arm]["measured"]:
            print(f"\n{label}: not measured (no completed run in this set).")
    if args.update_readme:
        try:
            readme = update_readme(summary, results=set_dir.parent)
        except NotMeasured as e:
            return _fail(f"README not changed: {e}")
        print(f"\nUpdated the bench block in {readme} and wrote LATEST.")
    return 0


def cmd_lines(args: argparse.Namespace) -> int:
    from .log import read_json
    from .report import NotMeasured, lines

    path = _set_dir(args) / "summary.json"
    if not path.exists():
        return _fail("Run report first: summary.json is missing.")
    try:
        for line in lines(read_json(path)):
            print(line)
    except NotMeasured as e:
        return _fail(str(e))
    return 0


# ---- demo-client ----------------------------------------------------------------------------

def cmd_demo_client(args: argparse.Namespace) -> int:
    from .demo_client import serve

    factory, _name, model_id, _settings = _adapter_factory(args)
    url = args.url or os.environ.get("SIEVE_MCP_URL", "").strip()
    if not url:
        return _fail("Set SIEVE_MCP_URL in bench/.env to the connector link the test page should use.")
    serve(url=url, adapter_factory=factory, port=args.port, model_id=model_id)
    return 0


# ---- parser ---------------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m sieve_bench", description="Sieve bench: the measured number.")
    p.add_argument("--data", help="dataset folder (default: data/playground, or SIEVE_BENCH_DATA)")
    p.add_argument("--results", help="results folder (default: bench/results, or SIEVE_BENCH_RESULTS)")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("serve-baseline", help="run the baseline MCP server on 127.0.0.1")
    s.add_argument("--port", type=int, default=DEFAULT_BASELINE_PORT)
    s.set_defaults(fn=cmd_serve_baseline)

    s = sub.add_parser("check-dataset", help="verify tasks and canaries against the dataset")
    s.set_defaults(fn=cmd_check_dataset)

    s = sub.add_parser("run", help="run the tasks and write one run folder per run")
    s.add_argument("--arm", choices=ARMS, required=True)
    s.add_argument("--runs", type=int, default=1)
    s.add_argument("--tasks", help="comma-separated task ids, for example T01,T02")
    s.add_argument("--set", help="set id (default: a new one for today)")
    s.add_argument("--chrome-version")
    s.add_argument("--nano-status")
    s.add_argument("--adapter", choices=("gemini", "fake"), default="gemini")
    s.add_argument("--fake-script", help="JSON script for --adapter fake (a rehearsal, never a measurement)")
    s.add_argument("--url", help="override BASELINE_URL or SIEVE_MCP_URL")
    s.set_defaults(fn=cmd_run)

    s = sub.add_parser("report", help="compute metrics and write report.md and summary.json")
    s.add_argument("--set", required=True)
    s.add_argument("--update-readme", action="store_true")
    s.set_defaults(fn=cmd_report)

    s = sub.add_parser("lines", help="print the video and Devpost lines from summary.json")
    s.add_argument("--set", required=True)
    s.set_defaults(fn=cmd_lines)

    s = sub.add_parser("demo-client", help="serve the local Test assistant page")
    s.add_argument("--port", type=int, default=DEFAULT_DEMO_PORT)
    s.add_argument("--adapter", choices=("gemini", "fake"), default="gemini")
    s.add_argument("--fake-script")
    s.add_argument("--url", help="override SIEVE_MCP_URL")
    s.set_defaults(fn=cmd_demo_client)
    return p


def main(argv: list[str] | None = None) -> int:
    _load_env()
    args = build_parser().parse_args(argv)
    if getattr(args, "runs", 1) < 1:
        return _fail("--runs must be at least 1")
    return int(args.fn(args) or 0)

