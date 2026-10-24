// PURPLE designer exam on the API (server/exam-route.js, the concept lab's Exam view): POST /api/concept/exam/grade returns the same
// grade as concept/exam/run.js recorded for a known answer (results-base.json), also when worker threads cannot start (in-process
// fallback); unknown ids, empty text and oversized bodies are refused; graded answers are saved locally in the format run.js reads and
// never on Vercel, where the route is rate limited. No network, no Mubit: the grader never loads server/mubit.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
process.env.PURPLE_VERCEL_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "purple-exam-vercel-"));
process.env.PURPLE_CPU_GRADES_PER_IP_HOUR = "2";   // read when server/vercel.js loads
delete process.env.MUBIT_MOCK; delete process.env.MUBIT_API_KEY; delete process.env.PURPLE_PASSCODE;
const { createApp } = require("../server/app.js");
const R = require("../concept/exam/run.js"), G = require("../concept/exam/grade.js");

const H = { "content-type": "application/json", host: "127.0.0.1:8787" };
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-exam-route-"));
const base = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "concept", "exam", "results-base.json"), "utf8"));
function app(extra) { return createApp(Object.assign({ dataDir: tmp(), mubit: require("./mocks/mubit.js"), log: () => {}, engineWorkers: 0, engineTmpDir: tmp("purple-engine-runs-"), examAnswersDir: tmp("purple-exam-answers-") }, extra || {})); }
const post = async (a, u, b, h) => { const r = await a.app.request(u, { method: "POST", headers: Object.assign({}, H, h || {}), body: typeof b === "string" ? b : JSON.stringify(b || {}) }); return { status: r.status, j: await r.json() }; };
const get = async (a, u) => (await a.app.request(u, { headers: H })).json();
// the fields run.js records per row (ms and the request metadata aside)
const core = g => JSON.parse(JSON.stringify({ id: g.id, parsed: g.parsed, legal: g.legal, direct: g.direct, engine: g.engine, proposal: g.proposal, head_lap_s: g.head_lap_s, articles: g.articles }));

test("grade route: the same grade as run.js recorded for a known base answer; saved locally in the run.js answers format", async () => {
  const row = base.rows.find(r => r.id === "q01");
  assert.ok(row && row.parsed && row.answer, "results-base.json has q01's recorded answer");
  const a = app({ examWorkers: 2 });
  try {
    const info = await get(a, "/api/concept/exam/info");
    assert.equal(info.data.n, 30); assert.equal(info.data.writable, true);
    const r = await post(a, "/api/concept/exam/grade", { id: "q01", text: row.answer });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(core(r.j.data), core(row));
    assert.equal(r.j.data.column, "adapter"); assert.equal(r.j.data.phase, "early"); assert.equal(r.j.data.workers, 2);
    assert.match(r.j.data.saved, /answers-adapter\.json$/);
    // the saved file is what `node concept/exam/run.js --column adapter --answers <file>` reads
    const saved = (await get(a, "/api/concept/exam/answers")).data;
    assert.equal(saved.adapter.q01.text, row.answer); assert.deepEqual(core(saved.adapter.q01.grade), core(row));
    assert.deepEqual(saved.provider, {});
    // a provider (side-by-side) reply goes to its own file; an unparseable one is never kept
    const p = await post(a, "/api/concept/exam/grade", { id: "q02", text: "I would lower the rear wing.", column: "provider" });
    assert.equal(p.status, 200); assert.equal(p.j.data.parsed, false); assert.equal(p.j.data.direct.kept, false); assert.equal(p.j.data.engine.kept, false);
    assert.match(p.j.data.saved, /answers-provider\.json$/);
  } finally { await a.exam.close(); }
});

test("grade route: answers file parses with run.js parseAnswers", async () => {
  const dir = tmp("purple-exam-answers-");
  const a = app({ examWorkers: 0, examAnswersDir: dir });
  try {
    const r = await post(a, "/api/concept/exam/grade", { id: "q03", text: "not json at all" });
    assert.equal(r.status, 200);
    const map = R.parseAnswers(fs.readFileSync(path.join(dir, "answers-adapter.json"), "utf8"));
    assert.deepEqual(Object.keys(map), ["q03"]); assert.equal(map.q03, "not json at all");
  } finally { await a.exam.close(); }
});

