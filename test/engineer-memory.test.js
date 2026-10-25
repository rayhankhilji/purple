// PURPLE SHARED MEMORY (concept/engineer/memory.js, concept/engineer/memory/{build.js, approved.json}): the index holds nothing from the
// designer exam (its source seeds 101-110 and its head cars are dropped, on the committed file and on a fixture build); retrieval is
// deterministic, size-bounded, facts only and leaves out changes already tried in the run; memory OFF (the default) leaves every
// scenario byte for byte as recorded, ON appends only the "precedents" block; the exam's memory questions are the corrections
// questions plus the block (same states). No network: replayed and mock answers only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = path.join(__dirname, "..");
const memory = require("../concept/engineer/memory.js"), build = require("../concept/engineer/memory/build.js");
const escen = require("../concept/engineer/scenario.js"), design = require("../concept/design.js");
const B = require("../concept/benchmark/baselines.js"), S = require("../concept/benchmark/steered.js");
const Q = require("../concept/exam/questions.js"), run = require("../concept/exam/run.js"), cli = require("../concept/engineer/cli.js");

const INSTRUCT = /\b(should|must|try|avoid|please|propose|consider)\b/i;
const strip = t => { const o = JSON.parse(t); delete o.precedents; return JSON.stringify(o); };
const vec = p => memory.KEYS.map(k => { const [a, b] = k.split("."); return p[a][b]; });
const examFiles = [Q.FILE, Q.FILE_CORRECTIONS, Q.FILE_MEMORY].filter(f => fs.existsSync(f));

test("the committed index holds nothing from the exam: no seed 101-110, no exam head car; ≤ a few MB; deduped", () => {
  const doc = JSON.parse(fs.readFileSync(memory.FILE, "utf8"));
  assert.equal(doc.kind, "purple-memory-approved");
  assert.ok(fs.statSync(memory.FILE).size < 4e6, "approved.json ≤ 4 MB");
  assert.equal(doc.seeds.length, doc.entries.length);
  for (const s of Q.SEEDS) assert.ok(!doc.seeds.includes(s), "seed " + s + " is held out");
  assert.deepEqual(doc.held_out.exam_seeds, Q.SEEDS);
  const cars = new Set(doc.cars.map(c => JSON.stringify(c)));
  assert.equal(cars.size, doc.cars.length, "head cars are distinct");
  for (const f of examFiles) for (const q of JSON.parse(fs.readFileSync(f, "utf8")).questions) assert.ok(!cars.has(JSON.stringify(vec(q.head.params))), q.id + "'s head car is not in the index");
  const keys = new Set(doc.entries.map(e => e[0] + "|" + JSON.stringify(e[1])));
  assert.equal(keys.size, doc.entries.length, "one entry per (head car, change)");
  for (const e of doc.entries) assert.ok(e[2] < 0 && e[3] >= 1, "approved = faster as proposed");
});

test("build: drops the held-out seeds and exam head cars (fixture), deterministic", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purple-mem-"));
  const good = path.join(dir, "good"), runs = path.join(dir, "runs");
  const base = design.baseline({ team: "redbull" }).params;
  const examCar = JSON.parse(fs.readFileSync(Q.FILE, "utf8")).questions[0].head.params;
  const other = JSON.parse(JSON.stringify(base)); other.floor.width_mm = 1440;
  const mk = (seed, decs) => {
    const d = path.join(runs, "h", "run-seed" + seed); fs.mkdirSync(d, { recursive: true });
    const ev = [], rows = [];
    for (const [k, head] of decs) {
      ev.push({ type: "request", decision: k, scenario: { best: { params: head } } });
      ev.push({ type: "proposal", decision: k, changes: [{ part: "rear_wing", param: "aoa_deg", from: head.rear_wing.aoa_deg, to: head.rear_wing.aoa_deg - 1 }] });
      rows.push({ decision: k, by: "mubit", as_proposed: { legal: true, d_lap_s: -0.01 } });
    }
    fs.writeFileSync(path.join(d, "events.jsonl"), ev.map(x => JSON.stringify(x)).join("\n") + "\n");
    fs.writeFileSync(path.join(d, "decisions.jsonl"), rows.map(x => JSON.stringify(x)).join("\n") + "\n");
  };
  mk(101, [[2, base]]); mk(999, [[2, base], [3, examCar], [4, other], [5, base]]);
  fs.mkdirSync(path.join(good, "g"), { recursive: true });
  fs.writeFileSync(path.join(good, "g", "good.jsonl"), [[101, 2], [999, 2], [999, 3], [999, 4], [999, 5]].map(([seed, decision]) => JSON.stringify({ seed, decision, d_lap_s: -0.01 })).join("\n") + "\n");
  const o = { runs, goodDir: good, sources: [{ name: "g", runs: "h", task: "v1" }] };
  const a = build.build(o), b = build.build(o);
  assert.equal(build.serialize(a), build.serialize(b), "deterministic");
  const st = a.sources[0];
  assert.equal(st.held_out_seed, 1); assert.equal(st.held_out_car, 1); assert.equal(st.joined, 3);
  assert.equal(a.entries.length, 2, "base car + other car; the repeat on the base car is deduped");
  assert.deepEqual(a.seeds, [999, 999]);
  assert.equal(a.entries[0][3], 2, "n = 2 approvals of the same change on the same car");
  assert.ok(!a.cars.some(c => JSON.stringify(c) === JSON.stringify(vec(examCar))));
});

