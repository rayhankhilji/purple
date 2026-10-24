// PURPLE CONCEPT - identify / model: the joint 9-circuit, 11-car parameter estimate (docs/concept/IDENTIFY.md).
// Estimates from public timing telemetry (OpenF1), not team data. Every parameter is an EFFECTIVE value of the point-mass
// model written here; the scale is documented in IDENTIFY.md ("Scale").
//
// Parameters (θ):
//   per car k:            ln μy_k, ln μx_k (effective tyre friction at the reference load), ln ClA_k, ln CdA_k (the car's mean
//                         trim over the fitted circuits), P_k (ICE crank power above 10 500 rpm, kW), m_k (car + driver, no fuel)
//   per car k, circuit c: wing level, two numbers: w_kc (downforce trim, ClA_kc = ClA_k·e^w) and d_kc (drag trim,
//                         CdA_kc = CdA_k·e^d); Σ_c w_kc = Σ_c d_kc = 0 per car (gauge: ClA_k, CdA_k are the car's means)
//   per circuit c:        ln γ_c (circuit grip factor on μy and μx of every car); Σ_c ln γ_c = 0 (gauge)
//   global:               load sensitivity ls (μ(N) = μ·(1 − ls·(N/mg − 1)), the concept/sim form), r_s (Straight / Corner Mode CdA)
// Observations (per lap):
//   corners  a_y = μy·γ·g·λ·(1 − ls·(λ − 1)),  λ = 1 + ½ρ·ClA_kc·v²/(m·g)        grip-limited corner minima (v_min²·max|κ|)
//   brakes   v(s) through each brake zone: decel = [√((μx·γ·f(λ)·N)² − (m·a_y)²) + ½ρ·CdA_kc·v² + Crr·m·g] / m_b
//   anchor   mean of the top-3 per-straight MGU-K peaks implied by the power balance = 350 kW (C5.2.7 cap, qualifying)
// Priors (sourced bands from concept/data/priors-2026.json; judgement where nothing is public) enter as penalty residuals.
// Robust (Huber) Levenberg-Marquardt on sparse residual groups. Deterministic: fixed iteration counts, seeded generator.
"use strict";
const path = require("path");
const D = require("./data.js");
const { G0 } = D;

// ================================================================ constants, assumptions, priors
const REG = { mguk_kw: 350, soc_window_mj: 4 }; // C5.2.7, C5.2.9
const kTaper = vkmh => Math.max(0, Math.min(REG.mguk_kw, vkmh < 340 ? 1800 - 5 * vkmh : vkmh < 345 ? 6900 - 20 * vkmh : 0)); // C5.2.8 i
const efRatio = rpm => (rpm >= 10500 ? 1 : Math.max(0, 0.27 * rpm + 165) / 3000); // C5.2.3-4: fuel energy flow shape

// fixed model choices (not varied)
const FIXED = {
  I_wheels_kgm2: 4.0, I_engine_kgm2: 0.03,       // rotating inertia (assumption, as concept/tools/derive-car.js)
  anchor_kw: 350, anchor_sd_kw: 30, k_top: 3,    // deployment anchor: the top-3 straights reach the 350 kW cap (method choice)
  anchor_lo_kmh: 180, anchor_hi_kmh: 290,         // window: above the traction-limited range, below where the C5.2.8 taper bites
  anchor_glitch_kw: 700,                          // a "peak" above 700 kW at the nominal car is a trace glitch, not deployment
  win_pts: 5,                                     // 25 m window per straight
  corner_sd_g: 0.50, brake_sd_ms: 2.0, brake_zone_dof: 2, huber_c: 2.5,
  // QSS lap simulator only (validation):
  weight_front: 0.45, aero_balance_front: 0.435, cog_height_m: 0.30, wheelbase_m: 3.4, cla_straight_ratio: 0.72,
  rot_mass_factor: 1.03, rear_brake_share: 0.43,
};
// assumptions drawn from their band in every bootstrap replicate (central value in the central fit); band = ±2 sd
const ASSUMPTIONS = {
  eta_dt: { central: 0.95, lo: 0.93, hi: 0.97, source: "priors-2026 drivetrain_efficiency" },
  eta_k: { central: 0.95, lo: 0.93, hi: 0.97, source: "assumption (MGU-K DC to shaft), as concept/tools/derive-car.js" },
  crr: { central: 0.012, lo: 0.008, hi: 0.02, source: "priors-2026 rolling_resistance_Crr" },
  r_eff_m: { central: 0.348, lo: 0.34, hi: 0.355, source: "priors-2026 tyre_loaded_rolling_radius" },
  alpha_slip_rad: { central: 0.08, lo: 0.04, hi: 0.12, source: "assumption (slip angle at the lateral limit, cornering drag), as derive-car" },
  fuel_kg: { central: 5, lo: 3, hi: 8, source: "assumption (fuel on a qualifying lap)" },
};
const centralAssumptions = () => Object.fromEntries(Object.entries(ASSUMPTIONS).map(([k, a]) => [k, a.central]));

