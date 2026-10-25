#!/usr/bin/env node
// PURPLE DESIGNER EXAM - three columns on the same held-out questions, graded by the physics sim (no human judgement).
//   node concept/exam/run.js --build-questions                  (re)build concept/exam/questions.json (deterministic, ≈ 6 min)
//   node concept/exam/run.js --build-questions --corrections    build concept/exam/questions-corrections.json: the same 30 states
//                                                                  with the physics-corrections block (TESTS_TO_POLE.md §8)
//   add --questions concept/exam/questions-corrections.json to a column: results-<column>-corrections.json (never overwrites the
//   results of questions.json)
//   node concept/exam/run.js --column none    [--n 30]          A. no AI: a seeded random legal proposal per question
//   node concept/exam/run.js --column base    [--n 30]          B. Claude Haiku 4.5 + the frozen designer prompt through server/mubit.js,
//                                                                  UNTRAINED (x-middleware-record: metadata), concurrency ≤ 2;
//                                                                  MUBIT_MOCK=1 -> the scripted mock, no network, results-base-mock.json
//   node concept/exam/run.js --column base --model ID [--n 30] [--concurrency 8]
//                                                               B'. the MODEL COMPARISON: the same untrained call with only the model id
//                                                                  swapped (ids: concept/exam/models.json, the one list); concurrency ≤ 8
//                                                                  (default 8); -> results-base-<slug>[-corrections].json with per-question
//                                                                  latency_ms, input/output tokens, served_by, stop_reason, model as returned.
//                                                                  A model whose API rejects a temperature setting has temperature null
//                                                                  in models.json: the field is left out (recorded in meta, shown in the view)
//   node concept/exam/run.js --column adapter --answers FILE [--n 30] [--label NAME]
//                                                               C. grade the Mubit adapter's answers pasted from the console
//   node concept/exam/run.js --export [--n 30]                  write for-console.txt + answers-template.{txt,json}
// Options: --workers W (default min(4, cpus)) · --questions FILE · --label NAME (results-<label>.json instead of results-<column>.json)
//          · --concurrency C (base column, 1..8; default 2, or 8 with --model)
// Output: concept/exam/results-<column|label>.json and one line "kept n/N (direct), n/N (engine), mean gain …".
// Answers file (adapter): JSON { "q01": "<raw text>", ... } or [{ id, text }], JSONL lines { "id", "text" }, or the plain-text
// block format of answers-template.txt ("=== q01" on its own line, then the reply exactly as the console shows it).
// Rules: no trained call is ever made here (trained: false is hard-coded); the frozen prompt / model / max_tokens / temperature come
// from concept/designer/prompt.js untouched (with --model: only the model id is swapped, see modelTask). Scores are n/N.
"use strict";
const fs = require("fs"), path = require("path");
const questionsMod = require("./questions.js");
const grader = require("./grade.js");
const design = require("../design.js");
const engine = require("../engineer/engine.js");
const prompt = require("../designer/prompt.js");
const loop = require("../designer/loop.js");

const DIR = __dirname;
const NONE_SEED = 7001, MOCK_SEED = 9001, BASE_CONCURRENCY = 2, MODEL_CONCURRENCY = 8, MAX_CONCURRENCY = 8;   // G-MUBIT-05: ≤ 8 per process
const MODELS_FILE = path.join(DIR, "models.json");
// the model comparison's ONE list (concept/exam/models.json; the Exam view reads the same file)
function models() { return JSON.parse(fs.readFileSync(MODELS_FILE, "utf8")).models; }
function modelOf(id) {
  const m = models().find(x => x.id === id);
  if (!m) throw new Error("--model " + JSON.stringify(id) + " is not in concept/exam/models.json (" + models().map(x => x.id).join(", ") + ")");
  return m;
}
// the frozen designer task with ONLY the model id swapped (system prompt, max_tokens, DRAFT exactly prompt.js's; temperature the
// frozen value, or null for a model whose API rejects a temperature setting: models.json temperature null, and server/mubit.js
// buildRequest then leaves the field out; recorded in meta and shown in the Exam view, never silent). A different model is a
// different Mubit task key: fine, these calls are untrained.
function modelTask(id) {
  const m = modelOf(id);
  if (m.temperature !== null && m.temperature !== prompt.TEMPERATURE) throw new Error("models.json: " + id + " temperature must be null or the frozen " + prompt.TEMPERATURE);
  return Object.freeze({ DRAFT: prompt.DRAFT, DESIGNER_PROMPT_VERSION: prompt.DESIGNER_PROMPT_VERSION, SYSTEM_PROMPT: prompt.SYSTEM_PROMPT, MODEL: id, MAX_TOKENS: m.max_tokens || prompt.MAX_TOKENS, TEMPERATURE: m.temperature === null ? null : prompt.TEMPERATURE });
}

