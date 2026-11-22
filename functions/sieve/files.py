"""Files sent as themselves (Nov 22, 2026): the full step with the original attached, handed over as a link.

After the person approves, the home base uploads the file to Cloud Storage under handoffs/{uid}/{requestId}/ and
names it in the payload. The relay never puts the bytes in a tool result, because assistants do not agree on what
they accept there. It makes a link that works for a few minutes, keyed by the SHA-256 of a random token (the token
itself is stored nowhere, as with connector links), and the download endpoint streams the object.

Pure logic only: the Firestore and Storage calls that use it live with the relay.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import unicodedata
from datetime import datetime
from urllib.parse import quote

from pydantic import Field, field_validator, model_validator

from .models import FsModel

SHARED_FILE_MAX_BYTES = 20 * 1024 * 1024       # the largest file a person can send
FILE_LINK_TTL_SECONDS = 600                    # the link works for 10 minutes
FILE_LINK_MAX_DOWNLOADS = 3                    # a client may fetch twice (a preview, then the file); not more
FILE_NAME_MAX_CHARS = 120
FILE_TOKEN_BYTES = 32
FILE_TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}")
FILE_URL_PATH_RE = re.compile(r"^(?:/f)?/([A-Za-z0-9_-]{43})$")
# handoffs/{uid}/{requestId}/{object}: the same shapes the Storage rules accept
FILE_PATH_RE = re.compile(r"^handoffs/(?P<uid>[A-Za-z0-9]{1,128})/(?P<request>[A-Za-z0-9]{20})/(?P<object>[A-Za-z0-9_-]{16,64})$")

# What may be sent, by media type, with the endings a name of that type may have. Nothing a browser would run
# (HTML, SVG, scripts) and no archives, whose contents nobody approved one by one.
FILE_TYPES: dict[str, tuple[str, ...]] = {
    "application/pdf": (".pdf",),
    "image/jpeg": (".jpg", ".jpeg"),
    "image/png": (".png",),
    "image/webp": (".webp",),
    "image/gif": (".gif",),
    "image/heic": (".heic",),
    "text/plain": (".txt",),
    "text/csv": (".csv",),
    "text/markdown": (".md",),
    "text/calendar": (".ics",),
    "application/msword": (".doc",),
    "application/vnd.ms-excel": (".xls",),
    "application/vnd.ms-powerpoint": (".ppt",),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (".docx",),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (".xlsx",),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": (".pptx",),
}
_KIND_WORDS = {
    "application/pdf": "PDF", "text/plain": "text", "text/csv": "CSV", "text/markdown": "Markdown", "text/calendar": "calendar",
    "application/msword": "Word", "application/vnd.ms-excel": "Excel", "application/vnd.ms-powerpoint": "PowerPoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
}


def safe_file_name(name: str) -> str:
    """The name as it may be shown and offered for saving: no folders, no control or bidi characters, no leading dots,
    at most FILE_NAME_MAX_CHARS with its ending kept. Never empty."""
    text = unicodedata.normalize("NFC", name if isinstance(name, str) else "")
    text = text.replace("\\", "/").rsplit("/", 1)[-1]
    text = "".join(ch for ch in text if unicodedata.category(ch) not in ("Cc", "Cf", "Co", "Cs", "Zl", "Zp"))
    text = re.sub(r'[<>:"|?*]', "_", text)
    text = re.sub(r"\s+", " ", text).strip().lstrip(".").strip()
    if not text:
        return "file"
    if len(text) > FILE_NAME_MAX_CHARS:
        stem, dot, ending = text.rpartition(".")
        if dot and stem and 1 <= len(ending) <= 5:
            text = stem[: FILE_NAME_MAX_CHARS - len(ending) - 1].rstrip() + "." + ending
        else:
            text = text[:FILE_NAME_MAX_CHARS].rstrip()
    return text or "file"


def file_type_allowed(mime: str, name: str) -> bool:
    """A type on the list, with a name that ends as that type does (a ".pdf" that says it is an image is refused)."""
    endings = FILE_TYPES.get(mime if isinstance(mime, str) else "")
    return bool(endings) and isinstance(name, str) and name.lower().endswith(endings)


def file_owner(path: str) -> tuple[str, str] | None:
    """(uid, request id) of a handoff path, or None when it is not one."""
    m = FILE_PATH_RE.fullmatch(path) if isinstance(path, str) else None
    return (m.group("uid"), m.group("request")) if m else None


class SharedFile(FsModel):
    """The file part of an approved payload, as the home base wrote it."""
    name: str = Field(min_length=1, max_length=FILE_NAME_MAX_CHARS)
    mime: str
    bytes: int = Field(ge=1, le=SHARED_FILE_MAX_BYTES)
    path: str

    @field_validator("name")
    @classmethod
    def _name_is_safe(cls, v: str) -> str:
        if safe_file_name(v) != v:
            raise ValueError("name must be a plain file name")
        return v

    @field_validator("path")
    @classmethod
    def _path_is_a_handoff(cls, v: str) -> str:
        if file_owner(v) is None:
            raise ValueError("path must be handoffs/{uid}/{requestId}/{object}")
        return v

    @model_validator(mode="after")
    def _type_fits_name(self) -> "SharedFile":
        if not file_type_allowed(self.mime, self.name):
            raise ValueError("this kind of file cannot be sent")
        return self

    def belongs_to(self, uid: str, request_id: str) -> bool:
        return file_owner(self.path) == (uid, request_id)


class FileLink(FsModel):
    """fileLinks/{sha256 of the token}: what the download endpoint needs, and nothing about the request's words."""
    uid: str
    grant_id: str
    request_id: str
    path: str
    name: str
    mime: str
    bytes: int
    created_at: datetime
    expires_at: datetime
    downloads: int = 0


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


def content_disposition(name: str) -> str:
    """Always a download, never shown in place: an ASCII name for old clients and the real one beside it (RFC 6266)."""
    safe = safe_file_name(name)
    ascii_name = safe.encode("ascii", "replace").decode("ascii").replace("?", "_").replace('"', "_").replace("\\", "_")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe, safe='')}"


def human_size(n: int) -> str:
    if n < 1024:
        return f"{n} bytes"
    if n < 1024 * 1024:
        return f"{round(n / 1024)} KB"
    return f"{n / (1024 * 1024):.1f} MB"


def describe_file(name: str, mime: str, size: int) -> str:
    """One line for the assistant and the receipt: 'Lease_2026.pdf (PDF, 182 KB)'."""
    kind = _KIND_WORDS.get(mime) or ("image" if mime.startswith("image/") else "file")
    return f"{name} ({kind}, {human_size(size)})"