const PRIORS_FILE = path.join(D.ROOT, "concept", "data", "priors-2026.json");
// load sensitivity: the source gives % of μ lost per kN of tyre load; the model uses the concept/sim form per unit of load ratio,
// so ls = (%/kN)/100 × static tyre load (775 kg·g/4 ≈ 1.9 kN)
function lsPrior(r) {
  const F0 = (775 * G0) / 4 / 1000, lo = r ? +r.lo : 3, c = r ? +r.central : 4.5, hi = r ? +r.hi : 6;
  return { key: "load_sensitivity", log: false, lo: (lo / 100) * F0, central: (c / 100) * F0, hi: (hi / 100) * F0, mu: (c / 100) * F0, sd: ((hi - lo) / 200) * F0,
    source: (r ? "priors-2026.json load_sensitivity" : "fallback") + ` (${lo}-${hi} %/kN × static tyre load ${F0.toFixed(2)} kN)` };
}
// prior table: centre, sd (log-space for log parameters) and the sourced band used for the in-band check. Sourced bands are
// taken as ±1 sd (weakly informative), because the parameters here are effective values of a simpler model than the one the
// sources describe; judgement priors are labelled as such.
function priorTable() {
  let rec = {};
  try { rec = Object.fromEntries(D.readJSON(PRIORS_FILE).recommended_fit_priors.map(r => [r.key, r])); } catch (e) { rec = {}; }
  const band = (key, lo, c, hi) => { const r = rec[key]; return r ? { key, lo: +r.lo, central: +r.central, hi: +r.hi, source: "priors-2026.json " + key } : { key, lo, central: c, hi, source: "fallback (priors file missing)" }; };
  const lg = b => Object.assign({}, b, { log: true, mu: Math.log(b.central), sd: Math.log(b.hi / b.lo) / 2 });
  const ln = b => Object.assign({}, b, { log: false, mu: b.central, sd: (b.hi - b.lo) / 2 });
  const ntm = band("nominal_tyre_mass", 44, 46, 48);
  return {
    mu_y: lg(band("mu_y_peak_at_2kN", 1.6, 1.8, 2.0)),
    mu_x: lg(band("mu_x_peak_at_2kN", 1.5, 1.75, 1.9)),
    ClA: lg(band("CLA_corner", 3.2, 3.9, 4.6)),
    CdA: lg(band("CDA_corner", 0.75, 1.0, 1.25)),
    P_kw: ln(band("ICE_crank_power", 385, 405, 430)),
    mass: Object.assign(band("car_mass_incl_driver_no_fuel", 770, 774, 780), { log: false, ntm, sd: 5, note: "per car: 726 kg (C4.1) + Nominal Tyre Mass central + the team's reported excess (grid-2026.json); sd 5 kg (NTM band and reporting)" }),
    r_s: ln(band("CDA_straight_over_corner", 0.75, 0.82, 0.92)),
    ls: lsPrior(rec.load_sensitivity),
    gamma: { key: "gamma", log: true, mu: 0, sd: 0.15, source: "judgement: circuit grip factor within ±15 % of the 9-circuit mean (surface, temperature, and the circuit's curvature-estimate bias)" },
    w: { key: "w", log: false, mu: 0, sd: 0.3, source: "judgement: a circuit's downforce trim within ±30 % (log) of the car's mean" },
    d: { key: "d", log: false, mu: 0, sd: 0.3, source: "judgement: a circuit's drag trim within ±30 % (log) of the car's mean" },
    pu_tie_kw: { key: "pu_tie_kw", sd: 8, source: "judgement: teams on the same power unit within ~8 kW of their family mean" },
  };
}
const PRIOR = priorTable();
const massPrior = team => 726 + PRIOR.mass.ntm.central + team.overweight_kg;

