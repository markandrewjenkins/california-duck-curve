# California Duck Curve

Demand / net-demand forecast scored against CAISO, duck curve, batteries. Region: California.

**Live dashboard: https://markandrewjenkins.github.io/california-duck-curve/**

Built only on free, open government and citizen-science data. A Python pipeline fetches and models the data,
and a static Vite + d3 + MapLibre page presents it. GitHub Actions refreshes everything daily and publishes it
to GitHub Pages.

## Method in brief

- **Forecast:** Hourly gradient boosting for gross demand and net demand (demand − solar − wind).
  - Inputs: calendar, temperature at six load centres, solar radiation and cloud over the Mojave and Central Valley, wind, and load from 2 and 7 days earlier.
  - Trained 2020 → June 2025, tested since July 2025, with gross demand scored against CAISO's own day-ahead forecast.
  - Result (Jul 2025 – Oct 2026): 3.1% hourly error vs 2.0% for CAISO's day-ahead forecast, and 2.6× better than "same hour last week". Net demand: ±1.5 GW vs ±3.2 GW for the same baseline.
- **Stories:** The spring weekday duck curve by year, battery charge/discharge profiles by year, the latest day's fuel mix, and renewable share.
  - The yearly minimum of hourly net demand fell from +4.7 GW (2020) to −8.9 GW (20 June 2026).
- **Data:** CAISO "Today's Outlook" daily files, cached one per day (about 4,900 files). Header capitalisation changes across years, so columns are normalised per file.

## Design

The page has a Classic design and a themed alternative, **Control Room** (engineering drawing / scada mimic board), switched with the
button in the top bar or with `?skin=alt` / `?skin=classic` in the URL. Each has a day and a night version.

## Running locally

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
.venv/Scripts/python -m pipelines.grid.fetch all
.venv/Scripts/python -m pipelines.grid.build
cd site && npm ci && npm run dev
```

Data licences are listed at the foot of the dashboard.
