// PURPLE - the ONE place that calls Mubit (EVAL_GUARDRAILS G-MUBIT-06). ARCHITECTURE §7.1.
// Anthropic SDK pointed at Mubit's Anthropic path. The task key (system prompt, model, max_tokens, no tools) comes from
// lab/prompt.js and is frozen. Calls that must not train carry x-middleware-record: metadata. Never log the key or full prompts.
// A second, separate task (the concept designer, concept/designer/prompt.js) passes `task`; without `task` every call is
// byte-identical to before (the research agent's frozen task; test/concept-loop.test.js pins the bytes on a loopback server).
// A DRAFT task can never make a trained call. buildRequest() is the pure request builder callMubit uses, so a dry run can print
// exactly what would be sent (docs/concept/LOOP.md).
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
// G-MUBIT-05, process-wide: at most SLOTS calls in flight at once, whoever calls (collect at concurrency 2, a UI click, the exam, an
// engine run's parallel round). 2 -> 8 on 2026-10-24 (owner: up to 100 Mubit calls in flight overall, ≤ 8 per engine run; a parallel
// round sends K ≤ 8 designer calls at once). withSlot(fn) runs fn once a slot is free; the 429 retry inside callMubit keeps its slot.
// Exported for the test.
const SLOTS = 8; let inFlight = 0; const waiting = [];
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
// { userContent, sessionId, trained, task? } -> { params (the JSON body), headers (the extra request headers; the SDK adds the key
// and its own headers) }. task = { SYSTEM_PROMPT, MODEL, MAX_TOKENS, TEMPERATURE, DRAFT? } (default: lab/prompt.js, the research task)
function buildRequest({ userContent, sessionId, trained, task }) {
  const t = task || prompt;
  if (trained && t.DRAFT) throw new MubitError("trained call refused: the task prompt is a DRAFT", { code: "draft_prompt", status: 0 });
  const params = {
    model: t.MODEL, max_tokens: t.MAX_TOKENS, temperature: t.TEMPERATURE,
    system: t.SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    metadata: { user_id: sessionId },
  };
  const headers = trained ? {} : { "x-middleware-record": "metadata" };
  return { params, headers };
}
// { userContent, sessionId, trained, kind, task? } -> { text, kind, session_id, mubit_request_id, served_by, model, input_tokens, output_tokens, latency_ms, trained, stop_reason }
async function callMubit(args) { return withSlot(() => callMubitNow(args)); }
async function callMubitNow({ userContent, sessionId, trained, kind, task }) {
  const { params, headers } = buildRequest({ userContent, sessionId, trained, task });
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
  // who answered: a provider reply carries Anthropic's own headers / ids; with a Mubit rollout running, a reply without them is the adapter's
  const served_by = headerOf(response && response.headers, "anthropic-organization-id") || /^msg_/.test(data.id || "") ? "provider" : "adapter";
  return {
    text, kind, session_id: sessionId, mubit_request_id, served_by, model: data.model || (task || prompt).MODEL,
    input_tokens: data.usage && data.usage.input_tokens, output_tokens: data.usage && data.usage.output_tokens,
    latency_ms, trained: !!trained, stop_reason: data.stop_reason,
  };
}
// dry run: the exact HTTP request the SDK would send for these arguments, caught by a stub fetch in this process. Nothing is sent
// anywhere and no key is needed; the key header is shown as "<MUBIT_API_KEY>". -> { method, url, headers, body }
async function captureRequest(args) {
  const { params, headers } = buildRequest(args);
  let cap = null;
  const stub = async (url, init) => {
    const h = {}; new Headers(init && init.headers).forEach((v, k) => { h[k] = k === "x-api-key" || k === "authorization" ? "<MUBIT_API_KEY>" : v; });
    cap = { method: (init && init.method) || "POST", url: String(url), headers: Object.fromEntries(Object.keys(h).sort().map(k => [k, h[k]])), body: init && init.body };
    return new Response(JSON.stringify({ id: "msg_dry_run", type: "message", role: "assistant", model: params.model, content: [{ type: "text", text: "" }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const dry = new Anthropic({ apiKey: "dry-run-placeholder", baseURL: process.env.MUBIT_BASE_URL || DEFAULT_BASE_URL, maxRetries: 0, timeout: 60000, fetch: stub });   // same options as getClient()
  await dry.messages.create(params, { headers });
  return cap;
}
module.exports = { callMubit, buildRequest, captureRequest, MubitError, DEFAULT_BASE_URL, withSlot, SLOTS, inFlight: () => inFlight };
