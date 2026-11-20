"""U1 to U3: link secrets, paths and the derived connector identity."""
import re

from sieve import config, links


def test_u1_new_link_secret_shape_and_uniqueness():
    secrets_ = [links.new_link_secret() for _ in range(1000)]
    assert all(len(s) == 43 and config.LINK_SECRET_RE.fullmatch(s) for s in secrets_)
    assert len(set(secrets_)) == 1000


def test_u2_extract_link_secret():
    s = links.new_link_secret()
    assert links.extract_link_secret(f"/mcp/{s}") == s
    assert links.extract_link_secret(f"/{s}") == s
    assert links.extract_link_secret(f"/mcp/{s}/") == s
    assert links.extract_link_secret(f"/mcp/{s}/x") is None
    assert links.extract_link_secret("/mcp/short") is None
    assert links.extract_link_secret(f"/mcp/{s}?q") is None
    assert links.extract_link_secret(f"/mcp/{s}\n") is None


def test_u3_identity_is_deterministic_and_separated():
    s1, s2 = links.new_link_secret(), links.new_link_secret()
    a = links.derive_connector_identity(s1, "g" * 20)
    b = links.derive_connector_identity(s1, "g" * 20)
    assert a.fingerprint == b.fingerprint and re.fullmatch(r"[0-9a-f]{16}", a.fingerprint)
    assert links.derive_connector_identity(s1, "h" * 20).fingerprint != a.fingerprint
    assert links.derive_connector_identity(s2, "g" * 20).fingerprint != a.fingerprint
    assert a.agent_id == "grant-" + "g" * 20
    assert links.identity_uri(a.agent_id, a.fingerprint) == a.uri


def test_link_hash_hint_and_build():
    s = links.new_link_secret()
    assert re.fullmatch(r"[0-9a-f]{64}", links.link_hash(s))
    assert links.link_hint(s) == s[-4:]
    assert links.build_link("https://sieve.manideep.info/", s) == f"https://sieve.manideep.info/mcp/{s}"
