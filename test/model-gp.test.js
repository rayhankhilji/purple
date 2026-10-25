// PURPLE Model GP (concept/gp/): the OpenAI route of server/mubit.js (shape, untrained only, Anthropic requests unchanged), the GP
// runner with stand-in entrants (deterministic, the physics-lap budget exact, unparsable answers counted, the memory setting recorded,
// ≤ 8 calls in flight), and the multi-car race URL / payload (round trip; the single-car URL unchanged). No network, no Mubit call.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), os = require("os"), path = require("path");
const mubit = require("../server/mubit.js");
const designerPrompt = require("../concept/designer/prompt.js");
const GP = require("../concept/gp/run.js");
const loop = require("../concept/designer/loop.js");
const RP = require("../concept/race/payload.js");
const design = require("../concept/design.js");

const SHAPE = ["text", "kind", "session_id", "mubit_request_id", "served_by", "model", "input_tokens", "output_tokens", "latency_ms", "trained", "stop_reason"];
const luna = Object.freeze({ PROVIDER: "openai", SYSTEM_PROMPT: designerPrompt.SYSTEM_PROMPT, MODEL: "gpt-6-luna", MAX_TOKENS: 4000, TEMPERATURE: null, DRAFT: false, DESIGNER_PROMPT_VERSION: "1" });
const args = { userContent: "best: 88.745 s", sessionId: "gp-test-session", trained: false };

// ---------------------------------------------------------------- server/mubit.js, OpenAI route
test("OpenAI route: the request (chat completions, system first, max_completion_tokens, no temperature, x-middleware-record: metadata)", async () => {
  const r = mubit.buildRequest(Object.assign({ task: luna }, args));
  assert.equal(r.provider, "openai"); assert.equal(r.path, "/chat/completions");
  assert.deepEqual(r.headers, { "x-middleware-record": "metadata" });
  assert.deepEqual(r.params, { model: "gpt-6-luna", messages: [{ role: "system", content: designerPrompt.SYSTEM_PROMPT }, { role: "user", content: args.userContent }], max_completion_tokens: 4000, user: args.sessionId });
  assert.ok(!("temperature" in r.params) && !("max_tokens" in r.params));
  assert.throws(() => mubit.buildRequest(Object.assign({ task: luna }, args, { trained: true })), /untrained only/);
  const cap = await mubit.captureRequest(Object.assign({ task: luna }, args));
  assert.equal(cap.url, mubit.DEFAULT_OPENAI_BASE_URL + "/chat/completions");
  assert.equal(cap.headers.authorization, "<MUBIT_API_KEY>"); assert.equal(cap.headers["x-middleware-record"], "metadata");
  assert.deepEqual(JSON.parse(cap.body), r.params);
});

test("OpenAI route: callMubit returns the Anthropic route's shape (stub fetch; 429 honoured and retried once)", async () => {
  const prev = { fetch: globalThis.fetch, key: process.env.MUBIT_API_KEY, base: process.env.MUBIT_OPENAI_BASE_URL };
  const seen = [];
  let n = 0;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (n++ === 0) return new Response(JSON.stringify({ error: { message: "busy", code: "starter_credit_busy" } }), { status: 429, headers: { "retry-after": "0.01" } });
    return new Response(JSON.stringify({ id: "chatcmpl-x1", model: "gpt-6-luna-2026", choices: [{ message: { role: "assistant", content: "{\"changes\":[]}" }, finish_reason: "stop" }], usage: { prompt_tokens: 812, completion_tokens: 95 } }), { status: 200, headers: { "content-type": "application/json", "x-middleware-request-id": "mreq_test1" } });
  };
  process.env.MUBIT_API_KEY = "test-key-not-real"; process.env.MUBIT_OPENAI_BASE_URL = "http://127.0.0.1:9/openai/v1";
  try {
    const o = await mubit.callMubit(Object.assign({ task: luna, kind: "gp" }, args));
    assert.deepEqual(Object.keys(o).sort(), SHAPE.slice().sort());
    assert.equal(o.text, "{\"changes\":[]}"); assert.equal(o.mubit_request_id, "mreq_test1"); assert.equal(o.served_by, "provider");
    assert.equal(o.model, "gpt-6-luna-2026"); assert.equal(o.input_tokens, 812); assert.equal(o.output_tokens, 95); assert.equal(o.trained, false); assert.equal(o.stop_reason, "stop"); assert.equal(o.kind, "gp");
    assert.equal(seen.length, 2);
    for (const s of seen) { assert.equal(s.url, "http://127.0.0.1:9/openai/v1/chat/completions"); assert.equal(s.headers.authorization, "Bearer test-key-not-real"); assert.equal(s.headers["x-middleware-record"], "metadata"); }
    await assert.rejects(mubit.callMubit(Object.assign({ task: luna, kind: "gp" }, args, { trained: true })), /untrained only/);
  } finally {
    globalThis.fetch = prev.fetch;
    if (prev.key === undefined) delete process.env.MUBIT_API_KEY; else process.env.MUBIT_API_KEY = prev.key;
    if (prev.base === undefined) delete process.env.MUBIT_OPENAI_BASE_URL; else process.env.MUBIT_OPENAI_BASE_URL = prev.base;
  }
});

