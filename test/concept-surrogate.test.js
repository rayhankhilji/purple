// PURPLE CONCEPT - surrogate models of the lap sims (concept/surrogate, docs/concept/SURROGATE.md): feature map, deterministic
// training, accuracy of the SAVED models against the live sims, the extrapolation refusal, uncertainty propagation, the bench
// adapter and timing. Loads the saved models; never retrains them (a tiny in-process fit on an analytic sim checks the trainer).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const F = require("../concept/surrogate/features.js");
const S = require("../concept/surrogate/surrogate.js");
const T = require("../concept/surrogate/train.js");
const design = require("../concept/design.js"), phys = require("../concept/physical.js");

const ROOT = path.join(__dirname, ".."), MODELS = path.join(ROOT, "concept", "surrogate", "models");
const clone = o => JSON.parse(JSON.stringify(o));
const B = design.baseline(), PC0 = phys.physical(B);
const RETRAIN = sim => "the sim answers differently from when its surrogate was trained: retrain with `node concept/surrogate/train.js --sim " + sim + "`";

test("features: dimensionless groups with 2026-era magnitudes; RAW round trip through fromRaw", () => {
  const f = F.features(PC0), at = n => f[F.NAMES.indexOf(n)];
  assert.equal(f.length, F.FEATURES.length); assert.equal(F.NAMES.length, new Set(F.NAMES).size);
  for (const v of f) assert.ok(Number.isFinite(v));
  assert.ok(at("aero_load") > 0.5 && at("aero_load") < 2, "downforce/weight at 60 m/s ≈ 1");
  assert.ok(at("drag") > 0.1 && at("drag") < 0.5); assert.ok(at("power") > 0.5 && at("power") < 1.2);
  assert.ok(at("top_speed_index") > 1.2 && at("top_speed_index") < 2, "v_max / v_ref");
  assert.ok(Math.abs(at("balance_misfit")) < 1e-3, "the baseline is the reference set-up");
  assert.equal(at("bottoming"), 0); assert.equal(at("floor_stalled"), 0);
  // the same car in other units (mass +10 %, every force-like level +10 %) keeps the per-weight groups
  const k = clone(PC0); k.mass_kg *= 1.1; k.fuel_kg *= 1.1; for (const m of ["corner", "straight"]) for (const q of ["CLA_front_m2", "CLA_rear_m2", "CDA_m2"]) k.aero[m][q] *= 1.1; k.pu.ice_kw *= 1.1; k.pu.mguk_kw *= 1.1;
  const g = F.features(k); for (const n of ["aero_load", "drag", "power", "hybrid_power", "top_speed_index", "balance_offset"]) assert.ok(Math.abs(g[F.NAMES.indexOf(n)] - at(n)) < 1e-9, n);
  for (const car of [PC0, require("../concept/sim/index.js").baselineCar("redbull")]) {
    const x = F.rawVector(car), back = F.rawVector(F.fromRaw(x, car));
    for (let i = 0; i < x.length; i++) assert.ok(Math.abs(back[i] - x[i]) < 1e-9 * (1 + Math.abs(x[i])), F.RAW_NAMES[i]);
    const fb = F.features(F.fromRaw(x, car)), fa = F.features(car); for (let i = 0; i < fa.length; i++) assert.ok(Math.abs(fb[i] - fa[i]) < 1e-9, F.NAMES[i]);
  }
});

// a known smooth "sim": the trainer must be deterministic and must recover a function that is exactly quadratic in the features
function analyticSim(pc) {
  const f = F.features(pc), a = f[F.NAMES.indexOf("aero_grip")], d = f[F.NAMES.indexOf("drag")], p = f[F.NAMES.indexOf("power")], mu = f[0];
  const lap = 90 - 6 * a + 9 * d - 7 * p - 3 * mu + 4 * a * a + 2 * d * p;
  return { lap_s: lap, sectors_s: [0.3 * lap, 0.4 * lap, 0.3 * lap - a], speed_trap_kmh: 300 + 60 * p - 90 * d, vmin_kmh: 80 + 20 * mu, label: "analytic test sim" };
}
const tinyBox = () => {
  const c = F.rawVector(PC0), lo = Float64Array.from(c, v => v - 0.05 * Math.abs(v)), hi = Float64Array.from(c, v => v + 0.05 * Math.abs(v));
  return { lo, hi, centre: c, source: "test box ± 5 %", stall_in_doe: false };
};
test("train: same seed -> byte-identical model; an exact quadratic is recovered (in-process, analytic sim)", async () => {
  const run = name => T.train({ name, simFn: analyticSim, circuit: "testtrack", n: 700, seed: 5, classes: ["quadratic"], centreCar: PC0, box: tinyBox(), checks: false });
  const a = await run("analytic"), b = await run("analytic");
  assert.equal(JSON.stringify(a), JSON.stringify(b), "deterministic");
  assert.equal(a.format, S.FORMAT); assert.equal(a.features_version, F.VERSION);
  assert.ok(a.report.test.chosen.lap_s.rmse < 1e-4, "lap RMSE " + a.report.test.chosen.lap_s.rmse);
  assert.ok(a.report.test.chosen.lap_s.r2 > 0.99999);
  const pc = clone(PC0); pc.mass_kg += 12; pc.aero.corner.CDA_m2 *= 1.02;
  assert.ok(Math.abs(S.predict(pc, "testtrack", { sim: "analytic" }).lap_s - analyticSim(pc).lap_s) < 1e-3);
  // different seed -> a different DOE
  const c = await T.train({ name: "analytic2", simFn: analyticSim, circuit: "testtrack", n: 700, seed: 6, classes: ["quadratic"], centreCar: PC0, box: tinyBox(), checks: false });
  assert.notEqual(JSON.stringify(c.feat.mean), JSON.stringify(a.feat.mean));
});

