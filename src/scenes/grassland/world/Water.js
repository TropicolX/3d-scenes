import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, WIND, SKY, FOG, HEIGHTFIELD, SHADOWMAP, CLOUDSHADOW } from '../../../engine/shaders/index.js';
import { FIELD } from '../field.js';

const VS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${HEIGHTFIELD}
uniform vec2 uCenter;
varying vec3 vWorld;
varying float vDist;
void main(){
  vec2 wp = uCenter + position.xz;
  float swell = fbm2(wp*0.045 - vec2(uTime*0.12), 2) * 0.055;
  vWorld = vec3(wp.x, uWaterLevel + swell, wp.y);
  vDist = distance(vWorld, uCamPos);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${WIND}
${SKY}
${FOG}
${HEIGHTFIELD}
${SHADOWMAP}
${CLOUDSHADOW}
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uBed;
varying vec3 vWorld;
varying float vDist;

float waveH(vec2 p, float t, float lod){
  vec2 w = uWindDir;
  float h  = fbm2(p*0.030 - w*t*0.045, 3) * 0.40;
  h += fbm2(p*0.105 + vec2(19.0) - w*t*0.10, 2) * 0.13 * lod;
  h += gnoise(p*0.34 - w*t*0.22) * 0.026 * lod;
  return h;
}

vec3 waterNormal(vec2 p, float t, float amp, float lod){
  float e = 1.1;
  float h0 = waveH(p, t, lod);
  float hx = waveH(p + vec2(e, 0.0), t, lod);
  float hz = waveH(p + vec2(0.0, e), t, lod);
  vec2 g = vec2(hx - h0, hz - h0) / e * amp;
  return normalize(vec3(-g.x, 1.0, -g.y));
}

void main(){
  float bed = sampleHeight(vWorld.xz);
  float depth = uWaterLevel - bed;
  if(depth <= 0.02) discard;

  vec3 V = normalize(uCamPos - vWorld);
  float lod = smoothstep(420.0, 45.0, vDist);
  float amp = (0.55 + 0.85*uWindStrength) * mix(0.35, 1.0, lod);
  vec3 n = waterNormal(vWorld.xz, uTime, amp, lod);

  // painterly: ease the surface toward a few flat facets
  vec3 flat3 = normalize(vec3(floor(n.x*14.0 + 0.5)/14.0, n.y, floor(n.z*14.0 + 0.5)/14.0));
  n = normalize(mix(n, flat3, 0.32 * lod));

  float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.6);
  fres = mix(0.035, 1.0, fres);

  vec3 R = reflect(-V, n);
  R.y = max(R.y, 0.008);
  vec3 refl = skyGradient(R);

  vec2 sh0 = sampleShade(vWorld.xz);
  vec2 sh = vec2(sh0.r * propShadow(vWorld, vec3(0.0,1.0,0.0), 1.0) * cloudShade(vWorld), sh0.g);

  // sun path: a broad streak, not confetti
  vec3 H = normalize(V + uSunDir);
  float ndh = max(dot(n, H), 0.0);
  float broad = pow(ndh, 90.0);
  float tight = pow(ndh, 900.0);
  vec3 glint = uSunColor * uSunIntensity * (broad*0.55 + tight*2.6) * sh.r;

  vec3 body = mix(uShallow, uDeep, smoothstep(0.4, 8.0, depth));
  body = mix(uBed, body, smoothstep(0.0, 2.4, depth));
  vec3 lit = body * (uSunColor * uSunIntensity * 0.26 * sh.r
           + mix(uSkyHorizon, uSkyZenith, 0.72) * 0.42 * uAmbient);

  vec3 col = mix(lit, refl, fres) + glint;

  // shoreline foam, following the wave crests
  float crest = smoothstep(0.02, 0.16, waveH(vWorld.xz, uTime, lod) + 0.06);
  float foamN = fbm2(vWorld.xz*0.85 - uWindDir*uTime*0.18, 3)*0.5 + 0.5;
  float foam = smoothstep(1.05, 0.10, depth) * smoothstep(0.42, 0.76, foamN*0.65 + crest*0.35);
  col = mix(col, mix(uSkyHorizon, vec3(1.0), 0.55) * (0.5 + 0.5*sh.r), foam*0.8);

  col = applyAerial(col, uCamPos, -V, vDist);
  gl_FragColor = vec4(col, 0.0);
}
`;

export class Water {
  constructor(shared, defines) {
    const geo = new THREE.PlaneGeometry(1000, 1000, 128, 128);
    geo.rotateX(-Math.PI / 2);
    this.uniforms = Object.assign({}, shared, {
      uCenter: { value: new THREE.Vector2(-430, 315) },
      uShallow: { value: new THREE.Color().setHex(0x5cb0ac, THREE.SRGBColorSpace) },
      uDeep: { value: new THREE.Color().setHex(0x184257, THREE.SRGBColorSpace) },
      uBed: { value: new THREE.Color().setHex(0x8c9a6e, THREE.SRGBColorSpace) },
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, defines: Object.assign({}, defines || {}),
      uniforms: this.uniforms, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.userData.devPickable = false;   // positioned in the vertex shader
    this.center = new THREE.Vector2(-430, 315);
  }
}
