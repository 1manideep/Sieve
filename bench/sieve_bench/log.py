"""JSONL transcript and run manifest (60 section 4.9.3)."""

from __future__ import annotations

import hashlib
import json
import platform
import re
import subprocess
import threading
from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Any

from . import REPO_DIR, __version__

APPROVAL_POLICY_VERSION = 1
SET_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class Transcript:
    """Appends one JSON object per line and flushes each line, so an interrupted run keeps its log."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def event(self, ev: dict) -> None:
        line = json.dumps(ev, ensure_ascii=False)
        with self._lock, self.path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


class MemoryTranscript:
    """Same interface, kept in memory (tests and the demo client)."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def event(self, ev: dict) -> None:
        self.events.append(json.loads(json.dumps(ev, ensure_ascii=False)))


def read_jsonl(path: Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_json(path: Path, data: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def git_info(repo: Path = REPO_DIR) -> dict:
    """Commit and dirty flag, read-only."""

    def run(*args: str) -> str | None:
        try:
            out = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            return None
        return out.stdout.strip() if out.returncode == 0 else None

    commit = run("rev-parse", "HEAD")
    status = run("status", "--porcelain")
    return {"commit": commit, "dirty": bool(status) if status is not None else None}


def package_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


# ---- Set and run folders -------------------------------------------------------------------

def new_set_id(results: Path, today: str | None = None) -> str:
    today = today or datetime.now().strftime("%Y-%m-%d")
    k = 1
    while (results / f"{today}-set{k}").exists():
        k += 1
    return f"{today}-set{k}"


def check_set_id(set_id: str) -> str:
    if not SET_ID_RE.fullmatch(set_id):
        raise ValueError("A set id is 1 to 64 letters, digits, dots, dashes or underscores")
    return set_id


def next_run_id(set_dir: Path, set_id: str, arm: str) -> str:
    runs = set_dir / "runs"
    n = 1
    while (runs / f"{set_id}-{arm}-{n}").exists():
        n += 1
    return f"{set_id}-{arm}-{n}"


def run_dirs(set_dir: Path) -> Iterator[Path]:
    runs = Path(set_dir) / "runs"
    if not runs.is_dir():
        return iter(())
    return iter(sorted(p for p in runs.iterdir() if p.is_dir() and (p / "manifest.json").exists()))


def base_manifest(
    *,
    run_id: str,
    set_id: str,
    arm: str,
    model_id: str,
    adapter: str,
    data_root: Path,
    data_sha256: str,
    tasks_file: Path,
    canaries_file: Path,
    system_prompt: str,
    limits: dict,
    task_ids: list[str],
    server_url: str,
    extra: dict | None = None,
) -> dict:
    manifest = {
        "run_id": run_id,
        "set_id": set_id,
        "arm": arm,
        "bench_version": __version__,
        "git": git_info(),
        "data": {"root": _display_path(data_root), "sha256": data_sha256},
        "tasks_sha256": sha256_file(tasks_file),
        "canaries_sha256": sha256_file(canaries_file),
        "system_prompt_sha256": sha256_text(system_prompt),
        "model_id": model_id,
        "adapter": adapter,
        "sdk": {"google-genai": package_version("google-genai"), "mcp": package_version("mcp")},
        "python": platform.python_version(),
        "limits": limits,
        "tasks": task_ids,
        "server_url": _redact_url(server_url),
        "started_at": now_iso(),
        "ended_at": None,
    }
    if extra:
        manifest.update(extra)
    return manifest


def _display_path(path: Path) -> str:
    try:
        return Path(path).resolve().relative_to(REPO_DIR).as_posix()
    except ValueError:
        return str(path)


def _redact_url(url: str) -> str:
    """A Sieve connector link carries its secret in the path; never write it to a committed file."""
    return re.sub(r"/([A-Za-z0-9_-]{43})(/?)$", r"/<link secret>\2", url or "")