// ================================================================ features
// one record per usable lap: corners, brake zones, full-throttle runs (for the anchor); excluded laps are listed with the reason
function buildFeatures(circuits) {
  const laps = [], excluded = [];
  for (const cid of circuits) {
    for (const code of D.lapFiles(cid)) {
      const L = D.loadLap(cid, code);
      const rec = { cid, code: L.code, team: L.team, file: L.file, audit: L.policy.status, actions: L.policy.actions, use: L.policy.use };
      if (L.policy.exclude) { excluded.push(rec); continue; }
      const k = D.TEAM_IDS.indexOf(L.team);
      const corners = D.cornerPoints(L).map(p => ({ v: p.v, ay: p.ay, s: p.s }));
      const brakes = D.brakeZones(L).map(z => ({ v0: z.vobs[0], ds: z.ds, ay: z.ay, vobs: z.vobs, s: L.s[z.i1], entry_kmh: z.entry_kmh }));
      const runs = D.fullThrottleRuns(L, 0.348).map(r => r.map(p => ({ v: p.v, a: p.a, rpm: p.rpm, ay: p.ay, zone: p.zone, wr: p.G / 0.348, i: p.i })));
      laps.push(Object.assign(rec, { k, rho: L.air.rho, air: L.air, lap_time_s: L.lap_time_s, corners, brakes, runs, windows: null, L }));
    }
  }
  return { laps, excluded };
}

// ================================================================ parameter layout
function layout(circuits) {
  const K = D.TEAM_IDS.length, C = circuits.length; let n = 0;
  const car = D.TEAM_IDS.map(() => ({ muY: n++, muX: n++, clA: n++, cdA: n++, P: n++, m: n++ }));
  const w = D.TEAM_IDS.map(() => circuits.map(() => n++));
  const d = D.TEAM_IDS.map(() => circuits.map(() => n++));
  const g = circuits.map(() => n++);
  const rs = n++, ls = n++;
  const names = new Array(n);
  D.TEAM_IDS.forEach((t, k) => { for (const [f, i] of Object.entries(car[k])) names[i] = `${t}.${f}`; circuits.forEach((c, j) => { names[w[k][j]] = `${t}.w.${c}`; names[d[k][j]] = `${t}.d.${c}`; }); });
  circuits.forEach((c, j) => { names[g[j]] = `gamma.${c}`; });
  names[rs] = "r_s"; names[ls] = "load_sens";
  return { n, K, C, circuits, car, w, d, g, rs, ls, names };
}
// P is carried in units of 100 kW and m in 100 kg so finite differences and damping see similar scales
function initTheta(lay) {
  const th = new Float64Array(lay.n);
  D.TEAMS.forEach((t, k) => {
    const c = lay.car[k];
    th[c.muY] = Math.log(2.2); th[c.muX] = Math.log(1.8); th[c.clA] = Math.log(PRIOR.ClA.central); th[c.cdA] = Math.log(1.1);
    th[c.P] = PRIOR.P_kw.central / 100; th[c.m] = massPrior(t) / 100;
  });
  th[lay.rs] = PRIOR.r_s.central; th[lay.ls] = PRIOR.ls.central;
  return th;
}
// the car as seen on circuit index j
function carAt(th, lay, k, j, A) {
  const c = lay.car[k], g = Math.exp(th[lay.g[j]]), cdc = Math.exp(th[c.cdA] + th[lay.d[k][j]]);
  return { muY: Math.exp(th[c.muY]) * g, muX: Math.exp(th[c.muX]) * g, ClA: Math.exp(th[c.clA] + th[lay.w[k][j]]), CdA_c: cdc, CdA_s: cdc * th[lay.rs],
    P: th[c.P] * 100, mass: th[c.m] * 100, m: th[c.m] * 100 + A.fuel_kg, ls: th[lay.ls], A };
}

