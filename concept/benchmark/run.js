#!/usr/bin/env node
// PURPLE TESTS TO POLE - run the algorithm-alone baselines (and the replay check) for the seeds of the recorded steered runs.
//   MUBIT_MOCK=1 node concept/benchmark/run.js --seeds 7,11,12 --budget 3500 --workers 4 --out <scratch dir> \
//       [--root 7=<repo root of the commit seed 7 ran on>] [--methods engine_noai,cmaes,replay]
// Writes <out>/<method>-seed<N>.json only (never data/). No Mubit call: no code path here reaches server/; the engine's llm is a
// local function (no-AI: always fails -> engine fallback; replay: the recorded answers).
// Then: node concept/benchmark/report.js --raw <out> --write   (curves.json + the doc tables)
// Physics corrections (TESTS_TO_POLE.md §8), local and mock only:
//   --methods mock_fixation_corrections,mock_fixation_plain   the fixation STAND-IN (concept/benchmark/fixation.js, not a model) with
//       and without the corrections block, on this checkout's physics, same 3,500-lap cap, segments on (as the steered runs)
//   --methods engine_noai --label current   the no-AI engine on this checkout's physics for seed 7 too (file engine_noai_current-seed7.json)
//   --methods replay_text,replay_text_corrections   the replay check, scenario text included: the recorded proposals fed back with the
//       per-segment report on (as recorded); every decision's scenario text is compared with the text the run sent (events.jsonl),
//       byte for byte, with corrections off; with corrections on, the text without the block must be that text and the physics
//       (laps, best) unchanged. Seeds 11 and 12 (seed 7 ran on older code that has no corrections option).
// The live "steered with corrections" run is concept/engineer/cli.js (it injects the live Mubit caller; no file in this directory reaches the network).
"use strict";
const fs = require("fs"), path = require("path");
const B = require("./baselines.js"), S = require("./steered.js"), F = require("./fixation.js");

function parseArgs(argv) {
  const a = { seeds: [7, 11, 12], budget: 3500, workers: 4, out: null, roots: {}, methods: ["engine_noai", "cmaes", "replay"], label: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--seeds") { a.seeds = v.split(",").map(Number); i++; }
    else if (k === "--budget") { a.budget = +v; i++; }
    else if (k === "--workers") { a.workers = +v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--methods") { a.methods = v.split(","); i++; }
    else if (k === "--root") { const [s, p] = v.split("="); a.roots[+s] = path.resolve(p); i++; }
    else if (k === "--label") { if (!/^[a-z0-9_]{1,30}$/.test(v)) throw new Error("--label: a-z 0-9 _"); a.label = v; i++; }
    else throw new Error("unknown option " + k);
  }
  if (!a.out) throw new Error("--out DIR is required (a scratch directory; never data/)");
  const rel = path.relative(path.join(__dirname, "..", ".."), path.resolve(a.out));
  if (rel === "data" || rel.startsWith("data" + path.sep)) throw new Error("--out must not be data/");
  return a;
}

async function main(argv) {
  const a = parseArgs(argv);
  // the concept modules register themselves on globalThis.EI.concept (dual browser / Node) and prefer that registry, so two code
  // roots must never share a process: run each root's seeds in their own invocation
  if (new Set(a.seeds.map(s => a.roots[s] || "")).size > 1) throw new Error("one code root per process: run the --root seeds in a separate invocation");
  fs.mkdirSync(a.out, { recursive: true });
  for (const seed of a.seeds) {
    // seeds without a recorded steered run (extra context seeds) run the baselines only
    const root = a.roots[seed] || null, rec = fs.existsSync(path.join(S.RUNS_DIR, "trained-engineer-seed" + seed)) ? S.loadRecorded(seed) : null;
    if (!rec && a.methods.some(m => /^replay/.test(m))) throw new Error("seed " + seed + ": no recorded steered run to replay");
    for (const m of a.methods) {
      const file = path.join(a.out, m + (a.label ? "_" + a.label : "") + "-seed" + seed + ".json");
      if (fs.existsSync(file)) { process.stderr.write("skip " + file + " (exists)\n"); continue; }
      process.stderr.write(m + " seed " + seed + (root ? " (root " + root + ")" : "") + " ...\n");
      let r;
      if (m === "engine_noai") r = await B.runEngine({ root, seed, budget: a.budget, workers: a.workers, llm: B.noAiLlm() });
      else if (m === "cmaes") r = await B.runCma({ root, seed, budget: a.budget, workers: a.workers });
      else if (m === "replay") r = await B.runEngine({ root, seed, budget: null, workers: a.workers, llm: B.replayLlm(rec.proposals), maxDecisions: rec.proposals.length, mock: true });
      else if (m === "replay_text" || m === "replay_text_corrections") {
        if (root) throw new Error(m + ": this checkout only (the recorded seed-7 code has no corrections option)");
        const sent = S.loadRequests(seed), on = m === "replay_text_corrections";
        r = await B.runEngine({ seed, budget: null, workers: a.workers, llm: B.replayLlm(rec.proposals), maxDecisions: rec.proposals.length, mock: true, segments: true, corrections: on });
        const decs = r.result.decisions, strip = t => { const o = JSON.parse(t); delete o.corrections; return JSON.stringify(o); };
        const same = decs.filter(d => (on ? strip(d.scenario) : d.scenario) === sent.get(d.decision)).length;
        const rp = rec.points, pts = r.points;
        r.text_check = { decisions: decs.length, recorded_requests: sent.size, texts_equal: same, points_equal: rp.length === pts.length && rp.every((p, i) => p.laps === pts[i].laps && Math.abs(p.best_s - pts[i].best_s) < 5e-4) };
        if (on) {
          const add = decs.map(d => d.scenario_chars - sent.get(d.decision).length);
          r.text_check.corrections_chars = { min: Math.min(...add), max: Math.max(...add), mean: Math.round(add.reduce((x, y) => x + y, 0) / add.length) };
          r.examples = [Math.ceil(decs.length / 2), decs.length].map(k => ({ decision: k, corrections: JSON.parse(decs[k - 1].scenario).corrections }));
        }
        process.stderr.write("  " + m + " seed " + seed + ": " + JSON.stringify(r.text_check) + "\n");
      }
      else if (m === "mock_fixation_corrections" || m === "mock_fixation_plain") {
        if (root) throw new Error(m + ": runs on this checkout's physics only (no --root)");
        r = await B.runEngine({ seed, budget: a.budget, workers: a.workers, llm: F.fixationLlm(seed), mock: true, segments: true, corrections: m === "mock_fixation_corrections" });
        r.proposer = "fixation stand-in (concept/benchmark/fixation.js), NOT a model";
      }
      else throw new Error("unknown method " + m);
      delete r.result;
      r.method = m; r.root = root ? "extracted commit (see doc)" : "this checkout"; r.budget = /^replay/.test(m) ? null : a.budget;
      if (rec && r.baseline_s !== rec.baseline_s) process.stderr.write("  WARNING: baseline " + r.baseline_s + " differs from the recorded run's " + rec.baseline_s + "\n");
      fs.writeFileSync(file, JSON.stringify(r));
      const last = r.points[r.points.length - 1];
      process.stderr.write("  " + m + " seed " + seed + ": " + last.laps + " laps, best " + last.best_s + " s, " + r.runtime_s + " s\n");
    }
  }
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
module.exports = { parseArgs, main };
