// PURPLE CONCEPT - coupling v1 (docs/concept/COUPLING.md, MATERIALS.md): every shape parameter and every material reaches the
// physical car that the physics sim laps, in the documented direction; the interaction terms are not additive where the physics
// says they are not; materials change mass, CoG and (through stiffness) aero; ballast keeps the car at the minimum; the baseline
// still maps exactly onto its anchor; everything is deterministic.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const design = require("../concept/design.js"), parts = require("../concept/parts.js"), aeromap = require("../concept/aeromap.js");
const physical = require("../concept/physical.js"), materials = require("../concept/materials.js"), regs = require("../concept/regs.js");
const sim = require("../concept/sim/index.js");
const ROOT = path.join(__dirname, "..");

const RB = design.baseline({ team: "redbull" }), GEN = design.baseline();
const ap = (d, ch) => design.applyChanges(d, ch.map(([part, param, to]) => ({ part, param, to }))).design;
const lap = d => sim.simulateLap(physical.physical(d), "silverstone").lap_s;
const claT = pc => pc.aero.corner.CLA_front_m2 + pc.aero.corner.CLA_rear_m2;
const bal = pc => pc.aero.corner.CLA_front_m2 / claT(pc);

test("baseline: physical(baseline) is still exactly the anchor car, and laps the same time (generic 88.115 s, RB22 88.752 s on sim v2)", () => {
  for (const [d, team, want] of [[GEN, null, 88.115], [RB, "redbull", 88.752]]) {
    const pc = physical.physical(d), A = physical.anchor(team);
    assert.equal(pc.mass_kg, A.mass_kg); assert.equal(pc.cog_height_m, A.cog_height_m); assert.equal(pc.weight_dist_front, A.weight_dist_front);
    for (const k of ["CLA_front_m2", "CLA_rear_m2", "CDA_m2"]) assert.ok(Math.abs(pc.aero.corner[k] - A.aero.corner[k]) < 2e-6 && Math.abs(pc.aero.straight[k] - A.aero.straight[k]) < 2e-6, k);
    assert.ok(Math.abs(lap(d) - want) < 0.0005, (team || "generic") + " lap " + lap(d));
    assert.deepEqual(pc.materials, {}); assert.equal(pc.aero.front_wing_ground_effect, 1);
  }
  const a = aeromap.evaluate(GEN.params);
  assert.ok(Math.abs(a.df - 1) < 1e-12 && Math.abs(a.cd - 1) < 1e-12 && Math.abs(a.balance - 0.435) < 1e-12, "aero map baseline 1.0 / 1.0 / 43.5 %");
});

// every shape parameter: +one step moves the named PhysicalCar quantities in the documented direction, and the lap moves
// (ballast.x_frac is measured with 10 kg of extra ballast: with ~0.2 kg of ballast there is nothing to move)
const SENS = {
  "layout.wheelbase_mm": { to: 3420, ctx: [["layout", "wheelbase_mm", 3300]], expect: { cla: +1, mass: +1 } },
  "survival_cell.front_axle_offset_mm": { to: 85, expect: { wdf: +1 } },
  "survival_cell.cockpit_len_mm": { to: 1960, expect: { wdf: -1, cog: +1 } },
  "survival_cell.bulkhead_gap_mm": { to: 400, expect: { wdf: -1 } },
  "front_wing.span_mm": { to: 1320, expect: { cla: +1, bal: +1, cda: +1 } },
  "front_wing.chord_mm": { to: 590, expect: { cla: +1, bal: +1 } },
  "front_wing.aoa_deg": { to: 26, expect: { cla: +1, bal: +1, cda: +1 } },
  "front_wing.elements": { to: 2, expect: { cla: -1, bal: -1, wdf: -1, cog: -1 } },
  "front_wing.sm_delta_deg": { to: 3, expect: { cdaS: +1 } },
  "rear_wing.span_mm": { to: 1120, expect: { cla: +1, bal: -1 } },
  "rear_wing.chord_mm": { to: 440, expect: { cla: +1, bal: -1, cda: +1 } },
  "rear_wing.aoa_deg": { to: 21, expect: { cla: +1, bal: -1, cda: +1 } },
  "rear_wing.elements": { to: 3, expect: { cla: +1, cda: +1, mass: +1 } },
  "rear_wing.endplate_top_mm": { to: 880, expect: { cda: -1, cog: +1 } },
  "rear_wing.sm_delta_deg": { to: 13, expect: { cdaS: +1 } },
  "floor.width_mm": { to: 1500, expect: { cla: +1 } },
  "floor.throat_mm": { to: 105, expect: { cla: -1 } },
  "floor.ride_height_mm": { to: 37, expect: { cla: -1, cog: +1 } },
  "diffuser.expansion_deg": { to: 15, expect: { cla: +1 } },
  "sidepods.inlet_cm2": { to: 700, expect: { cda: +1, mass: +1 } },
  "sidepods.undercut_mm": { to: 120, expect: { cda: -1, cla: +1 } },
  "ballast.x_frac": { to: 0.5, ctx: [["ballast", "extra_kg", 10]], expect: { wdf: -1 } },
  "ballast.extra_kg": { to: 5, expect: { mass: +1 } },
};
test("sensitivity: every one of the 23 shape parameters moves the physics-sim lap and its PhysicalCar fields in the documented direction", () => {
  assert.deepEqual(Object.keys(SENS).sort(), parts.PARAMS.map(s => s.part + "." + s.param).sort(), "every parameter has a row");
  const q = { cla: claT, bal, cda: pc => pc.aero.corner.CDA_m2, cdaS: pc => pc.aero.straight.CDA_m2, wdf: pc => pc.weight_dist_front, cog: pc => pc.cog_height_m, mass: pc => pc.mass_kg };
  for (const key of Object.keys(SENS)) {
    const [part, param] = key.split("."), row = SENS[key], base = row.ctx ? ap(RB, row.ctx) : RB, d = ap(base, [[part, param, row.to]]);
    const p0 = physical.physical(base), p1 = physical.physical(d);
    for (const f of Object.keys(row.expect)) { const dv = q[f](p1) - q[f](p0); assert.ok(Math.sign(dv) === row.expect[f] && Math.abs(dv) > 1e-9, key + ": " + f + " moved " + dv); }
    const dl = lap(d) - lap(base); assert.ok(Math.abs(dl) >= 0.001, key + ": the lap must move (Δ " + dl + " s)");
  }
});

