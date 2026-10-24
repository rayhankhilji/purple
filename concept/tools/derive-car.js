#!/usr/bin/env node
// PURPLE CONCEPT - derive-car: inverse vehicle dynamics on real qualifying telemetry -> a PhysicalCar for Red Bull RB22 / Red Bull Ford DM01.
// Reads concept/data/telemetry (OpenF1, Silverstone 2026 qualifying) and the 2026 regulation figures; measures what is not public
// (gearing, drag and downforce areas, tyre friction, MGU-K deployment pattern), then runs a quasi-steady-state (QSS) lap with those
// parameters and compares it with the real laps (HAD = fit lap; VER if present, LAW and the other teams = held out).
// Node only, no dependencies.
//   node concept/tools/derive-car.js            print the results
//   node concept/tools/derive-car.js --write    also write concept/data/redbull-2026-derived.json and docs/concept/redbull-derived/*.svg
// Method, equations and limitations: docs/concept/REDBULL-DERIVED.md.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
// --tel <dir> reads lap files from another folder (e.g. a newer checkout of the telemetry branch); weather and corners stay in the repo
const TEL_REPO = path.join(ROOT, "concept", "data", "telemetry");
const TEL = (() => { const i = process.argv.indexOf("--tel"); return i > 0 ? path.resolve(process.argv[i + 1]) : TEL_REPO; })();
const OUT_JSON = path.join(ROOT, "concept", "data", "redbull-2026-derived.json");
const OUT_SVG = path.join(ROOT, "docs", "concept", "redbull-derived");
const G0 = 9.80665;

// ================================================================ inputs
const readJSON = p => JSON.parse(fs.readFileSync(p, "utf8"));
const WEATHER = readJSON(path.join(TEL_REPO, "silverstone-2026-q-weather.json"));
const CIRCUIT = readJSON(path.join(TEL_REPO, "silverstone-circuit.json"));

// ================================================================ small numerics
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const quantile = (a, q) => { const b = a.slice().sort((x, y) => x - y); const i = (b.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); };
const median = a => quantile(a, 0.5);
const rnd = (x, d) => { if (x == null || !isFinite(x)) return null; const f = 10 ** (d == null ? 4 : d); return Math.round(x * f) / f; };
function solve(A, b) { // Gaussian elimination, partial pivoting
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let c = n - 1; c >= 0; c--) { let s = M[c][n]; for (let k = c + 1; k < n; k++) s -= M[c][k] * x[k]; x[c] = s / M[c][c]; }
  return x;
}
function lsq(X, y) { // ordinary least squares with parameter standard errors
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  X.forEach((row, i) => { for (let j = 0; j < p; j++) { b[j] += row[j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += row[j] * row[k]; } });
  const beta = solve(A, b), res = X.map((row, i) => y[i] - row.reduce((s, x, j) => s + x * beta[j], 0));
  const s2 = res.reduce((s, r) => s + r * r, 0) / Math.max(1, y.length - p);
  const cov = Array.from({ length: p }, (_, j) => solve(A, Array.from({ length: p }, (_, k) => (k === j ? 1 : 0))).map(x => x * s2));
  return { beta, res, cov, se: beta.map((_, j) => Math.sqrt(Math.max(0, cov[j][j]))), rms: Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length) };
}
function golden(f, lo, hi, tol) { // 1-D minimiser
  const g = (Math.sqrt(5) - 1) / 2; let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  while (b - a > (tol || 1e-4)) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); } }
  return (a + b) / 2;
}
function bisect(f, lo, hi, tol) { let flo = f(lo); for (let k = 0; k < 80 && hi - lo > (tol || 1e-5); k++) { const m = (lo + hi) / 2, fm = f(m); if ((fm > 0) === (flo > 0)) { lo = m; flo = fm; } else hi = m; } return (lo + hi) / 2; }

// ================================================================ fixed inputs: regulation (kind "regulation") and assumptions
const REG = {
  min_mass_q_kg: 726,            // C4.1 (qualifying, excl. Nominal Tyre Mass)
  mguk_max_dc_kw: 350,           // C5.2.7
  fuel_flow_max_mj_h: 3000,      // C5.2.3 (and EF = 0.27·N + 165 MJ/h below 10 500 rpm)
  es_soc_window_mj: 4,           // C5.2.9
  recharge_q_silverstone_mj: 6.5,// FIA British GP PU information (Q/SQ)
  wheelbase_max_m: 3.4,          // C2.3.3
  rim_diameter_mm: 463,          // C10.7.2
};
// Mass: 726 kg + Nominal Tyre Mass (44 kg, implied by the reported 768 kg race minimum; not in Section C) + Red Bull's reported
// +9/10 kg over the minimum (RacingNews365, April; grid-2026.json) + qualifying fuel (assumption: ~5 kg on a flying lap).
const BASE = {
  mass_kg: 726 + 44 + 9.5, fuel_kg: 5, mass_sd_kg: 10,
  r_eff_m: 0.348, r_sd_m: 0.006,     // rolling radius: 18 in rim, ~707 mm 2026 tyre (press, unverified), minus ~6 mm loaded deflection/3
  I_wheels_kgm2: 4.0, I_engine_kgm2: 0.03, // rotating inertia (assumption)
  eta_dt: 0.95, eta_k: 0.95, crr: 0.012,   // driveline efficiency, MGU-K DC<->shaft efficiency, rolling resistance (assumptions)
  eta_th: 0.475, eta_th_sd: 0.025,         // ICE fuel-to-crank efficiency (assumption band 0.45-0.50 -> 375-417 kW; the fuel flow it multiplies is regulated)
  alpha_slip_rad: 0.08,                    // tyre slip angle at the lateral limit, for cornering drag (assumption)
  tau_s: 0.3,                              // x/y smoothing time constant (method choice; varied 0.2-0.4)
  aero_balance_front: 0.43,                // front share of downforce (assumption; not separable from these data)
  weight_front: 0.45,                      // static front axle share (C4.2 bounds: front >= 0.44, rear >= 0.54 of the minimum)
  cog_height_m: 0.28, wheelbase_m: 3.4, track_front_m: 1.58, track_rear_m: 1.52,
  k_top_phases: 3,                         // CdA anchor: mean of the top-3 per-straight peak deployments = 350 kW (method choice)
};
const kTaper = vkmh => Math.max(0, Math.min(REG.mguk_max_dc_kw, vkmh < 340 ? 1800 - 5 * vkmh : vkmh < 345 ? 6900 - 20 * vkmh : 0)); // C5.2.8 i
const fuelFlowKW = rpm => (rpm >= 10500 ? 3000 : Math.max(0, 0.27 * rpm + 165)) / 3.6; // C5.2.3/C5.2.4
const mEff = (c, G) => c.mass_kg + c.fuel_kg + c.I_wheels_kgm2 / c.r_eff_m ** 2 + (c.I_engine_kgm2 * G * G) / c.r_eff_m ** 2;
const mTot = c => c.mass_kg + c.fuel_kg;

// ================================================================ air density during the lap (weather samples)
function airDensity(utcIso, durS) {
  const t0 = Date.parse(utcIso), t1 = t0 + durS * 1000, idx = [];
  WEATHER.date_utc.forEach((d, i) => { const t = Date.parse(d); if (t >= t0 - 90e3 && t <= t1 + 90e3) idx.push(i); });
  if (!idx.length) idx.push(WEATHER.date_utc.length - 1);
  const T = mean(idx.map(i => WEATHER.air_temperature[i])), p = mean(idx.map(i => WEATHER.pressure[i])) * 100, rh = mean(idx.map(i => WEATHER.humidity[i])) / 100;
  const pv = rh * 610.94 * Math.exp((17.625 * T) / (T + 243.04)), Tk = T + 273.15; // Magnus
  return { rho: (p - pv) / (287.058 * Tk) + pv / (461.495 * Tk), air_c: T, pressure_hpa: p / 100, humidity_pct: rh * 100, wind_ms: mean(idx.map(i => WEATHER.wind_speed[i])), samples: idx.length };
}

