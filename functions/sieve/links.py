"""Connector link secrets, hashes and the connector identity (30 section 5).

The link secret is the bearer credential. It is stored nowhere in plain text: the connector document
is keyed by its SHA-256, and the Ratchet identity the grant token is bound to is derived from it.
"""
from __future__ import annotations

import hashlib
import secrets

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from ratchet_core import Ed25519WorkloadIdentity

from .config import LINK_PATH_RE, LINK_SECRET_BYTES, LINK_SECRET_RE

_IDENTITY_SALT = b"sieve/connector-identity/v1"


def new_link_secret() -> str:
    return secrets.token_urlsafe(LINK_SECRET_BYTES)


def is_valid_link_secret(secret: str) -> bool:
    return isinstance(secret, str) and LINK_SECRET_RE.fullmatch(secret) is not None


def link_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("ascii")).hexdigest()


def link_hint(secret: str) -> str:
    return secret[-4:]


def build_link(base_url: str, secret: str) -> str:
    return f"{base_url.rstrip('/')}/mcp/{secret}"


def extract_link_secret(path: str) -> str | None:
    """LINK_PATH_RE on request.path. Accepts '/mcp/<s>' (via Hosting) and '/<s>' (direct function URL
    or the functions emulator). Anything else returns None."""
    if not isinstance(path, str):
        return None
    m = LINK_PATH_RE.fullmatch(path)
    return m.group(1) if m else None


def derive_connector_identity(secret: str, grant_id: str) -> Ed25519WorkloadIdentity:
    """Deterministic Ed25519 identity from the link secret: the same secret and grant always give the
    same fingerprint, and only a caller presenting the link can rebuild it."""
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=_IDENTITY_SALT,
               info=grant_id.encode("ascii")).derive(secret.encode("ascii"))
    return Ed25519WorkloadIdentity(f"grant-{grant_id}", private_key=Ed25519PrivateKey.from_private_bytes(key))


def identity_uri(agent_id: str, fingerprint: str) -> str:
    return f"ratchet://{agent_id}/{fingerprint}"
