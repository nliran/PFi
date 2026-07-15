// Dashboard view: KPIs, net-worth line chart, holdings table, allocation donut.
import { api } from "../api.js";
import { lineChart, donut } from "../charts.js";
import { openAccountById } from "./accounts.js";
import { selectMonth } from "./snapshots.js";
import { setView } from "../app.js";
import { fmtMoney, fmtDate, esc, KIND_LABEL, CLASS_LABELS, DONUT_COLORS, help, setClassColor, resetClassColors } from "../format.js";

const main = document.getElementById("main");
let range = "ALL";
let holdSort = { key: "value", dir: -1 }; // default: value, descending
let debtSort = { key: "value", dir: -1 }; // default: balance, descending

// Balance-weighted average APR over the debts that carry a rate.
function weightedApr(debts) {
  const rated = debts.filter((a) => a.apr != null);
  const base = rated.reduce((t, a) => t + a.value, 0);
  return base ? rated.reduce((t, a) => t + a.value * a.apr, 0) / base : null;
}

const RATE_LABEL = { fixed: "Fixed", variable: "Variable", unset: "Unset" };

// Month-over-month change for a debt. A reduction (paying down) reads green,
// an increase reads red — opposite of assets. New debts get a "New" pill.
function debtDelta(a) {
  if (a.prev_value == null) return `<span class="tag pill-new">New</span>`;
  const diff = a.value - a.prev_value;
  if (Math.abs(diff) < 0.005) return `<span class="delta flat">—</span>`;
  const down = diff < 0; // debt went down = good
  return `<span class="delta ${down ? "up" : "down"}">${diff >= 0 ? "▲" : "▼"} ${fmtMoney(Math.abs(diff), true)}</span>`;
}

