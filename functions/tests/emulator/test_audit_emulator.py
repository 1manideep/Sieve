"""E2, E3: the audit chain under parallel writers, and tamper detection."""
import multiprocessing
import threading

from sieve import authz, links, ratchet_fs
from tests.emulator._grants import connector_of, new_uid, short_grant
from tests.helpers import emulator as emu


def _calls(db, secret, uid, link_secret, n):
    conn = connector_of(db, link_secret)
    for i in range(n):
        authz.authorize_call(db, secret=secret, uid=uid, link_hash=links.link_hash(link_secret), connector=conn,
                             link_secret=link_secret, tool_name="sieve_answer", args={"question": f"Q{i}"})


def test_e2_parallel_appends_keep_one_chain(db, broker_secret):
    uid = new_uid()
    _, link_secret, _ = short_grant(db, uid, broker_secret)
    errors = []

    def worker():
        try:
            _calls(db, broker_secret, uid, link_secret, 25)
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    entries = emu.audit_entries(db, uid)
    assert [e["seq"] for e in entries] == list(range(1, 202))
    assert sum(1 for e in entries if e["tool_name"] == "sieve_answer") == 200
    status = ratchet_fs.verify_chain(db, uid)
    assert status.intact and status.entries == 201 and status.last_seq == 201 and not status.truncated
    assert db.collection("audit").document(uid).get().get("seq") == 201


def test_e3_tamper_detection(db, broker_secret):
    uid = new_uid()
    _, link_secret, _ = short_grant(db, uid, broker_secret)
    _calls(db, broker_secret, uid, link_secret, 9)
    assert ratchet_fs.verify_chain(db, uid).intact
    entries = db.collection(f"audit/{uid}/entries")
    entries.document("0000000004").update({"tool_name": "sieve_full_item"})
    s = ratchet_fs.verify_chain(db, uid)
    assert (s.intact, s.broken_at_seq) == (False, 4)
    entries.document("0000000004").update({"tool_name": "sieve_answer"})
    assert ratchet_fs.verify_chain(db, uid).intact
    entries.document("0000000010").delete()
    s = ratchet_fs.verify_chain(db, uid)
    assert not s.intact and s.broken_at_seq == 10


def test_verify_small_pages_and_empty(db, broker_secret):
    uid = new_uid()
    assert ratchet_fs.verify_chain(db, uid) == ratchet_fs.ChainStatus(True, 0, 0, "0" * 64, None, False)
    _, link_secret, _ = short_grant(db, uid, broker_secret)
    _calls(db, broker_secret, uid, link_secret, 6)
    s = ratchet_fs.verify_chain(db, uid, page_size=2)
    assert s.intact and s.entries == 7
    t = ratchet_fs.verify_chain(db, uid, max_entries=3)
    assert t.truncated and t.entries == 3


def _process_worker(uid: str, link_secret: str, secret_hex: str, n: int) -> None:
    from tests.helpers import emulator as emu_
    emu_.init_admin()
    db = emu_.admin_db()
    _calls(db, bytes.fromhex(secret_hex), uid, link_secret, n)


def test_e2b_appends_from_separate_processes(db, broker_secret):
    """Separate processes share no local lock, so only the Firestore transaction keeps the chain whole."""
    uid = new_uid()
    _, link_secret, _ = short_grant(db, uid, broker_secret)
    ctx = multiprocessing.get_context("spawn")
    procs = [ctx.Process(target=_process_worker, args=(uid, link_secret, broker_secret.hex(), 6)) for _ in range(2)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(timeout=110)
    assert all(p.exitcode == 0 for p in procs)
    status = ratchet_fs.verify_chain(db, uid)
    assert status.intact and status.entries == 13
    assert [e["seq"] for e in emu.audit_entries(db, uid)] == list(range(1, 14))
