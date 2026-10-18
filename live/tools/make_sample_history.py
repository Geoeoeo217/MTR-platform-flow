"""Generate live/data/history-sample.csv: four weeks of SAMPLE alighting history.

This stands in for the historical data MTR would provide (door counts by station, day and time).
Each row is one train at one door: the share of people on board that got off there.
Storing a share instead of a head count lets the same history work for a full-size train
and for a small desk demo.

Usage:  python3 live/tools/make_sample_history.py
"""
import csv, datetime as dt, math, pathlib, random

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "history-sample.csv"
DOORS = 8
random.seed(2026)

# Door profile at Admiralty-style interchange: doors near the interchange stairs empty out most
AM_PROFILE = [.10, .16, .30, .22, .38, .32, .17, .11]
PM_PROFILE = [.15, .18, .24, .27, .26, .24, .20, .16]

def share(weekday, minute, door):
    h = minute / 60
    am = math.exp(-((h - 8.75) ** 2) / 1.0)
    pm = math.exp(-((h - 18.5) ** 2) / 1.6)
    weekend = weekday >= 5
    peak = (0.35 if weekend else 1.0) * (am + 0.8 * pm)
    mix = am / (am + pm + 1e-6)
    base = mix * AM_PROFILE[door] + (1 - mix) * PM_PROFILE[door]
    s = base * (0.55 + 0.45 * min(1, peak))
    if weekday == 0 and door == 4 and 8.5 <= h <= 9.5:   # Monday 09:00: many get off at door 5
        s *= 1.25
    return max(0.0, min(0.95, s * (1 + random.gauss(0, 0.12))))

today = dt.date.today()
start = today - dt.timedelta(days=28)
rows = 0
OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["date", "weekday", "slot_min", "door", "alight_share", "source"])
    for d in range(28):
        day = start + dt.timedelta(days=d)
        for minute in range(6 * 60, 23 * 60, 15):           # one sampled train per 15-minute slot
            for door in range(DOORS):
                w.writerow([day.isoformat(), day.weekday(), minute, door + 1, f"{share(day.weekday(), minute, door):.3f}", "sample"])
                rows += 1
print(f"{rows} rows written to {OUT}")
