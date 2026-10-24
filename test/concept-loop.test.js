// PURPLE CONCEPT DESIGNER - the closed loop with Mubit (docs/concept/LOOP.md): the measured result of iteration k is in the input of
// iteration k+1, kept is the simulator's call, one Mubit session per run with a request id per row, the research agent's request
// bytes are unchanged by the server/mubit.js `task` argument, untrained by default, deterministic mock runs. No network: the only
// HTTP server here is a loopback stand-in on 127.0.0.1; Mubit and Anthropic are never called.
process.env.MUBIT_API_KEY = "mbt_loopback_test_key_never_sent_anywhere";   // set before server/mubit.js builds its client
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const loop = require("../concept/designer/loop.js"), S = require("../concept/designer/scenario.js"), segments = require("../concept/designer/segments.js");
const designerPrompt = require("../concept/designer/prompt.js"), labPrompt = require("../lab/prompt.js");
const design = require("../concept/design.js"), bench = require("../concept/bench.js");
const mubit = require("../server/mubit.js");

const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === "latency_ms" || k === "ms" ? undefined : x)));
const runMock = (seed, extra) => loop.runLoop(Object.assign({ iterations: 10, seed, runId: "loop-test-seed" + seed, llm: loop.mockCaller(seed) }, extra || {}));
let cached = null; const run1 = () => (cached = cached || runMock(1));

// ---------------------------------------------------------------- (a) the result of k is in the input of k+1
test("(a) iteration k+1's request carries iteration k's exact changes and measured lap / sector deltas (and segments), linked by request id", async () => {
  const res = await run1(); assert.equal(res.lineage.length, 10);
  let checked = 0;
  for (let k = 0; k < res.lineage.length - 1; k++) {
    const row = res.lineage[k], next = res.lineage[k + 1];
    assert.ok(next.loop.scenario, "iteration " + (k + 2) + " made a call");   // the mock never pauses the LLM in this run
    const sc = JSON.parse(next.loop.scenario), last = sc.tested[sc.tested.length - 1];
    assert.equal(last.change, S.describeChanges(row.changes), "iteration " + (k + 2) + " carries the changes of " + (k + 1));
    assert.equal(last.d_lap_s, row.measured.d_lap_s, "measured lap delta");
    assert.equal(last.kept, row.kept);
    if (row.measured.d_lap_s != null) {
      assert.equal(row.measured.d_lap_s, +(row.measured.lap_after - row.measured.lap_before).toFixed(3), "lap delta = simulated lap after - before");
      assert.deepEqual(last.ds, row.measured.d_sectors_s, "sector deltas");
      if (row.measured.moves.gain.length) assert.deepEqual(last.gain, row.measured.moves.gain.slice(0, 2));
      if (row.measured.moves.loss.length) assert.deepEqual(last.loss, row.measured.moves.loss.slice(0, 2));
    } else assert.ok(Array.isArray(last.illegal) && last.illegal.length, "an illegal result names its articles");
    assert.equal(last.by === "fallback", row.proposer === "fallback");
    // the proof chain: the row knows which recorded call carried its result back
    assert.deepEqual(row.loop.fed_to, { iteration: k + 2, mubit_request_id: next.loop.mubit_request_id });
    checked++;
  }
  assert.equal(checked, 9);
  // the first request has no results yet; the scenario stays within the cap
  assert.deepEqual(JSON.parse(res.lineage[0].loop.scenario).tested, []);
  assert.ok(res.calls.every(c => c.scenario_chars <= S.LIMITS.chars));
  // the current best car in k+1 is the parent after k's verdict
  const kept = res.lineage.find(r => r.kept), after = res.lineage[kept.gen];
  for (const c of kept.changes) assert.equal(JSON.parse(after.loop.scenario).best.params[c.part][c.param], c.to);
});
test("segments: the named corner / straight times partition the simulated lap; deltas sum to the lap delta (1 ms rounding each)", () => {
  const d = design.baseline({ team: "redbull" }), a = segments.segmentTimes(d), r = bench.bench(d, { circuit: "silverstone" });
  assert.equal(a.lap_s, r.circuits.silverstone.lap_s);
  assert.ok(Math.abs(a.segments.reduce((s, x) => s + x.t_s, 0) - a.lap_s) < 0.012);
  for (const n of ["Abbey", "Copse", "Maggotts-Becketts-Chapel", "Hangar Str", "Wellington Str", "Stowe", "Hamilton Str"]) assert.ok(a.segments.some(x => x.name === n), n);
  const d2 = design.applyChanges(d, [{ part: "rear_wing", param: "aoa_deg", to: d.params.rear_wing.aoa_deg + 3 }]).design, b = segments.segmentTimes(d2);
  const delta = segments.segmentDelta(a, b);
  assert.ok(Math.abs(delta.reduce((s, x) => s + x.d_s, 0) - (b.lap_s - a.lap_s)) < 0.012);
  const mv = segments.topMoves(delta); assert.ok(mv.loss.some(x => /Str \+/.test(x)), "more wing loses time on a straight: " + JSON.stringify(mv));
});