test("saved models: present, small, current feature map, label and report", () => {
  for (const [sim, circuit] of [["physics", "silverstone"], ["v0", "silverstone"], ["v0", "monza"]]) {
    const f = path.join(MODELS, sim + "-" + circuit + ".json");
    assert.ok(fs.existsSync(f), f); assert.ok(fs.statSync(f).size < 1.5e6, "small: " + fs.statSync(f).size);
    const P = S.load(sim, circuit), m = P.json;
    assert.equal(m.features_version, F.VERSION); assert.equal(m.sim, sim); assert.equal(m.circuit, circuit);
    assert.ok(m.trained.n >= 5000, "trained on ≥ 5000 sim runs");
    for (const k of ["lap_s", "s1_s", "s2_s", "s3_s", "speed_trap_kmh", "vmin_kmh"]) assert.ok(m.targets[k], k);
    assert.match(P.label, /^surrogate of .+ · RMSE \d+\.\d ms$/);
    for (const c of ["quadratic", "rbf", "mlp"]) assert.ok(m.report.test.per_class[c].lap_s.r2 > 0.9, sim + " " + c);
  }
  assert.ok(Object.keys(S.load("physics", "silverstone").json.targets).some(k => k.startsWith("apex.")), "per-corner apex speeds from the physics sim");
  assert.ok(S.available().some(a => a.sim === "physics" && a.circuit === "silverstone"));
});

test("determinism: predict / predictLap / uncertainty are pure functions of their inputs", () => {
  const a = S.predict(PC0, "silverstone", { sim: "v0" }), b = S.predict(clone(PC0), "silverstone", { sim: "v0" });
  assert.deepEqual(a, b); assert.equal(a.ok, true); assert.equal(a.extrapolating, false); assert.equal(a.sectors_s.length, 3);
  assert.equal(S.predictLap(PC0, "silverstone", "v0"), a.lap_s);
  const u1 = S.predictWithUncertainty(PC0, { mass_kg: 2 }, 300, { circuit: "silverstone", sim: "v0", seed: 9 });
  const u2 = S.predictWithUncertainty(PC0, { mass_kg: 2 }, 300, { circuit: "silverstone", sim: "v0", seed: 9 });
  assert.deepEqual(u1, u2);
});

test("accuracy (sim v0, live): the baseline and 12 seeded concept mutations within the saved test error", () => {
  const bench = require("../concept/bench.js"), rng = design.seededRng(77);
  const m = S.load("v0", "silverstone").json;
  const base = bench.simV0(PC0, "silverstone");
  assert.ok(Math.abs(base.lap_s - m.sim_fingerprint.lap_s) < 1e-9, RETRAIN("v0"));
  assert.ok(Math.abs(S.predictLap(PC0, "silverstone", "v0") - base.lap_s) < 0.05, "baseline within 50 ms");
  const err = [], dSim = [], dSur = [];
  for (let k = 0; k < 12; k++) {
    const pc = phys.physical(design.mutate(B, rng, 0.08).design), s = bench.simV0(pc, "silverstone").lap_s, p = S.predict(pc, "silverstone", { sim: "v0" });
    assert.equal(p.ok, true); err.push(p.lap_s - s); dSim.push(s - base.lap_s); dSur.push(p.lap_s - S.predictLap(PC0, "silverstone", "v0"));
  }
  const rmse = Math.sqrt(err.reduce((s, e) => s + e * e, 0) / err.length);
  assert.ok(rmse < 0.08, "v0 lap RMSE on mutations " + rmse.toFixed(4) + " s");
  assert.ok(T.spearman(dSim, dSur) > 0.8, "ranking of the 12 changes preserved: ρ " + T.spearman(dSim, dSur).toFixed(3));
  const r = m.report;
  assert.ok(r.test.chosen.lap_s.r2 > 0.98 && r.checks.ranking.spearman_rho > 0.95, "saved report: R² " + r.test.chosen.lap_s.r2 + ", ρ " + r.checks.ranking.spearman_rho);
});

