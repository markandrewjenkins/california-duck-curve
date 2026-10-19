"""California Duck Curve: demand and net-demand forecasts scored against CAISO, duck and battery stories.

  python -m pipelines.grid.build

Day-ahead forecast
    For each hour of tomorrow: gradient boosting on calendar (hour, weekday, holiday, season),
    weather at the load centres (temperature) and solar belt (radiation, cloud), and load from two
    and seven days earlier (known on the morning a day-ahead forecast is made). Separate models for
    gross demand and net demand (demand − solar − wind). Trained to mid-2025, tested on the months
    since, where the gross-demand forecast is scored against CAISO's own day-ahead forecast.
    Training uses reanalysis weather (ERA5); live forecasts use forecast weather, which adds error.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import holidays
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from .config import OUT, RAW, WEATHER_POINTS

SPLIT = pd.Timestamp("2025-07-01")
US_HOL = holidays.US(state="CA", years=range(2019, 2032))
LOAD_PTS = ["la", "inland_empire", "san_diego", "bay_area", "sacramento", "fresno"]
SOLAR_PTS = ["mojave", "central_valley_solar"]


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else round(float(o), 3)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (pd.Timestamp, datetime, date)):
        return o.isoformat()
    return o


def dump(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", encoding="utf-8") as f:
        json.dump(clean(obj), f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    print(f"  wrote {name} ({(OUT / name).stat().st_size / 1024:,.0f} KB)")


def hourly_grid(o: pd.DataFrame) -> pd.DataFrame:
    o = o.set_index("ts").sort_index()
    o = o[~o.index.duplicated()]
    h = o.resample("h").mean(numeric_only=True)
    h["net"] = h.current_demand - h.solar.clip(lower=0) - h.wind.clip(lower=0)
    return h


def weather_features(w: pd.DataFrame) -> pd.DataFrame:
    # forecast rows replace archive rows where both exist only after the archive ends
    w = w.sort_values(["source"]).drop_duplicates(["ts", "point"], keep="first")      # 'archive' < 'forecast'
    piv = w.pivot_table(index="ts", columns="point", values=["temperature_2m", "shortwave_radiation", "cloud_cover", "wind_speed_100m"])
    f = pd.DataFrame(index=piv.index)
    t = piv["temperature_2m"][LOAD_PTS]
    f["temp_mean"] = t.mean(axis=1)
    f["temp_max"] = t.max(axis=1)
    f["temp_inland"] = t[["inland_empire", "sacramento", "fresno"]].mean(axis=1)
    f["cooling"] = (t - 18).clip(lower=0).mean(axis=1)
    f["sun"] = piv["shortwave_radiation"][SOLAR_PTS].mean(axis=1)
    f["cloud"] = piv["cloud_cover"][SOLAR_PTS + ["la"]].mean(axis=1)
    f["wind"] = piv["wind_speed_100m"][["mojave"]].mean(axis=1)
    # heat builds up: yesterday's afternoon peak temperature matters for today's load
    daily_max = f.temp_inland.resample("D").max()
    f["prev_day_max"] = daily_max.shift(1).reindex(f.index.normalize()).to_numpy()
    return f


def design(h: pd.DataFrame, wf: pd.DataFrame, target: str) -> pd.DataFrame:
    idx = h.index.union(wf.index)
    X = pd.DataFrame(index=idx)
    X["hour"], X["dow"] = idx.hour, idx.dayofweek
    X["holiday"] = [int(d.date() in US_HOL) for d in idx]
    X["off"] = ((X.dow >= 5) | (X.holiday == 1)).astype(int)
    doy = idx.dayofyear
    X["doy_sin"], X["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    X["year"] = idx.year + doy / 366
    X = X.join(wf)
    y = h[target].reindex(idx)
    X["lag2"] = y.shift(48)
    X["lag7"] = y.shift(168)
    X["lag2_daymean"] = y.rolling(24).mean().shift(48)
    X["y"] = y
    return X


FEATS = ["hour", "dow", "holiday", "off", "doy_sin", "doy_cos", "year", "temp_mean", "temp_max", "temp_inland", "cooling",
         "sun", "cloud", "wind", "prev_day_max", "lag2", "lag7", "lag2_daymean"]


def gbm():
    return HistGradientBoostingRegressor(max_iter=600, learning_rate=0.05, max_leaf_nodes=48, min_samples_leaf=40,
                                         l2_regularization=1.0, random_state=21)


def fit_target(h, wf, target, tomorrow):
    X = design(h, wf, target)
    hist = X.dropna(subset=FEATS + ["y"])
    tr, te = hist[hist.index < SPLIT], hist[hist.index >= SPLIT]
    m = gbm().fit(tr[FEATS], tr.y)
    p = m.predict(te[FEATS])
    res = te.y.to_numpy() - p
    qh = pd.DataFrame({"r": res, "h": te.index.hour}).groupby("h").r.quantile([0.1, 0.9]).unstack()
    # MAPE only for gross demand: net demand crosses zero on spring afternoons
    out = {"mae": float(np.mean(np.abs(res))),
           "mae_persist": float(np.mean(np.abs(te.y - te.lag7))), "n_hours": int(len(te)),
           "test_from": te.index.min(), "test_to": te.index.max()}
    if target == "current_demand":
        out["mape"] = float(np.mean(np.abs(res) / te.y))
        caiso = h.day_ahead_forecast.reindex(te.index)
        ok = caiso.notna()
        out["mae_caiso"] = float(np.mean(np.abs(te.y[ok] - caiso[ok])))
        out["mape_caiso"] = float(np.mean(np.abs(te.y[ok] - caiso[ok]) / te.y[ok]))
        out["mae_model_same"] = float(np.mean(np.abs(res[ok.to_numpy()])))
        daily = pd.DataFrame({"y": te.y, "p": p, "c": caiso}).dropna().resample("D").apply(lambda d_: pd.Series(
            {"model": np.mean(np.abs(d_.y - d_.p)), "caiso": np.mean(np.abs(d_.y - d_.c))}))
        out["daily_mae"] = [[d_, r.model, r.caiso] for d_, r in daily.dropna().iterrows()][-120:]
    by_hour = pd.DataFrame({"e": np.abs(res), "h": te.index.hour}).groupby("h").e.mean()
    out["mae_by_hour"] = by_hour.round(0).tolist()
    # forecast for tomorrow (and the rest of today) with the full model
    mf = gbm().fit(hist[FEATS], hist.y)
    # gradient boosting handles missing lags natively, so a late CAISO file only blurs the forecast
    fut = X[(X.index >= tomorrow) & (X.index < tomorrow + pd.Timedelta(days=1))].dropna(subset=[f for f in FEATS if not f.startswith("lag")])
    fp = mf.predict(fut[FEATS]) if len(fut) else np.array([])
    out["forecast"] = [[t, float(v), float(v + qh.loc[t.hour, 0.1]), float(v + qh.loc[t.hour, 0.9])] for t, v in zip(fut.index, fp)]
    print(f"  {target}: test MAE {out['mae']:,.0f} MW" + (f" ({out['mape']:.1%})" if "mape" in out else "") +
          (f" vs CAISO day-ahead {out['mae_caiso']:,.0f} MW ({out['mape_caiso']:.1%})" if "mae_caiso" in out else "") +
          f"; same-hour-last-week {out['mae_persist']:,.0f} MW; forecast hours {len(fp)}")
    return out


def main():
    gen = datetime.now(timezone.utc).isoformat(timespec="minutes")
    o = pd.read_parquet(RAW / "outlook.parquet")
    h = hourly_grid(o)
    wf = weather_features(pd.read_parquet(RAW / "weather.parquet"))
    last = h.current_demand.dropna().index.max()
    tomorrow = (last + pd.Timedelta(hours=1)).normalize() + (pd.Timedelta(days=1) if last.hour >= 1 else pd.Timedelta(0))
    demand = fit_target(h, wf, "current_demand", tomorrow)
    net = fit_target(h, wf, "net", tomorrow)

    # duck curves: median spring (Mar–Apr) weekday net demand by hour, each year
    spring = h[(h.index.month.isin([3, 4])) & (h.index.dayofweek < 5)]
    # only years with most of their spring on record (the download may start or end mid-season)
    duck = {int(y): g.groupby(g.index.hour).net.median().round(0).tolist() for y, g in spring.groupby(spring.index.year) if g.net.notna().sum() >= 0.8 * 42 * 24}
    lows = h.net.resample("D").min()
    record_low = lows.idxmin()
    # batteries: average hourly battery output (positive = discharging) by year, Apr–Sep
    bt = h[h.index.month.isin(range(4, 10))]
    batt = {int(y): g.groupby(g.index.hour).batteries.mean().round(0).tolist() for y, g in bt.groupby(bt.index.year) if g.batteries.notna().sum() >= 0.8 * 183 * 24}
    # the latest full day's fuel mix (15-minute resolution)
    # the latest day whose fuel-mix file is essentially complete
    fuel_hours = h.solar.notna().resample("D").sum()
    day = fuel_hours[fuel_hours >= 23].index.max()
    mix_cols = ["solar", "wind", "geothermal", "biomass", "biogas", "small_hydro", "coal", "nuclear", "natural_gas", "large_hydro", "batteries", "imports", "other"]
    o2 = o.set_index("ts").sort_index()
    mix = o2[(o2.index >= day) & (o2.index < day + pd.Timedelta(days=1))][mix_cols].resample("15min").mean()
    # renewable share by year
    yearly = h.assign(ren=h.solar.clip(lower=0) + h.wind.clip(lower=0) + h.geothermal + h.biomass + h.biogas + h.small_hydro)
    ren_share = (yearly.ren.resample("YS").sum() / yearly.current_demand.resample("YS").sum()).round(4)
    ren_partial = int(last.year) if last < pd.Timestamp(year=last.year, month=12, day=31, hour=23) else None
    # today/tomorrow greenest hours by forecast net/demand ratio
    fd = {t.isoformat(): v for t, v, _, _ in demand["forecast"]}
    green = sorted([(t, n / fd[t.isoformat()]) for t, n, _, _ in net["forecast"] if t.isoformat() in fd], key=lambda x: x[1])[:3]
    recent = h[h.index >= last - pd.Timedelta(days=7)][["current_demand", "net", "solar", "wind", "batteries", "day_ahead_forecast"]]
    dump("grid.json", {
        "generated": gen, "last": last, "tomorrow": tomorrow, "demand": demand, "net": net,
        "duck": duck, "record_low": {"date": record_low, "mw": float(lows[record_low])},
        "batteries": batt, "mix_day": day, "mix": {"cols": mix_cols, "ts": [t for t in mix.index], "rows": mix.round(0).values.tolist()},
        "ren_share": {int(t.year): float(v) for t, v in ren_share.items()}, "ren_partial": ren_partial,
        "green_hours": [[t, r] for t, r in green],
        "recent": {"ts": [t for t in recent.index], **{c: recent[c].round(0).tolist() for c in recent.columns}},
        "peak_demand": {"mw": float(h.current_demand.max()), "when": h.current_demand.idxmax()},
    })


if __name__ == "__main__":
    main()
