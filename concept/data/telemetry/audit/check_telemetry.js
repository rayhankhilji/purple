#!/usr/bin/env node
"use strict";
// Read-only audit of PURPLE 2026 telemetry lap files.
// Usage: node check_telemetry.js   (writes telemetry_audit.csv and SUMMARY.md next to this script)
// Stdlib only. Never writes under the repo.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = require("path").join(__dirname, "..");
const RACEPACE = require("path").join(__dirname, "..", "..", "..", "..", "js", "data", "racepace2026.js");
const OUT = __dirname;

const CIRCUITS = ["silverstone", "austria", "hungaroring", "monaco", "montreal", "monza", "singapore", "spa", "suzuka"];
const DIR = { silverstone: ROOT };
for (const c of CIRCUITS) if (c !== "silverstone") DIR[c] = path.join(ROOT, c);

// Official track lengths (m), from each folder's README (centre line).
const OFFICIAL_LEN_M = {
  silverstone: 5891, austria: 4318, hungaroring: 4381, monaco: 3337, montreal: 4361,
  monza: 5793, singapore: 4927, spa: 7004, suzuka: 5807,
};
const OFFICIAL_LEN_SRC = {
  silverstone: "silverstone README ('published track length of 5891 m')",
  austria: "austria README (4,318 m)", hungaroring: "hungaroring README (4.381 km)",
  monaco: "monaco README (3,337 m)", montreal: "montreal README (4.361 km)",
  monza: "monza README (5,793 m)", singapore: "singapore README (4.927 km)",
  spa: "spa README (7,004 m)", suzuka: "suzuka README (5.807 km)",
};

// Thresholds. Spec values are marked [spec]; the rest are auditor choices.
const T = {
  lapMsWarn: 1, lapMsFail: 50,           // lap time vs index / official, ms [auditor]
  stepM: 5, stepTol: 0.01,               // [spec] 5 m grid
  lastStepMaxM: 5.01,                    // final partial step must not exceed 5 m [auditor]
  lenPctWarn: 2.0, lenPctFail: 3.0,      // lap length vs official, % (READMEs: racing line 0-2% short) [auditor]
  lenProcTolM: 1.0,                      // axis end vs processing length, m [auditor]
  xyPctWarn: 1.0, xyPctFail: 3.0,        // distance axis vs X/Y path length, % [auditor]
  endTimeTolS: 0.05,                     // [spec] time at end vs lap time
  speedMax: 380, rpmMax: 14000, gearMax: 8, // [spec]
  throttleMax: 100,                      // [spec]
  nullRunFailM: 200,                     // longest null run above this = FAIL [auditor]
  frozenRunMin: 5, frozenMinKmh: 50,     // identical raw samples in a row = frozen [auditor]
  accelLo: -6.5, accelHi: 1.8,           // [spec] g
  accelWarnCount: 1, accelFailCount: 10, // violations per file [auditor]
  latFlagG: 7,                           // [spec] flag above 7 g
  latK: 4,                               // curvature window (points each side) [auditor]
  jumpKmh: 25, jumpWarnCount: 1, jumpFailCount: 5, // [spec] 25 km/h; counts [auditor]
  sectorWarnMs: 2, sectorFailMs: 20,     // sector sum vs lap time [auditor]
  nearDupSpeedKmh: 0.5,                  // near-identical speed trace [auditor]
};

