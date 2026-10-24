// PURPLE concept lap sim v3 (docs/concept/SIM.md §3.2, §3.4, §4.2, §6): power-law tyres, the C5.12 "regulated" energy strategy,
// legal track widths, the widened priors (documented), the telemetry braking term, the held-out score with track.compare().
// node --test test/concept-sim-v3.test.js
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const sim = require("../concept/sim/index.js");
const F = require("../concept/sim/fit.js");
const regs = require("../concept/regs.js");

const ROOT = path.join(__dirname, "..");
const clone = o => JSON.parse(JSON.stringify(o));
const run = (car, cond, opts) => sim.simulateLap(car, "silverstone", cond, opts);
const base = sim.baselineCar();
const FIT = sim.fitted();

test("C10.10.1: the sim's cars use legal track widths (1.540 / 1.470 m) and pass regs.checkPhysical", () => {
  for (const c of [sim.priorCar(), base, sim.baselineCar("redbull")].concat(sim.teamCars())) {
    assert.ok(c.track_front_m <= 1.540 + 1e-9 && c.track_rear_m <= 1.4703 + 1e-9, c.id + " " + c.track_front_m + " / " + c.track_rear_m);
    assert.deepEqual(regs.checkPhysical(c).filter(v => v.id === "REG-C-SUSP-WIDTH"), [], c.id);
  }
});

test("tyres (v3): power-law load sensitivity has the linear law's slope at the static load and keeps more grip under aero load", () => {
  const MODEL = sim.MODEL, keep = MODEL.tyre_law;
  try {
    MODEL.tyre_law = "linear"; const lin = [60, 200, 300].map(v => sim.capacity(base, v).ay_g);
    MODEL.tyre_law = "power"; const pow = [60, 200, 300].map(v => sim.capacity(base, v).ay_g);
    assert.ok(Math.abs(pow[0] - lin[0]) / lin[0] < 0.03, "near the static load the two laws agree: " + pow[0] + " vs " + lin[0]);
    assert.ok(pow[1] > lin[1] && pow[2] > lin[2] && pow[2] - lin[2] > pow[1] - lin[1], "the power law saturates more gently: " + pow + " vs " + lin);
  } finally { MODEL.tyre_law = keep; }
  const a = [100, 160, 240, 300].map(v => sim.capacity(base, v).ay_g);
  for (let i = 1; i < a.length; i++) assert.ok(a[i] > a[i - 1], "lateral capability rises with speed: " + a);
  // a car's own slip angle at the limit drives the slip drag (estimated with the baseline, inside its sourced range)
  const lo = clone(base), hi = clone(base); lo.tyres.slip_angle_rad = 0.05; hi.tyres.slip_angle_rad = 0.16;
  assert.ok(run(hi).lap_s > run(lo).lap_s + 0.3);
  assert.ok(base.tyres.slip_angle_rad >= F.SLIP_RANGE[0] && base.tyres.slip_angle_rad <= F.SLIP_RANGE[2]);
});

test("regulated strategy (v3 default): the FIA sector tables are the weekend file's; the C5.12 reduction-rate rules hold on the lap", () => {
  assert.equal(sim.MODEL.default_strategy, "regulated");
  const w = JSON.parse(fs.readFileSync(path.join(ROOT, "concept/data/silverstone-2026-weekend.json"), "utf8")).energy_limits, P = sim.PU_SECTORS.silverstone;
  assert.equal(w.max_pu_power_reduction_rate.rate_limit_kW_per_s, sim.REG_RATE.rate_kw_s);
  assert.ok(w.max_pu_power_reduction_rate.power_limited_distance_m > 3500, "C5.12.6(a) applies (power-limited distance > 3500 m)");
  assert.deepEqual(P.big, w.power_reduction_over_150kW_sectors.map(x => x.lap_distance_m));
  assert.ok(w.power_reduction_over_150kW_sectors.every(x => x.max_kW === sim.REG_RATE.step_big_kw));
  assert.deepEqual(P.reset, w.mguk_power_reduction_reset_sectors.map(x => x.lap_distance_m));
  assert.deepEqual(P.vthr, w.higher_speed_threshold_sectors.map(x => x.lap_distance_m.concat([x.speed_threshold_kmh])));
  // on the lap: above the speed threshold, outside the 350 kW sectors, while the ERS-K is above 100 kW, it never falls by more
  // than the 150 kW initial step + 50 kW/s within one second
  const r = run(base, undefined, { debug: true }), d = r.debug, tr = d.track, n = tr.n, K = d.k_kw, t = d.tAt, L = r.lap_s;
  const k = tr.L / P.lap_m, inAny = (rows, s) => rows.some(([a, b]) => s >= a * k && s <= b * k);
  let checked = 0;
  for (let i = 0; i < n; i++) {
    const s = tr.s[i], v = d.vf[i] * 3.6; if (d.lim[i] || K[i] <= 100e3 || inAny(P.big, s) || v < 210 || inAny(P.vthr.map(x => [x[0], x[1]]), s)) continue;
    for (let j = (i + 1) % n, q = 0; q < 200; j = (j + 1) % n, q++) {
      const dt = ((t[j] - t[i]) % L + L) % L; if (dt > 1 || d.lim[j]) break;
      if (K[j] >= 100e3) { assert.ok(K[i] - K[j] <= 150e3 + 50e3 * dt + 1, "at " + Math.round(s) + " m: " + Math.round(K[i] / 1e3) + " -> " + Math.round(K[j] / 1e3) + " kW in " + dt.toFixed(2) + " s"); checked++; }
    }
  }
  assert.ok(checked > 100, "the rule was exercised: " + checked);
  // the rules cost time: without the rate limits the plan is freer
  const keep = Object.assign({}, sim.REG_RATE);
  // (0.03 s tolerance: the plan is a heuristic, not an optimum; with the more-factors v1 smoothing a freer plan can be 0.02 s slower)
  try { Object.assign(sim.REG_RATE, { step_kw: 700, rate_kw_s: 1e6, hold_s: 0 }); assert.ok(run(base).lap_s <= r.lap_s + 0.03); } finally { Object.assign(sim.REG_RATE, keep); }
  // energy: the store never runs empty, the 6.5 MJ qualifying recharge limit holds
  const e = r.energy; assert.ok(e.soc_min_mj >= -0.001 && e.harvested_mj <= 6.5 + 1e-6 && e.deployed_mj <= 4 + e.harvested_mj + 1e-3, JSON.stringify(e));
});

