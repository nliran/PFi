// Accounts view: card list, detail/edit modal with full history, close/reopen.
import { api } from "../api.js";
import { lineChart } from "../charts.js";
import { fmtMoney, fmtDate, esc, KIND_LABEL, CLASS_LABELS, ASSET_CLASSES, SUBTYPES, help } from "../format.js";

const main = document.getElementById("main");
let accountsCache = [];
let showClosed = false;

export async function viewAccounts() {
  main.innerHTML = `<h1>Accounts</h1><p class="sub">Loading…</p>`;
  const accts = await api.get("/accounts");
  accountsCache = accts;
  const isClosed = (a) => a.status === "closed" || a.archived;
  const active = accts.filter((a) => !isClosed(a));
  const closed = accts.filter(isClosed);

  const meta = (a) => {
    const bits = [];
    if (a.institution) bits.push(esc(a.institution));
    if (a.subtype) bits.push(esc(a.subtype));
    if (a.kind === "debt" && a.apr != null) bits.push(`${(a.apr * 100).toFixed(2)}% APR`);
    if (a.linked_account_id) {
      const m = accts.find((x) => x.id === a.linked_account_id);
      if (m) bits.push(`↔ ${esc(m.name)}`);
    }
    return bits.length ? `<span class="acct-meta">${bits.join(" · ")}</span>` : "";
  };
  const card = (a) => `
    <div class="acct-card" data-id="${a.id}">
      <div class="acct-main">
        <div class="acct-name">${esc(a.name)}</div>
        ${meta(a)}
      </div>
      <span class="tag pill-${a.asset_class}">${CLASS_LABELS[a.asset_class] || a.asset_class}</span>
    </div>`;

  let groups = "";
  for (const k of ["liquid", "nonliquid", "debt"]) {
    const items = active.filter((a) => a.kind === k);
    if (!items.length) continue;
    groups += `<div class="acct-group"><div class="acct-group-head">${KIND_LABEL[k]} <span class="muted">(${items.length})</span></div>${items.map(card).join("")}</div>`;
  }

  main.innerHTML = `
    <h1>Accounts ${help("ht-accounts", "Your master list of accounts; define them here, enter values monthly. Close — never rename — old accounts")}</h1>
    <p class="sub">Click any account to see its full history, rename it, or edit details. Closing keeps history intact — never relabel an old account.</p>
    <div class="panel">
      <div class="panel-head"><h2>${active.length} active accounts</h2><button class="btn" id="addAcct">+ Add account</button></div>
      <div id="acctList">${groups || '<p class="empty">No active accounts.</p>'}</div>
    </div>
    ${closed.length ? `
    <div class="panel">
      <div class="panel-head"><h2>Closed accounts (${closed.length})</h2>
        <button class="btn ghost sm" id="toggleClosed">${showClosed ? "Hide" : "Show"}</button></div>
      <div id="closedList" style="display:${showClosed ? "block" : "none"}">
        ${closed.map(card).join("")}
      </div>
    </div>` : ""}
    <div id="acctModal"></div>`;

  document.getElementById("addAcct").addEventListener("click", () => openAccountModal(null));
  const tc = document.getElementById("toggleClosed");
  if (tc) tc.addEventListener("click", () => { showClosed = !showClosed; viewAccounts(); });
  const onCardClick = (e) => {
    const c = e.target.closest(".acct-card"); if (!c) return;
    openAccountModal(accountsCache.find((a) => a.id === +c.dataset.id));
  };
  document.getElementById("acctList").addEventListener("click", onCardClick);
  const cl = document.getElementById("closedList");
  if (cl) cl.addEventListener("click", onCardClick);
}

// Open the account modal from anywhere (e.g. the dashboard holdings table).
// Ensures the accounts cache is loaded, then shows the edit/history modal.
export async function openAccountById(id, opts = {}) {
  if (!accountsCache.length) accountsCache = await api.get("/accounts");
  const acct = accountsCache.find((a) => a.id === +id);
  if (acct) openAccountModal(acct, opts);
}

