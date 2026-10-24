// PURPLE ENGINE v2 - the autonomous engineer (docs/concept/ENGINE_V2.md). Mubit decides WHAT to explore; the engine executes and
// measures; the verdict is always the physics sim's numbers.
//   decision k:
//   1. scenario (concept/engineer/scenario.js): the branch head car + the design tree's state (peak, head vs peak, fails on this
//      branch, abandoned branches) + this branch's last decisions with their measured results -> ONE call of the frozen designer
//      task (the injected llm; server side it is server/mubit.js) -> strict schema (concept/designer/schema.js).
//   2. the proposal is a DIRECTION, never discarded: as proposed it is measured on the physics sim; if it is illegal it is also
//      PROJECTED onto the legal space (the furthest legal point on the line head -> proposal, regs.js bisection), and either way
//      its SUBSPACE (concept/engineer/subspace.js: proposed + coupled parameters, discrete ones enumerated) is explored:
//   3. SCREEN thousands of variants (FIA checks + the µs physics surrogate; concept/engineer/screen.js, worker threads),
//   4. CONFIRM the top K (+ a few the surrogate cannot rank, + the proposal as proposed, + its projection) on the full physics lap
//      sim with every FIA check (concept/campaign/pool.js -> concept/bench.js, worker threads),
//   5. INTERACTIONS: the fastest confirmed car's changes grouped by part, each group alone vs all together (physics laps);
//      interaction term = Δ(together) − Σ Δ(alone), in s,
//   6. KEEP by the numbers (concept/engineer/tree.js): the decision's fastest legal car becomes the head if it beats the head;
//      after `patience` decisions without a kept car the branch is abandoned (revert to the peak, or fork from the best other car)
//      and the next scenario reports it.
//   A parse error or an LLM error is the ONLY case where the engine picks the direction itself (a seeded design.mutate step, by
//   "engine", labelled everywhere); its gains are never credited to Mubit.
//   opts.corrections (default true; false reproduces the recorded runs' scenarios byte for byte): the scenario also carries the
//   PHYSICS CORRECTIONS block (concept/engineer/scenario.js): every verdict of the run so far, folded per part / parameter, the
//   illegal-as-proposed parameters with their legal range, and the legal ranges for the head car. It changes only the user message;
//   the frozen designer task (prompt, model, max_tokens, temperature) is untouched. With it on, an illegal proposal's decision row
//   also records which proposed parameter was illegal on its own (illegal_params).
//   opts.ideas K (default 1 = one decision at a time, exactly as before; 2-8 = PARALLEL ROUNDS, docs/concept/ENGINE_V2.md §9): each
//   round asks for K ideas AT ONCE, all from the same head car; call i's scenario carries one more fact, focus: "<area of the car>"
//   (concept/engineer/scenario.js FOCUS; identical inputs would give identical answers at temperature 0). Every idea is tested
//   (screen + confirm, its own decision row with round / slot / of / focus), the round's fastest legal car is kept if it beats the
//   head (ONE tree step per round: patience and stopAfter count rounds), and the round ends. Per row: found_faster (the idea's best
//   legal version beat the head by > 0.5 ms; the "kept" training rule of record-good.js), round_best (its car was the round's pick).
//   opts.deadline (epoch ms): stop cleanly BEFORE a round (or decision) that would end after it, judged on the slowest of the last 3
//   ("stopped at the time limit after N rounds"). opts.maxRounds caps rounds.
// runEngineer(opts) -> { run_id, tree, decisions, stats, peak, ... }. Deterministic for (seed, llm answers, worker counts any).
"use strict";
const design = require("../design.js"), bench = require("../bench.js"), regs = require("../regs.js"), phys = require("../physical.js");
const schema = require("../designer/schema.js"), dscen = require("../designer/scenario.js"), segments = require("../designer/segments.js");
const prompt = require("../designer/prompt.js");
const subspace = require("./subspace.js"), scen = require("./scenario.js"), { Tree, EPS } = require("./tree.js"), { ScreenPool, keyOfChanges } = require("./screen.js");
const { Pool } = require("../campaign/pool.js");

const CIRCUIT = "silverstone";
const LABEL = "ENGINE v2 · every lap a physics lap sim lap (quasi-steady-state point mass · Silverstone · calibrated to 2026 British GP qualifying); surrogate = ranking only";
const KEPT_RULE = "kept = legal (FIA 2026 Section C checks + homologated PU + materials) && physics lap < head lap − 0.1 ms; the model's output has no verdict field";
const MAX_IDEAS = 8;          // ideas per round (≤ 8 Mubit calls in flight per run)
const FASTER_S = 0.0005;      // "found a faster car": the idea's best legal version beats the head by more than 0.5 ms (record-good.js FASTER_BY_S)
const ROUND_RULE = "a round: K ideas from Mubit at once from the same head car (each call's scenario has its own focus line); every idea is tested; the round's fastest legal car is kept if it beats the head";
const DEFAULTS = { ideas: 1, deadline: null, maxRounds: null, seed: 1, team: "redbull", maxDecisions: 40, maxCalls: 40, patience: 3, stopAfter: 15, variants: 3000, confirm: 24, explore: 4, workers: 0, pace_ms: 0, trained: false, segments: true, corrections: true };
const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

