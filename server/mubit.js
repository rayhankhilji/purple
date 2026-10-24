// PURPLE - the ONE place that calls Mubit (EVAL_GUARDRAILS G-MUBIT-06). ARCHITECTURE §7.1.
// Anthropic SDK pointed at Mubit's Anthropic path. The task key (system prompt, model, max_tokens, no tools) comes from
// lab/prompt.js and is frozen. Calls that must not train carry x-middleware-record: metadata. Never log the key or full prompts.
const Anthropic = require("@anthropic-ai/sdk");
const prompt = require("../lab/prompt.js");
const DEFAULT_BASE_URL = "https://api.mubit.ai/anthropic";

class MubitError extends Error {
  constructor(message, info) { super(message); this.name = "MubitError"; Object.assign(this, info || {}); }
}
let client = null;
function getClient() {
  const apiKey = process.env.MUBIT_API_KEY;
  if (!apiKey) throw new MubitError("MUBIT_API_KEY is not set", { code: "no_key", status: 0 });
  if (!client) client = new Anthropic({ apiKey, baseURL: process.env.MUBIT_BASE_URL || DEFAULT_BASE_URL, maxRetries: 0, timeout: 60000 });
  return client;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// G-MUBIT-05, process-wide: at most SLOTS calls in flight at once, whoever calls (collect at concurrency 2, a UI click, the exam).
// withSlot(fn) runs fn once a slot is free; the 429 retry inside callMubit keeps its slot. Exported for the test.
const SLOTS = 2; let inFlight = 0; const waiting = [];
function withSlot(fn) {
  const run = () => { inFlight++; return Promise.resolve().then(fn).finally(() => { inFlight--; const next = waiting.shift(); if (next) next(); }); };
  if (inFlight < SLOTS) return run();
  return new Promise((resolve, reject) => waiting.push(() => run().then(resolve, reject)));
}
const headerOf = (h, name) => (!h ? null : typeof h.get === "function" ? h.get(name) : h[name] || h[name.toLowerCase()] || null);
function wrap(e) {
  const body = e && e.error, inner = body && (body.error || body);
  return new MubitError(e && e.message || "Mubit call failed", {
    status: e && e.status || 0,
    code: (inner && (inner.code || inner.type)) || (e && e.code) || "unknown",
    requestId: headerOf(e && e.headers, "x-middleware-request-id"),
    retryAfter: headerOf(e && e.headers, "retry-after"),
  });
}
// { userContent, sessionId, trained, kind } -> { text, kind, session_id, mubit_request_id, model, input_tokens, output_tokens, latency_ms, trained, stop_reason }
async function callMubit(args) { return withSlot(() => callMubitNow(args)); }
async function callMubitNow({ userContent, sessionId, trained, kind }) {
  const params = {
    model: prompt.MODEL, max_tokens: prompt.MAX_TOKENS, temperature: prompt.TEMPERATURE,
    system: prompt.SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    metadata: { user_id: sessionId },
  };
  const headers = trained ? {} : { "x-middleware-record": "metadata" };
  const attempt = () => getClient().messages.create(params, { headers }).withResponse();
  const t0 = Date.now();
  let res;
  try { res = await attempt(); }
  catch (e) {
    const w = wrap(e);
    if (w.status !== 429) throw w;
    // starter_credit_busy: honour retry-after, retry once (G-MUBIT-05)
    await sleep(Math.min(30000, (parseFloat(w.retryAfter) || 2) * 1000));
    try { res = await attempt(); } catch (e2) { throw wrap(e2); }
  }
  const { data, response } = res;
  const latency_ms = Date.now() - t0;
  const mubit_request_id = headerOf(response && response.headers, "x-middleware-request-id") || data._request_id || null;
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return {
    text, kind, session_id: sessionId, mubit_request_id, model: data.model || prompt.MODEL,
    input_tokens: data.usage && data.usage.input_tokens, output_tokens: data.usage && data.usage.output_tokens,
    latency_ms, trained: !!trained, stop_reason: data.stop_reason,
  };
}
module.exports = { callMubit, MubitError, DEFAULT_BASE_URL, withSlot, SLOTS, inFlight: () => inFlight };
