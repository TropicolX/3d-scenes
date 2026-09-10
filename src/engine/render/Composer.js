import * as THREE from 'three';
import { HASH, NOISE, TONEMAP } from '../shaders/index.js';

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const MASK_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uSun;
uniform float uThreshold;
${TONEMAP}
void main(){
  vec4 s = texture2D(uScene, vUv);
  // alpha == 1 only where sky was drawn, so geometry punches the shafts out
  vec3 sky = s.rgb * s.a;
  float l = luma(sky);
  float w = smoothstep(uThreshold, uThreshold*2.2 + 0.25, l);
  // concentrate around the sun so the whole sky does not smear
  float d = length(vUv - uSun);
  w *= exp(-d*d*3.4);
  gl_FragColor = vec4(sky * w, 1.0);
}
`;

const RADIAL_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uSun;
uniform float uDensity;
uniform float uDecay;
uniform float uWeight;
uniform float uJitter;
${HASH}
void main(){
  vec2 uv = vUv;
  vec2 delta = (uv - uSun) * (uDensity / float(SAMPLES));
  float illum = 1.0;
  vec3 acc = vec3(0.0);
  uv -= delta * (hash12(gl_FragCoord.xy) * uJitter);
  for(int i=0;i<SAMPLES;i++){
    uv -= delta;
    acc += texture2D(uTex, uv).rgb * illum;
    illum *= uDecay;
  }
  gl_FragColor = vec4(acc * uWeight, 1.0);
}
`;

