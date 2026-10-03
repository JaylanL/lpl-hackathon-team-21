"""Advisor Match agent Lambda.

Routes (Lambda Function URL, JSON in / JSON out):
  POST /chat      {message, session_id?, lang?, simple?} -> {session_id, reply, progress, matches?, booking?, briefing?}
  POST /speak     {text, lang?}                           -> {audio_b64}
  POST /metrics   {day?}                                  -> {day, funnel}
  POST /bookings  {}                                      -> {bookings}
  POST /advisors  {language?, meeting_type?, text?}       -> {advisors, total}
  POST /availability {advisor_id, date}                   -> {date, times: [{time, label, available}]}
  POST /bookings/update {booking_id, session_id, date?, time?, purpose?} -> {booking}
/chat also accepts booking: {advisor_id, first_name, date, time, purpose} from the booking form.
  GET  /health                                            -> {ok}

Matching logic lives in matching.py, metrics/logging in observability.py, CRM sync in crm_sync.py.
See docs/skills-applied.md for which skill each piece implements.
"""
import base64
import datetime
import json
import os
import time
import uuid
from decimal import Decimal
from typing import Optional

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from pydantic import BaseModel, Field, ValidationError
from strands import Agent, tool
from strands.models import BedrockModel
from strands.session.s3_session_manager import S3SessionManager

import matching
import scheduling
from observability import emit_metric, log

S3 = boto3.client("s3")
DDB = boto3.resource("dynamodb")
BR = boto3.client("bedrock-runtime")
POLLY = boto3.client("polly")
EVENTS = boto3.client("events")
BOOKINGS = DDB.Table(os.environ["BOOKINGS_TABLE"])
FUNNEL = DDB.Table(os.environ["FUNNEL_TABLE"])
INTAKE = DDB.Table(os.environ["INTAKE_TABLE"])
DATA_BUCKET = os.environ["DATA_BUCKET"]
EVENT_BUS = os.environ.get("EVENT_BUS", "")
SESSION_TTL_SECONDS = 24 * 3600  # SKILL-01: anonymous intake state expires after 24h

_ADVISORS = None  # cached across warm invocations
UI = {}  # structured results for the frontend; reset on every /chat request

SYSTEM_PROMPT = """You are Advisor Match, a warm, patient guide that helps first-time investors
find the right financial advisor and feel ready for their first meeting.

How to talk:
- Ask ONE short question at a time. Keep replies under 80 words unless explaining a term.
- Use plain words a 6th grader understands. If you must use a financial term, explain it in one sentence.
- Always reply in the same language the user writes in (English, Spanish or Mandarin).

What to learn before matching (ask naturally, skip what they already told you):
1. Their main goal (e.g., buy a home, pay off loans, start saving for retirement)
2. Their life stage / situation in a sentence
3. What worries them about money or meeting an advisor
4. Preferred language
5. Virtual or in-person meeting
Nice to know (only if it comes up naturally): whether they want an advisor to guide them or to help
them decide themselves, and how often they want to hear from their advisor.

Tools:
- Whenever you learn any of the above, call record_preferences with just the new facts.
- As soon as you know the goal, language and meeting type, call search_advisors with a short
  plain-language summary of their needs. If they said what matters most to them (expertise,
  language, meeting type or availability), pass it as most_important. Then briefly say why each
  advisor fits (one line each, using the reasons the tool returned) and ask which one they'd like
  to meet and what day/time works.
- The app has a booking form where they pick a date, a time and what the meeting is for. When they
  choose an advisor, tell them to use it. If they only chat, ask for their first name and a time,
  then call book_meeting with the advisor_id exactly as search_advisors returned it.
- If a message says the meeting is already booked, never call book_meeting again.
- Right after booking, call create_advisor_briefing, then give the user a short
  "First Meeting Ready" kit: 3 terms explained simply, 4 questions to ask (always include
  "How are you paid?" and "What will this cost me?"), and a what-to-bring checklist.
  Mention they will receive a Form CRS (a short summary of how the advisor works and is paid).

Rules:
- Never recommend specific investments, funds, allocations, or tell anyone what to buy, sell or hold.
  Educate, then say it's a great question for their advisor.
- Only mention advisors returned by search_advisors. Never invent names, credentials or IDs.
- Never ask for Social Security numbers, account numbers, emails, phone numbers, addresses or passwords.
- Advisors shown are from a demo dataset."""


