#!/usr/bin/env node
// PURPLE SHARED MEMORY - the build of concept/engineer/memory/approved.json (deterministic): the index of PHYSICS-APPROVED designer
// decisions that concept/engineer/memory.js retrieves precedents from. The same file for every model (model-agnostic).
//   node concept/engineer/memory/build.js --runs DIR [--out FILE]
// Sources: the harvest logs in docs/concept/loop-runs/{trained-harvest, trained-harvest-2, trained-harvest-3, trained-compact-harvest}/
// good.jsonl (seed, decision, lap delta as proposed, request ids: the decisions whose proposal, EXACTLY AS PROPOSED, was legal and
// faster on the physics lap sim, the record-good "exact" rule) joined with the per-run logs those harvests wrote
// (DIR/{harvest, harvest2, harvest3, harvest-compact}/run-seed<N>/{events,decisions}.jsonl; 2.7 GB, kept outside the repository):
//   head car   = the `request` event's scenario.best.params of that decision (the car the change was applied to),
//   change     = the `proposal` event's changes (part, param, from, to),
//   d_lap_s    = the decision row's as_proposed.d_lap_s (checked against good.jsonl), legal = as_proposed.legal (must be true).
// HELD OUT: nothing from the designer exam enters the index. Rows from the exam's source seeds (concept/exam/questions.js SEEDS,
// 101-110) are dropped, and so is any row whose head car equals an exam question's head car (questions.json; the head cars only, the
// exam's answers and results are never read). test/engineer-memory.test.js checks both on the committed file.
// Dedupe: the same change on the same head car is one entry (n = how many times it was approved). Output: one JSON, cars as arrays
// in concept/parts.js PARAMS order, entries [car, [[param index, from, to], ...], d_lap_ms, n, source index].
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const parts = require("../../parts.js");
const questions = require("../../exam/questions.js");

