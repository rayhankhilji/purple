// PURPLE DESIGNER EXAM (concept/exam/): the questions are the engine's own task input and deterministic, the grader is
// deterministic for any worker count, an unparseable answer is never kept, column A is legal and seeded, column B goes through
// server/mubit.js UNTRAINED (x-middleware-record: metadata, frozen designer task) with ≤ 2 calls in flight, and the answers-file
// formats of column C parse. The HTTP server here is a loopback stand-in on 127.0.0.1; Mubit is never called.
process.env.MUBIT_API_KEY = "mbt_loopback_test_key_never_sent_anywhere";   // set before server/mubit.js builds its client
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http"), fs = require("fs"), path = require("path");
const Q = require("../concept/exam/questions.js"), G = require("../concept/exam/grade.js"), R = require("../concept/exam/run.js");
const prompt = require("../concept/designer/prompt.js"), schema = require("../concept/designer/schema.js"), engine = require("../concept/engineer/engine.js");
const design = require("../concept/design.js");

const doc = Q.load();
const strip = g => { const o = JSON.parse(JSON.stringify(g)); delete o.ms; return o; };

test("questions: 30 held-out states, distinct, interleaved phases, seeds never used by a recorded run, each text verbatim the engine's", async () => {
  assert.equal(doc.questions.length, 30);
  assert.equal(new Set(doc.questions.map(q => q.text_sha256)).size, 30);
  assert.deepEqual(doc.questions.slice(0, 6).map(q => q.phase), ["early", "mid", "late", "early", "mid", "late"]);
  for (const q of doc.questions) {
    assert.ok(!Q.USED_SEEDS.includes(q.source.seed) && q.source.decision >= 2, q.id);
    assert.ok(q.chars <= 1800, q.id);
    const sc = JSON.parse(q.text); assert.deepEqual(Object.keys(sc), ["best", "tree", "tested", "near"]);
    assert.equal(sc.best.lap_s, Math.round(q.head.lap_s * 1000) / 1000, q.id + ": the head car is the scenario's best");
  }
  // the recorded runs' seeds really are not exam seeds
  const used = new Set();
  const dir = path.join(__dirname, "..", "docs", "concept", "loop-runs");
  for (const d of fs.readdirSync(dir)) { const m = /seed(\d+)$/.exec(d); if (m) used.add(+m[1]); }
  for (const s of Q.SEEDS) assert.ok(!used.has(s), "seed " + s + " has a recorded run");
  assert.equal(doc.task.task_key_sha256, prompt.taskKeySha256());
  // regenerate q01 (seed 101, decision 2) with the engine: same text byte for byte, and twice the same
  const q = doc.questions[0];
  const a = await Q.snapshots(q.source.seed, { run: { maxDecisions: q.source.decision } }), b = await Q.snapshots(q.source.seed, { run: { maxDecisions: q.source.decision } });
  const sa = a.snaps.find(s => s.k === q.source.decision), sb = b.snaps.find(s => s.k === q.source.decision);
  assert.equal(sa.text, q.text); assert.equal(sb.text, q.text);
  assert.deepEqual(sa.head.params, q.head.params); assert.equal(sa.head.lap_s, q.head.lap_s);
});

test("grader: deterministic for 0 and 2 workers; unparseable is never kept and runs no engine; random column is legal and seeded", async () => {
  const q = doc.questions[1];
  const r1 = R.randomProposal(q), r2 = R.randomProposal(q);
  assert.equal(r1.text, r2.text);
  const v = schema.validate(r1.text); assert.ok(v.ok);
  assert.deepEqual(engine.violations(design.applyChanges({ params: q.head.params, team: q.team }, v.value.changes).design), []);
  const P0 = G.pools(0), P2 = G.pools(2);
  try {
    const g0 = await G.grade(q, r1.text, { pool: P0.pool, screenPool: P0.screenPool }), g2 = await G.grade(q, r1.text, { pool: P2.pool, screenPool: P2.screenPool });
    assert.deepEqual(strip(g0), strip(g2));
    assert.equal(g0.parsed, true); assert.equal(g0.legal, true); assert.equal(g0.direct.from, "as_proposed");
    assert.ok(Math.abs(g0.head_lap_s - q.head.lap_s) < 5e-4);
    for (const k of ["direct", "engine"]) { const c = g0[k]; assert.equal(typeof c.kept, "boolean"); assert.equal(c.kept ? c.gain_s > 0 : c.gain_s === 0, true); }
    assert.ok(g0.engine.screened > 100 && g0.engine.physics_laps > 0);
    // the engine column can only do at least as well as the direct one (the proposal itself is in the confirm set)
    assert.ok(g0.engine.gain_s >= g0.direct.gain_s - 1e-9);
    const bad = await G.grade(q, "Here is my proposal: {\"changes\": []}", { pool: P0.pool, screenPool: P0.screenPool });
    assert.equal(bad.parsed, false); assert.equal(bad.direct.kept, false); assert.equal(bad.engine.kept, false); assert.equal(bad.engine.screened, undefined);
    const empty = await G.grade(q, "", { pool: P0.pool, screenPool: P0.screenPool }); assert.equal(empty.parsed, false);
    const s = G.summarize([g0, bad]); assert.equal(s.N, 2); assert.match(s.line, /^kept \d\/2 \(direct\), \d\/2 \(engine\), mean gain /); assert.doesNotMatch(s.line, /%/);
  } finally { await P0.close(); await P2.close(); }
});