// Debt Overview: summary stats, a Fixed/Variable split bar, and a sortable
// bar-in-row table (bar length = balance, color = rate type) with each rate,
// month-over-month change, and share. Liability ledgers are shown here too,
// marked "Ledger", each with a toggle for whether it counts toward net worth.
function renderDebt(container, accounts, ledgers = []) {
  const debts = accounts.filter((a) => a.kind === "debt" && a.value !== 0);
  // Liability ledgers that count toward net worth ride along in this table,
  // marked "Ledger". They carry no APR/rate and never affect the weighted APR.
  const ledgerRows = ledgers
    .filter((l) => l.side === "liability" && l.value !== 0)
    .map((l) => ({ ...l, isLedger: true, apr: null, rate_type: null }));
  const cash = accounts.filter((a) => a.asset_class === "cash").reduce((t, a) => t + a.value, 0);
  const totalDebt = debts.reduce((t, a) => t + a.value, 0)
    + ledgerRows.reduce((t, l) => t + l.value, 0);
  if (!totalDebt && !ledgerRows.length) { container.innerHTML = `<p class="sub" style="margin:0">No debt recorded.</p>`; return; }

  const wapr = weightedApr(debts);
  const ratio = cash / totalDebt;
  const aprPct = (v) => v == null ? "—" : (v * 100).toFixed(2) + "%";

  // Fixed / Variable / Unset buckets (by balance), each with its own weighted APR.
  const buckets = ["fixed", "variable", "unset"].map((rt) => {
    const items = debts.filter((a) => (a.rate_type || "unset") === rt);
    return { rt, total: items.reduce((t, a) => t + a.value, 0), wapr: weightedApr(items), n: items.length };
  }).filter((b) => b.total > 0);

  const splitBar = `<div class="split-bar">${buckets.map((b) =>
    `<span class="seg rate-${b.rt}" style="width:${(b.total / totalDebt) * 100}%" title="${RATE_LABEL[b.rt]} · ${fmtMoney(b.total)} · avg ${aprPct(b.wapr)}"></span>`).join("")}</div>
    <div class="split-legend">${buckets.map((b) =>
      `<span class="item"><span class="swatch rate-${b.rt}"></span>${RATE_LABEL[b.rt]} <b class="sensitive">${fmtMoney(b.total, true)}</b> · ${(b.total / totalDebt * 100).toFixed(0)}% · avg ${aprPct(b.wapr)}</span>`).join("")}</div>`;

  const tableRows = debts.concat(ledgerRows);
  const maxV = Math.max(1, ...tableRows.map((a) => Math.abs(a.value)));
  const rateCls = (a) => a.rate_type === "fixed" ? "fixed" : a.rate_type === "variable" ? "variable" : "unset";
  const ratePill = (a) => a.rate_type
    ? `<span class="tag rate-${a.rate_type}">${RATE_LABEL[a.rate_type]}</span>`
    : `<span class="tag rate-unset" title="Set Fixed/Variable in the account editor">—</span>`;

  container.innerHTML = `
    <div class="debt-stats">
      <div class="ministat"><div class="label">Total Debt</div><div class="mval sensitive">${fmtMoney(totalDebt)}</div></div>
      <div class="ministat"><div class="label">Weighted APR</div><div class="mval sensitive">${aprPct(wapr)}</div></div>
      <div class="ministat"><div class="label">Cash</div><div class="mval sensitive">${fmtMoney(cash)}</div></div>
      <div class="ministat"><div class="label">Cash / Debt</div><div class="mval sensitive ${ratio >= 1 ? "up" : ""}">${(ratio * 100).toFixed(1)}%</div></div>
    </div>
    ${splitBar}
    <div class="debt-table-wrap"></div>`;

  const wrap = container.querySelector(".debt-table-wrap");
  const sortVal = {
    name: (a) => a.name.toLowerCase(),
    value: (a) => a.value,
    delta: (a) => a.value - (a.prev_value == null ? a.value : a.prev_value),
    apr: (a) => a.apr == null ? -1 : a.apr,
    rate: (a) => RATE_LABEL[a.rate_type] || "Unset",
  };
  const renderTable = () => {
    const { key, dir } = debtSort;
    const cmp = (a, b) => {
      const va = sortVal[key](a), vb = sortVal[key](b);
      return dir * (va < vb ? -1 : va > vb ? 1 : 0);
    };
    const arrow = (k) => key === k ? (dir > 0 ? " ▲" : " ▼") : "";
    const rows = tableRows.slice().sort(cmp).map((a) => {
      if (a.isLedger) {
        return `
      <tr class="debt-row ledger-row" data-ledger="${a.id}">
        <td>${esc(a.name)} <span class="tag">Ledger</span></td>
        <td class="dbar-cell"><span class="dbar rate-unset" style="width:${(Math.abs(a.value) / maxV) * 100}%"></span></td>
        <td class="num">${fmtMoney(a.value)}</td>
        <td class="num">${debtDelta(a)}</td>
        <td class="num">—</td>
        <td><span class="tag rate-unset">—</span></td>
        <td class="num">${(a.value / totalDebt * 100).toFixed(0)}%</td>
      </tr>`;
      }
      return `
      <tr class="debt-row" data-id="${a.id}">
        <td>${esc(a.name)}</td>
        <td class="dbar-cell"><span class="dbar rate-${rateCls(a)}" style="width:${(a.value / maxV) * 100}%"></span></td>
        <td class="num">${fmtMoney(a.value)}</td>
        <td class="num">${debtDelta(a)}</td>
        <td class="num">${aprPct(a.apr)}</td>
        <td>${ratePill(a)}</td>
        <td class="num">${(a.value / totalDebt * 100).toFixed(0)}%</td>
      </tr>`;
    }).join("");
    wrap.innerHTML = `<table class="debt-table"><thead><tr>
      <th class="sortable" data-sort="name">Account${arrow("name")}</th><th></th>
      <th class="num sortable" data-sort="value">Balance${arrow("value")}</th>
      <th class="num sortable" data-sort="delta">M/M Δ${arrow("delta")}</th>
      <th class="num sortable" data-sort="apr">APR${arrow("apr")}</th>
      <th class="sortable" data-sort="rate">Rate${arrow("rate")}</th>
      <th class="num">Share</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Weighted average</td><td></td><td></td><td></td><td class="num">${aprPct(wapr)}</td><td></td><td></td></tr></tfoot>
    </table>`;
    wrap.querySelector("thead").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]"); if (!th) return;
      const k = th.dataset.sort;
      if (debtSort.key === k) debtSort.dir *= -1;
      else debtSort = { key: k, dir: (k === "name" || k === "rate") ? 1 : -1 };
      renderTable();
    });
    wrap.querySelectorAll("tr.debt-row[data-id]").forEach((tr) =>
      tr.addEventListener("click", () => openAccountById(+tr.dataset.id, { onSaved: viewDashboard })));
    wrap.querySelectorAll("tr.ledger-row[data-ledger]").forEach((tr) =>
      tr.addEventListener("click", () => setView("ledgers")));
  };
  renderTable();
}

