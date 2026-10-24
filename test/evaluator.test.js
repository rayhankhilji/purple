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

// ---- Monza reference windows (circuit switch, F-09): the fixture and REF_CORNER / REF_STRAIGHT make sense there
test("monza: REF_CORNER vmin is a true corner minimum at the Lesmos; REF_STRAIGHT is the Rettifilo at one bearing; rear wing moves vmax/vmin the right way", () => {
  const t = evaluator.trackFor("monza"), cal = evaluator.calibrate(t, "monza"), ref = aero.REF_CORNER.monza, str = aero.REF_STRAIGHT.monza;
  const prof = EI.buildSpeedProfile(t, (EI.AI_CAL && EI.AI_CAL.DEC_REF) || 0.92, cal.grip, EI.CAR.VMAX + 6, 1, 0, aero.toMultipliers(B, MONZA), null);
  let imin = Math.round(ref.s0 / t.ds); for (let i = imin; i <= Math.round(ref.s1 / t.ds); i++) if (prof[i] < prof[imin]) imin = i;
  const sMin = imin * t.ds, lesmo = EI.TRACKS.monza.corners.filter(c => /Lesmo/.test(c.name)).map(c => c.s);
  assert.ok(lesmo.length === 2 && lesmo.every(s => s >= ref.s0 && s <= ref.s1), "both Lesmos inside the window " + lesmo);
  assert.ok(sMin > ref.s0 + 50 && sMin < ref.s1 - 50, "minimum " + sMin.toFixed(0) + " is interior to the window, not clipped at an edge");
  assert.ok(Math.abs(sMin - lesmo[1]) < 80, "minimum at Lesmo 2 (" + lesmo[1] + "), got " + sMin.toFixed(0));
  const b = s => aero.bearingOfHeading(t.heading[Math.round(s / t.ds)]), dAng = (x, y) => Math.abs(((x - y + 540) % 360) - 180); assert.ok(dAng(b(str.s0 + 50), b(str.s1 - 50)) < 10, "the straight window is straight: " + b(str.s0 + 50) + " vs " + b(str.s1 - 50));
  assert.ok(EI.TRACKS.monza.corners.some(c => c.name === str.name && c.s >= str.s0 - 1 && c.s <= str.s1));
  const e = evaluator.evaluate("monza", rw(5), MONZA);
  assert.ok(e.straight_vmax_kmh > 300 && e.straight_vmax_kmh < e.baseline.straight_vmax_kmh && e.vmin_kmh > e.baseline.vmin_kmh, JSON.stringify([e.straight_vmax_kmh, e.baseline.straight_vmax_kmh, e.vmin_kmh, e.baseline.vmin_kmh]));
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "baseline.monza.json"), "utf8")); assert.equal(fx.lap, 76.65); assert.ok(Math.abs(fx.vmin_kmh - e.baseline.vmin_kmh) < 0.2 && Math.abs(fx.straight_vmax_kmh - e.baseline.straight_vmax_kmh) < 0.2);
});
test("P3.T1 prep: hardestItems keeps exam-rw8 first and ranks by distance to the ±0.03 thresholds; trySheet carries each user message verbatim; dryRun mirrors collect()", () => {
  const hard = scenarios.hardestItems(exam, 8); assert.equal(hard.length, 8); assert.equal(hard[0].id, "exam-rw8"); assert.equal(new Set(hard.map(x => x.id)).size, 8);
  const d = it => Math.min(Math.abs(it.meta.delta_lap + 0.03), Math.abs(it.meta.delta_lap - 0.03)); for (let i = 2; i < hard.length; i++) assert.ok(d(hard[i - 1]) <= d(hard[i]) + 1e-9);
  const md = scenarios.trySheet(exam, { k: 8 }); for (const it of hard) assert.ok(md.includes(schema.serializeScenario(it.scenario)), it.id); assert.match(md, /\| provider \| v1 \| v2 \|/);
  const r = scenarios.dryRun(evaluator, { n: 6, seed: 2, promote_bias: 0, U: EI.U }); assert.equal(r.rows.length, 6); assert.equal(r.rows[0].seed, 2000);
  const g = scenarios.generate(scenarios.seededRng(EI.U, 2003), { circuit: "silverstone" }); assert.equal(r.rows[3].change, schema.describeChange(B, g.candidate)); assert.deepEqual(r.rows[3].conditions, g.conditions);
  assert.equal(scenarios.dryRun(evaluator, { n: 6, seed: 2, promote_bias: 0.3, U: EI.U }).summary.n, 6);
  assert.match(scenarios.trySheet(exam, { k: 8 }), /94 % of the 50 candidates moved the front wing/);
});

