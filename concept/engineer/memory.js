// PURPLE SHARED MEMORY - precedents from physics-approved decisions, the same for every model (model-agnostic).
// The index (concept/engineer/memory/approved.json, built by concept/engineer/memory/build.js, deterministic) holds the designer
// decisions whose change EXACTLY AS PROPOSED was legal and faster on the physics lap sim, each with the head car it was applied to.
// Nothing from the designer exam is in it (its source seeds 101-110 and its head cars are dropped at build time; tested).
// retrieve({ head (design: { params, team }), decisions (this run's decision rows so far, any order), k (6), chars (1,200) }) ->
//   { lines: ["similar car (distance 0.012, 9 cars): floor.width_mm 1450->1470 legal, -0.021 s", ...], picked: [...], chars }
// How (deterministic; no lap is simulated here, no exam material is read):
//   1. distance of every indexed head car to this head car: mean |Δ| over the 36 parameters, each normalised by its model range
//      (concept/parts.js PARAMS min..max);
//   2. match (default): only precedents whose changed parameters started from THIS car's values (precedent from = this car's
//      value) are used, so the line's change applies to this car exactly as it was approved; (match off: carried over as the same
//      step from this car's value, carry "delta", or to the same target, carry "abs"). A change that would leave the parameter's
//      model range, a no-op, or a change already proposed in this run (same parameter, same from, same to) is skipped;
//   3. precedents with the same change are one candidate; support = Σ n·exp(-distance / scale) over its precedents (nn > 0: only
//      the nn nearest cars); the top candidates by support (ties: the nearest precedent, its lap gain, its text) that are LEGAL on
//      this car (the engine's own FIA 2026 Section C + PU + materials check; no lap is run) are returned, at most per_param per
//      parameter, k in all, within chars;
//   4. each line names the nearest precedent: its distance, how many indexed cars back the same change, the change, and the
//      nearest precedent's lap delta as proposed ("legal, -0.021 s").
// Defaults (match on, scale 0.005, per_param 1) were chosen on DEV states (the exam's own procedure on seeds 9101-9110, never the
// exam's questions or answers): the top precedent carried over was legal and faster on 23/30 dev states (106/179 of all lines).
// The scenario carries the lines as one more block, "precedents" (concept/engineer/scenario.js fit({ memory })), appended last;
// with the option off the scenario is byte for byte what it was.
"use strict";
const fs = require("fs"), path = require("path");
const parts = require("../parts.js");
const design = require("../design.js");

const FILE = path.join(__dirname, "memory", "approved.json");
const DEFAULTS = { match: true, carry: "delta", nn: 0, k: 6, chars: 1200, scale: 0.005, per_param: 1, pool: 400, legal: true };
const SPEC = parts.PARAMS;
const KEYS = SPEC.map(s => s.part + "." + s.param);
const KIDX = new Map(KEYS.map((k, i) => [k, i]));
const fmt = (i, v) => { const s = SPEC[i]; const dp = s.step >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(s.step) - 1e-9)); return Number(v.toFixed(dp)); };
const r3 = v => Math.round(v * 1000) / 1000;

let cached = null;
function load(file) {
  if (cached && (!file || file === cached.file)) return cached;
  const doc = JSON.parse(fs.readFileSync(file || FILE, "utf8"));
  if (doc.kind !== "purple-memory-approved") throw new Error("memory: not an approved-decisions index: " + (file || FILE));
  if (JSON.stringify(doc.params) !== JSON.stringify(KEYS)) throw new Error("memory: the index's parameter list differs from concept/parts.js PARAMS; rebuild it (concept/engineer/memory/build.js)");
  const P = KEYS.length, W = SPEC.map(s => 1 / (s.max - s.min));
  const cars = new Float64Array(doc.cars.length * P);
  doc.cars.forEach((c, i) => { for (let j = 0; j < P; j++) cars[i * P + j] = c[j] * W[j]; });
  cached = { file: file || FILE, doc, cars, W, P };
  return cached;
}
const vecOf = params => KEYS.map(k => { const [a, b] = k.split("."); return params[a][b]; });
const keyOf = (i, from, to) => KEYS[i] + " " + fmt(i, from) + "->" + fmt(i, to);

// the run's tried changes: "part.param from->to" of every proposal so far
function triedSet(decisions) {
  const s = new Set();
  for (const d of decisions || []) for (const c of d.proposal || []) { const i = KIDX.get(c.part + "." + c.param); if (i != null && typeof c.from === "number" && typeof c.to === "number") s.add(keyOf(i, c.from, c.to)); }
  return s;
}

function legalOn(head, changes) {
  const engine = require("./engine.js");   // lazy: engine.js requires scenario.js, which requires this file
  try { const a = design.applyChanges(head, changes); if (!a.changes.length) return false; return engine.violations(a.design).length === 0; } catch (e) { return false; }
}

