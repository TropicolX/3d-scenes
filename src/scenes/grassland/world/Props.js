import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, SKY, FOG, HEIGHTFIELD, SHADOWMAP, CLOUDSHADOW } from '../../../engine/shaders/index.js';
import { FIELD } from '../field.js';

const VS = /* glsl */ `
precision highp float;
${GLOBALS}
${HEIGHTFIELD}
attribute vec3 iPos;
attribute vec4 iRand;
attribute vec3 iTint;
uniform float uCull;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTint;
varying float vDist;
void main(){
  float d = distance(iPos.xz, uCamPos.xz);
  if(d > uCull){ gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float yaw = iRand.x * 6.2831853;
  float cs = cos(yaw), sn = sin(yaw);
  mat2 rot = mat2(cs, sn, -sn, cs);
  vec3 p = position * vec3(iRand.y, iRand.z, iRand.w);
  p.xz = rot * p.xz;
  vec3 nrm = normal / max(vec3(iRand.y, iRand.z, iRand.w), 0.001);
  nrm.xz = rot * nrm.xz;
  vec3 world = iPos + p;
  vWorld = world;
  vNormal = normalize(nrm);
  vTint = iTint;
  vDist = distance(world, uCamPos);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${SKY}
${FOG}
${HEIGHTFIELD}
${SHADOWMAP}
${CLOUDSHADOW}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTint;
varying float vDist;
void main(){
  vec3 n = normalize(vNormal);
  if(!gl_FrontFacing) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  float grain = fbm3(vWorld*1.35, 3)*0.5 + 0.5;
  vec3 base = vTint * (0.74 + 0.52*grain);
  // a little moss where the rock faces the sky
  base = mix(base, base*vec3(0.66,0.92,0.60), smoothstep(0.45, 0.95, n.y) * 0.35 * grain);

  vec2 sh = sampleShade(vWorld.xz);
  float ndlS = dot(n, uSunDir);
  float vis = sh.r * propShadow(vWorld, n, ndlS) * cloudShade(vWorld);
  float diff = pow(clamp(ndlS*0.85 + 0.17, 0.0, 1.0), 1.2);
  vec3 sun = uSunColor * uSunIntensity * diff * vis;
  vec3 skyAmb = mix(uSkyHorizon, uSkyZenith, 0.72) * (0.28 + 0.34*max(n.y,0.0)) * uAmbient;
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.4);
  vec3 col = base * (sun + skyAmb + uBounce*0.22*uAmbient) * mix(0.6, 1.0, sh.g)
           + mix(uSkyZenith, uSunColor, 0.4) * rim * 0.25 * uAmbient;
  col = applyAerial(col, uCamPos, -V, vDist);
  gl_FragColor = vec4(col, 0.0);
}
`;

const CAST_FS = /* glsl */ `
precision mediump float;
void main(){ gl_FragColor = vec4(1.0); }
`;

function rockGeo(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const w = 1
      + 0.30 * Math.sin(n.x * 3.1 + seed) * Math.cos(n.z * 2.7 - seed)
      + 0.16 * Math.sin(n.y * 6.3 - seed * 2.0)
      + 0.10 * Math.cos(n.x * 9.1 + n.z * 7.7 + seed);
    v.multiplyScalar(w);
    v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rocks {
  constructor(shared, defines, field) {
    this.group = new THREE.Group();
    this.casters = [];
    const rng = mulberry(90210);
    const tints = [0x8b8477, 0x6f6f6c, 0x9c9184, 0x7a7f7c];
    const specs = [
      { seed: 2.1, n: 340, s: [0.5, 2.1], cull: 520 },
      { seed: 5.7, n: 180, s: [1.6, 5.2], cull: 900 },
    ];
    this.kinds = [];
    for (const spec of specs) {
      const src = rockGeo(spec.seed, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', src.getAttribute('position'));
      geo.setAttribute('normal', src.getAttribute('normal'));
      if (src.index) geo.setIndex(src.getIndex());

      const pts = [];
      let guard = 0;
      while (pts.length < spec.n && guard < spec.n * 90) {
        guard++;
        const a = rng() * Math.PI * 2;
        const r = 40 + Math.pow(rng(), 0.55) * 1000;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = field.heightAt(x, z);
        if (h < FIELD.waterLevel - 1.0) continue;
        const slope = field.slopeAt(x, z, 3);
        if (rng() > 0.14 + slope * 2.4) continue;
        pts.push({ x, y: h, z });
      }
      const iPos = new Float32Array(pts.length * 3);
      const iRand = new Float32Array(pts.length * 4);
      const iTint = new Float32Array(pts.length * 3);
      const col = new THREE.Color();
      for (let i = 0; i < pts.length; i++) {
        const s = THREE.MathUtils.lerp(spec.s[0], spec.s[1], Math.pow(rng(), 1.6));
        iPos[i * 3] = pts[i].x; iPos[i * 3 + 1] = pts[i].y - s * 0.34; iPos[i * 3 + 2] = pts[i].z;
        iRand[i * 4] = rng();
        iRand[i * 4 + 1] = s * (0.8 + rng() * 0.5);
        iRand[i * 4 + 2] = s * (0.55 + rng() * 0.4);
        iRand[i * 4 + 3] = s * (0.8 + rng() * 0.5);
        col.setHex(tints[(rng() * tints.length) | 0], THREE.SRGBColorSpace);
        col.offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.10);
        iTint[i * 3] = col.r; iTint[i * 3 + 1] = col.g; iTint[i * 3 + 2] = col.b;
      }
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
      geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 4));
      geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(iTint, 3));
      geo.instanceCount = pts.length;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      const mat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS, defines: Object.assign({}, defines || {}),
        uniforms: Object.assign({}, shared, { uCull: { value: spec.cull } }),
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 14;
      this.group.add(mesh);

      const castMat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: CAST_FS, defines: Object.assign({}, defines || {}),
        uniforms: Object.assign({}, shared, { uCull: { value: Math.min(spec.cull, 260) } }),
      });
      const caster = new THREE.Mesh(geo, castMat);
      caster.frustumCulled = false;
      this.casters.push(caster);

      this.kinds.push({ mesh, geo, total: pts.length });
    }
  }
}
