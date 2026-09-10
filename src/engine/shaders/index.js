// Shared GLSL chunks: hashing, noise, wind field, sky model, atmospherics.

export const GLOBALS = /* glsl */ `
uniform float uTime;
uniform vec3  uCamPos;
uniform vec2  uWindDir;
uniform float uCloudCov;
uniform float uCloudShadow;
uniform float uCloudDrift;
uniform float uAmbient;
uniform vec3  uBounce;
uniform float uWaterLevel;
`;

export const HASH = /* glsl */ `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3  hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yxz+33.33); return fract((p3.xxy+p3.yzz)*p3.zyx); }
`;

export const NOISE = /* glsl */ `
// --- gradient (perlin-style) value noise, 2D ---
vec2 gradDir(vec2 i){
  float a = hash12(i) * 6.2831853;
  return vec2(cos(a), sin(a));
}
float gnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float a = dot(gradDir(i+vec2(0.0,0.0)), f-vec2(0.0,0.0));
  float b = dot(gradDir(i+vec2(1.0,0.0)), f-vec2(1.0,0.0));
  float c = dot(gradDir(i+vec2(0.0,1.0)), f-vec2(0.0,1.0));
  float d = dot(gradDir(i+vec2(1.0,1.0)), f-vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y) * 1.4142;
}
const mat2 M2 = mat2(0.80, 0.60, -0.60, 0.80);
float fbm2(vec2 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<8;i++){
    if(i>=oct) break;
    s += a * gnoise(p); n += a; p = M2*p*2.03; a *= 0.5;
  }
  return s/n;
}
float ridged(vec2 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<8;i++){
    if(i>=oct) break;
    float v = 1.0 - abs(gnoise(p));
    v = v*v;
    s += a*v; n += a; p = M2*p*2.07; a *= 0.5;
  }
  return s/n;
}
// --- cheap 3D value noise for clouds / motes ---
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  vec2 uv = i.xy + vec2(37.0,17.0)*i.z + f.xy;
  float a = hash12(uv);
  float b = hash12(uv + vec2(37.0,17.0));
  return mix(a, b, f.z);
}
float fbm3(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<6;i++){
    if(i>=oct) break;
    s += a*vnoise3(p); n += a; p *= 2.02; p.xy = M2*p.xy; a *= 0.5;
  }
  return s/n;
}
`;

// Global wind field. Returns xy = horizontal push (world), z = normalised gust 0..1
export const WIND = /* glsl */ `
uniform float uWindStrength;
uniform float uWindGust;

vec3 windField(vec2 wp){
  vec2 flow = uWindDir * uTime;
  // broad travelling gust fronts
  float g1 = fbm2(wp*0.0085 - flow*0.115, 3);
  // mid-scale ripples riding on top
  float g2 = fbm2(wp*0.045 - flow*0.34, 2);
  float gust = 0.78 + 0.46*g1 + 0.17*g2;
  gust = max(gust, 0.0);
  gust = mix(1.0, gust, uWindGust);
  // local swirl so the field never looks like a single sliding sheet
  float sw = gnoise(wp*0.03 - flow*0.05);
  vec2 dir = normalize(uWindDir + vec2(-uWindDir.y, uWindDir.x) * sw * 0.55);
  float amp = uWindStrength * gust;
  return vec3(dir*amp, gust);
}
`;

