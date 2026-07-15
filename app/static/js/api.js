// Thin fetch wrapper around the JSON API. Same-origin, localhost only.
export const api = {
  async get(p) {
    return (await fetch("/api" + p)).json();
  },
  async post(p, b) {
    return (await fetch("/api" + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    })).json();
  },
  async put(p, b) {
    return (await fetch("/api" + p, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    })).json();
  },
  async del(p) {
    return (await fetch("/api" + p, { method: "DELETE" })).json();
  },
};
