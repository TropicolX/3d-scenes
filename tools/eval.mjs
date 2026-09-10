import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--no-sandbox','--window-size=900,500'],
  defaultViewport: { width: 900, height: 500 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[err]', e.message));
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__scene && window.__scene.state.ready', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));
console.log(await page.evaluate(process.argv[2]));
await browser.close();
