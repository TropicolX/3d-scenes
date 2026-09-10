# Scenes

Every folder in here that contains a `scene.js` is picked up automatically.
Drop a folder in and it appears in the launcher; delete the folder and it's
gone, with nothing else to update.

Scenes never import from each other. Anything two scenes need belongs in
`src/engine/`.

## Adding one

```bash
cp -r src/scenes/sandbox src/scenes/my-scene
```

Then change the `id` in `scene.js` — that's the only edit required.

## The two files

**`scene.js`** — metadata only, so the launcher can list every scene without
loading any of them:

```js
export default {
  id: 'my-scene',                 // unique; also the ?scene= value
  name: 'My Scene',
  blurb: 'One line for the launcher card.',
  tags: ['interior'],
  accent: '#9fc47a',              // card highlight
  poster: '/posters/my-scene.png',// optional, from public/
  order: 100,                     // launcher sort
  load: () => import('./index.js'),
};
```

**`index.js`** — default-exports a class extending `Scene`:

```js
export default class MyScene extends Scene {
  async init(ctx) {}      // build the world; awaited before the first frame
  update(dt, elapsed) {}  // per-frame simulation
  render() {}             // draw to the canvas (default renders three + camera)
  resize(w, h, dpr) {}
  dispose() {}            // free GPU resources
}
```

Set `this.three` (a `THREE.Scene`), `this.camera`, and optionally
`this.controller`. Scenes own their whole render path, so a scene can use post
processing, a different camera model, or plain forward rendering — it can't
affect anything else.

## What `ctx` gives you

| | |
|---|---|
| `renderer`, `canvas`, `size` | the shared WebGL context and viewport |
| `input` | keyboard / pointer-lock / touch, via named actions |
| `assets` | cached texture, glTF and audio loading |
| `audio` | music + sfx buses |
| `store` | namespaced localStorage for this scene |
| `node(def)` | register something devtools can select and inspect |
| `setStatus(text)` | line on the loading screen |

## Making a scene inspectable

Set `this.schema` (see `engine/Params.js`) and `this.params`, and the control
panel builds itself. Set `this.baselineParams` too and handoffs will report
which values you moved off default.

Register a node per meaningful thing:

```js
ctx.node({
  id: 'props',
  name: 'Props',
  kind: 'props',                    // system | props | fx | post | data | mesh | light | audio
  object: this.propGroup,           // toggled by the outliner's visibility eye
  source: 'src/scenes/my-scene/index.js',
  note: 'what this is, in one line',
  stats: () => ({ count: this.props.length }),
  target: this.params,              // object the params below address
  params: [...],                    // schema fragment, live-editable in the inspector
  actions: { Reshuffle: () => this.rebuild() },
  pick: { at: (worldPoint) => ({ ... }) },
});
```

### Picking

Dev mode raycasts ordinary meshes directly. Two rules matter:

- **A mesh displaced in its vertex shader must set
  `mesh.userData.devPickable = false`.** Its CPU geometry doesn't match what
  you see, so raycasting it returns nonsense. Implement `raycastGround(ray)` on
  the scene instead — dev mode uses that to find the world point, then asks each
  node's `pick.at(point)` what lives there.
- **Broad surfaces set `pick: { surface: true }`.** That lets instanced props
  win the selection instead of the ground underneath them. Alt-click cycles
  through everything under the cursor.

`pick.at` returns `{ label, position, instance?, radius?, height? }`. Include
`instance` for a concrete thing (an index into an instanced buffer) — that's
what makes a handoff precise enough to act on.
