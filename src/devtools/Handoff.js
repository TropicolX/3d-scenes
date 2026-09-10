import { readValues, diffValues } from '../engine/Params.js';

/**
 * Turns "this thing, right here" into something an agent can act on.
 *
 * Writes a structured record plus a markdown summary and a screenshot into
 * .dev/ via the vite dev bridge, so Claude can read exactly what you pointed
 * at — source file, node id, instance index, world position, camera, and which
 * parameters you'd moved off their defaults.
 */
export class Handoff {
  constructor(app) {
    this.app = app;
    this.available = import.meta.env.DEV;
    this.last = null;
  }

  build({ selection = [], note = '', includeShot = true }) {
    const app = this.app;
    const scene = app.scenes.current;
    const manifest = app.scenes.currentManifest;
    const cam = scene?.camera;
    const ctl = scene?.controller;

    const params = scene?.schema && scene?.params ? readValues(scene.schema, scene.params) : null;
    const baseline = scene?.constructor?.defaults || scene?.baselineParams || null;

    return {
      ts: new Date().toISOString(),
      scene: manifest ? { id: manifest.id, name: manifest.name, dir: manifest.dir } : null,
      note: note.trim(),
      selection: selection.map((s) => ({
        id: s.node.id,
        name: s.node.name,
        kind: s.node.kind,
        source: s.node.source,
        sceneNote: s.node.note || undefined,
        stats: s.node.stats ? tryCall(s.node.stats) : undefined,
        label: s.label,
        worldPosition: s.point ? round3(s.point.toArray()) : undefined,
        instance: s.instance || undefined,
      })),
      camera: cam ? {
        position: round3(cam.position.toArray()),
        yaw: ctl ? +ctl.yaw.toFixed(3) : undefined,
        pitch: ctl ? +ctl.pitch.toFixed(3) : undefined,
        fov: +cam.fov.toFixed(1),
        fly: ctl?.fly ?? undefined,
      } : null,
      params,
      paramsChanged: baseline ? diffValues(scene.schema, scene.params, baseline) : undefined,
      viewport: { w: app.size.w, h: app.size.h, dpr: app.size.dpr, fps: app.state.fps },
      screenshot: includeShot ? app.dataURL(0.8) : undefined,
    };
  }

  toMarkdown(p) {
    const L = [];
    L.push(`# Handoff — ${p.scene?.name ?? 'unknown scene'}`);
    L.push('');
    L.push(`*${p.ts}*`);
    if (p.note) { L.push(''); L.push(`> ${p.note.replace(/\n/g, '\n> ')}`); }
    L.push('');
    if (p.selection.length) {
      L.push('## Selected');
      for (const s of p.selection) {
        L.push(`- **${s.name}** (\`${s.id}\`, ${s.kind}) — \`${s.source}\``);
        if (s.label) L.push(`  - hit: ${s.label}`);
        if (s.worldPosition) L.push(`  - world: \`[${s.worldPosition.join(', ')}]\``);
        if (s.instance) L.push(`  - instance: \`${JSON.stringify(s.instance)}\``);
        if (s.stats) L.push(`  - stats: \`${JSON.stringify(s.stats)}\``);
        if (s.sceneNote) L.push(`  - note: ${s.sceneNote}`);
      }
    } else {
      L.push('## Selected');
      L.push('- _nothing selected — this is a whole-scene note_');
    }
    L.push('');
    if (p.camera) {
      L.push('## Camera');
      L.push(`\`position [${p.camera.position.join(', ')}]  yaw ${p.camera.yaw}  pitch ${p.camera.pitch}  fov ${p.camera.fov}${p.camera.fly ? '  (flying)' : ''}\``);
      L.push('');
    }
    const changed = p.paramsChanged && Object.keys(p.paramsChanged).length ? p.paramsChanged : null;
    if (changed) {
      L.push('## Params moved off default');
      for (const [k, v] of Object.entries(changed)) L.push(`- \`${k}\`: ${fmtv(v.from)} → **${fmtv(v.to)}**`);
      L.push('');
    }
    if (p.params) {
      L.push('<details><summary>All current params</summary>');
      L.push('');
      L.push('```json');
      L.push(JSON.stringify(p.params, null, 2));
      L.push('```');
      L.push('</details>');
    }
    return L.join('\n');
  }

  async send(opts) {
    const payload = this.build(opts);
    payload.markdown = this.toMarkdown(payload);
    this.last = payload;

    let written = null;
    if (this.available) {
      try {
        const res = await fetch('/__dev/handoff', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) written = await res.json();
      } catch (e) {
        console.warn('[handoff] dev bridge unavailable', e);
      }
    }

    try { await navigator.clipboard?.writeText(payload.markdown); } catch {}
    return { payload, written };
  }

  async saveOverrides(sceneId, params) {
    if (!this.available) return null;
    try {
      const res = await fetch('/__dev/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scene: sceneId, params }),
      });
      return res.ok ? res.json() : null;
    } catch { return null; }
  }
}

const round3 = (a) => a.map((v) => +v.toFixed(2));
const fmtv = (v) => (typeof v === 'number' ? +v.toFixed(3) : JSON.stringify(v));
function tryCall(fn) { try { return fn(); } catch { return undefined; } }