# ---------- request schemas (SKILL-09: validate every request) ----------
class BookingForm(BaseModel):
    advisor_id: str = Field(pattern=r"^adv-[0-9]{1,6}$")
    first_name: str = Field(min_length=1, max_length=40)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    purpose: str = Field(default="", max_length=scheduling.MAX_PURPOSE_CHARS)


class AvailabilityRequest(BaseModel):
    advisor_id: str = Field(pattern=r"^adv-[0-9]{1,6}$")
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class BookingUpdate(BaseModel):
    booking_id: str = Field(pattern=r"^[a-f0-9]{10}$")
    session_id: str = Field(pattern=r"^[A-Za-z0-9-]{8,64}$")
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    purpose: Optional[str] = Field(default=None, max_length=scheduling.MAX_PURPOSE_CHARS)
    lang: str = "English"


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9-]{8,64}$")
    lang: str = "English"
    simple: bool = False
    selected_advisor_id: Optional[str] = Field(default=None, pattern=r"^adv-[0-9]{1,6}$")
    booking: Optional[BookingForm] = None


class DirectoryRequest(BaseModel):
    language: str = Field(default="", max_length=30)
    meeting_type: str = Field(default="", max_length=30)
    text: str = Field(default="", max_length=100)


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1)
    lang: str = "en"


# ---------- helpers ----------
def advisors():
    global _ADVISORS
    if _ADVISORS is None:
        obj = S3.get_object(Bucket=DATA_BUCKET, Key="advisors.json")
        _ADVISORS = json.loads(obj["Body"].read())
    return _ADVISORS


def embed(text):
    r = BR.invoke_model(
        modelId="amazon.titan-embed-text-v2:0",
        body=json.dumps({"inputText": text[:8000], "normalize": True}),
    )
    return json.loads(r["body"].read())["embedding"]


def today():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


def log_event(stage, session_id):
    now = datetime.datetime.now(datetime.timezone.utc)
    FUNNEL.put_item(
        Item={
            "day": now.strftime("%Y-%m-%d"),
            "ts_id": f"{now.isoformat()}#{uuid.uuid4().hex[:6]}",
            "stage": stage,
            "session_id": session_id,
        }
    )


def get_state(session_id):
    item = INTAKE.get_item(Key={"session_id": session_id}).get("Item") or {}
    return {"slots": item.get("slots", {}), "matched_ids": item.get("matched_ids", []),
            "compliance_flags": item.get("compliance_flags", [])}


def save_state(session_id, **fields):
    names = {f"#{k}": k for k in fields}
    values = {f":{k}": v for k, v in fields.items()}
    names["#exp"], values[":exp"] = "expires_at", int(time.time()) + SESSION_TTL_SECONDS
    INTAKE.update_item(
        Key={"session_id": session_id},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in [*fields, "exp"]),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def add_compliance_flag(session_id, flag):
    state = get_state(session_id)
    save_state(session_id, compliance_flags=(state["compliance_flags"] + [flag])[-20:])
    log_event(flag.split(":")[0], session_id)


def public_advisor(scored, ahp, prefs):
    a = scored["advisor"]
    out = {k: a[k] for k in ("advisor_id", "name", "city", "languages", "meeting_types", "focus", "bio")}
    if a.get("photo_url"):
        out["photo_url"] = a["photo_url"]
    out["match_score"] = round(scored["score"] * 100)
    out["fit"] = "Strong fit" if scored["score"] >= 0.75 else "Good fit"
    out["reasons"] = matching.match_reasons(a, scored["criteria"], prefs)
    out["drivers"] = matching.top_drivers(ahp["weights"])
    out["disclosure"] = matching.fee_disclosure(a)
    return out


def _json_default(o):
    if isinstance(o, Decimal):
        return int(o) if o == int(o) else float(o)
    return str(o)


def respond(status, payload):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload, default=_json_default),
    }


