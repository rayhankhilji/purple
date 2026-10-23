// PURPLE - F-02 evaluator tests (TESTING_GUIDE §5): the game loaded headlessly is the system under test.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const EI = require("../server/game-headless.js").load();
const { evaluator, aero } = EI, B = aero.BASELINE, DRY = { circuit: "silverstone", wet: false, wind_ms: 0, wind_from_deg: 0 };
const rw = d => Object.assign({}, B, { rear_wing_deg: B.rear_wing_deg + d });
test("T-F02-AC1 baseline, Silverstone, dry -> lap within ±1.0 s of 80.8", () => {
  const e = evaluator.evaluate("silverstone", B, DRY); assert.ok(e.legal); assert.ok(e.lap >= 79.8 && e.lap <= 81.8, "lap " + e.lap); assert.equal(e.delta_lap, 0);
});
test("T-F02-AC2 same input twice -> deep-equal output", () => {
  const a = evaluator.evaluate("silverstone", rw(5), { circuit: "silverstone", wet: false, wind_ms: 6, wind_from_deg: 210 }), b = evaluator.evaluate("silverstone", rw(5), { circuit: "silverstone", wet: false, wind_ms: 6, wind_from_deg: 210 });
  assert.deepEqual(a, b);
});
test("T-F02-AC3 10 m/s headwind down the Hangar Straight -> that sector's vmax lower than still air", () => {
  const t = evaluator.trackFor("silverstone"), str = aero.REF_STRAIGHT.silverstone, i = Math.round(((str.s0 + str.s1) / 2) / t.ds);
  const from = Math.round(aero.bearingOfHeading(t.heading[i]));
  const still = evaluator.evaluate("silverstone", B, DRY), head = evaluator.evaluate("silverstone", B, { circuit: "silverstone", wet: false, wind_ms: 10, wind_from_deg: from });
  const si = evaluator.sectorIndex(t, (str.s0 + str.s1) / 2);
  assert.ok(head.sector_vmax_kmh[si] < still.sector_vmax_kmh[si], `S${si + 1} vmax ${head.sector_vmax_kmh[si]} vs ${still.sector_vmax_kmh[si]}`);
  assert.ok(head.straight_vmax_kmh < still.straight_vmax_kmh); assert.ok(head.lap > still.lap);
});
test("sector sum equals lap within 0.001 s", () => {
  for (const e of [evaluator.evaluate("silverstone", rw(3), DRY), evaluator.evaluate("monza", rw(-4), { circuit: "monza" })]) assert.ok(Math.abs(e.sectors.reduce((a, b) => a + b, 0) - e.lap) <= 0.0015, e.sectors + " vs " + e.lap);
});
test("T-F01-AC3 (lap level) rear wing +5 at Silverstone -> lower top speed, higher minimum corner speed", () => {
  const e = evaluator.evaluate("silverstone", rw(5), DRY);
  assert.ok(e.vmax_kmh < e.baseline.vmax_kmh, `vmax ${e.vmax_kmh} vs ${e.baseline.vmax_kmh}`);
  assert.ok(e.vmin_kmh > e.baseline.vmin_kmh, `vmin ${e.vmin_kmh} vs ${e.baseline.vmin_kmh}`);
});
test("demo premise: rear wing +8 at Silverstone is slower on the full lap (delta_lap > 0)", () => { const e = evaluator.evaluate("silverstone", rw(8), DRY); assert.ok(e.delta_lap > 0, "delta " + e.delta_lap); });
test("fast-refresh premise: rear wing +8 costs more at Monza than at Silverstone", () => {
  const s = evaluator.evaluate("silverstone", rw(8), DRY), m = evaluator.evaluate("monza", rw(8), { circuit: "monza" }); assert.ok(m.delta_lap > s.delta_lap, `monza ${m.delta_lap} vs silverstone ${s.delta_lap}`);
});
test("illegal setup -> legal false, no lap time (F-01.AC2)", () => { const e = evaluator.evaluate("silverstone", rw(16), DRY); assert.equal(e.legal, false); assert.equal(e.lap, null); assert.ok(e.violations.includes("REG-RW-MAX")); });
test("wet is slower; evaluation carries the honesty label", () => { const e = evaluator.evaluate("silverstone", B, Object.assign({}, DRY, { wet: true })); assert.ok(e.lap > 80.8); assert.match(e.model, /reduced-order lap model/); });
for (const circuit of ["silverstone", "monza"]) test(`fixture: baseline.${circuit}.json within 0.05 s (regenerate on purpose with npm run fixtures)`, () => {
  const f = path.join(__dirname, "fixtures", `baseline.${circuit}.json`); assert.ok(fs.existsSync(f), "missing fixture " + f);
  const fx = JSON.parse(fs.readFileSync(f, "utf8")), e = evaluator.evaluate(circuit, B, { circuit, wet: false, wind_ms: 0, wind_from_deg: 0 });
  assert.ok(Math.abs(e.lap - fx.lap) <= 0.05, `lap ${e.lap} vs fixture ${fx.lap}`);
});

