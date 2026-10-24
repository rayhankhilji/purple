// PURPLE CONCEPT - the 3D view of the CONCEPT car (v2): the game's high-detail car (assets/models/ei-car-hi.glb, js/carglb.js
// materials and the team livery) re-shaped by a Design's shape parameters (concept/parts.js), with the parts the optimiser changes
// most rebuilt procedurally at full detail (concept/view/parts3d.js: lofted multi-element wings, floor, diffuser). True metres.
// Schematic, not a CAD model: the body is the game's car deformed to the design's anchors, the aero parts are lofts of simple
// sections placed by the parameters; nothing here is a measured or tested shape.
//
// Contract (the lab pages embed this; mirrors lab/car3d.js conventions: dark studio, honesty label in the view, reduced motion, dispose):
//   const v = EI.conceptView.mount(containerEl, opts?)    the canvas appears at once; the car once its model and livery are in (a few s;
//        await v.ready() before a frame-exact capture). opts: design, baseline, mode, view, aero, label, legend, orbit, parts,
//        livery ("redbull-rb22": the team prefix picks the game livery; default Red Bull), driver (index or code, e.g. "HAD";
//        default the design's own `driver`), exaggerate, shadows, reflection
//   setDesign(..., { livery }) or a design carrying another livery / driver rebuilds the car in that livery (once, not per call)
//   EI.conceptView.buildCar(design, { livery, driver, baseline, lod, straight }) -> THREE.Group for another scene (no viewer or
//        renderer; game-car frame: metres, x forward, y up, ground y = 0; .ready, .setDesign, .setAero, .dispose; see buildCar below)
//   v.setDesign(design, { baseline?, animate?, mass? }) -> { ms }   rebuild from design.params. baseline: a Design (ghost the parts that
//        differ from it, purple), null (clear), undefined (keep). animate (default true): morph from the previous design over 450 ms
//        (off under prefers-reduced-motion). mass: a mass sheet (bench(design).mass) for x-ray; default parts.massSheet(design.params).
//        Before the model is loaded the design is kept and applied when it is ({ ms: null, pending: true }).
//   v.setHighlight([partId])  catalogue part ids (front_wing, rear_wing, floor, sidepods, ...) tinted amber; [] clears
//   v.setMode('solid' | 'xray-mass')   x-ray: bodywork translucent, every mass-sheet row a sphere (volume ∝ mass, colour = mass), CoG marker
//   v.setView('hero' | 'front34' | 'rear34' | 'side' | 'top' | 'front' | 'rear' | 'frontwing' | 'rearwing' | 'floor', { animate })
//   v.setAero('cycle' | 'corner' | 'straight')   straight-mode flap state when the design uses it (cycle: 400 ms swing every few s)
//   v.screenshot() -> PNG data URL (the honesty label and legend are drawn into the image)
//   v.labelText() -> the in-view label;  v.stats() -> { ms, geometries, textures, meshes, ... };  v.state() -> { loading, ... };  v.dispose()
// Needs THREE r128 (vendor/three.min.js) and concept/regs.js, parts.js at mount. Loads by itself, from the repo root, what the page
// did not include: vendor/GLTFLoader.js, js/util.js, the livery pipeline (season data, ads, teams, liveries, js/carglb.js) and
// concept/view/parts3d.js. Dual: window.EI.conceptView, and module.exports (layout() and the parameter-effect table work in Node).
// No network beyond the repo's own files, no Mubit.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  let parts = req("parts", "../parts.js");   // or mount(..., { parts }) when the page loaded it under another name

  const LABEL = "concept geometry from the design parameters on the game's car model · schematic, not a CAD model";
  const DEFAULTS = {
    team: "redbull", driver: 0,  // livery (EI.TEAM_BY_ID key) and which of its drivers (index, or driver code such as "HAD": number, helmet)
    livery: null,           // a design's livery id ("redbull-rb22"): its team prefix picks `team` (concept/design.js TEAMS)
    background: 0x0b0c10,   // near DESIGN_SYSTEM --bg, a touch of blue for the studio
    ghostColor: 0xb26cff,   // --purple: the baseline
    highlightColor: 0xfbbf24, // --amber: parts named by setHighlight
    exaggerate: 1,          // display gain on ride height and wing-setting deltas vs the baseline car; 1 = true geometry (stated in the label if not 1)
    orbit: true,            // idle sway about the view (off under reduced motion) + drag to orbit, wheel to zoom, double-click for the hero
    label: true, legend: true,
    view: "hero", mode: "solid", aero: "cycle",
    pixelRatioCap: 2, shotScale: 2,   // screenshot(): rendered at this pixel ratio (MSAA on top), capped at 3840 px wide
    shadows: true, reflection: true,
    liverySize: 2048,
  };
  // what each shape parameter visibly drives (kept honest: parameters with no geometry say so)
  const EFFECTS = {
    "layout.wheelbase_mm": "rear axle and everything behind it move; sidepods, floor, engine cover and rear suspension stretch between the ICE face and the rear axle",
    "survival_cell.front_axle_offset_mm": "monocoque front (XA) relative to the front axle: nose length and cell front move, the wheels stay",
    "survival_cell.cockpit_len_mm": "cockpit rear (XC): cockpit opening, halo, airbox and sidepod inlets move with it",
    "survival_cell.bulkhead_gap_mm": "ICE face (XPU): engine-cover shoulders and sidepod length",
    "front_wing.span_mm": "front wing element span and endplate position", "front_wing.chord_mm": "front wing X extent (all elements, chord shares fixed)",
    "front_wing.aoa_deg": "front wing element angles (schematic angle scale)", "front_wing.elements": "number of front wing elements (slot gaps between them)",
    "front_wing.sm_delta_deg": "front flaps' straight-mode swing about their leading edge + white outline",
    "rear_wing.span_mm": "rear wing span and endplate position", "rear_wing.chord_mm": "rear wing X extent", "rear_wing.aoa_deg": "rear wing element angles (schematic angle scale)",
    "rear_wing.elements": "number of rear wing elements", "rear_wing.endplate_top_mm": "rear endplate top height (Z)", "rear_wing.sm_delta_deg": "rear flap straight-mode swing about its trailing edge + white outline",
    "floor.width_mm": "floor body planform width, floor edge and its fences, diffuser width", "floor.throat_mm": "venturi tunnel roof height: inlet mouths, tunnel fences, diffuser kink (front, rear and floor views, x-ray)",
    "floor.ride_height_mm": "sprung body height above the ground (wheels stay; suspension arms follow)", "diffuser.expansion_deg": "diffuser ramp angle and exit height",
    "sidepods.inlet_cm2": "inlet mouth size and sidepod front bulk", "sidepods.undercut_mm": "depth of the cut under the sidepod's outer flank",
    "ballast.x_frac": "no bodywork: ballast sphere position in x-ray mass mode", "ballast.extra_kg": "no bodywork: ballast sphere size in x-ray mass mode",
  };
  // fixed dimensions (mm) that are not design parameters
  const FIX = { tyreR: 360, plank: 10, glbRide: 52 };
  // GLB car frame (metres, x forward, y up, z right): front axle, and where the baseline design's anchors sit on the game's car
  const GLB = { FA: 1.75, RA: -1.85, XA: 1.825, XC: -0.105, XPU: -0.485, noseTip: 3.054 };
  const PAIR_Y = { wheels_front: 790, wheels_rear: 760, brakes_front: 700, brakes_rear: 700, front_suspension: 500, rear_suspension: 500, sidepods: 550, cooling: 500, pu_mguk: 120, pu_electronics: 150 };
  const HIGHLIGHT_ALIAS = { layout: ["wheels_rear", "floor", "engine_cover", "rear_suspension"], survival_cell: ["survival_cell", "nose", "halo"], cooling: ["sidepods"], ballast: [] };
  const RAMP = ["#173840", "#1f5a66", "#2b8394", "#4fb6c8", "#9be9f5"];
  // vertex regions (catalogue ids) used by highlight, ghost and x-ray colouring
  const REGIONS = ["none", "nose", "survival_cell", "halo", "rear_impact", "front_wing", "rear_wing", "floor", "diffuser", "sidepods", "engine_cover", "gearbox", "front_suspension", "rear_suspension", "wheels_front", "wheels_rear", "brakes_front", "brakes_rear", "driver", "misc", "electronics", "pu_electronics", "cooling"];
  const RID = {}; REGIONS.forEach((r, i) => { RID[r] = i; });

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const ss = (a, b, x) => sstep((x - a) / (b - a));
  const rad = d => d * Math.PI / 180;

  // ---------------------------------------------------------------- layout: everything the geometry needs, in mm (FIA car frame)
  // x rearward from the front axle (XF=0), y from the centre plane, z up from the reference plane Z=0. Pure: no three.js.
  function layout(params, opts) {
    const g = parts.geometry(params), p = params, gain = (opts && opts.exaggerate) || 1, B = (opts && opts.base) || null;
    const ex = (v, b) => (gain === 1 || b == null ? v : b + gain * (v - b));
    const fw = p.front_wing, rw = p.rear_wing, fl = p.floor;
    const XA = g.XA, XC = g.XC, XPU = g.XPU, XR = g.XR;
    return {
      XA, XC, XPU, XR, rh: ex(fl.ride_height_mm, B && B.floor.ride_height_mm),
      fw: { span: fw.span_mm, chord: fw.chord_mm, n: Math.round(fw.elements), aoa: ex(fw.aoa_deg, B && B.front_wing.aoa_deg), sm: fw.sm_delta_deg, le: -1250 },
      rw: { span: rw.span_mm, chord: rw.chord_mm, n: Math.round(rw.elements), aoa: ex(rw.aoa_deg, B && B.rear_wing.aoa_deg), sm: rw.sm_delta_deg, E: rw.endplate_top_mm, x0: XR + 170 },
      floor: { W: fl.width_mm, throat: fl.throat_mm, deg: p.diffuser.expansion_deg, x0: 250, xk: XR - 560, xe: XR + 330 },
      sp: { inlet: p.sidepods.inlet_cm2, u: p.sidepods.undercut_mm },
      ballast: { x: p.ballast.x_frac * XR, kg: p.ballast.extra_kg },
    };
  }

  // livery id ("redbull-rb22") -> o.team (its team prefix) and o.driver (a driver code such as "HAD"); true if either changed
  function pickLivery(o, livery, driverCode) {
    let changed = false;
    if (typeof livery === "string" && livery) { const t = livery.split("-")[0]; if (t && t !== o.team) { o.team = t; changed = true; } }
    if (typeof driverCode === "string" && driverCode && driverCode !== o.driver) { o.driver = driverCode; changed = true; }
    return changed;
  }

  // ---------------------------------------------------------------- three.js part (browser only)
  const T = () => root.THREE;
  const reducedMotion = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const now = () => (root.performance ? root.performance.now() : Date.now());
  const srgb = (hex) => new (T().Color)(hex).convertSRGBToLinear();
  // FIA mm -> world metres (x forward, front axle at GLB.FA)
  const wx = x => GLB.FA - x / 1000;

  // repo root from this script's own URL (concept/view/view3d.js), so the page's location does not matter
  const SCRIPT_URL = (() => { try { const cs = typeof document !== "undefined" && document.currentScript; return (cs && cs.src) || ""; } catch (e) { return ""; } })();
  const ROOT = SCRIPT_URL ? SCRIPT_URL.replace(/concept\/view\/[^/]*(\?.*)?$/, "") : "../../";
  const loadScript = (src) => new Promise((res, rej) => { const el = document.createElement("script"); el.src = src; el.async = false; el.onload = () => res(); el.onerror = () => rej(new Error("conceptView: failed to load " + src)); document.head.appendChild(el); });
  const LIVERY_SCRIPTS = ["js/data/season2026.js", "js/ads.js", "js/teams.js", "js/liveries.js", "js/liveries/mercedes.js", "js/liveries/ferrari.js", "js/liveries/mclaren.js", "js/liveries/redbull.js", "js/liveries/racingbulls.js", "js/liveries/alpine.js", "js/liveries/haas.js", "js/liveries/audi.js", "js/liveries/williams.js", "js/liveries/astonmartin.js", "js/liveries/cadillac.js", "js/liveries/lumi.js", "js/liveries/intake.js"];
  let assetsP = null;
  // everything the car needs, once per page: scripts, the GLB (carglb's own loader; its relative 'assets/models/' paths are pointed at
  // the repo root while it loads), brand artwork (never more than 3.5 s)
  function ensureAssets() {
    if (assetsP) return assetsP;
    assetsP = (async () => {
      const THREE = T();
      if (!THREE.GLTFLoader) await loadScript(ROOT + "vendor/GLTFLoader.js");
      if (!EI.U) await loadScript(ROOT + "js/util.js");
      for (const f of LIVERY_SCRIPTS) {
        if (f === "js/data/season2026.js" && EI.SEASON) continue; if (f === "js/ads.js" && EI.Ads) continue; if (f === "js/teams.js" && EI.TEAM_BY_ID) continue;
        if (f.startsWith("js/liveries") && EI.LIVERIES && EI.LIVERIES.has && f !== "js/liveries.js" && EI.LIVERIES.has(f.replace(/^.*\/|\.js$/g, ""))) continue;
        if (f === "js/liveries.js" && EI.LIVERIES) continue;
        await loadScript(ROOT + f);
        if (f === "js/ads.js" && EI.Ads) { EI.Ads.BRAND_DIR = ROOT + "assets/brand/"; EI.Ads.PARTNER_DIR = EI.Ads.BRAND_DIR + "partners/"; }
      }
      if (!EI.CarGLB) await loadScript(ROOT + "js/carglb.js");
      if (!C.parts3d) await loadScript(ROOT + "concept/view/parts3d.js");
      if (!EI.CarGLB.ready) {
        const f0 = root.fetch, base = ROOT + "assets/models/";
        root.fetch = (u, o) => f0.call(root, typeof u === "string" && u.indexOf("assets/models/") === 0 ? base + u.slice(14) : u, o);
        try { await EI.CarGLB.preload(); } finally { root.fetch = f0; }
      }
      if (EI.Ads && EI.Ads.ready) await Promise.race([EI.Ads.ready(), new Promise((r) => setTimeout(r, 3500))]);
      return EI.CarGLB;
    })();
    assetsP.catch(() => { assetsP = null; });
    return assetsP;
  }

  // ---------------------------------------------------------------- studio: environment, ground, reflections
  // a dark photo studio: a long overhead softbox, two tall strip boxes and a low warm kicker, baked to a PMREM environment; the
  // softboxes are > 1 (HDR) so the clear coat carries crisp long highlights like a launch render
  function studioEnv(renderer) {
    const THREE = T(), room = new THREE.Scene(); room.background = null;
    { const shell = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: 0x030304, side: THREE.BackSide })); shell.position.y = 6.9; room.add(shell); }   // a dark room (a clear colour does not survive the RGBE target)
    const box = (w, h, x, y, z, ry, rx, c, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k || 1), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); room.add(m); };
    box(6, 0.7, 0, 5, 0, 0, Math.PI / 2, 0xffffff, 3.2);             // overhead strip, along the car
    box(4, 0.35, 0, 4.6, 2.6, 0, Math.PI / 2 - 0.35, 0xeef2ff, 1.6);  // overhead fill strips, off axis
    box(4, 0.35, 0, 4.6, -2.6, 0, Math.PI / 2 + 0.35, 0xeef2ff, 1.2);
    box(0.7, 2.6, 5.5, 2.0, 3.2, -Math.PI / 3, 0, 0xdfe7ff, 2.6);   // key strip, front right
    box(0.7, 2.6, -5.5, 1.8, 3.0, -Math.PI * 0.62, 0, 0xc8d6ff, 2.2);  // rim strip, rear right
    box(0.7, 2.6, -4.5, 1.8, -3.6, Math.PI * 0.7, 0, 0xc8d6ff, 1.8);  // rim strip, rear left
    box(0.7, 2.6, 4.5, 2.0, -3.4, Math.PI * 0.3, 0, 0xffe2c4, 0.9);  // warm fill, front left
    box(12, 0.25, 0, 0.5, -6.5, 0, 0, 0x6f7c9a, 0.35);              // low horizon bounce (edges the sidepods' lower flanks)
    box(12, 0.25, 0, 0.5, 6.5, Math.PI, 0, 0x6f7c9a, 0.35);
    box(40, 40, 0, -0.02, 0, 0, -Math.PI / 2, 0x040406, 1);          // floor
    const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
    const env = pm.fromScene(room, 0.02).texture; pm.dispose();
    room.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return env;
  }
  // radial pool of light on the floor (the floor reflection fades with it) + soft contact shadow texture under the car
  function radialTex(stops, size) {
    const c = document.createElement("canvas"); c.width = c.height = size || 256; const g = c.getContext("2d"), S = c.width / 2;
    const grd = g.createRadialGradient(S, S, 0, S, S, S); for (const [t, col] of stops) grd.addColorStop(t, col);
    g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height); return new (T().CanvasTexture)(c);
  }
  function contactTex() {
    const THREE = T(), W = 256, H = 128, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"), im = g.createImageData(W, H), d = im.data;
    const sx = 5.6, sz = 2.6, cx = -0.05, tyres = [[1.75, 0.8, 0.36, 0.17], [1.75, -0.8, 0.36, 0.17], [-1.65, 0.78, 0.37, 0.21], [-1.65, -0.78, 0.37, 0.21]];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = cx + ((i + 0.5) / W - 0.5) * sx, z = ((j + 0.5) / H - 0.5) * sz;
      const e = Math.hypot((x + 0.1) / 2.5, z / 0.82); let a = 0.55 * (1 - ss(0.3, 1.0, e));
      for (const [tx, tz, rx, rz] of tyres) { const t = Math.hypot((x - tx) / rx, (z - tz) / rz); a = 1 - (1 - a) * (1 - 0.85 * (1 - ss(0.1, 1.0, t))); }
      const u = (i + 0.5) / W, v = (j + 0.5) / H; a *= ss(0, 0.1, Math.min(u, 1 - u)) * ss(0, 0.14, Math.min(v, 1 - v));
      const k = (j * W + i) * 4; d[k] = d[k + 1] = d[k + 2] = 0; d[k + 3] = Math.round(Math.min(0.9, a) * 255);
    }
    g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.userData = { sx, sz, cx }; return t;
  }

  // ---------------------------------------------------------------- materials
  // clear-coated metallic paint over the livery: satin base, procedural flake, glassy lacquer (the studio's softboxes read in it)
  function paintMaterial(tex, opts) {
    const THREE = T(); opts = opts || {};
    const m = new THREE.MeshPhysicalMaterial({ map: tex || null, color: opts.color != null ? srgb(opts.color) : 0xffffff, metalness: opts.metal != null ? opts.metal : 0.12, roughness: opts.rough != null ? opts.rough : 0.42, clearcoat: 1.0, clearcoatRoughness: 0.025, envMapIntensity: 1.0, side: THREE.DoubleSide });
    m.extensions = { derivatives: true };
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = "varying vec3 vFlkPos;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvFlkPos = position;");
      sh.fragmentShader = "varying vec3 vFlkPos;\n" + sh.fragmentShader.replace("#include <normal_fragment_maps>", [
        "#include <normal_fragment_maps>",
        "{ vec3 fp = vFlkPos * 420.0; vec3 fc = floor(fp);",
        "  vec3 fh = fract(sin(vec3(dot(fc, vec3(127.1, 311.7, 74.7)), dot(fc, vec3(269.5, 183.3, 246.1)), dot(fc, vec3(113.5, 271.9, 124.6)))) * 43758.5453) - 0.5;",
        "  float ffw = length(fwidth(fp)); normal = normalize(normal + fh * 0.05 * (1.0 - smoothstep(0.3, 1.1, ffw))); }"].join("\n"));
    };
    m.customProgramCacheKey = () => "cv-paint" + (tex ? "-map" : "");
    return m;
  }
  // helmet: the driver's design (EI.LIVERIES.helmet) by the same cylindrical projection as the game's LOD shader
  function helmetMaterial(car) {
    const THREE = T(), c = document.createElement("canvas"); c.width = 512; c.height = 256; const g = c.getContext("2d"), d = car.driver || {};
    g.fillStyle = d.helmet || car.team.helmet || car.team.accent; g.fillRect(0, 0, 512, 256);
    try { if (EI.LIVERIES && EI.LIVERIES.helmet) { g.save(); g.scale(2, 2); EI.LIVERIES.helmet(g, 256, 128, d, car.team, car.num); g.restore(); } } catch (e) { /* plain helmet */ }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    const m = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.15, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = "varying vec3 vHelmP;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvHelmP = position;");
      sh.fragmentShader = "varying vec3 vHelmP;\n" + sh.fragmentShader.replace("#include <map_fragment>", "vec2 hu = vec2(atan(vHelmP.z, vHelmP.x - 0.16) * 0.159155 + 0.5, clamp((vHelmP.y - 0.665) / 0.21, 0.0, 1.0)); diffuseColor *= mapTexelToLinear(texture2D(map, hu));");
    };
    m.customProgramCacheKey = () => "cv-helmet";
    return m;
  }
  // wheel covers: the team's cover design (EI.LIVERIES.cover) as a disc in the wheel plane (local coordinates of the wheel node)
  function coverMaterial(team) {
    const THREE = T(), S = 512, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
    g.fillStyle = "#121316"; g.fillRect(0, 0, S, S);
    try { if (EI.LIVERIES && EI.LIVERIES.cover) EI.LIVERIES.cover(g, S, team); } catch (e) { /* plain */ }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    const m = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.2, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.12 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = "varying vec3 vCovP;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvCovP = position;");
      sh.fragmentShader = "varying vec3 vCovP;\n" + sh.fragmentShader.replace("#include <map_fragment>", "vec2 cu = vCovP.xy / 0.56 + 0.5; if (vCovP.z < 0.0) cu.x = 1.0 - cu.x; diffuseColor *= mapTexelToLinear(texture2D(map, cu));");
    };
    m.customProgramCacheKey = () => "cv-cover";
    return m;
  }
  // tyre sidewall: compound stripe and moulded lettering (polar canvas for a RingGeometry 0.27..0.335 m)
  function tyreWallTexture(col) {
    const THREE = T(), S = 1024, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d"), R = S / 2, M = R / 0.335;
    g.translate(R, R); const rt = 0.3015 * M;
    g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 0.0015 * M; g.beginPath(); g.arc(0, 0, 0.2755 * M, 0, 6.283); g.stroke();
    g.strokeStyle = col; g.lineWidth = 0.0062 * M; g.lineCap = "round";
    for (let k = 0; k < 4; k++) { const m = k * Math.PI / 2; g.beginPath(); g.arc(0, 0, 0.3255 * M, m - 0.36, m + 0.36); g.stroke(); }
    const arcText = (w, a0, fs, fill, font, track) => {
      g.font = font.replace("%", Math.round(fs)); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = fill;
      const ws = w.split("").map(ch => ch === " " ? fs * 0.32 : g.measureText(ch).width + fs * track), tot = ws.reduce((x, y) => x + y, 0);
      let a = a0 - tot / rt / 2;
      w.split("").forEach((ch, i) => { const da = ws[i] / rt; if (ch !== " ") { g.save(); g.rotate(a + da / 2); g.translate(0, -rt); g.fillText(ch, 0, 0); g.restore(); } a += da; });
    };
    for (let k = 0; k < 4; k++) {
      const a0 = k * Math.PI / 2 + Math.PI / 4;
      if (k % 2 === 0) arcText("P ZERO", a0, 0.044 * M, col, 'italic 900 %px "Titillium Web", "Arial Black", sans-serif', 0.02);
      else arcText("PIRELLI", a0, 0.037 * M, "#f4f4f4", '900 %px "Titillium Web", "Arial Black", sans-serif', 0.06);
    }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8; return tex;
  }
  // overlay material: the baseline ghost (purple), the highlight (amber), the x-ray shell. Fresnel rim + a flat base, weighted per
  // vertex by attribute `aw` (ghost: how far this vertex moved vs the design; highlight: in a highlighted part) and coloured by `acol`
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
  const rampColor = (t) => {   // t in 0..1 -> sRGB hex on RAMP
    t = clamp(t, 0, 1) * (RAMP.length - 1); const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
    const a = parseInt(RAMP[i].slice(1), 16), b = parseInt(RAMP[i + 1].slice(1), 16);
    const ch = s => Math.round(lerp((a >> s) & 255, (b >> s) & 255, f));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  const shortName = id => { const p = parts.BY_ID[id]; if (!p) return id; return p.name.split(" (")[0].split(",")[0].replace(" and tyres", "").replace("PU · ", "").replace("energy store", "Energy store"); };

  // ---------------------------------------------------------------- views
  // camera on a sphere around a target: azim 0 = behind the car, π/2 = its right side, π = in front; elev above the ground; radius for a 1.6 frame
  const VIEWS = {
    hero: { azim: 2.36, elev: 0.24, radius: 8.6, target: [0.3, 0.3, 0], fov: 28 },
    front34: { azim: 2.2, elev: 0.12, radius: 8.4, target: [0.4, 0.32, 0], fov: 28 },
    rear34: { azim: 0.72, elev: 0.2, radius: 8.2, target: [-0.2, 0.38, 0], fov: 28 },
    rearwing: { azim: 0.55, elev: 0.3, radius: 3.6, target: [-2.05, 0.62, 0], fov: 28 },
    frontwing: { azim: 2.35, elev: 0.34, radius: 3.6, target: [2.5, 0.16, 0], fov: 28 },
    side: { azim: Math.PI / 2, elev: 0.02, radius: 9.6, target: [0.2, 0.45, 0], fov: 26 },
    top: { azim: Math.PI / 2, elev: 1.53, radius: 9.8, target: [0.2, 0.2, 0], fov: 26 },
    front: { azim: Math.PI, elev: 0.08, radius: 6.8, target: [0, 0.4, 0], fov: 28 },
    rear: { azim: 0, elev: 0.12, radius: 6.8, target: [0, 0.42, 0], fov: 28 },
    floor: { azim: 2.75, elev: 0.0, radius: 7.6, target: [0.1, 0.16, 0], fov: 28 },
  };
  const REF_ASPECT = 1.6, MOVE_MS = 600, EASE = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const SWAY = { amp: 0.16, period: 28 }, MORPH_MS = 450, SM_HOLD_MS = 2600, SM_SWING_MS = 400;

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
    renderer.physicallyCorrectLights = false;
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
    const loadEl = document.createElement("div"); loadEl.className = "cv-loading";
    loadEl.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#8a8a94;pointer-events:none;text-align:center;" + mono;
    loadEl.textContent = "loading the car model and livery…"; container.appendChild(loadEl);

    const scene = new THREE.Scene(); scene.background = new THREE.Color(o.background);   // cleared raw (no tone mapping), like the ground
    scene.environment = studioEnv(renderer);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
    scene.add(new THREE.HemisphereLight(0x46506a, 0x050507, 0.35));
    const key = new THREE.DirectionalLight(0xfff3e6, 1.6); key.position.set(3.0, 8, 3.5); key.castShadow = !!o.shadows;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    const sc = key.shadow.camera; sc.near = 2; sc.far = 16; sc.left = -3.6; sc.right = 3.6; sc.bottom = -2.2; sc.top = 2.2; scene.add(key); scene.add(key.target);
    const rim = new THREE.DirectionalLight(0xbcd0ff, 1.25); rim.position.set(-6, 3.5, -4); scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0xbcd0ff, 0.8); rim2.position.set(-5, 2.5, 5); scene.add(rim2);
    const fill = new THREE.DirectionalLight(0xffe6cf, 0.35); fill.position.set(5, 1.5, -4); scene.add(fill);
    // ground: glossy dark studio floor with the car mirrored under it (planar reflection), a pool of light, the key's shadow and a
    // soft contact shadow under the car
    const poolTex = radialTex([[0, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,0.85)"], [1, "rgba(255,255,255,0)"]]);
    // same colour as the background, so the floor has no horizon line; the mirrored car shows through it near the car
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
      car: null, xrGeos: [],
    };

    // ---- the car: built once the assets are in
    const carCtx = { THREE, o, carRoot, mirror, ghostRoot, hiRoot, scene, renderer };
    ensureAssets().then(() => {
      if (s.disposed) return;
      s.car = C.parts3d.createCar(carCtx);
      s.loading = false; loadEl.remove();
      if (s.design) { s.lastMs = build(s.design.params, true); emit(); }
      if (s.mode !== "solid") setMode(s.mode);
      try { container.dispatchEvent(new CustomEvent("conceptview:ready", { detail: { ms: s.lastMs } })); } catch (e) { /* fine */ }
    }).catch((e) => { console.error(e); s.error = e; loadEl.textContent = "car model unavailable: " + String(e && e.message || e); s.loading = false; s.dirty = true; });

    function build(params, withGhost) {
      if (!s.car) return null;
      const t0 = now();
      const L = layout(params, { exaggerate: o.exaggerate, base: s.baseline ? s.baseline.params : null });
      s.car.setLayout(L, { highlight: s.highlight, mode: s.mode });
      s.L = L;
      if (withGhost) { s.ghostParts = s.car.setGhost(s.baseline ? layout(s.baseline.params, { exaggerate: o.exaggerate, base: s.baseline.params }) : null); }
      else s.car.hideGhost();
      ghostRoot.visible = s.mode !== "xray-mass" && s.ghostParts.length > 0;
      applyFlaps();
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
    const zW = (z_mm) => (z_mm + FIX.plank + (s.L ? s.L.rh : 35)) / 1000;   // FIA Z (above the plank top) -> world y
    function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }
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
      if (s.car) s.car.setXray(s.mass ? (id) => rampColor(Math.sqrt((s.mass.byId[id] || 0) / s.mass.max)) : null);
    }
    function massOf(design, given) {
      const m = given || parts.massSheet(design.params, { overrides: design.overrides });
      const rows = m.parts || [], byId = {}; let max = 1; for (const r of rows) { byId[r.id] = (byId[r.id] || 0) + r.mass_kg; max = Math.max(max, r.mass_kg); }
      return { rows, byId, max, total_kg: m.total_kg, cog_x_mm: m.cog_x_mm, cog_z_mm: m.cog_z_mm, front_share: m.front_share, ballast_kg: m.ballast_kg };
    }

    // ---- straight mode
    const usesSM = () => !!(s.L && (s.L.fw.sm > 0 && s.L.fw.n >= 2 || s.L.rw.sm > 0 && s.L.rw.n >= 2));
    function applyFlaps() { if (s.car) s.car.setFlaps(s.smT); }
    function aeroTick(t) {
      if (!usesSM()) { if (s.smT !== 0) { s.smT = 0; applyFlaps(); } return false; }
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
      if (s.loading) return out;
      if (s.mode === "xray-mass" && s.mass) {
        out.push({ html: "<b style='color:#e8e8ec;font-weight:600'>x-ray · mass</b> · concept part-mass estimates v1 (not measured)" });
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
      const w = cv.clientWidth, h = cv.clientHeight, v = new THREE.Vector3(), placed = [];
      s.tagEls.forEach((el, i) => {
        const r = want[i]; if (!r) { el.style.display = "none"; return; }
        v.set(wx(r.x_mm), zW(r.z_mm), 0).project(camera);
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
    function pose(name) { const V = VIEWS[name] || VIEWS.hero; return { azim: V.azim, elev: V.elev, radius: V.radius * fitScale(), fov: V.fov || 28, target: new THREE.Vector3().fromArray(V.target) }; }
    function place() {
      const ce = Math.cos(s.elev), t = s.target;
      camera.position.set(t.x - s.radius * ce * Math.cos(s.azim), t.y + s.radius * Math.sin(s.elev), t.z + s.radius * ce * Math.sin(s.azim));
      camera.lookAt(t); s.dirty = true;
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
    // pointer orbit (drag), wheel zoom, double-click back to the hero
    let drag = null;
    const onDown = e => { drag = { x: e.clientX, y: e.clientY, azim: s.azim, elev: s.elev }; s.move = null; s.user = true; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); };
    const onMove = e => { if (!drag || !o.orbit) return; s.azim = drag.azim - (e.clientX - drag.x) * 0.008; s.elev = clamp(drag.elev + (e.clientY - drag.y) * 0.006, -0.03, 1.53); place(); };
    const onUp = () => { drag = null; };
    const onWheel = e => { if (!o.orbit) return; e.preventDefault(); s.user = true; s.move = null; s.radius = clamp(s.radius * (1 + Math.sign(e.deltaY) * 0.08), 2.2, 20); place(); };
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
        if (k >= 1) { const tw = s.tween; s.tween = null; s.lastMs = build(tw.to, true); emit(); }
        else { build(mixParams(s.tween.from, s.tween.to, e), false); ghostRoot.visible = false; moving = true; }
      }
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
      // a livery (so.livery or the design's own) for another team or driver: the car is rebuilt in that livery once
      if (pickLivery(o, so.livery || design.livery, design.driver) && s.car) {
        s.car.dispose(); s.car = C.parts3d.createCar(carCtx); s.ghostParts = []; s.car.setHighlight(s.highlight);
        if (s.mode === "xray-mass") s.car.setXray((id) => rampColor(Math.sqrt(((s.mass && s.mass.byId[id]) || 0) / ((s.mass && s.mass.max) || 1))));
        s.tween = null; s.design = null;
      }
      if (so.baseline !== undefined) { s.baseline = so.baseline ? JSON.parse(JSON.stringify(so.baseline)) : null; s.baseMass = s.baseline ? massOf(s.baseline) : null; }
      const prev = s.design; s.design = JSON.parse(JSON.stringify(design));
      s.mass = massOf(s.design, so.mass);
      if (!s.car) { s.tween = null; return { ms: null, pending: true }; }
      const animate = so.animate !== false && !s.rm && !!prev;
      if (animate) { s.tween = { from: s.tween ? mixParams(s.tween.from, s.tween.to, 0.5) : prev.params, to: s.design.params, t0: null }; s.dirty = true; return { ms: null, pending: true }; }
      s.tween = null;
      s.lastMs = build(s.design.params, true); emit();
      return { ms: s.lastMs };
    }
    function setHighlight(ids) {
      s.highlight = new Set();
      for (const id of ids || []) for (const a of HIGHLIGHT_ALIAS[id] || [id]) s.highlight.add(a);
      if (s.car) s.car.setHighlight(s.highlight);
      s.dirty = true;
    }
    function setMode(mode) {
      if (mode !== "solid" && mode !== "xray-mass") throw new Error("conceptView.setMode: 'solid' or 'xray-mass'");
      s.mode = mode;
      if (s.car) {
        if (mode === "xray-mass") buildXray(); else { clearGroup(xrRoot); for (const g of s.xrGeos) g.dispose(); s.xrGeos = []; s.tagRows = []; s.car.setXray(null); }
      }
      xrRoot.visible = mode === "xray-mass";
      mirror.visible = !!o.reflection && mode !== "xray-mass";
      ghostRoot.visible = mode !== "xray-mass" && !!(s.ghostParts && s.ghostParts.length);
      hiRoot.visible = mode !== "xray-mass";
      key.castShadow = !!o.shadows && mode !== "xray-mass";
      renderer.shadowMap.needsUpdate = true; s.dirty = true;
    }
    function setAero(a) { if (!["cycle", "corner", "straight"].includes(a)) throw new Error("conceptView.setAero: cycle | corner | straight"); s.aero = a; s.smPhaseT0 = now(); if (a !== "cycle" || s.rm) { s.smT = a === "straight" ? 1 : 0; applyFlaps(); renderer.shadowMap.needsUpdate = true; } s.dirty = true; }
    function screenshot() {
      if (s.tween && s.car) { const tw = s.tween; s.tween = null; s.lastMs = build(tw.to, true); }
      const pr0 = renderer.getPixelRatio(), cw = Math.max(1, cv.clientWidth), pr = Math.min(o.shotScale || 1, 3840 / cw);
      if (pr > pr0) renderer.setPixelRatio(pr);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera); updateOverlay();
      const w = cv.width, h = cv.height, c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
      g.drawImage(cv, 0, 0);
      if (pr > pr0) { renderer.setPixelRatio(pr0); s.dirty = true; }
      const dpr = w / cw, fs = Math.round(11 * dpr);
      g.font = fs + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"; g.textBaseline = "top";
      g.fillStyle = "#8a8a94"; g.textAlign = "right"; g.fillText(labelText(), w - 12 * dpr, 10 * dpr);
      g.textAlign = "left";
      const lines = legendLines().map(l => l.text || (l.html || "").replace(/<div[^]*$/, "").replace(/<[^>]+>/g, "")).filter(Boolean);
      if (s.loading) lines.push("loading the car model and livery…");
      lines.forEach((t, i) => g.fillText(t, 12 * dpr, h - (lines.length - i) * (fs + 4 * dpr) - 8 * dpr));
      return c.toDataURL("image/png");
    }
    function stats() { const i = renderer.info; return Object.assign({ ms: s.lastMs, geometries: i.memory.geometries, textures: i.memory.textures, programs: (i.programs || []).length, triangles: i.render.triangles, ghost: s.ghostParts || [] }, s.car ? s.car.stats() : {}); }
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
      state: () => ({ loading: s.loading, error: s.error ? String(s.error.message || s.error) : null, mode: s.mode, view: s.view, aero: s.aero, straight: s.smT, ghost: (s.ghostParts || []).slice(), highlight: Array.from(s.highlight), ms: s.lastMs, layout: s.L }),
      ready: () => ensureAssets().then(() => new Promise(r => { const k = () => (s.car || s.disposed ? r() : setTimeout(k, 20)); k(); })),
      el: container, canvas: cv,
      _debug: { scene, renderer, camera, s },
    };
  }
  // ---------------------------------------------------------------- buildCar: the concept car as a standalone THREE.Group
  // For another scene (e.g. the game's 3D Silverstone): no viewer, renderer, studio, label or camera. The frame is the game car's
  // (js/carglb.js): metres, x forward, y up, z to the car's right, ground at y = 0, front axle centre at x = +1.75 (fixed), rear axle
  // at x = 1.75 - wheelbase (m) (= -1.65 at the 3400 mm baseline; the game car's own is -1.85), wheel centres at y = tyre radius
  // (group.userData.wheelCentreY, about 0.36). Place it like a game car: group.position on the racing line, group.rotation.y = heading.
  //   const g = EI.conceptView.buildCar(design, { livery?, driver?, baseline?, lod?, straight? })
  //   g.ready -> Promise<g> (immediately resolved when the game already has the GLB and liveries loaded; otherwise this loads them,
  //   like mount() does). g.setDesign(design), g.setAero(t 0 = corner .. 1 = straight mode), g.dispose() (geometry, materials, livery
  //   textures; removes itself from its parent). livery: "redbull-rb22" (default: the design's own, else Red Bull); baseline: a
  //   Design whose differing parts are drawn as a purple ghost (omit for racing); lod: "hi" (2048 px livery, default) or "lo"
  //   (1024 px). The paint is MeshPhysical with clear coat: it reads best with scene.environment set (an env map), as in the view.
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
      let wy = 0; for (const r of car._recs) if (/^wheel_f.*_tyre$/.test(r.name)) { let lo = Infinity, hi = -Infinity; const P = r.base; for (let i = 1; i < P.length; i += 3) { lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); } wy = (lo + hi) / 2; break; }
      group.userData = { units: "m", forward: "+x", up: "+y", right: "+z", ground_y: 0, frontAxleX: GLB.FA, rearAxleX: wx(car._S.L.XR), wheelCentreY: wy, design_id: cur.id || null, team: o.team, driver: o.driver };
    };
    const make = () => { if (disposed) return group; car = C.parts3d.createCar({ THREE, o, carRoot, mirror, ghostRoot, hiRoot }); apply(); return group; };
    const have = !!(EI.CarGLB && EI.CarGLB.ready && EI.CarGLB.cache && EI.CarGLB.cache.hi && C.parts3d && EI.TEAM_BY_ID && EI.LIVERIES);
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

  const api = { mount, buildCar, layout, LABEL, EFFECTS, VIEWS, FIX, GLB, DEFAULTS, RAMP, REGIONS, reducedMotion, labelText: () => LABEL,
    _internal: { paintMaterial, helmetMaterial, coverMaterial, tyreWallTexture, overlayMaterial, rampColor, wx, srgb, ss, sstep, lerp, clamp, rad, RID } };
  EI.conceptView = api; C.view = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