test("smoothness: a 1 mm cockpit move is a 1 mm move, not a staircase (physical() reads the unrounded mass sheet)", () => {
  const w = [], h = [];
  for (let x = 1925; x <= 1935; x += 5) { const pc = physical.physical(ap(RB, [["survival_cell", "cockpit_len_mm", x]])); w.push(pc.weight_dist_front); h.push(pc.cog_height_m); }
  assert.ok(w[0] > w[1] && w[1] > w[2], "front share falls monotonically: " + w);
  const d1 = w[0] - w[1], d2 = w[1] - w[2]; assert.ok(Math.abs(d1 - d2) < 0.2 * Math.abs(d1), "and evenly: " + d1 + " / " + d2);
  const m = parts.massSheet(RB.params); assert.ok(Math.abs(m.exact.front_share - m.front_share) < 5e-5 && Math.abs(m.exact.total_kg - m.total_kg) < 0.005);
});

test("interactions: the combined effect differs from the sum where the physics couples the terms", () => {
  const A = d => aeromap.evaluate(d.params);
  const interaction = (f, a, b) => { const v0 = f(RB), va = f(ap(RB, a)) - v0, vb = f(ap(RB, b)) - v0, vab = f(ap(RB, a.concat(b))) - v0; return { va, vb, vab, int: vab - va - vb }; };
  // front vs rear wing through the axle balance (the sim limits each axle): far from additive on the lap
  const wings = interaction(lap, [["front_wing", "aoa_deg", 27]], [["rear_wing", "aoa_deg", 22]]);
  assert.ok(Math.abs(wings.int) > 0.05, "front × rear wing lap interaction " + JSON.stringify(wings));
  // floor: throat × ride height (ground effect 1/(rh + k·throat)^β is not separable)
  assert.ok(Math.abs(interaction(d => A(d).df, [["floor", "throat_mm", 90]], [["floor", "ride_height_mm", 32]]).int) > 1e-3);
  // floor width × ride height (planform × ground effect)
  assert.ok(interaction(d => A(d).df, [["floor", "width_mm", 1540]], [["floor", "ride_height_mm", 32]]).int > 5e-4);
  // diffuser × gap: the best expansion falls with the gap, so a steeper diffuser gains less on a lower car ...
  const dg = interaction(d => A(d).df, [["diffuser", "expansion_deg", 17]], [["floor", "ride_height_mm", 32]]);
  assert.ok(dg.int < -1e-3, "diffuser gain shrinks at a lower ride height " + JSON.stringify(dg));
  assert.ok(A(ap(RB, [["floor", "ride_height_mm", 31]])).diffuser_peak_deg < A(RB).diffuser_peak_deg);
  // ... and stalls at a larger gap (stall onset +0.5 mm per degree)
  assert.ok(Math.abs(A(ap(RB, [["diffuser", "expansion_deg", 18]])).stall_onset_mm - A(RB).stall_onset_mm - 2) < 1e-9);
  // rear wing span × endplate: the endplate is worth more on a shorter wing (induced drag ∝ 1/(1 + 1.9 h/b))
  const ep = span => A(ap(RB, [["rear_wing", "span_mm", span], ["rear_wing", "endplate_top_mm", 880]])).cd - A(ap(RB, [["rear_wing", "span_mm", span]])).cd;
  assert.ok(ep(1000) < ep(1150) && ep(1150) < 0, "endplate drag saving larger on the short wing: " + ep(1000) + " vs " + ep(1150));
  // rear wing span × Straight Mode: only the flap inboard of Y=535 moves, so the same flap angle relieves a wider wing less per area
  assert.ok(aeromap.flapShare("rear_wing", { elements: 2, span_mm: 1150 }) < aeromap.flapShare("rear_wing", { elements: 2, span_mm: 1050 }));
  // wheelbase × balance: the same front-wing change moves the balance more on a short car (lever rule)
  const dbal = wb => A(ap(RB, [["layout", "wheelbase_mm", wb], ["front_wing", "aoa_deg", 27]])).balance - A(ap(RB, [["layout", "wheelbase_mm", wb]])).balance;
  assert.ok(dbal(3100) > dbal(3400), "balance shift per front-wing degree larger at WB 3100: " + dbal(3100) + " vs " + dbal(3400));
  // ride height × front wing: a higher car loses front-wing load (ground effect)
  assert.ok(A(ap(RB, [["floor", "ride_height_mm", 45]])).front_wing_ground_effect < 1 && A(ap(RB, [["floor", "ride_height_mm", 30]])).front_wing_ground_effect > 1);
  // sidepod inlet × undercut × cooling: each alone is fine, together they starve the radiators (power derate)
  const cool = interaction(d => physical.physical(d).pu.ice_kw, [["sidepods", "inlet_cm2", 590]], [["sidepods", "undercut_mm", 160]]);
  assert.ok(cool.va === 0 && cool.vb === 0 && cool.vab < -10, "cooling interaction " + JSON.stringify(cool));
  // ballast position × ballast mass: moving ballast moves the weight split in proportion to the ballast there is
  const wdf = interaction(d => physical.physical(d).weight_dist_front, [["ballast", "x_frac", 0.9]], [["ballast", "extra_kg", 10]]);
  assert.ok(wdf.int < -0.005, "ballast position × mass " + JSON.stringify(wdf));
  // ride height × plank: below 32 mm the plank wears (C3.6.1 legality), and the CoG falls with the sprung mass only
  assert.ok(design.facts(ap(RB, [["floor", "ride_height_mm", 28]])).plank_wear_mm > 0 && design.facts(RB).plank_wear_mm === 0);
});

