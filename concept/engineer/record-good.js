// PURPLE ENGINE v2 - "record good": only physics-approved decisions become Mubit training examples. Shared by the terminal run
// (concept/engineer/cli.js --record-good) and the engine route (server/campaign-route.js, POST /run { mode: "engineer", record_good }).
// Every designer call of the run is UNTRAINED (x-middleware-record: metadata). When a decision's proposal, exactly as the model
// proposed it, is legal and faster on the physics lap sim, the identical request (same user content, same session id, same frozen
// task; temperature 0, so the same answer) is sent again as a TRAINED call. A rejected proposal (illegal, slower, or not parsed) is
// never trained: it stays an untrained correction. One call in flight per run: before() waits for a pending re-send.
// This module never calls Mubit itself: `call` is the run's caller (server/concept.js designerLlm -> server/mubit.js, G-MUBIT-06).
"use strict";

const FASTER_BY_S = 0.0005;   // "faster" = at least half a millisecond quicker than the head car, as the CLI has always used
// the decision row (concept/engineer/engine.js) -> true when the model's own proposal, as proposed, passed physics
function approved(row) {
  const a = row && row.as_proposed;
  return !!(row && row.by === "mubit" && a && a.legal === true && typeof a.d_lap_s === "number" && a.d_lap_s < -FASTER_BY_S);
}

// call: (text, meta) -> Promise<{ text, mubit_request_id, served_by, model, input_tokens, output_tokens, latency_ms }>
// hooks: { onExample(example, res, meta), onError(example, err, meta) }; example = { decision, d_lap_s, untrained_request_id,
// trained_request_id, served_by, same_answer } | { decision, error }
function recorder(call, hooks) {
  hooks = hooks || {};
  const pending = [], byId = new Map();
  let last = null;
  return {
    approved,
    // await before every designer call: a pending trained re-send finishes first (one call in flight per run)
    async before() { if (pending.length) await Promise.all(pending); },
    // after every successful designer call: remember the exact request and its answer
    seen(text, meta, res) {
      const o = typeof res === "string" ? { text: res } : res || {};
      last = { text, meta, answer: o.text, id: o.mubit_request_id || null };
      if (last.id) byId.set(last.id, last);
    },
    // after every decision: an approved one is re-sent as a trained call; returns that promise, or null
    decision(row) {
      if (!approved(row)) return null;
      const src = (row.mubit_request_id && byId.get(row.mubit_request_id)) || last;
      if (!src) return null;
      if (src.id) byId.delete(src.id);
      if (src === last) last = null;
      const meta = Object.assign({}, src.meta, { trained: true });
      const base = { decision: row.decision, d_lap_s: row.as_proposed.d_lap_s, untrained_request_id: row.mubit_request_id || src.id || null };
      const p = Promise.resolve().then(() => call(src.text, meta)).then(o => {
        o = typeof o === "string" ? { text: o } : o || {};
        const ex = Object.assign(base, { trained_request_id: o.mubit_request_id || null, served_by: o.served_by || null, same_answer: o.text === src.answer });
        if (hooks.onExample) hooks.onExample(ex, o, meta);
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

module.exports = { approved, recorder, FASTER_BY_S };
