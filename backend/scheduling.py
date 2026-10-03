"""Meeting scheduling rules: which dates and times can be booked, and how a slot is labeled.

Pure Python (no AWS calls) so it is unit-testable. Times are the advisor's local time.
"""
import datetime

FIRST_SLOT = datetime.time(9, 0)
LAST_SLOT = datetime.time(18, 0)
SLOT_MINUTES = 30
MAX_DAYS_AHEAD = 60
MAX_PURPOSE_CHARS = 500


def all_times():
    """Every bookable start time, as "HH:MM" strings (09:00 ... 18:00 every 30 minutes)."""
    out, t = [], datetime.datetime.combine(datetime.date.today(), FIRST_SLOT)
    end = datetime.datetime.combine(datetime.date.today(), LAST_SLOT)
    while t <= end:
        out.append(t.strftime("%H:%M"))
        t += datetime.timedelta(minutes=SLOT_MINUTES)
    return out


TIMES = all_times()


def check_slot(date_str, time_str, today=None):
    """Return an error message if the date/time cannot be booked, else None."""
    today = today or datetime.date.today()
    try:
        day = datetime.date.fromisoformat(date_str)
    except (TypeError, ValueError):
        return "Pick a date."
    if day <= today:
        return "Pick a date from tomorrow onward."
    if day > today + datetime.timedelta(days=MAX_DAYS_AHEAD):
        return f"Pick a date within the next {MAX_DAYS_AHEAD} days."
    if day.weekday() >= 5:
        return "Advisors meet on weekdays. Pick Monday to Friday."
    if time_str not in TIMES:
        return "Pick one of the listed times."
    return None


def slot_key(advisor_id, date_str, time_str):
    """Key of the lock item that stops two people booking the same advisor at the same time."""
    return f"slot#{advisor_id}#{date_str}T{time_str}"


def slot_label(date_str, time_str):
    """Human-readable label, e.g. "Tue, Oct 14, 2026 at 6:00 PM"."""
    day = datetime.date.fromisoformat(date_str)
    t = datetime.datetime.strptime(time_str, "%H:%M")
    hour = t.strftime("%I").lstrip("0")
    return f"{day.strftime('%a, %b')} {day.day}, {day.year} at {hour}:{t.strftime('%M %p')}"