// ================================================================ observation models
const lsFactor = (ls, lam) => Math.max(0.3, 1 - ls * (lam - 1));
const ayModel = (p, v, rho) => { const lam = 1 + (0.5 * rho * p.ClA * v * v) / (p.m * G0); return p.muY * G0 * lam * lsFactor(p.ls, lam); };
function kdc(p, pt, rho) { // implied MGU-K DC power (kW) at one full-throttle point
  const A = p.A, G = pt.wr * A.r_eff_m, me = p.m + FIXED.I_wheels_kgm2 / A.r_eff_m ** 2 + (FIXED.I_engine_kgm2 * G * G) / A.r_eff_m ** 2;
  const amax = ayModel(p, pt.v, rho), slip = p.m * pt.ay * Math.tan(A.alpha_slip_rad * Math.min(1, pt.ay / amax));
  const cda = pt.zone ? p.CdA_s : p.CdA_c;
  const Pw = me * pt.v * pt.a + 0.5 * rho * cda * pt.v ** 3 + A.crr * p.m * G0 * pt.v + slip * pt.v;
  const Ks = Pw / A.eta_dt - p.P * 1000 * efRatio(pt.rpm);
  return (Ks > 0 ? Ks / A.eta_k : Ks * A.eta_k) / 1000;
}
const windowK = (p, win, rho) => { let s = 0; for (const pt of win) s += kdc(p, pt, rho); return s / win.length; };
// per run: the 25 m window with the highest median implied K at car p (fixed afterwards, so the anchor is continuous in θ)
function selectWindows(lap, p) {
  const out = [];
  for (const run of lap.runs) {
    const pts = run.filter(q => q.v * 3.6 >= FIXED.anchor_lo_kmh && q.v * 3.6 <= FIXED.anchor_hi_kmh);
    let best = null, bv = -Infinity;
    for (let s = 0; s + FIXED.win_pts <= pts.length; s++) {
      const w = pts.slice(s, s + FIXED.win_pts); if (w[w.length - 1].i - w[0].i !== FIXED.win_pts - 1) continue; // consecutive grid points
      const ks = w.map(q => kdc(p, q, lap.rho)).sort((a, b) => a - b), med = ks[(ks.length - 1) >> 1];
      if (med > bv) { bv = med; best = w; }
    }
    if (best && bv < FIXED.anchor_glitch_kw) out.push(best);
  }
  return out;
}
function anchorValue(p, lap, sel) { // mean of the top-k window values; sel = bootstrap multiset of window indices (or all)
  const vals = (sel || lap.windows.map((_, i) => i)).map(i => windowK(p, lap.windows[i], lap.rho)).sort((a, b) => b - a);
  const k = Math.min(FIXED.k_top, vals.length); let s = 0; for (let i = 0; i < k; i++) s += vals[i]; return s / k;
}
function brakeSim(p, z, rho) { // speed through one brake-zone fit window (Corner Mode, friction ellipse on the measured a_y)
  const A = p.A, mb = p.m + FIXED.I_wheels_kgm2 / A.r_eff_m ** 2; let v = z.v0; const vm = [v];
  for (let k = 0; k < z.ds.length - 1; k++) {
    const q = 0.5 * rho * v * v, N = p.m * G0 + q * p.ClA, Fy = p.m * z.ay[k], Fx = Math.sqrt(Math.max(0, (p.muX * N * lsFactor(p.ls, N / (p.m * G0))) ** 2 - Fy * Fy));
    const a = (Fx + q * p.CdA_c + A.crr * p.m * G0) / mb;
    v = Math.sqrt(Math.max(1, v * v - 2 * a * z.ds[k + 1])); vm.push(v);
  }
  return vm;
}

