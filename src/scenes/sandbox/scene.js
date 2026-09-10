export default {
  id: 'sandbox',
  name: 'Sandbox',
  blurb: 'A bare starting point — gradient sky, grid ground, a few primitives. Copy this folder to begin a new scene.',
  tags: ['template', 'starter'],
  accent: '#9fc47a',
  order: 900,
  load: () => import('./index.js'),
};
