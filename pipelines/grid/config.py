"""California Duck Curve configuration."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "grid" / "raw"
OUT = ROOT / "site" / "public" / "data" / "grid"

OUTLOOK = "https://www.caiso.com/outlook/history/{d}/{kind}.csv"
HISTORY_START = "2020-01-01"

# Weather points: the big load centres (heat drives air-conditioning) and the solar belt.
WEATHER_POINTS = {
    "la": (34.05, -118.25), "inland_empire": (34.06, -117.30), "san_diego": (32.72, -117.16),
    "bay_area": (37.55, -122.05), "sacramento": (38.58, -121.49), "fresno": (36.74, -119.79),
    "mojave": (35.05, -117.60), "central_valley_solar": (36.40, -120.10),
}