// Stylised analytic sky. Shared by the dome, water reflections and aerial haze.
export const SKY = /* glsl */ `
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyZenith;
uniform vec3  uSkyHorizon;
uniform vec3  uSkyGround;
uniform float uSunIntensity;
uniform float uHazeLift;

vec3 skyGradient(vec3 rd){
  float t = clamp(rd.y, -1.0, 1.0);
  float up = clamp(t, 0.0, 1.0);
  // fast-rising blend keeps the warm band narrow instead of flooding the dome
  float k = 1.0 - pow(1.0 - up, 2.7);

  // blend in a gamma-ish space so mid-tones keep their saturation
  vec3 a = sqrt(max(uSkyHorizon, 0.0));
  vec3 b = sqrt(max(uSkyZenith, 0.0));
  vec3 col = mix(a, b, k); col *= col;

  // ground bounce below the horizon line
  vec3 g = sqrt(max(uSkyGround, 0.0));
  col = mix(col, g*g, smoothstep(0.0, -0.20, t));

  // tight warm band hugging the horizon
  float hb = exp(-max(abs(t), 0.0) * 16.0);
  col += uSkyHorizon * hb * 0.16;

  // warm wash pooling around the sun's azimuth
  float az = clamp(dot(normalize(vec3(rd.x, 0.0, rd.z) + 1e-6), normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-6)), 0.0, 1.0);
  float pool = pow(az, 4.0) * exp(-max(abs(t), 0.0) * 5.0);
  col = mix(col, uSunColor * 0.9, pool * 0.30 * uHazeLift);
  return col;
}

vec3 sunDisc(vec3 rd){
  float cd = dot(rd, uSunDir);
  float disc  = smoothstep(0.99955, 0.99985, cd);
  float halo  = pow(max(cd,0.0), 1400.0) * 0.9;
  float bloomy= pow(max(cd,0.0), 62.0)  * 0.13;
  float wide  = pow(max(cd,0.0), 11.0)  * 0.030;
  return uSunColor * (disc*22.0 + halo*7.0 + bloomy + wide) * uSunIntensity;
}

vec3 skyColor(vec3 rd){
  return skyGradient(rd) + sunDisc(rd);
}
`;

// Height fog + aerial perspective + optional valley mist.
// Cloud shadows: project the ground point up onto the cloud deck along the sun
// direction and reuse the deck's base noise. One fbm, and the meadow suddenly
// breathes.
export const CLOUDSHADOW = /* glsl */ `
float cloudShade(vec3 world){
  if(uCloudShadow < 0.01 || uSunDir.y < 0.02) return 1.0;
  float h = 1650.0;
  vec2 p = world.xz + (uSunDir.xz / max(uSunDir.y, 0.16)) * (h - world.y);
  vec2 q = p * 0.00085 - uWindDir * uTime * uCloudDrift * 0.0011;
  float base = fbm2(q, 3)*0.5 + 0.5;
  float d = smoothstep(uCloudCov, uCloudCov + 0.135, base);
  return 1.0 - d * 0.72 * uCloudShadow;
}
`;

export const FOG = /* glsl */ `
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogFalloff;
uniform vec3  uFogTint;
uniform float uMistAmount;
uniform float uMistHeight;

// Analytic integral of exponential height fog along a ray.
float fogAmount(vec3 ro, vec3 rd, float dist){
  float fh = max(uFogFalloff, 0.001);
  float a = uFogDensity;
  float hb = (ro.y - uFogHeight) / fh;
  float ry = rd.y / fh;
  float d;
  if(abs(ry) < 1e-4){
    d = a * exp(-hb) * dist;
  } else {
    d = a * exp(-hb) * (1.0 - exp(-ry*dist)) / ry;
  }
  return 1.0 - exp(-max(d, 0.0));
}

vec3 applyAerial(vec3 col, vec3 ro, vec3 rd, float dist){
  float f = fogAmount(ro, rd, dist);

  vec3 inscat = skyGradient(rd);
  // sun-side inscattering makes distance glow instead of just going grey
  float mie = pow(max(dot(rd, uSunDir), 0.0), 13.0);
  inscat = mix(inscat, uSunColor, mie*0.42);
  inscat = mix(inscat, uFogTint, 0.30);
  col = mix(col, inscat, clamp(f, 0.0, 1.0));

  // Valley mist: a separate, paler, low-lying layer that drifts in banks.
  if(uMistAmount > 0.005){
    vec3 mid = ro + rd * dist * 0.5;
    float band = exp(-max(mid.y - uMistHeight, 0.0) * 0.075);
    float banks = fbm2(mid.xz*0.0026 - uWindDir*uTime*0.010, 3)*0.5 + 0.5;
    banks = 0.40 + 1.15*smoothstep(0.25, 0.85, banks);
    float m = 1.0 - exp(-uMistAmount * band * banks * dist * 0.0030);
    // mist takes its level from the sky, so it stays dim at night instead of
    // glowing white against a black meadow
    vec3 mistBase = mix(uFogTint, uSkyHorizon, 0.55) * 1.10
                  + uSunColor * (0.045 * uSunIntensity);
    vec3 mistCol = mix(inscat, mistBase, 0.60);
    mistCol = mix(mistCol, uSunColor, mie*0.30);
    col = mix(col, mistCol, clamp(m, 0.0, 0.94));
  }
  return col;
}
`;