// ---- P2.T6 (F-09): TD-01 and conditions end to end in the evaluator
const MONZA = { circuit: "monza", wet: false, wind_ms: 0, wind_from_deg: 0 };
test("T-F09-AC1 TD-01 active: rear wing 25 -> legal false, reason TD-01, no lap; 20 stays legal; off -> 25 is legal", () => {
  const on = evaluator.evaluate("silverstone", rw(5), DRY, { td01: true });
  assert.equal(on.legal, false); assert.deepEqual(on.violations, ["TD-01"]); assert.equal(on.lap, null); assert.equal(on.delta_lap, null); assert.match(on.model, /aero map v1/);
  assert.equal(evaluator.evaluate("silverstone", B, DRY, { td01: true }).legal, true);
  assert.equal(evaluator.evaluate("silverstone", rw(5), DRY, { td01: false }).legal, true);
  assert.deepEqual(evaluator.evaluate("silverstone", rw(5), Object.assign({}, DRY, { wet: true, wind_ms: 8, wind_from_deg: 90 }), { td01: true }).violations, ["TD-01"]);
});
test("TD-01 with a grandfathered baseline above the cap: the baseline still gets its lap; a baseline outside the regulation throws", () => {
  const e = evaluator.evaluate("silverstone", rw(-2), DRY, { td01: true, baseline: rw(3) });
  assert.equal(e.legal, true); assert.ok(e.baseline.lap > 0); assert.equal(e.delta_lap, +(e.lap - e.baseline.lap).toFixed(3));
  assert.throws(() => evaluator.evaluate("silverstone", B, DRY, { baseline: rw(16) }), /baseline is illegal/);
});
test("wind at Monza: a headwind down the Rettifilo lowers the straight's vmax and the lap; a tailwind raises both back", () => {
  const t = evaluator.trackFor("monza"), str = aero.REF_STRAIGHT.monza, i = Math.round(((str.s0 + str.s1) / 2) / t.ds);
  const from = Math.round(aero.bearingOfHeading(t.heading[i]));
  const still = evaluator.evaluate("monza", B, MONZA), head = evaluator.evaluate("monza", B, Object.assign({}, MONZA, { wind_ms: 10, wind_from_deg: from })), tail = evaluator.evaluate("monza", B, Object.assign({}, MONZA, { wind_ms: 10, wind_from_deg: (from + 180) % 360 }));
  assert.ok(head.straight_vmax_kmh < still.straight_vmax_kmh, `head ${head.straight_vmax_kmh} vs still ${still.straight_vmax_kmh}`);
  assert.ok(tail.straight_vmax_kmh > head.straight_vmax_kmh);
  assert.ok(head.lap > still.lap && tail.lap < head.lap, `laps still ${still.lap} head ${head.lap} tail ${tail.lap}`);
  assert.equal(head.delta_lap, 0, "baseline vs itself under the same wind is 0");
});
test("wet + wind together: both apply (slower than either alone), multipliers carry the wet factors, deterministic", () => {
  const wet = evaluator.evaluate("silverstone", rw(3), Object.assign({}, DRY, { wet: true })), wind = evaluator.evaluate("silverstone", rw(3), Object.assign({}, DRY, { wind_ms: 10, wind_from_deg: 230 }));
  const both = evaluator.evaluate("silverstone", rw(3), Object.assign({}, DRY, { wet: true, wind_ms: 10, wind_from_deg: 230 }));
  assert.ok(both.lap > wet.lap && both.lap > wind.lap, `both ${both.lap} wet ${wet.lap} wind ${wind.lap}`);
  assert.ok(both.baseline.lap > wet.baseline.lap && both.baseline.lap > wind.baseline.lap);
  assert.ok(Math.abs(both.multipliers.a0 - wet.multipliers.a0) < 1e-9 && both.multipliers.a0 < wind.multipliers.a0);
  assert.deepEqual(both, evaluator.evaluate("silverstone", rw(3), Object.assign({}, DRY, { wet: true, wind_ms: 10, wind_from_deg: 230 })));
});

