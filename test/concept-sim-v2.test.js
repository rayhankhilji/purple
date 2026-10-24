// PURPLE concept lap sim v2 (docs/concept/SIM.md §3, §8): wind, density, gradient, platform, energy store, temperature, yaw,
// upshift cut, per-corner output, contributions, prior ranges. node --test test/concept-sim-v2.test.js
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const sim = require("../concept/sim/index.js");
const F = require("../concept/sim/fit.js");
const aero = require("../lab/aero.js");

const ROOT = path.join(__dirname, "..");
const clone = o => JSON.parse(JSON.stringify(o));
const run = (car, cond, opts) => sim.simulateLap(car, "silverstone", cond, opts);
const base = sim.baselineCar();
const BASE = run(base, undefined, { trace: true });
const tr = sim.buildTrack("silverstone");
const hangarHeading = tr.heading[tr.idxAtS(4600)];

test("wind: a headwind on the Hangar Straight lowers its trap, a tailwind raises it; resolved per segment against the heading", () => {
  const into = { wind_ms: 5, wind_from_deg: aero.bearingOfHeading(hangarHeading) };
  const behind = { wind_ms: 5, wind_from_deg: (aero.bearingOfHeading(hangarHeading) + 180) % 360 };
  assert.ok(sim.headwind(into, hangarHeading) > 4.9 && sim.headwind(behind, hangarHeading) < -4.9);
  assert.ok(sim.crosswind(into, hangarHeading) < 1e-9, "pure headwind has no crosswind");
  const h = run(base, into), t = run(base, behind);
  assert.ok(h.speed_trap_kmh < BASE.speed_trap_kmh - 3, "headwind trap " + h.speed_trap_kmh + " vs " + BASE.speed_trap_kmh);
  assert.ok(t.speed_trap_kmh > BASE.speed_trap_kmh + 3, "tailwind trap " + t.speed_trap_kmh);
  // the same wind is a headwind on some segments and a tailwind on others: the per-segment component changes sign round the lap
  let pos = 0, neg = 0; for (let i = 0; i < tr.n; i += 20) { const w = sim.headwind(into, tr.heading[i]); if (w > 1) pos++; if (w < -1) neg++; }
  assert.ok(pos > 5 && neg > 5);
});

test("air density: from temperature, pressure and humidity; denser air = lower trap (drag) and more downforce", () => {
  assert.ok(sim.airDensity({ air_temp_c: 15, air_pressure_hpa: 1013.25, humidity_pct: 0 }) > 1.22 && sim.airDensity({ air_temp_c: 15, air_pressure_hpa: 1013.25, humidity_pct: 0 }) < 1.23);
  assert.ok(sim.airDensity({ air_temp_c: 35, air_pressure_hpa: 1007.6, humidity_pct: 48 }) < sim.airDensity({ air_temp_c: 15, air_pressure_hpa: 1007.6, humidity_pct: 48 }));
  assert.ok(sim.airDensity({ air_temp_c: 25, air_pressure_hpa: 1007.6, humidity_pct: 90 }) < sim.airDensity({ air_temp_c: 25, air_pressure_hpa: 1007.6, humidity_pct: 0 }), "moist air is lighter");
  const thin = run(base, { air_density_kgm3: 1.05 }), thick = run(base, { air_density_kgm3: 1.25 });
  assert.ok(thin.speed_trap_kmh > thick.speed_trap_kmh);
  assert.ok(sim.capacity(base, 220, { air_density_kgm3: 1.25 }).ay_g > sim.capacity(base, 220, { air_density_kgm3: 1.05 }).ay_g, "downforce scales with density");
});

test("gradient: an uphill stretch costs speed, a downhill one gives it (grade from the circuit elevation profile)", () => {
  // the steepest 200 m climb on a full-throttle stretch of the lap
  let best = null;
  for (let s = 0; s < tr.L - 200; s += 10) {
    let g = 0; for (let d = 0; d < 200; d += tr.ds) g += tr.grade[tr.idxAtS(s + d)];
    g /= 200 / tr.ds; if (!best || g > best.g) best = { s, g };
  }
  assert.ok(best.g > 0.004, "the track has a measurable climb (" + (best.g * 100).toFixed(2) + " %)");
  const up = run(base, undefined, { trace: true, grade_scale: 3 }), down = run(base, undefined, { trace: true, grade_scale: -3 });
  const dv = r => r.trace.v_kmh[Math.round((best.s + 200) / tr.ds)] - r.trace.v_kmh[Math.round(best.s / tr.ds)];
  assert.ok(dv(up) < dv(down), "speed gained over the climb: steeper " + dv(up) + " vs reversed " + dv(down));
  assert.ok(Math.abs(run(base, undefined, { grade_scale: 0 }).lap_s - BASE.lap_s) < 0.2, "a closed lap's net climb is zero");
});

test("determinism: identical inputs (incl. wind, crosswind yaw, temperature, start SoC) give identical outputs", () => {
  const c = clone(base); c.aero.yaw_sens = 0.01;
  const cond = { wind_ms: 4, wind_from_deg: 210, track_temp_c: 33, es_start_mj: 3 };
  for (const strategy of ["threshold", "optimal", "marginal"]) assert.deepEqual(run(c, cond, { trace: true, strategy }), run(clone(c), clone(cond), { trace: true, strategy }), strategy);
});

