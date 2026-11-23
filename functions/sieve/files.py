"""Files sent as themselves (Nov 22, 2026): the full step with the original attached, handed over as a link.

After the person approves, the home base uploads the file to Cloud Storage under handoffs/{uid}/{requestId}/ and
names it in the payload. The relay never puts the bytes in a tool result, because assistants do not agree on what
they accept there. It makes a link that works for a few minutes, keyed by the SHA-256 of a random token (the token
itself is stored nowhere, as with connector links), and the download endpoint streams the object.

The rules for names, types and places are in filerules.py and the two models in models.py; this module holds the
link itself. Pure logic only: the Firestore and Storage calls that use it live with the relay.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime
from typing import Any

from .filerules import (FILE_NAME_MAX_CHARS, FILE_PATH_RE, FILE_TYPES, SHARED_FILE_MAX_BYTES, content_disposition,
                        describe_file, file_owner, file_type_allowed, human_size, safe_file_name)
from .models import FileLink, SharedFile

__all__ = [
    "FILE_LINK_MAX_DOWNLOADS", "FILE_LINK_TTL_SECONDS", "FILE_NAME_MAX_CHARS", "FILE_PATH_RE", "FILE_TOKEN_BYTES",
    "FILE_TOKEN_RE", "FILE_TYPES", "FILE_URL_PATH_RE", "SHARED_FILE_MAX_BYTES", "FileLink", "SharedFile",
    "build_file_url", "content_disposition", "describe_file", "download_refusal", "extract_file_token", "file_owner",
    "file_token_hash", "file_type_allowed", "file_wire", "human_size", "is_valid_file_token", "new_file_token",
    "safe_file_name",
]

FILE_LINK_TTL_SECONDS = 600                    # the link works for 10 minutes
FILE_LINK_MAX_DOWNLOADS = 3                    # a client may fetch twice (a preview, then the file); not more
FILE_TOKEN_BYTES = 32
FILE_TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}")
FILE_URL_PATH_RE = re.compile(r"^(?:/f)?/([A-Za-z0-9_-]{43})$")


def new_file_token() -> str:
    return secrets.token_urlsafe(FILE_TOKEN_BYTES)


def is_valid_file_token(token: str) -> bool:
    return isinstance(token, str) and FILE_TOKEN_RE.fullmatch(token) is not None


def file_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def build_file_url(base_url: str, token: str) -> str:
    return f"{base_url.rstrip('/')}/f/{token}"


def extract_file_token(path: str) -> str | None:
    """Accepts '/f/<token>' (via Hosting) and '/<token>' (the function's own URL or the emulator)."""
    m = FILE_URL_PATH_RE.fullmatch(path) if isinstance(path, str) else None
    return m.group(1) if m else None


def download_refusal(link: FileLink, now: datetime) -> str | None:
    """Why this link gives nothing now ('expired' or 'used'), or None when it may be fetched."""
    if now >= link.expires_at:
        return "expired"
    if link.downloads >= FILE_LINK_MAX_DOWNLOADS:
        return "used"
    return None


def file_wire(file: SharedFile, url: str) -> dict[str, Any]:
    """What the assistant gets about an approved file: never its place in storage, only the link."""
    return {"name": file.name, "mime": file.mime, "bytes": file.bytes, "url": url,
            "expires_in_seconds": FILE_LINK_TTL_SECONDS}
