// PURPLE model switcher on the engine route: POST /api/concept/engine/run { model: <concept/gp/entrants.json id>, memory }. Every
// model gets the frozen designer prompt and the engine's scenario with only the model swapped, untrained; the default model is the
// frozen designer task itself; "no-ai" makes no Mubit call; several runs at once when the server allows it. No network: an injected
// stand-in for server/mubit.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const { createApp } = require("../server/app.js");
const designerPrompt = require("../concept/designer/prompt.js");
const mubit = require("../server/mubit.js");

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-switcher-"));
const H = { "content-type": "application/json", host: "127.0.0.1:8787" };
const sse = t => t.split("\n\n").filter(Boolean).map(b => ({ event: (/^event: (.*)$/m.exec(b) || [])[1], data: (/^data: (.*)$/m.exec(b) || [])[1] })).filter(x => x.event && x.data && x.event !== "ping").map(x => ({ event: x.event, data: JSON.parse(x.data) }));
const ANSWER = JSON.stringify({ hypothesis: "a bit more rear wing for the fast corners", changes: [{ part: "rear_wing", param: "aoa_deg", value: 22 }] });

function setup(maxRuns) {
  const seen = [];
  const fake = { callMubit: async q => { seen.push(q); const m = q.task.MODEL; return { text: ANSWER, mubit_request_id: "mreq_" + String(seen.length).padStart(32, "b"), served_by: "provider", model: m, input_tokens: 700, output_tokens: 40, latency_ms: 5, trained: !!q.trained }; } };
  const a = createApp({ dataDir: tmp(), mubit: require("./mocks/mubit.js"), conceptMubit: fake, log: () => {}, engineWorkers: 0, engineTmpDir: tmp("purple-switcher-runs-"), engineMaxRuns: maxRuns });
  const post = async b => { const r = await a.app.request("/api/concept/engine/run", { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };
  const drain = async s => sse(await (await a.app.request(s, { headers: H })).text());
  return { a, seen, post, drain };
}
const base = { mode: "engineer", llm: "live", ideas: 2, rounds: 1, seed: 5, team: "redbull", variants: 200, confirm_k: 4, explore: 0, workers: 0, memory: true };

test("model switcher: each entrant gets the frozen prompt with only the model swapped, untrained", async () => {
  const { seen, post, drain } = setup(1);
  const r = await post(Object.assign({}, base, { model: "sonnet-5-5" }));
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.data.opts.entrant.id, r.j.data.opts.entrant.car, r.j.data.opts.entrant.model, r.j.data.opts.memory], ["sonnet-5-5", "Claude Sonnet", "claude-sonnet-5-5", true]);
  const evs = await drain(r.j.data.stream);
  assert.equal(evs.filter(e => e.event === "decision").length, 2);
  assert.equal(seen.length, 2);
  for (const q of seen) {
    assert.equal(q.trained, false);
    const p = mubit.buildRequest(q);
    assert.equal(p.params.system, designerPrompt.SYSTEM_PROMPT); assert.equal(p.params.model, "claude-sonnet-5-5"); assert.equal(p.params.temperature, undefined);
    assert.equal(p.headers["x-middleware-record"], "metadata");
  }
  const d = evs.find(e => e.event === "decision").data;
  assert.ok(JSON.stringify(d).includes("\"model\":\"claude-sonnet-5-5\""), "the decision names the model that answered");
});

test("model switcher: the default entrant is the frozen designer task; others refuse training; unknown ids refused", async () => {
  const { seen, post, drain } = setup(1);
  const r = await post(Object.assign({}, base, { model: "haiku-4-5" }));
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.data.opts.entrant.default, true);
  await drain(r.j.data.stream);
  for (const q of seen) assert.equal(q.task, designerPrompt);
  assert.match((await post(Object.assign({}, base, { model: "opus-5-5", record_good: "kept" }))).j.error.message, /only for the default designer model/);
  assert.match((await post(Object.assign({}, base, { model: "gpt-9" }))).j.error.message, /model must be one of: haiku-4-5, sonnet-5-5, opus-5-5, gpt-6-luna, no-ai/);
  assert.match((await post(Object.assign({}, base, { memory: "yes" }))).j.error.message, /memory must be a boolean/);
});

test("model switcher: no-ai makes no Mubit call; ChatGPT goes through the OpenAI route", async () => {
  const { seen, post, drain } = setup(1);
  const r = await post(Object.assign({}, base, { model: "no-ai" }));
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.data.opts.entrant.control, true);
  const evs = await drain(r.j.data.stream);
  assert.equal(evs.filter(e => e.event === "decision").length, 2); assert.equal(seen.length, 0, "the control never calls Mubit");
  const g = await post(Object.assign({}, base, { model: "gpt-6-luna" }));
  assert.equal(g.status, 200, JSON.stringify(g.j)); assert.equal(g.j.data.opts.entrant.car, "ChatGPT");
  await drain(g.j.data.stream);
  assert.ok(seen.length > 0); for (const q of seen) { assert.equal(q.task.PROVIDER, "openai"); assert.equal(q.task.MODEL, "gpt-6-luna"); assert.equal(q.trained, false); }
});

test("model switcher: several runs at once when the server allows it (the live Model GP)", async () => {
  const one = setup(1), many = setup(5);
  const slow = Object.assign({}, base, { rounds: 3, pace_ms: 200 });
  const a1 = await one.post(Object.assign({}, slow, { model: "sonnet-5-5" }));
  assert.equal(a1.status, 200);
  assert.match((await one.post(Object.assign({}, slow, { model: "opus-5-5" }))).j.error.message, /already running/);
  await one.drain(a1.j.data.stream);
  const ids = ["haiku-4-5", "sonnet-5-5", "opus-5-5", "gpt-6-luna", "no-ai"];
  const rs = await Promise.all(ids.map(m => many.post(Object.assign({}, slow, { model: m }))));
  for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.j));
  const all = await Promise.all(rs.map(r => many.drain(r.j.data.stream)));
  all.forEach((evs, i) => assert.ok(evs.some(e => e.event === "final"), ids[i] + " finished"));
});
