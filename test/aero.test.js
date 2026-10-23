// PURPLE - F-01 aero map tests (TESTING_GUIDE §5). No network, no game load needed.
const test = require("node:test"), assert = require("node:assert/strict");
const aero = require("../lab/aero.js");
const B = aero.BASELINE, VMAX = 92;
test("T-F01-AC1 baseline setup -> all multipliers 1.0, legal", () => {
  const m = aero.toMultipliers(B, { wet: false });
  assert.deepEqual(m, { df: 1, cd: 1, a0: 1, b0: 1, legal: true, violations: [] });
});
test("T-F01-AC2 rear_wing_deg 36 -> illegal with REG-RW-MAX", () => {
  const m = aero.toMultipliers(Object.assign({}, B, { rear_wing_deg: 36 }));
  assert.equal(m.legal, false); assert.ok(m.violations.includes("REG-RW-MAX"));
  assert.ok(aero.violations(Object.assign({}, B, { front_wing_deg: 9 })).includes("REG-FW-MIN"));
  assert.ok(aero.violations(Object.assign({}, B, { ers_deploy: 1.2 })).includes("REG-ERS"));
});
test("T-F01-AC3 rear wing +5 -> df and cd increase, terminal speed decreases", () => {
  const m0 = aero.toMultipliers(B), m5 = aero.toMultipliers(Object.assign({}, B, { rear_wing_deg: 25 }));
  assert.ok(m5.df > m0.df); assert.ok(m5.cd > m0.cd);
  assert.ok(aero.terminalSpeed(m5.cd, VMAX) < aero.terminalSpeed(m0.cd, VMAX));
  assert.ok(Math.abs(aero.terminalSpeed(1, VMAX) - VMAX) < 1e-9);
});
test("clamp: extreme combinations never leave [0.6, 1.6]", () => {
  for (const s of [{ front_wing_deg: 40, rear_wing_deg: 35, ride_height_mm: 25, brake_bias_pct: 62, ers_deploy: 1 }, { front_wing_deg: 10, rear_wing_deg: 5, ride_height_mm: 60, brake_bias_pct: 52, ers_deploy: 0 }, { front_wing_deg: 40, rear_wing_deg: 5, ride_height_mm: 25, brake_bias_pct: 52, ers_deploy: 0 }])
    for (const wet of [false, true]) { const m = aero.toMultipliers(s, { wet }); for (const k of ["df", "cd", "a0", "b0"]) { assert.ok(m[k] >= 0.6 && m[k] <= 1.6, k + "=" + m[k]); } }
});
test("TD-01 active -> rear_wing_deg 25 is illegal with reason TD-01; 20 is legal", () => {
  assert.ok(aero.violations(Object.assign({}, B, { rear_wing_deg: 25 }), { td01: true }).includes("TD-01"));
  assert.deepEqual(aero.violations(Object.assign({}, B, { rear_wing_deg: 20 }), { td01: true }), []);
  assert.deepEqual(aero.violations(Object.assign({}, B, { rear_wing_deg: 25 }), { td01: false }), []);
});
test("conditions: wet lowers a0, df, b0; ride height below 30 costs a0; bias away from 57 costs b0", () => {
  const w = aero.toMultipliers(B, { wet: true }); assert.ok(w.a0 < 1 && w.df < 1 && w.b0 < 1);
  assert.ok(aero.toMultipliers(Object.assign({}, B, { ride_height_mm: 27 })).a0 < 1);
  assert.ok(aero.toMultipliers(Object.assign({}, B, { brake_bias_pct: 60 })).b0 < 1);
});
test("wind: blowing from the direction of travel is a headwind of wind_ms; from behind, a tailwind", () => {
  for (const h of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
    const from = aero.bearingOfHeading(h);
    assert.ok(Math.abs(aero.headwind({ wind_ms: 10, wind_from_deg: from }, h) - 10) < 1e-6);
    assert.ok(Math.abs(aero.headwind({ wind_ms: 10, wind_from_deg: (from + 180) % 360 }, h) + 10) < 1e-6);
    assert.ok(Math.abs(aero.headwind({ wind_ms: 10, wind_from_deg: (from + 90) % 360 }, h)) < 1e-6);
  }
  assert.equal(aero.headwind({ wind_ms: 0, wind_from_deg: 90 }, 1), 0);
});
