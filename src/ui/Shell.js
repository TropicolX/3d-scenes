import { ParamView, el } from './ParamView.js';
import { isTextTarget } from '../engine/Input.js';

const GLOBAL_KEYS = [
  ['W A S D', 'move'], ['Mouse', 'look'], ['Shift', 'sprint'],
  ['Tab', 'scenes'], ['`', 'dev mode'], ['H', 'hide UI'], ['P', 'screenshot'],
];

/**
 * Everything the player sees that isn't the world: the parameter panel, the
 * scene launcher, the intro card and the stats readout. Rebuilt from the
 * scene's schema whenever a scene mounts, so scenes never touch DOM directly.
 */
export class Shell {
  constructor(app) {
    this.app = app;
    this.view = null;
    this.hidden = false;
    app.ui = this;

    this.panelRoot = document.getElementById('ui');
    this.statsEl = document.getElementById('stats');

    app.on('sceneReady', (scene, manifest) => this.mountScene(scene, manifest));
    app.on('sceneUnload', () => this.unmountScene());
    app.on('frame', () => this.tick());

    this._onKey = (e) => this.handleKey(e);
    window.addEventListener('keydown', this._onKey);
    app.canvas.addEventListener('click', () => {
      if (!this.launcherOpen && !app.dev?.enabled && !app.input.locked) app.input.lock();
    });
  }

  // ---- panel --------------------------------------------------------------

  mountScene(scene, manifest) {
    this.unmountScene();
    if (!scene.schema || !scene.params) return;

    const panel = el('div', 'panel ui-surface');
    const head = el('div', 'panel-head');
    head.innerHTML = `<span class="name"></span><span class="chev">▾</span>`;
    head.querySelector('.name').textContent = manifest.name;
    head.addEventListener('click', () => panel.classList.toggle('collapsed'));

    const body = el('div', 'panel-body');
    panel.append(head, body);
    this.panelRoot.appendChild(panel);
    this.panel = panel;

    const scenesRow = el('div', 'actions');
    const sceneBtn = el('div', 'act', `Scenes  ·  ${this.app.scenes.list.length}`);
    sceneBtn.addEventListener('click', () => this.openLauncher());
    const shotBtn = el('div', 'act', 'Screenshot');
    shotBtn.addEventListener('click', () => this.app.screenshot());
    scenesRow.append(sceneBtn, shotBtn);
    body.appendChild(scenesRow);

    const holder = el('div');
    body.appendChild(holder);
    this.view = ParamView(holder, scene.schema, scene.params, {});

    const foot = el('div', 'panel-foot',
      '` dev mode · Tab scenes · H hides UI · C cinematic · F fly');
    body.appendChild(foot);

    if (window.matchMedia('(max-width: 720px)').matches) panel.classList.add('collapsed');
    this.showIntro(manifest);
  }

  unmountScene() {
    this.view?.destroy();
    this.view = null;
    this.panelRoot.innerHTML = '';
    this.panel = null;
  }

  sync(key) { this.view?.sync(key); }

  tick() {
    if (!this.statsEl || this.hidden) return;
    const s = this.app.state;
    const scene = this.app.scenes.current;
    const p = scene?.controller?.pos;
    const extra = scene?.statLine?.() ?? '';
    this.statsEl.innerHTML = `${s.fps} fps${extra ? ` · ${extra}` : ''}`
      + (p ? `<br>${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}` : '');
  }

  // ---- intro --------------------------------------------------------------

  showIntro(manifest) {
    this.dismissIntro();
    const card = el('div', 'hint-card ui-surface');
    const keys = GLOBAL_KEYS.map(([k, v]) => `<span><b>${k}</b> ${v}</span>`).join('');
    card.innerHTML = `
      <h1></h1>
      <p class="tag"></p>
      <div class="keys">${keys}</div>
      <button id="enter">step in</button>`;
    card.querySelector('h1').textContent = manifest.name;
    card.querySelector('.tag').textContent = manifest.blurb || '';
    const overlay = el('div', 'hint-overlay');
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.classList.add('intro');
    this.introEl = overlay;
    card.querySelector('#enter').addEventListener('click', () => {
      this.dismissIntro();
      this.app.input.lock();
    });
  }

  dismissIntro() {
    this.introEl?.remove();
    this.introEl = null;
    document.body.classList.remove('intro');
  }

  // ---- launcher -----------------------------------------------------------

  get launcherOpen() { return !!this.launcherEl; }

  openLauncher() {
    if (this.launcherEl) return;
    this.app.input.unlock();
    const overlay = el('div', 'launcher');
    const inner = el('div', 'launcher-inner');
    inner.appendChild(el('div', 'launcher-title', 'Scenes'));
    inner.appendChild(el('div', 'launcher-sub',
      `${this.app.scenes.list.length} in src/scenes — drop a folder in to add one`));

    const grid = el('div', 'launcher-grid');
    const currentId = this.app.scenes.currentManifest?.id;
    for (const m of this.app.scenes.list) {
      const card = el('div', 'scene-card ui-surface');
      if (m.id === currentId) card.classList.add('current');
      if (m.accent) card.style.setProperty('--card-accent', m.accent);
      const poster = el('div', 'scene-poster');
      if (m.poster) poster.style.backgroundImage = `url("${m.poster}")`;
      else poster.classList.add('empty');
      const meta = el('div', 'scene-meta');
      meta.appendChild(el('div', 'scene-name', m.name));
      meta.appendChild(el('div', 'scene-blurb', m.blurb || ''));
      const tags = el('div', 'scene-tags');
      for (const t of m.tags || []) tags.appendChild(el('span', 'scene-tag', t));
      tags.appendChild(el('span', 'scene-dir', m.dir));
      meta.appendChild(tags);
      card.append(poster, meta);
      card.addEventListener('click', () => {
        this.closeLauncher();
        if (m.id !== currentId) this.app.scenes.switchTo(m.id);
      });
      grid.appendChild(card);
    }
    inner.appendChild(grid);
    overlay.appendChild(inner);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeLauncher(); });
    document.body.appendChild(overlay);
    this.launcherEl = overlay;
  }

  closeLauncher() {
    this.launcherEl?.remove();
    this.launcherEl = null;
  }

  // ---- keys ---------------------------------------------------------------

  handleKey(e) {
    if (isTextTarget(e.target)) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      this.launcherOpen ? this.closeLauncher() : this.openLauncher();
      return;
    }
    if (e.code === 'Escape') {
      if (this.launcherOpen) { this.closeLauncher(); return; }
      if (this.introEl) { this.dismissIntro(); return; }
    }
    if (this.introEl && e.code === 'Enter') { this.dismissIntro(); return; }
    if (e.code === 'KeyH') {
      this.hidden = !this.hidden;
      document.body.classList.toggle('ui-hidden', this.hidden);
    }
    if (e.code === 'KeyP') this.app.screenshot();
  }
}
