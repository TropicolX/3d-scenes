import * as THREE from 'three';

/**
 * Selection marker, drawn straight to the canvas after the scene's post chain.
 * There's no depth buffer left to test against at that point, so it draws on
 * top — which is what you want from a selection highlight anyway.
 */
export class Gizmo {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    const mat = (color, opacity) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    });
    this.accent = 0xffc978;

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), mat(this.accent, 0.95));
    this.ring.rotation.x = -Math.PI / 2;
    this.halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.02, 64), mat(this.accent, 0.12));
    this.halo.rotation.x = -Math.PI / 2;

    const lineMat = new THREE.LineBasicMaterial({
      color: this.accent, transparent: true, opacity: 0.85,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
    this.pillar = new THREE.Line(g, lineMat);

    this.box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({
        color: this.accent, transparent: true, opacity: 0.55,
        depthTest: false, depthWrite: false, toneMapped: false,
      }),
    );

    this.group.add(this.halo, this.ring, this.pillar, this.box);
    this.pulse = 0;
  }

  clear() { this.group.visible = false; }

  show({ point, radius = 3, height = 4, boxed = false }) {
    this.group.visible = true;
    this.group.position.copy(point);
    this.ring.scale.setScalar(radius);
    this.halo.scale.setScalar(radius);
    this.pillar.scale.set(1, height, 1);
    this.box.visible = boxed;
    if (boxed) {
      this.box.scale.set(radius * 1.6, height, radius * 1.6);
      this.box.position.y = height * 0.5;
    }
  }

  render(camera, dt = 0.016) {
    if (!this.group.visible) return;
    this.pulse += dt;
    const s = 1 + Math.sin(this.pulse * 3.2) * 0.035;
    this.ring.scale.multiplyScalar(1); // keep base scale, pulse via opacity
    this.ring.material.opacity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(this.pulse * 3.2));
    this.halo.material.opacity = 0.08 + 0.08 * s;
    const prevAuto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, camera);
    this.renderer.autoClear = prevAuto;
  }

  dispose() {
    this.scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
