// PURPLE TESTS TO POLE - the steered curves: engine v2 directed by Claude (Haiku) through Mubit, reconstructed from the RECORDED live
// trained runs in docs/concept/loop-runs/trained-engineer-seed{7,11,12}/ (run.json, decisions.jsonl, events.jsonl, tree.json).
// No Mubit call is made: this only reads files. Every reconstructed per-decision best is checked against the peak the run itself
// streamed (events.jsonl "decision" events) and the final total against run.json.
"use strict";
const fs = require("fs"), path = require("path");
const C = require("./curves.js");

const RUNS_DIR = path.join(__dirname, "..", "..", "docs", "concept", "loop-runs");
const readJsonl = f => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));

function loadRecorded(seed, dir) {
  dir = dir || path.join(RUNS_DIR, "trained-engineer-seed" + seed);
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const decisions = readJsonl(path.join(dir, "decisions.jsonl"));
  const events = readJsonl(path.join(dir, "events.jsonl"));
  const nodes = JSON.parse(fs.readFileSync(path.join(dir, "tree.json"), "utf8"));
  const calls = readJsonl(path.join(dir, "calls.jsonl"));
  const start = events.find(e => e.type === "start");
  if (run.llm !== "live" || !run.trained) throw new Error("tests-to-pole: " + dir + " is not a live trained run");
  for (const d of decisions) if (d.by !== "mubit" || !/^mreq_[0-9a-f]{32}$/.test(d.mubit_request_id || "")) throw new Error("tests-to-pole: decision " + d.decision + " of seed " + seed + " has no real Mubit request id");
  const points = C.fromEngine({ baseline_s: start.baseline.lap_s, decisions, nodes });
  // check: the reconstructed best after each decision is the peak the run streamed
  const peaks = new Map(events.filter(e => e.type === "decision").map(e => [e.decision, e.peak.lap_s]));
  for (const p of points.slice(1)) if (Math.abs(peaks.get(p.step) - p.best_s) > 5e-4) throw new Error("tests-to-pole: seed " + seed + " decision " + p.step + ": reconstructed " + p.best_s + " vs streamed peak " + peaks.get(p.step));
  const st = run.final.summary.stats, last = points[points.length - 1];
  if (last.laps !== st.physics_laps) throw new Error("tests-to-pole: seed " + seed + " physics laps " + last.laps + " vs run.json " + st.physics_laps);
  if (Math.abs(last.best_s - run.final.summary.peak_lap_s) > 5e-4) throw new Error("tests-to-pole: seed " + seed + " best " + last.best_s + " vs run.json " + run.final.summary.peak_lap_s);
  return {
    method: "steered", seed, run_id: run.run_id, started_at: run.started_at, stop_reason: run.stop_reason, opts: run.opts,
    pole_s: start.pole_s, baseline_s: start.baseline.lap_s, calls: run.final.summary.calls,
    request_ids: decisions.map(d => d.mubit_request_id), models: Array.from(new Set(calls.map(c => c.model))), points,
    proposals: events.filter(e => e.type === "proposal").map(e => ({ decision: e.decision, changes: e.changes, hypothesis: e.hypothesis, expected: e.expected })),
  };
}

// decision -> the exact scenario text (the user message) the recorded run sent at that decision
function loadRequests(seed, dir) {
  dir = dir || path.join(RUNS_DIR, "trained-engineer-seed" + seed);
  return new Map(readJsonl(path.join(dir, "events.jsonl")).filter(e => e.type === "request").map(e => [e.decision, e.scenario_text]));
}

module.exports = { loadRecorded, loadRequests, RUNS_DIR };
