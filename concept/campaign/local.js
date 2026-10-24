// PURPLE CONCEPT ENGINE - the short local search of the hybrid (autonomous) Mubit mode (docs/concept/DASHBOARD.md §3).
// Mubit sets the direction, this exploits it: given the parent car and the designer's proposed change (1-3 parameters), it runs a
// few dozen to a few hundred PHYSICS laps (concept/bench.js through the campaign pool: FIA legality, PU and material guards, energy
// re-check on every car) around the proposal and returns the fastest LEGAL car it found. Deterministic for (parent, proposal, seed):
// every lap is a pure function of the design, the pool returns results in input order, the rng is design.seededRng(seed).
//   stage "line":   the proposal's own direction, t × (to − from) for t in LINE_T (t = 1 is the proposal itself);
//   stage "coord":  coordinate moves on the proposed parameters, ± 1, 2, 4, 8, 16 steps, single moves then improving ones combined;
//   stage "wide" (scope "wide" only): a small CMA-ES (σ 0.04, λ 10) on all 23 shape parameters around the best so far.
// The verdict is not made here: the loop still benches the returned car against its parent and keeps it only if it is legal and
// faster (concept/optimize.js). The surrogate is not used: every number is a physics lap.
// localSearch({ parent, changes, pool, benchOpts, budget = 200, scope = "proposal" | "wide", seed, stop(), onBatch(ev) })
//   -> { changes: [{ part, param, to }] (parent -> best, every changed parameter), lap_s, proposal_lap_s, parent_lap_s, laps,
//        batches, stages: [{ stage, laps, best_s }], improved_on_proposal, stopped }
"use strict";
const design = require("../design.js"), parts = require("../parts.js");
const space = require("./space.js"), { CMA } = require("./cmaes.js");
const { performance } = require("perf_hooks");

const LINE_T = [1, 0.25, 0.5, 0.75, 1.25, 1.5, 2, 3];
const COORD_MULT = [1, 2, 4, 8, 16];
const canon = d => parts.PARAMS.map(s => +(+d.params[s.part][s.param]).toFixed(6)).join(",");
const lapOf = q => (q && q.legal && typeof q.lap_s === "number" ? q.lap_s : Infinity);

