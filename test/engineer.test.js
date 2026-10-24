// PURPLE ENGINE v2 (docs/concept/ENGINE_V2.md): the design tree (peak, head, revert, fork), subspace expansion (dynamic parameter
// list, discrete enumeration), the surrogate screen (deterministic for any worker count), the engine with a mocked LLM (determinism,
// scenario size, interaction arithmetic, illegal proposals explored and credited, parse errors labelled "engine"), the API route
// (mock run, trained guards, never data/), and the replays of recorded live runs (real request ids only). No network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const { Tree } = require("../concept/engineer/tree.js");
const subspace = require("../concept/engineer/subspace.js"), { ScreenPool, screenChunk, merge } = require("../concept/engineer/screen.js");
const engine = require("../concept/engineer/engine.js"), escen = require("../concept/engineer/scenario.js"), replay = require("../concept/engineer/replay.js");
const parts = require("../concept/parts.js"), design = require("../concept/design.js"), regs = require("../concept/regs.js");
const loop = require("../concept/designer/loop.js"), dscen = require("../concept/designer/scenario.js");

const ROOT = path.join(__dirname, "..");
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-eng2-test-"));
const base = () => design.baseline({ team: "redbull" });
const answer = (changes, hyp) => JSON.stringify({ changes, hypothesis: hyp || "test", expected: { lap_delta_s: -1, sector: 2 } });

test("tree: kept moves head and peak; patience fails revert to the peak, then fork from the best other car; state is resumable", () => {
  const t = new Tree({ patience: 2 });
  t.root({ lap_s: 90, legal: true, params: {} });
  const add = (lap, dec) => t.add({ parent: t.head, decision: dec, kind: "result", legal: lap != null, lap_s: lap });
  let n = add(89.5, 1), o = t.decide(n, { decision: 1, parts: ["rear_wing"] });
  assert.equal(o.kept, true); assert.equal(o.new_peak, true); assert.equal(t.peak, n.id); assert.equal(t.head, n.id);
  // a fork-like situation: force the head off the peak by a kept-but-not-peak result is impossible from the peak, so fail twice from the peak
  n = add(89.7, 2); o = t.decide(n, { decision: 2, parts: ["floor"] }); assert.equal(o.kept, false); assert.equal(o.reverted, undefined);
  n = add(null, 3); o = t.decide(n, { decision: 3, parts: ["diffuser"] });
  assert.equal(o.reverted.kind, "fork", "head = peak -> fork from the best other car");
  assert.equal(t.head, "n2"); assert.equal(t.branch.id, 2);
  // on the fork: a kept result that does not beat the peak; then two fails -> revert to the peak
  n = add(89.6, 4); o = t.decide(n, { decision: 4, parts: ["sidepods"] }); assert.equal(o.kept, true); assert.equal(o.new_peak, false); assert.equal(t.peak, "n1");
  n = add(89.9, 5); t.decide(n, { decision: 5, parts: ["floor"] });
  n = add(89.95, 6); o = t.decide(n, { decision: 6, parts: ["floor"] });
  assert.equal(o.reverted.kind, "revert"); assert.equal(t.head, t.peak);
  const s = t.state();
  assert.equal(s.peak.node, "n1"); assert.equal(s.head.d_peak_s, 0); assert.equal(s.abandoned.length, 2); assert.match(s.last_move, /^revert to peak n1/);
  assert.deepEqual(s.abandoned[1].parts, "sidepods+floor");
  const back = Tree.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.deepEqual(back.state(), s);
});