def publish_booking_event(booking, briefing, slots, detail_type="ClientConsultationBooked"):
    """SKILL-05/10: hand the booking to the CRM pipeline asynchronously (EventBridge -> SQS -> crm_sync)."""
    if not EVENT_BUS:
        return
    detail = {"booking": booking, "briefing": briefing,
              "preferences": {k: v for k, v in slots.items() if k != "worries"}}
    res = EVENTS.put_events(Entries=[{
        "Source": "advisor-match.booking",
        "DetailType": detail_type,
        "Detail": json.dumps(detail, default=_json_default),
        "EventBusName": EVENT_BUS,
    }])
    if res.get("FailedEntryCount"):
        log("booking_event_failed", booking_id=booking["booking_id"], entries=res.get("Entries"), level="ERROR")
        emit_metric("BookingEventFailed")


# ---------- scheduled bookings (booking form: date, time, meeting purpose) ----------
class SlotTaken(Exception):
    pass


def lock_slot(advisor_id, date, time_, booking_id):
    """Claim advisor+date+time so nobody else can book it. Raises SlotTaken if it is already claimed."""
    try:
        BOOKINGS.put_item(
            Item={"booking_id": scheduling.slot_key(advisor_id, date, time_), "kind": "slot_lock",
                  "for_booking": booking_id},
            ConditionExpression="attribute_not_exists(booking_id)",
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise SlotTaken() from e
        raise


def taken_times(advisor_id, date):
    keys = [{"booking_id": scheduling.slot_key(advisor_id, date, t)} for t in scheduling.TIMES]
    res = DDB.batch_get_item(RequestItems={BOOKINGS.name: {"Keys": keys, "ProjectionExpression": "booking_id"}})
    found = {i["booking_id"] for i in res.get("Responses", {}).get(BOOKINGS.name, [])}
    return {t for t in scheduling.TIMES if scheduling.slot_key(advisor_id, date, t) in found}


def create_scheduled_booking(session_id, form, adv):
    booking_id = uuid.uuid4().hex[:10]
    lock_slot(adv["advisor_id"], form.date, form.time, booking_id)
    booking = {
        "booking_id": booking_id,
        "advisor_id": adv["advisor_id"],
        "advisor_name": adv["name"],
        "prospect_name": form.first_name.strip()[:40],
        "meeting_date": form.date,
        "meeting_time": form.time,
        "time_slot": scheduling.slot_label(form.date, form.time),
        "meeting_purpose": form.purpose.strip(),
        "session_id": session_id,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "crm_status": "pending",
    }
    BOOKINGS.put_item(Item=booking)
    if adv.get("open_slots", 0) > 0:
        adv["open_slots"] -= 1
    log_event("booked", session_id)
    emit_metric("BookingsCreated")
    return booking


def update_booking(req):
    """Save changes to date, time or meeting purpose. Only the session that made the booking may change it."""
    b = BOOKINGS.get_item(Key={"booking_id": req.booking_id}).get("Item")
    if not b or b.get("session_id") != req.session_id or b.get("kind") == "slot_lock":
        return respond(404, {"error": "not found", "detail": "We couldn't find that booking."})
    if req.purpose is not None and matching.screen_pii(req.purpose):
        return respond(400, {"error": "pii", "detail": matching.PII_REPLY.get(req.lang, matching.PII_REPLY["English"])})
    date = req.date or b.get("meeting_date")
    time_ = req.time or b.get("meeting_time")
    moved = (date, time_) != (b.get("meeting_date"), b.get("meeting_time"))
    if moved:
        problem = scheduling.check_slot(date, time_)
        if problem:
            return respond(400, {"error": "invalid slot", "detail": problem})
        try:
            lock_slot(b["advisor_id"], date, time_, b["booking_id"])
        except SlotTaken:
            return respond(409, {"error": "slot taken", "detail": "That time was just taken. Pick another time."})
        if b.get("meeting_date") and b.get("meeting_time"):
            BOOKINGS.delete_item(Key={"booking_id": scheduling.slot_key(b["advisor_id"], b["meeting_date"], b["meeting_time"])})
    purpose = b.get("meeting_purpose", "") if req.purpose is None else req.purpose.strip()
    b = BOOKINGS.update_item(
        Key={"booking_id": b["booking_id"]},
        UpdateExpression="SET meeting_date = :d, meeting_time = :t, time_slot = :l, meeting_purpose = :p, "
                         "updated_at = :u, crm_status = :s",
        ExpressionAttributeValues={":d": date, ":t": time_, ":l": scheduling.slot_label(date, time_), ":p": purpose,
                                   ":u": datetime.datetime.now(datetime.timezone.utc).isoformat(), ":s": "pending"},
        ReturnValues="ALL_NEW",
    )["Attributes"]
    try:
        publish_booking_event({k: v for k, v in b.items() if k != "briefing"}, b.get("briefing") or {},
                              get_state(req.session_id)["slots"], detail_type="ClientConsultationUpdated")
    except Exception as e:  # the change is saved; the alarm surfaces a failed CRM hand-off
        log("booking_event_failed", booking_id=b["booking_id"], error=repr(e), level="ERROR")
        emit_metric("BookingEventFailed")
    emit_metric("BookingsUpdated")
    return respond(200, {"booking": b})


# ---------- agent tools ----------
@tool
def record_preferences(
    goal: str = "", life_stage: str = "", worries: str = "", language: str = "", meeting_type: str = "",
    decision_style: str = "", communication_cadence: str = "",
) -> dict:
    """Save what you just learned about the person. Pass only fields you learned; leave others empty.

    Args:
        goal: their main money goal.
        life_stage: their situation in a sentence.
        worries: what makes them nervous about money or advisors.
        language: preferred language, e.g. "English", "Spanish" or "Mandarin".
        meeting_type: "virtual" or "in-person".
        decision_style: e.g. "wants to be guided" or "wants to decide with help".
        communication_cadence: how often they want to hear from an advisor.
    """
    sid = UI["session_id"]
    slots = matching.merge_slots(get_state(sid)["slots"], {
        "goal": goal, "life_stage": life_stage, "worries": worries, "language": language,
        "meeting_type": meeting_type, "decision_style": decision_style,
        "communication_cadence": communication_cadence,
    })
    save_state(sid, slots=slots)
    UI["progress"] = matching.intake_progress(slots)
    return UI["progress"]


@tool
def search_advisors(needs: str, language: str = "English", meeting_type: str = "virtual",
                    most_important: str = "") -> list:
    """Find the 3 best-fit advisors for this person.

    Args:
        needs: plain-language summary of the person's goals, situation and worries.
        language: preferred language, e.g. "English" or "Spanish".
        meeting_type: "virtual" or "in-person".
        most_important: optional; what matters most to them: "expertise", "language", "meeting" or "availability".
    """
    started = time.time()
    picks, ahp, prefs = matching.rank_advisors(embed(needs), advisors(), language, meeting_type, most_important)
    UI["matches"] = [public_advisor(s, ahp, prefs) for s in picks]
    # Auditability (SKILL-03): log the weights and consistency ratio behind every ranking.
    log("advisors_ranked", session_id=UI["session_id"], weights=ahp["weights"], cr=round(ahp["cr"], 4),
        advisor_ids=[m["advisor_id"] for m in UI["matches"]])
    emit_metric("MatchLatency", round((time.time() - started) * 1000, 1), "Milliseconds")
    save_state(UI["session_id"], matched_ids=[m["advisor_id"] for m in UI["matches"]])
    log_event("matched", UI["session_id"])
    return [{k: m[k] for k in ("advisor_id", "name", "city", "languages", "meeting_types", "focus",
                               "match_score", "reasons")} for m in UI["matches"]]


@tool
def book_meeting(advisor_id: str, prospect_name: str, time_slot: str) -> dict:
    """Book a first meeting with the chosen advisor.

    Args:
        advisor_id: the advisor_id exactly as returned by search_advisors.
        prospect_name: the person's first name.
        time_slot: the day and time they chose, in plain words.
    """
    state = get_state(UI["session_id"])
    adv = next((a for a in advisors() if a["advisor_id"] == advisor_id), None)
    if adv is None or not matching.is_known_advisor(advisor_id, state["matched_ids"]):
        # SKILL-02: never book an advisor the retrieval step did not return.
        log("booking_rejected_unknown_advisor", advisor_id=advisor_id, level="WARN")
        emit_metric("OutOfInventoryBlocked")
        return {"error": "Unknown advisor_id. Only book one of the advisors returned by search_advisors.",
                "valid_advisor_ids": state["matched_ids"]}
    if adv and adv["open_slots"] > 0:
        adv["open_slots"] -= 1  # reflect reduced availability for the rest of this warm container's life
    booking = {
        "booking_id": uuid.uuid4().hex[:10],
        "advisor_id": advisor_id,
        "advisor_name": adv["name"],
        "prospect_name": prospect_name.strip()[:40],
        "time_slot": time_slot,
        "session_id": UI["session_id"],
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "crm_status": "pending",
    }
    BOOKINGS.put_item(Item=booking)
    UI["booking"] = booking
    log_event("booked", UI["session_id"])
    emit_metric("BookingsCreated")
    return booking


@tool
def create_advisor_briefing(
    booking_id: str, goals: str, worries: str, topics_to_explain: str, communication_preferences: str
) -> str:
    """Save the one-page briefing the advisor receives before the first meeting. Write it in English.

    Args:
        booking_id: the booking_id returned by book_meeting.
        goals: the person's goals in 1-2 sentences.
        worries: what they are nervous or unsure about.
        topics_to_explain: concepts the advisor should explain simply.
        communication_preferences: language, meeting type, accessibility needs, follow-up preferences.
    """
    briefing = {
        "goals": goals,
        "worries": worries,
        "topics_to_explain": topics_to_explain,
        "communication_preferences": communication_preferences,
    }
    booking = BOOKINGS.update_item(
        Key={"booking_id": booking_id},
        UpdateExpression="SET briefing = :b",
        ExpressionAttributeValues={":b": briefing},
        ReturnValues="ALL_NEW",
    )["Attributes"]
    UI["briefing"] = briefing
    log_event("briefing_sent", UI["session_id"])
    try:
        publish_booking_event({k: v for k, v in booking.items() if k != "briefing"}, briefing,
                              get_state(UI["session_id"])["slots"])
    except Exception as e:  # the user-facing booking already succeeded; the alarm surfaces this
        log("booking_event_failed", booking_id=booking_id, error=repr(e), level="ERROR")
        emit_metric("BookingEventFailed")
    return "Briefing saved and sent to the advisor."


MODEL = BedrockModel(
    model_id=os.environ["MODEL_ID"],
    temperature=0.3,
    max_tokens=1200,
)


# ---------- routes ----------
def chat(body):
    req = ChatRequest(**body)
    UI.clear()
    session_id = req.session_id or uuid.uuid4().hex
    UI["session_id"] = session_id
    if not req.session_id:
        log_event("intake_started", session_id)

    # SKILL-01: zero upfront PII. Blocked text never reaches the model, the session store or the logs.
    pii = matching.screen_pii(req.message)
    if pii:
        add_compliance_flag(session_id, f"pii_blocked:{','.join(pii)}")
        emit_metric("PiiBlocked")
        reply = matching.PII_REPLY.get(req.lang, matching.PII_REPLY["English"])
        return respond(200, {"session_id": session_id, "reply": reply, "pii_blocked": True,
                             "progress": matching.intake_progress(get_state(session_id)["slots"])})

    message = req.message + ("\n\n(Please explain in very simple words.)" if req.simple else "")
    message += f"\n\n(Please reply in {req.lang}.)"
    # Picked from the advisor directory: the ID comes from the real inventory, so it may be booked (SKILL-02).
    if req.selected_advisor_id:
        picked = next((a for a in advisors() if a["advisor_id"] == req.selected_advisor_id), None)
        if picked:
            state = get_state(session_id)
            if picked["advisor_id"] not in state["matched_ids"]:
                save_state(session_id, matched_ids=state["matched_ids"] + [picked["advisor_id"]])
            message += f"\n\n(They picked {picked['name']} from the advisor directory: advisor_id {picked['advisor_id']}.)"
    # Booking form: create the booking deterministically, then let the agent write the briefing and prep kit.
    if req.booking:
        form = req.booking
        adv = next((a for a in advisors() if a["advisor_id"] == form.advisor_id), None)
        if adv is None:  # SKILL-02: only advisors that exist in the inventory can be booked
            return respond(404, {"error": "unknown advisor", "detail": "We couldn't find that advisor."})
        problem = scheduling.check_slot(form.date, form.time)
        if problem:
            return respond(400, {"error": "invalid slot", "detail": problem})
        if matching.screen_pii(form.purpose) or matching.screen_pii(form.first_name):
            add_compliance_flag(session_id, "pii_blocked:booking_form")
            emit_metric("PiiBlocked")
            return respond(400, {"error": "pii", "detail": matching.PII_REPLY.get(req.lang, matching.PII_REPLY["English"])})
        try:
            booking = create_scheduled_booking(session_id, form, adv)
        except SlotTaken:
            return respond(409, {"error": "slot taken", "detail": "That time was just taken. Pick another time."})
        UI["booking"] = booking
        message += (f"\n\n(The meeting is already booked: booking_id {booking['booking_id']}, {booking['prospect_name']} "
                    f"with {adv['name']} on {booking['time_slot']}. What they want to talk about: "
                    f"{booking['meeting_purpose'] or 'not given'}. Do not call book_meeting. Call create_advisor_briefing "
                    f"for this booking_id now, then give the First Meeting Ready kit.)")
    agent = Agent(
        model=MODEL,
        system_prompt=SYSTEM_PROMPT,
        callback_handler=None,
        tools=[record_preferences, search_advisors, book_meeting, create_advisor_briefing],
        session_manager=S3SessionManager(session_id=session_id, bucket=DATA_BUCKET, prefix="sessions/"),
    )
    started = time.time()
    result = agent(message)
    emit_metric("ChatLatency", round((time.time() - started) * 1000, 1), "Milliseconds")

    if "progress" not in UI:
        UI["progress"] = matching.intake_progress(get_state(session_id)["slots"])
    extras = {k: v for k, v in UI.items() if k != "session_id"}
    return respond(200, {"session_id": session_id, "reply": str(result).strip(), **extras})


def lambda_handler(event, context):
    path = event.get("rawPath", "/")
    raw = event.get("body") or "{}"
    try:
        body = json.loads(base64.b64decode(raw) if event.get("isBase64Encoded") else raw)
    except Exception:
        return respond(400, {"error": "invalid JSON"})

    try:
        if path == "/health":
            return respond(200, {"ok": True, "model": os.environ["MODEL_ID"]})

        if path == "/chat":
            return chat(body)

        if path == "/speak":
            req = SpeakRequest(**body)
            voice = "Zhiyu" if req.lang == "zh" else "Lupe" if req.lang == "es" else "Joanna"
            audio = POLLY.synthesize_speech(Text=req.text[:2900], OutputFormat="mp3", VoiceId=voice, Engine="neural")
            return respond(200, {"audio_b64": base64.b64encode(audio["AudioStream"].read()).decode()})

        if path == "/metrics":
            day = body.get("day") or today()
            items = FUNNEL.query(KeyConditionExpression=Key("day").eq(day))["Items"]
            counts = {}
            for i in items:
                counts[i["stage"]] = counts.get(i["stage"], 0) + 1
            return respond(200, {"day": day, "funnel": counts})

        if path == "/availability":
            req = AvailabilityRequest(**body)
            problem = scheduling.check_slot(req.date, scheduling.TIMES[0])
            if problem:
                return respond(400, {"error": "invalid date", "detail": problem})
            taken = taken_times(req.advisor_id, req.date)
            return respond(200, {"date": req.date, "times": [
                {"time": t, "label": scheduling.slot_label(req.date, t).split(" at ")[1], "available": t not in taken}
                for t in scheduling.TIMES]})

        if path == "/bookings/update":
            return update_booking(BookingUpdate(**body))

        if path == "/bookings":
            items = [i for i in BOOKINGS.scan(Limit=200)["Items"] if i.get("kind") != "slot_lock"]
            items.sort(key=lambda b: b.get("created_at", ""), reverse=True)
            return respond(200, {"bookings": items[:25]})

        if path == "/advisors":
            req = DirectoryRequest(**body)
            items = matching.directory(advisors(), req.language, req.meeting_type, req.text)
            return respond(200, {"advisors": items, "total": len(advisors())})

        return respond(404, {"error": f"unknown route {path}"})
    except ValidationError as e:
        detail = "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors())
        return respond(400, {"error": "invalid request", "detail": detail})
    except Exception as e:  # surface errors to the UI during the hackathon
        log("unhandled_error", path=path, error=repr(e), level="ERROR")
        emit_metric("UnhandledErrors")
        return respond(500, {"error": type(e).__name__, "detail": str(e)[:500]})
