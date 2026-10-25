// PURPLE CONCEPT - the "action-choosing" designer task end to end, no network: the action catalogue (fixed codes, pinned), the menu
// (deterministic, legal actions only, codes stable across states), the action parser (one code from the call's own menu; anything
// else rejected; v1 / compact parsing unchanged), the engine CLI's --task action (mock run), and a --live --task action --record-good
// exact run against a LOOPBACK stub (127.0.0.1, never Mubit): every request carries the action system prompt, max_tokens and the
// menu in the user message, and the trained re-send of an approved decision is the proposal call's exact request.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto");
const schema = require("../concept/designer/schema.js"), actions = require("../concept/designer/actions.js");
const action = require("../concept/designer/prompt-action.js"), v1 = require("../concept/designer/prompt.js"), compact = require("../concept/designer/prompt-compact.js");
const design = require("../concept/design.js"), engine = require("../concept/engineer/engine.js"), parts = require("../concept/parts.js");
const cli = require("../concept/engineer/cli.js");

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-action-test-"));
const legal = d => engine.violations(d).length === 0;
const CATALOGUE_SHA = "0bae9212a07792cda85c0372e0c767a37eb4f79014fa80e0aa64cd55e55efd10";

test("action catalogue: every parameter up and down, sorted by key then direction, codes A01..A72 pinned", () => {
  const C = actions.CATALOGUE;
  assert.equal(C.length, 2 * parts.PARAMS.length); assert.equal(C.length, 72);
  C.forEach((a, i) => { assert.equal(a.code, "A" + String(i + 1).padStart(2, "0")); assert.ok(actions.CODE_RE.test(a.code)); });
  for (let i = 1; i < C.length; i++) assert.ok(C[i - 1].key < C[i].key || (C[i - 1].key === C[i].key && C[i - 1].dir === 1 && C[i].dir === -1), C[i].code);
  // a new parameter in concept/parts.js (or a new step size) would move codes: that is a different classification, so it must fail here
  const table = C.map(x => x.code + " " + x.key + " " + (x.delta > 0 ? "+" : "") + x.delta).join("\n");
  assert.equal(crypto.createHash("sha256").update(table).digest("hex"), CATALOGUE_SHA, table);
  assert.equal(actions.BY_CODE.get("A17").key, "floor.width_mm"); assert.equal(actions.BY_CODE.get("A17").delta, 20);   // 5 % of the 1200-1540 box -> 2 steps
  assert.equal(actions.BY_CODE.get("A18").delta, -20);
  assert.equal(actions.BY_CODE.get("A40").key, "rear_wing.aoa_deg"); assert.equal(actions.BY_CODE.get("A40").delta, -1.5);
  for (const k of parts.CONCEPT_KEYS) assert.deepEqual(C.filter(a => a.key === k).map(a => a.delta), [1, -1], k + ": next / previous code");
});

test("action menu: deterministic, legal actions only, the same action keeps its code across states", () => {
  const base = design.baseline({ team: "redbull" });
  const m1 = actions.menu(base, { legal }), m2 = actions.menu(design.clone(base), { legal });
  assert.deepEqual(m1, m2, "same car, same menu");
  assert.ok(m1.length >= 30 && m1.length <= 72, String(m1.length));
  assert.deepEqual(m1.map(x => x.code), m1.map(x => x.code).slice().sort(), "catalogue order");
  for (const x of m1) {
    const a = actions.BY_CODE.get(x.code);
    assert.equal(x.part + "." + x.param, a.key); assert.equal(+(x.to - x.from).toFixed(6), a.delta);
    assert.ok(legal(design.applyChanges(base, [{ part: x.part, param: x.param, to: x.to }]).design), x.line);
  }
  const floor = m1.find(x => x.code === "A17");
  assert.equal(floor.line, "A17 floor.width_mm +20 -> 1470");
  assert.ok(!m1.some(x => x.code === "A19"), "front_wing.aoa_deg +1.5 is illegal at the baseline (C3.10.1(a)): skipped, the codes after it do not move");
  assert.equal(m1.find(x => x.code === "A20").line, "A20 front_wing.aoa_deg -1.5 -> 23.5");
  assert.match(m1.find(x => x.code === "A51").line, /^A51 rear_wing\.style \+1 -> 2 high_df$/);
  // another state: the codes of the same actions are the same, values follow the head, the box edge removes the step past it
  const other = design.applyChanges(base, [{ part: "floor", param: "width_mm", to: 1540 }, { part: "rear_wing", param: "aoa_deg", to: 16 }]).design;
  const m3 = actions.menu(other, { legal });
  assert.ok(!m3.some(x => x.code === "A17"), "floor.width_mm +20 past the 1540 box edge is not offered");
  assert.equal(m3.find(x => x.code === "A18").line, "A18 floor.width_mm -20 -> 1520");
  assert.equal(m3.find(x => x.code === "A40").line, "A40 rear_wing.aoa_deg -1.5 -> 14.5");
  for (const x of m3) assert.equal(actions.BY_CODE.get(x.code).key, x.part + "." + x.param);
  // the text: header + one line per action, compact; strip / readMenu give the scenario and the menu back
  const sc = { scenario: {}, text: '{"best":{}}', chars: 11, tokens: 3 };
  const at = actions.attach(sc, base, { legal });
  assert.equal(at.text, sc.text + "\n" + actions.menuText(m1)); assert.equal(at.text.split("\n").length, m1.length + 2);
  assert.ok(at.menu_chars < 2600, String(at.menu_chars));
  assert.equal(actions.strip(at.text), sc.text); assert.equal(actions.strip(sc.text), sc.text);
  assert.deepEqual(actions.readMenu(at.text).map(x => x.code), m1.map(x => x.code));
});

