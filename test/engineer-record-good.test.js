// PURPLE ENGINE v2 - record_good on the engine route (POST /api/concept/engine/run { mode: "engineer", llm: "live", record_good: true })
// with a stub Mubit (no network): every designer call is untrained (so server/mubit.js sends x-middleware-record: metadata); a
// decision whose proposal as proposed is legal and faster on physics is re-sent ONCE as a trained call with the identical user
// content and session; a rejected one (illegal) is never trained; the SSE stream carries "training_example"; the guards hold.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const mubit = require("../server/mubit.js"), designerPrompt = require("../concept/designer/prompt.js");
const recordGood = require("../concept/engineer/record-good.js");

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-recgood-test-"));
const answer = (changes, hyp) => JSON.stringify({ changes, hypothesis: hyp || "test", expected: { lap_delta_s: -0.1, sector: 2 } });
const GOOD = answer([{ part: "rear_wing", param: "aoa_deg", to: 18 }], "less rear wing: less drag on the long straights");
const BAD = answer([{ part: "floor", param: "ride_height_mm", to: 20 }], "much lower floor for more load");

test("record_good helper: approved = the model's own proposal, as proposed, legal and faster", () => {
  const row = (by, legal, d) => ({ by, as_proposed: { legal, d_lap_s: d } });
  assert.equal(recordGood.approved(row("mubit", true, -0.03)), true);
  assert.equal(recordGood.approved(row("mubit", true, 0.12)), false, "slower");
  assert.equal(recordGood.approved(row("mubit", true, -0.0001)), false, "within noise");
  assert.equal(recordGood.approved(row("mubit", false, null)), false, "illegal");
  assert.equal(recordGood.approved(row("engine", true, -0.2)), false, "the engine's own fallback step is not the model's");
  assert.equal(recordGood.approved(null), false);
});

test("route record_good (stub Mubit): approved decision -> exactly one extra trained call, same userContent; rejected -> none; untrained calls carry the metadata header", async () => {
  const { createApp } = require("../server/app.js");
  const seen = [];
  const fake = { callMubit: async q => {
    seen.push(q);
    const designerCalls = seen.filter(x => !x.trained).length;
    const text = q.trained ? (seen.find(x => !x.trained && x.userContent === q.userContent) ? (designerCalls === 1 ? GOOD : BAD) : "?") : designerCalls === 1 ? GOOD : BAD;
    return { text, mubit_request_id: "mreq_" + String(seen.length).padStart(32, "a"), served_by: "provider", model: "claude-haiku-4-5", input_tokens: 600, output_tokens: 80, latency_ms: 2, trained: !!q.trained };
  } };
  const dataDir = tmp();
  const a = createApp({ dataDir, mubit: require("./mocks/mubit.js"), conceptMubit: fake, log: () => {}, engineWorkers: 0, engineTmpDir: tmp("purple-recgood-runs-") });
  const H = { "content-type": "application/json", host: "127.0.0.1:8787" };
  const post = async b => { const r = await a.app.request("/api/concept/engine/run", { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };
  const base = { mode: "engineer", llm: "live", record_good: true, seed: 3, max_calls: 2, max_decisions: 2, variants: 200, confirm_k: 4, explore: 0, workers: 0 };
  // guards: record_good makes trained calls, so it needs live + confirm + typed text, and excludes trained: true
  assert.match((await post(Object.assign({}, base, { llm: "mock" }))).j.error.message, /live/);
  assert.match((await post(base)).j.error.message, /confirm must be "trained"/);
  assert.match((await post(Object.assign({}, base, { confirm: "trained", confirm_text: "TRAIN 3" }))).j.error.message, /TRAIN 2/);
  assert.match((await post(Object.assign({}, base, { confirm: "trained", confirm_text: "TRAIN 2", trained: true }))).j.error.message, /exclude/);
  assert.match((await post(Object.assign({}, base, { record_good: "yes" }))).j.error.message, /record_good must be a boolean/);
  assert.equal(seen.length, 0, "no call before a run is accepted");

  const r = await post(Object.assign({}, base, { confirm: "trained", confirm_text: "TRAIN 2" }));
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.data.record_good, true); assert.equal(r.j.data.trained, false);
  const t = await (await a.app.request(r.j.data.stream, { headers: H })).text();
  const evs = t.split("\n\n").filter(Boolean).map(b => ({ event: (/^event: (.*)$/m.exec(b) || [])[1], data: (/^data: (.*)$/m.exec(b) || [])[1] })).filter(x => x.event && x.data && x.event !== "ping").map(x => ({ event: x.event, data: JSON.parse(x.data) }));
  const decisions = evs.filter(e => e.event === "decision").map(e => e.data);
  assert.equal(decisions.length, 2, evs.map(e => e.event).join(","));
  const [d1, d2] = decisions.map(d => d.row);
  assert.equal(d1.by, "mubit"); assert.equal(d1.as_proposed.legal, true, JSON.stringify(d1.as_proposed)); assert.ok(d1.as_proposed.d_lap_s < -0.0005, "decision 1 is faster as proposed: " + d1.as_proposed.d_lap_s);
  assert.equal(d2.by, "mubit"); assert.equal(recordGood.approved(d2), false, "decision 2 is rejected by physics: " + JSON.stringify(d2.as_proposed));
  assert.equal(decisions[0].training_example, "pending"); assert.equal(decisions[1].training_example, "not trained");

  // exactly 3 calls: 2 untrained designer calls + 1 trained re-send of decision 1, with the identical request
  assert.equal(seen.length, 3, seen.map(q => q.trained).join(","));
  const untrained = seen.filter(q => !q.trained), trained = seen.filter(q => q.trained);
  assert.equal(untrained.length, 2); assert.equal(trained.length, 1);
  assert.equal(trained[0].userContent, untrained[0].userContent, "same user content as the approved decision's call");
  assert.notEqual(trained[0].userContent, untrained[1].userContent);
  assert.equal(trained[0].sessionId, untrained[0].sessionId); assert.equal(trained[0].task, designerPrompt); assert.equal(trained[0].kind, "design");
  assert.ok(seen.indexOf(trained[0]) === 1, "the re-send finished before the next designer call (one call in flight)");
  // what server/mubit.js would send: untrained -> x-middleware-record: metadata; the trained re-send -> no such header
  for (const q of untrained) assert.equal(mubit.buildRequest(q).headers["x-middleware-record"], "metadata");
  assert.equal(mubit.buildRequest(trained[0]).headers["x-middleware-record"], undefined);

  const ex = evs.filter(e => e.event === "training_example").map(e => e.data);
  assert.equal(ex.length, 1); assert.equal(ex[0].decision, d1.decision); assert.equal(ex[0].same_answer, true);
  assert.equal(ex[0].untrained_request_id, d1.mubit_request_id); assert.equal(ex[0].trained_request_id, "mreq_" + "2".padStart(32, "a"));
  const fin = evs.find(e => e.event === "final").data;
  assert.equal(fin.trained_examples, 1); assert.equal(fin.calls, 2);
  const rows = fs.readFileSync(path.join(r.j.data.dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 3); assert.equal(rows.filter(x => x.trained === true && x.record_good === true).length, 1, "the trained re-send is logged, so the budget counts it");
  assert.match(r.j.data.dir, /concept-engine/);
});
