import * as THREE from 'three';

/**
 * Time-of-day driving, shared by every scene.
 *
 * A scene supplies its own keyframe table (see scenes/grassland/atmosphere.js)
 * and its own sun arc; the interpolation, colour handling and sun geometry live
 * here so two scenes at the same hour agree about what "18:30" looks like.
 */
const smooth = (x) => x * x * (3 - 2 * x);

/** Fields interpolated between keyframes. Colours lerp, numbers lerp. */
const COLOR_KEYS = ['sun', 'zen', 'hor', 'gnd', 'fogT', 'bounce'];
const NUM_KEYS = ['sunI', 'fogD', 'mist', 'haze', 'exp', 'amb'];

const OUT_NAME = {
  sun: 'sunColor', zen: 'zenith', hor: 'horizon', gnd: 'ground',
  fogT: 'fogTint', bounce: 'bounce',
  sunI: 'sunIntensity', fogD: 'fogDensity', mist: 'mist',
  haze: 'haze', exp: 'exposure', amb: 'ambient',
};

export function sampleAtmosphere(keys, time, out = {}) {
  const t = ((time % 24) + 24) % 24;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const k = smooth(THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1));

  for (const key of COLOR_KEYS) {
    if (a[key] === undefined) continue;
    const name = OUT_NAME[key];
    out[name] = (out[name] || new THREE.Color()).copy(a[key]).lerp(b[key], k);
  }
  for (const key of NUM_KEYS) {
    if (a[key] === undefined) continue;
    out[OUT_NAME[key]] = THREE.MathUtils.lerp(a[key], b[key], k);
  }
  // scenes may carry extra numeric fields through the same table
  for (const key of Object.keys(a)) {
    if (key === 't' || OUT_NAME[key]) continue;
    const av = a[key], bv = b[key];
    if (typeof av === 'number') out[key] = THREE.MathUtils.lerp(av, bv ?? av, k);
    else if (av?.isColor) out[key] = (out[key] || new THREE.Color()).copy(av).lerp(bv ?? av, k);
  }
  return out;
}

export const DEFAULT_ARC = {
  dawn: 5.6,          // hour the sun crosses the horizon rising
  dusk: 19.2,         // ...and setting
  maxElevation: 1.13, // radians at local noon
  azimuth: Math.PI * 0.55,
  sweep: 0.86,
  azimuthBias: -0.30,
};

/**
 * Sun (or moon) direction for an hour. Below the horizon the vector keeps
 * going — scenes decide whether that means night or just a dark sun.
 */
export function sunDirection(time, arc = DEFAULT_ARC, out = new THREE.Vector3()) {
  const a = { ...DEFAULT_ARC, ...arc };
  const span = a.dusk - a.dawn;
  const day = ((time - a.dawn) / span) * Math.PI;
  const elev = Math.sin(day) * a.maxElevation;
  const azim = a.azimuth - day * a.sweep + a.azimuthBias;
  const ce = Math.cos(elev);
  return out.set(ce * Math.sin(azim), Math.sin(elev), ce * Math.cos(azim)).normalize();
}

/** Convenience for scenes whose "sun" is a moon that should never fully set. */
export function moonDirection(time, arc, out = new THREE.Vector3()) {
  return sunDirection((time + 12) % 24, arc, out);
}
