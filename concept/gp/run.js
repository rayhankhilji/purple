#!/usr/bin/env node
// PURPLE MODEL GP - several AI models, the SAME budget of physics laps, the same start car, the same engine; then their cars race.
//   node concept/gp/run.js --live [--entrants haiku-4-5,opus-5-5] [--seeds 1,2,3] [--parallel 3] [--workers 1] [--memory on|off] [--out concept/gp/data]
//        real UNTRAINED calls through server/mubit.js (x-middleware-record: metadata on every call), then the summary
//   node concept/gp/run.js --mock --out DIR      every model entrant answers with the SCRIPTED MOCK (concept/designer/loop.js, not a
//        model; no network). Never into concept/gp/data (refused): mock numbers must never look like a model's.
//   node concept/gp/run.js --summary [--out concept/gp/data]   rebuild summary.json from the per-run files (after parallel processes)
// Per entrant x seed: engine v2 (concept/engineer/engine.js, called with the options concept/benchmark/baselines.js runEngine uses) with
// the SAME settings for everyone (SETTINGS below: budget 150 physics laps, screen 600 variants / confirm 8 / explore 2 so about 12-15
// ideas fit, corrections on, segments on, patience 3, memory off unless --memory on), the RB22 start car, one designer call per idea, one idea at a time. The user message is the engine's own
// scenario, unchanged; the system prompt is the frozen designer prompt (concept/designer/prompt.js) for every model; only the model id
// (and, where a model needs it, temperature left out / max_tokens 4000) differs (concept/gp/entrants.json).
// The budget is exact: the engine stops before an idea that would START at or past the budget; the last idea may run past it, and
// everything measured after physics lap 150 is dropped (the curve, the best lap and the final car are those of the first 150 laps
// in the order they were measured). Nothing is tuned or picked per model: every seed's result is written and shown.
// A model answer that does not parse (or an API error) falls back to the engine's own seeded step for that idea, exactly as the
// No-AI control does on every idea: those ideas are COUNTED (parse_failures, llm_errors) and shown; their gains are not the model's.
// After 5 failed calls in a row a run stops early and is marked incomplete (shown, never filled in).
// Concurrency: one call at a time per run, ≤ --parallel runs at once (≤ 8 calls in flight per process, G-MUBIT-05; server/mubit.js
// SLOTS keeps 8 process-wide as well); entrants may run in separate processes (each --entrants list writes its own files).
// Writes OUT/<entrant>-seed<N>.json and OUT/summary.json. Never data/.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const prompt = require("../designer/prompt.js");
const B = require("../benchmark/baselines.js");
const design = require("../design.js"), bench = require("../bench.js");

