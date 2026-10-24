// PURPLE CONCEPT DESIGNER - the closed learning loop with Mubit (docs/concept/LOOP.md).
//   iteration k: the scenario (concept/designer/scenario.js) carries the current best car and the changes tested so far with their
//   MEASURED results (simulated Silverstone lap delta, sector deltas, kept or not, FIA articles; for the last one also the lap
//   segments that gained / lost most) -> one call through Mubit (the injected llm; server/concept.js wraps server/mubit.js) ->
//   strict schema -> regs + PhysicalCar + physics lap sim measure the proposal -> kept iff legal && score_after > score_before
//   (concept/optimize.js; numbers only) -> the measured row is appended to the lineage AND is the last `tested` row of iteration
//   k+1's scenario, i.e. the input of the next Mubit call.
// One Mubit session per run: metadata.user_id = the run id (sessionId === runId). Every lineage row carries the
// x-middleware-request-id of the call made in its iteration (row.loop.mubit_request_id) and, once the next call is made, the id
// of the call whose input carried its result (row.loop.fed_to). That chain is the proof that the result went back to Mubit.
// runLoop(opts) -> { run_id, session_id, lineage, calls, designer, best, best_result, baseline_result, ... }
// opts: { iterations = 10, seed = 1, runId, llm(text, { sessionId, trained, gen }) -> text | { text, mubit_request_id, ... },
//         trained = false, prompt (designer prompt module), team = "redbull" | null, bench: { circuit, sim, ... },
//         preview(text, meta) -> request (optional, may be async: the exact request that is sent, for the event stream),
//         onEvent(type, data) (request, response, proposal, result, done), pace_ms (wait before each call; UI pacing), maxCalls }
// Hybrid mode (the engine dashboard's autonomous mode, docs/concept/DASHBOARD.md; both options absent = the loop exactly as before):
//   opts.search(ctx) -> Promise<{ changes, laps, ... } | null>   ctx = { parent, changes, gen, proposer, hypothesis, benchOpts }:
//        after the proposal passes the schema and FIA checks, a short local search of physics laps around it (concept/campaign/local.js); the car it
//        returns is what the bench measures and the kept rule judges, so row.changes (and the next scenario's tested row) are the
//        REFINED change (parent -> searched car), and row.search records the proposal, the laps and the lap before / after the search.
//   opts.shouldStop({ gen, lineage, best }) -> reason | falsy   checked before every iteration's call; a reason ends the run cleanly
//        (no call is made for that iteration) with result.stopped = reason.
// mockLlm(seed): a seeded, scripted stand-in that READS the previous result (pushes a change that gained further, reverses one
// that lost). It is a test double for the closed loop, not a model; its numbers say nothing about an LLM.
// Dual browser / Node: window.EI.concept.designerLoop and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const parts = req("parts", "../parts.js"), design = req("design", "../design.js"), regs = req("regs", "../regs.js");
  const bench = req("bench", "../bench.js"), optimize = req("optimize", "../optimize.js");
  const designer = req("designer", "./proposer.js"), scenario = req("designerScenario", "./scenario.js"), prompt = req("designerPrompt", "./prompt.js");
  const segments = req("designerSegments", "./segments.js");

  const CIRCUIT = "silverstone";
  const KEPT_RULE = "kept = legal && score_after > score_before (concept/optimize.js; weekend score, monotonic in the simulated lap); the model's output has no verdict field";
  const DEFAULTS = { iterations: 10, seed: 1, trained: false, team: "redbull", pace_ms: 0 };
  const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const STOP = "__designer_loop_stop__";

  // FNV-1a hex of a string (deterministic ids for the mock)
  function fnv(str, seed) { let h = (0x811c9dc5 ^ (seed || 0)) >>> 0; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0; return ("0000000" + h.toString(16)).slice(-8); }
  // a mock request id, visibly not Mubit's (Mubit's are "mreq_" + 32 hex digits)
  const mockRequestId = (sessionId, k) => "mreq_mock" + (fnv(sessionId + "|" + k, 1) + fnv(sessionId + "|" + k, 2) + fnv(sessionId + "|" + k, 3)).slice(0, 23);

  // ---- the scripted mock (reads the previous result)
  const PLAYBOOK = [
    ["rear_wing.sm_delta_deg", 30], ["front_wing.sm_delta_deg", 20], ["floor.ride_height_mm", 30], ["floor.width_mm", 1540],
    ["rear_wing.chord_mm", 300], ["diffuser.expansion_deg", 17], ["setup.roll_front", 48], ["sidepods.undercut_mm", 140],
    ["front_wing.span_mm", 1350], ["rear_wing.span_mm", 1150], ["rear_wing.endplate_top_mm", 880], ["floor.throat_mm", 80],
    ["rear_wing.aoa_deg", 22], ["front_wing.chord_mm", 520], ["front_wing.aoa_deg", 29],
  ];
  const ILLEGAL = [["front_wing.span_mm", 1400], ["rear_wing.elements", 4], ["layout.wheelbase_mm", 3500]];
  // "a.b 1->2; c.d 3->4" -> [{ part, param, from, to }]
  function parseChange(str) {
    return String(str || "").split("; ").filter(s => s.includes("->")).map(s => { const [key, ft] = s.split(" "); const [part, param] = key.split("."); const [from, to] = ft.split("->").map(Number); return { part, param, from, to }; });
  }
  function mockLlm(seed, rates) {
    const R = Object.assign({ prose: 0.04, broken: 0.03, illegal: 0.06 }, rates || {});
    const rng = design.seededRng(((seed | 0) * 104729 + 71) >>> 0);
    const out = (changes, hypothesis, sign, sector) => JSON.stringify({ changes, hypothesis: hypothesis.slice(0, 160), expected: { lap_delta_s: sign, sector } });
    const cur = (sc, part, param) => sc.best.params[part] && sc.best.params[part][param];
    return async function llm(text) {
      const sc = JSON.parse(text), last = sc.tested[sc.tested.length - 1];
      let r = rng();
      if ((r -= R.prose) < 0) return "Here is my proposal: " + out([{ part: "floor", param: "ride_height_mm", to: 31 }], "Lower floor.", -1, 2);
      if ((r -= R.broken) < 0) return "{\"changes\": [{\"part\": \"floor\", \"param\": \"width_mm\", \"to\": 18";
      if ((r -= R.illegal) < 0) { const [key, to] = ILLEGAL[Math.floor(rng() * ILLEGAL.length)]; const [part, param] = key.split("."); return out([{ part, param, to }], "Push " + key + " past its limit for more load.", -1, 2); }
      const where = last && (last.gain || last.loss) ? " (" + [].concat(last.gain || [], last.loss || []).slice(0, 2).join(", ") + ")" : "";
      const bestSector = ds => { if (!Array.isArray(ds)) return 1 + Math.floor(rng() * 3); let k = 0; for (let i = 1; i < 3; i++) if (ds[i] < ds[k]) k = i; return k + 1; };
      if (last && last.by !== "fallback" && last.d_lap_s != null) {
        const ch = parseChange(last.change);
        if (ch.length && last.kept && last.d_lap_s < 0) {   // it gained: push the same parameters one more step the same way
          const changes = ch.map(c => ({ part: c.part, param: c.param, to: +(cur(sc, c.part, c.param) + (c.to - c.from)).toFixed(3) }));
          return out(changes, "Last change gained " + last.d_lap_s.toFixed(3) + " s" + where + "; push the same way.", -1, bestSector(last.ds));
        }
        if (ch.length && !last.kept && last.d_lap_s > 0) {   // it lost: try the opposite direction on its first parameter
          const c = ch[0], to = +(cur(sc, c.part, c.param) - (c.to - c.from)).toFixed(3);
          return out([{ part: c.part, param: c.param, to }], "Last change lost +" + last.d_lap_s.toFixed(3) + " s" + where + "; reverse " + c.part + "." + c.param + ".", -1, 1 + Math.floor(rng() * 3));
        }
      }
      // otherwise a playbook move not yet tested in this scenario, part of the way to its target
      const testedKeys = new Set(); for (const t of sc.tested) for (const c of parseChange(t.change)) testedKeys.add(c.part + "." + c.param);
      const open = PLAYBOOK.filter(([key, target]) => { const [p, k] = key.split("."); const v = cur(sc, p, k); return v != null && Math.abs(v - target) > 1e-9 && !testedKeys.has(key); });
      const pool = open.length ? open : PLAYBOOK;
      const [key, target] = pool[Math.floor(rng() * pool.length)], [part, param] = key.split("."), v = cur(sc, part, param);
      const frac = [0.25, 0.5, 1][Math.floor(rng() * 3)];
      return out([{ part, param, to: +(v + (target - v) * frac).toFixed(2) }], "New direction: move " + key + " toward " + target + (last ? "; last result " + (last.d_lap_s == null ? "illegal" : last.d_lap_s.toFixed(3) + " s") : "") + ".", -1, 1 + Math.floor(rng() * 3));
    };
  }
  // the mock as a Mubit-shaped caller: { text, mubit_request_id, ... } (no network)
  function mockCaller(seed, rates) {
    const llm = mockLlm(seed, rates); let n = 0;
    return async (text, meta) => { n++; const t = await llm(text, meta); return { text: t, mubit_request_id: mockRequestId(meta.sessionId, meta.gen), model: "mock", input_tokens: Math.ceil(text.length / 4), output_tokens: Math.ceil(t.length / 4), latency_ms: 0, trained: !!meta.trained, mock: true, n }; };
  }

  // ---- measurement helpers
  const silver = s => (s && s.circuits && s.circuits[CIRCUIT]) || null;
  const shortArt = id => scenario.articleOf(id);
  function legality(row) {
    if (row.legal) return { legal: true, articles: [] };
    const ids = []; for (const c of row.candidates || []) for (const v of c.violations || []) ids.push(v);
    const uniq = Array.from(new Set(ids));
    return { legal: false, ids: uniq, articles: Array.from(new Set(uniq.map(shortArt))), errors: (row.candidates || []).map(c => c.error).filter(Boolean) };
  }
  function measure(row, parentDesign, parentSummary, benchOpts) {
    const b = silver(parentSummary), a = silver(row.result);
    const m = { lap_before: b ? b.lap_s : null, sectors_before: b ? b.sectors_s : null, lap_after: null, sectors_after: null, d_lap_s: null, d_sectors_s: null, score_before: row.score_before, score_after: row.score_after, legality: legality(row) };
    let cand = null;
    try { cand = row.changes && row.changes.length ? design.applyChanges(parentDesign, row.changes.map(c => ({ part: c.part, param: c.param, to: c.to }))).design : null; } catch (e) { cand = null; }
    if (row.legal && a && b) {
      m.lap_after = a.lap_s; m.sectors_after = a.sectors_s;
      m.d_lap_s = r3(a.lap_s - b.lap_s); m.d_sectors_s = a.sectors_s.map((s, i) => r3(s - b.sectors_s[i]));
      if (cand && segments && (!benchOpts.sim || benchOpts.sim === "physics" || benchOpts.sim === "auto")) {
        const sb = segments.segmentTimes(parentDesign, benchOpts), sa = segments.segmentTimes(cand, benchOpts);
        if (sb && sa) { m.segments = segments.segmentDelta(sb, sa); m.moves = segments.topMoves(m.segments); }
      }
    }
    m.label = (parentSummary && parentSummary.sim_label) || bench.LABEL;
    return { m, cand };
  }

  async function runLoop(opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    if (typeof opts.llm !== "function") throw new Error("designer loop: opts.llm(text, { sessionId, trained, gen }) is required");
    if (!(Number.isInteger(opts.iterations) && opts.iterations >= 1)) throw new Error("designer loop: iterations must be a positive integer");
    const runId = opts.runId || ("loop-seed" + opts.seed), sessionId = runId, P = opts.prompt || prompt;
    const emit = (type, data) => { if (opts.onEvent) opts.onEvent(type, Object.assign({ type, run_id: runId, session_id: sessionId }, data)); };
    const benchOpts = Object.assign({ circuit: CIRCUIT }, opts.bench || {});
    const start = opts.start ? design.clone(opts.start) : design.baseline(opts.team ? { team: opts.team } : undefined);
    const startResult = bench.bench(start, benchOpts);
    let parentDesign = start, parentSummary = Object.assign(optimize.summary(startResult), { sim_label: startResult.sim_label || bench.LABEL });
    const lineage = [], callByGen = new Map(), sentByGen = new Map(), searchByGen = new Map();
    emit("start", { iterations: opts.iterations, seed: opts.seed, trained: !!opts.trained, team: start.team || null, prompt_version: P.DESIGNER_PROMPT_VERSION, draft: !!P.DRAFT, baseline: { lap_s: silver(parentSummary).lap_s, sectors_s: silver(parentSummary).sectors_s, gap_to_pole_s: parentSummary.gap_to_pole_s, score: parentSummary.score }, kept_rule: KEPT_RULE, label: parentSummary.sim_label });

    async function llm(text, meta) {
      const k = meta.gen;
      if (opts.pace_ms) await sleep(opts.pace_ms);
      const sc = JSON.parse(text);
      sentByGen.set(k, text);
      const request = opts.preview ? await opts.preview(text, meta) : null;
      emit("request", { iteration: k, trained: !!meta.trained, scenario: sc, scenario_text: text, scenario_chars: text.length, scenario_tokens: scenario.approxTokens(text), carries: sc.tested.length ? sc.tested[sc.tested.length - 1] : null, request });
      let r;
      try { r = await opts.llm(text, meta); }
      catch (e) {
        const id = (e && e.requestId) || null;
        callByGen.set(k, { mubit_request_id: id, error: String(e && (e.code || e.message) || e) });
        link(k, id);
        emit("response", { iteration: k, ok: false, mubit_request_id: id, error: String(e && (e.code || e.message) || e) });
        throw e;
      }
      const o = typeof r === "string" ? { text: r } : r;
      const call = { mubit_request_id: o.mubit_request_id || null, model: o.model || null, input_tokens: o.input_tokens == null ? null : o.input_tokens, output_tokens: o.output_tokens == null ? null : o.output_tokens, latency_ms: o.latency_ms == null ? null : o.latency_ms, trained: !!meta.trained, mock: !!o.mock };
      callByGen.set(k, call); link(k, call.mubit_request_id);
      emit("response", Object.assign({ iteration: k, ok: true, text: String(o.text).slice(0, 800) }, call));
      return o;
    }
    // the previous iteration's measured row went out in this call's input: record the link on that row
    function link(k, id) {
      const prev = lineage.find(r => r.gen === k - 1); if (!prev || !prev.loop) return;
      prev.loop.fed_to = { iteration: k, mubit_request_id: id };
      emit("link", { iteration: k - 1, fed_to: prev.loop.fed_to });
    }

    const p = designer.llmProposer(Object.assign({ llm, trained: !!opts.trained, runId, sessionId: () => sessionId, prompt: P, maxCalls: opts.maxCalls == null ? Infinity : opts.maxCalls, scenarioLimits: opts.scenarioLimits }, opts.maxConsecutiveFailures != null ? { maxConsecutiveFailures: opts.maxConsecutiveFailures } : {}));
    const proposer = {
      name: "llm-designer (loop)",
      async propose(history, d, ctx) {
        if (opts.shouldStop) {
          const why = opts.shouldStop({ gen: ctx.gen, lineage, best: silver(parentSummary) });
          if (why) { const e = new Error("designer loop stopped: " + why); e.code = STOP; e.reason = String(why); throw e; }
        }
        const raw = await p.propose(history, d, ctx), note = p.notes.get(ctx.gen) || {};
        const changes = (raw.changes || []).map(c => ({ part: c.part, param: c.param, from: d.params[c.part] ? d.params[c.part][c.param] : null, to: c.to }));
        emit("proposal", { iteration: ctx.gen, proposer: note.proposer, reason: note.reason, detail: note.detail || null, refused: note.refused || null, changes, change: scenario.describeChanges(changes), hypothesis: raw.hypothesis || null, expected: note.expected || null, clamped: note.clamped || null });
        if (opts.search && raw.changes && raw.changes.length) {
          const t0 = Date.now();
          const s = await opts.search({ parent: d, changes: raw.changes, gen: ctx.gen, proposer: note.proposer, hypothesis: raw.hypothesis || null, benchOpts });
          if (s && s.changes && s.changes.length) {
            const refined = s.changes.map(c => ({ part: c.part, param: c.param, from: d.params[c.part] ? d.params[c.part][c.param] : null, to: c.to }));
            const rec = { proposal: changes, proposal_change: scenario.describeChanges(changes), refined: refined, refined_change: scenario.describeChanges(refined), laps: s.laps, batches: s.batches, budget: s.budget, scope: s.scope, parent_lap_s: s.parent_lap_s, proposal_lap_s: s.proposal_lap_s, proposal_legal: s.proposal_legal, lap_s: s.lap_s, improved_on_proposal: !!s.improved_on_proposal, best_stage: s.best_stage || null, stages: s.stages || [], ms: Date.now() - t0, stopped: !!s.stopped };
            searchByGen.set(ctx.gen, rec);
            emit("search", Object.assign({ iteration: ctx.gen, proposer: note.proposer }, rec));
            return { changes: s.changes.map(c => ({ part: c.part, param: c.param, to: c.to })), hypothesis: raw.hypothesis };
          }
        }
        return raw;
      },
    };
    function onGeneration(row) {
      p.annotate(row);
      const { m, cand } = measure(row, parentDesign, parentSummary, benchOpts);
      row.measured = m;
      const call = callByGen.get(row.gen) || null, sent = sentByGen.get(row.gen) || null;
      row.loop = { iteration: row.gen, session_id: sessionId, mubit_request_id: call ? call.mubit_request_id : null, call, trained: !!opts.trained, scenario: sent, fed_to: null };
      row.mubit_request_id = row.loop.mubit_request_id;
      if (searchByGen.has(row.gen)) row.search = searchByGen.get(row.gen);
      if (row.kept && cand) { parentDesign = cand; parentSummary = Object.assign({}, row.result, { sim_label: parentSummary.sim_label }); }
      lineage.push(row);
      emit("result", { iteration: row.gen, row: compactRow(row), best: { lap_s: silver(parentSummary).lap_s, gap_to_pole_s: parentSummary.gap_to_pole_s, score: parentSummary.score } });
      if (opts.onRow) opts.onRow(row);
    }
    let res;
    try { res = await optimize.optimizeAsync({ gens: opts.iterations, seed: opts.seed, lambda: 1, start, bench: benchOpts, proposer, onGeneration, yield: opts.yield }); }
    catch (e) {
      if (!e || e.code !== STOP) throw e;
      // stopped between iterations: the same result shape optimize() returns, from the measured rows so far
      const bestResult = bench.bench(parentDesign, benchOpts);
      res = { best: parentDesign, best_result: bestResult, baseline: start, baseline_result: startResult, lineage, generations: lineage.length, kept: lineage.filter(r => r.kept).length, stopped: e.reason, diff: design.diff(start, parentDesign), seed: opts.seed, proposer: proposer.name, label: bench.LABEL, sim: startResult.sim, sim_label: startResult.sim_label, team: start.team || null };
    }
    const out = Object.assign(res, { run_id: runId, session_id: sessionId, lineage, calls: p.calls, designer: p.stats(), prompt_version: P.DESIGNER_PROMPT_VERSION, trained: !!opts.trained, kept_rule: KEPT_RULE });
    emit("done", { summary: summaryOf(out) });
    return out;
  }

  // the row as the stream and the UI show it (no bench internals)
  function compactRow(row) {
    const d = row.designer || {};
    return {
      iteration: row.gen, proposer: row.proposer, kept: row.kept, legal: row.legal,
      changes: (row.changes || []).map(c => ({ part: c.part, param: c.param, from: c.from, to: c.to, clamped: !!c.clamped })), change: scenario.describeChanges(row.changes), hypothesis: row.hypothesis,
      measured: row.measured, loop: Object.assign({}, row.loop, { scenario: undefined }), search: row.search || undefined,
      designer: { reason: d.reason || null, detail: d.detail || null, refused: d.refused || null, expected: d.expected || null, measured: d.measured || null, expected_hit: d.expected_hit || null },
      result: row.result ? { lap_s: row.result.lap_s, gap_to_pole_s: row.result.gap_to_pole_s, grid_position: row.result.grid_position, race_position: row.result.race_position, score: row.result.score, mass_kg: row.result.mass_kg } : null,
      score_before: row.score_before, score_after: row.score_after, delta_score: row.delta_score, label: row.label,
    };
  }
  function summaryOf(res) {
    const b = res.baseline_result, x = res.best_result, sb = b && b.circuits && b.circuits[CIRCUIT], sx = x && x.circuits && x.circuits[CIRCUIT];
    const byProposer = {}; for (const r of res.lineage) if (r.kept) byProposer[r.proposer] = (byProposer[r.proposer] || 0) + 1;
    return {
      run_id: res.run_id, session_id: res.session_id, iterations: res.generations, kept: res.kept, stopped: res.stopped || null, kept_by_proposer: byProposer, designer: res.designer, trained: res.trained,
      lap_baseline_s: sb ? sb.lap_s : null, lap_best_s: sx ? sx.lap_s : null, d_lap_s: sb && sx ? r3(sx.lap_s - sb.lap_s) : null,
      gap_to_pole_s: x && x.weekend ? x.weekend.gap_to_pole_s : null, request_ids: res.lineage.map(r => r.loop.mubit_request_id), label: x && x.sim_label || bench.LABEL, kept_rule: KEPT_RULE,
    };
  }

  const api = { DEFAULTS, KEPT_RULE, PLAYBOOK, mockLlm, mockCaller, mockRequestId, parseChange, runLoop, compactRow, summaryOf, legality };
  C.designerLoop = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
