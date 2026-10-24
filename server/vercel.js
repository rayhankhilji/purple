// PURPLE - the Vercel adapter (docs/DEPLOY.md). Local `npm run dev` never loads this file.
//   node server/vercel.js build    copies the static site (game, research lab, concept lab, viewer, race replay) into public/
//   node server/vercel.js deploy   production deploy with the Vercel CLI; reads VERCEL_TOKEN from the environment (npm run deploy)
//   require("./vercel.js").listener()   the (req, res) handler of the one Vercel function (api/index.js) for every /api/* request
// What it adds around createApp() (server/app.js), which stays unchanged in behaviour:
//   - storage: the function bundle is read-only. The research ledger starts from the newest docs/ledger-snapshot/<run>/ (copied to
//     <tmp>/purple/data on a cold start); every write lands in /tmp and is EPHEMERAL (per instance, gone when it is recycled).
//     Every JSON answer carries { deploy: { storage, mubit, ... } } and the headers x-purple-mubit / x-purple-storage.
//   - Mubit from the public site: mock unless the request carries the passcode (header x-purple-passcode, or the HttpOnly cookie
//     that /api/unlock sets after the passcode is typed once). Live calls are untrained unless the existing confirm rules are met
//     (concept loop / engine: trained + confirm "trained"; research plan calls train by design, so they go live only with the
//     passcode AND x-purple-confirm: trained). Live calls are rate limited per IP and globally per hour (in memory, per instance).
//   - runs (concept loop, engine speed / auto runs) live in one instance's memory: the POST keeps its instance alive (waitUntil)
//     and the run is time-boxed to one function invocation (TIME_BOX_S). The stream URL carries a signed ticket: if Vercel sends
//     the stream to another instance, a mock / speed run is replayed there from the ticket (deterministic per seed). A LIVE run
//     always starts where its stream is opened: the POST only validates it (the run the inner route starts is stopped before any
//     Mubit call, and its calls are gated by session id) and the stream starts the real run from the ticket, once per instance.
// G-SEC-02: the Mubit key is only read by server/mubit.js and feeds the ticket/cookie HMAC key through a hash; it is never sent,
// logged or returned. The passcode is never logged or returned.
"use strict";
const path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const ROOT = path.join(__dirname, "..");

// ---------------------------------------------------------------- build: the static site -> public/
// Served as-is. Left out: server-only code and data (server/, data/, docs/, test/, tools/), the frozen prompts (the browser never
// loads them), and the 13 MB telemetry archive except the Silverstone qualifying laps the race replay fetches.
const STATIC_FILES = ["index.html"], STATIC_DIRS = ["js", "css", "vendor", "assets", "lab", "concept"];
function staticSkip(rel) {
  rel = rel.split(path.sep).join("/");
  if (rel.split("/").some(s => s.startsWith("."))) return true;
  if (rel === "lab/prompt.js" || rel === "concept/designer/prompt.js") return true;
  if (rel.startsWith("concept/data/telemetry/")) return !/^concept\/data\/telemetry\/silverstone-2026-q-[a-z]+\.json$/.test(rel);
  return false;
}
function build(out) {
  out = out || path.join(ROOT, "public");
  fs.rmSync(out, { recursive: true, force: true });
  let n = 0, bytes = 0;
  const copy = rel => {
    const src = path.join(ROOT, rel), st = fs.statSync(src);
    if (st.isDirectory()) { for (const k of fs.readdirSync(src)) if (!staticSkip(path.join(rel, k))) copy(path.join(rel, k)); return; }
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fs.copyFileSync(src, path.join(out, rel)); n++; bytes += st.size;
  };
  for (const f of STATIC_FILES.concat(STATIC_DIRS)) if (fs.existsSync(path.join(ROOT, f)) && !staticSkip(f)) copy(f);
  // without a 404 page Vercel answers a missing file with the root index.html (status 200), which breaks script loading silently
  fs.writeFileSync(path.join(out, "404.html"), "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>PURPLE · not found</title><style>body{margin:0;background:#0d0d12;color:#e8e6f0;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}a{color:#b9a3ff}</style></head><body><main><h1>Not found</h1><p><a href=/>Game</a> · <a href=/lab/>Research lab</a> · <a href=/concept/lab/>Concept lab</a> · <a href=/concept/view/>Viewer</a> · <a href=/concept/race/>Race replay</a></p></main></body></html>\n");
  console.log("PURPLE static site -> " + path.relative(ROOT, out) + "/: " + n + " files, " + (bytes / 1048576).toFixed(1) + " MB");
  return { files: n, bytes };
}

