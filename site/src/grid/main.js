import * as d3 from "d3";
import { initTheme, initSkin, cssVar, tooltip, el, tipRow, loadJSON } from "../shared/ui.js";
import { mountSkin } from "./skin.js";

const isDark = initTheme(document.getElementById("theme"));
initSkin(document.getElementById("skin"));
const tip = tooltip();
let G;
const gw = (v) => `${(v / 1000).toFixed(1)} GW`;
const pct = (v) => `${Math.round(v * 100)}%`;
const axisClean = (a) => a.select(".domain").remove();
// Timestamps are Pacific wall-clock times without an offset: read them as UTC so getUTC* gives the wall clock
const ts = (s) => new Date(/(Z|[+-]\d\d:\d\d)$/.test(s) ? s : `${s}Z`);
const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
const STACK = [
  ["Nuclear", ["nuclear"], "--nuclear"], ["Wind", ["wind"], "--wind"], ["Hydro", ["large_hydro", "small_hydro"], "--hydro"],
  ["Imports", ["imports"], "--imports"], ["Solar", ["solar"], "--solar"],
  ["Batteries & other", ["batteries", "geothermal", "biomass", "biogas", "coal", "other"], "--other"], ["Natural gas", ["natural_gas"], "--gas"],
];

init().catch((err) => {
  console.error(err);
  document.querySelector("main").prepend(el("div", { class: "wrap", style: { padding: "24px", color: "var(--accent)" } }, `Could not load data: ${err.message}`));
});

async function init() {
  G = await loadJSON("./data/grid/grid.json");
  renderTiles();
  renderAll();
  mountSkin(G); // "Control Room" skin extras (only build DOM while the skin is active)
  document.getElementById("generated").textContent = `Data refreshed ${ts(G.generated).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}`;
  let raf, lastW = 0;
  new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w === lastW) return; lastW = w; cancelAnimationFrame(raf); raf = requestAnimationFrame(renderAll); })
    .observe(document.querySelector("main"));
  window.addEventListener("themechange", renderAll);
}
function renderAll() { renderForecast(); renderScore(); renderDuck(); renderBatt(); renderMix(); renderRen(); }

