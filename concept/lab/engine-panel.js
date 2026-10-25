// PURPLE CONCEPT LAB - the ENGINE dashboard (docs/concept/DASHBOARD.md). A full view over the concept lab (header button "Engine",
// or ?engine=1 | speed | auto | garage | sheet) that runs the whole engine on the API (127.0.0.1:8787, or ?api=):
//   Speed run   the CMA-ES campaign on the server's worker threads (seeds, evaluation budget, baseline), live by SSE: laps, laps/s,
//               best lap, convergence, the best car's parameters and legality; Stop ends it cleanly and the best car so far is
//               re-scored on the physics lap sim with the uncertainty band.
//   Autonomous  the self-improving loop: Mubit's designer task proposes, a short local search of physics laps exploits it, the
//               bench keeps it or not by the numbers, the result goes into the next call. Runs until Stop, a target lap, N
//               iterations without improvement or a call budget. Mock by default; trained only with a toggle, a typed confirmation
//               and a hard per-run cap, with the project's trained-call budget counted from the call files on disk.
//   Garage      edit any shape parameter or a part's material (permitted materials only), one physics lap per edit, sector and
//               per-corner deltas vs the baseline, the FIA verdict with articles, the legal range per parameter, the 3D car.
//   Car sheet   every number the sim uses for the RB22 / DM01 baseline with source and FIA / EST / MODEL flag, and how each part
//               moves the lap.
// Stage timings strip: measured live (server stages from /api/concept/engine/timings and the run streams; the 3D rebuild and the
// garage round trip in this browser). The browser never calls Mubit: every call is made by the server through server/mubit.js.
// Every number carries its source label (G-HON-01). Dark only, tokens from lab/lab.css (docs/DESIGN_SYSTEM.md).
(function () {
  const EI = (window.EI = window.EI || {});
  const C = EI.concept || {};
  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || "http://127.0.0.1:8787").replace(/\/$/, "");
  const $ = (s, root) => (root || document).querySelector(s);
  const MINUS = "−", isNum = v => typeof v === "number" && Number.isFinite(v);
  const fmtT = t => (isNum(t) ? t.toFixed(3) : "—");
  const fmtD = (d, dp) => (isNum(d) ? (d < -1e-12 ? MINUS : "+") + Math.abs(d).toFixed(dp == null ? 3 : dp) : "—");
  const dcls = d => (!isNum(d) || Math.abs(d) <= 0.0005 ? "flat" : d < 0 ? "faster" : "slower");
  const fmtMs = v => (!isNum(v) ? "—" : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
  const fmtInt = v => (isNum(v) ? Math.round(v).toLocaleString("en-GB") : "—");
  const now = () => performance.now();
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k === "style") n.setAttribute("style", v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, ...kids) { const n = document.createElementNS(SVGNS, tag); if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k === "text") n.textContent = v; else n.setAttribute(k, v); } for (const k of kids.flat(Infinity)) if (k) n.append(k); return n; }
  const delta = (d, suffix, dp) => el("span", { class: "delta " + dcls(d) }, fmtD(d, dp) + (suffix || ""));
  const arrow = s => String(s || "").replace(/->/g, " → ").replace(/; /g, " · ");
  async function api(path, init) {
    const res = await fetch(API + path, init); const j = await res.json().catch(() => null);
    if (!j || !j.ok) { const e = new Error((j && j.error && j.error.message) || ("HTTP " + res.status)); e.extra = j && j.error; throw e; }
    return j.data;
  }
  const post = (path, b) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) });

  // the real 2026 Silverstone qualifying order (EI.RACEPACE) and team colours (EI.SEASON), as the lab's board
  const RP = (EI.RACEPACE && EI.RACEPACE.silverstone) || null, TEAMS = (EI.SEASON && EI.SEASON.teams) || [];
  function teamOfCode(code) { const seat = RP && RP.seat && RP.seat[code]; if (seat) { const t = TEAMS.find(x => x.id === seat || x.name === seat || x.code === seat); if (t) return t; } return TEAMS.find(t => (t.drivers || []).includes(code)) || null; }
  const REAL = "real 2026 British GP qualifying · OpenF1 / formula1.com (js/data/racepace2026.js)";
  const SIM = "physics lap sim · quasi-steady-state point mass · Silverstone · 2026 British GP qualifying conditions";
  const pole = () => (RP && RP.pole ? RP.pole.s : 88.111), hadS = () => (RP && RP.q ? RP.q.HAD : 88.746);
  const gridOf = lap => (RP && RP.q ? 1 + Object.values(RP.q).filter(x => isNum(x) && x < lap - 1e-9).length : null);

  const STAGE_ORDER = [["legality", "legality check"], ["physics_lap", "physics lap"], ["surrogate", "surrogate prediction"], ["view3d", "3D rebuild"], ["mubit_call", "Mubit call"], ["search_batch", "local-search batch"], ["contributions", "per-corner deltas"], ["ranges", "legal ranges"], ["garage_rt", "garage round trip"]];
  const S = {
    open: false, tab: "speed", info: null, timings: {}, client: { view3d: [], garage_rt: [] },
    speed: { run: null, es: null, trace: {}, best: {}, baseline: {}, final: null, status: "idle", laps: 0, rate: null, phase: "", t0: 0, events: 0 },
    auto: { run: null, es: null, trace: [], best: null, baseline: null, final: null, status: "idle", rows: new Map(), laps: 0, rate: null, calls: 0, startParams: null, stopReason: null },
    garage: { team: "redbull", base: null, cat: null, mats: null, params: null, res: null, undo: [], busy: false, pending: false },
    sheet: null, view: null, viewDesign: null, starting: false,
  };

  // ---------------------------------------------------------------- frame
  const btn = el("button", { type: "button", class: "btn engine-btn", id: "btnEngine", title: "the whole engine: speed run, autonomous Mubit loop, garage, car sheet, stage timings", onclick: () => toggle() }, "Engine");
  const root = el("section", { class: "engine", id: "engine", "aria-label": "engine dashboard", hidden: true });
  const tabs = el("nav", { class: "eng-tabs", role: "tablist" });
  const TABS = [["speed", "Speed run"], ["auto", "Autonomous · Mubit"], ["garage", "Garage"], ["sheet", "Red Bull car sheet"]];
  for (const [id, name] of TABS) tabs.append(el("button", { type: "button", role: "tab", class: "eng-tab", id: "tab-" + id, "data-tab": id, onclick: () => setTab(id) }, name));
  const bigBtn = el("button", { type: "button", class: "eng-go", id: "engGo", onclick: () => go() }, "Start");
  const status = el("span", { class: "badge", id: "engStatus" }, "idle");
  const closeBtn = el("button", { type: "button", class: "btn icon", title: "back to the concept lab", "aria-label": "close", onclick: () => toggle(false) }, "×");
  const strip = el("div", { class: "eng-strip", id: "engStrip", "aria-label": "stage timings" });
  const howFast = el("div", { class: "eng-how src", id: "engHow" });
  const body = el("div", { class: "eng-body", id: "engBody" });
  const leftForm = el("div", { class: "eng-lform" }), leftLive = el("div", { class: "eng-llive" });
  const left = el("div", { class: "eng-left", id: "engLeft" }, leftForm, leftLive), mid = el("div", { class: "eng-mid" }), right = el("div", { class: "eng-right", id: "engRight" });
  const hero = el("div", { class: "eng-hero panel" }, el("div", { class: "eng-view", id: "engView" }), el("div", { class: "eng-hero-tl", id: "engHeroTL" }), el("div", { class: "eng-hero-bl", id: "engHeroBL" }));
  const midBottom = el("div", { class: "eng-midb panel", id: "engMidB" });
  mid.append(hero, midBottom);
  body.append(left, mid, right);
  const sheetHost = el("div", { class: "eng-sheet", id: "engSheet", hidden: true });
  const foot = el("footer", { class: "eng-foot src", id: "engFoot" });
  root.append(
    el("div", { class: "eng-head" }, el("span", { class: "label eng-title" }, "Engine"), tabs, el("span", { class: "spacer" }), status, bigBtn, closeBtn),
    el("div", { class: "eng-stripw" }, strip, howFast), body, sheetHost, foot);

  function toggle(on) {
    S.open = on == null ? !S.open : !!on; root.hidden = !S.open; btn.classList.toggle("on", S.open);
    document.body.classList.toggle("engine-open", S.open);
    if (S.open) { refreshInfo(); mountView(); render(); }
  }
  function setTab(t) {
    S.tab = t;
    for (const [id] of TABS) { const b = $("#tab-" + id, root); b.classList.toggle("on", id === t); b.setAttribute("aria-selected", id === t ? "true" : "false"); }
    body.hidden = t === "sheet"; sheetHost.hidden = t !== "sheet";
    if (t === "garage" && !S.garage.base) garageInit();
    if (t === "sheet" && !S.sheet) loadSheet();
    render();
  }

  // ---------------------------------------------------------------- info, budget, timings
  async function refreshInfo() {
    try {
      const i = await api("/api/concept/engine/info"); S.info = i; S.timings = Object.assign({}, S.timings, {});
      if (i.active) attach(i.active);
      render();
    } catch (e) { S.info = { error: e.message }; render(); }
  }
  async function pollTimings() {
    if (!S.open) return;
    try { const t = await api("/api/concept/engine/timings"); S.timings = t.stages || {}; renderStrip(); } catch (e) { /* the strip keeps its last values */ }
  }
  setInterval(pollTimings, 2000);
  function clientStat(name, ms) { const a = S.client[name]; a.push(ms); if (a.length > 200) a.shift(); renderStrip(); }
  function statOf(xs) { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return { n: xs.length, mean_ms: s.reduce((a, b) => a + b, 0) / s.length, p95_ms: s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1) + 0.5))], last_ms: xs[xs.length - 1] }; }
  function renderStrip() {
    const chips = STAGE_ORDER.map(([k, name]) => {
      const t = k === "view3d" || k === "garage_rt" ? statOf(S.client[k]) : S.timings[k];
      const what = k === "view3d" ? "3D rebuild of the car from its parameters in this browser (EI.conceptView.setDesign)" : k === "garage_rt" ? "garage: click to answer in this browser (HTTP + legality + lap + per-corner deltas + ranges)" : (t && t.what) || "";
      const mock = k === "mubit_call" && t && t.meta && t.meta.mode === "mock";
      return el("div", { class: "eng-chip" + (t ? "" : " off"), title: what + (t ? " · n " + t.n + (t.window && t.window < t.n ? " (stats over the last " + t.window + ")" : "") : " · not measured yet") },
        el("span", { class: "en" }, name + (mock ? " (mock)" : "")),
        el("span", { class: "ev num" }, t ? fmtMs(t.mean_ms) : "—", el("i", null, " ms")),
        el("span", { class: "ep src" }, t ? "p95 " + fmtMs(t.p95_ms) + " · n " + fmtInt(t.n) : "not run yet"));
    });
    strip.replaceChildren(...chips);
    // how fast is this (measured, this machine)
    const lap = S.timings.physics_lap, rate = S.speed.status === "running" ? S.speed.rate : S.auto.status === "running" ? S.auto.rate : (S.speed.rate || S.auto.rate), info = S.info || {};
    const w = info.workers_default, cpus = info.cpus;
    const parts = [];
    if (isNum(rate)) parts.push(el("b", null, rate.toFixed(0) + " physics laps/s"), " on this machine (" + (w != null ? w + " worker threads, " : "") + (cpus || "?") + " CPUs) in the last run");
    else if (lap) parts.push(el("b", null, "≈ " + (1000 / lap.mean_ms * Math.max(1, w || 1)).toFixed(0) + " physics laps/s"), " estimated from " + fmtMs(lap.mean_ms) + " ms per lap × " + (w || 1) + " worker threads (start a run to measure)");
    else parts.push("Start a run or click in the garage: the timings fill in as the engine works.");
    if (isNum(rate) || lap) { const r = isNum(rate) ? rate : 1000 / lap.mean_ms * Math.max(1, w || 1); parts.push(" · 1,000 laps ≈ " + (1000 / r).toFixed(0) + " s · a 5,000-lap seed ≈ " + (5000 / r / 60).toFixed(1) + " min"); }
    const mc = S.timings.mubit_call; if (mc) parts.push(" · one designer call " + fmtMs(mc.mean_ms) + " ms" + (mc.meta && mc.meta.mode === "mock" ? " (mock, no network; live Haiku through Mubit took 3-4 s per call in the untrained runs)" : ""));
    howFast.replaceChildren(el("span", { class: "label tight" }, "How fast is this "), ...parts);
  }

  // ---------------------------------------------------------------- 3D
  function mountView() {
    if (S.view || S.viewTried) return; S.viewTried = true;
    const host = $("#engView", root);
    if (!EI.conceptView || typeof EI.conceptView.mount !== "function" || !C.design) { host.append(el("div", { class: "empty" }, "3D view not loaded (concept/view/view3d.js); the numbers still update.")); return; }
    try {
      const base = C.design.baseline({ team: "redbull" });
      S.view = EI.conceptView.mount(host, { baseline: base, design: base, parts: C.parts, label: true, legend: false, livery: base.livery });
      host.addEventListener("conceptview:design", e => { if (e.detail && isNum(e.detail.ms) && S.view3dPending) { S.view3dPending = false; clientStat("view3d", e.detail.ms); S.lastRebuild = { ms: e.detail.ms, rebuilt: e.detail.rebuilt || [] }; } });
    } catch (e) { host.append(el("div", { class: "empty warn" }, "3D view error: " + (e.message || e))); S.view = null; }
  }
  function show3d(params, team, highlight) {
    if (!S.view || !params || !C.design) return;
    const key = JSON.stringify(params); if (key === S.viewDesign) return; S.viewDesign = key;
    try {
      const base = C.design.baseline(team ? { team } : undefined), d = C.design.clone(base); d.params = JSON.parse(key); d.id = "engine-car";
      S.view3dPending = true;
      const r = S.view.setDesign(d, { baseline: base, animate: false, livery: base.livery });
      if (r && isNum(r.ms)) { S.view3dPending = false; clientStat("view3d", r.ms); S.lastRebuild = { ms: r.ms, rebuilt: r.rebuilt || [] }; }
      S.view.setHighlight(highlight || []);   // [] also clears the change tags: only the garage shows them (one edit at a time)
    } catch (e) { console.warn("engine 3D", e); }
  }

  // ---------------------------------------------------------------- run control
  function modeOfTab() { return S.tab === "speed" ? "speed" : S.tab === "auto" ? "auto" : null; }
  function activeMode() { return S.speed.status === "running" ? "speed" : S.auto.status === "running" ? "auto" : null; }
  async function go() {
    const m = modeOfTab(); if (!m) return;
    const st = S[m];
    if (st.status === "running") { if (st.run) { try { st.stopping = true; render(); await post("/api/concept/engine/run/" + st.run.run_id + "/stop"); } catch (e) { note(m, "stop failed: " + e.message); } } return; }
    if (activeMode() || S.starting) return;
    S.starting = true; render();
    try {
      const b = m === "speed" ? speedBody() : autoBody();
      const r = await post("/api/concept/engine/run", b);
      attach(r, true);
    } catch (e) { note(m, "could not start: " + e.message); }
    finally { S.starting = false; render(); }
  }
  function note(m, msg) { S[m].note = msg; render(); }
  function attach(run, fresh) {
    const m = run.mode, st = S[m];
    if (st.es && st.run && st.run.run_id === run.run_id) return;
    if (st.es) st.es.close();
    if (m === "speed") Object.assign(st, { run, trace: {}, best: {}, baseline: {}, final: null, status: "running", laps: 0, rate: null, rateAvg: false, phase: "starting", t0: Date.now(), note: null, stopping: false });
    else Object.assign(st, { run, trace: [], best: null, baseline: null, final: null, status: "running", rows: new Map(), laps: 0, rate: null, rateAvg: false, calls: 0, note: null, stopping: false, stopReason: null, t0: Date.now() });
    if (fresh) setTab(m);
    const es = new EventSource(API + run.stream); st.es = es;
    const on = (type, fn) => es.addEventListener(type, ev => { try { fn(JSON.parse(ev.data)); } catch (e) { console.warn("engine " + type, e); } schedule(); });
    on("snapshot", x => snapshot(m, x));
    on("start", x => { st.startEv = x; });
    on("progress", x => (m === "speed" ? speedProgress(x) : autoProgress(x)));
    on("final", x => {
      st.final = x; if (x.timings) S.timings = x.timings;
      if (m === "speed") { st.phase = "finished · " + fmtInt(x.laps) + " physics laps in " + x.runtime_s + " s" + (x.stopped ? " (" + x.stopped + ")" : ""); if (x.runtime_s > 0) { st.rate = x.laps / x.runtime_s; st.rateAvg = true; } }
      else if (x.laps && st.t0) { st.rate = x.laps / Math.max(1, (Date.now() - st.t0) / 1000); st.rateAvg = true; }
    });
    on("stopping", () => { st.stopping = true; });
    on("error", x => { if (x && x.error) { st.status = "error"; st.note = "run failed: " + x.error; } });
    on("loop_error", x => { st.note = "loop error: " + (x.error || ""); });
    on("end", x => { st.status = x.status || "done"; st.stopReason = x.stop_reason || st.stopReason; st.stopping = false; es.close(); refreshInfo(); });
    if (m === "auto") {
      on("request", x => row(x.iteration).request = x);
      on("response", x => { row(x.iteration).response = x; });
      on("proposal", x => row(x.iteration).proposal = x);
      on("search", x => row(x.iteration).search = x);
      on("result", x => autoResult(x));
      on("link", x => { row(x.iteration).fed = x.fed_to; });
      on("done", x => { st.summary = x.summary; });
    }
    es.onerror = () => { if (st.status === "running") { st.note = "stream interrupted (API down?)"; st.status = "error"; } es.close(); schedule(); };
  }
  function snapshot(m, x) {
    const st = S[m], s = x.state || {};
    if (m === "speed") { st.trace = s.trace || {}; st.best = s.best || {}; st.baseline = s.baseline || {}; st.laps = s.laps || 0; st.rate = s.rate; }
    else { st.trace = (s.trace && s.trace.loop) || []; st.best = s.best && s.best.loop || null; st.baseline = s.baseline && s.baseline.loop || null; st.laps = s.laps || 0; }
    if (x.final) st.final = x.final;
    if (x.status && x.status !== "running") st.status = x.status;
    st.stopReason = x.stop_reason || null;
  }

  // ---------------------------------------------------------------- speed run
  const F = {};   // form inputs
  function input(id, attrs) { const n = el("input", Object.assign({ id, autocomplete: "off" }, attrs)); F[id] = n; return n; }
  function select(id, opts, val) { const n = el("select", { id }, opts.map(([v, t]) => el("option", { value: v, selected: v === val }, t))); F[id] = n; return n; }
  function field(label, ctl, hint) { return el("label", { class: "ef", title: hint || "" }, el("span", { class: "efl" }, label), ctl); }
  function speedBody() {
    const seeds = String(F.spSeeds.value).split(/[ ,]+/).filter(Boolean).map(Number);
    const bl = F.spBase.value === "both" ? ["redbull", "generic"] : [F.spBase.value];
    return { mode: "speed", seeds, evals: parseInt(F.spEvals.value, 10), baselines: bl, refine_evals: parseInt(F.spRefine.value, 10), continuous: F.spCont.checked, sensitivity: F.spSens.checked };
  }
  function speedProgress(x) {
    const st = S.speed; st.laps = x.laps; if (isNum(x.laps_per_s)) st.rate = x.laps_per_s;
    if (x.timings) S.timings = x.timings;
    if (x.kind === "phase") { st.phase = x.phase === "seed" ? x.team + " · seed " + x.seed : x.phase === "refine" ? x.team + " · refinement (volumes, materials, coordinates)" : x.phase === "report" ? x.team + " · re-scoring the best car on the physics sim" : x.team + " · baseline lapped"; if (x.phase === "baseline") { st.baseline[x.team] = x.baseline; st.trace[x.team] = st.trace[x.team] || [[x.laps, x.baseline.lap_s]]; if (!st.best[x.team]) st.best[x.team] = x.baseline; } }
    else if (x.kind === "gen") st.phase = x.team + " · seed " + x.seed + " · restart " + x.restart + " (" + x.restart_kind + ") · gen " + x.gen + " · " + x.legal_in_batch + "/" + x.batch + " legal";
    else if (x.kind === "refine") st.phase = x.team + " · refinement · " + x.stage + " · " + x.refine_laps + " laps";
    if (x.best) { st.best[x.team] = x.best; (st.trace[x.team] = st.trace[x.team] || []).push([x.laps, x.best.lap_s]); }
  }
  function leftSpeed() {
    const busy = S.speed.status === "running";
    if (!F.spSeeds) {
      F.spForm = el("form", { class: "eng-form", onsubmit: e => e.preventDefault() },
        field("seeds", input("spSeeds", { value: qs.get("seeds") || "1,2,3,4", class: "w-wide" }), "CMA-ES seeds, one search per seed (deterministic per seed)"),
        field("laps per seed", input("spEvals", { type: "number", min: "20", max: "200000", step: "100", value: qs.get("evals") || "1500" }), "physics-lap budget of each seed (the surrogate pre-screens 4× as many; never a reported number)"),
        field("baseline", select("spBase", [["redbull", "Red Bull RB22 · DM01"], ["generic", "generic 2026"], ["both", "both"]], qs.get("baseline") || "redbull")),
        field("refinement laps", input("spRefine", { type: "number", min: "0", max: "20000", step: "100", value: "600" }), "after the seeds: wing volumes, materials and a coordinate search on the best car, all physics laps"),
        el("label", { class: "ef chk", title: "after the listed seeds, keep adding seeds until Stop" }, input("spCont", { type: "checkbox" }), el("span", null, "continuous until Stop")),
        el("label", { class: "ef chk", title: "wind, energy strategy, aero map halved, part groups: ~150 extra physics laps at the end" }, input("spSens", { type: "checkbox" }), el("span", null, "sensitivity at the end")));
    }
    if (!F.spCard) F.spCard = el("div", { class: "panel eng-card" }, el("div", { class: "ph" }, el("span", { class: "label" }, "Speed run · CMA-ES campaign"), el("span", { class: "src" }, "no LLM · worker threads")), F.spForm,
      el("div", { class: "pf src" }, "Every lap is a physics lap of a car that passed the FIA 2026 checks, the same-engine (DM01) and material guards; the surrogate only pre-screens. Same seed, same result."));
    for (const k of ["spSeeds", "spEvals", "spBase", "spRefine", "spCont", "spSens"]) F[k].disabled = busy;
    const st = S.speed, team = Object.keys(st.best)[0] || "redbull", b = st.best[team], base = st.baseline[team];
    const elapsed = st.t0 && busy ? ((Date.now() - st.t0) / 1000).toFixed(0) + " s" : st.final ? st.final.runtime_s + " s" : "—";
    const kp = el("div", { class: "eng-kpis" },
      kpi("laps evaluated", fmtInt(st.laps), "physics laps run on the worker threads"),
      kpi(st.rateAvg ? "laps / s (avg)" : "laps / s", isNum(st.rate) ? st.rate.toFixed(0) : "—", st.rateAvg ? "physics laps ÷ wall time of the whole run" : "finished physics laps per second over the last 3 s"),
      kpi("best lap", b ? fmtT(b.lap_s) : "—", SIM, "purple"),
      kpi("vs baseline", b && base ? fmtD(b.lap_s - base.lap_s) : "—", SIM, b && base ? dcls(b.lap_s - base.lap_s) : ""),
      kpi("vs real pole", b ? fmtD(b.lap_s - pole()) : "—", "model lap − real 2026 pole " + pole() + " s (" + REAL + ")", b ? dcls(b.lap_s - pole()) : ""),
      kpi("elapsed", elapsed, ""));
    return { form: F.spCard, live: el("div", { class: "panel eng-card" }, el("div", { class: "ph" }, el("span", { class: "label" }, "Live"), el("span", { class: "src one" }, st.stopping ? "stopping after this batch…" : st.phase || (st.final ? "finished" : "idle"))), kp, st.note ? el("div", { class: "warn pad" }, st.note) : null) };
  }
  function kpi(label, value, title, cls) { return el("div", { class: "ekpi", title: title || "" }, el("span", { class: "label tight" }, label), el("span", { class: "ekv num " + (cls || "") }, value)); }

  // ---------------------------------------------------------------- autonomous
  function autoBody() {
    const llm = F.auLlm.value === "mock" ? "mock" : "live", trained = F.auLlm.value === "trained";
    const b = { mode: "auto", llm, trained, seed: parseInt(F.auSeed.value, 10) || 0, search_budget: parseInt(F.auBudget.value, 10), scope: F.auScope.value, patience: parseInt(F.auPat.value, 10), max_calls: parseInt(F.auCalls.value, 10), max_iterations: parseInt(F.auIters.value, 10), target_lap_s: F.auTargetOn.checked ? parseFloat(F.auTarget.value) : null, pace_ms: parseInt(F.auPace.value, 10) || 0, team: "redbull" };
    if (trained) { b.confirm = F.auConfirmBox.checked ? "trained" : null; b.confirm_text = F.auConfirm.value.trim(); }
    if (S.auto.startParams && F.auStart.value === "garage") b.start_params = S.auto.startParams;
    return b;
  }
  function autoProgress(x) { const st = S.auto; if (isNum(x.laps)) st.laps = x.laps; if (isNum(x.laps_per_s)) st.rate = x.laps_per_s; st.searching = x; }
  function row(k) { const st = S.auto; if (!st.rows.has(k)) st.rows.set(k, { k }); return st.rows.get(k); }
  function autoResult(x) {
    const st = S.auto; const r = row(x.iteration); r.result = x.row; r.best = x.best;
    st.laps = x.laps; if (isNum(x.laps_per_s)) st.rate = x.laps_per_s; st.calls = x.calls;
    st.trace.push([x.iteration, x.best.lap_s, x.laps]);
    if (x.row.kept) st.best = Object.assign({}, x.best, { iteration: x.iteration, params: x.best_params });
    st.searching = null;
  }
  function leftAuto() {
    const busy = S.auto.status === "running", info = S.info || {}, bud = info.budget;
    if (!F.auLlm) {
      F.auForm = el("form", { class: "eng-form", onsubmit: e => e.preventDefault() },
        field("LLM", select("auLlm", [["mock", "mock (scripted stand-in, no network)"], ["live", "live · untrained (x-middleware-record: metadata)"], ["trained", "live · TRAINED (recorded by Mubit)"]], "mock"), "every call goes through server/mubit.js; the browser never calls Mubit"),
        field("seed", input("auSeed", { type: "number", min: "0", max: "999999", value: qs.get("seed") || "1" })),
        field("search laps / call", input("auBudget", { type: "number", min: "0", max: "3000", step: "50", value: qs.get("budget") || "200" }), "physics laps of local search around each proposal (0 = measure the proposal alone, the plain loop)"),
        field("search scope", select("auScope", [["proposal", "the proposed parameters"], ["wide", "proposed + all 23 (small CMA-ES)"]], "proposal")),
        el("div", { class: "ef-h label tight" }, "stop when"),
        el("label", { class: "ef chk" }, input("auTargetOn", { type: "checkbox" }), el("span", null, "lap ≤ "), input("auTarget", { type: "number", step: "0.001", value: "87.000", class: "w-lap" }), el("span", { class: "src" }, " s")),
        field("no gain for", el("span", { class: "inl" }, input("auPat", { type: "number", min: "1", max: "200", value: "8" }), el("span", { class: "src" }, " iterations"))),
        field("call budget", input("auCalls", { type: "number", min: "1", max: "200", value: "40" }), "designer calls in this run (trained runs: at most the hard cap)"),
        field("max iterations", input("auIters", { type: "number", min: "1", max: "500", value: "200" })),
        field("pace", select("auPace", [["0", "max"], ["300", "0.3 s per call"], ["1000", "1 s per call"]], "0")),
        field("start from", select("auStart", [["baseline", "RB22 baseline"], ["garage", "the garage car"]], "baseline"), "the garage's \"send to Mubit\" sets this"),
        F.auTrained = el("div", { class: "eng-trained", hidden: true },
          el("div", { class: "warn" }, "Trained calls are recorded by Mubit as examples of the designer task and count against the project's 250."),
          el("label", { class: "ef chk" }, input("auConfirmBox", { type: "checkbox" }), el("span", null, "I want trained calls in this run")),
          field("type", input("auConfirm", { placeholder: "TRAIN 10", class: "w-wide" }), "type TRAIN followed by the call budget, e.g. TRAIN 10")));
      F.auBudgetSlot = el("div", { class: "eng-budget-slot" }); F.auHow = el("div", { class: "pf src" });
      F.auCard = el("div", { class: "panel eng-card" }, el("div", { class: "ph" }, el("span", { class: "label mubit-c" }, "Autonomous · Mubit sets the direction"), F.auPv = el("span", { class: "src" })), F.auForm, F.auBudgetSlot, F.auHow);
      F.auLlm.addEventListener("change", () => { F.auTrained.hidden = F.auLlm.value !== "trained"; if (F.auLlm.value === "trained" && +F.auCalls.value > (info.trained_run_cap || 30)) F.auCalls.value = String(Math.min(10, info.trained_run_cap || 30)); render(); });
    }
    const liveOk = !!info.live_available;
    for (const v of ["live", "trained"]) { const o = F.auLlm.querySelector("option[value=" + v + "]"); o.disabled = !liveOk; }
    if (!liveOk && F.auLlm.value !== "mock") F.auLlm.value = "mock";
    for (const k of ["auLlm", "auSeed", "auBudget", "auScope", "auTargetOn", "auTarget", "auPat", "auCalls", "auIters", "auPace", "auStart", "auConfirmBox", "auConfirm"]) F[k].disabled = busy;
    F.auStart.querySelector("option[value=garage]").disabled = !S.auto.startParams;
    const st = S.auto, b = st.best, base = st.baseline;
    const kp = el("div", { class: "eng-kpis" },
      kpi("iterations", fmtInt(st.trace.length ? st.trace[st.trace.length - 1][0] : 0), "Mubit calls answered and measured"),
      kpi("designer calls", fmtInt(st.calls), "calls through server/mubit.js (mock: scripted stand-in)"),
      kpi("physics laps", fmtInt(st.laps), "laps of the local search + measurement, worker threads"),
      kpi(st.rateAvg ? "laps / s (avg)" : "laps / s", isNum(st.rate) ? st.rate.toFixed(0) : "—", st.rateAvg ? "physics laps ÷ wall time of the whole run" : "finished physics laps per second over the last 3 s"),
      kpi("best lap", b ? fmtT(b.lap_s) : "—", SIM, "purple"),
      kpi("vs baseline", b && base ? fmtD(b.lap_s - base.lap_s) : "—", SIM, b && base ? dcls(b.lap_s - base.lap_s) : ""));
    const budgetLine = bud ? el("div", { class: "eng-budget", title: bud.rule + (bud.by_source.length ? " · " + bud.by_source.map(x => x.source + ": " + x.trained_calls).join(", ") : "") },
      el("span", { class: "label tight" }, "trained-call budget "), el("b", null, bud.remaining + " of " + bud.total + " left"), el("span", { class: "src" }, " · used " + bud.used + " (counted from " + bud.files_read + " call files on disk) · per-run cap " + bud.run_cap)) : null;
    const srch = st.searching && busy ? el("div", { class: "src pad" }, "#" + st.searching.iteration + " local search · " + st.searching.stage + " · " + st.searching.search_laps + "/" + st.searching.search_budget + " laps · best " + fmtT(st.searching.search_best_s)) : null;
    F.auBudgetSlot.replaceChildren(...(budgetLine ? [budgetLine] : []));
    F.auPv.textContent = "designer prompt v" + ((info && info.prompt_version) || "?") + (info && info.prompt_draft ? " (DRAFT)" : " (frozen)");
    F.auHow.textContent = "Each iteration: the designer (Mubit) proposes from the measured history → up to " + (F.auBudget.value || 200) + " physics laps of legal-only local search around it → the bench keeps the best car only if it is legal and faster → that result is in the next call's input.";
    return { form: F.auCard, live: el("div", { class: "panel eng-card" }, el("div", { class: "ph" }, el("span", { class: "label" }, "Live"), el("span", { class: "src one" }, st.stopping ? "stopping…" : busy ? "running" : st.stopReason ? "stopped: " + st.stopReason : st.final ? "finished" : "idle")), kp, srch, st.note ? el("div", { class: "warn pad" }, st.note) : null) };
  }
  function autoFeed() {
    const rows = Array.from(S.auto.rows.values()).sort((a, b) => b.k - a.k).slice(0, 60);
    if (!rows.length) return el("div", { class: "empty" }, "Start: iteration cards appear here. Each shows what the designer proposed, what the local search made of it, what the physics lap sim measured, and which later call carried the result back.");
    return el("div", { class: "eng-feed" }, rows.map(r => {
      const p = r.proposal || {}, s = r.search, res = r.result, m = res && res.measured || {}, kept = res && res.kept;
      return el("div", { class: "efr" + (kept ? " kept" : res ? " rej" : "") },
        el("div", { class: "efr1" }, el("b", null, "#" + r.k), el("code", { class: "rid", title: "x-middleware-request-id of this iteration's call (mock ids start mreq_mock)" }, (r.response && r.response.mubit_request_id) || (res ? "no call (" + ((res.designer && res.designer.reason) || "fallback") + ")" : "…")),
          p.proposer ? el("span", { class: "badge sm " + (p.proposer === "llm" ? "mubit" : "amber") }, p.proposer === "llm" ? "proposal" : "fallback") : null,
          res ? el("span", { class: "badge sm " + (kept ? "green" : res.legal ? "" : "red") }, kept ? "kept" : res.legal ? "not faster" : "illegal") : null,
          m.d_lap_s != null ? delta(m.d_lap_s, " s") : null),
        p.change ? el("div", { class: "efr2" }, el("span", { class: "src" }, "proposed "), arrow(p.change), p.hypothesis ? el("span", { class: "hypq" }, " “" + p.hypothesis + "”") : null) : null,
        s ? el("div", { class: "efr2 src" }, "search " + s.laps + " laps: proposal " + (s.proposal_lap_s != null ? fmtT(s.proposal_lap_s) : "illegal") + " → " + fmtT(s.lap_s) + " s" + (s.improved_on_proposal ? " (" + s.best_stage + ")" : " (the proposal itself)") + (s.refined_change !== s.proposal_change ? " · measured " + arrow(s.refined_change) : "")) : null,
        r.fed ? el("div", { class: "efr2 src" }, "→ result went to Mubit in #" + r.fed.iteration + "'s request " + (r.fed.mubit_request_id || "")) : null);
    }));
  }

  // ---------------------------------------------------------------- garage
  async function garageInit() {
    const g = S.garage;
    try {
      const t0 = now(); const x = await api("/api/concept/engine/garage/init?team=" + g.team); clientStat("garage_rt", now() - t0);
      g.base = JSON.parse(JSON.stringify(x.design.params)); g.cat = x.catalogue; g.mats = x.materials; g.params = JSON.parse(JSON.stringify(x.design.params)); g.res = x; g.baseRes = x; g.undo = [];
      render();
    } catch (e) { g.note = "garage: " + e.message; render(); }
  }
  async function garageLap() {
    const g = S.garage; if (g.busy) { g.pending = true; return; }
    g.busy = true; g.pending = false;
    try {
      const t0 = now(); const x = await post("/api/concept/engine/garage/lap", { team: g.team, params: g.params }); clientStat("garage_rt", now() - t0);
      g.res = x; g.note = null;
    } catch (e) { g.note = e.message; }
    finally { g.busy = false; render(); if (g.pending) garageLap(); }
  }
  function setParam(part, param, v) {
    const g = S.garage; if (!g.params) return;
    g.undo.push(JSON.stringify(g.params)); if (g.undo.length > 100) g.undo.shift();
    g.params[part] = Object.assign({}, g.params[part], { [param]: v });
    garageLap();
  }
  const SHORT = { "layout.wheelbase_mm": "wheelbase", "survival_cell.front_axle_offset_mm": "front axle offset", "survival_cell.cockpit_len_mm": "cockpit length", "survival_cell.bulkhead_gap_mm": "bulkhead gap", "front_wing.span_mm": "span", "front_wing.chord_mm": "chord", "front_wing.aoa_deg": "setting", "front_wing.elements": "volumes", "front_wing.sm_delta_deg": "straight-mode flap", "rear_wing.span_mm": "span", "rear_wing.chord_mm": "chord", "rear_wing.aoa_deg": "setting", "rear_wing.elements": "volumes", "rear_wing.endplate_top_mm": "endplate top", "rear_wing.sm_delta_deg": "straight-mode flap", "floor.width_mm": "width", "floor.throat_mm": "throat", "floor.ride_height_mm": "ride height", "diffuser.expansion_deg": "expansion", "sidepods.inlet_cm2": "inlet", "sidepods.undercut_mm": "undercut", "ballast.x_frac": "position", "ballast.extra_kg": "extra" };
  const PARTN = { layout: "Layout", survival_cell: "Survival cell", front_wing: "Front wing", rear_wing: "Rear wing", floor: "Floor", diffuser: "Diffuser", sidepods: "Sidepods", ballast: "Ballast", engine_cover: "Engine cover", gearbox: "Gearbox", front_suspension: "Front suspension", rear_suspension: "Rear suspension" };
  const dec = step => { const s = String(step); return s.includes(".") ? s.split(".")[1].length : 0; };
  function leftGarage() {
    const g = S.garage;
    if (!g.cat) return { form: el("div", { class: "panel eng-card" }, el("div", { class: "empty" }, g.note || "loading the garage…")), live: null };
    const ver = JSON.stringify([g.params, g.res && g.res.ranges, g.busy, g.undo.length, g.res && g.res.legal]);
    if (g.card && g.cardVer === ver) return { form: g.card, live: null };
    g.cardVer = ver;
    const ranges = new Map(((g.res && g.res.ranges) || []).map(r => [r.key, r]));
    const groups = new Map();
    for (const s of g.cat) { if (!groups.has(s.part)) groups.set(s.part, []); groups.get(s.part).push(s); }
    const rows = [];
    for (const [part, list] of groups) {
      rows.push(el("div", { class: "gp" }, PARTN[part] || part, g.mats && g.mats[part] ? matSelect(part) : null));
      for (const s of list) {
        const v = g.params[s.part][s.param], b = g.base[s.part][s.param], r = ranges.get(s.key), d = dec(s.step);
        const span = s.max - s.min, lo = r ? (r.lo - s.min) / span * 100 : 0, hi = r ? (r.hi - s.min) / span * 100 : 100, bp = (b - s.min) / span * 100;
        const rng = el("input", { type: "range", min: String(s.min), max: String(s.max), step: String(s.step), value: String(v), "aria-label": s.label, style: "--lo:" + lo.toFixed(2) + "%;--hi:" + hi.toFixed(2) + "%;--bp:" + bp.toFixed(2) + "%", title: s.label });
        const num = el("input", { type: "number", min: String(s.min), max: String(s.max), step: String(s.step), value: (+v).toFixed(d), class: "gnum", "aria-label": s.label + " value" });
        rng.addEventListener("input", () => { num.value = (+rng.value).toFixed(d); });
        rng.addEventListener("change", () => setParam(s.part, s.param, +(+rng.value).toFixed(d)));
        num.addEventListener("change", () => { const x = +num.value; if (isFinite(x)) setParam(s.part, s.param, x); });
        const changed = Math.abs(v - b) > 1e-9, out = r && (v < r.lo - 1e-9 || v > r.hi + 1e-9);
        rows.push(el("div", { class: "gr" + (changed ? " ch" : "") + (out ? " out" : ""), title: s.label + " · model domain " + s.min + "–" + s.max + " " + s.unit + (r ? " · legal now " + r.lo + " (" + r.lo_src + ") – " + r.hi + " (" + r.hi_src + ")" : "") + " · baseline " + b },
          el("span", { class: "gn" }, SHORT[s.key] || s.param), rng, num, el("span", { class: "gu src" }, s.unit),
          el("span", { class: "glim src" }, r ? r.lo + "–" + r.hi : "")));
      }
    }
    const res = g.res;
    g.card = el("div", { class: "panel eng-card garage" },
      el("div", { class: "ph" }, el("span", { class: "label" }, "Garage · edit the car"), el("span", { class: "src" }, g.busy ? "lapping…" : res && res.legal ? "legal" : res ? "illegal" : "")),
      el("div", { class: "gtools" },
        el("button", { type: "button", class: "btn small", id: "gUndo", disabled: !g.undo.length, onclick: () => { const p = g.undo.pop(); if (p) { g.params = JSON.parse(p); garageLap(); } } }, "Undo"),
        el("button", { type: "button", class: "btn small", id: "gReset", onclick: () => { g.undo.push(JSON.stringify(g.params)); g.params = JSON.parse(JSON.stringify(g.base)); garageLap(); } }, "Reset to RB22"),
        el("button", { type: "button", class: "btn small mubit-b", id: "gSend", disabled: !(res && res.legal), title: res && res.legal ? "the autonomous mode starts from this car" : "only a legal car can be a starting point", onclick: () => { S.auto.startParams = JSON.parse(JSON.stringify(g.params)); setTab("auto"); F.auStart && (F.auStart.querySelector("option[value=garage]").disabled = false, F.auStart.value = "garage"); render(); } }, "Send this car to Mubit →")),
      el("div", { class: "gtable", onscroll: e => { g.tableScroll = e.target.scrollTop; } }, rows),
      el("div", { class: "pf src" }, "Slider track: the model domain; bright band: the legal range now, every other parameter held (designer scenario ranges(): FIA article or model rule at each end); tick: RB22 baseline. Each edit = one physics lap on the server."));
    const sc = g.tableScroll; requestAnimationFrame(() => { const t = g.card && g.card.querySelector(".gtable"); if (t && sc) t.scrollTop = sc; });
    return { form: g.card, live: null };
  }
  function matSelect(part) {
    const g = S.garage, m = g.mats[part], cur = (g.params[part] && g.params[part].material) || m.base;
    const s = el("select", { class: "gmat", title: "permitted materials only (bench material guard, C15); survival cell, nose and rear impact structure keep their homologated laminate", "aria-label": part + " material" }, m.options.map(o => el("option", { value: o.id, selected: o.id === cur, title: o.fia || "" }, (o.id === m.base ? "● " : "") + o.name.split(",")[0])));
    s.addEventListener("change", () => { g.undo.push(JSON.stringify(g.params)); const p = Object.assign({}, g.params[part]); if (s.value === m.base) delete p.material; else p.material = s.value; g.params[part] = p; garageLap(); });
    return s;
  }

  // ---------------------------------------------------------------- centre panels
  function viewModes() {
    if (!S.view) return null;
    const b = (m, t) => el("button", { type: "button", class: "btn small" + ((S.viewMode || "solid") === m ? " primary" : ""), onclick: () => { S.viewMode = m; try { S.view.setMode(m); } catch (e) { /* older view without this mode */ } schedule(); } }, t);
    const rb = S.lastRebuild;
    return el("span", { class: "eng-vm" }, b("solid", "solid"), b("xray-mass", "x-ray mass"), b("materials", "materials"),
      rb ? el("span", { class: "src", title: "parts the 3D view rebuilt on the last change (EI.conceptView setDesign)" }, " 3D " + fmtMs(rb.ms) + " ms" + (rb.rebuilt.length ? " · rebuilt " + rb.rebuilt.slice(0, 4).join(", ") + (rb.rebuilt.length > 4 ? " +" + (rb.rebuilt.length - 4) : "") : "")) : null);
  }
  function renderMid() {
    const tl = $("#engHeroTL", root), bl = $("#engHeroBL", root), mb = midBottom;
    const tlAdd = () => { const v = viewModes(); if (v) tl.append(v); };
    if (S.tab === "speed") {
      const st = S.speed, team = Object.keys(st.best)[0] || "redbull", b = st.best[team];
      if (b && b.params) show3d(b.params, team === "generic" ? null : team);
      tl.replaceChildren(el("span", { class: "badge " + (st.status === "running" ? "purple" : "") }, st.status === "running" ? "speed run · best car so far" : st.final ? "speed run · final" : "RB22 baseline"), el("span", { class: "badge" }, "ghost = baseline")); tlAdd();
      bl.replaceChildren(finalCard("speed"));
      mb.replaceChildren(el("div", { class: "ph" }, el("span", { class: "label" }, "Convergence · best legal lap vs physics laps"), el("span", { class: "src" }, SIM)), el("div", { class: "svgwrap", id: "engChart" }));
      chartSpeed($("#engChart", mb));
    } else if (S.tab === "auto") {
      const st = S.auto;
      if (st.best && st.best.params) show3d(st.best.params, "redbull"); else if (S.auto.startParams && st.status !== "running") show3d(S.auto.startParams, "redbull");
      tl.replaceChildren(el("span", { class: "badge " + (st.status === "running" ? "purple" : "") }, st.status === "running" ? "autonomous · best kept car" : st.final ? "autonomous · final" : "start car"), el("span", { class: "badge" }, "ghost = baseline")); tlAdd();
      bl.replaceChildren(finalCard("auto"));
      mb.replaceChildren(el("div", { class: "ph" }, el("span", { class: "label" }, "Best lap per iteration"), el("span", { class: "src" }, "x: iteration (Mubit call) · " + SIM)), el("div", { class: "svgwrap", id: "engChart" }));
      chartAuto($("#engChart", mb));
    } else if (S.tab === "garage") {
      const g = S.garage, res = g.res;
      if (g.params) show3d(g.params, "redbull", res && res.diff ? Array.from(new Set(res.diff.map(d => d.part))) : []);
      tl.replaceChildren(el("span", { class: "badge purple" }, "garage car"), el("span", { class: "badge" }, "ghost = RB22 baseline")); tlAdd();
      bl.replaceChildren(garageCard());
      mb.replaceChildren(el("div", { class: "ph" }, el("span", { class: "label" }, "Per corner · garage car − baseline"), el("span", { class: "src one", title: res && res.segments_label || "" }, res && res.segments_label ? "physics lap sim contributions · sum = lap Δ" : "")), el("div", { class: "segs", id: "engSegs" }, segBars(res)));
    }
  }
  function finalCard(m) {
    const st = S[m], f = st.final;
    if (!f) return el("div", { class: "src" }, st.status === "running" ? "the final numbers are re-scored on the physics sim when the run ends (Stop is fine)" : "");
    const x = m === "speed" ? Object.values(f.results || {})[0] : f.rescore;
    if (!x) return el("div", null);
    if (x.legal === false) return el("div", { class: "warn" }, "the final car is illegal: " + (x.violations || []).map(v => v.id).join(", "));
    return el("div", { class: "fcard" },
      el("div", { class: "label tight" }, "model prediction · re-scored on the physics sim" + (f.stopped || st.stopReason ? " · " + (f.stopped || st.stopReason) : "")),
      el("div", { class: "fbig" }, el("span", { class: "big purple" }, fmtT(x.lap_s)), el("span", { class: "pm" }, " ± " + fmtT(x.sigma_s) + " s (1σ)")),
      el("div", { class: "src" }, "95 % band " + fmtT(x.band95_s[0]) + "–" + fmtT(x.band95_s[1]) + " s · vs real pole " + fmtT(pole()) + ": ", delta(x.delta_to_pole_s, " s"), " · vs HAD " + fmtT(hadS()) + ": ", delta(x.delta_to_had_s, " s"), " · grid P" + x.grid_position + " (95 %: P" + x.grid_range_95[0] + "–P" + x.grid_range_95[1] + ")"),
      el("div", { class: "src" }, (x.verdict_pole && x.verdict_pole.text ? "vs pole: " + x.verdict_pole.text + ". " : "")),
      el("div", { class: "src one", title: x.honesty || "" }, (x.source || SIM) + " · " + (x.honesty || "")));
  }
  function garageCard() {
    const g = S.garage, x = g.res;
    if (!x) return el("div", { class: "src" }, g.note || "");
    const verdict = x.legal ? el("span", { class: "badge green" }, "FIA: legal · " + x.rules_checked + " rules") : el("span", { class: "badge red" }, "FIA: illegal");
    return el("div", { class: "gcard" },
      el("div", { class: "kpis" },
        el("div", { class: "kpi" }, el("span", { class: "label" }, "lap"), el("span", { class: "big" }, x.legal ? fmtT(x.lap_s) : "no lap")),
        el("div", { class: "kpi" }, el("span", { class: "label" }, "vs RB22 baseline"), el("span", { class: "big delta " + dcls(x.d_lap_s) }, x.legal ? fmtD(x.d_lap_s) : "—")),
        el("div", { class: "kpi" }, el("span", { class: "label" }, "vs real pole"), el("span", { class: "big delta " + dcls(x.delta_to_pole_s) }, x.legal ? fmtD(x.delta_to_pole_s) : "—")),
        el("div", { class: "kpi" }, el("span", { class: "label" }, "grid"), el("span", { class: "big" }, x.legal ? "P" + x.grid_position : "—"))),
      x.legal ? el("div", { class: "kpi-sub" }, ["S1", "S2", "S3"].map((n, i) => [n + " " + fmtT(x.sectors_s[i]) + " ", delta(x.d_sectors_s[i]), "  "]), " · trap " + Math.round(x.speed_trap_kmh) + " km/h · " + (x.mass ? x.mass.total_kg + " kg" : "")) : null,
      el("div", { class: "gverd" }, verdict, " ", (x.violations || []).map(v => el("span", { class: "chip vio", title: (v.text || "") + " · value " + v.value + " · limit " + v.limit }, (v.model_rule ? "model rule " + v.id : "FIA " + v.article) + " · " + v.id.replace(/^REG-C-/, "")))),
      el("div", { class: "src one", title: x.label }, x.label + (x.timings_ms ? " · server: legality " + fmtMs(x.timings_ms.legality) + " ms, lap " + (x.timings_ms.physics_lap_cached ? "cached" : fmtMs(x.timings_ms.physics_lap) + " ms") + ", corners " + fmtMs(x.timings_ms.contributions) + " ms" : "")));
  }
  function segBars(x) {
    if (!x || !x.segments) return el("div", { class: "empty" }, x && !x.legal ? "an illegal car gets no lap: fix the rule above" : "edit a parameter: per-corner time deltas vs the baseline appear here");
    const segs = x.segments, max = Math.max(0.005, ...segs.map(s => Math.abs(s.d_s)));
    return segs.map(s => el("div", { class: "sg " + (s.kind === "corner" ? "c" : "s"), title: s.name + " · " + s.kind + (s.s0_m != null ? " " + s.s0_m + "–" + s.s1_m + " m" : "") + (s.min_kmh != null ? " · min " + s.ref_min_kmh + " → " + s.min_kmh + " km/h" : "") },
      el("span", { class: "sgn one" }, s.name), el("span", { class: "sgb" }, el("i", { class: s.d_s < 0 ? "f" : "sl", style: (s.d_s < 0 ? "right:50%;" : "left:50%;") + "width:" + (50 * Math.abs(s.d_s) / max).toFixed(1) + "%" })), el("span", { class: "sgv delta " + dcls(s.d_s) }, fmtD(s.d_s))));
  }

  // ---------------------------------------------------------------- charts
  function frame(host, xmax, lo, hi, xlab) {
    const W = Math.max(240, host.clientWidth || 600), H = Math.max(110, host.clientHeight || 200), pad = { l: 48, r: 12, t: 10, b: 22 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, X = v => pad.l + (v / Math.max(1e-9, xmax)) * iw, Y = v => pad.t + ((v - lo) / Math.max(1e-9, hi - lo)) * ih;
    const nodes = [], step = nice((hi - lo) / 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) nodes.push(sv("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }), sv("text", { class: "ax", x: pad.l - 6, y: Y(v) + 3, "text-anchor": "end", text: v.toFixed(step < 0.1 ? 2 : 1) }));
    const sx = nice(xmax / 5); for (let v = 0; v <= xmax + 1e-9; v += sx) if (X(v) < W - pad.r - 100) nodes.push(sv("text", { class: "ax", x: X(v), y: H - 6, "text-anchor": "middle", text: v >= 10000 ? (v / 1000).toFixed(0) + "k" : String(Math.round(v)) }));
    nodes.push(sv("text", { class: "ax ttl", x: W - pad.r, y: H - 6, "text-anchor": "end", text: xlab }));
    const ref = (v, label, cls) => { if (isNum(v) && v >= lo && v <= hi) nodes.push(sv("line", { class: "ref " + cls, x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }), sv("text", { class: "reft", x: W - pad.r - 4, y: Y(v) - 3, "text-anchor": "end", text: label })); };
    return { W, H, X, Y, nodes, ref, pad, ih };
  }
  function nice(raw) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9)))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function chartSpeed(host) {
    const st = S.speed, teams = Object.keys(st.trace);
    const pts = teams.flatMap(t => st.trace[t]), laps = Math.max(st.laps || 0, ...pts.map(p => p[0]), 100);
    const ys = pts.map(p => p[1]).concat([pole()]), lo0 = Math.min(...ys), hi0 = Math.max(...ys, hadS());
    const span = Math.max(0.3, hi0 - lo0), f = frame(host, laps, lo0 - span * 0.08, hi0 + span * 0.12, "physics laps");
    f.ref(pole(), "real pole ANT " + fmtT(pole()), "pole"); f.ref(hadS(), "real HAD (RB22) " + fmtT(hadS()), "base");
    const col = { redbull: "var(--purple)", generic: "var(--amber)" };
    for (const t of teams) {
      const p = st.trace[t]; if (!p.length) continue;
      let d = "M" + f.X(p[0][0]) + "," + f.Y(p[0][1]); for (let i = 1; i < p.length; i++) d += " H" + f.X(p[i][0]) + " V" + f.Y(p[i][1]); d += " H" + f.X(Math.max(p[p.length - 1][0], st.laps || 0));
      f.nodes.push(sv("path", { class: "bestline", d, style: "stroke:" + (col[t] || "var(--purple)") }));
      for (const q of p.slice(1)) f.nodes.push(sv("circle", { class: "kept", cx: f.X(q[0]), cy: f.Y(q[1]), r: 2.4, style: "fill:" + (col[t] || "var(--purple)") }));
      f.nodes.push(sv("text", { class: "reft", x: f.pad.l + 6, y: f.H - f.pad.b - 6 - teams.indexOf(t) * 12, text: (t === "redbull" ? "RB22 · DM01" : "generic 2026") + " best " + fmtT(p[p.length - 1][1]) }));
    }
    if (!pts.length) f.nodes.push(sv("text", { class: "ax hint", x: f.W / 2, y: f.H / 2, "text-anchor": "middle", text: "the best legal lap so far appears here as the campaign runs" }));
    host.replaceChildren(sv("svg", { width: f.W, height: f.H, viewBox: "0 0 " + f.W + " " + f.H, role: "img", "aria-label": "convergence: best legal lap vs physics laps" }, f.nodes));
  }
  function chartAuto(host) {
    const st = S.auto, p = st.trace, n = Math.max(10, ...p.map(q => q[0]));
    const ys = p.map(q => q[1]).concat([pole()]), lo0 = Math.min(...ys), hi0 = Math.max(...ys, hadS()), span = Math.max(0.3, hi0 - lo0);
    const f = frame(host, n, lo0 - span * 0.08, hi0 + span * 0.12, "iteration");
    f.ref(pole(), "real pole ANT " + fmtT(pole()), "pole"); f.ref(hadS(), "real HAD (RB22) " + fmtT(hadS()), "base");
    if (p.length) {
      let d = "M" + f.X(p[0][0]) + "," + f.Y(p[0][1]); for (let i = 1; i < p.length; i++) d += " H" + f.X(p[i][0]) + " V" + f.Y(p[i][1]);
      f.nodes.push(sv("path", { class: "bestline", d }));
      for (const r of st.rows.values()) if (r.result) { const m = r.result.measured || {}; if (r.result.kept) f.nodes.push(sv("circle", { class: "kept", cx: f.X(r.k), cy: f.Y(r.best.lap_s), r: 3 })); else if (m.lap_after != null) f.nodes.push(sv("circle", { class: "rej", cx: f.X(r.k), cy: Math.min(f.pad.t + f.ih, f.Y(m.lap_after)), r: 2.2 })); else f.nodes.push(sv("path", { class: "ill", d: "M" + (f.X(r.k) - 2.5) + "," + (f.pad.t + f.ih - 6) + " l5,5 m0,-5 l-5,5" })); }
    } else f.nodes.push(sv("text", { class: "ax hint", x: f.W / 2, y: f.H / 2, "text-anchor": "middle", text: "best lap per Mubit iteration appears here" }));
    host.replaceChildren(sv("svg", { width: f.W, height: f.H, viewBox: "0 0 " + f.W + " " + f.H, role: "img", "aria-label": "best lap per iteration" }, f.nodes));
  }

  // ---------------------------------------------------------------- right column: leaderboard + the car
  function ourCar() {
    if (S.tab === "speed") { const st = S.speed, t = Object.keys(st.best)[0]; const b = t && st.best[t]; const fin = st.final && st.final.results && st.final.results[t]; return b ? { lap: fin ? fin.lap_s : b.lap_s, sigma: fin ? fin.sigma_s : null, base: st.baseline[t] && st.baseline[t].lap_s, name: (t === "generic" ? "generic concept" : "RB22 concept") + (st.status === "running" ? " · live" : "") } : null; }
    if (S.tab === "auto") { const st = S.auto, b = st.best || (st.trace.length ? { lap_s: st.trace[st.trace.length - 1][1] } : null), fin = st.final && st.final.rescore; return b ? { lap: fin && fin.legal ? fin.lap_s : b.lap_s, sigma: fin && fin.legal ? fin.sigma_s : null, base: st.baseline && st.baseline.lap_s, name: "RB22 · Mubit loop" } : null; }
    if (S.tab === "garage") { const x = S.garage.res; return x && x.legal ? { lap: x.lap_s, base: x.baseline.lap_s, name: "RB22 · garage" } : null; }
    return null;
  }
  function board() {
    if (!RP || !RP.q) return el("div", { class: "empty" }, "js/data/racepace2026.js not loaded");
    const rows = Object.entries(RP.q).filter(([, s]) => isNum(s)).map(([code, s]) => ({ code, s, team: teamOfCode(code), kind: "real" }));
    const c = ourCar(); if (c) { rows.push({ code: "PRPL", s: c.lap, kind: "concept", name: c.name, sigma: c.sigma }); if (isNum(c.base) && Math.abs(c.base - c.lap) > 1e-9) rows.push({ code: "BASE", s: c.base, kind: "base", name: "RB22 baseline (sim)" }); }
    const rank = { concept: 0, base: 1, real: 2 }; rows.sort((a, b) => a.s - b.s || rank[a.kind] - rank[b.kind]);
    let pos = 0;
    return el("div", { class: "rows" }, rows.map(r => {
      if (r.kind !== "base") pos++;
      const color = r.kind === "real" ? (r.team && r.team.colors && r.team.colors.primary) || "#8a8a94" : r.kind === "concept" ? "var(--purple)" : "transparent";
      return el("div", { class: "brow " + r.kind, title: r.kind === "real" ? r.code + " · " + REAL : SIM + (r.sigma ? " · ± " + fmtT(r.sigma) + " s (1σ)" : "") },
        el("span", { class: "pos" }, r.kind === "base" ? "" : String(pos)), el("span", { class: "sw", style: "background:" + color }), el("span", { class: "code" }, r.code),
        el("span", { class: "team one" }, r.kind === "real" ? (r.team ? r.team.name : "—") : r.name + (r.sigma ? " ±" + r.sigma.toFixed(2) : "")),
        el("span", { class: "lap num" }, fmtT(r.s)), el("span", { class: "gap num delta " + (r.kind === "real" ? "flat" : dcls(r.s - pole())) }, Math.abs(r.s - pole()) < 5e-4 && r.kind === "real" ? "pole" : fmtD(r.s - pole())));
    }));
  }
  function carPanel() {
    let base = null, cur = null, legal = null, title = "";
    if (S.tab === "speed") { const st = S.speed, t = Object.keys(st.best)[0]; if (t) { cur = st.best[t].params; base = st.baseline[t] && st.baseline[t].params; title = "best car so far"; const f = st.final && st.final.results && st.final.results[t]; legal = f ? f.legality : st.best[t] ? "live" : null; } }
    else if (S.tab === "auto") { cur = S.auto.best && S.auto.best.params; base = S.garage.base || (C.design ? C.design.baseline({ team: "redbull" }).params : null); title = "best kept car"; legal = cur ? "live" : null; }
    else if (S.tab === "garage") { const g = S.garage; cur = g.params; base = g.base; title = "garage car"; }
    const ch = [];
    if (cur && base) for (const p of Object.keys(cur)) for (const k of Object.keys(cur[p] || {})) { const a = base[p] && base[p][k], b = cur[p][k]; if (a !== b && !(isNum(a) && isNum(b) && Math.abs(a - b) < 1e-9)) ch.push({ p, k, a, b }); }
    const leg = legal === "live" ? el("div", { class: "ok src" }, "legal: a car is only ever kept after the bench passed it (FIA 2026 rules in concept/regs.js, same-engine DM01, permitted materials, energy limits)")
      : legal && legal.pass != null ? el("div", { class: legal.fail.length ? "warn" : "ok" }, (legal.fail.length ? legal.fail.length + " FAIL: " + legal.fail.join(", ") : "legal: every check passes") + " · " + legal.pass + " pass, " + legal.info + " info" + (legal.not_enforced.length ? " · not enforced / not checkable yet: " + legal.not_enforced.join(", ") : "")) : null;
    return el("div", { class: "panel eng-card carp" }, el("div", { class: "ph" }, el("span", { class: "label" }, "Parameters · " + (title || "car")), el("span", { class: "src" }, ch.length + " changed vs RB22")),
      el("div", { class: "chl" }, ch.length ? ch.map(c => el("div", { class: "chr" }, el("span", { class: "src" }, (PARTN[c.p] || c.p) + " · " + (SHORT[c.p + "." + c.k] || c.k)), el("span", { class: "num" }, (c.a === undefined ? "baseline" : String(c.a)) + " → " + (c.b === undefined ? "baseline" : String(c.b))))) : el("div", { class: "src pad" }, "baseline car (no change yet)")),
      leg);
  }
  function renderRight() {
    right.replaceChildren(
      el("div", { class: "panel board eng-board" }, el("div", { class: "ph" }, el("span", { class: "label" }, "Silverstone qualifying · 2026"), el("span", { class: "src" }, "pole " + (RP ? RP.pole.code + " " + fmtT(pole()) : ""))), board(),
        el("div", { class: "pf src" }, el("div", null, el("span", { class: "tag real" }, "real"), " " + REAL), el("div", null, el("span", { class: "tag concept" }, "concept"), " " + SIM + " · model prediction, not a real car's lap"))),
      S.tab === "auto" ? el("div", { class: "panel eng-card feedp" }, el("div", { class: "ph" }, el("span", { class: "label" }, "Iterations"), el("span", { class: "src" }, "verdict = numbers, never the model's")), autoFeed()) : carPanel());
  }

  // ---------------------------------------------------------------- car sheet
  async function loadSheet() {
    sheetHost.replaceChildren(el("div", { class: "empty" }, "measuring the car sheet and the coupling table on the physics sim…"));
    try { S.sheet = await api("/api/concept/engine/carsheet?team=redbull"); } catch (e) { sheetHost.replaceChildren(el("div", { class: "empty warn" }, "car sheet: " + e.message)); return; }
    renderSheet();
  }
  const FLAG = { FIA: "green", EST: "amber", MODEL: "muted" };
  function renderSheet() {
    const x = S.sheet; if (!x) return;
    const groups = { mass: "Mass and geometry", pu: "Power unit · " + x.pu, driveline: "Gearbox and driveline", tyres: "Tyres and brakes", aero: "Aero (effective coefficients)", sim: "Sim constants" };
    const t1 = el("table", { class: "stab cs" }, el("colgroup", null, el("col", { style: "width:27%" }), el("col", { style: "width:17%" }), el("col", { style: "width:9%" }), el("col", { style: "width:47%" })), el("thead", null, el("tr", null, el("th", null, "Quantity"), el("th", null, "Value"), el("th", null, "Flag"), el("th", null, "Source"))),
      el("tbody", null, Object.keys(groups).flatMap(gk => [el("tr", { class: "sgrp" }, el("td", { colspan: "4" }, groups[gk]))].concat(x.rows.filter(r => r.group === gk).map(r => el("tr", null, el("td", null, r.name), el("td", { class: "num" }, String(r.value) + (r.unit ? " " + r.unit : "")), el("td", null, el("span", { class: "flag " + FLAG[r.flag], title: x.flags[r.flag] }, r.flag)), el("td", { class: "src" }, r.source)))))));
    const cp = x.coupling;
    const dl = o => (!o ? "—" : o.na ? el("span", { class: "src" }, o.na) : o.illegal ? el("span", { class: "src", title: o.illegal.join(", ") }, "illegal (" + o.illegal.length + " rule" + (o.illegal.length > 1 ? "s" : "") + ")") : delta(o.d_lap_s, " s"));
    const t2 = cp ? el("table", { class: "stab cpl" }, el("colgroup", null, el("col", { style: "width:25%" }), el("col", { style: "width:15%" }), el("col", { style: "width:36%" }), el("col", { style: "width:12%" }), el("col", { style: "width:12%" })), el("thead", null, el("tr", null, el("th", null, "Parameter"), el("th", null, "Baseline ± step"), el("th", null, "Mechanism (COUPLING.md)"), el("th", null, "Δlap −"), el("th", null, "Δlap +"))),
      el("tbody", null, cp.rows.map(r => el("tr", null, el("td", null, el("div", null, r.key), el("div", { class: "src" }, r.label)), el("td", { class: "num" }, r.base + " ± " + r.step + " " + r.unit), el("td", { class: "src" }, r.mechanism || "—", r.expected ? el("div", { class: "muted" }, "expected: " + r.expected) : null), el("td", { class: "num" }, dl(r.minus)), el("td", { class: "num" }, dl(r.plus)))))) : null;
    sheetHost.replaceChildren(
      el("div", { class: "panel eng-card" }, el("div", { class: "ph" }, el("span", { class: "label" }, "Red Bull RB22 · Red Bull Ford DM01 · every number the sim uses"), el("span", { class: "src" }, "baseline lap " + fmtT(x.lap.lap_s) + " s · " + x.lap.label)),
        x.fit ? el("div", { class: "src pad" }, "Fit: the sim's RB22 laps " + x.fit.q_sim_s + " s against " + x.fit.driver + "'s real " + x.fit.q_real_s + " s (" + REAL + "), trap " + x.fit.trap_sim_kmh + " vs " + x.fit.trap_real_kmh + " km/h; held-out sector residuals " + (x.fit.sector_residuals_s || []).join(" / ") + " s, speed-trace RMS " + x.fit.heldout_trace_rms_kmh + " km/h. Flags: FIA = " + x.flags.FIA + "; EST = " + x.flags.EST + "; MODEL = " + x.flags.MODEL + ".") : null,
        el("div", { class: "stw" }, t1)),
      cp ? el("div", { class: "panel eng-card" }, el("div", { class: "ph" }, el("span", { class: "label" }, "How a part moves the lap"), el("span", { class: "src one", title: cp.source }, "measured " + cp.measured_at.slice(11, 19) + " UTC in " + cp.ms + " ms")), el("div", { class: "src pad" }, cp.source), el("div", { class: "stw" }, t2)) : null);
  }

  // ---------------------------------------------------------------- render
  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  function render() {
    if (!S.open) return;
    const m = modeOfTab(), st = m ? S[m] : null, other = activeMode();
    bigBtn.hidden = !m;
    if (m) {
      const running = st.status === "running";
      bigBtn.textContent = running ? (st.stopping ? "Stopping…" : "Stop") : S.starting ? "Starting…" : "Start " + (m === "speed" ? "speed run" : "autonomous loop");
      bigBtn.className = "eng-go" + (running ? " stop" : "");
      bigBtn.disabled = S.starting || !!st.stopping || (!running && !!other && other !== m) || !!(S.info && S.info.error);
      bigBtn.title = !running && other && other !== m ? "a " + other + " run is active: stop it first (one engine run at a time)" : "";
    }
    const a = other ? S[other] : null;
    status.textContent = S.info && S.info.error ? "API unreachable" : a ? other + " · running" : st && st.status !== "idle" ? (m + " · " + st.status) : "idle";
    status.className = "badge " + (S.info && S.info.error ? "red" : a ? "purple" : st && st.status === "done" ? "green" : st && st.status === "stopped" ? "amber" : "");
    renderStrip();
    if (S.tab !== "sheet") {
      const L = S.tab === "speed" ? leftSpeed() : S.tab === "auto" ? leftAuto() : leftGarage();
      if (leftForm.firstChild !== L.form || leftForm.childNodes.length !== 1) leftForm.replaceChildren(L.form);
      leftLive.replaceChildren(...(L.live ? [L.live] : []));
      renderMid(); renderRight();
    }
    foot.replaceChildren(el("span", { class: "label tight" }, "Honest limits "), "Every lap is the " + SIM + " (reduced-order: no flow solved, aero from a component-share map, coefficients estimated from public laps) · every leaderboard time is " + REAL + " · our car is a model prediction ± band, never a claim about a real car · " + (S.info && S.info.mock ? "server in MUBIT_MOCK: the designer is the scripted stand-in, no network" : "live calls go through server/mubit.js only") + ".");
  }

  // ---------------------------------------------------------------- mount
  function mount() {
    const top = document.querySelector("header.top"), back = top && top.querySelector(".back, .hbreak");   // end of the first header row
    if (top) top.insertBefore(btn, back || null);
    document.body.append(root);
    const want = qs.get("engine");
    setTab(["speed", "auto", "garage", "sheet"].includes(want) ? want : "speed");
    if (want) toggle(true);
    window.addEventListener("resize", schedule);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  EI.conceptEngine = { toggle, setTab, go, state: () => ({ tab: S.tab, speed: { status: S.speed.status, laps: S.speed.laps, best: S.speed.best, final: S.speed.final }, auto: { status: S.auto.status, calls: S.auto.calls, laps: S.auto.laps, iterations: S.auto.trace.length, best: S.auto.best, final: S.auto.final, stop: S.auto.stopReason }, garage: { res: S.garage.res, params: S.garage.params }, timings: S.timings, client: { view3d: statOf(S.client.view3d), garage_rt: statOf(S.client.garage_rt) } }), setParam, S, API };
})();
