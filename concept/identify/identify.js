#!/usr/bin/env node
// PURPLE CONCEPT - identify: joint 9-circuit identification of the 11 2026 cars (docs/concept/IDENTIFY.md).
// Estimates from public timing telemetry (OpenF1). Not team data.
//
//   node concept/identify/identify.js                 # fit + bootstrap + leave-one-circuit-out, print a summary
//   node concept/identify/identify.js --write         # ... and write concept/data/cars-2026-identified.json + docs/concept/identify/*.svg
//   options: --boot N (default 200)  --seed S (default 2026)  --circuits a,b,c  --no-loco  --no-sim-compat  --date YYYY-MM-DD  --md
//
// Deterministic for a given seed and inputs (the JSON's runtime_s and date are the only fields that vary run to run).
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const D = require("./data.js");
const M = require("./model.js");
const Q = require("./qss.js");
const { G0, mean, sd, quantile, rnd } = D;

const OUT_JSON = path.join(D.ROOT, "concept", "data", "cars-2026-identified.json");
const OUT_DIR = path.join(D.ROOT, "docs", "concept", "identify");
const LABEL = "estimates from public timing telemetry (OpenF1) · joint 9-circuit point-mass identification · effective parameters, not team data";
const RHO_REF = 1.18; // reference air density for the derived grip numbers (kg/m³)

// ================================================================ helpers
const sha256 = f => { try { return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } catch (e) { return null; } };
function corr(a, b) { const ma = mean(a), mb = mean(b); let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null; }
function stat(central, xs, d) {
  d = d == null ? 4 : d; const ok = xs.filter(x => x != null && isFinite(x));
  if (!ok.length) return { central: rnd(central, d), mean: null, sd: null, p05: null, p95: null };
  return { central: rnd(central, d), mean: rnd(mean(ok), d), sd: rnd(ok.length > 1 ? sd(ok) : 0, d), p05: rnd(quantile(ok, 0.05), d), p95: rnd(quantile(ok, 0.95), d) };
}
const ayAt = (p, kmh, rho) => M.ayModel(p, kmh / 3.6, rho) / G0;

// car-level numbers from θ (reference circuit: γ = 1, mean trim w = d = 0, ρ = RHO_REF)
function carNumbers(th, lay, k, A) {
  const c = lay.car[k], mass = th[c.m] * 100, m = mass + A.fuel_kg;
  const p = { muY: Math.exp(th[c.muY]), muX: Math.exp(th[c.muX]), ClA: Math.exp(th[c.clA]), CdA_c: Math.exp(th[c.cdA]), P: th[c.P] * 100, m, ls: th[lay.ls], A };
  return {
    mu_y: p.muY, mu_x: p.muX, ClA_m2: p.ClA, CdA_m2: p.CdA_c, CdA_straight_m2: p.CdA_c * th[lay.rs], P_ice_kw: p.P, mass_kg: mass,
    ay_100kmh_g: ayAt(p, 100, RHO_REF), ay_200kmh_g: ayAt(p, 200, RHO_REF), ay_250kmh_g: ayAt(p, 250, RHO_REF),
    muy_ClA_over_m: (p.muY * p.ClA) / m, ClA_over_CdA: p.ClA / p.CdA_c, P_over_CdA_kw_m2: p.P / p.CdA_c,
  };
}
function circuitNumbers(th, lay, k, j, A, rho) {
  const p = M.carAt(th, lay, k, j, A);
  return { w: th[lay.w[k][j]], d: th[lay.d[k][j]], ClA_m2: p.ClA, CdA_m2: p.CdA_c, ay_100kmh_g: ayAt(p, 100, rho), ay_200kmh_g: ayAt(p, 200, rho) };
}

