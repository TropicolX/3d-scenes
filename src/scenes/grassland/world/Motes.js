import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, WIND, SKY, FOG } from '../../../engine/shaders/index.js';

const VS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${WIND}
attribute vec3 iPos;
attribute vec4 iRand;
uniform vec3  uSunDir;
uniform vec3  uBox;
uniform float uSize;
uniform float uAmount;
varying float vGlow;
varying vec2  vQuad;
varying float vDist;
varying vec3  vWorld;

void main(){
  if(iRand.z > uAmount){ gl_Position = vec4(0.0,0.0,2.0,1.0); return; }

  // slow drift with the wind plus a lazy vertical bob
  vec2 flow = uWindDir * uTime * (0.55 + iRand.y*0.9);
  vec3 p = iPos;
  p.xz += flow;
  p.x += sin(uTime*(0.35 + iRand.x*0.5) + iRand.w*40.0) * 1.9;
  p.z += cos(uTime*(0.28 + iRand.y*0.5) + iRand.x*33.0) * 1.9;
  p.y += sin(uTime*(0.5 + iRand.w*0.7) + iRand.y*27.0) * 1.3;

  // wrap the whole cloud around the camera
  vec3 rel = p - uCamPos;
  rel -= uBox * floor(rel/uBox + 0.5);
  vec3 world = uCamPos + rel;

  float d = length(rel);
  float fade = (1.0 - smoothstep(uBox.x*0.30, uBox.x*0.48, d)) * smoothstep(1.2, 4.0, d);

  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = uSize * (0.4 + iRand.y*1.5) * fade;
  world += (right*position.x + up*position.y) * s;

  vQuad = position.xy * 2.0;
  vDist = d;
  vWorld = world;
  // brightest when the mote sits between the eye and the sun
  vec3 V = normalize(uCamPos - world);
  vGlow = fade * (0.35 + 0.65*pow(clamp(-dot(V, uSunDir), 0.0, 1.0), 3.0))
        * (0.6 + 0.4*sin(uTime*(2.0+iRand.x*4.0) + iRand.w*50.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${SKY}
varying float vGlow;
varying vec2  vQuad;
varying float vDist;
varying vec3  vWorld;
void main(){
  float r = dot(vQuad, vQuad);
  if(r > 1.0) discard;
  float a = pow(1.0 - r, 2.6) * vGlow * 0.85;
  vec3 col = mix(uSunColor, vec3(1.0), 0.22) * (0.30 + uSunIntensity*0.22);
  gl_FragColor = vec4(col * a, a);
}
`;

export class Motes {
  constructor(shared, count = 5200) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    const box = new THREE.Vector3(78, 26, 78);
    const iPos = new Float32Array(count * 3);
    const iRand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      iPos[i * 3] = (Math.random() - 0.5) * box.x;
      iPos[i * 3 + 1] = (Math.pow(Math.random(), 1.7) - 0.35) * box.y;
      iPos[i * 3 + 2] = (Math.random() - 0.5) * box.z;
      for (let k = 0; k < 4; k++) iRand[i * 4 + k] = Math.random();
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = Object.assign({}, shared, {
      uBox: { value: box }, uSize: { value: 0.048 }, uAmount: { value: 1 },
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
  }
  update(params) { this.uniforms.uAmount.value = Math.min(params.motes, 1) * 1.0; this.uniforms.uSize.value = 0.048 * Math.max(1, params.motes); }
}