const ENTRANTS_FILE = path.join(__dirname, "entrants.json");
const DATA_DIR = path.join(__dirname, "data");
const SETTINGS = Object.freeze({ budget: 150, screen: Object.freeze({ variants: 600, confirm: 8, explore: 2 }), corrections: true, segments: true, patience: 3, team: "redbull", circuit: "silverstone", ideas: 1, memory: false });
// ---- shared memory of physics-approved precedents (concept/engineer/memory.js + engine opts.memory, built by another helper; feature-
// detected here so this file works before it lands). GP setting `memory: true|false` (--memory on|off), the same for every entrant and
// written into every run file and the summary. memory on while the engine cannot use it is REFUSED (never silently run without it).
// ADAPTER (one place): what the engine receives as opts.memory. Until memory.js lands its API is not known here: if it exports
// forEngine(opts) / load(opts) the GP passes what that returns, else `true`. The integrator checks this against memory.js when it lands.
const ENGINE_FILE = path.join(__dirname, "..", "engineer", "engine.js"), MEMORY_FILE = path.join(__dirname, "..", "engineer", "memory.js");
function memorySupport() {
  if (!fs.existsSync(MEMORY_FILE)) return { available: false, why: "concept/engineer/memory.js is not in this checkout" };
  if (!/\bopts\.memory\b/.test(fs.readFileSync(ENGINE_FILE, "utf8"))) return { available: false, why: "concept/engineer/engine.js does not read opts.memory" };
  return { available: true, module: "concept/engineer/memory.js", sha256: require("crypto").createHash("sha256").update(fs.readFileSync(MEMORY_FILE)).digest("hex") };
}
function memoryOpt(S) {
  if (!S.memory) return { opt: undefined, info: { on: false } };
  const sup = memorySupport();
  if (!sup.available) throw new Error("GP setting memory: true, but " + sup.why + " (run with --memory off, or wait for the memory helper's merge)");
  // concept/engineer/memory.js: the engine reads opts.memory (boolean) and loads the one read-only index file itself, the same file for
  // every entrant; info() names its size and sha so every run file records exactly which snapshot it used
  const M = require(MEMORY_FILE), mi = typeof M.info === "function" ? M.info() : {};
  const opt = true, size = mi.entries == null ? null : mi.entries;
  return { opt, info: { on: true, module: sup.module, module_sha256: sup.sha256, via: "engine opts.memory", size, index_sha256: mi.sha256 || null, held_out: mi.held_out || null } };
}
// the harness every entrant shares, as written into every run file and the summary (the page shows it)
const SYSTEM_PROMPT_SHA256 = require("crypto").createHash("sha256").update(prompt.SYSTEM_PROMPT).digest("hex");
function harness(S) {
  return {
    budget_physics_laps: S.budget, variants: S.screen.variants, confirm: S.screen.confirm, explore: S.screen.explore, corrections: !!S.corrections, segments: !!S.segments,
    patience: S.patience, ideas_per_call: S.ideas, memory: !!S.memory, team: S.team, circuit: S.circuit, start_car: "RB22 baseline, design.baseline({ team: '" + S.team + "' })",
    system_prompt: "concept/designer/prompt.js (frozen v" + prompt.DESIGNER_PROMPT_VERSION + ", untouched)", system_prompt_sha256: SYSTEM_PROMPT_SHA256,
    user_message: "the engine's own scenario (concept/engineer/scenario.js), unchanged", trained: false, record_header: "x-middleware-record: metadata",
  };
}
const sameHarness = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// one engine v2 run with the GP's harness: the same options concept/benchmark/baselines.js runEngine passes (patience 3, no stop-after,
// the physics-lap budget as shouldStop, the screen, corrections, segments, the frozen designer task), plus opts.memory when on
async function engineRun({ seed, S, workers, llm, mock, runId, memory }) {
  const engine = require("../engineer/engine.js");
  return engine.runEngineer(Object.assign({
    llm, mock: !!mock, seed, team: S.team, trained: false, workers: workers == null ? 1 : workers,
    maxDecisions: 100000, maxCalls: 100000, stopAfter: 1e9, patience: S.patience, variants: S.screen.variants, confirm: S.screen.confirm, explore: S.screen.explore,
    segments: !!S.segments, corrections: !!S.corrections, runId, prompt,
    shouldStop: ({ decisions }) => { const laps = decisions.reduce((s, d) => s + d.physics_laps, 0); return laps >= S.budget ? "physics-lap budget " + S.budget : null; },
  }, memory !== undefined ? { memory } : {}));
}
const MAX_IN_FLIGHT = 8;   // G-MUBIT-05: ≤ 8 calls in flight per process
const MAX_ERRORS_IN_A_ROW = 5;
const LABEL = "physics lap sim · Silverstone · model prediction";
const POLE_LABEL = "real pole · OpenF1 2026";
const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const median = xs => { const v = xs.filter(x => typeof x === "number" && isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

function entrants() { return JSON.parse(fs.readFileSync(ENTRANTS_FILE, "utf8")).entrants; }
// the frozen designer task with only the model id (and, per entrants.json, temperature left out / max_tokens) swapped
function taskFor(e) {
  if (e.provider === "none") return null;
  if (!["anthropic", "openai"].includes(e.provider)) throw new Error("entrant " + e.id + ": provider must be anthropic, openai or none");
  if (e.temperature !== null && e.temperature !== prompt.TEMPERATURE) throw new Error("entrant " + e.id + ": temperature must be null or the frozen " + prompt.TEMPERATURE);
  const t = { DRAFT: prompt.DRAFT, DESIGNER_PROMPT_VERSION: prompt.DESIGNER_PROMPT_VERSION, SYSTEM_PROMPT: prompt.SYSTEM_PROMPT, MODEL: e.model, MAX_TOKENS: e.max_tokens || prompt.MAX_TOKENS, TEMPERATURE: e.temperature === null ? null : prompt.TEMPERATURE };
  if (e.provider === "openai") t.PROVIDER = "openai";
  return Object.freeze(t);
}

// a small semaphore: at most n functions running at once
function limiter(n) {
  let active = 0, peak = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; peak = Math.max(peak, active); const { fn, res, rej } = q.shift(); Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); }); };
  const run = fn => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
  run.peak = () => peak; run.active = () => active;
  return run;
}

