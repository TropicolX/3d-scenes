import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, WIND, SKY, FOG, HEIGHTFIELD, SHADOWMAP, CLOUDSHADOW } from '../../../engine/shaders/index.js';

const VS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${WIND}
${HEIGHTFIELD}
attribute float aPart;   // 0 stem, 1 petal, 2 centre
attribute float aH;
attribute vec2  iPos;
attribute vec4  iRand;
uniform float uExtent;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uAmount;
uniform float uScale;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vPart;
varying float vDist;
varying vec3 vTint;
varying float vAO;

vec3 flowerHue(float k){
  if(k < 0.22) return vec3(0.96, 0.95, 0.90);   // chalk white
  if(k < 0.44) return vec3(0.99, 0.86, 0.42);   // buttercup
  if(k < 0.62) return vec3(0.95, 0.72, 0.80);   // pale pink
  if(k < 0.80) return vec3(0.74, 0.72, 0.95);   // lavender
  return vec3(0.98, 0.62, 0.42);                // ember orange
}

void main(){
  vec2 cam = uCamPos.xz;
  vec2 wxz = iPos + floor((cam - iPos) / uExtent + 0.5) * uExtent;
  float d = distance(wxz, cam);
  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, d);
  if(fade <= 0.002){ gl_Position = vec4(0.0,0.0,2.0,1.0); return; }

  vec4 f = sampleField(wxz);
  if(f.a < 0.45){ gl_Position = vec4(0.0,0.0,2.0,1.0); return; }

  // flowers grow in drifts, not evenly
  float drifting = fbm2(wxz*0.028 + 19.0, 3)*0.5 + 0.5;
  float drift = smoothstep(0.56, 0.84, drifting);
  if(iRand.z > drift * uAmount){ gl_Position = vec4(0.0,0.0,2.0,1.0); return; }

  float hue = fract(fbm2(wxz*0.006 + 71.0, 2)*0.5 + 0.5 + iRand.w*0.22);
  vTint = flowerHue(hue);

  float s = uScale * (0.72 + 0.55*iRand.y) * fade;
  vec3 p = position * s;

  // random head tilt
  float tl = (iRand.w - 0.5) * 0.9;
  float ct = cos(tl), st = sin(tl);
  if(aPart > 0.5){ p.yz = mat2(ct, st, -st, ct) * p.yz; }

  float yaw = iRand.x * 6.2831853;
  float cs = cos(yaw), sn = sin(yaw);
  p.xz = mat2(cs, sn, -sn, cs) * p.xz;
  vec3 nrm = normal;
  if(aPart > 0.5){ nrm.yz = mat2(ct, st, -st, ct) * nrm.yz; }
  nrm.xz = mat2(cs, sn, -sn, cs) * nrm.xz;

  vec3 wind = windField(wxz);
  float k = aH*aH;
  vec2 bend = wind.xy * 0.22;
  bend += vec2(sin(uTime*4.0 + iRand.x*30.0), cos(uTime*3.4 + iRand.y*24.0)) * 0.035 * wind.z * uWindStrength;
  p.xz += bend * k * s * 2.2;

  vec3 gn = fieldNormal(f);
  p.xz += gn.xz * p.y * 0.8;

  vWorld = vec3(wxz.x, f.r, wxz.y) + p;
  vNormal = normalize(nrm);
  vPart = aPart;
  vAO = mix(0.45, 1.0, aH);
  vDist = d;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
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
varying float vPart;
varying float vDist;
varying vec3 vTint;
varying float vAO;
void main(){
  vec3 n = normalize(vNormal);
  if(!gl_FrontFacing) n = -n;
  vec3 V = normalize(uCamPos - vWorld);

  vec3 base = vTint;
  if(vPart < 0.5) base = vec3(0.34, 0.46, 0.24);           // stem
  else if(vPart > 1.5) base = mix(vTint, vec3(0.95,0.78,0.30), 0.75); // eye

  vec2 sh0 = sampleShade(vWorld.xz);
  vec2 sh = vec2(sh0.r * propShadow(vWorld, n, dot(n, uSunDir)) * cloudShade(vWorld), sh0.g);
  float diff = pow(clamp(dot(n, uSunDir)*0.6 + 0.44, 0.0, 1.0), 1.1);
  vec3 sun = uSunColor * uSunIntensity * diff * sh.r;
  float back = pow(clamp(-dot(V, uSunDir), 0.0, 1.0), 2.4);
  vec3 trans = uSunColor * base * back * sh.r * uSunIntensity * 0.22 * step(0.5, vPart);
  vec3 skyAmb = mix(uSkyHorizon, uSkyZenith, 0.7) * (0.34 + 0.34*max(n.y,0.0)) * uAmbient;
  vec3 col = base * (sun + skyAmb + uBounce*0.2*uAmbient) * vAO + trans;
  col = applyAerial(col, uCamPos, -V, vDist);
  gl_FragColor = vec4(col, 0.0);
}
`;

function flowerGeometry() {
  const pos = [], nor = [], part = [], hh = [], idx = [];
  const H = 1.0;
  const push = (x, y, z, nx, ny, nz, p) => {
    pos.push(x, y, z); nor.push(nx, ny, nz); part.push(p); hh.push(THREE.MathUtils.clamp(y / H, 0, 1));
    return pos.length / 3 - 1;
  };
  // stem: two crossed quads so it reads from any angle
  for (let s = 0; s < 2; s++) {
    const a = s * Math.PI / 2;
    const dx = Math.cos(a) * 0.022, dz = Math.sin(a) * 0.022;
    const nx = -Math.sin(a), nz = Math.cos(a);
    const v0 = push(-dx, 0, -dz, nx, 0, nz, 0);
    const v1 = push(dx, 0, dz, nx, 0, nz, 0);
    const v2 = push(dx, H * 0.78, dz, nx, 0, nz, 0);
    const v3 = push(-dx, H * 0.78, -dz, nx, 0, nz, 0);
    idx.push(v0, v1, v2, v0, v2, v3);
  }
  // petals
  const P = 8;
  const y = H * 0.78;
  for (let i = 0; i < P; i++) {
    const a0 = (i / P) * Math.PI * 2;
    const a1 = ((i + 0.94) / P) * Math.PI * 2;
    const am = (a0 + a1) * 0.5;
    const r0 = 0.048, rm = 0.135, r1 = 0.175;
    const c = push(0, y, 0, 0, 1, 0, 1);
    const p0 = push(Math.cos(a0) * r0, y + 0.004, Math.sin(a0) * r0, 0, 1, 0, 1);
    const q0 = push(Math.cos(a0 * 0.5 + am * 0.5) * rm, y + 0.020, Math.sin(a0 * 0.5 + am * 0.5) * rm, 0, 1, 0, 1);
    const p1 = push(Math.cos(am) * r1, y + 0.026, Math.sin(am) * r1, 0, 1, 0, 1);
    const q1 = push(Math.cos(a1 * 0.5 + am * 0.5) * rm, y + 0.020, Math.sin(a1 * 0.5 + am * 0.5) * rm, 0, 1, 0, 1);
    const p2 = push(Math.cos(a1) * r0, y + 0.004, Math.sin(a1) * r0, 0, 1, 0, 1);
    idx.push(c, p0, q0, c, q0, p1, c, p1, q1, c, q1, p2);
  }
  // eye
  const cN = push(0, y + 0.030, 0, 0, 1, 0, 2);
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ring.push(push(Math.cos(a) * 0.055, y + 0.020, Math.sin(a) * 0.055, 0, 1, 0, 2));
  }
  for (let i = 0; i < 6; i++) idx.push(cN, ring[i], ring[(i + 1) % 6]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
  g.setIndex(idx);
  return g;
}

export class Flowers {
  constructor(shared, defines, count = 62000, extent = 88) {
    const src = flowerGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', src.getAttribute('position'));
    geo.setAttribute('normal', src.getAttribute('normal'));
    geo.setAttribute('aPart', src.getAttribute('aPart'));
    geo.setAttribute('aH', src.getAttribute('aH'));
    geo.setIndex(src.getIndex());

    const iPos = new Float32Array(count * 2);
    const iRand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      iPos[i * 2] = Math.random() * extent;
      iPos[i * 2 + 1] = Math.random() * extent;
      for (let k = 0; k < 4; k++) iRand[i * 4 + k] = Math.random();
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 2));
    geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = Object.assign({}, shared, {
      uExtent: { value: extent },
      uFadeStart: { value: 22 }, uFadeEnd: { value: 38 },
      uAmount: { value: 1 }, uScale: { value: 0.34 },
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, defines: Object.assign({}, defines || {}),
      uniforms: this.uniforms, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
  }
  update(params) { this.uniforms.uAmount.value = params.flowers * 0.55; }
}
