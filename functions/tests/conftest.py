"""Shared fixtures (30 section 17, 60 section 3.7).

Markers follow the folder: tests/unit -> unit, tests/emulator -> emulator, tests/http -> http.
Emulator and HTTP tests skip with a reason when the emulators are not running; run them through
`npm run test:functions` (firebase emulators:exec), which sets the *_EMULATOR_HOST variables.
"""
from __future__ import annotations

import os
import pathlib
import sys

import pytest

FUNCTIONS_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(FUNCTIONS_DIR) not in sys.path:
    sys.path.insert(0, str(FUNCTIONS_DIR))

from tests.helpers import emulator as emu  # noqa: E402

_TIER = {"unit": pytest.mark.unit, "emulator": pytest.mark.emulator, "http": pytest.mark.http}


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    for item in items:
        parts = pathlib.Path(str(item.fspath)).parts
        for name, mark in _TIER.items():
            if name in parts:
                item.add_marker(mark)


def _tier(item: pytest.Item) -> str | None:
    for name in ("emulator", "http"):
        if item.get_closest_marker(name):
            return name
    return None


@pytest.fixture(autouse=True)
def _emulator_gate(request: pytest.FixtureRequest) -> None:
    tier = _tier(request.node)
    if tier is None:
        return
    missing = [v for v in ("FIRESTORE_EMULATOR_HOST", "FIREBASE_DATABASE_EMULATOR_HOST",
                           "FIREBASE_AUTH_EMULATOR_HOST") if not os.environ.get(v)]
    if missing:
        pytest.skip(f"emulators not running ({', '.join(missing)} unset); use npm run test:functions")
    if tier == "http" and not emu.functions_up():
        pytest.skip("the Functions emulator is not running on 127.0.0.1:5001")
    emu.init_admin()
    emu.reset_all()


@pytest.fixture
def db():
    return emu.admin_db()


@pytest.fixture
def broker_secret() -> bytes:
    return emu.broker_secret()


@pytest.fixture
def user():
    """Factory: user() -> (uid, id_token), a password user (not anonymous)."""
    return emu.sign_up
