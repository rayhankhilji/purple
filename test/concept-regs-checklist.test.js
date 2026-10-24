// PURPLE CONCEPT - the FIA 2026 legality checklist, adversarially (docs/concept/FIA_CHECKLIST.md).
// An ORACLE re-implements every checked numeric limit of the checklist from the regulation numbers typed in below (FIA 2026 Section
// C, Issue 19, 25/06/2026), independently of concept/regs.js. Hundreds of random, mutated and extreme designs must get the same
// verdict from both; every illegal design must name an article; the optimiser and the bench must never keep or score an illegal car.
const test = require("node:test"), assert = require("node:assert/strict");
const regs = require("../concept/regs.js"), parts = require("../concept/parts.js"), design = require("../concept/design.js");
const physical = require("../concept/physical.js"), bench = require("../concept/bench.js"), optimize = require("../concept/optimize.js");
const lapsim = require("../concept/sim/lapsim.js");

const B = design.baseline();
const ids = (d, opts) => regs.check(d, opts).map(v => v.id);

// ---------------------------------------------------------------- the oracle (regulation numbers typed from the checklist)
const LIM = {
  half_width: 950, wheelbase: 3400, axle_min: 0, axle_max: 150, cockpit_min: 1830, cockpit_max: 2030, bulkhead: 360,   // C2.3.1, .3-.6
  floor_body_width: 2 * 770,                                                                                         // App. C2 §4.9
  fw_vols: 3, fw_span: 2 * 675, rw_vols: 3, rw_span: 2 * 575, rw_chord: 630 - 165, rw_endplate: 880,                // C3.10.1, C3.11.1, App. C2 §22, §30, §31
  plank_wear: 10 - 8,                                                                                                // C3.6.1(d)
  min_q: 726, min_r: 724, ntm_estimate: 44, front: 0.44, rear: 0.54, driver: 82,                                     // C4.1, C4.2, C4.5.2
  pu: 185, ice_a: 130, mguk_a: 20, tc: 12, es: 35, pu_cog: 200, driveline: 22,                                       // C5.5, C5.3.4, C5.17.9, C5.18.7, C9.5.2
  plank_hole: 470 + 500, sidepod_cm2: 2 * 80000 / 100,                                                               // C3.6.1(c), C3.16.9
  floor_roof_z: 75,                                                                                                  // C3.5.1(a), App. C2 §4.5/§4.11
};
// RV-FW-PROFILES: [Y, Z] polygon (App. C2 §22.1); the X trims (§21.1 plane through [XF−1250, Y100], [XF−1025, Y700]; §22.4 plane
// through [XF−750, Y0], [XF−500, Y400]) are vertical
const FW_LOWER = [[0, 60], [100, 60], [675, 115]], FW_UPPER = [[0, 200], [400, 300], [675, 275]];
const interp = (pts, y) => { for (let i = 0; i + 1 < pts.length; i++) { const [y0, z0] = pts[i], [y1, z1] = pts[i + 1]; if (y <= y1) return z0 + ((z1 - z0) * (y - y0)) / (y1 - y0); } return pts[pts.length - 1][1]; };
const fwX = y => { const front = Math.max(-1250, -1250 + ((-1025 + 1250) / (700 - 100)) * (y - 100)), rear = Math.min(-475, -750 + ((-500 + 750) / 400) * y); return rear - front; };
const fwH = y => interp(FW_UPPER, y) - interp(FW_LOWER, y);
const meanOver = (h, fn) => { const n = 20000; let s = 0.5 * (fn(0) + fn(h)); for (let i = 1; i < n; i++) s += fn((h * i) / n); return s / n; };
const deg = a => (a * Math.PI) / 180;
function oracleFwLimits(fw) {
  const h = Math.min(675, fw.span_mm / 2), share = fw.elements >= 2 ? (fw.elements - 1) / fw.elements : 1, k = share * Math.tan(deg(fw.aoa_deg));
  const x = meanOver(h, fwX), xz = k > 0 ? meanOver(h, y => Math.min(fwX(y), fwH(y) / k)) : x;
  const sShare = fw.elements >= 2 ? (fw.elements - 1) / fw.elements : 0;
  const smExt = fw.chord_mm * (1 - sShare) + fw.chord_mm * sShare * (Math.cos(deg(fw.aoa_deg - fw.sm_delta_deg)) / Math.cos(deg(fw.aoa_deg)));
  return { x, xz, smExt };
}
// returns { ids: Set, near: Set } — `near` = rules within a numerical hair of their limit (the verdict may legitimately differ)
function oracle(d, opts) {
  const p = d.params, f = design.facts(d, opts), m = f.mass, a = f.aero, out = new Set(), near = new Set();
  const fw = p.front_wing, rw = p.rear_wing, fl = p.floor, sc = p.survival_cell, wb = p.layout.wheelbase_mm;
  const XA = -sc.front_axle_offset_mm, XC = XA + sc.cockpit_len_mm, XPU = XC + sc.bulkhead_gap_mm;
  const add = (id, bad, margin) => { if (bad) out.add(id); if (margin != null && Math.abs(margin) < 0.02) near.add(id); };
  add("REG-C-WIDTH", Math.max(fl.width_mm, fw.span_mm, rw.span_mm) / 2 > LIM.half_width);
  add("REG-C-WB", wb > LIM.wheelbase);
  add("REG-C-FRONT-AXLE", sc.front_axle_offset_mm < LIM.axle_min || sc.front_axle_offset_mm > LIM.axle_max);
  add("REG-C-COCKPIT", sc.cockpit_len_mm < LIM.cockpit_min || sc.cockpit_len_mm > LIM.cockpit_max);
  add("REG-C-BULKHEAD", sc.bulkhead_gap_mm < LIM.bulkhead);
  add("REG-C-FLOOR-WIDTH", fl.width_mm > LIM.floor_body_width);
  add("REG-C-FW-ELEMENTS", fw.elements > LIM.fw_vols); add("REG-C-RW-ELEMENTS", rw.elements > LIM.rw_vols);
  add("REG-C-FW-SPAN", fw.span_mm > LIM.fw_span); add("REG-C-RW-SPAN", rw.span_mm > LIM.rw_span);
  const L = oracleFwLimits(fw);
  add("REG-C-FW-CHORD", fw.chord_mm > L.x, fw.chord_mm - L.x);
  add("REG-C-FW-SM-ENVELOPE", fw.sm_delta_deg > 0 && L.smExt > L.x, L.smExt - L.x);
  add("REG-C-FW-PROFILES-Z", fw.chord_mm > L.xz, fw.chord_mm - L.xz);
  add("REG-C-RW-CHORD", rw.chord_mm > LIM.rw_chord); add("REG-C-RW-ENDPLATE", rw.endplate_top_mm > LIM.rw_endplate);
  add("REG-C-FW-FLAP", fw.sm_delta_deg > 0 && fw.elements < 2); add("REG-C-RW-FLAP", rw.sm_delta_deg > 0 && rw.elements < 2);
  add("REG-C-SM-DIRECTION", fw.sm_delta_deg < 0 || rw.sm_delta_deg < 0);
  add("REG-C-ELEMENTS-MIN", !(Number.isInteger(fw.elements) && fw.elements >= 1) || !(Number.isInteger(rw.elements) && rw.elements >= 2));
  add("REG-C-PLANK", Math.max(0, parts.PLANK.free_mm - fl.ride_height_mm) * parts.PLANK.wear_per_mm > LIM.plank_wear);   // wear model: parts.PLANK
  add("REG-C-PLANK-HOLES", wb - XPU < LIM.plank_hole);
  add("REG-C-SIDEPOD-INLET", p.sidepods.inlet_cm2 > LIM.sidepod_cm2);
  add("REG-C-FLOOR-ROOF", fl.throat_mm > LIM.floor_roof_z);
  const quali = !opts || !opts.session || ["qualifying", "sprint_qualifying"].includes(opts.session) || !["race", "sprint", "practice"].includes(opts.session);
  const min = (quali ? LIM.min_q : LIM.min_r) + LIM.ntm_estimate;
  add("REG-C-MASS-MIN", m.total_kg < min - 1e-6, m.total_kg - min);
  if (quali) { add("REG-C-MASS-FRONT", m.front_kg < LIM.front * min - 1e-6, m.front_kg - LIM.front * min); add("REG-C-MASS-REAR", m.rear_kg < LIM.rear * min - 1e-6, m.rear_kg - LIM.rear * min); }
  add("REG-C-DRIVER-MASS", m.driver_kg < LIM.driver); add("REG-C-PU-MASS", m.pu_kg < LIM.pu);
  add("REG-C-ICE-MASS", m.ice_group_kg < LIM.ice_a - 1e-6); add("REG-C-MGUK-MASS", m.mguk_kg < LIM.mguk_a - 1e-6);
  add("REG-C-TC-MASS", m.tc_kg < LIM.tc); add("REG-C-ES-MASS", m.es_kg < LIM.es); add("REG-C-PU-COG", m.pu_cog_z_mm <= LIM.pu_cog); add("REG-C-DRIVELINE-MASS", m.driveline_kg < LIM.driveline);
  // concept-model rules (model constants from the model files; the oracle re-derives the comparisons)
  add("PKG-WB", wb < XPU + parts.PACK.ice_len_mm + parts.PACK.gearbox_len_mm - 1e-6);
  add("PKG-COOLING", a.cooling.capacity < a.cooling.need * 1.05 - 1e-9, a.cooling.capacity - a.cooling.need * 1.05);
  add("PKG-FLOOR-STALL", a.stall_margin_mm < 2 - 1e-9, a.stall_margin_mm - 2);
  add("PKG-PART-MASS", m.parts.some(r => !(r.mass_kg >= 0)));
  // the PU lock: every PU row as the same design WITHOUT overrides builds it, and the transmission option unchanged
  const ref = parts.massSheet(p, { session: opts && opts.session }).parts;
  add("PKG-PU-FIXED", ["pu_ice", "pu_turbo", "pu_mguk", "pu_es", "pu_electronics"].some(id => { const a = m.parts.find(r => r.id === id), b = ref.find(r => r.id === id); return !a || a.mass_kg !== b.mass_kg || a.x_mm !== b.x_mm || a.z_mm !== b.z_mm; }) || m.mguk_transmission !== parts.PU.mguk_transmission);
  return { ids: out, near };
}
const ORACLE_IDS = ["REG-C-WIDTH", "REG-C-WB", "REG-C-FRONT-AXLE", "REG-C-COCKPIT", "REG-C-BULKHEAD", "REG-C-FLOOR-WIDTH", "REG-C-FW-ELEMENTS", "REG-C-RW-ELEMENTS", "REG-C-FW-SPAN", "REG-C-RW-SPAN", "REG-C-FW-CHORD", "REG-C-FW-SM-ENVELOPE", "REG-C-FW-PROFILES-Z", "REG-C-RW-CHORD", "REG-C-RW-ENDPLATE", "REG-C-FW-FLAP", "REG-C-RW-FLAP", "REG-C-SM-DIRECTION", "REG-C-ELEMENTS-MIN", "REG-C-PLANK", "REG-C-PLANK-HOLES", "REG-C-SIDEPOD-INLET", "REG-C-FLOOR-ROOF", "REG-C-MASS-MIN", "REG-C-MASS-FRONT", "REG-C-MASS-REAR", "REG-C-DRIVER-MASS", "REG-C-PU-MASS", "REG-C-ICE-MASS", "REG-C-MGUK-MASS", "REG-C-TC-MASS", "REG-C-ES-MASS", "REG-C-PU-COG", "REG-C-DRIVELINE-MASS", "PKG-WB", "PKG-COOLING", "PKG-FLOOR-STALL", "PKG-PART-MASS", "PKG-PU-FIXED"];

