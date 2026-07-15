// Monthly Entry view: pick a month, edit per-account values, save.
import { api } from "../api.js";
import { fmtMoney, fmtDate, esc, KIND_LABEL, CLASS_LABELS, help } from "../format.js";

const main = document.getElementById("main");
let selectedSnap = null;

// Let other views (e.g. the Dashboard notes log) preselect a month before
// switching to this view.
export function selectMonth(snapId) {
  selectedSnap = snapId;
}

// Per-month "reviewed" checklist (UI aid only, persisted in localStorage so a
// reload or save mid-entry doesn't lose which rows you've already confirmed).
const reviewKey = (snapId) => `pfi-reviewed-${snapId}`;
function loadReviewed(snapId) {
  try { return new Set(JSON.parse(localStorage.getItem(reviewKey(snapId)) || "[]")); }
  catch { return new Set(); }
}
function saveReviewed(snapId, set) {
  localStorage.setItem(reviewKey(snapId), JSON.stringify([...set]));
}

export async function viewSnapshots() {
  main.innerHTML = `<h1>Monthly Entry</h1><p class="sub">Loading…</p>`;
  const snaps = await api.get("/snapshots");
  if (!selectedSnap && snaps.length) selectedSnap = snaps[snaps.length - 1].id;
  main.innerHTML = `
    <h1>Monthly Entry ${help("ht-monthly", "Record each month's balances; net worth recalculates from what you enter")}</h1>
    <p class="sub">Pick a month to view or edit account values. Net worth recalculates from what you enter.</p>
    <div class="panel">
      <div class="panel-head"><h2>Months (${snaps.length})</h2>
        <div class="row"><button class="btn" id="newMonth">+ New month</button></div>
      </div>
      <div class="snap-list" id="snapList">
        ${snaps.slice().reverse().map((s) => `
          <div class="snap-item ${s.id === selectedSnap ? 'active' : ''}${s.note ? ' has-note' : ''}" data-id="${s.id}"${s.note ? ` title="${esc(s.note)}"` : ''}>
            <div class="d">${fmtDate(s.date)}${s.note ? ' <span class="note-mark" aria-label="Has a note">✎</span>' : ''}</div>
            <div class="nw">${fmtMoney(s.net_worth)}</div>
          </div>`).join("")}
      </div>
    </div>
    <div id="editor"></div>`;

  document.getElementById("snapList").addEventListener("click", (e) => {
    const it = e.target.closest(".snap-item"); if (!it) return;
    selectedSnap = +it.dataset.id; viewSnapshots();
  });
  document.getElementById("newMonth").addEventListener("click", async () => {
    const today = new Date();
    const def = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const date = prompt("New month (YYYY-MM-01):", def);
    if (!date) return;
    const res = await api.post("/snapshots", { date, seed_from_latest: true });
    if (res.error) { alert(res.error); return; }
    selectedSnap = res.id; viewSnapshots();
  });

  if (selectedSnap) renderSnapEditor(selectedSnap);
}

