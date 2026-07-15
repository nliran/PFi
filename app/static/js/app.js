// PFi frontend entry point. Wires navigation, theming, the version footer, and
// the About panel, then renders the selected view. ES modules keep each concern
// in its own scope (no shared globals).
import { api } from "./api.js";
import { esc } from "./format.js";
import { UI_VERSION } from "./version.js";
import { initTheme, toggleTheme, getTheme, onThemeChange } from "./theme.js";
import { initPrivacy, togglePrivacy, getPrivacy } from "./privacy.js";
import { viewDashboard } from "./views/dashboard.js";
import { viewTrends } from "./views/trends.js";
import { viewSnapshots } from "./views/snapshots.js";
import { viewAccounts } from "./views/accounts.js";
import { viewLedgers } from "./views/ledgers.js";
import { viewHowto } from "./views/howto.js";

const VIEWS = {
  dashboard: viewDashboard,
  trends: viewTrends,
  snapshots: viewSnapshots,
  accounts: viewAccounts,
  ledgers: viewLedgers,
  howto: viewHowto,
};

let currentView = "dashboard";

function render() {
  (VIEWS[currentView] || viewDashboard)();
}

// Programmatic navigation (e.g. a Dashboard notes-log row jumping to the month
// in Monthly Entry). Updates the active nav button and renders.
export function setView(name) {
  if (!VIEWS[name]) return;
  currentView = name;
  document.querySelectorAll(".nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === name));
  render();
}

// ---- navigation
const nav = document.getElementById("nav");
const navToggle = document.getElementById("navToggle");
nav.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  currentView = b.dataset.view;
  document.querySelectorAll(".nav button").forEach((x) => x.classList.toggle("active", x === b));
  // collapse the mobile menu after a selection
  nav.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
  render();
});

// ---- hamburger menu (mobile)
navToggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", open ? "true" : "false");
});