// candidates for a head car, best first (no legality check, no size bound): [{ key, changes, support, dist, d_ms, cars }]
function candidates(head, decisions, o) {
  o = Object.assign({}, DEFAULTS, o || {});
  const M = load(o.file), { doc, cars, W, P } = M;
  const h = vecOf(head.params), hn = h.map((v, j) => v * W[j]);
  const nc = doc.cars.length, dist = new Float64Array(nc);
  for (let i = 0; i < nc; i++) { let s = 0; const b = i * P; for (let j = 0; j < P; j++) s += Math.abs(cars[b + j] - hn[j]); dist[i] = s / P; }
  const tried = triedSet(decisions), groups = new Map();
  let maxD = Infinity;
  if (o.nn) { const s = Array.from(new Set(doc.entries.map(e => e[0]))).map(i => dist[i]).sort((a, b) => a - b); maxD = s[Math.min(o.nn, s.length) - 1]; }
  for (const e of doc.entries) {
    const [ci, ch, dms, n] = e;
    if (dist[ci] > maxD) continue;
    const changes = [], keys = [];
    let ok = true;
    for (const [pi, from, to] of ch) {
      const s = SPEC[pi], cur = h[pi], nto = fmt(pi, o.carry === "abs" ? to : cur + (to - from));
      if (o.match && cur !== from) { ok = false; break; }
      if (o.carry === "abs" && Math.sign(nto - cur) !== Math.sign(to - from)) { ok = false; break; }
      if (nto < s.min - 1e-9 || nto > s.max + 1e-9 || nto === cur) { ok = false; break; }
      const k = keyOf(pi, cur, nto);
      if (tried.has(k)) { ok = false; break; }
      changes.push({ part: s.part, param: s.param, from: cur, to: nto, i: pi }); keys.push(k);
    }
    if (!ok || !changes.length) continue;
    const key = keys.slice().sort().join("; "), d = dist[ci], w = n * Math.exp(-d / o.scale);
    let g = groups.get(key);
    if (!g) { g = { key, changes, support: 0, cars: 0, dist: Infinity, d_ms: 0, src: null }; groups.set(key, g); }
    g.support += w; g.cars += 1;
    if (d < g.dist || (d === g.dist && dms < g.d_ms)) { g.dist = d; g.d_ms = dms; g.src = { car: ci, changes: ch }; }
  }
  return Array.from(groups.values()).sort((a, b) => b.support - a.support || a.dist - b.dist || a.d_ms - b.d_ms || (a.key < b.key ? -1 : 1));
}

function lineOf(g) {
  const ch = g.changes.map(c => keyOf(c.i, c.from, c.to)).join("; ");
  return "similar car (distance " + g.dist.toFixed(3) + (g.cars > 1 ? ", " + g.cars + " cars" : "") + "): " + ch + " legal, " + (g.d_ms / 1000).toFixed(3) + " s";
}

// retrieve(...) -> { lines, picked, chars }
function retrieve(o) {
  o = Object.assign({}, DEFAULTS, o || {});
  const head = o.head;
  if (!head || !head.params) throw new Error("memory.retrieve: head design required");
  const cand = candidates(head, o.decisions, o).slice(0, o.pool);
  const perParam = new Map(), picked = [], lines = [];
  let chars = 2;
  for (const g of cand) {
    if (picked.length >= o.k) break;
    if (g.changes.some(c => (perParam.get(c.i) || 0) >= o.per_param)) continue;
    if (o.legal && !legalOn(head, g.changes.map(c => ({ part: c.part, param: c.param, to: c.to })))) continue;
    const line = lineOf(g), add = JSON.stringify(line).length + (lines.length ? 1 : 0);
    if (chars + add > o.chars) break;
    chars += add; lines.push(line);
    picked.push({ changes: g.changes.map(c => ({ part: c.part, param: c.param, from: c.from, to: c.to })), support: r3(g.support), cars: g.cars, dist: r3(g.dist), d_lap_s: g.d_ms / 1000 });
    for (const c of g.changes) perParam.set(c.i, (perParam.get(c.i) || 0) + 1);
  }
  return { lines, picked, chars: JSON.stringify(lines).length };
}

// the "memory only, no model" proposer: the top precedent as a designer answer (the frozen task's answer format)
function topAnswer(o) {
  const r = retrieve(Object.assign({}, o, { k: 1 }));
  if (!r.picked.length) return null;
  const p = r.picked[0];
  return JSON.stringify({ changes: p.changes.map(c => ({ part: c.part, param: c.param, to: c.to })), hypothesis: "memory only, no model: the top precedent (" + r.lines[0] + ")", expected: { lap_delta_s: p.d_lap_s, sector: 2 } });
}

function info(file) { const { doc } = load(file); return { entries: doc.entries.length, cars: doc.cars.length, approved_rows: doc.counts.approved_rows, sha256: doc.sha256, held_out: doc.held_out }; }

module.exports = { FILE, DEFAULTS, KEYS, load, retrieve, candidates, topAnswer, triedSet, info, lineOf };
