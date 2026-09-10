import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--no-sandbox','--window-size=1440,810'],
  defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0,300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const R = {};

await page.goto('http://localhost:5180/?scene=grassland', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction('window.__app?.state.ready && window.__app.scenes.current', { timeout: 60000 });
await new Promise(r => setTimeout(r, 2400));
R.scenes = await page.evaluate(() => window.__app.scenes.list.map(m => m.id));
R.grasslandNodes = await page.evaluate(() => window.__app.nodes.nodes.length);
await page.evaluate(() => document.querySelector('#enter')?.click());
await new Promise(r => setTimeout(r, 700));
R.fpsGrassland = await page.evaluate(() => window.__app.state.fps);

// panel: presets, viewpoints, quality
for (const label of ['Dawn Mist', 'Storm Front', 'Golden Hour']) {
  await page.evaluate((n) => [...document.querySelectorAll('#ui .chip')].find(c => c.textContent.trim() === n)?.click(), label);
  await new Promise(r => setTimeout(r, 400));
}
R.presetOk = await page.evaluate(() => window.__app.scenes.current.activePreset);
const before = await page.evaluate(() => window.__app.scenes.current.controller.pos.toArray().map(v => +v.toFixed(0)));
await page.keyboard.press('Digit3');
await new Promise(r => setTimeout(r, 300));
const after = await page.evaluate(() => window.__app.scenes.current.controller.pos.toArray().map(v => +v.toFixed(0)));
R.viewpointOk = JSON.stringify(before) !== JSON.stringify(after);
for (const q of ['low', 'ultra', 'high']) {
  await page.evaluate((q) => [...document.querySelectorAll('#ui .seg button')].find(b => b.textContent.trim() === q)?.click(), q);
  await new Promise(r => setTimeout(r, 900));
}
R.qualityOk = await page.evaluate(() => window.__app.scenes.current.params.quality);

// dev mode + picking + handoff
await page.keyboard.press('Backquote');
await new Promise(r => setTimeout(r, 500));
R.devOn = await page.evaluate(() => window.__app.dev.enabled);
await page.mouse.click(500, 470);
await new Promise(r => setTimeout(r, 350));
R.pick = await page.evaluate(() => { const s = window.__app.dev.selection[0]; return s && { node: s.node.id, src: s.node.source, inst: s.instance }; });
R.outlinerRows = await page.evaluate(() => document.querySelectorAll('.dev-node').length);
await page.evaluate(() => window.__app.dev.selectNode(window.__app.nodes.byId.get('grass')));
await new Promise(r => setTimeout(r, 250));
R.outlinerSelect = await page.evaluate(() => window.__app.dev.selection[0]?.node.id);
// visibility toggle
await page.evaluate(() => { const n = window.__app.nodes.byId.get('flowers'); n.visible = false; });
R.visibilityOk = await page.evaluate(() => window.__app.nodes.byId.get('flowers').object.visible === false);
await page.evaluate(() => { window.__app.nodes.byId.get('flowers').visible = true; });
await page.keyboard.press('Backquote');
await new Promise(r => setTimeout(r, 300));

// scene switch round trip
await page.evaluate(() => window.__app.scenes.switchTo('sandbox'));
await page.waitForFunction("window.__app.scenes.currentManifest?.id === 'sandbox'", { timeout: 40000 });
await new Promise(r => setTimeout(r, 2000));
R.sandboxNodes = await page.evaluate(() => window.__app.nodes.nodes.length);
R.fpsSandbox = await page.evaluate(() => window.__app.state.fps);
await page.evaluate(() => window.__app.scenes.switchTo('grassland'));
await page.waitForFunction("window.__app.scenes.currentManifest?.id === 'grassland'", { timeout: 40000 });
await new Promise(r => setTimeout(r, 2400));
R.fpsBack = await page.evaluate(() => window.__app.state.fps);
R.nodesAfterRoundTrip = await page.evaluate(() => window.__app.nodes.nodes.length);

// mobile
await page.setViewport({ width: 430, height: 860 });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'shots/qa-mobile.png' });
R.mobileFps = await page.evaluate(() => window.__app.state.fps);

console.log(JSON.stringify(R, null, 1));
console.log(logs.length ? 'LOGS:\n' + logs.slice(0, 12).join('\n') : 'no console errors/warnings');
await browser.close();