// ---------------------------------------------------------------- design generators
const quantize = (s, v) => +Math.min(s.max, Math.max(s.min, Math.round((v - s.min) / s.step) * s.step + s.min)).toFixed(6);
function withValues(fn) { const d = design.clone(B); for (const s of parts.PARAMS) d.params[s.part][s.param] = quantize(s, fn(s)); return d; }
function samples(seed) {
  const rng = design.seededRng(seed), out = [];
  out.push(["all-min", withValues(s => s.min)], ["all-max", withValues(s => s.max)], ["baseline", design.clone(B)], ["redbull", design.baseline("redbull")]);
  for (const s of parts.PARAMS) for (const v of [s.min, s.max]) { const d = design.clone(B); d.params[s.part][s.param] = v; out.push([s.part + "." + s.param + "=" + v, d]); }
  for (let i = 0; i < 120; i++) out.push(["corner" + i, withValues(s => (rng() < 0.5 ? s.min : s.max))]);
  for (let i = 0; i < 260; i++) out.push(["uniform" + i, withValues(s => s.min + rng() * (s.max - s.min))]);
  // mutation chains from the baseline (small and large steps): most stay near the legal region and probe its edges
  for (const sigma of [0.05, 0.15, 0.35]) { let d = design.clone(B); for (let i = 0; i < 90; i++) { d = design.mutate(d, rng, sigma).design; out.push(["mut" + sigma + "." + i, d]); if (regs.check(d).length && rng() < 0.5) d = design.clone(B); } }
  // the legal envelope's own edges: each regulation-limited parameter exactly at its regulation limit
  const edge = (part, param, v) => { const d = design.clone(B); d.params[part][param] = v; out.push(["edge " + part + "." + param + "=" + v, d]); };
  edge("layout", "wheelbase_mm", 3400); edge("survival_cell", "front_axle_offset_mm", 150); edge("survival_cell", "front_axle_offset_mm", 0); edge("survival_cell", "cockpit_len_mm", 1830); edge("survival_cell", "cockpit_len_mm", 2030); edge("survival_cell", "bulkhead_gap_mm", 360);
  edge("floor", "width_mm", 1540); edge("floor", "width_mm", 1550); edge("front_wing", "span_mm", 1350); edge("front_wing", "span_mm", 1360); edge("rear_wing", "span_mm", 1150); edge("rear_wing", "span_mm", 1160);
  edge("rear_wing", "chord_mm", 465); edge("rear_wing", "chord_mm", 470); edge("rear_wing", "endplate_top_mm", 880); edge("rear_wing", "endplate_top_mm", 885); edge("floor", "ride_height_mm", 24); edge("floor", "ride_height_mm", 23.5);
  edge("front_wing", "aoa_deg", 25.5); edge("front_wing", "chord_mm", 575); edge("rear_wing", "elements", 1); edge("sidepods", "inlet_cm2", 1100);
  // overrides: PU changes (the PU lock) and non-PU changes (legal while the mass rules hold)
  const ov = (name, o) => { const d = design.clone(B); d.overrides = o; out.push(["override " + name, d]); };
  ov("ICE +2 kg", { pu_ice: { mass_kg: 120.5 } }); ov("ICE -0.5 kg", { pu_ice: { mass_kg: 118 } }); ov("ES moved 100 mm", { pu_es: { x_mm: 2000 } }); ov("TC lowered", { pu_turbo: { z_mm: 400 } });
  ov("MGU-K 22 kg", { pu_mguk: { mass_kg: 22 } }); ov("misc +3 kg", { misc: { mass_kg: 15.2 } }); ov("hydraulics moved", { hydraulics: { x_mm: 1500 } }); ov("electronics -2 kg", { electronics: { mass_kg: 23.8 } });
  return out;
}

