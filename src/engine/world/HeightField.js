import * as THREE from 'three';
import { HASH, NOISE } from '../shaders/index.js';

/**
 * Bakes a terrain heightfield on the GPU into a float texture — height in .r,
 * normal.xz in .gb, a surface mask in .a — then reads the height and mask back
 * to the CPU for collision and scattering. A second pass marches the field
 * toward the sun to bake self-shadowing and ambient occlusion.
 *
 * The terrain itself is supplied by the scene as GLSL, so every scene gets the
 * same machinery with its own landscape.
 */

function genFragment(opts) {
  return /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uWorld;
uniform float uOrigin;
uniform float uTexel;
${HASH}
${NOISE}
${opts.heightGlsl || 'float landHeight(vec2 p){ return 0.0; }'}
${opts.maskGlsl || 'float surfaceMask(vec2 wp, float h, vec3 n, float slope){ return 1.0; }'}

void main(){
  vec2 wp = vec2(uOrigin) + vUv * uWorld;
  float h = landHeight(wp);

  float e = uTexel;
  float hx = landHeight(wp + vec2(e, 0.0)) - landHeight(wp - vec2(e, 0.0));
  float hz = landHeight(wp + vec2(0.0, e)) - landHeight(wp - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx, 2.0*e, -hz));

  gl_FragColor = vec4(h, n.x, n.z, clamp(surfaceMask(wp, h, n, 1.0 - n.y), 0.0, 1.0));
}
`;
}

const SHADE_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uHeight;
uniform vec3  uSunDir;
uniform float uWorld;
uniform float uOrigin;
uniform float uSoft;

float hAt(vec2 wp){
  vec2 uv = clamp((wp - vec2(uOrigin)) / uWorld, 0.0005, 0.9995);
  return texture2D(uHeight, uv).r;
}

void main(){
  vec2 wp = vec2(uOrigin) + vUv * uWorld;
  float h0 = hAt(wp);

  // ---- sun visibility by marching the heightfield toward the sun -----------
  vec3 sd = normalize(uSunDir);
  float vis = 1.0;
  if(sd.y > 0.008){
    vec2 dir = normalize(sd.xz + 1e-6);
    float rise = sd.y / max(length(sd.xz), 0.02);
    float t = 3.0;
    float step = 3.5;
    for(int i=0;i<56;i++){
      vec2 sp = wp + dir * t;
      float sh = hAt(sp);
      float ray = h0 + rise * t + 1.2;
      float d = sh - ray;
      if(d > 0.0){
        vis = min(vis, 1.0 - clamp(d / uSoft, 0.0, 1.0));
        if(vis <= 0.0) break;
      }
      t += step;
      step *= 1.075;
      if(t > 1400.0) break;
    }
  } else {
    vis = 0.0;
  }
  vis = clamp(vis, 0.0, 1.0);

  // ---- coarse ambient occlusion from local concavity ------------------------
  float acc = 0.0, wsum = 0.0;
  for(int i=0;i<10;i++){
    float fi = float(i);
    float a = fi * 2.3999632;
    float rad = 6.0 + fi*9.5;
    vec2 o = vec2(cos(a), sin(a)) * rad;
    float hh = hAt(wp + o);
    float w = 1.0/(1.0 + rad*0.05);
    acc += max(hh - h0, 0.0) / rad * w;
    wsum += w;
  }
  float ao = 1.0 - clamp(acc/wsum * 2.1, 0.0, 0.85);

  gl_FragColor = vec4(vis, ao, 0.0, 1.0);
}
`;