// ---------------------------------------------------------------- deploy (npm run deploy)
const VERCEL_CLI = "vercel@65.2.0";
// the production project (ids are not secrets); VERCEL_ORG_ID / VERCEL_PROJECT_ID override. A token scoped to the user cannot run
// `vercel link` (it lists teams), so the link file is written from these ids when it is missing.
const PROJECT = { projectName: "purple", orgId: process.env.VERCEL_ORG_ID || "team_owbc2LUSFCa7ZB6ZV1Z6gwm9", projectId: process.env.VERCEL_PROJECT_ID || "prj_cxnDyBZwQJcRboRkjW5zJgDoFn1B" };
function deploy(extra) {
  if (!process.env.VERCEL_TOKEN) { console.error("PURPLE deploy: set VERCEL_TOKEN in the environment (never on the command line or in a file in the repo)"); return 1; }
  const link = path.join(ROOT, ".vercel", "project.json");
  if (!fs.existsSync(link)) { fs.mkdirSync(path.dirname(link), { recursive: true }); fs.writeFileSync(link, JSON.stringify(PROJECT) + "\n"); console.log("PURPLE deploy: linked to project " + PROJECT.projectName + " (" + PROJECT.projectId + ")"); }
  const args = ["--yes", VERCEL_CLI, "deploy", "--prod", "--yes", "--token", process.env.VERCEL_TOKEN].concat(extra || []);
  const r = require("child_process").spawnSync("npx", args, { cwd: ROOT, stdio: "inherit", env: process.env });
  return r.status == null ? 1 : r.status;
}

// ---------------------------------------------------------------- runtime
const MAX_DURATION_S = 300;                  // vercel.json functions["api/index.js"].maxDuration (Fluid compute)
const intEnv = (k, d) => { const v = parseInt(process.env[k], 10); return Number.isInteger(v) && v >= 0 ? v : d; };
const LIMITS = {
  live_calls_per_ip_hour: intEnv("PURPLE_LIVE_PER_IP_HOUR", 30),       // Mubit calls (reserved up front: iterations / max_calls / n)
  live_calls_global_hour: intEnv("PURPLE_LIVE_GLOBAL_HOUR", 120),
  cpu_runs_per_ip_hour: intEnv("PURPLE_CPU_RUNS_PER_IP_HOUR", 6),      // engine speed / auto runs (each can use a whole function invocation)
  cpu_runs_global_hour: intEnv("PURPLE_CPU_RUNS_GLOBAL_HOUR", 30),
  // exam grades (POST /api/concept/exam/grade): ~1-3 s of one vCPU each, so their own bucket; the defaults are 15x / 10x the engine-run
  // limits above (PURPLE_CPU_RUNS_*), PURPLE_CPU_GRADES_* override them
  cpu_grades_per_ip_hour: intEnv("PURPLE_CPU_GRADES_PER_IP_HOUR", 15 * intEnv("PURPLE_CPU_RUNS_PER_IP_HOUR", 6)),
  cpu_grades_global_hour: intEnv("PURPLE_CPU_GRADES_GLOBAL_HOUR", 10 * intEnv("PURPLE_CPU_RUNS_GLOBAL_HOUR", 30)),
  unlock_failures_per_ip_10min: 10,
  time_box_s: Math.min(intEnv("PURPLE_TIME_BOX_S", MAX_DURATION_S - 60), MAX_DURATION_S - 30),
  orphan_s: 20,                               // a mock / speed run nobody follows for this long is stopped (its stream went elsewhere)
  ticket_s: 120, cookie_h: 12, engine_workers: 1,
};
const TMP = () => process.env.PURPLE_VERCEL_TMP || path.join(os.tmpdir(), "purple");

