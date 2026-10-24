// PURPLE - the designer exam on the API (concept/exam/, the concept lab's "Exam" view). The owner pastes the Mubit-trained adapter's
// replies from the Mubit console (Try models) into the page; this route grades each one with concept/exam/grade.js, the same grader
// as `node concept/exam/run.js` (the engine's one-decision treatment from the question's head car, physics lap sim, fixed seed).
// NO Mubit call is made here: the reply text is the llm's answer; grade.js never loads server/mubit.js.
// Routes (JSON envelope { ok, data } | { ok, error } like the rest of server/app.js):
//   GET  /api/concept/exam/info      questions count, whether answers are saved on this server, the limits
//   GET  /api/concept/exam/answers   the graded answers saved on this server ({ adapter, provider }; empty where nothing is saved)
//   POST /api/concept/exam/grade     { id: "q01", text: "<reply>", column?: "adapter" | "provider" }
//                                    -> { id, phase, column, parsed, legal, direct: { kept, gain_s, ... }, engine: { kept, gain_s, ... }, ... }
// Storage: locally (npm run dev) every graded reply is written to concept/exam/answers-<column>.json (the format run.js --answers reads:
// { "q01": { "text", "grade", "graded_at" } }; PURPLE_EXAM_ANSWERS_DIR moves it). On Vercel the bundle is read-only, so the adapter
// passes writable: false: the committed files are served, nothing is written (the page keeps new grades in the browser and exports the
// same JSON for the integrator to commit). Never data/.
// Workers: one grade at a time per process, on long-lived worker pools (closed after a minute idle); if worker threads cannot start or
// fail, the grade is re-run in this thread (grade.js is deterministic for any worker count, workers = 0 included).
"use strict";
const path = require("path"), fs = require("fs");

const COLUMNS = ["adapter", "provider"];
const MAX_TEXT = 8000;          // chars: a designer reply is ~600; the frozen task caps output at 250 tokens
const MAX_BODY = 16 * 1024;     // bytes of the request body
const MAX_QUEUE = 4;            // grades waiting behind the running one, then 429 BUSY
const IDLE_MS = 60e3;           // pools are closed after this long without a grade

