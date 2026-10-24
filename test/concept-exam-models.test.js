// PURPLE DESIGNER EXAM - the model comparison (concept/exam/models.json, run.js --model, the Exam view's "Model comparison").
// --model swaps only the model id of the frozen designer task (system prompt, max_tokens identical; temperature identical, or left
// out for a model whose API rejects it), every call is untrained (x-middleware-record: metadata), ≤ 8 in flight, the results file is
// named per model and records latency / tokens / served_by / model as returned; the frozen tasks' request bytes do not change; the
// panel shows n/N from the files as they are and "not run yet" without one. The HTTP server is a loopback stand-in on 127.0.0.1:
// Mubit is never called.
process.env.MUBIT_API_KEY = "mbt_loopback_test_key_never_sent_anywhere";   // set before server/mubit.js builds its client
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const Q = require("../concept/exam/questions.js"), R = require("../concept/exam/run.js");
const prompt = require("../concept/designer/prompt.js"), research = require("../lab/prompt.js"), mubit = require("../server/mubit.js");

const ROOT = path.join(__dirname, "..");
const doc = Q.load();
const MODELS = JSON.parse(fs.readFileSync(path.join(ROOT, "concept/exam/models.json"), "utf8")).models;
const REPLY = "{\"changes\":[{\"part\":\"floor\",\"param\":\"ride_height_mm\",\"to\":33}],\"hypothesis\":\"t\",\"expected\":{\"lap_delta_s\":-1,\"sector\":2}}";

// stand-in gateway: like the integrator's live probe, a model that rejects temperature answers 400 when one is sent
function loopback(delayMs) {
  const seen = []; let inFlight = 0, maxInFlight = 0;
  const noTemp = new Set(MODELS.filter(m => m.temperature === null).map(m => m.id));
  const srv = http.createServer((req, res) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => setTimeout(() => {
      const body = JSON.parse(b); seen.push({ url: req.url, headers: req.headers, raw: b, body });
      if (noTemp.has(body.model) && "temperature" in body) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "`temperature` is deprecated for this model." } }));
      } else {
        res.writeHead(200, { "content-type": "application/json", "x-middleware-request-id": "mreq_" + String(seen.length).padStart(32, "0") });
        res.end(JSON.stringify({ id: "msg_" + seen.length, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: REPLY }], stop_reason: "end_turn", usage: { input_tokens: 400, output_tokens: 40 } }));
      }
      inFlight--;
    }, delayMs));
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, seen, max: () => maxInFlight, url: "http://127.0.0.1:" + srv.address().port + "/anthropic" })));
}

