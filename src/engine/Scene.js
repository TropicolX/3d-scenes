// The contract every scene implements. A scene owns its own THREE.Scene,
// camera and render path, so scenes stay fully isolated from one another:
// deleting a scene folder can never break another one.
export class Scene {
  constructor() {
    this.ctx = null;
    this.three = null;      // THREE.Scene
    this.camera = null;     // THREE.Camera
    this.controller = null; // optional camera controller with .update(dt)
    this.schema = null;
    this.params = null;
  }

  /** Build the world. Called once, awaited, before the first update. */
  async init(_ctx) {}

  /** Per-frame simulation. dt is clamped seconds, elapsed is scene time. */
  update(_dt, _elapsed) {}

  /** Draw to the canvas. Override when using a custom post chain. */
  render() {
    const { renderer } = this.ctx;
    if (this.three && this.camera) renderer.render(this.three, this.camera);
  }

  resize(_w, _h, _dpr) {}

  /** Free GPU resources. The manager clears dev nodes and the DOM for you. */
  dispose() {}

  // ---- optional hooks the engine and devtools look for --------------------

  /** Where does this ray hit the world? Used by dev-mode picking. */
  raycastGround(_ray) { return null; }

  // Scenes may also set these plain properties, which the UI and devtools read:
  //   schema  — parameter schema (see engine/Params.js)
  //   params  — the live values that schema addresses
  //   viewpoints — named camera bookmarks
}

/** Small helper for scenes that prefer a plain object over a class. */
export function defineScene(impl) {
  return class extends Scene {
    constructor() {
      super();
      Object.assign(this, impl);
    }
  };
}
