// Equation I - PURPLE concept race: the physics replay (docs/concept/RACE.md). Opt-in: ?concept=1 (and never with ?lab=1).
// Without the flag this file only defines EI.ConceptRace (pure helpers, active = false) and the game runs exactly as shipped.
//
// What it does with the flag: the concept race page (concept/race/) runs the physics lap sim (concept/sim/) in the parent window
// and posts the result here: { type: 'purple:concept-race', payload } with each car's distance -> time / speed / gear / aero-mode /
// ERS trace and the sim's racing line (x, z in the OSM frame of js/data/silverstone.js, the game's own frame). This module then
// drives the game's cars KINEMATICALLY along that trace on the game's real 3D Silverstone: the car is where the physics sim says
// it is at that time. The game's AI, car physics and lap model are not used (race.update is replaced on this race instance only).
// Times on screen are physics-sim seconds; the replay clock advances in sim seconds (x the playback rate).
// Mapping: every racing-line sample is projected onto the game's centreline (game s, lateral offset); the lateral offset is
// clamped to the asphalt (half width - 1.1 m) where the telemetry line leaves the game's 15 m track. mapLine() returns the error.
// Messages (same origin only, ARCHITECTURE §10): out 'purple:concept-ready' (scene built), 'purple:concept-state' (2 Hz),
// 'purple:concept-finish' (every car past the line); in 'purple:concept-race' (payload), 'purple:concept-cmd' (restart, rate,
// cam, pause). Dual: window.EI.ConceptRace and module.exports (the helpers are tested in Node: test/concept-race.test.js).
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const EI = (root.EI = root.EI || {});
  const mod = (a, n) => ((a % n) + n) % n;
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // ------------------------------------------------------------------ pure helpers (Node-testable)
  // a car's lap as a distance-time table: spec = { s[], t[], v[] (km/h), gear[]?, rpm[]?, aero[]?, ers[]? }; the last sample must be
  // (L, lap time). Laps repeat: clock t -> lap k = floor(t / lap), distance = sAt(t - k lap) + k L (t < 0 is the end of the lap before).
  function timeline(spec) {
    const s = Float64Array.from(spec.s), t = Float64Array.from(spec.t), v = Float64Array.from(spec.v), n = s.length;
    if (n < 2 || !(t[n - 1] > 0)) throw new Error('concept race: a trace needs >= 2 samples and a positive lap time');
    for (let i = 1; i < n; i++) if (!(s[i] > s[i - 1]) || !(t[i] > t[i - 1])) throw new Error('concept race: trace not increasing at sample ' + i);
    const L = s[n - 1], lap = t[n - 1];
    const find = (arr, x) => { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m; else hi = m; } return lo; };
    const tl = {
      n, L, lap, s, t, v, spec,
      // within one lap (0 <= tt <= lap): distance and the sample bracket
      sAtLap(tt) { const i = find(t, tt), u = (tt - t[i]) / (t[i + 1] - t[i]); return s[i] + u * (s[i + 1] - s[i]); },
      tAtS(ss) { ss = Math.min(L, Math.max(0, ss)); const i = find(s, ss), u = (ss - s[i]) / (s[i + 1] - s[i]); return t[i] + u * (t[i + 1] - t[i]); },
      // clock (any real) -> total distance from the line at t = 0
      dist(tt) { const k = Math.floor(tt / lap); return tl.sAtLap(tt - k * lap) + k * L; },
      // channels at a distance in the lap (v interpolated; discrete channels from the sample at or before)
      at(ss) {
        ss = mod(ss, L); const i = find(s, ss), u = (ss - s[i]) / (s[i + 1] - s[i]), ch = spec;
        const vk = v[i] + u * (v[i + 1] - v[i]), dvds = (v[i + 1] - v[i]) / 3.6 / (s[i + 1] - s[i]);
        return { v_kmh: vk, a_ms2: (vk / 3.6) * dvds, gear: ch.gear ? ch.gear[i] : null, rpm: ch.rpm ? ch.rpm[i] + u * (ch.rpm[i + 1] - ch.rpm[i]) : null, aero: ch.aero ? ch.aero[i] : null, ers: ch.ers ? ch.ers[i] : null };
      },
    };
    return tl;
  }

  // the sim's racing line (x, z per line sample, spacing ds, closed, length L) onto a game Track (js/track.js): game s, lateral offset,
  // the displayed position (offset clamped to the asphalt), heading and the mapping error.
  //   line = { x[], z[], ds, L };  opts.margin_m = how far inside the painted edge the car centre stays (1.1 m)
  function mapLine(track, line, opts) {
    const n = line.x.length, Lg = track.length, margin = (opts && opts.margin_m != null) ? opts.margin_m : 1.1, lim = track.halfWidth - margin;
    const sg = new Float64Array(n), lat = new Float64Array(n), latC = new Float64Array(n), px = new Float64Array(n), pz = new Float64Array(n), py = new Float64Array(n), head = new Float64Array(n), gi = new Int32Array(n);
    const pr = {}; let hint = null;
    for (let k = 0; k < n; k++) {
      track.project(line.x[k], line.z[k], hint, pr); hint = pr.i;
      if (k === 0) sg[0] = pr.s; else { let d = pr.s - mod(sg[k - 1], Lg); if (d < -Lg / 2) d += Lg; if (d > Lg / 2) d -= Lg; sg[k] = sg[k - 1] + d; }
      lat[k] = pr.lat; latC[k] = Math.max(-lim, Math.min(lim, pr.lat));
    }
    const samp = (arr, s) => { const f = mod(s, Lg) / track.ds, i = Math.floor(f) % track.n, j = (i + 1) % track.n, u = f - Math.floor(f); return arr[i] + u * (arr[j] - arr[i]); };
    for (let k = 0; k < n; k++) {
      let nx = samp(track.nx, sg[k]), nz = samp(track.nz, sg[k]); const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      px[k] = samp(track.x, sg[k]) + nx * latC[k]; pz[k] = samp(track.z, sg[k]) + nz * latC[k];
      py[k] = track.elevAt ? track.elevAt(mod(sg[k], Lg)) : samp(track.y, sg[k]); gi[k] = track.idxAtS(mod(sg[k], Lg));
    }
    for (let k = 0; k < n; k++) { const a = (k - 1 + n) % n, b = (k + 1) % n; head[k] = Math.atan2(pz[b] - pz[a], px[b] - px[a]); }
    // errors: displayed position vs the sim's line point; how much clamping moved it; the distance frame vs a linear scale
    const span = sg[n - 1] - sg[0] + (line.L - (n - 1) * line.ds) * (Lg / line.L);   // game metres covered in one line lap
    let sd = 0, md = 0, sl = 0, ml = 0, sc = 0, mc = 0, nc = 0, sa = 0, ma = 0;
    for (let k = 0; k < n; k++) {
      const d = Math.hypot(px[k] - line.x[k], pz[k] - line.z[k]); sd += d * d; if (d > md) md = d;
      const l = Math.abs(lat[k]); sl += l * l; if (l > ml) ml = l;
      const c = Math.abs(lat[k] - latC[k]); sc += c * c; if (c > mc) mc = c; if (c > 1e-9) nc++;
      const a = sg[k] - (sg[0] + k * line.ds * (span / line.L)); sa += a * a; if (Math.abs(a) > ma) ma = Math.abs(a);
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    const stats = {
      position_rms_m: r2(Math.sqrt(sd / n)), position_max_m: r2(md),
      lateral_offset_rms_m: r2(Math.sqrt(sl / n)), lateral_offset_max_m: r2(ml),
      clamp_rms_m: r2(Math.sqrt(sc / n)), clamp_max_m: r2(mc), clamped_share: r2((100 * nc) / n) / 100, clamp_limit_m: r2(lim),
      distance_nonlinearity_rms_m: r2(Math.sqrt(sa / n)), distance_nonlinearity_max_m: r2(ma),
      sim_line_length_m: r2(line.L), game_centreline_length_m: r2(Lg), game_span_m: r2(span), scale: Math.round((span / line.L) * 1e5) / 1e5,
      control_line_game_s: r2(mod(sg[0], Lg)), game_start_line_s: track.sf, control_to_start_line_m: r2(mod(track.sf - sg[0], Lg)),
    };
    const pose = (s) => {   // s: metres along the sim's line (any real)
      const f = mod(s, line.L) / line.ds, i = Math.floor(f) % n, j = (i + 1) % n, u = f - Math.floor(f);
      return { x: px[i] + u * (px[j] - px[i]), z: pz[i] + u * (pz[j] - pz[i]), y: py[i] + u * (py[j] - py[i]), heading: head[i] + wrapA(head[j] - head[i]) * u, gs: mod(sg[i] + u * (sg[j] - sg[i]), Lg), gi: gi[u < 0.5 ? i : j] };
    };
    return { n, sg, lat, latC, px, pz, py, head, stats, pose };
  }

  // the finish of a lap measured on the replay clock: the step during which the car's distance passes L (linear in the step)
  function crossing(sPrev, sNow, tPrev, tNow, target) {
    if (!(sPrev < target && sNow >= target)) return null;
    return tPrev + ((target - sPrev) / (sNow - sPrev || 1)) * (tNow - tPrev);
  }
  const fmt = (x, dp) => (x == null || !isFinite(x) ? '—' : x.toFixed(dp == null ? 3 : dp));
  const sgn = (x, dp) => (x == null || !isFinite(x) ? '—' : (x < 0 ? '−' : '+') + Math.abs(x).toFixed(dp == null ? 3 : dp));

  const api = { timeline, mapLine, crossing, fmt, sgn, active: false };
  EI.ConceptRace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // ------------------------------------------------------------------ the browser runtime (only with ?concept=1)
  const q = typeof location !== 'undefined' && typeof document !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('concept') !== '1' || q.get('lab') === '1') return;
  api.active = true;
  // the concept car's own geometry (EI.conceptView.buildCar, docs/concept/VIEW.md): the design layer and the viewer, loaded only here
  const VIEW_SCRIPTS = ['concept/regs.js', 'concept/materials.js', 'concept/parts.js', 'concept/aeromap.js', 'concept/design.js', 'concept/view/mesh3d.js', 'concept/view/car3d.js', 'concept/view/parts3d.js', 'concept/view/view3d.js'];   // concept/view/index.html order + the three geometry files view3d would fetch
  api.viewReady = VIEW_SCRIPTS.reduce((p, src) => p.then(() => new Promise((res) => {
    const e = document.createElement('script'); e.src = src; e.async = false; e.onload = () => res(true); e.onerror = () => { console.warn('concept race: ' + src + ' did not load: game car model instead'); res(false); }; document.head.appendChild(e);
  })), Promise.resolve(true));

  const RUNUP = 2.0;          // s of the end of the previous (identical) lap before the clock reaches 0 at the control line
  const CAM = { chase: 0, cockpit: 1, tcam: 2, tv: 3 };   // js/main.js CAM_MODES
  const DIRECTOR = [['tv', 6], ['chase', 9], ['tcam', 5], ['tv', 7], ['chase', 10], ['tv', 6], ['tcam', 5]];   // broadcast cut list (s)
  const st = { P: null, D: null, race: null, map: null, cars: [], t: -RUNUP, rate: 1, paused: false, cam: 'tv', auto: true, dirI: 0, dirT: 0, finished: false, hud: null, lastPost: 0, sector: [] };
  api.state = st;
  const post = (msg) => { try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, location.origin); } catch (e) { /* no parent */ } };
  const rateQ = parseFloat(q.get('rate')); if (rateQ > 0 && rateQ <= 32) st.rate = rateQ;
  if (q.get('cam') && CAM[q.get('cam')] != null) { st.cam = q.get('cam'); st.auto = false; }

  // the game's own overlays (menu, HUD panels, banner, lights, pause / results cards) stay hidden: this page has its own HUD
  const style = document.createElement('style');
  style.textContent = '#menu,#viewports,#banner,#touch,#lights,#pause,#results,#pitui,#toasts,#controls{display:none!important}' +
    '#cr{position:fixed;inset:0;pointer-events:none;z-index:40;font:500 13px/1.35 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:#e8e8ec;-webkit-font-smoothing:antialiased}' +
    '#cr .cr-p{background:rgba(10,10,12,.82);border:1px solid #26262c;border-radius:6px}' +
    '#cr .cr-lb{font:600 10px/1.2 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a8a94}' +
    '#cr .cr-tw{position:absolute;left:14px;top:14px;width:330px;padding:8px 0 6px}' +
    '#cr .cr-tw .cr-hd{padding:0 10px 6px;border-bottom:1px solid #26262c;display:flex;justify-content:space-between;gap:8px}' +
    '#cr .cr-row{display:grid;grid-template-columns:16px 4px 1fr 74px 70px;gap:0 7px;align-items:center;padding:3px 10px 2px 8px;font-size:12.5px}' +
    '#cr .cr-row .cr-nm{font:600 12px/1.2 Inter,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#cr .cr-row .cr-src{grid-column:3/6;font:400 10px/1.2 Inter,system-ui,sans-serif;color:#8a8a94;margin-top:-1px}' +
    '#cr .cr-row .cr-r{text-align:right}#cr .cr-bar{width:4px;height:14px;border-radius:2px}' +
    '#cr .cr-pu{color:#b26cff}#cr .cr-gr{color:#4ade80}#cr .cr-rd{color:#f0506e}#cr .cr-mu{color:#8a8a94}#cr .cr-am{color:#fbbf24}' +
    '#cr .cr-dash{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:14px;align-items:stretch;padding:10px 14px}' +
    '#cr .cr-spd{font:600 40px/1 "JetBrains Mono",ui-monospace,monospace;min-width:92px;text-align:right}' +
    '#cr .cr-col{display:flex;flex-direction:column;gap:4px;justify-content:center;min-width:64px}' +
    '#cr .cr-chip{display:inline-block;padding:2px 6px;border:1px solid #26262c;border-radius:6px;font:600 10.5px/1.2 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;text-align:center}' +
    '#cr .cr-chip.cr-on{border-color:#b26cff;color:#b26cff}#cr .cr-chip.cr-dep{border-color:#4ade80;color:#4ade80}#cr .cr-chip.cr-hv{border-color:#fbbf24;color:#fbbf24}#cr .cr-chip.cr-sc{border-color:#f0506e;color:#f0506e}' +
    '#cr .cr-clk{font:600 26px/1 "JetBrains Mono",ui-monospace,monospace}#cr .cr-big2{font:600 18px/1.1 "JetBrains Mono",ui-monospace,monospace}' +
    '#cr .cr-secs{display:grid;grid-template-columns:repeat(3,64px);gap:4px}#cr .cr-sec{border:1px solid #26262c;border-radius:6px;padding:2px 5px;text-align:center;font-size:12px}' +
    '#cr .cr-sec.cr-pb{border-color:#b26cff;background:rgba(58,36,96,.6)}' +
    '#cr .cr-lbl{position:absolute;left:14px;top:166px;width:330px;padding:7px 10px;font:400 10.5px/1.45 Inter,system-ui,sans-serif;color:#cfcfd6}' +
    '#cr .cr-lbl b{color:#e8e8ec;font-weight:600}' +
    '#cr .cr-cam{position:absolute;right:14px;top:14px;padding:6px 10px;font:500 11px/1.4 Inter,system-ui,sans-serif;color:#cfcfd6;text-align:right}' +
    '#cr .cr-tag{position:absolute;transform:translate(-50%,-100%);padding:1px 5px;border-radius:4px;font:700 10px/1.3 Inter,system-ui,sans-serif;letter-spacing:.05em;white-space:nowrap;background:rgba(10,10,12,.78);border:1px solid #26262c}' +
    '#cr .cr-fin{position:absolute;right:14px;top:110px;width:300px;padding:8px 10px}' +
    '#cr .cr-wait{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);padding:12px 16px;font:500 13px/1.5 Inter,system-ui,sans-serif;max-width:520px;text-align:center}' +
    '@media (max-width:760px){#cr .cr-tw{width:250px}#cr .cr-lbl{display:none}#cr .cr-fin{display:none}#cr .cr-spd{font-size:30px}}';
  document.head.appendChild(style);

  // keys: this page's own (the game's pause / restart / camera keys would start an AI race or a pause menu)
  window.addEventListener('keydown', (e) => {
    const k = e.code;
    if (!['Escape', 'KeyP', 'KeyR', 'KeyH', 'KeyC', 'KeyA', 'Space', 'Digit1', 'Digit2', 'Digit4', 'Digit8', 'Slash', 'KeyM', 'KeyF'].includes(k)) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (k === 'Space' || k === 'KeyP' || k === 'Escape') command({ cmd: 'pause' });
    else if (k === 'KeyR') command({ cmd: 'restart' });
    else if (k === 'KeyC') command({ cmd: 'cam' });
    else if (k === 'KeyA') command({ cmd: 'cam', value: 'auto' });
    else if (/^Digit/.test(k)) command({ cmd: 'rate', value: +k.slice(5) });
  }, true);
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'purple:concept-race' && e.data.payload) load(e.data.payload);
    else if (e.data.type === 'purple:concept-cmd') command(e.data);
  });

  // main.js calls this once the scene is built (hideLoading), with EI.debug (startRace, setCam, race, track, cameras)
  api.start = function (D) {
    st.D = D; buildHud();
    if (st.P) run(); else { post({ type: 'purple:concept-ready' }); waitNote(); }
  };
  function load(P) { st.P = P; if (st.D) run(); }
  function waitNote() {
    setTimeout(() => { if (st.P || !st.hud) return; const w = document.createElement('div'); w.className = 'cr-p cr-wait'; w.id = 'crWait';
      w.innerHTML = 'Waiting for the concept race data. This view is driven by the concept race page: open <b>/concept/race/</b>.'; st.hud.appendChild(w); }, 2500);
  }

  function command(c) {
    if (c.cmd === 'pause') st.paused = !st.paused;
    else if (c.cmd === 'restart') { st.t = -RUNUP; st.finished = false; st.paused = false; for (const k of st.cars) { k.finish = null; k.lapsDone = 0; k.secT = [null, null]; } st.sector = []; st.dirI = 0; st.dirT = 0; if (st.auto) setCam('tv'); }
    else if (c.cmd === 'rate' && c.value > 0 && c.value <= 32) st.rate = c.value;
    else if (c.cmd === 'cam') {
      if (c.value === 'auto') { st.auto = true; st.dirT = 0; }
      else { st.auto = false; const order = ['chase', 'tcam', 'tv']; setCam(CAM[c.value] != null ? c.value : order[(order.indexOf(st.cam) + 1) % order.length]); }
    }
  }
  function setCam(name) { st.cam = name; if (st.D && st.D.setCam) st.D.setCam(0, CAM[name]); }

  // ---------------------------------------------------------------- the race: the lab grid builder makes the cars (liveries per
  // team), then this module owns race.update (kinematic replay). No AI, no car physics, no game lap timing.
  function run() {
    const D = st.D, P = st.P; const w = document.getElementById('crWait'); if (w) w.remove();
    if (st.race) return;   // one replay per page load (restart: command 'restart')
    const specs = P.cars.map((c, i) => ({ role: c.id, team: c.team, tyre: 'soft', aero: null, driver: { name: c.short || c.id.toUpperCase(), code: (c.short || c.id).slice(0, 3).toUpperCase(), num: c.num || 90 + i } }));
    D.startRace({ players: [], bots: 0, laps: 1, difficulty: 100, grid: 'front', assist: 'full', seed: 1, lab: { mode: 'race', concept: true, cars: specs } });
    const race = D.race, track = D.track; st.race = race;
    race.started = true; race.phase = 'racing'; race.time = 0; race.lightsOn = 0;
    st.map = mapLine(track, P.line);
    st.cars = race.cars.map((car, i) => ({ car, spec: P.cars[i], tl: timeline(P.cars[i]), finish: null, secT: [null, null], prevD: null, prevH: null }));
    st.cars.forEach((k) => { if (k.spec.ghost && !k.spec.design) ghostify(k.car); });
    api.viewReady.then(() => st.cars.forEach((k) => { if (k.spec.design) conceptBody(k, race); }));
    race.update = function (dt) { step(dt); };   // this race instance only: main.js calls it at 120 Hz like Race.update
    st.t = -RUNUP; pose(0, true); setCam(st.cam); st.dirI = 0; st.dirT = 0;
    buildRows(); post({ type: 'purple:concept-started', mapping: st.map.stats, cars: P.cars.map((c) => ({ id: c.id, lap_s: c.lap_s })) });
    requestAnimationFrame(frame);
  }

  // a ghost: never the detailed near model (its shared shaders), always the car's own LOD material, drawn translucent, no shadow
  function ghostify(car) {
    const lodSet = car.setLOD.bind(car); car.setLOD = (far, dist) => lodSet(far, Math.max(dist, 30));
    car.setLOD(false, 30); if (car.lodNear && car.lodMid) car.lodNear.visible = false;
    const seen = new Set();
    const fade = (o) => {
      if (!o.isMesh) return; o.castShadow = false; o.receiveShadow = false;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!m || seen.has(m)) continue; seen.add(m); m.transparent = true; m.opacity = 0.38; m.depthWrite = false; m.needsUpdate = true; }
    };
    if (car.lodMid) { car.lodMid.traverse(fade); if (car.lodFar) car.lodFar.traverse(fade); } else car.group.traverse(fade);
    if (car.shadowProxy) { car.shadowProxy.castShadow = false; car.shadowProxy.visible = false; }
    car.shadowMeshes = []; car.isGhost = true;
  }

  // the design's own car (EI.conceptView.buildCar: the game's car deformed and rebuilt from the design parameters) in place of the
  // game's model; its frame is the game car's (+x forward, +y up, +z right, ground y = 0), so it rides in car.group as it is.
  // A ghost gets cloned, translucent materials (parts of the car share materials with the game's GLB template).
  function conceptBody(k, race) {
    const V = EI.conceptView, car = k.car; if (!V || typeof V.buildCar !== 'function') { if (k.spec.ghost) ghostify(car); return; }
    let g; try { g = V.buildCar(k.spec.design, { livery: k.spec.design.livery || (k.spec.team === 'redbull' ? 'redbull-rb22' : k.spec.team), lod: k.spec.ghost ? 'lo' : 'hi', straight: false }); }
    catch (e) { console.warn('concept race: buildCar failed, game car model instead', e); if (k.spec.ghost) ghostify(car); return; }
    g.ready.then(() => {
      if (st.race !== race) { g.dispose(); return; }
      car.setLOD = () => { }; for (const o of [car.lodNear, car.lodMid, car.lodFar]) if (o) o.visible = false;
      if (k.spec.ghost) {
        const done = new Map(), fadeM = (m) => { if (!m) return m; if (done.has(m)) return done.get(m); const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; c.transparent = true; c.opacity = 0.38; c.depthWrite = false; done.set(m, c); return c; };
        g.traverse((o) => { if (!o.isMesh) return; o.castShadow = false; o.material = Array.isArray(o.material) ? o.material.map(fadeM) : fadeM(o.material); });
        if (car.shadowProxy) { car.shadowProxy.castShadow = false; car.shadowProxy.visible = false; }
      } else g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      // the viewer's clear-coat paint is tuned for its dark studio (envMapIntensity 1); under the game's bright sky environment it reads
      // pale, so it takes the game's own paint level (js/carglb.js paint: 0.62). These paint materials belong to this buildCar instance.
      g.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.customProgramCacheKey && /^cv\d*-paint/.test(String(m.customProgramCacheKey()))) m.envMapIntensity = 0.62; });
      car.group.add(g); k.body3d = g; k.flap = 0;
      api.bodies = (api.bodies || 0) + 1;
    }, (e) => { console.warn('concept race: buildCar assets failed, game car model instead', e); if (k.spec.ghost) ghostify(car); });
  }

  function pose(dt, snap) {
    const track = st.D.track;
    for (const k of st.cars) {
      const car = k.car, d = k.tl.dist(st.t), sIn = mod(d, k.tl.L), p = st.map.pose(sIn), ch = k.tl.at(sIn), v = ch.v_kmh / 3.6;
      car.x = p.x; car.z = p.z; car.y = p.y; car.heading = p.heading; car.v = v;
      const yaw = snap || !(dt > 0) || k.prevH == null ? 0 : -wrapA(p.heading - k.prevH) / dt; k.prevH = p.heading;
      car.yaw = yaw; car.aLat = v * yaw; car.aLong = ch.a_ms2; car.gradeNow = track.grade[p.gi] || 0; car.surface = 'asphalt';
      const kap = v > 3 ? yaw / v : 0; car.steer = Math.max(-1, Math.min(1, Math.atan(3.6 * kap) / (0.42 / (1 + v / 18))));
      car.gear = ch.gear || Math.max(1, Math.min(8, 1 + Math.floor(v / 11.5)));
      car.rpm = ch.rpm ? Math.max(0.12, Math.min(1, ch.rpm / 12500)) : 0.6;
      const a = ch.a_ms2; car.brake = a < -3 ? Math.min(1, -a / 40) : 0; car.throttle = a < -3 ? 0 : a > 0.3 ? 1 : 0.45;
      car.drsOpen = ch.aero === 'straight'; car.ersActive = ch.ers === 'deploy';
      if (k.body3d) { const want = car.drsOpen ? 1 : 0, f = snap || !(dt > 0) ? want : k.flap + Math.max(-1, Math.min(1, (want - k.flap) / 0.4 * dt)); if (Math.abs(f - k.flap) > 1e-3 || snap) { k.flap = f; k.body3d.setAero(f); } }
      track.project(car.x, car.z, car.trk.i >= 0 ? car.trk.i : null, car.trk); car._prevS = car.trk.s;
      car.lap = Math.max(1, Math.floor(d / k.tl.L) + 1); car.dist = d;
      if (snap) { car._px = null; car.vx = null; }
      k.d = d; k.ch = ch;
    }
  }

  function step(dt) {
    const race = st.race; if (st.paused) return;
    const tPrev = st.t, h = dt * st.rate; st.t += h; race.time = Math.max(0, st.t);
    for (const k of st.cars) k.dPrev = k.tl.dist(tPrev);
    pose(h, false);
    for (const k of st.cars) {
      const L = k.tl.L;
      if (k.finish == null) { const f = crossing(k.dPrev, k.d, tPrev, st.t, L); if (f != null) k.finish = f; }
      for (let j = 0; j < 2; j++) if (k.secT[j] == null) { const f = crossing(k.dPrev, k.d, tPrev, st.t, st.P.timing.sectors[j]); if (f != null) k.secT[j] = f; }
    }
    if (!st.finished && st.cars.every((k) => k.finish != null)) { st.finished = true; finishPost(); }
    if (st.auto) { st.dirT += h; const cut = DIRECTOR[st.dirI % DIRECTOR.length]; if (st.cam !== cut[0]) setCam(cut[0]); if (st.dirT >= cut[1]) { st.dirT = 0; st.dirI++; } }
  }

  function result() {
    const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
    return { label: st.P.label, conditions: st.P.conditions_label, mapping: st.map.stats, rate: st.rate,
      cars: st.cars.map((k) => ({ id: k.spec.id, name: k.spec.name, source: k.spec.source, lap_s: k.spec.lap_s, replay_finish_s: r3(k.finish), diff_s: k.finish == null ? null : r3(k.finish - k.spec.lap_s), replay_sector_lines_s: k.secT.map(r3), sectors_s: k.spec.sectors_s })) };
  }
  function finishPost() { const r = result(); api.result = r; post(Object.assign({ type: 'purple:concept-finish' }, r)); console.log('purple:concept-finish ' + JSON.stringify(r)); }

  // ---------------------------------------------------------------- HUD (broadcast style; every number names its source)
  const COL = { concept: '#b26cff', ref: '#3671c6', pole: '#27f4d2' };
  function el(tag, cls, html, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function buildHud() {
    const H = el('div', null, null, document.body); H.id = 'cr'; st.hud = H;
    st.ui = {
      tw: el('div', 'cr-p cr-tw', null, H), dash: el('div', 'cr-p cr-dash', null, H), lbl: el('div', 'cr-p cr-lbl', null, H), cam: el('div', 'cr-p cr-cam', null, H), fin: el('div', 'cr-p cr-fin', null, H), tags: el('div', null, null, H),
    };
    st.ui.fin.style.display = 'none';
  }
  function buildRows() {
    const P = st.P, U = st.ui;
    U.tw.innerHTML = '<div class="cr-hd"><span class="cr-lb">Physics replay · Silverstone</span><span class="cr-lb" id="crLap">flying lap</span></div><div id="crRows"></div>';
    U.dash.innerHTML = '<div class="cr-col"><span class="cr-lb">concept · sim</span><span class="cr-spd" id="crSpd">0</span><span class="cr-lb" style="text-align:right">km/h</span></div>' +
      '<div class="cr-col"><span class="cr-lb">gear · sim</span><span class="cr-big2" id="crGear">–</span><span class="cr-chip" id="crAero">corner</span><span class="cr-chip" id="crErs">ers</span></div>' +
      '<div class="cr-col" style="min-width:150px"><span class="cr-lb">lap · sim seconds</span><span class="cr-clk" id="crClk">0.000</span><div class="cr-secs" id="crSecs"><span class="cr-sec">S1</span><span class="cr-sec">S2</span><span class="cr-sec">S3</span></div></div>' +
      '<div class="cr-col" style="min-width:150px" id="crDel"></div>';
    const cond = String(P.conditions_label || '').split(' · ').slice(1).join(' · ');
    U.lbl.innerHTML = '<b>' + esc(P.label) + '</b><br>' + esc(cond) + '<br><span class="cr-mu">the sim\'s own trace, replayed: no game AI, no game lap model · drawn ' + st.map.stats.position_rms_m + ' m RMS from the sim\'s line</span>';
    st.cars.forEach((k) => { k.tag = el('div', 'cr-tag', esc(k.spec.short || k.spec.name), U.tags); k.tag.style.color = COL[k.spec.id] || '#fff'; });
  }
  let hudT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!st.race || st.D.race !== st.race) return;
    tags();
    if (now - hudT < 66) return; hudT = now; hud();
    if (now - st.lastPost > 500) { st.lastPost = now; post({ type: 'purple:concept-state', t: st.t, rate: st.rate, paused: st.paused, cam: st.cam, auto: st.auto, finished: st.finished, d: st.cars.map((k) => k.d) }); }
  }
  function tags() {
    const cam = st.D.cameras && st.D.cameras[0]; if (!cam || !root.THREE) return;
    const v = tags.v || (tags.v = new THREE.Vector3()), W = window.innerWidth, Hh = window.innerHeight;
    for (const k of st.cars) {
      const c = k.car; v.set(c.vx != null ? c.vx : c.x, (c.vy != null ? c.vy : c.y) + 1.2, c.vz != null ? c.vz : c.z); const dist = v.distanceTo(cam.position); v.project(cam);
      const on = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && dist < 260 && !(k.spec.id === 'concept' && st.cam !== 'tv');
      k.tag.style.display = on ? '' : 'none'; if (on) { k.tag.style.left = ((v.x + 1) / 2) * W + 'px'; k.tag.style.top = ((1 - v.y) / 2) * Hh + 'px'; }
    }
  }
  function hud() {
    const me = st.cars[0], P = st.P, t = st.t, $ = (id) => document.getElementById(id);
    const dIn = (k) => Math.min(Math.max(k.d, 0), k.tl.L);   // distance into the timed lap (clamped to the lap)
    // timing tower: on track order by distance; gap = the time the car ahead needed to reach this car's distance (this lap)
    const rows = st.cars.slice().sort((a, b) => (b.finish == null ? b.d : 1e9 - b.finish) - (a.finish == null ? a.d : 1e9 - a.finish));
    const lead = rows[0];
    $('crRows').innerHTML = rows.map((k, i) => {
      let right = '';
      if (k.finish != null) right = '<span class="cr-r">' + fmt(k.spec.lap_s) + '</span><span class="cr-r ' + (i === 0 ? 'cr-pu' : 'cr-mu') + '">' + (i === 0 ? 'lap' : sgn(k.spec.lap_s - lead.spec.lap_s)) + '</span>';
      else if (t < 0) right = '<span class="cr-r cr-mu">—</span><span class="cr-r cr-mu">run-up</span>';
      else right = '<span class="cr-r">' + Math.round((k.ch && k.ch.v_kmh) || 0) + ' km/h</span><span class="cr-r ' + (i === 0 ? 'cr-pu' : 'cr-mu') + '">' + (i === 0 ? 'leader' : sgn(t - lead.tl.tAtS(dIn(k)), 2)) + '</span>';
      return '<div class="cr-row"><span class="cr-mu">' + (i + 1) + '</span><span class="cr-bar" style="background:' + (COL[k.spec.id] || '#888') + '"></span><span class="cr-nm">' + esc(k.spec.name) + '</span>' + right + '<span class="cr-src">' + esc(k.spec.source) + '</span></div>';
    }).join('');
    $('crLap').textContent = t < 0 ? 'flying lap · run-up' : st.finished ? 'lap complete' : 'lap 1 · sim time';
    const ch = me.ch || {}; $('crSpd').textContent = Math.round(ch.v_kmh || 0); $('crGear').textContent = ch.gear || '–';
    const aero = $('crAero'); aero.textContent = ch.aero === 'straight' ? 'straight mode' : 'corner mode'; aero.className = 'cr-chip' + (ch.aero === 'straight' ? ' cr-on' : '');
    const ers = $('crErs'), E = { deploy: ['ers deploy', ' cr-dep'], harvest: ['ers harvest', ' cr-hv'], superclip: ['superclip', ' cr-sc'] }[ch.ers] || ['ers —', ''];
    ers.textContent = E[0]; ers.className = 'cr-chip' + E[1]; ers.title = P.ers_note || '';
    const tt = me.finish != null ? me.finish : Math.max(0, t); $('crClk').textContent = fmt(Math.min(tt, me.spec.lap_s));
    // sectors: the sim's own split for each sector as the car crosses its line (purple = quickest of the three cars)
    const secs = [0, 1, 2].map((j) => {
      const done = j < 2 ? me.secT[j] != null : me.finish != null; if (!done) return '<span class="cr-sec cr-mu">S' + (j + 1) + '</span>';
      const mine = me.spec.sectors_s[j], best = Math.min.apply(null, st.cars.map((k) => k.spec.sectors_s[j]));
      return '<span class="sec' + (mine <= best + 1e-9 ? ' pb' : '') + '">' + fmt(mine) + '</span>';
    });
    $('crSecs').innerHTML = secs.join('');
    // live delta to each ghost at the concept car's distance (negative = the concept car is ahead)
    const dm = dIn(me), tm = me.tl.tAtS(dm);
    $('crDel').innerHTML = '<span class="cr-lb">delta at this point</span>' + st.cars.slice(1).map((k) => {
      const dd = t < 0 ? null : (me.finish != null ? me.spec.lap_s - k.spec.lap_s : tm - k.tl.tAtS(dm));
      return '<div><span style="color:' + (COL[k.spec.id] || '#fff') + '">■</span> <span class="cr-big2 ' + (dd == null ? 'cr-mu' : dd < 0 ? 'cr-pu' : 'cr-rd') + '">' + sgn(dd) + '</span> <span class="cr-lb">' + esc(k.spec.short) + '</span></div>';
    }).join('');
    st.ui.cam.innerHTML = 'camera <b>' + st.cam + '</b>' + (st.auto ? ' · director' : '') + ' · ' + st.rate + '× · ' + (st.paused ? '<span class="cr-am">paused</span>' : 'live') + '<br><span class="cr-mu">C camera · A director · Space pause · R replay · 1 2 4 8 speed</span>';
    if (!st.finished) st.ui.fin.style.display = 'none';
    else {
      const r = api.result || result(); st.ui.fin.style.display = '';
      st.ui.fin.innerHTML = '<div class="cr-lb" style="margin-bottom:4px">Lap · physics-sim seconds</div>' + r.cars.map((c) => '<div style="display:flex;justify-content:space-between;gap:8px"><span>' + esc(c.name) + '</span><span>' + fmt(c.lap_s) + '</span></div>').join('') +
        '<div class="cr-lb" style="margin-top:6px">replay finish (clock) − lap</div>' + r.cars.map((c) => '<div style="display:flex;justify-content:space-between"><span class="cr-mu">' + esc(c.id) + '</span><span class="cr-mu">' + sgn(c.diff_s) + ' s</span></div>').join('');
    }
  }
})();
