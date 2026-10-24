// PURPLE CONCEPT - the physics lap sim integrated into the concept stack: calibration of physical() onto the sim's estimated cars,
// the Red Bull RB22 baseline, energy semantics and the es_harvest guard, the bench (physics by default, cached, v0 fallback), the
// weekend score in the sim's frame, the optimiser on the physics sim and the concept lab's wiring. docs/concept/CONCEPT.md §4.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const sim = require("../concept/sim/index.js");
const design = require("../concept/design.js"), physical = require("../concept/physical.js"), bench = require("../concept/bench.js");
const optimize = require("../concept/optimize.js"), W = require("../concept/weekend/weekend.js");
const G = design.baseline(), RB = design.baseline({ team: "redbull" });
const lap = car => sim.simulateLap(car, "silverstone").lap_s;
const withParam = (d, part, param, v) => { const x = design.clone(d); x.params[part][param] = v; return x; };
const noMs = r => JSON.parse(JSON.stringify(r, (k, v) => (k === "ms" ? undefined : v)));

test("calibration: physical(baseline) is the sim's estimated car and laps its time exactly (generic and Red Bull)", () => {
  for (const [d, team] of [[G, null], [RB, "redbull"]]) {
    const pc = physical.physical(d), A = team ? sim.baselineCar(team) : sim.baselineCar();
    assert.equal(lap(pc), lap(A), (team || "generic") + " lap");
    for (const m of ["corner", "straight"]) for (const k of ["CLA_front_m2", "CLA_rear_m2", "CDA_m2"]) assert.ok(Math.abs(pc.aero[m][k] - A.aero[m][k]) < 1e-5, m + "." + k);
    for (const k of ["mass_kg", "fuel_kg", "cog_height_m", "weight_dist_front", "track_front_m", "track_rear_m", "drivetrain_eff"]) assert.ok(Math.abs(pc[k] - A[k]) < 1e-6, k);
    for (const k of ["mu_x", "mu_y", "load_sens"]) assert.ok(Math.abs(pc.tyres[k] - A.tyres[k]) < 1e-4, k);
    assert.equal(pc.pu.ice_kw, +A.pu.ice_kw.toFixed(4)); assert.deepEqual(pc.gearing, A.gearing);
    assert.match(pc.label, /physics sim's estimated car/); assert.equal(pc.anchor.id, A.id);
  }
  // the Red Bull baseline laps the sim's inferred RB22 (88.749 s) against HAD's real 88.746 s
  const rb = lap(physical.physical(RB)), real = bench.racepace().silverstone.q.HAD;
  assert.ok(Math.abs(rb - real) < 0.02, "RB22 " + rb + " vs HAD " + real);
  assert.ok(rb > lap(physical.physical(G)), "the RB22 is slower than the generic (pole-lap) car");
});

test("calibration: design changes are relative deltas from the part catalogue and the concept aero map", () => {
  const b = physical.physical(RB);
  const heavy = physical.physical(withParam(RB, "ballast", "extra_kg", 10));
  assert.ok(Math.abs(heavy.mass_kg - b.mass_kg - 10) < 0.05, "10 kg of extra ballast: " + (heavy.mass_kg - b.mass_kg));
  const wide = physical.physical(withParam(RB, "floor", "width_mm", 1540));
  assert.ok(wide.aero.corner.CLA_rear_m2 + wide.aero.corner.CLA_front_m2 > b.aero.corner.CLA_rear_m2 + b.aero.corner.CLA_front_m2);
  // Straight Mode: no flap = Corner Mode; more flap = less drag; a lower wing lowers straight-mode drag too (no inverted mapping)
  const flat = withParam(RB, "rear_wing", "sm_delta_deg", 0); flat.params.front_wing.sm_delta_deg = 0;
  const pf = physical.physical(flat); assert.deepEqual(pf.aero.straight, pf.aero.corner);
  const open = physical.physical(withParam(RB, "rear_wing", "sm_delta_deg", 30)); assert.ok(open.aero.straight.CDA_m2 < b.aero.straight.CDA_m2);
  const half = physical.physical(withParam(RB, "rear_wing", "sm_delta_deg", 7.5)); assert.ok(half.aero.straight.CDA_m2 > b.aero.straight.CDA_m2 && half.aero.straight.CDA_m2 < b.aero.corner.CDA_m2);
  const low = physical.physical(withParam(RB, "rear_wing", "aoa_deg", 15)); assert.ok(low.aero.straight.CDA_m2 < b.aero.straight.CDA_m2 && low.aero.corner.CDA_m2 < b.aero.corner.CDA_m2);
  // the sim sees those deltas: no flaps costs seconds, a wider floor gains
  assert.ok(lap(pf) > lap(b) + 1); assert.ok(lap(wide) < lap(b));
});

test("energy: regulation semantics (C5.2.9 window + C5.2.10 recharge) and the es_harvest exploit is closed in the bench", () => {
  const pc = physical.physical(RB), E = physical.ENERGY;
  assert.equal(pc.pu.es_harvest_mj_per_lap, 8.5); assert.equal(pc.pu.es_deploy_mj_per_lap, 12.5); assert.equal(pc.pu.es_soc_window_mj, 4);
  assert.ok(pc.pu.es_deploy_mj_per_lap >= 4 + 6.5); assert.equal(E.deploy_mj, E.soc_window_mj + E.recharge_max_mj);
  // a car declaring a lower recharge cap or a smaller deploy budget runs the regulation values through the bench
  const cheat = JSON.parse(JSON.stringify(pc)); cheat.pu.es_harvest_mj_per_lap = 6.0; cheat.pu.es_deploy_mj_per_lap = 9; cheat.pu.mguk_kw = 400;
  assert.deepEqual(bench.simPhysics(cheat, "silverstone", null), bench.simPhysics(pc, "silverstone", null));
  assert.equal(bench.guardEnergy(cheat).pu.es_harvest_mj_per_lap, 8.5); assert.equal(bench.guardEnergy(cheat).pu.mguk_kw, 350);
});

test("design: the Red Bull baseline carries the RB22 identity and livery id; the generic one stays selectable", () => {
  assert.equal(RB.id, "baseline-redbull"); assert.equal(RB.team, "redbull"); assert.equal(RB.livery, "redbull-rb22"); assert.equal(RB.driver, "HAD");
  assert.deepEqual(design.baseline("redbull"), RB); assert.equal(G.id, "baseline"); assert.equal(G.team, undefined);
  assert.deepEqual(RB.params, G.params, "same concept shape: no RB22 geometry is public; the identity is the anchor car");
  assert.deepEqual(design.baseline({ team: "generic" }), G);
  assert.throws(() => design.baseline({ team: "nope" }), /no baseline for team/);
  const child = design.applyChanges(RB, [{ part: "rear_wing", param: "aoa_deg", to: 21 }]).design;
  assert.equal(child.team, "redbull"); assert.equal(child.livery, "redbull-rb22");
});

test("bench: physics sim by default with the weekend objective; the baselines are no longer P1 by construction", () => {
  const r = bench.bench(RB), g = bench.bench(G);
  for (const x of [r, g]) { assert.equal(x.sim, "physics"); assert.equal(x.objective, "weekend"); assert.match(x.sim_label, /physics lap sim/); assert.equal(x.legal, true); }
  assert.equal(r.circuits.silverstone.lap_s, lap(sim.baselineCar("redbull"))); assert.equal(g.circuits.silverstone.lap_s, lap(sim.baselineCar()));
  assert.ok(r.weekend.grid_position > 1 && g.weekend.grid_position > 1, "P" + r.weekend.grid_position + " / P" + g.weekend.grid_position);
  assert.equal(r.score, r.weekend_model.weekend_score); assert.ok(r.score < 0 && g.score > r.score);
  assert.deepEqual(r.weekend_model.field.replaced, ["HAD"], "our RB22 takes HAD's place in the field"); assert.equal(r.weekend_model.field.frame, "sim");
  assert.ok(r.weekend_model.quali_pos >= 4 && r.weekend_model.quali_pos <= 7, "RB22 baseline quali P" + r.weekend_model.quali_pos);
  // other circuits fall back to v0; an explicit v0 / quali run is the old anchored bench
  const m = bench.bench(RB, { circuits: ["silverstone", "monza"] }); assert.equal(m.circuits.silverstone.sim, "physics"); assert.ok(m.circuits.monza.v0);
  const v0 = bench.bench(RB, { sim: "v0", objective: "quali" }); assert.equal(v0.circuits.silverstone.lap_s, 88.111); assert.equal(v0.score, 0);
  assert.throws(() => bench.resolveSim("nope"), /opts.sim/);
});

test("bench: cached by design (same numbers, no second lap), deterministic", () => {
  const d = withParam(RB, "diffuser", "expansion_deg", 15.5);
  const a = bench.bench(d), before = bench.cacheStats(), b = bench.bench(design.clone(d)), after = bench.cacheStats();
  assert.deepEqual(noMs(a), noMs(b)); assert.equal(after.misses, before.misses, "no new physics lap");
  assert.deepEqual(noMs(bench.bench(d, { cache: false })), noMs(a), "cached = recomputed");
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 50; i++) bench.bench(design.clone(d)); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
  assert.ok(ms < 5, "cached bench " + ms.toFixed(2) + " ms");
});

