// PURPLE TESTS TO POLE - the algorithm-alone baselines, run locally on the physics lap sim (no Mubit, no network, nothing written).
//   engine_noai  the SAME engine v2 (concept/engineer/engine.js: subspace, 3,000-variant surrogate screen, physics confirm of the top 24
//                + 4 unranked, interactions, keep / revert / fork) with NO language model: the injected llm always fails, so every
//                decision takes the engine's own direction, a seeded design.mutate step of the head (1-3 random catalogue parameters,
//                gaussian step 6 % of the range; engine.js "engine" fallback). It uses no canned proposal. The scripted mock
//                (concept/designer/loop.js mockLlm) is NOT used: it walks a PLAYBOOK of hand-picked target values (known-good moves).
//   cmaes        the concept campaign's per-seed CMA-ES with restarts (concept/campaign/run.js runSeed): λ = 16, surrogate
//                pre-screen ×4 (the surrogate ranks 4λ candidates, 3/4 of the λ physics slots go to its best, 1/4 random), CMA-ES
//                learns only from physics laps. Each physics evaluation = one lap; surrogate screens are counted separately.
//                The campaign's post-seed refinement (volume counts, concept switches, materials, coordinate search on the best of
//                all seeds) is not part of a per-seed budget and is not run.
//   replay       the steered run's own recorded proposals fed back to the same engine (no Mubit: the answers are read from
//                events.jsonl): reproduces the recorded run exactly iff the code / physics here is the code / physics it ran on.
// `root` is the repository root whose concept/ code is used (default this checkout; seed 7 ran before the redesigns merge, so its
// baselines run on that commit's concept/ extracted with git archive, see docs/concept/TESTS_TO_POLE.md §3).
"use strict";
const path = require("path");
const C = require("./curves.js");

const HERE = path.join(__dirname, "..", "..");
const mod = (root, p) => require(path.join(root || HERE, "concept", p));

// the no-AI "llm": always fails, labelled, so engine.js takes its own seeded direction (by: "engine") on every decision
function noAiLlm() {
  return async () => { const e = new Error("no language model in this run: the engine chooses the direction (seeded design.mutate)"); e.code = "no_ai"; throw e; };
}
// a recorded run's answers, by decision index (schema-conforming JSON: the changes the engine accepted from the model)
function replayLlm(proposals) {
  const byDec = new Map(proposals.map(p => [p.decision, p]));
  return async (text, meta) => {
    const p = byDec.get(meta.gen); if (!p) throw Object.assign(new Error("replay: no recorded proposal for decision " + meta.gen), { code: "replay_end" });
    return { text: JSON.stringify({ changes: p.changes.map(c => ({ part: c.part, param: c.param, to: c.to })), hypothesis: p.hypothesis || "recorded", expected: p.expected || { lap_delta_s: -1, sector: 1 } }), mubit_request_id: null, model: "replay", mock: true };
  };
}

// engine v2 on a physics-lap budget: stops before the first decision that would start at or past `budget` laps (the last decision
// may overshoot by its own confirm batch; curves are truncated at the budget for the tables)
// corrections (default false): the physics-corrections block in the scenario (concept/engineer/scenario.js). The no-AI and replay
// runs never read the scenario, so it is off for them (and off is how the recorded runs ran). segments (default false): the
// per-segment report the steered runs fed into their scenario (not a physics lap, never counted). trained: passed to the llm as
// meta.trained only; this module never calls Mubit (a live, trained llm is injected by concept/engineer/cli.js).
// screen: { variants, confirm, explore } (default the engine's 3,000 / 24 / 4); { variants: 1, confirm: 1, explore: 0 } is the expensive-test
// regime: each idea is tested once, exactly as proposed (after the engine's legal repair), one physics lap per decision.
const SCREENS = { full: { variants: 3000, confirm: 24, explore: 4 }, direct: { variants: 1, confirm: 1, explore: 0 } };
async function runEngine({ root, seed, team, budget, workers, llm, maxDecisions, stopAfter, mock, corrections, segments, trained, runId, onEvent, maxCalls, screen }) {
  const engine = mod(root, "engineer/engine.js");
  const t0 = Date.now();
  let laps = 0;
  const extra = corrections ? { corrections: true } : { corrections: false };
  const res = await engine.runEngineer(Object.assign({
    llm, mock: !!mock, seed, team: team || "redbull", trained: !!trained, workers: workers == null ? 4 : workers,
    maxDecisions: maxDecisions || 100000, maxCalls: maxCalls || 100000, stopAfter: stopAfter || 1e9, patience: 3, ...(SCREENS[screen || "full"] || screen),
    segments: !!segments, runId, onEvent,
    shouldStop: ({ decisions }) => { laps = decisions.reduce((s, d) => s + d.physics_laps, 0); return budget != null && laps >= budget ? "physics-lap budget " + budget : null; },
  }, extra));
  const points = C.fromEngine({ baseline_s: res.baseline.lap_s, decisions: res.decisions, nodes: res.tree.nodes });
  const by = res.stats.by;
  return {
    seed, baseline_s: res.baseline.lap_s, pole_s: res.pole_s, stopped: res.stopped, runtime_s: +((Date.now() - t0) / 1000).toFixed(1),
    decisions: res.decisions.length, by, kept: res.stats.kept, reverts: res.stats.reverts, forks: res.stats.forks, points,
    peak_params: res.peak.params, corrections: !!corrections, explore: exploreStats(res.decisions), result: res,
  };
}
// how the directions spread over the catalogue: distinct parameters / parts named, the most-named parameter, illegal as proposed
function exploreStats(decisions) {
  const P = new Map(), parts = new Set(); let illegal = 0;
  for (const d of decisions) {
    for (const c of d.proposal || []) { const k = c.part + "." + c.param; P.set(k, (P.get(k) || 0) + 1); parts.add(c.part); }
    if (d.as_proposed && d.as_proposed.legal === false) illegal++;
  }
  const top = Array.from(P.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] || null;
  return { decisions: decisions.length, distinct_params: P.size, distinct_parts: parts.size, top_param: top ? top[0] : null, top_param_decisions: top ? top[1] : 0, illegal_as_proposed: illegal };
}

