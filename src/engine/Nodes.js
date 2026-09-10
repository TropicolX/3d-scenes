/**
 * The scene graph as devtools sees it.
 *
 * A scene registers one node per meaningful *thing* — a system like "grass", a
 * prop group like "trees", a light, an audio bed. Nodes carry the source file
 * they came from, which is what lets a click in the viewport turn into an
 * unambiguous instruction ("Trees.js, instance 412").
 */
let seq = 0;

export class NodeHandle {
  constructor(registry, def) {
    this.registry = registry;
    this.uid = `n${++seq}`;
    this.id = def.id;
    this.name = def.name || def.id;
    this.kind = def.kind || 'system';
    this.object = def.object || null;
    this.source = def.source || null;
    this.note = def.note || '';
    this.params = def.params || null;      // schema fragment
    this.target = def.target || null;      // object the schema addresses
    this.stats = def.stats || null;        // () => ({...})
    this.pick = def.pick || null;          // { at(point) -> hit | null }
    this.actions = def.actions || null;    // { label: fn }
    this.parent = def.parent || null;      // parent node id, for the outliner
    this.children = [];
    this._visible = true;
  }

  get visible() { return this._visible; }
  set visible(v) {
    this._visible = !!v;
    if (this.object) this.object.visible = this._visible;
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      source: this.source,
      note: this.note || undefined,
      stats: this.stats ? safe(this.stats) : undefined,
      visible: this.visible,
    };
  }
}

function safe(fn) { try { return fn(); } catch { return undefined; } }

export class NodeRegistry {
  constructor() {
    this.nodes = [];
    this.byId = new Map();
    this.listeners = new Set();
  }

  add(def) {
    const node = new NodeHandle(this, def);
    if (this.byId.has(node.id)) {
      console.warn(`[nodes] duplicate node id "${node.id}" — later one wins`);
    }
    this.nodes.push(node);
    this.byId.set(node.id, node);
    if (node.parent) {
      const p = this.byId.get(node.parent);
      if (p) p.children.push(node);
    }
    this.emit();
    return node;
  }

  remove(id) {
    const n = this.byId.get(id);
    if (!n) return;
    this.byId.delete(id);
    this.nodes = this.nodes.filter((x) => x !== n);
    this.emit();
  }

  clear() {
    this.nodes = [];
    this.byId.clear();
    this.emit();
  }

  /** Top-level nodes, with children nested underneath. */
  get roots() { return this.nodes.filter((n) => !n.parent || !this.byId.has(n.parent)); }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
}