// ================================================================ lap loading and signal conditioning
function lapFiles() { return fs.readdirSync(TEL).filter(f => /^silverstone-2026-q-[a-z]{3}\.json$/.test(f) && !/index|weather/.test(f)).map(f => f.slice(19, 22).toUpperCase()); }
function loadLap(code, tau) {
  const f = path.join(TEL, `silverstone-2026-q-${code.toLowerCase()}.json`);
  if (!fs.existsSync(f)) return null;
  const raw = readJSON(f), c = raw.channels, n = c.distance_m.length;
  const L = { code: raw.driver.code, team: raw.driver.team, lap_time_s: raw.lap.lap_time_s, sector_s: raw.lap.sector_s, speed_trap_kmh: raw.lap.speed_trap_kmh, n, file: path.basename(f) };
  L.s = c.distance_m; L.t = c.time_s; L.v = c.speed_kmh.map(x => x / 3.6); L.thr = c.throttle_pct; L.brk = c.brake.map(b => !!b);
  L.gear = c.gear; L.rpm = c.rpm; L.x = c.x_m; L.y = c.y_m;
  const k1 = kinematics(L.t, L.v, 0.45); L.vs = k1.v; L.a = k1.a;
  L.kappa = curvature(L, tau || BASE.tau_s, 6);
  L.ay = L.kappa.map((k, i) => L.vs[i] ** 2 * Math.abs(k));
  L.air = airDensity(raw.lap.date_start_utc, raw.lap.lap_time_s);
  L.cornerIdx = CIRCUIT.corners.map(cn => { let b = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.hypot(L.x[i] - cn.x_m, L.y[i] - cn.y_m); if (d < bd) { bd = d; b = i; } } return b; });
  L.zone = straightModeZones(L);
  return L;
}
// local quadratic regression of speed against time (h = half window, s): smoothed speed and acceleration. The 5 m grid is a
// linear-in-time interpolation of ~3.7 Hz samples, so a plain finite difference would return a staircase.
function kinematics(t, v, h) {
  const n = t.length, vo = new Array(n), ao = new Array(n);
  for (let i = 0; i < n; i++) {
    const S = [0, 0, 0, 0, 0], T = [0, 0, 0];
    const acc = j => { const x = t[j] - t[i], y = v[j]; let p = 1; for (let k = 0; k < 5; k++) { S[k] += p; if (k < 3) T[k] += p * y; p *= x; } };
    for (let j = i; j >= 0 && t[i] - t[j] <= h; j--) acc(j);
    for (let j = i + 1; j < n && t[j] - t[i] <= h; j++) acc(j);
    const beta = solve([[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]], T);
    vo[i] = beta[0]; ao[i] = beta[1];
  }
  return { v: vo, a: ao };
}
// path curvature from x/y: Gaussian smoothing over max(smin, tau·v) metres (the location feed is ~3.9 Hz, so raw spacing grows
// with speed), then κ = (x'y'' − y'x'')/(x'² + y'²)^1.5. The lap is closed, so the window wraps.
function curvature(L, tau, smin) {
  const n = L.n;
  const sm = a => { const o = new Array(n); for (let i = 0; i < n; i++) { const sg = Math.max(smin, tau * L.v[i]), h = Math.ceil((3 * sg) / 5); let w = 0, z = 0; for (let k = -h; k <= h; k++) { const j = (i + k + n) % n, ww = Math.exp(-0.5 * ((k * 5) / sg) ** 2); w += ww; z += ww * a[j]; } o[i] = z / w; } return o; };
  const x = sm(L.x), y = sm(L.y), k = new Array(n);
  for (let i = 0; i < n; i++) { const a = (i - 1 + n) % n, b = (i + 1) % n, dx = (x[b] - x[a]) / 2, dy = (y[b] - y[a]) / 2, ddx = x[b] - 2 * x[i] + x[a], ddy = y[b] - 2 * y[i] + y[a]; k[i] = (dx * ddy - dy * ddx) / Math.pow(dx * dx + dy * dy, 1.5); }
  return k;
}
// Straight Mode (active aero) zones: activation points from the FIA event map (silverstone-2026-weekend.json); a zone ends at the
// first lift (< 95 %) or brake, or 50 m before the next point above 4 g lateral (Abbey after A1). The map does not print zone ends.
const ZONES = [{ zone: "A1", after: 18, m: 65, endBefore: 1, endOffset: -100 }, { zone: "A2", after: 5, m: 55, endBefore: 6, endOffset: 0 }, { zone: "A3", after: 7, m: 155, endBefore: 9, endOffset: 0 }, { zone: "A4", after: 14, m: 65, endBefore: 15, endOffset: 0 }];
function straightModeZones(L) {
  const z = new Array(L.n).fill(false), n = L.n; L.zones = [];
  for (const a of ZONES) {
    const ci = CIRCUIT.corners.findIndex(c => c.number === a.after), start = (L.cornerIdx[ci] + Math.round(a.m / 5)) % n; let k = 0;
    while (k < n) { const j = (start + k) % n; if (L.thr[j] < 95 || L.brk[j]) break; if (k > 10 && L.ay[(j + 10) % n] > 4 * G0) break; z[j] = true; k++; }
    L.zones.push({ zone: a.zone, start_idx: start, start_m: L.s[start], end_m: L.s[(start + k) % n], length_m: k * 5 });
  }
  return z;
}
// geometric zone flags for the simulator (no throttle needed): activation point to the next corner marker (+ offset)
function geomZones(L) {
  const z = new Array(L.n).fill(false), n = L.n;
  for (const a of ZONES) {
    const s0 = (L.cornerIdx[CIRCUIT.corners.findIndex(c => c.number === a.after)] + Math.round(a.m / 5)) % n;
    const e = (L.cornerIdx[CIRCUIT.corners.findIndex(c => c.number === a.endBefore)] + Math.round(a.endOffset / 5) + n) % n;
    for (let k = s0; k !== e; k = (k + 1) % n) z[k] = true;
  }
  return z;
}
const CORNER_NAMES = { 1: "Abbey", 2: "Farm", 3: "Village", 4: "The Loop", 5: "Aintree", 6: "Brooklands", 7: "Luffield", 8: "Woodcote", 9: "Copse", 10: "Maggotts", 11: "Maggotts", 12: "Becketts", 13: "Becketts", 14: "Chapel", 15: "Stowe", 16: "Vale", 17: "Vale-Club", 18: "Club" };
function nearestCorner(L, i) { let b = 0, bd = 1e9; L.cornerIdx.forEach((ci, k) => { const d = Math.abs(L.s[ci] - L.s[i]); if (d < bd) { bd = d; b = k; } }); const c = CIRCUIT.corners[b]; return `T${c.number} ${CORNER_NAMES[c.number]}`; }

// ================================================================ 1. gearing
function gearing(laps, c) {
  const per = {}, shifts = [], downs = []; let rpmMax = 0, rpmMaxAt = null;
  for (const L of laps) for (let i = 3; i < L.n - 3; i++) {
    const g = L.gear[i];
    if (L.rpm[i] > rpmMax) { rpmMax = L.rpm[i]; rpmMaxAt = { code: L.code, s_m: L.s[i], gear: g, kmh: rnd(L.v[i] * 3.6, 1) }; }
    if (g >= 1 && L.gear[i - 2] === g && L.gear[i + 2] === g && L.rpm[i] > 6000 && !L.brk[i]) (per[g] = per[g] || []).push(L.v[i] / ((L.rpm[i] * 2 * Math.PI) / 60));
    if (L.gear[i] > L.gear[i - 1] && L.gear[i - 1] > 0) { let r = 0; for (let j = i - 1; j >= 0 && L.t[i] - L.t[j] <= 0.4; j--) r = Math.max(r, L.rpm[j]); shifts.push({ from: L.gear[i - 1], rpm: r }); }
    if (L.gear[i] < L.gear[i - 1] && L.gear[i] > 0) downs.push(L.rpm[i]);
  }
  const gears = Object.keys(per).map(Number).sort((a, b) => a - b);
  const rows = gears.map(g => {
    const k = median(per[g]), sem = (quantile(per[g], 0.75) - quantile(per[g], 0.25)) / 1.349 / Math.sqrt(per[g].length);
    const G = c.r_eff_m / k, Gsd = G * Math.hypot((3 * sem) / k, c.r_sd_m / c.r_eff_m);
    return { gear: g, samples: per[g].length, kmh_per_1000rpm: rnd(k * (1000 * 2 * Math.PI / 60) * 3.6, 3), v_over_omega_m: rnd(k, 5), overall_ratio: rnd(G, 3), overall_ratio_sd: rnd(Gsd, 3), overall_ratio_sd_excl_radius: rnd(G * 3 * sem / k, 3) };
  });
  const up = shifts.filter(s => s.from >= 2).map(s => s.rpm);
  return { rows, gears_used: gears, top_gear: Math.max(...gears), rev_max_rpm: rpmMax, rev_max_at: rpmMaxAt, shift_rpm: { median: Math.round(median(up)), p10: Math.round(quantile(up, 0.1)), p90: Math.round(quantile(up, 0.9)), n: up.length }, downshift_rpm_median: downs.length ? Math.round(median(downs)) : null };
}