// ================================================================ evaluation at one circuit (in-sample or held out)
function evaluate(feat, lay, th, A, cid, opts) {
  opts = opts || {};
  const j = lay.circuits.indexOf(cid), laps = feat.laps.filter(l => l.cid === cid), rows = [];
  const cr = [], br = [], an = [], dts = [], srms = [];
  for (const lap of laps) {
    const p = M.carAt(th, lay, lap.k, j, A);
    for (const q of lap.corners) cr.push((M.ayModel(p, q.v, lap.rho) - q.ay) / G0);
    for (const z of lap.brakes) { const vm = M.brakeSim(p, z, lap.rho); for (let t = 1; t < vm.length; t++) br.push((vm[t] - z.vobs[t]) * 3.6); }
    const wins = opts.reselect ? M.selectWindows(lap, p) : lap.windows;
    let anchor = null;
    if (wins && wins.length >= 2) { anchor = M.anchorValue(p, Object.assign({}, lap, { windows: wins })); an.push(anchor - M.FIXED.anchor_kw); }
    const row = { driver: lap.code, team: lap.team, anchor_kw: rnd(anchor, 1) };
    if (lap.L.policy.null_margin_m === 0) { // lap-time check only on laps without a > 200 m dropout (the path in the gap is not measured)
      const c = Q.compare(lap.L, Q.simulate(lap.L, p, { recharge_mj: D.CIRCUITS[cid].recharge_q_mj }));
      if (c.delta_s != null) { dts.push(c.delta_s); srms.push(c.speed_rms_kmh); }
      Object.assign(row, { lap_real_s: c.lap_time_real_s, lap_sim_s: rnd(c.lap_time_sim_s, 3), delta_s: rnd(c.delta_s, 3), speed_rms_kmh: rnd(c.speed_rms_kmh, 1) });
    }
    rows.push(row);
  }
  const rms = a => (a.length ? Math.sqrt(mean(a.map(x => x * x))) : null);
  return {
    n_laps: laps.length, n_lap_time_checked: dts.length,
    corner_rms_g: rnd(rms(cr), 3), corner_bias_g: rnd(cr.length ? mean(cr) : null, 3), brake_rms_kmh: rnd(rms(br), 2),
    anchor_mean_err_kw: rnd(an.length ? mean(an) : null, 1), anchor_rms_err_kw: rnd(rms(an), 1),
    lap_time_mean_err_s: rnd(dts.length ? mean(dts) : null, 3), lap_time_mae_s: rnd(dts.length ? mean(dts.map(Math.abs)) : null, 3), speed_rms_kmh: rnd(srms.length ? mean(srms) : null, 1),
    laps: opts.perLap ? rows : undefined,
  };
}

