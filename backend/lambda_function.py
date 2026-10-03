"""Advisor Match agent Lambda.

Routes (Lambda Function URL, JSON in / JSON out):
  POST /chat      {message, session_id?, lang?, simple?} -> {session_id, reply, matches?, booking?, briefing?}
  POST /speak     {text, lang?}                           -> {audio_b64}
  POST /metrics   {day?}                                  -> {day, funnel}
  POST /bookings  {}                                      -> {bookings}
  GET  /health                                            -> {ok}
"""
import base64
import datetime
import json
import os
import random
import uuid
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from strands import Agent, tool
from strands.models import BedrockModel
from strands.session.s3_session_manager import S3SessionManager

S3 = boto3.client("s3")
DDB = boto3.resource("dynamodb")
BR = boto3.client("bedrock-runtime")
POLLY = boto3.client("polly")
BOOKINGS = DDB.Table(os.environ["BOOKINGS_TABLE"])
FUNNEL = DDB.Table(os.environ["FUNNEL_TABLE"])
DATA_BUCKET = os.environ["DATA_BUCKET"]

_ADVISORS = None  # cached across warm invocations
UI = {}  # structured results for the frontend; reset on every /chat request

SYSTEM_PROMPT = """You are Advisor Match, a warm, patient guide that helps first-time investors
find the right financial advisor and feel ready for their first meeting.

How to talk:
- Ask ONE short question at a time. Keep replies under 80 words unless explaining a term.
- Use plain words a 6th grader understands. If you must use a financial term, explain it in one sentence.
- Always reply in the same language the user writes in (English, Spanish, or chinese).

What to learn before matching (ask naturally, skip what they already told you):
1. Their main goal (e.g., buy a home, pay off loans, start saving for retirement)
2. Their life stage / situation in a sentence
3. What worries them about money or meeting an advisor
4. Preferred language
5. Virtual or in-person meeting

Tools:
- As soon as you know the goal, language and meeting type, call search_advisors with a short
  plain-language summary of their needs. Then briefly say why each advisor fits (one line each)
  and ask which one they'd like to meet and what day/time works.
- When they choose an advisor and a time, ask for their first name if you don't have it,
  then call book_meeting.
- Right after booking, call create_advisor_briefing, then give the user a short
  "First Meeting Ready" kit: 3 terms explained simply, 4 questions to ask (always include
  "How are you paid?" and "What will this cost me?"), and a what-to-bring checklist.
  Mention they will receive a Form CRS (a short summary of how the advisor works and is paid).

Rules:
- Never recommend specific investments, funds, allocations, or tell anyone what to buy, sell or hold.
  Educate, then say it's a great question for their advisor.
- Never ask for Social Security numbers, account numbers or passwords.
- Advisors shown are from a demo dataset."""


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


def public_advisor(a, score=None):
    out = {k: a[k] for k in ("advisor_id", "name", "city", "languages", "meeting_types", "focus", "bio")}
    out["brokercheck_url"] = "https://brokercheck.finra.org/"
    if score is not None:
        out["fit"] = "Strong fit" if score > 0.45 else "Good fit"
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


# ---------- agent tools ----------
@tool
def search_advisors(needs: str, language: str = "English", meeting_type: str = "virtual") -> list:
    """Find the 3 best-fit advisors for this person.

    Args:
        needs: plain-language summary of the person's goals, situation and worries.
        language: preferred language, e.g. "English" or "Spanish".
        meeting_type: "virtual" or "in-person".
    """
    q = embed(needs)
    lambda_handlerang = language.strip().capitalize()
    lang = {"Chinese": "Mandarin", "中文": "Mandarin", "Español": "Spanish", "Spanish": "Spanish"}.get(lang, lang)
    mt = "in-person" if "person" in meeting_type.lower() else "virtual"
    pool = [a for a in advisors() if lang in a["languages"] and mt in a["meeting_types"] and a["open_slots"] > 0]
    if len(pool) < 3:  # relax filters rather than return nothing
        pool = [a for a in advisors() if lang in a["languages"]] or advisors()
    scored = sorted(((sum(x * y for x, y in zip(q, a["embedding"])), a) for a in pool), key=lambda t: -t[0])[:6]
    # Small random jitter spreads leads across near-equal fits (fairness) instead of always the same top 3.
    picks = sorted(scored, key=lambda t: -(t[0] + random.uniform(0, 0.02)))[:3]
    UI["matches"] = [public_advisor(a, s) for s, a in picks]
    log_event("matched", UI["session_id"])
    return UI["matches"]


