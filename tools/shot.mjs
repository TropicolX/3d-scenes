import puppeteer from 'puppeteer';
import fs from 'node:fs';

const URL_BASE = process.env.URL || 'http://localhost:5180/';
const OUT = process.argv[2] || 'shots/frame.png';
const W = +(process.env.W || 1440);
const H = +(process.env.H || 810);
// setup: JS evaluated in page after boot, e.g. "__params.timeOfDay=12"
const SETUP = process.env.SETUP || '';
const WAIT = +(process.env.WAIT || 3500);

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--use-gl=angle', '--use-angle=metal', '--enable-gpu',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--enable-webgl2-compute-context',
    `--window-size=${W},${H}`,
    '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
if (process.env.SHOWUI) await page.evaluateOnNewDocument(() => { window.__SHOWUI = 1; });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL_BASE, { waitUntil: 'networkidle2', timeout: 60000 });

try {
  await page.waitForFunction('window.__app && window.__app.state.ready && window.__app.scenes.current', { timeout: 45000 });
} catch (e) {
  logs.push('[fatal] scene never became ready');
}

if (SETUP) {
  await page.evaluate(SETUP);
  await page.evaluate(() => window.__app.ui && window.__app.ui.sync());
}
await page.evaluate(() => { document.querySelector('.hint-overlay')?.remove(); document.body.classList.remove('intro'); if(!window.__SHOWUI) document.body.classList.add('ui-hidden'); });
await new Promise((r) => setTimeout(r, WAIT));

const info = await page.evaluate(() => {
  const s = window.__scene;
  if (!s) return null;
  const gl = s.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    fps: s.state.fps,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    pos: s.controls.pos.toArray().map((v) => +v.toFixed(1)),
    time: s.params.timeOfDay,
    blades: s.grass.bladeCount,
  };
});

await page.screenshot({ path: OUT });
fs.writeFileSync(OUT.replace(/\.png$/, '.log'), logs.join('\n'));
console.log(JSON.stringify(info, null, 1));
if (logs.length) console.log('--- logs ---\n' + logs.slice(0, 40).join('\n'));
await browser.close();
