#!/usr/bin/env node
// PURPLE concept - regenerates concept/sim/line-<circuit>.js for the multi-track sim (docs/concept/SIM.md "Multi-track"): the
// racing line, timing frame, Straight Mode zones, elevation and reference trace of one circuit from its real 2026 qualifying
// telemetry (concept/data/telemetry/<circuit>/, OpenF1) and its track model (concept/data/tracks/<circuit>.json, TRACK.md).
// Silverstone is NOT built here: its line (concept/sim/line-silverstone.js, build-line.js) is pinned by the tests and aligned to
// the game's OSM frame; the other circuits use the F1 timing frame directly (no OSM centreline is needed).
// Usage: node concept/sim/build-lines.js [monza monaco spa hungaroring]   (deterministic, no network)
// Per circuit:
//   1. path = the field's median line: every valid lap's X/Y at equal lap fractions, averaged, then twice re-averaged by POSITION
//      (projection onto the current mean line, median lateral offset per 5 m station), exactly as build-line.js does for
//      Silverstone. Laps with an audit FAIL (concept/data/telemetry/audit/telemetry_audit.csv) are left out;
//   2. distance axis = the pole lap's speed integral (as Silverstone), so the sim's trace compares with the track model through
//      that driver's stored warp (track.compare basis "driver:<pole>");
//   3. timing: sector lines, speed trap and intermediates = the track model's fits over the whole field (sectors.splits_m, the
//      speed_trap_fit / i1_fit / i2_fit positions on the model axis) mapped onto the pole lap's axis with the pole driver's warp;
//   4. Straight Mode zones: the FIA per-event documents give the activation points only on a drawing (no distances), so the zones
//      are the field's full-throttle straights of the track model (straights[]: >= 98 % throttle, >= 200 m), from their start to
//      their end; the solver also closes Straight Mode under braking and at high lateral demand (MODEL.straight_lat_frac);
//   5. elevation: the track model's profile (js/data/<circuit>.js via concept/track) by lap fraction; none for the Hungaroring;
//   6. reference trace: the pole lap's speed / throttle / brake, with telemetry dropouts (null) filled by the median of the other
//      valid laps at the same lap fraction (only used for the line's smoothing width and the corner table, never fitted).
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "data");
const CIRCUITS = process.argv.slice(2).filter(a => !a.startsWith("-"));
const LIST = CIRCUITS.length ? CIRCUITS : ["monza", "monaco", "spa", "hungaroring"];
// the event name for the source line: the telemetry indexes name it differently (Hungaroring: grand_prix; Monza, Monaco, Spa: only
// event = the venue), so the Grand Prix name comes from this table first (as build-driver-gaps.js)
const EVENT = { monza: "Italian Grand Prix", monaco: "Monaco Grand Prix", spa: "Belgian Grand Prix", hungaroring: "Hungarian Grand Prix" };
const eventName = (circuit, idx) => EVENT[circuit] || idx.grand_prix || (idx.event ? idx.event + " Grand Prix" : circuit);

function readJSON(f) { return JSON.parse(fs.readFileSync(f, "utf8")); }
function auditFails(circuit) {
  const f = path.join(ROOT, "telemetry", "audit", "telemetry_audit.csv");
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean), head = lines[0].split(",");
  const out = {};
  for (const ln of lines.slice(1)) {
    const cells = ln.split(","), row = {}; head.forEach((h, i) => { row[h] = cells[i]; });
    if (row.circuit === circuit && row.session === "qualifying") out[row.driver] = { overall: row.overall, C3: row.C3, C4: row.C4 };
  }
  return out;
}
const med = a => { const s = a.filter(v => v != null && isFinite(v)).sort((p, q) => p - q); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : 0.5 * (s[h - 1] + s[h]); };
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;

