// PURPLE CONCEPT - same engine, permitted materials, energy limits (docs/concept/CAMPAIGN.md §1). No design, mutation, calibration
// or override can give a scored car a power unit other than its team's homologated one; materials only where the materials data
// marks them permitted (C15.2); a physics lap over a C5.2.9 / C5.2.10 energy limit is never scored.
const test = require("node:test");
const assert = require("node:assert/strict");
const bench = require("../concept/bench.js"), design = require("../concept/design.js"), phys = require("../concept/physical.js"), regs = require("../concept/regs.js");
const optimize = require("../concept/optimize.js"), materials = require("../concept/materials.js"), sim = require("../concept/sim/index.js");

const RB = design.baseline("redbull"), GEN = design.baseline();
const pcOf = d => phys.physical(d);
const ids = v => v.map(x => x.id);

test("PU guard: the homologated PU is the team's own (RB22: Red Bull Ford DM01 = the sim's inferred RB22 PU; generic: the sim's estimate)", () => {
  const H = bench.homologatedPU("redbull"), A = sim.baselineCar("redbull");
  assert.equal(H.name, "Red Bull Ford DM01");
  assert.ok(Math.abs(H.ice_kw - A.pu.ice_kw) < 1e-6 && H.mguk_kw === A.pu.mguk_kw && H.mguk_kw === 350);
  assert.equal(H.es_soc_window_mj, 4); assert.equal(H.es_harvest_mj_per_lap, 8.5); assert.equal(H.es_deploy_mj_per_lap, 12.5);
  assert.deepEqual(H.masses_kg, { pu_ice: 118.5, pu_turbo: 12, pu_mguk: 20, pu_es: 35, pu_electronics: 5.7 });
  assert.equal(H.mguk_transmission, "a");
  assert.equal(bench.homologatedPU(null).ice_kw, sim.baselineCar().pu.ice_kw);
  assert.ok(Object.isFrozen(H));
  for (const d of [RB, GEN]) assert.deepEqual(bench.checkPU(pcOf(d), d, design.facts(d).mass), []);
});

test("PU guard: every way of changing the PU is caught (power, MGU-K, energy store, extra field, calibration, masses, option, override, anchor)", () => {
  const pc = pcOf(RB), sheet = design.facts(RB).mass, mod = f => { const c = JSON.parse(JSON.stringify(pc)); f(c); return c; };
  const cases = {
    ice: mod(c => { c.pu.ice_kw += 0.5; }), mguk: mod(c => { c.pu.mguk_kw = 340; }), soc: mod(c => { c.pu.es_soc_window_mj = 4.5; }),
    harvest: mod(c => { c.pu.es_harvest_mj_per_lap = 6; }), deploy: mod(c => { c.pu.es_deploy_mj_per_lap = 14; }), superclip: mod(c => { c.pu.superclip_kw = 400; }),
    calib: mod(c => { c.calibration = Object.assign({}, c.calibration, { power_scale: 1.01 }); }), anchor: mod(c => { c.team = null; }),
  };
  for (const k of Object.keys(cases)) assert.ok(bench.checkPU(cases[k], RB, sheet).some(v => v.id === "PU-HOMOLOGATED"), k);
  const s2 = JSON.parse(JSON.stringify(sheet)); s2.parts.find(p => p.id === "pu_es").mass_kg = 34;
  assert.equal(ids(bench.checkPU(pc, RB, s2)).length, 1);
  const s3 = JSON.parse(JSON.stringify(sheet)); s3.mguk_transmission = "b";
  assert.equal(ids(bench.checkPU(pc, RB, s3)).length, 1);
  // a generic design anchored on the Red Bull car (opts.anchor) is not the generic PU
  assert.ok(bench.checkPU(phys.physical(GEN, { anchor: sim.baselineCar("redbull") }), GEN, null).length > 0);
});

test("PU guard in the bench: a changed PU is illegal, gets no lap, and the sim is never called (any sim)", () => {
  let called = 0; const spy = (pc, t) => { called++; return { lap_s: 80, sectors_s: [26, 30, 24], vmax_kmh: 330, speed_trap_kmh: 330, vmin_kmh: 90, energy: {}, label: "spy" }; };
  const over = design.clone(RB); over.overrides = { pu_ice: { mass_kg: 118.5, x_mm: 2400 } };
  for (const [d, o] of [[RB, { calibration: { power_scale: 1.05 } }], [over, {}], [RB, { calibration: { power_scale: 0.97 } }]]) {
    const r = bench.bench(d, Object.assign({ sim: spy, objective: "quali", cache: false }, o));
    assert.equal(r.legal, false); assert.ok(ids(r.violations).some(id => id === "PU-HOMOLOGATED" || id === "PKG-PU-FIXED")); assert.equal(r.score, null); assert.deepEqual(r.circuits, {});
  }
  assert.equal(called, 0);
  assert.ok(bench.bench(RB, { sim: spy, objective: "quali", cache: false }).legal); assert.equal(called, 1);
});

