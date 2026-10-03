import datetime

import scheduling

TODAY = datetime.date(2026, 10, 7)  # a Wednesday


def test_times_run_every_half_hour_from_9_to_6():
    assert scheduling.TIMES[0] == "09:00" and scheduling.TIMES[-1] == "18:00"
    assert len(scheduling.TIMES) == 19 and "12:30" in scheduling.TIMES


def test_valid_weekday_slot():
    assert scheduling.check_slot("2026-10-08", "10:30", today=TODAY) is None


def test_rejects_past_today_weekend_far_future_and_odd_times():
    assert "tomorrow" in scheduling.check_slot("2026-10-07", "10:00", today=TODAY)
    assert "tomorrow" in scheduling.check_slot("2026-10-01", "10:00", today=TODAY)
    assert "weekdays" in scheduling.check_slot("2026-10-10", "10:00", today=TODAY)  # Saturday
    assert "60 days" in scheduling.check_slot("2027-01-15", "10:00", today=TODAY)
    assert "listed times" in scheduling.check_slot("2026-10-08", "10:15", today=TODAY)
    assert "listed times" in scheduling.check_slot("2026-10-08", "19:00", today=TODAY)
    assert scheduling.check_slot("not-a-date", "10:00", today=TODAY) == "Pick a date."


def test_slot_key_and_label():
    assert scheduling.slot_key("adv-901", "2026-10-13", "18:00") == "slot#adv-901#2026-10-13T18:00"
    assert scheduling.slot_label("2026-10-13", "18:00") == "Tue, Oct 13, 2026 at 6:00 PM"
    assert scheduling.slot_label("2026-10-08", "09:30") == "Thu, Oct 8, 2026 at 9:30 AM"
