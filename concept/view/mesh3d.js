// PURPLE CONCEPT - concept car view v3: the pure mesh kit (no three.js, no DOM). Lofts, lathes, swept tubes, rounded slabs,
// ear-clipped caps, airfoil sections and interpolation helpers that concept/view/car3d.js builds every part from. Everything is
// plain arrays, so Node (test/concept-view-dims.test.js) measures exactly the vertices the browser draws.
//   const M = mesh3d.mesh(); mesh3d.loft(M, rings, { wrap, capA, capB, segments, solid }); M.finish() -> { pos, nrm, uv, idx }
// Winding: a piece marked `solid` (closed) is oriented outward by its signed volume; an open piece takes `inside` (a point the
// normals must face away from) or `flip`. Normals are smooth (area-weighted) inside a piece; separate pieces / ring segments give
// hard creases (a wing's trailing-edge face, a plate's faces).
// Dual browser / Node: window.EI.concept.mesh3d and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const ss = (a, b, x) => sstep((x - a) / (b - a));
  const rad = d => d * Math.PI / 180;

  // ---------------------------------------------------------------- mesh accumulator
  // growable typed buffers (fewer allocations than plain arrays: the car is ~150k vertices per build)
  function buf(T, n) { const b = { a: new T(n), n: 0 }; b.push3 = (x, y, z) => { if (b.n + 3 > b.a.length) { const a = new T(b.a.length * 2); a.set(b.a); b.a = a; } b.a[b.n++] = x; b.a[b.n++] = y; b.a[b.n++] = z; }; b.push2 = (x, y) => { if (b.n + 2 > b.a.length) { const a = new T(b.a.length * 2); a.set(b.a); b.a = a; } b.a[b.n++] = x; b.a[b.n++] = y; }; return b; }
  function mesh() {
    const Pb = buf(Float64Array, 3072), Ub = buf(Float32Array, 2048), Ib = buf(Uint32Array, 6144);
    // P / U / I: typed views (index access, length) over the filled part of the growing buffers
    const M = {
      get P() { return Pb.a.subarray(0, Pb.n); }, get U() { return Ub.a.subarray(0, Ub.n); }, get I() { return Ib.a.subarray(0, Ib.n); },
      get count() { return Pb.n / 3; },
      v(x, y, z, u, w) { Pb.push3(x, y, z); Ub.push2(u || 0, w || 0); return Pb.n / 3 - 1; },
      t(a, b, c) { Ib.push3(a, b, c); },
      // orientation of the triangles I[i0..i1): solid = by signed volume; inside = face away from a point; flip = reverse
      orient(i0, i1, o) {
        const P = Pb.a, I = Ib.a; let flip = !!(o && o.flip);
        if (o && (o.solid || o.inside)) {
          let s = 0;
          for (let k = i0; k < i1; k += 3) {
            const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
            const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b] - ax, by = P[b + 1] - ay, bz = P[b + 2] - az, cx = P[c] - ax, cy = P[c + 1] - ay, cz = P[c + 2] - az;
            const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
            if (o.solid) s += ax * nx + ay * ny + az * nz;   // 6 × signed volume
            else { const q = o.inside; s += nx * (ax + bx / 3 + cx / 3 - q[0]) + ny * (ay + by / 3 + cy / 3 - q[1]) + nz * (az + bz / 3 + cz / 3 - q[2]); }
          }
          if (s < 0) flip = !flip;
        }
        if (flip) for (let k = i0; k < i1; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
      },
      // typed arrays with smooth normals (area weighted, per shared vertex)
      finish() {
        const I = Ib.a.subarray(0, Ib.n), pos = new Float32Array(Pb.a.subarray(0, Pb.n)), n = pos.length / 3, nrm = new Float32Array(n * 3);
        for (let k = 0; k < I.length; k += 3) {
          const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
          const bx = pos[b] - pos[a], by = pos[b + 1] - pos[a + 1], bz = pos[b + 2] - pos[a + 2], cx = pos[c] - pos[a], cy = pos[c + 1] - pos[a + 1], cz = pos[c + 2] - pos[a + 2];
          const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
          nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz; nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz; nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
        }
        for (let i = 0; i < n; i++) { const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1; nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l; if (l === 1 && !nrm[i * 3 + 1]) nrm[i * 3 + 1] = 1; }
        const idx = n > 65535 ? new Uint32Array(I) : new Uint16Array(I);
        return { pos, nrm, uv: Ub.a.slice(0, Ub.n), idx, count: n };
      },
      bbox() { const P = Pb.a.subarray(0, Pb.n), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); } return { lo, hi }; },
    };
    return M;
  }

  // ---------------------------------------------------------------- triangulation (ear clipping on the ring's best plane)
  function newell(ring) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  }
  // returns triangles as index triples into `pts2` (array of [x, y]); robust to collinear points
  function earclip(pts2) {
    const n = pts2.length; if (n < 3) return [];
    let area = 0; for (let i = 0; i < n; i++) { const a = pts2[i], b = pts2[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const V = []; for (let i = 0; i < n; i++) V.push(area >= 0 ? i : n - 1 - i);
    const tris = []; let guard = 0;
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    while (V.length > 3 && guard++ < 10 * n) {
      let cut = false;
      for (let k = 0; k < V.length; k++) {
        const i0 = V[(k - 1 + V.length) % V.length], i1 = V[k], i2 = V[(k + 1) % V.length];
        const a = pts2[i0], b = pts2[i1], c = pts2[i2];
        const cr = cross(a, b, c); if (cr <= 1e-12) { if (Math.abs(cr) <= 1e-12 && guard > 4 * n) { V.splice(k, 1); cut = true; break; } continue; }
        let inside = false;
        for (const j of V) { if (j === i0 || j === i1 || j === i2) continue; const p = pts2[j]; if (cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12) { inside = true; break; } }
        if (inside) continue;
        tris.push(area >= 0 ? [i0, i1, i2] : [i0, i2, i1]); V.splice(k, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (V.length === 3) tris.push(area >= 0 ? [V[0], V[1], V[2]] : [V[0], V[2], V[1]]);
    return tris;
  }
  // cap a 3D ring (own vertices, flat normal); `away`: the cap's normal points away from this point (else Newell's)
  function cap(M, ring, away) {
    const n = newell(ring);
    const ax = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = norm(cross3(ax, n)), e2 = cross3(n, e1);
    const pts2 = ring.map(p => [dot3(p, e1), dot3(p, e2)]);
    const b = M.count; for (const p of ring) M.v(p[0], p[1], p[2], 0.5, 0.5);
    const i0 = M.I.length;
    for (const t of earclip(pts2)) M.t(b + t[0], b + t[1], b + t[2]);
    if (away) M.orient(i0, M.I.length, { inside: away });
    return b;
  }

  // ---------------------------------------------------------------- lofts
  // rings: [[x, y, z] ...] all of the same length. o.wrap: the ring is closed. o.segments: [[i0, i1], ...] inclusive ring index ranges
  // lofted as separate strips (hard creases between them; with wrap an index range may run past the end). o.capA / o.capB: cap the
  // first / last ring. o.solid / o.inside / o.flip: orientation. o.uv: (r, i) -> [u, v] (default: i / (nP-1), r / (nR-1)).
  function loft(M, rings, o) {
    o = o || {}; const nR = rings.length, nP = rings[0].length, i0 = M.I.length;
    if (o.wrap && !o.segments) {   // one strip around the ring, the seam shared (smooth)
      const b = M.count;
      for (let r = 0; r < nR; r++) for (let i = 0; i < nP; i++) { const p = rings[r][i], uv = o.uv ? o.uv(r, i) : [i / nP, r / Math.max(1, nR - 1)]; M.v(p[0], p[1], p[2], uv[0], uv[1]); }
      for (let r = 0; r < nR - 1; r++) for (let i = 0; i < nP; i++) { const a = b + r * nP + i, a1 = b + r * nP + (i + 1) % nP; M.t(a, a + nP, a1); M.t(a1, a + nP, a1 + nP); }
    } else {
      const segs = o.segments || [[0, nP - 1]];
      for (const [s0, s1] of segs) {
        const len = s1 - s0 + 1, b = M.count;
        for (let r = 0; r < nR; r++) for (let k = 0; k < len; k++) {
          const i = (s0 + k) % nP, p = rings[r][i], uv = o.uv ? o.uv(r, i) : [k / (len - 1), r / Math.max(1, nR - 1)];
          M.v(p[0], p[1], p[2], uv[0], uv[1]);
        }
        for (let r = 0; r < nR - 1; r++) for (let k = 0; k < len - 1; k++) { const a = b + r * len + k, c = a + len; M.t(a, c, a + 1); M.t(a + 1, c, c + 1); }
      }
    }
    // a closed ring: the strip faces outward when the rings run against their winding normal (Newell); caps face away from the
    // neighbouring ring. A solid piece is then consistent and outward; open pieces use `inside` / `flip`.
    const cen = (r) => { let x = 0, y = 0, z = 0; for (const p of r) { x += p[0]; y += p[1]; z += p[2]; } return [x / r.length, y / r.length, z / r.length]; };
    const closed = !!o.wrap && nR > 1;
    if (closed) { const n0 = newell(rings[0]), c0 = cen(rings[0]), c1 = cen(rings[nR - 1]); if (n0[0] * (c1[0] - c0[0]) + n0[1] * (c1[1] - c0[1]) + n0[2] * (c1[2] - c0[2]) > 0) M.orient(i0, M.I.length, { flip: true }); }
    const capFix = (ri, rn) => { const a = M.I.length; cap(M, rings[ri]); const c0 = cen(rings[ri]), c1 = cen(rings[rn]); M.orient(a, M.I.length, { inside: [c0[0] + (c1[0] - c0[0]) * 0.5, c0[1] + (c1[1] - c0[1]) * 0.5, c0[2] + (c1[2] - c0[2]) * 0.5] }); };
    if (o.capA && nR > 1) capFix(0, 1);
    if (o.capB && nR > 1) capFix(nR - 1, nR - 2);
    if (o.solid && closed) { if (o.flip) M.orient(i0, M.I.length, { flip: true }); }
    else M.orient(i0, M.I.length, o);
    return M;
  }
  // a closed solid from rings (wrap) with both ends capped, oriented outward
  const solidLoft = (M, rings, o) => loft(M, rings, Object.assign({ wrap: true, capA: true, capB: true, solid: true }, o || {}));

  // ---------------------------------------------------------------- vectors
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len3 = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // ---------------------------------------------------------------- 2D shapes
  // superellipse |x/a|^n + |y/b|^n = 1, N points counter-clockwise from angle a0 (default 0 = +x)
  function superellipse(a, b, n, N, a0) {
    const out = [];
    for (let i = 0; i < N; i++) { const t = (a0 || 0) + 2 * Math.PI * i / N, c = Math.cos(t), s = Math.sin(t); out.push([a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]); }
    return out;
  }
  const area2 = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  // rounded polygon: [[x, y, r]] corners (r = fillet radius) -> dense closed polyline
  function roundPoly(pts, seg) {
    const out = [], n = pts.length; seg = seg || 5;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p = pts[i], p1 = pts[(i + 1) % n], r = p[2] || 0;
      if (!r) { out.push([p[0], p[1]]); continue; }
      const d0 = Math.hypot(p0[0] - p[0], p0[1] - p[1]), d1 = Math.hypot(p1[0] - p[0], p1[1] - p[1]), rr = Math.min(r, d0 * 0.45, d1 * 0.45);
      const a = [p[0] + (p0[0] - p[0]) / d0 * rr, p[1] + (p0[1] - p[1]) / d0 * rr], b = [p[0] + (p1[0] - p[0]) / d1 * rr, p[1] + (p1[1] - p[1]) / d1 * rr];
      for (let k = 0; k <= seg; k++) { const t = k / seg, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]]); }
    }
    return out;
  }
  // resample a closed polyline to N points evenly by arc length, starting at its point `start`
  function resampleClosed(pts, N, start) {
    const n = pts.length, P = []; for (let i = 0; i <= n; i++) P.push(pts[((start || 0) + i) % n]);
    const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const tot = L[L.length - 1], out = []; let j = 0;
    for (let k = 0; k < N; k++) { const s = tot * k / N; while (j < L.length - 2 && L[j + 1] < s) j++; const t = (s - L[j]) / Math.max(1e-12, L[j + 1] - L[j]); out.push([lerp(P[j][0], P[j + 1][0], t), lerp(P[j][1], P[j + 1][1], t)]); }
    return out;
  }
  // resample an open polyline to N points by arc length
  function resampleOpen(pts, N) {
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], (pts[i][2] || 0) - (pts[i - 1][2] || 0)));
    const tot = L[L.length - 1], out = []; let j = 0;
    for (let k = 0; k < N; k++) { const s = tot * k / (N - 1); while (j < L.length - 2 && L[j + 1] < s) j++; const t = clamp((s - L[j]) / Math.max(1e-12, L[j + 1] - L[j]), 0, 1); out.push(pts[j].map((v, a) => lerp(v, pts[j + 1][a], t))); }
    return out;
  }
  // inward offset of a closed CCW polygon by d (miter, limited)
  function offsetPoly(pts, d) {
    const n = pts.length, s = area2(pts) >= 0 ? 1 : -1, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
      let e0 = [p[0] - a[0], p[1] - a[1]], e1 = [b[0] - p[0], b[1] - p[1]]; const l0 = Math.hypot(e0[0], e0[1]) || 1, l1 = Math.hypot(e1[0], e1[1]) || 1;
      e0 = [e0[0] / l0, e0[1] / l0]; e1 = [e1[0] / l1, e1[1] / l1];
      const n0 = [-e0[1] * s, e0[0] * s], n1 = [-e1[1] * s, e1[0] * s];   // inward normals
      let m = [n0[0] + n1[0], n0[1] + n1[1]]; const ml = Math.hypot(m[0], m[1]) || 1; m = [m[0] / ml, m[1] / ml];
      const k = Math.min(2.5, 1 / Math.max(0.2, m[0] * n0[0] + m[1] * n0[1]));
      out.push([p[0] + m[0] * d * k, p[1] + m[1] * d * k]);
    }
    return out;
  }

  // ---------------------------------------------------------------- slabs (plates with rounded edges)
  // outline: closed 2D polygon (any winding) in the plate's (e1, e2) plane; frame: { o, e1, e2, e3 } (e3 = thickness direction);
  // th: thickness; r: edge radius (≤ th/2); K: segments over the half-round. Returns M.
  function slab(M, outline, frame, th, r, K) {
    r = Math.min(r == null ? th / 2 : r, th / 2 * 0.999); K = K || 4;
    const out = area2(outline) >= 0 ? outline : outline.slice().reverse();
    const rings = [], toW = (p, z) => add3(add3(add3(frame.o, mul3(frame.e1, p[0])), mul3(frame.e2, p[1])), mul3(frame.e3, z));
    const prof = [], Kq = Math.max(1, Math.ceil(K / 2)), flat = th / 2 - r;
    for (let k = 0; k <= Kq; k++) { const ph = -Math.PI / 2 + (Math.PI / 2) * k / Kq; prof.push([r * (1 - Math.cos(ph)), -flat + r * Math.sin(ph)]); }
    for (let k = 0; k <= Kq; k++) { if (k === 0 && flat < 1e-6) continue; const ph = (Math.PI / 2) * k / Kq; prof.push([r * (1 - Math.cos(ph)), flat + r * Math.sin(ph)]); }
    for (const [inset, z] of prof) rings.push((inset > 1e-9 ? offsetPoly(out, inset) : out).map(p => toW(p, z)));
    return loft(M, rings, { wrap: true, capA: true, capB: true, solid: true });
  }
  // plate frame helpers: a plate lying in the world's XY plane (side view outline) centred at z0; or XZ (top view) at y0
  const frameXY = (z0) => ({ o: [0, 0, z0], e1: [1, 0, 0], e2: [0, 1, 0], e3: [0, 0, 1] });

  // ---------------------------------------------------------------- swept tubes
  // path: [[x, y, z]]; section(t, k) -> [[a, b]] 2D points (same count every station) in the (n, b) frame of the path at t;
  // up: preferred direction for the section's b axis. Caps both ends. Parallel transport keeps the frame from twisting.
  function sweep(M, path, section, o) {
    o = o || {}; const n = path.length, rings = [];
    let up = o.up || [0, 1, 0];
    for (let i = 0; i < n; i++) {
      const p = path[i], q = path[Math.min(n - 1, i + 1)], r = path[Math.max(0, i - 1)];
      const T = norm(sub3(q, r));
      let B = sub3(up, mul3(T, dot3(up, T))); if (len3(B) < 1e-6) B = Math.abs(T[0]) < 0.9 ? cross3(T, [1, 0, 0]) : cross3(T, [0, 0, 1]); B = norm(B);
      const N = cross3(B, T);
      if (!o.fixedUp) up = B;
      const sec = section(i / (n - 1), i);
      rings.push(sec.map(([a, b]) => add3(add3(p, mul3(N, a)), mul3(B, b))));
    }
    return loft(M, rings, { wrap: true, capA: o.caps !== false, capB: o.caps !== false, solid: true, segments: o.segments });
  }
  // a round / elliptical tube between points (section radius a × b, N points); `taper` (t) -> scale
  function tube(M, path, a, b, N, o) {
    const sec = superellipse(a, b == null ? a : b, (o && o.n) || 2, N || 12);
    return sweep(M, path, (t) => { const k = o && o.taper ? o.taper(t) : 1; return sec.map(([x, y]) => [x * k, y * k]); }, o);
  }

  // ---------------------------------------------------------------- lathe
  // profile: [[r, a]] (radius, axial position) open polyline; centre, axis (unit), ref (unit, ⟂ axis); segs around; o.segments etc.
  function lathe(M, profile, centre, axis, ref, segs, o) {
    o = o || {}; const side = cross3(axis, ref), rings = [];
    for (let k = 0; k <= segs; k++) {
      const t = (o.a0 || 0) + ((o.a1 == null ? 2 * Math.PI : o.a1) - (o.a0 || 0)) * k / segs, c = Math.cos(t), s = Math.sin(t);
      const dir = add3(mul3(ref, c), mul3(side, s));
      rings.push(profile.map(([r, a]) => add3(add3(centre, mul3(axis, a)), mul3(dir, r))));
    }
    // rings run around the axis; loft across them (profile direction = ring index), no wrap (the seam is duplicated)
    return loft(M, rings, { inside: o.inside || centre, flip: o.flip, uv: o.uv ? (r, i) => o.uv(r / segs, i) : null });
  }

  // ---------------------------------------------------------------- airfoils
  // cambered section, unit chord, x rearward, z up; camber bows DOWN (a downforce profile). Returns one closed ring
  // [upper TE ... LE ... lower TE] (2N+1 points; cosine spacing) plus the TE index range for a crisp trailing-edge face.
  // m: camber (fraction of chord), p: max-camber position, t: thickness, te: trailing-edge thickness (fraction of chord)
  function foil(m, p, t, N, te) {
    te = te == null ? 0.004 : te; const up = [], lo = [];
    for (let i = 0; i <= N; i++) {
      const u = 0.5 - 0.5 * Math.cos(Math.PI * i / N);
      const yc = -(u < p ? m / (p * p) * (2 * p * u - u * u) : m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * u - u * u));
      const dyc = -(u < p ? 2 * m / (p * p) * (p - u) : 2 * m / ((1 - p) * (1 - p)) * (p - u)), th = Math.atan(dyc);
      const yt = 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u) + 0.5 * te * u;
      up.push([u - yt * Math.sin(th), yc + yt * Math.cos(th)]); lo.push([u + yt * Math.sin(th), yc - yt * Math.cos(th)]);
    }
    const ring = up.reverse().concat(lo.slice(1));   // upper TE -> LE -> lower TE
    return { ring, n: ring.length, le: N };
  }
  // place a unit foil ring: LE at le [x, z], chord c, angle a (rad, TE up), optional extra rotation d about pivot
  function placeFoil(ring, le, c, a, d, piv) {
    const ca = Math.cos(a), sa = Math.sin(a), out = [];
    // TE up for positive a with x rearward: z = le.z + u·sin(a)
    for (const [u, v] of ring) {
      let x = le[0] + c * (u * ca - v * sa), z = le[1] + c * (u * sa + v * ca);
      if (d) { const cd = Math.cos(d), sd = Math.sin(d), dx = x - piv[0], dz = z - piv[1]; x = piv[0] + dx * cd - dz * sd; z = piv[1] + dx * sd + dz * cd; }
      out.push([x, z]);
    }
    return out;
  }

  // ---------------------------------------------------------------- interpolation
  // monotone cubic (Fritsch-Carlson) through (xs ascending, ys); clamped (flat) outside
  function monoCubic(xs, ys, extrapolate) {
    const n = xs.length, d = [], m = new Array(n);
    if (n === 1) return { f: () => ys[0], df: () => 0 };
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    const f = (x) => {
      if (x <= xs[0]) return extrapolate ? ys[0] + (x - xs[0]) * extrapolate : ys[0];
      if (x >= xs[n - 1]) return extrapolate ? ys[n - 1] + (x - xs[n - 1]) * extrapolate : ys[n - 1];
      let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
    const df = (x) => (f(x + 1e-3) - f(x - 1e-3)) / 2e-3;
    return { f, df };
  }
  // a station table { x: [...], key: [...] } -> (x) -> { key: value } by monotone cubics (x must ascend)
  function table(xs, cols) {
    const fns = {}; for (const k of Object.keys(cols)) fns[k] = monoCubic(xs, cols[k]).f;
    return (x) => { const o = {}; for (const k of Object.keys(fns)) o[k] = fns[k](x); return o; };
  }
  // Catmull-Rom through points (open), `per` samples per span
  function catmull(pts, per) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < per; k++) { const t = k / per, t2 = t * t, t3 = t2 * t; out.push(p1.map((_, a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3))); }
    }
    out.push(pts[pts.length - 1].slice()); return out;
  }

  const api = { mesh, loft, solidLoft, cap, earclip, newell, slab, frameXY, sweep, tube, lathe, foil, placeFoil, superellipse, area2, roundPoly, resampleClosed, resampleOpen, offsetPoly, monoCubic, table, catmull,
    v3: { sub3, add3, mul3, dot3, cross3, len3, norm, lerp3 }, lerp, clamp, sstep, ss, rad };
  C.mesh3d = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