test("subspace: proposed + coupled parameters from the live catalogue; discrete parameters enumerated and stratified; variant 0 = the proposal", () => {
  const h = base(), sub = subspace.expand(h, [{ part: "rear_wing", param: "aoa_deg", to: 22 }]);
  assert.equal(sub.proposed[0], "rear_wing.aoa_deg");
  assert.ok(sub.coupled.includes("diffuser.expansion_deg") && sub.coupled.includes("front_wing.aoa_deg") && sub.coupled.includes("rear_wing.span_mm"), sub.coupled.join(","));
  assert.ok(sub.dims <= subspace.MAX_DIMS);
  // every integer parameter of concept/parts.js with few levels is discrete (redesigns' concept families included, whatever exists)
  for (const c of subspace.catalogue()) if (c.int && c.levels <= subspace.MAX_LEVELS) assert.equal(c.discrete, true, c.key);
  assert.equal(parts.PARAMS.length, subspace.catalogue().length, "the catalogue is parts.PARAMS, read every time");
  const el = sub.axes.find(a => a.key === "rear_wing.elements"); assert.ok(el && el.discrete && el.values.length >= 2);
  assert.deepEqual(subspace.variant(sub, 7, 0), [{ part: "rear_wing", param: "aoa_deg", to: 22 }]);
  const seenEl = new Set(); for (let i = 1; i <= sub.combos; i++) { const ch = subspace.variant(sub, 7, i), c = ch.find(x => x.param === "elements" && x.part === "rear_wing"); seenEl.add(c ? c.to : h.params.rear_wing.elements); }
  assert.deepEqual(Array.from(seenEl).sort(), el.values.slice().sort(), "the first `combos` variants cover every discrete level");
  assert.deepEqual(subspace.variant(sub, 7, 123), subspace.variant(sub, 7, 123), "a pure function of (sub, seed, i)");
  for (let i = 1; i < 50; i++) for (const c of subspace.variant(sub, 7, i)) { const a = sub.axes.find(x => x.part === c.part && x.param === c.param); assert.ok(c.to >= a.lo - 1e-9 && c.to <= a.hi + 1e-9); }
});

test("screen: legality + surrogate on every variant, identical screened set and top-K for 0 and 2 worker threads", async () => {
  const h = base(), sub = subspace.expand(h, [{ part: "floor", param: "width_mm", to: 1500 }]);
  const p0 = new ScreenPool(0), p2 = new ScreenPool(2);
  try {
    const a = await p0.screen(h, sub, 11, 600, { keep: 10, explore: 2 }), b = await p2.screen(h, sub, 11, 600, { keep: 10, explore: 2 });
    for (const k of ["generated", "distinct", "legal", "illegal", "oob"]) assert.equal(a[k], b[k], k);
    assert.deepEqual(a.top, b.top); assert.deepEqual(a.explore, b.explore);
    assert.equal(a.generated, 600); assert.ok(a.legal > 0 && a.top.length === 10);
    for (let i = 1; i < a.top.length; i++) assert.ok(a.top[i].lap >= a.top[i - 1].lap);
    for (const x of a.top) assert.deepEqual(regs.check(design.applyChanges(h, x.changes).design), [], "only legal cars are ranked");
  } finally { await p0.close(); await p2.close(); }
});

async function mockRun(o) {
  return engine.runEngineer(Object.assign({ llm: loop.mockCaller(3), mock: true, seed: 3, maxDecisions: 3, maxCalls: 10, variants: 300, confirm: 6, explore: 1, workers: 0, segments: false }, o || {}));
}
test("engine (mock LLM): deterministic, scenario ≤ the designer limit, interaction = together − Σ alone, kept only when faster, credited to the directing proposer", async () => {
  const events = [];
  const a = await mockRun({ onEvent: (t, d) => events.push(t) }), b = await mockRun();
  assert.deepEqual(a.decisions.map(engine.compactDecision).map(d => Object.assign({}, d, { ms: 0, physics_ms: 0, laps_per_s: 0, screen: Object.assign({}, d.screen, { ms: 0, per_s: 0 }), latency_ms: 0 })), b.decisions.map(engine.compactDecision).map(d => Object.assign({}, d, { ms: 0, physics_ms: 0, laps_per_s: 0, screen: Object.assign({}, d.screen, { ms: 0, per_s: 0 }), latency_ms: 0 })));
  assert.equal(a.peak.lap_s, b.peak.lap_s);
  assert.equal(a.decisions.length, 3); assert.ok(events.includes("start") && events.includes("decision") && events.includes("done"));
  for (const d of a.decisions) {
    // corrections are on by default: the four blocks stay within the designer limit, the corrections block within its own
    const sc = JSON.parse(d.scenario); assert.ok(sc.best && sc.tree && sc.tree.peak && Array.isArray(sc.tested) && Array.isArray(sc.near));
    const c = JSON.stringify(sc.corrections); delete sc.corrections;
    assert.ok(JSON.stringify(sc).length <= dscen.LIMITS.chars, "scenario " + JSON.stringify(sc).length + " chars without corrections");
    assert.ok(c.length <= escen.CORRECTIONS.chars, "corrections " + c.length + " chars");
    assert.equal(d.by, "mock"); assert.ok(d.screen.distinct > 50); assert.ok(d.physics_laps >= 2);
    if (d.kept) assert.ok(d.result.lap_s < d.head_lap_s);
    const x = d.interaction;
    if (x && typeof x.term_s === "number") assert.ok(Math.abs(x.term_s - (x.together_d_s - x.sum_alone_d_s)) <= 0.0015, "interaction arithmetic");
  }
  const s = a.stats;
  assert.equal(s.calls, 3); assert.ok(s.variants_screened > 150 && s.variants_per_s > 0 && s.laps_per_s > 0);
  if (s.kept) assert.equal(s.directed_gain_share, 1, "every kept gain came from model-directed decisions");
  // resumable: continue the same run for one more decision from its state
  const c = await mockRun({ resume: JSON.parse(JSON.stringify(a.state)), maxDecisions: 4, llm: loop.mockCaller(4) });
  assert.equal(c.decisions.length, 4); assert.equal(c.decisions[0].decision, 1); assert.ok(c.peak.lap_s <= a.peak.lap_s);
});

