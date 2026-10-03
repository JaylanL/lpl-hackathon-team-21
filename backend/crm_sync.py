"""CRM sync consumer (SKILL-05 crm_sync_scheduling_agent + SKILL-10 event-driven pipeline).

EventBridge (ClientConsultationBooked) -> SQS (with DLQ) -> this Lambda.
For each booking it writes a ClientWorks-shaped record to s3://DATA_BUCKET/crm-outbox/<booking_id>.json,
optionally POSTs it to CRM_WEBHOOK_URL with exponential backoff, and marks the booking as synced.
Failed records are reported individually so SQS retries only those (and parks repeat failures in the DLQ).
"""
import datetime
import json
import os
import time
import urllib.request

import boto3

from observability import emit_metric, log

_clients = {}


def client(name):
    if name not in _clients:
        _clients[name] = boto3.resource("dynamodb") if name == "dynamodb" else boto3.client(name)
    return _clients[name]


def to_crm_record(detail):
    """Map the booking event to the record an advisor CRM (ClientWorks / Redtail / Wealthbox) receives."""
    booking = detail["booking"]
    briefing = detail.get("briefing") or {}
    return {
        "external_id": booking["booking_id"],
        "source": "advisor-match",
        "advisor_id": booking["advisor_id"],
        "prospect": {"first_name": booking.get("prospect_name", "")},  # first name is the only PII captured
        "first_meeting": booking.get("time_slot", ""),
        "behavioral_brief": {
            "goals": briefing.get("goals", ""),
            "worries": briefing.get("worries", ""),
            "topics_to_explain": briefing.get("topics_to_explain", ""),
            "communication_preferences": briefing.get("communication_preferences", ""),
            "intake_preferences": detail.get("preferences", {}),
        },
    }


def post_with_backoff(url, payload, max_tries=4, base_delay=0.5):
    for attempt in range(1, max_tries + 1):
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status
        except Exception as e:  # noqa: BLE001 - any transport/HTTP error is retried
            if attempt == max_tries:
                raise
            log("crm_post_retry", attempt=attempt, error=repr(e), level="WARN")
            time.sleep(base_delay * 2 ** (attempt - 1))


def sync_one(detail):
    record = to_crm_record(detail)
    booking_id = record["external_id"]
    client("s3").put_object(
        Bucket=os.environ["DATA_BUCKET"], Key=f"crm-outbox/{booking_id}.json",
        Body=json.dumps(record).encode(), ContentType="application/json",
    )
    target = "s3-outbox"
    if os.environ.get("CRM_WEBHOOK_URL"):
        post_with_backoff(os.environ["CRM_WEBHOOK_URL"], record)
        target = "webhook"
    client("dynamodb").Table(os.environ["BOOKINGS_TABLE"]).update_item(
        Key={"booking_id": booking_id},
        UpdateExpression="SET crm_status = :s, crm_synced_at = :t, crm_target = :g",
        ExpressionAttributeValues={":s": "synced", ":g": target,
                                   ":t": datetime.datetime.now(datetime.timezone.utc).isoformat()},
    )
    return booking_id


def lambda_handler(event, context):
    failures = []
    for rec in event.get("Records", []):
        try:
            detail = json.loads(rec["body"])["detail"]
            booking_id = sync_one(detail)
            log("crm_synced", booking_id=booking_id)
            emit_metric("CrmSyncSucceeded", Service="crm-sync")
        except Exception as e:  # noqa: BLE001
            log("crm_sync_failed", message_id=rec.get("messageId"), error=repr(e), level="ERROR")
            emit_metric("CrmSyncFailed", Service="crm-sync")
            failures.append({"itemIdentifier": rec["messageId"]})
    return {"batchItemFailures": failures}
