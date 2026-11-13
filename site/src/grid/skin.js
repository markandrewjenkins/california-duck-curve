// "Control Room" design skin extras: live strip, SCADA mimic board, annunciator lamps + 7-segment readouts,
// and a drawing title block. All DOM is built only while the skin is active and removed when it's switched off.
import { el } from "../shared/ui.js";

const root = document.documentElement;
const active = () => root.dataset.skin === "alt";
// Timestamps are Pacific wall-clock times without an offset (same convention as main.js)
const ts = (s) => new Date(/(Z|[+-]\d\d:\d\d)$/.test(s) ? s : `${s}Z`);
const fmtMW = (v) => `${Math.round(v).toLocaleString("en-CA")}`;
const gw = (v) => `${(v / 1000).toFixed(1)}`;
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
const stamp = (d) => `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;

let G = null;
let cleanup = [];

export function mountSkin(data) {
  G = data;
  sync();
  window.addEventListener("skinchange", sync);
}

function sync() {
  for (const f of cleanup.splice(0)) f();
  if (active() && G) { liveStrip(); mimic(); annunciators(); titleBlock(); }
}
const add = (node) => { cleanup.push(() => node.remove()); return node; };

// ------------------------------------------------------------------ live strip
function liveStrip() {
  const R = G.recent;
  let i = R.ts.length - 1;
  while (i > 0 && R.current_demand[i] == null) i--;
  const at = ts(R.ts[i]);
  const batt = R.batteries[i] ?? 0;
  const mixShare = renShare();
  const cell = (k, v, u, extra = "") => el("div", { class: `cr-cell ${extra}` }, el("span", { class: "k" }, k), el("span", { class: "v" }, v, el("small", {}, u)));
  const strip = el("div", { class: "cr-strip", "aria-hidden": "true" },
    el("div", { class: "wrap cr-strip-in" },
      el("div", { class: "cr-cell cr-live" }, el("i", { class: "cr-lamp ok pulse" }), el("span", { class: "k" }, "SCADA"), el("span", { class: "v" }, "LIVE")),
      cell("DEMAND", gw(R.current_demand[i]), " GW"),
      cell("NET DEMAND", gw(R.net[i]), " GW"),
      cell("SOLAR", gw(Math.max(0, R.solar[i] ?? 0)), " GW"),
      cell(batt >= 0 ? "BATTERIES ▲ DISCH" : "BATTERIES ▼ CHG", gw(Math.abs(batt)), " GW", batt >= 0 ? "dis" : "chg"),
      cell(`RENEWABLES ${stamp(ts(G.mix_day)).slice(4)}`, `${Math.round(mixShare * 100)}`, "%"),
      el("div", { class: "cr-cell cr-asof" }, el("span", { class: "k" }, "DATA AS OF"), el("span", { class: "v" }, `${stamp(at).slice(4)} ${hhmm(at)}`, el("small", {}, " PT")))));
  document.querySelector(".topbar").after(add(strip));
}
// Renewable share of the latest full day, California's definition (as the page's bar chart)
function renShare() {
  const c = G.mix.cols, ren = ["solar", "wind", "geothermal", "biomass", "biogas", "small_hydro"].map((k) => c.indexOf(k));
  let tot = 0, r = 0;
  for (const row of G.mix.rows) { for (const v of row) tot += v ?? 0; for (const j of ren) r += Math.max(0, row[j] ?? 0); }
  return tot > 0 ? r / tot : 0;
}

// ------------------------------------------------------------------ 7-segment readouts
const SEG = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g", "+": "g", " ": "" };
function sevenSeg(str, cls = "") {
  const W = 20, H = 36, t = 4, g = 0.9, pitch = 27;
  const hz = (x1, x2, y) => `${x1},${y} ${x1 + t / 2},${y - t / 2} ${x2 - t / 2},${y - t / 2} ${x2},${y} ${x2 - t / 2},${y + t / 2} ${x1 + t / 2},${y + t / 2}`;
  const vt = (x, y1, y2) => `${x},${y1} ${x + t / 2},${y1 + t / 2} ${x + t / 2},${y2 - t / 2} ${x},${y2} ${x - t / 2},${y2 - t / 2} ${x - t / 2},${y1 + t / 2}`;
  const x0 = t / 2, x1 = W - t / 2, y0 = t / 2, ym = H / 2, y1 = H - t / 2;
  const P = { a: hz(x0 + g, x1 - g, y0), g: hz(x0 + g, x1 - g, ym), d: hz(x0 + g, x1 - g, y1),
    f: vt(x0, y0 + g, ym - g), b: vt(x1, y0 + g, ym - g), e: vt(x0, ym + g, y1 - g), c: vt(x1, ym + g, y1 - g) };
  let x = 2, out = "";
  for (const ch of str) {
    if (ch === ".") { out += `<circle class="on" cx="${x - 3.5}" cy="${y1}" r="2.3"/>`; continue; }
    if (ch === " ") { x += 12; continue; } // gap between readouts: no ghost cell
    const lit = SEG[ch] ?? "";
    out += `<g transform="translate(${x} 0)">`;
    for (const s of "abcdefg") out += `<polygon class="${lit.includes(s) ? "on" : "off"}" points="${P[s]}"/>`;
    if (ch === "+") out += `<polygon class="on" points="${vt(W / 2, ym - 8, ym + 8)}"/>`;
    out += "</g>";
    x += pitch;
  }
  const w = x + 2;
  return `<svg class="cr-seg ${cls}" viewBox="-4 -1 ${w + 6} ${H + 2}" width="${w + 6}" height="${H + 2}" aria-hidden="true"><g transform="skewX(-7) translate(4 0)">${out}</g></svg>`;
}

// ------------------------------------------------------------------ annunciator tiles
function annunciators() {
  const tiles = [...document.querySelectorAll("#tiles .tile")];
  if (tiles.length < 4) return;
  const D = G.demand.forecast, N = G.net.forecast;
  const peak = Math.max(...D.map((r) => r[1])), low = Math.min(...N.map((r) => r[1]));
  const from = N.find((r) => ts(r[0]).getUTCHours() === 15)?.[1] ?? low, ramp = Math.max(...N.map((r) => r[1])) - from;
  const rec = G.peak_demand?.mw ?? 50000;
  const hours = G.green_hours.map(([t]) => ts(t).getUTCHours()).sort((a, b) => a - b);
  const spec = [
    ["PEAK DEMAND", peak >= 0.9 * rec ? "alarm" : peak >= 0.78 * rec ? "warn" : "ok", gw(peak), "GW"],
    ["BELLY", low <= 0 ? "alarm" : low <= 6000 ? "warn" : "ok", gw(low), "GW"],
    ["EVENING RAMP", ramp >= 18000 ? "alarm" : ramp >= 12000 ? "warn" : "ok", `+${gw(ramp)}`, "GW"],
    ["GREEN HOURS", "ok", hours.map((h) => String(h).padStart(2, "0")).join(" "), "HR"],
  ];
  const STATE = { ok: "NORMAL", warn: "CAUTION", alarm: "ALARM" };
  tiles.forEach((t, k) => {
    const [legend, state, digits, unit] = spec[k];
    t.dataset.cr = state;
    const deco = el("div", { class: "cr-ann", "aria-hidden": "true" },
      el("div", { class: "cr-ann-head" }, el("span", { class: "cr-legend" }, legend), el("span", { class: "cr-state" }, el("i", { class: `cr-lamp ${state}${state === "ok" ? "" : " pulse"}` }), STATE[state])));
    const seg = el("div", { class: "cr-ann-read", "aria-hidden": "true" });
    seg.innerHTML = sevenSeg(digits) + `<span class="cr-unit">${unit}</span>`;
    t.prepend(deco);
    t.querySelector(".value")?.after(seg);
    cleanup.push(() => { deco.remove(); seg.remove(); delete t.dataset.cr; });
  });
}

// ------------------------------------------------------------------ mimic board (one-line diagram)
const SRC = [
  ["NUCLEAR", "NUC", "--nuclear", ["nuclear"], "gen"],
  ["WIND", "WIND", "--wind", ["wind"], "wind"],
  ["HYDRO", "HYDRO", "--hydro", ["large_hydro", "small_hydro"], "gen"],
  ["IMPORTS", "IMP", "--imports", ["imports"], "tie"],
  ["SOLAR", "SOLAR", "--solar", ["solar"], "pv"],
  ["BATTERIES", "BESS", "--other", ["batteries"], "batt"],
  ["GEO/BIO", "OTHER", "--other", ["geothermal", "biomass", "biogas", "coal", "other"], "gen"],
  ["GAS", "GAS", "--gas", ["natural_gas"], "gen"],
];
function mixAt(i) {
  const c = G.mix.cols, row = G.mix.rows[i];
  const val = (k) => row[c.indexOf(k)] ?? 0;
  const out = SRC.map(([, , , cols, kind]) => (kind === "batt" ? val("batteries") : cols.reduce((s, k) => s + Math.max(0, val(k)), 0)));
  return { out, load: out.reduce((a, b) => a + b, 0), t: ts(G.mix.ts[i]) };
}

function glyph(kind, x, y, r, v) {
  const s = `style="stroke:var(${v});color:var(${v})"`;
  switch (kind) {
    case "pv": // inverter: box with diagonal, = and ~
      return `<rect class="nd" x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" ${s}/><path class="gl" ${s} d="M${x - r} ${y + r}L${x + r} ${y - r}M${x - r * 0.7} ${y - r * 0.45}h${r * 0.7}M${x - r * 0.7} ${y - r * 0.2}h${r * 0.7}M${x + r * 0.05} ${y + r * 0.5}q${r * 0.17} -${r * 0.3} ${r * 0.33} 0t${r * 0.33} 0"/>`;
    case "batt": // battery cell plates
      return `<rect class="nd" x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" ${s}/><path class="gl" ${s} d="M${x - r * 0.55} ${y - r * 0.18}h${r * 1.1}M${x - r * 0.3} ${y + r * 0.18}h${r * 0.6}M${x} ${y - r}v${r * 0.82}M${x} ${y + r * 0.18}v${r * 0.82}"/>`;
    case "tie": // intertie transformer: two linked circles
      return `<circle class="nd nd2" cx="${x}" cy="${y - r * 0.38}" r="${r * 0.62}" ${s}/><circle class="nd nd2" cx="${x}" cy="${y + r * 0.38}" r="${r * 0.62}" ${s}/>`;
    case "wind": // generator + three blades
      return `<circle class="nd" cx="${x}" cy="${y}" r="${r}" ${s}/><path class="gl" ${s} d="M${x} ${y}v-${r * 0.7}M${x} ${y}l${r * 0.6} ${r * 0.35}M${x} ${y}l-${r * 0.6} ${r * 0.35}"/>`;
    default: // synchronous generator: circle with sine
      return `<circle class="nd" cx="${x}" cy="${y}" r="${r}" ${s}/><path class="gl" ${s} d="M${x - r * 0.6} ${y}q${r * 0.3} -${r * 0.7} ${r * 0.6} 0t${r * 0.6} 0"/>`;
  }
}