// ---- contextual help: any "?" icon (data-help="ht-section") deep-links to the
// matching How-To guide section. Delegated so it works for every view.
async function openHelp(section) {
  // Dismiss any open modal/overlay so the guide isn't hidden behind it.
  document.querySelectorAll(".modal-overlay").forEach((o) => o.remove());
  currentView = "howto";
  document.querySelectorAll(".nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === "howto"));
  await render();
  const target = document.getElementById(section);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}
// Body-level so it also catches help icons inside modals (which can be appended
// to <body> when opened from the Dashboard).
document.body.addEventListener("click", (e) => {
  const h = e.target.closest("[data-help]");
  if (!h) return;
  e.preventDefault();
  e.stopPropagation();
  openHelp(h.dataset.help);
});

// ---- theme (sun/moon toggle at the top of the sidebar)
initTheme();
const themeToggle = document.getElementById("themeToggle");
function syncThemeToggle() {
  themeToggle.setAttribute("aria-checked", getTheme() === "dark" ? "true" : "false");
}
syncThemeToggle();
themeToggle.addEventListener("click", () => { toggleTheme(); syncThemeToggle(); });
// Redraw the current view when the theme flips so charts pick up new colors.
onThemeChange(() => render());

// ---- privacy (eye toggle: blur all values for safe screenshots)
initPrivacy();
const privacyToggle = document.getElementById("privacyToggle");
function syncPrivacyToggle() {
  const on = getPrivacy();
  privacyToggle.setAttribute("aria-checked", on ? "true" : "false");
  privacyToggle.title = on ? "Show values" : "Hide values for screenshots";
  privacyToggle.setAttribute("aria-label", privacyToggle.title);
}
syncPrivacyToggle();
// HTML values react via CSS (data-privacy on <html>), but SVG <text> can't be
// blurred by CSS in WebKit/Safari, so re-render to redraw charts with masked
// axis/donut numbers.
privacyToggle.addEventListener("click", () => { togglePrivacy(); syncPrivacyToggle(); render(); });

// ---- About button (lives in the top bar, defined in index.html)
document.getElementById("aboutBtn").addEventListener("click", openAbout);

// ---- Quit button: stop the local server, then show a "stopped" screen.
document.getElementById("quitBtn").addEventListener("click", quitPFi);

function quitPFi() {
  let host = document.getElementById("quitModal");
  if (!host) {
    host = document.createElement("div");
    host.id = "quitModal";
    document.body.appendChild(host);
  }
  host.innerHTML = `
    <div class="modal-overlay" id="quitOv">
      <div class="modal" style="max-width:400px">
        <div class="modal-head"><h2>Quit PFi?</h2><button class="icon" id="quitCancelX">✕</button></div>
        <div class="about-body">
          <p>This stops the PFi server running on your Mac. Your data is saved — relaunch any time from the PFi icon.</p>
          <div class="modal-actions">
            <button class="btn ghost" id="quitCancel">Cancel</button>
            <button class="btn danger" id="quitConfirm">Quit PFi</button>
          </div>
        </div>
      </div>
    </div>`;
  const close = () => { host.innerHTML = ""; };
  document.getElementById("quitCancel").addEventListener("click", close);
  document.getElementById("quitCancelX").addEventListener("click", close);
  document.getElementById("quitOv").addEventListener("click", (e) => { if (e.target.id === "quitOv") close(); });
  document.getElementById("quitConfirm").addEventListener("click", async () => {
    // Fire the request; the server replies, then stops accepting connections.
    try { await api.post("/shutdown", {}); } catch (e) { /* connection may drop as it stops */ }
    showStopped();
  });
}

function showStopped() {
  document.querySelectorAll(".modal-overlay").forEach((o) => o.remove());
  document.body.innerHTML =
    '<div class="stopped-screen">' +
    '<div class="brand" style="font-size:34px;margin-bottom:14px">P<span>Fi</span></div>' +
    '<h2>PFi has stopped</h2>' +
    '<p>The local server is no longer running. You can safely close this tab.</p>' +
    '<p class="muted">Relaunch PFi from its icon to start it again.</p>' +
    '</div>';
}

// ---- Software update: check GitHub for newer code, one-click pull + restart.
const updateBtn = document.getElementById("updateBtn");
let lastUpdate = null; // cache of the most recent /api/update result

function reflectUpdate(info) {
  lastUpdate = info || null;
  if (info && info.update_available) {
    updateBtn.textContent = "↑ Update" + (info.latest ? " to v" + info.latest : "");
    updateBtn.hidden = false;
    updateBtn.title = info.can_update
      ? "A newer version of PFi is available — click to update"
      : (info.message || "An update is available");
  } else {
    updateBtn.hidden = true;
  }
}

async function checkForUpdates() {
  try {
    const info = await api.get("/update");
    reflectUpdate(info);
    return info;
  } catch (e) {
    return null; // offline / not a git install — stay quiet
  }
}

updateBtn.addEventListener("click", () => openUpdate(lastUpdate));

function openUpdate(info) {
  info = info || lastUpdate || {};
  const bundle = info.kind === "bundle";
  const canUpdate = !!info.can_update;
  const avail = !!info.update_available;
  const body = avail
    ? `<p>A newer version of PFi is available.</p>
       <table class="about-table"><tbody>
         <tr><td>You have</td><td class="num mono">v${esc(info.current || "—")}</td></tr>
         <tr><td>Latest</td><td class="num mono">v${esc(info.latest || "—")}</td></tr>
       </tbody></table>
       <p class="muted">PFi will pull the newest code from GitHub${bundle ? ", rebuild the app," : ""} and restart itself. Your data isn't touched.</p>
       ${canUpdate ? "" : `<p class="upd-warn">${esc(info.message || "This copy can't self-update.")}</p>`}`
    : `<p>${esc(info.message || "You're on the latest version.")}</p>`;
  let host = document.getElementById("updateModal");
  if (!host) { host = document.createElement("div"); host.id = "updateModal"; document.body.appendChild(host); }
  host.innerHTML = `
    <div class="modal-overlay" id="updOv">
      <div class="modal" style="max-width:440px">
        <div class="modal-head"><h2>Software update</h2><button class="icon" id="updX">✕</button></div>
        <div class="about-body" id="updBody">
          ${body}
          <div class="modal-actions">
            <button class="btn ghost" id="updCancel">Close</button>
            ${avail && canUpdate ? `<button class="btn" id="updGo">Update now</button>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  const close = () => { host.innerHTML = ""; };
  document.getElementById("updX").addEventListener("click", close);
  document.getElementById("updCancel").addEventListener("click", close);
  document.getElementById("updOv").addEventListener("click", (e) => { if (e.target.id === "updOv") close(); });
  const go = document.getElementById("updGo");
  if (go) go.addEventListener("click", () => runUpdate(host));
}

async function runUpdate(host) {
  const body = host.querySelector("#updBody");
  const bundle = lastUpdate && lastUpdate.kind === "bundle";
  body.innerHTML = `<p class="upd-progress"><span class="spinner"></span> Applying update… PFi is restarting${bundle ? " and rebuilding the app" : ""}. This can take a moment.</p>`;
  let res;
  try { res = await api.post("/update/apply", {}); }
  catch (e) { res = { ok: false, message: "The update request failed to send." }; }

  if (!res || !res.ok) {
    body.innerHTML = `<p class="upd-warn">Update failed.</p><p class="muted">${esc((res && res.message) || "Unknown error.")}</p>
      <div class="modal-actions"><button class="btn ghost" id="updDone">Close</button></div>`;
    body.querySelector("#updDone").addEventListener("click", () => { host.innerHTML = ""; });
    return;
  }
  if (res.noop) {
    reflectUpdate({ update_available: false });
    body.innerHTML = `<p>${esc(res.message || "Already up to date.")}</p>
      <div class="modal-actions"><button class="btn ghost" id="updDone">Close</button></div>`;
    body.querySelector("#updDone").addEventListener("click", () => { host.innerHTML = ""; });
    return;
  }
  // Success: the server is restarting. Wait for it to answer again, then reload.
  const back = await waitForServer(res.to);
  if (back) {
    body.innerHTML = `<p class="upd-ok">✓ Updated to v${esc(res.to || "")}. Reloading…</p>`;
    setTimeout(() => location.reload(), 800);
  } else {
    body.innerHTML = `<p class="upd-warn">Update applied, but the server hasn't come back yet.</p>
      <p class="muted">Give it a moment, then reload the page.</p>
      <div class="modal-actions"><button class="btn" id="updReload">Reload</button></div>`;
    body.querySelector("#updReload").addEventListener("click", () => location.reload());
  }
}

// Poll /api/version until the restarted server responds (optionally on the
// expected new version). Resolves false after ~90s so we never hang forever.
function waitForServer(expected) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = async () => {
      n++;
      try {
        const v = await api.get("/version");
        if (v && v.app && (!expected || v.app === expected)) return resolve(true);
      } catch (e) { /* still down */ }
      if (n >= 90) return resolve(false);
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1200); // let the old listener drop first
  });
}

