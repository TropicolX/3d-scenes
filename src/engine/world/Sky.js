import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, SKY } from '../shaders/index.js';

const RAY_VS = /* glsl */ `
varying vec3 vRay;
varying vec2 vUv;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
void main(){
  vUv = uv;
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vec3 dirView = normalize(v.xyz / v.w);
  vRay = mat3(uCamWorld) * dirView;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const CLOUD_FS = /* glsl */ `
precision highp float;
varying vec3 vRay;
uniform float uCoverage;
uniform float uCloudSpeed;
uniform vec3  uCirrusTint;
${GLOBALS}
${HASH}
${NOISE}
${SKY}

uniform float uCloudBase;
uniform float uCloudTop;
const int   SHELLS = 22;
#define BASE uCloudBase
#define TOP uCloudTop

// Coverage drives how tall the column grows, so clouds billow instead of
// forming a slab; 3D detail then erodes the tops.
float cloudCover(vec2 q){
  float c = fbm2(q, 4)*0.5 + 0.5;
  return smoothstep(uCloudCov, uCloudCov + 0.135, c);
}

float cloudDensity(vec3 p, float shell, float cIn){
  vec2 drift = uWindDir * uTime * uCloudSpeed;
  vec2 q = p.xz * 0.00085 - drift * 0.0011;
  float c = cIn >= 0.0 ? cIn : cloudCover(q);
  if(c <= 0.002) return 0.0;

  float top = 0.20 + 0.80*c;
  float shape = smoothstep(0.0, 0.10, shell) * (1.0 - smoothstep(top*0.72, top + 0.06, shell));
  if(shape <= 0.001) return 0.0;

  float det = fbm3(vec3(q*4.2 + 7.0, shell*2.6 + uTime*0.010), 3);
  float wisp = fbm3(vec3(q*11.0 - 3.0, shell*5.0 - uTime*0.02), 2);
  float erode = det*0.62 + wisp*0.38;

  float d = shape * (c*0.55 + 0.45) - erode * (0.30 + 0.42*shell);
  return clamp(d * 2.1, 0.0, 1.0);
}

void main(){
  vec3 rd = normalize(vRay);
  vec4 acc = vec4(0.0);

  if(rd.y > 0.012 && uCoverage > 0.02){
    vec3 lit = uSunColor * (0.30 + uSunIntensity*0.78);
    vec3 shade = mix(uSkyZenith, uSkyHorizon, 0.22) * 0.34 + uSunColor * 0.03;
    vec2 sunFlat = normalize(uSunDir.xz + 1e-5);

    vec2 bp = mod(gl_FragCoord.xy, 4.0);
    float bayer = (
      mod(bp.x, 2.0) * 2.0 + mod(bp.y, 2.0) +
      floor(bp.x * 0.5) * 8.0 + floor(bp.y * 0.5) * 4.0
    );
    float jit = fract(bayer / 16.0 + hash12(floor(gl_FragCoord.xy / 4.0)) * 0.25);

    for(int i=0;i<SHELLS;i++){
      float fi = (float(i) + jit) / float(SHELLS);
      float h = mix(BASE, TOP, fi);
      float t = (h - uCamPos.y) / rd.y;
      if(t < 0.0 || t > 62000.0) continue;
      vec3 p = uCamPos + rd * t;
      float d = cloudDensity(p, fi, -1.0);
      if(d <= 0.002) continue;

      // light marches two steps toward the sun through the deck
      float a1 = cloudDensity(p + vec3(sunFlat.x, 0.0, sunFlat.y)*150.0, min(fi + 0.16, 1.0), -1.0);
      float a2 = cloudDensity(p + vec3(sunFlat.x, 0.0, sunFlat.y)*380.0, min(fi + 0.40, 1.0), -1.0);
      float light = exp(-(a1*1.5 + a2*1.0) * 1.9);
      light *= 0.10 + 0.90*smoothstep(0.0, 0.78, fi);

      vec3 col = mix(shade, lit, light);
      // silver lining where the sun grazes a cloud edge
      float rim = pow(max(dot(rd, uSunDir), 0.0), 9.0) * (1.0 - d);
      col += uSunColor * rim * (0.45 + light*0.8) * 1.6;

      float fade = smoothstep(0.010, 0.060, rd.y);
      float a = clamp(d * (7.0 / float(SHELLS)) * fade, 0.0, 1.0);
      acc.rgb += col * a * (1.0 - acc.a);
      acc.a   += a * (1.0 - acc.a);
      if(acc.a > 0.995) break;
    }

    // --- high cirrus veil ----------------------------------------------------
    float ct = (3100.0 - uCamPos.y) / rd.y;
    if(ct > 0.0 && ct < 90000.0){
      vec3 cp = uCamPos + rd*ct;
      vec2 cq = cp.xz * 0.00022 - uWindDir*uTime*uCloudSpeed*0.0028;
      float w = fbm2(vec2(cq.x*0.45, cq.y*2.6) + 22.0, 4)*0.5 + 0.5;
      w = smoothstep(0.60, 0.98, w) * smoothstep(0.02, 0.14, rd.y);
      float lightC = 0.55 + 0.45*pow(max(dot(rd,uSunDir),0.0), 3.0);
      vec3 cc = mix(uCirrusTint, uSunColor, lightC*0.65) * (1.0 + uSunIntensity*0.22);
      float ca = w * 0.22 * uCoverage;
      acc.rgb += cc * ca * (1.0 - acc.a);
      acc.a   += ca * (1.0 - acc.a);
    }
  }

  gl_FragColor = acc;
}
`;

const CLOUD_BLUR_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main(){
  vec4 s = texture2D(uTex, vUv) * 0.227027;
  s += (texture2D(uTex, vUv + uDir*1.384615) + texture2D(uTex, vUv - uDir*1.384615)) * 0.316216;
  s += (texture2D(uTex, vUv + uDir*3.230769) + texture2D(uTex, vUv - uDir*3.230769)) * 0.070270;
  gl_FragColor = s;
}
`;