// the live caller for an entrant: server/mubit.js only (G-MUBIT-06), always untrained
function liveCallerFactory() {
  require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(ROOT, "server", ".env") });
  if (process.env.MUBIT_MOCK === "1") throw new Error("--live with MUBIT_MOCK=1: unset MUBIT_MOCK for real calls");
  if (!process.env.MUBIT_API_KEY) throw new Error("--live needs MUBIT_API_KEY (server/.env)");
  const mubit = require("../../server/mubit.js");
  return e => { const task = taskFor(e); return (text, meta) => mubit.callMubit({ userContent: text, sessionId: meta.sessionId, trained: false, kind: "gp", task }); };
}
function mockCallerFactory() { const loop = require("../designer/loop.js"); return (e, seed) => loop.mockCaller(seed); }

// one entrant x seed -> the run record (also written to OUT/<entrant>-seed<N>.json by runAll)
// o: { entrant, seed, call (text, meta) -> answer | null for the control, mock, workers, gate (limiter), runId, settings }
async function runOne(o) {
  const e = o.entrant, S = o.settings || SETTINGS, control = e.provider === "none";
  const runId = o.runId || "gp-" + e.id + "-s" + o.seed + "-" + require("ulid").ulid().toLowerCase();
  const calls = [];
  let errRow = 0, abort = null;
  const noAi = B.noAiLlm();
  const llm = control ? noAi : async (text, meta) => {
    if (abort) { const x = new Error(abort); x.code = "run_cap"; throw x; }
    const row = { decision: meta.gen, mubit_request_id: null, model: null, served_by: null, input_tokens: null, output_tokens: null, latency_ms: null, stop_reason: null, status: "ok" };
    calls.push(row);
    const t0 = Date.now();
    try {
      const r = await o.gate(() => o.call(text, meta));
      const a = typeof r === "string" ? { text: r } : r || {};
      Object.assign(row, { mubit_request_id: a.mubit_request_id || null, model: a.model || null, served_by: a.served_by || null, input_tokens: a.input_tokens == null ? null : a.input_tokens, output_tokens: a.output_tokens == null ? null : a.output_tokens, latency_ms: a.latency_ms == null ? Date.now() - t0 : a.latency_ms, stop_reason: a.stop_reason || null });
      errRow = 0;
      return a;
    } catch (err) {
      Object.assign(row, { status: "error", mubit_request_id: (err && err.requestId) || null, error: String((err && (err.code || err.message)) || err), http_status: (err && err.status) || null, latency_ms: Date.now() - t0 });
      if (++errRow >= MAX_ERRORS_IN_A_ROW) abort = MAX_ERRORS_IN_A_ROW + " calls failed in a row (last: " + row.error + ")";
      throw err;
    }
  };
  const t0 = Date.now();
  const mem = memoryOpt(S);
  const res = await engineRun({ seed: o.seed, S, workers: o.workers, llm, mock: !!o.mock, runId, memory: mem.opt });
  return record({ e, seed: o.seed, mock: !!o.mock, runId, res, calls, abort, runtime_s: (Date.now() - t0) / 1000, settings: S, memory: mem.info });
}