function frame(id, height, m) {
  const host = document.getElementById(id);
  const width = Math.max(240, host.clientWidth);
  host.replaceChildren();
  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  return { svg, g: svg.append("g").attr("transform", `translate(${m.l},${m.t})`), iw: width - m.l - m.r, ih: height - m.t - m.b, width };
}
function hourAxis(g, x, ih) {
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
    .call(d3.axisBottom(x).tickValues([0, 3, 6, 9, 12, 15, 18, 21]).tickFormat((h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`).tickSize(0).tickPadding(6)).call(axisClean);
}

// ------------------------------------------------------------------ tiles & tomorrow
function renderTiles() {
  const D = G.demand.forecast, N = G.net.forecast;
  const tday = ts(G.tomorrow);
  document.getElementById("tomorrow-label").textContent = `California's grid · forecast for ${tday.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}`;
  if (!D.length || !N.length) return;
  const peak = D.reduce((a, b) => (b[1] > a[1] ? b : a)), low = N.reduce((a, b) => (b[1] < a[1] ? b : a));
  const rampFrom = N.find((r) => ts(r[0]).getUTCHours() === 15), rampTo = N.reduce((a, b) => (b[1] > a[1] ? b : a));
  const green = G.green_hours.map(([t]) => ts(t).getUTCHours()).sort((a, b) => a - b);
  const years = Object.keys(G.ren_share).map(Number).sort();
  const lastFull = years.filter((y) => y !== G.ren_partial).at(-1);
  const tile = (l, v, s) => el("div", { class: "card tile" }, el("div", { class: "label" }, l), el("div", { class: "value" }, v), el("div", { class: "sub" }, s));
  document.getElementById("tiles").replaceChildren(
    tile("Peak demand", gw(peak[1]), `around ${hourLabel(ts(peak[0]).getUTCHours())}`),
    tile("Bottom of the belly", gw(low[1]), `net demand at ${hourLabel(ts(low[0]).getUTCHours())}, when solar is strongest`),
    tile("The evening ramp", `+${gw(rampTo[1] - (rampFrom?.[1] ?? low[1]))}`, `net demand climbs from 3 pm to its ${hourLabel(ts(rampTo[0]).getUTCHours())} peak`),
    tile("Cleanest hours to charge", green.map(hourLabel).join(", "), `lowest share of demand left for gas and imports · ${pct(G.ren_share[lastFull])} renewable in ${lastFull}`));
}
function renderForecast() {
  const D = G.demand.forecast.map(([t, v, lo, hi]) => ({ h: ts(t).getUTCHours(), v, lo, hi }));
  const N = G.net.forecast.map(([t, v, lo, hi]) => ({ h: ts(t).getUTCHours(), v, lo, hi }));
  if (!D.length || !N.length) { document.getElementById("forecast").textContent = "Tomorrow's forecast is unavailable until CAISO publishes today's data."; return; }
  document.getElementById("fc-title").textContent = `${ts(G.tomorrow).toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}, hour by hour`;
  const m = { l: 48, r: 90, t: 10, b: 24 };
  const { svg, g, iw, ih } = frame("forecast", 300, m);
  const x = d3.scaleLinear([0, 23], [0, iw]);
  const y = d3.scaleLinear().domain([Math.min(0, d3.min(N, (r) => r.lo)), d3.max(D, (r) => r.hi)]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v / 1000}`).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("text").attr("class", "label").attr("x", -40).attr("y", -2).style("font-size", "10.5px").text("GW");
  hourAxis(g, x, ih);
  for (const [rows, v] of [[D, "--demand"], [N, "--net"]]) {
    g.append("path").datum(rows).attr("d", d3.area().x((r) => x(r.h)).y0((r) => y(r.lo)).y1((r) => y(r.hi)).curve(d3.curveMonotoneX)).style("fill", `var(${v})`).style("opacity", 0.14);
    g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.h)).y((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", `var(${v})`).style("stroke-width", 2.5);
    const last = rows.at(-1);
    g.append("text").attr("class", "label strong").attr("x", iw + 8).attr("y", y(last.v) + 4).text(v === "--demand" ? "Demand" : "Net demand");
  }
  // shade the solar gap between the curves
  const both = D.map((r, i) => ({ h: r.h, d: r.v, n: N[i]?.v })).filter((r) => r.n != null);
  g.insert("path", ":first-child").datum(both).attr("d", d3.area().x((r) => x(r.h)).y0((r) => y(r.n)).y1((r) => y(r.d)).curve(d3.curveMonotoneX)).style("fill", "var(--solar)").style("opacity", 0.12);
  document.getElementById("fc-legend").replaceChildren(
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--demand)" } }), "Demand"),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--net)" } }), "Net demand (after grid solar & wind)"),
    el("span", { class: "key" }, el("i", { class: "band", style: { background: "var(--solar)", opacity: 0.3 } }), "Met by solar & wind"),
    el("span", { class: "key" }, el("i", { class: "band", style: { background: "var(--ink-2)", opacity: 0.2 } }), "80% ranges"));
  const ch = g.append("line").attr("y1", 0).attr("y2", ih).style("stroke", "var(--axis)").style("opacity", 0);
  svg.on("pointermove", (e) => {
    const [px] = d3.pointer(e, g.node());
    const h = Math.max(0, Math.min(23, Math.round(x.invert(px))));
    const d_ = D.find((r) => r.h === h), n = N.find((r) => r.h === h);
    if (!d_ || !n) return;
    ch.attr("x1", x(h)).attr("x2", x(h)).style("opacity", 1);
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, hourLabel(h)), tipRow(cssVar("--demand"), gw(d_.v), "demand"), tipRow(cssVar("--net"), gw(n.v), "net demand"),
      tipRow(null, gw(d_.v - n.v), "from grid solar & wind")));
  }).on("pointerleave", () => { ch.style("opacity", 0); tip.hide(); });
}

// ------------------------------------------------------------------ scoreboard
function renderScore() {
  const S = G.demand, N = G.net;
  document.getElementById("score-tiles").replaceChildren(...[
    ["My demand forecast", `±${gw(S.mae_model_same)}`, `average hourly error · ${(S.mape * 100).toFixed(1)}% of demand`],
    ["CAISO's day-ahead forecast", `±${gw(S.mae_caiso)}`, `average hourly error · ${(S.mape_caiso * 100).toFixed(1)}% of demand`],
    ["Net demand (harder)", `±${gw(N.mae)}`, `vs ±${gw(N.mae_persist)} for "same hour last week"`],
    ["Test period", `${Math.round(S.n_hours / 24)} days`, `${ts(S.test_from).toLocaleDateString("en-CA", { month: "short", year: "numeric", timeZone: "UTC" })} – ${ts(S.test_to).toLocaleDateString("en-CA", { month: "short", year: "numeric", timeZone: "UTC" })}`],
  ].map(([l, v, s]) => el("div", { class: "card metric" }, el("div", { class: "label" }, l), el("div", { class: "value" }, v), el("div", { class: "sub" }, s))));
  const gap = S.mae_model_same / S.mae_caiso;
  document.getElementById("score-sub").textContent = `CAISO publishes its own day-ahead demand forecast. Mine uses only public weather and yesterday's public grid data. On the same hours since mid-2025, which my model never saw, its error is ${gap < 1 ? `${Math.round((1 - gap) * 100)}% lower than` : `${gap.toFixed(2)}× that of`} CAISO's.`;
  const rows = S.daily_mae.map(([d_, m, c]) => ({ d: ts(d_), m, c }));
  const m = { l: 44, r: 10, t: 10, b: 22 };
  const { svg, g, iw, ih } = frame("score-daily", 240, m);
  const x = d3.scaleTime(d3.extent(rows, (r) => r.d), [0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => Math.max(r.m, r.c))]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.c)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", "var(--caiso)").style("stroke-width", 2);
  g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.m)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", "var(--demand)").style("stroke-width", 2);
  document.getElementById("score-legend").replaceChildren(
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--demand)" } }), "My forecast"),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--caiso)" } }), "CAISO day-ahead"));
  svg.on("pointermove", (e) => { const [px] = d3.pointer(e, g.node()); const r = rows[d3.bisector((q) => q.d).center(rows, x.invert(px))];
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, d3.timeFormat("%a %b %-d")(r.d)), tipRow(cssVar("--demand"), `${Math.round(r.m)} MW`, "my error"), tipRow(cssVar("--caiso"), `${Math.round(r.c)} MW`, "CAISO error"))); })
    .on("pointerleave", () => tip.hide());
  // by hour
  const bh = N.mae_by_hour.map((v, h) => ({ h, v }));
  const mm = { l: 44, r: 10, t: 10, b: 22 };
  const fr = frame("score-hour", 240, mm);
  const xb = d3.scaleBand(d3.range(24), [0, fr.iw]).padding(0.2);
  const yb = d3.scaleLinear().domain([0, d3.max(bh, (r) => r.v)]).nice().range([fr.ih, 0]);
  fr.g.append("g").attr("class", "grid").selectAll("line").data(yb.ticks(4)).join("line").attr("x1", 0).attr("x2", fr.iw).attr("y1", yb).attr("y2", yb);
  fr.g.append("g").attr("class", "axis").call(d3.axisLeft(yb).ticks(4).tickFormat(d3.format("~s")).tickSize(0).tickPadding(6)).call(axisClean);
  fr.g.append("g").attr("class", "axis").attr("transform", `translate(0,${fr.ih})`).call(d3.axisBottom(xb).tickValues([0, 3, 6, 9, 12, 15, 18, 21]).tickFormat((h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`).tickSize(0).tickPadding(6)).call(axisClean);
  const bw = Math.min(24, xb.bandwidth());
  fr.g.selectAll("path").data(bh).join("path").attr("d", (r) => { const x0 = xb(r.h) + (xb.bandwidth() - bw) / 2, top = yb(r.v), rr = Math.min(3, fr.ih - top);
    return `M${x0},${fr.ih}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + bw - rr}Q${x0 + bw},${top} ${x0 + bw},${top + rr}V${fr.ih}Z`; }).style("fill", "var(--net)")
    .on("pointermove", (e, r) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, hourLabel(r.h)), tipRow(cssVar("--net"), `${Math.round(r.v)} MW`, "average net-demand error"))))
    .on("pointerleave", () => tip.hide());
}