function parseArgs(argv) {
  const a = { column: null, answers: null, n: null, export: false, build: false, workers: null, questions: null, label: null, corrections: false, model: null, concurrency: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--column") { a.column = v; i++; } else if (k === "--answers") { a.answers = v; i++; } else if (k === "--n") { a.n = +v; i++; }
    else if (k === "--export") a.export = true; else if (k === "--build-questions") a.build = true; else if (k === "--corrections") a.corrections = true;
    else if (k === "--model") { a.model = v; i++; } else if (k === "--concurrency") { a.concurrency = +v; i++; }
    else if (k === "--workers") { a.workers = +v; i++; } else if (k === "--questions") { a.questions = v; i++; } else if (k === "--label") { a.label = v; i++; }
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error("unknown option " + k);
  }
  if (a.corrections && !a.build) throw new Error("--corrections goes with --build-questions (to grade them: --questions concept/exam/questions-corrections.json)");
  if (a.help || a.build || a.export) return a;
  if (!["none", "base", "adapter"].includes(a.column)) throw new Error("--column none|base|adapter (or --export / --build-questions)");
  if (a.column === "adapter" && !a.answers) throw new Error("--column adapter needs --answers FILE");
  if (a.n != null && !(Number.isInteger(a.n) && a.n >= 1)) throw new Error("--n must be a positive integer");
  if (a.label != null && !/^[A-Za-z0-9_.-]{1,60}$/.test(a.label)) throw new Error("--label: letters, digits, _ . - only");
  if (a.model != null) { if (a.column !== "base") throw new Error("--model goes with --column base"); modelOf(a.model); }
  if (a.concurrency != null) {
    if (a.column !== "base") throw new Error("--concurrency goes with --column base");
    if (!(Number.isInteger(a.concurrency) && a.concurrency >= 1 && a.concurrency <= MAX_CONCURRENCY)) throw new Error("--concurrency must be an integer 1.." + MAX_CONCURRENCY + " (G-MUBIT-05)");
  }
  return a;
}
function mockMode() { const v = process.env.MUBIT_MOCK; if (v == null || v === "" || v === "0") return false; if (v === "1") return true; throw new Error('MUBIT_MOCK must be "1" (mock) or unset/"0", got ' + JSON.stringify(v)); }
const idx = q => parseInt(q.id.slice(1), 10);

// ---- column A: a seeded random LEGAL proposal (the engine's own blind step, design.mutate at the engine's fallback size, redrawn
// until it is legal by the engine's own check). Deterministic per (question id, NONE_SEED).
function randomProposal(q, seed) {
  const rng = design.seededRng(((seed == null ? NONE_SEED : seed) * 1000003 + idx(q) * 7919) >>> 0);
  const head = { params: q.head.params, team: q.team };
  for (let draw = 1; draw <= 500; draw++) {
    const m = design.mutate(head, rng, 0.06);
    if (!m.changes.length || m.changes.length > 3) continue;
    if (engine.violations(m.design).length) continue;
    const text = JSON.stringify({ changes: m.changes.map(c => ({ part: c.part, param: c.param, to: c.to })), hypothesis: "random legal proposal (no AI), draw " + draw, expected: { lap_delta_s: -1, sector: 1 + Math.floor(rng() * 3) } });
    return { text, draw };
  }
  throw new Error("exam: no legal random proposal for " + q.id + " in 500 draws");
}

