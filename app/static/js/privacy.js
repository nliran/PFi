// Privacy ("hide values") controller. Sets data-privacy on <html>, persists the
// choice, and notifies subscribers. When on, CSS blurs every on-screen monetary
// value so the UI can be screenshotted/shared without revealing real numbers.
const KEY = "pfi-privacy";
const listeners = new Set();

export function getPrivacy() {
  return document.documentElement.getAttribute("data-privacy") === "on";
}

export function applyPrivacy(on) {
  document.documentElement.setAttribute("data-privacy", on ? "on" : "off");
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* private mode */ }
  listeners.forEach((fn) => fn(on));
}

export function togglePrivacy() {
  applyPrivacy(!getPrivacy());
}

export function onPrivacyChange(fn) {
  listeners.add(fn);
}

// Apply the saved preference (the inline head script does this pre-paint too, to
// avoid a flash of real values before this module loads).
export function initPrivacy() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
  const on = saved === "on";
  document.documentElement.setAttribute("data-privacy", on ? "on" : "off");
  return on;
}
