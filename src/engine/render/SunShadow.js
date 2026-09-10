import * as THREE from 'three';

// A single camera-following shadow cascade for the solid props (trees, rocks).
// Terrain self-shadowing already comes from the baked heightfield pass; this
// adds the long tree shadows that give the meadow its depth.
export class SunShadow {
  constructor(renderer, size = 2048, halfExtent = 190) {
    this.renderer = renderer;
    this.size = size;
    this.halfExtent = halfExtent;

    const depth = new THREE.DepthTexture(size, size);
    depth.type = THREE.UnsignedIntType;
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    depth.compareFunction = null;

    this.rt = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: depth,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.depth = depth;

    this.camera = new THREE.OrthographicCamera(-halfExtent, halfExtent, halfExtent, -halfExtent, 1, 1400);
    this.matrix = new THREE.Matrix4();
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this._center = new THREE.Vector3();
  }

  add(mesh) { this.scene.add(mesh); }

  update(sunDir, camPos) {
    if (sunDir.y < 0.02) { this.matrix.makeScale(0, 0, 0); return false; }

    // snap to whole texels so the shadow edges do not crawl while walking
    const texel = (this.halfExtent * 2) / this.size;
    const cx = Math.round(camPos.x / texel) * texel;
    const cz = Math.round(camPos.z / texel) * texel;
    this._center.set(cx, camPos.y - 4, cz);

    const dist = 620;
    this.camera.position.copy(this._center).addScaledVector(sunDir, dist);
    this.camera.up.set(0, 1, 0);
    if (sunDir.y > 0.985) this.camera.up.set(1, 0, 0);
    this.camera.lookAt(this._center);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    return true;
  }

  render() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevColor = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.setClearColor(prevColor, prevAlpha);
  }
}
