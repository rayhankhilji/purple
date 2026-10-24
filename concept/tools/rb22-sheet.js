#!/usr/bin/env node
// PURPLE concept - the Red Bull RB22 / Red Bull Ford DM01 data sheet (docs/concept/RB22_SHEET.md).
//
//   node concept/tools/rb22-sheet.js            print the summary table and the sim check
//   node concept/tools/rb22-sheet.js --write    regenerate concept/data/rb22-sheet.json
//   node concept/tools/rb22-sheet.js --check    exit 1 if the committed sheet is stale (telemetry block or sim check)
//
// One entry per quantity: { id, group, label, value, unit, sd_or_range, kind, sources[], derivation, used_by[] }.
// kind: regulation | official | reported | derived (from public telemetry, method stated) | fitted (a model estimate made
// elsewhere in this repo) | estimate (judgement, with a range; nothing public).
//
// Telemetry part: every Red Bull Racing lap in concept/data/telemetry (OpenF1; qualifying at 9 circuits, HAD / VER / LAW per
// the event's line-up, plus the 8 Silverstone race laps), with the audit policy of concept/identify/data.js (FAIL laps or
// channels excluded). Sim check: every input of the physics sim's RB22 (concept/sim baselineCar("redbull"), its MODEL constants
// and default conditions) is compared with the sheet: equal, within the sheet's sd, mapped (an effective model value with a
// documented scale mapping), or contradiction (reported, with the lap-time effect of using the sheet value instead).
// Deterministic: no randomness, no network. Node only. Reads concept/sim and concept/identify; changes neither.
"use strict";
const fs = require("fs"), path = require("path");
const D = require("../identify/data.js");
const ROOT = path.join(__dirname, "..", ".."), OUT = path.join(ROOT, "concept", "data", "rb22-sheet.json");
const G0 = 9.80665;
const { median, quantile, mad, mean } = D;
const r = (x, d) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** (d == null ? 3 : d)) / 10 ** (d == null ? 3 : d));
const robustSd = a => (a.length > 2 ? mad(a) : a.length === 2 ? Math.abs(a[0] - a[1]) / Math.SQRT2 : null);
const stat = (a, d) => (a.length ? { median: r(median(a), d), sd: r(robustSd(a), d), p10: r(quantile(a, 0.1), d), p90: r(quantile(a, 0.9), d), n: a.length } : { median: null, sd: null, p10: null, p90: null, n: 0 });

// ================================================================ assumptions used by the telemetry analysis (method choices)
const A = {
  mass_kg: 775, fuel_kg: 6,          // the sheet's own mass and Q fuel (entries mass.car_no_fuel, mass.fuel_q); race laps: + race fuel
  race_fuel_kg: 25,                  // race laps 40-45 of 52 (fuel ~ 70 kg at the start, ~1.3 kg/lap): estimate, used only for P_kin of race laps
  rot_mass_factor: 1.03,             // as concept/sim (MODEL.rot_mass_factor)
  r_eff_m: 0.348,                    // loaded rolling radius (overall-ratio conversion only; km/h per 1000 rpm does not use it)
  cda_corner_m2: 1.20, cda_straight_m2: 0.95, crr: 0.012, // the sheet's effective drag (entries aero.cda_*_effective) for P_wheel only
  clip: { min_kmh: 180, max_lat_g: 1.0, a_max_ms2: -0.15, min_pts: 3 },
  brake: { min_entry_kmh: 120, min_drop_kmh: 40 },
  lat_bands: [[50, 100], [100, 150], [150, 200], [200, 250], [250, 330]],
  acc_bands: [[60, 100], [100, 150], [150, 200], [200, 250], [250, 300], [300, 350]],
};
// Brembo's 2026 simulations, hardest stop per circuit (brembo.com "5 facts" pages / automoto.it for Monza; accessed 2026-10-24)
const BREMBO = {
  silverstone: { corner: "T16 (Brembo numbering)", from: 268, to: 116, g: 3.1, t_s: 2.45, d_m: 125, src: "brembo_uk_2026" },
  austria: { corner: "T1 (Brembo: first corner after the line)", from: 306, to: 149, g: 3.8, t_s: 1.93, d_m: 109, src: "brembo_austria_2026" },
  hungaroring: { corner: "T1", from: 332, to: 99, g: 4.0, t_s: 3.58, d_m: 172, src: "brembo_hungary_2026" },
  monaco: { corner: "Sainte Devote (T1)", from: 276, to: 132, g: 4.0, t_s: 1.67, d_m: 91, src: "brembo_monaco_2026" },
  montreal: { corner: "T13", from: 306, to: 147, g: 3.7, t_s: 1.93, d_m: 114, src: "brembo_canada_2026" },
  monza: { corner: "T1", from: 318, to: 87, g: 3.8, t_s: 3.22, d_m: 153, src: "automoto_monza_2026" },
  singapore: { corner: "T1", from: 298, to: 144, g: 4.0, t_s: 1.9, d_m: 107, src: "brembo_singapore_2026" },
  spa: { corner: "T1 (La Source)", from: 285, to: 86, g: 3.6, t_s: 3.32, d_m: 145, src: "brembo_belgium_2026" },
};
const SILVERSTONE_NAMES = { 1: "Abbey", 2: "Farm", 3: "Village", 4: "The Loop", 5: "Aintree", 6: "Brooklands", 7: "Luffield", 8: "Woodcote", 9: "Copse", 10: "Maggotts", 11: "Maggotts", 12: "Becketts", 13: "Becketts", 14: "Chapel", 15: "Stowe", 16: "Vale", 17: "Club", 18: "Club" };

// ================================================================ lap loading
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/), split = line => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0]); return lines.slice(1).map(l => { const c = split(l), o = {}; head.forEach((h, i) => { o[h] = c[i]; }); return o; });
}
let RACE_AUDIT = null;
function raceAudit() {
  if (RACE_AUDIT) return RACE_AUDIT;
  RACE_AUDIT = {};
  for (const row of parseCSV(fs.readFileSync(path.join(D.TEL, "audit", "telemetry_audit.csv"), "utf8"))) if (row.session === "race-lap") RACE_AUDIT[row.file] = row;
  return RACE_AUDIT;
}
// race laps: the same policy as concept/identify/data.js lapPolicy (only FAILs act), read from the race-lap audit rows
function racePolicy(file) {
  const row = raceAudit()[file], p = { file, status: row ? row.overall : "n/a", exclude: !row, actions: row ? [] : ["not in the audit: excluded"], use: { corners: !!row, power: !!row, brakes: !!row } };
  if (!row) return p;
  for (const c of ["C1", "C2", "C5", "C6"]) if (row[c] === "FAIL") { p.exclude = true; p.actions.push(c + " FAIL: lap excluded"); }
  if (row.C3 === "FAIL") { if (+row.raw_brake_bad > 0) { p.use.brakes = false; p.actions.push("C3 FAIL raw brake 104: brake channel excluded"); } else { p.exclude = true; p.actions.push("C3 FAIL: lap excluded"); } }
  if (row.C4 === "FAIL") { if (+row.speed_jumps_25 >= 5) { p.exclude = true; p.actions.push("C4 FAIL speed jumps: lap excluded"); } if (+row.accel_viol_total > 10) { p.use.power = false; p.use.brakes = false; p.actions.push("C4 FAIL accel: longitudinal channel excluded"); } }
  if (p.exclude) p.use = { corners: false, power: false, brakes: false };
  return p;
}
// a race lap on the same footing as D.loadLap (masks, kinematics, curvature); air density from the FIA race weather report
function loadRaceLap(file) {
  const raw = D.readJSON(path.join(D.TEL, file)), ch = raw.channels, n = ch.distance_m.length, pol = racePolicy(file);
  const L = { cid: "silverstone", session: "R", code: raw.driver.code, team: D.TEAM_BY_NAME[raw.driver.team], file, n, lap_time_s: raw.lap.lap_time_s, trap_kmh: raw.lap.speed_trap_kmh, policy: pol, raw };
  L.s = ch.distance_m; L.t = ch.time_s; L.x = ch.x_m; L.y = ch.y_m; L.thr = ch.throttle_pct; L.gear = ch.gear; L.rpm = ch.rpm;
  L.vraw = ch.speed_kmh.map(x => (x == null ? null : x / 3.6));
  L.brk = ch.brake.map(b => (b == null || !pol.use.brakes ? null : !!b));
  L.ok = L.vraw.map((v, i) => v != null && L.thr[i] != null && L.rpm[i] != null && L.gear[i] != null);
  const k1 = D.kinematics(L.t, L.ok.map((o, i) => (o ? L.vraw[i] : null)), 0.45); L.vs = k1.v; L.a = k1.a; L.aok = k1.aok;
  for (let i = 0; i < n; i++) if (L.a[i] != null && (L.a[i] > 1.8 * G0 || L.a[i] < -6.5 * G0)) L.aok[i] = false;
  const vEst = L.s.map((s, i) => { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); return Math.max(10, (L.s[b] - L.s[a]) / Math.max(1e-3, L.t[b] - L.t[a])); });
  L.kappa = D.curvature(L.x, L.y, vEst, 0.3, 6);
  L.ay = L.kappa.map((k, i) => (L.vs[i] == null ? null : L.vs[i] ** 2 * Math.abs(k)));
  L.dsok = new Array(n).fill(true);
  // FIA race weather report (concept/data/silverstone-2026-weekend.json, sessions: Race): mid-range air 23.6 C, 1006 hPa, RH 52 %
  const w = raceWeather(); L.air = { rho: w.rho, air_c: w.air_c };
  L.zone = new Array(n).fill(false);
  return L;
}
let RW = null;
function raceWeather() {
  if (RW) return RW;
  const wk = D.readJSON(path.join(ROOT, "concept", "data", "silverstone-2026-weekend.json")), s = (wk.sessions || []).find(x => /race/i.test(x.session || x.name || "") && !/sprint/i.test(x.session || x.name || ""));
  const wx = s && s.weather, mid = o => (o ? (o.min + o.max) / 2 : null);
  const T = mid(wx && wx.air_temp_c) || 23, p = (mid(wx && wx.air_pressure_mbar) || 1007) * 100, rh = (mid(wx && wx.humidity_pct) || 50) / 100;
  const pv = rh * 610.94 * Math.exp((17.625 * T) / (T + 243.04)), Tk = T + 273.15;
  return (RW = { rho: (p - pv) / (287.058 * Tk) + pv / (461.495 * Tk), air_c: T, source: s ? "silverstone-2026-weekend.json sessions[" + (s.session || s.name) + "].weather (FIA)" : "fallback 23 C / 1007 hPa / 50 %" });
}
// every Red Bull Racing lap: qualifying at each circuit (team from the lap file's driver.team, per event) + Silverstone race laps
function redBullLaps() {
  const out = [];
  for (const cid of D.CIRCUIT_IDS) for (const code of D.lapFiles(cid)) {
    const L = D.loadLap(cid, code);
    if (!L || L.team !== "redbull") continue;
    L.session = "Q"; L.raw = D.readJSON(path.join(D.CIRCUITS[cid].dir, L.file)); out.push(L);
  }
  for (const f of fs.readdirSync(D.TEL).filter(f => /^silverstone-2026-r-[a-z]{3}-lap\d+\.json$/.test(f)).sort()) {
    const L = loadRaceLap(f); if (L.team === "redbull") out.push(L);
  }
  return out;
}