test("same engine: no design or mutation reaches the PU (1,200 seeded mutations and random walks, materials on, both baselines)", () => {
  let legal = 0, coolingFail = 0;
  for (const base of [RB, GEN]) {
    const H = bench.homologatedPU(base.team || null), rng = design.seededRng(base.team ? 11 : 12);
    let walk = base;
    for (let i = 0; i < 600; i++) {
      const m = design.mutate(i % 3 ? walk : base, rng, 0.05 + 0.25 * rng(), { materials: true, material_p: 0.3 }).design;
      if (i % 3) walk = m; if (i % 50 === 0) walk = base;
      const f = design.facts(m), v = regs.checkFacts(f), pc = pcOf(m), pv = bench.checkPU(pc, m, f.mass);
      // the PU part masses and the transmission option never move, legal or not
      for (const id of bench.PU_PARTS) assert.equal(f.mass.parts.find(p => p.id === id).mass_kg, H.masses_kg[id]);
      assert.equal(f.mass.mguk_transmission, "a");
      for (const k of ["mguk_kw", "es_deploy_mj_per_lap", "es_harvest_mj_per_lap", "es_soc_window_mj"]) assert.equal(pc.pu[k], H[k]);
      if (v.length === 0) { legal++; assert.deepEqual(pv, [], "a legal design must carry the homologated PU"); assert.equal(pc.pu.ice_kw, H.ice_kw); }
      else if (ids(v).includes("PKG-COOLING")) { coolingFail++; if (pc.pu.ice_kw !== H.ice_kw) assert.ok(ids(pv).includes("PU-HOMOLOGATED")); }
    }
  }
  assert.ok(legal > 200, "enough legal designs sampled: " + legal);
  assert.ok(coolingFail > 0, "the cooling-derate path was exercised");
  // a PU part has no material parameter at all
  const d = design.clone(RB); d.params.pu_ice = { material: "ti64" };
  assert.equal(design.validate(d).ok, false);
});

test("the optimiser never runs with the guards off, and every kept car carries the homologated PU", () => {
  assert.throws(() => optimize.optimize({ gens: 1, team: "redbull", bench: { sim: "v0", pu_guard: false } }), /cannot be turned off/);
  assert.throws(() => optimize.optimize({ gens: 1, team: "redbull", bench: { sim: "v0", material_guard: false } }), /cannot be turned off/);
  const res = optimize.optimize({ gens: 12, seed: 4, lambda: 4, team: "redbull", materials: true, bench: { sim: "v0", objective: "quali" } });
  for (const row of res.lineage) for (const c of row.candidates) if (c.legal) assert.ok(!(c.violations || []).length);
  assert.deepEqual(bench.checkPU(res.best_result.physical, res.best, design.facts(res.best).mass), []);
  assert.deepEqual(bench.checkMaterials(res.best), []);
  assert.throws(() => optimize.assertSameEngine(RB, { physical: Object.assign({}, pcOf(RB), { pu: Object.assign({}, pcOf(RB).pu, { ice_kw: 420 }) }) }), /same-engine/);
});

test("materials: only C15.2-permitted materials, never on the homologated safety structures; the ES proposer never proposes another", () => {
  for (const id of ["cfrp_m60j", "albemet_am162", "al_li_2195"]) for (const p of ["front_wing", "rear_wing", "floor"]) assert.equal(bench.materialAllowed(p, id), false, p + " " + id);
  assert.equal(bench.materialAllowed("front_wing", "cfrp_m55j"), true);
  for (const p of bench.MATERIAL_FIXED_STRUCTURES) assert.equal(bench.materialAllowed(p, "cfrp_t800s"), false);
  const bad = design.applyChanges(RB, [{ part: "floor", param: "material", to: "albemet_am162" }]).design;
  const r = bench.bench(bad, { sim: "v0", objective: "quali", cache: false });
  assert.equal(r.legal, false); assert.ok(ids(r.violations).some(id => id === "MAT-C15" || /^REG-C-MAT-/.test(id)));
  // a C15-permitted laminate on a homologated safety structure: regs.js lets it through, the campaign backstop does not
  const sc = design.applyChanges(RB, [{ part: "nose", param: "material", to: "cfrp_t800s" }]).design, rs = bench.bench(sc, { sim: "v0", objective: "quali", cache: false });
  if (regs.check(sc).length === 0) assert.deepEqual(ids(rs.violations), ["MAT-C15"]); else assert.equal(rs.legal, false);
  const P = optimize.esProposer(8, { materials: true }), rng = design.seededRng(9);
  let swaps = 0;
  for (let i = 0; i < 60; i++) for (const p of P.propose([], RB, { lambda: 8, rng, sigma: 0.1 })) for (const c of p.changes) if (c.param === "material") { swaps++; assert.ok(bench.materialAllowed(c.part, c.to), c.part + " " + c.to); }
  assert.ok(swaps > 20);
  for (const m of materials.MATERIALS.filter(x => x.fia.status !== "permitted")) for (const p of Object.keys(materials.PARTS)) assert.equal(bench.materialAllowed(p, m.id), m.id === materials.baseOf(p));
});

