// PURPLE DESIGNER EXAM - the grader. grade(question, proposalText) -> {
//   parsed:  the text passes the designer's strict schema (concept/designer/schema.js, the engine's own validate),
//   legal:   the proposal exactly as proposed is legal (FIA 2026 Section C checks + homologated PU + materials, physics-sim bench),
//   direct:  { kept, gain_s, ... }  the proposal as proposed (variant 0) on the physics sim; if it is illegal, the engine's normal
//            projection onto the legal space (or, when its line has no legal point, its repair: the fastest legal subspace variant
//            that still moves every proposed parameter the proposal's way). kept = legal && lap < head lap - 0.1 ms (the tree's rule),
//   engine:  { kept, gain_s, ... }  the engine's normal ONE-decision treatment of the proposal from the question's head car:
//            subspace screen (3,000 variants, surrogate ranking) + physics confirm of the top 24 + 4 explore + proposal / projection,
//            fixed seed EXAM_SEED, kept by the same rule.
// }
// gain_s = head lap - car lap (s, positive = faster) when kept, else 0 (a car that is not kept never moves the head). The raw
// signed delta is in d_lap_s. An unparseable answer is not kept in either column and the engine is NOT run for it (in a live run the
// engine would take its own seeded direction, labelled "engine" and never credited to the model).
// It IS the engine: concept/engineer/engine.js runEngineer, started from the question's head car, one decision, the proposal text
// as the llm's answer. Deterministic for (question, text, seed), any worker count.
"use strict";
const os = require("os");
const engine = require("../engineer/engine.js");
const schema = require("../designer/schema.js");
const { Tree, EPS } = require("../engineer/tree.js");
const { Pool } = require("../campaign/pool.js");
const { ScreenPool } = require("../engineer/screen.js");

const EXAM_SEED = 2026;
const r6 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);
const keptRule = (lap, head) => typeof lap === "number" && lap < head - EPS;

// pools shared across questions (call close() when done); workers default min(4, cpus)
function pools(workers) {
  const n = workers == null ? Math.min(4, os.cpus().length) : workers;
  const pool = new Pool(n), screenPool = new ScreenPool(n);
  return { pool, screenPool, workers: n, close: async () => { await pool.close(); await screenPool.close(); } };
}

async function grade(q, text, o) {
  o = o || {};
  const t0 = Date.now();
  const raw = typeof text === "string" ? text : text == null ? "" : String(text);
  const v = schema.validate(raw);
  const out = { id: q.id, parsed: v.ok, legal: false, direct: { kept: false, gain_s: 0, d_lap_s: null, from: null }, engine: { kept: false, gain_s: 0, d_lap_s: null, from: null } };
  if (!v.ok) { out.parse_error = v.error; out.ms = Date.now() - t0; return out; }
  out.proposal = v.value.changes.map(c => ({ part: c.part, param: c.param, from: q.head.params[c.part][c.param], to: c.to }));
  if (v.clamped) out.clamped = v.clamped;
  const own = !o.pool || !o.screenPool, P = own ? pools(o.workers) : { pool: o.pool, screenPool: o.screenPool };
  let res;
  try {
    res = await engine.runEngineer({
      llm: async () => raw, mock: !!o.mock, seed: o.seed == null ? EXAM_SEED : o.seed, team: q.team, start: { params: q.head.params, team: q.team },
      runId: "exam-" + q.id, maxDecisions: 1, maxCalls: 1, segments: false, pool: P.pool, screenPool: P.screenPool,
    });
  } finally { if (own) await P.close(); }
  const dec = res.decisions[0], tree = res.tree instanceof Tree ? res.tree : Tree.fromJSON(res.tree);
  const head = tree.nodes[0];
  out.head_lap_s = head.lap_s;
  if (typeof q.head.lap_s === "number" && Math.abs(head.lap_s - q.head.lap_s) > 5e-4) throw new Error("exam: question " + q.id + " head re-measured " + head.lap_s + " s, recorded " + q.head.lap_s + " s");
  const nodes = tree.nodes.filter(n => n.decision === 1);
  const kindOf = n => (n.kind === "result" ? n.from_kind : n.kind);
  const asP = nodes.find(n => kindOf(n) === "proposal");
  out.legal = !!(dec.as_proposed && dec.as_proposed.legal);   // a no-op proposal is the head car itself: legal, never kept
  if (dec.as_proposed && !dec.as_proposed.legal) out.articles = dec.as_proposed.articles || [];
  if (!asP && dec.as_proposed && dec.as_proposed.note === "no change") out.no_change = true;
  // direct: as proposed if legal, else the projection, else the fastest legal repair (the engine's own pick, dec.projection)
  let dCar = null, from = null;
  if (out.no_change) from = "no change";
  else if (out.legal) { dCar = asP; from = "as_proposed"; }
  else {
    const pj = nodes.find(n => kindOf(n) === "projected" && n.legal);
    if (pj) { dCar = pj; from = "projected"; }
    else { const rep = nodes.filter(n => kindOf(n) === "repaired" && n.legal).sort((a, b) => a.lap_s - b.lap_s)[0]; if (rep) { dCar = rep; from = "repaired"; } }
  }
  if (dCar) {
    const k = keptRule(dCar.lap_s, head.lap_s);
    out.direct = { kept: k, gain_s: k ? r6(head.lap_s - dCar.lap_s) : 0, d_lap_s: r6(dCar.lap_s - head.lap_s), lap_s: dCar.lap_s, from };
  } else if (out.no_change) out.direct = { kept: false, gain_s: 0, d_lap_s: 0, lap_s: head.lap_s, from };
  else out.direct.from = "none legal";
  out.engine = { kept: !!dec.kept, gain_s: dec.kept ? r6(head.lap_s - dec.result.lap_s) : 0, d_lap_s: dec.result ? r6(dec.result.lap_s - head.lap_s) : null, lap_s: dec.result ? dec.result.lap_s : null, from: dec.result ? dec.result.from_kind : "none legal", best_change: dec.best_change || null, screened: dec.screen ? dec.screen.distinct : null, physics_laps: dec.physics_laps };
  out.ms = Date.now() - t0;
  return out;
}

// summary over graded rows (scores as n/N, never %)
function summarize(rows, N) {
  N = N == null ? rows.length : N;
  const n = f => rows.filter(f).length, sum = f => rows.reduce((s, r) => s + f(r), 0);
  const s = {
    N, parsed: n(r => r.parsed), legal: n(r => r.legal),
    direct_kept: n(r => r.direct.kept), engine_kept: n(r => r.engine.kept),
    direct_mean_gain_s: N ? r6(sum(r => r.direct.gain_s) / N) : null, engine_mean_gain_s: N ? r6(sum(r => r.engine.gain_s) / N) : null,
    direct_total_gain_s: r6(sum(r => r.direct.gain_s)), engine_total_gain_s: r6(sum(r => r.engine.gain_s)),
  };
  s.line = "kept " + s.direct_kept + "/" + N + " (direct), " + s.engine_kept + "/" + N + " (engine), mean gain " + s.direct_mean_gain_s.toFixed(4) + " s (direct), " + s.engine_mean_gain_s.toFixed(4) + " s (engine); parsed " + s.parsed + "/" + N + ", legal as proposed " + s.legal + "/" + N;
  return s;
}

module.exports = { EXAM_SEED, grade, pools, summarize };