function openAccountModal(acct, opts = {}) {
  const isNew = !acct;
  acct = acct || { kind: "liquid", asset_class: "cash", status: "active" };
  // Refresh whatever view we were called from after a save/close.
  const refresh = opts.onSaved || viewAccounts;
  // The host element lives in the Accounts view; create one on the fly otherwise.
  let box = document.getElementById("acctModal");
  if (!box) {
    box = document.createElement("div");
    box.id = "acctModal";
    document.body.appendChild(box);
  }
  const debts = accountsCache.filter((a) => a.kind === "debt" && a.id !== acct.id);
  const opt = (sel, list, labels) => list.map((v) => `<option value="${v}" ${v === sel ? "selected" : ""}>${labels ? labels[v] || v : v}</option>`).join("");

  box.innerHTML = `
    <div class="modal-overlay" id="ov">
      <div class="modal">
        <div class="modal-head">
          <h2>${isNew ? "Add account" : "Edit account"} ${help("ht-accounts", "Set name, group, class and details; APR shows for debts, linked mortgage for real estate. Components hold full values and the share sets what counts")}</h2>
          <button class="icon" id="mClose" title="Close">✕</button>
        </div>
        <div class="modal-body">
          <label class="fld span2"><span>Name</span>
            <input id="f_name" class="big" value="${esc(acct.name || "")}" placeholder="e.g. Checking"></label>
          <label class="fld"><span>Group</span>
            <select id="f_kind">${opt(acct.kind, ["liquid", "nonliquid", "debt"], KIND_LABEL)}</select></label>
          <label class="fld"><span>Asset class</span>
            <select id="f_class">${opt(acct.asset_class, ASSET_CLASSES, CLASS_LABELS)}</select></label>
          <label class="fld"><span>Institution</span>
            <input id="f_inst" value="${esc(acct.institution || "")}" placeholder="Bank / custodian / lender"></label>
          <label class="fld"><span>Subtype</span>
            <input id="f_subtype" list="subtypeList" value="${esc(acct.subtype || "")}" placeholder="e.g. Roth IRA">
            <datalist id="subtypeList"></datalist></label>
          <label class="fld" id="wrap_apr"><span>APR (decimal, e.g. 0.0275)</span>
            <input id="f_apr" type="number" step="0.0001" value="${acct.apr == null ? "" : acct.apr}" placeholder="—"></label>
          <label class="fld" id="wrap_rate"><span>Rate type</span>
            <select id="f_rate">
              <option value="" ${!acct.rate_type ? "selected" : ""}>— unset —</option>
              <option value="fixed" ${acct.rate_type === "fixed" ? "selected" : ""}>Fixed</option>
              <option value="variable" ${acct.rate_type === "variable" ? "selected" : ""}>Variable</option>
            </select></label>
          <label class="fld span2" id="wrap_link"><span>Linked mortgage (for net equity)</span>
            <select id="f_link"><option value="">— none —</option>${debts.map((d) => `<option value="${d.id}" ${d.id === acct.linked_account_id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
          <label class="fld span2"><span>Notes</span>
            <textarea id="f_notes" rows="2" placeholder="Optional">${esc(acct.notes || "")}</textarea></label>
        </div>
        <div id="compWrap"></div>
        <div id="histWrap"></div>
        <div class="modal-foot">
          <div class="left">${!isNew ? `<button class="btn ghost sm" id="mToggle">${acct.status === "closed" || acct.archived ? "Reopen account" : "Close account"}</button>` : ""}</div>
          <div class="right"><button class="btn ghost" id="mCancel">Cancel</button><button class="btn" id="mSave">${isNew ? "Create" : "Save"}</button></div>
        </div>
      </div>
    </div>`;

  const $ = (id) => box.querySelector("#" + id);
  const syncConditional = () => {
    const kind = $("f_kind").value, cls = $("f_class").value;
    $("wrap_apr").style.display = kind === "debt" ? "" : "none";
    $("wrap_rate").style.display = kind === "debt" ? "" : "none";
    $("wrap_link").style.display = (kind !== "debt" && cls === "real_estate") ? "" : "none";
    $("subtypeList").innerHTML = (SUBTYPES[cls] || []).map((s) => `<option value="${esc(s)}">`).join("");
  };
  $("f_kind").addEventListener("change", syncConditional);
  $("f_class").addEventListener("change", syncConditional);
  syncConditional();

  const close = () => { box.innerHTML = ""; };
  $("mClose").addEventListener("click", close);
  $("mCancel").addEventListener("click", close);
  $("ov").addEventListener("click", (e) => { if (e.target.id === "ov") close(); });

  $("mSave").addEventListener("click", async () => {
    const apr = $("f_apr").value;
    const link = $("f_link").value;
    const payload = {
      name: $("f_name").value.trim() || "Untitled account",
      kind: $("f_kind").value, asset_class: $("f_class").value,
      institution: $("f_inst").value.trim() || null,
      subtype: $("f_subtype").value.trim() || null,
      notes: $("f_notes").value.trim() || null,
      apr: $("f_kind").value === "debt" && apr !== "" ? parseFloat(apr) : null,
      rate_type: $("f_kind").value === "debt" ? ($("f_rate").value || null) : null,
      linked_account_id: ($("f_kind").value !== "debt" && $("f_class").value === "real_estate" && link) ? +link : null,
    };
    if (isNew) await api.post("/accounts", payload);
    else await api.put("/accounts/" + acct.id, payload);
    accountsCache = []; close(); refresh();
  });

  const tog = $("mToggle");
  if (tog) tog.addEventListener("click", async () => {
    const closing = !(acct.status === "closed" || acct.archived);
    if (closing && !confirm("Close this account? Its history stays intact, but it won't appear in new monthly entries.")) return;
    const today = new Date().toISOString().slice(0, 10);
    await api.put("/accounts/" + acct.id, closing
      ? { status: "closed", archived: 1, closed_date: today }
      : { status: "active", archived: 0, closed_date: null });
    accountsCache = []; close(); refresh();
  });

  if (!isNew) { renderComponents(acct); renderAccountHistory(acct.id); }
}

// Manage an account's components (subaccounts) + ownership share, in the modal.
async function renderComponents(acct) {
  const wrap = document.getElementById("compWrap");
  if (!wrap) return;
  const all = await api.get("/accounts/" + acct.id + "/subaccounts");
  const subs = all.filter((s) => s.status === "active");
  const ownPct = acct.owner_pct == null ? 1 : acct.owner_pct;
  const pct = Math.round(ownPct * 100);
  const full = subs.reduce((t, s) => t + (s.value || 0), 0);
  const mine = full * ownPct;
  wrap.innerHTML = `
    <div class="comp">
      <div class="comp-head"><h3>Components</h3>
        <span class="muted">${subs.length
          ? `${subs.length} components · latest full total <span class="sensitive">${fmtMoney(full)}</span>`
          : "Split this account into tracked components (e.g. the cards behind a cash line)"}</span>
      </div>
      ${subs.length ? `
      <div class="comp-list">
        ${subs.map((s) => `<div class="comp-row">
            <input class="comp-name" data-sub="${s.id}" value="${esc(s.name)}">
            <span class="comp-val">${fmtMoney(s.value || 0)}</span>
            <button class="icon comp-del" data-sub="${s.id}" title="Remove component">✕</button>
          </div>`).join("")}
      </div>
      <div class="comp-share">
        <span>My share</span>
        <input type="range" id="compShare" min="0" max="100" step="1" value="${pct}">
        <span id="compSharePct">${pct}%</span>
        <span class="muted">→ <span class="sensitive">${fmtMoney(mine)}</span> of <span class="sensitive">${fmtMoney(full)}</span> counts toward net worth</span>
      </div>` : ""}
      <div class="comp-add">
        <input id="compNew" placeholder="New component name">
        <button class="btn ghost sm" id="compAdd">+ Add component</button>
      </div>
    </div>`;

  wrap.querySelector("#compAdd").addEventListener("click", async () => {
    const name = wrap.querySelector("#compNew").value.trim();
    if (!name) return;
    await api.post("/accounts/" + acct.id + "/subaccounts", { name, sort_order: subs.length + 1 });
    accountsCache = [];
    renderComponents(acct);
  });
  wrap.querySelector("#compNew").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); wrap.querySelector("#compAdd").click(); }
  });
  wrap.querySelectorAll(".comp-name").forEach((inp) =>
    inp.addEventListener("change", () =>
      api.put("/subaccounts/" + inp.dataset.sub, { name: inp.value.trim() || "Component" })));
  wrap.querySelectorAll(".comp-del").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this component? Its history is kept but it stops counting.")) return;
      await api.del("/subaccounts/" + btn.dataset.sub);
      accountsCache = [];
      renderComponents(acct);
    }));
  const sh = wrap.querySelector("#compShare");
  if (sh) {
    sh.addEventListener("input", () => {
      wrap.querySelector("#compSharePct").textContent = Math.round(sh.value) + "%";
    });
    sh.addEventListener("change", async () => {
      const v = (parseFloat(sh.value) || 0) / 100;
      await api.put("/accounts/" + acct.id, { owner_pct: v });
      acct.owner_pct = v;
      accountsCache = [];
      renderComponents(acct);
    });
  }
}

async function renderAccountHistory(id) {
  const wrap = document.getElementById("histWrap");
  if (!wrap) return;
  const data = await api.get("/accounts/" + id + "/history");
  const hist = data.history || [];
  const nonzero = hist.filter((h) => h.value !== 0);
  const series = hist.map((h) => ({ date: h.date, net_worth: h.value }));
  const first = nonzero[0], last = nonzero[nonzero.length - 1];
  wrap.innerHTML = `
    <div class="hist">
      <div class="hist-head">
        <h3>History</h3>
        <span class="muted">${nonzero.length} months with a balance${first ? ` · ${fmtDate(first.date)} → ${fmtDate(last.date)}` : ""}</span>
      </div>
      <div id="histChart"></div>
      <div class="hist-table"><table><thead><tr><th>Month</th><th class="num">Value</th></tr></thead>
        <tbody>${hist.slice().reverse().map((h) => `<tr class="${h.value === 0 ? "muted" : ""}"><td>${fmtDate(h.date)}</td><td class="num">${fmtMoney(h.value)}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>`;
  lineChart(document.getElementById("histChart"), series, { height: 180 });
}
