// PURPLE concept lap sim (concept/sim, docs/concept/SIM.md): determinism, physics sanity, energy budgets, calibration, team fit,
// timing, honesty. node --test test/concept-sim.test.js
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const sim = require("../concept/sim/index.js");
const aero = require("../lab/aero.js");

const ROOT = path.join(__dirname, "..");
const clone = o => JSON.parse(JSON.stringify(o));
const run = (car, cond, opts) => sim.simulateLap(car, "silverstone", cond, opts);
const base = sim.baselineCar();
const BASE = run(base, undefined, { trace: true });
// minimum speed in the fast complex Copse..Chapel (control-line frame = track-data frame at Silverstone)
const fastMin = r => { let m = Infinity; r.trace.s_m.forEach((s, k) => { if (s > 3050 && s < 4300) m = Math.min(m, r.trace.v_kmh[k]); }); return m; };
const scaleAero = (car, key, f) => { const c = clone(car); for (const m of ["corner", "straight"]) { if (key === "CDA") c.aero[m].CDA_m2 *= f; else { c.aero[m].CLA_front_m2 *= f; c.aero[m].CLA_rear_m2 *= f; } } return c; };

test("contract: output shape, units and the label", () => {
  const r = BASE;
  for (const k of ["lap_s", "vmax_kmh", "speed_trap_kmh", "vmin_kmh"]) assert.ok(Number.isFinite(r[k]), k);
  assert.equal(r.sectors_s.length, 3);
  assert.ok(Math.abs(r.sectors_s.reduce((a, b) => a + b, 0) - r.lap_s) < 0.003, "sectors sum to the lap");
  assert.ok(r.energy && Number.isFinite(r.energy.deployed_mj) && Number.isFinite(r.energy.harvested_mj));
  assert.equal(r.label, "physics lap sim · quasi-steady-state point mass · Silverstone OSM centreline · calibrated to 2026 British GP qualifying");
  assert.equal(r.trace.s_m.length, r.trace.v_kmh.length);
  assert.ok(r.trace.s_m.length > 2000, "2-5 m resolution");
  assert.equal(run(base).trace, undefined, "trace only on request");
  assert.ok(r.vmin_kmh < r.speed_trap_kmh && r.speed_trap_kmh <= r.vmax_kmh + 0.05);
});

test("determinism: identical inputs give identical outputs (incl. trace)", () => {
  assert.deepEqual(run(base, undefined, { trace: true }), BASE);
  assert.deepEqual(run(clone(base), clone(sim.DEFAULT_CONDITIONS), { trace: true }), BASE);
});

test("calibration: baseline within 0.3 s of the 88.111 s pole and close to the pole-sitter's 302.6 km/h trap", () => {
  const ref = sim.reference();
  assert.equal(ref.lap_s, 88.111); assert.equal(ref.driver, "ANT"); assert.equal(ref.trap_kmh, 302.6);
  assert.ok(Math.abs(BASE.lap_s - 88.111) <= 0.3, "lap " + BASE.lap_s);
  assert.ok(Math.abs(BASE.speed_trap_kmh - 302.6) <= 2, "trap " + BASE.speed_trap_kmh);
  const f = sim.fitted();
  assert.ok(f.global.grip_scale > 0.6 && f.global.grip_scale < 1.8 && f.global.drag_scale > 0.5 && f.global.drag_scale < 2, "global factors inside their bounds");
});

test("calibrate() reproduces the committed global factors (fitted.js is current)", () => {
  const c = sim.calibrate({ conditions: sim.DEFAULT_CONDITIONS });
  const g = sim.fitted().global;
  assert.ok(Math.abs(c.grip_scale - g.grip_scale) < 1e-3 && Math.abs(c.drag_scale - g.drag_scale) < 1e-3, JSON.stringify([c, g]));
  assert.ok(Math.abs(c.residual_lap_s) < 0.02 && Math.abs(c.residual_trap_kmh) < 0.5);
});

