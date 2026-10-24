#!/usr/bin/env node
// PURPLE CONCEPT DESIGNER - the closed loop with Mubit from the terminal (docs/concept/LOOP.md).
//   node concept/designer/loop-cli.js --dry-run --iterations 10 --seed 1     print the exact request of every iteration; NOTHING is sent
//   node concept/designer/loop-cli.js --mock --iterations 10 --seed 1        the same loop, quiet (the scripted mock answers, no network)
//   node concept/designer/loop-cli.js --live --iterations 10 --seed 1        real UNTRAINED calls through Mubit (needs MUBIT_API_KEY)
//   add --confirm-trained to --live for TRAINED calls (owner approval first; refused while the designer prompt is a DRAFT)
// Options: --iterations N (10, max 30) · --seed S (1) · --run-id ID (default loop-<ulid>; it is the Mubit session id) · --out DIR
// (default <os tmp>/purple-loop/<run id>; never data/ or data-mock/) · --team redbull|generic · --json (dry run: one JSON line per
// request instead of the readable print). Writes DIR/lineage.jsonl, DIR/calls.jsonl, DIR/events.jsonl, DIR/summary.json.
// The request is built by server/mubit.js (buildRequest + the SDK, caught by a stub fetch) - the same code that sends live calls.
const fs = require("fs"), os = require("os"), path = require("path");
const loop = require("./loop.js"), prompt = require("./prompt.js"), conceptCli = require("../cli.js");

function parseArgs(argv) {
  const a = { mode: null, iterations: 10, seed: 1, runId: null, out: null, team: "redbull", json: false, trained: false };
  const setMode = m => { if (a.mode && a.mode !== m) throw new Error("choose one of --dry-run, --mock, --live"); a.mode = m; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--dry-run") setMode("dry-run"); else if (k === "--mock") setMode("mock"); else if (k === "--live") setMode("live");
    else if (k === "--confirm-trained") a.trained = true;
    else if (k === "--iterations" || k === "--gens") { a.iterations = +v; i++; } else if (k === "--seed") { a.seed = +v; i++; }
    else if (k === "--run-id") { a.runId = v; i++; } else if (k === "--out") { a.out = v; i++; } else if (k === "--team") { a.team = v; i++; }
    else if (k === "--json") a.json = true; else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error("unknown option " + k);
  }
  if (a.help) return a;
  if (!a.mode) throw new Error("say --dry-run, --mock or --live");
  if (!Number.isInteger(a.iterations) || a.iterations < 1 || a.iterations > 30) throw new Error("--iterations must be an integer 1-30");
  if (!Number.isInteger(a.seed)) throw new Error("--seed must be an integer");
  if (!["redbull", "generic"].includes(a.team)) throw new Error("--team must be redbull or generic");
  if (a.trained && a.mode !== "live") throw new Error("--confirm-trained only applies to --live");
  if (a.runId != null && !/^[A-Za-z0-9_.:-]{1,120}$/.test(a.runId)) throw new Error("--run-id: letters, digits and _ . : - only (≤ 120)");
  return a;
}