test("materials: the table is complete, sourced, and the browser copy matches concept/data/materials-2026.json", () => {
  const J = JSON.parse(fs.readFileSync(path.join(ROOT, "concept", "data", "materials-2026.json"), "utf8"));
  assert.deepEqual(materials.DATA, J, "run node concept/tools/embed-materials.js after editing the JSON");
  const ids = new Set();
  for (const m of J.materials) {
    assert.ok(!ids.has(m.id), "unique " + m.id); ids.add(m.id);
    for (const k of ["id", "name", "class", "form", "typical_f1_use", "kind", "basis"]) assert.equal(typeof m[k], "string", m.id + "." + k);
    for (const k of ["density_kg_m3", "E_GPa", "tensile_MPa"]) assert.ok(Number.isFinite(m[k]) && m[k] > 0, m.id + "." + k);
    assert.ok(m.fia && typeof m.fia.article === "string" && ["permitted", "specific_use", "forbidden", "not_listed"].includes(m.fia.status) && m.fia.verified === false, m.id + ".fia");
    assert.ok(Array.isArray(m.sources) && m.sources.length && m.sources.every(s => J.sources[s]), m.id + ".sources");
    if (m.form === "laminate") assert.ok(m.fibre && m.fibre.E_GPa > 0 && m.fibre.tensile_MPa > 0 && m.fibre.density_kg_m3 > 0, m.id + ".fibre");
  }
  for (const id of Object.keys(materials.PARTS)) { assert.ok(materials.get(materials.baseOf(id)), id + " base"); assert.ok(parts.MATERIAL_PARTS.includes(id)); }
  assert.deepEqual(parts.MATERIAL_PARTS.slice().sort(), Object.keys(materials.PARTS).sort());
  for (const p of parts.CATALOGUE) assert.ok(materials.supports(p.id) || materials.FIXED[p.id], p.id + ": a material parameter or a stated reason why not");
});

