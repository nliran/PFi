// Trends view: recreations of the MoniesV2 workbook charts, driven by the
// monthly Liquid / Non-Liquid / Debt series.
import { api } from "../api.js";
import { stackedAreaChart, multiLineChart, percentStackChart, TREND_COLORS } from "../charts.js";
import { fmtMoney, CLASS_LABELS, DONUT_COLORS, help } from "../format.js";

const main = document.getElementById("main");
let range = "ALL";

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

  main.innerHTML = `
    <h1>Trends ${help("ht-trends", "Long-run analytical charts, all driven by your monthly snapshots")}</h1>
    <p class="sub">Long-run views of the portfolio, rebuilt from your monthly snapshots.</p>
    <div class="range-tabs" id="ranges" style="margin-bottom:18px">
      ${["1Y", "3Y", "5Y", "ALL"].map((r) => `<button data-r="${r}" class="${range === r ? "active" : ""}">${r}</button>`).join("")}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Assets &amp; Debts Over Time ${help("ht-trends", "Liquid + Non-Liquid stacked above zero, Debt below it")}</h2></div>
      ${legend([
        { label: "Liquid", color: TREND_COLORS.liquid },
        { label: "Non-Liquid", color: TREND_COLORS.nonliquid },
        { label: "Debt", color: TREND_COLORS.debt },
      ])}
      <div id="chartStack"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Liquid vs Non-Liquid ${help("ht-trends", "Both series as lines, with a dashed 6-month moving average on Liquid")}</h2></div>
      ${legend([
        { label: "Liquid", color: TREND_COLORS.liquid },
        { label: "Liquid · 6-mo avg", color: TREND_COLORS.liquid, dash: true },
        { label: "Non-Liquid", color: TREND_COLORS.nonliquid },
      ])}
      <div id="chartLN"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Net Worth &amp; Trend ${help("ht-trends", "Net worth with a dashed linear trendline and its R² fit")}</h2></div>
      ${legend([
        { label: "Net Worth", color: TREND_COLORS.net },
        { label: "Linear trend", color: TREND_COLORS.net, dash: true },
      ])}
      <div id="chartNW"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Allocation Drift ${help("ht-trends", "Each asset class as a share of total assets over time")}</h2></div>
      <p class="sub" style="margin:-6px 0 12px">Asset-class mix as a share of total assets (real estate shown net of its mortgage).</p>
      ${legend(classes.map((c) => ({ label: CLASS_LABELS[c] || c, color: DONUT_COLORS[c] || "#888" })))}
      <div id="chartAlloc"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Debt Paydown &amp; Real-Estate Equity ${help("ht-trends", "Total debt, mortgages only, and net real-estate equity (value minus linked mortgage)")}</h2></div>
      ${legend([
        { label: "Total Debt", color: TREND_COLORS.debt },
        { label: "Mortgages", color: "#C2410C", dash: true },
        { label: "Net R/E Equity", color: TREND_COLORS.nonliquid },
      ])}
      <div id="chartDebt"></div>
    </div>`;

  const draw = () => {
    const months = { "1Y": 13, "3Y": 37, "5Y": 61, "ALL": all.length }[range];
    const s = all.slice(Math.max(0, all.length - months));
    const st = allT.slice(Math.max(0, allT.length - months));
    const dates = s.map((p) => p.date);
    const fewMarks = s.length <= 40;

    stackedAreaChart(document.getElementById("chartStack"), s);

    multiLineChart(document.getElementById("chartLN"), dates, [
      { label: "Liquid", color: TREND_COLORS.liquid, data: s.map((p) => p.liquid), markers: fewMarks, movingAvg: 6 },
      { label: "Non-Liquid", color: TREND_COLORS.nonliquid, data: s.map((p) => p.nonliquid), markers: fewMarks },
    ]);

    multiLineChart(document.getElementById("chartNW"), dates, [
      { label: "Net Worth", color: TREND_COLORS.net, data: s.map((p) => p.net_worth), markers: fewMarks, trend: true },
    ], { notes: s.map((p) => p.note) });

    percentStackChart(
      document.getElementById("chartAlloc"),
      st.map((p) => ({ date: p.date, values: p.alloc })),
      classes,
      (c) => DONUT_COLORS[c] || "#888",
      (c) => CLASS_LABELS[c] || c,
    );

    multiLineChart(document.getElementById("chartDebt"), st.map((p) => p.date), [
      { label: "Total Debt", color: TREND_COLORS.debt, data: st.map((p) => p.debt), markers: fewMarks },
      { label: "Mortgages", color: "#C2410C", data: st.map((p) => p.re_mortgage), markers: false },
      { label: "Net R/E Equity", color: TREND_COLORS.nonliquid, data: st.map((p) => p.re_equity), markers: fewMarks },
    ]);
  };
  draw();

  document.getElementById("ranges").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]"); if (!b) return;
    range = b.dataset.r;
    document.querySelectorAll("#ranges button").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  });
  window.addEventListener("resize", () => { if (document.getElementById("chartStack")) draw(); }, { once: true });
}
