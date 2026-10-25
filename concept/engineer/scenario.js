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
// PHYSICS CORRECTIONS (opt-in: fit({ ..., corrections: { decisions } }); docs/concept/TESTS_TO_POLE.md §8). Every physics verdict of
// the run so far (ALL branches, not only the last 3 rows of this one) folded into one more block, appended AFTER the four blocks
// above, which are fitted first exactly as without it (so the text without "corrections" is byte for byte the text with it off):
//   corrections: { decisions (so far),
//     tried_cols: ["tried", "kept", "best_d_lap_s", "last_decision"],
//     tried_by_part: { <part>: [decisions whose proposal named the part, of those kept with the part changed in the kept car,
//                     the best kept lap delta vs its head (s, negative = faster; null if none), the last decision that named it] },
//     never_tried: [catalogue parts no proposal named yet],
//     rejected_repeatedly: ["part.param N tried, K kept, last M not kept"]  (≤ 3; M = proposals of it since its last kept one, ≥ 3),
//     illegal_as_proposed: ["#k part.param from->to <article> (xN); legal lo-hi step s"]  (≤ 3, newest first: the proposed parameter
//                     that is illegal on its own at that head (or the combination), and its legal range for the CURRENT head),
//     legal_range: { <part>: { <param>: "lo-hi" } }  (every parameter whose legal range for the current head, one parameter at a time
//                     with the rest held, is narrower than the model domain because of an FIA article or a model rule) }
// FOCUS (parallel rounds, opts.ideas K > 1 in concept/engineer/engine.js): the K calls of one round share the head car and the state,
// so at temperature 0 identical text would give identical answers; each call's scenario therefore starts with one more fact,
// focus: "<area of the car>" (FOCUS below, one per slot). Only the user message changes; the frozen task never does. Without a focus
// the text is byte for byte what it was.
// ≤ CORRECTIONS.chars (1,400). Trimmed: legal_range entries already in `near`, illegal lines to 2, the widest legal ranges, rejected
// lines to 2, illegal / rejected to 1, the least-tried parts. Facts only, like the rest of the scenario (no instruction words).
"use strict";
const base = require("../designer/scenario.js");
const parts = require("../parts.js");

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
  return Object.assign(o.focus ? { focus: String(o.focus) } : {}, { best: b.best, tree: o.tree.state(), tested: rows, near: b.near });
}
// the areas of the car a parallel round spreads its K calls over (slot i -> FOCUS[i]); K ≤ 4 uses the first four, rotated by round
// so every area comes up; K = 5-8 adds four more, all distinct (identical lines would give identical answers at temperature 0)
const FOCUS = ["front wing and nose", "rear wing and diffuser", "floor, sidepods and cooling", "suspension, set-up and gearbox", "ballast, wheelbase and survival cell", "engine cover, cooling and sidepods", "front wing and floor", "rear wing and set-up"];
function focusFor(round, n, K) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(K >= 4 ? FOCUS[i % FOCUS.length] : FOCUS[((Math.max(1, round) - 1) * K + i) % 4]);
  return out;
}
const serialize = sc => JSON.stringify(sc);
function fit(o) {
  const L = Object.assign({}, LIMITS, o.limits || {});
  const sc = build(o); let text = serialize(sc), dropped = 0;
  const done = () => withMemory(o, sc, (() => {
    if (!o.corrections) return { scenario: sc, text, chars: text.length, tokens: base.approxTokens(text), dropped };
    const c = fitCorrections(corrections({ decisions: o.corrections.decisions, head: o.head }), Object.assign({}, CORRECTIONS, o.corrections.limits || {}), sc.near);
    const baseChars = text.length;
    sc.corrections = c.block; text = serialize(sc);
    return { scenario: sc, text, chars: text.length, tokens: base.approxTokens(text), dropped, base_chars: baseChars, corrections_chars: c.chars, corrections_dropped: c.dropped };
  })());
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
  return done();
}