test("engine: an illegal proposal is a DIRECTION (projected / repaired and its subspace explored, credited to the model); a parse error is the only engine-chosen step, labelled", async () => {
  let n = 0;
  const llm = async () => { n++; return n === 1 ? answer([{ part: "front_wing", param: "span_mm", to: 1400 }], "wider front wing") : n === 2 ? "Here is my idea: wider floor" : answer([{ part: "floor", param: "width_mm", to: 1500 }]); };
  const r = await engine.runEngineer({ llm, seed: 5, maxDecisions: 3, maxCalls: 3, variants: 400, confirm: 6, explore: 1, workers: 0, segments: false });
  const [d1, d2, d3] = r.decisions;
  assert.equal(d1.by, "mubit"); assert.equal(d1.as_proposed.legal, false); assert.ok(d1.as_proposed.articles.length);
  assert.ok(d1.screen.legal > 0, "the subspace around an illegal proposal still holds legal cars");
  assert.ok(d1.result && d1.result.lap_s, "the illegal proposal's subspace produced a measured legal car");
  assert.equal(d2.by, "engine"); assert.match(d2.fallback_reason, /^parse/);
  assert.equal(d3.by, "mubit");
  const s = r.stats; assert.equal(s.by.engine, 1); assert.equal(s.by.mubit, 2); assert.equal(s.proposal_illegal >= 1, true);
  if (s.gain_s.engine > 0) assert.ok(s.directed_gain_share < 1);
});

