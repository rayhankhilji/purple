// PURPLE engine dashboard (docs/concept/DASHBOARD.md): the /api/concept/engine routes. Speed run start / progress / final / stop,
// the autonomous (hybrid) Mubit loop in mock mode (deterministic, ~10 iterations, never writes data/), the trained-call guards
// (confirm, typed confirmation, per-run cap, budget counted from files), the garage lap and the car sheet. No network: mock and an
// injected stand-in for server/mubit.js only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const { createApp } = require("../server/app.js");
const route = require("../server/campaign-route.js");
const loop = require("../concept/designer/loop.js"), designerPrompt = require("../concept/designer/prompt.js");
const { localSearch } = require("../concept/campaign/local.js"), { Pool } = require("../concept/campaign/pool.js");
const design = require("../concept/design.js"), regs = require("../concept/regs.js");

const ROOT = path.join(__dirname, "..");
const H = { "content-type": "application/json", host: "127.0.0.1:8787" };
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-engine-test-"));
function app(extra) { return createApp(Object.assign({ dataDir: tmp(), mubit: require("./mocks/mubit.js"), log: () => {}, engineWorkers: 0, engineTmpDir: tmp("purple-engine-runs-") }, extra || {})); }
const get = async (a, u) => (await a.app.request(u, { headers: H })).json();
const post = async (a, u, b) => { const r = await a.app.request(u, { method: "POST", headers: H, body: JSON.stringify(b || {}) }); return { status: r.status, j: await r.json() }; };
async function drain(a, stream) { const t = await (await a.app.request(stream, { headers: H })).text(); return t.split("\n\n").filter(Boolean).map(b => ({ event: (/^event: (.*)$/m.exec(b) || [])[1], data: (/^data: (.*)$/m.exec(b) || [])[1] })).filter(x => x.event && x.data).map(x => ({ event: x.event, data: x.event === "ping" ? x.data : JSON.parse(x.data) })); }
const listData = () => { try { return fs.readdirSync(path.join(ROOT, "data")).sort().join(","); } catch (e) { return ""; } };

test("budget: trained calls are counted from the call files on disk (research ledger + trained designer runs), de-duplicated, never a constant", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "data")); fs.mkdirSync(path.join(root, "docs", "concept", "loop-runs", "trained-seed1"), { recursive: true }); fs.mkdirSync(path.join(root, "docs", "concept", "loop-runs", "live-untrained-1"), { recursive: true });
  const rows = (n, trained, id) => Array.from({ length: n }, (_, i) => JSON.stringify({ kind: "x", trained, mubit_request_id: id ? id + i : null })).join("\n") + "\n";
  fs.writeFileSync(path.join(root, "data", "calls.jsonl"), rows(7, true, "a") + rows(3, false, "u"));
  fs.writeFileSync(path.join(root, "docs", "concept", "loop-runs", "trained-seed1", "calls.jsonl"), rows(5, true, "b") + rows(2, true, "a"));   // 2 duplicates of the ledger's ids
  fs.writeFileSync(path.join(root, "docs", "concept", "loop-runs", "live-untrained-1", "calls.jsonl"), rows(9, true, "c"));                   // not a trained-* run folder
  const extra = tmp(); fs.mkdirSync(path.join(extra, "concept-engine", "eng-1"), { recursive: true }); fs.writeFileSync(path.join(extra, "concept-engine", "eng-1", "calls.jsonl"), rows(4, true, "d"));
  const b = route.trainedBudget(root, [extra]);
  assert.equal(b.used, 7 + 5 + 4); assert.equal(b.remaining, 250 - 16); assert.equal(b.total, 250);
  assert.deepEqual(b.by_source.map(x => x.trained_calls), [7, 5, 4]);
  // this repository: the integrator's trained designer runs are in docs/concept/loop-runs/trained-*: the live counter sees them
  const repo = route.trainedBudget(ROOT, []), trainedDirs = fs.readdirSync(path.join(ROOT, "docs", "concept", "loop-runs")).filter(d => /^trained-/.test(d));
  let n = 0; for (const d of trainedDirs) for (const l of fs.readFileSync(path.join(ROOT, "docs", "concept", "loop-runs", d, "calls.jsonl"), "utf8").split("\n")) if (l.trim() && JSON.parse(l).trained === true) n++;
  assert.ok(repo.used >= n, "counts at least the committed trained designer calls (" + n + ")");
});

