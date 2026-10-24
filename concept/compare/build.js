#!/usr/bin/env node
// PURPLE SIDE BY SIDE - builds the data of /concept/compare/ (three cars redesigning themselves on one clock: physics laps used).
//   MUBIT_MOCK=1 node concept/compare/build.js --seeds 12 --workers 2 [--budget 3500] [--lanes purple,cmaes,random]
// Writes concept/compare/data/seed<N>.json only. No Mubit call, no network: lane A is READ from a recorded live run, lanes B and C
// run locally on the physics lap sim (worker threads, concept/campaign/pool.js).
//   purple  "PURPLE · Claude through Mubit": the recorded live trained engine-v2 run docs/concept/loop-runs/trained-engineer-seed<N>/
//           (state.json: every measured car with its params; decisions.jsonl). Points per decision, exactly as TESTS_TO_POLE.md
//           (concept/benchmark/steered.js reconstructs the same curve and checks it against the streamed peaks).
//   cmaes   "A standard optimiser (CMA-ES), no AI": concept/campaign/run.js runSeed with the options of concept/benchmark/baselines.js
//           runCma (λ 16, surrogate pre-screen ×4, patience 25), same seed, same team, every physics evaluation logged with its lap
//           (null = illegal, the bench refused it: still one physics lap, as TESTS_TO_POLE.md counts) and the best design so far.
//           Points per generation, cut at the budget (as curves.json).
//   random  "Random parts, no engineer": a uniform target over the full search box (concept/campaign/space.js, the catalogue box
//           tightened by single-number FIA limits), seeded design.seededRng(seed), pulled back along the line from the RB22 until it
//           passes the free rule / PU / material check (the screen the campaign uses before the sim; ~1 uniform draw in 1,500 passes
//           as drawn); each car is driven ONCE on the physics sim. One point per physics lap. See laneRandom.
// Every lap: physics lap sim, Silverstone, model prediction. Target: Antonelli's real 2026 British GP pole, 88.111 s (OpenF1).
"use strict";
const fs = require("fs"), path = require("path");

const HERE = path.join(__dirname, "..", "..");
const OUT = path.join(__dirname, "data");
const RUNS = path.join(HERE, "docs", "concept", "loop-runs");
const C = require("../benchmark/curves.js");
const LABEL = "physics lap sim · Silverstone · model prediction";
const POLE = { code: "ANT", s: 88.111, source: "Antonelli's real 2026 British GP pole lap (OpenF1)" };
const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);
// --root DIR: the repository root whose concept/ code lanes B and C run on (seed 7's recorded run used commit 5bf4b1c's physics,
// extracted with git archive as in docs/concept/TESTS_TO_POLE.md §3); default this checkout
let ROOT = HERE;
const mod = p => require(path.join(ROOT, "concept", p));
const readJsonl = f => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));

// a design's params, compact: numbers rounded to 6 decimals (they are quantised to the catalogue steps already)
function compactParams(p) {
  const o = {};
  for (const part of Object.keys(p).sort()) { o[part] = {}; for (const k of Object.keys(p[part]).sort()) { const v = p[part][k]; o[part][k] = typeof v === "number" ? +v.toFixed(6) : v; } }
  return o;
}

