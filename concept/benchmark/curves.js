// PURPLE TESTS TO POLE - best-so-far curves on a physics-test budget (docs/concept/TESTS_TO_POLE.md). Pure functions, no I/O.
// A curve is a list of points in test order: { laps, legal_laps, screened, best_s, step }.
//   laps        physics-sim evaluations (concept/bench.js calls, as both the engine and the campaign count "physics laps"; an
//               illegal car is one evaluation but the bench gives it no lap time),
//   legal_laps  evaluations of legal cars, i.e. laps the physics lap sim actually ran,
//   screened    cheap pre-screens before the physics sim (legality + PU / material guards + the µs surrogate), counted separately,
//   best_s      fastest legal physics lap so far (physics lap sim, Silverstone, model prediction),
//   step        the test unit the point closes (an engine decision, a CMA-ES generation); 0 = the start car (not counted).
"use strict";

const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);

// engine v2 (recorded live run or a local run): decision rows + the tree's nodes (each measured car, with its decision and legality)
// -> one point per decision. The best is the running minimum of the legal measured laps, which is the tree's peak after the decision
// (the decision's fastest legal car becomes the head whenever it beats the head, and the head is never faster than the peak).
function fromEngine({ baseline_s, decisions, nodes }) {
  const byDec = new Map();
  for (const n of nodes) {
    if (n.decision == null) continue;
    const e = byDec.get(n.decision) || { n: 0, legal: 0, best: Infinity };
    e.n++; if (n.legal) { e.legal++; if (typeof n.lap_s === "number" && n.lap_s < e.best) e.best = n.lap_s; }
    byDec.set(n.decision, e);
  }
  const pts = [{ laps: 0, legal_laps: 0, screened: 0, best_s: baseline_s, step: 0 }];
  let laps = 0, legal = 0, screened = 0, best = baseline_s;
  for (const d of decisions) {
    const e = byDec.get(d.decision) || { n: 0, legal: 0, best: Infinity };
    if (e.n !== d.physics_laps) throw new Error("tests-to-pole: decision " + d.decision + " has " + e.n + " measured nodes but physics_laps " + d.physics_laps);
    laps += d.physics_laps; legal += e.legal; screened += d.screen ? d.screen.distinct || 0 : 0;
    if (e.best < best) best = e.best;
    pts.push({ laps, legal_laps: legal, screened, best_s: best, step: d.decision });
  }
  return pts;
}

// first point whose best beats `target` (strictly faster) -> { laps, legal_laps, screened, step } | null (not reached)
function reach(points, target) {
  for (const p of points) if (p.best_s < target - 1e-12) return { laps: p.laps, legal_laps: p.legal_laps, screened: p.screened, step: p.step, best_s: p.best_s };
  return null;
}
// first point at the curve's final best (cost of reaching the best lap this run found)
function reachBest(points) {
  const fin = points[points.length - 1].best_s;
  for (const p of points) if (p.best_s <= fin + 1e-12) return { laps: p.laps, legal_laps: p.legal_laps, screened: p.screened, step: p.step, best_s: p.best_s };
  return null;
}
// best lap within a budget of `budget` evaluations. A curve that ended before the budget (its own stopping rule) has no value
// there: null, never a carried-forward number (the comparison would credit tests that were never run).
function bestAt(points, budget, key) {
  key = key || "laps";
  const last = points[points.length - 1];
  if (last[key] < budget) return null;
  let b = null; for (const p of points) { if (p[key] <= budget) b = p.best_s; else break; }
  return b;
}
// truncate a curve at a budget (a run may overshoot by part of one decision / generation; points past the budget are dropped)
function truncate(points, budget) { return points.filter(p => p.laps <= budget); }

function stats(xs) {
  const v = xs.filter(x => typeof x === "number" && isFinite(x));
  if (!v.length) return { n: 0, of: xs.length, mean: null, sd: null, min: null, max: null };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (v.length - 1)) : null;
  return { n: v.length, of: xs.length, mean, sd, min: Math.min(...v), max: Math.max(...v) };
}

// the per-run summary the doc tables use
// budget (optional): the run's physics-lap cap; the curve is cut there for the totals / reach numbers, while bestAt reads the uncut
// curve (a run whose last decision overshot the cap DID run up to the cap, so it has a value there)
function summarize(points, { pole_s, budgets, budget }) {
  const full = points;
  if (budget != null) points = truncate(points, budget);
  const last = points[points.length - 1], pole = reach(points, pole_s), best = reachBest(points);
  const at = {}; for (const B of budgets || []) at[B] = budget != null && B > budget ? null : r3(bestAt(full, B));
  return {
    total_laps: last.laps, total_legal_laps: last.legal_laps, total_screened: last.screened, steps: points.length - 1,
    start_s: r3(points[0].best_s), best_s: r3(last.best_s), gap_to_pole_s: r3(last.best_s - pole_s),
    to_pole: pole, to_best: best, best_at: at,
  };
}

module.exports = { fromEngine, reach, reachBest, bestAt, truncate, stats, summarize, r3 };