test("models.json is the one list: Haiku (frozen temperature 0), Sonnet 5.5, Opus 5.5 (no temperature); run.js accepts only these", () => {
  assert.deepEqual(MODELS.map(m => m.id), ["claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(R.models().map(m => m.id), MODELS.map(m => m.id));
  const haiku = MODELS[0];
  assert.equal(haiku.id, prompt.MODEL, "the current model is the frozen task's");
  assert.equal(haiku.temperature, prompt.TEMPERATURE);
  for (const m of MODELS) { assert.match(m.slug, /^[a-z0-9-]+$/); assert.ok(m.temperature === null || m.temperature === prompt.TEMPERATURE, m.id); }
  assert.throws(() => R.parseArgs(["--column", "base", "--model", "gpt-4o"]), /not in concept\/exam\/models\.json/);
  assert.throws(() => R.parseArgs(["--column", "none", "--model", "claude-opus-5-5"]), /--model goes with --column base/);
  assert.throws(() => R.parseArgs(["--column", "base", "--model", "claude-opus-5-5", "--concurrency", "9"]), /1\.\.8/);
  assert.equal(R.parseArgs(["--column", "base", "--model", "claude-opus-5-5"]).model, "claude-opus-5-5");
});

test("--model swaps only MODEL: system prompt, max_tokens, temperature (or none), metadata and the untrained header identical", () => {
  const args = { userContent: doc.questions[0].text, sessionId: "exam-dsg-x", trained: false };
  const frozen = mubit.buildRequest(Object.assign({ task: prompt }, args));
  for (const m of MODELS) {
    const t = R.modelTask(m.id);
    assert.ok(Object.isFrozen(t));
    assert.equal(t.SYSTEM_PROMPT, prompt.SYSTEM_PROMPT); assert.equal(t.MAX_TOKENS, prompt.MAX_TOKENS); assert.equal(t.DRAFT, prompt.DRAFT);
    const r = mubit.buildRequest(Object.assign({ task: t }, args));
    const want = Object.assign({}, frozen.params, { model: m.id });
    if (m.temperature === null) delete want.temperature;
    assert.equal(JSON.stringify(r.params), JSON.stringify(want), m.id + ": only the model (and, where the model rejects it, the temperature field) differ");
    assert.deepEqual(r.headers, { "x-middleware-record": "metadata" });
    assert.throws(() => mubit.buildRequest(Object.assign({ task: Object.assign({}, t, { DRAFT: true }) }, args, { trained: true })), /DRAFT/);
  }
  // Haiku through --model is byte for byte the frozen designer request
  assert.equal(JSON.stringify(mubit.buildRequest(Object.assign({ task: R.modelTask("claude-haiku-4-5") }, args)).params), JSON.stringify(frozen.params));
  // the frozen tasks still send their temperature, in the same key order as before
  for (const task of [prompt, undefined]) {
    const p = mubit.buildRequest(Object.assign({ task }, args)).params;
    assert.deepEqual(Object.keys(p), ["model", "max_tokens", "temperature", "system", "messages", "metadata"]);
    assert.equal(p.temperature, (task || research).TEMPERATURE);
  }
});

test("run.js --model (stub gateway): untrained, ≤ 8 in flight, results-base-<slug>.json with latency, tokens, served_by, model as returned", async () => {
  const lb = await loopback(40); process.env.MUBIT_BASE_URL = lb.url;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "purple-exam-models-"));
  try {
    // baseAnswers at the comparison's concurrency: never more than 8 in flight
    const b = await R.baseAnswers(doc.questions.slice(0, 12), { mock: false, sessionId: "exam-dsg-conc", task: R.modelTask("claude-sonnet-5-5"), concurrency: 8 });
    assert.ok(lb.max() <= 8 && lb.max() >= 2, "in flight " + lb.max());
    assert.ok(b.answers.every(a => !a.error && a.model === "claude-sonnet-5-5" && a.served_by === "provider" && a.input_tokens === 400 && a.output_tokens === 40 && typeof a.latency_ms === "number"));
    await assert.rejects(R.baseAnswers(doc.questions.slice(0, 1), { mock: false, concurrency: 9 }), /concurrency/);
    for (const s of lb.seen) { assert.equal(s.headers["x-middleware-record"], "metadata"); assert.equal(s.body.model, "claude-sonnet-5-5"); assert.ok(!("temperature" in s.body)); assert.equal(s.body.system, prompt.SYSTEM_PROMPT); }
    // the CLI end to end, 2 questions, written to a temp dir (never concept/exam)
    const out = [], io = { out: s => out.push(s), err: () => {}, outDir: tmp };
    delete process.env.MUBIT_MOCK;
    const n0 = lb.seen.length;
    assert.equal(await R.main(["--column", "base", "--model", "claude-opus-5-5", "--n", "2", "--workers", "0"], io), 0);
    assert.deepEqual(fs.readdirSync(tmp), ["results-base-claude-opus-5-5.json"]);
    const res = JSON.parse(fs.readFileSync(path.join(tmp, "results-base-claude-opus-5-5.json"), "utf8"));
    assert.equal(lb.seen.length - n0, 2);
    assert.equal(res.label, "base-claude-opus-5-5"); assert.equal(res.n, 2);
    assert.equal(res.meta.model, "claude-opus-5-5"); assert.equal(res.meta.trained, false); assert.equal(res.meta.mock, false);
    assert.equal(res.meta.concurrency, 8); assert.equal(res.meta.temperature, null); assert.equal(res.meta.temperature_sent, false);
    assert.equal(res.meta.max_tokens, prompt.MAX_TOKENS); assert.equal(res.meta.prompt_version, prompt.DESIGNER_PROMPT_VERSION);
    for (const r of res.rows) { assert.equal(r.model, "claude-opus-5-5"); assert.equal(r.served_by, "provider"); assert.equal(r.input_tokens, 400); assert.equal(r.output_tokens, 40); assert.equal(typeof r.latency_ms, "number"); assert.equal(r.stop_reason, "end_turn"); }
    assert.equal(res.calls.answered, 2); assert.equal(res.calls.errors, 0); assert.equal(res.calls.output_tokens_mean, 40);
    assert.deepEqual(res.calls.models_returned, { "claude-opus-5-5": 2 });
    assert.match(out.join(""), /calls answered 2\/2, median latency \d+\.\d\d s, mean output tokens 40/);
    assert.doesNotMatch(out.join(""), /%/);
    // a failed call is recorded as a failed call (here: a model that rejects temperature, sent one by a hand-made task)
    const bad = await R.baseAnswers(doc.questions.slice(0, 1), { mock: false, task: Object.assign({}, R.modelTask("claude-opus-5-5"), { TEMPERATURE: 0 }) });
    assert.equal(bad.answers[0].error_status, 400); assert.match(bad.answers[0].error_message, /temperature/); assert.equal(bad.answers[0].text, "");
    assert.equal(R.callStats([{ error: "invalid_request_error" }, { latency_ms: 1000, output_tokens: 10 }, { latency_ms: 3000, output_tokens: 30 }]).latency_ms_median, 2000);
  } finally { lb.srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---- the panel, on a tiny stand-in DOM (exam-panel.js only needs createElement / append / attributes / text here)
function fakeDom() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.className = ""; this._text = null; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text != null ? this._text : this.children.map(c => (typeof c === "string" ? c : c.textContent)).join(""); }
    setAttribute(k, v) { this.attrs[k] = v; } addEventListener() {}
    append(...k) { for (const c of k) this.children.push(c); }
    replaceChildren(...k) { this._text = null; this.children = k; }
    get nodeType() { return 1; }
  }
  return { Node, document: { readyState: "loading", addEventListener() {}, createElement: t => new Node(t), querySelector: () => null, body: { classList: { toggle() {} } } } };
}
function cellsOf(node, tag, out) { out = out || []; if (node && typeof node === "object") { if (node.tag === tag) out.push(node); for (const c of node.children) cellsOf(c, tag, out); } return out; }
function loadPanel() {
  const { document } = fakeDom();
  const window = {};
  const ctx = { window, document, location: { search: "", href: "http://x/concept/lab/" }, URLSearchParams, URL, history: { replaceState() {} }, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "concept/lab/exam-panel.js"), "utf8"), ctx);
  return window.EI.examPanel.models;
}
function rowsFixture(spec) {
  // spec: [direct kept, legal, gain, engine kept, latency, out tokens, error]
  return spec.map((s, i) => Object.assign({ id: "q" + String(i + 1).padStart(2, "0"), phase: "early", parsed: !s[6], legal: s[1], direct: { kept: s[0], gain_s: s[0] ? s[2] : 0 }, engine: { kept: s[3], gain_s: s[3] ? 0.05 : 0 } },
    s[6] ? { error: s[6] } : { latency_ms: s[4], output_tokens: s[5], input_tokens: 500, model: "m", served_by: "provider", stop_reason: "end_turn" }));
}
function resultsDoc(column, model, rows, extra) {
  for (const r of rows) if (r.model) r.model = model;   // the model as returned
  return { v: 1, kind: "purple-designer-exam-results", column, label: column, questions_sha256: "abc", questions_variant: "plain", n: rows.length, meta: Object.assign(column === "none" ? {} : { mock: false, trained: false, model, max_tokens: 250 }, extra || {}), rows };
}