function pole() { return bench.racepace()[CIRCUIT].pole.s; }
// fast legality of a design (no lap): regs + PU + materials
function violations(d) {
  const f = design.facts(d), v = regs.checkFacts(f), pc = phys.physical(d);
  for (const x of bench.checkPU(pc, d, f.mass)) v.push(x);
  for (const x of bench.checkMaterials(d)) v.push(x);
  return v;
}
const articlesOf = vs => Array.from(new Set((vs || []).map(v => (v.id && dscen.articleOf ? dscen.articleOf(v.id) : String(v.article || v.id)))));
// projection of an illegal proposal onto the legal space: the largest t in (0, 1] with head + t·(proposal − head) legal (bisection)
function project(head, changes) {
  const at = t => { try { return design.applyChanges(head, changes.map(c => ({ part: c.part, param: c.param, to: head.params[c.part][c.param] + t * (c.to - head.params[c.part][c.param]) }))); } catch (e) { return null; } };
  let lo = 0, hi = 1, best = null;
  for (let it = 0; it < 12; it++) {
    const m = (lo + hi) / 2, a = at(m);
    if (a && a.changes.length && violations(a.design).length === 0) { lo = m; best = { t: m, changes: a.changes.map(c => ({ part: c.part, param: c.param, to: c.to })) }; } else hi = m;
  }
  // one parameter at a time: drop the parameters that make it illegal on their own, keep the rest at full size
  if (changes.length > 1) {
    const keep = changes.filter(c => { const a = at1(head, c); return a && violations(a).length === 0; });
    if (keep.length && keep.length < changes.length) { const a = design.applyChanges(head, keep); if (a.changes.length && violations(a.design).length === 0 && (!best || best.t < 0.5)) best = { t: null, dropped: changes.filter(c => !keep.includes(c)).map(c => c.part + "." + c.param), changes: a.changes.map(c => ({ part: c.part, param: c.param, to: c.to })) }; }
  }
  return best;
}
function at1(head, c) { try { return design.applyChanges(head, [c]).design; } catch (e) { return null; } }
// group a change list by part (≤ 4 groups; the smallest are merged into the last)
function groupsOf(changes) {
  const m = new Map(); for (const c of changes) { if (!m.has(c.part)) m.set(c.part, []); m.get(c.part).push(c); }
  let g = Array.from(m.entries()).map(([part, ch]) => ({ name: part, changes: ch }));
  while (g.length > 4) { const a = g.pop(), b = g[g.length - 1]; b.name += "+" + a.name; b.changes = b.changes.concat(a.changes); }
  return g;
}