test("energy limits: every physics lap is re-checked (C5.2.9 SoC window, C5.2.10 recharge and the 6.5 MJ Q limit); strategies are the sim's own", () => {
  const cond = sim.DEFAULT_CONDITIONS;
  assert.deepEqual(bench.checkEnergy({ energy: { deployed_mj: 9, harvested_mj: 5.5, recharge_cap_mj: 6.5 } }, cond), []);
  assert.deepEqual(ids(bench.checkEnergy({ energy: { deployed_mj: 9, harvested_mj: 6.9, recharge_cap_mj: 6.5 } }, cond)), ["ENERGY-LIMIT"]);
  assert.deepEqual(ids(bench.checkEnergy({ energy: { deployed_mj: 10.2, harvested_mj: 6, recharge_cap_mj: 6.5 } }, cond)), ["ENERGY-LIMIT"]);
  assert.deepEqual(ids(bench.checkEnergy({ energy: { deployed_mj: 9, harvested_mj: 6, recharge_cap_mj: 9 } }, null)), ["ENERGY-LIMIT"]);
  const laps = {};
  for (const s of ["regulated", "threshold", "marginal", "optimal"]) {
    const r = bench.bench(RB, { sim: "physics", objective: "quali", strategy: s });
    assert.ok(r.legal, s); const e = r.circuits.silverstone.energy;
    assert.equal(e.strategy, s); assert.ok(e.harvested_mj <= 6.5 + 1e-9 && e.deployed_mj <= e.harvested_mj + 4 + 0.002, s);
    laps[s] = r.circuits.silverstone.lap_s;
  }
  assert.equal(laps.regulated, sim.simulateLap(bench.guardEnergy(phys.physical(RB)), "silverstone").lap_s);   // sim v3 default strategy
  assert.notEqual(laps.marginal, laps.threshold);   // the strategy reaches the sim (and moves the lap: why the campaign keeps the calibrated one)
  assert.throws(() => bench.bench(RB, { sim: "physics", objective: "quali", strategy: "boost", cache: false }), /strategy/);
});

test("FIA checklist in the bench and the proposer: regs.checkPhysical (PKG-PU-FIXED) is in the verdict, REG-C-SUSP-WIDTH waits; proposer limits", () => {
  const spy = () => ({ lap_s: 80, sectors_s: [26, 30, 24], energy: {}, label: "spy" });
  const r = bench.bench(RB, { sim: spy, objective: "quali", cache: false, calibration: { power_scale: 1.02 } });
  assert.ok(ids(r.violations).includes("PKG-PU-FIXED"));
  // what regs.js allows but the backstop does not: an extra PU field the sim could read (superclip_kw) is caught by checkPU
  assert.deepEqual(regs.checkPhysical(Object.assign({}, pcOf(RB), { pu: Object.assign({}, pcOf(RB).pu, { superclip_kw: 500 }) }), { pu_ref: bench.homologatedPU("redbull") }).filter(v => v.id !== "REG-C-SUSP-WIDTH"), []);
  // sim v3 fixed the track widths (1.540 / 1.470 m, C10.10.1): nothing is skipped any more and every baseline passes checkPhysical
  assert.deepEqual(bench.PHYSICAL_SKIP, []);
  assert.deepEqual(regs.checkPhysical(pcOf(RB), {}), []);
  const wide = Object.assign({}, pcOf(RB), { track_front_m: 1.6 });
  assert.ok(bench.bench(RB, { sim: () => ({ lap_s: 80, sectors_s: [26, 30, 24], energy: {}, label: "spy" }), objective: "quali", cache: false, calibration: { cla_scale: 1 } }).legal);
  assert.ok(regs.checkPhysical(wide, {}).some(v => v.id === "REG-C-SUSP-WIDTH"), "a track past C10.10.1 is caught");
  assert.ok(bench.bench(RB, { sim: spy, objective: "quali", cache: false }).legal);
  const L = optimize.proposerLimits(RB.params);
  assert.equal(L["rear_wing.elements"].min, 2);
  assert.ok(Math.abs(L["front_wing.chord_mm"].max - regs.fwProfilesChordLimit(RB.params.front_wing)) < 1e-9);
  // the ES proposer's changes always respect them (on the design they produce)
  const P = optimize.esProposer(8), rng = design.seededRng(21);
  for (let i = 0; i < 80; i++) for (const p of P.propose([], RB, { lambda: 8, rng, sigma: 0.2 })) {
    const d = design.applyChanges(RB, p.changes).design;
    assert.ok(d.params.rear_wing.elements >= 2);
    const lim = regs.fwProfilesChordLimit(d.params.front_wing);   // below the 400 mm domain floor no chord fits: the bench rejects the car
    assert.ok(d.params.front_wing.chord_mm <= lim + 1e-9 || lim < 400 || !p.changes.some(c => c.part === "front_wing" && c.param === "chord_mm"));
  }
});
