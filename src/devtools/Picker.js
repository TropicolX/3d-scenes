import * as THREE from 'three';

/**
 * Turns a click into a selection.
 *
 * Most of this world is instanced geometry with custom vertex shaders, which
 * three's raycaster can't see. So instead of raycasting meshes we find where
 * the ray meets the ground (the scene tells us how) and then ask each node
 * whether it owns anything near that point. Nodes that are plain meshes are
 * still raycast normally first.
 */
export class Picker {
  constructor(app) {
    this.app = app;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 6000;
    this.ndc = new THREE.Vector2();
  }

  rayFrom(clientX, clientY, camera) {
    const r = this.app.canvas.getBoundingClientRect();
    this.ndc.set(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, camera);
    return this.raycaster.ray;
  }

  /**
   * Ranked candidates under the cursor, best first. Concrete instances beat
   * surfaces, so clicking a tree gives you the tree and not the ground it
   * stands on — and alt-click can walk down the list when both are plausible.
   */
  pick(clientX, clientY) {
    const scene = this.app.scenes.current;
    if (!scene?.camera) return [];
    const ray = this.rayFrom(clientX, clientY, scene.camera);
    const nodes = this.app.nodes.nodes.filter((n) => n.visible);

    // 1. plain meshes three can actually raycast
    const meshes = [];
    for (const n of nodes) {
      if (!n.object) continue;
      n.object.traverse((o) => {
        if (o.isMesh && o.geometry?.attributes?.position && !o.geometry.isInstancedBufferGeometry
            && o.userData.devPickable !== false && o.visible) {
          o.userData.__devNode = n;
          meshes.push(o);
        }
      });
    }

    let meshHit = null;
    if (meshes.length) {
      const hits = this.raycaster.intersectObjects(meshes, false);
      if (hits.length) {
        const h = hits[0];
        const node = h.object.userData.__devNode;
        meshHit = {
          node, point: h.point.clone(), distance: h.distance,
          label: `${node.name} · ${h.object.name || h.object.type}`,
          instance: null, radius: node.pick?.surface ? 3 : 1.5, height: 2,
          surface: !!node.pick?.surface,
        };
      }
    }

    // A solid object under the cursor is unambiguous — take it.
    if (meshHit && !meshHit.surface) return [meshHit];

    // 2. otherwise find the ground point and ask nodes what lives there
    const ground = meshHit?.point || scene.raycastGround?.(ray) || null;
    if (!ground) return meshHit ? [meshHit] : [];

    const out = [];
    for (const n of nodes) {
      if (!n.pick?.at) continue;
      let hit;
      try { hit = n.pick.at(ground); } catch { hit = null; }
      if (!hit) continue;
      const pos = new THREE.Vector3().fromArray(hit.position || ground.toArray());
      out.push({
        node: n, point: pos, distance: ray.origin.distanceTo(pos),
        label: hit.label || n.name,
        instance: hit.instance || null,
        radius: hit.radius ?? 3,
        height: hit.height ?? 3,
        surface: !!n.pick.surface,
        offset: pos.distanceTo(ground),
      });
    }
    if (meshHit && !out.some((c) => c.node === meshHit.node)) out.push(meshHit);

    // instances first, then whatever sits closest to where you actually clicked
    out.sort((a, b) => {
      const ai = a.instance ? 0 : 1, bi = b.instance ? 0 : 1;
      if (ai !== bi) return ai - bi;
      const as = a.surface ? 1 : 0, bs = b.surface ? 1 : 0;
      if (as !== bs) return as - bs;
      return (a.offset ?? 0) - (b.offset ?? 0);
    });
    return out;
  }
}
