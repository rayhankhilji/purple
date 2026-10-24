// concept/identify: joint multi-circuit car identification (docs/concept/IDENTIFY.md).
// Audit exclusions, determinism with a seed, basic physical sanity, and the committed output file.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const D = require("../concept/identify/data.js");
const M = require("../concept/identify/model.js");
const Q = require("../concept/identify/qss.js");
const I = require("../concept/identify/identify.js");

const SMALL = ["silverstone", "monza", "austria"];
const strip = o => JSON.stringify(Object.assign({}, o, { _meta: Object.assign({}, o._meta, { runtime_s: 0 }) }));

test("audit policy: every FAIL file gets an action; C1/C2/speed-jump FAILs are excluded; failed channels yield no features", () => {
  const A = D.audit();
  const fails = Object.values(A).filter(r => r.overall === "FAIL");
  assert.ok(fails.length >= 40, "the audit lists the qualifying FAIL files");
  for (const r of fails) {
    const p = D.lapPolicy(r.file);
    assert.ok(p.actions.length > 0, `${r.file} FAIL has an action`);
    if (r.C1 === "FAIL" || r.C2 === "FAIL" || +r.speed_jumps_25 >= 5) assert.equal(p.exclude, true, `${r.file} excluded`);
  }
  // C1 FAIL (lap time vs official): Silverstone PER; C2 FAIL (distance axis): Singapore STR; C4 speed jumps: Monza COL
  for (const [c, d] of [["silverstone", "PER"], ["singapore", "STR"], ["monza", "COL"]]) {
    const L = D.loadLap(c, d);
    assert.equal(L.policy.exclude, true);
    assert.equal(D.cornerPoints(L).length + D.brakeZones(L).length + D.fullThrottleRuns(L, 0.348).length, 0);
  }
  // C3 raw brake 104: brake channel out, rest kept
  const alb = D.loadLap("silverstone", "ALB");
  assert.equal(alb.policy.use.brakes, false); assert.equal(D.brakeZones(alb).length, 0); assert.ok(D.cornerPoints(alb).length > 0);
  // C4 > 10 accel violations: longitudinal channel out (no anchor runs, no brake zones), corners kept
  const per = D.loadLap("austria", "PER");
  assert.equal(per.policy.use.power, false); assert.equal(D.fullThrottleRuns(per, 0.348).length, 0); assert.equal(D.brakeZones(per).length, 0); assert.ok(D.cornerPoints(per).length > 0);
  // C3 null run > 200 m: lap kept, the gap ±100 m masked
  const ant = D.loadLap("suzuka", "ANT");
  assert.equal(ant.policy.exclude, false); assert.ok(ant.policy.null_margin_m > 0); assert.ok(ant.masked.null_margin_points > 0);
});

test("features: excluded laps never reach the fit; every used lap is PASS/WARN or FAIL with its failing channel removed", () => {
  const f = M.buildFeatures(SMALL);
  assert.ok(f.excluded.some(e => e.cid === "silverstone" && e.code === "PER"));
  assert.ok(f.excluded.some(e => e.cid === "monza" && e.code === "COL"));
  for (const l of f.laps) {
    assert.equal(l.L.policy.exclude, false);
    if (!l.use.brakes) assert.equal(l.brakes.length, 0);
    if (!l.use.power) assert.equal(l.runs.length, 0);
  }
});

test("determinism: the same seed gives the same output; a different seed changes only the bootstrap spread", () => {
  const o = { circuits: SMALL, boot: 3, seed: 7, loco: false, simCompat: false, date: "2026-01-01" };
  const a = I.run(o), b = I.run(o), c = I.run(Object.assign({}, o, { seed: 8 }));
  assert.equal(strip(a), strip(b));
  assert.notEqual(strip(a), strip(c));
  for (const id of D.TEAM_IDS) assert.equal(a.cars[id].params.mu_y.central, c.cars[id].params.mu_y.central, "central fit does not depend on the seed");
});

