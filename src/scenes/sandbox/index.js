import * as THREE from 'three';
import { Scene } from '../../engine/Scene.js';
import { FlyWalkController } from '../../engine/FlyWalkController.js';
import { group, slider, toggle, segment, action, readout } from '../../engine/Params.js';

const DIR = 'src/scenes/sandbox';

const SKY_VS = /* glsl */ `
varying vec3 vRay;
uniform mat4 uInvProj, uCamWorld;
void main(){
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vRay = mat3(uCamWorld) * normalize(v.xyz / v.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const SKY_FS = /* glsl */ `
precision highp float;
varying vec3 vRay;
uniform vec3 uTop, uBottom, uHorizon;
void main(){
  vec3 rd = normalize(vRay);
  float t = clamp(rd.y, -1.0, 1.0);
  vec3 c = mix(uHorizon, uTop, 1.0 - pow(1.0 - clamp(t, 0.0, 1.0), 2.4));
  c = mix(c, uBottom, smoothstep(0.0, -0.35, t));
  c += uHorizon * exp(-abs(t) * 14.0) * 0.18;
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * The smallest scene that still exercises the whole contract: schema-driven
 * params, a controller, dev nodes with pickable instances, and clean disposal.
 * Copy this folder, rename the id in scene.js, and build.
 */
export default class Sandbox extends Scene {
  constructor() {
    super();
    this.params = {
      sunAngle: 0.9,
      sunHeight: 0.55,
      spin: 0.35,
      grid: true,
      fog: 0.6,
      shape: 'mixed',
      fov: 62,
    };
    this.baselineParams = { ...this.params };
    this.props = [];
  }

  async init(ctx) {
    this.three = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.params.fov, 1, 0.1, 4000);
    Object.assign(this.params, ctx.store.get('params', {}));

    // --- sky ---------------------------------------------------------------
    this.skyUniforms = {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uTop: { value: new THREE.Color().setHex(0x2f5f9e, THREE.SRGBColorSpace) },
      uHorizon: { value: new THREE.Color().setHex(0xd9c9a8, THREE.SRGBColorSpace) },
      uBottom: { value: new THREE.Color().setHex(0x2a2b28, THREE.SRGBColorSpace) },
    };
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyUniforms,
      depthTest: false, depthWrite: false,
    }));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.userData.devPickable = false;
    this.three.add(this.sky);

    // --- ground ------------------------------------------------------------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x6f7a63, roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.ground = ground;
    this.grid = new THREE.GridHelper(600, 120, 0x8f9a84, 0x53604c);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.35;
    this.grid.position.y = 0.01;
    this.three.add(ground, this.grid);

    // --- lights ------------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xffe9c8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -60; cam.right = 60; cam.top = 60; cam.bottom = -60; cam.far = 320;
    this.hemi = new THREE.HemisphereLight(0x9dc0ee, 0x51553f, 0.85);
    this.three.add(this.sun, this.sun.target, this.hemi);
    this.three.fog = new THREE.Fog(0xc9c3b2, 60, 520);

    // --- a few props to click on -------------------------------------------
    this.propGroup = new THREE.Group();
    this.three.add(this.propGroup);
    this._buildProps();

    this.controller = new FlyWalkController(this.camera, ctx.input, {
      groundAt: () => 0, eye: 1.72, bounds: 260,
    });
    this.controller.placeAt(0, 26, { yaw: 0, pitch: -0.06 });

    ctx.renderer.shadowMap.enabled = true;
    ctx.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.schema = this._schema();
    this._registerNodes(ctx);
  }

  _buildProps() {
    for (const p of this.props) { p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    this.propGroup.clear();
    this.props = [];

    const makers = {
      box: (s) => new THREE.BoxGeometry(s, s * 1.4, s),
      sphere: (s) => new THREE.IcosahedronGeometry(s * 0.7, 2),
      cone: (s) => new THREE.ConeGeometry(s * 0.7, s * 1.8, 16),
      torus: (s) => new THREE.TorusKnotGeometry(s * 0.5, s * 0.17, 90, 12),
    };
    const kinds = this.params.shape === 'mixed' ? Object.keys(makers) : [this.params.shape];

    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 9 + (i % 3) * 5;
      const s = 1.1 + (i % 4) * 0.45;
      const kind = kinds[i % kinds.length];
      const mesh = new THREE.Mesh(makers[kind](s), new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.08 + (i / 9) * 0.5, 0.45, 0.55),
        roughness: 0.55, metalness: 0.05,
      }));
      mesh.position.set(Math.cos(a) * r, s * 0.9, Math.sin(a) * r);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${kind}-${i}`;
      this.propGroup.add(mesh);
      this.props.push({ mesh, kind, index: i, spin: 0.4 + (i % 5) * 0.22 });
    }
  }

  _schema() {
    return [
      group('Light', [
        slider('sunAngle', 'Sun azimuth', { min: 0, max: 6.283, step: 0.01, format: (v) => `${Math.round(v * 57.3)}°` }),
        slider('sunHeight', 'Sun height', { min: 0.05, max: 1, step: 0.01 }),
        slider('fog', 'Fog', { min: 0, max: 2, step: 0.01 }),
      ]),
      group('World', [
        segment('shape', 'Props', ['mixed', 'box', 'sphere', 'cone', 'torus'], {
          onChange: () => this._buildProps(),
        }),
        slider('spin', 'Spin', { min: 0, max: 2, step: 0.01 }),
        toggle('grid', 'Grid'),
        slider('fov', 'Field of view', { min: 30, max: 100, step: 1,
          format: (v) => `${Math.round(v)}°`, onChange: () => this._applyFov() }),
      ]),
      readout('Props', () => this.props.length),
      action('Reshuffle', () => this._buildProps()),
    ];
  }

  _applyFov() {
    this.camera.fov = this.params.fov;
    this.camera.updateProjectionMatrix();
  }

  update(dt, t) {
    const p = this.params;
    this.controller.fly = true;
    this.controller.update(dt);

    const d = new THREE.Vector3(
      Math.cos(p.sunAngle) * Math.sqrt(1 - p.sunHeight * p.sunHeight),
      p.sunHeight,
      Math.sin(p.sunAngle) * Math.sqrt(1 - p.sunHeight * p.sunHeight),
    ).normalize();
    this.sun.position.copy(d).multiplyScalar(120);
    this.sun.target.position.set(0, 0, 0);

    this.skyUniforms.uTop.value.setHSL(0.60, 0.55, 0.20 + p.sunHeight * 0.22);
    this.skyUniforms.uHorizon.value.setHSL(0.10 - p.sunHeight * 0.03, 0.42, 0.52 + p.sunHeight * 0.2);
    this.three.fog.near = 60;
    this.three.fog.far = THREE.MathUtils.lerp(1400, 180, Math.min(p.fog, 2) / 2);
    this.grid.visible = p.grid;

    for (const pr of this.props) {
      pr.mesh.rotation.y += dt * pr.spin * p.spin;
      pr.mesh.position.y = pr.mesh.geometry.boundingSphere
        ? pr.mesh.position.y
        : pr.mesh.position.y;
      pr.mesh.rotation.x = Math.sin(t * 0.4 + pr.index) * 0.08 * p.spin;
    }

    this.skyUniforms.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    this.skyUniforms.uCamWorld.value.copy(this.camera.matrixWorld);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.fov = this.params.fov;
    this.camera.updateProjectionMatrix();
  }

  render() {
    const r = this.ctx.renderer;
    r.setRenderTarget(null);
    r.setClearColor(0x11151a, 1);
    r.render(this.three, this.camera);
  }

  raycastGround(ray) {
    if (Math.abs(ray.direction.y) < 1e-5) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0 || t > 4000) return null;
    return ray.origin.clone().addScaledVector(ray.direction, t);
  }

  _registerNodes(ctx) {
    ctx.node({
      id: 'sky', name: 'Gradient sky', kind: 'system', object: this.sky,
      source: `${DIR}/index.js`, note: 'fullscreen shader, no geometry',
    });
    ctx.node({
      id: 'ground', name: 'Ground plane', kind: 'mesh', object: this.ground,
      source: `${DIR}/index.js`,
      pick: { surface: true, at: (p) => ({ label: `ground @ ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`, position: p.toArray(), radius: 2 }) },
    });
    ctx.node({
      id: 'grid', name: 'Grid', kind: 'fx', object: this.grid, source: `${DIR}/index.js`,
      target: this.params, params: [this.schema[1].items[2]],
    });
    ctx.node({
      id: 'props', name: 'Props', kind: 'props', object: this.propGroup,
      source: `${DIR}/index.js`,
      stats: () => ({ count: this.props.length, shape: this.params.shape }),
      target: this.params, params: this.schema[1].items.slice(0, 2),
      actions: { Reshuffle: () => this._buildProps() },
      pick: {
        at: (point) => {
          let best = null, bestD = 9 * 9;
          for (const pr of this.props) {
            const d = pr.mesh.position.distanceToSquared(point);
            if (d < bestD) { bestD = d; best = pr; }
          }
          if (!best) return null;
          return {
            label: `${best.kind} #${best.index}`,
            position: best.mesh.position.toArray(),
            instance: { index: best.index, kind: best.kind, name: best.mesh.name },
            radius: 2.4, height: 4,
          };
        },
      },
    });
    ctx.node({
      id: 'sun', name: 'Sun', kind: 'light', object: this.sun, source: `${DIR}/index.js`,
      target: this.params, params: this.schema[0].items,
    });
  }

  dispose() {
    this.ctx.store.set('params', this.params);
    this.ctx.renderer.shadowMap.enabled = false;
    this.three.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    });
  }
}