// ------------------------------------------------------------------ duck & batteries
function yearLines(id, legendId, series, colorVar, fmtY, zeroLine = false) {
  const years = Object.keys(series).map(Number).sort();
  const ramp = d3.scaleLinear([0, Math.max(1, years.length - 1)], [0.35, 1]);
  const m = { l: 48, r: 44, t: 10, b: 24 };
  const { svg, g, iw, ih } = frame(id, 300, m);
  const x = d3.scaleLinear([0, 23], [0, iw]);
  const all = years.flatMap((y) => series[y]).filter((v) => v != null);
  const y = d3.scaleLinear().domain([Math.min(0, d3.min(all)), d3.max(all)]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(fmtY).tickSize(0).tickPadding(6)).call(axisClean);
  hourAxis(g, x, ih);
  if (zeroLine) g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0)).style("stroke", "var(--ink-2)");
  const labels = [];
  years.forEach((yr, i) => {
    const vals = series[yr];
    g.append("path").datum(vals).attr("d", d3.line().defined((v) => v != null).x((_, h) => x(h)).y((v) => y(v)).curve(d3.curveMonotoneX))
      .style("fill", "none").style("stroke", `var(${colorVar})`).style("stroke-width", i === years.length - 1 ? 2.75 : 1.5).style("opacity", ramp(i));
    // label only the oldest and newest years; the legend and tooltip cover the rest
    if (i === 0 || i === years.length - 1) labels.push({ yr, y: y(vals[23]), strong: i === years.length - 1 });
  });
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 11) labels[i].y = labels[i - 1].y + 11;
  for (const L of labels) g.append("text").attr("class", L.strong ? "label strong" : "label").attr("x", iw + 6).attr("y", L.y + 4).style("font-size", "10.5px").text(L.yr);
  document.getElementById(legendId).replaceChildren(...[years[0], years.at(-1)].map((yr, k) => el("span", { class: "key" },
    el("i", { class: "line", style: { background: `var(${colorVar})`, opacity: k ? 1 : 0.35 } }), String(yr))), el("span", { class: "key" }, "(darker = more recent)"));
  const ch = g.append("line").attr("y1", 0).attr("y2", ih).style("stroke", "var(--axis)").style("opacity", 0);
  svg.on("pointermove", (e) => {
    const [px] = d3.pointer(e, g.node());
    const h = Math.max(0, Math.min(23, Math.round(x.invert(px))));
    ch.attr("x1", x(h)).attr("x2", x(h)).style("opacity", 1);
    tip.show(e.clientX, e.clientY, (t) => { t.append(el("div", { class: "t-title" }, hourLabel(h)));
      for (const yr of [...years].reverse()) if (series[yr][h] != null) t.append(tipRow(null, fmtY(series[yr][h]), String(yr))); });
  }).on("pointerleave", () => { ch.style("opacity", 0); tip.hide(); });
}
function renderDuck() {
  yearLines("duck", "duck-legend", G.duck, "--net", (v) => `${(v / 1000).toFixed(0)} GW`);
  const years = Object.keys(G.duck).map(Number).sort();
  const first = G.duck[years[0]], last = G.duck[years.at(-1)];
  const minF = d3.min(first), minL = d3.min(last);
  document.getElementById("duck-note").textContent = `The spring midday low fell from ${gw(minF)} in ${years[0]} to ${gw(minL)} in ${years.at(-1)}. Record low net demand: ${gw(G.record_low.mw)} on ${ts(G.record_low.date).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}.`;
}
function renderBatt() { yearLines("batt", "batt-legend", G.batteries, "--hydro", (v) => `${(v / 1000).toFixed(1)} GW`, true); }

