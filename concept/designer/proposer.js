// PURPLE CONCEPT DESIGNER - an LLM proposer for the concept optimiser (concept/optimize.js proposer contract):
//   llmProposer(opts) -> { name, propose(history, design, ctx) -> Promise<Proposal>, annotate(row), notes, calls, stats() }
// Each generation it builds the compact scenario (scenario.js), calls the injected `llm(scenarioText, { sessionId, trained })`
// (a mock in tests and the CLI; the real one will wrap server/mubit.js callMubit, see docs/concept/DESIGNER.md), validates the
// answer (schema.js) and returns ONE proposal. The bench measures it and the optimiser keeps it only on the numbers
// (legal && score_after > score_before); the LLM never decides a verdict.
// Loop guards:
//   - never re-propose an already tested design: every design the proposer hands over (and every parent) is remembered by its
//     canonical parameter string; a proposal that lands on one is refused as `duplicate` (a no-op proposal is a duplicate of the parent);
//   - an illegal proposal (concept/regs.js on the applied design) is refused before the bench, with its articles;
//   - parse error / illegal / duplicate / llm error -> the deterministic fallback (one seeded design.mutate step, itself kept off
//     tested and illegal designs for up to `fallbackTries` draws);
//   - `maxConsecutiveFailures` failures in a row pause the LLM for `cooldown` generations; `maxCalls` caps the LLM calls of a run;
//   - trained:true is refused while the designer prompt is a DRAFT (G-MUBIT-01 discipline: train only on a frozen prompt).
// Every generation gets a note; annotate(row) (wired by runDesigner as onGeneration) writes it into the lineage row:
//   row.proposer = "llm" | "fallback", row.designer = { proposer, reason, session_id, refused, expected, expected_hit, ... }.
// Dual browser / Node: window.EI.concept.designer and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const parts = req("parts", "../parts.js"), design = req("design", "../design.js"), regs = req("regs", "../regs.js"), optimize = req("optimize", "../optimize.js");
  const scenario = req("designerScenario", "./scenario.js"), schema = req("designerSchema", "./schema.js"), prompt = req("designerPrompt", "./prompt.js");

  const DEFAULTS = { trained: false, runId: "run", maxConsecutiveFailures: 3, cooldown: 5, maxCalls: Infinity, fallbackTries: 8, circuit: "silverstone", name: "llm-designer" };

  // canonical parameter string of a design (PARAMS order) and a short FNV-1a hash of it for the lineage
  const canon = d => parts.PARAMS.map(s => +(+d.params[s.part][s.param]).toFixed(6)).join(",");
  function hashOf(d) {
    const str = canon(d); let h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0; }
    return ("0000000" + h1.toString(16)).slice(-8) + ("0000000" + h2.toString(16)).slice(-8);
  }
  const articlesOf = viol => Array.from(new Set(viol.map(v => scenario.shortArticle(v.article))));
  const lapSign = dlap => (dlap > 0.0005 ? 1 : dlap < -0.0005 ? -1 : 0);
  function biggestSector(before, after) {
    if (!before || !after) return null;
    let best = 0, k = null; for (let i = 0; i < 3; i++) { const d = Math.abs(after[i] - before[i]); if (d > best + 1e-12) { best = d; k = i + 1; } }
    return k;
  }

  function llmProposer(opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    if (typeof opts.llm !== "function") throw new Error("designer: opts.llm(scenarioText, { sessionId, trained }) -> text is required");
    const P = opts.prompt || prompt;
    if (opts.trained && P.DRAFT) throw new Error("designer: trained calls are refused while the designer prompt is a DRAFT (version " + P.DESIGNER_PROMPT_VERSION + "); freeze it first (docs/concept/DESIGNER.md)");
    const sessionIdOf = opts.sessionId || (gen => "dsg-" + opts.runId + "-g" + gen);
    const seen = new Set(), notes = new Map(), calls = [], refused = [];
    let consecutive = 0, pausedUntil = 0, nCalls = 0;

    function fallback(d, ctx, note) {
      let pick = null, clean = false, tries = 0;
      while (tries < opts.fallbackTries) {
        tries++;
        const m = design.mutate(d, ctx.rng, ctx.sigma);
        if (!m.changes.length) continue;
        pick = m;
        if (!seen.has(canon(m.design)) && regs.check(m.design).length === 0) { clean = true; break; }
      }
      // no legal untested draw: settle for any untested draw (the bench measures it for legality only), up to 4× more draws
      while (!clean && tries < 5 * opts.fallbackTries) {
        tries++;
        const m = design.mutate(d, ctx.rng, ctx.sigma);
        if (m.changes.length && !seen.has(canon(m.design))) { pick = m; break; }
      }
      if (!pick) pick = design.mutate(d, ctx.rng, ctx.sigma);
      note.proposer = "fallback"; note.fallback_tries = tries;
      if (!clean) note.fallback_exhausted = true;   // no legal untested draw found; the bench still measures and decides
      seen.add(canon(pick.design)); note.design_hash = hashOf(pick.design);
      return { changes: pick.changes.map(c => ({ part: c.part, param: c.param, to: c.to })) };
    }
    function failed(note, reason, detail, gen) {
      note.reason = reason; if (detail) note.detail = String(detail).slice(0, 200);
      consecutive++;
      if (consecutive >= opts.maxConsecutiveFailures) { pausedUntil = gen + opts.cooldown + 1; consecutive = 0; note.paused_llm_until_gen = pausedUntil; }
    }

    async function propose(history, d, ctx) {
      const gen = ctx.gen, note = { gen, proposer: null, reason: null };
      notes.set(gen, note);
      seen.add(canon(d));
      const parentSum = ctx.parent && ctx.parent.summary;
      note.parent_sectors = parentSum && parentSum.circuits && parentSum.circuits[opts.circuit] ? parentSum.circuits[opts.circuit].sectors_s : null;
      if (gen < pausedUntil) { note.reason = "llm_paused"; return fallback(d, ctx, note); }
      if (nCalls >= opts.maxCalls) { note.reason = "llm_budget"; return fallback(d, ctx, note); }

      const sc = scenario.fit({ design: d, summary: parentSum, history, refused: refused.filter(r => r.change), limits: opts.scenarioLimits });
      const sessionId = sessionIdOf(gen);
      note.session_id = sessionId; note.scenario_chars = sc.chars; note.scenario_tokens = sc.tokens; note.trained = !!opts.trained;
      const call = { gen, session_id: sessionId, trained: !!opts.trained, prompt_version: P.DESIGNER_PROMPT_VERSION, scenario_chars: sc.chars, scenario_tokens: sc.tokens, dropped: sc.dropped, ok: false, reason: null };
      calls.push(call); nCalls++;
      let text;
      try { text = await opts.llm(sc.text, { sessionId, trained: !!opts.trained, gen }); }
      catch (e) { call.reason = "llm_error"; failed(note, "llm_error", e && e.message || e, gen); return fallback(d, ctx, note); }
      if (text && typeof text === "object" && typeof text.text === "string") { call.mubit_request_id = text.mubit_request_id || null; text = text.text; }

      const v = schema.validate(text);
      if (!v.ok) { call.reason = "parse"; failed(note, "parse", v.error, gen); return fallback(d, ctx, note); }
      const applied = design.applyChanges(d, v.value.changes);
      const change = scenario.describeChanges(v.value.changes.map(c => ({ part: c.part, param: c.param, from: d.params[c.part][c.param], to: c.to })));
      if (!applied.changes.length || seen.has(canon(applied.design))) {
        call.reason = "duplicate"; refused.push({ gen, change, why: "duplicate (already tested)" });
        failed(note, "duplicate", change, gen); note.refused = refused[refused.length - 1]; return fallback(d, ctx, note);
      }
      const viol = regs.check(applied.design);
      if (viol.length) {
        const arts = articlesOf(viol);
        call.reason = "illegal"; refused.push({ gen, change, why: "illegal " + arts.join(" ") });
        failed(note, "illegal", arts.join(" "), gen); note.refused = refused[refused.length - 1]; return fallback(d, ctx, note);
      }
      // accepted for measurement
      consecutive = 0; call.ok = true;
      seen.add(canon(applied.design));
      note.proposer = "llm"; note.design_hash = hashOf(applied.design); note.expected = v.value.expected;
      if (v.clamped) note.clamped = v.clamped;
      if (v.trimmed) note.trimmed = v.trimmed;
      if (v.normalised) note.normalised = v.normalised;
      return { changes: v.value.changes.map(c => ({ part: c.part, param: c.param, to: c.to })), hypothesis: v.value.hypothesis };
    }

    // write the generation's note into its lineage row (call from optimize's onGeneration; runDesigner does)
    function annotate(row) {
      const note = row && notes.get(row.gen); if (!note) return row;
      const out = Object.assign({}, note); delete out.parent_sectors;
      if (note.proposer === "llm" && note.expected && row.legal && row.delta_score != null) {
        const got = lapSign(-row.delta_score);
        const after = row.result && row.result.circuits && row.result.circuits[opts.circuit] ? row.result.circuits[opts.circuit].sectors_s : null;
        out.measured = { lap_delta_sign: got, sector: biggestSector(note.parent_sectors, after) };
        out.expected_hit = { sign: got === note.expected.lap_delta_s, sector: out.measured.sector === note.expected.sector };
      }
      if (note.clamped) for (const c of row.changes || []) if (note.clamped.includes(c.part + "." + c.param)) c.clamped = true;
      row.proposer = note.proposer; row.designer = out;
      return row;
    }
    function stats() {
      const by = {}; for (const n of notes.values()) if (n.reason) by[n.reason] = (by[n.reason] || 0) + 1;
      const list = Array.from(notes.values());
      return { generations: list.length, llm_calls: nCalls, llm_accepted: list.filter(n => n.proposer === "llm").length, fallback: list.filter(n => n.proposer === "fallback").length, reasons: by, designs_seen: seen.size };
    }
    return { name: opts.name, propose, annotate, notes, calls, refused, stats, seen };
  }

  // runDesigner(opts) -> optimizeAsync result + { calls, designer: stats }. opts: optimize options (gens, seed, sigma, bench, start,
  // until, patience, onGeneration) + designer: llmProposer options (llm, trained, runId, ...). One proposal per generation.
  async function runDesigner(opts) {
    const p = llmProposer(Object.assign({ runId: "seed" + (opts.seed == null ? 1 : opts.seed) }, opts.designer || {}));
    const user = opts.onGeneration;
    const res = await optimize.optimizeAsync(Object.assign({}, opts, { proposer: p, lambda: 1, designer: undefined, onGeneration(row) { p.annotate(row); if (user) user(row); } }));
    res.calls = p.calls; res.designer = p.stats(); res.prompt_version = (opts.designer && opts.designer.prompt || prompt).DESIGNER_PROMPT_VERSION;
    return res;
  }

  const api = { DEFAULTS, canon, hashOf, llmProposer, runDesigner };
  C.designer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
