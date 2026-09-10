import './ui/panel.css';
import './devtools/dev.css';
import { App } from './engine/App.js';
import { Shell } from './ui/Shell.js';
import { DevMode } from './devtools/DevMode.js';

const app = new App(document.getElementById('view'));
new Shell(app);
new DevMode(app);

/** ?scene=id wins, then the last scene you had open, then the first listed. */
function initialScene() {
  const fromUrl = new URLSearchParams(location.search).get('scene');
  if (fromUrl && app.scenes.find(fromUrl)) return fromUrl;
  try {
    const last = localStorage.getItem('meadow:lastScene');
    if (last && app.scenes.find(last)) return last;
  } catch {}
  return app.scenes.list[0]?.id;
}

app.scenes.onChange((phase, manifest) => {
  if (phase !== 'ready' || !manifest) return;
  try { localStorage.setItem('meadow:lastScene', manifest.id); } catch {}
  const url = new URL(location.href);
  url.searchParams.set('scene', manifest.id);
  history.replaceState(null, '', url);
  document.title = `${manifest.name} — 3D scenes`;
  document.getElementById('loader')?.classList.add('gone');
});

app.start();

(async () => {
  const id = initialScene();
  if (!id) { app.setStatus('no scenes found in src/scenes'); return; }
  await app.scenes.switchTo(id);
  app.state.ready = true;
})();

// A single handle for the dev harness and the browser console.
window.__app = app;
window.__scene = new Proxy({}, {
  get(_, k) {
    const s = app.scenes.current;
    if (k === 'app') return app;
    if (k === 'state') return app.state;
    if (k === 'params') return s?.params;
    if (k === 'controls' || k === 'controller') return s?.controller;
    if (k === 'renderer') return app.renderer;
    if (k === 'camera') return s?.camera;
    if (k === 'dev') return app.dev;
    return s?.[k];
  },
});