test("Anthropic route unchanged: the designer task's request bytes are exactly the pre-GP builder's", async () => {
  // the builder as it was before the OpenAI route (key order matters: the body bytes are what Mubit keys the task on)
  const before = ({ userContent, sessionId, trained, task }) => {
    const t = task;
    const params = { model: t.MODEL, max_tokens: t.MAX_TOKENS, temperature: t.TEMPERATURE, system: t.SYSTEM_PROMPT, messages: [{ role: "user", content: userContent }], metadata: { user_id: sessionId } };
    if (t.TEMPERATURE === null) delete params.temperature;
    return { params, headers: trained ? {} : { "x-middleware-record": "metadata" } };
  };
  for (const task of [designerPrompt, Object.assign({}, designerPrompt, { MODEL: "claude-opus-5-5", TEMPERATURE: null, MAX_TOKENS: 4000 })]) {
    for (const trained of [false, true]) {
      const a = Object.assign({}, args, { trained, task });
      assert.equal(JSON.stringify(mubit.buildRequest(a)), JSON.stringify(before(a)));
    }
  }
  const cap = await mubit.captureRequest(Object.assign({ task: designerPrompt }, args));
  assert.equal(cap.url, mubit.DEFAULT_BASE_URL + "/v1/messages");
  assert.equal(cap.body, JSON.stringify(before(Object.assign({ task: designerPrompt }, args)).params));
  assert.equal(cap.headers["x-middleware-record"], "metadata");
  assert.equal(mubit.buildRequest(args).params.model, require("../lab/prompt.js").MODEL);   // no task: the research task, as before
});

test("entrants: the frozen prompt for everyone, only the model settings differ; GPT-6 Luna takes the OpenAI route; a No-AI control", () => {
  const list = GP.entrants();
  assert.deepEqual(list.map(e => e.id), ["haiku-4-5", "sonnet-5-5", "opus-5-5", "gpt-6-luna", "no-ai"]);
  for (const e of list) {
    const t = GP.taskFor(e);
    if (e.provider === "none") { assert.equal(t, null); continue; }
    assert.equal(t.SYSTEM_PROMPT, designerPrompt.SYSTEM_PROMPT); assert.equal(t.DRAFT, false);
    assert.equal(t.PROVIDER === "openai", e.id === "gpt-6-luna");
    assert.equal(mubit.buildRequest(Object.assign({}, args, { task: t })).headers["x-middleware-record"], "metadata");
  }
  assert.equal(new Set(list.map(e => e.code)).size, list.length);
  for (const e of list) assert.match(e.color, /^#[0-9a-f]{6}$/i);
});

// ---------------------------------------------------------------- concept/gp/run.js with stand-in entrants
const SMALL = Object.freeze(Object.assign({}, GP.SETTINGS, { budget: 30, screen: Object.freeze({ variants: 40, confirm: 3, explore: 1 }) }));
// a stand-in "model": the scripted mock (NOT a model), except decision 2, which answers prose (an unparsable answer)
function standIn(seed, calls) {
  const m = loop.mockCaller(seed);
  return async (text, meta) => { calls.push(meta.gen); if (meta.gen === 2) return { text: "I would raise the rear wing a bit.", mubit_request_id: "mreq_stand_" + meta.gen, model: "stand-in", input_tokens: 10, output_tokens: 8, latency_ms: 5 }; return m(text, meta); };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "purple-gp-test-"));

