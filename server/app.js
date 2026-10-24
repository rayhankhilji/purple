// PURPLE - the Hono app: routes from ARCHITECTURE §5, the experiment flow from §6, envelope { ok, data } | { ok, error }.
// createApp({ dataDir, mubit, heartbeatMs }) so tests run it in-process (app.request) with the mock planner.
const path = require("path");
const { Hono } = require("hono");
const { streamSSE } = require("hono/streaming");
const { cors } = require("hono/cors");
const { ulid } = require("ulid");
const headless = require("./game-headless.js");
const store = require("./store.js");
const scenarios = require("./scenarios.js");
const { seededRng } = scenarios;   // the one canonical seeded rng (murmur3-mixed seed + 16 discards), shared with the generator's --dry-run
const prompt = require("../lab/prompt.js");
const promptHash = require("./scripts/prompt-hash.js");

const STATUS = { BAD_INPUT: 400, ILLEGAL_SETUP: 422, MUBIT_ERROR: 502, PARSE_ERROR: 502, NOT_FOUND: 404, INTERNAL: 500 };
class ApiError extends Error { constructor(code, message, extra) { super(message); this.code = code; this.extra = extra || {}; } }
const now = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));


function createApp(opts) {
  opts = opts || {};
  const EI = headless.load();
  const { aero, schema, evaluator, U } = EI;
  const dataDir = opts.dataDir || process.env.PURPLE_DATA_DIR || path.join(headless.ROOT, "data");
  const db = store.open(path.isAbsolute(dataDir) ? dataDir : path.join(headless.ROOT, dataDir));
  // G-MUBIT-02 invariant: only real plan calls may train. Any other calls.jsonl row must say trained: false; a bug here would cost task integrity, so it throws.
  const rawAppendCall = db.appendCall; db.appendCall = row => { if (row.kind !== "plan" && row.trained !== false) throw new Error("G-MUBIT-02: calls.jsonl row kind " + row.kind + " must have trained: false"); return rawAppendCall(row); };
  const mubit = opts.mubit || (process.env.MUBIT_MOCK === "1" ? require("../test/mocks/mubit.js") : require("./mubit.js"));
  const heartbeatMs = opts.heartbeatMs || 15000;
  const log = opts.log || ((...a) => console.log(...a));
  const app = new Hono();
  // the lab page is served by the static server on :8788 and talks to this API on :8787 (ARCHITECTURE §12); same host, other port
  app.use("/api/*", cors({ origin: o => (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o || "") ? o : null), allowHeaders: ["content-type", "x-client-id"], allowMethods: ["GET", "POST", "OPTIONS"] }));
  const ok = (c, data, status) => c.json({ ok: true, data }, status || 200);
  const fail = (c, code, message, extra) => c.json({ ok: false, error: Object.assign({ code, message }, extra || {}) }, STATUS[code] || 500);
  app.onError((e, c) => { if (e instanceof ApiError) return fail(c, e.code, e.message, e.extra); console.error("unhandled", e); return fail(c, "INTERNAL", String(e && e.message || e)); });
  app.notFound(c => fail(c, "NOT_FOUND", "no such route: " + c.req.path));
  const body = async c => { try { return (await c.req.json()) || {}; } catch (e) { return {}; } };

  // ---- SSE (ARCHITECTURE §5 /api/stream): events plan, rule, race, status, error; payload is the full object
  const clients = new Set();
  function emit(event, data) { const payload = JSON.stringify(data); for (const cl of clients) cl.writeSSE({ event, data: payload, id: String(Date.now()) }).catch(() => clients.delete(cl)); }
  app.get("/api/stream", c => streamSSE(c, async stream => {
    clients.add(stream); let alive = true; stream.onAbort(() => { alive = false; clients.delete(stream); });
    await stream.writeSSE({ event: "status", data: JSON.stringify(statusView()) });
    while (alive) { await new Promise(r => { const t = setTimeout(r, heartbeatMs); if (t.unref) t.unref(); }); if (!alive) break; try { await stream.writeSSE({ event: "ping", data: now() }); } catch (e) { break; } }
    clients.delete(stream);
  }));

  // ---- state: current baseline, conditions, TD-01, the agent's last plan (next candidate)
  const DEFAULT_STATE = { baseline: aero.BASELINE, conditions: { circuit: "silverstone", wet: false, wind_ms: 0, wind_from_deg: 0 }, td01: false, last_plan: null };
  const state = () => db.readState(DEFAULT_STATE);
  const setState = patch => db.writeState(Object.assign(state(), patch));
  // the status widget (F-06). Console values are entered by hand via POST /api/status; the rest is computed here.
  // budget: Mubit's daily budget rolls at 00:00 UTC (01:00 London), so "today" is the UTC calendar day of each calls.jsonl row.
  const CONSOLE_FIELDS = ["task_name", "kept_examples", "adapter_version", "test_result", "exam"];
  const PROMPT_HASH = promptHash.check().hash;
  const utcDay = iso => (iso || "").slice(0, 10);
  function budgetView(calls, at) {
    const day = utcDay(at), next = new Date(day + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
    const today = calls.filter(x => x.kind !== "illegal" && utcDay(x.created_at) === day);   // illegal rows never reached Mubit
    return { day_utc: day, trained_today_utc: today.filter(x => x.trained === true).length, untrained_today_utc: today.filter(x => x.trained !== true).length, resets_at: next.toISOString(), boundary: "00:00 UTC = 01:00 London" };
  }
  function statusView() {
    const s = db.readStatus(), calls = db.readCalls();
    return Object.assign({ task_name: prompt.TASK_NAME_HINT + "…", kept_examples: 0, adapter_version: null, test_result: null, exam: { provider: null, v1: null, v2: null }, updated_at: null, last_console_read_at: null }, s,
      { model: prompt.MODEL, prompt_version: prompt.PROMPT_VERSION, prompt_hash: PROMPT_HASH, calls_total: calls.length, calls_trained: calls.filter(x => x.trained).length, experiments: db.readLedger().length, budget: budgetView(calls, now()) });
  }

  // ---- one experiment (ARCHITECTURE §6). input: { scenario_overrides: { circuit, conditions, candidate, baseline, seed }, with_rules, random }
  const inflight = new Map();   // x-client-id -> { ts, p } (idempotent for 10 s)
  async function runPlan(input) {
    input = input || {};
    const st = state(), ov = input.scenario_overrides || {};
    const seed = Number.isInteger(ov.seed) ? ov.seed : Math.floor(Math.random() * 2 ** 31);
    const rng = seededRng(U, seed);
    const circuit = ov.circuit || (ov.conditions && ov.conditions.circuit) || st.conditions.circuit || "silverstone";
    if (!EI.TRACKS[circuit] || !["silverstone", "monza"].includes(circuit)) throw new ApiError("BAD_INPUT", "circuit must be silverstone or monza");
    const conditions = Object.assign({}, st.conditions, ov.conditions || {}, { circuit });
    const baseline = ov.baseline ? (() => { const v = schema.validateSetup(ov.baseline); if (!v.ok) throw new ApiError("BAD_INPUT", "baseline " + v.error); return v.value; })() : st.baseline;
    const td01 = !!st.td01;
    let candidate, candidate_source;
    if (ov.candidate) { const v = schema.validateSetup(ov.candidate); if (!v.ok) throw new ApiError("BAD_INPUT", "candidate " + v.error); candidate = v.value; candidate_source = input.candidate_source || "supplied"; }
    else if (st.last_plan && !input.random) { candidate = schema.applyPlan(baseline, st.last_plan); candidate_source = "agent"; }
    else { candidate = scenarios.perturb(baseline, rng, { td01 }); candidate_source = "random"; }
    const mult = aero.toMultipliers(candidate, conditions, { td01 });
    if (!mult.legal) {
      db.appendCall({ id: ulid(), created_at: now(), kind: "illegal", session_id: null, mubit_request_id: null, model: null, latency_ms: 0, status: "illegal", trained: false, violations: mult.violations, seed });
      throw new ApiError("ILLEGAL_SETUP", "candidate violates " + mult.violations.join(", "), { violations: mult.violations, candidate });
    }
    const evaluation = evaluator.evaluate(circuit, candidate, conditions, { baseline, td01 });
    const rules = input.with_rules === false ? [] : db.readRules().filter(r => r.active);
    const history = db.readLedger().filter(x => x.circuit === circuit && x.evaluation && x.evaluation.lap != null && x.status !== "parse_error").slice(0, 3).reverse().map(x => ({ change: x.change, delta_lap: x.evaluation.delta_lap }));
    const scenario = schema.buildScenario({ circuit, conditions, baseline, baselineEval: evaluation.baseline, candidate, evaluation, rules, history });
    const userContent = schema.serializeScenario(scenario);
    const id = ulid(), session_id = "exp-" + id;
    let plan = null, parse = null, mubitErr = null, latency_ms = 0, mubit_request_id = null;
    for (let attempt = 0; attempt < 2 && !plan; attempt++) {
      let r;
      try { r = await mubit.callMubit({ userContent, sessionId: session_id, trained: true, kind: "plan" }); }
      catch (e) { mubitErr = e; db.appendCall({ id: ulid(), created_at: now(), kind: "plan", session_id, mubit_request_id: e.requestId || null, model: prompt.MODEL, latency_ms: 0, status: "error", mubit_code: e.code || null, http_status: e.status || null, trained: true, attempt }); log(`plan ${session_id} ${e.requestId || "-"} error ${e.code || e.message}`); break; }
      const v = schema.validatePlanOutput(r.text);
      latency_ms += r.latency_ms; mubit_request_id = r.mubit_request_id;
      db.appendCall({ id: ulid(), created_at: now(), kind: "plan", session_id, mubit_request_id: r.mubit_request_id, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, status: v.ok ? "ok" : "parse_error", trained: true, attempt, seed });
      log(`plan ${session_id} ${r.mubit_request_id} ${r.latency_ms}ms ${v.ok ? v.value.verdict : "parse_error(" + v.field + ")"}`);
      if (v.ok) plan = v.value; else parse = v;
    }
    const experiment = {
      id, created_at: now(), seed, circuit, conditions, baseline, candidate, candidate_source, change: schema.describeChange(baseline, candidate),
      scenario, evaluation, plan, mubit_request_id, session_id, latency_ms, prompt_version: prompt.PROMPT_VERSION,
      status: plan ? "planned" : "parse_error",
      error: plan ? undefined : (mubitErr ? { code: "MUBIT_ERROR", message: mubitErr.message, mubit_code: mubitErr.code, http_status: mubitErr.status } : { code: "PARSE_ERROR", message: parse.error }),
      rules_applied: rules.map(r => r.id),
    };
    db.appendLedger(experiment);
    if (plan) setState({ last_plan: plan });
    emit("plan", experiment); if (!plan) emit("error", { experiment_id: id, error: experiment.error });
    if (!plan) throw new ApiError(experiment.error.code, experiment.error.message, { experiment_id: id, mubit_code: experiment.error.mubit_code, experiment });
    return experiment;
  }
  // n random-candidate plan calls, concurrency 2 (G-MUBIT-05); illegal picks are retried with the next seed
  // promote_bias (EVAL D-E1): share of candidates the generator draws from the evaluator's "promote" moves; 0 = the v1 generator exactly.
  // Whether it applied to a draw is replayed here from the same seed: perturb()'s first rng() is the bias draw, and it only uses a
  // promote move when that class is non-empty. Such rows get candidate_source "random-biased".
  const biasApplied = (seed, bias, baseline, circuit, td01) => bias > 0 && seededRng(U, seed)() < bias && scenarios.movesByVerdict(evaluator, baseline, { circuit, wet: false, wind_ms: 0, wind_from_deg: 0 }, { td01 }).promote.length > 0;
  async function collect(n, o) {
    o = o || {}; const conc = Math.min(2, o.concurrency || 2), seed0 = Number.isInteger(o.seed) ? o.seed : Math.floor(Math.random() * 1e6);
    const bias = o.promote_bias == null ? 0 : Number(o.promote_bias);
    if (!Number.isFinite(bias) || bias < 0 || bias > 1) throw new ApiError("BAD_INPUT", "promote_bias must be a number between 0 and 1");
    const res = { sent: 0, ok: 0, parse_error: 0, mubit_error: 0, illegal_retries: 0, promote_bias: bias, biased: 0, seeds: [] }; let next = 0;
    async function worker() {
      while (next < n) {
        const i = next++; let seed = seed0 * 1000 + i;
        for (let tries = 0; tries < 5; tries++) {
          const rng = seededRng(U, seed), st = state(), circuit = o.circuit || "silverstone"; const g = scenarios.generate(rng, { circuit, baseline: st.baseline, td01: st.td01, promote_bias: bias });
          const biased = biasApplied(seed, bias, st.baseline, circuit, !!st.td01);
          try { res.sent++; await runPlan({ random: true, with_rules: !!o.with_rules, candidate_source: biased ? "random-biased" : "random", scenario_overrides: { seed, circuit: g.conditions.circuit, conditions: g.conditions, candidate: g.candidate } }); res.ok++; if (biased) res.biased++; res.seeds.push(seed); break; }
          catch (e) {
            if (e.code === "ILLEGAL_SETUP") { res.sent--; res.illegal_retries++; seed += 7919; continue; }
            if (e.code === "PARSE_ERROR") res.parse_error++; else res.mubit_error++;
            break;
          }
        }
        if (o.pauseMs) await sleep(o.pauseMs);
      }
    }
    await Promise.all(Array.from({ length: conc }, worker));
    res.kept_hint = res.ok; return res;
  }
  // dry run of collect(): same seeds, generator and evaluator, NO Mubit call and NO data write. Previews the verdict mix the truth rule
  // (ARCHITECTURE §4.10, the thresholds the frozen prompt states) would give the examples before a budget is spent.
  function dryCollect(n, o) {
    o = o || {}; const seed0 = Number.isInteger(o.seed) ? o.seed : Math.floor(Math.random() * 1e6), circuit = o.circuit || "silverstone";
    const bias = o.promote_bias == null ? 0 : Number(o.promote_bias);
    if (!Number.isFinite(bias) || bias < 0 || bias > 1) throw new ApiError("BAD_INPUT", "promote_bias must be a number between 0 and 1");
    if (!EI.TRACKS[circuit] || !["silverstone", "monza"].includes(circuit)) throw new ApiError("BAD_INPUT", "circuit must be silverstone or monza");
    const st = state(), td01 = !!st.td01, baseline = st.baseline;
    const res = { n, seed: seed0, circuit, promote_bias: bias, biased: 0, illegal_retries: 0, verdicts: { promote: 0, retest: 0, reject: 0 }, conditions: { dry: 0, wind: 0, wet: 0 }, parameters: {}, delta_lap: { min: Infinity, max: -Infinity, mean: 0 }, items: [] };
    for (let i = 0; i < n; i++) {
      let seed = seed0 * 1000 + i, g, mult;
      for (let tries = 0; tries < 5; tries++) {
        g = scenarios.generate(seededRng(U, seed), { circuit, baseline, td01, promote_bias: bias }); mult = aero.toMultipliers(g.candidate, g.conditions, { td01 });
        if (mult.legal) break; res.illegal_retries++; seed += 7919; g = null;
      }
      if (!g) continue;
      const ev = evaluator.evaluate(circuit, g.candidate, g.conditions, { baseline, td01 }), verdict = scenarios.verdictOf(ev.delta_lap), biased = biasApplied(seed, bias, baseline, circuit, td01);
      res.verdicts[verdict]++; if (biased) res.biased++;
      res.conditions[g.conditions.wet ? "wet" : g.conditions.wind_ms ? "wind" : "dry"]++;
      for (const k of aero.KEYS) if (g.candidate[k] !== baseline[k]) res.parameters[k] = (res.parameters[k] || 0) + 1;
      res.delta_lap.min = Math.min(res.delta_lap.min, ev.delta_lap); res.delta_lap.max = Math.max(res.delta_lap.max, ev.delta_lap); res.delta_lap.mean += ev.delta_lap;
      res.items.push({ seed, change: schema.describeChange(baseline, g.candidate), conditions: g.conditions, delta_lap: ev.delta_lap, verdict, candidate_source: biased ? "random-biased" : "random" });
    }
    if (res.items.length) res.delta_lap.mean = +(res.delta_lap.mean / res.items.length).toFixed(3); else res.delta_lap = { min: null, max: null, mean: null };
    return res;
  }
  // the exam (F-08): 20 fixed scenarios, provider answers untrained, scored against the evaluator's truth
  async function runExam() {
    const exam = db.readExam(); if (!exam || !exam.length) throw new ApiError("NOT_FOUND", "data/exam.json missing: build it with P2.T5 first");
    const details = []; let next = 0, score = 0, paramScore = 0;
    async function worker() {
      while (next < exam.length) {
        const item = exam[next++]; const session_id = "exam-" + item.id;
        try {
          const r = await mubit.callMubit({ userContent: schema.serializeScenario(item.scenario), sessionId: session_id, trained: false, kind: "exam" });
          const v = schema.validatePlanOutput(r.text);
          db.appendCall({ id: ulid(), created_at: now(), kind: "exam", session_id, mubit_request_id: r.mubit_request_id, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, status: v.ok ? "ok" : "parse_error", trained: false });
          const hit = v.ok && v.value.verdict === item.truth.verdict, phit = v.ok && v.value.next_parameter === item.truth.next_parameter && v.value.direction === item.truth.direction;
          if (hit) score++; if (phit) paramScore++;
          details.push({ id: item.id, truth: item.truth, answer: v.ok ? { verdict: v.value.verdict, next_parameter: v.value.next_parameter, direction: v.value.direction } : null, verdict_ok: hit, param_ok: phit, mubit_request_id: r.mubit_request_id });
          log(`exam ${session_id} ${r.mubit_request_id} ${r.latency_ms}ms ${v.ok ? v.value.verdict : "parse_error"} untrained`);
        } catch (e) { details.push({ id: item.id, error: e.code || e.message }); }
      }
    }
    await Promise.all([worker(), worker()]);
    const st = db.readStatus(); st.exam = Object.assign({}, st.exam, { provider: score, total: exam.length, provider_param: paramScore }); st.updated_at = now(); db.writeStatus(st); emit("status", statusView());
    return { provider: score, total: exam.length, provider_param: paramScore, details };
  }

  // ---- routes
  app.get("/api/health", c => ok(c, { ok: true, time: now(), model: prompt.MODEL, prompt_version: prompt.PROMPT_VERSION, mock: !!mubit.CANNED }));
  app.post("/api/evaluate", async c => {
    const b = await body(c); const v = schema.validateSetup(b.setup); if (!v.ok) throw new ApiError("BAD_INPUT", v.error);
    const st = state(); const conditions = Object.assign({}, st.conditions, b.conditions || {}); const circuit = conditions.circuit || "silverstone";
    if (!["silverstone", "monza"].includes(circuit)) throw new ApiError("BAD_INPUT", "circuit must be silverstone or monza");
    const ev = evaluator.evaluate(circuit, v.value, conditions, { baseline: b.baseline || st.baseline, td01: !!st.td01 });
    if (!ev.legal) throw new ApiError("ILLEGAL_SETUP", "setup violates " + ev.violations.join(", "), { violations: ev.violations });
    return ok(c, ev);
  });
  app.post("/api/plan", async c => {
    const b = await body(c); const key = c.req.header("x-client-id");
    if (key) { const hit = inflight.get(key); if (hit && Date.now() - hit.ts < 10000) return ok(c, await hit.p); const p = runPlan(b); inflight.set(key, { ts: Date.now(), p }); try { return ok(c, await p); } finally { setTimeout(() => inflight.delete(key), 10000).unref(); } }
    return ok(c, await runPlan(b));
  });
  app.post("/api/promote", async c => {
    const b = await body(c); const x = db.findExperiment(b.experiment_id); if (!x) throw new ApiError("NOT_FOUND", "no experiment " + b.experiment_id);
    setState({ baseline: x.candidate, last_plan: null }); db.appendLedger(Object.assign({}, x, { status: "promoted", promoted_at: now() }));
    emit("plan", Object.assign({}, x, { status: "promoted" })); return ok(c, { baseline: x.candidate });
  });
  // ---- F-05 correction loop, server side (ARCHITECTURE §4.8, §5). Rule text = the reason, whitespace-collapsed, ≤ 160 chars.
  const RULE_TEXT_MAX = 160;
  const ruleText = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, RULE_TEXT_MAX).trim();
  // R-xx = max existing number + 1, so a hand-deleted or toggled rule never makes two rules share an id
  const nextRuleId = rules => "R-" + String(rules.reduce((m, r) => { const n = /^R-(\d+)$/.exec(r && r.id || ""); return n ? Math.max(m, parseInt(n[1], 10)) : m; }, 0) + 1).padStart(2, "0");
  app.post("/api/overrule", async c => {
    const b = await body(c);
    if (typeof b.experiment_id !== "string" || !b.experiment_id) throw new ApiError("BAD_INPUT", "experiment_id must be a non-empty string");
    const x = db.findExperiment(b.experiment_id); if (!x) throw new ApiError("NOT_FOUND", "no experiment " + b.experiment_id);
    if (!["promote", "reject", "retest"].includes(b.verdict)) throw new ApiError("BAD_INPUT", "verdict must be promote|reject|retest");
    const reason = ruleText(b.reason); if (!reason) throw new ApiError("BAD_INPUT", "reason is required (non-empty text, becomes the rule)");
    const rules = db.readRules(); const rule = { id: nextRuleId(rules), text: reason, created_at: now(), from_experiment: x.id, active: true }; rules.push(rule); db.writeRules(rules);
    const overrule = { verdict: b.verdict, reason, rule_id: rule.id, by: ruleText(b.by) || "engineer", at: now() };
    const row = Object.assign({}, x, { status: "overruled", overrule }); db.appendLedger(row); setState({ last_plan: null });
    emit("rule", rule); emit("plan", row); return ok(c, { rule, experiment: row });
  });
  // ---- F-04 race result (ARCHITECTURE §4.7 measured block, §5). Posted by the lab page from the game's purple:result message.
  // Payload: { experiment_id, seed, cars: [{ role: "baseline"|"candidate", lap, sectors: [s1,s2,s3], vmax_kmh, vmin_becketts_kmh }] }.
  // A second post for the same experiment appends a new ledger row with the same id, which supersedes the first (store.readLedger dedupes).
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  function validateRaceResult(b) {
    const bad = m => { throw new ApiError("BAD_INPUT", m); };
    if (typeof b.experiment_id !== "string" || !b.experiment_id) bad("experiment_id must be a non-empty string");
    if (!Number.isInteger(b.seed)) bad("seed must be an integer");
    if (!Array.isArray(b.cars)) bad("cars must be an array of 2 cars (baseline, candidate)");
    if (b.cars.length !== 2) bad("cars must hold exactly 2 cars, got " + b.cars.length);
    const out = {};
    b.cars.forEach((k, i) => {
      const at = "cars[" + i + "]";
      if (!k || typeof k !== "object") bad(at + " must be an object");
      if (k.role !== "baseline" && k.role !== "candidate") bad(at + ".role must be baseline or candidate");
      if (out[k.role]) bad(at + ".role " + k.role + " appears twice");
      if (!isNum(k.lap) || k.lap <= 0) bad(at + ".lap must be a positive number of seconds");
      if (!Array.isArray(k.sectors) || k.sectors.length !== 3 || !k.sectors.every(s => isNum(s) && s >= 0)) bad(at + ".sectors must be an array of 3 non-negative numbers");
      if (!isNum(k.vmax_kmh) || k.vmax_kmh <= 0) bad(at + ".vmax_kmh must be a positive number");
      if (!isNum(k.vmin_becketts_kmh) || k.vmin_becketts_kmh <= 0) bad(at + ".vmin_becketts_kmh must be a positive number");
      if (k.vmin_becketts_kmh > k.vmax_kmh) bad(at + ".vmin_becketts_kmh must not exceed vmax_kmh");
      out[k.role] = { lap: +k.lap.toFixed(3), sectors: k.sectors.map(s => +s.toFixed(3)), vmax_kmh: +k.vmax_kmh.toFixed(1), vmin_becketts_kmh: +k.vmin_becketts_kmh.toFixed(1) };
    });
    if (!out.baseline) bad("cars must hold a baseline car"); if (!out.candidate) bad("cars must hold a candidate car");
    return out;
  }
  // F-04.AC2: agreement_pct = 100·|measuredΔ − predictedΔ| / |predictedΔ| (0 = perfect agreement); null when the model predicted no change
  const agreementPct = (measured, predicted) => isNum(predicted) && Math.abs(predicted) > 1e-6 ? Math.round(100 * Math.abs(measured - predicted) / Math.abs(predicted)) : null;
  app.post("/api/race/result", async c => {
    const b = await body(c); const cars = validateRaceResult(b);
    const x = db.findExperiment(b.experiment_id); if (!x) throw new ApiError("NOT_FOUND", "no experiment " + b.experiment_id);
    const predicted = x.evaluation && isNum(x.evaluation.delta_lap) ? x.evaluation.delta_lap : null, measuredDelta = +(cars.candidate.lap - cars.baseline.lap).toFixed(3);
    const measured = {
      baseline: cars.baseline, candidate: cars.candidate,
      measured_delta: measuredDelta, predicted_delta: predicted, agreement_pct: agreementPct(measuredDelta, predicted),
      measured_sector_deltas: cars.candidate.sectors.map((s, i) => +(s - cars.baseline.sectors[i]).toFixed(3)),
      seed: b.seed, at: now(), label: "measured in race, seed " + b.seed, supersedes: x.measured ? x.measured.at : null,
    };
    const status = x.status === "overruled" || x.status === "promoted" ? x.status : "raced";   // the engineer's verdict outranks the race
    const row = Object.assign({}, x, { status, measured }); db.appendLedger(row); emit("race", row); return ok(c, row);
  });
  app.get("/api/ledger", c => ok(c, db.readLedger({ limit: Math.min(500, parseInt(c.req.query("limit") || "50", 10) || 50) })));
  app.get("/api/experiments/:id", c => { const x = db.findExperiment(c.req.param("id")); if (!x) throw new ApiError("NOT_FOUND", "no experiment"); return ok(c, x); });
  app.get("/api/rules", c => {   // ?active=1 -> active rules only (what the next scenario will carry); ?active=0 -> inactive only
    const q = c.req.query("active"), rules = db.readRules();
    if (q == null || q === "") return ok(c, rules);
    if (!["1", "0", "true", "false"].includes(q)) throw new ApiError("BAD_INPUT", "active must be 1 or 0");
    const want = q === "1" || q === "true"; return ok(c, rules.filter(r => !!r.active === want));
  });
  app.post("/api/rules/:id", async c => {   // toggle (the technical-directive demo); the rule keeps its id and text
    const b = await body(c); const rules = db.readRules(); const r = rules.find(x => x.id === c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "no rule " + c.req.param("id"));
    if (typeof b.active !== "boolean") throw new ApiError("BAD_INPUT", "active must be a boolean");
    r.active = b.active; r.updated_at = now(); db.writeRules(rules); emit("rule", r); return ok(c, r);
  });
  app.get("/api/status", c => ok(c, statusView()));
  app.post("/api/status", async c => {   // partial update; a body that carries console values stamps last_console_read_at (or pass it explicitly)
    const b = await body(c); const patch = {}; for (const k of Object.keys(b)) if (!["budget", "prompt_hash", "model", "prompt_version", "calls_total", "calls_trained", "experiments"].includes(k)) patch[k] = b[k];
    if (b.last_console_read_at != null && (typeof b.last_console_read_at !== "string" || Number.isNaN(Date.parse(b.last_console_read_at)))) throw new ApiError("BAD_INPUT", "last_console_read_at must be an ISO 8601 string");
    if (b.last_console_read_at == null && CONSOLE_FIELDS.some(k => k in b)) patch.last_console_read_at = now();
    // one-level deep merge: { exam: { v1: 4 } } keeps exam.provider / total / provider_param; a non-object value replaces the key
    const cur = db.readStatus(); const isObj = v => v && typeof v === "object" && !Array.isArray(v);
    for (const k of Object.keys(patch)) if (isObj(patch[k]) && isObj(cur[k])) patch[k] = Object.assign({}, cur[k], patch[k]);
    const s = Object.assign(cur, patch, { updated_at: now() }); db.writeStatus(s); emit("status", statusView()); return ok(c, statusView());
  });
  app.get("/api/state", c => ok(c, state()));
  app.post("/api/state", async c => {   // additive (TASK_LOG decision): conditions, TD-01 and baseline edits for the UI and the directive demo
    const b = await body(c); const patch = {};
    if (b.conditions) patch.conditions = Object.assign({}, state().conditions, b.conditions);
    if ("td01" in b) patch.td01 = !!b.td01;
    if (b.baseline) { const v = schema.validateSetup(b.baseline); if (!v.ok) throw new ApiError("BAD_INPUT", v.error); patch.baseline = v.value; }
    if (b.reset_plan) patch.last_plan = null;
    const s = setState(patch); emit("status", statusView()); return ok(c, s);
  });
  app.post("/api/exam/run", async c => ok(c, await runExam()));
  // trained calls spend the daily budget and shape the task: the caller must say so, and n is capped (the CLI `npm run collect` is the integrator's path)
  const COLLECT_MAX_N = 60;
  app.post("/api/collect", async c => {
    const b = await body(c);
    if (b.confirm !== "trained") throw new ApiError("BAD_INPUT", "confirm must be \"trained\": /api/collect sends TRAINED Mubit calls that spend the daily budget and become task examples");
    if (!Number.isInteger(b.n) || b.n < 1) throw new ApiError("BAD_INPUT", "n must be an integer >= 1 (max " + COLLECT_MAX_N + ")");
    if (b.n > COLLECT_MAX_N) throw new ApiError("BAD_INPUT", "n must be <= " + COLLECT_MAX_N + " per request (budget guard)");
    return ok(c, await collect(b.n, { with_rules: !!b.with_rules, seed: b.seed, circuit: b.circuit, promote_bias: b.promote_bias }));
  });
  return { app, emit, db, state, setState, runPlan, collect, dryCollect, runExam, statusView, EI };
}
module.exports = { createApp, ApiError, STATUS, seededRng };
