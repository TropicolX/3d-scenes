// Scene manifest. Kept separate from index.js so the launcher can list every
// scene without pulling in its (heavy) module graph.
export default {
  id: 'grassland',
  name: 'Meadowlight',
  blurb: 'A painterly grassland at golden hour — half a million wind-driven blades, drifting cloud shadows and a full day cycle.',
  tags: ['landscape', 'outdoor', 'procedural'],
  accent: '#f0c07a',
  poster: '/posters/grassland.png',
  order: 10,
  load: () => import('./index.js'),
};
