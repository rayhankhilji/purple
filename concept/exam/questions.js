// PURPLE DESIGNER EXAM - the questions: held-out car states, each with the EXACT task input the engine sends to the frozen designer
// task at that decision (concept/engineer/engine.js builds it with concept/engineer/scenario.js; this file never builds a scenario
// itself, it records the text the engine hands to its `llm`).
// Held out: the source runs use seeds 101-110, which no recorded run used (trained runs: docs/concept/loop-runs/trained-* seeds 7,
// 11-14, 21-32, 41, 42; replays concept/lab/replays the same). They are driven by the scripted mock (concept/designer/loop.js
// mockCaller, no network, no model), team redbull, Silverstone, engine defaults (3,000 variants, confirm 24, explore 4, patience 3).
// Picked per run (3 per run, 30 in all; deterministic): progress p = (baseline lap - head lap) / (baseline lap - the run's final peak)
//   early: the last decision 2-6 with p <= 0.2 (decision 1 is the same baseline state in every run, so it is never used),
//   mid:   the decision with p closest to 0.5,
//   late:  the latest decision whose head is the peak of the run so far with p >= 0.85 (else the decision with the highest p).
// Every question carries the head car (params, team, lap), so the grader can rebuild the decision exactly.
// Ordering: id order interleaves the phases (q01 early, q02 mid, q03 late, q04 early, ...), so the first n are balanced.
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto"), os = require("os");
const design = require("../design.js");
const engine = require("../engineer/engine.js");
const loop = require("../designer/loop.js");
const prompt = require("../designer/prompt.js");
const { Pool } = require("../campaign/pool.js");
const { ScreenPool } = require("../engineer/screen.js");

const FILE = path.join(__dirname, "questions.json");
const SEEDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
const USED_SEEDS = [1, 2, 3, 7, 11, 12, 13, 14, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 41, 42];   // recorded / trained runs (see header)
const TEAM = "redbull";
const RUN = { maxDecisions: 30, stopAfter: 15, patience: 3, variants: 3000, confirm: 24, explore: 4 };
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);

// one mock engine run; returns every decision's snapshot { k, text, head: { node, params, lap_s }, peak_lap_s }
async function snapshots(seed, o) {
  o = o || {};
  const team = o.team || TEAM, run = Object.assign({}, RUN, o.run || {});
  let headParams = design.baseline({ team }).params, headNode = "n0", peakLap = null;
  const snaps = [];
  let cur = null;
  const mock = loop.mockCaller(seed);
  const llm = async (text, meta) => { cur = { k: meta.gen, text }; return mock(text, meta); };
  const res = await engine.runEngineer(Object.assign({}, run, {
    llm, mock: true, seed, team, runId: "exam-src-seed" + seed, maxCalls: run.maxDecisions, segments: true, pool: o.pool, screenPool: o.screenPool,
    onEvent(type, data) {
      if (type === "start") peakLap = data.baseline.lap_s;
      if (type === "decision") {
        // the row's head is the car this decision's scenario was built on
        snaps.push({ k: data.decision, text: cur.text, head: { node: data.row.head, params: JSON.parse(JSON.stringify(headParams)), lap_s: data.row.head_lap_s }, peak_lap_s: peakLap, scenario_chars: data.row.scenario_chars });
        if (data.head_params) headParams = data.head_params;
        headNode = data.head; peakLap = data.peak.lap_s;
      }
    },
  }));
  return { seed, baseline_lap_s: res.baseline.lap_s, final_peak_lap_s: res.peak.lap_s, stopped: res.stopped, snaps };
}

function pick(run, used) {
  const B = run.baseline_lap_s, span = B - run.final_peak_lap_s;
  const p = s => (span > 1e-9 ? (B - s.head.lap_s) / span : 0);
  const free = s => s.k >= 2 && !used.has(sha(s.text));
  const out = [];
  const take = (phase, s) => { if (!s) return; used.add(sha(s.text)); out.push({ phase, s, progress: p(s) }); };
  // early
  let c = run.snaps.filter(s => free(s) && s.k <= 6 && p(s) <= 0.2);
  take("early", c.length ? c[c.length - 1] : run.snaps.filter(free).sort((a, b) => p(a) - p(b) || a.k - b.k)[0]);
  // mid
  c = run.snaps.filter(free).sort((a, b) => Math.abs(p(a) - 0.5) - Math.abs(p(b) - 0.5) || a.k - b.k);
  take("mid", c[0]);
  // late: head at the peak so far (head lap == peak lap) and p >= 0.85; latest first
  c = run.snaps.filter(s => free(s) && Math.abs(s.head.lap_s - s.peak_lap_s) < 1e-9 && p(s) >= 0.85).sort((a, b) => b.k - a.k);
  if (!c.length) c = run.snaps.filter(free).sort((a, b) => p(b) - p(a) || b.k - a.k);
  take("late", c[0]);
  return out;
}