async function runEngineer(opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  if (typeof opts.llm !== "function") throw new Error("engineer: opts.llm(text, { sessionId, trained, gen }) is required");
  const P = opts.prompt || prompt;
  if (opts.trained && P.DRAFT) throw new Error("engineer: trained calls are refused while the designer prompt is a DRAFT");
  const runId = opts.runId || "eng2-seed" + opts.seed, sessionId = runId;
  const emit = (type, data) => { if (opts.onEvent) opts.onEvent(type, Object.assign({ type, run_id: runId, session_id: sessionId }, data)); };
  const benchOpts = Object.assign({ circuit: CIRCUIT }, opts.bench || {});
  const ownPool = !opts.pool, pool = opts.pool || new Pool(opts.workers);
  const ownScreen = !opts.screenPool, screenPool = opts.screenPool || new ScreenPool(opts.workers);
  const POLE = pole();

  let tree, decisions = [], calls = 0, k0 = 0;
  const stats = { variants_generated: 0, variants_screened: 0, screen_ms: 0, physics_laps: 0, physics_ms: 0, llm_ms: 0, kept: 0, reverts: 0, forks: 0, gain_s: { mubit: 0, mock: 0, engine: 0 }, kept_by: { mubit: 0, mock: 0, engine: 0 }, by: { mubit: 0, mock: 0, engine: 0 }, proposal_illegal: 0, projected: 0, expected_hit: 0, expected_n: 0 };
  const designOf = id => { const n = tree.get(id); return { params: n.params, team: n.team || null, id: n.id, label: n.id }; };
  if (opts.resume) {
    tree = Tree.fromJSON(opts.resume.tree); decisions = (opts.resume.decisions || []).slice(); calls = opts.resume.calls || 0; k0 = decisions.length;
    if (opts.resume.stats) Object.assign(stats, opts.resume.stats);
  } else {
    tree = new Tree({ patience: opts.patience });
    const start = opts.start ? design.clone(opts.start) : design.baseline(opts.team ? { team: opts.team } : undefined);
    const [r] = await pool.evaluate([start], benchOpts);
    if (!r.legal) throw new Error("engineer: the start car is illegal (" + r.violations.map(v => v.id).join(", ") + ")");
    tree.root({ params: start.params, team: start.team || null, legal: true, lap_s: r.lap_s, sectors_s: r.sectors_s, mass_kg: r.mass_kg, front_share: r.front_share });
  }
  const rootNode = tree.nodes[0];
  emit("start", { resumed: !!opts.resume, decisions_done: k0, seed: opts.seed, trained: !!opts.trained, prompt_version: P.DESIGNER_PROMPT_VERSION, team: opts.team || null, baseline: { lap_s: rootNode.lap_s, sectors_s: rootNode.sectors_s, gap_to_pole_s: r3(rootNode.lap_s - POLE) }, pole_s: POLE, label: LABEL, kept_rule: KEPT_RULE, opts: Object.assign({ variants: opts.variants, confirm: opts.confirm, explore: opts.explore, patience: opts.patience, stopAfter: opts.stopAfter, maxDecisions: opts.maxDecisions, maxCalls: opts.maxCalls, workers: screenPool.n }, opts.corrections ? { corrections: true } : {}, (opts.ideas | 0) > 1 ? { ideas: Math.min(MAX_IDEAS, opts.ideas | 0), round_rule: ROUND_RULE } : {}), tree: tree.compact(), peak: tree.peak, head: tree.head });

  let stopped = null, lastPeakAt = k0;
  if (opts.resume) { for (let i = decisions.length - 1; i >= 0; i--) if (decisions[i].new_peak) { lastPeakAt = i + 1; break; } }
  const mode = opts.mock ? "mock" : "mubit";
  const K = Math.max(1, Math.min(MAX_IDEAS, (opts.ideas | 0) || 1));
  const stepMs = [];   // wall time of each finished decision (K = 1) or round (K > 1): the time-box estimate
  // the time box (opts.deadline, epoch ms): stop BEFORE a step that would end after it (estimate: the slowest of the last 3 steps)
  const overDeadline = () => opts.deadline != null && stepMs.length > 0 && now() + Math.max.apply(null, stepMs.slice(-3)) > opts.deadline;
  const extra = dec => (dec.round != null ? { round: dec.round, slot: dec.slot, of: dec.of, focus: dec.focus } : {});

  // ---- 1. one designer call -> { changes } (the model's, or the engine's labelled fallback) | { stop } (the run's call cap)
  // pre: { request } already previewed (a round previews all K first, so the K calls start in slot order: deterministic mocks)
  async function ask(k, sc, dec, head, meta, pre) {
    const request = pre ? pre.request : opts.preview ? await opts.preview(sc.text, meta) : null;
    emit("request", Object.assign({ decision: k, scenario: sc.scenario, scenario_text: sc.text, scenario_chars: sc.chars, scenario_tokens: sc.tokens, trained: !!opts.trained, request }, extra(dec)));
    let proposal = null, why = null;
    calls++;
    const tc = now();
    try {
      const res = await opts.llm(sc.text, meta);
      const o = typeof res === "string" ? { text: res } : res;
      dec.call = { mubit_request_id: o.mubit_request_id || null, served_by: o.served_by || null, model: o.model || null, input_tokens: o.input_tokens == null ? null : o.input_tokens, output_tokens: o.output_tokens == null ? null : o.output_tokens, latency_ms: o.latency_ms == null ? now() - tc : o.latency_ms, trained: !!opts.trained, mock: !!o.mock };
      dec.response_text = String(o.text).slice(0, 600);
      const v = schema.validate(o.text);
      if (v.ok) { proposal = v.value; if (v.clamped) dec.clamped = v.clamped; }
      else why = "parse: " + v.error;
    } catch (e) {
      dec.call = { mubit_request_id: (e && e.requestId) || null, error: String(e && (e.code || e.message) || e), trained: !!opts.trained };
      why = "llm_error: " + dec.call.error;
      if (e && e.code === "run_cap") return { stop: true };
    }
    stats.llm_ms += now() - tc;
    let changes;
    if (proposal) {
      dec.by = mode; changes = proposal.changes.map(c => ({ part: c.part, param: c.param, to: c.to }));
      dec.hypothesis = proposal.hypothesis; dec.expected = proposal.expected;
    } else {
      // the only engine-chosen direction: a seeded one-step mutation of the head (labelled "engine")
      dec.by = "engine"; dec.fallback_reason = why;
      const m = design.mutate(head, design.seededRng((opts.seed * 7919 + k * 104729) >>> 0), 0.06);
      changes = m.changes.map(c => ({ part: c.part, param: c.param, to: c.to }));
    }
    stats.by[dec.by]++;
    dec.proposal = changes.map(c => ({ part: c.part, param: c.param, from: head.params[c.part][c.param], to: c.to }));
    dec.proposal_change = dscen.describeChanges(dec.proposal);
    emit("proposal", Object.assign({ decision: k, by: dec.by, change: dec.proposal_change, changes: dec.proposal, hypothesis: dec.hypothesis || null, expected: dec.expected || null, fallback_reason: dec.fallback_reason || null, call: dec.call }, extra(dec)));
    return { changes };
  }

  // ---- 2-5. as proposed + projection, subspace screen, physics confirm, interactions; every measured car becomes a tree node
  // (parent = the head); the idea's fastest legal car is its "result" node. -> { resultNode }
  async function testIdea(k, dec, changes, headNode, head) {
    // ---- 2. as proposed + projection onto the legal space
    let asDesign = null; try { asDesign = design.applyChanges(head, changes).design; } catch (e) { asDesign = null; }
    const asViol = asDesign ? violations(asDesign) : [{ id: "DOMAIN", article: "design domain" }];
    const confirmSet = [];   // { kind, changes }
    if (asDesign && design.diff(head, asDesign).length) confirmSet.push({ kind: "proposal", changes: design.diff(head, asDesign).map(c => ({ part: c.part, param: c.param, to: c.to })) });
    if (asViol.length) {
      stats.proposal_illegal++;
      if (opts.corrections) dec.illegal_params = scen.culprits(changes, c => at1(head, c), violations, articlesOf, articlesOf(asViol));
      const pj = project(head, changes);
      if (pj) { stats.projected++; dec.projection = { t: pj.t == null ? null : +pj.t.toFixed(3), dropped: pj.dropped || null, change: dscen.describeChanges(pj.changes.map(c => ({ part: c.part, param: c.param, from: head.params[c.part][c.param], to: c.to }))) }; confirmSet.push({ kind: "projected", changes: pj.changes }); }
    }

    // ---- 3. subspace + screen
    const sub = subspace.expand(head, changes);
    dec.subspace = { dims: sub.dims, proposed: sub.proposed, coupled: sub.coupled, discrete: sub.discrete, combos: sub.combos, text: subspace.describe(sub) };
    const scr = await screenPool.screen(head, sub, (opts.seed * 1000003 + k * 7919) >>> 0, opts.variants, { keep: opts.confirm, explore: opts.explore, stop: () => false, onChunk: ev => emit("progress", Object.assign({ decision: k, stage: "screen", done: ev.done, n: ev.n }, extra(dec))) });
    stats.variants_generated += scr.generated; stats.variants_screened += scr.distinct; stats.screen_ms += scr.ms;
    dec.screen = { generated: scr.generated, distinct: scr.distinct, legal: scr.legal, illegal: scr.illegal, oob: scr.oob, ms: scr.ms, per_s: scr.ms > 0 ? Math.round(scr.distinct / scr.ms * 1000) : null, top_violations: Object.entries(scr.violations).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ id, article: dscen.articleOf(id), n })), surrogate_best_s: scr.top.length ? r3(scr.top[0].lap) : null };
    emit("screen", Object.assign({ decision: k, screen: dec.screen, subspace: dec.subspace }, extra(dec)));
    // an illegal proposal with no legal point on its own line: the surrogate's fastest legal variants that still move every
    // proposed parameter the way the proposal did ("repaired": the coupled parameters made room for it)
    if (asViol.length && !confirmSet.some(c => c.kind === "projected")) for (const x of scr.along) confirmSet.push({ kind: "repaired", changes: x.changes, surrogate_s: x.lap });
    for (const x of scr.top) confirmSet.push({ kind: "candidate", changes: x.changes, surrogate_s: x.lap });
    for (const x of scr.explore) confirmSet.push({ kind: "explore", changes: x.changes });

    // ---- 4. confirm on the physics sim (deduplicated)
    const seenK = new Set(), toRun = [];
    for (const c of confirmSet) { const key = keyOfChanges(c.changes); if (seenK.has(key) || !c.changes.length) continue; seenK.add(key); let d; try { d = design.applyChanges(head, c.changes).design; } catch (e) { continue; } toRun.push(Object.assign({}, c, { d })); }
    const tp = now();
    const res = await pool.evaluate(toRun.map(x => x.d), benchOpts);
    const measured = toRun.map((x, i) => Object.assign(x, { q: res[i] }));
    // ---- 5. interactions on the fastest confirmed car
    const legalOnes = measured.filter(x => x.q.legal).sort((a, b) => a.q.lap_s - b.q.lap_s);
    let inter = null;
    if (legalOnes.length) {
      const b0 = legalOnes[0], groups = groupsOf(b0.changes);
      if (groups.length >= 2) {
        const alone = groups.map(g => ({ kind: "alone", group: g.name, changes: g.changes, d: design.applyChanges(head, g.changes).design }));
        const ar = await pool.evaluate(alone.map(a => a.d), benchOpts);
        alone.forEach((a, i) => { a.q = ar[i]; measured.push(a); });
        const dAll = b0.q.lap_s - headNode.lap_s, parts = alone.map(a => ({ group: a.group, legal: a.q.legal, d_s: a.q.legal ? r3(a.q.lap_s - headNode.lap_s) : null, articles: a.q.legal ? null : articlesOf(a.q.violations) }));
        const allLegal = parts.every(p => p.legal);
        inter = { together_d_s: r3(dAll), groups: parts, sum_alone_d_s: allLegal ? r3(parts.reduce((s, p) => s + p.d_s, 0)) : null, term_s: allLegal ? r3(dAll - parts.reduce((s, p) => s + (p.d_s || 0), 0)) : null, note: allLegal ? null : "a group is illegal on its own: together it is legal, so the term is not defined" };
      } else inter = { together_d_s: r3(b0.q.lap_s - headNode.lap_s), groups: [{ group: groups.length ? groups[0].name : null }], term_s: null, note: "one part changed: no interaction to measure" };
    }
    const physMs = now() - tp;
    stats.physics_laps += measured.length; stats.physics_ms += physMs;
    dec.physics_laps = measured.length; dec.physics_ms = physMs; dec.laps_per_s = physMs > 0 ? +(measured.length / physMs * 1000).toFixed(1) : null;
    dec.interaction = inter;

    // ---- tree nodes for every measured car; the fastest legal one is the idea's result
    let bestM = null; for (const x of measured) if (x.q.legal && (!bestM || x.q.lap_s < bestM.q.lap_s - 1e-12)) bestM = x;
    const asM = measured.find(x => x.kind === "proposal");
    let pjM = measured.find(x => x.kind === "projected");
    if (!pjM) { const rep = measured.filter(x => x.kind === "repaired" && x.q.legal).sort((a, b) => a.q.lap_s - b.q.lap_s)[0]; if (rep) { pjM = rep; stats.projected++; dec.projection = { t: null, repaired: true, change: dscen.describeChanges(rep.changes.map(c => ({ part: c.part, param: c.param, from: head.params[c.part][c.param], to: c.to }))) }; } }
    dec.as_proposed = asDesign ? (asM ? { legal: asM.q.legal, lap_s: asM.q.legal ? asM.q.lap_s : null, d_lap_s: asM.q.legal ? r3(asM.q.lap_s - headNode.lap_s) : null, articles: asM.q.legal ? [] : articlesOf(asM.q.violations) } : { legal: true, d_lap_s: 0, note: "no change" }) : { legal: false, articles: articlesOf(asViol) };
    if (pjM) dec.projection = Object.assign(dec.projection || {}, { legal: pjM.q.legal, d_lap_s: pjM.q.legal ? r3(pjM.q.lap_s - headNode.lap_s) : null });
    let resultNode = null;
    for (const x of measured) {
      const isBest = x === bestM;
      const n = tree.add({ parent: headNode.id, decision: k, kind: isBest ? "result" : x.kind, by: dec.by, legal: !!x.q.legal, lap_s: x.q.legal ? x.q.lap_s : null, sectors_s: x.q.legal ? x.q.sectors_s : null, articles: x.q.legal ? undefined : articlesOf(x.q.violations), changes: x.changes, mass_kg: x.q.mass_kg, front_share: x.q.front_share, from_kind: isBest ? x.kind : undefined });
      if (isBest) { n.params = x.d.params; n.team = x.d.team || null; resultNode = n; }
    }
    dec.result = resultNode ? { node: resultNode.id, lap_s: resultNode.lap_s, sectors_s: resultNode.sectors_s, from_kind: resultNode.from_kind } : null;
    dec.best_changes = bestM ? bestM.changes.map(c => ({ part: c.part, param: c.param, from: head.params[c.part][c.param], to: c.to })) : [];
    dec.best_change = bestM ? dscen.describeChanges(bestM.changes.map(c => ({ part: c.part, param: c.param, from: head.params[c.part][c.param], to: c.to }))) : null;
    dec.best_d_s = bestM ? r3(bestM.q.lap_s - headNode.lap_s) : null;
    if (bestM && opts.segments && segments) {
      try { const sb = headSegments(head), sa = segments.segmentTimes(bestM.d, benchOpts); if (sb && sa) dec.moves = segments.topMoves(segments.segmentDelta(sb, sa)); } catch (e) { /* segments are optional */ }
    }
    return { resultNode };
  }
  // the head car's segment times, once per head (a round tests K ideas from the same head)
  let segCache = null;
  const headSegments = head => { if (!segCache || segCache.id !== head.id) segCache = { id: head.id, v: segments.segmentTimes(head, benchOpts) }; return segCache.v; };
  const expectedHit = dec => { if (dec.expected && dec.as_proposed && dec.as_proposed.legal && typeof dec.as_proposed.d_lap_s === "number") { stats.expected_n++; const s = dec.as_proposed.d_lap_s > 0.0005 ? 1 : dec.as_proposed.d_lap_s < -0.0005 ? -1 : 0; dec.expected_hit = s === dec.expected.lap_delta_s; if (dec.expected_hit) stats.expected_hit++; } };
  // the "decision" event; withParams: this row carries the new peak's / head's parameters (the row that moved them)
  const decisionEvent = (dec, out, withParams, peakId) => {
    const peak = tree.get(peakId || tree.peak);
    emit("decision", Object.assign({ decision: dec.decision, row: compactDecision(dec), nodes: tree.nodes.filter(n => n.decision === dec.decision && (n.kind === "result")).map(n => ({ id: n.id, parent: n.parent, decision: n.decision, branch: n.branch, kind: n.kind, lap_s: r3(n.lap_s), legal: n.legal, by: n.by })), measured: dec.physics_laps, peak: { node: peak.id, lap_s: peak.lap_s, gap_to_pole_s: r3(peak.lap_s - POLE), params: withParams && out.new_peak ? peak.params : undefined }, head: dec.head_after, head_params: withParams && (out.kept || out.reverted) ? tree.get(tree.head).params : undefined, stats: statsView(stats, tree, calls), branch: tree.branch.id }, extra(dec)));
  };

  try {
    if (K === 1) for (let k = k0 + 1; ; k++) {
      // ---- stop?
      const peakNode = tree.get(tree.peak);
      if (opts.shouldStop) { const why = opts.shouldStop({ decision: k, peak: peakNode, calls, decisions }); if (why) { stopped = String(why); break; } }
      if (k > opts.maxDecisions) { stopped = "decision cap " + opts.maxDecisions; break; }
      if (calls >= opts.maxCalls) { stopped = "call budget of " + opts.maxCalls + " spent"; break; }
      if (k - 1 - lastPeakAt >= opts.stopAfter) { stopped = "no new peak for " + opts.stopAfter + " decisions"; break; }
      if (opts.target_lap_s != null && peakNode.lap_s <= opts.target_lap_s) { stopped = "target lap " + opts.target_lap_s + " s reached"; break; }
      if (overDeadline()) { stopped = "stopped at the time limit after " + (k - 1 - k0) + (k - 1 - k0 === 1 ? " decision" : " decisions"); break; }

      const headNode = tree.get(tree.head), head = designOf(tree.head);
      const headSummary = { lap_s: headNode.lap_s, gap_to_pole_s: headNode.lap_s - POLE, mass_kg: headNode.mass_kg, front_share: headNode.front_share };
      const branch = tree.branch, branchDecs = decisions.filter(d => d.branch === branch.id);
      const sc = scen.fit({ head, headSummary, tree, decisions: branchDecs, limits: opts.scenarioLimits, corrections: opts.corrections ? { decisions, limits: opts.correctionsLimits } : null });
      const dec = { decision: k, branch: branch.id, head: headNode.id, head_lap_s: headNode.lap_s, session_id: sessionId, scenario: sc.text, scenario_chars: sc.chars, scenario_tokens: sc.tokens, trained: !!opts.trained, by: null, t0: now() };

      // ---- 1. the designer call (one per decision)
      if (opts.pace_ms) await sleep(opts.pace_ms);
      const a = await ask(k, sc, dec, head, { sessionId, trained: !!opts.trained, gen: k });
      if (a.stop) { stopped = "call budget spent"; break; }
      const t = await testIdea(k, dec, a.changes, headNode, head);
      // ---- 6. keep by the numbers, revert / fork automatically
      const parts = Array.from(new Set(a.changes.map(c => c.part)));
      const out = tree.decide(t.resultNode || { legal: false }, { decision: k, parts });
      dec.kept = out.kept; dec.new_peak = out.new_peak; dec.d_head_s = out.d_head_s; dec.head_after = out.head; dec.peak_after = out.peak;
      if (out.kept) { stats.kept++; stats.kept_by[dec.by]++; stats.gain_s[dec.by] = r3(stats.gain_s[dec.by] - out.d_head_s); }
      if (out.new_peak) lastPeakAt = k;
      if (out.reverted) { dec.reverted = out.reverted; if (out.reverted.kind === "fork") stats.forks++; else stats.reverts++; }
      expectedHit(dec);
      dec.ms = now() - dec.t0; delete dec.t0;
      stepMs.push(dec.ms);
      decisions.push(dec);
      decisionEvent(dec, out, true);
      if (out.reverted) emit("revert", Object.assign({ decision: k }, out.reverted));
    }
    else {
      // ---- PARALLEL ROUNDS (K ideas per round): K calls at once from the same head car, each with its own focus line; every idea
      // is tested (screen + confirm); the round's fastest legal car is kept if it beats the head; ONE tree step per round
      let round = decisions.length ? (decisions[decisions.length - 1].round || 0) : 0, lastPeakRound = round;
      if (opts.resume) { for (let i = decisions.length - 1; i >= 0; i--) if (decisions[i].new_peak) { lastPeakRound = decisions[i].round || 0; break; } }
      const round0 = round;
      for (;;) {
        round++;
        const k1 = decisions.length + 1, peakNode = tree.get(tree.peak);
        if (opts.shouldStop) { const why = opts.shouldStop({ decision: k1, round, peak: peakNode, calls, decisions }); if (why) { stopped = String(why); break; } }
        if (opts.maxRounds != null && round - round0 > opts.maxRounds) { stopped = "all " + opts.maxRounds + " rounds done"; break; }
        if (k1 > opts.maxDecisions) { stopped = "decision cap " + opts.maxDecisions; break; }
        if (calls >= opts.maxCalls) { stopped = "call budget of " + opts.maxCalls + " spent"; break; }
        if (round - 1 - lastPeakRound >= opts.stopAfter) { stopped = "no new peak for " + opts.stopAfter + " rounds"; break; }
        if (opts.target_lap_s != null && peakNode.lap_s <= opts.target_lap_s) { stopped = "target lap " + opts.target_lap_s + " s reached"; break; }
        if (overDeadline()) { stopped = "stopped at the time limit after " + (round - 1 - round0) + (round - 1 - round0 === 1 ? " round" : " rounds"); break; }
        const n = Math.min(K, opts.maxCalls - calls, opts.maxDecisions - k1 + 1);
        const t0 = now();
        const headNode = tree.get(tree.head), head = designOf(tree.head);
        const headSummary = { lap_s: headNode.lap_s, gap_to_pole_s: headNode.lap_s - POLE, mass_kg: headNode.mass_kg, front_share: headNode.front_share };
        const branch = tree.branch, branchDecs = decisions.filter(d => d.branch === branch.id);
        const foci = scen.focusFor(round, n, K);
        emit("round", { round, ideas: n, of: K, head: headNode.id, head_lap_s: headNode.lap_s, focus: foci, first_decision: k1 });
        const slots = foci.map((focus, i) => {
          const k = k1 + i;
          const sc = scen.fit({ head, headSummary, tree, decisions: branchDecs, focus, limits: opts.scenarioLimits, corrections: opts.corrections ? { decisions, limits: opts.correctionsLimits } : null });
          const dec = { decision: k, round, slot: i + 1, of: n, focus, branch: branch.id, head: headNode.id, head_lap_s: headNode.lap_s, session_id: sessionId, scenario: sc.text, scenario_chars: sc.chars, scenario_tokens: sc.tokens, trained: !!opts.trained, by: null, t0 };
          return { k, sc, dec };
        });
        if (opts.pace_ms) await sleep(opts.pace_ms);
        // ---- 1. K designer calls at once (the identical frozen task; only the focus line of the user message differs)
        const metaOf = s => ({ sessionId, trained: !!opts.trained, gen: s.k, round, slot: s.dec.slot });
        const reqs = await Promise.all(slots.map(s => (opts.preview ? opts.preview(s.sc.text, metaOf(s)) : null)));
        const tc = now();
        const asked = await Promise.all(slots.map((s, i) => ask(s.k, s.sc, s.dec, head, metaOf(s), { request: reqs[i] })));
        const askMs = now() - tc;
        const live = slots.map((s, i) => Object.assign(s, asked[i])).filter(s => !s.stop);
        if (!live.length) { stopped = "call budget spent"; break; }
        if (live.length < slots.length) stopped = "call budget spent";
        // ---- 2-5. test every idea from the same head car
        for (const s of live) {
          s.t = await testIdea(s.k, s.dec, s.changes, headNode, head);
          emit("tested", Object.assign({ decision: s.k, versions: s.dec.screen.distinct, physics_laps: s.dec.physics_laps, best_d_s: s.dec.best_d_s, legal: !!s.t.resultNode }, extra(s.dec)));
        }
        // ---- 6. the round's fastest legal car is kept if it beats the head (one tree step per round)
        let win = null; for (const s of live) { const r = s.t.resultNode; if (r && r.legal && (!win || r.lap_s < win.t.resultNode.lap_s - 1e-12)) win = s; }
        const faster = !!win && win.t.resultNode.lap_s < headNode.lap_s - EPS;
        const parts = Array.from(new Set((faster ? win.changes : live.reduce((a, s) => a.concat(s.changes), [])).map(c => c.part)));
        const out = tree.decide(win ? win.t.resultNode : { legal: false }, { decision: win ? win.k : live[live.length - 1].k, parts });
        if (out.kept) { stats.kept++; stats.kept_by[win.dec.by]++; stats.gain_s[win.dec.by] = r3(stats.gain_s[win.dec.by] - out.d_head_s); }
        if (out.new_peak) { lastPeakAt = win.k; lastPeakRound = round; }
        if (out.reverted) { if (out.reverted.kind === "fork") stats.forks++; else stats.reverts++; }
        stats.rounds = (stats.rounds || 0) + 1;
        const winAt = out.kept ? live.indexOf(win) : -1, last = live[live.length - 1], tEnd = now();
        live.forEach((s, i) => {
          const dec = s.dec, after = winAt >= 0 && i >= winAt;
          dec.found_faster = typeof dec.best_d_s === "number" && dec.best_d_s < -FASTER_S;
          dec.round_best = s === win;
          dec.kept = s === win && out.kept; dec.new_peak = s === win && out.new_peak; dec.d_head_s = s === win ? out.d_head_s : dec.best_d_s;
          // rows before the round's kept car still show the head / peak the round started from
          dec.head_after = after || (s === last && out.reverted) ? out.head : out.head_before; dec.peak_after = after ? out.peak : out.peak_before;
          if (s === last && out.reverted) dec.reverted = out.reverted;
          expectedHit(dec);
          dec.ms = tEnd - dec.t0; delete dec.t0;
          decisions.push(dec);
        });
        for (const s of live) decisionEvent(s.dec, out, (out.kept && s === win) || (s === last && !!out.reverted), s.dec.peak_after);
        if (out.reverted) emit("revert", Object.assign({ decision: last.k, round }, out.reverted));
        const roundMs = now() - t0;
        stepMs.push(roundMs);
        emit("round_done", { round, ideas: live.length, kept: out.kept, new_peak: out.new_peak, d_head_s: out.kept ? out.d_head_s : null, winner: out.kept ? win.k : null, winner_slot: out.kept ? win.dec.slot : null, found_faster: live.filter(s => s.dec.found_faster).length, versions: live.reduce((a, s) => a + (s.dec.screen ? s.dec.screen.distinct : 0), 0), physics_laps: live.reduce((a, s) => a + (s.dec.physics_laps || 0), 0), ask_ms: askMs, ms: roundMs, peak: { node: tree.peak, lap_s: tree.get(tree.peak).lap_s, gap_to_pole_s: r3(tree.get(tree.peak).lap_s - POLE) }, head: tree.head, calls, stats: statsView(stats, tree, calls) });
        if (stopped) break;
      }
    }
  } finally {
    if (ownPool) await pool.close();
    if (ownScreen) await screenPool.close();
  }
  const peak = tree.get(tree.peak);
  const result = { run_id: runId, session_id: sessionId, label: LABEL, kept_rule: KEPT_RULE, stopped, calls, decisions, tree, stats: statsView(stats, tree, calls), baseline: { lap_s: rootNode.lap_s, sectors_s: rootNode.sectors_s }, peak: { node: peak.id, lap_s: peak.lap_s, sectors_s: peak.sectors_s, gap_to_pole_s: r3(peak.lap_s - POLE), d_baseline_s: r3(peak.lap_s - rootNode.lap_s), params: peak.params }, pole_s: POLE, prompt_version: P.DESIGNER_PROMPT_VERSION, trained: !!opts.trained };
  result.state = snapshot(result, stats);
  emit("done", { summary: summaryOf(result) });
  return result;
}

