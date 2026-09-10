import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--no-sandbox','--window-size=1440,810'],
  defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__app && window.__app.state.ready && window.__app.scenes.current', { timeout: 60000 });
await page.evaluate(() => { document.querySelector('.hint-overlay')?.remove(); document.body.classList.remove('intro'); document.body.classList.add('ui-hidden'); });

const cases = JSON.parse(process.argv[2]);
const out = [];
for (const c of cases) {
  await page.evaluate((c) => {
    const S = window.__scene;
    Object.assign(S.params, c.params || {});
    if (c.pos) S.controls.pos.set(...c.pos);
    if (c.yaw !== undefined) S.controls.yaw = c.yaw;
    if (c.pitch !== undefined) S.controls.pitch = c.pitch;
    if (c.hide) for (const n of c.hide) { const o = S[n]; if (o) (o.group || o.mesh).visible = false; }
    if (c.show) for (const n of c.show) { const o = S[n]; if (o) (o.group || o.mesh).visible = true; }
    window.__app.ui && window.__app.ui.sync();
  }, c);
  await new Promise(r => setTimeout(r, 2500));
  const fps = await page.evaluate(() => window.__scene.state.fps);
  out.push({ name: c.name, fps });
}
console.log(JSON.stringify(out, null, 0));
await browser.close();