// the engine result -> the GP record, cut at the physics-lap budget in measurement order
function record({ e, seed, mock, runId, res, calls, abort, runtime_s, settings, memory }) {
  const S = settings || SETTINGS, budget = S.budget, tree = res.tree, POLE = res.pole_s, base = res.baseline.lap_s;
  const measured = tree.nodes.filter(n => n.decision != null);
  const lapsRun = res.decisions.reduce((s, d) => s + d.physics_laps, 0);
  if (measured.length !== lapsRun) throw new Error("gp: " + measured.length + " measured cars but " + lapsRun + " physics laps");
  const used = measured.slice(0, budget);
  // curve[i] = the best legal lap after i physics laps (curve[0] = the start car); tries = every physics lap [i, lap | null (illegal)];
  // designs = the best car each time it changed (the page's 3D car morphs through these on the clock)
  const curve = [r3(base)], tries = [], designs = [{ laps: 0, best_s: r3(base), params: tree.nodes[0].params }]; let best = base, bestNode = null, beat = null;
  used.forEach((n, i) => {
    tries.push([i + 1, n.legal && typeof n.lap_s === "number" ? r3(n.lap_s) : null]);
    if (n.legal && typeof n.lap_s === "number" && n.lap_s < best - 1e-12) { best = n.lap_s; bestNode = n; designs.push({ laps: i + 1, best_s: r3(best), params: paramsOf(tree, n) }); }
    curve.push(r3(best));
    if (beat == null && best < POLE - 1e-12) beat = i + 1;
  });
  // the final car: the fastest legal car of the first `budget` physics laps (the start car if none beat it)
  const params = bestNode ? paramsOf(tree, bestNode) : tree.nodes[0].params;
  const finalDesign = Object.assign(design.baseline({ team: S.team }), { params: JSON.parse(JSON.stringify(params)) });
  finalDesign.id = "gp-" + e.id + "-s" + seed; finalDesign.label = e.name + " · Model GP · seed " + seed;
  // the race page re-runs this car on the same physics lap sim; it must give the same lap (else the page time-scales and says so)
  let check = null;
  try { const b = bench.bench(finalDesign, { circuit: S.circuit, sim: "physics", objective: "quali" }); check = b.legal ? b.circuits[S.circuit].lap_s : null; } catch (err) { check = null; }
  const decs = res.decisions.filter(d => firstLapOf(measured, d.decision) < budget);
  const byWho = d => (d.by === "engine" ? (/^parse:/.test(d.fallback_reason || "") ? "parse_failure" : /^llm_error: no_ai/.test(d.fallback_reason || "") ? "control" : "llm_error") : "model");
  const own = decs.filter(d => e.provider === "none" ? true : d.by !== "engine");
  const okCalls = calls.filter(c => c.status === "ok");
  const sum = k => okCalls.reduce((s, c) => s + (typeof c[k] === "number" ? c[k] : 0), 0);
  const lapsUsed = used.length, complete = lapsUsed >= budget && !abort;
  return {
    v: 1, kind: "purple-model-gp-run", entrant: e.id, name: e.name, code: e.code, color: e.color, provider: e.provider, model: e.model || null,
    temperature: e.provider === "none" ? null : e.temperature, max_tokens: e.provider === "none" ? null : (e.max_tokens || prompt.MAX_TOKENS),
    control: e.provider === "none", mock: !!mock, trained: false, seed, run_id: runId, session_id: runId,
    label: LABEL, pole_label: POLE_LABEL, prompt_version: prompt.DESIGNER_PROMPT_VERSION,
    settings: harness(S), memory: memory || { on: !!S.memory },
    status: complete ? "complete" : "incomplete", stop_reason: abort || res.stopped, runtime_s: r3(runtime_s),
    baseline_s: r3(base), pole_s: POLE, laps_used: lapsUsed, laps_run: lapsRun, laps_dropped: lapsRun - lapsUsed,
    best_s: r3(best), gap_to_pole_s: r3(best - POLE), d_baseline_s: r3(best - base), beat_pole_at: beat,
    curve, tries, designs,
    ideas: decs.length, ideas_by: decs.reduce((m, d) => { const w = byWho(d); m[w] = (m[w] || 0) + 1; return m; }, { model: 0, parse_failure: 0, llm_error: 0, control: 0 }),
    parse_failures: decs.filter(d => byWho(d) === "parse_failure").length, llm_errors: decs.filter(d => byWho(d) === "llm_error").length,
    calls: calls.length, calls_ok: okCalls.length, latency_ms_median: median(okCalls.map(c => c.latency_ms)),
    tokens_in: okCalls.length ? sum("input_tokens") : null, tokens_out: okCalls.length ? sum("output_tokens") : null,
    proposals: own.length, illegal_as_proposed: own.filter(d => d.as_proposed && d.as_proposed.legal === false).length,
    kept: decs.filter(d => d.kept).length,
    final: { lap_s: r3(best), check_lap_s: r3(check), node: bestNode ? bestNode.id : "n0", decision: bestNode ? bestNode.decision : null, lap_index: bestNode ? used.indexOf(bestNode) + 1 : 0, params, design: { id: finalDesign.id, label: finalDesign.label, team: finalDesign.team, params: finalDesign.params } },
    request_ids: calls.map(c => c.mubit_request_id).filter(Boolean),
    models_served: Array.from(new Set(okCalls.map(c => c.model).filter(Boolean))),
    calls_log: calls,
    decisions: decs.map(d => ({ decision: d.decision, by: d.by, who: byWho(d), fallback_reason: d.fallback_reason || null, mubit_request_id: d.call ? d.call.mubit_request_id : null, latency_ms: d.call ? d.call.latency_ms : null, input_tokens: d.call ? d.call.input_tokens : null, output_tokens: d.call ? d.call.output_tokens : null, response_head: d.response_text ? String(d.response_text).slice(0, 200) : null, proposal: d.proposal_change, as_proposed: d.as_proposed ? { legal: d.as_proposed.legal, d_lap_s: d.as_proposed.d_lap_s == null ? null : d.as_proposed.d_lap_s } : null, best_d_s: d.best_d_s, kept: !!d.kept, first_lap: firstLapOf(measured, d.decision) + 1, physics_laps: d.physics_laps })),
  };
}
const firstLapOf = (measured, k) => { const i = measured.findIndex(n => n.decision === k); return i < 0 ? Infinity : i; };
// a measured car's parameters: a result node carries them; any other node is its parent (a head car, which always carries them) + its changes
function paramsOf(tree, n) {
  if (n.params) return n.params;
  const p = tree.get(n.parent);
  return design.applyChanges({ params: p.params, team: p.team || null }, n.changes).design.params;
}

