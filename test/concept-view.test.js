// PURPLE CONCEPT - the 3D view (concept/view/view3d.js + parts3d.js), the parts that run in Node: the EI.conceptView v1 contract
// (exports, views, method names the lab / standalone page / film tool call), the honesty label, the parameter-effect table, layout()
// and the wing / deformation maths. The WebGL part is checked in a browser (docs/concept/VIEW.md).
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const parts = require("../concept/parts.js"), design = require("../concept/design.js");
const view = require("../concept/view/view3d.js");
const p3 = require("../concept/view/parts3d.js");
const SRC = ["view3d.js", "parts3d.js", "index.html"].map(f => fs.readFileSync(path.join(__dirname, "..", "concept", "view", f), "utf8")).join("\n");

test("conceptView exports the v1 API (mount, layout, LABEL, EFFECTS, VIEWS, FIX, DEFAULTS, RAMP, reducedMotion, labelText)", () => {
  for (const k of ["mount", "buildCar", "layout", "reducedMotion", "labelText"]) assert.equal(typeof view[k], "function", k);
  for (const k of ["LABEL", "EFFECTS", "VIEWS", "FIX", "DEFAULTS", "RAMP"]) assert.ok(view[k] != null, k);
  for (const v of ["hero", "front34", "rear34", "side", "top", "front", "rear", "frontwing", "rearwing"]) {
    const V = view.VIEWS[v]; assert.ok(V, v); assert.equal(V.target.length, 3); assert.ok(V.radius > 0);
  }
  // every method or field a caller uses on the mounted view is still returned by mount()
  const ret = SRC.slice(SRC.indexOf("return {\n      setDesign"));
  for (const m of ["setDesign", "setHighlight", "setMode", "setView", "setAero", "screenshot", "labelText", "stats", "dispose", "render:", "state:", "el:", "canvas:", "ready:"]) assert.ok(ret.includes(m), m);
});

test("honesty: the in-view label says schematic, never CFD / wind tunnel / validated", () => {
  assert.match(view.LABEL, /^concept geometry from the design parameters/);
  assert.match(view.LABEL, /schematic, not a CAD model/);
  assert.equal(view.labelText(), view.LABEL);
  assert.doesNotMatch(SRC, /\bCFD\b|wind tunnel|validated/i);
});

test("EFFECTS names what every shape parameter drives", () => {
  for (const s of parts.PARAMS) assert.ok(view.EFFECTS[s.part + "." + s.param], s.part + "." + s.param);
});

test("layout(): deterministic, in mm, and different designs give different geometry", () => {
  const B = design.baseline("redbull"), L0 = view.layout(B.params), L1 = view.layout(design.clone(B).params);
  assert.deepEqual(L0, L1);
  assert.equal(L0.fw.n, 3); assert.equal(L0.rw.n, 2); assert.equal(L0.floor.W, 1450); assert.equal(L0.rh, 35);
  assert.ok(L0.XR > 3000 && L0.XR < 3800);
  const d = design.clone(B);
  Object.assign(d.params.front_wing, { elements: 2, span_mm: 1400 }); Object.assign(d.params.rear_wing, { endplate_top_mm: 900, sm_delta_deg: 25 });
  Object.assign(d.params.floor, { width_mm: 1600 }); d.params.diffuser.expansion_deg = 18; d.params.layout.wheelbase_mm = 3550;
  const L = view.layout(d.params);
  assert.equal(L.fw.n, 2); assert.equal(L.fw.span, 1400); assert.equal(L.rw.E, 900); assert.equal(L.rw.sm, 25);
  assert.equal(L.floor.W, 1600); assert.equal(L.floor.deg, 18); assert.ok(L.XR > L0.XR + 100);
  // exaggerate (display gain) moves wing settings away from the baseline, 1 = true geometry
  const Lx = view.layout(d.params, { exaggerate: 3, base: B.params });
  assert.equal(Lx.fw.span, 1400); assert.equal(view.layout(d.params, { exaggerate: 1, base: B.params }).rh, 35);
});

test("wing maths: element chains span the chord, flaps sit above the main plane, angles follow the setting", () => {
  for (const n of [1, 2, 3, 4]) {
    const ang = p3.elementAngles(n, 20, 0.5, 1.7), ch = p3.chain(n, ang, 500);
    assert.equal(ch.length, n);
    let x0 = Infinity, x1 = -Infinity; for (const e of ch) { x0 = Math.min(x0, e.le[0]); x1 = Math.max(x1, e.le[0] + e.c * Math.cos(e.a)); }
    assert.ok(Math.abs(x1 - x0 - 500) < 1e-6, "X extent = chord for n=" + n);
    for (let i = 1; i < n; i++) assert.ok(ch[i].le[1] > ch[i - 1].le[1], "element " + i + " LE above the previous one");
  }
  assert.ok(p3.elementAngles(3, 30, 0.22)[2] > p3.elementAngles(3, 15, 0.22)[2]);
  const f = p3.foil(0.075, 0.42, 0.115, 20);
  assert.equal(f.upper.length, 21); assert.equal(f.lower.length, 21);
  const a = f.upper[f.upper.length - 1], b = f.lower[0];   // the two surfaces meet at the leading edge
  assert.ok(Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12);
});

test("monoCubic: through the anchors, monotone between them, rigid outside", () => {
  const xs = [-1.85, -0.485, -0.105, 1.825, 3.054], ys = [-2.0, -0.55, -0.12, 1.86, 3.054], m = p3.monoCubic(xs, ys);
  xs.forEach((x, i) => assert.ok(Math.abs(m.f(x) - ys[i]) < 1e-9));
  let prev = -Infinity; for (let x = -2.5; x <= 3.5; x += 0.01) { const y = m.f(x); assert.ok(y >= prev - 1e-12); prev = y; }
  assert.ok(Math.abs(m.f(-2.85) - (ys[0] - 1)) < 1e-9); assert.equal(m.df(10), 1);
});
