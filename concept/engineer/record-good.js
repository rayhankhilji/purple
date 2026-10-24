// PURPLE ENGINE v2 - "record good": only physics-approved decisions become Mubit training examples. Shared by the terminal run
// (concept/engineer/cli.js --record-good) and the engine route (server/campaign-route.js, POST /run { mode: "engineer", record_good }).
// Every designer call of the run is UNTRAINED (x-middleware-record: metadata). When a decision passes the RULE below, the identical
// request (same user content, same session id, same frozen task; temperature 0, so the same answer) is sent again as a TRAINED call.
// A rejected idea is never trained: it stays an untrained correction (its measured result goes back to Claude in the next scenario).
// RULES (docs/concept/ENGINE_V2.md §9):
//   "exact" (the harvest's, and the default of recorder()): the model's proposal EXACTLY AS WRITTEN is legal and faster than the head
//           on the physics lap sim (by more than FASTER_BY_S).
//   "kept"  (the engine route's default for live runs): physics KEPT A FASTER LEGAL CAR FROM THE IDEA: the engine's best legal version
//           of the idea (as written, projected / repaired, or a screened variant of its subspace) beat the head car it started from by
//           more than FASTER_BY_S. That is what the feed card shows ("✓ kept −0.021 s"); the as-written lap stays secondary info.
// Either way the training example is the model's own answer to that scenario (the identical request re-sent), never an engine-made one;
// the engine's labelled fallback steps (by "engine") are never trained.
// Calls in flight: before() waits for every pending re-send (one call in flight per run, the sequential engine); a parallel-rounds run
// instead wraps every call of the run in its own slot limit (server/campaign-route.js) and does not call before().
// This module never calls Mubit itself: `call` is the run's caller (server/concept.js designerLlm -> server/mubit.js, G-MUBIT-06).
"use strict";

const FASTER_BY_S = 0.0005;   // "faster" = at least half a millisecond quicker than the head car, as the CLI has always used
const RULES = ["exact", "kept"];
const isNum = v => typeof v === "number" && isFinite(v);
// the decision row (concept/engineer/engine.js) -> true when the rule says this decision is a training example
function approved(row, rule) {
  if (!row || row.by !== "mubit") return false;
  if ((rule || "exact") === "kept") return isNum(row.best_d_s) && row.best_d_s < -FASTER_BY_S;
  const a = row.as_proposed;
  return !!(a && a.legal === true && isNum(a.d_lap_s) && a.d_lap_s < -FASTER_BY_S);
}

// call: (text, meta) -> Promise<{ text, mubit_request_id, served_by, model, input_tokens, output_tokens, latency_ms }>
// hooks: { onExample(example, res, meta), onError(example, err, meta) }; example = { decision, rule, d_lap_s, kept_d_s, as_written_d_s,
// untrained_request_id, trained_request_id, served_by, same_answer } | { decision, error }. o: { rule: "exact" (default) | "kept" }
function recorder(call, hooks, o) {
  hooks = hooks || {};
  const rule = (o && o.rule) || "exact";
  if (!RULES.includes(rule)) throw new Error("record_good rule must be " + RULES.map(r => '"' + r + '"').join(" or "));
  const pending = [], byId = new Map(), byGen = new Map();
  let last = null;
  return {
    rule,
    approved: row => approved(row, rule),
    // await before every designer call: a pending trained re-send finishes first (one call in flight per run)
    async before() { if (pending.length) await Promise.all(pending); },
    // after every successful designer call: remember the exact request and its answer (by request id and by decision number,
    // since a parallel round has several calls in flight)
    seen(text, meta, res) {
      const o2 = typeof res === "string" ? { text: res } : res || {};
      last = { text, meta, answer: o2.text, id: o2.mubit_request_id || null };
      if (last.id) byId.set(last.id, last);
      if (meta && meta.gen != null) byGen.set(meta.gen, last);
    },
    // after every decision: an approved one is re-sent as a trained call; returns that promise, or null
    decision(row) {
      if (!approved(row, rule)) return null;
      // the decision number first (one designer call per decision; several calls of a round are in flight at once), then the request id
      const src = byGen.get(row.decision) || (row.mubit_request_id && byId.get(row.mubit_request_id)) || (row.round == null ? last : null);
      if (!src) return null;
      if (src.id) byId.delete(src.id);
      if (src.meta && src.meta.gen != null) byGen.delete(src.meta.gen);
      if (src === last) last = null;
      const meta = Object.assign({}, src.meta, { trained: true });
      const asW = row.as_proposed && row.as_proposed.legal === true && isNum(row.as_proposed.d_lap_s) ? row.as_proposed.d_lap_s : null;
      const base = { decision: row.decision, rule, d_lap_s: rule === "kept" ? row.best_d_s : row.as_proposed.d_lap_s, kept_d_s: isNum(row.best_d_s) ? row.best_d_s : null, as_written_d_s: asW, untrained_request_id: row.mubit_request_id || src.id || null };
      if (row.round != null) Object.assign(base, { round: row.round, slot: row.slot });
      const p = Promise.resolve().then(() => call(src.text, meta)).then(r => {
        r = typeof r === "string" ? { text: r } : r || {};
        const ex = Object.assign(base, { trained_request_id: r.mubit_request_id || null, served_by: r.served_by || null, same_answer: r.text === src.answer });
        if (hooks.onExample) hooks.onExample(ex, r, meta);
        return ex;
      }, e => {
        const ex = Object.assign(base, { error: String((e && (e.code || e.message)) || e) });
        if (hooks.onError) hooks.onError(ex, e, meta);
        return ex;
      });
      pending.push(p);
      return p;
    },
    // at the end of the run: every re-send settled -> the examples (errors included, as { error })
    async drain() { return Promise.all(pending); },
  };
}

module.exports = { approved, recorder, FASTER_BY_S, RULES };
