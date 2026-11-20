"""U13: config.py mirrors shared/src/constants.ts (01 section 1)."""
import json
import pathlib
import re

import pytest

from sieve import config

CONSTANTS = pathlib.Path(__file__).resolve().parents[3] / "shared" / "src" / "constants.ts"


def _src() -> str:
    if not CONSTANTS.exists():
        pytest.skip("shared/src/constants.ts not found")
    return CONSTANTS.read_text()


def _array(src: str, name: str) -> list[str]:
    m = re.search(rf"export const {name} = \[(.*?)\] as const", src, re.S)
    return re.findall(r"'([^']*)'", m.group(1))


def _number(src: str, name: str) -> int:
    return int(re.search(rf"export const {name} = (\d+)", src).group(1))


def test_u13_constants_match_shared():
    src = _src()
    assert tuple(_array(src, "CATEGORIES")) == config.CATEGORIES
    assert tuple(_array(src, "LADDER_STEPS")) == config.LADDER_STEPS
    assert _number(src, "MAX_QUESTION_CHARS") == config.MAX_QUESTION_CHARS
    assert _number(src, "MAX_PAYLOAD_CHARS") == config.MAX_PAYLOAD_CHARS
    assert _number(src, "REQUEST_TTL_HOURS") == config.REQUEST_TTL_HOURS
    assert _number(src, "GRANT_DEFAULT_DAYS") == config.GRANT_DEFAULT_DAYS
    assert _number(src, "RELAY_WAIT_SECONDS") == config.RELAY_WAIT_SECONDS_DEFAULT
    assert _number(src, "RELAY_DECISION_MINUTES") == config.DECISION_WINDOW_MINUTES
    assert _number(src, "RELAY_COLLECT_MINUTES") == config.COLLECT_WINDOW_MINUTES
    block = re.search(r"export const MCP_TOOLS = \{(.*?)\} as const", src, re.S).group(1)
    assert dict(re.findall(r"(\w+): '([^']+)'", block)) == config.MCP_TOOLS


def test_schemas_match_shared():
    from sieve import tools
    base = CONSTANTS.parent / "schemas"
    if not base.exists():
        pytest.skip("shared/src/schemas not found")
    assert json.loads((base / "mcp-tool-result.json").read_text()) == tools.TOOL_RESULT_SCHEMA
    assert json.loads((base / "mcp-ladder-input.json").read_text()) == tools.LADDER_INPUT_SCHEMA
    assert json.loads((base / "mcp-check-input.json").read_text()) == tools.CHECK_INPUT_SCHEMA
