// PURPLE CONCEPT - regulations, part catalogue, design and concept aero map (no game load needed). docs/concept/CONCEPT.md.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const regs = require("../concept/regs.js"), parts = require("../concept/parts.js"), design = require("../concept/design.js"), aeromap = require("../concept/aeromap.js");
const aero = require("../lab/aero.js");
const B = design.baseline();
const ids = d => regs.check(d).map(v => v.id);
const withParam = (part, param, v) => { const d = design.clone(B); d.params[part][param] = v; return d; };
const withOverride = (part, o) => { const d = design.clone(B); d.overrides = Object.assign({}, d.overrides, { [part]: o }); return d; };
const factsWith = mut => { const f = design.facts(B); mut(f); return regs.checkFacts(f).map(v => v.id); };

test("concept regs: the baseline car is legal and every rule carries an article, a value and a verified flag", () => {
  assert.deepEqual(regs.check(B), []);
  for (const r of regs.RULES.concat(regs.MODEL_RULES)) {
    assert.ok(r.id && r.article && r.text, r.id); assert.equal(typeof r.verified, "boolean", r.id);
    if (r.kind !== "info" && r.id !== "PKG-WB") assert.ok(typeof r.value === "number" || typeof r.min === "number", r.id);
  }
  assert.match(regs.SOURCE, /Section C.*Issue 17.*28\/04\/2026/);
  assert.equal(regs.NOMINAL_TYRE_MASS.verified, false);
});

// one design (or facts) per checkable rule; the check must name exactly that rule among its violations
const CASES = {
  "REG-C-WIDTH": () => ids(withParam("floor", "width_mm", 1950)),
  "REG-C-WB": () => ids(withParam("layout", "wheelbase_mm", 3450)),
  "REG-C-FRONT-AXLE": () => ids(withParam("survival_cell", "front_axle_offset_mm", 200)),
  "REG-C-COCKPIT": () => ids(withParam("survival_cell", "cockpit_len_mm", 2050)).concat(ids(withParam("survival_cell", "cockpit_len_mm", 1800))),
  "REG-C-BULKHEAD": () => ids(withParam("survival_cell", "bulkhead_gap_mm", 340)),
  "REG-C-FW-ELEMENTS": () => ids(withParam("front_wing", "elements", 4)),
  "REG-C-FW-SPAN": () => ids(withParam("front_wing", "span_mm", 1400)),
  "REG-C-FW-CHORD": () => ids(withParam("front_wing", "chord_mm", 800)),
  "REG-C-RW-ELEMENTS": () => ids(withParam("rear_wing", "elements", 4)),
  "REG-C-RW-SPAN": () => ids(withParam("rear_wing", "span_mm", 1200)),
  "REG-C-RW-CHORD": () => ids(withParam("rear_wing", "chord_mm", 500)),
  "REG-C-RW-ENDPLATE": () => ids(withParam("rear_wing", "endplate_top_mm", 900)),
  "REG-C-FW-FLAP": () => { const d = withParam("front_wing", "elements", 1); d.params.front_wing.sm_delta_deg = 5; return ids(d); },
  "REG-C-RW-FLAP": () => { const d = withParam("rear_wing", "elements", 1); d.params.rear_wing.sm_delta_deg = 5; return ids(d); },
  "REG-C-PLANK": () => ids(withParam("floor", "ride_height_mm", 22)),
  "REG-C-MASS-MIN": () => factsWith(f => { f.mass.total_kg = 760; }),
  "REG-C-MASS-FRONT": () => ids(withOverride("pu_es", { x_mm: 3300 })),
  "REG-C-MASS-REAR": () => ids(withOverride("pu_ice", { x_mm: 500 })),
  "REG-C-DRIVER-MASS": () => factsWith(f => { f.mass.driver_kg = 80; }),
  "REG-C-PU-MASS": () => ids(withOverride("pu_ice", { mass_kg: 100 })),
  "REG-C-ICE-MASS": () => ids(withOverride("pu_ice", { mass_kg: 125 })),
  "REG-C-TC-MASS": () => ids(withOverride("pu_turbo", { mass_kg: 10 })),
  "REG-C-MGUK-MASS": () => ids(withOverride("pu_mguk", { mass_kg: 14 })),
  "REG-C-ES-MASS": () => ids(withOverride("pu_es", { mass_kg: 30 })),
  "REG-C-PU-COG": () => { const d = withOverride("pu_ice", { z_mm: 150 }); d.overrides.pu_turbo = { z_mm: 150 }; return ids(d); },
  "REG-C-DRIVELINE-MASS": () => ids(withOverride("gearbox", { mass_kg: 20 })),
  "PKG-WB": () => ids(withParam("layout", "wheelbase_mm", 3300)),
};
test("concept regs: check() catches every checkable violation type, with its article in the message", () => {
  const checkable = regs.RULES.concat(regs.MODEL_RULES).filter(r => r.kind !== "info").map(r => r.id);
  assert.deepEqual(Object.keys(CASES).sort(), checkable.slice().sort(), "a test case per checkable rule");
  for (const id of checkable) { const got = CASES[id](); assert.ok(got.includes(id), id + " not caught: " + got.join(", ")); }
  const v = regs.check(withParam("layout", "wheelbase_mm", 3450))[0];
  assert.equal(v.article, "C2.3.3"); assert.match(v.message, /3400/); assert.match(regs.describeViolation("REG-C-WB"), /FIA 2026 C2\.3\.3/);
  assert.equal(regs.describeViolation("NOPE"), "NOPE");
});