test("physics: more drag (CDA +10 %) -> lower top speed and trap, slower lap, slower straight-heavy S3", () => {
  const r = run(scaleAero(base, "CDA", 1.1));
  assert.ok(r.vmax_kmh < BASE.vmax_kmh && r.speed_trap_kmh < BASE.speed_trap_kmh, r.vmax_kmh + " vs " + BASE.vmax_kmh);
  assert.ok(r.lap_s > BASE.lap_s + 0.2, r.lap_s + " vs " + BASE.lap_s);
  assert.ok(r.sectors_s[2] > BASE.sectors_s[2]);
});

test("physics: more downforce (CLA +10 %) -> higher minimum speed through Copse..Chapel and a faster lap", () => {
  const r = run(scaleAero(base, "CLA", 1.1), undefined, { trace: true });
  assert.ok(fastMin(r) > fastMin(BASE) + 2, fastMin(r) + " vs " + fastMin(BASE));
  assert.ok(r.lap_s < BASE.lap_s - 0.2);
});

test("physics: more mass -> slower; more power -> faster with a higher trap", () => {
  const heavy = clone(base); heavy.mass_kg += 20;
  assert.ok(run(heavy).lap_s > BASE.lap_s + 0.2);
  const fuel = run(base, { fuel_kg: 40 });
  assert.ok(fuel.lap_s > BASE.lap_s, "fuel load is mass");
  const strong = clone(base); strong.pu.ice_kw *= 1.1;
  const r = run(strong);
  assert.ok(r.lap_s < BASE.lap_s - 0.2 && r.speed_trap_kmh > BASE.speed_trap_kmh + 2, JSON.stringify([r.lap_s, r.speed_trap_kmh]));
});

test("physics: wet is slower; air density and headwind act through drag", () => {
  assert.ok(run(base, { wet: true }).lap_s > BASE.lap_s + 4);
  const thin = run(base, { air_density_kgm3: 1.05 }), thick = run(base, { air_density_kgm3: 1.25 });
  assert.ok(thin.speed_trap_kmh > thick.speed_trap_kmh);
  // a wind blowing from the direction the Hangar Straight points is a headwind there (lab/aero.js convention)
  const tr = sim.buildTrack("silverstone"), h = tr.heading[tr.idxAtS(4700)];
  const into = { wind_ms: 6, wind_from_deg: aero.bearingOfHeading(h) };
  assert.ok(Math.abs(sim.headwind(into, h) - aero.headwind(into, h)) < 1e-9 && sim.headwind(into, h) > 5.9, "same sign convention as lab/aero.js");
  assert.ok(run(base, into).speed_trap_kmh < BASE.speed_trap_kmh);
});

test("energy: budgets respected (deploy <= SOC window + harvest, harvest <= recharge cap, car caps honoured)", () => {
  const e = BASE.energy;
  assert.equal(e.recharge_cap_mj, 6.5, "Silverstone qualifying recharge limit");
  assert.ok(e.harvested_mj <= 6.5 + 1e-6 && e.deployed_mj <= 4 + e.harvested_mj + 1e-3, JSON.stringify(e));
  assert.ok(Math.abs(e.harvested_braking_mj + e.harvested_superclip_mj - e.harvested_mj) < 0.002);
  for (const [k, v] of [["es_deploy_mj_per_lap", 6], ["es_harvest_mj_per_lap", 3]]) {
    const c = clone(base); c.pu[k] = v; const r = run(c);
    assert.ok(r.energy.deployed_mj <= c.pu.es_deploy_mj_per_lap + 1e-3 && r.energy.harvested_mj <= Math.min(c.pu.es_harvest_mj_per_lap, 6.5) + 1e-6, k + " " + JSON.stringify(r.energy));
    assert.ok(r.energy.deployed_mj <= 4 + r.energy.harvested_mj + 1e-3);
    assert.ok(r.lap_s > BASE.lap_s, "less energy is slower");
  }
  const race = run(base, { recharge_limit_mj: 8.5 });
  assert.ok(race.energy.harvested_mj > 6.5 && race.energy.harvested_mj <= 8.5 + 1e-6);
  for (const strategy of ["optimal"]) { const r = run(base, undefined, { strategy }); assert.ok(r.energy.deployed_mj <= 4 + r.energy.harvested_mj + 1e-3 && r.energy.harvested_mj <= 6.5 + 1e-6); }
});