// ---- column B: the frozen designer task, untrained, through server/mubit.js only (mock under MUBIT_MOCK=1)
async function baseAnswers(qs, o) {
  o = o || {};
  const mock = o.mock != null ? o.mock : mockMode();
  let call;
  if (mock) call = (q, sessionId) => loop.mockCaller(MOCK_SEED + idx(q))(q.text, { sessionId, gen: idx(q), trained: false });
  else {
    const mubit = o.mubit || require("../../server/mubit.js");   // G-MUBIT-06: the one place that calls Mubit
    const task = o.task || prompt;
    call = (q, sessionId) => mubit.callMubit({ userContent: q.text, sessionId, trained: false, kind: "exam", task });
  }
  const sessionId = o.sessionId || "exam-dsg-" + (mock ? "mock" : require("ulid").ulid().toLowerCase());
  const out = new Array(qs.length);
  let next = 0;
  const worker = async () => {
    while (next < qs.length) {
      const i = next++, q = qs[i], t0 = Date.now();
      try {
        const r = await call(q, sessionId);
        out[i] = { id: q.id, text: r.text, mubit_request_id: r.mubit_request_id || null, model: r.model || null, served_by: r.served_by || (mock ? "mock" : null), input_tokens: r.input_tokens == null ? null : r.input_tokens, output_tokens: r.output_tokens == null ? null : r.output_tokens, latency_ms: r.latency_ms == null ? Date.now() - t0 : r.latency_ms, trained: false, mock: !!mock, stop_reason: r.stop_reason || null };
      } catch (e) {
        out[i] = { id: q.id, text: "", error: String(e && (e.code || e.message) || e), error_status: (e && e.status) || null, error_message: String(e && e.message || e).slice(0, 300), mubit_request_id: (e && e.requestId) || null, trained: false, mock: !!mock };
      }
      if (o.log) o.log("  " + q.id + " " + (out[i].error ? "error " + out[i].error : (out[i].mubit_request_id || "") + " " + out[i].latency_ms + " ms"));
    }
  };
  const conc = o.concurrency == null ? BASE_CONCURRENCY : o.concurrency;
  if (!(Number.isInteger(conc) && conc >= 1 && conc <= MAX_CONCURRENCY)) throw new Error("exam: concurrency must be 1.." + MAX_CONCURRENCY);
  await Promise.all(Array.from({ length: Math.min(conc, qs.length) }, worker));
  return { sessionId, mock: !!mock, answers: out };
}

// ---- column C: the console answers file
function parseAnswers(raw) {
  const s = String(raw).replace(/^﻿/, "");
  const t = s.trim(), map = {};
  const put = (id, text) => { const k = normId(id); if (k) map[k] = text == null ? "" : String(text); };
  if (/^===\s*q?\d+/m.test(s) && !t.startsWith("{") && !t.startsWith("[")) {
    // block format: "=== q01" lines, the text until the next "===" line (lines starting with "#" before the first block are comments)
    let cur = null, buf = [];
    const flush = () => { if (cur) put(cur, buf.join("\n").trim()); };
    for (const line of s.split(/\r?\n/)) {
      const m = /^===\s*(q?\d+)\b/.exec(line);
      if (m) { flush(); cur = m[1]; buf = []; } else if (cur) buf.push(line);
    }
    flush();
    return map;
  }
  if (t.startsWith("[")) { for (const r of JSON.parse(t)) put(r.id, r.text); return map; }
  if (t.startsWith("{")) {
    try { const o = JSON.parse(t); if (o && typeof o.id === "string" && "text" in o) { put(o.id, o.text); return map; } for (const k of Object.keys(o)) put(k, typeof o[k] === "string" ? o[k] : o[k] && o[k].text); return map; }
    catch (e) { /* JSONL */ }
  }
  for (const line of t.split(/\r?\n/)) { if (!line.trim()) continue; const r = JSON.parse(line); put(r.id, r.text); }
  return map;
}
function normId(id) { const m = /^q?(\d+)$/.exec(String(id == null ? "" : id).trim()); return m ? "q" + String(+m[1]).padStart(2, "0") : null; }