test("action parser: exactly one code from the call's menu; unknown, off-menu, prose, JSON or two codes rejected; v1 / compact unchanged", () => {
  const menu = actions.menu(design.baseline({ team: "redbull" }), { legal });
  const ok = schema.validateAction("A17", { menu });
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.value, { changes: [{ part: "floor", param: "width_mm", to: 1470, clamped: false }], hypothesis: null, expected: null, action: "A17" });
  assert.equal(schema.validateAction("  A40\n", { menu }).ok, true, "surrounding whitespace tolerated");
  assert.deepEqual(schema.validateAction("A40", { menu }).value.changes, [{ part: "rear_wing", param: "aoa_deg", to: 18.5, clamped: false }]);
  const bad = [
    ["A99", /unknown action code A99/], ["A19", /not on this car's menu/], ["a17", /exactly one action code/], ["A7", /exactly one action code/],
    ["A17.", /exactly one action code/], ["A17 A18", /exactly one action code/], ["A17\nA18", /exactly one action code/], ["Choose A17", /exactly one action code/],
    ["`A17`", /exactly one action code/], ['{"action":"A17"}', /exactly one action code/], ["", /exactly one action code/], ["A017", /exactly one action code/],
  ];
  for (const [t, re] of bad) { const r = schema.validateAction(t, { menu }); assert.equal(r.ok, false, t); assert.equal(r.field, "action"); assert.match(r.error, re, t); }
  assert.equal(schema.validateAction("A17").ok, false, "no menu, no mapping"); assert.equal(schema.validateAction(17, { menu }).ok, false);
  // the validator follows the task module; v1 and compact are untouched
  assert.equal(schema.validatorFor(action), schema.validateAction); assert.equal(schema.validatorFor(compact), schema.validateCompact); assert.equal(schema.validatorFor(v1), schema.validate);
  assert.equal(schema.validateCompact("A17").ok, false); assert.equal(schema.validate("A17").ok, false);
  // server/concept.js and the CLI know the task by name
  const sc = require("../server/concept.js");
  assert.equal(sc.taskOf("action"), action); assert.equal(sc.TASKS.action, action); assert.throws(() => sc.taskOf("v2"), /"action"/);
  assert.equal(cli.TASKS.action, action);
  const h = cli.parseArgs(["--live", "--task", "action", "--confirm-trained", "TRAIN 40", "--record-good", "exact", "--screen", "direct", "--mix", "2", "--seed", "7", "--max-decisions", "40", "--budget", "100000", "--workers", "1", "--out", "/tmp/x"]);
  assert.equal(h.task, "action"); assert.equal(h.recordRule, "exact"); assert.throws(() => cli.parseArgs(["--mock", "scripted", "--seed", "1", "--out", "/tmp/x", "--task", "v2"]), /--task v1\|compact\|action/);
});

test("engine cli --mock scripted --task action: the menu is in every user message, answers are codes, parsed (no engine fallback)", async () => {
  const out = tmp(); const io = { out: () => {}, err: () => {} };
  await cli.main(["--mock", "scripted", "--task", "action", "--seed", "5", "--max-decisions", "3", "--screen", "direct", "--budget", "1000", "--workers", "0", "--out", out], io);
  const dir = path.join(out, "run-seed5");
  const decisions = fs.readFileSync(path.join(dir, "decisions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(decisions.length, 3);
  assert.ok(decisions.every(d => d.by === "mock"), decisions.map(d => d.by + " " + (d.fallback_reason || "")).join(" | "));
  for (const d of decisions) { assert.match(d.action, /^A\d{2}$/); assert.ok(!d.proposal_change.includes(";")); assert.equal(d.as_proposed.legal, true, "menu actions are legal"); }
  const events = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const reqs = events.filter(e => e.type === "request");
  assert.equal(reqs.length, 3);
  for (const r of reqs) { assert.ok(r.scenario_text.includes("\n" + actions.MENU_HEADER + "\nA0"), "menu after the scenario"); assert.ok(JSON.parse(actions.strip(r.scenario_text)).corrections, "corrections block kept"); assert.ok(r.scenario_chars < 7000, String(r.scenario_chars)); }
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  assert.equal(run.opts.task, "action"); assert.equal(run.opts.prompt_version, "action-1");
  const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls.length === 3 && calls.every(c => c.prompt_version === "action-1"));
});

// a loopback stand-in for the Mubit gateway (127.0.0.1, port 0): answers by user content, records every request
function loopback(answerFor) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => {
      const body = JSON.parse(b); seen.push({ headers: req.headers, raw: b, body });
      const text = answerFor(body, req.headers, seen);
      res.writeHead(200, { "content-type": "application/json", "x-middleware-request-id": "mreq_" + String(seen.length).padStart(32, "0") });
      res.end(JSON.stringify({ id: "msg_" + seen.length, type: "message", role: "assistant", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 3 } }));
    });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, seen, url: "http://127.0.0.1:" + srv.address().port + "/anthropic" })));
}

