import * as THREE from 'three';
import { Scene } from '../../engine/Scene.js';
import { FlyWalkController } from '../../engine/FlyWalkController.js';
import { HeightField } from '../../engine/world/HeightField.js';
import { Clipmap } from '../../engine/world/Clipmap.js';
import { Grass } from '../../engine/world/Grass.js';
import { Sky } from '../../engine/world/Sky.js';
import { FIELD, HEIGHT_GLSL, MASK_GLSL } from './field.js';
import { SURFACE_GLSL, SURFACE_UNIFORMS } from './surface.js';
import { createShared, updateShared } from '../../engine/render/Uniforms.js';
import { sampleAtmosphere, sunDirection } from '../../engine/render/Atmosphere.js';
import { defaults, PRESETS, ATMOSPHERE, SUN_ARC } from './atmosphere.js';
import { buildSchema } from './params.js';
import { Trees } from './world/Trees.js';
import { Rocks } from './world/Props.js';
import { Water } from './world/Water.js';
import { Flowers } from './world/Flowers.js';
import { Motes } from './world/Motes.js';
import { Birds } from './world/Birds.js';
import { SunShadow } from '../../engine/render/SunShadow.js';
import { Composer } from '../../engine/render/Composer.js';

const DIR = 'src/scenes/grassland';

const VIEWPOINTS = {
  Meadow: { pos: [150, 60], sunOffset: -0.22 },
  Lakeside: { pos: [-430, 486], yaw: 0.05, pitch: -0.03 },
  Ridge: { pos: [330, -330], sunOffset: 0.15, pitch: 0.02 },
  Grove: { pos: [-250, -210], sunOffset: 0.75 },
  Foothills: { pos: [640, 560], sunOffset: -0.5 },
};

export default class Grassland extends Scene {
  constructor() {
    super();
    this.params = { ...defaults };
    this.baselineParams = { ...defaults };
    this.viewpoints = VIEWPOINTS;
    this.activePreset = 'Golden Hour';
    this.atmo = {};
    this.sunDir = new THREE.Vector3();
    this.windTime = 0;
    this.cinT = 0;
    this._disposers = [];
  }

  // ---- lifecycle ----------------------------------------------------------

  async init(ctx) {
    const { renderer, input } = ctx;
    this.three = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.params.fov, 1, 0.08, 6000);

    // saved tweaks survive a reload, per scene
    Object.assign(this.params, ctx.store.get('params', {}));

    ctx.setStatus('shaping the valley…');
    await frameBreak();

    this.field = new HeightField(renderer, {
      size: FIELD.size, world: FIELD.world, origin: FIELD.origin,
      waterLevel: FIELD.waterLevel,
      heightGlsl: HEIGHT_GLSL, maskGlsl: MASK_GLSL,
    });
    this.defines = this.field.floatLinear ? {} : { MANUAL_BILINEAR: 1 };
    this.field.bake();

    const shared = createShared({
      terrainOrigin: FIELD.origin, terrainSize: FIELD.world,
      terrainTexels: FIELD.size, waterLevel: FIELD.waterLevel,
    });
    shared.uHeightTex.value = this.field.heightRT.texture;
    shared.uShadowTex.value = this.field.shadeRT.texture;
    this.shared = shared;

    ctx.setStatus('raking the light…');
    await frameBreak();
    sunDirection(this.params.timeOfDay, SUN_ARC, this.sunDir);
    this.field.updateShading(this.sunDir, true);

    this.sky = new Sky(renderer, shared, this.params);
    this.terrain = new Clipmap(shared, this.defines, {
      surfaceGlsl: SURFACE_GLSL, uniforms: SURFACE_UNIFORMS,
      cells: 128, spacing: 1.0, levels: 6,
    });
    this.grass = new Grass(shared, this.defines, { quality: this.params.quality });
    this.water = new Water(shared, this.defines);
    this.motes = new Motes(shared);
    this.birds = new Birds(shared);

    this.three.add(this.sky.dome, this.terrain.group, this.water.mesh,
      this.grass.group, this.motes.mesh, this.birds.mesh);

