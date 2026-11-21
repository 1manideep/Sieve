"""Constants, params and secret access (docs/spec/30-relay-server.md section 3)."""
from __future__ import annotations

import hashlib
import os
import re

from firebase_functions.params import IntParam, SecretParam, StringParam

IS_EMULATOR: bool = os.environ.get("FUNCTIONS_EMULATOR") == "true"
PROJECT_ID: str = os.environ.get("GCLOUD_PROJECT", "") or os.environ.get("GOOGLE_CLOUD_PROJECT", "")
REGION = "us-central1"
ENFORCE_APP_CHECK: bool = not IS_EMULATOR   # no App Check emulator; production always enforces

# Mirrors of shared/src/constants.ts (01 section 1). tests/unit/test_constants.py parses
# shared/src/constants.ts and fails if any of these differ.
CATEGORIES = ("Home", "Work", "Money", "Health", "Travel", "Shopping", "Personal", "Newsletters", "Photos")
LADDER_STEPS = ("answer", "excerpt", "full")
STEP_RANK = {"answer": 0, "excerpt": 1, "full": 2}
REQUEST_TTL_HOURS = 24
MAX_QUESTION_CHARS = 500
MAX_PAYLOAD_CHARS = 8000
GRANT_DEFAULT_DAYS = 30
RELAY_WAIT_SECONDS_DEFAULT = 45  # mirrors shared; on the server only an upper bound now (SHORT_WAIT_SECONDS, CHECK_WAIT_SECONDS)
MCP_TOOLS = {"answer": "sieve_answer", "excerpt": "sieve_excerpt", "full": "sieve_full_item", "check": "sieve_check"}
TOOL_STEP = {"sieve_answer": "answer", "sieve_excerpt": "excerpt", "sieve_full_item": "full"}
STEP_TOOL = {step: tool for tool, step in TOOL_STEP.items()}

# Ratchet step caps (D5). Full-match regexes; every cap allows sieve_check.
TOOL_PATTERNS = {
    "answer": r"sieve_(answer|check)",
    "excerpt": r"sieve_(answer|excerpt|check)",
    "full": r"sieve_(answer|excerpt|full_item|check)",
}

# Server policy (this spec)
REAL_SOURCES = ("gmail", "folder", "upload")       # 'playground' is never granted to an outside AI ...
PLAYGROUND_SOURCES = ("playground",)               # ... except through issuePlaygroundGrant (00 D1, 30 section 16)
PLAYGROUND_GRANT_DAYS = 1
PLAYGROUND_AI_NAME = "Gemini in the cloud"
AI_NAME_MAX_CHARS = 40
GRANT_MAX_DAYS = 90
MAX_ACTIVE_GRANTS = 10
DECISION_WINDOW_MINUTES = 120     # RELAY_DECISION_MINUTES: queued/claimed/awaiting-person older than this -> expired
COLLECT_WINDOW_MINUTES = 60       # RELAY_COLLECT_MINUTES: answered and not collected this long after answeredAt -> expired
RECLAIM_AFTER_SECONDS = 120       # another device may take over a stuck claim
CONNECTOR_RETENTION_DAYS = 7      # connector docs kept this long after expiry/revocation, then deleted
# Rate limit (30 section 11): a leaky bucket per connection. A counted call adds its weight, the bucket drains
# RATE_LIMIT_CALLS per RATE_LIMIT_WINDOW_SECONDS, and a call that would overflow it is refused and adds nothing.
RATE_LIMIT_CALLS = 200            # call units per connection per window: 10 waiting requests polled every 20 s are 150, plus 20 questions
RATE_LIMIT_WINDOW_SECONDS = 600
CHECK_CALL_WEIGHT = 0.5           # a sieve_check poll counts as half a call
RATE_LIMIT_FREE_REFUSALS = 30     # refused calls given back per window; past that they count, so a loop stays bounded
RATE_LIMIT_WAIT_STEP_SECONDS = 5  # the stated wait is rounded up to a multiple of this
MAX_OPEN_REQUESTS_PER_GRANT = 10  # requests still being prepared or waiting for the person; an approved answer not yet collected does not count
IDEMPOTENCY_WINDOW_SECONDS = 600  # a call with the same key within this window returns the existing request
IDEMPOTENCY_KEY_MAX_CHARS = 64
NOTHING_MIN_DELAY_SECONDS = 10.0  # 00 D6: blocked and no-match leave no earlier than this after the request was made
MAX_BODY_BYTES = 16_384
# Request id first: a tool call never holds the connection long enough for a client gateway (30 to 60 s) to cut it.
SHORT_WAIT_SECONDS = 15           # a ladder tool waits at most this long for a decision, then returns pending
CHECK_WAIT_SECONDS = 20           # sieve_check waits at most this long per call
WAIT_CAP_SECONDS = 20             # no wait runs past t0 + 20 s
COLLECT_CUTOFF_SECONDS = 23       # no collection after t0 + 23 s (the reply must leave before 25 s)
REPLY_DEADLINE_SECONDS = 25       # end to end, from t0, for every tool call
SAFETY_POLL_SECONDS = 5.0
MESSAGE_MAX_CHARS = 300
LINK_SECRET_BYTES = 32            # secrets.token_urlsafe(32) -> 43 characters
LINK_SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
LINK_PATH_RE = re.compile(r"^/(?:mcp/)?([A-Za-z0-9_-]{43})/?$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9]{20}$")  # Firestore auto ids
GRANT_ID_RE = re.compile(r"^[A-Za-z0-9]{20}$")
PUSH_MAX_DEVICES = 5