async function main(argv, io) {
  io = io || { out: s => process.stdout.write(s), err: s => process.stderr.write(s) };
  const args = parseArgs(argv);
  if (args.help) { io.out(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 11).map(l => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); return 0; }
  if (args.mode === "live") {
    require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, "..", "..", "server", ".env") });
    if (process.env.MUBIT_MOCK === "1") throw new Error("--live with MUBIT_MOCK=1: unset MUBIT_MOCK for real calls");
    if (!process.env.MUBIT_API_KEY) throw new Error("--live needs MUBIT_API_KEY (server/.env)");
    if (args.trained && prompt.DRAFT) throw new Error("--confirm-trained refused: the designer prompt is a DRAFT (" + prompt.DESIGNER_PROMPT_VERSION + "); freeze it first (docs/concept/DESIGNER.md §6)");
  }
  const server = require("../../server/concept.js");   // Mubit only through server/mubit.js (G-MUBIT-06)
  const runId = args.runId || server.newRunId();
  const out = conceptCli.assertSafeOut(path.resolve(args.out || path.join(os.tmpdir(), "purple-loop", runId)));
  fs.mkdirSync(out, { recursive: true });
  for (const f of ["lineage.jsonl", "calls.jsonl", "events.jsonl"]) fs.writeFileSync(path.join(out, f), "");
  const append = (f, row) => fs.appendFileSync(path.join(out, f), JSON.stringify(row) + "\n");

  const call = args.mode === "live" ? server.designerLlm(null, prompt) : loop.mockCaller(args.seed);
  const llm = async (text, meta) => {
    const row = { kind: "design", session_id: meta.sessionId, iteration: meta.gen, trained: !!meta.trained, mode: args.mode };
    try { const r = await call(text, meta); append("calls.jsonl", Object.assign(row, { mubit_request_id: r.mubit_request_id, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, status: "ok" })); return r; }
    catch (e) { append("calls.jsonl", Object.assign(row, { mubit_request_id: e.requestId || null, status: "error", mubit_code: e.code || null })); throw e; }
  };
  const head = "PURPLE concept designer loop · " + (args.mode === "dry-run" ? "DRY RUN (nothing is sent; answers from the scripted mock)" : args.mode === "mock" ? "MOCK (no network)" : "LIVE through Mubit · " + (args.trained ? "TRAINED" : "untrained (x-middleware-record: metadata)")) + " · prompt " + prompt.DESIGNER_PROMPT_VERSION + (prompt.DRAFT ? " (DRAFT)" : "") + " · session (metadata.user_id) " + runId + "\n";
  if (!args.json) io.out(head);
  let systemShown = false;
  const onEvent = (type, ev) => {
    append("events.jsonl", ev);
    if (args.mode !== "dry-run") {
      if (type === "result") { const r = ev.row, m = r.measured; io.err("#" + String(ev.iteration).padStart(2) + " " + (r.loop.mubit_request_id || "-") + " " + String(r.proposer).padEnd(8) + (r.kept ? " kept " : " -    ") + (m.d_lap_s == null ? "illegal " + (m.legality.articles || []).join(" ") : (m.d_lap_s > 0 ? "+" : "") + m.d_lap_s.toFixed(3) + " s") + "  " + (r.change || "") + "\n"); }
      return;
    }
    if (type === "request") {
      const req = ev.request, body = JSON.parse(req.body);
      if (args.json) { io.out(JSON.stringify({ iteration: ev.iteration, method: req.method, url: req.url, headers: req.headers, body }) + "\n"); return; }
      io.out("\n=== iteration " + ev.iteration + " · would send (nothing sent) ===\n" + req.method + " " + req.url + "\n");
      for (const [k, v] of Object.entries(req.headers)) io.out(k + ": " + v + "\n");
      io.out("body.model: " + body.model + " · max_tokens " + body.max_tokens + " · temperature " + body.temperature + " · metadata " + JSON.stringify(body.metadata) + "\n");
      if (!systemShown) { io.out("body.system (" + body.system.length + " chars):\n" + body.system + "\n"); systemShown = true; } else io.out("body.system: same as iteration 1 (" + body.system.length + " chars)\n");
      io.out("body.messages[0].content (user, " + ev.scenario_chars + " chars ≈ " + ev.scenario_tokens + " tokens):\n" + body.messages[0].content + "\n");
    } else if (type === "proposal" && !args.json) {
      io.out("<- " + (ev.proposer === "llm" ? "proposal: " + ev.change + " · " + JSON.stringify(ev.hypothesis) + " · expected " + JSON.stringify(ev.expected) : "refused (" + ev.reason + (ev.refused ? ": " + ev.refused.why : "") + ") -> seeded fallback: " + ev.change) + "\n");
    } else if (type === "result" && !args.json) {
      const r = ev.row, m = r.measured;
      io.out("== measured (" + m.label + "): " + (m.d_lap_s == null ? "ILLEGAL " + (m.legality.articles || []).join(" ") : "lap " + m.lap_before + " -> " + m.lap_after + " s (" + (m.d_lap_s > 0 ? "+" : "") + m.d_lap_s.toFixed(3) + "), sectors " + JSON.stringify(m.d_sectors_s) + (m.moves ? ", gained " + JSON.stringify(m.moves.gain) + ", lost " + JSON.stringify(m.moves.loss) : "")) + " · legal " + m.legality.legal + " · " + (r.kept ? "KEPT" : "rejected") + " · request id " + r.loop.mubit_request_id + "\n");
    }
  };
  const res = await loop.runLoop({ iterations: args.iterations, seed: args.seed, runId, team: args.team === "generic" ? null : args.team, trained: args.trained, llm, preview: server.previewer(prompt), onEvent });
  fs.writeFileSync(path.join(out, "lineage.jsonl"), res.lineage.map(r => JSON.stringify(r)).join("\n") + "\n");
  const s = loop.summaryOf(res);
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(Object.assign({ mode: args.mode }, s), null, 2) + "\n");
  if (!args.json) {
    io.out("\nsummary: " + s.iterations + " iterations · kept " + s.kept + " " + JSON.stringify(s.kept_by_proposer) + " · Silverstone lap " + s.lap_baseline_s + " -> " + s.lap_best_s + " s (" + s.d_lap_s + ") · " + s.label + "\n");
    io.out("one Mubit session: " + s.session_id + " · request ids: " + s.request_ids.join(" ") + "\n");
    io.out("wrote " + out + "/{lineage,calls,events}.jsonl and summary.json\n");
  }
  return 0;
}
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error("loop cli: " + (e.message || e)); process.exitCode = 1; });
module.exports = { parseArgs, main };