const BLUR_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main(){
  vec4 s = texture2D(uTex, vUv) * 0.2270270270;
  s += (texture2D(uTex, vUv + uDir*1.3846153846) + texture2D(uTex, vUv - uDir*1.3846153846)) * 0.3162162162;
  s += (texture2D(uTex, vUv + uDir*3.2307692308) + texture2D(uTex, vUv - uDir*3.2307692308)) * 0.0702702703;
  gl_FragColor = s;
}
`;

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class HeightField {
  /**
   * @param opts.size        texels per side
   * @param opts.world       world units covered (centred on origin)
   * @param opts.origin      world coordinate of the min corner
   * @param opts.waterLevel  height below which water can exist
   * @param opts.heightGlsl  must define: float landHeight(vec2 p)
   * @param opts.maskGlsl    must define: float surfaceMask(vec2, float, vec3, float)
   * @param opts.shadowSoft  metres of penumbra in the baked sun pass
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.size = opts.size ?? 2048;
    this.world = opts.world ?? 4096;
    this.origin = opts.origin ?? -this.world / 2;
    this.waterLevel = opts.waterLevel ?? 0;
    this.texel = this.world / this.size;
    const SIZE = this.size;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.quadGeo, null);
    this.scene.add(this.mesh);

    const gl = renderer.getContext();
    this.floatLinear = !!gl.getExtension('OES_texture_float_linear');
    const filter = this.floatLinear ? THREE.LinearFilter : THREE.NearestFilter;

    const rtOpts = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.heightRT = new THREE.WebGLRenderTarget(SIZE, SIZE, rtOpts);

    const shadeOpts = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.shadeSize = opts.shadeSize ?? 1024;
    this.shadeRT = new THREE.WebGLRenderTarget(this.shadeSize, this.shadeSize, shadeOpts);
    this.shadeRT2 = new THREE.WebGLRenderTarget(this.shadeSize, this.shadeSize, shadeOpts);

    this.genMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: genFragment(opts), depthTest: false, depthWrite: false,
      uniforms: {
        uWorld: { value: this.world }, uOrigin: { value: this.origin }, uTexel: { value: this.texel },
      },
    });
    this.shadeMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: SHADE_FS, depthTest: false, depthWrite: false,
      uniforms: {
        uHeight: { value: this.heightRT.texture },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uWorld: { value: this.world }, uOrigin: { value: this.origin },
        uSoft: { value: opts.shadowSoft ?? 26.0 },
      },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: BLUR_FS, depthTest: false, depthWrite: false,
      uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
    });

    this.data = null;
    this._sunKey = '';
  }

  _blit(material, target) {
    this.mesh.material = material;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
  }

  bake() {
    this._blit(this.genMat, this.heightRT);
    // pull the height channel down to the CPU for collision + scattering
    const S = this.size;
    const buf = new Float32Array(S * S * 4);
    this.renderer.readRenderTargetPixels(this.heightRT, 0, 0, S, S, buf);
    const h = new Float32Array(S * S);
    const mask = new Float32Array(S * S);
    for (let i = 0, n = S * S; i < n; i++) {
      h[i] = buf[i * 4];
      mask[i] = buf[i * 4 + 3];
    }
    this.data = h;
    this.mask = mask;
  }

  updateShading(sunDir, force = false) {
    // The march is 56 taps per texel at 1024^2 - far too heavy to redo every
    // frame while the clock is running, and imperceptible if we lag slightly.
    const q = 140;
    const key = `${Math.round(sunDir.x * q)},${Math.round(sunDir.y * q)},${Math.round(sunDir.z * q)}`;
    const now = performance.now();
    if (!force) {
      if (key === this._sunKey) return;
      if (now - (this._lastBake || -1e9) < 110) return;
    }
    this._lastBake = now;
    this._sunKey = key;
    this.shadeMat.uniforms.uSunDir.value.copy(sunDir);
    this._blit(this.shadeMat, this.shadeRT);
    const px = 1 / this.shadeSize;
    this.blurMat.uniforms.uTex.value = this.shadeRT.texture;
    this.blurMat.uniforms.uDir.value.set(px, 0);
    this._blit(this.blurMat, this.shadeRT2);
    this.blurMat.uniforms.uTex.value = this.shadeRT2.texture;
    this.blurMat.uniforms.uDir.value.set(0, px);
    this._blit(this.blurMat, this.shadeRT);
  }

  // --- CPU sampling (bilinear, matches the GPU field closely) ---------------
  heightAt(x, z) {
    const d = this.data;
    if (!d) return 0;
    const S = this.size;
    let u = (x - this.origin) / this.world * S - 0.5;
    let v = (z - this.origin) / this.world * S - 0.5;
    u = Math.min(Math.max(u, 0), S - 1.001);
    v = Math.min(Math.max(v, 0), S - 1.001);
    const i = u | 0, j = v | 0;
    const fu = u - i, fv = v - j;
    const a = d[j * S + i], b = d[j * S + i + 1];
    const c = d[(j + 1) * S + i], e = d[(j + 1) * S + i + 1];
    return (a + (b - a) * fu) * (1 - fv) + (c + (e - c) * fu) * fv;
  }

  maskAt(x, z) {
    const d = this.mask;
    if (!d) return 0;
    const S = this.size;
    let u = (x - this.origin) / this.world * S - 0.5;
    let v = (z - this.origin) / this.world * S - 0.5;
    u = Math.min(Math.max(u, 0), S - 1.001);
    v = Math.min(Math.max(v, 0), S - 1.001);
    const i = u | 0, j = v | 0;
    const fu = u - i, fv = v - j;
    const a = d[j * S + i], b = d[j * S + i + 1];
    const c = d[(j + 1) * S + i], e = d[(j + 1) * S + i + 1];
    return (a + (b - a) * fu) * (1 - fv) + (c + (e - c) * fu) * fv;
  }

  normalAt(x, z, e = 2.0) {
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const n = new THREE.Vector3(-hx, 2 * e, -hz);
    return n.normalize();
  }

  slopeAt(x, z, e = 2.0) { return 1 - this.normalAt(x, z, e).y; }

  /** Uniform values a material needs to sample this field. */
  get uniformValues() {
    return {
      heightTex: this.heightRT.texture,
      shadowTex: this.shadeRT.texture,
      origin: this.origin, world: this.world,
      texel: 1 / this.size, waterLevel: this.waterLevel,
    };
  }

  dispose() {
    this.heightRT.dispose(); this.shadeRT.dispose(); this.shadeRT2.dispose();
    this.quadGeo.dispose();
    this.genMat.dispose(); this.shadeMat.dispose(); this.blurMat.dispose();
    this.data = null; this.mask = null;
  }
}