test("concept mass: the parts sum, ballast tops the car up to the C4.1 minimum, axle loads add up", () => {
  const m = design.facts(B).mass;
  const sumParts = m.parts.filter(p => p.id !== "ballast").reduce((s, p) => s + p.mass_kg, 0);
  assert.ok(Math.abs(sumParts - m.parts_kg) < 0.05, sumParts + " vs " + m.parts_kg);
  assert.ok(Math.abs(m.parts_kg + m.ballast_kg - m.total_kg) < 0.02);
  assert.equal(regs.minMass().kg, 726 + regs.NOMINAL_TYRE_MASS.value); assert.equal(regs.minMass("race").kg, 724 + regs.NOMINAL_TYRE_MASS.value);
  assert.equal(m.min_kg, 770); assert.equal(m.total_kg, 770); assert.ok(m.ballast_kg > 0 && m.ballast_kg < 15, "ballast " + m.ballast_kg);
  assert.ok(Math.abs(m.front_kg + m.rear_kg - m.total_kg) < 0.02);
  assert.ok(m.front_share >= 0.44 && m.front_share <= 0.46, "front " + m.front_share);
  assert.ok(m.driver_kg >= 82 && m.pu_kg >= 185);
  // a heavier part eats ballast first (total stays at the minimum), and only then makes the car heavier
  const heavy = d => design.facts(d).mass;
  const gb = m.parts.find(p => p.id === "gearbox").mass_kg;
  const h5 = heavy(withOverride("gearbox", { mass_kg: gb + 5 })); assert.equal(h5.total_kg, 770); assert.ok(Math.abs(h5.ballast_kg - (m.ballast_kg - 5)) < 0.02);
  const h20 = heavy(withOverride("gearbox", { mass_kg: gb + 20 })); assert.equal(h20.ballast_kg, 0); assert.ok(Math.abs(h20.total_kg - (m.parts_kg + 20)) < 0.02);
  // the minimum can never be undercut by a design (ballast is automatic): lighter wings -> more ballast, same total
  const light = heavy(Object.assign(withParam("rear_wing", "chord_mm", 300), {})); assert.equal(light.total_kg, 770); assert.ok(light.ballast_kg > m.ballast_kg);
});

test("concept parts: every part has a stated mass basis and appears on the mass sheet; positions follow the wheelbase", () => {
  const sheet = design.facts(B).mass.parts.map(p => p.id);
  for (const p of parts.CATALOGUE) { assert.ok(p.basis && p.basis.length > 5, p.id); if (p.id !== "layout") assert.ok(sheet.includes(p.id), p.id + " not on the mass sheet"); }
  for (const id of sheet) assert.ok(parts.BY_ID[id], id + " not in the catalogue");
  const long = design.facts(withParam("layout", "wheelbase_mm", 3400)).mass, short = design.facts(withParam("layout", "wheelbase_mm", 3375)).mass;
  assert.ok(short.front_share < long.front_share || short.front_share > long.front_share);   // moving the rear axle moves the split
  assert.ok(design.facts(withParam("sidepods", "inlet_cm2", 900)).mass.ballast_kg < design.facts(B).mass.ballast_kg, "bigger radiators weigh more");
});

test("concept design: validate catches domain and type errors; mutate stays in the domain, quantised, never a no-op; diff round-trips", () => {
  assert.deepEqual(design.validate(B), { ok: true, errors: [] });
  assert.equal(design.validate(withParam("floor", "ride_height_mm", 80)).ok, false);
  assert.equal(design.validate(withParam("front_wing", "elements", 2.5)).ok, false);
  assert.equal(design.validate(withParam("rear_wing", "aoa_deg", "20")).ok, false);
  const rng = design.seededRng(7);
  for (let i = 0; i < 400; i++) {
    const m = design.mutate(B, rng, 0.2);
    assert.ok(m.changes.length >= 1 && m.changes.length <= 3);
    assert.ok(design.validate(m.design).ok, design.validate(m.design).errors.join("; "));
    for (const c of m.changes) { const s = design.spec(c.part, c.param); const q = (c.to - s.min) / s.step; assert.ok(Math.abs(q - Math.round(q)) < 1e-6, c.part + "." + c.param + " " + c.to); }
    const back = design.applyChanges(B, design.diff(B, m.design).map(c => ({ part: c.part, param: c.param, to: c.to }))).design;
    assert.deepEqual(back.params, m.design.params);
  }
  const clipped = design.applyChanges(B, [{ part: "rear_wing", param: "aoa_deg", to: 99 }]);
  assert.equal(clipped.design.params.rear_wing.aoa_deg, 35); assert.equal(clipped.changes[0].clamped, true);
  assert.throws(() => design.applyChanges(B, [{ part: "rear_wing", param: "nope", to: 1 }]), /unknown parameter/);
  assert.ok(design.describe(B).length >= 8);
});