// ---------------------------------------------------------------- the tests
test("checklist rules: every rule has an id, an Issue-19 article or a concept-model tag, a text and a verified flag; ids are unique", () => {
  const seen = new Set();
  for (const r of regs.ALL_RULES) {
    assert.ok(r.id && !seen.has(r.id), "unique " + r.id); seen.add(r.id);
    assert.ok(typeof r.article === "string" && r.article.length > 0 && (/^C\d|^App\. C|concept/.test(r.article)), r.id + " article " + r.article);
    assert.ok(r.text && typeof r.verified === "boolean", r.id);
    assert.ok(regs.BY_ID[r.id], r.id + " in BY_ID");
  }
  assert.equal(regs.DOC.issue, 19); assert.match(regs.SOURCE, /Issue 19/);
  // the rules the oracle covers are exactly the checkable (non-info) geometry / mass / model rules; materials have their own tests
  const checkable = regs.ALL_RULES.filter(r => r.kind !== "info" && !/^REG-C-MAT-/.test(r.id) && r.id !== "REG-C-SUSP-WIDTH").map(r => r.id).sort();
  assert.deepEqual(ORACLE_IDS.slice().sort(), checkable, "the oracle covers every checkable rule");
});

test("checklist oracle: random, mutated and extreme designs get the same verdict from regs.js and the independent oracle", () => {
  let legal = 0, illegal = 0, compared = 0;
  for (const seed of [2026, 7]) for (const [name, d] of samples(seed)) {
    const vs = regs.check(d), got = new Set(vs.map(v => v.id)), o = oracle(d);
    for (const v of vs) { assert.ok(regs.BY_ID[v.id], name + ": unknown id " + v.id); assert.ok(typeof v.article === "string" && v.article.length > 0, name + ": " + v.id + " has no article"); assert.ok(v.message && v.message.includes("["), name + ": message"); }
    for (const id of ORACLE_IDS) {
      if (o.near.has(id)) continue;
      assert.equal(got.has(id), o.ids.has(id), name + ": " + id + " regs=" + got.has(id) + " oracle=" + o.ids.has(id) + " " + JSON.stringify(d.params));
      compared++;
    }
    if (vs.length === 0) { legal++; assert.equal(o.ids.size, 0, name + ": regs says legal, oracle says " + [...o.ids].join(", ")); }
    else { illegal++; assert.ok(vs.some(v => /^C\d/.test(v.article) || /concept/.test(v.article)), name + " names an article"); }
  }
  assert.ok(legal >= 100 && illegal >= 300, "both verdicts exercised: legal " + legal + ", illegal " + illegal);
  assert.ok(compared > 30000);
});