export async function viewDashboard() {
  main.innerHTML = `<h1>Dashboard</h1><p class="sub">Loading…</p>`;
  const d = await api.get("/dashboard");
  const s = d.series;
  if (!s.length) {
    main.innerHTML = `<h1>Dashboard</h1><p class="sub">No snapshots yet — add one under Monthly Entry.</p>`;
    return;
  }
  const last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null;
  const yearAgo = s[Math.max(0, s.length - 13)];
  // invert=true for debt: an increase reads red, a decrease green (arrow still
  // points in the true direction of change).
  const delta = (a, b, invert = false) => {
    if (b == null) return "";
    const up = a - b >= 0, good = invert ? !up : up;
    return `<div class="delta ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${fmtMoney(Math.abs(a - b))}${b ? ' · ' + (((a - b) / b) * 100).toFixed(1) + '%' : ''}</div>`;
  };

  main.innerHTML = `
    <h1>Dashboard ${help("ht-dashboard", "Your at-a-glance summary: KPIs, net-worth trend, holdings, and allocation")}</h1>
    <p class="sub">As of ${fmtDate(last.date)} · ${s.length} monthly snapshots since ${fmtDate(s[0].date)}</p>
    <div class="kpis">
      <div class="kpi"><div class="label">Net Worth</div><div class="value">${fmtMoney(last.net_worth)}</div>${delta(last.net_worth, prev && prev.net_worth)}</div>
      <div class="kpi"><div class="label">Liquid</div><div class="value">${fmtMoney(last.liquid)}</div>${delta(last.liquid, prev && prev.liquid)}</div>
      <div class="kpi"><div class="label">Non-Liquid</div><div class="value">${fmtMoney(last.nonliquid)}</div>${delta(last.nonliquid, prev && prev.nonliquid)}</div>
      <div class="kpi"><div class="label">Debt</div><div class="value">${fmtMoney(last.debt)}</div>${delta(last.debt, prev && prev.debt, true)}</div>
      <div class="kpi"><div class="label">12-Month Change</div><div class="value ${last.net_worth - yearAgo.net_worth >= 0 ? 'up' : 'down'}">${last.net_worth - yearAgo.net_worth >= 0 ? '+' : ''}${fmtMoney(last.net_worth - yearAgo.net_worth)}</div><div class="delta muted">vs ${fmtDate(yearAgo.date)}</div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Net Worth Over Time ${help("ht-dashboard", "Net worth over time; use the range tabs to zoom and hover for monthly detail")}</h2>
        <div class="range-tabs" id="ranges">
          ${["1Y", "3Y", "5Y", "ALL"].map((r) => `<button data-r="${r}" class="${range === r ? 'active' : ''}">${r}</button>`).join("")}
        </div>
      </div>
      <div id="chart"></div>
    </div>
    <div class="grid2">
      <div class="panel"><h2>Current Holdings ${help("ht-dashboard", "Accounts with a balance, grouped Liquid / Non-Liquid / Debts; click a row to edit, headers to sort")}</h2><div id="holdings"></div></div>
      <div class="dash-col">
        <div class="panel"><h2>Asset Allocation ${help("ht-dashboard", "Assets by class; real estate shown net of its linked mortgage, so the center total is assets minus property loans. Click a legend swatch to recolor a class")}</h2><div id="donut" style="display:flex;justify-content:center"></div><div class="legend" id="legend"></div></div>
        <div class="panel" id="debtPanel"><h2>Debt Overview ${help("ht-dashboard", "All debt: balances with Fixed/Variable bars, each rate, month-over-month change, the balance-weighted average APR, and your cash-to-debt ratio")}</h2><div id="debtBody"></div></div>
      </div>
    </div>
    <div class="panel" id="notesPanel"><h2>Monthly Notes ${help("ht-dashboard", "Every month with a note, newest first; click one to open that month's entry")}</h2><div id="notesLog"></div></div>`;

  const drawChart = () => {
    const months = { "1Y": 13, "3Y": 37, "5Y": 61, "ALL": s.length }[range];
    lineChart(document.getElementById("chart"), s.slice(Math.max(0, s.length - months)));
  };
  drawChart();
  document.getElementById("ranges").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]"); if (!b) return;
    range = b.dataset.r;
    document.querySelectorAll("#ranges button").forEach((x) => x.classList.toggle("active", x === b));
    drawChart();
  });
  window.addEventListener("resize", () => { if (document.getElementById("chart")) drawChart(); }, { once: true });

  const holdAccounts = d.latest.accounts.filter((a) => a.value !== 0);
  // Counted ledgers shown as their own Current-Holdings group under Debts.
  const ledgerItems = (d.ledgers || []).filter((l) => l.value !== 0).map((l) => ({ ...l, isLedger: true }));
  const classLabel = (a) => a.isLedger
    ? (a.side === "liability" ? "Liability" : "Asset")
    : (CLASS_LABELS[a.asset_class] || a.asset_class);
  // Month-over-month delta cell, matching the KPI cards' ▲/▼ notation. A new
  // account (no holding last month) gets a "New" pill instead.
  const deltaSpan = (cur, prev, invert = false) => {
    const diff = cur - prev;
    if (Math.abs(diff) < 0.005) return `<span class="delta flat">—</span>`;
    const up = diff >= 0, good = invert ? !up : up;
    const pct = prev ? ` · ${((diff / Math.abs(prev)) * 100).toFixed(1)}%` : "";
    return `<span class="delta ${good ? "up" : "down"}">${up ? "▲" : "▼"} ${fmtMoney(Math.abs(diff), true)}${pct}</span>`;
  };
  const momCell = (a) => a.prev_value == null
    ? `<span class="tag pill-new">New</span>`
    : deltaSpan(a.value, a.prev_value, a.kind === "debt");
  const renderHoldings = () => {
    const { key, dir } = holdSort;
    const cmp = (a, b) => {
      if (key === "name") return dir * a.name.localeCompare(b.name);
      if (key === "class") return dir * (classLabel(a).localeCompare(classLabel(b)) || (b.value - a.value));
      return dir * (a.value - b.value);
    };
    const arrow = (k) => key === k ? (dir > 0 ? " ▲" : " ▼") : "";
    const groups = { liquid: [], nonliquid: [], debt: [] };
    holdAccounts.forEach((a) => groups[a.kind].push(a));
    let html = `<table><thead><tr>
      <th class="sortable" data-sort="name">Account${arrow("name")}</th>
      <th class="sortable" data-sort="class">Class${arrow("class")}</th>
      <th class="num sortable" data-sort="value">Value${arrow("value")}</th>
      <th class="num">MoM Δ</th>
    </tr></thead><tbody>`;
    for (const k of ["liquid", "nonliquid", "debt"]) {
      const items = groups[k];
      if (!items.length) continue;
      const subtotal = items.reduce((sum, a) => sum + a.value, 0);
      const prevSubtotal = items.reduce((sum, a) => sum + (a.prev_value || 0), 0);
      html += `<tr class="group-row"><td colspan="2">${KIND_LABEL[k]}</td><td class="num">${fmtMoney(subtotal)}</td><td class="num">${deltaSpan(subtotal, prevSubtotal, k === "debt")}</td></tr>`;
      items.slice().sort(cmp).forEach((a) => {
        html += `<tr class="hold-row" data-id="${a.id}"><td>${esc(a.name)}</td><td><span class="tag pill-${a.asset_class}">${classLabel(a)}</span></td><td class="num">${fmtMoney(a.value)}</td><td class="num">${momCell(a)}</td></tr>`;
      });
    }
    if (ledgerItems.length) {
      const subtotal = ledgerItems.reduce((sum, a) => sum + a.value, 0);
      const prevSubtotal = ledgerItems.reduce((sum, a) => sum + (a.prev_value || 0), 0);
      html += `<tr class="group-row"><td colspan="2">Ledgers</td><td class="num">${fmtMoney(subtotal)}</td><td class="num">${deltaSpan(subtotal, prevSubtotal)}</td></tr>`;
      ledgerItems.slice().sort(cmp).forEach((a) => {
        const mom = a.prev_value == null
          ? `<span class="tag pill-new">New</span>`
          : deltaSpan(a.value, a.prev_value, a.side === "liability");
        html += `<tr class="hold-row ledger-row" data-ledger="${a.id}"><td>${esc(a.name)} <span class="tag">Ledger</span></td><td><span class="tag">${classLabel(a)}</span></td><td class="num">${fmtMoney(a.value)}</td><td class="num">${mom}</td></tr>`;
      });
    }
    html += `</tbody></table>`;
    const box = document.getElementById("holdings");
    box.innerHTML = html;
    box.querySelector("thead").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]"); if (!th) return;
      const k = th.dataset.sort;
      if (holdSort.key === k) holdSort.dir *= -1;
      else holdSort = { key: k, dir: k === "value" ? -1 : 1 };
      renderHoldings();
    });
    box.querySelectorAll("tr.hold-row[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => openAccountById(+tr.dataset.id, { onSaved: viewDashboard }));
    });
    box.querySelectorAll("tr.hold-row[data-ledger]").forEach((tr) => {
      tr.addEventListener("click", () => setView("ledgers"));
    });
  };
  renderHoldings();

  const total = d.allocation.reduce((sum, a) => sum + a.total, 0);
  const byId = Object.fromEntries(d.latest.accounts.map((a) => [a.id, a]));
  const linkedLoans = d.latest.accounts.reduce(
    (t, a) => t + (a.linked_account_id && byId[a.linked_account_id] ? Math.abs(byId[a.linked_account_id].value) : 0), 0);
  const grossAssets = last.liquid + last.nonliquid;
  const hasLoans = linkedLoans > 0.005;
  const centerLabel = hasLoans ? "net of property loans" : "assets";
  const unlinkedDebt = Math.max(0, last.debt - linkedLoans);
  const centerTip = hasLoans
    ? `Real estate is shown net of its linked mortgage(s). Gross assets are ${fmtMoney(grossAssets)}; subtracting ${fmtMoney(linkedLoans)} of linked property loans leaves ${fmtMoney(total)} shown here. Note this isn't net worth (${fmtMoney(last.net_worth)}) — other unlinked debt of ${fmtMoney(unlinkedDebt)} is not subtracted from this view.`
    : `Total assets across all classes: ${fmtMoney(total)}.`;
  const drawDonut = () => donut(document.getElementById("donut"), d.allocation, { centerLabel, centerTip });
  drawDonut();

  // Legend doubles as a color picker: each swatch is a native <input type=color>.
  // Edits persist (localStorage) and apply to the Trends charts too.
  const legendEl = document.getElementById("legend");
  const renderLegend = () => {
    legendEl.innerHTML = d.allocation.map((a) => {
      const cls = a.asset_class, lbl = CLASS_LABELS[cls] || cls;
      return `<div class="item"><input type="color" class="swatch swatch-input" data-class="${cls}" value="${DONUT_COLORS[cls] || "#888888"}" title="Recolor ${esc(lbl)}" aria-label="Color for ${esc(lbl)}">${lbl} · <span class="sensitive">${fmtMoney(a.total, true)} (${((a.total / total) * 100).toFixed(0)}%)</span></div>`;
    }).join("") + `<button type="button" class="legend-reset" id="resetColors" title="Restore the default class colors">Reset colors</button>`;
    legendEl.querySelectorAll(".swatch-input").forEach((inp) =>
      inp.addEventListener("input", () => { setClassColor(inp.dataset.class, inp.value); drawDonut(); }));
    legendEl.querySelector("#resetColors").addEventListener("click", () => { resetClassColors(); drawDonut(); renderLegend(); });
  };
  renderLegend();

  renderDebt(document.getElementById("debtBody"), d.latest.accounts, d.ledgers || []);

  // Monthly notes log: every snapshot that carries a note, newest first; click
  // to jump straight to that month in Monthly Entry. Each entry shows the
  // month-over-month net-worth change (amount + %).
  const noted = s.map((p, i) => ({ p, prevNw: i > 0 ? s[i - 1].net_worth : null }))
    .filter((e) => e.p.note).reverse();
  const notesBox = document.getElementById("notesLog");
  if (!noted.length) {
    notesBox.innerHTML = `<p class="sub" style="margin:0">No notes yet — add one in Monthly Entry to record why a month moved.</p>`;
  } else {
    notesBox.innerHTML = `<ul class="notes-log">${noted.map(({ p, prevNw }) =>
      `<li class="note-entry" data-id="${p.id}"><div class="ne-head"><span class="ne-date">${fmtDate(p.date)}</span><span class="ne-vals"><span class="ne-nw sensitive">${fmtMoney(p.net_worth)}</span>${prevNw == null ? "" : ` ${deltaSpan(p.net_worth, prevNw)}`}</span></div><div class="ne-text">${esc(p.note)}</div></li>`).join("")}</ul>`;
    notesBox.querySelectorAll(".note-entry").forEach((li) =>
      li.addEventListener("click", () => { selectMonth(+li.dataset.id); setView("snapshots"); }));
  }
}