// ================================================================ telemetry analyses
// gearing from the raw OpenF1 samples: km/h per 1000 rpm where the gear is steady (same gear on both neighbours), no brake,
// rpm > 6000, speed > 40 km/h. Upshift rpm = rpm of the last sample before a gear increase (gear >= 2); downshift landing rpm =
// rpm of the first sample after a gear decrease while braking.
// laps without raw_car_data (Spa) use the 5 m grid (speed/rpm linear in time, gear zero-order hold) for gearing only
function gearsOf(L) {
  const R = L.raw.raw_car_data || { time_s: L.t, speed_kmh: L.vraw.map(v => (v == null ? null : v * 3.6)), gear: L.gear, rpm: L.rpm, brake: L.brk.map(b => (b ? 100 : 0)), grid: true }, per = {}, ups = [], upsLo = [], upsHi = [], upIdx = [], downs = [];
  const brakeOk = L.policy.use.brakes;
  for (let k = 1; k < R.time_s.length - 1; k++) {
    const g = R.gear[k], v = R.speed_kmh[k], n = R.rpm[k];
    if (g == null || v == null || n == null) continue;
    if (g >= 1 && R.gear[k - 1] === g && R.gear[k + 1] === g && n > 6000 && v > 40 && (!brakeOk || !R.brake[k])) (per[g] = per[g] || []).push(v / (n / 1000));
    if (R.gear[k + 1] != null && R.gear[k + 1] > g && g >= 2 && R.rpm[k] != null) upIdx.push(k);
    if (R.gear[k - 1] != null && g < R.gear[k - 1] && R.rpm[k] != null) downs.push(R.rpm[k]);
  }
  const med = {}; for (const g of Object.keys(per)) if (per[g].length >= 3) med[g] = { kmh_per_1000rpm: median(per[g]), n: per[g].length };
  // the shift falls between two samples: the last sample before it bounds the shift rpm from below; the first sample after it,
  // converted back to the old gear with this lap's ratios (speed only rises in between), bounds it from above; midpoint used
  for (const k of upIdx) {
    const g0 = R.gear[k], g1 = R.gear[k + 1], lo = R.rpm[k];
    if (med[g0] && med[g1] && R.rpm[k + 1] != null && g1 === g0 + 1) { const hi = R.rpm[k + 1] * (med[g1].kmh_per_1000rpm / med[g0].kmh_per_1000rpm); if (hi >= lo) { ups.push((lo + hi) / 2); upsLo.push(lo); upsHi.push(hi); } }
  }
  const rpms = R.rpm.filter(x => x != null), vs = R.speed_kmh.filter(x => x != null);
  if (R.grid) { ups.length = 0; upsLo.length = 0; upsHi.length = 0; downs.length = 0; }   // shift rpm only from raw samples (the grid interpolates rpm across the shift)
  return { med, ups, upsLo, upsHi, downs, rpm_max: Math.max(...rpms), vmax: Math.max(...vs), gears: [...new Set(R.gear.filter(g => g != null))].sort((a, b) => a - b) };
}
// raw brake zones: consecutive samples with the brake on; entry speed = max of the sample before and the onset; minimum = lowest
// speed until 3 samples after release; peak = largest speed drop between two consecutive samples with the brake on (the
// concept/sim BRAKE_TELEMETRY method); peak2 = over a two-interval window (~0.5 s, less sensitive to timestamp jitter);
// mean = (entry - minimum) / (time from onset to the minimum)
function brakeZonesRaw(L) {
  if (!L.policy.use.brakes || !L.raw.raw_car_data) return [];   // no raw samples (Spa): the 5 m grid would smear the peak
  const R = L.raw.raw_car_data, n = R.time_s.length, zs = [];
  for (let k = 1; k < n; k++) {
    if (!(R.brake[k] > 0) || R.brake[k - 1] > 0) continue;
    let e = k; while (e + 1 < n && R.brake[e + 1] > 0) e++;
    const vin = Math.max(R.speed_kmh[k - 1] || 0, R.speed_kmh[k] || 0);
    let im = k; for (let j = k; j <= Math.min(n - 1, e + 3); j++) if (R.speed_kmh[j] != null && R.speed_kmh[j] < R.speed_kmh[im]) im = j;
    const vmin = R.speed_kmh[im];
    if (vin < A.brake.min_entry_kmh || vin - vmin < A.brake.min_drop_kmh) { k = e; continue; }
    let pk = 0, pkv = 0, pk2 = 0;
    for (let j = k + 1; j <= e; j++) {
      const dt = R.time_s[j] - R.time_s[j - 1]; if (!(dt > 0.05)) continue;
      const g = (R.speed_kmh[j - 1] - R.speed_kmh[j]) / 3.6 / dt / G0; if (g > pk) { pk = g; pkv = (R.speed_kmh[j - 1] + R.speed_kmh[j]) / 2; }
      if (j >= k + 2) { const g2 = (R.speed_kmh[j - 2] - R.speed_kmh[j]) / 3.6 / (R.time_s[j] - R.time_s[j - 2]) / G0; if (g2 > pk2) pk2 = g2; }
    }
    const tb = R.time_s[e] - R.time_s[k], tmin = R.time_s[im] - R.time_s[k];
    zs.push({ s_m: r(R.distance_m[k], 0), entry_kmh: vin, min_kmh: vmin, peak_g: pk, peak_at_kmh: pkv, peak2_g: pk2, mean_g: tmin > 0 ? (vin - vmin) / 3.6 / tmin / G0 : null, brake_time_s: tb, brake_dist_m: R.distance_m[e] - R.distance_m[k] });
    k = e;
  }
  return zs;
}
// full-throttle longitudinal acceleration (smoothed, plausibility-masked) with low lateral load (< 1 g), by speed band; kinetic
// power m_eff·a·v (model-free given mass) and the wheel power with the sheet's effective drag (conditional on CdA)
function accelPoints(L) {
  const out = []; if (!L.policy.use.power) return out;
  const m = A.mass_kg + (L.session === "R" ? A.race_fuel_kg : A.fuel_kg), me = m * A.rot_mass_factor, rho = L.air.rho;
  for (let i = 0; i < L.n; i++) {
    if (!L.ok[i] || !L.aok[i] || L.thr[i] < 99 || L.brk[i] === true || L.ay[i] == null || L.ay[i] > 1.0 * G0 || L.dsok[i] === false) continue;
    let good = true; for (let j = i + 1; j < L.n && L.t[j] - L.t[i] <= 0.45; j++) if (!L.ok[j] || L.thr[j] < 99 || L.brk[j] === true) { good = false; break; }
    if (!good) continue;
    const v = L.vs[i], cda = L.zone && L.zone[i] ? A.cda_straight_m2 : A.cda_corner_m2;
    out.push({ kmh: v * 3.6, a: L.a[i], p_kin_kw: (me * L.a[i] * v) / 1e3, p_wheel_kw: (me * L.a[i] * v + 0.5 * rho * cda * v ** 3 + A.crr * m * G0 * v) / 1e3, rpm: L.rpm[i], s: L.s[i] });
  }
  return out;
}
// corner-exit (traction-limited) acceleration: throttle >= 50 %, no brake, 60-160 km/h, plausibility-masked smoothed dv/dt
function exitPoints(L) {
  const out = []; if (!L.policy.use.power) return out;
  for (let i = 0; i < L.n; i++) if (L.ok[i] && L.aok[i] && L.thr[i] >= 50 && L.brk[i] !== true && L.vs[i] * 3.6 >= 60 && L.vs[i] * 3.6 < 160 && L.a[i] > 0) out.push({ kmh: L.vs[i] * 3.6, a_g: L.a[i] / G0 });
  return out;
}
// clipping signature: speed falling at full throttle on a straight (a < -0.15 m/s2, < 1 g lateral, > 180 km/h), runs of >= 3 points
function clippingOf(L, pts) {
  const runs = []; let cur = null, ftDist = 0;
  const byS = new Map(pts.map(p => [p.s, p]));
  for (let i = 0; i < L.n; i++) if (L.ok[i] && L.thr[i] >= 99 && L.brk[i] !== true) ftDist += 5;
  for (let i = 0; i < L.n; i++) {
    const p = byS.get(L.s[i]);
    const c = p && p.kmh > A.clip.min_kmh && p.a < A.clip.a_max_ms2;
    if (c) { if (!cur) { cur = []; runs.push(cur); } cur.push(p); } else cur = null;
  }
  const good = runs.filter(x => x.length >= A.clip.min_pts);
  return { runs: good.map(x => ({ s0: x[0].s, s1: x[x.length - 1].s, onset_kmh: x[0].kmh, end_kmh: x[x.length - 1].kmh, decel_g: -median(x.map(p => p.a)) / G0 })), dist_m: good.reduce((s, x) => s + x.length * 5, 0), full_throttle_dist_m: ftDist };
}
// corner minima per MultiViewer marker (lowest smoothed speed within +-80 m) and its lateral g a_y = v_min^2 max|kappa| (+-40 m);
// grip_limited when D.cornerPoints (>= 15 km/h below the preceding peak) found a minimum within 60 m of it
function cornersOf(L, circuitCorners) {
  const gl = D.cornerPoints(L), out = [];
  if (!L.policy.use.corners) return { gl, out };
  circuitCorners.forEach((cn, k) => {
    const ci = L.cornerIdx ? L.cornerIdx[k] : nearestIdx(L, cn);
    let im = -1; for (let j = ci - 16; j <= ci + 16; j++) { const jj = (j + L.n) % L.n; if (L.vs[jj] != null && (im < 0 || L.vs[jj] < L.vs[im])) im = jj; }
    if (im < 0) return;
    let km = 0; for (let j = im - 8; j <= im + 8; j++) km = Math.max(km, Math.abs(L.kappa[(j + L.n) % L.n]));
    const g = gl.find(p => Math.abs(p.s - L.s[im]) < 60);
    const thrMin = Math.min(...[...Array(33).keys()].map(q => L.thr[(ci - 16 + q + L.n) % L.n]).filter(x => x != null));
    out.push({ n: cn.number, min_kmh: L.vs[im] * 3.6, ay_g: (L.vs[im] ** 2 * km) / G0, grip_limited: !!g, flat: thrMin >= 95 });
  });
  return { gl, out };
}
function nearestIdx(L, cn) { let b = 0, bd = 1e18; for (let i = 0; i < L.n; i++) { const d = (L.x[i] - cn.x_m) ** 2 + (L.y[i] - cn.y_m) ** 2; if (d < bd) { bd = d; b = i; } } return b; }