test("checklist: all-max and all-min are illegal with articles; the baselines are legal; every regulation edge is inclusive", () => {
  const max = withValues(s => s.max), min = withValues(s => s.min);
  for (const d of [max, min]) { const v = regs.check(d); assert.ok(v.length > 3); assert.ok(v.every(x => x.article)); }
  assert.ok(ids(max).includes("REG-C-FLOOR-WIDTH") && ids(max).includes("REG-C-FW-ELEMENTS") && ids(max).includes("REG-C-RW-ENDPLATE"));
  assert.ok(ids(min).includes("REG-C-ELEMENTS-MIN") && ids(min).includes("REG-C-COCKPIT"));
  assert.deepEqual(regs.check(B), []); assert.deepEqual(regs.check(design.baseline("redbull")), []);
  // limits are inclusive (C2.5: the stated value is the limit); one quantum past fails
  const at = (part, param, v) => { const d = design.clone(B); d.params[part][param] = v; return ids(d); };
  assert.deepEqual(at("floor", "width_mm", 1540), []); assert.ok(at("floor", "width_mm", 1550).includes("REG-C-FLOOR-WIDTH"));
  assert.deepEqual(at("rear_wing", "endplate_top_mm", 880), []); assert.ok(at("rear_wing", "endplate_top_mm", 885).includes("REG-C-RW-ENDPLATE"));
  assert.deepEqual(at("survival_cell", "bulkhead_gap_mm", 360), []);
});

test("combinations: wing Z envelope, straight-mode direction, rear-wing volume minimum, plank holes, sidepod inlet", () => {
  // front wing: the baseline (1300 × 580 mm, 25°, 3 volumes) sits inside RV-FW-PROFILES in X and Z; +0.5° needs a shorter chord
  assert.ok(Math.abs(regs.fwProfilesChordLimit({ span_mm: 1300, aoa_deg: 25, elements: 3 }) - oracleFwLimits({ span_mm: 1300, aoa_deg: 25, elements: 3, chord_mm: 580, sm_delta_deg: 0 }).xz) < 0.01);
  const steep = design.clone(B); steep.params.front_wing.aoa_deg = 25.5; assert.deepEqual(ids(steep), ["REG-C-FW-PROFILES-Z"]);
  steep.params.front_wing.chord_mm = 570; assert.deepEqual(ids(steep), [], "a shorter chord fits the steeper setting");
  // two volumes (flaps = half the chord) leave room for a steeper setting at the same chord
  const two = design.clone(B); two.params.front_wing.elements = 2; two.params.front_wing.aoa_deg = 30; assert.ok(!ids(two).includes("REG-C-FW-PROFILES-Z"));
  // flat wing: the Z term vanishes and the X envelope is the limit
  assert.ok(Math.abs(regs.fwProfilesChordLimit({ span_mm: 1300, aoa_deg: 0, elements: 3 }) - regs.fwChordLimit(1300)) < 1e-9);
  // the rear-wing Z envelope is computed (and reported) but not enforced: the rear setting is not a geometric angle in the aero map
  assert.equal(regs.BY_ID["REG-C-RW-PROFILES-Z"].kind, "info"); assert.ok(regs.rwProfilesChordLimit({ span_mm: 1100, aoa_deg: 35, elements: 2 }) < 420);
  // Straight Mode must lower incidence (C3.10.10(n)(ii), C3.11.6(c)(ii)); negative was silently "no straight mode" before
  for (const w of ["front_wing", "rear_wing"]) { const d = design.clone(B); d.params[w].sm_delta_deg = -5; assert.ok(ids(d).includes("REG-C-SM-DIRECTION"), w); }
  // the rear wing needs ≥ 2 volumes even without Straight Mode: Rear Wing Separators join the forwardmost volume to the RW Flap (C3.11.7(b))
  const one = design.clone(B); one.params.rear_wing.elements = 1; one.params.rear_wing.sm_delta_deg = 0; assert.deepEqual(ids(one), ["REG-C-ELEMENTS-MIN"]);
  const frac = design.clone(B); frac.params.front_wing.elements = 2.5; assert.ok(ids(frac).includes("REG-C-ELEMENTS-MIN"));
  // C3.6.1(c): XR − XPU ≥ 970, checked on its own facts (the packaging model's 1140 mm minimum also implies it)
  const f = design.facts(B); f.geometry.XR = f.geometry.XPU + 960; assert.ok(regs.checkFacts(f).map(v => v.id).includes("REG-C-PLANK-HOLES"));
  // C3.16.9: 80,000 mm² per side
  const fs = design.facts(B); fs.params = design.clone(B).params; fs.params.sidepods.inlet_cm2 = 1700; assert.ok(regs.checkFacts(fs).map(v => v.id).includes("REG-C-SIDEPOD-INLET"));
  // C10.10.1 activates on wheel rows that carry y_mm: 790 − 167 = 623 > 603 (the mass sheet's front-wheel |y| today)
  const fy = design.facts(B); fy.mass.parts.find(r => r.id === "wheels_front").y_mm = 790; fy.mass.parts.find(r => r.id === "wheels_rear").y_mm = 700;
  const sw = regs.checkFacts(fy).filter(v => v.id === "REG-C-SUSP-WIDTH"); assert.equal(sw.length, 1); assert.equal(sw[0].part, "wheels_front");
});

test("robustness: non-finite or negative inputs are illegal with an article (they used to pass the mass rules)", () => {
  const ov = o => { const d = design.clone(B); d.overrides = o; return d; };
  for (const [name, d] of [
    ["NaN ICE mass", ov({ pu_ice: { mass_kg: NaN } })], ["NaN misc mass", ov({ misc: { mass_kg: NaN } })], ["negative misc mass", ov({ misc: { mass_kg: -40 } })],
    ["string mass", ov({ gearbox: { mass_kg: "48" } })], ["part 20 m behind the car", ov({ misc: { x_mm: 20000 } })], ["part under the ground", ov({ pu_es: { z_mm: -500 } })], ["NaN position", ov({ pu_turbo: { z_mm: NaN } })],
  ]) { const v = regs.check(d); assert.ok(v.length > 0, name + " is legal?"); assert.ok(v.every(x => x.article), name); }
  // every numeric fact the rules read: NaN must fail (not pass) at least one rule
  const paths = [["geometry", "half_width_mm"], ["geometry", "wheelbase_mm"], ["geometry", "front_axle_offset_mm"], ["geometry", "cockpit_len_mm"], ["geometry", "bulkhead_gap_mm"], ["geometry", "XR"], ["floor", "width_mm"],
    ["front_wing", "span_mm"], ["front_wing", "chord_mm"], ["front_wing", "aoa_deg"], ["front_wing", "elements"], ["front_wing", "sm_delta_deg"], ["rear_wing", "span_mm"], ["rear_wing", "chord_mm"], ["rear_wing", "elements"], ["rear_wing", "endplate_top_mm"], ["rear_wing", "sm_delta_deg"],
    ["mass", "total_kg"], ["mass", "front_kg"], ["mass", "rear_kg"], ["mass", "driver_kg"], ["mass", "pu_kg"], ["mass", "ice_group_kg"], ["mass", "mguk_kg"], ["mass", "tc_kg"], ["mass", "es_kg"], ["mass", "pu_cog_z_mm"], ["mass", "driveline_kg"], ["aero", "stall_margin_mm"]];
  for (const [a, b] of paths) { const f = JSON.parse(JSON.stringify(design.facts(B))); f[a][b] = NaN; assert.ok(regs.checkFacts(f).length > 0, a + "." + b + " = NaN passes"); }
  const fp = JSON.parse(JSON.stringify(design.facts(B))); fp.plank_wear_mm = NaN; assert.ok(regs.checkFacts(fp).some(v => v.id === "REG-C-PLANK"));
});

