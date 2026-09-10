import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--no-sandbox','--window-size=1440,810'],
  defaultViewport: { width: 1440, height: 810 } });
const page = await b.newPage();
page.on('pageerror', e => console.log('[err]', e.message));
await page.goto('http://localhost:5180/?scene=grassland', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__app?.state.ready && window.__app.scenes.current', { timeout: 60000 });
await new Promise(r => setTimeout(r, 2200));
await page.screenshot({ path: 'shots/qa-intro.png' });
await page.evaluate(() => document.querySelector('#enter')?.click());
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => window.__app.ui.openLauncher());
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'shots/qa-launcher.png' });
await page.evaluate(() => window.__app.ui.closeLauncher());
await page.evaluate(() => window.__app.dev.toggle(true));
await new Promise(r => setTimeout(r, 400));
await page.mouse.click(700, 500);
await new Promise(r => setTimeout(r, 350));
await page.screenshot({ path: 'shots/qa-dev2.png' });
await b.close();
