"""Download inputs for California Duck Curve.

  python -m pipelines.grid.fetch [outlook|weather|all]

CAISO "Today's Outlook" daily history files (5-minute fuel mix and demand, including CAISO's own
day-ahead demand forecast), cached one file per day so reruns only fetch what's new.
Weather: hourly temperature and solar radiation from Open-Meteo (ERA5 archive for training,
forecast for the next days).
"""
from __future__ import annotations

import io
import sys
import time
from datetime import date, timedelta

import pandas as pd
import requests

from pipelines.common.http import get_json

from .config import HISTORY_START, OUTLOOK, RAW, WEATHER_POINTS

S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (compatible; open-data-portfolio/0.1)"


def outlook() -> None:
    cache = RAW / "outlook"
    cache.mkdir(parents=True, exist_ok=True)
    d = date.fromisoformat(HISTORY_START)
    end = date.today()
    n_new = 0
    while d <= end:
        for kind in ("fuelsource", "demand"):
            f = cache / f"{d:%Y%m%d}_{kind}.csv"
            if f.exists() and (d < end - timedelta(days=1)):
                continue
            r = S.get(OUTLOOK.format(d=f"{d:%Y%m%d}", kind=kind), timeout=60)
            if r.status_code == 200 and r.text.startswith("Time"):
                f.write_text(r.text, encoding="utf-8")
                n_new += 1
            time.sleep(0.25)
        if d.day == 1 and d.month in (1, 7):
            print(f"  {d}: {n_new} new files", flush=True)
        d += timedelta(days=1)
    assemble()


def assemble() -> None:
    """Stack the cached daily files into one five-minute table (header case varies across years)."""
    cache = RAW / "outlook"
    frames = []
    for kind in ("fuelsource", "demand"):
        rows = []
        for f in sorted(cache.glob(f"*_{kind}.csv")):
            df = pd.read_csv(f)
            df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
            df = df.dropna(subset=["time"])
            df["ts"] = pd.Timestamp(f.name[:8]) + pd.to_timedelta(df.time.astype(str) + ":00", errors="coerce")
            rows.append(df.drop(columns=["time"]).dropna(subset=["ts"]))
        k = pd.concat(rows)
        frames.append(k[~k.ts.duplicated()].set_index("ts"))
    out = frames[0].join(frames[1], how="outer").reset_index()
    out.to_parquet(RAW / "outlook.parquet", index=False)
    print(f"  outlook: {len(out):,} five-minute rows {out.ts.min()} → {out.ts.max()}", flush=True)


def weather() -> None:
    names = list(WEATHER_POINTS)
    lats = ",".join(str(WEATHER_POINTS[n][0]) for n in names)
    lons = ",".join(str(WEATHER_POINTS[n][1]) for n in names)
    hourly = "temperature_2m,shortwave_radiation,cloud_cover,wind_speed_100m"
    arch = get_json("https://archive-api.open-meteo.com/v1/archive", {
        "latitude": lats, "longitude": lons, "start_date": HISTORY_START, "end_date": (date.today() - timedelta(days=6)).isoformat(),
        "hourly": hourly, "timezone": "America/Los_Angeles"}, timeout=600)
    fc = get_json("https://api.open-meteo.com/v1/forecast", {
        "latitude": lats, "longitude": lons, "hourly": hourly, "past_days": 10, "forecast_days": 3, "timezone": "America/Los_Angeles"}, timeout=180)
    frames = []
    for src, data in (("archive", arch), ("forecast", fc)):
        for n, loc in zip(names, data):
            h = loc["hourly"]
            df = pd.DataFrame({k: h[k] for k in h if k != "time"})
            df["ts"] = pd.to_datetime(h["time"])
            df["point"], df["source"] = n, src
            frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    RAW.mkdir(parents=True, exist_ok=True)
    out.to_parquet(RAW / "weather.parquet", index=False)
    print(f"  weather: {len(out):,} hourly rows", flush=True)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what == "assemble":
        assemble()
    if what in ("weather", "all"):
        weather()
    if what in ("outlook", "all"):
        outlook()