function statsView(s, tree, calls) {
  const directed = (s.gain_s.mubit || 0) + (s.gain_s.mock || 0), all = directed + (s.gain_s.engine || 0);
  return Object.assign({
    decisions: s.by.mubit + s.by.mock + s.by.engine, calls, by: Object.assign({}, s.by), kept: s.kept, kept_by: Object.assign({}, s.kept_by), gain_s: Object.assign({}, s.gain_s),
    directed_gain_share: all > 0 ? +(directed / all).toFixed(3) : null,
    cars_measured: tree.nodes.length - 1, variants_generated: s.variants_generated, variants_screened: s.variants_screened, screen_ms: s.screen_ms,
    variants_per_s: s.screen_ms > 0 ? Math.round(s.variants_screened / s.screen_ms * 1000) : null,
    physics_laps: s.physics_laps, physics_ms: s.physics_ms, laps_per_s: s.physics_ms > 0 ? +(s.physics_laps / s.physics_ms * 1000).toFixed(1) : null,
    reverts: s.reverts, forks: s.forks, proposal_illegal: s.proposal_illegal, projected: s.projected, expected_hit: s.expected_hit, expected_n: s.expected_n,
    branches: tree.branches.length, llm_ms: s.llm_ms,
  }, s.rounds ? { rounds: s.rounds } : {});
}
// the decision as the stream, the UI cards and the replay show it (no designs, no bench internals)
function compactDecision(d) {
  return Object.assign({
    decision: d.decision, branch: d.branch, head: d.head, head_lap_s: d.head_lap_s, by: d.by, fallback_reason: d.fallback_reason || null,
    mubit_request_id: d.call ? d.call.mubit_request_id : null, trained: d.trained, mock: !!(d.call && d.call.mock), latency_ms: d.call ? d.call.latency_ms : null,
    hypothesis: d.hypothesis || null, expected: d.expected || null, expected_hit: d.expected_hit == null ? null : d.expected_hit,
    proposal_change: d.proposal_change, as_proposed: d.as_proposed, projection: d.projection || null,
    subspace: d.subspace, screen: d.screen, physics_laps: d.physics_laps, physics_ms: d.physics_ms, laps_per_s: d.laps_per_s,
    result: d.result, best_change: d.best_change, best_d_s: d.best_d_s, interaction: d.interaction, moves: d.moves || null,
    kept: d.kept, new_peak: d.new_peak, d_head_s: d.d_head_s, head_after: d.head_after, peak_after: d.peak_after, reverted: d.reverted || null,
    scenario_chars: d.scenario_chars, scenario_tokens: d.scenario_tokens, ms: d.ms,
  }, d.illegal_params ? { illegal_params: d.illegal_params } : {}, d.round != null ? { round: d.round, slot: d.slot, of: d.of, focus: d.focus, found_faster: !!d.found_faster, round_best: !!d.round_best } : {});
}
// a resumable state: the tree, the decisions (without their scenario text) and the counters
function snapshot(res, stats) {
  return { v: 1, run_id: res.run_id, tree: res.tree.toJSON(), decisions: res.decisions.map(d => Object.assign({}, d, { scenario: undefined, response_text: undefined })), calls: res.calls, stats: JSON.parse(JSON.stringify(stats)) };
}
function summaryOf(r) {
  return { run_id: r.run_id, stopped: r.stopped, calls: r.calls, decisions: r.decisions.length, trained: r.trained, baseline_lap_s: r.baseline.lap_s, peak_lap_s: r.peak.lap_s, d_baseline_s: r.peak.d_baseline_s, gap_to_pole_s: r.peak.gap_to_pole_s, stats: r.stats, request_ids: r.decisions.map(d => d.call ? d.call.mubit_request_id : null), label: r.label, kept_rule: r.kept_rule };
}

module.exports = { LABEL, KEPT_RULE, ROUND_RULE, MAX_IDEAS, FASTER_S, DEFAULTS, runEngineer, compactDecision, summaryOf, project, groupsOf, violations };