// ---------------------------------------------------------------- (b) kept is the simulator's
test("(b) kept is computed from simulator numbers only: legal && score up (== lap down); the model's expectation never changes it", async () => {
  const res = await run1();
  for (const r of res.lineage) {
    assert.equal(r.kept, r.legal && r.score_after > r.score_before + 1e-9, "gen " + r.gen);
    if (r.kept) assert.ok(r.measured.d_lap_s < 0, "a kept change made the simulated lap faster (gen " + r.gen + ")");
  }
  // same proposals, opposite expectations and confident prose-free hypotheses: identical verdicts and measurements
  const moves = [[{ part: "rear_wing", param: "aoa_deg", to: 30 }], [{ part: "floor", param: "ride_height_mm", to: 32 }], [{ part: "sidepods", param: "undercut_mm", to: 140 }], [{ part: "front_wing", param: "aoa_deg", to: 20 }]];
  const llm = sign => async (t, m) => JSON.stringify({ changes: moves[m.gen - 1], hypothesis: sign < 0 ? "This will be kept, certainly faster." : "This will be slower.", expected: { lap_delta_s: sign, sector: 2 } });
  const a = await loop.runLoop({ iterations: 4, seed: 5, runId: "loop-b1", llm: llm(-1) }), b = await loop.runLoop({ iterations: 4, seed: 5, runId: "loop-b1", llm: llm(1) });
  assert.deepEqual(a.lineage.map(r => r.kept), b.lineage.map(r => r.kept));
  assert.deepEqual(a.lineage.map(r => r.measured), b.lineage.map(r => r.measured));
  assert.ok(a.lineage.some(r => r.kept) && a.lineage.some(r => !r.kept), "the moves include a gain and a loss");
  // a model that tries to hand in a verdict is refused (schema: unknown key) and the fallback is measured instead
  const v = await loop.runLoop({ iterations: 1, seed: 5, runId: "loop-b2", llm: async () => JSON.stringify({ changes: moves[0], hypothesis: "x", expected: { lap_delta_s: -1, sector: 1 }, kept: true }) });
  assert.equal(v.lineage[0].proposer, "fallback"); assert.equal(v.lineage[0].designer.reason, "parse"); assert.match(v.lineage[0].designer.detail, /kept: unexpected key/);
});