// ---- lane A: the recorded run
function lanePurple(seed) {
  const dir = path.join(RUNS, "trained-engineer-seed" + seed);
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  const decisions = readJsonl(path.join(dir, "decisions.jsonl"));
  if (run.llm !== "live" || !run.trained) throw new Error("compare: " + dir + " is not a live trained run");
  for (const d of decisions) if (d.by !== "mubit" || !/^mreq_[0-9a-f]{32}$/.test(d.mubit_request_id || "")) throw new Error("compare: decision " + d.decision + " has no real Mubit request id");
  const nodes = state.tree.nodes, root = nodes.find(n => n.kind === "root");
  const points = C.fromEngine({ baseline_s: root.lap_s, decisions, nodes });
  const byDec = new Map();
  for (const n of nodes) if (n.decision != null) { if (!byDec.has(n.decision)) byDec.set(n.decision, []); byDec.get(n.decision).push(n); }
  const tries = [], steps = [], designs = [{ laps: 0, best_s: root.lap_s, params: compactParams(root.params) }];
  let laps = 0, best = root.lap_s;
  for (const d of decisions) {
    const ns = byDec.get(d.decision) || [];
    if (ns.length !== d.physics_laps) throw new Error("compare: decision " + d.decision + " nodes " + ns.length + " vs physics_laps " + d.physics_laps);
    // the decision's cars were confirmed in parallel; they are listed in the tree's order
    for (const n of ns) tries.push([++laps, n.legal && typeof n.lap_s === "number" ? r3(n.lap_s) : null]);
    const legal = ns.filter(n => n.legal && typeof n.lap_s === "number").sort((a, b) => a.lap_s - b.lap_s);
    if (legal.length && legal[0].lap_s < best) { best = legal[0].lap_s; designs.push({ laps, best_s: r3(best), params: compactParams(legal[0].params) }); }
    steps.push([laps, r3(best)]);
  }
  const p = points.slice(1);
  if (p.length !== steps.length || p.some((q, i) => q.laps !== steps[i][0] || Math.abs(q.best_s - steps[i][1]) > 5e-4)) throw new Error("compare: lane A disagrees with concept/benchmark/curves.js fromEngine");
  const reach = C.reach(points, POLE.s);
  return {
    id: "purple", title: "PURPLE · Claude through Mubit",
    who: "Claude Haiku 4.5 through Mubit picks each idea; PURPLE's engine screens it and tests the best few on the physics lap sim",
    source: "recorded live run docs/concept/loop-runs/trained-engineer-seed" + seed + "/ (run " + run.run_id + ", " + decisions.length + " Mubit calls, real mreq_ ids); no new call",
    step: "idea", baseline_s: root.lap_s, steps, tries, designs, end_laps: laps, end_reason: run.stop_reason,
    to_pole: reach ? { laps: reach.laps, step: reach.step, best_s: r3(reach.best_s) } : null, final_s: r3(best),
    run_id: run.run_id, calls: decisions.length,
  };
}

// ---- lane B: CMA-ES, every physics lap logged (concept/benchmark/baselines.js runCma, plus the per-lap record)
async function laneCma(seed, budget, workers) {
  const design = mod("design.js"), run = mod("campaign/run.js"), { Pool } = mod("campaign/pool.js"), S = mod("surrogate/surrogate.js");
  const opts = { evals: budget, lambda: 16, prescreen: 4, patience: 25, quiet: true };
  const pool = new Pool(workers);
  try {
    const { conditions } = run.qualiConditions();
    const benchOpts = { circuit: "silverstone", sim: "physics", objective: "quali", conditions };
    const base = design.baseline({ team: "redbull" });
    const [baseRes] = await pool.evaluate([base], benchOpts);
    if (!baseRes.legal) throw new Error("compare: baseline illegal");
    const tries = [], steps = [], designs = [{ laps: 0, best_s: r3(baseRes.lap_s), params: compactParams(base.params) }];
    let laps = 0, best = baseRes.lap_s;
    const evaluate = pool.evaluate.bind(pool);
    pool.evaluate = async (ds, bo) => {
      const res = await evaluate(ds, bo);
      let bestD = null;
      res.forEach((q, j) => { laps++; tries.push([laps, q.legal ? r3(q.lap_s) : null]); if (q.legal && q.lap_s < best - 1e-9) { best = q.lap_s; bestD = ds[j]; } });
      if (bestD) designs.push({ laps, best_s: r3(best), params: compactParams(bestD.params) });
      steps.push([laps, r3(best)]);
      return res;
    };
    const ctx = { opts, team: "redbull", base, baseRes, benchOpts, pool, pre: pc => S.predictLap(pc, "silverstone", "physics"), label: "redbull", hooks: {}, stopped: null };
    const s = await run.runSeed(ctx, seed);
    if (s.physics_laps !== laps) throw new Error("compare: CMA-ES counted " + s.physics_laps + " laps, logged " + laps);
    if (Math.abs(s.best_s - best) > 1e-9) throw new Error("compare: CMA-ES best " + s.best_s + " vs logged " + best);
    // cut at the budget (the last generation may overshoot it), as concept/benchmark/curves.json
    const cut = steps.filter(p => p[0] <= budget), endLaps = cut[cut.length - 1][0];
    const cutTries = tries.filter(t => t[0] <= endLaps), cutDesigns = designs.filter(d => d.laps <= endLaps);
    const pts = [{ laps: 0, best_s: baseRes.lap_s, legal_laps: 0, screened: 0, step: 0 }].concat(cut.map((p, i) => ({ laps: p[0], best_s: p[1], legal_laps: 0, screened: 0, step: i + 1 })));
    const reach = C.reach(pts, POLE.s);
    return {
      id: "cmaes", title: "A standard optimiser (CMA-ES), no AI",
      who: "CMA-ES moves every parameter at once, 16 to 64 cars per round, and learns only from physics laps",
      source: "concept/campaign/run.js runSeed (CMA-ES with restarts, λ 16, surrogate pre-screen ×4), seed " + seed + ", re-run locally by concept/compare/build.js",
      step: "round", baseline_s: baseRes.lap_s, steps: cut, tries: cutTries, designs: cutDesigns, end_laps: endLaps, end_reason: "physics-lap budget " + budget,
      to_pole: reach ? { laps: reach.laps, step: reach.step, best_s: r3(reach.best_s) } : null, final_s: cut[cut.length - 1][1],
      run_laps: s.physics_laps, restarts: s.restarts.length,
    };
  } finally { await pool.close(); }
}

