import puppeteer from 'puppeteer';
import fs from 'node:fs';
const browser = await puppeteer.launch({ headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--no-sandbox','--window-size=800,450'],
  defaultViewport: { width: 800, height: 450 } });
const page = await browser.newPage();
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__app && window.__app.state.ready && window.__app.scenes.current', { timeout: 60000 });
await page.evaluate(() => {
  document.querySelector('.hint-overlay')?.remove(); document.body.classList.remove('intro');
  document.body.classList.add('ui-hidden');
  const S = window.__scene;
  S.controls.pos.set(150, 0, 60); S.controls.yaw = 2.038; S.controls.pitch = -0.10;
  S.params.timeOfDay = 12.4; S.params.windStrength = 1.4;
});
await new Promise(r => setTimeout(r, 2000));
const frames = [];
for (let i = 0; i < 4; i++) {
  frames.push(await page.screenshot({ encoding: 'base64' }));
  await new Promise(r => setTimeout(r, 550));
}
// crude diff via raw PNG byte length is useless; decode with canvas in page instead
const diffs = await page.evaluate(async (fr) => {
  const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
  const imgs = await Promise.all(fr.map(load));
  const c = document.createElement('canvas'); c.width = imgs[0].width; c.height = imgs[0].height;
  const x = c.getContext('2d', { willReadFrequently: true });
  const data = imgs.map((im) => { x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; });
  const out = [];
  for (let k = 1; k < data.length; k++) {
    let sum = 0, n = 0, moved = 0;
    for (let i = 0; i < data[0].length; i += 4 * 7) {
      const d = Math.abs(data[k][i] - data[0][i]) + Math.abs(data[k][i+1] - data[0][i+1]) + Math.abs(data[k][i+2] - data[0][i+2]);
      sum += d; n++; if (d > 24) moved++;
    }
    out.push({ dt: k * 0.55, meanDiff: +(sum / n).toFixed(2), pctMoved: +(100 * moved / n).toFixed(1) });
  }
  return out;
}, frames);
console.log(JSON.stringify(diffs));
fs.writeFileSync('shots/motion-0.png', Buffer.from(frames[0], 'base64'));
fs.writeFileSync('shots/motion-3.png', Buffer.from(frames[3], 'base64'));
await browser.close();