// ================================================================ problem: residual groups
// group = { idx: [parameter indices], f(th) -> residual array, data: bool (Huber-weighted), kind }
function buildProblem(feat, lay, opts) {
  opts = opts || {};
  const A = opts.A || centralAssumptions(), pri = opts.priorCentres || null, bw = opts.boot || null;
  const only = opts.onlyObs || null; // { corners: true } for the held-out trim fit
  const groups = [];
  for (let li = 0; li < feat.laps.length; li++) {
    const lap = feat.laps[li], j = lay.circuits.indexOf(lap.cid); if (j < 0) continue;
    const k = lap.k, c = lay.car[k], b = bw ? bw.laps[li] : null, lm = b ? b.mult : 1;
    if (lm === 0) continue;
    const W = lay.w[k][j], Dd = lay.d[k][j], Gc = lay.g[j];
    if (lap.corners.length && (!only || only.corners)) {
      const mult = b ? b.corners : lap.corners.map(() => 1);
      groups.push({ data: true, kind: "corner", lap: li, idx: [c.muY, c.clA, c.m, W, Gc, lay.ls], f: th => {
        const p = carAt(th, lay, k, j, A), r = [];
        lap.corners.forEach((q, i) => { if (mult[i]) r.push(((ayModel(p, q.v, lap.rho) - q.ay) / (FIXED.corner_sd_g * G0)) * Math.sqrt(mult[i] * lm)); });
        return r;
      } });
    }
    if (lap.brakes.length && (!only || only.brakes)) {
      const mult = b ? b.brakes : lap.brakes.map(() => 1);
      groups.push({ data: true, kind: "brake", lap: li, idx: [c.muX, c.clA, c.cdA, c.m, W, Dd, Gc, lay.ls], f: th => {
        const p = carAt(th, lay, k, j, A), r = [];
        lap.brakes.forEach((z, i) => {
          if (!mult[i]) return;
          const vm = brakeSim(p, z, lap.rho), sc = Math.sqrt((FIXED.brake_zone_dof / Math.max(1, vm.length - 1)) * mult[i] * lm) / FIXED.brake_sd_ms;
          for (let t = 1; t < vm.length; t++) r.push((vm[t] - z.vobs[t]) * sc);
        });
        return r;
      } });
    }
    if (lap.windows && lap.windows.length >= 2 && (!only || only.anchor)) {
      const sel = b ? b.windows : null;
      if (!sel || sel.length) groups.push({ data: true, kind: "anchor", lap: li, idx: [c.muY, c.clA, c.cdA, c.P, c.m, W, Dd, Gc, lay.rs, lay.ls], f: th => {
        const p = carAt(th, lay, k, j, A);
        return [((anchorValue(p, lap, sel) - FIXED.anchor_kw) / FIXED.anchor_sd_kw) * Math.sqrt(lm)];
      } });
    }
  }
  // priors (penalty residuals); centres optionally randomised (bootstrap), gauges never
  const P = PRIOR, pc = (key, mu) => (pri && pri[key] != null ? pri[key] : mu);
  const prior = (i, mu, sd) => groups.push({ data: false, kind: "prior", idx: [i], f: th => [(th[i] - mu) / sd] });
  const gauge = idx => groups.push({ data: false, kind: "gauge", idx: idx.slice(), f: th => [idx.reduce((s, i) => s + th[i], 0) * 30] });
  D.TEAMS.forEach((t, k) => {
    const c = lay.car[k];
    prior(c.muY, pc(`${t.id}.mu_y`, P.mu_y.mu), P.mu_y.sd);
    prior(c.muX, pc(`${t.id}.mu_x`, P.mu_x.mu), P.mu_x.sd);
    prior(c.clA, pc(`${t.id}.ClA`, P.ClA.mu), P.ClA.sd);
    prior(c.cdA, pc(`${t.id}.CdA`, P.CdA.mu), P.CdA.sd);
    prior(c.P, pc(`${t.id}.P`, P.P_kw.mu) / 100, P.P_kw.sd / 100);
    prior(c.m, pc(`${t.id}.m`, massPrior(t)) / 100, P.mass.sd / 100);
    lay.w[k].forEach((i, j) => prior(i, pc(`${t.id}.w.${lay.circuits[j]}`, 0), P.w.sd));
    lay.d[k].forEach((i, j) => prior(i, pc(`${t.id}.d.${lay.circuits[j]}`, 0), P.d.sd));
    if (!opts.noGauge) { gauge(lay.w[k]); gauge(lay.d[k]); }
  });
  // power-unit family tie: each car's P against its family mean
  for (const pu of D.PU_IDS) {
    const ks = D.TEAMS.map((t, k) => (t.pu === pu ? k : -1)).filter(k => k >= 0); if (ks.length < 2) continue;
    const idx = ks.map(k => lay.car[k].P);
    groups.push({ data: false, kind: "pu_tie", idx, f: th => { const m = idx.reduce((s, i) => s + th[i], 0) / idx.length; return idx.map(i => ((th[i] - m) * 100) / P.pu_tie_kw.sd); } });
  }
  lay.g.forEach((i, j) => prior(i, pc(`gamma.${lay.circuits[j]}`, 0), P.gamma.sd));
  if (!opts.noGauge) gauge(lay.g);
  prior(lay.rs, pc("r_s", P.r_s.mu), P.r_s.sd);
  prior(lay.ls, pc("load_sens", P.ls.mu), P.ls.sd);
  return { groups, A, lay };
}