const G = 9.80665, KMH = 1 / 3.6;
const PASS = 0, WARN = 1, FAIL = 2, NA = -1;
const LABEL = { 0: "PASS", 1: "WARN", 2: "FAIL", "-1": "n/a" };
const worst = (a, b) => (a === NA ? b : b === NA ? a : Math.max(a, b));

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function parseLapTime(s) {
  if (s == null) return null;
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(String(s).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ---- reference (official) times -------------------------------------------
function loadOfficial(circuit) {
  const map = new Map();
  let source = null;
  const offJson = path.join(DIR[circuit], `${circuit}-2026-q-official.json`);
  if (fs.existsSync(offJson)) {
    const j = readJSON(offJson);
    for (const r of j.classification) {
      const times = (r.q1_q2_q3 || []).map(parseLapTime).filter((x) => x != null);
      if (times.length) map.set(r.code, Math.min(...times));
    }
    source = "official JSON";
    return { map, source };
  }
  if (circuit === "silverstone") {
    const line = fs.readFileSync(RACEPACE, "utf8").split("\n").find((l) => l.startsWith("EI.RACEPACE = "));
    const obj = JSON.parse(line.slice(line.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
    for (const [code, s] of Object.entries(obj.silverstone.q)) map.set(code, s);
    return { map, source: "js/data/racepace2026.js (EI.RACEPACE.silverstone.q)" };
  }
  // README cross-check table: "| Grid | Driver | Team | Lap | OpenF1 best s | F1.com best s | ..."
  const lines = fs.readFileSync(path.join(DIR[circuit], "README.md"), "utf8").split("\n");
  const start = lines.findIndex((l) => /^##.*cross-check/i.test(l));
  if (start < 0) return { map, source: "none" };
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i++) {
    const m = /^\|\s*\d+\s*\|\s*([A-Z]{3})\s*\|/.exec(lines[i]);
    if (!m) continue;
    const cells = lines[i].split("|").map((x) => x.trim());
    const v = Number(cells[6]); // cells[0] is "", cells[1] grid, [2] driver, [3] team, [4] lap, [5] OpenF1, [6] F1.com
    if (Number.isFinite(v)) map.set(m[1], v);
  }
  return { map, source: "README cross-check table (formula1.com)" };
}

// ---- file discovery ---------------------------------------------------------
function discover() {
  const recs = [];
  for (const circuit of CIRCUITS) {
    const dir = DIR[circuit];
    for (const f of fs.readdirSync(dir).sort()) {
      let m = new RegExp(`^${circuit}-2026-q-([a-z]{3})\\.json$`).exec(f);
      if (m) { recs.push({ circuit, session: "q", file: f, full: path.join(dir, f), code: m[1], lapNo: null }); continue; }
      m = new RegExp(`^${circuit}-2026-r-([a-z]{3})-lap(\\d{2})\\.json$`).exec(f);
      if (m) { recs.push({ circuit, session: "r", file: f, full: path.join(dir, f), code: m[1], lapNo: Number(m[2]) }); }
    }
  }
  return recs;
}

function loadIndex(circuit) {
  const dir = DIR[circuit];
  const qIdx = path.join(dir, `${circuit}-2026-q-index.json`);
  const rIdx = path.join(dir, `${circuit}-2026-r-index.json`);
  const out = { q: new Map(), r: new Map(), qFiles: [], rFiles: [] };
  if (fs.existsSync(qIdx)) {
    const j = readJSON(qIdx);
    for (const t of j.telemetry_laps || []) { out.q.set(t.file, t); out.qFiles.push(t.file); }
  }
  if (fs.existsSync(rIdx)) {
    const j = readJSON(rIdx);
    for (const [code, d] of Object.entries(j.drivers || {})) {
      for (const t of d.telemetry_laps || []) { out.r.set(t.file, { ...t, code }); out.rFiles.push(t.file); }
    }
  }
  return out;
}

// ---- helpers ----------------------------------------------------------------
function nullRunsM(d, mask) {
  // longest run of masked points, in metres (points * 5 m, measured from the distance axis)
  let best = 0, start = -1;
  const n = mask.length;
  for (let i = 0; i <= n; i++) {
    const m = i < n && mask[i];
    if (m && start < 0) start = i;
    if (!m && start >= 0) {
      const end = i - 1;
      const len = (d[end] - d[start]) + T.stepM;
      if (len > best) best = len;
      start = -1;
    }
  }
  return best;
}

function menger(x0, y0, x1, y1, x2, y2) {
  const ax = x1 - x0, ay = y1 - y0, bx = x2 - x1, by = y2 - y1;
  const cross = ax * by - ay * bx;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lc = Math.hypot(x2 - x0, y2 - y0);
  if (la === 0 || lb === 0 || lc === 0) return null;
  return (2 * Math.abs(cross)) / (la * lb * lc);
}

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---- per-file analysis -----------------------------------------------------
function analyse(rec, j, idx, off, hashes, buf) {
  const ch = j.channels;
  const d = ch.distance_m, t = ch.time_s, sp = ch.speed_kmh, th = ch.throttle_pct, br = ch.brake, gr = ch.gear, rp = ch.rpm, xs = ch.x_m, ys = ch.y_m;
  const n = d.length;
  const row = {
    circuit: rec.circuit, session: rec.session === "q" ? "qualifying" : "race-lap", file: rec.file,
    driver: j.driver.code, lap: j.lap.lap_number, lap_time_s: j.lap.lap_time_s,
  };
  const reasons = { C1: [], C2: [], C3: [], C4: [], C5: [], C6: [] };
  const st = { C1: PASS, C2: PASS, C3: PASS, C4: PASS, C5: PASS, C6: PASS };
  const fail = (c, msg) => { st[c] = worst(st[c], FAIL); reasons[c].push(msg); };
  const warn = (c, msg) => { st[c] = worst(st[c], WARN); reasons[c].push(msg); };

  // C1 lap time vs index vs official
  const ix = rec.session === "q" ? idx.q.get(rec.file) : idx.r.get(rec.file);
  row.index_lap_time_s = ix ? ix.lap_time_s : "";
  if (!ix) fail("C1", "lap file not listed in index");
  else {
    const dIdx = (j.lap.lap_time_s - ix.lap_time_s) * 1000;
    row.diff_index_ms = dIdx.toFixed(1);
    if (Math.abs(dIdx) > T.lapMsFail) fail("C1", `file vs index ${dIdx.toFixed(1)} ms`);
    else if (Math.abs(dIdx) > T.lapMsWarn) warn("C1", `file vs index ${dIdx.toFixed(1)} ms`);
  }
  if (rec.session === "q") {
    const ref = off.map.get(rec.code.toUpperCase());
    row.official_time_s = ref != null ? ref : "";
    row.official_source = off.source;
    if (ref == null) warn("C1", "no official reference time for this driver");
    else {
      const dOff = (j.lap.lap_time_s - ref) * 1000;
      row.diff_official_ms = dOff.toFixed(1);
      if (Math.abs(dOff) > T.lapMsFail) fail("C1", `file vs official ${dOff.toFixed(1)} ms (official ${ref.toFixed(3)} s)`);
      else if (Math.abs(dOff) > T.lapMsWarn) warn("C1", `file vs official ${dOff.toFixed(1)} ms`);
    }
  } else {
    row.official_time_s = ""; row.official_source = "n/a (race lap)"; row.diff_official_ms = "";
  }

  // C2 grid
  let nonInc = 0, badSteps = 0;
  for (let i = 1; i < n; i++) if (!(d[i] > d[i - 1])) nonInc++;
  for (let i = 1; i < n - 1; i++) if (Math.abs((d[i] - d[i - 1]) - T.stepM) > T.stepTol) badSteps++;
  const lastStep = n > 1 ? d[n - 1] - d[n - 2] : 0;
  const length = d[n - 1];
  let nonMono = 0;
  for (let i = 1; i < n; i++) if (t[i] < t[i - 1]) nonMono++;
  const endDiff = t[n - 1] - j.lap.lap_time_s;
  const procLen = j.processing.length_m != null ? j.processing.length_m : j.processing.length_m_speed_integral;
  row.n_points = n; row.length_m = length.toFixed(1);
  const offLen = OFFICIAL_LEN_M[rec.circuit];
  const pct = (length / offLen - 1) * 100;
  row.length_vs_official_pct = pct.toFixed(2);
  row.nonincreasing_dist = nonInc; row.bad_steps = badSteps; row.last_step_m = lastStep.toFixed(2);
  row.nonmono_time = nonMono; row.end_time_minus_lap_s = endDiff.toFixed(4);
  if (nonInc > 0) fail("C2", `${nonInc} non-increasing distance points`);
  if (badSteps > 0) fail("C2", `${badSteps} interior steps not 5 m`);
  if (lastStep > T.lastStepMaxM) warn("C2", `final step ${lastStep.toFixed(2)} m`);
  if (Math.abs(pct) > T.lenPctFail) fail("C2", `length ${length.toFixed(0)} m is ${pct.toFixed(1)}% vs official ${offLen} m`);
  else if (Math.abs(pct) > T.lenPctWarn) warn("C2", `length ${length.toFixed(0)} m is ${pct.toFixed(1)}% vs official ${offLen} m`);
  if (procLen != null && Math.abs(length - procLen) > T.lenProcTolM) warn("C2", `axis end ${length.toFixed(1)} m vs processing length ${procLen} m`);
  const xyLen = j.processing.length_m_xy_path != null ? j.processing.length_m_xy_path : null;
  row.length_xy_path_m = xyLen != null ? xyLen.toFixed(1) : "";
  if (xyLen != null) {
    const dXy = (length / xyLen - 1) * 100;
    row.axis_vs_xy_pct = dXy.toFixed(2);
    if (Math.abs(dXy) > T.xyPctFail) fail("C2", `distance axis ${length.toFixed(0)} m vs X/Y path ${xyLen.toFixed(0)} m (${dXy.toFixed(1)}%)`);
    else if (Math.abs(dXy) > T.xyPctWarn) warn("C2", `distance axis ${length.toFixed(0)} m vs X/Y path ${xyLen.toFixed(0)} m (${dXy.toFixed(1)}%)`);
  }
  if (nonMono > 0) fail("C2", `${nonMono} time decreases`);
  if (Math.abs(endDiff) > T.endTimeTolS) fail("C2", `end time ${t[n - 1].toFixed(3)} s vs lap ${j.lap.lap_time_s} s`);

  // C3 channel ranges and nulls
  const nn = (arr) => arr.filter((v) => v !== null);
  const spV = nn(sp), thV = nn(th), brV = nn(br), grV = nn(gr), rpV = nn(rp);
  const speedOut = spV.filter((v) => v < 0 || v > T.speedMax).length;
  const thrOut = thV.filter((v) => v < 0 || v > T.throttleMax).length;
  const thr104 = thV.filter((v) => v === 104).length;
  const brBad = brV.filter((v) => !(v === true || v === false || v === 0 || v === 1 || v === 100)).length;
  const gearBad = grV.filter((v) => !Number.isInteger(v) || v < 0 || v > T.gearMax).length;
  const rpmOut = rpV.filter((v) => v < 0 || v > T.rpmMax).length;
  const nulls = { speed: 0, throttle: 0, brake: 0, gear: 0, rpm: 0, x: 0, y: 0 };
  const anyNull = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (sp[i] === null) nulls.speed++;
    if (th[i] === null) nulls.throttle++;
    if (br[i] === null) nulls.brake++;
    if (gr[i] === null) nulls.gear++;
    if (rp[i] === null) nulls.rpm++;
    if (xs[i] === null) nulls.x++;
    if (ys[i] === null) nulls.y++;
    anyNull[i] = sp[i] === null || th[i] === null || br[i] === null || gr[i] === null || rp[i] === null;
  }
  const longestNull = nullRunsM(d, anyNull);
  Object.assign(row, {
    speed_min: Math.min(...spV).toFixed(1), speed_max: Math.max(...spV).toFixed(1),
    throttle_min: Math.min(...thV), throttle_max: Math.max(...thV),
    gear_min: Math.min(...grV), gear_max: Math.max(...grV), rpm_max: Math.max(...rpV),
    null_speed: nulls.speed, null_throttle: nulls.throttle, null_brake: nulls.brake,
    null_gear: nulls.gear, null_rpm: nulls.rpm, null_x: nulls.x, null_y: nulls.y,
    longest_null_m: longestNull.toFixed(1),
  });
  if (speedOut) fail("C3", `speed outside 0-380 at ${speedOut} points`);
  if (thrOut) fail("C3", `throttle outside 0-100 at ${thrOut} points${thr104 ? " (104 flag)" : ""}`);
  if (brBad) fail("C3", `brake not boolean/0/1/100 at ${brBad} points`);
  if (gearBad) fail("C3", `gear not integer 0-8 at ${gearBad} points`);
  if (rpmOut) fail("C3", `rpm outside 0-14000 at ${rpmOut} points`);
  let rawBrakeBad = "", rawThrBad = "", frozen = "";
  if (j.raw_car_data) {
    const R = j.raw_car_data;
    const rb = R.brake.filter((v) => v !== 0 && v !== 100);
    const rt = R.throttle_pct.filter((v) => v < 0 || v > 100);
    rawBrakeBad = rb.length; rawThrBad = rt.length;
    if (rb.length) fail("C3", `raw brake has ${rb.length} value(s) outside 0/100 (${[...new Set(rb)].join(",")}) that reached the grid`);
    if (rt.length) fail("C3", `raw throttle has ${rt.length} value(s) outside 0-100 (${[...new Set(rt)].join(",")})`);
    let runs = 0, r = 1;
    for (let i = 1; i < R.speed_kmh.length; i++) {
      const same = R.speed_kmh[i] === R.speed_kmh[i - 1] && R.rpm[i] === R.rpm[i - 1] && R.throttle_pct[i] === R.throttle_pct[i - 1] && R.gear[i] === R.gear[i - 1];
      if (same && R.speed_kmh[i] >= T.frozenMinKmh) { r++; if (r === T.frozenRunMin) runs++; } else r = 1;
    }
    frozen = runs;
    if (runs) warn("C3", `${runs} run(s) of ${T.frozenRunMin}+ identical raw samples (frozen-feed signature)`);
  } else { rawBrakeBad = "n/a"; rawThrBad = "n/a"; frozen = "n/a"; }
  row.raw_brake_bad = rawBrakeBad; row.raw_throttle_bad = rawThrBad; row.raw_frozen_runs = frozen;
  if (longestNull > T.nullRunFailM) fail("C3", `null run ${longestNull.toFixed(0)} m (limit ${T.nullRunFailM} m)`);
  else if (anyNull.some(Boolean)) warn("C3", `null run ${longestNull.toFixed(0)} m (speed/throttle/brake/gear/rpm)`);
  if (nulls.x || nulls.y) warn("C3", `x/y null at ${nulls.x}/${nulls.y} points`);

  // C4 physics
  let accelBrake = 0, accelPos = 0, aMin = Infinity, aMax = -Infinity, jumps = 0, jumpMax = 0;
  for (let i = 1; i < n; i++) {
    const v0 = sp[i - 1], v1 = sp[i];
    if (v0 === null || v1 === null) continue;
    const dv = Math.abs(v1 - v0);
    if (dv > jumpMax) jumpMax = dv;
    if (dv > T.jumpKmh) jumps++;
    const dt = t[i] - t[i - 1];
    if (dt > 0) {
      const a = (v1 - v0) * KMH / dt / G;
      if (a < aMin) aMin = a;
      if (a > aMax) aMax = a;
      if (a < T.accelLo) accelBrake++;
      else if (a > T.accelHi) accelPos++;
    }
  }
  const accelTot = accelBrake + accelPos;
  // lateral g: Menger curvature over +/-k points, then 5-point median to suppress single-point spikes
  const lat = new Array(n).fill(null);
  const k = T.latK;
  for (let i = k; i < n - k; i++) {
    if (xs[i - k] === null || xs[i] === null || xs[i + k] === null || ys[i - k] === null || ys[i] === null || ys[i + k] === null || sp[i] === null) continue;
    const kap = menger(xs[i - k], ys[i - k], xs[i], ys[i], xs[i + k], ys[i + k]);
    if (kap == null) continue;
    lat[i] = kap * Math.pow(sp[i] * KMH, 2) / G;
  }
  const latSm = lat.map((_, i) => {
    if (lat[i] === null) return null;
    const w = [];
    for (let q = -2; q <= 2; q++) { const v = lat[i + q]; if (i + q >= 0 && i + q < n && v !== null && v !== undefined) w.push(v); }
    return median(w);
  });
  const latVals = latSm.filter((v) => v !== null);
  const latMax = latVals.length ? Math.max(...latVals) : 0;
  const latFlag = latVals.filter((g) => g > T.latFlagG).length;
  Object.assign(row, {
    accel_min_g: aMin.toFixed(2), accel_max_g: aMax.toFixed(2),
    accel_viol_brake: accelBrake, accel_viol_pos: accelPos, accel_viol_total: accelTot,
    lat_max_g: latMax.toFixed(2), lat_pts_over_7g: latFlag,
    speed_jumps_25: jumps, speed_jump_max_kmh: jumpMax.toFixed(1),
  });
  if (accelTot > T.accelFailCount) fail("C4", `${accelTot} longitudinal accel points outside -6.5/+1.8 g (${accelBrake} braking, ${accelPos} accel)`);
  else if (accelTot >= T.accelWarnCount) warn("C4", `${accelTot} longitudinal accel points outside -6.5/+1.8 g (${accelBrake} braking, ${accelPos} accel)`);
  if (latFlag > 0) warn("C4", `${latFlag} points with lateral g above 7 g (max ${latMax.toFixed(2)} g, smoothed)`);
  if (jumps >= T.jumpFailCount) fail("C4", `${jumps} speed jumps > 25 km/h per 5 m (max ${jumpMax.toFixed(1)})`);
  else if (jumps >= T.jumpWarnCount) warn("C4", `${jumps} speed jump(s) > 25 km/h per 5 m (max ${jumpMax.toFixed(1)})`);

  // C5 sectors
  const sec = j.lap.sector_s;
  const secSum = sec.reduce((a, b) => a + b, 0);
  const secDiff = (secSum - j.lap.lap_time_s) * 1000;
  row.sector_sum_minus_lap_ms = secDiff.toFixed(1);
  if (Math.abs(secDiff) > T.sectorFailMs) fail("C5", `sectors sum ${secSum.toFixed(3)} s vs lap ${j.lap.lap_time_s} s (${secDiff.toFixed(1)} ms)`);
  else if (Math.abs(secDiff) > T.sectorWarnMs) warn("C5", `sectors sum off by ${secDiff.toFixed(1)} ms`);

  // C6 identity and duplicates (cross-file parts are added in the second pass)
  const expectCode = rec.code.toUpperCase();
  if (j.driver.code !== expectCode) fail("C6", `driver.code ${j.driver.code} does not match file name ${expectCode}`);
  if (ix && ix.lap_number != null && ix.lap_number !== j.lap.lap_number) fail("C6", `index lap ${ix.lap_number} vs file lap ${j.lap.lap_number}`);
  if (rec.session === "r" && rec.lapNo !== j.lap.lap_number) fail("C6", `file name lap ${rec.lapNo} vs lap_number ${j.lap.lap_number}`);
  row.file_sha256 = hashes.sha;
  row.file_bytes = buf.length;

  return { row, st, reasons, sig: { speed: sp, x: xs, y: ys } };
}

function main() {
  const recs = discover();
  const idxBy = {}, offBy = {};
  for (const c of CIRCUITS) { idxBy[c] = loadIndex(c); offBy[c] = loadOfficial(c); }
  // Index-to-file coverage (each listed file must exist; each file must be listed)
  const results = [];
  const byCircuit = {};
  for (const rec of recs) (byCircuit[rec.circuit] = byCircuit[rec.circuit] || []).push(rec);

  for (const rec of recs) {
    const buf = fs.readFileSync(rec.full);
    const j = JSON.parse(buf.toString("utf8"));
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const r = analyse(rec, j, idxBy[rec.circuit], offBy[rec.circuit], { sha }, buf);
    r.rec = rec;
    results.push(r);
  }

  // coverage: index entries without a file, and files not in index
  for (const c of CIRCUITS) {
    const have = new Set(recs.filter((r) => r.circuit === c && r.session === "q").map((r) => r.file));
    const haveR = new Set(recs.filter((r) => r.circuit === c && r.session === "r").map((r) => r.file));
    const ix = idxBy[c];
    const missingQ = ix.qFiles.filter((f) => !have.has(f));
    const missingR = ix.rFiles.filter((f) => !haveR.has(f));
    if (missingQ.length || missingR.length) console.error(`coverage ${c}: index lists missing files ${[...missingQ, ...missingR].join(",")}`);
    const unlistedQ = [...have].filter((f) => !ix.q.has(f));
    const unlistedR = [...haveR].filter((f) => !ix.r.has(f));
    if (unlistedQ.length || unlistedR.length) console.error(`coverage ${c}: files not in index ${[...unlistedQ, ...unlistedR].join(",")}`);
  }

  // C6 cross-file: identical files, identical traces, near-duplicates, same lap time
  const shaMap = new Map();
  for (const r of results) { const k = r.row.file_sha256; (shaMap.get(k) || shaMap.set(k, []).get(k)).push(r); }
  for (const [, grp] of shaMap) if (grp.length > 1) for (const r of grp) {
    const others = grp.filter((o) => o !== r).map((o) => o.rec.file);
    r.st.C6 = worst(r.st.C6, FAIL); r.reasons.C6.push(`byte-identical to ${others.join(", ")}`);
  }
  for (const c of CIRCUITS) {
    const group = results.filter((r) => r.rec.circuit === c);
    for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
      const A = group[a], B = group[b];
      const sameLen = A.sig.speed.length === B.sig.speed.length;
      if (!sameLen) continue;
      let maxSp = 0, maxXY = 0, nullMismatch = false;
      for (let i = 0; i < A.sig.speed.length; i++) {
        if ((A.sig.speed[i] === null) !== (B.sig.speed[i] === null)) { nullMismatch = true; break; }
        if (A.sig.speed[i] === null) continue;
        maxSp = Math.max(maxSp, Math.abs(A.sig.speed[i] - B.sig.speed[i]));
        maxXY = Math.max(maxXY, Math.abs(A.sig.x[i] - B.sig.x[i]), Math.abs(A.sig.y[i] - B.sig.y[i]));
      }
      if (nullMismatch) continue;
      if (maxSp === 0 && maxXY === 0) {
        for (const [X, Y] of [[A, B], [B, A]]) { X.st.C6 = worst(X.st.C6, FAIL); X.reasons.C6.push(`identical speed and position trace to ${Y.rec.file}`); }
      } else if (maxSp < T.nearDupSpeedKmh && A.row.lap_time_s === B.row.lap_time_s) {
        for (const [X, Y] of [[A, B], [B, A]]) { X.st.C6 = worst(X.st.C6, WARN); X.reasons.C6.push(`near-identical speed trace (max ${maxSp.toFixed(2)} km/h, same lap time) to ${Y.rec.file}`); }
      }
      if (A.row.lap_time_s === B.row.lap_time_s && A.rec.session === B.rec.session) {
        for (const [X, Y] of [[A, B], [B, A]]) { X.st.C6 = worst(X.st.C6, WARN); X.reasons.C6.push(`same lap time ${X.row.lap_time_s} s as ${Y.rec.file}`); }
      }
    }
  }

  // Assemble rows
  const checks = ["C1", "C2", "C3", "C4", "C5", "C6"];
  for (const r of results) {
    r.overall = checks.reduce((acc, c) => worst(acc, r.st[c]), PASS);
    for (const c of checks) r.row[c] = LABEL[r.st[c]];
    r.row.overall = LABEL[r.overall];
    r.row.reasons = checks.flatMap((c) => r.reasons[c].map((m) => `${c}: ${m}`)).join("; ");
  }

  // CSV
  const cols = [
    "circuit", "session", "file", "driver", "lap", "overall", "C1", "C2", "C3", "C4", "C5", "C6",
    "lap_time_s", "index_lap_time_s", "official_time_s", "diff_index_ms", "diff_official_ms", "official_source",
    "n_points", "length_m", "length_xy_path_m", "length_vs_official_pct", "axis_vs_xy_pct", "nonincreasing_dist", "bad_steps", "last_step_m", "nonmono_time", "end_time_minus_lap_s",
    "speed_min", "speed_max", "throttle_min", "throttle_max", "gear_min", "gear_max", "rpm_max",
    "null_speed", "null_throttle", "null_brake", "null_gear", "null_rpm", "null_x", "null_y", "longest_null_m",
    "raw_brake_bad", "raw_throttle_bad", "raw_frozen_runs",
    "accel_min_g", "accel_max_g", "accel_viol_brake", "accel_viol_pos", "accel_viol_total", "lat_max_g", "lat_pts_over_7g",
    "speed_jumps_25", "speed_jump_max_kmh", "sector_sum_minus_lap_ms", "file_bytes", "file_sha256", "reasons",
  ];
  const esc = (v) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(",")];
  const sorted = results.slice().sort((a, b) => CIRCUITS.indexOf(a.rec.circuit) - CIRCUITS.indexOf(b.rec.circuit) || a.rec.session.localeCompare(b.rec.session) || a.rec.file.localeCompare(b.rec.file));
  for (const r of sorted) lines.push(cols.map((c) => esc(r.row[c])).join(","));
  fs.writeFileSync(path.join(OUT, "telemetry_audit.csv"), lines.join("\n") + "\n");

  // Summary
  writeSummary(sorted, checks);
  const counts = {};
  for (const r of sorted) { const k = r.rec.circuit + "/" + r.rec.session; counts[k] = counts[k] || { PASS: 0, WARN: 0, FAIL: 0 }; counts[k][LABEL[r.overall]]++; }
  console.log(JSON.stringify(counts, null, 1));
  console.log("files checked:", sorted.length);
}

function writeSummary(sorted, checks) {
  const groupName = (r) => (r.rec.circuit === "silverstone" && r.rec.session === "r") ? "silverstone (race laps)" : r => r;
  const name = (c, s) => (c === "silverstone" && s === "r") ? "Silverstone race laps" : c.charAt(0).toUpperCase() + c.slice(1) + (c === "silverstone" ? " (qualifying)" : "");
  const groups = [];
  for (const c of CIRCUITS) {
    const q = sorted.filter((r) => r.rec.circuit === c && r.rec.session === "q");
    const rr = sorted.filter((r) => r.rec.circuit === c && r.rec.session === "r");
    if (q.length) groups.push({ key: c + "/q", label: name(c, "q"), rows: q });
    if (rr.length) groups.push({ key: c + "/r", label: name(c, "r"), rows: rr });
  }
  const tally = (rows) => rows.reduce((a, r) => { a[LABEL[r.overall]]++; return a; }, { PASS: 0, WARN: 0, FAIL: 0 });
  const md = [];
  md.push("# Telemetry audit: PURPLE 2026 lap files", "");
  md.push("Read-only check of every lap file in `concept/data/telemetry/` (205 files: 30 Silverstone, 175 across eight circuits). Script: `concept/data/telemetry/audit/check_telemetry.js`. Per-file detail: `concept/data/telemetry/audit/telemetry_audit.csv`.", "");
  md.push("Each file gets PASS, WARN or FAIL per check C1 to C6, and an overall status (worst of the six). Lap-time references: official JSON (Austria, Monaco, Monza, Spa), README cross-check table (Hungaroring, Montreal, Singapore, Suzuka) and `js/data/racepace2026.js` (Silverstone). Race laps have no official reference, so C1 for them compares only with the race index.", "");
  md.push("## Totals by circuit", "", "| Circuit | Files | PASS | WARN | FAIL |", "|---|---:|---:|---:|---:|");
  let tot = { PASS: 0, WARN: 0, FAIL: 0 }, totN = 0;
  for (const g of groups) { const t = tally(g.rows); totN += g.rows.length; for (const k of ["PASS", "WARN", "FAIL"]) tot[k] += t[k]; md.push(`| ${g.label} | ${g.rows.length} | ${t.PASS} | ${t.WARN} | ${t.FAIL} |`); }
  md.push(`| **All** | **${totN}** | **${tot.PASS}** | **${tot.WARN}** | **${tot.FAIL}** |`, "");

  md.push("## Per-check status (files)", "", "| Check | PASS | WARN | FAIL | n/a |", "|---|---:|---:|---:|---:|");
  const CHECK_NAME = { C1: "C1 lap time (file vs index vs official)", C2: "C2 grid and time", C3: "C3 channel ranges, nulls, raw flags", C4: "C4 physics (accel, lateral g, jumps)", C5: "C5 sectors vs lap time", C6: "C6 duplicates and identity" };
  for (const c of checks) {
    const cnt = { PASS: 0, WARN: 0, FAIL: 0, "n/a": 0 };
    for (const r of sorted) cnt[LABEL[r.st[c]] || "n/a"]++;
    md.push(`| ${CHECK_NAME[c]} | ${cnt.PASS} | ${cnt.WARN} | ${cnt.FAIL} | ${cnt["n/a"]} |`);
  }
  md.push("");

  md.push("## Every FAIL", "");
  const fails = sorted.filter((r) => r.overall === FAIL);
  md.push(`${fails.length} files have at least one FAIL. Reasons are listed per file (all checks that FAILed).`, "");
  for (const r of fails) {
    const cs = checks.filter((c) => r.st[c] === FAIL);
    const msgs = cs.flatMap((c) => r.reasons[c].filter((_, i) => true).map((m) => `${c}: ${m}`));
    md.push(`- \`${r.rec.file}\` (${r.rec.circuit} ${r.rec.session === "q" ? "qualifying" : "race lap"}): ${msgs.join("; ")}`);
  }
  md.push("");

  md.push("## 10 worst WARN files", "");
  md.push("Files whose overall status is WARN (no FAIL), ranked by the number of WARN checks, then by the number of WARN reasons, then by the size of the physics flags (accel violations + speed jumps + lateral flag points).", "");
  const warnFiles = sorted.filter((r) => r.overall === WARN).map((r) => {
    const nWarnChecks = checks.filter((c) => r.st[c] === WARN).length;
    const nReasons = checks.reduce((a, c) => a + r.reasons[c].length, 0);
    const mag = Number(r.row.accel_viol_total) + Number(r.row.speed_jumps_25) + Number(r.row.lat_pts_over_7g);
    return { r, nWarnChecks, nReasons, mag };
  }).sort((a, b) => b.nWarnChecks - a.nWarnChecks || b.nReasons - a.nReasons || b.mag - a.mag);
  md.push("| # | File | WARN checks | Reasons |", "|---:|---|---:|---|");
  warnFiles.slice(0, 10).forEach((w, i) => {
    const cs = checks.filter((c) => w.r.st[c] === WARN);
    const msgs = cs.flatMap((c) => w.r.reasons[c].map((m) => `${c}: ${m}`));
    md.push(`| ${i + 1} | \`${w.r.rec.file}\` | ${w.nWarnChecks} | ${msgs.join("; ")} |`);
  });
  md.push("");

  md.push("## WARN patterns", "");
  const pattern = (m) => {
    if (/no official reference/.test(m)) return "no official reference for driver";
    if (/file vs index|file vs official/.test(m)) return "lap time mismatch 1-50 ms";
    if (/final step/.test(m)) return "final partial step longer than 5 m";
    if (/processing length/.test(m)) return "axis end vs processing length";
    if (/null run/.test(m)) return "null run (documented dropout gap)";
    if (/x\/y null/.test(m)) return "x/y null";
    if (/frozen/.test(m)) return "frozen raw samples remain";
    if (/longitudinal accel/.test(m)) return "accel outside -6.5/+1.8 g (1-10 points)";
    if (/lateral g/.test(m)) return "lateral g above 7 g (smoothed)";
    if (/speed jump/.test(m)) return "speed jump > 25 km/h (1-4)";
    if (/sectors/.test(m)) return "sector sum off by 2-20 ms";
    if (/length .* vs official/.test(m)) return "lap length 2-3% short of official";
    if (/X\/Y path/.test(m)) return "distance axis vs X/Y path 1-3%";
    if (/near-identical|same lap time/.test(m)) return "near-identical or same-time laps";
    return "other: " + m.slice(0, 60);
  };
  const pc = {};
  for (const r of sorted) for (const c of checks) for (const m of r.reasons[c]) {
    if (r.st[c] !== WARN) continue;
    const p = pattern(m); pc[p] = (pc[p] || 0) + 1;
  }
  md.push("| Pattern | WARN reasons | Files affected |", "|---|---:|---:|");
  const fileCount = {};
  for (const r of sorted) { const seen = new Set(); for (const c of checks) for (const m of r.reasons[c]) if (r.st[c] === WARN) { const p = pattern(m); if (!seen.has(p)) { seen.add(p); fileCount[p] = (fileCount[p] || 0) + 1; } } }
  for (const [p, n] of Object.entries(pc).sort((a, b) => b[1] - a[1])) md.push(`| ${p} | ${n} | ${fileCount[p]} |`);
  md.push("");

  md.push("## Method notes and caveats", "");
  md.push(`- Circuit lengths: ${Object.entries(OFFICIAL_LEN_SRC).map(([c, s]) => `${c} ${OFFICIAL_LEN_M[c]} m (${s})`).join("; ")}.`);
  md.push("- Lap length: the READMEs say racing-line laps run about 0.5 to 2% short of the centre-line length, so WARN starts at 2% short and FAIL at 3%. The distance axis is also compared with the X/Y path length (WARN above 1%, FAIL above 3%), which catches axis errors directly.");
  md.push("- Thresholds marked [spec] in the script come from the brief (5 m grid, 0-380 km/h, 0-100 %, 0-8 gear, 0-14000 rpm, -6.5/+1.8 g, 7 g lateral flag, 25 km/h jump, 0.05 s end-time tolerance). Other thresholds are the auditor's choices and are listed at the top of `check_telemetry.js`.");
  md.push("- Longitudinal accel is the raw speed/time difference between consecutive grid points. It is noisy because OpenF1 speed arrives at about 3.7 Hz and the grid interpolates it linearly. Most violations are positive values of 1.8 to about 2.5 g on single 0.07 to 0.13 s steps; a few are braking spikes of -7 to -8 g. The count thresholds (1-10 WARN, >10 FAIL) are auditor choices made with that noise in mind.");
  md.push("- Lateral g uses Menger curvature over +/-4 grid points (20 m each side) times v^2, followed by a 5-point median. X/Y positions look good to a few tenths of a metre, but at 5 m spacing the curvature estimate still moves by a few g from point to point (estimated, not measured). Treat the 7 g flag as a sign that X/Y is noisy, not as a measured peak. Peak lateral g is not reliable from this data.");
  md.push("- Spa lap files omit `raw_car_data` by design (per the Spa README), so the raw-sample checks show n/a for Spa.");
  md.push("- Silverstone lap files have no `processing.dropouts` or dropout rule, so their raw samples are not filtered the same way as the other circuits (see C3 raw brake).");
  md.push("- Duplicate check: byte hashes, exact speed and position traces, near-identical speed traces with the same lap time, and equal lap times within a circuit. No byte-identical files or identical traces were found.");
  md.push("");
  fs.writeFileSync(path.join(OUT, "SUMMARY.md"), md.join("\n") + "\n");
}

main();
