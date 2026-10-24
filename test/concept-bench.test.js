// PURPLE CONCEPT - PhysicalCar, the virtual aero bench (sim v0 = the game's lap model, read-only), the weekend score, the optimiser
// loop and the CLI. The game is loaded headlessly (server/game-headless.js), as in test/evaluator.test.js.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const EI = require("../server/game-headless.js").load();
const design = require("../concept/design.js"), physical = require("../concept/physical.js"), bench = require("../concept/bench.js"), optimize = require("../concept/optimize.js");
const scenarios = require("../server/scenarios.js");
const B = design.baseline(), DRY = { circuit: "silverstone", wet: false, wind_ms: 0, wind_from_deg: 0 };
const V0 = { sim: "v0" }, V0Q = { sim: "v0", objective: "quali" };   // sim v0 (the game's lap model): fast, relative; the physics sim has its own tests (concept-integrate)
const withParam = (part, param, v) => { const d = design.clone(B); d.params[part][param] = v; return d; };
const noMs = r => JSON.parse(JSON.stringify(r, (k, v) => (k === "ms" ? undefined : v)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "purple-concept-"));

test("seededRng: the concept rng is the same stream as server/scenarios.js seededRng", () => {
  for (const seed of [0, 1, 2, 42, 2026]) { const a = design.seededRng(seed), b = scenarios.seededRng(EI.U, seed); for (let i = 0; i < 50; i++) assert.equal(a(), b()); }
});

test("physical(): the baseline PhysicalCar has every contract field, in SI, with 2026-era magnitudes", () => {
  const pc = physical.physical(B);
  const num = (v, lo, hi, what) => { assert.equal(typeof v, "number", what); assert.ok(isFinite(v) && v >= lo && v <= hi, what + " = " + v); };
  assert.equal(typeof pc.id, "string"); assert.match(pc.label, /estimates|estimated car/);
  num(pc.mass_kg, 768, 772, "mass_kg"); num(pc.fuel_kg, 0, 110, "fuel_kg"); num(pc.wheelbase_m, 3, 3.4, "wheelbase_m");
  num(pc.track_front_m, 1.3, 1.9, "track_front_m"); num(pc.track_rear_m, 1.3, 1.9, "track_rear_m"); num(pc.cog_height_m, 0.15, 0.45, "cog_height_m"); num(pc.weight_dist_front, 0.44, 0.46, "weight_dist_front");
  for (const mode of ["corner", "straight"]) { num(pc.aero[mode].CLA_front_m2, 0.5, 4, mode + " CLA_front"); num(pc.aero[mode].CLA_rear_m2, 0.5, 4, mode + " CLA_rear"); num(pc.aero[mode].CDA_m2, 0.3, 2, mode + " CDA"); }
  // the baseline runs Straight Mode at its reference flap setting (front 4°, rear 15°); a car without flaps does not
  assert.ok(pc.aero.straight.CDA_m2 < pc.aero.corner.CDA_m2 && pc.aero.straight.CLA_rear_m2 < pc.aero.corner.CLA_rear_m2);
  const noFlap = withParam("rear_wing", "sm_delta_deg", 0); noFlap.params.front_wing.sm_delta_deg = 0;
  assert.deepEqual(physical.physical(noFlap).aero.straight, physical.physical(noFlap).aero.corner, "no flap, no Straight Mode");
  num(pc.aero.ride_height_mm, 20, 70, "ride_height_mm"); num(pc.aero.ride_sens_per_mm, 0, 0.1, "ride_sens_per_mm");
  assert.equal(pc.pu.ice_kw, 400); assert.equal(pc.pu.mguk_kw, 350); assert.equal(pc.pu.es_deploy_mj_per_lap, 12.5); assert.equal(pc.pu.es_harvest_mj_per_lap, 8.5);
  assert.ok(pc.pu.es_deploy_mj_per_lap >= 4 + 6.5, "deploy ≥ SoC window + the Silverstone qualifying recharge limit");
  num(pc.tyres.mu_x, 1, 2.5, "mu_x"); num(pc.tyres.mu_y, 1, 2.5, "mu_y"); num(pc.tyres.load_sens, 0, 0.2, "load_sens"); num(pc.tyres.radius_m, 0.3, 0.4, "radius_m"); assert.equal(typeof pc.tyres.compound, "string");
  num(pc.brakes.max_decel_g_mech, 1, 6, "max_decel_g_mech"); num(pc.drivetrain_eff, 0.8, 1, "drivetrain_eff");
  // the calibration hook scales absolute levels without touching the design
  const cal = physical.physical(B, { calibration: { cla_scale: 1.1, cda_scale: 0.9, power_scale: 1.05, mu_scale: 1.02 } });
  assert.ok(Math.abs(cal.aero.corner.CLA_rear_m2 - pc.aero.corner.CLA_rear_m2 * 1.1) < 1e-3); assert.ok(Math.abs(cal.aero.corner.CDA_m2 - pc.aero.corner.CDA_m2 * 0.9) < 1e-3);
  assert.ok(Math.abs(cal.pu.ice_kw - 420) < 1e-6); assert.ok(Math.abs(cal.tyres.mu_y - pc.tyres.mu_y * 1.02) < 1e-3);
  // straight mode shows up in the straight-mode aero only
  const sm = physical.physical(withParam("rear_wing", "sm_delta_deg", 25));
  assert.ok(sm.aero.straight.CDA_m2 < pc.aero.straight.CDA_m2); assert.ok(Math.abs(sm.aero.corner.CDA_m2 - pc.aero.corner.CDA_m2) < 1e-9);
});