// ---------------------------------------------------------------- (c) one session per run, a request id per row
test("(c) one Mubit session per run (metadata.user_id = run id) and every lineage row stores its call's x-middleware-request-id", async () => {
  const metas = [], bodies = [];
  const base = loop.mockCaller(2);
  const res = await loop.runLoop({ iterations: 6, seed: 2, runId: "loop-c-run", llm: async (t, m) => { metas.push(m); return base(t, m); }, preview: async (t, m) => { const r = await mubit.captureRequest({ userContent: t, sessionId: m.sessionId, trained: m.trained, task: designerPrompt }); bodies.push(JSON.parse(r.body)); return r; } });
  assert.ok(metas.length >= 5); assert.ok(metas.every(m => m.sessionId === "loop-c-run"));
  assert.ok(bodies.every(b => b.metadata.user_id === "loop-c-run" && b.system === designerPrompt.SYSTEM_PROMPT && b.model === designerPrompt.MODEL && b.max_tokens === designerPrompt.MAX_TOKENS));
  assert.equal(res.session_id, "loop-c-run");
  const ids = res.lineage.map(r => r.loop.mubit_request_id);
  assert.ok(ids.every(Boolean)); assert.equal(new Set(ids).size, ids.length);
  res.lineage.forEach((r, i) => { assert.equal(r.loop.session_id, "loop-c-run"); assert.equal(r.mubit_request_id, r.loop.mubit_request_id); assert.equal(r.loop.mubit_request_id, loop.mockRequestId("loop-c-run", i + 1)); });
  assert.match(ids[0], /^mreq_mock[0-9a-f]{23}$/, "mock ids are visibly not Mubit's (mreq_ + 32 hex)");
  // a provider error keeps the call's request id on the row (the call happened; its answer was not usable)
  const e = await loop.runLoop({ iterations: 1, seed: 2, runId: "loop-c-err", llm: async () => { const x = new Error("upstream"); x.requestId = "mreq_" + "a".repeat(32); throw x; } });
  assert.equal(e.lineage[0].loop.mubit_request_id, "mreq_" + "a".repeat(32)); assert.equal(e.lineage[0].designer.reason, "llm_error");
});

// ---------------------------------------------------------------- (d) research-task bytes unchanged
// Captured with the server/mubit.js of origin/claude/happy-darwin-eoivl5 (c80b031, before the `task` argument) on the same loopback
// stand-in: sha256 of the JSON body for these exact arguments, and the header names (minus the SDK's x-stainless-* telemetry).
const GOLDEN = {
  trained: { sha: "1fd6bf2dbed3b8d796260f3764d12ec036480c88ad9b5aee68f4fec19167284c", len: 1049, headers: ["accept", "accept-encoding", "accept-language", "anthropic-version", "connection", "content-length", "content-type", "host", "sec-fetch-mode", "user-agent", "x-api-key"] },
  untrained: { sha: "7c5fa09230b0c52c71fc104ec46cb8a8c06e83eae17b90b6438db6428014adb7", len: 1050, headers: ["accept", "accept-encoding", "accept-language", "anthropic-version", "connection", "content-length", "content-type", "host", "sec-fetch-mode", "user-agent", "x-api-key", "x-middleware-record"] },
};
function loopback() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body: b });
      res.writeHead(200, { "content-type": "application/json", "x-middleware-request-id": "mreq_" + String(seen.length).padStart(32, "0") });
      res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, seen, url: "http://127.0.0.1:" + srv.address().port + "/anthropic" })));
}
test("(d) research-task requests are byte-identical to before the server/mubit.js task argument; the designer task is separate; DRAFT never trains", async () => {
  const lb = await loopback(); process.env.MUBIT_BASE_URL = lb.url;
  try {
    const user = '{"circuit":"silverstone","x":1}';
    const a = await mubit.callMubit({ userContent: user, sessionId: "exp-TEST", trained: true, kind: "plan" });
    const b = await mubit.callMubit({ userContent: user, sessionId: "exam-TEST", trained: false, kind: "exam" });
    for (const [s, g] of [[lb.seen[0], GOLDEN.trained], [lb.seen[1], GOLDEN.untrained]]) {
      assert.equal(s.url, "/anthropic/v1/messages");
      assert.equal(crypto.createHash("sha256").update(s.body).digest("hex"), g.sha, "research request body changed: " + s.body.slice(0, 120));
      assert.equal(s.body.length, g.len);
      assert.deepEqual(Object.keys(s.headers).filter(k => !k.startsWith("x-stainless")).sort(), g.headers);
      assert.equal(s.headers["x-api-key"], process.env.MUBIT_API_KEY);
    }
    assert.equal(lb.seen[1].headers["x-middleware-record"], "metadata"); assert.equal(lb.seen[0].headers["x-middleware-record"], undefined);
    assert.deepEqual(Object.keys(a).sort(), ["input_tokens", "kind", "latency_ms", "model", "mubit_request_id", "output_tokens", "session_id", "stop_reason", "text", "trained"]);
    assert.equal(a.mubit_request_id, "mreq_" + "1".padStart(32, "0")); assert.equal(b.trained, false);
    // the pure builder without a task is the frozen research task, field for field and in order
    const q = mubit.buildRequest({ userContent: user, sessionId: "s", trained: false });
    assert.equal(JSON.stringify(q.params), JSON.stringify({ model: labPrompt.MODEL, max_tokens: labPrompt.MAX_TOKENS, temperature: labPrompt.TEMPERATURE, system: labPrompt.SYSTEM_PROMPT, messages: [{ role: "user", content: user }], metadata: { user_id: "s" } }));
    // the designer task: its own system prompt and max_tokens, untrained header, session id in metadata.user_id
    const d = await mubit.callMubit({ userContent: user, sessionId: "loop-d", trained: false, kind: "design", task: designerPrompt });
    const body = JSON.parse(lb.seen[2].body);
    assert.equal(body.system, designerPrompt.SYSTEM_PROMPT); assert.notEqual(body.system, labPrompt.SYSTEM_PROMPT); assert.equal(body.max_tokens, 250); assert.deepEqual(body.metadata, { user_id: "loop-d" });
    assert.equal(lb.seen[2].headers["x-middleware-record"], "metadata"); assert.equal(d.kind, "design");
    // the dry-run capture is the same request the live call sent (body bytes; same header names)
    const cap = await mubit.captureRequest({ userContent: user, sessionId: "loop-d", trained: false, task: designerPrompt });
    assert.equal(cap.body, lb.seen[2].body); assert.equal(cap.url, lb.url + "/v1/messages"); assert.equal(cap.headers["x-api-key"], "<MUBIT_API_KEY>");
    for (const h of Object.keys(cap.headers)) assert.ok(h in lb.seen[2].headers, "captured header " + h + " was sent too");
    // a trained call on the DRAFT task throws before anything is sent
    const draftTask = Object.assign({}, designerPrompt, { DRAFT: true, DESIGNER_PROMPT_VERSION: "0-draft" });
    await assert.rejects(mubit.callMubit({ userContent: user, sessionId: "loop-x", trained: true, kind: "design", task: draftTask }), e => e.code === "draft_prompt");
    assert.equal(lb.seen.length, 3, "nothing reached the server for the refused trained call");
  } finally { lb.srv.close(); delete process.env.MUBIT_BASE_URL; }
  // and the frozen research prompt file itself is untouched (test/prompt-frozen.test.js pins its sha256)
  assert.equal(require("../server/scripts/prompt-hash.js").check().ok, true);
});

