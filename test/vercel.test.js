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
    process.env.PURPLE_OPEN_LIVE = "0";   // the engine is open by default (owner decision); with the switch off it needs the passcode again
    try { r = await post("/api/concept/engine/run", { mode: "auto", llm: "live", max_calls: 1 }); assert.equal(r.status, 403); } finally { delete process.env.PURPLE_OPEN_LIVE; }
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

test("a live loop calls Mubit only from the run its stream starts (loopback stub, never the network)", async () => {
  const http = require("http"); const seen = [];
  const stub = http.createServer((q, s) => { let b = ""; q.on("data", d => (b += d)); q.on("end", () => {
    seen.push({ record: q.headers["x-middleware-record"], user: JSON.parse(b).metadata.user_id });
    s.writeHead(200, { "content-type": "application/json", "x-middleware-request-id": "mreq_stub" + seen.length });
    s.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text: JSON.stringify({ changes: [{ part: "rear_wing", param: "aoa_deg", to: 19 }], hypothesis: "stub", expected: { lap_delta_s: -1, sector: 1 } }) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
  }); });
  await new Promise(res => stub.listen(0, "127.0.0.1", res));
  Object.assign(process.env, { MUBIT_API_KEY: "test-key-never-sent", PURPLE_PASSCODE: "pass-for-test", MUBIT_BASE_URL: "http://127.0.0.1:" + stub.address().port });
  try {
    const A = V.create();
    const r = await A.fetch(new Request("https://purple-x.vercel.app/api/concept/loop", { method: "POST", headers: { "content-type": "application/json", "x-purple-passcode": "pass-for-test" }, body: JSON.stringify({ mode: "live", iterations: 2, seed: 5 }) }));
    const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
    await new Promise(res => setTimeout(res, 300));
    assert.equal(seen.length, 0, "the POST's validation run must not call Mubit");
    const text = await (await A.fetch(new Request("https://purple-x.vercel.app" + j.data.stream))).text();
    assert.match(text, /event: done/);
    assert.equal(seen.length, 2); assert.ok(seen.every(x => x.record === "metadata" && x.user !== j.data.run_id && x.user === seen[0].user));
    const again = await (await A.fetch(new Request("https://purple-x.vercel.app" + j.data.stream))).text();   // reopening replays the same run, no new call
    assert.match(again, /event: done/); assert.equal(seen.length, 2);
  } finally { delete process.env.MUBIT_API_KEY; delete process.env.PURPLE_PASSCODE; delete process.env.MUBIT_BASE_URL; stub.close(); }
});
