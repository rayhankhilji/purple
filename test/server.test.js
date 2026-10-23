// PURPLE - F-03 / F-05 / F-09 contract tests with the Mubit mock (TESTING_GUIDE §5). In-process via app.request().
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const mock = require("./mocks/mubit.js");
const { createApp } = require("../server/app.js");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "purple-test-"));
const json = async (app, url, init) => { const res = await app.request(url, Object.assign({ headers: { "content-type": "application/json" } }, init || {})); return { status: res.status, body: await res.json() }; };
const post = (app, url, b, headers) => json(app, url, { method: "POST", body: JSON.stringify(b || {}), headers: Object.assign({ "content-type": "application/json" }, headers || {}) });

test("T-F03-AC1 POST /api/plan -> 200 envelope, ledger row with mubit_request_id, SSE plan event", async () => {
  mock.reset(); const dir = tmp(); const { app } = createApp({ dataDir: dir, mubit: mock, heartbeatMs: 50 });
  const sse = await app.request("/api/stream"); assert.equal(sse.status, 200); const reader = sse.body.getReader(); const dec = new TextDecoder(); let buf = "";
  const r = await post(app, "/api/plan", { scenario_overrides: { seed: 11 } }, { "x-client-id": "t1" });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  const x = r.body.data; assert.match(x.mubit_request_id, /^mreq_/); assert.equal(x.status, "planned"); assert.equal(x.plan.verdict, "reject"); assert.match(x.session_id, /^exp-/);
  assert.ok(x.evaluation.lap > 70 && typeof x.evaluation.delta_lap === "number"); assert.equal(x.scenario.rules.length, 0);
  const rows = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(rows.length, 1); assert.equal(rows[0].mubit_request_id, x.mubit_request_id);
  const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(calls.length, 1); assert.equal(calls[0].trained, true); assert.equal(calls[0].kind, "plan");
  for (let i = 0; i < 6 && !/event: plan/.test(buf); i++) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); }
  assert.match(buf, /event: plan/); assert.match(buf, new RegExp(x.id)); await reader.cancel();
  // idempotent per x-client-id for 10 s
  const again = await post(app, "/api/plan", {}, { "x-client-id": "t1" }); assert.equal(again.body.data.id, x.id); assert.equal(mock.count(), 1);
  // ledger lists it
  const led = await json(app, "/api/ledger?limit=5"); assert.equal(led.body.data.length, 1);
});
test("T-F03-AC3 planner returns prose -> one retry, then status parse_error and 502 PARSE_ERROR", async () => {
  mock.reset(); mock.queue("Sure! Here is my plan: {\"verdict\":\"reject\"}", "I think we should reject."); const dir = tmp(); const { app } = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const r = await post(app, "/api/plan", { scenario_overrides: { seed: 3 } }); assert.equal(r.status, 502); assert.equal(r.body.ok, false); assert.equal(r.body.error.code, "PARSE_ERROR"); assert.ok(r.body.error.experiment_id);
  assert.equal(mock.count(), 2);
  const rows = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(rows[0].status, "parse_error"); assert.equal(rows[0].plan, null);
  const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(calls.length, 2); assert.ok(calls.every(c => c.status === "parse_error"));
});
test("Mubit failure -> 502 MUBIT_ERROR with the Mubit code; the ledger keeps the row", async () => {
  mock.reset(); const e = new Error("busy"); e.code = "starter_credit_busy"; e.status = 429; mock.queue(e); const { app } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  const r = await post(app, "/api/plan", {}); assert.equal(r.status, 502); assert.equal(r.body.error.code, "MUBIT_ERROR"); assert.equal(r.body.error.mubit_code, "starter_credit_busy");
});
test("T-F05-AC1 POST /api/overrule -> rule in rules.json; the next /api/plan scenario contains the rule text", async () => {
  mock.reset(); const dir = tmp(); const { app } = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const first = (await post(app, "/api/plan", { scenario_overrides: { seed: 5 } })).body.data;
  const o = await post(app, "/api/overrule", { experiment_id: first.id, verdict: "reject", reason: "Weigh straight-line drag against corner gain; judge on full-lap delta." });
  assert.equal(o.status, 200); assert.equal(o.body.data.rule.id, "R-01"); assert.ok(o.body.data.rule.created_at);
  const rules = JSON.parse(fs.readFileSync(path.join(dir, "rules.json"), "utf8")); assert.equal(rules.length, 1); assert.equal(rules[0].active, true);
  const second = (await post(app, "/api/plan", { scenario_overrides: { seed: 6 } })).body.data;
  assert.deepEqual(second.scenario.rules, [rules[0].text]); assert.match(mock.inputs[mock.inputs.length - 1].userContent, /judge on full-lap delta/);
  assert.equal(second.scenario.history.length, 1);   // the overruled experiment stays in the history
  const led = (await json(app, "/api/ledger")).body.data; assert.equal(led.find(x => x.id === first.id).status, "overruled");
  // toggling the rule off removes it from the next scenario
  await post(app, "/api/rules/R-01", { active: false }); const third = (await post(app, "/api/plan", { scenario_overrides: { seed: 7 } })).body.data; assert.deepEqual(third.scenario.rules, []);
});
test("POST /api/evaluate: pure, illegal -> 422 ILLEGAL_SETUP, bad input -> 400", async () => {
  mock.reset(); const { app, EI } = createApp({ dataDir: tmp(), mubit: mock });
  const okr = await post(app, "/api/evaluate", { setup: Object.assign({}, EI.aero.BASELINE, { rear_wing_deg: 28 }), conditions: { circuit: "silverstone" } }); assert.equal(okr.status, 200); assert.ok(okr.body.data.delta_lap > 0);
  const bad = await post(app, "/api/evaluate", { setup: Object.assign({}, EI.aero.BASELINE, { rear_wing_deg: 36 }) }); assert.equal(bad.status, 422); assert.equal(bad.body.error.code, "ILLEGAL_SETUP"); assert.ok(bad.body.error.violations.includes("REG-RW-MAX"));
  const nope = await post(app, "/api/evaluate", { setup: { rear_wing_deg: 20 } }); assert.equal(nope.status, 400); assert.equal(nope.body.error.code, "BAD_INPUT");
  assert.equal(mock.count(), 0);
});
test("T-F09-AC1 TD-01 active, candidate at 25° -> 422 and a calls.jsonl row kind illegal", async () => {
  mock.reset(); const dir = tmp(); const { app, EI } = createApp({ dataDir: dir, mubit: mock });
  await post(app, "/api/state", { td01: true });
  const r = await post(app, "/api/plan", { scenario_overrides: { candidate: Object.assign({}, EI.aero.BASELINE, { rear_wing_deg: 25 }) } });
  assert.equal(r.status, 422); assert.equal(r.body.error.code, "ILLEGAL_SETUP"); assert.deepEqual(r.body.error.violations, ["TD-01"]);
  const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(calls[0].kind, "illegal"); assert.equal(mock.count(), 0);
});
// read the in-process SSE stream until `re` matches (or `tries` reads)
async function sseUntil(app, re, tries) { const res = await app.request("/api/stream"); const reader = res.body.getReader(), dec = new TextDecoder(); let buf = ""; return { res, read: async () => { for (let i = 0; i < (tries || 8) && !re.test(buf); i++) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } await reader.cancel(); return buf; } }; }
const sseEvent = (buf, name) => buf.split("\n\n").filter(ch => ch.includes("event: " + name)).map(ch => JSON.parse(ch.split("\n").find(l => l.startsWith("data: ")).slice(6)));
const raceCars = (x, factor) => [{ role: "baseline", lap: 80.9, sectors: [27.2, 31.5, 22.2], vmax_kmh: 330, vmin_becketts_kmh: 200 }, { role: "candidate", lap: +(80.9 + x.evaluation.delta_lap * (factor || 1.2)).toFixed(3), sectors: [27.1, 31.8, 22.2], vmax_kmh: 322, vmin_becketts_kmh: 204 }];

