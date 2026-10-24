// PURPLE - F-03 contract tests for the agent's shapes (TESTING_GUIDE §5).
const test = require("node:test"), assert = require("node:assert/strict");
const schema = require("../lab/schema.js"), aero = require("../lab/aero.js");
const good = { verdict: "reject", next_parameter: "rear_wing_deg", direction: "decrease", magnitude: 4, expected_sector_effect: [0.05, -0.2, 0.03], hypothesis: "Silverstone's long straights punish drag more than Maggotts rewards load.", reject_if: "delta_lap > 0" };
test("valid PlanOutput passes (object and string)", () => {
  assert.equal(schema.validatePlanOutput(good).ok, true);
  assert.equal(schema.validatePlanOutput(JSON.stringify(good)).ok, true);
  assert.equal(schema.validatePlanOutput("```json\n" + JSON.stringify(good) + "\n```").ok, true);
});
test("missing key -> rejected naming the field", () => { const o = Object.assign({}, good); delete o.reject_if; const v = schema.validatePlanOutput(o); assert.equal(v.ok, false); assert.equal(v.field, "reject_if"); });
test("wrong enum -> rejected naming the field", () => {
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { verdict: "maybe" })).field, "verdict");
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { next_parameter: "wing" })).field, "next_parameter");
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { direction: "up" })).field, "direction");
});
test("magnitude out of range or off-step -> rejected", () => {
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { magnitude: 40 })).field, "magnitude");
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { magnitude: 0 })).field, "magnitude");
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { magnitude: 2.5 })).field, "magnitude");
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { next_parameter: "ers_deploy", magnitude: 0.2 })).ok, true);
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { next_parameter: "ers_deploy", magnitude: 0.25 })).field, "magnitude");
});
test("extra prose before JSON -> rejected; unexpected key -> rejected; long strings -> trimmed to the limit", () => {
  const v = schema.validatePlanOutput("Here is my answer: " + JSON.stringify(good)); assert.equal(v.ok, false); assert.equal(v.field, "json");
  assert.equal(schema.validatePlanOutput(Object.assign({}, good, { note: 1 })).field, "note");
  const long = schema.validatePlanOutput(Object.assign({}, good, { hypothesis: "x".repeat(161), reject_if: "y".repeat(81) })); assert.equal(long.ok, true); assert.deepEqual(long.trimmed, ["hypothesis", "reject_if"]);
  assert.equal(long.value.hypothesis.length, 160); assert.equal(long.value.reject_if.length, 80); assert.equal(schema.validatePlanOutput(Object.assign({}, good, { hypothesis: 5 })).field, "hypothesis");
});
test("validateSetup: shape and types", () => {
  assert.equal(schema.validateSetup(aero.BASELINE).ok, true);
  assert.equal(schema.validateSetup(Object.assign({}, aero.BASELINE, { rear_wing_deg: "20" })).field, "rear_wing_deg");
  assert.equal(schema.validateSetup(Object.assign({}, aero.BASELINE, { nope: 1 })).field, "nope");
  assert.equal(schema.validateSetup(null).ok, false);
});
test("applyPlan: steps, clamps and quantises", () => {
  assert.equal(schema.applyPlan(aero.BASELINE, good).rear_wing_deg, 16);
  assert.equal(schema.applyPlan(aero.BASELINE, Object.assign({}, good, { direction: "increase", magnitude: 30 })).rear_wing_deg, 35);
  assert.equal(schema.applyPlan(aero.BASELINE, Object.assign({}, good, { next_parameter: "ers_deploy", direction: "increase", magnitude: 0.3 })).ers_deploy, 0.8);
});
test("G-MUBIT-04 scenario serialiser stays under 1,400 chars (≈350 tokens) with a 3-item history and a rule", () => {
  const ev = { lap: 81.001, sectors: [27.104, 31.56, 22.337], vmax_kmh: 321.4, vmin_kmh: 133.2, delta_lap: 0.188, delta_sectors: [-0.094, 0.311, -0.029], legal: true, baseline: { lap: 80.813, sectors: [27.198, 31.249, 22.366], vmax_kmh: 331.2 } };
  const sc = schema.buildScenario({ circuit: "silverstone", conditions: { wet: false, wind_ms: 8, wind_from_deg: 240 }, baseline: aero.BASELINE, baselineEval: ev.baseline, candidate: Object.assign({}, aero.BASELINE, { rear_wing_deg: 28, ride_height_mm: 31 }), evaluation: ev,
    rules: [{ text: "Weigh straight-line drag against corner gain; judge on full-lap delta." }], history: [{ change: "rear_wing_deg +4", delta_lap: 0.071 }, { change: "front_wing_deg -3, ride_height_mm +2", delta_lap: -0.012 }, { change: "brake_bias_pct +2", delta_lap: 0.004 }, { change: "ers_deploy -0.2", delta_lap: 0 }] });
  const s = schema.serializeScenario(sc);
  assert.ok(s.length < schema.LIMITS.scenario_chars, "chars " + s.length); assert.equal(sc.history.length, 3); assert.ok(schema.approxTokens(s) <= 350);
  assert.equal(schema.describeChange(aero.BASELINE, Object.assign({}, aero.BASELINE, { rear_wing_deg: 24, ers_deploy: 0.3 })), "rear_wing_deg +4, ers_deploy -0.2");
});