test("materials (C15): the table contract, permitted / prohibited classes and component articles; tolerant when the table is absent", () => {
  const before = regs.materialTable();
  try {
    // no table and no assignment: nothing to check; an assignment without a table cannot be shown to be a listed material
    regs.setMaterials(null);
    assert.deepEqual(regs.check(B), []);
    const assigned = design.clone(B); assigned.materials = { front_wing: "cfrp-t800" }; assert.deepEqual(ids(assigned), ["REG-C-MAT-PERMITTED"]);
    const T = [
      { id: "cfrp-t800", name: "Carbon fibre (T800) / epoxy prepreg", density_kg_m3: 1550, E_GPa: 70 },
      { id: "cfrp-m60j", name: "Carbon fibre (M60J) / epoxy", density_kg_m3: 1650, E_GPa: 120 },
      { id: "cfrp-pitch", name: "Carbon fibre (K13D2U pitch) / cyanate ester", density_kg_m3: 1800, E_GPa: 300 },
      { id: "cfrp-generic-stiff", name: "Carbon fibre / epoxy UD", density_kg_m3: 1600, E_GPa: 360 },
      { id: "be", name: "Beryllium", density_kg_m3: 1850, E_GPa: 287 },
      { id: "albemet", name: "AlBeMet AM162", density_kg_m3: 2071, E_GPa: 193 },
      { id: "al7075", name: "Aluminium 7075-T6", density_kg_m3: 2810, E_GPa: 71.7 },
      { id: "al2099", name: "Al-Li 2099", density_kg_m3: 2630, E_GPa: 78 },
      { id: "al8090", name: "Al-Li 8090", density_kg_m3: 2550, E_GPa: 77 },
      { id: "mmc225", name: "SupremEX 225XE aluminium metal matrix composite", density_kg_m3: 2880, E_GPa: 100 },
      { id: "mmc-sic", name: "SiC particle reinforced aluminium MMC (40 %)", density_kg_m3: 2960, E_GPa: 150 },
      { id: "az80", name: "Magnesium AZ80A", density_kg_m3: 1800, E_GPa: 45 },
      { id: "az31", name: "Magnesium AZ31B", density_kg_m3: 1770, E_GPa: 45 },
      { id: "we43", name: "Magnesium WE43C", density_kg_m3: 1840, E_GPa: 44 },
      { id: "ti64", name: "Titanium Ti-6Al-4V (Grade 5)", density_kg_m3: 4430, E_GPa: 114 },
      { id: "ti-generic", name: "Titanium alloy", density_kg_m3: 4500, E_GPa: 110 },
      { id: "w-heavy", name: "Tungsten heavy alloy (W-Ni-Fe)", density_kg_m3: 17600, E_GPa: 340 },
      { id: "steel4340", name: "Steel 4340", density_kg_m3: 7850, E_GPa: 205 },
      { id: "cube", name: "Copper beryllium C17200", density_kg_m3: 8250, E_GPa: 128, be_pct: 2.0 },
      { id: "nitinol", name: "Nitinol shape memory alloy", density_kg_m3: 6450, E_GPa: 75 },
      { id: "cc", name: "Carbon-carbon", density_kg_m3: 1750, E_GPa: 60 },
      { id: "basalt", name: "Basalt fibre / epoxy", density_kg_m3: 2000, E_GPa: 40 },
      { id: "secret", name: "Unobtainium", density_kg_m3: 1000, E_GPa: 500, class: "metal" },
      { id: "bad", name: "Broken record", density_kg_m3: null, E_GPa: 70 },
      { id: "cfrp-t1100", name: "Carbon fibre (T1100G) / epoxy prepreg", density_kg_m3: 1560, E_GPa: 75 },
    ];
    regs.setMaterials({ _meta: { what: "test table" }, materials: T });
    const m = (part, mat) => regs.materialViolations(part, mat).map(v => v.id);
    // C15.1.4 specific modulus: Be 155, AlBeMet 93 GPa/(g/cm³) > 40
    assert.ok(m("rear_wing", "be").includes("REG-C-MAT-SPECIFIC-MODULUS")); assert.ok(m("floor", "albemet").includes("REG-C-MAT-SPECIFIC-MODULUS"));
    assert.ok(m("floor", "secret").includes("REG-C-MAT-SPECIFIC-MODULUS"));
    // C15.2 permitted outside the PU
    for (const [part, mat] of [["rear_wing", "cfrp-t800"], ["floor", "al7075"], ["gearbox", "al2099"], ["front_suspension", "ti64"], ["ballast", "w-heavy"], ["gearbox", "steel4340"], ["gearbox", "we43"], ["brakes_front", "cc"], ["sidepods", "mmc225"]]) assert.deepEqual(m(part, mat), [], part + " " + mat);
    for (const [part, mat] of [["floor", "al8090"], ["gearbox", "az31"], ["rear_wing", "cfrp-m60j"], ["rear_wing", "cfrp-pitch"], ["rear_wing", "cfrp-generic-stiff"], ["floor", "ti-generic"], ["rear_wing", "basalt"], ["floor", "cc"], ["floor", "nope"], ["floor", "bad"]]) assert.deepEqual(m(part, mat), ["REG-C-MAT-PERMITTED"], part + " " + mat);
    assert.deepEqual(m("floor", "nitinol"), ["REG-C-MAT-PROHIBITED"]);
    assert.deepEqual(m("floor", "mmc-sic"), ["REG-C-MAT-SPECIFIC-MODULUS", "REG-C-MAT-PERMITTED"], "a stiff unlisted MMC fails both C15.1.4 (51 GPa/(g/cm³)) and C15.2.1(h)");
    // C15.6.1 inside the PU perimeter
    for (const mat of ["az80", "mmc225", "w-heavy", "al2099", "cc"]) assert.deepEqual(m("pu_ice", mat), ["REG-C-MAT-PU"], "PU " + mat);
    assert.deepEqual(m("pu_ice", "steel4340"), []); assert.deepEqual(m("pu_turbo", "ti64"), []); assert.deepEqual(m("pu_es", "cube"), []);
    // component articles
    assert.deepEqual(m("wheels_front", "az80"), []); assert.deepEqual(m("wheels_rear", "we43"), ["REG-C-MAT-COMPONENT"]); assert.deepEqual(m("wheels_rear", "al7075"), ["REG-C-MAT-COMPONENT"]);
    assert.deepEqual(m("cooling", "al7075"), []); assert.deepEqual(m("cooling", "ti64"), ["REG-C-MAT-COMPONENT"]);
    // C15.5.1(f), C15.5.3: survival-cell skins are CC-UHS, fibre Ftu > 6250 MPa: T800 (5880 MPa) is not, T1100 (7000 MPa) is
    assert.deepEqual(m("survival_cell", "cfrp-t800"), ["REG-C-MAT-COMPONENT"]); assert.deepEqual(m("survival_cell", "cfrp-t1100"), []); assert.ok(m("survival_cell", "al7075").includes("REG-C-MAT-COMPONENT"));
    assert.ok(m("front_wing", "al7075").includes("REG-C-MAT-COMPONENT"));
    assert.deepEqual(m("halo", "ti64"), []); assert.deepEqual(m("halo", "steel4340"), ["REG-C-MAT-COMPONENT"]);
    assert.deepEqual(m("driver_ballast", "w-heavy"), []); assert.deepEqual(m("driver_ballast", "al7075"), ["REG-C-MAT-DENSITY"]);
    assert.deepEqual(m("electronics", "cfrp-pitch"), [], "C15.4(d) electrical components are exempt from C15.2");
    // designs carry materials as design.materials or a `material` field on a part's params; numeric refs index the table
    const d = design.clone(B); d.materials = { rear_wing: "cfrp-t800", wheels_front: "az80", driver_ballast: "w-heavy" }; assert.deepEqual(regs.check(d), []);
    d.materials.rear_wing = "be"; assert.deepEqual(ids(d), ["REG-C-MAT-SPECIFIC-MODULUS", "REG-C-MAT-PERMITTED"]);
    const p = design.clone(B); p.params.floor.material = 6; assert.deepEqual(regs.check(p), []);
    p.params.floor.material = 4; assert.ok(ids(p).includes("REG-C-MAT-SPECIFIC-MODULUS"));
    // facts that carry params / materials (what concept/design.js facts() is asked to add) are checked by checkFacts alone
    const f = design.facts(B); f.materials = { pu_mguk: "az80" }; assert.deepEqual(regs.checkFacts(f).map(v => v.id), ["REG-C-MAT-PU"]);
    // every violation names its part and an article
    for (const v of regs.check(d)) { assert.equal(v.part, "rear_wing"); assert.match(v.article, /^C15/); }
    // the real table, when present, must classify every row it ships (no unknown material in the catalogue)
    if (before) for (const row of before.list) { const c = regs.classify(row); assert.notEqual(c.family, "unknown", "materials-2026.json row " + row.id + " cannot be classified"); }
  } finally { regs.setMaterials(before ? before.list : null); }
});