// ---- grading of a column
async function gradeAll(qs, texts, o) {
  o = o || {};
  const P = grader.pools(o.workers);
  const rows = [];
  try {
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i], a = texts[i] || {};
      const g = await grader.grade(q, a.text, { pool: P.pool, screenPool: P.screenPool });
      const row = Object.assign({ phase: q.phase }, g, { answer: a.text == null ? null : String(a.text).slice(0, 2000) });
      if (a.missing) row.missing = true;
      for (const k of ["mubit_request_id", "model", "served_by", "input_tokens", "output_tokens", "latency_ms", "stop_reason", "error", "error_status", "error_message", "draw"]) if (a[k] != null) row[k] = a[k];
      rows.push(row);
      if (o.log) o.log("  " + q.id + " " + q.phase.padEnd(5) + " parsed " + (g.parsed ? "y" : "n") + " legal " + (g.legal ? "y" : "n") + " direct " + (g.direct.kept ? "KEPT " + g.direct.gain_s.toFixed(3) : "-") + " engine " + (g.engine.kept ? "KEPT " + g.engine.gain_s.toFixed(3) : "-") + " (" + g.ms + " ms)");
    }
  } finally { await P.close(); }
  return rows;
}

// speed and size of a model column's calls (over the calls that answered; failed calls are counted, never averaged in)
function callStats(rows) {
  const ok = rows.filter(r => !r.error && typeof r.latency_ms === "number");
  const nums = k => ok.map(r => r[k]).filter(v => typeof v === "number" && isFinite(v));
  const mean = a => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 10) / 10 : null);
  const median = a => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const count = f => { const o = {}; for (const r of rows) { const k = f(r); if (k != null) o[k] = (o[k] || 0) + 1; } return o; };
  const lat = nums("latency_ms");
  return {
    n: rows.length, answered: ok.length, errors: rows.length - ok.length, error_codes: count(r => (r.error ? r.error : null)),
    latency_ms_median: median(lat), latency_ms_mean: mean(lat), latency_ms_max: lat.length ? Math.max(...lat) : null,
    input_tokens_mean: mean(nums("input_tokens")), output_tokens_mean: mean(nums("output_tokens")),
    stop_reasons: count(r => r.stop_reason || null), served_by: count(r => r.served_by || null), models_returned: count(r => r.model || null),
  };
}

function exportConsole(doc, qs) {
  const L = [];
  L.push("PURPLE designer exam: questions for the Mubit console (Try models)", "",
    "Task: the concept designer task (concept/designer/prompt.js, version " + prompt.DESIGNER_PROMPT_VERSION + ", task key sha256 " + prompt.taskKeySha256().slice(0, 12) + "…, " + prompt.MODEL + ").",
    "Questions: " + qs.length + " held-out car states. Source: " + doc.how + ".",
    "",
    "How to use:",
    " 0. cp concept/exam/answers-template.txt concept/exam/answers-adapter.txt   (fill the copy, keep the template empty)",
    " 1. Console -> Tasks -> the designer task (system prompt starts \"" + prompt.TASK_NAME_HINT + "\"). Open the adapter version that shows Passed, then Try models.",
    " 2. For each question below, copy the ONE line under \"USER MESSAGE\" (it starts with {\"best\": and ends with }) and paste it as the message.",
    "    Paste nothing else: Try models adds the task's own instructions (the frozen system prompt). Do not edit or re-wrap the line.",
    " 3. Copy the adapter's reply exactly as shown (a ```json fence is fine) into answers-adapter.txt under its \"=== qNN\" line.",
    "    Side by side also shows the provider's reply: put those in a second copy (answers-provider.txt) if you want that column too.",
    " 4. Grade: node concept/exam/run.js --column adapter --answers concept/exam/answers-adapter.txt --n " + qs.length,
    "    (provider replies from the console: --column adapter --answers concept/exam/answers-provider.txt --label console-provider)",
    "",
    "Budget: Try models has a small daily call limit per organisation (EVAL_GUARDRAILS §4: 20 for the exam and rehearsal, 4 kept for the demo).",
    "The ids interleave early / mid / late, so the first n questions are balanced. For a subset, paste q01..qNN only and grade with --n NN",
    "(e.g. --n 9 = 3 early, 3 mid, 3 late); compare columns on the same --n.",
    "Nothing here trains the task: Try models calls are not stored as examples.",
    "");
  for (const [i, q] of qs.entries()) {
    L.push("=".repeat(100), "QUESTION " + (i + 1) + " / " + qs.length + " · " + q.id + " · " + q.phase + " · head car " + q.head.lap_s.toFixed(3) + " s (" + (q.context.d_baseline_s >= 0 ? "+" : "") + q.context.d_baseline_s.toFixed(3) + " s vs the RB22 baseline) · source seed " + q.source.seed + " decision " + q.source.decision + " · " + q.chars + " chars", "", "USER MESSAGE (paste this one line):", q.text, "");
  }
  const txt = ["# PURPLE designer exam: paste each reply under its === line, exactly as the console shows it. Leave a block empty if you skip it.", "# Grade: node concept/exam/run.js --column adapter --answers <this file> --n " + qs.length, ""];
  for (const q of qs) txt.push("=== " + q.id, "", "");
  const json = {}; for (const q of qs) json[q.id] = "";
  return { console: L.join("\n") + "\n", template_txt: txt.join("\n"), template_json: JSON.stringify(json, null, 1) + "\n" };
}

