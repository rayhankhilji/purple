#!/usr/bin/env node
// PURPLE ENGINE v2 - one engine run from the terminal on a physics-lap budget: the "steered with corrections" run of the tests-to-pole
// benchmark (docs/concept/TESTS_TO_POLE.md §8). Same engine settings as the recorded steered runs and the baselines (3,000 variants,
// confirm 24 + 4 explore, patience 3, segments on, 4 workers), stopped at the 3,500-physics-lap cap or --max-decisions.
//   node concept/engineer/cli.js --mock fixation --seed 11 --out DIR            the fixation stand-in (concept/benchmark/fixation.js), no network
//   node concept/engineer/cli.js --mock scripted --seed 11 --out DIR            the scripted mock (concept/designer/loop.js), no network
//   node concept/engineer/cli.js --live --seed 11 --out DIR                     real UNTRAINED calls (x-middleware-record: metadata)
//   node concept/engineer/cli.js --live --confirm-trained "TRAIN 150" --seed 11 --out DIR
//                                                                               TRAINED calls: the typed text must be "TRAIN <--max-decisions>"
//   node concept/engineer/cli.js --live --task compact --confirm-trained "TRAIN 40" --record-good exact --screen direct --mix 2 --seed 11
//        --max-decisions 40 --budget 100000 --workers 1 --out DIR                the "changes only" harvest (compact task)
// Options: --task v1|compact (v1 = concept/designer/prompt.js, the default; compact = concept/designer/prompt-compact.js, ONE change,
// no hypothesis: a separate frozen Mubit task) · --record-good [exact|kept] (with --confirm-trained: calls untrained, physics-approved
// decisions re-sent as trained with the SAME task and request; exact = the idea as written, the default) · --mix 1|2 (2 = Claude
// directs every other decision, the engine's random step the rest) · --screen full|direct (full = 3,000 variants / confirm 24 + 4;
// direct = one physics test per idea) · --corrections on|off (on) · --memory on|off (off; on = the shared-memory "precedents"
// block, concept/engineer/memory.js, in every scenario) · --budget LAPS (3500) · --max-decisions N (150; one designer call
// per decision) · --workers W (4) · --run-id ID (the Mubit session id, metadata.user_id; default eng-corr-s<seed>-<ulid>) · --team redbull|generic (redbull)
// Writes DIR/steered_corrections-seed<N>.json (the benchmark curve: node concept/benchmark/report.js --corrections DIR) and
// DIR/run-seed<N>/ (run.json, events.jsonl, decisions.jsonl, calls.jsonl, tree.json, state.json: the recorded-run format of
// server/campaign-route.js, so the folder can be copied to docs/concept/loop-runs/). Never data/. Mubit only through server/mubit.js
// (server/concept.js designerLlm, G-MUBIT-06), whose process-wide slots keep ≤ 2 calls in flight; a run makes one call at a time.
// Trained guards (as the engine route): --live, the typed text, ≤ TRAINED_RUN_CAP calls, the designer prompt not a DRAFT, enough of
// the project's trained-call budget left (counted read-only from the call logs, server/campaign-route.js trainedBudget).
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const prompt = require("../designer/prompt.js"), promptCompact = require("../designer/prompt-compact.js"), loop = require("../designer/loop.js"), engine = require("./engine.js"), recordGood = require("./record-good.js");
const B = require("../benchmark/baselines.js"), F = require("../benchmark/fixation.js"), conceptCli = require("../cli.js");

