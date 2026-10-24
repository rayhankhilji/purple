// PURPLE - the Vercel adapter (server/vercel.js, docs/DEPLOY.md): static allowlist, /tmp store never data/, the passcode gate for
// live Mubit calls, rate limits, mock runs with a stream ticket. No network: live paths are only tested up to their refusal.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("path"), fs = require("fs"), os = require("os");
process.env.PURPLE_VERCEL_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "purple-vercel-test-"));
delete process.env.MUBIT_MOCK; delete process.env.MUBIT_API_KEY; delete process.env.PURPLE_PASSCODE;
const V = require("../server/vercel.js");
const ROOT = path.join(__dirname, "..");

test("static build skips the prompts and the telemetry archive except the Silverstone qualifying laps", () => {
  assert.equal(V.staticSkip("lab/prompt.js"), true);
  assert.equal(V.staticSkip("concept/designer/prompt.js"), true);
  assert.equal(V.staticSkip("concept/data/telemetry/monaco/x.json"), true);
  assert.equal(V.staticSkip("concept/data/telemetry/silverstone-2026-q-ant.json"), false);
  assert.equal(V.staticSkip("concept/lab/index.html"), false);
  assert.equal(V.staticSkip("lab/.hidden"), true);
});

test("the runtime store is seeded from the newest ledger snapshot and never uses the real data/", () => {
  assert.throws(() => V.seed(path.join(ROOT, "data")), /refusing/);
  const s = V.latestSnapshot(); assert.ok(s && fs.existsSync(path.join(s.dir, "ledger.jsonl")));
  const d = path.join(process.env.PURPLE_VERCEL_TMP, "seedcheck"), info = V.seed(d);
  assert.equal(info.snapshot, "docs/ledger-snapshot/" + s.name);
  assert.ok(fs.existsSync(path.join(d, "ledger.jsonl")));
});

test("limiter reserves all-or-nothing within the window", () => {
  const L = V.Limiter();
  assert.equal(L.take([["a", 3], ["g", 4]], 2, 1000).ok, true);
  const r = L.take([["a", 3], ["g", 4]], 2, 1000); assert.equal(r.ok, false); assert.equal(r.key, "a");
  assert.equal(L.view("g", 1000), 2);
});

test("adapter: any host, mock by default, live refused without key / passcode, mock loop streams with a ticket", async () => {
  const A = V.create();
  const req = (p, init) => A.fetch(new Request("https://purple-x.vercel.app" + p, init));
  const post = (p, b, h) => req(p, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, h || {}), body: JSON.stringify(b) });
  let r = await req("/api/health"); let j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.deploy.mubit, "mock"); assert.match(j.deploy.storage, /ephemeral/); assert.equal(r.headers.get("x-purple-storage"), "ephemeral");
  r = await post("/api/concept/loop", { mode: "live", iterations: 1 }); j = await r.json();
  assert.equal(r.status, 503); assert.equal(j.error.code, "LIVE_OFF");
  process.env.MUBIT_API_KEY = "test-key-never-sent"; process.env.PURPLE_PASSCODE = "pass-for-test";
  try {
    r = await post("/api/concept/loop", { mode: "live", iterations: 1 }); j = await r.json();
    assert.equal(r.status, 403); assert.equal(j.error.code, "PASSCODE_REQUIRED");
    r = await post("/api/concept/loop", { mode: "live", iterations: 1 }, { "x-purple-passcode": "wrong" }); assert.equal(r.status, 403);
    r = await post("/api/concept/engine/run", { mode: "auto", llm: "live", max_calls: 1 }); assert.equal(r.status, 403);
    r = await post("/api/concept/loop", { mode: "live", iterations: 31 }, { "x-purple-passcode": "pass-for-test" }); assert.equal(r.status, 429);   // over the per-IP hourly cap of 30
    r = await req("/api/unlock", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "passcode=pass-for-test" });
    assert.equal(r.status, 303); assert.match(r.headers.get("set-cookie"), /^purple_live=live\.\d+\.[A-Za-z0-9_-]+; Path=\/api; HttpOnly; Secure; SameSite=Strict/);
    assert.ok(!r.headers.get("set-cookie").includes("pass-for-test"));
  } finally { delete process.env.MUBIT_API_KEY; delete process.env.PURPLE_PASSCODE; }
  r = await post("/api/concept/loop", { mode: "mock", iterations: 2, seed: 3 }); j = await r.json();
  assert.equal(r.status, 200); assert.match(j.data.stream, /\/stream\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const text = await (await req(j.data.stream)).text();
  assert.match(text, /event: done/); assert.match(text, /event: end/);
  r = await post("/api/plan", {}); j = await r.json();   // the research plan without the passcode: the mock planner, never a real request id
  assert.equal(r.status, 200); assert.match(j.data.mubit_request_id, /^mock-/); assert.equal(j.deploy.mubit, "mock");
});
