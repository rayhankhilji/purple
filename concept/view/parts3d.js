// PURPLE CONCEPT - the concept car's geometry for concept/view/view3d.js (browser, THREE r128): the game's high-detail car
// (EI.CarGLB.cache.hi, js/carglb.js materials, the team livery) deformed to a Design's layout, plus procedural high-detail
// replacements for the parts the optimiser changes most. Schematic, not a CAD model.
//
//   const car = EI.concept.parts3d.createCar({ THREE, o, carRoot, mirror, ghostRoot, hiRoot })
//   car.setLayout(L)            L = conceptView.layout(params): deform the body, rebuild the procedural parts whose inputs changed
//   car.setGhost(baseL | null)  -> [part ids]  the baseline car, purple, weighted per vertex by how far it moved (hidden if equal)
//   car.hideGhost(); car.setFlaps(t 0..1); car.setHighlight(Set of region ids); car.setXray(colourFn | null); car.stats(); car.dispose()
//
// GLB body (sprung): x is remapped by a monotone cubic through the design's anchors (cell front XA, cockpit rear XC, ICE face XPU,
// rear axle XR; the nose tip stays with the front wing), y moves with the ride height, the sidepods are re-shaped in place (inlet
// mouth scaled about its centre, the lower outer flank pushed in by the undercut). Wheels stay on the ground: the front ones fixed,
// the rear ones with XR; suspension members blend from the body (inboard) to the upright (outboard).
// Procedural: front wing (n lofted cambered sections, slot gaps, spanwise twist / chord taper / tip rise, endplates with the livery's
// endplate decals, footplates), rear wing (n elements, spoon centre, endplates up to the endplate-top parameter with the livery's
// decals, swan-neck pylons, actuator pod; flap rotates about its trailing edge inboard of Y=535), floor (planform from the width,
// upturned edge, fences and venturi inlets under the leading edge, tunnel roof from the throat), diffuser (ramp at the expansion
// angle, strakes, exit lip), plank.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const ss = (a, b, x) => sstep((x - a) / (b - a));
  const rad = d => d * Math.PI / 180;

  // monotone cubic (Fritsch-Carlson) through (xs ascending, ys); slope 1 outside (rigid translation of the ends)
  function monoCubic(xs, ys) {
    const n = xs.length, d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    // the ends blend to slope 1 (rigid) over the first / last segment's tangent
    const f = (x) => {
      if (x <= xs[0]) return ys[0] + (x - xs[0]);
      if (x >= xs[n - 1]) return ys[n - 1] + (x - xs[n - 1]);
      let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
    const df = (x) => (x <= xs[0] || x >= xs[n - 1] ? 1 : (f(x + 1e-4) - f(x - 1e-4)) / 2e-4);
    return { f, df };
  }

  // ---------------------------------------------------------------- airfoils and wing element chains
  // cambered section, unit chord, inverted (camber line bows down: a downforce profile), u rearward, v up; returned as two
  // polylines that share the LE and TE points: upper (TE -> LE) and lower (LE -> TE). Cosine spacing, finite TE (0.25 % chord).
  function foil(m, p, t, N) {
    const up = [], lo = [];
    for (let i = 0; i <= N; i++) {
      const u = 0.5 - 0.5 * Math.cos(Math.PI * i / N);
      const yc = -(u < p ? m / (p * p) * (2 * p * u - u * u) : m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * u - u * u));
      const dyc = -(u < p ? 2 * m / (p * p) * (p - u) : 2 * m / ((1 - p) * (1 - p)) * (p - u)), th = Math.atan(dyc);
      const yt = 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u) + 0.00125 * u;
      up.push([u - yt * Math.sin(th), yc + yt * Math.cos(th)]); lo.push([u + yt * Math.sin(th), yc - yt * Math.cos(th)]);
    }
    return { upper: up.reverse(), lower: lo };
  }
  const FOIL_MAIN = foil(0.075, 0.42, 0.115, 22), FOIL_FLAP = foil(0.095, 0.4, 0.085, 18);
  // element angles (deg) from the wing setting: main plane low, flaps around the setting (their mean = the setting, schematic scale)
  function elementAngles(n, aoa, mainK) {
    if (n <= 1) return [0.5 * aoa];
    const out = [mainK * aoa], f = n - 1;
    for (let i = 0; i < f; i++) out.push(aoa * (f === 1 ? 1 : 0.8 + 0.4 * i / (f - 1)));
    return out;
  }
  const SHARES = { 1: [1], 2: [1, 0.62], 3: [1, 0.56, 0.46], 4: [1, 0.5, 0.42, 0.36] };
  // the element chain in a 2D section (x rearward, z up, mm) with the main-plane LE at (0, 0): [{ le:[x,z], c, a (rad) }], X extent = chord
  function chain(n, angles, chord) {
    const sh = SHARES[Math.max(1, Math.min(4, n))], el = []; let le = [0, 0];
    for (let i = 0; i < sh.length; i++) {
      const a = rad(angles[i]), c = sh[i], ca = Math.cos(a), sa = Math.sin(a);
      el.push({ le: le.slice(), c, a });
      const te = [le[0] + c * ca, le[1] + c * sa];
      // next element: its LE tucked under this one's TE (overlap 11 % of this chord) with a slot gap of 2.4 % of the main chord
      le = [te[0] - 0.11 * c * ca - 0.024 * -sa, te[1] - 0.11 * c * sa + 0.024 * ca];
    }
    let x0 = 0, x1 = 0; for (const e of el) { x0 = Math.min(x0, e.le[0]); x1 = Math.max(x1, e.le[0] + e.c * Math.cos(e.a)); }
    const s = chord / Math.max(1e-6, x1 - x0);
    return el.map(e => ({ le: [e.le[0] * s, e.le[1] * s], c: e.c * s, a: e.a }));
  }
  // a foil polyline placed at LE (x, z) mm, chord c, angle a (TE up), optional extra rotation d about pivot (px, pz)
  function placeFoil(poly, le, c, a, d, piv) {
    const ca = Math.cos(a), sa = Math.sin(a), out = [];
    for (const [u, v] of poly) {
      let x = le[0] + c * (u * ca - v * sa), z = le[1] + c * (u * sa + v * ca);
      if (d) { const cd = Math.cos(d), sd = Math.sin(d), dx = x - piv[0], dz = z - piv[1]; x = piv[0] + dx * cd - dz * sd; z = piv[1] + dx * sd + dz * cd; }
      out.push([x, z]);
    }
    return out;
  }

  // ---------------------------------------------------------------- geometry helpers
  // loft of rings (equal length arrays of [x, y, z] world metres) -> indexed BufferGeometry, smooth normals; closed: wrap each ring
  function loftGeo(THREE, rings, o) {
    o = o || {}; const nR = rings.length, nP = rings[0].length, closed = !!o.closed, caps = !!o.caps;
    const nV = nR * nP + (caps ? 2 * (nP + 1) : 0), pos = new Float32Array(nV * 3), uv = new Float32Array(nV * 2); let v = 0;
    const put = (p, u, w) => { pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2]; uv[v * 2] = u; uv[v * 2 + 1] = w; return v++; };
    for (let r = 0; r < nR; r++) for (let i = 0; i < nP; i++) put(rings[r][i], i / (nP - 1), r / (nR - 1));
    const idx = [], segs = closed ? nP : nP - 1;
    for (let r = 0; r < nR - 1; r++) for (let i = 0; i < segs; i++) { const a = r * nP + i, b = r * nP + (i + 1) % nP, c = a + nP, e = b + nP; idx.push(a, c, b, b, c, e); }
    if (caps) for (const ri of [0, nR - 1]) {
      const ring = rings[ri], cen = [0, 0, 0]; for (const p of ring) { cen[0] += p[0] / nP; cen[1] += p[1] / nP; cen[2] += p[2] / nP; }
      const c0 = put(cen, 0.5, 0.5), st = v; for (const p of ring) put(p, 0.5, 0.5);
      for (let i = 0; i < nP - (closed ? 0 : 1); i++) idx.push(c0, st + i, st + (i + 1) % nP);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(nV > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1)); g.computeVertexNormals();
    return g;
  }
  // rounded 2D profile: points [[a, b, r]] (r = corner radius) -> dense polyline (closed)
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
  // a plate: a closed 2D outline (in the x-z world plane, metres) extruded across `th` metres at world z = z0 (centre), bevelled
  function plateGeo(THREE, outline, z0, th, bevel) {
    const sh = new THREE.Shape(); outline.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
    const bv = Math.min(bevel || 0.003, th * 0.45);
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(1e-4, th - 2 * bv), bevelEnabled: true, bevelThickness: bv, bevelSize: bv * 0.9, bevelSegments: 3, curveSegments: 4 });
    g.translate(0, 0, z0 - (th - 2 * bv) / 2);
    g.computeVertexNormals();
    return g;
  }
  // a swept blade: centre-line points [[x, y, z]] (world), half thickness tw (across z) and half chord tc (in the x-y plane, across the path)
  function bladeGeo(THREE, path, tw, tc, zOff) {
    const rings = [], N = 12;
    for (let i = 0; i < path.length; i++) {
      const p = path[i], q = path[Math.min(path.length - 1, i + 1)], r = path[Math.max(0, i - 1)];
      let tx = q[0] - r[0], ty = q[1] - r[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx, ring = [];
      for (let k = 0; k < N; k++) {
        const ang = 2 * Math.PI * k / N, cx = Math.cos(ang), sz = Math.sin(ang);
        const along = tc * Math.sign(cx) * Math.pow(Math.abs(cx), 0.6), across = tw * Math.sign(sz) * Math.pow(Math.abs(sz), 0.6);
        ring.push([p[0] + nx * along, p[1] + ny * along, (zOff || 0) + p[2] + across]);
      }
      rings.push(ring);
    }
    return loftGeo(THREE, rings, { closed: true, caps: true });
  }

  // ---------------------------------------------------------------- the car
  function createCar(ctx) {
    const { THREE, o, carRoot, mirror, ghostRoot, hiRoot } = ctx, V = C.view._internal, GLB = C.view.GLB, FIX = C.view.FIX, G = EI.CarGLB;
    const RID = V.RID, wx = V.wx;
    const team = (EI.TEAM_BY_ID && EI.TEAM_BY_ID[o.team]) || (EI.TEAMS && EI.TEAMS[0]);
    const drv = (team.drivers || [])[o.driver || 0] || null;
    const car = { team, num: drv ? drv.num : 1, driver: drv, isPlayer: false, name: null };
    const code = G.carCode(car);
    const disposables = [];
    const keep = (x) => { disposables.push(x); return x; };

    // ---- materials: the game's livery and materials; procedural parts in the livery's part colours
    const livery = G.composeLivery(team, car.num, code, o.liverySize);
    const pc = (EI.LIVERIES && EI.LIVERIES.partColours) ? EI.LIVERIES.partColours(team) : { body: team.primary, fwFlap: team.secondary, fwEnd: team.primary, rwMain: team.primary, rwEnd: team.secondary, rwFlap: team.secondary };
    const paint = keep(V.paintMaterial(livery));
    const helmetM = keep(V.helmetMaterial(car)), coverM = keep(V.coverMaterial(team));
    let sharedCarbon = null; G.cache.hi.traverse((m) => { if (m.isMesh && m.material && m.material.name === "carbon" && !sharedCarbon) sharedCarbon = m.material; });
    const carbon2 = (() => { const m = sharedCarbon.clone(); m.onBeforeCompile = sharedCarbon.onBeforeCompile; m.customProgramCacheKey = sharedCarbon.customProgramCacheKey; m.side = THREE.DoubleSide; m.envMapIntensity = 0.5; return keep(m); })();
    const floorCarbon = (() => { const m = carbon2.clone(); m.onBeforeCompile = sharedCarbon.onBeforeCompile; m.customProgramCacheKey = sharedCarbon.customProgramCacheKey; m.color = new THREE.Color(0.62, 0.62, 0.66); m.clearcoat = 0.2; m.envMapIntensity = 0.35; return keep(m); })();
    const solid = (hex, o2) => keep(V.paintMaterial(null, Object.assign({ color: hex }, o2 || {})));
    const fwMainPainted = !!(EI.LIVERIES && EI.LIVERIES.hasFrontWing && EI.LIVERIES.hasFrontWing(team.id));
    const M = {
      fwMain: fwMainPainted ? solid(pc.fwFlap || pc.body) : carbon2, fwFlap: solid(pc.fwFlap || team.secondary), rwMain: solid(pc.rwMain || pc.body), rwFlap: solid(pc.rwFlap || team.secondary),
      plank: keep(new THREE.MeshStandardMaterial({ color: V.srgb(0x2a1f17), roughness: 0.75, metalness: 0, side: THREE.DoubleSide })),
      metal: keep(new THREE.MeshStandardMaterial({ color: V.srgb(0x8a8e96), roughness: 0.32, metalness: 0.95, side: THREE.DoubleSide })),
      tyreWall: keep(new THREE.MeshStandardMaterial({ map: keep(V.tyreWallTexture((EI.TYRES && EI.TYRES.medium && EI.TYRES.medium.color) || "#f5d000")), transparent: true, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    };
    // livery decals for the procedural endplates and the rear wing's top: the team's own side / top designs (js/liveries.js), drawn
    // in the game car's coordinates into an atlas; each part maps its own normalised position onto the game car's matching part
    const atlas = buildAtlas();
    const epRear = keep(V.paintMaterial(atlas.tex)), epFront = keep(V.paintMaterial(atlas.tex));
    const rwTopMain = keep(V.paintMaterial(atlas.tex)), rwTopFlap = keep(V.paintMaterial(atlas.tex));
    function buildAtlas() {
      const S = 2048, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
      // tiles: [px x, px y, w, h, kind, side, ref rect {x0, x1, y0, y1} (side: x forward / y up; top: x / z), base colour]
      const T = {
        rearR: [0, 0, 1024, 1024, "side", 1, { x0: -2.48, x1: -1.8, y0: 0.36, y1: 1.04 }, pc.rwEnd || pc.body],
        rearL: [1024, 0, 1024, 1024, "side", -1, { x0: -2.48, x1: -1.8, y0: 0.36, y1: 1.04 }, pc.rwEnd || pc.body],
        frontR: [0, 1024, 1024, 512, "side", 1, { x0: 2.15, x1: 3.15, y0: 0.05, y1: 0.55 }, pc.fwEnd || pc.body],
        frontL: [1024, 1024, 1024, 512, "side", -1, { x0: 2.15, x1: 3.15, y0: 0.05, y1: 0.55 }, pc.fwEnd || pc.body],
        topMain: [0, 1536, 1024, 512, "top", 1, { x0: -2.44, x1: -1.79, z0: -0.66, z1: 0.66 }, pc.rwMain || pc.body],
        topFlap: [1024, 1536, 1024, 512, "top", 1, { x0: -2.44, x1: -1.79, z0: -0.66, z1: 0.66 }, pc.rwFlap || pc.body],
      };
      const LV = EI.LIVERIES, MM = 1000, tid = team.id;
      for (const k of Object.keys(T)) {
        const [px, py, w, h, kind, s, R, base] = T[k];
        g.save(); g.beginPath(); g.rect(px, py, w, h); g.clip(); g.fillStyle = base; g.fillRect(px, py, w, h);
        try {
          if (kind === "side" && LV && LV.sideKit) {
            const ppm = w / (R.x1 - R.x0); g.setTransform(ppm / MM, 0, 0, ppm / MM, px + (s > 0 ? -R.x0 : R.x1) * ppm, py + R.y1 * ppm);
            const kit = LV.sideKit(g, s);
            if (k.startsWith("front") && LV.hasEndplate && LV.hasEndplate(tid)) LV.endplate(g, kit, team, car.num, code);
            else if (LV.has && LV.has(tid)) LV.side(g, kit, team, car.num, code);
          } else if (kind === "top" && LV && LV.has && LV.has(tid) && LV.top) {
            const ppm = w / (R.z1 - R.z0); g.setTransform(ppm / MM, 0, 0, ppm / MM, px - R.z0 * ppm, py + R.x1 * ppm);
            const at = (x, z, fn, rot) => { g.save(); g.translate(z * MM, -x * MM); if (rot) g.rotate(rot); fn(); g.restore(); };
            const tk = {
              at, txt: (str, x, z, cap, col, font, rot) => at(x, z, () => { g.font = font.replace("%", (cap * MM).toFixed(1) + "px"); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = col; g.fillText(str, 0, 0); }, rot),
              dec: (spec, x, z, cap, maxW, rot) => at(x, z, () => EI.Ads.drawDecal(g, spec, 0, 0, cap * MM, maxW * MM), rot),
              rect: (x0, x1, z0, z1, col) => { g.fillStyle = col; g.fillRect(z0 * MM, -x1 * MM, (z1 - z0) * MM, (x1 - x0) * MM); },
              poly: (pts, col) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(z * MM, -x * MM) : g.moveTo(z * MM, -x * MM))); g.closePath(); g.fillStyle = col; g.fill(); },
            };
            LV.top(g, tk, team, car.num);
          }
        } catch (e) { console.warn("conceptView: livery decal tile " + k + " skipped", e); }
        g.restore();
      }
      const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8; keep(tex);
      // uv of a reference point (game-car coordinates) in a tile
      const uvOf = (k, a, b) => { const [px, py, w, h, kind, s, R] = T[k]; let u, v;
        if (kind === "side") { u = s > 0 ? (a - R.x0) / (R.x1 - R.x0) : (R.x1 - a) / (R.x1 - R.x0); v = (R.y1 - b) / (R.y1 - R.y0); }
        else { u = (b - R.z0) / (R.z1 - R.z0); v = (R.x1 - a) / (R.x1 - R.x0); }
        return [(px + clamp(u, 0, 1) * w) / S, 1 - (py + clamp(v, 0, 1) * h) / S]; };
      return { tex, uvOf };
    }

    // ---- the GLB meshes we keep, with per-vertex region and kind
    const REPLACED = /^(wing_front_|wing_rear_|drsflap_|floor_)/;
    const recs = [];
    const src = G.cache.hi; src.updateMatrixWorld(true);
    src.traverse((m) => {
      if (!m.isMesh || REPLACED.test(m.name || "")) return;
      const n = m.name || "", mn = (m.material && m.material.name) || "";
      let mat = m.material;
      if (mn === "paint" || n === "halo_main") mat = paint; else if (mn === "helmet") mat = helmetM; else if (mn === "cover") mat = coverM;
      const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const nv = geo.attributes.position.count;
      const kind = /^wheel_f|^susp_brake_f|^susp_duct_f|^susp_fin_f/.test(n) ? "fixed" : /^wheel_r|^susp_brake_r|^susp_duct_r/.test(n) ? "rear"
        : /^susp_front_[lr]$/.test(n) ? "suspF" : /^susp_rear_[lr]$/.test(n) ? "suspR" : /^(helmet_|driver_wheel)/.test(n) ? "rigid" : "body";
      // cover meshes keep their own frame (the cover shader reads wheel-local positions): they move as a whole, like the wheel
      const local = mn === "cover";
      if (local) { geo.dispose(); }
      const g2 = local ? m.geometry.clone() : geo;
      const P = g2.attributes.position.array;
      const region = new Uint8Array(nv);
      const wp = new THREE.Vector3();
      for (let i = 0; i < nv; i++) {
        let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        if (local) { wp.set(x, y, z).applyMatrix4(m.matrixWorld); x = wp.x; y = wp.y; z = wp.z; }
        region[i] = RID[regionOf(n, x, y, z)] || 0;
      }
      const rec = { name: n, kind, local, node: local ? m : null, geo: g2, base: Float32Array.from(P), baseN: Float32Array.from(g2.attributes.normal.array), region, mat };
      if (!local && kind === "rigid") { let cx = 0; for (let i = 0; i < nv; i++) cx += P[i * 3]; rec.cx = cx / nv; }
      recs.push(rec);
    });
    function regionOf(n, x, y, z) {
      const az = Math.abs(z);
      if (/^wheel_f/.test(n)) return "wheels_front"; if (/^wheel_r/.test(n)) return "wheels_rear";
      if (/^susp_(brake|duct|fin)_f/.test(n)) return "brakes_front"; if (/^susp_(brake|duct)_r/.test(n)) return "brakes_rear";
      if (/^susp_front/.test(n)) return "front_suspension"; if (/^susp_rear/.test(n)) return "rear_suspension";
      if (n === "halo_main") return "halo"; if (/^(helmet_|driver_)/.test(n)) return "driver"; if (/^mirror_/.test(n)) return "misc";
      if (n === "misc_antenna") return "electronics"; if (n === "misc_exhaust") return "pu_electronics"; if (n === "misc_rearled") return "rear_impact";
      if (n === "body_gearbox") return "gearbox"; if (n === "body_enginetop" || n === "body_intake") return "engine_cover";
      if (x > GLB.XA) return "nose"; if (x < -1.95) return "rear_impact";
      if (az > 0.3 && x < 1.0 && x > -1.3 && y < 0.75) return "sidepods";
      if (x < GLB.XC) return "engine_cover";
      return "survival_cell";
    }
    // meshes (+ mirror copies)
    for (const r of recs) {
      r.geo.setAttribute("aw", new THREE.BufferAttribute(new Float32Array(r.base.length / 3).fill(1), 1));
      r.mesh = new THREE.Mesh(r.geo, r.mat); r.mesh.castShadow = true; r.mesh.name = r.name;
      r.mirror = new THREE.Mesh(r.geo, r.mat);
      if (r.local) { r.mesh.matrixAutoUpdate = false; r.mirror.matrixAutoUpdate = false; }
      carRoot.add(r.mesh); mirror.add(r.mirror);
    }
    // tyre sidewall decals (compound stripe, lettering) on the outer and inner face of each tyre
    const wallGeos = [];
    for (const r of recs) {
      if (!/_tyre$/.test(r.name)) continue;
      let zmin = Infinity, zmax = -Infinity, cx = 0, cy = 0, n = r.base.length / 3; for (let i = 0; i < n; i++) { const z = r.base[i * 3 + 2]; zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); cx += r.base[i * 3] / n; cy += r.base[i * 3 + 1] / n; }
      for (const side of [1, -1]) {
        const ring = new THREE.RingGeometry(0.27, 0.335, 72, 1); if (side < 0) ring.rotateY(Math.PI);
        ring.translate(cx, cy, side > 0 ? zmax + 0.002 : zmin - 0.002);
        wallGeos.push(ring); const w = new THREE.Mesh(ring, M.tyreWall); w.userData.rec = r; r.walls = (r.walls || []).concat(w); carRoot.add(w);
        r.wallBase = r.wallBase || []; r.wallBase.push(ring.attributes.position.array.slice());
      }
    }

    // ---- deformation of the GLB body to a layout
    function makeDeform(L) {
      const xs = [GLB.RA, GLB.XPU, GLB.XC, GLB.XA, GLB.noseTip], ys = [wx(L.XR), wx(L.XPU), wx(L.XC), wx(L.XA), GLB.noseTip];
      return { L, dy: (L.rh - FIX.glbRide) / 1000, xm: monoCubic(xs, ys), sIn: Math.sqrt(clamp(L.sp.inlet, 50, 2000) / 650), du: (L.sp.u - 100) / 1000, rear: wx(L.XR) - GLB.RA };
    }
    // sidepod re-shaping (game-car frame): the inlet mouth (centre y 0.635, inner edge |z| 0.32) scales with sqrt(inlet area / 650 cm²),
    // the lower outer flank moves in by (undercut - 100 mm)
    const SP = { yc: 0.635, zi: 0.32 };
    function podLocal(D, x, y, z, out) {
      let az = Math.abs(z); const sz = z < 0 ? -1 : 1;
      if (az > 0.27 && x > -1.2 && x < 1.15 && y < 0.9) {
        const w = ss(0.12, 0.72, x) * (1 - ss(1.02, 1.14, x)) * (1 - ss(0.1, 0.3, Math.abs(y - SP.yc))) * ss(0.28, 0.36, az);
        if (w > 0) { const k = 1 + (D.sIn - 1) * w; y = SP.yc + (y - SP.yc) * k; az = SP.zi + (az - SP.zi) * k; }
        const wu = ss(0.6, 0.3, y) * ss(-1.05, -0.4, x) * (1 - ss(0.82, 1.02, x)) * ss(0.3, 0.42, az);
        if (wu > 0) az = Math.max(0.27, az - D.du * wu);
      }
      out[0] = x; out[1] = y; out[2] = sz * az;
    }
    const inPod = (x, y, z) => Math.abs(z) > 0.26 && x > -1.25 && x < 1.2 && y < 0.95;
    function bodyPt(D, x, y, z, out) { podLocal(D, x, y, z, out); out[0] = D.xm.f(out[0]); out[1] += D.dy; }
    const tmp = [0, 0, 0], tA = [0, 0, 0], tB = [0, 0, 0], tC = [0, 0, 0], tD = [0, 0, 0];
    // deform one record into (pos, nrm) arrays
    function deformRec(D, r, pos, nrm) {
      const B = r.base, N = r.baseN, n = B.length / 3;
      if (r.local) { return; }
      if (r.kind === "fixed") { pos.set(B); nrm.set(N); return; }
      if (r.kind === "rear") { for (let i = 0; i < n; i++) { pos[i * 3] = B[i * 3] + D.rear; pos[i * 3 + 1] = B[i * 3 + 1]; pos[i * 3 + 2] = B[i * 3 + 2]; } nrm.set(N); return; }
      if (r.kind === "rigid") { const dx = D.xm.f(r.cx) - r.cx; for (let i = 0; i < n; i++) { pos[i * 3] = B[i * 3] + dx; pos[i * 3 + 1] = B[i * 3 + 1] + D.dy; pos[i * 3 + 2] = B[i * 3 + 2]; } nrm.set(N); return; }
      const susp = r.kind === "suspF" || r.kind === "suspR";
      for (let i = 0; i < n; i++) {
        const x = B[i * 3], y = B[i * 3 + 1], z = B[i * 3 + 2];
        let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        if (susp) {
          const b = ss(0.22, 0.6, Math.abs(z)); bodyPt(D, x, y, z, tmp);
          const ux = r.kind === "suspR" ? x + D.rear : x;
          pos[i * 3] = lerp(tmp[0], ux, b); pos[i * 3 + 1] = lerp(tmp[1], y, b); pos[i * 3 + 2] = lerp(tmp[2], z, b);
          const sx = lerp(D.xm.df(x), 1, b); nx /= sx;
        } else if (inPod(x, y, z)) {
          // finite-difference Jacobian: normal' = J^-T normal
          const e = 0.002; bodyPt(D, x, y, z, tmp); bodyPt(D, x + e, y, z, tA); bodyPt(D, x, y + e, z, tB); bodyPt(D, x, y, z + e, tC);
          pos[i * 3] = tmp[0]; pos[i * 3 + 1] = tmp[1]; pos[i * 3 + 2] = tmp[2];
          const a = [(tA[0] - tmp[0]) / e, (tA[1] - tmp[1]) / e, (tA[2] - tmp[2]) / e], b = [(tB[0] - tmp[0]) / e, (tB[1] - tmp[1]) / e, (tB[2] - tmp[2]) / e], c = [(tC[0] - tmp[0]) / e, (tC[1] - tmp[1]) / e, (tC[2] - tmp[2]) / e];
          // cofactor matrix of J (columns a, b, c) times n = J^-T n * det
          const r0 = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]], r1 = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]], r2 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
          const mx = r0[0] * nx + r1[0] * ny + r2[0] * nz, my = r0[1] * nx + r1[1] * ny + r2[1] * nz, mz = r0[2] * nx + r1[2] * ny + r2[2] * nz;
          nx = mx; ny = my; nz = mz;
        } else {
          pos[i * 3] = D.xm.f(x); pos[i * 3 + 1] = y + D.dy; pos[i * 3 + 2] = z;
          nx /= D.xm.df(x);
        }
        const l = Math.hypot(nx, ny, nz) || 1; nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
      }
    }
    function deformAll(D, target) {   // target: "main" (r.geo) or a ghost record set
      for (const r of recs) {
        if (r.local) { // wheel covers: move the node (rear ones with XR)
          const m = new THREE.Matrix4().copy(r.node.matrixWorld); if (/^wheel_r/.test(r.name)) m.premultiply(new THREE.Matrix4().makeTranslation(D.rear, 0, 0));
          if (target === "main") { r.mesh.matrix.copy(m); r.mirror.matrix.copy(m); r.mesh.matrixWorldNeedsUpdate = true; r.mirror.matrixWorldNeedsUpdate = true; r.curM = m; } else r.ghostM = m;
          continue;
        }
        const g = target === "main" ? r.geo : r.gGeo;
        deformRec(D, r, g.attributes.position.array, g.attributes.normal.array);
        g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.computeBoundingSphere();
        if (target === "main" && r.walls) r.walls.forEach((w, k) => { const p = w.geometry.attributes.position.array, b0 = r.wallBase[k]; for (let i = 0; i < p.length; i += 3) p[i] = b0[i] + (r.kind === "rear" ? D.rear : 0); w.geometry.attributes.position.needsUpdate = true; w.geometry.computeBoundingSphere(); });
      }
    }

    // ---------------------------------------------------------------- procedural parts
    // every part: { id, region, items: [{ geo, mat, flap?: { wing, el } }] }; built in world metres from a layout
    const Zy = (L, Z) => (Z + FIX.plank + L.rh) / 1000;   // FIA Z (mm above the plank top) -> world y
    // the front wing's per-station section data (FIA mm): stations, per element LE / chord / angle at each station
    function fwData(L) {
      const fw = L.fw, h = fw.span / 2, NS = 41, st = [];
      for (let j = 0; j < NS; j++) { const t = j / (NS - 1), s = -Math.cos(Math.PI * t); st.push(h * Math.sign(s) * Math.pow(Math.abs(s), 0.85)); }
      const ang = elementAngles(fw.n, fw.aoa, 0.22);
      const secs = st.map((y) => {
        const ay = Math.abs(y), t = ay / h, nc = 1 - ss(170, 290, ay);   // nc: the neutral centre section under the nose
        const k = lerp(1, 0.3, nc) * (1 - 0.12 * ss(0.75, 1, t));
        const ch = chain(fw.n, ang.map((a, i) => (i === 0 ? a * lerp(1, 0.2, nc) : a * k)), fw.chord * lerp(1, 0.84, nc) * (1 - 0.1 * ss(0.8, 1, t)));
        const x0 = fw.le + 35 * nc + 25 * ss(0.55, 1, t), z0 = 48 + 38 * nc + 58 * Math.pow(ss(0.45, 1, t), 1.4);
        return { y, els: ch.map(e => ({ le: [x0 + e.le[0], z0 + e.le[1]], c: e.c, a: e.a })) };
      });
      return { st, secs, h };
    }
    function rwData(L) {
      const rw = L.rw, h = rw.span / 2, NS = 29, st = [];
      for (let j = 0; j < NS; j++) { const t = j / (NS - 1), s = -Math.cos(Math.PI * t); st.push(h * Math.sign(s) * Math.pow(Math.abs(s), 0.85)); }
      const ang = elementAngles(rw.n, rw.aoa, 0.32), base = chain(rw.n, ang, rw.chord);
      // the stack's top TE sits 30 mm under the endplate top
      let top = -1e9; for (const e of base) top = Math.max(top, e.le[1] + e.c * Math.sin(e.a), e.le[1]);
      const zLE = rw.E - 30 - top - 12;
      const secs = st.map((y) => {
        const ay = Math.abs(y), nc = 1 - ss(140, 430, ay);   // the spoon: a deeper centre section
        const ch = chain(rw.n, ang.map((a, i) => a * (1 + (i === 0 ? 0.35 : 0.08) * nc)), rw.chord);
        return { y, els: ch.map(e => ({ le: [rw.x0 + e.le[0], zLE - 14 * nc + e.le[1]], c: e.c, a: e.a })) };
      });
      return { st, secs, h, zLE };
    }
    // one wing element as two lofts (upper / lower surface) in world coordinates, with an optional straight-mode rotation
    // d(y) (rad, negative = less incidence) about the LE (front) or TE (rear) of each section
    function elementRings(L, data, ei, foilP, d, pivotTE) {
      const up = [], lo = [], outline = [];
      for (const sec of data.secs) {
        const e = sec.els[ei], dd = d ? d(sec.y) : 0, te = [e.le[0] + e.c * Math.cos(e.a), e.le[1] + e.c * Math.sin(e.a)], piv = pivotTE ? te : e.le;
        const U = placeFoil(foilP.upper, e.le, e.c, e.a, -dd, piv), Lw = placeFoil(foilP.lower, e.le, e.c, e.a, -dd, piv);
        const W = (q) => [wx(q[0]), Zy(L, q[1]), sec.y / 1000];
        up.push(U.map(W)); lo.push(Lw.map(W));
      }
      return { up, lo };
    }
    function topUV(geo, data, ei, tile, isUpper) {   // rear wing tops: the game car's rear-wing top area, by normalised chord / span position
      const P = geo.attributes.position.array, uv = geo.attributes.uv.array, n = P.length / 3;
      const span = data.h / 1000, xa = wx(data.secs[0].els[0].le[0]), xb = wx(data.secs[0].els[data.secs[0].els.length - 1].le[0] + data.secs[0].els[data.secs[0].els.length - 1].c);
      for (let i = 0; i < n; i++) {
        const xr = lerp(-1.84, -2.39, clamp((xa - P[i * 3]) / Math.max(1e-3, xa - xb), 0, 1)), zr = 0.6 * P[i * 3 + 2] / span;
        const q = atlas.uvOf(tile, xr, zr); uv[i * 2] = q[0]; uv[i * 2 + 1] = q[1];
      }
      geo.attributes.uv.needsUpdate = true;
    }
    function sideUV(geo, tile, rect, ref) {   // endplates: own outline rect -> the game car's endplate rect
      const P = geo.attributes.position.array, uv = geo.attributes.uv.array, n = P.length / 3;
      for (let i = 0; i < n; i++) {
        const fx = (P[i * 3] - rect.x0) / (rect.x1 - rect.x0), fy = (P[i * 3 + 1] - rect.y0) / (rect.y1 - rect.y0);
        const q = atlas.uvOf(tile, lerp(ref.x0, ref.x1, fx), lerp(ref.y0, ref.y1, fy)); uv[i * 2] = q[0]; uv[i * 2 + 1] = q[1];
      }
      geo.attributes.uv.needsUpdate = true;
    }

    function buildFrontWing(L, smT) {
      const fw = L.fw, D = fwData(L), items = [], outl = [];
      const smOn = fw.sm > 0 && fw.n >= 2;
      for (let ei = 0; ei < Math.max(1, fw.n); ei++) {
        const flap = ei > 0, fp = ei === 0 ? FOIL_MAIN : FOIL_FLAP, d = flap && smOn ? () => rad(fw.sm) * smT : null;
        const R = elementRings(L, D, ei, fp, d, false);
        const mat = ei === 0 ? M.fwMain : M.fwFlap;
        items.push({ geo: loftGeo(THREE, R.up, {}), mat }, { geo: loftGeo(THREE, R.lo, {}), mat: ei === 0 ? M.fwMain : carbon2 });
        if (flap && smOn) outl.push(...wingOutline(L, D, ei, fp, () => rad(fw.sm), false));
      }
      // endplates: a plate at each tip, its outline from the element stack at the tip; footplate; a small outer dive plane
      const tip = D.secs[D.secs.length - 1];
      let zt = -1e9, xa = 1e9, xb = -1e9; for (const e of tip.els) { zt = Math.max(zt, e.le[1] + e.c * Math.sin(e.a) + 0.06 * e.c); xa = Math.min(xa, e.le[0]); xb = Math.max(xb, e.le[0] + e.c * Math.cos(e.a)); }
      const top = zt + 30, xF = xa - 28, xR = xb + 38;
      const outlineMM = roundPoly([[xF, -2, 6], [xF - 6, 0.55 * top, 40], [xF + 40, top, 60], [xR - 0.25 * (xR - xF), top + 6, 70], [xR, 0.75 * top, 45], [xR + 8, 12, 20], [xR - 40, -4, 8]], 5);
      const outline = outlineMM.map(([x, Z]) => [wx(x), Zy(L, Z)]);
      const rect = { x0: wx(xF), x1: wx(xR), y0: Zy(L, -4), y1: Zy(L, top + 6) };
      for (const s of [-1, 1]) {
        const g = plateGeo(THREE, outline, s * (D.h + 7) / 1000, 0.011, 0.004);
        sideUV(g, s > 0 ? "frontR" : "frontL", rect, { x0: 2.98, x1: 2.32, y0: 0.08, y1: 0.5 });
        items.push({ geo: g, mat: epFront });
        // footplate: a thin curved strip running outboard at the plate's foot
        const fr = []; for (let k = 0; k <= 12; k++) { const x = lerp(xF + 10, xR - 10, k / 12), w = 26 + 34 * Math.sin(Math.PI * k / 12); fr.push([[wx(x), Zy(L, 6), s * (D.h + 7) / 1000], [wx(x), Zy(L, 6 + 4 + 0.06 * w), s * (D.h + 7 + w) / 1000], [wx(x), Zy(L, 14 + 0.12 * w), s * (D.h + 7 + w) / 1000], [wx(x), Zy(L, 14), s * (D.h + 7) / 1000]]); }
        items.push({ geo: loftGeo(THREE, fr, { closed: true, caps: true }), mat: carbon2 });
        // outer dive plane near the top of the plate
        const dp = []; for (let k = 0; k <= 8; k++) { const x = lerp(xF + 30, xF + 0.55 * (xR - xF), k / 8), w = 38 * Math.sin(Math.PI * (0.15 + 0.85 * k / 8)); dp.push([[wx(x), Zy(L, 0.62 * top - 0.08 * (x - xF)), s * (D.h + 12) / 1000], [wx(x), Zy(L, 0.62 * top - 0.08 * (x - xF) + 4), s * (D.h + 12 + w) / 1000], [wx(x), Zy(L, 0.62 * top - 0.08 * (x - xF) + 9), s * (D.h + 12) / 1000]]); }
        items.push({ geo: loftGeo(THREE, dp, { closed: true, caps: true }), mat: carbon2 });
      }
      return { id: "front_wing", region: "front_wing", items, outl, flapMeta: smOn };
    }
    function buildRearWing(L, smT) {
      const rw = L.rw, D = rwData(L), items = [], outl = [];
      const smOn = rw.sm > 0 && rw.n >= 2;
      const flapD = (full) => (y) => rad(rw.sm) * (full ? 1 : smT) * ss(545, 525, Math.abs(y));   // the tips outboard of Y=535 stay (C3.11.6)
      for (let ei = 0; ei < Math.max(1, rw.n); ei++) {
        const flap = ei > 0, fp = ei === 0 ? FOIL_MAIN : FOIL_FLAP;
        const R = elementRings(L, D, ei, fp, flap && smOn ? flapD(false) : null, true);
        const gu = loftGeo(THREE, R.up, {}), gl = loftGeo(THREE, R.lo, {});
        topUV(gu, D, ei, ei === 0 ? "topMain" : "topFlap", true);
        items.push({ geo: gu, mat: ei === 0 ? rwTopMain : rwTopFlap }, { geo: gl, mat: ei === 0 ? M.rwMain : M.rwFlap });
        if (flap && smOn) outl.push(...wingOutline(L, D, ei, fp, flapD(true), true));
      }
      // endplates: from Z 380 up to the endplate-top parameter, the front edge leaning back, rounded corners
      const s0 = D.secs[0]; let xa = 1e9, xb = -1e9; for (const e of s0.els) { xa = Math.min(xa, e.le[0]); xb = Math.max(xb, e.le[0] + e.c * Math.cos(e.a)); }
      const E = rw.E, xF = xa - 70, xR = xb + 55, zb = 395;
      const outlineMM = roundPoly([[xF + 70, zb, 30], [xF + 10, zb + 150, 60], [xF, E - 40, 70], [xF + 40, E, 60], [xR - 20, E, 40], [xR, E - 60, 40], [xR + 10, zb + 230, 80], [xR - 0.3 * (xR - xF), zb - 10, 40]], 6);
      const outline = outlineMM.map(([x, Z]) => [wx(x), Zy(L, Z)]);
      const rect = { x0: wx(xF), x1: wx(xR), y0: Zy(L, zb - 10), y1: Zy(L, E) };
      for (const s of [-1, 1]) {
        const g = plateGeo(THREE, outline, s * (D.h + 7) / 1000, 0.013, 0.005);
        sideUV(g, s > 0 ? "rearR" : "rearL", rect, { x0: -1.86, x1: -2.43, y0: 0.42, y1: 0.99 });
        items.push({ geo: g, mat: epRear });
      }
      // swan-neck pylons: from the crash structure, up in front of the main plane's LE and down onto its top surface
      const sec = D.secs[Math.floor(D.secs.length / 2)], mle = sec.els[0].le, mc = sec.els[0].c, ma = sec.els[0].a;
      const topAt = (u) => { const ca = Math.cos(ma), sa = Math.sin(ma); return [mle[0] + mc * u * ca, mle[1] + mc * u * sa + 0.07 * mc]; };
      const attach = topAt(0.32), startX = L.XR + 330, startZ = 470;
      const path = []; for (let k = 0; k <= 22; k++) {
        const t = k / 22; let x, Z;
        if (t < 0.65) { const u = t / 0.65; x = lerp(startX, mle[0] - 45, sstep(u)); Z = lerp(startZ, mle[1] + 70, u); }
        else { const u = (t - 0.65) / 0.35, ang = Math.PI * u; x = lerp(mle[0] - 45, attach[0], (1 - Math.cos(ang)) / 2); Z = lerp(mle[1] + 70, attach[1], u * u) + 45 * Math.sin(ang) * (1 - u); }
        path.push([wx(x), Zy(L, Z), 0]);
      }
      for (const s of [-1, 1]) items.push({ geo: bladeGeo(THREE, path, 0.005, 0.03, s * 0.055), mat: carbon2 });
      // actuator pod on the flap (centre) when the wing has a moving flap
      if (rw.n >= 2) {
        const fe = sec.els[rw.n - 1], pp = [fe.le[0] + 0.15 * fe.c, fe.le[1] + 0.12 * fe.c];
        const pod = new THREE.SphereGeometry(1, 16, 10); pod.scale(0.07, 0.022, 0.03); pod.translate(wx(pp[0]), Zy(L, pp[1]), 0);
        items.push({ geo: pod, mat: carbon2, flapPod: true });
      }
      return { id: "rear_wing", region: "rear_wing", items, outl, flapMeta: smOn };
    }
    // straight-mode outline: section loops at 5 stations + LE / TE lines along the span, at the full straight-mode angle
    function wingOutline(L, D, ei, fp, d, pivotTE) {
      const pts = [], N = D.secs.length, pick = [0, Math.round(N * 0.25), Math.floor(N / 2), Math.round(N * 0.75), N - 1];
      const R = elementRings(L, D, ei, fp, d, pivotTE);
      for (const j of pick) { const ring = R.up[j].concat(R.lo[j].slice(1)); for (let i = 0; i < ring.length - 1; i++) pts.push(ring[i], ring[i + 1]); }
      for (let j = 0; j < N - 1; j++) for (const [a, b] of [[R.up[j][0], R.up[j + 1][0]], [R.lo[j][0], R.lo[j + 1][0]]]) pts.push(a, b);
      return pts;
    }
    // floor: planform, upturned edge, fences and inlets under the leading edge, venturi roof from the throat; plank
    function roofZ(L, x) {
      const F = L.floor, xin = F.x0, xt = lerp(F.x0, F.xk, 0.42);
      if (x <= xt) return lerp(F.throat + 170, F.throat, sstep((x - xin) / (xt - xin)));
      if (x <= F.xk) return F.throat;
      return F.throat + (x - F.xk) * Math.tan(rad(F.deg));
    }
    function floorHalfW(L, x) {
      const F = L.floor, W2 = F.W / 2, rearIn = Math.min(W2, 600);
      const a = lerp(0.6 * W2, W2, ss(F.x0, F.x0 + 380, x));
      return lerp(a, rearIn, ss(L.XR - 980, L.XR - 470, x));
    }
    function buildFloor(L) {
      const F = L.floor, items = [], NX = 46, rings = [];
      const xEnd = L.XR - 330;
      for (let i = 0; i < NX; i++) {
        const t = i / (NX - 1), x = lerp(F.x0, xEnd, t), hw = floorHalfW(L, x), rz = roofZ(L, Math.min(x, F.xk)), tw = hw - 115;
        const lip = 26 + 30 * ss(F.x0 + 300, F.x0 + 900, x) * (1 - ss(L.XR - 1100, L.XR - 600, x));   // the upturned edge, tallest mid-floor
        const keel = 150, topC = 52, Zt = Math.max(rz + 18, 30);
        // half section, outer edge -> centre on top, centre -> outer edge underneath (y >= 0), then mirrored
        const half = [
          [0, Math.max(topC, rz + 20)], [keel + 60, Math.max(topC - 4, rz + 18)], [tw - 40, Math.max(Zt, rz + 16)], [hw - 70, 30], [hw - 26, 30 + 0.25 * lip], [hw - 10, 24 + lip], [hw, 18 + lip], [hw + 4, 12 + 0.5 * lip],
          [hw + 2, 8], [hw - 8, 2], [tw + 25, 2], [tw + 6, 6], [tw - 4, rz - 6], [tw - 24, rz], [keel + 30, rz], [keel + 8, rz - 10], [keel, 4], [keel - 10, 0], [0, 0],
        ];
        const ring = [];
        for (const [y, Z] of half) ring.push([wx(x), Zy(L, Z), y / 1000]);
        for (let k = half.length - 2; k >= 1; k--) { const [y, Z] = half[k]; ring.push([wx(x), Zy(L, Z), -y / 1000]); }
        rings.push(ring);
      }
      items.push({ geo: loftGeo(THREE, rings, { closed: true, caps: true }), mat: floorCarbon });
      // fences under the leading edge: four per side, curving outward, from the ground plane up into the inlet roof
      const fx1 = F.x0 + 820;
      for (const s of [-1, 1]) for (const f of [0.18, 0.42, 0.66, 0.88]) {
        const fr = [];
        for (let k = 0; k <= 14; k++) {
          const x = lerp(F.x0 + 15, fx1, k / 14), hw = floorHalfW(L, x), tw = hw - 115, y = (f * tw + 45 * f * ss(F.x0, fx1, x)) * s, rz = roofZ(L, x);
          const z0 = 3 + 10 * (1 - k / 14) * f, th = 5;
          fr.push([[wx(x), Zy(L, z0), (y - th) / 1000], [wx(x), Zy(L, rz + 2), (y - th) / 1000], [wx(x), Zy(L, rz + 2), (y + th) / 1000], [wx(x), Zy(L, z0), (y + th) / 1000]]);
        }
        items.push({ geo: loftGeo(THREE, fr, { closed: true, caps: true }), mat: carbon2 });
      }
      // a vertical vane on the floor's top at each leading corner
      for (const s of [-1, 1]) {
        const vr = []; for (let k = 0; k <= 10; k++) { const x = lerp(F.x0 + 60, F.x0 + 520, k / 10), hw = floorHalfW(L, x), y = s * (hw - 55 - 25 * (1 - k / 10)), h = 70 * Math.sin(Math.PI * Math.min(1, 0.15 + k / 10)); vr.push([[wx(x), Zy(L, 46), (y - 3 * s) / 1000], [wx(x), Zy(L, 46 + h), (y - 3 * s) / 1000], [wx(x), Zy(L, 46 + h), (y + 3 * s) / 1000], [wx(x), Zy(L, 46), (y + 3 * s) / 1000]]); }
        items.push({ geo: loftGeo(THREE, vr, { closed: true, caps: true }), mat: carbon2 });
      }
      // plank (10 mm under Z=0), with skid blocks
      const pk = []; for (let k = 0; k <= 8; k++) { const x = lerp(F.x0 + 120, F.xk - 40, k / 8), w = 145 - 15 * Math.pow(k / 8, 3); pk.push([[wx(x), Zy(L, -10), -w / 1000], [wx(x), Zy(L, -10), w / 1000], [wx(x), Zy(L, 0), w / 1000], [wx(x), Zy(L, 0), -w / 1000]]); }
      items.push({ geo: loftGeo(THREE, pk, { closed: true, caps: true }), mat: M.plank });
      return { id: "floor", region: "floor", items };
    }
    function buildDiffuser(L) {
      const F = L.floor, items = [], NX = 18, rings = [];
      const hd0 = floorHalfW(L, F.xk) - 70;
      const hdAt = (x) => lerp(hd0, hd0 * 0.94, ss(F.xk, F.xe, x));
      for (let i = 0; i < NX; i++) {
        const x = lerp(F.xk, F.xe, i / (NX - 1)), hd = hdAt(x), rz = roofZ(L, x), sk = 22;
        const half = [[0, rz + 26], [hd - 20, rz + 26], [hd + 4, rz + 14], [hd + 6, 6], [hd - 6, 2], [hd - sk, 2], [hd - sk - 6, rz - 12], [hd - sk - 20, rz], [0, rz]];
        const ring = []; for (const [y, Z] of half) ring.push([wx(x), Zy(L, Z), y / 1000]);
        for (let k = half.length - 2; k >= 1; k--) { const [y, Z] = half[k]; ring.push([wx(x), Zy(L, Z), -y / 1000]); }
        rings.push(ring);
      }
      items.push({ geo: loftGeo(THREE, rings, { closed: true, caps: true }), mat: floorCarbon });
      // strakes: two per side and a central pair, from the ground plane up to the ramp
      for (const f of [-0.68, -0.36, -0.08, 0.08, 0.36, 0.68]) {
        const fr = []; for (let k = 0; k <= 10; k++) { const x = lerp(F.xk - 120, F.xe - 5, k / 10), y = f * hdAt(Math.max(x, F.xk)) * (1 + 0.06 * k / 10), rz = roofZ(L, Math.max(x, F.xk)), z0 = 4 + 30 * ss(0.6, 1, k / 10); fr.push([[wx(x), Zy(L, z0), (y - 4) / 1000], [wx(x), Zy(L, rz + 1), (y - 4) / 1000], [wx(x), Zy(L, rz + 1), (y + 4) / 1000], [wx(x), Zy(L, z0), (y + 4) / 1000]]); }
        items.push({ geo: loftGeo(THREE, fr, { closed: true, caps: true }), mat: carbon2 });
      }
      // exit lip (a small upturned flap along the ramp's trailing edge)
      const lip = [], xe = F.xe, rz = roofZ(L, xe), hd = hdAt(xe);
      for (let k = 0; k <= 16; k++) { const y = lerp(-hd, hd, k / 16); lip.push([[wx(xe - 10), Zy(L, rz + 24), y / 1000], [wx(xe + 40), Zy(L, rz + 40), y / 1000], [wx(xe + 44), Zy(L, rz + 46), y / 1000], [wx(xe - 4), Zy(L, rz + 30), y / 1000]]); }
      items.push({ geo: loftGeo(THREE, lip, { closed: true, caps: true }), mat: carbon2 });
      return { id: "diffuser", region: "diffuser", items };
    }
    const BUILDERS = {
      front_wing: { key: (L) => JSON.stringify([L.fw, L.rh]), build: (L, t) => buildFrontWing(L, t) },
      rear_wing: { key: (L) => JSON.stringify([L.rw, L.rh, L.XR]), build: (L, t) => buildRearWing(L, t) },
      floor: { key: (L) => JSON.stringify([L.floor, L.rh, L.XR]), build: (L) => buildFloor(L) },
      diffuser: { key: (L) => JSON.stringify([L.floor, L.rh, L.XR]), build: (L) => buildDiffuser(L) },
    };

    // ---- overlays: highlight (amber) on the current geometry, the baseline ghost (purple), the straight-mode outline (white)
    const hiMat = keep(V.overlayMaterial({ color: o.highlightColor, base: 0.22, rim: 0.85, alpha: 0.9 }));
    const ghostMat = keep(V.overlayMaterial({ color: o.ghostColor, base: 0.16, rim: 1.1, alpha: 0.95 }));
    const ghostHid = keep(V.overlayMaterial({ color: o.ghostColor, base: 0.05, rim: 0.3, alpha: 0.7, hidden: true }));
    const xrMats = new Map();
    const smLine = keep(new THREE.LineBasicMaterial({ color: V.srgb(0xf2f2f6), transparent: true, opacity: 0.9, depthWrite: false }));
    const ghostLine = keep(new THREE.LineBasicMaterial({ color: V.srgb(o.ghostColor), transparent: true, opacity: 1, depthWrite: false }));

    const S = { L: null, procs: {}, smT: 0, highlight: new Set(), xray: null, ghost: null, ghostIds: [] };
    function overlayGeo(geo, weights) {   // shares position / normal / index with geo; own `aw`
      const g = new THREE.BufferGeometry(); g.setAttribute("position", geo.attributes.position); g.setAttribute("normal", geo.attributes.normal);
      if (geo.index) g.setIndex(geo.index); g.setAttribute("aw", new THREE.BufferAttribute(weights, 1)); g.setAttribute("acol", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      g.boundingSphere = geo.boundingSphere; return g;
    }
    // GLB overlays (built once; the shared attributes follow the deformation)
    for (const r of recs) {
      if (r.local) continue;
      r.hiGeo = overlayGeo(r.geo, new Float32Array(r.base.length / 3)); r.hiMesh = new THREE.Mesh(r.hiGeo, hiMat); r.hiMesh.renderOrder = 6; r.hiMesh.visible = false; hiRoot.add(r.hiMesh);
      r.geo.setAttribute("acol", new THREE.BufferAttribute(new Float32Array(r.base.length), 3));
    }
    function regionWeights(region, set, out) { let any = false; for (let i = 0; i < region.length; i++) { const w = set.has(C.view.REGIONS[region[i]]) ? 1 : 0; out[i] = w; if (w) any = true; } return any; }
    function applyHighlight() {
      for (const r of recs) {
        if (r.local) continue;
        const any = regionWeights(r.region, S.highlight, r.hiGeo.attributes.aw.array); r.hiGeo.attributes.aw.needsUpdate = true; r.hiMesh.visible = any;
      }
      for (const id of Object.keys(S.procs)) { const P = S.procs[id]; for (const m of P.hiMeshes || []) m.visible = S.highlight.has(P.region); }
    }

    // ---- procedural part lifecycle
    function disposePart(P, root) {
      if (!P) return;
      for (const it of P.items) it.geo.dispose();
      for (const m of P.meshes || []) m.parent && m.parent.remove(m);
      for (const m of P.mirrors || []) m.parent && m.parent.remove(m);
      for (const m of P.hiMeshes || []) { m.parent && m.parent.remove(m); m.geometry.dispose(); }
      if (P.outlineGeo) P.outlineGeo.dispose(); if (P.outlineObj && P.outlineObj.parent) P.outlineObj.parent.remove(P.outlineObj);
    }
    function mountPart(P) {
      P.meshes = []; P.mirrors = []; P.hiMeshes = [];
      for (const it of P.items) {
        const n = it.geo.attributes.position.count;
        it.geo.setAttribute("aw", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
        it.geo.setAttribute("acol", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        it.geo.computeBoundingSphere();
        const m = new THREE.Mesh(it.geo, S.xray ? xrMat(P.region) : it.mat); m.castShadow = !S.xray; m.userData.it = it; carRoot.add(m); P.meshes.push(m);
        const mm = new THREE.Mesh(it.geo, it.mat); mirror.add(mm); P.mirrors.push(mm);
        const h = new THREE.Mesh(overlayGeo(it.geo, new Float32Array(n).fill(1)), hiMat); h.renderOrder = 6; h.visible = S.highlight.has(P.region); hiRoot.add(h); P.hiMeshes.push(h);
      }
      if (P.outl && P.outl.length) {
        P.outlineGeo = new THREE.BufferGeometry().setFromPoints(P.outl.map(p => new THREE.Vector3(p[0], p[1], p[2])));
        P.outlineObj = new THREE.LineSegments(P.outlineGeo, smLine); P.outlineObj.renderOrder = 7; P.outlineObj.visible = !S.xray; carRoot.add(P.outlineObj);
      }
    }
    function rebuildPart(id, L, force) {
      const B = BUILDERS[id], key = B.key(L) + "|" + (id.endsWith("wing") ? S.smT.toFixed(4) : "");
      const P0 = S.procs[id]; if (P0 && P0.key === key && !force) return false;
      const P = B.build(L, S.smT); P.key = key; P.lkey = B.key(L);
      disposePart(P0); mountPart(P); S.procs[id] = P; return true;
    }

    // ---- x-ray
    function xrMat(region) {
      const hex = S.xray ? S.xray(region) : 0x4fb6c8;
      if (!xrMats.has(hex)) { const m = V.overlayMaterial({ color: hex, base: 0.08, rim: 0.55, alpha: 0.85 }); xrMats.set(hex, m); }
      return xrMats.get(hex);
    }
    function applyXray() {
      const on = !!S.xray;
      for (const r of recs) {
        if (r.local) { r.mesh.material = on ? xrMat(regionName(r.region[0])) : r.mat; continue; }
        if (on) { const cols = r.geo.attributes.acol.array; const cache = {}; for (let i = 0; i < r.region.length; i++) { const id = r.region[i]; const c = cache[id] || (cache[id] = new THREE.Color(S.xray(regionName(id))).convertSRGBToLinear()); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; } r.geo.attributes.acol.needsUpdate = true; }
        r.mesh.material = on ? xrVertexMat : r.mat; r.mesh.castShadow = !on;
        if (r.walls) for (const w of r.walls) w.visible = !on;
      }
      for (const id of Object.keys(S.procs)) { const P = S.procs[id]; P.meshes.forEach((m) => { m.material = on ? xrMat(P.region) : m.userData.it.mat; m.castShadow = !on; }); if (P.outlineObj) P.outlineObj.visible = !on; }
    }
    const regionName = (i) => C.view.REGIONS[i] || "none";
    const xrVertexMat = keep(V.overlayMaterial({ color: 0xffffff, base: 0.08, rim: 0.55, alpha: 0.85, useCol: true }));

    // ---- ghost (baseline)
    const GTOL = 0.006;
    function ensureGhostGLB() {
      for (const r of recs) {
        if (r.local || r.gGeo) continue;
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(r.base.length), 3)); g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(r.base.length), 3));
        if (r.geo.index) g.setIndex(r.geo.index); g.setAttribute("aw", new THREE.BufferAttribute(new Float32Array(r.base.length / 3), 1)); g.setAttribute("acol", new THREE.BufferAttribute(new Float32Array(r.base.length), 3));
        r.gGeo = g; r.gMesh = new THREE.Mesh(g, ghostMat); r.gMesh.renderOrder = 5; r.gHid = new THREE.Mesh(g, ghostHid); r.gHid.renderOrder = 4;
        ghostRoot.add(r.gMesh, r.gHid);
      }
    }
    function setGhost(BL) {
      S.ghostL = BL;
      for (const id of Object.keys(S.ghostProcs || {})) disposeGhostPart(S.ghostProcs[id]);
      S.ghostProcs = {};
      if (!BL || !S.L) { for (const r of recs) if (r.gMesh) { r.gMesh.visible = r.gHid.visible = false; } S.ghostIds = []; return []; }
      ensureGhostGLB();
      const bkey = JSON.stringify(BL);
      if (S.ghostKey !== bkey) { deformAll(makeDeform(BL), "ghost"); S.ghostKey = bkey; }
      const ids = new Set();
      for (const r of recs) {
        if (r.local) continue;
        const a = r.geo.attributes.position.array, b = r.gGeo.attributes.position.array, w = r.gGeo.attributes.aw.array; let any = false;
        for (let i = 0; i < w.length; i++) { const d = Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]); const v = ss(GTOL, 2.5 * GTOL, d); w[i] = v; if (v > 0.5) { any = true; ids.add(regionName(r.region[i])); } }
        r.gGeo.attributes.aw.needsUpdate = true; r.gMesh.visible = r.gHid.visible = any;
      }
      // procedural parts: the baseline's part, where its geometry differs from the design's (per vertex when the topology matches)
      for (const id of Object.keys(BUILDERS)) {
        const B = BUILDERS[id]; const cur = S.procs[id]; if (cur && cur.lkey === B.key(BL) && S.smT === 0) continue;
        const P = B.build(BL, 0); let any = false;
        P.items.forEach((it, k) => {
          const n = it.geo.attributes.position.count, w = new Float32Array(n), ci = cur && cur.items[k] && !cur.items[k].flapPod ? cur.items[k].geo.attributes.position.array : null, bi = it.geo.attributes.position.array;
          const same = ci && ci.length === bi.length && cur.items.length === P.items.length;
          for (let i = 0; i < n; i++) { const d = same ? Math.hypot(ci[i * 3] - bi[i * 3], ci[i * 3 + 1] - bi[i * 3 + 1], ci[i * 3 + 2] - bi[i * 3 + 2]) : 1; w[i] = ss(GTOL, 2.5 * GTOL, d); if (w[i] > 0.5) any = true; }
          it.geo.setAttribute("aw", new THREE.BufferAttribute(w, 1)); it.geo.setAttribute("acol", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        });
        if (!any) { for (const it of P.items) it.geo.dispose(); continue; }
        ids.add(id); P.meshes = [];
        for (const it of P.items) { const m = new THREE.Mesh(it.geo, ghostMat); m.renderOrder = 5; const mh = new THREE.Mesh(it.geo, ghostHid); mh.renderOrder = 4; ghostRoot.add(m, mh); P.meshes.push(m, mh); }
        // section outlines of the baseline wing elements, so their angle reads through the endplates
        if (id.endsWith("wing")) {
          const pts = [], D = id === "front_wing" ? fwData(BL) : rwData(BL), n = id === "front_wing" ? BL.fw.n : BL.rw.n;
          for (let ei = 0; ei < Math.max(1, n); ei++) pts.push(...wingOutline(BL, D, ei, ei === 0 ? FOIL_MAIN : FOIL_FLAP, null, id === "rear_wing").slice(0, 0));
          const R = []; for (let ei = 0; ei < Math.max(1, n); ei++) { const rr = elementRings(BL, D, ei, ei === 0 ? FOIL_MAIN : FOIL_FLAP, null, id === "rear_wing"); for (const j of [1, D.secs.length - 2]) { const ring = rr.up[j].concat(rr.lo[j].slice(1)); for (let i = 0; i < ring.length - 1; i++) R.push(ring[i], ring[i + 1]); } }
          P.lineGeo = new THREE.BufferGeometry().setFromPoints(R.map(p => new THREE.Vector3(p[0], p[1], p[2]))); const ln = new THREE.LineSegments(P.lineGeo, ghostLine); ln.renderOrder = 8; ghostRoot.add(ln); P.meshes.push(ln);
        }
        S.ghostProcs[id] = P;
      }
      // the ids, in catalogue terms (layout moves the rear: report the parts, not the regions only)
      const order = C.view.REGIONS.filter(r => r !== "none");
      S.ghostIds = order.filter(r => ids.has(r));
      return S.ghostIds.slice();
    }
    function disposeGhostPart(P) { for (const it of P.items) it.geo.dispose(); for (const m of P.meshes || []) m.parent && m.parent.remove(m); if (P.lineGeo) P.lineGeo.dispose(); }
    function hideGhost() { for (const r of recs) if (r.gMesh) r.gMesh.visible = r.gHid.visible = false; for (const id of Object.keys(S.ghostProcs || {})) disposeGhostPart(S.ghostProcs[id]); S.ghostProcs = {}; }

    // ---- public
    function setLayout(L) {
      const t0 = performance.now();
      S.L = L; const D = makeDeform(L);
      deformAll(D, "main");
      const t1 = performance.now();
      for (const id of Object.keys(BUILDERS)) rebuildPart(id, L);
      if (S.xray) applyXray();
      S.timing = { deform: t1 - t0, parts: performance.now() - t1 };
    }
    function setFlaps(t) {
      if (Math.abs(t - S.smT) < 1e-4 || !S.L) { S.smT = t; return; }
      S.smT = t;
      for (const id of ["front_wing", "rear_wing"]) { const P = S.procs[id]; if (P && P.flapMeta) rebuildPart(id, S.L); }
    }
    function stats() {
      let v = 0; for (const r of recs) v += r.base.length / 3; let pv = 0; for (const id of Object.keys(S.procs)) for (const it of S.procs[id].items) pv += it.geo.attributes.position.count;
      return { glbMeshes: recs.length, glbVertices: v, partVertices: pv, timing: S.timing, procedural: Object.keys(S.procs) };
    }
    function dispose() {
      for (const id of Object.keys(S.procs)) disposePart(S.procs[id]); for (const id of Object.keys(S.ghostProcs || {})) disposeGhostPart(S.ghostProcs[id]);
      for (const r of recs) { r.geo.dispose(); if (r.hiGeo) r.hiGeo.dispose(); if (r.gGeo) r.gGeo.dispose(); for (const m of [r.mesh, r.mirror, r.hiMesh, r.gMesh, r.gHid]) if (m && m.parent) m.parent.remove(m); for (const w of r.walls || []) w.parent && w.parent.remove(w); }
      for (const g of wallGeos) g.dispose();
      for (const m of xrMats.values()) m.dispose();
      for (const x of disposables) x.dispose && x.dispose();
    }
    return {
      setLayout, setGhost, hideGhost, setFlaps, stats, dispose,
      setHighlight(set) { S.highlight = set || new Set(); applyHighlight(); },
      setXray(fn) { S.xray = fn || null; xrMats.forEach(m => m.dispose()); xrMats.clear(); applyXray(); },
      _S: S, _recs: recs,
    };
  }
  C.parts3d = { createCar, foil, chain, elementAngles, monoCubic };
  if (typeof module !== "undefined" && module.exports) module.exports = C.parts3d;
})();
