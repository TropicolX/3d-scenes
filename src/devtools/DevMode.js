import { Picker } from './Picker.js';
import { Gizmo } from './Gizmo.js';
import { Handoff } from './Handoff.js';
import { ParamView, el } from '../ui/ParamView.js';
import { isTextTarget } from '../engine/Input.js';

const KIND_ICON = {
  system: '◈', props: '❖', fx: '✳', post: '◐', data: '▤', mesh: '△',
  light: '☀', audio: '♪', group: '▣',
};

/**
 * Dev mode: an outliner, a live inspector, click-to-select in the viewport,
 * and a one-key handoff that tells Claude exactly what you're pointing at.
 */
export class DevMode {
  constructor(app) {
    this.app = app;
    this.enabled = false;
    this.picker = new Picker(app);
    this.gizmo = new Gizmo(app.renderer);
    this.handoff = new Handoff(app);
    this.selection = [];
    this.soloed = null;
    this.root = null;
    this.inspectorView = null;
    this._lastT = performance.now();

    app.dev = this;
    app.nodes.onChange(() => { if (this.enabled) this.renderOutliner(); });
    app.on('sceneReady', () => { this.clearSelection(); if (this.enabled) this.refresh(); });

    this._onKey = (e) => this.handleKey(e);
    this._onClick = (e) => this.handleClick(e);
    window.addEventListener('keydown', this._onKey);
    app.canvas.addEventListener('pointerdown', this._onClick);
  }

  // ---- toggling -----------------------------------------------------------

  toggle(on = !this.enabled) {
    this.enabled = on;
    document.body.classList.toggle('dev-on', on);
    if (on) {
      // you can't click what you can't point at
      this.app.input.unlock();
      // the outliner lives where the game panel does; tuck it away but leave it
      // one click from reachable so presets and viewpoints stay available
      const panel = document.querySelector('#ui .panel');
      this._panelWasCollapsed = panel?.classList.contains('collapsed');
      panel?.classList.add('collapsed');
      this.mount();
      this.refresh();
    } else {
      const panel = document.querySelector('#ui .panel');
      if (panel && !this._panelWasCollapsed) panel.classList.remove('collapsed');
      this.unmount();
      this.clearSelection();
    }
  }

