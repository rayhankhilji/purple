#!/usr/bin/env node
// PURPLE designer exam, Mubit's trained model on the same 30 held-out questions: ONE command for the moment Mubit's designer adapter
// is live. It only chains the two existing steps, per question set:
//   1. concept/exam/rollout.js: each question sent through server/mubit.js, UNTRAINED (x-middleware-record: metadata), repeated until
//      the reply is served by the adapter (served_by "adapter"), never the provider; answers -> concept/exam/answers-adapter-<set>.json
//   2. concept/exam/run.js --column adapter: graded on the physics lap sim exactly like every other column
//      -> concept/exam/results-adapter[-corrections|-memory].json, one line "kept n/N ..."
// A set is graded only when the adapter answered EVERY question (a partial set is reported, not graded: a missing answer would count
// as "not kept" and mix provider-less gaps into the score).
//   node concept/exam/adapter-exam.js                       all three sets: plain, corrections, memory (the README's exam tables)
//   node concept/exam/adapter-exam.js --set memory          one set (plain | corrections | memory)
//   node concept/exam/adapter-exam.js --dry                 print the commands, run nothing (no network)
// Options: --n N (30) · --tries T (12, passed to rollout.js). Needs MUBIT_API_KEY in server/.env and MUBIT_MOCK unset (rollout.js checks).
// This file never calls Mubit itself and never makes a trained call.
"use strict";
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const DIR = __dirname, ROOT = path.join(DIR, "..", "..");
const SETS = {
  plain: { questions: "concept/exam/questions.json", answers: "concept/exam/answers-adapter-plain.json", results: "concept/exam/results-adapter.json" },
  corrections: { questions: "concept/exam/questions-corrections.json", answers: "concept/exam/answers-adapter-corrections.json", results: "concept/exam/results-adapter-corrections.json" },
  memory: { questions: "concept/exam/questions-memory.json", answers: "concept/exam/answers-adapter-memory.json", results: "concept/exam/results-adapter-memory.json" },
};

function args(argv) {
  const a = { set: "all", n: 30, tries: 12, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--set") a.set = argv[++i]; else if (k === "--n") a.n = +argv[++i]; else if (k === "--tries") a.tries = +argv[++i];
    else if (k === "--dry") a.dry = true; else throw new Error("unknown option " + k);
  }
  if (a.set !== "all" && !SETS[a.set]) throw new Error("--set plain|corrections|memory (or leave it out for all three)");
  if (!(a.n >= 1 && a.n <= 30) || !(a.tries >= 1)) throw new Error("--n 1..30, --tries ≥ 1");
  return a;
}

function plan(a) {
  return (a.set === "all" ? Object.keys(SETS) : [a.set]).map(name => {
    const s = SETS[name];
    return { name, s,
      rollout: ["concept/exam/rollout.js", "--n", String(a.n), "--tries", String(a.tries), "--questions", s.questions, "--out", s.answers],
      grade: ["concept/exam/run.js", "--column", "adapter", "--answers", s.answers, "--questions", s.questions, "--n", String(a.n)] };
  });
}

function main() {
  const a = args(process.argv.slice(2));
  const steps = plan(a);
  if (a.dry) { for (const p of steps) { console.log("# " + p.name); console.log("node " + p.rollout.join(" ")); console.log("node " + p.grade.join(" ")); } return 0; }
  if (process.env.MUBIT_MOCK === "1") throw new Error("the adapter exam needs the live gateway (unset MUBIT_MOCK); use --dry to see the commands");
  for (const p of steps) {
    const r = spawnSync(process.execPath, p.rollout, { cwd: ROOT, stdio: "inherit", env: process.env });
    if (r.status !== 0) { console.error("adapter exam (" + p.name + "): rollout.js failed (exit " + r.status + ")"); return 2; }
    const got = fs.existsSync(path.join(ROOT, p.s.answers)) ? JSON.parse(fs.readFileSync(path.join(ROOT, p.s.answers), "utf8")) : {};
    const ids = Object.keys(got).filter(k => got[k] && got[k].served_by === "adapter" && got[k].text);
    if (ids.length < a.n) { console.log("adapter exam (" + p.name + "): the adapter answered " + ids.length + "/" + a.n + " questions; not graded (run again later, or raise --tries)"); continue; }
    const g = spawnSync(process.execPath, p.grade, { cwd: ROOT, stdio: "inherit", env: process.env });
    if (g.status !== 0) { console.error("adapter exam (" + p.name + "): run.js failed (exit " + g.status + ")"); return 2; }
  }
  return 0;
}

if (require.main === module) { try { process.exit(main()); } catch (e) { console.error("adapter exam: " + (e && e.message || e)); process.exit(2); } }
module.exports = { SETS, plan, args };
