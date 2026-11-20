"""Sieve bench: the measured number.

For the same ten tasks, the same model and the same sample data, the bench counts how much
of the person's data reaches the outside model through a typical direct-access connector
(the baseline) and through Sieve. Everything is counted from logs at the boundary where tool
results are handed to the model.
"""

from __future__ import annotations

import os
from pathlib import Path

__version__ = "1.0.0"

BENCH_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BENCH_DIR.parent

ARMS = ("baseline", "sieve")
DEFAULT_BASELINE_URL = "http://127.0.0.1:8765/mcp"
DEFAULT_BASELINE_PORT = 8765
DEFAULT_DEMO_PORT = 8766


def results_dir() -> Path:
    """Where run sets live. `SIEVE_BENCH_RESULTS` overrides the committed default."""
    override = os.environ.get("SIEVE_BENCH_RESULTS", "").strip()
    return Path(override).expanduser().resolve() if override else BENCH_DIR / "results"


def tasks_path() -> Path:
    return BENCH_DIR / "tasks.json"


def canaries_path() -> Path:
    return BENCH_DIR / "canaries.json"


def server_log_path() -> Path:
    """The baseline server's call log. Both the server and the runner read `BENCH_SERVER_LOG`."""
    override = os.environ.get("BENCH_SERVER_LOG", "").strip()
    return Path(override).expanduser().resolve() if override else results_dir() / ".baseline-server-log.jsonl"
