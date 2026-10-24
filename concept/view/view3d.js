// PURPLE CONCEPT - the 3D view of the CONCEPT car (v3): a procedural 2026 F1 car whose every part is generated from the design's
// parameters at its true size, position and angle (concept/view/car3d.js, pure; concept/view/mesh3d.js, the mesh kit), drawn with
// PBR materials, the team livery projected from the livery designs (js/liveries.js), carbon weave and metal finishes
// (concept/view/parts3d.js). Metres, FIA 2026 car frame. Concept geometry built to the design's dimensions, not a team CAD model.
//
// Contract (the lab pages embed this; same API as v1 / v2):
//   const v = EI.conceptView.mount(containerEl, opts?)    the canvas appears at once, the car once the livery scripts are in
//        (await v.ready() before a frame-exact capture). opts: design, baseline, mode, view, aero, label, legend, orbit, parts,
//        livery ("redbull-rb22": the team prefix picks the livery; default Red Bull), driver (index or code, e.g. "HAD"),
//        exaggerate, shadows, reflection, changeTags (default true: labels on the parts a setDesign changed, from -> to)
//   v.setDesign(design, { baseline?, animate?, mass?, livery? }) -> { ms }   rebuild ONLY the parts whose dimensions changed;
//        baseline: a Design (ghost the parts that differ, purple), null (clear), undefined (keep). animate (default true): morph from
//        the previous design over 450 ms, then a short flash on the rebuilt parts and change tags (off under reduced motion).
//   v.setHighlight([partId])  catalogue part ids tinted amber; [] clears (and the change tags)
//   v.setMode('solid' | 'xray-mass' | 'materials')   materials: every part in its material's finish (bare carbon weave grades,
//        titanium, aluminium, magnesium, ...), no livery, with a legend
//   v.setView(name, { animate })   VIEWS: hero front34 rear34 side top front rear frontwing rearwing floor sidepod diffuser cockpit wheel
//   v.setAero('cycle' | 'corner' | 'straight');  v.screenshot() -> PNG data URL (label, legend and change tags drawn in)
//   v.labelText(); v.stats() -> { ms, geometries, textures, vertices, timing, ... }; v.state(); v.ready(); v.render(); v.dispose()
//   EI.conceptView.buildCar(design, { livery, driver, baseline, lod, straight }) -> THREE.Group for another scene (see below)
// Needs THREE r128 and concept/regs.js, parts.js (+ materials.js for designs that name a material) at mount. Loads by itself, from
// the repo root, what the page lacks: js/util.js, the livery pipeline (season data, ads, teams, liveries) and concept/view/
// mesh3d.js, car3d.js, parts3d.js. Dual: window.EI.conceptView, and module.exports (layout() and the tables work in Node).
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  let parts = req("parts", "../parts.js");   // or mount(..., { parts }) when the page loaded it under another name

  const LABEL = "concept geometry built to the design's dimensions · FIA 2026 frame · not a team CAD model";
  const DEFAULTS = {
    team: "redbull", driver: 0,
    livery: null,
    background: 0x0b0c10,
    ghostColor: 0xb26cff,
    highlightColor: 0xfbbf24,
    exaggerate: 1,          // display gain on ride height and wing settings vs the baseline; 1 = true geometry (stated in the label if not 1)
    orbit: true, label: true, legend: true, changeTags: true,
    view: "hero", mode: "solid", aero: "cycle",
    pixelRatioCap: 2, shotScale: 2,
    shadows: true, reflection: true,
    liverySize: 2048,
  };
  // what each shape parameter builds (all at true size; docs/concept/VIEW.md has the definitions)
  const EFFECTS = {
    "layout.wheelbase_mm": "rear axle (XR) and everything referenced to it: rear wheels, rear suspension, floor length, diffuser, engine cover, rear wing, crash structure",
    "survival_cell.front_axle_offset_mm": "cell front XA behind the front axle: nose / chassis length, front bulkhead, FW pylons stay on the wing",
    "survival_cell.cockpit_len_mm": "cockpit rear XC: cockpit opening, halo, driver, airbox, mirrors and sidepod inlets move with it",
    "survival_cell.bulkhead_gap_mm": "ICE face XPU: engine cover shoulders, sidepod length and louvres",
    "front_wing.span_mm": "front wing element span, endplate position (|Y| = span/2)", "front_wing.chord_mm": "front wing X extent: mean of the local chords = chord (local chord ∝ the RV-FW-PROFILES envelope)",
    "front_wing.aoa_deg": "flaps at the setting angle, main plane at 1/5 of it (true degrees)", "front_wing.elements": "number of profile volumes (main plane + flaps, slot gaps between them)",
    "front_wing.sm_delta_deg": "straight mode: the flap group rotates by -delta about the first flap's leading edge",
    "rear_wing.span_mm": "rear wing span, endplate position", "rear_wing.chord_mm": "rear wing X extent from XR+165", "rear_wing.aoa_deg": "flaps at the setting angle, main plane at 1/5 of it (true degrees)",
    "rear_wing.elements": "number of rear wing profile volumes", "rear_wing.endplate_top_mm": "rear endplate top height (Z)", "rear_wing.sm_delta_deg": "straight mode: the flap rotates by -delta about its trailing edge inboard of |Y| 530 (tips fixed)",
    "floor.width_mm": "floor body planform: max half width at XF 1100 (= width / 2), the taper to the step ahead of the rear tyre", "floor.throat_mm": "venturi tunnel roof height at the throat (Z above the plank top)",
    "floor.ride_height_mm": "sprung car height: plank bottom = ride height above the ground (wheels stay on the ground)", "diffuser.expansion_deg": "diffuser ramp angle from XR-525 to the exit at XR+300",
    "sidepods.inlet_cm2": "inlet opening area (both sides; superellipse n = 4, aspect 0.55), sidepod width follows the inlet", "sidepods.undercut_mm": "depth of the cut under the sidepod's shoulder (Y)",
    "ballast.x_frac": "no bodywork: ballast sphere position in x-ray mass mode", "ballast.extra_kg": "no bodywork: ballast sphere size in x-ray mass mode",
  };
  // fixed dimensions (mm) that are not design parameters
  const FIX = { tyreR: 352.5, tyreRrear: 355, plank: 10, track: [1580, 1520] };
  // the livery designs' car frame (js/liveries.js landmarks; the design's anchors map onto these for the livery projection)
  const GLB = { FA: 1.75, RA: -1.85, XA: 1.825, XC: -0.105, XPU: -0.485, noseTip: 3.04 };
  const PAIR_Y = { wheels_front: 790, wheels_rear: 760, brakes_front: 700, brakes_rear: 700, front_suspension: 500, rear_suspension: 500, sidepods: 550, cooling: 500, pu_mguk: 120, pu_electronics: 150 };
  const HIGHLIGHT_ALIAS = { layout: ["wheels_rear", "floor", "diffuser", "engine_cover", "rear_suspension", "rear_wing"], survival_cell: ["survival_cell", "nose", "halo"], cooling: ["sidepods", "cooling"], ballast: [] };
  const RAMP = ["#173840", "#1f5a66", "#2b8394", "#4fb6c8", "#9be9f5"];
  // part ids (ghost ordering, x-ray colouring)
  const REGIONS = ["none", "nose", "survival_cell", "halo", "rear_impact", "front_wing", "rear_wing", "floor", "diffuser", "sidepods", "engine_cover", "gearbox", "front_suspension", "rear_suspension", "wheels_front", "wheels_rear", "brakes_front", "brakes_rear", "driver", "misc", "electronics", "pu_electronics", "cooling", "seat_safety"];
  const RID = {}; REGIONS.forEach((r, i) => { RID[r] = i; });

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const ss = (a, b, x) => sstep((x - a) / (b - a));
  const rad = d => d * Math.PI / 180;

  // ---------------------------------------------------------------- layout: the design's dimensions (mm, FIA car frame)
  function layout(params, opts) {
    const g = parts.geometry(params), p = params, gain = (opts && opts.exaggerate) || 1, B = (opts && opts.base) || null;
    const ex = (v, b) => (gain === 1 || b == null ? v : b + gain * (v - b));
    let P = params;
    if (gain !== 1 && B) {   // display gain on ride height and wing settings (stated in the label)
      P = JSON.parse(JSON.stringify(params));
      P.floor.ride_height_mm = clamp(ex(p.floor.ride_height_mm, B.floor.ride_height_mm), 5, 120);
      P.front_wing.aoa_deg = clamp(ex(p.front_wing.aoa_deg, B.front_wing.aoa_deg), 0, 45); P.rear_wing.aoa_deg = clamp(ex(p.rear_wing.aoa_deg, B.rear_wing.aoa_deg), 0, 45);
    }
    const fw = P.front_wing, rw = P.rear_wing, fl = P.floor;
    const XA = g.XA, XC = g.XC, XPU = g.XPU, XR = g.XR;
    return {
      XA, XC, XPU, XR, rh: fl.ride_height_mm,
      fw: { span: fw.span_mm, chord: fw.chord_mm, n: Math.round(fw.elements), aoa: fw.aoa_deg, sm: fw.sm_delta_deg, le: -1250 },
      rw: { span: rw.span_mm, chord: rw.chord_mm, n: Math.round(rw.elements), aoa: rw.aoa_deg, sm: rw.sm_delta_deg, E: rw.endplate_top_mm, x0: XR + 165 },
      floor: { W: fl.width_mm, throat: fl.throat_mm, deg: P.diffuser.expansion_deg, x0: 720, xk: XR - 525, xe: XR + 300 },
      sp: { inlet: P.sidepods.inlet_cm2, u: P.sidepods.undercut_mm },
      ballast: { x: P.ballast.x_frac * XR, kg: P.ballast.extra_kg },
      params: P,
    };
  }

  // livery id ("redbull-rb22") -> o.team (its team prefix) and o.driver (a driver code such as "HAD"); true if either changed
  function pickLivery(o, livery, driverCode) {
    let changed = false;
    if (typeof livery === "string" && livery) { const t = livery.split("-")[0]; if (t && t !== o.team) { o.team = t; changed = true; } }
    if (typeof driverCode === "string" && driverCode && driverCode !== o.driver) { o.driver = driverCode; changed = true; }
    return changed;
  }
  // the parameter changes between two designs, by part: [{ part, lines: ["span 1300 → 1340 mm", ...] }]
  function changesBetween(a, b) {
    if (!a || !b) return [];
    const by = {}, fmt = (v, s) => (s.int ? String(Math.round(v)) : (Math.round(v * 100) / 100).toString()) + (s.unit ? (s.unit === "°" ? "°" : " " + s.unit) : "");
    for (const s of parts.PARAMS) {
      const x = a.params[s.part] && a.params[s.part][s.param], y = b.params[s.part] && b.params[s.part][s.param];
      if (typeof x === "number" && typeof y === "number" && Math.abs(x - y) > 1e-9) (by[s.part] = by[s.part] || []).push(s.label.replace(/ \(.*\)$/, "").toLowerCase() + " " + fmt(x, s).replace(/ (mm|cm²|kg|× WB)$/, "") + " → " + fmt(y, s));
    }
    const M = C.materials;
    for (const id of (parts.MATERIAL_PARTS || [])) {
      const base = M && M.supports && M.supports(id) ? M.baseOf(id) : null;
      const x = (a.params[id] && a.params[id].material) || base, y = (b.params[id] && b.params[id].material) || base;
      if (x !== y) { const nm = (m) => { const L = C.parts3d && C.parts3d.LOOKS && C.parts3d.LOOKS[m]; if (L) return L.label; const r = M && M.get && M.get(m); return r ? r.name.split(" (")[0].split(",")[0] : String(m); }; (by[id] = by[id] || []).push("material " + nm(x) + " → " + nm(y)); }
    }
    return Object.keys(by).map(part => ({ part, lines: by[part] }));
  }

  // ---------------------------------------------------------------- three.js part (browser only)
  const T = () => root.THREE;
  const reducedMotion = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const now = () => (root.performance ? root.performance.now() : Date.now());
  const srgb = (hex) => new (T().Color)(hex).convertSRGBToLinear();
  const wx = x => GLB.FA - x / 1000;   // FIA X (mm) -> world x (m)

  const SCRIPT_URL = (() => { try { const cs = typeof document !== "undefined" && document.currentScript; return (cs && cs.src) || ""; } catch (e) { return ""; } })();
  const ROOT = SCRIPT_URL ? SCRIPT_URL.replace(/concept\/view\/[^/]*(\?.*)?$/, "") : "../../";
  const loadScript = (src) => new Promise((res, rej) => { const el = document.createElement("script"); el.src = src; el.async = false; el.onload = () => res(); el.onerror = () => rej(new Error("conceptView: failed to load " + src)); document.head.appendChild(el); });
  const LIVERY_SCRIPTS = ["js/data/season2026.js", "js/ads.js", "js/teams.js", "js/liveries.js", "js/liveries/mercedes.js", "js/liveries/ferrari.js", "js/liveries/mclaren.js", "js/liveries/redbull.js", "js/liveries/racingbulls.js", "js/liveries/alpine.js", "js/liveries/haas.js", "js/liveries/audi.js", "js/liveries/williams.js", "js/liveries/astonmartin.js", "js/liveries/cadillac.js", "js/liveries/lumi.js", "js/liveries/intake.js"];
  let assetsP = null;
  // everything the car needs, once per page: the livery scripts, brand artwork (never more than 3.5 s), the geometry modules
  function ensureAssets() {
    if (assetsP) return assetsP;
    assetsP = (async () => {
      if (!EI.U) await loadScript(ROOT + "js/util.js");
      for (const f of LIVERY_SCRIPTS) {
        if (f === "js/data/season2026.js" && EI.SEASON) continue; if (f === "js/ads.js" && EI.Ads) continue; if (f === "js/teams.js" && EI.TEAM_BY_ID) continue;
        if (f.startsWith("js/liveries") && EI.LIVERIES && EI.LIVERIES.has && f !== "js/liveries.js" && EI.LIVERIES.has(f.replace(/^.*\/|\.js$/g, ""))) continue;
        if (f === "js/liveries.js" && EI.LIVERIES) continue;
        await loadScript(ROOT + f);
        if (f === "js/ads.js" && EI.Ads) { EI.Ads.BRAND_DIR = ROOT + "assets/brand/"; EI.Ads.PARTNER_DIR = EI.Ads.BRAND_DIR + "partners/"; }
      }
      if (!C.mesh3d) await loadScript(ROOT + "concept/view/mesh3d.js");
      if (!C.car3d) await loadScript(ROOT + "concept/view/car3d.js");
      if (!C.parts3d) await loadScript(ROOT + "concept/view/parts3d.js");
      if (EI.Ads && EI.Ads.ready) await Promise.race([EI.Ads.ready(), new Promise((r) => setTimeout(r, 3500))]);
      return C.parts3d;
    })();
    assetsP.catch(() => { assetsP = null; });
    return assetsP;
  }

  // ---------------------------------------------------------------- studio: environment, ground, reflections
  function studioEnv(renderer) {
    const THREE = T(), room = new THREE.Scene(); room.background = null;
    { const shell = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: 0x030304, side: THREE.BackSide })); shell.position.y = 6.9; room.add(shell); }
    const box = (w, h, x, y, z, ry, rx, c, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k || 1), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); room.add(m); };
    box(6, 0.7, 0, 5, 0, 0, Math.PI / 2, 0xffffff, 3.2);
    box(4, 0.35, 0, 4.6, 2.6, 0, Math.PI / 2 - 0.35, 0xeef2ff, 1.6);
    box(4, 0.35, 0, 4.6, -2.6, 0, Math.PI / 2 + 0.35, 0xeef2ff, 1.2);
    box(0.7, 2.6, 5.5, 2.0, 3.2, -Math.PI / 3, 0, 0xdfe7ff, 2.6);
    box(0.7, 2.6, -5.5, 1.8, 3.0, -Math.PI * 0.62, 0, 0xc8d6ff, 2.2);
    box(0.7, 2.6, -4.5, 1.8, -3.6, Math.PI * 0.7, 0, 0xc8d6ff, 1.8);
    box(0.7, 2.6, 4.5, 2.0, -3.4, Math.PI * 0.3, 0, 0xffe2c4, 0.9);
    box(12, 0.25, 0, 0.5, -6.5, 0, 0, 0x6f7c9a, 0.35);
    box(12, 0.25, 0, 0.5, 6.5, Math.PI, 0, 0x6f7c9a, 0.35);
    box(40, 40, 0, -0.02, 0, 0, -Math.PI / 2, 0x040406, 1);
    const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
    const env = pm.fromScene(room, 0.02).texture; pm.dispose();
    room.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return env;
  }
  function radialTex(stops, size) {
    const c = document.createElement("canvas"); c.width = c.height = size || 256; const g = c.getContext("2d"), S = c.width / 2;
    const grd = g.createRadialGradient(S, S, 0, S, S, S); for (const [t, col] of stops) grd.addColorStop(t, col);
    g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height); return new (T().CanvasTexture)(c);
  }
  function contactTex() {
    const THREE = T(), W = 256, H = 128, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"), im = g.createImageData(W, H), d = im.data;
    const sx = 5.6, sz = 2.6, cx = -0.05, tyres = [[1.75, 0.79, 0.35, 0.15], [1.75, -0.79, 0.35, 0.15], [-1.65, 0.76, 0.36, 0.2], [-1.65, -0.76, 0.36, 0.2]];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = cx + ((i + 0.5) / W - 0.5) * sx, z = ((j + 0.5) / H - 0.5) * sz;
      const e = Math.hypot((x + 0.1) / 2.5, z / 0.8); let a = 0.55 * (1 - ss(0.3, 1.0, e));
      for (const [tx, tz, rx, rz] of tyres) { const t = Math.hypot((x - tx) / rx, (z - tz) / rz); a = 1 - (1 - a) * (1 - 0.85 * (1 - ss(0.1, 1.0, t))); }
      const u = (i + 0.5) / W, v = (j + 0.5) / H; a *= ss(0, 0.1, Math.min(u, 1 - u)) * ss(0, 0.14, Math.min(v, 1 - v));
      const k = (j * W + i) * 4; d[k] = d[k + 1] = d[k + 2] = 0; d[k + 3] = Math.round(Math.min(0.9, a) * 255);
    }
    g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.userData = { sx, sz, cx }; return t;
  }

  // ---------------------------------------------------------------- overlay material (ghost, highlight, x-ray, flash)
  function overlayMaterial(o) {
    const THREE = T();
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: srgb(o.color || 0xffffff) }, base: { value: o.base != null ? o.base : 0.1 }, rim: { value: o.rim != null ? o.rim : 0.8 }, alpha: { value: o.alpha != null ? o.alpha : 1 }, useCol: { value: o.useCol ? 1 : 0 }, rimPow: { value: o.rimPow || 2 } },
      vertexShader: [
        "attribute float aw; attribute vec3 acol; varying float vW; varying vec3 vN; varying vec3 vV; varying vec3 vC;",
        "void main() { vW = aw; vC = acol; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }"].join("\n"),
      fragmentShader: [
        "uniform vec3 color; uniform float base; uniform float rim; uniform float alpha; uniform float useCol; uniform float rimPow; varying float vW; varying vec3 vN; varying vec3 vV; varying vec3 vC;",
        "void main() { if (vW < 0.01) discard; float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, rimPow); vec3 c = mix(color, vC, useCol);",
        "  gl_FragColor = vec4(c * (0.6 + 0.9 * f), clamp(alpha * vW * (base + rim * f), 0.0, 1.0)); }"].join("\n"),
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthFunc: o.hidden ? THREE.GreaterDepth : THREE.LessEqualDepth,
    });
  }
  const rampColor = (t) => {
    t = clamp(t, 0, 1) * (RAMP.length - 1); const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
    const a = parseInt(RAMP[i].slice(1), 16), b = parseInt(RAMP[i + 1].slice(1), 16);
    const ch = s => Math.round(lerp((a >> s) & 255, (b >> s) & 255, f));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  const shortName = id => { const p = parts.BY_ID[id]; if (!p) return id; return p.name.split(" (")[0].split(",")[0].replace(" and tyres", "").replace("PU · ", "").replace("energy store", "Energy store"); };

  // ---------------------------------------------------------------- views
  // camera on a sphere around a target: azim 0 = behind the car, π/2 = its right side, π = in front; elev above the ground
  const VIEWS = {
    hero: { azim: 2.36, elev: 0.22, radius: 8.4, target: [0.3, 0.32, 0], fov: 28 },
    front34: { azim: 2.2, elev: 0.12, radius: 8.2, target: [0.4, 0.32, 0], fov: 28 },
    rear34: { azim: 0.72, elev: 0.2, radius: 8.2, target: [-0.2, 0.38, 0], fov: 28 },
    rearwing: { azim: 0.6, elev: 0.42, radius: 3.5, target: [-2.05, 0.66, 0], fov: 28 },
    frontwing: { azim: 2.35, elev: 0.34, radius: 3.4, target: [2.5, 0.16, 0], fov: 28 },
    side: { azim: Math.PI / 2, elev: 0.02, radius: 9.6, target: [0.2, 0.45, 0], fov: 26 },
    top: { azim: Math.PI / 2, elev: 1.53, radius: 9.8, target: [0.2, 0.2, 0], fov: 26 },
    front: { azim: Math.PI, elev: 0.08, radius: 6.8, target: [0, 0.4, 0], fov: 28 },
    rear: { azim: 0, elev: 0.12, radius: 6.8, target: [0, 0.42, 0], fov: 28 },
    floor: { azim: 2.45, elev: -0.34, radius: 6.0, target: [0.15, 0.12, 0], fov: 28 },
    sidepod: { azim: 2.05, elev: 0.16, radius: 3.4, target: [0.35, 0.42, 0.45], fov: 28 },
    diffuser: { azim: 0.32, elev: 0.03, radius: 2.9, target: [-1.95, 0.24, 0], fov: 28 },
    cockpit: { azim: 1.95, elev: 0.5, radius: 2.8, target: [0.45, 0.68, 0], fov: 28 },
    wheel: { azim: 2.0, elev: 0.08, radius: 2.3, target: [1.75, 0.35, 0.8], fov: 28 },
  };
  const REF_ASPECT = 1.6, MOVE_MS = 600, EASE = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const SWAY = { amp: 0.16, period: 28 }, MORPH_MS = 450, SM_HOLD_MS = 2600, SM_SWING_MS = 400;
  const MODES = ["solid", "xray-mass", "materials"];

  // ---------------------------------------------------------------- mount
  function mount(container, opts) {
    const THREE = T();
    if (!container) throw new Error("conceptView.mount: container element required");
    if (!THREE) throw new Error("conceptView.mount: load vendor/three.min.js first");
    if (!parts && opts && opts.parts && opts.parts.geometry) parts = opts.parts;
    if (!parts) throw new Error("conceptView.mount: load concept/regs.js and concept/parts.js first");
    const o = Object.assign({}, DEFAULTS, opts || {}), rm = reducedMotion();
    delete o.parts;
    pickLivery(o, o.livery || (o.design && o.design.livery) || (o.baseline && o.baseline.livery), opts && opts.driver != null ? null : (o.design && o.design.driver) || (o.baseline && o.baseline.driver));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, o.pixelRatioCap));
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !!o.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    const cv = renderer.domElement; cv.style.display = "block"; cv.style.width = "100%"; cv.style.height = "100%"; cv.style.touchAction = "none";
    cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "Concept car: 3D view built to the design's dimensions");
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(cv);
    const mono = "font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;";
    let label = null, legend = null;
    if (o.label) { label = document.createElement("div"); label.className = "cv-label"; label.style.cssText = "position:absolute;top:10px;right:12px;max-width:52%;text-align:right;color:#8a8a94;pointer-events:none;" + mono; container.appendChild(label); }
    if (o.legend) { legend = document.createElement("div"); legend.className = "cv-legend"; legend.style.cssText = "position:absolute;left:12px;bottom:10px;max-width:60%;color:#8a8a94;pointer-events:none;" + mono; container.appendChild(legend); }
    const tags = document.createElement("div"); tags.className = "cv-tags"; tags.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;"; container.appendChild(tags);
    const loadEl = document.createElement("div"); loadEl.className = "cv-loading";
    loadEl.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#8a8a94;pointer-events:none;text-align:center;" + mono;
    loadEl.textContent = "building the car to the design's dimensions…"; container.appendChild(loadEl);

    const scene = new THREE.Scene(); scene.background = new THREE.Color(o.background);
    scene.environment = studioEnv(renderer);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
    scene.add(new THREE.HemisphereLight(0x46506a, 0x050507, 0.35));
    const key = new THREE.DirectionalLight(0xfff3e6, 1.6); key.position.set(3.0, 8, 3.5); key.castShadow = !!o.shadows;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    const sc = key.shadow.camera; sc.near = 2; sc.far = 16; sc.left = -3.6; sc.right = 3.6; sc.bottom = -2.2; sc.top = 2.2; scene.add(key); scene.add(key.target);
    const rim = new THREE.DirectionalLight(0xbcd0ff, 1.25); rim.position.set(-6, 3.5, -4); scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0xbcd0ff, 0.8); rim2.position.set(-5, 2.5, 5); scene.add(rim2);
    const fill = new THREE.DirectionalLight(0xffe6cf, 0.35); fill.position.set(5, 1.5, -4); scene.add(fill);
    const under = new THREE.DirectionalLight(0x8ea0c8, 0.0); under.position.set(0.5, -4, 1); scene.add(under);   // only for the floor view
    const poolTex = radialTex([[0, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,0.85)"], [1, "rgba(255,255,255,0)"]]);
    const groundMat = new THREE.MeshBasicMaterial({ color: srgb(o.background), transparent: true, opacity: o.reflection ? 0.88 : 1, depthWrite: false, toneMapped: false });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 72), groundMat); ground.rotation.x = -Math.PI / 2; ground.renderOrder = -2; scene.add(ground);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ color: srgb(0x262a36), alphaMap: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.0005; pool.renderOrder = -1; scene.add(pool);
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.ShadowMaterial({ opacity: 0.55 }));
    shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = 0.001; shadowPlane.receiveShadow = true; shadowPlane.renderOrder = -1; scene.add(shadowPlane);
    const cTex = contactTex();
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(cTex.userData.sx, cTex.userData.sz), new THREE.MeshBasicMaterial({ map: cTex, transparent: true, depthWrite: false, toneMapped: false }));
    contact.rotation.x = -Math.PI / 2; contact.position.set(cTex.userData.cx, 0.002, 0); contact.renderOrder = -1; scene.add(contact);

    const carRoot = new THREE.Group(); scene.add(carRoot);
    const mirror = new THREE.Group(); mirror.scale.y = -1; mirror.visible = !!o.reflection; scene.add(mirror);
    const ghostRoot = new THREE.Group(); scene.add(ghostRoot);
    const hiRoot = new THREE.Group(); scene.add(hiRoot);
    const xrRoot = new THREE.Group(); scene.add(xrRoot);

    const s = {
      o, rm, design: null, baseline: null, mass: null, L: null, highlight: new Set(), mode: o.mode, aero: o.aero, loading: true, error: null,
      azim: 0, elev: 0, radius: 0, target: new THREE.Vector3(), view: o.view, move: null, user: false, swayT0: now(),
      smT: 0, smPhaseT0: now(), tween: null, lastMs: null, raf: 0, dirty: true, disposed: false, tagEls: [], tagRows: [], ghostParts: [],
      car: null, xrGeos: [], changes: [], changeEls: [], rebuilt: [],
    };

    const carCtx = { THREE, o, carRoot, mirror, ghostRoot, hiRoot, scene, renderer };
    ensureAssets().then(() => {
      if (s.disposed) return;
      s.car = C.parts3d.createCar(carCtx);
      s.loading = false; loadEl.remove();
      if (s.design) { s.lastMs = build(s.design.params, true); emit(); }
      setMode(s.mode);
      try { container.dispatchEvent(new CustomEvent("conceptview:ready", { detail: { ms: s.lastMs } })); } catch (e) { /* fine */ }
    }).catch((e) => { console.error(e); s.error = e; loadEl.textContent = "car unavailable: " + String(e && e.message || e); s.loading = false; s.dirty = true; });

    function build(params, withGhost) {
      if (!s.car) return null;
      const t0 = now();
      const L = layout(params, { exaggerate: o.exaggerate, base: s.baseline ? s.baseline.params : null });
      s.rebuilt = s.car.setLayout(L);
      s.L = L;
      if (withGhost) s.ghostParts = s.car.setGhost(s.baseline ? layout(s.baseline.params, { exaggerate: o.exaggerate, base: s.baseline.params }) : null);
      else s.car.hideGhost();
      ghostRoot.visible = s.mode !== "xray-mass" && s.ghostParts.length > 0;
      s.car.setFlaps(s.smT);
      if (s.mode === "xray-mass") buildXray();
      renderer.shadowMap.needsUpdate = true; s.dirty = true;
      return now() - t0;
    }
    // x-ray mass: one sphere per mass-sheet row (pairs mirrored, half mass each), colour and volume from the mass, a CoG marker
    const cogMat = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
      g.fillStyle = "#e8e8ec"; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0a0a0c"; for (const a of [0, Math.PI]) { g.beginPath(); g.moveTo(64, 64); g.arc(64, 64, 56, a, a + Math.PI / 2); g.fill(); }
      g.strokeStyle = "#0a0a0c"; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.stroke();
      return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
    })();
    const cogBaseMat = (() => { const m = cogMat.clone(); m.color = srgb(o.ghostColor); return m; })();
    const cogLineMat = new THREE.LineBasicMaterial({ color: srgb(0xe8e8ec), transparent: true, opacity: 0.6, depthTest: false });
    const xrCache = new Map();
    const xrSphereMat = (hex) => { const k = "s" + hex; if (!xrCache.has(k)) xrCache.set(k, new THREE.MeshStandardMaterial({ color: srgb(hex), emissive: srgb(hex), emissiveIntensity: 0.6, roughness: 0.35, metalness: 0 })); return xrCache.get(k); };
    const zW = (z_mm) => (z_mm + FIX.plank + (s.L ? s.L.rh : 35)) / 1000;
    function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }
    const xrColour = (id) => rampColor(Math.sqrt(((s.mass && s.mass.byId[id]) || 0) / ((s.mass && s.mass.max) || 1)));
    function buildXray() {
      clearGroup(xrRoot); for (const g of s.xrGeos) g.dispose(); s.xrGeos = []; s.tagRows = [];
      if (!s.mass || !s.L) return;
      const k = 0.032, sphere = new THREE.SphereGeometry(1, 24, 16); s.xrGeos.push(sphere);
      for (const r of s.mass.rows) {
        if (!(r.mass_kg > 0)) continue;
        const py = PAIR_Y[r.id], pts = py ? [-py, py] : [0], kg = r.mass_kg / pts.length, rr = k * Math.cbrt(kg);
        for (const y of pts) { const m = new THREE.Mesh(sphere, xrSphereMat(rampColor(Math.sqrt(r.mass_kg / s.mass.max)))); m.scale.setScalar(rr); m.position.set(wx(r.x_mm), zW(r.z_mm), (y || 0) / 1000); xrRoot.add(m); }
        s.tagRows.push(r);
      }
      const cog = new THREE.Sprite(cogMat); cog.scale.setScalar(0.24); cog.position.set(wx(s.mass.cog_x_mm), zW(s.mass.cog_z_mm), 0); cog.renderOrder = 10; xrRoot.add(cog);
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(wx(s.mass.cog_x_mm), 0.002, 0), new THREE.Vector3(wx(s.mass.cog_x_mm), zW(s.mass.cog_z_mm), 0)]); s.xrGeos.push(lg);
      const ln = new THREE.Line(lg, cogLineMat); ln.renderOrder = 9; xrRoot.add(ln);
      if (s.baseMass) { const b = new THREE.Sprite(cogBaseMat); b.scale.setScalar(0.17); b.position.set(wx(s.baseMass.cog_x_mm), zW(s.baseMass.cog_z_mm), 0); b.renderOrder = 8; xrRoot.add(b); }
      if (s.car) s.car.setXray(xrColour);
    }
    function massOf(design, given) {
      let m = given;
      if (!m) { try { m = parts.massSheet(design.params, { overrides: design.overrides }); } catch (e) { m = { parts: [] }; } }
      const rows = m.parts || [], byId = {}; let max = 1; for (const r of rows) { byId[r.id] = (byId[r.id] || 0) + r.mass_kg; max = Math.max(max, r.mass_kg); }
      return { rows, byId, max, total_kg: m.total_kg, cog_x_mm: m.cog_x_mm, cog_z_mm: m.cog_z_mm, front_share: m.front_share, ballast_kg: m.ballast_kg };
    }

    // ---- straight mode
    const usesSM = () => !!(s.L && (s.L.fw.sm > 0 && s.L.fw.n >= 2 || s.L.rw.sm > 0 && s.L.rw.n >= 2));
    function aeroTick(t) {
      if (!usesSM()) { if (s.smT !== 0) { s.smT = 0; if (s.car) s.car.setFlaps(0); } return false; }
      let target = s.aero === "straight" ? 1 : 0;
      if (s.aero === "cycle" && !s.rm) { const per = 2 * (SM_HOLD_MS + SM_SWING_MS), ph = (t - s.smPhaseT0) % per; target = ph < SM_HOLD_MS ? 0 : ph < SM_HOLD_MS + SM_SWING_MS ? (ph - SM_HOLD_MS) / SM_SWING_MS : ph < 2 * SM_HOLD_MS + SM_SWING_MS ? 1 : 1 - (ph - 2 * SM_HOLD_MS - SM_SWING_MS) / SM_SWING_MS; }
      const v = EASE(clamp(target, 0, 1));
      if (Math.abs(v - s.smT) < 1e-4) return false;
      s.smT = v; if (s.car) s.car.setFlaps(v); renderer.shadowMap.needsUpdate = true; return true;
    }

    // ---- labels and legend
    function labelText() {
      let t = LABEL;
      if (o.exaggerate && o.exaggerate !== 1) t += " · ride height and wing settings exaggerated ×" + o.exaggerate + " vs the baseline for visibility";
      return t;
    }
    function legendLines() {
      const out = [];
      if (s.loading) return out;
      if (s.mode === "xray-mass" && s.mass) {
        out.push({ html: "<b style='color:#e8e8ec;font-weight:600'>x-ray · mass</b> · concept part-mass estimates v1 (not measured)" });
        const grad = "linear-gradient(90deg," + RAMP.join(",") + ")";
        const tick = v => "<span style='position:absolute;left:" + (Math.sqrt(v / s.mass.max) * 100).toFixed(1) + "%;transform:translateX(-50%);top:12px'>" + v + "</span>";
        const ticks = [5, 25, 50, 100].filter(v => v < s.mass.max * 0.7).map(tick).join("") + "<span style='position:absolute;right:0;top:12px'>" + Math.round(s.mass.max) + " kg</span>";
        out.push({ html: "<div style='position:relative;width:240px;height:28px;margin:4px 0 2px'><div style='height:9px;border-radius:2px;background:" + grad + "'></div>" + ticks + "</div>" });
        out.push({ text: "part mass (kg, √ scale) · sphere volume ∝ mass · paired parts split left/right" });
        out.push({ html: "<span style='color:#e8e8ec'>◐</span> CoG " + s.mass.cog_x_mm + " mm behind the front axle, " + s.mass.cog_z_mm + " mm above Z=0 · " + (s.mass.front_share * 100).toFixed(1) + " % front · " + s.mass.total_kg + " kg" + (s.baseMass ? " · <span style='color:#b26cff'>◐</span> baseline CoG" : "") });
        return out;
      }
      if (s.mode === "materials" && s.car) {
        out.push({ html: "<b style='color:#e8e8ec;font-weight:600'>materials</b> · each part in its material's finish (concept/materials.js) · livery off" });
        const rows = s.car.materialsUsed();
        const groups = {}; for (const r of rows) (groups[r.material] = groups[r.material] || { r, parts: [] }).parts.push(r);
        for (const id of Object.keys(groups)) {
          const g = groups[id], ch = g.parts.some(p => p.changed);
          out.push({ html: "<span style='display:inline-block;width:9px;height:9px;border-radius:2px;vertical-align:-1px;margin-right:5px;background:" + g.r.swatch + ";outline:1px solid #555'></span>" + "<span style='color:" + (ch ? "#fbbf24" : "#c8c8d0") + "'>" + g.r.name + "</span> · " + g.parts.map(p => p.part.replace(/_/g, " ") + (p.changed ? " (changed)" : p.fixed ? " (regulation)" : "")).join(", "),
            text: g.r.name + " · " + g.parts.map(p => p.part.replace(/_/g, " ") + (p.changed ? " (changed)" : p.fixed ? " (regulation)" : "")).join(", ") });
        }
        return out;
      }
      if (ghostRoot.visible) out.push({ html: "<span style='color:#b26cff'>purple</span> = the baseline's " + s.ghostParts.map(id => id.replace(/_/g, " ")).join(", ") });
      if (s.highlight.size) out.push({ html: "<span style='color:#fbbf24'>amber</span> = " + Array.from(s.highlight).map(id => id.replace(/_/g, " ")).join(", ") });
      if (usesSM()) {
        const w = []; if (s.L.fw.sm > 0 && s.L.fw.n >= 2) w.push("front −" + s.L.fw.sm + "°"); if (s.L.rw.sm > 0 && s.L.rw.n >= 2) w.push("rear −" + s.L.rw.sm + "°");
        out.push({ text: "straight-mode flaps " + w.join(", ") + (s.smT > 0.5 ? " · showing straight mode" : " · showing corner mode") });
      }
      out.push({ text: "true dimensions and wing angles · wheelbase " + (s.L ? s.L.XR : "") + " mm · tyres 705/710 mm (2026)" });
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
    // mass tags (x-ray) and change tags (hot swap), projected each frame
    const TAG_N = 7;
    function placeTags() {
      const w = cv.clientWidth, h = cv.clientHeight, v = new THREE.Vector3(), placed = [];
      const want = [];
      if (s.mode === "xray-mass" && s.mass) for (const r of s.tagRows.slice().sort((a, b) => b.mass_kg - a.mass_kg).filter((r, i) => i < TAG_N || r.id === "ballast")) want.push({ p: [wx(r.x_mm), zW(r.z_mm), 0], text: shortName(r.id) + " " + (Math.round(r.mass_kg * 10) / 10) + " kg", kind: "mass" });
      else if (o.changeTags && s.changes.length && s.car) for (const c of s.changes) {
        const ids = HIGHLIGHT_ALIAS[c.part] || [c.part]; let p = null; for (const id of ids) { p = s.car.partCentre(id); if (p) break; }
        want.push({ p: p ? [p.x, p.y, p.z] : null, text: shortName(c.part) + " · " + c.lines.join(" · "), kind: "change" });
      }
      const out = [];
      let corner = 0;
      for (const t of want) {
        let x, y;
        if (t.p) { v.set(t.p[0], t.p[1], t.p[2]).project(camera); if (v.z > 1) continue; x = (v.x * 0.5 + 0.5) * w + 10; y = (-v.y * 0.5 + 0.5) * h - 8; }
        else { x = 12; y = 34 + 18 * corner++; }
        const bw = t.text.length * 6.7 + 8, bh = 16;
        x = Math.min(x, w - bw - 6);
        for (let k = 0; k < 14 && placed.some(r => x < r.x + r.w && x + bw > r.x && y < r.y + r.h && y + bh > r.y); k++) y += (k % 2 ? -1 : 1) * (k + 1) * bh;
        placed.push({ x, y, w: bw, h: bh }); out.push(Object.assign({ x, y }, t));
      }
      return out;
    }
    function updateTags() {
      const list = placeTags();
      while (s.tagEls.length < list.length) { const el = document.createElement("div"); el.style.cssText = "position:absolute;white-space:nowrap;color:#e8e8ec;background:rgba(10,10,12,.78);padding:1px 5px;border-radius:3px;" + mono; tags.appendChild(el); s.tagEls.push(el); }
      s.tagEls.forEach((el, i) => {
        const t = list[i]; if (!t) { el.style.display = "none"; return; }
        el.style.display = ""; if (el.textContent !== t.text) el.textContent = t.text; el.style.borderLeft = t.kind === "change" ? "2px solid #fbbf24" : "0";
        el.style.left = t.x.toFixed(0) + "px"; el.style.top = t.y.toFixed(0) + "px";
      });
      return list;
    }

    // ---- camera
    const fitScale = () => Math.max(1, REF_ASPECT / camera.aspect);
    function pose(name) { const V = VIEWS[name] || VIEWS.hero; return { azim: V.azim, elev: V.elev, radius: V.radius * fitScale(), fov: V.fov || 28, target: new THREE.Vector3().fromArray(V.target) }; }
    function place() {
      const ce = Math.cos(s.elev), t = s.target;
      camera.position.set(t.x - s.radius * ce * Math.cos(s.azim), t.y + s.radius * Math.sin(s.elev), t.z + s.radius * ce * Math.sin(s.azim));
      camera.lookAt(t); s.dirty = true;
      under.intensity = s.elev < 0 ? 3.2 : 0;   // light the floor from below when the camera is under the car
      ground.visible = pool.visible = contact.visible = shadowPlane.visible = s.elev >= -0.01;
      mirror.visible = !!o.reflection && s.mode !== "xray-mass" && s.elev >= -0.01;
    }
    function setView(name, vo) {
      if (!VIEWS[name]) throw new Error("conceptView.setView: unknown view " + name);
      s.view = name; s.user = false; const P = pose(name);
      if (camera.fov !== P.fov) { camera.fov = P.fov; camera.updateProjectionMatrix(); }
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
    let drag = null;
    const onDown = e => { drag = { x: e.clientX, y: e.clientY, azim: s.azim, elev: s.elev }; s.move = null; s.user = true; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); };
    const onMove = e => { if (!drag || !o.orbit) return; s.azim = drag.azim - (e.clientX - drag.x) * 0.008; s.elev = clamp(drag.elev + (e.clientY - drag.y) * 0.006, -0.6, 1.53); place(); };
    const onUp = () => { drag = null; };
    const onWheel = e => { if (!o.orbit) return; e.preventDefault(); s.user = true; s.move = null; s.radius = clamp(s.radius * (1 + Math.sign(e.deltaY) * 0.08), 1.2, 20); place(); };
    const onDbl = () => setView("hero");
    cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerup", onUp); cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false }); cv.addEventListener("dblclick", onDbl);

    // ---- frame loop: renders only when something changed or moves
    function frame(t) {
      if (s.disposed) return;
      s.raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      let moving = false;
      if (s.tween && s.car) {
        const k = clamp((t - (s.tween.t0 == null ? (s.tween.t0 = t) : s.tween.t0)) / MORPH_MS, 0, 1), e = EASE(k);
        if (k >= 1) { const tw = s.tween; s.tween = null; s.lastMs = build(tw.to, true); s.car.flash(tw.groups || s.rebuilt); emit(); }
        else { build(mixParams(s.tween.from, s.tween.to, e), false); s.tween.groups = Array.from(new Set((s.tween.groups || []).concat(s.rebuilt))); ghostRoot.visible = false; moving = true; }
      }
      if (s.car && s.car.tick(t)) moving = true;
      if (s.move) {
        const m = s.move; if (m.t0 == null) m.t0 = t;
        const k = clamp((t - m.t0) / MOVE_MS, 0, 1), e = EASE(k), f = m.from, P = m.to;
        let da = P.azim - f.azim; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        s.azim = f.azim + da * e; s.elev = lerp(f.elev, P.elev, e); s.radius = lerp(f.radius, P.radius, e); s.target.lerpVectors(f.target, P.target, e);
        place(); moving = true; if (k >= 1) { s.move = null; s.swayT0 = t; }
      } else if (o.orbit && !s.rm && !s.user && !drag && s.view !== "top" && s.view !== "side" && !s.loading) {
        const P = pose(s.view); s.azim = P.azim + SWAY.amp * Math.sin((t - s.swayT0) / 1000 * 2 * Math.PI / SWAY.period); place(); moving = true;
      }
      if (aeroTick(t)) moving = true;
      if (!s.dirty && !moving) return;
      s.dirty = false;
      render();
    }
    function render() { renderer.render(scene, camera); updateOverlay(); updateTags(); }
    function emit() { try { container.dispatchEvent(new CustomEvent("conceptview:design", { detail: { ms: s.lastMs, ghost: s.ghostParts || [], rebuilt: s.rebuilt || [], changes: s.changes } })); } catch (e) { /* fine */ } }
    // blend two param sets (numbers lerp, integers switch at half way, strings such as `material` take the target's)
    function mixParams(a, b, e) {
      const out = {};
      for (const part of Object.keys(b)) {
        out[part] = {};
        for (const k of Object.keys(b[part])) {
          const y = b[part][k]; if (typeof y !== "number") { out[part][k] = y; continue; }
          const x = a[part] && typeof a[part][k] === "number" ? a[part][k] : y;
          const sp = parts.BY_ID[part] && parts.BY_ID[part].params[k];
          out[part][k] = sp && sp.int ? (e < 0.5 ? x : y) : lerp(x, y, e);
        }
      }
      return out;
    }

    // ---- public API
    function setDesign(design, so) {
      if (!design || !design.params) throw new Error("conceptView.setDesign: a Design { params } is required");
      so = so || {};
      if (pickLivery(o, so.livery || design.livery, design.driver) && s.car) {
        s.car.dispose(); s.car = C.parts3d.createCar(carCtx); s.ghostParts = []; s.car.setHighlight(expand(s.highlight)); s.car.setMode(s.mode === "materials" ? "materials" : "solid");
        if (s.mode === "xray-mass") s.car.setXray(xrColour);
        s.tween = null; s.design = null;
      }
      if (so.baseline !== undefined) { s.baseline = so.baseline ? JSON.parse(JSON.stringify(so.baseline)) : null; s.baseMass = s.baseline ? massOf(s.baseline) : null; }
      const prev = s.design; s.design = JSON.parse(JSON.stringify(design));
      s.changes = prev ? changesBetween(prev, s.design) : [];
      s.mass = massOf(s.design, so.mass);
      if (!s.car) { s.tween = null; return { ms: null, pending: true }; }
      const animate = so.animate !== false && !s.rm && !!prev;
      if (animate) { s.tween = { from: s.tween ? mixParams(s.tween.from, s.tween.to, 0.5) : prev.params, to: s.design.params, t0: null, groups: [] }; s.dirty = true; return { ms: null, pending: true }; }
      s.tween = null;
      s.lastMs = build(s.design.params, true);
      if (prev && s.rebuilt.length && !s.rm) s.car.flash(s.rebuilt);
      emit();
      return { ms: s.lastMs, rebuilt: s.rebuilt.slice() };
    }
    const expand = (set) => { const out = new Set(); for (const id of set) for (const a of HIGHLIGHT_ALIAS[id] || [id]) out.add(a); return out; };
    function setHighlight(ids) {
      s.highlight = new Set(ids || []);
      if (!ids || !ids.length) s.changes = [];
      if (s.car) s.car.setHighlight(expand(s.highlight));
      s.dirty = true;
    }
    function setMode(mode) {
      if (MODES.indexOf(mode) < 0) throw new Error("conceptView.setMode: 'solid', 'xray-mass' or 'materials'");
      s.mode = mode;
      if (s.car) {
        s.car.setMode(mode === "materials" ? "materials" : "solid");
        if (mode === "xray-mass") buildXray(); else { clearGroup(xrRoot); for (const g of s.xrGeos) g.dispose(); s.xrGeos = []; s.tagRows = []; s.car.setXray(null); }
      }
      xrRoot.visible = mode === "xray-mass";
      mirror.visible = !!o.reflection && mode !== "xray-mass" && s.elev >= -0.01;
      ghostRoot.visible = mode !== "xray-mass" && !!(s.ghostParts && s.ghostParts.length);
      hiRoot.visible = mode !== "xray-mass";
      key.castShadow = !!o.shadows && mode !== "xray-mass";
      renderer.shadowMap.needsUpdate = true; s.dirty = true;
    }
    function setAero(a) { if (!["cycle", "corner", "straight"].includes(a)) throw new Error("conceptView.setAero: cycle | corner | straight"); s.aero = a; s.smPhaseT0 = now(); if (a !== "cycle" || s.rm) { s.smT = a === "straight" ? 1 : 0; if (s.car) s.car.setFlaps(s.smT); renderer.shadowMap.needsUpdate = true; } s.dirty = true; }
    function screenshot() {
      if (s.tween && s.car) { const tw = s.tween; s.tween = null; s.lastMs = build(tw.to, true); if (s.car) s.car.flash(tw.groups || s.rebuilt); }
      if (s.car) s.car.tick(now());   // the hot-swap flash as it is now (frames can be slower than the flash)
      const pr0 = renderer.getPixelRatio(), cw = Math.max(1, cv.clientWidth), pr = Math.min(o.shotScale || 1, 3840 / cw);
      if (pr > pr0) renderer.setPixelRatio(pr);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera); updateOverlay();
      const w = cv.width, h = cv.height, c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
      g.drawImage(cv, 0, 0);
      if (pr > pr0) { renderer.setPixelRatio(pr0); s.dirty = true; }
      const dpr = w / cw, fs = Math.round(11 * dpr);
      g.font = fs + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"; g.textBaseline = "top";
      if (o.label) { g.fillStyle = "#8a8a94"; g.textAlign = "right"; g.fillText(labelText(), w - 12 * dpr, 10 * dpr); }
      g.textAlign = "left";
      // tags (mass / change), as on screen
      for (const t of placeTags()) {
        const tw = g.measureText(t.text).width + 10 * dpr; g.fillStyle = "rgba(10,10,12,0.8)"; g.fillRect(t.x * dpr, t.y * dpr, tw, fs + 5 * dpr);
        if (t.kind === "change") { g.fillStyle = "#fbbf24"; g.fillRect(t.x * dpr, t.y * dpr, 2 * dpr, fs + 5 * dpr); }
        g.fillStyle = "#e8e8ec"; g.fillText(t.text, t.x * dpr + 5 * dpr, t.y * dpr + 2.5 * dpr);
      }
      if (o.legend) {
        const lines = legendLines().map(l => l.text || (l.html || "").replace(/<div[^]*$/, "").replace(/<[^>]+>/g, "")).filter(Boolean);
        if (s.loading) lines.push("building the car…");
        lines.forEach((t, i) => { g.fillStyle = "#8a8a94"; g.fillText(t, 12 * dpr, h - (lines.length - i) * (fs + 4 * dpr) - 8 * dpr); });
      }
      return c.toDataURL("image/png");
    }
    function stats() { const i = renderer.info; return Object.assign({ ms: s.lastMs, geometries: i.memory.geometries, textures: i.memory.textures, programs: (i.programs || []).length, triangles: i.render.triangles, ghost: s.ghostParts || [], rebuilt: s.rebuilt || [] }, s.car ? s.car.stats() : {}); }
    function dispose() {
      if (s.disposed) return; s.disposed = true; cancelAnimationFrame(s.raf);
      if (s.ro) s.ro.disconnect(); else root.removeEventListener("resize", resize);
      cv.removeEventListener("pointerdown", onDown); cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerup", onUp); cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("wheel", onWheel); cv.removeEventListener("dblclick", onDbl); document.removeEventListener("visibilitychange", onVis);
      if (s.car) s.car.dispose();
      for (const g of s.xrGeos) g.dispose(); for (const m of xrCache.values()) m.dispose();
      for (const m of [cogLineMat, cogBaseMat]) m.dispose(); cogMat.map.dispose(); cogMat.dispose();
      for (const m of [ground, pool, shadowPlane, contact]) { m.geometry.dispose(); m.material.dispose(); }
      poolTex.dispose(); cTex.dispose();
      if (scene.environment) scene.environment.dispose();
      renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
      for (const el of [cv, label, legend, tags, loadEl]) if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    const onVis = () => { if (!document.hidden) s.dirty = true; }; document.addEventListener("visibilitychange", onVis);
    if (root.ResizeObserver) { s.ro = new ResizeObserver(resize); s.ro.observe(container); } else root.addEventListener("resize", resize);

    const P0 = pose(s.view); s.azim = P0.azim; s.elev = P0.elev; s.radius = P0.radius; s.target.copy(P0.target); camera.fov = P0.fov; camera.updateProjectionMatrix();
    resize();
    setDesign(o.design || (C.design ? C.design.baseline() : baselineDesign()), { baseline: o.baseline === undefined ? null : o.baseline, animate: false });
    s.raf = requestAnimationFrame(frame);
    return {
      setDesign, setHighlight, setMode, setView, setAero, screenshot, labelText, stats, dispose,
      render: () => { if (s.tween && s.car) { const tw = s.tween; s.tween = null; s.lastMs = build(tw.to, true); } render(); },
      state: () => ({ loading: s.loading, error: s.error ? String(s.error.message || s.error) : null, mode: s.mode, view: s.view, aero: s.aero, straight: s.smT, ghost: (s.ghostParts || []).slice(), highlight: Array.from(s.highlight), ms: s.lastMs, layout: s.L, rebuilt: (s.rebuilt || []).slice(), changes: s.changes.slice() }),
      ready: () => ensureAssets().then(() => new Promise(r => { const k = () => (s.car || s.disposed ? r() : setTimeout(k, 20)); k(); })),
      el: container, canvas: cv,
      _debug: { scene, renderer, camera, s },
    };
  }
  // ---------------------------------------------------------------- buildCar: the concept car as a standalone THREE.Group
  // For another scene (e.g. the game's 3D Silverstone): no viewer, renderer, studio, label or camera. The frame is the game car's
  // (js/carglb.js): metres, x forward, y up, z to the car's right, ground at y = 0, front axle centre at x = +1.75 (fixed), rear axle
  // at x = 1.75 - wheelbase (m), wheel centres at the loaded tyre radius (group.userData.wheelCentreY, 0.3445 front). Place it like a
  // game car: group.position on the racing line, group.rotation.y = heading.
  //   const g = EI.conceptView.buildCar(design, { livery?, driver?, baseline?, lod?, straight? })
  //   g.ready -> Promise<g> (resolved at once when the page already has the livery scripts and geometry modules; else this loads
  //   them, like mount() does). g.setDesign(design) (rebuilds only the parts that changed), g.setAero(t 0 corner .. 1 straight),
  //   g.dispose() (geometry, materials, livery textures; removes itself from its parent). lod: "hi" (4096 px livery atlas) or "lo"
  //   (2048). The paint is MeshPhysical with clear coat: it reads best with scene.environment set (an env map), as in the view.
  function buildCar(design, bo) {
    const THREE = T(); bo = bo || {};
    if (!THREE) throw new Error("conceptView.buildCar: load vendor/three.min.js first");
    if (!parts && bo.parts && bo.parts.geometry) parts = bo.parts;
    if (!parts) throw new Error("conceptView.buildCar: load concept/regs.js and concept/parts.js first");
    if (!design || !design.params) design = C.design ? C.design.baseline("redbull") : baselineDesign();
    const o = Object.assign({}, DEFAULTS, { liverySize: bo.lod === "lo" ? 1024 : 2048 });
    if (bo.driver != null) o.driver = bo.driver;
    pickLivery(o, bo.livery || design.livery || "redbull", bo.driver != null ? null : design.driver);
    const group = new THREE.Group(); group.name = "concept-car";
    const carRoot = new THREE.Group(), ghostRoot = new THREE.Group(), hiRoot = new THREE.Group(), mirror = new THREE.Group();   // mirror: not attached (no studio floor here)
    group.add(carRoot, ghostRoot, hiRoot);
    let car = null, disposed = false, cur = design, flap = bo.straight ? 1 : 0;
    const apply = () => {
      if (!car) return;
      car.setLayout(layout(cur.params));
      if (bo.baseline && bo.baseline.params) car.setGhost(layout(bo.baseline.params)); else car.hideGhost();
      car.setFlaps(flap);
      const sp = car.spec();
      group.userData = { units: "m", forward: "+x", up: "+y", right: "+z", ground_y: 0, frontAxleX: GLB.FA, rearAxleX: wx(sp.XR), wheelCentreY: sp.wheel.front.hc / 1000, wheelCentreYRear: sp.wheel.rear.hc / 1000, design_id: cur.id || null, team: o.team, driver: o.driver };
    };
    const make = () => { if (disposed) return group; car = C.parts3d.createCar({ THREE, o, carRoot, mirror, ghostRoot, hiRoot }); apply(); return group; };
    const have = !!(C.parts3d && C.car3d && C.mesh3d && EI.TEAM_BY_ID && EI.LIVERIES);
    group.ready = have ? Promise.resolve(make()) : ensureAssets().then(make);
    group.setDesign = (d) => { if (!d || !d.params) throw new Error("buildCar.setDesign: a Design { params } is required"); cur = d; apply(); return group; };
    group.setAero = (t) => { flap = clamp(+t || 0, 0, 1); if (car) car.setFlaps(flap); return group; };
    group.dispose = () => {
      if (disposed) return; disposed = true;
      if (car) car.dispose(); car = null;
      for (const g of [carRoot, ghostRoot, hiRoot, mirror]) while (g.children.length) g.remove(g.children[0]);
      if (group.parent) group.parent.remove(group);
    };
    return group;
  }

  function baselineDesign() {
    const params = {}; for (const p of parts.CATALOGUE) { params[p.id] = {}; for (const k of Object.keys(p.params)) params[p.id][k] = p.params[k].base; }
    return { id: "baseline", label: "Baseline", params };
  }

  const api = { mount, buildCar, layout, changesBetween, LABEL, EFFECTS, VIEWS, MODES, FIX, GLB, DEFAULTS, RAMP, REGIONS, reducedMotion, labelText: () => LABEL,
    _internal: { overlayMaterial, rampColor, wx, srgb, ss, sstep, lerp, clamp, rad, RID } };
  EI.conceptView = api; C.view = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