// ---- lane C: random legal designs from the full box, each driven once
async function laneRandom(seed, budget, workers) {
  const design = mod("design.js"), run = mod("campaign/run.js"), space = mod("campaign/space.js"), { Pool } = mod("campaign/pool.js");
  const pool = new Pool(workers), rng = design.seededRng(seed);
  try {
    const { conditions } = run.qualiConditions();
    const benchOpts = { circuit: "silverstone", sim: "physics", objective: "quali", conditions };
    const base = design.baseline({ team: "redbull" });
    const [baseRes] = await pool.evaluate([base], benchOpts);
    const tries = [], steps = [], designs = [{ laps: 0, best_s: r3(baseRes.lap_s), params: compactParams(base.params) }];
    // About 1 uniform draw in 1,500 passes every rule (seed 12: wheelbase packaging, plank, front mass, cooling ...), so a pure
    // rejection sampler needs millions of free checks per 3,500 cars. Instead each random target u (uniform over the whole box) is
    // pulled back along the straight line from the RB22 towards u just far enough to pass the free rule / PU / material check
    // (bisection on t in [0, 1], 8 checks; t = 1 when u itself is legal). The direction is random over every parameter; only the
    // distance is limited by the rules. A pull-back to under 1/256 of the way is dropped (it would re-drive the baseline), not counted.
    const x0 = space.encode(base), legal = x => run.screen(space.decode(x, base), null).legal, at = (u, t) => x0.map((v, i) => v + t * (u[i] - v));
    let laps = 0, best = baseRes.lap_s, draws = 0, rejected = 0, full = 0, tSum = 0;
    const BATCH = 32;
    while (laps < budget) {
      const batch = [];
      while (batch.length < Math.min(BATCH, budget - laps)) {
        draws++;
        const u = space.VARS.map(() => rng());
        let t = 1;
        if (!legal(u)) { let lo = 0, hi = 1; for (let it = 0; it < 8; it++) { const m = (lo + hi) / 2; if (legal(at(u, m))) lo = m; else hi = m; } t = lo; }
        if (t < 1 / 256) { rejected++; continue; }
        if (t === 1) full++;
        tSum += t;
        batch.push(space.decode(at(u, t), base, { id: "rand" + draws }));
        if (draws > 1e6) throw new Error("compare: random lane found no legal draws");
      }
      const res = await pool.evaluate(batch, benchOpts);
      res.forEach((q, j) => {
        laps++; tries.push([laps, q.legal ? r3(q.lap_s) : null]);
        if (q.legal && q.lap_s < best - 1e-9) { best = q.lap_s; designs.push({ laps, best_s: r3(best), params: compactParams(batch[j].params) }); }
        steps.push([laps, r3(best)]);
      });
    }
    const pts = [{ laps: 0, best_s: baseRes.lap_s, legal_laps: 0, screened: 0, step: 0 }].concat(steps.map((p, i) => ({ laps: p[0], best_s: p[1], legal_laps: 0, screened: 0, step: i + 1 })));
    const reach = C.reach(pts, POLE.s);
    return {
      id: "random", title: "Random parts, no engineer",
      who: "every car is a random change to every parameter at once, pulled back towards the RB22 only as far as the rules need, driven once",
      source: "uniform targets over concept/campaign/space.js (seeded, seed " + seed + "), each pulled back along the line from the RB22 until it passes the free rule check; " + full + " of " + laps + " targets were legal as drawn; mean distance kept " + (tSum / Math.max(1, laps)).toFixed(3) + "; " + rejected + " draws dropped (pulled back to the baseline itself), not counted",
      step: "car", baseline_s: baseRes.lap_s, steps, tries, designs, end_laps: laps, end_reason: "physics-lap budget " + budget,
      to_pole: reach ? { laps: reach.laps, step: reach.step, best_s: r3(reach.best_s) } : null, final_s: r3(best),
      draws, rejected_before_sim: rejected, legal_as_drawn: full, mean_t: +(tSum / Math.max(1, laps)).toFixed(4),
    };
  } finally { await pool.close(); }
}

