// PURPLE CONCEPT LAB - the page where the optimiser reshapes the car generation after generation to beat the real 2026 grid at
// Silverstone. Runs concept/optimize.js in this browser: deterministic, seeded, no API, no Mubit, no LLM. Every generation is a
// lineage row (concept/optimize.js); the verdict is the optimiser's number comparison (legal and faster), never an opinion.
// Integrations, all optional with fallbacks: EI.conceptView (concept/view/view3d.js, 3D car), EI.concept.sim.simulateLap
// (concept/sim/, physics lap sim; else the bench's sim v0), EI.concept.weekend.score (concept/weekend/; else the bench's weekend).
// Every number on screen carries its source label (EVAL_GUARDRAILS G-HON-01). Design tokens and roles: docs/DESIGN_SYSTEM.md.
(function () {
  const EI = (window.EI = window.EI || {});
  const C = EI.concept || {};
  const qs = new URLSearchParams(location.search);
  const CIRCUIT = "silverstone", LAMBDA = 8, FEED_MAX = 400, FLAT = 0.0005;
  const $ = (s, root) => (root || document).querySelector(s);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- tiny DOM helpers (same shape as lab/lab.js el())
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, ...kids) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === "text") n.textContent = v; else n.setAttribute(k, v); }
    for (const k of kids.flat(Infinity)) if (k) n.append(k);
    return n;
  }

  // ---- formatting (DESIGN_SYSTEM §3): times 3 dp, deltas signed with a real minus sign
  const MINUS = "−";
  const fmtT = t => (isNum(t) ? t.toFixed(3) : "—");
  const fmtD = (d, dp) => (isNum(d) ? (d < -1e-12 ? MINUS : "+") + Math.abs(d).toFixed(dp == null ? 3 : dp) : "—");
  const fmtN = (v, dp) => (isNum(v) ? (v < 0 ? MINUS : "") + Math.abs(v).toFixed(dp) : "—");
  const dcls = d => (!isNum(d) || Math.abs(d) <= FLAT ? "flat" : d < 0 ? "faster" : "slower");

  // ---- the concept engine (required) and the optional modules
  const need = ["regs", "parts", "aeromap", "design", "physical", "bench", "optimize"];
  const missing = need.filter(k => !C[k]);
  const M = { regs: C.regs, parts: C.parts, design: C.design, physical: C.physical, bench: C.bench, optimize: C.optimize };
  function simModule() { const s = EI.concept && EI.concept.sim; return s && typeof s.simulateLap === "function" ? s : null; }
  function weekendModule() { const w = EI.concept && EI.concept.weekend; return w && typeof w.score === "function" ? w : null; }
  function benchOpts() {
    const o = { circuit: CIRCUIT };
    const s = simModule();
    if (s) { o.sim = (pc, track, cond) => s.simulateLap(pc, track, cond); if (s.calibration) o.calibration = s.calibration; }
    return o;
  }

  // short names for parts and parameters (the long ones live in concept/parts.js; titles carry them)
  const PART = { layout: "Layout", survival_cell: "Survival cell", front_wing: "Front wing", rear_wing: "Rear wing", floor: "Floor", diffuser: "Diffuser", sidepods: "Sidepods", ballast: "Ballast" };
  const PARAM = {
    "layout.wheelbase_mm": "wheelbase", "survival_cell.front_axle_offset_mm": "axle offset", "survival_cell.cockpit_len_mm": "cockpit length", "survival_cell.bulkhead_gap_mm": "bulkhead gap",
    "front_wing.span_mm": "span", "front_wing.chord_mm": "chord", "front_wing.aoa_deg": "setting", "front_wing.elements": "volumes", "front_wing.sm_delta_deg": "straight-mode flap",
    "rear_wing.span_mm": "span", "rear_wing.chord_mm": "chord", "rear_wing.aoa_deg": "setting", "rear_wing.elements": "volumes", "rear_wing.endplate_top_mm": "endplate top", "rear_wing.sm_delta_deg": "straight-mode flap",
    "floor.width_mm": "width", "floor.throat_mm": "throat", "floor.ride_height_mm": "ride height", "diffuser.expansion_deg": "expansion",
    "sidepods.inlet_cm2": "inlet", "sidepods.undercut_mm": "undercut", "ballast.x_frac": "position", "ballast.extra_kg": "extra",
  };
  const spec = (part, param) => M.design.spec(part, param) || { label: param, unit: "", step: 1, min: 0, max: 1 };
  const decimals = step => { const s = String(step); return s.includes(".") ? s.split(".")[1].length : 0; };
  function fmtParam(part, param, v) {
    const s = spec(part, param), u = s.unit;
    const n = (+v).toFixed(decimals(s.step));
    return n + (!u ? "" : u === "°" ? "°" : " " + u);
  }
  const pname = (part, param) => PARAM[part + "." + param] || spec(part, param).label.split(" (")[0].toLowerCase();
  const changeText = c => (PART[c.part] || c.part) + " · " + pname(c.part, c.param) + " " + fmtParam(c.part, c.param, c.from) + " → " + fmtParam(c.part, c.param, c.to);

  // violations: short chip names; the full regulation text is the chip's title
  const VSHORT = {
    "REG-C-WIDTH": "width", "REG-C-WB": "wheelbase", "REG-C-FRONT-AXLE": "front axle", "REG-C-COCKPIT": "cockpit", "REG-C-BULKHEAD": "bulkhead",
    "REG-C-FW-ELEMENTS": "FW volumes", "REG-C-FW-SPAN": "FW span", "REG-C-FW-CHORD": "FW chord", "REG-C-RW-ELEMENTS": "RW volumes", "REG-C-RW-SPAN": "RW span",
    "REG-C-RW-CHORD": "RW chord", "REG-C-RW-ENDPLATE": "RW endplate", "REG-C-FW-FLAP": "FW flap", "REG-C-RW-FLAP": "RW flap", "REG-C-PLANK": "plank wear",
    "REG-C-MASS-MIN": "min mass", "REG-C-MASS-FRONT": "front axle load", "REG-C-MASS-REAR": "rear axle load", "REG-C-DRIVER-MASS": "driver mass", "REG-C-PU-MASS": "PU mass",
    "REG-C-ICE-MASS": "ICE mass", "REG-C-TC-MASS": "turbo mass", "REG-C-MGUK-MASS": "MGU-K mass", "REG-C-ES-MASS": "ES mass", "REG-C-PU-COG": "PU CoG", "REG-C-DRIVELINE-MASS": "driveline mass",
    "PKG-WB": "packaging",
  };
  function vchip(id, count) {
    const r = M.regs.BY_ID[id];
    const art = !r ? id : r.article.indexOf("concept") === 0 ? "concept model" : "FIA " + r.article.split(",")[0];
    const title = r ? (r.text + " [" + (r.article.indexOf("concept") === 0 ? r.article : "FIA 2026 Section C " + r.article) + "]") : id;
    return el("span", { class: "chip vio", title }, art + " · " + (VSHORT[id] || id) + (count > 1 ? " ×" + count : ""));
  }

  // ---- the real 2026 Silverstone qualifying order (EI.RACEPACE) with team colours (EI.SEASON)
  const RP = (EI.RACEPACE && EI.RACEPACE[CIRCUIT]) || null;
  const TEAMS = (EI.SEASON && EI.SEASON.teams) || [];
  function teamOf(code) {
    const seat = RP && RP.seat && RP.seat[code];
    if (seat) { const t = TEAMS.find(x => x.id === seat || x.name === seat || x.code === seat); if (t) return t; }
    return TEAMS.find(t => (t.drivers || []).includes(code)) || null;
  }
  const REAL_LABEL = "real 2026 British GP qualifying (FIA/formula1.com via js/data/racepace2026.js)";

  // ---- state
  const S = {
    status: "idle",            // idle | running | paused | done | error
    token: 0, gate: null, run: null,
    seed: 1, gens: 200, delay: 0,
    baseline: null, baseResult: null, best: null, bestResult: null, rows: [], lastKept: null,
    view: null, viewError: null, mode: "solid", simLabel: "", weekendNote: null,
    dirty: {}, raf: 0,
  };

  // ---- the run: concept/optimize.js optimizeAsync with the default ES proposer behind a gate. The gate is where the page yields to
  // the browser (setTimeout per generation) and where Pause / Step hold the loop. The ES proposer draws from ctx.rng only, so the
  // lineage is identical to optimize() in Node for the same seed (gating changes timing, never the random stream).
  const STOP = { stop: true };
  function makeProposer(token) {
    const es = M.optimize.esProposer(LAMBDA);
    return { name: es.name, propose(history, d, ctx) { return gate(token).then(() => es.propose(history, d, ctx)); } };
  }
  function gate(token) {
    return new Promise((resolve, reject) => {
      if (token !== S.token) return reject(STOP);
      const g = { resolve, reject, token };
      if (S.status === "running") setTimeout(() => (token === S.token ? resolve() : reject(STOP)), S.delay);
      else S.gate = g;   // paused (or stepping): held until Run / Step
    });
  }
  function release() { const g = S.gate; S.gate = null; if (g) setTimeout(() => (g.token === S.token ? g.resolve() : g.reject(STOP)), 0); }

  function readInputs() {
    const seed = parseInt($("#seed").value, 10), gens = parseInt($("#gens").value, 10);
    S.seed = Number.isFinite(seed) && seed >= 0 ? seed : 1; S.gens = Number.isFinite(gens) && gens >= 1 ? Math.min(gens, 5000) : 200;
    $("#seed").value = S.seed; $("#gens").value = S.gens;
    S.delay = +$("#speed").value || 0;
  }

  function reset() {
    S.token++;
    if (S.gate) { const g = S.gate; S.gate = null; g.reject(STOP); }
    readInputs();
    S.status = "idle"; S.run = null; S.rows = []; S.lastKept = null;
    S.baseline = M.design.baseline();
    S.baseResult = M.bench.bench(S.baseline, benchOpts());
    S.best = M.design.clone(S.baseline); S.bestResult = S.baseResult;
    S.simLabel = S.baseResult.sim_label || (S.baseResult.circuits[CIRCUIT] && S.baseResult.circuits[CIRCUIT].label) || "";
    $("#feedLines").replaceChildren(el("div", { class: "empty", text: "Press Run (or Step) to start. Each generation the optimiser proposes " + LAMBDA + " reshaped cars from the current best; the bench checks each against the 2026 regulations and laps the legal ones; the fastest legal one is kept only if it beats its parent." }));
    if (S.view) { try { S.view.setDesign(S.baseline, { baseline: S.baseline, animate: false }); S.view.setHighlight([]); } catch (e) { viewFailed(e); } }
    markAll(); renderNow();
  }

  function start(paused) {
    const token = S.token;
    S.status = paused ? "paused" : "running";
    S.run = M.optimize.optimizeAsync({
      gens: S.gens, seed: S.seed, lambda: LAMBDA, proposer: makeProposer(token), bench: benchOpts(),
      onGeneration: row => { if (token === S.token) onRow(row); },
    }).then(res => {
      if (token !== S.token) return;
      S.best = res.best; S.bestResult = res.best_result;
      S.status = "done"; markAll(); schedule();
    }).catch(e => {
      if (e === STOP || token !== S.token) return;
      S.status = "error"; banner("optimiser", String(e && e.message || e)); schedule();
    });
  }
  function run() {
    readInputs();
    if (S.status === "done") reset();
    if (S.status === "idle") { start(false); schedule("ctl"); return; }
    if (S.status === "paused") { S.status = "running"; release(); schedule("ctl"); }
  }
  function pause() { if (S.status === "running") { S.status = "paused"; schedule("ctl"); } }
  function step() {
    if (S.status === "done") reset();
    if (S.status === "idle") { readInputs(); start(true); }
    if (S.status === "running") S.status = "paused";
    release(); schedule("ctl");
  }

  function onRow(row) {
    S.rows.push(row);
    if (row.kept) {
      S.best = M.design.applyChanges(S.best, row.changes.map(c => ({ part: c.part, param: c.param, to: c.to })), { id: row.id, parent: row.parent, label: "generation " + row.gen + " best" }).design;
      S.bestResult = M.bench.bench(S.best, benchOpts());
      S.lastKept = row;
      if (S.view) {
        try { S.view.setDesign(S.best, { baseline: S.baseline, animate: !reduced() }); S.view.setHighlight(uniq(row.changes.map(c => c.part))); }
        catch (e) { viewFailed(e); }
      }
      S.dirty.kept = true;
    }
    S.dirty.row = true; schedule();
  }
  const uniq = a => Array.from(new Set(a));

  // ---- rendering: coalesced on requestAnimationFrame; heavy panels only when a change is kept
  function markAll() { S.dirty = { all: true }; }
  function schedule(what) { if (what) S.dirty[what] = true; if (!S.raf) S.raf = requestAnimationFrame(renderNow); }
  function renderNow() {
    S.raf = 0; const d = S.dirty; S.dirty = {};
    renderCtl();
    if (d.all) { $("#feedLines").querySelectorAll(".ln").forEach(n => n.remove()); S.feedCount = 0; }
    if (d.all || d.row) { renderFeed(); renderChart(); renderHero(); }
    if (d.all || d.kept) { renderBoard(); renderSheet(); renderDist(); renderPlan(); renderFooter(); }
  }

  function renderCtl() {
    const st = S.status, n = S.rows.length;
    const runBtn = $("#btnRun");
    runBtn.textContent = st === "running" ? "Pause" : st === "paused" ? "Resume" : st === "done" ? "Run again" : "Run";
    runBtn.classList.toggle("primary", st !== "running");
    $("#btnStep").disabled = st === "error";
    $("#seed").disabled = $("#gens").disabled = st === "running" || st === "paused";
    const kept = S.rows.filter(r => r.kept).length;
    const g = $("#genBadge");
    g.textContent = "gen " + n + " / " + S.gens + " · kept " + kept + (st === "paused" ? " · paused" : st === "done" ? " · done" : "");
    g.className = "badge " + (st === "running" ? "purple" : st === "done" ? "green" : st === "paused" ? "amber" : "");
  }

  // ---- hero: 3D car (or the schematic plan view) with the headline numbers on top
  function lapOf(r) { return r && r.weekend ? r.weekend.lap_s : null; }
  function renderHero() {
    const base = lapOf(S.baseResult), best = lapOf(S.bestResult), w = S.bestResult && S.bestResult.weekend;
    const dBase = isNum(best) && isNum(base) ? best - base : null;
    const pole = RP && RP.pole ? RP.pole.s : null, dPole = isNum(best) && isNum(pole) ? best - pole : null;
    const c = S.bestResult && S.bestResult.circuits && S.bestResult.circuits[CIRCUIT];
    $("#heroBL").replaceChildren(
      el("div", { class: "kpis" },
        el("div", { class: "kpi" }, el("span", { class: "label", text: "best lap" }), el("span", { class: "big", text: fmtT(best) })),
        el("div", { class: "kpi" }, el("span", { class: "label", text: "vs baseline car" }), el("span", { class: "big delta " + dcls(dBase), text: fmtD(dBase) })),
        el("div", { class: "kpi" }, el("span", { class: "label", text: "vs real pole" }), el("span", { class: "big delta " + dcls(dPole), text: fmtD(dPole) })),
        el("div", { class: "kpi grid" }, el("span", { class: "label", text: "grid (projected)" }), el("span", { class: "gv" }, el("span", { class: "big", text: w ? "P" + w.grid_position : "—" }), el("span", { class: "of", text: w ? " / " + (w.field_size + 1) : "" }))),
      ),
      el("div", { class: "kpi-sub" },
        c ? "S1 " + fmtT(c.sectors_s[0]) + " · S2 " + fmtT(c.sectors_s[1]) + " · S3 " + fmtT(c.sectors_s[2]) + " · trap " + Math.round(c.speed_trap_kmh) + " km/h · min " + Math.round(c.vmin_kmh) + " km/h" : ""),
      el("div", { class: "src one", title: S.simLabel, text: S.simLabel }),
    );
    const lk = S.lastKept;
    const tr = $("#heroBR");
    if (lk) {
      tr.replaceChildren(el("div", { class: "label", text: "last kept change · gen " + lk.gen }),
        ...lk.changes.map(ch => el("div", { class: "chg one", title: changeText(ch) }, el("span", { class: "dotp" }), changeText(ch))),
        el("div", { class: "delta faster", text: fmtD(lapAfter(lk) - lapBefore(lk)) + " s" }));
    } else tr.replaceChildren(el("div", { class: "label", text: "baseline 2026-style concept car" }), el("div", { class: "chg muted", text: "no change kept yet" }));
    const n = S.rows.length;
    $("#heroTL").replaceChildren(
      el("span", { class: "badge " + (S.status === "running" ? "purple" : ""), text: S.status === "idle" ? "baseline" : "generation " + n }),
      el("span", { class: "badge", title: "ghost = the baseline concept car", text: "ghost = baseline" }),
    );
  }
  // per-row lap before / after from the lineage row (score = pole − lap)
  const poleS = () => (S.baseResult && S.baseResult.weekend ? S.baseResult.weekend.pole_s : RP && RP.pole && RP.pole.s);
  const lapBefore = r => poleS() - r.score_before;
  const lapAfter = r => (isNum(r.score_after) ? poleS() - r.score_after : null);

  // 3D module mount (EI.conceptView) or the fallback plan view
  function mountView() {
    const host = $("#view3d");
    if (!EI.conceptView || typeof EI.conceptView.mount !== "function") {
      S.viewError = window.__conceptViewMissing ? "3D view loading module missing (concept/view/view3d.js not found)" : "3D view loading module missing (EI.conceptView not defined)";
      host.hidden = true; $("#plan").hidden = false; renderModeButtons(); return;
    }
    try {
      S.view = EI.conceptView.mount(host, { baseline: S.baseline, design: S.best, parts: M.parts, mode: S.mode });
      S.view.setDesign(S.best, { baseline: S.baseline, animate: false });
    } catch (e) { viewFailed(e); }
    renderModeButtons();
  }
  function viewFailed(e) {
    S.viewError = "3D view error: " + String(e && e.message || e);
    try { if (S.view && S.view.dispose) S.view.dispose(); } catch (_) { /* already broken */ }
    S.view = null; $("#view3d").hidden = true; $("#plan").hidden = false; renderModeButtons(); schedule("kept");
  }
  function renderModeButtons() {
    const tr = $("#heroModes");
    if (!S.view) { tr.replaceChildren(); return; }
    const b = (m, t) => el("button", { type: "button", class: "btn small" + (S.mode === m ? " primary" : ""), "aria-pressed": S.mode === m ? "true" : "false", onclick: () => { S.mode = m; try { S.view.setMode(m); } catch (e) { viewFailed(e); } renderModeButtons(); } }, t);
    let lbl = ""; try { lbl = S.view.labelText ? S.view.labelText() : ""; } catch (_) { lbl = ""; }
    tr.replaceChildren(el("div", { class: "modes" }, b("solid", "solid"), b("xray-mass", "x-ray mass")), lbl ? el("div", { class: "src vlabel", text: lbl }) : null);
  }

  // schematic plan view (top view, x rearward from the front axle, mm): the fallback when the 3D module is absent
  function planShapes(d, cls, hi) {
    const p = d.params, g = M.parts.geometry(p), wb = p.layout.wheelbase_mm, fw = p.front_wing, rw = p.rear_wing, fl = p.floor, sp = p.sidepods;
    const H = id => (hi.includes(id) ? " hi" : "");
    const out = [];
    // floor and diffuser
    out.push(sv("rect", { class: cls + " floor" + H("floor"), x: 150, y: -fl.width_mm / 2, width: wb - 300, height: fl.width_mm, rx: 60 }));
    const dw = 900 + (p.diffuser.expansion_deg - 14) * 18;
    out.push(sv("path", { class: cls + " diff" + H("diffuser"), d: `M${wb - 150},${-fl.width_mm / 2 + 220} L${wb + 260},${-dw / 2} L${wb + 260},${dw / 2} L${wb - 150},${fl.width_mm / 2 - 220} Z` }));
    // body: nose, tub, sidepods (inlet widens, undercut narrows), engine cover, gearbox
    const sw = 380 + (sp.inlet_cm2 - 650) * 0.25 - (sp.undercut_mm - 100) * 0.6;
    const nose = g.XA - 950;
    const pts = [[nose, 70], [g.XA, 230], [g.XC - 700, 400], [g.XC - 250, 420], [g.XC + 50, sw + 150], [g.XPU + 250, sw + 100], [g.XPU + 700, 300], [wb - 100, 200], [wb + 420, 120]];
    const body = "M" + pts.map(q => q[0] + "," + (-q[1])).join(" L") + " L" + pts.slice().reverse().map(q => q[0] + "," + q[1]).join(" L") + " Z";
    out.push(sv("path", { class: cls + " body" + H("survival_cell") + H("sidepods"), d: body }));
    out.push(sv("ellipse", { class: cls + " cockpit", cx: g.XC - 400, cy: 0, rx: 330, ry: 160 }));
    // wheels
    for (const [x, y, w, h] of [[0, 790, 720, 300], [wb, 760, 720, 400]]) for (const s of [-1, 1]) out.push(sv("rect", { class: cls + " wheel" + (x ? H("layout") : ""), x: x - w / 2, y: s * y - h / 2, width: w, height: h, rx: 50 }));
    // wings with their profile volumes
    const wing = (xc, ch, span, n, id) => {
      const r = [sv("rect", { class: cls + " wing" + H(id), x: xc - ch / 2, y: -span / 2, width: ch, height: span, rx: 20 })];
      for (let i = 1; i < n; i++) r.push(sv("line", { class: cls + " el", x1: xc - ch / 2 + (ch * i) / n, y1: -span / 2, x2: xc - ch / 2 + (ch * i) / n, y2: span / 2 }));
      return r;
    };
    out.push(...wing(-860, fw.chord_mm, fw.span_mm, fw.elements, "front_wing"), ...wing(wb + 400, rw.chord_mm, rw.span_mm, rw.elements, "rear_wing"));
    return { nodes: out, g };
  }
  function renderPlan() {
    if (S.view) return;
    const host = $("#plan"); if (host.hidden) return;
    const hi = S.lastKept ? uniq(S.lastKept.changes.map(c => c.part)) : [];
    const base = planShapes(S.baseline, "ghost", []), best = planShapes(S.best, "cur", hi);
    const ms = S.bestResult && S.bestResult.mass, wb = S.best.params.layout.wheelbase_mm;
    const cog = ms ? [sv("circle", { class: "cog", cx: ms.cog_x_mm, cy: 0, r: 55 }), sv("line", { class: "cogx", x1: ms.cog_x_mm - 110, y1: 0, x2: ms.cog_x_mm + 110, y2: 0 }), sv("line", { class: "cogx", x1: ms.cog_x_mm, y1: -110, x2: ms.cog_x_mm, y2: 110 }),
      sv("text", { class: "ptxt", x: ms.cog_x_mm + 90, y: -90, text: "CoG" })] : [];
    const bal = S.best.params.ballast;
    const ballast = ms ? [sv("rect", { class: "ballast" + (hi.includes("ballast") ? " hi" : ""), x: bal.x_frac * wb - 70, y: -45, width: 140, height: 90, rx: 10 })] : [];
    const dimY = 1120;
    const dim = [sv("line", { class: "dim", x1: 0, y1: dimY, x2: wb, y2: dimY }), sv("line", { class: "dim", x1: 0, y1: dimY - 50, x2: 0, y2: dimY + 50 }), sv("line", { class: "dim", x1: wb, y1: dimY - 50, x2: wb, y2: dimY + 50 }),
      sv("text", { class: "ptxt", x: wb / 2, y: dimY - 40, "text-anchor": "middle", text: "wheelbase " + wb + " mm" })];
    const svg = sv("svg", { viewBox: "-1700 -1250 6100 2560", preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": "schematic plan view: current best over the baseline ghost" },
      sv("g", { class: "ghostg" }, base.nodes), sv("g", { class: "curg" }, best.nodes), ballast, cog, dim,
      sv("text", { class: "ptxt dir", x: -1650, y: -1150, text: "← front" }));
    host.replaceChildren(svg, el("div", { class: "plan-note src" }, el("div", { class: "warn", text: S.viewError || "" }), el("div", { text: "fallback: schematic plan view from concept/parts.js geometry · dashed = baseline · purple = current best · amber = last kept change" })));
  }

  // ---- leaderboard: the real 2026 order with the concept car inserted at its lap
  function renderBoard() {
    const host = $("#boardRows");
    if (!RP || !RP.q) { host.replaceChildren(el("div", { class: "empty", text: "js/data/racepace2026.js not loaded: no real 2026 laps to compare with" })); return; }
    const pole = RP.pole.s;
    const rows = Object.entries(RP.q).filter(([, s]) => isNum(s) && s > 0).map(([code, s]) => ({ code, s, team: teamOf(code), kind: "real" }));
    const best = lapOf(S.bestResult), base = lapOf(S.baseResult);
    if (isNum(best)) rows.push({ code: "PURPLE", s: best, kind: "concept" });
    const showBase = isNum(base) && S.status !== "idle" && Math.abs(base - best) > 1e-9;
    if (showBase) rows.push({ code: "BASE", s: base, kind: "base" });
    // ties: a concept lap equal to a real lap goes ahead of it (bench weekend(): 1 + real laps strictly faster)
    const rank = { concept: 0, base: 1, real: 2 };
    rows.sort((a, b) => a.s - b.s || rank[a.kind] - rank[b.kind]);
    let pos = 0; const out = [];
    for (const r of rows) {
      if (r.kind !== "base") pos++;
      const gap = r.s - pole;
      const color = r.kind === "real" ? (r.team && r.team.colors && r.team.colors.primary) || "#8a8a94" : r.kind === "concept" ? "var(--purple)" : "transparent";
      const name = r.kind === "concept" ? (S.status === "idle" ? "concept · baseline" : "concept · gen " + (S.lastKept ? S.lastKept.gen : 0))
        : r.kind === "base" ? "baseline (ghost)" : (r.team ? r.team.name : "—");
      out.push(el("div", { class: "brow " + r.kind, title: r.kind === "real" ? r.code + " · " + (r.team ? r.team.full + " " + r.team.chassis : "") + " · " + REAL_LABEL : S.simLabel },
        el("span", { class: "pos", text: r.kind === "base" ? "" : String(pos) }),
        el("span", { class: "sw", style: "background:" + color }),
        el("span", { class: "code", text: r.kind === "concept" ? "PRPL" : r.kind === "base" ? "BASE" : r.code }),
        el("span", { class: "team one", text: name }),
        el("span", { class: "lap num", text: fmtT(r.s) }),
        el("span", { class: "gap num delta " + (r.kind === "real" ? "flat" : dcls(gap)), text: Math.abs(gap) < 5e-4 && r.kind === "real" ? "pole" : fmtD(gap) }),
      ));
    }
    host.replaceChildren(...out);
    const cr = host.querySelector(".brow.concept"); if (cr && cr.scrollIntoView && host.scrollHeight > host.clientHeight) { const top = cr.offsetTop - host.clientHeight / 2; host.scrollTop = Math.max(0, top); }
    const w = S.bestResult && S.bestResult.weekend;
    $("#boardMeta").textContent = "pole " + RP.pole.code + " " + fmtT(pole);
    const wk = weekendNote();
    $("#boardSrc").replaceChildren(
      el("div", null, el("span", { class: "tag real", text: "real" }), " " + REAL_LABEL),
      el("div", { class: "one", title: S.simLabel }, el("span", { class: "tag concept", text: "concept" }), " " + S.simLabel.replace(/^concept · /, "")),
      ...(simModule() ? [] : [el("div", { class: "warn" }, "sim v0: baseline = real pole by construction; it ranks changes, it does not place a 2026 car (CONCEPT.md §2)")]),
      ...(wk ? [el("div", { class: "one", title: wk }, wk)] : []),
    );
  }
  // optional weekend module: shown next to the bench's score (the optimiser's objective stays the bench's weekend score)
  function weekendNote() {
    const W = weekendModule();
    if (!W) return null;   // bench weekend(): grid slot = 1 + real laps strictly faster
    try {
      const r = W.score({ design: S.best, bench: S.bestResult, physical: S.bestResult && S.bestResult.physical, lap_s: lapOf(S.bestResult), circuit: CIRCUIT });
      if (r && typeof r === "object") return "weekend module: " + (isNum(r.score) ? "score " + fmtN(r.score, 3) + " · " : "") + (r.label || "concept/weekend");
      return isNum(r) ? "weekend module: score " + fmtN(r, 3) : "weekend module present (no result)";
    } catch (e) { return "weekend module error: " + String(e && e.message || e); }
  }

  // ---- progress chart (inline SVG): best lap so far (step line), kept and rejected generations, the real pole
  function renderChart() {
    const wrap = $("#chartWrap"), W = Math.max(200, wrap.clientWidth), H = Math.max(100, wrap.clientHeight);
    const rows = S.rows, base = lapOf(S.baseResult), pole = poleS();
    const pad = { l: 46, r: 12, t: 10, b: 20 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const laps = rows.map(lapAfter).filter(isNum);
    const bestLap = lapOf(S.bestResult);
    let lo = Math.min(bestLap, pole, base), hi = Math.max(base, pole);
    if (isNum(lo) && isNum(hi)) { const span = Math.max(rows.length ? 0.2 : 0.6, hi - lo); lo -= span * 0.08; hi += span * 0.35; } else { lo = 0; hi = 1; }
    const gN = Math.max(S.gens, rows.length, 1);
    const X = g => pad.l + (g / gN) * iw, Y = v => pad.t + ((v - lo) / (hi - lo)) * ih;
    const yC = v => Math.max(pad.t, Math.min(pad.t + ih, Y(v)));
    const nodes = [];
    // grid
    const stepY = niceStep((hi - lo) / 4);
    for (let v = Math.ceil(lo / stepY) * stepY; v <= hi + 1e-9; v += stepY) {
      nodes.push(sv("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }), sv("text", { class: "ax", x: pad.l - 6, y: Y(v) + 3, "text-anchor": "end", text: v.toFixed(stepY < 0.1 ? 2 : 1) }));
    }
    const stepX = niceStep(gN / 6);
    for (let g = 0; g <= gN + 1e-9; g += stepX) nodes.push(sv("text", { class: "ax", x: X(g), y: H - 5, "text-anchor": "middle", text: String(g) }));
    // references: real pole and the baseline car
    if (isNum(pole)) nodes.push(sv("line", { class: "ref pole", x1: pad.l, x2: W - pad.r, y1: Y(pole), y2: Y(pole) }), sv("text", { class: "reft", x: W - pad.r - 4, y: Y(pole) - 4, "text-anchor": "end", text: "real pole " + (RP ? RP.pole.code + " " : "") + fmtT(pole) }));
    if (isNum(base) && Math.abs(base - pole) > 0.01) nodes.push(sv("line", { class: "ref base", x1: pad.l, x2: W - pad.r, y1: Y(base), y2: Y(base) }), sv("text", { class: "reft", x: W - pad.r - 4, y: Y(base) + 11, "text-anchor": "end", text: "baseline " + fmtT(base) }));
    // rejected (best legal candidate, slower than its parent) and no-legal generations
    for (const r of rows) {
      const la = lapAfter(r);
      if (!r.kept && isNum(la)) { const y = Y(la); nodes.push(y > pad.t + ih ? sv("path", { class: "rej clip", d: `M${X(r.gen) - 3},${pad.t + ih - 4} l3,4 l3,-4` }) : sv("circle", { class: "rej", cx: X(r.gen), cy: y, r: 2.2 })); }
      else if (!r.legal) nodes.push(sv("path", { class: "ill", d: `M${X(r.gen) - 2.5},${pad.t + ih - 6} l5,5 m0,-5 l-5,5` }));
    }
    // best-so-far step line, kept points on top
    if (isNum(base)) {
      let d = `M${X(0)},${yC(base)}`, cur = base;
      for (const r of rows) if (r.kept) { const la = lapAfter(r); d += ` H${X(r.gen)} V${yC(la)}`; cur = la; }
      d += ` H${X(rows.length)}`;
      nodes.push(sv("path", { class: "bestline", d }));
      for (const r of rows) if (r.kept) nodes.push(sv("circle", { class: "kept", cx: X(r.gen), cy: yC(lapAfter(r)), r: 3 }, sv("title", { text: "gen " + r.gen + " kept · " + fmtT(lapAfter(r)) + " s" })));
    }
    const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Silverstone lap per generation" }, nodes);
    if (!rows.length) svg.append(sv("text", { class: "ax hint", x: pad.l + iw / 2, y: pad.t + ih / 2, "text-anchor": "middle", text: "lap per generation appears here once the optimiser runs" }));
    wrap.replaceChildren(svg);
    const kept = rows.filter(r => r.kept).length, ill = rows.filter(r => !r.legal).length;
    $("#chartLegend").replaceChildren(
      el("span", { class: "lg" }, el("i", { class: "k" }), "kept " + kept),
      el("span", { class: "lg" }, el("i", { class: "r" }), "rejected " + (rows.length - kept - ill)),
      ...(ill ? [el("span", { class: "lg" }, el("i", { class: "x" }), "no legal car " + ill)] : []),
      el("span", { class: "src", text: "lap s · faster ↑" }),
    );
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9)))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

  // ---- lineage feed: newest first; appended incrementally
  function renderFeed() {
    const host = $("#feedLines");
    const have = S.feedCount || 0;
    if (have === 0 && S.rows.length) { const e = host.querySelector(".empty"); if (e) e.remove(); }
    const frag = [];
    for (let i = have; i < S.rows.length; i++) frag.push(feedLine(S.rows[i]));
    S.feedCount = S.rows.length;
    for (const n of frag) host.prepend(n);
    while (host.children.length > FEED_MAX) host.lastChild.remove();
    const kept = S.rows.filter(r => r.kept).length;
    $("#feedMeta").textContent = S.rows.length ? S.rows.length + " generations · " + kept + " kept · " + M.optimize.esProposer(LAMBDA).name + " · seed " + S.seed : "verdict = numbers (legal and faster), not a model's opinion";
  }
  function feedLine(r) {
    const la = lapAfter(r), lb = lapBefore(r), d = isNum(la) ? la - lb : null;
    const verdict = r.kept ? ["kept", "promote"] : r.legal ? ["rejected", "reject"] : ["no legal car", "reject"];
    // violations across this generation's candidates, counted per rule
    const vc = {};
    for (const c of r.candidates || []) for (const id of c.violations || []) vc[id] = (vc[id] || 0) + 1;
    const vids = Object.keys(vc);
    const why = r.kept ? "legal · faster than parent" : r.legal ? "best legal one not faster" : "all " + r.n_measured + " illegal";
    return el("div", { class: "ln" + (r.kept ? " kept" : "") + (r.legal ? "" : " illegal") },
      el("div", { class: "l1" },
        el("span", { class: "g", text: "G" + r.gen }),
        el("span", { class: "verdict sm " + verdict[1], text: verdict[0] }),
        el("span", { class: "delta " + (r.kept ? "faster" : isNum(d) ? dcls(d) : "flat"), text: isNum(d) ? fmtD(d) + " s" : "no lap" }),
        el("span", { class: "lt num", text: isNum(la) ? fmtT(lb) + " → " + fmtT(la) : fmtT(lb) }),
        el("span", { class: "why src one", title: why, text: why }),
      ),
      r.changes && r.changes.length ? el("div", { class: "chgs" }, r.changes.map(c => el("span", { class: "chg", title: c.clamped ? "value clamped to the model domain" : "" }, changeText(c) + (c.clamped ? " (clamped)" : "")))) : null,
      el("div", { class: "hyp2", title: r.hypothesis, text: r.hypothesis }),
      vids.length ? el("div", { class: "vios" }, el("span", { class: "src", text: (r.n_illegal || vids.length) + " illegal:" }), vids.map(id => vchip(id, vc[id]))) : null,
    );
  }

  // ---- car sheet: mass by part group (best vs baseline), total vs the minimum, CoG, weight distribution, aero, PU; each with its basis
  const GROUPS = [["chassis", "chassis"], ["aero", "aero"], ["power_unit", "power unit"], ["transmission", "gearbox"], ["suspension", "suspension"], ["wheels", "wheels"], ["systems", "systems"], ["driver", "driver"], ["ballast", "ballast"]];
  function sumGroups(params) { const out = {}; for (const p of M.parts.massSheet(params).parts) out[p.group] = (out[p.group] || 0) + p.mass_kg; return out; }
  function flag(kind, title) {
    const t = { fia: ["FIA", "green"], est: ["est", "amber"], model: ["model", "muted"], partial: ["FIA·est", "amber"] }[kind] || [kind, "muted"];
    return el("span", { class: "flag " + t[1], title: title || "", text: t[0] });
  }
  function renderSheet() {
    const r = S.bestResult, b = S.baseResult, host = $("#sheetBody");
    if (!r || !r.physical) { host.replaceChildren(el("div", { class: "empty", text: "no legal car yet" })); return; }
    const SRC = M.physical.SOURCES, pc = r.physical, pb = b.physical, m = r.mass;
    const gB = sumGroups(S.baseline.params), gC = sumGroups(S.best.params);
    const maxKg = Math.max(...GROUPS.map(([g]) => Math.max(gB[g] || 0, gC[g] || 0)), 1);
    const bars = GROUPS.map(([g, name]) => {
      const c = gC[g] || 0, o = gB[g] || 0, dd = c - o;
      return el("div", { class: "mrow", title: name + ": " + c.toFixed(1) + " kg (baseline " + o.toFixed(1) + " kg, " + fmtD(dd, 1) + ") · concept part-mass estimates v0" },
        el("span", { class: "mn", text: name }),
        el("span", { class: "mbar" }, el("i", { class: "cur", style: "width:" + (100 * c / maxKg).toFixed(1) + "%" }), el("i", { class: "ghost", style: "left:" + (100 * o / maxKg).toFixed(1) + "%" })),
        el("span", { class: "mv num", text: c.toFixed(1) }),
        el("span", { class: "md num " + (Math.abs(dd) < 0.05 ? "muted" : ""), text: Math.abs(dd) < 0.05 ? "·" : fmtD(dd, 1) }));
    });
    const minK = m.min_kg, mm = M.regs.minMass("qualifying");
    const kv = (k, v, f, unit) => [el("span", { class: "k", text: k }), el("span", { class: "v num" }, v, unit ? el("span", { class: "u", text: unit }) : null), f];
    const cla = a => a.CLA_front_m2 + a.CLA_rear_m2;
    const fig = el("div", { class: "kvs" },
      kv("total mass", m.total_kg.toFixed(1), flag("est", SRC.mass_kg.basis), " kg"),
      kv("minimum C4.1", minK.toFixed(1), flag("partial", "C4.1 " + mm.base_kg + " kg in qualifying (FIA, verified) + Nominal Tyre Mass " + mm.ntm_kg + " kg (estimate, C4.7)"), " kg"),
      kv("ballast", m.ballast_kg.toFixed(1), flag("est", "automatic ballast to the C4.1 minimum plus extra; parts " + m.parts_kg.toFixed(1) + " kg (concept part-mass estimates v0)"), " kg"),
      kv("weight front", (m.front_share * 100).toFixed(1), flag("est", SRC.weight_dist_front.basis + " · C4.2 window 44–46 % in qualifying"), " %"),
      kv("CoG x · z", m.cog_x_mm + "·" + Math.round(pc.cog_height_m * 1000), flag("est", "x rearward from the front axle; z: " + SRC.cog_height_m.basis), " mm"),
      kv("wheelbase", (pc.wheelbase_m * 1000).toFixed(0), flag("fia", SRC.wheelbase_m.basis), " mm"),
      kv("CLA corner", cla(pc.aero.corner).toFixed(2), flag("model", SRC.aero.basis + " · baseline " + cla(pb.aero.corner).toFixed(2) + " m²"), " m²"),
      kv("CDA corner·SM", pc.aero.corner.CDA_m2.toFixed(2) + "·" + pc.aero.straight.CDA_m2.toFixed(2), flag("model", SRC.aero.basis + " · SM = straight mode · baseline " + pb.aero.corner.CDA_m2.toFixed(2) + " m²"), " m²"),
      kv("aero balance", (r.aero.balance * 100).toFixed(1), flag("model", "concept aero map v0 front share of downforce (corner mode)"), " % F"),
      kv("ICE · MGU-K", pc.pu.ice_kw.toFixed(0) + "·" + pc.pu.mguk_kw.toFixed(0), flag("partial", SRC.pu.basis), " kW"),
      kv("ES deploy/lap", pc.pu.es_deploy_mj_per_lap.toFixed(1), flag("partial", SRC.pu.basis), " MJ"),
      kv("cooling derate", (r.aero.cooling_power_factor * 100).toFixed(1), flag("model", "concept aero map v0 cooling: ICE power × (1 − 1.5·shortfall²)"), " %"),
    );
    host.replaceChildren(
      el("div", { class: "mass" }, el("div", { class: "sub label tight", text: "mass · kg · ┆ = baseline" }), bars,
        el("div", { class: "mtot" }, el("span", { class: "mbar tot" }, el("i", { class: "parts", style: "width:" + (100 * m.parts_kg / Math.max(m.total_kg, minK)).toFixed(1) + "%" }), el("i", { class: "minl", style: "left:" + (100 * minK / Math.max(m.total_kg, minK)).toFixed(1) + "%" })),
          el("span", { class: "src one", text: "parts " + m.parts_kg.toFixed(1) + " + ballast · " + minK + " min" }))),
      fig,
    );
    $("#sheetMeta").replaceChildren(flag("fia", "verified in FIA 2026 Section C, Issue 17"), flag("est", "estimate (stated basis on hover)"), flag("model", "derived by the concept aero map v0"));
  }

  // ---- how different: per-part normalised distance from the baseline
  function renderDist() {
    const base = S.baseline.params, cur = S.best.params, rows = [];
    let sumsq = 0, n = 0, moved = 0;
    for (const p of M.parts.CATALOGUE) {
      const ks = Object.keys(p.params); if (!ks.length) continue;
      let ss = 0, ch = 0; const parts_ = [];
      for (const k of ks) {
        const s = p.params[k], d = (cur[p.id][k] - base[p.id][k]) / (s.max - s.min);
        ss += d * d; sumsq += d * d; n++;
        if (Math.abs(d) > 1e-9) { ch++; moved++; parts_.push({ k, d, from: base[p.id][k], to: cur[p.id][k] }); }
      }
      parts_.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      rows.push({ id: p.id, name: PART[p.id] || p.name, rms: Math.sqrt(ss / ks.length), ch, n: ks.length, top: parts_ });
    }
    const total = Math.sqrt(sumsq / Math.max(n, 1));
    $("#distHead").replaceChildren(
      el("span", { class: "big", text: (total * 100).toFixed(1) + " %" }),
      el("span", { class: "dh-t", title: "RMS over all shape parameters of Δ ÷ model-domain width (concept/parts.js domains): 0 % = the baseline car, 100 % = every parameter moved across its full domain" }, el("div", { text: moved + " of " + n + " shape parameters moved" }), el("div", { class: "src", text: "RMS of Δ ÷ domain width · 100 % = full domain" })),
    );
    const maxR = Math.max(0.25, ...rows.map(r => r.rms));
    const hi = S.lastKept ? S.lastKept.changes.map(c => c.part) : [];
    $("#distRows").replaceChildren(...rows.map(r => el("div", { class: "drow" + (hi.includes(r.id) ? " hi" : ""), title: r.top.map(t => pname(r.id, t.k) + " " + fmtParam(r.id, t.k, t.from) + " → " + fmtParam(r.id, t.k, t.to)).join(" · ") || "unchanged" },
      el("span", { class: "dn", text: r.name }),
      el("span", { class: "dbar" }, el("i", { style: "width:" + (100 * r.rms / maxR).toFixed(1) + "%" })),
      el("span", { class: "dv num", text: (r.rms * 100).toFixed(0) + " %" }),
      el("span", { class: "dc src", text: r.ch + "/" + r.n }),
      el("span", { class: "dt src one", text: r.top.length ? r.top.slice(0, 2).map(t => pname(r.id, t.k) + " " + fmtD(t.to - t.from, decimals(spec(r.id, t.k).step))).join(", ") : "—" }),
    )));
    $("#distMeta").textContent = S.status === "idle" ? "baseline" : "gen " + (S.lastKept ? S.lastKept.gen : 0) + " best vs baseline";
  }

  function renderFooter() {
    $("#honest").replaceChildren(
      el("span", { class: "label", text: "Honest limits" }),
      el("span", { class: "txt", text: "Reduced-order: no flow solved, aero from a component-share map · " +
        (simModule() ? "" : "v0 puts the baseline on the real pole by construction (ranks, does not place) · ") +
        "straight-mode gains optimistic · part masses estimated · no ERS, tyre temperature or load transfer in v0 · best values sit on model-domain edges · schematic geometry" }),
      el("span", { class: "txt sim", text: "· sim: " + S.simLabel }),
    );
  }

  function banner(where, msg) {
    const b = $("#banner"); b.hidden = false; document.body.classList.add("has-banner");
    b.replaceChildren(el("span", { class: "label", text: "error" }), el("code", { text: where }), el("span", { class: "msg", title: msg, text: msg }),
      el("button", { type: "button", class: "x", onclick: () => { b.hidden = true; document.body.classList.remove("has-banner"); }, text: "dismiss" }));
  }

  // ---- boot
  function boot() {
    if (missing.length) { banner("concept", "concept modules not loaded: " + missing.join(", ")); return; }
    if (qs.has("seed")) $("#seed").value = qs.get("seed");
    if (qs.has("gens")) $("#gens").value = qs.get("gens");
    if (qs.has("speed")) { const v = { "1": "300", "4": "60", max: "0" }[qs.get("speed")]; if (v) $("#speed").value = v; }
    $("#btnRun").addEventListener("click", () => (S.status === "running" ? pause() : run()));
    $("#btnStep").addEventListener("click", step);
    $("#btnReset").addEventListener("click", reset);
    const fast = () => $("#feedLines").classList.toggle("fast", !S.delay || reduced());
    $("#speed").addEventListener("change", () => { S.delay = +$("#speed").value || 0; fast(); });
    document.addEventListener("keydown", e => { if (e.target.closest && e.target.closest("input,select,textarea")) return; if (e.key === " ") { e.preventDefault(); $("#btnRun").click(); } else if (e.key === "s") step(); });
    try { reset(); } catch (e) { banner("bench", String(e && e.message || e)); return; }
    mountView(); markAll(); renderNow(); fast();
    if (window.ResizeObserver) new ResizeObserver(() => schedule("row")).observe($("#chartWrap"));
    if (qs.get("run") === "1") run();
  }
  // test / demo hook (read-only state and the same actions as the buttons)
  EI.conceptLab = {
    run, pause, step, reset,
    state: () => ({ status: S.status, gens: S.gens, seed: S.seed, generations: S.rows.length, kept: S.rows.filter(r => r.kept).length, best_lap_s: lapOf(S.bestResult), baseline_lap_s: lapOf(S.baseResult), grid_position: S.bestResult && S.bestResult.weekend && S.bestResult.weekend.grid_position, view: !!S.view, sim_label: S.simLabel }),
    lineage: () => JSON.parse(JSON.stringify(S.rows)),
    best: () => M.design.clone(S.best),
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