function mount(app, o) {
  const { ok, ApiError } = o;
  const ROOT = o.root || path.join(__dirname, "..");
  const Q = require("../concept/exam/questions.js"), G = require("../concept/exam/grade.js");
  const doc = Q.load();
  const byId = new Map(doc.questions.map(q => [q.id, q]));
  // null = never write (Vercel); PURPLE_EXAM_ANSWERS_DIR moves the files (a rehearsal that must not touch the repo's copy)
  const answersDir = o.answersDir === undefined ? (process.env.PURPLE_EXAM_ANSWERS_DIR ? path.resolve(process.env.PURPLE_EXAM_ANSWERS_DIR) : path.join(ROOT, "concept", "exam")) : o.answersDir;
  const writable = !!answersDir && o.writable !== false;   // Vercel: read the committed files, never write
  if (answersDir && writable) {
    const real = p => { try { return fs.realpathSync(p).toLowerCase(); } catch (e) { return path.resolve(p).toLowerCase(); } };
    const data = real(path.join(ROOT, "data"));
    if (real(answersDir) === data || real(answersDir).startsWith(data + path.sep)) throw new Error("PURPLE exam: refusing to write answers under data/");
  }
  const wantWorkers = o.workers == null ? Math.min(2, require("os").cpus().length) : Math.max(0, o.workers | 0);
  const poolsOf = o.poolFactory || (n => G.pools(n));

  // ---- pools (lazy, shared, closed when idle); fallback to this thread
  let P = null, idle = null, fallback = null;
  function pools() {
    clearTimeout(idle);
    if (P) return P;
    const n = fallback ? 0 : wantWorkers;
    try { P = poolsOf(n); P.n = n; }
    catch (e) { fallback = "worker threads unavailable (" + String(e && e.message || e).slice(0, 80) + "): graded in this thread"; P = poolsOf(0); P.n = 0; }
    return P;
  }
  async function closePools() { const p = P; P = null; if (p) { try { await p.close(); } catch (e) { /* already gone */ } } }
  function armIdle() { clearTimeout(idle); idle = setTimeout(() => { closePools(); }, IDLE_MS); if (idle.unref) idle.unref(); }

  async function gradeOne(q, text) {
    const p = pools();
    try { const g = await G.grade(q, text, { pool: p.pool, screenPool: p.screenPool }); return Object.assign(g, { workers: p.n }); }
    catch (e) {
      if (p.n === 0 || /head re-measured/.test(String(e && e.message))) throw e;
      // a worker died or could not load: close the pools and grade in this thread from now on (same result, deterministic)
      fallback = "worker threads failed (" + String(e && e.message || e).slice(0, 80) + "): graded in this thread";
      if (o.log) o.log("exam: " + fallback);
      await closePools();
      const p0 = pools();
      const g = await G.grade(q, text, { pool: p0.pool, screenPool: p0.screenPool });
      return Object.assign(g, { workers: 0 });
    } finally { armIdle(); }
  }

  // ---- one grade at a time
  let chain = Promise.resolve(), waiting = 0;
  function queued(fn) {
    if (waiting > MAX_QUEUE) throw new ApiError("BUSY", "the grader is busy (" + waiting + " grades waiting): try again in a few seconds");
    waiting++;
    const run = chain.then(fn, fn);
    chain = run.catch(() => {}).then(() => { waiting--; });
    return run;
  }

  // ---- storage (local only)
  const fileOf = col => path.join(answersDir, "answers-" + col + ".json");
  const shown = f => { const r = path.relative(ROOT, f); return r.startsWith("..") || path.isAbsolute(r) ? f : r.split(path.sep).join("/"); };
  const ABOUT = {
    adapter: "PURPLE designer exam, column C: the Mubit-trained adapter's replies, pasted from the Mubit console (Try models) into the concept lab's Exam view and graded there. Grade again from the CLI: node concept/exam/run.js --column adapter --answers concept/exam/answers-adapter.json --n 30",
    provider: "PURPLE designer exam: the provider's side-by-side replies from the Mubit console (Try models), pasted into the concept lab's Exam view. CLI: node concept/exam/run.js --column adapter --answers concept/exam/answers-provider.json --label console-provider --n 30",
  };
  function readAnswers(col) {
    if (!answersDir) return {};
    try { const j = JSON.parse(fs.readFileSync(fileOf(col), "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch (e) { return {}; }
  }
  function save(col, id, entry) {
    if (!writable) return null;
    const cur = readAnswers(col), out = { _about: ABOUT[col] };
    cur[id] = entry;
    for (const q of doc.questions) if (cur[q.id] && typeof cur[q.id] === "object") out[q.id] = cur[q.id];   // id order, known ids only
    fs.mkdirSync(answersDir, { recursive: true });
    const f = fileOf(col), tmp = f + ".tmp-" + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 1) + "\n"); fs.renameSync(tmp, f);
    return shown(f);
  }
  const answersView = col => { const a = readAnswers(col), out = {}; for (const q of doc.questions) if (a[q.id] && typeof a[q.id] === "object") out[q.id] = a[q.id]; return out; };

  // ---- body: size-checked before parsing
  async function smallBody(c) {
    const len = parseInt(c.req.header("content-length") || "", 10);
    if (Number.isFinite(len) && len > MAX_BODY) throw new ApiError("TOO_LARGE", "body too large: " + len + " bytes (max " + MAX_BODY + ")");
    const t = await c.req.text();
    if (Buffer.byteLength(t) > MAX_BODY) throw new ApiError("TOO_LARGE", "body too large: " + Buffer.byteLength(t) + " bytes (max " + MAX_BODY + ")");
    if (!t.trim()) return {};
    let v; try { v = JSON.parse(t); } catch (e) { throw new ApiError("BAD_INPUT", "body must be valid JSON"); }
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ApiError("BAD_INPUT", "body must be a JSON object");
    return v;
  }

  app.get("/api/concept/exam/info", c => ok(c, {
    n: doc.questions.length, ids: doc.questions.map(q => q.id), saves: writable ? shown(path.join(answersDir, "answers-<adapter|provider>.json")) : null,
    writable, workers: fallback ? 0 : wantWorkers, fallback, limits: { max_text_chars: MAX_TEXT, max_body_bytes: MAX_BODY },
    graded_by: "concept/exam/grade.js: the engine's one decision from the question's head car (physics lap sim · Silverstone · model prediction), seed " + G.EXAM_SEED + "; no Mubit call",
  }));
  app.get("/api/concept/exam/answers", c => ok(c, { writable, adapter: answersView("adapter"), provider: answersView("provider") }));
  app.post("/api/concept/exam/grade", async c => {
    const b = await smallBody(c);
    if (typeof b.id !== "string") throw new ApiError("BAD_INPUT", "id must be a question id like \"q01\"");
    const q = byId.get(b.id.trim());
    if (!q) throw new ApiError("NOT_FOUND", "no exam question " + JSON.stringify(b.id.slice(0, 20)) + " (q01..q" + String(doc.questions.length).padStart(2, "0") + ")");
    if (typeof b.text !== "string") throw new ApiError("BAD_INPUT", "text must be a string (the reply exactly as the console shows it)");
    if (b.text.length > MAX_TEXT) throw new ApiError("TOO_LARGE", "text too long: " + b.text.length + " chars (max " + MAX_TEXT + ")");
    if (!b.text.trim()) throw new ApiError("BAD_INPUT", "text is empty: paste the reply first");
    const col = b.column == null ? "adapter" : b.column;
    if (!COLUMNS.includes(col)) throw new ApiError("BAD_INPUT", "column must be \"adapter\" or \"provider\"");
    const g = await queued(() => gradeOne(q, b.text));
    const grade = Object.assign({ phase: q.phase }, g);
    const graded_at = new Date().toISOString();
    let saved = null;
    try { saved = save(col, q.id, { text: b.text, grade, graded_at }); } catch (e) { saved = null; if (o.log) o.log("exam: could not save " + q.id + ": " + (e && e.message || e)); }
    return ok(c, Object.assign({ column: col, graded_at, saved, fallback }, grade));
  });

  return { close: closePools, MAX_TEXT, MAX_BODY, questions: doc.questions };
}

module.exports = { mount, MAX_TEXT, MAX_BODY, COLUMNS };
