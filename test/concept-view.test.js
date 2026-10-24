// PURPLE CONCEPT - the 3D view v3 (concept/view/view3d.js + car3d.js + mesh3d.js + parts3d.js), the parts that run in Node: the
// EI.conceptView contract (exports, views, method names the lab / standalone page / film tool call), the honesty label, the
// parameter-effect table, layout(), change tags, the wing-chain and mesh maths, the material looks. Dimensions are measured in
// test/concept-view-dims.test.js; the WebGL part is checked in a browser (docs/concept/VIEW.md).
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const parts = require("../concept/parts.js"), design = require("../concept/design.js"), materials = require("../concept/materials.js");
const view = require("../concept/view/view3d.js");
const m3 = require("../concept/view/mesh3d.js"), car3d = require("../concept/view/car3d.js"), p3 = require("../concept/view/parts3d.js");
const SRC = ["view3d.js", "parts3d.js", "car3d.js", "mesh3d.js", "index.html"].map(f => fs.readFileSync(path.join(__dirname, "..", "concept", "view", f), "utf8")).join("\n");

test("conceptView exports the v1/v2 API (mount, buildCar, layout, LABEL, EFFECTS, VIEWS, FIX, DEFAULTS, RAMP, reducedMotion, labelText)", () => {
  for (const k of ["mount", "buildCar", "layout", "reducedMotion", "labelText", "changesBetween"]) assert.equal(typeof view[k], "function", k);
  for (const k of ["LABEL", "EFFECTS", "VIEWS", "FIX", "DEFAULTS", "RAMP", "MODES"]) assert.ok(view[k] != null, k);
  for (const v of ["hero", "front34", "rear34", "side", "top", "front", "rear", "frontwing", "rearwing", "floor", "sidepod", "diffuser", "cockpit", "wheel"]) {
    const V = view.VIEWS[v]; assert.ok(V, v); assert.equal(V.target.length, 3); assert.ok(V.radius > 0);
  }
  assert.deepEqual(view.MODES, ["solid", "xray-mass", "materials"]);
  // every method or field a caller uses on the mounted view is still returned by mount()
  const ret = SRC.slice(SRC.indexOf("return {\n      setDesign"));
  for (const m of ["setDesign", "setHighlight", "setMode", "setView", "setAero", "screenshot", "labelText", "stats", "dispose", "render:", "state:", "el:", "canvas:", "ready:"]) assert.ok(ret.includes(m), m);
  // buildCar keeps its group contract
  for (const m of ["group.ready", "group.setDesign", "group.setAero", "group.dispose", "frontAxleX", "rearAxleX", "wheelCentreY"]) assert.ok(SRC.includes(m), m);
});

test("honesty: the in-view label says concept geometry built to the dimensions, not a team CAD model; never CFD / wind tunnel / validated", () => {
  assert.equal(view.LABEL, "concept geometry built to the design's dimensions · FIA 2026 frame · not a team CAD model");
  assert.equal(view.labelText(), view.LABEL);
  assert.doesNotMatch(SRC, /\bCFD\b|wind tunnel|validated/i);
});

test("EFFECTS names what every shape parameter builds", () => {
  for (const s of parts.PARAMS) assert.ok(view.EFFECTS[s.part + "." + s.param], s.part + "." + s.param);
  assert.doesNotMatch(Object.values(view.EFFECTS).join(" "), /schematic/);
});

test("layout(): deterministic, in mm, carries the params; exaggerate is a display gain (1 = true geometry)", () => {
  const B = design.baseline("redbull"), L0 = view.layout(B.params), L1 = view.layout(design.clone(B).params);
  assert.deepEqual(L0, L1);
  assert.equal(L0.fw.n, 3); assert.equal(L0.rw.n, 2); assert.equal(L0.floor.W, 1450); assert.equal(L0.rh, 35); assert.equal(L0.XR, 3400);
  assert.equal(L0.params, B.params);
  const d = design.clone(B); Object.assign(d.params.front_wing, { elements: 2, span_mm: 1340 }); d.params.layout.wheelbase_mm = 3300;
  const L = view.layout(d.params); assert.equal(L.fw.n, 2); assert.equal(L.fw.span, 1340); assert.equal(L.XR, 3300);
  const Lx = view.layout(d.params, { exaggerate: 3, base: B.params }); assert.equal(Lx.params.front_wing.aoa_deg, d.params.front_wing.aoa_deg);
  assert.equal(view.layout(d.params, { exaggerate: 1, base: B.params }).params, d.params);
});