// ---- About panel: per-module versions
async function openAbout() {
  let backend = {};
  try { backend = await api.get("/version"); } catch (e) { /* offline */ }
  const versions = { ...backend, ui: UI_VERSION };
  document.getElementById("appVer").textContent = "v" + (versions.app || UI_VERSION);
  const rows = [
    ["App", versions.app],
    ["UI / Frontend", versions.ui],
    ["API / Backend", versions.api],
    ["Database", versions.db],
    ["Importer", versions.importer],
  ].map(([k, v]) => `<tr><td>${k}</td><td class="num mono">v${v || "—"}</td></tr>`).join("");

  let host = document.getElementById("aboutModal");
  if (!host) {
    host = document.createElement("div");
    host.id = "aboutModal";
    document.body.appendChild(host);
  }
  host.innerHTML = `
    <div class="modal-overlay" id="aboutOv">
      <div class="modal" style="max-width:420px">
        <div class="modal-head"><h2>About PFi</h2><button class="icon" id="aboutClose">✕</button></div>
        <div class="about-body">
          <p class="muted">Local, private portfolio tracker. Each module is versioned independently.</p>
          <table class="about-table"><tbody>${rows}</tbody></table>
          <div class="about-update">
            <button class="btn ghost sm" id="aboutCheck">Check for updates</button>
            <span class="upd-status muted" id="aboutUpdStatus"></span>
          </div>
        </div>
      </div>
    </div>`;
  const close = () => { host.innerHTML = ""; };
  document.getElementById("aboutClose").addEventListener("click", close);
  document.getElementById("aboutOv").addEventListener("click", (e) => { if (e.target.id === "aboutOv") close(); });
  // Updates row: check on demand, then hand off to the update dialog.
  const checkBtn = document.getElementById("aboutCheck");
  const status = document.getElementById("aboutUpdStatus");
  checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    status.textContent = "Checking…";
    const info = await checkForUpdates();
    checkBtn.disabled = false;
    if (!info) { status.textContent = "Couldn't reach GitHub."; return; }
    if (info.update_available) {
      status.textContent = "";
      close();
      openUpdate(info);
    } else {
      status.textContent = info.message || "You're on the latest version.";
    }
  });
}

// Populate the footer version string up front.
api.get("/version").then((v) => {
  document.getElementById("appVer").textContent = "v" + (v.app || UI_VERSION);
}).catch(() => {
  document.getElementById("appVer").textContent = "v" + UI_VERSION;
});

render();

// Quietly ask the server whether newer code is published; reveals the topbar
// "↑ Update" pill if so. Runs after first paint so it never delays the UI.
checkForUpdates();
