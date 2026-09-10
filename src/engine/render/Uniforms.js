import * as THREE from 'three';

/**
 * The shared uniform pool every world material spreads in. One update per
 * frame propagates lighting, wind, fog and shadow state to everything at once,
 * which is what keeps a scene visually coherent.
 *
 * Scenes address these through a params object using the key names in
 * updateShared() below — that convention is the whole contract.
 */
export function createShared(opts = {}) {
  const { terrainOrigin = -2048, terrainSize = 4096, terrainTexels = 2048, waterLevel = 0 } = opts;
  return {
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },

    uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
    uWindStrength: { value: 1 },
    uWindGust: { value: 1 },

    uCloudCov: { value: 0.55 },
    uCloudShadow: { value: 1 },
    uCloudDrift: { value: 22 },

    uSunDir: { value: new THREE.Vector3(0, 0.3, -1) },
    uSunColor: { value: new THREE.Color(1, 0.85, 0.7) },
    uSkyZenith: { value: new THREE.Color(0.2, 0.4, 0.8) },
    uSkyHorizon: { value: new THREE.Color(0.9, 0.8, 0.7) },
    uSkyGround: { value: new THREE.Color(0.3, 0.3, 0.3) },
    uSunIntensity: { value: 2.5 },
    uHazeLift: { value: 1 },
    uAmbient: { value: 1 },
    uBounce: { value: new THREE.Color(0.4, 0.35, 0.25) },

    uFogDensity: { value: 0.0022 },
    uFogHeight: { value: 6 },
    uFogFalloff: { value: 195 },
    uFogTint: { value: new THREE.Color(0.7, 0.75, 0.85) },
    uMistAmount: { value: 0.3 },
    uMistHeight: { value: 26 },

    uSunDepth: { value: null },
    uSunMat: { value: new THREE.Matrix4() },
    uSunMapTexel: { value: 1 / 2048 },
    uSunMapOn: { value: 0 },

    uHeightTex: { value: null },
    uShadowTex: { value: null },
    uTerrainOrigin: { value: new THREE.Vector2(terrainOrigin, terrainOrigin) },
    uTerrainSize: { value: terrainSize },
    uTerrainTexel: { value: 1 / terrainTexels },
    uWaterLevel: { value: waterLevel },
  };
}

/**
 * @param atmo  result of sampleAtmosphere()
 * @param sunDir already-computed sun direction
 * @param opts  per-scene scaling: fogBase, cloudCovRange
 */
export function updateShared(u, params, time, camera, atmo, sunDir, opts = {}) {
  const { fogBase = 0.0020, cloudCovFrom = 0.70, cloudCovTo = 0.16 } = opts;

  u.uTime.value = time;
  u.uCamPos.value.copy(camera.position);
  u.uSunDir.value.copy(sunDir);

  u.uSunColor.value.copy(atmo.sunColor);
  u.uSkyZenith.value.copy(atmo.zenith);
  u.uSkyHorizon.value.copy(atmo.horizon);
  u.uSkyGround.value.copy(atmo.ground);
  u.uSunIntensity.value = atmo.sunIntensity;
  u.uHazeLift.value = atmo.haze;
  u.uAmbient.value = atmo.ambient;
  u.uBounce.value.copy(atmo.bounce);

  const fogMul = params.fog ?? 1;
  u.uFogDensity.value = fogBase * atmo.fogDensity * fogMul;
  u.uFogTint.value.copy(atmo.fogTint);
  u.uMistAmount.value = atmo.mist * fogMul;

  const angle = params.windAngle ?? 0;
  u.uWindDir.value.set(Math.cos(angle), Math.sin(angle));
  u.uWindStrength.value = params.windStrength ?? 1;
  u.uWindGust.value = params.windGust ?? 1;

  const clouds = Math.min(params.clouds ?? 1, 2);
  u.uCloudCov.value = cloudCovFrom - cloudCovTo * clouds;
  u.uCloudShadow.value = Math.min(clouds, 1.2);

  return atmo;
}