test("local search: deterministic, legal only, starts from the proposal (t = 1) and never returns a slower car than the proposal", async () => {
  const pool = new Pool(0), parent = design.baseline({ team: "redbull" }), changes = [{ part: "rear_wing", param: "sm_delta_deg", to: 20 }];
  const a = await localSearch({ parent, changes, pool, benchOpts: { circuit: "silverstone" }, budget: 40, seed: 3 });
  const b = await localSearch({ parent, changes, pool, benchOpts: { circuit: "silverstone" }, budget: 40, seed: 3 });
  assert.deepEqual(a, b);
  assert.ok(a.laps <= 40 && a.laps > 0);
  assert.ok(a.lap_s <= a.proposal_lap_s + 1e-9, "best ≤ proposal");
  const d = design.applyChanges(parent, a.changes).design; assert.deepEqual(regs.check(d), []);
});

test("routes: info, garage lap (legal and illegal, FIA articles, per-corner deltas, legal ranges), car sheet with flags", async () => {
  const a = app();
  const info = (await get(a, "/api/concept/engine/info")).data;
  assert.equal(info.trained_run_cap, 30); assert.equal(info.budget.total, 250); assert.ok(info.cpus >= 1);
  const init = (await get(a, "/api/concept/engine/garage/init?team=redbull")).data;
  assert.equal(init.legal, true); assert.equal(init.d_lap_s, 0); assert.equal(init.catalogue.length, 23); assert.ok(Object.keys(init.materials).length >= 5);
  for (const p of Object.keys(init.materials)) assert.ok(init.materials[p].options.every(o => /permitted|baseline/.test(o.fia || "permitted") || o.id === init.materials[p].base), p);
  const params = JSON.parse(JSON.stringify(init.design.params)); params.floor.width_mm = 1540; params.rear_wing.sm_delta_deg = 25;
  const lap = (await post(a, "/api/concept/engine/garage/lap", { team: "redbull", params })).j.data;
  assert.equal(lap.legal, true); assert.ok(lap.d_lap_s < 0, "wider floor + more flap is faster on the sim: " + lap.d_lap_s);
  const segSum = lap.segments.reduce((s, x) => s + x.d_s, 0); assert.ok(Math.abs(segSum - lap.d_lap_s) < 0.01, "segments add up to the lap delta");
  assert.equal(lap.ranges.length, 23); assert.ok(lap.ranges.every(r => r.lo <= r.value + 1e-9 && r.hi >= r.value - 1e-9));
  for (const k of ["legality", "physics_lap", "contributions", "ranges"]) assert.ok(typeof lap.timings_ms[k] === "number", k);
  params.layout.wheelbase_mm = 3600;
  const bad = (await post(a, "/api/concept/engine/garage/lap", { team: "redbull", params })).j.data;
  assert.equal(bad.legal, false); assert.equal(bad.lap_s, undefined); assert.ok(bad.violations.some(v => v.id === "REG-C-WB" && v.article === "C2.3.3"));
  const wrongMat = await post(a, "/api/concept/engine/garage/lap", { team: "redbull", params: { front_wing: { material: "no_such_material" } } });
  assert.equal(wrongMat.status, 400);
  const sheet = (await get(a, "/api/concept/engine/carsheet?team=redbull")).data;
  assert.ok(sheet.rows.length >= 30 && sheet.rows.every(r => ["FIA", "EST", "MODEL"].includes(r.flag) && r.source && r.source.length > 5));
  for (const name of ["MGU-K power", "ES state-of-charge window", "Max rpm (upshift)", "μx (longitudinal, effective)", "Drag ratio straight / corner"]) assert.ok(sheet.rows.some(r => r.name === name), name);
  assert.equal(sheet.rows.find(r => r.name === "MGU-K power").flag, "FIA");
  assert.equal(sheet.coupling.rows.length, 23); assert.ok(sheet.coupling.rows.filter(r => r.mechanism).length >= 20, "mechanisms from COUPLING.md");
  const t = (await get(a, "/api/concept/engine/timings")).data.stages;
  assert.ok(t.physics_lap && t.legality && t.contributions && t.ranges && t.physics_lap.n >= 1);
});

