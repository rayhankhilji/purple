// PURPLE concept lap sim, multi-track (docs/concept/SIM.md "Multi-track"): silverstone, monza, monaco, spa, hungaroring with the SAME
// physical cars; per circuit only a shared track grip, each team's wing level (aero-map trade-off curve) and a shared trap bias.
// node --test test/concept-sim-multitrack.test.js
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const sim = require("../concept/sim/index.js");
const S = require("../concept/sim/lapsim.js");
const MT = require("../concept/sim/multitrack.js");
const FT = require("../concept/sim/fitted-tracks.js");

const ROOT = path.join(__dirname, "..");
const FITTED = Object.keys(FT.tracks);
// documented tolerances (SIM.md "Multi-track"): every fitted team lap within 0.25 s of its target; the real pole within 0.25 s by
// the pole team's car; held-out speed RMS (track.compare vs each fitted driver, audit-FAIL laps excluded) under 20 km/h
const TOL = { lap_s: 0.25, pole_s: 0.25, heldout_rms_kmh: 20 };

test("Silverstone is unchanged: label, default conditions, no track grip, the pinned laps", () => {
  assert.equal(S.labelFor("silverstone"), S.LABEL);
  assert.equal(S.defaultConditions("silverstone"), S.DEFAULT_CONDITIONS);
  assert.equal(sim.trackGrip("silverstone"), 1);
  assert.equal(sim.simulateLap(sim.baselineCar(), "silverstone").lap_s, 88.1);
  assert.equal(sim.simulateLap(sim.baselineCar("redbull"), "silverstone").lap_s, 88.745);
  assert.equal(sim.baselineCar("redbull", "silverstone").id, sim.baselineCar("redbull").id);
  // a zero set-up is the car itself
  assert.deepEqual(sim.setupCar(sim.baselineCar("redbull"), { wing_deg: 0 }), sim.baselineCar("redbull"));
});

test("the five circuits build from their telemetry lines with a consistent timing frame", () => {
  assert.deepEqual(sim.CIRCUITS, ["silverstone", "monza", "monaco", "spa", "hungaroring"]);
  for (const id of sim.CIRCUITS) {
    const tr = sim.buildTrack(id), ti = tr.timing;
    assert.equal(tr.line, "telemetry", id);
    assert.ok(ti.sectors[0] > 0 && ti.sectors[0] < ti.sectors[1] && ti.sectors[1] < tr.L, id + " sector lines " + ti.sectors);
    assert.ok(ti.trap_s > 0 && ti.trap_s < tr.L, id + " trap");
    assert.ok(tr.zones.length >= 2, id + " Straight Mode zones");
    assert.ok(tr.corners.length >= 10, id + " corners");
    const ref = tr.reference; assert.ok(ref.ref_v_kmh.every(v => v > 30 && v < 360), id + " filled reference trace");
    if (id !== "silverstone") { assert.equal(tr.frame, "f1"); assert.ok(Math.abs(tr.L - ref.official_length_m) / ref.official_length_m < 0.03, id + " length " + tr.L); }
  }
});

test("per-event energy rules: the FIA qualifying recharge limit and ERS-K curve of each event", () => {
  const want = { monza: 5.0, monaco: 9.0, spa: 7.0, hungaroring: 9.0 };
  for (const id of Object.keys(want)) {
    const r = sim.simulateLap(sim.baselineCar("redbull", id), id);
    assert.equal(r.energy.recharge_cap_mj, want[id], id);
    assert.ok(r.energy.harvested_mj <= want[id] + 1e-9, id);
    assert.ok(r.label.indexOf(id) >= 0, r.label);
  }
  // Monaco's Rev 1 curve is below the Base-Overtake curve between 200 and 337 km/h; Base-Overtake is C5.2.8.ii
  const mon = S.eventTaper(S.PU_SECTORS.monaco), bo = S.eventTaper(S.PU_SECTORS.monza);
  assert.equal(mon(150), 350); assert.ok(mon(250) < bo(250)); assert.equal(bo(300), S.mgukTaperKw(300, true));
  // more recharge never makes a lap slower (Monza at 5 MJ vs 7 MJ)
  const rb = sim.baselineCar("redbull", "monza");
  assert.ok(sim.simulateLap(rb, "monza", { recharge_limit_mj: 7 }).lap_s <= sim.simulateLap(rb, "monza").lap_s + 0.01);
});

