import * as THREE from 'three';

/**
 * Loader + cache shared across scenes. Deliberately small: it exists so that
 * when models, textures and audio show up they have an obvious home and a
 * progress signal for the loading screen.
 */
export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.cache = new Map();
    this.inflight = new Map();
    this.loaded = 0;
    this.total = 0;
    this.onProgress = null;
    this._texLoader = new THREE.TextureLoader();
    this._gltfLoader = null;
    this._audioCtx = null;
  }

  _track(key, promise) {
    this.total++;
    this._report();
    const p = promise.then((v) => {
      this.cache.set(key, v);
      this.inflight.delete(key);
      this.loaded++;
      this._report();
      return v;
    }).catch((e) => {
      this.inflight.delete(key);
      this.loaded++;
      this._report();
      console.warn(`[assets] failed: ${key}`, e);
      throw e;
    });
    this.inflight.set(key, p);
    return p;
  }

  _report() { this.onProgress?.(this.loaded, this.total); }

  _get(key, make) {
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (this.inflight.has(key)) return this.inflight.get(key);
    return this._track(key, make());
  }

  texture(url, { colorSpace = THREE.SRGBColorSpace, wrap = THREE.RepeatWrapping, aniso = 8 } = {}) {
    return this._get(`tex:${url}`, () => new Promise((res, rej) => {
      this._texLoader.load(url, (t) => {
        t.colorSpace = colorSpace;
        t.wrapS = t.wrapT = wrap;
        t.anisotropy = Math.min(aniso, this.renderer.capabilities.getMaxAnisotropy());
        res(t);
      }, undefined, rej);
    }));
  }

  async gltf(url) {
    return this._get(`gltf:${url}`, async () => {
      if (!this._gltfLoader) {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        this._gltfLoader = new GLTFLoader();
      }
      return new Promise((res, rej) => this._gltfLoader.load(url, res, undefined, rej));
    });
  }

  audioContext() {
    if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return this._audioCtx;
  }

  sound(url) {
    return this._get(`snd:${url}`, async () => {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      return this.audioContext().decodeAudioData(buf);
    });
  }

  /** Drop everything a scene pulled in. Call between scene switches if needed. */
  purge(prefix = '') {
    for (const key of [...this.cache.keys()]) {
      if (prefix && !key.includes(prefix)) continue;
      const v = this.cache.get(key);
      v?.dispose?.();
      this.cache.delete(key);
    }
    this.loaded = 0; this.total = 0;
  }
}