test("retrieval: deterministic, ≤ k lines, ≤ the char bound, facts only, legal on the car, skips changes already tried", () => {
  const head = design.baseline({ team: "redbull" });
  const r1 = memory.retrieve({ head, decisions: [] }), r2 = memory.retrieve({ head, decisions: [] });
  assert.deepEqual(r1, r2);
  assert.ok(r1.lines.length >= 1 && r1.lines.length <= memory.DEFAULTS.k);
  assert.ok(r1.chars <= memory.DEFAULTS.chars, r1.chars + " chars");
  for (const l of r1.lines) { assert.ok(!INSTRUCT.test(l), "facts only: " + l); assert.match(l, /^similar car \(distance [0-9.]+(, \d+ cars)?\): .+ legal, -[0-9.]+ s$/); }
  const engine = require("../concept/engineer/engine.js");
  for (const p of r1.picked) {
    for (const c of p.changes) assert.equal(c.from, head.params[c.part][c.param], "the change starts from this car's value");
    assert.equal(engine.violations(design.applyChanges(head, p.changes).design).length, 0, "legal on this car");
  }
  const top = r1.picked[0];
  const r3 = memory.retrieve({ head, decisions: [{ proposal: top.changes }] });
  assert.ok(!r3.picked.some(p => JSON.stringify(p.changes) === JSON.stringify(top.changes)), "a change already proposed in the run is left out");
  const big = memory.retrieve({ head, decisions: [], k: 40 }); assert.ok(big.chars <= 1200, "k 40 still ≤ 1,200 chars (" + big.chars + ")");
  const small = memory.retrieve({ head, decisions: [], chars: 200 }); assert.ok(small.chars <= 200 && small.lines.length >= 1);
  const ans = JSON.parse(memory.topAnswer({ head, decisions: [] }));
  assert.deepEqual(ans.changes, top.changes.map(c => ({ part: c.part, param: c.param, to: c.to })));
});

test("memory off (default) = the recorded scenarios byte for byte; on appends only the precedents block", async () => {
  const rec = S.loadRecorded(12), sent = S.loadRequests(12), N = 3;
  const go = memoryOn => B.runEngine({ seed: 12, budget: null, workers: 2, llm: B.replayLlm(rec.proposals), maxDecisions: N, mock: true, segments: true, corrections: false, memory: memoryOn });
  const off = await go(undefined), on = await go(true);
  for (let i = 0; i < N; i++) {
    const a = off.result.decisions[i], b = on.result.decisions[i];
    assert.equal(a.scenario, sent.get(a.decision), "memory off = the text the live run sent");
    assert.deepEqual(Object.keys(JSON.parse(b.scenario)), ["best", "tree", "tested", "near", "precedents"]);
    assert.equal(strip(b.scenario), a.scenario, "on = off + the block");
    assert.ok(b.scenario_chars - a.scenario_chars <= 1200 + 20);
    assert.equal(a.result.lap_s, b.result.lap_s, "same physics");
  }
  // scenario.fit directly: no memory key and memory null are identical
  const head = design.baseline({ team: "redbull" }), { Tree } = require("../concept/engineer/tree.js");
  const tree = new Tree({ patience: 3 }); tree.root({ params: head.params, team: head.team, legal: true, lap_s: 88.745, sectors_s: [1, 1, 1] });
  const o = { head, headSummary: { lap_s: 88.745, gap_to_pole_s: 0.634, mass_kg: 770, front_share: 0.45 }, tree, decisions: [] };
  assert.equal(escen.fit(o).text, escen.fit(Object.assign({}, o, { memory: null })).text);
  const withMem = escen.fit(Object.assign({}, o, { memory: { decisions: [] } }));
  assert.equal(strip(withMem.text), escen.fit(o).text);
});

test("exam memory questions: the corrections questions plus the block, same states, picks behind the lines", () => {
  const mem = Q.load(Q.FILE_MEMORY), cor = Q.load(Q.FILE_CORRECTIONS);
  assert.equal(mem.variant, "memory");
  assert.equal(mem.questions.length, cor.questions.length);
  for (const [i, q] of mem.questions.entries()) {
    const c = cor.questions[i];
    assert.equal(q.id, c.id);
    assert.equal(Q.withoutPrecedents(q.text), c.text, q.id + ": text minus the block = questions-corrections.json");
    assert.deepEqual(q.head, c.head);
    const sc = JSON.parse(q.text);
    assert.ok(Array.isArray(sc.precedents) && sc.precedents.length === q.precedents.length && sc.precedents.length <= 6);
    assert.ok(JSON.stringify(sc.precedents).length <= 1200);
    for (const l of sc.precedents) assert.ok(!INSTRUCT.test(l));
    if (q.precedents.length) for (const ch of q.precedents[0].changes) assert.ok(sc.precedents[0].includes(ch.part + "." + ch.param), "the first pick is the first line");
    const m = run.memoryProposal(q);
    if (q.precedents.length) assert.deepEqual(JSON.parse(m.text).changes, q.precedents[0].changes.map(c => ({ part: c.part, param: c.param, to: c.to })));
  }
});

test("CLIs: --memory on|off on the engine CLI (default off); exam --memory and --column memory", () => {
  const base = ["--mock", "scripted", "--seed", "3", "--out", "/tmp/x"];
  assert.equal(cli.parseArgs(base).memory, false);
  assert.equal(cli.parseArgs(base.concat(["--memory", "on"])).memory, true);
  assert.throws(() => cli.parseArgs(base.concat(["--memory", "yes"])), /--memory on\|off/);
  assert.equal(run.parseArgs(["--column", "base", "--memory"]).memory, true);
  assert.equal(run.parseArgs(["--column", "memory"]).memory, true);
  assert.throws(() => run.parseArgs(["--column", "base", "--memory", "--questions", "x.json"]), /--memory means/);
});