test("guards: trained needs live + confirm + the typed confirmation + the per-run cap + enough budget; live is off under MUBIT_MOCK; one run at a time", async () => {
  const a = app({ conceptMubit: { callMubit: async () => { throw new Error("must not be called"); } } });
  const run = b => post(a, "/api/concept/engine/run", Object.assign({ mode: "auto" }, b));
  assert.match((await run({ mode: "nope" })).j.error.message, /mode must be/);
  assert.match((await run({ trained: true })).j.error.message, /live/);
  assert.match((await run({ llm: "live", trained: true, max_calls: 5 })).j.error.message, /confirm must be "trained"/);
  assert.match((await run({ llm: "live", trained: true, confirm: "trained", max_calls: 5, confirm_text: "train 5" })).j.error.message, /TRAIN 5/);
  const cap = await run({ llm: "live", trained: true, confirm: "trained", max_calls: 31, confirm_text: "TRAIN 31" });
  assert.equal(cap.status, 400); assert.match(cap.j.error.message, /capped at 30/);
  assert.match((await run({ llm: "live", trained: true, confirm: "trained", max_calls: 10, confirm_text: "TRAIN 10", seed: 1, max_iterations: 0 })).j.error.message, /max_iterations/);
  const prev = process.env.MUBIT_MOCK; process.env.MUBIT_MOCK = "1";
  try { const m = app(); assert.match((await post(m, "/api/concept/engine/run", { mode: "auto", llm: "live" })).j.error.message, /MUBIT_MOCK=1/); }
  finally { if (prev == null) delete process.env.MUBIT_MOCK; else process.env.MUBIT_MOCK = prev; }
  // one engine run at a time
  const s = await post(a, "/api/concept/engine/run", { mode: "speed", seeds: [1], evals: 400, refine_evals: 0, lambda: 8 });
  assert.equal(s.j.ok, true, JSON.stringify(s.j));
  const second = await run({});
  assert.match(second.j.error.message, /already running/);
  await post(a, "/api/concept/engine/run/" + s.j.data.run_id + "/stop");
  const ev = await drain(a, s.j.data.stream);
  assert.equal(ev[ev.length - 1].event, "end"); assert.equal(ev[ev.length - 1].data.status, "stopped");
});

test("budget refusal: a trained run asking for more calls than remain is refused before any call", async () => {
  const root = tmp(); fs.mkdirSync(path.join(root, "data")); fs.writeFileSync(path.join(root, "data", "calls.jsonl"), Array.from({ length: 245 }, (_, i) => JSON.stringify({ trained: true, mubit_request_id: "x" + i })).join("\n") + "\n");
  const { Hono } = require("hono"); const h = new Hono();
  class ApiError extends Error { constructor(code, m, extra) { super(m); this.code = code; this.extra = extra; } }
  h.onError((e, c) => c.json({ ok: false, error: { message: e.message } }, 400));
  let called = 0;
  route.mount(h, { ok: (c, d) => c.json({ ok: true, data: d }), body: async c => JSON.parse(await c.req.text()), ApiError, mock: false, dataDir: tmp(), root, workers: 0, tmpDir: tmp(), mubit: { callMubit: async () => { called++; throw new Error("no"); } } });
  const r = await h.request("/api/concept/engine/run", { method: "POST", body: JSON.stringify({ mode: "auto", llm: "live", trained: true, confirm: "trained", max_calls: 10, confirm_text: "TRAIN 10" }) });
  const j = await r.json();
  assert.match(j.error.message, /not enough trained-call budget left: 5 of 250/); assert.equal(called, 0);
});