test("bench v0: the baseline concept car laps the lab evaluator's baseline exactly (80.800 s game time = the real 2026 pole)", () => {
  const r = bench.bench(B, Object.assign({ circuits: ["silverstone", "monza"] }, V0Q));
  assert.equal(r.legal, true); assert.deepEqual(r.violations, []); assert.equal(r.sim, "v0"); assert.equal(r.objective, "quali");
  for (const c of ["silverstone", "monza"]) {
    const ev = EI.evaluator.evaluate(c, EI.aero.BASELINE, Object.assign({}, DRY, { circuit: c })), x = r.circuits[c];
    assert.equal(x.v0.game_lap_s, ev.lap, c); assert.deepEqual(x.v0.multipliers, { df: 1, cd: 1, a0: 1, b0: 1 }); assert.equal(x.v0.iterations, 0);
    assert.equal(x.lap_s, EI.LIMIT_LAP[c] === ev.lap ? bench.racepace()[c].pole.s : x.lap_s);
    assert.ok(Math.abs(x.sectors_s.reduce((a, b) => a + b, 0) - x.lap_s) < 0.003);
  }
  assert.equal(r.circuits.silverstone.lap_s, 88.111);
  assert.deepEqual([r.weekend.grid_position, r.weekend.gap_to_pole_s, r.score], [1, 0, 0]);
  assert.match(r.label, /reduced-order lap model · calibrated to 2026 pole laps · concept aero map v1/);
  assert.match(r.circuits.silverstone.label, /sim v0/); assert.match(r.weekend.label, /RACEPACE/); assert.match(r.mass.label, /estimates/);
});

test("bench v0 never changes the lab: evaluator results and EI.CAR are identical after concept runs", () => {
  const car = JSON.stringify(EI.CAR), before = EI.evaluator.evaluate("silverstone", Object.assign({}, EI.aero.BASELINE, { rear_wing_deg: 27 }), DRY);
  const d = withParam("rear_wing", "sm_delta_deg", 15); d.params.ballast.extra_kg = 12;
  bench.bench(d, Object.assign({ circuits: ["silverstone", "monza"] }, V0)); bench.bench(d, { circuits: ["silverstone", "monza"] });
  assert.deepEqual(EI.evaluator.evaluate("silverstone", Object.assign({}, EI.aero.BASELINE, { rear_wing_deg: 27 }), DRY), before);
  assert.equal(JSON.stringify(EI.CAR), car);
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "baseline.silverstone.json"), "utf8"));
  assert.equal(EI.evaluator.evaluate("silverstone", EI.aero.BASELINE, DRY).lap, fx.lap);
});

