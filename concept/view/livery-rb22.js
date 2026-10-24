// PURPLE CONCEPT - concept car view: the 2026 Red Bull RB22 livery, painted in the concept car's own FIA frame (browser only).
// Laid out from the 2026 RB22 photos (docs/concept/rb22-refs/REFERENCES.md): gloss deep royal blue with a fine darker "jacquard"
// pattern, black engine-cover deck, floor and lower sidepods; sun-yellow airbox with the big red charging bull running back over
// the engine cover; yellow-to-orange nose with a red bull on each side; ORACLE large on the sidepod following its downward slope;
// the Red Bull wordmark (red, white keyline) on the pod's rear flank; ROKT by the halo; CARLYLE / 1Password / Hard Rock on the
// chassis; Ford + RACING on the cover's rear flank; the race number on a white tag on the fin and on the nose; bare-carbon front-wing
// main plane, navy flaps with "Red" / "Bull" in red and VISA; Mobil + Pegasus and AT&T on the front endplates; black rear wing with
// ORACLE on top, Mobil 1 and Heineken 0.0 on its endplates; black halo and mirrors.
//
// Coordinates: X mm rearward from the front axle, Z mm above the plank's top (the reference plane), Y mm to the right, on the
// RB22 baseline (XA -75, XC 1855, XPU 2235, XR 3400, ride height 35). concept/view/parts3d.js maps any design's surfaces onto this
// frame through the design's anchors (so decals stay on their parts when the cell or wheelbase changes) and calls:
//   EI.concept.liveryRB22.paint(g, tiles, size, car) -> fills the atlas canvas g (size px) tile by tile
//   .TILES (px at 4096) / .RANGES (world metres of the baseline car, the shader's projection ranges) / .ANCHORS / .BODY colours
// Partner artwork comes through EI.Ads (assets/brand/partners); a styled wordmark stands in where there is none.
// Concept geometry built to the design's dimensions · FIA 2026 frame · not a team CAD model.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});

  // ---------------------------------------------------------------- colours (sRGB, sampled on the daylight photos)
  const COL = {
    navy: "#08164f", navyHi: "#0e2378", navyDk: "#050c2e", black: "#0b0c10", deck: "#0d0e13", yellow: "#ffc414", yellowNose: "#ffcb24",
    orange: "#f39a1c", red: "#e2231a", white: "#ffffff", carbon: "#121317",
  };
  // the baseline's anchors (FIA X, mm) and ride height; parts3d maps a design's X through these
  const ANCHORS = { XR: 3400, XPU: 2235, XC: 1855, XA: -75, tip: -1215, rh: 35 };
  const wx = (X) => 1.75 - X / 1000, wy = (Z) => (Z + 10 + ANCHORS.rh) / 1000;
  // tiles of the atlas (px at 4096) and their projection ranges (baseline world metres: side [x0, x1, y0, y1], top [x0, x1, z0, z1])
  const TILES = {
    sideL: [0, 0, 4096, 960], sideR: [0, 960, 4096, 960], top: [0, 1920, 4096, 1440],
    fwT: [0, 3360, 720, 736], rwT: [720, 3360, 560, 736], epFL: [1280, 3360, 760, 368], epFR: [1280, 3728, 760, 368], epRL: [2040, 3360, 560, 368], epRR: [2040, 3728, 560, 368],
  };
  const RANGES = {
    main: { s: [wx(4150), wx(-1450), wy(-60), wy(1250)], t: [wx(4150), wx(-1450), -1.0, 1.0] },
    fw: { t: [wx(-350), wx(-1320), -0.75, 0.75] },
    rw: { t: [wx(XRp(760)), wx(XRp(100)), -0.62, 0.62] },
    epF: { s: [wx(-260), wx(-1300), wy(-20), wy(440)] },
    epR: { s: [wx(XRp(800)), wx(XRp(120)), wy(200), wy(920)] },
  };
  function XRp(d) { return ANCHORS.XR + d; }

  // ---------------------------------------------------------------- drawing kits
  // side kit for one tile: s = +1 right side (nose to the right), -1 left side (nose to the left); R = [x0, x1, y0, y1] (world m)
  function sideKit(g, tile, R, s, k) {
    const [ox, oy, w, h] = tile.map(v => v * k), px = w / (R[1] - R[0]), py = h / (R[3] - R[2]);
    const P = (X, Z) => [s > 0 ? ox + (wx(X) - R[0]) * px : ox + (R[1] - wx(X)) * px, oy + (R[3] - wy(Z)) * py];
    const mmx = px / 1000, mmy = py / 1000;   // canvas px per mm
    return {
      s, fwd: s, mm: mmx, P, ox, oy, w, h,
      clip(fn) { g.save(); g.beginPath(); g.rect(ox, oy, w, h); g.clip(); fn(); g.restore(); },
      path(pts) { g.beginPath(); pts.forEach(([X, Z], i) => { const p = P(X, Z); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.closePath(); },
      // smooth closed region through points (Catmull-Rom -> Bézier)
      blob(pts) { g.beginPath(); const n = pts.length, Q = pts.map(([X, Z]) => P(X, Z)); g.moveTo(Q[0][0], Q[0][1]);
        for (let i = 0; i < n; i++) { const p0 = Q[(i - 1 + n) % n], p1 = Q[i], p2 = Q[(i + 1) % n], p3 = Q[(i + 2) % n];
          g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]); }
        g.closePath(); },
      fill(col) { g.fillStyle = col; g.fill(); },
      // run fn at (X, Z) in screen millimetres (x right, y down, no mirroring), rotated by rot (rad, screen)
      at(X, Z, fn, rot) { const p = P(X, Z); g.save(); g.translate(p[0], p[1]); if (rot) g.rotate(rot); g.scale(mmx, mmy); fn(); g.restore(); },
    };
  }
  // top kit: (X, Y) -> tile px; text helpers read from the rear (rot +90°) or from the front (rot -90°)
  function topKit(g, tile, R, k) {
    const [ox, oy, w, h] = tile.map(v => v * k), pu = w / (R[1] - R[0]), pv = h / (R[3] - R[2]);
    const P = (X, Y) => [ox + (wx(X) - R[0]) * pu, oy + (Y / 1000 - R[2]) * pv];
    const mmu = pu / 1000, mmv = pv / 1000;
    return {
      P, ox, oy, w, h, mm: mmu,
      clip(fn) { g.save(); g.beginPath(); g.rect(ox, oy, w, h); g.clip(); fn(); g.restore(); },
      path(pts) { g.beginPath(); pts.forEach(([X, Y], i) => { const p = P(X, Y); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.closePath(); },
      blob(pts) { g.beginPath(); const n = pts.length, Q = pts.map(([X, Y]) => P(X, Y)); g.moveTo(Q[0][0], Q[0][1]);
        for (let i = 0; i < n; i++) { const p0 = Q[(i - 1 + n) % n], p1 = Q[i], p2 = Q[(i + 1) % n], p3 = Q[(i + 2) % n];
          g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]); }
        g.closePath(); },
      fill(col) { g.fillStyle = col; g.fill(); },
      // screen-mm frame at (X, Y): reads from the front (text up = rearward) unless fromRear
      at(X, Y, fn, fromRear, extraRot) { const p = P(X, Y); g.save(); g.translate(p[0], p[1]); g.rotate((fromRear ? Math.PI / 2 : -Math.PI / 2) + (extraRot || 0)); g.scale(mmv, mmu); fn(); g.restore(); },
    };
  }

  // ---------------------------------------------------------------- logos and lettering (screen mm at the current origin)
  const Ads = () => EI.Ads;
  const has = (id) => !!(Ads() && Ads().hasPartner && Ads().hasPartner(id));
  function logo(g, id, w, h, tone, fallback) {
    if (has(id)) { Ads().drawPartner(g, id, 0, 0, w, h, { tone: tone || "color" }); return; }
    if (fallback) fallback(); else word(g, String(id).toUpperCase(), h * 0.8, tone && tone.indexOf("mono:") === 0 ? tone.slice(5) : COL.white, { w: 800, maxW: w });
  }
  function word(g, str, cap, col, o) {
    o = o || {}; g.save(); g.font = (o.it ? "italic " : "") + (o.w || 800) + " " + cap.toFixed(1) + "px " + (o.ff || '"Titillium Web", Arial, sans-serif');
    if (Ads() && Ads().setLS) Ads().setLS(g, (o.ls || 0) * cap);
    g.textAlign = "center"; g.textBaseline = "middle";
    const tw = g.measureText(str).width; if (o.maxW && tw > o.maxW) g.scale(o.maxW / tw, 1);
    if (o.line) { g.lineWidth = o.line[0]; g.strokeStyle = o.line[1]; g.lineJoin = "round"; g.strokeText(str, 0, cap * 0.04); }
    g.fillStyle = col; g.fillText(str, 0, cap * 0.04);
    if (Ads() && Ads().setLS) Ads().setLS(g, 0); g.restore();
  }
  // a logo with a keyline: the logo in `line` tone at 12 offsets, then the logo itself
  function keylined(g, id, w, h, tone, line, d) {
    if (!has(id)) return false;
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); Ads().drawPartner(g, id, 0, 0, w, h, { tone: line }); g.restore(); }
    Ads().drawPartner(g, id, 0, 0, w, h, { tone }); return true;
  }
  // the charging bull facing +x (screen right), red with a yellow keyline; w x h box (mm)
  function bull(g, w, h, line, col) {
    if (has("redbullbull")) { if (line) keylined(g, "redbullbull", w, h, "mono:" + (col || COL.red), "mono:" + line, Math.max(3, h * 0.03)); else Ads().drawPartner(g, "redbullbull", 0, 0, w, h, { tone: "mono:" + (col || COL.red) }); return; }
    // fallback silhouette
    g.save(); g.scale(w / 100, h / 50); g.fillStyle = col || COL.red; g.beginPath();
    [[-48, 10], [-30, -8], [-6, -12], [14, -16], [30, -22], [40, -16], [48, -20], [44, -8], [50, 2], [36, 4], [30, 18], [22, 8], [0, 10], [-12, 22], [-20, 12], [-36, 22], [-44, 18]].forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
    g.closePath(); g.fill(); g.restore();
  }
  function mobil(g, w, h, one) {
    const tw = one ? w * 0.78 : w;
    g.save(); if (one) g.translate(-(w - tw) / 2, 0);
    if (has("mobil")) Ads().drawPartner(g, "mobil", 0, 0, tw, h, { tone: "whiteKeepRed" });
    else word(g, "Mobil", h * 0.9, COL.white, { w: 700, maxW: tw });
    g.restore();
    if (one) { const bx = w / 2 - h * 0.42, s = h * 0.8; g.strokeStyle = COL.white; g.lineWidth = s * 0.09; g.strokeRect(bx - s / 2, -s / 2, s, s); g.save(); g.translate(bx, 0); word(g, "1", s * 0.8, COL.white, { w: 700, ff: "Arial, Helvetica, sans-serif" }); g.restore(); }
  }
  function pegasus(g, w, fwd) {   // Mobil's red Pegasus, facing the direction of travel
    g.save(); g.scale(fwd * w / 30, w / 30); g.fillStyle = "#ef1c25"; g.beginPath();
    [[-12, 4], [-6, -2], [0, -2], [6, -10], [14, -14], [8, -6], [12, -4], [16, 0], [10, 2], [6, 2], [4, 8], [8, 14], [4, 14], [0, 8], [-4, 8], [-8, 14], [-12, 14], [-8, 6]].forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
    g.closePath(); g.fill(); g.restore();
  }
  function numberTag(g, num, w, h, opts) {   // white rounded tag with a red slanted number
    opts = opts || {};
    g.save(); g.fillStyle = COL.white; if (Ads() && Ads().rr) Ads().rr(g, -w / 2, -h / 2, w, h, Math.min(w, h) * (opts.round || 0.22)); else { g.beginPath(); g.rect(-w / 2, -h / 2, w, h); } g.fill();
    g.transform(1, 0, -0.14, 1, 0, 0); word(g, String(num), h * 0.86, COL.red, { w: 900, it: 0, ff: '"Titillium Web", Arial, sans-serif', maxW: w * 0.9 }); g.restore();
  }

  // ---------------------------------------------------------------- the paint (base + jacquard)
  // navy with the fine jacquard weave (darker diamonds, density varying along the car), drawn into the current clip
  function jacquard(g, x0, y0, w, h, mmPx, seed) {
    const cell = Math.max(3, 16 * mmPx), r = cell * 0.3;
    let s = seed || 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.save(); g.fillStyle = "rgba(4,8,30,0.2)";
    for (let y = y0; y < y0 + h + cell; y += cell) for (let x = x0 + ((Math.round((y - y0) / cell) % 2) * cell) / 2; x < x0 + w + cell; x += cell) {
      const dens = 0.5 + 0.5 * Math.sin(x * 0.0021 + y * 0.0013) * Math.cos(x * 0.0007 - y * 0.0031);
      if (rnd() > 0.25 + 0.6 * dens) continue;
      const rr = r * (0.55 + 0.45 * rnd()); g.beginPath(); g.moveTo(x, y - rr); g.lineTo(x + rr, y); g.lineTo(x, y + rr); g.lineTo(x - rr, y); g.closePath(); g.fill();
    }
    g.restore();
  }
  function navyBase(g, K, seed) {
    const grd = g.createLinearGradient(0, K.oy, 0, K.oy + K.h); grd.addColorStop(0, COL.navyHi); grd.addColorStop(0.45, COL.navy); grd.addColorStop(1, COL.navyDk);
    g.fillStyle = grd; g.fillRect(K.ox, K.oy, K.w, K.h); jacquard(g, K.ox, K.oy, K.w, K.h, K.mm, seed);
  }

  // ---------------------------------------------------------------- side view (one side)
  function side(g, K, car) {
    const { fwd } = K, num = car.num;
    K.clip(() => {
      navyBase(g, K, K.s > 0 ? 11 : 23);
      // black: floor edge, lower sidepods and chassis bottom (a soft-edged band rising from the nose to the gearbox), the engine
      // cover's top deck behind the airbox, the crash structure
      K.blob([[-1500, -80], [-1500, 140], [-600, 168], [200, 196], [900, 250], [1350, 320], [1900, 340], [2500, 322], [3000, 300], [3500, 330], [4200, 360], [4200, -80]]); K.fill(COL.black);
      K.blob([[2750, 1300], [2780, 860], [2950, 806], [3300, 760], [3600, 660], [4200, 600], [4200, 1300]]); K.fill(COL.deck);
      // the airbox sun: yellow over the intake's flanks and the hoop
      const sun = g.createLinearGradient(...K.P(1440, 0), ...K.P(1900, 0)); sun.addColorStop(0, COL.yellow); sun.addColorStop(0.7, "#ffb51a"); sun.addColorStop(1, COL.orange);
      K.blob([[1380, 1080], [1400, 800], [1540, 772], [1760, 772], [1930, 800], [1960, 940], [1760, 1080]]); K.fill(sun);
      // the big charging bull over the engine cover, head at the sun, with its yellow keyline
      K.at(2330, 818, () => { g.scale(fwd, 1); bull(g, 1300, 420, COL.yellow); }, -0.07 * fwd);
      // nose: yellow tip grading to orange, the boundary sweeping back along the bottom; red bull on it
      const ng = g.createLinearGradient(...K.P(-1250, 0), ...K.P(-300, 0)); ng.addColorStop(0, COL.yellowNose); ng.addColorStop(0.55, "#ffb623"); ng.addColorStop(1, COL.orange);
      K.blob([[-1300, 120], [-1300, 330], [-900, 384], [-560, 448], [-380, 470], [-300, 400], [-240, 236], [-340, 168], [-800, 150]]); K.fill(ng);
      K.at(-780, 300, () => { g.scale(fwd, 1); bull(g, 400, 160, null); }, -0.12 * fwd);
      // sidepod: ORACLE along the pod's downward slope; the Red Bull wordmark on the rear flank; Hard Rock by the inlet
      K.at(1560, 470, () => logo(g, "oracle", 1080, 150, "white"), -0.085 * fwd);
      K.at(2470, 515, () => { if (!keylined(g, "redbull", 500, 130, "color", "white", 6)) word(g, "Red Bull", 110, COL.red, { w: 900, line: [14, COL.white] }); }, -0.03 * fwd);
      K.at(860, 400, () => logo(g, "hardrock", 100, 52, "color"));
      // cockpit side / chassis: CARLYLE, 1Password; ROKT by the halo rear mount; TAG Heuer by the inlet
      K.at(740, 560, () => word(g, "CARLYLE", 62, COL.white, { w: 700, ff: 'Georgia, "Times New Roman", serif', ls: 0.12, maxW: 330 }));
      K.at(740, 488, () => { if (has("1password")) { g.save(); g.translate(-112, 0); Ads().drawPartner(g, "1password", 0, 0, 46, 46, { tone: "white" }); g.restore(); word(g, "1Password", 44, COL.white, { w: 700, maxW: 230 }); } else word(g, "1Password", 44, COL.white, { w: 700 }); });
      K.at(1560, 712, () => word(g, "ROKT", 64, COL.white, { w: 900, ls: 0.04 }));
      // floor-edge / lower-pod partners (white on black)
      K.at(2300, 262, () => word(g, "CLEAR", 34, COL.white, { w: 700, ls: 0.08 }));
      K.at(2560, 262, () => logo(g, "siemens", 200, 34, "white"));
      K.at(1180, 200, () => logo(g, "indeed", 240, 60, "white"));
      // Ford + RACING on the cover's rear flank above the rear tyre
      K.at(2980, 640, () => logo(g, "ford", 170, 66, "color"));
      K.at(2980, 590, () => word(g, "RACING", 28, COL.white, { w: 700, ls: 0.16 }));
      // race number on a white tag on the fin; driver code and flag by the cockpit
      K.at(3060, 770, () => numberTag(g, num, 150, 124));
      if (car.code) K.at(1140, 616, () => word(g, car.code, 36, COL.white, { w: 900, it: 1 }));
    });
  }
  // ---------------------------------------------------------------- top view
  function top(g, K, car) {
    K.clip(() => {
      navyBase(g, K, 5);
      // engine cover deck (black) behind the airbox, narrowing to the fin; the sun on the hoop
      K.blob([[2750, -120], [3000, -110], [3500, -80], [4200, -70], [4200, 70], [3500, 80], [3000, 110], [2750, 120]]); K.fill(COL.deck);
      K.blob([[1395, -170], [1395, 170], [1640, 190], [1780, 120], [1780, -120], [1640, -190]]); K.fill(COL.yellow);
      // the bulls' backs where the cover's flanks turn up (they wrap from the sides)
      for (const s of [-1, 1]) K.blob([[1760, s * 150], [2300, s * 150], [2700, s * 135], [2700, s * 175], [2300, s * 205], [1760, s * 205]]), K.fill(COL.red);
      // nose: yellow from the tip, the number tag behind it, the partner stack on the chassis top (reads from the front)
      const ng = g.createLinearGradient(...K.P(-1250, 0), ...K.P(-300, 0)); ng.addColorStop(0, COL.yellowNose); ng.addColorStop(0.6, "#ffb623"); ng.addColorStop(1, COL.orange);
      K.blob([[-1300, -150], [-1300, 150], [-700, 150], [-430, 110], [-360, 0], [-430, -110], [-700, -150]]); K.fill(ng);
      K.at(-1040, 0, () => logo(g, "ford", 120, 46, "color"));
      K.at(300, 0, () => numberTag(g, car.num, 150, 118, { round: 0.5 }));
      K.at(80, 0, () => logo(g, "visa", 170, 52, "white"));
      K.at(-80, 0, () => logo(g, "att", 170, 46, "white"));
      K.at(-210, 0, () => word(g, "CARLYLE", 34, COL.white, { w: 700, ff: 'Georgia, "Times New Roman", serif', ls: 0.12, maxW: 180 }));
      K.at(-320, 0, () => logo(g, "pirelli", 170, 38, "color"));
      K.at(470, 0, () => logo(g, "tagheuer", 90, 70, "color"));
    });
  }
  // ---------------------------------------------------------------- front wing top: carbon main plane, navy flaps, "Red" / "Bull", VISA
  function fwTop(g, K) {
    K.clip(() => {
      g.fillStyle = COL.navyDk; g.fillRect(K.ox, K.oy, K.w, K.h); jacquard(g, K.ox, K.oy, K.w, K.h, K.mm, 3);
      // red lettering across the flaps: "Red" on the car's right half, "Bull" on the left (as read from in front)
      K.at(-830, 370, () => word(g, "Red", 230, COL.red, { w: 900, line: [22, COL.white], maxW: 500 }));
      K.at(-830, -370, () => word(g, "Bull", 230, COL.red, { w: 900, line: [22, COL.white], maxW: 540 }));
      for (const s of [-1, 1]) K.at(-610, s * 330, () => logo(g, "visa", 260, 80, "white"));
    });
  }
  // ---------------------------------------------------------------- rear wing top: black, ORACLE on the flap (reads from behind)
  function rwTop(g, K) {
    K.clip(() => {
      g.fillStyle = COL.black; g.fillRect(K.ox, K.oy, K.w, K.h);
      K.at(XRp(480), 0, () => logo(g, "oracle", 900, 150, "white"), true);
      K.at(XRp(250), 0, () => word(g, "redbullracing.com", 40, "rgba(255,255,255,0.75)", { w: 700 }), true);
    });
  }
  // ---------------------------------------------------------------- endplates (side projections, one per side)
  function fwEnd(g, K) {
    K.clip(() => {
      g.fillStyle = COL.navyDk; g.fillRect(K.ox, K.oy, K.w, K.h); jacquard(g, K.ox, K.oy, K.w, K.h, K.mm, 9);
      K.at(-760, 250, () => mobil(g, 300, 76, false));
      K.at(-700, 160, () => pegasus(g, 70, K.fwd));
      K.at(-1060, 320, () => logo(g, "att", 150, 44, "white"));
    });
  }
  function rwEnd(g, K) {
    K.clip(() => {
      const grd = g.createLinearGradient(...K.P(0, 900), ...K.P(0, 300)); grd.addColorStop(0, COL.navy); grd.addColorStop(0.55, COL.navyDk); grd.addColorStop(1, COL.black);
      g.fillStyle = grd; g.fillRect(K.ox, K.oy, K.w, K.h); jacquard(g, K.ox, K.oy, K.w, K.h, K.mm, 13);
      K.at(XRp(450), 820, () => mobil(g, 400, 92, true));
      K.at(XRp(430), 640, () => logo(g, "heineken", 240, 70, "whiteKeepRed"));
    });
  }

  // ---------------------------------------------------------------- the atlas
  function paint(g, size, car) {
    const k = size / 4096;
    side(g, sideKit(g, TILES.sideL, RANGES.main.s, -1, k), car);
    side(g, sideKit(g, TILES.sideR, RANGES.main.s, 1, k), car);
    top(g, topKit(g, TILES.top, RANGES.main.t, k), car);
    fwTop(g, topKit(g, TILES.fwT, RANGES.fw.t, k));
    rwTop(g, topKit(g, TILES.rwT, RANGES.rw.t, k));
    fwEnd(g, sideKit(g, TILES.epFL, RANGES.epF.s, -1, k)); fwEnd(g, sideKit(g, TILES.epFR, RANGES.epF.s, 1, k));
    rwEnd(g, sideKit(g, TILES.epRL, RANGES.epR.s, -1, k)); rwEnd(g, sideKit(g, TILES.epRR, RANGES.epR.s, 1, k));
  }
  // base colours of the painted parts when no projection reaches them (and the colour roles parts3d resolves)
  const BODY = { body: COL.navy, fin: COL.navy, mirror: COL.black, halo: COL.black, fwEnd: COL.navyDk, fwFlap: COL.navyDk, fwMain: COL.carbon, rwEnd: COL.navyDk, rwMain: COL.black, rwFlap: COL.black };

  C.liveryRB22 = { paint, TILES, RANGES, ANCHORS, BODY, COL, team: "redbull" };
  if (typeof module !== "undefined" && module.exports) module.exports = C.liveryRB22;
})();
