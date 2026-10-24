// PURPLE CONCEPT - identify / data: lap loading, signal conditioning and feature extraction for the multi-circuit car
// identification (concept/identify/identify.js). Reads the 2026 qualifying telemetry of 9 circuits (OpenF1, 5 m grid) and the
// telemetry audit (concept/data/telemetry/audit/telemetry_audit.csv). Null-safe: OpenF1 car_data dropouts are null on the grid
// and no derivative, corner, brake zone or full-throttle run is ever taken across a gap.
// Method and equations: docs/concept/IDENTIFY.md.  Node only, no dependencies.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const TEL = path.join(ROOT, "concept", "data", "telemetry");
const G0 = 9.80665;
const readJSON = p => JSON.parse(fs.readFileSync(p, "utf8"));

// ================================================================ small numerics
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const quantile = (a, q) => { const b = a.slice().sort((x, y) => x - y); if (!b.length) return NaN; const i = (b.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); };
const median = a => quantile(a, 0.5);
const mad = a => { const m = median(a); return 1.4826 * median(a.map(x => Math.abs(x - m))); };
const rnd = (x, d) => { if (x == null || !isFinite(x)) return null; const f = 10 ** (d == null ? 4 : d); return Math.round(x * f) / f; };
function solve3(A, b) { // tiny Gaussian elimination (local quadratic regression)
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

// ================================================================ circuits, teams, power units
// type: why the circuit is in the set (low drag / max downforce / fast / slow / power). recharge_q_mj: qualifying per-lap
// Recharge limit (C5.2.10). Only Silverstone's is known (FIA British GP PU information, 6.5 MJ); the per-event documents for the
// other eight were not collected, so 6.5 MJ is ASSUMED there (C5.2.10 allows 8.5 down to 5 MJ in Q/SQ, Issue 19). The fit never
// uses it; only the lap simulator's energy budget does (see IDENTIFY.md).
const CIRCUITS = {
  silverstone: { name: "Silverstone", dir: TEL, prefix: "silverstone-2026-q-", type: "fast", recharge_q_mj: 6.5, recharge_basis: "FIA British GP PU information (official)",
    // FIA event-map Straight Mode activation points (as in concept/tools/derive-car.js); zone ends are not printed
    fia_zones: [{ zone: "A1", after: 18, m: 65, endBefore: 1, endOffset: -100 }, { zone: "A2", after: 5, m: 55, endBefore: 6, endOffset: 0 }, { zone: "A3", after: 7, m: 155, endBefore: 9, endOffset: 0 }, { zone: "A4", after: 14, m: 65, endBefore: 15, endOffset: 0 }] },
  austria: { name: "Red Bull Ring", type: "power" },
  hungaroring: { name: "Hungaroring", type: "slow" },
  monaco: { name: "Monaco", type: "max downforce" },
  montreal: { name: "Montreal", type: "power" },
  monza: { name: "Monza", type: "low drag" },
  singapore: { name: "Singapore", type: "slow" },
  spa: { name: "Spa", type: "fast" },
  suzuka: { name: "Suzuka", type: "fast" },
};
for (const [id, c] of Object.entries(CIRCUITS)) {
  if (!c.dir) { c.dir = path.join(TEL, id); c.prefix = `${id}-2026-q-`; c.recharge_q_mj = 6.5; c.recharge_basis = "assumption: per-event FIA PU information not collected; Silverstone's 6.5 MJ used"; }
  c.id = id;
  c.corners_file = path.join(c.dir, `${id}-circuit.json`);
  c.weather_file = path.join(c.dir, `${c.prefix}weather.json`);
  c.index_file = path.join(c.dir, `${c.prefix}index.json`);
}
const CIRCUIT_IDS = Object.keys(CIRCUITS);

// OpenF1 team names -> grid-2026.json team ids. Drivers are mapped to teams PER EVENT from each lap file's driver.team (OpenF1's
// Monza line-up has LAW at Red Bull Racing and TSU at Racing Bulls, and no HAD).
const TEAM_BY_NAME = { "Mercedes": "mercedes", "Ferrari": "ferrari", "McLaren": "mclaren", "Red Bull Racing": "redbull", "Racing Bulls": "racingbulls", "Alpine": "alpine", "Haas F1 Team": "haas", "Audi": "audi", "Williams": "williams", "Aston Martin": "astonmartin", "Cadillac": "cadillac" };
const PU_FAMILY = { "Mercedes-AMG F1 M17": "mercedes", "Ferrari 067/6": "ferrari", "Red Bull Ford DM01": "redbullford", "Honda RA626H": "honda", "Audi AFR 26 Hybrid": "audi" };
const PU_NAMES = { mercedes: "Mercedes M17", ferrari: "Ferrari 067/6", redbullford: "Red Bull Ford DM01", honda: "Honda RA626H", audi: "Audi AFR 26" };
const GRID = readJSON(path.join(ROOT, "concept", "data", "grid-2026.json"));
function overweightKg(str) { if (!str || /under|right on/i.test(str)) return 0; const m = String(str).match(/\+\s*(\d+)(?:\s*\/\s*(\d+))?/); return m ? (m[2] ? (+m[1] + +m[2]) / 2 : +m[1]) : 0; }
const TEAMS = GRID.teams.map(t => { const mv = t.mass_vs_minimum && t.mass_vs_minimum.value; return { id: t.id, name: t.constructor.value, pu_name: t.power_unit.value, pu: PU_FAMILY[t.power_unit.value], overweight_kg: overweightKg(mv), overweight_reported: mv }; });
const TEAM_IDS = TEAMS.map(t => t.id);
const PU_IDS = ["mercedes", "ferrari", "redbullford", "honda", "audi"];

// ================================================================ telemetry audit (concept/data/telemetry/audit/)
function parseCSV(text) {
  const rows = [], lines = text.trim().split(/\r?\n/);
  const split = line => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0]);
  for (const l of lines.slice(1)) { const c = split(l), o = {}; head.forEach((h, i) => { o[h] = c[i]; }); rows.push(o); }
  return rows;
}
let AUDIT = null;
function audit() {
  if (AUDIT) return AUDIT;
  const f = path.join(TEL, "audit", "telemetry_audit.csv"); AUDIT = {};
  if (!fs.existsSync(f)) return AUDIT;
  for (const r of parseCSV(fs.readFileSync(f, "utf8"))) if (r.session === "qualifying") AUDIT[r.file] = r;
  return AUDIT;
}
// per-lap masks from the audit: which channels/fits must not use this file
function auditFlags(file) {
  const r = audit()[file]; const fl = { status: r ? r.overall : "n/a", reasons: r ? r.reasons : "", brake_unknown: false, geometry_bad: false, accel_outliers: 0 };
  if (!r) return fl;
  if (+r.raw_brake_bad > 0) fl.brake_unknown = true;                      // raw brake 104 leaked into the grid: brake treated as unknown
  if (r.C2 === "FAIL") fl.geometry_bad = true;                             // distance axis vs X/Y (Singapore STR, 4.9 % short)
  fl.accel_outliers = +r.accel_viol_total || 0;                             // robust losses + per-point plausibility mask
  return fl;
}

