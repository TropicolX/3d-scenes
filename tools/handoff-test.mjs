import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--no-sandbox','--window-size=1440,810'],
  defaultViewport: { width: 1440, height: 810 } });
const page = await b.newPage();
page.on('pageerror', e => console.log('[err]', e.message));
await page.goto('http://localhost:5180/?scene=grassland', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__app?.state.ready && window.__app.scenes.current', { timeout: 60000 });
await new Promise(r => setTimeout(r, 2200));
await page.evaluate(() => { document.querySelector('#enter')?.click(); window.__app.dev.toggle(true); });
await new Promise(r => setTimeout(r, 500));
// nudge a param so the diff has something in it
await page.evaluate(() => { window.__app.scenes.current.params.timeOfDay = 19.1; });
await page.mouse.click(380, 445);            // a tree
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'shots/qa-dev.png' });

await page.evaluate(() => window.__app.dev.openComposer());
await new Promise(r => setTimeout(r, 300));
await page.type('.dev-textarea', 'These conifers read too dark against the sky — lift them and give the canopy more silhouette variation.');
await page.screenshot({ path: 'shots/qa-composer.png' });
await page.click('[data-act="send"]');
await new Promise(r => setTimeout(r, 1400));
console.log(await page.evaluate(() => document.querySelector('.dev-composer-result')?.textContent ?? 'composer closed'));
await b.close();