test("energy: more recharge allowance (up to the 6.5 MJ qualifying limit) is never slower", () => {
  let prev = Infinity;
  for (const h of [3, 4, 5, 6, 6.5, 8.5]) {
    const c = clone(base); c.pu.es_harvest_mj_per_lap = h; const r = run(c);
    assert.ok(r.lap_s <= prev + 1e-3, h + " MJ: " + r.lap_s + " after " + prev); prev = r.lap_s;
  }
});

test("exploits closed: Straight Mode cannot add load or drag; a stalled floor loses downforce", () => {
  // straight-mode coefficients above the corner-mode ones are capped at corner mode (wings only lower incidence)
  const up = clone(base); up.aero.straight.CLA_front_m2 = 9; up.aero.straight.CLA_rear_m2 = 9;
  const capped = clone(base); capped.aero.straight.CLA_front_m2 = base.aero.corner.CLA_front_m2; capped.aero.straight.CLA_rear_m2 = base.aero.corner.CLA_rear_m2;
  assert.equal(run(up).lap_s, run(capped).lap_s);
  const drag = clone(base); drag.aero.straight.CDA_m2 = 5; const dragCap = clone(base); dragCap.aero.straight.CDA_m2 = base.aero.corner.CDA_m2;
  assert.equal(run(drag).lap_s, run(dragCap).lap_s);
  // floor_stalled (read defensively: absent or false = not stalled)
  const st = clone(base); st.floor_stalled = true; st.stall_margin_mm = -2;
  assert.ok(run(st).lap_s > BASE.lap_s + 2, "stalled floor is much slower");
  const ok = clone(base); ok.floor_stalled = false; ok.stall_margin_mm = 3;
  assert.equal(run(ok).lap_s, BASE.lap_s);
  // ride_sens_per_mm is informational (CLA is already at the design ride height)
  const rs = clone(base); rs.aero.ride_sens_per_mm = -0.02; rs.aero.ride_height_mm = 50;
  assert.equal(run(rs).lap_s, BASE.lap_s);
});

test("energy: MGU-K speed taper follows FIA C5.2.8", () => {
  assert.equal(sim.mgukTaperKw(290), 350); assert.equal(sim.mgukTaperKw(300), 300); assert.equal(sim.mgukTaperKw(342), 60);
  assert.equal(sim.mgukTaperKw(345), 0); assert.equal(sim.mgukTaperKw(337.5, true), 350); assert.equal(sim.mgukTaperKw(355, true), 0);
});

test("2026 Straight Mode: the four FIA activation zones are used and the Hangar Straight runs in Straight Mode", () => {
  const tr = sim.buildTrack("silverstone");
  assert.deepEqual(tr.zones.map(z => z.name), ["A1", "A2", "A3", "A4"]);
  const k = BASE.trace.s_m.findIndex(s => s >= 4700);
  assert.equal(BASE.trace.aero_mode[k], "straight");
  assert.equal(BASE.trace.aero_mode[BASE.trace.s_m.findIndex(s => s >= 3160)], "corner", "Copse is Corner Mode");
});

test("geometry: corner radii are in a plausible band (OSM centreline smoothed; racing line inside the 15 m corridor)", () => {
  const rows = sim.cornerTable();
  const by = n => rows.find(r => r.name.startsWith(n));
  for (const n of ["The Loop", "Village", "Vale"]) assert.ok(by(n).r_line_m >= 10 && by(n).r_line_m <= 40, n + " " + by(n).r_line_m);
  for (const n of ["Copse", "Maggotts", "Becketts", "Abbey"]) assert.ok(by(n).r_line_m >= 80 && by(n).r_line_m <= 250, n + " " + by(n).r_line_m);
  for (const r of rows) assert.ok(r.apex_lat_g > 1.5 && r.apex_lat_g < 6, r.name + " " + r.apex_lat_g + " g");
});