// ================================================================ robust Levenberg-Marquardt (sparse groups, dense normal equations)
const huber = (r, c) => { const a = Math.abs(r); return a <= c ? 0.5 * r * r : c * a - 0.5 * c * c; };
function cost(prob, th) { let s = 0; for (const g of prob.groups) for (const r of g.f(th)) s += g.data ? huber(r, FIXED.huber_c) : 0.5 * r * r; return s; }
function cholSolve(H, b, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = H[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    if (i === j) { if (s <= 0) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
  }
  const y = new Float64Array(n); for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}
function solve(prob, th0, opts) {
  opts = opts || {};
  const n = prob.lay.n, maxIt = opts.maxIt || 40;
  let th = Float64Array.from(th0), c0 = cost(prob, th), lam = 1e-3, it = 0;
  const fi = opts.free ? Array.from(opts.free) : Array.from({ length: n }, (_, i) => i), pos = new Int32Array(n).fill(-1); fi.forEach((i, q) => { pos[i] = q; });
  const m = fi.length;
  for (; it < maxIt; it++) {
    const H = new Float64Array(m * m), g = new Float64Array(m);
    for (const G of prob.groups) {
      const loc = G.idx.filter(i => pos[i] >= 0); if (!loc.length) continue;
      const r0 = G.f(th), J = [];
      for (const i of loc) { const h = 1e-6 * Math.max(1, Math.abs(th[i])), t = th[i]; th[i] = t + h; const r1 = G.f(th); th[i] = t; J.push(r1.map((x, q) => (x - r0[q]) / h)); }
      for (let q = 0; q < r0.length; q++) {
        const w = G.data ? Math.min(1, FIXED.huber_c / Math.max(1e-12, Math.abs(r0[q]))) : 1;
        for (let a = 0; a < loc.length; a++) {
          const pa = pos[loc[a]], ja = J[a][q] * w; if (!ja) continue;
          g[pa] += ja * r0[q];
          for (let bq = 0; bq < loc.length; bq++) H[pa * m + pos[loc[bq]]] += ja * J[bq][q];
        }
      }
    }
    let accepted = false, done = false;
    for (let tries = 0; tries < 10; tries++) {
      const Hd = Float64Array.from(H); for (let i = 0; i < m; i++) Hd[i * m + i] += lam * Math.max(H[i * m + i], 1e-6) + 1e-9;
      const d = cholSolve(Hd, g.map(x => -x), m); if (!d) { lam *= 10; continue; }
      const tn = Float64Array.from(th); fi.forEach((i, q) => { tn[i] += d[q]; });
      const c1 = cost(prob, tn);
      if (c1 < c0) { done = (c0 - c1) / Math.max(1, c0) < 1e-9; th = tn; c0 = c1; lam = Math.max(1e-7, lam / 3); accepted = true; break; }
      lam *= 4;
    }
    if (!accepted || done) { it++; break; }
  }
  return { th, cost: c0, iterations: it };
}

// ================================================================ fit (central): two passes, the anchor windows re-selected at the pass-1 car
function nominalCar(k, A) { const t = D.TEAMS[k]; return { muY: 2.2, muX: 1.8, ClA: PRIOR.ClA.central, CdA_c: 1.1, CdA_s: 0.9, P: PRIOR.P_kw.central, mass: massPrior(t), m: massPrior(t) + A.fuel_kg, ls: PRIOR.ls.central, A }; }
function selectAll(feat, lay, th, A) {
  for (const lap of feat.laps) {
    const j = lay.circuits.indexOf(lap.cid); if (j < 0) continue;
    lap.windows = selectWindows(lap, th ? carAt(th, lay, lap.k, j, A) : nominalCar(lap.k, A));
  }
}
function fitCentral(feat, circuits, opts) {
  opts = opts || {};
  const lay = layout(circuits), A = centralAssumptions();
  selectAll(feat, lay, null, A);
  let r = solve(buildProblem(feat, lay, { A }), initTheta(lay), { maxIt: opts.maxIt || 40 });
  selectAll(feat, lay, r.th, A);
  const prob = buildProblem(feat, lay, { A });
  r = solve(prob, r.th, { maxIt: opts.maxIt || 40 });
  return { lay, th: r.th, cost: r.cost, iterations: r.iterations, prob, A };
}

// ================================================================ bootstrap: laps within each (car, circuit) cell, then corners / brake zones /
// straights within each drawn lap; prior centres and assumptions are drawn too, so a parameter the data cannot pin keeps its prior spread
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function normal(R) { const u = Math.max(1e-12, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function drawBoot(feat, lay, R) {
  const laps = feat.laps.map(() => ({ mult: 0 }));
  const cells = {};
  feat.laps.forEach((lap, li) => { if (lay.circuits.includes(lap.cid)) (cells[lap.cid + "|" + lap.team] = cells[lap.cid + "|" + lap.team] || []).push(li); });
  for (const key of Object.keys(cells).sort()) { const ls = cells[key]; for (let q = 0; q < ls.length; q++) laps[ls[Math.floor(R() * ls.length)]].mult++; }
  const multi = n => { const m = new Array(n).fill(0); for (let q = 0; q < n; q++) m[Math.floor(R() * n)]++; return m; };
  feat.laps.forEach((lap, li) => {
    const b = laps[li];
    b.corners = multi(lap.corners.length); b.brakes = multi(lap.brakes.length);
    const nw = lap.windows ? lap.windows.length : 0; b.windows = []; for (let q = 0; q < nw; q++) b.windows.push(Math.floor(R() * nw));
  });
  const A = {}; for (const [k, a] of Object.entries(ASSUMPTIONS)) { const sd = (a.hi - a.lo) / 4; A[k] = Math.min(a.hi, Math.max(a.lo, a.central + sd * normal(R))); }
  const P = PRIOR, pri = {};
  D.TEAMS.forEach(t => {
    pri[`${t.id}.mu_y`] = P.mu_y.mu + P.mu_y.sd * normal(R); pri[`${t.id}.mu_x`] = P.mu_x.mu + P.mu_x.sd * normal(R);
    pri[`${t.id}.ClA`] = P.ClA.mu + P.ClA.sd * normal(R); pri[`${t.id}.CdA`] = P.CdA.mu + P.CdA.sd * normal(R);
    pri[`${t.id}.P`] = P.P_kw.mu + P.P_kw.sd * normal(R); pri[`${t.id}.m`] = massPrior(t) + P.mass.sd * normal(R);
    lay.circuits.forEach(c => { pri[`${t.id}.w.${c}`] = P.w.sd * normal(R); pri[`${t.id}.d.${c}`] = P.d.sd * normal(R); });
  });
  lay.circuits.forEach(c => { pri[`gamma.${c}`] = P.gamma.sd * normal(R); });
  pri.r_s = P.r_s.mu + P.r_s.sd * normal(R); pri.load_sens = P.ls.mu + P.ls.sd * normal(R);
  return { boot: { laps }, A, pri };
}
function bootstrap(feat, central, nBoot, seed, onProgress) {
  const R = rng(seed), out = [];
  for (let b = 0; b < nBoot; b++) {
    const d = drawBoot(feat, central.lay, R);
    const prob = buildProblem(feat, central.lay, { A: d.A, priorCentres: d.pri, boot: d.boot });
    const r = solve(prob, central.th, { maxIt: 15 });
    out.push({ th: r.th, A: d.A });
    if (onProgress) onProgress(b + 1, nBoot);
  }
  return out;
}

// ================================================================ wing-level relation: drag trim against downforce trim over every (car, circuit)
// d ≈ β·w (least squares through the origin). Used to predict a held-out circuit's drag trim from its corner-fitted downforce trim.
function trimSlope(th, lay) {
  let sxy = 0, sxx = 0, n = 0;
  lay.w.forEach((ws, k) => ws.forEach((i, j) => { const x = th[i], y = th[lay.d[k][j]]; sxy += x * y; sxx += x * x; n++; }));
  const beta = sxx > 0 ? sxy / sxx : 0;
  let se = 0; lay.w.forEach((ws, k) => ws.forEach((i, j) => { se += (th[lay.d[k][j]] - beta * th[i]) ** 2; }));
  let syy = 0; lay.d.forEach(ds => ds.forEach(i => { syy += th[i] * th[i]; }));
  return { beta, n, r2: syy > 0 ? 1 - se / syy : 0, resid_sd: Math.sqrt(se / Math.max(1, n - 1)) };
}

// ================================================================ held-out circuit: shared parameters frozen; only the circuit's grip γ and the
// cars' downforce trims w are fitted, on that circuit's corner data alone; drag trims are predicted as d = β·w; everything else
// at the held-out circuit (anchor, braking, lap time) is then a prediction
function holdOut(feat, trainFit, cid) {
  const circuits = trainFit.lay.circuits.concat([cid]), lay = layout(circuits), j = circuits.length - 1, A = trainFit.A, tl = trainFit.lay;
  const th = new Float64Array(lay.n);
  D.TEAMS.forEach((t, k) => {
    for (const f of Object.keys(lay.car[k])) th[lay.car[k][f]] = trainFit.th[tl.car[k][f]];
    tl.circuits.forEach((c, q) => { th[lay.w[k][q]] = trainFit.th[tl.w[k][q]]; th[lay.d[k][q]] = trainFit.th[tl.d[k][q]]; });
  });
  tl.circuits.forEach((c, q) => { th[lay.g[q]] = trainFit.th[tl.g[q]]; });
  th[lay.rs] = trainFit.th[tl.rs]; th[lay.ls] = trainFit.th[tl.ls];
  const noRefit = Float64Array.from(th);
  const feat1 = { laps: feat.laps.filter(l => l.cid === cid), excluded: [] };
  const prob = buildProblem(feat1, lay, { A, onlyObs: { corners: true }, noGauge: true });
  const free = [lay.g[j]].concat(D.TEAMS.map((t, k) => lay.w[k][j]));
  const r = solve(prob, th, { free, maxIt: 30 });
  const slope = trimSlope(trainFit.th, tl);
  D.TEAMS.forEach((t, k) => { r.th[lay.d[k][j]] = slope.beta * r.th[lay.w[k][j]]; });
  return { lay, th: r.th, noRefit, A, j, slope };
}

module.exports = { REG, FIXED, ASSUMPTIONS, PRIOR, kTaper, efRatio, centralAssumptions, massPrior, buildFeatures, layout, initTheta, carAt, ayModel, kdc, anchorValue, brakeSim,
  selectWindows, selectAll, buildProblem, solve, cost, fitCentral, bootstrap, drawBoot, trimSlope, holdOut, rng, normal };