// ================================================================ air density (weather samples around the lap)
function airDensity(W, utcIso, durS) {
  const t0 = Date.parse(utcIso), t1 = t0 + durS * 1000, idx = [];
  W.date_utc.forEach((d, i) => { const t = Date.parse(d); if (t >= t0 - 90e3 && t <= t1 + 90e3) idx.push(i); });
  if (!idx.length) { let b = 0, bd = Infinity; W.date_utc.forEach((d, i) => { const dd = Math.abs(Date.parse(d) - t0); if (dd < bd) { bd = dd; b = i; } }); idx.push(b); }
  const T = mean(idx.map(i => W.air_temperature[i])), p = mean(idx.map(i => W.pressure[i])) * 100, rh = mean(idx.map(i => W.humidity[i])) / 100;
  const pv = rh * 610.94 * Math.exp((17.625 * T) / (T + 243.04)), Tk = T + 273.15; // Magnus
  return { rho: (p - pv) / (287.058 * Tk) + pv / (461.495 * Tk), air_c: T, track_c: mean(idx.map(i => W.track_temperature[i])), pressure_hpa: p / 100, humidity_pct: rh * 100, wind_ms: mean(idx.map(i => W.wind_speed[i])) };
}

// ================================================================ signal conditioning
// local quadratic regression of speed against time over ±h s (smoothed v and dv/dt). Only valid samples; a window that would reach
// across a dropout (null) is flagged (aok = false) so no derivative is taken across a gap. Lap-file ends truncate the window.
function kinematics(t, v, h) {
  const n = t.length, vo = new Array(n).fill(null), ao = new Array(n).fill(null), aok = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (v[i] == null) continue;
    const S = [0, 0, 0, 0, 0], T = [0, 0, 0]; let gap = false, cnt = 0;
    const acc = j => { const x = t[j] - t[i], y = v[j]; let p = 1; for (let k = 0; k < 5; k++) { S[k] += p; if (k < 3) T[k] += p * y; p *= x; } cnt++; };
    for (let j = i; j >= 0 && t[i] - t[j] <= h; j--) { if (v[j] == null) { gap = true; break; } acc(j); }
    for (let j = i + 1; j < n && t[j] - t[i] <= h; j++) { if (v[j] == null) { gap = true; break; } acc(j); }
    if (cnt < 4) continue;
    const beta = solve3([[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]], T);
    vo[i] = beta[0]; ao[i] = beta[1]; aok[i] = !gap;
  }
  return { v: vo, a: ao, aok };
}
// curvature from X/Y (complete in every file): Gaussian smoothing over max(smin, τ·v) metres, then κ = (x'y'' − y'x'')/(x'²+y'²)^1.5
function curvature(x, y, vEst, tau, smin) {
  const n = x.length;
  const sm = a => { const o = new Array(n); for (let i = 0; i < n; i++) { const sg = Math.max(smin, tau * vEst[i]), h = Math.ceil((3 * sg) / 5); let w = 0, z = 0; for (let k = -h; k <= h; k++) { const j = (i + k + n) % n, ww = Math.exp(-0.5 * ((k * 5) / sg) ** 2); w += ww; z += ww * a[j]; } o[i] = z / w; } return o; };
  const xs = sm(x), ys = sm(y), k = new Array(n);
  for (let i = 0; i < n; i++) { const a = (i - 1 + n) % n, b = (i + 1) % n, dx = (xs[b] - xs[a]) / 2, dy = (ys[b] - ys[a]) / 2, ddx = xs[b] - 2 * xs[i] + xs[a], ddy = ys[b] - 2 * ys[i] + ys[a]; k[i] = (dx * ddy - dy * ddx) / Math.pow(dx * dx + dy * dy, 1.5); }
  return k;
}
const gauss1 = (a, sigPts) => { const n = a.length, h = Math.ceil(3 * sigPts), o = new Array(n); for (let i = 0; i < n; i++) { let w = 0, z = 0; for (let k = -h; k <= h; k++) { const ww = Math.exp(-0.5 * (k / sigPts) ** 2); w += ww; z += ww * a[(i + k + n) % n]; } o[i] = z / w; } return o; };

