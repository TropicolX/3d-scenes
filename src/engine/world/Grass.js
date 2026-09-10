import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, WIND, SKY, FOG, HEIGHTFIELD, SHADOWMAP, CLOUDSHADOW } from '../shaders/index.js';

const VS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${WIND}
${HEIGHTFIELD}

attribute vec2 iPos;
attribute vec4 iRand;

uniform float uExtent;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uBladeH;
uniform float uBladeW;
uniform float uDensity;
uniform float uHeightMul;
uniform float uPxScale;
uniform float uStiff;
uniform float uWidthBoost;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTangent;
varying float vT;
varying float vDist;
varying float vGust;
varying vec3 vTint;
varying float vAO;

void main(){
  float side = position.x;
  float t    = position.y;

  // --- wrap the blade into the tile nearest the camera ----------------------
  vec2 cam = uCamPos.xz;
  vec2 wxz = iPos + floor((cam - iPos) / uExtent + 0.5) * uExtent;

  float d = distance(wxz, cam);
  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, d);
  if(fade <= 0.001){ gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  vec4 f = sampleField(wxz);
  float dens = f.a;
  if(iRand.z > dens * uDensity){ gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  // tufts: neighbours inside a cell share height and colour
  vec2 cell = floor(wxz / 2.4);
  vec3 clump = hash32(cell);

  float hMul = (0.62 + 0.78*clump.x) * (0.72 + 0.56*iRand.y);
  float h = uBladeH * uHeightMul * hMul * mix(0.70, 1.0, dens);
  float w = uBladeW * (0.68 + 0.62*clump.y) * uWidthBoost;

  float yaw = iRand.x * 6.2831853 + clump.z * 1.4;
  vec2 fwd = vec2(cos(yaw), sin(yaw));
  vec2 sid = vec2(-fwd.y, fwd.x);

  // --- wind ----------------------------------------------------------------
  vec3 wind = windField(wxz);
  vGust = wind.z;
  float stiff = mix(1.0, 0.45, iRand.w);
  vec2 bend = wind.xy * 0.30 * stiff * uStiff;
  // per-blade flutter, strongest where the gust is
  float flut = sin(uTime*(5.0 + iRand.w*5.0) + iRand.x*40.0 + wxz.x*0.35 + wxz.y*0.27);
  bend += sid * flut * 0.055 * wind.z * uWindStrength * stiff;

  // natural resting arc
  float arc = 0.16 + 0.30*iRand.w;
  vec2 lean = fwd * arc + bend;
  float leanLen = length(lean);
  float shrink = 1.0 / sqrt(1.0 + leanLen*leanLen*1.5);

  float t2 = t*t;
  vec2 spine = lean * t2 * h;
  float spineY = h * t * shrink * (1.0 - 0.12*t2);

  // taper, with a screen-space width floor so far blades never sub-pixel out
  float width = w * (1.0 - t*0.78) * (1.0 - 0.25*t2);
  width = max(width, d * uPxScale);
  width *= fade;

  vec3 local = vec3(spine.x, spineY, spine.y) + vec3(sid.x, 0.0, sid.y) * (side * width);

  // lie the blade over with the ground
  vec3 gn = fieldNormal(f);
  local.xz += gn.xz * local.y * 0.85;

  vec3 world = vec3(wxz.x, f.r, wxz.y) + local;
  world.y -= 0.06;

  // --- shading frame --------------------------------------------------------
  vec2 dspine = lean * 2.0 * t * h;
  vec3 tang = normalize(vec3(dspine.x, h*shrink*(1.0 - 0.36*t2), dspine.y));
  vec3 sideV = vec3(sid.x, 0.0, sid.y);
  vec3 faceN = normalize(cross(tang, sideV));
  vNormal = normalize(faceN + sideV * side * 0.72);
  vTangent = tang;

  vTint = clump;
  vT = t;
  vAO = mix(0.30, 1.0, pow(t, 0.55));
  vWorld = world;
  vDist = d;
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
uniform vec3 uRootCol;
uniform vec3 uMidCol;
uniform vec3 uTipCol;
uniform vec3 uDryCol;
uniform float uTrans;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTangent;
varying float vT;
varying float vDist;
varying float vGust;
varying vec3 vTint;
varying float vAO;

void main(){
  vec3 n = normalize(vNormal);
  if(!gl_FrontFacing) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = uSunDir;

  // ---- colour: root -> tip, plus broad field variation ---------------------
  vec3 base = mix(uRootCol, uMidCol, smoothstep(0.0, 0.55, vT));
  base = mix(base, uTipCol, smoothstep(0.42, 1.0, vT));
  float field = fbm2(vWorld.xz*0.0037 + 51.0, 4);
  float field2 = fbm2(vWorld.xz*0.026 + 7.0, 3);
  // mid-scale patches keep the middle distance from flattening into turf
  float patchy = fbm2(vWorld.xz*0.0105 + 33.0, 3);
  base *= 0.88 + 0.26 * (patchy*0.5 + 0.5);
  base = mix(base, base*vec3(0.90, 1.04, 0.82), smoothstep(0.05, 0.45, patchy));
  base = mix(base, uDryCol, clamp(smoothstep(0.06, 0.52, field)*0.30 + field2*0.06, 0.0, 0.34));
  base *= 0.76 + 0.48*vTint.z;

  // ---- direct light --------------------------------------------------------
  vec2 sh = sampleShade(vWorld.xz);
  float sunVis = sh.r * propShadow(vWorld, n, dot(n, L)) * cloudShade(vWorld);
  float ao = mix(0.55, 1.0, sh.g) * vAO;

  float ndl = dot(n, L);
  float diff = pow(clamp(ndl*0.76 + 0.26, 0.0, 1.0), 1.3);
  // a field of grass reads as a flat texture once it is far enough away;
  // easing the per-blade contrast out stops distant blades from scribbling
  float far = smoothstep(35.0, 130.0, vDist);
  diff = mix(diff, 0.66, far*0.46);
  vec3 sun = uSunColor * uSunIntensity * diff * sunVis;

  // ---- transmission: the whole point of backlit grass ----------------------
  float back = pow(clamp(-dot(V, L), 0.0, 1.0), 2.3);
  float thin = smoothstep(0.05, 0.85, vT);
  float facing = clamp(-ndl, 0.0, 1.0);
  vec3 transTint = mix(uTipCol, vec3(0.95, 1.0, 0.72), 0.14);
  vec3 trans = uSunColor * transTint * back * (0.3 + 0.7*facing) * thin
             * sunVis * uSunIntensity * uTrans * 0.62;

  // ---- anisotropic sheen along the blade -----------------------------------
  vec3 H = normalize(V + L);
  float tdh = dot(normalize(vTangent), H);
  float sheen = pow(sqrt(max(1.0 - tdh*tdh, 0.0)), 46.0);
  vec3 spec = uSunColor * sheen * sunVis * uSunIntensity * 0.11 * thin * (1.0 - far*0.85);

  // ---- ambient -------------------------------------------------------------
  vec3 skyAmb = mix(uSkyHorizon, uSkyZenith, 0.72) * (0.34 + 0.36*max(n.y, 0.0)) * uAmbient;
  vec3 bnc = uBounce * 0.22 * uAmbient;

  vec3 col = base * (sun + skyAmb + bnc) * ao + trans + spec;

  // gust crests catch a touch more light so waves read across the field
  col += base * uSunColor * (vGust - 1.0) * 0.10 * sunVis * uSunIntensity * thin * (1.0 - far*0.6);

  col = applyAerial(col, uCamPos, -V, vDist);
  gl_FragColor = vec4(col, 0.0);
}
`;

function bladeGeometry(segments) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    if (i === segments) { pos.push(0, 1, 0); }
    else { pos.push(-1, t, 0); pos.push(1, t, 0); }
  }
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const a = (segments - 1) * 2, b = a + 1, tip = segments * 2;
  idx.push(a, tip, b);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class GrassLayer {
  constructor(shared, defines, opts) {
    const { count, extent, segments, bladeH, bladeW, widthBoost, fadeStart, fadeEnd, trans, stiff } = opts;
    const geo = new THREE.InstancedBufferGeometry();
    const blade = bladeGeometry(segments);
    geo.setAttribute('position', blade.getAttribute('position'));
    geo.setIndex(blade.getIndex());

    const iPos = new Float32Array(count * 2);
    const iRand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      iPos[i * 2] = Math.random() * extent;
      iPos[i * 2 + 1] = Math.random() * extent;
      iRand[i * 4] = Math.random();
      iRand[i * 4 + 1] = Math.random();
      iRand[i * 4 + 2] = Math.random();
      iRand[i * 4 + 3] = Math.random();
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 2));
    geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = Object.assign({}, shared, {
      uExtent: { value: extent },
      uFadeStart: { value: fadeStart },
      uFadeEnd: { value: fadeEnd },
      uBladeH: { value: bladeH },
      uBladeW: { value: bladeW },
      uWidthBoost: { value: widthBoost ?? 1 },
      uDensity: { value: 1 },
      uHeightMul: { value: 1 },
      uPxScale: { value: 0.0015 },
      uStiff: { value: stiff ?? 1 },
      uTrans: { value: trans ?? 1 },
      uRootCol: { value: new THREE.Color().setHex(0x2a4630, THREE.SRGBColorSpace) },
      uMidCol: { value: new THREE.Color().setHex(0x57893a, THREE.SRGBColorSpace) },
      uTipCol: { value: new THREE.Color().setHex(0x9ec254, THREE.SRGBColorSpace) },
      uDryCol: { value: new THREE.Color().setHex(0xa89a4c, THREE.SRGBColorSpace) },
    });

    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, defines: Object.assign({}, defines || {}),
      uniforms: this.uniforms, side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.material = mat;
    this.count = count;
  }
}

export const TIERS = {
  low: [
    { count: 26000, extent: 26, segments: 5, bladeH: 0.55, bladeW: 0.030, fadeStart: 7, fadeEnd: 12 },
    { count: 48000, extent: 74, segments: 4, bladeH: 0.66, bladeW: 0.038, fadeStart: 22, fadeEnd: 34 },
    { count: 62000, extent: 210, segments: 2, bladeH: 0.66, bladeW: 0.062, fadeStart: 42, fadeEnd: 132, trans: 0.7, stiff: 0.75 },
  ],
  medium: [
    { count: 56000, extent: 28, segments: 5, bladeH: 0.55, bladeW: 0.030, fadeStart: 8, fadeEnd: 13.5 },
    { count: 98000, extent: 78, segments: 4, bladeH: 0.66, bladeW: 0.038, fadeStart: 24, fadeEnd: 37 },
    { count: 128000, extent: 234, segments: 2, bladeH: 0.66, bladeW: 0.060, fadeStart: 48, fadeEnd: 150, trans: 0.7, stiff: 0.75 },
  ],
  high: [
    { count: 95000, extent: 30, segments: 5, bladeH: 0.55, bladeW: 0.029, fadeStart: 9, fadeEnd: 15 },
    { count: 152000, extent: 82, segments: 4, bladeH: 0.66, bladeW: 0.037, fadeStart: 26, fadeEnd: 41 },
    { count: 200000, extent: 262, segments: 2, bladeH: 0.66, bladeW: 0.058, fadeStart: 55, fadeEnd: 168, trans: 0.7, stiff: 0.75 },
  ],
  ultra: [
    { count: 165000, extent: 32, segments: 6, bladeH: 0.55, bladeW: 0.028, fadeStart: 10, fadeEnd: 17 },
    { count: 265000, extent: 90, segments: 4, bladeH: 0.66, bladeW: 0.036, fadeStart: 30, fadeEnd: 46 },
    { count: 300000, extent: 290, segments: 2, bladeH: 0.66, bladeW: 0.056, fadeStart: 62, fadeEnd: 195, trans: 0.7, stiff: 0.75 },
  ],
};

/**
 * Wrapping instanced grass. Each layer is a tile that repeats to the copy
 * nearest the camera, so the field is endless with no popping; blades read
 * height, ground normal and density straight from the heightfield.
 *
 * @param opts.tiers   per-quality layer configs (defaults to TIERS below)
 * @param opts.colors  { root, mid, tip, dry } as THREE.Color
 */
export class Grass {
  constructor(shared, defines, opts = {}) {
    this.shared = shared;
    this.defines = defines;
    this.tiers = opts.tiers || TIERS;
    this.colors = opts.colors || null;
    this.group = new THREE.Group();
    this.layers = [];
    this.quality = null;
    this.setQuality(opts.quality || 'high');
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    for (const l of this.layers) {
      this.group.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.material.dispose();
    }
    this.layers = (this.tiers[q] || this.tiers.high).map((o) => {
      const l = new GrassLayer(this.shared, this.defines, o);
      if (this.colors) {
        for (const [k, name] of [['root', 'uRootCol'], ['mid', 'uMidCol'], ['tip', 'uTipCol'], ['dry', 'uDryCol']]) {
          if (this.colors[k]) l.uniforms[name].value.copy(this.colors[k]);
        }
      }
      this.group.add(l.mesh);
      return l;
    });
  }

  dispose() {
    for (const l of this.layers) { l.mesh.geometry.dispose(); l.material.dispose(); }
    this.layers.length = 0;
  }

  update(params, pxScale) {
    for (const l of this.layers) {
      l.uniforms.uDensity.value = params.grassDensity;
      l.uniforms.uHeightMul.value = params.grassHeight;
      l.uniforms.uPxScale.value = pxScale;
    }
  }

  get bladeCount() { return this.layers.reduce((a, l) => a + l.count, 0); }
}