async function localSearch(o) {
  const budget = Math.max(1, o.budget == null ? 200 : o.budget | 0), scope = o.scope || "proposal";
  const parent = o.parent, stop = o.stop || (() => false), rng = design.seededRng(o.seed == null ? 1 : o.seed);
  const keys = [];
  for (const c of o.changes || []) { const k = c.part + "." + c.param; if (space.VARS.some(v => v.key === k) && !keys.includes(k)) keys.push(k); }
  const seen = new Map(); let laps = 0, batches = 0, stopped = false;
  const stages = [];
  let best = null, proposal = null, parentLap = null;
  async function evalDesigns(ds, stage) {
    const fresh = [];
    for (const d of ds) { const k = canon(d); if (!seen.has(k) && fresh.length + laps < budget) { seen.set(k, null); fresh.push({ k, d }); } }
    if (!fresh.length) return [];
    const t0 = performance.now();
    const res = await o.pool.evaluate(fresh.map(f => f.d), o.benchOpts);
    laps += res.length; batches++;
    const out = fresh.map((f, i) => { seen.set(f.k, res[i]); return { d: f.d, q: res[i] }; });
    for (const x of out) if (lapOf(x.q) < (best ? best.lap : Infinity) - 1e-9) best = { d: x.d, q: x.q, lap: lapOf(x.q), stage };
    if (o.onBatch) o.onBatch({ stage, n: res.length, ms: performance.now() - t0, laps, budget, best_s: best ? best.lap : null });
    return out;
  }
  const apply = ch => { try { return design.applyChanges(parent, ch).design; } catch (e) { return null; } };
  const valOf = (d, k) => { const [p, q] = k.split("."); return d.params[p][q]; };

  // the parent's own lap (cached by the bench; not counted against the budget unless it is new to this search)
  { const [r] = await o.pool.evaluate([parent], o.benchOpts); parentLap = lapOf(r); seen.set(canon(parent), r); }
  // 1. the proposal's direction
  if (keys.length) {
    const from = keys.map(k => valOf(parent, k)), to = keys.map(k => { const c = o.changes.find(x => x.part + "." + x.param === k); return c.to; });
    const ds = LINE_T.map(t => apply(keys.map((k, i) => { const [p, q] = k.split("."); return { part: p, param: q, to: from[i] + t * (to[i] - from[i]) }; }))).filter(Boolean);
    const out = await evalDesigns(ds, "line");
    if (out.length) proposal = out[0];
    stages.push({ stage: "line", laps, best_s: best ? best.lap : null });
  }
  // 2. coordinate moves on the proposed parameters around the best (single moves, then improving ones combined)
  for (let sweep = 0; sweep < 12 && best && laps < budget && keys.length; sweep++) {
    if (stop()) { stopped = true; break; }
    const cur = best, moves = [];
    for (const k of keys) {
      const v = space.VARS.find(x => x.key === k), c = valOf(cur.d, k), mult = v.int ? [1] : COORD_MULT;
      for (const m of mult) for (const s of [-1, 1]) { const t = c + s * m * v.step; if (t >= v.domain[0] - 1e-9 && t <= v.domain[1] + 1e-9) moves.push({ part: v.part, param: v.param, to: t }); }
    }
    const out = await evalDesigns(moves.map(m => { try { return design.applyChanges(cur.d, [m]).design; } catch (e) { return null; } }).filter(Boolean), "coord");
    const good = out.filter(x => lapOf(x.q) < cur.lap - 1e-9).sort((a, b) => lapOf(a.q) - lapOf(b.q));
    if (good.length > 1 && laps < budget) {
      // combine the best improving move per parameter, best first
      let acc = cur.d; const used = new Set(), combos = [];
      for (const g of good) {
        const ch = design.diff(cur.d, g.d)[0]; if (!ch) continue; const k = ch.part + "." + ch.param; if (used.has(k)) continue; used.add(k);
        acc = design.applyChanges(acc, [{ part: ch.part, param: ch.param, to: ch.to }]).design; if (used.size >= 2) combos.push(acc);
      }
      await evalDesigns(combos, "coord");
    }
    stages.push({ stage: "coord", laps, best_s: best ? best.lap : null });
    if (best === cur) break;
  }
  // 3. scope "wide": a small CMA-ES on every shape parameter around the best
  if (scope === "wide" && best && laps < budget) {
    const base = best.d, x0 = space.encode(base), cma = CMA({ x0, sigma0: 0.04, lambda: 10, rng });
    while (laps < budget) {
      if (stop()) { stopped = true; break; }
      const xs = cma.ask(), ds = xs.map(x => space.decode(x, base));
      const before = laps, out = await evalDesigns(ds, "wide");
      if (laps === before) break;   // every draw already measured or the budget is spent
      const byK = new Map(out.map(x => [canon(x.d), x.q]));
      cma.tell(xs, ds.map((d, i) => { const q = byK.get(canon(d)) || seen.get(canon(d)); const f = q ? (q.legal ? q.lap_s : space.penalty(q.violations)) : 1e4; return f + 0.1 * space.outside(xs[i]); }));
      if (cma.state().max_std < 2e-3) break;
    }
    stages.push({ stage: "wide", laps, best_s: best ? best.lap : null });
  }
  const pick = best || proposal;
  const changes = pick ? design.diff(parent, pick.d).map(c => ({ part: c.part, param: c.param, to: c.to })) : (o.changes || []).map(c => ({ part: c.part, param: c.param, to: c.to }));
  return {
    changes, lap_s: best ? best.lap : null, proposal_lap_s: proposal ? (proposal.q.legal ? proposal.q.lap_s : null) : null, proposal_legal: proposal ? !!proposal.q.legal : null,
    parent_lap_s: isFinite(parentLap) ? parentLap : null, laps, batches, budget, scope, stages, stopped,
    improved_on_proposal: !!(best && proposal && best.lap < lapOf(proposal.q) - 1e-9), best_stage: best ? best.stage : null,
  };
}

module.exports = { localSearch, LINE_T, COORD_MULT };
