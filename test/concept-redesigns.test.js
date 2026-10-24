// PURPLE CONCEPT - redesigns v1 (docs/concept/REDESIGNS.md): the concept-family contract shared with the 3D view and the
// autonomous engine, each family's effect on the mass sheet and the aero map, the packaging rules, the interactions, and the
// difficulty v1 costs (range edges, parc fermé cooling, the driver's aero-balance window). Pure and deterministic; no network.
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const parts = require("../concept/parts.js"), design = require("../concept/design.js"), aeromap = require("../concept/aeromap.js");
const physical = require("../concept/physical.js"), regs = require("../concept/regs.js"), sim = require("../concept/sim/index.js");
const space = require("../concept/campaign/space.js");

const ROOT = path.join(__dirname, "..");
const RB = design.baseline("redbull"), GEN = design.baseline();
const ap = (d, list) => design.applyChanges(d, list.map(([part, param, to]) => ({ part, param, to }))).design;
const ids = d => regs.check(d).map(v => v.id);
const lap = d => sim.simulateLap(physical.physical(d), "silverstone").lap_s;
const cla = pc => pc.aero.corner.CLA_front_m2 + pc.aero.corner.CLA_rear_m2;

// the contract (REDESIGNS.md §1): exact keys, integer codes, code ids, baseline codes
const CONTRACT = {
  "sidepods.concept": ["downwash", "zeropod", "ramp"], "nose.concept": ["long_low", "short_high"], "front_wing.endplate": ["open_outwash", "closed_inwash"],
  "rear_wing.style": ["low_drag", "medium", "high_df"], "floor.edge": ["simple", "scrolled"], "cooling.layout": ["standard", "airbox_gills", "compact"],
  "engine_cover.style": ["high_fin", "low_narrow"], "suspension.front": ["pushrod", "pullrod"],
};
const BASE = { "sidepods.concept": 0, "nose.concept": 0, "front_wing.endplate": 0, "rear_wing.style": 1, "floor.edge": 0, "cooling.layout": 0, "engine_cover.style": 0, "suspension.front": 0 };

test("contract: the eight concept families, their integer codes and ids, baseline codes, after every continuous parameter", () => {
  assert.deepEqual(parts.CONCEPT_KEYS, Object.keys(CONTRACT));
  for (const key of Object.keys(CONTRACT)) {
    const c = parts.CONCEPTS[key], [part, param] = key.split("."), s = parts.PARAMS.find(x => x.part === part && x.param === param);
    assert.ok(c && s, key);
    assert.deepEqual(c.codes.map(x => x.id), CONTRACT[key], key + " ids"); assert.deepEqual(c.codes.map(x => x.code), CONTRACT[key].map((_, i) => i));
    assert.equal(c.base, BASE[key]); assert.equal(s.int, true); assert.equal(s.min, 0); assert.equal(s.max, CONTRACT[key].length - 1); assert.equal(s.step, 1);
    for (const b of [RB, GEN]) assert.equal(b.params[part][param], BASE[key], key + " baseline");
    assert.equal(parts.concept(RB.params, key), CONTRACT[key][BASE[key]]);
  }
  assert.deepEqual(parts.PARAMS.slice(-8).map(s => s.part + "." + s.param), parts.CONCEPT_KEYS, "concept families come last");
  assert.ok(parts.BY_ID.suspension && parts.BY_ID.suspension.params.front && parts.BY_ID.cooling.params.layout);
  // the campaign searches them as integer coordinates; applyChanges quantises
  assert.deepEqual(space.VARS.slice(-8).map(v => v.key), parts.CONCEPT_KEYS);
  assert.equal(ap(RB, [["sidepods", "concept", 1.4]]).params.sidepods.concept, 1);
  assert.match(design.describeChange({ part: "sidepods", param: "concept", from: 0, to: 2 }), /downwash \(0\) → ramp \(2\)/);
});

test("baselines are unchanged: every concept effect is the identity at the baseline codes; old designs migrate to them", () => {
  const e = aeromap.evaluate(RB.params);
  assert.ok(Math.abs(e.df - 1) < 1e-12 && Math.abs(e.cd - 1) < 1e-12 && Math.abs(e.balance - 0.435) < 1e-12);
  assert.equal(e.concepts.cool, 1); assert.deepEqual(Object.values(e.concepts.df), [1, 1, 1, 1]);
  const pc = physical.physical(RB); assert.equal(pc.stability.grip_factor, 1); assert.equal(pc.aero.yaw_sens, undefined);
  assert.deepEqual(pc.concepts, { sidepods: "downwash", nose: "long_low", fw_endplate: "open_outwash", rw_style: "medium", floor_edge: "simple", cooling: "standard", cover: "high_fin", fsusp: "pushrod" });
  // a design saved before redesigns v1 (no concept keys) reads the baseline codes everywhere
  const old = design.clone(RB); for (const k of parts.CONCEPT_KEYS) { const [p, q] = k.split("."); delete old.params[p][q]; }
  assert.equal(parts.concept(old.params, "rear_wing.style"), "medium");
  assert.deepEqual(parts.massSheet(old.params).exact, parts.massSheet(RB.params).exact);
  const m = design.migrate(old); assert.equal(design.validate(m).ok, true); assert.ok(m.migrated.some(x => /redesigns v1/.test(x.rule)));
});