test("change tags: parameter and material changes by part, from → to with units", () => {
  const B = design.baseline("redbull");
  const d = design.applyChanges(B, [{ part: "front_wing", param: "span_mm", to: 1240 }, { part: "front_wing", param: "elements", to: 2 }, { part: "floor", param: "material", to: "al_7075_t6" }]).design;
  const ch = view.changesBetween(B, d);
  const fw = ch.find(c => c.part === "front_wing"), fl = ch.find(c => c.part === "floor");
  assert.ok(fw && fw.lines.some(l => /span 1300 → 1240 mm/.test(l)) && fw.lines.some(l => /profile volumes 3 → 2/.test(l)), JSON.stringify(ch));
  assert.ok(fl && /^material .* → .*7075/.test(fl.lines[0]), JSON.stringify(ch));
  assert.deepEqual(view.changesBetween(B, design.clone(B)), []);
});

test("wing chains: the chain's X extent is the chord; flaps at the setting, main plane at 1/5 of it; elements stack upward", () => {
  for (const n of [1, 2, 3, 4]) {
    const els = car3d.chainSection(500, n, 25), polys = car3d.sectionPolys(els, 0, 0, 0);
    let x0 = Infinity, x1 = -Infinity; for (const p of polys) for (const q of p.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
    assert.ok(Math.abs(x1 - x0 - 500) < 1.5, "X extent = chord for n=" + n + " (" + (x1 - x0).toFixed(2) + ")");
    assert.equal(els.length, n);
    for (let i = 1; i < n; i++) { assert.ok(els[i].le[1] > els[i - 1].le[1], "element " + i + " LE above the previous"); assert.ok(Math.abs(els[i].a - 25 * Math.PI / 180) < 1e-12); }
    if (n >= 2) assert.ok(Math.abs(els[0].a - 5 * Math.PI / 180) < 1e-12);
  }
  const f = m3.foil(0.075, 0.42, 0.115, 20);
  assert.equal(f.n, 41); assert.ok(m3.area2(f.ring) > 0.05);
});

test("mesh kit: closed lofts are oriented outward, slabs have the requested thickness, monotone cubic through its anchors", () => {
  const M = m3.mesh(); m3.solidLoft(M, [0, 1, 2].map(k => m3.superellipse(1, 1, 2, 24).map(([a, b]) => [k, a, b])));
  const g = M.finish(); let vol = 0; for (let i = 0; i < g.idx.length; i += 3) { const a = g.idx[i] * 3, b = g.idx[i + 1] * 3, c = g.idx[i + 2] * 3, P = g.pos; vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; }
  assert.ok(vol > 6, "outward volume " + vol);
  const S = m3.mesh(); m3.slab(S, m3.roundPoly([[0, 0, 5], [100, 0, 5], [100, 40, 5], [0, 40, 5]]), m3.frameXY(0), 10, 3, 4); const bb = S.bbox(); assert.ok(Math.abs(bb.hi[2] - bb.lo[2] - 10) < 1e-9);
  const xs = [-1.85, -0.485, -0.105, 1.825, 3.04], ys = [-2.0, -0.55, -0.12, 1.86, 3.04], mc = m3.monoCubic(xs, ys, 1);
  xs.forEach((x, i) => assert.ok(Math.abs(mc.f(x) - ys[i]) < 1e-9));
  let prev = -Infinity; for (let x = -2.5; x <= 3.5; x += 0.01) { const y = mc.f(x); assert.ok(y >= prev - 1e-12); prev = y; }
  assert.ok(Math.abs(mc.f(-2.85) - (ys[0] - 1)) < 1e-9);
});

test("materials: every material in concept/materials.js has a look; fixed (regulation) parts have one too", () => {
  for (const m of materials.MATERIALS) assert.ok(p3.LOOKS[m.id], "look for " + m.id);
  for (const id of ["halo", "wheels_front", "wheels_rear", "brakes_front", "brakes_rear"]) assert.ok(p3.LOOKS[p3.FIXED_LOOK[id]], id);
  // a design naming a material builds (the v2 morph interpolated every key and broke on the string)
  const d = design.applyChanges(design.baseline(), [{ part: "front_wing", param: "material", to: "ti64" }]).design;
  const S = car3d.spec(d.params); assert.equal(S.materials.front_wing, "ti64");
  assert.ok(car3d.buildGroup("front_wing", S, {}).items.length > 10);
});
