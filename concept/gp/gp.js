// PURPLE Model GP (/concept/gp/): which AI is the best race engineer? Every entrant (concept/gp/entrants.json) ran the SAME engine
// harness with the SAME frozen designer prompt, the same start car (RB22), the same scenario and the same budget of 150 physics
// simulations; seeds 1, 2, 3; the No-AI control takes random directions. This page plays back the recorded results only
// (concept/gp/data/summary.json + <entrant>-seed<N>.json, written by concept/gp/run.js): one lane per entrant with its 3D car (the
// side-by-side page's approach, concept/compare/compare.js: EI.conceptView, staggered builds, one rebuild per frame), best lap, curve
// and "beat the pole at N" on one clock of physics simulations (0 -> 150); then the podium, the results table, every curve on shared
// axes, the harness, and "Race them" (concept/race/ Qualifying lap mode with every entrant's final car of its median seed on one
// clock). This page never runs the sim and never calls Mubit. Nothing here is tuned or picked: every seed is in the table.
// URL: ?seed=median|1|2|3 &t=<simulations> &speed=1|4 &play=0
(function () {
  "use strict";
  const EI = window.EI || {}, C = EI.concept || {};
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) { if (k === "class") e.className = attrs[k]; else if (k === "text") e.textContent = attrs[k]; else if (k === "style") e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); } for (const c of kids) if (c != null) e.append(c); return e; };
  const f3 = v => (typeof v === "number" && isFinite(v) ? v.toFixed(3) : "—");
  const sg = v => (typeof v === "number" && isFinite(v) ? (v < 0 ? "−" : "+") + Math.abs(v).toFixed(3) : "—");
  const SIMS_PER_S = 10;   // 1× = 10 physics simulations per second of playback (150 in 15 s; 4×: under 4 s)
  const POLE_C = "#4ade80", BASE_C = "#8a8a94", ILLEGAL_C = "rgba(240, 80, 110, .55)";
  const LABEL = "physics lap sim · Silverstone · model prediction", POLE_LABEL = "real pole · OpenF1 2026";
  const q = new URLSearchParams(location.search);
  const S = { sum: null, budget: 150, pole: 88.111, base: null, seedSel: "median", t: 0, speed: [1, 4].includes(+q.get("speed")) ? +q.get("speed") : 4, playing: false, last: 0, lanes: [], y: null, mountGen: 0, t0: performance.now(), runs: new Map() };

  async function getJson(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(url + ": HTTP " + r.status); return r.json(); }
  const baseDesign = () => { try { return C.design.baseline({ team: "redbull" }); } catch (e) { return null; } };
  function designFrom(params) { const d = JSON.parse(JSON.stringify(S.base)); for (const p of Object.keys(params || {})) d.params[p] = Object.assign({}, d.params[p] || {}, params[p]); return d; }
  // a run file (tries + designs for the lane); the summary alone still gives the curve
  async function runFile(id, seed) {
    const k = id + "-seed" + seed;
    if (!S.runs.has(k)) S.runs.set(k, getJson("data/" + k + ".json").catch(() => null));
    return S.runs.get(k);
  }
  const seedOf = e => (S.seedSel === "median" ? e.median_seed : +S.seedSel);
  const runOf = (e, seed) => (e.runs || []).find(r => r.seed === seed) || null;

  // ---------------------------------------------------------------- lanes (one per entrant, compare.js's lane markup)
  async function buildLanes() {
    const host = $("gpLanes"); host.replaceChildren(); S.lanes = [];
    for (const e of S.sum.entrants) {
      const seed = seedOf(e), r = runOf(e, seed), file = seed != null ? await runFile(e.entrant, seed) : null;
      const curve = (file && file.curve) || (r && r.curve) || [S.sum.baseline_s];
      const L = { e, seed, r, curve, tries: (file && file.tries) || [], designs: (file && file.designs) || [{ laps: 0, best_s: S.sum.baseline_s, params: null }], beat: r ? r.beat_pole_at : null, status: r ? r.status : "missing", laps_used: r ? r.laps_used : 0 };
      const car = el("div", { class: "cmp-car" }), canvas = el("canvas", { role: "img", "aria-label": e.name + ": lap time of every simulation and the best so far" });
      const best = el("span", { class: "cmp-best-v" }), gap = el("div", { class: "cmp-gap" }), last = el("div", { class: "cmp-last" }), badge = el("div", { class: "cmp-badge" }), tag = el("div", { class: "cmp-car-tag" });
      const who = e.control ? "control · no language model" : (e.model || "") + " · " + (e.provider === "openai" ? "OpenAI route" : "Anthropic route") + " via Mubit";
      const lane = el("section", { class: "panel cmp-lane" + (e.control ? " ctrl" : ""), "aria-label": e.name, style: "--gp-c:" + e.color },
        el("div", { class: "cmp-lh" }, el("div", { class: "cmp-lt" }, el("i"), e.name), el("div", { class: "cmp-lw", text: who })),
        car,
        el("div", { class: "cmp-stats" }, el("div", { class: "cmp-best" }, el("span", { class: "cmp-best-l", text: "Best lap so far" }), best), el("div", { class: "cmp-side" }, gap, last)),
        badge, el("div", { class: "cmp-chart" }, canvas), el("div", { class: "cmp-src", text: laneSource(e, L) }));
      host.append(lane); car.append(tag);
      S.lanes.push({ e, L, els: { car, canvas, best, gap, last, badge, tag }, view: null, ready: false, k: -2, shownDesign: -1, wantDesign: 0, setAt: 0, hit: false, ctx: null });
    }
    const marks = $("gpMarks"); marks.replaceChildren();
    for (const ln of S.lanes) if (ln.L.beat != null) { const m = el("div", { class: "cmp-bar-mark", title: ln.e.name + ": beat the pole at " + ln.L.beat }); m.style.left = (100 * ln.L.beat / S.budget) + "%"; m.style.background = ln.e.color; ln.mark = m; marks.append(m); }
    yRange(); mountViews();
  }
  function laneSource(e, L) {
    if (!L.r) return "No run file for seed " + L.seed + ".";
    const r = L.r, by = r.ideas_by || {}, fb = (by.parse_failure || 0) + (by.llm_error || 0);
    const s = "Seed " + L.seed + (S.seedSel === "median" ? " (its median seed)" : "") + " · " + r.ideas + " ideas";
    if (e.control) return s + ", every direction random (the engine's own seeded step).";
    return s + ": " + (by.model || 0) + " from the model" + (fb ? ", " + fb + " fell back to a random step (" + (by.parse_failure || 0) + " unparsable answers, " + (by.llm_error || 0) + " API errors)" : "") + " · " + r.calls + " calls" + (r.status !== "complete" ? " · INCOMPLETE: " + (r.stop_reason || "") : "") + ".";
  }

  // ---------------------------------------------------------------- 3D (compare.js: one lane after another, one rebuild per frame)
  const VIEW_OPTS = { mode: "solid", view: "hero", label: false, legend: false, changeTags: false, pixelRatioCap: 1.5, reflection: false, aero: "corner", orbit: false, liverySize: 1024, shadows: false };
  const REBUILD_MS = 650;
  const waitNote = text => el("div", { class: "cmp-car-wait", text });
  const designAt = (ln, j) => (j > 0 && ln.L.designs[j].params ? designFrom(ln.L.designs[j].params) : S.base);
  function mountViews() {
    const gen = ++S.mountGen, can = !!(EI.conceptView && S.base);
    for (const ln of S.lanes) { ln.ready = false; ln.shownDesign = -1; ln.els.car.prepend(waitNote(can ? "Building the car…" : "3D view not loaded; the numbers still update.")); }
    if (can) (async () => { for (const ln of S.lanes) { if (gen !== S.mountGen) return; await mountOne(ln, gen); } })();
  }
  function disposeViews() { S.mountGen++; for (const ln of S.lanes) if (ln.view) { try { ln.view.dispose(); } catch (e) { /* gone */ } ln.view = null; } }
  function mountOne(ln, gen) {
    return new Promise(resolve => {
      const host = ln.els.car, j = ln.wantDesign, pane = el("div", { class: "cmp-car-view" });
      let settled = false; const next = () => { if (!settled) { settled = true; resolve(); } };
      const clearWait = () => { for (const w of host.querySelectorAll(".cmp-car-wait")) w.remove(); };
      pane.addEventListener("conceptview:ready", () => {
        if (gen !== S.mountGen) return next();
        ln.ready = true;
        requestAnimationFrame(() => { if (gen === S.mountGen) clearWait(); requestAnimationFrame(next); });
      }, { once: true });
      host.prepend(pane);
      try { ln.view = EI.conceptView.mount(pane, Object.assign({ design: designAt(ln, j), baseline: S.base, parts: C.parts, livery: S.base.livery, ghostColor: parseInt(ln.e.color.slice(1), 16) }, VIEW_OPTS)); }
      catch (e) { pane.remove(); clearWait(); host.prepend(waitNote("3D view unavailable here (" + e.message + "); the numbers still update.")); return next(); }
      ln.shownDesign = j; ln.setAt = performance.now(); tagFor(ln, j);
      const watch = () => { if (settled) return; if (gen !== S.mountGen) return next(); const st = ln.view && ln.view.state(); if (st && st.error) { clearWait(); return next(); } setTimeout(watch, 250); };
      setTimeout(watch, 250);
    });
  }
  function tagFor(ln, j) { ln.els.tag.textContent = j === 0 ? "RB22 baseline" : "Best car so far · found at simulation " + ln.L.designs[j].laps; }
  function pumpBuild(now) {
    let pick = null;
    for (const ln of S.lanes) if (ln.ready && ln.view && ln.wantDesign !== ln.shownDesign && now - ln.setAt >= REBUILD_MS && (!pick || ln.setAt < pick.setAt)) pick = ln;
    if (!pick) return;
    const j = pick.wantDesign; pick.shownDesign = j; pick.setAt = now; tagFor(pick, j);
    try { pick.view.setDesign(designAt(pick, j), { baseline: S.base, animate: false, livery: S.base.livery }); } catch (e) { /* view optional */ }
  }

  // ---------------------------------------------------------------- charts
  function allCurves() { const out = []; for (const e of S.sum.entrants) for (const r of e.runs || []) out.push(r.curve || []); return out; }
  function yRange() {
    const vals = []; for (const c of allCurves()) for (const v of c) if (typeof v === "number") vals.push(v);
    const lo = Math.min(S.pole, ...vals) - 0.08, hi = Math.max(S.sum.baseline_s, ...vals) + 0.12;
    S.y = { lo: Math.floor(lo * 20) / 20, hi: Math.ceil(hi * 20) / 20 };
  }
  function sizeCanvas(c) {
    const r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { g: c.getContext("2d"), dpr, W: r.width, H: r.height };
  }
  function axes(cv, pad) {
    const { g, dpr, W, H } = cv, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const X = n => pad.l + pw * n / S.budget, Y = s => pad.t + ph * (S.y.hi - s) / (S.y.hi - S.y.lo);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.font = "500 11px Inter, system-ui, sans-serif"; g.textBaseline = "middle"; g.strokeStyle = "#202027"; g.lineWidth = 1; g.fillStyle = "#8a8a94";
    const step = (S.y.hi - S.y.lo) > 1.6 ? 0.5 : (S.y.hi - S.y.lo) > 0.6 ? 0.25 : 0.1;
    for (let v = Math.ceil(S.y.lo / step) * step; v <= S.y.hi + 1e-9; v += step) { const y = Math.round(Y(v)) + .5; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.textAlign = "right"; g.fillText(v.toFixed(2), pad.l - 5, y); }
    g.textAlign = "center"; g.textBaseline = "top";
    for (let x = 0; x <= S.budget; x += 25) { const px = Math.round(X(x)) + .5; g.beginPath(); g.moveTo(px, pad.t); g.lineTo(px, pad.t + ph); g.stroke(); if (x % 50 === 0 || W > 420) g.fillText(String(x), Math.min(px, W - pad.r - 8), pad.t + ph + 5); }
    const ref = (s, color, text) => { const y = Math.round(Y(s)) + .5; g.save(); g.setLineDash([5, 4]); g.strokeStyle = color; g.lineWidth = 1.3; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.restore(); g.fillStyle = color; g.textAlign = "right"; g.textBaseline = "bottom"; g.fillText(text, W - pad.r - 2, y - 2); };
    ref(S.sum.baseline_s, BASE_C, "RB22 start car " + f3(S.sum.baseline_s));
    ref(S.pole, POLE_C, "Real pole " + f3(S.pole) + " (OpenF1 2026)");
    return { g, X, Y, W, H, pad, ph };
  }
  function stepLine(g, X, Y, curve, end) {
    g.beginPath(); g.moveTo(X(0), Y(curve[0]));
    for (let i = 1; i < curve.length && i <= end; i++) { if (curve[i] !== curve[i - 1]) { g.lineTo(X(i), Y(curve[i - 1])); g.lineTo(X(i), Y(curve[i])); } }
    const n = Math.min(end, curve.length - 1); g.lineTo(X(n), Y(curve[n])); g.stroke();
    return n;
  }
  function draw(ln, end) {
    if (!ln.cv) ln.cv = sizeCanvas(ln.els.canvas);
    const { g, X, Y, W, pad, ph } = axes(ln.cv, { l: 40, r: 8, t: 14, b: 20 }), L = ln.L, c = ln.e.color;
    const n = Math.min(end, L.tries.length);
    g.fillStyle = hexA(c, 0.45);
    for (let i = 0; i < n; i++) { const s = L.tries[i][1]; if (s == null || s > S.y.hi) continue; g.fillRect(X(L.tries[i][0]) - 1.3, Y(s) - 1.3, 2.6, 2.6); }
    g.fillStyle = ILLEGAL_C; for (let i = 0; i < n; i++) if (L.tries[i][1] == null) g.fillRect(X(L.tries[i][0]) - 0.6, pad.t - 7, 1.2, 4);
    g.strokeStyle = c; g.lineWidth = 2.4; g.lineJoin = "round"; g.setLineDash(ln.e.control ? [6, 4] : []);
    const k = stepLine(g, X, Y, L.curve, end); g.setLineDash([]);
    if (end > 0) { g.fillStyle = c; g.beginPath(); g.arc(X(k), Y(L.curve[k]), 3.4, 0, Math.PI * 2); g.fill(); }
    if (L.beat != null && end >= L.beat) { const px = Math.round(X(L.beat)) + .5; g.strokeStyle = POLE_C; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, pad.t); g.lineTo(px, pad.t + ph); g.stroke(); g.fillStyle = POLE_C; g.textBaseline = "top"; g.textAlign = px > W * 0.6 ? "right" : "left"; g.fillText("Beat the pole at " + L.beat, px + (px > W * 0.6 ? -4 : 4), pad.t + ph - 26); }
  }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; }
  function drawCurves() {
    const cv = sizeCanvas($("gpCurves")), { g, X, Y } = axes(cv, { l: 46, r: 10, t: 14, b: 22 });
    for (const pass of [0, 1]) for (const e of S.sum.entrants) for (const r of e.runs || []) {
      const med = r.seed === e.median_seed; if ((pass === 1) !== med || !r.curve) continue;
      g.strokeStyle = hexA(e.color, med ? 1 : 0.28); g.lineWidth = med ? 2.4 : 1.2; g.setLineDash(e.control ? [6, 4] : []);
      stepLine(g, X, Y, r.curve, S.budget);
    }
    g.setLineDash([]);
    $("gpLegend").replaceChildren(...S.sum.entrants.map(e => el("span", {}, el("i", { style: "background:" + e.color + (e.control ? ";opacity:.7" : "") }), e.name + " · median seed " + (e.median_seed == null ? "—" : e.median_seed))));
  }

  // ---------------------------------------------------------------- the clock
  function update(now, force) {
    const t = S.t, end = Math.floor(t + 1e-9);
    $("gpLaps").textContent = String(end); $("gpBar").style.width = (100 * t / S.budget) + "%";
    for (const ln of S.lanes) {
      const L = ln.L, k = Math.min(end, L.curve.length - 1);
      if (ln.mark) ln.mark.classList.toggle("on", L.beat != null && end >= L.beat);
      if (k === ln.k && !force) continue;
      ln.k = k;
      const best = L.curve[k], gap = best - S.pole;
      ln.els.best.replaceChildren(f3(best), el("small", { text: " s" }));
      ln.els.gap.className = "cmp-gap " + (gap < 0 ? "under" : "over");
      ln.els.gap.textContent = gap < 0 ? (-gap).toFixed(3) + " s under the real pole" : "+" + gap.toFixed(3) + " s to the real pole";
      const tr = k > 0 ? L.tries[k - 1] : null;
      if (tr) ln.els.last.replaceChildren("Simulation " + k + ": ", el("b", { text: tr[1] != null ? f3(tr[1]) + " s" : "broke a rule, no lap" }));
      else ln.els.last.textContent = k > 0 ? "" : "Starts from the RB22";
      let j = 0; for (let i = 0; i < L.designs.length; i++) if (L.designs[i].laps <= k) j = i;
      ln.wantDesign = j;
      badge(ln, end); draw(ln, k);
    }
    pumpBuild(now);
  }
  function badge(ln, end) {
    const L = ln.L, b = ln.els.badge, hit = L.beat != null && end >= L.beat;
    if (hit) { if (!ln.hit) { b.className = "cmp-badge hit"; ln.hit = true; } b.textContent = "Beat the pole at " + L.beat; return; }
    ln.hit = false; const over = end >= Math.min(S.budget, L.laps_used || S.budget);
    b.className = "cmp-badge" + (over ? " end" : ""); b.textContent = over ? "Did not beat the pole in " + (L.laps_used || S.budget) + " simulations" : "Not under the real pole yet";
  }
  function frame(now) {
    if (S.playing) { const dt = Math.min(0.25, (now - (S.last || now)) / 1000); S.t = Math.min(S.budget, S.t + dt * SIMS_PER_S * S.speed); if (S.t >= S.budget) { S.playing = false; playBtn(); } }
    S.last = now; update(now, false); requestAnimationFrame(frame);
  }
  function playBtn() { $("gpPlay").textContent = S.playing ? "Pause" : S.t >= S.budget ? "Play again" : "Play"; }
  function setSpeed(v) { S.speed = v; for (const b of document.querySelectorAll(".cmp-speed .btn")) b.classList.toggle("on", +b.dataset.speed === v); }
  function restart() { S.t = 0; for (const ln of S.lanes) { ln.k = -2; ln.hit = false; } update(performance.now(), true); }

  // ---------------------------------------------------------------- podium, table, harness, race link, footer
  // ranking: the median of each entrant's complete seeds (lower is better); an entrant with no complete seed is not ranked
  const ranked = () => S.sum.entrants.filter(e => typeof e.best_s_median === "number").slice().sort((a, b) => a.best_s_median - b.best_s_median);
  function podium() {
    const r = ranked(), host = $("gpPodium"); host.replaceChildren();
    for (const i of [1, 0, 2]) {
      const e = r[i]; if (!e) { host.append(el("div")); continue; }
      host.append(el("div", { class: "gp-step p" + (i + 1), style: "--sc:" + e.color }, el("div", { class: "who", text: e.name }), el("div", { class: "t", text: f3(e.best_s_median) + " s" }), el("div", { class: "g", text: sg(e.gap_to_pole_s_median) + " to pole" }), el("div", { class: "blk", text: "P" + (i + 1) })));
    }
  }
  function table() {
    const T = $("gpTable"), head = ["", "Entrant", "Best lap (s)", "vs pole (s)", "Sims to beat " + f3(S.pole), "Ideas: model / random fallback", "Unparsable answers", "API errors", "Illegal as proposed", "Calls", "Median latency", "Tokens in / out", "Seeds complete"];
    T.replaceChildren(el("tr", {}, ...head.map((h, i) => el("th", { class: i >= 2 && i !== 5 ? "n" : "", text: h }))));
    const row = (cls, cells) => T.append(el("tr", { class: cls }, ...cells));
    const td = (t, c) => el("td", { class: c || "n", text: t == null ? "—" : String(t) });
    const rank = ranked();
    const order = rank.concat(S.sum.entrants.filter(e => !rank.includes(e)));
    for (const e of order) {
      const pos = rank.indexOf(e), fb = (e.parse_failures || 0) + (e.llm_errors || 0), model = e.control ? 0 : Math.max(0, (e.ideas_total || 0) - fb);
      const name = el("td", { class: "" }, el("span", { class: "sw", style: "background:" + e.color }), e.name + (e.model ? " " : ""), e.model ? el("span", { class: "muted", text: "(" + e.model + ")" }) : null);
      row("", [td(pos >= 0 ? "P" + (pos + 1) : "—", ""), name, td(f3(e.best_s_median) + " · median"), td(sg(e.gap_to_pole_s_median), "n " + (e.gap_to_pole_s_median < 0 ? "under" : "")), td(e.beat_pole_at_median != null ? e.beat_pole_at_median + " (" + e.beat_pole_n + "/" + e.complete + " seeds)" : "not reached (" + e.beat_pole_n + "/" + e.complete + ")"),
        td(e.control ? "0 / " + e.ideas_total + " (control)" : model + " / " + fb, "n " + (fb ? "warn" : "")), td(e.control ? "—" : e.parse_failures, "n " + (e.parse_failures ? "warn" : "")), td(e.control ? "—" : e.llm_errors, "n " + (e.llm_errors ? "bad" : "")),
        td(e.control ? "—" : e.illegal_as_proposed + " / " + e.proposals), td(e.calls), td(e.latency_ms_median != null ? Math.round(e.latency_ms_median) + " ms" : "—"), td(e.tokens_in_median != null ? Math.round(e.tokens_in_median) + " / " + Math.round(e.tokens_out_median) + " per run" : "—"), td(e.complete + " / " + e.of)]);
      for (const r of e.runs || []) {
        const fbr = (r.parse_failures || 0) + (r.llm_errors || 0);
        row("seed", [td("", ""), td("seed " + r.seed + (r.seed === e.median_seed ? " · median" : "") + (r.status !== "complete" ? " · INCOMPLETE" : ""), ""), td(f3(r.best_s)), td(sg(r.gap_to_pole_s), "n " + (r.gap_to_pole_s < 0 ? "under" : "")), td(r.beat_pole_at != null ? r.beat_pole_at : "not reached"),
          td(e.control ? "0 / " + r.ideas : (r.ideas - fbr) + " / " + fbr), td(e.control ? "—" : r.parse_failures), td(e.control ? "—" : r.llm_errors), td(e.control ? "—" : r.illegal_as_proposed + " / " + r.proposals), td(r.calls), td(r.latency_ms_median != null ? Math.round(r.latency_ms_median) + " ms" : "—"), td(r.tokens_in != null ? r.tokens_in + " / " + r.tokens_out : "—"), td(r.laps_used + " sims")]);
      }
    }
  }
  function harness() {
    const H = S.sum.settings || {}, rows = [
      ["physics simulations per run", H.budget_physics_laps], ["seeds", (S.sum.seeds || []).join(", ")], ["start car", H.start_car],
      ["per idea", H.variants + " variants screened, " + H.confirm + " + " + H.explore + " (explore) confirmed on the physics lap sim"],
      ["system prompt", H.system_prompt + " · sha256 " + String(H.system_prompt_sha256 || "").slice(0, 12) + "…"], ["user message", H.user_message],
      ["corrections in the scenario", H.corrections ? "on" : "off"], ["shared memory of physics-approved precedents", H.memory ? "on" : "off"],
      ["Mubit calls", "untrained (" + H.record_header + "); one idea per call, one call at a time per run"],
      ["what differs per entrant", "only the model id, and where a model needs it: temperature left out, 4,000 output tokens (models that think first)"],
    ];
    $("gpHarness").replaceChildren(...rows.flatMap(([k, v]) => [el("span", { class: "k", text: k }), el("span", { class: "v", text: v == null ? "—" : String(v) })]));
    $("gpHarnessSrc").textContent = "recorded in every run file (concept/gp/data/)";
  }
  // every entrant's final car of its median seed, ordered by sim lap, on one Qualifying-lap clock (concept/race/payload.js carsUrl)
  function raceLink() {
    const RP = C.race; if (!RP || !RP.carsUrl) return null;
    const cars = S.sum.entrants.filter(e => e.race_car && e.race_car.design).map(e => ({ name: e.name, code: e.code, color: e.color, lap_s: e.race_car.lap_s, seed: e.race_car.seed, design: e.race_car.design, note: "median seed " + e.race_car.seed }))
      .sort((a, b) => a.lap_s - b.lap_s);
    if (!cars.length) return null;
    return { url: RP.carsUrl(cars.slice(0, RP.MAX_CARS || 8), { base: "../race/", title: "Model GP" }), n: cars.length };
  }
  function footer() {
    const f = $("gpFoot"); f.replaceChildren();
    const line = (...k) => f.append(el("span", {}, ...k)), b = t => el("b", { text: t });
    line("Every lap: ", b(LABEL), ". Dashed lines: the ", b(POLE_LABEL + " " + f3(S.pole) + " s"), " (Antonelli, 2026 British GP) and the RB22 start car on the same sim.");
    line("A single circuit (Silverstone), ", b("150 simulations"), " per run, seeds 1, 2, 3: results vary between seeds, so every seed is in the table. The ", b("No-AI control"), " (random directions, same engine) is included on purpose: a model has to beat it to show its ideas helped. An answer that does not parse takes the same random step and is counted as such, never credited to the model.");
    line("Recorded " + (S.sum.generated_at || "").slice(0, 10) + " by concept/gp/run.js · " + (S.sum.memory && S.sum.memory.on ? "shared memory on" : "shared memory off") + " · played back here: no new call.");
  }
  function emptyState(why) {
    $("gpLanes").replaceChildren(el("div", { class: "panel gp-empty" }, el("p", { text: "No Model GP results yet (" + why + "). Nothing is shown until the live run is recorded: no placeholder numbers." }),
      el("p", {}, "The run: ", el("code", { text: "node concept/gp/run.js --live --seeds 1,2,3 --memory off --out concept/gp/data" }))));
  }

  async function show() {
    disposeViews();
    await buildLanes();
    for (const ln of S.lanes) ln.cv = null;
    S.t = Math.max(0, Math.min(S.budget, +q.get("t") || S.t || 0)); for (const ln of S.lanes) ln.k = -2;
    update(performance.now(), true); playBtn();
  }
  async function init() {
    S.base = baseDesign();
    try { S.sum = await getJson("data/summary.json"); } catch (e) { return emptyState(e.message); }
    if (!S.sum.entrants || !S.sum.entrants.length) return emptyState("summary.json lists no entrant");
    S.budget = (S.sum.settings && S.sum.settings.budget_physics_laps) || 150; S.pole = S.sum.pole_s || 88.111;
    $("gpOf").textContent = "of " + S.budget + " physics simulations";
    if (S.sum.mock) { const bn = $("gpBanner"); bn.hidden = false; bn.textContent = "MOCK DATA: every model entrant here answered with the scripted mock (concept/designer/loop.js), not a model. These are not model results."; }
    const sel = $("gpSeed"); sel.append(el("option", { value: "median", text: "Median seed of each" }), ...(S.sum.seeds || []).map(s => el("option", { value: String(s), text: "Seed " + s })));
    const want = q.get("seed"); S.seedSel = want && [...sel.options].some(o => o.value === want) ? want : "median"; sel.value = S.seedSel;
    sel.addEventListener("change", async () => { const was = S.playing; S.playing = false; S.seedSel = sel.value; S.t = 0; await show(); S.playing = was; playBtn(); });
    $("gpPlay").addEventListener("click", () => { if (S.t >= S.budget) restart(); S.playing = !S.playing; S.last = 0; playBtn(); });
    $("gpRestart").addEventListener("click", () => { restart(); playBtn(); });
    for (const bt of document.querySelectorAll(".cmp-speed .btn")) bt.addEventListener("click", () => setSpeed(+bt.dataset.speed));
    setSpeed(S.speed);
    $("gpBelow").hidden = false;
    podium(); table(); harness(); footer();
    const race = raceLink();
    if (race) { for (const id of ["gpRace", "gpRace2"]) { $(id).href = race.url; $(id).hidden = false; } $("gpRaceNote").textContent = "Opens the Qualifying lap with all " + race.n + " cars (each entrant's fastest car of its median seed, physics lap sim) and the " + POLE_LABEL + " lap on one clock."; }
    else { $("gpRace2").hidden = true; $("gpRaceNote").textContent = "No race: no entrant has a complete run yet."; }
    await show();
    drawCurves();
    window.addEventListener("resize", () => { for (const ln of S.lanes) { ln.cv = null; ln.k = -2; } update(performance.now(), true); drawCurves(); });
    S.playing = q.get("play") !== "0" && S.t < S.budget; playBtn();
    window.__gp = S;
    requestAnimationFrame(frame);
  }
  init().catch(e => { $("gpLanes").replaceChildren(el("div", { class: "panel gp-empty", text: "Model GP failed to start: " + e.message })); });
})();
