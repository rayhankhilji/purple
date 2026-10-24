// PURPLE concept - lap-sim track geometry (docs/concept/SIM.md §2). Builds, once per circuit and cached, everything the
// quasi-steady-state solver needs from the game's OSM centreline (js/data/silverstone.js, EI.TRACKS.silverstone, read-only):
// a uniform resample, a minimum-curvature racing line inside the track corridor, curvature, heading, grade, sector lines and
// the 2026 Straight Mode zones. Deterministic: fixed iteration counts, Float64 throughout, no randomness.
// Dual browser / Node: attaches to window.EI.conceptSimTrack and to module.exports. In Node the game data file is evaluated
// in an isolated vm context with a `window` shim (no `document` global is ever defined).
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {});

  // ---- geometry constants (every number here is a modelling choice, documented in SIM.md §2)
  const GEOM = {
    ds_m: 2.5,                // resample spacing of the centreline (and so of the racing line)
    line_smooth_samples: 1.0, // telemetry line: Gaussian sigma = this many position-sample intervals of travel ...
    line_smooth_min_m: 6,     // ... but at least this (m)
    centre_smooth_sigma_m: 10, // Gaussian smoothing of the raw OSM centreline before anything else (removes vertex kinks)
    edge_margin_m: 1.0,       // the car's centre stays this far inside the painted edge (half car width 0.95 m, kerbs give some back)
    // racing-line solve: coarse-to-fine levels (spacing, projected-gradient iterations); the last level is ds_m
    line_pw: 4,               // curvature exponent of the line objective (2 = classic min-curvature; 4 leans to min-max)
    levels: [{ ds_m: 40, iters: 20000 }, { ds_m: 20, iters: 20000 }, { ds_m: 10, iters: 20000 }, { ds_m: 5, iters: 6000 }, { ds_m: 2.5, iters: 3000 }],
    kappa_smooth_sigma_m: 4,  // light smoothing of the racing-line curvature
    straight_radius_m: 900,   // Straight Mode allowed where the racing-line radius exceeds this ...
    straight_min_len_m: 250,  // ... for at least this long (shorter runs stay in Corner Mode)
    straight_trim_m: 30,      // and the zone opens this far after the run starts (corner exit) - zone ends are handled by braking
  };

  // read-only load of a game data file (js/data/<name>.js) in an isolated context; in the browser it is already on EI
  const gameCache = {};
  function loadGameData(name) {
    if (gameCache[name]) return gameCache[name];
    if (typeof require !== "function") throw new Error("concept sim: js/data/" + name + ".js is not loaded");
    const fs = require("fs"), path = require("path"), vm = require("vm");
    const file = path.join(__dirname, "..", "..", "js", "data", name + ".js");
    const sandbox = {}; sandbox.window = sandbox; vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
    if (!sandbox.EI) throw new Error("concept sim: " + file + " did not define EI");
    return (gameCache[name] = sandbox.EI);
  }
  function loadTrackData(trackId) {
    if (EI.TRACKS && EI.TRACKS[trackId]) return EI.TRACKS[trackId];
    const g = loadGameData(trackId);
    if (!g.TRACKS || !g.TRACKS[trackId]) throw new Error("concept sim: js/data/" + trackId + ".js did not define EI.TRACKS." + trackId);
    return g.TRACKS[trackId];
  }

  // Gaussian smoothing of a closed (periodic) series sampled every h metres
  function smoothPeriodic(a, sigma_m, h) {
    const n = a.length, out = new Float64Array(n);
    if (!(sigma_m > 0)) { out.set(a); return out; }
    const r = Math.max(1, Math.ceil((3 * sigma_m) / h)), w = new Float64Array(2 * r + 1);
    let ws = 0; for (let k = -r; k <= r; k++) { const v = Math.exp(-0.5 * ((k * h) / sigma_m) ** 2); w[k + r] = v; ws += v; }
    for (let k = 0; k < w.length; k++) w[k] /= ws;
    for (let i = 0; i < n; i++) { let s = 0; for (let k = -r; k <= r; k++) s += w[k + r] * a[(i + k + n) % n]; out[i] = s; }
    return out;
  }

  // Gaussian smoothing of a closed series with a per-sample sigma (metres)
  function smoothVariable(a, sig, h) {
    const n = a.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const sg = sig[i], r = Math.max(1, Math.ceil((3 * sg) / h)); let s = 0, ws = 0;
      for (let k = -r; k <= r; k++) { const w = Math.exp(-0.5 * ((k * h) / sg) ** 2); s += w * a[(i + k + n * 4) % n]; ws += w; }
      out[i] = s / ws;
    }
    return out;
  }
  // closed polyline -> uniform resample at spacing ~h (exactly n points over the closed length)
  function resampleClosed(px, pz, h) {
    const m = px.length, cum = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) { const j = (i + 1) % m; cum[i + 1] = cum[i] + Math.hypot(px[j] - px[i], pz[j] - pz[i]); }
    const L = cum[m], n = Math.round(L / h), step = L / n, x = new Float64Array(n), z = new Float64Array(n);
    let seg = 0;
    for (let i = 0; i < n; i++) {
      const s = i * step; while (cum[seg + 1] < s) seg++;
      const j = (seg + 1) % m, t = (s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
      x[i] = px[seg] + t * (px[j] - px[seg]); z[i] = pz[seg] + t * (pz[j] - pz[seg]);
    }
    return { x, z, L, step, n };
  }

  // unit tangent / normal of a closed path (central differences); normal = left of travel in (x, z) with +z south
  function frames(x, z) {
    const n = x.length, tx = new Float64Array(n), tz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n, dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz) || 1;
      tx[i] = dx / l; tz[i] = dz / l;
    }
    return { tx, tz };
  }

  // signed curvature (1/m) of a closed path from heading change over +/- k samples, then light smoothing
  function curvature(x, z, sigma_m) {
    const n = x.length, seg = new Float64Array(n), head = new Float64Array(n), kap = new Float64Array(n);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; const dx = x[j] - x[i], dz = z[j] - z[i]; seg[i] = Math.hypot(dx, dz); head[i] = Math.atan2(dz, dx); }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n; let dh = head[i] - head[a];
      while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      kap[i] = dh / (0.5 * (seg[i] + seg[a]) || 1);
    }
    const mean = seg.reduce((p, v) => p + v, 0) / n;
    return { kappa: smoothPeriodic(kap, sigma_m, mean), seg, head };
  }

  // minimum-curvature racing line: lateral offsets q[i] along the centreline normal, |q| <= w, minimising
  // sum |P(i-1) - 2 P(i) + P(i+1)|^2 by projected gradient descent (fixed iteration count -> deterministic)
  function minCurvatureOffsets(cx, cz, nx, nz, w, iters, q0, pw) {
    const n = cx.length, q = new Float64Array(n), px = new Float64Array(n), pz = new Float64Array(n), gx = new Float64Array(n), gz = new Float64Array(n);
    const wt = new Float64Array(n).fill(1);
    if (q0) q.set(q0);
    const step = 0.06;   // < 1/16 keeps the biharmonic iteration stable (weights are normalised to <= 1)
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) { px[i] = cx[i] + q[i] * nx[i]; pz[i] = cz[i] + q[i] * nz[i]; }
      for (let i = 0; i < n; i++) { const a = (i - 1 + n) % n, b = (i + 1) % n; gx[i] = px[a] - 2 * px[i] + px[b]; gz[i] = pz[a] - 2 * pz[i] + pz[b]; }
      // iteratively reweighted: weight ~ |kappa|^(pw-2) turns the L2 objective towards min-max curvature (apex radius)
      if (pw > 2 && it % 50 === 0) {
        let mx = 0;
        for (let i = 0; i < n; i++) { const k2 = gx[i] * gx[i] + gz[i] * gz[i]; wt[i] = Math.pow(k2 + 1e-12, (pw - 2) / 4); }
        const sm = new Float64Array(n);
        for (let i = 0; i < n; i++) { sm[i] = 0.25 * wt[(i - 1 + n) % n] + 0.5 * wt[i] + 0.25 * wt[(i + 1) % n]; if (sm[i] > mx) mx = sm[i]; }
        for (let i = 0; i < n; i++) wt[i] = Math.max(sm[i] / mx, 1e-3);
      }
      if (pw > 2) for (let i = 0; i < n; i++) { gx[i] *= wt[i]; gz[i] *= wt[i]; }
      for (let i = 0; i < n; i++) {
        const a = (i - 1 + n) % n, b = (i + 1) % n;
        const fx = gx[a] - 2 * gx[i] + gx[b], fz = gz[a] - 2 * gz[i] + gz[b];   // gradient of the energy wrt P(i)
        let v = q[i] - step * (fx * nx[i] + fz * nz[i]);
        q[i] = v > w ? w : v < -w ? -w : v;
      }
    }
    return q;
  }

  function interpElevation(elev, s, L) {
    if (!elev || !elev.length) return 0;
    for (let k = 0; k < elev.length - 1; k++) {
      const a = elev[k], b = elev[k + 1];
      if (s >= a[0] && s <= b[0]) return a[1] + ((s - a[0]) / (b[0] - a[0] || 1)) * (b[1] - a[1]);
    }
    return elev[elev.length - 1][1];
  }

  // FIA Straight Mode activation zones (2026 British GP circuit map, concept/data/silverstone-2026-weekend.json): activation
  // points A1 65 m after T18, A2 55 m after T5, A3 155 m after T7, A4 65 m after T14, placed from the racing-line apexes of
  // Club (s 5838), Aintree (1321), Luffield (2242) and the Chapel exit (4258). Deactivation points are not published: each
  // zone runs to the next named corner (T1 Abbey 438, T6 Brooklands 1973, T9 Copse 3084, T15 Stowe 5028); the solver also
  // closes Straight Mode under braking and when lateral demand is high (lapsim.js MODEL.straight_lat_frac).
  const FIA_ZONES = {
    silverstone: [
      { name: "A1", s0: 5838 + 65, s1: 438 }, { name: "A2", s0: 1321 + 55, s1: 1973 },
      { name: "A3", s0: 2242 + 155, s1: 3084 }, { name: "A4", s0: 4258 + 65, s1: 5028 },
    ],
  };
  const cache = {};
  // the real-lap racing line (concept/sim/line-<track>.js, generated by build-line.js from OpenF1 telemetry), if shipped
  function lineData(trackId) {
    const L = EI.CONCEPT_SIM_LINE && EI.CONCEPT_SIM_LINE[trackId];
    if (L) return L;
    if (typeof require === "function") { try { return require("./line-" + trackId + ".js"); } catch (e) { return null; } }
    return null;
  }
  // buildTrack(trackId, { line: "telemetry" | "osm" }): default "telemetry" when the line file exists, else "osm"
  function buildTrack(trackId, opts) {
    const want = (opts && opts.line) || (lineData(trackId) ? "telemetry" : "osm");
    const key = trackId + ":" + want;
    if (cache[key]) return cache[key];
    // multi-track (SIM.md "Multi-track"): a line in the F1 timing frame (build-lines.js) needs no OSM centreline
    if (want === "telemetry" && lineData(trackId) && lineData(trackId).frame === "f1") return (cache[key] = buildF1Track(trackId, lineData(trackId)));
    if (want === "telemetry") return (cache[key] = buildLineTrack(trackId, lineData(trackId), buildTrack(trackId, { line: "osm" })));
    return (cache[key] = buildOsmTrack(trackId));
  }

  // racing line = the real pole lap's path (transformed into the OSM frame), s = that lap's distance from the control line.
  // Elevation and centreline curvature come from the OSM build via the alignment's control-line offset.
  function buildLineTrack(trackId, LN, osm) {
    if (!LN) throw new Error("concept sim: no telemetry line for " + trackId);
    // positions arrive every ~0.26 s (OpenF1 location feed) and are linearly interpolated, so the raw path is a polygon whose
    // vertex spacing is v * dt (7 m at 100 km/h, 23 m at 310 km/h). Smoothing kernel = one sample interval of travel
    // (sigma = max(line_smooth_min_m, v_ref * dt * line_smooth_samples)); the reference speed is used only for that spacing.
    const r0 = resampleClosed(LN.x, LN.z, GEOM.ds_m), dtS = LN.position_sample_interval_s || 0.26;
    const sig = new Float64Array(r0.n);
    for (let i = 0; i < r0.n; i++) { const k = Math.min(LN.ref_v_kmh.length - 1, Math.round(((i / r0.n) * LN.lap_length_m) / 5)); sig[i] = Math.max(GEOM.line_smooth_min_m, (LN.ref_v_kmh[k] / 3.6) * dtS * GEOM.line_smooth_samples); }
    const sx = smoothVariable(r0.x, sig, r0.step), sz = smoothVariable(r0.z, sig, r0.step);
    const c = resampleClosed(Array.from(sx), Array.from(sz), GEOM.ds_m);
    const n = c.n, L = LN.lap_length_m, sOf = new Float64Array(n);
    for (let i = 0; i < n; i++) sOf[i] = (i / n) * L;
    const rl = curvature(c.x, c.z, GEOM.kappa_smooth_sigma_m);
    // seg scaled so the lap length is the trace's speed-integral distance (the s frame of the timing lines)
    const segSum = rl.seg.reduce((p, v) => p + v, 0), seg = rl.seg.map(v => (v * L) / segSum);
    const osmS = i => LN.alignment.control_line_osm_s + (sOf[i] * osm.L) / L;
    const elev = new Float64Array(n), grade = new Float64Array(n), kc = new Float64Array(n);
    for (let i = 0; i < n; i++) { const k = osm.idxAtS(osmS(i)); elev[i] = osm.elev[k]; kc[i] = osm.kappa_centre[k]; }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; grade[i] = (elev[j] - elev[i]) / (seg[i] || 1); }
    const straightZone = new Uint8Array(n), zones = [];
    for (const zn of LN.zones) {
      const a = ((zn.s0 % L) + L) % L, len = (((zn.s1 - zn.s0) % L) + L) % L;
      for (let d = 0; d <= len; d += L / n) straightZone[Math.round(((a + d) % L) / (L / n)) % n] = 1;
      zones.push({ name: zn.name, s0: +a.toFixed(0), s1: +((a + len) % L).toFixed(0), len_m: +len.toFixed(0), source: "FIA" });
    }
    const track = {
      id: trackId, name: osm.name, line: "telemetry", n, L, ds: L / n,
      s: sOf, x: c.x, z: c.z, kappa: rl.kappa, kappa_centre: kc, seg: Float64Array.from(seg), heading: rl.head, grade, elev,
      straightZone, zones, sf: 0, sectors: LN.timing.sectors.slice(), timing: LN.timing, corners: LN.corners, reference: LN,
      racing_line_length_m: L, geom: GEOM,
    };
    track.idxAtS = s => { s = ((s % L) + L) % L; return Math.min(n - 1, Math.round(s / track.ds)) % n; };
    return track;
  }

  // multi-track: racing line = the field's median line in the F1 timing frame (concept/sim/build-lines.js), s = the pole lap's
  // speed-integral distance; smoothing exactly as buildLineTrack; elevation from the line file (track model profile, by lap
  // fraction; flat where none); Straight Mode zones from the line file (the field's full-throttle straights). There is no separate
  // centreline: kappa_centre is the line's own curvature (it is used only for the radius table).
  function buildF1Track(trackId, LN) {
    const r0 = resampleClosed(LN.x, LN.z, GEOM.ds_m), dtS = LN.position_sample_interval_s || 0.26;
    const sig = new Float64Array(r0.n);
    for (let i = 0; i < r0.n; i++) { const k = Math.min(LN.ref_v_kmh.length - 1, Math.round(((i / r0.n) * LN.lap_length_m) / 5)); sig[i] = Math.max(GEOM.line_smooth_min_m, (LN.ref_v_kmh[k] / 3.6) * dtS * GEOM.line_smooth_samples); }
    const sx = smoothVariable(r0.x, sig, r0.step), sz = smoothVariable(r0.z, sig, r0.step);
    const c = resampleClosed(Array.from(sx), Array.from(sz), GEOM.ds_m);
    const n = c.n, L = LN.lap_length_m, sOf = new Float64Array(n);
    for (let i = 0; i < n; i++) sOf[i] = (i / n) * L;
    const rl = curvature(c.x, c.z, GEOM.kappa_smooth_sigma_m);
    const segSum = rl.seg.reduce((p, v) => p + v, 0), seg = rl.seg.map(v => (v * L) / segSum);
    const elev = new Float64Array(n), grade = new Float64Array(n);
    if (LN.elev && LN.elev.length) for (let i = 0; i < n; i++) { const f = (sOf[i] / L) * (LN.elev.length - 1), k = Math.floor(f), t = f - k; elev[i] = LN.elev[k] + t * ((LN.elev[Math.min(k + 1, LN.elev.length - 1)]) - LN.elev[k]); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; grade[i] = (elev[j] - elev[i]) / (seg[i] || 1); }
    const straightZone = new Uint8Array(n), zones = [];
    for (const zn of LN.zones) {
      const a = ((zn.s0 % L) + L) % L, len = (((zn.s1 - zn.s0) % L) + L) % L;
      for (let d = 0; d <= len; d += L / n) straightZone[Math.round(((a + d) % L) / (L / n)) % n] = 1;
      zones.push({ name: zn.name, s0: +a.toFixed(0), s1: +((a + len) % L).toFixed(0), len_m: +len.toFixed(0), source: "telemetry" });
    }
    const track = {
      id: trackId, name: trackId, line: "telemetry", frame: "f1", n, L, ds: L / n,
      s: sOf, x: c.x, z: c.z, kappa: rl.kappa, kappa_centre: rl.kappa, seg: Float64Array.from(seg), heading: rl.head, grade, elev,
      straightZone, zones, sf: 0, sectors: LN.timing.sectors.slice(), timing: LN.timing, corners: LN.corners, corner_names: LN.corner_names || {}, reference: LN,
      racing_line_length_m: L, geom: GEOM,
    };
    track.idxAtS = s => { s = ((s % L) + L) % L; return Math.min(n - 1, Math.round(s / track.ds)) % n; };
    return track;
  }

  function buildOsmTrack(trackId) {
    const data = loadTrackData(trackId);
    const raw = data.center, rx = raw.map(p => p[0]), rz = raw.map(p => p[1]);
    // 1. centreline: uniform resample, Gaussian-smoothed positions (OSM vertex noise), resampled again so spacing is exact
    let r0 = resampleClosed(rx, rz, GEOM.ds_m);
    const sx = smoothPeriodic(r0.x, GEOM.centre_smooth_sigma_m, r0.step), sz = smoothPeriodic(r0.z, GEOM.centre_smooth_sigma_m, r0.step);
    const c = resampleClosed(Array.from(sx), Array.from(sz), GEOM.ds_m);
    // the arc-length frame of the game is the raw polyline from its first point: rescale so s matches it (lap 5880.7 m)
    const n = c.n, Lgame = r0.L, sOf = new Float64Array(n);
    for (let i = 0; i < n; i++) sOf[i] = (i / n) * Lgame;
    // index 0 of the smoothed resample sits at the raw first point (smoothing moves it < 1 m), so s frames agree to ~1 m
    const fr = frames(c.x, c.z), nx = new Float64Array(n), nz = new Float64Array(n);
    for (let i = 0; i < n; i++) { nx[i] = -fr.tz[i]; nz[i] = fr.tx[i]; }
    const halfW = (data.width || 15) / 2 - GEOM.edge_margin_m;
    // 2. racing line: multiscale solve (coarse levels converge the long wavelengths a single-level iteration never reaches),
    //    each level seeded by linear interpolation of the previous one
    let qPrev = null, ratioPrev = 0;
    for (const lv of GEOM.levels) {
      const ratio = Math.max(1, Math.round(lv.ds_m / GEOM.ds_m)), nc = Math.floor(n / ratio);
      const ccx = new Float64Array(nc), ccz = new Float64Array(nc), cnx = new Float64Array(nc), cnz = new Float64Array(nc), seed = new Float64Array(nc);
      for (let k = 0; k < nc; k++) {
        const i = k * ratio; ccx[k] = c.x[i]; ccz[k] = c.z[i]; cnx[k] = nx[i]; cnz[k] = nz[i];
        if (qPrev) { const np = qPrev.length, f = i / ratioPrev, a = Math.floor(f) % np, b = (a + 1) % np, t = f - Math.floor(f); seed[k] = qPrev[a] * (1 - t) + qPrev[b] * t; }
      }
      qPrev = minCurvatureOffsets(ccx, ccz, cnx, cnz, halfW, lv.iters, seed, lv.pw || GEOM.line_pw); ratioPrev = ratio;
    }
    const q = qPrev;
    const x = new Float64Array(n), z = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = c.x[i] + q[i] * nx[i]; z[i] = c.z[i] + q[i] * nz[i]; }
    const rl = curvature(x, z, GEOM.kappa_smooth_sigma_m), cl = curvature(c.x, c.z, GEOM.kappa_smooth_sigma_m);
    // 3. grade from the data's elevation profile (centreline frame)
    const elev = new Float64Array(n), grade = new Float64Array(n);
    for (let i = 0; i < n; i++) elev[i] = interpElevation(data.elevation, sOf[i], Lgame);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; grade[i] = (elev[j] - elev[i]) / (rl.seg[i] || 1); }
    // 4. Straight Mode zones. Where the FIA activation zones are known (FIA_ZONES) they are used; otherwise a curvature
    //    heuristic: racing-line radius above straight_radius_m for straight_min_len_m, opened straight_trim_m late
    const straightZone = new Uint8Array(n), isStraight = i => Math.abs(rl.kappa[i]) < 1 / GEOM.straight_radius_m;
    let start = 0; while (isStraight(start) && start < n) start++;   // begin the scan inside a corner so runs do not wrap
    const zones = [];
    if (FIA_ZONES[trackId]) {
      for (const zn of FIA_ZONES[trackId]) {
        const a = ((zn.s0 % Lgame) + Lgame) % Lgame, len = ((zn.s1 - zn.s0) % Lgame + Lgame) % Lgame;
        for (let d = 0; d <= len; d += Lgame / n) straightZone[Math.round(((a + d) % Lgame) / (Lgame / n)) % n] = 1;
        zones.push({ name: zn.name, s0: +a.toFixed(0), s1: +((a + len) % Lgame).toFixed(0), len_m: +len.toFixed(0), source: "FIA" });
      }
    }
    for (let k = 0; k < n && !FIA_ZONES[trackId]; ) {
      const i = (start + k) % n;
      if (!isStraight(i)) { k++; continue; }
      let len = 0, k2 = k; while (k2 < n && isStraight((start + k2) % n)) { len += rl.seg[(start + k2) % n]; k2++; }
      if (len >= GEOM.straight_min_len_m) {
        const skip = Math.round(GEOM.straight_trim_m / GEOM.ds_m);
        for (let kk = k + skip; kk < k2; kk++) straightZone[(start + kk) % n] = 1;
        zones.push({ s0: +sOf[(start + k + skip) % n].toFixed(0), s1: +sOf[(start + k2 - 1) % n].toFixed(0), len_m: +len.toFixed(0) });
      }
      k = k2;
    }
    const L3 = Lgame / 3;
    const track = {
      id: trackId, name: data.name, n, L: Lgame, ds: Lgame / n,
      s: sOf, x, z, q, cx: c.x, cz: c.z, kappa: rl.kappa, kappa_centre: cl.kappa, seg: rl.seg, heading: rl.head, grade, elev,
      straightZone, zones, halfWidth: halfW,
      sf: data.startFinish || 0,
      // the game's sector lines (js/track.js: data.sectors or thirds of the lap in the s frame); S1 starts at the S/F line
      sectors: data.sectors && data.sectors.length === 2 ? data.sectors.slice() : [L3, 2 * L3],
      corners: (data.corners || []).slice(),
      racing_line_length_m: rl.seg.reduce((p, v) => p + v, 0),
      geom: GEOM,
    };
    track.line = "osm";
    track.idxAtS = s => { const L = track.L; s = ((s % L) + L) % L; return Math.min(n - 1, Math.round(s / track.ds)) % n; };
    return track;
  }

  // minimum radius per named corner window (centreline vs racing line), for SIM.md's radius table and the tests
  function cornerRadii(track, windows) {
    return windows.map(w => {
      let i0 = track.idxAtS(w.s0), i1 = track.idxAtS(w.s1), kc = 0, kr = 0, sAt = w.s0;
      for (let i = i0; i !== i1; i = (i + 1) % track.n) {
        const a = Math.abs(track.kappa_centre[i]), b = Math.abs(track.kappa[i]);
        if (a > kc) kc = a; if (b > kr) { kr = b; sAt = track.s[i]; }
      }
      return { name: w.name, s0: w.s0, s1: w.s1, s_apex: +sAt.toFixed(0), r_centre_m: +(1 / kc).toFixed(0), r_line_m: +(1 / kr).toFixed(0) };
    });
  }

  const api = { GEOM, FIA_ZONES, buildTrack, cornerRadii, loadTrackData, loadGameData, smoothPeriodic };
  EI.conceptSimTrack = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