test("materials: the baseline material changes nothing; a lighter one frees ballast (never below the minimum), a heavier one eats it", () => {
  const m0 = parts.massSheet(RB.params);
  for (const id of parts.MATERIAL_PARTS) { const d = design.clone(RB); d.params[id].material = materials.baseOf(id); assert.deepEqual(parts.massSheet(d.params).exact, m0.exact, id); }
  // lighter: T1100G bodywork and wings
  let L = RB; for (const id of ["front_wing", "rear_wing", "floor", "sidepods", "engine_cover", "diffuser"]) L = ap(L, [[id, "material", "cfrp_t1100g"]]);
  const mL = parts.massSheet(L.params);
  assert.ok(mL.exact.parts_kg < m0.exact.parts_kg - 2, "parts lighter: " + mL.exact.parts_kg);
  assert.ok(Math.abs(mL.exact.total_kg - m0.min_kg) < 1e-9, "still exactly at the minimum");
  assert.ok(Math.abs(mL.exact.ballast_kg - m0.exact.ballast_kg - (m0.exact.parts_kg - mL.exact.parts_kg)) < 1e-9, "the saving became ballast");
  assert.ok(mL.exact.cog_height_mm < m0.exact.cog_height_mm, "ballast sits low: the CoG drops");
  const pL = physical.physical(L); assert.ok(pL.cog_height_m < physical.physical(RB).cog_height_m && pL.mass_kg === physical.physical(RB).mass_kg);
  // the freed ballast is now worth placing: it moves the axle split, and placed well it is faster than the baseline
  const back = ap(L, [["ballast", "x_frac", 0.7]]);
  assert.ok(physical.physical(back).weight_dist_front < pL.weight_dist_front - 0.003);
  assert.ok(lap(back) < lap(RB), "lighter parts + ballast placed rearwards beat the baseline: " + lap(back) + " vs " + lap(RB));
  assert.equal(regs.check(back).length, 0, "and stay legal");
  // heavier: an aluminium floor eats the 0.2 kg of ballast and takes the car over the minimum
  const H = ap(RB, [["floor", "material", "al_7075_t6"]]), mH = parts.massSheet(H.params);
  assert.equal(mH.exact.ballast_kg, 0); assert.ok(mH.exact.total_kg > m0.min_kg + 30, "aluminium floor heavier: " + mH.exact.total_kg);
  assert.ok(Math.abs(physical.physical(H).mass_kg - physical.physical(RB).mass_kg - (mH.exact.total_kg - m0.exact.total_kg)) < 1e-4, "mass flows into the PhysicalCar");
  assert.ok(lap(H) > lap(RB) + 0.3, "and the sim charges it");
  // mass conservation: rows sum to the total, axles sum to the total
  for (const m of [m0, mL, mH]) {
    assert.ok(Math.abs(m.parts.reduce((s, r) => s + r.mass_kg, 0) - m.total_kg) < 0.2, "rows sum (rounded rows)");
    assert.ok(Math.abs(m.front_kg + m.rear_kg - m.total_kg) < 0.02, "axles sum");
    assert.ok(Math.abs(m.exact.total_kg - Math.max(m.min_kg, m.exact.parts_kg) - RB.params.ballast.extra_kg) < 1e-9, "total = max(min, parts) + extra");
  }
});