// ================================================================ the run (pure: returns the output object)
function run(opts) {
  opts = Object.assign({ circuits: D.CIRCUIT_IDS, boot: 200, seed: 2026, loco: true, simCompat: true, date: new Date().toISOString().slice(0, 10), log: () => {} }, opts || {});
  const t0 = Date.now(), circuits = opts.circuits, log = opts.log;
  const feat = M.buildFeatures(circuits);
  log(`features: ${feat.laps.length} laps used, ${feat.excluded.length} excluded`);
  const central = M.fitCentral(feat, circuits), lay = central.lay, A = central.A, th = central.th;
  log(`central fit: cost ${central.cost.toFixed(1)}, ${central.iterations} iterations, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const savedWindows = feat.laps.map(l => l.windows);
  const boots = M.bootstrap(feat, central, opts.boot, opts.seed, (b, n) => { if (b % 10 === 0 || b === n) log(`bootstrap ${b}/${n}`); });
  // ---------------------------------------------------------------- cars
  const cars = {};
  D.TEAMS.forEach((t, k) => {
    const cn = carNumbers(th, lay, k, A), bn = boots.map(b => carNumbers(b.th, lay, k, b.A));
    const params = {}; for (const key of Object.keys(cn)) params[key] = stat(cn[key], bn.map(x => x[key]));
    const c = lay.car[k];
    const correlations = {
      ln_mu_y__ln_ClA: rnd(corr(boots.map(b => b.th[c.muY]), boots.map(b => b.th[c.clA])), 3),
      P__ln_CdA: rnd(corr(boots.map(b => b.th[c.P]), boots.map(b => b.th[c.cdA])), 3),
      ln_mu_x__ln_ClA: rnd(corr(boots.map(b => b.th[c.muX]), boots.map(b => b.th[c.clA])), 3),
    };
    // identifiability: bootstrap spread against prior spread (prior centres are re-drawn in every replicate)
    const P = M.PRIOR, share = (vals, priorSd) => { const s = sd(vals); return { sd_over_prior_sd: rnd(s / priorSd, 3), data_share: rnd(Math.max(0, 1 - (s / priorSd) ** 2), 3) }; };
    const identifiability = {
      mu_y: share(boots.map(b => b.th[c.muY]), P.mu_y.sd), mu_x: share(boots.map(b => b.th[c.muX]), P.mu_x.sd), ClA_m2: share(boots.map(b => b.th[c.clA]), P.ClA.sd),
      CdA_m2: share(boots.map(b => b.th[c.cdA]), P.CdA.sd), P_ice_kw: share(boots.map(b => b.th[c.P] * 100), P.P_kw.sd), mass_kg: share(boots.map(b => b.th[c.m] * 100), P.mass.sd),
    };
    const bands = { mu_y: P.mu_y, mu_x: P.mu_x, ClA_m2: P.ClA, CdA_m2: P.CdA, P_ice_kw: P.P_kw, mass_kg: P.mass };
    const flags = [];
    const prior_check = {};
    for (const [key, b] of Object.entries(bands)) {
      const v = params[key].mean, inBand = v >= b.lo && v <= b.hi;
      prior_check[key] = { band: [b.lo, b.hi], source: b.source, in_band: inBand };
      if (!inBand) flags.push(`${key} ${rnd(v, 3)} outside the sourced band ${b.lo}-${b.hi} (${b.source}); effective value of this model, see IDENTIFY.md "Scale"`);
      if (identifiability[key].sd_over_prior_sd > 0.8) flags.push(`${key}: prior-dominated (bootstrap sd ${identifiability[key].sd_over_prior_sd} × prior sd)`);
    }
    const trims = {};
    lay.circuits.forEach((cid, j) => {
      const rho = mean(feat.laps.filter(l => l.cid === cid).map(l => l.rho)) || RHO_REF;
      const cc = circuitNumbers(th, lay, k, j, A, rho), bc = boots.map(b => circuitNumbers(b.th, lay, k, j, b.A, rho));
      trims[cid] = Object.fromEntries(Object.keys(cc).map(key => [key, stat(cc[key], bc.map(x => x[key]))]));
    });
    cars[t.id] = { name: t.name, power_unit: D.PU_NAMES[t.pu], pu_family: t.pu, mass_prior_kg: rnd(M.massPrior(t), 1), mass_reported: t.overweight_reported || null,
      params, correlations, identifiability, prior_check, flags, trims };
  });
  // ---------------------------------------------------------------- circuits and globals
  const circuitsOut = {};
  lay.circuits.forEach((cid, j) => {
    const g = boots.map(b => Math.exp(b.th[lay.g[j]])), wm = boots.map(b => mean(lay.w.map(ws => b.th[ws[j]]))), dm = boots.map(b => mean(lay.d.map(ds => b.th[ds[j]])));
    const corrGW = corr(boots.map(b => b.th[lay.g[j]]), wm);
    circuitsOut[cid] = { name: D.CIRCUITS[cid].name, type: D.CIRCUITS[cid].type, recharge_q_mj: D.CIRCUITS[cid].recharge_q_mj, recharge_basis: D.CIRCUITS[cid].recharge_basis,
      grip_factor_gamma: stat(Math.exp(th[lay.g[j]]), g), field_mean_downforce_trim_w: stat(mean(lay.w.map(ws => th[ws[j]])), wm), field_mean_drag_trim_d: stat(mean(lay.d.map(ds => th[ds[j]])), dm),
      corr_gamma_w: rnd(corrGW, 3), fit_quality: evaluate(feat, lay, th, A, cid, { perLap: true }) };
  });
  const slope = M.trimSlope(th, lay), slopes = boots.map(b => M.trimSlope(b.th, lay).beta);
  const globals = {
    load_sensitivity: stat(th[lay.ls], boots.map(b => b.th[lay.ls])), straight_over_corner_CdA: stat(th[lay.rs], boots.map(b => b.th[lay.rs])),
    drag_vs_downforce_trim_slope: Object.assign(stat(slope.beta, slopes), { r2: rnd(slope.r2, 3), note: "least squares d = β·w over every (car, circuit); a diagnostic, not a fitted parameter" }),
  };
  // ---------------------------------------------------------------- leave-one-circuit-out
  let loco = null;
  if (opts.loco && circuits.length > 2) {
    loco = {};
    for (const cid of circuits) {
      const tl = Date.now(), train = circuits.filter(c => c !== cid);
      const tf = M.fitCentral(feat, train), ho = M.holdOut(feat, tf, cid);
      const shift = key => mean(D.TEAMS.map((t, k) => Math.abs(tf.th[tf.lay.car[k][key]] - th[lay.car[k][key]])));
      loco[cid] = {
        trained_on: train,
        held_out_refit: Object.assign({ how: "shared car parameters from the other circuits; this circuit's grip γ and every car's downforce trim w fitted to its corners only; drag trim predicted d = β·w (β from the training circuits)" }, evaluate(feat, ho.lay, ho.th, A, cid, { reselect: true })),
        held_out_no_refit: Object.assign({ how: "shared car parameters only: γ = 1, w = d = 0 (each car at its mean trim)" }, evaluate(feat, ho.lay, ho.noRefit, A, cid, { reselect: true })),
        in_sample: (({ laps, ...r }) => r)(circuitsOut[cid].fit_quality),
        held_out_gamma: rnd(Math.exp(ho.th[ho.lay.g[ho.j]]), 3), training_trim_slope_beta: rnd(ho.slope.beta, 3),
        shared_parameter_shift: { mean_abs_dln_mu_y: rnd(shift("muY"), 4), mean_abs_dln_ClA: rnd(shift("clA"), 4), mean_abs_dln_CdA: rnd(shift("cdA"), 4), mean_abs_dP_kw: rnd(shift("P") * 100, 2) },
      };
      log(`loco ${cid}: ${((Date.now() - tl) / 1000).toFixed(1)} s, lap MAE held-out ${loco[cid].held_out_refit.lap_time_mae_s} s (in-sample ${loco[cid].in_sample.lap_time_mae_s} s)`);
    }
    feat.laps.forEach((l, i) => { l.windows = savedWindows[i]; });
  }
  // ---------------------------------------------------------------- concept/sim compatibility (Silverstone; optional, the sim is a library here)
  const simCompat = opts.simCompat && circuits.includes("silverstone") ? simCompatibility(feat, central) : null;
  // ---------------------------------------------------------------- provenance
  const used = feat.laps.map(l => ({ circuit: l.cid, driver: l.code, team: l.team, file: l.file, audit: l.audit, actions: l.actions,
    n_corners: l.corners.length, n_brake_zones: l.brakes.length, n_anchor_windows: l.windows ? l.windows.length : 0, frozen_points_masked: l.L.masked.frozen_points, lap_time_checked: l.L.policy.null_margin_m === 0 }));
  const out = {
    _meta: {
      what: "Joint identification of the 11 2026 F1 cars over 9 circuits' qualifying laps: per-car tyre friction, aero, ICE power and mass; per-circuit wing level (downforce and drag trim) and grip.",
      label: LABEL, generated: opts.date, tool: "node concept/identify/identify.js --write", doc: "docs/concept/IDENTIFY.md",
      seed: opts.seed, n_bootstrap: opts.boot, runtime_s: rnd((Date.now() - t0) / 1000, 1), node: process.version,
      data: "OpenF1 (openf1.org) qualifying laps, concept/data/telemetry/ (an independent community feed, not associated with Formula 1, the FIA or FOM)",
      inputs_sha256: { telemetry_audit_csv: sha256(path.join(D.TEL, "audit", "telemetry_audit.csv")), priors_2026_json: sha256(path.join(D.ROOT, "concept", "data", "priors-2026.json")), grid_2026_json: sha256(path.join(D.ROOT, "concept", "data", "grid-2026.json")) },
    },
    scale: {
      kind: "effective parameters of the point-mass model in concept/identify/model.js, not physical measurements",
      notes: [
        "mu_y, mu_x: effective friction at the reference load (μ(N) = μ·(1 − ls·(N/mg − 1))). Lateral g is measured as v_min²·max|κ| on x/y smoothed over max(6 m, 0.3 s·v); that estimator reads higher than an x/y-acceleration estimate (docs/concept/TRACK.md), so mu_y sits above tyre-test values. Compare cars with each other, not with a tyre table.",
        "ClA_m2 trades against load_sensitivity and mu_y (the a_y(v) curve is what the corners measure). ay_100kmh_g / ay_200kmh_g / ay_250kmh_g and muy_ClA_over_m are the identifiable combinations.",
        "CdA_m2 is conditional on the deployment anchor (top-3 straights reach the 350 kW MGU-K cap, C5.2.7) and on P_ice_kw. ICE power and drag are not separable from speed traces (P__ln_CdA correlation); P_ice_kw is prior-dominated. A circuit where the cap is not reached on the best exits (energy-limited) or where the anchor straights climb shows up as a higher drag trim there.",
        "mass_kg is prior-dominated (726 kg + Nominal Tyre Mass + reported excess).",
        "Reference conditions for car-level grip numbers: γ = 1 (mean of the 9 circuits), mean trim, ρ = 1.18 kg/m³.",
      ],
      concept_sim_compatibility: "Same tyre form as concept/sim/lapsim.js (μ0(1 + ls − ls·Fz/Fz0) per tyre equals this model per car when aero balance equals weight distribution; concept/sim adds lateral load transfer). Same units (m², kW, kg). NOT the same scale for ClA and μ: concept/sim measures curvature on its own averaged racing line and fits on one lap, so values do not transfer one to one; see sim_compat for the Silverstone check of these cars inside concept/sim.",
    },
    assumptions: Object.fromEntries(Object.entries(M.ASSUMPTIONS).map(([k, a]) => [k, a])),
    fixed: M.FIXED,
    priors: Object.fromEntries(Object.entries(M.PRIOR).map(([k, p]) => [k, (({ log, mu, sd: s, lo, central: c, hi, source, note }) => ({ log, mu: rnd(mu, 4), sd: rnd(s, 4), lo, central: c, hi, source, note }))(p)])),
    method: {
      summary: "Robust (Huber) maximum a posteriori fit of corner lateral g, brake-zone speed traces and a per-lap MGU-K deployment anchor over every usable qualifying lap of 9 circuits, all cars at once; uncertainty from a bootstrap over laps (within each car-circuit cell) and over corners / brake zones / straights within laps, with prior centres and assumptions re-drawn in each replicate; validation by leave-one-circuit-out and a QSS lap simulation on each lap's own path.",
      observations: { corners: "grip-limited corner minima: a_y = v_min²·max|κ| within ±40 m", brakes: "speed-vs-distance through each brake zone (onset + 0.25 s to 70 % of the drop)", anchor: "mean of the top-3 per-straight 25 m windows (180-290 km/h) of implied MGU-K DC power = 350 kW" },
      exclusion_policy: [
        "C1, C2, C5, C6 FAIL: lap excluded",
        "C3 FAIL raw brake 104: brake channel excluded (no brake zones)",
        "C3 FAIL null run > 200 m: the stretch ±100 m excluded from every feature; lap left out of the lap-time check",
        "C3 FAIL other channel range: lap excluded",
        "C4 FAIL > 10 longitudinal accel violations: longitudinal channel excluded (no anchor, no brake zones)",
        "C4 FAIL >= 5 speed jumps: lap excluded",
        "every lap: frozen speed feed (same speed, throttle, rpm for >= 1 s above 50 km/h) masked",
      ],
    },
    provenance: { laps_used: used, laps_excluded: feat.excluded, n_used: used.length, n_excluded: feat.excluded.length },
    global: globals,
    cars, circuits: circuitsOut, loco, sim_compat: simCompat,
  };
  out._meta.runtime_s = rnd((Date.now() - t0) / 1000, 1);
  return out;
}

// ================================================================ concept/sim compatibility check: each car at its Silverstone trim inside the bench sim
function physicalCar(teamId, p, rs) {
  const FX = M.FIXED;
  return {
    id: `${teamId}-identified`, label: `${teamId}: identified effective parameters (concept/identify), Silverstone trim`,
    mass_kg: p.mass, fuel_kg: p.A.fuel_kg, wheelbase_m: 3.4, track_front_m: 1.6, track_rear_m: 1.55, cog_height_m: FX.cog_height_m, weight_dist_front: FX.weight_front,
    aero: { corner: { CLA_front_m2: p.ClA * FX.aero_balance_front, CLA_rear_m2: p.ClA * (1 - FX.aero_balance_front), CDA_m2: p.CdA_c },
      straight: { CLA_front_m2: p.ClA * FX.cla_straight_ratio * FX.aero_balance_front, CLA_rear_m2: p.ClA * FX.cla_straight_ratio * (1 - FX.aero_balance_front), CDA_m2: p.CdA_c * rs },
      ride_height_mm: 35, ride_sens_per_mm: 0.006 },
    pu: { ice_kw: p.P, mguk_kw: 350, es_deploy_mj_per_lap: 12.5, es_harvest_mj_per_lap: 8.5 },
    tyres: { mu_x: p.muX, mu_y: p.muY, load_sens: p.ls, radius_m: p.A.r_eff_m, compound: "soft" },
    brakes: { max_decel_g_mech: 6.5 }, drivetrain_eff: p.A.eta_dt,
  };
}
function simCompatibility(feat, central) {
  try {
    const sim = require("../sim/index.js"), lay = central.lay, j = lay.circuits.indexOf("silverstone");
    const rows = D.TEAMS.map((t, k) => {
      const p = M.carAt(central.th, lay, k, j, central.A), car = physicalCar(t.id, p, central.th[lay.rs]);
      const best = feat.laps.filter(l => l.cid === "silverstone" && l.team === t.id).sort((a, b) => a.lap_time_s - b.lap_time_s)[0];
      let simLap = null, err = null; try { simLap = sim.simulateLap(car, "silverstone").lap_s; } catch (e) { err = String(e.message || e); }
      const qss = best ? Q.simulate(best.L, p, { recharge_mj: 6.5 }).lap_time_s : null;
      return { team: t.id, real_best_s: best ? best.lap_time_s : null, concept_sim_lap_s: rnd(simLap, 3), concept_sim_delta_s: best && simLap ? rnd(simLap - best.lap_time_s, 3) : null, identify_qss_lap_s: rnd(qss, 3), error: err };
    });
    const d = rows.map(r => r.concept_sim_delta_s).filter(x => x != null);
    return { how: "each car's Silverstone-trim parameters as a PhysicalCar (aero balance 0.435, Straight Mode ClA × 0.72) run through concept/sim simulateLap(car, 'silverstone') with its default conditions", rows,
      mean_delta_s: rnd(d.length ? mean(d) : null, 3), mean_abs_delta_s: rnd(d.length ? mean(d.map(Math.abs)) : null, 3),
      verdict: d.length ? (Math.abs(mean(d)) < 1.5 ? "usable in concept/sim with a lap-time offset of this size" : "not on concept/sim's scale: use concept/sim's own fitted cars, or re-estimate inside concept/sim") : "concept/sim not runnable here" };
  } catch (e) { return { error: String(e.message || e) }; }
}

// ================================================================ plots (static SVG for the doc; light and dark via prefers-color-scheme)
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function dotPlot({ title, subtitle, rows, series, xlab, zero }) {
  const W = 720, rowH = 26, top = 70, left = 150, right = 30, H = top + rows.length * rowH + 50;
  const vals = rows.flatMap(r => r.points.flatMap(p => [p.lo, p.hi, p.v])).filter(x => x != null && isFinite(x));
  let lo = Math.min(...vals, zero ? 0 : Infinity), hi = Math.max(...vals, zero ? 0 : -Infinity); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const X = v => left + ((v - lo) / (hi - lo)) * (W - left - right);
  const step = (() => { const r = (hi - lo) / 6, p = 10 ** Math.floor(Math.log10(r)), f = r / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; })();
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`,
    `<style>.bg{fill:#fcfcfb}.t1{fill:#0b0b0b}.t2{fill:#52514e}.grid{stroke:#e4e3df}.zero{stroke:#8a8984}.s0{fill:#2a78d6;stroke:#2a78d6}.s1{fill:#eb6834;stroke:#eb6834}.ring{stroke:#fcfcfb}
@media (prefers-color-scheme: dark){.bg{fill:#1a1a19}.t1{fill:#f0efec}.t2{fill:#c3c2b7}.grid{stroke:#383835}.zero{stroke:#8a8984}.s0{fill:#3987e5;stroke:#3987e5}.s1{fill:#d95926;stroke:#d95926}.ring{stroke:#1a1a19}}</style>`,
    `<rect class="bg" width="${W}" height="${H}"/>`, `<text class="t1" x="16" y="24" font-size="15" font-weight="600">${esc(title)}</text>`, `<text class="t2" x="16" y="42">${esc(subtitle || "")}</text>`];
  series.forEach((s, i) => { const x = left + i * 200; o.push(`<circle class="s${i} ring" cx="${x + 6}" cy="58" r="5" stroke-width="2"/><text class="t2" x="${x + 16}" y="62">${esc(s)}</text>`); });
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const x = X(v); o.push(`<line class="grid" x1="${x}" x2="${x}" y1="${top - 4}" y2="${top + rows.length * rowH}"/><text class="t2" x="${x}" y="${top + rows.length * rowH + 16}" text-anchor="middle">${rnd(v, 3)}</text>`); }
  if (zero) o.push(`<line class="zero" x1="${X(0)}" x2="${X(0)}" y1="${top - 4}" y2="${top + rows.length * rowH}" stroke-width="1.5"/>`);
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2; o.push(`<text class="t1" x="${left - 10}" y="${y + 4}" text-anchor="end">${esc(r.label)}</text>`);
    r.points.forEach((p, s) => {
      if (p.v == null || !isFinite(p.v)) return; const dy = (s - (r.points.length - 1) / 2) * 7;
      if (p.lo != null && p.hi != null) o.push(`<line class="s${s}" x1="${X(p.lo)}" x2="${X(p.hi)}" y1="${y + dy}" y2="${y + dy}" stroke-width="2"/>`);
      o.push(`<circle class="s${s} ring" cx="${X(p.v)}" cy="${y + dy}" r="4.5" stroke-width="2"><title>${esc(r.label)} · ${esc(series[s])}: ${rnd(p.v, 3)}${p.lo != null ? ` (${rnd(p.lo, 3)} to ${rnd(p.hi, 3)})` : ""}</title></circle>`);
    });
  });
  o.push(`<text class="t2" x="${(left + W - right) / 2}" y="${H - 12}" text-anchor="middle">${esc(xlab)}</text>`, "</svg>");
  return o.join("\n");
}
const SHORT = { mercedes: "Mercedes", ferrari: "Ferrari", mclaren: "McLaren", redbull: "Red Bull", racingbulls: "Racing Bulls", alpine: "Alpine", haas: "Haas", audi: "Audi", williams: "Williams", astonmartin: "Aston Martin", cadillac: "Cadillac" };
function writePlots(out) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const teams = Object.keys(out.cars);
  const grip = dotPlot({ title: "Lateral grip envelope by car (estimate)", subtitle: "a_y at 100 and 200 km/h, mean circuit, mean trim · bars: bootstrap 5-95 % · OpenF1 timing telemetry", xlab: "lateral acceleration (g)",
    series: ["100 km/h", "200 km/h"], rows: teams.map(t => ({ label: SHORT[t] || t, points: ["ay_100kmh_g", "ay_200kmh_g"].map(k => ({ v: out.cars[t].params[k].mean, lo: out.cars[t].params[k].p05, hi: out.cars[t].params[k].p95 })) })) });
  fs.writeFileSync(path.join(OUT_DIR, "grip-envelope.svg"), grip);
  const drag = dotPlot({ title: "Drag area by car (estimate, conditional on the 350 kW anchor)", subtitle: "CdA, Corner Mode, mean trim · bars: bootstrap 5-95 % (includes ICE-power prior spread)", xlab: "CdA (m²)",
    series: ["CdA"], rows: teams.map(t => ({ label: SHORT[t] || t, points: [{ v: out.cars[t].params.CdA_m2.mean, lo: out.cars[t].params.CdA_m2.p05, hi: out.cars[t].params.CdA_m2.p95 }] })) });
  fs.writeFileSync(path.join(OUT_DIR, "drag-area.svg"), drag);
  if (out.loco) {
    const cs = Object.keys(out.loco);
    const loco = dotPlot({ title: "Lap time error, in-sample vs leave-one-circuit-out", subtitle: "mean (sim − real) over the circuit's checked laps · QSS sim on each lap's own path", xlab: "lap time error (s)", zero: true,
      series: ["in-sample", "held out (trim refit on corners)"], rows: cs.map(c => ({ label: out.circuits[c].name, points: [{ v: out.loco[c].in_sample.lap_time_mean_err_s }, { v: out.loco[c].held_out_refit.lap_time_mean_err_s }] })) });
    fs.writeFileSync(path.join(OUT_DIR, "loco-lap-time.svg"), loco);
  }
}

