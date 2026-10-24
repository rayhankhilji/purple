// PURPLE PHYSICS CORRECTIONS (docs/concept/TESTS_TO_POLE.md §8): the engine's scenario with corrections OFF is byte for byte what the
// recorded live runs sent; with them ON only a "corrections" block is appended (the four blocks before it unchanged, the physics
// unchanged); the block is deterministic, size-bounded and reports facts only; the fixation stand-in reads only the scenario; the
// engine CLI refuses trained calls without the typed confirmation; the exam's corrections questions are the same car states.
// No network: mock and replayed answers only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = path.join(__dirname, "..");
const engine = require("../concept/engineer/engine.js"), escen = require("../concept/engineer/scenario.js"), dscen = require("../concept/designer/scenario.js");
const loop = require("../concept/designer/loop.js"), design = require("../concept/design.js"), parts = require("../concept/parts.js");
const B = require("../concept/benchmark/baselines.js"), S = require("../concept/benchmark/steered.js"), F = require("../concept/benchmark/fixation.js");
const report = require("../concept/benchmark/report.js"), cli = require("../concept/engineer/cli.js"), Q = require("../concept/exam/questions.js");

const strip = t => { const o = JSON.parse(t); delete o.corrections; return JSON.stringify(o); };
const INSTRUCT = /\b(should|must|try|avoid|please|propose|consider)\b/i;
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-corr-"));

test("off reproduces the recorded live run's scenario text byte for byte; on appends only the block and changes no physics", async () => {
  const rec = S.loadRecorded(12), sent = S.loadRequests(12), N = 4;
  const run = on => B.runEngine({ seed: 12, budget: null, workers: 2, llm: B.replayLlm(rec.proposals), maxDecisions: N, mock: true, segments: true, corrections: on });
  const off = await run(false), on = await run(true);
  assert.equal(off.result.decisions.length, N);
  for (let i = 0; i < N; i++) {
    const a = off.result.decisions[i], b = on.result.decisions[i];
    assert.equal(a.scenario, sent.get(a.decision), "decision " + a.decision + ": corrections off = the text the live run sent");
    assert.deepEqual(Object.keys(JSON.parse(a.scenario)), ["best", "tree", "tested", "near"]);
    assert.deepEqual(Object.keys(JSON.parse(b.scenario)), ["best", "tree", "tested", "near", "corrections"]);
    assert.equal(strip(b.scenario), a.scenario, "on = off + the block");
    assert.ok(b.scenario_chars - a.scenario_chars <= escen.CORRECTIONS.chars + 16, "added " + (b.scenario_chars - a.scenario_chars) + " chars");
    assert.doesNotMatch(JSON.stringify(JSON.parse(b.scenario).corrections), INSTRUCT);
  }
  assert.deepEqual(on.points, off.points, "the physics is unchanged");
  assert.deepEqual(off.points.map(p => [p.laps, p.best_s]), rec.points.slice(0, N + 1).map(p => [p.laps, p.best_s]));
  // the block of decision 4 reports decisions 1-3 run-wide
  assert.equal(JSON.parse(on.result.decisions[3].scenario).corrections.decisions, 3);
});

function syntheticDecisions(n) {
  const P = parts.PARAMS, out = [];
  for (let k = 1; k <= n; k++) {
    const prop = [0, 1, 2].map(j => { const s = P[(k * 3 + j * 7) % P.length]; return { part: s.part, param: s.param, from: s.min, to: s.max }; })
      .filter((c, i, a) => a.findIndex(x => x.part === c.part && x.param === c.param) === i);
    const illegal = k % 2 === 0, kept = k % 4 === 1;
    out.push({ decision: k, branch: 1 + (k % 5), proposal: prop, as_proposed: illegal ? { legal: false, articles: ["C3.10.10(s)(i)", "PKG-COOLING", "C3.5.1(a)"] } : { legal: true, d_lap_s: 0.01 },
      illegal_params: illegal ? [{ key: prop[0].part + "." + prop[0].param, articles: ["C3.10.10(s)(i)", "PKG-COOLING"] }] : undefined,
      kept, best_changes: kept ? prop : [], d_head_s: kept ? -0.001 * k : 0.002, by: "mubit" });
  }
  return out;
}

