/** Namespaced localStorage, so each scene keeps its own tweaks. */
export class Store {
  constructor(namespace) { this.ns = namespace; }

  key(k) { return `meadow:${this.ns}:${k}`; }

  get(k, fallback = null) {
    try {
      const raw = localStorage.getItem(this.key(k));
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }

  set(k, v) {
    try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch {}
  }

  remove(k) { try { localStorage.removeItem(this.key(k)); } catch {} }

  child(sub) { return new Store(`${this.ns}:${sub}`); }
}