test("every concept switch changes the car on purpose: mass sheet and aero map move, in the documented directions", () => {
  const A = d => aeromap.evaluate(d.params), M = d => parts.massSheet(d.params).exact;
  const a0 = A(RB);
  const row = (k, to) => { const [p, q] = k.split("."); return ap(RB, [[p, q, to]]); };
  // zeropod: less body drag and floor load, lighter pod, cooling packaging 0.78 with the standard layout
  const z = A(row("sidepods.concept", 1)); assert.ok(z.breakdown.body.cd < a0.breakdown.body.cd && z.breakdown.floor.df < a0.breakdown.floor.df); assert.ok(Math.abs(z.cooling.capacity - 0.78) < 1e-9);
  assert.ok(parts.massSheet(row("sidepods.concept", 1).params).parts.find(r => r.id === "sidepods").mass_kg < parts.massSheet(RB.params).parts.find(r => r.id === "sidepods").mass_kg);
  // ramp: more floor and rear-wing load, more body drag
  const r = A(row("sidepods.concept", 2)); assert.ok(r.breakdown.floor.df > a0.breakdown.floor.df && r.breakdown.rear_wing.df > a0.breakdown.rear_wing.df && r.breakdown.body.cd > a0.breakdown.body.cd);
  // short high nose: front wing load down, floor up, balance rearwards, heavier and higher nose
  const n = A(row("nose.concept", 1)); assert.ok(n.breakdown.front_wing.df < a0.breakdown.front_wing.df && n.breakdown.floor.df > a0.breakdown.floor.df && n.balance < a0.balance);
  assert.ok(M(row("nose.concept", 1)).cog_height_mm > M(RB).cog_height_mm);
  // closed inwash endplate: front wing up, wheels drag up, floor down, balance forwards
  const c = A(row("front_wing.endplate", 1)); assert.ok(c.breakdown.front_wing.df > a0.breakdown.front_wing.df && c.breakdown.wheels.cd > a0.breakdown.wheels.cd && c.balance > a0.balance);
  // rear wing styles bracket the current one
  const lo = A(row("rear_wing.style", 0)), hi = A(row("rear_wing.style", 2));
  assert.ok(lo.df < a0.df && lo.cd < a0.cd && lo.balance > a0.balance); assert.ok(hi.df > a0.df && hi.cd > a0.cd && hi.balance < a0.balance);
  // scrolled floor edge: more floor load, rearwards, peakier (more ride-height sensitive)
  const s = A(row("floor.edge", 1)); assert.ok(s.breakdown.floor.df > a0.breakdown.floor.df && s.balance < a0.balance);
  assert.ok(aeromap.rideSensitivity(row("floor.edge", 1).params) > aeromap.rideSensitivity(RB.params));
  // cooling layouts: airbox + gills cools more for drag and mass; compact cools less
  const g = A(row("cooling.layout", 1)), k = A(row("cooling.layout", 2));
  assert.ok(g.cooling.capacity > 1.1 && g.cd > a0.cd && M(row("cooling.layout", 1)).cog_height_mm > M(RB).cog_height_mm); assert.ok(k.cooling.capacity < 0.95);
  // low narrow cover: less body drag, lower CoG, a yaw-sensitive car and a narrower balance window
  const lc = row("engine_cover.style", 1), l = A(lc), pl = physical.physical(lc);
  assert.ok(l.breakdown.body.cd < a0.breakdown.body.cd && M(lc).cog_height_mm < M(RB).cog_height_mm && pl.aero.yaw_sens > 0 && pl.stability.window[1] < physical.BALANCE_WINDOW.fwd);
  // pullrod: stiffer platform, lower front suspension
  const pr = row("suspension.front", 1);
  assert.ok(parts.heaveRatio(pr.params) > parts.heaveRatio(RB.params) && physical.physical(pr).aero.heave_n_per_mm > physical.physical(RB).aero.heave_n_per_mm);
  assert.ok(parts.massSheet(pr.params).parts.find(x => x.id === "front_suspension").z_mm < parts.massSheet(RB.params).parts.find(x => x.id === "front_suspension").z_mm);
});

