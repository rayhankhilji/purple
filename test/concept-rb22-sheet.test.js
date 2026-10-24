// RB22 data sheet (docs/concept/RB22_SHEET.md, concept/data/rb22-sheet.json, concept/tools/rb22-sheet.js): schema, honesty,
// reproducibility from the telemetry, and the sim check (every input of the physics sim's RB22 is equal to the sheet, inside its
// uncertainty, mapped by a documented effective-vs-physical rule, or a contradiction the sheet reports).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const SHEET = JSON.parse(fs.readFileSync(path.join(ROOT, "concept/data/rb22-sheet.json"), "utf8"));
const RB = require("../concept/tools/rb22-sheet.js");
const KINDS = ["regulation", "official", "reported", "derived", "fitted", "estimate"];

test("rb22 sheet: every entry has the schema, a known kind, cited sources and a derivation; no unknown left without a value", () => {
  const ids = new Set();
  assert.ok(SHEET.entries.length >= 90, "entries " + SHEET.entries.length);
  for (const e of SHEET.entries) {
    for (const k of ["id", "group", "label", "unit", "kind", "derivation"]) assert.ok(typeof e[k] === "string" && e[k].length, e.id + " " + k);
    assert.ok(!ids.has(e.id), "duplicate " + e.id); ids.add(e.id);
    assert.ok(KINDS.includes(e.kind), e.id + " kind " + e.kind);
    assert.ok(e.value !== null && e.value !== undefined, e.id + " has no value");
    assert.ok(e.sd_or_range !== null && e.sd_or_range !== undefined, e.id + " has no sd_or_range");
    assert.ok(Array.isArray(e.sources) && e.sources.length, e.id + " sources");
    for (const s of e.sources) assert.ok(SHEET.sources[s] && SHEET.sources[s].url, e.id + " cites " + s);
    assert.ok(Array.isArray(e.used_by), e.id + " used_by");
    // an estimate always carries a range or an sd
    if (e.kind === "estimate") assert.ok(typeof e.sd_or_range === "object" && (e.sd_or_range.sd != null || e.sd_or_range.range || e.sd_or_range.range_pct || e.sd_or_range.range_kg), e.id + " estimate without a range");
  }
  for (const g of ["engine", "energy", "transmission", "mass", "geometry", "tyres", "brakes", "acceleration", "cornering", "aero", "setup"]) assert.ok(SHEET.entries.some(e => e.group === g), "group " + g);
  for (const id of ["tx.gear1", "tx.gear8", "pu.ice_power_peak", "pu.upshift_rpm", "brake.peak_decel_hard_stop", "lat.envelope_by_speed", "setup.roll_stiffness_front_share", "setup.diff_on_throttle_locking", "setup.rake", "brake.balance_front", "setup.energy_map_q_silverstone"]) assert.ok(ids.has(id), id);
});

test("rb22 sheet: honest wording (no CFD / wind tunnel / validated) in the sheet and its doc", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs/concept/RB22_SHEET.md"), "utf8");
  for (const txt of [JSON.stringify(SHEET), doc, fs.readFileSync(path.join(ROOT, "concept/tools/rb22-sheet.js"), "utf8")]) assert.doesNotMatch(txt, /\bCFD\b|wind[- ]tunnel|validated/i);
  assert.match(doc, /COUPLING\.md/);
});

test("rb22 sheet: the telemetry block reproduces from concept/data/telemetry (deterministic, audit policy applied)", () => {
  const T = RB.telemetry();
  assert.deepEqual(JSON.parse(JSON.stringify(T)), SHEET.telemetry);
  // 17 qualifying laps at 9 circuits (HAD/VER, LAW at Monza, VER only at Singapore) + 8 Silverstone race laps
  assert.equal(T.laps.filter(l => l.session === "Q").length, 17); assert.equal(T.laps.filter(l => l.session === "R").length, 8);
  assert.ok(T.laps.some(l => l.circuit === "monza" && l.code === "LAW"));
  // audit FAIL channels are masked: the three race laps with raw brake 104 contribute no brake zones
  for (const l of T.laps.filter(l => /raw brake 104/.test(l.actions.join(";")))) assert.doesNotMatch(l.used, /brakes/);
  // physics sanity: gears monotonic, 8th gear consistent between events, lateral g rising with speed, braking near Brembo's scale
  const g = [1, 2, 3, 4, 5, 6, 7, 8].map(k => T.gears[k].kmh_per_1000rpm);
  for (let i = 1; i < 8; i++) assert.ok(g[i] > g[i - 1], "gear " + (i + 1));
  assert.ok(T.gear8_spread_between_circuits < 0.01);
  const lat = T.lateral.bands.map(b => b.median); assert.ok(lat[0] < lat[1] && lat[1] < lat[2] && lat[2] < lat[3]);
  const bc = Object.values(T.brembo_crosscheck).filter(b => b.measured);
  assert.ok(bc.length >= 7); for (const b of bc) assert.ok(Math.abs(b.measured.peak2_g - b.g) < 1.0, b.corner);
});

test("rb22 sheet: every physics-sim input for the RB22 is equal, within sd, mapped or a reported contradiction (and the report is current)", () => {
  const live = RB.simCheck(SHEET.entries);
  assert.equal(live.lap_s, SHEET.sim_check.lap_s, "the sim's RB22 lap changed: regenerate the sheet");
  const fields = Object.keys(RB.simValues(require("../concept/sim/index.js").baselineCar("redbull")));
  assert.deepEqual(live.rows.map(r => r.field).sort(), fields.sort(), "every sim input is classified");
  for (const r of live.rows) {
    assert.ok(["equal", "within_sd", "mapped", "contradiction"].includes(r.status), r.field);
    if (r.status === "mapped") assert.ok(r.mapping && r.mapping.length > 20, r.field + " mapping documented");
  }
  assert.deepEqual(live.contradictions, SHEET.sim_check.contradictions, "contradiction report is stale");
  // the effective CLA must be exactly the sheet's sim-effective entry; lateral capacity carries the documented estimator scale
  assert.equal(live.rows.find(r => r.field === "aero.corner.CLA_total").status, "mapped");
  for (const x of live.lateral_scale.rows) assert.ok(x.ratio_tel_over_sim > 1.1 && x.ratio_tel_over_sim < 1.45, "lateral scale at " + x.kmh);
  assert.equal(live.braking.status, "within_sd");
  // the regulation and event numbers the sim uses are exactly the sheet's
  for (const f of ["track_front_m", "track_rear_m", "REGS.mguk_max_kw", "REGS.es_soc_window_mj", "REGS.ers_eff", "REGS.fuel_energy_flow_mj_h", "conditions.recharge_limit_mj", "pu.mguk_kw"]) assert.equal(live.rows.find(r => r.field === f).status, "equal", f);
});
