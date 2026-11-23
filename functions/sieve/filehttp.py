"""The download address of an approved file: GET /f/<token> (files.py).

The token in the address is the only credential. The link is found by the token's hash, counted in a transaction,
and the object is streamed from Cloud Storage as a download, never shown in place. Every refusal looks the same from
outside (404, one sentence), so the address says nothing about which links exist. When a link has been fetched as
often as it may be, or has run out, its object and its record are deleted.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

import flask
from pydantic import ValidationError

from . import fb, files, logs
from .models import FileLink

MSG_GONE = "This link does not work. It may have run out: links from Sieve work for a few minutes."
_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Robots-Tag": "noindex, nofollow",
}


@dataclass
class FileDeps:
    db: Any                                    # google.cloud.firestore.Client
    now: Callable[[], datetime]
    read_object: Callable[[str], bytes | None]      # the object's bytes, or None when it is not there
    delete_object: Callable[[str], None]


def _bucket() -> Any:
    from firebase_admin import storage     # imported here: only this endpoint and the cleanup touch Storage
    fb.app()
    return storage.bucket()


def read_object(path: str) -> bytes | None:
    blob = _bucket().blob(path)
    if not blob.exists():
        return None
    return blob.download_as_bytes()


def delete_object(path: str) -> None:
    try:
        _bucket().blob(path).delete()
    except Exception:       # noqa: BLE001 - already gone, or Storage is briefly away: the cleanup tries again
        pass


def default_deps() -> FileDeps:
    return FileDeps(db=fb.db(), now=fb.now, read_object=read_object, delete_object=delete_object)


def _gone() -> flask.Response:
    return flask.Response(MSG_GONE, status=404, headers={**_HEADERS, "Content-Type": "text/plain; charset=utf-8"})


def _take_txn(txn: Any, ref: Any, now: datetime) -> tuple[FileLink | None, bool]:
    """Counts one download. Returns the link, and whether this was the last one it allows."""
    snap = ref.get(transaction=txn)
    if not snap.exists:
        return None, False
    try:
        link = FileLink.model_validate(snap.to_dict() or {})
    except ValidationError:
        return None, False
    if files.download_refusal(link, now) is not None:
        return None, False
    txn.update(ref, {"downloads": link.downloads + 1})
    return link, link.downloads + 1 >= files.FILE_LINK_MAX_DOWNLOADS


def handle_http(req: flask.Request, deps: FileDeps | None = None) -> flask.Response:
    if req.method not in ("GET", "HEAD"):
        return flask.Response("", status=405, headers={**_HEADERS, "Allow": "GET, HEAD"})
    token = files.extract_file_token(req.path)
    if token is None:
        return _gone()
    deps = deps or default_deps()
    ref = deps.db.collection("fileLinks").document(files.file_token_hash(token))
    if req.method == "HEAD":
        # a look, not a fetch: it says the file is there and is not counted
        snap = ref.get()
        try:
            link = FileLink.model_validate(snap.to_dict() or {}) if snap.exists else None
        except ValidationError:
            link = None
        if link is None or files.download_refusal(link, deps.now()) is not None:
            return _gone()
        return flask.Response("", status=200, headers={
            **_HEADERS, "Content-Type": link.mime, "Content-Disposition": files.content_disposition(link.name)})
    link, last = fb.transact(deps.db, _take_txn, ref, deps.now(), lock_key=ref.path)
    if link is None:
        return _gone()
    data = deps.read_object(link.path)
    if data is None or len(data) > files.SHARED_FILE_MAX_BYTES:
        ref.delete()
        if data is not None:
            deps.delete_object(link.path)
        return _gone()
    logs.log_event("file_downloaded", bytes=len(data), last=last)
    if last:
        deps.delete_object(link.path)
        ref.delete()
    return flask.Response(data, status=200, headers={
        **_HEADERS, "Content-Type": link.mime, "Content-Length": str(len(data)),
        "Content-Disposition": files.content_disposition(link.name)})


def remove_expired(db: Any, now: datetime, delete: Callable[[str], None], *, batch_limit: int = 200) -> int:
    """The cleanup's part: links past their time go, with their objects. Returns how many."""
    from google.cloud.firestore_v1.base_query import FieldFilter
    removed = 0
    snaps = list(db.collection("fileLinks").where(filter=FieldFilter("expiresAt", "<", now)).limit(batch_limit).stream())
    for snap in snaps:
        path = (snap.to_dict() or {}).get("path")
        if isinstance(path, str) and files.file_owner(path) is not None:
            delete(path)
        snap.reference.delete()
        removed += 1
    return removed