test("bench v0: the mass/power channel matches an exact rescale of the game car within 2 ms of lap", () => {
  const G = EI, track = G.evaluator.trackFor("silverstone"), cal = G.evaluator.calibrate(track, "silverstone");
  for (const [k, p] of [[1.04, 1], [0.97, 1], [1, 0.9], [1.03, 0.95]]) {
    const mult = { df: 1 / k, cd: 1, a0: 1, b0: 1 };
    const viaChannel = bench.profile(G, track, cal.grip, mult, { k, p, cd_sm: 1, zones: null }).prof;
    const saved = G.CAR; let exact;
    try { G.CAR = Object.assign({}, saved, { PM: (saved.PM * p) / k, CD: saved.CD / k }); exact = G.buildSpeedProfile(track, G.AI_CAL.DEC_REF, cal.grip, saved.VMAX + 6, 1, 0, { df: 1 / k, cd: 1, a0: 1, b0: 1 }, null); }
    finally { G.CAR = saved; }
    const a = G.evaluator.timing(track, viaChannel, Infinity, "silverstone").lap, b = G.evaluator.timing(track, exact, Infinity, "silverstone").lap;
    assert.ok(Math.abs(a - b) < 0.002, `k ${k} p ${p}: channel ${a} vs exact ${b}`);
  }
});

test("bench v0: straight mode on every sample equals a whole-lap lower drag (exact case) and is faster on the zones", () => {
  const G = EI, track = G.evaluator.trackFor("monza"), cal = G.evaluator.calibrate(track, "monza");
  const all = new Uint8Array(track.n).fill(1);
  const ch = bench.profile(G, track, cal.grip, { df: 1, cd: 1, a0: 1, b0: 1 }, { k: 1, p: 1, cd_sm: 0.9, zones: all }).prof;
  const ex = G.buildSpeedProfile(track, G.AI_CAL.DEC_REF, cal.grip, G.CAR.VMAX + 6, 1, 0, { df: 1, cd: 0.9, a0: 1, b0: 1 }, null);
  const a = G.evaluator.timing(track, ch, Infinity, "monza").lap, b = G.evaluator.timing(track, ex, Infinity, "monza").lap;
  assert.ok(Math.abs(a - b) < 0.002, a + " vs " + b);
  const sm = bench.bench(withParam("rear_wing", "sm_delta_deg", 25), { circuits: ["silverstone", "monza"], sim: "v0" }), base = bench.bench(B, { circuits: ["silverstone", "monza"], sim: "v0" });
  for (const c of ["silverstone", "monza"]) { assert.ok(sm.circuits[c].lap_s < base.circuits[c].lap_s, c); assert.ok(sm.circuits[c].speed_trap_kmh > base.circuits[c].speed_trap_kmh, c); assert.ok(sm.circuits[c].v0.straight_mode_zone_m > 500, c); }
});

test("bench v0: physics directions (mass, rear wing, cooling) and the lab's rear-wing premise", () => {
  const lap = d => { const r = bench.bench(d, V0); assert.equal(r.legal, true, JSON.stringify(r.violations)); return r.circuits.silverstone; };
  const hotD = withParam("sidepods", "inlet_cm2", 350); hotD.params.ballast.x_frac = 0.4;   // more ballast from lighter radiators: keep the C4.2 split
  const base = lap(B), heavy = lap(withParam("ballast", "extra_kg", 10)), rw = lap(withParam("rear_wing", "aoa_deg", 28));
  // an under-cooled car is illegal (PKG-COOLING); measured anyway through the sim, its PU derates and it is slower
  const hotR = bench.bench(hotD, V0); assert.equal(hotR.legal, false); assert.ok(hotR.violations.some(v => v.id === "PKG-COOLING"));
  const hot = bench.simV0(physical.physical(hotD), "silverstone"); assert.ok(physical.physical(hotD).pu.ice_kw < 400);
  assert.ok(heavy.lap_s > base.lap_s, "10 kg extra is slower"); assert.ok(heavy.lap_s - base.lap_s < 0.5);
  assert.ok(rw.lap_s > base.lap_s, "rear wing +8 is slower at Silverstone (the lab's demo premise holds in the concept too)");
  assert.ok(rw.vmin_kmh > base.vmin_kmh && rw.vmax_kmh < base.vmax_kmh);
  assert.ok(hot.lap_s > base.lap_s, "an under-cooled PU derates");
});

