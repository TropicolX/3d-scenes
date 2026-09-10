import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, SKY, FOG, HEIGHTFIELD, SHADOWMAP, CLOUDSHADOW } from '../shaders/index.js';

/**
 * Camera-following geometry clipmap over a baked heightfield.
 *
 * The engine owns the geometry, the LOD rings and all the lighting — sun,
 * baked terrain shadows, prop shadows, cloud shadows, ambient and aerial
 * perspective. The scene owns only what the ground looks like, supplied as a
 * GLSL function, so two scenes share one lighting model with different land.
 */

const SURFACE_SIGNATURE = /* glsl */ `
// Scenes must define:
//   void sceneSurface(vec2 wp, float height, vec3 n, float slope, float mask,
//                     float dist, out vec3 albedo, out float gloss, out float ao)
// gloss drives a sun sparkle, ao is multiplied into the final lighting.
`;

const VS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${HEIGHTFIELD}
uniform vec2  uCenter;
uniform float uSpacing;
uniform float uSkirt;
uniform float uLevelBias;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vMask;
varying float vDist;

void main(){
  vec2 wp = uCenter + position.xz;
  vec4 f = sampleField(wp);
  float y = f.r;
  vNormal = fieldNormal(f);
  vMask = f.a;
  // coarser rings sit a hair lower so the finer ring always wins the depth
  // test in the overlap band (no polygon offset: that buries ground cover)
  y -= uLevelBias;
  // skirt verts hang below the field so the world edge never shows through
  y -= uSkirt * position.y;
  vWorld = vec3(wp.x, y, wp.y);
  vDist = length(vWorld - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

function buildFS(surfaceGlsl, extraUniforms) {
  return /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${SKY}
${FOG}
${HEIGHTFIELD}
${SHADOWMAP}
${CLOUDSHADOW}
uniform float uDetail;
uniform float uDetailScale;
${extraUniforms}
${SURFACE_SIGNATURE}
${surfaceGlsl}

varying vec3 vWorld;
varying vec3 vNormal;
varying float vMask;
varying float vDist;

void main(){
  vec3 n = normalize(vNormal);
  vec2 wp = vWorld.xz;

  // ---- micro relief: perturb the normal so big flat cells still read -------
  float near = smoothstep(190.0, 14.0, vDist);
  if(near > 0.01 && uDetail > 0.001){
    float e = 0.9;
    float sc = uDetailScale;
    float d0 = fbm2(wp*sc, 3);
    float dx = fbm2((wp+vec2(e,0.0))*sc, 3) - d0;
    float dz = fbm2((wp+vec2(0.0,e))*sc, 3) - d0;
    n = normalize(n + vec3(-dx, 0.0, -dz) * uDetail * near * 2.4);
  }
  float slope = 1.0 - n.y;

  vec3 albedo; float gloss; float surfAO;
  sceneSurface(wp, vWorld.y, n, slope, vMask, vDist, albedo, gloss, surfAO);

  // ---- lighting ------------------------------------------------------------
  vec2 sh = sampleShade(wp);
  float ao = sh.g;
  float ndl = dot(n, uSunDir);
  float sunVis = sh.r * propShadow(vWorld, n, ndl) * cloudShade(vWorld);

  float wrapd = pow(clamp(ndl*0.86 + 0.16, 0.0, 1.0), 1.15);
  vec3 sun = uSunColor * uSunIntensity * wrapd * sunVis;

  vec3 skyAmb = mix(uSkyHorizon, uSkyZenith, 0.70) * (0.32 + 0.36*n.y) * uAmbient;
  vec3 bnc = uBounce * (0.24 * (1.0 - n.y*0.5)) * uAmbient;
  vec3 lightSum = sun + skyAmb + bnc;

  // stylised terminator: a warm rim band right where light dies
  float band = smoothstep(0.02, 0.26, wrapd) * (1.0 - smoothstep(0.26, 0.52, wrapd));
  lightSum += uSunColor * band * 0.16 * sunVis * uSunIntensity;

  vec3 outc = albedo * lightSum * mix(0.55, 1.0, ao) * surfAO;

  vec3 vdir = normalize(cameraPosition - vWorld);
  if(gloss > 0.001){
    vec3 hv = normalize(vdir + uSunDir);
    outc += uSunColor * pow(max(dot(n, hv), 0.0), 42.0) * gloss * sunVis * uSunIntensity * 0.6;
  }

  outc = applyAerial(outc, cameraPosition, -vdir, vDist);
  gl_FragColor = vec4(outc, 0.0);
}
`;
}

function buildLevel(level, cells, s0, levels) {
  const spacing = s0 * Math.pow(2, level);
  const half = cells / 2;
  const holeHalf = level === 0 ? -1 : (cells / 4 - 2);

  const pos = [];
  const idx = [];
  const map = new Map();
  const vid = (cx, cz, skirt) => {
    const key = `${cx}|${cz}|${skirt}`;
    let v = map.get(key);
    if (v === undefined) {
      v = pos.length / 3;
      pos.push(cx * spacing, skirt, cz * spacing);
      map.set(key, v);
    }
    return v;
  };

  for (let cz = -half; cz < half; cz++) {
    for (let cx = -half; cx < half; cx++) {
      if (holeHalf > 0 && cx >= -holeHalf && cx < holeHalf && cz >= -holeHalf && cz < holeHalf) continue;
      const a = vid(cx, cz, 0), b = vid(cx + 1, cz, 0), d = vid(cx, cz + 1, 0), e = vid(cx + 1, cz + 1, 0);
      idx.push(a, d, b, b, d, e);
    }
  }

  if (level === levels - 1) {
    for (let i = -half; i < half; i++) {
      const pairs = [
        [[i, -half], [i + 1, -half]],
        [[i + 1, half], [i, half]],
        [[-half, i + 1], [-half, i]],
        [[half, i], [half, i + 1]],
      ];
      for (const [p0, p1] of pairs) {
        const a = vid(p0[0], p0[1], 0), b = vid(p1[0], p1[1], 0);
        const c2 = vid(p0[0], p0[1], 1), d2 = vid(p1[0], p1[1], 1);
        idx.push(a, b, c2, b, d2, c2);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), cells * spacing);
  return { geo: g, spacing };
}

export class Clipmap {
  /**
   * @param opts.surfaceGlsl  scene ground shading (see SURFACE_SIGNATURE)
   * @param opts.uniforms     extra uniforms the surface function reads
   * @param opts.cells        grid cells per level side
   * @param opts.spacing      finest cell size, metres
   * @param opts.levels       LOD ring count; reach is cells * spacing * 2^(levels-1)
   */
  constructor(shared, defines, opts = {}) {
    const cells = opts.cells ?? 128;
    const s0 = opts.spacing ?? 1.0;
    const levels = opts.levels ?? 6;
    this.group = new THREE.Group();
    this.levels = [];
    this.cells = cells;

    const extra = Object.entries(opts.uniforms || {})
      .map(([k, u]) => `uniform ${glslType(u.value)} ${k};`).join('\n');
    const fs = buildFS(opts.surfaceGlsl || defaultSurface(), extra);

    const own = Object.assign({
      uDetail: { value: opts.detail ?? 1.0 },
      uDetailScale: { value: opts.detailScale ?? 0.42 },
    }, opts.uniforms || {});
    this.uniforms = own;

    for (let i = 0; i < levels; i++) {
      const { geo, spacing } = buildLevel(i, cells, s0, levels);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: fs, defines: Object.assign({}, defines || {}),
        uniforms: Object.assign({}, shared, own, {
          uCenter: { value: new THREE.Vector2() },
          uSpacing: { value: spacing },
          uSkirt: { value: i === levels - 1 ? (opts.skirt ?? 900) : 0 },
          uLevelBias: { value: i * (opts.levelBias ?? 0.07) },
        }),
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + (levels - i);
      // displaced in the vertex shader: devtools must use raycastGround instead
      mesh.userData.devPickable = false;
      this.group.add(mesh);
      this.levels.push({ mesh, mat, spacing });
    }
  }

  update(camera) {
    for (const lv of this.levels) {
      const snap = lv.spacing * 2;
      lv.mat.uniforms.uCenter.value.set(
        Math.round(camera.position.x / snap) * snap,
        Math.round(camera.position.z / snap) * snap,
      );
    }
  }

  dispose() {
    for (const lv of this.levels) { lv.mesh.geometry.dispose(); lv.mat.dispose(); }
    this.levels.length = 0;
  }
}

function glslType(v) {
  if (typeof v === 'number') return 'float';
  if (v?.isColor || v?.isVector3) return 'vec3';
  if (v?.isVector2) return 'vec2';
  if (v?.isVector4) return 'vec4';
  if (v?.isTexture) return 'sampler2D';
  return 'float';
}

const defaultSurface = () => /* glsl */ `
void sceneSurface(vec2 wp, float h, vec3 n, float slope, float mask, float dist,
                  out vec3 albedo, out float gloss, out float ao){
  albedo = vec3(0.42, 0.46, 0.38);
  gloss = 0.0;
  ao = 1.0;
}
`;