function loopback(delayMs) {
  const seen = []; let inFlight = 0, maxInFlight = 0;
  const srv = http.createServer((req, res) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => setTimeout(() => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(b) });
      res.writeHead(200, { "content-type": "application/json", "x-middleware-request-id": "mreq_" + String(seen.length).padStart(32, "0") });
      res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: "{\"changes\":[{\"part\":\"floor\",\"param\":\"ride_height_mm\",\"to\":33}],\"hypothesis\":\"t\",\"expected\":{\"lap_delta_s\":-1,\"sector\":2}}" }], stop_reason: "end_turn", usage: { input_tokens: 400, output_tokens: 40 } }));
      inFlight--;
    }, delayMs));
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, seen, max: () => maxInFlight, url: "http://127.0.0.1:" + srv.address().port + "/anthropic" })));
}

test("base column: server/mubit.js, untrained (x-middleware-record: metadata), the frozen designer task, ≤ 2 in flight; mock needs no network", async () => {
  const lb = await loopback(60); process.env.MUBIT_BASE_URL = lb.url;
  try {
    const qs = doc.questions.slice(0, 5);
    const b = await R.baseAnswers(qs, { mock: false, sessionId: "exam-dsg-test" });
    assert.equal(lb.seen.length, 5);
    for (const s of lb.seen) {
      assert.equal(s.url, "/anthropic/v1/messages");
      assert.equal(s.headers["x-middleware-record"], "metadata", "every exam call is untrained");
      assert.equal(s.body.system, prompt.SYSTEM_PROMPT); assert.equal(s.body.model, prompt.MODEL);
      assert.equal(s.body.max_tokens, prompt.MAX_TOKENS); assert.equal(s.body.temperature, prompt.TEMPERATURE);
      assert.equal(s.body.metadata.user_id, "exam-dsg-test");
      assert.equal(s.body.tools, undefined); assert.equal(s.body.messages.length, 1);
    }
    assert.deepEqual(lb.seen.map(s => s.body.messages[0].content).sort(), qs.map(q => q.text).sort(), "the user message is the question text verbatim");
    assert.ok(lb.max() <= 2, "at most 2 calls in flight (saw " + lb.max() + ")");
    assert.ok(b.answers.every(a => a.trained === false && /^mreq_\d{32}$/.test(a.mubit_request_id) && schema.validate(a.text).ok));
  } finally { lb.srv.close(); }
  const n0 = lb.seen.length;
  const m = await R.baseAnswers(doc.questions.slice(0, 2), { mock: true });
  assert.equal(lb.seen.length, n0, "mock sends nothing");
  assert.ok(m.mock && m.answers.every(a => a.mock && /^mreq_mock/.test(a.mubit_request_id)));
  const m2 = await R.baseAnswers(doc.questions.slice(0, 2), { mock: true });
  assert.deepEqual(m2.answers.map(a => a.text), m.answers.map(a => a.text), "the mock column is deterministic");
});

test("adapter answers: block, JSON object, JSON array and JSONL formats; export writes one pasteable line per question", () => {
  const reply = "```json\n{\"changes\":[{\"part\":\"floor\",\"param\":\"ride_height_mm\",\"to\":33}],\"hypothesis\":\"a\",\"expected\":{\"lap_delta_s\":-1,\"sector\":2}}\n```";
  const block = "# comment\n=== q01\n" + reply + "\n\n=== q2\n\n=== q03\nnot json\n";
  const a = R.parseAnswers(block);
  assert.equal(a.q01, reply); assert.equal(a.q02, ""); assert.equal(a.q03, "not json");
  assert.ok(schema.validate(a.q01).ok);
  assert.deepEqual(R.parseAnswers(JSON.stringify({ q01: reply, "2": "x" })), { q01: reply, q02: "x" });
  assert.deepEqual(R.parseAnswers(JSON.stringify([{ id: "q01", text: reply }])), { q01: reply });
  assert.deepEqual(R.parseAnswers(JSON.stringify({ id: "q01", text: "a" }) + "\n" + JSON.stringify({ id: "q04", text: "b" }) + "\n"), { q01: "a", q04: "b" });
  const e = R.exportConsole(doc, doc.questions.slice(0, 3));
  const lines = e.console.split("\n");
  for (const q of doc.questions.slice(0, 3)) assert.ok(lines.includes(q.text), q.id + " is on a line of its own, verbatim");
  assert.deepEqual(Object.keys(R.parseAnswers(e.template_txt)), ["q01", "q02", "q03"]);
  assert.doesNotMatch(e.console, /\bCFD\b|wind tunnel|validated/i);
});
