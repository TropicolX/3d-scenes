/**
 * A tiny schema DSL. The same schema drives the in-game panel and the dev
 * inspector, so anything tweakable is tweakable from both, and a handoff can
 * report exact parameter paths.
 */
export const group = (label, items, opts = {}) =>
  ({ type: 'group', label, items, open: opts.open !== false });

export const slider = (key, label, o = {}) => ({
  type: 'slider', key, label,
  min: o.min ?? 0, max: o.max ?? 1, step: o.step ?? 0.01,
  format: o.format, onChange: o.onChange, hint: o.hint,
});

export const toggle = (key, label, o = {}) =>
  ({ type: 'toggle', key, label, onChange: o.onChange, hint: o.hint });

export const segment = (key, label, options, o = {}) =>
  ({ type: 'segment', key, label, options, onChange: o.onChange, hint: o.hint });

export const chips = (label, options, onPick, o = {}) =>
  ({ type: 'chips', label, options, onPick, active: o.active });

export const color = (key, label, o = {}) =>
  ({ type: 'color', key, label, onChange: o.onChange });

export const action = (label, fn, o = {}) =>
  ({ type: 'action', label, fn, hint: o.hint });

export const readout = (label, get) => ({ type: 'readout', label, get });

export const note = (text) => ({ type: 'note', text });

/** Walk a schema and yield every leaf that addresses a key. */
export function* leaves(schema) {
  for (const item of schema || []) {
    if (item.type === 'group') yield* leaves(item.items);
    else if (item.key) yield item;
  }
}

/** Current values for every key a schema addresses. */
export function readValues(schema, target) {
  const out = {};
  if (!target) return out;
  for (const item of leaves(schema)) out[item.key] = target[item.key];
  return out;
}

/** Which values differ from a baseline, and by how much. */
export function diffValues(schema, target, baseline) {
  const out = {};
  if (!target || !baseline) return out;
  for (const item of leaves(schema)) {
    const now = target[item.key];
    const was = baseline[item.key];
    if (now === was) continue;
    if (typeof now === 'number' && typeof was === 'number' && Math.abs(now - was) < 1e-6) continue;
    out[item.key] = { from: was, to: now };
  }
  return out;
}
