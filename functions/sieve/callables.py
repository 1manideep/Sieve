"""on_call wrappers: auth, error mapping (30 sections 7.1 and 13). App Check is enforced by the decorator."""
from __future__ import annotations

from typing import Any, Callable

from firebase_functions import https_fn

from . import account, config, fb, grants, logs, ratchet_fs
from .errors import InputError, LimitReached, NotFound, Precondition

E = https_fn.FunctionsErrorCode


def require_user(req: https_fn.CallableRequest, *, allow_anonymous: bool) -> str:
    if req.auth is None or not req.auth.uid:
        raise https_fn.HttpsError(E.UNAUTHENTICATED, "Sign in first.")
    provider = ((req.auth.token or {}).get("firebase") or {}).get("sign_in_provider")
    if provider == "anonymous" and not allow_anonymous:
        raise https_fn.HttpsError(E.PERMISSION_DENIED, "Sign in with Google to connect an AI.")
    return req.auth.uid


def run_callable(fn: Callable[[], dict], *, event: str) -> dict:
    try:
        return fn()
    except https_fn.HttpsError:
        raise
    except InputError as exc:
        raise https_fn.HttpsError(E.INVALID_ARGUMENT, str(exc)) from None
    except NotFound as exc:
        raise https_fn.HttpsError(E.NOT_FOUND, str(exc)) from None
    except Precondition as exc:
        raise https_fn.HttpsError(E.FAILED_PRECONDITION, str(exc)) from None
    except LimitReached as exc:
        raise https_fn.HttpsError(E.RESOURCE_EXHAUSTED, str(exc)) from None
    except Exception as exc:  # noqa: BLE001 - ConfigError and anything else
        logs.log_event(event, status="error", reason=type(exc).__name__)
        logs.log_exception(event, exc)
        raise https_fn.HttpsError(E.INTERNAL, "Something went wrong. Try again.") from None


def issue_grant(req: https_fn.CallableRequest) -> dict:
    uid = require_user(req, allow_anonymous=False)
    return run_callable(lambda: grants.issue_grant(
        fb.db(), uid=uid, req=grants.parse_issue_request(req.data), secret=config.broker_secret_bytes(),
        base_url=config.public_base_url(), now=fb.now()), event="issue_grant")


def issue_playground_grant(req: https_fn.CallableRequest) -> dict:
    """00 D1 / 30 section 16: a one-day grant over Playground sample data; anonymous users allowed."""
    uid = require_user(req, allow_anonymous=True)

    def run() -> dict:
        r = grants.parse_playground_request(req.data)
        return grants.create_grant_records(fb.db(), uid=uid, req=r, secret=config.broker_secret_bytes(),
                                           base_url=config.public_base_url(), now=fb.now(),
                                           ttl_seconds=r.days * 86400)
    return run_callable(run, event="issue_playground_grant")


def narrow_grant(req: https_fn.CallableRequest) -> dict:
    uid = require_user(req, allow_anonymous=False)
    return run_callable(lambda: grants.narrow_grant(
        fb.db(), uid=uid, req=grants.parse_narrow_request(req.data), secret=config.broker_secret_bytes(),
        now=fb.now()), event="narrow_grant")


def revoke_grant(req: https_fn.CallableRequest) -> dict:
    uid = require_user(req, allow_anonymous=True)   # anonymous users may turn off their Playground grant
    return run_callable(lambda: grants.revoke_grant(fb.db(), uid=uid, grant_id=grants.parse_grant_id(req.data),
                                                    now=fb.now()), event="revoke_grant")


def get_audit_status(req: https_fn.CallableRequest) -> dict:
    uid = require_user(req, allow_anonymous=True)

    def run() -> dict:
        s = ratchet_fs.verify_chain(fb.db(), uid)
        return {"intact": s.intact, "entries": s.entries, "lastSeq": s.last_seq, "lastHash": s.last_hash,
                "brokenAtSeq": s.broken_at_seq, "truncated": s.truncated,
                "checkedAt": int(fb.now().timestamp() * 1000)}
    return run_callable(run, event="get_audit_status")


def delete_account(req: https_fn.CallableRequest) -> dict:
    uid = require_user(req, allow_anonymous=True)
    auth_time: Any = (req.auth.token or {}).get("auth_time") if req.auth else None
    return run_callable(lambda: account.delete_account(fb.db(), uid=uid, auth_time=auth_time, now=fb.now()),
                        event="delete_account")