// ================================================================ 4. cornering
// corners where the car slows to a minimum (grip-limited) + flat-out corners (full throttle: a lower bound on the limit)
function cornerPoints(L) {
  const pts = [], n = L.n;
  for (let i = 8; i < n - 8; i++) {
    let isMin = true; for (let j = i - 8; j <= i + 8; j++) if (L.vs[j] < L.vs[i] - 1e-9) { isMin = false; break; }
    if (!isMin) continue;
    let vb = 0, va = 0; for (let j = Math.max(0, i - 80); j < i; j++) vb = Math.max(vb, L.vs[j]); for (let j = i + 1; j < Math.min(n, i + 40); j++) va = Math.max(va, L.vs[j]);
    if (vb - L.vs[i] < 15 / 3.6 || va - L.vs[i] < 5 / 3.6) continue;
    // the simulator's corner limit is set by the largest |κ| near the apex, so the fit uses the same quantity:
    // a_y = v_min² · max|κ| within ±40 m of the speed minimum (consistent fit and simulation, same smoothing)
    let km = 0; for (let j = i - 8; j <= i + 8; j++) km = Math.max(km, Math.abs(L.kappa[j]));
    const ay = L.vs[i] ** 2 * km;
    if (ay < 1.5 * G0) continue;
    if (pts.length && L.s[i] - pts[pts.length - 1].s < 60) continue;
    pts.push({ kind: "limit", s: L.s[i], kmh: L.vs[i] * 3.6, v: L.vs[i], ay, R_m: 1 / km, thr: L.thr[i], corner: nearestCorner(L, i) });
  }
  for (let i = 6; i < n - 6; i++) {
    if (L.thr[i] < 98 || L.ay[i] < 3 * G0) continue;
    let peak = true; for (let j = i - 6; j <= i + 6; j++) if (L.ay[j] > L.ay[i]) peak = false;
    if (peak) pts.push({ kind: "flat", s: L.s[i], kmh: L.vs[i] * 3.6, v: L.vs[i], ay: L.ay[i], thr: L.thr[i], corner: nearestCorner(L, i) });
  }
  return pts;
}
// a_y = μ_y·(g + ½ρ·ClA·v²/m): linear in (μ_y, μ_y·ClA)
function fitCornering(pts, m, rho) {
  const lim = pts.filter(p => p.kind === "limit");
  const f = lsq(lim.map(p => [G0, (0.5 * rho * p.v * p.v) / m]), lim.map(p => p.ay));
  const mu = f.beta[0], cla = f.beta[1] / mu;
  const cov = f.cov, dC_db0 = -f.beta[1] / mu ** 2, dC_db1 = 1 / mu; // delta method
  const claSe = Math.sqrt(Math.max(0, dC_db0 ** 2 * cov[0][0] + dC_db1 ** 2 * cov[1][1] + 2 * dC_db0 * dC_db1 * cov[0][1]));
  return { mu_y: mu, mu_y_se: f.se[0], ClA: cla, ClA_se: claSe, rms_g: f.rms / G0, n: lim.length };
}
const ayMax = (car, v, rho) => car.mu_y * (G0 + (0.5 * rho * car.ClA * v * v) / mTot(car));

// ================================================================ 2. power, MGU-K deployment and drag
// P_wheel = m_eff·v·a + ½ρ·CdA·v³ + Crr·m·g·v + m·a_y·tan(α)·v ;  P_crank = P_wheel/η_dt ;  P_ICE = η_th·EF(rpm) ;
// K_shaft = P_crank − P_ICE ;  K_DC = K_shaft/η_K (deploy) or K_shaft·η_K (harvest). Grade = 0 (no elevation channel).
function slipDrag(car, ay, v, rho) { const r = Math.min(1, ay / ayMax(car, v, rho)); return mTot(car) * ay * Math.tan(car.alpha_slip_rad * r); }
function powerTrace(L, car) {
  const rho = L.air.rho, out = [];
  for (let i = 0; i < L.n; i++) {
    const v = L.vs[i], G = (car.r_eff_m * (L.rpm[i] * 2 * Math.PI)) / 60 / Math.max(v, 1), cda = L.zone[i] ? car.CdA_s : car.CdA_c;
    const Pw = mEff(car, G) * v * L.a[i] + 0.5 * rho * cda * v ** 3 + car.crr * mTot(car) * G0 * v + slipDrag(car, L.ay[i], v, rho) * v;
    const Pc = Pw / car.eta_dt, Pice = car.eta_th * fuelFlowKW(L.rpm[i]) * 1000, Ks = Pc - Pice, Kdc = Ks > 0 ? Ks / car.eta_k : Ks * car.eta_k;
    // the ±0.45 s speed fit reaches into the next brake zone, so the last 0.45 s before a lift/brake is not clean
    let near = false; for (let j = i + 1; j < L.n && L.t[j] - L.t[i] <= 0.45; j++) if (L.thr[j] < 99 || L.brk[j]) { near = true; break; }
    out.push({ i, s: L.s[i], v, kmh: v * 3.6, rpm: L.rpm[i], full: L.thr[i] >= 99 && !L.brk[i], clean: !near, zone: L.zone[i], ay: L.ay[i], a: L.a[i], Pw: Pw / 1e3, Pc: Pc / 1e3, Pice: Pice / 1e3, Kdc: Kdc / 1e3, dt: i ? L.t[i] - L.t[i - 1] : 0 });
  }
  return out;
}
// per-straight peak deployment: each full-throttle run, 25 m running median of K_DC below 285 km/h (where the 350 kW cap is flat)
function phasePeaks(tr) {
  const runs = []; let cur = null;
  for (const p of tr) { if (p.full) { if (!cur) { cur = []; runs.push(cur); } cur.push(p); } else cur = null; }
  return runs.filter(r => r.length >= 10).map(r => {
    const pts = r.filter(p => p.kmh < 285 && p.kmh > 120 && p.i > 6 && p.i < tr.length - 6), med = [];
    for (let k = 2; k < pts.length - 2; k++) med.push({ K: median(pts.slice(k - 2, k + 3).map(p => p.Kdc)), s: pts[k].s, kmh: pts[k].kmh });
    if (!med.length) return null;
    const top = med.reduce((a, b) => (b.K > a.K ? b : a));
    return { s0: r[0].s, s1: r[r.length - 1].s, peak_kw: top.K, at_s: top.s, at_kmh: top.kmh };
  }).filter(Boolean);
}
// CdA anchor: in a qualifying lap the MGU-K is assumed to reach its 350 kW cap on the best few corner exits. Given η_th (fuel
// flow is regulated), solve CdA_c (with CdA_s = CdA_c − ΔCdA) so that the mean of the top-N per-straight peaks equals 350 kW.
function solveCdA(L, car) {
  const f = cdac => { const c = Object.assign({}, car, { CdA_c: cdac, CdA_s: cdac - car.dCdA_straight }); const pk = phasePeaks(powerTrace(L, c)).map(p => p.peak_kw).sort((a, b) => b - a); return mean(pk.slice(0, car.k_top_phases)) - REG.mguk_max_dc_kw; };
  return bisect(f, 0.3, 2.5);
}
// Straight Mode drag step: at each activation point the PU output does not change, so a step in the apparent power
// (m_eff·v·a + ½ρ·v³·CdA_ref + losses) across the flap opening is −ΔCdA·½ρv³. Measured on every lap in the folder, zones A2-A4.
function straightModeStep(laps, car) {
  const rows = [];
  for (const L of laps) {
    const tr = powerTrace(L, Object.assign({}, car, { CdA_c: 1, CdA_s: 1 }));
    for (const z of L.zones) {
      if (z.zone === "A1") continue; // A1 activation sits 85 m before the lap line: the pre-window spans two different laps
      const i0 = z.start_idx, t0 = L.t[i0], pre = [], post = [];
      // windows: 1.0-0.15 s before, 0.35-1.2 s after (the flaps take a few tenths); points above 1.5 g lateral are left out
      // because their slip drag is modelled, not measured
      for (let j = Math.max(0, i0 - 40); j < Math.min(L.n, i0 + 60); j++) { const dt = L.t[j] - t0; if (tr[j].ay > 1.5 * G0) continue; if (dt > -1.0 && dt < -0.15) pre.push(tr[j]); if (dt > 0.35 && dt < 1.2) post.push(tr[j]); }
      if (pre.length < 3 || post.length < 3 || pre.some(p => !p.full) || post.some(p => !p.full)) continue;
      const vm = mean(pre.concat(post).map(p => p.v));
      rows.push({ code: L.code, zone: z.zone, kmh: vm * 3.6, dCdA: ((mean(post.map(p => p.Pw)) - mean(pre.map(p => p.Pw))) * 1e3) / (0.5 * L.air.rho * vm ** 3) });
    }
  }
  const d = rows.map(r => r.dCdA);
  return { dCdA: mean(d), se: sd(d) / Math.sqrt(d.length), sd: sd(d), n: d.length, rows, by_zone: ["A2", "A3", "A4"].map(z => { const a = rows.filter(r => r.zone === z).map(r => r.dCdA); return { zone: z, mean: rnd(mean(a), 3), sd: rnd(sd(a), 3), n: a.length }; }) };
}
// ES energy over the lap at full throttle (DC side), clipping signature (speed falling at 100 % throttle on a straight)
function energy(L, car) {
  const tr = powerTrace(L, car); let dep = 0, harvFT = 0, tBrake = 0, tFull = 0; const clips = []; let cl = null;
  for (const p of tr) {
    if (L.brk[p.i]) tBrake += p.dt;
    if (!p.full || !p.clean) { cl = null; continue; }
    tFull += p.dt;
    if (p.Kdc > 0) dep += p.Kdc * p.dt; else harvFT += -p.Kdc * p.dt;
    const clip = p.a < -0.3 && p.ay < 1.0 * G0 && p.kmh > 200;
    if (clip) { if (!cl) { cl = { s0: p.s, kmh0: p.kmh, Kmin: p.Kdc, n: 0 }; clips.push(cl); } cl.s1 = p.s; cl.kmh1 = p.kmh; cl.n++; cl.Kmin = Math.min(cl.Kmin, p.Kdc); } else cl = null;
  }
  // brake-phase harvest bound: 350 kW DC for the braking time above 100 km/h (upper bound; actual depends on brake-by-wire split)
  let tBr100 = 0; for (const p of tr) if (L.brk[p.i] && p.kmh > 100) tBr100 += p.dt;
  return { deploy_mj: dep / 1e3, harvest_full_throttle_mj: harvFT / 1e3, brake_time_s: tBrake, brake_harvest_bound_mj: (REG.mguk_max_dc_kw * tBr100) / 1e3, full_throttle_time_s: tFull, clips: clips.filter(c => c.n >= 4).map(c => ({ from_m: c.s0, to_m: c.s1, kmh_from: rnd(c.kmh0, 1), kmh_to: rnd(c.kmh1, 1), k_dc_min_kw: rnd(c.Kmin, 0) })) };
}

