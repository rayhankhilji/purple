// PURPLE CONCEPT DESIGNER - the LLM designer (a separate, DRAFT Mubit task) with a mock LLM only: prompt, scenario size, output
// schema, loop guards, determinism, CLI. No network: the injected llm() is a function in this file or concept/designer/cli.js mockLlm.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const prompt = require("../concept/designer/prompt.js"), S = require("../concept/designer/scenario.js"), schema = require("../concept/designer/schema.js");
const designer = require("../concept/designer/proposer.js"), cli = require("../concept/designer/cli.js");
const design = require("../concept/design.js"), parts = require("../concept/parts.js"), regs = require("../concept/regs.js"), optimize = require("../concept/optimize.js"), bench = require("../concept/bench.js");
const labPrompt = require("../lab/prompt.js");

const answer = (changes, extra) => JSON.stringify(Object.assign({ changes, hypothesis: "test move", expected: { lap_delta_s: -1, sector: 2 } }, extra || {}));
const fenced = s => "```json\n" + s + "\n```";
// replay a lineage: rebuild every measured candidate design from its parent and check none repeats a tested design
function replayDesigns(lineage) {
  let parent = design.baseline(); const seen = [designer.canon(parent)];
  for (const r of lineage) {
    const cand = design.applyChanges(parent, r.changes.map(c => ({ part: c.part, param: c.param, to: c.to }))).design;
    seen.push(designer.canon(cand));
    if (r.kept) parent = cand;
  }
  return seen;
}

// ---------------------------------------------------------------- prompt
test("designer prompt: DRAFT 0-draft, ≤ 1,000 chars, goal + schema + the simulator decides, no tools, separate from the research task", () => {
  assert.equal(prompt.DRAFT, true); assert.equal(prompt.DESIGNER_PROMPT_VERSION, "0-draft");
  assert.ok(prompt.SYSTEM_PROMPT.length <= 1000, "prompt is " + prompt.SYSTEM_PROMPT.length + " chars");
  assert.match(prompt.SYSTEM_PROMPT, /Silverstone pole/); assert.match(prompt.SYSTEM_PROMPT, /legal/);
  assert.match(prompt.SYSTEM_PROMPT, /simulator measures it and keeps it only if/); assert.match(prompt.SYSTEM_PROMPT, /you do not decide/);
  assert.match(prompt.SYSTEM_PROMPT, /changes .*hypothesis .*expected/); assert.match(prompt.SYSTEM_PROMPT, /No prose outside the JSON/);
  assert.doesNotMatch(prompt.SYSTEM_PROMPT, /\btool/i);
  assert.notEqual(prompt.SYSTEM_PROMPT, labPrompt.SYSTEM_PROMPT); assert.notEqual(prompt.TASK_NAME_HINT, labPrompt.TASK_NAME_HINT);
  assert.equal(prompt.MODEL, "claude-haiku-4-5"); assert.ok(prompt.MAX_TOKENS <= 250); assert.equal(prompt.TEMPERATURE, 0);
  assert.match(prompt.taskKeySha256(), /^[0-9a-f]{64}$/); assert.equal(prompt.taskKeySha256(), prompt.taskKeySha256());
  assert.match(prompt.fileSha256(), /^[0-9a-f]{64}$/);
  // the browser registry: the designer prompt never takes the research agent's slot
  assert.equal(globalThis.EI.concept.designerPrompt, prompt); assert.notEqual(globalThis.EI.prompt, prompt);
});
test("G-MUBIT-06: the designer never calls a provider itself (no gateway URL, no SDK, no server/mubit.js import)", () => {
  const dir = path.join(ROOT, "concept", "designer");
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /api\.mubit\.ai|api\.anthropic\.com|@anthropic-ai\/sdk|require\([^)]*server\/mubit/, f);
  }
});

