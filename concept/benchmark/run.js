#!/usr/bin/env node
// PURPLE TESTS TO POLE - run the algorithm-alone baselines (and the replay check) for the seeds of the recorded steered runs.
//   MUBIT_MOCK=1 node concept/benchmark/run.js --seeds 7,11,12 --budget 3500 --workers 4 --out <scratch dir> \
//       [--root 7=<repo root of the commit seed 7 ran on>] [--methods engine_noai,cmaes,replay]
// Writes <out>/<method>-seed<N>.json only (never data/). No Mubit call: no code path here reaches server/; the engine's llm is a
// local function (no-AI: always fails -> engine fallback; replay: the recorded answers).
// Then: node concept/benchmark/report.js --raw <out> --write   (curves.json + the doc tables)
"use strict";
const fs = require("fs"), path = require("path");
const B = require("./baselines.js"), S = require("./steered.js");

function parseArgs(argv) {
  const a = { seeds: [7, 11, 12], budget: 3500, workers: 4, out: null, roots: {}, methods: ["engine_noai", "cmaes", "replay"] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--seeds") { a.seeds = v.split(",").map(Number); i++; }
    else if (k === "--budget") { a.budget = +v; i++; }
    else if (k === "--workers") { a.workers = +v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--methods") { a.methods = v.split(","); i++; }
    else if (k === "--root") { const [s, p] = v.split("="); a.roots[+s] = path.resolve(p); i++; }
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
    if (!rec && a.methods.includes("replay")) throw new Error("seed " + seed + ": no recorded steered run to replay");
    for (const m of a.methods) {
      const file = path.join(a.out, m + "-seed" + seed + ".json");
      if (fs.existsSync(file)) { process.stderr.write("skip " + file + " (exists)\n"); continue; }
      process.stderr.write(m + " seed " + seed + (root ? " (root " + root + ")" : "") + " ...\n");
      let r;
      if (m === "engine_noai") r = await B.runEngine({ root, seed, budget: a.budget, workers: a.workers, llm: B.noAiLlm() });
      else if (m === "cmaes") r = await B.runCma({ root, seed, budget: a.budget, workers: a.workers });
      else if (m === "replay") r = await B.runEngine({ root, seed, budget: null, workers: a.workers, llm: B.replayLlm(rec.proposals), maxDecisions: rec.proposals.length, mock: true });
      else throw new Error("unknown method " + m);
      r.method = m; r.root = root ? "extracted commit (see doc)" : "this checkout"; r.budget = m === "replay" ? null : a.budget;
      if (rec && r.baseline_s !== rec.baseline_s) process.stderr.write("  WARNING: baseline " + r.baseline_s + " differs from the recorded run's " + rec.baseline_s + "\n");
      fs.writeFileSync(file, JSON.stringify(r));
      const last = r.points[r.points.length - 1];
      process.stderr.write("  " + m + " seed " + seed + ": " + last.laps + " laps, best " + last.best_s + " s, " + r.runtime_s + " s\n");
    }
  }
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
module.exports = { parseArgs, main };
