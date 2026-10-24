# PURPLE · concept car 3D view v2

`concept/view/view3d.js` (`EI.conceptView`, same v1 API) + `concept/view/parts3d.js` (geometry). Branch `claude/view-v2`.
Replaces the v1 procedural car (Tanuj: "looks fake").

## What is on screen

- **Body**: the game's high-detail car (`assets/models/ei-car-hi.glb`, loaded with `js/carglb.js`) with the game's materials (triplanar
  carbon, clear-coated paint with flake, helmet, wheel covers, Pirelli sidewalls) and the team livery (`js/liveries/*`, composed by
  `EI.CarGLB.composeLivery`). Default Red Bull; a design's `livery` ("redbull-rb22") picks the team, its `driver` ("HAD") the number and
  helmet.
- **Deformed by the design**: x remapped by a monotone cubic through the design's anchors (cell front XA, cockpit rear XC, ICE face XPU,
  rear axle XR), ride height moves the sprung body (wheels stay on the ground, suspension arms blend body → upright), sidepod inlet mouth
  scaled with √(inlet area), lower outer flank pushed in by the undercut.
- **Rebuilt procedurally from the parameters** (the GLB's own wings and floor are dropped): front wing (1–4 lofted cambered elements
  with slot gaps, spanwise twist / taper / tip rise, endplates with the livery's endplate decals, footplates, dive planes), rear wing
  (1–4 elements, spoon centre, endplates up to `endplate_top_mm` with livery decals, swan-neck pylons, actuator pod), floor (planform
  from `width_mm`, upturned edge, four fences per side under the leading edge, venturi roof from `throat_mm`, edge vanes, plank),
  diffuser (ramp at `expansion_deg`, open exit, six strakes, exit lip).
- **Active aero**: `setAero('cycle'|'corner'|'straight')`; front flaps swing about their LE, rear flap about its TE inboard of Y=535;
  white outline = the straight-mode position.
- **Kept from v1**: purple baseline ghost of the parts that differ (Fresnel outline), amber highlight, x-ray mass mode (spheres ∝ mass,
  CoG and baseline CoG), view presets (+ `frontwing`, `rearwing`, `floor`), morph animation, reduced motion, screenshot with the label.
- Label: "concept geometry from the design parameters on the game's car model · schematic, not a CAD model". Wing angles are drawn on a
  schematic scale (rear flaps steeper than the lab's setting units so the element reads), said in the legend.

## `EI.conceptView.buildCar` (the concept car in another scene, e.g. the game's Silverstone)

```js
const g = EI.conceptView.buildCar(design, { livery: "redbull-rb22", driver: "HAD", baseline: null, lod: "hi", straight: false });
scene.add(g); await g.ready;          // resolved at once when the game already has the GLB + liveries; else loads them
g.setDesign(otherDesign); g.setAero(1); // 0 = corner, 1 = straight-mode flaps
g.dispose();                          // geometry, materials, livery textures; removes itself from its parent
```

A plain `THREE.Group`, no viewer or renderer. Frame = the game car's (`js/carglb.js`): metres, +x forward, +y up, +z right, ground at
y = 0, front axle at x = +1.75, rear axle at x = 1.75 − wheelbase (−1.65 m at the 3400 mm baseline), wheel centres at y ≈ 0.360
(`g.userData`: `frontAxleX`, `rearAxleX`, `wheelCentreY`, `team`, `driver`). Place it like a game car (position on the line,
`rotation.y` = heading). `lod: "lo"` halves the livery texture (1024 px); geometry is the same. The clear-coat paint wants
`scene.environment`. Needs three r128, `concept/regs.js`, `parts.js` (+ `design.js` for the default design) and `view3d.js`; it loads
`parts3d.js` and anything of the livery pipeline the page lacks. Checked in a bare three.js page: two cars, 0 console errors,
geometries back to the pre-build count after `dispose()` (shot `view-v2-shots/10-buildcar-bare-scene.png`).

## Numbers (headless Chromium, SwiftShader, 2026-10-24)

- Rebuild (`setDesign`, animate off, with ghost): 60 random designs p50 37 ms, p95 55 ms, max 62 ms; first build ~100–150 ms.
- GPU memory bounded: renderer geometries 180–240 across 60 random rebuilds with ghost, x-ray and flap toggles; textures constant (11).
  Every rebuild disposes the previous procedural geometry; `dispose()` frees everything.
- Console errors 0 on `/concept/view/` and `/concept/lab/` (only Chromium's own "GPU stall due to ReadPixels" warnings from screenshots).

Screenshots: `docs/concept/view-v2-shots/` (baseline RB22; the 200-generation optimiser best, seed 1, physics sim, with the baseline
ghost, with highlights, x-ray, straight mode; front wing / rear wing / top pairs baseline vs best; the concept lab).

## Known limits / to do

- **Film tool**: the car now loads asynchronously (GLB + livery, a few seconds), and `concept/tools/film.js` renders frames right
  after `mount()`, so its first frames show "loading the car model and livery…". Two-line fix in `film.js` (outside this lane):
  stage page `window.setup = ...` → `return window.cv.ready().then(() => true);` and poster page
  `return Promise.all([L.ready(), R.ready()]).then(() => { ...existing body...; return true; });` (`page.evaluate` awaits the promise).
- Livery on the procedural wings: endplates and rear-wing tops carry the livery's own decals; the element undersides are the
  livery part colours (no decals).
- The body is the game car deformed, not re-modelled: large wheelbase or cell changes stretch the engine cover / sidepods smoothly.
- Mass tags in x-ray are DOM labels (not in `screenshot()`), as in v1.
