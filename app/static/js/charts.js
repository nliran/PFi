// Hand-rolled SVG charts. No external libraries. Colors are read from CSS
// custom properties so the charts follow the active light/dark theme.
import { fmtMoney, fmtDate, esc, CLASS_LABELS, DONUT_COLORS } from "./format.js";
import { getPrivacy } from "./privacy.js";

const SVGNS = "http://www.w3.org/2000/svg";

// Privacy-aware money formatting for SVG <text>. CSS `filter: blur()` does not
// paint on SVG text in WebKit/Safari, so we mask the value in code instead.
function moneyText(v, compact) {
  return getPrivacy() ? "•••••" : fmtMoney(v, compact);
}

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// Read a CSS custom property off :root (falls back if undefined).
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Net-worth area+line chart with hover crosshair.
export function lineChart(container, series, opts = {}) {
  container.innerHTML = "";
  if (!series.length) { container.innerHTML = '<div class="empty">No data yet</div>'; return; }
  const accent = cssVar("--accent", "#3fb950");
  const grid = cssVar("--line", "#2a3441");
  const muted = cssVar("--muted", "#8b98a9");
  const bg = cssVar("--bg", "#0f1419");

  const W = container.clientWidth || 720, H = opts.height || 300;
  const pad = { l: 58, r: 16, t: 14, b: 26 };
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, container);

  const ys = series.map((d) => d.net_worth);
  const yMin = Math.min(0, ...ys), yMax = Math.max(...ys) * 1.06;
  const X = (i) => pad.l + (i / (series.length - 1 || 1)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - ((v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);

  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = yMin + (t / ticks) * (yMax - yMin);
    const y = Y(v);
    el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: grid, "stroke-width": 1 }, svg);
    const tx = el("text", { x: pad.l - 8, y: y + 4, fill: muted, "font-size": 11, "text-anchor": "end" }, svg);
    tx.textContent = moneyText(v, true);
  }
  const nLab = Math.min(6, series.length);
  for (let i = 0; i < nLab; i++) {
    const idx = Math.round((i / (nLab - 1)) * (series.length - 1));
    const tx = el("text", { x: X(idx), y: H - 6, fill: muted, "font-size": 11, "text-anchor": "middle" }, svg);
    tx.textContent = fmtDate(series[idx].date);
  }

  const gid = "nwgrad-" + Math.random().toString(36).slice(2, 8);
  let dArea = `M ${X(0)} ${Y(ys[0])}`;
  series.forEach((d, i) => { dArea += ` L ${X(i)} ${Y(d.net_worth)}`; });
  dArea += ` L ${X(series.length - 1)} ${Y(yMin)} L ${X(0)} ${Y(yMin)} Z`;
  const grad = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, svg);
  el("stop", { offset: "0%", "stop-color": accent, "stop-opacity": .28 }, grad);
  el("stop", { offset: "100%", "stop-color": accent, "stop-opacity": 0 }, grad);
  el("path", { d: dArea, fill: `url(#${gid})` }, svg);

  let dLine = `M ${X(0)} ${Y(ys[0])}`;
  series.forEach((d, i) => { dLine += ` L ${X(i)} ${Y(d.net_worth)}`; });
  el("path", { d: dLine, fill: "none", stroke: accent, "stroke-width": 2, "stroke-linejoin": "round" }, svg);

  const tip = document.getElementById("tip");
  const vline = el("line", { y1: pad.t, y2: H - pad.b, stroke: accent, "stroke-width": 1, opacity: 0 }, svg);
  const dot = el("circle", { r: 4, fill: accent, stroke: bg, "stroke-width": 2, opacity: 0 }, svg);
  const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    let i = Math.round(((mx - pad.l) / (W - pad.l - pad.r)) * (series.length - 1));
    i = Math.max(0, Math.min(series.length - 1, i));
    const d = series[i];
    vline.setAttribute("x1", X(i)); vline.setAttribute("x2", X(i)); vline.setAttribute("opacity", 1);
    dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(d.net_worth)); dot.setAttribute("opacity", 1);
    tip.style.opacity = 1;
    tip.style.left = (ev.clientX + 14) + "px";
    tip.style.top = (ev.clientY - 10) + "px";
    const ch = d.change == null ? "" :
      `<div class="${d.change >= 0 ? 'up' : 'down'}">${d.change >= 0 ? '+' : ''}${fmtMoney(d.change)} (${(d.pct_change * 100).toFixed(1)}%)</div>`;
    const note = d.note ? `<div class="tip-note">${esc(d.note)}</div>` : "";
    tip.innerHTML = `<div class="d">${fmtDate(d.date)}</div><div class="v">${fmtMoney(d.net_worth)}</div>${ch}${note}`;
  });
  hit.addEventListener("mouseleave", () => {
    vline.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); tip.style.opacity = 0;
  });
}

