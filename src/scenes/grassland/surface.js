import * as THREE from 'three';

const c = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

/** Palette + extra uniforms the ground shader below reads. */
export const SURFACE_UNIFORMS = {
  uGrassLit: { value: c(0x86ab4a) },
  uGrassDark: { value: c(0x587f45) },
  uDryGrass: { value: c(0xbfae5f) },
  uRock: { value: c(0x4a5260) },
  uRockLit: { value: c(0x8e8d93) },
  uSand: { value: c(0xc7b189) },
  uSnow: { value: c(0xeaf0f7) },
};

/**
 * What Meadowlight's ground looks like. Lighting, shadows and haze are the
 * engine clipmap's job; this only answers "what colour is the dirt here".
 */
export const SURFACE_GLSL = /* glsl */ `
void sceneSurface(vec2 wp, float h, vec3 n, float slope, float mask, float dist,
                  out vec3 albedo, out float gloss, out float ao){
  // High-frequency detail is faded out with distance: below a texel it just
  // aliases into static and makes far ridges look like crumpled foil.
  float detailFade = smoothstep(900.0, 130.0, dist);
  float midFade    = smoothstep(1500.0, 320.0, dist);

  float tint  = fbm2(wp*0.0037 + 51.0, 4);
  float tint2 = mix(0.0, fbm2(wp*0.026 + 7.0, 3), midFade);
  float dryness = smoothstep(-0.18, 0.30, tint) * 0.75 + smoothstep(0.0, 0.4, tint2)*0.25;

  vec3 grass = mix(uGrassDark, uGrassLit, smoothstep(-0.45, 0.55, tint2*0.45 + tint*0.75));
  grass = mix(grass, uDryGrass, dryness*0.38);

  float rockN = mix(0.05, fbm2(wp*0.055 + 3.0, 4), detailFade)
              + mix(0.0, fbm2(wp*0.0125 + 8.0, 3)*0.7, midFade);
  vec3 rock = mix(uRock, uRockLit, smoothstep(-0.32, 0.45, rockN));
  float rockAmt = smoothstep(0.24, 0.50, slope);
  rockAmt = max(rockAmt, (1.0 - smoothstep(0.02, 0.30, mask)) * 0.45);
  grass = mix(grass, uDryGrass*0.90, (1.0 - smoothstep(0.15, 0.95, mask)) * 0.30);

  vec3 col = mix(grass, rock, rockAmt);

  // read the ground as the floor of a grass sward, not bare earth
  float swardNear = smoothstep(420.0, 70.0, dist);
  float sward = mix(0.5, fbm2(wp*1.85 + 12.0, 3)*0.5 + 0.5, swardNear);
  float sward2 = mix(0.5, fbm2(wp*0.42 + 44.0, 3)*0.5 + 0.5, midFade);
  vec3 swardCol = mix(uGrassDark*0.80, uGrassLit*0.92, sward*0.55 + sward2*0.45);
  col = mix(col, swardCol, mask * (1.0 - rockAmt) * 0.62);

  // shoreline sand and lake bed
  float shore = smoothstep(2.2, 0.0, abs(h - uWaterLevel) - 0.4) * (1.0 - smoothstep(0.24, 0.44, slope));
  col = mix(col, uSand, shore*0.85);
  col = mix(col, uSand*0.62, smoothstep(uWaterLevel + 0.3, uWaterLevel - 3.0, h)*0.75);

  // high ground turns rocky before it turns white
  float alpineJitter = fbm2(wp*0.0035 + 17.0, 3) * 46.0;
  float alpine = smoothstep(108.0 + alpineJitter, 226.0 + alpineJitter, h);
  col = mix(col, rock, alpine * 0.88);
  float snowLine = 250.0 + fbm2(wp*0.004 + 90.0, 3)*66.0;
  float snow = smoothstep(snowLine, snowLine + 46.0, h) * smoothstep(0.56, 0.26, slope);
  col = mix(col, uSnow, clamp(snow, 0.0, 1.0));

  albedo = col;
  gloss = snow*0.6 + shore*0.15;
  // contact darkening under standing blades
  ao = mix(1.0, 0.72, mask * smoothstep(190.0, 30.0, dist));
}
`;
