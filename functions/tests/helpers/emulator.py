"""Emulator helpers: Auth tokens, callable client, RTDB REST, data reset, MCP posting (30 section 17)."""
from __future__ import annotations

import json
import os
import pathlib
import secrets
import uuid
from typing import Any

import requests

PROJECT = "demo-sieve"
REGION = "us-central1"
RTDB_NS = f"{PROJECT}-default-rtdb"
FUNCTIONS_DIR = pathlib.Path(__file__).resolve().parents[2]
REPO_ROOT = FUNCTIONS_DIR.parent

MODERN = "2026-07-28"
LEGACY = "2025-11-25"


def _host(var: str, default: str) -> str:
    return os.environ.get(var) or default


def fs_host() -> str:
    return _host("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")


def rtdb_host() -> str:
    return _host("FIREBASE_DATABASE_EMULATOR_HOST", "127.0.0.1:9000")


def auth_host() -> str:
    return _host("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")


def functions_base() -> str:
    return os.environ.get("SIEVE_FUNCTIONS_BASE", f"http://127.0.0.1:5001/{PROJECT}/{REGION}")


def hosting_base() -> str:
    return os.environ.get("SIEVE_HOSTING_BASE", "http://127.0.0.1:5000")


def functions_up() -> bool:
    try:
        r = requests.get(f"{functions_base()}/mcp/probe", timeout=3)
        return r.status_code == 405 and r.headers.get("Allow") == "POST"
    except requests.RequestException:
        return False


def hosting_up() -> bool:
    """True only when the Hosting emulator serves the /mcp rewrite (port 5000 is the AirPlay Receiver on macOS)."""
    try:
        r = requests.get(f"{hosting_base()}/mcp/probe", timeout=3)
        return r.status_code == 405 and r.headers.get("Allow") == "POST"
    except requests.RequestException:
        return False


# ---------- admin ----------

_app = None


def init_admin() -> Any:
    global _app
    import firebase_admin

    if _app is None:
        try:
            _app = firebase_admin.get_app()
        except ValueError:
            _app = firebase_admin.initialize_app(options={
                "projectId": PROJECT, "databaseURL": f"http://{rtdb_host()}?ns={RTDB_NS}"})
    os.environ.setdefault("GCLOUD_PROJECT", PROJECT)
    return _app


def admin_db() -> Any:
    from sieve import fb
    return fb.db()


def broker_secret() -> bytes:
    """The secret the Functions emulator uses: functions/.secret.local when present, else the demo fallback."""
    path = FUNCTIONS_DIR / ".secret.local"
    if path.exists():
        for line in path.read_text().splitlines():
            if line.startswith("RATCHET_BROKER_SECRET="):
                return bytes.fromhex(line.split("=", 1)[1].strip())
    from sieve.config import emulator_fallback_secret
    return bytes.fromhex(emulator_fallback_secret(PROJECT))


def reset_all() -> None:
    requests.delete(f"http://{fs_host()}/emulator/v1/projects/{PROJECT}/databases/(default)/documents", timeout=10)
    requests.put(f"http://{rtdb_host()}/.json?ns={RTDB_NS}", data="{}", headers={"Authorization": "Bearer owner"},
                 timeout=10)
    requests.delete(f"http://{auth_host()}/emulator/v1/projects/{PROJECT}/accounts", timeout=10)


# ---------- auth ----------

def sign_up(email: str | None = None, *, anonymous: bool = False) -> tuple[str, str]:
    body: dict[str, Any] = {"returnSecureToken": True}
    if not anonymous:
        body.update({"email": email or f"t{uuid.uuid4().hex[:10]}@example.com", "password": "pass-123456"})
    r = requests.post(f"http://{auth_host()}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake",
                      json=body, timeout=10)
    r.raise_for_status()
    data = r.json()
    return data["localId"], data["idToken"]


def sign_in(email: str) -> str:
    r = requests.post(f"http://{auth_host()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake",
                      json={"email": email, "password": "pass-123456", "returnSecureToken": True}, timeout=10)
    r.raise_for_status()
    return r.json()["idToken"]


def auth_user_exists(uid: str) -> bool:
    r = requests.post(f"http://{auth_host()}/identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:lookup",
                      json={"localId": [uid]}, headers={"Authorization": "Bearer owner"}, timeout=10)
    return bool(r.ok and r.json().get("users"))


# ---------- callables ----------

class CallableError(Exception):
    def __init__(self, status: str, message: str) -> None:
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message


def call(name: str, data: Any, id_token: str | None = None) -> Any:
    headers = {"Content-Type": "application/json"}
    if id_token:
        headers["Authorization"] = f"Bearer {id_token}"
    r = requests.post(f"{functions_base()}/{name}", json={"data": data}, headers=headers, timeout=60)
    body = r.json()
    if "error" in body:
        raise CallableError(body["error"].get("status", ""), body["error"].get("message", ""))
    return body["result"]


# ---------- RTDB and devices ----------

