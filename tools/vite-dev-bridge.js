import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only bridge between the browser and the repo.
 *
 * Dev mode POSTs here when you hit "Send to Claude", and this writes a
 * structured record, a markdown summary and a screenshot into .dev/ — so the
 * agent can read exactly what you were pointing at. Never active in a build.
 */
export function devBridge({ dir = '.dev', maxBytes = 12 * 1024 * 1024 } = {}) {
  let root = process.cwd();

  const ensure = (p) => { fs.mkdirSync(p, { recursive: true }); return p; };
  const abs = (...p) => path.join(root, dir, ...p);

  function readJson(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  const send = (res, code, body) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };

  return {
    name: 'dev-bridge',
    apply: 'serve',
    configResolved(cfg) { root = cfg.root; },
    configureServer(server) {
      server.middlewares.use('/__dev/handoff', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const payload = await readJson(req, maxBytes);
          ensure(abs());
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const files = [];

          if (payload.screenshot?.startsWith('data:image')) {
            ensure(abs('shots'));
            const b64 = payload.screenshot.split(',')[1];
            const ext = payload.screenshot.slice(11, 14) === 'png' ? 'png' : 'jpg';
            const rel = path.join(dir, 'shots', `${stamp}.${ext}`);
            fs.writeFileSync(path.join(root, rel), Buffer.from(b64, 'base64'));
            payload.screenshot = rel;
            files.push(rel);
          }

          const md = payload.markdown || '';
          delete payload.markdown;

          fs.writeFileSync(abs('handoff.json'), JSON.stringify(payload, null, 2));
          files.push(path.join(dir, 'handoff.json'));

          const shotLine = payload.screenshot ? `\n\n![screenshot](${path.basename(payload.screenshot)})` : '';
          fs.writeFileSync(abs('handoff.md'), md + shotLine + '\n');
          files.push(path.join(dir, 'handoff.md'));

          fs.appendFileSync(abs('history.jsonl'), JSON.stringify(payload) + '\n');

          server.config.logger.info(
            `\n  ◈ handoff → ${dir}/handoff.md` +
            (payload.note ? `\n    "${payload.note.split('\n')[0].slice(0, 70)}"` : '') +
            (payload.selection?.length ? `\n    ${payload.selection.map((s) => s.id).join(', ')}` : ''),
            { clear: false, timestamp: true },
          );
          send(res, 200, { ok: true, files });
        } catch (e) {
          send(res, 400, { ok: false, error: String(e.message || e) });
        }
      });

      server.middlewares.use('/__dev/overrides', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const { scene, params } = await readJson(req, 1024 * 512);
          if (!scene || typeof scene !== 'string' || /[^\w.-]/.test(scene)) {
            return send(res, 400, { ok: false, error: 'bad scene id' });
          }
          ensure(abs('overrides'));
          const rel = path.join(dir, 'overrides', `${scene}.json`);
          fs.writeFileSync(path.join(root, rel), JSON.stringify(params, null, 2));
          send(res, 200, { ok: true, files: [rel] });
        } catch (e) {
          send(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
    },
  };
}