// ================================================================ CLI
function fmt(s, d) { return s && s.mean != null ? `${s.mean.toFixed(d)} ± ${s.sd.toFixed(d)}` : "-"; }
function printSummary(out, md) {
  const P = (...a) => console.log(...a);
  P(`\n${out._meta.label}\n${out.provenance.n_used} laps used, ${out.provenance.n_excluded} excluded · bootstrap ${out._meta.n_bootstrap} · ${out._meta.runtime_s} s\n`);
  P("| Car | PU | μy | μx | ClA m² | CdA m² | P_ICE kW | mass kg | a_y 100 km/h g | a_y 200 km/h g | flags |");
  P("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [id, c] of Object.entries(out.cars)) { const p = c.params; P(`| ${c.name} | ${c.power_unit} | ${fmt(p.mu_y, 2)} | ${fmt(p.mu_x, 2)} | ${fmt(p.ClA_m2, 2)} | ${fmt(p.CdA_m2, 3)} | ${fmt(p.P_ice_kw, 0)} | ${fmt(p.mass_kg, 0)} | ${fmt(p.ay_100kmh_g, 2)} | ${fmt(p.ay_200kmh_g, 2)} | ${c.flags.length} |`); }
  P(`\nglobal: load_sens ${fmt(out.global.load_sensitivity, 3)}, CdA_s/CdA_c ${fmt(out.global.straight_over_corner_CdA, 3)}, trim slope β ${fmt(out.global.drag_vs_downforce_trim_slope, 2)} (r² ${out.global.drag_vs_downforce_trim_slope.r2})`);
  P("\n| Circuit | γ | mean w | mean d | laps | corner RMS g | brake RMS km/h | anchor RMS kW | lap Δ mean s | lap MAE s |");
  P("|---|---|---|---|---|---|---|---|---|---|");
  for (const [cid, c] of Object.entries(out.circuits)) { const q = c.fit_quality; P(`| ${c.name} | ${fmt(c.grip_factor_gamma, 3)} | ${fmt(c.field_mean_downforce_trim_w, 2)} | ${fmt(c.field_mean_drag_trim_d, 2)} | ${q.n_laps} | ${q.corner_rms_g} | ${q.brake_rms_kmh} | ${q.anchor_rms_err_kw} | ${q.lap_time_mean_err_s} | ${q.lap_time_mae_s} |`); }
  if (out.loco) {
    P("\n| Held-out circuit | laps checked | in-sample lap MAE s | held-out MAE s (refit) | held-out mean Δ s | no-refit MAE s | corner RMS g in / out | anchor mean err kW out | brake RMS km/h out |");
    P("|---|---|---|---|---|---|---|---|---|");
    for (const [cid, l] of Object.entries(out.loco)) P(`| ${out.circuits[cid].name} | ${l.held_out_refit.n_lap_time_checked} | ${l.in_sample.lap_time_mae_s} | ${l.held_out_refit.lap_time_mae_s} | ${l.held_out_refit.lap_time_mean_err_s} | ${l.held_out_no_refit.lap_time_mae_s} | ${l.in_sample.corner_rms_g} / ${l.held_out_refit.corner_rms_g} | ${l.held_out_refit.anchor_mean_err_kw} | ${l.held_out_refit.brake_rms_kmh} |`);
  }
  if (out.sim_compat && out.sim_compat.rows) P(`\nconcept/sim (Silverstone): mean Δ ${out.sim_compat.mean_delta_s} s, mean |Δ| ${out.sim_compat.mean_abs_delta_s} s → ${out.sim_compat.verdict}`);
  if (md) for (const [id, c] of Object.entries(out.cars)) if (c.flags.length) P(`- ${c.name}: ${c.flags.join("; ")}`);
}
function main() {
  const argv = process.argv.slice(2), has = f => argv.includes(f), val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const opts = { boot: +val("--boot", 200), seed: +val("--seed", 2026), loco: !has("--no-loco"), simCompat: !has("--no-sim-compat"), date: val("--date", new Date().toISOString().slice(0, 10)),
    circuits: val("--circuits", null) ? val("--circuits").split(",") : D.CIRCUIT_IDS, log: has("--quiet") ? () => {} : m => process.stderr.write(m + "\n") };
  for (const c of opts.circuits) if (!D.CIRCUITS[c]) { console.error(`unknown circuit ${c}; known: ${D.CIRCUIT_IDS.join(", ")}`); process.exit(2); }
  const out = run(opts);
  printSummary(out, has("--md"));
  if (has("--write")) { fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 1) + "\n"); writePlots(out); console.log(`\nwrote ${path.relative(D.ROOT, OUT_JSON)} and ${path.relative(D.ROOT, OUT_DIR)}/*.svg`); }
}
if (require.main === module) main();
module.exports = { run, evaluate, carNumbers, physicalCar, writePlots, LABEL, OUT_JSON };
