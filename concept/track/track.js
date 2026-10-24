// PURPLE CONCEPT - track model and corner statistics from real 2026 telemetry (docs/concept/TRACK.md).
// The measured description of a circuit: its geometry (a fused, distance-parameterised centreline with curvature) and how the
// real field drives it (per-corner, per-straight and lap-level statistics across every driver's best qualifying lap).
// Built offline by concept/track/build.js into concept/data/tracks/<circuit>.json; this file holds every algorithm (so the
// build is reproducible in the browser too) and the read API:
//   track.load(circuitId)            -> model (Node: reads concept/data/tracks/<id>.json; browser: a registered model)
//   track.corners(idOrModel?)        -> corner table (the last loaded model when omitted)
//   track.straights(idOrModel?)      -> straight / clipping table
//   track.compare(simTrace, circuitId|model, opts?) -> per-corner deltas and RMS speed error vs the field mean and vs a driver
//   track.traceFromLap(lapJson, model) -> a real lap file projected onto the model's distance axis (same pipeline as the build)
// Dual browser / Node: window.EI.concept.track and module.exports. Pure and deterministic; no network, no Mubit.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const VERSION = "track/1";
  const G = 9.80665;

  // ------------------------------------------------------------------ settings (documented in TRACK.md)
  const SETTINGS = {
    geom_step_m: 2,            // centreline sample spacing (exact spacing is L / round(L / 2))
    grid_step_m: 5,            // field statistics / traces spacing (exact spacing is L / round(L / 5))
    kappa_sigma_m: 8,          // Gaussian smoothing of the centreline before curvature (OSM node spacing in corners is ~6 m)
    alat_sigma_s: 0.3,         // Gaussian smoothing in TIME of each driver's x/y before the lateral-acceleration derivative
    alat_dt_s: 0.05,           // time grid for that derivative
    warp_knot_m: 100,          // knot spacing of the speed-integral-distance -> centreline-distance warp
    corner_half_window_m: 150, // a corner's geometric window reaches at most this far from its marker (and never past halfway to a neighbour)
    corner_frac: [0.05, 0.95], // entry / exit = where 5 % / 95 % of the window's signed heading change is reached
    corner_drive_margin_m: 40, // driving statistics look this far beyond the geometric entry / exit (capped at halfway to a neighbour)
    full_throttle_pct: 98,     // "full throttle" (lap shares, throttle pickup); 98 because PIA's Silverstone throttle tops out at 98-99 %
    straight_throttle_pct: 98, // straights: throttle at or above this (absorbs 98/99 % jitter of the 3.7 Hz feed)
    straight_min_m: 200,       // shortest field full-throttle run that counts as a straight
    lift_throttle_pct: 95,     // a lift = throttle under 95 %
    coast_throttle_pct: 5,     // coasting = throttle under 5 % with the brake off
    dropout_s: 1.5,            // a gap between raw samples longer than this voids a corner (the feed has natural gaps up to ~1.2 s)
    slow_kmh: 150, fast_kmh: 230,
  };

  // ------------------------------------------------------------------ numerics
  const isNum = x => typeof x === "number" && isFinite(x);
  const round = (x, dp) => (isNum(x) ? +x.toFixed(dp == null ? 2 : dp) : null);
  function stats(values, dp) {
    const v = values.filter(isNum); const n = v.length;
    if (!n) return { mean: null, std: null, min: null, max: null, n: 0 };
    let m = 0; for (const x of v) m += x; m /= n;
    let ss = 0; for (const x of v) ss += (x - m) * (x - m);
    const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    return { mean: round(m, dp), std: round(sd, dp), min: round(Math.min(...v), dp), max: round(Math.max(...v), dp), n };
  }
  function median(values) { const v = values.filter(isNum).slice().sort((a, b) => a - b); if (!v.length) return null; const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; }
  function gaussKernel(sigma) {
    const r = Math.max(1, Math.ceil(4 * sigma)), k = [];
    let sum = 0; for (let i = -r; i <= r; i++) { const w = Math.exp(-0.5 * (i / sigma) * (i / sigma)); k.push(w); sum += w; }
    return { r, k: k.map(w => w / sum) };
  }
  // periodic Gaussian smoothing (closed loops); sigma in samples
  function smoothPeriodic(a, sigma) {
    if (!(sigma > 0)) return a.slice();
    const { r, k } = gaussKernel(sigma), n = a.length, out = new Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = -r; j <= r; j++) s += k[j + r] * a[(((i + j) % n) + n) % n]; out[i] = s; }
    return out;
  }
  // Gaussian smoothing with reflected ends (open records); sigma in samples
  function smoothOpen(a, sigma) {
    if (!(sigma > 0)) return a.slice();
    const { r, k } = gaussKernel(sigma), n = a.length, out = new Array(n);
    const at = i => { if (i < 0) i = -i; if (i > n - 1) i = 2 * (n - 1) - i; return a[Math.max(0, Math.min(n - 1, i))]; };
    for (let i = 0; i < n; i++) { let s = 0; for (let j = -r; j <= r; j++) s += k[j + r] * at(i + j); out[i] = s; }
    return out;
  }
  // linear interpolation of y(x) at q, x ascending; clamps outside
  function interp(xs, ys, q) {
    const n = xs.length; if (q <= xs[0]) return ys[0]; if (q >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= q) lo = m; else hi = m; }
    const t = (q - xs[lo]) / (xs[hi] - xs[lo] || 1); return ys[lo] + t * (ys[hi] - ys[lo]);
  }
  // zero-order hold: the last sample at or before q
  function hold(xs, ys, q) {
    const n = xs.length; if (q <= xs[0]) return ys[0]; if (q >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= q) lo = m; else hi = m; }
    return ys[lo];
  }
  // a closed polyline resampled at N equally spaced arc-length stations starting at its first vertex
  function resampleClosed(xs, ys, N) {
    const n = xs.length, cum = [0];
    for (let i = 1; i <= n; i++) { const j = i % n; cum.push(cum[i - 1] + Math.hypot(xs[j] - xs[i - 1], ys[j] - ys[i - 1])); }
    const L = cum[n], X = [], Y = [];
    let seg = 0;
    for (let k = 0; k < N; k++) {
      const s = (k * L) / N; while (seg < n - 1 && cum[seg + 1] <= s) seg++;
      const j = (seg + 1) % n, t = (s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
      X.push(xs[seg] + t * (xs[j] - xs[seg])); Y.push(ys[seg] + t * (ys[j] - ys[seg]));
    }
    return { x: X, y: Y, L };
  }
  // open polyline resampled by arc-length fraction (N points from the first to the last vertex, last excluded)
  function resampleOpenFraction(xs, ys, N) {
    const n = xs.length, cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
    const L = cum[n - 1], X = [], Y = [];
    for (let k = 0; k < N; k++) { const s = (k * L) / N; X.push(interp(cum, xs, s)); Y.push(interp(cum, ys, s)); }
    return { x: X, y: Y, L };
  }

  // ------------------------------------------------------------------ 2-D rigid / similarity fit (Procrustes)
  // finds rotation th, optional mirror (y -> -y applied to A first), scale sc, translation t minimising |sc R A' + t - B|
  function procrustes(ax, ay, bx, by, mirror) {
    const n = ax.length; let max = 0, may = 0, mbx = 0, mby = 0;
    const AY = mirror ? ay.map(v => -v) : ay;
    for (let i = 0; i < n; i++) { max += ax[i]; may += AY[i]; mbx += bx[i]; mby += by[i]; }
    max /= n; may /= n; mbx /= n; mby /= n;
    let sc = 0, ss = 0, aa = 0;
    for (let i = 0; i < n; i++) {
      const x = ax[i] - max, y = AY[i] - may, u = bx[i] - mbx, v = by[i] - mby;
      sc += x * u + y * v; ss += x * v - y * u; aa += x * x + y * y;
    }
    const th = Math.atan2(ss, sc), scale = Math.hypot(sc, ss) / (aa || 1);
    return { th, mirror: !!mirror, scale, cx: max, cy: may, tx: mbx, ty: mby };
  }
  // apply a fit; useScale=false applies the rotation and translation only (a rigid move)
  function applyFit(f, xs, ys, useScale) {
    const c = Math.cos(f.th), s = Math.sin(f.th), k = useScale ? f.scale : 1, X = [], Y = [];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] - f.cx, y = (f.mirror ? -ys[i] : ys[i]) - f.cy;
      X.push(k * (c * x - s * y) + f.tx); Y.push(k * (s * x + c * y) + f.ty);
    }
    return { x: X, y: Y };
  }

  // ------------------------------------------------------------------ closed centreline helpers
  // cl = { x[], y[], N, L, step } with s_i = i * step, closed (the segment N-1 -> 0 closes the loop)
  function segProject(cl, i, px, py) {
    const j = (i + 1) % cl.N, x0 = cl.x[i], y0 = cl.y[i], dx = cl.x[j] - x0, dy = cl.y[j] - y0, l2 = dx * dx + dy * dy || 1;
    let t = ((px - x0) * dx + (py - y0) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x0 + t * dx, qy = y0 + t * dy, ex = px - qx, ey = py - qy;
    const d = Math.hypot(ex, ey), side = dx * ey - dy * ex >= 0 ? 1 : -1;  // left of the driving direction = +
    return { d, s: (i + t) * cl.step, n: side * d };
  }
  function projectGlobal(cl, px, py) {
    let best = null, bi = 0;
    for (let i = 0; i < cl.N; i++) { const p = segProject(cl, i, px, py); if (!best || p.d < best.d) { best = p; bi = i; } }
    return Object.assign(best, { i: bi });
  }
  // sequential projection of a driven path (points in driving order): s is unwrapped (continuous, may exceed L), n = lateral offset
  function projectPath(cl, xs, ys, back, ahead) {
    back = back || 15; ahead = ahead || 60;   // search window in centreline samples
    const out = { s: [], n: [], d: [] };
    let p0 = projectGlobal(cl, xs[0], ys[0]), j = p0.i, laps = 0, lastS = p0.s;
    if (lastS > cl.L / 2) laps = -1;  // a lap that starts just before s = 0
    for (let k = 0; k < xs.length; k++) {
      let best = null, bj = j;
      for (let o = -back; o <= ahead; o++) { const i = (((j + o) % cl.N) + cl.N) % cl.N; const p = segProject(cl, i, xs[k], ys[k]); if (!best || p.d < best.d) { best = p; bj = i; } }
      if (best.s - lastS < -cl.L / 2) laps++; else if (best.s - lastS > cl.L / 2) laps--;
      lastS = best.s; j = bj;
      out.s.push(best.s + laps * cl.L); out.n.push(best.n); out.d.push(best.d);
    }
    return out;
  }
  // heading and curvature of a closed, equally spaced loop after Gaussian smoothing (sigma in metres)
  function curvatureClosed(cl, sigmaM) {
    const sg = sigmaM / cl.step, X = smoothPeriodic(cl.x, sg), Y = smoothPeriodic(cl.y, sg), N = cl.N, h = cl.step;
    const kap = new Array(N), psi = new Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      const x1 = (X[b] - X[a]) / (2 * h), y1 = (Y[b] - Y[a]) / (2 * h);
      const x2 = (X[b] - 2 * X[i] + X[a]) / (h * h), y2 = (Y[b] - 2 * Y[i] + Y[a]) / (h * h);
      kap[i] = (x1 * y2 - y1 * x2) / Math.pow(x1 * x1 + y1 * y1, 1.5);
      psi[i] = Math.atan2(y1, x1);
    }
    // unwrap the heading so it is continuous along the lap
    const un = [psi[0]]; for (let i = 1; i < N; i++) { let d = psi[i] - psi[i - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; un.push(un[i - 1] + d); }
    // heading change per sample (exact turning of the smoothed curve; summing kappa * step would overcount tight corners,
    // where smoothing shrinks the curve so its own arc is shorter than the sample spacing)
    const dpsi = []; for (let i = 0; i < N; i++) { let d = psi[(i + 1) % N] - psi[i]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; dpsi.push(d); }
    return { kappa: kap, psi: un, dpsi };
  }

  // ------------------------------------------------------------------ per-lap processing
  // lateral acceleration (m/s^2, + = to the left) from a lap's x/y against time, Gaussian-smoothed in time
  function lateralAccel(time, xs, ys) {
    const dt = SETTINGS.alat_dt_s, T = time[time.length - 1], tg = [];
    for (let t = 0; t <= T + 1e-9; t += dt) tg.push(+t.toFixed(6));
    const sg = SETTINGS.alat_sigma_s / dt;
    const X = smoothOpen(tg.map(t => interp(time, xs, t)), sg), Y = smoothOpen(tg.map(t => interp(time, ys, t)), sg);
    const a = [];
    for (let i = 0; i < tg.length; i++) {
      const p = Math.max(0, i - 1), q = Math.min(tg.length - 1, i + 1), h = (q - p) * dt;
      const vx = (X[q] - X[p]) / h, vy = (Y[q] - Y[p]) / h;
      const ax = (X[q] - 2 * X[i] + X[p]) / (dt * dt) * (q - p === 2 ? 1 : 0), ay = (Y[q] - 2 * Y[i] + Y[p]) / (dt * dt) * (q - p === 2 ? 1 : 0);
      const sp = Math.hypot(vx, vy) || 1; a.push((vx * ay - vy * ax) / sp);
    }
    return time.map(t => interp(tg, a, t));
  }
  // map a lap's speed-integral distance d onto centreline distance s: a smooth, monotone warp s(d) = d + offset(d), offsets the
  // median of (projected s - d) in windows around knots every warp_knot_m, pinned so the lap spans exactly [0, L]
  function distanceWarp(d, sProj, L) {
    const D = d[d.length - 1], K = Math.max(2, Math.round(D / SETTINGS.warp_knot_m)), knots = [], offs = [];
    for (let j = 0; j <= K; j++) {
      const dj = (j * D) / K, w = D / K / 2, r = [];
      for (let i = 0; i < d.length; i++) if (Math.abs(d[i] - dj) <= w) r.push(sProj[i] - d[i]);
      knots.push(dj); offs.push(median(r));
    }
    offs[0] = 0; offs[K] = L - D;
    for (let j = 1; j < K; j++) if (!isNum(offs[j])) offs[j] = offs[j - 1];
    const sm = offs.slice(); for (let j = 1; j < K; j++) sm[j] = (offs[j - 1] + 2 * offs[j] + offs[j + 1]) / 4;
    return { d: knots.map(v => round(v, 2)), off: sm.map(v => round(v, 2)) };
  }
  const warpS = (w, d) => d + interp(w.d, w.off, d);
  // a frozen speed channel: >= 4 consecutive raw samples with the identical speed while the brake is on (2+ samples) or the gear goes down
  // (a real car cannot hold its speed exactly while braking or shifting down; OCO's Silverstone lap shows 253 km/h x 6 into Vale)
  function staleRuns(raw) {
    const out = [];
    for (let i = 0; i < raw.length;) {
      let j = i; while (j + 1 < raw.length && raw[j + 1].v === raw[i].v) j++;
      if (j - i + 1 >= 4 && raw[i].v > 50) {
        const run = raw.slice(i, j + 1), down = run.some((r, q) => q > 0 && r.gear < run[q - 1].gear);
        if (run.filter(r => r.brk).length >= 2 || down) out.push({ i0: i, i1: j, t0: raw[i].t, t1: raw[Math.min(raw.length - 1, j + 1)].t, s0: raw[i].s, s1: raw[j].s, v: raw[i].v });
      }
      i = j + 1;
    }
    return out;
  }
  // processes one telemetry lap against a centreline: everything on the model's grid plus its raw samples in s
  function processLap(lap, cl, M) {
    // channels may carry null inside telemetry dropouts (concept/data/telemetry/<circuit>/README.md): NaN from here on
    const ch0 = lap.channels, ch = {}; for (const k of Object.keys(ch0)) ch[k] = ch0[k].map(v => (v == null ? NaN : typeof v === "boolean" ? +v : v));
    const L = cl.L, n = ch.distance_m.length;
    const proj = projectPath(cl, ch.x_m, ch.y_m);
    const w = distanceWarp(ch.distance_m, proj.s, L);
    const sOf = ch.distance_m.map(d => warpS(w, d));
    for (let i = 1; i < n; i++) if (sOf[i] <= sOf[i - 1]) sOf[i] = sOf[i - 1] + 1e-6;   // strictly monotone for inversion
    const alat = lateralAccel(ch.time_s, ch.x_m, ch.y_m);
    const step = L / M, g = { speed: [], throttle: [], brake: [], gear: [], rpm: [], time: [], alat: [], offset: [] };
    for (let k = 0; k < M; k++) {
      const s = k * step;
      g.speed.push(interp(sOf, ch.speed_kmh, s)); g.throttle.push(interp(sOf, ch.throttle_pct, s));
      g.brake.push(hold(sOf, ch.brake, s)); g.gear.push(hold(sOf, ch.gear, s));
      g.rpm.push(interp(sOf, ch.rpm, s)); g.time.push(interp(sOf, ch.time_s, s)); g.alat.push(interp(sOf, alat, s));
      g.offset.push(interp(sOf, proj.n, s)); (g.d || (g.d = [])).push(interp(sOf, ch.distance_m, s));
    }
    // raw samples (the un-interpolated 3.7 Hz feed) in s; without them, the lap's own 5 m grid stands in
    let raw, stale = [];
    if (lap.raw_car_data && Array.isArray(lap.raw_car_data.time_s)) {
      const r = lap.raw_car_data;
      raw = r.time_s.map((t, i) => ({ t, s: warpS(w, r.distance_m[i]), v: r.speed_kmh[i], thr: r.throttle_pct[i], brk: r.brake[i] ? 1 : 0, gear: r.gear[i], rpm: r.rpm[i] })).filter(q => isNum(q.v) && isNum(q.s));
      stale = staleRuns(raw);
      if (stale.length) {
        raw = raw.filter((x, i) => !stale.some(q => i > q.i0 && i <= q.i1));
        // grid speed inside a frozen run is unknown: NaN, so the lap drops out of the field statistics there
        for (const q of stale) for (let k = 0; k < M; k++) if (g.time[k] > q.t0 && g.time[k] < q.t1) g.speed[k] = NaN;
      }
    } else raw = ch.time_s.map((t, i) => ({ t, s: sOf[i], v: ch.speed_kmh[i], thr: ch.throttle_pct[i], brk: ch.brake[i] ? 1 : 0, gear: ch.gear[i], rpm: ch.rpm[i] })).filter(r => isNum(r.v));
    return {
      code: lap.driver && lap.driver.code, team: lap.driver && lap.driver.team, lap_time_s: lap.lap && lap.lap.lap_time_s,
      lap: lap.lap || {}, grid: g, raw, warp: w, stale: stale.map(q => ({ from_m: round(q.s0, 0), to_m: round(q.s1, 0), samples: q.i1 - q.i0 + 1, speed_kmh: q.v })), sOf, time: ch.time_s, lap_len_speed_m: ch.distance_m[n - 1],
      proj_rms_m: Math.sqrt(proj.d.reduce((a, b) => a + b * b, 0) / n),
    };
  }

  // ------------------------------------------------------------------ geometry
  // field racing line: median across laps of x/y at the same fraction of each lap's own length
  function medianLine(laps, N) {
    const rs = laps.map(l => resampleOpenFraction(l.channels.x_m, l.channels.y_m, N)), X = [], Y = [];
    for (let k = 0; k < N; k++) { X.push(median(rs.map(r => r.x[k]))); Y.push(median(rs.map(r => r.y[k]))); }
    return { x: X, y: Y };
  }
  // aligns an OSM centreline (x east, z south, metres) onto the telemetry frame: coarse search over cyclic shift, travel
  // direction and mirror on arc-length fraction, then ICP refinement; the applied move is rigid (scale 1, reported)
  function alignOsm(osmCenter, line) {
    const ox = osmCenter.map(p => p[0]), oy = osmCenter.map(p => -p[1]);   // (east, north): right-handed
    const NC = 400, A = resampleClosed(ox, oy, NC), B = resampleOpenFraction(line.x, line.y, NC);
    let best = null;
    for (const mirror of [false, true]) for (const dir of [1, -1]) for (let k = 0; k < NC; k++) {
      const idx = B.x.map((_, i) => (((dir * i + k) % NC) + NC) % NC);
      const ax = idx.map(i => A.x[i]), ay = idx.map(i => A.y[i]);
      const f = procrustes(ax, ay, B.x, B.y, mirror), T = applyFit(f, ax, ay, true);
      let e = 0; for (let i = 0; i < NC; i++) e += (T.x[i] - B.x[i]) ** 2 + (T.y[i] - B.y[i]) ** 2;
      if (!best || e < best.e) best = { e, f, dir, k };
    }
    // ICP: nearest dense-OSM point for each racing-line point, refit (similarity for the diagnostic, rigid applied)
    const dense = resampleClosed(ox, oy, Math.round(A.L / 2));
    let f = best.f;
    for (let it = 0; it < 12; it++) {
      const T = applyFit(f, dense.x, dense.y, true), mx = [], my = [];
      for (let i = 0; i < line.x.length; i++) {
        let bd = Infinity, bj = 0; for (let j = 0; j < T.x.length; j++) { const d = (T.x[j] - line.x[i]) ** 2 + (T.y[j] - line.y[i]) ** 2; if (d < bd) { bd = d; bj = j; } }
        mx.push(dense.x[bj]); my.push(dense.y[bj]);
      }
      f = procrustes(mx, my, line.x, line.y, best.f.mirror);
    }
    const rigid = applyFit(f, dense.x, dense.y, false);
    return { fit: f, dir: best.dir, x: rigid.x, y: rigid.y, L: dense.L, osm_dense: dense };
  }
  // the model centreline: equally spaced (~2 m), starting at the timing line, in the driving direction
  function buildCentreline(xs, ys, startXY, driveXY) {
    let N = Math.round(resampleClosed(xs, ys, xs.length).L / SETTINGS.geom_step_m);
    let r = resampleClosed(xs, ys, N);
    let cl = { x: r.x, y: r.y, N, L: r.L, step: r.L / N };
    // driving direction: a racing-line point 50 samples on must project ahead of the start
    const p0 = projectGlobal(cl, startXY[0], startXY[1]), p1 = projectGlobal(cl, driveXY[0], driveXY[1]);
    let ahead = p1.s - p0.s; if (ahead < -cl.L / 2) ahead += cl.L; if (ahead > cl.L / 2) ahead -= cl.L;
    const X = cl.x.slice(), Y = cl.y.slice();
    if (ahead < 0) { X.reverse(); Y.reverse(); }
    // rotate so index 0 sits exactly on the timing line
    const tmp = { x: X, y: Y, N, L: cl.L, step: cl.step }, q = projectGlobal(tmp, startXY[0], startXY[1]);
    const rx = [], ry = [];
    for (let k = 0; k < N; k++) {
      const s = (q.s + k * cl.step) % cl.L, i = Math.floor(s / cl.step) % N, j = (i + 1) % N, t = s / cl.step - Math.floor(s / cl.step);
      rx.push(X[i] + t * (X[j] - X[i])); ry.push(Y[i] + t * (Y[j] - Y[i]));
    }
    r = resampleClosed(rx, ry, N);
    return { x: r.x, y: r.y, N, L: r.L, step: r.L / N, reversed: ahead < 0, osm_start_s: p0.s };
  }

  // ------------------------------------------------------------------ corners
  function wrapS(s, L) { return ((s % L) + L) % L; }
  function idxOf(s, step, M) { return ((Math.round(s / step) % M) + M) % M; }
  function geometricCorners(cl, curv, markers, names) {
    const L = cl.L, step = cl.step, N = cl.N;
    const ms = markers.map(m => Object.assign({}, m, { s: projectGlobal(cl, m.x_m, m.y_m).s })).sort((a, b) => a.s - b.s);
    const signed = (a, b) => { let d = b - a; if (d < -L / 2) d += L; if (d > L / 2) d -= L; return d; };
    return ms.map((m, k) => {
      const prev = ms[(k - 1 + ms.length) % ms.length], next = ms[(k + 1) % ms.length];
      const back = Math.min(SETTINGS.corner_half_window_m, Math.abs(signed(prev.s, m.s)) / 2), fwd = Math.min(SETTINGS.corner_half_window_m, Math.abs(signed(m.s, next.s)) / 2);
      const i0 = Math.round((m.s - back) / step), i1 = Math.round((m.s + fwd) / step), at = i => ((i % N) + N) % N;
      // heading change across the window from the summed curvature (robust to the unwrap seam)
      const cum = [0]; for (let i = i0; i < i1; i++) cum.push(cum[cum.length - 1] + curv.dpsi[at(i)]);
      const total = cum[cum.length - 1], dirSign = total >= 0 ? 1 : -1;
      const fA = SETTINGS.corner_frac[0] * total, fB = SETTINGS.corner_frac[1] * total;
      let ie = i0, ix = i1;
      for (let j = 0; j < cum.length; j++) if (dirSign * cum[j] >= dirSign * fA) { ie = i0 + j; break; }
      for (let j = 0; j < cum.length; j++) if (dirSign * cum[j] >= dirSign * fB) { ix = i0 + j; break; }
      let ia = ie, ka = 0; for (let i = ie; i <= ix; i++) { const v = dirSign * curv.kappa[at(i)]; if (v > ka) { ka = v; ia = i; } }
      const arc = (ix - ie) * step, ang = (cum[ix - i0] - cum[ie - i0]);
      return {
        n: m.number, letter: m.letter || "", id: "T" + m.number + (m.letter || ""), name: (names && names[m.number]) || ("T" + m.number),
        marker_m: round(m.s, 1), entry_m: round(wrapS(ie * step, L), 1), apex_m: round(wrapS(ia * step, L), 1), exit_m: round(wrapS(ix * step, L), 1),
        direction: total >= 0 ? "left" : "right", turn_angle_deg: round((Math.abs(total) * 180) / Math.PI, 1),
        apex_radius_geom_m: ka > 0 ? round(1 / ka, 1) : null, mean_radius_geom_m: Math.abs(ang) > 1e-6 ? round(arc / Math.abs(ang), 1) : null,
        arc_m: round(arc, 1),
      };
    });
  }
  // [a, b] on a loop of length L, as an unwrapped interval with a <= b
  function span(a, b, L) { return b >= a ? [a, b] : [a, b + L]; }

  // ------------------------------------------------------------------ the field: statistics across laps
  function rawWindow(raw, a, b) { return raw.filter(r => r.s >= a && r.s <= b); }
  function cornerDriving(lapP, corner, prevVminS, M, L) {
    const raw = lapP.raw, g = lapP.grid, step = L / M;
    const [e, x] = span(corner.window_m[0], corner.window_m[1], L);
    // corners that straddle the line are evaluated in this lap's own record (rare; none at Silverstone)
    const W = rawWindow(raw, e, Math.min(x, L));
    if (!W.length) return null;
    let vm = W[0]; for (const r of W) if (r.v < vm.v) vm = r;
    const sV = vm.s, lo = Math.max(0, Math.max(prevVminS == null ? -Infinity : prevVminS, sV - 700));
    // a telemetry dropout (> 0.8 s between raw samples) from 300 m before the minimum to the window's end voids this corner
    const span0 = raw.filter(r => r.s >= Math.max(lo, sV - 300) && r.s <= x), iFirst = raw.indexOf(span0[0]);
    for (let i = Math.max(1, iFirst); i < raw.length && raw[i - 1].s <= x; i++) if (raw[i].s >= Math.max(lo, sV - 300) && raw[i].t - raw[i - 1].t > SETTINGS.dropout_s) return null;
    const before = raw.filter(r => r.s > lo && r.s <= sV + 10);
    // braking: the last brake-on sample up to the speed minimum, walked back allowing 2-sample gaps
    let brake = null;
    for (let i = before.length - 1; i >= 0; i--) if (before[i].brk) {
      if (before[i].s < sV - 250) break;
      let j = i, gap = 0; for (let q = i - 1; q >= 0; q--) { if (before[q].brk) { j = q; gap = 0; } else if (++gap > 2) break; }
      brake = before[j]; break;
    }
    // lift: a run of throttle < 95 % that is still on within 40 m of the speed minimum, walked back allowing 1-sample gaps
    let lift = null;
    for (let i = before.length - 1; i >= 0; i--) if (before[i].thr < SETTINGS.lift_throttle_pct) {
      if (before[i].s < sV - 40) break;
      let j = i, gap = 0; for (let q = i - 1; q >= 0; q--) { if (before[q].thr < SETTINGS.lift_throttle_pct) { j = q; gap = 0; } else if (++gap > 1) break; }
      lift = before[j]; break;
    }
    const start = brake || lift;
    let entry = null, decel = null, gearMin = null;
    if (start) {
      const pre = raw.filter(r => r.s >= start.s - 50 && r.s <= start.s); entry = pre.length ? Math.max(...pre.map(r => r.v)) : start.v;
      const zone = raw.filter(r => r.s >= start.s - 5 && r.s <= sV);
      for (let i = 1; i < zone.length; i++) { const a = ((zone[i - 1].v - zone[i].v) / 3.6) / (zone[i].t - zone[i - 1].t); if (a > 0 && (decel == null || a > decel)) decel = a; }
    }
    const gz = raw.filter(r => r.s >= Math.min(start ? start.s : e, e) && r.s <= x);
    if (gz.length) gearMin = Math.min(...gz.map(r => r.gear));
    // full throttle back on after the minimum (only for corners with a lift or a brake)
    let pickup = null;
    if (start) { const p = raw.find(r => r.s >= sV && r.thr >= SETTINGS.full_throttle_pct); if (p) pickup = p.s; }
    const ga = k => g.alat[((k % M) + M) % M], gt = s => interp(lapP.sOf, lapP.time, s);
    const sgn = corner.direction === "left" ? 1 : -1;
    // peak lateral acceleration (towards the inside of the corner) within [entry, exit]
    let latPeak = null, kPeak = null;
    const [ge0, gx0] = span(corner.entry_m, corner.exit_m, L);
    for (let s = ge0; s <= gx0 + 1e-9; s += step) { const k = idxOf(s, step, M), v = (ga(k) * sgn) / G; if (latPeak == null || v > latPeak) { latPeak = v; kPeak = k; } }
    // the apex: the speed minimum when the driver lifted or braked and it is a true local minimum of the raw speed (not a window
    // edge where the car is still slowing for the next corner or accelerating out of the last); otherwise the peak lateral g
    const iv = raw.indexOf(vm), nb = [raw[iv - 1], raw[iv + 1]].filter(Boolean);
    const flat = !start, localMin = !flat && nb.length === 2 && nb.every(r => r.v >= vm.v);
    const kA = localMin ? idxOf(sV, step, M) : kPeak;
    const vApex = localMin ? vm.v : g.speed[kA];
    const latApex = ((ga(kA - 1) + ga(kA) + ga(kA + 1)) / 3) * sgn / G;
    const va = vApex / 3.6;
    return {
      flat, local_min: localMin, apex_kmh: vApex, apex_at_m: kA * step, v_min_kmh: vm.v, v_min_at_m: sV, v_at_geom_apex_kmh: g.speed[idxOf(corner.apex_m, step, M)],
      brake_start_m: brake ? brake.s : null, lift_start_m: lift ? lift.s : null, entry_speed_kmh: entry,
      braking_m: brake ? sV - brake.s : null,
      peak_decel_g: decel != null ? decel / G : null, min_gear: gearMin,
      full_throttle_m: pickup, pickup_after_min_m: pickup != null ? pickup - sV : null,
      time_s: (() => { const [ge, gx] = span(corner.entry_m, corner.exit_m, L); return gx <= L ? gt(gx) - gt(ge) : null; })(),
      lat_g_apex: latApex, lat_g_peak: latPeak,
      r_eff_m: isNum(va) && latApex > 0.3 ? (va * va) / (latApex * G) : null,
    };
  }

  function straightsFromField(fieldThrottleShare, M, L) {
    const step = L / M, mask = fieldThrottleShare.map(v => v >= 0.5);
    const runs = []; let i = 0;
    while (i < M) { if (!mask[i]) { i++; continue; } let j = i; while (j + 1 < M && mask[j + 1]) j++; runs.push([i, j]); i = j + 1; }
    // merge across short gaps (< 15 m) and across the timing line
    const merged = [];
    for (const r of runs) { const last = merged[merged.length - 1]; if (last && (r[0] - last[1]) * step < 15) last[1] = r[1]; else merged.push(r.slice()); }
    if (merged.length > 1 && merged[0][0] === 0 && merged[merged.length - 1][1] === M - 1) { const last = merged.pop(); merged[0] = [last[0], merged[0][1] + M]; }
    return merged.filter(r => (r[1] - r[0]) * step >= SETTINGS.straight_min_m).map(r => ({ i0: r[0], i1: r[1], start_m: round(r[0] * step, 1), end_m: round(wrapS(r[1] * step, L), 1), length_m: round((r[1] - r[0]) * step, 1) }));
  }
  function straightDriving(lapP, st, M, L) {
    const g = lapP.grid, step = L / M, at = k => ((k % M) + M) % M, T = lapP.lap_time_s || g.time[M - 1];
    const full = k => g.throttle[at(k)] >= SETTINGS.straight_throttle_pct;
    // the driver's own longest full-throttle run that overlaps the field straight (searched 150 m either side)
    const ext = Math.round(150 / step); let best = null;
    for (let k = st.i0 - ext; k <= st.i1 + ext; k++) {
      if (!full(k) || (best && k <= best[1])) continue;
      let j = k; while (j + 1 <= st.i1 + ext && full(j + 1)) j++;
      let i = k; while (i - 1 >= st.i0 - ext && full(i - 1)) i--;
      const ov = Math.min(j, st.i1) - Math.max(i, st.i0);
      if (ov > 0 && (!best || j - i > best[1] - best[0])) best = [i, j];
      k = j;
    }
    if (!best) return null;
    const [i, j] = best; let kp = i;
    for (let k = i; k <= j; k++) if (g.speed[at(k)] > g.speed[at(kp)]) kp = k;
    const tAt = k => g.time[at(k)] + (k >= M ? T : 0) - (k < 0 ? T : 0);
    const peak = g.speed[at(kp)], end = g.speed[at(j)], start = g.speed[at(i)];
    return {
      start_m: wrapS(i * step, L), end_m: wrapS(j * step, L), length_m: (j - i) * step, duration_s: tAt(j) - tAt(i),
      entry_kmh: start, peak_kmh: peak, peak_at_m: wrapS(kp * step, L), end_kmh: end,
      loss_kmh: peak - end, loss_per_100m_kmh: j > kp ? ((peak - end) / ((j - kp) * step)) * 100 : 0,
      gear_at_peak: g.gear[at(kp)], rpm_at_peak: g.rpm[at(kp)],
    };
  }
  function lapShares(lapP) {
    const g = lapP.grid, M = g.time.length, T = lapP.lap_time_s || g.time[M - 1];
    let full = 0, brk = 0, coast = 0, tot = 0, dFull = 0, nValid = 0;
    for (let k = 0; k < M; k++) {
      const dt = (k + 1 < M ? g.time[k + 1] : T) - g.time[k]; if (!(dt > 0) || !isNum(g.throttle[k])) continue; tot += dt;
      nValid++; if (g.throttle[k] >= SETTINGS.full_throttle_pct) { full += dt; dFull++; }
      if (g.brake[k]) brk += dt;
      else if (g.throttle[k] < SETTINGS.coast_throttle_pct) coast += dt;
    }
    return { full_throttle_pct: (100 * full) / tot, braking_pct: (100 * brk) / tot, coasting_pct: (100 * coast) / tot, full_throttle_dist_pct: (100 * dFull) / nValid };
  }

  // straight-mode activation zones, from texts like "65m after T18"
  function parseZones(weekend, corners, L) {
    const z = weekend && weekend.active_aero_straight_mode && weekend.active_aero_straight_mode.zones;
    if (!Array.isArray(z)) return [];
    const pos = txt => { const m = /(\d+(?:\.\d+)?)\s*m\s+after\s+T(\d+)/i.exec(txt || ""); if (!m) return null; const c = corners.find(k => k.n === +m[2]); return c ? round(wrapS(c.marker_m + +m[1], L), 1) : null; };
    return z.map(o => ({ zone: o.zone, activation_text: o.normal_grip_activation, activation_m: pos(o.normal_grip_activation), low_grip_activation_text: o.low_grip_activation || null, low_grip_activation_m: pos(o.low_grip_activation), straight: o.straight || null }));
  }

  // ------------------------------------------------------------------ the build (pure: parsed inputs in, model out)
  // inputs = { id, name?, laps: [lap json (qualifying)], raceLaps?: [lap json], circuit: markers json, osm?: EI.TRACKS[id],
  //            weekend?: weekend json, names?: {n: name}, files?: [{path, sha256}] }
  function buildModel(inp) {
    const laps = inp.laps.slice().sort((a, b) => (a.driver.code < b.driver.code ? -1 : 1));
    if (laps.length < 1) throw new Error("track.buildModel: no laps for " + inp.id);
    const line = medianLine(laps, 1200);
    // centreline: OSM aligned onto the telemetry frame when available, else the smoothed field-median racing line
    let source, align = null, base;
    if (inp.osm && Array.isArray(inp.osm.center)) {
      const a = alignOsm(inp.osm.center, line); base = { x: a.x, y: a.y }; source = "osm";
      align = { rotation_deg: round((a.fit.th * 180) / Math.PI, 3), mirrored: a.fit.mirror, similarity_scale: round(a.fit.scale, 5), translation_m: [round(a.fit.tx - a.fit.cx, 2), round(a.fit.ty - a.fit.cy, 2)], osm_polyline_m: round(a.L, 1) };
    } else {
      const r = resampleClosed(line.x, line.y, Math.round(resampleClosed(line.x, line.y, line.x.length).L / 2)), sm = { x: smoothPeriodic(r.x, 2), y: smoothPeriodic(r.y, 2) };
      base = sm; source = "telemetry-median-line";
    }
    const startXY = [median(laps.map(l => l.channels.x_m[0])), median(laps.map(l => l.channels.y_m[0]))];
    const cl = buildCentreline(base.x, base.y, startXY, [line.x[50], line.y[50]]);
    const L = cl.L, curv = curvatureClosed(cl, SETTINGS.kappa_sigma_m);
    const M = Math.round(L / SETTINGS.grid_step_m), step = L / M;
    const P = laps.map(l => processLap(l, cl, M));
    const R = (inp.raceLaps || []).map(l => Object.assign(processLap(l, cl, M), { role: l.role || null, race_lap: (l.race_context && l.race_context.lap_number) || (l.lap && l.lap.lap_number) }));
    if (align) {
      let e = 0; const rp = projectPath(cl, line.x, line.y); for (const d of rp.d) e += d * d;
      align.racing_line_to_centreline_rms_m = round(Math.sqrt(e / rp.d.length), 2);
    }
    const netTurn = curv.dpsi.reduce((a, b) => a + b, 0);

    // elevation (relative) from the OSM file's profile, mapped by lap fraction from its own origin
    let elevation = null;
    if (source === "osm" && Array.isArray(inp.osm.elevation) && inp.osm.elevation.length > 2) {
      const ev = inp.osm.elevation, Lo = ev[ev.length - 1][0], frac0 = cl.osm_start_s / L;
      const prof = []; for (let s = 0; s < L; s += 50) {
        let f = s / L; f = cl.reversed ? (frac0 - f) : (frac0 + f); f = ((f % 1) + 1) % 1;
        prof.push([round(s, 1), round(interp(ev.map(p => p[0]), ev.map(p => p[1]), f * Lo), 2)]);
      }
      elevation = { note: "relative height (m) from the elevation profile in js/data/" + inp.id + ".js, mapped by lap fraction; that file does not document its elevation source, so treat as indicative", profile: prof };
    }

    // corners (geometry)
    const corners = geometricCorners(cl, curv, inp.circuit.corners, inp.names);
    // driving window: the geometric [entry, exit] widened by 40 m each way (drivers' minima often sit just past a tight
    // corner's geometric exit), never past halfway to the neighbouring corners' geometric apexes
    corners.forEach((c, k) => {
      const prev = corners[(k - 1 + corners.length) % corners.length], next = corners[(k + 1) % corners.length];
      const gapP = wrapS(c.apex_m - prev.apex_m, L), gapN = wrapS(next.apex_m - c.apex_m, L);
      const lo = Math.max(c.apex_m - wrapS(c.apex_m - c.entry_m, L) - SETTINGS.corner_drive_margin_m, c.apex_m - (corners.length > 1 ? gapP / 2 : L / 2));
      const hi = Math.min(c.apex_m + wrapS(c.exit_m - c.apex_m, L) + SETTINGS.corner_drive_margin_m, c.apex_m + (corners.length > 1 ? gapN / 2 : L / 2));
      c.window_m = [round(wrapS(lo, L), 1), round(wrapS(hi, L), 1)];
    });

    // sectors from each lap's sector times
    const splits = P.map(p => { const sec = p.lap.sector_s; if (!Array.isArray(sec) || sec.length < 2) return null; const t1 = sec[0], t2 = sec[0] + sec[1]; return [interp(p.time, p.sOf, t1), interp(p.time, p.sOf, t2)]; }).filter(Boolean);
    const split1 = stats(splits.map(v => v[0]), 1), split2 = stats(splits.map(v => v[1]), 1);
    const sb = [0, split1.mean, split2.mean, L];
    const sectorOf = s => (s < sb[1] ? 1 : s < sb[2] ? 2 : 3);
    const wk = inp.weekend && inp.weekend.circuit;
    const pubSplits = wk && wk.sectors && wk.sectors.split_points_from_control_line_km && wk.sectors.split_points_from_control_line_km.value;
    const officialLen = wk && wk.centreline_length_km && wk.centreline_length_km.value ? wk.centreline_length_km.value * 1000 : isNum(inp.official_length_m) ? inp.official_length_m : null;

    // per-corner driving statistics
    const per = {}; for (const p of P) per[p.code] = [];
    for (const p of P) { let prev = null; for (const c of corners) { const d = cornerDriving(p, c, prev, M, L); per[p.code].push(d); if (d) prev = d.apex_at_m; } }
    const teams = Array.from(new Set(P.map(p => p.team))).sort();
    const cornerOut = corners.map((c, ci) => {
      const rows = P.map(p => per[p.code][ci]).filter(Boolean), f = k => rows.map(r => r[k]);
      const vmin = stats(f("apex_kmh"), 1);
      const braked = rows.filter(r => r.brake_start_m != null).length, lifted = rows.filter(r => r.lift_start_m != null || r.brake_start_m != null).length;
      const out = Object.assign({}, c, {
        sector: sectorOf(c.apex_m),
        type: vmin.mean < SETTINGS.slow_kmh ? "slow" : vmin.mean > SETTINGS.fast_kmh ? "fast" : "medium",
        apex_speed_kmh: vmin, apex_at_m: stats(f("apex_at_m"), 1), drivers_flat: rows.filter(r => r.flat).length, drivers_local_min: rows.filter(r => r.local_min).length,
        min_speed_kmh: stats(f("v_min_kmh"), 1), min_speed_at_m: stats(f("v_min_at_m"), 1), speed_at_geom_apex_kmh: stats(f("v_at_geom_apex_kmh"), 1),
        r_eff_m: stats(f("r_eff_m"), 1), lat_g_apex: stats(f("lat_g_apex"), 2), lat_g_peak: stats(f("lat_g_peak"), 2),
        drivers_braking: braked, drivers_lifting: lifted,
        brake_start_m: stats(f("brake_start_m"), 1), lift_start_m: stats(f("lift_start_m"), 1), braking_distance_m: stats(f("braking_m"), 1),
        entry_speed_kmh: stats(f("entry_speed_kmh"), 1), peak_decel_g: stats(f("peak_decel_g"), 2), min_gear: stats(f("min_gear"), 2),
        full_throttle_m: stats(f("full_throttle_m"), 1), pickup_after_min_m: stats(f("pickup_after_min_m"), 1), time_s: stats(f("time_s"), 3),
        by_team: {},
      });
      for (const t of teams) { const tr = P.filter(p => p.team === t).map(p => per[p.code][ci]).filter(Boolean); out.by_team[t] = { apex_speed_kmh: stats(tr.map(r => r.apex_kmh), 1), time_s: stats(tr.map(r => r.time_s), 3) }; }
      out.by_driver = {}; for (const p of P) { const r = per[p.code][ci]; if (r) out.by_driver[p.code] = { apex_kmh: round(r.apex_kmh, 1), flat: r.flat, brake_m: round(r.brake_start_m, 0), gear: r.min_gear, time_s: round(r.time_s, 3) }; }
      return out;
    });

    // field traces
    // racing-line metres per grid cell (field mean of each lap's speed-integral distance), so speed traces integrate to lap times
    const lineStep = []; for (let k = 0; k < M; k++) lineStep.push(round(P.reduce((a, p) => a + ((k + 1 < M ? p.grid.d[k + 1] : p.lap_len_speed_m) - p.grid.d[k]), 0) / P.length, 3));
    const field = { step_m: round(step, 4), n: M, line_step_m: lineStep, speed: { mean: [], std: [], min: [], max: [] }, throttle_mean: [], full_throttle_share: [], brake_share: [], lat_g_mean: [], gear_median: [], racing_line_offset_m: { mean: [], std: [] } };
    for (let k = 0; k < M; k++) {
      const sp = stats(P.map(p => p.grid.speed[k]), 1);
      field.speed.mean.push(sp.mean); field.speed.std.push(sp.std); field.speed.min.push(sp.min); field.speed.max.push(sp.max);
      const thr = P.map(p => p.grid.throttle[k]).filter(isNum), brk = P.map(p => p.grid.brake[k]).filter(isNum), al = P.map(p => p.grid.alat[k]).filter(isNum);
      field.throttle_mean.push(stats(thr, 1).mean);
      field.full_throttle_share.push(thr.length ? round(thr.filter(v => v >= SETTINGS.straight_throttle_pct).length / thr.length, 3) : null);
      field.brake_share.push(brk.length ? round(brk.filter(v => v).length / brk.length, 3) : null);
      field.lat_g_mean.push(al.length ? round(al.reduce((a, b) => a + b, 0) / al.length / G, 2) : null);
      field.gear_median.push(median(P.map(p => p.grid.gear[k])));
      const off = stats(P.map(p => p.grid.offset[k]), 2); field.racing_line_offset_m.mean.push(off.mean); field.racing_line_offset_m.std.push(off.std);
    }

    // straights
    const sts = straightsFromField(field.full_throttle_share, M, L);
    const zones = parseZones(inp.weekend, corners, L);
    const cornerBefore = s => { let best = null; for (const c of cornerOut) { let d = s - c.apex_m; if (d < 0) d += L; if (!best || d < best.d) best = { d, c }; } return best && best.c; };
    const cornerAfter = s => { let best = null; for (const c of cornerOut) { let d = c.apex_m - s; if (d < 0) d += L; if (!best || d < best.d) best = { d, c }; } return best && best.c; };
    const straightOut = sts.map((st, si) => {
      const rows = P.map(p => Object.assign({ code: p.code, team: p.team }, straightDriving(p, st, M, L))).filter(r => r.peak_kmh != null), f = k => rows.map(r => r[k]);
      const a = cornerBefore(st.start_m), b = cornerAfter(st.end_m);
      const inZone = zones.filter(z => z.activation_m != null && (st.i1 >= M ? (z.activation_m >= st.start_m || z.activation_m <= st.end_m) : z.activation_m >= st.start_m && z.activation_m <= st.end_m));
      const o = {
        id: "S" + (si + 1), name: (a ? a.id : "?") + " -> " + (b ? b.id : "?"), from_corner: a ? a.id : null, to_corner: b ? b.id : null,
        start_m: st.start_m, end_m: st.end_m, length_m: st.length_m, crosses_line: st.i1 >= M,
        driver_start_m: stats(f("start_m"), 1), driver_end_m: stats(f("end_m"), 1), duration_s: stats(f("duration_s"), 3), entry_kmh: stats(f("entry_kmh"), 1),
        peak_kmh: stats(f("peak_kmh"), 1), peak_at_m: stats(f("peak_at_m"), 1), end_kmh: stats(f("end_kmh"), 1),
        loss_kmh: stats(f("loss_kmh"), 1), loss_per_100m_kmh: stats(f("loss_per_100m_kmh"), 2),
        drivers_losing_over_2kmh: rows.filter(r => r.loss_kmh > 2).length,
        gear_at_peak: stats(f("gear_at_peak"), 2), rpm_at_peak: stats(f("rpm_at_peak"), 0),
        straight_mode_zones: inZone.map(z => z.zone), by_team: {},
      };
      for (const t of teams) { const tr = rows.filter(r => r.team === t); o.by_team[t] = { peak_kmh: stats(tr.map(r => r.peak_kmh), 1), loss_kmh: stats(tr.map(r => r.loss_kmh), 1) }; }
      return o;
    });

    // lap level
    const shares = P.map(p => Object.assign({ code: p.code, team: p.team }, lapShares(p)));
    const lapF = k => P.map(p => p.lap[k]);
    // speed-trap position fit: the s where the drivers' speeds best match their trap readings
    const fitTrap = key => {
      const vals = P.map(p => p.lap[key]); if (!vals.some(isNum)) return null;
      let best = null; for (let k = 0; k < M; k++) { let e = 0, n = 0; P.forEach((p, i) => { if (isNum(vals[i])) { e += (p.grid.speed[k] - vals[i]) ** 2; n++; } }); const r = Math.sqrt(e / n); if (!best || r < best.rms) best = { at_m: round(k * step, 1), rms: r }; }
      return { at_m: best.at_m, rms_kmh: round(best.rms, 2) };
    };
    const lapOut = {
      lap_time_s: stats(lapF("lap_time_s"), 3),
      sector_s: [0, 1, 2].map(i => stats(P.map(p => (Array.isArray(p.lap.sector_s) ? p.lap.sector_s[i] : null)), 3)),
      speed_trap_kmh: stats(lapF("speed_trap_kmh"), 1), i1_kmh: stats(lapF("i1_speed_kmh"), 1), i2_kmh: stats(lapF("i2_speed_kmh"), 1),
      speed_trap_fit: fitTrap("speed_trap_kmh"), i1_fit: fitTrap("i1_speed_kmh"), i2_fit: fitTrap("i2_speed_kmh"),
      full_throttle_pct: stats(shares.map(s => s.full_throttle_pct), 1), braking_pct: stats(shares.map(s => s.braking_pct), 1),
      coasting_pct: stats(shares.map(s => s.coasting_pct), 1), full_throttle_dist_pct: stats(shares.map(s => s.full_throttle_dist_pct), 1),
      lap_length_speed_integral_m: stats(P.map(p => p.lap_len_speed_m), 1),
      by_team: {}, by_driver: {},
    };
    for (const t of teams) {
      const tp = P.filter(p => p.team === t), ts = shares.filter(s => s.team === t);
      lapOut.by_team[t] = { drivers: tp.map(p => p.code), lap_time_s: stats(tp.map(p => p.lap_time_s), 3), speed_trap_kmh: stats(tp.map(p => p.lap.speed_trap_kmh), 1), full_throttle_pct: stats(ts.map(s => s.full_throttle_pct), 1) };
    }
    for (const s of shares) lapOut.by_driver[s.code] = { team: s.team, lap_time_s: P.find(p => p.code === s.code).lap_time_s, full_throttle_pct: round(s.full_throttle_pct, 1), braking_pct: round(s.braking_pct, 1), coasting_pct: round(s.coasting_pct, 1) };

    const trace = p => ({ team: p.team, lap_time_s: p.lap_time_s, speed: p.grid.speed.map(v => round(v, 1)), warp: p.warp, projection_rms_m: round(p.proj_rms_m, 2) });
    const drivers = {}; for (const p of P) drivers[p.code] = trace(p);
    const raceLaps = {}; for (const r of R) raceLaps[r.code + "-R" + String(r.race_lap).padStart(2, "0")] = Object.assign(trace(r), { role: r.role, race_lap: r.race_lap });

    return {
      schema: "purple.track/1", version: VERSION, id: inp.id, name: inp.name || inp.id,
      what: "Measured track model: fused centreline, corner geometry and the real field's driving statistics from " + P.length + " qualifying laps",
      sources: inp.sources || null, inputs: inp.files || null, settings: SETTINGS,
      units: { distance: "m along the model centreline from the timing line", speed: "km/h", accel: "g (9.80665 m/s^2)", time: "s", stats: "{mean, std (sample, n-1), min, max, n} across drivers" },
      official: { centreline_length_m: officialLen, sector_splits_m: Array.isArray(pubSplits) ? pubSplits.map(v => v * 1000) : null },
      geometry: {
        source, length_m: round(L, 2), length_vs_official_pct: officialLen ? round((100 * (L - officialLen)) / officialLen, 3) : null,
        net_turning_deg: round((netTurn * 180) / Math.PI, 1), sense: Math.abs(netTurn) < Math.PI ? "figure-eight" : netTurn < 0 ? "clockwise" : "anticlockwise",
        frame: "F1 timing frame (OpenF1 x/y / 10, metres), assumed right-handed", alignment: align, elevation,
        centreline: { step_m: round(cl.step, 5), n: cl.N, x: cl.x.map(v => round(v, 2)), y: cl.y.map(v => round(v, 2)), kappa: curv.kappa.map(v => round(v, 5)) },
      },
      sectors: { splits_m: [split1, split2], published_splits_m: Array.isArray(pubSplits) ? pubSplits.map(v => v * 1000) : null },
      quality: { frozen_speed: P.concat(R).filter(p => p.stale.length).map(p => ({ lap: p.code + (p.race_lap ? "-R" + p.race_lap : ""), runs: p.stale })), projection_rms_m: stats(P.map(p => p.proj_rms_m), 2) },
      corners: cornerOut, straights: straightOut, straight_mode_zones: zones, lap: lapOut, field, drivers, race_laps: raceLaps,
    };
  }

  // ------------------------------------------------------------------ read API
  const registry = {};
  let current = null;
  function register(model) { if (!model || !model.id) throw new Error("track.register: not a model"); registry[model.id] = model; current = model; return model; }
  function load(id) {
    if (id && typeof id === "object" && id.schema) return register(id);
    id = String(id || "silverstone").toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(id)) throw new Error("track.load: bad circuit id");
    if (registry[id]) { current = registry[id]; return current; }
    if (typeof require === "function" && typeof module !== "undefined") {
      const fs = require("fs"), path = require("path"), f = path.join(__dirname, "..", "data", "tracks", id + ".json");
      if (!fs.existsSync(f)) throw new Error("track.load: no model for " + id + " (run node concept/track/build.js)");
      return register(JSON.parse(fs.readFileSync(f, "utf8")));
    }
    throw new Error("track.load: " + id + " not registered (browser: await track.loadAsync(id) or track.register(json))");
  }
  async function loadAsync(id, base) {
    if (registry[id]) return (current = registry[id]);
    if (typeof fetch !== "function") return load(id);
    const r = await fetch((base || "concept/data/tracks/") + id + ".json"); if (!r.ok) throw new Error("track.loadAsync: " + r.status);
    return register(await r.json());
  }
  const modelOf = m => (m && typeof m === "object" ? m : m ? load(m) : current || load("silverstone"));
  function corners(m) { return modelOf(m).corners; }
  function straights(m) { return modelOf(m).straights; }
  // a real lap json projected onto a model's grid (the build's own pipeline): { s_m, v_kmh, time_s }
  function traceFromLap(lap, m) {
    const model = modelOf(m), c = model.geometry.centreline, cl = { x: c.x, y: c.y, N: c.n, L: model.geometry.length_m, step: c.step_m };
    const p = processLap(lap, cl, model.field.n);
    return { s_m: p.grid.speed.map((_, k) => k * model.field.step_m), v_kmh: p.grid.speed.map(v => round(v, 1)), time_s: p.grid.time };
  }

  // ------------------------------------------------------------------ compare a simulated (or real) speed trace with the field
  // simTrace: { s_m | distance_m | s, v_kmh | speed_kmh | v }. opts.basis: "model" (distances already on the model axis),
  // "fraction" (scaled by lap fraction), "driver:XXX" (distances along that driver's speed-integral axis, mapped by its warp).
  // Default: "model" when the trace length is within 0.5 % of the model length, else "fraction". opts.driver: a driver code.
  function compare(simTrace, m, opts) {
    opts = opts || {};
    const model = modelOf(m), L = model.geometry.length_m, M = model.field.n, step = model.field.step_m;
    const s = simTrace.s_m || simTrace.distance_m || simTrace.s, v = simTrace.v_kmh || simTrace.speed_kmh || simTrace.v;
    if (!Array.isArray(s) || !Array.isArray(v) || s.length !== v.length || s.length < 10) throw new Error("track.compare: need equal-length distance and speed arrays");
    const simLen = isNum(opts.length_m) ? opts.length_m : s[s.length - 1] + (s[s.length - 1] - s[s.length - 2]);
    let basis = opts.basis || (Math.abs(simLen - L) / L <= 0.005 ? "model" : "fraction");
    let map;
    if (basis === "model") map = x => x;
    else if (basis === "fraction") map = x => (x * L) / simLen;
    else if (/^driver:/.test(basis)) { const d = model.drivers[basis.slice(7)] || (model.race_laps || {})[basis.slice(7)]; if (!d) throw new Error("track.compare: unknown driver basis " + basis); map = x => warpS(d.warp, x); }
    else throw new Error("track.compare: unknown basis " + basis);
    const keep = s.map((x, i) => isNum(x) && isNum(v[i]));
    const ss = s.filter((_, i) => keep[i]).map(map), vv = v.filter((_, i) => keep[i]), sv = new Array(M);
    for (let k = 0; k < M; k++) sv[k] = interp(ss, vv, k * step);
    // stored traces carry null where a lap's speed channel froze; fill those linearly for minima / peaks / times
    const fill = a => { const o = a.slice(); for (let k = 0; k < o.length; k++) if (!isNum(o[k])) { let j = k; while (j < o.length && !isNum(o[j])) j++; const p = isNum(o[k - 1]) ? o[k - 1] : o[j], q = j < o.length ? o[j] : p; for (let i = k; i < j; i++) o[i] = p + ((q - p) * (i - k + 1)) / (j - k + 1); k = j; } return o; };
    const memo = {}, ref = code => { const d = model.drivers[code] || (model.race_laps || {})[code]; if (!d) return null; return memo[code] || (memo[code] = { speed: fill(d.speed), raw: d.speed }); };
    const driver = opts.driver ? ref(opts.driver) : null;
    if (opts.driver && !driver) throw new Error("track.compare: no lap for " + opts.driver);
    const err = (a, b) => { let e = 0, mx = 0, mean = 0, n = 0; for (let k = 0; k < M; k++) { if (!isNum(a[k]) || !isNum(b[k])) continue; const d = a[k] - b[k]; e += d * d; mean += d; n++; if (Math.abs(d) > Math.abs(mx)) mx = d; } return { rms_kmh: round(Math.sqrt(e / n), 3), mean_kmh: round(mean / n, 3), max_abs_kmh: round(mx, 2), n }; };
    const ls = model.field.line_step_m || [];
    const lapTime = arr => { let t = 0; for (let k = 0; k < M; k++) { const a = arr[k], b = arr[(k + 1) % M]; t += (isNum(ls[k]) ? ls[k] : step) / (((a + b) / 2) / 3.6); } return t; };
    const codes = Object.keys(model.drivers), fieldV = code => ref(code).speed;
    const minIn = (arr, c) => { const [a, b] = span(c.window_m[0], c.window_m[1], L); let mn = Infinity; for (let x = a; x <= b + 1e-9; x += step) { const val = arr[idxOf(x, step, M)]; if (val < mn) mn = val; } return mn; };
    const peakIn = (arr, st) => { const [a, b] = span(st.start_m, st.end_m, L); let mx = -Infinity; for (let x = a; x <= b + 1e-9; x += step) mx = Math.max(mx, arr[idxOf(x, step, M)]); return mx; };
    const valAt = (arr, x) => arr[idxOf(x, step, M)];
    const cornersOut = model.corners.map(c => {
      const simMin = minIn(sv, c), fieldMins = codes.map(k => minIn(fieldV(k), c)), fs = stats(fieldMins, 2);
      const o = { id: c.id, name: c.name, type: c.type, sim_min_kmh: round(simMin, 1), field_min_kmh: fs.mean, field_std_kmh: fs.std, delta_field_kmh: round(simMin - fs.mean, 2), z: fs.std > 0 ? round((simMin - fs.mean) / fs.std, 2) : null };
      if (driver) { const dm = minIn(driver.speed, c); o.driver_min_kmh = round(dm, 1); o.delta_driver_kmh = round(simMin - dm, 2); }
      return o;
    });
    const straightsOut = model.straights.map(st => {
      const sp = peakIn(sv, st), fp = stats(codes.map(k => peakIn(fieldV(k), st)), 2), se = valAt(sv, st.end_m), fe = stats(codes.map(k => valAt(fieldV(k), st.end_m)), 2);
      const o = { id: st.id, name: st.name, sim_peak_kmh: round(sp, 1), field_peak_kmh: fp.mean, delta_peak_field_kmh: round(sp - fp.mean, 2), sim_end_kmh: round(se, 1), field_end_kmh: fe.mean, delta_end_field_kmh: round(se - fe.mean, 2) };
      if (driver) { o.delta_peak_driver_kmh = round(sp - peakIn(driver.speed, st), 2); o.delta_end_driver_kmh = round(se - valAt(driver.speed, st.end_m), 2); }
      return o;
    });
    const rmsC = (rows, k) => { const v = rows.map(r => r[k]).filter(isNum); return v.length ? round(Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length), 3) : null; };
    const simT = lapTime(sv), fieldT = stats(codes.map(k => lapTime(fieldV(k))), 3);
    return {
      circuit: model.id, basis, sim_length_m: round(simLen, 1), model_length_m: L,
      vs_field: Object.assign(err(sv, model.field.speed.mean), { corner_rms_kmh: rmsC(cornersOut, "delta_field_kmh") }),
      vs_driver: driver ? Object.assign({ driver: opts.driver }, err(sv, driver.raw), { corner_rms_kmh: rmsC(cornersOut, "delta_driver_kmh") }) : null,
      lap_time_from_speed_s: { sim: round(simT, 3), field: fieldT, driver: driver ? round(lapTime(driver.speed), 3) : null },
      corners: cornersOut, straights: straightsOut,
    };
  }

  const api = {
    VERSION, SETTINGS, G, load, loadAsync, register, corners, straights, compare, traceFromLap, buildModel,
    // internals exported for the build and the tests
    _: { stats, median, smoothPeriodic, smoothOpen, interp, resampleClosed, procrustes, applyFit, projectGlobal, projectPath, curvatureClosed, lateralAccel, distanceWarp, processLap, alignOsm, parseZones },
  };
  C.track = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