test("materials (C15) on the real table: every row's verdict on a general part agrees with its fia.status; every baseline material is legal on its part; the bench rejects an illegal material", () => {
  const M = require("../concept/materials.js");
  regs.setMaterials(M.MATERIALS);
  // (mg_we43 now names its variant, WE43C / UNS M18434, so the table and the checklist agree on every row)
  const KNOWN = {};
  for (const m of M.MATERIALS) {
    const v = regs.materialViolations("rear_wing", m.id).map(x => x.id), expectLegal = m.fia.status === "permitted";
    if (KNOWN[m.id]) { assert.ok(v.length > 0, m.id + " " + KNOWN[m.id]); continue; }
    assert.equal(v.length === 0, expectLegal, m.id + " (" + m.fia.status + "): " + v.join(", "));
  }
  for (const part of Object.keys(M.PARTS)) assert.deepEqual(regs.materialViolations(part, M.baseOf(part)), [], part + " baseline material " + M.baseOf(part));
  // through the bench (facts.mass.materials carries every named material): illegal materials are never scored
  for (const [part, mat, id] of [["rear_wing", "cfrp_m60j", "REG-C-MAT-PERMITTED"], ["floor", "albemet_am162", "REG-C-MAT-SPECIFIC-MODULUS"], ["sidepods", "al_li_2195", "REG-C-MAT-PERMITTED"], ["survival_cell", "gfrp_e", "REG-C-MAT-COMPONENT"], ["front_wing", "al_7075_t6", "REG-C-MAT-COMPONENT"], ["floor", "carbon_carbon", "REG-C-MAT-PERMITTED"]]) {
    const d = design.clone(B); d.params[part].material = mat;
    if (M.problem(part, mat)) continue;   // a form the part cannot take is refused by design.validate already
    const r = bench.bench(d); assert.equal(r.legal, false, part + " " + mat); assert.equal(r.score, null); assert.ok(r.violations.some(v => v.id === id && v.part === part), part + " " + mat + ": " + r.violations.map(v => v.id).join(", "));
  }
  for (const [part, mat] of [["rear_wing", "cfrp_m55j"], ["floor", "ti64"], ["gearbox", "al_li_2099"], ["survival_cell", "cfrp_t1100g"], ["ballast", "steel_maraging_300"]]) {
    const d = design.clone(B); d.params[part].material = mat; assert.deepEqual(regs.check(d), [], part + " " + mat);
  }
});