test("rules in the scenario: the NEWEST 3 active rules by created_at, oldest first; inactive skipped; strings accepted (decision 2026-10-24)", () => {
  const mk = (n, h) => ({ id: "R-0" + n, text: "rule " + n, created_at: "2026-10-24T0" + h + ":00:00Z", active: true });
  const rules = [mk(1, 1), mk(2, 2), Object.assign(mk(3, 3), { active: false }), mk(4, 4), mk(5, 5), mk(6, 6)];
  assert.deepEqual(schema.selectRules(rules), ["rule 4", "rule 5", "rule 6"]);
  assert.deepEqual(schema.selectRules(rules.slice().reverse()), ["rule 4", "rule 5", "rule 6"], "order comes from created_at, not the array");
  assert.deepEqual(schema.selectRules(["a", "b", "c", "d"]), ["b", "c", "d"], "strings: array order is age order");
  assert.deepEqual(schema.selectRules([]), []); assert.deepEqual(schema.selectRules(undefined), []);
  assert.equal(schema.selectRules([{ text: "x".repeat(200) }])[0].length, schema.LIMITS.rule_chars);
  assert.equal(schema.LIMITS.rules, 3);
});
test("G-MUBIT-04 worst case: 3 maximal 160-char rules + 3 history items + wind + two-parameter candidate stays under 1,400 chars", () => {
  const ev = { lap: 81.001, sectors: [27.104, 31.56, 22.337], vmax_kmh: 321.4, vmin_kmh: 133.2, delta_lap: -0.188, delta_sectors: [-0.094, -0.311, -0.029], legal: true, baseline: { lap: 80.813, sectors: [27.198, 31.249, 22.366], vmax_kmh: 328.2 } };
  const rules = [1, 2, 3, 4, 5, 6].map(n => ({ text: ("Rule " + n + ": weigh straight-line drag against corner gain and judge only on the full-lap delta, never on one sector. ").padEnd(160, "x").slice(0, 160), created_at: "2026-10-24T0" + n + ":00:00Z", active: true }));
  const history = [{ change: "front_wing_deg -3, ride_height_mm +2", delta_lap: -0.012 }, { change: "rear_wing_deg +4, brake_bias_pct -2", delta_lap: 0.071 }, { change: "ride_height_mm -5, ers_deploy +0.3", delta_lap: -0.121 }, { change: "rear_wing_deg -8", delta_lap: 0.309 }];
  const sc = schema.buildScenario({ circuit: "silverstone", conditions: { wet: true, wind_ms: 12, wind_from_deg: 300 }, baseline: aero.BASELINE, baselineEval: ev.baseline, candidate: Object.assign({}, aero.BASELINE, { rear_wing_deg: 28, ride_height_mm: 30 }), evaluation: ev, rules, history });
  const s = schema.serializeScenario(sc);
  assert.equal(sc.rules.length, 3); assert.equal(sc.history.length, 3); assert.ok(sc.rules.every(r => r.length === 160));
  assert.ok(s.length < schema.LIMITS.scenario_chars, "chars " + s.length); assert.ok(schema.approxTokens(s) <= 350, "tokens " + schema.approxTokens(s));
});