// ================================================================ 3. braking: fit μ_x to the speed-vs-distance trace of each brake zone
// decel = [ sqrt((μ_x·N)² − (m·a_y)²) + ½ρ·CdA_c·v² + Crr·m·g ] / (m + I_w/r²),  N = m·g + ½ρ·ClA·v²   (friction circle)
function brakeZones(L) {
  const zs = []; let i = 0;
  while (i < L.n) {
    if (!L.brk[i]) { i++; continue; }
    let j = i; while (j < L.n && L.brk[j]) j++;
    const vin = Math.max(...L.vs.slice(Math.max(0, i - 3), i + 1)); let im = i; for (let k = i; k < Math.min(L.n, j + 20); k++) if (L.vs[k] < L.vs[im]) im = k;
    const vmin = L.vs[im];
    if (vin * 3.6 > 140 && (vin - vmin) * 3.6 > 50) {
      let i1 = i; while (i1 < L.n && L.t[i1] - L.t[i] < 0.25) i1++;
      let i2 = i1; while (i2 < im && L.vs[i2] > vmin + 0.3 * (vin - vmin)) i2++;
      if (i2 - i1 >= 4) zs.push({ i0: i, i1, i2, im, s0: L.s[i], entry_kmh: vin * 3.6, min_kmh: vmin * 3.6, corner: nearestCorner(L, im) });
    }
    i = j;
  }
  return zs;
}
function brakeSim(L, z, car, mux, cdac) {
  const rho = L.air.rho, m = mTot(car), mb = m + car.I_wheels_kgm2 / car.r_eff_m ** 2; let v = L.vs[z.i1], sse = 0; const vm = [v];
  for (let k = z.i1; k < z.i2; k++) {
    const q = 0.5 * rho * v * v, N = m * G0 + q * car.ClA, Fy = m * L.ay[k], Fx = Math.sqrt(Math.max(0, (mux * N) ** 2 - Fy * Fy));
    const a = (Fx + q * cdac + car.crr * m * G0) / mb, v2 = v * v - 2 * a * (L.s[k + 1] - L.s[k]);
    v = Math.sqrt(Math.max(1, v2)); vm.push(v); sse += (v - L.vs[k + 1]) ** 2;
  }
  return { sse, vm };
}
function fitBraking(L, car) {
  const zs = brakeZones(L);
  const per = zs.map(z => { const mu = golden(m => brakeSim(L, z, car, m, car.CdA_c).sse, 0.8, 3.5); return Object.assign({}, z, { mu_x: mu, rms_kmh: Math.sqrt(brakeSim(L, z, car, mu, car.CdA_c).sse / (z.i2 - z.i1)) * 3.6 }); });
  const all = m => zs.reduce((s, z) => s + brakeSim(L, z, car, m, car.CdA_c).sse, 0);
  const mu = golden(all, 0.8, 3.5), npts = zs.reduce((s, z) => s + z.i2 - z.i1, 0);
  // joint (μ_x, CdA_c) grid, to show what braking alone says about drag
  let best = { sse: Infinity }; for (let cd = 0.4; cd <= 2.4001; cd += 0.05) { const m2 = golden(x => zs.reduce((s, z) => s + brakeSim(L, z, car, x, cd).sse, 0), 0.8, 3.5, 1e-3); const e = zs.reduce((s, z) => s + brakeSim(L, z, car, m2, cd).sse, 0); if (e < best.sse) best = { sse: e, mu_x: m2, CdA_c: cd }; }
  return { mu_x: mu, mu_x_sd_zones: sd(per.map(p => p.mu_x)), rms_kmh: Math.sqrt(all(mu) / npts) * 3.6, zones: per, joint: best };
}

// ================================================================ the derived car (one pass, given assumptions in `opts`)
function derive(opts) {
  const car = Object.assign({}, BASE, opts || {});
  const laps = (car.laps || lapFiles()).map(c => loadLap(c, car.tau_s)).filter(Boolean);
  const L = laps.find(l => l.code === (car.fit_code || "HAD"));
  // 4. cornering first (μ_y, ClA): needed by the slip-drag and friction-circle terms
  const cp = cornerPoints(L), fc = fitCornering(cp, mTot(car), L.air.rho);
  car.mu_y = fc.mu_y; car.ClA = fc.ClA;
  // 2a. Straight Mode step (all laps) -> ΔCdA; 2b. CdA_c from the 350 kW deployment anchor
  if (car.dCdA_straight == null) { const st = straightModeStep(laps, Object.assign({}, car, { CdA_c: 1.1, CdA_s: 1.1 })); car.dCdA_straight = st.dCdA; car._step = st; }
  car.CdA_c = car.CdA_c_fixed != null ? car.CdA_c_fixed : solveCdA(L, car); car.CdA_s = car.CdA_c - car.dCdA_straight;
  // 3. braking μ_x with ClA and CdA_c known
  const fb = fitBraking(L, car); car.mu_x = fb.mu_x;
  return { car, L, laps, cp, fc, fb };
}

