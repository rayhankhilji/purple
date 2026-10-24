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
    // halo, cockpit, helmet (RV-HALO is a drawing): placed relative to XC from the RB22 photos (CK below)
    halo: { tube: 46 },
  };
  // Cockpit-area placement, mm ahead of XC (the design's cockpit rear), measured on the 2026 RB22 photos along the axle line
  // (docs/concept/rb22-refs/REFERENCES.md): helmet centre 1215 mm behind the front axle, airbox mouth 1450, halo front pillar
  // root 425, sidepod inlet 955 (baseline XC 1855). The concept mass sheet puts the driver at XC-750 (1105), consistent with these.
  const CK = { open0: 1245, open1: 400, helmet: 640, airbox: 405, haloRear: 455, haloPillar: 1430, wheel: 1185, inlet: 900, mirror: 930 };
  const ROUND = (v) => Math.round(v * 1000) / 1000;

  // ---------------------------------------------------------------- concept families (discrete redesigns)
  // Each family is a code in the design's params (docs/concept/REDESIGNS.md §1); a missing or unknown value reads as code 0. The
  // geometry is built from a weight per variant (one-hot for a design; two non-zero weights while the view morphs from one variant to
  // another: params.__cmix[key] = { from, to, t }), so every variant blends continuously into every other.
  // keys here are the view's; `id` is the design parameter (docs/concept/REDESIGNS.md §1, parts.CONCEPTS), `ids` the code ids,
  // `names` the short labels the change tags print, `base` the code a design without the parameter has (the RB22 baseline's)
  const CONCEPTS = {
    sidepods: { id: "sidepods.concept", part: "sidepods", ids: ["downwash", "zeropod", "ramp"], names: ["downwash", "zeropod", "ramp"], base: 0 },
    nose: { id: "nose.concept", part: "nose", ids: ["long_low", "short_high"], names: ["long low nose", "short high nose"], base: 0 },
    fwEndplate: { id: "front_wing.endplate", part: "front_wing", ids: ["open_outwash", "closed_inwash"], names: ["open endplate", "closed endplate"], base: 0 },
    rwStyle: { id: "rear_wing.style", part: "rear_wing", ids: ["low_drag", "medium", "high_df"], names: ["low-drag spoon", "medium", "high downforce"], base: 1 },
    floorEdge: { id: "floor.edge", part: "floor", ids: ["simple", "scrolled"], names: ["simple edge", "scrolled multi-fence edge"], base: 0 },
    cooling: { id: "cooling.layout", part: "cooling", ids: ["standard", "airbox_gills", "compact"], names: ["standard cooling", "large airbox + gills", "compact louvred"], base: 0 },
    cover: { id: "engine_cover.style", part: "engine_cover", ids: ["high_fin", "low_narrow"], names: ["high shark fin", "low narrow cover"], base: 0 },
    frontSusp: { id: "suspension.front", part: "front_suspension", ids: ["pushrod", "pullrod"], names: ["pushrod", "pullrod"], base: 0 },
  };
  for (const c of Object.values(CONCEPTS)) { const [a, b] = c.id.split("."); c.paths = [[a, b]]; }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
  // the family's code in a param set (defensive: missing / non-finite -> the baseline code; out of range clamped; a code id or
  // label string is accepted too)
  function conceptCode(params, key) {
    const c = CONCEPTS[key], n = c.ids.length;
    for (const [a, b] of c.paths) {
      const o = params && params[a]; if (!o || o[b] == null) continue;
      const v = o[b];
      if (typeof v === "number") return Number.isFinite(v) ? clamp(Math.round(v), 0, n - 1) : c.base;
      if (typeof v === "string") { const s = slug(v); let i = c.ids.findIndex(x => slug(x) === s); if (i < 0) i = c.names.findIndex(x => slug(x) === s); if (i >= 0) return i; const k = Number(v); return Number.isFinite(k) ? clamp(Math.round(k), 0, n - 1) : c.base; }
      return c.base;
    }
    return c.base;
  }
  function conceptCodes(params) { const out = {}; for (const k of Object.keys(CONCEPTS)) out[k] = conceptCode(params, k); return out; }
  function conceptWeights(params, key) {
    const n = CONCEPTS[key].ids.length, w = new Array(n).fill(0), mx = params && params.__cmix && params.__cmix[key];
    if (mx && Number.isFinite(mx.t)) { const a = clamp(Math.round(mx.from) || 0, 0, n - 1), b = clamp(Math.round(mx.to) || 0, 0, n - 1), t = clamp(mx.t, 0, 1); w[a] += 1 - t; w[b] += t; }
    else w[conceptCode(params, key)] = 1;
    return w.map(ROUND);
  }

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
    // concept families: weights per variant; S.cw(key, [v0, v1, ...]) blends a number across the variants
    S.cc = {}; for (const k of Object.keys(CONCEPTS)) S.cc[k] = conceptWeights(p, k);
    S.cw = (key, vals) => { const w = S.cc[key]; let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * vals[i]; return s; };
    // nose: long low (tip 35 mm behind the FW profiles' front plane) or short high (ends over the first flap)
    S.noseTip = S.cw("nose", [DIM.noseTip, -985]);
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
    // sidepods: inlet (both sides = inlet_cm2) as a rounded square (superellipse n = 3.4, aspect h/w = 1.0: the RB22's upright
    // "traditional" inlet, not a letterbox) under the mirror; per-side area in mm²
    // the concept sets the inlet's shape (the area stays exact): downwash = upright rounded square, zeropod = tall narrow slot
    // against the chassis, ramp = wide letterbox under a high flat shoulder
    const A = S.sp.inlet * 100 / 2, aspect = S.cw("sidepods", [1.0, 2.3, 0.42]), nI = S.cw("sidepods", [3.4, 4, 4.4]), kI = superArea(nI);   // area = kI · w · h
    const wI = Math.sqrt(A / (kI * aspect)), hI = wI * aspect;
    S.pod = { A, w: wI, h: hI, n: nI, X: XC - CK.inlet, Zc: 0, Yin: 0 };
    S.pod.Zc = S.cw("sidepods", [640, 700, 616]) - hI / 2;   // inlet top level with the cockpit sides (zeropod: higher)
    S.pod.Yin = bodyAt(S, S.pod.X).yw + 6;                   // inlet inner edge just outboard of the chassis side
    S.pod.Yc = S.pod.Yin + wI / 2; S.pod.Yout = S.pod.Yin + wI + 30;   // shoulder = inlet outer edge + 30 mm lip
    S.pod.Ztop = S.pod.Zc + hI / 2 + 30; S.pod.Zsh = S.pod.Zc - hI / 2 - 18; S.pod.Zf = 72;
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
    const { XA, XC, XPU, XR } = S, NT = S.noseTip, o0 = XC - CK.open0, o1 = XC - CK.open1;
    // [X, zb, zt, yw, zw, ys]  (bottom, top, max half width, its height, spine half width), from the RB22 photos: a broad blunt nose
    // rising in a near-straight line to a high chassis (top ~Z 610 at the front axle), cockpit sides at Z ~680, and the engine
    // cover's broad black deck staying high (Z ~900 behind the airbox) all the way back to the rear-wing pylons
    // nose concept: long low (the RB22's, tip on the main plane) / short high (a raised, blunter nose ending over the first flap)
    const nz = (a, b) => a.map((v, i) => S.cw("nose", [v, b[i]]));
    const nose = [
      [NT].concat(nz([146, 290, 86, 208, 68], [262, 392, 104, 326, 82])), [NT + 60].concat(nz([136, 312, 98, 214, 78], [246, 414, 118, 334, 92])),
      [S.cw("nose", [XA - 720, Math.max(XA - 720, NT + 150)])].concat(nz([146, 412, 124, 262, 98], [226, 478, 140, 356, 108])),
      [XA - 360].concat(nz([160, 512, 152, 318, 118], [200, 548, 160, 376, 122])),
    ];
    // engine cover concept: high shark-fin deck (the RB22's) / low narrow cover (deck ~70 mm lower, ~14 % narrower behind the ICE)
    const lo = S.cw("cover", [0, 1]), cv = (zt, k) => [zt - k * 72 * lo, 1 - 0.14 * k * lo];
    const tail = [[XPU + 420, 46, 836, 226, 360, 110, 0.6], [XR - 520, 52, 806, 192, 330, 98, 1], [XR - 160, 120, 760, 160, 330, 86, 0.9], [XR + 160, 214, 664, 124, 360, 70, 0.5]]
      .map(([x, zb, zt, yw, zw, ys, k]) => { const [z, s] = cv(zt, k); return [x, zb, z, yw * s, Math.min(zw, z - 60), ys * s]; });
    const rows = nose.concat([
      [XA, 178, 590, 176, 364, 132], [XA + 380, 152, 640, 222, 418, 168], [o0 - 40, 104, 664, 274, 448, 226], [o0 + 300, 60, 680, 330, 458, 286],
      [o1 - 260, 44, 686, 352, 458, 300], [o1 + 40, 42, 714, 346, 452, 250], [o1 + 170, 42, 856, 330, 440, 150], [XC - 60, 42, 906 - 24 * lo, 312, 428, 138],
      [XPU, 44, 884 - 40 * lo, 282, 404, 126], ...tail, [XR + 440, 254, 452, 84, 340, 46],
    ]);
    for (let i = 1; i < rows.length; i++) if (rows[i][0] < rows[i - 1][0] + 25) rows[i][0] = rows[i - 1][0] + 25;
    const xs = rows.map(r => r[0]), col = (k) => rows.map(r => r[k]);
    return { xs, f: m3.table(xs, { zb: col(1), zt: col(2), yw: col(3), zw: col(4), ys: col(5) }), x0: xs[0], x1: xs[xs.length - 1] };
  }
  function bodyAt(S, X) { if (!S._bs) S._bs = bodyStations(S); return S._bs.f(clamp(X, S._bs.x0, S._bs.x1)); }
  // the body's outer half width at (X, Z): the section outline (behind the cockpit) where it crosses height Z
  function bodyYAt(S, X, Z) {
    const pts = bodyHalf(S, X).out; let best = 0;
    for (let i = 1; i < pts.length; i++) { const [y0, z0] = pts[i - 1], [y1, z1] = pts[i]; if ((z0 - Z) * (z1 - Z) <= 0 && z0 !== z1) best = Math.max(best, lerp(y0, y1, (Z - z0) / (z1 - z0))); }
    return best;
  }
  // cockpit opening: half width cw (plan: a rounded front, straight sides, a short rear radius) and depth below the rim
  function cockpitAt(S, X) {
    const x0 = S.XC - CK.open0, x1 = S.XC - CK.open1, cwMax = 248;
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
    // a rounder keel under the nose and the front chassis; a boxy tub; the engine cover's flanks run straighter (a tent) from the
    // broad deck down into the sidepods
    const nl = lerp(2.0, 2.8, ss(S.XA, S.XC - 800, X)), nu = lerp(lerp(2.3, 2.7, ss(S.noseTip, S.XA + 300, X)), 1.75, ss(S.XC - CK.open1, S.XC - 150, X));
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
    const NT = S.noseTip, xEnd = bs.x1;
    // stations: dense at the nose tip and around the cockpit opening
    const xs = [];
    const tipR = 48; for (let k = 0; k <= 10; k++) xs.push(NT + tipR * (1 - Math.cos(Math.PI / 2 * k / 10)));
    for (let x = NT + tipR + 30; x < xEnd - 40; x += 28) xs.push(x);
    const ck0 = S.XC - CK.open0, ck1 = S.XC - CK.open1; for (const x of [ck0 + 0.8, ck1 - 0.8, ck0 + 4, ck0 + 15, ck0 + 35, ck0 + 70, ck0 + 120, ck1 - 60, ck1 - 30, ck1 - 12, ck1 - 3]) xs.push(x);
    for (const x of [S.XA, S.XC, S.XPU, S.XR]) xs.push(x);   // rings exactly at the design's anchors (the section there is the station's)
    for (let k = 0; k <= 6; k++) xs.push(xEnd - 40 + 40 * k / 6);
    xs.sort((a, b) => a - b);
    const anchors = new Set([S.XA, S.XC, S.XPU, S.XR]), X = [];
    for (const x of xs) { if (X.length && x - X[X.length - 1] <= 1.5) { if (anchors.has(x)) X[X.length - 1] = x; continue; } X.push(x); }
    const rings = [], cockpitRings = [];
    let seg = null;
    for (const x of X) {
      let k = 1, zc = null;
      if (x < NT + tipR) { const t = (x - NT) / tipR; k = Math.max(0.05, Math.cbrt(1 - Math.pow(1 - t, 3))); const s0 = bodyAt(S, NT + tipR); zc = (s0.zb + s0.zt) / 2 - 6; }   // a blunt, squarish tip
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
      // concept 0 downwash, the RB22's (photos): the top falls away right behind the inlet (downwash ramp) and the pod is
      // shrink-wrapped, narrowing from mid-length into a tight coke bottle; the lower flank stays above the floor.
      // concept 1 zeropod: a slim vertical box round the tall inlet that folds into the chassis within ~600 mm (W13 style).
      // concept 2 ramp: a wide flat-topped pod that stays high to the ICE, then ramps down; an inboard gully on its top (SF-23 style).
      // rows [X, top Z, shoulder |Y| (first three), shoulder Z, undercut share]; the variants are blended row by row
      const xm = Math.max(x0 + 520, Math.min(S.XPU - 120, x0 + 820));
      const V = [
        [[x0 + 40, P.Ztop, P.Yout, P.Zsh, 1], [x0 + 400, P.Ztop - 8, P.Yout + 12, P.Zsh - 24, 1], [xm, Math.max(P.Zsh + 90, P.Ztop - 34), P.Yout - 8, Math.max(330, P.Zsh - 60), 0.95],
          [S.XPU + 120, Math.max(P.Zsh + 60, 596), 0, 300, 0.8], [S.XPU + 480, 524, 0, 260, 0.6], [S.XR - 560, 440, 0, 220, 0.42], [S.XR - 270, 336, 0, 180, 0.2]],
        [[x0 + 40, P.Ztop, P.Yout, P.Zsh, 1], [x0 + 400, P.Ztop - 40, P.Yout - 16, P.Zsh - 10, 1], [x0 + 620, P.Ztop - 120, P.Yout - 150, Math.max(330, P.Zsh - 30), 0.6],
          [S.XPU + 120, 560, 0, 330, 0.45], [S.XPU + 480, 500, 0, 290, 0.35], [S.XR - 560, 420, 0, 230, 0.3], [S.XR - 270, 330, 0, 180, 0.2]],
        [[x0 + 40, P.Ztop, P.Yout, P.Zsh, 1], [x0 + 400, P.Ztop + 4, P.Yout + 22, P.Zsh - 6, 1], [Math.max(xm, Math.min(S.XPU - 60, x0 + 980)), P.Ztop - 6, P.Yout + 14, Math.max(340, P.Zsh - 20), 1],
          [S.XPU + 160, P.Ztop - 46, 0, 330, 0.95], [S.XPU + 520, P.Ztop - 130, 0, 290, 0.8], [S.XR - 560, 470, 0, 235, 0.55], [S.XR - 270, 350, 0, 190, 0.25]],
      ];
      const rows = V[0].map((r, i) => r.map((_, j) => S.cw("sidepods", [V[0][i][j], V[1][i][j], V[2][i][j]])));
      for (let i = 1; i < rows.length; i++) if (rows[i][0] < rows[i - 1][0] + 30) rows[i][0] = rows[i - 1][0] + 30;
      const xs = rows.map(r => r[0]);
      // coke bottle: where the shoulder has folded into the body (zeropod: within ~520 mm of mid-pod)
      const xCoke = S.cw("sidepods", [S.XR - 270, Math.min(S.XR - 270, xs[2] + 520), S.XR - 270]);
      S._pt = { xs, xm: xs[2], xCoke, gully: S.cw("sidepods", [0, 0, 1]), f: m3.table(xs, { zt: rows.map(r => r[1]), zsh: rows.map(r => r[3]), uk: rows.map(r => r[4]) }), yo: m3.monoCubic(xs.slice(0, 3), rows.slice(0, 3).map(r => r[2])).f };
    }
    const t = S._pt.f(clamp(X, S._pt.xs[0], S._pt.xs[S._pt.xs.length - 1])), b = bodyAt(S, X);
    // the outer width holds to mid-pod, then blends to the body (+ 24 mm) at the gearbox (coke bottle)
    const xb = S._pt.xm, y0 = S._pt.yo(Math.min(X, xb)), yo0 = X <= xb ? y0 : lerp(y0, b.yw + 24, sstep((X - xb) / Math.max(60, S._pt.xCoke - xb)));
    const zf0 = Math.min(t.zt - 40, floorRoof(S, X) + 12), zsh0 = clamp(t.zsh, zf0 + 30, t.zt - 40);
    const zf = lerp(zsh0 - 30, zf0, ss(x0 + 40, x0 + 520, X));
    const yi = Math.max(60, b.yw - 45);
    // the front of the pod is always wide enough to carry the full undercut depth (every concept: undercut_mm keeps its meaning)
    const yo = X <= x0 + 420 ? Math.max(yo0, yi + S.sp.u + 41) : yo0;
    const u = Math.min(S.sp.u * t.uk, Math.max(0, yo - yi - 40));
    // ramp concept: the inboard gully on the top surface, deepening behind the inlet and running to the rear
    const gully = S._pt.gully * 46 * ss(x0 + 200, x0 + 700, X) * (1 - ss(S.XR - 600, S.XR - 300, X));
    return { zt: t.zt, yo, zsh: Math.max(zsh0, zf + 30), u, zf, yi, gully };
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
    for (let i = 1; i <= NTP; i++) { const s = i / NTP; pts.push([lerp(q.yo - rc, q.yi, s), q.zt + 4 * Math.sin(Math.PI * s) - q.gully * Math.exp(-Math.pow((s - 0.68) / 0.2, 2))]); }
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
    // cooling louvres (RB22 photos: a grille of upright bright slats on the engine cover's flank, just above the sidepod's top and
    // ahead of the rear tyre): a dark recessed panel on the body surface with thin slats standing out of it
    // cooling concept 0 standard: this grille; 1 large airbox + gills: slotted gills across the pod tops; 2 compact: rows of louvres
    // on the engine cover's top (the airbox and the cooling exit change with it in buildDetails)
    const aF = S.cw("cooling", [1, 0, 0]), aG = S.cw("cooling", [0, 1, 0]), aC = S.cw("cooling", [0, 0, 1]);
    const xL0 = S.XPU - 40, xL1 = Math.min(S.XPU + 300, S.XR - 600);
    if (xL1 - xL0 > 120 && aF > 0.02) {
      const Ml = m3.mesh(), Mg = m3.mesh(), NZ = 6;
      const zr = (X) => { const z0 = podAt(S, X).zt + 16; return [z0, Math.min(z0 + Math.max(16, 96 * aF), bodyAt(S, X).zt - 90)]; };
      const panel = []; for (let k = 0; k <= 10; k++) { const X = lerp(xL0, xL1, k / 10), [z0, z1] = zr(X), row = [];
        for (let j = 0; j <= NZ; j++) { const z = lerp(z0, z1, j / NZ); row.push(W(S, X, bodyYAt(S, X, z) + 2.5, z)); }
        for (let j = NZ; j >= 0; j--) { const z = lerp(z0, z1, j / NZ); row.push(W(S, X, bodyYAt(S, X, z) - 6, z)); }
        panel.push(row); }
      m3.loft(Mg, panel, { wrap: true, capA: true, capB: true, solid: true });
      for (let i = 0; i < 11; i++) {
        const X = lerp(xL0 + 16, xL1 - 16, i / 10), [z0, z1] = zr(X), ring = (dx) => { const pts = []; for (let j = 0; j <= 4; j++) { const z = lerp(z0 + 6, z1 - 6, j / 4); pts.push([X + dx + 0.12 * (z - z0), bodyYAt(S, X, z) - 2, z]); } for (let j = 4; j >= 0; j--) { const z = lerp(z0 + 6, z1 - 6, j / 4); pts.push([X + dx + 0.12 * (z - z0), bodyYAt(S, X, z) + 13, z]); } return pts.map(([x, y, z]) => W(S, x, y, z)); };
        m3.loft(Ml, [ring(-2.2), ring(2.2)], { wrap: true, capA: true, capB: true, solid: true });
      }
      items.push(...pair(item("pod_louvres", "cooling", "metal", Ml, { look: "al_7075_t6" }))); items.push(...pair(item("pod_louvre_slots", "cooling", "interior", Mg)));
    }
    // a louvre in a surface: a dark slot (len along X) across Y [ya, yb] on the surface z(X, Y), and a raised lip at its rear edge
    const slot = (Md, Ml, X, ya, yb, zf, len, lip) => {
      const ys = []; for (let k = 0; k <= 6; k++) ys.push(lerp(ya, yb, k / 6));
      m3.loft(Md, ys.map(y => { const z = zf(X, y); return [[X - len / 2, z - 2], [X + len / 2, z - 2], [X + len / 2, z + 1.6], [X - len / 2, z + 1.6]].map(([x, zz]) => W(S, x, y, zz)); }), { wrap: true, capA: true, capB: true, solid: true });
      if (lip > 0.5) m3.loft(Ml, ys.map(y => { const z = zf(X + len / 2, y); return [[X + len / 2 - 5, z - 1], [X + len / 2 + 4, z - 1], [X + len / 2 + 4 + lip * 0.55, z + lip], [X + len / 2 - 2 + lip * 0.55, z + lip]].map(([x, zz]) => W(S, x, y, zz)); }), { wrap: true, capA: true, capB: true, solid: true });
    };
    // gills across the pod tops (large airbox + gills): five long slots with tall lips behind the inlet
    if (aG > 0.02) {
      const Md = m3.mesh(), Ml = m3.mesh();
      for (let i = 0; i < 5; i++) {
        const X = x0 + 380 + i * 105, q = podAt(S, X), ya = q.yi + 30, yb = q.yo - 60;
        if (yb - ya > 60) slot(Md, Ml, X, ya, yb, (x, y) => podAt(S, x).zt + 2, 58 * aG, 30 * aG);
      }
      if (Md.count) { items.push(...pair(item("pod_gills", "cooling", "interior", Md))); items.push(...pair(item("pod_gill_lips", "cooling", "paint", Ml, { role: "body", proj: "main" }))); }
    }
    // compact: rows of louvres on the engine cover's top, either side of the spine
    if (aC > 0.02) {
      const Md = m3.mesh(), Ml = m3.mesh(), xa = S.XPU - 60, xb = Math.min(S.XR - 520, S.XPU + 760);
      for (let i = 0; i < 9; i++) {
        const X = lerp(xa, xb, i / 8), b = bodyAt(S, X), ya = Math.max(40, b.ys * 0.35), yb = Math.max(ya + 40, b.ys + 0.45 * (b.yw - b.ys));
        slot(Md, Ml, X, ya, yb, (x, y) => bodyTopAt(S, x, y), 44 * aC, 16 * aC);
      }
      items.push(...pair(item("cover_louvres", "cooling", "interior", Md))); items.push(...pair(item("cover_louvre_lips", "cooling", "paint", Ml, { role: "body", proj: "main" })));
    }
    return items;
  }
  // the body's top surface height at (X, |Y|): the highest point of the section outline at that |Y|
  function bodyTopAt(S, X, Y) {
    const pts = bodyHalf(S, X).out; let best = -Infinity;
    for (let i = 1; i < pts.length; i++) { const [y0, z0] = pts[i - 1], [y1, z1] = pts[i]; if ((y0 - Y) * (y1 - Y) <= 0 && y0 !== y1) best = Math.max(best, lerp(z0, z1, (Y - y0) / (y1 - y0))); }
    return isFinite(best) ? best : bodyAt(S, X).zt;
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
    // floor-edge concept 1: the outer edge rolls up and inboard into a scroll (never beyond the floor's half width), from behind
    // the leading edge to ahead of the diffuser kink
    const sc = S.cw("floorEdge", [0, 1]) * ss(F.xLead + 120, F.xLead + 420, X) * (1 - ss(F.xKink - 320, F.xKink - 60, X));
    const zl = Math.max(ze + 36, 40);
    return [
      [0, kz], [yk - 10, kz], [yk, kz + 6], [yk + 6, Math.max(kz + 7, roof - 10)], [yk + 18, roof], [lerp(yk, yt, 0.5), roof], [yt - 18, roof], [yt - 6, roof - 10],
      [yt, Math.max(ze + 6, 12)], [yt + 8, ze], [ye - 26, ze], [ye - 8 + 6 * sc, ze + 4 + 6 * sc], [ye, ze + 18 + 30 * sc], [ye - 2 - 10 * sc, ze + 34 + 52 * sc],
      [ye - 16 - 26 * sc, zl + 44 * sc], [ye - 60 - 4 * sc, Math.max(ze + 30, Math.min(zTop, 44)) + 8 * sc], [yt, zTop], [yk, zTop + 2], [0, zTop + 3],
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
    // floor-edge concept 1: four fences standing on the scrolled edge ahead of the rear tyre, toed out, and a second edge wing
    const aE = S.cw("floorEdge", [0, 1]);
    if (aE > 0.02) {
      const Mfn = m3.mesh(), x1 = F.xStep - 420, x0 = Math.max(F.xMax + 150, x1 - 1100);
      for (let i = 0; i < 4; i++) {
        const xc = lerp(x0, x1, i / 3), y0 = floorHalfW(S, xc) - 44 - 10 * i, c = 170 - 12 * i, h = (70 + 22 * i) * aE, rs = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8, x = xc - c / 2 + c * t, y = y0 + 34 * t * t, top = 40 + h * Math.sin(Math.PI * Math.min(1, 0.12 + 0.95 * t)), th = 2.5 + 1.5 * Math.sin(Math.PI * t);
          rs.push(m3.roundPoly([[y - th, 30, 1.5], [y + th, 30, 1.5], [y + th, top, 2], [y - th, top, 2]], 2).map(([yy, zz]) => W(S, x, yy, zz))); }
        m3.loft(Mfn, rs, { wrap: true, capA: true, capB: true, solid: true });
      }
      const fo = m3.foil(0.08, 0.4, 0.1, 14, 0.01), xw = lerp(x0, x1, 0.5), yA = floorHalfW(S, xw) - 150, yB = floorHalfW(S, xw) - 20, ws = [];
      for (let k = 0; k <= 6; k++) ws.push(m3.placeFoil(fo.ring, [xw - 60, 96 + 60 * aE + 10 * k / 6], 210 * Math.max(0.2, aE), rad(-10), 0, null).map(([x, z]) => W(S, x, lerp(yA, yB, k / 6), z)));
      m3.loft(Mfn, ws, { wrap: true, capA: true, capB: true, solid: true });
      items.push(withMirror(item("floor_edge_fences", "floor", "carbon", Mfn)));
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
    // style concept: the setting holds at the centre (the dimensioned angle); low-drag "spoon" washes out towards the tips (flaps
    // ~9° flatter at the endplates) and lifts them (a spoon seen from behind); high-downforce washes in (+6°); medium is flat. The
    // X extent stays the chord at every station (chainSection keeps it for any angle).
    const rw = S.rw, ay = Math.abs(y), u2 = Math.pow(clamp(ay / 575, 0, 1), 2), aoa = Math.max(1, rw.aoa + S.cw("rwStyle", [-9, 0, 6]) * u2);
    const els = chainSection(rw.chord, rw.n, aoa), x0 = S.XR + DIM.rw.x0;
    let zmin = Infinity, zmax = -Infinity; for (const p of sectionPolys(els, 0, 0, 0)) for (const q of p.pts) { zmin = Math.min(zmin, q[1]); zmax = Math.max(zmax, q[1]); }
    const zb = DIM.rw.zMin + (DIM.rw.zMinTip - DIM.rw.zMin) * clamp((ay - 150) / 425, 0, 1) + 2 + S.cw("rwStyle", [70, 0, 0]) * u2;
    let z0 = zb - zmin; const top = Math.min(rw.E, DIM.rw.zMax) - 12; if (z0 + zmax > top) z0 = top - zmax;   // stays under the endplate top
    const last = els[els.length - 1], te = [x0 + last.le[0] + last.c * Math.cos(last.a), z0 + last.le[1] + last.c * Math.sin(last.a)];
    return { y, c: rw.chord, els, x0, z0, pivot: te };
  }
  // loft one element across stations; returns { top, bot, te } meshes (upper surface, lower surface + end caps, trailing-edge face)
  function elementMeshes(stations, ei, d, mapPt, outs) {
    const rings = [];
    for (const st of stations) { const sp = sectionPolys(st.els, st.x0, st.z0, d(st), st.pivot)[ei]; rings.push(sp.pts.map(([x, z]) => mapPt(x, st.y, z))); }
    const n = rings[0].length, le = n >> 1, mid = stations[Math.floor(stations.length / 2)];
    // a point inside the section: midway between the upper and lower surfaces at mid-chord (the centroid of the ring's points can
    // fall outside a strongly cambered flap, which would wind its surfaces inside out)
    const inside = (() => { const sp = sectionPolys(mid.els, mid.x0, mid.z0, d(mid), mid.pivot)[ei], q = sp.pts, h = le >> 1, a = q[h], b = q[le + h]; return mapPt((a[0] + b[0]) / 2, mid.y, (a[1] + b[1]) / 2); })();
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
      items.push(item("fw_el" + ei + "_top", "front_wing", "paint", outs.top, { role: flap ? "fwFlap" : "fwMain", proj: "fwTop", flap: fl }));
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
    // endplate concept: 0 open (outwash): a low plate just over the flap tips, its trailing edge flared outboard, a wide footplate;
    // 1 closed (inwash): the full-height plate (RV-FWEP-BODY top plane to Z 375) joined to the flap tips, its top curled inboard
    const cE = S.cw("fwEndplate", [0, 1]);
    const Fd = DIM.fw, xf = fwFront(Math.min(h + 6, 675)) - 4, epTopC = Math.max(Fd.epZ1, zTopEl + 24), epTopO = Math.min(epTopC, Math.max(Fd.epZ0 + 130, zTopEl + 22));
    const epTop = lerp(epTopO, epTopC, cE);
    const topZ = (x) => Math.min(epTop, Math.max(Fd.epZ1 - 125, Fd.epZ1 + (x + 750) * 125 / 300 + (epTop - Fd.epZ1)));
    const arcX = (z) => -Math.sqrt(Math.max(0, Fd.arcR * Fd.arcR - Math.pow(z - Fd.arcZ, 2))) - 8;
    const xr = (z) => Math.max(arcX(Math.min(z, Fd.arcZ)), xTe + 30);
    const outline = [];
    outline.push([xf, Fd.epZ0 + 6]); for (let k = 0; k <= 10; k++) { const x = lerp(xf, xr(epTop) - 30, k / 10); outline.push([x, Math.max(Fd.epZ0 + 40, topZ(x))]); }
    for (let k = 0; k <= 12; k++) { const z = lerp(epTop, Fd.epZ0, k / 12); outline.push([xr(z), z]); }
    const ol = m3.roundPoly(outline.map((p, i) => [p[0], p[1], i === 0 || i === outline.length - 1 ? 14 : 4]), 3).map(([x, z]) => [(1750 - x) / 1000, (z + 10 + S.rh) / 1000]);
    const Mep = m3.mesh(); m3.slab(Mep, ol, m3.frameXY((h + 6) / 1000), 0.010, 0.0045, 4);
    // open: flare the rear third outboard (up to 70 mm, inside RV-FWEP's |Y|); closed: lean the upper part inboard by 26 mm
    { const P = Mep.P, xR0 = (1750 - lerp(xf, xr(Fd.epZ0), 0.62)) / 1000, xR1 = (1750 - xr(Fd.epZ0)) / 1000, z0w = (Fd.epZ0 + 10 + S.rh) / 1000, z1w = (epTopC + 10 + S.rh) / 1000;
      for (let i = 0; i < P.length; i += 3) { const fl = (1 - cE) * 0.07 * Math.pow(clamp((xR0 - P[i]) / Math.max(1e-3, xR0 - xR1), 0, 1), 1.6), lean = cE * 0.026 * Math.pow(clamp((P[i + 1] - z0w) / (z1w - z0w), 0, 1), 2); P[i + 2] += fl - lean; } }
    items.push(...pair(item("fw_endplate", "front_wing", "paint", Mep, { role: "fwEnd", proj: "fwEnd" })));
    // closed: the inboard curl along the top edge (a cambered lip, 70 mm wide, turned down at its inner edge)
    if (cE > 0.02) {
      const Mc = m3.mesh(), rs = [], w = 70 * cE, yT = h + 6 - 26 * cE;
      for (let k = 0; k <= 14; k++) { const x = lerp(xf + 60, xr(epTop) - 50, k / 14), z = Math.max(Fd.epZ0 + 40, topZ(x)) - 3;
        rs.push([[yT + 4, z + 2], [yT - w * 0.6, z + 6], [yT - w, z - 10 * cE], [yT - w + 3, z - 16 * cE], [yT - w * 0.6, z], [yT + 4, z - 5]].map(([y, zz]) => W(S, x, y, zz))); }
      m3.loft(Mc, rs, { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("fw_endplate_curl", "front_wing", "paint", Mc, { role: "fwEnd", proj: "fwEnd" })));
    }
    // outer footplate (RV-FWEP-OFP: Z 75..170 to |Y| 900): a curved strip outboard of the plate, turned down at its edge (open:
    // wider, swept outboard at the rear)
    {
      const Mf = m3.mesh(), rs = [], yo = Math.min(Fd.ofpY, h + lerp(205, 120, cE));
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
      // short high nose: the blades rake back up to the nose's underside behind its tip (the wing hangs on them)
      const sh = S.cw("nose", [0, 1]), xn0 = lerp(xa + 10, S.noseTip + 50, sh), xn1 = lerp(xb + 30, S.noseTip + 300, sh);
      const ol = m3.roundPoly([[xa, za, 6], [xb, zb, 6], [xn1, nb(xn1), 20], [xn0, nb(xn0), 20]], 3);
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
        items.push(item(nm + "_top", "rear_wing", "paint", outs.top, { role: flap ? "rwFlap" : "rwMain", proj: "rwTop", flap: flg }));
        items.push(item(nm + "_bot", "rear_wing", "carbon", outs.bot, { flap: flg }));
        items.push(item(nm + "_te", "rear_wing", "carbon", outs.te, { flap: flg }));
        // gurney on the last element's trailing edge (style: none on the spoon, 6 mm medium, 16 mm high-downforce)
        const gh = S.cw("rwStyle", [0, 6, 16]);
        if (ei === rw.n - 1 && gh > 0.4) {
          const Mg = m3.mesh(), rs = stations.map((st) => {
            const e = st.els[ei], a = e.a - (e.flap ? d(st) : 0), sp = sectionPolys(st.els, st.x0, st.z0, d(st), st.pivot)[ei], te = sp.pts[0], dir = [Math.cos(a), Math.sin(a)], nr = [-Math.sin(a), Math.cos(a)];
            return [[te[0], te[1]], [te[0] - 3 * dir[0], te[1] - 3 * dir[1]], [te[0] - 3 * dir[0] + gh * nr[0], te[1] - 3 * dir[1] + gh * nr[1]], [te[0] + gh * nr[0], te[1] + gh * nr[1]]].map(([x, z]) => mapPt(x, st.y, z));
          });
          m3.loft(Mg, rs, { wrap: true, capA: true, capB: true, solid: true });
          items.push(item(nm + "_gurney", "rear_wing", "carbon", Mg, { flap: flg }));
        }
      });
    }
    if (o && o.flapOnly) return items;
    // endplates (RV-RWEP-BODY): upper part at |Y| = span/2 + 8 up to the endplate-top parameter, swept in below Z 700 to |Y| 360
    // at Z 250; leading edge XR+160 above Z 700, raked back to XR+375 at Z 250; trailing edge XR+740 above Z 625, to XR+625 at Z 250
    {
      // style: the spoon's endplate is cut away (its swept-in lower part stops at Z ~500, its top-front corner trimmed back), the
      // high-downforce plate keeps the full RV-RWEP-BODY shape and carries three strakes on its outer face
      const E = rw.E, R = DIM.rw, t = 14, yTop = h + 8, sp0 = S.cw("rwStyle", [1, 0, 0]), lowZ = lerp(R.epLowZ, 500, sp0);
      const notch = (z) => sp0 * 110 * sstep((z - (E - 150)) / 120);
      const xf = (z) => S.XR + (z >= 700 ? 160 : 160 + (700 - z) * 215 / 450) + notch(z), xr = (z) => S.XR + (z >= 625 ? 740 : 625 + (z - 250) * 115 / 375);
      const yc = (z) => (z >= 690 ? yTop : z <= 420 ? Math.min(yTop, R.epLowY) : lerp(Math.min(yTop, R.epLowY), yTop, sstep((z - 420) / 270)));
      const rs = [], zs = []; for (let k = 0; k <= 34; k++) zs.push(lerp(lowZ, E, k / 34));
      zs.push(E + 0.0001);
      for (const z of zs.slice(0, -1)) { const a = (xr(z) - xf(z)) / 2, cx = (xr(z) + xf(z)) / 2; rs.push(m3.superellipse(a, t / 2, 5, 28).map(([u, v]) => W(S, cx + u, yc(z) + v, z))); }
      // a rounded top edge: two shrinking rings
      for (const [dz, k] of [[4, 0.7], [7, 0.3]]) { const z = E - 7 + dz, a = (xr(E) - xf(E)) / 2 - 3 * (1 - k), cx = (xr(E) + xf(E)) / 2; rs.push(m3.superellipse(a, t / 2 * k, 5, 28).map(([u, v]) => W(S, cx + u, yTop + v, z))); }
      rs[rs.length - 3] = rs[rs.length - 3].map((p) => [p[0], (E - 7 + 10 + S.rh) / 1000, p[2]]);
      const Me = m3.mesh(); m3.loft(Me, rs, { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("rw_endplate", "rear_wing", "paint", Me, { role: "rwEnd", proj: "rwEnd" })));
      // lateral safety / ERS light strip on the endplate's trailing edge (2026)
      const Ml = m3.mesh(), rl = [];
      for (let k = 0; k <= 6; k++) { const z = lerp(E - 240, E - 40, k / 6); rl.push(m3.superellipse(5, 3.5, 2, 8).map(([u, v]) => W(S, xr(z) + 2 + u, yTop + t / 2 + 1 + v, z))); }
      m3.loft(Ml, rl, { wrap: true, capA: true, capB: true, solid: true });
      items.push(...pair(item("rw_light", "rear_wing", "led", Ml)));
      const hd = S.cw("rwStyle", [0, 0, 1]);
      if (hd > 0.02) {
        const Ms = m3.mesh();
        for (const [z, c] of [[E - 90, 300], [E - 150, 260], [E - 210, 220]]) {
          const xa = xf(z) + 40, rr = []; for (let k = 0; k <= 8; k++) { const x = xa + c * k / 8, w = 48 * hd * Math.sin(Math.PI * Math.min(1, 0.1 + 0.9 * k / 8)) + 1; rr.push([[yTop + t / 2 - 1, z - 3], [yTop + t / 2 + w, z - 3 - 0.2 * w], [yTop + t / 2 + w, z + 2 - 0.2 * w], [yTop + t / 2 - 1, z + 3]].map(([y, zz]) => W(S, x, y, zz))); }
          m3.loft(Ms, rr, { wrap: true, capA: true, capB: true, solid: true });
        }
        items.push(...pair(item("rw_endplate_strakes", "rear_wing", "carbon", Ms)));
      }
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
    // RB22 (photos): black rims with a thin blue band on the outer lip, a fluorescent wheel nut
    const Mlip = m3.mesh(); m3.lathe(Mlip, [[231, rimH + 0.8], [249.2, rimH + 0.8], [249.4, rimH - 3]].map(([r, a]) => mm(r, a)), C0, ax, ref, 96, { inside: [C0[0], C0[1], C0[2] - 1] });
    items.push(item("rim", part, "rim", Mr, { look: "mg_az80a" }), item("rim_spokes", part, "rim", Ms, { look: "mg_az80a" }), item("rim_lip", part, "rimLip", Mlip, { look: "mg_az80a" }), item("wheel_nut", part, "nut", Mn, { look: "ti64" }));
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
      // aero-faired carbon legs (RB22 photos: broad, near-horizontal front wishbones)
      for (const [o, i1, i2, c] of [[pts.lbj, pts.lf, pts.lr, 0.078], [pts.ubj, pts.uf, pts.ur, 0.066]]) { blade(Mw, o, i1, c, 0.019); blade(Mw, o, i2, c, 0.019); }
      blade(Mr, pts.pr0, pts.pr1, 0.052, 0.024);                  // push rod
      blade(Mr, pts.tr0, pts.tr1, 0.050, 0.018);                  // track (front) / toe (rear) rod
      if (rear) rod(Mr, pts.ds0, pts.ds1, 0.022);                 // driveshaft
      // upright: a block between the ball joints (inside the rim)
      const up = [pts.lbj, m3.v3.lerp3(pts.lbj, pts.ubj, 0.5), pts.ubj];
      m3.sweep(Mu, up, () => m3.roundPoly([[-1, -1, 0.3], [1, -1, 0.3], [1, 1, 0.3], [-1, 1, 0.3]], 2).map(([u, v]) => [u * 0.05, v * 0.03]), { up: [0, 0, 1], fixedUp: true });
      items.push(...pair(item("wishbones" + (rear ? "_r" : "_f"), part, "carbon", Mw, { carbon: "matte" })));
      items.push(...pair(item("rods" + (rear ? "_r" : "_f"), part, "carbon", Mr, { carbon: "matte" })));
      items.push(...pair(item("upright" + (rear ? "_r" : "_f"), part, "metal", Mu, { look: "ti64" })));
    };
    const X0 = fr.X, Y0 = fr.Y;
    // front concept: pushrod (the RB22's: rod from the lower wishbone's outer end up to a rocker high on the chassis) or pullrod (rod
    // from the upper wishbone's outer end down to a rocker low on the chassis); the rod's ends move continuously between the two
    const pl = S.cw("frontSusp", [0, 1]), mixP = (a, b) => [lerp(a[0], b[0], pl), lerp(a[1], b[1], pl), lerp(a[2], b[2], pl)];
    corner(fr, {
      lbj: Gd(X0 - 10, Y0 - 150, 170), ubj: Gd(X0 + 18, Y0 - 168, 540), lf: W(S, X0 - 330, 150, 120), lr: W(S, X0 + 330, 180, 108), uf: W(S, X0 - 240, 165, 420), ur: W(S, X0 + 270, 190, 440 + 40 * pl),
      pr0: mixP(Gd(X0 + 2, Y0 - 185, 196), Gd(X0 + 30, Y0 - 196, 520)), pr1: mixP(W(S, X0 + 70, 120, 552), W(S, X0 + 300, 150, 120)), tr0: Gd(X0 - 110, Y0 - 160, 470), tr1: W(S, X0 - 95, 178, 418),
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
      // halo (black on the RB22): rear legs on the cockpit rim beside the headrest, hoop at helmet-top height, the centre pillar
      // down onto the chassis ahead of the cockpit; a faired (wider, flatter) top bar
      const zt = (x) => bodyAt(S, x).zt, hr = XC - CK.haloRear, hf = XC - CK.haloPillar;
      const hoopR = [[hr, 318, zt(hr) - 6], [hr - 90, 326, 788], [hr - 260, 318, 826], [hr - 470, 268, 840], [hr - 640, 180, 842], [hr - 740, 86, 838], [hr - 776, 0, 836]];
      const pts = hoopR.concat(hoopR.slice(0, -1).reverse().map(([x, y, z]) => [x, -y, z]));
      const path = m3.catmull(pts, 7).map(Wp);
      const Mh = m3.mesh(); m3.sweep(Mh, path, (t) => { const top = Math.pow(Math.sin(Math.PI * t), 0.5); return m3.superellipse(lerp(0.024, 0.034, top), lerp(0.028, 0.02, top), 2.4, 20); }, { up: [0, 1, 0] });
      const pil = m3.catmull([[hr - 776, 0, 836], [hr - 840, 0, 818], [hf + 150, 0, zt(hf + 150) + 70], [hf, 0, zt(hf) - 6]], 7).map(Wp);
      m3.sweep(Mh, pil, (t) => m3.superellipse(lerp(0.024, 0.036, t), lerp(0.028, 0.018, t), 2.4, 20), { up: [0, 0, 1], fixedUp: true });
      items.push(item("halo", "halo", "paint", Mh, { role: "halo", proj: "halo" }));
    }
    // airbox + roll hoop: a tall section over the spine with the intake mouth at its front, the T-camera on top
    {
      // RB22 (photos): a big rounded intake over the driver's head with a thick lip (painted sun-yellow), the roll-hoop fairing
      // sweeping back into the engine cover's broad deck; the T-camera on a short pylon above the hoop
      // cooling concept: the intake mouth is the standard one, 1.3× larger (large airbox + gills) or 0.78× (compact)
      const ka = S.cw("cooling", [1, 1.3, 0.78]), lift = (ka - 1) * 70;
      const x0 = XC - CK.airbox, x1 = XC + 300, zb = (x) => bodyAt(S, x).zt - 90;
      const T = m3.table([x0, x0 + 60, x0 + 180, XC - 60, x1], { top: [1010 + 2 * lift, 1016 + 2 * lift, 996 + 1.5 * lift, bodyAt(S, XC - 60).zt + 30, bodyAt(S, x1).zt - 4], hw: [184 * ka, 186 * ka, 168 * ka, 146, 112] });
      const N = 44, mc = 872 + lift, mw = 148 * ka, mh = 112 * ka, mouth = (grow) => m3.superellipse(mw + grow, mh + grow, 2.5, N, -Math.PI / 2).map(([u, v]) => [u * (1 - 0.34 * Math.max(0, -v) / (mh + grow)), v]);   // narrower at the bottom
      const sec = (x) => { const t = T(x), b = zb(x), a = t.hw, h = (t.top - b) / 2; return m3.superellipse(a, h, 2.5, N, -Math.PI / 2).map(([u, v]) => [x, u * (1 - 0.12 * Math.max(0, v) / h), b + h + v]); };
      const blendR = (x, gr, k) => { const m = mouth(gr), s2 = sec(x); return m.map(([u, v], i) => [x, lerp(u, s2[i][1], k), lerp(mc + v, s2[i][2], k)]); };
      const rings = [mouth(0).map(([u, v]) => [x0 + 20, u, mc + v]), mouth(8).map(([u, v]) => [x0 + 5, u, mc + v]), mouth(18).map(([u, v]) => [x0, u, mc + v]), blendR(x0 + 12, 26, 0.45), blendR(x0 + 40, 30, 0.85)];
      for (let x = x0 + 70; x < x1; x += 30) rings.push(sec(x));
      rings.push(sec(x1).map((p) => [x1, p[1] * 0.4, Math.max(p[2] - 30, zb(x1) + 20)]));
      const Ma = m3.mesh(); m3.loft(Ma, rings.map(r => r.map(Wp)), { wrap: true, capB: true, solid: true });
      items.push(item("airbox", "engine_cover", "paint", Ma, { role: "body", proj: "main" }));
      const duct = [[x0 + 20, 1], [x0 + 130, 0.84], [x0 + 230, 0.55]].map(([x, k]) => mouth(0).map(([u, v]) => Wp([x, u * k, mc + v * k])));
      const Md = m3.mesh(); m3.loft(Md, duct, { wrap: true, capB: true, inside: Wp([x0 + 100, 0, mc]), flip: true });
      items.push(item("airbox_duct", "engine_cover", "interior", Md));
      // T-camera on its pylon (FIA camera housing, the "T" wing over the hoop)
      const tc = x0 + 120, tz = T(tc).top - 6, Mc = m3.mesh(), th = 62;
      m3.loft(Mc, [0, 1].map(k => m3.roundPoly([[tc - 40, tz - 10, 6], [tc + 36, tz - 10, 6], [tc + 22, tz + th, 4], [tc - 26, tz + th, 4]], 2).map(([x, z]) => Wp([x, k ? 9 : -9, z]))), { wrap: true, capA: true, capB: true, solid: true });
      const fo = m3.foil(0.02, 0.4, 0.16, 10, 0.03);
      const wr = []; for (let k = 0; k <= 6; k++) { const y = lerp(-118, 118, k / 6); wr.push(m3.placeFoil(fo.ring, [tc - 62, tz + th + 4], 128, rad(-3), 0, null).map(([x, z]) => Wp([x, y, z]))); }
      m3.loft(Mc, wr, { wrap: true, capA: true, capB: true, solid: true });
      for (const s of [-1, 1]) m3.loft(Mc, ellRings([tc - 48, tc - 40, tc, tc + 50, tc + 58], (x) => ({ cy: s * 118, cz: tz + th + 12, a: 15 * Math.sin(Math.PI * clamp((x - tc + 48) / 106, 0.08, 0.92)) + 2, b: 14 * Math.sin(Math.PI * clamp((x - tc + 48) / 106, 0.08, 0.92)) + 2, n: 2.4 }), 12).map(r => r.map(Wp)), { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("t_camera", "electronics", "tcam", Mc));
      // engine-cover fin (carries the race number on the RB22). Cover concept 0: a high shark fin from behind the airbox to just
      // ahead of the rear wing; 1 low narrow cover: no fin (a 6 mm spine strip)
      const fh = S.cw("cover", [1, 0]), fx0 = lerp(S.XR - 620, Math.max(S.XPU + 200, S.XR - 1150), fh), fx1 = S.XR + lerp(60, 130, fh), Mf = m3.mesh();
      const finH = (k) => 6 + (lerp(60, 170, fh) * fh) * Math.pow(Math.sin(Math.PI * 0.5 * Math.min(1, k / 8)), 1.6) * (1 - 0.3 * Math.max(0, k - 8) / 2);
      const fo2 = []; for (let k = 0; k <= 10; k++) { const x = lerp(fx0, fx1, k / 10); fo2.push([x, bodyAt(S, x).zt - 12]); }
      for (let k = 10; k >= 0; k--) { const x = lerp(fx0, fx1, k / 10); fo2.push([x, bodyAt(S, x).zt + 2 + finH(k)]); }
      m3.slab(Mf, fo2.map(([x, z]) => [(1750 - x) / 1000, (z + 10 + S.rh) / 1000]), m3.frameXY(0), 0.008, 0.0035, 2);
      items.push(item("fin", "engine_cover", "paint", Mf, { role: "fin", proj: "main" }));
    }
    // mirrors (C3.7.5): housing ahead of the sidepod, glass facing back, inner stay to the chassis, rear stay to the sidepod
    {
      // RB22 (photos): a wide flat black housing above the inlet's leading edge, an inner stay to the chassis and a rear stay down
      // onto the sidepod's top
      const mx = XC - CK.mirror, my = Math.max(500, S.pod.Yc + 70), mz = Math.max(720, S.pod.Ztop + 70), Mm = m3.mesh(), Mg = m3.mesh(), Mst = m3.mesh(), hw = 104;
      const ys = []; for (let k = 0; k <= 12; k++) ys.push(lerp(my - hw, my + hw, k / 12));
      const rings = ys.map((y) => { const t = (y - (my - hw)) / (2 * hw), e = Math.pow(Math.sin(Math.PI * clamp(t, 0.02, 0.98)), 0.35); return m3.superellipse(40 * (0.5 + 0.5 * e), 34 * (0.55 + 0.45 * e), 3.2, 22).map(([u, v]) => [mx + u + 8 - 0.12 * v, y, mz + v]); });
      m3.loft(Mm, rings.map(r => r.map(Wp)), { wrap: true, capA: true, capB: true, solid: true });
      const gl = m3.roundPoly([[my - hw + 10, mz - 27, 10], [my + hw - 10, mz - 27, 10], [my + hw - 10, mz + 27, 10], [my - hw + 10, mz + 27, 10]], 3);
      m3.loft(Mg, [gl.map(([y, z]) => Wp([mx + 47, y, z])), gl.map(([y, z]) => Wp([mx + 50, y, z]))], { wrap: true, capA: true, capB: true, solid: true });
      const yc = bodyAt(S, mx + 30).yw - 14, zc = bodyAt(S, mx + 30).zt - 40;
      m3.sweep(Mst, [[mx + 14, my - hw + 20, mz - 8], [mx + 22, (my - hw + yc) / 2, mz - 18], [mx + 30, yc, zc]].map(Wp), () => m3.superellipse(0.02, 0.006, 2.2, 10), { up: [0, 1, 0] });
      m3.sweep(Mst, [[mx + 26, my + 30, mz - 30], [mx + 70, my + 20, (mz + S.pod.Ztop) / 2 - 10], [S.pod.X + 70, my + 6, S.pod.Ztop - 4]].map(Wp), () => m3.superellipse(0.018, 0.006, 2.2, 10), { up: [0, 1, 0] });
      items.push(...pair(item("mirror", "misc", "paint", Mm, { role: "mirror", proj: "main" })));
      items.push(...pair(item("mirror_glass", "misc", "mirror", Mg)));
      items.push(...pair(item("mirror_stays", "misc", "carbon", Mst)));
    }
    // driver: helmet (livery helmet design, cylindrical u around the head, v down from the crown), visor, HANS / shoulders, headrest
    {
      const hx = XC - CK.helmet, hz = 712, Mh = m3.mesh(), xs = [];
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
      for (const s of [-1, 1]) { const pr = []; for (let k = 0; k <= 10; k++) { const x = lerp(hx - 110, XC - CK.open1 - 14, k / 10), y = s * (Math.max(120, cwR(x) - 34)); pr.push([x, y, bodyAt(S, x).zt - 14 + 10 * Math.sin(Math.PI * k / 10)]); }
        m3.sweep(Mp, pr.map(Wp), (t) => m3.superellipse(0.026 * (0.7 + 0.3 * Math.sin(Math.PI * t)), 0.03, 3, 14), { up: [0, 1, 0] }); }
      const hb = XC - CK.open1 - 90; m3.loft(Mp, ellRings([hb - 40, hb - 25, hb + 30, hb + 45], (x) => ({ cy: 0, cz: bodyAt(S, hb).zt + 4, a: 150 * (x > hb - 30 && x < hb + 40 ? 1 : 0.85), b: 60, n: 3 }), 20).map(r => r.map(Wp)), { wrap: true, capA: true, capB: true, solid: true });
      items.push(item("headrest", "seat_safety", "interior", Mp, { soft: true }));
      // steering wheel (flat, grips, display)
      const sx = XC - CK.wheel, sz = 580, Mw = m3.mesh(), Md = m3.mesh();
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
      // cooling concept: exit size standard / 1.3× (large airbox + gills) / 0.6× (compact)
      const ox = S.XR - 40, ob = bodyAt(S, ox), Mo = m3.mesh(), Ml2 = m3.mesh(), ke = S.cw("cooling", [1, 1.3, 0.6]);
      const ring = (g, dz, k) => m3.superellipse((ob.ys + 34) * k * Math.sqrt(ke) + g, 46 * k * Math.sqrt(ke) + g, 2.4, 28).map(([y, z]) => Wp([ox + 6 - dz, y, ob.zt - 34 + z + dz * 0.4]));
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
      // tailpipe (C3.9) exiting just above the crash structure's tail, under the rear wing
      const ez = bodyAt(S, S.XR + 440).zt + 38, xp = S.XR + 520;
      m3.lathe(Mx, [[0.047, -0.001], [0.047, 0.24], [0.051, 0.25], [0.051, 0.255], [0.043, 0.25]], Wp([xp, 0, ez]), [1, 0, 0], [0, 1, 0], 28, { inside: Wp([xp - 130, 0, ez]) });
      m3.lathe(Mxi, [[0.044, 0.248], [0.044, 0.18]], Wp([xp, 0, ez]), [1, 0, 0], [0, 1, 0], 28, { inside: Wp([xp - 130, 0, ez + 32]) });
      items.push(item("exhaust", "pu_electronics", "metal", Mx, { look: "inconel_718" }), item("exhaust_inner", "pu_electronics", "black", Mxi));
    }
    return items;
  }

  // ---------------------------------------------------------------- groups
  // a group = one rebuild unit; key = the spec values its geometry depends on
  // the body's shape families (nose, cover) reach every group that sits on the body
  const bodyCC = (S) => [S.cc.nose, S.cc.cover];
  const GROUPS = {
    body: { parts: ["survival_cell", "nose", "engine_cover", "rear_impact"], key: (S) => [S.XA, S.XC, S.XPU, S.XR, S.rh, bodyCC(S)], build: buildBody },
    sidepods: { parts: ["sidepods", "cooling"], key: (S) => [S.XA, S.XC, S.XPU, S.XR, S.rh, S.sp.inlet, S.sp.u, S.floor.throat, S.cc.sidepods, S.cc.cooling, S.cc.cover], build: buildSidepods },
    floor: { parts: ["floor"], key: (S) => [S.XA, S.XC, S.XPU, S.XR, S.rh, S.floor.W, S.floor.throat, S.floor.deg, S.cc.floorEdge], build: buildFloor },
    diffuser: { parts: ["diffuser"], key: (S) => [S.XR, S.rh, S.floor.W, S.floor.throat, S.floor.deg], build: buildDiffuser },
    front_wing: { parts: ["front_wing"], key: (S) => [S.fw, S.rh, S.XA, S.cc.fwEndplate, S.cc.nose], build: buildFrontWing, flap: true },
    rear_wing: { parts: ["rear_wing"], key: (S) => [S.rw, S.XR, S.rh, S.cc.rwStyle, S.cc.cover], build: buildRearWing, flap: true },
    wheels: { parts: ["wheels_front", "wheels_rear", "brakes_front", "brakes_rear"], key: (S) => [S.XR], build: buildWheels },
    suspension: { parts: ["front_suspension", "rear_suspension"], key: (S) => [S.XR, S.rh, S.cc.frontSusp], build: buildSuspension },
    details: { parts: ["halo", "misc", "driver", "electronics", "pu_electronics", "seat_safety"], key: (S) => [S.XA, S.XC, S.XPU, S.XR, S.rh, S.sp.inlet, S.cc.sidepods, S.cc.cooling, bodyCC(S)], build: buildDetails },
  };
  function groupKey(id, S) { return JSON.stringify(GROUPS[id].key(S)); }
  function buildGroup(id, S, o) {
    const t0 = Date.now(); const items = GROUPS[id].build(S, o || {});
    return { id, key: groupKey(id, S), items, ms: Date.now() - t0 };
  }
  function buildAll(S, o) { const out = {}; for (const id of Object.keys(GROUPS)) out[id] = buildGroup(id, S, o); return out; }

  const api = { DIM, CK, GROUPS, spec, buildGroup, buildAll, groupKey, floorHalfW, floorRoof, bodyAt, cockpitAt, superArea, W, Gd, mirrorGeo, mergeGeo, chainSection, sectionPolys, fwStation, rwStation, CONCEPTS, conceptCode, conceptCodes, conceptWeights };
  C.car3d = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
