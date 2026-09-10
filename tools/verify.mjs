import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--no-sandbox','--window-size=1100,700'],
  defaultViewport: { width: 1100, height: 700 } });
const page = await b.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__app && window.__app.state.ready && window.__app.scenes.current', { timeout: 60000 });
await page.evaluate(() => { document.querySelector('#enter')?.click(); });

const defaults = await page.evaluate(() => {
  const p = window.__scene.params;
  return { paper: p.paper, painterly: p.painterly, fov: p.fov };
});

// --- fly: look up, hold W, expect altitude gain ---------------------------
const fly = await page.evaluate(async () => {
  const S = window.__scene;
  S.params.fly = true;
  S.controls.pos.set(150, 80, 60);
  S.controls.vel.set(0, 0, 0);
  S.controls.yaw = 2.038;
  S.controls.pitch = 0.9;               // looking up
  await new Promise(r => setTimeout(r, 60));
  const y0 = S.controls.pos.y, xz0 = [S.controls.pos.x, S.controls.pos.z];
  S.controls.keys.fwd = true;
  await new Promise(r => setTimeout(r, 900));
  S.controls.keys.fwd = false;
  const up = { dy: +(S.controls.pos.y - y0).toFixed(2),
               dxz: +Math.hypot(S.controls.pos.x - xz0[0], S.controls.pos.z - xz0[1]).toFixed(2) };

  S.controls.pos.set(150, 80, 60); S.controls.vel.set(0, 0, 0);
  S.controls.pitch = -0.9;              // looking down
  await new Promise(r => setTimeout(r, 60));
  const y1 = S.controls.pos.y;
  S.controls.keys.fwd = true;
  await new Promise(r => setTimeout(r, 900));
  S.controls.keys.fwd = false;
  const down = { dy: +(S.controls.pos.y - y1).toFixed(2) };

  // walking must stay flat even when looking up
  S.params.fly = false;
  S.controls.pos.set(150, 0, 60);
  S.controls.pos.y = S.field.heightAt(150, 60) + S.controls.eye;
  S.controls.vel.set(0, 0, 0);
  S.controls.pitch = 0.9;
  const g0 = S.field.heightAt(S.controls.pos.x, S.controls.pos.z);
  const h0 = S.controls.pos.y - g0;
  S.controls.keys.fwd = true;
  await new Promise(r => setTimeout(r, 900));
  S.controls.keys.fwd = false;
  const g1 = S.field.heightAt(S.controls.pos.x, S.controls.pos.z);
  const walk = { eyeHeightDrift: +((S.controls.pos.y - g1) - h0).toFixed(2) };
  S.params.fly = false;
  return { up, down, walk };
});

// --- wheel: no FOV change when unlocked, and none over the panel ----------
const wheel = await page.evaluate(async () => {
  const S = window.__scene;
  S.controls.locked = false;
  S.params.fov = 62;
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }));
  const unlocked = S.params.fov;
  S.controls.locked = true;
  const slider = document.querySelector('#ui input[type=range]');
  slider.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }));
  const overPanel = S.params.fov;
  document.getElementById('view').dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }));
  const overScene = S.params.fov;
  S.controls.locked = false;
  return { unlocked, overPanel, overScene };
});

console.log(JSON.stringify({ defaults, fly, wheel }, null, 1));
console.log(errs.length ? 'ERRORS: ' + errs.join('\n') : 'no page errors');
await b.close();