// ================================================================ QSS lap simulator (speeds come from physics only)
// track: the lap's own smoothed curvature κ(s) (same smoothing as the fit), geometric Straight Mode zones. Max-performance lap:
// corner limit from μ_y and ClA; forward pass power (ICE at fuel-flow × η_th, MGU-K per `strategy`, optimal gear) and rear-axle
// traction; backward pass braking on the friction circle in Corner Mode; periodic (flying lap).
function simulate(L, car, gr, strategy) {
  const n = L.n, rho = L.air.rho, m = mTot(car), zone = geomZones(L), ds = i => (i < n - 1 ? L.s[i + 1] - L.s[i] : L.s[1] - L.s[0]);
  const ratios = gr.rows.map(r => r.overall_ratio), rpmMax = gr.shift_rpm.p90;
  const vC = L.kappa.map(k => { const kk = Math.abs(k), den = kk - (car.mu_y * 0.5 * rho * car.ClA) / m; return den <= 0 ? 400 / 3.6 : Math.min(400 / 3.6, Math.sqrt((car.mu_y * G0) / den)); });
  const aymax = v => ayMax(car, v, rho);
  const latUse = (i, v) => Math.min(0.999, (v * v * Math.abs(L.kappa[i])) / aymax(v));
  const pIce = v => { let best = 0, bg = ratios[ratios.length - 1]; for (const G of ratios) { const rpm = (v * G * 60) / (2 * Math.PI * car.r_eff_m); if (rpm > rpmMax + 50) continue; const p = car.eta_th * fuelFlowKW(rpm) * 1000; if (p > best) { best = p; bg = G; } } if (!best) { const G = ratios[ratios.length - 1]; best = car.eta_th * fuelFlowKW((v * G * 60) / (2 * Math.PI * car.r_eff_m)) * 1000; } return { p: best, G: bg }; };
  const kDC = (i, v) => { const s = strategy(i, v); return Math.max(-REG.mguk_max_dc_kw, Math.min(kTaper(v * 3.6), s)); };
  const fwdAcc = (i, v) => {
    const q = 0.5 * rho * v * v, cda = zone[i] ? car.CdA_s : car.CdA_c, ice = pIce(v), K = kDC(i, v), Ks = K > 0 ? K * car.eta_k : K / car.eta_k;
    const Pw = car.eta_dt * (ice.p + Ks * 1000), u = latUse(i, v), ay = v * v * Math.abs(L.kappa[i]);
    const hL = car.cog_height_m / car.wheelbase_m, Nr = (1 - car.weight_front) * m * G0 + (1 - car.aero_balance_front) * q * car.ClA * (zone[i] ? car.CdA_s / car.CdA_c : 1);
    const Ftr = (car.mu_x * Nr * Math.sqrt(1 - u * u)) / (1 - car.mu_x * hL);
    const Fp = Pw / Math.max(v, 5), F = Math.min(Fp, Ftr) - q * cda - car.crr * m * G0 - slipDrag(car, ay, v, rho);
    // MGU-K power actually used: all of K when power-limited; when traction-limited only what tops the ICE up to the grip limit
    let Kused = K; if (Ftr < Fp && K > 0) { const need = (Ftr * Math.max(v, 5)) / car.eta_dt - ice.p; Kused = need > 0 ? Math.min(K, need / 1000 / car.eta_k) : 0; }
    return { a: F / mEff(car, ice.G), K: Kused, trac: Ftr < Fp };
  };
  const brkAcc = (i, v) => { const q = 0.5 * rho * v * v, N = m * G0 + q * car.ClA, u = latUse(i, v); return (car.mu_x * N * Math.sqrt(1 - u * u) + q * car.CdA_c + car.crr * m * G0) / (m + car.I_wheels_kgm2 / car.r_eff_m ** 2); };
  // forward (two laps for periodicity)
  const vf = new Array(n); let v = vC[0];
  const kUsed = new Array(n).fill(0), trac = new Array(n).fill(false);
  for (let lap = 0; lap < 2; lap++) for (let i = 0; i < n; i++) { v = Math.min(v, vC[i]); vf[i] = v; const r = fwdAcc(i, v); kUsed[i] = r.K; trac[i] = r.trac; v = Math.sqrt(Math.max(1, v * v + 2 * r.a * ds(i))); }
  const vb = new Array(n); v = vC[n - 1];
  for (let lap = 0; lap < 2; lap++) for (let i = n - 1; i >= 0; i--) { v = Math.min(v, vC[i]); vb[i] = v; const a = brkAcc(i, v); v = Math.sqrt(v * v + 2 * a * ds(i > 0 ? i - 1 : n - 1)); }
  const vs = vf.map((x, i) => Math.min(x, vb[i], vC[i]));
  let t = 0; const tt = [0]; for (let i = 0; i < n - 1; i++) { t += (L.s[i + 1] - L.s[i]) / ((vs[i] + vs[i + 1]) / 2); tt.push(t); }
  let dep = 0, harv = 0; for (let i = 0; i < n - 1; i++) if (vs[i] === vf[i] && vf[i] < vC[i]) { const K = kUsed[i], dt = tt[i + 1] - tt[i]; if (K > 0) dep += K * dt; else harv -= K * dt; }
  return { v: vs, t: tt, lap_time_s: t, deploy_mj: dep / 1e3, harvest_drive_mj: harv / 1e3, vC, limit: vs.map((x, i) => (x === vC[i] ? "corner" : x === vb[i] ? "brake" : trac[i] ? "traction" : "power")) };
}
// deployment strategies (team-level unknowns, measured on the fit lap)
function profileStrategy(L, car) { // K_DC by lap fraction where the fit lap was at full throttle, else 0 (ICE only: lift, brake, part throttle)
  const tr = powerTrace(L, car), n = L.n, sm = new Array(n);
  for (let i = 0; i < n; i++) { const w = []; for (let k = -2; k <= 2; k++) { const p = tr[(i + k + n) % n]; if (p.full && p.clean) w.push(p.Kdc); } sm[i] = tr[i].full && w.length ? median(w) : null; }
  for (let i = 1; i < n; i++) if (tr[i].full && !tr[i].clean && sm[i - 1] != null) sm[i] = sm[i - 1]; // hold the last clean value up to the lift
  const frac = L.s.map(s => s / L.s[n - 1]);
  const at = f => { let lo = 0, hi = n - 1; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (frac[md] <= f) lo = md; else hi = md; } return sm[lo]; };
  return { kdc_by_index: sm, forLap: T => { const N = T.s[T.n - 1]; return (i, v) => { const k = at(T.s[i] / N); return k == null ? 0 : k; }; } };
}
function speedMap(L, car) { // median K_DC at full throttle by 10 km/h bin
  const tr = powerTrace(L, car).filter(p => p.full && p.clean && p.i > 6), bins = {};
  for (const p of tr) { const b = Math.floor(p.kmh / 10) * 10; (bins[b] = bins[b] || []).push(p.Kdc); }
  return Object.keys(bins).map(Number).sort((a, b) => a - b).filter(b => bins[b].length >= 4).map(b => ({ kmh: b + 5, kdc_kw: rnd(median(bins[b]), 1), n: bins[b].length }));
}
function compareTrace(L, sim) {
  const d = L.vs.map((v, i) => (sim.v[i] - v) * 3.6), mins = cornerPoints(L).filter(p => p.kind === "limit").map(p => { const i = L.s.indexOf(p.s); let j = i; for (let k = Math.max(0, i - 6); k <= Math.min(L.n - 1, i + 6); k++) if (sim.v[k] < sim.v[j]) j = k; return { corner: p.corner, real_kmh: rnd(p.kmh, 1), sim_kmh: rnd(sim.v[j] * 3.6, 1) }; });
  const vmaxR = Math.max(...L.vs) * 3.6, vmaxS = Math.max(...sim.v) * 3.6;
  return { lap_time_real_s: L.lap_time_s, lap_time_sim_s: rnd(sim.lap_time_s, 3), delta_s: rnd(sim.lap_time_s - L.lap_time_s, 3), delta_pct: rnd((100 * (sim.lap_time_s - L.lap_time_s)) / L.lap_time_s, 2), speed_rms_kmh: rnd(Math.sqrt(mean(d.map(x => x * x))), 1), speed_bias_kmh: rnd(mean(d), 1), vmax_real_kmh: rnd(vmaxR, 1), vmax_sim_kmh: rnd(vmaxS, 1), corner_minima: mins, sim_deploy_mj: rnd(sim.deploy_mj, 2), sim_harvest_drive_mj: rnd(sim.harvest_drive_mj, 2), sim_time_share: Object.fromEntries(["corner", "brake", "traction", "power"].map(k => [k, rnd(sim.limit.reduce((a, x, i) => a + (x === k && i < sim.t.length - 1 ? sim.t[i + 1] - sim.t[i] : 0), 0) / sim.lap_time_s, 3)])) };
}

// ================================================================ main
function main() {
  const write = process.argv.includes("--write");
  const codes = lapFiles(); const log = (...a) => console.log(...a);
  log(`laps in ${path.relative(ROOT, TEL)}: ${codes.join(" ")}`);
  const D = derive({ laps: codes });
  const { car, L, laps, cp, fc, fb } = D;
  const gr = gearing(laps.filter(l => l.team === L.team), car);
  const st = car._step;
  // uncertainty: re-derive with one assumption moved at a time (± its band), collect the spread
  const PERT = [
    ["eta_th", { eta_th: 0.45 }, { eta_th: 0.50 }], ["mass", { mass_kg: car.mass_kg - 10 }, { mass_kg: car.mass_kg + 10 }],
    ["xy smoothing tau", { tau_s: 0.2 }, { tau_s: 0.4 }], ["slip angle", { alpha_slip_rad: 0.04 }, { alpha_slip_rad: 0.12 }],
    ["driveline eff", { eta_dt: 0.93 }, { eta_dt: 0.97 }], ["deploy anchor top-N", { k_top_phases: 2 }, { k_top_phases: 4 }],
    ["dCdA straight", { dCdA_straight: st.dCdA - 2 * st.se }, { dCdA_straight: st.dCdA + 2 * st.se }],
  ];
  const keys = ["CdA_c", "CdA_s", "ClA", "mu_y", "mu_x"], sens = {};
  for (const [name, lo, hi] of PERT) {
    const a = derive(Object.assign({ laps: codes, dCdA_straight: car.dCdA_straight }, lo)).car, b = derive(Object.assign({ laps: codes, dCdA_straight: car.dCdA_straight }, hi)).car;
    sens[name] = Object.fromEntries(keys.map(k => [k, [rnd(a[k] - car[k], 3), rnd(b[k] - car[k], 3)]]));
  }
  const stat = { ClA: fc.ClA_se, mu_y: fc.mu_y_se, mu_x: fb.mu_x_sd_zones / Math.sqrt(fb.zones.length), CdA_c: 0, CdA_s: st.se };
  const unc = Object.fromEntries(keys.map(k => [k, Math.sqrt(stat[k] ** 2 + Object.values(sens).reduce((s, r) => s + (Math.max(Math.abs(r[k][0]), Math.abs(r[k][1]))) ** 2, 0))]));
  const en = energy(L, car), peaks = phasePeaks(powerTrace(L, car));

  log("\n== air", JSON.stringify(Object.fromEntries(Object.entries(L.air).map(([k, v]) => [k, rnd(v, 4)]))));
  log("== gearing", JSON.stringify(gr));
  log("== cornering", JSON.stringify({ mu_y: rnd(fc.mu_y, 3), ClA: rnd(fc.ClA, 3), rms_g: rnd(fc.rms_g, 3), n: fc.n }));
  cp.forEach(p => log(`   ${p.kind.padEnd(5)} ${p.corner.padEnd(16)} ${String(rnd(p.s, 0)).padStart(5)} m ${rnd(p.kmh, 1)} km/h  ${rnd(p.ay / G0, 2)} g  thr ${p.thr}`));
  log("== straight-mode step", JSON.stringify({ dCdA: rnd(st.dCdA, 3), se: rnd(st.se, 3), n: st.n, by_zone: st.by_zone }));
  log("== CdA", rnd(car.CdA_c, 3), rnd(car.CdA_s, 3), "peaks", JSON.stringify(peaks.map(p => [rnd(p.s0, 0), rnd(p.peak_kw, 0), rnd(p.at_kmh, 0)])));
  log("== braking", JSON.stringify({ mu_x: rnd(fb.mu_x, 3), rms_kmh: rnd(fb.rms_kmh, 2), joint: fb.joint, zones: fb.zones.map(z => [z.corner, rnd(z.entry_kmh, 0), rnd(z.mu_x, 2), rnd(z.rms_kmh, 1)]) }));
  log("== energy", JSON.stringify(en));
  log("== sensitivity", JSON.stringify(sens));
  log("== uncertainty (1 sigma-ish)", JSON.stringify(Object.fromEntries(Object.entries(unc).map(([k, v]) => [k, rnd(v, 3)]))));

  // ---------------- validation
  const prof = profileStrategy(L, car);
  const simFit = simulate(L, car, gr, prof.forLap(L)), cmpFit = compareTrace(L, simFit);
  const simFitMap = (() => { const map = speedMap(L, car); const f = v => { const k = v * 3.6; let b = map[0]; for (const r of map) if (Math.abs(r.kmh - k) < Math.abs(b.kmh - k)) b = r; return b.kdc_kw; }; return simulate(L, car, gr, (i, v) => f(v)); })();
  log("== sim HAD (deploy profile)", JSON.stringify(cmpFit));
  // lap-time sensitivity of the simulation to each derived parameter (+1 sd)
  const lapSens = {}; for (const k of keys) { const c2 = Object.assign({}, car, { [k]: car[k] + unc[k] }); if (k === "CdA_c") c2.CdA_s = car.CdA_s + unc[k]; lapSens[k] = { plus_1sd: rnd(unc[k], 3), lap_delta_s: rnd(simulate(L, c2, gr, prof.forLap(L)).lap_time_s - simFit.lap_time_s, 3) }; }
  { // η_th moves CdA with it (the 350 kW anchor), so re-derive the car rather than moving η_th alone
    const d2 = derive({ laps: codes, eta_th: car.eta_th + car.eta_th_sd, dCdA_straight: car.dCdA_straight }).car;
    lapSens.eta_th_with_CdA_rederived = { plus_1sd: car.eta_th_sd, CdA_c: rnd(d2.CdA_c, 3), lap_delta_s: rnd(simulate(L, d2, gr, profileStrategy(L, d2).forLap(L)).lap_time_s - simFit.lap_time_s, 3) };
  }
  log("== lap-time sensitivity", JSON.stringify(lapSens));
  log("== sim HAD (speed map)", JSON.stringify(compareTrace(L, simFitMap)));
  const held = [];
  for (const T of laps) {
    if (T.code === L.code) continue;
    const sameCar = T.team === L.team;
    let c2 = car, refit = [];
    if (!sameCar) { // team-level unknowns refit on that lap: ClA, μ_y (its corners), CdA_c (350 kW anchor, PU frozen), μ_x (its brakes)
      const d2 = derive({ laps: codes, fit_code: T.code, dCdA_straight: car.dCdA_straight });
      c2 = Object.assign({}, car, { ClA: d2.car.ClA, mu_y: d2.car.mu_y, CdA_c: d2.car.CdA_c, CdA_s: d2.car.CdA_s, mu_x: d2.car.mu_x }); refit = ["ClA", "mu_y", "CdA_c", "CdA_s", "mu_x"];
    }
    const sim = simulate(T, c2, gr, prof.forLap(T)), cmp = compareTrace(T, sim);
    const simRB = sameCar ? null : simulate(T, car, gr, prof.forLap(T));
    held.push(Object.assign({ code: T.code, team: T.team, pu: /Racing Bulls|Red Bull/.test(T.team) ? "Red Bull Ford DM01" : "other", same_car: sameCar, refit, params: sameCar ? null : Object.fromEntries(refit.map(k => [k, rnd(c2[k], 3)])), redbull_car_on_this_line_s: simRB ? rnd(simRB.lap_time_s, 3) : null }, cmp, { trace: sim }));
    log(`== held-out ${T.code} (${T.team})`, JSON.stringify(Object.assign({}, held[held.length - 1], { trace: undefined, corner_minima: undefined })));
  }
  if (write) writeOutputs({ car, L, laps, gr, cp, fc, fb, st, en, peaks, sens, unc, prof, simFit, cmpFit, simFitMap, held, codes, lapSens });
}