test("promote makes the candidate the baseline", async () => {
  mock.reset(); const { app } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 9 } })).body.data;
  const p = await post(app, "/api/promote", { experiment_id: x.id }); assert.equal(p.status, 200); assert.deepEqual((await json(app, "/api/state")).body.data.baseline, x.candidate);
});
test("T-F04-AC2 POST /api/race/result with the game's payload -> measured block, agreement_pct on the ledger row, SSE race event carries the full experiment", async () => {
  mock.reset(); const dir = tmp(); const { app } = createApp({ dataDir: dir, mubit: mock, log: () => {}, heartbeatMs: 50 });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 9 } })).body.data;
  const sse = await sseUntil(app, /event: race/);
  const rr = await post(app, "/api/race/result", { experiment_id: x.id, seed: 9, cars: raceCars(x, 1.2) });
  assert.equal(rr.status, 200); const row = rr.body.data, m = row.measured;
  assert.equal(row.id, x.id); assert.equal(row.status, "raced"); assert.ok(row.plan && row.evaluation && row.scenario, "full experiment");
  assert.ok(Math.abs(m.agreement_pct - 20) <= 1, "agreement " + m.agreement_pct);   // measured Δ = 1.2 × predicted Δ -> 20 %
  assert.deepEqual(m.baseline, { lap: 80.9, sectors: [27.2, 31.5, 22.2], vmax_kmh: 330, vmin_becketts_kmh: 200 });
  assert.equal(m.candidate.lap, +(80.9 + x.evaluation.delta_lap * 1.2).toFixed(3)); assert.deepEqual(m.candidate.sectors, [27.1, 31.8, 22.2]);
  assert.equal(m.predicted_delta, x.evaluation.delta_lap); assert.equal(m.measured_delta, +(m.candidate.lap - 80.9).toFixed(3)); assert.deepEqual(m.measured_sector_deltas, [-0.1, 0.3, 0]);
  assert.equal(m.label, "measured in race, seed 9"); assert.equal(m.seed, 9); assert.ok(m.at); assert.equal(m.supersedes, null);
  // the ledger (deduped, newest first) shows it and GET /api/experiments/:id returns the raced row
  const led = (await json(app, "/api/ledger")).body.data; assert.equal(led.length, 1); assert.equal(led[0].measured.agreement_pct, m.agreement_pct); assert.equal(led[0].status, "raced");
  assert.equal((await json(app, "/api/experiments/" + x.id)).body.data.measured.label, "measured in race, seed 9");
  const buf = await sse.read(); const ev = sseEvent(buf, "race"); assert.equal(ev.length, 1); assert.equal(ev[0].id, x.id); assert.equal(ev[0].measured.agreement_pct, m.agreement_pct); assert.equal(ev[0].plan.verdict, "reject"); assert.ok(ev[0].evaluation.lap);
});
test("race/result: perfect agreement -> 0; predicted 0 -> agreement_pct null; overruled stays overruled; promoted stays promoted", async () => {
  mock.reset(); const { app, db } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 9 } })).body.data;
  assert.equal((await post(app, "/api/race/result", { experiment_id: x.id, seed: 1, cars: raceCars(x, 1.0) })).body.data.measured.agreement_pct, 0);
  await post(app, "/api/overrule", { experiment_id: x.id, verdict: "promote", reason: "race it anyway" });
  const r2 = (await post(app, "/api/race/result", { experiment_id: x.id, seed: 2, cars: raceCars(x, 2.0) })).body.data; assert.equal(r2.status, "overruled"); assert.equal(r2.measured.agreement_pct, 100); assert.equal(r2.overrule.rule_id, "R-01");
  const y = (await post(app, "/api/plan", { scenario_overrides: { seed: 10 } })).body.data; await post(app, "/api/promote", { experiment_id: y.id });
  assert.equal((await post(app, "/api/race/result", { experiment_id: y.id, seed: 3, cars: raceCars(y, 1.5) })).body.data.status, "promoted");
  // a zero prediction (candidate == baseline) cannot be scored
  db.appendLedger(Object.assign({}, x, { id: "01ZERO", evaluation: Object.assign({}, x.evaluation, { delta_lap: 0 }) }));
  assert.equal((await post(app, "/api/race/result", { experiment_id: "01ZERO", seed: 4, cars: raceCars(x, 1) })).body.data.measured.agreement_pct, null);
});
test("race/result: a second post for the same experiment supersedes the first (append-only ledger, last row wins)", async () => {
  mock.reset(); const dir = tmp(); const { app } = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 9 } })).body.data;
  const a = (await post(app, "/api/race/result", { experiment_id: x.id, seed: 1, cars: raceCars(x, 1.2) })).body.data;
  const b = (await post(app, "/api/race/result", { experiment_id: x.id, seed: 2, cars: raceCars(x, 1.5) })).body.data;
  assert.equal(b.measured.supersedes, a.measured.at); assert.equal(b.measured.label, "measured in race, seed 2"); assert.equal(b.measured.agreement_pct, 50);
  const raw = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(raw.length, 3); assert.ok(raw.every(r => r.id === x.id));
  const led = (await json(app, "/api/ledger")).body.data; assert.equal(led.length, 1); assert.equal(led[0].measured.seed, 2); assert.equal(led[0].measured.agreement_pct, 50);
});
test("race/result: every field is validated with a BAD_INPUT message naming the field; unknown experiment -> 404", async () => {
  mock.reset(); const { app } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 9 } })).body.data;
  const good = () => ({ experiment_id: x.id, seed: 9, cars: raceCars(x) });
  const cases = [
    [b => { delete b.experiment_id; }, /experiment_id/], [b => { b.seed = "9"; }, /seed/], [b => { b.seed = 1.5; }, /seed/], [b => { delete b.cars; }, /cars/], [b => { b.cars = [b.cars[0]]; }, /cars must hold exactly 2/],
    [b => { b.cars[1].role = "baseline"; }, /cars\[1\]\.role/], [b => { b.cars[0].role = "bot"; }, /cars\[0\]\.role/], [b => { b.cars[0].lap = "80.9"; }, /cars\[0\]\.lap/], [b => { b.cars[1].lap = -1; }, /cars\[1\]\.lap/], [b => { b.cars[1].lap = NaN; }, /cars\[1\]\.lap/],
    [b => { b.cars[0].sectors = [27, 31]; }, /cars\[0\]\.sectors/], [b => { b.cars[1].sectors = [27, "31", 22]; }, /cars\[1\]\.sectors/], [b => { delete b.cars[0].sectors; }, /cars\[0\]\.sectors/],
    [b => { delete b.cars[0].vmax_kmh; }, /cars\[0\]\.vmax_kmh/], [b => { b.cars[1].vmin_becketts_kmh = null; }, /cars\[1\]\.vmin_becketts_kmh/], [b => { b.cars[1].vmin_becketts_kmh = 400; }, /cars\[1\]\.vmin_becketts_kmh/],
    [b => { b.cars[0] = null; }, /cars\[0\]/],
  ];
  for (const [mutate, re] of cases) { const b = good(); mutate(b); const r = await post(app, "/api/race/result", b); assert.equal(r.status, 400, JSON.stringify(b)); assert.equal(r.body.error.code, "BAD_INPUT"); assert.match(r.body.error.message, re); }
  const nf = await post(app, "/api/race/result", Object.assign(good(), { experiment_id: "01NOPE" })); assert.equal(nf.status, 404); assert.equal(nf.body.error.code, "NOT_FOUND");
  assert.equal((await json(app, "/api/ledger")).body.data[0].status, "planned");   // nothing was written
});
test("server/scripts/fake-race.js posts a plausible result for the newest row over HTTP (measured Δ ≈ 1.2 × predicted, seeded)", async () => {
  mock.reset(); const dir = tmp(); const { app } = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 9 } })).body.data;
  const { serve } = require("@hono/node-server"); const srv = await new Promise(r => { const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => r(s)); });
  try {
    const port = srv.address().port, script = path.join(__dirname, "..", "server", "scripts", "fake-race.js");
    const spawnScript = a => new Promise(res => { const k = require("child_process").spawn(process.execPath, [script, ...a], { timeout: 15000 }); let stdout = "", stderr = ""; k.stdout.on("data", d => stdout += d); k.stderr.on("data", d => stderr += d); k.on("close", status => res({ status, stdout, stderr })); });   // async: spawnSync would block the in-process server
    const run = (...a) => spawnScript(["--port", String(port), ...a]);
    const r = await run("--seed", "7"); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, new RegExp("fake-race " + x.id + " seed 7"));
    const row = (await json(app, "/api/experiments/" + x.id)).body.data; assert.equal(row.status, "raced"); assert.equal(row.measured.label, "measured in race, seed 7");
    assert.ok(row.measured.agreement_pct >= 5 && row.measured.agreement_pct <= 40, "agreement " + row.measured.agreement_pct); assert.equal(row.measured.baseline.sectors.length, 3);
    const again = await run("--seed", "7"); assert.equal(again.stdout, r.stdout);   // seeded: same numbers
    const other = await run("--seed", "8", "--id", x.id, "--factor", "1.0", "--noise", "0"); assert.match(other.stdout, /agreement_pct 0,/);
    const empty = await spawnScript(["--port", "1"]);   // nothing listening -> clear failure, exit 1
    assert.equal(empty.status, 1); assert.match(empty.stderr, /fake-race FAILED/);
  } finally { srv.close(); }
});
test("collect: n plan calls with random candidates, fresh session per call, status counts them", async () => {
  mock.reset(); const { app, collect } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  const res = await collect(6, { seed: 42 }); assert.equal(res.ok, 6); assert.equal(mock.count(), 6);
  const sessions = new Set(mock.inputs.map(i => i.sessionId)); assert.equal(sessions.size, 6);
  const st = (await json(app, "/api/status")).body.data; assert.equal(st.calls_trained, 6); assert.equal(st.experiments, 6);
});
test("server without MUBIT_API_KEY refuses to start (exit 1) when MUBIT_MOCK is unset", () => {
  const env = Object.assign({}, process.env); delete env.MUBIT_API_KEY; delete env.MUBIT_MOCK; env.PURPLE_ENV_FILE = "/nonexistent/.env";
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "server", "index.js")], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 1); assert.match(r.stderr, /MUBIT_API_KEY/);
});
test("G-MUBIT-06 only server/mubit.js names the gateway host", () => {
  const { execSync } = require("child_process"); const out = execSync("grep -rl 'api." + "mubit.ai' --include=*.js --exclude-dir=node_modules . || true", { cwd: path.join(__dirname, ".."), encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(out, ["./server/mubit.js"]);
});