// Fixed categorical palette for the Trends view (kept stable across themes so
// the in-page legends always match the drawn series).
export const TREND_COLORS = {
  liquid: "#2E7CF6",
  nonliquid: "#17A34A",
  debt: "#E0A93B",
  net: "#7C5CFC",
};

// Least-squares linear regression over y-values indexed 0..n-1.
function linreg(ys) {
  const pts = ys.map((y, i) => [i, y]).filter((p) => p[1] != null);
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0, r2: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const intercept = (sy - slope * sx) / n;
  const r = (n * sxy - sx * sy) / (Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy)) || 1);
  return { slope, intercept, r2: r * r };
}

// Trailing simple moving average; first (w-1) points are null.
function movingAvg(ys, w) {
  return ys.map((_, i) => {
    if (i < w - 1) return null;
    let s = 0;
    for (let j = i - w + 1; j <= i; j++) s += ys[j];
    return s / w;
  });
}

function axes(svg, W, H, pad, X, Y, dates, yMin, yMax) {
  const grid = cssVar("--line", "#2a3441");
  const muted = cssVar("--muted", "#8b98a9");
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) {
    const v = yMin + (t / ticks) * (yMax - yMin);
    const y = Y(v);
    el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: grid, "stroke-width": 1, opacity: Math.abs(v) < 1 ? 1 : 0.55 }, svg);
    const tx = el("text", { x: pad.l - 8, y: y + 4, fill: muted, "font-size": 11, "text-anchor": "end" }, svg);
    tx.textContent = moneyText(v, true);
  }
  const nLab = Math.min(6, dates.length);
  for (let i = 0; i < nLab; i++) {
    const idx = Math.round((i / (nLab - 1)) * (dates.length - 1));
    const tx = el("text", { x: X(idx), y: H - 8, fill: muted, "font-size": 11, "text-anchor": "middle" }, svg);
    tx.textContent = fmtDate(dates[idx]);
  }
}

