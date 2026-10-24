// PURPLE concept lap sim (concept/sim, docs/concept/SIM.md): determinism, physics sanity, energy budgets, estimation on the
// pole lap, held-out laps, team fit, timing, honesty. node --test test/concept-sim.test.js
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
const FIT = sim.fitted();
// minimum speed through the fast complex Copse..Chapel (trace frame: metres from the control line along the pole lap)
const fastMin = r => { let m = Infinity; r.trace.s_m.forEach((s, k) => { if (s > 3000 && s < 4200) m = Math.min(m, r.trace.v_kmh[k]); }); return m; };
const scaleAero = (car, key, f) => { const c = clone(car); for (const m of ["corner", "straight"]) { if (key === "CDA") c.aero[m].CDA_m2 *= f; else { c.aero[m].CLA_front_m2 *= f; c.aero[m].CLA_rear_m2 *= f; } } return c; };

test("contract: output shape, units and the label", () => {
  const r = BASE;
  for (const k of ["lap_s", "vmax_kmh", "speed_trap_kmh", "vmin_kmh"]) assert.ok(Number.isFinite(r[k]), k);
  assert.equal(r.sectors_s.length, 3);
  assert.ok(Math.abs(r.sectors_s.reduce((a, b) => a + b, 0) - r.lap_s) < 0.003, "sectors sum to the lap");
  assert.ok(Number.isFinite(r.energy.deployed_mj) && Number.isFinite(r.energy.harvested_mj));
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

test("baseline: estimated on the pole lap, no correction factor on top; lap within 0.3 s of 88.111 s", () => {
  assert.deepEqual(FIT.global, { grip_scale: 1, drag_scale: 1 });
  assert.deepEqual(sim.activeCal(), { grip_scale: 1, drag_scale: 1 });
  assert.equal(FIT.reference_driver, "ANT");
  assert.ok(Math.abs(BASE.lap_s - 88.111) <= 0.3, "lap " + BASE.lap_s);
  // the trap is not a fitted target; inside the prior ranges the sim's straights run fast (SIM.md §7, limitation 1)
  assert.ok(Math.abs(BASE.speed_trap_kmh - 302.6) <= 16, "trap " + BASE.speed_trap_kmh);
  // every estimated physical parameter sits inside its concept/data/priors-2026.json range (one model, one set of numbers)
  for (const r of F.priorTable(base)) assert.ok(r.inside, r.key + " " + r.value + " outside [" + r.lo + ", " + r.hi + "]");
  const a = base.aero;
  assert.ok(a.straight.CDA_m2 < a.corner.CDA_m2, "CDA");
  assert.equal(base.gearing.rpm_per_kmh.length, 8, "8 forward gears (C9.6.1)");
});

test("calibrate() reproduces the committed baseline estimate (fitted.js is current)", () => {
  const c = sim.calibrate({ conditions: FIT.conditions });
  assert.deepEqual(c.estimate.aero, FIT.baseline_estimate.aero);
  assert.deepEqual(c.estimate.tyres, FIT.baseline_estimate.tyres);
  assert.ok(c.fit_lap.trace_rms_kmh < 16, "fit-lap speed RMS " + c.fit_lap.trace_rms_kmh);
});

test("physics: more drag (CDA +10 %) -> lower top speed and trap, slower lap", () => {
  const r = run(scaleAero(base, "CDA", 1.1));
  assert.ok(r.vmax_kmh < BASE.vmax_kmh && r.speed_trap_kmh < BASE.speed_trap_kmh, r.vmax_kmh + " vs " + BASE.vmax_kmh);
  assert.ok(r.lap_s > BASE.lap_s + 0.2, r.lap_s + " vs " + BASE.lap_s);
});

test("physics: more downforce (CLA +10 %) -> higher minimum speed through Copse..Chapel and a faster lap", () => {
  const r = run(scaleAero(base, "CLA", 1.1), undefined, { trace: true });
  assert.ok(fastMin(r) > fastMin(BASE) + 2, fastMin(r) + " vs " + fastMin(BASE));
  assert.ok(r.lap_s < BASE.lap_s - 0.2);
});

test("physics: more mass -> slower; more power -> faster with a higher trap", () => {
  const heavy = clone(base); heavy.mass_kg += 20;
  assert.ok(run(heavy).lap_s > BASE.lap_s + 0.2);
  assert.ok(run(base, { fuel_kg: 40 }).lap_s > BASE.lap_s, "fuel load is mass");
  const strong = clone(base); strong.pu.ice_kw *= 1.1;
  const r = run(strong);
  // the threshold strategy holds a deploy plateau, so the trap moves less than the lap (SIM.md §3.4)
  assert.ok(r.lap_s < BASE.lap_s - 0.2 && r.speed_trap_kmh > BASE.speed_trap_kmh, JSON.stringify([r.lap_s, r.speed_trap_kmh]));
});

test("physics: smooth response (no jumps) to small parameter changes - the optimiser needs it", () => {
  let prev = null;
  for (let f = 0.99; f <= 1.0101; f += 0.0025) {
    const r = run(scaleAero(base, "CLA", f));
    if (prev) assert.ok(Math.abs(r.lap_s - prev.lap_s) < 0.035 && Math.abs(r.speed_trap_kmh - prev.speed_trap_kmh) < 5.5, f + ": " + prev.lap_s + "/" + prev.speed_trap_kmh + " -> " + r.lap_s + "/" + r.speed_trap_kmh);
    prev = r;
  }
});

test("physics: wet is slower; air density and headwind act through drag", () => {
  assert.ok(run(base, { wet: true }).lap_s > BASE.lap_s + 4);
  assert.ok(run(base, { air_density_kgm3: 1.05 }).speed_trap_kmh > run(base, { air_density_kgm3: 1.25 }).speed_trap_kmh);
  const tr = sim.buildTrack("silverstone"), h = tr.heading[tr.idxAtS(4600)];
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
  for (const strategy of ["marginal", "optimal"]) {
    const r = run(base, undefined, { strategy });
    assert.ok(r.energy.deployed_mj <= 4 + r.energy.harvested_mj + 1e-3 && r.energy.harvested_mj <= 6.5 + 1e-6, strategy);
  }
});

test("energy: more recharge allowance (up to the 6.5 MJ qualifying limit) is not slower by more than 0.02 s (SIM.md limitation 2)", () => {
  let prev = Infinity;
  for (const h of [3, 4, 5, 6, 6.5]) {
    const c = clone(base); c.pu.es_harvest_mj_per_lap = h; const r = run(c);
    assert.ok(r.lap_s <= prev + 0.02, h + " MJ: " + r.lap_s + " after " + prev); prev = r.lap_s;
  }
});

test("exploits closed: Straight Mode cannot add load or drag; a stalled floor loses downforce; the platform model acts physically", () => {
  const up = clone(base); up.aero.straight.CLA_front_m2 = 9; up.aero.straight.CLA_rear_m2 = 9;
  const capped = clone(base); capped.aero.straight.CLA_front_m2 = base.aero.corner.CLA_front_m2; capped.aero.straight.CLA_rear_m2 = base.aero.corner.CLA_rear_m2;
  assert.equal(run(up).lap_s, run(capped).lap_s);
  const drag = clone(base); drag.aero.straight.CDA_m2 = 5; const dragCap = clone(base); dragCap.aero.straight.CDA_m2 = base.aero.corner.CDA_m2;
  assert.equal(run(drag).lap_s, run(dragCap).lap_s);
  for (const where of ["top", "aero"]) {
    const st = clone(base); if (where === "top") st.floor_stalled = true; else st.aero.floor_stalled = true;
    assert.ok(run(st).lap_s > BASE.lap_s + 2, "stalled floor (" + where + ") is much slower");
  }
  const ok = clone(base); ok.aero.floor_stalled = false;
  assert.equal(run(ok).lap_s, BASE.lap_s, "floor_stalled false is the default");
  // ride-height aero: more ride sensitivity = more load as the car squats (faster); a negative value is read as 0 (no exploit)
  const rs = clone(base); rs.aero.ride_sens_per_mm = 0.012;
  assert.ok(run(rs).lap_s < BASE.lap_s, "more ride sensitivity is faster");
  const neg = clone(base); neg.aero.ride_sens_per_mm = -0.02; const zero = clone(base); zero.aero.ride_sens_per_mm = 0;
  assert.equal(run(neg).lap_s, run(zero).lap_s);
  // a smaller dynamic stall margin stalls the floor at a lower squat: slower at speed; a big margin is never worse than the default
  const low = clone(base); low.aero.stall_margin_mm = -4; const big = clone(base); big.aero.stall_margin_mm = 30;
  assert.ok(run(low).lap_s > BASE.lap_s + 0.01, "floor stalls under load: " + run(low).lap_s);
  assert.ok(run(big).lap_s <= BASE.lap_s + 1e-9);
  const pf = sim.platform(base);
  assert.ok(pf.squatAt(17000) > 3 && pf.squatAt(17000) < 7, "~5 mm squat at ~17 kN (concept/aeromap.js dyn compression)");
});

test("regulations: MGU-K speed taper follows FIA C5.2.8; gearing respects 8 gears and the shift rpm", () => {
  assert.equal(sim.mgukTaperKw(290), 350); assert.equal(sim.mgukTaperKw(300), 300); assert.equal(sim.mgukTaperKw(342), 60);
  assert.equal(sim.mgukTaperKw(345), 0); assert.equal(sim.mgukTaperKw(337.5, true), 350); assert.equal(sim.mgukTaperKw(355, true), 0);
  assert.ok(BASE.trace.gear.every(g => g >= 1 && g <= 8) && BASE.trace.rpm.every(n => n <= base.gearing.shift_rpm + 1));
});

test("2026 Straight Mode: the four FIA activation zones are used; Hangar Straight in Straight Mode, Copse in Corner Mode", () => {
  const tr = sim.buildTrack("silverstone");
  assert.deepEqual(tr.zones.map(z => z.name), ["A1", "A2", "A3", "A4"]);
  assert.equal(BASE.trace.aero_mode[BASE.trace.s_m.findIndex(s => s >= 4600)], "straight");
  assert.equal(BASE.trace.aero_mode[BASE.trace.s_m.findIndex(s => s >= 3090)], "corner");
});

test("fit lap vs the real pole trace: sectors, corner minima and speed RMS bounded (reported in SIM.md)", () => {
  const real = FIT.calibration.fit_lap.sectors_real_s;
  BASE.sectors_s.forEach((s, i) => assert.ok(Math.abs(s - real[i]) < 1.0, "S" + (i + 1) + " " + s + " vs " + real[i]));
  const rows = sim.cornerTable();
  assert.ok(rows.length >= 15);
  for (const r of rows) {
    assert.ok(r.r_line_m >= 15 && r.r_line_m <= 300, r.name + " radius " + r.r_line_m);
    assert.ok(Math.abs(r.diff_min_kmh) < 45, r.name + " min speed off by " + r.diff_min_kmh);
  }
  assert.ok(FIT.calibration.fit_lap.trace_rms_kmh < 16);
});

test("held-out laps (other teams' telemetry, not used beyond their lap time + trap): residuals reported and bounded", () => {
  const held = FIT.teams.filter(t => t.heldout && t.driver !== FIT.reference_driver);
  assert.ok(held.length >= 10, "10 held-out team laps");
  for (const t of held) {
    assert.ok(t.heldout.trace_rms_kmh < 20, t.team + " RMS " + t.heldout.trace_rms_kmh);
    t.heldout.sector_residuals_s.forEach((d, i) => assert.ok(Math.abs(d) < 1.0, t.team + " S" + (i + 1) + " " + d));
  }
});

test("team fit (lap time + trap per team): residuals bounded; stored cars reproduce their stored laps", () => {
  assert.equal(FIT.teams.length, 11);
  for (const t of FIT.teams) {
    assert.ok(Math.abs(t.residual_lap_s) <= 1.0 && Math.abs(t.residual_trap_kmh) <= 12, t.team + " " + t.residual_lap_s + " / " + t.residual_trap_kmh);
    if (!t.at_bound.length) assert.ok(Math.abs(t.residual_lap_s) <= 0.1 && Math.abs(t.residual_trap_kmh) <= 10, t.team + " (free) " + t.residual_lap_s + " / " + t.residual_trap_kmh);
    for (const r of F.priorTable(F.teamCar(t.team, FIT))) if (["CLA_corner", "CDA_corner", "CDA_straight", "ICE_crank_power"].includes(r.key)) assert.ok(r.inside, t.team + " " + r.key + " " + r.value);
    for (const k of ["cla_scale", "cda_scale", "pu_scale"]) assert.ok(t[k] >= 0.69 && t[k] <= 1.26, t.team + " " + k);
    const r = run(F.teamCar(t.team, FIT), FIT.conditions);
    assert.ok(Math.abs(r.lap_s - t.q_sim_s) < 0.003 && Math.abs(r.speed_trap_kmh - t.trap_sim_kmh) < 0.15, t.team + " re-sim " + r.lap_s + " vs " + t.q_sim_s);
    assert.match(sim.teamCar(t.team).label, /inferred from public/);
  }
});

test("demo team hook: baselineCar('redbull') is the inferred RB22 / DM01 car (dossier gearing when present)", () => {
  const rb = sim.baselineCar("redbull");
  assert.equal(rb.id, "team-redbull");
  if (fs.existsSync(path.join(ROOT, "concept/data/redbull-2026.json"))) assert.match(rb.gearing.source, /redbull-2026\.json/);
  const r = run(rb);
  assert.ok(Math.abs(r.lap_s - 88.746) < 0.1, "HAD's 88.746 s within 0.1 s: " + r.lap_s);
});

test("performance: one lap < 30 ms in Node after warm-up (CPU time, best of 5 batches)", () => {
  run(base);
  let ms = Infinity;
  for (let b = 0; b < 5; b++) { const c0 = process.cpuUsage(); for (let i = 0; i < 5; i++) run(base); const c = process.cpuUsage(c0); ms = Math.min(ms, (c.user + c.system) / 1000 / 5); }
  assert.ok(ms < 30, ms.toFixed(1) + " ms per lap");
});

test("weekend file parser: qualifying weather mid-range, dry, recharge limit", () => {
  const j = { sessions: [{ session: "Qualifying", weather: { air_temp_c: { min: 24.6, max: 25.8 }, track_temp_c: { min: 38.2, max: 42.6 }, air_pressure_mbar: { min: 1007.4, max: 1007.8 }, humidity_pct: { min: 46.2, max: 50.2 }, rainfall: "dry for the whole session" } }], energy_limits: { max_recharge_per_lap_MJ: { sprint_qualifying_and_qualifying: 6.5 } } };
  assert.deepEqual(sim.parseWeekend(j), Object.assign({}, sim.DEFAULT_CONDITIONS), "the documented defaults are this file's qualifying values");
  assert.ok(Math.abs(sim.airDensity(sim.parseWeekend(j)) - 1.170) < 0.002);
  const w = sim.loadWeekendConditions();
  if (w) { const { source, ...c } = w; assert.deepEqual(c, Object.assign({}, sim.DEFAULT_CONDITIONS)); }
});

test("bad input fails loudly; no browser globals are defined in Node", () => {
  assert.throws(() => run({}), /car\./);
  assert.throws(() => run(base, undefined, { strategy: "magic" }), /strategy/);
  assert.throws(() => sim.simulateLap(base, {}), /trackId/);
  assert.equal(typeof globalThis.document, "undefined");
});

test("honesty: no forbidden claims in the sim code or SIM.md", () => {
  const files = fs.readdirSync(path.join(ROOT, "concept/sim")).filter(f => f.endsWith(".js") && !f.startsWith("line-")).map(f => path.join(ROOT, "concept/sim", f));
  files.push(path.join(ROOT, "docs/concept/SIM.md"));
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(s, /\bCFD\b|wind tunnel|\bvalidated\b|aerodynamically tested|100\s?% accurate/i, path.relative(ROOT, f));
  }
});