function telemetry() {
  const laps = redBullLaps(), byLap = [];
  const brakeTime = {}, exitAcc = [], upsLo = [], upsHi = [], G = {}, Gc = {}, ups = [], downs = [], rpmMax = [], acc = { Q: [], R: [] }, brake = { Q: [], R: [] }, lat = [], cornerRows = {}, clip = {}, ftShare = {};
  for (const L of laps) {
    const ex = L.policy.exclude;
    byLap.push({ circuit: L.cid, session: L.session, code: L.code, file: L.file, lap_s: L.lap_time_s, trap_kmh: L.trap_kmh, audit: L.policy.status, actions: L.policy.actions, used: ex ? "excluded" : Object.keys(L.policy.use).filter(k => L.policy.use[k]).join(",") });
    if (ex) continue;
    const g = gearsOf(L);
    for (const k of Object.keys(g.med)) { (G[k] = G[k] || []).push(g.med[k].kmh_per_1000rpm); ((Gc[L.cid] = Gc[L.cid] || {})[k] = Gc[L.cid][k] || []).push(g.med[k].kmh_per_1000rpm); }
    ups.push(...g.ups); upsLo.push(...g.upsLo); upsHi.push(...g.upsHi); downs.push(...g.downs); rpmMax.push({ circuit: L.cid, session: L.session, code: L.code, rpm: g.rpm_max, vmax_kmh: g.vmax, gears: g.gears });
    const ap = accelPoints(L); acc[L.session].push(...ap.map(p => Object.assign({ circuit: L.cid }, p)));
    for (const z of brakeZonesRaw(L)) brake[L.session].push(Object.assign({ circuit: L.cid, code: L.code }, z));
    if (L.session === "Q" && L.policy.use.brakes && L.raw.raw_car_data) { const R = L.raw.raw_car_data; let tb = 0; for (let k = 1; k < R.time_s.length; k++) if (R.brake[k - 1] > 0) tb += R.time_s[k] - R.time_s[k - 1]; (brakeTime[L.cid] = brakeTime[L.cid] || []).push(tb); }
    if (L.session === "Q") exitAcc.push(...exitPoints(L));
    if (L.session === "Q") {
      const c = clippingOf(L, ap), cc = (clip[L.cid] = clip[L.cid] || { dist: [], share: [], onset: [], decel: [] });
      cc.dist.push(c.dist_m); cc.share.push(c.full_throttle_dist_m ? c.dist_m / c.full_throttle_dist_m : 0); c.runs.forEach(x => { cc.onset.push(x.onset_kmh); cc.decel.push(x.decel_g); });
      let ft = 0, tot = 0; for (let i = 0; i < L.n; i++) if (L.ok[i]) { tot++; if (L.thr[i] >= 99 && L.brk[i] !== true) ft++; }
      (ftShare[L.cid] = ftShare[L.cid] || []).push(ft / tot);
      const corners = D.circuitStatic(L.cid).corners, co = cornersOf(L, corners);
      lat.push(...co.gl.map(p => ({ circuit: L.cid, kmh: p.kmh, ay_g: p.ay / G0 })));
      for (const c2 of co.out) ((cornerRows[L.cid] = cornerRows[L.cid] || {})[c2.n] = cornerRows[L.cid][c2.n] || []).push(c2);
    }
  }
  // gearing table, overall ratio (needs the rolling radius), ratio change between events (C9.6.2: one change allowed in 2026)
  const gears = {};
  for (const k of Object.keys(G).sort((a, b) => a - b)) {
    const v = G[k], m = median(v), sd = robustSd(v);
    gears[k] = { kmh_per_1000rpm: r(m, 3), sd: r(sd, 3), rpm_per_kmh: r(1000 / m, 2), rpm_per_kmh_sd: r((1000 / m) * (sd / m), 2), overall_ratio: r((A.r_eff_m * 2 * Math.PI * 3.6 * 1000) / 60 / m, 3), laps: v.length, kmh_at_12000rpm: r(m * 12, 1) };
  }
  const byCircuit = {};
  for (const [cid, o] of Object.entries(Gc)) { byCircuit[cid] = {}; for (const k of Object.keys(o)) byCircuit[cid][k] = r(median(o[k]), 3); }
  const top = ["7", "8"].map(k => Object.entries(byCircuit).map(([cid, o]) => [cid, o[k]]).filter(x => x[1] != null));
  const spread8 = top[1].length ? (Math.max(...top[1].map(x => x[1])) - Math.min(...top[1].map(x => x[1]))) / median(top[1].map(x => x[1])) : null;
  // lateral envelope by speed band (grip-limited corner minima, v^2 max|kappa| estimator as concept/identify)
  const latBands = A.lat_bands.map(([lo, hi]) => { const a = lat.filter(p => p.kmh >= lo && p.kmh < hi).map(p => p.ay_g); return Object.assign({ kmh: [lo, hi] }, stat(a, 2)); });
  const accBands = s => A.acc_bands.map(([lo, hi]) => { const P = acc[s].filter(p => p.kmh >= lo && p.kmh < hi); return { kmh: [lo, hi], a_g: stat(P.map(p => p.a / G0), 3), p_kin_kw: stat(P.map(p => p.p_kin_kw), 0), p_wheel_kw: stat(P.map(p => p.p_wheel_kw), 0) }; });
  const brBands = s => [[120, 180], [180, 240], [240, 300], [300, 360]].map(([lo, hi]) => { const Z = brake[s].filter(z => z.peak_at_kmh >= lo && z.peak_at_kmh < hi); return { kmh_at_peak: [lo, hi], peak_g: stat(Z.map(z => z.peak_g), 2), peak2_g: stat(Z.map(z => z.peak2_g), 2), mean_g: stat(Z.map(z => z.mean_g).filter(x => x != null), 2) }; });
  // Brembo cross-check: the measured stop whose entry/minimum speeds are nearest Brembo's simulated ones, per lap
  const brembo = {};
  for (const [cid, b] of Object.entries(BREMBO)) {
    const per = {}; for (const z of brake.Q.filter(z => z.circuit === cid)) { const d = Math.abs(z.entry_kmh - b.from) + Math.abs(z.min_kmh - b.to); if (!per[z.code] || d < per[z.code].d) per[z.code] = { d, z }; }
    const Z = Object.values(per).filter(x => x.d < 80).map(x => x.z);
    if (!Z.length) { brembo[cid] = Object.assign({ measured: null }, b); continue; }
    brembo[cid] = Object.assign({}, b, { measured: { laps: Z.length, entry_kmh: r(median(Z.map(z => z.entry_kmh)), 0), min_kmh: r(median(Z.map(z => z.min_kmh)), 0), peak_g: r(median(Z.map(z => z.peak_g)), 2), peak2_g: r(median(Z.map(z => z.peak2_g)), 2), mean_g: r(median(Z.map(z => z.mean_g)), 2), brake_time_s: r(median(Z.map(z => z.brake_time_s)), 2), brake_dist_m: r(median(Z.map(z => z.brake_dist_m)), 0), s_m: r(median(Z.map(z => z.s_m)), 0) } });
  }
  const corners = {};
  for (const [cid, o] of Object.entries(cornerRows)) corners[cid] = Object.keys(o).map(Number).sort((a, b) => a - b).map(n => {
    const rows = o[n]; return { n, name: cid === "silverstone" ? SILVERSTONE_NAMES[n] : "T" + n, min_kmh: r(median(rows.map(x => x.min_kmh)), 0), min_kmh_spread: r(Math.max(...rows.map(x => x.min_kmh)) - Math.min(...rows.map(x => x.min_kmh)), 0), ay_g: r(median(rows.map(x => x.ay_g)), 2), grip_limited: rows.filter(x => x.grip_limited).length > rows.length / 2, flat: rows.filter(x => x.flat).length > rows.length / 2, laps: rows.length };
  });
  const circuitSummary = {};
  for (const cid of D.CIRCUIT_IDS) {
    const Lq = byLap.filter(x => x.circuit === cid && x.session === "Q"); if (!Lq.length) continue;
    const rm = rpmMax.filter(x => x.circuit === cid && x.session === "Q"), c = clip[cid] || { dist: [], share: [], onset: [], decel: [] };
    circuitSummary[cid] = { laps: Lq.map(x => x.code + " " + x.lap_s + " s" + (x.used === "excluded" ? " (excluded)" : "")), vmax_kmh: r(median(rm.map(x => x.vmax_kmh)), 0), trap_kmh: r(median(Lq.map(x => x.trap_kmh).filter(x => x != null)), 0), rpm_max: rm.length ? Math.max(...rm.map(x => x.rpm)) : null, lowest_gear: rm.length ? Math.min(...rm.map(x => x.gears[0])) : null,
      full_throttle_share_time: r(median(ftShare[cid] || [NaN]), 3), clipping_m_per_lap: r(median(c.dist.length ? c.dist : [NaN]), 0), clipping_share_of_full_throttle: r(median(c.share.length ? c.share : [NaN]), 3), clipping_onset_kmh: r(c.onset.length ? median(c.onset) : null, 0), clipping_decel_g: r(c.decel.length ? median(c.decel) : null, 3) };
  }
  const allQ = rpmMax.filter(x => x.session === "Q");
  return {
    method: "concept/tools/rb22-sheet.js telemetry(): every Red Bull Racing lap in concept/data/telemetry (qualifying at 9 circuits, team per event from the lap file; Silverstone race laps), audit policy as concept/identify/data.js (FAIL laps excluded, FAIL channels masked)",
    assumptions: A,
    laps: byLap,
    gears, gears_by_circuit: byCircuit, gear8_spread_between_circuits: r(spread8, 4),
    rpm: { max_overall: Math.max(...rpmMax.map(x => x.rpm)), max_by_lap: rpmMax.map(x => ({ circuit: x.circuit, session: x.session, code: x.code, rpm: x.rpm })), max_q_median: r(median(allQ.map(x => x.rpm)), 0), upshift: stat(ups, 0), upshift_last_sample_before: stat(upsLo, 0), upshift_first_sample_after_in_old_gear: stat(upsHi, 0), downshift_landing: stat(downs, 0) },
    accel_q: accBands("Q"), accel_race: accBands("R"),
    braking_q: { zones: brake.Q.length, peak_g: stat(brake.Q.map(z => z.peak_g), 2), bands: brBands("Q"), top_peak_g: r(Math.max(...brake.Q.map(z => z.peak_g)), 2) },
    braking_village_silverstone: (() => { const Z = brake.Q.filter(z => z.circuit === "silverstone" && z.s_m > 700 && z.s_m < 900); return { note: "the stop the sim's BRAKE_TELEMETRY (4.01 g, all 22 laps) is measured on; Red Bull laps only", laps: Z.length, entry_kmh: r(median(Z.map(z => z.entry_kmh)), 0), min_kmh: r(median(Z.map(z => z.min_kmh)), 0), peak_g: r(median(Z.map(z => z.peak_g)), 2), peak2_g: r(median(Z.map(z => z.peak2_g)), 2), mean_g: r(median(Z.map(z => z.mean_g)), 2) }; })(),
    brake_time_per_lap_s: Object.fromEntries(Object.entries(brakeTime).map(([c, v]) => [c, r(median(v), 2)])),
    accel_exit_q: [[60, 100], [100, 130], [130, 160]].map(([lo, hi]) => Object.assign({ kmh: [lo, hi] }, stat(exitAcc.filter(p => p.kmh >= lo && p.kmh < hi).map(p => p.a_g), 3))),
    braking_race: { zones: brake.R.length, peak_g: stat(brake.R.map(z => z.peak_g), 2), bands: brBands("R") },
    brembo_crosscheck: brembo,
    lateral: { estimator: "a_y = v_min^2 max|kappa| within +-40 m, x/y smoothed over max(6 m, 0.3 s v) (concept/identify/data.js); reads ~20-40 % above an x/y-acceleration estimate (IDENTIFY.md Scale)", points: lat.length, bands: latBands },
    corners, circuits: circuitSummary,
  };
}

// ================================================================ sources
// keys "rb:*" = concept/data/redbull-2026.json sources, "pr:*" = priors-2026.json, "wk:*" = silverstone-2026-weekend.json,
// "regs:*" = regs-2026-key.json docs; the rest are new here (accessed 2026-10-24; how = what was read)
const NEW_SOURCES = {
  brembo_uk_2026: { title: "Brembo: 5 facts about the British GP 2026", url: "https://www.brembo.com/en/motorsport/formula1/2026/facts-uk-2026", kind: "reported", how: "page read: T16 268->116 km/h, 2.45 s, 125 m, 3.1 g; T3 2.9 g (2025 4.5 g); 3 braking sections, just over 6.5 s per lap (Brembo simulations)" },
  brembo_austria_2026: { title: "Brembo: 5 facts about the Austrian GP 2026", url: "https://www.brembo.com/en/motorsport/formula1/2026/facts-austria-2026", kind: "reported", how: "page read: T1 306->149 km/h, 1.93 s, 109 m, 3.8 g, 1533 kW; T3 3.8 g (2025 4.6 g); 6 sections, 10.5 s per lap (simulations)" },
  brembo_hungary_2026: { title: "Brembo: 5 facts about the Hungarian GP 2026", url: "https://www.brembo.com/en/motorsport/formula1/2026/facts-hungary-2026", kind: "reported", how: "page read: T1 332->99 km/h, 3.58 s, 172 m, 4 g, 1760 kW; 8 sections, 16.7 s per lap (simulations)" },
  brembo_belgium_2026: { title: "Brembo: 5 facts about the Belgian GP 2026", url: "https://www.brembo.com/en/motorsport/formula1/2026/facts-belgium-2026", kind: "reported", how: "page read: T1 285->86 km/h, 3.32 s, 145 m, 3.6 g, 1367 kW; 6 sections, < 13 s per lap (simulations)" },
  brembo_canada_2026: { title: "Brembo: 5 facts about the Canadian GP 2026", url: "https://www.brembo.com/en/motorsport/formula1/2026/facts-canada-2026", kind: "reported", how: "page read: T13 306->147 km/h, 1.93 s, 114 m, 3.7 g, 1561 kW; 6 hard zones, > 14 s per lap; T10 5 g (2025) -> 3.1 g (simulations)" },
  brembo_singapore_2026: { title: "Brembo: 5 facts about the Singapore GP 2026", url: "https://www.brembo.com/en/motorsport/formula1/2026/facts-singapore-2026", kind: "reported", how: "page read: T1 298->144 km/h, 1.9 s, 107 m, 4 g, 1660 kW; 11 sections, 21.6 s per lap (simulations)" },
  brembo_monaco_2026: { title: "Brembo: 5 facts about the Monaco GP 2026", url: "https://www.brembo.com/en/motorsport/formula1/2026/facts-monaco-2026", kind: "reported", how: "page read: Sainte Devote 276->132 km/h, 1.67 s, 91 m, 4 g, 1463 kW; 9 sections, 16.3 s per lap (simulations)" },
  automoto_monza_2026: { title: "Automoto.it: F1 GP Italia 2026, Monza braking (Brembo analysis), 2 Sep 2026", url: "https://www.automoto.it/formula1/f1-gp-italia-2026-monza-staccate-frenate-brembo-analisi.html", kind: "reported", how: "page read: T1 318->87 km/h, 3.22 s, 153 m, 3.8 g, 1637 kW; 5 zones, < 8.5 s per lap (Brembo simulations as relayed)" },
  therace_rake_2026: { title: "The Race: Rake, drag, driving styles - what F1 teams revealed about 2026 cars (25 Jan 2026)", url: "https://www.the-race.com/formula-1/rake-drag-driving-styles-what-f1-teams-revealed-about-2026-cars/", kind: "reported", how: "page read: rear ride heights expected between 2025 and the high-rake era; Marshall (McLaren): 'How high they go, we don't really know yet'; no figures" },
  wheelbase_tables_2026: { title: "Third-party 2026 car comparison tables (f1technical.net forum; GPFans NL) giving the RB22 wheelbase as 3400 mm", url: "https://www.f1technical.net/forum/viewtopic.php?p=1334548", kind: "reported", how: "search summary only (forum and press tables); no Red Bull spec sheet found; equals the C2.3.3 maximum" },
  forum_seamless_shift: { title: "f1technical.net forum threads on seamless-shift gearboxes (3-4 ms shifts claimed, unsourced)", url: "https://www.f1technical.net/forum/viewtopic.php?p=899746", kind: "reported", how: "search summary only; lowest grade" },
  repo_telemetry_all: { title: "concept/data/telemetry (OpenF1 car_data + location; 9 circuits' qualifying + Silverstone race laps), audited by telemetry/audit", url: "concept/data/telemetry/", kind: "derived", how: "this tool (concept/tools/rb22-sheet.js telemetry())" },
  repo_sim: { title: "concept/sim (physics lap sim v3): baselineCar('redbull'), fitted.js, MODEL", url: "concept/sim/", kind: "fitted", how: "read in Node" },
  repo_identify: { title: "concept/data/cars-2026-identified.json (joint 9-circuit identification, docs/concept/IDENTIFY.md)", url: "concept/data/cars-2026-identified.json", kind: "fitted", how: "read" },
  repo_derived: { title: "concept/data/redbull-2026-derived.json (single-lap inverse dynamics, docs/concept/REDBULL-DERIVED.md)", url: "concept/data/redbull-2026-derived.json", kind: "fitted", how: "read" },
  repo_mass: { title: "docs/concept/MASS.md / concept/data/parts-mass-2026.json (researched part masses, reconciled)", url: "docs/concept/MASS.md", kind: "estimate", how: "read" },
  repo_priors: { title: "docs/concept/PRIORS.md / concept/data/priors-2026.json recommended_fit_priors", url: "concept/data/priors-2026.json", kind: "estimate", how: "read" },
  judgement: { title: "Engineering judgement in this sheet (no public source); the derivation field states the reasoning", url: "docs/concept/RB22_SHEET.md", kind: "estimate", how: "-" },
};
function allSources() {
  const rd = f => D.readJSON(path.join(ROOT, "concept", "data", f)), out = {};
  for (const [k, v] of Object.entries(rd("redbull-2026.json").sources)) out["rb:" + k] = { title: v.title, url: v.url, kind: v.kind, how: v.fetched === false ? "search summary only" : "page read (redbull-2026.json)" };
  for (const [k, v] of Object.entries(rd("priors-2026.json").sources)) out["pr:" + k] = { title: v.title, url: v.url, how: v.how };
  for (const [k, v] of Object.entries(rd("silverstone-2026-weekend.json").sources)) out["wk:" + k] = { title: v.title || v.name || k, url: v.url };
  for (const [k, v] of Object.entries(rd("regs-2026-key.json").docs)) out["regs:" + k] = { title: v.title + (v.issue ? ", " + v.issue : ""), url: v.url };
  return Object.assign(out, NEW_SOURCES);
}