// ================================================================ lap loading
const ASSUME = {
  r_eff_m: 0.348,            // loaded rolling radius (priors: tyre_loaded_rolling_radius 0.340-0.355)
  tau_s: 0.3,                // x/y smoothing time constant (as derive-car)
  straight_radius_m: 900, straight_min_len_m: 250, straight_trim_m: 30, // Straight Mode heuristic where no FIA zone map is held (as concept/sim/track.js)
  accel_max_g: 1.8, decel_max_g: 6.5, // per-point plausibility mask (telemetry audit C4 limits)
  lat_max_g: 7.0,            // corner points above this smoothed lateral g are curvature glitches (audit C4)
};
const CACHE = new Map();
function lapFiles(cid) {
  const C = CIRCUITS[cid], re = new RegExp("^" + C.prefix + "[a-z]{3}\\.json$");
  return fs.readdirSync(C.dir).filter(f => re.test(f)).map(f => f.slice(C.prefix.length, C.prefix.length + 3).toUpperCase()).sort();
}
const CIRC_STATIC = {};
function circuitStatic(cid) {
  if (CIRC_STATIC[cid]) return CIRC_STATIC[cid];
  const C = CIRCUITS[cid];
  return (CIRC_STATIC[cid] = { corners: readJSON(C.corners_file).corners, weather: readJSON(C.weather_file), index: readJSON(C.index_file) });
}
function loadLap(cid, code) {
  const key = cid + "|" + code; if (CACHE.has(key)) return CACHE.get(key);
  const C = CIRCUITS[cid], CS = circuitStatic(cid), file = `${C.prefix}${code.toLowerCase()}.json`, f = path.join(C.dir, file);
  if (!fs.existsSync(f)) { CACHE.set(key, null); return null; }
  const raw = readJSON(f), ch = raw.channels, n = ch.distance_m.length, fl = auditFlags(file);
  const team = TEAM_BY_NAME[raw.driver.team];
  if (!team) throw new Error(`unknown team "${raw.driver.team}" in ${file}`);
  const L = { cid, code: raw.driver.code, team, team_name_openf1: raw.driver.team, file, n, audit: fl, lap_time_s: raw.lap.lap_time_s, trap_kmh: raw.lap.speed_trap_kmh, date_start_utc: raw.lap.date_start_utc,
    dropouts: (raw.processing && raw.processing.dropouts) || [] };
  L.s = ch.distance_m; L.t = ch.time_s; L.x = ch.x_m; L.y = ch.y_m;
  L.vraw = ch.speed_kmh.map(x => (x == null ? null : x / 3.6)); L.thr = ch.throttle_pct; L.gear = ch.gear; L.rpm = ch.rpm;
  // brake: unknown (null) where the channel is null, and everywhere on a file whose raw brake carried the 104 error code
  L.brk = ch.brake.map(b => (b == null || fl.brake_unknown ? null : !!b));
  L.ok = L.vraw.map((v, i) => v != null && L.thr[i] != null && L.rpm[i] != null && L.gear[i] != null);
  const vIn = L.ok.map((o, i) => (o ? L.vraw[i] : null));
  const k1 = kinematics(L.t, vIn, 0.45); L.vs = k1.v; L.a = k1.a; L.aok = k1.aok;
  // plausibility mask on the smoothed acceleration (audit C4: > 1.8 g forward or < −6.5 g is not a car)
  for (let i = 0; i < n; i++) if (L.a[i] != null && (L.a[i] > ASSUME.accel_max_g * G0 || L.a[i] < -ASSUME.decel_max_g * G0)) L.aok[i] = false;
  // speed estimate everywhere (for smoothing widths): ds/dt of the distance axis
  const vEst = new Array(n); for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); vEst[i] = Math.max(10, (L.s[b] - L.s[a]) / Math.max(1e-3, L.t[b] - L.t[a])); }
  L.kappa = curvature(L.x, L.y, vEst, ASSUME.tau_s, 6);
  L.ay = L.kappa.map((k, i) => (L.vs[i] == null ? null : L.vs[i] ** 2 * Math.abs(k)));
  // distance axis vs X/Y path, 100 m windows: flags stretches where the speed-integral axis is broken (Singapore STR)
  const dxy = new Array(n).fill(5); for (let i = 0; i < n - 1; i++) dxy[i] = Math.hypot(L.x[i + 1] - L.x[i], L.y[i + 1] - L.y[i]);
  L.dsok = new Array(n).fill(true);
  for (let i = 0; i < n; i++) { let a = 0, b = 0; for (let k = -10; k <= 10; k++) { const j = Math.min(n - 2, Math.max(0, i + k)); a += L.s[j + 1] - L.s[j]; b += dxy[j]; } if (Math.abs(b / a - 1) > 0.15) L.dsok[i] = false; }
  if (fl.geometry_bad) L.dsok = L.dsok.map(() => false);
  L.xy_length_m = dxy.slice(0, n - 1).reduce((s, x) => s + x, 0);
  L.air = airDensity(CS.weather, raw.lap.date_start_utc, raw.lap.lap_time_s);
  L.cornerIdx = CS.corners.map(cn => { let b = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.hypot(L.x[i] - cn.x_m, L.y[i] - cn.y_m); if (d < bd) { bd = d; b = i; } } return b; });
  straightZones(L, C, CS);
  CACHE.set(key, L);
  return L;
}
// Straight Mode zones. Silverstone: FIA activation points (derive-car). Elsewhere: racing-line radius > 900 m for >= 250 m, opened
// 30 m after the run starts (concept/sim/track.js heuristic). zoneGeom = geometric flags for the simulator; zone = flags for the
// power trace (also closed at the first lift below 95 % or brake, like derive-car).
function straightZones(L, C, CS) {
  const n = L.n, zg = new Array(n).fill(false), zd = new Array(n).fill(false); L.zones = [];
  const lifted = j => (L.thr[j] != null && L.thr[j] < 95) || L.brk[j] === true;
  if (C.fia_zones) {
    for (const a of C.fia_zones) {
      const ci = CS.corners.findIndex(c => c.number === a.after), start = (L.cornerIdx[ci] + Math.round(a.m / 5)) % n;
      const e = (L.cornerIdx[CS.corners.findIndex(c => c.number === a.endBefore)] + Math.round(a.endOffset / 5) + n) % n;
      for (let k = start; k !== e; k = (k + 1) % n) zg[k] = true;
      let k = 0; while (k < n) { const j = (start + k) % n; if (lifted(j) || (k > 10 && L.ay[(j + 10) % n] != null && L.ay[(j + 10) % n] > 4 * G0)) break; zd[j] = true; k++; }
      L.zones.push({ zone: a.zone, start_idx: start, source: "FIA" });
    }
  } else {
    const ks = gauss1(L.kappa.map(Math.abs), 4), isS = i => ks[i] < 1 / ASSUME.straight_radius_m;
    let st = 0; while (st < n && isS(st)) st++;
    for (let k = 0; k < n;) {
      const i = (st + k) % n; if (!isS(i)) { k++; continue; }
      let k2 = k; while (k2 < n && isS((st + k2) % n)) k2++;
      if ((k2 - k) * 5 >= ASSUME.straight_min_len_m) {
        const s0 = k + Math.round(ASSUME.straight_trim_m / 5);
        for (let kk = s0; kk < k2; kk++) zg[(st + kk) % n] = true;
        for (let kk = s0; kk < k2; kk++) { const j = (st + kk) % n; if (lifted(j)) break; zd[j] = true; }
        L.zones.push({ zone: "H" + L.zones.length, start_idx: (st + s0) % n, length_m: (k2 - s0) * 5, source: "heuristic" });
      }
      k = k2;
    }
  }
  L.zoneGeom = zg; L.zone = zd;
}