async function renderSnapEditor(snapId) {
  const det = await api.get("/snapshots/" + snapId);
  const box = document.getElementById("editor");
  const reviewed = loadReviewed(snapId);
  const dot = (key) => `<button type="button" class="upd-dot${reviewed.has(key) ? " done" : ""}" data-key="${key}" title="Mark reviewed"></button>`;
  const groups = { liquid: [], nonliquid: [], debt: [] };
  det.accounts.forEach((a) => groups[a.kind].push(a));
  let rows = "";
  for (const k of ["liquid", "nonliquid", "debt"]) {
    rows += `<tr class="group-row"><td colspan="2">${KIND_LABEL[k]}</td></tr>`;
    groups[k].forEach((a) => {
      const subs = a.subaccounts || [];
      if (subs.length) {
        const joint = (a.owner_pct ?? 1) < 1;       // joint account -> show share slider
        const pct = Math.round((a.owner_pct ?? 1) * 100);
        const lbl = joint ? `${subs.length} components · my share` : `${subs.length} components`;
        // Parent value is the (owned share of the) sum of its components.
        rows += `<tr class="parent-row"><td>${esc(a.name)} <span class="tag pill-${a.asset_class}">${CLASS_LABELS[a.asset_class] || a.asset_class}</span>
            <span class="sub" style="margin-left:6px">${lbl}</span></td>
          <td class="num"><span class="parent-sum" data-parent="${a.id}" style="font-variant-numeric:tabular-nums;font-weight:600"></span></td></tr>`;
        if (joint) {
          rows += `<tr class="share-row"><td colspan="2"><div class="share-ctl">
              <span>Full total <b class="full-total" data-parent="${a.id}"></b></span>
              <input type="range" class="share-slider" data-parent="${a.id}" min="0" max="100" step="1" value="${pct}">
              <span class="share-pct" data-parent="${a.id}">${pct}%</span>
              <span class="sub">is mine</span>
            </div></td></tr>`;
        }
        subs.forEach((s) => {
          rows += `<tr class="sub-row"><td style="padding-left:28px">↳ ${esc(s.name)}</td>
            <td class="num"><div class="val-cell">${dot("s" + s.id)}<input class="num" style="width:140px" type="number" step="0.01" data-sub="${s.id}" data-parent="${a.id}" data-key="s${s.id}" value="${s.value}"></div></td></tr>`;
        });
      } else {
        rows += `<tr><td>${esc(a.name)} <span class="tag pill-${a.asset_class}">${CLASS_LABELS[a.asset_class] || a.asset_class}</span></td>
          <td class="num"><div class="val-cell">${dot("a" + a.id)}<input class="num" style="width:140px" type="number" step="0.01" data-acct="${a.id}" data-key="a${a.id}" value="${a.value}"></div></td></tr>`;
      }
    });
  }
  box.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>${fmtDate(det.date)}</h2>
        <div class="row">
          ${help("ht-monthly", "The dot by each value marks it reviewed — auto-set when you edit, or click to confirm an unchanged row")}
          <span class="rev-count" id="revCount"></span>
          <button class="btn ghost sm" id="clearRev">Clear checks</button>
          <button class="btn ghost sm" id="delSnap">Delete month</button>
          <button class="btn" id="saveSnap">Save</button>
        </div>
      </div>
      <div class="snap-note">
        <label for="snapNote">Notes <span class="muted">— record why any drastic changes happened this month</span></label>
        <textarea id="snapNote" rows="2" placeholder="e.g. Sold the rental property; year-end bonus deposited; market pulled back…">${esc(det.note || "")}</textarea>
      </div>
      <table><tbody>${rows}</tbody></table>
    </div>`;

  // Keep each parent's displayed sum in sync as components / share change.
  // Components store FULL values; the parent line = full total × my share.
  const recalcParent = (pid) => {
    const full = [...box.querySelectorAll(`input[data-sub][data-parent="${pid}"]`)]
      .reduce((t, i) => t + (parseFloat(i.value) || 0), 0);
    const slider = box.querySelector(`.share-slider[data-parent="${pid}"]`);
    const pct = slider ? (parseFloat(slider.value) || 0) / 100 : 1;
    const sum = box.querySelector(`.parent-sum[data-parent="${pid}"]`);
    if (sum) sum.textContent = fmtMoney(full * pct);
    const ft = box.querySelector(`.full-total[data-parent="${pid}"]`);
    if (ft) ft.textContent = fmtMoney(full);
    const pl = box.querySelector(`.share-pct[data-parent="${pid}"]`);
    if (pl && slider) pl.textContent = `${Math.round(parseFloat(slider.value) || 0)}%`;
  };
  box.querySelectorAll(".parent-sum[data-parent]").forEach((el) => recalcParent(el.dataset.parent));
  box.querySelectorAll("input[data-sub]").forEach((i) =>
    i.addEventListener("input", () => recalcParent(i.dataset.parent)));
  box.querySelectorAll(".share-slider").forEach((s) =>
    s.addEventListener("input", () => recalcParent(s.dataset.parent)));

  // Review checklist: a green check per row, auto-set when you edit a value,
  // or click the dot to confirm a row whose number didn't change this month.
  const updateCounter = () => {
    const total = box.querySelectorAll(".upd-dot").length;
    const done = box.querySelectorAll(".upd-dot.done").length;
    const el = box.querySelector("#revCount");
    if (el) el.textContent = `${done} / ${total} reviewed`;
  };
  const setDone = (key, on) => {
    const d = box.querySelector(`.upd-dot[data-key="${key}"]`);
    if (!d) return;
    d.classList.toggle("done", on);
    if (on) reviewed.add(key); else reviewed.delete(key);
    saveReviewed(snapId, reviewed);
    updateCounter();
  };
  box.querySelectorAll("input[data-key]").forEach((i) =>
    i.addEventListener("input", () => setDone(i.dataset.key, true)));
  box.querySelectorAll(".upd-dot").forEach((d) =>
    d.addEventListener("click", () => setDone(d.dataset.key, !d.classList.contains("done"))));
  box.querySelector("#clearRev").addEventListener("click", () => {
    reviewed.clear(); saveReviewed(snapId, reviewed);
    box.querySelectorAll(".upd-dot.done").forEach((d) => d.classList.remove("done"));
    updateCounter();
  });
  updateCounter();

  box.querySelector("#saveSnap").addEventListener("click", async () => {
    const holdings = [...box.querySelectorAll("input[data-acct]")].map((i) => ({ account_id: +i.dataset.acct, value: parseFloat(i.value) || 0 }));
    const subholdings = [...box.querySelectorAll("input[data-sub]")].map((i) => ({ subaccount_id: +i.dataset.sub, value: parseFloat(i.value) || 0 }));
    const shares = [...box.querySelectorAll(".share-slider")].map((s) => ({ account_id: +s.dataset.parent, owner_pct: (parseFloat(s.value) || 0) / 100 }));
    const note = box.querySelector("#snapNote").value;
    await api.put("/snapshots/" + snapId, { holdings, subholdings, shares, note });
    viewSnapshots();
  });
  box.querySelector("#delSnap").addEventListener("click", async () => {
    if (!confirm("Delete this month entirely?")) return;
    await api.del("/snapshots/" + snapId);
    selectedSnap = null; viewSnapshots();
  });
}