// ================================================================ the sheet
const U = { SIM: "concept/sim/lapsim.js", FIT: "concept/sim/fit.js", PHYS: "concept/physical.js", DER: "concept/tools/derive-car.js", IDN: "concept/identify/model.js", PARTS: "concept/parts.js", REGS: "concept/regs.js", BENCH: "concept/bench.js", SETUP: "setup-factor work (gear ratios, roll split, heave/rake, brake bias, diff, energy map): not read by the sim yet" };
function buildEntries(T) {
  const E = [], e = (group, id, label, value, unit, sd_or_range, kind, sources, derivation, used_by, extra) => E.push(Object.assign({ id, group, label, value, unit, sd_or_range, kind, sources, derivation, used_by }, extra || {}));
  const rd = f => D.readJSON(path.join(ROOT, "concept", "data", f));
  const idn = rd("cars-2026-identified.json"), ir = idn.cars.redbull.params, it = idn.cars.redbull.trims.silverstone, der = rd("redbull-2026-derived.json");
  const fitted = require("../sim/fitted.js"), rbFit = fitted.teams.find(t => t.team === "redbull"), be = fitted.baseline_estimate;
  const claSim = (be.aero.corner.CLA_front_m2 + be.aero.corner.CLA_rear_m2) * rbFit.cla_scale;
  const eta = 0.492, efKw = N => (N >= 10500 ? 3000 : 0.27 * N + 165) / 3.6;
  const C = T.circuits, Bc = T.brembo_crosscheck, gearsTel = T.gears;
  const med = a => r(median(a), 2);

  // ---------------------------------------------------------------- engine (ICE)
  e("engine", "pu.architecture", "Power unit layout", "1.6 L V6 at 90 deg, bore 80 mm, 4 valves/cyl, single turbo (<= 150,000 rpm), no MGU-H; only the ICE and the ERS-K may propel the car", "-", "exact", "regulation", ["regs:fia_c19", "rb:fia_c19"], "Section C Issue 19, C5.1.2-4, C5.3.1, C5.3.6, C5.2.1 (as read for redbull-2026.json)", [U.REGS]);
  e("engine", "pu.compression_ratio_max", "Geometric compression ratio (max, checked hot from 1 Jun 2026)", 16.0, "-", "exact", "regulation", ["rb:fia_c19"], "C5.4.3", [U.REGS]);
  e("engine", "pu.fuel_energy_flow_max", "Fuel energy flow cap (>= 10,500 rpm)", 3000, "MJ/h", "exact (833.3 kW of fuel power)", "regulation", ["rb:fia_c19"], "C5.2.3", [U.SIM, U.DER, U.IDN]);
  e("engine", "pu.fuel_energy_flow_vs_rpm", "Fuel energy flow cap below 10,500 rpm", "EF = 0.27 N + 165 MJ/h (N in rpm)", "MJ/h", "exact", "regulation", ["rb:fia_c19"], "C5.2.4; reaches 3000 MJ/h at exactly 10,500 rpm, so revs above it earn no extra fuel", [U.SIM, U.DER, U.IDN],
    { table: [6000, 8000, 9000, 10000, 10500, 11000, 12000, 12500].map(N => ({ rpm: N, mj_h: r(N >= 10500 ? 3000 : 0.27 * N + 165, 0), fuel_kw: r(efKw(N), 1) })) });
  e("engine", "pu.ice_power_peak", "DM01 ICE crank power (>= 10,500 rpm)", 410, "kW", { sd: 15, range: [385, 430] }, "estimate", ["pr:fia_news", "rb:fia_aduo", "rb:sky_aduo", "pr:sf_ice", "rb:mmag_engines", "repo_identify", "repo_sim", "repo_derived"],
    "No Red Bull/Ford figure is public. FIA design figure for a 2026 ICE: ~400 kW. FIA ADUO period 1: Mercedes 2-4 % below the best ICE, the others > 4 % below; Sky/Auto Action name the benchmark as Red Bull Ford, so the DM01 sits at or above the field. Press estimate (ScuderiaFans, equal-drag method): Red Bull Ford 421 kW. Fitted in this repo: identify 424 +- 19 kW (prior-dominated), sim 396 kW (400 x team PU scale 0.990), derive-car 396 kW (assumed efficiency 0.475). Central 410 kW, sd 15 kW covers all of them", [U.SIM, U.FIT, U.PHYS, U.BENCH, U.DER, U.IDN]);
  e("engine", "pu.ice_thermal_efficiency", "ICE fuel-to-crank efficiency at full fuel flow", eta, "-", { sd: 0.018, range: [0.46, 0.52] }, "estimate", ["pr:sf_ice", "pr:fia_news"], "410 kW / 833.3 kW (pu.ice_power_peak over the C5.2.3 cap); no manufacturer has published a 2026 efficiency", [U.DER, U.IDN]);
  e("engine", "pu.ice_power_curve", "ICE power and torque vs rpm (full load)", "0.492 x (0.27 N + 165)/3.6 kW below 10,500 rpm, 410 kW flat above", "kW", { sd_kw: 15 }, "derived", ["rb:fia_c19", "judgement"], "regulated fuel-flow shape (C5.2.3-4) x the estimated efficiency, taken constant with rpm (no BSFC map is public; real efficiency varies with speed, so this is a smooth envelope)", [U.SIM, U.DER, U.IDN],
    { table: [6000, 7000, 8000, 9000, 10000, 10500, 11000, 11500, 12000, 12500, 12800].map(N => ({ rpm: N, kw: r(eta * efKw(N), 1), torque_nm: r((eta * efKw(N) * 1000) / ((N * 2 * Math.PI) / 60), 0) })) });
  e("engine", "pu.ice_torque", "ICE crank torque at 10,500 rpm (full load)", 373, "Nm", { range: [355, 395], note: "~388 Nm at 6000 rpm, ~306 Nm at 12,800 rpm" }, "derived", ["rb:fia_c19", "judgement"], "P/omega from pu.ice_power_curve: the C5.2.4 line gives near-constant torque below 10,500 rpm, falling as 1/N above", [U.SETUP]);
  e("engine", "pu.rev_limit_regulation", "Crankshaft rev limit in the rules", "none (C5.14 only bounds the spread of high rev limits to a 750 rpm band)", "rpm", "exact", "regulation", ["rb:fia_c19"], "Section C Issue 19/21 have no crank-speed cap; the 15,000 rpm in C9.8.2 is a launch-gear test speed. Press '15,000 rpm' is not in the text (REDBULL.md)", [U.REGS]);
  const qMax = Math.max(...T.rpm.max_by_lap.filter(x => x.session === "Q").map(x => x.rpm));
  e("engine", "pu.rpm_max_observed", "Highest engine speed seen on Red Bull laps", T.rpm.max_overall, "rpm", { q_lap_max_median: T.rpm.max_q_median, q_max: qMax, sampling_note: "+100-200 rpm possible between 3.7 Hz samples" }, "derived", ["repo_telemetry_all"], "max of raw OpenF1 rpm over all " + T.rpm.max_by_lap.length + " Red Bull laps (" + T.rpm.max_overall + " VER Silverstone race; qualifying max " + qMax + "); median of the per-lap maxima " + T.rpm.max_q_median + " rpm", [U.SIM]);
  e("engine", "pu.upshift_rpm", "Upshift engine speed", T.rpm.upshift.median, "rpm", { sd: T.rpm.upshift.sd, p10_p90: [T.rpm.upshift.p10, T.rpm.upshift.p90], n: T.rpm.upshift.n, lower_bound_median: T.rpm.upshift_last_sample_before.median, upper_bound_median: T.rpm.upshift_first_sample_after_in_old_gear.median }, "derived", ["repo_telemetry_all"], "all Red Bull laps with raw samples (Q + race), consecutive-gear upshifts: midpoint of the last sample before the shift (lower bound, median " + T.rpm.upshift_last_sample_before.median + ") and the first sample after it converted back to the old gear with the lap's own ratios (upper bound, median " + T.rpm.upshift_first_sample_after_in_old_gear.median + "). Fuel flow is flat above 10,500 rpm, so where in 11-12.5k the shift falls costs little", [U.SIM]);
  e("engine", "pu.downshift_landing_rpm", "rpm just after a downshift (braking)", T.rpm.downshift_landing.median, "rpm", { sd: T.rpm.downshift_landing.sd, p10_p90: [T.rpm.downshift_landing.p10, T.rpm.downshift_landing.p90], n: T.rpm.downshift_landing.n }, "derived", ["repo_telemetry_all"], "first raw sample after each gear decrease", [U.SETUP]);
  e("engine", "pu.full_power_band", "Engine speed band at full ICE power", [10500, 12800], "rpm", "lower bound exact (C5.2.4); upper bound = observed use", "derived", ["rb:fia_c19", "repo_telemetry_all"], "fuel flow reaches its 3000 MJ/h cap at 10,500 rpm; Red Bull laps use up to ~12.8k", [U.SIM]);

  // ---------------------------------------------------------------- ERS / energy
  e("energy", "ers.mguk_power", "MGU-K power (DC, deploy and harvest)", 350, "kW", "exact (339.5 kW mechanical at the fixed 0.97)", "regulation", ["rb:fia_c19"], "C5.2.7, C5.2.21", [U.SIM, U.DER, U.IDN, U.REGS]);
  e("energy", "ers.mguk_taper", "MGU-K deployment limit vs speed", "min(350, 1800 - 5v) kW, 0 at >= 345 km/h (v in km/h); Overtake: 7100 - 20v, 0 at 355 km/h", "kW", "exact", "regulation", ["rb:fia_c19"], "C5.2.8: full 350 kW to 290 km/h; 300 kW at 300, 150 kW at 330 km/h", [U.SIM, U.DER, U.IDN]);
  e("energy", "ers.mguk_torque_max", "MGU-K torque cap", 500, "Nm", "exact", "regulation", ["rb:fia_c19"], "C5.2.11", [U.REGS]);
  e("energy", "ers.conversion_factor", "Fixed electrical <-> mechanical factor", 0.97, "-", "exact", "regulation", ["rb:fia_c19"], "C5.2.21", [U.SIM]);
  e("energy", "ers.soc_window", "Energy store state-of-charge window", 4, "MJ", "exact", "regulation", ["rb:fia_c19"], "C5.2.9", [U.SIM]);
  e("energy", "ers.recharge_max", "Recharge cap per lap (rule)", 8.5, "MJ", "exact", "regulation", ["rb:fia_c19"], "C5.2.10 (lower per event; Issue 21 lowers the Q floor 5 -> 4 MJ)", [U.SIM]);
  e("energy", "ers.recharge_q_silverstone", "Silverstone recharge limit, SQ/Q", 6.5, "MJ", "exact (race 8.0, 8.5 with Overtake)", "official", ["wk:fia_pu_info"], "FIA 2026 British GP Power Unit Information", [U.SIM, U.DER]);
  e("energy", "ers.superclip_power", "Peak superclip (full-throttle harvest) power", 350, "kW", { range: [250, 350] }, "reported", ["pr:crash_apr", "pr:race_clip"], "FIA change from Miami (April 2026): 250 -> 350 kW; Silverstone (July) is after it", [U.SIM]);
  e("energy", "ers.power_reduction_rules", "ERS-K power-reduction rates (Silverstone)", "<= 150 kW step (350 kW in T1-T4, T6-T7, T15-T16, Exit T17), held 1 s, then <= 50 kW/s above 100 kW; resets Exit T1 / T9 / T17-18; speed thresholds 210 km/h (300 in T11-T14, 230 in T18)", "-", "exact", "official", ["rb:fia_c19", "wk:fia_pu_info"], "C5.12.4-C5.12.7 with the event tables (silverstone-2026-weekend.json energy_limits)", [U.SIM]);
  e("energy", "ers.deployed_q_lap_silverstone", "Energy deployed on the Silverstone Q lap (DC)", der.physical_car.pu.es_deploy_mj_per_lap, "MJ", { sd: 1.0, max_possible: 10.5 }, "fitted", ["repo_derived", "repo_sim"], "derive-car power balance on HAD's lap (conditional on its CdA and ICE). The physics sim's own plan deploys 8.0 MJ on the RB22 (an output, not an input). Upper bound 6.5 MJ recharge + 4 MJ window", [U.DER]);
  e("energy", "ers.deployment_pattern", "Where the MGU-K deploys fully (Silverstone Q)", "full 350 kW only out of slow corners onto long straights (Wellington 371, Woodcote-Copse 343, pit straight 336 kW peaks); 150-300 kW elsewhere; little after Stowe", "-", "pattern", "fitted", ["repo_derived"], "per-straight peak K_DC from the power balance (REDBULL-DERIVED.md section 2); the anchor makes the top three average 350 kW", [U.SIM, U.SETUP]);
  e("energy", "ers.clipping", "Clipping (speed falling at full throttle on a straight)", C.silverstone.clipping_m_per_lap, "m per Silverstone Q lap", { onset_kmh: C.silverstone.clipping_onset_kmh, decel_g: C.silverstone.clipping_decel_g, by_circuit: Object.fromEntries(Object.entries(C).map(([k, v]) => [k, { m_per_lap: v.clipping_m_per_lap, onset_kmh: v.clipping_onset_kmh, decel_g: v.clipping_decel_g, share_of_full_throttle: v.clipping_share_of_full_throttle }])) }, "derived", ["repo_telemetry_all"],
    "signature: smoothed dv/dt < -0.15 m/s2 at >= 99 % throttle, < 1 g lateral, > 180 km/h, runs >= 15 m. It also contains the C5.2.8 taper above 290 km/h, Straight Mode closing, headwind and grade (no channels for those)", [U.SIM]);

  // ---------------------------------------------------------------- transmission
  e("transmission", "tx.forward_gears", "Forward gears", 8, "-", "exact", "regulation", ["rb:fia_c19", "rb:racecar_spec"], "C9.6.1; Red Bull spec sheet: 'Red Bull Technology designed and built 8 speed transmission'", [U.SIM]);
  for (const g of Object.keys(gearsTel)) {
    const x = gearsTel[g];
    e("transmission", "tx.gear" + g, "Gear " + g + ": road speed per engine speed", x.kmh_per_1000rpm, "km/h per 1000 rpm", { sd: x.sd, rpm_per_kmh: x.rpm_per_kmh, rpm_per_kmh_sd: x.rpm_per_kmh_sd, overall_ratio: x.overall_ratio, kmh_at_12000rpm: x.kmh_at_12000rpm, laps: x.laps }, "derived", ["repo_telemetry_all"],
      "median over Red Bull laps of each lap's median v/(rpm/1000) on raw samples with a steady gear, no brake, rpm > 6000, > 40 km/h; sd = robust spread between laps (low gears carry wheelspin, which lowers km/h per rpm). Overall ratio (engine:wheel = gearbox x final drive) = r x 2 pi x 3.6 x 1000 / 60 / value with r = 0.348 m (+-1.7 % from the radius)", [U.SIM, U.FIT, U.PHYS]);
  }
  e("transmission", "tx.final_drive", "Final drive ratio (split of the overall ratio)", 3.7, "-", { range: [3.0, 4.5] }, "estimate", ["judgement"], "not public and not identifiable from telemetry: only gear x final drive (tx.gearN overall_ratio) is observable, and any split with the same product drives the same. The range assumes a top-gear pair of ~1.05-1.55 (8th overall 4.69)", [U.SETUP]);
  e("transmission", "tx.ratio_change_2026", "Ratio change between events (C9.6.2 allows one in 2026)", "none detected in gears 6-8 (Suzuka, March, to Singapore, October)", "-", { gear8_spread: T.gear8_spread_between_circuits, by_circuit: T.gears_by_circuit }, "derived", ["repo_telemetry_all", "rb:fia_c19"], "8th-gear km/h per 1000 rpm spans " + r(T.gear8_spread_between_circuits * 100, 2) + " % across 8 circuits; low gears vary by 2-5 % with wheelspin, so a change of a low pair smaller than that cannot be excluded", [U.SETUP]);
  e("transmission", "tx.shift_time_max", "Maximum shift duration (rule)", { up_ms: 200, down_ms: 300 }, "ms", "exact", "regulation", ["rb:fia_c19"], "C9.8.4", [U.SIM]);
  e("transmission", "tx.upshift_torque_interruption", "Drive lost per upshift (seamless shift)", 0.02, "s", { range: [0.005, 0.05] }, "estimate", ["forum_seamless_shift", "judgement"], "no team figure; seamless-shift boxes are reported (forum, unverified) at 3-4 ms, ignition-cut smoothing adds a little; 3.7 Hz telemetry cannot resolve it", [U.SIM]);
  e("transmission", "tx.drivetrain_efficiency", "Gearbox + driveline efficiency", 0.95, "-", { sd: 0.01, range: [0.93, 0.97] }, "estimate", ["repo_priors"], "not public; priors-2026 0.93-0.97", [U.SIM, U.DER, U.IDN]);
  e("transmission", "tx.driveline_min_mass", "Driveline + gear-change minimum mass", 22, "kg", "exact", "regulation", ["rb:fia_c19"], "C9.5.2", [U.PARTS]);
  e("transmission", "tx.top_speed", "Top speed on the qualifying lap (median of Red Bull laps)", C.silverstone.vmax_kmh, "km/h (Silverstone)", { by_circuit: Object.fromEntries(Object.entries(C).map(([k, v]) => [k, { vmax: v.vmax_kmh, trap: v.trap_kmh, lowest_gear: v.lowest_gear }])) }, "derived", ["repo_telemetry_all"], "max OpenF1 speed on each lap; trap = OpenF1 st_speed (lap file)", [U.SIM]);
  e("transmission", "tx.speed_trap_silverstone", "FIA speed trap, Silverstone (HAD / VER)", { q: [305.8, 304.3], race: [331.7, 330.8] }, "km/h", "exact (timing)", "official", ["rb:fia_t_q_speeds", "rb:fia_t_r_speeds"], "FIA Qualifying / Race Maximum Speeds, trap 140 m before T15; race values include tow and Overtake", [U.FIT]);
  e("transmission", "tx.speed_trap_monza", "FIA speed trap, Monza (team max)", { q: 326.7, race: 333.5 }, "km/h", "exact (timing)", "official", ["wk:fia_monza_q_speeds", "wk:fia_monza_r_speeds"], "grid-2026.json monza_2026_top_speed", []);

  // ---------------------------------------------------------------- mass and geometry
  e("mass", "mass.min_q", "Minimum mass, qualifying", "726 kg + Nominal Tyre Mass", "kg", "exact", "regulation", ["rb:fia_c19"], "C4.1 (724 + NTM in other sessions)", [U.REGS, U.PARTS, U.SIM]);
  e("mass", "mass.nominal_tyre_mass", "Nominal Tyre Mass", 46, "kg", { range: [44, 48] }, "estimate", ["pr:fia_news", "pr:racefans_ntm", "pr:mclaren_spec"], "not published; FIA 2024 46 kg, RaceFans 44, declared car masses bound it at <= ~48 (PRIORS.md)", [U.REGS, U.PARTS]);
  e("mass", "mass.car_no_fuel", "RB22 mass with driver, no fuel (Silverstone)", 775, "kg", { sd: 4, range: [770, 780] }, "estimate", ["rb:rn365_weights", "rb:therace_overweight", "pr:racefans_ntm"], "reported over the 768 kg headline minimum: +9/10 kg (2 Apr), ~+6/7 kg (2 Jun, from ~0.2 s/lap), more weight due off at Austria (R8, before Silverstone): 768 + 3 to 9 = 771-777; a 46 kg NTM adds 2 kg. Central 775 +- 4", [U.SIM, U.PHYS, U.DER, U.IDN]);
  e("mass", "mass.fuel_q", "Fuel on a qualifying lap", 6, "kg", { sd: 2, range: [3, 10] }, "estimate", ["judgement"], "out lap + push lap + in lap + the FIA sample (~1 kg) at ~1.3 kg per lap (~70 kg race fuel over 52 laps, generic); sim 8, derive-car 5, identify 3-8", [U.SIM, U.DER]);
  e("mass", "mass.weight_dist_front", "Static front axle share", 0.45, "-", { sd: 0.007, range: [0.44, 0.46] }, "estimate", ["rb:fia_c19", "pr:mclaren_spec", "repo_mass"], "C4.2 floors (front >= 0.44, rear >= 0.54 of the minimum) leave 0.44-0.46; McLaren states 44-46 %; the reconciled mass sheet gives 0.4496", [U.SIM, U.PHYS, U.REGS]);
  e("mass", "mass.cog_height", "Centre of gravity height above ground", 0.29, "m", { sd: 0.025, range: [0.27, 0.34] }, "estimate", ["pr:perantoni", "repo_mass", "repo_priors"], "not public; academic F1 model 0.30; the reconciled mass sheet with regulation-anchored positions 0.280; derive-car 0.28; sim 0.30", [U.SIM, U.PHYS, U.DER]);
  e("mass", "mass.yaw_inertia", "Yaw inertia Izz", 540, "kg m2", { range: [480, 620] }, "estimate", ["pr:perantoni", "repo_priors"], "academic 450 kg m2 at 660 kg, scaled to ~775 kg (radius of gyration 0.83 m); the mass sheet's point-mass sum is a lower bound", [U.PHYS]);
  e("mass", "mass.unsprung", "Unsprung mass per axle", { front_kg: 64, rear_kg: 69 }, "kg", { range_pct: 20 }, "estimate", ["repo_mass"], "MASS.md best values: wheels (rims + tyres) 40.1 / 46.9, brakes 11.9 / 11.5, plus 40 % of each suspension group (30.7 / 27.2)", [U.PHYS]);
  e("mass", "mass.pu_min", "Power unit minimum mass", 185, "kg", "exact (ICE group 130-134 incl. TC, MGU-K 16-20, ES 35)", "regulation", ["rb:fia_c19", "repo_mass"], "C5.5.1-2, C5.18.7, C5.17.9, C5.3.4", [U.PARTS, U.REGS]);
  e("geometry", "geom.wheelbase", "Wheelbase", 3.4, "m", { range: [3.38, 3.4] }, "reported", ["wheelbase_tables_2026", "rb:fia_c19"], "regulation maximum 3400 mm (C2.3.3); third-party tables give the RB22 at 3400 mm (no team sheet)", [U.SIM, U.PHYS, U.PARTS, U.REGS]);
  e("geometry", "geom.track_front", "Front track (wheel centre planes)", 1.54, "m", "regulation maximum", "regulation", ["regs:fia_c19"], "C10.10.1: Wheel Coordinate System origin not outboard of Y=603 mm + half the C10.7.2(a) rim width 334 mm -> |Y| 770 mm; a car built to the limit uses it", [U.SIM, U.PHYS, U.PARTS, U.REGS]);
  e("geometry", "geom.track_rear", "Rear track (wheel centre planes)", 1.47, "m", "regulation maximum", "regulation", ["regs:fia_c19"], "C10.10.1: Y=525 mm + half of 420.3 mm -> |Y| 735 mm", [U.SIM, U.PHYS, U.PARTS, U.REGS]);
  e("geometry", "geom.width_max", "Overall width", 1.9, "m", "exact", "regulation", ["rb:fia_c19"], "C2.3.1 half-width <= 950 mm", [U.REGS]);

  // ---------------------------------------------------------------- tyres
  e("tyres", "tyre.size_front", "Front tyre", { width_mm: 280, diameter_mm: 705, rim_in: 18 }, "mm", "exact", "official", ["pr:merc_tyres", "pr:pirelli_pr"], "Pirelli deltas -25 mm width / -15 mm diameter vs 2025 (305 x 720)", [U.PARTS]);
  e("tyres", "tyre.size_rear", "Rear tyre", { width_mm: 375, diameter_mm: 710, rim_in: 18 }, "mm", "exact", "official", ["pr:merc_tyres", "pr:pirelli_pr"], "Pirelli deltas -30 / -10 mm", [U.PARTS]);
  e("tyres", "tyre.loaded_radius", "Loaded rolling radius", 0.348, "m", { sd: 0.006, range: [0.34, 0.355] }, "estimate", ["pr:merc_tyres", "repo_priors"], "unloaded 0.3525 / 0.355 m (half the published diameters) minus deflection; only converts km/h per rpm into an overall ratio", [U.SIM, U.DER, U.IDN]);
  e("tyres", "tyre.mass", "Tyre mass (each)", { front_kg: 10.5, rear_kg: 12.5 }, "kg", { range_kg: [9.5, 13.5] }, "estimate", ["repo_mass", "pr:pirelli_race"], "46 kg NTM split by cross-section (MASS.md); Pirelli: the 2026 set is 1.6 kg lighter than 2025", [U.PARTS]);
  e("tyres", "tyre.silverstone_prescriptions", "Silverstone minimum start pressure / camber limit", { psi_front: 28, psi_rear: 26, camber_front_deg: -2.75, camber_rear_deg: -1.5, compounds: "C1/C2/C3" }, "psi / deg", "exact", "official", ["wk:fia_pirelli"], "FIA Pirelli preview (silverstone-2026-weekend.json tyres)", [U.SETUP]);
  e("tyres", "tyre.mu_y", "Lateral friction coefficient at the static load (physical)", 1.8, "-", { sd: 0.1, range: [1.6, 2.0] }, "estimate", ["pr:perantoni", "pr:fia_news"], "no Pirelli figure; academic F1 tyre 1.80 at 2 kN; FIA 'minimal loss in grip' for the narrower 2026 tyre. Effective values elsewhere: sim 1.89 (inside), identify 2.27 +- 0.10, derive-car 2.54 (other estimators' scales)", [U.SIM, U.PHYS]);
  e("tyres", "tyre.mu_x", "Longitudinal friction coefficient (physical)", 1.75, "-", { sd: 0.1, range: [1.5, 1.9] }, "estimate", ["pr:perantoni"], "academic 1.75 at 2 kN. Effective elsewhere: sim 1.72 (inside), identify 1.49 +- 0.08, derive-car 2.09 (smoothed 3.7 Hz braking)", [U.SIM, U.PHYS]);
  e("tyres", "tyre.load_sensitivity", "Friction lost per kN of tyre load", 4.5, "% per kN", { sd: 0.75, range: [3.0, 6.0] }, "estimate", ["pr:perantoni", "repo_identify"], "academic table 4.9-5.0 %/kN; identify's global fit sits at the top of 3-6 %/kN (0.116 per unit load ratio); sim 4.51 %/kN", [U.SIM, U.IDN]);
  e("tyres", "tyre.slip_angle_peak", "Slip angle at the lateral limit", 0.08, "rad", { range: [0.05, 0.16] }, "estimate", ["pr:perantoni", "repo_sim"], "F1 tyres ~3 deg (Milliken via Wikipedia) to 8-9 deg (academic model); the sim estimates 0.098 rad inside this range", [U.SIM]);

  // ---------------------------------------------------------------- brakes
  const bm = Object.values(Bc).filter(b => b.measured);
  e("brakes", "brake.peak_decel_hard_stop", "Peak deceleration in the hardest stop of a lap (~300 km/h entry)", 4.0, "g", { sd: 0.5, telemetry_two_interval_median: med(bm.map(b => b.measured.peak2_g)), telemetry_single_interval_median: med(bm.map(b => b.measured.peak_g)), brembo_simulated_median: med(bm.map(b => b.g)), circuits: bm.length }, "derived", ["repo_telemetry_all", "brembo_uk_2026", "brembo_austria_2026", "brembo_hungary_2026", "brembo_monaco_2026", "brembo_canada_2026", "brembo_singapore_2026", "automoto_monza_2026", "repo_sim"],
    "per circuit, the Red Bull stop nearest Brembo's simulated hardest stop: raw OpenF1 speed drop over two sample intervals (~0.5 s) " + med(bm.map(b => b.measured.peak2_g)) + " g (median of " + bm.length + " circuits); over one interval (~0.27 s, noisier and biased up by taking the max) " + med(bm.map(b => b.measured.peak_g)) + " g; Brembo's simulations " + med(bm.map(b => b.g)) + " g. Central 4.0 +- 0.5 g covers all three", [U.FIT, U.SIM]);
  e("brakes", "brake.decel_vs_speed", "Peak deceleration by speed at the peak (all Q stops)", T.braking_q.bands.filter(b => b.peak2_g.n).map(b => ({ kmh: b.kmh_at_peak, peak2_g: b.peak2_g.median, peak2_sd: b.peak2_g.sd, peak_g: b.peak_g.median, mean_g: b.mean_g.median, n: b.peak2_g.n })), "g", "per band (sd = robust spread between stops)", "derived", ["repo_telemetry_all"], "raw-sample stops with entry > 120 km/h and > 40 km/h drop; includes light stops and lifts (Becketts), so band medians sit below the hard-stop peak", [U.SIM]);
  e("brakes", "brake.brembo_crosscheck", "Hardest stop per circuit: Red Bull telemetry vs Brembo simulation", Object.fromEntries(Object.entries(Bc).map(([k, b]) => [k, { brembo: { corner: b.corner, from_kmh: b.from, to_kmh: b.to, g: b.g, t_s: b.t_s, d_m: b.d_m }, measured: b.measured }])), "g, km/h, s, m", "per circuit", "derived", Object.values(BREMBO).map(b => b.src).concat(["repo_telemetry_all"]), "measured brake-on time and distance come from the binary brake flag (released before the minimum), so they are shorter than Brembo's whole deceleration phase; mean_g = (entry - min) / (time to the minimum). Spa has no raw samples in the repo (no measured value)", [U.SIM]);
  e("brakes", "brake.time_per_lap", "Brake-on time per qualifying lap", T.brake_time_per_lap_s.silverstone, "s (Silverstone)", { by_circuit: T.brake_time_per_lap_s, brembo: { silverstone: 6.5, austria: 10.5, hungaroring: 16.7, spa: 13, montreal: 14, singapore: 21.6, monaco: 16.3, monza: 8.5 } }, "derived", ["repo_telemetry_all", "brembo_uk_2026"], "sum of raw sample intervals with the brake flag on; within ~1.6 s of Brembo at Austria, Hungary, Montreal, Singapore and Monaco; Silverstone (10.2 vs 6.5 s) and Monza (10.4 vs < 8.5 s) run longer because the flag counts light dabs and trail braking outside Brembo's 3 and 5 zones", [U.SIM]);
  e("brakes", "brake.village_silverstone", "Village (T3) stop, Red Bull laps", T.braking_village_silverstone.peak2_g, "g (two-interval peak)", T.braking_village_silverstone, "derived", ["repo_telemetry_all", "repo_sim"], "the sim's BRAKE_TELEMETRY data term (4.01 g, median single-interval peak over all 22 laps) is measured on this stop; the two Red Bull laps alone read lower", [U.FIT]);
  e("brakes", "brake.disc_size", "Brake disc diameters (rule window)", { front_mm: [325, 345], rear_mm: [260, 280] }, "mm", "exact", "regulation", ["pr:drive_brembo", "rb:fia_c19"], "C11.3.3 as reported by The Drive / Brembo", [U.PARTS]);
  e("brakes", "brake.architecture", "Brake system", "front hydraulic; rear brake-by-wire blending friction and MGU-K regen to the driver's balance", "-", "exact", "official", ["pr:brembo_rules", "pr:drive_brembo"], "Brembo 2026 rules page", [U.SIM]);
  e("brakes", "brake.balance_front", "Brake balance (front share of total braking force, friction + regen)", 0.57, "-", { sd: 0.03, range: [0.52, 0.62] }, "estimate", ["judgement", "pr:brembo_rules"], "not public. Axle loads at 4 g with h/wb 0.085 and aero balance 0.44 put the ideal front share near 0.55-0.60; rear regen (up to 350 kW, 32-40 % of peak braking power, PRIORS.md) is part of the rear share; sim uses 0.57", [U.SIM, U.SETUP]);
  e("brakes", "brake.mech_capacity", "Brake system capacity (deceleration cap)", 5.0, "g", { range: [4.5, 6.0] }, "estimate", ["judgement", "pr:brembo_uk"], "a cap above the tyre limit, so braking stays tyre-limited: 2025 cars reached 4.5-5 g with the same hardware class (Brembo); it does not bind in the sim", [U.SIM, U.PHYS]);
  e("brakes", "brake.disc_temperature_window", "Disc working window", [400, 800], "deg C", "range", "reported", ["pr:f1_brakes"], "formula1.com: ~400 C effective, oxidises beyond 800; Silverstone brake demand index 1/5 (Brembo), so ducts can run small there", [U.SETUP]);

  // ---------------------------------------------------------------- acceleration and power
  const accRows = T.accel_q.filter(b => b.a_g.n > 0);
  e("acceleration", "acc.full_throttle_by_speed", "Full-throttle acceleration by speed (Q laps, < 1 g lateral)", accRows.map(b => ({ kmh: b.kmh, a_g: b.a_g.median, sd: b.a_g.sd, p90: b.a_g.p90, n: b.a_g.n })), "g", "per band", "derived", ["repo_telemetry_all"], "smoothed dv/dt (+-0.45 s local quadratic), >= 99 % throttle, no brake, no lift in the next 0.45 s, plausibility-masked (audit C4 limits); 9 circuits. Below 100 km/h the throttle is rarely 99 %: see acc.corner_exit", [U.SIM]);
  e("acceleration", "acc.corner_exit", "Corner-exit acceleration, 60-160 km/h (traction-limited)", T.accel_exit_q.map(b => ({ kmh: b.kmh, a_g: b.median, sd: b.sd, p90: b.p90, n: b.n })), "g", "per band", "derived", ["repo_telemetry_all"], ">= 50 % throttle, no brake, positive dv/dt", [U.SIM]);
  e("acceleration", "acc.wheel_power_by_speed", "Wheel power vs speed at full throttle (dE/dt + drag + rolling)", accRows.map(b => ({ kmh: b.kmh, p_kin_kw: b.p_kin_kw.median, p_wheel_kw: b.p_wheel_kw.median, p_wheel_p90_kw: b.p_wheel_kw.p90, n: b.p_wheel_kw.n })), "kW", "p_kin model-free given mass; p_wheel conditional on effective CdA (+-0.15 m2 -> +-45 kW at 250 km/h)", "derived", ["repo_telemetry_all"],
    "P_kin = 1.03 m a v (m = 781 kg); P_wheel = P_kin + 0.5 rho CdA v^3 + Crr m g v with CdA 1.20 (0.95 in Straight Mode zones). Peak available at the wheel: (410 + 339.5) x 0.95 = 712 kW; the 150-250 km/h p90 near 680 kW fits full ICE + near-full MGU-K, and the fall above 290 km/h follows the C5.2.8 taper and clipping", [U.SIM, U.DER]);
  e("acceleration", "acc.peak_crank_power", "Peak combined crank power (ICE + MGU-K mechanical)", r(410 + 339.5, 1), "kW", { sd: 15 }, "derived", ["rb:redbull_hp", "rb:fia_c19"], "pu.ice_power_peak + 350 x 0.97; redbull.com quotes ~745 kW for 2026 cars", [U.SIM]);

  // ---------------------------------------------------------------- cornering
  e("cornering", "lat.envelope_by_speed", "Lateral acceleration at grip-limited corner minima, by speed", T.lateral.bands.map(b => ({ kmh: b.kmh, ay_g: b.median, sd: b.sd, p90: b.p90, n: b.n })), "g", "per band", "derived", ["repo_telemetry_all"], T.lateral.estimator + ". 9 circuits, Q laps", [U.SIM, U.IDN]);
  e("cornering", "lat.identified_ay", "Lateral limit at 100 / 200 / 250 km/h (joint 9-circuit fit, same estimator)", { "100": r(ir.ay_100kmh_g.mean, 2), "200": r(ir.ay_200kmh_g.mean, 2), "250": r(ir.ay_250kmh_g.mean, 2) }, "g", { sd: { "100": r(ir.ay_100kmh_g.sd, 2), "200": r(ir.ay_200kmh_g.sd, 2), "250": r(ir.ay_250kmh_g.sd, 2) } }, "fitted", ["repo_identify"], "IDENTIFY.md; Red Bull is in the leading group at 200-250 km/h with Ferrari and Mercedes", [U.IDN]);
  e("cornering", "lat.silverstone_corners", "Silverstone corner minimum speed and lateral g (Red Bull Q laps, HAD + VER)", T.corners.silverstone.map(c => ({ n: c.n, name: c.name, min_kmh: c.min_kmh, ay_g: c.ay_g, grip_limited: c.grip_limited, flat: c.flat })), "km/h, g", "spread between the two laps <= 6 km/h", "derived", ["repo_telemetry_all"], "lowest smoothed speed within +-80 m of each MultiViewer marker; ay = v_min^2 max|kappa| (+-40 m); flat = throttle >= 95 % through the marker window (a lower bound on grip)", [U.SIM, U.FIT]);
  e("cornering", "lat.corners_by_circuit", "Corner minimum speeds and lateral g, 8 other circuits", Object.fromEntries(Object.entries(T.corners).filter(([k]) => k !== "silverstone").map(([k, v]) => [k, v.map(c => ({ n: c.n, min_kmh: c.min_kmh, ay_g: c.ay_g, grip_limited: c.grip_limited, flat: c.flat }))])), "km/h, g", "per corner", "derived", ["repo_telemetry_all"], "as lat.silverstone_corners", [U.IDN]);
  e("cornering", "lat.pirelli_silverstone", "Peak tyre loading at Silverstone (Pirelli)", "> 5", "g", "statement", "official", ["pr:pirelli_race_pr"], "Pirelli 2026 Silverstone preview: 'some corners subject the tyres to forces exceeding 5G'", []);

  // ---------------------------------------------------------------- aero
  e("aero", "aero.cla_corner_physical", "Downforce area, Corner Mode (physical)", 3.9, "m2", { range: [3.2, 4.6] }, "estimate", ["pr:perantoni", "pr:maxtaylor", "pr:fia_news", "rb:therace_surge"], "sourced prior: 2022-25 references x 0.70 (FIA -30 %). The RB22 is reported low-drag and weaker in fast corners than Mercedes/Ferrari, so not above the field. Not public for any car", [U.SIM]);
  e("aero", "aero.cla_corner_sim_effective", "Downforce area, Corner Mode (physics-sim effective)", r(claSim, 4), "m2", { range: [3.2, 6.5], note: "the sim's widened fit range" }, "fitted", ["repo_sim"], "fitted.js baseline_estimate (5.32 m2 on the pole lap) x Red Bull cla_scale " + rbFit.cla_scale + ". Effective: it carries the sim line's curvature scale and its tyre law, ~1.36x the physical central; compare cars through a_y(v), not ClA (SIM.md 4.2)", [U.SIM, U.FIT, U.PHYS]);
  e("aero", "aero.cla_other_models", "Downforce area in the other two estimators", { identify: r(ir.ClA_m2.mean, 2), identify_sd: r(ir.ClA_m2.sd, 2), derive_car: r(der.physical_car.aero.corner.CLA_front_m2 + der.physical_car.aero.corner.CLA_rear_m2, 2), derive_car_sd: 0.94 }, "m2", "per model", "fitted", ["repo_identify", "repo_derived"], "each is effective for its own tyre law (identify: load-sensitive per-car mu; derive-car: no load sensitivity, so ClA trades 1:1 with mu)", [U.IDN, U.DER]);
  e("aero", "aero.cda_corner_effective", "Drag area, Corner Mode (effective: includes tyre scrub and cooling)", 1.2, "m2", { sd: 0.15, physical_prior_range: [0.75, 1.25] }, "fitted", ["repo_derived", "repo_identify", "repo_sim"], "three independent fits agree: derive-car 1.23 +- 0.17 (HAD lap, 350 kW anchor), identify 1.26 +- 0.16 (9 circuits), sim 1.23 (baseline x cda_scale 1.039). All conditional on an ICE of ~395-425 kW: +21 kW of ICE moves CdA by ~+0.09", [U.SIM, U.FIT, U.PHYS, U.DER, U.IDN]);
  e("aero", "aero.cda_straight_effective", "Drag area, Straight Mode (effective)", 0.95, "m2", { sd: 0.15 }, "fitted", ["repo_derived", "repo_sim", "repo_identify"], "aero.cda_corner_effective - aero.straight_mode_delta_cda (0.93); sim 0.987; derive-car 0.96; identify 0.91 +- 0.13", [U.SIM, U.FIT, U.PHYS]);
  e("aero", "aero.straight_mode_delta_cda", "Drag removed by Straight Mode", 0.27, "m2", { sd: 0.06 }, "derived", ["repo_derived"], "apparent-power step across the A3/A4 activation points on 22 Silverstone laps (REDBULL-DERIVED.md 2): the PU output does not jump, so the step is dCdA x 0.5 rho v^3", [U.SIM]);
  e("aero", "aero.straight_over_corner_cda", "CdA Straight / Corner", 0.8, "-", { sd: 0.05, range: [0.72, 0.85] }, "reported", ["pr:raceteq_sm", "pr:sf_sm", "repo_derived", "repo_identify"], "simulations of a generic 2026 car: 0.82 and 0.79; derive-car 0.78; sim 0.80; identify 0.72 +- 0.08 (prior-dominated)", [U.SIM, U.FIT]);
  e("aero", "aero.straight_over_corner_cla", "ClA Straight / Corner", 0.72, "-", { sd: 0.04, range: [0.68, 0.8] }, "reported", ["pr:raceteq_sm", "pr:sf_sm"], "simulations: 0.75 and 0.69 (the floor carries more of the load in Straight Mode); sim 0.719", [U.SIM]);
  e("aero", "aero.balance_front", "Aero balance (front share of downforce, Corner Mode)", 0.44, "-", { sd: 0.02, range: [0.4, 0.47] }, "estimate", ["pr:anderson_ge", "pr:perantoni"], "not separable from speed/position telemetry; worked examples 0.41-0.44; the sim fits 0.4415 on the pole lap (balance acts only through the weaker-axle limit)", [U.SIM, U.PHYS]);
  e("aero", "aero.floor_share", "Floor share of downforce (Corner Mode)", 0.55, "-", { range: [0.45, 0.65] }, "reported", ["pr:sf_sm"], "simulation 47 %, secondary reports ~60 % (PRIORS.md); sim MODEL.floor.share 0.55", [U.SIM]);
  e("aero", "aero.ride_height_sensitivity", "Downforce change per mm of ride height", 0.5, "% per mm", { range: [0.3, 0.8] }, "estimate", ["repo_priors", "therace_rake_2026"], "no public 2022-26 number (PRIORS.md); 2026 floors reported less ride-height sensitive than 2022-25 (The Race, Temple); sim and aeromap use 0.6", [U.SIM, U.PHYS]);
  e("aero", "aero.active_aero", "Active aero", "front + rear flaps, two positions, <= 400 ms transition, fails to Corner Mode; RB22 rear flap rotates 'up and over' (reported 160-180 deg) from Miami", "-", "exact rule; angle reported", "regulation", ["rb:fia_c19", "rb:therace_wing"], "C3.10.10, C3.11.6", [U.SIM, U.PHYS]);
  e("aero", "aero.silverstone_trim", "Silverstone wing level vs the RB22's 9-circuit mean (identify trims)", { downforce_trim_w: r(it.w.mean, 3), w_sd: r(it.w.sd, 3), drag_trim_d: r(it.d.mean, 3), d_sd: r(it.d.sd, 3) }, "ln ratio", "per trim", "fitted", ["repo_identify"], "ClA x e^w, CdA x e^d at Silverstone: about average downforce and ~+27 % drag (the drag trim also absorbs deployment strategy); the team did not publish its wing level", [U.IDN]);
  e("aero", "aero.p_over_cda", "ICE power over drag area (the best-determined drag/power combination)", r(ir.P_over_CdA_kw_m2.mean, 0), "kW/m2", { sd: r(ir.P_over_CdA_kw_m2.sd, 0) }, "fitted", ["repo_identify"], "IDENTIFY.md: speed traces cannot separate ICE power from drag; their ratio is better determined", [U.IDN]);

  // ---------------------------------------------------------------- setup (for the setup-factor helper)
  e("setup", "setup.ride_height_front", "Static front ride height (plank to ground)", 30, "mm", { range: [20, 45] }, "estimate", ["therace_rake_2026", "judgement"], "not public for any 2026 car; 2026 cars reported to run higher and with more rake than 2022-25", [U.SETUP, U.PHYS]);
  e("setup", "setup.ride_height_rear", "Static rear ride height (plank to ground)", 70, "mm", { range: [50, 95] }, "estimate", ["therace_rake_2026", "judgement"], "'rear ride heights between 2025 and the high-rake era' (The Race, Jan 2026); the design layer's single 35 mm is a mid-plank value", [U.SETUP, U.PHYS]);
  e("setup", "setup.rake", "Rake angle", 0.7, "deg", { range: [0.3, 1.2] }, "estimate", ["therace_rake_2026", "judgement"], "(rear - front ride height) / wheelbase = 40 / 3400 mm -> 0.67 deg; 2021 high-rake cars ran ~1-1.5 deg, 2022-25 ground-effect cars near flat", [U.SETUP]);
  e("setup", "setup.heave_stiffness", "Heave stiffness (whole car, at the tyre contact)", 3500, "N/mm", { range: [2000, 6000] }, "estimate", ["repo_sim", "judgement"], "sizes ~5 mm of aero squat under ~17 kN of Corner Mode load at 300 km/h (sim MODEL.heave_n_per_mm); 2026 platforms reported less stiff than 2022-25", [U.SIM, U.SETUP]);
  e("setup", "setup.roll_stiffness_front_share", "Front share of total roll stiffness", 0.55, "-", { range: [0.45, 0.65] }, "estimate", ["judgement"], "not public; front-biased roll stiffness keeps lateral load transfer off the rear axle (the RB22 is reported traction-strong at low speed) at the cost of front grip. The sim takes the weaker axle with no trim, so this is the lever the setup helper needs", [U.SETUP]);
  e("setup", "setup.suspension_layout", "Suspension layout", "pushrod front and rear", "-", "reported (Wikipedia lists pull-rod front: conflict)", "reported", ["rb:therace_anderson", "rb:gpfans_pushrod"], "Gary Anderson after the Barcelona test", [U.SETUP]);
  e("setup", "setup.diff_on_throttle_locking", "Differential locking on throttle (exit)", 0.6, "fraction locked", { range: [0.4, 0.9] }, "estimate", ["judgement"], "no public RB22 or 2026 data; F1 differentials are hydraulically controlled and drivers change entry/mid/exit settings from the wheel. More locking adds exit traction (the RB22's reported strength) and understeer", [U.SETUP]);
  e("setup", "setup.diff_entry_locking", "Differential locking off throttle (entry)", 0.3, "fraction locked", { range: [0.1, 0.5] }, "estimate", ["judgement"], "as above; less entry locking helps rotation; 2026 rear regen adds an entry braking torque the diff transmits", [U.SETUP]);
  e("setup", "setup.brake_duct_cooling", "Brake cooling demand, Silverstone", "low (Brembo difficulty index 1 of 5; 3 braking zones; 6.5 s per lap)", "-", "qualitative", "reported", ["brembo_uk_2026"], "duct size trades against drag; no public number. Silverstone needs the least brake cooling of the season", [U.SETUP]);
  e("setup", "setup.energy_map_q_silverstone", "Qualifying energy map (Silverstone)", "6.5 MJ recharge cap + 4 MJ window; full 350 kW out of Village/Loop, Luffield and Club onto the long straights; superclip at the ends of the pit, Wellington and Hangar straights", "-", "pattern", "derived", ["wk:fia_pu_info", "repo_derived", "repo_telemetry_all"], "ers.deployment_pattern + ers.clipping + the C5.12 tables", [U.SIM, U.SETUP]);
  return E;
}