test("concept aero map v0: the baseline is 1.0 and its local slopes match the lab's aero map v1 (lab/aero.js SENS) within 3 %", () => {
  const a = aeromap.evaluate(B.params);
  for (const k of ["df", "cd", "df_sm", "cd_sm"]) assert.ok(Math.abs(a[k] - 1) < 1e-12, k + " " + a[k]);
  const slope = (part, param, key, h) => (aeromap.evaluate(withParam(part, param, B.params[part][param] + h).params)[key] - aeromap.evaluate(withParam(part, param, B.params[part][param] - h).params)[key]) / (2 * h);
  const near = (got, want, what) => assert.ok(Math.abs(got - want) <= Math.abs(want) * 0.03, what + ": " + got + " vs lab " + want);
  near(slope("rear_wing", "aoa_deg", "df", 0.5), aero.SENS.rear_wing_deg.df, "rear wing df/deg");
  near(slope("rear_wing", "aoa_deg", "cd", 0.5), aero.SENS.rear_wing_deg.cd, "rear wing cd/deg");
  near(slope("front_wing", "aoa_deg", "df", 0.5), aero.SENS.front_wing_deg.df, "front wing df/deg");
  near(slope("front_wing", "aoa_deg", "cd", 0.5), aero.SENS.front_wing_deg.cd, "front wing cd/deg");
  near(slope("floor", "ride_height_mm", "df", 0.5), aero.SENS.ride_height_mm.df, "ride height df/mm");
  let s = 0; for (const k of Object.keys(aeromap.DF_SHARE)) s += aeromap.DF_SHARE[k]; assert.ok(Math.abs(s - 1) < 1e-9);
  s = 0; for (const k of Object.keys(aeromap.CD_SHARE)) s += aeromap.CD_SHARE[k]; assert.ok(Math.abs(s - 1) < 1e-9);
});

test("concept aero map v0: straight mode lowers drag only with a flap; stall and cooling behave", () => {
  const sm = withParam("rear_wing", "sm_delta_deg", 10), a = aeromap.evaluate(sm.params);
  assert.ok(a.cd_sm < a.cd && a.df_sm < a.df); assert.ok(Math.abs(a.cd - 1) < 1e-12);
  const one = withParam("rear_wing", "elements", 1); one.params.rear_wing.sm_delta_deg = 10;
  const b = aeromap.evaluate(one.params); assert.equal(b.cd_sm, b.cd, "a single-volume rear wing has no flap to move");
  const lift = x => aeromap.evaluate(withParam("rear_wing", "aoa_deg", x).params).df;
  assert.ok(lift(26) > lift(20)); assert.ok(lift(35) - lift(33) < lift(22) - lift(20), "past the stall onset each degree gives less load");
  const one1 = x => { const d = withParam("rear_wing", "elements", 1); d.params.rear_wing.aoa_deg = x; return aeromap.evaluate(d.params).df; };
  assert.ok(one1(35) < one1(33), "a single-volume wing stalls earlier: past its peak more setting gives less load");
  assert.ok(aeromap.evaluate(withParam("sidepods", "inlet_cm2", 400).params).cooling.power_factor < 1, "small inlets derate the PU");
  assert.equal(aeromap.evaluate(B.params).cooling.power_factor, 1);
  const low = withParam("floor", "ride_height_mm", 20); low.params.floor.throat_mm = 80; assert.equal(aeromap.evaluate(low.params).floor_stalled, true);
});

test("concept code and docs never use the banned words (EVAL_GUARDRAILS G-HON-02)", () => {
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated", "aerodynamically" + " tested"].join("|"), "i");
  const root = path.join(__dirname, "..");
  const files = fs.readdirSync(path.join(root, "concept")).filter(f => f.endsWith(".js")).map(f => path.join(root, "concept", f)).concat([path.join(root, "docs", "concept", "CONCEPT.md")]);
  for (const f of files) { assert.ok(fs.existsSync(f), f); const m = banned.exec(fs.readFileSync(f, "utf8")); assert.equal(m, null, path.relative(root, f) + ": " + (m && m[0])); }
});
