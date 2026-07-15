// PFi frontend entry point. Wires navigation, theming, the version footer, and
// the About panel, then renders the selected view. ES modules keep each concern
// in its own scope (no shared globals).
import { api } from "./api.js";
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
        </div>
      </div>
    </div>`;
  const close = () => { host.innerHTML = ""; };
  document.getElementById("aboutClose").addEventListener("click", close);
  document.getElementById("aboutOv").addEventListener("click", (e) => { if (e.target.id === "aboutOv") close(); });
}

// Populate the footer version string up front.
api.get("/version").then((v) => {
  document.getElementById("appVer").textContent = "v" + (v.app || UI_VERSION);
}).catch(() => {
  document.getElementById("appVer").textContent = "v" + UI_VERSION;
});

render();