// --task: which frozen designer task the run's calls use (the proposal call and record-good's trained re-send alike)
const TASKS = { v1: prompt, compact: promptCompact };
const taskOf = a => TASKS[(a && a.task) || "v1"];
// a mock answer in the compact task's format: the mock proposers write v1 answers ({ changes 1-3, hypothesis, expected }); with
// --task compact a mock run keeps only the first change, so the compact parser is exercised end to end without a network
function compactAnswer(r) {
  const o = typeof r === "string" ? { text: r } : Object.assign({}, r);
  let v = null; try { v = JSON.parse(String(o.text).trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (e) { return o; }
  if (v && Array.isArray(v.changes) && v.changes.length) o.text = JSON.stringify({ changes: [v.changes[0]] });
  return o;
}

function parseArgs(argv) {
  const a = { mode: null, mock: null, trained: false, confirm: null, seed: null, corrections: true, memory: false, budget: 3500, maxDecisions: 150, workers: 4, out: null, runId: null, team: "redbull", screen: "full", mix: 1, recordGood: false, recordRule: "exact", task: "v1" };
  const setMode = m => { if (a.mode && a.mode !== m) throw new Error("choose one of --mock, --live"); a.mode = m; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--mock") { setMode("mock"); a.mock = v; i++; } else if (k === "--live") setMode("live");
    else if (k === "--confirm-trained") { a.trained = true; a.confirm = v; i++; }
    else if (k === "--seed") { a.seed = +v; i++; } else if (k === "--corrections") { if (!["on", "off"].includes(v)) throw new Error("--corrections on|off"); a.corrections = v === "on"; i++; }
    else if (k === "--memory") { if (!["on", "off"].includes(v)) throw new Error("--memory on|off"); a.memory = v === "on"; i++; }
    else if (k === "--record-good") { a.recordGood = true; if (recordGood.RULES.includes(v)) { a.recordRule = v; i++; } }
    else if (k === "--task") { if (!Object.prototype.hasOwnProperty.call(TASKS, v)) throw new Error("--task v1|compact"); a.task = v; i++; }
    else if (k === "--mix") { if (!["1", "2"].includes(v)) throw new Error("--mix 1|2"); a.mix = +v; i++; }
    else if (k === "--screen") { if (!["full", "direct"].includes(v)) throw new Error("--screen full|direct"); a.screen = v; i++; }
    else if (k === "--budget") { a.budget = +v; i++; } else if (k === "--max-decisions") { a.maxDecisions = +v; i++; } else if (k === "--workers") { a.workers = +v; i++; }
    else if (k === "--out") { a.out = v; i++; } else if (k === "--run-id") { a.runId = v; i++; } else if (k === "--team") { a.team = v; i++; }
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error("unknown option " + k);
  }
  if (a.help) return a;
  if (!a.mode) throw new Error("say --mock fixation|scripted or --live");
  if (a.mode === "mock" && !["fixation", "scripted"].includes(a.mock)) throw new Error("--mock fixation|scripted");
  if (!Number.isInteger(a.seed)) throw new Error("--seed N is required");
  if (!(Number.isInteger(a.budget) && a.budget >= 30 && a.budget <= 200000)) throw new Error("--budget: physics laps, 30-200000");
  if (!(Number.isInteger(a.maxDecisions) && a.maxDecisions >= 1 && a.maxDecisions <= 2000)) throw new Error("--max-decisions: 1-2000");
  if (!(Number.isInteger(a.workers) && a.workers >= 0 && a.workers <= 16)) throw new Error("--workers: 0-16");
  if (!a.out) throw new Error("--out DIR is required (a scratch directory; never data/)");
  if (!["redbull", "generic"].includes(a.team)) throw new Error("--team redbull|generic");
  if (a.recordGood && !a.trained) throw new Error("--record-good needs --confirm-trained (it records the physics-approved decisions as trained calls)");
  if (a.trained && a.mode !== "live") throw new Error("--confirm-trained only applies to --live (trained calls are live calls)");
  if (a.trained && a.confirm !== "TRAIN " + a.maxDecisions) throw new Error("type the confirmation exactly: --confirm-trained \"TRAIN " + a.maxDecisions + "\" (one call per decision, --max-decisions " + a.maxDecisions + ")");
  if (a.runId != null && !/^[A-Za-z0-9_.:-]{1,120}$/.test(a.runId)) throw new Error("--run-id: letters, digits and _ . : - only (≤ 120)");
  return a;
}

// the live caller and its guards (loaded only for --live: server/ is never required by a mock run)
function liveCaller(a) {
  require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(ROOT, "server", ".env") });
  if (process.env.MUBIT_MOCK === "1") throw new Error("--live with MUBIT_MOCK=1: unset MUBIT_MOCK for real calls");
  if (!process.env.MUBIT_API_KEY) throw new Error("--live needs MUBIT_API_KEY (server/.env)");
  let budget = null;
  if (a.trained) {
    if (taskOf(a).DRAFT) throw new Error("trained calls are refused while the designer prompt is a DRAFT");
    const route = require("../../server/campaign-route.js");
    if (a.maxDecisions > route.TRAINED_RUN_CAP) throw new Error("--max-decisions for a trained run is capped at " + route.TRAINED_RUN_CAP);
    budget = route.trainedBudget(ROOT, [process.env.PURPLE_DATA_DIR || null, path.join(ROOT, "data")]);
    if (budget.remaining < a.maxDecisions) throw new Error("not enough trained-call budget left: " + budget.remaining + " of " + budget.total + " remain, this run asks for " + a.maxDecisions);
  }
  const server = require("../../server/concept.js");
  return { call: server.designerLlm(null, taskOf(a)), budget };   // the same caller (same task) makes record-good's trained re-send
}