test("sanity: 11 cars, finite parameters with spread, physically plausible ranges, out-of-band values flagged", () => {
  const out = I.run({ circuits: SMALL, boot: 4, seed: 1, loco: false, simCompat: false, date: "2026-01-01" });
  assert.equal(Object.keys(out.cars).length, 11);
  for (const [id, c] of Object.entries(out.cars)) {
    for (const [k, s] of Object.entries(c.params)) { assert.ok(isFinite(s.mean) && isFinite(s.central), `${id}.${k} finite`); assert.ok(s.sd >= 0); }
    const p = c.params;
    assert.ok(p.mu_y.mean > 1 && p.mu_y.mean < 4, `${id} mu_y`);
    assert.ok(p.mu_x.mean > 0.8 && p.mu_x.mean < 3.5, `${id} mu_x`);
    assert.ok(p.CdA_m2.mean > 0.4 && p.CdA_m2.mean < 2.5, `${id} CdA`);
    assert.ok(p.P_ice_kw.mean > 300 && p.P_ice_kw.mean < 500, `${id} P`);
    assert.ok(p.mass_kg.mean > 750 && p.mass_kg.mean < 820, `${id} mass`);
    assert.ok(p.ay_200kmh_g.mean > p.ay_100kmh_g.mean, `${id} aero grip grows with speed`);
    for (const [k, chk] of Object.entries(c.prior_check)) if (!chk.in_band) assert.ok(c.flags.some(f => f.startsWith(k)), `${id}.${k} out of band is flagged`);
  }
});

test("qss: the identification's lap simulator gives a finite lap near the real one", () => {
  const f = M.buildFeatures(["silverstone"]), fit = M.fitCentral(f, ["silverstone"], { maxIt: 15 });
  const lap = f.laps.find(l => l.code === "HAD"), p = M.carAt(fit.th, fit.lay, lap.k, 0, fit.A);
  const r = Q.simulate(lap.L, p, { recharge_mj: 6.5 });
  assert.ok(isFinite(r.lap_time_s));
  assert.ok(Math.abs(r.lap_time_s - lap.lap_time_s) / lap.lap_time_s < 0.06, `sim ${r.lap_time_s} vs real ${lap.lap_time_s}`);
  assert.ok(r.deploy_mj <= 4 + 6.5 + 1e-6, "deployment within the C5.2.9 + C5.2.10 budget");
});

test("committed output: 11 cars ± std, 9 circuits, leave-one-circuit-out, provenance, honest wording", () => {
  const f = I.OUT_JSON;
  if (!fs.existsSync(f)) return; // produced by node concept/identify/identify.js --write
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.equal(Object.keys(j.cars).length, 11);
  assert.equal(Object.keys(j.circuits).length, 9);
  assert.equal(Object.keys(j.loco).length, 9);
  for (const c of Object.values(j.loco)) assert.ok(c.held_out_refit.n_laps > 0);
  for (const c of Object.values(j.cars)) { for (const k of ["mu_y", "mu_x", "ClA_m2", "CdA_m2", "P_ice_kw", "mass_kg"]) { assert.ok(c.params[k].sd > 0, k); } assert.equal(Object.keys(c.trims).length, 9); }
  assert.ok(j.provenance.laps_excluded.some(e => e.file === "silverstone-2026-q-per.json"));
  assert.ok(j.provenance.laps_used.every(l => !/silverstone-2026-q-per|singapore-2026-q-str|monza-2026-q-col/.test(l.file)));
  assert.match(j._meta.label, /OpenF1/);
  const text = fs.readFileSync(f, "utf8") + fs.readFileSync(path.join(D.ROOT, "docs", "concept", "IDENTIFY.md"), "utf8");
  for (const w of [/\bCFD\b/, /wind tunnel/i, /\bvalidated\b/i]) assert.doesNotMatch(text, w);
});
