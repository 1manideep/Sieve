"""Admin app, Firestore client, Realtime Database presence read, clocks."""
from __future__ import annotations

import hashlib
import json
import os
import random
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, TypeVar

import firebase_admin
from firebase_admin import db as rtdb
from google.api_core.exceptions import Aborted
from google.cloud import firestore

T = TypeVar("T")

_lock = threading.RLock()
_db: firestore.Client | None = None


def _project_id() -> str:
    for key in ("GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"):
        if os.environ.get(key):
            return os.environ[key]
    try:
        return json.loads(os.environ.get("FIREBASE_CONFIG", "{}")).get("projectId", "")
    except ValueError:
        return ""


def app() -> firebase_admin.App:
    """The default admin app, initialised once from FIREBASE_CONFIG (set by Cloud Functions and the emulator)."""
    with _lock:
        try:
            return firebase_admin.get_app()
        except ValueError:
            pass
        options: dict[str, Any] = {}
        try:
            options.update(json.loads(os.environ.get("FIREBASE_CONFIG", "{}")))
        except ValueError:
            pass
        project = options.get("projectId") or _project_id()
        if project:
            options["projectId"] = project
            options.setdefault("databaseURL", f"https://{project}-default-rtdb.firebaseio.com")
            if os.environ.get("FIREBASE_DATABASE_EMULATOR_HOST"):
                # The Functions emulator points demo projects at namespace "<project>"; the web app (60 section
                # 3.6) writes presence to "<project>-default-rtdb", the name of the real default instance.
                options["databaseURL"] = f"https://{project}-default-rtdb.firebaseio.com"
        options = {k: v for k, v in options.items() if k in ("projectId", "databaseURL", "storageBucket")}
        return firebase_admin.initialize_app(options=options)


def db() -> firestore.Client:
    """The Firestore client. Against the emulator it uses anonymous credentials, so no Google sign-in is needed."""
    global _db
    if _db is not None:
        return _db
    with _lock:
        if _db is None:
            if os.environ.get("FIRESTORE_EMULATOR_HOST"):
                from google.auth.credentials import AnonymousCredentials
                _db = firestore.Client(project=_project_id() or "demo-sieve", credentials=AnonymousCredentials())
            else:
                from firebase_admin import firestore as admin_firestore
                _app = app()
                _db = admin_firestore.client(_app)
    return _db


def read_presence(uid: str) -> Mapping[str, Any] | None:
    """RTDB presence/{uid}: {deviceId: {state, isHomeBase, lastChanged}} or None."""
    value = rtdb.reference(f"presence/{uid}", app=app()).get()
    return value if isinstance(value, Mapping) else None


def now() -> datetime:
    return datetime.now(timezone.utc)


def _is_contention(exc: BaseException) -> bool:
    if isinstance(exc, Aborted):
        return True
    # The client wraps an exhausted retry loop in ValueError("Failed to commit transaction ...") from Aborted.
    return type(exc) is ValueError and isinstance(exc.__cause__, Aborted)


_STRIPES = [threading.RLock() for _ in range(64)]


def key_lock(key: str) -> threading.RLock:
    """A process-local lock for one document path (striped, so memory stays bounded)."""
    return _STRIPES[int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16) % len(_STRIPES)]


def transact(client: firestore.Client, fn: Callable[..., T], *args: Any, attempts: int = 10,
             lock_key: str | None = None, **kwargs: Any) -> T:
    """Run fn(txn, *args, **kwargs) in a read-write transaction.

    Writers inside one instance (up to 20 request threads) first take a local lock on the document they
    read and write, so they never contend with each other: Firestore locks pessimistically, and parallel
    read-then-write transactions on one document (the audit head, a connector) otherwise wait for lock
    timeouts. The transaction still guards against other instances. The client library retries an
    aborted commit but not an abort raised by a read inside the transaction; this loop retries both,
    with a short jittered back-off."""
    if lock_key is not None:
        with key_lock(lock_key):
            return _transact(client, fn, args, kwargs, attempts)
    return _transact(client, fn, args, kwargs, attempts)


def _transact(client: firestore.Client, fn: Callable[..., T], args: tuple, kwargs: dict, attempts: int) -> T:
    delay = 0.02
    for attempt in range(attempts):
        txn = client.transaction(max_attempts=5)
        try:
            return firestore.transactional(fn)(txn, *args, **kwargs)
        except Exception as exc:  # noqa: BLE001 - re-raised unless it is contention
            if not _is_contention(exc) or attempt == attempts - 1:
                raise
        time.sleep(delay * (0.5 + random.random()))
        delay = min(delay * 2, 0.5)
    raise RuntimeError("unreachable")
