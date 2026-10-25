// PURPLE Model GP LIVE (/concept/gp/, "Run it live"): the recorded result stays the default view; this adds a live race of the models.
// One live engine run PER ENTRANT, all started at once, through the site's API (never Mubit from the browser):
//   POST {API}/api/concept/engine/run { mode: "engineer", llm: "live", model: <entrant id>, memory: true, ideas: 4, rounds: 25,
//        team: "redbull", seed, variants: 600, confirm_k: 8, explore: 2 }   (never record_good / trained: every call is untrained)
// then each run's SSE stream (the same stream the homepage's Go live follows, concept/lab/mubit-first.js). Every entrant gets the same
// budget: 100 generations (25 rounds of 4 ideas; one generation = one idea, one designer call, tested on the physics lap sim), the
// same seed, the same start car and the same shared memory. Each lane shows its ideas as they arrive (the model's own words, the
// change, the physics verdict, the Mubit request id), n/100 generations, the best lap so far, the gap to the real pole and a lap chart;
// the standings re-rank as laps improve, with the real pole (Antonelli, OpenF1 2026) as a reference row. At the end: "Race them on
// Silverstone" with each model's best car under its own name plus the real pole lap, providers only (&only=cars&real=ANT: no RB22,
// no No-AI control). On a server without live calls (MUBIT_MOCK=1, or ?llm=mock) the same engine runs with the scripted stand-in,
// labelled "mock, not a model". Reuses gp.js's chart, 3D and race-link code (EI.gp).
// URL: ?live=1 opens the panel · ?api=<base> (as the lab; default: same origin on the site, 127.0.0.1:8787 on a local page)
//      ?llm=mock forces the stand-in · ?rounds=N (mock only, for tests) · ?seed=N · ?cars3d=0 no 3D cars in the live lanes
(function () {
  "use strict";
  const EI = window.EI || {}, K = EI.gp;
  if (!K) return;
  const { el, f3, sg, hexA } = K;
  const $ = id => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const API = (q.get("api") != null ? q.get("api") : LOCAL && location.port !== "8787" ? "http://127.0.0.1:8787" : "").replace(/\/$/, "");
  const POLE = 88.111, IDEAS = 4, ROUNDS_LIVE = 25;
  const RUN = { mode: "engineer", memory: true, ideas: IDEAS, team: "redbull", variants: 600, confirm_k: 8, explore: 2 };
  const TIME_BOX = "about 4 minutes";

  const L = { entrants: [], lanes: [], status: "idle", mode: null, apiOk: false, liveOk: false, why: "checking the engine API…", seed: null, gen: 0, t0: 0, t1: 0, y: null, dirty: new Set(), boardDirty: false, mountGen: 0, ended: false };
  const rounds = () => (L.mode === "mock" && +q.get("rounds") >= 1 ? Math.min(ROUNDS_LIVE, Math.floor(+q.get("rounds"))) : ROUNDS_LIVE);
  const budget = () => IDEAS * rounds();
  const carOf = e => e.car || e.name;
  const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  // ---------------------------------------------------------------- plain words (the homepage feed's wording, concept/lab/mubit-first.js)
  const ARTICLE_WORDS = { "PKG-FLOOR-STALL": "floor too low", "PKG-COOLING": "not enough cooling", "PKG-GEAR-TOP": "top gear too short", "PKG-WB": "parts do not fit the wheelbase", "PKG-PART-MASS": "impossible part mass" };
  const articleWords = a => ARTICLE_WORDS[a] || (/^C3\.10/.test(a) ? "front wing outside the rules" : /^C3\.11/.test(a) ? "rear wing outside the rules" : /^C3\.(5|6|7|8|9)\b/.test(a) ? "bodywork outside the rules" : "outside the 2026 rules");
  const ruleWords = a => ((a && a.articles) || []).map(articleWords).filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 1).join("") || "outside the rules";
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
  const trim = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
  const dp = v => (isNum(v) && Math.abs(v) >= 0.01 ? 2 : 3);

  // ---------------------------------------------------------------- the engine API (the lab's probe: live available, else the stand-in)
  async function probe() {
    try {
      const r = await fetch(API + "/api/concept/engine/info", { cache: "no-store" });
      const j = await r.json().catch(() => null), info = j && j.data, dep = j && j.deploy;
      L.apiOk = !!info;
      if (!info) { L.liveOk = false; L.why = "the engine API did not answer"; }
      else if (dep && dep.live) { L.liveOk = !!(dep.live.available && (dep.live.unlocked || dep.live.engine_open)); L.why = !dep.live.available ? "live calls are off on this deployment" : !L.liveOk ? "live runs are locked on this deployment" : ""; }
      else { L.liveOk = !!info.live_available; L.why = info.mock ? "this server runs with MUBIT_MOCK=1" : !info.live_available ? "no MUBIT_API_KEY on this server" : ""; }
    } catch (e) { L.apiOk = false; L.liveOk = false; L.why = "no engine API reachable" + (API ? " at " + API : ""); }
    L.mode = !L.apiOk ? null : q.get("llm") === "mock" || !L.liveOk ? "mock" : "live";
    renderHead();
  }

  // ---------------------------------------------------------------- the panel head: what this is, who races, start / stop
  function renderHead() {
    const mock = L.mode === "mock";
    $("gpLiveKicker").textContent = mock ? "Offline demo · mock, not a model · no Mubit call" : "Live · real Mubit calls · untrained";
    $("gpLiveSub").replaceChildren(
      "Every entrant gets the same engine, the same RB22 start car, the same shared memory, the same seed and the same budget: ",
      el("b", { text: budget() + " generations" }), " (" + rounds() + " rounds of " + IDEAS + " ideas). One generation is one idea from the model, tested on the physics lap sim, which keeps only what is legal and faster. ",
      mock ? "This server has no live calls (" + (L.why || "mock") + "), so every entrant answers with the scripted stand-in: mock, not a model."
        : "Each run has " + TIME_BOX + " on this site; a slower model may finish fewer generations, and its lane says so.");
    const go = $("gpLiveStart"), running = L.status === "running";
    go.disabled = running || !L.mode || !picked().length;
    go.textContent = running ? "Racing…" : L.mode === "mock" ? (L.lanes.length ? "Run the offline demo again" : "Run the offline demo (mock)") : L.lanes.length ? "Start again" : "Start the live race";
    go.title = !L.mode ? "not available here: " + L.why : mock ? "the engine with the scripted stand-in (not a model); no Mubit call" : picked().length + " live engine runs at once, " + budget() + " generations each (untrained Mubit calls; No AI makes none)";
    $("gpLiveStop").hidden = !running;
    for (const b of document.querySelectorAll("#gpPick input")) b.disabled = running;
    status();
  }
  function status() {
    const s = $("gpLiveStatus");
    if (!L.mode) { s.textContent = L.why; return; }
    if (L.status === "running") { const on = L.lanes.filter(x => !x.done).length; s.textContent = "Running · " + clock(Date.now() - L.t0) + " · " + on + " of " + L.lanes.length + " still racing · seed " + L.seed; return; }
    if (L.status === "done") { s.textContent = "Finished in " + clock(L.t1 - L.t0) + " · seed " + L.seed; return; }
    s.textContent = picked().length + " of " + L.entrants.length + " entrants · " + budget() + " generations each";
  }
  const picked = () => L.entrants.filter(e => { const b = document.querySelector('#gpPick input[value="' + e.id + '"]'); return !b || b.checked; });
  function buildPick() {
    const f = $("gpPick"), keep = f.querySelector("legend");
    f.replaceChildren(keep, ...L.entrants.map(e => el("label", { class: "gp-pk", style: "--gp-c:" + e.color, title: e.control ? "control · no language model" : e.model + " via Mubit" },
      el("input", { type: "checkbox", value: e.id, checked: "" }), el("i", { class: e.control ? "ctrl" : "" }), el("span", { text: carOf(e) }))));
    f.addEventListener("change", renderHead);
  }

  // ---------------------------------------------------------------- lanes
  const CARS3D = () => q.get("cars3d") !== "0" && !!EI.conceptView && !!K.S.base && window.innerWidth >= 900;
  function makeLane(e) {
    return { e, gen: L.gen, unit: "generation", status: "queued", phase: "", run: null, es: null, lastSeq: -1, gens: 0, calls: 0, fb: { parse: 0, error: 0 }, ids: 0,
      best: null, base: null, curve: [], tries: [], beat: null, L: { designs: [{ laps: 0, params: null }] }, wantDesign: 0, shownDesign: -1, ready: false, view: null, setAt: 0,
      cards: new Map(), round: 0, stop: null, final: null, err: null, done: false, vretry: 0, t0: 0, t1: 0, pos: null, model: e.model || null };
  }
  function buildLanes() {
    const host = $("gpLiveLanes"); host.replaceChildren();
    const three = CARS3D();
    for (const ln of L.lanes) {
      const e = ln.e, mock = L.mode === "mock";
      const els = {
        chip: el("span", { class: "gp-ll-chip" }), who: el("div", { class: "gp-ll-w" }), best: el("span", { class: "cmp-best-v" }), gap: el("div", { class: "cmp-gap" }),
        gens: el("span", { class: "gp-ll-gv" }), note: el("div", { class: "gp-ll-note" }), canvas: el("canvas", { role: "img", "aria-label": carOf(e) + ": lap of every generation and the best so far" }),
        feed: el("ol", { class: "gp-feed", "aria-label": carOf(e) + ": ideas, newest first" }), car: three ? el("div", { class: "cmp-car" }) : null, tag: el("div", { class: "cmp-car-tag" }),
      };
      els.who.append(el("code", { text: e.control ? "no model" : e.model || e.id }), " · ", el("span", { class: "gp-ll-lab" + (mock ? " mock" : e.control ? "" : " live"), text: mock ? "mock, not a model" : e.control ? "control · no language model" : "live · real Mubit calls · untrained" }));
      const lane = el("section", { class: "panel gp-ll" + (e.control ? " ctrl" : ""), "aria-label": carOf(e), style: "--gp-c:" + e.color },
        el("div", { class: "gp-ll-h" }, el("div", { class: "cmp-lt" }, el("i"), el("span", { text: carOf(e) })), els.chip),
        els.who, els.car,
        el("div", { class: "gp-ll-stats" },
          el("div", { class: "cmp-best" }, el("span", { class: "cmp-best-l", text: "Best lap so far" }), els.best),
          el("div", { class: "gp-ll-g" }, el("span", { class: "cmp-best-l", text: "Generations" }), els.gens)),
        els.gap, els.note,
        el("div", { class: "cmp-chart gp-ll-chart" }, els.canvas),
        el("div", { class: "gp-feed-h" }, el("span", { text: "Ideas as they arrive" }), el("span", { class: "muted", text: "newest first" })),
        els.feed,
        el("div", { class: "cmp-src", text: laneSource(e) }));
      if (els.car) els.car.append(els.tag);
      ln.els = els; host.append(lane);
      renderLane(ln);
    }
    if (three) mountCars();
  }
  function laneSource(e) {
    const lap = "Every lap: physics lap sim · Silverstone · model prediction.";
    if (L.mode === "mock") return "Scripted stand-in (concept/designer/loop.js), not a model; no Mubit call. " + lap;
    if (e.control) return "Control: every idea is the engine's own seeded random step; no language model, no Mubit call. " + lap;
    return e.model + " through Mubit (" + (e.provider === "openai" ? "OpenAI route" : "Anthropic route") + "), untrained calls. An answer that does not parse takes a random step, counted on this lane. " + lap;
  }
  // the cars build one lane after another (gp.js mountOne), then follow each lane's best car (gp.js pumpBuild: one rebuild per frame)
  function mountCars() {
    const gen = ++L.mountGen;
    for (const ln of L.lanes) ln.els.car.prepend(K.waitNote("Queued: the cars build one at a time…"));
    (async () => { for (const ln of L.lanes) { if (gen !== L.mountGen) return; await K.mountOne(ln, gen, () => L.mountGen); } })();
  }
  function disposeCars() { L.mountGen++; for (const ln of L.lanes) if (ln.view) { try { ln.view.dispose(); } catch (e) { /* gone */ } ln.view = null; } }

  function renderLane(ln) {
    const E = ln.els; if (!E) return;
    const B = budget();
    if (isNum(ln.best)) { E.best.replaceChildren(f3(ln.best), el("small", { text: " s" })); const g = ln.best - POLE; E.gap.className = "cmp-gap " + (g < 0 ? "under" : "over"); E.gap.textContent = g < 0 ? (-g).toFixed(3) + " s under the real pole" : "+" + g.toFixed(3) + " s to the real pole (88.111)"; }
    else { E.best.replaceChildren("—"); E.gap.className = "cmp-gap over"; E.gap.textContent = "gap to the real pole (88.111): waiting for the first lap"; }
    E.gens.replaceChildren(el("b", { text: String(ln.gens) }), "/" + B);
    const chip = ln.err && !ln.gens ? ["bad", "error"] : ln.done ? (ln.err ? ["bad", "ended"] : ["end", "finished"]) : ln.status === "waiting" ? ["wait", "waiting"] : ln.status === "queued" || ln.status === "starting" ? ["wait", "starting"] : ["on", "racing " + clock(Date.now() - ln.t0)];
    E.chip.className = "gp-ll-chip " + chip[0]; E.chip.textContent = chip[1];
    const bits = [];
    if (ln.done) bits.push(el("b", { text: ln.gens + "/" + B + " generations" }), ln.stop ? " · " + ln.stop : "");
    else if (ln.phase) bits.push(ln.round ? el("b", { text: "Round " + ln.round + "/" + rounds() }) : null, ln.round ? " · " : "", ln.phase);
    if (!ln.e.control && L.mode === "live" && (ln.fb.parse || ln.fb.error)) bits.push(el("span", { class: "warn", text: " · " + (ln.fb.parse + ln.fb.error) + "/" + ln.gens + " fell back to a random step (" + ln.fb.parse + " unparsable, " + ln.fb.error + " failed calls)" }));
    if (ln.err) bits.push(el("span", { class: "bad", text: (bits.length ? " · " : "") + ln.err }));
    if (ln.beat != null) bits.push(el("span", { class: "under", text: " · under the real pole at generation " + ln.beat }));
    E.note.replaceChildren(...bits.filter(x => x != null && x !== ""));
    drawLane(ln);
  }
  function yRange() {
    const vals = [POLE];
    for (const ln of L.lanes) { if (isNum(ln.base)) vals.push(ln.base); for (const v of ln.curve) if (isNum(v)) vals.push(v); }
    const base = Math.max(...L.lanes.map(x => x.base).filter(isNum), POLE + 0.6);
    const lo = Math.min(...vals) - 0.08, hi = base + 0.12;
    return { lo: Math.floor(lo * 20) / 20, hi: Math.ceil(hi * 20) / 20 };
  }
  function drawLane(ln) {
    const cnv = ln.els.canvas; if (!cnv.isConnected || !L.y) return;
    if (!ln.cv) ln.cv = K.sizeCanvas(cnv);
    const B = budget(), base = isNum(ln.base) ? ln.base : null;
    const { g, X, Y, pad } = K.axes(ln.cv, { l: 40, r: 8, t: 14, b: 20 }, { xmax: B, xstep: B >= 40 ? 25 : 5, base, y: L.y });
    const c = ln.e.color;
    g.fillStyle = hexA(c, 0.45);
    for (const [x, s] of ln.tries) if (s != null && s <= L.y.hi) g.fillRect(X(x) - 1.3, Y(s) - 1.3, 2.6, 2.6);
    g.fillStyle = K.ILLEGAL_C; for (const [x, s] of ln.tries) if (s == null) g.fillRect(X(x) - 0.6, pad.t - 7, 1.2, 4);
    if (ln.curve.length) {
      g.strokeStyle = c; g.lineWidth = 2.2; g.lineJoin = "round"; g.setLineDash(ln.e.control ? [6, 4] : []);
      const k = K.stepLine(g, X, Y, ln.curve, ln.curve.length - 1); g.setLineDash([]);
      g.fillStyle = c; g.beginPath(); g.arc(X(k), Y(ln.curve[k]), 3.2, 0, Math.PI * 2); g.fill();
    }
  }

  // ---------------------------------------------------------------- the feed: one card per idea, the model's own words first
  function card(ln, n) {
    let c = ln.cards.get(n); if (c) return c;
    c = { n, root: el("li", { class: "gp-idea pend" }), l1: el("div", { class: "gp-idea-l1" }), v: el("span", { class: "gp-v", text: "testing…" }), hyp: el("div", { class: "gp-idea-hyp" }), chg: el("div", { class: "gp-idea-chg" }), meta: el("div", { class: "gp-idea-meta" }) };
    c.l1.append(el("span", { class: "gp-idea-n", text: "#" + n }), c.v);
    c.root.append(c.l1, c.hyp, c.chg, c.meta);
    ln.cards.set(n, c);
    ln.els.feed.prepend(c.root);
    return c;
  }
  function fillCard(ln, c, d) {
    const call = d.call || {}, mock = L.mode === "mock" || d.by === "mock", fbk = d.by === "engine";
    if (d.round != null && !c.rd) { c.rd = el("span", { class: "gp-idea-r", text: "round " + d.round + " · idea " + d.slot + "/" + d.of }); c.l1.append(c.rd); }
    if (ln.e.control) c.hyp.replaceChildren(el("span", { class: "muted", text: "random direction (control, no model)" }));
    else if (fbk) { c.hyp.replaceChildren(el("span", { class: "warn", text: "No usable answer: the engine took a random step. " }), el("span", { class: "muted", text: trim(d.fallback_reason || "", 120) })); c.root.classList.add("fb"); }
    else if (d.hypothesis) { c.hyp.textContent = "“" + trim(d.hypothesis, 220) + "”"; c.hyp.title = d.hypothesis; }
    const change = d.change || d.proposal_change;
    if (change) c.chg.replaceChildren(el("span", { class: "k", text: "Proposed " }), plainChange(change, 2));
    const rid = call.mubit_request_id || d.mubit_request_id || null, model = call.model || null, ms = isNum(call.latency_ms) ? call.latency_ms : d.latency_ms;
    if (model) ln.model = model;
    const meta = [];
    if (ln.e.control) meta.push(el("span", { text: "no call" }));
    else meta.push(el("span", { text: mock ? "stand-in, not a model" : (model || ln.model || ln.e.model || "") }));
    if (rid) meta.push(el("code", { class: "gp-rid", title: "x-middleware-request-id (untrained call)", text: rid }));
    else if (!ln.e.control && !mock && call.error) meta.push(el("span", { class: "bad", text: "call failed: " + trim(call.error, 60) }));
    if (isNum(ms) && !ln.e.control) meta.push(el("span", { class: "num", text: (ms / 1000).toFixed(1) + " s" }));
    c.meta.replaceChildren(...meta.reduce((a, x, i) => (i ? a.concat([el("span", { class: "sep", "aria-hidden": "true", text: " · " }), x]) : [x]), []));
  }
  // the verdict = what physics did with the idea (the homepage card's rule): kept −0.021 s / faster car (not kept) / illegal: … / no faster car
  function verdict(row) {
    const why = "physics lap sim · Silverstone · the engine's best legal version of this idea vs the car it started from";
    if (row.kept && isNum(row.d_head_s)) return ["good", "✓ kept " + sg(row.d_head_s).slice(0, dp(row.d_head_s) + 3) + " s", why + " · this car was kept"];
    if (isNum(row.best_d_s) && row.best_d_s < -0.0005) return ["good soft", "✓ faster car " + sg(row.best_d_s).slice(0, dp(row.best_d_s) + 3) + " s (another idea won the round)", why];
    if (!isNum(row.best_d_s) && row.as_proposed && row.as_proposed.legal === false) return ["bad", "✗ illegal: " + ruleWords(row.as_proposed), "rules broken as written: " + (row.as_proposed.articles || []).join(", ") + " · " + why];
    return ["bad", "✗ no faster car", why + (isNum(row.best_d_s) ? " · best version " + sg(row.best_d_s) + " s" : "")];
  }

  // ---------------------------------------------------------------- one run per lane: POST, then its stream
  async function launch(ln) {
    if (ln.gen !== L.gen || ln.done) return;
    const body = Object.assign({}, RUN, { llm: L.mode, model: ln.e.id, rounds: rounds(), seed: L.seed });
    ln.status = "starting"; dirty(ln);
    let j;
    try {
      const r = await fetch(API + "/api/concept/engine/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      j = await r.json().catch(() => null);
      if (!j) throw new Error("HTTP " + r.status);
    } catch (e) { return endLane(ln, "the engine API is not reachable: " + e.message); }
    if (ln.gen !== L.gen) return;
    if (!j.ok) {
      const msg = (j.error && j.error.message) || "the run was refused";
      // a local server runs one engine at a time: the lane waits its turn (on the site each run has its own function)
      if (/already running/i.test(msg) && !ln.stopAsked) { ln.status = "waiting"; ln.phase = "waiting: this server runs one engine at a time"; dirty(ln); setTimeout(() => launch(ln), 2000); return; }
      return endLane(ln, msg);
    }
    ln.run = j.data; ln.status = "running"; ln.t0 = Date.now(); ln.phase = "starting the engine";
    entrantFrom(ln, j.data && j.data.opts);
    if (ln.stopAsked) stopLane(ln);
    dirty(ln);
    const url = /^https?:/.test(j.data.stream) ? j.data.stream : API + j.data.stream;
    follow(ln, url);
  }
  function entrantFrom(ln, o) { const x = o && o.entrant; if (x && x.model) ln.model = x.model; }
  function follow(ln, url) {
    const es = new EventSource(url); ln.es = es;
    const who = L.mode === "mock" ? "the stand-in" : ln.e.control ? "the random step" : carOf(ln.e);
    const on = (t, f) => es.addEventListener(t, ev => {
      if (ln.gen !== L.gen) return;
      let d; try { d = JSON.parse(ev.data); } catch (x) { return; }
      if (typeof d.seq === "number") { if (d.seq <= ln.lastSeq) return; ln.lastSeq = d.seq; }
      try { f(d); } catch (x) { console.error("gp live " + t + ": " + (x && x.stack || x)); }
      dirty(ln);
    });
    on("start", d => {
      entrantFrom(ln, d.opts); if (d.entrant) entrantFrom(ln, { entrant: d.entrant });
      if (d.baseline && isNum(d.baseline.lap_s)) { ln.base = d.baseline.lap_s; if (!ln.curve.length) ln.curve = [ln.base]; if (!isNum(ln.best)) ln.best = ln.base; L.y = yRange(); redrawAll(); }
      ln.phase = "starting from the RB22";
    });
    on("round", d => { ln.round = d.round; ln.phase = "asking " + who + " for " + d.ideas + " ideas…"; });
    on("proposal", d => { fillCard(ln, card(ln, d.decision), d); });
    on("screen", d => { if (d.round != null) ln.phase = "testing the ideas on the physics lap sim…"; });
    on("decision", d => decision(ln, d));
    on("round_done", d => { ln.phase = d.kept ? "kept " + sg(d.d_head_s).slice(0, dp(d.d_head_s) + 3) + " s (idea " + d.winner_slot + ")" : "no faster car this round"; });
    on("final", d => {
      ln.final = d; ln.stop = stopNote(d);
      const sm = d.summary || {};
      if (isNum(sm.peak_lap_s) && (!isNum(ln.best) || sm.peak_lap_s < ln.best)) ln.best = sm.peak_lap_s;
      if (d.best_params) ln.bestParams = d.best_params;
    });
    on("error", d => { if (d && d.error) ln.err = trim(d.error, 160); });
    es.addEventListener("end", () => { es.close(); ln.es = null; onEnd(ln); });
    es.onerror = () => { if (es.readyState === 2 && !ln.done) { ln.es = null; if (!ln.final) ln.err = ln.err || "the stream closed"; onEnd(ln); } };
  }
  function onEnd(ln) {
    if (ln.done || ln.gen !== L.gen) return;
    // on the site a run starts where its stream is opened; if that instance is busy, start the run again (a few times, nothing ran yet)
    if (!ln.final && !ln.gens && /already running/i.test(ln.err || "") && ln.vretry < 3 && !ln.stopAsked) { ln.vretry++; ln.err = null; ln.status = "waiting"; ln.phase = "the server was busy: starting again"; dirty(ln); setTimeout(() => launch(ln), 1500 * ln.vretry); return; }
    endLane(ln, ln.final ? null : ln.err || "the run ended without a result");
  }
  function decision(ln, d) {
    const row = d.row || {}, n = d.decision != null ? d.decision : row.decision;
    ln.gens++;
    const x = ln.gens;
    if (isNum(d.calls)) ln.calls = d.calls;
    const peak = d.peak && isNum(d.peak.lap_s) ? d.peak.lap_s : null;
    if (!ln.curve.length) ln.curve = [isNum(ln.base) ? ln.base : isNum(peak) ? peak : POLE + 0.6];
    if (isNum(peak) && (!isNum(ln.best) || peak < ln.best - 1e-9)) ln.best = peak;
    while (ln.curve.length <= x) ln.curve.push(ln.best);
    ln.tries.push([x, row.result && isNum(row.result.lap_s) ? row.result.lap_s : null]);
    if (d.peak && d.peak.params) { ln.L.designs.push({ laps: x, params: d.peak.params }); ln.wantDesign = ln.L.designs.length - 1; ln.bestParams = d.peak.params; }
    if (ln.beat == null && isNum(ln.best) && ln.best < POLE) ln.beat = x;
    if (row.by === "engine" && !ln.e.control) { if (/^llm_error/.test(row.fallback_reason || "")) ln.fb.error++; else ln.fb.parse++; }
    const c = card(ln, n);
    fillCard(ln, c, Object.assign({}, row, { call: d.call || null, change: row.proposal_change }));
    const [cls, text, title] = verdict(row);
    c.v.className = "gp-v " + cls; c.v.textContent = text; c.v.title = title;
    c.root.classList.remove("pend"); if (row.kept) c.root.classList.add("kept");
    const ys = yRange(); if (!L.y || ys.lo !== L.y.lo || ys.hi !== L.y.hi) { L.y = ys; redrawAll(); }
    L.boardDirty = true;
  }
  function stopNote(d) {
    const why = String(d.stop_reason || "");
    if (/time limit|time box|deadline/.test(why)) return "stopped at the time limit";
    if (/stopped by user/.test(why)) return "stopped by you";
    if (/all \d+ rounds done|rounds done|decision cap|call budget/.test(why)) return "full budget used";
    return why ? trim(why, 80) : "done";
  }
  function endLane(ln, err) {
    if (ln.done) return;
    ln.done = true; ln.t1 = Date.now(); if (err) ln.err = trim(err, 200); ln.phase = "";
    if (ln.es) { try { ln.es.close(); } catch (e) { /* closed */ } ln.es = null; }
    dirty(ln); L.boardDirty = true;
    if (L.lanes.every(x => x.done) && L.status === "running") { L.status = "done"; L.t1 = Date.now(); renderHead(); renderEnd(); }
  }
  async function stopLane(ln) {
    ln.stopAsked = true;
    if (!ln.run) { if (ln.status === "waiting" || ln.status === "queued") endLane(ln, "not started (stopped)"); return; }
    try { await fetch(API + "/api/concept/engine/run/" + ln.run.run_id + "/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); } catch (e) { /* the stream ends anyway */ }
  }

  // ---------------------------------------------------------------- start / stop
  function start() {
    const list = picked(); if (!list.length || !L.mode || L.status === "running") return;
    closeAll(); disposeCars();
    L.gen++; L.seed = +q.get("seed") >= 0 && q.get("seed") ? Math.floor(+q.get("seed")) : 1 + Math.floor(Math.random() * 99999);
    L.lanes = list.map(makeLane); L.status = "running"; L.t0 = Date.now(); L.t1 = 0; L.y = null;
    $("gpLiveTop").hidden = false; $("gpLiveEnd").hidden = true; $("gpLiveStandH").textContent = "Live standings";
    buildLanes(); L.boardDirty = true; renderHead();
    for (const ln of L.lanes) launch(ln);
  }
  function closeAll() { for (const ln of L.lanes) { if (ln.es) { try { ln.es.close(); } catch (e) { /* closed */ } ln.es = null; } } }
  function stopAll() { for (const ln of L.lanes) if (!ln.done) stopLane(ln); }

  // ---------------------------------------------------------------- standings (re-rank as laps improve; the real pole in place, by time)
  function board() {
    const T = $("gpLiveBoard"); T.replaceChildren();
    const B = budget();
    const lanes = L.lanes.slice().sort((a, b) => (isNum(a.best) ? a.best : 1e9) - (isNum(b.best) ? b.best : 1e9) || L.lanes.indexOf(a) - L.lanes.indexOf(b));
    const lead = lanes.length && isNum(lanes[0].best) ? lanes[0].best : null;
    T.append(el("thead", {}, el("tr", {}, el("th", { class: "pos", text: "Pos" }), el("th", { text: "Car" }), el("th", { class: "n", text: "Best lap" }), el("th", { class: "n opt", text: "Gap" }), el("th", { class: "n", text: "vs real pole" }), el("th", { class: "n", text: "Generations" }))));
    const rows = lanes.map((ln, i) => ({ ln, s: isNum(ln.best) ? ln.best : 1e9, pos: i + 1 }));
    rows.push({ pole: true, s: POLE });
    rows.sort((a, b) => a.s - b.s || (a.pole ? 1 : 0) - (b.pole ? 1 : 0));
    const tb = el("tbody");
    for (const x of rows) {
      if (x.pole) {
        tb.append(el("tr", { class: "pole" }, el("td", { class: "pos" }),
          el("td", {}, el("span", { class: "nm" }, el("span", { class: "gp-chip pole" }), "Real pole"), el("span", { class: "sub", text: "Antonelli · OpenF1 2026 · a real lap" })),
          el("td", { class: "n t", text: f3(POLE) }), el("td", { class: "n opt muted", text: lead != null ? sg(POLE - lead) : "" }), el("td", { class: "n muted", text: "reference" }), el("td", { class: "n" })));
        continue;
      }
      const ln = x.ln, e = ln.e, has = isNum(ln.best), g = has ? ln.best - POLE : null;
      if (ln.pos != null && ln.pos !== x.pos && has) ln.movedAt = performance.now();
      ln.pos = x.pos; const moved = ln.movedAt && performance.now() - ln.movedAt < 1600;
      const sub = e.control ? "control · no language model" : (ln.model || e.model) + (L.mode === "mock" ? " · mock, not a model" : "");
      const st = ln.done ? (ln.err && !ln.gens ? "error" : ln.stop || "") : ln.status === "running" ? "racing" : ln.status;
      tb.append(el("tr", { class: (x.pos === 1 && has ? "p1" : "") + (e.control ? " ctrl" : "") + (moved ? " moved" : ""), style: "--rc:" + e.color },
        el("td", { class: "pos", text: "P" + x.pos }),
        el("td", {}, el("span", { class: "nm" }, el("span", { class: "gp-chip" }), carOf(e)), el("span", { class: "sub" }, sub, el("span", { class: "opt", text: st ? " · " + st : "" }))),
        el("td", { class: "n t", text: has ? f3(ln.best) : "—" }),
        el("td", { class: "n opt muted", text: !has ? "" : x.pos === 1 ? "leader" : sg(ln.best - lead) }),
        el("td", { class: "n " + (g != null && g < 0 ? "under" : "over"), text: g == null ? "—" : sg(g) }),
        el("td", { class: "n", text: ln.gens + "/" + B })));
    }
    T.append(tb);
  }

  // ---------------------------------------------------------------- the end: final standings, the headline and the race (providers only)
  function renderEnd() {
    $("gpLiveStandH").textContent = "Final standings";
    const B = budget(), ranked = L.lanes.filter(x => isNum(x.best) && x.gens > 0).sort((a, b) => a.best - b.best);
    const H = $("gpLiveHeadline"), sub = [];
    if (!ranked.length) { H.textContent = "No lap this time: every run ended before its first generation."; }
    else {
      const w = ranked[0], g = w.best - POLE;
      H.replaceChildren(el("span", { class: "who", style: "color:" + w.e.color, text: carOf(w.e) }), " built the fastest car: ", el("span", { class: "t", text: f3(w.best) }), " s, " + (g < 0 ? Math.abs(g).toFixed(3) + " s under" : "+" + g.toFixed(3) + " s over") + " the real pole.");
      const ci = ranked.findIndex(x => x.e.control);
      if (ci >= 0) sub.push("The No-AI control placed P" + (ci + 1) + " of " + ranked.length + ".");
    }
    const short = L.lanes.filter(x => x.gens < B && x.gens > 0);
    sub.push(short.length ? short.map(x => carOf(x.e) + " " + x.gens + "/" + B + (x.stop ? " (" + x.stop + ")" : "")).join(", ") + "; every other entrant used all " + B + " generations." : "Every entrant used all " + B + " generations.");
    const fbs = L.lanes.filter(x => x.fb.parse + x.fb.error > 0);
    if (fbs.length && L.mode === "live") sub.push("Random fallbacks: " + fbs.map(x => carOf(x.e) + " " + (x.fb.parse + x.fb.error) + "/" + x.gens).join(", ") + ".");
    sub.push("One live run each, one seed: a single result, not an average. " + (L.mode === "mock" ? "Mock, not a model." : "Untrained calls."));
    $("gpLiveEndSub").textContent = sub.join(" ");
    // the race: each MODEL's best car under its car name, plus the real pole lap; no RB22, no No-AI control (&only=cars&real=ANT)
    const base = K.S.base, cars = L.lanes.filter(x => !x.e.control && isNum(x.best) && x.gens > 0 && base).map(x => {
      const d = K.designFrom(x.bestParams || base.params); d.id = "gp-live-" + x.e.id; d.label = carOf(x.e) + " · Model GP live"; d.team = "redbull";
      return { name: carOf(x.e), code: x.e.code, color: x.e.color, lap_s: x.best, seed: L.seed, design: d, note: (L.mode === "mock" ? "mock, not a model · " : "live · ") + x.gens + "/" + B + " generations" };
    });
    const link = K.carsLink(cars, true, L.mode === "mock" ? "Model GP · offline demo" : "Model GP · live");
    const a = $("gpLiveRace");
    if (link) { a.href = link.url; a.hidden = false; $("gpLiveRaceNote").textContent = "A qualifying lap in 3D: " + link.n + " model car" + (link.n === 1 ? "" : "s") + " and the real pole lap (Antonelli, OpenF1 2026) on one clock. Each car is its model's best car from this run; its lap is from the physics lap sim. No RB22 and no No-AI car in this race."; }
    else { a.hidden = true; $("gpLiveRaceNote").textContent = "No race: no model finished a generation."; }
    $("gpLiveEnd").hidden = false;
    L.boardDirty = true;
  }

  // ---------------------------------------------------------------- the frame loop (redraws only what changed)
  function dirty(ln) { L.dirty.add(ln); L.boardDirty = true; }
  function redrawAll() { for (const ln of L.lanes) { ln.cv = null; L.dirty.add(ln); } }
  let lastTick = 0;
  function frame(now) {
    if (L.status === "running" && now - lastTick > 1000) { lastTick = now; status(); for (const ln of L.lanes) if (!ln.done && ln.status === "running") L.dirty.add(ln); }
    if (L.dirty.size) { const list = [...L.dirty]; L.dirty.clear(); for (const ln of list) if (ln.gen === L.gen) renderLane(ln); }
    if (L.boardDirty) { L.boardDirty = false; board(); }
    if (L.lanes.length) K.pumpBuild(now, L.lanes);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  function open(scroll) {
    const s = $("gpLive"); s.hidden = false; $("gpLiveOpen").setAttribute("aria-expanded", "true");
    if (scroll) s.scrollIntoView({ behavior: "smooth", block: "start" });
    try { const u = new URL(location.href); u.searchParams.set("live", "1"); history.replaceState(null, "", u); } catch (e) { /* file:// */ }
  }
  async function boot() {
    L.entrants = await K.getJson("entrants.json").then(j => j.entrants || [], () => []);
    if (!L.entrants.length) { $("gpLiveStatus").textContent = "entrants.json did not load"; return; }
    buildPick(); renderHead();
    $("gpLiveOpen").addEventListener("click", () => open(true));
    $("gpLiveStart").addEventListener("click", start);
    $("gpLiveStop").addEventListener("click", stopAll);
    window.addEventListener("resize", () => { if (L.lanes.length) redrawAll(); });
    if (q.get("live") === "1") open(false);
    probe();
    requestAnimationFrame(frame);
  }
  // test / screenshot hook
  EI.gpLive = { state: () => ({ mode: L.mode, status: L.status, seed: L.seed, lanes: L.lanes.map(x => ({ id: x.e.id, gens: x.gens, best: x.best, done: x.done, err: x.err, stop: x.stop, fb: x.fb, cards: x.cards.size })), race: $("gpLiveRace").hidden ? null : $("gpLiveRace").getAttribute("href") }), start, stopAll, open };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