async function main(argv, io) {
  io = io || { out: s => process.stdout.write(s), err: s => process.stderr.write(s) };
  const a = parseArgs(argv);
  if (a.help) { const L = fs.readFileSync(__filename, "utf8").split("\n"); io.out(L.slice(1, L.indexOf('"use strict";')).map(l => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); return 0; }
  const live = a.mode === "live" ? liveCaller(a) : null;
  const out = conceptCli.assertSafeOut(path.resolve(a.out));
  const runId = a.runId || "eng-corr-s" + a.seed + "-" + require("ulid").ulid().toLowerCase();
  const dir = path.join(out, "run-seed" + a.seed);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["events.jsonl", "decisions.jsonl", "calls.jsonl"]) fs.writeFileSync(path.join(dir, f), "");
  const append = (f, row) => fs.appendFileSync(path.join(dir, f), JSON.stringify(row) + "\n");
  const llmName = a.mode === "live" ? "live" : "mock";
  const task = taskOf(a);
  const mockCall = live ? null : a.mock === "fixation" ? F.fixationLlm(a.seed) : loop.mockCaller(a.seed);
  const caller = live ? live.call : a.task === "compact" ? async (text, meta) => compactAnswer(await mockCall(text, meta)) : mockCall;
  let n = 0, errRun = 0, abort = null;
  // --record-good: every designer call is untrained; a decision whose proposal, exactly as proposed, is legal and faster on physics is
  // sent again as a TRAINED call (same request; temperature 0, so the same answer): only physics-approved decisions become Mubit examples.
  // The logic is shared with the engine route (concept/engineer/record-good.js).
  const rec = a.recordGood && live ? recordGood.recorder(caller, {
    onExample: (g, o, meta) => { append("calls.jsonl", { created_at: new Date().toISOString(), kind: "design", engine: "engineer-v2", session_id: meta.sessionId, iteration: meta.gen, trained: true, mock: false, corrections: a.corrections, record_good: true, prompt_version: task.DESIGNER_PROMPT_VERSION, mubit_request_id: o.mubit_request_id || null, served_by: o.served_by || null, model: o.model || null, input_tokens: o.input_tokens, output_tokens: o.output_tokens, latency_ms: o.latency_ms, same_answer: g.same_answer });
      append("good.jsonl", { decision: g.decision, d_lap_s: g.d_lap_s, untrained_id: g.untrained_request_id, trained_id: g.trained_request_id, served_by: g.served_by }); },
    onError: g => append("good.jsonl", { decision: g.decision, error: g.error }),
  }, { rule: a.recordRule }) : null;
  const llm = async (text, meta) => {
    if (abort) { const e = new Error(abort); e.code = "run_cap"; throw e; }
    if (rec) await rec.before();   // one call in flight per process: a pending re-send finishes before the next decision's call
    // --mix 2: the model directs every other decision; the others take the engine's own blind step (the no-AI proposer), no call
    if (a.mix > 1 && (meta.gen || 0) % a.mix === 1) { const e = new Error("mix: engine step this decision"); e.code = "no_ai"; throw e; }
    n++;
    const row = { created_at: new Date().toISOString(), kind: "design", engine: "engineer-v2", session_id: meta.sessionId, iteration: meta.gen, trained: !!meta.trained, mock: !live, corrections: a.corrections, memory: a.memory, prompt_version: task.DESIGNER_PROMPT_VERSION };
    try {
      const r = await caller(text, meta);
      const o = typeof r === "string" ? { text: r } : r;
      append("calls.jsonl", Object.assign(row, { mubit_request_id: o.mubit_request_id || null, served_by: o.served_by || null, model: o.model || null, input_tokens: o.input_tokens == null ? null : o.input_tokens, output_tokens: o.output_tokens == null ? null : o.output_tokens, latency_ms: o.latency_ms == null ? null : o.latency_ms, status: "ok" }));
      errRun = 0; if (rec) rec.seen(text, meta, o); return o;
    } catch (e) {
      append("calls.jsonl", Object.assign(row, { mubit_request_id: e.requestId || null, status: "error", mubit_code: e.code || null, http_status: e.status || null }));
      if (++errRun >= 5) abort = "5 designer calls failed in a row (last: " + (e.code || e.message) + ")";
      throw e;
    }
  };
  let seq = 0;
  const onEvent = (type, data) => {
    if (type === "progress") return;
    append("events.jsonl", Object.assign({ seq: seq++, at: new Date().toISOString() }, data, { type }));
    if (type === "decision") {
      append("decisions.jsonl", data.row);
      const r = data.row;
      if (rec) rec.decision(r);
      io.err("#" + String(r.decision).padStart(3) + " " + (r.mubit_request_id || "-").slice(0, 16) + " " + r.by.padEnd(6) + (r.kept ? " kept " : " -    ") + "peak " + data.peak.lap_s.toFixed(3) + " · laps " + data.stats.physics_laps + " · " + (r.as_proposed && r.as_proposed.legal === false ? "ILLEGAL " : "") + (r.proposal_change || "") + "\n");
    }
  };
  const started = new Date().toISOString();
  const opts = { llm: llmName, mock: a.mock, trained: a.trained, task: a.task, prompt_version: task.DESIGNER_PROMPT_VERSION, record_good: a.recordGood ? a.recordRule : false, team: a.team, seed: a.seed, corrections: a.corrections, memory: a.memory, budget: a.budget, max_calls: a.maxDecisions, max_decisions: a.maxDecisions, patience: 3, stop_after: null, ...require("../benchmark/baselines.js").SCREENS[a.screen], segments: true, workers: a.workers };
  io.out("PURPLE engine v2 · " + (live ? "LIVE through Mubit · " + (a.trained ? "TRAINED" : "untrained (x-middleware-record: metadata)") : "MOCK (" + a.mock + ", not a model; no network)") + " · task " + a.task + " (" + task.DESIGNER_PROMPT_VERSION + ")" + (a.recordGood ? " · record-good " + a.recordRule : "") + " · corrections " + (a.corrections ? "on" : "off") + " · memory " + (a.memory ? "on" : "off") + " · seed " + a.seed + " · budget " + a.budget + " physics laps · ≤ " + a.maxDecisions + " decisions · session " + runId + (live && live.budget ? " · trained budget " + live.budget.remaining + " of " + live.budget.total + " left" : "") + "\n");
  const r = await B.runEngine({ seed: a.seed, team: a.team === "generic" ? null : a.team, budget: a.budget, workers: a.workers, llm, mock: !live, corrections: a.corrections, memory: a.memory, segments: true, trained: a.trained && !a.recordGood, runId, onEvent, maxDecisions: a.maxDecisions, maxCalls: a.maxDecisions, screen: a.screen, prompt: task });
  const goodRows = rec ? (await rec.drain()).filter(g => !g.error) : [];
  if (a.recordGood) io.err("record-good: " + goodRows.length + " physics-approved decisions recorded as trained calls");
  const res = r.result; delete r.result;
  const ids = res.decisions.map(d => (d.call ? d.call.mubit_request_id : null));
  const stop = abort || res.stopped;
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(res.state) + "\n");
  fs.writeFileSync(path.join(dir, "tree.json"), JSON.stringify(res.tree.compact(["root", "result", "proposal", "projected", "repaired", "candidate", "explore", "alone"])) + "\n");
  const final = { summary: engine.summaryOf(res), calls: n, stop_reason: stop, best_params: res.peak.params, tree: res.tree.compact() };
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ run_id: runId, mode: "engineer", llm: llmName, trained: a.trained, status: abort ? "stopped" : "done", stop_reason: stop, started_at: started, finished_at: new Date().toISOString(), error: null, dir: "run-seed" + a.seed, opts, final }, null, 2) + "\n");
  append("events.jsonl", { seq: seq++, at: new Date().toISOString(), type: "final", run_id: runId, summary: final.summary, calls: n, stop_reason: stop });
  Object.assign(r, { method: "steered_corrections", llm: llmName, mock_proposer: live ? null : a.mock, trained: a.trained, corrections: a.corrections, run_id: runId, request_ids: ids, calls: n, root: "this checkout", budget: a.budget, stopped: stop, models: Array.from(new Set(res.decisions.map(d => d.call && d.call.model).filter(Boolean))) });
  const file = path.join(out, (a.corrections ? "steered_corrections" : "steered_plain") + "-seed" + a.seed + ".json");
  fs.writeFileSync(file, JSON.stringify(r));
  const last = r.points[r.points.length - 1];
  io.out("done: " + r.decisions + " decisions · " + n + " calls · " + last.laps + " physics laps · best " + last.best_s + " s (baseline " + r.baseline_s + ") · stop: " + stop + " · " + r.runtime_s + " s\n");
  io.out("explore: " + JSON.stringify(r.explore) + "\nwrote " + file + " and " + dir + "/\n");
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then(c => { process.exitCode = c; }, e => { console.error("engine cli: " + (e && e.message || e)); process.exitCode = 1; });
module.exports = { parseArgs, main, TASKS, compactAnswer };
