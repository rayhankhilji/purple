// PURPLE DEMO - one focused page for a live demo (≤ 3 min): the textured RB22 concept car morphing as the engine keeps cars, the real
// 2026 Silverstone qualifying order with our car climbing it, the best lap per decision, and the MUBIT FEED: one card per designer call
// (the model's hypothesis, its change in plain words, the physics verdict, and whether the call became a Mubit training example).
//   REPLAY (default, any visitor): plays back a RECORDED LIVE Mubit run (concept/demo/replays/, else concept/lab/replays/); real
//          x-middleware-request-id values; nothing is re-run. Labelled "replay of a recorded live Mubit run".
//   LIVE   (after the site's passcode unlock, or a local server with MUBIT_API_KEY): POST /api/concept/engine/run { mode: "engineer",
//          llm: "live", record_good: true } and follow its SSE stream: every designer call untrained (x-middleware-record: metadata);
//          a decision whose proposal as proposed is legal and faster is re-sent by the SERVER as the identical trained call
//          (concept/engineer/record-good.js) and the stream says so ("training_example"). The browser never calls Mubit.
//   OFFLINE DEMO (explicit small button): the same engine with the scripted mock; labelled "not a model" everywhere.
// Every number carries its source label (G-HON-01); scores as n/N. Dark only, tokens from lab/lab.css (docs/DESIGN_SYSTEM.md).
(function () {
  // ---------------------------------------------------------------- the one place to update the Mubit model status (integrator)
  const MUBIT_MODEL = {
    text: "Mubit model: v1 trained on 98 examples · failed Mubit's test (5/19) · 751 physics-approved examples sent for v2",
    source: "Mubit console, owner screenshots 2026-10-24",
  };
  const LIVE_CALLS = 12;   // designer calls per live run (record_good: up to one trained re-send each; the server checks budget and caps)

  const EI = (window.EI = window.EI || {});
  const C = EI.concept || {};
  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || "http://127.0.0.1:8787").replace(/\/$/, "");
  const $ = s => document.querySelector(s);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const MINUS = "−";
  const f3 = v => (isNum(v) ? v.toFixed(3) : "—");
  const sg = (v, dp) => (isNum(v) ? (v < -1e-12 ? MINUS : "+") + Math.abs(v).toFixed(dp == null ? 3 : dp) : "—");
  const dcls = d => (!isNum(d) || Math.abs(d) <= 0.0005 ? "flat" : d < 0 ? "faster" : "slower");
  const int = v => (isNum(v) ? Math.round(v).toLocaleString("en-GB") : "—");
  const SIM = "physics lap sim · Silverstone · model prediction";
  const FOOT = "physics lap sim · Silverstone · model prediction, not a real car's lap · real lap times: OpenF1 2026 qualifying";
  const SIM_LONG = "physics lap sim · quasi-steady-state point mass · Silverstone · 2026 British GP qualifying conditions · a model prediction, not a real car's lap";
  const REAL = "real 2026 British GP qualifying · OpenF1 / formula1.com (js/data/racepace2026.js)";
  const RP = (EI.RACEPACE && EI.RACEPACE.silverstone) || null, TEAMS = (EI.SEASON && EI.SEASON.teams) || [];
  const POLE = RP && RP.pole ? RP.pole.s : 88.111, POLE_CODE = RP && RP.pole ? RP.pole.code : "ANT";
  const RB22 = 88.745;   // the RB22 / DM01 baseline on the physics lap sim (every engine v2 run starts there; replaced by the run's own baseline)
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

  const S = {
    mode: "replay", replay: null, meta: null, shown: 0, playing: false, timer: null, pace: 1000, status: "idle", error: null,
    cards: [], baseline: null, best: null, bestDesign: null, trace: [], view: null, baseDesign: null,
    run: null, es: null, progress: null, liveOk: false, liveWhy: "", deploy: null, apiOk: false, examples: 0, calls: 0,
  };

  // ---------------------------------------------------------------- plain words
  // plain reasons for the rule a car broke (the article codes stay in the tooltip)
  const ARTICLE_WORDS = { "PKG-FLOOR-STALL": "floor too low", "PKG-COOLING": "not enough cooling", "PKG-GEAR-TOP": "top gear too short", "PKG-WB": "parts do not fit the wheelbase", "PKG-PART-MASS": "impossible part mass" };
  const articleWords = a => ARTICLE_WORDS[a] || (/^C3\.10/.test(a) ? "front wing outside the rules" : /^C3\.11/.test(a) ? "rear wing outside the rules" : /^C3\.(5|6|7|8|9)\b/.test(a) ? "bodywork outside the rules" : "outside the 2026 rules");
  const PARAM_WORDS = { aoa_deg: ["angle", "°"], ride_height_mm: ["ride height", " mm"], expansion_deg: ["expansion", "°"], chord_mm: ["chord", " mm"], span_mm: ["span", " mm"], endplate_top_mm: ["endplate", " mm"], elements: ["elements", ""], width_mm: ["width", " mm"], throat_mm: ["throat", " mm"], roll_stiffness: ["roll stiffness", ""], camber_deg: ["camber", "°"], edge: ["edge", ""] };
  function plainChange(s, max) {
    const items = String(s || "").split(/;\s*/).filter(Boolean).map(x => {
      const m = /^([a-z_]+)\.([a-z_0-9]+)\s+(\S+)->(\S+)$/.exec(x.trim()); if (!m) return x;
      const pw = PARAM_WORDS[m[2]] || [m[2].replace(/_(mm|deg|kg|pct|n|nm)$/, "").replace(/_/g, " "), (/_mm$/.test(m[2]) ? " mm" : /_deg$/.test(m[2]) ? "°" : /_kg$/.test(m[2]) ? " kg" : "")];
      return m[1].replace(/_/g, " ") + " " + pw[0] + " " + m[3] + " → " + m[4] + pw[1];
    });
    const n = max || 3;
    return items.slice(0, n).join(" · ") + (items.length > n ? " · +" + (items.length - n) + " more" : "");
  }
  const trim = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim().replace(/…$/, ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
  const shortId = id => (id ? id.slice(0, 9) + "…" + id.slice(-6) : "");
  const approved = c => !!(c.by === "mubit" && c.as && c.as.legal === true && isNum(c.as.d_lap_s) && c.as.d_lap_s < -0.0005);

  // ---------------------------------------------------------------- data
  async function getJson(url, init) { const r = await fetch(url, init); const j = await r.json().catch(() => null); if (!r.ok && !(j && j.ok === false)) throw new Error("HTTP " + r.status); return j; }
  async function findReplay() {
    for (const dir of ["replays/", "../lab/replays/"]) {
      try {
        const idx = await getJson(dir + "index.json"), runs = (idx && idx.runs || []).filter(r => r.kind === "engineer-v2");
        const want = qs.get("replay"), pick = runs.find(r => r.name === want) || runs.find(r => r.record_good) || runs.find(r => /corrections/.test(r.name)) || runs[0];
        if (pick) return { dir, meta: pick };
      } catch (e) { /* next */ }
    }
    return null;
  }
  const baseOf = () => { try { return C.design ? C.design.baseline({ team: "redbull" }) : null; } catch (e) { return null; } };
  function designFromDiff(diff) {
    const D = C.design, b = S.baseDesign; if (!D || !b || !diff) return null;
    try { return D.applyChanges(b, diff.map(([k, v]) => { const [part, param] = k.split("."); return { part, param, to: v }; })).design; } catch (e) { return null; }
  }
  function designFromParams(params) { const b = S.baseDesign; if (!b || !params) return null; const d = C.design.clone ? C.design.clone(b) : JSON.parse(JSON.stringify(b)); d.params = JSON.parse(JSON.stringify(params)); return d; }

  // one card per decision (replay and live share it): only what the page shows
  function norm(d, extra) {
    extra = extra || {};
    return {
      n: d.decision, by: d.by, id: d.mubit_request_id || null, trained: !!d.trained, hypothesis: d.hypothesis || null, fallback: d.fallback_reason || null,
      change: d.proposal_change || null, as: d.as_proposed || null, kept: !!d.kept, new_peak: !!d.new_peak, d_head: d.d_head_s,
      lap: d.result ? d.result.lap_s : null, best_change: d.best_change || null, params: d.params || null, train: extra.train || null, trainedId: extra.trainedId || null, trainErr: extra.trainErr || null,
      // timings of this decision, as the engine measured them (concept/engineer/engine.js compactDecision)
      t: { call_ms: isNum(d.latency_ms) ? d.latency_ms : null, versions: d.screen && isNum(d.screen.distinct) ? d.screen.distinct : null, screen_ms: d.screen && isNum(d.screen.ms) ? d.screen.ms : null,
        laps: isNum(d.physics_laps) ? d.physics_laps : null, laps_ms: isNum(d.physics_ms) ? d.physics_ms : null },
    };
  }

  // ---------------------------------------------------------------- replay
  async function loadReplay() {
    stopAll();
    const f = await findReplay();
    if (!f) { S.error = "no recorded run is bundled with this site"; renderAll(); return; }
    try { S.replay = await getJson(f.dir + f.meta.file); } catch (e) { S.error = "could not load the recorded run: " + e.message; renderAll(); return; }
    S.meta = f.meta; S.mode = "replay"; S.error = null; S.status = "ready";
    resetRun(S.replay.baseline);
    renderAll();
  }
  function replayStep() {
    const R = S.replay; if (!R || S.shown >= R.decisions.length) { S.playing = false; S.status = "done"; clearTimeout(S.timer); renderAll(); return false; }
    const d = R.decisions[S.shown++];
    // a run recorded with record_good: the same chips as live ("→ Mubit training example" with the trained call's id / "correction: not trained")
    const c = R.record_good
      ? norm(d, d.training_example === "sent" ? { train: "trained", trainedId: d.trained_request_id } : d.training_example === "failed" ? { train: "failed", trainErr: d.training_error } : { train: "rejected" })
      : norm(d, { train: d.trained ? "recorded" : approved(norm(d)) ? "approved-untrained" : "untrained" });
    S.calls += c.id ? 1 : 0;
    if (c.train === "trained") S.examples++;
    addDecision(c, c.kept && c.params ? designFromDiff(c.params) : null, peakLapAfter(d));
    return true;
  }
  function peakLapAfter(d) {
    const n = (S.replay.nodes || []).find(x => x.id === d.peak_after);
    return n && isNum(n.lap_s) ? n.lap_s : null;
  }
  function play() {
    if (S.mode !== "replay" || !S.replay) return;
    if (S.status === "done") resetRun(S.replay.baseline);
    S.playing = true; S.status = "playing";
    const tick = () => { if (!S.playing) return; if (replayStep()) S.timer = setTimeout(tick, S.pace); };
    tick();
  }
  function pause() { S.playing = false; clearTimeout(S.timer); if (S.status === "playing") S.status = "paused"; renderCtl(); }
  // to the end in one go: the car is rebuilt once (the last kept car) and the page rendered once, not 117 times
  function skipToEnd() { pause(); S.bulk = true; S.pendingCar = null; try { while (S.replay && S.shown < S.replay.decisions.length) replayStep(); } finally { S.bulk = false; } if (S.pendingCar) showCar(S.pendingCar); S.pendingCar = null; if (S.replay) { S.status = "done"; renderAll(); } }

  // ---------------------------------------------------------------- live (record_good) / offline demo
  async function startRun(llm) {
    stopAll();
    S.mode = llm === "live" ? "live" : "mock"; S.status = "starting"; S.error = null; S.replay = null; S.meta = null;
    resetRun({ lap_s: RB22 }); renderAll();
    const body = llm === "live"
      ? { mode: "engineer", llm: "live", record_good: true, confirm: "trained", confirm_text: "TRAIN " + LIVE_CALLS, max_calls: LIVE_CALLS, team: "redbull", seed: +(qs.get("seed") || Math.floor(Math.random() * 1000)), variants: 3000, confirm_k: 24 }
      : { mode: "engineer", llm: "mock", team: "redbull", seed: +(qs.get("seed") || 1), max_calls: 20, variants: 3000, confirm_k: 24 };
    let j;
    try { j = await getJson(API + "/api/concept/engine/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { S.status = "error"; S.error = "the engine API is not reachable (" + API + "): " + e.message; renderAll(); return; }
    if (!j || !j.ok) { S.status = "error"; S.error = (j && j.error && j.error.message) || "the run was refused"; renderAll(); return; }
    S.run = j.data; S.status = "running"; renderAll();
    const es = new EventSource(/^https?:/.test(j.data.stream) ? j.data.stream : API + j.data.stream); S.es = es;
    const on = (t, f) => es.addEventListener(t, ev => { let d; try { d = JSON.parse(ev.data); } catch (e) { return; } try { f(d); } catch (e) { console.error("demo: " + t + ": " + (e && e.stack || e)); } });
    on("start", d => { if (d.baseline) { S.baseline = d.baseline; if (!S.trace.length || S.trace.length === 1) { S.trace = [[0, d.baseline.lap_s]]; S.best = d.baseline.lap_s; } } renderAll(); });
    on("request", d => setProgress(d.decision, (S.mode === "live" ? "asking Mubit…" : "asking the stand-in…")));
    on("proposal", d => setProgress(d.decision, (S.mode === "live" ? "Mubit proposes " : "mock proposes ") + plainChange(d.change, 2)));
    on("progress", d => { if (d.stage === "screen") setProgress(d.decision, "testing " + int(d.done) + " versions of the idea"); });
    on("screen", d => setProgress(d.decision, int(d.screen.distinct) + " versions tested · full physics laps on the best"));
    on("decision", d => {
      const c = norm(d.row, { train: S.mode !== "live" ? "mock" : d.training_example === "pending" ? "pending" : "rejected" });
      S.calls = d.calls || S.calls + 1;
      const params = d.head_params || d.peak.params;
      addDecision(c, params ? designFromParams(params) : null, d.peak.lap_s, d.peak.params ? designFromParams(d.peak.params) : null);
    });
    on("training_example", d => {
      const c = S.cards.find(x => x.n === d.decision); if (!c) return;
      if (d.error) { c.train = "failed"; c.trainErr = d.error; } else { c.train = "trained"; c.trainedId = d.trained_request_id; c.same = d.same_answer; S.examples = d.trained_examples || S.examples + 1; }
      refreshCard(c); renderCounters();
    });
    on("final", d => { S.status = "done"; S.progress = null; if (d.rescore && d.rescore.legal && isNum(d.rescore.lap_s)) S.final = d.rescore; renderAll(); });
    on("error", d => { S.error = d.error || "run error"; renderAll(); });
    es.addEventListener("end", () => { es.close(); S.es = null; if (S.status !== "done") S.status = "done"; S.progress = null; renderAll(); });
    es.onerror = () => { if (es.readyState === 2 && S.status === "running") { S.status = "done"; S.error = S.error || "the stream closed"; renderAll(); } };
  }
  function setProgress(n, text) { S.progress = { n, text }; renderProgress(); }
  async function stopRun() { if (S.run && S.status === "running") { try { await getJson(API + "/api/concept/engine/run/" + S.run.run_id + "/stop", { method: "POST" }); } catch (e) { /* the stream ends anyway */ } } }
  function stopAll() { S.playing = false; clearTimeout(S.timer); if (S.es) { try { S.es.close(); } catch (e) { /* closed */ } S.es = null; } S.progress = null; }
  async function probeLive() {
    try {
      const j = await getJson(API + "/api/concept/engine/info");
      const info = j && j.data; S.deploy = j && j.deploy || null; S.apiOk = !!info;
      if (!info) { S.liveOk = false; S.liveWhy = "the engine API did not answer"; }
      else if (S.deploy) { S.liveOk = !!(S.deploy.live && S.deploy.live.available && S.deploy.live.unlocked); S.liveWhy = !S.deploy.live.available ? "live calls are off on this deployment" : !S.deploy.live.unlocked ? "unlock first" : ""; }
      else { S.liveOk = !!info.live_available; S.liveWhy = info.mock ? "server runs with MUBIT_MOCK=1" : !info.live_available ? "no MUBIT_API_KEY on this server" : ""; }
    } catch (e) { S.apiOk = false; S.liveOk = false; S.liveWhy = "no engine API reachable"; }
    renderCtl();
  }

  // ---------------------------------------------------------------- state
  function resetRun(baseline) {
    S.baseline = baseline || { lap_s: RB22 }; S.best = S.baseline.lap_s; S.trace = [[0, S.baseline.lap_s]]; S.marks = []; S.cards = []; S.shown = 0; S.calls = 0; S.examples = 0; S.final = null;
    S.bestDesign = S.baseDesign;
    $("#dmCards").replaceChildren();
    if (S.view && S.baseDesign) { try { S.view.setDesign(S.baseDesign, { baseline: S.baseDesign, animate: false, livery: S.baseDesign.livery }); S.view.setHighlight([]); } catch (e) { /* view optional */ } }
  }
  function addDecision(c, carDesign, peakLap, peakDesign) {
    S.cards.push(c);
    const prevBest = S.best;
    if (isNum(peakLap)) S.best = Math.min(S.best, peakLap);
    if (S.best < prevBest - 1e-9) S.bestDesign = peakDesign || carDesign || S.bestDesign;
    S.trace.push([c.n, S.best]);
    S.marks.push({ n: c.n, kept: c.kept, lap: c.lap, legal: !(c.as && c.as.legal === false) });
    if (carDesign) { if (S.bulk) S.pendingCar = carDesign; else showCar(carDesign); }
    const cards = $("#dmCards"); cards.prepend(card(c)); while (cards.children.length > 40) cards.lastChild.remove();
    if (!S.bulk) renderAll(true);
  }
  function showCar(d) {
    if (!d || !S.view) return;
    try { S.view.setDesign(d, { baseline: S.baseDesign, animate: true, livery: S.baseDesign && S.baseDesign.livery }); S.view.setHighlight([]); } catch (e) { /* view optional */ }
  }

  // ---------------------------------------------------------------- render
  function renderAll(fromDecision) { renderLap(); renderCounters(); renderBoard(); renderChart(); renderMode(); renderCtl(); renderProgress(); renderTiming(); if (!fromDecision) renderFoot(); }
  function renderLap() {
    const best = S.final ? S.final.lap_s : S.best, base = S.baseline ? S.baseline.lap_s : RB22;
    $("#dmLap").replaceChildren(
      el("div", { class: "dm-lap-main" }, el("span", { class: "label" }, "best lap now"), el("span", { class: "dm-lap-big num" }, f3(best), el("small", null, " s"))),
      el("div", { class: "dm-lap-refs" },
        el("div", null, el("span", { class: "src" }, "vs real 2026 pole " + POLE_CODE + " " + f3(POLE) + " "), el("span", { class: "num delta " + dcls(best - POLE) }, sg(best - POLE))),
        el("div", null, el("span", { class: "src" }, "vs RB22 baseline " + f3(base) + " "), el("span", { class: "num delta " + dcls(best - base) }, sg(best - base))),
        el("div", { class: "src dm-lap-lbl", title: SIM_LONG + " · pole: " + REAL }, SIM)));
  }
  function counter(label, value, sub, cls, title) { return el("div", { class: "dm-ctr " + (cls || ""), title: title || null }, el("span", { class: "dm-ctr-v num" }, value), el("span", { class: "dm-ctr-l" }, label), sub ? el("span", { class: "src" }, sub) : null); }
  function renderCounters() {
    const ok = S.cards.filter(approved).length, n = S.cards.length;
    const rg = S.mode === "live" || (S.mode === "replay" && !!(S.replay && S.replay.record_good));   // untrained calls + one trained re-send per approved idea
    const calls = S.mode === "mock" ? 0 : rg ? S.calls + S.examples : S.calls;
    const okSub = S.mode === "mock" ? "offline demo: nothing is sent to Mubit" : rg ? "physics said yes to " + ok + " of " + n + " ideas · each one sent to Mubit" : "physics said yes to " + ok + " of " + n + " · this run trained every call";
    $("#dmCounters").replaceChildren(
      counter("Mubit calls", int(calls), S.mode === "mock" ? "offline demo: a scripted stand-in, not a model" : rg ? "Claude Haiku 4.5 · one per idea + one per example" : "Claude Haiku 4.5 through Mubit · one per decision", "mubit"),
      counter("approved by physics → training examples", rg ? String(S.examples) : ok + " / " + n, okSub, "good", "an idea counts as approved when the model's change, exactly as proposed, is legal and faster on the physics lap sim" + (rg ? "; each approved idea is sent to Mubit again as a training example" : "")),
      el("div", { class: "dm-ctr dm-model", title: "source: " + MUBIT_MODEL.source }, el("span", { class: "dm-model-t" }, MUBIT_MODEL.text), el("span", { class: "src" }, "source: " + MUBIT_MODEL.source)));
  }
  function teamOfCode(code) { const seat = RP && RP.seat && RP.seat[code]; if (seat) { const t = TEAMS.find(x => x.id === seat || x.name === seat || x.code === seat); if (t) return t; } return TEAMS.find(t => (t.drivers || []).includes(code)) || null; }
  function renderBoard() {
    const host = $("#dmBoard");
    if (!RP || !RP.q) { host.replaceChildren(el("div", { class: "empty" }, "js/data/racepace2026.js not loaded")); return; }
    const best = S.final ? S.final.lap_s : S.best, base = S.baseline ? S.baseline.lap_s : RB22;
    const rows = Object.entries(RP.q).filter(([, s]) => isNum(s)).map(([code, s]) => ({ key: code, code, s, team: teamOfCode(code), kind: "real" }));
    rows.push({ key: "PRPL", code: "PRPL", s: best, kind: "concept", name: "PURPLE · RB22 concept" });
    if (Math.abs(base - best) > 1e-9) rows.push({ key: "BASE", code: "BASE", s: base, kind: "base", name: "RB22 baseline (sim)" });
    const rank = { concept: 0, base: 1, real: 2 }; rows.sort((a, b) => a.s - b.s || rank[a.kind] - rank[b.kind]);
    // FLIP: rows keep their element, so our car's row slides up the order as it gets faster
    const before = new Map(Array.from(host.children).map(n => [n.dataset.key, n.getBoundingClientRect().top]));
    const old = new Map(Array.from(host.children).map(n => [n.dataset.key, n]));
    let pos = 0; const els = [];
    for (const r of rows) {
      if (r.kind !== "base") pos++;
      const color = r.kind === "real" ? (r.team && r.team.colors && r.team.colors.primary) || "#8a8a94" : r.kind === "concept" ? "var(--purple)" : "transparent";
      const n = el("div", { class: "brow " + r.kind, "data-key": r.key, title: r.kind === "real" ? r.code + " · " + REAL : SIM_LONG },
        el("span", { class: "pos" }, r.kind === "base" ? "" : String(pos)), el("span", { class: "sw", style: "background:" + color }), el("span", { class: "code" }, r.code),
        el("span", { class: "team one" }, r.kind === "real" ? (r.team ? r.team.name : "—") : r.name),
        el("span", { class: "lap num" }, f3(r.s)), el("span", { class: "gap num delta " + (r.kind === "real" ? "flat" : dcls(r.s - POLE)) }, Math.abs(r.s - POLE) < 5e-4 && r.kind === "real" ? "pole" : sg(r.s - POLE)));
      els.push(n);
    }
    host.replaceChildren(...els);
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) for (const n of els) { const t0 = before.get(n.dataset.key); if (t0 == null || !old.has(n.dataset.key)) continue; const dy = t0 - n.getBoundingClientRect().top; if (Math.abs(dy) < 1) continue; n.style.transform = "translateY(" + dy + "px)"; n.style.transition = "none"; requestAnimationFrame(() => { n.style.transition = "transform 600ms cubic-bezier(.2,.8,.2,1)"; n.style.transform = ""; }); }
    const me = els.find(n => n.dataset.key === "PRPL"); if (me && me.scrollIntoView && host.scrollHeight > host.clientHeight + 4) { const top = me.offsetTop - host.clientHeight / 2; host.scrollTop = Math.max(0, top); }
    const p = 1 + Object.values(RP.q).filter(x => isNum(x) && x < best - 1e-9).length;
    $("#dmBoardMeta").textContent = "PURPLE P" + p + " · pole " + POLE_CODE + " " + f3(POLE);
    $("#dmBoardSrc").textContent = "real times: OpenF1 · PURPLE: " + SIM;
  }
  function nice(raw) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9)))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function renderChart() {
    const host = $("#dmChart"), W = Math.max(240, host.clientWidth || 600), H = Math.max(110, host.clientHeight || 180);
    const base = S.baseline ? S.baseline.lap_s : RB22, total = S.replay ? S.replay.decisions.length : S.mode === "live" ? LIVE_CALLS : 20;
    const xmax = Math.max(total, ...S.trace.map(p => p[0]), 4);
    const ys = S.trace.map(p => p[1]).concat([POLE, base]), lo = Math.min(...ys) - 0.08, hi = Math.max(...ys) + 0.1;
    const pad = { l: 46, r: 12, t: 10, b: 22 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const X = v => pad.l + v / xmax * iw, Y = v => pad.t + (v - lo) / (hi - lo) * ih;
    const g = [];
    let step = nice((hi - lo) / 4); if (Math.floor(hi / step) - Math.ceil(lo / step) < 2) step = nice(step / 2.5);   // at least three lap labels (0.5 -> 0.2)
    let ydp = 0; while (ydp < 3 && Math.abs(Math.round(step * 10 ** ydp) - step * 10 ** ydp) > 1e-6) ydp++;   // 0.05 -> 2 decimals, 0.2 -> 1
    for (let k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) { const v = k * step; g.push(sv("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }), sv("text", { class: "ax", x: pad.l - 6, y: Y(v) + 3, "text-anchor": "end", text: v.toFixed(ydp) + " s" })); }
    // x: the idea number; the labels stop short of the axis title
    const sx = nice(xmax / 6); for (let v = 0; v <= xmax + 1e-9; v += sx) if (X(v) < W - pad.r - 58) g.push(sv("text", { class: "ax", x: X(v), y: H - 6, "text-anchor": "middle", text: String(Math.round(v)) }));
    g.push(sv("text", { class: "ax ttl", x: W - pad.r, y: H - 6, "text-anchor": "end", text: "idea →" }));
    const ref = (v, label, cls) => g.push(sv("line", { class: "ref " + cls, x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }), sv("text", { class: "reft", x: W - pad.r - 4, y: Y(v) - 4, "text-anchor": "end", text: label }));
    ref(POLE, "real 2026 pole " + POLE_CODE + " " + f3(POLE) + " (OpenF1)", "pole"); ref(base, "RB22 baseline " + f3(base) + " (sim)", "base");
    const p = S.trace;
    if (p.length > 1) {
      let d = "M" + X(p[0][0]) + "," + Y(p[0][1]); for (let i = 1; i < p.length; i++) d += " H" + X(p[i][0]) + " V" + Y(p[i][1]);
      g.push(sv("path", { class: "bestline", d }));
      for (const m of S.marks) if (m.kept && isNum(m.lap)) g.push(sv("circle", { class: "kept", cx: X(m.n), cy: Y(Math.min(hi, m.lap)), r: 2.6 }));
      const last = p[p.length - 1]; g.push(sv("circle", { class: "dm-head", cx: X(last[0]), cy: Y(last[1]), r: 5 }));
    } else g.push(sv("text", { class: "ax hint", x: W / 2, y: H / 2, "text-anchor": "middle", text: "the best lap after each decision appears here" }));
    host.replaceChildren(sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "best lap per decision" }, g));
    $("#dmChartMeta").textContent = SIM;
  }
  function renderMode() {
    let badge, line;
    if (S.mode === "replay") {
      const R = S.replay, ids = R ? R.request_ids || [] : [];
      badge = el("span", { class: "badge dm-badge replay", title: "a recorded LIVE run: every call has a real Mubit x-middleware-request-id; played back here, nothing is re-run" }, "REPLAY");
      line = el("span", { class: "dm-line", title: R ? R.calls + " Mubit calls · " + (R.model || "") + " · request ids " + ids[0] + " … " + ids[ids.length - 1] : "" }, R ? "replay of a recorded live Mubit run" + (R.recorded_at ? " · " + R.recorded_at.slice(0, 10) : "") : S.error || "loading…");
    } else if (S.mode === "live") {
      badge = el("span", { class: "badge dm-badge live" }, "LIVE");
      line = el("span", { class: "dm-line", title: S.run ? S.run.run_id : "" }, "live: Mubit proposes, physics decides, approved ideas become training examples");
    } else {
      badge = el("span", { class: "badge amber dm-badge" }, "OFFLINE DEMO");
      line = el("span", { class: "dm-line warn" }, "scripted stand-in, not a model · no Mubit call");
    }
    $("#dmMode").replaceChildren(...[badge, line, S.error && S.mode !== "replay" ? el("span", { class: "warn src" }, S.error) : null].filter(Boolean));
  }
  function buildCtl() {
    const raceHref = () => { const R = C.race; return R && S.bestDesign ? R.url(S.bestDesign, { base: "../race/", ref: "redbull" }) : "../race/"; };
    const kids = [];
    if (S.mode === "replay") {
      const playing = S.playing;
      kids.push(el("button", { type: "button", class: "btn primary", id: "dmPlay", onclick: () => (playing ? pause() : play()) }, playing ? "Pause" : S.status === "done" ? "Replay" : S.shown ? "Resume" : "Replay"),
        el("div", { class: "dm-speed", role: "group", "aria-label": "replay speed" }, [[1000, "1×"], [250, "4×"]].map(([v, t]) => el("button", { type: "button", class: "btn small" + (S.pace === v ? " on" : ""), "aria-pressed": S.pace === v ? "true" : "false", onclick: () => { S.pace = v; renderCtl(); } }, t))));
    } else {
      kids.push(el("button", { type: "button", class: "btn", onclick: loadReplay }, "Replay"));
      if (S.status === "running") kids.push(el("button", { type: "button", class: "btn danger", onclick: stopRun }, "Stop"));
    }
    kids.push(S.liveOk
      ? el("button", { type: "button", class: "btn dm-golive", id: "dmGoLive", disabled: S.status === "running" ? true : null, title: "start the engine now: " + LIVE_CALLS + " Mubit calls (Claude Haiku 4.5, untrained); every idea the physics sim approves is re-sent by the server as a trained call, a Mubit training example", onclick: () => startRun("live") }, "Go live")
      : (() => {
        // locked: this deployment goes live after the passcode (its unlock page); off: no live calls here at all
        const canUnlock = !!(S.deploy && S.deploy.live && S.deploy.live.available && !S.deploy.live.unlocked);
        const href = canUnlock ? API + (S.deploy.live.unlock || "/api/unlock") : "#";
        return el("a", { class: "btn dm-golive off", id: "dmGoLive", href, "aria-disabled": canUnlock ? null : "true", title: canUnlock ? "live Mubit calls need the passcode: unlock in this browser, then come back here" : "live is off: " + (S.liveWhy || "no engine API"), onclick: canUnlock ? null : e => e.preventDefault() }, canUnlock ? "Go live · unlock" : "Go live · off");
      })());
    kids.push(el("a", { class: "btn dm-race", id: "dmRace", href: raceHref(), title: "the best car's physics-sim lap on the game's 3D Silverstone, with the RB22 and the real 2026 pole lap as ghosts", onclick: e => { e.currentTarget.href = raceHref(); } }, "Watch the lap on Silverstone →"),
      el("a", { class: "src dm-full", href: "../lab/" + (qs.get("api") ? "?api=" + encodeURIComponent(qs.get("api")) : "") }, "full lab →"));
    $("#dmCtl").replaceChildren(...kids);
    S.raceFor = S.bestDesign;
  }
  // the controls are rebuilt only when what they show changes: a rebuild on every decision (4×: every 250 ms) swallowed clicks
  function renderCtl() {
    const key = JSON.stringify([S.mode, S.playing, S.status, S.shown > 0, S.pace, S.liveOk, S.liveWhy, S.deploy && S.deploy.live || null]);
    if (key !== S.ctlKey || !$("#dmCtl").firstChild) { S.ctlKey = key; buildCtl(); return; }
    if (S.raceFor !== S.bestDesign) { const a = $("#dmRace"), R = C.race; if (a && R && S.bestDesign) a.href = R.url(S.bestDesign, { base: "../race/", ref: "redbull" }); S.raceFor = S.bestDesign; }
  }
  function renderProgress() {
    const host = $("#dmProgress");
    if (S.mode !== "replay" && S.status === "running" && S.progress) host.replaceChildren(el("span", { class: "dm-prog" }, el("b", null, "idea " + S.progress.n), " · " + S.progress.text));
    else if (S.mode === "replay" && S.replay) host.replaceChildren(el("span", { class: "dm-prog" }, el("b", null, "idea " + S.shown + " / " + S.replay.decisions.length), " · Mubit proposes → thousands of versions tested on physics → the car keeps only what is faster"));
    else host.replaceChildren();
  }
  function renderFoot() { $("#dmFoot").textContent = FOOT; }
  // ---------------------------------------------------------------- timings (per decision, as the engine measured them)
  const secs = ms => (ms < 1000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1)) + " s";
  const who = () => (S.mode === "mock" ? "stand-in" : "Mubit");
  function callTime(c) {
    if (!c.t || !isNum(c.t.call_ms)) return null;
    return el("span", { class: "dm-rid num", title: S.mode === "mock" ? "the scripted stand-in's answer time (no Mubit call)" : "time for this Mubit call (Claude Haiku 4.5 through Mubit), measured by the engine" }, who() + " " + secs(c.t.call_ms));
  }
  function renderTiming() {
    const host = $("#dmTiming"); if (!host) return;
    const c = S.cards[S.cards.length - 1], t = c && c.t;
    if (!t) { host.replaceChildren(el("span", null, "timings for each idea appear here: the " + who() + " call, the versions tested, the physics laps")); host.removeAttribute("title"); return; }
    const parts = [];
    const seg = (title, ...kids) => parts.push(el("span", { class: "dm-tseg", title }, ...kids));
    if (isNum(t.call_ms)) seg(S.mode === "mock" ? "the scripted stand-in's answer (no Mubit call)" : "the Mubit call: Claude Haiku 4.5 through Mubit, request to answer", who() + " ", el("b", null, secs(t.call_ms)));
    if (isNum(t.versions) && isNum(t.screen_ms)) seg("versions of the idea generated around it, each checked against the 2026 rules and given a quick lap estimate (4 worker threads); the best go to the physics lap sim", el("b", null, int(t.versions)), " versions tested in ", el("b", null, secs(t.screen_ms)));
    if (isNum(t.laps) && isNum(t.laps_ms)) seg("full physics laps of Silverstone on the most promising versions (4 worker threads)", el("b", null, int(t.laps)), " physics laps in ", el("b", null, secs(t.laps_ms)));
    if (isNum(t.versions) && t.versions > 0 && isNum(t.screen_ms)) { const per = t.screen_ms / t.versions; seg("time per version tested: the 2026 rules check plus the quick lap estimate, so the rules check alone takes at most this", "legality check ", el("b", null, per.toFixed(per < 0.1 ? 2 : 1) + " ms")); }
    host.replaceChildren(...parts.flatMap((p, i) => (i ? [el("span", { class: "dm-tsep", "aria-hidden": "true" }, " · "), p] : [p])));
    host.title = "idea #" + c.n + " · measured by the engine during the " + (S.mode === "replay" ? "recorded run" : "run");
  }
  // ---------------------------------------------------------------- the Mubit feed card
  function verdict(c) {
    if (c.by !== "mubit") return el("span", { class: "dm-chip muted", title: c.fallback || "" }, "no usable answer");
    const a = c.as;
    if (!a) return null;
    const kept = c.kept && isNum(c.d_head) && c.d_head < -0.0005 ? " · the engine refined it and kept " + sg(c.d_head) + " s" : "";
    if (a.legal === false) return el("span", { class: "dm-chip bad", title: "rules broken: " + (a.articles || []).join(", ") + kept }, "✗ illegal: " + ((a.articles || []).map(articleWords).filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 1).join("") || "outside the rules"));
    if (isNum(a.d_lap_s) && a.d_lap_s < -0.0005) return el("span", { class: "dm-chip good", title: "physics lap sim, the change exactly as proposed" + kept }, "✓ faster " + sg(a.d_lap_s) + " s");
    return el("span", { class: "dm-chip bad", title: "physics lap sim, the change exactly as proposed" + kept }, "✗ slower " + sg(a.d_lap_s, isNum(a.d_lap_s) && Math.abs(a.d_lap_s) >= 0.1 ? 2 : 3) + " s");
  }
  function trainChip(c) {
    switch (c.train) {
      case "recorded": return el("span", { class: "dm-chip mubit", title: "this recorded run sent every call to Mubit as a trained call" }, "recorded in Mubit");
      case "pending": return el("span", { class: "dm-chip mubit pend" }, "→ training example…");
      case "trained": return el("span", { class: "dm-chip mubit on", title: "trained call x-middleware-request-id " + c.trainedId + (c.same === false ? " · the re-sent answer differed" : " · same answer") }, "→ Mubit training example");
      case "failed": return el("span", { class: "dm-chip bad", title: c.trainErr || "" }, "training call failed");
      case "rejected": return el("span", { class: "dm-chip muted" }, "correction: not trained");
      default: return null;
    }
  }
  function card(c) {
    const n = el("article", { class: "dm-card" + (approved(c) ? " ok" : " no") + (c.new_peak ? " peak" : ""), "data-n": c.n, title: c.id ? "Mubit request " + c.id + (c.trained ? " (trained call)" : " (untrained call)") : null },
      el("div", { class: "dm-c1" }, callTime(c), el("span", { class: "num dm-n" }, "#" + c.n), " ", c.hypothesis ? "“" + trim(c.hypothesis, 90) + "”" : "the model's answer could not be used"),
      el("div", { class: "dm-c2" }, el("span", { class: "dm-chg" }, c.change ? plainChange(c.change, 2) : "no change"), verdict(c), trainChip(c)));
    c.el = n;
    return n;
  }
  // card(c) re-points c.el at the new node, so keep the old one first (replacing c.el after card(c) was a no-op: the chip stayed "pending")
  function refreshCard(c) { const old = c.el; if (!old || !old.parentNode) return; const n = card(c); n.style.animation = "none"; old.replaceWith(n); }

  // ---------------------------------------------------------------- 3D (EI.conceptView public API only, as the engine drawer mounts it)
  function mountView() {
    const host = $("#dmView");
    if (!EI.conceptView || typeof EI.conceptView.mount !== "function" || !S.baseDesign) { host.replaceChildren(el("div", { class: "empty" }, "3D view not loaded; the numbers still update.")); return; }
    try { S.view = EI.conceptView.mount(host, { baseline: S.baseDesign, design: S.baseDesign, parts: C.parts, mode: "solid", label: false, legend: false, livery: S.baseDesign.livery }); }
    catch (e) { S.view = null; host.replaceChildren(el("div", { class: "empty" }, "3D view error: " + (e.message || e))); }
  }

  async function boot() {
    S.baseDesign = baseOf(); S.bestDesign = S.baseDesign;
    mountView();
    if (window.ResizeObserver) new ResizeObserver(() => renderChart()).observe($("#dmChart"));
    document.addEventListener("keydown", e => { if (e.target.closest && e.target.closest("input,select,textarea,button,a")) return; if (e.key === " " && S.mode === "replay") { e.preventDefault(); S.playing ? pause() : play(); } });
    renderAll();
    await loadReplay();
    probeLive();
    if (qs.get("autoplay") === "end") skipToEnd(); else if (qs.get("autoplay") !== "0") play();
  }
  // test / screenshot hook
  EI.demoPage = { state: () => ({ mode: S.mode, status: S.status, shown: S.shown, cards: S.cards.length, best: S.best, examples: S.examples, liveOk: S.liveOk }), play, pause, skipToEnd, startRun, MUBIT_MODEL };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