@tool
def book_meeting(advisor_id: str, prospect_name: str, time_slot: str) -> dict:
    """Book a first meeting with the chosen advisor.

    Args:
        advisor_id: the advisor_id from search_advisors.
        prospect_name: the person's first name.
        time_slot: the day and time they chose, in plain words.
    """
    adv = next((a for a in advisors() if a["advisor_id"] == advisor_id), None)
    booking = {
        "booking_id": uuid.uuid4().hex[:10],
        "advisor_id": advisor_id,
        "advisor_name": adv["name"] if adv else advisor_id,
        "prospect_name": prospect_name,
        "time_slot": time_slot,
        "session_id": UI["session_id"],
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    BOOKINGS.put_item(Item=booking)
    UI["booking"] = booking
    log_event("booked", UI["session_id"])
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
    BOOKINGS.update_item(
        Key={"booking_id": booking_id},
        UpdateExpression="SET briefing = :b",
        ExpressionAttributeValues={":b": briefing},
    )
    UI["briefing"] = briefing
    log_event("briefing_sent", UI["session_id"])
    return "Briefing saved and sent to the advisor."


MODEL = BedrockModel(
    model_id=os.environ["MODEL_ID"],
    temperature=0.3,
    max_tokens=1200,
    guardrail_id=os.environ["GUARDRAIL_ID"],
    guardrail_version=os.environ["GUARDRAIL_VERSION"],
    guardrail_latest_message=True,
)


# ---------- handler ----------
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
            message = (body.get("message") or "").strip()
            if not message:
                return respond(400, {"error": "message is required"})
            UI.clear()
            session_id = body.get("session_id") or uuid.uuid4().hex
            UI["session_id"] = session_id
            if not body.get("session_id"):
                log_event("intake_started", session_id)
            if body.get("simple"):
                message += "\n\n(Please explain in very simple words.)"
                lang_hint = {"es": "Spanish", "zh": "Simplified Chinese"}.get(body.get("lang"))
                if lang_hint:
                    message += f"\n\n(Please reply in {lang_hint}.)"
            agent = Agent(
                model=MODEL,
                system_prompt=SYSTEM_PROMPT,
                callback_handler=None,
                tools=[search_advisors, book_meeting, create_advisor_briefing],
                session_manager=S3SessionManager(session_id=session_id, bucket=DATA_BUCKET, prefix="sessions/"),
            )
            result = agent(message)
            extras = {k: v for k, v in UI.items() if k != "session_id"}
            return respond(200, {"session_id": session_id, "reply": str(result).strip(), **extras})

        if path == "/speak":
            text = (body.get("text") or "")[:2900]
            if not text:
                return respond(400, {"error": "text is required"})
            voice = {"es": "Lupe", "zh": "Zhiyu"}.get(body.get("lang"), "Joanna")
            audio = POLLY.synthesize_speech(Text=text, OutputFormat="mp3", VoiceId=voice, Engine="neural")
            return respond(200, {"audio_b64": base64.b64encode(audio["AudioStream"].read()).decode()})

        if path == "/metrics":
            day = body.get("day") or today()
            items = FUNNEL.query(KeyConditionExpression=Key("day").eq(day))["Items"]
            counts = {}
            for i in items:
                counts[i["stage"]] = counts.get(i["stage"], 0) + 1
            return respond(200, {"day": day, "funnel": counts})

        if path == "/bookings":
            items = BOOKINGS.scan(Limit=100)["Items"]
            items.sort(key=lambda b: b.get("created_at", ""), reverse=True)
            return respond(200, {"bookings": items[:25]})

        return respond(404, {"error": f"unknown route {path}"})
    except Exception as e:  # surface errors to the UI during the hackathon
        print("ERROR", repr(e))
        return respond(500, {"error": type(e).__name__, "detail": str(e)[:500]})
