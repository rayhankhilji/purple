#!/usr/bin/env node
// PURPLE concept - regenerates concept/sim/line-silverstone.js: the sim's racing line and reference trace from the real 2026
// British GP pole lap (Antonelli, 88.111 s; OpenF1 telemetry in concept/data/telemetry/, see its README for source + licence).
// Usage: node concept/sim/build-line.js [telemetry-dir]   (default: concept/data/telemetry)
// What it does (deterministic, no network):
//   1. reads the pole lap (5 m grid: distance, time, speed, throttle, brake, x, y in the F1 timing frame) and the corner markers;
//   2. finds the similarity transform (offset along the lap, rotation, reflection) that maps the F1 timing frame onto the
//      OSM centreline frame of js/data/silverstone.js (x east, z south) by Procrustes over 400 lap-fraction samples;
//   3. writes the transformed path (OSM frame, trace distance as s), the timing lines measured on this lap (sector splits
//      where the lap's own time channel reaches S1 and S1+S2), the corner markers, and the reference speed trace.
"use strict";
const fs = require("fs"), path = require("path");
const T = require("./track.js");

const dir = process.argv[2] || path.join(__dirname, "..", "data", "telemetry");
const lap = JSON.parse(fs.readFileSync(path.join(dir, "silverstone-2026-q-ant.json"), "utf8"));
const circ = JSON.parse(fs.readFileSync(path.join(dir, "silverstone-circuit.json"), "utf8"));
const c = lap.channels, n = c.distance_m.length, Lt = c.distance_m[n - 1];
// the path: mean of every team lap's X/Y at the same lap fraction (11 laps, sampled asynchronously at ~3.9 Hz), which averages
// out position-sample glitches (one lap alone shows e.g. a 22 deg heading jump in 25 m before Copse). Speeds are NOT averaged:
// the reference trace stays the pole lap's own.
const lapFiles = fs.readdirSync(dir).filter(f => /^silverstone-2026-q-[a-z]{3}\.json$/.test(f)).sort();
const laps = lapFiles.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).channels);
function lapXY(ch, frac) {
  const m = ch.distance_m.length, L = ch.distance_m[m - 1], d = frac * L;
  const k = Math.min(m - 2, Math.max(0, Math.floor(d / 5))), t = (d - ch.distance_m[k]) / (ch.distance_m[k + 1] - ch.distance_m[k]);
  return [ch.x_m[k] + t * (ch.x_m[k + 1] - ch.x_m[k]), ch.y_m[k] + t * (ch.y_m[k + 1] - ch.y_m[k])];
}
const meanX = [], meanY = [];
for (let k = 0; k < n; k++) { let sx = 0, sy = 0; for (const ch of laps) { const [x, y] = lapXY(ch, c.distance_m[k] / Lt); sx += x; sy += y; } meanX.push(sx / laps.length); meanY.push(sy / laps.length); }
// v3: position-aligned averaging. Averaging at equal lap FRACTIONS mixes points that are up to ~15 m apart along the track (each
// lap's speed-integral distance drifts differently), which blurs the line where it turns hardest (Village, Vale-Club). So, PROJ_ITERS
// times: every lap's points are projected onto the current mean line (nearest point, searched around the fraction's index) and the
// median of the laps' lateral offsets per 5 m station moves the line; the stations stay on the pole lap's distance axis.
const PROJ_ITERS = process.argv.includes("--fraction-only") ? 0 : 2;
for (let it = 0; it < PROJ_ITERS; it++) {
  const N = meanX.length, nx = new Float64Array(N), ny = new Float64Array(N), offs = Array.from({ length: N }, () => []);
  for (let k = 0; k < N; k++) { const a = (k - 1 + N) % N, b = (k + 1) % N, dx = meanX[b] - meanX[a], dy = meanY[b] - meanY[a], l = Math.hypot(dx, dy) || 1; nx[k] = -dy / l; ny[k] = dx / l; }
  for (const ch of laps) {
    const m = ch.distance_m.length, L = ch.distance_m[m - 1], acc = new Map();
    for (let q = 0; q < m; q++) {
      const x = ch.x_m[q], y = ch.y_m[q]; if (!(isFinite(x) && isFinite(y))) continue;
      const k0 = Math.round((ch.distance_m[q] / L) * N);
      let best = -1, bd = Infinity;
      for (let d = -8; d <= 8; d++) { const k = (((k0 + d) % N) + N) % N, e = (x - meanX[k]) ** 2 + (y - meanY[k]) ** 2; if (e < bd) { bd = e; best = k; } }
      const o = (x - meanX[best]) * nx[best] + (y - meanY[best]) * ny[best];
      if (!acc.has(best)) acc.set(best, []); acc.get(best).push(o);
    }
    for (const [k, v] of acc) offs[k].push(v.reduce((p, z) => p + z, 0) / v.length);
  }
  const med = a => { if (!a.length) return 0; const s = a.slice().sort((p, q) => p - q), h = s.length >> 1; return s.length % 2 ? s[h] : 0.5 * (s[h - 1] + s[h]); };
  const raw = offs.map(med), sm = new Float64Array(N);
  for (let k = 0; k < N; k++) { let s = 0, w = 0; for (let d = -2; d <= 2; d++) { const wt = Math.exp(-0.5 * d * d); s += wt * raw[(((k + d) % N) + N) % N]; w += wt; } sm[k] = s / w; }
  for (let k = 0; k < N; k++) { meanX[k] += sm[k] * nx[k]; meanY[k] += sm[k] * ny[k]; }
}
const osm = T.buildTrack("silverstone", { line: "osm" });