// ================================================================ the sim check
// every number the physics sim uses for the RB22: the car's fields, the sim's model constants and default conditions.
// status: equal (|delta| <= 0.2 %), within_sd (|z| <= 1 with the sheet's sd or range/4), mapped (a documented effective-vs-physical
// or non-binding mapping), contradiction (reported with the lap effect of using the sheet value)
const SIM_MAP = [
  ["mass_kg", "mass.car_no_fuel"], ["fuel_kg", "mass.fuel_q"], ["wheelbase_m", "geom.wheelbase"], ["track_front_m", "geom.track_front"], ["track_rear_m", "geom.track_rear"],
  ["cog_height_m", "mass.cog_height"], ["weight_dist_front", "mass.weight_dist_front"], ["drivetrain_eff", "tx.drivetrain_efficiency"],
  ["aero.corner.CLA_total", "aero.cla_corner_sim_effective", "mapped", "effective CLA of the sim (its line curvature and tyre law); the physical estimate is aero.cla_corner_physical (3.9, 3.2-4.6). The sim value must equal the sheet's sim-effective entry; the comparable quantity is the lateral capacity (lateral_scale below)"],
  ["aero.corner.balance", "aero.balance_front"], ["aero.corner.CDA_m2", "aero.cda_corner_effective"], ["aero.straight.CDA_m2", "aero.cda_straight_effective"],
  ["aero.straight.CLA_ratio", "aero.straight_over_corner_cla"], ["aero.straight.CDA_ratio", "aero.straight_over_corner_cda"],
  ["aero.ride_height_mm", "setup.ride_height_front", "mapped", "the design layer's single static ride height (35 mm, a mid-plank value between the sheet's front 30 and rear 70 mm); the sim uses it only as the reference for squat"],
  ["aero.ride_sens_per_mm", "aero.ride_height_sensitivity", "percent"],
  ["aero.stall_margin_mm", null, "mapped", "a design-layer quantity (concept/aeromap.js at the 35 mm baseline), not a car property with a public counterpart"],
  ["pu.ice_kw", "pu.ice_power_peak"], ["pu.mguk_kw", "ers.mguk_power"],
  ["pu.es_deploy_mj_per_lap", null, "mapped", "a non-binding cap (12.5 MJ = 8.5 + 4): deployment is limited by the recharge cap (6.5 MJ in Silverstone Q) + the 4 MJ window (ers.recharge_q_silverstone, ers.soc_window)"],
  ["pu.es_harvest_mj_per_lap", "ers.recharge_max", "mapped", "the rule cap; the sim applies min(this, conditions.recharge_limit_mj = 6.5)"],
  ["tyres.mu_x", "tyre.mu_x"], ["tyres.mu_y", "tyre.mu_y"], ["tyres.load_sens_pct_per_kN", "tyre.load_sensitivity"], ["tyres.slip_angle_rad", "tyre.slip_angle_peak"], ["tyres.radius_m", "tyre.loaded_radius"],
  ["brakes.max_decel_g_mech", "brake.mech_capacity"],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(g => ["gearing.rpm_per_kmh[" + g + "]", "tx.gear" + g, "gear"]),
  ["gearing.shift_rpm", "pu.upshift_rpm"],
  ["MODEL.crr", null, "mapped", "rolling resistance: not public (priors 0.008-0.020); the same 0.012 in derive-car and identify"],
  ["MODEL.rot_mass_factor", null, "mapped", "rotating-mass factor: wheels 4 kg m2 + engine through the gear (derive-car) give 1.02-1.06 by gear; 1.03 is the mid-gear value"],
  ["MODEL.rear_brake_share", "brake.balance_front", "complement"], ["MODEL.superclip_kw", "ers.superclip_power"], ["MODEL.upshift_cut_s", "tx.upshift_torque_interruption"],
  ["MODEL.heave_n_per_mm", "setup.heave_stiffness"], ["MODEL.floor.share", "aero.floor_share"],
  ["REGS.mguk_max_kw", "ers.mguk_power"], ["REGS.es_soc_window_mj", "ers.soc_window"], ["REGS.recharge_max_mj", "ers.recharge_max"], ["REGS.ers_eff", "ers.conversion_factor"], ["REGS.fuel_energy_flow_mj_h", "pu.fuel_energy_flow_max"],
  ["conditions.recharge_limit_mj", "ers.recharge_q_silverstone"],
];
function simValues(car) {
  const S = require("../sim/lapsim.js"), a = car.aero, cla = a.corner.CLA_front_m2 + a.corner.CLA_rear_m2, m = car.mass_kg + car.fuel_kg;
  const v = { mass_kg: car.mass_kg, fuel_kg: car.fuel_kg, wheelbase_m: car.wheelbase_m, track_front_m: car.track_front_m, track_rear_m: car.track_rear_m, cog_height_m: car.cog_height_m, weight_dist_front: car.weight_dist_front, drivetrain_eff: car.drivetrain_eff,
    "aero.corner.CLA_total": cla, "aero.corner.balance": a.corner.CLA_front_m2 / cla, "aero.corner.CDA_m2": a.corner.CDA_m2, "aero.straight.CDA_m2": a.straight.CDA_m2,
    "aero.straight.CLA_ratio": (a.straight.CLA_front_m2 + a.straight.CLA_rear_m2) / cla, "aero.straight.CDA_ratio": a.straight.CDA_m2 / a.corner.CDA_m2,
    "aero.ride_height_mm": a.ride_height_mm, "aero.ride_sens_per_mm": a.ride_sens_per_mm, "aero.stall_margin_mm": a.stall_margin_mm,
    "pu.ice_kw": car.pu.ice_kw, "pu.mguk_kw": car.pu.mguk_kw, "pu.es_deploy_mj_per_lap": car.pu.es_deploy_mj_per_lap, "pu.es_harvest_mj_per_lap": car.pu.es_harvest_mj_per_lap,
    "tyres.mu_x": car.tyres.mu_x, "tyres.mu_y": car.tyres.mu_y, "tyres.load_sens_pct_per_kN": (car.tyres.load_sens / ((m * 9.81) / 4 / 1000)) * 100, "tyres.slip_angle_rad": car.tyres.slip_angle_rad != null ? car.tyres.slip_angle_rad : S.MODEL.slip_angle_rad, "tyres.radius_m": car.tyres.radius_m,
    "brakes.max_decel_g_mech": car.brakes.max_decel_g_mech, "gearing.shift_rpm": car.gearing.shift_rpm,
    "MODEL.crr": S.MODEL.crr, "MODEL.rot_mass_factor": S.MODEL.rot_mass_factor, "MODEL.rear_brake_share": S.MODEL.rear_brake_share, "MODEL.superclip_kw": car.pu.superclip_kw != null ? car.pu.superclip_kw : S.MODEL.superclip_kw, "MODEL.upshift_cut_s": S.MODEL.upshift_cut_s,
    "MODEL.heave_n_per_mm": a.heave_n_per_mm != null ? a.heave_n_per_mm : S.MODEL.heave_n_per_mm, "MODEL.floor.share": a.floor_share != null ? a.floor_share : S.MODEL.floor.share,
    "REGS.mguk_max_kw": S.REGS.mguk_max_kw, "REGS.es_soc_window_mj": S.REGS.es_soc_window_mj, "REGS.recharge_max_mj": S.REGS.recharge_max_mj, "REGS.ers_eff": S.REGS.ers_eff, "REGS.fuel_energy_flow_mj_h": S.REGS.fuel_energy_flow_mj_h,
    "conditions.recharge_limit_mj": S.DEFAULT_CONDITIONS.recharge_limit_mj };
  car.gearing.rpm_per_kmh.forEach((x, i) => { v["gearing.rpm_per_kmh[" + (i + 1) + "]"] = x; });
  return v;
}
function sdOf(en) {
  const s = en.sd_or_range;
  if (s && typeof s === "object") { if (s.sd != null && typeof s.sd === "number") return s.sd; if (Array.isArray(s.range) && typeof s.range[0] === "number") return (s.range[1] - s.range[0]) / 4; }
  return null;
}
function simCheck(entries) {
  const sim = require("../sim/index.js"), car = sim.baselineCar("redbull"), V = simValues(car), byId = Object.fromEntries(entries.map(x => [x.id, x]));
  const base = sim.simulateLap(car, "silverstone").lap_s, rows = [];
  const lapWith = mut => { const c = JSON.parse(JSON.stringify(car)); mut(c); return r(sim.simulateLap(c, "silverstone").lap_s - base, 3); };
  for (const [field, id, mode, note] of SIM_MAP) {
    const en = id ? byId[id] : null, sv = V[field];
    if (id && !en) throw new Error("rb22-sheet: SIM_MAP names a missing entry " + id);
    const row = { field, sim_value: typeof sv === "number" ? r(sv, 4) : sv, sheet_id: id };
    if (mode === "mapped") {
      row.sheet_value = en ? en.value : null; row.status = "mapped"; row.mapping = note;
      if (id === "aero.cla_corner_sim_effective" && Math.abs(sv - en.value) > 0.002) row.status = "contradiction";
      rows.push(row); continue;
    }
    let target = en.value, sd = sdOf(en);
    if (mode === "gear") { target = en.sd_or_range.rpm_per_kmh; sd = Math.max(en.sd_or_range.rpm_per_kmh_sd, 0.005 * target); row.mapping = "sheet km/h per 1000 rpm -> rpm per km/h = 1000 / value"; }
    if (mode === "percent") { target = en.value / 100; sd = sd != null ? sd / 100 : null; row.mapping = "sheet in % per mm, the sim as a fraction per mm"; }
    if (mode === "complement") { target = r(1 - en.value, 4); row.mapping = "the sim uses the rear share = 1 - front balance"; }
    row.sheet_value = target; row.sheet_sd = sd != null ? r(sd, 4) : null;
    const d = sv - target, tol = Math.max(1e-6, Math.abs(target) * 0.002);
    if (Math.abs(d) <= tol) row.status = "equal";
    else if (sd != null && Math.abs(d) <= sd + 1e-9) { row.status = "within_sd"; row.z = r(d / sd, 2); }
    else { row.status = "contradiction"; row.z = sd ? r(d / sd, 2) : null; }
    rows.push(row);
  }
  // lap effect of each contradiction: the sheet value substituted, everything else unchanged
  const sheetGears = [1, 2, 3, 4, 5, 6, 7, 8].map(g => byId["tx.gear" + g].sd_or_range.rpm_per_kmh), upMed = byId["pu.upshift_rpm"].value;
  for (const row of rows.filter(x => x.status === "contradiction")) {
    row.lap_effect_s = null;
    if (row.field === "mass_kg") row.lap_effect_s = lapWith(c => { c.mass_kg = row.sheet_value; });
    else if (/^gearing\.rpm_per_kmh/.test(row.field)) { const g = +row.field.match(/\[(\d)\]/)[1]; row.lap_effect_s = lapWith(c => { c.gearing.rpm_per_kmh[g - 1] = sheetGears[g - 1]; }); }
    else if (row.field === "gearing.shift_rpm") row.lap_effect_s = lapWith(c => { c.gearing.shift_rpm = row.sheet_value; });
    else if (row.field === "fuel_kg") row.lap_effect_s = lapWith(c => { c.fuel_kg = row.sheet_value; });
  }
  const all = lapWith(c => { c.mass_kg = byId["mass.car_no_fuel"].value; c.gearing.rpm_per_kmh = sheetGears.slice(); c.gearing.shift_rpm = upMed; });
  // comparable lateral and braking quantities: the sim's capacity against the telemetry (estimator scale stated)
  const lat = byId["lat.envelope_by_speed"].value, cap = k => sim.capacity(car, k);
  const latRows = lat.filter(b => b.n >= 10).map(b => { const mid = (b.kmh[0] + b.kmh[1]) / 2, c = cap(mid).ay_g; return { kmh: mid, sim_ay_g: r(c, 2), telemetry_ay_g: b.ay_g, ratio_tel_over_sim: r(b.ay_g / c, 2) }; });
  const br = byId["brake.peak_decel_hard_stop"], cb = cap(226).brake_g;
  // lap time per +1 sd of the sheet's uncertain quantities, on the sim's RB22 (one at a time): which unknowns matter
  const sc = (c, k) => { for (const m of ["corner", "straight"]) { c.aero[m].CLA_front_m2 *= k; c.aero[m].CLA_rear_m2 *= k; } };
  const bal = (c, d) => { for (const m of ["corner", "straight"]) { const t = c.aero[m].CLA_front_m2 + c.aero[m].CLA_rear_m2, b = c.aero[m].CLA_front_m2 / t + d; c.aero[m].CLA_front_m2 = t * b; c.aero[m].CLA_rear_m2 = t * (1 - b); } };
  const sens = [   // [sheet id, 1 sd step, f(car, sign)]
    ["mass.car_no_fuel", "4 kg", (c, s) => { c.mass_kg += 4 * s; }],
    ["pu.ice_power_peak", "15 kW", (c, s) => { c.pu.ice_kw += 15 * s; }],
    ["aero.cda_corner_effective", "0.15 m2 (12.5 %, both modes)", (c, s) => { c.aero.corner.CDA_m2 *= 1 + 0.125 * s; c.aero.straight.CDA_m2 *= 1 + 0.125 * s; }],
    ["aero.straight_mode_delta_cda", "0.06 m2 more Straight Mode relief", (c, s) => { c.aero.straight.CDA_m2 -= 0.06 * s; }],
    ["aero.cla_corner_sim_effective", "5 % CLA (about the lateral-envelope uncertainty at 200-250 km/h)", (c, s) => sc(c, 1 + 0.05 * s)],
    ["aero.balance_front", "0.02 front", (c, s) => bal(c, 0.02 * s)],
    ["tyre.mu_y", "0.1", (c, s) => { c.tyres.mu_y += 0.1 * s; }],
    ["tyre.mu_x", "0.1", (c, s) => { c.tyres.mu_x += 0.1 * s; }],
    ["mass.cog_height", "0.025 m", (c, s) => { c.cog_height_m += 0.025 * s; }],
    ["mass.weight_dist_front", "0.007", (c, s) => { c.weight_dist_front += 0.007 * s; }],
    ["tx.drivetrain_efficiency", "0.01", (c, s) => { c.drivetrain_eff += 0.01 * s; }],
    ["mass.fuel_q", "2 kg", (c, s) => { c.fuel_kg += 2 * s; }],
  ].map(([id, step, f]) => ({ sheet_id: id, step, lap_delta_plus_s: lapWith(c => f(c, 1)), lap_delta_minus_s: lapWith(c => f(c, -1)) }));
  const mass10 = [-10, 10].map(d => lapWith(c => { c.mass_kg += d; }));
  return {
    car: "concept/sim baselineCar('redbull')", car_label: car.label, lap_s: base,
    sheet_fix_lap_delta_s: all, sheet_fix_note: "lap change with mass " + byId["mass.car_no_fuel"].value + " kg, all eight measured gear ratios and the measured upshift rpm (" + upMed + ") together",
    rows, counts: rows.reduce((o, x) => { o[x.status] = (o[x.status] || 0) + 1; return o; }, {}),
    contradictions: rows.filter(x => x.status === "contradiction").map(x => ({ field: x.field, sim: x.sim_value, sheet: x.sheet_value, sheet_id: x.sheet_id, z: x.z, lap_effect_s: x.lap_effect_s })),
    lateral_scale: { rows: latRows, mapping: "telemetry a_y (v^2 max|kappa| on each lap's own smoothed x/y) reads above the sim's capacity on its averaged line by about the 20-40 % factor IDENTIFY.md documents for this estimator against an x/y-acceleration estimate; the sim's CLA (5.32 m2) is fitted on its own line, so this ratio, not a CLA value, is the transferable check" },
    lap_sensitivity_per_sd: { note: "the sim's RB22 lap, one sheet quantity moved by +1 sd and -1 sd at a time; where both signs move the lap the same way the baseline sits on a ridge of the regulated energy plan (SIM.md 3.5: up to ~0.015 s noise per step; larger here)", rows: sens, mass_pm10kg_s: mass10, mass_slope_s_per_kg_10kg: r((mass10[1] - mass10[0]) / 20, 4), public_mass_slope_s_per_kg: [0.025, 0.035] },
    braking: { sim_brake_g_at_226_kmh: r(cb, 2), sheet_hard_stop_g: br.value, sheet_sd: sdOf(br), status: Math.abs(cb - br.value) <= sdOf(br) ? "within_sd" : "outside", note: "the sim's tyre-limited braking capacity (Corner Mode, incl. drag) at the Village peak speed against the sheet's hard-stop peak" },
  };
}

