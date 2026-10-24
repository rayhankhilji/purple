// PURPLE ENGINE v2 - REPLAYS of recorded LIVE Mubit runs for the public site (docs/concept/ENGINE_V2.md §6).
// A visitor without the passcode must never see the scripted mock presented as the AI. The concept lab therefore plays back a run
// that really happened: every decision card carries the real x-middleware-request-id (mreq_…), trained or not, the model's own
// hypothesis (parsed from its recorded answer), what the engine measured and whether it was kept. Nothing is re-simulated or edited.
//   node concept/engineer/replay.js [--out concept/lab/replays] [run folder ...]
// Default inputs: every docs/concept/loop-runs/trained-hybrid-* folder (engine v1 hybrid, mode "auto"), every folder with a
// decisions.jsonl (engine v2 "engineer" runs; copy a live run's folder from <data dir>/concept-engine/<run id> into
// docs/concept/loop-runs/<name> first) and the best pure designer loop (trained-seed29). Runs whose calls are not real Mubit calls
// (mock: no mreq_ id) are refused.
// Output: <out>/index.json (the list, newest first) and <out>/<name>.json (format "purple-replay/1"; one decision per Mubit call or
// fallback step, the tree's result nodes, the peak, per-run stats including the share of kept gains from Mubit-directed decisions).
// A run recorded with record_good (cli.js --record-good: good.jsonl; the engine route: calls.jsonl rows with record_good: true) also
// carries, per decision, training_example "sent" + trained_request_id | "failed" | "not trained", as the live stream says it.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const schema = require("../designer/schema.js"), design = require("../design.js"), bench = require("../bench.js");

const FORMAT = "purple-replay/1";
const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const readJsonl = f => { try { return fs.readFileSync(f, "utf8").split("\n").filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) { return []; } };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
const isReal = id => typeof id === "string" && /^mreq_[0-9a-f]{20,}$/.test(id);
// params as a diff vs the baseline (small): [[ "part.param", value ], ...]
function paramDiff(base, params) {
  if (!params) return null;
  const out = []; for (const part of Object.keys(params)) for (const k of Object.keys(params[part] || {})) { const b = base.params[part] && base.params[part][k]; if (params[part][k] !== b) out.push([part + "." + k, params[part][k]]); }
  return out;
}
function hypothesisOf(text) { if (!text) return null; const v = schema.validate(text); return v.ok ? { hypothesis: v.value.hypothesis, expected: v.value.expected, change_count: v.value.changes.length } : { parse_error: v.error }; }

