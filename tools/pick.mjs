import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--no-sandbox','--window-size=1440,810'],
  defaultViewport: { width: 1440, height: 810 } });
const page = await b.newPage();
page.on('pageerror', e => console.log('[err]', e.message));
await page.goto('http://localhost:5180/?scene=grassland', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__app?.state.ready && window.__app.scenes.current', { timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));
await page.evaluate(() => { document.querySelector('#enter')?.click(); window.__app.dev.toggle(true); });
await new Promise(r => setTimeout(r, 500));

const probe = await page.evaluate(() => {
  const app = window.__app, s = app.scenes.current, dev = app.dev;
  const ray = dev.picker.rayFrom(720, 560, s.camera);
  const g = s.raycastGround(ray);
  return {
    locked: app.input.locked,
    ray: { o: ray.origin.toArray().map(v=>+v.toFixed(1)), d: ray.direction.toArray().map(v=>+v.toFixed(3)) },
    ground: g ? g.toArray().map(v=>+v.toFixed(1)) : null,
  };
});
console.log('probe', JSON.stringify(probe));

for (const [x, y, what] of [[720, 560, 'near ground'], [720, 470, 'mid'], [380, 445, 'far/tree'], [1100, 430, 'right']]) {
  await page.mouse.click(x, y);
  await new Promise(r => setTimeout(r, 260));
  const sel = await page.evaluate(() => {
    const s = window.__app.dev.selection[0];
    return s ? { node: s.node.id, label: s.label, inst: s.instance, src: s.node.source } : null;
  });
  console.log(what, JSON.stringify(sel));
}
await page.screenshot({ path: 'shots/qa-select.png' });
await b.close();
