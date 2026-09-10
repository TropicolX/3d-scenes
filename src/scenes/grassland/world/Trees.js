import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, WIND, SKY, FOG, HEIGHTFIELD, SHADOWMAP, CLOUDSHADOW } from '../../../engine/shaders/index.js';
import { FIELD } from '../field.js';

const VS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${WIND}
${HEIGHTFIELD}

attribute float aPart;   // 0 = trunk, 1 = canopy
attribute float aH;      // 0..1 height along the tree, drives sway
attribute vec3  aBlob;   // canopy blob centre, for rounded normals

attribute vec3 iPos;
attribute vec4 iRand;    // yaw, scaleXZ, scaleY, hue
attribute vec3 iTint;

uniform float uSway;
uniform float uCull;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTint;
varying float vPart;
varying float vDist;
varying float vAO;

void main(){
  float d = distance(iPos.xz, uCamPos.xz);
  if(d > uCull){ gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  float yaw = iRand.x * 6.2831853;
  float cs = cos(yaw), sn = sin(yaw);
  mat2 rot = mat2(cs, sn, -sn, cs);

  vec3 p = position;
  p.xz *= iRand.y;
  p.y  *= iRand.z;
  p.xz = rot * p.xz;

  vec3 nrm = normal;
  nrm.xz = rot * nrm.xz;

  // sway: whole trunk leans, canopy adds a lazy secondary wobble
  vec3 wind = windField(iPos.xz);
  float k = aH * aH;
  vec2 lean = wind.xy * uSway * (0.055 + 0.10*iRand.w);
  float t = uTime * (1.0 + iRand.x*0.4) + iPos.x*0.21 + iPos.z*0.17;
  vec2 wob = vec2(sin(t*1.15), cos(t*0.93)) * 0.05 * wind.z * uWindStrength * aPart;
  p.xz += (lean + wob) * k * (2.0 + 5.0*iRand.z);

  vec3 world = iPos + p;
  vWorld = world;
  vNormal = normalize(nrm);
  vTint = iTint;
  vPart = aPart;
  vAO = mix(0.34, 1.0, smoothstep(0.02, 0.72, aH));
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
uniform vec3 uBark;
uniform vec3 uLeafDark;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTint;
varying float vPart;
varying float vDist;
varying float vAO;

void main(){
  vec3 n = normalize(vNormal);
  if(!gl_FrontFacing) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = uSunDir;

  float clumps = fbm3(vWorld * 0.40, 3)*0.5 + 0.5;
  clumps = mix(clumps, fbm3(vWorld * 1.55, 2)*0.5 + 0.5, 0.38);
  // leaf mass gets lighter toward the crown and where the noise peaks
  float crown = smoothstep(-0.15, 0.85, n.y);
  vec3 leaf = mix(uLeafDark, vTint, smoothstep(0.12, 0.86, clumps*0.68 + crown*0.32));
  leaf *= 0.72 + 0.46*crown;
  vec3 base = mix(uBark * (0.7 + 0.5*clumps), leaf, vPart);

  float ndlS = dot(n, L);
  vec2 sh = sampleShade(vWorld.xz);
  float sunVis = sh.r * propShadow(vWorld, n, ndlS) * cloudShade(vWorld);

  float ndl = dot(n, L);
  float diff = pow(clamp(ndl*0.88 + 0.16, 0.0, 1.0), 1.30);
  vec3 sun = uSunColor * uSunIntensity * diff * sunVis;

  // leaves glow when the sun is behind the canopy
  float back = pow(clamp(-dot(V, L), 0.0, 1.0), 2.6);
  vec3 trans = uSunColor * mix(vTint, vec3(1.0), 0.2) * back * vPart * sunVis * uSunIntensity * 0.30;

  vec3 skyAmb = mix(uSkyHorizon, uSkyZenith, 0.72) * (0.30 + 0.34*max(n.y, 0.0)) * uAmbient;
  vec3 bnc = uBounce * 0.24 * uAmbient;

  // painterly rim so silhouettes stay readable against the haze
  float rim = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 rimc = mix(uSkyZenith, uSunColor, 0.50) * rim * 0.18 * uAmbient;

  vec3 col = base * (sun + skyAmb + bnc) * vAO + trans + rimc;
  col = applyAerial(col, uCamPos, -V, vDist);
  gl_FragColor = vec4(col, 0.0);
}
`;

const CAST_FS = /* glsl */ `
precision mediump float;
void main(){ gl_FragColor = vec4(1.0); }
`;

// --- geometry helpers -------------------------------------------------------
// Low-poly blob with *smooth* normals taken from the underlying ellipsoid, so
// the canopy reads as a soft painted mass instead of a faceted rock.
function icoBlob(radius, detail, squash, seed, wobble) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position');
  const nor = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const w = 1 + wobble * (Math.sin(n.x * 5.3 + seed) * Math.cos(n.y * 4.1 - seed * 1.7) * Math.sin(n.z * 6.2 + seed * 0.6));
    v.multiplyScalar(w);
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
    n.set(n.x, n.y / squash, n.z).normalize();
    nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

function trunkGeo(h, r0, r1, lean, sides = 7) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, 3, false);
  g.translate(0, h / 2, 0);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.y / h;
    v.x += lean * t * t * h * 0.4;
    v.z += lean * 0.4 * t * t * h * 0.3;
    const wob = 1 + 0.16 * Math.sin(v.y * 3.1 + Math.atan2(v.z, v.x) * 3.0);
    v.x *= wob; v.z *= wob;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function tagged(geo, part, totalH) {
  const n = geo.getAttribute('position').count;
  const aPart = new Float32Array(n);
  const aH = new Float32Array(n);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < n; i++) {
    aPart[i] = part;
    aH[i] = THREE.MathUtils.clamp(pos.getY(i) / totalH, 0, 1);
  }
  geo.setAttribute('aPart', new THREE.BufferAttribute(aPart, 1));
  geo.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
  return geo;
}

function ensureIndex(g) {
  if (!g.index) {
    const n = g.getAttribute('position').count;
    const a = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    g.setIndex(new THREE.BufferAttribute(a, 1));
  }
  return g;
}

function mergeGeos(list) {
  list = list.map(ensureIndex);
  let vc = 0, ic = 0;
  for (const g of list) { vc += g.getAttribute('position').count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
  const part = new Float32Array(vc), hh = new Float32Array(vc);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.getAttribute('position'), nn = g.getAttribute('normal');
    const pa = g.getAttribute('aPart'), ha = g.getAttribute('aH');
    const c = p.count;
    pos.set(p.array.subarray(0, c * 3), vo * 3);
    nor.set(nn.array.subarray(0, c * 3), vo * 3);
    part.set(pa.array.subarray(0, c), vo);
    hh.set(ha.array.subarray(0, c), vo);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += c; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  out.setAttribute('aH', new THREE.BufferAttribute(hh, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function broadleaf(rng) {
  const H = 7.4;
  const parts = [tagged(trunkGeo(H * 0.46, 0.46, 0.26, 0.13 * (rng() - 0.5)), 0, H)];
  const blobs = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng() * 1.4;
    const rad = 2.05 + rng() * 1.15;
    const g = icoBlob(rad, 2, 0.70 + rng() * 0.22, rng() * 10, 0.19);
    const r = i === 0 ? 0 : 1.35 + rng() * 1.05;
    g.translate(Math.cos(a) * r, H * 0.46 + 1.35 + rng() * 1.5 - (i === 0 ? 0 : 0.55), Math.sin(a) * r);
    parts.push(tagged(g, 1, H));
  }
  return mergeGeos(parts);
}

function conifer(rng) {
  const H = 11.0;
  const parts = [tagged(trunkGeo(H * 0.95, 0.34, 0.10, 0.03 * (rng() - 0.5), 6), 0, H)];
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const rad = 2.65 * (1 - t * 0.80) + 0.22;
    const g = new THREE.ConeGeometry(rad, 3.0 - t * 1.15, 11, 1, true);
    g.rotateY(rng() * 0.6);
    g.translate((rng() - 0.5) * 0.26, H * 0.20 + t * H * 0.66, (rng() - 0.5) * 0.26);
    parts.push(tagged(g, 1, H));
  }
  return mergeGeos(parts);
}

function bush(rng) {
  const H = 2.0;
  const parts = [];
  const blobs = 3;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng();
    const g = icoBlob(0.9 + rng() * 0.5, 1, 0.68, rng() * 10, 0.22);
    g.translate(Math.cos(a) * 0.55, 0.75 + rng() * 0.3, Math.sin(a) * 0.55);
    parts.push(tagged(g, 1, H));
  }
  return mergeGeos(parts);
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

export class Trees {
  constructor(shared, defines, field) {
    this.group = new THREE.Group();
    this.field = field;
    this.kinds = [];
    this.casters = [];

    const rng = mulberry(1337);
    const specs = [
      { geo: broadleaf(rng), n: 560, minS: 0.70, maxS: 1.60, tint: [0x5f8c3c, 0x4b7636, 0x779b44, 0x8d9c3c], cull: 900, hill: 0 },
      { geo: broadleaf(rng), n: 90, minS: 1.85, maxS: 2.85, tint: [0x4e7a38, 0x5f8c3c, 0x6b8f3a], cull: 1100, hill: 0 },
      { geo: conifer(rng), n: 360, minS: 0.65, maxS: 1.75, tint: [0x33603e, 0x27492f, 0x42704a], cull: 900, hill: 1 },
      { geo: bush(rng), n: 1000, minS: 0.6, maxS: 1.9, tint: [0x6d9445, 0x587f3c, 0x86a750], cull: 380, hill: 0 },
    ];

    this.uniforms = Object.assign({}, shared, {
      uSway: { value: 1 },
      uCull: { value: 900 },
      uBark: { value: new THREE.Color().setHex(0x5b4632, THREE.SRGBColorSpace) },
      uLeafDark: { value: new THREE.Color().setHex(0x1f3826, THREE.SRGBColorSpace) },
    });

    for (const spec of specs) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', spec.geo.getAttribute('position'));
      geo.setAttribute('normal', spec.geo.getAttribute('normal'));
      geo.setAttribute('aPart', spec.geo.getAttribute('aPart'));
      geo.setAttribute('aH', spec.geo.getAttribute('aH'));
      geo.setIndex(spec.geo.getIndex());

      const placed = this._scatter(spec.n, spec.hill, rng);
      const iPos = new Float32Array(placed.length * 3);
      const iRand = new Float32Array(placed.length * 4);
      const iTint = new Float32Array(placed.length * 3);
      const col = new THREE.Color();
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        iPos[i * 3] = p.x; iPos[i * 3 + 1] = p.y; iPos[i * 3 + 2] = p.z;
        const s = THREE.MathUtils.lerp(spec.minS, spec.maxS, rng());
        iRand[i * 4] = rng();
        iRand[i * 4 + 1] = s * (0.88 + rng() * 0.28);
        iRand[i * 4 + 2] = s;
        iRand[i * 4 + 3] = rng();
        col.setHex(spec.tint[(rng() * spec.tint.length) | 0], THREE.SRGBColorSpace);
        col.offsetHSL((rng() - 0.5) * 0.035, (rng() - 0.5) * 0.10, (rng() - 0.5) * 0.09);
        iTint[i * 3] = col.r; iTint[i * 3 + 1] = col.g; iTint[i * 3 + 2] = col.b;
      }
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
      geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 4));
      geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(iTint, 3));
      geo.instanceCount = placed.length;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      const uni = Object.assign({}, this.uniforms, { uCull: { value: spec.cull } });
      const mat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS, defines: Object.assign({}, defines || {}),
        uniforms: uni, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 15;
      this.group.add(mesh);

      const castUni = Object.assign({}, this.uniforms, { uCull: { value: Math.min(spec.cull, 300) } });
      const castMat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: CAST_FS, defines: Object.assign({}, defines || {}),
        uniforms: castUni, side: THREE.FrontSide,
      });
      const caster = new THREE.Mesh(geo, castMat);
      caster.frustumCulled = false;
      this.casters.push(caster);

      this.kinds.push({ mesh, mat, uni, total: placed.length, geo });
    }
  }

  _scatter(n, hillBias, rng) {
    const out = [];
    const f = this.field;
    let guard = 0;
    while (out.length < n && guard < n * 70) {
      guard++;
      const a = rng() * Math.PI * 2;
      const r = 60 + Math.pow(rng(), 0.62) * 1010;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // keep an open clearing around the spawn meadow
      if (Math.hypot(x - 150, z - 60) < 30) continue;
      const h = f.heightAt(x, z);
      if (h < FIELD.waterLevel + 1.6 || h > 175) continue;
      if (f.slopeAt(x, z, 4) > 0.34) continue;
      if (f.maskAt(x, z) < 0.28) continue;
      // clustered groves rather than an even sprinkle
      const cl = Math.sin(x * 0.0042 + 1.3) * Math.cos(z * 0.0037 - 0.7)
        + 0.6 * Math.sin(x * 0.011 - 2.1) * Math.cos(z * 0.0094 + 1.9);
      const want = hillBias ? (h - 45) / 90 : 0.5;
      if (rng() > THREE.MathUtils.clamp(0.30 + cl * 0.55 + want * 0.35, 0.03, 1)) continue;
      out.push({ x, y: h - 0.35, z });
    }
    return out;
  }

  update(params) {
    for (const k of this.kinds) {
      k.geo.instanceCount = Math.floor(k.total * THREE.MathUtils.clamp(params.trees, 0, 1.6));
      k.uni.uSway.value = 1;
    }
  }
}
