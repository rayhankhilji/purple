// PURPLE CONCEPT - the "changes only" designer task end to end, no network: the compact parser (one change, no hypothesis needed,
// prose / extra keys / a second change rejected; v1 parsing unchanged), the engine CLI's --task flag (default v1) and
// --record-good exact, a mock run on the compact task, and a --live --task compact --record-good exact run against a LOOPBACK stub
// (127.0.0.1, never Mubit): every request carries the compact system prompt and max_tokens, and the trained re-send of an approved
// decision is the proposal call's exact request (same task, same user content, same session) minus x-middleware-record: metadata.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const schema = require("../concept/designer/schema.js");
const compact = require("../concept/designer/prompt-compact.js"), v1 = require("../concept/designer/prompt.js");
const cli = require("../concept/engineer/cli.js");

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-compact-test-"));
const ONE = JSON.stringify({ changes: [{ part: "rear_wing", param: "aoa_deg", to: 18 }] });

test("compact parser: exactly one change, no hypothesis needed; prose, extra keys and a second change rejected; v1 unchanged", () => {
  const ok = schema.validateCompact(ONE);
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.value, { changes: [{ part: "rear_wing", param: "aoa_deg", to: 18, clamped: false }], hypothesis: null, expected: null });
  assert.equal(schema.validateCompact("```json\n" + ONE + "\n```").ok, true, "one fence tolerated, as v1");
  // off-step values are quantised and flagged, as v1
  const q = schema.validateCompact(JSON.stringify({ changes: [{ part: "rear_wing", param: "aoa_deg", to: 99 }] }));
  assert.equal(q.ok, true); assert.deepEqual(q.clamped, ["rear_wing.aoa_deg"]);
  const bad = [
    ["Here you go: " + ONE, "json"], [ONE + " because less drag", "json"], ["Less rear wing for less drag.", "json"],
    [JSON.stringify({ changes: [{ part: "rear_wing", param: "aoa_deg", to: 18 }], hypothesis: "less drag" }), "hypothesis"],
    [JSON.stringify({ changes: [{ part: "rear_wing", param: "aoa_deg", to: 18 }, { part: "floor", param: "ride_height_mm", to: 30 }] }), "changes"],
    [JSON.stringify({ changes: [] }), "changes"], [JSON.stringify({}), "changes"],
    [JSON.stringify({ changes: [{ part: "rear_wing", param: "nope", to: 1 }] }), "changes[0]"],
    [JSON.stringify({ changes: [{ part: "rear_wing", param: "aoa_deg", to: "18" }] }), "changes[0].to"],
  ];
  for (const [t, field] of bad) { const r = schema.validateCompact(t); assert.equal(r.ok, false, t); assert.equal(r.field, field, t + " -> " + r.error); }
  assert.match(schema.validateCompact(bad[4][0]).error, /exactly 1 change \(has 2\)/);
  // v1 parsing unchanged: the compact answer is NOT a v1 answer (hypothesis missing), a full v1 answer still is
  assert.equal(schema.validate(ONE).ok, false); assert.equal(schema.validate(ONE).field, "hypothesis");
  const full = schema.validate(JSON.stringify({ changes: [{ part: "rear_wing", param: "aoa_deg", to: 18 }, { part: "floor", param: "ride_height_mm", to: 30 }], hypothesis: "h", expected: { lap_delta_s: -1, sector: 2 } }));
  assert.equal(full.ok, true, full.error); assert.equal(full.value.changes.length, 2);
  assert.match(schema.validate(JSON.stringify({ changes: [], hypothesis: "h", expected: { lap_delta_s: -1, sector: 2 } })).error, /must hold 1-3 changes \(has 0\)/);
  // the validator follows the task module
  assert.equal(schema.validatorFor(compact), schema.validateCompact); assert.equal(schema.validatorFor(v1), schema.validate); assert.equal(schema.validatorFor(undefined), schema.validate);
  // server/concept.js: task by name or module, v1 by default
  const sc = require("../server/concept.js");
  assert.equal(sc.taskOf(null), v1); assert.equal(sc.taskOf("v1"), v1); assert.equal(sc.taskOf("compact"), compact); assert.equal(sc.taskOf(compact), compact);
  assert.throws(() => sc.taskOf("v2"), /v1" or "compact/);
});