test("materials: stiffness reaches the aero (wing wash-out, floor flex), ballast density reaches the CoG, regulated parts refuse a material", () => {
  const A = d => aeromap.evaluate(d.params);
  // glass-fibre rear wing: the wall cannot grow enough (max gauge), the wing is softer, washes out more: less load and drag
  const g = ap(RB, [["rear_wing", "material", "gfrp_e"]]), e = materials.effect("rear_wing", "gfrp_e");
  assert.equal(e.bound, "max_gauge"); assert.ok(e.stiffness_ratio < 1);
  assert.ok(A(g).material_flex.rear_wing_deg < 0 && A(g).breakdown.rear_wing.df < A(RB).breakdown.rear_wing.df);
  // a stiffer (high-modulus) front wing washes out less: more front load
  const hm = ap(RB, [["front_wing", "material", "cfrp_m55j"]]);
  assert.ok(A(hm).material_flex.front_wing_deg > 0 && A(hm).breakdown.front_wing.df > A(RB).breakdown.front_wing.df);
  // a softer floor flexes more: less stall margin (a legality effect through PKG-FLOOR-STALL)
  assert.ok(A(ap(RB, [["floor", "material", "gfrp_e"]])).stall_margin_mm < A(RB).stall_margin_mm);
  // ballast density: a steel slab is thicker than tungsten, so its CoG sits higher
  const W = ap(RB, [["ballast", "extra_kg", 15]]), S = ap(W, [["ballast", "material", "steel_maraging_300"]]);
  assert.ok(parts.massSheet(S.params).exact.cog_height_mm > parts.massSheet(W.params).exact.cog_height_mm);
  // refused, never ignored: a part whose material a regulation fixes, an unknown id, a wrong form
  const bad = (part, id) => { const d = design.clone(RB); d.params[part] = Object.assign({}, d.params[part], { material: id }); return design.validate(d); };
  assert.match(bad("halo", "cfrp_t800s").errors.join(" "), /C12\.4\.2/);
  assert.match(bad("wheels_front", "ti64").errors.join(" "), /C10\.7\.1/);
  assert.match(bad("front_wing", "unobtainium").errors.join(" "), /unknown material/);
  assert.match(bad("front_wing", "core_nomex").errors.join(" "), /is a core/);
  assert.match(bad("ballast", "cfrp_t800s").errors.join(" "), /takes metal/);
  assert.throws(() => parts.massSheet(Object.assign({}, RB.params, { halo: { material: "ti64" } })), /not a design parameter/);
  assert.throws(() => design.applyChanges(RB, [{ part: "front_wing", param: "material", to: "nope" }]), /unknown material/);
  assert.equal(design.validate(hm).ok, true);
});

test("materials: applyChanges / diff / describe / mutate carry material swaps; the default mutate stream is unchanged", () => {
  const r = design.applyChanges(RB, [{ part: "rear_wing", param: "material", to: "cfrp_t1100g" }]);
  assert.deepEqual(r.changes, [{ part: "rear_wing", param: "material", from: "cfrp_t800s", to: "cfrp_t1100g", clamped: false }]);
  assert.equal(r.design.params.rear_wing.material, "cfrp_t1100g");
  assert.deepEqual(design.diff(RB, r.design), [{ part: "rear_wing", param: "material", from: "cfrp_t800s", to: "cfrp_t1100g", delta: null, unit: "", domain_frac: null }]);
  assert.match(design.describeChange(r.changes[0]), /material .*T800S.*→.*T1100G/);
  assert.ok(design.describe(r.design).some(l => /material/.test(l)));
  const back = design.applyChanges(r.design, [{ part: "rear_wing", param: "material", to: "cfrp_t800s" }]).design;
  assert.equal("material" in back.params.rear_wing, false, "back to the baseline material = no key");
  // the default mutate draws the same random stream as before (seeded lineages unchanged); opts.materials adds swaps
  const a = design.seededRng(5), b = design.seededRng(5);
  for (let i = 0; i < 30; i++) assert.deepEqual(design.mutate(RB, a, 0.1).changes, design.mutate(RB, b, 0.1, { materials: false }).changes);
  const rng = design.seededRng(9); let swaps = 0;
  for (let i = 0; i < 200; i++) { const m = design.mutate(RB, rng, 0.1, { materials: true, material_p: 0.5 }); assert.equal(design.validate(m.design).ok, true); if (m.changes.some(c => c.param === "material")) swaps++; }
  assert.ok(swaps > 50 && swaps < 150, "material swaps proposed: " + swaps);
});

test("determinism: physical() and the lap are pure functions of the design (materials included)", () => {
  const d = ap(RB, [["front_wing", "material", "cfrp_t1100g"], ["floor", "ride_height_mm", 37], ["ballast", "extra_kg", 4], ["ballast", "material", "steel_17_4ph"]]);
  assert.deepEqual(physical.physical(d), physical.physical(design.clone(d)));
  assert.equal(lap(d), lap(design.clone(d)));
});

test("coupling docs exist and keep the honesty rules (no banned words in the new files)", () => {
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated"].join("|"), "i");
  for (const f of ["docs/concept/COUPLING.md", "docs/concept/MATERIALS.md", "concept/materials.js", "concept/data/materials-2026.json"]) {
    const p = path.join(ROOT, f); assert.ok(fs.existsSync(p), f); const m = banned.exec(fs.readFileSync(p, "utf8")); assert.equal(m, null, f + ": " + (m && m[0]));
  }
  const doc = fs.readFileSync(path.join(ROOT, "docs/concept/COUPLING.md"), "utf8");
  for (const s of parts.PARAMS) assert.ok(doc.includes(s.part + "." + s.param), "COUPLING.md row for " + s.part + "." + s.param);
});