test("weekend: physics by default - the sim's fuel slope for every car, the field in the sim's frame (team fit residuals)", () => {
  const s = W.score(RB, { replace: "HAD" });
  assert.equal(s.field.sim, "physics"); assert.equal(s.field.frame, "sim"); assert.match(s.field.fuel_basis, /physics sim/);
  assert.ok(s.field.fuel_s_per_kg > 0.01 && s.field.fuel_s_per_kg < 0.04, "fuel " + s.field.fuel_s_per_kg + " s/kg");
  assert.equal(s.quali.lap_s, lap(sim.baselineCar("redbull")));
  // the same weekend from the bench's lap (scoreLap) - no second sim call
  const r = bench.bench(RB); assert.equal(r.weekend_model.weekend_score, s.weekend_score);
  // sim frame: every real lap moves by its team's fit residual (≤ 0.05 s); a bare lap stays in the real frame
  const shift = W.simFieldShift(), RP = bench.racepace().silverstone;
  for (const t of sim.fitted().teams) { assert.ok(Math.abs(shift[t.driver].shift_s - (t.q_sim_s - t.q_real_s)) < 1e-9); assert.ok(Math.abs(shift[t.driver].shift_s) <= 0.06); }
  const g = s.quali.grid.find(x => x.code === "ANT"); assert.equal(g.real_s, RP.q.ANT); assert.ok(Math.abs(g.lap_s - (RP.q.ANT + shift.ANT.shift_s)) < 1e-9);
  const bare = W.score({ lap_s: 88.6 }); assert.equal(bare.field.frame, "real"); assert.equal(bare.field.fuel_basis, "coefficient");
});

