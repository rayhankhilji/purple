// PURPLE - P3.T6 freeze step: server/scripts/snapshot.js copies data/ into docs/ledger-snapshot/<stamp>/ with a README of row counts.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const mock = require("./mocks/mubit.js");
const { createApp } = require("../server/app.js");
const { snapshot, FILES } = require("../server/scripts/snapshot.js");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "purple-snap-"));
const SCRIPT = path.join(__dirname, "..", "server", "scripts", "snapshot.js");

test("snapshot(): copies every data file byte for byte, counts experiments/calls/rules/exam, writes README.md + counts.json, never touches data/", async () => {
  mock.reset(); const data = tmp(), out = tmp(); const { app, db, collect } = createApp({ dataDir: data, mubit: mock, log: () => {} });
  const post = (url, b) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
  await collect(3, { seed: 42 }); const x = (await post("/api/plan", { scenario_overrides: { seed: 9 } })).data;
  await post("/api/race/result", { experiment_id: x.id, seed: 9, cars: [{ role: "baseline", lap: 80.9, sectors: [27, 31, 22.9], vmax_kmh: 330, vmin_becketts_kmh: 200 }, { role: "candidate", lap: 81.0, sectors: [27, 31.1, 22.9], vmax_kmh: 325, vmin_becketts_kmh: 204 }] });
  await post("/api/overrule", { experiment_id: x.id, verdict: "reject", reason: "judge on the full lap" }); await post("/api/rules/R-01", { active: false });
  await post("/api/status", { task_name: "Research engineer of F1", kept_examples: 43, adapter_version: "v1", test_result: "training v1" });
  db.writeExam([{ id: "ex-1", scenario: x.scenario, truth: { verdict: "reject", next_parameter: "rear_wing_deg", direction: "decrease" } }]);
  fs.appendFileSync(path.join(data, "ledger.jsonl"), "{not json\n");   // a torn line must not break the freeze
  const before = Object.fromEntries(fs.readdirSync(data).map(f => [f, fs.readFileSync(path.join(data, f))]));
  const r = snapshot({ data, out, label: "freeze test!", at: new Date("2026-10-24T22:30:05.123Z") });
  assert.equal(r.name, "2026-10-24_22-30-05Z-freeze-test-"); assert.equal(r.dir, path.join(out, r.name)); assert.deepEqual(r.missing, []);
  assert.deepEqual(r.files.map(f => f.name), FILES); for (const f of FILES) assert.deepEqual(fs.readFileSync(path.join(r.dir, f)), before[f], f + " copied byte for byte");
  const c = r.counts; assert.equal(c.experiments, 4); assert.equal(c.ledger_rows, 6); assert.equal(c.ledger_torn_lines, 1);   // 4 plans + race + overrule rows, 1 torn
  assert.deepEqual(c.by_status, { planned: 3, overruled: 1 }); assert.equal(c.raced, 1); assert.equal(c.with_agreement_pct, 1); assert.equal(c.overruled, 1); assert.equal(c.unique_session_ids, 4); assert.equal(c.mubit_request_ids, 4);
  assert.equal(c.calls.total, 4); assert.equal(c.calls.trained, 4); assert.deepEqual(c.calls.by_kind, { plan: { total: 4, trained: 4, untrained: 0 } });
  assert.deepEqual(c.rules, { total: 1, active: 0 }); assert.equal(c.exam_items, 1); assert.equal(c.status.kept_examples, 43); assert.equal(c.status.test_result, "training v1"); assert.ok(c.status.last_console_read_at);
  const readme = fs.readFileSync(path.join(r.dir, "README.md"), "utf8");
  assert.match(readme, /^# PURPLE ledger snapshot 2026-10-24_22-30-05Z-freeze-test-/); assert.match(readme, /\*\*4 experiments\*\*/); assert.match(readme, /6 rows/); assert.match(readme, /1 unreadable lines skipped/); assert.match(readme, /Mubit calls: 4 \(4 trained, 0 untrained\)/); assert.match(readme, /Rules: 1 \(0 active\)\. Exam items: 1\./); assert.match(readme, /kept examples 43/);
  assert.match(readme, /sha256 `6c5be1a3f4ed0f5fb21226363fa3524404996558628bc8cba119677dfc37ce6a`/); assert.match(readme, /reduced-order lap model · calibrated to 2026 pole laps · aero map v1/); assert.doesNotMatch(readme, /CFD|wind.tunnel|validated/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.dir, "counts.json"), "utf8")), c);
  assert.deepEqual(Object.fromEntries(fs.readdirSync(data).map(f => [f, fs.readFileSync(path.join(data, f))])), before, "data/ unchanged");
  assert.throws(() => snapshot({ data, out, label: "freeze test!", at: new Date("2026-10-24T22:30:05.123Z") }), /refusing to overwrite/);
});
test("snapshot CLI: --data/--out/--label, missing files listed, exit 1 on an existing dir", () => {
  const data = tmp(), out = tmp(); fs.writeFileSync(path.join(data, "ledger.jsonl"), ""); fs.writeFileSync(path.join(data, "rules.json"), "[]");
  const run = a => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: "utf8", timeout: 20000 });
  const r = run(["--data", data, "--out", out, "--label", "p3"]); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /snapshot .*-p3: 2 files copied \(missing: calls\.jsonl, status\.json, exam\.json, state\.json\); 0 experiments, 0 calls \(0 trained\), 0 rules, 0 exam items/);
  const dirs = fs.readdirSync(out); assert.equal(dirs.length, 1); assert.match(dirs[0], /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}Z-p3$/); assert.deepEqual(fs.readdirSync(path.join(out, dirs[0])).sort(), ["README.md", "counts.json", "ledger.jsonl", "rules.json"]);
  fs.mkdirSync(path.join(out, "x")); const bad = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(SCRIPT)}).snapshot({ data: ${JSON.stringify(data)}, out: ${JSON.stringify(path.join(out))}, label: "x", at: new Date(0) })`], { encoding: "utf8" }); assert.equal(bad.status, 0);
  const again = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(SCRIPT)}).snapshot({ data: ${JSON.stringify(data)}, out: ${JSON.stringify(path.join(out))}, label: "x", at: new Date(0) })`], { encoding: "utf8" }); assert.equal(again.status, 1); assert.match(again.stderr, /refusing to overwrite/);
});