test("grade route: worker threads unavailable -> graded in this thread, same result", async () => {
  const row = base.rows.find(r => r.id === "q01");
  const factory = n => { if (n > 0) throw new Error("worker_threads disabled in this test"); return G.pools(0); };
  const a = app({ examWorkers: 1, examPoolFactory: factory });
  try {
    const r = await post(a, "/api/concept/exam/grade", { id: "q01", text: row.answer });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(core(r.j.data), core(row));
    assert.equal(r.j.data.workers, 0); assert.match(r.j.data.fallback, /in this thread/);
  } finally { await a.exam.close(); }
});

test("grade route: unknown ids, empty text, bad column and oversized bodies are refused", async () => {
  const a = app({ examWorkers: 0 });
  try {
    for (const id of ["q31", "q00", "q1", "x", "../q01"]) { const r = await post(a, "/api/concept/exam/grade", { id, text: "{}" }); assert.equal(r.status, 404, id); assert.equal(r.j.error.code, "NOT_FOUND"); }
    let r = await post(a, "/api/concept/exam/grade", { id: 1, text: "{}" }); assert.equal(r.status, 400);
    r = await post(a, "/api/concept/exam/grade", { id: "q01", text: "   " }); assert.equal(r.status, 400);
    r = await post(a, "/api/concept/exam/grade", { id: "q01" }); assert.equal(r.status, 400);
    r = await post(a, "/api/concept/exam/grade", { id: "q01", text: "{}", column: "base" }); assert.equal(r.status, 400);
    r = await post(a, "/api/concept/exam/grade", { id: "q01", text: "x".repeat(9000) }); assert.equal(r.status, 413); assert.equal(r.j.error.code, "TOO_LARGE");
    r = await post(a, "/api/concept/exam/grade", { id: "q01", text: "x".repeat(7000), pad: "y".repeat(20000) }); assert.equal(r.status, 413);
    r = await post(a, "/api/concept/exam/grade", "{not json"); assert.equal(r.status, 400);
    r = await post(a, "/api/concept/exam/grade", { id: "q01", text: "{}" }, { "content-type": "text/plain" }); assert.equal(r.status, 400);   // the app's CSRF guard
    assert.deepEqual((await get(a, "/api/concept/exam/answers")).data.adapter, {}, "nothing refused was saved");
  } finally { await a.exam.close(); }
});

test("never under data/: the route refuses an answers dir inside data/", () => {
  assert.throws(() => app({ examAnswersDir: path.join(__dirname, "..", "data", "exam-answers") }), /data\//);
});

test("vercel: the grade route is rate limited (PURPLE_CPU_GRADES_*), stores nothing, makes no Mubit call", async () => {
  const V = require("../server/vercel.js");
  assert.equal(V.LIMITS.cpu_grades_per_ip_hour, 2);
  const A = V.create();
  const req = (p, init) => A.fetch(new Request("https://purple-x.vercel.app" + p, init));
  const post2 = b => req("/api/concept/exam/grade", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "203.0.113.9" }, body: JSON.stringify(b) });
  try {
    const info = (await (await req("/api/concept/exam/info")).json()).data;
    assert.equal(info.writable, false); assert.equal(info.saves, null);
    const before = (await (await req("/api/concept/exam/answers")).json()).data;   // the committed files, if any (read-only)
    let r = await post2({ id: "q05", text: "no proposal" }); let j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.data.parsed, false); assert.equal(j.data.saved, null); assert.match(j.deploy.note, /no Mubit call/);
    r = await post2({ id: "q99", text: "x" }); assert.equal(r.status, 404);   // counted: the limit is taken before the inner route
    r = await post2({ id: "q05", text: "again" }); j = await r.json();
    assert.equal(r.status, 429); assert.equal(j.error.code, "RATE_LIMITED"); assert.match(j.error.message, /exam grades/);
    assert.deepEqual((await (await req("/api/concept/exam/answers")).json()).data, before, "a grade on Vercel writes nothing");
  } finally { await A.api.exam.close(); }
});