// engine v1 runs (designer loop / hybrid "auto"): events.jsonl with request / response / proposal / search / result
function fromV1(dir, name) {
  const ev = readJsonl(path.join(dir, "events.jsonl")), calls = readJsonl(path.join(dir, "calls.jsonl")), run = readJson(path.join(dir, "run.json")), sum = readJson(path.join(dir, "summary.json"));
  const start = ev.find(e => e.type === "start" && e.baseline) || ev.find(e => e.type === "start");
  const hybrid = ev.some(e => e.type === "search");
  const team = (run && run.opts && run.opts.team) || "redbull";
  const base = design.baseline(team === "generic" ? undefined : { team });
  const by = (type, it) => ev.find(e => e.type === type && e.iteration === it);
  const its = Array.from(new Set(ev.filter(e => e.type === "result").map(e => e.iteration))).sort((a, b) => a - b);
  const baseLap = start && start.baseline ? start.baseline.lap_s : null;
  const nodes = [{ id: "n0", parent: null, decision: null, kind: "root", lap_s: baseLap, legal: true, by: "baseline" }];
  let head = "n0", headLap = baseLap, peak = "n0", peakLap = baseLap;
  const decisions = [], gain = { mubit: 0, fallback: 0 }, keptBy = { mubit: 0, fallback: 0 }, byN = { mubit: 0, fallback: 0 };
  let illegalProps = 0;
  for (const it of its) {
    const req = by("request", it), resp = by("response", it), prop = by("proposal", it), srch = by("search", it), res = by("result", it);
    const row = res.row, m = row.measured || {};
    const who = row.proposer === "llm" ? "mubit" : "fallback"; byN[who]++;
    const h = resp && resp.ok ? hypothesisOf(resp.text) : null;
    if (prop && prop.reason === "illegal") illegalProps++;
    const id = "n" + nodes.length, legal = !!row.legal && typeof m.lap_after === "number";
    nodes.push({ id, parent: head, decision: it, kind: "result", lap_s: legal ? m.lap_after : null, legal, by: who });
    const dHead = legal ? r3(m.lap_after - headLap) : null;
    const d = {
      decision: it, at: (resp && resp.at) || (res && res.at) || null, by: who, mubit_request_id: resp ? resp.mubit_request_id || null : null, called: !!req, trained: req ? !!req.trained : null, latency_ms: resp ? resp.latency_ms || null : null,
      model_answer: h, model_change: prop && prop.refused ? prop.refused.change : who === "mubit" ? (srch ? srch.proposal_change : row.change) : null,
      refused: prop && prop.refused ? prop.refused.why : null, fallback_reason: who === "fallback" ? (prop && prop.reason) || null : null,
      measured_change: srch ? srch.proposal_change : row.change, search: srch ? { laps: srch.laps, scope: srch.scope, best_stage: srch.best_stage, refined_params: (srch.refined || []).length, proposal_lap_s: srch.proposal_lap_s, lap_s: srch.lap_s } : null,
      best_change: row.change && row.change.length > 220 ? row.change.split("; ").slice(0, 4).join("; ") + " +" + (row.change.split("; ").length - 4) : row.change,
      kept: !!row.kept, legal, lap_after_s: legal ? m.lap_after : null, d_head_s: dHead, articles: legal ? null : (m.legality && m.legality.articles) || null, node: id, head_before: head,
      scenario_chars: req ? req.scenario_chars : null,
    };
    if (row.kept && legal) { gain[who] = r3(gain[who] - dHead); keptBy[who]++; head = id; headLap = m.lap_after; if (m.lap_after < peakLap) { peak = id; peakLap = m.lap_after; d.new_peak = true; } d.params = paramDiff(base, res.best_params || null); }
    d.head_after = head; d.peak_after = peak;
    decisions.push(d);
  }
  const ids = calls.map(c => c.mubit_request_id).filter(Boolean);
  const total = gain.mubit + gain.fallback;
  const first = calls[0] || {}, model = (calls.find(c => c.model) || {}).model || null;
  return {
    format: FORMAT, name, kind: hybrid ? "hybrid-v1" : "loop-v1", engine: hybrid ? "engine v1 · hybrid: Mubit proposes → local search of physics laps → kept by the numbers" : "designer loop v1: Mubit proposes → one physics lap → kept by the numbers",
    source: path.relative(ROOT, dir), run_id: (run && run.run_id) || (start && start.run_id) || null, recorded_at: first.created_at || (start && start.at) || null, model,
    trained: calls.some(c => c.trained === true), calls: calls.length, request_ids: ids, all_real: ids.length > 0 && ids.every(isReal), stop_reason: run ? run.stop_reason : sum ? sum.stopped || null : null,
    team, baseline: { lap_s: baseLap, sectors_s: start && start.baseline ? start.baseline.sectors_s : null }, pole_s: bench.racepace().silverstone.pole.s,
    peak: { node: peak, lap_s: peakLap, gap_to_pole_s: r3(peakLap - bench.racepace().silverstone.pole.s), d_baseline_s: r3(peakLap - baseLap) },
    stats: { decisions: decisions.length, by: byN, kept: keptBy.mubit + keptBy.fallback, kept_by: keptBy, gain_s: gain, directed_gain_share: total > 0 ? +(gain.mubit / total).toFixed(3) : null, proposal_illegal: illegalProps, search_laps: decisions.reduce((s, d) => s + (d.search ? d.search.laps : 0), 0) || null },
    label: "physics lap sim · quasi-steady-state point mass · Silverstone · calibrated to 2026 British GP qualifying (recorded run; replayed, not re-run)",
    nodes, decisions,
  };
}

// record_good runs (concept/engineer/record-good.js): which decisions became a Mubit training example. The terminal run writes
// good.jsonl ({ decision, d_lap_s, untrained_id, trained_id, served_by } or { decision, error }); the engine route writes only the
// calls.jsonl rows with record_good: true (iteration = decision). good.jsonl wins when both exist. null = not a record_good run.
function trainingOf(dir, calls) {
  const good = readJsonl(path.join(dir, "good.jsonl")), rg = calls.filter(c => c.record_good === true);
  if (!good.length && !rg.length) return null;
  const by = new Map();
  if (good.length) for (const g of good) by.set(g.decision, g.error ? { error: String(g.error) } : { trained_id: g.trained_id || null, served_by: g.served_by || null });
  else for (const c of rg) by.set(c.iteration, c.status === "error" || !c.mubit_request_id ? { error: c.mubit_code || "error" } : { trained_id: c.mubit_request_id, served_by: c.served_by || null });
  return by;
}