test("corrections block: deterministic, ≤ its limit in the worst case, every part accounted for, facts only", () => {
  const head = design.baseline({ team: "redbull" });
  for (const n of [0, 1, 7, 60, 400]) {
    const decs = syntheticDecisions(n);
    const a = escen.fitCorrections(escen.corrections({ decisions: decs, head }), null, []), b = escen.fitCorrections(escen.corrections({ decisions: decs, head }), null, []);
    assert.equal(JSON.stringify(a.block), JSON.stringify(b.block), "deterministic");
    assert.ok(a.chars <= escen.CORRECTIONS.chars, n + " decisions: " + a.chars + " chars");
    const c = a.block, allParts = Array.from(new Set(parts.PARAMS.map(s => s.part)));
    assert.equal(c.decisions, n);
    if (Object.keys(c.tried_by_part).length + c.never_tried.length === allParts.length) assert.deepEqual(Object.keys(c.tried_by_part).concat(c.never_tried).sort(), allParts.slice().sort());
    assert.ok(c.rejected_repeatedly.length <= escen.CORRECTIONS.rejected && c.illegal_as_proposed.length <= escen.CORRECTIONS.illegal);
    assert.doesNotMatch(JSON.stringify(c), INSTRUCT);
    assert.equal(c._legal_order, undefined, "internal keys are not serialised");
  }
  // counts: a parameter named 5 times and never in a kept car is "rejected repeatedly"; the illegal line carries the legal range
  const decs = [1, 2, 3, 4, 5].map(k => ({ decision: k, proposal: [{ part: "sidepods", param: "inlet_cm2", from: 650, to: 640 }], as_proposed: { legal: false, articles: ["PKG-COOLING"] }, illegal_params: [{ key: "sidepods.inlet_cm2", articles: ["PKG-COOLING"] }], kept: k === 3, best_changes: k === 3 ? [{ part: "rear_wing", param: "aoa_deg", from: 20, to: 19.5 }] : [], d_head_s: k === 3 ? -0.004 : 0.001 }));
  const c = escen.corrections({ decisions: decs, head });
  assert.deepEqual(c.tried_by_part, { sidepods: [5, 0, null, 5] }, "the kept car did not change the sidepods");
  assert.equal(c.never_tried.includes("rear_wing"), true);
  assert.equal(c.rejected_repeatedly[0], "sidepods.inlet_cm2 5 tried, 0 kept, last 5 not kept");
  assert.match(c.illegal_as_proposed[0], /^#5 sidepods\.inlet_cm2 650->640 PKG-COOLING \(x5\); legal \d+-\d+ step 10$/);
  assert.match(c.legal_range.sidepods.inlet_cm2, /^\d+-\d+$/);
});

test("culprits: the proposed parameter that is illegal on its own is named (the rest held)", () => {
  const head = design.baseline({ team: "redbull" });
  const ch = [{ part: "rear_wing", param: "aoa_deg", to: head.params.rear_wing.aoa_deg + 1 }, { part: "front_wing", param: "span_mm", to: 1400 }];
  const cul = escen.culprits(ch, c => design.applyChanges(head, [c]).design, engine.violations, vs => vs.map(v => v.id), ["X"]);
  assert.deepEqual(cul.map(c => c.key), ["front_wing.span_mm"]);
  const none = escen.culprits(ch.slice(0, 1), c => design.applyChanges(head, [c]).design, engine.violations, vs => vs.map(v => v.id), ["X"]);
  assert.deepEqual(none, [{ key: "rear_wing.aoa_deg", articles: ["X"] }], "nothing illegal alone: the combination");
});

test("engine: corrections on vs off with a mock that ignores the block: same decisions and physics; the block grows with the run", async () => {
  const run = on => engine.runEngineer({ llm: loop.mockCaller(5), mock: true, seed: 5, maxDecisions: 5, maxCalls: 5, variants: 300, confirm: 6, explore: 1, workers: 0, segments: false, corrections: on });
  const off = await run(false), on = await run(true);
  assert.equal(on.peak.lap_s, off.peak.lap_s);
  for (let i = 0; i < 5; i++) {
    const a = off.decisions[i], b = on.decisions[i];
    assert.equal(strip(b.scenario), a.scenario); assert.equal(a.proposal_change, b.proposal_change); assert.equal(a.physics_laps, b.physics_laps);
    assert.equal(JSON.parse(b.scenario).corrections.decisions, i);
    if (b.as_proposed.legal === false) assert.ok(Array.isArray(b.illegal_params) && b.illegal_params.length); else assert.equal(b.illegal_params, undefined);
    assert.equal(a.illegal_params, undefined, "off: no new field in the decision row");
  }
  assert.equal(engine.DEFAULTS.corrections, true, "on by default for new runs");
});

test("fixation stand-in: fixates without the block; with it, a rejected favourite gives way to a never-tried part inside its legal range", async () => {
  const head = design.baseline({ team: "redbull" });
  const base = JSON.parse(escen.fit({ head, headSummary: { lap_s: 88.745, gap_to_pole_s: 0.634, mass_kg: 770, front_share: 0.45 }, tree: (() => { const { Tree } = require("../concept/engineer/tree.js"); const t = new Tree(); t.root({ lap_s: 88.745, legal: true, params: head.params }); return t; })(), decisions: [] }).text);
  const plain = F.fixationLlm(1), named = new Map();
  for (let i = 0; i < 40; i++) for (const c of JSON.parse((await plain(JSON.stringify(base), { gen: i })).text).changes) named.set(c.part + "." + c.param, (named.get(c.part + "." + c.param) || 0) + 1);
  assert.ok(named.get(F.FIX) >= 25, "without corrections it names " + F.FIX + " most of the time");
  const decs = Array.from({ length: 6 }, (_, k) => ({ decision: k + 1, proposal: [{ part: "rear_wing", param: "aoa_deg", from: 20, to: 20.5 }], as_proposed: { legal: true, d_lap_s: 0.01 }, kept: false, best_changes: [] }));
  const withC = Object.assign({}, base, { corrections: escen.fitCorrections(escen.corrections({ decisions: decs, head }), null, base.near).block });
  assert.match(withC.corrections.rejected_repeatedly[0], /^rear_wing\.aoa_deg 6 tried, 0 kept/);
  const fx = F.fixationLlm(1), schema = require("../concept/designer/schema.js");
  let explored = 0;
  for (let i = 0; i < 40; i++) {
    const v = schema.validate((await fx(JSON.stringify(withC), { gen: i })).text); assert.ok(v.ok, v.error);
    assert.ok(!v.value.changes.some(c => c.part === "rear_wing" && c.param === "aoa_deg"), "the rejected favourite is dropped");
    if (v.value.changes.some(c => withC.corrections.never_tried.includes(c.part))) explored++;
    const inlet = v.value.changes.find(c => c.part === "sidepods" && c.param === "inlet_cm2");
    if (inlet) assert.ok(inlet.to >= +withC.corrections.legal_range.sidepods.inlet_cm2.split("-")[0], "never below the legal range");
  }
  assert.ok(explored >= 25, "explored never-tried parts " + explored + "/40");
});

test("engine CLI: trained needs --live and the typed text; a mock run writes the run folder and the curve; the report never writes a mock as Claude", async () => {
  assert.throws(() => cli.parseArgs(["--mock", "fixation", "--seed", "1", "--out", "x", "--confirm-trained", "TRAIN 150"]), /only applies to --live/);
  assert.throws(() => cli.parseArgs(["--live", "--seed", "1", "--out", "x", "--confirm-trained", "TRAIN 3"]), /TRAIN 150/);
  assert.equal(cli.parseArgs(["--live", "--seed", "1", "--out", "x", "--max-decisions", "3", "--confirm-trained", "TRAIN 3"]).trained, true);
  assert.throws(() => cli.parseArgs(["--mock", "fixation", "--seed", "1"]), /--out/);
  const out = tmp(), lines = [];
  await cli.main(["--mock", "fixation", "--seed", "11", "--budget", "30", "--workers", "0", "--out", out], { out: s => lines.push(s), err: () => {} });
  for (const f of ["run.json", "events.jsonl", "decisions.jsonl", "calls.jsonl", "tree.json", "state.json"]) assert.ok(fs.existsSync(path.join(out, "run-seed11", f)), f);
  const raw = JSON.parse(fs.readFileSync(path.join(out, "steered_corrections-seed11.json"), "utf8"));
  assert.equal(raw.llm, "mock"); assert.equal(raw.corrections, true); assert.ok(raw.points[raw.points.length - 1].laps >= 30);
  const calls = fs.readFileSync(path.join(out, "run-seed11", "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls.length >= 1 && calls.every(c => c.trained === false && c.mock === true));
  // the report: the mock file is printed as not written, the no-AI curves come from curves.json
  const prev = JSON.parse(fs.readFileSync(path.join(ROOT, "concept", "benchmark", "curves.json"), "utf8"));
  if (prev.corrections) {
    const o = report.buildCorrections(out, prev);
    assert.equal(o.seeds[11].curves.steered_corrections, undefined, "a mock run is never written as the steered column");
    assert.match(o.printed_only["steered_corrections-seed11"], /not a live run/);
    assert.doesNotMatch(JSON.stringify(o), /mock_fixation/);
  }
});

test("exam: questions-corrections.json holds the questions.json states with the block appended (text without it byte for byte)", () => {
  const plain = Q.load(), corr = Q.load(Q.FILE_CORRECTIONS);
  assert.equal(corr.variant, "corrections");
  assert.equal(corr.questions.length, plain.questions.length);
  for (let i = 0; i < plain.questions.length; i++) {
    const a = plain.questions[i], b = corr.questions[i];
    assert.equal(b.id, a.id); assert.deepEqual(b.source, a.source); assert.deepEqual(b.head, a.head); assert.equal(b.phase, a.phase);
    assert.equal(Q.withoutCorrections(b.text), a.text, a.id);
    assert.equal(b.base_text_sha256, a.text_sha256);
    const sc = JSON.parse(b.text);
    assert.deepEqual(Object.keys(sc), ["best", "tree", "tested", "near", "corrections"]);
    assert.equal(sc.corrections.decisions, a.source.decision - 1, a.id + ": the block covers the decisions before this one");
    assert.ok(b.chars - a.chars <= escen.CORRECTIONS.chars + 16, a.id + " +" + (b.chars - a.chars));
    assert.doesNotMatch(JSON.stringify(sc.corrections), INSTRUCT);
  }
});