    this.sunShadow = new SunShadow(renderer, 2048, 185);
    shared.uSunDepth.value = this.sunShadow.depth;
    shared.uSunMat.value = this.sunShadow.matrix;
    shared.uSunMapTexel.value = 1 / this.sunShadow.size;

    ctx.setStatus('planting the groves…');
    await frameBreak();
    this.trees = new Trees(shared, this.defines, this.field);
    this.rocks = new Rocks(shared, this.defines, this.field);
    this.flowers = new Flowers(shared, this.defines);
    this.three.add(this.trees.group, this.rocks.group, this.flowers.mesh);
    for (const c of this.trees.casters) this.sunShadow.add(c);
    for (const c of this.rocks.casters) this.sunShadow.add(c);
    this.sunShadow.ready = true;

    this.composer = new Composer(renderer, this.params);

    this.controller = new FlyWalkController(this.camera, input, {
      groundAt: (x, z) => this.field.heightAt(x, z),
      eye: 1.72,
      bounds: 1500,
    });
    this.goTo('Meadow');

    this.schema = buildSchema(this);
    this._bindKeys(ctx);
    this._registerNodes(ctx);
    sampleAtmosphere(ATMOSPHERE, this.params.timeOfDay, this.atmo);
  }

  dispose() {
    for (const d of this._disposers) d();
    this._disposers.length = 0;
    this.ctx.store.set('params', this.params);
    disposeTree(this.three);
    this.composer?.dispose?.();
    this.field?.dispose?.();
    this.sky?.dispose?.();
  }

  // ---- frame --------------------------------------------------------------

  update(dt) {
    const p = this.params;
    this.windTime += dt * p.windSpeed;

    if (p.timeFlow !== 0) {
      p.timeOfDay = (p.timeOfDay + dt * p.timeFlow * 0.35 + 24) % 24;
      this.ctx.app.ui?.sync('timeOfDay');
    }

    if (p.cinematic) {
      this.cinT += dt;
      this.controller.yaw += dt * 0.035;
      this.controller.pitch += Math.sin(this.cinT * 0.21) * dt * 0.012;
    }
    this.controller.autoForward = p.cinematic;
    this.controller.fly = p.fly;
    this.controller.update(dt);
    this.camera.updateMatrixWorld();

    const a = sampleAtmosphere(ATMOSPHERE, p.timeOfDay, this.atmo);
    sunDirection(p.timeOfDay, SUN_ARC, this.sunDir);
    updateShared(this.shared, p, this.windTime, this.camera, a, this.sunDir);
    this.field.updateShading(this.sunDir);

    this.terrain.update(this.camera);
    this.grass.update(p, this._pxScale());
    this.trees.update(p);
    this.flowers.update(p);
    this.motes.update(p);
    this.birds.update(p);
    this.sky.update(this.camera, this.atmo);
    this.sky.renderClouds();

    if (this.sunShadow.ready) {
      this.shared.uSunMapOn.value = this.sunShadow.update(this.sunDir, this.camera.position) ? 1 : 0;
      if (this.shared.uSunMapOn.value) this.sunShadow.render();
    }
  }

  render() {
    const { renderer } = this.ctx;
    renderer.setRenderTarget(this.composer.sceneRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.three, this.camera);
    renderer.setRenderTarget(null);
    this.composer.render(this.camera, this.sunDir, this.atmo, this.windTime);
  }

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, this.params.quality === 'ultra' ? 2 : 1.6);
    this.camera.aspect = w / h;
    this.camera.fov = this.params.fov;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h, dpr);
    this.sky.setSize(this.composer.width, this.composer.height);
  }

  _pxScale() {
    return (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5) / this.composer.height) * 0.85;
  }

  // ---- controls -----------------------------------------------------------

  _bindKeys(ctx) {
    const { input } = ctx;
    this._disposers.push(input.onKey((e) => {
      if (e.type !== 'keydown') return;
      const p = this.params;
      if (e.code === 'KeyF') { p.fly = !p.fly; ctx.app.ui?.sync('fly'); }
      else if (e.code === 'KeyC') { p.cinematic = !p.cinematic; ctx.app.ui?.sync('cinematic'); }
      else if (e.code === 'KeyR') { p.fov = defaults.fov; this.applyFov(); }
      else if (/^Digit[1-5]$/.test(e.code)) this.goTo(Object.keys(VIEWPOINTS)[+e.code.slice(5) - 1]);
    }));
    this._disposers.push(input.onWheel((e) => {
      // A scroll over any panel belongs to that panel, and a scroll while the
      // pointer isn't captured means the user is working the UI, not the camera.
      if (e.target?.closest?.('.ui-surface')) return;
      if (!input.locked) return;
      this.params.fov = THREE.MathUtils.clamp(this.params.fov + Math.sign(e.deltaY) * 2.5, 22, 100);
      this.applyFov();
    }));
  }

  applyFov() {
    this.camera.fov = this.params.fov;
    this.camera.updateProjectionMatrix();
    this.ctx.app.ui?.sync('fov');
  }

  setQuality(q) {
    this.params.quality = q;
    this.grass.setQuality(q);
    this.composer.setKuwaharaRadius(q === 'low' ? 0 : q === 'ultra' ? 3 : 2);
    this.ctx.app.resize();
  }

  applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(this.params, p);
    this.activePreset = name;
    this.ctx.app.ui?.sync();
  }

  resetParams() {
    Object.assign(this.params, defaults);
    this.activePreset = 'Golden Hour';
    this.setQuality(this.params.quality);
    this.applyFov();
    this.ctx.app.ui?.sync();
  }

  goTo(name) {
    const v = VIEWPOINTS[name];
    if (!v) return;
    sunDirection(this.params.timeOfDay, SUN_ARC, this.sunDir);
    this.controller.placeAt(v.pos[0], v.pos[1]);
    if (v.sunOffset !== undefined) this.controller.lookAlong(this.sunDir, v.sunOffset, 0.35, -0.045);
    if (v.yaw !== undefined) this.controller.yaw = v.yaw;
    if (v.pitch !== undefined) this.controller.pitch = v.pitch;
  }

  // ---- devtools integration ----------------------------------------------

  /** March the heightfield so dev-mode clicks land on the ground. */
  raycastGround(ray) {
    const o = ray.origin, d = ray.direction;
    let t = 0.5;
    for (let i = 0; i < 400; i++) {
      const step = Math.max(0.6, t * 0.035);
      t += step;
      if (t > 4000) break;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = this.field.heightAt(x, z);
      if (y - h <= 0) {
        // refine on the bracketing interval
        let lo = t - step, hi = t;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) * 0.5;
          const my = o.y + d.y * mid;
          if (my - this.field.heightAt(o.x + d.x * mid, o.z + d.z * mid) > 0) lo = mid; else hi = mid;
        }
        const f = (lo + hi) * 0.5;
        return new THREE.Vector3(o.x + d.x * f, o.y + d.y * f, o.z + d.z * f);
      }
    }
    return null;
  }

  _registerNodes(ctx) {
    const S = this.schema;
    const findGroup = (label) => S.find((i) => i.type === 'group' && i.label === label)?.items || [];

    ctx.node({
      id: 'sky', name: 'Sky & clouds', kind: 'system', object: this.sky.dome,
      source: 'src/engine/world/Sky.js',
      note: 'analytic gradient + half-res cloud march; also drives cloud shadows',
      target: this.params,
      params: [findGroup('Light')[0], ...findGroup('Field').slice(4, 5)],
    });
    ctx.node({
      id: 'terrain', name: 'Terrain', kind: 'system', object: this.terrain.group,
      source: 'src/engine/world/Clipmap.js',
      note: '6-level clipmap over a baked heightfield',
      stats: () => ({ levels: this.terrain.levels.length }),
      pick: { surface: true, at: (p) => ({ label: `ground @ ${fmt(p)}`, position: p.toArray(), radius: 6 }) },
    });
    ctx.node({
      id: 'heightfield', name: 'Heightfield', kind: 'data',
      source: `${DIR}/field.js`,
      note: 'GPU-baked height/normal/grass-mask + sun visibility',
      stats: () => ({ size: FIELD.size, world: FIELD.world, waterLevel: FIELD.waterLevel }),
    });
    ctx.node({
      id: 'grass', name: 'Grass field', kind: 'system', object: this.grass.group,
      source: 'src/engine/world/Grass.js',
      note: 'three wrapping instanced LOD layers',
      stats: () => ({ blades: this.grass.bladeCount, layers: this.grass.layers.length }),
      target: this.params, params: findGroup('Field').slice(0, 2),
      pick: { surface: true, at: (p) => ({ label: `grass @ ${fmt(p)}`, position: p.toArray(), radius: 4 }) },
    });
    ctx.node({
      id: 'trees', name: 'Trees', kind: 'props', object: this.trees.group,
      source: `${DIR}/world/Trees.js`,
      note: 'instanced broadleaf / elder / conifer / bush',
      stats: () => ({ kinds: this.trees.kinds.length, instances: this.trees.kinds.reduce((a, k) => a + k.total, 0) }),
      target: this.params, params: [findGroup('Field')[3]],
      pick: { at: (p) => nearestInstance(this.trees.kinds, p, 12, 'tree') },
    });
    ctx.node({
      id: 'rocks', name: 'Rocks', kind: 'props', object: this.rocks.group,
      source: `${DIR}/world/Props.js`,
      stats: () => ({ instances: this.rocks.kinds.reduce((a, k) => a + k.total, 0) }),
      pick: { at: (p) => nearestInstance(this.rocks.kinds, p, 10, 'rock') },
    });
    ctx.node({
      id: 'water', name: 'Lake', kind: 'system', object: this.water.mesh,
      source: `${DIR}/world/Water.js`,
      stats: () => ({ centre: this.water.center.toArray(), level: FIELD.waterLevel }),
    });
    ctx.node({
      id: 'flowers', name: 'Flowers', kind: 'system', object: this.flowers.mesh,
      source: `${DIR}/world/Flowers.js`,
      target: this.params, params: [findGroup('Field')[2]],
    });
    ctx.node({
      id: 'motes', name: 'Pollen', kind: 'fx', object: this.motes.mesh,
      source: `${DIR}/world/Motes.js`,
      target: this.params, params: [findGroup('Field')[5]],
    });
    ctx.node({
      id: 'birds', name: 'Birds', kind: 'fx', object: this.birds.mesh,
      source: `${DIR}/world/Birds.js`,
      target: this.params, params: [findGroup('Render')[3]],
    });
    ctx.node({
      id: 'sunshadow', name: 'Sun shadow', kind: 'system',
      source: 'src/engine/render/SunShadow.js',
      note: 'single camera-following cascade for props',
      stats: () => ({ size: this.sunShadow.size, halfExtent: this.sunShadow.halfExtent }),
    });
    ctx.node({
      id: 'post', name: 'Post stack', kind: 'post',
      source: 'src/engine/render/Composer.js',
      note: 'god rays → bloom → ACES → painterly',
      target: this.params, params: findGroup('Paint'),
    });
    ctx.node({
      id: 'atmosphere', name: 'Atmosphere keys', kind: 'data',
      source: `${DIR}/atmosphere.js`,
      note: 'time-of-day keyframe table — the fastest way to change the whole look',
      target: this.params, params: findGroup('Light'),
    });
  }
}

// ---- helpers --------------------------------------------------------------

const frameBreak = () => new Promise((r) => setTimeout(r, 16));
const fmt = (p) => `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`;

/** Find the closest instance of a scattered prop to a world point. */
function nearestInstance(kinds, point, maxDist, label) {
  let best = null;
  let bestD = maxDist * maxDist;
  kinds.forEach((kind, ki) => {
    const attr = kind.geo.getAttribute('iPos');
    if (!attr) return;
    const a = attr.array;
    const n = Math.min(kind.geo.instanceCount ?? attr.count, attr.count);
    for (let i = 0; i < n; i++) {
      const dx = a[i * 3] - point.x;
      const dz = a[i * 3 + 2] - point.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = { kind: ki, index: i, position: [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]] };
      }
    }
  });
  if (!best) return null;
  return {
    label: `${label} #${best.index} (kind ${best.kind})`,
    position: best.position,
    instance: { kind: best.kind, index: best.index },
    radius: 3.5,
    height: 9,
  };
}

function disposeTree(root) {
  if (!root) return;
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
    else m?.dispose?.();
  });
}