test("engine cli flags: --task v1|compact (default v1), --record-good accepts exact / kept explicitly (default exact)", () => {
  const base = ["--live", "--seed", "1", "--out", "/tmp/x", "--max-decisions", "40", "--confirm-trained", "TRAIN 40"];
  assert.equal(cli.parseArgs(base).task, "v1");
  const h = cli.parseArgs(["--live", "--task", "compact", "--confirm-trained", "TRAIN 40", "--record-good", "exact", "--screen", "direct", "--mix", "2", "--seed", "7", "--max-decisions", "40", "--budget", "100000", "--workers", "1", "--out", "/tmp/x"]);
  assert.equal(h.task, "compact"); assert.equal(h.recordGood, true); assert.equal(h.recordRule, "exact"); assert.equal(h.screen, "direct"); assert.equal(h.mix, 2); assert.equal(h.budget, 100000); assert.equal(h.workers, 1);
  assert.equal(cli.parseArgs(base.concat(["--record-good"])).recordRule, "exact");
  assert.equal(cli.parseArgs(base.concat(["--record-good", "kept"])).recordRule, "kept");
  assert.equal(cli.parseArgs(base.concat(["--record-good", "--task", "compact"])).task, "compact", "a bare --record-good does not swallow the next option");
  assert.throws(() => cli.parseArgs(base.concat(["--task", "v2"])), /--task v1\|compact/);
  assert.equal(cli.TASKS.compact, compact); assert.equal(cli.TASKS.v1, v1);
});

test("engine cli --mock scripted --task compact: answers in the compact format are parsed (no engine fallback), version logged", async () => {
  const out = tmp(); const io = { out: () => {}, err: () => {} };
  await cli.main(["--mock", "scripted", "--task", "compact", "--seed", "5", "--max-decisions", "3", "--screen", "direct", "--budget", "1000", "--workers", "0", "--out", out], io);
  const dir = path.join(out, "run-seed5");
  const decisions = fs.readFileSync(path.join(dir, "decisions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(decisions.length, 3);
  for (const d of decisions) if (d.by === "mock") { assert.ok(d.proposal_change && !d.proposal_change.includes(";"), "one change: " + d.proposal_change); assert.equal(d.hypothesis == null, true); }
  assert.ok(decisions.some(d => d.by === "mock"), "at least one compact answer parsed: " + decisions.map(d => d.by + " " + (d.fallback_reason || "")).join(" | "));
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  assert.equal(run.opts.task, "compact"); assert.equal(run.opts.prompt_version, "compact-1");
  const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls.length >= 1 && calls.every(c => c.prompt_version === "compact-1"));
});

// a loopback stand-in for the Mubit gateway (127.0.0.1, port 0): answers by user content, records every request
function loopback(answerFor) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => {
      const body = JSON.parse(b); seen.push({ headers: req.headers, raw: b, body });
      const text = answerFor(body, req.headers, seen);
      res.writeHead(200, { "content-type": "application/json", "x-middleware-request-id": "mreq_" + String(seen.length).padStart(32, "0") });
      res.end(JSON.stringify({ id: "msg_" + seen.length, type: "message", role: "assistant", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 20 } }));
    });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, seen, url: "http://127.0.0.1:" + srv.address().port + "/anthropic" })));
}

