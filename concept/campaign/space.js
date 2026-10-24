// PURPLE CONCEPT CAMPAIGN - the search space. Every shape parameter of the part catalogue (concept/parts.js PARAMS) becomes one
// coordinate in [0, 1]. The box is the catalogue's model domain TIGHTENED by the single-parameter FIA limits read from
// concept/regs.js (wheelbase ≤ 3400, cockpit 1830-2030, floor body ≤ 1540, wing spans / chord / volumes / endplate ...), so the
// search does not spend laps on cars that are illegal by one number alone. Tightening never makes anything legal: every
// candidate still goes through the full regs.js check (plus the bench's PU and material guards) before it is scored.
// Materials are discrete and handled outside the vector (campaign refinement), only to materials the bench allows.
"use strict";
const parts = require("../parts.js"), design = require("../design.js"), regs = require("../regs.js"), bench = require("../bench.js"), materials = require("../materials.js");

// single-parameter rule limits: [rule id, field to read from the rule ("value" | "min" | "max") or the number itself, "lo" | "hi"]
const RULE_BOUNDS = {
  "layout.wheelbase_mm": [["REG-C-WB", "value", "hi"]],
  "survival_cell.front_axle_offset_mm": [["REG-C-FRONT-AXLE", "min", "lo"], ["REG-C-FRONT-AXLE", "max", "hi"]],
  "survival_cell.cockpit_len_mm": [["REG-C-COCKPIT", "min", "lo"], ["REG-C-COCKPIT", "max", "hi"]],
  "survival_cell.bulkhead_gap_mm": [["REG-C-BULKHEAD", "value", "lo"]],
  "front_wing.span_mm": [["REG-C-FW-SPAN", "value", "hi"]],
  "front_wing.elements": [["REG-C-FW-ELEMENTS", "value", "hi"]],
  "rear_wing.span_mm": [["REG-C-RW-SPAN", "value", "hi"]],
  "rear_wing.chord_mm": [["REG-C-RW-CHORD", "value", "hi"]],
  "rear_wing.elements": [["REG-C-RW-ELEMENTS", "value", "hi"], ["REG-C-ELEMENTS-MIN", 2, "lo"]],   // rear >= 2 volumes (C3.11.7(b))
  "sidepods.inlet_cm2": [["REG-C-SIDEPOD-INLET", "value", "hi"]],
  "rear_wing.endplate_top_mm": [["REG-C-RW-ENDPLATE", "value", "hi"]],
  "floor.width_mm": [["REG-C-FLOOR-WIDTH", "value", "hi"]],
};
const VARS = parts.PARAMS.map(s => {
  const key = s.part + "." + s.param; let lo = s.min, hi = s.max; const from = [];
  for (const [id, field, side] of RULE_BOUNDS[key] || []) {
    const r = regs.BY_ID[id], val = typeof field === "number" ? field : r && r[field]; if (!r || typeof val !== "number") continue;   // a number: that rule's value for this parameter
    if (side === "lo" && val > lo) { lo = val; from.push(id + " ≥ " + val); }
    if (side === "hi" && val < hi) { hi = val; from.push(id + " ≤ " + val); }
  }
  return { key, part: s.part, param: s.param, lo, hi, step: s.step, int: !!s.int, unit: s.unit, label: s.label, domain: [s.min, s.max], tightened_by: from };
});
const N = VARS.length;

const clip01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
function encode(d) { return VARS.map(v => (d.params[v.part][v.param] - v.lo) / (v.hi - v.lo)); }
// x (any reals) -> a Design: clipped into the box, quantised by design.applyChanges; materials and identity come from `base`
// REPAIR (coupled limit, deterministic): the front-wing chord is capped at the front-wing envelope for the wing's own span,
// setting and volume count (REG-C-FW-CHORD: X extent; REG-C-FW-PROFILES-Z: X and Z together, regs.fwProfilesChordLimit), rounded
// down to the chord's step. Repairing only moves a candidate onto the rule's edge; the full check still runs on it.
function decode(x, base, meta) {
  const changes = VARS.map((v, i) => ({ part: v.part, param: v.param, to: v.lo + clip01(x[i]) * (v.hi - v.lo) }));
  let d = design.applyChanges(base, changes, meta || {}).design;
  const fw = d.params.front_wing, cv = VARS.find(v => v.key === "front_wing.chord_mm");
  let lim = regs.fwChordLimit(fw.span_mm);
  if (regs.fwProfilesChordLimit) { const z = regs.fwProfilesChordLimit(fw); if (isFinite(z)) lim = Math.min(lim, z); }
  const cap = Math.floor((lim - cv.domain[0]) / cv.step + 1e-9) * cv.step + cv.domain[0];
  if (fw.chord_mm > cap && cap >= cv.lo) d = design.applyChanges(d, [{ part: "front_wing", param: "chord_mm", to: cap }], meta || {}).design;
  return d;
}
// squared distance outside the box (CMA penalty: the decoded car sits on the edge, the sample does not)
function outside(x) { let s = 0; for (const v of x) { const c = clip01(v); s += (v - c) * (v - c); } return s; }

// fitness (minimised): the physics lap for a legal car; an illegal car ranks behind every legal one, by how many rules it breaks
// and by how far (relative excess where value and limit are numbers)
const ILLEGAL = 1000;
function penalty(violations) {
  let s = ILLEGAL;
  for (const v of violations || []) {
    s += 1;
    const lim = typeof v.limit === "number" ? v.limit : parseFloat(v.limit);
    if (typeof v.value === "number" && isFinite(lim) && lim !== 0) s += Math.min(10, Math.abs(v.value - lim) / Math.abs(lim));
  }
  return s;
}

// materials the campaign may use per part (the bench's material guard decides; the baseline material is always first)
function materialOptions(part) {
  const base = materials.baseOf(part);
  return [base].concat(materials.MATERIALS.map(m => m.id).filter(id => id !== base && bench.materialAllowed(part, id)));
}
const MATERIAL_PARTS = parts.MATERIAL_PARTS.filter(p => materialOptions(p).length > 1);

module.exports = { VARS, N, RULE_BOUNDS, encode, decode, outside, clip01, penalty, ILLEGAL, materialOptions, MATERIAL_PARTS };
