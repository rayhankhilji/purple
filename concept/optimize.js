// PURPLE CONCEPT - the loop with agency over shape. Each generation a PROPOSER suggests shape changes to the current car (the
// parent); the bench measures every candidate; the best legal candidate is KEPT only if its weekend score beats the parent's. The
// verdict is a number comparison, never a model's opinion. Every generation is one lineage row (generation, parent, changes,
// hypothesis, score before/after, kept, bench summary). Runs N generations or until converged (no kept change for `patience` gens).
//
// PROPOSER CONTRACT (plug in another proposer, e.g. an LLM one, without touching the loop):
//   proposer = { name: string, propose(history, design, ctx) -> Proposal | Proposal[] | Promise<Proposal | Proposal[]> }
//   Proposal = { changes: [{ part, param, to }], hypothesis?: string (≤ 200 chars) }
//   history  = lineage rows so far (read-only copies, oldest first; ctx.history_limit caps how many are passed)
//   design   = the current parent Design (a copy; mutating it has no effect)
//   ctx      = { gen, rng, sigma, lambda, params: [{ part, param, min, max, step, unit, label, int? }], rules: [{ id, article, text }],
//               parent: { id, score, summary }, baseline: { score, summary }, objective: string }
//   Values outside a parameter's domain are clamped and quantised (the row records `clamped`); unknown parameters fail the
//   proposal (recorded, not thrown). A missing hypothesis is generated from the diff. Legality is never the proposer's call:
//   illegal candidates are measured for legality only and can never be kept. An async proposer needs optimizeAsync().
// Dual browser / Node: window.EI.concept.optimize and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const parts = req("parts", "./parts.js"), design = req("design", "./design.js"), regs = req("regs", "./regs.js"), benchMod = req("bench", "./bench.js");

  // expected effect of moving a parameter up / down (the hypothesis text; the bench decides)
  const EFFECT = {
    "layout.wheelbase_mm": ["more floor area (load), more mass, less agile", "lighter and more agile, less floor area"],
    "survival_cell.front_axle_offset_mm": ["cell moves forward of the axle: weight forward, shorter packaging", "weight rearward, longer packaging"],
    "survival_cell.cockpit_len_mm": ["driver further back, longer car", "driver forward, shorter packaging"],
    "survival_cell.bulkhead_gap_mm": ["PU further back: weight rearward", "PU forward: weight forward, shorter packaging"],
    "front_wing.span_mm": ["more front load, lower induced drag", "less front load, lighter"],
    "front_wing.chord_mm": ["more front load and drag", "less front load and drag"],
    "front_wing.aoa_deg": ["more front load and drag, balance forward", "less front drag, balance rearward"],
    "front_wing.elements": ["later stall, more load, more drag and mass", "lighter, earlier stall"],
    "front_wing.sm_delta_deg": ["flatter front flaps in straight mode: less drag on straights", "less straight-mode drag relief"],
    "rear_wing.span_mm": ["more rear load, lower induced drag", "less rear load, lighter"],
    "rear_wing.chord_mm": ["more rear load and drag", "less rear load and drag"],
    "rear_wing.aoa_deg": ["more rear load, more drag: corners up, straights down", "less drag: straights up, corners down"],
    "rear_wing.elements": ["later stall, more load, more drag and mass", "lighter; one volume means no straight mode"],
    "rear_wing.endplate_top_mm": ["taller endplates: less induced drag", "shorter endplates: lighter"],
    "rear_wing.sm_delta_deg": ["flatter rear flap in straight mode: less drag on straights", "less straight-mode drag relief"],
    "floor.width_mm": ["wider floor: more load, more mass", "narrower floor: less load"],
    "floor.throat_mm": ["higher throat: less load, safer from stall", "lower throat: more suction, closer to stall"],
    "floor.ride_height_mm": ["higher: less floor load, no plank wear", "lower: more floor load, closer to stall and plank wear"],
    "diffuser.expansion_deg": ["more expansion: more load until it separates", "less expansion: less load and drag"],
    "sidepods.inlet_cm2": ["more cooling, more drag and mass", "less cooling drag and mass, risk of thermal derate"],
    "sidepods.undercut_mm": ["deeper undercut: less body drag, feeds the floor, squeezes radiators", "shallower undercut: more radiator room, more drag"],
    "ballast.x_frac": ["ballast rearward: weight distribution back", "ballast forward: weight distribution forward"],
    "ballast.extra_kg": ["extra ballast: heavier, more freedom on distribution", "less ballast: lighter"],
  };
  function hypothesize(changes) {
    if (!changes.length) return "No change.";
    const parts_ = changes.map(c => { const e = EFFECT[c.part + "." + c.param], up = c.to > c.from; return (e ? e[up ? 0 : 1] : (up ? "increase" : "decrease")); });
    const what = changes.map(c => { const s = design.spec(c.part, c.param); return c.part.replace("_", " ") + " " + s.label.split(" (")[0].toLowerCase() + " " + (c.to > c.from ? "+" : "") + +(c.to - c.from).toFixed(2) + (s.unit === "°" ? "°" : s.unit ? " " + s.unit : ""); });
    const text = "Try " + what.join(", ") + ". Expect " + parts_.join("; ") + ".";
    return text.length > 200 ? text.slice(0, 197) + "..." : text;
  }

  // the default proposer: (1+λ) evolution strategy. λ children of the parent, each 1-3 parameters moved by a gaussian step of
  // σ × the parameter's domain width (σ adapts in the loop: ×1.25 on a kept generation, ×0.9 otherwise, within [0.01, 0.3]).
  function esProposer(lambda) {
    return {
      name: "es(1+" + (lambda || 8) + ")",
      propose(history, d, ctx) {
        const out = [];
        for (let i = 0; i < ctx.lambda; i++) { const m = design.mutate(d, ctx.rng, ctx.sigma); out.push({ changes: m.changes.map(c => ({ part: c.part, param: c.param, to: c.to })) }); }
        return out;
      },
    };
  }

  // compact, deterministic summary of a bench result (no timings) for lineage rows and proposer context
  function summary(r) {
    if (!r) return null;
    const s = { legal: r.legal, score: r.score, mass_kg: r.mass && r.mass.total_kg, ballast_kg: r.mass && r.mass.ballast_kg, front_share: r.mass && r.mass.front_share, df: r.aero && r.aero.df, cd: r.aero && r.aero.cd, cd_sm: r.aero && r.aero.cd_sm };
    if (r.weekend) { s.lap_s = r.weekend.lap_s; s.gap_to_pole_s = r.weekend.gap_to_pole_s; s.grid_position = r.weekend.grid_position; }
    s.circuits = {}; for (const c of Object.keys(r.circuits || {})) { const x = r.circuits[c]; s.circuits[c] = { lap_s: x.lap_s, sectors_s: x.sectors_s, vmax_kmh: x.vmax_kmh, speed_trap_kmh: x.speed_trap_kmh, vmin_kmh: x.vmin_kmh }; }
    if (!r.legal) s.violations = (r.violations || []).map(v => v.id).concat(r.errors || []);
    return s;
  }
  const OBJECTIVE = "maximise the Silverstone weekend score (margin to the real 2026 pole, s); legality is a hard constraint";

  function init(opts) {
    opts = Object.assign({ gens: 200, seed: 1, lambda: 8, sigma: 0.08, patience: 60, until: "gens", history_limit: 50 }, opts || {});
    const benchOpts = Object.assign({ circuit: "silverstone" }, opts.bench || {});
    const start = opts.start ? design.clone(opts.start) : design.baseline();
    const startResult = benchMod.bench(start, benchOpts);
    if (!startResult.legal) throw new Error("concept optimize: the starting design is illegal (" + summary(startResult).violations.join(", ") + ")");
    return {
      opts, benchOpts, proposer: opts.proposer || esProposer(opts.lambda), rng: design.seededRng(opts.seed),
      baseline: start, baselineResult: startResult, parent: start, parentResult: startResult, sigma: opts.sigma, stale: 0, lineage: [], gen: 0, stopped: null,
    };
  }
  function ctxOf(st) {
    return {
      gen: st.gen, rng: st.rng, sigma: st.sigma, lambda: st.opts.lambda, objective: OBJECTIVE,
      params: parts.PARAMS.map(s => Object.assign({}, s)), rules: regs.RULES.filter(r => r.kind !== "info").map(r => ({ id: r.id, article: r.article, text: r.text })),
      parent: { id: st.parent.id, score: st.parentResult.score, summary: summary(st.parentResult) }, baseline: { score: st.baselineResult.score, summary: summary(st.baselineResult) },
    };
  }
  const historyOf = st => JSON.parse(JSON.stringify(st.lineage.slice(-st.opts.history_limit)));
  // measure one generation's proposals and decide (numbers only); returns the lineage row
  function settle(st, raw) {
    const props = (Array.isArray(raw) ? raw : raw ? [raw] : []);
    const cands = [];
    props.forEach((p, i) => {
      const id = "g" + st.gen + "." + i;
      let applied;
      try { applied = design.applyChanges(st.parent, (p && p.changes) || [], { id, parent: st.parent.id, label: "generation " + st.gen + " candidate " + i }); }
      catch (e) { cands.push({ id, error: String(e.message || e) }); return; }
      if (!applied.changes.length) { cands.push({ id, error: "no change" }); return; }
      const r = benchMod.bench(applied.design, st.benchOpts);
      cands.push({ id, design: applied.design, changes: applied.changes, hypothesis: (p.hypothesis && String(p.hypothesis).slice(0, 200)) || hypothesize(applied.changes), result: r });
    });
    const legal = cands.filter(c => c.result && c.result.legal);
    let best = null; for (const c of legal) if (!best || c.result.score > best.result.score + 1e-12) best = c;
    const before = st.parentResult.score, kept = !!best && best.result.score > before + 1e-9;
    const shown = best || cands.find(c => c.result) || null;
    const row = {
      gen: st.gen, id: shown ? shown.id : null, parent: st.parent.id, proposer: st.proposer.name,
      changes: shown ? shown.changes : [], hypothesis: shown ? shown.hypothesis : "no measurable proposal",
      score_before: before, score_after: best ? best.result.score : null, delta_score: best ? +(best.result.score - before).toFixed(3) : null,
      kept, legal: !!best,
      result: shown ? summary(shown.result) : null,
      outcome: best ? outcome(best.result, st.parentResult) : "no legal candidate this generation",
      sigma: +st.sigma.toFixed(4), n_proposed: props.length, n_measured: cands.filter(c => c.result).length, n_illegal: cands.filter(c => c.result && !c.result.legal).length,
      candidates: cands.map(c => ({ id: c.id, score: c.result ? c.result.score : null, legal: c.result ? c.result.legal : false, violations: c.result && !c.result.legal ? summary(c.result).violations : undefined, error: c.error })),
      label: benchMod.LABEL,
    };
    if (kept) { st.parent = best.design; st.parentResult = best.result; st.sigma = Math.min(0.3, st.sigma * 1.25); st.stale = 0; }
    else { st.sigma = Math.max(0.01, st.sigma * 0.9); st.stale++; }
    st.lineage.push(row);
    if (st.opts.onGeneration) st.opts.onGeneration(row);
    return row;
  }
  function outcome(r, p) {
    const w = r.weekend, pw = p.weekend;
    return "Silverstone " + w.lap_s.toFixed(3) + " s (" + (w.lap_s - pw.lap_s >= 0 ? "+" : "") + (w.lap_s - pw.lap_s).toFixed(3) + " vs parent), P" + w.grid_position + ", mass " + r.mass.total_kg + " kg, front " + (r.mass.front_share * 100).toFixed(1) + " %";
  }
  function done(st) { return st.gen >= st.opts.gens || (st.opts.until === "converged" && st.stale >= st.opts.patience); }
  function finish(st) {
    st.stopped = st.opts.until === "converged" && st.stale >= st.opts.patience ? "converged (no kept change for " + st.opts.patience + " generations)" : "generation limit";
    return {
      best: st.parent, best_result: st.parentResult, baseline: st.baseline, baseline_result: st.baselineResult,
      lineage: st.lineage, generations: st.gen, kept: st.lineage.filter(r => r.kept).length, stopped: st.stopped,
      diff: design.diff(st.baseline, st.parent), seed: st.opts.seed, proposer: st.proposer.name, objective: OBJECTIVE, label: benchMod.LABEL,
    };
  }
  // optimize(opts) -> { best, best_result, baseline, baseline_result, lineage, generations, kept, stopped, diff, ... }
  // opts: { gens = 200, seed = 1, lambda = 8, sigma = 0.08, until: "gens" | "converged", patience = 60, start?: Design,
  //         proposer?: Proposer, bench?: { circuit, circuits, sim, calibration, mass_weight }, onGeneration?(row) }
  function optimize(opts) {
    const st = init(opts);
    while (!done(st)) {
      st.gen++;
      const raw = st.proposer.propose(historyOf(st), design.clone(st.parent), ctxOf(st));
      if (raw && typeof raw.then === "function") throw new Error("concept optimize: proposer returned a Promise; use optimizeAsync()");
      settle(st, raw);
    }
    return finish(st);
  }
  async function optimizeAsync(opts) {
    const st = init(opts);
    while (!done(st)) { st.gen++; settle(st, await st.proposer.propose(historyOf(st), design.clone(st.parent), ctxOf(st))); }
    return finish(st);
  }

  const api = { OBJECTIVE, EFFECT, hypothesize, esProposer, summary, optimize, optimizeAsync };
  C.optimize = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
