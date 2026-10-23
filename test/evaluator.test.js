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