// ================================================================ build / CLI
function build() {
  const T = telemetry(), entries = buildEntries(T), sources = allSources();
  for (const en of entries) for (const s of en.sources) if (!sources[s]) throw new Error("rb22-sheet: entry " + en.id + " cites unknown source " + s);
  const used = new Set(entries.flatMap(x => x.sources)), src = {}; for (const k of [...used].sort()) src[k] = sources[k];
  return {
    _meta: { what: "Red Bull RB22 / Red Bull Ford DM01 data sheet: one entry per quantity, with its kind, uncertainty, sources, derivation and the files that use it. Companion prose: docs/concept/RB22_SHEET.md. Generated by node concept/tools/rb22-sheet.js --write (deterministic).", built: "2026-10-24",
      kinds: { regulation: "FIA 2026 Section C text (Issue 19, in force at Silverstone; unchanged in Issue 21 unless noted)", official: "FIA / F1 / team / Pirelli / supplier statement or document", reported: "press, third-party simulations, forums (grade in the source's how)", derived: "computed from public telemetry or regulation numbers, method in derivation", fitted: "a model estimate made in this repo (sim, identify, derive-car): an effective value of that model", estimate: "judgement where nothing is public, always with a range" },
      label: "public data and estimates only; not team data" },
    sources: src, entries, telemetry: T, sim_check: simCheck(entries),
  };
}
const stable = o => JSON.stringify(o, null, 1) + "\n";
function main() {
  const args = process.argv.slice(2);
  if (args.includes("--tel")) { console.log(JSON.stringify(telemetry(), null, 1)); return; }
  const S = build();
  if (args.includes("--write")) { fs.writeFileSync(OUT, stable(S)); console.log("wrote " + path.relative(ROOT, OUT) + " (" + S.entries.length + " entries)"); }
  if (args.includes("--check")) { const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : ""; if (cur !== stable(S)) { console.error("rb22-sheet: concept/data/rb22-sheet.json is stale; run node concept/tools/rb22-sheet.js --write"); process.exit(1); } console.log("rb22-sheet: up to date"); }
  const fmt = v => (typeof v === "number" ? String(v) : typeof v === "string" ? (v.length > 60 ? v.slice(0, 57) + "..." : v) : Array.isArray(v) ? "[table]" : "{...}");
  for (const en of S.entries) console.log([en.id.padEnd(34), fmt(en.value).padEnd(62), String(en.unit).padEnd(18), en.kind].join(" "));
  console.log("\nsim check (" + S.sim_check.car + ", lap " + S.sim_check.lap_s + " s): " + JSON.stringify(S.sim_check.counts));
  for (const c of S.sim_check.contradictions) console.log("  CONTRADICTION " + JSON.stringify(c));
  console.log("  sheet values substituted together: " + S.sim_check.sheet_fix_lap_delta_s + " s");
}
module.exports = { telemetry, buildEntries, simCheck, simValues, build, stable, SIM_MAP, BREMBO, A, OUT };
if (require.main === module) main();
