// Trends view: recreations of the MoniesV2 workbook charts + a month-by-month
// net-worth table, driven by the monthly Liquid / Non-Liquid / Debt series.
// A picker at the top chooses which trends show (checkboxes) and their order
// (drag the chips left/right); both are remembered per browser.
import { api } from "../api.js";
import { stackedAreaChart, multiLineChart, percentStackChart, TREND_COLORS } from "../charts.js";
import { fmtMoney, fmtDate, CLASS_LABELS, DONUT_COLORS, help } from "../format.js";
import { selectMonth } from "./snapshots.js";
import { setView } from "../app.js";

const main = document.getElementById("main");

// All Trends view preferences persist per browser (localStorage), so they
// survive a page reload / server restart / self-update.
const RANGE_KEY = "pfi-trends-range";
const SORT_KEY = "pfi-trends-sort";
const SORT_COLS = ["date", "liquid", "nonliquid", "debt", "net", "dchg", "pct"];
function loadRange() {
  try { const r = localStorage.getItem(RANGE_KEY); if (["1Y", "3Y", "5Y", "ALL"].includes(r)) return r; } catch (e) {}
  return "ALL";
}
function loadSort() {
  try {
    const s = JSON.parse(localStorage.getItem(SORT_KEY) || "null");
    if (s && SORT_COLS.includes(s.key) && (s.dir === 1 || s.dir === -1)) return s;
  } catch (e) {}
  return { key: "date", dir: -1 }; // newest first by default
}
let range = loadRange();
let tableSort = loadSort();

// Master list of toggleable trend panels; `key` matches data-panel.
const PANELS = [
  { key: "stack", label: "Assets & Debts" },
  { key: "ln", label: "Liquid vs Non-Liquid" },
  { key: "nw", label: "Net Worth & Trend" },
  { key: "alloc", label: "Allocation Drift" },
  { key: "debt", label: "Debt & Equity" },
  { key: "table", label: "Month-by-month table" },
];
const labelOf = (k) => (PANELS.find((p) => p.key === k) || {}).label || k;

const VIS_KEY = "pfi-trends-visible";
const ORDER_KEY = "pfi-trends-order";
function loadVisible() {
  const v = {};
  PANELS.forEach((p) => (v[p.key] = true)); // default: everything on
  try { Object.assign(v, JSON.parse(localStorage.getItem(VIS_KEY) || "{}")); } catch (e) {}
  return v;
}
function saveVisible(v) { try { localStorage.setItem(VIS_KEY, JSON.stringify(v)); } catch (e) {} }
function loadOrder() {
  let ord = [];
  try { ord = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]"); } catch (e) {}
  ord = ord.filter((k) => PANELS.some((p) => p.key === k));       // drop unknown keys
  PANELS.forEach((p) => { if (!ord.includes(p.key)) ord.push(p.key); }); // append new ones
  return ord;
}
function saveOrder(o) { try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch (e) {} }
let visible = loadVisible();
let order = loadOrder();

const legend = (items) =>
  `<div class="legend">${items.map((i) =>
    `<div class="item"><span class="swatch" style="background:${i.color}${i.dash ? ";opacity:.6" : ""}"></span>${i.label}</div>`).join("")}</div>`;