async function main(argv) {
  const a = { seeds: [12], budget: 3500, workers: 2, lanes: ["purple", "cmaes", "random"] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--seeds") { a.seeds = v.split(",").map(Number); i++; }
    else if (k === "--budget") { a.budget = +v; i++; }
    else if (k === "--workers") { a.workers = Math.min(2, +v); i++; }
    else if (k === "--lanes") { a.lanes = v.split(","); i++; }
    else if (k === "--root") { ROOT = path.resolve(v); a.root = ROOT; i++; }
    else if (k === "--index-only") { a.seeds = []; }
    else throw new Error("unknown option " + k);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const curves = require("../benchmark/curves.json");
  for (const seed of a.seeds) {
    const file = path.join(OUT, "seed" + seed + ".json");
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    const lanes = prev ? prev.lanes : {};
    for (const id of a.lanes) {
      const t0 = Date.now();
      process.stderr.write("seed " + seed + " lane " + id + " ...\n");
      lanes[id] = id === "purple" ? lanePurple(seed) : id === "cmaes" ? await laneCma(seed, a.budget, a.workers) : id === "random" ? await laneRandom(seed, a.budget, a.workers) : null;
      if (!lanes[id]) throw new Error("unknown lane " + id);
      lanes[id].build_s = +((Date.now() - t0) / 1000).toFixed(1);
      const L = lanes[id];
      process.stderr.write("  " + id + ": " + L.end_laps + " laps, best " + L.final_s + ", beats pole at " + (L.to_pole ? L.to_pole.laps : "—") + " (" + L.build_s + " s)\n");
      save(seed, lanes, prev, a, curves, file);
    }
  }
  writeIndex(curves);
}
function save(seed, lanes, prev, a, curves, file) {
  {
    const ref = curves.seeds[seed] || null;
    const doc = {
      v: 1, label: LABEL, pole: POLE, seed, budget: a.budget,
      physics: ref ? ref.physics : null,
      code: a.root ? "lanes B and C ran on commit 5bf4b1c's concept/ (the code the recorded seed-" + seed + " run used)" : (prev && prev.code) || "this checkout",
      baseline: { code: "RB22", what: "Red Bull RB22 baseline car on the same physics lap sim", s: lanes.purple ? lanes.purple.baseline_s : null },
      caption: "Same physics simulator, same Silverstone lap, same test budget.",
      tests_to_pole: ref ? { source: "docs/concept/TESTS_TO_POLE.md · concept/benchmark/curves.json", steered: ref.summary && ref.summary.steered && ref.summary.steered.to_pole ? ref.summary.steered.to_pole.laps : null, cmaes: ref.summary && ref.summary.cmaes && ref.summary.cmaes.to_pole ? ref.summary.cmaes.to_pole.laps : null, engine_noai: ref.summary && ref.summary.engine_noai && ref.summary.engine_noai.to_pole ? ref.summary.engine_noai.to_pole.laps : null } : null,
      lanes,
    };
    fs.writeFileSync(file, JSON.stringify(doc) + "\n");
    process.stderr.write("wrote " + path.relative(HERE, file) + " (" + Math.round(fs.statSync(file).size / 1024) + " KB)\n");
  }
}

// data/index.json: the seeds the page can show (default 12) and the over-seeds numbers of TESTS_TO_POLE.md for the footer
function writeIndex(curves) {
  const seeds = fs.readdirSync(OUT).map(f => /^seed(\d+)\.json$/.exec(f)).filter(Boolean).map(m => +m[1]).sort((x, y) => x - y);
  const agg = k => { const s = curves.aggregate[k].to_pole_laps; return { mean: Math.round(s.mean), sd: Math.round(s.sd), n: s.n }; };
  const at = k => { const o = {}; for (const B of ["500", "1000", "2000"]) { const s = curves.aggregate[k].best_at[B]; o[B] = { mean: r3(s.mean), n: s.n }; } return o; };
  const idx = {
    v: 1, default: seeds.includes(12) ? 12 : seeds[0],
    seeds: seeds.map(s => { const d = JSON.parse(fs.readFileSync(path.join(OUT, "seed" + s + ".json"), "utf8")); return { seed: s, physics: d.physics, lanes: Object.keys(d.lanes) }; }),
    tests_to_pole: {
      source: "docs/concept/TESTS_TO_POLE.md §1 / §4.4 (concept/benchmark/curves.json aggregate), seeds 7, 11, 12",
      to_pole_laps: { steered: agg("steered"), cmaes: agg("cmaes"), engine_noai: agg("engine_noai") },
      best_at: { steered: at("steered"), cmaes: at("cmaes"), engine_noai: at("engine_noai") },
    },
  };
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(idx, null, 1) + "\n");
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { lanePurple, laneCma, laneRandom, compactParams, POLE, LABEL };