test("route: mode engineer (mock) runs, streams decisions and never writes data/; trained needs live + confirm + typed text; a failing Mubit is never called in mock", async () => {
  const { createApp } = require("../server/app.js");
  const listData = () => { try { return fs.readdirSync(path.join(ROOT, "data")).sort().join(","); } catch (e) { return ""; } };
  const before = listData();
  const a = createApp({ dataDir: tmp(), mubit: require("./mocks/mubit.js"), conceptMubit: { callMubit: async () => { throw new Error("must not be called"); } }, log: () => {}, engineWorkers: 0, engineTmpDir: tmp("purple-eng2-runs-") });
  const H = { "content-type": "application/json", host: "127.0.0.1:8787" };
  const post = async b => { const r = await a.app.request("/api/concept/engine/run", { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };
  assert.match((await post({ mode: "engineer", llm: "mock", trained: true })).j.error.message, /trained calls are live calls/);
  assert.match((await post({ mode: "engineer", llm: "live", trained: true, max_calls: 2 })).j.error.message, /confirm must be "trained"/);
  assert.match((await post({ mode: "engineer", llm: "live", trained: true, confirm: "trained", max_calls: 2, confirm_text: "TRAIN 3" })).j.error.message, /TRAIN 2/);
  const r = await post({ mode: "engineer", llm: "mock", seed: 2, max_calls: 2, variants: 200, confirm_k: 4, explore: 0, workers: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.data.mode, "engineer");
  const t = await (await a.app.request(r.j.data.stream, { headers: H })).text();
  const evs = t.split("\n\n").filter(Boolean).map(b => (/^event: (.*)$/m.exec(b) || [])[1]);
  assert.ok(evs.includes("decision") && evs.includes("final"), evs.join(","));
  const fin = JSON.parse(/event: final\ndata: (.*)/.exec(t)[1]);
  assert.equal(fin.summary.decisions, 2); assert.ok(fin.rescore && fin.rescore.legal); assert.equal(fin.resumable.resume_from, r.j.data.run_id);
  const files = fs.readdirSync(r.j.data.dir); for (const f of ["calls.jsonl", "decisions.jsonl", "state.json", "tree.json", "events.jsonl"]) assert.ok(files.includes(f), f);
  assert.equal(listData(), before, "data/ untouched");
  // resume the finished run for one more decision
  const r2 = await post({ mode: "engineer", llm: "mock", seed: 2, max_calls: 1, max_decisions: 1, variants: 200, confirm_k: 4, explore: 0, workers: 0, resume_from: r.j.data.run_id });
  assert.equal(r2.status, 200, JSON.stringify(r2.j));
  const t2 = await (await a.app.request(r2.j.data.stream, { headers: H })).text();
  assert.equal(JSON.parse(/event: final\ndata: (.*)/.exec(t2)[1]).summary.decisions, 3);
});

test("scenario: the tree block reports state only (no instruction words) and fit() keeps the head car and the tree", () => {
  const t = new Tree({ patience: 2 }); const h = base();
  t.root({ lap_s: 88.763, legal: true, params: h.params, mass_kg: 770, front_share: 0.448 });
  const decs = [];
  for (let k = 1; k <= 3; k++) { const n = t.add({ parent: t.head, decision: k, kind: "result", legal: true, lap_s: 88.8 + k / 100 }); t.decide(n, { decision: k, parts: ["rear_wing", "diffuser", "floor"] });
    decs.push({ decision: k, branch: 1, proposal_change: "rear_wing.aoa_deg 20->2" + k + "; diffuser.expansion_deg 14->15; floor.edge 0->1", as_proposed: { legal: false, articles: ["C3.11.2(a)", "PKG-FLOOR-STALL"] }, kept: false, screen: { distinct: 2987 }, physics_laps: 31, best_changes: [{ part: "rear_wing", param: "aoa_deg", from: 20, to: 21 }, { part: "diffuser", param: "expansion_deg", from: 14, to: 15 }, { part: "floor", param: "width_mm", from: 1450, to: 1460 }, { part: "floor", param: "throat_mm", from: 60, to: 61 }], best_d_s: 0.01 * k, interaction: { term_s: 0.004 } }); }
  const f = escen.fit({ head: h, headSummary: { lap_s: 88.763, gap_to_pole_s: 0.652, mass_kg: 770, front_share: 0.448 }, tree: t, decisions: decs });
  assert.ok(f.chars <= escen.LIMITS.chars, f.chars + " chars");
  assert.equal(f.scenario.best.lap_s, 88.763); assert.ok(f.scenario.tree.abandoned.length >= 1); assert.equal(f.scenario.tree.last_move.split(" ")[0], "fork");
  assert.doesNotMatch(f.text, /\b(should|must|try|avoid|please|propose|consider)\b/i, "the scenario reports, it does not instruct");
});

test("replays: built only from recorded LIVE runs (every request id a real mreq_), labelled, with the Mubit-directed share", () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "concept", "lab", "replays", "index.json"), "utf8"));
  assert.ok(idx.runs.length >= 1);
  for (const r of idx.runs) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "concept", "lab", "replays", r.file), "utf8"));
    assert.equal(j.format, replay.FORMAT); assert.equal(j.all_real, true); assert.ok(j.request_ids.length === j.calls && j.request_ids.every(replay.isReal));
    assert.ok(j.decisions.length >= 1 && j.nodes[0].kind === "root"); assert.ok(/recorded run; replayed, not re-run/.test(j.label));
    assert.ok(j.stats && "directed_gain_share" in j.stats);
  }
  // a mock run is refused
  const dir = tmp(), runDir = path.join(dir, "mock-run"); fs.mkdirSync(runDir);
  fs.copyFileSync(path.join(ROOT, "docs", "concept", "loop-runs", "trained-seed29", "events.jsonl"), path.join(runDir, "events.jsonl"));
  fs.writeFileSync(path.join(runDir, "calls.jsonl"), JSON.stringify({ mubit_request_id: loop.mockRequestId("x", 1), trained: false }) + "\n");
  const out = path.join(dir, "out"); const orig = console.error; console.error = () => {};
  try { assert.equal(replay.build([runDir], out).length, 0); } finally { console.error = orig; }
});
