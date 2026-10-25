// PURPLE CONCEPT LAB - the MUBIT-FIRST view (the default view of the lab and of the site root). The owner's preferred layout (the speed
// run's: live Silverstone board, the 3D RB22 with its last kept change, the progress chart, "How different is it?", the car sheet) driven
// by the autonomous engineer (engine v2) and Mubit instead of the no-AI optimiser:
//   REPLAY (default, any visitor): plays back a RECORDED LIVE Mubit run (newest trained-corrections run in concept/demo/replays, else
//          concept/lab/replays); real x-middleware-request-id values; nothing is re-run. Labelled "replay of a recorded live Mubit run".
//   LIVE   (Go live; no passcode on the site for the engine, PURPLE_OPEN_LIVE): POST /api/concept/engine/run { mode: "engineer",
//          llm: "live", record_good: "kept", ideas: 4, rounds: 5 | 10 | 20, max_calls: 4 × rounds, variants: 600, confirm_k: 8 } and
//          follow its SSE stream. PARALLEL ROUNDS (docs/concept/ENGINE_V2.md §9): each round asks Mubit for 4 ideas at once from the same
//          car (each call with its own focus line), the engine tests all 4 and keeps the fastest legal car. Every designer call is
//          untrained (x-middleware-record: metadata); an idea from which physics KEPT a faster legal car is re-sent BY THE SERVER as the
//          identical trained call (concept/engineer/record-good.js, rule "kept"). The card's verdict is what physics did with the idea
//          ("✓ kept −0.021 s" / "✗ no faster car" / "✗ illegal: …"); the idea's lap exactly as written is the small grey line.
//   OFFLINE DEMO (small button): the same engine with the scripted mock; labelled "not a model". The browser never calls Mubit.
// The layout itself is drawn by concept-lab.js (EI.conceptLab.mubit); this file owns the Mubit strip, the run controls and the Mubit
// feed cards. Every number carries its source label (G-HON-01); scores as n/N. Tokens: lab/lab.css (docs/DESIGN_SYSTEM.md).
(function () {
  // ---------------------------------------------------------------- the one place to update the Mubit numbers (integrator)
  const MUBIT = {
    model: [
      ["v1", "98 examples · Mubit test 5/19, not passed"],
      ["v2", "4,115 physics-approved examples sent"],
      ["+", "6,073 compact and 16,981 one-code examples sent, for an exact match"],
    ],
    model_source: "Mubit console, 24 Oct",
    // docs/concept/loop-runs/trained-harvest: good.jsonl rows (test/mubit-first.test.js checks the count)
    harvest: { examples: 4115, decisions: 48250, source: "harvest runs, 24–25 Oct (docs/concept/loop-runs/trained-harvest, -2, -3)" },
  };
  const LIVE_CHOICES = [5, 10, 20];   // rounds of a live run
  const IDEAS = 4;                    // ideas from Mubit at once per round (Mubit calls per round)
  const LIVE_SCREEN = { variants: 600, confirm_k: 8, explore: 2 };   // per idea: versions screened, physics laps confirmed (+ explore)
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
    cards: [], calls: 0, examples: 0, total: 12, run: null, es: null, progress: null, liveOk: false, liveWhy: "", deploy: null, apiOk: false, liveN: 10,
    best: null, baseDesign: null, stage: null, rounds: 0, stopNote: null,
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
  // physics found a faster legal car from the idea (the engine's best version of it beat the car it started from): the "kept" rule of
  // concept/engineer/record-good.js, the one live runs train on
  const fasterCar = c => isNum(c.best_d) && c.best_d < -0.0005;
  const approved = c => !!(c.by === "mubit" && fasterCar(c));

  // ---------------------------------------------------------------- data
  async function getJson(url, init) { const r = await fetch(url, init); const j = await r.json().catch(() => null); if (!r.ok && !(j && j.ok === false)) throw new Error("HTTP " + r.status); return j; }
  // every recorded engine v2 run bundled with the site, newest first; the default is the newest trained-corrections run
  // fast first load: both run indexes are fetched at once, and the default run's file is fetched while the rest of the page boots
  // (the end of this file); loadReplay takes that early fetch once, later loads fetch again as before
  const early = new Map(), indexP = new Map();
  let warm = null;
  const getIndex = dir => { if (!indexP.has(dir)) { const p = getJson(dir + "index.json"); indexP.set(dir, p); p.catch(() => indexP.delete(dir)); } return indexP.get(dir); };
  const takeEarly = url => { const p = early.get(url); early.delete(url); return p || getJson(url); };
  async function listRuns() {
    const out = [], dirs = ["../demo/replays/", "replays/"];
    const idxs = await Promise.all(dirs.map(dir => getIndex(dir).catch(() => null)));
    dirs.forEach((dir, i) => {
      for (const r of (idxs[i] && idxs[i].runs) || []) if (r.kind === "engineer-v2" && !out.some(x => x.name === r.name)) out.push(Object.assign({ dir }, r));
    });
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
      bestChange: d.best_change || null, round: d.round == null ? null : d.round, slot: d.slot == null ? null : d.slot, of: d.of == null ? null : d.of, focus: d.focus || null,
    };
  }
  function timingOf(d) {
    if (!d || !isNum(d.latency_ms)) return null;
    const parts = [(S.mode === "mock" ? "stand-in " : "Mubit ") + secs(d.latency_ms) + (d.of > 1 ? " (" + d.of + " at once)" : "")];
    if (d.screen && isNum(d.screen.distinct)) parts.push(int(d.screen.distinct) + " versions tested in " + secs(d.screen.ms));
    if (isNum(d.physics_laps)) parts.push(int(d.physics_laps) + " physics laps in " + secs(d.physics_ms));
    return { parts, title: "Mubit idea #" + d.decision + (d.round != null ? " (round " + d.round + ", idea " + d.slot + " of " + d.of + ")" : "") + ", timed by the engine: the " + (S.mode === "mock" ? "scripted stand-in" : "Mubit call (" + MODEL_NAME + ")") + ", the quick test of every version of the idea, then full physics laps on the best ones" };
  }
  function push(d, opts) {
    const c = norm(d, opts.train);
    if (opts.trainedId) c.trainedId = opts.trainedId;
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
    if (warm) { await warm; warm = null; }
    try { S.replay = await takeEarly(meta.dir + meta.file); } catch (e) { S.error = "could not load the recorded run: " + e.message; renderAll(); return; }
    S.meta = meta; S.status = "ready";
    resetRun(S.replay.decisions.length);
    renderAll();
  }
  // o.bulk (End): no strip redraw per decision, and the 3D car / browser lap is built only for o.buildAt (the last decision that set a
  // new best); o.prevBest is the best before it, so its "gain" reads the same as when the replay is played step by step
  function replayStep(o) {
    o = o || {};
    const R = S.replay; if (!R || S.shown >= R.decisions.length) { S.playing = false; S.status = "done"; clearTimeout(S.timer); renderAll(); return false; }
    const i = S.shown, d = R.decisions[S.shown++];
    const peak = (R.nodes || []).find(x => x.id === d.peak_after), peakLap = peak && isNum(peak.lap_s) ? peak.lap_s : null;
    const newBest = isNum(peakLap) && (!isNum(S.best) || peakLap < S.best - 1e-9);
    if (newBest) S.best = peakLap;
    // a record_good run says per decision whether it was re-sent as a trained call; a trained run trained every call
    const tr = d.training_example === "sent" ? "trained" : d.training_example === "failed" ? "failed" : d.training_example === "not trained" ? "rejected" : null;
    const build = newBest && d.result && d.peak_after === d.result.node && (!o.bulk || i === o.buildAt);
    if (build && o.bulk && isNum(o.prevBest) && L()) L().set({ peakLap: o.prevBest });
    push(d, { train: d.trained ? "recorded" : tr || "untrained", trainedId: d.trained_request_id || null, peakLap, design: build ? designFromDiff(d.params) : null });
    if (d.mubit_request_id) S.calls++;
    if (!o.bulk) renderStrip();
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
  // End: every remaining decision at once, then ONE render (the 3D car and its browser lap are built once, for the final best car)
  function skipToEnd() {
    pause(); const R = S.replay; if (!R) return;
    let best = S.best, prevBest = null, buildAt = -1;
    for (let i = S.shown; i < R.decisions.length; i++) {
      const d = R.decisions[i], p = (R.nodes || []).find(x => x.id === d.peak_after);
      if (p && isNum(p.lap_s) && (!isNum(best) || p.lap_s < best - 1e-9)) { if (d.result && d.peak_after === d.result.node) { buildAt = i; prevBest = best; } best = p.lap_s; }
    }
    while (S.shown < R.decisions.length) replayStep({ bulk: true, buildAt, prevBest });
    S.status = "done"; renderAll();
  }

  // ---------------------------------------------------------------- live (record_good, parallel rounds) / offline demo
  async function startRun(llm) {
    stopAll();
    const rounds = S.liveN, n = rounds * IDEAS;
    S.mode = llm === "live" ? "live" : "mock"; S.status = "starting"; S.error = null; S.replay = null; S.meta = null;
    resetRun(n); S.rounds = rounds; renderAll();
    const common = { mode: "engineer", team: "redbull", ideas: IDEAS, rounds, max_calls: n, variants: LIVE_SCREEN.variants, confirm_k: LIVE_SCREEN.confirm_k, explore: LIVE_SCREEN.explore };
    const body = llm === "live"
      ? Object.assign({ llm: "live", record_good: "kept", confirm: "trained", confirm_text: "TRAIN " + n, seed: +(qs.get("seed") || Math.floor(Math.random() * 1000)) }, common)
      : Object.assign({ llm: "mock", seed: +(qs.get("seed") || 1) }, common);
    let j;
    try { j = await getJson(API + "/api/concept/engine/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { S.status = "error"; S.error = "the engine API is not reachable (" + API + "): " + e.message; renderAll(); return; }
    if (!j || !j.ok) { S.status = "error"; S.error = (j && j.error && j.error.message) || "the run was refused"; renderAll(); return; }
    S.run = j.data; S.status = "running"; renderAll();
    const es = new EventSource(/^https?:/.test(j.data.stream) ? j.data.stream : API + j.data.stream); S.es = es;
    // an EventSource that reconnects gets the run's events again from the start: each event is handled once (by its seq)
    let lastSeq = -1;
    const on = (t, f) => es.addEventListener(t, ev => { let d; try { d = JSON.parse(ev.data); } catch (e) { return; } if (typeof d.seq === "number") { if (d.seq <= lastSeq) return; lastSeq = d.seq; } try { f(d); } catch (e) { console.error("mubit-first: " + t + ": " + (e && e.stack || e)); } });
    const who = () => (S.mode === "live" ? "Mubit" : "the stand-in");
    // the stage strip of a round: asking Mubit for 4 ideas… → testing 2,400 versions… → driving 32 laps… → kept −0.02 s
    on("round", d => { S.stage = { round: d.round, ideas: d.ideas, step: "ask", got: 0, list: d.focus.map(f => ({ focus: f, change: null, by: null, d: null, done: false })), scr: {}, versions: 0, laps: 0, result: null, first: d.first_decision }; renderProgress(); });
    on("request", d => { if (d.round == null) setProgress(d.decision, "asking " + who() + "…"); });
    on("proposal", d => {
      const g = S.stage;
      if (d.round == null || !g || g.round !== d.round) { setProgress(d.decision, who() + " proposes " + plainChange(d.change, 2)); return; }
      const it = g.list[d.slot - 1]; if (it) { it.change = d.change; it.by = d.by; }
      g.got++; if (g.got >= g.ideas) g.step = "screen";
      renderProgress();
    });
    on("progress", d => {
      if (d.stage !== "screen") return;
      const g = S.stage;
      if (d.round == null || !g || g.round !== d.round) { setProgress(d.decision, "testing " + int(d.done) + " versions of the idea"); return; }
      g.scr[d.decision] = d.done; g.versions = Object.values(g.scr).reduce((a, b) => a + b, 0); g.step = "screen"; g.at = d.slot; renderProgress();
    });
    on("screen", d => {
      const g = S.stage;
      if (d.round == null || !g || g.round !== d.round) { setProgress(d.decision, int(d.screen.distinct) + " versions tested · full physics laps on the best"); return; }
      g.scr[d.decision] = d.screen.distinct; g.versions = Object.values(g.scr).reduce((a, b) => a + b, 0); g.step = "drive"; g.at = d.slot; renderProgress();
    });
    on("tested", d => {
      const g = S.stage; if (!g || g.round !== d.round) return;
      g.laps += d.physics_laps || 0; const it = g.list[d.slot - 1]; if (it) { it.d = d.best_d_s; it.done = true; }
      g.step = d.slot < g.ideas ? "screen" : "drive"; renderProgress();
    });
    on("decision", d => {
      const peakLap = d.peak && isNum(d.peak.lap_s) ? d.peak.lap_s : null, newBest = isNum(peakLap) && (!isNum(S.best) || peakLap < S.best - 1e-9);
      if (newBest) S.best = peakLap;
      S.calls = isNum(d.calls) ? d.calls : S.calls + 1;
      push(d.row, { train: S.mode !== "live" ? "mock" : d.training_example === "pending" ? "pending" : "rejected", peakLap, design: newBest && d.peak.params ? designFromParams(d.peak.params) : null });
      if (d.row.round == null) S.progress = null;
      renderStrip(); renderProgress();
    });
    on("round_done", d => {
      const g = S.stage; if (g && g.round === d.round) { g.step = "done"; g.result = d; g.versions = d.versions; g.laps = d.physics_laps; }
      S.calls = isNum(d.calls) ? d.calls : S.calls;
      renderStrip(); renderProgress();
    });
    on("training_example", d => {
      const c = S.cards.find(x => x.n === d.decision); if (!c) return;
      if (d.error) { c.train = "failed"; c.trainErr = d.error; } else { c.train = "trained"; c.trainedId = d.trained_request_id; c.same = d.same_answer; S.examples = isNum(d.trained_examples) ? d.trained_examples : S.examples + 1; }
      if (c.el && c.el.parentNode) c.el.replaceWith(card({ mubit: c }, true));
      renderStrip();
    });
    on("final", d => { S.status = "done"; S.progress = null; if (isNum(d.trained_examples)) S.examples = d.trained_examples; S.stopNote = stopNote(d); renderAll(); });
    on("error", d => { S.error = d.error || "run error"; renderAll(); });
    es.addEventListener("end", () => { es.close(); S.es = null; if (S.status !== "done") S.status = "done"; S.progress = null; renderAll(); });
    es.onerror = () => { if (es.readyState === 2 && S.status === "running") { S.status = "done"; S.error = S.error || "the stream closed"; renderAll(); } };
  }
  // why the run ended, in plain words
  function stopNote(d) {
    const why = String(d.stop_reason || ""), n = isNum(d.rounds) ? d.rounds : null;
    if (/time limit|time box/.test(why)) return "stopped at the time limit after " + (n != null ? n + " round" + (n === 1 ? "" : "s") : why.replace(/^.*after /, ""));
    if (/^all \d+ rounds done/.test(why)) return why;
    if (/stopped by user/.test(why)) return "stopped by you" + (n != null ? " after " + n + " round" + (n === 1 ? "" : "s") : "");
    return why || null;
  }
  function setProgress(n, text) { S.progress = { n, text }; renderProgress(); }
  async function stopRun() { if (S.run && S.status === "running") { try { await getJson(API + "/api/concept/engine/run/" + S.run.run_id + "/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); } catch (e) { /* the stream ends anyway */ } } }
  function stopAll() { S.playing = false; clearTimeout(S.timer); if (S.es) { try { S.es.close(); } catch (e) { /* closed */ } S.es = null; } S.progress = null; S.stage = null; S.stopNote = null; }
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
    S.cards = []; S.shown = 0; S.calls = 0; S.examples = 0; S.total = total; S.best = null; S.stage = null; S.stopNote = null; S.rounds = 0;
    const lab = L(); if (lab) { lab.reset({ total, status: S.status }); lab.set({ feedCard: card, feedNote: feedNote(), emptyText: emptyText(), who: S.mode === "mock" ? "stand-in" : "Mubit" }); }
  }
  function setLabStatus() { const lab = L(); if (lab) lab.set({ status: S.status === "playing" || S.status === "running" ? "playing" : S.status }); }
  const feedNote = () => (S.mode === "mock" ? "scripted stand-in, not a model · verdict: physics lap sim" : "ideas: " + MODEL_NAME + " through Mubit · verdict: physics lap sim");
  const emptyText = () => (S.mode === "replay" ? "Press Play: each card is one Mubit call. Claude proposes a change to the car, the physics lap sim tests it as proposed, then the engine tests thousands of versions of the idea and keeps only what is faster." : S.mode === "live" ? "Asking Mubit for the first " + IDEAS + " ideas at once… the cards of a round appear when the engine has tested all " + IDEAS + "." : "Asking the scripted stand-in (not a model) for the first " + IDEAS + " ideas…");

  // ---------------------------------------------------------------- render
  function renderAll() { renderStrip(); renderCtl(); renderProgress(); const lab = L(); if (lab) lab.set({ feedNote: feedNote(), emptyText: emptyText() }); setLabStatus(); }
  // a strip counter: the number and what it counts on one line, one short caption under it (the full sentence is the tooltip)
  // "54 / 117": the count big, its denominator quieter
  const bigNum = v => { const m = /^(.+?)( \/ .+)$/.exec(String(v)); return el("span", { class: "mu-ctr-v num" }, m ? [m[1], el("span", { class: "mu-of" }, m[2])] : String(v)); };
  function counter(cls, value, label, sub, title, subTitle) {
    return el("div", { class: "mu-ctr " + (cls || ""), title: title || null },
      el("div", { class: "mu-ctr-top" }, bigNum(value), el("span", { class: "mu-ctr-l" }, label)),
      sub ? el("div", { class: "mu-ctr-s", title: subTitle || sub }, sub) : null);
  }
  // the Mubit strip: three panels on the column edges below (Mubit and the run | calls and approved ideas | the Mubit model)
  function renderStrip() {
    const host = $("#muStrip"); if (!host) return;
    const n = S.cards.length, ok = S.cards.filter(approved).length;
    const calls = S.mode === "mock" ? 0 : S.mode === "live" ? S.calls + S.examples : S.calls;
    const R = S.replay;
    let modeBadge, modeLine;
    if (S.mode === "replay") {
      const ids = R ? R.request_ids || [] : [];
      modeBadge = el("span", { class: "mu-badge replay", title: "a recorded LIVE run: every call has a real Mubit x-middleware-request-id; played back here, nothing is re-run" }, "Replay");
      modeLine = el("span", { class: "mu-line", title: R ? R.calls + " Mubit calls · " + (R.model || "") + " · request ids " + ids[0] + " … " + ids[ids.length - 1] : "" }, R ? "recorded live run" + (R.recorded_at ? " · " + when(R.recorded_at) : "") : S.error || "loading the recorded run…");
    } else if (S.mode === "live") {
      modeBadge = el("span", { class: "mu-badge live" }, "Live");
      modeLine = el("span", { class: "mu-line", title: S.run ? S.run.run_id : "" }, S.status === "error" ? "" : "live run · " + (S.rounds ? S.rounds + " rounds × " + IDEAS + " ideas" : S.total + " Mubit calls"));
    } else {
      modeBadge = el("span", { class: "mu-badge demo" }, "Offline demo");
      modeLine = el("span", { class: "mu-line" }, "scripted stand-in, not a model · no Mubit call");
    }
    const total = S.mode === "replay" && R ? R.decisions.length : S.total;
    const callsSub = S.mode === "mock" ? "offline demo: nothing is sent to Mubit"
      : S.mode === "live" ? MODEL_NAME + " · " + IDEAS + " at once per round" + (S.examples ? " + " + S.examples + " trained re-send" + (S.examples === 1 ? "" : "s") : "") + " · of " + S.total
      : n + " / " + total + " played · " + MODEL_NAME + " · one per decision";
    // the second counter says what it counts, per mode: live = trained re-sends (kept rule); a replayed record_good run = its trained
    // re-sends; a replayed all-trained run = every call was recorded, so it counts the ideas physics kept a faster car from
    const allTrained = S.mode === "replay" && !!R && (R.trained === true || (S.cards.length > 0 && S.cards.every(c => c.train === "recorded")));
    const sent = S.cards.filter(c => c.train === "trained").length;
    const exV = S.mode === "live" ? String(S.examples) : S.mode === "mock" ? "0" : R && R.record_good ? sent + " / " + n : ok + " / " + n;
    const exL = S.mode === "replay" && !(R && R.record_good) ? "ideas physics kept a faster car from" : "physics-approved → Mubit training examples";
    // short caption on screen, the full sentence as its tooltip
    const exSub = S.mode === "live" ? ["this run · " + ok + " approved, re-sent as trained calls", "this run: of " + ok + " ideas physics kept a faster car from, re-sent by the server as trained calls"]
      : S.mode === "mock" ? ["offline demo: nothing is sent to Mubit"]
      : R && R.record_good ? ["replayed run · approved ideas were re-sent as trained calls", "replayed run: ideas physics kept a faster car from were re-sent as trained calls"]
      : allTrained ? ["replayed run · every call was recorded in Mubit", "replayed run: every call was recorded in Mubit; " + ok + " of its " + n + " ideas were kept by physics"]
      : ["replayed run · kept by physics", "replayed run: " + ok + " of its " + n + " ideas were kept by physics"];
    const exTitle = "an idea counts as approved when physics kept a faster legal car from it: the engine's best version of the idea (as written, made legal, or a tested variant) beat the car it started from on the physics lap sim. In a live run only those are re-sent as trained calls, Mubit training examples";
    host.replaceChildren(
      el("div", { class: "mu-cell mu-mark", title: "Mubit: the gateway every designer call goes through; it records calls and trains on the kept examples" },
        el("div", { class: "mu-mark-top" }, el("span", { class: "mu-logo" }, "Mubit"), modeBadge), modeLine),
      el("div", { class: "mu-cell mu-mid" },
        counter("mubit", int(calls), "Mubit calls · this run", callsSub, "designer calls sent through Mubit in this run (live: plus the trained re-sends)"),
        el("div", { class: "mu-ctr good", title: exTitle },
          el("div", { class: "mu-ctr-top" }, bigNum(exV), el("span", { class: "mu-ctr-l" }, exL)),
          el("div", { class: "mu-ctr-s", title: exSub[1] || exSub[0] }, exSub[0]),
          el("div", { class: "mu-ctr-tot", title: int(MUBIT.harvest.examples) + " physics-approved examples in total, from " + int(MUBIT.harvest.decisions) + " Claude ideas · harvest runs, 24 Oct · source: " + MUBIT.harvest.source }, el("b", { class: "num" }, int(MUBIT.harvest.examples)), " in total, from " + int(MUBIT.harvest.decisions) + " Claude ideas"))),
      el("div", { class: "mu-cell mu-model", title: "source: " + MUBIT.model_source },
        el("div", { class: "mu-model-h" }, el("span", null, "Mubit model status"), el("span", { class: "mu-model-src" }, "source: " + MUBIT.model_source)),
        MUBIT.model.map(([v, t]) => el("div", { class: "mu-model-l" }, el("b", { class: "num" }, v), el("span", null, t)))),
    );
  }
  function renderProgress() {
    const host = $("#muProg"); if (!host) return;
    host.classList.toggle("rounds", false);
    if (S.mode !== "replay" && S.status === "running" && S.stage) { host.classList.add("rounds"); host.replaceChildren(...stageStrip(S.stage)); }
    else if (S.mode !== "replay" && S.status === "running" && S.progress) host.replaceChildren(el("b", null, "decision " + S.progress.n), " · " + S.progress.text);
    else if (S.error) host.replaceChildren(el("span", { class: "warn" }, S.error));
    else if (S.mode !== "replay" && S.stopNote) host.replaceChildren(el("b", null, "run finished"), " · " + S.stopNote + (S.examples ? " · " + S.examples + " Mubit training example" + (S.examples === 1 ? "" : "s") : ""));
    else host.replaceChildren();
    host.hidden = !host.firstChild;
  }
  // a round as a strip: asking Mubit for 4 ideas… → testing 2,400 versions… → driving 32 laps… → kept −0.02 s; then one chip per idea
  function stageStrip(g) {
    const order = ["ask", "screen", "drive", "done"], at = order.indexOf(g.step);
    const cls = i => "mu-st" + (i < at ? " done" : i === at ? " now" : "");
    const r = g.result, who = S.mode === "live" ? "Mubit" : "the stand-in";
    const steps = [
      el("span", { class: cls(0) }, at > 0 ? g.ideas + " ideas from " + who : "asking " + who + " for " + g.ideas + " ideas… " + g.got + "/" + g.ideas),
      el("span", { class: cls(1) }, at > 1 ? int(g.versions) + " versions tested" : (g.versions ? "testing " + int(g.versions) + " versions…" : "testing versions of each idea…")),
      el("span", { class: cls(2) }, at > 2 ? int(g.laps) + " physics laps" : (g.laps ? "driving " + int(g.laps) + " laps…" : "driving physics laps…")),
      el("span", { class: cls(3) + (r ? (r.kept ? " good" : " bad") : "") }, r ? (r.kept ? "kept " + sg(r.d_head_s, Math.abs(r.d_head_s) >= 0.01 ? 2 : 3) + " s (idea " + r.winner_slot + ")" : "no faster car this round") : "keep the fastest legal car"),
    ];
    const line1 = el("div", { class: "mu-st-l" }, el("b", null, "Round " + g.round + (S.rounds ? " of " + S.rounds : "")), " · ", ...steps.reduce((a, s, i) => (i ? a.concat([el("span", { class: "mu-st-arr", "aria-hidden": "true" }, "→"), s]) : [s]), []));
    const chips = el("div", { class: "mu-ideas" }, g.list.map((it, i) => {
      const faster = isNum(it.d) && it.d < -0.0005, win = r && r.kept && r.winner_slot === i + 1;
      return el("span", { class: "mu-idea" + (it.change ? " in" : "") + (it.done ? (faster ? " good" : " bad") : "") + (win ? " win" : ""), title: "idea " + (i + 1) + " · focus: " + it.focus + (it.change ? " · " + plainChange(it.change, 9) : " · waiting for " + who) },
        el("span", { class: "mu-idea-f" }, it.focus), " ", it.change ? plainChange(it.change, 1) : "…", it.done ? " " + (isNum(it.d) ? sg(it.d, Math.abs(it.d) >= 0.01 ? 2 : 3) + " s" : "no legal car") : "");
    }));
    return [line1, chips];
  }
  function renderCtl() {
    const host = $("#muCtl"); if (!host) return;
    // two groups, each with its label: the recorded run (run · play · speed · skip) and a live run (rounds · Go live · offline demo)
    const rep = S.mode === "replay" ? [el("span", { class: "mu-gl" }, "Recorded run")] : [];
    if (S.mode === "replay") {
      const playing = S.playing;
      rep.push(el("select", { class: "mu-run", "aria-label": "recorded run", title: "recorded live Mubit runs bundled with the site", onchange: e => loadReplay(e.target.value).then(play) },
        S.runs.length ? S.runs.map(r => el("option", { value: r.name, selected: S.meta && r.name === S.meta.name ? true : null, title: r.name + " · " + r.calls + " Mubit calls · recorded " + when(r.recorded_at) }, runLabel(r)))
          : el("option", { value: "" }, S.error ? "no recorded run" : "loading the run…")));
      rep.push(el("button", { type: "button", class: "btn primary", id: "muPlay", onclick: () => (playing ? pause() : play()) }, playing ? "Pause" : S.status === "done" ? "Play again" : S.shown ? "Resume" : "Play"),
        el("div", { class: "mu-seg", role: "group", "aria-label": "replay speed", title: "replay speed" }, [[1000, "1×"], [250, "4×"]].map(([v, t]) => el("button", { type: "button", class: "btn" + (S.pace === v ? " on" : ""), "aria-pressed": S.pace === v ? "true" : "false", onclick: () => { S.pace = v; renderCtl(); } }, t))),
        el("button", { type: "button", class: "btn", title: "show every decision now", onclick: skipToEnd }, "Skip to end"));
    } else {
      rep.push(el("button", { type: "button", class: "btn", title: "back to the recorded live Mubit run", onclick: () => loadReplay(S.meta && S.meta.name) }, "Back to replay"));
      if (S.status === "running") rep.push(el("button", { type: "button", class: "btn danger", onclick: stopRun }, "Stop run"));
    }
    const running = S.status === "running" || S.status === "starting";
    const live = el("div", { class: "mu-grp mu-golive-g", role: "group", "aria-label": "live run" },
      el("span", { class: "mu-gl", title: "rounds in a live run; each round asks Mubit for " + IDEAS + " ideas at once" }, "Live run"),
      el("div", { class: "mu-seg", role: "group", "aria-label": "rounds in a live run", title: "rounds in a live run: each round asks Mubit for " + IDEAS + " ideas at once (" + IDEAS + " Mubit calls), the engine tests all of them and keeps the fastest legal car. The public site reserves " + IDEAS + " calls per round of its hourly limit; a run is time-boxed to about 4 minutes there and stops cleanly at the limit" },
        LIVE_CHOICES.map(v => el("button", { type: "button", class: "btn" + (S.liveN === v ? " on" : ""), "aria-pressed": S.liveN === v ? "true" : "false", disabled: running ? true : null, title: v + " rounds × " + IDEAS + " ideas = " + v * IDEAS + " Mubit calls", onclick: () => { S.liveN = v; renderCtl(); } }, String(v)))),
      el("span", { class: "mu-seg-l", title: "rounds in a live run; each round asks Mubit for " + IDEAS + " ideas at once" }, "rounds × " + IDEAS + " ideas"),
      S.liveOk
        ? el("button", { type: "button", class: "btn mu-golive", id: "muGoLive", disabled: running ? true : null, title: "start the engine now: " + S.liveN + " rounds × " + IDEAS + " ideas = " + S.liveN * IDEAS + " Mubit calls (" + MODEL_NAME + ", untrained, " + IDEAS + " at once); every idea from which physics keeps a faster legal car is re-sent by the server as a trained call, a Mubit training example", onclick: () => startRun("live") }, "Go live")
        : el("button", { type: "button", class: "btn mu-golive off", id: "muGoLive", disabled: true, title: "live is not available here: " + (S.liveWhy || "checking…") }, "Go live"),
      S.apiOk && !S.liveOk ? el("button", { type: "button", class: "btn mu-demo", title: "run the real engine with a scripted stand-in instead of the model (labelled offline demo, no Mubit call)", disabled: running ? true : null, onclick: () => startRun("mock") }, "Offline demo") : null);
    host.replaceChildren(el("div", { class: "mu-grp", role: "group", "aria-label": "recorded run" }, rep), live);
  }

  // ---------------------------------------------------------------- the Mubit feed card (lineage card style; drawn by concept-lab.js renderFeed)
  // the main verdict = what physics did with the idea: the engine tested the idea as written, made legal, and hundreds of versions of
  // it; "✓ kept" when the run kept its car, "✓ faster car" when its best version beat the car it started from but another idea of the
  // same round was faster still, "✗ illegal" when no legal car came out of it, else "✗ no faster car"
  const ruleWords = a => (a.articles || []).map(articleWords).filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 1).join("") || "outside the rules";
  const dp = v => (isNum(v) && Math.abs(v) >= 0.01 ? 2 : 3);
  function roundBest(c) { return c.round == null ? null : S.cards.find(x => x.round === c.round && x.kept) || null; }
  function verdict(c) {
    if (c.by !== "mubit" && c.by !== "mock") return el("span", { class: "mu-v bad", title: c.fallback || "" }, "✗ no usable answer");
    const why = "physics lap sim · Silverstone · the engine's best legal version of this idea vs the car it started from";
    if (c.kept && isNum(c.d_head)) return el("span", { class: "mu-v good", title: why + " · this car was kept" }, "✓ kept " + sg(c.d_head, dp(c.d_head)) + " s");
    if (fasterCar(c)) { const w = roundBest(c); return el("span", { class: "mu-v good", title: why + (w ? " · the round kept idea " + w.slot + " (#" + w.n + "), faster still" : "") }, "✓ faster car " + sg(c.best_d, dp(c.best_d)) + " s"); }
    const a = c.as;
    if (!isNum(c.best_d) && a && a.legal === false) return el("span", { class: "mu-v bad", title: "rules broken as written: " + (a.articles || []).join(", ") + " · no legal faster version found · " + why }, "✗ illegal: " + ruleWords(a));
    return el("span", { class: "mu-v bad", title: why + (isNum(c.best_d) ? " · best version " + sg(c.best_d, 3) + " s" : "") }, "✗ no faster car");
  }
  // the idea exactly as written (secondary): its own physics lap vs the car it started from
  function asWritten(c) {
    const a = c.as; if (!a || (c.by !== "mubit" && c.by !== "mock")) return null;
    const t = a.legal === false ? "illegal (" + ruleWords(a) + ")" : isNum(a.d_lap_s) ? sg(a.d_lap_s, dp(a.d_lap_s)) + " s" : a.note || "—";
    return el("span", { class: "mu-asw", title: "the change exactly as the model wrote it, one physics lap vs the car it started from" }, "as written: " + t);
  }
  function trainChip(c) {
    switch (c.train) {
      case "recorded": return el("span", { class: "mu-chip mubit", title: "this recorded run sent every call to Mubit as a trained call" }, "recorded in Mubit");
      case "pending": return el("span", { class: "mu-chip mubit pend", title: "physics kept a faster legal car from this idea: the server is re-sending the identical request as a trained call" }, "→ Mubit training example…");
      case "trained": return el("span", { class: "mu-chip mubit on", title: "trained call x-middleware-request-id " + c.trainedId + (c.same === false ? " · the re-sent answer differed" : " · same answer") }, "→ Mubit training example");
      case "failed": return el("span", { class: "mu-chip bad", title: c.trainErr || "" }, "training call failed");
      case "rejected": return el("span", { class: "mu-chip muted", title: "physics found no faster legal car from this idea: it stays an untrained call, and its measured result goes back to Claude in the next scenario" }, "correction: back to Claude");
      case "mock": return el("span", { class: "mu-chip muted" }, "offline demo");
      default: return null;
    }
  }
  function engineLine(c) {
    const tried = (isNum(c.versions) ? int(c.versions) + " versions" : "") + (isNum(c.laps) ? (isNum(c.versions) ? " · " : "") + int(c.laps) + " physics laps" : "");
    const best = (c.kept || fasterCar(c)) && c.bestChange ? plainChange(c.bestChange, 1) : null;
    if (!tried && !best) return null;
    return el("span", { class: "mu-eng" + (c.kept ? " kept" : ""), title: "the engine tested versions of the idea around the proposal (quick screen, then full physics laps on the best)" + (c.bestChange ? " · best version: " + plainChange(c.bestChange, 9) : "") }, tried + (best ? " · best: " + best : ""));
  }
  // a round's header sits on top of its newest card (the feed is newest first)
  function roundHead(c) {
    const w = roundBest(c), rc = S.cards.filter(x => x.round === c.round), ff = rc.filter(fasterCar).length;
    return el("div", { class: "mu-round" },
      el("span", { class: "mu-round-t" }, el("b", null, "Round " + c.round), " · " + c.of + " idea" + (c.of === 1 ? "" : "s") + " from " + (c.by === "mock" ? "the stand-in" : "Mubit") + " at once"),
      el("span", { class: "spacer" }),
      el("span", { class: "mu-round-r" }, el("span", { class: w ? "good" : "" }, w ? "kept " + sg(w.d_head, dp(w.d_head)) + " s (idea " + w.slot + ")" : "no faster car"), ff ? " · " + ff + "/" + rc.length + " found a faster car" : ""));
  }
  // card hierarchy: verdict + training first, then Claude's idea, the change in plain words, what physics measured, and a quiet meta
  // line with who answered, the request id and the latency
  function card(row, inner) {
    const c = row.mubit; if (!c) return el("div", { class: "ln" });
    const ok = approved(c);
    const res = [c.change ? asWritten(c) : null, engineLine(c)].filter(Boolean);
    const meta = [
      el("span", { class: "mu-who", title: c.by === "mock" ? "scripted stand-in, not a model" : "one Mubit call (" + MODEL_NAME + ")" }, c.by === "mock" ? "stand-in (not a model)" : "Mubit"),
      c.id ? el("code", { class: "mu-rid", title: "x-middleware-request-id " + c.id + (c.trained ? " (trained call)" : " (untrained call)") }, shortId(c.id)) : null,
      isNum(c.latency_ms) ? el("span", { class: "num" }, secs(c.latency_ms)) : null,
      c.focus ? el("span", { class: "mu-focus", title: "focus line of this call (round " + c.round + ", idea " + c.slot + " of " + c.of + "): the only difference between the calls of a round" }, "focus: " + c.focus) : null,
    ].filter(Boolean);
    const n = el("div", { class: "ln mu-card" + (c.kept ? " kept" : "") + (ok ? " ok" : "") + (!isNum(c.best_d) && c.as && c.as.legal === false ? " illegal" : ""), "data-n": c.n },
      el("div", { class: "l1" }, el("span", { class: "g num", text: "#" + c.n }), verdict(c), trainChip(c)),
      el("div", { class: "mu-hyp", title: c.hypothesis || c.fallback || "" }, c.hypothesis ? "“" + trim(c.hypothesis, 150) + "”" : "the model's answer could not be used"),
      c.change ? el("div", { class: "mu-chg", title: plainChange(c.change, 99) }, el("span", { class: "k" }, "Proposed "), plainChange(c.change, 2)) : null,
      res.length ? el("div", { class: "mu-res" }, res.reduce((a, x, i) => (i ? a.concat([el("span", { class: "sep", "aria-hidden": "true" }, " · "), x]) : [x]), [])) : null,
      el("div", { class: "mu-meta" }, meta.reduce((a, x, i) => (i ? a.concat([el("span", { class: "sep", "aria-hidden": "true" }, " · "), x]) : [x]), [])));
    c.el = n;
    if (!inner && c.round != null && c.slot === c.of) return el("div", { class: "mu-rwrap" }, roundHead(c), n);
    return n;
  }

  // ---------------------------------------------------------------- views (Mubit engineer | Compare: no AI | Design tree | Exam)
  const BTN = { mubit: "#btnViewMubit", noai: "#btnViewNoAI", tree: "#btnViewEng", exam: "#btnViewExam" };
  function setView(v) {
    S.view = v;
    document.body.classList.toggle("mubit-on", v === "mubit");
    for (const [k, id] of Object.entries(BTN)) { const b = $(id); if (b) { b.classList.toggle("on", k === v); b.setAttribute("aria-pressed", k === v ? "true" : "false"); } }
    if (EI.conceptLab && (v === "mubit" || v === "noai")) EI.conceptLab.source(v);
    if (v === "noai") mount3d();
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
    tidy();
    document.addEventListener("keydown", e => { if (S.view !== "mubit" || S.mode !== "replay") return; if (e.target.closest && e.target.closest("input,select,textarea,button,a")) return; if (e.key === " ") { e.preventDefault(); S.playing ? pause() : play(); } });
    renderAll();
    await listRuns();
    await loadReplay(qs.get("replay"));
    probeLive();
    if (S.view === "mubit") { if (qs.get("autoplay") === "end") skipToEnd(); else if (qs.get("autoplay") !== "0") play(); }
    // the replay is on screen: now build the 3D car (concept-lab.js waits for this, so its first WebGL frame never holds up the replay)
    requestAnimationFrame(() => setTimeout(mount3d, 0));
  }
  function mount3d() { if (EI.conceptLab && EI.conceptLab.mountView) EI.conceptLab.mountView(); }
  // layout helpers: the header's height as --hdr-h (the Engine and Mubit loop overlays open under it), and the one-line honest-limits
  // footer keeps its whole text as a tooltip (concept-lab.js redraws it)
  function tidy() {
    // the last kept change leaves the top corner of the car for its own row under the best-lap strip (concept-lab.js fills it by id)
    const br = $("#heroBR"), hero = $("#hero"); if (br && hero) hero.appendChild(br);
    const top = $("header.top"), root = document.documentElement;
    const setH = () => { if (top) root.style.setProperty("--hdr-h", Math.round(top.getBoundingClientRect().height) + "px"); };
    setH(); if (top && window.ResizeObserver) new ResizeObserver(setH).observe(top); else window.addEventListener("resize", setH);
    const f = $("#honest"); if (!f) return;
    const tip = () => { const t = f.textContent.replace(/\s+/g, " ").trim(); if (f.title !== t) f.title = t; };
    tip(); if (window.MutationObserver) new MutationObserver(tip).observe(f, { childList: true, subtree: true, characterData: true });
    f.tabIndex = 0;
  }
  // test / screenshot hook
  EI.mubitFirst = { state: () => ({ view: S.view, mode: S.mode, status: S.status, shown: S.shown, cards: S.cards.length, calls: S.calls, examples: S.examples, best: S.best, liveOk: S.liveOk, liveN: S.liveN, run: S.meta && S.meta.name, round: S.stage ? S.stage.round : null, step: S.stage ? S.stage.step : null, versions: S.stage ? S.stage.versions : 0, laps: S.stage ? S.stage.laps : 0, stopNote: S.stopNote }), play, pause, skipToEnd, startRun, loadReplay, setView, MUBIT,
    stepTo: n => { pause(); while (S.replay && S.shown < Math.min(n, S.replay.decisions.length)) replayStep(); renderAll(); return S.shown; } };
  // fetch the run list and the default run now, while the rest of the page boots; concept-lab.js builds the 3D car only when boot()
  // above asks for it (after the first card), or after a few seconds whatever happens
  EI.conceptLabDeferView = true;
  warm = listRuns().then(() => { const m = defaultRun(); if (m) { const p = getJson(m.dir + m.file); p.catch(() => {}); early.set(m.dir + m.file, p); } }).catch(() => {});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