// ================================================================ outputs
function writeOutputs(R) {
  const { car, L, gr, fc, fb, st, en, peaks, sens, unc, prof, simFit, cmpFit, held } = R;
  const rho = L.air.rho, iceAt = rpm => rnd(car.eta_th * fuelFlowKW(rpm), 1);
  const bal = car.aero_balance_front, claTot = car.ClA, claS = car.ClA; // straight-mode downforce not measured (see doc)
  const kd = (kind, basis, extra) => Object.assign({ kind, basis }, extra || {});
  const pc = {
    id: "redbull-rb22-dm01-silverstone-2026-q",
    session: "qualifying",
    label: "Red Bull RB22 / Red Bull Ford DM01, Silverstone 2026 qualifying: derived from telemetry (inverse vehicle dynamics), see docs/concept/REDBULL-DERIVED.md",
    mass_kg: rnd(car.mass_kg, 1), fuel_kg: car.fuel_kg,
    wheelbase_m: car.wheelbase_m, track_front_m: car.track_front_m, track_rear_m: car.track_rear_m, cog_height_m: car.cog_height_m, weight_dist_front: car.weight_front,
    aero: {
      corner: { CLA_front_m2: rnd(claTot * bal, 3), CLA_rear_m2: rnd(claTot * (1 - bal), 3), CDA_m2: rnd(car.CdA_c, 3) },
      straight: { CLA_front_m2: rnd(claS * bal, 3), CLA_rear_m2: rnd(claS * (1 - bal), 3), CDA_m2: rnd(car.CdA_s, 3) },
      ride_height_mm: null, ride_sens_per_mm: 0, floor_stalled: false, stall_margin_mm: null,
    },
    pu: { ice_kw: iceAt(10500), mguk_kw: REG.mguk_max_dc_kw, es_deploy_mj_per_lap: rnd(en.deploy_mj, 2), es_harvest_mj_per_lap: REG.recharge_q_silverstone_mj },
    tyres: { mu_x: rnd(car.mu_x, 3), mu_y: rnd(car.mu_y, 3), load_sens: 0, radius_m: car.r_eff_m, compound: "soft" },
    brakes: { max_decel_g_mech: rnd(car.mu_x, 3) },
    drivetrain_eff: car.eta_dt,
    calibration: { cla_scale: 1, cda_scale: 1, power_scale: 1, mu_scale: 1 },
  };
  const U = (v, u, d) => ({ value: rnd(v, d || 3), sd: rnd(u, d || 3), interval_2sd: [rnd(v - 2 * u, d || 3), rnd(v + 2 * u, d || 3)] });
  const fields = {
    mass_kg: kd("regulation+reported+assumption", "C4.1 726 kg + Nominal Tyre Mass 44 kg (implied by the reported 768 kg race minimum) + Red Bull +9.5 kg reported over the minimum (RacingNews365, April 2026); fuel separate", { sd: 10 }),
    fuel_kg: kd("assumption", "qualifying flying-lap fuel, ~5 kg"),
    wheelbase_m: kd("regulation", "C2.3.3 maximum 3.400 m (RB22 assumed at the maximum)"),
    track_front_m: kd("assumption", "PhysicalCar REF value"), track_rear_m: kd("assumption", "PhysicalCar REF value"),
    cog_height_m: kd("assumption", "0.28 m above the ground (plank and ride height included, as in the current PhysicalCar contract); typical value, not observable from speed/position telemetry. Used only for longitudinal load transfer in the traction limit"),
    session: kd("regulation", "qualifying: C4.1 minimum 726 kg + Nominal Tyre Mass, Silverstone Q recharge 6.5 MJ"),
    "aero.floor_stalled": kd("assumption", "false: the measured lateral and braking performance shows no sign of a stalled floor; not observable directly"),
    "aero.stall_margin_mm / ride_height_mm": kd("assumption", "null: ride height is not in the public feed"),
    weight_dist_front: kd("regulation+assumption", "C4.2: front >= 0.44, rear >= 0.54 of the minimum mass; 0.45 assumed"),
    "aero.corner.CLA_total": kd("derived-from-telemetry", "cornering: a_y = μ_y(g + ½ρClA v²/m) at grip-limited corner minima", U(fc.ClA, unc.ClA)),
    "aero.corner.balance_front": kd("assumption", "front share 0.43 (not separable: speed + x/y carry no axle information)"),
    "aero.corner.CDA_m2": kd("derived-from-telemetry", "power balance with the MGU-K reaching its 350 kW cap on the best corner exits and ICE = η_th × regulated fuel flow", U(car.CdA_c, unc.CdA_c)),
    "aero.straight.CDA_m2": kd("derived-from-telemetry", "CdA_c − ΔCdA, ΔCdA from the acceleration step at Straight Mode activation over all laps (zones A2-A4 where both windows stay below 1.5 g lateral: in practice A3, plus one A4)", U(car.CdA_s, unc.CdA_s)),
    "aero.straight.CLA": kd("assumption", "not measured (no cornering in Straight Mode); set equal to Corner Mode, which is an upper bound"),
    "pu.ice_kw": kd("regulation+assumption", `η_th ${car.eta_th} ± ${car.eta_th_sd} × 833.3 kW fuel energy flow (C5.2.3) at >= 10 500 rpm`, U(car.eta_th * 833.33, car.eta_th_sd * 833.33, 1)),
    "pu.mguk_kw": kd("regulation", "C5.2.7 350 kW DC, taper 1800 − 5v kW (C5.2.8)"),
    "pu.es_deploy_mj_per_lap": kd("derived-from-telemetry", "∫K_DC dt over full-throttle phases where K_DC > 0"),
    "pu.es_harvest_mj_per_lap": kd("regulation", "Silverstone qualifying recharge limit 6.5 MJ/lap (FIA PU information)"),
    "tyres.mu_x": kd("derived-from-telemetry", "fit of the speed-vs-distance trace in each brake zone (friction circle)", U(car.mu_x, unc.mu_x)),
    "tyres.mu_y": kd("derived-from-telemetry", "cornering fit", U(car.mu_y, unc.mu_y)),
    "tyres.load_sens": kd("assumption", "0: μ values are effective values at the loads seen on this lap"),
    "tyres.radius_m": kd("assumption", "18 in rim (C10.7.2) + ~707 mm 2026 tyre (press, unverified), loaded rolling radius", { sd: car.r_sd_m }),
    drivetrain_eff: kd("assumption", "0.95; degenerate with η_th for the ICE term"),
    "brakes.max_decel_g_mech": kd("derived-from-telemetry", "= μ_x (brakes are tyre-limited)"),
  };
  const out = {
    _meta: {
      what: "Red Bull RB22 / Red Bull Ford DM01 physical parameters derived from real qualifying telemetry (Silverstone 2026) by inverse vehicle dynamics, for PURPLE's physics lap simulator. Speeds in the simulator must come from these parameters; telemetry is used only to measure what is not public and for held-out checks.",
      generated_by: "concept/tools/derive-car.js --write", doc: "docs/concept/REDBULL-DERIVED.md", built: "2026-10-24",
      inputs: ["concept/data/telemetry/ (OpenF1, session 11322)", "concept/data/regs-2026-key.json", "concept/data/silverstone-2026-weekend.json", "concept/data/grid-2026.json"],
      telemetry_dir: path.relative(ROOT, TEL).startsWith("..") ? "external copy of concept/data/telemetry (22 qualifying laps, telemetry commit bae7a51)" : path.relative(ROOT, TEL),
      laps_used: R.codes, fit_lap: { code: L.code, lap_time_s: L.lap_time_s, file: L.file },
      units: "SI (m, kg, s, W expressed as kW where the key says kw, J as MJ where the key says mj)",
      kinds: { regulation: "FIA 2026 rules value", "derived-from-telemetry": "measured here, with sd", assumption: "not observable from these data; value stated, varied in the sensitivity runs where it matters" },
    },
    physical_car: pc,
    fields,
    air: Object.fromEntries(Object.entries(L.air).map(([k, v]) => [k, rnd(v, 4)])),
    gearing: { ratios: gr.rows.map(r => r.overall_ratio), ratios_sd: gr.rows.map(r => r.overall_ratio_sd), gears: gr.rows.map(r => r.gear), detail: gr.rows, rolling_radius_m: car.r_eff_m, rev_limit_rpm: gr.rev_max_rpm, rev_limit_note: "highest rpm seen on the Red Bull laps (observed, not the regulation limit)", rev_max_at: gr.rev_max_at, shift_rpm: gr.shift_rpm.median, shift_rpm_band: [gr.shift_rpm.p10, gr.shift_rpm.p90], downshift_rpm_median: gr.downshift_rpm_median, gears_used: gr.gears_used, top_gear: gr.top_gear, note: "gear 1 is not used on a flying lap; 8 forward gears seen" },
    pu_curve: {
      ice_kw_vs_rpm: [8000, 8500, 9000, 9500, 10000, 10500, 11000, 11500, 12000, 12500].map(r => ({ rpm: r, kw: iceAt(r) })),
      ice_basis: "η_th × fuel energy flow limit (C5.2.3: 3000 MJ/h at >= 10 500 rpm; 0.27·N + 165 MJ/h below)",
      eta_th: car.eta_th, eta_th_sd: car.eta_th_sd,
      mguk_max_dc_kw_vs_kmh: [0, 100, 200, 280, 290, 300, 310, 320, 330, 340, 345].map(v => ({ kmh: v, kw: kTaper(v) })),
      mguk_deployment_peaks: peaks.map(p => ({ straight_from_m: rnd(p.s0, 0), straight_to_m: rnd(p.s1, 0), peak_dc_kw: rnd(p.peak_kw, 0), at_kmh: rnd(p.at_kmh, 0) })),
      mguk_dc_kw_vs_kmh_full_throttle: speedMap(L, car),
      mguk_dc_kw_vs_distance: L.s.filter((_, i) => i % 4 === 0).map((s, k) => ({ s_m: s, kdc_kw: rnd(prof.kdc_by_index[k * 4], 0) })),
      energy: { deploy_mj: rnd(en.deploy_mj, 2), harvest_full_throttle_mj: rnd(en.harvest_full_throttle_mj, 2), brake_harvest_bound_mj: rnd(en.brake_harvest_bound_mj, 2), recharge_limit_mj: REG.recharge_q_silverstone_mj, soc_window_mj: REG.es_soc_window_mj, deploy_ceiling_mj: REG.recharge_q_silverstone_mj + REG.es_soc_window_mj, full_throttle_time_s: rnd(en.full_throttle_time_s, 1), brake_time_s: rnd(en.brake_time_s, 1) },
      clipping_segments: en.clips,
    },
    straight_mode_step: { dCdA_m2: rnd(st.dCdA, 3), se: rnd(st.se, 3), sd_per_lap_zone: rnd(st.sd, 3), n: st.n, by_zone: st.by_zone },
    corners: R.cp.map(p => ({ kind: p.kind, corner: p.corner, s_m: rnd(p.s, 0), min_kmh: rnd(p.kmh, 1), ay_g: rnd(p.ay / G0, 2), model_ay_g: rnd(ayMax(car, p.v, rho) / G0, 2), throttle_pct: p.thr })),
    brake_zones: fb.zones.map(z => ({ corner: z.corner, from_m: rnd(z.s0, 0), entry_kmh: rnd(z.entry_kmh, 0), min_kmh: rnd(z.min_kmh, 0), mu_x: rnd(z.mu_x, 3), rms_kmh: rnd(z.rms_kmh, 2) })),
    braking_joint_fit: { mu_x: rnd(fb.joint.mu_x, 3), CdA_c: rnd(fb.joint.CdA_c, 2), note: "braking alone cannot separate μ_x·ClA from CdA: the joint fit runs to the edge of its CdA grid (2.4 m²). Drag is 10-20 % of the deceleration, inside the noise of the 3.7 Hz trace. Shown as a check only" },
    residuals: {
      cornering_rms_g: rnd(fc.rms_g, 3), braking_speed_rms_kmh: rnd(fb.rms_kmh, 2),
      sim_fit_lap: Object.assign({}, cmpFit),
      sim_fit_lap_speed_map_strategy: compareTrace(L, R.simFitMap),
    },
    sensitivity: sens,
    lap_time_sensitivity_fit_lap: R.lapSens,
    uncertainty_sd: Object.fromEntries(Object.entries(unc).map(([k, v]) => [k, rnd(v, 3)])),
    held_out: held.map(h => Object.assign({}, h, { trace: undefined })),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 1) + "\n");
  console.log("wrote", path.relative(ROOT, OUT_JSON));
  writePlots(R);
}