// ================================================================ features
// grip-limited corner minima: a local speed minimum >= 15 km/h below the preceding peak; a_y = v_min²·max|κ| within ±40 m
// (the simulator's corner limit uses the same quantity). Only where every point of the ±40 m window has valid car data and the
// distance axis agrees with X/Y.
function cornerPoints(L) {
  const pts = [], n = L.n;
  for (let i = 8; i < n - 8; i++) {
    let ok = true, isMin = true;
    for (let j = i - 8; j <= i + 8; j++) { if (L.vs[j] == null || !L.dsok[j]) { ok = false; break; } if (L.vs[j] < L.vs[i] - 1e-9) isMin = false; }
    if (!ok || !isMin) continue;
    let vb = 0, va = 0; for (let j = Math.max(0, i - 80); j < i; j++) if (L.vs[j] != null) vb = Math.max(vb, L.vs[j]); for (let j = i + 1; j < Math.min(n, i + 40); j++) if (L.vs[j] != null) va = Math.max(va, L.vs[j]);
    if (vb - L.vs[i] < 15 / 3.6 || va - L.vs[i] < 5 / 3.6) continue;
    let km = 0; for (let j = i - 8; j <= i + 8; j++) km = Math.max(km, Math.abs(L.kappa[j]));
    const ay = L.vs[i] ** 2 * km;
    if (ay < 1.5 * G0 || ay > ASSUME.lat_max_g * G0) continue;
    if (pts.length && L.s[i] - pts[pts.length - 1].s < 60) continue;
    pts.push({ i, s: L.s[i], v: L.vs[i], kmh: L.vs[i] * 3.6, ay, kappa: km });
  }
  return pts;
}
// brake zones (entry > 140 km/h, > 50 km/h speed drop): fit window from brake onset + 0.25 s until 70 % of the drop
function brakeZones(L) {
  const zs = [], n = L.n; if (L.audit.brake_unknown) return zs;
  let i = 0;
  while (i < n) {
    if (L.brk[i] !== true) { i++; continue; }
    let j = i; while (j < n && L.brk[j] === true) j++;
    const pre = L.vs.slice(Math.max(0, i - 3), i + 1); if (pre.some(v => v == null)) { i = j; continue; }
    const vin = Math.max(...pre); let im = i, bad = false;
    for (let k = i; k < Math.min(n, j + 20); k++) { if (L.vs[k] == null) { bad = true; break; } if (L.vs[k] < L.vs[im]) im = k; }
    if (bad) { i = j; continue; }
    const vmin = L.vs[im];
    if (vin * 3.6 > 140 && (vin - vmin) * 3.6 > 50) {
      let i1 = i; while (i1 < n && L.t[i1] - L.t[i] < 0.25) i1++;
      let i2 = i1; while (i2 < im && L.vs[i2] > vmin + 0.3 * (vin - vmin)) i2++;
      let ok = i2 - i1 >= 4; for (let k = i1; k <= i2 && ok; k++) if (!L.aok[k] || !L.dsok[k] || L.ay[k] == null) ok = false;
      if (ok) zs.push({ i0: i, i1, i2, im, entry_kmh: vin * 3.6, min_kmh: vmin * 3.6, ds: L.s.slice(i1, i2 + 1).map((s, k, a) => (k ? s - a[k - 1] : 0)), ay: L.ay.slice(i1, i2 + 1), vobs: L.vs.slice(i1, i2 + 1) });
    }
    i = j;
  }
  return zs;
}
// full-throttle runs for the deployment anchor: throttle >= 99 %, no brake, valid and plausible derivative, no lift/brake/dropout
// within the next 0.45 s (the ±0.45 s speed fit would reach into it). Runs are split at any gap.
function fullThrottleRuns(L, r_eff) {
  const n = L.n, runs = []; let cur = null;
  for (let i = 0; i < n; i++) {
    let good = i > 6 && i < n - 6 && L.ok[i] && L.aok[i] && L.thr[i] >= 99 && L.brk[i] !== true && L.dsok[i] && L.ay[i] != null;
    if (good) for (let j = i + 1; j < n && L.t[j] - L.t[i] <= 0.45; j++) if (!L.ok[j] || L.thr[j] < 99 || L.brk[j] === true) { good = false; break; }
    if (!good) { cur = null; continue; }
    if (!cur) { cur = []; runs.push(cur); }
    const v = L.vs[i];
    cur.push({ i, s: L.s[i], v, kmh: v * 3.6, a: L.a[i], rpm: L.rpm[i], ay: L.ay[i], zone: L.zone[i], G: (r_eff * L.rpm[i] * 2 * Math.PI) / 60 / Math.max(v, 1) });
  }
  return runs.filter(r => r.length >= 10);
}
// gearing samples: v/ω per gear where the gear is steady (±2 points), rpm > 6000, no brake
function gearSamples(L) {
  const per = {}, ups = [];
  for (let i = 3; i < L.n - 3; i++) {
    if (!L.ok[i] || !L.ok[i - 2] || !L.ok[i + 2]) continue;
    const g = L.gear[i];
    if (g >= 1 && L.gear[i - 2] === g && L.gear[i + 2] === g && L.rpm[i] > 6000 && L.brk[i] !== true) (per[g] = per[g] || []).push(L.vraw[i] / ((L.rpm[i] * 2 * Math.PI) / 60));
    if (L.ok[i - 1] && L.gear[i] > L.gear[i - 1] && L.gear[i - 1] >= 2) { let r = 0; for (let j = i - 1; j >= 0 && L.t[i] - L.t[j] <= 0.4 && L.ok[j]; j--) r = Math.max(r, L.rpm[j]); ups.push(r); }
  }
  return { per, ups };
}

module.exports = { ROOT, TEL, G0, CIRCUITS, CIRCUIT_IDS, TEAMS, TEAM_IDS, TEAM_BY_NAME, PU_IDS, PU_NAMES, ASSUME, readJSON, mean, sd, quantile, median, mad, rnd,
  audit, auditFlags, lapFiles, loadLap, circuitStatic, cornerPoints, brakeZones, fullThrottleRuns, gearSamples, kinematics, curvature, airDensity };