  mount() {
    if (this.root) return;
    const root = el('div', 'dev-root');

    const bar = el('div', 'dev-bar ui-surface');
    bar.innerHTML = `
      <span class="dev-badge">DEV</span>
      <span class="dev-scene"></span>
      <span class="dev-sep"></span>
      <span class="dev-stat" data-stat="fps"></span>
      <span class="dev-stat" data-stat="nodes"></span>
      <span class="dev-sep"></span>
      <button class="dev-btn" data-act="outliner">Outliner</button>
      <button class="dev-btn" data-act="inspector">Inspector</button>
      <button class="dev-btn dev-btn-accent" data-act="handoff">Send to Claude</button>
      <button class="dev-btn" data-act="exit">Exit</button>`;
    bar.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'exit') this.toggle(false);
      if (act === 'outliner') this.outliner.classList.toggle('hidden');
      if (act === 'inspector') this.inspector.classList.toggle('hidden');
      if (act === 'handoff') this.openComposer();
    });

    this.outliner = el('div', 'dev-pane dev-outliner ui-surface');
    this.outliner.innerHTML = `<div class="dev-pane-head">Outliner</div><div class="dev-pane-body"></div>`;
    this.inspector = el('div', 'dev-pane dev-inspector ui-surface');
    this.inspector.innerHTML = `<div class="dev-pane-head">Inspector</div><div class="dev-pane-body"></div>`;

    this.hint = el('div', 'dev-hint',
      'click to select · ⌥click cycles · ⇧click adds · esc clears · ⌘⏎ send to Claude · ` exits');

    root.append(bar, this.outliner, this.inspector, this.hint);
    document.body.appendChild(root);
    this.root = root;
    this.bar = bar;
  }

  unmount() {
    this.root?.remove();
    this.root = null;
    this.closeComposer();
  }

  refresh() {
    if (!this.root) return;
    const m = this.app.scenes.currentManifest;
    this.bar.querySelector('.dev-scene').textContent = m ? `${m.name}  ·  ${m.dir}` : 'no scene';
    this.renderOutliner();
    this.renderInspector();
  }

  tickStats() {
    if (!this.root) return;
    this.bar.querySelector('[data-stat="fps"]').textContent = `${this.app.state.fps} fps`;
    this.bar.querySelector('[data-stat="nodes"]').textContent = `${this.app.nodes.nodes.length} nodes`;
  }

  // ---- selection ----------------------------------------------------------

  handleClick(e) {
    if (!this.enabled || e.button !== 0) return;
    if (e.target !== this.app.canvas) return;

    const near = this._lastPick
      && Math.hypot(e.clientX - this._lastPick.x, e.clientY - this._lastPick.y) < 6;
    const cycling = e.altKey && near;
    const candidates = cycling ? this._lastPick.candidates : this.picker.pick(e.clientX, e.clientY);
    if (!candidates.length) {
      this._lastPick = null;
      if (!e.shiftKey) this.clearSelection();
      return;
    }
    const idx = cycling ? (this._lastPick.index + 1) % candidates.length : 0;
    this._lastPick = { x: e.clientX, y: e.clientY, candidates, index: idx };

    const hit = candidates[idx];
    this.altCount = candidates.length;
    if (e.shiftKey && !cycling) this.selection.push(hit);
    else this.selection = [hit];
    this.showGizmo(hit);
    this.renderInspector();
    this.renderOutliner();
  }

  selectNode(node) {
    const hit = { node, point: node.object?.position?.clone?.() || null, label: node.name };
    this.selection = [hit];
    if (hit.point) this.showGizmo({ ...hit, radius: 4, height: 4 });
    else this.gizmo.clear();
    this.renderInspector();
    this.renderOutliner();
  }

  showGizmo(hit) {
    if (!hit.point) return this.gizmo.clear();
    this.gizmo.show({
      point: hit.point,
      radius: hit.radius ?? 3,
      height: hit.height ?? 4,
      boxed: !!hit.instance,
    });
  }

  clearSelection() {
    this.selection = [];
    this.gizmo.clear();
    if (this.enabled) { this.renderInspector(); this.renderOutliner(); }
  }

  // ---- outliner -----------------------------------------------------------

  renderOutliner() {
    const body = this.outliner?.querySelector('.dev-pane-body');
    if (!body) return;
    body.innerHTML = '';
    const selectedIds = new Set(this.selection.map((s) => s.node.id));

    for (const node of this.app.nodes.nodes) {
      const row = el('div', 'dev-node');
      if (selectedIds.has(node.id)) row.classList.add('sel');
      if (this.soloed && this.soloed !== node.id) row.classList.add('dim');

      const eye = el('button', 'dev-eye', node.visible ? '◉' : '○');
      eye.title = 'visibility';
      eye.addEventListener('click', (ev) => {
        ev.stopPropagation();
        node.visible = !node.visible;
        this.renderOutliner();
      });

      const icon = el('span', 'dev-node-icon', KIND_ICON[node.kind] || '◆');
      const name = el('span', 'dev-node-name', node.name);
      const kind = el('span', 'dev-node-kind', node.kind);

      const solo = el('button', 'dev-solo', 'S');
      solo.title = 'solo';
      solo.addEventListener('click', (ev) => { ev.stopPropagation(); this.soloNode(node.id); });

      row.append(eye, icon, name, kind, solo);
      row.addEventListener('click', () => this.selectNode(node));
      body.appendChild(row);
    }
  }

  soloNode(id) {
    this.soloed = this.soloed === id ? null : id;
    for (const n of this.app.nodes.nodes) {
      n.visible = !this.soloed || n.id === this.soloed;
    }
    this.renderOutliner();
  }

  // ---- inspector ----------------------------------------------------------

  renderInspector() {
    const body = this.inspector?.querySelector('.dev-pane-body');
    if (!body) return;
    this.inspectorView?.destroy();
    this.inspectorView = null;
    body.innerHTML = '';

    if (!this.selection.length) {
      body.appendChild(el('div', 'dev-empty', 'Nothing selected.\nClick the world, or a row in the outliner.'));
      return;
    }

    for (const sel of this.selection) {
      const n = sel.node;
      const card = el('div', 'dev-card');
      card.appendChild(el('div', 'dev-card-title', n.name));
      const meta = el('div', 'dev-meta');
      meta.appendChild(kv('id', n.id));
      meta.appendChild(kv('kind', n.kind));
      if (n.source) meta.appendChild(kv('source', n.source, true));
      if (sel.label) meta.appendChild(kv('hit', sel.label));
      if (sel.point) meta.appendChild(kv('world', sel.point.toArray().map((v) => v.toFixed(1)).join(', ')));
      if (sel.instance) meta.appendChild(kv('instance', JSON.stringify(sel.instance)));
      if (this.altCount > 1 && this.selection.length === 1) {
        meta.appendChild(kv('under cursor', `${this.altCount} — ⌥click to cycle`));
      }
      const stats = n.stats ? tryCall(n.stats) : null;
      if (stats) for (const [k, v] of Object.entries(stats)) meta.appendChild(kv(k, fmt(v)));
      if (n.note) meta.appendChild(kv('note', n.note));
      card.appendChild(meta);

      if (n.actions) {
        const acts = el('div', 'actions');
        for (const [label, fn] of Object.entries(n.actions)) {
          const b = el('div', 'act', label);
          b.addEventListener('click', () => fn());
          acts.appendChild(b);
        }
        card.appendChild(acts);
      }

      if (n.params?.length && n.target) {
        const holder = el('div', 'dev-params');
        card.appendChild(holder);
        this.inspectorView = ParamView(holder, n.params, n.target, {
          compact: true,
          onChange: () => this.app.ui?.sync(),
        });
      }
      body.appendChild(card);
    }
  }

  // ---- handoff composer ---------------------------------------------------

  openComposer() {
    if (this.composer) return;
    const wrap = el('div', 'dev-composer ui-surface');
    const count = this.selection.length;
    wrap.innerHTML = `
      <div class="dev-composer-head">Send to Claude</div>
      <div class="dev-composer-sub">${count ? `${count} selected` : 'no selection — whole-scene note'}</div>
      <textarea class="dev-textarea" rows="4" placeholder="What should change? e.g. make these trees taller and less yellow"></textarea>
      <label class="dev-check"><input type="checkbox" checked> include screenshot</label>
      <div class="dev-composer-actions">
        <button class="dev-btn" data-act="cancel">Cancel</button>
        <button class="dev-btn dev-btn-accent" data-act="send">Send  ⌘⏎</button>
      </div>
      <div class="dev-composer-result"></div>`;
    document.body.appendChild(wrap);
    this.composer = wrap;
    this.app.input.suspended = true;

    const ta = wrap.querySelector('textarea');
    setTimeout(() => ta.focus(), 20);
    wrap.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'cancel') this.closeComposer();
      if (act === 'send') this.sendHandoff();
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this.sendHandoff(); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeComposer(); }
    });
  }

  closeComposer() {
    this.composer?.remove();
    this.composer = null;
    this.app.input.suspended = false;
  }

  async sendHandoff() {
    if (!this.composer) return;
    const note = this.composer.querySelector('textarea').value;
    const includeShot = this.composer.querySelector('input[type=checkbox]').checked;
    const result = this.composer.querySelector('.dev-composer-result');
    result.textContent = 'writing…';

    const { written } = await this.handoff.send({ selection: this.selection, note, includeShot });
    if (written?.files) {
      result.innerHTML = `written → <code>${written.files.join('</code>, <code>')}</code>`;
      setTimeout(() => this.closeComposer(), 1400);
    } else {
      result.textContent = 'dev bridge unavailable — copied to clipboard instead';
    }
  }

  // ---- keys + frame -------------------------------------------------------

  handleKey(e) {
    if (e.code === 'Backquote' && !isTextTarget(e.target)) {
      e.preventDefault();
      this.toggle();
      return;
    }
    if (!this.enabled) return;
    if (isTextTarget(e.target)) return;
    if (e.code === 'Escape') this.clearSelection();
    if ((e.metaKey || e.ctrlKey) && e.code === 'Enter') { e.preventDefault(); this.openComposer(); }
  }

  renderOverlay(scene) {
    if (!this.enabled || !scene?.camera) return;
    const now = performance.now();
    const dt = Math.min((now - this._lastT) / 1000, 0.05);
    this._lastT = now;
    this.gizmo.render(scene.camera, dt);
    if (now - (this._statT || 0) > 400) { this._statT = now; this.tickStats(); }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this.app.canvas.removeEventListener('pointerdown', this._onClick);
    this.gizmo.dispose();
    this.unmount();
  }
}

const kv = (k, v, mono) => {
  const row = el('div', 'dev-kv');
  row.append(el('span', 'dev-k', k), el('span', mono ? 'dev-v mono' : 'dev-v', String(v)));
  return row;
};
const fmt = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? +x.toFixed(1) : x)).join(', ') : String(v));
function tryCall(fn) { try { return fn(); } catch { return null; } }