// engine v2 runs: decisions.jsonl (compact decisions) + calls.jsonl + run.json (+ tree.json, + good.jsonl for a record_good run)
function fromV2(dir, name) {
  const decs = readJsonl(path.join(dir, "decisions.jsonl")), calls = readJsonl(path.join(dir, "calls.jsonl")), run = readJson(path.join(dir, "run.json")), ev = readJsonl(path.join(dir, "events.jsonl"));
  const start = ev.find(e => e.type === "start") || {}, fin = run && run.final ? run.final : null;
  const team = (run && run.opts && run.opts.team) || "redbull", base = design.baseline(team === "generic" ? undefined : { team });
  const nodes = [{ id: "n0", parent: null, decision: null, kind: "root", lap_s: start.baseline ? start.baseline.lap_s : null, legal: true, by: "baseline" }];
  for (const e of ev.filter(x => x.type === "decision")) for (const n of e.nodes || []) nodes.push(n);
  const training = trainingOf(dir, calls);
  // per decision, as the live stream says it: "sent" (+ the trained call's request id), "failed" (the trained re-send errored) or "not trained"
  const trainOf = d => { if (!training) return {}; const t = training.get(d.decision); return !t ? { training_example: "not trained" } : t.error ? { training_example: "failed", training_error: t.error } : { training_example: "sent", trained_request_id: t.trained_id }; };
  const decisions = decs.map(d => Object.assign({}, d, { at: (ev.find(e => e.type === "decision" && e.decision === d.decision) || {}).at || null, params: (() => { const e = ev.find(x => x.type === "decision" && x.decision === d.decision); return e && e.head_params ? paramDiff(base, e.head_params) : null; })() }, trainOf(d)));
  const last = ev.filter(e => e.type === "decision").pop() || {};
  const ids = calls.map(c => c.mubit_request_id).filter(Boolean);
  const examples = training ? decisions.filter(d => d.training_example === "sent").length : null;
  return {
    format: FORMAT, name, kind: "engineer-v2", engine: "engine v2 · autonomous engineer: Mubit decides the subspace → surrogate screen → physics confirm → interactions → kept / reverted by the numbers",
    source: path.relative(ROOT, dir), run_id: run ? run.run_id : null, recorded_at: (calls[0] || {}).created_at || null, model: (calls.find(c => c.model) || {}).model || null,
    trained: calls.some(c => c.trained === true), calls: calls.length, request_ids: ids, all_real: ids.length > 0 && ids.every(isReal), stop_reason: run ? run.stop_reason : null,
    // record_good: designer calls untrained; the physics-approved ones re-sent as trained calls (training examples)
    record_good: !!training, designer_calls: training ? calls.filter(c => c.record_good !== true).length : calls.length, training_examples: examples,
    team, baseline: start.baseline || null, pole_s: bench.racepace().silverstone.pole.s, peak: last.peak || null, stats: last.stats || (fin && fin.summary && fin.summary.stats) || null,
    label: "physics lap sim · quasi-steady-state point mass · Silverstone · calibrated to 2026 British GP qualifying (recorded run; replayed, not re-run)",
    nodes, decisions,
  };
}

function build(dirs, out) {
  fs.mkdirSync(out, { recursive: true });
  const index = [];
  for (const dir of dirs) {
    const name = path.basename(dir);
    const r = fs.existsSync(path.join(dir, "decisions.jsonl")) ? fromV2(dir, name) : fromV1(dir, name);
    if (!r.all_real) { console.error("replay: skipped " + name + " (not every call has a real Mubit request id: never replay a mock as the AI)"); continue; }
    fs.writeFileSync(path.join(out, name + ".json"), JSON.stringify(r) + "\n");
    index.push({ name, kind: r.kind, engine: r.engine, recorded_at: r.recorded_at, calls: r.calls, trained: r.trained, record_good: !!r.record_good, training_examples: r.record_good ? r.training_examples : undefined, model: r.model, decisions: r.decisions.length, baseline_lap_s: r.baseline && r.baseline.lap_s, peak_lap_s: r.peak && r.peak.lap_s, gap_to_pole_s: r.peak && r.peak.gap_to_pole_s, directed_gain_share: r.stats ? r.stats.directed_gain_share : null, first_request_id: r.request_ids[0] || null, last_request_id: r.request_ids[r.request_ids.length - 1] || null, file: name + ".json" });
  }
  // engine v2 runs first, then the fastest
  index.sort((a, b) => (a.kind === "engineer-v2" ? 0 : 1) - (b.kind === "engineer-v2" ? 0 : 1) || String(b.recorded_at || "").localeCompare(String(a.recorded_at || "")));
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify({ format: FORMAT, built_at: new Date().toISOString(), note: "recorded LIVE Mubit runs (real x-middleware-request-id values); replayed in the browser, not re-run; mock runs are never listed", runs: index }, null, 1) + "\n");
  return index;
}
function defaultDirs() {
  const base = path.join(ROOT, "docs", "concept", "loop-runs"); let names = [];
  try { names = fs.readdirSync(base); } catch (e) { return []; }
  return names.filter(n => /^trained-hybrid-/.test(n) || n === "trained-seed29" || fs.existsSync(path.join(base, n, "decisions.jsonl"))).map(n => path.join(base, n));
}

module.exports = { FORMAT, fromV1, fromV2, build, defaultDirs, isReal };
if (require.main === module) {
  const a = process.argv.slice(2); let out = path.join(ROOT, "concept", "lab", "replays"); const dirs = [];
  for (let i = 0; i < a.length; i++) { if (a[i] === "--out") out = path.resolve(a[++i]); else dirs.push(path.resolve(a[i])); }
  const idx = build(dirs.length ? dirs : defaultDirs(), out);
  for (const r of idx) console.log(r.name + ": " + r.kind + " · " + r.calls + " calls · " + r.baseline_lap_s + " -> " + r.peak_lap_s + " s · directed share " + r.directed_gain_share);
}