def set_presence(uid: str, device: str, online: bool, *, is_home_base: bool = True,
                 id_token: str | None = None) -> requests.Response:
    import time as _time
    value = {"state": "online" if online else "offline", "isHomeBase": is_home_base,
             "lastChanged": int(_time.time() * 1000)}
    url = f"http://{rtdb_host()}/presence/{uid}/{device}.json?ns={RTDB_NS}"
    if id_token:
        return requests.put(f"{url}&auth={id_token}", data=json.dumps(value), timeout=10)
    return requests.put(url, data=json.dumps(value), headers={"Authorization": "Bearer owner"}, timeout=10)


def add_device(db: Any, uid: str, device: str, fcm_token: str | None = None, *, is_home_base: bool = True) -> None:
    from sieve import fb
    data: dict[str, Any] = {"label": "Test Mac", "isHomeBase": is_home_base, "updatedAt": fb.now()}
    if fcm_token:
        data["fcmToken"] = fcm_token
    db.collection(f"users/{uid}/devices").document(device).set(data)


def online_home_base(db: Any, uid: str, device: str = "device-test-1", fcm_token: str | None = None) -> str:
    add_device(db, uid, device, fcm_token)
    set_presence(uid, device, True)
    return device


# ---------- MCP ----------

def mcp_url(secret: str, *, via: str = "functions") -> str:
    if via == "hosting":
        return f"{hosting_base()}/mcp/{secret}"
    return f"{functions_base()}/mcp/{secret}"


def secret_from_link(link: str) -> str:
    return link.rstrip("/").rsplit("/", 1)[-1]


def random_secret() -> str:
    return secrets.token_urlsafe(32)


def mcp_post(secret: str, body: Any, headers: dict[str, str] | None = None, *, via: str = "functions",
             raw: bytes | None = None, timeout: float = 70) -> requests.Response:
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    data = raw if raw is not None else json.dumps(body).encode("utf-8")
    return requests.post(mcp_url(secret, via=via), data=data, headers=h, timeout=timeout)


class LegacySession:
    """initialize, then notifications/initialized; later calls carry MCP-Protocol-Version 2025-11-25."""

    def __init__(self, secret: str, *, via: str = "functions") -> None:
        self.secret = secret
        self.via = via
        self._id = 0
        r = mcp_post(secret, {"jsonrpc": "2.0", "id": self._next(), "method": "initialize",
                              "params": {"protocolVersion": LEGACY, "capabilities": {},
                                         "clientInfo": {"name": "sieve-tests", "version": "1"}}}, via=via)
        r.raise_for_status()
        self.initialize_result = r.json()["result"]
        n = mcp_post(secret, {"jsonrpc": "2.0", "method": "notifications/initialized"},
                     {"MCP-Protocol-Version": LEGACY}, via=via)
        assert n.status_code == 202, n.status_code

    def _next(self) -> int:
        self._id += 1
        return self._id

    def post(self, method: str, params: dict[str, Any] | None = None) -> requests.Response:
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": self._next(), "method": method}
        if params is not None:
            body["params"] = params
        return mcp_post(self.secret, body, {"MCP-Protocol-Version": LEGACY}, via=self.via)

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        r = self.post("tools/call", {"name": name, "arguments": arguments})
        r.raise_for_status()
        body = r.json()
        assert "result" in body, body
        return body["result"]


def modern_call(secret: str, method: str, params: dict[str, Any] | None = None, *,
                headers: dict[str, str] | None = None, via: str = "functions", msg_id: int = 1) -> requests.Response:
    p = dict(params or {})
    p["_meta"] = {"io.modelcontextprotocol/protocolVersion": MODERN,
                  "io.modelcontextprotocol/clientCapabilities": {}}
    h = {"MCP-Protocol-Version": MODERN, "Mcp-Method": method}
    if method == "tools/call":
        h["Mcp-Name"] = str(p.get("name"))
    h.update(headers or {})
    return mcp_post(secret, {"jsonrpc": "2.0", "id": msg_id, "method": method, "params": p}, h, via=via)


def structured(result: dict[str, Any]) -> dict[str, Any]:
    """structuredContent, checked against the JSON text block it must equal."""
    text = json.loads(result["content"][0]["text"])
    if "structuredContent" in result:
        assert result["structuredContent"] == text
    return text


def grant_for(id_token: str, *, max_step: str = "full", categories: list[str] | None = None,
              sources: list[str] | None = None, days: int | None = None, ai_name: str = "Test AI") -> dict[str, Any]:
    data: dict[str, Any] = {"aiName": ai_name, "maxStep": max_step,
                            "allowedCategories": categories or ["Home", "Work", "Money", "Health", "Travel",
                                                                "Shopping", "Personal", "Newsletters", "Photos"],
                            "allowedSources": sources or ["gmail"]}
    if days is not None:
        data["days"] = days
    return call("issueGrant", data, id_token)


def audit_entries(db: Any, uid: str) -> list[dict[str, Any]]:
    return [s.to_dict() for s in db.collection(f"audit/{uid}/entries").order_by("seq").stream()]


def requests_of(db: Any, uid: str) -> list[Any]:
    return list(db.collection(f"users/{uid}/requests").stream())
