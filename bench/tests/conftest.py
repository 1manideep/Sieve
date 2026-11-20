from __future__ import annotations

import socket
import threading
import time
from pathlib import Path

import pytest

from sieve_bench import canaries_path, tasks_path
from sieve_bench.agent import load_tasks
from sieve_bench.count import load_canaries
from sieve_bench.dataset import default_data_dir, is_available, load

FIXTURES = Path(__file__).parent / "fixtures"
FIXTURE_DATA = FIXTURES / "playground"
FAKE_SCRIPT = FIXTURES / "fake-script.json"


@pytest.fixture(scope="session")
def dataset():
    """The small fixture dataset in 20's seed format (always present)."""
    return load(FIXTURE_DATA)


@pytest.fixture(scope="session")
def real_dataset():
    """data/playground, when the dataset package has written it; otherwise the test is skipped."""
    if not is_available(default_data_dir()):
        pytest.skip("data/playground is absent or empty; the fixture dataset covers this test")
    return load(default_data_dir())


@pytest.fixture(scope="session")
def tasks():
    return load_tasks(tasks_path())


@pytest.fixture(scope="session")
def canaries():
    return load_canaries(canaries_path())


@pytest.fixture
def server_log(tmp_path, monkeypatch):
    path = tmp_path / "server-log.jsonl"
    monkeypatch.setenv("BENCH_SERVER_LOG", str(path))
    return path


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class UvicornThread:
    """Runs an ASGI app on 127.0.0.1 in a background thread for HTTP round-trip tests."""

    def __init__(self, app, port: int):
        import uvicorn

        self.port = port
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self):
        self.thread.start()
        deadline = time.time() + 10
        while not self.server.started:
            if time.time() > deadline:
                raise RuntimeError("server did not start")
            time.sleep(0.02)
        return self

    def __exit__(self, *exc):
        self.server.should_exit = True
        self.thread.join(timeout=10)
