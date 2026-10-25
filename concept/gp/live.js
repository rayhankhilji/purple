// PURPLE Model GP LIVE (/concept/gp/, the page's main view): a live race of the models, the recorded race is the second tab.
// One live engine run PER ENTRANT, all started at once, through the site's API (never Mubit from the browser):
//   POST {API}/api/concept/engine/run { mode: "engineer", llm: "live", model: <entrant id>, memory: true, ideas: 5, rounds: 20,
//        team: "redbull", seed, variants: 600, confirm_k: 8, explore: 2, stop_after: 20 }   (never record_good / trained: untrained)
// then each run's SSE stream (the stream the homepage's Go live follows, concept/lab/mubit-first.js). Every entrant gets the same
// budget: 100 generations (20 rounds of 5 ideas; one generation = one idea = one designer call, tested on the physics lap sim), the
// same seed, the same start car and the same shared memory; stop_after 20 = the engine's "no new best for N rounds" stop never cuts a
// run short (only the site's time box can, and the lane says so). Each lane is as rich as the homepage's single view: the feed of idea
// cards (the model's own words, the verdict, versions screened, physics laps, the lap as written, the Mubit request id; the card
// markup and wording of concept/lab/mubit-first.js), the lap-per-decision progress chart (the SVG chart of concept/lab/concept-lab.js:
// best-so-far step line, kept and rejected dots, no-legal-car marks, real pole and start-car lines), best lap, vs the start car, vs
// the real pole, projected grid position, sector times of the best car, generations n/100, and the 3D car of its current best. The
// standings re-rank as laps improve (a compact strip stays pinned at the top) with the real pole (Antonelli, OpenF1 2026) in place.
// At the end one button: "Race them on Silverstone" with each model's best car under its own name plus the real pole lap, providers
// only (&only=cars&real=ANT: no RB22, no No-AI car). Without live calls on the server (MUBIT_MOCK=1, or ?llm=mock) the same engine
// runs with the scripted stand-in, labelled "mock, not a model". Reuses gp.js's 3D and race-link code (EI.gp).
// URL: ?api=<base> (as the lab; default same origin on the site, 127.0.0.1:8787 on a local page) · ?llm=mock · ?rounds=N (mock only,
//      tests) · ?seed=N · ?cars3d=0 (no 3D cars in the lanes)
(function () {
  "use strict";
  const EI = window.EI || {}, K = EI.gp;
  if (!K) return;
  const { el, f3, sg } = K;
  const $ = id => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const API = (q.get("api") != null ? q.get("api") : LOCAL && location.port !== "8787" ? "http://127.0.0.1:8787" : "").replace(/\/$/, "");
  const POLE = 88.111, IDEAS = 5, ROUNDS_LIVE = 20;   // 5 ideas × 20 rounds = 100 generations (wider rounds fit the time box better)
  const RUN = { mode: "engineer", memory: true, ideas: IDEAS, team: "redbull", variants: 600, confirm_k: 8, explore: 2, stop_after: ROUNDS_LIVE };
  const SVGNS = "http://www.w3.org/2000/svg";

  const L = { entrants: [], lanes: [], status: "idle", mode: null, apiOk: false, liveOk: false, why: "checking the engine API…", seed: null, gen: 0, t0: 0, t1: 0, y: null, dirty: new Set(), boardDirty: false, mountGen: 0, field: null };
  const rounds = () => (L.mode === "mock" && +q.get("rounds") >= 1 ? Math.min(ROUNDS_LIVE, Math.floor(+q.get("rounds"))) : ROUNDS_LIVE);
  const budget = () => IDEAS * rounds();
  const carOf = e => e.car || e.name;
  const shortOf = e => carOf(e).replace(/^Claude /, "");
  const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const dp = v => (isNum(v) && Math.abs(v) >= 0.01 ? 2 : 3);
  const sgs = v => (isNum(v) ? (v < -1e-12 ? "−" : "+") + Math.abs(v).toFixed(dp(v)) : "—");
  const int = v => (isNum(v) ? Math.round(v).toLocaleString("en-GB") : "—");
  function sv(tag, attrs, ...kids) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  }
  const join = parts => parts.filter(Boolean).reduce((a, x, i) => (i ? a.concat([el("span", { class: "sep", "aria-hidden": "true", text: " · " }), x]) : [x]), []);

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

  // ---------------------------------------------------------------- the engine API (the lab's probe: live available, else the stand-in)
  async function probe() {
    try {
      const r = await fetch(API + "/api/concept/engine/info", { cache: "no-store" });
      const j = await r.json().catch(() => null), info = j && j.data, dep = j && j.deploy;
      L.apiOk = !!info;
      if (info && info.real && info.real.q) L.field = Object.keys(info.real.q).length + 1;
      if (!info) { L.liveOk = false; L.why = "the engine API did not answer"; }
      else if (dep && dep.live) { L.liveOk = !!(dep.live.available && (dep.live.unlocked || dep.live.engine_open)); L.why = !dep.live.available ? "live calls are off on this deployment" : !L.liveOk ? "live runs are locked on this deployment" : ""; }
      else { L.liveOk = !!info.live_available; L.why = info.mock ? "this server runs with MUBIT_MOCK=1" : !info.live_available ? "no MUBIT_API_KEY on this server" : ""; }
    } catch (e) { L.apiOk = false; L.liveOk = false; L.why = "no engine API reachable" + (API ? " at " + API : ""); }
    L.mode = !L.apiOk ? null : q.get("llm") === "mock" || !L.liveOk ? "mock" : "live";
    L.probed = true; renderHead(); maybeIdle();
  }
  // the idle lanes are built once the API answered (live or mock labels) and the start car's lap is known (gp.js loads the summary)
  function maybeIdle(force) { if (L.status !== "idle" || L.idleBuilt || !L.probed || !(K.S.sum || force)) return; L.idleBuilt = true; buildIdle(); }

  // ---------------------------------------------------------------- the head: who races, start / stop, elapsed
  function renderHead() {
    const mock = L.mode === "mock", running = L.status === "running", list = picked();
    $("gpLiveKicker").textContent = mock ? "offline demo · mock, not a model · no Mubit call" : "live · real Mubit calls · untrained";
    const go = $("gpLiveStart");
    go.disabled = running || !L.mode || !list.length;
    const who = list.map(shortOf).join(", ") + " · " + budget() + " generations each";
    go.textContent = running ? "Racing…" : (L.status === "done" ? "Race again: " : mock ? "Start the offline demo: " : "Start the race: ") + who;
    go.title = !L.mode ? "not available here: " + L.why : mock ? "the engine with the scripted stand-in (not a model); no Mubit call" : list.length + " live engine runs at once, untrained Mubit calls (No AI makes none)";
    $("gpLiveStop").hidden = !running;
    for (const b of document.querySelectorAll("#gpPick input")) b.disabled = running;
    status();
  }
  function status() {
    const s = $("gpLiveStatus");
    if (!L.mode) { s.textContent = L.why; return; }
    if (L.status === "running") { const on = L.lanes.filter(x => !x.done).length; s.textContent = "elapsed " + clock(Date.now() - L.t0) + " · " + on + "/" + L.lanes.length + " racing · seed " + L.seed; }
    else if (L.status === "done") s.textContent = "finished in " + clock(L.t1 - L.t0) + " · seed " + L.seed;
    else s.textContent = mock() ? "this server: " + L.why : "about 4 minutes · one run per model at once";
    const st = $("gpStrip").querySelector(".gp-strip-t"); if (st) st.textContent = s.textContent;
  }
  const mock = () => L.mode === "mock";
  const picked = () => L.entrants.filter(e => { const b = document.querySelector('#gpPick input[value="' + e.id + '"]'); return !b || b.checked; });
  function buildPick() {
    const f = $("gpPick"), keep = f.querySelector("legend");
    f.replaceChildren(keep, ...L.entrants.map(e => el("label", { class: "gp-pk", style: "--gp-c:" + e.color, title: e.control ? "control · no language model" : e.model + " via Mubit" },
      el("input", { type: "checkbox", value: e.id, checked: "" }), el("i", { class: e.control ? "ctrl" : "" }), el("span", { text: carOf(e) }))));
    f.addEventListener("change", () => { renderHead(); if (L.status !== "running" && L.idleBuilt) { L.status = "idle"; $("gpLiveRace").hidden = true; buildIdle(); } });
  }

  // ---------------------------------------------------------------- lanes: full-width rows (identity + car | numbers | chart | feed)
  const CARS3D = () => q.get("cars3d") !== "0" && !!EI.conceptView && !!K.S.base && window.innerWidth >= 900;
  function makeLane(e) {
    return { e, gen: L.gen, unit: "decision", status: "ready", phase: "", run: null, es: null, lastSeq: -1, gens: 0, calls: 0, fb: { parse: 0, error: 0 },
      best: null, base: null, curve: [], rows: [], beat: null, L: { designs: [{ laps: 0, params: null }] }, wantDesign: 0, shownDesign: -1, ready: false, view: null, setAt: 0,
      cards: new Map(), round: 0, stop: null, final: null, err: null, done: false, vretry: 0, t0: 0, t1: 0, pos: null, model: e.model || null,
      grid: null, sectors: null, baseSectors: null, versions: 0, laps: 0, kept: 0, illegal: 0 };
  }
  // the page opens ready to race: the picked entrants' lanes are on screen before the start (start car, empty chart, empty feed)
  function buildIdle() {
    disposeCars(); L.gen++;
    L.lanes = picked().map(makeLane);
    for (const ln of L.lanes) { ln.base = startLap(); if (isNum(ln.base)) { ln.best = ln.base; ln.curve = [ln.base]; } }
    L.y = yRange(); buildLanes(); L.boardDirty = true;
  }
  const startLap = () => (K.S.sum && isNum(K.S.sum.baseline_s) ? K.S.sum.baseline_s : null);
  function buildLanes() {
    const host = $("gpLiveLanes"); host.replaceChildren();
    const three = CARS3D();
    for (const ln of L.lanes) {
      const e = ln.e;
      const E = ln.els = {
        chip: el("span", { class: "gp-ll-chip" }), best: el("span", { class: "gp-ll-best" }), kv: el("dl", { class: "gp-ll-kv" }), sec: el("div", { class: "gp-ll-sec" }), note: el("div", { class: "gp-ll-note" }),
        bar: el("i"), chart: el("div", { class: "svgwrap gp-ll-svg" }), legend: el("div", { class: "gp-ll-lg" }),
        feed: el("ol", { class: "gp-feed", "aria-label": carOf(e) + ": ideas, newest first" }), car: three ? el("div", { class: "cmp-car gp-ll-car" }) : null, tag: el("div", { class: "cmp-car-tag" }),
      };
      const lab = e.control ? ["", "control · no language model"] : mock() ? [" mock", "mock, not a model"] : [" live", "live · real Mubit calls · untrained"];
      const lane = el("section", { class: "panel gp-ll" + (e.control ? " ctrl" : ""), "aria-label": carOf(e), style: "--gp-c:" + e.color },
        el("div", { class: "gp-ll-a" },
          el("div", { class: "gp-ll-h" }, el("div", { class: "cmp-lt" }, el("i"), el("span", { text: carOf(e) })), E.chip),
          el("div", { class: "gp-ll-w" }, el("code", { text: e.control ? "no model" : e.model || e.id }), " · ", el("span", { class: "gp-ll-lab" + lab[0], text: lab[1] })),
          E.car,
          el("div", { class: "gp-ll-gen" }, el("div", { class: "gp-ll-bar", "aria-hidden": "true" }, E.bar), E.gens = el("span", { class: "gp-ll-gv" }))),
        el("div", { class: "gp-ll-b" },
          el("div", { class: "gp-ll-bl" }, el("span", { class: "gp-ll-k", text: "best lap" }), E.best),
          E.kv, E.sec, E.note),
        el("div", { class: "gp-ll-c" },
          el("div", { class: "gp-ll-ch" }, el("span", { class: "gp-ll-k", text: "lap per decision · faster ↑" }), E.legend),
          E.chart),
        el("div", { class: "gp-ll-d" },
          el("div", { class: "gp-ll-ch" }, el("span", { class: "gp-ll-k", text: "ideas · newest first" }), el("span", { class: "gp-ll-k", text: e.control ? "random steps" : mock() ? "stand-in" : "via Mubit" })),
          E.feed));
      if (E.car) E.car.append(E.tag);
      host.append(lane);
      renderLane(ln);
    }
    if (three) mountCars();
  }
  function mountCars() {
    const gen = ++L.mountGen;
    for (const ln of L.lanes) ln.els.car.prepend(K.waitNote("the cars build one at a time…"));
    (async () => { for (const ln of L.lanes) { if (gen !== L.mountGen) return; await K.mountOne(ln, gen, () => L.mountGen); } })();
  }
  function disposeCars() { L.mountGen++; for (const ln of L.lanes) if (ln.view) { try { ln.view.dispose(); } catch (e) { /* gone */ } ln.view = null; } }

  function renderLane(ln) {
    const E = ln.els; if (!E) return;
    const B = budget(), d = x => el("span", { class: isNum(x) ? (x < 0 ? "under" : "over") : "", text: isNum(x) ? sg(x) + " s" : "—" });
    E.best.replaceChildren(isNum(ln.best) ? f3(ln.best) : "—", el("small", { text: " s" }));
    E.best.classList.toggle("start", !ln.gens);
    const kv = [
      ["vs RB22 start", d(isNum(ln.best) && isNum(ln.base) ? ln.best - ln.base : null)],
      ["vs real pole", d(isNum(ln.best) ? ln.best - POLE : null)],
      ["grid (projected)", el("span", { text: ln.grid != null ? "P" + ln.grid + (L.field ? " / " + L.field : "") : "—" })],
      ["kept", el("span", { text: ln.kept + "/" + ln.gens })],
      ["illegal as proposed", el("span", { text: ln.illegal + "/" + ln.gens })],
      ["versions screened", el("span", { text: int(ln.versions) })],
      ["physics laps", el("span", { text: int(ln.laps) })],
    ];
    if (!ln.e.control && !mock()) kv.push(["random fallbacks", el("span", { class: ln.fb.parse + ln.fb.error ? "warn" : "", text: (ln.fb.parse + ln.fb.error) + "/" + ln.gens, title: ln.fb.parse + " unparsable answers, " + ln.fb.error + " failed calls" })]);
    E.kv.replaceChildren(...kv.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", {}, v)]));
    // sector times of the best car (the engine's result node), against the start car
    if (ln.sectors && ln.sectors.length) E.sec.replaceChildren(...ln.sectors.map((s, i) => el("span", { class: "gp-s" }, el("b", { text: "S" + (i + 1) + " " }), f3(s), ln.baseSectors && isNum(ln.baseSectors[i]) ? el("small", { class: s - ln.baseSectors[i] < 0 ? "under" : "", text: " " + sgs(s - ln.baseSectors[i]) }) : null)));
    else E.sec.replaceChildren(el("span", { class: "gp-s muted", text: "sectors: after the first kept car" }));
    E.gens.replaceChildren(el("b", { text: String(ln.gens) }), "/" + B + " generations");
    E.bar.style.width = Math.min(100, 100 * ln.gens / B) + "%";
    const chip = ln.err && !ln.gens ? ["bad", "error"] : ln.done ? (ln.err ? ["bad", "ended " + clock(ln.t1 - ln.t0)] : ["end", "finished " + clock(ln.t1 - ln.t0)]) : ln.status === "ready" ? ["", "ready"] : ln.status === "waiting" ? ["wait", "waiting"] : ln.status === "starting" ? ["wait", "starting"] : ["on", "racing " + clock(Date.now() - ln.t0)];
    E.chip.className = "gp-ll-chip " + chip[0]; E.chip.textContent = chip[1];
    const bits = [];
    if (ln.done) bits.push(el("b", { text: ln.gens + "/" + B + " generations" }), ln.stop ? " · " + ln.stop : "");
    else if (ln.phase) bits.push(ln.round ? el("b", { text: "round " + ln.round + "/" + rounds() + " " }) : null, ln.phase);
    if (ln.err) bits.push(el("span", { class: "bad", text: (bits.length ? " · " : "") + ln.err }));
    if (ln.beat != null) bits.push(el("span", { class: "under", text: " · under the real pole at decision " + ln.beat }));
    E.note.replaceChildren(...bits.filter(x => x != null && x !== ""));
    chart(ln);
  }

  // ---------------------------------------------------------------- the progress chart (concept/lab/concept-lab.js renderChart, per lane)
  function yRange() {
    const base = Math.max(...L.lanes.map(x => x.base).filter(isNum), startLap() || POLE + 0.6);
    let lo = Math.min(POLE, base, ...L.lanes.map(x => x.best).filter(isNum)), hi = Math.max(base, POLE);
    const span = Math.max(0.2, hi - lo); lo -= span * 0.08; hi += span * 0.35;
    return { lo, hi };
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9)))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function chart(ln) {
    const wrap = ln.els.chart; if (!wrap.isConnected || !L.y) return;
    const W = Math.max(200, wrap.clientWidth), H = Math.max(120, wrap.clientHeight);
    const pad = { l: 46, r: 12, t: 10, b: 20 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, { lo, hi } = L.y, gN = budget(), base = ln.base;
    const X = g => pad.l + (g / gN) * iw, Y = v => pad.t + ((v - lo) / (hi - lo)) * ih, yC = v => Math.max(pad.t, Math.min(pad.t + ih, Y(v)));
    const nodes = [], stepY = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find(s => (hi - lo) / s <= 6) || 1;
    for (let v = Math.ceil(lo / stepY) * stepY; v <= hi + 1e-9; v += stepY) nodes.push(sv("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }), sv("text", { class: "ax", x: pad.l - 6, y: Y(v) + 3, "text-anchor": "end", text: v.toFixed(2) }));
    const stepX = niceStep(gN / 5);
    for (let g = 0; g <= gN + 1e-9; g += stepX) if (X(g) < W - pad.r - 70 || g === 0) nodes.push(sv("text", { class: "ax", x: X(g), y: H - 5, "text-anchor": "middle", text: String(g) }));
    nodes.push(sv("text", { class: "ax", x: W - pad.r, y: H - 5, "text-anchor": "end", text: "decision →" }));
    nodes.push(sv("line", { class: "ref pole", x1: pad.l, x2: W - pad.r, y1: Y(POLE), y2: Y(POLE) }), sv("text", { class: "reft", x: W - pad.r - 4, y: Y(POLE) - 4, "text-anchor": "end", text: "real pole ANT " + f3(POLE) + " · OpenF1 2026" }));
    if (isNum(base)) nodes.push(sv("line", { class: "ref base", x1: pad.l, x2: W - pad.r, y1: Y(base), y2: Y(base) }), sv("text", { class: "reft", x: W - pad.r - 4, y: Y(base) + 11, "text-anchor": "end", text: "RB22 start " + f3(base) }));
    for (const r of ln.rows) {
      if (!r.kept && isNum(r.lap)) { const y = Y(r.lap); nodes.push(y > pad.t + ih ? sv("path", { class: "rej clip", d: `M${X(r.gen) - 3},${pad.t + ih - 4} l3,4 l3,-4` }) : sv("circle", { class: "rej", cx: X(r.gen), cy: y, r: 2.2 })); }
      else if (!r.legal) nodes.push(sv("path", { class: "ill", d: `M${X(r.gen) - 2.5},${pad.t + ih - 6} l5,5 m0,-5 l-5,5` }));
    }
    if (isNum(base)) {
      let dd = `M${X(0)},${yC(base)}`, cur = base;
      for (const r of ln.rows) if (isNum(r.peak) && r.peak < cur - 1e-9) { dd += ` H${X(r.gen)} V${yC(r.peak)}`; cur = r.peak; }
      dd += ` H${X(ln.rows.length ? ln.rows[ln.rows.length - 1].gen : 0)}`;
      nodes.push(sv("path", { class: "bestline", d: dd }));
      for (const r of ln.rows) if (r.kept && isNum(r.lap)) nodes.push(sv("circle", { class: "kept", cx: X(r.gen), cy: yC(r.lap), r: 3 }, sv("title", { text: "decision " + r.gen + " kept · " + f3(r.lap) + " s" })));
    }
    const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": carOf(ln.e) + ": Silverstone lap per decision" }, ...nodes);
    if (!ln.rows.length) svg.append(sv("text", { class: "ax hint", x: pad.l + iw / 2, y: pad.t + ih / 2, "text-anchor": "middle", text: ln.status === "ready" ? "the lap after each decision appears here" : "waiting for the first round…" }));
    wrap.replaceChildren(svg);
    const ill = ln.rows.filter(r => !r.legal).length;
    ln.els.legend.replaceChildren(el("span", { class: "lg" }, el("i", { class: "k" }), "kept " + ln.kept), el("span", { class: "lg" }, el("i", { class: "r" }), "rejected " + (ln.rows.length - ln.kept - ill)), el("span", { class: "lg" }, el("i", { class: "x" }), "no legal car " + ill), el("span", { class: "src", text: "physics lap sim" }));
  }

  // ---------------------------------------------------------------- the feed: the homepage's card (verdict, the model's words, the change,
  // the lap as written, versions and physics laps, then who answered, the request id, the latency)
  function card(ln, n) {
    let c = ln.cards.get(n); if (c) return c;
    c = { n, root: el("li", { class: "ln mu-card pend" }), l1: el("div", { class: "l1" }), v: el("span", { class: "mu-v wait", text: "testing…" }), hyp: el("div", { class: "mu-hyp" }), chg: el("div", { class: "mu-chg" }), res: el("div", { class: "mu-res" }), meta: el("div", { class: "mu-meta" }) };
    c.l1.append(el("span", { class: "g num", text: "#" + n }), c.v);
    c.root.append(c.l1, c.hyp, c.chg, c.res, c.meta);
    ln.cards.set(n, c);
    ln.els.feed.prepend(c.root);
    return c;
  }
  function fillCard(ln, c, d) {
    const call = d.call || {}, fbk = d.by === "engine";
    if (ln.e.control) c.hyp.replaceChildren(el("span", { class: "muted", text: "random direction (control, no model)" }));
    else if (fbk) { c.hyp.replaceChildren(el("span", { class: "warn", text: "no usable answer: random step · " }), el("span", { class: "muted", text: trim(d.fallback_reason || "", 120) })); c.root.classList.add("fb"); if (!c.fbChip) { c.fbChip = el("span", { class: "mu-chip warn", text: "random fallback" }); c.l1.append(c.fbChip); } }
    else if (d.hypothesis) { c.hyp.textContent = "“" + trim(d.hypothesis, 220) + "”"; c.hyp.title = d.hypothesis; }
    const change = d.change || d.proposal_change;
    if (change) { c.chg.replaceChildren(el("span", { class: "k", text: "Proposed " }), plainChange(change, 2)); c.chg.title = plainChange(change, 99); }
    const rid = call.mubit_request_id || d.mubit_request_id || null, model = call.model || d.model || null, ms = isNum(call.latency_ms) ? call.latency_ms : d.latency_ms;
    if (model && !mock()) ln.model = model;
    c.meta.replaceChildren(...join([
      el("span", { text: ln.e.control ? "no call" : mock() ? "stand-in, not a model" : (model || ln.model || ln.e.model || "") }),
      rid ? el("code", { class: "mu-rid", title: "x-middleware-request-id " + rid + " (untrained call)", text: rid }) : null,
      !rid && !ln.e.control && call.error ? el("span", { class: "bad", text: "call failed: " + trim(call.error, 60) }) : null,
      isNum(ms) && !ln.e.control ? el("span", { class: "num", text: (ms / 1000).toFixed(1) + " s" }) : null,
      d.round != null ? el("span", { text: "round " + d.round + " · idea " + d.slot + "/" + d.of }) : null,
      d.focus ? el("span", { class: "mu-focus", text: "focus: " + d.focus }) : null]));
  }
  // the verdict = what physics did with the idea (the homepage card's rule)
  function verdict(row) {
    const why = "physics lap sim · Silverstone · the engine's best legal version of this idea vs the car it started from";
    if (row.kept && isNum(row.d_head_s)) return ["good", "✓ kept " + sgs(row.d_head_s) + " s", why + " · this car was kept"];
    if (isNum(row.best_d_s) && row.best_d_s < -0.0005) return ["good", "✓ faster car " + sgs(row.best_d_s) + " s", why + " · another idea of the same round was faster still"];
    if (!isNum(row.best_d_s) && row.as_proposed && row.as_proposed.legal === false) return ["bad", "✗ illegal: " + ruleWords(row.as_proposed), "rules broken as written: " + (row.as_proposed.articles || []).join(", ")];
    return ["bad", "✗ no faster car", why + (isNum(row.best_d_s) ? " · best version " + sgs(row.best_d_s) + " s" : "")];
  }
  function resLine(row) {
    const a = row.as_proposed, parts = [];
    if (a) parts.push(el("span", { class: "mu-asw", title: "the change exactly as written, one physics lap vs the car it started from" }, "as written: " + (a.legal === false ? "illegal (" + ruleWords(a) + ")" : isNum(a.d_lap_s) ? sgs(a.d_lap_s) + " s" : a.note || "—")));
    const tried = (row.screen && isNum(row.screen.distinct) ? int(row.screen.distinct) + " versions" : "") + (isNum(row.physics_laps) ? (row.screen ? " · " : "") + int(row.physics_laps) + " physics laps" : "");
    const best = (row.kept || (isNum(row.best_d_s) && row.best_d_s < -0.0005)) && row.best_change ? " · best: " + plainChange(row.best_change, 1) : "";
    if (tried || best) parts.push(el("span", { class: "mu-eng" + (row.kept ? " kept" : "") }, tried + best));
    return join(parts);
  }

  // ---------------------------------------------------------------- one run per lane: POST, then its stream
  async function launch(ln) {
    if (ln.gen !== L.gen || ln.done) return;
    const body = Object.assign({}, RUN, { llm: L.mode, model: ln.e.id, rounds: rounds(), seed: L.seed });
    if (rounds() < RUN.stop_after) body.stop_after = rounds();
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
      // a local server may run fewer engines at once (PURPLE_ENGINE_RUNS): the lane waits its turn
      if (/already running/i.test(msg) && !ln.stopAsked) { ln.status = "waiting"; ln.phase = "waiting: the server is running its maximum of engines"; dirty(ln); setTimeout(() => launch(ln), 2000); return; }
      return endLane(ln, msg);
    }
    ln.run = j.data; ln.status = "running"; ln.t0 = Date.now(); ln.phase = "starting the engine";
    entrantFrom(ln, j.data && j.data.opts);
    if (ln.stopAsked) stopLane(ln);
    dirty(ln);
    follow(ln, /^https?:/.test(j.data.stream) ? j.data.stream : API + j.data.stream);
  }
  function entrantFrom(ln, o) { const x = o && o.entrant; if (x && x.model && !mock()) ln.model = x.model; }
  function follow(ln, url) {
    const es = new EventSource(url); ln.es = es;
    const who = mock() ? "the stand-in" : ln.e.control ? "the random step" : shortOf(ln.e);
    const on = (t, f) => es.addEventListener(t, ev => {
      if (ln.gen !== L.gen) return;
      let d; try { d = JSON.parse(ev.data); } catch (x) { return; }
      if (typeof d.seq === "number") { if (d.seq <= ln.lastSeq) return; ln.lastSeq = d.seq; }
      try { f(d); } catch (x) { console.error("gp live " + t + ": " + (x && x.stack || x)); }
      dirty(ln);
    });
    on("start", d => {
      entrantFrom(ln, d.opts);
      if (d.baseline && isNum(d.baseline.lap_s)) { ln.base = d.baseline.lap_s; ln.baseSectors = d.baseline.sectors_s || null; if (!ln.rows.length) { ln.curve = [ln.base]; ln.best = ln.base; } L.y = yRange(); redrawAll(); }
      ln.phase = "starting from the RB22";
    });
    on("round", d => { ln.round = d.round; ln.phase = "asking " + who + " for " + d.ideas + " ideas…"; });
    on("proposal", d => fillCard(ln, card(ln, d.decision), d));
    on("progress", d => { if (d.stage === "screen" && d.round != null) ln.phase = "testing versions on the physics lap sim…"; });
    on("screen", d => { if (d.round != null) ln.phase = "driving physics laps on the best versions…"; });
    on("decision", d => decision(ln, d));
    on("round_done", d => { ln.phase = d.kept ? "kept " + sgs(d.d_head_s) + " s (idea " + d.winner_slot + ")" : "no faster car this round"; });
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
    if (isNum(d.grid_position)) ln.grid = d.grid_position;
    const peak = d.peak && isNum(d.peak.lap_s) ? d.peak.lap_s : null;
    if (isNum(peak)) ln.best = peak;   // the run's best car so far (the engine's peak never gets slower)
    const lap = row.result && isNum(row.result.lap_s) ? row.result.lap_s : null;
    ln.rows.push({ gen: x, lap, kept: !!row.kept, legal: !!row.result, peak });
    if (row.kept) ln.kept++;
    if (row.as_proposed && row.as_proposed.legal === false) ln.illegal++;
    if (row.screen && isNum(row.screen.distinct)) ln.versions += row.screen.distinct;
    if (isNum(row.physics_laps)) ln.laps += row.physics_laps;
    if (d.stats) { if (isNum(d.stats.variants_screened)) ln.versions = Math.max(ln.versions, d.stats.variants_screened); if (isNum(d.stats.physics_laps)) ln.laps = Math.max(ln.laps, d.stats.physics_laps); }
    if (row.result && d.peak && row.result.node === d.peak.node && row.result.sectors_s) ln.sectors = row.result.sectors_s;
    if (d.peak && d.peak.params) { ln.L.designs.push({ laps: x, params: d.peak.params }); ln.wantDesign = ln.L.designs.length - 1; ln.bestParams = d.peak.params; }
    if (ln.beat == null && isNum(ln.best) && ln.best < POLE) ln.beat = x;
    if (row.by === "engine" && !ln.e.control) { if (/^llm_error/.test(row.fallback_reason || "")) ln.fb.error++; else ln.fb.parse++; }
    const c = card(ln, n);
    fillCard(ln, c, Object.assign({}, row, { call: d.call || null, change: row.proposal_change }));
    const [cls, text, title] = verdict(row);
    c.v.className = "mu-v " + cls; c.v.textContent = text; c.v.title = title;
    c.res.replaceChildren(...resLine(row));
    c.root.classList.remove("pend"); if (row.kept) c.root.classList.add("ok");
    const ys = yRange(); if (!L.y || Math.abs(ys.lo - L.y.lo) > 1e-9 || Math.abs(ys.hi - L.y.hi) > 1e-9) { L.y = ys; redrawAll(); }
    L.boardDirty = true;
  }
  function stopNote(d) {
    const why = String(d.stop_reason || "");
    if (/time limit|time box|deadline/.test(why)) return "stopped at the time limit";
    if (/stopped by user/.test(why)) return "stopped by you";
    if (/all \d+ rounds done|rounds done|decision cap|call budget/.test(why)) return "full budget";
    if (/no new peak/.test(why)) return "stopped: no new best car for " + (why.match(/\d+/) || ["several"])[0] + " rounds";
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
    if (!ln.run) { if (ln.status !== "running") endLane(ln, "not started (stopped)"); return; }
    try { await fetch(API + "/api/concept/engine/run/" + ln.run.run_id + "/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); } catch (e) { /* the stream ends anyway */ }
  }

  // ---------------------------------------------------------------- start / stop
  function start() {
    const list = picked(); if (!list.length || !L.mode || L.status === "running") return;
    closeAll(); disposeCars();
    L.gen++; L.seed = q.get("seed") && +q.get("seed") >= 0 ? Math.floor(+q.get("seed")) : 1 + Math.floor(Math.random() * 99999);
    L.lanes = list.map(makeLane); L.status = "running"; L.t0 = Date.now(); L.t1 = 0;
    for (const ln of L.lanes) { ln.base = startLap(); if (isNum(ln.base)) { ln.best = ln.base; ln.curve = [ln.base]; } ln.status = "starting"; }
    L.y = yRange();
    $("gpLiveRace").hidden = true;
    buildLanes(); L.boardDirty = true; renderHead();
    for (const ln of L.lanes) launch(ln);
  }
  function closeAll() { for (const ln of L.lanes) if (ln.es) { try { ln.es.close(); } catch (e) { /* closed */ } ln.es = null; } }
  function stopAll() { for (const ln of L.lanes) if (!ln.done) stopLane(ln); }

  // ---------------------------------------------------------------- standings: the table at the top and the pinned strip (re-rank live)
  const ranked = () => L.lanes.slice().sort((a, b) => ((a.gens && isNum(a.best)) ? a.best : 1e9) - ((b.gens && isNum(b.best)) ? b.best : 1e9) || L.lanes.indexOf(a) - L.lanes.indexOf(b));
  function board() {
    const T = $("gpLiveBoard"), B = budget(), lanes = ranked(), now = performance.now();
    const has = ln => ln.gens > 0 && isNum(ln.best);
    const lead = lanes.length && has(lanes[0]) ? lanes[0].best : null;
    T.replaceChildren(el("thead", {}, el("tr", {}, el("th", { class: "pos", text: "Pos" }), el("th", { text: "Car" }), el("th", { class: "n", text: "Best lap" }), el("th", { class: "n opt", text: "Gap" }), el("th", { class: "n", text: "vs real pole" }), el("th", { class: "n", text: "Gen" }))));
    const rows = lanes.map((ln, i) => ({ ln, s: has(ln) ? ln.best : 1e9, pos: i + 1 }));
    rows.push({ pole: true, s: POLE });
    rows.sort((a, b) => a.s - b.s || (a.pole ? 1 : 0) - (b.pole ? 1 : 0));
    const tb = el("tbody"), strip = [];
    for (const x of rows) {
      if (x.pole) {
        tb.append(el("tr", { class: "pole" }, el("td", { class: "pos" }),
          el("td", {}, el("span", { class: "nm" }, el("span", { class: "gp-chip pole" }), "Real pole"), el("span", { class: "sub", text: "Antonelli · OpenF1 2026" })),
          el("td", { class: "n t", text: f3(POLE) }), el("td", { class: "n opt muted", text: lead != null ? sg(POLE - lead) : "" }), el("td", { class: "n muted", text: "reference" }), el("td", { class: "n" })));
        strip.push(el("span", { class: "gp-sc pole" }, el("i"), "ANT ", el("b", { text: f3(POLE) }), el("small", { text: " OpenF1 2026" })));
        continue;
      }
      const ln = x.ln, e = ln.e, ok = has(ln), g = ok ? ln.best - POLE : null;
      if (ln.pos != null && ln.pos !== x.pos && ok) ln.movedAt = now;
      ln.pos = x.pos; const moved = ln.movedAt && now - ln.movedAt < 1600;
      const sub = e.control ? "control · no language model" : mock() ? e.model + " · mock, not a model" : ln.model || e.model;
      tb.append(el("tr", { class: (x.pos === 1 && ok ? "p1" : "") + (e.control ? " ctrl" : "") + (moved ? " moved" : ""), style: "--rc:" + e.color },
        el("td", { class: "pos", text: ok ? "P" + x.pos : "" }),
        el("td", {}, el("span", { class: "nm" }, el("span", { class: "gp-chip" }), carOf(e)), el("span", { class: "sub", text: sub + (ln.done && ln.stop && ln.stop !== "full budget" ? " · " + ln.stop : "") })),
        el("td", { class: "n t", text: ok ? f3(ln.best) : "—" }),
        el("td", { class: "n opt muted", text: !ok ? "" : x.pos === 1 ? "leader" : sg(ln.best - lead) }),
        el("td", { class: "n " + (g != null && g < 0 ? "under" : "over"), text: g == null ? "—" : sg(g) }),
        el("td", { class: "n", text: ln.gens + "/" + B })));
      strip.push(el("span", { class: "gp-sc" + (moved ? " moved" : ""), style: "--gp-c:" + e.color }, el("b", { class: "p", text: ok ? "P" + x.pos : "·" }), el("i"), shortOf(e) + " ", el("b", { text: ok ? f3(ln.best) : "—" }), el("small", { text: " " + ln.gens + "/" + B })));
    }
    T.append(tb);
    const S = $("gpStrip");
    S.hidden = !(L.status === "running" || L.status === "done");
    S.replaceChildren(el("span", { class: "gp-strip-t" }), ...strip);
    status();
  }

  // ---------------------------------------------------------------- the end: one button, the race (providers only)
  function renderEnd() {
    const B = budget(), base = K.S.base;
    const cars = L.lanes.filter(x => !x.e.control && isNum(x.best) && x.gens > 0 && base).map(x => {
      const d = K.designFrom(x.bestParams || base.params); d.id = "gp-live-" + x.e.id; d.label = carOf(x.e) + " · Model GP live"; d.team = "redbull";
      return { name: carOf(x.e), code: x.e.code, color: x.e.color, lap_s: x.best, seed: L.seed, design: d, note: (mock() ? "mock, not a model · " : "live · ") + x.gens + "/" + B + " generations" };
    });
    const link = K.carsLink(cars, true, mock() ? "Model GP · offline demo" : "Model GP · live");
    const a = $("gpLiveRace");
    if (link) { a.href = link.url; a.hidden = false; a.title = link.n + " model cars + the real pole lap (Antonelli, OpenF1 2026); laps: physics lap sim"; }
    else a.hidden = true;
    L.boardDirty = true;
  }

  // ---------------------------------------------------------------- the frame loop (redraws only what changed)
  function dirty(ln) { L.dirty.add(ln); L.boardDirty = true; }
  function redrawAll() { for (const ln of L.lanes) L.dirty.add(ln); }
  let lastTick = 0;
  function frame(now) {
    if (L.status === "running" && now - lastTick > 1000) { lastTick = now; status(); for (const ln of L.lanes) if (!ln.done && ln.status === "running") L.dirty.add(ln); }
    if (L.dirty.size && !$("gpLive").hidden) { const list = [...L.dirty]; L.dirty.clear(); for (const ln of list) if (ln.gen === L.gen) renderLane(ln); }
    if (L.boardDirty) { L.boardDirty = false; board(); }
    if (L.lanes.length) K.pumpBuild(now, L.lanes);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    L.entrants = await K.getJson("entrants.json").then(j => j.entrants || [], () => []);
    if (!L.entrants.length) { $("gpLiveStatus").textContent = "entrants.json did not load"; return; }
    buildPick(); renderHead();
    $("gpLiveStart").addEventListener("click", start);
    $("gpLiveStop").addEventListener("click", stopAll);
    let rz = 0;
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (L.lanes.length) redrawAll(); }, 120); });
    probe();
    // the start car's lap comes with the recorded summary (gp.js): the idle lanes draw it once it is there
    const t0 = Date.now(), wait = setInterval(() => { maybeIdle(Date.now() - t0 > 5000); if (L.idleBuilt || L.status !== "idle") clearInterval(wait); }, 250);
    requestAnimationFrame(frame);
  }
  // test / screenshot hook
  EI.gpLive = { state: () => ({ mode: L.mode, status: L.status, seed: L.seed, lanes: L.lanes.map(x => ({ id: x.e.id, gens: x.gens, best: x.best, done: x.done, err: x.err, stop: x.stop, fb: x.fb, cards: x.cards.size, grid: x.grid, sectors: x.sectors })), race: $("gpLiveRace").hidden ? null : $("gpLiveRace").getAttribute("href") }), start, stopAll };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
