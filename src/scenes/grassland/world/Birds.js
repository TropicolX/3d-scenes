import * as THREE from 'three';
import { GLOBALS, HASH, NOISE, SKY, FOG } from '../../../engine/shaders/index.js';

const VS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
attribute vec4 iRand;    // flock, phase, radius, speed
attribute vec3 iOffset;
attribute float aWing;   // 0 body .. 1 wingtip
uniform float uScale;
varying float vShade;
varying float vDist;
varying vec3  vWorld;

void main(){
  float flock = iRand.x;
  float fa = flock * 43.7;
  vec2 centre = vec2(sin(fa)*520.0, cos(fa*1.7)*520.0);
  float alt = 68.0 + fract(sin(fa)*91.3)*95.0;
  float R = 90.0 + iRand.z*130.0;
  float w = (0.055 + iRand.w*0.035) * (fract(sin(fa*3.1)) > 0.5 ? 1.0 : -1.0);
  float ang = uTime*w + iRand.y*6.2831853;

  vec3 pathC = vec3(centre.x + cos(ang*0.31)*180.0, alt, centre.y + sin(ang*0.27)*180.0);
  vec3 pos = pathC + vec3(cos(ang)*R, sin(ang*2.1)*7.0, sin(ang)*R) + iOffset;

  vec3 fwd = normalize(vec3(-sin(ang)*R*w, 0.0, cos(ang)*R*w) + vec3(0.001));
  vec3 right = normalize(cross(vec3(0.0,1.0,0.0), fwd));
  vec3 up = cross(fwd, right);

  float flap = sin(uTime*(7.5 + iRand.w*4.0) + iRand.y*20.0);
  vec3 lp = position;
  lp.y += aWing * flap * 0.52;
  lp.z += aWing * abs(flap) * -0.12;

  vec3 world = pos + (right*lp.x + up*lp.y + fwd*lp.z) * uScale;
  vWorld = world;
  vDist = distance(world, uCamPos);
  vShade = 0.5 + 0.5*flap;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FS = /* glsl */ `
precision highp float;
${GLOBALS}
${HASH}
${NOISE}
${SKY}
${FOG}
varying float vShade;
varying float vDist;
varying vec3  vWorld;
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  vec3 body = mix(vec3(0.055,0.055,0.075), mix(uSkyZenith, uSunColor, 0.35), 0.34);
  vec3 col = body * (0.55 + 0.75*vShade);
  col = applyAerial(col, uCamPos, -V, vDist);
  gl_FragColor = vec4(col, 0.0);
}
`;

export class Birds {
  constructor(shared, count = 240) {
    const geo = new THREE.InstancedBufferGeometry();
    // a shallow V: body centre plus two swept wings
    const pos = [
      0, 0, 0.22, -0.62, 0.02, -0.30, -0.22, 0.0, -0.06,
      0, 0, 0.22, 0.22, 0.0, -0.06, 0.62, 0.02, -0.30,
    ];
    const wing = [0, 1, 0.32, 0, 0.32, 1];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    geo.setIndex([0, 1, 2, 3, 4, 5]);

    const iRand = new Float32Array(count * 4);
    const iOffset = new Float32Array(count * 3);
    const flocks = 7;
    for (let i = 0; i < count; i++) {
      iRand[i * 4] = Math.floor(Math.random() * flocks) + 1;
      iRand[i * 4 + 1] = Math.random();
      iRand[i * 4 + 2] = Math.random();
      iRand[i * 4 + 3] = Math.random();
      iOffset[i * 3] = (Math.random() - 0.5) * 34;
      iOffset[i * 3 + 1] = (Math.random() - 0.5) * 13;
      iOffset[i * 3 + 2] = (Math.random() - 0.5) * 34;
    }
    geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 4));
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(iOffset, 3));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = Object.assign({}, shared, { uScale: { value: 1.5 } });
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.count = count;
    this.geo = geo;
  }
  update(params) { this.geo.instanceCount = params.birds ? this.count : 0; }
}