test("accuracy (physics sim, live): the centre car and the fitted team cars", () => {
  const sim = require("../concept/sim/index.js"), m = S.load("physics", "silverstone").json;
  const rb = sim.baselineCar("redbull"), r = sim.simulateLap(rb, "silverstone");
  assert.ok(Math.abs(r.lap_s - m.sim_fingerprint.lap_s) < 1e-9, RETRAIN("physics"));
  const p = S.predict(rb, "silverstone", { sim: "physics" });
  assert.equal(p.ok, true); assert.ok(p.distance < 1e-6, "centred on the Red Bull car");
  assert.ok(Math.abs(p.lap_s - r.lap_s) < 0.05, "centre car within 50 ms: " + p.lap_s + " vs " + r.lap_s);
  assert.ok(Math.abs(p.speed_trap_kmh - r.speed_trap_kmh) < 3, "trap within 3 km/h");
  const teams = sim.teamCars(), errs = [];
  for (const c of teams.slice(0, 4)) { const q = S.predict(c, "silverstone", { sim: "physics" }); assert.equal(q.ok, true, c.id + " inside the box"); errs.push(q.lap_s - sim.simulateLap(c, "silverstone").lap_s); }
  const rmse = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  assert.ok(rmse < 0.08, "team cars lap RMSE " + rmse.toFixed(4));
  assert.ok(m.report.checks.team_cars.n_in_box === teams.length, "all fitted team cars inside the training box");
  assert.ok(m.report.checks.ranking.spearman_rho > 0.95, "ranking ρ " + m.report.checks.ranking.spearman_rho);
});

test("extrapolation: outside the training box the surrogate refuses (and says which field)", () => {
  const big = clone(PC0); big.mass_kg = 1500;
  const p = S.predict(big, "silverstone", { sim: "v0" });
  assert.equal(p.ok, false); assert.equal(p.extrapolating, true); assert.equal(p.lap_s, null);
  assert.deepEqual(p.out_of_box.map(o => o.field), ["mass_kg"]); assert.match(p.label, /refused: outside the training box \(mass_kg\)/);
  const forced = S.predict(big, "silverstone", { sim: "v0", allowExtrapolation: true });
  assert.equal(forced.extrapolating, true); assert.ok(Number.isFinite(forced.lap_s)); assert.match(forced.label, /EXTRAPOLATING/);
  assert.ok(Number.isNaN(S.predictLap(big, "silverstone", "v0")));
  const wide = clone(PC0); wide.track_front_m = 2.1;
  assert.deepEqual(S.inBox(wide, "silverstone", "v0").out_of_box.map(o => o.field), ["track_front_m"], "fields the DOE held fixed are checked too");
  const stalled = require("../concept/sim/index.js").baselineCar("redbull"); stalled.aero.floor_stalled = true;
  assert.equal(S.predict(stalled, "silverstone", { sim: "physics" }).ok, false, "a stalled floor (CLA × 0.5 in the physics sim) is not in the physics box");
  // physical() maps the concept car onto the physics sim's anchor car, so the concept baseline is inside the physics box;
  // carrying it relative to the baseline (relativeCar) still lands inside too
  assert.equal(S.predict(PC0, "silverstone", { sim: "physics" }).ok, true);
  const rel = S.relativeCar(PC0, PC0, S.load("physics", "silverstone").json.centre_car);
  assert.equal(S.predict(rel, "silverstone", { sim: "physics" }).ok, true);
  assert.throws(() => S.asSim("silverstone", { sim: "v0" })(big, "silverstone"), /refused/);
  const fb = S.asSim("silverstone", { sim: "v0", fallback: () => ({ lap_s: 99, label: "fallback" }) })(big, "silverstone");
  assert.equal(fb.lap_s, 99); assert.equal(fb.surrogate.fallback, true);
  assert.throws(() => S.load("v0", "nowhere"), /no saved model v0-nowhere/);
});