// Terrain heightfield sampling (shared by terrain, grass, scatter, water).
export const HEIGHTFIELD = /* glsl */ `
uniform sampler2D uHeightTex;
uniform sampler2D uShadowTex;
uniform vec2  uTerrainOrigin;
uniform float uTerrainSize;
uniform float uTerrainTexel;

vec2 worldToHeightUV(vec2 wp){ return (wp - uTerrainOrigin) / uTerrainSize; }

vec4 hfFetch(vec2 uv){
#ifdef MANUAL_BILINEAR
  vec2 t = uv / uTerrainTexel - 0.5;
  vec2 i = floor(t), f = fract(t);
  vec2 b = (i + 0.5) * uTerrainTexel;
  vec4 c00 = texture2D(uHeightTex, b);
  vec4 c10 = texture2D(uHeightTex, b + vec2(uTerrainTexel, 0.0));
  vec4 c01 = texture2D(uHeightTex, b + vec2(0.0, uTerrainTexel));
  vec4 c11 = texture2D(uHeightTex, b + vec2(uTerrainTexel));
  return mix(mix(c00,c10,f.x), mix(c01,c11,f.x), f.y);
#else
  return texture2D(uHeightTex, uv);
#endif
}

// r = height, gb = normal.xz, a = grass density mask
vec4 sampleField(vec2 wp){ return hfFetch(clamp(worldToHeightUV(wp), 0.0005, 0.9995)); }
float sampleHeight(vec2 wp){ return sampleField(wp).r; }
vec3  fieldNormal(vec4 f){ vec2 nx = f.gb; return normalize(vec3(nx.x, sqrt(max(1.0 - dot(nx,nx), 0.0001)), nx.y)); }
// r = sun visibility, g = ambient occlusion
vec2 sampleShade(vec2 wp){ return texture2D(uShadowTex, clamp(worldToHeightUV(wp), 0.001, 0.999)).rg; }
`;

export const SHADOWMAP = /* glsl */ `
uniform sampler2D uSunDepth;
uniform mat4  uSunMat;
uniform float uSunMapTexel;
uniform float uSunMapOn;

float propShadow(vec3 world, vec3 nrm, float ndl){
  if(uSunMapOn < 0.5) return 1.0;
  vec3 wp = world + nrm * 0.30 + uSunDir * 0.16;
  vec4 sc = uSunMat * vec4(wp, 1.0);
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if(p.z > 0.9995 || p.z < 0.0) return 1.0;
  vec2 e = abs(p.xy - 0.5);
  float edge = 1.0 - smoothstep(0.44, 0.499, max(e.x, e.y));
  if(edge <= 0.001) return 1.0;

  float bias = mix(0.00085, 0.00016, clamp(ndl, 0.0, 1.0));
  float d = p.z - bias;
  float t = uSunMapTexel;
  float sum = 0.0;
  float sr = 2.3;
  sum += step(d, texture2D(uSunDepth, p.xy + vec2(-0.7, -1.3)*t*sr).r);
  sum += step(d, texture2D(uSunDepth, p.xy + vec2( 1.3, -0.7)*t*sr).r);
  sum += step(d, texture2D(uSunDepth, p.xy + vec2( 0.7,  1.3)*t*sr).r);
  sum += step(d, texture2D(uSunDepth, p.xy + vec2(-1.3,  0.7)*t*sr).r);
  sum += step(d, texture2D(uSunDepth, p.xy + vec2( 2.1, -2.0)*t*sr).r);
  sum += step(d, texture2D(uSunDepth, p.xy + vec2(-2.1,  2.0)*t*sr).r);
  sum += step(d, texture2D(uSunDepth, p.xy + vec2(-2.0, -2.1)*t*sr).r);
  sum += step(d, texture2D(uSunDepth, p.xy + vec2( 2.0,  2.1)*t*sr).r);
  sum += step(d, texture2D(uSunDepth, p.xy).r);
  float vis = mix(0.19, 1.0, sum / 9.0);
  return mix(1.0, vis, edge);
}
`;

export const TONEMAP = /* glsl */ `
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c){
  return mix(c*12.92, 1.055*pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