// largest single source (or battery swing) over the whole mix day, so column heights compare across the SCAN slider
let dayMax = 0;
function mixDayMax() {
  if (dayMax) return dayMax;
  for (let i = 0; i < G.mix.ts.length; i++) for (const v of mixAt(i).out) dayMax = Math.max(dayMax, Math.abs(v));
  return dayMax || 1;
}

// One-line diagram: each source is a column whose height is its output (same scale for every source and every time of
// day), feeding the bus through its breaker; battery charging hangs below the bus.
function mimicSVG(W, i) {
  const { out, load } = mixAt(i);
  const compact = W < 640;
  const n = SRC.length;
  const loadW = compact ? 66 : 150;
  const bx0 = compact ? 6 : 16, bx1 = W - loadW - (compact ? 10 : 30);
  const perRow = compact ? n / 2 : n;
  const slot = (bx1 - bx0) / perRow;
  const H = compact ? 300 : 268;
  const busY = compact ? 150 : 196;
  const maxH = compact ? 78 : 120;                 // column height at the day's largest source
  const below = compact ? 0 : 52;                  // room under the bus for battery charging
  const bw = Math.max(10, Math.min(compact ? 22 : 40, slot * 0.46));
  const r = compact ? 8 : 10;
  const fs = compact ? 9 : 11;
  const mx = mixDayMax();
  const speed = (mw) => 24 / (3 + Math.abs(mw) / 170);
  let s = "";
  SRC.forEach(([name, short, v, , kind], k) => {
    const mw = out[k];
    const bottom = compact && k >= perRow;
    const dir = bottom ? 1 : -1;                    // columns grow away from the bus
    const col = compact ? k % perRow : k;
    const x = Math.round(bx0 + slot * (col + 0.5));
    const live = Math.abs(mw) >= 1;
    const chg = kind === "batt" && mw < -1;
    const h = Math.max(live ? 2 : 0, (Math.abs(mw) / mx) * maxH);
    const brY = busY + dir * 14;
    const base = busY + dir * 24;                   // column foot (breaker sits between it and the bus)
    // charging draws power off the bus: hang that column on the far side of the bus
    const cDir = chg && !compact ? 1 : dir;
    const cBase = chg && !compact ? busY + 12 : base;
    const top = cBase + cDir * h;
    const share = load > 0 && !chg ? Math.round((100 * mw) / load) : null;
    s += `<g class="feeder${live ? "" : " dead"}">`;
    const d = `M${x} ${cBase}V${busY}`;
    s += `<path class="ln" d="${d}" style="stroke:var(${v})"/>`;
    if (live) s += `<path class="flow${chg ? " rev" : ""}" d="${d}" style="stroke:var(${v});stroke-width:${Math.min(5, 2.6 + Math.abs(mw) / 4000).toFixed(1)};animation-duration:${speed(mw).toFixed(2)}s"/>`;
    if (!chg || compact) s += `<rect class="brk${live ? " closed" : ""}" x="${x - 4}" y="${brY - 4}" width="8" height="8" style="stroke:var(${v});${live ? `fill:var(${v})` : ""}"/>`;
    const y0 = Math.min(cBase, top), y1 = Math.max(cBase, top);
    s += `<rect class="col${chg ? " chg" : ""}" x="${x - bw / 2}" y="${y0}" width="${bw}" height="${Math.max(0, y1 - y0)}" rx="2"
      style="stroke:var(${v});fill:var(${v})"/>`;
    // symbol, name and value beyond the column's end
    const gy = chg && !compact ? Math.max(y1 + r + 4, busY + 30) : top + cDir * (r + 4);
    s += glyph(kind, x, gy, r, v);
    const tY = cDir < 0 ? gy - r - 6 : gy + r + fs + 2;
    const tY2 = cDir < 0 ? tY - fs - 2 : tY + fs + 2;
    s += `<text class="nm" x="${x}" y="${cDir < 0 ? tY2 : tY}" font-size="${fs}">${compact ? short : name}</text>`;
    const valTxt = compact ? `${chg ? "−" : ""}${gw(Math.abs(mw))}` : `${chg ? "−" : ""}${fmtMW(Math.abs(mw))} MW`;
    s += `<text class="mw${chg ? " chg" : ""}" x="${x}" y="${cDir < 0 ? tY : tY2}" font-size="${fs + (compact ? 0 : 0.5)}">${valTxt}${!compact && share != null && live ? ` · ${share}%` : ""}</text>`;
    if (kind === "batt" && !compact) s += `<text class="tag" x="${x}" y="${(cDir < 0 ? tY : tY2) + (cDir < 0 ? -fs * 2 - 4 : fs + 2)}" font-size="${fs - 1.5}">${chg ? "CHARGING" : live ? "DISCHARGE" : "IDLE"}</text>`;
    s += "</g>";
  });
  const lx = W - loadW, ly0 = busY - (compact ? 26 : 34), lh = compact ? 52 : 68;
  s = `<path class="bus" d="M${bx0} ${busY}H${bx1}"/>` + s;
  s += `<path class="tie" d="M${bx1} ${busY}H${lx}"/><path class="flow bus-flow" d="M${bx0} ${busY}H${lx - 6}" style="animation-duration:${speed(load / 3).toFixed(2)}s"/>`;
  s += `<path class="arrow" d="M${lx - 8} ${busY - 5}l7 5l-7 5z"/>`;
  s += `<rect class="loadbox" x="${lx}" y="${ly0}" width="${loadW - 2}" height="${lh}"/>`;
  s += `<text class="nm load" x="${lx + 8}" y="${ly0 + (compact ? 13 : 16)}" font-size="${fs}" text-anchor="start">LOAD</text>`;
  s += `<text class="nm unit" x="${lx + loadW - 10}" y="${ly0 + (compact ? 13 : 16)}" font-size="${fs - 1}" text-anchor="end">${compact ? "GW" : "MW"}</text>`;
  const seg = sevenSeg(compact ? gw(load) : String(Math.round(load)), "load");
  const segH = compact ? 24 : 34;
  s += `<g transform="translate(${lx + 8} ${ly0 + lh - segH - 7}) scale(${segH / 38})">${seg.replace(/<svg[^>]*>/, '<g class="cr-seg load">').replace("</svg>", "</g>")}</g>`;
  s += `<text class="bus-lbl" x="${bx0}" y="${busY + (compact ? -6 : 16)}" font-size="${fs - 1.5}" text-anchor="start">${compact ? "GW" : "SYSTEM BUS · CAISO BA · column height = output"}</text>`;
  return `<svg viewBox="0 0 ${W} ${H + below * 0}" width="${W}" height="${H}" aria-hidden="true">${s}</svg>`;
}

