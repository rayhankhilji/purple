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
test("P2.T3 overrule: rule text is whitespace-collapsed and cut at 160 chars; fields validated; response carries rule + experiment", async () => {
  mock.reset(); const dir = tmp(); const { app } = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 5 } })).body.data;
  const long = "  Never   trade\n\tmore than 2 km/h of Hangar top speed for Becketts load; " + "judge on the full lap. ".repeat(12);
  const o = await post(app, "/api/overrule", { experiment_id: x.id, verdict: "reject", reason: long, by: "  Tanuj " });
  assert.equal(o.status, 200); const rule = o.body.data.rule;
  assert.ok(rule.text.length <= 160 && rule.text.length >= 150, rule.text.length); assert.doesNotMatch(rule.text, /\s\s|\n|\t/); assert.doesNotMatch(rule.text, /\s$/); assert.match(rule.text, /^Never trade more than 2 km\/h/);
  assert.equal(o.body.data.experiment.id, x.id); assert.equal(o.body.data.experiment.status, "overruled"); assert.equal(o.body.data.experiment.overrule.by, "Tanuj"); assert.equal(o.body.data.experiment.overrule.reason, rule.text);
  for (const b of [{ verdict: "reject", reason: "x" }, { experiment_id: x.id, verdict: "maybe", reason: "x" }, { experiment_id: x.id, verdict: "reject", reason: "   \n " }, { experiment_id: x.id, verdict: "reject" }]) { const r = await post(app, "/api/overrule", b); assert.equal(r.status, 400, JSON.stringify(b)); assert.equal(r.body.error.code, "BAD_INPUT"); }
  assert.equal((await post(app, "/api/overrule", { experiment_id: "01NOPE", verdict: "reject", reason: "x" })).status, 404);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "rules.json"), "utf8")).length, 1);
});
test("P2.T3 R-xx numbering = max existing id + 1: survives a deleted rule, a toggled rule and hand-edited ids", async () => {
  mock.reset(); const dir = tmp(); const { app, db } = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 5 } })).body.data;
  const add = async t => (await post(app, "/api/overrule", { experiment_id: x.id, verdict: "reject", reason: t })).body.data.rule.id;
  assert.equal(await add("one"), "R-01"); assert.equal(await add("two"), "R-02"); assert.equal(await add("three"), "R-03");
  db.writeRules(db.readRules().filter(r => r.id !== "R-02"));   // someone deleted R-02 by hand
  assert.equal(await add("four"), "R-04");
  await post(app, "/api/rules/R-04", { active: false }); assert.equal(await add("five"), "R-05");
  db.writeRules(db.readRules().filter(r => r.id === "R-01").concat([{ id: "weird", text: "legacy", active: true }]));   // only R-01 + a malformed id remain
  assert.equal(await add("six"), "R-02");
  db.writeRules([]); assert.equal(await add("seven"), "R-01");
  assert.equal(new Set(db.readRules().map(r => r.id)).size, db.readRules().length);
});
test("P2.T3 GET /api/rules?active=1|0 filters; POST /api/rules/:id toggles with a boolean, 404 unknown, 400 non-boolean", async () => {
  mock.reset(); const { app } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 5 } })).body.data;
  for (const t of ["a", "b", "c"]) await post(app, "/api/overrule", { experiment_id: x.id, verdict: "retest", reason: t });
  const t = await post(app, "/api/rules/R-02", { active: false }); assert.equal(t.status, 200); assert.equal(t.body.data.active, false); assert.equal(t.body.data.id, "R-02"); assert.equal(t.body.data.text, "b"); assert.ok(t.body.data.updated_at);
  assert.deepEqual((await json(app, "/api/rules")).body.data.map(r => r.id), ["R-01", "R-02", "R-03"]);
  assert.deepEqual((await json(app, "/api/rules?active=1")).body.data.map(r => r.id), ["R-01", "R-03"]);
  assert.deepEqual((await json(app, "/api/rules?active=true")).body.data.map(r => r.id), ["R-01", "R-03"]);
  assert.deepEqual((await json(app, "/api/rules?active=0")).body.data.map(r => r.id), ["R-02"]);
  assert.equal((await json(app, "/api/rules?active=maybe")).status, 400);
  assert.equal((await post(app, "/api/rules/R-02", { active: true })).body.data.active, true); assert.equal((await json(app, "/api/rules?active=0")).body.data.length, 0);
  assert.equal((await post(app, "/api/rules/R-09", { active: true })).status, 404);
  const bad = await post(app, "/api/rules/R-01", { active: "no" }); assert.equal(bad.status, 400); assert.match(bad.body.error.message, /active must be a boolean/); assert.equal((await json(app, "/api/rules/")).status, 404);
  // the next scenario carries exactly the active rules, in id order
  const y = (await post(app, "/api/plan", { scenario_overrides: { seed: 6 } })).body.data; assert.deepEqual(y.scenario.rules, ["a", "b", "c"]); assert.deepEqual(y.rules_applied, ["R-01", "R-02", "R-03"]);
});
test("P2.T3 SSE: /api/plan emits plan; overrule emits rule then plan (status overruled); toggle emits rule; promote emits plan (status promoted)", async () => {
  mock.reset(); const { app } = createApp({ dataDir: tmp(), mubit: mock, log: () => {}, heartbeatMs: 50 });
  const sse = await sseUntil(app, /event: plan[\s\S]*event: rule[\s\S]*event: plan[\s\S]*event: rule[\s\S]*event: plan/, 20);
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 5 } })).body.data;
  await post(app, "/api/overrule", { experiment_id: x.id, verdict: "reject", reason: "judge on the full lap" });
  await post(app, "/api/rules/R-01", { active: false });
  await post(app, "/api/promote", { experiment_id: x.id });
  const buf = await sse.read(); const plans = sseEvent(buf, "plan"), rules = sseEvent(buf, "rule");
  assert.equal(plans.length, 3); assert.deepEqual(plans.map(p => p.status), ["planned", "overruled", "promoted"]); assert.ok(plans.every(p => p.id === x.id && p.plan && p.evaluation && p.scenario));
  assert.equal(plans[1].overrule.rule_id, "R-01"); assert.equal(plans[1].overrule.reason, "judge on the full lap");
  assert.equal(rules.length, 2); assert.deepEqual(rules.map(r => [r.id, r.active, r.text]), [["R-01", true, "judge on the full lap"], ["R-01", false, "judge on the full lap"]]); assert.equal(rules[0].from_experiment, x.id);
  const order = buf.split("\n\n").map(ch => (/event: (\w+)/.exec(ch) || [])[1]).filter(e => e && e !== "ping");
  assert.deepEqual(order, ["status", "plan", "rule", "plan", "rule", "plan"]);
});
test("status widget: GET /api/status carries prompt_hash, last_console_read_at and budget counted per UTC day (00:00 UTC = 01:00 London)", async () => {
  mock.reset(); const dir = tmp(); const { app, db } = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const s0 = (await json(app, "/api/status")).body.data;
  assert.equal(s0.prompt_hash, "6c5be1a3f4ed0f5fb21226363fa3524404996558628bc8cba119677dfc37ce6a"); assert.equal(s0.last_console_read_at, null);
  assert.deepEqual(s0.budget, { day_utc: new Date().toISOString().slice(0, 10), trained_today_utc: 0, untrained_today_utc: 0, resets_at: s0.budget.resets_at, boundary: "00:00 UTC = 01:00 London" });
  assert.equal(s0.budget.resets_at, new Date(Date.parse(s0.budget.day_utc + "T00:00:00Z") + 864e5).toISOString());
  // rows around the boundary: yesterday 23:59:59Z does not count, today 00:00:00Z does; illegal rows never count
  const day = s0.budget.day_utc, yday = new Date(Date.parse(day + "T00:00:00Z") - 1000).toISOString();
  const row = (kind, trained, created_at) => db.appendCall({ id: kind + created_at, created_at, kind, trained, session_id: null, mubit_request_id: trained || kind === "illegal" ? null : "mreq_x", model: null, latency_ms: 0, status: "ok" });
  row("plan", true, yday); row("smoke", false, yday); row("plan", true, day + "T00:00:00.000Z"); row("plan", true, new Date().toISOString()); row("exam", false, new Date().toISOString()); row("smoke", false, day + "T12:00:00Z"); row("illegal", false, new Date().toISOString());
  const s1 = (await json(app, "/api/status")).body.data; assert.equal(s1.budget.trained_today_utc, 2); assert.equal(s1.budget.untrained_today_utc, 2); assert.equal(s1.calls_total, 7); assert.equal(s1.calls_trained, 3);
  await post(app, "/api/plan", { scenario_overrides: { seed: 9 } }); assert.equal((await json(app, "/api/status")).body.data.budget.trained_today_utc, 3);
  // a console read-out stamps last_console_read_at; a non-console patch does not; an explicit value wins; garbage is rejected
  const t0 = Date.now(); const s2 = (await post(app, "/api/status", { task_name: "Research engineer of F1", kept_examples: 43, adapter_version: "v1" })).body.data;
  assert.equal(s2.kept_examples, 43); assert.ok(Date.parse(s2.last_console_read_at) >= t0 - 5); assert.equal(s2.budget.trained_today_utc, 3); assert.equal(s2.prompt_hash, s0.prompt_hash);
  const s3 = (await post(app, "/api/status", { test_result: "pass" })).body.data; assert.ok(Date.parse(s3.last_console_read_at) >= Date.parse(s2.last_console_read_at));
  const s4 = (await post(app, "/api/status", { note: "unrelated", budget: { trained_today_utc: 999 }, prompt_hash: "fake" })).body.data; assert.equal(s4.last_console_read_at, s3.last_console_read_at); assert.equal(s4.budget.trained_today_utc, 3); assert.equal(s4.prompt_hash, s0.prompt_hash); assert.equal(s4.note, "unrelated");
  const s5 = (await post(app, "/api/status", { kept_examples: 50, last_console_read_at: "2026-10-24T00:05:00Z" })).body.data; assert.equal(s5.last_console_read_at, "2026-10-24T00:05:00Z"); assert.equal(s5.kept_examples, 50);
  const bad = await post(app, "/api/status", { last_console_read_at: "yesterday-ish" }); assert.equal(bad.status, 400); assert.match(bad.body.error.message, /last_console_read_at/);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8")); assert.equal(persisted.last_console_read_at, "2026-10-24T00:05:00Z"); assert.equal("budget" in persisted, false); assert.equal("prompt_hash" in persisted, false);
  // the SSE status event carries the same view
  const sse = await sseUntil(app, /event: status/, 2); const buf = await sse.read(); const ev = sseEvent(buf, "status")[0]; assert.equal(ev.budget.trained_today_utc, 3); assert.equal(ev.last_console_read_at, "2026-10-24T00:05:00Z"); assert.equal(ev.prompt_hash, s0.prompt_hash);
});
test("POST /api/status deep-merges one level: { exam: { v1: 4 } } keeps provider/total; a scalar replaces; nested objects are not merged deeper", async () => {
  mock.reset(); const dir = tmp(); const { app } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  let s = (await post(app, "/api/status", { exam: { provider: 20, total: 20, provider_param: 10 }, kept_examples: 43 })).body.data; assert.deepEqual(s.exam, { provider: 20, total: 20, provider_param: 10 });
  s = (await post(app, "/api/status", { exam: { v1: 4 } })).body.data; assert.deepEqual(s.exam, { provider: 20, total: 20, provider_param: 10, v1: 4 }); assert.equal(s.kept_examples, 43);
  s = (await post(app, "/api/status", { exam: { v2: 12, v1: null } })).body.data; assert.deepEqual(s.exam, { provider: 20, total: 20, provider_param: 10, v1: null, v2: 12 });   // explicit null clears one field
  s = (await post(app, "/api/status", { exam: { total: 20, nested: { a: 1 } } })).body.data; assert.deepEqual(s.exam.nested, { a: 1 });
  s = (await post(app, "/api/status", { exam: { nested: { b: 2 } } })).body.data; assert.deepEqual(s.exam.nested, { b: 2 });   // only one level deep
  s = (await post(app, "/api/status", { exam: "n/a" })).body.data; assert.equal(s.exam, "n/a");   // a scalar replaces the object
  s = (await post(app, "/api/status", { exam: { provider: 19 } })).body.data; assert.deepEqual(s.exam, { provider: 19 });   // and an object replaces a scalar
  const sse = await sseUntil(app, /event: status/, 2); const ev = sseEvent(await sse.read(), "status")[0]; assert.deepEqual(ev.exam, { provider: 19 });
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
  assert.equal(b.measured.supersedes, a.measured.at); assert.equal(b.measured.label, "measured in race, seed 2"); assert.ok(Math.abs(b.measured.agreement_pct - 50) <= 1, "agreement " + b.measured.agreement_pct);   // ±1: laps are rounded to 3 dp
  const raw = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(raw.length, 3); assert.ok(raw.every(r => r.id === x.id));
  const led = (await json(app, "/api/ledger")).body.data; assert.equal(led.length, 1); assert.equal(led[0].measured.seed, 2); assert.ok(Math.abs(led[0].measured.agreement_pct - 50) <= 1);
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
test("POST /api/collect requires confirm: \"trained\" and caps n at 60 (trained calls spend budget)", async () => {
  mock.reset(); const { app } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  for (const b of [{ n: 2 }, { n: 2, confirm: "yes" }, { n: 2, confirm: true }]) { const r = await post(app, "/api/collect", b); assert.equal(r.status, 400); assert.equal(r.body.error.code, "BAD_INPUT"); assert.match(r.body.error.message, /confirm must be "trained"/); }
  for (const n of [0, -1, 1.5, "2", undefined, 61, 200]) { const r = await post(app, "/api/collect", { n, confirm: "trained" }); assert.equal(r.status, 400, "n=" + n); assert.match(r.body.error.message, /^n must be/); }
  assert.equal(mock.count(), 0);   // nothing was sent
  const okr = await post(app, "/api/collect", { n: 2, confirm: "trained", seed: 42 }); assert.equal(okr.status, 200); assert.equal(okr.body.data.ok, 2); assert.equal(mock.count(), 2);
});
test("G-MUBIT-02 every calls.jsonl row written by a non-plan path (exam, smoke, illegal) has trained: false; the writer refuses otherwise", async () => {
  mock.reset(); const dir = tmp(); const { app, db, runExam } = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const x = (await post(app, "/api/plan", { scenario_overrides: { seed: 9 } })).body.data;   // one trained plan row
  db.writeExam([{ id: "ex-1", scenario: x.scenario, truth: { verdict: "reject", next_parameter: "rear_wing_deg", direction: "decrease" } }, { id: "ex-2", scenario: x.scenario, truth: { verdict: "promote", next_parameter: "ride_height_mm", direction: "decrease" } }]);
  const exam = await runExam(); assert.equal(exam.total, 2); assert.equal(exam.provider, 1);
  assert.ok(mock.inputs.filter(i => i.kind === "exam").every(i => i.trained === false), "exam calls carry the untrained flag to the client");
  await post(app, "/api/state", { td01: true }); await post(app, "/api/plan", { scenario_overrides: { candidate: Object.assign({}, x.candidate, { rear_wing_deg: 25 }) } });   // an illegal row
  const smoke = spawnSync(process.execPath, [path.join(__dirname, "..", "server", "scripts", "smoke.js")], { env: Object.assign({}, process.env, { MUBIT_MOCK: "1", PURPLE_DATA_DIR: dir, PURPLE_ENV_FILE: "/nonexistent/.env" }), encoding: "utf8", timeout: 20000 });
  assert.equal(smoke.status, 0, smoke.stderr); assert.match(smoke.stdout, /untrained \[MUBIT_MOCK\]/); assert.match(smoke.stdout, /x-middleware-request-id: mreq_/);
  const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map(c => c.kind).sort(), ["exam", "exam", "illegal", "plan", "smoke"]);
  assert.ok(calls.filter(c => c.kind !== "plan").every(c => c.trained === false), JSON.stringify(calls.map(c => [c.kind, c.trained])));
  assert.ok(calls.filter(c => c.kind === "plan").every(c => c.trained === true));
  assert.throws(() => db.appendCall({ id: "bad", kind: "exam", trained: true }), /G-MUBIT-02/); assert.throws(() => db.appendCall({ id: "bad", kind: "smoke" }), /G-MUBIT-02/);
  assert.equal(fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").length, 5);   // the refused rows were not written
});
test("server start logs the frozen prompt hash (G-MUBIT-01) and binds 127.0.0.1", async () => {
  const { spawn } = require("child_process"); const env = Object.assign({}, process.env, { MUBIT_MOCK: "1", PURPLE_PORT: "0", PURPLE_DATA_DIR: tmp(), PURPLE_ENV_FILE: "/nonexistent/.env" });
  const k = spawn(process.execPath, [path.join(__dirname, "..", "server", "index.js")], { env }); let out = "";
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no startup line: " + out)), 15000); k.stdout.on("data", d => { out += d; if (/PURPLE server http/.test(out)) { clearTimeout(t); res(); } }); k.on("exit", c => rej(new Error("exited " + c + ": " + out))); });
  k.kill();
  assert.match(out, /PURPLE prompt sha256 6c5be1a3f4ed0f5fb21226363fa3524404996558628bc8cba119677dfc37ce6a \(PROMPT_VERSION 1\)\n/); assert.doesNotMatch(out, /differs/); assert.match(out, /PURPLE server http:\/\/127\.0\.0\.1:\d+/);
});
test("collect promote_bias: 0 keeps v1 candidates (source random); 1 draws only promote-class moves (random-biased); 0.3 matches the seeded replay", async () => {
  const scenarios = require("../server/scenarios.js");
  const run = async bias => { mock.reset(); const a = createApp({ dataDir: tmp(), mubit: mock, log: () => {} }); const res = await a.collect(8, { seed: 77, promote_bias: bias }); return { a, res, rows: a.db.readLedger().slice().reverse() }; };
  const none = await run(undefined), zero = await run(0);
  assert.equal(zero.res.promote_bias, 0); assert.equal(zero.res.biased, 0); assert.ok(zero.rows.every(r => r.candidate_source === "random"));
  assert.deepEqual(zero.rows.map(r => r.candidate), none.rows.map(r => r.candidate));   // bias 0 == the v1 generator (same seeds, same candidates)
  const one = await run(1); const promote = scenarios.movesByVerdict(one.a.EI.evaluator, one.a.EI.aero.BASELINE, { circuit: "silverstone", wet: false, wind_ms: 0, wind_from_deg: 0 }, { td01: false }).promote.map(m => JSON.stringify(m.candidate));
  assert.equal(one.res.biased, 8); assert.ok(one.rows.every(r => r.candidate_source === "random-biased"));
  assert.ok(one.rows.every(r => promote.includes(JSON.stringify(r.candidate))), "every biased candidate is a promote-class move");
  const some = await run(0.3); const { U } = some.a.EI; const { seededRng } = require("../server/app.js"); const expect = some.res.seeds.filter(sd => seededRng(U, sd)() < 0.3).length;
  assert.equal(some.res.biased, expect); assert.equal(some.rows.filter(r => r.candidate_source === "random-biased").length, expect);
  for (const bad of [-0.1, 1.5, "x"]) await assert.rejects(() => zero.a.collect(1, { promote_bias: bad }), /promote_bias must be a number between 0 and 1/);
});
test("collect seeds are mixed per item: the first rng draw differs across a run (xorshift32 first output is ~linear in the seed), rows stay replayable", async () => {
  mock.reset(); const a = createApp({ dataDir: tmp(), mubit: mock, log: () => {} }); const { U } = a.EI;
  const { seededRng } = require("../server/app.js"); const res = await a.collect(12, { seed: 2 }); const firsts = new Set(res.seeds.map(sd => seededRng(U, sd)().toFixed(2)));   // the rng the generator actually gets
  assert.ok(firsts.size >= 8, "first draws collapsed: " + [...firsts].join(","));   // unmixed seeds 2000..2011 all gave 0.12
  assert.equal(new Set(res.seeds).size, 12); assert.ok(res.seeds.every(sd => Number.isInteger(sd) && sd > 0 && sd < 2 ** 31));
  const rows = a.db.readLedger(); const firstParams = new Set(rows.map(r => r.change.split(",")[0].split(" ")[0])); assert.ok(firstParams.size >= 3, "every candidate moved the same first parameter: " + [...firstParams]);
  // a row is reproducible from its own seed: the same candidate and conditions come back
  const r0 = rows[rows.length - 1]; const g = require("../server/scenarios.js").generate(seededRng(U, r0.seed), { circuit: "silverstone", baseline: a.EI.aero.BASELINE, td01: false }); assert.deepEqual(g.candidate, r0.candidate); assert.deepEqual(g.conditions, r0.conditions);
});
test("dryCollect / collect-dry.js: same seeds as collect, verdict mix from the truth rule, no Mubit call, nothing written", async () => {
  mock.reset(); const dir = tmp(); const a = createApp({ dataDir: dir, mubit: mock, log: () => {} });
  const dry = a.dryCollect(10, { seed: 42, promote_bias: 0.3 });
  assert.equal(dry.items.length, 10); assert.equal(dry.verdicts.promote + dry.verdicts.retest + dry.verdicts.reject, 10); assert.equal(dry.conditions.dry + dry.conditions.wind + dry.conditions.wet, 10);
  assert.ok(dry.delta_lap.min <= dry.delta_lap.mean && dry.delta_lap.mean <= dry.delta_lap.max); assert.ok(dry.items.every(it => ["promote", "retest", "reject"].includes(it.verdict) && typeof it.change === "string"));
  assert.equal(dry.biased, dry.items.filter(it => it.candidate_source === "random-biased").length);
  assert.equal(mock.count(), 0); assert.equal(fs.existsSync(path.join(dir, "ledger.jsonl")), false); assert.equal(fs.existsSync(path.join(dir, "calls.jsonl")), false);
  // the real collect() with the same seed/bias produces the same candidates in the same order (the dry run is a faithful preview)
  const real = await a.collect(10, { seed: 42, promote_bias: 0.3 }); const rows = a.db.readLedger().slice().reverse();
  assert.deepEqual(rows.map(r => r.seed), dry.items.map(it => it.seed)); assert.deepEqual(rows.map(r => r.change), dry.items.map(it => it.change)); assert.deepEqual(rows.map(r => r.candidate_source), dry.items.map(it => it.candidate_source)); assert.equal(real.biased, dry.biased);
  assert.deepEqual(rows.map(r => require("../server/scenarios.js").verdictOf(r.evaluation.delta_lap)), dry.items.map(it => it.verdict));
  assert.equal(a.dryCollect(6, { seed: 42, promote_bias: 1 }).biased, 6); assert.throws(() => a.dryCollect(1, { promote_bias: 2 }), /promote_bias/); assert.throws(() => a.dryCollect(1, { circuit: "spa" }), /circuit/);
  const dir2 = tmp(), env = Object.assign({}, process.env, { PURPLE_DATA_DIR: dir2, PURPLE_ENV_FILE: "/nonexistent/.env" }); delete env.MUBIT_API_KEY; delete env.MUBIT_MOCK;   // no key, no mock: the script must still run (no planner needed)
  const cli = spawnSync(process.execPath, [path.join(__dirname, "..", "server", "scripts", "collect-dry.js"), "--n", "10", "--seed", "42", "--promote-bias", "0.3", "--list"], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /collect-dry: n=10 seed=42 circuit=silverstone promote_bias=0.3/); assert.match(cli.stdout, new RegExp("promote " + dry.verdicts.promote + " \\(")); assert.match(cli.stdout, /promote-biased draws \d+/); assert.equal((cli.stdout.match(/^  \d+ /gm) || []).length, 10);
  assert.deepEqual(fs.readdirSync(dir2), []);
  const bad = spawnSync(process.execPath, [path.join(__dirname, "..", "server", "scripts", "collect-dry.js"), "--n", "0"], { env, encoding: "utf8", timeout: 30000 }); assert.equal(bad.status, 1); assert.match(bad.stderr, /--n must be/);
});
test("POST /api/collect accepts promote_bias (0..1) and rejects others; npm run collect -- --promote-bias prints it (mock, temp data dir)", async () => {
  mock.reset(); const { app } = createApp({ dataDir: tmp(), mubit: mock, log: () => {} });
  const r = await post(app, "/api/collect", { n: 3, confirm: "trained", seed: 5, promote_bias: 1 }); assert.equal(r.status, 200); assert.equal(r.body.data.promote_bias, 1); assert.equal(r.body.data.biased, 3);
  const led = (await json(app, "/api/ledger")).body.data; assert.ok(led.every(x => x.candidate_source === "random-biased"));
  const bad = await post(app, "/api/collect", { n: 1, confirm: "trained", promote_bias: 2 }); assert.equal(bad.status, 400); assert.match(bad.body.error.message, /promote_bias/);
  const dir = tmp(), env = Object.assign({}, process.env, { MUBIT_MOCK: "1", PURPLE_DATA_DIR: dir, PURPLE_ENV_FILE: "/nonexistent/.env" }); delete env.MUBIT_API_KEY;
  const cli = spawnSync(process.execPath, [path.join(__dirname, "..", "server", "scripts", "collect.js"), "--n", "4", "--seed", "3", "--promote-bias", "0.5"], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /collect: n=4 seed=3 circuit=silverstone with_rules=false promote_bias=0.5 concurrency=2/); assert.match(cli.stdout, /\[MUBIT_MOCK\]/); assert.match(cli.stdout, /promote-biased \d+/);
  const rows = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(rows.length, 4); assert.ok(rows.every(x => ["random", "random-biased"].includes(x.candidate_source)));
  const badCli = spawnSync(process.execPath, [path.join(__dirname, "..", "server", "scripts", "collect.js"), "--n", "1", "--promote-bias", "3"], { env, encoding: "utf8", timeout: 30000 }); assert.equal(badCli.status, 1); assert.match(badCli.stderr, /--promote-bias must be/);
});
test("MUBIT_MOCK=1 without PURPLE_DATA_DIR -> data-mock/ (never the real ledger): createApp default, server startup line, scripts' --data flag", async () => {
  const ROOT = path.join(__dirname, ".."); const env0 = { PURPLE_DATA_DIR: process.env.PURPLE_DATA_DIR, MUBIT_MOCK: process.env.MUBIT_MOCK };
  try {
    delete process.env.PURPLE_DATA_DIR; process.env.MUBIT_MOCK = "1"; assert.equal(createApp({ mubit: mock, log: () => {} }).db.dir, path.join(ROOT, "data-mock"));
    delete process.env.MUBIT_MOCK; assert.equal(createApp({ mubit: mock, log: () => {} }).db.dir, path.join(ROOT, "data"));
    process.env.MUBIT_MOCK = "1"; process.env.PURPLE_DATA_DIR = "/tmp/purple-explicit"; assert.equal(createApp({ mubit: mock, log: () => {}, dataDir: tmp() }).db.dir.startsWith(os.tmpdir()), true); assert.equal(createApp({ mubit: mock, log: () => {} }).db.dir, "/tmp/purple-explicit");
  } finally { for (const k of Object.keys(env0)) { if (env0[k] == null) delete process.env[k]; else process.env[k] = env0[k]; } }
  assert.match(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /^data-mock\/$/m);
  const { spawn } = require("child_process"); const env = Object.assign({}, process.env, { MUBIT_MOCK: "1", PURPLE_PORT: "0", PURPLE_ENV_FILE: "/nonexistent/.env" }); delete env.PURPLE_DATA_DIR;
  const k = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env }); let out = "";
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no startup line: " + out)), 15000); k.stdout.on("data", d => { out += d; if (/PURPLE server http/.test(out)) { clearTimeout(t); res(); } }); k.on("exit", c => rej(new Error("exited " + c + ": " + out))); });
  k.kill(); assert.match(out, new RegExp("data " + path.join(ROOT, "data-mock").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s"));
  // --data on the CLIs wins over PURPLE_DATA_DIR
  const dir = tmp(), other = tmp(); const cli = spawnSync(process.execPath, [path.join(ROOT, "server", "scripts", "collect.js"), "--n", "1", "--seed", "1", "--data", dir], { env: Object.assign({}, env, { PURPLE_DATA_DIR: other }), encoding: "utf8", timeout: 30000 });
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, new RegExp("data=" + dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); assert.ok(fs.existsSync(path.join(dir, "ledger.jsonl"))); assert.equal(fs.existsSync(path.join(other, "ledger.jsonl")), false);
  const dry = spawnSync(process.execPath, [path.join(ROOT, "server", "scripts", "collect-dry.js"), "--n", "1", "--data", other], { env, encoding: "utf8", timeout: 30000 }); assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, new RegExp("nothing written to " + other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
test("CORS: the lab page on 127.0.0.1:8788 may call the API on :8787 (preflight + header); other origins get nothing", async () => {
  mock.reset(); const { app } = createApp({ dataDir: tmp(), mubit: mock });
  const pre = await app.request("/api/status", { method: "OPTIONS", headers: { origin: "http://127.0.0.1:8788", "access-control-request-method": "POST", "access-control-request-headers": "content-type, x-client-id" } });
  assert.ok(pre.status === 204 || pre.status === 200); assert.equal(pre.headers.get("access-control-allow-origin"), "http://127.0.0.1:8788"); assert.match(pre.headers.get("access-control-allow-headers") || "", /x-client-id/i);
  const res = await app.request("/api/status", { headers: { origin: "http://localhost:8788" } }); assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:8788");
  const other = await app.request("/api/status", { headers: { origin: "https://evil.example" } }); assert.equal(other.headers.get("access-control-allow-origin"), null);
});