// per entrant: the seeds' results, medians, the median seed (its car goes to the race)
function summarize(runs) {
  const list = entrants(), out = [];
  for (const e of list) {
    const rs = runs.filter(r => r.entrant === e.id).sort((a, b) => a.seed - b.seed);
    if (!rs.length) continue;
    const done = rs.filter(r => r.status === "complete");
    const bests = done.map(r => r.best_s);
    // the median seed: the seed whose best lap is the median (odd count); with an even count the slower of the two middle ones
    const sorted = done.slice().sort((a, b) => a.best_s - b.best_s || a.seed - b.seed), mid = sorted.length ? sorted[sorted.length >> 1] : null;
    out.push({
      entrant: e.id, name: e.name, code: e.code, color: e.color, provider: e.provider, model: e.model || null, control: e.provider === "none",
      mock: rs.some(r => r.mock), seeds: rs.map(r => r.seed), complete: done.length, of: rs.length,
      best_s_median: r3(median(bests)), gap_to_pole_s_median: r3(median(done.map(r => r.gap_to_pole_s))), beat_pole_at_median: medianReach(done.map(r => r.beat_pole_at)),
      beat_pole_n: done.filter(r => r.beat_pole_at != null).length,
      ideas_median: median(done.map(r => r.ideas)), parse_failures: rs.reduce((s, r) => s + r.parse_failures, 0), llm_errors: rs.reduce((s, r) => s + r.llm_errors, 0),
      ideas_total: rs.reduce((s, r) => s + r.ideas, 0), illegal_as_proposed: rs.reduce((s, r) => s + r.illegal_as_proposed, 0), proposals: rs.reduce((s, r) => s + r.proposals, 0),
      latency_ms_median: r3(median(rs.flatMap(r => (r.calls_log || []).filter(c => c.status === "ok").map(c => c.latency_ms)))),
      tokens_in_median: median(done.map(r => r.tokens_in)), tokens_out_median: median(done.map(r => r.tokens_out)),
      calls: rs.reduce((s, r) => s + r.calls, 0), request_ids: rs.reduce((s, r) => s + r.request_ids.length, 0),
      median_seed: mid ? mid.seed : null,
      race_car: mid ? { seed: mid.seed, lap_s: mid.final.lap_s, check_lap_s: mid.final.check_lap_s, design: mid.final.design } : null,
      runs: rs.map(r => ({ seed: r.seed, status: r.status, stop_reason: r.stop_reason, best_s: r.best_s, gap_to_pole_s: r.gap_to_pole_s, beat_pole_at: r.beat_pole_at, ideas: r.ideas, ideas_by: r.ideas_by, parse_failures: r.parse_failures, llm_errors: r.llm_errors, calls: r.calls, latency_ms_median: r.latency_ms_median, tokens_in: r.tokens_in, tokens_out: r.tokens_out, illegal_as_proposed: r.illegal_as_proposed, proposals: r.proposals, laps_used: r.laps_used, curve: r.curve, run_id: r.run_id, models_served: r.models_served, final_lap_s: r.final.lap_s, check_lap_s: r.final.check_lap_s, final_design: r.final.design, request_ids: r.request_ids })),
    });
  }
  const pole = runs.length ? runs[0].pole_s : null, baseline = runs.length ? runs[0].baseline_s : null;
  return {
    v: 1, kind: "purple-model-gp", generated_at: new Date().toISOString(), mock: runs.some(r => r.mock), label: LABEL, pole_label: POLE_LABEL,
    pole_s: pole, baseline_s: baseline, settings: runs.length ? runs[0].settings : null, memory: runs.length ? runs[0].memory : null, seeds: Array.from(new Set(runs.map(r => r.seed))).sort((a, b) => a - b),
    median_note: "per entrant: the median of its complete seeds; the race uses each entrant's median seed (the seed whose best lap is the median; with an even count the slower middle one)",
    entrants: out,
  };
}
// beat-pole lap counts: a seed that never beat the pole counts as "later than every one that did" (median over all; null when the median seed did not)
function medianReach(xs) {
  if (!xs.length) return null;
  const v = xs.map(x => (x == null ? Infinity : x)).sort((a, b) => a - b), m = v[(v.length - 1) >> 1];
  return v.length % 2 ? (isFinite(m) ? m : null) : (isFinite(v[v.length >> 1]) ? (v[(v.length >> 1) - 1] + v[v.length >> 1]) / 2 : null);
}