function mimic() {
  const rows = G.mix.ts.length;
  if (!rows) return;
  let i = rows - 1;
  const svgHost = el("div", { class: "cr-mimic-svg" });
  const timeOut = el("output", { class: "cr-time" });
  const range = el("input", { type: "range", min: "0", max: String(rows - 1), step: "1", value: String(i), id: "cr-scan", "aria-label": "Mimic board time of day" });
  const panel = el("div", { class: "cr-mimic" },
    el("div", { class: "cr-mimic-head" },
      el("span", { class: "cr-ttl", "aria-hidden": "true" }, el("i", { class: "cr-lamp ok" }), "ONE-LINE · GENERATION TO LOAD"),
      el("label", { class: "cr-scan", for: "cr-scan" }, el("span", { "aria-hidden": "true" }, "SCAN"), range, timeOut)),
    svgHost);
  const paint = () => {
    const W = Math.max(280, Math.floor(svgHost.clientWidth));
    svgHost.innerHTML = mimicSVG(W, i);
    const t = ts(G.mix.ts[i]);
    timeOut.textContent = `${stamp(t)} ${hhmm(t)} PT`;
  };
  range.addEventListener("input", () => { i = +range.value; paint(); });
  const lede = document.querySelector(".hero .lede");
  lede.after(add(panel));
  let lastW = 0;
  const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w !== lastW) { lastW = w; paint(); } });
  ro.observe(svgHost);
  cleanup.push(() => ro.disconnect());
  paint();
}

// ------------------------------------------------------------------ drawing title block (footer)
function titleBlock() {
  const gen = ts(G.generated);
  const c = (k, v, cls = "") => el("div", { class: `tb ${cls}` }, el("span", {}, k), el("b", {}, v));
  const block = el("div", { class: "cr-titleblock", "aria-hidden": "true" },
    c("TITLE", "CALIFORNIA DUCK CURVE · NET DEMAND, GENERATION & STORAGE", "tb-title"),
    c("DWG NO.", "CA-DUCK-07"), c("SHEET", "1 OF 1"), c("SCALE", "NTS"), c("DATA", "CAISO"),
    c("REV", `${gen.getUTCFullYear()}-${String(gen.getUTCMonth() + 1).padStart(2, "0")}-${String(gen.getUTCDate()).padStart(2, "0")}`));
  document.querySelector("footer.site .wrap").append(add(block));
}