test("engine cli --live --task compact --record-good exact (loopback stub): compact task on every request; the trained re-send is the proposal's request", async () => {
  const GOOD = ONE;                                                                         // less rear wing: legal and faster as written
  const BAD = JSON.stringify({ changes: [{ part: "floor", param: "ride_height_mm", to: 20 }] });   // illegal as written
  const byContent = new Map(); let untrained = 0;
  const lb = await loopback((body, headers) => {
    const content = body.messages[0].content;
    if (headers["x-middleware-record"] === "metadata") { untrained++; byContent.set(content, untrained === 1 ? GOOD : BAD); }
    return byContent.get(content) || "?";
  });
  const saved = {}; for (const k of ["MUBIT_BASE_URL", "MUBIT_API_KEY", "MUBIT_MOCK", "PURPLE_ENV_FILE", "PURPLE_DATA_DIR"]) saved[k] = process.env[k];
  Object.assign(process.env, { MUBIT_BASE_URL: lb.url, MUBIT_API_KEY: "test-key-never-sent", PURPLE_ENV_FILE: path.join(tmp(), "none.env") });
  delete process.env.MUBIT_MOCK; delete process.env.PURPLE_DATA_DIR;
  const out = tmp(); const lines = [];
  try {
    await cli.main(["--live", "--task", "compact", "--confirm-trained", "TRAIN 2", "--record-good", "exact", "--screen", "direct", "--seed", "3", "--max-decisions", "2", "--budget", "1000", "--workers", "0", "--run-id", "eng-compact-test", "--out", out], { out: s => lines.push(s), err: s => lines.push(s) });
  } finally {
    lb.srv.close();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  assert.match(lines.join(""), /task compact \(compact-1\) · record-good exact/);
  // 2 untrained proposal calls + 1 trained re-send of the approved decision
  assert.equal(lb.seen.length, 3, lb.seen.map(s => s.headers["x-middleware-record"] || "trained").join(","));
  for (const s of lb.seen) {
    assert.equal(s.body.system, compact.SYSTEM_PROMPT, "every request carries the compact system prompt");
    assert.notEqual(s.body.system, v1.SYSTEM_PROMPT);
    assert.equal(s.body.model, compact.MODEL); assert.equal(s.body.max_tokens, compact.MAX_TOKENS); assert.equal(s.body.temperature, compact.TEMPERATURE);
    assert.deepEqual(s.body.metadata, { user_id: "eng-compact-test" });
    assert.equal(s.headers["x-api-key"], "test-key-never-sent");
  }
  // order: decision 1's call, its trained re-send (finished before the next call: one call in flight), decision 2's call
  const [p1, re, p2] = lb.seen;
  assert.equal(p1.headers["x-middleware-record"], "metadata"); assert.equal(p2.headers["x-middleware-record"], "metadata");
  assert.equal(re.headers["x-middleware-record"], undefined, "the re-send is the trained call");
  // the re-send is decision 1's request, byte for byte (same task, params, user content, session)
  assert.equal(re.raw, p1.raw);
  assert.notEqual(p2.body.messages[0].content, p1.body.messages[0].content);
  const dir = path.join(out, "run-seed3");
  const decisions = fs.readFileSync(path.join(dir, "decisions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].by, "mubit"); assert.equal(decisions[0].as_proposed.legal, true); assert.ok(decisions[0].as_proposed.d_lap_s < -0.0005, JSON.stringify(decisions[0].as_proposed));
  assert.equal(decisions[1].by, "mubit"); assert.equal(decisions[1].as_proposed.legal, false);
  assert.equal(decisions[0].hypothesis == null, true, "the compact answer carries no hypothesis and is not a parse failure");
  const good = fs.readFileSync(path.join(dir, "good.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(good.length, 1); assert.equal(good[0].decision, decisions[0].decision); assert.equal(good[0].trained_id, "mreq_" + "2".padStart(32, "0"));
  const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 3); assert.ok(calls.every(c => c.prompt_version === "compact-1"));
  assert.equal(calls.filter(c => c.trained === true && c.record_good === true).length, 1); assert.equal(calls.find(c => c.record_good).same_answer, true);
});