test("bench adapter: bench(design, { sim: surrogate.asSim(...) }) scores like the sim it imitates", () => {
  const bench = require("../concept/bench.js");
  const r = bench.bench(B, { sim: S.asSim("silverstone", { sim: "v0" }) });
  assert.equal(r.legal, true); assert.match(r.sim_label, /^surrogate of /);
  assert.ok(Math.abs(r.weekend.lap_s - 88.111) < 0.05, "baseline ≈ the real pole by construction in v0: " + r.weekend.lap_s);
  const c = r.circuits.silverstone; for (const k of ["lap_s", "vmax_kmh", "speed_trap_kmh", "vmin_kmh"]) assert.ok(Number.isFinite(c[k]), k); assert.equal(c.sectors_s.length, 3);
  const rp = bench.bench(B, { sim: S.asSim("silverstone", { sim: "physics", relativeTo: PC0 }) });
  const rbLap = S.load("physics", "silverstone").json.sim_fingerprint.lap_s;
  assert.ok(Math.abs(rp.weekend.lap_s - rbLap) < 0.05, "the baseline design carried onto the Red Bull car laps like it");
  assert.ok(rp.circuits.silverstone.surrogate.apex_kmh, "apex speeds ride along");
});

test("uncertainty: Monte Carlo spread grows with the input spread, centred on the point prediction", () => {
  const rb = require("../concept/sim/index.js").baselineCar("redbull"), opt = { circuit: "silverstone", sim: "physics", seed: 3 };
  const none = S.predictWithUncertainty(rb, {}, 200, opt);
  assert.ok(none.lap_s.std < 1e-12); assert.ok(none.lap_s.std_total > 0, "the surrogate's own RMSE is carried");
  const small = S.predictWithUncertainty(rb, { aero: { corner: { CLA_front_m2: 0.03, CLA_rear_m2: 0.04, CDA_m2: 0.01 } }, tyres: { mu_y: 0.01 } }, 2000, opt);
  const large = S.predictWithUncertainty(rb, { aero: { corner: { CLA_front_m2: 0.09, CLA_rear_m2: 0.12, CDA_m2: 0.03 } }, tyres: { mu_y: 0.03 } }, 2000, opt);
  assert.ok(small.lap_s.std > 0.005 && large.lap_s.std > 2 * small.lap_s.std, small.lap_s.std + " / " + large.lap_s.std);
  // sim v2: the Red Bull car sits at the axle-balance optimum (a kink in lap vs aero balance), so independent front/rear CLA
  // noise can only move it off-balance: the Monte Carlo mean is slower than the point prediction, never faster, by < 1 std
  const point = S.predictLap(rb, "silverstone", "physics");
  assert.ok(small.lap_s.mean > point - 0.02 && small.lap_s.mean - point < small.lap_s.std, small.lap_s.mean + " vs " + point);
  assert.ok(small.lap_s.p05 < small.lap_s.mean && small.lap_s.mean < small.lap_s.p95);
  assert.equal(small.inputs.length, 4); assert.ok(small.frac_outside_box < 0.05);
  assert.throws(() => S.predictWithUncertainty(rb, { aero: { nope: 1 } }, 10, opt), /no numeric field/);
});

test("timing: microseconds per call (generous bounds)", () => {
  const rb = require("../concept/sim/index.js").baselineCar("redbull");
  const time = (fn, n) => { for (let i = 0; i < 500; i++) fn(); const t0 = process.hrtime.bigint(); for (let i = 0; i < n; i++) fn(); return Number(process.hrtime.bigint() - t0) / 1e3 / n; };
  const q = time(() => S.predictLap(rb, "silverstone", "physics", "quadratic"), 20000);
  const c = time(() => S.predictLap(rb, "silverstone", "physics"), 5000);
  const full = time(() => S.predict(rb, "silverstone", { sim: "physics" }), 1000);
  assert.ok(q < 50, "quadratic lap " + q.toFixed(2) + " µs"); assert.ok(c < 500, "chosen lap " + c.toFixed(2) + " µs"); assert.ok(full < 5000, "all targets " + full.toFixed(1) + " µs");
});

test("honesty: surrogate code and docs never use the banned words", () => {
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated", "aerodynamically" + " tested"].join("|"), "i");
  const files = ["concept/surrogate/train.js", "concept/surrogate/surrogate.js", "concept/surrogate/features.js", "docs/concept/SURROGATE.md", "test/concept-surrogate.test.js"].map(f => path.join(ROOT, f));
  for (const f of files) { assert.ok(fs.existsSync(f), f); const m = banned.exec(fs.readFileSync(f, "utf8")); assert.equal(m, null, path.relative(ROOT, f) + ": " + (m && m[0])); }
});
