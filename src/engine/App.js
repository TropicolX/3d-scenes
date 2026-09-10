import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';
import { Input, isTextTarget } from './Input.js';
import { Assets } from './Assets.js';
import { Audio } from './Audio.js';
import { Store } from './Store.js';
import { NodeRegistry } from './Nodes.js';

/**
 * The shell: one renderer, one loop, one input stack — and exactly one scene
 * mounted at a time. Scenes own their own THREE.Scene, camera and render path.
 */
export class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, powerPreference: 'high-performance',
      stencil: false, depth: true, preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);

    this.input = new Input(canvas);
    this.assets = new Assets(this.renderer);
    this.audio = new Audio(this.assets);
    this.nodes = new NodeRegistry();
    this.scenes = new SceneManager(this);
    this.dev = null;          // attached by devtools
    this.ui = null;           // attached by the UI layer

    this.size = { w: 1, h: 1, dpr: 1 };
    this.state = { ready: false, fps: 0, frames: 0, fpsT: 0, elapsed: 0, paused: false };
    this.maxDpr = 1.6;
    this.hooks = { frame: new Set(), sceneReady: new Set(), sceneUnload: new Set() };

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._last = performance.now();
    this._loop = this._loop.bind(this);
  }

  // ---- lifecycle ----------------------------------------------------------

  makeContext(manifest) {
    return {
      app: this,
      renderer: this.renderer,
      canvas: this.canvas,
      input: this.input,
      assets: this.assets,
      audio: this.audio,
      store: new Store(manifest.id),
      manifest,
      size: this.size,
      /** Register something devtools can select, inspect and report on. */
      node: (def) => this.nodes.add({ ...def, source: def.source || `${manifest.dir}/index.js` }),
      setStatus: (t) => this.setStatus(t),
      maxDpr: () => this.maxDpr,
    };
  }

  onSceneReady(scene, manifest) {
    this.resize();
    this.state.elapsed = 0;
    for (const fn of this.hooks.sceneReady) fn(scene, manifest);
  }

  onSceneUnload(scene) {
    for (const fn of this.hooks.sceneUnload) fn(scene);
    this.nodes.clear();
  }

  on(event, fn) { this.hooks[event]?.add(fn); return () => this.hooks[event]?.delete(fn); }

  // ---- frame --------------------------------------------------------------

  start() { requestAnimationFrame(this._loop); }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;

    const scene = this.scenes.current;
    if (scene && this.state.ready) {
      if (!this.state.paused) {
        this.state.elapsed += dt;
        try { scene.update(dt, this.state.elapsed); } catch (e) { this._sceneError(e, 'update'); }
      }
      try { scene.render(); } catch (e) { this._sceneError(e, 'render'); }
      this.dev?.renderOverlay(scene);
      for (const fn of this.hooks.frame) fn(dt, this.state.elapsed);
    }

    this.state.frames++;
    this.state.fpsT += dt;
    if (this.state.fpsT > 0.5) {
      this.state.fps = Math.round(this.state.frames / this.state.fpsT);
      this.state.frames = 0;
      this.state.fpsT = 0;
    }
  }

  _sceneError(err, phase) {
    if (this._errored) return;
    this._errored = true;
    console.error(`[app] scene ${phase} threw — pausing`, err);
    this.state.paused = true;
    this.setStatus(`scene error during ${phase} — see console`);
  }

  // ---- viewport -----------------------------------------------------------

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.size.w = w; this.size.h = h; this.size.dpr = dpr;
    this.renderer.setSize(w, h, false);
    const scene = this.scenes.current;
    if (scene) { try { scene.resize(w, h, dpr); } catch (e) { console.warn(e); } }
  }

  setStatus(text) {
    const el = document.getElementById('loader-sub');
    if (el) el.textContent = text;
  }

  screenshot(filename) {
    return new Promise((res) => {
      this.canvas.toBlob((blob) => {
        if (!blob) return res(null);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${this.scenes.currentManifest?.id || 'scene'}-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        res(blob);
      });
    });
  }

  dataURL(quality = 0.82) { return this.canvas.toDataURL('image/jpeg', quality); }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.audio.dispose();
  }
}

export { isTextTarget };
