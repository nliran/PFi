// Ledgers view: personal loans, cost-of-goods tracking, manufactured-spend float.
import { api } from "../api.js";
import { fmtMoney, esc, help } from "../format.js";

const main = document.getElementById("main");
let selectedLedger = null;
// Sort over the ENTRY list. Each row keeps its chronological running balance
// (computed server-side in entry order); sorting only reorders the rows shown.
let entrySort = { key: "date", dir: 1 };

export async function viewLedgers() {
  main.innerHTML = `<h1>Ledgers</h1><p class="sub">Loading…</p>`;
  const ledgers = await api.get("/ledgers");
  if (!selectedLedger && ledgers.length) selectedLedger = ledgers[0].id;
  main.innerHTML = `
    <h1>Ledgers ${help("ht-ledgers", "Standalone sub-ledgers (loans, COGS, float). Toggle 'Count in net worth' to fold a ledger's balance into net worth")}</h1>
    <p class="sub">Detailed sub-ledgers: personal loans, cost-of-goods tracking, and manufactured-spend float.</p>
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:18px" id="ledTabs">
      ${ledgers.map((l) => `<button class="btn ${l.id === selectedLedger ? '' : 'ghost'} sm" data-id="${l.id}">${esc(l.name)} · <span class="sensitive">${fmtMoney(l.balance, true)}</span></button>`).join("")}
    </div>
    <div id="ledDetail"></div>`;
  document.getElementById("ledTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]"); if (!b) return;
    selectedLedger = +b.dataset.id; viewLedgers();
  });
  if (selectedLedger) renderLedger(selectedLedger);
}

async function renderLedger(id) {
  const l = await api.get("/ledgers/" + id);
  const box = document.getElementById("ledDetail");

  const sortVal = {
    date: (e) => e.entry_date || "",
    label: (e) => (e.label || "").toLowerCase(),
    note: (e) => (e.note || "").toLowerCase(),
    amount: (e) => e.amount,
    balance: (e) => e.balance,
  };
  const sorted = [...l.entries].sort((a, b) => {
    const va = sortVal[entrySort.key](a), vb = sortVal[entrySort.key](b);
    if (va < vb) return -1 * entrySort.dir;
    if (va > vb) return 1 * entrySort.dir;
    return (a.id - b.id) * entrySort.dir;
  });
  const arrow = (k) => entrySort.key === k ? (entrySort.dir === 1 ? " ▲" : " ▼") : "";
  const th = (k, label, cls = "") =>
    `<th class="sortable ${cls}" data-sort="${k}">${label}${arrow(k)}</th>`;

  const rows = sorted.map((e) => `
    <tr data-id="${e.id}">
      <td>${e.entry_date ? esc(e.entry_date) : '<span class="muted">—</span>'}</td>
      <td>${esc(e.label)}</td>
      <td>${esc(e.note || "")}</td>
      <td class="num ${e.amount < 0 ? 'down' : ''}">${fmtMoney(e.amount)}</td>
      <td class="num">${fmtMoney(e.balance)}</td>
      <td class="right"><button class="icon" data-del="${e.id}">✕</button></td>
    </tr>`).join("");

  const side = l.side || "";
  box.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>${esc(l.name)} <span class="tag">${l.kind}</span></h2>
        <div class="value" style="font-size:20px">Balance: ${fmtMoney(l.balance)}</div>
      </div>
      <div class="row" style="gap:16px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <label class="row" style="gap:6px;align-items:center">
          <span class="muted">Side</span>
          <select id="ledSide">
            <option value=""${side === "" ? " selected" : ""}>—</option>
            <option value="asset"${side === "asset" ? " selected" : ""}>Asset</option>
            <option value="liability"${side === "liability" ? " selected" : ""}>Liability</option>
          </select>
        </label>
        <label class="row" style="gap:6px;align-items:center">
          <input id="ledCount" type="checkbox"${l.count_in_net_worth ? " checked" : ""}>
          <span>Count in net worth</span>
          ${help("ht-ledgers", "Folds this ledger's as-of-date balance into net worth: liability adds to Debt, asset adds to Non-Liquid")}
        </label>
      </div>
      <table>
        <thead><tr>
          ${th("date", "Date")}${th("label", "Label")}${th("note", "Note")}
          ${th("amount", "Amount", "num")}${th("balance", "Balance", "num")}<th></th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">No entries</td></tr>'}</tbody>
        <tfoot><tr>
          <td><input id="ne_date" type="date" style="width:140px"></td>
          <td><input id="ne_label" placeholder="label" style="width:140px"></td>
          <td><input id="ne_note" placeholder="note" style="width:120px"></td>
          <td class="num"><input id="ne_amt" class="num" type="number" step="0.01" placeholder="0.00" style="width:110px"></td>
          <td></td>
          <td class="right"><button class="btn sm" id="addEntry">Add</button></td>
        </tr></tfoot>
      </table>
    </div>`;

  box.querySelector("thead").addEventListener("click", (e) => {
    const h = e.target.closest("th[data-sort]"); if (!h) return;
    const k = h.dataset.sort;
    if (entrySort.key === k) entrySort.dir *= -1;
    else entrySort = { key: k, dir: k === "amount" || k === "balance" ? -1 : 1 };
    renderLedger(id);
  });

  const persistLedger = async () => {
    await api.put("/ledgers/" + id, {
      side: box.querySelector("#ledSide").value || null,
      count_in_net_worth: box.querySelector("#ledCount").checked,
    });
  };
  box.querySelector("#ledSide").addEventListener("change", persistLedger);
  box.querySelector("#ledCount").addEventListener("change", persistLedger);

  box.querySelector("#addEntry").addEventListener("click", async () => {
    const date = box.querySelector("#ne_date").value;
    if (!date) { alert("Entry date is required"); return; }
    const amt = parseFloat(box.querySelector("#ne_amt").value);
    if (isNaN(amt)) { alert("Enter an amount"); return; }
    await api.post(`/ledgers/${id}/entries`, {
      entry_date: date,
      label: box.querySelector("#ne_label").value,
      note: box.querySelector("#ne_note").value,
      amount: amt, sort_order: 99999,
    });
    renderLedger(id);
  });
  box.addEventListener("click", async (e) => {
    const del = e.target.closest("button[data-del]"); if (!del) return;
    await api.del("/entries/" + del.dataset.del); renderLedger(id);
  });
}
