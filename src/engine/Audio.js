/**
 * Music + SFX buses over raw WebAudio. Barebones on purpose — enough structure
 * that adding a soundtrack or footstep sounds later is wiring, not plumbing.
 */
export class Audio {
  constructor(assets) {
    this.assets = assets;
    this.ctx = null;
    this.buses = {};
    this.music = null;
    this.enabled = true;
    this.volumes = { master: 0.8, music: 0.7, sfx: 0.9 };
    this._unlocked = false;
    this._unlock = () => this.resume();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(ev, this._unlock, { once: false, passive: true });
    }
  }

  _ensure() {
    if (this.ctx) return this.ctx;
    this.ctx = this.assets.audioContext();
    const master = this.ctx.createGain();
    master.gain.value = this.volumes.master;
    master.connect(this.ctx.destination);
    for (const name of ['music', 'sfx']) {
      const g = this.ctx.createGain();
      g.gain.value = this.volumes[name];
      g.connect(master);
      this.buses[name] = g;
    }
    this.buses.master = master;
    return this.ctx;
  }

  async resume() {
    this._ensure();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this._unlocked = true;
  }

  setVolume(bus, v) {
    this.volumes[bus] = v;
    this._ensure();
    const g = this.buses[bus];
    if (g) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  async playSfx(url, { volume = 1, rate = 1, detune = 0 } = {}) {
    if (!this.enabled) return null;
    this._ensure();
    const buf = await this.assets.sound(url);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (src.detune) src.detune.value = detune;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.buses.sfx);
    src.start();
    return src;
  }

  async playMusic(url, { loop = true, fade = 1.5, volume = 1 } = {}) {
    if (!this.enabled) return null;
    this._ensure();
    const buf = await this.assets.sound(url);
    this.stopMusic(fade);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(volume, this.ctx.currentTime, Math.max(fade, 0.01) / 3);
    src.connect(g).connect(this.buses.music);
    src.start();
    this.music = { src, gain: g };
    return src;
  }

  stopMusic(fade = 1.0) {
    if (!this.music) return;
    const { src, gain } = this.music;
    this.music = null;
    if (fade <= 0) { try { src.stop(); } catch {} return; }
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    setTimeout(() => { try { src.stop(); } catch {} }, fade * 1000 + 200);
  }

  dispose() {
    this.stopMusic(0);
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      window.removeEventListener(ev, this._unlock);
    }
  }
}