// ---- P2.T5 (F-08, ARCHITECTURE §4.10): the exam builder and the generator's opt-in promote bias (server/scenarios.js)
const scenarios = require("../server/scenarios.js"), schema = EI.schema;
const EXAM_SEED = 2026;
const exam = scenarios.buildExam(EI.U.rng(EXAM_SEED), evaluator, {});
test("exam: 20 items, unique ids, deterministic for a seed", () => {
  assert.equal(exam.length, 20); assert.equal(new Set(exam.map(x => x.id)).size, 20);
  assert.deepEqual(scenarios.buildExam(EI.U.rng(EXAM_SEED), evaluator, {}), exam);
  assert.notDeepEqual(scenarios.buildExam(EI.U.rng(EXAM_SEED + 1), evaluator, {}).map(x => x.scenario.candidate), exam.map(x => x.scenario.candidate));
});
test("exam: verdict mix >= 4 promote / 4 retest / 8 reject; 3 wind, 2 wet, 2 Monza; the held-out demo case exam-rw8", () => {
  const n = v => exam.filter(x => x.truth.verdict === v).length;
  assert.ok(n("promote") >= 4 && n("retest") >= 4 && n("reject") >= 8, JSON.stringify(scenarios.examSummary(exam)));
  assert.equal(exam.filter(x => x.scenario.conditions.wind_ms > 0).length, 3); assert.equal(exam.filter(x => x.scenario.conditions.wet).length, 2); assert.equal(exam.filter(x => x.scenario.circuit === "monza").length, 2);
  const demo = exam.find(x => x.id === "exam-rw8"); assert.ok(demo);
  assert.equal(demo.scenario.circuit, "silverstone"); assert.deepEqual(demo.scenario.conditions, { wet: false, wind_ms: 0 }); assert.equal(demo.scenario.candidate.rear_wing_deg, 28);
  assert.deepEqual(demo.truth, { verdict: "reject", next_parameter: "rear_wing_deg", direction: "decrease" });
});
test("exam: each scenario is the live compact shape, serialises under 1,400 chars, and its truth matches the evaluator", () => {
  for (const it of exam) {
    assert.deepEqual(Object.keys(it.truth), ["verdict", "next_parameter", "direction"]);
    assert.ok(schema.serializeScenario(it.scenario).length < schema.LIMITS.scenario_chars, it.id);
    assert.deepEqual(Object.keys(it.scenario), ["objective", "circuit", "conditions", "baseline", "candidate", "result", "rules", "history"], it.id);
    assert.equal(schema.validateSetup(it.scenario.candidate).ok, true); assert.deepEqual(it.scenario.rules, []); assert.deepEqual(it.scenario.history, []);
    const cond = Object.assign({ circuit: it.scenario.circuit, wind_from_deg: 0 }, it.scenario.conditions);
    const ev = evaluator.evaluate(it.scenario.circuit, it.scenario.candidate, cond);
    assert.equal(ev.delta_lap, it.scenario.result.delta_lap, it.id); assert.equal(scenarios.verdictOf(ev.delta_lap), it.truth.verdict, it.id);
    const t = scenarios.truthFor(evaluator, it.scenario.circuit, it.scenario.candidate, cond); assert.equal(t.next_parameter, it.truth.next_parameter, it.id); assert.equal(t.direction, it.truth.direction, it.id);
    assert.equal(schema.serializeScenario(it.scenario), schema.serializeScenario(schema.buildScenario({ circuit: it.scenario.circuit, conditions: cond, baseline: aero.BASELINE, baselineEval: ev.baseline, candidate: it.scenario.candidate, evaluation: ev, rules: [], history: [] })), it.id + " differs from a live buildScenario");
  }
});
test("exam: data/exam.json is the committed build for seed 2026 (regenerate with node server/scenarios.js --build-exam data/exam.json --seed 2026 when the aero map changes)", () => {
  const f = path.join(__dirname, "..", "data", "exam.json"); assert.ok(fs.existsSync(f), "missing data/exam.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), exam);
});
test("generator: promote_bias 0 (default) reproduces the v1 candidates and conditions for the collection's seeds", () => {
  assert.equal(scenarios.MIX.promote_bias, 0);
  const snap = [{ candidate: { front_wing_deg: 21, rear_wing_deg: 20, ride_height_mm: 35, brake_bias_pct: 57, ers_deploy: 0.5 }, conditions: { circuit: "silverstone", wet: false, wind_ms: 0, wind_from_deg: 0 } }, { candidate: { front_wing_deg: 29, rear_wing_deg: 20, ride_height_mm: 35, brake_bias_pct: 57, ers_deploy: 0.5 }, conditions: { circuit: "silverstone", wet: false, wind_ms: 4, wind_from_deg: 220 } }, { candidate: { front_wing_deg: 23, rear_wing_deg: 20, ride_height_mm: 35, brake_bias_pct: 57, ers_deploy: 0.5 }, conditions: { circuit: "silverstone", wet: false, wind_ms: 0, wind_from_deg: 0 } }];
  snap.forEach((s, i) => assert.deepEqual(scenarios.generate(EI.U.rng(1000 + i), { circuit: "silverstone" }), s));
});
test("generator: promote_bias 1 draws only candidates the evaluator rates faster than -0.03 s; 0.5 lands in between", () => {
  const base = evaluator.evaluateOne("silverstone", B, DRY).lap, share = (bias, n) => { const rng = EI.U.rng(11); let p = 0; for (let i = 0; i < n; i++) { const c = scenarios.perturb(B, rng, { promote_bias: bias, circuit: "silverstone", evaluator }); assert.deepEqual(aero.violations(c), []); if (evaluator.evaluateOne("silverstone", c, DRY).lap - base < -0.03) p++; } return p / n; };
  assert.equal(share(1, 60), 1); const mid = share(0.5, 200); assert.ok(mid > 0.4 && mid < 0.8, "share " + mid); assert.ok(share(0, 200) < 0.2);
  const m = scenarios.movesByVerdict(evaluator, B, DRY); assert.ok(m.promote.length > 50 && m.promote.every(r => r.delta_lap < -0.03 && r.candidate.ride_height_mm < 35), "every faster menu move at Silverstone lowers the ride height");
});
