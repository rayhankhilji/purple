// PURPLE - lab 3D car view (F-07, P2.T2; lane CAR3D). The game's procedural car (js/carmodel.js) in its own THREE scene: dark studio,
// ground shadow plane, a slow idle sway around the three-quarter rear hero angle, and setSetup() swapping the wing geometry in
// place through EI.rebuildWings (< 200 ms, F-07.AC1) and moving the body for ride height. A set baseline is ghosted as thin
// edge lines in the lab purple so the change is readable at a glance.
//
// Contract (kept stable for the UI lane; documented in docs/agents/lanes/CAR3D.md):
//   EI.labCar3D.mount(containerEl, opts?)      -> the view (also returned by EI.labCar3D.view()); opts: see DEFAULTS
//   EI.labCar3D.setSetup(setup, { animate }?)  -> { ms } wing-swap time; animate !== false eases the camera to the hero angle
//   EI.labCar3D.setBaseline(setup | null)      -> ghost the baseline wings when the current setup differs from it
//   EI.labCar3D.hero()                         -> 600 ms ease to the three-quarter rear view (instant under prefers-reduced-motion)
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
    pixelRatioCap: 2,
    background: 0x0a0a0c,         // DESIGN_SYSTEM --bg
    ghostColor: 0xb26cff,         // DESIGN_SYSTEM --purple
  };
  // the hero: a three-quarter rear view with the rear wing in frame (DESIGN_SYSTEM §8). Camera on a sphere around TARGET:
  // azim 0 = straight behind the car, positive = towards the car's right (z); elev above the ground plane
  const HERO = { target: new THREE.Vector3(-0.45, -0.05, 0), radius: 7.4, elev: 0.21, azim: 0.68, fov: 30, refAspect: 1.5 };   // target below the car centre: the car sits in the upper two thirds, clear of the lab page's bottom overlays   // radius is for a frame at least refAspect wide; narrower frames pull back (fitRadius) so the whole car stays in view
  const SWAY = { amp: 0.22, period: 26 };             // idle sway of azim (rad, s): the rear wing never leaves the frame
  const HERO_MS = 600, HERO_EASE = (t) => 1 - Math.pow(1 - t, 3);   // DESIGN_SYSTEM §5 "Wing rebuild"
  const WING_KEYS = ['front_wing_deg', 'rear_wing_deg', 'ride_height_mm'];

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

  function sphericalPos(out, azim, elev, radius) {
    const ce = Math.cos(elev);
    return out.set(HERO.target.x - radius * ce * Math.cos(azim), HERO.target.y + radius * Math.sin(elev), HERO.target.z + radius * ce * Math.sin(azim));
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

    // baseline ghost: edge lines of the baseline wings, in a sibling group so its own ride height holds
    const ghostGroup = new THREE.Group(); ghostGroup.visible = false; scene.add(ghostGroup);
    const ghostMat = new THREE.LineBasicMaterial({ color: srgb(o.ghostColor), transparent: true, opacity: 0.6, depthTest: false });

    const state = {
      container, renderer, scene, camera, model: null, floor, ghostGroup, ghostMat, opts: o, rm,
      setup: o.setup || null, baseline: o.baseline || null, ghostGeo: null,
      azim: HERO.azim, elev: HERO.elev, radius: HERO.radius, t0: now(), raf: 0, hero: null, disposed: false, lastMs: null,
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

  // the hero distance for the current frame: the car's length is the horizontal extent, so a narrower frame needs more distance
  const fitRadius = (s) => HERO.radius * Math.max(1, HERO.refAspect / s.camera.aspect);
  function buildCar(s) {
    const o = s.opts; const team = EI.TEAM_BY_ID[o.team] || EI.TEAM_BY_ID.lumi || EI.TEAMS[0];
    const carLike = { team, num: o.num, name: null, isPlayer: false, driver: o.driver || undefined, tyre: EI.TYRES.medium };
    const model = EI.CarModel.build(carLike, s.setup || undefined);
    model.group.traverse((obj) => { if (obj.isMesh) obj.receiveShadow = false; });
    s.scene.add(model.group); s.model = model; s.renderer.shadowMap.needsUpdate = true; s.dirty = true;
    if (s.baseline) setBaseline(s.baseline);
    try { s.container.dispatchEvent(new CustomEvent('car3d:ready', { detail: { setup: s.setup } })); } catch (e) { /* fine */ }
  }
  function resize() {
    const s = view; if (!s) return;
    const w = Math.max(1, s.container.clientWidth | 0), h = Math.max(1, s.container.clientHeight | 0);
    s.renderer.setSize(w, h, false); s.camera.aspect = w / h; s.camera.updateProjectionMatrix(); s.dirty = true;
    if (!s.hero) { s.radius = fitRadius(s); placeCamera(s.azim, s.elev, s.radius); }
  }
  function placeCamera(azim, elev, radius) {
    const s = view; sphericalPos(s.camera.position, azim, elev, radius); s.camera.lookAt(HERO.target); s.dirty = true;
  }

  function frame(t) {
    const s = view; if (!s || s.disposed) return;
    s.raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const sec = (t - s.t0) / 1000;
    let azim = s.azim, elev = s.elev, radius = s.radius, moving = false;
    if (s.hero) {   // 600 ms ease from where the camera was to the hero angle
      const k = Math.min(1, (t - s.hero.t0) / HERO_MS), e = HERO_EASE(k), rFit = fitRadius(s);
      azim = s.hero.from.azim + (HERO.azim - s.hero.from.azim) * e; elev = s.hero.from.elev + (HERO.elev - s.hero.from.elev) * e; radius = s.hero.from.radius + (rFit - s.hero.from.radius) * e;
      s.azim = azim; s.elev = elev; s.radius = radius; moving = true;
      if (k >= 1) { s.hero = null; s.swayT0 = sec; }
    } else if (s.opts.orbit && !s.rm) {   // idle sway: a slow drift about the hero azimuth, phase-continuous after a hero() ease
      const ph = (sec - (s.swayT0 || 0)) * 2 * Math.PI / SWAY.period;
      azim = HERO.azim + SWAY.amp * Math.sin(ph); s.azim = azim; moving = true;
    }
    if (moving) placeCamera(azim, elev, radius);
    if (!s.dirty) return;
    s.dirty = moving;   // static view: render once, then only on change
    s.renderer.render(s.scene, s.camera);
  }

  function hero() {
    const s = view; if (!s) return;
    if (s.rm) { s.hero = null; s.azim = HERO.azim; s.elev = HERO.elev; s.radius = fitRadius(s); placeCamera(s.azim, s.elev, s.radius); return; }
    s.hero = { t0: now(), from: { azim: s.azim, elev: s.elev, radius: s.radius } };
  }

  // swap wings + ride height for a setup. Returns { ms } measured around EI.rebuildWings (F-07.AC1 logs this)
  function setSetup(setup, o) {
    const s = view; if (!s) throw new Error('labCar3D.setSetup: mount first');
    const t0 = now();
    if (!s.model) { s.setup = setup || null; if (!(o && o.animate === false)) hero(); return { ms: 0, total: now() - t0, pending: true }; }   // applied by buildCar
    const ms = EI.rebuildWings(s.model, setup || null);
    s.renderer.shadowMap.needsUpdate = true;
    s.setup = setup || null; s.lastMs = ms;
    updateGhost();
    if (!(o && o.animate === false)) hero();
    s.dirty = true;
    const total = now() - t0;
    try { s.container.dispatchEvent(new CustomEvent('car3d:setup', { detail: { ms, total, setup: s.setup } })); } catch (e) { /* no CustomEvent: fine */ }
    return { ms, total };
  }

  function setBaseline(setup) {
    const s = view; if (!s) throw new Error('labCar3D.setBaseline: mount first');
    s.baseline = setup || null;
    if (s.ghostGeo) { s.ghostGeo.dispose(); s.ghostGeo = null; }
    while (s.ghostGroup.children.length) s.ghostGroup.remove(s.ghostGroup.children[0]);
    if (s.baseline && s.opts.ghost && s.model) {
      const wingGeo = EI.CarModel.wingGeometry(s.baseline, true);   // only the elements the setup moves
      s.ghostGeo = new THREE.EdgesGeometry(wingGeo, 18); wingGeo.dispose();
      const lines = new THREE.LineSegments(s.ghostGeo, s.ghostMat); lines.renderOrder = 10; s.ghostGroup.add(lines);
      const K = EI.CarModel.SETUP_K, B = EI.CarModel.SETUP_BASE; const rh = s.baseline.ride_height_mm;
      s.ghostGroup.position.y = s.model.bodyY0 + (typeof rh === 'number' ? K.rideM_PerMm * (rh - B.ride_height_mm) : 0);
    }
    updateGhost();
  }
  function updateGhost() {
    const s = view; if (!s) return;
    s.ghostGroup.visible = !!(s.baseline && s.opts.ghost && s.ghostGeo && !sameWings(s.setup, s.baseline));
    s.dirty = true;
  }

  function dispose() {
    const s = view; if (!s) return;
    s.disposed = true; cancelAnimationFrame(s.raf);
    if (s.ro) s.ro.disconnect(); if (s.onResize) window.removeEventListener('resize', s.onResize); document.removeEventListener('visibilitychange', s.onVis);
    s.scene.traverse((obj) => { if (obj.geometry) obj.geometry.dispose(); const m = obj.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { for (const k in x) if (x[k] && x[k].isTexture) x[k].dispose(); x.dispose(); }); });
    if (s.scene.environment) s.scene.environment.dispose();
    s.renderer.dispose(); if (s.renderer.domElement.parentNode === s.container) s.container.removeChild(s.renderer.domElement);
    view = null;
  }

  const api = {
    mount, setSetup, setBaseline, hero, dispose,
    view: () => view, HERO, SWAY, DEFAULTS, ROOT,
    ready: () => !!(view && view.model),
    // test hooks: the current rear main plane angle of attack (rad) and the last measured swap time
    rearAoa: () => { const s = view; const d = s && s.setup && typeof s.setup.rear_wing_deg === 'number' ? EI.CarModel.SETUP_K.rearAoaPerDeg * (s.setup.rear_wing_deg - EI.CarModel.SETUP_BASE.rear_wing_deg) : 0; return 0.16 + d; },
    lastMs: () => (view ? view.lastMs : null),
    reducedMotion,
  };
  EI.labCar3D = api;
})();