// ---- shared memory (opt-in: fit({ ..., memory: { decisions, k, chars } }); concept/engineer/memory.js): the "precedents" block,
// appended LAST, after everything above is fitted exactly as without it (so the text without "precedents" is byte for byte the
// text with the option off). Lines of facts: "similar car (distance 0.012, 9 cars): floor.width_mm 1450->1470 legal, -0.021 s".
function withMemory(o, sc, r) {
  if (!o.memory) return r;
  const m = require("./memory.js").retrieve(Object.assign({}, o.memory, { head: o.head, decisions: o.memory.decisions || [] }));
  const before = r.text.length;
  sc.precedents = m.lines;
  const text = serialize(sc);
  return Object.assign(r, { text, chars: text.length, tokens: base.approxTokens(text), memory_chars: text.length - before, precedents: m.picked });
}

// ---- physics corrections
const CORRECTIONS = { chars: 1400, rejected: 3, illegal: 3, streak: 3, articles: 2 };
const keyOf = c => c.part + "." + c.param;
const PART_ORDER = Array.from(new Set(parts.PARAMS.map(s => s.part)));
const SPEC = new Map(parts.PARAMS.map(s => [keyOf(s), s]));
// the proposed parameters that are illegal ON THEIR OWN at the head (the rest held); none alone -> the combination. `violations`
// is the engine's legality check (regs + PU + materials), `apply1(c)` the head with that one change (null if it cannot be applied)
function culprits(changes, apply1, violations, articlesOf, allArticles) {
  const out = [];
  for (const c of changes) { const d = apply1(c); const v = d ? violations(d) : [{ id: "DOMAIN" }]; if (v.length) out.push({ key: keyOf(c), articles: articlesOf(v) }); }
  return out.length ? out : [{ key: changes.map(keyOf).join("+"), articles: allArticles || [] }];
}
// corrections({ decisions (run-wide, oldest first: engine decision rows), head (the current head design) }) -> the block (untrimmed)
function corrections(o) {
  const decs = o.decisions || [];
  const P = new Map(), K = new Map(), I = new Map();
  for (const d of decs) {
    const prop = d.proposal || [];
    const keptCar = d.kept ? (d.best_changes || []) : [], keptKeys = new Set(keptCar.map(keyOf));
    for (const c of prop) {
      const k = keyOf(c), e = K.get(k) || { n: 0, k: 0, streak: 0 };
      e.n++; if (keptKeys.has(k)) { e.k++; e.streak = 0; } else e.streak++;
      K.set(k, e);
    }
    for (const part of new Set(prop.map(c => c.part))) {
      const e = P.get(part) || { n: 0, k: 0, best: null, last: null };
      e.n++; e.last = d.decision;
      if (d.kept && keptCar.some(c => c.part === part)) { e.k++; if (typeof d.d_head_s === "number" && (e.best == null || d.d_head_s < e.best)) e.best = d.d_head_s; }
      P.set(part, e);
    }
    if (d.as_proposed && d.as_proposed.legal === false && prop.length) {
      const cul = d.illegal_params || [{ key: prop.map(keyOf).join("+"), articles: d.as_proposed.articles || [] }];
      for (const c of cul) {
        const e = I.get(c.key) || { n: 0 };
        const keys = c.key.split("+");
        e.n++; e.last = d.decision; e.articles = (c.articles || []).slice(0, CORRECTIONS.articles);
        e.change = base.describeChanges(prop.filter(x => keys.includes(keyOf(x))));
        I.set(c.key, e);
      }
    }
  }
  const rng = o.head ? base.ranges(o.head) : [], R = new Map(rng.map(r => [r.key, r]));
  const rangeOf = k => { const r = R.get(k), s = SPEC.get(k); return r ? r.lo + "-" + r.hi + (s ? " step " + s.step : "") : null; };
  const tried = {};
  for (const [part, e] of Array.from(P.entries()).sort((a, b) => b[1].n - a[1].n || PART_ORDER.indexOf(a[0]) - PART_ORDER.indexOf(b[0]))) tried[part] = [e.n, e.k, r3(e.best), e.last];
  const rejected = Array.from(K.entries()).filter(([, e]) => e.streak >= CORRECTIONS.streak).sort((a, b) => b[1].streak - a[1].streak || b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1))
    .map(([k, e]) => k + " " + e.n + " tried, " + e.k + " kept, last " + e.streak + " not kept");
  const illegal = Array.from(I.entries()).sort((a, b) => b[1].last - a[1].last || (a[0] < b[0] ? -1 : 1)).map(([k, e]) => {
    const rs = k.split("+").map(x => (k.includes("+") ? x + " " : "") + rangeOf(x)).filter(x => !/null$/.test(x)).slice(0, 2);
    return "#" + e.last + " " + e.change + " " + e.articles.join(" ") + (e.n > 1 ? " (x" + e.n + ")" : "") + (rs.length ? "; legal " + rs.join(", ") : "");
  });
  const legal = {}, legalOrder = [];
  for (const r of rng) {
    if (r.lo_src === "domain" && r.hi_src === "domain") continue;
    const [part, param] = r.key.split(".");
    (legal[part] = legal[part] || {})[param] = r.lo + "-" + r.hi;
    const s = SPEC.get(r.key), w = s ? s.max - s.min : 1;
    legalOrder.push({ key: r.key, width: w > 0 ? (r.hi - r.lo) / w : 0 });
  }
  return { decisions: decs.length, tried_cols: ["tried", "kept", "best_d_lap_s", "last_decision"], tried_by_part: tried, never_tried: PART_ORDER.filter(p => !P.has(p)), rejected_repeatedly: rejected, illegal_as_proposed: illegal, legal_range: legal, _legal_order: legalOrder };
}
// trim to limits.chars, least useful first (see the header); near = the scenario's near lines (their parameters are already there)
function fitCorrections(c, limits, near) {
  const L = Object.assign({}, CORRECTIONS, limits || {});
  const nearKeys = new Set((near || []).map(l => String(l).split(" ")[0]));
  const order = (c._legal_order || []).slice().sort((a, b) => (nearKeys.has(b.key) ? 1 : 0) - (nearKeys.has(a.key) ? 1 : 0) || b.width - a.width || (a.key < b.key ? -1 : 1));
  delete c._legal_order;
  c.rejected_repeatedly = c.rejected_repeatedly.slice(0, L.rejected); c.illegal_as_proposed = c.illegal_as_proposed.slice(0, L.illegal);
  const dropLegal = () => { const x = order.shift(); if (!x) return false; const [part, param] = x.key.split("."); if (c.legal_range[part]) { delete c.legal_range[part][param]; if (!Object.keys(c.legal_range[part]).length) delete c.legal_range[part]; } return true; };
  let text = JSON.stringify(c), dropped = 0;
  while (text.length > L.chars) {
    if (order.length && nearKeys.has(order[0].key)) dropLegal();
    else if (c.illegal_as_proposed.length > 2) c.illegal_as_proposed.pop();
    else if (order.length) dropLegal();
    else if (c.rejected_repeatedly.length > 2) c.rejected_repeatedly.pop();
    else if (c.illegal_as_proposed.length > 1) c.illegal_as_proposed.pop();
    else if (c.rejected_repeatedly.length > 1) c.rejected_repeatedly.pop();
    else if (Object.keys(c.tried_by_part).length > 3) { const ks = Object.keys(c.tried_by_part); delete c.tried_by_part[ks[ks.length - 1]]; }
    else break;
    dropped++; text = JSON.stringify(c);
  }
  return { block: c, chars: text.length, dropped };
}

module.exports = { LIMITS, CORRECTIONS, FOCUS, focusFor, build, fit, serialize, testedRow, shortChange, corrections, fitCorrections, culprits };
