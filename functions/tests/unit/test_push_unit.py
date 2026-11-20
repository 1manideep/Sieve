"""Push target and payload (01 section 11.5): FID first, nothing but the fixed notification."""
from sieve import push
from tests.helpers.fakes import FakeDb


class Capture:
    def __init__(self, outcomes=None):
        self.calls = []
        self.outcomes = outcomes

    def send(self, targets, payload, *, uid, request_id):
        self.calls.append((list(targets), payload))
        return self.outcomes or [None for _ in targets]


def test_fid_detection():
    assert push.is_fid("cGVyc29uYWwtZmlkLTAx22")
    assert not push.is_fid("fXyz:APA91bHun4MxP5egoKMwt2KZFBaFUH-1RYqx")


def test_payload_is_fixed():
    p = push.payload_for("https://sieve.manideep.info/")
    assert (p.title, p.body, p.link, dict(p.data)) == ("Sieve", "A request is waiting",
                                                        "https://sieve.manideep.info/requests",
                                                        {"kind": "request-waiting"})


def test_notify_reads_home_base_devices_and_drops_dead_targets():
    db = FakeDb()
    db.collection("users/u1/devices").document("dev-aaaaaaaa").set({"isHomeBase": True,
                                                                    "fcmToken": "cGVyc29uYWwtZmlkLTAx22"})
    db.collection("users/u1/devices").document("dev-bbbbbbbb").set({"isHomeBase": True, "fcmToken": "old:token"})
    db.collection("users/u1/devices").document("dev-cccccccc").set({"isHomeBase": False, "fcmToken": "x" * 22})
    sender = Capture(outcomes=[None, "unregistered"])
    assert push.notify_request_waiting(db, sender, uid="u1", request_id="r" * 20) == 1
    targets, payload = sender.calls[0]
    assert targets == ["cGVyc29uYWwtZmlkLTAx22", "old:token"] and payload.data == {"kind": "request-waiting"}
    assert "fcmToken" not in db.docs["users/u1/devices/dev-bbbbbbbb"]


def test_notify_respects_push_setting():
    db = FakeDb()
    db.collection("users").document("u1").set({"settings": {"pushEnabled": False}})
    db.collection("users/u1/devices").document("dev-aaaaaaaa").set({"isHomeBase": True, "fcmToken": "t" * 22})
    sender = Capture()
    assert push.notify_request_waiting(db, sender, uid="u1", request_id="r" * 20) == 0 and not sender.calls


def test_fcm_sender_builds_fid_and_token_messages(monkeypatch):
    from firebase_admin import messaging

    sent = {}

    class Resp:
        def __init__(self, ok, exc=None):
            self.success, self.exception = ok, exc

    class Batch:
        responses = [Resp(True), Resp(False, messaging.UnregisteredError("gone"))]

    def fake_send_each(messages, dry_run=False, app=None):
        sent["messages"] = messages
        return Batch()

    monkeypatch.setattr(messaging, "send_each", fake_send_each)
    monkeypatch.setattr(push.fb, "app", lambda: None)
    out = push.FcmPushSender().send(["cGVyc29uYWwtZmlkLTAx22", "legacy:token"],
                                    push.payload_for("https://sieve.manideep.info"), uid="u", request_id="r")
    assert out == [None, "unregistered"]
    m1, m2 = sent["messages"]
    assert m1.fid == "cGVyc29uYWwtZmlkLTAx22" and m1.token is None
    assert m2.token == "legacy:token" and m2.fid is None
    assert m1.data == {"kind": "request-waiting"} and m1.notification.title == "Sieve"
    assert m1.webpush.fcm_options.link == "https://sieve.manideep.info/requests"


def test_record_mode_only_in_emulator(monkeypatch):
    monkeypatch.setenv("SIEVE_PUSH_MODE", "record")
    monkeypatch.setattr(push.config, "IS_EMULATOR", False)
    assert isinstance(push.sender_from_config(FakeDb()), push.FcmPushSender)
    monkeypatch.setattr(push.config, "IS_EMULATOR", True)
    assert isinstance(push.sender_from_config(FakeDb()), push.RecordingPushSender)