test("bench: illegal designs get no lap; domain errors are reported; results are deterministic and fast", () => {
  const ill = bench.bench(withParam("rear_wing", "endplate_top_mm", 900));
  assert.equal(ill.legal, false); assert.deepEqual(ill.circuits, {}); assert.equal(ill.score, null); assert.ok(ill.violations.some(v => v.id === "REG-C-RW-ENDPLATE"));
  const bad = bench.bench(withParam("floor", "ride_height_mm", 5)); assert.equal(bad.legal, false); assert.ok(bad.errors.length);
  const d = withParam("front_wing", "sm_delta_deg", 8); d.params.floor.ride_height_mm = 31;
  const both = Object.assign({ circuits: ["silverstone", "monza"] }, V0);
  assert.deepEqual(noMs(bench.bench(d, both)), noMs(bench.bench(d, Object.assign({ cache: false }, both))), "cached = recomputed");
  bench.bench(d, both);
  const t0 = process.hrtime.bigint(), N = 10; for (let i = 0; i < N; i++) bench.bench(design.applyChanges(d, [{ part: "rear_wing", param: "aoa_deg", to: 20 + i * 0.5 }]).design, Object.assign({ cache: false }, both));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N; assert.ok(ms < 50, "per eval (both circuits) " + ms.toFixed(1) + " ms");
});

test("bench: the sim is pluggable - sim(physicalCar, trackId, conditions) feeds the weekend score", () => {
  const calls = [];
  const fake = (pc, trackId, conditions) => { calls.push([pc.mass_kg, trackId, conditions]); return { lap_s: 88.4, sectors_s: [28, 30, 30.4], vmax_kmh: 340, speed_trap_kmh: 338, vmin_kmh: 120, energy: { deployed_mj: 8.5, harvested_mj: 8.5 }, label: "fake sim" }; };
  const r = bench.bench(B, { sim: fake, conditions: { wet: false }, objective: "quali" });
  assert.deepEqual(calls, [[physical.physical(B).mass_kg, "silverstone", { wet: false }]]);
  assert.equal(r.weekend.lap_s, 88.4); assert.equal(r.weekend.gap_to_pole_s, 0.289); assert.equal(r.score, -0.289);
  const q = Object.values(bench.racepace().silverstone.q); assert.equal(r.weekend.grid_position, 1 + q.filter(x => x < 88.4).length); assert.equal(r.weekend.grid_position, 3);
  assert.equal(r.sim_label, "fake sim");
});

test("optimize: same seed -> same lineage; every row is a numeric verdict (kept = legal and score improved)", () => {
  const a = optimize.optimize({ gens: 12, seed: 5, bench: V0 }), b = optimize.optimize({ gens: 12, seed: 5, bench: V0 }), c = optimize.optimize({ gens: 12, seed: 6, bench: V0 });
  assert.deepEqual(a.lineage, b.lineage); assert.deepEqual(a.best, b.best);
  assert.notDeepEqual(a.lineage, c.lineage);
  let parent = "baseline", score = a.baseline_result.score;
  for (const row of a.lineage) {
    assert.equal(row.parent, parent); assert.equal(row.score_before, score);
    assert.equal(row.kept, row.legal && row.score_after > row.score_before);
    assert.ok(row.hypothesis.length > 0 && row.hypothesis.length <= 200); assert.equal(row.label, bench.LABEL);
    if (row.kept) { parent = row.id; score = row.score_after; }
  }
});

test("optimize: 50 generations improve the weekend score and never return an illegal best", () => {
  const r = optimize.optimize({ gens: 50, seed: 1, bench: { circuits: ["silverstone", "monza"], sim: "v0" } });
  assert.equal(r.generations, 50); assert.equal(r.best_result.legal, true); assert.deepEqual(r.best_result.violations, []);
  assert.ok(r.best_result.score > r.baseline_result.score + 0.05, "score " + r.best_result.score);
  assert.ok(r.best_result.circuits.silverstone.lap_s < r.baseline_result.circuits.silverstone.lap_s);
  assert.ok(r.best_result.mass.total_kg >= r.best_result.mass.min_kg);
  assert.ok(r.kept > 0 && r.diff.length > 0);
  for (const row of r.lineage) if (row.kept) assert.equal(row.result.legal, true);
});

