// PURPLE - the concept designer's closed loop with Mubit, server side (docs/concept/LOOP.md). Routes:
//   POST /api/concept/loop              { iterations = 10 (1-30), seed = 1, mode: "mock" | "live", trained = false, confirm, team, pace_ms }
//                                       -> { run_id, session_id, stream, ... } and the run starts in the background
//   GET  /api/concept/loop/:id          -> the run (meta, compact lineage, events so far)
//   GET  /api/concept/loop/:id/stream   -> SSE: every event of the run (replayed, then live): start, request, response, proposal,
//                                          result, link, done | error
//   GET  /api/concept/loops             -> the runs of this process
// Mubit is reached ONLY through server/mubit.js (G-MUBIT-06): callMubit(..., task: concept/designer/prompt.js) for live runs, and
// captureRequest() (a stub fetch, nothing sent) to show the exact request of every iteration, in mock runs too.
// Defaults are the safe ones: mode "mock" (the scripted mock in concept/designer/loop.js, no network), trained false (every live
// call carries x-middleware-record: metadata). trained: true needs confirm: "trained" AND a frozen designer prompt (the DRAFT
// prompt refuses it). Live mode is refused when the server runs with MUBIT_MOCK=1 or without MUBIT_API_KEY.
// Files: <dir>/concept-loops/<run id>/{events.jsonl, lineage.jsonl, calls.jsonl, run.json}; mock runs go to data-mock/ (never data/).
// Also used by concept/designer/loop-cli.js (dry run, mock, live) via designerLlm / previewer.
const path = require("path"), fs = require("fs");
const { streamSSE } = require("hono/streaming");
const { ulid } = require("ulid");
const loop = require("../concept/designer/loop.js");
const designerPrompt = require("../concept/designer/prompt.js");
const mubitReal = require("./mubit.js");

const MAX_ITERATIONS = 30, MAX_PACE_MS = 3000;
const now = () => new Date().toISOString();
const newRunId = () => "loop-" + ulid().toLowerCase();

// the designer tasks (both frozen): "v1" = concept/designer/prompt.js (the default, the website's), "compact" = the "changes only"
// task concept/designer/prompt-compact.js (one change, no hypothesis; a separate Mubit task). task: a name, a task module, or null (v1)
const TASKS = { v1: designerPrompt, compact: require("../concept/designer/prompt-compact.js") };
function taskOf(task) {
  if (task == null) return designerPrompt;
  if (typeof task === "string") { if (!Object.prototype.hasOwnProperty.call(TASKS, task)) throw new Error("designer task must be \"v1\" or \"compact\""); return TASKS[task]; }
  return task;
}
// (text, meta) -> the exact request this call sends (stub fetch in server/mubit.js; nothing leaves the process)
const previewer = task => (text, meta) => mubitReal.captureRequest({ userContent: text, sessionId: meta.sessionId, trained: !!meta.trained, task: taskOf(task) });
// the live designer call: one Mubit call per iteration, kind "design", the designer task (not the research agent's). Every call of
// the returned caller (an untrained proposal and its trained re-send alike) uses the SAME task.
function designerLlm(mubit, task) {
  const m = mubit || mubitReal, t = taskOf(task);
  return (text, meta) => m.callMubit({ userContent: text, sessionId: meta.sessionId, trained: !!meta.trained, kind: "design", task: t });
}

