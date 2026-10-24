// PURPLE - lab 3D car view (F-07, P2.T2; lane CAR3D). The game's procedural car (js/carmodel.js) in its own THREE scene: dark studio,
// ground shadow plane, a slow idle sway around the three-quarter rear hero angle, and setSetup() swapping the wing geometry in
// place through EI.rebuildWings (< 200 ms, F-07.AC1) and moving the body for ride height. A set baseline is ghosted in the
// lab purple (fill + edges) with the candidate's same element outlined in ink, so the angle change reads at a glance.
//
// Contract (kept stable for the UI lane; documented in docs/agents/lanes/CAR3D.md):
//   EI.labCar3D.mount(containerEl, opts?)      -> the view (also returned by EI.labCar3D.view()); opts: see DEFAULTS
//   EI.labCar3D.setSetup(setup, { animate }?)  -> { ms } wing-swap time; animate !== false eases the camera: to a close look at the wing
//                                                that differs from the baseline (rear or front only), a short hold, then back to the hero;
//                                                otherwise straight to the hero (prefers-reduced-motion: no move, the static hero shows it)
//   EI.labCar3D.setBaseline(setup | null)      -> ghost the baseline wing(s) whose value differs from the current setup (purple fill + edges,
//                                                the candidate's element outlined in ink; drawn over the wing assembly and its endplates,
//                                                hidden behind the rest of the car); a legend under the label says what purple / ink mean
//   Display gain: opts.exaggerate (default 3) scales the wing-angle / ride-height deltas in the mesh only; the label in the view says so.
//   EI.labCar3D.hero()                         -> 600 ms ease to the raised three-quarter rear view (instant under prefers-reduced-motion)
//   EI.labCar3D.dispose()                      -> stop rendering, free GL resources, empty the container
// Loads after the game's scripts: needs THREE, EI.U (js/util.js) and EI.CarModel (js/carmodel.js) at mount time. The livery pipeline
// (season data, ads, teams, liveries, carglb) is loaded by this file itself, from the repo root next to lab/, if the page did not
// include it; the car appears when it is ready (container event 'car3d:ready'), setSetup / setBaseline before that are queued.
// No network beyond the repo's own scripts and brand artwork, no Mubit.
window.EI = window.EI || {};
(function () {
  const DEFAULTS = {
    team: 'lumi',                 // livery (EI.TEAM_BY_ID key); the works team's cream / plum sits well against the lab's black
    num: 7, driver: null,         // car number and driver profile for the livery (null: the team code on the car)
    setup: null,                  // initial setup; null = the shipped car (baseline 25 / 20 / 35 mm)
    baseline: null,               // initial baseline for the ghost
    ghost: true,                  // ghost the baseline wings when the setup differs
    orbit: true,                  // slow idle sway around the hero angle (off under prefers-reduced-motion)
    focus: true,                  // on setSetup (animate), a short close look at the one wing that differs from the baseline (off under reduced motion)
    focusHoldMs: 2600,            // how long that close look holds before the camera settles back on the hero
    pixelRatioCap: 2,
    background: 0x0a0a0c,         // DESIGN_SYSTEM --bg
    ghostColor: 0xb26cff,         // DESIGN_SYSTEM --purple
    exaggerate: 3,                // display gain on the setup deltas (wing angles, ride height); stated in the view's label (G-HON-01). 1 = true geometry
    label: true,                  // the honesty label inside the container (top-right)
  };
  // the hero: a raised three-quarter rear view with the rear wing large in frame (DESIGN_SYSTEM §8). Camera on a sphere around a target:
  // azim 0 = straight behind the car, positive = towards the car's right (z), pi = in front; elev above the ground plane.
  // Raised and from further behind than a classic side-on three-quarter (was azim 0.68, elev 0.21) because the rear endplates cover the
  // main plane from the side: from here its angle reads (QA S5: rear wing 20 -> 30 changes 0.65 % of the view's pixels, was 0.1 %).
  // radius is for a frame at least refAspect wide; narrower frames pull back (fitScale) so the whole car stays in view
  const HERO = { target: new THREE.Vector3(-1.1, 0.2, 0), radius: 6.0, elev: 0.38, azim: 0.42, fov: 30, refAspect: 1.5 };
  // close looks at one wing, used briefly on setSetup when only that wing differs from the baseline (then the camera settles on the hero)
  const FOCUS = {
    rear: { target: new THREE.Vector3(-1.9, 0.5, 0), radius: 4.4, elev: 0.3, azim: 0.9 },     // rear-side three-quarter, close: the two main-plane angles side by side through the endplate
    front: { target: new THREE.Vector3(2.3, 0.3, 0), radius: 5.2, elev: 0.42, azim: 2.55 },    // front three-quarter, above the nose
  };
  const SWAY = { amp: 0.22, period: 26 };             // idle sway of azim (rad, s): the rear wing never leaves the frame
  const HERO_MS = 600, HERO_EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // DESIGN_SYSTEM §5 "Wing rebuild" (in-out, so chained moves read as one)
  const WING_KEYS = ['front_wing_deg', 'rear_wing_deg', 'ride_height_mm'];
  // the setup the geometry is built from: baseline + gain x (setup - baseline) on the three geometric fields. The numbers on
  // screen stay the real setup; only the mesh is exaggerated, and the label says by how much.
  function displaySetup(setup, gain) {
    const B = EI.CarModel.SETUP_BASE; if (!setup) return null; if (!(gain > 0) || gain === 1) return setup;
    const out = Object.assign({}, setup); for (const k of WING_KEYS) if (typeof setup[k] === 'number') out[k] = B[k] + gain * (setup[k] - B[k]); return out;
  }
  const labelText = (gain) => (gain > 0 && gain !== 1 ? 'wing angles and ride height exaggerated ×' + gain + ' for visibility · geometry from the setup, not a measurement' : 'wing angles and ride height from the setup · geometry, not a measurement');

  // the repo root, from this script's own URL (lab/car3d.js), so the lab page's location does not matter
  const ROOT = (() => { const cs = document.currentScript; const u = (cs && cs.src) || location.href; return u.replace(/lab\/[^/]*(\?.*)?$/, ''); })();
  const LIVERY_SCRIPTS = ['js/data/season2026.js', 'js/ads.js', 'js/teams.js', 'js/liveries.js', 'js/liveries/mercedes.js', 'js/liveries/ferrari.js', 'js/liveries/mclaren.js', 'js/liveries/redbull.js', 'js/liveries/racingbulls.js', 'js/liveries/alpine.js', 'js/liveries/haas.js', 'js/liveries/audi.js', 'js/liveries/williams.js', 'js/liveries/astonmartin.js', 'js/liveries/cadillac.js', 'js/liveries/lumi.js', 'js/liveries/intake.js', 'js/carglb.js'];
  const liveryLoaded = () => !!(EI.paintLivery && EI.TEAM_BY_ID && EI.TYRES);
  const loadScript = (src) => new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.async = false; el.onload = () => res(); el.onerror = () => rej(new Error('car3d: failed to load ' + src)); document.head.appendChild(el); });
  let liveryP = null;
  function ensureLivery() {
    if (liveryLoaded()) return Promise.resolve();
    if (liveryP) return liveryP;
    liveryP = (async () => {
      for (const f of LIVERY_SCRIPTS) {
        if (f === 'js/data/season2026.js' && EI.SEASON) continue; if (f === 'js/ads.js' && EI.Ads) continue; if (f === 'js/carglb.js' && EI.CarGLB) continue;
        await loadScript(ROOT + f);
        if (f === 'js/ads.js' && EI.Ads) { EI.Ads.BRAND_DIR = ROOT + 'assets/brand/'; EI.Ads.PARTNER_DIR = EI.Ads.BRAND_DIR + 'partners/'; }   // ads.js resolves artwork relative to the page
      }
      if (!liveryLoaded()) throw new Error('car3d: livery pipeline did not initialise');
      // brand artwork and fonts for the livery sheet; never hold the car back more than a moment (the painters fall back to wordmarks)
      if (EI.Ads && EI.Ads.ready) await Promise.race([EI.Ads.ready(), new Promise((r) => setTimeout(r, 3500))]);
    })();
    return liveryP;
  }

  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const now = () => performance.now();
  // three r128 takes material colours as linear; design tokens are sRGB (the background is cleared raw, so it stays as given)
  const srgb = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  let view = null;

  function sphericalPos(out, azim, elev, radius, target) {
    const ce = Math.cos(elev);
    return out.set(target.x - radius * ce * Math.cos(azim), target.y + radius * Math.sin(elev), target.z + radius * ce * Math.sin(azim));
  }
  // null / missing fields mean the shipped baseline (SETUP_BASE), so { } and null and the baseline setup all compare equal
  function sameWings(a, b) {
    const B = EI.CarModel.SETUP_BASE, v = (s, k) => (s && typeof s[k] === 'number' ? s[k] : B[k]);
    return WING_KEYS.every((k) => v(a, k) === v(b, k));
  }
  // soft radial alpha for the floor disc so it fades into the background
  function discAlpha() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128); grd.addColorStop(0, '#fff'); grd.addColorStop(0.55, '#fff'); grd.addColorStop(1, '#000');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
  }
  // studio environment for the paint's reflections: a dark room with three softboxes, baked through PMREM
  function studioEnv(renderer) {
    const room = new THREE.Scene(); room.background = new THREE.Color(0x101014);
    const box = (w, h, x, y, z, ry, rx, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); room.add(m); return m; };
    box(6, 2.2, 0, 4.5, 0, 0, Math.PI / 2, 0xffffff);          // overhead strip
    box(3, 3, 5, 2.5, 4, -Math.PI / 4, 0, 0xdde6ff);            // key side
    box(3, 1.6, -5, 1.8, -4, Math.PI * 0.75, 0, 0xffe6cc);      // warm rim
    box(40, 40, 0, -0.01, 0, 0, -Math.PI / 2, 0x050507);        // floor
    const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
    const env = pm.fromScene(room, 0.04).texture; pm.dispose();
    room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return env;
  }

  function mount(container, opts) {
    if (view) dispose();
    if (!container) throw new Error('labCar3D.mount: container element required');
    if (!window.THREE || !EI.CarModel || !EI.U) throw new Error('labCar3D.mount: load vendor/three.min.js, js/util.js and js/carmodel.js first');
    const o = Object.assign({}, DEFAULTS, opts || {});
    const rm = reducedMotion();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.pixelRatioCap));
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block'; renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('aria-label', 'Car setup: 3D view'); renderer.domElement.setAttribute('role', 'img');
    container.appendChild(renderer.domElement);
    let label = null;
    if (o.label) {
      label = document.createElement('div'); label.className = 'car3d-label'; label.textContent = labelText(o.exaggerate);
      label.style.cssText = 'position:absolute;top:10px;right:12px;max-width:46%;text-align:right;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#8a8a94;pointer-events:none;';
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      container.appendChild(label);
    }
    // legend for the ghost, under the label, only while a ghost shows (colour never alone: it says what the purple is)
    let legend = null;
    if (o.label && o.ghost) {
      legend = document.createElement('div'); legend.className = 'car3d-legend'; legend.hidden = true;
      legend.style.cssText = 'position:absolute;top:44px;right:12px;max-width:46%;text-align:right;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#8a8a94;pointer-events:none;';
      const sw = document.createElement('span'); sw.textContent = 'purple'; sw.style.color = '#' + new THREE.Color(o.ghostColor).getHexString();
      legend.append(sw, ' = the baseline\u2019s wing · dark outline = this setup');
      container.appendChild(legend);
    }

    const scene = new THREE.Scene(); scene.background = new THREE.Color(o.background);
    scene.environment = studioEnv(renderer);
    const camera = new THREE.PerspectiveCamera(HERO.fov, 1, 0.1, 80);

    // lights: cool hemisphere, warm key with the shadow, a cool rim from behind to edge the rear wing
    scene.add(new THREE.HemisphereLight(0x3a3f52, 0x08080a, 0.55));
    const key = new THREE.DirectionalLight(0xfff1e2, 2.0); key.position.set(4.5, 7, 4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.01;
    const sc = key.shadow.camera; sc.near = 1; sc.far = 24; sc.left = sc.bottom = -4.5; sc.right = sc.top = 4.5; scene.add(key); scene.add(key.target);
    const rim = new THREE.DirectionalLight(0xbfd0ff, 1.3); rim.position.set(-6, 3.2, -5); scene.add(rim);
    const fill = new THREE.DirectionalLight(0x8e96b8, 0.35); fill.position.set(-3, 2, 6); scene.add(fill);

    // ground: a faint unlit pool of light (DESIGN --panel fading to --bg) with a shadow-only plane over it, so the studio stays black
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshBasicMaterial({ color: srgb(0x121216), transparent: true, alphaMap: discAlpha(), depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.62 }));
    shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = 0.001; shadowPlane.receiveShadow = true; scene.add(shadowPlane);
    // the car and lights never move (only the camera does): render the shadow map once per setup change, not per frame
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;

    // baseline ghost: a translucent fill + edge lines of the baseline wing(s), plus an ink outline of the candidate's same element(s), in its
    // own scene so it can be drawn in a second pass (render):
    // depth-tested against the car WITHOUT its wing assembly (wing mesh + DRS flap), so it shows over the candidate's wing and through the
    // rear endplates that hide the main plane, but never through the nose, sidepods or engine cover (QA S5)
    const ghostScene = new THREE.Scene();
    const ghostGroup = new THREE.Group(); ghostGroup.visible = false; ghostScene.add(ghostGroup);
    const ghostMat = new THREE.LineBasicMaterial({ color: srgb(o.ghostColor), transparent: true, opacity: 0.95, depthWrite: false });
    const ghostFillMat = new THREE.MeshBasicMaterial({ color: srgb(o.ghostColor), transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    const candMat = new THREE.LineBasicMaterial({ color: srgb(0x0a0a0c), transparent: true, opacity: 0.95, depthWrite: false });   // DESIGN --bg ink: the candidate's outline reads on the white endplates and bodywork
    const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });   // the occluder pass writes depth only

    const state = {
      container, renderer, scene, camera, model: null, floor, shadowPlane, ghostScene, ghostGroup, ghostMat, ghostFillMat, candMat, depthMat, label, legend, opts: o, rm,
      setup: o.setup || null, baseline: o.baseline || null, ghostGeo: [],
      azim: HERO.azim, elev: HERO.elev, radius: HERO.radius, target: HERO.target.clone(), t0: now(), raf: 0, moves: null, focus: null, disposed: false, lastMs: null,
    };
    view = state;
    resize();
    // the car: the game's model, same materials and livery pipeline as the menu / race; built once the livery scripts are in
    ensureLivery().then(() => { if (view === state && !state.disposed) buildCar(state); }).catch((e) => { console.error(e); state.error = e; });

    // resize: observe the container; window resize as the fallback
    if (window.ResizeObserver) { state.ro = new ResizeObserver(() => resize()); state.ro.observe(container); }
    else { state.onResize = () => resize(); window.addEventListener('resize', state.onResize); }
    state.onVis = () => { if (!document.hidden) state.dirty = true; }; document.addEventListener('visibilitychange', state.onVis);
    state.dirty = true;
    state.raf = requestAnimationFrame(frame);
    return api;
  }

  // a narrower frame needs more distance (the car's length is the horizontal extent): radius scale for the current aspect
  const fitScale = (s) => Math.max(1, HERO.refAspect / s.camera.aspect);
  const fitRadius = (s) => HERO.radius * fitScale(s);
  function buildCar(s) {
    const o = s.opts; const team = EI.TEAM_BY_ID[o.team] || EI.TEAM_BY_ID.lumi || EI.TEAMS[0];
    const carLike = { team, num: o.num, name: null, isPlayer: false, driver: o.driver || undefined, tyre: EI.TYRES.medium };
    const model = EI.CarModel.build(carLike, displaySetup(s.setup, o.exaggerate) || undefined);
    model.group.traverse((obj) => { if (obj.isMesh) obj.receiveShadow = false; });
    s.scene.add(model.group); s.model = model; s.renderer.shadowMap.needsUpdate = true; s.dirty = true;
    if (s.baseline) setBaseline(s.baseline);
    try { s.container.dispatchEvent(new CustomEvent('car3d:ready', { detail: { setup: s.setup } })); } catch (e) { /* fine */ }
  }
  function resize() {
    const s = view; if (!s) return;
    const w = Math.max(1, s.container.clientWidth | 0), h = Math.max(1, s.container.clientHeight | 0);
    s.renderer.setSize(w, h, false); s.camera.aspect = w / h; s.camera.updateProjectionMatrix(); s.dirty = true;
    if (!s.moves) { s.radius = fitRadius(s); placeCamera(s.azim, s.elev, s.radius, s.target); }   // at rest the camera is on the hero
  }
  function placeCamera(azim, elev, radius, target) {
    const s = view; sphericalPos(s.camera.position, azim, elev, radius, target); s.camera.lookAt(target); s.dirty = true;
  }

  // camera moves: a queue of { to: () => pose | null (a hold), ms }; each starts from wherever the camera is when it begins
  const heroPose = () => HERO;
  function runMoves(s, list) { s.moves = list.map((m) => Object.assign({ t0: null, from: null }, m)); s.dirty = true; }

  function frame(t) {
    const s = view; if (!s || s.disposed) return;
    s.raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const sec = (t - s.t0) / 1000;
    let moving = false;
    if (s.moves) {
      const m = s.moves[0];
      if (m.t0 == null) { m.t0 = t; m.from = { azim: s.azim, elev: s.elev, radius: s.radius, target: s.target.clone() }; }
      const k = m.ms > 0 ? Math.min(1, Math.max(0, (t - m.t0) / m.ms)) : 1;
      if (m.to) {
        const P = m.to(), e = HERO_EASE(k), f = m.from, r1 = P.radius * fitScale(s);
        s.azim = f.azim + (P.azim - f.azim) * e; s.elev = f.elev + (P.elev - f.elev) * e; s.radius = f.radius + (r1 - f.radius) * e;
        s.target.lerpVectors(f.target, P.target, e); moving = true;
      }
      if (k >= 1) { s.moves.shift(); if (!s.moves.length) { s.moves = null; s.focus = null; s.swayT0 = sec; } }
    } else if (s.opts.orbit && !s.rm) {   // idle sway: a slow drift about the hero azimuth, phase-continuous after a move
      const ph = (sec - (s.swayT0 || 0)) * 2 * Math.PI / SWAY.period;
      s.azim = HERO.azim + SWAY.amp * Math.sin(ph); moving = true;
    }
    if (moving) placeCamera(s.azim, s.elev, s.radius, s.target);
    if (!s.dirty) return;
    s.dirty = moving;   // static view: render once, then only on change
    render(s);
  }
  // the car, then (while a ghost shows) the occluder pass and the ghost: depth of everything but the wing assembly, so the ghost reads
  // over the candidate's wing and through the rear endplates, and stays hidden behind the body
  function render(s) {
    const r = s.renderer, sc = s.scene;
    r.render(sc, s.camera);
    if (!s.ghostGroup.visible || !s.model) return;
    const hide = [s.model.wingMesh, s.model.flap, s.floor, s.shadowPlane].filter(Boolean), was = hide.map((o) => o.visible), bg = sc.background;
    hide.forEach((o) => { o.visible = false; });
    sc.background = null; sc.overrideMaterial = s.depthMat; r.autoClear = false;
    try { r.clearDepth(); r.render(sc, s.camera); sc.overrideMaterial = null; r.render(s.ghostScene, s.camera); }
    finally { sc.overrideMaterial = null; sc.background = bg; r.autoClear = true; hide.forEach((o, i) => { o.visible = was[i]; }); }
  }

  function hero() {
    const s = view; if (!s) return;
    if (s.rm) { s.moves = null; s.focus = null; s.azim = HERO.azim; s.elev = HERO.elev; s.radius = fitRadius(s); s.target.copy(HERO.target); placeCamera(s.azim, s.elev, s.radius, s.target); return; }
    s.focus = null; runMoves(s, [{ to: heroPose, ms: HERO_MS }]);
  }
  // after a setSetup: a close look at the one wing that differs from the baseline (rear only / front only), a hold, then the hero.
  // Ride height (moves both) or both wings, no baseline, reduced motion or opts.focus false: straight to the hero.
  function frameFor(s) {
    const B = EI.CarModel.SETUP_BASE, v = (x, k) => (x && typeof x[k] === 'number' ? x[k] : B[k]);
    const sel = s.baseline ? diffWings(s.setup, s.baseline) : null, rh = !!sel && v(s.setup, 'ride_height_mm') !== v(s.baseline, 'ride_height_mm');
    const which = !sel || rh ? null : sel.rear && !sel.front ? 'rear' : sel.front && !sel.rear ? 'front' : null;
    if (!which || s.rm || !s.opts.focus) return hero();
    const P = FOCUS[which]; s.focus = which;
    runMoves(s, [{ to: () => P, ms: HERO_MS }, { to: null, ms: Math.max(0, s.opts.focusHoldMs | 0) }, { to: heroPose, ms: HERO_MS }]);
  }

  // swap wings + ride height for a setup. Returns { ms } measured around EI.rebuildWings (F-07.AC1 logs this)
  function setSetup(setup, o) {
    const s = view; if (!s) throw new Error('labCar3D.setSetup: mount first');
    const t0 = now(), animate = !(o && o.animate === false);
    if (!s.model) { s.setup = setup || null; if (animate) frameFor(s); return { ms: 0, total: now() - t0, pending: true }; }   // applied by buildCar
    const ms = EI.rebuildWings(s.model, displaySetup(setup, s.opts.exaggerate) || null);
    s.renderer.shadowMap.needsUpdate = true;
    s.setup = setup || null; s.lastMs = ms;
    updateGhost();
    if (animate) frameFor(s);
    s.dirty = true;
    const total = now() - t0;
    try { s.container.dispatchEvent(new CustomEvent('car3d:setup', { detail: { ms, total, setup: s.setup } })); } catch (e) { /* no CustomEvent: fine */ }
    return { ms, total };
  }

  function setBaseline(setup) {
    const s = view; if (!s) throw new Error('labCar3D.setBaseline: mount first');
    s.baseline = setup || null;
    updateGhost();
  }
  // which wings differ from the baseline (ride height moves both, so it ghosts both)
  function diffWings(a, b) {
    const B = EI.CarModel.SETUP_BASE, v = (x, k) => (x && typeof x[k] === 'number' ? x[k] : B[k]);
    const rh = v(a, 'ride_height_mm') !== v(b, 'ride_height_mm');
    return { front: rh || v(a, 'front_wing_deg') !== v(b, 'front_wing_deg'), rear: rh || v(a, 'rear_wing_deg') !== v(b, 'rear_wing_deg') };
  }
  // rebuild the ghost for the current setup / baseline pair: only the wing(s) whose value differs, at the displayed baseline angles
  function updateGhost() {
    const s = view; if (!s) return;
    for (const g of s.ghostGeo) g.dispose(); s.ghostGeo = [];
    while (s.ghostGroup.children.length) s.ghostGroup.remove(s.ghostGroup.children[0]);
    const sel = s.baseline ? diffWings(s.setup, s.baseline) : null;
    const show = !!(s.baseline && s.opts.ghost && s.model && sel && (sel.front || sel.rear));
    if (show) {
      // the baseline's wing(s): purple fill + edges; the candidate's same element(s): light edges, so the two angles compare even where
      // the endplates hide the solid wing. Each sits at its own (displayed) ride height.
      const K = EI.CarModel.SETUP_K, B = EI.CarModel.SETUP_BASE;
      const part = (setup, withFill, lineMat) => {
        const disp = displaySetup(setup, s.opts.exaggerate) || {}, g = new THREE.Group(), rh = disp.ride_height_mm;
        const wingGeo = EI.CarModel.wingGeometry(disp, sel), edges = new THREE.EdgesGeometry(wingGeo, 18);
        s.ghostGeo.push(wingGeo, edges);
        if (withFill) { const fill = new THREE.Mesh(wingGeo, s.ghostFillMat); fill.renderOrder = 1; g.add(fill); }
        const lines = new THREE.LineSegments(edges, lineMat); lines.renderOrder = 2; g.add(lines);
        g.position.y = s.model.bodyY0 + (typeof rh === 'number' ? K.rideM_PerMm * (rh - B.ride_height_mm) : 0);
        s.ghostGroup.add(g);
      };
      part(s.baseline, true, s.ghostMat);
      part(s.setup, false, s.candMat);
    }
    s.ghostGroup.visible = show; s.dirty = true;
    if (s.legend) { s.legend.hidden = !show; if (show && s.label) s.legend.style.top = (s.label.offsetTop + s.label.offsetHeight + 4) + 'px'; }
  }

  function dispose() {
    const s = view; if (!s) return;
    s.disposed = true; cancelAnimationFrame(s.raf);
    if (s.ro) s.ro.disconnect(); if (s.onResize) window.removeEventListener('resize', s.onResize); document.removeEventListener('visibilitychange', s.onVis);
    for (const g of s.ghostGeo) g.dispose(); s.ghostGeo = [];
    s.scene.traverse((obj) => { if (obj.geometry) obj.geometry.dispose(); const m = obj.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { for (const k in x) if (x[k] && x[k].isTexture) x[k].dispose(); x.dispose(); }); });
    s.depthMat.dispose(); s.ghostMat.dispose(); s.ghostFillMat.dispose(); s.candMat.dispose();
    if (s.scene.environment) s.scene.environment.dispose();
    s.renderer.dispose(); if (s.renderer.domElement.parentNode === s.container) s.container.removeChild(s.renderer.domElement);
    for (const el of [s.label, s.legend]) if (el && el.parentNode) el.parentNode.removeChild(el);
    view = null;
  }

  const api = {
    mount, setSetup, setBaseline, hero, dispose,
    view: () => view, HERO, FOCUS, SWAY, DEFAULTS, ROOT,
    ready: () => !!(view && view.model),
    // test hooks: the current rear main plane angle of attack (rad) and the last measured swap time
    rearAoa: () => { const s = view; const d = s && s.setup && typeof s.setup.rear_wing_deg === 'number' ? EI.CarModel.SETUP_K.rearAoaPerDeg * (s.setup.rear_wing_deg - EI.CarModel.SETUP_BASE.rear_wing_deg) * (s.opts.exaggerate > 0 ? s.opts.exaggerate : 1) : 0; return 0.16 + d; },   // as displayed (with the gain)
    displaySetup: (setup) => displaySetup(setup, view ? view.opts.exaggerate : DEFAULTS.exaggerate), labelText: () => labelText(view ? view.opts.exaggerate : DEFAULTS.exaggerate),
    lastMs: () => (view ? view.lastMs : null),
    focus: () => (view ? view.focus : null),   // 'rear' | 'front' while the camera moves to, holds on or leaves a close look at that wing; else null
    reducedMotion,
  };
  EI.labCar3D = api;
})();