test("autonomous (mock): ~10 hybrid iterations, deterministic, every result fed to the next call, final re-scored with a band; nothing written to data/", async () => {
  const before = listData();
  const once = async () => {
    const a = app();
    const r = await post(a, "/api/concept/engine/run", { mode: "auto", llm: "mock", seed: 2, max_iterations: 10, patience: 50, search_budget: 24, workers: 0 });
    assert.equal(r.j.ok, true, JSON.stringify(r.j));
    const ev = await drain(a, r.j.data.stream);
    return { r: r.j.data, ev };
  };
  const x = await once(), y = await once();
  const results = e => e.ev.filter(v => v.event === "result").map(v => ({ k: v.data.iteration, change: v.data.row.change, kept: v.data.row.kept, d: v.data.row.measured.d_lap_s }));
  assert.equal(results(x).length, 10); assert.deepEqual(results(x), results(y));
  const searches = x.ev.filter(v => v.event === "search");
  assert.ok(searches.length >= 5 && searches.every(s => s.data.laps <= 24 && s.data.lap_s <= (s.data.proposal_lap_s == null ? Infinity : s.data.proposal_lap_s) + 1e-9));
  assert.ok(x.ev.filter(v => v.event === "link").length >= 8, "results went into the next call");
  const fin = x.ev.find(v => v.event === "final").data;
  assert.equal(fin.rescore.legal, true); assert.ok(fin.rescore.sigma_s > 0 && fin.rescore.band95_s[0] < fin.rescore.lap_s && fin.rescore.band95_s[1] > fin.rescore.lap_s);
  assert.ok(fin.rescore.lap_s < fin.rescore.baseline.lap_s, "the loop improved on the RB22");
  assert.equal(fin.rescore.direct_sim_lap_s, fin.rescore.lap_s);
  assert.match(fin.stop_reason, /generation limit|iteration cap/);
  assert.ok(!x.r.dir.startsWith(path.join(ROOT, "data")) && !x.r.dir.includes(path.sep + "data" + path.sep), "mock runs never write data/: " + x.r.dir);
  const calls = fs.readFileSync(path.join(x.r.dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls.length >= 1 && calls.every(c => c.trained === false && c.mock === true && /^mreq_mock/.test(c.mubit_request_id)));
  assert.equal(listData(), before, "data/ untouched");
});

test("autonomous: stop conditions (no improvement for N, call budget) and a trained live run through an injected server/mubit.js stand-in", async () => {
  const a = app();
  const r = await post(a, "/api/concept/engine/run", { mode: "auto", llm: "mock", seed: 1, max_calls: 3, search_budget: 0, workers: 0 });
  const ev = await drain(a, r.j.data.stream), fin = ev.find(e => e.event === "final").data;
  assert.match(fin.stop_reason, /call budget of 3 spent/); assert.equal(fin.calls, 3);
  const p = await post(a, "/api/concept/engine/run", { mode: "auto", llm: "mock", seed: 7, patience: 2, max_calls: 60, search_budget: 0, workers: 0, target_lap_s: 60.5 });
  const fp = (await drain(a, p.j.data.stream)).find(e => e.event === "final").data;
  assert.match(fp.stop_reason, /no improvement for 2 iterations|target lap/);
  const seen = [], ml = loop.mockLlm(5);
  const fake = { callMubit: async q => { seen.push(q); return { text: await ml(q.userContent), mubit_request_id: "mreq_" + String(seen.length).padStart(32, "e"), model: "claude-haiku-4-5", input_tokens: 600, output_tokens: 80, latency_ms: 2, trained: !!q.trained }; } };
  const live = app({ conceptMubit: fake });
  const t = await post(live, "/api/concept/engine/run", { mode: "auto", llm: "live", trained: true, confirm: "trained", max_calls: 2, confirm_text: "TRAIN 2", seed: 5, search_budget: 10, workers: 0 });
  assert.equal(t.j.ok, true, JSON.stringify(t.j));
  const ev2 = await drain(live, t.j.data.stream);
  assert.equal(seen.length, 2, "hard per-run cap"); assert.ok(seen.every(q => q.trained === true && q.task === designerPrompt && q.kind === "design" && q.sessionId === t.j.data.run_id));
  assert.match(t.j.data.dir, /concept-engine/);
  const rows = fs.readFileSync(path.join(t.j.data.dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.filter(x => x.trained === true).length, 2);
  assert.match(ev2.find(e => e.event === "final").data.stop_reason, /call budget of 2 spent/);
  assert.equal((await get(live, "/api/concept/engine/budget")).data.used, route.trainedBudget(ROOT, []).used + 2, "the run's own trained calls count against the budget");
});

test("speed run: progress by SSE (laps, laps/s, best), final re-scored on the physics sim with the uncertainty band", async () => {
  const a = app();
  const r = await post(a, "/api/concept/engine/run", { mode: "speed", seeds: [3], evals: 60, refine_evals: 30, lambda: 8, workers: 0 });
  assert.equal(r.j.ok, true, JSON.stringify(r.j));
  const ev = await drain(a, r.j.data.stream);
  const prog = ev.filter(e => e.event === "progress");
  assert.ok(prog.some(p => p.data.kind === "phase" && p.data.phase === "baseline") && prog.some(p => p.data.kind === "gen"));
  assert.ok(prog.every(p => typeof p.data.laps === "number"));
  const fin = ev.find(e => e.event === "final").data.results.redbull;
  assert.ok(fin.lap_s <= fin.baseline.lap_s && fin.sigma_s > 0 && fin.band95_s[0] < fin.lap_s);
  assert.equal(fin.pu_identical, true); assert.deepEqual(fin.legality.fail, []);
  assert.equal(ev[ev.length - 1].data.status, "done");
});

test("dashboard code never uses the banned words (G-HON-02), the browser never reaches a provider, and the frozen designer prompt is untouched", () => {
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated", "aerodynamically" + " tested"].join("|"), "i");
  const files = ["concept/lab/engine-panel.js", "concept/lab/engine-panel.css", "server/campaign-route.js", "concept/campaign/local.js", "docs/concept/DASHBOARD.md"];
  for (const f of files) { const m = banned.exec(fs.readFileSync(path.join(ROOT, f), "utf8")); assert.equal(m, null, f + ": " + (m && m[0])); }
  for (const f of ["concept/lab/engine-panel.js", "server/campaign-route.js", "concept/campaign/local.js"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /api\.mubit\.ai|api\.anthropic\.com|@anthropic-ai\/sdk/, f);
  assert.equal(designerPrompt.DRAFT, false);
});
