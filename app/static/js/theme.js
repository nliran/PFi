// Light/dark theme controller. Sets data-theme on <html>, persists the choice,
// and notifies subscribers (so charts can redraw with theme colors).
const KEY = "pfi-theme";
const listeners = new Set();

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode */ }
  listeners.forEach((fn) => fn(theme));
}

export function toggleTheme() {
  applyTheme(getTheme() === "dark" ? "light" : "dark");
}

export function onThemeChange(fn) {
  listeners.add(fn);
}

// Pick the initial theme: saved preference, else OS preference, else dark.
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
  if (!saved) {
    const prefersLight = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    saved = prefersLight ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", saved);
  return saved;
}