# MCP
SERVER_NAME, SERVER_TITLE, SERVER_VERSION = "sieve", "Sieve", "1.0.0"
MODERN_VERSIONS = ("2026-07-28",)
LEGACY_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
LATEST_LEGACY_VERSION = "2025-11-25"
HEADERLESS_LEGACY_VERSION = "2025-03-26"   # spec: a request without MCP-Protocol-Version MAY be treated as 2025-03-26

APP_ORIGINS: tuple[str, ...] = tuple(o for o in (
    "https://sieve.manideep.info",
    f"https://{PROJECT_ID}.web.app" if PROJECT_ID else "",
    f"https://{PROJECT_ID}.firebaseapp.com" if PROJECT_ID else "",
    *(("http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:5000", "http://localhost:5000")
      if IS_EMULATOR else ()),
) if o)

# Params and secrets (read with .value, a property, at runtime only)
BROKER_SECRET = SecretParam("RATCHET_BROKER_SECRET")
PUBLIC_BASE_URL = StringParam("SIEVE_PUBLIC_BASE_URL", default="https://sieve.manideep.info")
RELAY_WAIT_SECONDS = IntParam("RELAY_WAIT_SECONDS", default=RELAY_WAIT_SECONDS_DEFAULT)
MCP_MIN_INSTANCES = IntParam("MCP_MIN_INSTANCES", default=0)
PUSH_MODE = StringParam("SIEVE_PUSH_MODE", default="fcm")

_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")


class ConfigError(RuntimeError):
    """The deployment is missing a value it needs (never carries a secret in its message)."""


def utf16_len(s: str) -> int:
    """Length in UTF-16 code units, the one character unit Sieve uses everywhere (01 section 1, 70 CR-1)."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def emulator_fallback_secret(project_id: str) -> str:
    """A fixed broker secret for demo- projects in the emulator only, so a fresh clone can run the
    tests without a .secret.local file. It is public by construction and never used for a real project."""
    return hashlib.sha256(f"sieve/emulator-only/{project_id}".encode("ascii")).hexdigest()


def broker_secret_bytes() -> bytes:
    """Return the 32-byte HMAC secret. Raise ConfigError unless the secret is exactly 64 lowercase hex chars."""
    raw = (BROKER_SECRET.value or "").strip()
    if not raw and IS_EMULATOR and PROJECT_ID.startswith("demo-"):
        raw = emulator_fallback_secret(PROJECT_ID)
    if not _HEX64_RE.fullmatch(raw):
        raise ConfigError("RATCHET_BROKER_SECRET must be 64 lowercase hex characters.")
    return bytes.fromhex(raw)


def relay_wait_seconds() -> int:
    """RELAY_WAIT_SECONDS.value clamped to [3, WAIT_CAP_SECONDS]. It can only shorten the waits (tests use 6)."""
    try:
        value = int(RELAY_WAIT_SECONDS.value)
    except (TypeError, ValueError):
        value = RELAY_WAIT_SECONDS_DEFAULT
    return max(3, min(value, WAIT_CAP_SECONDS))


def public_base_url() -> str:
    """PUBLIC_BASE_URL.value with any trailing slash removed."""
    return (PUBLIC_BASE_URL.value or "https://sieve.manideep.info").rstrip("/")
