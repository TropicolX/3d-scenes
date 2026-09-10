import * as THREE from 'three';

/**
 * Shared first-person controller: walks along the ground, or flies 6DOF where
 * forward follows the look direction. Scenes supply a groundAt(x, z) probe;
 * without one it just flies.
 */
export class FlyWalkController {
  constructor(camera, input, opts = {}) {
    this.camera = camera;
    this.input = input;
    this.groundAt = opts.groundAt || null;
    this.eye = opts.eye ?? 1.72;
    this.walkAccel = opts.walkAccel ?? 42;
    this.flyAccel = opts.flyAccel ?? 68;
    this.sprintMul = opts.sprintMul ?? 3.1;
    this.bounds = opts.bounds ?? 0;     // soft radial limit, 0 = none
    this.maxAltitude = opts.maxAltitude ?? 900;

    this.pos = new THREE.Vector3(0, 10, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.fly = false;
    this.enabled = true;
    this.autoForward = false;
    this.bob = 0;
    this.groundY = 0;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._look = new THREE.Vector2();
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._wish = new THREE.Vector3();
  }

  placeAt(x, z, opts = {}) {
    const g = this.groundAt ? this.groundAt(x, z) : 0;
    this.pos.set(x, opts.y ?? g + this.eye, z);
    this.vel.set(0, 0, 0);
    if (opts.yaw !== undefined) this.yaw = opts.yaw;
    if (opts.pitch !== undefined) this.pitch = opts.pitch;
  }

  lookAlong(dir, offset = 0, pitchScale = 0.35, pitchBias = 0) {
    this.yaw = Math.atan2(-dir.x, -dir.z) + offset;
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * pitchScale + pitchBias;
  }

  update(dt) {
    const input = this.input;
    if (this.enabled) {
      input.consumeLook(this._look);
      this.yaw += this._look.x;
      this.pitch = THREE.MathUtils.clamp(this.pitch + this._look.y, -1.45, 1.45);
    } else {
      input.consumeLook(this._look);
    }

    const fly = this.fly;
    const sprint = input.isDown('sprint') ? this.sprintMul : 1;
    const accel = (fly ? this.flyAccel : this.walkAccel) * sprint;
    const damp = fly ? 5.0 : 9.5;

    // Flying is 6DOF: forward follows the look direction, so you go where you
    // point. Walking keeps forward flat so looking down doesn't slow you.
    const cp = fly ? Math.cos(this.pitch) : 1;
    this._f.set(-Math.sin(this.yaw) * cp, fly ? Math.sin(this.pitch) : 0, -Math.cos(this.yaw) * cp);
    this._r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = this._wish.set(0, 0, 0);
    if (this.autoForward) wish.add(this._f);
    if (this.enabled) {
      if (input.isDown('forward')) wish.add(this._f);
      if (input.isDown('back')) wish.sub(this._f);
      if (input.isDown('right')) wish.add(this._r);
      if (input.isDown('left')) wish.sub(this._r);
      if (input.moveVec.lengthSq() > 0.0004) {
        wish.addScaledVector(this._f, -input.moveVec.y);
        wish.addScaledVector(this._r, input.moveVec.x);
      }
      if (fly) {
        if (input.isDown('up')) wish.y += 1;
        if (input.isDown('down')) wish.y -= 1;
      }
    }
    if (wish.lengthSq() > 0) wish.normalize();

    this.vel.addScaledVector(wish, accel * dt);
    this.vel.multiplyScalar(Math.exp(-damp * dt));
    if (!fly) this.vel.y = 0;
    this.pos.addScaledVector(this.vel, dt);

    if (this.bounds > 0) {
      const r = Math.hypot(this.pos.x, this.pos.z);
      if (r > this.bounds) {
        const s = this.bounds / r;
        this.pos.x *= s; this.pos.z *= s;
        this.vel.x *= 0.5; this.vel.z *= 0.5;
      }
    }

    const g = this.groundAt ? this.groundAt(this.pos.x, this.pos.z) : 0;
    this.groundY = g;
    if (fly) {
      if (this.pos.y < g + 1.2) { this.pos.y = g + 1.2; this.vel.y = Math.max(this.vel.y, 0); }
      this.pos.y = Math.min(this.pos.y, this.maxAltitude);
      this.camera.position.copy(this.pos);
    } else {
      this.pos.y += (g + this.eye - this.pos.y) * Math.min(1, dt * 16);
      const speed = Math.hypot(this.vel.x, this.vel.z);
      this.bob += dt * speed * 1.5;
      const sway = Math.sin(this.bob * 2) * 0.022 * Math.min(speed / 5, 1);
      this.camera.position.set(this.pos.x, this.pos.y + sway, this.pos.z);
    }

    this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);
  }

  get speed() { return this.vel.length(); }
}