// ================================================================ SVG plots (light/dark aware, no dependencies)
function svgChart({ title, xlab, ylab, xr, yr, series, w, h, notes }) {
  w = w || 720; h = h || 380; const ml = 64, mr = 16, mt = 36, mb = 48, pw = w - ml - mr, ph = h - mt - mb;
  const X = x => ml + ((x - xr[0]) / (xr[1] - xr[0])) * pw, Y = y => mt + ph - ((y - yr[0]) / (yr[1] - yr[0])) * ph;
  const ticks = (r, n) => { const step = niceStep((r[1] - r[0]) / n), out = []; for (let v = Math.ceil(r[0] / step) * step; v <= r[1] + 1e-9; v += step) out.push(rnd(v, 6)); return out; };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="12">\n<style>.bg{fill:#fff}.fg{fill:#1b1b1f}.mut{fill:#6b6b76}.grid{stroke:#e4e4ea}.ax{stroke:#9a9aa5}@media (prefers-color-scheme:dark){.bg{fill:#16161a}.fg{fill:#ececf1}.mut{fill:#a0a0ab}.grid{stroke:#2c2c33}.ax{stroke:#5a5a64}}</style>\n<rect class="bg" width="${w}" height="${h}"/>\n<text class="fg" x="${ml}" y="22" font-size="14" font-weight="600">${esc(title)}</text>\n`;
  for (const t of ticks(xr, 8)) s += `<line class="grid" x1="${X(t)}" x2="${X(t)}" y1="${mt}" y2="${mt + ph}"/><text class="mut" x="${X(t)}" y="${mt + ph + 16}" text-anchor="middle">${t}</text>\n`;
  for (const t of ticks(yr, 6)) s += `<line class="grid" x1="${ml}" x2="${ml + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="mut" x="${ml - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>\n`;
  s += `<line class="ax" x1="${ml}" x2="${ml + pw}" y1="${mt + ph}" y2="${mt + ph}"/><line class="ax" x1="${ml}" x2="${ml}" y1="${mt}" y2="${mt + ph}"/>\n`;
  s += `<text class="mut" x="${ml + pw / 2}" y="${h - 10}" text-anchor="middle">${esc(xlab)}</text><text class="mut" transform="translate(16 ${mt + ph / 2}) rotate(-90)" text-anchor="middle">${esc(ylab)}</text>\n`;
  const clipY = y => Math.max(yr[0], Math.min(yr[1], y));
  let lx = ml + 8; const ly = mt + 10;
  for (const se of series) {
    if (se.type === "line") { const d = se.pts.filter(p => p[1] != null && isFinite(p[1])).map((p, k) => `${k ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(clipY(p[1])).toFixed(1)}`).join(""); s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width || 1.8}"${se.dash ? ` stroke-dasharray="${se.dash}"` : ""}/>\n`; }
    else for (const p of se.pts) if (p[1] >= yr[0] && p[1] <= yr[1] && p[0] >= xr[0] && p[0] <= xr[1]) s += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${se.r || 2.2}" fill="${se.color}" fill-opacity="${se.opacity || 0.75}"/>\n`;
    if (se.label) { s += `<rect x="${lx}" y="${ly - 8}" width="12" height="${se.type === "line" ? 3 : 8}" fill="${se.color}"/><text class="fg" x="${lx + 16}" y="${ly}">${esc(se.label)}</text>\n`; lx += 22 + se.label.length * 6.4; }
  }
  (notes || []).forEach((t, k) => { s += `<text class="mut" x="${ml + pw - 4}" y="${mt + ph - 8 - k * 15}" text-anchor="end">${esc(t)}</text>\n`; });
  return s + "</svg>\n";
}
const niceStep = r => { const p = 10 ** Math.floor(Math.log10(r)), f = r / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };
const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const C1 = "#2a6fdb", C2 = "#e0662f", C3 = "#2f9e6a", C4 = "#8a5cd1", C5 = "#9a9aa5";
function writePlots(R) {
  const { car, L, cp, fb, simFit, held } = R; const rho = L.air.rho;
  fs.mkdirSync(OUT_SVG, { recursive: true });
  const tr = powerTrace(L, car).filter(p => p.full && p.clean && p.i > 6 && p.ay < 1.5 * G0);
  const vs = []; for (let k = 140; k <= 320; k += 2) vs.push(k);
  const iceLine = vs.map(k => [k, (car.eta_dt * car.eta_th * 833.33)]), totLine = vs.map(k => [k, car.eta_dt * (car.eta_th * 833.33 + car.eta_k * kTaper(k))]);
  fs.writeFileSync(path.join(OUT_SVG, "power-vs-speed.svg"), svgChart({ title: `HAD full-throttle wheel power vs speed (CdA corner ${rnd(car.CdA_c, 2)}, straight ${rnd(car.CdA_s, 2)} m²)`, xlab: "speed, km/h", ylab: "power at the wheels, kW", xr: [140, 320], yr: [0, 800],
    series: [{ type: "dot", pts: tr.filter(p => !p.zone).map(p => [p.kmh, p.Pw]), color: C1, label: "Corner Mode" }, { type: "dot", pts: tr.filter(p => p.zone).map(p => [p.kmh, p.Pw]), color: C2, label: "Straight Mode" }, { type: "line", pts: totLine, color: C3, label: "ICE + MGU-K max (1800 − 5v taper)" }, { type: "line", pts: iceLine, color: C5, dash: "5 4", label: "ICE only" }],
    notes: ["points below the ICE line at full throttle = MGU-K harvesting (clipping)"] }));
  const trr = powerTrace(L, car).filter(p => p.full && p.clean && p.i > 6 && p.ay < 1.5 * G0 && p.rpm > 8000), rpms = []; for (let r = 8000; r <= 12500; r += 50) rpms.push(r);
  fs.writeFileSync(path.join(OUT_SVG, "power-vs-rpm.svg"), svgChart({ title: "HAD full-throttle crank power vs engine speed", xlab: "engine speed, rpm", ylab: "power at the crank (wheel power / η_dt), kW", xr: [8000, 12500], yr: [0, 900],
    series: [{ type: "dot", pts: trr.map(p => [p.rpm, p.Pc]), color: C1, label: "measured" }, { type: "line", pts: rpms.map(r => [r, car.eta_th * fuelFlowKW(r)]), color: C5, dash: "5 4", label: `ICE: ${car.eta_th} × fuel-flow limit` }, { type: "line", pts: rpms.map(r => [r, car.eta_th * fuelFlowKW(r) + car.eta_k * REG.mguk_max_dc_kw]), color: C3, label: "ICE + 350 kW MGU-K" }] }));
  const kd = powerTrace(L, car);
  fs.writeFileSync(path.join(OUT_SVG, "mguk-vs-distance.svg"), svgChart({ title: "HAD MGU-K electrical power along the lap (full throttle only; + deploy, − harvest)", xlab: "distance, m", ylab: "MGU-K DC power, kW", xr: [0, 5850], yr: [-500, 450], w: 900,
    series: [{ type: "dot", pts: kd.filter(p => p.full && p.clean && p.i > 6).map(p => [p.s, p.Kdc]), color: C1, r: 1.8, label: "derived K_DC" }, { type: "line", pts: kd.map(p => [p.s, kTaper(p.kmh)]), color: C3, width: 1.2, label: "regulated maximum at that speed" }, { type: "line", pts: [[0, 0], [5850, 0]], color: C5, width: 1, dash: "3 3" }] }));
  // decel vs speed: measured along brake zones (5 m points) vs model (straight line, Corner Mode)
  const bpts = []; for (const z of fb.zones) for (let k = z.i1; k <= z.i2; k++) bpts.push([L.vs[k] * 3.6, -L.a[k] / G0]);
  const m = mTot(car), dline = []; for (let k = 80; k <= 320; k += 4) { const v = k / 3.6, q = 0.5 * rho * v * v; dline.push([k, (car.mu_x * (m * G0 + q * car.ClA) + q * car.CdA_c + car.crr * m * G0) / (m + car.I_wheels_kgm2 / car.r_eff_m ** 2) / G0]); }
  fs.writeFileSync(path.join(OUT_SVG, "decel-vs-speed.svg"), svgChart({ title: `HAD braking deceleration vs speed (μx ${rnd(car.mu_x, 2)}, ClA ${rnd(car.ClA, 2)} m²)`, xlab: "speed, km/h", ylab: "deceleration, g", xr: [80, 320], yr: [0, 6],
    series: [{ type: "dot", pts: bpts, color: C1, label: "measured (fit window of each zone)" }, { type: "line", pts: dline, color: C2, label: "model, straight-line limit" }], notes: ["measured decel is smoothed over ±0.45 s and includes the lateral share in curved zones"] }));
  const lline = []; for (let k = 60; k <= 320; k += 4) lline.push([k, ayMax(car, k / 3.6, rho) / G0]);
  fs.writeFileSync(path.join(OUT_SVG, "lateral-vs-speed.svg"), svgChart({ title: `HAD lateral acceleration vs speed (μy ${rnd(car.mu_y, 2)}, ClA ${rnd(car.ClA, 2)} m²)`, xlab: "speed, km/h", ylab: "lateral acceleration, g", xr: [60, 320], yr: [0, 7],
    series: [{ type: "dot", pts: cp.filter(p => p.kind === "limit").map(p => [p.v * 3.6, p.ay / G0]), color: C1, r: 4, label: "corner minima (fit)" }, { type: "dot", pts: cp.filter(p => p.kind === "flat").map(p => [p.v * 3.6, p.ay / G0]), color: C2, r: 4, label: "flat-out corners (lower bound)" }, { type: "line", pts: lline, color: C3, label: "μy(g + ½ρClA v²/m)" }] }));
  const series = [{ type: "line", pts: L.s.map((s, i) => [s, L.vs[i] * 3.6]), color: C1, label: `HAD real ${L.lap_time_s.toFixed(3)} s` }, { type: "line", pts: L.s.map((s, i) => [s, simFit.v[i] * 3.6]), color: C2, label: `sim ${simFit.lap_time_s.toFixed(3)} s`, width: 1.4 }];
  fs.writeFileSync(path.join(OUT_SVG, "sim-vs-real-had.svg"), svgChart({ title: "HAD speed trace: real vs QSS simulation with the derived parameters", xlab: "distance, m", ylab: "speed, km/h", xr: [0, 5850], yr: [60, 340], w: 900, series }));
  for (const h of held.filter(h => h.code === "VER" || h.code === "LAW")) {
    const T = R.laps.find(l => l.code === h.code);
    fs.writeFileSync(path.join(OUT_SVG, `sim-vs-real-${h.code.toLowerCase()}.svg`), svgChart({ title: `${h.code} (${h.team}) held out: real vs QSS simulation${h.same_car ? " (all parameters from HAD)" : " (PU from HAD; aero and grip refit)"}`, xlab: "distance, m", ylab: "speed, km/h", xr: [0, 5850], yr: [60, 340], w: 900,
      series: [{ type: "line", pts: T.s.map((s, i) => [s, T.vs[i] * 3.6]), color: C1, label: `${h.code} real ${T.lap_time_s.toFixed(3)} s` }, { type: "line", pts: T.s.map((s, i) => [s, h.trace.v[i] * 3.6]), color: C2, label: `sim ${h.trace.lap_time_s.toFixed(3)} s`, width: 1.4 }] }));
  }
  console.log("wrote", path.relative(ROOT, OUT_SVG) + "/*.svg");
}

module.exports = { loadLap, derive, simulate, gearing, cornerPoints, fitCornering, powerTrace, phasePeaks, energy, fitBraking, straightModeStep, kTaper, fuelFlowKW, BASE, REG, lapFiles };
if (require.main === module) main();