test("PU lock (owner brief: the baseline team's PU, unchanged): any PU mass, position or option change is rejected; the PhysicalCar PU cannot exceed the baseline's", () => {
  // the lock table equals the baseline mass sheet
  const sheet = design.facts(B).mass, g = parts.geometry(B.params);
  for (const id of Object.keys(regs.PU_LOCK.rows)) { const ref = regs.PU_LOCK.rows[id], r = sheet.parts.find(x => x.id === id); assert.equal(r.mass_kg, ref.kg, id); assert.equal(r.x_mm, Math.round(g[ref.at] + ref.dx), id); assert.equal(r.z_mm, ref.z, id); }
  assert.equal(regs.PU_LOCK.mguk_transmission, parts.PU.mguk_transmission);
  // the lock follows the geometry: moving the bulkhead moves the PU with it, legally
  const moved = design.clone(B); moved.params.survival_cell.bulkhead_gap_mm = 370; moved.params.layout.wheelbase_mm = 3400; assert.ok(!ids(moved).includes("PKG-PU-FIXED"));
  for (const [id, o] of [["pu_ice", { mass_kg: 125 }], ["pu_ice", { z_mm: 260 }], ["pu_turbo", { mass_kg: 13 }], ["pu_mguk", { x_mm: 2500 }], ["pu_es", { mass_kg: 36 }], ["pu_electronics", { mass_kg: 5 }]]) {
    const d = design.clone(B); d.overrides = { [id]: o }; const v = regs.check(d);
    assert.ok(v.some(x => x.id === "PKG-PU-FIXED" && x.part === id), id + " " + JSON.stringify(o) + ": " + v.map(x => x.id).join(", "));
    const r = bench.bench(d); assert.equal(r.legal, false); assert.equal(r.score, null);
  }
  const f = design.facts(B); f.mass.mguk_transmission = "b"; assert.ok(regs.checkFacts(f).some(v => v.id === "PKG-PU-FIXED"));
  // the PhysicalCar: every design's PU equals the baseline team's (ICE may only drop through the cooling derate)
  for (const team of [undefined, "redbull"]) {
    const base = design.baseline(team), ref = physical.physical(base).pu, rng = design.seededRng(17); let d = design.clone(base);
    for (let i = 0; i < 30; i++) { d = design.mutate(d, rng, 0.2).design; assert.deepEqual(regs.checkPhysical(physical.physical(d), { pu_ref: ref }).filter(v => v.id !== "REG-C-SUSP-WIDTH"), [], "gen " + i); }
    const hot = JSON.parse(JSON.stringify(physical.physical(base))); hot.pu.ice_kw += 5; hot.pu.es_harvest_mj_per_lap = 8; assert.deepEqual(regs.checkPhysical(hot, { pu_ref: ref }).filter(v => v.id === "PKG-PU-FIXED").map(v => v.field), ["pu.es_harvest_mj_per_lap", "pu.ice_kw"]);
  }
});

test("PU and ERS figures the scorer uses stay inside C5.2 (checkPU, sim constants, the C5.2.8 taper)", () => {
  // every PhysicalCar the bench builds
  const rng = design.seededRng(3); let d = design.clone(B);
  for (let i = 0; i < 40; i++) { d = design.mutate(d, rng, 0.2).design; const pc = physical.physical(d); assert.deepEqual(regs.checkPU(pc.pu), [], JSON.stringify(pc.pu)); }
  assert.deepEqual(regs.checkPU(physical.physical(design.baseline("redbull")).pu), []);
  // and the checks bite
  const ids_ = pu => regs.checkPU(pu).map(v => v.id);
  assert.deepEqual(ids_({ ice_kw: 400, mguk_kw: 360, es_deploy_mj_per_lap: 12.5, es_harvest_mj_per_lap: 8.5, es_soc_window_mj: 4 }), ["REG-C-ERS-K"]);
  assert.deepEqual(ids_({ ice_kw: 400, mguk_kw: 350, es_deploy_mj_per_lap: 13, es_harvest_mj_per_lap: 9, es_soc_window_mj: 4.5 }), ["REG-C-ES-SOC", "REG-C-ES-RECHARGE", "REG-C-ES-SOC"]);
  assert.deepEqual(ids_({ ice_kw: 900, mguk_kw: 350, es_deploy_mj_per_lap: 12.5, es_harvest_mj_per_lap: 8.5 }), ["REG-C-FUEL-FLOW"]);
  // the session limit (6.5 MJ in Silverstone qualifying) binds the lap's recharge, not the declared 8.5 MJ capability
  assert.deepEqual(regs.checkPU({ ice_kw: 400, mguk_kw: 350, es_deploy_mj_per_lap: 12.5, es_harvest_mj_per_lap: 8.5 }, { recharge_limit_mj: 6.5 }).map(v => v.id), []);
  assert.deepEqual(regs.checkPU({ ice_kw: 400, mguk_kw: 350, es_deploy_mj_per_lap: 12.5, es_harvest_mj_per_lap: 8.5 }, { recharge_limit_mj: 6.5, harvested_mj: 6.4 }).map(v => v.id), []);
  assert.deepEqual(regs.checkPU({ ice_kw: 400, mguk_kw: 350, es_deploy_mj_per_lap: 12.5, es_harvest_mj_per_lap: 8.5 }, { recharge_limit_mj: 6.5, harvested_mj: 6.9 }).map(v => v.id), ["REG-C-ES-RECHARGE"]);
  // the lap sim's own regulation constants and its ERS-K taper (C5.2.7-C5.2.10)
  assert.equal(lapsim.REGS.mguk_max_kw, 350); assert.equal(lapsim.REGS.es_soc_window_mj, 4); assert.equal(lapsim.REGS.recharge_max_mj, 8.5);
  for (let v = 0; v <= 360; v += 0.5) for (const ot of [false, true]) {
    const want = Math.max(0, ot ? (v < 355 ? 7100 - 20 * v : 0) : v < 340 ? 1800 - 5 * v : v < 345 ? 6900 - 20 * v : 0);
    assert.ok(Math.abs(Math.min(350, Math.max(0, lapsim.mgukTaperKw(v, ot))) - Math.min(350, want)) < 1e-9, "taper at " + v + " km/h, overtake " + ot);
    assert.equal(regs.mgukLimitKw(v, ot), Math.min(350, want));
  }
});