// the newest ledger snapshot = the one with the newest ledger / calls row (folder names use two date styles)
function latestSnapshot() {
  const base = path.join(ROOT, "docs", "ledger-snapshot"); let best = null;
  let names = []; try { names = fs.readdirSync(base); } catch (e) { return null; }
  for (const name of names) {
    let last = "";
    if (!fs.existsSync(path.join(base, name, "ledger.jsonl"))) continue;
    for (const f of ["ledger.jsonl", "calls.jsonl"]) { try { for (const l of fs.readFileSync(path.join(base, name, f), "utf8").split("\n")) { if (!l.trim()) continue; try { const r = JSON.parse(l); for (const t of [r.created_at, r.measured && r.measured.at, r.overrule && r.overrule.at, r.promoted_at]) if (typeof t === "string" && t > last) last = t; } catch (e) { /* torn */ } } } catch (e) { /* missing */ } }
    if (!best || last > best.last) best = { name, dir: path.join(base, name), last };
  }
  return best;
}
function seed(dir) {
  const real = p => { try { return fs.realpathSync(p).toLowerCase(); } catch (e) { return path.resolve(p).toLowerCase(); } };
  if (real(dir) === real(path.join(ROOT, "data")) || real(dir).startsWith(real(path.join(ROOT, "data")) + path.sep)) throw new Error("PURPLE vercel: refusing to use the real data/ as the runtime store");
  fs.mkdirSync(dir, { recursive: true });
  const mark = path.join(dir, ".snapshot");
  try { return JSON.parse(fs.readFileSync(mark, "utf8")); } catch (e) { /* first start of this instance */ }
  const s = latestSnapshot(), info = { snapshot: s ? "docs/ledger-snapshot/" + s.name : null, last_row_at: s ? s.last : null, seeded_at: new Date().toISOString() };
  if (s) for (const f of ["ledger.jsonl", "calls.jsonl", "rules.json", "state.json", "status.json", "exam.json"]) { const src = path.join(s.dir, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f)); }
  fs.writeFileSync(mark, JSON.stringify(info));
  return info;
}

// in-memory sliding-hour limiter (per instance; Fluid compute reuses instances, but a cold start resets it)
function Limiter() {
  const m = new Map();
  const used = (k, win, t) => { const a = m.get(k) || []; while (a.length && t - a[0].t > win) a.shift(); m.set(k, a); return a.reduce((s, x) => s + x.n, 0); };
  return {
    // reserve n units in every [key, max] pair at once, or none; -> { ok } | { ok: false, key, used, max, retry_after_s }
    take(pairs, n, winMs) {
      const t = Date.now();
      for (const [k, max] of pairs) { const u = used(k, winMs, t); if (u + n > max) { const a = m.get(k); return { ok: false, key: k, used: u, max, retry_after_s: a.length ? Math.ceil((winMs - (t - a[0].t)) / 1000) : Math.ceil(winMs / 1000) }; } }
      for (const [k] of pairs) m.get(k).push({ t, n });
      return { ok: true };
    },
    view(k, winMs) { return used(k, winMs, Date.now()); },
  };
}
const HOUR = 3600e3;