// Stacked area: Liquid + Non-Liquid above zero, Debt below zero.
// data: [{date, liquid, nonliquid, debt}]  (debt positive => drawn negative)
export function stackedAreaChart(container, data, opts = {}) {
  container.innerHTML = "";
  if (!data.length) { container.innerHTML = '<div class="empty">No data yet</div>'; return; }
  const muted = cssVar("--muted", "#8b98a9");
  const W = container.clientWidth || 720, H = opts.height || 320;
  const pad = { l: 66, r: 16, t: 14, b: 28 };
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, container);

  const tops = data.map((d) => d.liquid + d.nonliquid);
  const bots = data.map((d) => -d.debt);
  const yMax = Math.max(...tops) * 1.06;
  const yMin = Math.min(0, ...bots) * 1.1;
  const X = (i) => pad.l + (i / (data.length - 1 || 1)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - ((v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);

  axes(svg, W, H, pad, X, Y, data.map((d) => d.date), yMin, yMax);

  const band = (bot, top, color) => {
    let d = `M ${X(0)} ${Y(top(0))}`;
    for (let i = 1; i < data.length; i++) d += ` L ${X(i)} ${Y(top(i))}`;
    for (let i = data.length - 1; i >= 0; i--) d += ` L ${X(i)} ${Y(bot(i))}`;
    d += " Z";
    el("path", { d, fill: color, "fill-opacity": 0.82 }, svg);
  };
  band((i) => 0, (i) => data[i].liquid, TREND_COLORS.liquid);
  band((i) => data[i].liquid, (i) => data[i].liquid + data[i].nonliquid, TREND_COLORS.nonliquid);
  band((i) => -data[i].debt, (i) => 0, TREND_COLORS.debt);
  el("line", { x1: pad.l, y1: Y(0), x2: W - pad.r, y2: Y(0), stroke: muted, "stroke-width": 1 }, svg);

  const tip = document.getElementById("tip");
  const vline = el("line", { y1: pad.t, y2: H - pad.b, stroke: muted, "stroke-width": 1, opacity: 0 }, svg);
  const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    let i = Math.round(((ev.clientX - rect.left - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
    i = Math.max(0, Math.min(data.length - 1, i));
    const d = data[i];
    vline.setAttribute("x1", X(i)); vline.setAttribute("x2", X(i)); vline.setAttribute("opacity", 1);
    tip.style.opacity = 1; tip.style.left = (ev.clientX + 14) + "px"; tip.style.top = (ev.clientY - 10) + "px";
    tip.innerHTML = `<div class="d">${fmtDate(d.date)}</div>
      <div class="v">${fmtMoney(d.liquid + d.nonliquid - d.debt)}</div>
      <div class="tl" style="color:${TREND_COLORS.liquid}">Liquid ${fmtMoney(d.liquid, true)}</div>
      <div class="tl" style="color:${TREND_COLORS.nonliquid}">Non-Liquid ${fmtMoney(d.nonliquid, true)}</div>
      <div class="tl" style="color:${TREND_COLORS.debt}">Debt ${fmtMoney(d.debt, true)}</div>`;
  });
  hit.addEventListener("mouseleave", () => { vline.setAttribute("opacity", 0); tip.style.opacity = 0; });
}

// Multi-series line chart with optional markers, linear trendline (+R²) and
// trailing moving average per series.
// dates: [iso]; seriesList: [{label,color,data:[num|null],markers,trend,movingAvg}]
export function multiLineChart(container, dates, seriesList, opts = {}) {
  container.innerHTML = "";
  if (!dates.length) { container.innerHTML = '<div class="empty">No data yet</div>'; return; }
  const bg = cssVar("--bg", "#0f1419");
  const W = container.clientWidth || 720, H = opts.height || 320;
  const pad = { l: 66, r: 16, t: 18, b: 28 };
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, container);

  let allY = [];
  seriesList.forEach((s) => { allY = allY.concat(s.data.filter((v) => v != null)); });
  const yMin = Math.min(0, ...allY), yMax = Math.max(...allY) * 1.06;
  const n = dates.length;
  const X = (i) => pad.l + (i / (n - 1 || 1)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - ((v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);

  axes(svg, W, H, pad, X, Y, dates, yMin, yMax);

  let trendNote = "";
  seriesList.forEach((s) => {
    const path = (vals, w, dash, op) => {
      let d = "";
      vals.forEach((v, i) => { if (v == null) return; d += (d ? " L" : "M") + ` ${X(i)} ${Y(v)}`; });
      if (d) el("path", { d, fill: "none", stroke: s.color, "stroke-width": w, "stroke-linejoin": "round", ...(dash ? { "stroke-dasharray": dash } : {}), opacity: op }, svg);
    };
    if (s.trend) {
      const { slope, intercept, r2 } = linreg(s.data);
      el("line", { x1: X(0), y1: Y(intercept), x2: X(n - 1), y2: Y(intercept + slope * (n - 1)), stroke: s.color, "stroke-width": 1.5, "stroke-dasharray": "6 4", opacity: 0.55 }, svg);
      trendNote += `<span style="color:${s.color}">${s.label} trend R²=${r2.toFixed(3)}</span>`;
    }
    if (s.movingAvg) path(movingAvg(s.data, s.movingAvg), 1.5, "2 3", 0.9);
    path(s.data, 2, null, 1);
    if (s.markers) s.data.forEach((v, i) => { if (v == null) return; el("circle", { cx: X(i), cy: Y(v), r: 3, fill: bg, stroke: s.color, "stroke-width": 2 }, svg); });
  });
  if (trendNote) {
    const fo = el("text", { x: pad.l + 6, y: pad.t + 4, "font-size": 11 }, svg);
    fo.innerHTML = trendNote.replace(/<span[^>]*>/g, "").replace(/<\/span>/g, "");
    fo.setAttribute("fill", cssVar("--muted", "#888"));
  }

  const tip = document.getElementById("tip");
  const vline = el("line", { y1: pad.t, y2: H - pad.b, stroke: cssVar("--muted", "#888"), "stroke-width": 1, opacity: 0 }, svg);
  const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    let i = Math.round(((ev.clientX - rect.left - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    vline.setAttribute("x1", X(i)); vline.setAttribute("x2", X(i)); vline.setAttribute("opacity", 1);
    tip.style.opacity = 1; tip.style.left = (ev.clientX + 14) + "px"; tip.style.top = (ev.clientY - 10) + "px";
    const note = opts.notes && opts.notes[i] ? `<div class="tip-note">${esc(opts.notes[i])}</div>` : "";
    tip.innerHTML = `<div class="d">${fmtDate(dates[i])}</div>` +
      seriesList.map((s) => `<div class="tl" style="color:${s.color}">${s.label} ${s.data[i] == null ? "—" : fmtMoney(s.data[i], true)}</div>`).join("") + note;
  });
  hit.addEventListener("mouseleave", () => { vline.setAttribute("opacity", 0); tip.style.opacity = 0; });
}

// 100%-stacked area chart. rows[i] = {date, values:{key:number}}; keys define
// stack order (bottom->top). colorFn/labelFn map a key to color/label.
export function percentStackChart(container, rows, keys, colorFn, labelFn, opts = {}) {
  container.innerHTML = "";
  if (!rows.length) { container.innerHTML = '<div class="empty">No data yet</div>'; return; }
  const grid = cssVar("--line", "#2a3441");
  const muted = cssVar("--muted", "#8b98a9");
  const W = container.clientWidth || 720, H = opts.height || 320;
  const pad = { l: 46, r: 16, t: 14, b: 28 };
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, container);

  const n = rows.length;
  const X = (i) => pad.l + (i / (n - 1 || 1)) * (W - pad.l - pad.r);
  const Y = (f) => H - pad.b - f * (H - pad.t - pad.b); // f in [0,1]

  // positive-only total per column for normalization
  const totals = rows.map((r) => keys.reduce((s, k) => s + Math.max(0, r.values[k] || 0), 0));
  const frac = (i, k) => (totals[i] > 0 ? Math.max(0, rows[i].values[k] || 0) / totals[i] : 0);

  // y grid at 0/25/50/75/100%
  for (let t = 0; t <= 4; t++) {
    const y = Y(t / 4);
    el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: grid, "stroke-width": 1, opacity: 0.55 }, svg);
    const tx = el("text", { x: pad.l - 8, y: y + 4, fill: muted, "font-size": 11, "text-anchor": "end" }, svg);
    tx.textContent = (t * 25) + "%";
  }
  const nLab = Math.min(6, n);
  for (let i = 0; i < nLab; i++) {
    const idx = Math.round((i / (nLab - 1)) * (n - 1));
    const tx = el("text", { x: X(idx), y: H - 8, fill: muted, "font-size": 11, "text-anchor": "middle" }, svg);
    tx.textContent = fmtDate(rows[idx].date);
  }

  // cumulative band per key
  const cum = new Array(n).fill(0);
  keys.forEach((k) => {
    let d = "";
    // top edge (cum + frac) left->right
    for (let i = 0; i < n; i++) d += (i ? " L" : "M") + ` ${X(i)} ${Y(cum[i] + frac(i, k))}`;
    // bottom edge (cum) right->left
    for (let i = n - 1; i >= 0; i--) d += ` L ${X(i)} ${Y(cum[i])}`;
    d += " Z";
    el("path", { d, fill: colorFn(k), "fill-opacity": 0.85 }, svg);
    for (let i = 0; i < n; i++) cum[i] += frac(i, k);
  });

  const tip = document.getElementById("tip");
  const vline = el("line", { y1: pad.t, y2: H - pad.b, stroke: muted, "stroke-width": 1, opacity: 0 }, svg);
  const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    let i = Math.round(((ev.clientX - rect.left - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    vline.setAttribute("x1", X(i)); vline.setAttribute("x2", X(i)); vline.setAttribute("opacity", 1);
    tip.style.opacity = 1; tip.style.left = (ev.clientX + 14) + "px"; tip.style.top = (ev.clientY - 10) + "px";
    const parts = keys
      .filter((k) => (rows[i].values[k] || 0) > 0)
      .map((k) => `<div class="tl" style="color:${colorFn(k)}">${labelFn(k)} ${(frac(i, k) * 100).toFixed(0)}% · ${fmtMoney(rows[i].values[k], true)}</div>`);
    tip.innerHTML = `<div class="d">${fmtDate(rows[i].date)}</div>${parts.join("")}`;
  });
  hit.addEventListener("mouseleave", () => { vline.setAttribute("opacity", 0); tip.style.opacity = 0; });
}

export function donut(container, data, opts = {}) {
  container.innerHTML = "";
  const total = data.reduce((s, d) => s + d.total, 0);
  if (!total) { container.innerHTML = '<div class="empty">No allocation</div>'; return; }
  const text = cssVar("--text", "#e6edf3");
  const muted = cssVar("--muted", "#8b98a9");
  const size = opts.size || 220, r = size / 2, ir = r * 0.62, cx = r, cy = r;
  const svg = el("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, container);
  let a0 = -Math.PI / 2;
  data.forEach((d) => {
    const frac = d.total / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi0 = cx + ir * Math.cos(a0), yi0 = cy + ir * Math.sin(a0);
    const xi1 = cx + ir * Math.cos(a1), yi1 = cy + ir * Math.sin(a1);
    const path = el("path", {
      d: `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${ir} ${ir} 0 ${large} 0 ${xi0} ${yi0} Z`,
      fill: DONUT_COLORS[d.asset_class] || "#888",
    }, svg);
    const tip = document.getElementById("tip");
    path.addEventListener("mousemove", (ev) => {
      tip.style.opacity = 1; tip.style.left = (ev.clientX + 14) + "px"; tip.style.top = (ev.clientY - 10) + "px";
      tip.innerHTML = `<div class="d">${CLASS_LABELS[d.asset_class] || d.asset_class}</div><div class="v">${fmtMoney(d.total)} · ${(frac * 100).toFixed(1)}%</div>`;
    });
    path.addEventListener("mouseleave", () => (tip.style.opacity = 0));
    a0 = a1;
  });
  const t1 = el("text", { x: cx, y: cy - 4, fill: text, "font-size": 17, "font-weight": 650, "text-anchor": "middle" }, svg);
  t1.textContent = moneyText(total, true);
  const label = opts.centerLabel || "assets";
  const t2 = el("text", { x: cx, y: cy + 14, fill: muted, "font-size": label.length > 8 ? 9.5 : 11, "text-anchor": "middle" }, svg);
  t2.textContent = label;

  // Optional hover explanation over the center hole (e.g. why the total differs
  // from the gross Liquid + Non-Liquid KPIs). Uses the shared #tip element.
  if (opts.centerTip) {
    const tip = document.getElementById("tip");
    const hub = el("circle", { cx, cy, r: ir, fill: "transparent" }, svg);
    hub.style.cursor = "help";
    hub.addEventListener("mousemove", (ev) => {
      tip.style.opacity = 1; tip.style.left = (ev.clientX + 14) + "px"; tip.style.top = (ev.clientY - 10) + "px";
      tip.innerHTML = `<div class="tip-explain">${esc(opts.centerTip)}</div>`;
    });
    hub.addEventListener("mouseleave", () => (tip.style.opacity = 0));
  }
}