test("generator: raw consecutive seeds are degenerate (v1 moved the front wing on 50/50 draws); seededRng (as app.js) spreads the picks and keeps the bias draw first", () => {
  const moved = g => aero.KEYS.filter(k => g.candidate[k] !== B[k]);
  const v1 = []; for (let s = 1000; s < 1050; s++) v1.push(moved(scenarios.generate(EI.U.rng(s), { circuit: "silverstone" })));
  assert.equal(v1.filter(m => m.includes("front_wing_deg")).length, 50, "v1 seeds: every candidate touched the front wing");
  const raw = []; for (let s = 2000; s < 2010; s++) raw.push(EI.U.rng(s)()); assert.ok(raw.every(u => Math.abs(u - 0.124) < 0.002), "raw first draws ≈ 0.124: " + raw.map(u => u.toFixed(3)));
  const mixed = []; for (let s = 2000; s < 2040; s++) mixed.push(scenarios.seededRng(EI.U, s)()); assert.ok(mixed.filter(u => u < 0.3).length >= 6 && mixed.filter(u => u < 0.3).length <= 20 && mixed.some(u => u > 0.8), "seededRng first draws are spread: " + mixed.length);
  const first = {}; for (let s = 2000; s < 2040; s++) for (const k of moved(scenarios.generate(scenarios.seededRng(EI.U, s), { circuit: "silverstone", promote_bias: 0.3, evaluator }))) first[k] = (first[k] || 0) + 1;
  assert.ok(Object.keys(first).length >= 4 && first.front_wing_deg < 30, "mixed seeds spread over parameters: " + JSON.stringify(first));
  const r = scenarios.dryRun(evaluator, { n: 40, seed: 2, promote_bias: 0.3, U: EI.U }).summary;
  assert.ok(r.promote >= 8 && r.promote <= 24 && r.reject >= 8, "v2 dry run mix " + JSON.stringify(r));
  // the bias draw is perturb's FIRST rng() (app.js replays it from the same seed to label candidate_source): with a coin that always
  // lands the candidate is a promote move; with one that never lands it is the plain v1 draw of the remaining sequence
  const always = () => 0, never = (() => { let i = 0; return () => (i++ === 0 ? 0.999 : 0.5); })();
  assert.ok(scenarios.movesByVerdict(evaluator, B, DRY).promote.some(m => schema.describeChange(B, m.candidate) === schema.describeChange(B, scenarios.perturb(B, always, { promote_bias: 0.3, evaluator, circuit: "silverstone" }))));
  assert.deepEqual(aero.violations(scenarios.perturb(B, never, { promote_bias: 0.3, evaluator, circuit: "silverstone" })), []);
});