// ------------------------------------------------------------------ fuel mix
function renderMix() {
  document.getElementById("mix-title").textContent = `Where power came from on ${ts(G.mix_day).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}`;
  const cols = G.mix.cols;
  const rows = G.mix.ts.map((t, i) => {
    const r = { t: ts(t) };
    for (const [name, parts] of STACK) r[name] = d3.sum(parts, (p) => Math.max(0, G.mix.rows[i][cols.indexOf(p)] ?? 0));
    r.charging = Math.min(0, G.mix.rows[i][cols.indexOf("batteries")] ?? 0);
    return r;
  });
  const keys = STACK.map((s) => s[0]);
  const stack = d3.stack().keys(keys)(rows);
  const m = { l: 48, r: 110, t: 10, b: 24 };
  const { svg, g, iw, ih } = frame("mix", 320, m);
  const x = d3.scaleUtc(d3.extent(rows, (r) => r.t), [0, iw]);
  const y = d3.scaleLinear().domain([d3.min(rows, (r) => r.charging), d3.max(stack.at(-1), (d_) => d_[1])]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v / 1000}`).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("text").attr("class", "label").attr("x", -40).attr("y", -2).style("font-size", "10.5px").text("GW");
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(d3.utcHour.every(3)).tickFormat((d_) => hourLabel(d_.getUTCHours())).tickSize(0).tickPadding(6)).call(axisClean);
  const area = d3.area().x((d_) => x(d_.data.t)).y0((d_) => y(d_[0])).y1((d_) => y(d_[1])).curve(d3.curveMonotoneX);
  g.selectAll("path.layer").data(stack).join("path").attr("class", "layer").attr("d", area)
    .style("fill", (s) => `var(${STACK.find((x_) => x_[0] === s.key)[2]})`).style("stroke", "var(--surface)").style("stroke-width", 1);
  g.append("path").datum(rows).attr("d", d3.area().x((r) => x(r.t)).y0(y(0)).y1((r) => y(r.charging)).curve(d3.curveMonotoneX)).style("fill", "var(--other)").style("opacity", 0.8);
  g.append("text").attr("class", "label").attr("x", x(rows[Math.floor(rows.length * 0.5)].t)).attr("y", y(d3.min(rows, (r) => r.charging)) - 4).attr("text-anchor", "middle").style("font-size", "10.5px").text("batteries charging");
  // direct labels at the right edge, spaced
  const lastRow = stack.map((s) => ({ key: s.key, mid: (s.at(-1)[0] + s.at(-1)[1]) / 2, size: s.at(-1)[1] - s.at(-1)[0] })).filter((l) => l.size > 300);
  const labs = lastRow.map((l) => ({ key: l.key, y: y(l.mid) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 12) labs[i].y = labs[i - 1].y + 12;
  for (const L of labs) g.append("text").attr("class", "label").attr("x", iw + 6).attr("y", L.y + 4).style("font-size", "11px").text(L.key);
  document.getElementById("mix-legend").replaceChildren(...STACK.slice().reverse().map(([name, , v]) => el("span", { class: "key" }, el("i", { class: "band", style: { background: `var(${v})` } }), name)));
  const ch = g.append("line").attr("y1", 0).attr("y2", ih).style("stroke", "var(--ink)").style("opacity", 0);
  svg.on("pointermove", (e) => {
    const [px] = d3.pointer(e, g.node());
    const r = rows[d3.bisector((q) => q.t).center(rows, x.invert(px))];
    ch.attr("x1", x(r.t)).attr("x2", x(r.t)).style("opacity", 0.5);
    tip.show(e.clientX, e.clientY, (t) => { t.append(el("div", { class: "t-title" }, d3.utcFormat("%-I:%M %p")(r.t)));
      for (const [name, , v] of STACK.slice().reverse()) if (r[name] > 50) t.append(tipRow(cssVar(v), gw(r[name]), name));
      if (r.charging < -50) t.append(tipRow(cssVar("--other"), gw(-r.charging), "batteries charging")); });
  }).on("pointerleave", () => { ch.style("opacity", 0); tip.hide(); });
}
function renderRen() {
  const rows = Object.entries(G.ren_share).map(([y, v]) => ({ y: +y, v }));
  const m = { l: 40, r: 10, t: 18, b: 24 };
  const { g, iw, ih } = frame("ren", 240, m);
  const x = d3.scaleBand(rows.map((r) => r.y), [0, iw]).padding(0.3);
  const y = d3.scaleLinear([0, Math.max(0.6, d3.max(rows, (r) => r.v))], [ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".0%")).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).tickSize(0).tickPadding(6)).call(axisClean);
  const bw = Math.min(24, x.bandwidth());
  const now = G.ren_partial;
  g.selectAll("path").data(rows).join("path").attr("d", (r) => { const x0 = x(r.y) + (x.bandwidth() - bw) / 2, top = y(r.v), rr = Math.min(4, ih - top);
    return `M${x0},${ih}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + bw - rr}Q${x0 + bw},${top} ${x0 + bw},${top + rr}V${ih}Z`; })
    .style("fill", "var(--wind)").style("opacity", (r) => (r.y === now ? 0.5 : 1));
  g.selectAll("text.v").data(rows).join("text").attr("class", "label strong").attr("x", (r) => x(r.y) + x.bandwidth() / 2).attr("y", (r) => y(r.v) - 5).attr("text-anchor", "middle").style("font-size", "11px")
    .text((r) => `${Math.round(r.v * 100)}%${r.y === now ? "*" : ""}`);
}