// mount(app, { ok, fail, body, ApiError, mock, dataDir, mockDir, mubit, log })
function mount(app, o) {
  const { ok, body, ApiError } = o;
  const runs = new Map();
  let active = null;
  const log = o.log || (() => {});
  const view = r => ({ run_id: r.id, session_id: r.id, mode: r.mode, trained: r.trained, iterations: r.iterations, seed: r.seed, team: r.team, status: r.status, started_at: r.started_at, finished_at: r.finished_at || null, error: r.error || null, dir: r.dir, events: r.events.length, stream: "/api/concept/loop/" + r.id + "/stream" });

  function start(b) {
    const mode = b.mode == null ? "mock" : b.mode;
    if (!["mock", "live"].includes(mode)) throw new ApiError("BAD_INPUT", "mode must be \"mock\" or \"live\"");
    const iterations = b.iterations == null ? 10 : b.iterations, seed = b.seed == null ? 1 : b.seed;
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) throw new ApiError("BAD_INPUT", "iterations must be an integer 1-" + MAX_ITERATIONS);
    if (!Number.isInteger(seed) || seed < 0 || seed > 999999) throw new ApiError("BAD_INPUT", "seed must be an integer 0-999999");
    const team = b.team === undefined ? "redbull" : b.team === "generic" || b.team === null ? null : b.team;
    if (team !== null && team !== "redbull") throw new ApiError("BAD_INPUT", "team must be \"redbull\" or \"generic\"");
    const pace = b.pace_ms == null ? 0 : b.pace_ms;
    if (!Number.isInteger(pace) || pace < 0 || pace > MAX_PACE_MS) throw new ApiError("BAD_INPUT", "pace_ms must be an integer 0-" + MAX_PACE_MS);
    if (b.trained !== undefined && typeof b.trained !== "boolean") throw new ApiError("BAD_INPUT", "trained must be a boolean");
    const trained = b.trained === true;
    if (trained && b.confirm !== "trained") throw new ApiError("BAD_INPUT", "confirm must be \"trained\": trained designer calls are recorded by Mubit as examples of the designer task (owner approval first, docs/concept/LOOP.md)");
    if (trained && designerPrompt.DRAFT) throw new ApiError("BAD_INPUT", "trained calls are refused while the designer prompt is a DRAFT (" + designerPrompt.DESIGNER_PROMPT_VERSION + "): freeze it first (docs/concept/DESIGNER.md §6)", { draft: true });
    if (mode === "live" && o.mock) throw new ApiError("BAD_INPUT", "live mode is off: this server runs with MUBIT_MOCK=1 (no Mubit calls). Use mode \"mock\".");
    if (mode === "live" && !o.mubit && !process.env.MUBIT_API_KEY) throw new ApiError("BAD_INPUT", "live mode needs MUBIT_API_KEY in server/.env");
    if (active) throw new ApiError("BAD_INPUT", "a loop is already running: " + active.id, { run_id: active.id });

    const id = newRunId();
    const base = mode === "mock" ? o.mockDir : o.dataDir;
    const dir = path.join(base, "concept-loops", id);
    fs.mkdirSync(dir, { recursive: true });
    const r = { id, mode, trained, iterations, seed, team: team || "generic", status: "running", started_at: now(), dir, events: [], lineage: [], listeners: new Set() };
    runs.set(id, r); active = r;
    const write = (f, row) => fs.appendFileSync(path.join(dir, f), JSON.stringify(row) + "\n");
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(view(r), null, 2) + "\n");
    const push = (type, data) => {
      const ev = Object.assign({ seq: r.events.length, at: now() }, data, { type });
      r.events.push(ev); write("events.jsonl", ev);
      for (const l of r.listeners) l(ev);
    };
    // one calls.jsonl row per call (kind "design"; this run's folder, never the research agent's data/calls.jsonl)
    const call = mode === "mock" ? loop.mockCaller(seed) : designerLlm(o.mubit, designerPrompt);
    r.llm = async (text, meta) => {
      const row = { created_at: now(), kind: "design", session_id: meta.sessionId, iteration: meta.gen, trained: !!meta.trained, mock: mode === "mock" };
      try { const res = await call(text, meta); write("calls.jsonl", Object.assign(row, { mubit_request_id: res.mubit_request_id, model: res.model, input_tokens: res.input_tokens, output_tokens: res.output_tokens, latency_ms: res.latency_ms, status: "ok" })); return res; }
      catch (e) { write("calls.jsonl", Object.assign(row, { mubit_request_id: e.requestId || null, status: "error", mubit_code: e.code || null, http_status: e.status || null })); throw e; }
    };
    log(`concept loop ${id} start mode=${mode} trained=${trained} iterations=${iterations} seed=${seed}`);
    const tick = () => new Promise(res => setImmediate(res));   // the run starts after this response and yields between laps (SSE keeps flowing)
    r.promise = tick().then(() => loop.runLoop({
      iterations, seed, runId: id, team, trained, llm: r.llm, preview: previewer(designerPrompt), pace_ms: pace, yield: tick,
      shouldStop: () => (r.stopRequested ? (r.stop_reason = r.stop_reason || "stopped") : null),   // set only by the Vercel adapter (time box); locally never
      onEvent: push, onRow: row => { r.lineage.push(loop.compactRow(row)); },
    })).then(res => {
      r.status = "done"; r.finished_at = now(); r.summary = loop.summaryOf(res);
      fs.writeFileSync(path.join(dir, "lineage.jsonl"), res.lineage.map(x => JSON.stringify(x)).join("\n") + "\n");
      log(`concept loop ${id} done kept=${res.kept} d_lap=${r.summary.d_lap_s}`);
    }, e => {
      r.status = "error"; r.finished_at = now(); r.error = String(e && e.message || e);
      push("error", { error: r.error });
      log(`concept loop ${id} error ${r.error}`);
    }).finally(() => {
      if (active === r) active = null;
      fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(Object.assign(view(r), { summary: r.summary || null }), null, 2) + "\n");
      for (const l of r.listeners) l(null);
    });
    return r;
  }

  app.post("/api/concept/loop", async c => { const r = start(await body(c)); return ok(c, view(r)); });
  app.get("/api/concept/loops", c => ok(c, Array.from(runs.values()).map(view).reverse()));
  app.get("/api/concept/loop/:id", c => {
    const r = runs.get(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "no concept loop " + c.req.param("id"));
    return ok(c, Object.assign(view(r), { summary: r.summary || null, lineage: r.lineage, event_list: r.events }));
  });
  app.get("/api/concept/loop/:id/stream", c => {
    const r = runs.get(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "no concept loop " + c.req.param("id"));
    return streamSSE(c, async stream => {
      const queue = r.events.slice(); let wake = null, closed = false, ended = r.status !== "running";
      const listener = ev => { if (ev === null) ended = true; else queue.push(ev); if (wake) { const w = wake; wake = null; w(); } };
      r.listeners.add(listener);
      stream.onAbort(() => { closed = true; r.listeners.delete(listener); if (wake) wake(); });
      try {
        while (!closed) {
          while (queue.length) { const ev = queue.shift(); await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev), id: String(ev.seq) }); }
          if (ended) { await stream.writeSSE({ event: "end", data: JSON.stringify({ run_id: r.id, status: r.status }) }); break; }
          await new Promise(res => { wake = res; const t = setTimeout(res, 15000); if (t.unref) t.unref(); });
          if (!queue.length && !ended && !closed) await stream.writeSSE({ event: "ping", data: now() });
        }
      } finally { r.listeners.delete(listener); }
    });
  });
  return { runs, start, active: () => active };
}

module.exports = { mount, designerLlm, previewer, taskOf, TASKS, MAX_ITERATIONS, newRunId };
