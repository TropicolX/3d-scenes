import { group, slider, toggle, segment, chips, action, readout } from '../../engine/Params.js';
import { PRESETS, defaults } from './atmosphere.js';

const hhmm = (v) => {
  const h = Math.floor(v), m = Math.floor((v - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const deg = (v) => `${Math.round(v * 57.3)}°`;
const degrees = (v) => `${Math.round(v)}°`;

export function buildSchema(scene) {
  const { params } = scene;
  return [
    chips('Presets', Object.keys(PRESETS), (name) => scene.applyPreset(name),
      { active: () => scene.activePreset }),
    chips('Go to', Object.keys(scene.viewpoints), (name) => scene.goTo(name)),

    group('Render', [
      segment('quality', 'Quality', ['low', 'medium', 'high', 'ultra'], {
        onChange: (v) => scene.setQuality(v),
      }),
      toggle('fly', 'Fly'),
      toggle('cinematic', 'Cinematic'),
      toggle('birds', 'Birds'),
    ]),

    group('Light', [
      slider('timeOfDay', 'Time of day', { min: 0, max: 24, step: 0.01, format: hhmm }),
      slider('timeFlow', 'Time flow', { min: -3, max: 3, step: 0.05 }),
      slider('exposure', 'Exposure', { min: 0.4, max: 2, step: 0.01 }),
      slider('godrays', 'God rays', { min: 0, max: 2.2, step: 0.01 }),
      slider('bloom', 'Bloom', { min: 0, max: 2, step: 0.01 }),
      slider('fog', 'Haze', { min: 0, max: 2.5, step: 0.01 }),
    ]),

    group('Wind', [
      slider('windStrength', 'Strength', { min: 0, max: 3, step: 0.01 }),
      slider('windAngle', 'Direction', { min: 0, max: 6.283, step: 0.01, format: deg }),
      slider('windGust', 'Gustiness', { min: 0, max: 2, step: 0.01 }),
      slider('windSpeed', 'Tempo', { min: 0, max: 3, step: 0.01 }),
    ]),

    group('Field', [
      slider('grassDensity', 'Grass density', { min: 0, max: 1.4, step: 0.01 }),
      slider('grassHeight', 'Grass height', { min: 0.3, max: 2.2, step: 0.01 }),
      slider('flowers', 'Flowers', { min: 0, max: 2, step: 0.01 }),
      slider('trees', 'Trees', { min: 0, max: 1.6, step: 0.01 }),
      slider('clouds', 'Clouds', { min: 0, max: 1.6, step: 0.01 }),
      slider('motes', 'Pollen', { min: 0, max: 2.5, step: 0.01 }),
    ], { open: false }),

    group('Paint', [
      slider('painterly', 'Oil blend', { min: 0, max: 1, step: 0.01 }),
      slider('brush', 'Brush wobble', { min: 0, max: 3, step: 0.01 }),
      slider('paper', 'Paper tooth', { min: 0, max: 1.4, step: 0.01 }),
      slider('saturation', 'Saturation', { min: 0.4, max: 1.7, step: 0.01 }),
      slider('contrast', 'Contrast', { min: 0.7, max: 1.5, step: 0.01 }),
      slider('vignette', 'Vignette', { min: 0, max: 1.2, step: 0.01 }),
      slider('aberration', 'Lens fringe', { min: 0, max: 1.5, step: 0.01 }),
      slider('fov', 'Field of view', { min: 30, max: 100, step: 1, format: degrees,
        onChange: () => scene.applyFov() }),
    ], { open: false }),

    action('Reset', () => scene.resetParams()),
  ];
}

export { defaults };