async function main(argv, io) {
  io = io || { out: s => process.stdout.write(s), err: s => process.stderr.write(s) };
  const a = parseArgs(argv);
  const log = s => io.err(s + "\n");
  if (a.help) { const src = fs.readFileSync(__filename, "utf8").split("\n"); io.out(src.slice(1, src.findIndex(l => l.startsWith("\"use strict\""))).map(l => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); return 0; }
  if (a.build && a.corrections) {
    const doc = await questionsMod.buildCorrections({ workers: a.workers, log });
    const file = questionsMod.FILE_CORRECTIONS;
    fs.writeFileSync(file, questionsMod.serialize(doc));
    const add = doc.questions.map(q => q.corrections_chars);
    io.out("exam questions with corrections: " + doc.questions.length + " -> " + path.relative(process.cwd(), file) + " (block +" + Math.min(...add) + "..+" + Math.max(...add) + " chars)\n");
    return 0;
  }
  if (a.build) {
    const doc = await questionsMod.build({ workers: a.workers, log });
    fs.writeFileSync(a.questions || questionsMod.FILE, questionsMod.serialize(doc));
    io.out("exam questions: " + doc.questions.length + " -> " + path.relative(process.cwd(), a.questions || questionsMod.FILE) + "\n");
    return 0;
  }
  const doc = questionsMod.load(a.questions);
  const qs = doc.questions.slice(0, a.n == null ? doc.questions.length : a.n);
  if (a.export) {
    const e = exportConsole(doc, qs), sfx = doc.variant === "corrections" ? "-corrections" : "";
    fs.writeFileSync(path.join(DIR, "for-console" + sfx + ".txt"), e.console);
    fs.writeFileSync(path.join(DIR, "answers-template" + sfx + ".txt"), e.template_txt);
    fs.writeFileSync(path.join(DIR, "answers-template" + sfx + ".json"), e.template_json);
    io.out("exam export: " + qs.length + " questions -> concept/exam/for-console" + sfx + ".txt, concept/exam/answers-template" + sfx + ".txt, concept/exam/answers-template" + sfx + ".json\n");
    return 0;
  }
  const t0 = Date.now();
  let texts, meta = {};
  if (a.column === "none") texts = qs.map(q => Object.assign({ id: q.id }, randomProposal(q)));
  else if (a.column === "base") {
    if (!mockMode()) require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(DIR, "..", "..", "server", ".env") });
    const task = a.model ? modelTask(a.model) : prompt;
    const concurrency = a.concurrency != null ? a.concurrency : a.model ? MODEL_CONCURRENCY : BASE_CONCURRENCY;
    log("exam base: " + (mockMode() ? "MUBIT_MOCK=1, scripted mock, no network" : "live UNTRAINED calls through server/mubit.js (x-middleware-record: metadata)") + ", model " + task.MODEL + (task.TEMPERATURE === null ? " (temperature not sent: the model does not accept one)" : "") + ", " + qs.length + " questions, " + concurrency + " in flight");
    const b = await baseAnswers(qs, { log, task, concurrency });
    texts = b.answers;
    meta = { session_id: b.sessionId, mock: b.mock, trained: false, model: task.MODEL, max_tokens: task.MAX_TOKENS, temperature: task.TEMPERATURE, prompt_version: task.DESIGNER_PROMPT_VERSION, concurrency };
    if (a.model) Object.assign(meta, { comparison: true, model_name: modelOf(a.model).name, temperature_sent: task.TEMPERATURE !== null, swapped: task.TEMPERATURE === null ? ["model", "temperature not sent (the model does not accept a temperature setting)"] : ["model"], system_prompt_sha256: questionsMod.sha(task.SYSTEM_PROMPT) });
    const errs = texts.filter(t => t.error).length; if (errs) log("exam base: " + errs + "/" + texts.length + " call(s) failed (" + Array.from(new Set(texts.filter(t => t.error).map(t => t.error))).join(", ") + "); graded as unparseable and shown as call errors");
  } else {
    const map = parseAnswers(fs.readFileSync(a.answers, "utf8"));
    texts = qs.map(q => (q.id in map && map[q.id].trim() ? { id: q.id, text: map[q.id] } : { id: q.id, text: "", missing: true }));
    const miss = texts.filter(t => t.missing).map(t => t.id);
    if (miss.length) log("exam adapter: no answer for " + miss.join(", ") + " (graded as not kept; use --n to grade a subset)");
    meta = { answers_file: path.relative(process.cwd(), a.answers), missing: miss };
  }
  log("exam " + a.column + ": grading " + qs.length + " questions (engine one-decision treatment, seed " + grader.EXAM_SEED + ")");
  const tg = Date.now();
  const rows = await gradeAll(qs, texts, { workers: a.workers, log });
  const gradeMs = Date.now() - tg;
  const summary = grader.summarize(rows);
  const sfx = doc.variant === "corrections" ? "-corrections" : "";
  const name = a.label || (a.column === "base" && a.model ? "base-" + modelOf(a.model).slug + (meta.mock ? "-mock" : "") : a.column === "base" && meta.mock ? "base-mock" : a.column) + sfx;
  const calls = a.column === "base" ? callStats(rows) : null;
  const res = {
    v: 1, kind: "purple-designer-exam-results", column: a.column, label: name,
    what: { none: "A. no AI: seeded random legal proposal (design.mutate at the engine's fallback step size, redrawn until legal)", base: (a.model ? "B. " + modelOf(a.model).name + " (" + a.model + ") + frozen designer prompt via server/mubit.js, untrained (x-middleware-record: metadata); only the model id swapped" + (modelTask(a.model).TEMPERATURE === null ? "; temperature not sent (the model does not accept one: default sampling)" : "") : "B. Claude Haiku 4.5 + frozen designer prompt via server/mubit.js, untrained (x-middleware-record: metadata)") + (meta.mock ? " · MOCK RUN: the scripted mock, not a model" : ""), adapter: "C. answers pasted from the Mubit console (Try models)" }[a.column],
    questions_sha256: questionsMod.sha(JSON.stringify(qs.map(q => q.text_sha256))), questions_variant: doc.variant || "plain", n: qs.length, exam_seed: grader.EXAM_SEED,
    graded_by: "concept/engineer/engine.js one decision from the question's head car (physics lap sim · quasi-steady-state point mass · Silverstone · calibrated to 2026 British GP qualifying); kept = legal && lap < head − 0.1 ms",
    meta, summary, calls, grade_ms: gradeMs, grade_ms_per_question: Math.round(gradeMs / qs.length), total_ms: Date.now() - t0, rows,
  };
  const file = path.join(io.outDir || DIR, "results-" + name + ".json");   // io.outDir: tests only
  fs.writeFileSync(file, JSON.stringify(res, null, 1) + "\n");
  const speed = calls ? " · calls answered " + calls.answered + "/" + calls.n + ", median latency " + (calls.latency_ms_median == null ? "—" : (calls.latency_ms_median / 1000).toFixed(2) + " s") + ", mean output tokens " + (calls.output_tokens_mean == null ? "—" : calls.output_tokens_mean) : "";
  io.out("exam " + name + ": " + summary.line + speed + " · grading " + (gradeMs / 1000 / qs.length).toFixed(2) + " s/question -> " + path.relative(process.cwd(), file) + "\n");
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c || 0), e => { process.stderr.write("exam: " + (e && e.message || e) + "\n"); process.exit(2); });

module.exports = { parseArgs, randomProposal, baseAnswers, parseAnswers, gradeAll, exportConsole, main, models, modelOf, modelTask, callStats, NONE_SEED, MOCK_SEED, MAX_CONCURRENCY };