// 2. alignment
const telAt = d => { const k = Math.min(n - 2, Math.floor(d / 5)), t = (d - c.distance_m[k]) / (c.distance_m[k + 1] - c.distance_m[k]); return [c.x_m[k] + t * (c.x_m[k + 1] - c.x_m[k]), c.y_m[k] + t * (c.y_m[k + 1] - c.y_m[k])]; };
const osmAt = s => { const i = osm.idxAtS(s); return [osm.cx[i], osm.cz[i]]; };
function procrustes(P, Q, reflect) {
  const N = P.length; let px = 0, py = 0, qx = 0, qy = 0;
  for (let i = 0; i < N; i++) { px += P[i][0]; py += P[i][1]; qx += Q[i][0]; qy += Q[i][1]; }
  px /= N; py /= N; qx /= N; qy /= N;
  const sg = reflect ? -1 : 1; let a = 0, b = 0;
  for (let i = 0; i < N; i++) { const ax = P[i][0] - px, ay = sg * (P[i][1] - py), bx = Q[i][0] - qx, by = Q[i][1] - qy; a += ax * bx + ay * by; b += ax * by - ay * bx; }
  const th = Math.atan2(b, a), co = Math.cos(th), si = Math.sin(th);
  const map = (x, y) => { const ax = x - px, ay = sg * (y - py); return [co * ax - si * ay + qx, si * ax + co * ay + qy]; };
  let e = 0; for (let i = 0; i < N; i++) { const [x, y] = map(P[i][0], P[i][1]); e += (x - Q[i][0]) ** 2 + (y - Q[i][1]) ** 2; }
  return { th, reflect, rms: Math.sqrt(e / N), map, px, py, qx, qy };
}
let best = null;
for (let o = -400; o <= 400; o += 1) for (const refl of [false, true]) {
  const P = [], Q = [];
  for (let k = 0; k < 400; k++) { const f = k / 400; P.push(telAt(f * Lt)); Q.push(osmAt(o + f * osm.L)); }
  const r = procrustes(P, Q, refl); r.offset = o;
  if (!best || r.rms < best.rms) best = r;
}
// control line on the OSM centreline: nearest centreline point to the transformed lap start
const [sx, sz] = best.map(c.x_m[0], c.y_m[0]);
let iBest = 0, dBest = Infinity; for (let i = 0; i < osm.n; i++) { const d = Math.hypot(osm.cx[i] - sx, osm.cz[i] - sz); if (d < dBest) { dBest = d; iBest = i; } }
const controlOsmS = osm.s[iBest];