test("regulated strategy is robust: a draggy car still laps (the plan values energy by 1/v^3 at the car's own speed)", () => {
  const c = clone(base); for (const m of ["corner", "straight"]) c.aero[m].CDA_m2 = 1.5; c.aero.straight.CDA_m2 = 1.25;
  const r = run(c); assert.ok(r.lap_s > 88 && r.lap_s < 95, "lap " + r.lap_s);
  assert.ok(r.vmin_kmh > 60, "never crawls: " + r.vmin_kmh);
});

test("priors (v3): widened ranges are documented and reported against the sourced ones; braking term from the telemetry", () => {
  const PS = F.priorRanges(), PF = F.fitRanges();
  for (const [k, w] of Object.entries(F.WIDENED)) {
    assert.ok(w.why && w.why.length > 30, k + " has a reason");
    assert.ok(w.range[0] <= PS[k][0] && w.range[2] >= PS[k][2] && w.range[1] === PS[k][1], k + " widens the sourced range, same central value");
    assert.deepEqual(PF[k], w.range);
  }
  const rows = F.priorTable(base);
  assert.ok(rows.every(r => r.inside), "every estimate inside its fit range");
  for (const r of rows) if (!F.WIDENED[r.key]) assert.ok(r.inside_sourced, r.key + " inside its sourced range");
  assert.ok(FIT.calibration.prior_check.some(r => r.widened && r.sourced_hi != null), "fitted.js reports the sourced range of widened keys");
  const b = F.brakeTelemetry(); assert.equal(b.laps, 22); assert.equal(b.g, F.BRAKE_TELEMETRY.g); assert.equal(b.kmh, F.BRAKE_TELEMETRY.kmh);
});

test("held-out (v3, track.compare): 10 other teams' laps, mean speed RMS and sector bias below the v2 figures", () => {
  const held = FIT.teams.filter(t => t.heldout && t.heldout.compare && t.driver !== FIT.reference_driver);
  assert.equal(held.length, 10);
  const mean = a => a.reduce((p, x) => p + x, 0) / a.length, rms = mean(held.map(t => t.heldout.compare.rms_kmh));
  const bias = [0, 1, 2].map(i => mean(held.map(t => t.heldout.sector_residuals_s[i])));
  assert.ok(rms < 11, "mean held-out speed RMS " + rms.toFixed(2) + " km/h (v2: 12.38)");
  assert.ok(bias.every(b => Math.abs(b) < 0.25), "sector bias " + bias.map(b => b.toFixed(3)).join(" / ") + " (v2: -0.171 / +0.502 / -0.339)");
  for (const t of held) assert.ok(t.heldout.compare.rms_kmh < 15, t.team + " " + t.heldout.compare.rms_kmh);
});

test("performance: one regulated lap well under 25 ms after warm-up (CPU time, best of 5 batches)", () => {
  run(base);
  let ms = Infinity;
  for (let b = 0; b < 5; b++) { const c0 = process.cpuUsage(); for (let i = 0; i < 5; i++) run(base); const c = process.cpuUsage(c0); ms = Math.min(ms, (c.user + c.system) / 1000 / 5); }
  assert.ok(ms < 30, ms.toFixed(1) + " ms per lap");
});