// ---------------------------------------------------------------- (e) untrained by default
test("(e) untrained by default: every captured request carries x-middleware-record: metadata; trained needs confirm AND a frozen prompt", async () => {
  const heads = [];
  const res = await loop.runLoop({ iterations: 3, seed: 3, runId: "loop-e", llm: loop.mockCaller(3), preview: async (t, m) => { const r = await mubit.captureRequest({ userContent: t, sessionId: m.sessionId, trained: m.trained, task: designerPrompt }); heads.push(r.headers); return r; } });
  assert.equal(heads.length, 3); assert.ok(heads.every(h => h["x-middleware-record"] === "metadata"));
  assert.ok(res.calls.every(c => c.trained === false) && res.lineage.every(r => r.loop.trained === false));
  const draft = Object.assign({}, designerPrompt, { DRAFT: true, DESIGNER_PROMPT_VERSION: "0-draft" });
  await assert.rejects(loop.runLoop({ iterations: 1, runId: "loop-e2", llm: loop.mockCaller(1), trained: true, prompt: draft }), /DRAFT/);
  assert.equal(designerPrompt.DRAFT, false, "the designer prompt is frozen (v1); trained calls still need confirm: \"trained\"");
  assert.ok(designerPrompt.SYSTEM_PROMPT.length <= 1000);
});