test("optimiser: the weekend score on the physics sim from the RB22 - deterministic, legal, improving, cache-backed", () => {
  const run = () => optimize.optimize({ gens: 8, seed: 2, team: "redbull" });
  const a = run(), b = run();
  assert.deepEqual(a.lineage.map(r => [r.id, r.score_after, r.kept]), b.lineage.map(r => [r.id, r.score_after, r.kept]));
  assert.equal(a.baseline.id, "baseline-redbull"); assert.equal(a.sim, "physics"); assert.equal(a.best_result.objective, "weekend");
  assert.equal(a.best_result.legal, true); assert.ok(a.best_result.score > a.baseline_result.score, a.best_result.score + " vs " + a.baseline_result.score);
  for (const row of a.lineage) { assert.equal(row.kept, row.legal && row.score_after > row.score_before); if (row.result && row.result.lap_s) assert.ok(row.result.race_position >= 1); }
  assert.match(optimize.OBJECTIVE, /weekend/);
});

test("optimizeAsync yields between physics laps (slice_ms) and gives the same lineage as optimize()", async () => {
  let yields = 0;
  const a = await optimize.optimizeAsync({ gens: 3, seed: 4, team: "redbull", yield: async () => { yields++; }, slice_ms: 0 });
  const b = optimize.optimize({ gens: 3, seed: 4, team: "redbull" });
  assert.deepEqual(a.lineage.map(r => [r.id, r.score_after]), b.lineage.map(r => [r.id, r.score_after]));
  assert.equal(yields, a.lineage.reduce((n, r) => n + r.candidates.filter(c => !c.error).length, 0));
});

test("concept lab: loads the physics sim, Red Bull is the default baseline, sim toggle and weekend line are wired", () => {
  const root = path.join(__dirname, ".."), html = fs.readFileSync(path.join(root, "concept", "lab", "index.html"), "utf8"), js = fs.readFileSync(path.join(root, "concept", "lab", "concept-lab.js"), "utf8");
  const order = ["js/data/silverstone.js", "../sim/track.js", "../sim/line-silverstone.js", "../sim/lapsim.js", "../sim/fitted.js", "../sim/fit.js", "../sim/index.js", "../physical.js", "../bench.js", "../weekend/weekend.js"].map(f => html.indexOf(f));
  assert.ok(order.every(i => i > 0), JSON.stringify(order)); assert.deepEqual(order.slice().sort((x, y) => x - y), order, "script order");
  assert.match(html, /<select id="team"><option value="redbull" selected>/); assert.match(html, /<select id="simSel"><option value="physics" selected>/);
  assert.match(js, /EI\.conceptSim/); assert.match(js, /weekend_model/); assert.match(js, /livery/);
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated"].join("|"), "i");
  for (const f of [path.join(root, "docs", "concept", "WEEKEND.md"), path.join(root, "concept", "lab", "concept-lab.js"), path.join(root, "concept", "weekend", "weekend.js"), __filename]) assert.equal(banned.exec(fs.readFileSync(f, "utf8")), null, f);
});