// ---------------------------------------------------------------- scenario
test("scenario: baseline scenario carries the current car, gap to pole and near-limit parameters; ≤ 350 tokens", () => {
  const d = design.baseline(), r = bench.bench(d, { circuit: "silverstone", sim: "v0" });   // v0: the baseline sits on the real pole
  const f = S.fit({ design: d, summary: optimize.summary(r), history: [], refused: [] });
  assert.equal(f.dropped, 0); assert.ok(f.tokens <= 350, f.tokens + " tokens");
  const sc = JSON.parse(f.text);
  assert.equal(sc.best.lap_s, 88.111); assert.equal(sc.best.gap_s, 0);
  for (const s of parts.PARAMS) assert.equal(sc.best.params[s.part][s.param], d.params[s.part][s.param], s.part + "." + s.param);
  assert.ok(sc.near.length >= 1 && sc.near.length <= S.LIMITS.near);
  assert.match(sc.near[0], /^\S+ \S+ \((max|min) \S+ C\d/, "regulation limits come first: " + sc.near[0]);
  assert.ok(sc.near.includes("layout.wheelbase_mm 3400 (max 3400 C2.3.3)"));
});
test("scenario: tested rows map lineage (lap delta = -delta_score, kept, illegal articles), at most 3, refused at most 1", () => {
  const ch = [{ part: "rear_wing", param: "aoa_deg", from: 20, to: 22 }];
  const legal = { changes: ch, legal: true, delta_score: 0.0123, kept: true, candidates: [{}] };
  const illegal = { changes: [{ part: "front_wing", param: "span_mm", from: 1300, to: 1400 }], legal: false, delta_score: null, kept: false, candidates: [{ violations: ["REG-C-FW-SPAN"] }] };
  assert.deepEqual(S.testedRow(legal), { change: "rear_wing.aoa_deg 20->22", d_lap_s: -0.012, kept: true });
  assert.deepEqual(S.testedRow(illegal), { change: "front_wing.span_mm 1300->1400", d_lap_s: null, kept: false, illegal: ["C3.10.1(a)"] });
  const sc = S.build({ design: design.baseline(), summary: {}, history: [legal, legal, legal, illegal, legal], refused: [{ change: "a", why: "duplicate (already tested)" }, { change: "b", why: "illegal C2.3.1" }] });
  assert.equal(sc.tested.length, 3); assert.equal(sc.tested[1].change, "front_wing.span_mm 1300->1400");
  assert.deepEqual(sc.refused, [{ change: "b", why: "illegal C2.3.1" }]);
});
test("scenario: measured worst case (3 illegal 3-change rows with every article, 3-change refused, 9 near lines) fits ≤ 450 tokens (LIMITS.chars 1,800 since live run 2, LOOP.md)", () => {
  const d = design.baseline(); for (const s of parts.PARAMS) d.params[s.part][s.param] = s.max - s.step;   // everything past or near a limit
  d.params.ballast.x_frac = 0.37; d.params.floor.ride_height_mm = 24.5;
  const longest = parts.PARAMS.slice().sort((a, b) => (b.part + b.param).length - (a.part + a.param).length).slice(0, 3);
  const ch = longest.map(s => ({ part: s.part, param: s.param, from: s.max - s.step * 3.5, to: s.max - s.step * 1.5 }));
  const every = regs.RULES.filter(r => r.kind !== "info").map(r => r.id);
  const row = { changes: ch, legal: false, delta_score: null, kept: false, candidates: [{ violations: every }] };
  const o = { design: d, summary: { lap_s: 87.12345, gap_to_pole_s: -0.98765, mass_kg: 770.25, front_share: 0.44567 }, history: [row, row, row], refused: [{ change: S.describeChanges(ch), why: "illegal " + every.map(id => regs.BY_ID[id].article).join(" ") }] };
  const raw = S.fit(Object.assign({}, o, { limits: { chars: 1e9 } }));
  const f = S.fit(o);
  assert.ok(f.chars <= S.LIMITS.chars && f.tokens <= 450, "worst case " + f.tokens + " tokens (" + f.chars + " chars; untrimmed " + raw.tokens + ")");
  assert.equal(JSON.parse(f.text).tested.length >= 1, true, "the latest tested row survives");
  assert.equal(JSON.parse(f.text).refused.length, 1, "the refused entry survives");
  assert.ok(JSON.parse(raw.text).tested.every(t => t.illegal.length <= S.LIMITS.articles + 1), "articles capped");
  // an even more absurd input still fits (fit trims until it does)
  const absurd = S.fit(Object.assign({}, o, { history: Array(10).fill(row) }));
  assert.ok(absurd.tokens <= 450);
});

// ---------------------------------------------------------------- schema
test("schema accepts plain JSON and one ```json fence; clamps out-of-domain values with a flag; quantises; trims a long hypothesis", () => {
  const ok = schema.validate(answer([{ part: "floor", param: "ride_height_mm", to: 33 }]));
  assert.equal(ok.ok, true); assert.deepEqual(ok.value.changes, [{ part: "floor", param: "ride_height_mm", to: 33, clamped: false }]);
  assert.equal(schema.validate(fenced(answer([{ part: "floor", param: "ride_height_mm", to: 33 }]))).ok, true);
  assert.equal(schema.validate("```\n" + answer([{ part: "floor", param: "ride_height_mm", to: 33 }]) + "\n```").ok, true);
  const cl = schema.validate(answer([{ part: "rear_wing", param: "sm_delta_deg", to: 45 }, { part: "floor", param: "width_mm", to: 1103 }]));
  assert.equal(cl.ok, true); assert.deepEqual(cl.clamped, ["rear_wing.sm_delta_deg", "floor.width_mm"]);
  assert.equal(cl.value.changes[0].to, 30); assert.equal(cl.value.changes[1].to, 1200); assert.equal(cl.value.changes[0].clamped, true);
  const q = schema.validate(answer([{ part: "front_wing", param: "elements", to: 2.4 }, { part: "floor", param: "width_mm", to: 1534 }]));
  assert.equal(q.value.changes[0].to, 2); assert.equal(q.value.changes[1].to, 1530); assert.equal(q.clamped, undefined);
  const long = schema.validate(answer([{ part: "floor", param: "throat_mm", to: 90 }], { hypothesis: "x".repeat(300) }));
  assert.equal(long.ok, true); assert.equal(long.value.hypothesis.length, 160); assert.deepEqual(long.trimmed, ["hypothesis"]);
  const n = schema.validate(answer([{ part: "floor", param: "throat_mm", to: 90 }], { expected: { lap_delta_s: -0.04, sector: 3 } }));
  assert.equal(n.value.expected.lap_delta_s, -1); assert.deepEqual(n.normalised, ["expected.lap_delta_s"]);
});
test("schema rejects prose, broken JSON, unknown / duplicate params, 0 or 4 changes, bad values, extra keys (no model verdict)", () => {
  const good = [{ part: "floor", param: "throat_mm", to: 90 }];
  const cases = [
    ["Here you go: " + answer(good), "json"], [answer(good) + " Hope this helps!", "json"], [fenced(answer(good)) + "\nNote: fast.", "json"],
    [fenced(answer(good)) + "\n" + fenced(answer(good)), "json"], ['{"changes": [', "json"], ["[]", "json"], ["", "json"],
    [answer([{ part: "front_wing", param: "twist_deg", to: 3 }]), "changes[0]"], [answer([{ part: "floor", param: "throat_mm", to: 90 }, { part: "floor", param: "throat_mm", to: 95 }]), "changes[1]"],
    [answer([]), "changes"], [answer([good[0], { part: "floor", param: "width_mm", to: 1850 }, { part: "diffuser", param: "expansion_deg", to: 15 }, { part: "sidepods", param: "inlet_cm2", to: 600 }]), "changes"],
    [answer([{ part: "floor", param: "throat_mm", to: "90" }]), "changes[0].to"], [answer([{ part: "floor", param: "throat_mm", to: null }]), "changes[0].to"],
    [answer([{ part: "floor", param: "throat_mm" }]), "changes[0].to"], [answer([{ part: "floor", param: "throat_mm", to: 90, why: "x" }]), "changes[0].why"],
    [answer(good, { verdict: "keep" }), "verdict"], [answer(good, { kept: true }), "kept"],
    [JSON.stringify({ changes: good, expected: { lap_delta_s: -1, sector: 1 } }), "hypothesis"], [answer(good, { hypothesis: 5 }), "hypothesis"],
    [answer(good, { expected: { lap_delta_s: -1, sector: 4 } }), "expected.sector"], [answer(good, { expected: { lap_delta_s: "faster", sector: 1 } }), "expected.lap_delta_s"],
    [answer(good, { expected: { lap_delta_s: -1 } }), "expected.sector"], [answer(good, { expected: { lap_delta_s: -1, sector: 1, confidence: 0.9 } }), "expected.confidence"],
    [answer(good, { changes: { part: "floor", param: "throat_mm", to: 90 } }), "changes"],
  ];
  for (const [text, field] of cases) { const r = schema.validate(text); assert.equal(r.ok, false, "accepted: " + text.slice(0, 80)); assert.equal(r.field, field, text.slice(0, 80) + " -> " + r.error); }
});

// ---------------------------------------------------------------- proposer guards
test("guard: an LLM that repeats itself never gets a tested design re-measured (duplicate -> fallback); every row is annotated", async () => {
  const llm = async () => answer([{ part: "floor", param: "ride_height_mm", to: 34 }]);
  const res = await designer.runDesigner({ gens: 8, seed: 3, designer: { llm } });
  assert.equal(res.lineage[0].proposer, "llm"); assert.equal(res.lineage[0].designer.reason, null);
  for (const r of res.lineage.slice(1)) { assert.equal(r.proposer, "fallback"); assert.ok(["duplicate", "llm_paused"].includes(r.designer.reason), r.designer.reason); }
  const designs = replayDesigns(res.lineage); assert.equal(new Set(designs).size, designs.length, "a design was measured twice");
  assert.ok(res.designer.reasons.duplicate >= 3);
});
test("guard: garbage output pauses the LLM after 3 consecutive failures for 5 generations; the fallback keeps the loop going", async () => {
  let n = 0; const llm = async () => { n++; return "I think a lower car is faster."; };
  const res = await designer.runDesigner({ gens: 12, seed: 1, designer: { llm } });
  assert.equal(n, 6, "calls at gens 1-3 and 9-11 only"); assert.equal(res.calls.length, 6);
  assert.deepEqual(res.lineage.map(r => r.designer.reason), ["parse", "parse", "parse", "llm_paused", "llm_paused", "llm_paused", "llm_paused", "llm_paused", "parse", "parse", "parse", "llm_paused"]);
  assert.ok(res.lineage.every(r => r.proposer === "fallback" && r.n_measured === 1));
  assert.equal(res.lineage[2].designer.paused_llm_until_gen, 9);
});
test("guard: an illegal proposal is refused before the bench with its article and shown to the LLM next time; llm errors fall back", async () => {
  const seen = []; let i = 0;
  const llm = async (text) => { seen.push(JSON.parse(text)); i++; if (i === 1) return fenced(answer([{ part: "front_wing", param: "span_mm", to: 1400 }])); if (i === 2) throw new Error("socket hang up"); return answer([{ part: "floor", param: "throat_mm", to: 100 - i }]); };
  const res = await designer.runDesigner({ gens: 4, seed: 2, designer: { llm } });
  assert.equal(res.lineage[0].proposer, "fallback"); assert.equal(res.lineage[0].designer.reason, "illegal");
  assert.deepEqual(res.lineage[0].designer.refused, { gen: 1, change: "front_wing.span_mm 1300->1400", why: "illegal C3.10.1(a)" });
  assert.deepEqual(seen[1].refused, [{ change: "front_wing.span_mm 1300->1400", why: "illegal C3.10.1(a)" }]);
  assert.equal(res.lineage[1].designer.reason, "llm_error"); assert.match(res.lineage[1].designer.detail, /socket hang up/);
  assert.equal(res.lineage[2].proposer, "llm"); assert.equal(res.lineage[3].proposer, "llm");
  assert.ok(res.lineage.every(r => r.legal), "fallbacks pick legal untested designs");
});
test("guard: trained calls are refused while the prompt is DRAFT; a frozen prompt passes trained through; maxCalls caps the budget", async () => {
  const llm = async () => answer([{ part: "floor", param: "throat_mm", to: 95 }]);
  assert.throws(() => designer.llmProposer({ llm, trained: true }), /DRAFT/);
  assert.throws(() => designer.llmProposer({}), /llm/);
  const metas = [];
  const frozen = Object.assign({}, prompt, { DRAFT: false, DESIGNER_PROMPT_VERSION: "1" });
  const res = await designer.runDesigner({ gens: 5, seed: 1, designer: { llm: async (t, m) => { metas.push(m); return answer([{ part: "floor", param: "throat_mm", to: 99 - metas.length }]); }, trained: true, prompt: frozen, maxCalls: 3 } });
  assert.equal(metas.length, 3); assert.ok(metas.every(m => m.trained === true));
  assert.deepEqual(metas.map(m => m.sessionId), ["dsg-seed1-g1", "dsg-seed1-g2", "dsg-seed1-g3"], "one session id per decision");
  assert.deepEqual(res.lineage.map(r => r.designer.reason), [null, null, null, "llm_budget", "llm_budget"]);
  const dflt = await designer.runDesigner({ gens: 1, seed: 1, designer: { llm: async (t, m) => { assert.equal(m.trained, false); return answer([{ part: "floor", param: "throat_mm", to: 95 }]); } } });
  assert.equal(dflt.calls[0].trained, false);
});
test("the verdict is numeric only: kept === legal && score_after > score_before, whatever the LLM expected; clamped values are flagged", async () => {
  // a confident LLM that always predicts a gain, including for a move that loses time
  let i = 0; const llm = async () => { i++; return i === 1 ? answer([{ part: "rear_wing", param: "aoa_deg", to: 35 }], { expected: { lap_delta_s: -1, sector: 1 } }) : answer([{ part: "rear_wing", param: "sm_delta_deg", to: 99 }]); };
  const res = await designer.runDesigner({ gens: 2, seed: 1, designer: { llm } });
  for (const r of res.lineage) assert.equal(r.kept, r.legal && r.score_after > r.score_before + 1e-9);
  const r1 = res.lineage[0]; assert.equal(r1.proposer, "llm"); assert.equal(r1.kept, false); assert.ok(r1.delta_score < 0);
  assert.deepEqual(r1.designer.expected_hit, { sign: false, sector: r1.designer.measured.sector === 1 });
  const r2 = res.lineage[1]; assert.equal(r2.proposer, "llm"); assert.equal(r2.changes[0].to, 30); assert.equal(r2.changes[0].clamped, true); assert.deepEqual(r2.designer.clamped, ["rear_wing.sm_delta_deg"]);
});

// ---------------------------------------------------------------- mock loop, determinism, CLI
test("mock LLM loop: same seed -> identical lineage; the mock exercises parse, illegal and duplicate guards; scenarios stay ≤ 400 tokens", async () => {
  const run = seed => designer.runDesigner({ gens: 30, seed, designer: { llm: cli.mockLlm(seed), runId: "t" + seed } });
  const a = await run(1), b = await run(1), c = await run(2);
  assert.equal(JSON.stringify(a.lineage), JSON.stringify(b.lineage)); assert.equal(JSON.stringify(a.calls), JSON.stringify(b.calls));
  assert.notEqual(JSON.stringify(a.lineage), JSON.stringify(c.lineage));
  // a third run with a higher duplicate rate, so the duplicate guard is exercised whatever the seeded path of a / c is
  const dup = await designer.runDesigner({ gens: 30, seed: 3, designer: { llm: cli.mockLlm(3, { duplicate: 0.3 }), runId: "t3" } });
  const reasons = {}; for (const r of [a, c, dup]) for (const k of Object.keys(r.designer.reasons)) reasons[k] = 1;
  for (const k of ["parse", "illegal", "duplicate"]) assert.ok(reasons[k], "mock never triggered " + k);
  for (const r of [a, c]) {
    assert.ok(r.best_result.legal && r.best_result.score > r.baseline_result.score, "the loop improves on the baseline");
    assert.ok(r.calls.every(x => x.scenario_tokens <= 400 && x.trained === false));
    const designs = replayDesigns(r.lineage); assert.equal(new Set(designs).size, designs.length, "no tested design is measured twice");
    assert.ok(r.lineage.every(x => ["llm", "fallback"].includes(x.proposer)));
  }
});
test("CLI: --mock writes lineage, calls and best outside data/; refuses to run without --mock and refuses data/ and data-mock/", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "purple-designer-test-"));
  const r = spawnSync(process.execPath, [path.join(ROOT, "concept", "designer", "cli.js"), "--mock", "--gens", "6", "--seed", "1", "--out", out, "--quiet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /MOCK LLM \(no network\)/); assert.match(r.stdout, /0-draft \(DRAFT\)/);
  const rows = fs.readFileSync(path.join(out, "lineage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 6); assert.ok(rows.every(x => x.designer && ["llm", "fallback"].includes(x.proposer)));
  const calls = fs.readFileSync(path.join(out, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls.length >= 1 && calls.every(c => c.trained === false && /^dsg-mock-seed1-g\d+$/.test(c.session_id)));
  assert.ok(JSON.parse(fs.readFileSync(path.join(out, "best.json"), "utf8")).best_result.legal);
  const live = spawnSync(process.execPath, [path.join(ROOT, "concept", "designer", "cli.js"), "--gens", "1", "--out", out], { encoding: "utf8" });
  assert.equal(live.status, 1); assert.match(live.stderr, /only --mock/);
  const conceptCli = require("../concept/cli.js");
  assert.throws(() => conceptCli.assertSafeOut(path.join(ROOT, "data", "designer")), /refusing/);
  assert.throws(() => conceptCli.assertSafeOut(path.join(ROOT, "data-mock", "designer")), /refusing/);
});
test("designer code and docs never use the banned words (EVAL_GUARDRAILS G-HON-02)", () => {
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated", "aerodynamically" + " tested"].join("|"), "i");
  const dir = path.join(ROOT, "concept", "designer");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js")).map(f => path.join(dir, f)).concat([path.join(ROOT, "docs", "concept", "DESIGNER.md")]);
  for (const f of files) { assert.ok(fs.existsSync(f), f); const m = banned.exec(fs.readFileSync(f, "utf8")); assert.equal(m, null, path.relative(ROOT, f) + ": " + (m && m[0])); }
});
