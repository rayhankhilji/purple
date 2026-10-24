// PURPLE ENGINE v2 - PARALLEL ROUNDS (docs/concept/ENGINE_V2.md §9) and the "kept" training rule (concept/engineer/record-good.js),
// on the engine route with a stub Mubit (no network): K designer calls of a round are in flight AT ONCE, each with its own focus line
// (the only difference between them), the identical frozen task (system prompt, model, max_tokens, temperature), untrained
// (x-middleware-record: metadata); the engine tests every idea and keeps the round's fastest legal car; only ideas physics kept a
// faster legal car from are re-sent, as the identical request, as trained calls. Plus: the engine in round mode is deterministic,
// one tree step per round, and stops cleanly before a round that would end after its time box.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const mubit = require("../server/mubit.js"), designerPrompt = require("../concept/designer/prompt.js");
const recordGood = require("../concept/engineer/record-good.js"), engine = require("../concept/engineer/engine.js"), escen = require("../concept/engineer/scenario.js");
const loop = require("../concept/designer/loop.js");

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || "purple-rounds-test-"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const answer = (changes, hyp) => JSON.stringify({ changes, hypothesis: hyp || "test", expected: { lap_delta_s: -1, sector: 2 } });
// one plausible idea per focus area; "floor, sidepods and cooling" answers prose (a parse error: the engine's labelled fallback step,
// which is never trained)
const BY_FOCUS = {
  "front wing and nose": answer([{ part: "front_wing", param: "aoa_deg", to: 27 }], "more front wing for the slow corners"),
  "rear wing and diffuser": answer([{ part: "rear_wing", param: "aoa_deg", to: 18 }], "less rear wing: less drag on the straights"),
  "floor, sidepods and cooling": "I would lower the floor a little.",
  "suspension, set-up and gearbox": answer([{ part: "setup", param: "brake_bias", to: 56 }], "more brake bias forward"),
};
const sse = t => t.split("\n\n").filter(Boolean).map(b => ({ event: (/^event: (.*)$/m.exec(b) || [])[1], data: (/^data: (.*)$/m.exec(b) || [])[1] })).filter(x => x.event && x.data && x.event !== "ping").map(x => ({ event: x.event, data: JSON.parse(x.data) }));

test("record_good rules: exact = the idea as written legal and faster; kept = physics kept a faster legal car from it", () => {
  const row = (by, legal, d, best) => ({ by, as_proposed: { legal, d_lap_s: d }, best_d_s: best });
  assert.deepEqual(recordGood.RULES, ["exact", "kept"]);
  // slower as written, but the engine's best version of the idea beat the head: a training example under "kept" only
  assert.equal(recordGood.approved(row("mubit", true, 0.19, -0.021), "exact"), false);
  assert.equal(recordGood.approved(row("mubit", true, 0.19, -0.021), "kept"), true);
  assert.equal(recordGood.approved(row("mubit", false, null, -0.05), "kept"), true, "illegal as written, a legal repair was faster");
  assert.equal(recordGood.approved(row("mubit", true, -0.03, -0.03)), true, "the default rule is exact (the harvest's)");
  assert.equal(recordGood.approved(row("mubit", true, -0.03, null), "kept"), false, "no legal car: never kept");
  assert.equal(recordGood.approved(row("mubit", true, 0.1, -0.0001), "kept"), false, "within noise");
  assert.equal(recordGood.approved(row("engine", true, -0.2, -0.2), "kept"), false, "the engine's own fallback step is never trained");
  assert.throws(() => recordGood.recorder(() => {}, {}, { rule: "maybe" }), /rule/);
});

test("scenario focus: K distinct lines per round, rotated when K < 4; the text without a focus is unchanged", () => {
  assert.deepEqual(escen.focusFor(1, 4, 4), escen.FOCUS.slice(0, 4));
  assert.equal(new Set(escen.focusFor(3, 8, 8)).size, 8, "K = 8: eight distinct focus lines");
  assert.deepEqual(escen.focusFor(2, 2, 2), [escen.FOCUS[2], escen.FOCUS[3]], "K = 2 rotates through the four main areas by round");
  const { Tree } = require("../concept/engineer/tree.js"), design = require("../concept/design.js");
  const t = new Tree(); t.root({ params: design.baseline({ team: "redbull" }).params, legal: true, lap_s: 88.7 });
  const head = Object.assign(design.baseline({ team: "redbull" }), { id: "n0" }), hs = { lap_s: 88.7, gap_to_pole_s: 0.6, mass_kg: 770, front_share: 0.45 };
  const a = escen.fit({ head, headSummary: hs, tree: t, decisions: [] }), b = escen.fit({ head, headSummary: hs, tree: t, decisions: [], focus: "rear wing and diffuser" });
  assert.equal(JSON.parse(b.text).focus, "rear wing and diffuser");
  const bb = JSON.parse(b.text); delete bb.focus; assert.equal(JSON.stringify(bb), a.text, "only the focus line differs");
  assert.doesNotMatch(b.text, /\b(should|must|try|avoid|please|propose|consider)\b/i, "a fact, not an instruction");
});

