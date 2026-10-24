// PURPLE CONCEPT LAB - the MUBIT-FIRST view (the default view of the lab and of the site root). The owner's preferred layout (the speed
// run's: live Silverstone board, the 3D RB22 with its last kept change, the progress chart, "How different is it?", the car sheet) driven
// by the autonomous engineer (engine v2) and Mubit instead of the no-AI optimiser:
//   REPLAY (default, any visitor): plays back a RECORDED LIVE Mubit run (newest trained-corrections run in concept/demo/replays, else
//          concept/lab/replays); real x-middleware-request-id values; nothing is re-run. Labelled "replay of a recorded live Mubit run".
//   LIVE   (Go live; no passcode on the site for the engine, PURPLE_OPEN_LIVE): POST /api/concept/engine/run { mode: "engineer",
//          llm: "live", record_good: true, max_calls: 12 | 40 | 120 } - the same server call as concept/demo - and follow its SSE stream.
//          Every designer call is untrained (x-middleware-record: metadata); a decision whose idea, exactly as proposed, is legal and
//          faster on the physics lap sim is re-sent BY THE SERVER as the identical trained call (concept/engineer/record-good.js).
//   OFFLINE DEMO (small button): the same engine with the scripted mock; labelled "not a model". The browser never calls Mubit.
// The layout itself is drawn by concept-lab.js (EI.conceptLab.mubit); this file owns the Mubit strip, the run controls and the Mubit
// feed cards. Every number carries its source label (G-HON-01); scores as n/N. Tokens: lab/lab.css (docs/DESIGN_SYSTEM.md).
(function () {
  // ---------------------------------------------------------------- the one place to update the Mubit numbers (integrator)
  const MUBIT = {
    model: [
      ["v1", "98 examples · Mubit test 5/19, not passed"],
      ["v2", "2,609 physics-approved examples sent"],
    ],
    model_source: "Mubit console, 24 Oct",
    // docs/concept/loop-runs/trained-harvest: good.jsonl rows (test/mubit-first.test.js checks the count)
    harvest: { examples: 2609, decisions: 31285, source: "harvest runs, 24 Oct (docs/concept/loop-runs/trained-harvest, trained-harvest-2)" },
  };
  const LIVE_CHOICES = [12, 40, 120];
  const MODEL_NAME = "Claude Haiku 4.5";

  const EI = (window.EI = window.EI || {});
  const C = EI.concept || {};
  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || "http://127.0.0.1:8787").replace(/\/$/, "");
  const $ = s => document.querySelector(s);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const MINUS = "−";
  const sg = (v, dp) => (isNum(v) ? (v < -1e-12 ? MINUS : "+") + Math.abs(v).toFixed(dp == null ? 3 : dp) : "—");
  const int = v => (isNum(v) ? Math.round(v).toLocaleString("en-GB") : "—");
  const secs = ms => (isNum(ms) ? (ms / 1000).toFixed(1) + " s" : "—");
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

  const S = {
    view: "mubit", mode: "replay", runs: [], replay: null, meta: null, shown: 0, playing: false, timer: null, pace: 1000, status: "idle", error: null,
    cards: [], calls: 0, examples: 0, total: 12, run: null, es: null, progress: null, liveOk: false, liveWhy: "", deploy: null, apiOk: false, liveN: 12,
    best: null, baseDesign: null,
  };
  const L = () => EI.conceptLab && EI.conceptLab.mubit;

  // ---------------------------------------------------------------- plain words (the same wording as the demo page, concept/demo/demo.js)
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
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const when = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + iso.slice(11, 16) + " UTC"; };
  const runLabel = r => r.name.replace(/^trained-/, "").replace(/-seed(\d+)$/, " · seed $1");
  const shortId = id => (id ? id.slice(0, 9) + "…" + id.slice(-6) : "");
  const approved = c => !!(c.by === "mubit" && c.as && c.as.legal === true && isNum(c.as.d_lap_s) && c.as.d_lap_s < -0.0005);

  // ---------------------------------------------------------------- data
  async function getJson(url, init) { const r = await fetch(url, init); const j = await r.json().catch(() => null); if (!r.ok && !(j && j.ok === false)) throw new Error("HTTP " + r.status); return j; }
  // every recorded engine v2 run bundled with the site, newest first; the default is the newest trained-corrections run
  async function listRuns() {
    const out = [];
    for (const dir of ["../demo/replays/", "replays/"]) {
      try {
        const idx = await getJson(dir + "index.json");
        for (const r of (idx && idx.runs) || []) if (r.kind === "engineer-v2" && !out.some(x => x.name === r.name)) out.push(Object.assign({ dir }, r));
      } catch (e) { /* next */ }
    }
    out.sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
    S.runs = out;
    return out;
  }
  const defaultRun = () => S.runs.find(r => r.name === qs.get("replay")) || S.runs.find(r => /corrections/.test(r.name)) || S.runs[0];
  const baseOf = () => { try { return C.design ? C.design.baseline({ team: "redbull" }) : null; } catch (e) { return null; } };
  function designFromDiff(diff) {
    const D = C.design, b = S.baseDesign; if (!D || !b || !diff) return null;
    try { return D.applyChanges(b, diff.map(([k, v]) => { const [part, param] = k.split("."); return { part, param, to: v }; })).design; } catch (e) { return null; }
  }
  function designFromParams(params) { const b = S.baseDesign; if (!b || !params) return null; const d = C.design.clone ? C.design.clone(b) : JSON.parse(JSON.stringify(b)); d.params = JSON.parse(JSON.stringify(params)); return d; }

  // one card per decision (replay and live share it)
  function norm(d, train) {
    return {
      n: d.decision, by: d.by, id: d.mubit_request_id || null, trained: !!d.trained, latency_ms: d.latency_ms, hypothesis: d.hypothesis || null, fallback: d.fallback_reason || null,
      change: d.proposal_change || null, as: d.as_proposed || null, kept: !!d.kept, new_peak: !!d.new_peak, d_head: d.d_head_s, best_d: d.best_d_s,
      lap: d.result ? d.result.lap_s : null, versions: d.screen ? d.screen.distinct : null, laps: d.physics_laps, train: train || null, trainedId: null, el: null,
    };
  }
  function timingOf(d) {
    if (!d || !isNum(d.latency_ms)) return null;
    const parts = [S.mode === "mock" ? "stand-in " + secs(d.latency_ms) : "Mubit " + secs(d.latency_ms)];
    if (d.screen && isNum(d.screen.distinct)) parts.push(int(d.screen.distinct) + " versions tested in " + secs(d.screen.ms));
    if (isNum(d.physics_laps)) parts.push(int(d.physics_laps) + " physics laps in " + secs(d.physics_ms));
    return { parts, title: "Mubit decision #" + d.decision + ", timed by the engine: the " + (S.mode === "mock" ? "scripted stand-in" : "Mubit call (" + MODEL_NAME + ")") + ", the quick test of every version of the idea, then full physics laps on the best ones" };
  }
  function push(d, opts) {
    const c = norm(d, opts.train);
    S.cards.push(c);
    const lab = L(); if (!lab) return c;
    lab.add({ n: c.n, kept: c.kept, legal: !(d.result && d.result.legal === false), lap: c.lap, peakLap: opts.peakLap, design: opts.design || null, change: c.kept ? d.best_change : null, card: c, timing: timingOf(d) });
    return c;
  }

  // ---------------------------------------------------------------- replay
  async function loadReplay(name) {
    stopAll();
    if (!S.runs.length) await listRuns();
    const meta = S.runs.find(r => r.name === name) || defaultRun();
    S.mode = "replay"; S.error = null;
    if (!meta) { S.error = "no recorded run is bundled with this site"; renderAll(); return; }
    try { S.replay = await getJson(meta.dir + meta.file); } catch (e) { S.error = "could not load the recorded run: " + e.message; renderAll(); return; }
    S.meta = meta; S.status = "ready";
    resetRun(S.replay.decisions.length);
    renderAll();
  }
  function replayStep() {
    const R = S.replay; if (!R || S.shown >= R.decisions.length) { S.playing = false; S.status = "done"; clearTimeout(S.timer); renderAll(); return false; }
    const d = R.decisions[S.shown++];
    const peak = (R.nodes || []).find(x => x.id === d.peak_after), peakLap = peak && isNum(peak.lap_s) ? peak.lap_s : null;
    const newBest = isNum(peakLap) && (!isNum(S.best) || peakLap < S.best - 1e-9);
    if (newBest) S.best = peakLap;
    const c = norm(d);
    push(d, { train: d.trained ? "recorded" : approved(c) ? "approved-untrained" : "untrained", peakLap, design: newBest && d.result && d.peak_after === d.result.node ? designFromDiff(d.params) : null });
    if (d.mubit_request_id) S.calls++;
    renderStrip();
    return true;
  }
  function play() {
    if (S.mode !== "replay" || !S.replay) return;
    if (S.status === "done") resetRun(S.replay.decisions.length);
    S.playing = true; S.status = "playing"; setLabStatus();
    const tick = () => { if (!S.playing) return; if (replayStep()) S.timer = setTimeout(tick, S.pace); };
    tick(); renderCtl();
  }
  function pause() { S.playing = false; clearTimeout(S.timer); if (S.status === "playing") S.status = "paused"; setLabStatus(); renderCtl(); }
  function skipToEnd() { pause(); while (S.replay && S.shown < S.replay.decisions.length) replayStep(); if (S.replay) { S.status = "done"; renderAll(); } }

  // ---------------------------------------------------------------- live (record_good) / offline demo
  async function startRun(llm) {
    stopAll();
    const n = llm === "live" ? S.liveN : Math.min(S.liveN, 40);
    S.mode = llm === "live" ? "live" : "mock"; S.status = "starting"; S.error = null; S.replay = null; S.meta = null;
    resetRun(n); renderAll();
    const body = llm === "live"
      ? { mode: "engineer", llm: "live", record_good: true, confirm: "trained", confirm_text: "TRAIN " + n, max_calls: n, team: "redbull", seed: +(qs.get("seed") || Math.floor(Math.random() * 1000)), variants: 3000, confirm_k: 24 }
      : { mode: "engineer", llm: "mock", team: "redbull", seed: +(qs.get("seed") || 1), max_calls: n, variants: 3000, confirm_k: 24 };
    let j;
    try { j = await getJson(API + "/api/concept/engine/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { S.status = "error"; S.error = "the engine API is not reachable (" + API + "): " + e.message; renderAll(); return; }
    if (!j || !j.ok) { S.status = "error"; S.error = (j && j.error && j.error.message) || "the run was refused"; renderAll(); return; }
    S.run = j.data; S.status = "running"; renderAll();
    const es = new EventSource(/^https?:/.test(j.data.stream) ? j.data.stream : API + j.data.stream); S.es = es;
    const on = (t, f) => es.addEventListener(t, ev => { let d; try { d = JSON.parse(ev.data); } catch (e) { return; } try { f(d); } catch (e) { console.error("mubit-first: " + t + ": " + (e && e.stack || e)); } });
    on("request", d => setProgress(d.decision, S.mode === "live" ? "asking Mubit…" : "asking the stand-in…"));
    on("proposal", d => setProgress(d.decision, (S.mode === "live" ? "Mubit proposes " : "the stand-in proposes ") + plainChange(d.change, 2)));
    on("progress", d => { if (d.stage === "screen") setProgress(d.decision, "testing " + int(d.done) + " versions of the idea"); });
    on("screen", d => setProgress(d.decision, int(d.screen.distinct) + " versions tested · full physics laps on the best"));
    on("decision", d => {
      const peakLap = d.peak && isNum(d.peak.lap_s) ? d.peak.lap_s : null, newBest = isNum(peakLap) && (!isNum(S.best) || peakLap < S.best - 1e-9);
      if (newBest) S.best = peakLap;
      S.calls = isNum(d.calls) ? d.calls : S.calls + 1;
      push(d.row, { train: S.mode !== "live" ? "mock" : d.training_example === "pending" ? "pending" : "rejected", peakLap, design: newBest && d.peak.params ? designFromParams(d.peak.params) : null });
      S.progress = null; renderStrip(); renderProgress();
    });
    on("training_example", d => {
      const c = S.cards.find(x => x.n === d.decision); if (!c) return;
      if (d.error) { c.train = "failed"; c.trainErr = d.error; } else { c.train = "trained"; c.trainedId = d.trained_request_id; c.same = d.same_answer; S.examples = isNum(d.trained_examples) ? d.trained_examples : S.examples + 1; }
      if (c.el && c.el.parentNode) c.el.replaceWith(card({ mubit: c }));
      renderStrip();
    });
    on("final", d => { S.status = "done"; S.progress = null; if (isNum(d.trained_examples)) S.examples = d.trained_examples; renderAll(); });
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
      else if (S.deploy) { S.liveOk = !!(S.deploy.live && S.deploy.live.available && (S.deploy.live.unlocked || S.deploy.live.engine_open)); S.liveWhy = !S.deploy.live.available ? "live calls are off on this deployment" : !(S.deploy.live.unlocked || S.deploy.live.engine_open) ? "unlock first" : ""; }
      else { S.liveOk = !!info.live_available; S.liveWhy = info.mock ? "this server runs with MUBIT_MOCK=1" : !info.live_available ? "no MUBIT_API_KEY on this server" : ""; }
    } catch (e) { S.apiOk = false; S.liveOk = false; S.liveWhy = "no engine API reachable"; }
    renderCtl();
  }

  // ---------------------------------------------------------------- state
  function resetRun(total) {
    S.cards = []; S.shown = 0; S.calls = 0; S.examples = 0; S.total = total; S.best = null;
    const lab = L(); if (lab) { lab.reset({ total, status: S.status }); lab.set({ feedCard: card, feedNote: feedNote(), emptyText: emptyText(), who: S.mode === "mock" ? "stand-in" : "Mubit" }); }
  }
  function setLabStatus() { const lab = L(); if (lab) lab.set({ status: S.status === "playing" || S.status === "running" ? "playing" : S.status }); }
  const feedNote = () => (S.mode === "mock" ? "scripted stand-in, not a model · verdict: physics lap sim" : "ideas: " + MODEL_NAME + " through Mubit · verdict: physics lap sim");
  const emptyText = () => (S.mode === "replay" ? "Press Play: each card is one Mubit call. Claude proposes a change to the car, the physics lap sim tests it as proposed, then the engine tests thousands of versions of the idea and keeps only what is faster." : S.mode === "live" ? "Asking Mubit for the first idea…" : "Asking the scripted stand-in (not a model) for the first idea…");

  // ---------------------------------------------------------------- render
  function renderAll() { renderStrip(); renderCtl(); renderProgress(); const lab = L(); if (lab) lab.set({ feedNote: feedNote(), emptyText: emptyText() }); setLabStatus(); }
  function counter(cls, value, label, sub, title) {
    return el("div", { class: "mu-ctr " + (cls || ""), title: title || null }, el("div", { class: "mu-ctr-top" }, el("span", { class: "mu-ctr-v num" }, value), el("span", { class: "mu-ctr-l" }, label)), sub ? el("div", { class: "src mu-ctr-s" }, sub) : null);
  }
  function renderStrip() {
    const host = $("#muStrip"); if (!host) return;
    const n = S.cards.length, ok = S.cards.filter(approved).length;
    const calls = S.mode === "mock" ? 0 : S.mode === "live" ? S.calls + S.examples : S.calls;
    const R = S.replay;
    let modeBadge, modeLine;
    if (S.mode === "replay") {
      const ids = R ? R.request_ids || [] : [];
      modeBadge = el("span", { class: "badge mu-badge replay", title: "a recorded LIVE run: every call has a real Mubit x-middleware-request-id; played back here, nothing is re-run" }, "REPLAY");
      modeLine = el("span", { class: "mu-line", title: R ? R.calls + " Mubit calls · " + (R.model || "") + " · request ids " + ids[0] + " … " + ids[ids.length - 1] : "" }, R ? "recorded live run" + (R.recorded_at ? " · " + when(R.recorded_at) : "") : S.error || "loading the recorded run…");
    } else if (S.mode === "live") {
      modeBadge = el("span", { class: "badge mu-badge live" }, "LIVE");
      modeLine = el("span", { class: "mu-line", title: S.run ? S.run.run_id : "" }, S.status === "error" ? "" : "live run · " + S.total + " Mubit calls");
    } else {
      modeBadge = el("span", { class: "badge amber mu-badge" }, "OFFLINE DEMO");
      modeLine = el("span", { class: "mu-line warn" }, "scripted stand-in, not a model · no Mubit call");
    }
    const total = S.mode === "replay" && R ? R.decisions.length : S.total;
    const callsSub = S.mode === "mock" ? "offline demo: nothing is sent to Mubit"
      : S.mode === "live" ? MODEL_NAME + " · one per decision" + (S.examples ? " + " + S.examples + " trained re-send" + (S.examples === 1 ? "" : "s") : "") + " · of " + S.total
      : MODEL_NAME + " · one per decision · " + n + " / " + total + " played";
    const exV = S.mode === "live" ? String(S.examples) : S.mode === "mock" ? "0" : ok + " / " + n;
    const exSub = S.mode === "live" ? "this run: of " + ok + " physics-approved ideas, re-sent by the server as trained calls"
      : S.mode === "mock" ? "offline demo: nothing is sent to Mubit"
      : "this run: ideas the physics lap sim approved as proposed · this recorded run trained every call";
    host.replaceChildren(
      el("div", { class: "mu-mark", title: "Mubit: the gateway every designer call goes through; it records calls and trains on the kept examples" }, el("span", { class: "mu-logo" }, "Mubit"), el("span", { class: "mu-mode" }, modeBadge, modeLine)),
      counter("mubit", int(calls), "Mubit calls · this run", callsSub, "designer calls sent through Mubit in this run (live: plus the trained re-sends)"),
      el("div", { class: "mu-ctr good", title: "an idea counts as approved when the model's change, exactly as proposed, is legal and faster on the physics lap sim; only those become Mubit training examples" },
        el("div", { class: "mu-ctr-top" }, el("span", { class: "mu-ctr-v num" }, exV), el("span", { class: "mu-ctr-l" }, "physics-approved → Mubit training examples")),
        el("div", { class: "src mu-ctr-s" }, exSub),
        el("div", { class: "mu-ctr-tot", title: "source: " + MUBIT.harvest.source }, el("b", { class: "num" }, int(MUBIT.harvest.examples)), " in total · from " + int(MUBIT.harvest.decisions) + " Claude ideas · " + "harvest runs, 24 Oct")),
      el("div", { class: "mu-ctr mu-model", title: "source: " + MUBIT.model_source }, el("span", { class: "mu-ctr-l" }, "Mubit model status"),
        MUBIT.model.map(([v, t]) => el("div", { class: "mu-model-l" }, el("b", null, v), " " + t)),
        el("div", { class: "src mu-ctr-s" }, "source: " + MUBIT.model_source)),
    );
  }
  function renderProgress() {
    const host = $("#muProg"); if (!host) return;
    if (S.mode !== "replay" && S.status === "running" && S.progress) host.replaceChildren(el("b", null, "decision " + S.progress.n), " · " + S.progress.text);
    else if (S.error) host.replaceChildren(el("span", { class: "warn" }, S.error));
    else host.replaceChildren();
    host.hidden = !host.firstChild;
  }
  function renderCtl() {
    const host = $("#muCtl"); if (!host) return;
    const kids = [];
    if (S.mode === "replay") {
      const playing = S.playing;
      kids.push(el("select", { class: "mu-run", "aria-label": "recorded run", title: "recorded live Mubit runs bundled with the site", onchange: e => loadReplay(e.target.value).then(play) },
        S.runs.map(r => el("option", { value: r.name, selected: S.meta && r.name === S.meta.name ? true : null, title: r.name + " · " + r.calls + " Mubit calls · recorded " + when(r.recorded_at) }, runLabel(r)))));
      kids.push(el("button", { type: "button", class: "btn primary", id: "muPlay", onclick: () => (playing ? pause() : play()) }, playing ? "Pause" : S.status === "done" ? "Replay" : S.shown ? "Resume" : "Play"),
        el("div", { class: "mu-seg", role: "group", "aria-label": "replay speed" }, [[1000, "1×"], [250, "4×"]].map(([v, t]) => el("button", { type: "button", class: "btn small" + (S.pace === v ? " on" : ""), "aria-pressed": S.pace === v ? "true" : "false", onclick: () => { S.pace = v; renderCtl(); } }, t))),
        el("button", { type: "button", class: "btn small", title: "show every decision now", onclick: skipToEnd }, "End"));
    } else {
      kids.push(el("button", { type: "button", class: "btn", onclick: () => loadReplay(S.meta && S.meta.name) }, "Replay"));
      if (S.status === "running") kids.push(el("button", { type: "button", class: "btn danger", onclick: stopRun }, "Stop"));
    }
    const running = S.status === "running" || S.status === "starting";
    kids.push(el("span", { class: "mu-golive-g" },
      el("div", { class: "mu-seg", role: "group", "aria-label": "Mubit calls for a live run", title: "Mubit calls in a live run (one per decision). The public site's hourly limits reserve twice that (each approved idea is re-sent as a trained call); a run is time-boxed to about 4 minutes there" },
        LIVE_CHOICES.map(v => el("button", { type: "button", class: "btn small" + (S.liveN === v ? " on" : ""), "aria-pressed": S.liveN === v ? "true" : "false", disabled: running ? true : null, onclick: () => { S.liveN = v; renderCtl(); } }, String(v)))),
      S.liveOk
        ? el("button", { type: "button", class: "btn mu-golive", id: "muGoLive", disabled: running ? true : null, title: "start the engine now: " + S.liveN + " Mubit calls (" + MODEL_NAME + ", untrained); every idea the physics lap sim approves is re-sent by the server as a trained call, a Mubit training example", onclick: () => startRun("live") }, "Go live")
        : el("button", { type: "button", class: "btn mu-golive off", id: "muGoLive", disabled: true, title: "live is not available here: " + (S.liveWhy || "checking…") }, "Go live")));
    if (S.apiOk && !S.liveOk) kids.push(el("button", { type: "button", class: "btn small mu-demo", title: "run the real engine with a scripted stand-in instead of the model (labelled offline demo, no Mubit call)", disabled: running ? true : null, onclick: () => startRun("mock") }, "Offline demo"));
    host.replaceChildren(...kids);
  }

  // ---------------------------------------------------------------- the Mubit feed card (lineage card style; drawn by concept-lab.js renderFeed)
  function verdict(c) {
    if (c.by !== "mubit" && c.by !== "mock") return el("span", { class: "verdict sm reject", title: c.fallback || "" }, "no usable answer");
    const a = c.as; if (!a) return null;
    const why = "physics lap sim · Silverstone · the change exactly as proposed";
    if (a.legal === false) return el("span", { class: "mu-v bad", title: "rules broken: " + (a.articles || []).join(", ") + " · " + why }, "✗ illegal: " + ((a.articles || []).map(articleWords).filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 1).join("") || "outside the rules"));
    if (isNum(a.d_lap_s) && a.d_lap_s < -0.0005) return el("span", { class: "mu-v good", title: why }, "✓ faster " + sg(a.d_lap_s) + " s");
    return el("span", { class: "mu-v bad", title: why }, "✗ slower " + sg(a.d_lap_s, isNum(a.d_lap_s) && Math.abs(a.d_lap_s) >= 0.1 ? 2 : 3) + " s");
  }
  function trainChip(c) {
    switch (c.train) {
      case "recorded": return el("span", { class: "mu-chip mubit", title: "this recorded run sent every call to Mubit as a trained call" }, "recorded in Mubit");
      case "pending": return el("span", { class: "mu-chip mubit pend" }, "→ training example…");
      case "trained": return el("span", { class: "mu-chip mubit on", title: "trained call x-middleware-request-id " + c.trainedId + (c.same === false ? " · the re-sent answer differed" : " · same answer") }, "→ Mubit training example");
      case "failed": return el("span", { class: "mu-chip bad", title: c.trainErr || "" }, "training call failed");
      case "rejected": return el("span", { class: "mu-chip muted", title: "the physics lap sim said no to the idea as proposed: it stays an untrained call" }, "correction: not trained");
      case "mock": return el("span", { class: "mu-chip muted" }, "offline demo");
      default: return null;
    }
  }
  function engineLine(c) {
    const tried = (isNum(c.versions) ? int(c.versions) + " versions" : "") + (isNum(c.laps) ? (isNum(c.versions) ? ", " : "") + int(c.laps) + " physics laps" : "");
    if (c.kept && isNum(c.d_head)) return el("span", { class: "mu-eng kept", title: "the engine tested versions of the idea around the proposal and kept the best car (physics lap sim)" }, "engine kept " + sg(c.d_head, Math.abs(c.d_head) >= 0.01 ? 2 : 3) + " s" + (tried ? " after " + tried : ""));
    return el("span", { class: "mu-eng" }, "engine: nothing faster" + (tried ? " after " + tried : ""));
  }
  function card(row) {
    const c = row.mubit; if (!c) return el("div", { class: "ln" });
    const ok = approved(c);
    const n = el("div", { class: "ln mu-card" + (c.kept ? " kept" : "") + (ok ? " ok" : "") + (c.as && c.as.legal === false ? " illegal" : ""), "data-n": c.n },
      el("div", { class: "l1" },
        el("span", { class: "g num", text: "#" + c.n }),
        el("span", { class: "mu-chip mubit sm", title: c.by === "mock" ? "scripted stand-in, not a model" : "one Mubit call (" + MODEL_NAME + ")" }, c.by === "mock" ? "mock" : "Mubit"),
        c.id ? el("code", { class: "mu-rid", title: "x-middleware-request-id " + c.id + (c.trained ? " (trained call)" : " (untrained call)") }, shortId(c.id)) : null,
        isNum(c.latency_ms) ? el("span", { class: "src num" }, secs(c.latency_ms)) : null,
        el("span", { class: "spacer" }),
        verdict(c)),
      el("div", { class: "mu-hyp", title: c.hypothesis || c.fallback || "" }, c.hypothesis ? "“" + trim(c.hypothesis, 150) + "”" : "the model's answer could not be used"),
      c.change ? el("div", { class: "mu-chg", title: plainChange(c.change, 99) }, el("span", { class: "k" }, "proposed "), plainChange(c.change, 2)) : null,
      el("div", { class: "mu-l3" }, trainChip(c), engineLine(c)));
    c.el = n;
    return n;
  }

  // ---------------------------------------------------------------- views (Mubit engineer | Compare: no AI | Design tree | Exam)
  const BTN = { mubit: "#btnViewMubit", noai: "#btnViewNoAI", tree: "#btnViewEng", exam: "#btnViewExam" };
  function setView(v) {
    S.view = v;
    document.body.classList.toggle("mubit-on", v === "mubit");
    for (const [k, id] of Object.entries(BTN)) { const b = $(id); if (b) { b.classList.toggle("on", k === v); b.setAttribute("aria-pressed", k === v ? "true" : "false"); } }
    if (EI.conceptLab && (v === "mubit" || v === "noai")) EI.conceptLab.source(v);
    if (v !== "mubit" && S.playing) pause();
    try { const u = new URL(location.href); if (v === "mubit") u.searchParams.delete("view"); else if (v !== "exam") u.searchParams.set("view", v === "tree" ? "tree" : v); history.replaceState(null, "", u); } catch (e) { /* file:// */ }
    window.dispatchEvent(new Event("resize"));
  }

  async function boot() {
    if (!EI.conceptLab || !L()) return;   // concept-lab.js did not boot (its banner says why)
    S.baseDesign = baseOf();
    for (const [k, id] of Object.entries(BTN)) { const b = $(id); if (b) b.addEventListener("click", () => setView(k)); }
    const v0 = qs.get("view");
    setView(v0 === "noai" ? "noai" : v0 === "tree" ? "tree" : v0 === "exam" ? "exam" : "mubit");
    $("#muStrip").after(el("div", { class: "mu-prog mubit-only", id: "muProg", hidden: true }));
    document.addEventListener("keydown", e => { if (S.view !== "mubit" || S.mode !== "replay") return; if (e.target.closest && e.target.closest("input,select,textarea,button,a")) return; if (e.key === " ") { e.preventDefault(); S.playing ? pause() : play(); } });
    renderAll();
    await listRuns();
    await loadReplay(qs.get("replay"));
    probeLive();
    if (S.view === "mubit") { if (qs.get("autoplay") === "end") skipToEnd(); else if (qs.get("autoplay") !== "0") play(); }
  }
  // test / screenshot hook
  EI.mubitFirst = { state: () => ({ view: S.view, mode: S.mode, status: S.status, shown: S.shown, cards: S.cards.length, calls: S.calls, examples: S.examples, best: S.best, liveOk: S.liveOk, liveN: S.liveN, run: S.meta && S.meta.name }), play, pause, skipToEnd, startRun, loadReplay, setView, MUBIT,
    stepTo: n => { pause(); while (S.replay && S.shown < Math.min(n, S.replay.decisions.length)) replayStep(); renderAll(); return S.shown; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
