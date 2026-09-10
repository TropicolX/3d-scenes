import puppeteer from 'puppeteer';
import fs from 'node:fs';

// usage: node tools/shots.mjs specfile.json
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W = spec.w || 1440, H = spec.h || 810;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(spec.url || 'http://localhost:5180/', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction('window.__app && window.__app.state.ready && window.__app.scenes.current', { timeout: 60000 });
await page.evaluate(() => {
  document.querySelector('.hint-overlay')?.remove(); document.body.classList.remove('intro');
  document.body.classList.add('ui-hidden');
});

const results = [];
for (const s of spec.shots) {
  await page.evaluate((s) => {
    const S = window.__scene;
    Object.assign(S.params, JSON.parse(JSON.stringify(s.params || {})));
    if (s.pos) S.controls.pos.set(s.pos[0], s.pos[1], s.pos[2]);
    if (s.yaw !== undefined) S.controls.yaw = s.yaw;
    if (s.pitch !== undefined) S.controls.pitch = s.pitch;
    if (s.lookSun !== undefined) {
      const d = S.camera.position.clone();
      const sd = S.scene ? null : null;
      S.controls.lookAtSun(window.__scene.controls.field ? window.__sun || { x: 0, y: 0.2, z: -1 } : { x: 0, y: 0.2, z: -1 }, s.lookSun);
    }
    if (s.ui) document.body.classList.remove('ui-hidden');
    else document.body.classList.add('ui-hidden');
    window.__app.ui && window.__app.ui.sync();
  }, s);
  await new Promise((r) => setTimeout(r, s.wait ?? 1600));
  await page.screenshot({ path: s.out });
  const info = await page.evaluate(() => ({ fps: window.__scene.state.fps }));
  results.push({ out: s.out, ...info });
}
console.log(JSON.stringify(results));
if (logs.length) console.log('--- logs ---\n' + logs.slice(0, 25).join('\n'));
await browser.close();