test("route, parallel round (stub Mubit): 4 calls at once with distinct focus lines, identical frozen task, untrained; trained re-send only for kept ideas, same userContent", async () => {
  const { createApp } = require("../server/app.js");
  const seen = []; let inFlight = 0, peak = 0;
  const fake = { callMubit: async q => {
    const id = seen.length + 1; seen.push(Object.assign({ t0: Date.now() }, q));
    inFlight++; peak = Math.max(peak, inFlight);
    await sleep(40);
    inFlight--;
    const focus = (() => { try { return JSON.parse(q.userContent).focus; } catch (e) { return null; } })();
    return { text: BY_FOCUS[focus] || "?", mubit_request_id: "mreq_" + String(id).padStart(32, "a"), served_by: "provider", model: "claude-haiku-4-5", input_tokens: 700, output_tokens: 80, latency_ms: 40, trained: !!q.trained };
  } };
  const a = createApp({ dataDir: tmp(), mubit: require("./mocks/mubit.js"), conceptMubit: fake, log: () => {}, engineWorkers: 0, engineTmpDir: tmp("purple-rounds-runs-") });
  const H = { "content-type": "application/json", host: "127.0.0.1:8787" };
  const post = async b => { const r = await a.app.request("/api/concept/engine/run", { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };
  const base = { mode: "engineer", llm: "live", record_good: "kept", ideas: 4, rounds: 2, seed: 3, team: "redbull", variants: 200, confirm_k: 4, explore: 0, workers: 0 };
  // guards: ideas 1-8; max_calls = ideas × rounds, so the typed confirmation is TRAIN 8; record_good is a boolean or a rule name
  assert.match((await post(Object.assign({}, base, { ideas: 9 }))).j.error.message, /ideas must be an integer 1-8/);
  assert.match((await post(Object.assign({}, base, { confirm: "trained", confirm_text: "TRAIN 2" }))).j.error.message, /TRAIN 8/);
  assert.match((await post(Object.assign({}, base, { record_good: "maybe" }))).j.error.message, /record_good must be/);
  assert.equal(seen.length, 0, "no call before a run is accepted");

  const r = await post(Object.assign({}, base, { confirm: "trained", confirm_text: "TRAIN 8" }));
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.data.record_rule, "kept"); assert.equal(r.j.data.opts.max_calls, 8);
  const evs = sse(await (await a.app.request(r.j.data.stream, { headers: H })).text());
  const rounds = evs.filter(e => e.event === "round").map(e => e.data), done = evs.filter(e => e.event === "round_done").map(e => e.data);
  const decisions = evs.filter(e => e.event === "decision").map(e => e.data);
  assert.equal(rounds.length, 2); assert.equal(done.length, 2); assert.equal(decisions.length, 8, evs.map(e => e.event).join(","));
  assert.deepEqual(rounds[0].focus, escen.FOCUS.slice(0, 4));

  // K concurrent calls per round: the 4 calls of a round all start before any of them answers
  const untrained = seen.filter(q => !q.trained), trained = seen.filter(q => q.trained);
  assert.equal(untrained.length, 8);
  assert.ok(peak >= 4, "4 designer calls in flight at once (peak " + peak + ")");
  const r1 = untrained.slice(0, 4); assert.ok(Math.max(...r1.map(q => q.t0)) - Math.min(...r1.map(q => q.t0)) < 40, "round 1's calls start together");
  // distinct focus lines, everything else of the user message identical within a round; identical frozen task on every call
  for (const rq of [untrained.slice(0, 4), untrained.slice(4, 8)]) {
    const sc = rq.map(q => JSON.parse(q.userContent));
    assert.deepEqual(sc.map(s => s.focus), escen.FOCUS.slice(0, 4));
    const rest = sc.map(s => { const c = Object.assign({}, s); delete c.focus; return JSON.stringify(c); });
    assert.equal(new Set(rest).size, 1, "the calls of a round differ only by their focus line");
  }
  for (const q of seen) {
    assert.equal(q.task, designerPrompt); assert.equal(q.kind, "design"); assert.equal(q.sessionId, seen[0].sessionId);
    const p = mubit.buildRequest(q).params;
    assert.equal(p.system, designerPrompt.SYSTEM_PROMPT); assert.equal(p.model, designerPrompt.MODEL); assert.equal(p.max_tokens, designerPrompt.MAX_TOKENS); assert.equal(p.temperature, designerPrompt.TEMPERATURE);
  }
  for (const q of untrained) assert.equal(mubit.buildRequest(q).headers["x-middleware-record"], "metadata", "proposal calls are untrained");
  for (const q of trained) assert.equal(mubit.buildRequest(q).headers["x-middleware-record"], undefined);

  // rows: round / slot / of / focus; one kept car at most per round; the parse error is the engine's labelled step
  const rows = decisions.map(d => d.row);
  assert.deepEqual(rows.map(x => [x.round, x.slot, x.of]), [[1, 1, 4], [1, 2, 4], [1, 3, 4], [1, 4, 4], [2, 1, 4], [2, 2, 4], [2, 3, 4], [2, 4, 4]]);
  assert.deepEqual(rows.map(x => x.focus), escen.FOCUS.slice(0, 4).concat(escen.FOCUS.slice(0, 4)));
  for (const rd of [1, 2]) assert.ok(rows.filter(x => x.round === rd && x.kept).length <= 1, "one kept car per round");
  assert.equal(rows[2].by, "engine"); assert.equal(rows[6].by, "engine");
  for (const d of done) { const w = rows.find(x => x.round === d.round && x.kept); assert.equal(d.kept, !!w); if (w) { assert.equal(d.winner, w.decision); assert.equal(d.d_head_s, w.d_head_s); } }

  // trained re-sends: exactly the ideas physics kept a faster legal car from, each the identical request of its own proposal call
  const kept = rows.filter(x => recordGood.approved(x, "kept"));
  assert.ok(kept.length >= 1 && kept.length < rows.length, "some ideas are training examples, some are not (" + kept.length + "/8)");
  assert.deepEqual(decisions.map(d => d.training_example), rows.map(x => (recordGood.approved(x, "kept") ? "pending" : "not trained")));
  assert.equal(trained.length, kept.length);
  const ex = evs.filter(e => e.event === "training_example").map(e => e.data);
  assert.deepEqual(ex.map(e => e.decision).sort((x, y) => x - y), kept.map(x => x.decision));
  for (const e of ex) {
    const row = rows.find(x => x.decision === e.decision), src = untrained.find(q => JSON.parse(q.userContent).focus === row.focus && untrained.indexOf(q) < 4 * row.round && untrained.indexOf(q) >= 4 * (row.round - 1));
    const tq = trained.find(q => q.userContent === src.userContent);
    assert.ok(tq, "the trained call re-sends decision " + e.decision + "'s exact user content");
    assert.equal(e.rule, "kept"); assert.equal(e.untrained_request_id, row.mubit_request_id); assert.equal(e.same_answer, true);
    assert.equal(e.kept_d_s, row.best_d_s); assert.equal(e.round, row.round);
  }
  for (const x of rows.filter(y => !recordGood.approved(y, "kept"))) assert.ok(!trained.some(q => untrained.some(u => u.userContent === q.userContent && JSON.parse(u.userContent).focus === x.focus && untrained.indexOf(u) >= 4 * (x.round - 1) && untrained.indexOf(u) < 4 * x.round)), "decision " + x.decision + " is never trained");
  const fin = evs.find(e => e.event === "final").data;
  assert.equal(fin.calls, 8); assert.equal(fin.trained_examples, kept.length); assert.equal(fin.rounds, 2); assert.equal(fin.stop_reason, "all 2 rounds done");
  const calls = fs.readFileSync(path.join(r.j.data.dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.filter(c => c.trained && c.record_good && c.record_rule === "kept").length, kept.length, "the trained re-sends are logged, so the budget counts them");
  assert.ok(calls.every(c => c.round >= 1 && c.slot >= 1));
});

test("engine, parallel rounds (mock): deterministic, one tree step per round, stops cleanly before a round that would pass the time box", async () => {
  const run = async extra => engine.runEngineer(Object.assign({ llm: loop.mockCaller(4), mock: true, seed: 4, team: "redbull", ideas: 3, maxCalls: 9, maxDecisions: 9, variants: 150, confirm: 4, explore: 0, workers: 0, segments: false }, extra || {}));
  const a = await run(), b = await run();
  assert.equal(a.decisions.length, 9); assert.equal(a.stats.rounds, 3); assert.equal(a.stopped, "decision cap 9");
  assert.deepEqual(a.decisions.map(d => [d.round, d.slot, d.best_d_s, d.kept]), b.decisions.map(d => [d.round, d.slot, d.best_d_s, d.kept]), "deterministic");
  assert.equal(a.peak.lap_s, b.peak.lap_s);
  // one tree step per round: the branch records one decision per round, the head only moves to a round's kept car
  const branchDecs = a.tree.branches.reduce((s, br) => s + br.decisions.length, 0);
  assert.equal(branchDecs, 3);
  for (const d of a.decisions.filter(x => x.kept)) assert.equal(d.head_after, d.result.node);
  // the time box: with a slow model, round 2 would end after the deadline -> the run stops after round 1 with the plain message
  const slow = async (text, meta) => { await sleep(400); return loop.mockCaller(4)(text, meta); };
  const t = await run({ llm: slow, ideas: 2, maxCalls: 20, maxDecisions: 20, deadline: Date.now() + 700 });
  assert.equal(t.stopped, "stopped at the time limit after 1 round"); assert.equal(t.stats.rounds, 1);
});