function build(circuit) {
  const dir = path.join(ROOT, "telemetry", circuit), idx = readJSON(path.join(dir, circuit + "-2026-q-index.json"));
  const model = readJSON(path.join(ROOT, "tracks", circuit + ".json")), circ = readJSON(path.join(dir, circuit + "-circuit.json"));
  const fails = auditFails(circuit);
  const entries = idx.telemetry_laps.slice().sort((a, b) => a.lap_time_s - b.lap_time_s || (a.code < b.code ? -1 : 1));
  const poleE = entries.find(e => e.pole) || entries[0];
  const pole = readJSON(path.join(dir, poleE.file)), c = pole.channels, n = c.distance_m.length, Lt = c.distance_m[n - 1];
  const lineLaps = entries.filter(e => !(fails[e.code] && fails[e.code].overall === "FAIL")).map(e => ({ code: e.code, ch: readJSON(path.join(dir, e.file)).channels }));
  const allLaps = entries.map(e => ({ code: e.code, ch: readJSON(path.join(dir, e.file)).channels, fail: !!(fails[e.code] && fails[e.code].overall === "FAIL") }));
  // 1. median line (fraction average, then two position-projection passes; build-line.js for the reasoning)
  const lapXY = (ch, frac) => {
    const m = ch.distance_m.length, L = ch.distance_m[m - 1], d = frac * L;
    let k = Math.min(m - 2, Math.max(0, Math.floor(d / 5))); while (k > 0 && ch.distance_m[k] > d) k--; while (k < m - 2 && ch.distance_m[k + 1] < d) k++;
    const t = (d - ch.distance_m[k]) / (ch.distance_m[k + 1] - ch.distance_m[k] || 1);
    return [ch.x_m[k] + t * (ch.x_m[k + 1] - ch.x_m[k]), ch.y_m[k] + t * (ch.y_m[k + 1] - ch.y_m[k])];
  };
  const meanX = [], meanY = [];
  for (let k = 0; k < n; k++) { let sx = 0, sy = 0; for (const l of lineLaps) { const [x, y] = lapXY(l.ch, c.distance_m[k] / Lt); sx += x; sy += y; } meanX.push(sx / lineLaps.length); meanY.push(sy / lineLaps.length); }
  for (let it = 0; it < 2; it++) {
    const N = meanX.length, nx = new Float64Array(N), ny = new Float64Array(N), offs = Array.from({ length: N }, () => []);
    for (let k = 0; k < N; k++) { const a = (k - 1 + N) % N, b = (k + 1) % N, dx = meanX[b] - meanX[a], dy = meanY[b] - meanY[a], l = Math.hypot(dx, dy) || 1; nx[k] = -dy / l; ny[k] = dx / l; }
    for (const { ch } of lineLaps) {
      const m = ch.distance_m.length, L = ch.distance_m[m - 1], acc = new Map();
      for (let q = 0; q < m; q++) {
        const x = ch.x_m[q], y = ch.y_m[q]; if (!(isFinite(x) && isFinite(y))) continue;
        const k0 = Math.round((ch.distance_m[q] / L) * N); let best = -1, bd = Infinity;
        for (let d = -8; d <= 8; d++) { const k = (((k0 + d) % N) + N) % N, e = (x - meanX[k]) ** 2 + (y - meanY[k]) ** 2; if (e < bd) { bd = e; best = k; } }
        const o = (x - meanX[best]) * nx[best] + (y - meanY[best]) * ny[best];
        if (!acc.has(best)) acc.set(best, []); acc.get(best).push(o);
      }
      for (const [k, v] of acc) offs[k].push(v.reduce((p, z) => p + z, 0) / v.length);
    }
    const raw = offs.map(a => med(a) || 0), sm = new Float64Array(N);
    for (let k = 0; k < N; k++) { let s = 0, w = 0; for (let d = -2; d <= 2; d++) { const wt = Math.exp(-0.5 * d * d); s += wt * raw[(((k + d) % N) + N) % N]; w += wt; } sm[k] = s / w; }
    for (let k = 0; k < N; k++) { meanX[k] += sm[k] * nx[k]; meanY[k] += sm[k] * ny[k]; }
  }
  const last = Math.hypot(c.x_m[n - 1] - c.x_m[0], c.y_m[n - 1] - c.y_m[0]) < 3 ? n - 1 : n;
  // 2-3. timing on the pole lap's axis: model axis -> pole axis by inverting the pole driver's warp (model s = d + off(d))
  const W = model.drivers[poleE.code].warp, interp = (xs, ys, q) => { if (q <= xs[0]) return ys[0]; if (q >= xs[xs.length - 1]) return ys[ys.length - 1]; let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const mm = (lo + hi) >> 1; if (xs[mm] <= q) lo = mm; else hi = mm; } const t = (q - xs[lo]) / (xs[hi] - xs[lo] || 1); return ys[lo] + t * (ys[hi] - ys[lo]); };
  const Lm = model.geometry.length_m, toPole = s => { s = ((s % Lm) + Lm) % Lm; let d = s; for (let i = 0; i < 6; i++) d = s - interp(W.d, W.off, d); return Math.min(Lt, Math.max(0, d)); };
  const splits = model.sectors.splits_m.map(x => x.mean);
  const lt = model.lap;
  const timing = {
    control_s: 0, sectors: splits.map(s => r1(toPole(s))),
    trap_s: r1(toPole(lt.speed_trap_fit.at_m)), i1_s: r1(toPole(lt.i1_fit.at_m)), i2_s: r1(toPole(lt.i2_fit.at_m)),
    trap_note: "track model fit of all 22 drivers' trap readings to their traces (RMS " + lt.speed_trap_fit.rms_kmh + " km/h), mapped onto the pole lap with " + poleE.code + "'s warp",
    sectors_note: "track model sector splits (mean over 22 laps, model axis) mapped onto the pole lap with " + poleE.code + "'s warp",
  };
  // 4. Straight Mode zones = the field's full-throttle straights
  const zones = model.straights.map(st => ({ name: st.id + " " + st.name, s0: r1(toPole(st.start_m)), s1: r1(toPole(st.end_m)) }));
  // corners: MultiViewer markers on the pole lap, names from the track model
  const names = {}; for (const k of model.corners) if (/^T\d+$/.test(k.id)) names[+k.id.slice(1)] = k.name;
  const corners = circ.corners.filter(k => !k.letter).map(k => ({ n: k.number, d: k.distance_m_on_pole_lap }));
  // 5. elevation by lap fraction (5 m stations of the pole lap)
  const prof = (model.geometry.elevation && model.geometry.elevation.profile) || [];
  const elev = prof.length ? c.distance_m.slice(0, last).map(d => r2(interp(prof.map(p => p[0]), prof.map(p => p[1]), (d / Lt) * Lm))) : null;
  // 6. reference trace with dropouts filled from the other valid laps at the same lap fraction
  const valAt = (ch, key, frac) => { const m = ch.distance_m.length, L = ch.distance_m[m - 1], d = frac * L; let k = Math.min(m - 1, Math.max(0, Math.round(d / 5))); while (k > 0 && ch.distance_m[k] > d + 2.5) k--; while (k < m - 1 && ch.distance_m[k] < d - 2.5) k++; return ch[key][k]; };
  const fill = key => c[key].slice(0, last).map((v, k) => (v != null ? v : med(allLaps.filter(l => !l.fail && l.code !== poleE.code).map(l => valAt(l.ch, key, c.distance_m[k] / Lt)))));
  const refV = fill("speed_kmh"), refT = fill("throttle_pct"), refB = fill("brake");
  // gearing estimate on the pole lap (as build-line.js; nulls skipped). Not used by team cars (one season gearbox, Silverstone fit)
  const by = {}; let maxr = 0;
  for (let k = 0; k < n; k++) { const g = c.gear[k], v = c.speed_kmh[k], r = c.rpm[k]; if (g == null || v == null || r == null) continue; if (r > maxr) maxr = r; if (g >= 1 && v > 40 && c.throttle_pct[k] > 95) (by[g] = by[g] || []).push(r / v); }
  const k8 = []; for (let g = 1; g <= 8; g++) k8.push(by[g] && by[g].length >= 5 ? med(by[g]) : null);
  const known = k8.map((v, i) => [i, v]).filter(x => x[1]);
  const step = Math.pow(known[known.length - 1][1] / known[0][1], 1 / (known[known.length - 1][0] - known[0][0]));
  for (let g = 0; g < 8; g++) if (!k8[g]) { const near = known.reduce((p, q) => (Math.abs(q[0] - g) < Math.abs(p[0] - g) ? q : p)); k8[g] = near[1] * Math.pow(step, g - near[0]); }
  const LINE = {
    circuit, frame: "f1",
    source: "OpenF1 car_data + location, 2026 " + eventName(circuit, idx) + " qualifying, session_key " + idx.session_key + ", path = median of " + lineLaps.length + " valid laps, distance axis = " + poleE.code + " lap " + poleE.lap_number + " (" + poleE.lap_time_s + " s, pole); corner markers: MultiViewer circuit API; timing and zones: concept/data/tracks/" + circuit + ".json. Via concept/data/telemetry/" + circuit + " (accessed " + idx.accessed + ").",
    attribution: "Telemetry from OpenF1 (openf1.org), an independent community project not associated with Formula 1, the FIA or FOM; timing data belongs to Formula 1. Non-commercial research use.",
    lap_length_m: Lt, official_length_m: model.official.centreline_length_m,
    path_from_laps: lineLaps.map(l => l.code), excluded_audit_fail: allLaps.filter(l => l.fail).map(l => l.code),
    position_sample_interval_s: Math.round((pole.lap.lap_time_s / pole.processing.raw_location_samples_in_lap) * 1000) / 1000,
    alignment: null,
    timing, corners, corner_names: names, zones, zones_source: "telemetry: field full-throttle straights (track model straights[]); FIA activation points are published only as a drawing",
    gearing_estimate: { rpm_per_kmh: k8.map(v => r2(v)), shift_rpm: Math.round(maxr), source: poleE.code + " pole lap rpm/gear/speed (OpenF1)" },
    reference: { driver: poleE.code, lap_s: poleE.lap_time_s, sectors_s: poleE.sector_s, speed_trap_kmh: pole.lap.speed_trap_kmh, i1_kmh: pole.lap.i1_speed_kmh, i2_kmh: pole.lap.i2_speed_kmh, filled_points: c.speed_kmh.slice(0, last).filter(v => v == null).length },
    d: c.distance_m.slice(0, last), x: meanX.slice(0, last).map(r2), z: meanY.slice(0, last).map(v => r2(-v)), elev,   // z = -y: the sim frame is (x east, z south); the F1 frame is (east, north) within 2.4 deg (track model alignment)
    ref_v_kmh: refV.map(r1), ref_throttle_pct: refT.map(v => Math.round(v)), ref_brake: refB.map(b => (b ? 1 : 0)),
  };
  const body = "// GENERATED by concept/sim/build-lines.js - do not edit by hand. Racing line + reference trace for the PURPLE concept lap sim (" + circuit + ").\n" +
    "// " + LINE.attribution + "\n(function () {\n  const LINE = " + JSON.stringify(LINE) + ";\n" +
    "  const root = typeof window !== \"undefined\" ? window : globalThis;\n  root.EI = root.EI || {}; root.EI.CONCEPT_SIM_LINE = Object.assign(root.EI.CONCEPT_SIM_LINE || {}, { " + circuit + ": LINE });\n" +
    "  if (typeof module !== \"undefined\" && module.exports) module.exports = LINE;\n})();\n";
  fs.writeFileSync(path.join(__dirname, "line-" + circuit + ".js"), body);
  console.log("wrote concept/sim/line-" + circuit + ".js", (body.length / 1024).toFixed(1) + " KB", "laps", lineLaps.length, "L", Lt, JSON.stringify(timing.sectors), "trap", timing.trap_s, "zones", zones.length, "filled", LINE.reference.filled_points);
}
for (const c of LIST) build(c);
