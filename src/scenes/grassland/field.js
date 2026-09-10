import { HASH, NOISE } from '../../engine/shaders/index.js';

/** Extent and resolution of Meadowlight's baked heightfield. */
export const FIELD = {
  size: 2048,          // texels
  world: 4096,         // world units covered, centred on origin
  origin: -2048,
  waterLevel: 5.5,
  get texel() { return this.world / this.size; },
};

/** Must define: float landHeight(vec2 p) */
export const HEIGHT_GLSL = /* glsl */ `
const vec2 LAKE = vec2(-430.0, 315.0);

float smin_(float a, float b, float k){
  float t = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, t) - k*t*(1.0 - t);
}
float smax_(float a, float b, float k){ return -smin_(-a, -b, k); }

// Signed height of the land in metres.
float landHeight(vec2 p){
  // ---- broad rolling meadow -------------------------------------------------
  float h  = fbm2(p*0.00145 + 4.10, 5) * 52.0;
  h += fbm2(p*0.0061 + 17.7, 4) * 12.5;
  h += fbm2(p*0.0225 + 3.3,  3) * 2.9;
  h += 19.0;

  // ---- a calm meadow bowl around spawn so the field reads wide and open -----
  float spawn = smoothstep(360.0, 90.0, length(p - vec2(0.0, 60.0)));
  h = mix(h, mix(h, 13.5, 0.72), spawn);

  // ---- two framing hills ----------------------------------------------------
  h += 30.0 * exp(-pow(length(p - vec2(-250.0,-210.0))/175.0, 2.0));
  h += 44.0 * exp(-pow(length(p - vec2( 330.0,-330.0))/215.0, 2.0));
  h += 22.0 * exp(-pow(length(p - vec2( 150.0, 430.0))/190.0, 2.0));

  // ---- mountain ring --------------------------------------------------------
  float r = length(p);
  float ring = smoothstep(880.0, 1760.0, r);
  float mass = fbm2(p*0.00085 + 5.5, 3)*0.5 + 0.5;
  float rg = ridged(p*0.00150 + 31.7, 3);
  float rg2 = ridged(p*0.0044 + 9.1, 2);
  h += ring * (40.0 + 145.0*mass + 182.0*rg*(0.45 + 0.55*mass) + 13.0*rg2*rg);
  // far wall keeps the horizon closed
  h += smoothstep(1780.0, 2260.0, r) * 150.0;

  // ---- lake basin -----------------------------------------------------------
  // carve toward an absolute bed height so the shoreline is a real edge
  // instead of a wide shelf that fragments into puddles
  float lr = length((p - LAKE) * vec2(1.0, 1.22));
  lr += fbm2(p*0.0055 + 3.9, 3) * 46.0;
  float bowl = smoothstep(250.0, 78.0, lr);
  float bed = -13.0 + fbm2(p*0.011 + 21.0, 3) * 7.0;
  h = mix(h, bed, bowl);

  // Everywhere outside the basin gets a soft floor well above the waterline,
  // so the lake is the only place water can appear (no meadow puddles).
  h = mix(smax_(h, 12.5, 7.0), h, bowl);

  return h;
}
`;

/** Must define: float surfaceMask(vec2 wp, float h, vec3 n, float slope) */
export const MASK_GLSL = /* glsl */ `
float surfaceMask(vec2 wp, float h, vec3 n, float slope){
  // grass thins on cliffs, alpine tops, lake floor and in wandering dry patches
  float g = 1.0;
  g *= smoothstep(0.60, 0.20, slope);
  g *= smoothstep(150.0, 95.0, h);
  g *= smoothstep(5.2, 9.4, h);
  float dryPatch = fbm2(wp*0.0042 + 61.0, 4);
  g *= mix(0.72, 1.0, smoothstep(-0.45, 0.18, dryPatch));
  float scuff = fbm2(wp*0.019 + 7.7, 3);
  g *= mix(0.88, 1.0, smoothstep(-0.30, 0.35, scuff));

  return clamp(g, 0.0, 1.0);
}
`;

export { HASH, NOISE };