export async function viewTrends() {
  main.innerHTML = `<h1>Trends</h1><p class="sub">Loading…</p>`;
  const [d, t] = await Promise.all([api.get("/dashboard"), api.get("/trends")]);
  const all = d.series;
  const allT = t.series;
  const classes = t.classes;
  if (!all.length) {
    main.innerHTML = `<h1>Trends</h1><p class="sub">No snapshots yet — add one under Monthly Entry.</p>`;
    return;
  }

  // Each trend panel's markup, keyed so we can render (and reorder) by `order`.
  const panelHTML = {
    stack: `
    <div class="panel" data-panel="stack">
      <div class="panel-head"><h2>Assets &amp; Debts Over Time ${help("ht-trends", "Liquid + Non-Liquid stacked above zero, Debt below it")}</h2></div>
      ${legend([
        { label: "Liquid", color: TREND_COLORS.liquid },
        { label: "Non-Liquid", color: TREND_COLORS.nonliquid },
        { label: "Debt", color: TREND_COLORS.debt },
      ])}
      <div id="chartStack"></div>
    </div>`,
    ln: `
    <div class="panel" data-panel="ln">
      <div class="panel-head"><h2>Liquid vs Non-Liquid ${help("ht-trends", "Both series as lines, with a dashed 6-month moving average on Liquid")}</h2></div>
      ${legend([
        { label: "Liquid", color: TREND_COLORS.liquid },
        { label: "Liquid · 6-mo avg", color: TREND_COLORS.liquid, dash: true },
        { label: "Non-Liquid", color: TREND_COLORS.nonliquid },
      ])}
      <div id="chartLN"></div>
    </div>`,
    nw: `
    <div class="panel" data-panel="nw">
      <div class="panel-head"><h2>Net Worth &amp; Trend ${help("ht-trends", "Net worth with a dashed linear trendline and its R² fit")}</h2></div>
      ${legend([
        { label: "Net Worth", color: TREND_COLORS.net },
        { label: "Linear trend", color: TREND_COLORS.net, dash: true },
      ])}
      <div id="chartNW"></div>
    </div>`,
    alloc: `
    <div class="panel" data-panel="alloc">
      <div class="panel-head"><h2>Allocation Drift ${help("ht-trends", "Each asset class as a share of total assets over time")}</h2></div>
      <p class="sub" style="margin:-6px 0 12px">Asset-class mix as a share of total assets (real estate shown net of its mortgage).</p>
      ${legend(classes.map((c) => ({ label: CLASS_LABELS[c] || c, color: DONUT_COLORS[c] || "#888" })))}
      <div id="chartAlloc"></div>
    </div>`,
    debt: `
    <div class="panel" data-panel="debt">
      <div class="panel-head"><h2>Debt Paydown &amp; Real-Estate Equity ${help("ht-trends", "Total debt, mortgages only, and net real-estate equity (value minus linked mortgage)")}</h2></div>
      ${legend([
        { label: "Total Debt", color: TREND_COLORS.debt },
        { label: "Mortgages", color: "#C2410C", dash: true },
        { label: "Net R/E Equity", color: TREND_COLORS.nonliquid },
      ])}
      <div id="chartDebt"></div>
    </div>`,
    table: `
    <div class="panel" data-panel="table">
      <div class="panel-head"><h2>Net Worth — Month by Month ${help("ht-trends", "Every snapshot with its month-over-month change; click a header to sort, a row to open that month")}</h2></div>
      <div class="nw-table-wrap"><div id="trendTable"></div></div>
    </div>`,
  };

  const pickerChips = () =>
    order.map((k) =>
      `<div class="pick" data-k="${k}" draggable="true" title="Drag to reorder">
        <span class="grip" aria-hidden="true">⠿</span>
        <label><input type="checkbox" data-k="${k}" ${visible[k] ? "checked" : ""}><span>${labelOf(k)}</span></label>
      </div>`).join("");

  main.innerHTML = `
    <h1>Trends ${help("ht-trends", "Long-run analytical charts, all driven by your monthly snapshots")}</h1>
    <p class="sub">Long-run views of the portfolio, rebuilt from your monthly snapshots.</p>
    <div class="range-tabs" id="ranges" style="margin-bottom:14px">
      ${["1Y", "3Y", "5Y", "ALL"].map((r) => `<button data-r="${r}" class="${range === r ? "active" : ""}">${r}</button>`).join("")}
    </div>

    <div class="panel trend-picker-panel">
      <div class="trend-picker">
        <span class="pick-label">Show / reorder:</span>
        <div class="pick-list" id="picker">${pickerChips()}</div>
      </div>
    </div>

    <div id="trendPanels">${order.map((k) => panelHTML[k]).join("")}</div>`;

  const el = (id) => document.getElementById(id);
  const rangeMonths = () => ({ "1Y": 13, "3Y": 37, "5Y": 61, "ALL": all.length }[range]);

  function applyVisibility() {
    PANELS.forEach((p) => {
      const node = document.querySelector(`.panel[data-panel="${p.key}"]`);
      if (node) node.hidden = !visible[p.key];
    });
  }

  // ---- month-by-month table (sortable by any column) ----
  const changeCell = (diff) => {
    if (diff == null || Math.abs(diff) < 0.005) return `<span class="delta flat">—</span>`;
    const up = diff >= 0;
    return `<span class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${fmtMoney(Math.abs(diff))}</span>`;
  };
  const pctCell = (frac) => {
    if (frac == null || Math.abs(frac) < 0.00005) return `<span class="delta flat">—</span>`;
    const up = frac >= 0;
    return `<span class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${(Math.abs(frac) * 100).toFixed(2)}%</span>`;
  };

  function renderTable() {
    if (!visible.table) return;
    const rows = all.slice(Math.max(0, all.length - rangeMonths()));
    const val = (p, k) => ({
      liquid: p.liquid, nonliquid: p.nonliquid, debt: -p.debt,
      net: p.net_worth, dchg: p.change, pct: p.pct_change,
    }[k]);
    const { key, dir } = tableSort;
    rows.sort((a, b) => {
      if (key === "date") return dir * a.date.localeCompare(b.date);
      let av = val(a, key), bv = val(b, key);
      av = av == null ? -Infinity : av;
      bv = bv == null ? -Infinity : bv;
      return dir * (av - bv);
    });
    const arrow = (k) => (key === k ? (dir > 0 ? " ▲" : " ▼") : "");
    const th = (k, label, cls = "") => `<th class="sortable ${cls}" data-sort="${k}">${label}${arrow(k)}</th>`;
    const body = rows.map((p) => `
      <tr data-id="${p.id}">
        <td>${fmtDate(p.date)}</td>
        <td class="num sensitive">${fmtMoney(p.liquid)}</td>
        <td class="num sensitive">${fmtMoney(p.nonliquid)}</td>
        <td class="num sensitive">${fmtMoney(-p.debt)}</td>
        <td class="num sensitive nw-cell">${fmtMoney(p.net_worth)}</td>
        <td class="num">${changeCell(p.change)}</td>
        <td class="num">${pctCell(p.pct_change)}</td>
      </tr>`).join("");
    el("trendTable").innerHTML = `
      <table class="nw-table">
        <thead><tr>
          ${th("date", "Date")}
          ${th("liquid", "Liquid", "num")}
          ${th("nonliquid", "Non-Liquid", "num")}
          ${th("debt", "Debts", "num")}
          ${th("net", "Net Worth", "num")}
          ${th("dchg", "$ Change", "num")}
          ${th("pct", "% Change", "num")}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>`;
    el("trendTable").querySelectorAll("th.sortable").forEach((thEl) =>
      thEl.addEventListener("click", () => {
        const k = thEl.dataset.sort;
        if (tableSort.key === k) tableSort.dir *= -1;
        else tableSort = { key: k, dir: -1 }; // new column: descending / newest-first
        try { localStorage.setItem(SORT_KEY, JSON.stringify(tableSort)); } catch (e) {}
        renderTable();
      }));
    el("trendTable").querySelectorAll("tbody tr").forEach((tr) =>
      tr.addEventListener("click", () => { selectMonth(+tr.dataset.id); setView("snapshots"); }));
  }

  // ---- charts (only draw the visible ones; a hidden container has no width) ----
  const draw = () => {
    const months = rangeMonths();
    const s = all.slice(Math.max(0, all.length - months));
    const st = allT.slice(Math.max(0, allT.length - months));
    const dates = s.map((p) => p.date);
    const fewMarks = s.length <= 40;

    if (visible.stack) stackedAreaChart(el("chartStack"), s);

    if (visible.ln) multiLineChart(el("chartLN"), dates, [
      { label: "Liquid", color: TREND_COLORS.liquid, data: s.map((p) => p.liquid), markers: fewMarks, movingAvg: 6 },
      { label: "Non-Liquid", color: TREND_COLORS.nonliquid, data: s.map((p) => p.nonliquid), markers: fewMarks },
    ]);

    if (visible.nw) multiLineChart(el("chartNW"), dates, [
      { label: "Net Worth", color: TREND_COLORS.net, data: s.map((p) => p.net_worth), markers: fewMarks, trend: true },
    ], { notes: s.map((p) => p.note) });

    if (visible.alloc) percentStackChart(
      el("chartAlloc"),
      st.map((p) => ({ date: p.date, values: p.alloc })),
      classes,
      (c) => DONUT_COLORS[c] || "#888",
      (c) => CLASS_LABELS[c] || c,
    );

    if (visible.debt) multiLineChart(el("chartDebt"), st.map((p) => p.date), [
      { label: "Total Debt", color: TREND_COLORS.debt, data: st.map((p) => p.debt), markers: fewMarks },
      { label: "Mortgages", color: "#C2410C", data: st.map((p) => p.re_mortgage), markers: false },
      { label: "Net R/E Equity", color: TREND_COLORS.nonliquid, data: st.map((p) => p.re_equity), markers: fewMarks },
    ]);

    renderTable();
  };

  applyVisibility();
  draw();

  // ---- range tabs ----
  document.getElementById("ranges").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]"); if (!b) return;
    range = b.dataset.r;
    try { localStorage.setItem(RANGE_KEY, range); } catch (e2) {}
    document.querySelectorAll("#ranges button").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  });

  // ---- picker: checkboxes toggle visibility ----
  const picker = document.getElementById("picker");
  picker.addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-k]"); if (!cb) return;
    visible[cb.dataset.k] = cb.checked;
    saveVisible(visible);
    applyVisibility();
    draw(); // (re)draw anything just switched on
  });

  // ---- picker: drag chips left/right to reorder the trends ----
  let dragKey = null;
  const clearOver = () => picker.querySelectorAll(".pick.over-before,.pick.over-after")
    .forEach((c) => c.classList.remove("over-before", "over-after"));
  picker.addEventListener("dragstart", (e) => {
    const chip = e.target.closest(".pick"); if (!chip) return;
    dragKey = chip.dataset.k;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragKey); } catch (err) {}
    chip.classList.add("dragging");
  });
  picker.addEventListener("dragover", (e) => {
    if (!dragKey) return;
    const chip = e.target.closest(".pick"); if (!chip || chip.dataset.k === dragKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = chip.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    clearOver();
    chip.classList.add(after ? "over-after" : "over-before");
  });
  picker.addEventListener("drop", (e) => {
    const chip = e.target.closest(".pick"); if (!chip || !dragKey) return;
    e.preventDefault();
    const targetKey = chip.dataset.k;
    if (targetKey !== dragKey) {
      const r = chip.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      order = order.filter((k) => k !== dragKey);
      let idx = order.indexOf(targetKey) + (after ? 1 : 0);
      order.splice(idx, 0, dragKey);
      saveOrder(order);
      reorderPanels();
      picker.innerHTML = pickerChips(); // re-render chips in new order
    }
    clearOver();
  });
  picker.addEventListener("dragend", () => {
    dragKey = null;
    picker.querySelectorAll(".pick.dragging").forEach((c) => c.classList.remove("dragging"));
    clearOver();
  });

  function reorderPanels() {
    const holder = document.getElementById("trendPanels");
    order.forEach((k) => {
      const node = holder.querySelector(`.panel[data-panel="${k}"]`);
      if (node) holder.appendChild(node); // moves into new order (SVGs preserved)
    });
  }

  window.addEventListener("resize", () => { if (document.getElementById("chartStack")) draw(); }, { once: true });
}
