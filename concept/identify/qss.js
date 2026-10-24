// PURPLE CONCEPT - identify / qss: a small quasi-steady-state lap simulator on a lap's OWN measured path, used only to check
// the identified parameters against lap times (in-sample and leave-one-circuit-out). Same tyre, aero and power model as the
// identification (concept/identify/model.js), so the check is internally consistent; it is not the bench simulator
// (concept/sim/), which has its own track model and energy strategy (docs/concept/IDENTIFY.md, "Scale").
// Physics: point mass, apex limits from a_y,max(v) on the lap's smoothed curvature, forward pass limited by power and a rear-axle
// traction ellipse, backward pass braking on the friction ellipse. Energy: the MGU-K deploys up to the circuit's deployment level
// (≤ 350 kW, C5.2.7, with the C5.2.8 taper) below a speed threshold v*, solved by bisection so that deployed energy ≤ 4 MJ
// (C5.2.9 window) + braking harvest (capped at the recharge limit, C5.2.10). Deterministic, fixed iteration counts.
"use strict";
const { G0 } = require("./data.js");
const M = require("./model.js");
const F = M.FIXED;

function simulate(L, p, opts) {
  opts = opts || {};
  const n = L.n, rho = L.air.rho, A = p.A, m = p.m, me = m * F.rot_mass_factor, mb = m + F.I_wheels_kgm2 / A.r_eff_m ** 2;
  const kcap = Math.min(350, opts.k_deploy_kw != null ? opts.k_deploy_kw : 350), recharge = opts.recharge_mj != null ? opts.recharge_mj : 6.5;
  // |κ| capped at 1/10 m: no racing line is tighter, and a short position glitch must not stop the car
  const zone = L.zoneGeom, kap = L.kappa.map(k => Math.min(0.1, Math.abs(k)));
  const ds = new Float64Array(n); for (let i = 0; i < n - 1; i++) ds[i] = L.s[i + 1] - L.s[i]; ds[n - 1] = ds[n - 2] || 5;
  const ayMax = (v, cla) => { const lam = 1 + (0.5 * rho * cla * v * v) / (m * G0); return p.muY * G0 * lam * Math.max(0.3, 1 - p.ls * (lam - 1)); };
  // apex limits (Corner Mode): largest v with v²κ ≤ a_y,max(v)
  const vC = new Float64Array(n), VMAX = 100;
  for (let i = 0; i < n; i++) {
    if (kap[i] * VMAX * VMAX <= ayMax(VMAX, p.ClA)) { vC[i] = VMAX; continue; }
    let lo = 0, hi = VMAX; for (let it = 0; it < 30; it++) { const v = 0.5 * (lo + hi); if (v * v * kap[i] <= ayMax(v, p.ClA)) lo = v; else hi = v; }
    vC[i] = lo;
  }
  const latUse = (i, v) => Math.min(0.999, (v * v * kap[i]) / ayMax(v, p.ClA));
  const hL = F.cog_height_m / F.wheelbase_m;
  function fwd(vStar) {
    const vf = new Float64Array(n), kUsed = new Float64Array(n); let v = vC[0];
    for (let lap = 0; lap < 2; lap++) for (let i = 0; i < n; i++) {
      v = Math.min(v, vC[i]); vf[i] = v;
      const q = 0.5 * rho * v * v, z = zone[i], cla = z ? p.ClA * F.cla_straight_ratio : p.ClA, cda = z ? p.CdA_s : p.CdA_c;
      const K = v * 3.6 < vStar ? Math.min(kcap, M.kTaper(v * 3.6)) : 0;
      const Pw = A.eta_dt * (p.P + K * A.eta_k) * 1000;
      const u = latUse(i, v), Nr = (1 - F.weight_front) * m * G0 + (1 - F.aero_balance_front) * q * cla;
      const lamR = Nr / ((1 - F.weight_front) * m * G0), muR = p.muX * Math.max(0.3, 1 - p.ls * (lamR - 1));
      const Ftr = (muR * Nr * Math.sqrt(1 - u * u)) / (1 - muR * hL), Fp = Pw / Math.max(v, 5);
      const ay = v * v * kap[i], slip = m * ay * Math.tan(A.alpha_slip_rad * u);
      const Fx = Math.min(Fp, Ftr), a = (Fx - q * cda - A.crr * (m * G0 + q * cla) - slip) / me;
      if (K > 0) { if (Ftr >= Fp) kUsed[i] = K; else { const need = (Ftr * Math.max(v, 5)) / A.eta_dt / 1000 - p.P; kUsed[i] = need > 0 ? Math.min(K, need / A.eta_k) : 0; } }
      v = Math.sqrt(Math.max(1, v * v + 2 * a * ds[i]));
    }
    return { vf, kUsed };
  }
  // backward (braking, Corner Mode)
  const vb = new Float64Array(n), Fb = new Float64Array(n); let v = vC[n - 1];
  for (let lap = 0; lap < 2; lap++) for (let i = n - 1; i >= 0; i--) {
    v = Math.min(v, vC[i]); vb[i] = v;
    const q = 0.5 * rho * v * v, N = m * G0 + q * p.ClA, lam = N / (m * G0), u = latUse(i, v);
    const Fx = p.muX * Math.max(0.3, 1 - p.ls * (lam - 1)) * N * Math.sqrt(1 - u * u); Fb[i] = Fx;
    const a = (Fx + q * p.CdA_c + A.crr * N) / mb;
    v = Math.sqrt(v * v + 2 * a * ds[i > 0 ? i - 1 : n - 1]);
  }
  function lap(vStar) {
    const { vf, kUsed } = fwd(vStar), vs = new Float64Array(n);
    for (let i = 0; i < n; i++) vs[i] = Math.min(vf[i], vb[i], vC[i]);
    let t = 0, dep = 0, harv = 0; const tt = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) {
      const dt = ds[i] / Math.max(1, 0.5 * (vs[i] + vs[i + 1])); tt[i + 1] = t + dt; t += dt;
      if (vs[i] === vf[i] && kUsed[i] > 0) dep += kUsed[i] * dt;
      if (vs[i] === vb[i] && vb[i] < vf[i]) harv += Math.min(350, (F.rear_brake_share * Fb[i] * vs[i] * A.eta_k) / 1000) * dt;
    }
    return { vs, t, tt, dep_mj: dep / 1000, harv_mj: harv / 1000 };
  }
  // energy closure: highest v* with deployed ≤ 4 MJ + min(recharge, braking harvest)
  let r = lap(400); const budget = x => 4 + Math.min(recharge, x.harv_mj);
  let vStar = 400;
  if (r.dep_mj > budget(r)) {
    let lo = 0, hi = 400; for (let it = 0; it < 16; it++) { const mid = 0.5 * (lo + hi), x = lap(mid); if (x.dep_mj <= budget(x)) lo = mid; else hi = mid; }
    vStar = lo; r = lap(lo);
  }
  return { lap_time_s: r.t, v: r.vs, t: r.tt, deploy_mj: r.dep_mj, harvest_brake_mj: r.harv_mj, v_star_kmh: vStar };
}
// lap-time and speed-trace comparison against the real lap (speed RMS over valid points only)
function compare(L, sim) {
  let se = 0, nn = 0, bias = 0;
  for (let i = 0; i < L.n; i++) if (L.vs[i] != null) { const d = (sim.v[i] - L.vs[i]) * 3.6; se += d * d; bias += d; nn++; }
  if (!isFinite(sim.lap_time_s)) return { lap_time_real_s: L.lap_time_s, lap_time_sim_s: null, delta_s: null, speed_rms_kmh: null, speed_bias_kmh: null };
  return { lap_time_real_s: L.lap_time_s, lap_time_sim_s: sim.lap_time_s, delta_s: sim.lap_time_s - L.lap_time_s, speed_rms_kmh: Math.sqrt(se / Math.max(1, nn)), speed_bias_kmh: bias / Math.max(1, nn) };
}
module.exports = { simulate, compare };