test("Exam view: model comparison renders n/N from the files as they are, 'not run yet' without a file, mock files ignored", async () => {
  const M = loadPanel();
  const files = {
    "models.json": JSON.parse(fs.readFileSync(path.join(ROOT, "concept/exam/models.json"), "utf8")),
    // Haiku: only the earlier run (results-base.json)
    "results-base.json": resultsDoc("base", "claude-haiku-4-5", rowsFixture([[true, true, 0.1, true, 1000, 60], [false, false, 0, true, 3000, 80], [false, true, 0, false, 2000, 70], [true, true, 0.3, true, 4000, 90]]), { temperature: 0 }),
    // Sonnet: a comparison run with one failed call
    "results-base-claude-sonnet-5-5.json": resultsDoc("base", "claude-sonnet-5-5", rowsFixture([[true, true, 0.2, true, 2000, 100], [true, true, 0.2, true, 4000, 120], [false, false, 0, true, 6000, 140], [false, false, 0, false, 0, 0, "invalid_request_error"]]), { temperature: null, concurrency: 8 }),
    // Opus: a MOCK run only -> must not count
    "results-base-claude-opus-5-5.json": resultsDoc("base", "claude-opus-5-5", rowsFixture([[true, true, 9, true, 1, 1], [true, true, 9, true, 1, 1], [true, true, 9, true, 1, 1], [true, true, 9, true, 1, 1]]), { mock: true }),
    "results-none.json": resultsDoc("none", null, rowsFixture([[false, true, 0, true, null, null], [false, true, 0, true, null, null], [true, true, 0.01, true, null, null], [false, true, 0, false, null, null]])),
  };
  const getJ = async url => { const f = url.replace(/^\.\.\/exam\//, ""); return f in files ? JSON.parse(JSON.stringify(files[f])) : null; };
  const data = await M.load("plain", getJ);
  assert.deepEqual(Array.from(data.cols, c => c.m.name), ["Haiku 4.5", "Sonnet 5.5", "Opus 5.5", "No AI"]);
  assert.equal(data.cols[0].file, "results-base.json"); assert.equal(data.cols[0].earlier, true);
  assert.equal(data.cols[2].doc, null, "a mock file never counts as the model's result"); assert.match(data.cols[2].why, /mock/);
  const node = M.build(data), text = node.textContent;
  const rows = cellsOf(node, "tr").slice(1).map(tr => cellsOf(tr, "td").map(td => td.textContent));
  assert.deepEqual(rows[0], ["2/4", "2/4", "not run yet", "1/4"], "kept as proposed");
  assert.deepEqual(rows[1], ["3/4", "2/4", "not run yet", "4/4"], "legal as proposed");
  assert.deepEqual(rows[2], ["0.1000", "0.1000", "not run yet", "0.0025"], "mean gain as proposed (s), over N");
  assert.deepEqual(rows[3], ["3/4", "3/4", "not run yet", "3/4"], "kept with engine");
  assert.deepEqual(rows[4], ["2.50", "4.00", "not run yet", "—"], "median latency (s), answered calls only");
  assert.deepEqual(rows[5], ["75", "120", "not run yet", "—"], "mean output tokens, answered calls only");
  assert.match(text, /Same 4 car situations, same prompt, same physics; only the model changes\./);
  assert.match(text, /Sonnet 5\.5 and Opus 5\.5 run at their default sampling: these models do not accept a temperature setting/);
  assert.match(text, /Sonnet 5\.5: results-base-claude-sonnet-5-5\.json · 4 calls, 8 in flight · temperature not sent \(default sampling\) · 1\/4 calls failed \(invalid_request_error\), graded as not kept\./);
  assert.match(text, /Haiku 4\.5: results-base\.json \(the earlier Haiku run, before the comparison\)/);
  assert.match(text, /Opus 5\.5: not run yet \(results-base-claude-opus-5-5\.json\); ignored results-base-claude-opus-5-5\.json: a mock run/);
  assert.doesNotMatch(text, /%|\bCFD\b|wind tunnel|validated/i);
  // a comparison file for Haiku replaces the earlier run; a column whose calls all failed says so instead of scoring 0
  files["results-base-claude-haiku-4-5.json"] = resultsDoc("base", "claude-haiku-4-5", rowsFixture([[true, true, 0.1, true, 500, 50], [true, true, 0.1, true, 700, 50], [true, true, 0.1, true, 900, 50], [false, true, 0, true, 1100, 50]]), { temperature: 0, concurrency: 8 });
  files["results-base-claude-opus-5-5.json"] = resultsDoc("base", "claude-opus-5-5", rowsFixture([[false, false, 0, false, 0, 0, "invalid_request_error"], [false, false, 0, false, 0, 0, "invalid_request_error"], [false, false, 0, false, 0, 0, "invalid_request_error"], [false, false, 0, false, 0, 0, "invalid_request_error"]]), { temperature: null, concurrency: 8 });
  const d2 = await M.load("plain", getJ), n2 = M.build(d2);
  assert.equal(d2.cols[0].file, "results-base-claude-haiku-4-5.json"); assert.ok(!d2.cols[0].earlier);
  const r2 = cellsOf(n2, "tr").slice(1).map(tr => cellsOf(tr, "td").map(td => td.textContent));
  assert.deepEqual(r2[0], ["3/4", "2/4", "calls failed", "1/4"]);
  assert.match(n2.textContent, /Opus 5\.5: .*4\/4 calls failed \(invalid_request_error ×4\)/);
  // the corrections question set reads only the -corrections files
  const d3 = await M.load("corrections", getJ);
  assert.ok(d3.cols.every(c => c.doc === null), "no -corrections fixtures here: every column is 'not run yet'");
  assert.ok(cellsOf(M.build(d3), "td").every(td => td.textContent === "not run yet"));
});

test("Exam view: the committed results files load as real columns (live, untrained, the right model)", async () => {
  const M = loadPanel();
  const dir = path.join(ROOT, "concept/exam");
  const getJ = async url => { const f = path.join(dir, url.replace(/^\.\.\/exam\//, "")); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };
  for (const v of ["plain", "corrections"]) {
    const d = await M.load(v, getJ);
    for (const c of d.cols) if (c.doc && c.kind === "model") { assert.equal(c.doc.meta.model, c.m.id); assert.equal(c.doc.meta.mock, false); assert.equal(c.doc.meta.trained, false); assert.equal(c.st.N, 30); }
    const haiku = d.cols[0]; assert.ok(haiku.doc, v + ": Haiku has a committed run"); assert.equal(d.cols[3].st.N, 30, v + ": No AI");
    assert.doesNotMatch(M.build(d).textContent, /%/);
  }
});