// build({ seeds, workers, run, log }) -> the questions document (deterministic for any worker count)
async function build(o) {
  o = o || {};
  const seeds = o.seeds || SEEDS;
  for (const s of seeds) if (USED_SEEDS.includes(s)) throw new Error("exam: seed " + s + " was used by a recorded run; not held out");
  const workers = o.workers == null ? Math.min(4, os.cpus().length) : o.workers;
  const pool = new Pool(workers), screenPool = new ScreenPool(workers);
  const log = o.log || (() => {});
  const byPhase = { early: [], mid: [], late: [] }, runs = [];
  const used = new Set();
  try {
    for (const seed of seeds) {
      const t0 = Date.now();
      const run = await snapshots(seed, { pool, screenPool, run: o.run, team: o.team });
      runs.push({ seed, decisions: run.snaps.length, baseline_lap_s: run.baseline_lap_s, final_peak_lap_s: run.final_peak_lap_s, stopped: run.stopped });
      for (const x of pick(run, used)) byPhase[x.phase].push(Object.assign({ seed, baseline_lap_s: run.baseline_lap_s, final_peak_lap_s: run.final_peak_lap_s }, x));
      log("exam questions: seed " + seed + " " + run.snaps.length + " decisions, " + run.baseline_lap_s.toFixed(3) + " -> " + run.final_peak_lap_s.toFixed(3) + " s (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
    }
  } finally { await pool.close(); await screenPool.close(); }
  const order = [];
  const n = Math.max(byPhase.early.length, byPhase.mid.length, byPhase.late.length);
  for (let i = 0; i < n; i++) for (const ph of ["early", "mid", "late"]) if (byPhase[ph][i]) order.push(byPhase[ph][i]);
  const questions = order.map((x, i) => ({
    id: "q" + String(i + 1).padStart(2, "0"),
    phase: x.phase, source: { seed: x.seed, decision: x.s.k, proposer: "scripted mock (concept/designer/loop.js mockCaller), no model" },
    team: o.team || TEAM, circuit: "silverstone",
    head: { node: x.s.head.node, lap_s: x.s.head.lap_s, params: x.s.head.params },
    context: { baseline_lap_s: x.baseline_lap_s, peak_so_far_lap_s: x.s.peak_lap_s, run_final_peak_lap_s: x.final_peak_lap_s, progress: r3(x.progress), d_baseline_s: r3(x.s.head.lap_s - x.baseline_lap_s) },
    text: x.s.text, text_sha256: sha(x.s.text), chars: x.s.text.length,
  }));
  return {
    v: 1, kind: "purple-designer-exam-questions",
    task: { prompt_version: prompt.DESIGNER_PROMPT_VERSION, task_key_sha256: prompt.taskKeySha256(), model: prompt.MODEL },
    how: "car states from mock engine v2 runs (seeds " + seeds.join(", ") + ", held out: no recorded run used them), team " + (o.team || TEAM) + ", Silverstone; text = the exact user message the engine sends to the frozen designer task at that decision (concept/engineer/scenario.js via concept/engineer/engine.js)",
    run_opts: Object.assign({}, RUN, o.run || {}),
    label: "physics lap sim · quasi-steady-state point mass · Silverstone · calibrated to 2026 British GP qualifying; model predictions, not a real car's lap",
    runs, questions,
  };
}

function load(file) {
  const doc = JSON.parse(fs.readFileSync(file || FILE, "utf8"));
  if (!doc || doc.kind !== "purple-designer-exam-questions" || !Array.isArray(doc.questions)) throw new Error("exam: not a questions file: " + (file || FILE));
  for (const q of doc.questions) if (sha(q.text) !== q.text_sha256) throw new Error("exam: question " + q.id + " text does not match its sha256");
  return doc;
}
const serialize = doc => JSON.stringify(doc, null, 1) + "\n";

module.exports = { FILE, SEEDS, USED_SEEDS, TEAM, RUN, build, load, serialize, snapshots, pick, sha };