test("packaging rules and interactions: zeropod needs compact cooling (or gills), ramp needs its undercut, airbox needs the fin", () => {
  assert.ok(ids(ap(RB, [["sidepods", "concept", 1]])).includes("PKG-COOLING"), "a zeropod on the standard layout is short of cooling");
  assert.ok(ids(ap(RB, [["sidepods", "concept", 1], ["sidepods", "inlet_cm2", 760]])).includes("PKG-COOLING"), "even at its 760 cm² cap");
  assert.deepEqual(ids(ap(RB, [["sidepods", "concept", 1], ["cooling", "layout", 2], ["sidepods", "inlet_cm2", 730]])), []);
  assert.ok(ids(ap(RB, [["sidepods", "concept", 1], ["cooling", "layout", 2], ["sidepods", "inlet_cm2", 780]])).includes("PKG-ZEROPOD-INLET"));
  assert.ok(ids(ap(RB, [["sidepods", "concept", 2]])).includes("PKG-RAMP-UNDERCUT"));
  assert.ok(ids(ap(RB, [["cooling", "layout", 1], ["engine_cover", "style", 1]])).includes("PKG-AIRBOX-COVER"));
  assert.deepEqual(ids(ap(RB, [["cooling", "layout", 1]])), []);
  // a scrolled edge gives the zeropod back half of its floor loss (interaction: the pair is not the sum)
  const fl = d => aeromap.evaluate(d.params).breakdown.floor.df, f0 = fl(RB);
  const za = fl(ap(RB, [["sidepods", "concept", 1]])) - f0, sb = fl(ap(RB, [["floor", "edge", 1]])) - f0, zs = fl(ap(RB, [["sidepods", "concept", 1], ["floor", "edge", 1]])) - f0;
  assert.ok(zs - za - sb > 1e-4, "zeropod × scrolled floor interaction " + (zs - za - sb));
  // the high-downforce rear wing and the scrolled floor move the balance rearwards together, out of the driver's window ...
  const both = ap(RB, [["rear_wing", "style", 2], ["floor", "edge", 1]]), pb = physical.physical(both);
  assert.ok(pb.stability.excess > 0 && pb.stability.grip_factor < 1, JSON.stringify(pb.stability));
  // ... and the front wing must follow: more front wing brings it back inside the window and is faster
  // (more setting on 3 volumes needs a shorter chord in the front-wing Z envelope and loses load; 2 volumes take 32° at 575 mm)
  const fixed = ap(both, [["front_wing", "elements", 2], ["front_wing", "aoa_deg", 32], ["front_wing", "chord_mm", 575]]);
  assert.deepEqual(ids(fixed), []); assert.ok(physical.physical(fixed).stability.excess < pb.stability.excess); assert.ok(lap(fixed) < lap(both));
});

test("difficulty v1: range edges at half rate, parc fermé cooling, the driver's aero-balance window", () => {
  const df = (k, v) => { const [p, q] = k.split("."); return aeromap.evaluate(ap(RB, [[p, q, v]]).params).df; };
  // the last 50 mm of front-wing span carry half the load of the 50 mm before them (load only; the drag of the real area is kept)
  const inner = df("front_wing.span_mm", 1300) - df("front_wing.span_mm", 1250), outer = df("front_wing.span_mm", 1350) - df("front_wing.span_mm", 1300);
  assert.ok(outer < 0.6 * inner && outer > 0.3 * inner, inner + " / " + outer);
  const fwi = df("floor.width_mm", 1450) - df("floor.width_mm", 1400), fwo = df("floor.width_mm", 1500) - df("floor.width_mm", 1450);
  assert.ok(fwo < 0.6 * fwi, fwi + " / " + fwo);
  // straight-mode flap past the reference (rear 15°) sheds half as much per degree
  const cdS = v => aeromap.evaluate(ap(RB, [["rear_wing", "sm_delta_deg", v]]).params).cd_sm;
  assert.ok(cdS(25) - cdS(30) < 0.6 * (cdS(10) - cdS(15)));
  // parc fermé: the car is cooled for the race (need 0.95 × 1.05), so the baseline has no cooling to give away
  const c = aeromap.evaluate(RB.params).cooling; assert.ok(Math.abs(c.required - 0.9975) < 1e-12 && c.capacity >= c.required);
  assert.ok(ids(ap(RB, [["sidepods", "inlet_cm2", 640]])).includes("PKG-COOLING"));
  // balance window: inside costs nothing, outside costs grip quadratically; the forward side is narrower
  const w = physical.balanceWindow;
  assert.equal(w(0.01, 0).grip_factor, 1); assert.equal(w(-0.014, 0).grip_factor, 1);
  assert.ok(w(0.022, 0).grip_factor < w(0.017, 0).grip_factor && w(0.017, 0).grip_factor < 1);
  assert.ok(w(0.014, 0).grip_factor < 1 && w(-0.014, 0).grip_factor === 1, "forward side 1.2 points, rearward 1.5");
  const pc = physical.physical(ap(RB, [["rear_wing", "aoa_deg", 14]])); assert.ok(pc.stability.excess > 0 && pc.tyres.mu_y < physical.physical(RB).tyres.mu_y);
});

test("docs: REDESIGNS.md carries the contract, every family and its rules, and keeps the honesty rules", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs/concept/REDESIGNS.md"), "utf8");
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "wind" + "-tunnel", "valid" + "ated"].join("|"), "i");
  assert.equal(banned.exec(doc), null);
  for (const k of parts.CONCEPT_KEYS) { assert.ok(doc.includes("`" + k + "`"), k); for (const id of CONTRACT[k]) assert.ok(doc.includes(id), k + " " + id); }
  for (const r of regs.CONCEPT_RULES) assert.ok(doc.includes(r.id), "REDESIGNS.md names " + r.id);
  for (const s of ["## 1. Contract", "parc fermé", "balance window", "± "]) assert.ok(doc.includes(s), s);
});
