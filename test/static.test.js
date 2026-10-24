// PURPLE - server/static.js hardening (audit item 5): allowlisted roots only, no dotfiles, containment, safe percent-decoding.
const test = require("node:test"), assert = require("node:assert/strict");
const http = require("http"), fs = require("fs"), path = require("path");
const S = require("../server/static.js");
const ROOT = S.ROOT;
const get = (port, p, method) => new Promise((res, rej) => { const r = http.request({ host: "127.0.0.1", port, path: p, method: method || "GET" }, rs => { let b = ""; rs.on("data", d => b += d); rs.on("end", () => res({ status: rs.statusCode, headers: rs.headers, body: b })); }); r.on("error", rej); r.end(); });

test("resolve(): allowlist, dotfiles, traversal, bad escapes", () => {
  assert.equal(S.resolve("/").file, path.join(ROOT, "index.html")); assert.equal(S.resolve("/index.html").file, path.join(ROOT, "index.html"));
  assert.equal(S.resolve("/lab/").file, path.join(ROOT, "lab", "index.html")); assert.equal(S.resolve("/js/ai.js?v=2").file, path.join(ROOT, "js", "ai.js")); assert.equal(S.resolve("/docs/PRD.md").file, path.join(ROOT, "docs", "PRD.md"));
  for (const p of ["/server/app.js", "/server/.env", "/data/ledger.jsonl", "/data-mock/calls.jsonl", "/package.json", "/node_modules/hono/package.json", "/test/server.test.js", "/.git/HEAD", "/.env", "/lab/.hidden", "/js/../server/.env", "/%2e%2e/server/.env", "/..%2fserver/.env", "/lab/..", "/CLAUDE.md"]) assert.equal(S.resolve(p).status, 403, p);
  assert.equal(S.resolve("/%zz").status, 400); assert.equal(S.resolve("/lab/%E0%A4%A").status, 400); assert.equal(S.resolve("/js/a%00.js").status, 400);
  assert.equal(S.resolve("/docs/agents/lanes/SERVER.md").file, path.join(ROOT, "docs", "agents", "lanes", "SERVER.md"));
});
test("served over HTTP: 200 for the game and lab, 403/404/400/405 as designed, no process crash on a malformed escape", async () => {
  const srv = await new Promise(r => { const s = http.createServer(S.serve).listen(0, "127.0.0.1", () => r(s)); }); const port = srv.address().port;
  try {
    const ok = await get(port, "/lab/"); assert.equal(ok.status, 200); assert.match(ok.headers["content-type"], /text\/html/); assert.match(ok.body, /<html/i); assert.equal(ok.headers["cache-control"], "no-store");
    assert.equal((await get(port, "/")).status, 200); assert.equal((await get(port, "/js/ai.js")).status, 200); assert.equal((await get(port, "/vendor/three.min.js")).status, 200);
    const head = await get(port, "/index.html", "HEAD"); assert.equal(head.status, 200); assert.equal(head.body, "");
    const redir = await get(port, "/lab"); assert.equal(redir.status, 302); assert.equal(redir.headers.location, "/lab/");
    assert.equal((await get(port, "/%zz")).status, 400); assert.equal((await get(port, "/server/.env")).status, 403); assert.equal((await get(port, "/.git/config")).status, 403); assert.equal((await get(port, "/data/exam.json")).status, 403);
    assert.equal((await get(port, "/js/nope.js")).status, 404); assert.equal((await get(port, "/lab/", "POST")).status, 405);
    assert.equal((await get(port, "/lab/")).status, 200, "still alive after the bad requests");
  } finally { srv.close(); }
});
