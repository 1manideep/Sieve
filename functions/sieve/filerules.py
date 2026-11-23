"""What may be sent as a file, and how its name and place are checked (Nov 22, 2026). Pure functions with no model
in them, so models.py can use them for the payload it validates."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

SHARED_FILE_MAX_BYTES = 20 * 1024 * 1024       # the largest file a person can send
FILE_NAME_MAX_CHARS = 120
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