function create() {
  const { Hono } = require("hono");
  const { getCookie } = require("hono/cookie");
  const { AsyncLocalStorage } = require("async_hooks");
  const { createApp } = require("./app.js");
  const realMubit = require("./mubit.js"), mockMubit = require("../test/mocks/mubit.js");
  const promptHash = require("./scripts/prompt-hash.js").check();
  const designerPrompt = require("../concept/designer/prompt.js");

  const dataDir = path.join(TMP(), "data"), seeded = seed(dataDir);
  const PASS = () => process.env.PURPLE_PASSCODE || "";
  // why live Mubit calls are off on this deployment (null = available with the passcode)
  const liveOff = () => (process.env.MUBIT_MOCK && process.env.MUBIT_MOCK !== "0" ? "MUBIT_MOCK is set on this deployment" : !process.env.MUBIT_API_KEY ? "MUBIT_API_KEY is not set on this deployment" : !PASS() ? "PURPLE_PASSCODE is not set on this deployment" : !promptHash.ok ? "lab/prompt.js differs from the frozen task key (G-MUBIT-01)" : null);
  const key = () => crypto.createHash("sha256").update("purple-vercel-v1\0" + PASS() + "\0" + (process.env.MUBIT_API_KEY || "")).digest();
  const hmac = s => crypto.createHmac("sha256", key()).update(s).digest("base64url");
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const cookieFor = exp => "live." + exp + "." + hmac("live." + exp);
  const cookieOk = v => { const m = /^live\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(v || ""); return !!m && +m[1] > Date.now() && same(hmac("live." + m[1]), m[2]); };
  const authorized = c => { if (!PASS()) return false; const h = c.req.header("x-purple-passcode"); if (h != null && h !== "") return same(h, PASS()); return cookieOk(getCookie(c, "purple_live")); };
  const mintTicket = o => { const p = Buffer.from(JSON.stringify(o)).toString("base64url"); return p + "." + hmac("ticket." + p); };
  const readTicket = t => { const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(t || ""); if (!m || !same(hmac("ticket." + m[1]), m[2])) return null; try { const o = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); return o.exp > Date.now() ? o : null; } catch (e) { return null; } };

  // Mubit for the research routes: per request (AsyncLocalStorage), mock unless the outer layer marked the request live
  const als = new AsyncLocalStorage();
  const switching = {
    async callMubit(args) {
      const ctx = als.getStore();
      if (ctx && ctx.live) return realMubit.callMubit(args);
      if (mockMubit.inputs.length > 500) mockMubit.reset();
      const r = await mockMubit.callMubit(args);
      return Object.assign({}, r, { mubit_request_id: "mock-" + String(r.mubit_request_id).replace(/^mreq_test/, ""), model: "mock (public site without the passcode)" });
    },
  };
  // the designer's Mubit (concept loop, engine auto): only runs started from their stream (session id = run id) may call it; the
  // run a live POST starts only validates the request and can never reach Mubit (defer(), below)
  const deferred = new Map();   // run id -> promise that settles when that validation-only run has stopped
  const allowedLive = new Set();
  const gated = { callMubit(args) { if (!allowedLive.has(args.sessionId)) { const e = new Error("deferred: a live run calls Mubit only from the instance that streams it"); e.code = "deferred"; return Promise.reject(e); } return realMubit.callMubit(args); } };
  const api = createApp({ dataDir, mubit: switching, conceptMubit: gated, hostOk: /^[a-z0-9.-]+(:\d+)?$/i, engineWorkers: LIMITS.engine_workers, engineTmpDir: path.join(TMP(), "engine"), examWritable: false, examWorkers: LIMITS.engine_workers, log: (...a) => console.log(...a) });
  const inner = api.app;

  const limiter = Limiter();
  const ipOf = c => (c.req.header("x-real-ip") || (c.req.header("x-forwarded-for") || "").split(",")[0] || "unknown").trim();
  const STORAGE = "ephemeral: this server instance's /tmp. The research ledger starts from " + (seeded.snapshot || "an empty store") + " (a read-only copy in the deploy); everything written here vanishes when Vercel recycles the instance, and other instances do not see it. The real data/ is never touched.";
  const info = (c, mubit, extra) => Object.assign({ host: "vercel", storage: STORAGE, mubit, live: { available: !liveOff(), off_reason: liveOff(), unlocked: authorized(c), unlock: "/api/unlock" } }, extra || {});
  const envelope = (c, status, code, message, extra) => c.json({ ok: false, error: Object.assign({ code, message }, extra || {}), deploy: info(c, "mock") }, status);
  const liveRefusal = c => { const why = liveOff(); if (why) return envelope(c, 503, "LIVE_OFF", "live Mubit calls are off on this deployment: " + why); if (!authorized(c)) return envelope(c, 403, "PASSCODE_REQUIRED", "live Mubit calls from the public site need the passcode: open /api/unlock in this browser (or send the x-purple-passcode header). Without it, use mock mode."); return null; };
  const reserve = (c, bucket, n) => {
    const ip = ipOf(c), per = bucket === "live" ? [LIMITS.live_calls_per_ip_hour, LIMITS.live_calls_global_hour] : bucket === "grade" ? [LIMITS.cpu_grades_per_ip_hour, LIMITS.cpu_grades_global_hour] : [LIMITS.cpu_runs_per_ip_hour, LIMITS.cpu_runs_global_hour];
    const r = limiter.take([[bucket + ":ip:" + ip, per[0]], [bucket + ":all", per[1]]], n, HOUR);
    if (r.ok) return null;
    const what = bucket === "live" ? "live Mubit calls" : bucket === "grade" ? "exam grades" : "engine runs";
    return envelope(c, 429, "RATE_LIMITED", "hourly limit of " + what + " reached (" + (/:ip:/.test(r.key) ? "this IP" : "the whole site") + ": " + r.used + " of " + r.max + " used, this request needs " + n + "). Try again in " + Math.ceil(r.retry_after_s / 60) + " min, or use mock mode.", { retry_after_s: r.retry_after_s, limit: r.max, used: r.used, asked: n });
  };
  const waitUntil = p => { try { const ctx = globalThis[Symbol.for("@vercel/request-context")]; const w = ctx && ctx.get && ctx.get(); if (w && typeof w.waitUntil === "function") w.waitUntil(p); } catch (e) { /* not on Vercel */ } };

  // ---- runs (concept loop, engine runs): keep the instance alive, time-box, stop orphans, replay from a ticket elsewhere
  const alias = new Map();   // ticket run id -> the local run id it was replayed as
  const replayed = new Set();
  const runsOf = kind => (kind === "loop" ? api.concept.runs : api.engine.runs);
  function host(kind, r, live) {
    const done = kind === "loop" ? Promise.resolve(r.promise) : new Promise(res => { if (r.status !== "running") return res(); r.listeners.add(ev => { if (ev === null) res(); }); });
    waitUntil(done.catch(() => {}));
    const stop = why => { if (r.status === "running" && !r.stopRequested) { r.stopRequested = true; r.stop_reason = why; if (kind === "engine") r.push("stopping", { reason: why }); console.log("PURPLE vercel: stop " + r.id + ": " + why); } };
    const t1 = setTimeout(() => stop("time box on Vercel: a run gets one function invocation (" + LIMITS.time_box_s + " s), then stops cleanly and keeps its best car; run longer campaigns locally (npm run dev)"), LIMITS.time_box_s * 1000);
    const mine = kind === "engine" ? 1 : 0;
    const t2 = live ? null : setTimeout(() => { if (r.listeners.size <= mine) stop("nobody followed this run's stream on this instance (it was replayed where the stream landed)"); }, LIMITS.orphan_s * 1000);
    done.finally(() => { clearTimeout(t1); if (t2) clearTimeout(t2); });
  }
  // a live POST: the run the inner route started only validated the request; stop it before its first Mubit call
  function defer(kind, r) {
    const done = kind === "loop" ? Promise.resolve(r.promise) : new Promise(res => { if (r.status !== "running") return res(); r.listeners.add(ev => { if (ev === null) res(); }); });
    deferred.set(r.id, done.catch(() => {}));
    r.stopRequested = true; r.stop_reason = "deferred: a live run starts where its stream is opened";
    done.finally(() => { const t = setTimeout(() => deferred.delete(r.id), 10 * 60e3); if (t.unref) t.unref(); });
  }
  const sseOnly = (events) => new Response(events.map(([e, d]) => "event: " + e + "\ndata: " + JSON.stringify(d) + "\n\n").join(""), { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-purple-storage": "ephemeral" } });
  // a stream that ends cleanly before the function's max duration, so EventSource reconnects instead of seeing a timeout
  function capped(body, ms) {
    if (!body) return body;
    const reader = body.getReader(); let timer = null, closed = false;
    const close = ctrl => { if (closed) return; closed = true; clearTimeout(timer); reader.cancel().catch(() => {}); try { ctrl.close(); } catch (e) { /* closed */ } };
    return new ReadableStream({
      start(ctrl) { timer = setTimeout(() => close(ctrl), ms); },
      async pull(ctrl) { try { const { done, value } = await reader.read(); if (done) close(ctrl); else if (!closed) ctrl.enqueue(value); } catch (e) { close(ctrl); } },
      cancel() { closed = true; clearTimeout(timer); reader.cancel().catch(() => {}); },
    });
  }

  // forward to the inner app (server/app.js) with a rewritten path / body, under the request's Mubit mode
  async function forward(c, o) {
    o = o || {};
    const url = new URL(c.req.url); if (o.path) url.pathname = o.path;
    const h = new Headers(c.req.raw.headers); h.delete("content-length");
    const init = { method: c.req.method, headers: h };
    if (!["GET", "HEAD"].includes(c.req.method)) init.body = o.body != null ? o.body : await c.req.raw.clone().text();
    const res = await als.run({ live: !!o.live }, () => inner.fetch(new Request(url, init)));
    return decorate(c, res, o);
  }
  async function decorate(c, res, o) {
    const h = new Headers(res.headers); h.set("x-purple-mubit", o.live ? "live" : "mock"); h.set("x-purple-storage", "ephemeral"); h.set("cache-control", "no-store");
    if ((h.get("content-type") || "").startsWith("application/json")) {
      const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* pass through */ }
      if (j && typeof j === "object" && "ok" in j) { if (o.edit) o.edit(j); j.deploy = info(c, o.live ? "live" : "mock", o.note ? { note: o.note } : null); h.delete("content-length"); return new Response(JSON.stringify(j), { status: res.status, headers: h }); }
      return new Response(t, { status: res.status, headers: h });
    }
    return new Response(o.cap ? capped(res.body, o.cap) : res.body, { status: res.status, headers: h });
  }
  const jsonBody = async c => { const t = await c.req.raw.clone().text(); let b = null; try { b = t.trim() ? JSON.parse(t) : {}; } catch (e) { b = null; } return { text: t, b: b && typeof b === "object" && !Array.isArray(b) ? b : null }; };
  const isInt = v => Number.isInteger(v);

  const app = new Hono();
  // ---- the passcode: typed once per browser, kept as an HttpOnly cookie (signed; never the passcode itself)
  const page = (title, body) => "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" + title + "</title><style>:root{color-scheme:dark}body{margin:0;background:#0d0d12;color:#e8e6f0;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{max-width:420px;width:100%}h1{font-size:18px;margin:0 0 8px}p{color:#a9a6b8}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #3a3550;background:#16151f;color:inherit;width:100%;box-sizing:border-box;margin-top:8px}button{background:#7b4dff;border-color:#7b4dff;cursor:pointer}a{color:#b9a3ff}.bad{color:#ff8a8a}</style></head><body><main>" + body + "</main></body></html>";
  const form = msg => page("PURPLE · unlock live Mubit", "<h1>Live Mubit calls</h1><p>Without the passcode the public site runs every Mubit call in mock mode. The passcode unlocks live, untrained calls in this browser for " + LIMITS.cookie_h + " h (limits: " + LIMITS.live_calls_per_ip_hour + " calls per hour per IP, " + LIMITS.live_calls_global_hour + " per hour site-wide).</p>" + (msg ? "<p class=bad>" + msg + "</p>" : "") + "<form method=post action=/api/unlock><input name=passcode type=password autocomplete=current-password placeholder=passcode required autofocus><button type=submit>Unlock</button></form><p><a href=/concept/lab/>Concept lab</a> · <a href=/lab/>Research lab</a> · <a href=/>Game</a></p>");
  app.get("/api/unlock", c => c.html(authorized(c) ? page("PURPLE · unlocked", "<h1>Unlocked</h1><p>Live Mubit calls are on in this browser. Mode \"live\" in the concept lab now calls Mubit (untrained). <a href=/api/lock>Lock again</a>.</p><p><a href=/concept/lab/>Concept lab</a> · <a href=/lab/>Research lab</a></p>") : form(liveOff() ? "Live calls are off on this deployment: " + liveOff() : "")));
  app.post("/api/unlock", async c => {
    const ip = ipOf(c), t = await c.req.text(); let pass = "";
    try { pass = (c.req.header("content-type") || "").includes("json") ? String(JSON.parse(t).passcode || "") : String(new URLSearchParams(t).get("passcode") || ""); } catch (e) { pass = ""; }
    const wantsJson = (c.req.header("accept") || "").includes("application/json") || (c.req.header("content-type") || "").includes("json");
    if (limiter.view("unlockfail:" + ip, 600e3) >= LIMITS.unlock_failures_per_ip_10min) return wantsJson ? envelope(c, 429, "RATE_LIMITED", "too many wrong passcodes from this IP: wait 10 min") : c.html(form("Too many wrong passcodes from this IP: wait 10 minutes."), 429);
    if (!PASS() || !same(pass, PASS())) { limiter.take([["unlockfail:" + ip, Infinity]], 1, 600e3); console.log("PURPLE vercel: wrong passcode"); return wantsJson ? envelope(c, 403, "PASSCODE_WRONG", "wrong passcode") : c.html(form("Wrong passcode."), 403); }
    const exp = Date.now() + LIMITS.cookie_h * HOUR;
    c.header("set-cookie", "purple_live=" + cookieFor(exp) + "; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=" + LIMITS.cookie_h * 3600);
    return wantsJson ? c.json({ ok: true, data: { unlocked: true, expires_at: new Date(exp).toISOString() } }) : c.redirect("/api/unlock", 303);
  });
  app.get("/api/lock", c => { c.header("set-cookie", "purple_live=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0"); return c.redirect("/api/unlock", 303); });
  app.get("/api/deploy", c => c.json({ ok: true, data: info(c, "mock", { limits: LIMITS, max_duration_s: MAX_DURATION_S, seeded, prompt_hash_ok: promptHash.ok, designer_prompt: { version: designerPrompt.DESIGNER_PROMPT_VERSION, draft: !!designerPrompt.DRAFT }, usage_this_instance: { live_calls_hour: limiter.view("live:all", HOUR), engine_runs_hour: limiter.view("cpu:all", HOUR), exam_grades_hour: limiter.view("grade:all", HOUR) } }) }));

  // ---- research agent routes that call Mubit
  app.post("/api/plan", async c => {
    const want = !!c.req.header("x-purple-passcode") || !!getCookie(c, "purple_live");
    const live = c.req.header("x-purple-confirm") === "trained";
    if (!live) return forward(c, { note: want ? "research plan calls are TRAINED by design (lab/prompt.js); with the passcode they go live only with the header x-purple-confirm: trained. This one ran on the mock planner." : "mock planner (no passcode)" });
    const no = liveRefusal(c) || reserve(c, "live", 2); if (no) return no;
    return forward(c, { live: true });
  });
  app.post("/api/exam/run", async c => {
    if (!authorized(c)) return forward(c, { note: "mock planner (no passcode)" });
    const no = liveRefusal(c) || reserve(c, "live", 20); if (no) return no;
    return forward(c, { live: true });
  });
  app.post("/api/collect", async c => {
    const { b } = await jsonBody(c);
    if (!authorized(c)) return forward(c, { note: "mock planner (no passcode): nothing was sent to Mubit" });
    const n = b && isInt(b.n) && b.n > 0 ? b.n : 1;
    const no = liveRefusal(c) || (b && b.confirm === "trained" ? reserve(c, "live", n) : null); if (no) return no;
    return forward(c, { live: true });
  });

  // ---- the designer exam's grader (server/exam-route.js): physics sim only, never Mubit; CPU, so rate limited; nothing is stored here
  app.post("/api/concept/exam/grade", async c => {
    const no = reserve(c, "grade", 1); if (no) return no;
    return forward(c, { note: "graded on the physics lap sim on this instance (no Mubit call). This site cannot store answers (read-only): they stay in this browser; use Export answers" });
  });

  // ---- runs
  const ticketFor = (kind, id, b, live) => mintTicket({ kind, id, b, live, exp: Date.now() + LIMITS.ticket_s * 1000 });
  const withTicket = (kind, b, live) => j => { if (j.ok && j.data && j.data.run_id && j.data.stream) j.data.stream += (j.data.stream.includes("?") ? "&" : "?") + "t=" + ticketFor(kind, j.data.run_id, b, live); };
  app.post("/api/concept/loop", async c => {
    const { text, b } = await jsonBody(c); if (!b) return forward(c);
    const live = b.mode === "live";
    if (live) { const no = liveRefusal(c) || reserve(c, "live", isInt(b.iterations) ? b.iterations : 10); if (no) return no; }
    const res = await forward(c, { body: text, edit: withTicket("loop", b, live), live });
    const j = await res.clone().json().catch(() => null);
    if (j && j.ok) { const r = api.concept.runs.get(j.data.run_id); if (r) { if (live) defer("loop", r); else host("loop", r, false); } }
    return res;
  });
  app.post("/api/concept/engine/run", async c => {
    const { b } = await jsonBody(c); if (!b) return forward(c);
    b.workers = isInt(b.workers) ? Math.max(0, Math.min(LIMITS.engine_workers, b.workers)) : LIMITS.engine_workers;   // one vCPU per function
    const live = (b.mode === "auto" || b.mode === "engineer") && b.llm === "live";
    if (live) { const no = liveRefusal(c); if (no) return no; }
    // engine v2 resume: the state is too large for a stream ticket, so a resumed run is only served by the instance that took the POST
    if (b.mode === "engineer" && (b.resume_state != null || b.resume_from != null) && live) return envelope(c, 400, "BAD_INPUT", "resuming a LIVE engineer run is not available on Vercel (a live run starts where its stream is opened, and the saved state does not fit in the stream ticket): resume it locally with npm run dev, or start a new live run");
    if (b.mode === "speed" || b.mode === "auto" || b.mode === "engineer") { const no = reserve(c, "cpu", 1); if (no) return no; }
    // record_good: up to one trained re-send per designer call, so twice the calls are reserved
    if (live) { const no = reserve(c, "live", (isInt(b.max_calls) ? b.max_calls : b.trained === true || b.record_good === true ? 10 : 20) * (b.mode === "engineer" && b.record_good === true ? 2 : 1)); if (no) return no; }
    const tb = b.mode === "engineer" && (b.resume_state != null || b.resume_from != null) ? Object.assign({}, b, { resume_state: undefined, resume_from: undefined, resumed_elsewhere: true }) : b;
    const res = await forward(c, { body: JSON.stringify(b), edit: withTicket("engine", tb, live), live, note: b.mode === "speed" ? "speed run on one vCPU, time-boxed to " + LIMITS.time_box_s + " s on Vercel (stops cleanly and re-scores the best car so far)" : b.mode === "engineer" ? "engine v2 on one vCPU, time-boxed to " + LIMITS.time_box_s + " s on Vercel: it stops cleanly between decisions; the final event carries a resumable state" : undefined });
    const j = await res.clone().json().catch(() => null);
    if (j && j.ok) { const r = api.engine.runs.get(j.data.run_id); if (r) { if (live) defer("engine", r); else host("engine", r, false); } }
    return res;
  });
  // the stream: local run -> stream it; else replay a mock / speed run from its ticket; a live run is never replayed
  app.get("*", async (c, next) => {
    const p = new URL(c.req.url).pathname;
    const m = /^\/api\/concept\/(loop|engine\/run)\/([^/]+)\/stream$/.exec(p);
    if (!m) return next();
    const kind = m[1] === "loop" ? "loop" : "engine", asked = m[2], id = alias.get(asked) || asked;
    const pathFor = x => (kind === "loop" ? "/api/concept/loop/" : "/api/concept/engine/run/") + x + "/stream";
    if (runsOf(kind).has(id) && !deferred.has(id)) return forward(c, { path: pathFor(id) });
    const t = readTicket(c.req.query("t"));
    if (!t || t.id !== asked || t.kind !== kind) return forward(c, { path: pathFor(id) });   // the inner 404
    const fail = msg => sseOnly([["error", { error: msg }], ["end", { run_id: asked, status: "error" }]]);
    if (replayed.has(asked)) return fail("this run was already started from its stream on this instance");
    if (t.live && liveOff()) return fail("live Mubit calls are off on this deployment: " + liveOff());
    if (deferred.has(asked)) await Promise.race([deferred.get(asked), new Promise(res => setTimeout(res, 15000))]);   // the validation run frees the one-run slot
    let r;
    try {
      if (kind === "loop") r = api.concept.start(t.b);
      else { if (api.engine.active()) return fail("an engine run is already running on this instance: " + api.engine.active().id); if (t.b.resumed_elsewhere) return fail("a resumed engineer run streams only from the instance that took its POST; start it again"); r = t.b.mode === "speed" ? api.engine.startSpeed(t.b) : t.b.mode === "engineer" ? api.engine.startEngineer(t.b) : api.engine.startAuto(t.b); }
    } catch (e) { return fail("could not replay the run here: " + (e && e.message || e)); }
    if (t.live) allowedLive.add(r.id);   // synchronous after start(): its first call comes after the next macrotask
    replayed.add(asked); alias.set(asked, r.id); host(kind, r, !!t.live);
    console.log("PURPLE vercel: " + (t.live ? "live run " + asked + " started from its stream as " : "replayed " + asked + " as ") + r.id);
    return forward(c, { path: pathFor(r.id) });
  });
  // run ids handed out before a replay keep working for stop / state
  app.all("/api/concept/engine/run/:id/stop", c => forward(c, { path: "/api/concept/engine/run/" + (alias.get(c.req.param("id")) || c.req.param("id")) + "/stop" }));
  app.get("/api/concept/engine/run/:id", c => forward(c, { path: "/api/concept/engine/run/" + (alias.get(c.req.param("id")) || c.req.param("id")) }));
  app.get("/api/concept/loop/:id", c => forward(c, { path: "/api/concept/loop/" + (alias.get(c.req.param("id")) || c.req.param("id")) }));
  // the research lab's live stream: end it cleanly before the function's limit, EventSource reconnects by itself
  app.get("/api/stream", c => forward(c, { cap: (MAX_DURATION_S - 20) * 1000 }));
  app.all("/api/*", c => forward(c));
  app.all("*", c => c.json({ ok: false, error: { code: "NOT_FOUND", message: "no such route: " + new URL(c.req.url).pathname } }, 404));
  return { app, api, fetch: req => app.fetch(req), limiter, seeded, LIMITS };
}

let instance = null;
const get = () => (instance || (instance = create()));
// the Node (req, res) handler for api/index.js (Vercel's Node.js runtime; streaming responses work through it)
function listener() {
  const { getRequestListener } = require("@hono/node-server");
  return getRequestListener(req => get().fetch(req));
}

module.exports = { build, deploy, listener, create, get, staticSkip, latestSnapshot, seed, Limiter, LIMITS, MAX_DURATION_S };
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === "build") build();
  else if (cmd === "deploy") process.exitCode = deploy(process.argv.slice(3));
  else { console.error("usage: node server/vercel.js build | deploy"); process.exitCode = 1; }
}