// CMA-ES: runSeed with a pool that logs every physics batch (one CMA-ES generation) in order
async function runCma({ root, seed, team, budget, workers, lambda, prescreen, patience }) {
  const design = mod(root, "design.js"), run = mod(root, "campaign/run.js"), { Pool } = mod(root, "campaign/pool.js");
  const S = mod(root, "surrogate/surrogate.js");
  const opts = { evals: budget, lambda: lambda || 16, prescreen: prescreen == null ? 4 : prescreen, patience: patience || 25, quiet: true };
  const pool = new Pool(workers == null ? 4 : workers);
  const t0 = Date.now();
  try {
    const { conditions } = run.qualiConditions();
    const benchOpts = { circuit: "silverstone", sim: "physics", objective: "quali", conditions };
    const base = design.baseline({ team: team || "redbull" });
    const [baseRes] = await pool.evaluate([base], benchOpts);
    if (!baseRes.legal) throw new Error("tests-to-pole: baseline illegal");
    // log every batch from here on (the start car above is not counted, as in the engine)
    const K = opts.prescreen > 1 ? opts.prescreen : 1;
    const points = [{ laps: 0, legal_laps: 0, screened: 0, best_s: baseRes.lap_s, step: 0 }];
    let laps = 0, legal = 0, screened = 0, best = baseRes.lap_s, gen = 0;
    const evaluate = pool.evaluate.bind(pool);
    pool.evaluate = async (designs, bo) => {
      const res = await evaluate(designs, bo);
      gen++; laps += res.length; screened += K > 1 ? res.length * K : 0;
      for (const q of res) if (q.legal) { legal++; if (q.lap_s < best - 1e-9) best = q.lap_s; }
      points.push({ laps, legal_laps: legal, screened, best_s: best, step: gen });
      return res;
    };
    const pre = K > 1 ? (pc => S.predictLap(pc, "silverstone", "physics")) : null;
    const ctx = { opts, team: team || "redbull", base, baseRes, benchOpts, pool, pre, label: team || "redbull", hooks: {}, stopped: null };
    const s = await run.runSeed(ctx, seed);
    if (s.physics_laps !== laps) throw new Error("tests-to-pole: CMA-ES counted " + s.physics_laps + " laps, the pool " + laps);
    if (K > 1 && s.surrogate_screened !== screened) throw new Error("tests-to-pole: CMA-ES screened " + s.surrogate_screened + ", logged " + screened);
    if (Math.abs(s.best_s - best) > 1e-9) throw new Error("tests-to-pole: CMA-ES best " + s.best_s + " vs logged " + best);
    return { seed, baseline_s: baseRes.lap_s, runtime_s: +((Date.now() - t0) / 1000).toFixed(1), restarts: s.restarts, generations: gen, points, peak_params: s.best.params };
  } finally { await pool.close(); }
}

module.exports = { SCREENS, noAiLlm, replayLlm, runEngine, runCma, exploreStats };
