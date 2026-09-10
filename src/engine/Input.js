import * as THREE from 'three';

const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space', 'KeyE'],
  down: ['KeyQ', 'ControlLeft'],
  sprint: ['ShiftLeft', 'ShiftRight'],
};

/**
 * One place that owns the keyboard, pointer lock and touch, so every scene and
 * controller reads the same action state instead of each wiring its own
 * listeners (and fighting over them).
 */
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.bindings = { ...DEFAULT_BINDINGS };
    this.actions = {};
    this.codeToAction = new Map();
    this.rebuild();

    this.locked = false;
    this.look = new THREE.Vector2();   // consumed each frame
    this.sensitivity = 0.0022;
    this.enabled = true;
    this.suspended = false;            // devtools raise this while typing
    this.moveVec = new THREE.Vector2();
    this._wheelHandlers = new Set();
    this._keyHandlers = new Set();

    this._onKeyDown = (e) => {
      if (isTextTarget(e.target)) return;
      for (const fn of this._keyHandlers) fn(e);
      const a = this.codeToAction.get(e.code);
      if (a && !this.suspended) { this.actions[a] = true; e.preventDefault(); }
    };
    this._onKeyUp = (e) => {
      const a = this.codeToAction.get(e.code);
      if (a) this.actions[a] = false;
    };
    this._onMouseMove = (e) => {
      if (!this.locked || this.suspended) return;
      this.look.x -= e.movementX * this.sensitivity;
      this.look.y -= e.movementY * this.sensitivity;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.clearActions();
    };
    this._onBlur = () => this.clearActions();
    this._onWheel = (e) => { for (const fn of this._wheelHandlers) fn(e); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    window.addEventListener('wheel', this._onWheel, { passive: true });

    this._initTouch();
  }

  rebuild() {
    this.codeToAction.clear();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const c of codes) this.codeToAction.set(c, action);
    }
  }

  clearActions() { for (const k of Object.keys(this.actions)) this.actions[k] = false; }

  isDown(action) { return this.enabled && !this.suspended && !!this.actions[action]; }

  /** Read and reset the accumulated mouse delta. */
  consumeLook(out = new THREE.Vector2()) {
    out.copy(this.look);
    this.look.set(0, 0);
    return out;
  }

  onWheel(fn) { this._wheelHandlers.add(fn); return () => this._wheelHandlers.delete(fn); }
  onKey(fn) { this._keyHandlers.add(fn); return () => this._keyHandlers.delete(fn); }

  lock() { this.dom.requestPointerLock?.(); }
  unlock() { document.exitPointerLock?.(); }

  _initTouch() {
    this.touchLook = null;
    this.touchMove = null;
    const el = this.dom;
    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && this.touchMove === null) {
          this.touchMove = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        } else if (this.touchLook === null) {
          this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (this.suspended) return;
      for (const t of e.changedTouches) {
        if (this.touchLook && t.identifier === this.touchLook.id) {
          this.look.x -= (t.clientX - this.touchLook.x) * 0.005;
          this.look.y -= (t.clientY - this.touchLook.y) * 0.005;
          this.touchLook.x = t.clientX; this.touchLook.y = t.clientY;
        } else if (this.touchMove && t.identifier === this.touchMove.id) {
          this.moveVec.set(
            THREE.MathUtils.clamp((t.clientX - this.touchMove.x0) / 60, -1, 1),
            THREE.MathUtils.clamp((t.clientY - this.touchMove.y0) / 60, -1, 1),
          );
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.touchLook && t.identifier === this.touchLook.id) this.touchLook = null;
        if (this.touchMove && t.identifier === this.touchMove.id) { this.touchMove = null; this.moveVec.set(0, 0); }
      }
    };
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    window.removeEventListener('wheel', this._onWheel);
  }
}

export function isTextTarget(t) {
  return !!t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable);
}
