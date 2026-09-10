/**
 * Scene discovery and lifecycle.
 *
 * Every folder under src/scenes/ that contains a scene.js is picked up
 * automatically. Drop a folder in and it shows up in the launcher; delete it
 * and it's gone, with nothing else to update.
 */
const manifestModules = import.meta.glob('../scenes/*/scene.js', { eager: true });

function collect() {
  const out = [];
  for (const [path, mod] of Object.entries(manifestModules)) {
    const m = mod.default;
    if (!m) { console.warn(`[scenes] ${path} has no default export — skipped`); continue; }
    const folder = path.match(/scenes\/([^/]+)\//)?.[1] ?? m.id;
    out.push({
      order: 100,
      tags: [],
      ...m,
      id: m.id || folder,
      name: m.name || folder,
      folder,
      dir: `src/scenes/${folder}`,
    });
  }
  return out.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
}

export class SceneManager {
  constructor(app) {
    this.app = app;
    this.manifests = collect();
    this.current = null;
    this.currentManifest = null;
    this.switching = false;
    this.listeners = new Set();
  }

  get list() { return this.manifests; }
  find(id) { return this.manifests.find((m) => m.id === id) || null; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(phase, detail) { for (const fn of this.listeners) fn(phase, detail); }

  async switchTo(id, { silent = false } = {}) {
    const manifest = this.find(id);
    if (!manifest) { console.warn(`[scenes] unknown scene "${id}"`); return null; }
    if (this.switching) return null;
    this.switching = true;
    this._emit('loading', manifest);

    try {
      await this.unload();

      if (!silent) this.app.setStatus(`loading ${manifest.name.toLowerCase()}…`);
      const mod = await manifest.load();
      const SceneClass = mod.default;
      if (!SceneClass) throw new Error(`${manifest.dir}/index.js has no default export`);

      const scene = new SceneClass();
      const ctx = this.app.makeContext(manifest);
      scene.ctx = ctx;
      await scene.init(ctx);

      this.current = scene;
      this.currentManifest = manifest;
      this.app.onSceneReady(scene, manifest);
      this._emit('ready', manifest);
      return scene;
    } catch (err) {
      console.error(`[scenes] failed to load "${id}"`, err);
      this.app.setStatus(`could not load ${manifest.name}`);
      this._emit('error', { manifest, err });
      return null;
    } finally {
      this.switching = false;
    }
  }

  async unload() {
    if (!this.current) return;
    const scene = this.current;
    this.current = null;
    this.currentManifest = null;
    this.app.onSceneUnload(scene);
    try { scene.dispose(); } catch (e) { console.warn('[scenes] dispose threw', e); }
    this._emit('unloaded', null);
  }
}