const BRIGHT_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;
${TONEMAP}
void main(){
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = luma(c);
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0*uKnee);
  soft = soft*soft / (4.0*uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

const DOWN_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main(){
  vec2 t = uTexel;
  vec3 a = texture2D(uTex, vUv + t*vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(uTex, vUv + t*vec2( 0.0, 2.0)).rgb;
  vec3 c = texture2D(uTex, vUv + t*vec2( 2.0, 2.0)).rgb;
  vec3 d = texture2D(uTex, vUv + t*vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(uTex, vUv).rgb;
  vec3 f = texture2D(uTex, vUv + t*vec2( 2.0, 0.0)).rgb;
  vec3 g = texture2D(uTex, vUv + t*vec2(-2.0,-2.0)).rgb;
  vec3 h = texture2D(uTex, vUv + t*vec2( 0.0,-2.0)).rgb;
  vec3 i = texture2D(uTex, vUv + t*vec2( 2.0,-2.0)).rgb;
  vec3 j = texture2D(uTex, vUv + t*vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(uTex, vUv + t*vec2( 1.0, 1.0)).rgb;
  vec3 l = texture2D(uTex, vUv + t*vec2(-1.0,-1.0)).rgb;
  vec3 m = texture2D(uTex, vUv + t*vec2( 1.0,-1.0)).rgb;
  vec3 res = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  gl_FragColor = vec4(res, 1.0);
}
`;

const UP_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uRadius;
void main(){
  vec2 t = uTexel * uRadius;
  vec3 s = texture2D(uTex, vUv + vec2(-t.x,  t.y)).rgb * 1.0;
  s += texture2D(uTex, vUv + vec2( 0.0,  t.y)).rgb * 2.0;
  s += texture2D(uTex, vUv + vec2( t.x,  t.y)).rgb * 1.0;
  s += texture2D(uTex, vUv + vec2(-t.x,  0.0)).rgb * 2.0;
  s += texture2D(uTex, vUv).rgb * 4.0;
  s += texture2D(uTex, vUv + vec2( t.x,  0.0)).rgb * 2.0;
  s += texture2D(uTex, vUv + vec2(-t.x, -t.y)).rgb * 1.0;
  s += texture2D(uTex, vUv + vec2( 0.0, -t.y)).rgb * 2.0;
  s += texture2D(uTex, vUv + vec2( t.x, -t.y)).rgb * 1.0;
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform float uBloomAmt;
uniform float uRayAmt;
uniform vec3  uRayTint;
uniform float uExposure;
${TONEMAP}
void main(){
  vec3 c = texture2D(uScene, vUv).rgb;
  c += texture2D(uBloom, vUv).rgb * uBloomAmt;
  c += texture2D(uRays, vUv).rgb * uRayTint * uRayAmt;
  c *= uExposure;
  c = aces(c);
  gl_FragColor = vec4(linearToSRGB(c), 1.0);
}
`;

const PAINT_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uTime;
uniform float uPainterly;
uniform float uBrush;
uniform float uPaper;
uniform float uVignette;
uniform float uAberration;
uniform float uSaturation;
uniform float uContrast;
uniform vec3  uLift;
uniform vec3  uGain;
${HASH}
${NOISE}
${TONEMAP}

vec3 fetch(vec2 uv){ return texture2D(uTex, uv).rgb; }

void main(){
  vec2 uv = vUv;
  vec2 px = 1.0 / uRes;
  vec2 fromC = uv - 0.5;
  float r2 = dot(fromC, fromC);

  // --- brush wobble: bend the sampling along a slow flow field --------------
  if(uBrush > 0.001){
    float sc = 3.2;
    float a = fbm2(uv*uRes.x*0.0042*sc + 13.0, 3) * 6.2831853;
    float amp = uBrush * 1.15;
    uv += vec2(cos(a), sin(a)) * px * amp;
  }

  vec3 col;
  // --- chromatic aberration -------------------------------------------------
  if(uAberration > 0.001){
    vec2 o = fromC * r2 * uAberration * 0.009;
    col = vec3(fetch(uv + o).r, fetch(uv).g, fetch(uv - o).b);
  } else {
    col = fetch(uv);
  }

#if KUW_R > 0
  if(uPainterly > 0.003){
    vec3 mean[4];
    vec3 sq[4];
    for(int q=0;q<4;q++){ mean[q] = vec3(0.0); sq[q] = vec3(0.0); }
    const float n = float((KUW_R+1)*(KUW_R+1));
    for(int y=0;y<=KUW_R;y++){
      for(int x=0;x<=KUW_R;x++){
        vec2 o = vec2(float(x), float(y)) * px;
        vec3 c0 = fetch(uv + vec2( o.x,  o.y));
        vec3 c1 = fetch(uv + vec2(-o.x,  o.y));
        vec3 c2 = fetch(uv + vec2(-o.x, -o.y));
        vec3 c3 = fetch(uv + vec2( o.x, -o.y));
        mean[0] += c0; sq[0] += c0*c0;
        mean[1] += c1; sq[1] += c1*c1;
        mean[2] += c2; sq[2] += c2*c2;
        mean[3] += c3; sq[3] += c3*c3;
      }
    }
    float best = 1e9;
    vec3 chosen = col;
    for(int q=0;q<4;q++){
      vec3 m = mean[q] / n;
      vec3 v = abs(sq[q]/n - m*m);
      float sigma = v.r + v.g + v.b;
      if(sigma < best){ best = sigma; chosen = m; }
    }
    col = mix(col, chosen, uPainterly);
  }
#endif

  // --- grade ---------------------------------------------------------------
  float l = luma(col);
  col = mix(vec3(l), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  col = col * uGain + uLift * (1.0 - col);
  col = clamp(col, 0.0, 1.0);

  // --- paper / canvas tooth -------------------------------------------------
  if(uPaper > 0.001){
    vec2 pp = uv * uRes / max(uRes.y, 1.0);
    float weave = sin(pp.x*1180.0)*sin(pp.y*1180.0);
    float fib = fbm2(pp*430.0, 2);
    float grain = fbm2(pp*96.0, 3);
    float tooth = weave*0.30 + fib*0.55 + grain*0.75;
    col *= 1.0 + tooth * uPaper * 0.115;
    col += vec3(0.020, 0.014, 0.006) * uPaper * grain;
  }

  // --- vignette -------------------------------------------------------------
  float vig = 1.0 - uVignette * smoothstep(0.16, 0.86, r2*1.5);
  col *= vig;

  // dither to kill banding in the sky gradients
  float d = hash12(gl_FragCoord.xy + fract(uTime)*17.0) - 0.5;
  col += d / 255.0;

  gl_FragColor = vec4(col, 1.0);
}
`;

class Pass {
  constructor(fs, uniforms, defines) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: fs, uniforms, defines: defines || {},
      depthTest: false, depthWrite: false,
    });
  }
}

export class Composer {
  constructor(renderer, params) {
    this.renderer = renderer;
    this.params = params;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const rt = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, Object.assign({
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    }, opts));
    this._rt = rt;

    this.sceneRT = rt(2, 2, { depthBuffer: true, samples: 4 });
    this.ldrRT = rt(2, 2, { type: THREE.UnsignedByteType });
    this.maskRT = rt(2, 2);
    this.rayA = rt(2, 2);
    this.rayB = rt(2, 2);
    this.brightRT = rt(2, 2);
    this.bloomMips = [];

    this.maskPass = new Pass(MASK_FS, {
      uScene: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uThreshold: { value: 0.85 },
    });
    this.radialPass = new Pass(RADIAL_FS, {
      uTex: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uDensity: { value: 0.55 }, uDecay: { value: 0.96 }, uWeight: { value: 0.06 },
      uJitter: { value: 1.0 },
    }, { SAMPLES: 32 });
    this.brightPass = new Pass(BRIGHT_FS, {
      uTex: { value: null }, uThreshold: { value: 0.85 }, uKnee: { value: 0.55 },
    });
    this.downPass = new Pass(DOWN_FS, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upPass = new Pass(UP_FS, {
      uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 },
    });
    this.compositePass = new Pass(COMPOSITE_FS, {
      uScene: { value: null }, uBloom: { value: null }, uRays: { value: null },
      uBloomAmt: { value: 0.9 }, uRayAmt: { value: 1.0 },
      uRayTint: { value: new THREE.Color(1, 0.86, 0.66) }, uExposure: { value: 1 },
    });
    this.paintPass = new Pass(PAINT_FS, {
      uTex: { value: null }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uPainterly: { value: 0.5 }, uBrush: { value: 0.6 }, uPaper: { value: 0.3 },
      uVignette: { value: 0.5 }, uAberration: { value: 0.35 },
      uSaturation: { value: 1.06 }, uContrast: { value: 1.04 },
      uLift: { value: new THREE.Color(0.020, 0.028, 0.045) },
      uGain: { value: new THREE.Color(1.02, 1.0, 0.965) },
    }, { KUW_R: 2 });

    this._sun4 = new THREE.Vector4();
  }

  setSize(w, h, dpr) {
    const W = Math.max(2, Math.floor(w * dpr));
    const H = Math.max(2, Math.floor(h * dpr));
    this.width = W; this.height = H;
    this.sceneRT.setSize(W, H);
    this.ldrRT.setSize(W, H);
    const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
    this.maskRT.setSize(hw, hh);
    this.rayA.setSize(hw, hh);
    this.rayB.setSize(hw, hh);
    this.brightRT.setSize(hw, hh);

    for (const m of this.bloomMips) m.dispose();
    this.bloomMips = [];
    let mw = hw, mh = hh;
    for (let i = 0; i < 5; i++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      this.bloomMips.push(this._rt(mw, mh));
    }
    this.paintPass.material.uniforms.uRes.value.set(W, H);
  }

  setKuwaharaRadius(r) {
    const m = this.paintPass.material;
    if (m.defines.KUW_R === r) return;
    m.defines.KUW_R = r;
    m.needsUpdate = true;
  }

  blit(pass, target) {
    this.quad.material = pass.material;
    this.renderer.setRenderTarget(target || null);
    this.renderer.render(this.scene, this.cam);
  }

  dispose() {
    for (const rt of [this.sceneRT, this.ldrRT, this.maskRT, this.rayA, this.rayB,
                      this.brightRT, ...this.bloomMips]) rt?.dispose?.();
    this.quad.geometry.dispose();
    for (const p of [this.maskPass, this.radialPass, this.brightPass, this.downPass,
                     this.upPass, this.compositePass, this.paintPass]) p.material.dispose();
  }

  render(camera, sunDir, atmo, time) {
    const p = this.params;
    const r = this.renderer;

    // --- sun position in screen space ---------------------------------------
    const sw = this._sun4.set(sunDir.x * 1e5, sunDir.y * 1e5, sunDir.z * 1e5, 1);
    sw.applyMatrix4(camera.matrixWorldInverse);
    const behind = sw.z > 0;
    sw.applyMatrix4(camera.projectionMatrix);
    const sx = sw.x / sw.w, sy = sw.y / sw.w;
    const sunUv = this.maskPass.material.uniforms.uSun.value;
    sunUv.set(sx * 0.5 + 0.5, sy * 0.5 + 0.5);
    this.radialPass.material.uniforms.uSun.value.copy(sunUv);

    const off = Math.max(Math.abs(sx), Math.abs(sy));
    let rayFade = behind ? 0 : (1 - THREE.MathUtils.smoothstep(off, 0.95, 2.4));
    rayFade *= THREE.MathUtils.smoothstep(sunDir.y, -0.09, 0.06);

    // --- god rays ------------------------------------------------------------
    const rayAmt = p.godrays * rayFade;
    if (rayAmt > 0.002) {
      this.maskPass.material.uniforms.uScene.value = this.sceneRT.texture;
      this.blit(this.maskPass, this.maskRT);
      const rp = this.radialPass.material.uniforms;
      rp.uTex.value = this.maskRT.texture;
      rp.uDensity.value = 0.62; rp.uDecay.value = 0.958; rp.uWeight.value = 0.055;
      this.blit(this.radialPass, this.rayA);
      rp.uTex.value = this.rayA.texture;
      rp.uDensity.value = 0.38; rp.uDecay.value = 0.974; rp.uWeight.value = 0.042;
      this.blit(this.radialPass, this.rayB);
    } else {
      r.setRenderTarget(this.rayB);
      r.setClearColor(0x000000, 1); r.clear(true, false, false);
    }

    // --- bloom ---------------------------------------------------------------
    this.brightPass.material.uniforms.uTex.value = this.sceneRT.texture;
    this.brightPass.material.uniforms.uThreshold.value = 1.15;
    this.blit(this.brightPass, this.brightRT);
    let src = this.brightRT;
    for (const mip of this.bloomMips) {
      this.downPass.material.uniforms.uTex.value = src.texture;
      this.downPass.material.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.blit(this.downPass, mip);
      src = mip;
    }
    this.upPass.material.uniforms.uRadius.value = 1.0;
    const up = this.upPass.material.uniforms;
    this.quad.material = this.upPass.material;
    for (let i = this.bloomMips.length - 1; i > 0; i--) {
      const from = this.bloomMips[i], to = this.bloomMips[i - 1];
      up.uTex.value = from.texture;
      up.uTexel.value.set(1 / from.width, 1 / from.height);
      r.setRenderTarget(to);
      r.autoClear = false;
      this.upPass.material.blending = THREE.AdditiveBlending;
      r.render(this.scene, this.cam);
      r.autoClear = true;
    }
    this.upPass.material.blending = THREE.NoBlending;
    up.uTex.value = this.bloomMips[0].texture;
    up.uTexel.value.set(1 / this.bloomMips[0].width, 1 / this.bloomMips[0].height);
    this.blit(this.upPass, this.brightRT);

    // --- composite + tonemap --------------------------------------------------
    const cu = this.compositePass.material.uniforms;
    cu.uScene.value = this.sceneRT.texture;
    cu.uBloom.value = this.brightRT.texture;
    cu.uRays.value = this.rayB.texture;
    cu.uBloomAmt.value = p.bloom;
    cu.uRayAmt.value = rayAmt * 0.68;
    cu.uRayTint.value.copy(atmo.sunColor).lerp(new THREE.Color(1, 1, 1), 0.18);
    cu.uExposure.value = atmo.exposure * p.exposure;
    this.blit(this.compositePass, this.ldrRT);

    // --- painterly finish ------------------------------------------------------
    const pu = this.paintPass.material.uniforms;
    pu.uTex.value = this.ldrRT.texture;
    pu.uTime.value = time;
    pu.uPainterly.value = p.painterly;
    pu.uBrush.value = p.brush;
    pu.uPaper.value = p.paper;
    pu.uVignette.value = p.vignette;
    pu.uAberration.value = p.aberration;
    pu.uSaturation.value = p.saturation;
    pu.uContrast.value = p.contrast;
    this.blit(this.paintPass, null);
  }
}