test("GP runner: budget exact, unparsable answers counted (not hidden as No AI), harness + memory recorded, deterministic", async () => {
  const out = tmp(), calls = [];
  const r = await GP.runAll({ entrants: ["haiku-4-5", "no-ai"], seeds: [3], parallel: 2, workers: 0, out, mock: true, quiet: true, settings: SMALL, callFor: (e, seed) => standIn(seed, calls) });
  assert.ok(r.peak_in_flight <= GP.MAX_IN_FLIGHT);
  const h = JSON.parse(fs.readFileSync(path.join(out, "haiku-4-5-seed3.json"), "utf8")), c = JSON.parse(fs.readFileSync(path.join(out, "no-ai-seed3.json"), "utf8"));
  for (const x of [h, c]) {
    assert.equal(x.laps_used, 30); assert.equal(x.curve.length, 31); assert.equal(x.tries.length, 30); assert.ok(x.laps_run >= 30);
    assert.equal(x.status, "complete"); assert.equal(x.trained, false); assert.equal(x.mock, true);
    assert.equal(x.settings.budget_physics_laps, 30); assert.equal(x.settings.memory, false); assert.deepEqual(x.memory, { on: false });
    assert.equal(x.settings.system_prompt_sha256, require("crypto").createHash("sha256").update(designerPrompt.SYSTEM_PROMPT).digest("hex"));
    for (let i = 1; i < x.curve.length; i++) assert.ok(x.curve[i] <= x.curve[i - 1]);
    assert.equal(x.best_s, x.curve[30]); assert.equal(x.final.check_lap_s, x.best_s);   // the race page re-runs the final car: same lap
    assert.equal(x.designs[x.designs.length - 1].best_s, x.best_s);
  }
  assert.equal(h.parse_failures, 1); assert.equal(h.ideas_by.parse_failure, 1); assert.equal(h.ideas_by.control, 0);
  assert.equal(h.decisions.find(d => d.decision === 2).who, "parse_failure");
  assert.equal(h.ideas_by.model + h.ideas_by.parse_failure + h.ideas_by.llm_error, h.ideas);
  assert.ok(h.request_ids.includes("mreq_stand_2")); assert.equal(h.calls, h.ideas);
  assert.equal(c.calls, 0); assert.equal(c.ideas_by.control, c.ideas); assert.equal(c.parse_failures, 0);
  const s = GP.writeSummary(out);
  assert.equal(s.mock, true); assert.equal(s.settings.memory, false);
  const hs = s.entrants.find(e => e.entrant === "haiku-4-5");
  assert.equal(hs.parse_failures, 1); assert.equal(hs.median_seed, 3); assert.equal(hs.race_car.lap_s, h.best_s);
  // the same run again: the same numbers (seeded engine, deterministic stand-in)
  const out2 = tmp();
  await GP.runAll({ entrants: ["haiku-4-5"], seeds: [3], parallel: 1, workers: 0, out: out2, mock: true, quiet: true, settings: SMALL, callFor: (e, seed) => standIn(seed, []) });
  const h2 = JSON.parse(fs.readFileSync(path.join(out2, "haiku-4-5-seed3.json"), "utf8"));
  assert.deepEqual(h2.curve, h.curve); assert.deepEqual(h2.final.params, h.final.params);
  // runs with another harness are never ranked together
  fs.writeFileSync(path.join(out, "opus-5-5-seed3.json"), JSON.stringify(Object.assign({}, h, { entrant: "opus-5-5", settings: Object.assign({}, h.settings, { memory: true }) })));
  assert.throws(() => GP.writeSummary(out), /mixes harness settings/);
});