const BLUR_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DOME_FS = /* glsl */ `
precision highp float;
varying vec3 vRay;
varying vec2 vUv;
uniform sampler2D uClouds;
${GLOBALS}
${HASH}
${NOISE}
${SKY}
uniform float uStars;
uniform float uStarBoost;

void main(){
  vec3 rd = normalize(vRay);
  vec3 col = skyGradient(rd);

  // stars fade in as the sun drops away
  if(uStars > 0.001 && rd.y > -0.02){
    vec2 sp = rd.xz / (abs(rd.y) + 0.28);
    vec2 cell = floor(sp * 34.0);
    vec2 f = fract(sp * 34.0);
    vec3 h = hash32(cell);
    float d = length(f - h.xy);
    float tw = 0.6 + 0.4*sin(uTime*1.7 + h.z*40.0);
    float s = smoothstep(0.10, 0.0, d) * step(0.86, h.z) * tw;
    col += vec3(0.85, 0.9, 1.0) * s * uStars * uStarBoost * smoothstep(0.0, 0.28, rd.y);
  }

  vec4 cl = texture2D(uClouds, vUv);
  vec3 sun = sunDisc(rd) * (1.0 - cl.a*0.93);
  col = col * (1.0 - cl.a) + cl.rgb;
  col += sun;

  // alpha drives the god-ray occlusion mask: thick cloud blocks the shafts
  gl_FragColor = vec4(col, 1.0 - cl.a);
}
`;

/**
 * Stylised analytic sky plus a half-resolution cloud march. Coverage noise
 * decides how tall each cloud column grows and 3D noise erodes the tops; the
 * same coverage drives ground cloud shadows through the shared uniforms.
 */
export class Sky {
  constructor(renderer, shared, params, opts = {}) {
    this.renderer = renderer;
    this.shared = shared;
    this.params = params;
    this.opts = opts;

    const rayU = {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
    };
    this.rayU = rayU;

    const rtOpts = {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    };
    this.cloudRT = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.cloudRT2 = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: BLUR_VS, fragmentShader: CLOUD_BLUR_FS,
      depthTest: false, depthWrite: false,
      uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
    });

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: RAY_VS, fragmentShader: CLOUD_FS,
      depthTest: false, depthWrite: false,
      uniforms: Object.assign({}, rayU, shared, {
        uCoverage: { value: 1 },
        uCloudSpeed: { value: opts.cloudSpeed ?? 22 },
        uCloudBase: { value: opts.cloudBase ?? 1250 },
        uCloudTop: { value: opts.cloudTop ?? 2050 },
        uCirrusTint: { value: (opts.cirrusTint || new THREE.Color(0.85, 0.88, 0.95)) },
      }),
    });

    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: RAY_VS, fragmentShader: DOME_FS,
      depthTest: false, depthWrite: false,
      uniforms: Object.assign({}, rayU, shared, {
        uClouds: { value: this.cloudRT.texture },
        uStars: { value: 0 },
        uStarBoost: { value: opts.stars ?? 1 },
      }),
    });

    const geo = new THREE.PlaneGeometry(2, 2);
    this.cloudScene = new THREE.Scene();
    this.cloudQuad = new THREE.Mesh(geo, this.cloudMat);
    this.cloudQuad.frustumCulled = false;
    this.cloudScene.add(this.cloudQuad);
    this.cloudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.dome = new THREE.Mesh(geo, this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.userData.devPickable = false;   // fullscreen quad, not a surface
  }

  setSize(w, h) {
    const cw = Math.max(2, Math.floor(w * 0.5));
    const ch = Math.max(2, Math.floor(h * 0.5));
    this.cloudRT.setSize(cw, ch);
    this.cloudRT2.setSize(cw, ch);
    this._px = new THREE.Vector2(1 / cw, 1 / ch);
  }

  dispose() {
    this.cloudRT.dispose(); this.cloudRT2.dispose();
    this.cloudMat.dispose(); this.domeMat.dispose(); this.blurMat.dispose();
    this.dome.geometry.dispose();
  }

  update(camera, atmo) {
    this.rayU.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.rayU.uCamWorld.value.copy(camera.matrixWorld);
    this.cloudMat.uniforms.uCoverage.value = this.params.clouds;
    const night = THREE.MathUtils.smoothstep(0.28 - this.shared.uSunDir.value.y, 0.0, 0.30);
    this.domeMat.uniforms.uStars.value = night;
  }

  renderClouds() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    this.cloudQuad.material = this.cloudMat;
    r.setRenderTarget(this.cloudRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(this.cloudScene, this.cloudCam);

    // two cheap half-res blur passes dissolve the dither into soft cloud edges
    this.cloudQuad.material = this.blurMat;
    this.blurMat.uniforms.uTex.value = this.cloudRT.texture;
    this.blurMat.uniforms.uDir.value.set(this._px.x, 0);
    r.setRenderTarget(this.cloudRT2);
    r.render(this.cloudScene, this.cloudCam);

    this.blurMat.uniforms.uTex.value = this.cloudRT2.texture;
    this.blurMat.uniforms.uDir.value.set(0, this._px.y);
    r.setRenderTarget(this.cloudRT);
    r.render(this.cloudScene, this.cloudCam);

    this.cloudQuad.material = this.cloudMat;
    r.setRenderTarget(prev);
  }
}