// every entrant x seed (≤ parallel at once; one call at a time per run, so ≤ parallel calls in flight, and never more than 8)
// o: { entrants [ids], seeds, parallel, workers, out, mock, callFor(e, seed) -> call, settings, quiet }
async function runAll(o) {
  const list = entrants().filter(e => !o.entrants || o.entrants.includes(e.id));
  if (o.entrants) for (const id of o.entrants) if (!list.some(e => e.id === id)) throw new Error("unknown entrant " + id + " (concept/gp/entrants.json: " + entrants().map(e => e.id).join(", ") + ")");
  const parallel = Math.max(1, Math.min(MAX_IN_FLIGHT, o.parallel || 3));
  const gate = limiter(MAX_IN_FLIGHT), slots = limiter(parallel);
  fs.mkdirSync(o.out, { recursive: true });
  const jobs = [];
  for (const e of list) for (const seed of o.seeds) jobs.push({ e, seed });
  const log = o.quiet ? () => {} : s => process.stderr.write(s + "\n");
  const results = await Promise.all(jobs.map(j => slots(async () => {
    log("start " + j.e.id + " seed " + j.seed);
    const call = j.e.provider === "none" ? null : o.callFor(j.e, j.seed);
    const rec = await runOne({ entrant: j.e, seed: j.seed, call, mock: !!o.mock && j.e.provider !== "none", workers: o.workers, gate, settings: o.settings, runId: o.runIdFor ? o.runIdFor(j.e, j.seed) : undefined });
    rec.mock = !!o.mock;   // a mock run's control rides with it: the whole file set is mock
    fs.writeFileSync(path.join(o.out, j.e.id + "-seed" + j.seed + ".json"), JSON.stringify(rec) + "\n");
    log("done  " + j.e.id + " seed " + j.seed + ": best " + rec.best_s + " s after " + rec.laps_used + " physics laps · ideas " + rec.ideas + " (parse failures " + rec.parse_failures + ", api errors " + rec.llm_errors + ") · " + rec.status);
    return rec;
  })));
  return { results, peak_in_flight: gate.peak(), peak_runs: slots.peak() };
}
function readRuns(dir) {
  return fs.readdirSync(dir).filter(f => /-seed\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))).filter(r => r && r.kind === "purple-model-gp-run");
}
function writeSummary(dir) {
  const runs = readRuns(dir);
  if (runs.some(r => r.mock) && runs.some(r => !r.mock)) throw new Error("gp: " + dir + " mixes mock and live runs: refusing to summarise them together");
  // same harness, same data for every entrant: runs with different settings (budget, screen, memory, prompt) are never ranked together
  const odd = runs.find(r => !sameHarness(r.settings, runs[0].settings));
  if (odd) throw new Error("gp: " + dir + " mixes harness settings (" + odd.entrant + " seed " + odd.seed + " differs from " + runs[0].entrant + " seed " + runs[0].seed + "): refusing to summarise them together");
  const s = summarize(runs);
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(s, null, 1) + "\n");
  return s;
}

