// PURPLE side by side (/concept/compare/): three cars redesigning themselves on ONE clock, the test laps used (one car driven once on
// the physics lap sim), not wall time. Plays back measured data only (concept/compare/data/seed<N>.json, built by build.js):
//   lane A  PURPLE · Claude through Mubit: a recorded live trained engine run (docs/concept/loop-runs/trained-engineer-seed<N>/)
//   lane B  CMA-ES, no AI: the concept campaign's optimiser re-run locally on the same sim, same seed, same team
//   lane C  random legal parts, each driven once
// Each lane: its best design so far in 3D (EI.conceptView), the best lap, a chart with every car tested (dots) and the best so far
// (line), the real pole 88.111 s (ANT, OpenF1) and the RB22 baseline dashed. A round of cars tested together (an idea's batch, a
// CMA-ES round) appears when the round is done, as it was counted. This page never runs the sim and never calls Mubit.
// URL: ?seed=12 &t=<test laps> &speed=1|4|16 &play=0
(function () {
  "use strict";
  const EI = window.EI || {}, C = EI.concept || {};
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) { if (k === "class") e.className = attrs[k]; else if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); } for (const c of kids) if (c != null) e.append(c); return e; };
  const fmtN = n => Math.round(n).toLocaleString("en-GB");
  const f3 = v => (typeof v === "number" ? v.toFixed(3) : "—");
  const LAPS_PER_S = 25;   // 1× = 25 test laps per second of playback
  const LANES = [
    { id: "purple", cls: "a", color: "#b26cff", who: "Claude suggests one idea at a time through Mubit. PURPLE's engine checks thousands of variants of it for free, then test-drives the best few." },
    { id: "cmaes", cls: "b", color: "#5fb4ff", who: "Changes every setting at once, 16 to 64 cars a round, and learns from each round's lap times." },
    { id: "random", cls: "c", color: "#f2a541", who: "Every car changes every part at random, within the full range, pulled back towards the RB22 only as far as the rules need. Each is driven once." },
  ];
  const POLE_C = "#4ade80", BASE_C = "#8a8a94", ILLEGAL_C = "rgba(240, 80, 110, .55)";
  const q = new URLSearchParams(location.search);
  const S = { index: null, data: null, seed: null, t: 0, speed: [1, 4, 16].includes(+q.get("speed")) ? +q.get("speed") : 4, playing: false, last: 0, lanes: [], base: null, y: null };

  async function getJson(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(url + ": HTTP " + r.status); return r.json(); }
  const baseDesign = () => { try { return C.design.baseline({ team: "redbull" }); } catch (e) { return null; } };
  // the lane's design: the RB22 baseline Design with the run's params laid over it (a part the run's catalogue did not have keeps the
  // baseline's value: display only)
  function designFrom(params) {
    const d = JSON.parse(JSON.stringify(S.base));
    for (const p of Object.keys(params)) d.params[p] = Object.assign({}, d.params[p] || {}, params[p]);
    return d;
  }

  // ---------------------------------------------------------------- layout
  function buildLanes() {
    const host = $("cmpLanes"); host.replaceChildren();
    S.lanes = [];
    for (const spec of LANES) {
      const L = S.data.lanes[spec.id]; if (!L) continue;
      const car = el("div", { class: "cmp-car-view" }), canvas = el("canvas", { role: "img", "aria-label": L.title + ": lap time of every car tested and the best so far, against test laps used" });
      const best = el("span", { class: "cmp-best-v" }), gap = el("div", { class: "cmp-gap" }), last = el("div", { class: "cmp-last" }), badge = el("div", { class: "cmp-badge" }), tag = el("div", { class: "cmp-car-tag" });
      const lane = el("section", { class: "panel cmp-lane " + spec.cls, "aria-label": L.title },
        el("div", { class: "cmp-lh" }, el("div", { class: "cmp-lt" }, el("i"), L.title), el("div", { class: "cmp-lw", text: spec.who })),
        el("div", { class: "cmp-car" }, car, tag),
        el("div", { class: "cmp-stats" },
          el("div", { class: "cmp-best" }, el("span", { class: "cmp-best-l", text: "Best lap so far" }), best),
          el("div", { class: "cmp-side" }, gap, last)),
        badge,
        el("div", { class: "cmp-chart" }, canvas),
        el("div", { class: "cmp-src", text: sourceLine(spec.id, L) }));
      host.append(lane);
      S.lanes.push({ spec, L, els: { car, canvas, best, gap, last, badge, tag }, view: null, k: -2, shownDesign: -1, wantDesign: 0, setAt: 0, hit: false, ctx: null });
    }
    // the clock bar: where each lane beats the pole
    const marks = $("cmpMarks"); marks.replaceChildren();
    for (const ln of S.lanes) if (ln.L.to_pole) { const m = el("div", { class: "cmp-bar-mark", title: ln.L.title + ": beat the pole at " + fmtN(ln.L.to_pole.laps) + " test laps" }); m.style.left = (100 * ln.L.to_pole.laps / S.data.budget) + "%"; m.style.background = ln.spec.color; ln.mark = m; marks.append(m); }
    $("cmpOf").textContent = "of " + fmtN(S.data.budget) + " test laps used";
    yRange(); mountViews(); footer();
  }
  function sourceLine(id, L) {
    const s = S.data.seed;
    if (id === "purple") return "Recorded live run, seed " + s + ": " + L.calls + " ideas from Claude Haiku 4.5 through Mubit, each with a real Mubit request id. Played back here: no new call. Ended at " + fmtN(L.end_laps) + " test laps (its idea limit).";
    if (id === "cmaes") return "Re-run locally on the same sim, seed " + s + ", the concept campaign's own optimiser. A car that breaks a rule gets no lap but still counts.";
    return "Re-run locally, seed " + s + ". " + fmtN(L.legal_as_drawn || 0) + " of " + fmtN(L.end_laps) + " random cars passed the rules as drawn; the rest were pulled back towards the RB22 until they did (a free check, not a test lap).";
  }
  function footer() {
    const T = S.index && S.index.tests_to_pole, D = S.data, f = $("cmpFoot"); f.replaceChildren();
    const line = (...k) => f.append(el("span", {}, ...k));
    const b = t => el("b", { text: t });
    line("Every lap: ", b(D.label), ". Dashed lines: the real pole, ", b("88.111 s"), " (Antonelli, 2026 British GP, OpenF1), and the ", b("RB22 baseline " + f3(D.baseline.s) + " s"), " on the same sim.");
    if (T) {
      const P = T.to_pole_laps;
      // budgets where the steered runs' mean best lap is ahead of CMA-ES's (TESTS_TO_POLE.md §4.4; 2,000 has two steered runs)
      const ahead = Object.keys(T.best_at.steered).filter(B => T.best_at.steered[B].mean != null && T.best_at.cmaes[B].mean != null && T.best_at.steered[B].mean < T.best_at.cmaes[B].mean).map(B => fmtN(+B) + (T.best_at.steered[B].n < 3 ? " (" + T.best_at.steered[B].n + " runs)" : ""));
      line("Over the three recorded runs (seeds 7, 11, 12): PURPLE beat the pole after ", b(fmtN(P.steered.mean) + " ± " + fmtN(P.steered.sd)), " test laps on average, CMA-ES after ", b(fmtN(P.cmaes.mean) + " ± " + fmtN(P.cmaes.sd)), ahead.length ? "; PURPLE's average best lap was ahead at " + ahead.join(", ") + " test laps." : ".");
      f.append(el("span", { class: "cmp-honest" }, "Our engine with random directions was faster still on this cheap simulator (" + fmtN(P.engine_noai.mean) + " ± " + fmtN(P.engine_noai.sd) + " test laps to the pole): see ", el("code", { text: "TESTS_TO_POLE.md" }), "."));
    }
    line("Seed " + D.seed + (D.physics ? " · " + D.physics.replace(/\s*\(.*$/, "") : "") + ". Cars tested together in one round appear when the round is done.");
  }

  // ---------------------------------------------------------------- 3D
  function mountViews() {
    for (const ln of S.lanes) {
      if (ln.view) { try { ln.view.dispose(); } catch (e) { /* gone */ } ln.view = null; }
      if (!EI.conceptView || !S.base) { ln.els.car.replaceChildren(el("div", { class: "empty", text: "3D view not loaded; the numbers still update." })); continue; }
      try { ln.view = EI.conceptView.mount(ln.els.car, { design: S.base, baseline: S.base, parts: C.parts, mode: "solid", view: "hero", label: false, legend: false, changeTags: false, livery: S.base.livery, pixelRatioCap: 1.5, reflection: false, aero: "corner" }); }
      catch (e) { ln.els.car.replaceChildren(el("div", { class: "empty", text: "3D view unavailable here (" + e.message + "); the numbers still update." })); }
      ln.shownDesign = 0; ln.setAt = 0;
    }
  }
  function showDesign(ln, now, force) {
    const j = ln.wantDesign; if (j === ln.shownDesign) return;
    if (!force && now - ln.setAt < 650) return;   // at most one rebuild per 0.65 s per car; the latest best design wins
    const D = ln.L.designs[j];
    ln.shownDesign = j; ln.setAt = now;
    ln.els.tag.textContent = j === 0 ? "RB22 baseline" : "best design so far · found at " + fmtN(D.laps) + " test laps";
    if (!ln.view) return;
    try { ln.view.setDesign(designFrom(D.params), { baseline: S.base, animate: !force, livery: S.base.livery }); } catch (e) { /* view optional */ }
  }

  // ---------------------------------------------------------------- charts
  function yRange() {
    const lo = Math.min(...S.lanes.map(l => Math.min(l.L.final_s, S.data.pole.s))) - 0.12, hi = Math.max(...S.lanes.map(l => l.L.baseline_s)) + 0.45;
    S.y = { lo: Math.floor(lo * 20) / 20, hi: Math.ceil(hi * 20) / 20 };
  }
  function sizeCanvas(ln) {
    const c = ln.els.canvas, r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ln.ctx = c.getContext("2d"); ln.dpr = dpr; ln.W = r.width; ln.H = r.height;
  }
  function draw(ln, end) {
    if (!ln.ctx) sizeCanvas(ln);
    const g = ln.ctx, W = ln.W, H = ln.H, dpr = ln.dpr, L = ln.L, D = S.data;
    const pad = { l: 44, r: 10, t: 14, b: 20 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const X = laps => pad.l + pw * laps / D.budget, Y = s => pad.t + ph * (S.y.hi - s) / (S.y.hi - S.y.lo);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.font = "500 10px Inter, system-ui, sans-serif"; g.textBaseline = "middle";
    // grid
    g.strokeStyle = "#202027"; g.lineWidth = 1; g.fillStyle = "#6c6c76";
    const step = (S.y.hi - S.y.lo) > 1.6 ? 0.5 : 0.25;
    for (let v = Math.ceil(S.y.lo / step) * step; v <= S.y.hi + 1e-9; v += step) { const y = Math.round(Y(v)) + .5; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.textAlign = "right"; g.fillText(v.toFixed(2), pad.l - 5, y); }
    g.textAlign = "center"; g.textBaseline = "top";
    for (let x = 0; x <= D.budget; x += 500) { const px = Math.round(X(x)) + .5; g.beginPath(); g.moveTo(px, pad.t); g.lineTo(px, pad.t + ph); g.stroke(); if (x % 1000 === 0 || W > 420) g.fillText(x ? fmtN(x) : "0", Math.min(px, W - pad.r - 12), pad.t + ph + 5); }
    // reference lines
    const ref = (s, color, text) => { const y = Math.round(Y(s)) + .5; g.save(); g.setLineDash([5, 4]); g.strokeStyle = color; g.lineWidth = 1.3; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.restore(); g.fillStyle = color; g.textAlign = "right"; g.textBaseline = "bottom"; g.fillText(text, W - pad.r - 2, y - 2); };
    ref(L.baseline_s, BASE_C, "RB22 baseline " + f3(L.baseline_s));
    ref(D.pole.s, POLE_C, "real pole " + f3(D.pole.s) + " (ANT)");
    // every car tested (dots); slower than the chart: a tick on the top edge; broke a rule (no lap): a red tick above it
    const n = Math.min(end, L.tries.length);
    g.fillStyle = hexA(ln.spec.color, 0.42);
    for (let i = 0; i < n; i++) { const tr = L.tries[i], s = tr[1]; if (s == null || s > S.y.hi) continue; g.fillRect(X(tr[0]) - 1.1, Y(s) - 1.1, 2.2, 2.2); }
    g.fillStyle = hexA(ln.spec.color, 0.3);
    for (let i = 0; i < n; i++) { const tr = L.tries[i]; if (tr[1] != null && tr[1] > S.y.hi) g.fillRect(X(tr[0]) - 0.6, pad.t - 1, 1.2, 4); }
    g.fillStyle = ILLEGAL_C;
    for (let i = 0; i < n; i++) { const tr = L.tries[i]; if (tr[1] == null) g.fillRect(X(tr[0]) - 0.6, pad.t - 7, 1.2, 4); }
    // best so far (a step line, one step per round)
    g.strokeStyle = ln.spec.color; g.lineWidth = 2.4; g.lineJoin = "round"; g.beginPath(); g.moveTo(X(0), Y(L.baseline_s));
    let prev = L.baseline_s, lastX = 0;
    for (const [laps, s] of L.steps) { if (laps > end) break; g.lineTo(X(laps), Y(prev)); g.lineTo(X(laps), Y(s)); prev = s; lastX = laps; }
    g.lineTo(X(lastX), Y(prev)); g.stroke();
    if (end > 0) { g.fillStyle = ln.spec.color; g.beginPath(); g.arc(X(lastX), Y(prev), 3.6, 0, Math.PI * 2); g.fill(); }
    // beat the pole
    if (L.to_pole && end >= L.to_pole.laps) {
      const px = Math.round(X(L.to_pole.laps)) + .5; g.strokeStyle = POLE_C; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, pad.t); g.lineTo(px, pad.t + ph); g.stroke();
      g.fillStyle = POLE_C; g.textBaseline = "top"; const txt = "beat pole at " + fmtN(L.to_pole.laps); g.textAlign = px > W * 0.7 ? "right" : "left"; g.fillText(txt, px + (px > W * 0.7 ? -4 : 4), pad.t + ph - 26);
    }
    // the run's own end before the budget
    // (a run stopped by the test-lap budget may end a few laps short of it: its next round would not fit; that is not marked)
    if (L.end_laps < D.budget && !/^physics-lap budget/.test(L.end_reason || "") && S.t >= L.end_laps) { const px = Math.round(X(L.end_laps)) + .5; g.fillStyle = "#8a8a94"; g.textAlign = "right"; g.textBaseline = "top"; g.fillText("run ended", px - 3, pad.t + 2); }
  }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; }

  // ---------------------------------------------------------------- the clock
  function lastStep(steps, t) { let lo = 0, hi = steps.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (steps[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; }
  function update(now, force) {
    const D = S.data, t = S.t;
    $("cmpLaps").textContent = fmtN(Math.floor(t));
    $("cmpBar").style.width = (100 * t / D.budget) + "%";
    for (const ln of S.lanes) {
      const L = ln.L, k = lastStep(L.steps, t);
      if (ln.mark) ln.mark.classList.toggle("on", !!L.to_pole && t >= L.to_pole.laps);
      if (k === ln.k && !force) { if (L.end_laps < D.budget && t >= L.end_laps && !ln.endShown) { ln.endShown = true; draw(ln, k >= 0 ? L.steps[k][0] : 0); badge(ln, k >= 0 ? L.steps[k][0] : 0); } showDesign(ln, now, false); continue; }
      ln.k = k; ln.endShown = L.end_laps < D.budget && t >= L.end_laps;
      const end = k >= 0 ? L.steps[k][0] : 0, best = k >= 0 ? L.steps[k][1] : L.baseline_s;
      ln.els.best.replaceChildren(f3(best), el("small", { text: " s" }));
      const gap = best - D.pole.s;
      ln.els.gap.className = "cmp-gap " + (gap < 0 ? "under" : "over");
      ln.els.gap.textContent = gap < 0 ? (-gap).toFixed(3) + " s under the real pole" : "+" + gap.toFixed(3) + " s to the real pole";
      if (end > 0) {
        const tr = L.tries[end - 1], first = k > 0 ? L.steps[k - 1][0] : 0, round = L.tries.slice(first, end), legal = round.filter(x => x[1] != null);
        const rb = legal.length ? Math.min(...legal.map(x => x[1])) : null;
        ln.els.last.replaceChildren(round.length > 1 ? "Last round: " + round.length + " cars, fastest " : "Last car tested: ", el("b", { text: round.length > 1 ? (rb != null ? f3(rb) + " s" : "none legal") : (tr[1] != null ? f3(tr[1]) + " s" : "broke a rule, no lap") }));
      } else ln.els.last.textContent = "Starts from the RB22 baseline";
      let j = 0; for (let i = 0; i < L.designs.length; i++) if (L.designs[i].laps <= end) j = i;
      ln.wantDesign = j; showDesign(ln, now, force);
      badge(ln, end);
      draw(ln, end);
    }
  }
  function badge(ln, end) {
    const L = ln.L, D = S.data, b = ln.els.badge, hit = !!L.to_pole && end >= L.to_pole.laps;
    if (hit) { if (!ln.hit) { b.className = "cmp-badge hit"; ln.hit = true; } b.textContent = "Beat the real pole at " + fmtN(L.to_pole.laps) + " test laps"; return; }
    ln.hit = false;
    const over = S.t >= Math.min(D.budget, L.end_laps) - 1e-9;
    b.className = "cmp-badge" + (over ? " end" : "");
    b.textContent = over ? "Did not beat the real pole in " + fmtN(L.end_laps) + " test laps" : "Not under the real pole yet";
  }
  function frame(now) {
    if (S.playing) {
      const dt = Math.min(0.25, (now - (S.last || now)) / 1000);
      S.t = Math.min(S.data.budget, S.t + dt * LAPS_PER_S * S.speed);
      if (S.t >= S.data.budget) { S.playing = false; playBtn(); }
    }
    S.last = now;
    update(now, false);
    requestAnimationFrame(frame);
  }
  function playBtn() { $("cmpPlay").textContent = S.playing ? "Pause" : S.t >= S.data.budget ? "Play again" : "Play"; }
  function setSpeed(v) { S.speed = v; for (const b of document.querySelectorAll(".cmp-speed .btn")) b.classList.toggle("on", +b.dataset.speed === v); }
  function restart() { S.t = 0; for (const ln of S.lanes) { ln.k = -2; ln.hit = false; } update(performance.now(), true); }

  async function loadSeed(seed, opts) {
    S.data = await getJson("data/seed" + seed + ".json"); S.seed = seed;
    buildLanes();
    for (const ln of S.lanes) sizeCanvas(ln);
    S.t = Math.max(0, Math.min(S.data.budget, (opts && opts.t) || 0));
    for (const ln of S.lanes) ln.k = -2;
    update(performance.now(), true);
    playBtn();
  }

  async function init() {
    S.base = baseDesign();
    try { S.index = await getJson("data/index.json"); }
    catch (e) { $("cmpLanes").replaceChildren(el("div", { class: "panel empty cmp-err", text: "Could not load concept/compare/data/index.json (" + e.message + ")." })); return; }
    const sel = $("cmpSeed");
    for (const s of S.index.seeds) sel.append(el("option", { value: String(s.seed), text: "seed " + s.seed + (s.seed === S.index.default ? " (shown first)" : "") + (/pre-redesigns/.test(s.physics || "") ? " · older sim" : "") }));
    const want = +q.get("seed"), seed = S.index.seeds.some(s => s.seed === want) ? want : S.index.default;
    sel.value = String(seed);
    sel.addEventListener("change", async () => { const was = S.playing; S.playing = false; await loadSeed(+sel.value, { t: 0 }); S.playing = was; playBtn(); });
    $("cmpPlay").addEventListener("click", () => { if (S.t >= S.data.budget) restart(); S.playing = !S.playing; S.last = 0; playBtn(); });
    $("cmpRestart").addEventListener("click", () => { restart(); playBtn(); });
    for (const b of document.querySelectorAll(".cmp-speed .btn")) b.addEventListener("click", () => setSpeed(+b.dataset.speed));
    setSpeed(S.speed);
    window.addEventListener("resize", () => { for (const ln of S.lanes) { ln.ctx = null; sizeCanvas(ln); ln.k = -2; } update(performance.now(), true); });
    await loadSeed(seed, { t: +q.get("t") || 0 });
    S.playing = q.get("play") !== "0" && S.t < S.data.budget; playBtn();
    window.__cmp = S;   // read-only handle for the screenshot script
    requestAnimationFrame(frame);
  }
  init().catch(e => { $("cmpLanes").replaceChildren(el("div", { class: "panel empty cmp-err", text: "Side by side failed to start: " + e.message })); });
})();
