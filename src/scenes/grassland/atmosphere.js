import * as THREE from 'three';

const c = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

/**
 * Hand-authored atmosphere keyframes across the day. Every visual system
 * (sky, grass, fog, water, post) reads from the interpolated result, so this
 * table is the fastest way to change the whole look of the scene.
 */
export const ATMOSPHERE = [
  { t: 0.0,  sun: c(0x6d84bd), sunI: 0.24, zen: c(0x111d42), hor: c(0x2e4070), gnd: c(0x151b2c),
    fogD: 0.55,  fogT: c(0x2c3d63), mist: 0.55, haze: 0.35, exp: 1.42, amb: 1.05, bounce: c(0x223052) },
  { t: 4.6,  sun: c(0x7a6288), sunI: 0.42, zen: c(0x1a2547), hor: c(0x6a5170), gnd: c(0x241f2d),
    fogD: 0.80, fogT: c(0x4b4a66), mist: 1.55, haze: 0.55, exp: 1.34, amb: 0.98, bounce: c(0x3f3b58) },
  { t: 6.4,  sun: c(0xffc08e), sunI: 1.65, zen: c(0x4a7ec6), hor: c(0xffb87e), gnd: c(0x4a4050),
    fogD: 0.40, fogT: c(0xa7a3c0), mist: 1.25, haze: 1.05, exp: 1.06, amb: 0.84, bounce: c(0x6b5a4a) },
  { t: 8.6,  sun: c(0xffe3bd), sunI: 2.35, zen: c(0x4f8ddc), hor: c(0xd6e6f2), gnd: c(0x6d7c7a),
    fogD: 0.42, fogT: c(0xa9bcd4), mist: 0.32, haze: 0.72, exp: 0.90, amb: 0.90, bounce: c(0x7d8464) },
  { t: 12.4, sun: c(0xfff6e6), sunI: 3.05, zen: c(0x3f86e2), hor: c(0xcfe4f6), gnd: c(0x7d8c86),
    fogD: 0.55, fogT: c(0x9fbcdb), mist: 0.06, haze: 0.5,  exp: 0.82, amb: 1.00, bounce: c(0x8a9068) },
  { t: 16.2, sun: c(0xffeac6), sunI: 2.60, zen: c(0x4a86d6), hor: c(0xe2ecf2), gnd: c(0x7f8578),
    fogD: 0.66, fogT: c(0xaec2cf), mist: 0.12, haze: 0.66, exp: 0.86, amb: 0.94, bounce: c(0x8a8a60) },
  { t: 18.5, sun: c(0xffd2a0), sunI: 2.60, zen: c(0x3d72c6), hor: c(0xf7c089), gnd: c(0x6d5b55),
    fogD: 0.52, fogT: c(0xa39ec0), mist: 0.28, haze: 1.05, exp: 0.88, amb: 0.80, bounce: c(0x8a6b48) },
  { t: 19.7, sun: c(0xffa062), sunI: 2.20, zen: c(0x35569e), hor: c(0xff9e68), gnd: c(0x4c3b46),
    fogD: 0.62, fogT: c(0x9c93b8), mist: 0.5,  haze: 1.20, exp: 0.94, amb: 0.70, bounce: c(0x7a4f3c) },
  { t: 20.7, sun: c(0xc47b9c), sunI: 0.78, zen: c(0x263a72), hor: c(0xc47ea0), gnd: c(0x2d2b3f),
    fogD: 0.70, fogT: c(0x7a5f7c), mist: 0.72, haze: 0.9,  exp: 1.22, amb: 0.90, bounce: c(0x4e3d56) },
  { t: 22.2, sun: c(0x7e95ca), sunI: 0.30, zen: c(0x16214a), hor: c(0x374a78), gnd: c(0x1a2030),
    fogD: 0.58, fogT: c(0x34456b), mist: 0.6,  haze: 0.4,  exp: 1.36, amb: 1.02, bounce: c(0x243356) },
  { t: 24.0, sun: c(0x6d84bd), sunI: 0.24, zen: c(0x111d42), hor: c(0x2e4070), gnd: c(0x151b2c),
    fogD: 0.9,  fogT: c(0x2c3d63), mist: 0.55, haze: 0.35, exp: 1.42, amb: 1.05, bounce: c(0x223052) },
];

/** Sunrise 05:36, sunset 19:12, peaking near 65 degrees. */
export const SUN_ARC = {
  dawn: 5.6, dusk: 19.2, maxElevation: 1.13,
  azimuth: Math.PI * 0.55, sweep: 0.86, azimuthBias: -0.30,
};

export const defaults = {
  timeOfDay: 18.35,
  timeFlow: 0,

  windStrength: 1.0,
  windAngle: 0.62,
  windGust: 1.0,
  windSpeed: 1.0,

  grassDensity: 1.0,
  grassHeight: 1.0,
  flowers: 1.0,
  trees: 1.0,
  motes: 1.0,
  birds: true,
  clouds: 1.0,

  fog: 1.0,
  exposure: 1.0,
  saturation: 1.06,
  contrast: 1.04,

  godrays: 1.2,
  bloom: 0.55,
  painterly: 0.36,
  brush: 1.05,
  paper: 0.0,
  vignette: 0.5,
  aberration: 0.35,

  fov: 62,
  quality: 'high',
  fly: false,
  cinematic: false,
};

export const PRESETS = {
  'Golden Hour': { timeOfDay: 18.35, windStrength: 1.0, fog: 1.0, godrays: 1.3, bloom: 0.6, painterly: 0.36 },
  'Dawn Mist':   { timeOfDay: 6.15, windStrength: 0.45, fog: 1.35, godrays: 1.3, bloom: 0.68, painterly: 0.35 },
  'High Noon':   { timeOfDay: 12.4, windStrength: 0.8, fog: 0.85, godrays: 0.55, bloom: 0.42, painterly: 0.22 },
  'Storm Front': { timeOfDay: 15.4, windStrength: 2.35, fog: 1.5, godrays: 0.8, bloom: 0.5, painterly: 0.3 },
  'Last Light':  { timeOfDay: 19.75, windStrength: 0.9, fog: 1.15, godrays: 1.35, bloom: 0.72, painterly: 0.3 },
  'Moonlit':     { timeOfDay: 22.6, windStrength: 0.7, fog: 1.0, godrays: 0.35, bloom: 0.6, painterly: 0.25 },
};