test("the scorer never scores an illegal car: bench legality = regs.check, illegal gets no score", () => {
  const list = samples(99).filter((_, i) => i % 9 === 0);
  let legal = 0;
  for (const [name, d] of list) {
    const r = bench.bench(d), v = regs.check(d);
    if (!design.validate(d).ok) { assert.equal(r.legal, false); continue; }
    assert.equal(r.legal, v.length === 0, name); assert.deepEqual(r.violations.map(x => x.id), v.map(x => x.id), name);
    if (!r.legal) { assert.equal(r.score, null, name); assert.deepEqual(r.circuits, {}, name); } else { legal++; assert.equal(typeof r.score, "number"); }
  }
  assert.ok(legal > 3, "some legal designs were scored: " + legal);
});

test("the optimiser never keeps an illegal car: replayed lineage (physics bench, weekend objective), every kept and shown-legal row re-checked", () => {
  const res = optimize.optimize({ gens: 14, seed: 11, lambda: 6, sigma: 0.15 });
  let cur = design.clone(res.baseline), kept = 0;
  assert.deepEqual(regs.check(cur), []);
  for (const row of res.lineage) {
    const applied = design.applyChanges(cur, row.changes.map(c => ({ part: c.part, param: c.param, to: c.to }))).design;
    if (row.legal) { assert.deepEqual(regs.check(applied).map(v => v.id), [], "gen " + row.gen + " shown-legal candidate"); assert.equal(oracle(applied).ids.size, 0, "oracle, gen " + row.gen); }
    for (const c of row.candidates) if (c.legal) assert.equal(typeof c.score, "number"); else assert.equal(c.score, null, "an illegal candidate has no score");
    if (row.kept) { kept++; cur = applied; assert.equal(row.result.legal, true); }
  }
  assert.deepEqual(design.diff(cur, res.best), [], "the replayed lineage reproduces the best design");
  assert.deepEqual(regs.check(res.best), []); assert.equal(oracle(res.best).ids.size, 0); assert.equal(res.best_result.legal, true);
  assert.ok(kept > 0, "the run kept something");
  // an adversarial proposer that only proposes illegal moves never moves the car
  const bad = optimize.optimize({ gens: 4, seed: 2, proposer: { name: "illegal", propose: () => [{ changes: [{ part: "front_wing", param: "aoa_deg", to: 40 }] }, { changes: [{ part: "rear_wing", param: "elements", to: 1 }, { part: "rear_wing", param: "sm_delta_deg", to: 0 }] }, { changes: [{ part: "floor", param: "width_mm", to: 1700 }] }] } });
  assert.equal(bad.kept, 0); assert.equal(bad.best.id, "baseline");
  for (const row of bad.lineage) for (const c of row.candidates) { assert.equal(c.legal, false); assert.ok(c.violations.length > 0); }
});

// ---------------------------------------------------------------- known conflicts in files this checklist does not own (todo: they
// do not fail the suite; each names the fix requested in docs/concept/FIA_CHECKLIST.md "Fixes requested")
test("C10.10.1: the PhysicalCar track widths and the mass sheet's wheel rows fit the suspension-width limit (front ≤ 1.540 m, rear ≤ 1.470 m)", () => {
  assert.deepEqual(regs.checkPhysical(physical.physical(B)), []);
  assert.deepEqual(regs.checkPhysical(physical.physical(design.baseline("redbull"))), []);
  const rows = design.facts(B).mass.parts;
  for (const id of ["wheels_front", "wheels_rear"]) assert.ok(typeof rows.find(r => r.id === id).y_mm === "number", id + " carries y_mm");
  assert.ok(!regs.check(B).some(v => v.id === "REG-C-SUSP-WIDTH"));
  const f = design.facts(B); f.mass.parts.find(r => r.id === "wheels_front").y_mm = 790;   // the v1 wheel position
  assert.deepEqual(regs.checkFacts(f).filter(v => v.id === "REG-C-SUSP-WIDTH").map(v => v.part), ["wheels_front"]);
});
test("C3.5.1(a), App. C2 §4.5/§4.11: the floor throat parameter fits the RV-FLOOR-BODY roof (Z ≤ 75 mm between XF=1775 and XR=−600)", () => {
  assert.ok(parts.BY_ID.floor.params.throat_mm.max <= regs.FLOOR_ROOF_Z);
  assert.equal(regs.BY_ID["REG-C-FLOOR-ROOF"].kind, "max");
  const f = design.facts(B); f.floor = Object.assign({}, f.floor, { throat_mm: 76 });
  assert.ok(regs.checkFacts(f).some(v => v.id === "REG-C-FLOOR-ROOF"));
  // a v1 design (throat 80-130 "above Z=0") maps onto v2 by × 0.6 with the same aero; above 125 it is clamped to the roof
  const v1 = design.clone(B); v1.params.floor.throat_mm = 100; const m = design.migrate(v1);
  assert.equal(m.params.floor.throat_mm, 60); assert.deepEqual(regs.check(m), []);
  v1.params.floor.throat_mm = 129; assert.equal(design.migrate(v1).params.floor.throat_mm, 75);
});
test("checkPhysical bites: tracks past C10.10.1 and PU figures past C5.2 are named", () => {
  const pc = JSON.parse(JSON.stringify(physical.physical(B)));
  pc.track_front_m = 1.54; pc.track_rear_m = 1.47; assert.deepEqual(regs.checkPhysical(pc), [], "the C10.10.1 maxima themselves are legal");
  pc.track_front_m = 1.6; pc.track_rear_m = 1.55; assert.deepEqual(regs.checkPhysical(pc).map(v => v.field), ["track_front_m", "track_rear_m"]);
  pc.track_front_m = 1.5; pc.track_rear_m = 1.45; pc.pu.mguk_kw = 400; assert.deepEqual(regs.checkPhysical(pc).map(v => v.id), ["REG-C-ERS-K"]);
});

test("checklist files never use the banned words (EVAL_GUARDRAILS G-HON-02)", () => {
  const fs = require("fs"), path = require("path");
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated", "aerodynamically" + " tested"].join("|"), "i");
  for (const f of ["docs/concept/FIA_CHECKLIST.md", "concept/regs.js", "test/concept-regs-checklist.test.js"]) {
    const m = banned.exec(fs.readFileSync(path.join(__dirname, "..", f), "utf8")); assert.equal(m, null, f + ": " + (m && m[0]));
  }
});
