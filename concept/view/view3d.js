// PURPLE CONCEPT - the 3D view of the CONCEPT car: a procedural 2026-style F1 car built from a Design's shape parameters
// (concept/parts.js), in true metres, so the optimiser's changes read as a different kind of car. Schematic, not a CAD model:
// every surface is a loft of simple sections placed by the parameters; nothing here is a measured or tested shape.
//
// Contract (the lab page embeds this; mirrors lab/car3d.js conventions: dark studio, honesty label in the view, reduced motion, dispose):
//   const v = EI.conceptView.mount(containerEl, opts?)
//   v.setDesign(design, { baseline?, animate?, mass? }) -> { ms }   rebuild from design.params. baseline: a Design (ghost the parts that
//        differ from it, purple), null (clear), undefined (keep). animate (default true): morph from the previous design over 450 ms
//        (off under prefers-reduced-motion). mass: a mass sheet (bench(design).mass) for x-ray; default parts.massSheet(design.params).
//   v.setHighlight([partId])  catalogue part ids (front_wing, rear_wing, floor, sidepods, ...) tinted amber; [] clears
//   v.setMode('solid' | 'xray-mass')   x-ray: bodywork translucent, every mass-sheet row a sphere (volume ∝ mass, colour = mass), CoG marker
//   v.setView('hero' | 'front34' | 'rear34' | 'side' | 'top' | 'front' | 'rear', { animate })
//   v.setAero('cycle' | 'corner' | 'straight')   straight-mode flap state when the design uses it (cycle: 400 ms swing every few s)
//   v.screenshot() -> PNG data URL (the honesty label and legend are drawn into the image)
//   v.labelText() -> the in-view label;  v.stats() -> { ms, geometries, textures, meshes };  v.dispose()
// Needs THREE r128 (vendor/three.min.js) and concept/regs.js, parts.js (aeromap.js + design.js for the page's legality list).
// Dual: window.EI.conceptView, and module.exports (layout() and the parameter-effect table work in Node without three).
// No network, no Mubit.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const parts = req("parts", "../parts.js");

  const LABEL = "concept geometry from the design parameters · schematic, not a CAD model";
  const DEFAULTS = {
    background: 0x0a0a0c,   // DESIGN_SYSTEM --bg
    ghostColor: 0xb26cff,   // --purple: the baseline
    highlightColor: 0xfbbf24, // --amber: parts named by setHighlight
    exaggerate: 1,          // display gain on ride height and wing-setting deltas vs the baseline car; 1 = true geometry (stated in the label if not 1)
    orbit: true,            // idle sway about the view (off under reduced motion) + drag to orbit, wheel to zoom, double-click for the hero
    label: true, legend: true,
    view: "hero", mode: "solid", aero: "cycle",
    pixelRatioCap: 2,
    shadows: true,
  };
  // what each shape parameter visibly drives (kept honest: CONCEPT.md lists the params; parameters with no geometry say so)
  const EFFECTS = {
    "layout.wheelbase_mm": "rear axle, floor, sidepod and engine-cover length, rear wing / diffuser position",
    "survival_cell.front_axle_offset_mm": "monocoque front (XA) relative to the front axle: nose and cell move",
    "survival_cell.cockpit_len_mm": "cockpit rear (XC): cockpit opening, halo, airbox, sidepod inlets move",
    "survival_cell.bulkhead_gap_mm": "ICE face (XPU): engine-cover shoulders and sidepod length",
    "front_wing.span_mm": "front wing element span and endplate position", "front_wing.chord_mm": "front wing X extent (all elements)",
    "front_wing.aoa_deg": "front wing element angles (schematic angle scale)", "front_wing.elements": "number of front wing elements",
    "front_wing.sm_delta_deg": "front flap straight-mode swing + white outline",
    "rear_wing.span_mm": "rear wing span and endplate position", "rear_wing.chord_mm": "rear wing X extent", "rear_wing.aoa_deg": "rear wing element angles (schematic angle scale)",
    "rear_wing.elements": "number of rear wing elements", "rear_wing.endplate_top_mm": "rear endplate top height", "rear_wing.sm_delta_deg": "rear flap straight-mode swing + white outline",
    "floor.width_mm": "floor planform width and edge, diffuser width", "floor.throat_mm": "venturi tunnel roof height (seen through the inlets, the diffuser and in x-ray)",
    "floor.ride_height_mm": "body height above the ground (wheels stay)", "diffuser.expansion_deg": "diffuser ramp angle and exit height",
    "sidepods.inlet_cm2": "inlet mouth size and sidepod front bulk", "sidepods.undercut_mm": "depth of the cut under the sidepod's outer edge",
    "ballast.x_frac": "no bodywork: ballast sphere position in x-ray mass mode", "ballast.extra_kg": "no bodywork: ballast sphere size in x-ray mass mode",
  };
  // fixed dimensions (mm) that are not design parameters: estimates of a 2026-style car (PhysicalCar tracks, 18-inch wheels)
  const FIX = { trackF: 1580, trackR: 1520, tyreR: 353, rimR: 232, tyreWF: 305, tyreWR: 375, CX: 1700, floorTop: 85 };
  // mass-sheet rows that sit off the centre plane are drawn as a mirrored pair (y in mm; parts.js uses the same offsets for Izz)
  const PAIR_Y = { wheels_front: 790, wheels_rear: 760, brakes_front: 700, brakes_rear: 700, front_suspension: 500, rear_suspension: 500, sidepods: 550, cooling: 500, pu_mguk: 120, pu_electronics: 150 };
  // which visual part a catalogue id highlights (ids without geometry of their own point at what they move)
  const HIGHLIGHT_ALIAS = { layout: ["wheels_rear", "floor", "engine_cover"], survival_cell: ["survival_cell", "nose", "halo"], diffuser: ["diffuser"], ballast: [] };
  // x-ray mass ramp: one hue (cyan), dark = light parts, bright = heavy (sequential, reads on the black studio)
  const RAMP = ["#173840", "#1f5a66", "#2b8394", "#4fb6c8", "#9be9f5"];

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const rad = d => d * Math.PI / 180;
  // piecewise-linear lookup over [[x, ...values]] sorted by x
  function pw(stations, x) {
    if (x <= stations[0][0]) return stations[0].slice(1);
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1], b = stations[i];
      if (x <= b[0]) { const t = (x - a[0]) / Math.max(1e-9, b[0] - a[0]); const out = []; for (let k = 1; k < a.length; k++) out.push(lerp(a[k], b[k], t)); return out; }
    }
    return stations[stations.length - 1].slice(1);
  }

  // ---------------------------------------------------------------- layout: everything the geometry needs, in mm (FIA car frame)
  // x rearward from the front axle (XF=0), y from the centre plane, z up from the reference plane Z=0. Pure: no three.js.
  function layout(params, opts) {
    const g = parts.geometry(params), p = params, gain = (opts && opts.exaggerate) || 1, B = (opts && opts.base) || null;
    const ex = (v, b) => (gain === 1 || b == null ? v : b + gain * (v - b));
    const fw = p.front_wing, rw = p.rear_wing, fl = p.floor;
    const XA = g.XA, XC = g.XC, XPU = g.XPU, XR = g.XR, d = Math.max(400, XR - XPU);
    const W = fl.width_mm, throat = fl.throat_mm, deg = p.diffuser.expansion_deg;
    const x0 = XR - g.floor_len_mm, xd = XR - 550, xe = XR + 280, xt = x0 + 0.45 * (xd - x0);
    const L = {
      XA, XC, XPU, XR, d, rh: ex(fl.ride_height_mm, B && B.floor.ride_height_mm),
      fw: { span: fw.span_mm, chord: fw.chord_mm, n: Math.round(fw.elements), aoa: ex(fw.aoa_deg, B && B.front_wing.aoa_deg), sm: fw.sm_delta_deg, le: -1225, z0: 85 },
      rw: { span: rw.span_mm, chord: rw.chord_mm, n: Math.round(rw.elements), aoa: ex(rw.aoa_deg, B && B.rear_wing.aoa_deg), sm: rw.sm_delta_deg, E: rw.endplate_top_mm, cx: XR + 398, z0: 690 },
      floor: { W, throat, x0, xt, xd, xe, deg, inletZ: 290 },
      sp: { inlet: p.sidepods.inlet_cm2, u: p.sidepods.undercut_mm },
    };
    // venturi tunnel roof height above Z=0 along x: inlet -> throat (smooth), flat throat, diffuser ramp at the expansion angle
    L.roof = x => x <= xt ? lerp(L.floor.inletZ, throat, sstep((x - x0) / (xt - x0))) : x <= xd ? throat : throat + (x - xd) * Math.tan(rad(deg));
    // centre body (nose + survival cell + engine cover): [x, half width, bottom z, top z]
    const xt0 = L.fw.le + 40;
    L.nose = [[xt0, 40, 175, 245], [xt0 + 200, 70, 160, 320], [XA - 400, 120, 140, 450], [XA, 165, 120, 545]];
    L.cell = [[XA, 165, 120, 545], [XA + 450, 215, 70, 600], [XC - 900, 300, 55, 625], [XC - 450, 390, 50, 640], [XC, 420, 50, 645], [XPU, 395, 50, 640]];
    L.cover = [[XPU, 395, 50, 640], [XPU + 0.45 * d, 320, 55, 600], [XPU + 0.8 * d, 230, 70, 520], [XR, 170, 90, 470], [XR + 150, 140, 120, 440]];
    L.crash = [[XR + 150, 120, 170, 410], [XR + 400, 85, 210, 370], [XR + 600, 55, 240, 335]];
    L.airbox = [[XC - 200, 105, 560, 835], [XC - 60, 125, 560, 905], [XC + 250, 115, 560, 860], [XPU + 0.35 * d, 80, 560, 700], [XPU + 0.75 * d, 50, 500, 540]];
    // sidepods: inlet mouth from the inlet area (per side, 1.5 : 1), front bulk around it, coke-bottle taper to the gearbox
    const A = (L.sp.inlet / 2) * 100, h = Math.sqrt(A / 1.5), w = 1.5 * h;
    const xin = XC - 450, yIn = 410, zi0 = 420;
    L.sp.mouth = { x: xin, y0: yIn + 30, y1: yIn + 30 + w, z0: zi0, z1: zi0 + h };
    const yo = yIn + 30 + w + 45, zt = zi0 + h + 45, u = L.sp.u;
    L.sp.st = [   // [x, outer y, top z, undercut mm]
      [xin, yo, zt, u], [xin + 260, yo + 10, zt + 5, u], [XPU + 0.1 * d, lerp(yo, 330, 0.45), zt - 90, u * 0.8],
      [XPU + 0.55 * d, 300, lerp(zt, 420, 0.75), u * 0.4], [XR - 300, 200, 390, 0],
    ];
    L.sp.zlow = uu => 150 + 1.2 * uu;
    return L;
  }

  // ---------------------------------------------------------------- three.js part (browser only)
  const T = () => root.THREE;
  const reducedMotion = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const now = () => (root.performance ? root.performance.now() : Date.now());

  // FIA mm -> world metres: X forward (front axle at +1.7 m), Y up, Z = y
  const wx = x => (FIX.CX - x) / 1000;

  // loft of equal-length rings [[x,y,z] mm] -> indexed BufferGeometry (+caps); world coords relative to `org` [x,z] mm (pivot) if given
  function loftGeo(rings, opts) {
    const THREE = T(), nR = rings.length, nP = rings[0].length, caps = !(opts && opts.caps === false), org = opts && opts.org;
    const ox = org ? wx(org[0]) : 0, oy = org ? org[1] / 1000 : 0;
    const nV = nR * nP + (caps ? 2 * (nP + 1) : 0), pos = new Float32Array(nV * 3); let v = 0;
    const put = (p) => { pos[v * 3] = wx(p[0]) - ox; pos[v * 3 + 1] = p[2] / 1000 - oy; pos[v * 3 + 2] = p[1] / 1000; return v++; };
    for (const r of rings) for (const p of r) put(p);
    const idx = [];
    for (let r = 0; r < nR - 1; r++) for (let i = 0; i < nP; i++) {
      const a = r * nP + i, b = r * nP + (i + 1) % nP, c = a + nP, e = b + nP; idx.push(a, c, b, b, c, e);
    }
    if (caps) for (const ri of [0, nR - 1]) {
      const ring = rings[ri], cen = [0, 0, 0]; for (const p of ring) { cen[0] += p[0] / nP; cen[1] += p[1] / nP; cen[2] += p[2] / nP; }
      const c0 = put(cen), s = v; for (const p of ring) put(p);
      for (let i = 0; i < nP; i++) idx.push(c0, s + i, s + (i + 1) % nP);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  // a wire cage for the same rings: some rings as loops + a few longitudinal lines (ghost outlines read on smooth bodies)
  function loftWire(rings, opts) {
    const THREE = T(), nR = rings.length, nP = rings[0].length, org = opts && opts.org;
    const ox = org ? wx(org[0]) : 0, oy = org ? org[1] / 1000 : 0;
    const step = (opts && opts.step) || Math.max(1, Math.round(nR / 3)), lon = (opts && opts.lon) || [0, Math.round(nP / 4), Math.round(nP / 2), Math.round(3 * nP / 4)];
    const out = [], P = p => out.push(wx(p[0]) - ox, p[2] / 1000 - oy, p[1] / 1000);
    const ringsAt = []; for (let r = 0; r < nR; r += step) ringsAt.push(r); if (ringsAt[ringsAt.length - 1] !== nR - 1) ringsAt.push(nR - 1);
    for (const r of ringsAt) for (let i = 0; i < nP; i++) { P(rings[r][i]); P(rings[r][(i + 1) % nP]); }
    for (const i of lon) for (let r = 0; r < nR - 1; r++) { P(rings[r][i % nP]); P(rings[r + 1][i % nP]); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3)); return geo;
  }
  // superellipse section at x: half width hw, from zb to zt, exponent n, N points; y offset y0
  function seRing(x, hw, zb, zt, n, N, y0) {
    const out = [], zc = (zb + zt) / 2, hh = (zt - zb) / 2, e = 2 / n;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      out.push([x, (y0 || 0) + hw * Math.sign(c) * Math.pow(Math.abs(c), e), zc + hh * Math.sign(s) * Math.pow(Math.abs(s), e)]);
    }
    return out;
  }
  // body loft over [x, hw, zb, zt] stations, resampled to `n` sections
  function bodyRings(st, n, expo, N) {
    const out = [], xa = st[0][0], xb = st[st.length - 1][0];
    for (let i = 0; i < n; i++) { const x = lerp(xa, xb, i / (n - 1)), v = pw(st, x); out.push(seRing(x, v[0], v[1], v[2], expo, N)); }
    return out;
  }
  // inverted cambered section (downforce wing), unit chord, ring TE -> upper -> LE -> lower; (u rearward, v up)
  const AIRFOIL = (() => {
    const m = 11, xs = []; for (let i = 0; i < m; i++) xs.push(0.5 - 0.5 * Math.cos(Math.PI * i / (m - 1)));
    const cam = 0.07, pc = 0.45, th = 0.11;
    const yc = u => -(u < pc ? cam / (pc * pc) * (2 * pc * u - u * u) : cam / ((1 - pc) * (1 - pc)) * ((1 - 2 * pc) + 2 * pc * u - u * u));
    const yt = u => 5 * th * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);
    const up = [], lo = [];
    for (let i = 0; i < m; i++) { up.push([xs[i], yc(xs[i]) + yt(xs[i])]); lo.push([xs[i], yc(xs[i]) - yt(xs[i])]); }
    const ring = []; for (let i = m - 1; i >= 0; i--) ring.push(up[i]); for (let i = 1; i < m - 1; i++) ring.push(lo[i]);
    return ring;
  })();
  // element chain of a wing: n elements, schematic angles from the setting, scaled so the X extent equals `chord` (mm)
  // returns [{ le:[x,z], c, ang (rad, + = trailing edge up), te:[x,z] }] relative to the chain origin (main-plane LE at 0,0)
  function wingChain(n, aoa, chord, mainShare) {
    const el = [], k = Math.max(1, n);
    const ang = i => rad(k === 1 ? 0.45 * aoa : aoa * (0.18 + 0.82 * i / (k - 1)));
    let le = [0, 0];
    for (let i = 0; i < k; i++) {
      const c = i === 0 ? 1 : mainShare, a = ang(i), te = [le[0] + c * Math.cos(a), le[1] + c * Math.sin(a)];
      el.push({ le: le.slice(), c, ang: a, te });
      le = [te[0] - 0.17 * mainShare, te[1] + 0.05];   // the next element overlaps the slot, just above this trailing edge
    }
    let xmin = 0, xmax = 0; for (const e of el) { xmin = Math.min(xmin, e.le[0]); xmax = Math.max(xmax, e.te[0]); }
    const s = chord / (xmax - xmin);
    return el.map(e => ({ le: [e.le[0] * s, e.le[1] * s], te: [e.te[0] * s, e.te[1] * s], c: e.c * s, ang: e.ang }));
  }
  // section ring of an element: chord c (mm), angle, at LE (x, z), spanwise y
  function foilRing(le, c, ang, y, dz, dx) {
    const ca = Math.cos(ang), sa = Math.sin(ang), out = [];
    for (const [u, v] of AIRFOIL) out.push([le[0] + (dx || 0) + c * (u * ca - v * sa), y, le[1] + (dz || 0) + c * (u * sa + v * ca)]);
    return out;
  }

  // ---------------------------------------------------------------- the car: a list of visual parts
  // part = { id, cat: catalogue id(s) for highlight / mass tint, solids: [{ geo, mat, pivot?, delta? }], wires: [{ geo, pivot? }], aux: [] }
  function buildCar(L, M) {
    const THREE = T(), list = [], add = (id, cat, solids, wires, extra) => { const p = Object.assign({ id, cat: [].concat(cat), solids, wires: wires || [] }, extra || {}); list.push(p); return p; };
    const S = (geo, mat, extra) => Object.assign({ geo, mat }, extra || {});
    // ---- nose, survival cell, engine cover, crash structure, airbox
    const nR = bodyRings(L.nose, 9, 2.4, 28); add("nose", "nose", [S(loftGeo(nR), "paint")], [loftWire(nR)]);
    const cR = bodyRings(L.cell, 12, 3, 28); add("survival_cell", "survival_cell", [S(loftGeo(cR), "paint")], [loftWire(cR)]);
    const vR = bodyRings(L.cover, 10, 3, 28); add("engine_cover", "engine_cover", [S(loftGeo(vR), "paint")], [loftWire(vR)]);
    const aR = bodyRings(L.airbox, 10, 2.6, 24);
    const ab = add("airbox", "engine_cover", [S(loftGeo(aR), "paint")], [loftWire(aR)]);
    { const g = new THREE.CircleGeometry(1, 24); g.scale(0.07, 0.11, 1); g.rotateY(Math.PI / 2); g.translate(wx(L.XC - 203), 0.745, 0); ab.solids.push(S(g, "dark")); }
    const kR = bodyRings(L.crash, 5, 2.6, 20); add("rear_impact", "rear_impact", [S(loftGeo(kR), "carbon")], [loftWire(kR)]);
    { // rain light
      const g = new THREE.BoxGeometry(0.02, 0.03, 0.05); g.translate(wx(L.XR + 603), 0.29, 0); list[list.length - 1].solids.push(S(g, "light"));
    }
    // cockpit opening, driver helmet, mirrors (with the survival cell)
    const cell = list.find(p => p.id === "survival_cell");
    { const g = new THREE.CircleGeometry(1, 32); g.scale(0.39, 0.25, 1); g.rotateX(-Math.PI / 2); g.translate(wx(L.XC - 470), 0.651, 0); cell.solids.push(S(g, "dark")); }
    { const g = new THREE.SphereGeometry(0.125, 20, 14); g.translate(wx(L.XC - 420), 0.70, 0); cell.solids.push(S(g, "helmet")); }
    { const g = new THREE.SphereGeometry(0.128, 16, 6, Math.PI * 0.7, Math.PI * 0.6, Math.PI * 0.34, Math.PI * 0.14); g.translate(wx(L.XC - 420), 0.70, 0); cell.solids.push(S(g, "dark")); }
    for (const sy of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.11, 0.05, 0.035); g.translate(wx(L.XC - 760), 0.70, sy * 0.47); cell.solids.push(S(g, "carbon"));
      const st = new THREE.BoxGeometry(0.02, 0.012, 0.09); st.translate(wx(L.XC - 760), 0.665, sy * 0.415); cell.solids.push(S(st, "carbon"));
    }
    // ---- halo: a titanium hoop around the head on a central front pillar
    {
      const XC = L.XC, P = (x, y, z) => new THREE.Vector3(wx(x), z / 1000, y / 1000);
      const hoop = new THREE.CatmullRomCurve3([P(XC - 40, -265, 640), P(XC - 260, -285, 790), P(XC - 600, -190, 820), P(XC - 780, 0, 822), P(XC - 600, 190, 820), P(XC - 260, 285, 790), P(XC - 40, 265, 640)]);
      const pil = new THREE.CatmullRomCurve3([P(XC - 780, 0, 822), P(XC - 870, 0, 760), P(XC - 960, 0, 625)]);
      const g1 = new THREE.TubeGeometry(hoop, 40, 0.024, 8, false), g2 = new THREE.TubeGeometry(pil, 10, 0.024, 8, false);
      add("halo", "halo", [S(g1, "halo"), S(g2, "halo")], [new THREE.EdgesGeometry(g1, 60), new THREE.EdgesGeometry(g2, 60)]);
    }
    // ---- sidepods (both sides), inlet mouths
    {
      const sp = L.sp, solids = [], wires = [];
      for (const sy of [-1, 1]) {
        const rings = [];
        const nS = 12;
        for (let i = 0; i < nS; i++) {
          const x = lerp(sp.st[0][0], sp.st[sp.st.length - 1][0], i / (nS - 1)), v = pw(sp.st, x), yo = v[0], zt = v[1], u = v[2];
          const zb = FIX.floorTop - 5, zl = Math.min(zt - 60, sp.zlow(u)), yi = 120, r = 55;
          // around the section (y outward), outboard top shoulder, outer wall, the undercut curve back in under the pod, floor, inner side
          const pts = [[yi, zt], [yo - r * 1.6, zt], [yo - r * 0.45, zt - r * 0.4], [yo, zt - r], [yo, Math.max(zl + 20, (zt - r + zl) / 2)], [yo, zl + 10]];
          const ucut = Math.min(u, yo - yi - 40);
          for (let k = 1; k <= 5; k++) { const t = k / 5, q = 1 - Math.pow(1 - t, 2); pts.push([yo - ucut * q, lerp(zl, zb, t * t)]); }
          pts.push([lerp(yo - ucut, yi, 0.5), zb], [yi, zb], [yi, lerp(zb, zt, 0.5)]);
          rings.push(pts.map(([y, z]) => [x, sy * y, z]));
        }
        solids.push(S(loftGeo(rings), "paint")); wires.push(loftWire(rings, { step: 3, lon: [1, 4, 8, 12] }));
        // inlet mouth: a dark rounded rectangle on the front face (its area is the design's inlet area per side)
        const m = sp.mouth, w = (m.y1 - m.y0) / 1000, h = (m.z1 - m.z0) / 1000, r = Math.min(w, h) * 0.3;
        const sh = new THREE.Shape(); const x0 = -w / 2, y0 = -h / 2;
        sh.moveTo(x0 + r, y0); sh.lineTo(x0 + w - r, y0); sh.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r); sh.lineTo(x0 + w, y0 + h - r); sh.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
        sh.lineTo(x0 + r, y0 + h); sh.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r); sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0);
        const g = new THREE.ShapeGeometry(sh, 4); g.rotateY(Math.PI / 2); g.translate(wx(m.x - 4), (m.z0 + m.z1) / 2000, sy * (m.y0 + m.y1) / 2000);
        solids.push(S(g, "dark"));
      }
      add("sidepods", ["sidepods", "cooling"], solids, wires);
    }
    // ---- floor: planform from the width, an upturned edge, skirts, the venturi tunnel roof underneath; plank; inlet fences
    {
      const F = L.floor, W2 = F.W / 2, rings = [], n = 22;
      const plan = [[F.x0, 0.42], [F.x0 + 300, 0.62], [F.x0 + 700, 0.92], [F.x0 + 1000, 1.0], [L.XR - 1000, 1.0], [L.XR - 760, 0.8], [F.xd, 0.62]];
      for (let i = 0; i < n; i++) {
        const x = lerp(F.x0, F.xd, i / (n - 1)), hw = W2 * pw(plan, x)[0], zr = L.roof(x), zT = Math.max(FIX.floorTop, zr + 22);
        const skirt = x < F.x0 + 400 ? lerp(zr - 10, 12, sstep((x - F.x0) / 400)) : 12;
        const pts = [[-hw, skirt], [-hw, zT + 28], [-hw + 30, zT + 28], [-hw + 55, zT], [hw - 55, zT], [hw - 30, zT + 28], [hw, zT + 28], [hw, skirt], [hw - 25, skirt], [hw - 60, zr], [-hw + 60, zr], [-hw + 25, skirt]];
        rings.push(pts.map(([y, z]) => [x, y, z]));
      }
      const solids = [S(loftGeo(rings), "carbon")], wires = [loftWire(rings, { step: 3, lon: [1, 6, 9, 10] })];
      // plank / keel along the centre (Z=0 up to the tunnel roof)
      const pk = []; for (let i = 0; i < 8; i++) { const x = lerp(F.x0 + 150, F.xd - 80, i / 7), zr = L.roof(x); pk.push([[x, -140, 0], [x, 140, 0], [x, 140, zr], [x, -140, zr]]); }
      solids.push(S(loftGeo(pk), "plank"));
      // tunnel inlet fences
      for (const f of [-0.62, -0.3, 0.3, 0.62]) {
        const fr = []; for (let i = 0; i < 6; i++) { const x = lerp(F.x0 + 20, F.x0 + 700, i / 5), y = f * W2 * pw(plan, x)[0], zr = L.roof(x); fr.push([[x, y - 5, 14], [x, y + 5, 14], [x, y + 5, zr], [x, y - 5, zr]]); }
        solids.push(S(loftGeo(fr), "carbon"));
      }
      add("floor", "floor", solids, wires);
    }
    // ---- diffuser: an open channel from the throat to the exit at the expansion angle, with strakes
    {
      const F = L.floor, rings = [], n = 10, solids = [], wires = [];
      const hwAt = x => F.W / 2 * lerp(0.62, 0.56, (x - F.xd) / (F.xe - F.xd));
      for (let i = 0; i < n; i++) {
        const x = lerp(F.xd, F.xe, i / (n - 1)), hw = hwAt(x), zr = L.roof(x);
        const pts = [[-hw, 15], [-hw, zr + 40], [hw, zr + 40], [hw, 15], [hw - 15, 15], [hw - 15, zr], [-hw + 15, zr], [-hw + 15, 15]];
        rings.push(pts.map(([y, z]) => [x, y, z]));
      }
      solids.push(S(loftGeo(rings), "carbon")); wires.push(loftWire(rings, { step: 3, lon: [1, 2, 5, 6] }));
      for (const f of [-0.62, -0.3, 0.3, 0.62]) {
        const fr = []; for (let i = 0; i < 5; i++) { const x = lerp(F.xd, F.xe, i / 4), y = f * hwAt(x), zr = L.roof(x); fr.push([[x, y - 6, 15], [x, y + 6, 15], [x, y + 6, zr], [x, y - 6, zr]]); }
        solids.push(S(loftGeo(fr), "carbon"));
      }
      add("diffuser", "diffuser", solids, wires);
    }
    // ---- front wing: elements across the span (tips sweep up), endplates; flaps pivot at their trailing edge for straight mode
    {
      const fw = L.fw, chain = wingChain(fw.n, fw.aoa, fw.chord, 0.72), half = fw.span / 2, ns = 13, solids = [], wires = [], outl = [];
      const tip = y => { const t = Math.abs(y) / half; return { dz: 75 * Math.pow(t, 3), dx: -35 * t * t }; };
      chain.forEach((e, i) => {
        const le = [fw.le + e.le[0], fw.z0 + e.le[1]], te = [fw.le + e.te[0], fw.z0 + e.te[1]];
        const flap = i > 0 && fw.sm > 0, org = flap ? te : null;
        const ringsAt = ang => { const r = []; for (let j = 0; j < ns; j++) { const y = lerp(-half, half, j / (ns - 1)), tp = tip(y); r.push(foilRing(le, e.c, ang, y, tp.dz, tp.dx)); } return r; };
        const rings = ringsAt(e.ang);
        solids.push(S(loftGeo(rings, { org }), "wing", flap ? { pivot: [te[0], te[1]], delta: rad(fw.sm), wing: "fw" } : null));
        wires.push({ geo: loftWire(rings, { step: 6, lon: [0, 10] }) });
        if (flap) outl.push({ geo: loftWire(rings, { org, step: 3, lon: [0, 5, 10, 14] }), pivot: [te[0], te[1]], delta: rad(fw.sm) });
      });
      // endplates: outboard plates from near the ground to above the top element at the tip
      const top = fw.z0 + Math.max.apply(null, chain.map(e => e.te[1])) + 75 + 15, xa = fw.le - 25 - 35, xb = fw.le + fw.chord + 30 - 35;
      for (const sy of [-1, 1]) {
        const y = sy * (half + 4), prof = [[xa, 25], [xa, lerp(fw.z0, top, 0.45)], [xa + 0.45 * (xb - xa), top], [xb, top], [xb, 25]];
        const r = [prof.map(([x, z]) => [x, y - 6, z]), prof.map(([x, z]) => [x, y + 6, z])];
        solids.push(S(loftGeo(r), "wingDark")); wires.push({ geo: loftWire(r, { step: 1, lon: [] }) });
      }
      add("front_wing", "front_wing", solids, wires.map(w => w.geo), { outline: outl });
    }
    // ---- rear wing: elements, endplates up to the endplate-top parameter, the central pylon
    {
      const rw = L.rw, chain = wingChain(rw.n, rw.aoa, rw.chord, 0.7), half = rw.span / 2, ns = 7, solids = [], wires = [], outl = [];
      const x0 = rw.cx - rw.chord / 2;
      chain.forEach((e, i) => {
        const le = [x0 + e.le[0], rw.z0 + e.le[1]], te = [x0 + e.te[0], rw.z0 + e.te[1]];
        const flap = i > 0 && rw.sm > 0, org = flap ? te : null;
        const rings = []; for (let j = 0; j < ns; j++) rings.push(foilRing(le, e.c, e.ang, lerp(-half, half, j / (ns - 1))));
        solids.push(S(loftGeo(rings, { org }), "wing", flap ? { pivot: te, delta: rad(rw.sm), wing: "rw" } : null));
        wires.push(loftWire(rings, { step: 3, lon: [0, 10] }));
        if (flap) outl.push({ geo: loftWire(rings, { org, step: 2, lon: [0, 5, 10, 14] }), pivot: te, delta: rad(rw.sm) });
      });
      const xa = x0 - 60, xb = x0 + rw.chord + 45, zb = 430, E = rw.E;
      for (const sy of [-1, 1]) {
        const y = sy * (half + 6), prof = [[xa + 0.45 * (xb - xa), zb], [xa + 20, zb + 160], [xa, E - 70], [xa + 70, E], [xb, E], [xb, zb + 120], [xb - 0.25 * (xb - xa), zb]];
        const r = [prof.map(([x, z]) => [x, y - 7, z]), prof.map(([x, z]) => [x, y + 7, z])];
        solids.push(S(loftGeo(r), "wingDark")); wires.push(loftWire(r, { step: 1, lon: [] }));
      }
      const pl = [[rw.cx - 40, 0, 360], [rw.cx + 60, 0, 360], [rw.cx + 60, 0, rw.z0 + 20], [rw.cx - 40, 0, rw.z0 + 20]];
      solids.push(S(loftGeo([pl.map(p => [p[0], -8, p[2]]), pl.map(p => [p[0], 8, p[2]])]), "carbon"));
      add("rear_wing", "rear_wing", solids, wires, { outline: outl });
    }
    // ---- beam wing (fixed geometry in this concept)
    {
      const chain = wingChain(2, 18, 260, 0.75), half = 400, solids = [], wires = [];
      chain.forEach(e => {
        const rings = []; for (let j = 0; j < 5; j++) rings.push(foilRing([L.XR + 300 + e.le[0], 395 + e.le[1]], e.c, e.ang, lerp(-half, half, j / 4)));
        solids.push(S(loftGeo(rings), "carbon")); wires.push(loftWire(rings, { step: 2, lon: [0, 10] }));
      });
      add("beam_wing", "beam_wing", solids, wires);
    }
    // ---- wheels, tyres (fixed: ground-referenced, they do not ride with the body), suspension
    const wheelParts = [];
    for (const [id, x, track, tw] of [["wheels_front", 0, FIX.trackF, FIX.tyreWF], ["wheels_rear", L.XR, FIX.trackR, FIX.tyreWR]]) {
      const solids = [], wires = [], R = FIX.tyreR / 1000, rr = FIX.rimR / 1000, w = tw / 1000;
      for (const sy of [-1, 1]) {
        const prof = [[rr, -w / 2 + 0.012], [0.30, -w / 2], [0.334, -w / 2 + 0.01], [0.349, -w / 2 + 0.035], [R, -w / 2 + 0.065], [R, w / 2 - 0.065], [0.349, w / 2 - 0.035], [0.334, w / 2 - 0.01], [0.30, w / 2], [rr, w / 2 - 0.012]].map(([a, b]) => new THREE.Vector2(a, b));
        const zc = sy * track / 2000;
        const t = new THREE.LatheGeometry(prof, 48); t.rotateX(Math.PI / 2); t.translate(wx(x), R, zc); solids.push(S(t, "tyre"));
        const rim = new THREE.CylinderGeometry(rr, rr, w - 0.03, 32, 1, false); rim.rotateX(Math.PI / 2); rim.translate(wx(x), R, zc); solids.push(S(rim, "rim"));
        for (const side of [-1, 1]) {
          const ring = new THREE.TorusGeometry(0.29, 0.0045, 4, 48); ring.translate(wx(x), R, zc + side * (w / 2 + 0.002)); solids.push(S(ring, "stripe"));
        }
        wires.push(new THREE.EdgesGeometry(t, 40));
      }
      wheelParts.push(add(id, [id, id === "wheels_front" ? "brakes_front" : "brakes_rear"], solids, wires, { ground: true }));
    }
    {
      const rh = L.rh;
      const P = (x, y, zBody) => new THREE.Vector3(wx(x), (zBody + rh) / 1000, y / 1000), G = (x, y, yW) => new THREE.Vector3(wx(x), yW, y / 1000);
      const rod = (a, b, r) => { const d = new THREE.Vector3().subVectors(b, a), len = d.length(), g = new THREE.CylinderGeometry(r, r, len, 6, 1); g.translate(0, len / 2, 0); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)); g.translate(a.x, a.y, a.z); return g; };
      const R = FIX.tyreR / 1000;
      for (const [x, track, yIn, cat] of [[0, FIX.trackF, 160, "front_suspension"], [L.XR, FIX.trackR, 120, "rear_suspension"]]) {
        const sol = [];
        for (const sy of [-1, 1]) {
          const yo = sy * (track / 2 - 140), yi = sy * yIn, top = G(x, yo, R + 0.15), bot = G(x, yo, R - 0.12);
          sol.push(S(rod(P(x - 220, yi, 480), top, 0.012), "carbon"), S(rod(P(x + 230, yi, 470), top, 0.012), "carbon"));
          sol.push(S(rod(P(x - 260, yi, 160), bot, 0.012), "carbon"), S(rod(P(x + 260, yi, 160), bot, 0.012), "carbon"));
          sol.push(S(rod(bot, P(x - 60, sy * (yIn - 30), 540), 0.010), "carbon"));
        }
        add(cat, cat, sol, sol.map(s => new THREE.EdgesGeometry(s.geo, 50)), { ground: true });
      }
    }
    return list;
  }

  // ---------------------------------------------------------------- environment, materials
  const srgb = (hex) => new (T().Color)(hex).convertSRGBToLinear();
  function discAlpha() {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128); grd.addColorStop(0, "#fff"); grd.addColorStop(0.55, "#fff"); grd.addColorStop(1, "#000");
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256); return new (T().CanvasTexture)(c);
  }
  function studioEnv(renderer) {
    const THREE = T(), room = new THREE.Scene(); room.background = new THREE.Color(0x101014);
    const box = (w, h, x, y, z, ry, rx, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); room.add(m); };
    box(6, 2.2, 0, 4.5, 0, 0, Math.PI / 2, 0xffffff); box(3, 3, 5, 2.5, 4, -Math.PI / 4, 0, 0xdde6ff); box(3, 1.6, -5, 1.8, -4, Math.PI * 0.75, 0, 0xffe6cc);
    box(40, 40, 0, -0.01, 0, 0, -Math.PI / 2, 0x050507);
    const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
    const env = pm.fromScene(room, 0.04).texture; pm.dispose();
    room.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return env;
  }
  function makeMaterials(o) {
    const THREE = T(), std = (hex, rough, metal, extra) => new THREE.MeshStandardMaterial(Object.assign({ color: srgb(hex), roughness: rough, metalness: metal, side: THREE.DoubleSide }, extra || {}));
    return {
      paint: std(0xaeaba5, 0.34, 0.12), carbon: std(0x1d1d22, 0.6, 0.1), wing: std(0x8c8c96, 0.4, 0.25), wingDark: std(0x26262c, 0.5, 0.15),
      plank: std(0x4a3a2c, 0.7, 0.0), tyre: std(0x161618, 0.88, 0.0), rim: std(0x2c2c32, 0.35, 0.7), stripe: std(0xe8e8ec, 0.6, 0.0),
      halo: std(0x34343c, 0.3, 0.6), helmet: std(0xe8e8ec, 0.25, 0.1), dark: new THREE.MeshBasicMaterial({ color: srgb(0x050506), side: THREE.DoubleSide }),
      light: new THREE.MeshBasicMaterial({ color: srgb(0x7a1424) }),
    };
  }
  const rampColor = (t) => {   // t in 0..1 -> sRGB hex string on RAMP
    t = clamp(t, 0, 1) * (RAMP.length - 1); const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
    const a = parseInt(RAMP[i].slice(1), 16), b = parseInt(RAMP[i + 1].slice(1), 16);
    const ch = s => Math.round(lerp((a >> s) & 255, (b >> s) & 255, f));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  const shortName = id => { const p = parts.BY_ID[id]; if (!p) return id; return p.name.split(" (")[0].split(",")[0].replace(" and tyres", "").replace("PU · ", "").replace("energy store", "Energy store"); };

  // ---------------------------------------------------------------- views
  // camera on a sphere around a target: azim 0 = behind the car, π/2 = its side, π = in front; elev above the ground; radius for a 1.6 frame
  const VIEWS = {
    hero: { azim: 2.38, elev: 0.30, radius: 7.6, target: [0.05, 0.36, 0] },
    front34: { azim: 2.2, elev: 0.16, radius: 7.4, target: [0.1, 0.32, 0] },
    rear34: { azim: 0.62, elev: 0.24, radius: 6.6, target: [-0.45, 0.42, 0] },
    rearwing: { azim: 0.6, elev: 0.3, radius: 3.4, target: [-2.1, 0.68, 0] },
    frontwing: { azim: 2.3, elev: 0.38, radius: 3.4, target: [2.55, 0.12, 0] },
    side: { azim: Math.PI / 2, elev: 0.04, radius: 8.4, target: [-0.1, 0.45, 0] },
    top: { azim: Math.PI / 2, elev: 1.53, radius: 8.8, target: [-0.1, 0.2, 0] },
    front: { azim: Math.PI, elev: 0.10, radius: 6.0, target: [0, 0.45, 0] },
    rear: { azim: 0, elev: 0.14, radius: 6.0, target: [0, 0.48, 0] },
  };
  const REF_ASPECT = 1.6, MOVE_MS = 600, EASE = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const SWAY = { amp: 0.16, period: 28 }, MORPH_MS = 450, SM_HOLD_MS = 2600, SM_SWING_MS = 400;

  // ---------------------------------------------------------------- mount
  function mount(container, opts) {
    const THREE = T();
    if (!container) throw new Error("conceptView.mount: container element required");
    if (!THREE) throw new Error("conceptView.mount: load vendor/three.min.js first");
    if (!parts) throw new Error("conceptView.mount: load concept/regs.js and concept/parts.js first");
    const o = Object.assign({}, DEFAULTS, opts || {}), rm = reducedMotion();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, o.pixelRatioCap));
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = !!o.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    const cv = renderer.domElement; cv.style.display = "block"; cv.style.width = "100%"; cv.style.height = "100%"; cv.style.touchAction = "none";
    cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "Concept car: 3D view generated from the design parameters");
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(cv);
    const mono = "font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;";
    let label = null, legend = null;
    if (o.label) {
      label = document.createElement("div"); label.className = "cv-label";
      label.style.cssText = "position:absolute;top:10px;right:12px;max-width:52%;text-align:right;color:#8a8a94;pointer-events:none;" + mono;
      container.appendChild(label);
    }
    if (o.legend) {
      legend = document.createElement("div"); legend.className = "cv-legend";
      legend.style.cssText = "position:absolute;left:12px;bottom:10px;max-width:60%;color:#8a8a94;pointer-events:none;" + mono;
      container.appendChild(legend);
    }
    const tags = document.createElement("div"); tags.className = "cv-tags"; tags.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;"; container.appendChild(tags);

    const scene = new THREE.Scene(); scene.background = new THREE.Color(o.background);
    scene.environment = studioEnv(renderer);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0x3a3f52, 0x08080a, 0.55));
    const key = new THREE.DirectionalLight(0xfff1e2, 1.7); key.position.set(4.5, 7, 4); key.castShadow = !!o.shadows;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0008; key.shadow.normalBias = 0.025;
    const sc = key.shadow.camera; sc.near = 1; sc.far = 24; sc.left = sc.bottom = -4.5; sc.right = sc.top = 4.5; scene.add(key); scene.add(key.target);
    const rim = new THREE.DirectionalLight(0xbfd0ff, 1.2); rim.position.set(-6, 3.2, -5); scene.add(rim);
    const fill = new THREE.DirectionalLight(0x8e96b8, 0.45); fill.position.set(3, 2, -6); scene.add(fill);
    const fill2 = new THREE.DirectionalLight(0x8e96b8, 0.35); fill2.position.set(-3, 2, 6); scene.add(fill2);
    const floorAlpha = discAlpha();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshBasicMaterial({ color: srgb(0x15151a), transparent: true, alphaMap: floorAlpha, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.6 }));
    shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = 0.001; shadowPlane.receiveShadow = true; scene.add(shadowPlane);

    const M = makeMaterials(o);
    const hiCache = new Map(), xrCache = new Map();
    const hiMat = (name) => { if (!hiCache.has(name)) { const m = M[name].clone(); if (m.emissive) { m.emissive = srgb(o.highlightColor); m.emissiveIntensity = 0.55; } else m.color = srgb(o.highlightColor); hiCache.set(name, m); } return hiCache.get(name); };
    const xrMat = (hex) => { if (!xrCache.has(hex)) xrCache.set(hex, new THREE.MeshStandardMaterial({ color: srgb(hex), emissive: srgb(hex), emissiveIntensity: 0.35, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide })); return xrCache.get(hex); };
    const xrSphereMat = (hex) => { const k = "s" + hex; if (!xrCache.has(k)) xrCache.set(k, new THREE.MeshStandardMaterial({ color: srgb(hex), emissive: srgb(hex), emissiveIntensity: 0.55, roughness: 0.4, metalness: 0 })); return xrCache.get(k); };
    const ghostLine = new THREE.LineBasicMaterial({ color: srgb(o.ghostColor), transparent: true, opacity: 0.95, depthWrite: false });
    const ghostLineHidden = new THREE.LineBasicMaterial({ color: srgb(o.ghostColor), transparent: true, opacity: 0.16, depthWrite: false, depthFunc: THREE.GreaterDepth });
    const ghostFill = new THREE.MeshBasicMaterial({ color: srgb(o.ghostColor), transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
    const smLine = new THREE.LineBasicMaterial({ color: srgb(0xe8e8ec), transparent: true, opacity: 0.85, depthWrite: false });
    const smFill = new THREE.MeshBasicMaterial({ color: srgb(0xe8e8ec), transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const cogMat = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
      g.fillStyle = "#e8e8ec"; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0a0a0c"; for (const a of [0, Math.PI]) { g.beginPath(); g.moveTo(64, 64); g.arc(64, 64, 56, a, a + Math.PI / 2); g.fill(); }
      g.strokeStyle = "#0a0a0c"; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.stroke();
      return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
    })();
    const cogBaseMat = (() => { const m = cogMat.clone(); m.color = srgb(o.ghostColor); return m; })();
    const cogLineMat = new THREE.LineBasicMaterial({ color: srgb(0xe8e8ec), transparent: true, opacity: 0.6, depthTest: false });

    const carRoot = new THREE.Group(), body = new THREE.Group(), ground = new THREE.Group(); carRoot.add(body, ground); scene.add(carRoot);
    const ghostRoot = new THREE.Group(), ghostBody = new THREE.Group(), ghostGround = new THREE.Group(); ghostRoot.add(ghostBody, ghostGround); scene.add(ghostRoot);
    const xrRoot = new THREE.Group(); scene.add(xrRoot);

    const s = {
      o, rm, design: null, baseline: null, mass: null, L: null, built: [], geos: [], ghostGeos: [], xrGeos: [], highlight: new Set(), mode: o.mode, aero: o.aero,
      azim: 0, elev: 0, radius: 0, target: new THREE.Vector3(), view: o.view, move: null, user: false, t0: now(), swayT0: 0,
      smT: 0, smTarget: 0, smPhaseT0: now(), flaps: [], tween: null, lastMs: null, raf: 0, dirty: true, disposed: false, tagEls: [], tagRows: [],
    };

    // ---- build / rebuild
    function disposeList(arr) { for (const g of arr) g.dispose(); arr.length = 0; }
    function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }
    // does a visual part differ from the baseline's? different topology, or any vertex moved more than GHOST_TOL_M (so a 5 mm
    // packaging shift does not ghost the whole car; ride height is compared separately because it moves the body as a whole)
    const GHOST_TOL_M = 0.012, SEE_THROUGH = new Set(["front_wing", "rear_wing", "beam_wing", "diffuser"]);
    function differs(a, b) {
      if (!a || !b || a.solids.length !== b.solids.length) return true;
      for (let k = 0; k < a.solids.length; k++) {
        const x = a.solids[k].geo.attributes.position.array, y = b.solids[k].geo.attributes.position.array;
        if (x.length !== y.length) return true;
        for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > GHOST_TOL_M) return true;
      }
      return false;
    }
    function materialFor(p, sd) {
      if (s.mode === "xray-mass") return xrMat(massColorFor(p));
      const hi = p.cat.some(c => s.highlight.has(c)) || s.highlight.has(p.id);
      return hi ? hiMat(sd.mat) : M[sd.mat];
    }
    function massColorFor(p) {
      if (!s.mass) return rampColor(0.2);
      const kg = p.cat.reduce((acc, id) => acc + ((s.mass.byId[id] || 0)), 0);
      return rampColor(Math.sqrt(kg / s.mass.max));
    }
    function build(params, withGhost) {
      const t0 = now();
      clearGroup(body); clearGroup(ground); disposeList(s.geos); s.flaps = [];
      const L = layout(params, { exaggerate: o.exaggerate, base: s.baseline ? s.baseline.params : null });
      const list = buildCar(L);
      for (const p of list) {
        const grp = p.ground ? ground : body;
        p.meshes = [];
        for (const sd of p.solids) {
          s.geos.push(sd.geo);
          const mesh = new THREE.Mesh(sd.geo, materialFor(p, sd)); mesh.castShadow = s.mode !== "xray-mass"; mesh.userData = { part: p, sd };
          p.meshes.push(mesh);
          if (sd.pivot) {
            const piv = new THREE.Group(); piv.position.set(wx(sd.pivot[0]), sd.pivot[1] / 1000, 0); piv.add(mesh); grp.add(piv);
            s.flaps.push({ piv, delta: sd.delta });
          } else grp.add(mesh);
        }
        for (const w of p.wires) s.geos.push(w);
        for (const ol of p.outline || []) {   // straight-mode position of each flap: a white outline at the flap's straight-mode angle
          s.geos.push(ol.geo);
          const piv = new THREE.Group(); piv.position.set(wx(ol.pivot[0]), ol.pivot[1] / 1000, 0); piv.rotation.z = ol.delta;
          const ln = new THREE.LineSegments(ol.geo, smLine); ln.renderOrder = 3; ln.visible = s.mode !== "xray-mass"; piv.add(ln); grp.add(piv); p.meshes.push(ln);
          const flapSolid = p.solids.find(sd => sd.pivot && sd.pivot[0] === ol.pivot[0] && sd.pivot[1] === ol.pivot[1]);
          if (flapSolid) { const f = new THREE.Mesh(flapSolid.geo, smFill); f.renderOrder = 3; f.visible = ln.visible; piv.add(f); p.meshes.push(f); f.userData.aux = true; }
        }
      }
      body.position.y = L.rh / 1000;
      s.built = list; s.L = L;
      applyFlaps();
      if (withGhost) buildGhost(list, L);
      if (s.mode === "xray-mass") buildXray();
      renderer.shadowMap.needsUpdate = true; s.dirty = true;
      return now() - t0;
    }
    // the baseline's parts that differ from the design: purple wire cage (stronger where in front of the car) + faint fill
    let ghostCache = null;   // { key, list, L } the baseline build, kept while the baseline is unchanged
    function buildGhost(list, L) {
      clearGroup(ghostBody); clearGroup(ghostGround); s.ghostParts = [];
      if (!s.baseline) { if (ghostCache) { disposeList(ghostCache.geos); ghostCache = null; } ghostRoot.visible = false; return; }
      const key = JSON.stringify(s.baseline.params) + "|" + o.exaggerate;
      if (!ghostCache || ghostCache.key !== key) {
        if (ghostCache) disposeList(ghostCache.geos);
        const bL = layout(s.baseline.params, { exaggerate: o.exaggerate, base: s.baseline.params }), bl = buildCar(bL), geos = [];
        for (const p of bl) { for (const sd of p.solids) geos.push(sd.geo); for (const w of p.wires) geos.push(w); for (const ol of p.outline || []) geos.push(ol.geo); }
        ghostCache = { key, list: bl, L: bL, geos };
      }
      const cur = {}; for (const p of list) cur[p.id] = p;
      const rhDiff = Math.abs(ghostCache.L.rh - L.rh) > 0.25;
      for (const p of ghostCache.list) {
        if (!(differs(p, cur[p.id]) || (rhDiff && p.id === "floor"))) continue;
        s.ghostParts.push(p.id);
        const grp = p.ground ? ghostGround : ghostBody;
        const seeThrough = SEE_THROUGH.has(p.id);   // wings / diffuser: their elements hide behind endplates, so the hidden part shows faintly
        for (const w of p.wires) { const a = new THREE.LineSegments(w, ghostLine); a.renderOrder = 4; grp.add(a); if (seeThrough) { const b = new THREE.LineSegments(w, ghostLineHidden); b.renderOrder = 4; grp.add(b); } }
        for (const sd of p.solids) { if (sd.mat === "dark" || sd.mat === "stripe") continue; const m = new THREE.Mesh(sd.geo, ghostFill); m.renderOrder = 5; if (sd.pivot) { /* flaps: drawn in corner mode */ } grp.add(m); }
      }
      ghostBody.position.y = ghostCache.L.rh / 1000;
      ghostRoot.visible = s.mode !== "xray-mass" && s.ghostParts.length > 0;
    }
    // x-ray mass: one sphere per mass-sheet row (pairs mirrored, half mass each), colour and volume from the mass, a CoG marker
    function buildXray() {
      clearGroup(xrRoot); disposeList(s.xrGeos); s.tagRows = [];
      if (!s.mass) return;
      const rh = s.L.rh / 1000, k = 0.032;
      const sphere = new THREE.SphereGeometry(1, 20, 14); s.xrGeos.push(sphere);
      for (const r of s.mass.rows) {
        if (!(r.mass_kg > 0)) continue;
        const py = PAIR_Y[r.id], pts = py ? [-py, py] : [0], kg = r.mass_kg / pts.length, rad_ = k * Math.cbrt(kg);
        for (const y of pts) {
          const m = new THREE.Mesh(sphere, xrSphereMat(rampColor(Math.sqrt(r.mass_kg / s.mass.max)))); m.scale.setScalar(rad_);
          m.position.set(wx(r.x_mm), r.z_mm / 1000 + rh, (y || 0) / 1000); xrRoot.add(m);
        }
        s.tagRows.push(r);
      }
      const cog = new THREE.Sprite(cogMat); cog.scale.setScalar(0.24); cog.position.set(wx(s.mass.cog_x_mm), s.mass.cog_z_mm / 1000 + rh, 0); cog.renderOrder = 10; xrRoot.add(cog);
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(wx(s.mass.cog_x_mm), 0.002, 0), new THREE.Vector3(wx(s.mass.cog_x_mm), s.mass.cog_z_mm / 1000 + rh, 0)]); s.xrGeos.push(lg);
      const ln = new THREE.Line(lg, cogLineMat); ln.renderOrder = 9; xrRoot.add(ln);
      if (s.baseMass) {
        const b = new THREE.Sprite(cogBaseMat); b.scale.setScalar(0.17); b.position.set(wx(s.baseMass.cog_x_mm), s.baseMass.cog_z_mm / 1000 + rh, 0); b.renderOrder = 8; xrRoot.add(b);
      }
      s.cogSprite = cog;
    }
    function massOf(design, given) {
      const m = given || parts.massSheet(design.params, { overrides: design.overrides });
      const rows = m.parts || [], byId = {}; let max = 1; for (const r of rows) { byId[r.id] = (byId[r.id] || 0) + r.mass_kg; max = Math.max(max, r.mass_kg); }
      return { rows, byId, max, total_kg: m.total_kg, cog_x_mm: m.cog_x_mm, cog_z_mm: m.cog_z_mm, front_share: m.front_share, ballast_kg: m.ballast_kg };
    }

    // ---- straight mode
    const usesSM = () => !!(s.L && (s.L.fw.sm > 0 && s.L.fw.n >= 2 || s.L.rw.sm > 0 && s.L.rw.n >= 2));
    function applyFlaps() { for (const f of s.flaps) f.piv.rotation.z = f.delta * s.smT; }
    function aeroTick(t) {
      if (!usesSM()) { s.smT = 0; return false; }
      let target = s.aero === "straight" ? 1 : 0;
      if (s.aero === "cycle" && !s.rm) { const per = 2 * (SM_HOLD_MS + SM_SWING_MS), ph = (t - s.smPhaseT0) % per; target = ph < SM_HOLD_MS ? 0 : ph < SM_HOLD_MS + SM_SWING_MS ? (ph - SM_HOLD_MS) / SM_SWING_MS : ph < 2 * SM_HOLD_MS + SM_SWING_MS ? 1 : 1 - (ph - 2 * SM_HOLD_MS - SM_SWING_MS) / SM_SWING_MS; }
      const v = EASE(clamp(target, 0, 1));
      if (Math.abs(v - s.smT) < 1e-4) return false;
      s.smT = v; applyFlaps(); renderer.shadowMap.needsUpdate = true; return true;
    }

    // ---- labels and legend
    function labelText() {
      let t = LABEL;
      if (o.exaggerate && o.exaggerate !== 1) t += " · ride height and wing settings exaggerated ×" + o.exaggerate + " vs the baseline for visibility";
      return t;
    }
    function legendLines() {
      const out = [];
      if (s.mode === "xray-mass" && s.mass) {
        out.push({ html: "<b style='color:#e8e8ec;font-weight:600'>x-ray · mass</b> · concept part-mass estimates v0 (not measured)" });
        const grad = "linear-gradient(90deg," + RAMP.join(",") + ")";
        const tick = v => "<span style='position:absolute;left:" + (Math.sqrt(v / s.mass.max) * 100).toFixed(1) + "%;transform:translateX(-50%);top:12px'>" + v + "</span>";
        const ticks = [5, 25, 50, 100].filter(v => v < s.mass.max * 0.7).map(tick).join("") + "<span style='position:absolute;right:0;top:12px'>" + Math.round(s.mass.max) + " kg</span>";
        out.push({ html: "<div style='position:relative;width:240px;height:28px;margin:4px 0 2px'><div style='height:9px;border-radius:2px;background:" + grad + "'></div>" + ticks + "</div>" });
        out.push({ text: "part mass (kg, √ scale) · sphere volume ∝ mass · paired parts split left/right" });
        out.push({ html: "<span style='color:#e8e8ec'>◐</span> CoG " + s.mass.cog_x_mm + " mm behind the front axle, " + s.mass.cog_z_mm + " mm above Z=0 · " + (s.mass.front_share * 100).toFixed(1) + " % front · " + s.mass.total_kg + " kg" + (s.baseMass ? " · <span style='color:#b26cff'>◐</span> baseline CoG" : "") });
      } else {
        if (ghostRoot.visible) out.push({ html: "<span style='color:#b26cff'>purple</span> = the baseline's " + s.ghostParts.map(id => id.replace(/_/g, " ")).join(", ") });
        if (s.highlight.size) out.push({ html: "<span style='color:#fbbf24'>amber</span> = " + Array.from(s.highlight).map(id => id.replace(/_/g, " ")).join(", ") });
        if (usesSM()) {
          const w = []; if (s.L.fw.sm > 0 && s.L.fw.n >= 2) w.push("front −" + s.L.fw.sm + "°"); if (s.L.rw.sm > 0 && s.L.rw.n >= 2) w.push("rear −" + s.L.rw.sm + "°");
          out.push({ html: "<span style='color:#e8e8ec'>white outline</span> = straight-mode flap position (" + w.join(", ") + ")" + (s.smT > 0.5 ? " · showing straight mode" : " · showing corner mode") });
        }
        out.push({ text: "wing settings drawn on a schematic angle scale" });
      }
      return out;
    }
    let lastLegend = "";
    function updateOverlay() {
      if (label) { const t = labelText(); if (label.textContent !== t) label.textContent = t; }
      if (legend) {
        const html = legendLines().map(l => "<div>" + (l.html || l.text.replace(/</g, "&lt;")) + "</div>").join("");
        if (html !== lastLegend) { legend.innerHTML = html; lastLegend = html; }
      }
    }
    // mass tags (x-ray): the heaviest rows plus ballast, projected each frame
    const TAG_N = 7;
    function updateTags() {
      const want = s.mode === "xray-mass" && s.mass ? s.tagRows.slice().sort((a, b) => b.mass_kg - a.mass_kg).filter((r, i) => i < TAG_N || r.id === "ballast") : [];
      while (s.tagEls.length < want.length) { const el = document.createElement("div"); el.style.cssText = "position:absolute;white-space:nowrap;color:#e8e8ec;background:rgba(10,10,12,.72);padding:1px 4px;border-radius:3px;" + mono; tags.appendChild(el); s.tagEls.push(el); }
      const w = cv.clientWidth, h = cv.clientHeight, v = new THREE.Vector3(), rh = s.L ? s.L.rh / 1000 : 0, placed = [];
      s.tagEls.forEach((el, i) => {
        const r = want[i]; if (!r) { el.style.display = "none"; return; }
        v.set(wx(r.x_mm), r.z_mm / 1000 + rh, 0).project(camera);
        if (v.z > 1) { el.style.display = "none"; return; }
        el.style.display = ""; el.textContent = shortName(r.id) + " " + (Math.round(r.mass_kg * 10) / 10) + " kg";
        let x = (v.x * 0.5 + 0.5) * w + 10, y = (-v.y * 0.5 + 0.5) * h - 8;
        const bw = el.textContent.length * 6.7 + 8, bh = 16;
        for (let k = 0; k < 12 && placed.some(r => x < r.x + r.w && x + bw > r.x && y < r.y + r.h && y + bh > r.y); k++) y += (k % 2 ? -1 : 1) * (k + 1) * bh;
        placed.push({ x, y, w: bw, h: bh });
        el.style.left = x.toFixed(0) + "px"; el.style.top = y.toFixed(0) + "px";
      });
    }

    // ---- camera
    const fitScale = () => Math.max(1, REF_ASPECT / camera.aspect);
    function pose(name) { const V = VIEWS[name] || VIEWS.hero; return { azim: V.azim, elev: V.elev, radius: V.radius * fitScale(), target: new THREE.Vector3().fromArray(V.target) }; }
    function place() {
      const ce = Math.cos(s.elev), t = s.target;
      camera.position.set(t.x - s.radius * ce * Math.cos(s.azim), t.y + s.radius * Math.sin(s.elev), t.z + s.radius * ce * Math.sin(s.azim));
      camera.lookAt(t); s.dirty = true;
    }
    function setView(name, vo) {
      if (!VIEWS[name]) throw new Error("conceptView.setView: unknown view " + name);
      s.view = name; s.user = false; const P = pose(name);
      if (s.rm || (vo && vo.animate === false)) { s.move = null; s.azim = P.azim; s.elev = P.elev; s.radius = P.radius; s.target.copy(P.target); s.swayT0 = now(); place(); return; }
      s.move = { t0: null, from: { azim: s.azim, elev: s.elev, radius: s.radius, target: s.target.clone() }, to: P };
      s.dirty = true;
    }
    function resize() {
      const w = Math.max(1, container.clientWidth | 0), h = Math.max(1, container.clientHeight | 0);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (!s.move && !s.user) { const P = pose(s.view); s.radius = P.radius; }
      place();
    }
    // pointer orbit (drag), wheel zoom, double-click back to the hero
    let drag = null;
    const onDown = e => { drag = { x: e.clientX, y: e.clientY, azim: s.azim, elev: s.elev }; s.move = null; s.user = true; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); };
    const onMove = e => { if (!drag || !o.orbit) return; s.azim = drag.azim - (e.clientX - drag.x) * 0.008; s.elev = clamp(drag.elev + (e.clientY - drag.y) * 0.006, -0.05, 1.53); place(); };
    const onUp = () => { drag = null; };
    const onWheel = e => { if (!o.orbit) return; e.preventDefault(); s.user = true; s.move = null; s.radius = clamp(s.radius * (1 + Math.sign(e.deltaY) * 0.08), 3, 20); place(); };
    const onDbl = () => setView("hero");
    cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerup", onUp); cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false }); cv.addEventListener("dblclick", onDbl);

    // ---- frame loop: renders only when something changed or moves
    function frame(t) {
      if (s.disposed) return;
      s.raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      let moving = false;
      if (s.tween) {
        const k = clamp((t - (s.tween.t0 == null ? (s.tween.t0 = t) : s.tween.t0)) / MORPH_MS, 0, 1), e = EASE(k);
        if (k >= 1) { const tw = s.tween; s.tween = null; s.lastMs = build(tw.to, true); emit(); }
        else { build(mixParams(s.tween.from, s.tween.to, e), false); ghostRoot.visible = false; moving = true; }
      }
      if (s.move) {
        const m = s.move; if (m.t0 == null) m.t0 = t;
        const k = clamp((t - m.t0) / MOVE_MS, 0, 1), e = EASE(k), f = m.from, P = m.to;
        let da = P.azim - f.azim; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        s.azim = f.azim + da * e; s.elev = lerp(f.elev, P.elev, e); s.radius = lerp(f.radius, P.radius, e); s.target.lerpVectors(f.target, P.target, e);
        place(); moving = true; if (k >= 1) { s.move = null; s.swayT0 = t; }
      } else if (o.orbit && !s.rm && !s.user && !drag && s.view !== "top" && s.view !== "side") {
        const P = pose(s.view); s.azim = P.azim + SWAY.amp * Math.sin((t - s.swayT0) / 1000 * 2 * Math.PI / SWAY.period); place(); moving = true;
      }
      if (aeroTick(t)) moving = true;
      if (!s.dirty && !moving) return;
      s.dirty = false;
      render();
    }
    function render() { renderer.render(scene, camera); updateOverlay(); updateTags(); }
    function emit() { try { container.dispatchEvent(new CustomEvent("conceptview:design", { detail: { ms: s.lastMs, ghost: s.ghostParts || [] } })); } catch (e) { /* fine */ } }
    function mixParams(a, b, e) {
      const out = {};
      for (const part of Object.keys(b)) { out[part] = {}; for (const k of Object.keys(b[part])) { const x = a[part] && typeof a[part][k] === "number" ? a[part][k] : b[part][k], y = b[part][k]; const sp = parts.BY_ID[part] && parts.BY_ID[part].params[k]; out[part][k] = sp && sp.int ? (e < 0.5 ? x : y) : lerp(x, y, e); } }
      return out;
    }

    // ---- public API
    function setDesign(design, so) {
      if (!design || !design.params) throw new Error("conceptView.setDesign: a Design { params } is required");
      so = so || {};
      if (so.baseline !== undefined) { s.baseline = so.baseline ? JSON.parse(JSON.stringify(so.baseline)) : null; s.baseMass = s.baseline ? massOf(s.baseline) : null; }
      const prev = s.design; s.design = JSON.parse(JSON.stringify(design));
      s.mass = massOf(s.design, so.mass);
      const animate = so.animate !== false && !s.rm && !!prev;
      if (animate) { s.tween = { from: s.tween ? mixParams(s.tween.from, s.tween.to, 0.5) : prev.params, to: s.design.params, t0: null }; s.dirty = true; return { ms: null, pending: true }; }
      s.tween = null;
      s.lastMs = build(s.design.params, true); emit();
      return { ms: s.lastMs };
    }
    function setHighlight(ids) {
      s.highlight = new Set();
      for (const id of ids || []) for (const a of HIGHLIGHT_ALIAS[id] || [id]) s.highlight.add(a);
      for (const p of s.built) for (const mesh of p.meshes || []) if (mesh.isMesh && !mesh.userData.aux) mesh.material = materialFor(p, mesh.userData.sd);
      s.dirty = true;
    }
    function setMode(mode) {
      if (mode !== "solid" && mode !== "xray-mass") throw new Error("conceptView.setMode: 'solid' or 'xray-mass'");
      s.mode = mode;
      for (const p of s.built) for (const mesh of p.meshes || []) { if (mesh.isMesh && !mesh.userData.aux) { mesh.material = materialFor(p, mesh.userData.sd); mesh.castShadow = mode !== "xray-mass"; } else mesh.visible = mode !== "xray-mass"; }
      if (mode === "xray-mass") buildXray(); else { clearGroup(xrRoot); disposeList(s.xrGeos); s.tagRows = []; }
      xrRoot.visible = mode === "xray-mass";
      ghostRoot.visible = mode !== "xray-mass" && !!(s.ghostParts && s.ghostParts.length);
      renderer.shadowMap.needsUpdate = true; s.dirty = true;
    }
    function setAero(a) { if (!["cycle", "corner", "straight"].includes(a)) throw new Error("conceptView.setAero: cycle | corner | straight"); s.aero = a; s.smPhaseT0 = now(); if (a !== "cycle" || s.rm) { s.smT = a === "straight" ? 1 : 0; applyFlaps(); renderer.shadowMap.needsUpdate = true; } s.dirty = true; }
    function screenshot() {
      if (s.tween) { const tw = s.tween; s.tween = null; s.lastMs = build(tw.to, true); }
      renderer.render(scene, camera); updateOverlay();
      const w = cv.width, h = cv.height, c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
      g.drawImage(cv, 0, 0);
      const dpr = w / Math.max(1, cv.clientWidth), fs = Math.round(11 * dpr);
      g.font = fs + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"; g.textBaseline = "top";
      g.fillStyle = "#8a8a94"; g.textAlign = "right"; g.fillText(labelText(), w - 12 * dpr, 10 * dpr);
      g.textAlign = "left";
      const lines = legendLines().map(l => l.text || (l.html || "").replace(/<div[^]*$/, "").replace(/<[^>]+>/g, "")).filter(Boolean);
      lines.forEach((t, i) => g.fillText(t, 12 * dpr, h - (lines.length - i) * (fs + 4 * dpr) - 8 * dpr));
      return c.toDataURL("image/png");
    }
    function stats() { const i = renderer.info; return { ms: s.lastMs, geometries: i.memory.geometries, textures: i.memory.textures, programs: (i.programs || []).length, meshes: s.geos.length, ghost: s.ghostParts || [] }; }
    function dispose() {
      if (s.disposed) return; s.disposed = true; cancelAnimationFrame(s.raf);
      if (s.ro) s.ro.disconnect(); else root.removeEventListener("resize", resize);
      cv.removeEventListener("pointerdown", onDown); cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerup", onUp); cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("wheel", onWheel); cv.removeEventListener("dblclick", onDbl); document.removeEventListener("visibilitychange", onVis);
      disposeList(s.geos); disposeList(s.xrGeos); if (ghostCache) disposeList(ghostCache.geos);
      for (const m of Object.values(M)) m.dispose(); for (const m of hiCache.values()) m.dispose(); for (const m of xrCache.values()) m.dispose();
      for (const m of [ghostLine, ghostLineHidden, ghostFill, smLine, smFill, cogLineMat, cogBaseMat]) m.dispose(); cogMat.map.dispose(); cogMat.dispose();
      floor.geometry.dispose(); floor.material.dispose(); floorAlpha.dispose(); shadowPlane.geometry.dispose(); shadowPlane.material.dispose();
      if (scene.environment) scene.environment.dispose();
      renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
      for (const el of [cv, label, legend, tags]) if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    const onVis = () => { if (!document.hidden) s.dirty = true; }; document.addEventListener("visibilitychange", onVis);
    if (root.ResizeObserver) { s.ro = new ResizeObserver(resize); s.ro.observe(container); } else root.addEventListener("resize", resize);

    const P0 = pose(s.view); s.azim = P0.azim; s.elev = P0.elev; s.radius = P0.radius; s.target.copy(P0.target);
    resize();
    setDesign(o.design || (C.design ? C.design.baseline() : baselineDesign()), { baseline: o.baseline === undefined ? null : o.baseline, animate: false });
    if (s.mode !== "solid") setMode(s.mode);
    s.raf = requestAnimationFrame(frame);
    return {
      setDesign, setHighlight, setMode, setView, setAero, screenshot, labelText, stats, dispose,
      render: () => { if (s.tween) { const tw = s.tween; s.tween = null; s.lastMs = build(tw.to, true); } render(); },
      state: () => ({ mode: s.mode, view: s.view, aero: s.aero, straight: s.smT, ghost: (s.ghostParts || []).slice(), highlight: Array.from(s.highlight), ms: s.lastMs, layout: s.L }),
      el: container, canvas: cv,
    };
  }
  function baselineDesign() {
    const params = {}; for (const p of parts.CATALOGUE) { params[p.id] = {}; for (const k of Object.keys(p.params)) params[p.id][k] = p.params[k].base; }
    return { id: "baseline", label: "Baseline", params };
  }

  const api = { mount, layout, LABEL, EFFECTS, VIEWS, FIX, DEFAULTS, RAMP, reducedMotion, labelText: () => LABEL };
  EI.conceptView = api; C.view = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