// ---- P3.T1: scoring a hand-filled Try-models sheet (truth from data/exam.json, answers from the Markdown)
test("scoreSheet: filled fixture scores provider 8/7, v1 4/0, v2 7/5; score-card free text is a fallback; truth never comes from the sheet", () => {
  const md = fs.readFileSync(path.join(__dirname, "fixtures", "try-sheet.filled.md"), "utf8"), r = scenarios.scoreSheet(md, exam);
  assert.equal(r.n, 8); assert.deepEqual(r.unknown_ids, []);
  assert.deepEqual([r.per.provider.verdict, r.per.provider.param, r.per.v1.verdict, r.per.v1.param, r.per.v2.verdict, r.per.v2.param], [8, 7, 4, 0, 7, 5]);
  const v1_16 = r.per.v1.rows.find(x => x.id === "exam-16"); assert.deepEqual(v1_16.answer, { verdict: "reject", next_parameter: "front_wing_deg", direction: "increase" }, "exam-16 v1 came from the score-card cell 'Reject — front_wing_deg increase'");
  assert.deepEqual(r.status, { exam: { v1: 4, v1_param: 0, v1_total: 8, v2: 7, v2_param: 5, v2_total: 8, provider_sheet: 8, provider_sheet_param: 7 } });
  // a tampered truth line in the sheet changes nothing; an unknown id is reported, not scored; the blank sheet scores nothing
  assert.equal(scenarios.scoreSheet(md.replace("**reject** | rear_wing_deg decrease", "**promote** | ers_deploy increase"), exam).per.provider.verdict, 8);
  const extra = scenarios.scoreSheet(md.replace("### 8. `exam-05`", "### 8. `exam-99`"), exam); assert.deepEqual(extra.unknown_ids, ["exam-99"]); assert.equal(extra.n, 7);
  const blank = scenarios.scoreSheet(scenarios.trySheet(exam, { k: 8 }), exam); assert.equal(blank.per.v2.answered, 0); assert.deepEqual(blank.status, { exam: {} });
  // cell tolerance: order, case, punctuation, dashes for "no answer"
  assert.deepEqual(scenarios.parseSheet("### 1. `exam-rw8`\n| model | verdict | next_parameter | direction |\n|---|---|---|---|\n| v2 | RIDE_HEIGHT_MM decrease; promote | | |\n| v1 | — | - | |\n")["exam-rw8"], { v2: { verdict: "promote", next_parameter: "ride_height_mm", direction: "decrease" } });
});

// ---- wind cap fix (2026-10-24): the profile caps each sample at its own terminal speed against the local headwind; timing() must
// not re-cap at the still-air terminal (that clipped tailwind samples and made every windy lap lean slow)
test("tailwind down the Hangar Straight raises that sector's vmax above still air; head/tail laps bracket the old clipped values", () => {
  const t = evaluator.trackFor("silverstone"), str = aero.REF_STRAIGHT.silverstone, i = Math.round(((str.s0 + str.s1) / 2) / t.ds), from = Math.round(aero.bearingOfHeading(t.heading[i]));
  const still = evaluator.evaluate("silverstone", B, DRY), tail = evaluator.evaluate("silverstone", B, Object.assign({}, DRY, { wind_ms: 10, wind_from_deg: (from + 180) % 360 })), head = evaluator.evaluate("silverstone", B, Object.assign({}, DRY, { wind_ms: 10, wind_from_deg: from }));
  const si = evaluator.sectorIndex(t, (str.s0 + str.s1) / 2);
  assert.ok(tail.sector_vmax_kmh[si] > still.sector_vmax_kmh[si], `S${si + 1} vmax tail ${tail.sector_vmax_kmh[si]} vs still ${still.sector_vmax_kmh[si]}`);
  assert.ok(tail.straight_vmax_kmh > still.terminal_kmh, "a tailwind sample may exceed the still-air terminal " + tail.straight_vmax_kmh + " vs " + tail.terminal_kmh);
  assert.ok(head.lap < 80.83 && tail.lap < 81.354 && head.lap > still.lap, `head ${head.lap} tail ${tail.lap} (clipped values were 80.830 / 81.354)`);
  assert.equal(tail.terminal_kmh, still.terminal_kmh, "terminal_kmh stays the setup's still-air terminal for display");
});
test("still air is byte-identical to the fixtures (lap, sectors, vmax, vmin, straight vmax) after the wind cap fix", () => {
  for (const circuit of ["silverstone", "monza"]) {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `baseline.${circuit}.json`), "utf8")), e = evaluator.evaluate(circuit, B, { circuit, wet: false, wind_ms: 0, wind_from_deg: 0 });
    for (const k of ["lap", "sectors", "vmax_kmh", "vmin_kmh", "vmin_lap_kmh", "terminal_kmh", "straight_vmax_kmh", "sector_vmax_kmh", "multipliers", "grip_scale"]) assert.deepEqual(e[k], fx[k], circuit + " " + k);
  }
});
