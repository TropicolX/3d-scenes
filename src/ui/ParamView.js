/**
 * Renders a Params schema into DOM. Used by both the in-game panel and the dev
 * inspector, so anything tweakable is tweakable from either.
 */
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function ParamView(container, schema, target, opts = {}) {
  const syncers = [];
  const onAnyChange = opts.onChange || (() => {});
  const compact = opts.compact;

  function render(items, parent) {
    for (const item of items || []) {
      if (!item) continue;
      switch (item.type) {
        case 'group': parent.appendChild(renderGroup(item)); break;
        case 'slider': parent.appendChild(renderSlider(item)); break;
        case 'toggle': parent.appendChild(renderToggle(item)); break;
        case 'segment': parent.appendChild(renderSegment(item)); break;
        case 'chips': parent.appendChild(renderChips(item)); break;
        case 'color': parent.appendChild(renderColor(item)); break;
        case 'action': parent.appendChild(renderAction(item)); break;
        case 'readout': parent.appendChild(renderReadout(item)); break;
        case 'note': parent.appendChild(el('div', 'pv-note', item.text)); break;
        default: break;
      }
    }
  }

  function renderGroup(item) {
    const wrap = el('div', 'pv-group');
    const head = el('div', 'group-title clickable');
    head.append(el('span', null, item.label));
    const rows = el('div', 'group-rows');
    let open = item.open !== false;
    const apply = () => { rows.style.display = open ? '' : 'none'; head.classList.toggle('closed', !open); };
    head.addEventListener('click', () => { open = !open; apply(); });
    render(item.items, rows);
    apply();
    wrap.append(head, rows);
    return wrap;
  }

  function commit(item, value) {
    if (item.key) target[item.key] = value;
    item.onChange?.(value, target);
    onAnyChange(item.key, value, item);
  }

  function renderSlider(item) {
    const row = el('div', 'row');
    const top = el('div', 'row-top');
    const label = el('span', 'row-label', item.label);
    const val = el('span', 'row-val');
    top.append(label, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = item.min; input.max = item.max; input.step = item.step;
    const paint = () => {
      const v = Number(target[item.key]);
      if (document.activeElement !== input) input.value = v;
      val.textContent = item.format ? item.format(v)
        : (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2));
      input.style.setProperty('--pct', `${((v - item.min) / (item.max - item.min)) * 100}%`);
    };
    input.addEventListener('input', () => { commit(item, +input.value); paint(); });
    if (item.hint) row.title = item.hint;
    row.append(top, input);
    syncers.push({ key: item.key, paint });
    paint();
    return row;
  }

  function renderToggle(item) {
    const t = el('div', 'toggle', item.label);
    const paint = () => t.classList.toggle('on', !!target[item.key]);
    t.addEventListener('click', () => { commit(item, !target[item.key]); paint(); });
    if (item.hint) t.title = item.hint;
    syncers.push({ key: item.key, paint });
    paint();
    const holder = el('div', 'toggles');
    holder.appendChild(t);
    return holder;
  }

  function renderSegment(item) {
    const row = el('div', 'row');
    if (!compact) row.appendChild(el('div', 'row-label', item.label));
    const seg = el('div', 'seg');
    const btns = {};
    for (const opt of item.options) {
      const b = document.createElement('button');
      b.textContent = opt;
      b.addEventListener('click', () => { commit(item, opt); paint(); });
      btns[opt] = b;
      seg.appendChild(b);
    }
    const paint = () => {
      for (const [k, b] of Object.entries(btns)) b.classList.toggle('on', target[item.key] === k);
    };
    syncers.push({ key: item.key, paint });
    paint();
    row.appendChild(seg);
    return row;
  }

  function renderChips(item) {
    const wrap = el('div', 'pv-chips');
    if (item.label) wrap.appendChild(el('div', 'group-title', item.label));
    const holder = el('div', 'presets');
    const btns = [];
    item.options.forEach((name, i) => {
      const c = el('div', 'chip', item.numbered === false ? name : (item.numbered ? `${i + 1} ${name}` : name));
      c.addEventListener('click', () => { item.onPick?.(name, i); paint(); });
      btns.push({ name, c });
      holder.appendChild(c);
    });
    const paint = () => {
      const active = typeof item.active === 'function' ? item.active() : item.active;
      for (const { name, c } of btns) c.classList.toggle('on', name === active);
    };
    syncers.push({ key: null, paint });
    paint();
    wrap.appendChild(holder);
    return wrap;
  }

  function renderColor(item) {
    const row = el('div', 'row row-inline');
    row.appendChild(el('span', 'row-label', item.label));
    const input = document.createElement('input');
    input.type = 'color';
    const paint = () => { input.value = target[item.key] || '#ffffff'; };
    input.addEventListener('input', () => commit(item, input.value));
    syncers.push({ key: item.key, paint });
    paint();
    row.appendChild(input);
    return row;
  }

  function renderAction(item) {
    const holder = el('div', 'actions');
    const b = el('div', 'act', item.label);
    if (item.hint) b.title = item.hint;
    b.addEventListener('click', () => item.fn?.(target));
    holder.appendChild(b);
    return holder;
  }

  function renderReadout(item) {
    const row = el('div', 'row row-inline');
    row.appendChild(el('span', 'row-label', item.label));
    const v = el('span', 'row-val');
    const paint = () => { v.textContent = String(item.get()); };
    syncers.push({ key: null, paint });
    paint();
    row.appendChild(v);
    return row;
  }

  render(schema, container);

  return {
    sync(key) {
      for (const s of syncers) if (!key || s.key === key || s.key === null) s.paint();
    },
    destroy() { container.innerHTML = ''; syncers.length = 0; },
  };
}