const ROOT = path.join(__dirname, "..", "..", "..");
const OUT = path.join(__dirname, "approved.json");
const SOURCES = [
  { name: "trained-harvest", runs: "harvest", task: "v1" },
  { name: "trained-harvest-2", runs: "harvest2", task: "v1" },
  { name: "trained-harvest-3", runs: "harvest3", task: "v1" },
  { name: "trained-compact-harvest", runs: "harvest-compact", task: "compact" },
];
const KEYS = parts.PARAMS.map(s => s.part + "." + s.param);
const KIDX = new Map(KEYS.map((k, i) => [k, i]));
const readJsonl = f => fs.readFileSync(f, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
const vecOf = p => KEYS.map(k => { const [a, b] = k.split("."); const v = p && p[a] ? p[a][b] : undefined; if (typeof v !== "number" || !isFinite(v)) throw new Error("memory build: head car has no " + k); return v; });

// the exam's held-out material: its source seeds and its head cars (as vectors)
function heldOut() {
  const seeds = new Set(questions.SEEDS);
  const cars = new Set();
  for (const f of [questions.FILE, questions.FILE_CORRECTIONS, path.join(ROOT, "concept", "exam", "questions-memory.json")]) {
    if (!fs.existsSync(f)) continue;
    for (const q of JSON.parse(fs.readFileSync(f, "utf8")).questions) cars.add(JSON.stringify(vecOf(q.head.params)));
  }
  return { seeds, cars };
}

function build(o) {
  const runsRoot = path.resolve(o.runs), goodDir = o.goodDir || path.join(ROOT, "docs", "concept", "loop-runs");
  const held = o.heldOut || heldOut();
  const cars = [], carIdx = new Map(), byKey = new Map(), stats = [];
  const seedOf = new Map();
  for (const [si, src] of (o.sources || SOURCES).entries()) {
    const good = readJsonl(path.join(goodDir, src.name, "good.jsonl")).filter(g => !g.error)
      .sort((a, b) => a.seed - b.seed || a.decision - b.decision);
    const st = { source: src.name, task: src.task, good_rows: good.length, joined: 0, missing_run: 0, missing_decision: 0, mismatch: 0, held_out_seed: 0, held_out_car: 0 };
    const bySeed = new Map(); for (const g of good) { if (!bySeed.has(g.seed)) bySeed.set(g.seed, []); bySeed.get(g.seed).push(g); }
    for (const [seed, gs] of bySeed) {
      if (held.seeds.has(seed)) { st.held_out_seed += gs.length; continue; }
      const dir = path.join(runsRoot, src.runs, "run-seed" + seed);
      if (!fs.existsSync(path.join(dir, "events.jsonl"))) { st.missing_run += gs.length; continue; }
      const req = new Map(), prop = new Map();
      for (const e of readJsonl(path.join(dir, "events.jsonl"))) {
        if (e.type === "request" && e.scenario && e.scenario.best) req.set(e.decision, e.scenario.best.params);
        else if (e.type === "proposal") prop.set(e.decision, e);
      }
      const rows = new Map(readJsonl(path.join(dir, "decisions.jsonl")).map(r => [r.decision, r]));
      for (const g of gs) {
        const p = prop.get(g.decision), r = rows.get(g.decision), head = req.get(g.decision);
        if (!p || !r || !head) { st.missing_decision++; continue; }
        const a = r.as_proposed;
        if (r.by !== "mubit" || !a || a.legal !== true || typeof a.d_lap_s !== "number" || Math.abs(a.d_lap_s - g.d_lap_s) > 1e-9 || !(a.d_lap_s < 0)) { st.mismatch++; continue; }
        const v = vecOf(head), vk = JSON.stringify(v);
        if (held.cars.has(vk)) { st.held_out_car++; continue; }
        const ch = p.changes.map(c => [KIDX.get(c.part + "." + c.param), c.from, c.to]);
        if (ch.some(c => c[0] == null || c[1] !== v[c[0]])) { st.mismatch++; continue; }
        if (!carIdx.has(vk)) { carIdx.set(vk, cars.length); cars.push(v); }
        const ci = carIdx.get(vk), key = ci + "|" + JSON.stringify(ch);
        const e = byKey.get(key);
        if (e) e[3]++; else { byKey.set(key, [ci, ch, Math.round(a.d_lap_s * 1000), 1, si]); seedOf.set(key, seed); }
        st.joined++;
      }
    }
    stats.push(st);
  }
  const entries = Array.from(byKey.values()), seeds = Array.from(byKey.keys()).map(k => seedOf.get(k));
  const doc = {
    v: 1, kind: "purple-memory-approved",
    what: "physics-approved designer decisions: the change exactly as proposed was legal (FIA 2026 Section C checks + homologated PU + materials) and faster on the physics lap sim (quasi-steady-state point mass · Silverstone · calibrated to 2026 British GP qualifying) from the head car it was applied to",
    built_by: "concept/engineer/memory/build.js",
    held_out: { exam_seeds: Array.from(held.seeds), exam_head_cars: held.cars.size, rule: "rows from the exam's source seeds and rows whose head car equals an exam question's head car are dropped" },
    sources: stats, params: KEYS,
    entry_cols: ["car", "changes [[param, from, to]]", "d_lap_ms (as proposed)", "n (times approved)", "source"],
    counts: { cars: cars.length, entries: entries.length, approved_rows: stats.reduce((s, x) => s + x.joined, 0) },
    seeds_note: "seeds[i] = the run seed of entries[i]'s first approval (the held-out check reads it)",
    cars, entries, seeds,
  };
  doc.sha256 = crypto.createHash("sha256").update(JSON.stringify([cars, entries])).digest("hex");
  return doc;
}
// one entry per line: small diffs, still one JSON document
function serialize(doc) {
  const head = Object.assign({}, doc); delete head.cars; delete head.entries; delete head.seeds;
  const h = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  return h + ',\n "cars": [\n' + doc.cars.map(c => "  " + JSON.stringify(c)).join(",\n") + '\n ],\n "entries": [\n' + doc.entries.map(e => "  " + JSON.stringify(e)).join(",\n") + '\n ],\n "seeds": ' + JSON.stringify(doc.seeds) + "\n}\n";
}

function main(argv) {
  const a = { runs: process.env.PURPLE_HARVEST_RUNS || null, out: OUT };
  for (let i = 0; i < argv.length; i++) { if (argv[i] === "--runs") a.runs = argv[++i]; else if (argv[i] === "--out") a.out = argv[++i]; else throw new Error("unknown option " + argv[i]); }
  if (!a.runs) throw new Error("--runs DIR (the folder holding harvest/, harvest2/, harvest3/, harvest-compact/ run logs) is required");
  const doc = build(a);
  const text = serialize(doc);
  JSON.parse(text);
  fs.writeFileSync(a.out, text);
  process.stdout.write("memory: " + doc.counts.entries + " entries on " + doc.counts.cars + " head cars from " + doc.counts.approved_rows + " approved rows · " + (text.length / 1e6).toFixed(2) + " MB -> " + path.relative(process.cwd(), a.out) + "\n");
  for (const s of doc.sources) process.stdout.write("  " + JSON.stringify(s) + "\n");
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { process.stderr.write("memory build: " + e.message + "\n"); process.exitCode = 1; } }
module.exports = { build, serialize, SOURCES, KEYS, heldOut };