test("optimize: pluggable proposers (sync, async, bad output, illegal-only) and convergence", async () => {
  const seen = [];
  const sync = { name: "fixed", propose(history, d, ctx) { seen.push([history.length, ctx.gen, ctx.params.length > 10, ctx.rules.length > 10, typeof ctx.parent.score]); return { changes: [{ part: "rear_wing", param: "sm_delta_deg", to: d.params.rear_wing.sm_delta_deg + 2 }], hypothesis: "flatter flap on straights" }; } };
  const r = optimize.optimize({ gens: 3, proposer: sync, bench: V0 });
  assert.deepEqual(seen.map(s => s.slice(0, 2)), [[0, 1], [1, 2], [2, 3]]); assert.ok(seen.every(s => s[2] && s[3] && s[4] === "number"));
  assert.equal(r.best.params.rear_wing.sm_delta_deg, B.params.rear_wing.sm_delta_deg + 6); assert.equal(r.lineage[0].hypothesis, "flatter flap on straights"); assert.equal(r.kept, 3);
  assert.throws(() => optimize.optimize({ gens: 1, proposer: { name: "async", propose: async () => ({ changes: [] }) } }), /optimizeAsync/);
  let yields = 0;
  const ra = await optimize.optimizeAsync({ gens: 2, bench: V0, slice_ms: 0, yield: async () => { yields++; }, proposer: { name: "async", propose: async (h, d) => ({ changes: [{ part: "rear_wing", param: "sm_delta_deg", to: d.params.rear_wing.sm_delta_deg + 3 }] }) } });
  assert.equal(ra.best.params.rear_wing.sm_delta_deg, B.params.rear_wing.sm_delta_deg + 6); assert.equal(yields, 2, "one yield per measured candidate with slice_ms 0");
  const junk = optimize.optimize({ gens: 2, bench: V0, proposer: { name: "junk", propose: () => [{ changes: [{ part: "floor", param: "nope", to: 1 }] }, { changes: [] }, null] } });
  assert.equal(junk.kept, 0); assert.match(junk.lineage[0].candidates[0].error, /unknown parameter/); assert.equal(junk.lineage[0].candidates[1].error, "no change");
  const illegal = optimize.optimize({ gens: 3, bench: V0, proposer: { name: "illegal", propose: () => ({ changes: [{ part: "layout", param: "wheelbase_mm", to: 3600 }] }) } });
  assert.equal(illegal.kept, 0); assert.equal(illegal.best.id, "baseline"); assert.ok(illegal.lineage[0].candidates[0].violations.includes("REG-C-WB"));
  const conv = optimize.optimize({ gens: 500, until: "converged", patience: 4, bench: V0, proposer: { name: "illegal", propose: () => ({ changes: [{ part: "layout", param: "wheelbase_mm", to: 3600 }] }) } });
  assert.equal(conv.generations, 4); assert.match(conv.stopped, /converged/);
});

test("cli: writes lineage.jsonl + best.json outside data/, prints the table, refuses data/ and data-mock/", () => {
  const out = path.join(tmp(), "run"), cli = path.join(__dirname, "..", "concept", "cli.js");
  const r = spawnSync(process.execPath, [cli, "--gens", "3", "--seed", "4", "--circuits", "silverstone,monza", "--sim", "v0", "--out", out, "--quiet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /weekend score/); assert.match(r.stdout, /monza lap/);
  assert.equal(fs.readFileSync(path.join(out, "lineage.jsonl"), "utf8").trim().split("\n").length, 3);
  const best = JSON.parse(fs.readFileSync(path.join(out, "best.json"), "utf8")); assert.equal(best.seed, 4); assert.equal(best.best_result.legal, true);
  for (const bad of ["data", "data-mock/x"]) { const x = spawnSync(process.execPath, [cli, "--gens", "1", "--out", path.join(__dirname, "..", bad)], { encoding: "utf8" }); assert.equal(x.status, 1); assert.match(x.stderr, /refusing to write/); }
});