test("engine cli --live --task action --record-good exact (loopback stub): action task on every request; the trained re-send is the proposal's request", async () => {
  // decision 1: A40 (rear_wing.aoa_deg -1.5: less wing, legal and faster as written) -> approved, re-sent trained;
  // decision 2: A99 (not a code of the catalogue) -> parse failure, the engine's labelled fallback, never trained
  const byContent = new Map(); let untrained = 0;
  const lb = await loopback((body, headers) => {
    const content = body.messages[0].content;
    if (headers["x-middleware-record"] === "metadata") { untrained++; byContent.set(content, untrained === 1 ? "A40" : "A99"); }
    return byContent.get(content) || "?";
  });
  const saved = {}; for (const k of ["MUBIT_BASE_URL", "MUBIT_API_KEY", "MUBIT_MOCK", "PURPLE_ENV_FILE", "PURPLE_DATA_DIR"]) saved[k] = process.env[k];
  Object.assign(process.env, { MUBIT_BASE_URL: lb.url, MUBIT_API_KEY: "test-key-never-sent", PURPLE_ENV_FILE: path.join(tmp(), "none.env") });
  delete process.env.MUBIT_MOCK; delete process.env.PURPLE_DATA_DIR;
  const out = tmp(); const lines = [];
  try {
    await cli.main(["--live", "--task", "action", "--confirm-trained", "TRAIN 2", "--record-good", "exact", "--screen", "direct", "--seed", "3", "--max-decisions", "2", "--budget", "1000", "--workers", "0", "--run-id", "eng-action-test", "--out", out], { out: s => lines.push(s), err: s => lines.push(s) });
  } finally {
    lb.srv.close();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  assert.match(lines.join(""), /task action \(action-1\) · record-good exact/);
  // 2 untrained proposal calls + 1 trained re-send of the approved decision
  assert.equal(lb.seen.length, 3, lb.seen.map(s => s.headers["x-middleware-record"] || "trained").join(","));
  for (const s of lb.seen) {
    assert.equal(s.body.system, action.SYSTEM_PROMPT, "every request carries the action system prompt");
    assert.notEqual(s.body.system, v1.SYSTEM_PROMPT); assert.notEqual(s.body.system, compact.SYSTEM_PROMPT);
    assert.equal(s.body.model, action.MODEL); assert.equal(s.body.max_tokens, action.MAX_TOKENS); assert.equal(s.body.temperature, action.TEMPERATURE);
    assert.deepEqual(s.body.metadata, { user_id: "eng-action-test" });
    assert.ok(s.body.messages[0].content.includes("\n" + actions.MENU_HEADER + "\n"), "the menu is in the user message");
  }
  const [p1, re, p2] = lb.seen;
  assert.equal(p1.headers["x-middleware-record"], "metadata"); assert.equal(p2.headers["x-middleware-record"], "metadata");
  assert.equal(re.headers["x-middleware-record"], undefined, "the re-send is the trained call");
  assert.equal(re.raw, p1.raw, "the trained re-send is decision 1's request byte for byte (same task, user message with the same menu, session)");
  assert.ok(/\nA40 rear_wing\.aoa_deg -1\.5 -> 18\.5\n/.test(p1.body.messages[0].content));
  assert.notEqual(p2.body.messages[0].content, p1.body.messages[0].content);
  const dir = path.join(out, "run-seed3");
  const decisions = fs.readFileSync(path.join(dir, "decisions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].by, "mubit"); assert.equal(decisions[0].action, "A40"); assert.equal(decisions[0].proposal_change, "rear_wing.aoa_deg 20->18.5");
  assert.equal(decisions[0].as_proposed.legal, true); assert.ok(decisions[0].as_proposed.d_lap_s < -0.0005, JSON.stringify(decisions[0].as_proposed));
  assert.equal(decisions[1].by, "engine"); assert.match(decisions[1].fallback_reason, /unknown action code A99/);
  const good = fs.readFileSync(path.join(dir, "good.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(good.length, 1); assert.equal(good[0].decision, 1); assert.equal(good[0].trained_id, "mreq_" + "2".padStart(32, "0"));
  const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 3); assert.ok(calls.every(c => c.prompt_version === "action-1"));
  const tr = calls.filter(c => c.trained === true && c.record_good === true);
  assert.equal(tr.length, 1); assert.equal(tr[0].same_answer, true);
});
