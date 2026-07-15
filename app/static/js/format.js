// Shared formatters, label maps, and categorical colors. No DOM, no deps.

export const fmtMoney = (n, compact = false) => {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (compact) {
    if (abs >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return "$" + (n / 1e3).toFixed(0) + "k";
    return "$" + n.toFixed(0);
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};

export const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

export const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A small "?" help affordance. Hover shows `text`; clicking deep-links to the
// matching How-To section id (a delegated listener in app.js handles the jump).
export const help = (section, text) =>
  `<button type="button" class="help" data-help="${section}" title="${esc(text)} — click for the full guide" aria-label="Help: ${esc(text)}">?</button>`;

export const KIND_LABEL = {
  liquid: "Liquid Assets",
  nonliquid: "Non-Liquid Assets",
  debt: "Debts",
};

export const ASSET_CLASSES = [
  "cash", "stock_bonds", "real_estate", "equity_retire",
  "crypto", "owed", "inventory", "debt",
];

// Suggested subtypes per asset class (datalist hints; free text still allowed).
export const SUBTYPES = {
  cash: ["Checking", "Savings", "Money Market", "CD", "Brokerage Cash"],
  stock_bonds: ["Taxable Brokerage", "Index Funds", "Individual Stocks", "Bonds", "Treasuries"],
  real_estate: ["Primary Residence", "Rental", "Land", "Commercial"],
  equity_retire: ["401(k)", "Roth IRA", "Traditional IRA", "SEP IRA", "Pension", "HSA"],
  crypto: ["Exchange", "Cold Wallet", "Hot Wallet", "Staking"],
  owed: ["Personal Loan", "Receivable", "Reimbursement"],
  inventory: ["Season Tickets", "Goods", "Collectibles"],
  debt: ["Mortgage", "Auto Loan", "Credit Card", "Student Loan", "Personal Loan", "HELOC", "Buyout"],
};

// Categorical colors for asset classes. Constant across light/dark so a slice
// keeps its identity; tuned to read on both backgrounds. The user can recolor
// any class from the Dashboard legend; overrides persist in localStorage.
export const DEFAULT_DONUT_COLORS = {
  cash: "#1aa179", stock_bonds: "#3b82f6", real_estate: "#d9920b",
  equity_retire: "#8b5cf6", crypto: "#ea7317", owed: "#0ea5b7",
  inventory: "#d6409f", debt: "#e5484d",
};

const COLORS_KEY = "pfi-class-colors";
function loadColorOverrides() {
  try { return JSON.parse(localStorage.getItem(COLORS_KEY) || "{}") || {}; }
  catch { return {}; }
}

// Live palette = defaults overlaid with the user's saved overrides. Exported by
// reference and mutated in place by setClassColor/resetClassColors, so every
// chart/legend that reads it picks up an edit on the next re-render.
export const DONUT_COLORS = { ...DEFAULT_DONUT_COLORS, ...loadColorOverrides() };

export function setClassColor(cls, hex) {
  DONUT_COLORS[cls] = hex;
  const ov = loadColorOverrides();
  ov[cls] = hex;
  localStorage.setItem(COLORS_KEY, JSON.stringify(ov));
}

export function resetClassColors() {
  localStorage.removeItem(COLORS_KEY);
  for (const k of Object.keys(DONUT_COLORS)) {
    if (k in DEFAULT_DONUT_COLORS) DONUT_COLORS[k] = DEFAULT_DONUT_COLORS[k];
    else delete DONUT_COLORS[k];
  }
}

export const CLASS_LABELS = {
  cash: "Cash", stock_bonds: "Stocks / Bonds", real_estate: "Real Estate",
  equity_retire: "Equity / Retirement", crypto: "Crypto", owed: "Owed to me",
  inventory: "Inventory", debt: "Debt",
};
