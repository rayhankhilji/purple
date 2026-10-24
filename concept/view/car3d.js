// PURPLE CONCEPT - concept car view v3: the concept car's geometry, built to the design's dimensions (pure: no three.js, no DOM).
// Every part is generated from the design parameters (concept/parts.js) and fixed 2026 dimensions (DIM, each with its source):
// true sizes and positions in the FIA car frame (mm: X rearward from the front axle plane XF=0, Y lateral, Z up from the
// reference plane Z=0 = the plank's upper surface), true wing angles (no display scale), the design's ride height. Output is in
// the game-car frame of js/carglb.js (metres, +x forward, +y up, +z right, ground y=0, front axle x=+1.75).
//   const car3d = EI.concept.car3d;  const S = car3d.spec(params);  const G = car3d.buildGroup("front_wing", S, { flap: 0 })
//   G = { id, key, items: [{ name, part, mat, role?, proj?, geo: { pos, nrm, uv, idx, count }, flap? }] }
//   car3d.buildAll(S) -> { [group]: G };  car3d.GROUPS;  car3d.groupKey(group, S);  car3d.DIM (fixed dimensions + sources)
// Concept geometry built to the design's dimensions in the FIA 2026 frame; not a team CAD model (shapes between the dimensioned
// features are drawn, not measured). docs/concept/VIEW.md lists every dimension and its definition.
// Dual browser / Node: window.EI.concept.car3d and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const m3 = req("mesh3d", "./mesh3d.js");
  let parts = req("parts", "../parts.js"), regs = req("regs", "../regs.js");
  const { lerp, clamp, sstep, ss, rad } = m3, V3 = m3.v3;

  // ---------------------------------------------------------------- fixed dimensions (mm) and their sources
  const DIM = {
    // 2026 Pirelli: 18-inch rims; front 280 mm wide, 705 mm tall; rear 375 mm wide, 710 mm tall (Mercedes-AMG F1 tyre guides 2026;
    // FIA scrutineer K. Degroot: front -25 mm width / -15 mm diameter, rear -30 / -10). "Width" is drawn as the tread width; the
    // sidewall runs out to the rim (C10.7.2: lip external diameter 496, overall rim width 334 front / 420.3 rear).
    tyre: { front: { od: 705, tread: 280, rimOverall: 334 }, rear: { od: 710, tread: 375, rimOverall: 420.3 }, lipDia: 496, rimDia: 463, deflection: 8 },
    // track (wheel centre |Y|): concept/parts.js mass sheet (wheels_front y 790, wheels_rear y 760) = concept/physical.js REF_V0
    // track_front_m 1.58 / track_rear_m 1.52
    track: { front: 1580, rear: 1520 },
    // C11.3.3: disc diameters 325-345 front, 260-280 rear (drawn mid-range); 32 mm thick (estimate)
    disc: { front: 335, rear: 270, thick: 32 },
    // C3.6.1: plank assembly 10 mm thick, upper surface at Z=0; holes Ø34 at XF=500, XC-700, XPU+550 (within the C3.6.1(c)
    // ranges); plank width 300 mm (estimate: RV-PLANK is a drawing)
    plank: { thick: 10, halfW: 150, hole: 34 },
    // App. C2 §22 RV-FW-PROFILES: X from -1250 (front plane through [-1250, 100] and [-1025, 700]) to the rear plane through
    // [-750, 0] and [-500, 400] (≤ -475); Z 60 (|Y| ≤ 100) rising to 115 at |Y| = 675. §23 RV-FWEP-BODY (endplate): X -1250..-300,
    // Z 75..375, top plane through [-750, 375] and [-1050, 250], cut by the Ø925 cylinder about [XF 0, Z 360] (the tyre).
    fw: { xFront: -1250, zBot0: 60, zBotTip: 115, epZ0: 75, epZ1: 375, arcR: 462.5, arcZ: 360, ofpY: 900 },
    // App. C2 §30 RV-RW-PROFILES: XR+165..XR+630, Z 725..880 (bottom plane rising to 785 at |Y| = 575 from |Y| = 150);
    // §31 RV-RWEP-BODY: endplate XR+150..XR+750, upper part at |Y| 535-575, sweeping in to |Y| 345-375 at Z 425..250;
    // §32 RV-RW-PYLON: Y 50..110, from [XR, Z 300-450] to [XR+200..450, Z 825]
    rw: { x0: 165, zMin: 725, zMinTip: 785, zMax: 880, epX0: 150, epX1: 750, epLowY: 360, epLowZ: 250, pylonY: 80 },
    // App. C2 §4 RV-FLOOR-BODY: plan reaches Y 770 at XF 1100, 700 at XR-335, then 400 / 365 to XR+300; the diffuser cut-out
    // (§4.20) runs from XR-525; §4.1 central body from XF 350 (Y 25) widening to Y 340 at XF 1250
    floor: { xBib: 350, xMax: 1100, taperY: 70, xStep: -335, yStep: 400, xDiffW: -150, yDiff: 365, xExit: 300, xKink: -525, xLead: 720 },
    // nose tip (concept: 35 mm behind the FW profiles' front plane, on the main plane)
    noseTip: -1215,
    // halo, cockpit, helmet (concept placement from the game car's cockpit, relative to XC; RV-HALO is a drawing)
    halo: { tube: 46 },
  };
  const ROUND = (v) => Math.round(v * 1000) / 1000;

  // ---------------------------------------------------------------- the spec: every dimension the geometry uses (mm)
  function spec(params, opts) {
    if (!parts && opts && opts.parts) parts = opts.parts;
    const g = parts.geometry(params), p = params;
    const fw = p.front_wing, rw = p.rear_wing, fl = p.floor, sp = p.sidepods;
    const XA = g.XA, XC = g.XC, XPU = g.XPU, XR = g.XR, rh = fl.ride_height_mm;
    const S = {
      XA, XC, XPU, XR, rh, wb: XR,
      fw: { span: fw.span_mm, chord: fw.chord_mm, n: Math.max(1, Math.round(fw.elements)), aoa: fw.aoa_deg, sm: fw.sm_delta_deg || 0 },
      rw: { span: rw.span_mm, chord: rw.chord_mm, n: Math.max(1, Math.round(rw.elements)), aoa: rw.aoa_deg, sm: rw.sm_delta_deg || 0, E: rw.endplate_top_mm },
      floor: { W: fl.width_mm, throat: fl.throat_mm, deg: p.diffuser.expansion_deg },
      sp: { inlet: sp.inlet_cm2, u: sp.undercut_mm },
      ballast: { x: p.ballast.x_frac * XR, kg: p.ballast.extra_kg },
      materials: {},
    };
    for (const id of Object.keys(p)) if (p[id] && typeof p[id].material === "string") S.materials[id] = p[id].material;
    // wheels: centre height above the ground = tyre radius - static deflection
    const T = DIM.tyre;
    S.wheel = {
      front: { X: 0, Y: DIM.track.front / 2, od: T.front.od, tread: T.front.tread, rimW: T.front.rimOverall, hc: T.front.od / 2 - T.deflection, disc: DIM.disc.front },
      rear: { X: XR, Y: DIM.track.rear / 2, od: T.rear.od, tread: T.rear.tread, rimW: T.rear.rimOverall, hc: T.rear.od / 2 - T.deflection, disc: DIM.disc.rear },
    };
    // floor: planform (half width at X), venturi roof (Z of the tunnel roof at X), diffuser
    const F = DIM.floor, W2 = S.floor.W / 2;
    S.fl = {
      W2, xBib: F.xBib, xLead: F.xLead, xMax: F.xMax, xStep: XR + F.xStep, xDiffW: XR + F.xDiffW, xExit: XR + F.xExit, xKink: XR + F.xKink,
      yStep: Math.min(F.yStep, W2 - F.taperY - 10), yDiff: Math.min(F.yDiff, W2 - F.taperY - 30),
      // the throat: the tunnel roof is at `throat` from xThroat to the diffuser kink; inlet mouth 150 mm higher at the leading edge
      xThroat: Math.min(XR - 1400, Math.max(1500, XC)), inletRise: 150,
    };
    S.fl.halfW = (X) => floorHalfW(S, X);
    S.fl.roof = (X) => floorRoof(S, X);
    // sidepods: inlet (both sides = inlet_cm2) as a superellipse (n = 4) of aspect h/w = 0.55; per-side area in mm²
    const A = S.sp.inlet * 100 / 2, aspect = 0.55, k4 = superArea(4);   // area = k4 · w · h
    const wI = Math.sqrt(A / (k4 * aspect)), hI = wI * aspect;
    S.pod = { A, w: wI, h: hI, n: 4, X: XC - 600, Zc: 515, Yin: 0 };
    S.pod.Yin = bodyAt(S, S.pod.X).yw + 6;                   // inlet inner edge just outboard of the chassis side
    S.pod.Yc = S.pod.Yin + wI / 2; S.pod.Yout = S.pod.Yin + wI + 30;   // shoulder = inlet outer edge + 30 mm lip
    S.pod.Ztop = S.pod.Zc + hI / 2 + 34; S.pod.Zsh = S.pod.Zc - hI / 2 - 18; S.pod.Zf = 72;
    return S;
  }
  // area of the superellipse |x/(w/2)|^n + |y/(h/2)|^n ≤ 1 as a multiple of w·h: Γ(1+1/n)² / Γ(1+2/n)
  function superArea(n) { const G = (x) => { // Lanczos
      const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
      if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * G(1 - x)); x -= 1; let a = c[0]; const t = x + g + 0.5; for (let i = 1; i < 9; i++) a += c[i] / (x + i); return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a; };
    return G(1 + 1 / n) * G(1 + 1 / n) / G(1 + 2 / n); }

  // FIA (mm) -> world (m): sprung parts ride on the plank (Z=0 is 10 mm + ride height above the ground); ground parts use h
  const W = (S, X, Y, Z) => [(1750 - X) / 1000, (Z + 10 + S.rh) / 1000, Y / 1000];
  const Gd = (X, Y, h) => [(1750 - X) / 1000, h / 1000, Y / 1000];

  // ---------------------------------------------------------------- floor planform and venturi roof
  function floorHalfW(S, X) {
    const F = S.fl;
    if (X < F.xLead) return 0;
    if (X <= F.xMax) { const t = (X - F.xLead) / (F.xMax - F.xLead); return lerp(330, F.W2, 1 - Math.pow(1 - t, 2.2)); }   // the floor's leading edge sweeps out to full width at XF 1100
    if (X <= F.xStep - 60) return F.W2 - DIM.floor.taperY * (X - F.xMax) / Math.max(1, F.xStep - F.xMax);
    if (X <= F.xStep) { const a = F.W2 - DIM.floor.taperY * (F.xStep - 60 - F.xMax) / Math.max(1, F.xStep - F.xMax); return lerp(a, F.yStep, sstep((X - (F.xStep - 60)) / 60)); }   // the step in ahead of the rear tyre (R60)
    if (X <= F.xDiffW) return lerp(F.yStep, F.yDiff, (X - F.xStep) / (F.xDiffW - F.xStep));
    return F.yDiff;
  }
  function floorRoof(S, X) {
    const F = S.fl, th = S.floor.throat;
    if (X <= F.xThroat) return th + F.inletRise * Math.pow(1 - sstep((X - F.xLead) / (F.xThroat - F.xLead)), 1.2);
    if (X <= F.xKink) return th;
    return th + (X - F.xKink) * Math.tan(rad(S.floor.deg));   // the diffuser ramp at the expansion angle
  }

  // ---------------------------------------------------------------- body sections (chassis + nose + engine cover + tail)
  // section parameters at X, by monotone cubics through stations that move with the design's anchors (XA, XC, XPU, XR)
  function bodyStations(S) {
    const { XA, XC, XPU, XR } = S, NT = DIM.noseTip;
    // [X, zb, zt, yw, zw, ys]  (bottom, top, max half width, its height, spine half width)
    const rows = [
      [NT, 128, 212, 62, 166, 34], [NT + 60, 122, 236, 78, 172, 48], [XA - 700, 132, 336, 112, 214, 74], [XA - 320, 150, 452, 148, 286, 104],
      [XA, 172, 548, 178, 344, 132], [XA + 420, 150, 628, 236, 404, 182], [XC - 900, 104, 664, 296, 446, 286], [XC - 520, 62, 684, 360, 458, 300],
      [XC - 150, 44, 694, 392, 456, 304], [XC + 60, 40, 792, 336, 446, 152], [XC + 260, 42, 802, 312, 426, 124], [XPU, 44, 762, 286, 392, 112],
      [XPU + 420, 46, 652, 226, 346, 98], [XR - 520, 52, 528, 192, 306, 84], [XR - 160, 120, 474, 162, 302, 72], [XR + 160, 214, 436, 122, 318, 62],
      [XR + 440, 254, 404, 84, 330, 52],
    ];
    for (let i = 1; i < rows.length; i++) if (rows[i][0] < rows[i - 1][0] + 25) rows[i][0] = rows[i - 1][0] + 25;
    const xs = rows.map(r => r[0]), col = (k) => rows.map(r => r[k]);
    return { xs, f: m3.table(xs, { zb: col(1), zt: col(2), yw: col(3), zw: col(4), ys: col(5) }), x0: xs[0], x1: xs[xs.length - 1] };
  }
  function bodyAt(S, X) { if (!S._bs) S._bs = bodyStations(S); return S._bs.f(clamp(X, S._bs.x0, S._bs.x1)); }
  // cockpit opening: half width cw (plan: a rounded front, straight sides, a short rear radius) and depth below the rim
  function cockpitAt(S, X) {
    const x0 = S.XC - 905, x1 = S.XC - 30, cwMax = 252;
    if (X <= x0 || X >= x1) return { cw: 0, d: 0 };
    const a = X - x0, b = x1 - X;
    const cw = cwMax * Math.sqrt(clamp(a / 230, 0, 1) * (2 - clamp(a / 230, 0, 1))) * Math.sqrt(clamp(b / 70, 0, 1) * (2 - clamp(b / 70, 0, 1)));
    const d = 400 * Math.pow(cw / cwMax, 0.45) * (0.55 + 0.45 * ss(0, 420, a));
    return { cw, d };
  }
  const NL = 12, NU = 12, NT_ = 6, NI = 7;   // body ring: lower quarter, upper quarter, top run, inner (cockpit) points per half
  // right half of a body section from the bottom centre up to the rim / top centre, then the cockpit inner wall to the centre
  function bodyHalf(S, X, scale, zc) {
    const s = bodyAt(S, X), ck = cockpitAt(S, X), out = [], inner = [];
    const k = scale == null ? 1 : scale, zm = zc == null ? (s.zb + s.zt) / 2 : zc;
    const Z = (z) => zm + (z - zm) * k, Y = (y) => y * k;
    const nl = lerp(2.0, 2.8, ss(S.XA, S.XC - 400, X)), nu = 2.3;   // a rounder keel under the nose and the front chassis
    for (let i = 0; i < NL; i++) { const ph = -Math.PI / 2 + (Math.PI / 2) * i / NL, c = Math.cos(ph), sn = Math.sin(ph); out.push([Y(s.yw * Math.pow(Math.abs(c), 2 / nl)), Z(s.zw + (s.zw - s.zb) * -Math.pow(Math.abs(sn), 2 / nl))]); }
    for (let i = 0; i < NU; i++) { const ph = (Math.PI / 2) * i / NU, c = Math.cos(ph), sn = Math.sin(ph); out.push([Y(s.ys + (s.yw - s.ys) * Math.pow(c, 2 / nu)), Z(s.zw + (s.zt - s.zw) * Math.pow(sn, 2 / nu))]); }
    // the top run from the spine edge to the rim (or the centre), with a slight crown
    const rimY = ck.cw > 0.5 ? ck.cw + 16 : 0;
    for (let i = 0; i <= NT_; i++) { const t = i / NT_, y = lerp(s.ys, rimY, t); out.push([Y(y), Z(s.zt + 6 * (1 - Math.pow(y / Math.max(1, s.ys), 2)) * (ck.cw > 0.5 ? 0.3 : 1))]); }
    // cockpit: rim roll, inner wall, floor to the centre (collapsed to the top centre outside the opening)
    const zt = s.zt, cw = ck.cw, d = ck.d, top = out[out.length - 1];
    const pts = cw > 0.5 ? [[cw + 6, zt - 4], [cw, zt - 16], [cw - 2, zt - 0.35 * d], [cw - 10, zt - 0.8 * d], [cw * 0.7, zt - d], [cw * 0.35, zt - d - 6], [0, zt - d - 8]] : null;
    for (let i = 0; i < NI; i++) inner.push(pts ? [Y(pts[i][0]), Z(pts[i][1])] : [top[0] * (1 - (i + 1) / NI), top[1]]);
    return { out, inner };
  }
  // full ring (world) and the index ranges of its outer / inner segments
  function bodyRing(S, X, scale, zc) {
    const { out, inner } = bodyHalf(S, X, scale, zc), ring = [];
    for (const [y, z] of out) ring.push(W(S, X, y, z));
    for (const [y, z] of inner) ring.push(W(S, X, y, z));
    for (let i = inner.length - 2; i >= 0; i--) ring.push(W(S, X, -inner[i][0], inner[i][1]));
    for (let i = out.length - 1; i >= 1; i--) ring.push(W(S, X, -out[i][0], out[i][1]));
    const h = out.length - 1, n = ring.length;
    return { ring, seg: { outerR: [0, h], inner: [h, h + 2 * NI - 1], outerL: [h + 2 * NI - 1, n] } };
  }

  // ---------------------------------------------------------------- items
  function item(name, part, mat, M, extra) { return Object.assign({ name, part, mat, geo: M.finish() }, extra || {}); }
  // mirror a finished geometry across Y=0 (world z), reversing the winding
  function mirrorGeo(g) {
    const pos = g.pos.slice(), nrm = g.nrm.slice(), idx = g.idx.slice();
    for (let i = 2; i < pos.length; i += 3) { pos[i] = -pos[i]; nrm[i] = -nrm[i]; }
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    return { pos, nrm, uv: g.uv.slice(), idx, count: g.count };
  }
  // the item and its mirror image (name + "_L" / "_R")
  function pair(it) { const L = Object.assign({}, it, { name: it.name + "_L", geo: mirrorGeo(it.geo) }); it.name += "_R"; return [it, L]; }
  // merge finished geometries
  function mergeGeo(gs) {
    let n = 0, ni = 0; for (const g of gs) { n += g.count; ni += g.idx.length; }
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0, oi = 0; for (const g of gs) { pos.set(g.pos, o * 3); nrm.set(g.nrm, o * 3); uv.set(g.uv, o * 2); for (let i = 0; i < g.idx.length; i++) idx[oi + i] = g.idx[i] + o; o += g.count; oi += g.idx.length; }
    return { pos, nrm, uv, idx, count: n };
  }
  const withMirror = (it) => { const L = mirrorGeo(it.geo); it.geo = mergeGeo([it.geo, L]); return it; };

  // ---------------------------------------------------------------- BODY: survival cell + nose, engine cover, airbox, tail
  function buildBody(S) {
    const items = [], bs = bodyStations(S); S._bs = bs;
    const NT = DIM.noseTip, xEnd = bs.x1;
    // stations: dense at the nose tip and around the cockpit opening
    const xs = [];
    const tipR = 70; for (let k = 0; k <= 10; k++) xs.push(NT + tipR * (1 - Math.cos(Math.PI / 2 * k / 10)));
    for (let x = NT + tipR + 30; x < xEnd - 40; x += 28) xs.push(x);
    const ck0 = S.XC - 905, ck1 = S.XC - 30; for (const x of [ck0 + 0.8, ck1 - 0.8, ck0 + 4, ck0 + 15, ck0 + 35, ck0 + 70, ck0 + 120, ck1 - 60, ck1 - 30, ck1 - 12, ck1 - 3]) xs.push(x);
    for (const x of [S.XA, S.XC, S.XPU, S.XR]) xs.push(x);   // rings exactly at the design's anchors (the section there is the station's)
    for (let k = 0; k <= 6; k++) xs.push(xEnd - 40 + 40 * k / 6);
    xs.sort((a, b) => a - b);
    const anchors = new Set([S.XA, S.XC, S.XPU, S.XR]), X = [];
    for (const x of xs) { if (X.length && x - X[X.length - 1] <= 1.5) { if (anchors.has(x)) X[X.length - 1] = x; continue; } X.push(x); }
    const rings = [], cockpitRings = [];
    let seg = null;
    for (const x of X) {
      let k = 1, zc = null;
      if (x < NT + tipR) { const t = (x - NT) / tipR; k = Math.max(0.04, Math.sqrt(1 - Math.pow(1 - t, 2))); const s0 = bodyAt(S, NT + tipR); zc = (s0.zb + s0.zt) / 2 - 8; }
      const r = bodyRing(S, x, k, zc); rings.push(r.ring); seg = r.seg;
    }
    // paint (outer) and cockpit interior (inner) segments of the same loft; the tip and the tail capped
    const Mo = m3.mesh(); m3.loft(Mo, rings, { segments: [seg.outerR, seg.outerL], capA: true, capB: false, inside: centroidOf(rings) });
    const Mi = m3.mesh(); m3.loft(Mi, rings, { segments: [seg.inner], inside: [0, 2, 0] });
    // tail face (the rear impact structure's end): cap separately as carbon
    const Mt = m3.mesh(); m3.cap(Mt, rings[rings.length - 1], W(S, xEnd - 200, 0, 330));
    items.push(item("body", "survival_cell", "paint", Mo, { role: "body", proj: "main" }));
    items.push(item("cockpit_tub", "survival_cell", "interior", Mi));
    items.push(item("tail_face", "rear_impact", "carbon", Mt));
    return items;
  }
  function centroidOf(rings) { let x = 0, y = 0, z = 0, n = 0; for (const r of rings) for (const p of r) { x += p[0]; y += p[1]; z += p[2]; n++; } return [x / n, y / n, z / n]; }

  // ---------------------------------------------------------------- SIDEPODS: inlet from inlet_cm2, undercut, louvres
  // pod section stations (right side): top Z, outer half width (shoulder), shoulder Z, undercut share
  function podAt(S, X) {
    const P = S.pod, x0 = P.X;
    if (!S._pt) {
      const rows = [[x0 + 40, P.Ztop, P.Yout, P.Zsh, 1], [x0 + 420, P.Ztop - 6, P.Yout + 8, P.Zsh - 12, 1], [S.XPU - 60, Math.max(P.Zsh + 40, P.Ztop - 110), P.Yout - 34, Math.max(300, P.Zsh - 70), 0.92],
        [S.XPU + 420, Math.max(330, P.Ztop - 220), 0, 260, 0.7], [S.XR - 560, 270, 0, 205, 0.45], [S.XR - 270, 222, 0, 170, 0.2]];
      for (let i = 1; i < rows.length; i++) if (rows[i][0] < rows[i - 1][0] + 30) rows[i][0] = rows[i - 1][0] + 30;
      const xs = rows.map(r => r[0]);
      S._pt = { xs, f: m3.table(xs, { zt: rows.map(r => r[1]), zsh: rows.map(r => r[3]), uk: rows.map(r => r[4]) }), yo: m3.monoCubic(xs.slice(0, 3), rows.slice(0, 3).map(r => r[2])).f };
    }
    const t = S._pt.f(clamp(X, S._pt.xs[0], S._pt.xs[S._pt.xs.length - 1])), b = bodyAt(S, X);
    // the outer width holds to the ICE face, then blends to the body (+ 22 mm) at the gearbox (coke bottle)
    const y0 = S._pt.yo(Math.min(X, S.XPU - 60)), yo = X <= S.XPU - 60 ? y0 : lerp(y0, b.yw + 22, sstep((X - (S.XPU - 60)) / Math.max(60, S.XR - 270 - (S.XPU - 60))));
    const zf0 = Math.min(t.zt - 40, floorRoof(S, X) + 12), zsh0 = clamp(t.zsh, zf0 + 30, t.zt - 40);
    const zf = lerp(zsh0 - 30, zf0, ss(x0 + 40, x0 + 520, X));
    const yi = Math.max(60, b.yw - 45);
    const u = Math.min(S.sp.u * t.uk, Math.max(0, yo - yi - 40));
    return { zt: t.zt, yo, zsh: Math.max(zsh0, zf + 30), u, zf, yi };
  }
  const NB = 5, NUC = 14, NFL = 14, NTP = 10, NIN = 5;   // pod ring: bottom, undercut, flank + corner, top, inner side
  // the pod section (right side) as [Y, Z] points, counter-clockwise from the inner bottom corner
  function podSection(S, X) {
    const q = podAt(S, X), pts = [], yb = q.yo - q.u, rc = Math.min(80, (q.zt - q.zsh) * 0.6, (q.yo - q.yi) * 0.35);
    for (let i = 0; i < NB; i++) pts.push([lerp(q.yi, yb, i / NB), q.zf]);
    for (let i = 0; i < NUC; i++) { const s = i / NUC; pts.push([q.yo - q.u * (1 - Math.pow(Math.sin(s * Math.PI / 2), 1.35)), lerp(q.zf, q.zsh, s)]); }   // the undercut: in at the bottom, out to the shoulder
    for (let i = 0; i < NFL; i++) { const s = i / (NFL - 1);   // outer flank up to the top-outer corner (quarter superellipse)
      const zc = q.zt - rc, yc = q.yo - rc;
      if (s < 0.35) pts.push([q.yo, lerp(q.zsh, zc, s / 0.35)]);
      else { const ph = (s - 0.35) / 0.65 * Math.PI / 2; pts.push([yc + rc * Math.pow(Math.cos(ph), 0.8), zc + rc * Math.pow(Math.sin(ph), 0.8)]); } }
    for (let i = 1; i <= NTP; i++) { const s = i / NTP; pts.push([lerp(q.yo - rc, q.yi, s), q.zt + 4 * Math.sin(Math.PI * s)]); }
    for (let i = 1; i < NIN; i++) pts.push([q.yi, lerp(q.zt, q.zf, i / NIN)]);
    return { pts, q };
  }
  // the inlet mouth outline (superellipse n = 4, polygon area exactly A), centre (Yc, Zc), sampled toward the given directions
  function mouthAt(S, dirs, grow) {
    const P = S.pod, n = P.n, unit = m3.superellipse(0.5, 0.5 * P.h / P.w, n, 96);
    const k = Math.sqrt(P.A / m3.area2(unit));   // scale so the POLYGON area is the design's area
    const a = 0.5 * k + (grow || 0), b = 0.5 * k * P.h / P.w + (grow || 0);
    return dirs.map((th) => { const c = Math.cos(th), s = Math.sin(th), r = 1 / Math.pow(Math.pow(Math.abs(c) / a, n) + Math.pow(Math.abs(s) / b, n), 1 / n); return [P.Yc + r * c, P.Zc + r * s]; });
  }
  function mouthExact(S) { const P = S.pod, unit = m3.superellipse(0.5, 0.5 * P.h / P.w, P.n, 64), k = Math.sqrt(P.A / m3.area2(unit)); return unit.map(([y, z]) => [P.Yc + y * k, P.Zc + z * k]); }
  function buildSidepods(S) {
    const P = S.pod, items = [];
    S._pt = null;
    const x0 = P.X, xEnd = S.XR - 270;
    const sec0 = podSection(S, x0 + 60);
    const dirs = sec0.pts.map(([y, z]) => Math.atan2(z - P.Zc, y - P.Yc));
    // the lip: mouth (exact) -> rolled lip -> the full section
    const ringAt = (X, pts2) => pts2.map(([y, z]) => W(S, X, y, z));
    const mouth = mouthAt(S, dirs, 0);
    const blend = (A, B, t) => A.map((p, i) => [lerp(p[0], B[i][0], t), lerp(p[1], B[i][1], t)]);
    const rings = [ringAt(x0 + 24, mouth), ringAt(x0 + 6, mouthAt(S, dirs, 8)), ringAt(x0, mouthAt(S, dirs, 19)), ringAt(x0 + 9, blend(mouthAt(S, dirs, 27), podSection(S, x0 + 20).pts, 0.35)),
      ringAt(x0 + 30, blend(mouthAt(S, dirs, 30), podSection(S, x0 + 40).pts, 0.75))];
    for (let X = x0 + 60; X < xEnd; X += 30) rings.push(ringAt(X, podSection(S, X).pts));
    rings.push(ringAt(xEnd, podSection(S, xEnd).pts));
    const Mp = m3.mesh(); m3.loft(Mp, rings, { wrap: true, capB: true, solid: true });
    items.push(...pair(item("sidepod", "sidepods", "paint", Mp, { role: "body", proj: "main" })));
    // the inlet duct (dark): its first ring is the inlet opening (polygon area = the design's per-side area); radiator 226 mm in
    const ex = mouthExact(S), duct = [];
    for (const [X, k] of [[x0 + 24, 1], [x0 + 90, 0.97], [x0 + 170, 0.93], [x0 + 250, 0.9]]) duct.push(ex.map(([y, z]) => W(S, X, P.Yc + (y - P.Yc) * k, P.Zc + (z - P.Zc) * k)));
    const Md = m3.mesh(); m3.loft(Md, duct, { wrap: true, inside: W(S, x0 + 120, P.Yc, P.Zc), flip: true });
    items.push(...pair(item("pod_duct", "sidepods", "interior", Md, { meta: { inletRing: ex.length } })));
    const Mr = m3.mesh(); m3.cap(Mr, duct[duct.length - 1], W(S, x0 + 600, P.Yc, P.Zc));
    items.push(...pair(item("pod_radiator", "cooling", "radiator", Mr)));
    // cooling louvres on the pod top ahead of the rear tyre: 6 raised gills over dark slots
    const Ml = m3.mesh(), Mg = m3.mesh();
    for (let i = 0; i < 6; i++) {
      const X = S.XPU - 40 + i * 62; if (X > xEnd - 120) break;
      const q = podAt(S, X), y0 = q.yo - 175, y1 = q.yo - 60; if (y1 - y0 < 40) continue;
      const zs = q.zt + 1;
      const ring = (dx, dz) => [[y0, zs + dz], [y1, zs + dz], [y1, zs + dz + 3], [y0, zs + dz + 3]].map(([y, z]) => W(S, X + dx, y, z));
      m3.loft(Ml, [ring(-22, 0), ring(-10, 6), ring(4, 13), ring(14, 16)], { capA: true, capB: true, wrap: true, solid: true });
      const sl = (dx) => [[y0, zs - 2], [y1, zs - 2], [y1, zs + 1], [y0, zs + 1]].map(([y, z]) => W(S, X + dx, y, z));
      m3.loft(Mg, [sl(-20), sl(12)], { wrap: true, capA: true, capB: true, solid: true });
    }
    if (Ml.count) { items.push(...pair(item("pod_louvres", "sidepods", "paint", Ml, { role: "body", proj: "main" }))); items.push(...pair(item("pod_louvre_slots", "sidepods", "interior", Mg))); }
    return items;
  }

  // ---------------------------------------------------------------- FLOOR and DIFFUSER (one section function, two lofts)
  const FL_KEEL = 160;
  // half section at X (Y >= 0): the closed outline of the floor's solid cross-section, from the centre underside out and back
  function floorHalf(S, X) {
    const ye = Math.max(FL_KEEL + 70, floorHalfW(S, X)), roof = floorRoof(S, X), F = S.fl;
    const kick = X > F.xKink ? Math.min(160, (X - F.xKink) * Math.tan(rad(10))) : 0;   // the outer floor's kick-up ahead of the rear tyre
    const outer = X < F.xStep ? Math.min(110, ye - FL_KEEL - 60) : 14;              // outer floor width (behind the step: just the sidewall)
    const yt = ye - outer, ze = 8 + kick, rT = Math.max(roof + 10, 40);
    const yk = FL_KEEL, zTop = Math.max(rT, ze + 26);
    // the central keel (plank bed) lifts into the diffuser roof behind the kink: one open channel across the diffuser
    const kz = X <= F.xKink - 120 ? 0 : (roof - 14) * sstep((X - (F.xKink - 120)) / 320);
    return [
      [0, kz], [yk - 10, kz], [yk, kz + 6], [yk + 6, Math.max(kz + 7, roof - 10)], [yk + 18, roof], [lerp(yk, yt, 0.5), roof], [yt - 18, roof], [yt - 6, roof - 10],
      [yt, Math.max(ze + 6, 12)], [yt + 8, ze], [ye - 26, ze], [ye - 8, ze + 4], [ye, ze + 18], [ye - 2, ze + 34],
      [ye - 16, Math.max(ze + 36, 40)], [ye - 60, Math.max(ze + 30, Math.min(zTop, 44))], [yt, zTop], [yk, zTop + 2], [0, zTop + 3],
    ];
  }
  function floorRing(S, X) { const h = floorHalf(S, X), ring = h.map(([y, z]) => W(S, X, y, z)); for (let i = h.length - 2; i >= 1; i--) ring.push(W(S, X, -h[i][0], h[i][1])); return ring; }
  function floorStations(x0, x1, step) { const xs = []; for (let x = x0; x < x1 - step * 0.3; x += step) xs.push(x); xs.push(x1); return xs; }
  function buildFloor(S) {
    const F = S.fl, items = [];
    // floor body: from the leading edge to the diffuser kink
    const xs = floorStations(F.xLead, F.xKink, 40), rings = xs.map(x => floorRing(S, x));
    const Mf = m3.mesh(); m3.loft(Mf, rings, { wrap: true, capA: true, inside: W(S, 1800, 0, 30) });
    items.push(item("floor_body", "floor", "carbon", Mf, { carbon: "matte" }));
    // the bib (central floor under the nose, App. C2 §4.1) from XF 350 to the leading edge
    const bib = [];
    for (let x = F.xBib; x <= F.xLead + 20; x += 30) { const t = (x - F.xBib) / (F.xLead + 20 - F.xBib), hw = lerp(25, FL_KEEL + 40, Math.pow(t, 0.7)), zt = lerp(18, 60, t);
      bib.push(m3.roundPoly([[-hw, 0, 8], [hw, 0, 8], [hw, zt, 14], [-hw, zt, 14]], 3).map(([y, z]) => W(S, x, y, z))); }
    const Mb = m3.mesh(); m3.loft(Mb, bib, { wrap: true, capA: true, capB: true, solid: true });
    items.push(item("floor_bib", "floor", "carbon", Mb, { carbon: "matte" }));
    // venturi inlet fences: four per side, from near the ground up into the inlet roof, curving outward
    const Mfe = m3.mesh();
    for (const f of [0.16, 0.38, 0.6, 0.82]) {
      const rs = [];
      for (let k = 0; k <= 16; k++) {
        const x = lerp(F.xLead - 60, F.xLead + 820, k / 16), ye = Math.max(FL_KEEL + 70, floorHalfW(S, Math.max(x, F.xLead))), yt = ye - Math.min(110, ye - FL_KEEL - 60);
        const y = lerp(FL_KEEL + 12, yt - 12, f) + 40 * f * ss(F.xLead, F.xLead + 820, x), r = floorRoof(S, Math.max(x, F.xLead)), z0 = -4 + 22 * ss(F.xLead + 300, F.xLead + 820, x), th = 3.2 * (1 - 0.4 * ss(0.8, 1, k / 16));
        rs.push(m3.roundPoly([[y - th, z0, 2], [y + th, z0, 2], [y + th, r + 4, 0], [y - th, r + 4, 0]], 2).map(([yy, zz]) => W(S, x, yy, zz)));
      }
      m3.loft(Mfe, rs, { wrap: true, capA: true, capB: true, solid: true });
    }
    items.push(withMirror(item("floor_fences", "floor", "carbon", Mfe, { carbon: "matte" })));
    // wheel-wake control boards ahead of the sidepods (2026; RV-FLOOR-BOARD region XF 650-1350, |Y| ≤ 890): two thin cambered vanes
    // turning outward, rolled top edges, on a foot plate at the floor edge
    {
      const Mbd = m3.mesh(), yB = Math.min(850, S.fl.W2 + 30);
      for (const [xa, xb, h, dy] of [[700, 1180, 250, 0], [800, 1230, 175, -62]]) {
        const rs = [];
        for (let k = 0; k <= 14; k++) {
          const t = k / 14, x = lerp(xa, xb, t), y = yB + dy + 34 * t * t, top = 40 + h * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.15 + t))) * (1 - 0.25 * t), th = 3 + 2 * Math.sin(Math.PI * t);
          rs.push(m3.roundPoly([[y - th, 36, 2], [y + th, 36, 2], [y + th + 4, top - 6, 4], [y + 2, top, 5], [y - th, top - 3, 3]], 2).map(([yy, zz]) => W(S, x, yy, zz)));
        }
        m3.loft(Mbd, rs, { wrap: true, capA: true, capB: true, solid: true });
      }
      const foot = m3.roundPoly([[680, yB - 90, 20], [1260, yB - 90, 20], [1260, yB + 40, 30], [700, yB + 18, 30]], 4);
      m3.loft(Mbd, [foot.map(([x, y]) => W(S, x, y, 32)), foot.map(([x, y]) => W(S, x, y, 40))], { wrap: true, capA: true, capB: true, solid: true });
      items.push(withMirror(item("floor_boards", "floor", "carbon", Mbd)));
    }
    // floor-edge winglet ahead of the rear tyre (RV-FLOOR-WINGLET): a small cambered profile over the floor edge, on a stay
    {
      const Mw = m3.mesh(), fo = m3.foil(0.08, 0.4, 0.1, 16, 0.01), xw = F.xStep - 300, rs = [];
      const yA = floorHalfW(S, xw) - 120, yBb = floorHalfW(S, xw) - 6;
      for (let k = 0; k <= 8; k++) { const y = lerp(yA, yBb, k / 8); rs.push(m3.placeFoil(fo.ring, [xw, 118 + 14 * k / 8], 190, rad(-14), 0, null).map(([x, z]) => W(S, x, y, z))); }
      m3.loft(Mw, rs, { wrap: true, capA: true, capB: true, solid: true });
      const st = m3.mesh(), sx = xw + 60, sy = yBb - 6;
      m3.loft(st, [0, 1].map(k => m3.roundPoly([[sx - 40, 30, 4], [sx + 60, 30, 4], [sx + 40, 120, 4], [sx - 10, 120, 4]], 2).map(([x, z]) => W(S, x, sy + (k ? 4 : -4), z))), { wrap: true, capA: true, capB: true, solid: true });
      items.push(withMirror(item("floor_winglet", "floor", "carbon", Mw)));
      items.push(withMirror(item("floor_winglet_stay", "floor", "carbon", st)));
    }
    // plank (10 mm, Z -10..0) with its three Ø34 holes and titanium skids (C3.6.1)
    {
      const x0 = F.xBib + 40, x1 = Math.min(S.XR - 420, F.xKink + 80), rs = [];
      for (let k = 0; k <= 30; k++) { const x = lerp(x0, x1, k / 30), hw = DIM.plank.halfW * Math.min(1, 0.35 + 0.65 * ss(x0, x0 + 600, x)); rs.push(m3.roundPoly([[-hw, -10, 3], [hw, -10, 3], [hw, 0, 2], [-hw, 0, 2]], 2).map(([y, z]) => W(S, x, y, z))); }
      const Mpk = m3.mesh(); m3.loft(Mpk, rs, { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("plank", "floor", "plank", Mpk));
      const Mh = m3.mesh(), Ms = m3.mesh();
      for (const xh of [500, S.XC - 700, Math.min(S.XPU + 550, S.XR - 500)]) {
        if (xh < x0 + 30 || xh > x1 - 30) continue;
        const c = W(S, xh, 0, -10.6); m3.lathe(Mh, [[0, 0], [17, 0]].map(([r, a]) => [r / 1000, a]), c, [0, 1, 0], [1, 0, 0], 24, { inside: [c[0], c[1] + 1, c[2]] });
        const sk = m3.roundPoly([[-60, -45, 8], [60, -45, 8], [60, 45, 8], [-60, 45, 8]], 3);
        m3.loft(Ms, [sk.map(([a, b]) => W(S, xh + a, b, -10.3)), sk.map(([a, b]) => W(S, xh + a, b, -9))], { wrap: true, capA: true, capB: true, solid: true });
      }
      items.push(item("plank_skids", "floor", "metal", Ms, { look: "ti64" }));
      items.push(item("plank_holes", "floor", "black", Mh));
    }
    return items;
  }
  function buildDiffuser(S) {
    const F = S.fl, items = [];
    const xs = floorStations(F.xKink, F.xExit, 30), rings = xs.map(x => floorRing(S, x));
    const Md = m3.mesh(); m3.loft(Md, rings, { wrap: true, capB: true, inside: W(S, S.XR, 0, 400) });
    items.push(item("diffuser_body", "diffuser", "carbon", Md, { carbon: "matte" }));
    // strakes: vertical fins in the tunnels, from near the ground up into the ramp
    const Mst = m3.mesh();
    for (const f of [0.22, 0.55, 0.85]) {
      const rs = [];
      for (let k = 0; k <= 14; k++) {
        const x = lerp(F.xKink - 160, F.xExit - 4, k / 14), ye = floorHalfW(S, x), yt = ye - (x < F.xStep ? Math.min(110, ye - FL_KEEL - 60) : 14);
        const y = lerp(FL_KEEL + 10, yt - 10, f) + 18 * f * k / 14, r = floorRoof(S, x), z0 = 6 + 26 * ss(0.55, 1, k / 14);
        rs.push(m3.roundPoly([[y - 3.5, z0, 2], [y + 3.5, z0, 2], [y + 3.5, r + 3, 0], [y - 3.5, r + 3, 0]], 2).map(([yy, zz]) => W(S, x, yy, zz)));
      }
      m3.loft(Mst, rs, { wrap: true, capA: true, capB: true, solid: true });
    }
    items.push(withMirror(item("diffuser_strakes", "diffuser", "carbon", Mst, { carbon: "matte" })));
    // exit gurney along the ramp's trailing edge
    const Mg = m3.mesh(), xe = F.xExit, re = floorRoof(S, xe), ye = floorHalfW(S, xe);
    const rs = []; for (let k = 0; k <= 20; k++) { const y = lerp(-ye + 4, ye - 4, k / 20); rs.push([[xe - 26, re + 4], [xe - 2, re + 4], [xe + 2, re - 14], [xe - 6, re - 16]].map(([x, z]) => W(S, x, y, z))); }
    m3.loft(Mg, rs, { wrap: true, capA: true, capB: true, solid: true });
    items.push(item("diffuser_gurney", "diffuser", "carbon", Mg));
    return items;
  }

  // ---------------------------------------------------------------- WINGS: element chains at the true angles
  // The concept wing model (concept/regs.js fwStraightExtent): the main plane carries 1/n of the chord's X extent, the flap volumes
  // (n-1)/n, all flaps at a geometric angle equal to the wing setting; straight mode rotates the flap group rigidly by -delta about
  // the first flap's leading edge (front) or the last flap's trailing edge (rear). Main plane angle = setting / 5 (n >= 2) or / 2
  // (one element). Slot gaps 1.2 % chord + 4 mm, overlaps 9 % of the upstream element. The X extent of the chain is exactly the
  // local chord (front: c(y) = chord · envelope(y) / mean envelope; rear: the chord at every station).
  const FOIL = { main: m3.foil(0.06, 0.42, 0.105, 28, 0.006), flap: m3.foil(0.075, 0.4, 0.08, 24, 0.009) };
  function chainSection(c, n, aoa) {
    const th = rad(aoa), am = rad(n >= 2 ? aoa / 5 : aoa / 2), els = [];
    if (n <= 1) return [{ le: [0, 0], c: c / Math.cos(am), a: am, foil: FOIL.main }];
    const ov = 0.09 * c / n, g = 0.012 * c + 4, cmx = c / n + ov, Lm = cmx / Math.cos(am);
    els.push({ le: [0, 0], c: Lm, a: am, foil: FOIL.main });
    const teM = [cmx, cmx * Math.tan(am)];
    const P = [teM[0] - ov, teM[1] - ov * Math.tan(am) + 0.5 * 0.105 * Lm * 0.35 + g];
    const nf = n - 1, Fx = c - P[0], dir = [Math.cos(th), Math.sin(th)], perp = [-Math.sin(th), Math.cos(th)];
    const ovf = 0.09 * Fx / nf / Math.cos(th), gf = g * 0.8;
    const L = (Fx + (nf - 1) * gf * Math.sin(th)) / Math.cos(th) + (nf - 1) * ovf, l = L / nf;
    let le = P.slice();
    for (let i = 0; i < nf; i++) { els.push({ le: le.slice(), c: l, a: th, foil: FOIL.flap, flap: true }); const te = [le[0] + l * dir[0], le[1] + l * dir[1]]; le = [te[0] - ovf * dir[0] + gf * perp[0], te[1] - ovf * dir[1] + gf * perp[1]]; }
    return els;
  }
  // straight-mode rotation of a section point list (flaps only): about `piv` by -d
  const rot2 = (p, piv, d) => { const c = Math.cos(d), s = Math.sin(d), x = p[0] - piv[0], z = p[1] - piv[1]; return [piv[0] + x * c - z * s, piv[1] + x * s + z * c]; };
  // the 2D outline of every element at one station: [{ pts: [[X, Z]], le, flap }], after the straight-mode rotation d (rad)
  function sectionPolys(els, x0, z0, d, pivot) {
    return els.map((e) => {
      let pts = m3.placeFoil(e.foil.ring, [x0 + e.le[0], z0 + e.le[1]], e.c, e.a, 0, null);
      if (e.flap && d) pts = pts.map(p => rot2(p, pivot, -d));
      return { pts, flap: !!e.flap, n: e.foil.n, leI: e.foil.n >> 1 };
    });
  }
  const fwFront = (y) => (y <= 100 ? -1250 : -1250 + (225 / 600) * (y - 100));
  const fwZbot = (y) => DIM.fw.zBot0 + (DIM.fw.zBotTip - DIM.fw.zBot0) * clamp((y - 100) / 575, 0, 1);
  // front wing data at |y|: local chord, LE, element chain, base height; flap pivot (first flap LE)
  function fwStation(S, y) {
    const fw = S.fw, ay = Math.abs(y), k = fw.chord / regs.fwChordLimit(fw.span), c = k * regs.fwEnvelopeX(Math.min(ay, 675));
    const els = chainSection(c, fw.n, fw.aoa), x0 = fwFront(Math.min(ay, 675));
    // lowest point of the section 2 mm above the envelope floor
    let zmin = Infinity; for (const p of sectionPolys(els, 0, 0, 0)) for (const q of p.pts) zmin = Math.min(zmin, q[1]);
    const z0 = fwZbot(ay) + 2 - zmin;
    // straight-mode axis: on the flap group's chord line (through the last flap's TE at the setting angle), level with the first
    // flap's LE: within (n - 2) slot gaps (≤ 20 mm) of that LE (C3.10.10(d)(ii) allows 25 mm), and the rotation then lengthens the
    // X extent exactly as concept/regs.js fwStraightExtent models it
    let pivot = null;
    if (els.length > 1) {
      const f = els[1], l = els[els.length - 1], d = [Math.cos(l.a), Math.sin(l.a)], te = [l.le[0] + l.c * d[0], l.le[1] + l.c * d[1]];
      const D = (te[0] - f.le[0]) * d[0] + (te[1] - f.le[1]) * d[1];
      pivot = [x0 + te[0] - D * d[0], z0 + te[1] - D * d[1]];
    }
    return { y, c, els, x0, z0, pivot };
  }
  function rwStation(S, y) {
    const rw = S.rw, ay = Math.abs(y), els = chainSection(rw.chord, rw.n, rw.aoa), x0 = S.XR + DIM.rw.x0;
    let zmin = Infinity, zmax = -Infinity; for (const p of sectionPolys(els, 0, 0, 0)) for (const q of p.pts) { zmin = Math.min(zmin, q[1]); zmax = Math.max(zmax, q[1]); }
    const zb = DIM.rw.zMin + (DIM.rw.zMinTip - DIM.rw.zMin) * clamp((ay - 150) / 425, 0, 1) + 2;
    let z0 = zb - zmin; const top = Math.min(rw.E, DIM.rw.zMax) - 12; if (z0 + zmax > top) z0 = top - zmax;   // stays under the endplate top
    const last = els[els.length - 1], te = [x0 + last.le[0] + last.c * Math.cos(last.a), z0 + last.le[1] + last.c * Math.sin(last.a)];
    return { y, c: rw.chord, els, x0, z0, pivot: te };
  }
  // loft one element across stations; returns { top, bot, te } meshes (upper surface, lower surface + end caps, trailing-edge face)
  function elementMeshes(stations, ei, d, mapPt, outs) {
    const rings = [];
    for (const st of stations) { const sp = sectionPolys(st.els, st.x0, st.z0, d(st), st.pivot)[ei]; rings.push(sp.pts.map(([x, z]) => mapPt(x, st.y, z))); }
    const n = rings[0].length, le = n >> 1, mid = stations[Math.floor(stations.length / 2)];
    const inside = (() => { const sp = sectionPolys(mid.els, mid.x0, mid.z0, d(mid), mid.pivot)[ei]; let x = 0, z = 0; for (const p of sp.pts) { x += p[0]; z += p[1]; } return mapPt(x / sp.pts.length, mid.y, z / sp.pts.length); })();
    m3.loft(outs.top, rings, { segments: [[0, le]], inside });
    m3.loft(outs.bot, rings, { segments: [[le, n - 1]], inside });
    m3.loft(outs.te, rings, { segments: [[n - 1, n]], wrap: true, inside });
    m3.cap(outs.bot, rings[0], inside); m3.cap(outs.bot, rings[rings.length - 1], inside);
  }
  function spanStations(a, b, N, cluster) { const out = []; for (let j = 0; j <= N; j++) { const t = j / N, s = cluster ? 0.5 - 0.5 * Math.cos(Math.PI * t) : t; out.push(lerp(a, b, s)); } return out; }

  function buildFrontWing(S, o) {
    const fw = S.fw, h = fw.span / 2, items = [], flapT = (o && o.flap) || 0, smOn = fw.sm > 0 && fw.n >= 2;
    const ys = spanStations(-h, h, 64, true), st = ys.map(y => fwStation(S, y));
    const mapPt = (x, y, z) => W(S, x, y, z);
    const dCur = () => (smOn ? rad(fw.sm) * flapT : 0);
    for (let ei = o && o.flapOnly ? 1 : 0; ei < fw.n; ei++) {
      const outs = { top: m3.mesh(), bot: m3.mesh(), te: m3.mesh() };
      elementMeshes(st, ei, dCur, mapPt, outs);
      const flap = ei > 0;
      const fl = flap ? { wing: "front", pivot: "le" } : null;
      items.push(item("fw_el" + ei + "_top", "front_wing", "paint", outs.top, { role: flap ? "fwFlap" : "fwMain", proj: flap ? "none" : "fwTop", flap: fl }));
      items.push(item("fw_el" + ei + "_bot", "front_wing", "carbon", outs.bot, { flap: fl }));
      items.push(item("fw_el" + ei + "_te", "front_wing", "carbon", outs.te, { flap: fl }));
    }
    // straight-mode actuator: centre fairing on the flaps under the nose (RV-FW-SM-CL-FAIRING) + linkages (RV-FW-SM-LINKAGE)
    if (fw.n >= 2) {
      const s0 = fwStation(S, 0), fl = sectionPolys(s0.els, s0.x0, s0.z0, dCur(), s0.pivot)[1];
      let cx = 0, cz = -Infinity; for (const p of fl.pts) { cx += p[0] / fl.pts.length; cz = Math.max(cz, p[1]); }
      const Ma = m3.mesh(), rs = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12, x = lerp(cx - 120, cx + 110, t), r = 26 * Math.sin(Math.PI * Math.min(1, 0.08 + t)); rs.push(m3.superellipse(r * 0.9, r * 0.75, 2.4, 14).map(([a, b]) => W(S, x, a, cz + 8 + b))); }
      m3.loft(Ma, rs, { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("fw_actuator", "front_wing", "carbon", Ma, { flap: { wing: "front", pivot: "le", follow: true } }));
      const Ml = m3.mesh();
      for (const yl of [-170, 170]) { const s1 = fwStation(S, yl), f1 = sectionPolys(s1.els, s1.x0, s1.z0, dCur(), s1.pivot)[1]; let x = 0, z = -Infinity; for (const p of f1.pts) { x += p[0] / f1.pts.length; z = Math.max(z, p[1]); }
        m3.tube(Ml, [W(S, x, yl, z), W(S, x, yl, bodyAt(S, x).zb + 10)], 0.006, 0.006, 8); }
      items.push(item("fw_linkage", "front_wing", "metal", Ml, { look: "ti64", flap: { wing: "front", pivot: "le", follow: true } }));
    }
    if (o && o.flapOnly) return items;   // the straight-mode end state needs only the moving parts
    // endplates (RV-FWEP-BODY): front edge on the profiles' front plane, top rising to Z 375, rear edge on the tyre arc (Ø925 about
    // [XF 0, Z 360]); 10 mm plates at |Y| = span/2 + 6
    const tip = fwStation(S, h);
    let zTopEl = -Infinity, xTe = -Infinity; for (const sp of sectionPolys(tip.els, tip.x0, tip.z0, 0, tip.pivot)) for (const p of sp.pts) { zTopEl = Math.max(zTopEl, p[1]); xTe = Math.max(xTe, p[0]); }
    const Fd = DIM.fw, xf = fwFront(Math.min(h + 6, 675)) - 4, epTop = Math.max(Fd.epZ1, zTopEl + 24);
    const topZ = (x) => Math.min(epTop, Math.max(Fd.epZ1 - 125, Fd.epZ1 + (x + 750) * 125 / 300 + (epTop - Fd.epZ1)));
    const arcX = (z) => -Math.sqrt(Math.max(0, Fd.arcR * Fd.arcR - Math.pow(z - Fd.arcZ, 2))) - 8;
    const xr = (z) => Math.max(arcX(Math.min(z, Fd.arcZ)), xTe + 30);
    const outline = [];
    outline.push([xf, Fd.epZ0 + 6]); for (let k = 0; k <= 10; k++) { const x = lerp(xf, xr(epTop) - 30, k / 10); outline.push([x, Math.max(Fd.epZ0 + 40, topZ(x))]); }
    for (let k = 0; k <= 12; k++) { const z = lerp(epTop, Fd.epZ0, k / 12); outline.push([xr(z), z]); }
    const ol = m3.roundPoly(outline.map((p, i) => [p[0], p[1], i === 0 || i === outline.length - 1 ? 14 : 4]), 3).map(([x, z]) => [(1750 - x) / 1000, (z + 10 + S.rh) / 1000]);
    const Mep = m3.mesh(); m3.slab(Mep, ol, m3.frameXY((h + 6) / 1000), 0.010, 0.0045, 4);
    items.push(...pair(item("fw_endplate", "front_wing", "paint", Mep, { role: "fwEnd", proj: "fwEnd" })));
    // outer footplate (RV-FWEP-OFP: Z 75..170 to |Y| 900): a curved strip outboard of the plate, turned down at its edge
    {
      const Mf = m3.mesh(), rs = [], yo = Math.min(Fd.ofpY, h + 150);
      for (let k = 0; k <= 16; k++) { const x = lerp(xf + 40, xr(90) - 6, k / 16), w = (yo - h - 8) * (0.55 + 0.45 * Math.sin(Math.PI * k / 16));
        rs.push([[h + 8, 84], [h + 8 + w * 0.7, 88 + 6 * Math.sin(Math.PI * k / 16)], [h + 8 + w, 80], [h + 8 + w, 72], [h + 8 + w * 0.7, 80 + 6 * Math.sin(Math.PI * k / 16)], [h + 8, 77]].map(([y, z]) => W(S, x, y, z))); }
      m3.loft(Mf, rs, { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("fw_footplate", "front_wing", "carbon", Mf)));
    }
    // dive plane outboard of the endplate (RV-FWEP-DIVEPLANE: XF -950..-550, Z 175..340)
    {
      const Md = m3.mesh(), fo = m3.foil(0.05, 0.4, 0.09, 12, 0.02), rs = [];
      for (let k = 0; k <= 6; k++) { const y = h + 10 + 62 * k / 6, c = 260 * (1 - 0.35 * k / 6); rs.push(m3.placeFoil(fo.ring, [-920 + 0.5 * (260 - c), 262 + 8 * k / 6], c, rad(-8), 0, null).map(([x, z]) => W(S, x, y, z))); }
      m3.loft(Md, rs, { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("fw_diveplane", "front_wing", "carbon", Md)));
    }
    // tip vortex generators on the endplate's outer face (inside RV-FWEP-DIVEPLANE's cuboid): two small curved vanes
    {
      const Mv = m3.mesh(), fo = m3.foil(0.06, 0.4, 0.1, 10, 0.03);
      for (const [x0, z0, c] of [[-1010, 300, 120], [-870, 330, 100]]) { const rs = []; for (let k = 0; k <= 4; k++) { const y = h + 12 + 34 * k / 4, cc = c * (1 - 0.3 * k / 4); rs.push(m3.placeFoil(fo.ring, [x0 + 0.3 * (c - cc), z0 - 6 * k / 4], cc, rad(-16), 0, null).map(([x, z]) => W(S, x, y, Math.min(z, topZ(x) - 6)))); } m3.loft(Mv, rs, { wrap: true, capA: true, capB: true, solid: true }); }
      items.push(...pair(item("fw_vortex_gens", "front_wing", "carbon", Mv)));
    }
    // under-wing strakes (RV-FW-STRAKE: |Y| 450-555, Z 75-200)
    {
      const Ms = m3.mesh();
      for (const ys0 of [h - 90, h - 165]) {
        if (ys0 < 300) continue;
        const sst = fwStation(S, ys0), sp = sectionPolys(sst.els, sst.x0, sst.z0, 0, sst.pivot)[0], lowAt = (x) => { let best = Infinity; for (const p of sp.pts) if (Math.abs(p[0] - x) < 30) best = Math.min(best, p[1]); return isFinite(best) ? best : 120; };
        const rs = []; for (let k = 0; k <= 10; k++) { const x = lerp(sst.x0 + 40, sst.x0 + sst.c * 0.6, k / 10), zt = lowAt(x) + 3; rs.push([[ys0 - 3, 76], [ys0 + 3, 76], [ys0 + 3, zt], [ys0 - 3, zt]].map(([y, z]) => W(S, x, y + 14 * k / 10, z))); }
        m3.loft(Ms, rs, { wrap: true, capA: true, capB: true, solid: true });
      }
      if (Ms.count) items.push(...pair(item("fw_strakes", "front_wing", "carbon", Ms)));
    }
    // FW pylons: the nose to the main plane (RV-FW-PYLON), two blades at |Y| = 72
    {
      const Mp = m3.mesh(), y0 = 72, s0 = fwStation(S, y0), main = sectionPolys(s0.els, s0.x0, s0.z0, 0, s0.pivot)[0];
      let mx = -Infinity; for (const p of main.pts) mx = Math.max(mx, p[0]);
      const topAt = (x) => { let best = -Infinity; for (const p of main.pts) if (Math.abs(p[0] - x) < 25) best = Math.max(best, p[1]); return isFinite(best) ? best : s0.z0 + 20; };
      const xa = s0.x0 + 50, xb = Math.min(s0.x0 + 330, mx - 25), za = topAt(xa) - 2, zb = topAt(xb) - 2;
      const nb = (x) => bodyAt(S, x).zb + 14;
      const ol = m3.roundPoly([[xa, za, 6], [xb, zb, 6], [xb + 30, nb(xb + 30), 20], [xa + 10, nb(xa + 10), 20]], 3);
      m3.loft(Mp, [-1, 1].map(s => ol.map(([x, z]) => W(S, x, y0 + 5 * s, z))), { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("fw_pylon", "front_wing", "carbon", Mp)));
    }
    return items;
  }
  function buildRearWing(S, o) {
    const rw = S.rw, h = rw.span / 2, items = [], flapT = (o && o.flap) || 0, smOn = rw.sm > 0 && rw.n >= 2;
    const mapPt = (x, y, z) => W(S, x, y, z);
    const dCur = () => (smOn ? rad(rw.sm) * flapT : 0);
    // the flaps move only inboard of |Y| = 530 (C3.11.6: tips outboard of 535 stay): separate moving centre and fixed tips
    const movH = Math.min(h, 530), tips = h > 540;
    const ysFlapC = spanStations(-movH, movH, 44, true).map(y => rwStation(S, y));
    const ysTipR = tips ? spanStations(535, h, 4, false).map(y => rwStation(S, y)) : null;
    // the main plane shares the flaps' stations (centre + tips), so every station carries the whole chain
    const ysMain = tips ? ysTipR.map(s => rwStation(S, -s.y)).reverse().concat(ysFlapC, ysTipR) : ysFlapC;
    for (let ei = o && o.flapOnly ? 1 : 0; ei < rw.n; ei++) {
      const flap = ei > 0, fl = flap ? { wing: "rear", pivot: "te" } : null;
      const sets = flap ? [[ysFlapC, dCur, fl]].concat(tips && !(o && o.flapOnly) ? [[ysTipR, () => 0, null], [ysTipR.map(s => Object.assign({}, s, { y: -s.y })).reverse(), () => 0, null]] : []) : [[ysMain, () => 0, null]];
      sets.forEach(([stations, d, flg], si) => {
        const outs = { top: m3.mesh(), bot: m3.mesh(), te: m3.mesh() };
        elementMeshes(stations, ei, d, mapPt, outs);
        const nm = "rw_el" + ei + (si === 0 ? "" : si === 1 ? "_tipR" : "_tipL");
        items.push(item(nm + "_top", "rear_wing", "paint", outs.top, { role: flap ? "rwFlap" : "rwMain", proj: "top", flap: flg }));
        items.push(item(nm + "_bot", "rear_wing", "carbon", outs.bot, { flap: flg }));
        items.push(item(nm + "_te", "rear_wing", "carbon", outs.te, { flap: flg }));
      });
    }
    if (o && o.flapOnly) return items;
    // endplates (RV-RWEP-BODY): upper part at |Y| = span/2 + 8 up to the endplate-top parameter, swept in below Z 700 to |Y| 360
    // at Z 250; leading edge XR+160 above Z 700, raked back to XR+375 at Z 250; trailing edge XR+740 above Z 625, to XR+625 at Z 250
    {
      const E = rw.E, R = DIM.rw, t = 14, yTop = h + 8;
      const xf = (z) => S.XR + (z >= 700 ? 160 : 160 + (700 - z) * 215 / 450), xr = (z) => S.XR + (z >= 625 ? 740 : 625 + (z - 250) * 115 / 375);
      const yc = (z) => (z >= 690 ? yTop : z <= 420 ? Math.min(yTop, R.epLowY) : lerp(Math.min(yTop, R.epLowY), yTop, sstep((z - 420) / 270)));
      const rs = [], zs = []; for (let k = 0; k <= 34; k++) zs.push(lerp(R.epLowZ, E, k / 34));
      zs.push(E + 0.0001);
      for (const z of zs.slice(0, -1)) { const a = (xr(z) - xf(z)) / 2, cx = (xr(z) + xf(z)) / 2; rs.push(m3.superellipse(a, t / 2, 5, 28).map(([u, v]) => W(S, cx + u, yc(z) + v, z))); }
      // a rounded top edge: two shrinking rings
      for (const [dz, k] of [[4, 0.7], [7, 0.3]]) { const z = E - 7 + dz, a = (xr(E) - xf(E)) / 2 - 3 * (1 - k), cx = (xr(E) + xf(E)) / 2; rs.push(m3.superellipse(a, t / 2 * k, 5, 28).map(([u, v]) => W(S, cx + u, yTop + v, z))); }
      rs[rs.length - 3] = rs[rs.length - 3].map((p) => [p[0], (E - 7 + 10 + S.rh) / 1000, p[2]]);
      const Me = m3.mesh(); m3.loft(Me, rs, { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("rw_endplate", "rear_wing", "paint", Me, { role: "rwEnd", proj: "main" })));
      // lateral safety / ERS light strip on the endplate's trailing edge (2026)
      const Ml = m3.mesh(), rl = [];
      for (let k = 0; k <= 6; k++) { const z = lerp(E - 240, E - 40, k / 6); rl.push(m3.superellipse(5, 3.5, 2, 8).map(([u, v]) => W(S, xr(z) + 2 + u, yTop + t / 2 + 1 + v, z))); }
      m3.loft(Ml, rl, { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("rw_light", "rear_wing", "led", Ml)));
    }
    // pylons (RV-RW-PYLON, |Y| 50-110): from the crash structure [XR, Z 300-450] up to the main plane's underside
    {
      const s0 = rwStation(S, DIM.rw.pylonY), main = sectionPolys(s0.els, s0.x0, s0.z0, 0, s0.pivot)[0];
      const lowAt = (x) => { let best = Infinity; for (const p of main.pts) if (Math.abs(p[0] - x) < 25) best = Math.min(best, p[1]); return isFinite(best) ? best : 790; };
      const zb0 = bodyAt(S, S.XR + 120).zt - 24, xa = S.XR + 250, xb = S.XR + 420;
      const ol = m3.roundPoly([[S.XR + 40, zb0, 16], [S.XR + 240, zb0 - 6, 30], [xb, lowAt(xb) + 6, 12], [xa, lowAt(xa) + 6, 12]], 4);
      const Mp = m3.mesh(); m3.loft(Mp, [-1, -0.6, 0.6, 1].map(s => ol.map(([x, z]) => W(S, x, DIM.rw.pylonY + 5 * s - (Math.abs(s) < 1 ? 0 : 0), z + (Math.abs(s) < 1 ? 0 : 0)))), { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("rw_pylon", "rear_wing", "carbon", Mp)));
      // straight-mode actuator pod on the main plane's centre, its link to the flap
      if (rw.n >= 2) {
        let cz = -Infinity, cx = 0; for (const p of main.pts) { cz = Math.max(cz, p[1]); cx += p[0] / main.pts.length; }
        const Ma = m3.mesh(), rs = [];
        for (let k = 0; k <= 10; k++) { const t2 = k / 10, x = lerp(s0.x0 + 20, s0.x0 + 0.62 * rw.chord, t2), r = 22 * Math.sin(Math.PI * Math.min(1, 0.06 + t2)); rs.push(m3.superellipse(r * 1.2, r * 0.7, 2.4, 14).map(([a, b]) => W(S, x, a, cz + 4 + b))); }
        m3.loft(Ma, rs, { wrap: true, capA: true, capB: true, solid: true });
        items.push(item("rw_actuator", "rear_wing", "carbon", Ma));
      }
    }
    return items;
  }

  // ---------------------------------------------------------------- WHEELS: 2026 tyres, 18-inch rims (no covers), brakes, ducts
  // one corner (right side, outboard = +z); wheel axis = world z. All sizes in mm, built in metres.
  function buildCorner(S, wh, front) {
    const items = [], R = wh.od / 2, tw = wh.tread / 2, sw = wh.rimW / 2 + 7, rimH = wh.rimW / 2, C0 = Gd(wh.X, wh.Y, wh.hc);
    const ax = [0, 0, 1], ref = [1, 0, 0], mm = (r, a) => [r / 1000, a / 1000];
    const part = front ? "wheels_front" : "wheels_rear", bpart = front ? "brakes_front" : "brakes_rear";
    // tyre: bead -> sidewall -> shoulder -> tread (r = R - 5·(a/tw)^4, so |a| ≤ tw is exactly the tread at r ≥ R - 5) -> back
    const prof = [], half = [];
    half.push([DIM.tyre.lipDia / 2 + 2, rimH - 6], [DIM.tyre.lipDia / 2 + 14, sw - 3], [272, sw - 0.5], [292, sw], [310, sw - 0.5]);
    for (let k = 0; k <= 9; k++) { const ph = (Math.PI / 2) * k / 9; half.push([R - 40 + 35 * Math.sin(ph), tw + (sw - 4 - tw) * Math.cos(ph)]); }
    for (const [r, a] of half) prof.push(mm(r, -a));
    for (let k = 1; k < 12; k++) { const a = lerp(-tw, tw, k / 12); prof.push(mm(R - 5 * Math.pow(a / tw, 4), a)); }
    for (let i = half.length - 1; i >= 0; i--) prof.push(mm(half[i][0], half[i][1]));
    const Mt = m3.mesh(); m3.lathe(Mt, prof, C0, ax, ref, 120, { inside: C0 });
    // contact patch: the static deflection flattens the bottom on the ground
    { const TP = Mt.P; for (let i = 1; i < TP.length; i += 3) if (TP[i] < 0) TP[i] = 0; }
    items.push(item("tyre", part, "tyre", Mt));
    // sidewall lettering band (outboard face, 0.8 mm proud): u around, v radial
    const band = []; for (let k = 0; k <= 6; k++) { const r = lerp(258, R - 44, k / 6); band.push(mm(r, sw + 0.9 - 0.6 * Math.pow((r - 290) / 60, 2))); }
    const Mw = m3.mesh(); m3.lathe(Mw, band, C0, ax, ref, 120, { inside: [C0[0], C0[1], C0[2] - 1], uv: (u, i) => [u, i / 6] });
    items.push(item("tyre_wall", part, "tyreWall", Mw));
    // rim: lips at the C10.7.2 lip diameter (496), bead seats, barrel; spokes on the outboard face
    const rp = [[248, rimH], [247, rimH - 8.5], [233, rimH - 10], [229, rimH - 22], [226, rimH - 40], [222, -rimH + 44], [229, -rimH + 22], [233, -rimH + 10.5], [247, -rimH + 10.5], [248, -rimH]].map(([r, a]) => mm(r, a));
    const Mr = m3.mesh(); m3.lathe(Mr, rp, C0, ax, ref, 96, { inside: C0 });
    const aS = rimH - 48, Ms = m3.mesh();
    for (let s = 0; s < 10; s++) {
      const th = (2 * Math.PI) * s / 10 + 0.15, dirv = [Math.cos(th), Math.sin(th), 0], path = [];
      for (let k = 0; k <= 8; k++) { const t = k / 8, r = lerp(66, 226, t), a = aS + 12 * (1 - t) - 6 * t * t; path.push([C0[0] + dirv[0] * r / 1000, C0[1] + dirv[1] * r / 1000, C0[2] + a / 1000]); }
      m3.sweep(Ms, path, (t) => m3.roundPoly([[-1, -1, 0.3], [1, -1, 0.3], [1, 1, 0.3], [-1, 1, 0.3]], 2).map(([u, v]) => [u * lerp(0.017, 0.011, t), v * lerp(0.008, 0.0055, t)]), { up: [0, 0, 1], fixedUp: true });
    }
    // hub disc, centre-lock nut (12 flats), retention clip
    const hubP = [[0, aS + 10], [70, aS + 10], [76, aS + 2], [76, aS - 14], [60, aS - 22]].map(([r, a]) => mm(r, a));
    m3.lathe(Ms, hubP, C0, ax, ref, 40, { inside: C0 });
    const nut = [[0, aS + 46], [24, aS + 46], [34, aS + 40], [36, aS + 16], [44, aS + 12], [44, aS + 8]].map(([r, a]) => mm(r, a));
    const Mn = m3.mesh(); m3.lathe(Mn, nut, C0, ax, ref, 12, { inside: C0 });
    items.push(item("rim", part, "rim", Mr, { look: "mg_az80a" }), item("rim_spokes", part, "rim", Ms, { look: "mg_az80a" }), item("wheel_nut", part, "metal", Mn, { look: "ti64" }));
    // brake disc (carbon-carbon, C11.3.3 diameter) + bell, caliper behind the axle, duct drum and inlet scoop
    const rd = wh.disc / 2, aD = aS - 92, Md = m3.mesh();
    m3.lathe(Md, [[100, aD - 16], [rd, aD - 16], [rd + 1, aD], [rd, aD + 16], [100, aD + 16], [99, aD - 16]].map(([r, a]) => mm(r, a)), C0, ax, ref, 72, { inside: C0 });
    items.push(item("brake_disc", bpart, "disc", Md));
    const Mb = m3.mesh(); m3.lathe(Mb, [[100, aD], [96, aD + 20], [80, aS - 24], [62, aS - 26]].map(([r, a]) => mm(r, a)), C0, ax, ref, 36, { inside: C0 });
    items.push(item("brake_bell", bpart, "metal", Mb, { look: "ti64" }));
    const Mc = m3.mesh(), cA = Math.PI + (front ? 0.35 : -0.25), path = [];
    for (let k = 0; k <= 10; k++) { const a = cA - 0.42 + 0.84 * k / 10; path.push([C0[0] + Math.cos(a) * (rd - 22) / 1000, C0[1] + Math.sin(a) * (rd - 22) / 1000, C0[2] + aD / 1000]); }
    m3.sweep(Mc, path, () => m3.roundPoly([[-1, -1, 0.35], [1, -1, 0.35], [1, 1, 0.35], [-1, 1, 0.35]], 3).map(([u, v]) => [u * 0.036, v * 0.03]), { up: [0, 0, 1], fixedUp: true });
    items.push(item("caliper", bpart, "caliper", Mc));
    const Mdr = m3.mesh(); m3.lathe(Mdr, [[206, aS - 58], [208, aS - 140], [204, -rimH - 14], [196, -rimH - 22], [150, -rimH - 30]].map(([r, a]) => mm(r, a)), C0, ax, ref, 64, { inside: C0 });
    items.push(item("brake_drum", bpart, "carbon", Mdr));
    // inlet scoop (RV-FWH-SCO / RV-RWH-SCO): a rounded duct on the drum's inboard face, mouth facing forward
    const Mk = m3.mesh(), sc = [];
    const aI = -rimH - 18, mouthX = front ? 150 : 130;
    for (let k = 0; k <= 8; k++) { const t = k / 8, x = lerp(-mouthX, 10, t), h = lerp(front ? 120 : 160, 60, t);
      sc.push(m3.roundPoly([[-1, -1, 0.4], [1, -1, 0.4], [1, 1, 0.4], [-1, 1, 0.4]], 3).map(([u, v]) => Gd(wh.X + x, wh.Y + aI - 26 + 22 * u, wh.hc + h + v * lerp(46, 32, t)))); }
    m3.loft(Mk, sc, { wrap: true, capB: true, solid: true });
    items.push(item("brake_scoop", bpart, "carbon", Mk));
    if (!front) {
      // rear wheel bodywork winglets above the driveshaft (REDBULL.md: Silverstone package)
      const Mw2 = m3.mesh(), fo = m3.foil(0.07, 0.4, 0.1, 12, 0.02);
      for (const [hz, c] of [[520, 170], [580, 140]]) { const rs = []; for (let k = 0; k <= 4; k++) { const y = lerp(wh.Y - rimH - 120, wh.Y - rimH - 24, k / 4); rs.push(m3.placeFoil(fo.ring, [wh.X - 120, hz], c, rad(-12), 0, null).map(([x, z]) => Gd(x, y, z))); } m3.loft(Mw2, rs, { wrap: true, capA: true, capB: true, solid: true }); }
      const fence = m3.roundPoly([[wh.X - 140, 360, 20], [wh.X + 60, 360, 20], [wh.X + 60, 620, 30], [wh.X - 120, 640, 30]], 4);
      m3.loft(Mw2, [-1, 1].map(s => fence.map(([x, z]) => Gd(x, wh.Y - rimH - 124 + 3 * s, z))), { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("rear_winglets", "brakes_rear", "carbon", Mw2));
    }
    return items;
  }
  function buildWheels(S) {
    const items = [];
    for (const [wh, front] of [[S.wheel.front, true], [S.wheel.rear, false]]) for (const it of buildCorner(S, wh, front)) { it.name = (front ? "f_" : "r_") + it.name; items.push(...pair(it)); }
    return items;
  }

  // ---------------------------------------------------------------- SUSPENSION: push-rod front and rear, wishbones, track / toe rods
  // pick-ups: inboard on the chassis / gearbox (sprung, Z frame), outboard on the upright (unsprung, height above the ground)
  function buildSuspension(S) {
    const items = [], fr = S.wheel.front, re = S.wheel.rear;
    const wingSec = (c, t) => () => m3.foil(0, 0.3, 0.32, 8, 0.05).ring.map(([u, v]) => [(u - 0.5) * c, v * c * 0.9 * t]);   // a symmetric aero section, chord c (m)
    const blade = (M, a, b, c, t) => m3.sweep(M, [a, m3.v3.lerp3(a, b, 0.5), b], (tt) => m3.superellipse(c / 2, t / 2, 2.2, 14).map(([u, v]) => [u * (1 - 0.15 * Math.abs(tt - 0.5)), v]), { up: [0, 1, 0] });
    const rod = (M, a, b, r) => m3.tube(M, [a, m3.v3.lerp3(a, b, 0.5), b], r, r, 10);
    const corner = (w, pts, part, rear) => {
      const Mw = m3.mesh(), Mr = m3.mesh(), Mu = m3.mesh();
      // wishbones: two legs each, aero sections (chord 64 / 52 mm, 16 mm thick)
      for (const [o, i1, i2, c] of [[pts.lbj, pts.lf, pts.lr, 0.062], [pts.ubj, pts.uf, pts.ur, 0.052]]) { blade(Mw, o, i1, c, 0.016); blade(Mw, o, i2, c, 0.016); }
      blade(Mr, pts.pr0, pts.pr1, 0.044, 0.022);                  // push rod
      blade(Mr, pts.tr0, pts.tr1, 0.040, 0.016);                  // track (front) / toe (rear) rod
      if (rear) rod(Mr, pts.ds0, pts.ds1, 0.022);                 // driveshaft
      // upright: a block between the ball joints (inside the rim)
      const up = [pts.lbj, m3.v3.lerp3(pts.lbj, pts.ubj, 0.5), pts.ubj];
      m3.sweep(Mu, up, () => m3.roundPoly([[-1, -1, 0.3], [1, -1, 0.3], [1, 1, 0.3], [-1, 1, 0.3]], 2).map(([u, v]) => [u * 0.05, v * 0.03]), { up: [0, 0, 1], fixedUp: true });
      items.push(...pair(item("wishbones" + (rear ? "_r" : "_f"), part, "carbon", Mw)));
      items.push(...pair(item("rods" + (rear ? "_r" : "_f"), part, "carbon", Mr)));
      items.push(...pair(item("upright" + (rear ? "_r" : "_f"), part, "metal", Mu, { look: "ti64" })));
    };
    const X0 = fr.X, Y0 = fr.Y;
    corner(fr, {
      lbj: Gd(X0 - 10, Y0 - 150, 170), ubj: Gd(X0 + 18, Y0 - 168, 540), lf: W(S, X0 - 330, 150, 120), lr: W(S, X0 + 330, 180, 108), uf: W(S, X0 - 240, 165, 420), ur: W(S, X0 + 270, 190, 440),
      pr0: Gd(X0 + 2, Y0 - 185, 196), pr1: W(S, X0 + 70, 120, 552), tr0: Gd(X0 - 110, Y0 - 160, 470), tr1: W(S, X0 - 95, 178, 418),
    }, "front_suspension", false);
    const X1 = re.X, Y1 = re.Y;
    corner(re, {
      lbj: Gd(X1 + 6, Y1 - 180, 168), ubj: Gd(X1 - 12, Y1 - 196, 520), lf: W(S, X1 - 470, 125, 118), lr: W(S, X1 + 80, 115, 108), uf: W(S, X1 - 330, 140, 390), ur: W(S, X1 + 40, 120, 410),
      pr0: Gd(X1, Y1 - 205, 192), pr1: W(S, X1 - 170, 82, 465), tr0: Gd(X1 + 130, Y1 - 180, 230), tr1: W(S, X1 + 120, 122, 196), ds0: Gd(X1, 140, re.hc), ds1: Gd(X1, Y1 - 150, re.hc),
    }, "rear_suspension", true);
    return items;
  }

  // ---------------------------------------------------------------- DETAILS: halo, airbox + roll hoop, fin, mirrors, driver,
  // steering wheel, cameras, exhaust tailpipe, rain light (placed relative to the cell anchors XA / XC / XPU and XR)
  function ellRings(xs, f, N) {   // rings of superellipse sections: f(x) -> { cy, cz, a, b, n } (mm, FIA)
    return xs.map((x) => { const s = f(x); return m3.superellipse(s.a, s.b, s.n || 2, N || 24).map(([u, v]) => [x, s.cy + u, s.cz + v]); });
  }
  function buildDetails(S) {
    const items = [], XC = S.XC, XA = S.XA;
    const Wp = (p) => W(S, p[0], p[1], p[2]);
    // halo (titanium, faired, painted): rear legs on the cockpit rim, hoop over the driver, front pillar onto the chassis
    {
      const zt = (x) => bodyAt(S, x).zt;
      const hoopR = [[XC - 135, 330, zt(XC - 135) - 4], [XC - 230, 338, 790], [XC - 420, 330, 828], [XC - 640, 286, 840], [XC - 820, 196, 840], [XC - 930, 92, 836], [XC - 968, 0, 834]];
      const pts = hoopR.concat(hoopR.slice(0, -1).reverse().map(([x, y, z]) => [x, -y, z]));
      const path = m3.catmull(pts, 6).map(Wp);
      const Mh = m3.mesh(); m3.sweep(Mh, path, () => m3.superellipse(0.023, 0.027, 2.3, 18), { up: [0, 1, 0] });
      const pil = m3.catmull([[XC - 968, 0, 834], [XC - 1040, 0, 812], [XC - 1180, 0, zt(XC - 1180) + 40], [XC - 1260, 0, zt(XC - 1260) - 6]], 6).map(Wp);
      m3.sweep(Mh, pil, (t) => m3.superellipse(lerp(0.022, 0.032, t), lerp(0.026, 0.016, t), 2.4, 18), { up: [0, 0, 1], fixedUp: true });
      items.push(item("halo", "halo", "paint", Mh, { role: "halo", proj: "halo" }));
    }
    // airbox + roll hoop: a tall section over the spine with the intake mouth at its front, the T-camera on top
    {
      const x0 = XC - 110, x1 = S.XPU + 380, zb = (x) => bodyAt(S, x).zt - 70;
      const T = m3.table([x0, XC - 60, XC + 30, XC + 220, S.XPU, x1], { top: [952, 966, 974, 930, 840, bodyAt(S, x1).zt + 6], hw: [116, 128, 134, 116, 92, 60] });
      const N = 40, mouth = (grow) => m3.superellipse(84 + grow, 56 + grow, 3, N, -Math.PI / 2), mc = 884;
      const sec = (x) => { const t = T(x), b = zb(x), a = t.hw, h = (t.top - b) / 2; return m3.superellipse(a, h, 2.6, N, -Math.PI / 2).map(([u, v]) => [x, u, b + h + v]); };
      const blendR = (x, gr, k) => { const m = mouth(gr), s2 = sec(x); return m.map(([u, v], i) => [x, lerp(u, s2[i][1], k), lerp(mc + v, s2[i][2], k)]); };
      const rings = [mouth(0).map(([u, v]) => [x0 + 18, u, mc + v]), mouth(6).map(([u, v]) => [x0 + 4, u, mc + v]), mouth(13).map(([u, v]) => [x0, u, mc + v]), blendR(x0 + 10, 20, 0.45), blendR(x0 + 34, 22, 0.85)];
      for (let x = x0 + 60; x < x1; x += 30) rings.push(sec(x));
      rings.push(sec(x1).map((p) => [x1, p[1] * 0.3, Math.max(p[2], zb(x1) + 20)]));
      const Ma = m3.mesh(); m3.loft(Ma, rings.map(r => r.map(Wp)), { wrap: true, capB: true, solid: true });
      items.push(item("airbox", "engine_cover", "paint", Ma, { role: "body", proj: "main" }));
      const duct = [[x0 + 18, 1], [x0 + 120, 0.86], [x0 + 210, 0.6]].map(([x, k]) => mouth(0).map(([u, v]) => Wp([x, u * k, mc + v * k])));
      const Md = m3.mesh(); m3.loft(Md, duct, { wrap: true, capB: true, inside: Wp([x0 + 100, 0, mc]), flip: true });
      items.push(item("airbox_duct", "engine_cover", "interior", Md));
      // T-camera pod on the airbox (FIA camera housing)
      const tc = XC + 70, tz = T(tc).top - 4, Mc = m3.mesh();
      m3.loft(Mc, ellRings([tc - 70, tc - 60, tc - 20, tc + 40, tc + 70, tc + 76], (x) => ({ cy: 0, cz: tz + 22, a: 34 * Math.sin(Math.PI * clamp((x - tc + 76) / 152, 0.05, 0.95)) + 4, b: 18 * Math.sin(Math.PI * clamp((x - tc + 76) / 152, 0.05, 0.95)) + 3, n: 3 }), 16).map(r => r.map(Wp)), { wrap: true, capA: true, capB: true, solid: true });
      for (const s of [-1, 1]) m3.loft(Mc, [0, 1].map(k => m3.roundPoly([[tc - 30, tz, 3], [tc + 40, tz, 3], [tc + 30, tz + 34, 3], [tc - 10, tz + 30, 3]], 2).map(([x, z]) => Wp([x, s * 40 + (k ? 3 : -3), z]))), { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("t_camera", "electronics", "tcam", Mc));
      // engine-cover fin
      const fx0 = S.XPU + 60, fx1 = S.XR - 120, Mf = m3.mesh();
      const fo = []; for (let k = 0; k <= 10; k++) { const x = lerp(fx0, fx1, k / 10); fo.push([x, bodyAt(S, x).zt - 10]); }
      for (let k = 10; k >= 0; k--) { const x = lerp(fx0, fx1, k / 10); fo.push([x, bodyAt(S, x).zt + 22 + 70 * Math.sin(Math.PI * Math.pow(k / 10, 0.7)) * (1 - 0.4 * k / 10)]); }
      m3.slab(Mf, fo.map(([x, z]) => [(1750 - x) / 1000, (z + 10 + S.rh) / 1000]), m3.frameXY(0), 0.006, 0.0028, 2);
      items.push(item("fin", "engine_cover", "paint", Mf, { role: "fin", proj: "main" }));
    }
    // mirrors (C3.7.5): housing ahead of the sidepod, glass facing back, inner stay to the chassis, rear stay to the sidepod
    {
      const mx = XC - 930, my = 548, mz = 688, Mm = m3.mesh(), Mg = m3.mesh(), Mst = m3.mesh();
      const ys = []; for (let k = 0; k <= 10; k++) ys.push(lerp(my - 88, my + 88, k / 10));
      const rings = ys.map((y) => { const t = (y - (my - 88)) / 176, e = Math.sin(Math.PI * clamp(t, 0.02, 0.98)); return m3.superellipse(36 * (0.55 + 0.45 * e), 32 * (0.6 + 0.4 * e), 3, 20).map(([u, v]) => [mx + u + 8, y, mz + v]); });
      m3.loft(Mm, rings.map(r => r.map(Wp)), { wrap: true, capA: true, capB: true, solid: true });
      const gl = m3.roundPoly([[my - 80, mz - 26, 10], [my + 80, mz - 26, 10], [my + 80, mz + 26, 10], [my - 80, mz + 26, 10]], 3);
      m3.loft(Mg, [gl.map(([y, z]) => Wp([mx + 43, y, z])), gl.map(([y, z]) => Wp([mx + 46, y, z]))], { wrap: true, capA: true, capB: true, solid: true });
      const yc = bodyAt(S, mx + 20).yw - 10;
      m3.sweep(Mst, [[mx + 10, my - 80, mz - 6], [mx + 14, (my + yc) / 2, mz - 20], [mx + 20, yc, mz - 50]].map(Wp), () => m3.superellipse(0.018, 0.005, 2.2, 10), { up: [0, 1, 0] });
      m3.sweep(Mst, [[mx + 30, my + 20, mz - 26], [mx + 160, my - 10, mz - 70], [S.pod.X + 60, my - 60, S.pod.Ztop - 6]].map(Wp), () => m3.superellipse(0.016, 0.005, 2.2, 10), { up: [0, 1, 0] });
      items.push(...pair(item("mirror", "misc", "paint", Mm, { role: "mirror", proj: "main" })));
      items.push(...pair(item("mirror_glass", "misc", "mirror", Mg)));
      items.push(...pair(item("mirror_stays", "misc", "carbon", Mst)));
    }
    // driver: helmet (livery helmet design, cylindrical u around the head, v down from the crown), visor, HANS / shoulders, headrest
    {
      const hx = XC - 268, hz = 688, Mh = m3.mesh(), xs = [];
      for (let k = 0; k <= 22; k++) xs.push(hx - 142 + 284 * (0.5 - 0.5 * Math.cos(Math.PI * k / 22)));
      const rings = xs.map((x) => { const t = (x - hx) / 142, e = Math.sqrt(Math.max(0.0004, 1 - t * t)); return m3.superellipse(110 * e, 124 * e, 2.15, 32).map(([u, v]) => [x, u, hz + v + 6 * t]); });
      m3.loft(Mh, rings.map(r => r.map(Wp)), { wrap: true, solid: true, uv: (r, i) => { const p = rings[r][i]; return [0.5 + Math.atan2(p[1], hx - p[0]) / (2 * Math.PI), clamp((hz + 124 - p[2]) / 248, 0, 1)]; } });
      items.push(item("helmet", "driver", "helmet", Mh));
      // visor: a dark band across the front, 1.5 mm proud
      const Mv = m3.mesh(), vr = [];
      for (let k = 0; k <= 12; k++) { const ph = -1.05 + 2.1 * k / 12, row = []; for (const dz of [-30, -12, 8, 24]) { const z = hz + dz + 8, t = ((z - hz) / 124), rx = 142 * Math.sqrt(Math.max(0, 1 - t * t)) + 1.5, ry = 110 * Math.sqrt(Math.max(0, 1 - t * t)) + 1.5; row.push([hx - rx * Math.cos(ph) * 0.96, ry * Math.sin(ph), z]); } vr.push(row); }
      m3.loft(Mv, vr.map(r => r.map(Wp)), { inside: Wp([hx, 0, hz]) });
      items.push(item("visor", "driver", "visor", Mv));
      const Ms = m3.mesh();   // shoulders + HANS (suit colour), mostly hidden by the cockpit rim
      m3.loft(Ms, ellRings([hx - 60, hx - 20, hx + 60, hx + 120], (x) => ({ cy: 0, cz: 560, a: 200 * Math.sin(Math.PI * clamp((x - hx + 70) / 200, 0.1, 0.9)), b: 70, n: 2.4 }), 24).map(r => r.map(Wp)), { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("driver_body", "driver", "suit", Ms));
      // headrest pads around the helmet (dark foam)
      const Mp = m3.mesh(), cwR = (x) => cockpitAt(S, x).cw;
      for (const s of [-1, 1]) { const pr = []; for (let k = 0; k <= 10; k++) { const x = lerp(XC - 400, XC - 80, k / 10), y = s * (Math.max(120, cwR(x) - 34)); pr.push([x, y, bodyAt(S, x).zt - 14 + 10 * Math.sin(Math.PI * k / 10)]); }
        m3.sweep(Mp, pr.map(Wp), (t) => m3.superellipse(0.026 * (0.7 + 0.3 * Math.sin(Math.PI * t)), 0.03, 3, 14), { up: [0, 1, 0] }); }
      m3.loft(Mp, ellRings([XC - 140, XC - 125, XC - 70, XC - 55], (x) => ({ cy: 0, cz: bodyAt(S, XC - 100).zt + 4, a: 150 * (x > XC - 130 && x < XC - 60 ? 1 : 0.85), b: 60, n: 3 }), 20).map(r => r.map(Wp)), { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("headrest", "seat_safety", "interior", Mp, { soft: true }));
      // steering wheel (flat, grips, display)
      const sx = XC - 845, sz = 560, Mw = m3.mesh(), Md = m3.mesh();
      const ol = m3.roundPoly([[-130, -62, 30], [130, -62, 30], [118, 52, 40], [62, 70, 18], [-62, 70, 18], [-118, 52, 40]], 4);
      m3.loft(Mw, [0, 1].map(k => ol.map(([y, z]) => Wp([sx + (k ? 22 : -22) + (z - sz) * 0.25, y, sz + z]))), { wrap: true, capA: true, capB: true, solid: true });
      const dp = m3.roundPoly([[-46, 2, 4], [46, 2, 4], [46, 42, 4], [-46, 42, 4]], 2);
      m3.loft(Md, [0, 1].map(k => dp.map(([y, z]) => Wp([sx + 23 + k * 2 + (z) * 0.25, y, sz + z]))), { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("steering_wheel", "front_suspension", "carbon", Mw), item("steering_display", "electronics", "screen", Md));
    }
    // FIA camera pods on the nose (RV-CAMERA-2 region) and a pitot / antenna
    {
      const Mc = m3.mesh(), cx = Math.max(-1000, XA - 380);
      for (const s of [-1, 1]) { const b = bodyAt(S, cx); m3.loft(Mc, ellRings([cx - 70, cx - 62, cx - 30, cx + 40, cx + 70, cx + 74], (x) => ({ cy: s * (b.ys * 0.9 + 10), cz: b.zt + 6, a: 18 * Math.sin(Math.PI * clamp((x - cx + 74) / 148, 0.06, 0.94)) + 2, b: 15 * Math.sin(Math.PI * clamp((x - cx + 74) / 148, 0.06, 0.94)) + 2, n: 2.4 }), 14).map(r => r.map(Wp)), { wrap: true, capA: true, capB: true, solid: true }); }
      items.push(item("nose_cameras", "electronics", "carbon", Mc));
      const Mn = m3.mesh(), ax = XA + 380; m3.tube(Mn, [[ax, 0, bodyAt(S, ax).zt - 4], [ax + 10, 0, bodyAt(S, ax).zt + 70], [ax + 30, 0, bodyAt(S, ax).zt + 130]].map(Wp), 0.004, 0.004, 8);
      items.push(item("antenna", "electronics", "metal", Mn, { look: "steel_17_4ph" }));
    }
    // engine-cover cooling exit above the gearbox (dark), framed by a lip
    {
      const ox = S.XR - 40, ob = bodyAt(S, ox), Mo = m3.mesh(), Ml2 = m3.mesh();
      const ring = (g, dz, k) => m3.superellipse((ob.ys + 34) * k + g, 46 * k + g, 2.4, 28).map(([y, z]) => Wp([ox + 6 - dz, y, ob.zt - 34 + z + dz * 0.4]));
      m3.loft(Mo, [ring(0, 0, 1), ring(0, 70, 0.8)], { wrap: true, capB: true, inside: Wp([ox - 200, 0, ob.zt - 40]), flip: true });
      m3.loft(Ml2, [ring(10, -6, 1), ring(4, -2, 1), ring(0, 2, 1)], { wrap: true, inside: Wp([ox - 200, 0, ob.zt - 40]) });
      items.push(item("cooling_exit", "engine_cover", "interior", Mo), item("cooling_exit_lip", "engine_cover", "paint", Ml2, { role: "body", proj: "main" }));
    }
    // rear: rain light on the crash structure's end, exhaust tailpipe above it (C3.9)
    {
      const xe = S._bs ? S._bs.x1 : S.XR + 440, Ml = m3.mesh(), Mx = m3.mesh(), Mxi = m3.mesh();
      const lb = bodyAt(S, xe - 10), lz = (lb.zb + lb.zt) / 2;
      const lr = m3.roundPoly([[-58, -26, 8], [58, -26, 8], [58, 26, 8], [-58, 26, 8]], 3);
      m3.loft(Ml, [lr.map(([y, z]) => Wp([xe - 6, y, lz + z])), lr.map(([y, z]) => Wp([xe + 6, y, lz + z]))], { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("rain_light", "rear_impact", "led", Ml));
      const ez = bodyAt(S, S.XR + 120).zt + 52, path = [[S.XR - 40, 0, ez - 30], [S.XR + 120, 0, ez], [S.XR + 330, 0, ez + 8]].map(Wp);
      m3.lathe(Mx, [[0.047, -0.001], [0.047, 0.24], [0.051, 0.25], [0.051, 0.255], [0.043, 0.25]], Wp([S.XR + 330, 0, ez + 8]), [1, 0, 0], [0, 1, 0], 28, { inside: Wp([S.XR + 200, 0, ez + 8]) });
      m3.lathe(Mxi, [[0.044, 0.248], [0.044, 0.18]], Wp([S.XR + 330, 0, ez + 8]), [1, 0, 0], [0, 1, 0], 28, { inside: Wp([S.XR + 200, 0, ez + 40]) });
      items.push(item("exhaust", "pu_electronics", "metal", Mx, { look: "inconel_718" }), item("exhaust_inner", "pu_electronics", "black", Mxi));
    }
    return items;
  }

  // ---------------------------------------------------------------- groups
  // a group = one rebuild unit; key = the spec values its geometry depends on
  const GROUPS = {
    body: { parts: ["survival_cell", "nose", "engine_cover", "rear_impact"], key: (S) => [S.XA, S.XC, S.XPU, S.XR, S.rh], build: buildBody },
    sidepods: { parts: ["sidepods", "cooling"], key: (S) => [S.XA, S.XC, S.XPU, S.XR, S.rh, S.sp.inlet, S.sp.u, S.floor.throat], build: buildSidepods },
    floor: { parts: ["floor"], key: (S) => [S.XA, S.XC, S.XPU, S.XR, S.rh, S.floor.W, S.floor.throat, S.floor.deg], build: buildFloor },
    diffuser: { parts: ["diffuser"], key: (S) => [S.XR, S.rh, S.floor.W, S.floor.throat, S.floor.deg], build: buildDiffuser },
    front_wing: { parts: ["front_wing"], key: (S) => [S.fw, S.rh, S.XA], build: buildFrontWing, flap: true },
    rear_wing: { parts: ["rear_wing"], key: (S) => [S.rw, S.XR, S.rh], build: buildRearWing, flap: true },
    wheels: { parts: ["wheels_front", "wheels_rear", "brakes_front", "brakes_rear"], key: (S) => [S.XR], build: buildWheels },
    suspension: { parts: ["front_suspension", "rear_suspension"], key: (S) => [S.XR, S.rh], build: buildSuspension },
    details: { parts: ["halo", "misc", "driver", "electronics", "pu_electronics", "seat_safety"], key: (S) => [S.XA, S.XC, S.XPU, S.XR, S.rh, S.sp.inlet], build: buildDetails },
  };
  function groupKey(id, S) { return JSON.stringify(GROUPS[id].key(S)); }
  function buildGroup(id, S, o) {
    const t0 = Date.now(); const items = GROUPS[id].build(S, o || {});
    return { id, key: groupKey(id, S), items, ms: Date.now() - t0 };
  }
  function buildAll(S, o) { const out = {}; for (const id of Object.keys(GROUPS)) out[id] = buildGroup(id, S, o); return out; }

  const api = { DIM, GROUPS, spec, buildGroup, buildAll, groupKey, floorHalfW, floorRoof, bodyAt, cockpitAt, superArea, W, Gd, mirrorGeo, mergeGeo, chainSection, sectionPolys, fwStation, rwStation };
  C.car3d = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