test("sectors are timed on the FIA lines and land near the real pole-lap splits (28.292 / 35.521 / 24.242)", () => {
  const real = [28.292, 35.521, 24.242];
  BASE.sectors_s.forEach((s, i) => assert.ok(Math.abs(s - real[i]) < 0.8, "S" + (i + 1) + " " + s));
});

test("team fit: every team reported, residuals bounded, stored cars reproduce their stored laps", () => {
  const f = sim.fitted();
  assert.equal(f.teams.length, 11);
  for (const t of f.teams) {
    assert.ok(Math.abs(t.residual_lap_s) <= 1.0 && Math.abs(t.residual_trap_kmh) <= 7, t.team + " " + t.residual_lap_s + " / " + t.residual_trap_kmh);
    if (!t.at_bound.length) assert.ok(Math.abs(t.residual_lap_s) <= 0.1 && Math.abs(t.residual_trap_kmh) <= 1.5, t.team + " (free) " + t.residual_lap_s + " / " + t.residual_trap_kmh);
    for (const k of ["cla_scale", "cda_scale", "pu_scale"]) assert.ok(t[k] >= 0.69 && t[k] <= 1.26, t.team + " " + k);
    const r = run(sim.teamCar(t.team), f.conditions);
    assert.ok(Math.abs(r.lap_s - t.q_sim_s) < 0.002 && Math.abs(r.speed_trap_kmh - t.trap_sim_kmh) < 0.15, t.team + " re-sim " + r.lap_s + " vs " + t.q_sim_s);
    assert.match(sim.teamCar(t.team).label, /inferred from public/);
  }
  const mean = f.teams.reduce((a, t) => a + Math.abs(t.residual_lap_s), 0) / f.teams.length;
  assert.ok(mean < 0.25, "mean |lap residual| " + mean);
});

test("performance: one lap < 30 ms in Node after warm-up", () => {
  run(base);
  // best of 5 batches of 5 laps: npm test runs the test files in parallel, so a single batch also measures scheduler noise
  let ms = Infinity;
  for (let b = 0; b < 5; b++) { const t0 = process.hrtime.bigint(); for (let i = 0; i < 5; i++) run(base); ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6 / 5); }
  assert.ok(ms < 30, ms.toFixed(1) + " ms per lap");
});

test("weekend file parser: qualifying weather mid-range, dry, recharge limit", () => {
  const j = { sessions: [{ session: "Qualifying", weather: { air_temp_c: { min: 24.6, max: 25.8 }, track_temp_c: { min: 38.2, max: 42.6 }, air_pressure_mbar: { min: 1007.4, max: 1007.8 }, humidity_pct: { min: 46.2, max: 50.2 }, rainfall: "dry for the whole session" } }], energy_limits: { max_recharge_per_lap_MJ: { sprint_qualifying_and_qualifying: 6.5 } } };
  const c = sim.parseWeekend(j);
  assert.deepEqual(c, Object.assign({}, sim.DEFAULT_CONDITIONS), "the documented defaults are this file's qualifying values");
  assert.ok(Math.abs(sim.airDensity(c) - 1.170) < 0.002);
});

test("bad input fails loudly; no browser globals are defined in Node", () => {
  assert.throws(() => run({}), /car\./);
  assert.throws(() => run(base, undefined, { strategy: "magic" }), /strategy/);
  assert.throws(() => sim.simulateLap(base, {}), /trackId/);
  assert.equal(typeof globalThis.document, "undefined");
});

test("honesty: no forbidden claims in the sim code or SIM.md", () => {
  const files = fs.readdirSync(path.join(ROOT, "concept/sim")).filter(f => f.endsWith(".js")).map(f => path.join(ROOT, "concept/sim", f));
  files.push(path.join(ROOT, "docs/concept/SIM.md"));
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(s, /\bCFD\b|wind tunnel|\bvalidated\b|aerodynamically tested|100\s?% accurate/i, path.relative(ROOT, f));
  }
});