function parseArgs(argv) {
  const a = { mode: null, entrants: null, seeds: [1, 2, 3], parallel: 3, workers: 1, out: null, summary: false, memory: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--live" || k === "--mock") { if (a.mode && a.mode !== k.slice(2)) throw new Error("choose one of --live, --mock"); a.mode = k.slice(2); }
    else if (k === "--summary") a.summary = true;
    else if (k === "--entrants") { a.entrants = v.split(",").filter(Boolean); i++; }
    else if (k === "--seeds") { a.seeds = v.split(",").map(Number); i++; }
    else if (k === "--parallel") { a.parallel = +v; i++; } else if (k === "--workers") { a.workers = +v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--memory") { if (!["on", "off"].includes(v)) throw new Error("--memory on|off"); a.memory = v === "on"; i++; }
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error("unknown option " + k);
  }
  if (a.help) return a;
  if (!a.mode && !a.summary) throw new Error("say --live, --mock or --summary");
  if (!a.seeds.length || !a.seeds.every(s => Number.isInteger(s) && s >= 0)) throw new Error("--seeds: integers, e.g. 1,2,3");
  if (!(Number.isInteger(a.parallel) && a.parallel >= 1 && a.parallel <= MAX_IN_FLIGHT)) throw new Error("--parallel: 1-" + MAX_IN_FLIGHT + " (≤ 8 calls in flight per process, G-MUBIT-05)");
  if (!(Number.isInteger(a.workers) && a.workers >= 0 && a.workers <= 16)) throw new Error("--workers: 0-16");
  const out = path.resolve(a.out || (a.mode === "mock" ? path.join(os.tmpdir(), "purple-gp-mock") : DATA_DIR));
  const rel = path.relative(ROOT, out);
  if (rel === "data" || rel.startsWith("data" + path.sep)) throw new Error("--out must not be data/");
  if (a.mode === "mock" && out === DATA_DIR) throw new Error("--mock never writes into concept/gp/data (the page shows those files as model results): pick a scratch --out");
  a.out = out;
  return a;
}

async function main(argv) {
  const a = parseArgs(argv);
  if (a.help) { const L = fs.readFileSync(__filename, "utf8").split("\n"); process.stdout.write(L.slice(1, L.indexOf('"use strict";')).map(l => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); return 0; }
  if (a.mode) {
    const settings = Object.freeze(Object.assign({}, SETTINGS, { memory: a.memory }));
    if (settings.memory) { const sup = memorySupport(); if (!sup.available) throw new Error("--memory on, but " + sup.why); }
    const factory = a.mode === "live" ? liveCallerFactory() : mockCallerFactory();
    process.stdout.write("PURPLE Model GP · " + (a.mode === "live" ? "LIVE through Mubit · UNTRAINED (x-middleware-record: metadata)" : "MOCK (scripted mock for every model entrant: NOT models; no network)") + " · seeds " + a.seeds.join(",") + " · budget " + SETTINGS.budget + " physics laps · screen " + JSON.stringify(SETTINGS.screen) + " · memory " + (a.memory ? "on" : "off") + " · out " + a.out + "\n");
    const r = await runAll({ entrants: a.entrants, seeds: a.seeds, parallel: a.parallel, workers: a.workers, out: a.out, mock: a.mode === "mock", callFor: factory, settings });
    process.stdout.write("runs " + r.results.length + " · peak calls in flight " + r.peak_in_flight + "\n");
  }
  const s = writeSummary(a.out);
  for (const e of s.entrants) process.stdout.write(e.name.padEnd(28) + " median best " + e.best_s_median + " s · gap to pole " + e.gap_to_pole_s_median + " · complete " + e.complete + "/" + e.of + " · parse failures " + e.parse_failures + " · api errors " + e.llm_errors + "\n");
  process.stdout.write("wrote " + path.join(a.out, "summary.json") + "\n");
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then(c => { process.exitCode = c; }, e => { console.error("gp: " + (e && e.message || e)); process.exitCode = 1; });
module.exports = { SETTINGS, harness, memorySupport, memoryOpt, engineRun, MAX_IN_FLIGHT, LABEL, POLE_LABEL, entrants, taskFor, limiter, runOne, record, summarize, medianReach, runAll, readRuns, writeSummary, parseArgs, main, paramsOf };