test("GP runner: memory on is feature-detected (refused while concept/engineer/memory.js / opts.memory are missing, never silently off)", async () => {
  const sup = GP.memorySupport();
  if (!sup.available) {
    assert.throws(() => GP.memoryOpt(Object.assign({}, GP.SETTINGS, { memory: true })), /memory: true, but/);
    await assert.rejects(GP.main(["--mock", "--memory", "on", "--out", tmp()]), /--memory on, but/);
  } else {
    const m = GP.memoryOpt(Object.assign({}, GP.SETTINGS, { memory: true }));
    assert.equal(m.info.on, true); assert.match(m.info.module_sha256, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(GP.memoryOpt(GP.SETTINGS).info, { on: false });
  assert.equal(GP.parseArgs(["--mock", "--memory", "on", "--out", tmp()]).memory, true);
  assert.throws(() => GP.parseArgs(["--mock", "--memory", "yes", "--out", tmp()]), /--memory on\|off/);
  assert.throws(() => GP.parseArgs(["--mock", "--out", path.join(__dirname, "..", "concept", "gp", "data")]), /never writes into concept\/gp\/data/);
  assert.throws(() => GP.parseArgs(["--live", "--parallel", "9"]), /≤ 8 calls in flight/);
});

// ---------------------------------------------------------------- the multi-car race (concept/race/payload.js)
test("race: several concept cars round-trip through the URL; the single-car URL is unchanged", () => {
  const base = design.baseline({ team: "redbull" });
  const fast = design.applyChanges(base, [{ part: "rear_wing", param: "aoa_deg", to: 17 }]).design; fast.id = "gp-a";
  const cars = [{ name: "Car A", code: "CARA", color: "#3987e5", lap_s: 88.5, seed: 1, design: fast }, { name: "Car B", code: "CARB", color: "#d95926", lap_s: 88.7, seed: 2, design: base }];
  const u = RP.carsUrl(cars, { title: "Model GP" });
  const q = RP.parseQuery(u.slice(u.indexOf("?")));
  assert.deepEqual(q.errors, []); assert.equal(q.mode, "quali"); assert.equal(q.cars.length, 2); assert.equal(q.title, "Model GP"); assert.equal(q.field, "pole");
  assert.deepEqual(q.cars.map(c => [c.id, c.name, c.code, c.color, c.lap_s, c.seed]), [["concept", "Car A", "CARA", "#3987e5", 88.5, 1], ["gp2", "Car B", "CARB", "#d95926", 88.7, 2]]);
  assert.deepEqual(q.cars[0].design.params, fast.params); assert.equal(q.lap_s, 88.5);
  // single car: exactly the old contract (no cars / field / title keys)
  const one = RP.url(fast, { mode: "quali", lap_s: 88.5 });
  assert.ok(!/[?&]cars=/.test(one));
  const q1 = RP.parseQuery(one.slice(one.indexOf("?")));
  assert.deepEqual(Object.keys(q1).sort(), ["conditions", "design", "errors", "lap_s", "mode", "rate", "ref"]);
  assert.deepEqual(q1.design.params, fast.params); assert.equal(q1.mode, "quali");
  // bad lists are refused with a reason, never half-shown
  const bad = RP.carsUrl([{ name: "X", code: "PRPL", color: "#123456", design: base }]);
  assert.match(RP.parseQuery(bad.slice(bad.indexOf("?"))).errors.join(" "), /not PRPL/);
});

test("race: the multi-car qualifying payload simulates every car, keeps its name / colour, orders by lap, and adds the real pole only", () => {
  global.window = global.window || globalThis;
  require("../js/data/racepace2026.js"); require("../js/data/season2026.js");
  const EI = globalThis.EI, rp = EI.RACEPACE.silverstone;
  const base = design.baseline({ team: "redbull" });
  const fast = design.applyChanges(base, [{ part: "rear_wing", param: "aoa_deg", to: 17 }]).design;
  const u = RP.carsUrl([{ name: "Slow", code: "SLOW", color: "#d95926", design: base }, { name: "Fast", code: "FAST", color: "#3987e5", design: fast }]);
  const q = RP.parseQuery(u.slice(u.indexOf("?")));
  const built = RP.buildPayload({ cars: q.cars, ref: "redbull" });
  assert.deepEqual(built.errors, []);
  const poleFile = path.join(__dirname, "..", RP.qualiFile(rp.pole.code));
  const qp = RP.qualiPayload(built.payload, { racepace: rp, season: EI.SEASON, telemetry: { [rp.pole.code]: JSON.parse(fs.readFileSync(poleFile, "utf8")) }, cars: q.cars, field: q.field, title: q.title });
  assert.deepEqual(qp.errors, []);
  assert.equal(qp.payload.gp, true);
  const concept = qp.payload.cars.filter(c => c.kind === "concept");
  assert.deepEqual(concept.map(c => c.code).sort(), ["FAST", "SLOW"]);
  assert.ok(concept[0].lap_s <= concept[1].lap_s); assert.equal(concept[0].ghost, false); assert.equal(concept[1].ghost, true);
  for (const c of concept) assert.equal(c.color, c.code === "FAST" ? "#3987e5" : "#d95926");
  assert.deepEqual(qp.payload.cars.filter(c => c.kind === "real").map(c => c.code), [rp.pole.code]);
  assert.match(qp.payload.foot, /physics lap sim · Silverstone · model prediction/); assert.match(qp.payload.foot, /OpenF1 2026/);
  const pos = qp.order.filter(o => o.pos != null);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i].s >= pos[i - 1].s);
});