test("energy store (optimal strategy): never below empty within the lap, recharge cap, start SoC respected", () => {
  const r = run(base, undefined, { strategy: "optimal" }), e = r.energy;
  assert.equal(e.soc_start_mj, 4);
  assert.ok(e.soc_min_mj >= -0.001 && e.harvested_mj <= 6.5 + 1e-6 && e.deployed_mj <= 4 + e.harvested_mj + 1e-3, JSON.stringify(e));
  const empty = run(base, { es_start_mj: 0 }, { strategy: "optimal" });
  assert.ok(empty.energy.deployed_mj <= empty.energy.harvested_mj + 1e-3 && empty.lap_s > r.lap_s, JSON.stringify(empty.energy));
});

test("tyre grip vs track temperature (estimate): unchanged at the calibration session's 40.4 C, slower away from it", () => {
  assert.equal(sim.tyreTempFactor(40.4), 1);
  assert.equal(run(base, { track_temp_c: 40.4 }).lap_s, BASE.lap_s);
  assert.ok(run(base, { track_temp_c: 20 }).lap_s > BASE.lap_s + 0.2);
  assert.ok(sim.tyreTempFactor(-50) >= sim.MODEL.tyre_temp.floor);
});

test("crosswind yaw (estimate): no effect without aero.yaw_sens or without wind; with both, slower", () => {
  const cond = { wind_ms: 6, wind_from_deg: 90 };
  const y = clone(base); y.aero.yaw_sens = 0.02;
  assert.equal(run(y).lap_s, BASE.lap_s, "no wind, no yaw");
  assert.ok(run(y, cond).lap_s > run(base, cond).lap_s, "crosswind costs downforce");
});

test("upshift torque cut: costs time, capped at 200 ms", () => {
  const keep = sim.MODEL.upshift_cut_s;
  try {
    sim.MODEL.upshift_cut_s = 0; const none = run(base);
    sim.MODEL.upshift_cut_s = 0.1; const some = run(base);
    sim.MODEL.upshift_cut_s = 0.2; const cap = run(base);
    sim.MODEL.upshift_cut_s = 5; const over = run(base);
    assert.ok(some.lap_s > none.lap_s && cap.lap_s > some.lap_s, [none.lap_s, some.lap_s, cap.lap_s].join(" "));
    assert.equal(over.lap_s, cap.lap_s);
  } finally { sim.MODEL.upshift_cut_s = keep; }
});

test("per-corner output: every marked corner with its minimum and apex speed; slow corners slower than fast ones", () => {
  const c = BASE.corners;
  assert.equal(c.length, 18);
  for (const k of c) {
    assert.ok(k.min_kmh > 50 && k.min_kmh <= k.apex_kmh + 0.05 && k.apex_lat_g > 0 && k.apex_lat_g < 7, JSON.stringify(k));
    assert.match(k.name, /\(T\d+\)$/);
  }
  const by = n => c.find(k => k.n === n);
  assert.ok(by(4).min_kmh < by(9).min_kmh, "The Loop slower than Copse");
});

test("contributions: segment deltas add up to the lap delta; a drag change is lost on the straights", () => {
  const same = sim.contributions(base);
  assert.equal(same.delta_s, 0);
  assert.ok(same.segments.every(g => g.delta_s === 0));
  const draggy = clone(base); for (const m of ["corner", "straight"]) draggy.aero[m].CDA_m2 *= 1.08;
  const r = sim.contributions(draggy, base);
  const sum = r.segments.reduce((p, g) => p + g.delta_s, 0);
  assert.ok(Math.abs(sum - r.delta_s) < 0.01, sum + " vs " + r.delta_s);
  assert.ok(r.delta_s > 0.2);
  const onStraights = r.segments.filter(g => g.kind === "straight").reduce((p, g) => p + g.delta_s, 0);
  assert.ok(onStraights > 0.4 * r.delta_s, "straights carry most of a drag loss: " + onStraights.toFixed(3) + " of " + r.delta_s);
  assert.ok(r.segments.some(g => g.kind === "corner") && r.segments.some(g => g.kind === "straight"));
  const span = r.segments.reduce((p, g) => p + (((g.s1_m - g.s0_m) % tr.L) + tr.L) % tr.L, 0);
  assert.ok(Math.abs(span - tr.L) < 5, "segments tile the lap: " + span);
});

test("prior ranges: the embedded copy matches concept/data/priors-2026.json; the baseline and team cars sit inside them", () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "concept/data/priors-2026.json"), "utf8"));
  for (const [k, v] of Object.entries(F.PRIOR_RANGES)) {
    const r = j.recommended_fit_priors.find(x => x.key === k);
    assert.ok(r, k); assert.deepEqual(v, [r.lo, r.central, r.hi], k);
  }
  const rows = F.priorTable(base);
  assert.ok(rows.length >= 10 && rows.every(r => r.inside), JSON.stringify(rows.filter(r => !r.inside)));
  const fit = sim.fitted();
  assert.ok(fit.calibration.prior_check.every(r => r.inside));
});
