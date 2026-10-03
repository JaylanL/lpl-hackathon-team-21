import json

import crm_sync


class FakeS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[Key] = json.loads(Body)


class FakeTable:
    def __init__(self):
        self.updates = []

    def update_item(self, **kw):
        self.updates.append(kw)


class FakeDynamo:
    def __init__(self):
        self.table = FakeTable()

    def Table(self, name):
        return self.table


def event(*details):
    return {"Records": [{"messageId": f"m{i}", "body": json.dumps({"detail": d})} for i, d in enumerate(details)]}


DETAIL = {
    "booking": {"booking_id": "b1", "advisor_id": "adv-901", "prospect_name": "Ana", "time_slot": "Tue 6pm",
                "meeting_date": "2026-10-13", "meeting_time": "18:00", "meeting_purpose": "Plan for a first home"},
    "briefing": {"goals": "Buy a home"},
    "preferences": {"language": "Spanish"},
}


def setup(monkeypatch):
    s3, ddb = FakeS3(), FakeDynamo()
    monkeypatch.setattr(crm_sync, "_clients", {"s3": s3, "dynamodb": ddb})
    monkeypatch.setenv("DATA_BUCKET", "bucket")
    monkeypatch.setenv("BOOKINGS_TABLE", "bookings")
    monkeypatch.delenv("CRM_WEBHOOK_URL", raising=False)
    return s3, ddb


def test_sync_writes_outbox_and_marks_booking(monkeypatch):
    s3, ddb = setup(monkeypatch)
    assert crm_sync.lambda_handler(event(DETAIL), None) == {"batchItemFailures": []}
    rec = s3.objects["crm-outbox/b1.json"]
    assert rec["prospect"] == {"first_name": "Ana"}
    assert rec["behavioral_brief"]["intake_preferences"] == {"language": "Spanish"}
    assert rec["meeting"] == {"date": "2026-10-13", "time": "18:00", "purpose": "Plan for a first home", "updated_at": ""}
    assert ddb.table.updates[0]["ExpressionAttributeValues"][":s"] == "synced"


def test_bad_record_is_reported_individually(monkeypatch):
    setup(monkeypatch)
    res = crm_sync.lambda_handler(event({"oops": 1}, DETAIL), None)
    assert res == {"batchItemFailures": [{"itemIdentifier": "m0"}]}


def test_webhook_retries_then_fails(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setenv("CRM_WEBHOOK_URL", "https://crm.invalid/hook")
    calls = []

    def boom(*a, **k):
        calls.append(1)
        raise OSError("down")

    monkeypatch.setattr(crm_sync.urllib.request, "urlopen", boom)
    monkeypatch.setattr(crm_sync.time, "sleep", lambda s: None)
    res = crm_sync.lambda_handler(event(DETAIL), None)
    assert len(calls) == 4 and res["batchItemFailures"] == [{"itemIdentifier": "m0"}]