// 3. path (drop the duplicated closing point if the lap ends where it starts)
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const X = [], Z = [], D = [];
const last = Math.hypot(c.x_m[n - 1] - c.x_m[0], c.y_m[n - 1] - c.y_m[0]) < 3 ? n - 1 : n;
for (let k = 0; k < last; k++) { const [x, z] = best.map(meanX[k], meanY[k]); X.push(r2(x)); Z.push(r2(z)); D.push(c.distance_m[k]); }
// sector splits where the lap's own time channel reaches S1 and S1+S2
const tAt = tt => { for (let k = 1; k < n; k++) if (c.time_s[k] >= tt) { const f = (tt - c.time_s[k - 1]) / (c.time_s[k] - c.time_s[k - 1]); return c.distance_m[k - 1] + f * (c.distance_m[k] - c.distance_m[k - 1]); } return Lt; };
const S = lap.lap.sector_s;
const corners = circ.corners.map(k => ({ n: k.number, d: k.distance_m_on_pole_lap }));
const cd = num => corners.find(k => k.n === num).d;
const LINE = {
  source: "OpenF1 car_data + location, 2026 British GP qualifying, session_key " + lap.session_key + ", " + lap.driver.code + " lap " + lap.lap.lap_number + " (" + lap.lap.lap_time_s + " s); corner markers: MultiViewer circuit API. Via concept/data/telemetry (accessed " + lap.accessed + ").",
  attribution: "Telemetry from OpenF1 (openf1.org), an independent community project not associated with Formula 1, the FIA or FOM; timing data belongs to Formula 1. Non-commercial research use.",
  lap_length_m: Lt,
  path_from_laps: lapFiles.map(f => f.slice(18, 21).toUpperCase()),
  position_sample_interval_s: Math.round((lap.lap.lap_time_s / lap.processing.raw_location_samples_in_lap) * 1000) / 1000,
  alignment: { reflect: best.reflect, rotation_deg: r2((best.th * 180) / Math.PI), rms_m: r2(best.rms), control_line_osm_s: r1(controlOsmS), control_line_offset_m: r1(dBest) },
  timing: {
    control_s: 0, sectors: [r1(tAt(S[0])), r1(tAt(S[0] + S[1]))],
    trap_s: 4780, trap_note: "README fit of all 11 team laps' trap readings to their traces (RMS 0.8 km/h); FIA text: 140 m before T15 (= 4840 m on this lap)",
    i1_s: cd(6) - 110, i2_s: cd(14) + 50,
  },
  corners,
  zones: [
    { name: "A1", s0: cd(18) + 65, s1: cd(1) }, { name: "A2", s0: cd(5) + 55, s1: cd(6) },
    { name: "A3", s0: cd(7) + 155, s1: cd(9) }, { name: "A4", s0: cd(14) + 65, s1: cd(15) },
  ],
  gearing_estimate: (() => {
    // rpm per km/h per gear at full throttle above 40 km/h (median); gears never used at full throttle are extrapolated with
    // the mean ratio step; shift rpm = the highest rpm on the lap. 8 forward gears (C9.6.1).
    const by = {}; let maxr = 0;
    for (let k = 0; k < n; k++) { const g = c.gear[k], v = c.speed_kmh[k]; if (c.rpm[k] > maxr) maxr = c.rpm[k]; if (g >= 1 && v > 40 && c.throttle_pct[k] > 95) (by[g] = by[g] || []).push(c.rpm[k] / v); }
    const med = a => { const q = a.slice().sort((x, y) => x - y); return q[q.length >> 1]; };
    const k8 = []; for (let g = 1; g <= 8; g++) k8.push(by[g] && by[g].length >= 5 ? med(by[g]) : null);
    const known = k8.map((v, i) => [i, v]).filter(x => x[1]);
    const step = Math.pow(known[known.length - 1][1] / known[0][1], 1 / (known[known.length - 1][0] - known[0][0]));
    for (let g = 0; g < 8; g++) if (!k8[g]) { const near = known.reduce((p, q) => (Math.abs(q[0] - g) < Math.abs(p[0] - g) ? q : p)); k8[g] = near[1] * Math.pow(step, g - near[0]); }
    return { rpm_per_kmh: k8.map(v => Math.round(v * 100) / 100), shift_rpm: Math.round(maxr), source: lap.driver.code + " pole lap rpm/gear/speed (OpenF1)" };
  })(),
  reference: { driver: lap.driver.code, lap_s: lap.lap.lap_time_s, sectors_s: S, speed_trap_kmh: lap.lap.speed_trap_kmh, i1_kmh: lap.lap.i1_speed_kmh, i2_kmh: lap.lap.i2_speed_kmh },
  d: D, x: X, z: Z,
  ref_v_kmh: c.speed_kmh.slice(0, last).map(r1), ref_throttle_pct: c.throttle_pct.slice(0, last).map(v => Math.round(v)), ref_brake: c.brake.slice(0, last).map(b => (b ? 1 : 0)),
};
const body = "// GENERATED by concept/sim/build-line.js - do not edit by hand. Racing line + reference trace for the PURPLE concept lap sim.\n" +
  "// " + LINE.attribution + "\n(function () {\n  const LINE = " + JSON.stringify(LINE) + ";\n" +
  "  const root = typeof window !== \"undefined\" ? window : globalThis;\n  root.EI = root.EI || {}; root.EI.CONCEPT_SIM_LINE = Object.assign(root.EI.CONCEPT_SIM_LINE || {}, { silverstone: LINE });\n" +
  "  if (typeof module !== \"undefined\" && module.exports) module.exports = LINE;\n})();\n";
fs.writeFileSync(path.join(__dirname, "line-silverstone.js"), body);
console.log("wrote concept/sim/line-silverstone.js", (body.length / 1024).toFixed(1) + " KB", JSON.stringify(LINE.alignment), JSON.stringify(LINE.timing));
