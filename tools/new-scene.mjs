#!/usr/bin/env node
/** npm run new-scene -- my-scene "My Scene"  — copies the sandbox template. */
import fs from 'node:fs';
import path from 'node:path';

const [rawId, ...rest] = process.argv.slice(2);
if (!rawId) {
  console.error('usage: npm run new-scene -- <id> ["Display Name"]');
  process.exit(1);
}
const id = rawId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
const name = rest.join(' ').trim() || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const src = path.join('src', 'scenes', 'sandbox');
const dst = path.join('src', 'scenes', id);
if (fs.existsSync(dst)) { console.error(`✗ ${dst} already exists`); process.exit(1); }

fs.cpSync(src, dst, { recursive: true });

const manifest = path.join(dst, 'scene.js');
fs.writeFileSync(manifest, `export default {
  id: '${id}',
  name: '${name.replace(/'/g, "\\'")}',
  blurb: 'A new scene.',
  tags: ['wip'],
  accent: '#9fc47a',
  order: 500,
  load: () => import('./index.js'),
};
`);

const index = path.join(dst, 'index.js');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8')
  .replaceAll("src/scenes/sandbox", `src/scenes/${id}`)
  .replace('export default class Sandbox', `export default class ${name.replace(/[^A-Za-z0-9]/g, '')}`));

console.log(`\n  ✓ ${dst}\n    open http://localhost:5180/?scene=${id}\n`);