// ---------------------------------------------------------------- (f) determinism
test("(f) a mock run of 10 iterations is deterministic (same seed -> identical lineage and calls; another seed differs)", async () => {
  const a = await run1(), b = await runMock(1), c = await runMock(2);
  assert.equal(JSON.stringify(strip(a.lineage)), JSON.stringify(strip(b.lineage)));
  assert.equal(JSON.stringify(strip(a.calls)), JSON.stringify(strip(b.calls)));
  assert.notEqual(JSON.stringify(strip(a.lineage.map(r => r.changes))), JSON.stringify(strip(c.lineage.map(r => r.changes))));
  assert.ok(a.best_result.score > a.baseline_result.score, "the loop improves on the baseline");
  // the mock reads the previous result: after a kept gain it pushes the same parameter further at least once in this run
  assert.ok(a.lineage.some((r, i) => i > 0 && r.proposer === "llm" && a.lineage[i - 1].kept && a.lineage[i - 1].proposer === "llm" && /push the same way/.test(r.hypothesis)));
});

// ---------------------------------------------------------------- server routes + SSE
const { createApp } = require("../server/app.js");
const H = { "content-type": "application/json", host: "127.0.0.1:8787" };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "purple-loop-test-"));
async function drain(app, stream) { const t = await (await app.request(stream, { headers: { host: "127.0.0.1:8787" } })).text(); return t.split("\n\n").filter(Boolean).map(b => ({ event: (/^event: (.*)$/m.exec(b) || [])[1], data: (/^data: (.*)$/m.exec(b) || [])[1] })).filter(x => x.event && x.data).map(x => ({ event: x.event, data: x.event === "ping" ? x.data : JSON.parse(x.data) })); }
test("server: POST /api/concept/loop (mock) streams request -> response -> proposal -> result -> link per iteration and writes the run folder", async () => {
  const dir = tmp(); const { app } = createApp({ dataDir: dir, mubit: require("./mocks/mubit.js"), log: () => {} });
  const r = await (await app.request("/api/concept/loop", { method: "POST", headers: H, body: JSON.stringify({ iterations: 3, seed: 1 }) })).json();
  assert.equal(r.ok, true); assert.equal(r.data.mode, "mock"); assert.equal(r.data.trained, false); assert.equal(r.data.session_id, r.data.run_id); assert.match(r.data.run_id, /^loop-[0-9a-z]{26}$/);
  const evs = await drain(app, r.data.stream);
  const types = evs.map(e => e.event);
  assert.equal(types[0], "start"); assert.equal(types[types.length - 1], "end"); assert.ok(types.includes("done"));
  for (let k = 1; k <= 3; k++) {
    const seq = evs.filter(e => e.data.iteration === k && ["request", "response", "proposal", "result"].includes(e.event)).map(e => e.event);
    assert.deepEqual(seq, ["request", "response", "proposal", "result"], "iteration " + k);
  }
  const req = evs.filter(e => e.event === "request");
  assert.ok(req.every(e => e.data.request.headers["x-middleware-record"] === "metadata" && JSON.parse(e.data.request.body).metadata.user_id === r.data.run_id));
  assert.ok(req.every(e => !JSON.stringify(e.data).includes(process.env.MUBIT_API_KEY)), "the key never reaches the stream");
  const res = evs.filter(e => e.event === "result"), links = evs.filter(e => e.event === "link");
  assert.equal(links.length, 2); assert.equal(links[0].data.fed_to.mubit_request_id, res[1].data.row.loop.mubit_request_id);
  assert.equal(JSON.parse(req[1].data.request.body).messages[0].content.includes(res[0].data.row.change), true, "request 2 carries result 1's change");
  const folder = path.join(dir, "concept-loops", r.data.run_id);
  assert.deepEqual(fs.readdirSync(folder).sort(), ["calls.jsonl", "events.jsonl", "lineage.jsonl", "run.json"]);
  const calls = fs.readFileSync(path.join(folder, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 3); assert.ok(calls.every(c => c.kind === "design" && c.trained === false && c.session_id === r.data.run_id && /^mreq_mock/.test(c.mubit_request_id)));
  const got = await (await app.request("/api/concept/loop/" + r.data.run_id, { headers: { host: "127.0.0.1:8787" } })).json();
  assert.equal(got.data.status, "done"); assert.equal(got.data.lineage.length, 3); assert.equal(got.data.summary.session_id, r.data.run_id);
  assert.equal(fs.existsSync(path.join(dir, "calls.jsonl")), false, "the designer's calls never go into the research agent's calls.jsonl");
});
test("server: guards (bad input, trained needs confirm + frozen prompt, live refused under MUBIT_MOCK or without a key); live goes through callMubit with the designer task", async () => {
  const { app } = createApp({ dataDir: tmp(), mubit: require("./mocks/mubit.js"), log: () => {} });
  const post = async b => { const res = await app.request("/api/concept/loop", { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: res.status, j: await res.json() }; };
  for (const b of [{ iterations: 0 }, { iterations: 31 }, { iterations: 2.5 }, { seed: -1 }, { mode: "real" }, { trained: "yes" }, { team: "ferrari" }, { pace_ms: 99999 }]) assert.equal((await post(b)).status, 400, JSON.stringify(b));
  assert.match((await post({ trained: true })).j.error.message, /confirm must be "trained"/);
  const key = process.env.MUBIT_API_KEY; delete process.env.MUBIT_API_KEY;
  try {
    assert.match((await post({ mode: "live" })).j.error.message, /MUBIT_API_KEY/);
    // the designer prompt is frozen (v1): trained + confirm passes the prompt guard and stops only at the missing key
    assert.match((await post({ mode: "live", trained: true, confirm: "trained" })).j.error.message, /MUBIT_API_KEY/);
  } finally { if (key == null) delete process.env.MUBIT_API_KEY; else process.env.MUBIT_API_KEY = key; }
  const prev = process.env.MUBIT_MOCK; process.env.MUBIT_MOCK = "1";
  try { const m = createApp({ dataDir: tmp(), log: () => {} }); const res = await m.app.request("/api/concept/loop", { method: "POST", headers: H, body: JSON.stringify({ mode: "live" }) }); assert.match((await res.json()).error.message, /MUBIT_MOCK=1/); }
  finally { if (prev == null) delete process.env.MUBIT_MOCK; else process.env.MUBIT_MOCK = prev; }
  // live, with an injected stand-in for server/mubit.js: the route calls callMubit with the designer task, kind design, untrained, one session
  const seen = [], ml = loop.mockLlm(4);
  const fake = { callMubit: async a => { seen.push(a); return { text: await ml(a.userContent), mubit_request_id: "mreq_" + String(seen.length).padStart(32, "f"), model: "claude-haiku-4-5-20251001", input_tokens: 600, output_tokens: 80, latency_ms: 1, trained: !!a.trained }; } };
  const live = createApp({ dataDir: tmp(), mubit: require("./mocks/mubit.js"), conceptMubit: fake, log: () => {} });
  const r = await (await live.app.request("/api/concept/loop", { method: "POST", headers: H, body: JSON.stringify({ mode: "live", iterations: 2, seed: 4 }) })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); await drain(live.app, r.data.stream);
  assert.equal(seen.length, 2); assert.ok(seen.every(a => a.task === designerPrompt && a.kind === "design" && a.trained === false && a.sessionId === r.data.run_id));
  const got = await (await live.app.request("/api/concept/loop/" + r.data.run_id, { headers: { host: "127.0.0.1:8787" } })).json();
  assert.deepEqual(got.data.lineage.map(x => x.loop.mubit_request_id), ["mreq_" + "1".padStart(32, "f"), "mreq_" + "2".padStart(32, "f")]);
  assert.match(r.data.dir, new RegExp("concept-loops"));
});
test("MUBIT_MOCK server: mock loop runs land in data-mock/, never data/", () => {
  const prev = process.env.MUBIT_MOCK, prevD = process.env.PURPLE_DATA_DIR; process.env.MUBIT_MOCK = "1"; delete process.env.PURPLE_DATA_DIR;
  try {
    const { concept } = createApp({ log: () => {} });
    const r = concept.start({ iterations: 1, seed: 1 });
    assert.ok(r.dir.startsWith(path.join(ROOT, "data-mock") + path.sep), r.dir);
    return r.promise.then(() => fs.rmSync(r.dir, { recursive: true, force: true }));
  } finally { if (prev == null) delete process.env.MUBIT_MOCK; else process.env.MUBIT_MOCK = prev; if (prevD != null) process.env.PURPLE_DATA_DIR = prevD; }
});

// ---------------------------------------------------------------- CLI
test("CLI --dry-run prints the exact request of every iteration (no key, untrained header, one session) and sends nothing", () => {
  const out = tmp();
  const env = Object.assign({}, process.env, { MUBIT_API_KEY: "mbt_SHOULD_NOT_APPEAR", MUBIT_BASE_URL: "http://127.0.0.1:9/anthropic" });   // port 9: nothing listens; a send would fail
  const r = spawnSync(process.execPath, [path.join(ROOT, "concept", "designer", "loop-cli.js"), "--dry-run", "--iterations", "3", "--seed", "1", "--run-id", "loop-cli-test", "--out", out], { encoding: "utf8", env, timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/would send \(nothing sent\)/g) || []).length, 3);
  assert.equal((r.stdout.match(/^x-middleware-record: metadata$/gm) || []).length, 3);
  assert.equal((r.stdout.match(/metadata \{"user_id":"loop-cli-test"\}/g) || []).length, 3);
  assert.match(r.stdout, /^x-api-key: <MUBIT_API_KEY>$/m); assert.doesNotMatch(r.stdout + r.stderr, /mbt_SHOULD_NOT_APPEAR/);
  assert.match(r.stdout, /prompt 1 /); assert.doesNotMatch(r.stdout, /DRAFT/); assert.match(r.stdout, /"tested":\[\{"change":"/, "iteration 2+ carries tested results");
  const rows = fs.readFileSync(path.join(out, "lineage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 3); assert.ok(rows.every(x => x.loop.session_id === "loop-cli-test" && x.loop.mubit_request_id));
  const json = spawnSync(process.execPath, [path.join(ROOT, "concept", "designer", "loop-cli.js"), "--dry-run", "--json", "--iterations", "1", "--run-id", "loop-cli-json", "--out", tmp()], { encoding: "utf8", env, timeout: 120000 });
  const line = JSON.parse(json.stdout.trim()); assert.equal(line.body.metadata.user_id, "loop-cli-json"); assert.equal(line.headers["x-middleware-record"], "metadata");
  // refusals: trained without --live, --live without a key, --live under MUBIT_MOCK, no mode, data/ as output
  const bad = (args, e2, re) => { const x = spawnSync(process.execPath, [path.join(ROOT, "concept", "designer", "loop-cli.js")].concat(args), { encoding: "utf8", env: Object.assign({}, process.env, { PURPLE_ENV_FILE: "/nonexistent/.env" }, e2), timeout: 60000 }); assert.equal(x.status, 1, args.join(" ")); assert.match(x.stderr, re); };
  bad(["--mock", "--confirm-trained"], {}, /only applies to --live/);
  bad(["--live"], { MUBIT_API_KEY: "" }, /MUBIT_API_KEY/);
  bad(["--live"], { MUBIT_MOCK: "1" }, /MUBIT_MOCK/);
  bad(["--live", "--confirm-trained"], { MUBIT_API_KEY: "" }, /MUBIT_API_KEY/);   // frozen prompt (v1): only the key stops it
  bad(["--iterations", "2"], {}, /--dry-run, --mock or --live/);
  bad(["--mock", "--out", path.join(ROOT, "data", "loop")], {}, /refusing/);
});

// ---------------------------------------------------------------- honesty
test("loop code, UI and docs never use the banned words (G-HON-02) and only server/mubit.js reaches a provider", () => {
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated", "aerodynamically" + " tested"].join("|"), "i");
  const files = ["concept/designer/loop.js", "concept/designer/segments.js", "concept/designer/loop-cli.js", "server/concept.js", "concept/lab/loop-panel.js", "docs/concept/LOOP.md"].map(f => path.join(ROOT, f));
  for (const f of files) { assert.ok(fs.existsSync(f), f); const m = banned.exec(fs.readFileSync(f, "utf8")); assert.equal(m, null, path.relative(ROOT, f) + ": " + (m && m[0])); }
  for (const f of files.filter(f => f.endsWith(".js"))) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /api\.mubit\.ai|api\.anthropic\.com|@anthropic-ai\/sdk/, f);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "concept/lab/loop-panel.js"), "utf8"), /mubit\.ai/, "the browser never calls Mubit");
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "docs/concept/LOOP.md"), "utf8"), /\d+(\.\d+)?\s?%\s+(exam|score)|exam[^.\n]*\d+\s?%/i, "no exam score as a percentage");
});