test("wing level: the aero map's trade-off curve, monotone in load and drag, balance held", () => {
  const C = sim.wingCurve();
  for (let i = 1; i < C.w.length; i++) { assert.ok(C.df[i] > C.df[i - 1] && C.cd[i] > C.cd[i - 1], "monotone at " + C.w[i]); }
  const car = sim.baselineCar("redbull"), lo = sim.setupCar(car, { wing_deg: -8 }), hi = sim.setupCar(car, { wing_deg: 8 });
  const bal = c => c.aero.corner.CLA_front_m2 / (c.aero.corner.CLA_front_m2 + c.aero.corner.CLA_rear_m2);
  assert.ok(Math.abs(bal(lo) - bal(car)) < 1e-12 && Math.abs(bal(hi) - bal(car)) < 1e-12);
  // physics untouched: mass, tyres, PU, gearing
  for (const k of ["mass_kg", "tyres", "pu", "gearing", "suspension", "brakes"]) assert.deepEqual(lo[k], car[k], k);
  // at Monza the low-wing car is faster at the trap and slower through the corners
  const a = sim.simulateLap(lo, "monza"), b = sim.simulateLap(hi, "monza");
  assert.ok(a.speed_trap_kmh > b.speed_trap_kmh + 5 && a.vmax_kmh > b.vmax_kmh);
  const mins = r => r.corners.reduce((p, c) => p + c.min_kmh, 0);
  assert.ok(mins(a) < mins(b));
});

for (const id of FITTED) {
  test(id + ": the fitted cars reproduce their stored laps; every team within " + TOL.lap_s + " s; the pole within " + TOL.pole_s + " s", () => {
    const T = FT.tracks[id];
    assert.ok(T.grip > 0.9 && T.grip < 1.15, "grip " + T.grip);
    for (const t of T.teams) {
      assert.ok(Math.abs(t.residual_lap_s) <= TOL.lap_s, t.team + " " + t.residual_lap_s);
      assert.ok(t.wing_deg >= sim.wingCurve().w[0] && t.wing_deg <= sim.wingCurve().w[sim.wingCurve().w.length - 1]);
    }
    const rb = T.teams.find(t => t.team === "redbull");
    assert.equal(rb.driver, MT.ourDriver(id));
    assert.equal(sim.simulateLap(sim.baselineCar("redbull", id), id).lap_s, rb.q_sim_s);
    // the pole: the pole team's car against the real pole lap
    const idx = MT.readIndex(id), pole = idx.telemetry_laps.slice().sort((a, b) => a.lap_time_s - b.lap_time_s)[0];
    const team = MT.TEAM_ID[pole.team], r = sim.simulateLap(sim.baselineCar(team, id), id);
    assert.ok(Math.abs(r.lap_s - pole.lap_time_s) <= TOL.pole_s, id + " pole " + pole.code + " " + pole.lap_time_s + " sim " + r.lap_s);
  });
  test(id + ": held-out (traces never fitted) stored and within the documented tolerance", () => {
    const h = FT.tracks[id].heldout.summary;
    assert.ok(h.laps_scored >= 7, "laps scored " + h.laps_scored);
    assert.ok(h.speed_rms_kmh < TOL.heldout_rms_kmh, "speed RMS " + h.speed_rms_kmh);
    for (const d of h.excluded_audit_fail) assert.ok(MT.auditFails(id)[d].overall === "FAIL");
  });
}

test("determinism: the same lap twice, byte for byte, on every circuit", () => {
  for (const id of sim.CIRCUITS) {
    const car = sim.baselineCar("redbull", id);
    assert.equal(JSON.stringify(sim.simulateLap(car, id, undefined, { trace: true })), JSON.stringify(sim.simulateLap(car, id, undefined, { trace: true })), id);
  }
});

test("performance: under 30 ms a lap after warm-up, mean over the five circuits (CPU time, best of 3 batches)", () => {
  const cars = {}; for (const id of sim.CIRCUITS) { cars[id] = sim.baselineCar("redbull", id); sim.simulateLap(cars[id], id); }
  let ms = Infinity;
  for (let b = 0; b < 3; b++) { const c0 = process.cpuUsage(); for (const id of sim.CIRCUITS) for (let i = 0; i < 3; i++) sim.simulateLap(cars[id], id); const c = process.cpuUsage(c0); ms = Math.min(ms, (c.user + c.system) / 1000 / (3 * sim.CIRCUITS.length)); }
  assert.ok(ms < 30, ms.toFixed(1) + " ms per lap");
});

test("driver-gaps-2026.json: real best laps per circuit, teammate gaps, our driver = the RB22 calibration driver", () => {
  const f = path.join(ROOT, "concept", "data", "driver-gaps-2026.json");
  if (!fs.existsSync(f)) return;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.equal(j.our_driver.default, "HAD"); assert.equal(j.our_driver.by_circuit.monza, "LAW");
  for (const id of sim.CIRCUITS) {
    const c = j.circuits[id]; assert.ok(c, id);
    const idx = MT.readIndex(id); assert.equal(Object.keys(c.drivers).length, idx.telemetry_laps.length, id);
    const rb = c.teams.redbull; assert.ok(rb && rb.drivers.length === 2, id);
    for (const t of Object.values(c.teams)) if (t.drivers.length === 2) assert.equal(+(t.drivers[1].lap_s - t.drivers[0].lap_s).toFixed(3), t.gap_s);
  }
});
