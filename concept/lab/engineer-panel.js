// PURPLE CONCEPT LAB - the AUTONOMOUS ENGINEER view (engine v2, docs/concept/ENGINE_V2.md §7). The concept lab's primary view:
//   REPLAY (default, any visitor): plays back a RECORDED LIVE Mubit run from concept/lab/replays/ (real x-middleware-request-id on
//          every call; nothing re-run). Labelled "replay of a recorded live Mubit run · date · n calls · request ids".
//   LIVE   (after /unlock on the public site, or a local server with MUBIT_API_KEY): POST /api/concept/engine/run { mode: "engineer",
//          llm: "live" } and follow its SSE stream. The browser never calls Mubit; the server does, through server/mubit.js.
//   OFFLINE DEMO (explicit button only): the same engine with the scripted mock stand-in; labelled "not a model" everywhere.
// Tree view: nodes = cars measured by the physics sim (one per decision: its fastest legal car; the root = the baseline), edges =
// decisions, lanes = branches, the peak ringed, reverts / forks marked. Decision cards: request id, trained / untrained, the model's
// hypothesis, its proposal as proposed (and if illegal: projected / repaired), subspace size, variants screened, physics laps,
// best found, interaction term, kept / reverted. Speed: variants screened / s and physics laps / s as measured by the engine.
// The 3D car uses EI.conceptView's public API only (mount, setDesign, setHighlight). Every number carries its label (G-HON-01).
(function () {
  const EI = (window.EI = window.EI || {});
  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || "http://127.0.0.1:8787").replace(/\/$/, "");
  const REPLAYS = "replays/";
  const $ = (s, r) => (r || document).querySelector(s);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const MINUS = "−";
  const f3 = v => (isNum(v) ? v.toFixed(3) : "—");
  const sg = (v, dp) => (isNum(v) ? (v < -1e-12 ? MINUS : "+") + Math.abs(v).toFixed(dp == null ? 3 : dp) : "—");
  const dcls = d => (!isNum(d) || Math.abs(d) <= 0.0005 ? "flat" : d < 0 ? "faster" : "slower");
  const int = v => (isNum(v) ? Math.round(v).toLocaleString("en-GB") : "—");
  const arrow = s => String(s || "").replace(/->/g, " → ").replace(/; /g, " · ");
  const SIM = "physics lap sim · quasi-steady-state point mass · Silverstone · calibrated to 2026 British GP qualifying";
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
  const RP = (EI.RACEPACE && EI.RACEPACE.silverstone) || null;
  const POLE = RP && RP.pole ? RP.pole.s : 88.111;
  const gridOf = lap => (RP && RP.q && isNum(lap) ? 1 + Object.values(RP.q).filter(x => isNum(x) && x < lap - 1e-9).length : null);
  const BY = { mubit: ["Mubit", "mubit"], mock: ["mock", "amber"], fallback: ["seeded fallback", "muted"], engine: ["engine fallback", "muted"] };

  const S = {
    mode: "replay", index: null, replay: null, runName: null, status: "idle", playing: false, timer: null, pace: 1100, shown: 0,
    decisions: [], nodes: [], baseline: null, peak: null, head: "n0", stats: null, run: null, es: null, info: null, deploy: null, liveOk: false, liveWhy: "",
    view: null, baseDesign: null, team: "redbull", progress: null, error: null, meta: null,
  };

  // ---------------------------------------------------------------- frame
  const root = el("section", { class: "eng2", id: "eng2", "aria-label": "autonomous engineer" });
  const bar = el("div", { class: "e2-bar" });
  const stats = el("div", { class: "e2-stats", id: "e2Stats" });
  const tree = el("section", { class: "panel e2-tree", id: "e2Tree" }, el("div", { class: "ph" }, el("span", { class: "label", text: "Design tree" }), el("span", { class: "src", id: "e2TreeMeta" })), el("div", { class: "e2-svg", id: "e2TreeSvg" }), el("div", { class: "pf src", id: "e2TreeLegend" }));
  const hero = el("section", { class: "panel e2-hero", id: "e2Hero" }, el("div", { class: "e2-view", id: "e2View" }), el("div", { class: "e2-hero-tl", id: "e2HeroTL" }), el("div", { class: "e2-hero-bl src", id: "e2HeroBL" }));
  const chart = el("section", { class: "panel e2-chart" }, el("div", { class: "ph" }, el("span", { class: "label", text: "Peak lap per decision" }), el("span", { class: "src", id: "e2ChartMeta" })), el("div", { class: "e2-svg", id: "e2ChartSvg" }));
  const feed = el("section", { class: "panel e2-feed" }, el("div", { class: "ph" }, el("span", { class: "label", text: "Decisions" }), el("span", { class: "src", text: "the verdict is the physics sim's numbers, never the model's" })), el("div", { class: "e2-cards", id: "e2Cards", "aria-live": "polite" }));
  root.append(bar, stats, el("div", { class: "e2-grid" }, el("div", { class: "e2-col" }, tree), el("div", { class: "e2-col e2-mid" }, hero, chart), el("div", { class: "e2-col" }, feed)));

  // ---------------------------------------------------------------- data
  async function getJson(url, init) { const r = await fetch(url, init); const j = await r.json().catch(() => null); if (!r.ok && !(j && j.ok === false)) throw new Error("HTTP " + r.status); return j; }
  async function loadIndex() {
    try { S.index = await getJson(REPLAYS + "index.json"); } catch (e) { S.index = { runs: [] }; }
    return S.index;
  }
  async function probeLive() {
    try {
      const j = await getJson(API + "/api/concept/engine/info");
      S.info = j && j.data; S.deploy = j && j.deploy || null;
      if (!S.info) { S.liveOk = false; S.liveWhy = "the engine API did not answer"; }
      else if (S.deploy) { S.liveOk = !!(S.deploy.live && S.deploy.live.available && (S.deploy.live.unlocked || S.deploy.live.engine_open)); S.liveWhy = !S.deploy.live.available ? "live calls are off on this deployment: " + (S.deploy.live.off_reason || "") : !(S.deploy.live.unlocked || S.deploy.live.engine_open) ? "unlock first (passcode)" : ""; }
      else { S.liveOk = !!S.info.live_available; S.liveWhy = S.info.mock ? "this server runs with MUBIT_MOCK=1" : !S.info.live_available ? "no MUBIT_API_KEY on this server" : ""; }
      S.apiOk = true;
    } catch (e) { S.apiOk = false; S.liveOk = false; S.liveWhy = "no engine API reachable (" + API + ")"; }
    renderBar();
  }
  const baseOf = team => { const D = EI.concept && EI.concept.design; try { return D ? D.baseline(team && team !== "generic" ? { team } : undefined) : null; } catch (e) { return null; } };
  function designFromDiff(diff) {
    const D = EI.concept && EI.concept.design, b = S.baseDesign; if (!D || !b || !diff) return null;
    try { return D.applyChanges(b, diff.map(([k, v]) => { const [part, param] = k.split("."); return { part, param, to: v }; })).design; } catch (e) { return null; }
  }
  function designFromParams(params) { const b = S.baseDesign; if (!b || !params) return null; return Object.assign(JSON.parse(JSON.stringify(b)), { params: JSON.parse(JSON.stringify(params)) }); }

  // one normalised card per decision (replay v1, replay v2 and live v2 share it)
  function normV1(d) {
    return {
      n: d.decision, by: d.by, request_id: d.mubit_request_id, called: d.called, trained: d.trained, latency_ms: d.latency_ms,
      hypothesis: d.model_answer && d.model_answer.hypothesis, parse_error: d.model_answer && d.model_answer.parse_error, model_change: d.model_change, refused: d.refused,
      measured_change: d.measured_change, search: d.search, best_change: d.best_change, kept: d.kept, legal: d.legal, lap: d.lap_after_s, d_head: d.d_head_s, articles: d.articles,
      new_peak: !!d.new_peak, node: d.node, params: d.params, at: d.at, v: 1,
    };
  }
  function normV2(d, extra) {
    extra = extra || {};
    return {
      n: d.decision, by: d.by, request_id: d.mubit_request_id, called: d.by !== "engine" || !!d.mubit_request_id, trained: d.trained, latency_ms: d.latency_ms, mock: d.mock,
      hypothesis: d.hypothesis, fallback_reason: d.fallback_reason, model_change: d.proposal_change, as_proposed: d.as_proposed, projection: d.projection,
      subspace: d.subspace, screen: d.screen, physics_laps: d.physics_laps, laps_per_s: d.laps_per_s, best_change: d.best_change, best_d: d.best_d_s, interaction: d.interaction,
      kept: d.kept, new_peak: d.new_peak, lap: d.result ? d.result.lap_s : null, d_head: d.d_head_s, node: d.result ? d.result.node : null, reverted: d.reverted, params: d.params || null,
      fullParams: extra.params || null, at: d.at || null, v: 2,
    };
  }

  // ---------------------------------------------------------------- replay
  async function loadReplay(name) {
    stopAll();
    const idx = S.index || await loadIndex();
    const meta = (idx.runs || []).find(r => r.name === name) || (idx.runs || [])[0];
    if (!meta) { S.error = "no recorded run is bundled with this site (concept/lab/replays/)"; renderAll(); return; }
    try { S.replay = await getJson(REPLAYS + meta.file); } catch (e) { S.error = "could not load " + meta.file + ": " + e.message; renderAll(); return; }
    S.mode = "replay"; S.runName = meta.name; S.meta = meta; S.error = null; S.team = S.replay.team || "redbull"; S.baseDesign = baseOf(S.team);
    S.baseline = S.replay.baseline; S.shown = 0; S.status = "ready";
    resetView();
    renderAll();
  }
  function replayStep() {
    const R = S.replay; if (!R || S.shown >= R.decisions.length) { S.playing = false; S.status = "done"; clearTimeout(S.timer); renderAll(); return false; }
    const d = R.decisions[S.shown++];
    const c = R.kind === "engineer-v2" ? normV2(d) : normV1(d);
    addCard(c);
    const node = (R.nodes || []).find(n => n.id === c.node);
    if (node) addNode(Object.assign({}, node, { kept: c.kept }));
    if (R.kind === "engineer-v2") { S.peak = { node: d.peak_after, lap_s: peakLapOf(d.peak_after) }; }
    else if (c.kept && c.new_peak) S.peak = { node: c.node, lap_s: c.lap };
    if (c.kept) S.head = c.node;
    if (c.kept && c.params) showCar(designFromDiff(c.params), c.best_change);
    renderAll();
    return true;
  }
  function peakLapOf(id) { const n = S.nodes.find(x => x.id === id); return n ? n.lap_s : S.baseline && S.baseline.lap_s; }
  function play() {
    if (S.mode !== "replay" || !S.replay) return;
    if (S.status === "done") { S.shown = 0; resetView(); }
    S.playing = true; S.status = "playing";
    const tick = () => { if (!S.playing) return; if (replayStep()) S.timer = setTimeout(tick, S.pace); };
    tick();
  }
  function pause() { S.playing = false; clearTimeout(S.timer); if (S.status === "playing") S.status = "paused"; renderAll(); }
  function skipToEnd() { pause(); while (S.replay && S.shown < S.replay.decisions.length) replayStep(); if (S.replay) { S.status = "done"; renderAll(); } }

  // ---------------------------------------------------------------- live / offline demo
  async function startRun(llm) {
    stopAll();
    S.mode = llm === "live" ? "live" : "mock"; S.status = "starting"; S.error = null; S.team = "redbull"; S.baseDesign = baseOf("redbull"); S.runName = null; S.meta = null; S.replay = null;
    resetView(); renderAll();
    const body = { mode: "engineer", llm, team: "redbull", seed: +(qs.get("seed") || 1), max_calls: llm === "live" ? 20 : 30, variants: 3000, confirm_k: 24 };
    let j;
    try { j = await getJson(API + "/api/concept/engine/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { S.status = "error"; S.error = "the engine API is not reachable (" + API + "): " + e.message; renderAll(); return; }
    if (!j || !j.ok) { S.status = "error"; S.error = (j && j.error && j.error.message) || "the run was refused"; if (j && j.error && j.error.code === "PASSCODE_REQUIRED") S.error += " "; renderAll(); return; }
    S.run = j.data; S.status = "running"; renderAll();
    const url = /^https?:/.test(j.data.stream) ? j.data.stream : API + j.data.stream;
    const es = new EventSource(url); S.es = es;
    const on = (t, f) => es.addEventListener(t, ev => { let d; try { d = JSON.parse(ev.data); } catch (e) { return; } try { f(d); } catch (e) { console.error("engineer panel: " + t + ": " + (e && e.stack || e)); } });
    on("start", d => { if (d.baseline) { S.baseline = d.baseline; } renderAll(); });
    on("request", d => { S.progress = { decision: d.decision, stage: "asking " + (S.mode === "live" ? "Mubit" : "the mock") }; renderBar(); });
    on("proposal", d => { S.progress = { decision: d.decision, stage: "screening the subspace of " + arrow(d.change) }; renderBar(); });
    on("progress", d => { if (d.stage === "screen") { S.progress = { decision: d.decision, stage: "screen " + int(d.done) + " / " + int(d.n) + " variants" }; renderBar(); } });
    on("screen", d => { S.progress = { decision: d.decision, stage: "physics: confirming the best of " + int(d.screen.distinct) + " variants" }; renderBar(); });
    on("decision", d => {
      const c = normV2(d.row, { params: d.peak && d.peak.params });
      addCard(c);
      for (const n of d.nodes || []) addNode(Object.assign({}, n, { kept: c.kept }));
      S.peak = { node: d.peak.node, lap_s: d.peak.lap_s }; S.head = d.head; S.stats = d.stats;
      if (d.peak.params) showCar(designFromParams(d.peak.params), c.best_change);
      renderAll();
    });
    on("final", d => { S.final = d; S.status = "done"; renderAll(); });
    on("error", d => { S.error = d.error || "run error"; renderAll(); });
    es.addEventListener("end", () => { es.close(); if (S.status !== "done") S.status = "done"; S.progress = null; renderAll(); });
    es.onerror = () => { if (es.readyState === 2 && S.status === "running") { S.status = "done"; S.error = S.error || "the stream closed"; renderAll(); } };
  }
  async function stopRun() {
    if (S.run && S.status === "running") { try { await getJson(API + "/api/concept/engine/run/" + S.run.run_id + "/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); } catch (e) { /* the stream ends anyway */ } }
  }
  function stopAll() { pause(); if (S.es) { try { S.es.close(); } catch (e) { /* closed */ } S.es = null; } S.progress = null; }

  // ---------------------------------------------------------------- state helpers
  function resetView() {
    S.decisions = []; S.nodes = [{ id: "n0", parent: null, decision: null, kind: "root", lap_s: S.baseline ? S.baseline.lap_s : null, legal: true, branch: 1, kept: true }];
    S.peak = { node: "n0", lap_s: S.baseline ? S.baseline.lap_s : null }; S.head = "n0"; S.stats = null; S.final = null;
    $("#e2Cards").replaceChildren();
    if (S.view && S.baseDesign) { try { S.view.setDesign(S.baseDesign, { baseline: S.baseDesign, animate: false, livery: S.baseDesign.livery }); S.view.setHighlight([]); } catch (e) { /* view optional */ } }
  }
  function addNode(n) { if (!S.nodes.some(x => x.id === n.id)) S.nodes.push(Object.assign({ branch: 1 }, n)); }
  function addCard(c) { S.decisions.push(c); $("#e2Cards").prepend(card(c)); }
  function showCar(d, change) {
    if (!d || !S.view) return;
    try { S.view.setDesign(d, { baseline: S.baseDesign, animate: true, livery: S.baseDesign && S.baseDesign.livery }); const parts = Array.from(new Set(String(change || "").split("; ").map(s => s.split(".")[0]).filter(Boolean))); S.view.setHighlight(parts); } catch (e) { /* view optional */ }
  }
  // stats for a replay of a v1 run are computed from the cards shown so far; v2 carries the engine's own
  function liveStats() {
    if (S.stats && (S.mode !== "replay" || (S.replay && S.replay.kind === "engineer-v2"))) return S.stats;
    if (S.replay && S.replay.kind === "engineer-v2") { const last = S.replay.decisions[S.shown - 1]; return last && last.stats ? last.stats : S.replay.stats; }
    const g = { mubit: 0, fallback: 0 }, k = { mubit: 0, fallback: 0 }; let laps = 0, calls = 0;
    for (const c of S.decisions) { if (c.called) calls++; if (c.search) laps += c.search.laps || 0; else laps += 1; if (c.kept && isNum(c.d_head)) { g[c.by] = (g[c.by] || 0) - c.d_head; k[c.by] = (k[c.by] || 0) + 1; } }
    const tot = (g.mubit || 0) + (g.fallback || 0);
    return { decisions: S.decisions.length, calls, kept: k.mubit + k.fallback, kept_by: k, gain_s: g, directed_gain_share: tot > 0 ? g.mubit / tot : null, physics_laps: laps, variants_screened: null };
  }

  // ---------------------------------------------------------------- render
  function renderAll() { renderBar(); renderStats(); renderTree(); renderChart(); renderHero(); }
  function renderBar() {
    const runs = (S.index && S.index.runs) || [];
    const sel = el("select", { id: "e2Run", "aria-label": "recorded run", onchange: e => loadReplay(e.target.value) }, runs.map(r => el("option", { value: r.name, selected: r.name === S.runName ? true : null }, r.name + " · " + (r.kind === "engineer-v2" ? "engine v2" : r.kind === "hybrid-v1" ? "engine v1 hybrid" : "designer loop v1") + " · " + r.calls + " calls · " + f3(r.peak_lap_s) + " s")));
    let badge, line;
    if (S.mode === "replay") {
      const R = S.replay, ids = R ? R.request_ids : [];
      badge = el("span", { class: "badge mubit e2-mode", title: "a recorded LIVE run: every call has a real Mubit x-middleware-request-id; the browser plays it back, nothing is re-run" }, "REPLAY");
      line = R ? el("span", { class: "e2-line" }, "replay of a recorded live Mubit run · " + (R.recorded_at ? R.recorded_at.slice(0, 16).replace("T", " ") + " UTC" : "date n/a") + " · " + R.calls + " calls (" + (R.trained ? "trained" : "untrained") + ", " + (R.model || "model n/a") + ") · request ids ", el("code", { title: ids.join("\n") }, (ids[0] || "—") + " … " + (ids[ids.length - 1] || "")), " · " + R.engine) : el("span", { class: "e2-line" }, S.error || "loading the recorded runs…");
    } else if (S.mode === "live") {
      badge = el("span", { class: "badge mubit e2-mode e2-live" }, "LIVE");
      line = el("span", { class: "e2-line" }, "live run · every decision is one Mubit call (designer task, " + (S.run && S.run.trained ? "trained" : "untrained: x-middleware-record: metadata") + ") · " + (S.run ? S.run.run_id : "starting…"));
    } else {
      badge = el("span", { class: "badge amber e2-mode" }, "OFFLINE DEMO");
      line = el("span", { class: "e2-line" }, "offline demo · the proposals come from a SCRIPTED MOCK, not a model; no Mubit call is made · the engine around it is the real one");
    }
    const playing = S.mode === "replay" && S.playing;
    const ctl = el("div", { class: "e2-ctl" },
      S.mode === "replay" ? [sel,
        el("button", { type: "button", class: "btn primary", id: "e2Play", onclick: () => (playing ? pause() : play()) }, playing ? "Pause" : S.status === "done" ? "Replay again" : S.shown ? "Resume" : "Play replay"),
        el("button", { type: "button", class: "btn", title: "show every decision now", onclick: skipToEnd }, "End"),
        el("select", { "aria-label": "replay speed", onchange: e => { S.pace = +e.target.value; } }, [["1600", "1×"], ["700", "2×"], ["250", "6×"]].map(([v, t]) => el("option", { value: v, selected: +v === S.pace ? true : null }, t)))]
        : el("button", { type: "button", class: "btn", onclick: () => loadReplay(S.runName || (runs[0] && runs[0].name)) }, "Back to the replay"),
      S.mode !== "replay" && S.status === "running" ? el("button", { type: "button", class: "btn danger", onclick: stopRun }, "Stop") : null,
      S.liveOk
        ? el("button", { type: "button", class: "btn e2-golive", id: "e2GoLive", title: "start the autonomous engineer now: one live Mubit call per decision (untrained)", disabled: S.status === "running" ? true : null, onclick: () => startRun("live") }, "Go live")
        : el("a", { class: "btn e2-golive off", id: "e2GoLive", href: S.deploy ? "/api/unlock" : "#", title: "live needs " + (S.liveWhy || "the passcode"), onclick: S.deploy ? null : e => e.preventDefault() }, "Go live · " + (S.deploy ? "unlock first" : S.liveWhy || "unavailable")),
      el("button", { type: "button", class: "btn small e2-demo", id: "e2Demo", title: "run the real engine with a scripted mock instead of the model (labelled offline demo)", disabled: !S.apiOk || S.status === "running" ? true : null, onclick: () => startRun("mock") }, "Offline demo (mock)"));
    const prog = S.progress && S.status === "running" ? el("span", { class: "src e2-prog" }, "decision " + S.progress.decision + " · " + S.progress.stage) : S.error ? el("span", { class: "warn e2-prog" }, S.error) : null;
    bar.replaceChildren(...[badge, line, el("span", { class: "spacer" }), prog, ctl].filter(Boolean));
  }
  function chip(name, value, sub, cls, title) { return el("div", { class: "e2-chip " + (cls || ""), title: title || null }, el("span", { class: "label tight" }, name), el("span", { class: "v num" }, value), sub ? el("span", { class: "src" }, sub) : null); }
  function renderStats() {
    const st = liveStats() || {}, base = S.baseline ? S.baseline.lap_s : null, pk = S.peak ? S.peak.lap_s : null;
    const share = st.directed_gain_share;
    const v1 = S.replay && S.replay.kind !== "engineer-v2" && S.mode === "replay";
    stats.replaceChildren(
      chip("peak lap", f3(pk) + " s", "Δ baseline " + sg(isNum(pk) && isNum(base) ? pk - base : null) + " · pole " + sg(isNum(pk) ? pk - POLE : null) + " · P" + (gridOf(pk) || "—"), "e2-pk", "the fastest legal car of the run on the " + SIM + "; pole = the real 2026 British GP pole " + POLE + " s"),
      chip("decisions", int(st.decisions), int(st.calls) + " Mubit calls" + (S.mode === "mock" ? " (mock)" : "")),
      chip("kept gains directed by " + (S.mode === "mock" ? "the mock" : "Mubit"), isNum(share) ? Math.round(share * 100) + " %" : "—", v1 ? "engine v1: the rest came from its seeded fallback" : "the rest: engine fallback after parse / LLM errors", isNum(share) ? (share >= 0.5 ? "good" : "bad") : "", "share of the lap time gained by kept decisions whose direction the model chose (seconds, not counts)"),
      chip("cars measured", int(st.cars_measured != null ? st.cars_measured : st.physics_laps), "physics laps (FIA-checked)"),
      chip("variants screened", st.variants_screened != null ? int(st.variants_screened) : v1 ? "n/a" : "—", v1 ? "engine v1 had no surrogate screen" : "surrogate ranking only, never a reported lap"),
      chip("speed", st.variants_per_s != null ? int(st.variants_per_s) + " /s" : v1 ? "n/a" : "—", st.laps_per_s != null ? st.laps_per_s + " physics laps/s" : "variants / s · physics laps / s (measured)"),
      chip("reverts · forks", st.reverts != null ? st.reverts + " · " + st.forks : "—", st.branches != null ? st.branches + " branches" : v1 ? "engine v1 had no tree" : ""),
    );
  }
  // tree: x = decision, y = physics lap (faster = higher), colour = branch; edges = decisions (parent car -> measured car), the kept
  // chain bold, reverts / forks marked where the new branch starts; illegal results sit on the bottom strip
  const HUES = ["#b26cff", "#4ade80", "#38bdf8", "#f472b6", "#fbbf24", "#a3e635", "#fb923c", "#22d3ee"];
  const hue = b => HUES[((b || 1) - 1) % HUES.length];
  function renderTree() {
    const host = $("#e2TreeSvg"), W = Math.max(240, host.clientWidth || 300), H = Math.max(160, host.clientHeight || 300);
    const nodes = S.nodes, N = Math.max(4, ...S.decisions.map(c => c.n), 1);
    const laps = nodes.filter(n => n.legal && isNum(n.lap_s)).map(n => n.lap_s), base = S.baseline && isNum(S.baseline.lap_s) ? S.baseline.lap_s : Math.max(...laps, 89);
    const lo = Math.min(...laps, base) - 0.05, hi = Math.min(Math.max(...laps, base), base + 0.6) + 0.05;
    const padL = 40, padR = 14, top = 12, ill = 16, bottom = H - 22;
    const X = n => padL + ((n.decision || 0) / N) * (W - padL - padR);
    const Y = n => (!n.legal || !isNum(n.lap_s) ? bottom : top + (Math.min(n.lap_s, hi) - lo) / (hi - lo) * (bottom - ill - top));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const g = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "design tree: " + nodes.length + " cars" });
    // lap axis
    const step = (hi - lo) > 1.2 ? 0.5 : (hi - lo) > 0.5 ? 0.2 : 0.1;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const y = top + (v - lo) / (hi - lo) * (bottom - ill - top); g.append(sv("line", { x1: padL - 4, x2: W - padR, y1: y, y2: y, class: "e2-grid-l" }), sv("text", { x: padL - 6, y: y + 3, class: "e2-axis", "text-anchor": "end", text: v.toFixed(1) })); }
    if (POLE >= lo && POLE <= hi) { const y = top + (POLE - lo) / (hi - lo) * (bottom - ill - top); g.append(sv("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "e2-pole" }), sv("text", { x: W - padR, y: y - 3, class: "e2-axis", "text-anchor": "end", text: "real pole " + POLE })); }
    g.append(sv("text", { x: padL - 6, y: bottom + 3, class: "e2-axis", "text-anchor": "end", text: "illegal" }), sv("text", { x: padL, y: H - 6, class: "e2-axis", text: "decision →" }), sv("text", { x: 2, y: top + 2, class: "e2-axis", text: "s ↑ faster" }));
    for (const n of nodes) {
      const p = n.parent ? byId.get(n.parent) : null; if (!p) continue;
      const x1 = X(p), y1 = Y(p), x2 = X(n), y2 = Y(n), cross = (p.branch || 1) !== (n.branch || 1);
      g.append(sv("path", { d: "M" + x1 + "," + y1 + " C" + (x1 + x2) / 2 + "," + y1 + " " + (x1 + x2) / 2 + "," + y2 + " " + x2 + "," + y2, class: "e2-edge" + (n.kept ? " kept" : "") + (cross ? " fork" : ""), style: n.kept ? "stroke:" + hue(n.branch) : null }));
    }
    let ri = 0;
    for (const c of S.decisions) if (c.reverted) {
      const to = byId.get(c.reverted.to); if (!to) continue;
      const x = padL + (c.n / N) * (W - padL - padR), ty = bottom - ill - 4 - (ri++ % 4) * 11;
      g.append(sv("line", { x1: x, x2: x, y1: top, y2: bottom - ill + 4, class: "e2-revl" }), sv("text", { x: Math.min(W - 70, x + 3), y: ty, class: "e2-rev", text: (c.reverted.kind === "revert" ? "↩ revert" : c.reverted.kind === "fork" ? "⑂ fork" : "↻ restart") + " → " + c.reverted.to }));
    }
    for (const n of nodes) {
      const isPeak = S.peak && n.id === S.peak.node, isHead = n.id === S.head;
      const r = n.kind === "root" ? 5 : n.kept ? 4.5 : 3;
      const cls = "e2-node" + (n.kind === "root" ? " root" : "") + (n.kept ? " kept" : "") + (!n.legal ? " illegal" : "") + (n.by ? " by-" + n.by : "");
      const t = sv("title", { text: (n.kind === "root" ? "baseline" : "decision " + n.decision + " · " + (n.by || "") + " · branch " + (n.branch || 1)) + " · " + (n.legal ? f3(n.lap_s) + " s" : "illegal") + (n.kept ? " · kept" : "") + (isPeak ? " · PEAK" : "") + (isHead ? " · head" : "") });
      g.append(sv("circle", { cx: X(n), cy: Y(n), r, class: cls, style: n.kept && n.kind !== "root" && n.by !== "fallback" && n.by !== "engine" ? "fill:" + hue(n.branch) + ";stroke:" + hue(n.branch) : null }, t));
      if (isPeak) { g.append(sv("circle", { cx: X(n), cy: Y(n), r: r + 4, class: "e2-peak" })); g.append(sv("text", { x: Math.max(padL, Math.min(W - 80, X(n) - 30)), y: Y(n) - 10, class: "e2-peaklbl", text: "peak " + f3(n.lap_s) })); }
      if (isHead && !isPeak) g.append(sv("circle", { cx: X(n), cy: Y(n), r: r + 3, class: "e2-head" }));
    }
    host.replaceChildren(g);
    const st = liveStats() || {}, nb = new Set(nodes.map(n => n.branch || 1)).size;
    $("#e2TreeMeta").textContent = nodes.length - 1 + " result cars · " + nb + " branch" + (nb === 1 ? "" : "es") + (st.cars_measured ? " · " + int(st.cars_measured) + " cars measured in all" : "");
    $("#e2TreeLegend").replaceChildren(
      el("span", { class: "lg kept" }, "● kept (head moved)"), " ", el("span", { class: "lg" }, "○ not kept"), " ", el("span", { class: "lg fb" }, "● kept by a fallback step"), " ", el("span", { class: "lg ill" }, "● illegal"), " ", el("span", { class: "lg peak" }, "◎ peak"), " · colour = branch · ↩ revert / ⑂ fork: the engine abandoned a branch after 3 decisions without a kept car · y: " + SIM);
  }
  function renderChart() {
    const host = $("#e2ChartSvg"), W = Math.max(240, host.clientWidth || 400), H = Math.max(90, host.clientHeight || 140);
    const base = S.baseline ? S.baseline.lap_s : null; if (!isNum(base)) { host.replaceChildren(); return; }
    const pts = [[0, base]]; let pk = base; const heads = [[0, base]]; let hd = base;
    for (const c of S.decisions) { if (c.kept && isNum(c.lap)) { hd = c.lap; if (c.lap < pk) pk = c.lap; } pts.push([c.n, pk]); heads.push([c.n, hd]); }
    const N = Math.max(4, pts[pts.length - 1][0]), lo = Math.min(pk, POLE) - 0.1, hi = base + 0.1, pad = 26;
    const X = n => pad + n / N * (W - pad - 8), Y = v => 8 + (v - lo) / (hi - lo) * (H - 22);
    const step = a => a.map(([n, v], i) => (i ? "H" + X(n) + "V" + Y(v) : "M" + X(n) + "," + Y(v))).join("");
    const g = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "peak lap per decision" },
      sv("line", { x1: pad, x2: W - 8, y1: Y(POLE), y2: Y(POLE), class: "e2-pole" }), sv("text", { x: W - 10, y: Y(POLE) - 3, class: "e2-axis", "text-anchor": "end", text: "real pole " + POLE }),
      sv("line", { x1: pad, x2: W - 8, y1: Y(base), y2: Y(base), class: "e2-base" }), sv("text", { x: pad + 2, y: Y(base) - 3, class: "e2-axis", text: "baseline " + f3(base) }),
      sv("path", { d: step(heads), class: "e2-headline" }), sv("path", { d: step(pts), class: "e2-peakline" }));
    host.replaceChildren(g);
    $("#e2ChartMeta").textContent = "peak (solid) and branch head (dotted) · " + SIM;
  }
  function renderHero() {
    const pk = S.peak ? S.peak.lap_s : null, base = S.baseline ? S.baseline.lap_s : null;
    $("#e2HeroTL").replaceChildren(
      el("div", { class: "label" }, "peak car · " + (S.peak ? S.peak.node : "n0")),
      el("div", { class: "e2-big num" }, f3(pk), el("small", null, " s")),
      el("div", { class: "src" }, "Δ baseline ", el("span", { class: "delta " + dcls(isNum(pk) && isNum(base) ? pk - base : null) }, sg(isNum(pk) && isNum(base) ? pk - base : null)), " · to pole ", el("span", { class: "delta " + dcls(isNum(pk) ? pk - POLE : null) }, sg(isNum(pk) ? pk - POLE : null))),
    );
    $("#e2HeroBL").textContent = (S.team === "generic" ? "generic 2026 baseline" : "Red Bull RB22 · DM01 baseline") + " · model prediction, not a real car's lap · " + SIM;
  }
  function card(c) {
    const [byName, byCls] = BY[c.by] || [c.by, "muted"];
    const head = el("div", { class: "e2-ch" },
      el("span", { class: "num e2-n" }, "#" + c.n),
      el("span", { class: "badge sm " + byCls, title: c.by === "fallback" ? "engine v1: Mubit's proposal was refused or the model paused; a seeded random step was measured instead" : c.by === "engine" ? "engine v2: the model's answer did not parse (or the call failed); the engine chose this direction itself" : "the model chose this direction" }, byName),
      c.request_id ? el("code", { class: "e2-rid", title: "x-middleware-request-id (Mubit)" }, c.request_id) : el("span", { class: "src" }, c.called === false ? "no call (model paused)" : ""),
      c.request_id ? el("span", { class: "src" }, (c.trained ? "trained" : "untrained") + (isNum(c.latency_ms) ? " · " + (c.latency_ms / 1000).toFixed(1) + " s" : "")) : null,
      el("span", { class: "spacer" }),
      el("span", { class: "badge sm " + (c.kept ? "green" : c.reverted ? "amber" : "") }, c.kept ? (c.new_peak ? "kept · new peak" : "kept") : c.reverted ? c.reverted.kind : "not kept"));
    const rows = [];
    if (c.hypothesis) rows.push(el("div", { class: "e2-hyp" }, "“" + c.hypothesis + "”"));
    if (c.parse_error) rows.push(el("div", { class: "src warn" }, "model answer did not parse: " + c.parse_error));
    if (c.model_change) rows.push(kv("proposed", arrow(c.model_change)));
    if (c.v === 1) {
      if (c.refused) rows.push(kv("refused", c.refused + " → the v1 engine discarded it and measured a seeded random step instead", "warn"));
      if (c.search) rows.push(kv("search", int(c.search.laps) + " physics laps around " + arrow(c.measured_change).slice(0, 80) + " (" + c.search.scope + ")"));
    } else {
      if (c.fallback_reason) rows.push(kv("fallback", c.fallback_reason, "warn"));
      if (c.as_proposed) rows.push(kv("as proposed", c.as_proposed.legal ? sg(c.as_proposed.d_lap_s) + " s" : "illegal " + (c.as_proposed.articles || []).join(" "), c.as_proposed.legal ? dcls(c.as_proposed.d_lap_s) : "warn"));
      if (c.projection) rows.push(kv(c.projection.repaired ? "repaired" : "projected", arrow(c.projection.change) + (isNum(c.projection.d_lap_s) ? " · " + sg(c.projection.d_lap_s) + " s" : "")));
      if (c.subspace) rows.push(kv("subspace", c.subspace.dims + " params (" + c.subspace.proposed.length + " proposed + " + c.subspace.coupled.length + " coupled" + (c.subspace.discrete && c.subspace.discrete.length ? ", " + c.subspace.discrete.length + " discrete" : "") + ")", null, c.subspace.text));
      if (c.screen) rows.push(kv("screened", int(c.screen.distinct) + " variants · " + int(c.screen.legal) + " legal · " + int(c.screen.oob) + " outside the surrogate · " + int(c.screen.per_s) + "/s"));
      if (c.physics_laps) rows.push(kv("confirmed", int(c.physics_laps) + " physics laps" + (c.laps_per_s ? " · " + c.laps_per_s + "/s" : "")));
      if (c.interaction && isNum(c.interaction.term_s)) rows.push(kv("interaction", sg(c.interaction.term_s) + " s (together " + sg(c.interaction.together_d_s) + " vs Σ alone " + sg(c.interaction.sum_alone_d_s) + ": " + c.interaction.groups.map(g => g.group).join(" + ") + ")", dcls(c.interaction.term_s)));
      else if (c.interaction && c.interaction.note) rows.push(kv("interaction", c.interaction.note, "muted"));
    }
    if (c.best_change) rows.push(kv("best found", arrow(c.best_change).slice(0, 160)));
    rows.push(kv("result", c.legal === false ? "illegal " + (c.articles || []).join(" ") : isNum(c.lap) ? f3(c.lap) + " s · " + sg(c.d_head) + " vs head" : "no legal car", c.legal === false ? "warn" : dcls(c.d_head)));
    if (c.reverted) rows.push(kv(c.reverted.kind, "branch " + c.reverted.abandoned.branch + " (" + c.reverted.abandoned.parts.join(" + ") + ", " + c.reverted.abandoned.decisions + " decisions, best " + sg(c.reverted.abandoned.best_d_s) + " s) abandoned → " + c.reverted.to, "warn"));
    return el("article", { class: "e2-card" + (c.kept ? " kept" : "") + (c.by === "fallback" || c.by === "engine" ? " fb" : "") }, head, rows);
  }
  function kv(k, v, cls, title) { return el("div", { class: "e2-kv", title: title || null }, el("span", { class: "k" }, k), el("span", { class: "v " + (cls || "") }, v)); }

  // ---------------------------------------------------------------- 3D (EI.conceptView public API only)
  function mountView() {
    if (S.view || !EI.conceptView || typeof EI.conceptView.mount !== "function") { if (!EI.conceptView) $("#e2View").replaceChildren(el("div", { class: "empty" }, "3D view not loaded")); return; }
    const b = S.baseDesign || baseOf("redbull"); if (!b) return;
    try { S.view = EI.conceptView.mount($("#e2View"), { baseline: b, design: b, parts: EI.concept && EI.concept.parts, mode: "solid", label: false, legend: false, livery: b.livery }); } catch (e) { S.view = null; $("#e2View").replaceChildren(el("div", { class: "empty" }, "3D view error: " + (e.message || e))); }
  }

  // ---------------------------------------------------------------- view switch: this panel is the "Design tree" view (?view=tree); the
  // default view is the Mubit-first layout (concept/lab/mubit-first.js), which also sets the header buttons' pressed state
  function setView(v) {
    const eng = v === "eng";
    const was = document.body.classList.contains("eng2-on");
    document.body.classList.toggle("eng2-on", eng);
    if (eng) { mountView(); requestAnimationFrame(renderAll); if (!was && S.mode === "replay" && S.replay && !S.shown && qs.get("autoplay") !== "0") play(); }
    else { pause(); window.dispatchEvent(new Event("resize")); }
  }
  async function boot() {
    const main = $("#clab"); if (!main) return;
    main.parentNode.insertBefore(root, main);
    const a = $("#btnViewEng");
    if (a) a.addEventListener("click", () => setView("eng"));
    for (const id of ["#btnViewNoAI", "#btnViewMubit", "#btnViewExam"]) { const b = $(id); if (b) b.addEventListener("click", () => setView("off")); }
    S.baseDesign = baseOf("redbull");
    const tree = qs.get("view") === "tree";
    if (tree) setView("eng");
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (document.body.classList.contains("eng2-on")) { renderTree(); renderChart(); } }); ro.observe($("#e2TreeSvg")); ro.observe($("#e2ChartSvg")); }
    await loadIndex();
    await loadReplay(qs.get("replay") || ((S.index.runs || [])[0] || {}).name);
    probeLive();
    if (tree && qs.get("autoplay") !== "0" && document.body.classList.contains("eng2-on")) { if (qs.get("autoplay") === "end") skipToEnd(); else play(); }
  }
  // test / demo hook
  EI.engineerPanel = { state: () => ({ mode: S.mode, status: S.status, run: S.runName, shown: S.shown, decisions: S.decisions.length, nodes: S.nodes.length, peak: S.peak, stats: liveStats(), liveOk: S.liveOk, liveWhy: S.liveWhy }), play, pause, skipToEnd, loadReplay, startRun, setView };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
