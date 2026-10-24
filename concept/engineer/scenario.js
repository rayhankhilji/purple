// PURPLE ENGINE v2 - the scenario (the user message of the FROZEN designer task, concept/designer/prompt.js; never edited) with the
// design tree's state. Everything new travels here as STATE and RESULTS, never as an instruction:
//   best:    the branch HEAD car (the car the next change is applied to; the designer scenario's own block: lap, gap, kg, front, params)
//   tree:    { cars (physics-measured so far), peak { node, lap_s }, head { node, d_peak_s, branch, fails, of },
//              abandoned: [{ b, from, parts, tries, best_d_s }] (≤ 2 most recent), last_move: "revert to peak n31" | "fork to n12" | null }
//   tested:  the last ≤ 3 decisions ON THIS BRANCH, oldest first: { change (as proposed), d_lap_s (the proposal exactly as proposed on
//            the physics sim; null if it was illegal as proposed), illegal?: [articles as proposed], kept (the decision's result),
//            sub: { n (variants screened), laps (physics laps), best (the subspace's fastest car vs the head, ≤ 3 params + "+k"),
//            d (its lap delta, s) }, x?: interaction term (s), by?: "engine" (parse / LLM error fallback), gain?/loss? (last row) }
//   near:    parameters at their legal limit for the head car (designer scenario nearLimits)
// fit(): ≤ LIMITS.chars (the designer scenario's limit, 1,800 chars ≈ 450 tokens). Trimmed least useful first: oldest tested rows
// down to one, near lines down to three, the older abandoned branch, the last row's segments, sub.best strings, the remaining
// tested row, near. The head car and the tree's peak/head are never trimmed.
"use strict";
const base = require("../designer/scenario.js");

const LIMITS = { chars: base.LIMITS.chars, tested: 3, near: base.LIMITS.near, best_params: 3 };
const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);

// "a.b 1->2; c.d 3->4; e.f 5->6 +2"
function shortChange(changes, max) {
  const s = base.describeChanges(changes.slice(0, max)).split("; ").filter(Boolean);
  return s.join("; ") + (changes.length > max ? " +" + (changes.length - max) : "");
}
function testedRow(dec) {
  const t = { change: dec.proposal_change || "none", d_lap_s: dec.as_proposed && dec.as_proposed.legal ? r3(dec.as_proposed.d_lap_s) : null };
  if (dec.as_proposed && !dec.as_proposed.legal && dec.as_proposed.articles && dec.as_proposed.articles.length) t.illegal = dec.as_proposed.articles.slice(0, 3);
  t.kept = !!dec.kept;
  if (dec.screen) t.sub = { n: dec.screen.distinct, laps: dec.physics_laps, best: dec.best_changes && dec.best_changes.length ? shortChange(dec.best_changes, LIMITS.best_params) : "none", d: r3(dec.best_d_s) };
  if (dec.interaction && typeof dec.interaction.term_s === "number") t.x = r3(dec.interaction.term_s);
  if (dec.by === "engine") t.by = "engine";
  return t;
}
// build({ head, headSummary, tree (Tree), decisions (this branch's, oldest first), limits }) -> scenario object
function build(o) {
  const L = Object.assign({}, LIMITS, o.limits || {});
  const b = base.build({ design: o.head, summary: o.headSummary, history: [], refused: [], limits: { near: L.near } });
  const rows = (o.decisions || []).slice(-L.tested).map(testedRow);
  const last = (o.decisions || [])[(o.decisions || []).length - 1], lt = rows[rows.length - 1];
  if (last && lt && last.moves) { if (last.moves.gain && last.moves.gain.length) lt.gain = last.moves.gain.slice(0, 2); if (last.moves.loss && last.moves.loss.length) lt.loss = last.moves.loss.slice(0, 2); }
  return { best: b.best, tree: o.tree.state(), tested: rows, near: b.near };
}
const serialize = sc => JSON.stringify(sc);
function fit(o) {
  const L = Object.assign({}, LIMITS, o.limits || {});
  const sc = build(o); let text = serialize(sc), dropped = 0;
  const lastRow = () => sc.tested[sc.tested.length - 1] || {};
  while (text.length > L.chars) {
    if (sc.tested.length > 1) sc.tested.shift();
    else if (sc.near.length > 3) sc.near.pop();
    else if (sc.tree.abandoned.length > 1) sc.tree.abandoned.shift();
    else if (lastRow().loss || lastRow().gain) { const t = lastRow(); delete t.loss; delete t.gain; }
    else if (lastRow().sub && lastRow().sub.best && lastRow().sub.best.length > 40) lastRow().sub.best = lastRow().sub.best.split("; ")[0] + " +";
    else if (sc.tested.length) sc.tested.shift();
    else if (sc.near.length) sc.near.pop();
    else if (sc.tree.abandoned.length) sc.tree.abandoned.shift();
    else break;
    dropped++; text = serialize(sc);
  }
  return { scenario: sc, text, chars: text.length, tokens: base.approxTokens(text), dropped };
}

module.exports = { LIMITS, build, fit, serialize, testedRow, shortChange };
