// PURPLE ENGINE v2 - the SUBSPACE a designer decision opens (docs/concept/ENGINE_V2.md §3).
// Mubit's proposal names 1-3 parameters; the engine turns it into a small search space: the proposed parameters plus the parameters
// physically coupled to them (a rear-wing change opens the rest of the rear wing, the diffuser and the front-wing setting that
// trims the aero balance). The parameter list is read from concept/parts.js PARAMS every time (through concept/campaign/space.js
// VARS, which adds the single-number FIA limits), so a new part or parameter needs no change here:
//   - a DISCRETE parameter (integer with ≤ MAX_LEVELS values, e.g. profile volumes or a concept family 0/1/2) is ENUMERATED: every
//     legal-box value appears, stratified across the variants;
//   - a CONTINUOUS parameter is SAMPLED in a window: around the proposal's target for a proposed parameter, around the branch
//     head's value for a coupled one.
// variant(axes, head, seed, i) is a pure function of its arguments (seeded per index), so a variant can be regenerated anywhere
// (worker threads, a resumed run) from (axes, seed, i). Variant 0 is the proposal exactly as proposed.
"use strict";
const parts = require("../parts.js"), space = require("../campaign/space.js");

const MAX_DIMS = 8, MAX_LEVELS = 12, MAX_COMBOS = 64;
// part -> the parts / parameters a change to it couples to (aero balance, flow continuity, packaging). Names that do not exist in
// concept/parts.js are ignored, so the table can list parts other helpers are adding (nose, cooling, engine_cover, suspension).
const COUPLING = {
  rear_wing: ["rear_wing", "diffuser.expansion_deg", "front_wing.aoa_deg", "engine_cover"],
  front_wing: ["front_wing", "nose", "rear_wing.aoa_deg", "floor.ride_height_mm"],
  nose: ["nose", "front_wing"],
  floor: ["floor", "diffuser", "rear_wing.aoa_deg", "suspension"],
  diffuser: ["diffuser", "floor", "rear_wing.aoa_deg"],
  sidepods: ["sidepods", "cooling", "engine_cover", "floor.width_mm"],
  cooling: ["cooling", "sidepods", "engine_cover"],
  engine_cover: ["engine_cover", "sidepods", "cooling", "rear_wing.endplate_top_mm"],
  layout: ["layout", "survival_cell", "ballast.x_frac"],
  survival_cell: ["survival_cell", "layout", "ballast.x_frac"],
  ballast: ["ballast", "layout.wheelbase_mm"],
  suspension: ["suspension", "front_suspension", "rear_suspension", "floor.ride_height_mm"],
  front_suspension: ["front_suspension", "suspension", "floor.ride_height_mm"],
  rear_suspension: ["rear_suspension", "suspension", "floor.ride_height_mm"],
};

const keyOf = s => s.part + "." + s.param;
// the live parameter catalogue: concept/parts.js PARAMS joined with the FIA-tightened box of concept/campaign/space.js
function catalogue() {
  const vars = new Map(space.VARS.map(v => [v.key, v]));
  return parts.PARAMS.map(s => {
    const v = vars.get(keyOf(s)) || { lo: s.min, hi: s.max };
    const levels = s.int || s.discrete || Array.isArray(s.options) ? Math.round((v.hi - v.lo) / s.step) + 1 : Infinity;
    const fam = parts.CONCEPTS && parts.CONCEPTS[keyOf(s)];   // redesigns v1 (docs/concept/REDESIGNS.md §1): concept family labels
    const options = fam && Array.isArray(fam.codes) ? fam.codes.map(c => c.id || c.label) : s.options || s.labels || null;
    return { key: keyOf(s), part: s.part, param: s.param, lo: v.lo, hi: v.hi, step: s.step, int: !!s.int, discrete: levels <= MAX_LEVELS, levels, unit: s.unit || "", label: s.label || keyOf(s), options, concept: !!fam };
  });
}
function expandGroup(name, cat) {
  if (name.includes(".")) return cat.filter(c => c.key === name);
  return cat.filter(c => c.part === name);
}
const r6 = v => +(+v).toFixed(6);
const levelsOf = c => { const out = []; for (let k = 0; k < c.levels && out.length <= MAX_LEVELS; k++) out.push(r6(c.lo + k * c.step)); return out; };

// expand(head, changes, opts) -> { axes: [axis], proposed: [key], coupled: [key], combos, dims }
//   axis = { key, part, param, role: "proposed" | "coupled", discrete, values?: [n], lo, hi, a, b (window), step, head, target }
function expand(head, changes, opts) {
  opts = opts || {};
  const cat = catalogue(), byKey = new Map(cat.map(c => [c.key, c]));
  const maxDims = opts.maxDims || MAX_DIMS;
  const proposed = [], coupled = [];
  for (const ch of changes || []) { const k = ch.part + "." + ch.param; if (byKey.has(k) && !proposed.includes(k)) proposed.push(k); }
  for (const k of proposed) {
    const part = k.split(".")[0];
    for (const g of COUPLING[part] || [part]) for (const c of expandGroup(g, cat)) if (!proposed.includes(c.key) && !coupled.includes(c.key)) coupled.push(c.key);
  }
  const keys = proposed.concat(coupled).slice(0, Math.max(maxDims, proposed.length));
  const axes = keys.map(k => {
    const c = byKey.get(k), [part, param] = k.split("."), h = head.params[part][param];
    const ch = (changes || []).find(x => x.part + "." + x.param === k), target = ch ? Math.min(c.hi, Math.max(c.lo, +ch.to)) : null;
    const role = proposed.includes(k) ? "proposed" : "coupled";
    const ax = { key: k, part, param, role, discrete: c.discrete, lo: c.lo, hi: c.hi, step: c.step, head: h, target, label: c.label, unit: c.unit, options: c.options };
    if (c.discrete) { ax.values = levelsOf(c); if (!ax.values.some(v => Math.abs(v - h) < 1e-9)) ax.values.push(r6(h)); ax.values.sort((x, y) => x - y); }
    else {
      const w = c.hi - c.lo;
      if (role === "proposed") { const half = Math.max(Math.abs((target == null ? h : target) - h), 3 * c.step, 0.06 * w); ax.a = Math.max(c.lo, Math.min(h, target == null ? h : target) - half); ax.b = Math.min(c.hi, Math.max(h, target == null ? h : target) + half); }
      else { const half = Math.max(3 * c.step, 0.08 * w); ax.a = Math.max(c.lo, h - half); ax.b = Math.min(c.hi, h + half); }
      if (!(ax.b > ax.a)) { ax.a = Math.min(h, c.lo); ax.b = Math.max(h, c.hi); }
    }
    return ax;
  });
  const disc = axes.filter(a => a.discrete);
  let combos = 1; for (const a of disc) combos *= a.values.length;
  return { axes, proposed: proposed.slice(), coupled: keys.filter(k => !proposed.includes(k)), combos, dims: axes.length, discrete: disc.map(a => a.key) };
}

// a small, fast, seeded rng per (seed, i): splitmix32
function rngFor(seed, i) {
  let s = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((i | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  return () => { s = (s + 0x9e3779b9) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0; z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0; return ((z ^ (z >>> 16)) >>> 0) / 4294967296; };
}
const gauss = rng => { const u = Math.max(rng(), 1e-12), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const quant = (a, v) => { const q = Math.round((v - a.lo) / a.step) * a.step + a.lo; return r6(Math.min(a.hi, Math.max(a.lo, q))); };

// variant(sub, seed, i) -> [{ part, param, to }] (only the parameters that differ from the head)
//   i = 0: the proposal exactly as proposed (coupled parameters at the head's values)
//   discrete axes: stratified over every combination (i mod combos) when there are ≤ MAX_COMBOS of them, else drawn
//   continuous proposed axes: half the draws gaussian around the target (σ = window / 4), half uniform in the window
//   continuous coupled axes: 40 % stay at the head's value, else uniform in the window
function variant(sub, seed, i) {
  const out = [];
  const push = (a, v) => { if (Math.abs(v - a.head) > 1e-9) out.push({ part: a.part, param: a.param, to: v }); };
  if (i === 0) { for (const a of sub.axes) if (a.role === "proposed" && a.target != null) push(a, a.discrete ? nearest(a.values, a.target) : quant(a, a.target)); return out; }
  const rng = rngFor(seed, i);
  let ci = sub.combos <= MAX_COMBOS ? (i - 1) % sub.combos : -1;
  for (const a of sub.axes) {
    let v;
    if (a.discrete) {
      if (ci >= 0) { const n = a.values.length; v = a.values[ci % n]; ci = Math.floor(ci / n); }
      else v = a.values[Math.floor(rng() * a.values.length) % a.values.length];
    } else if (a.role === "proposed") {
      const centre = a.target == null ? a.head : a.target, w = a.b - a.a;
      v = rng() < 0.5 ? centre + gauss(rng) * w / 4 : a.a + rng() * w;
      v = quant(a, Math.min(a.b, Math.max(a.a, v)));
    } else {
      v = rng() < 0.4 ? a.head : quant(a, a.a + rng() * (a.b - a.a));
    }
    push(a, v);
  }
  return out;
}
function nearest(values, t) { let best = values[0]; for (const v of values) if (Math.abs(v - t) < Math.abs(best - t)) best = v; return best; }

// describe the subspace in one line for the UI / logs: "rear_wing.aoa_deg* [17-23] · rear_wing.elements {2,3} · diffuser..."
function describe(sub) {
  return sub.axes.map(a => a.key + (a.role === "proposed" ? "*" : "") + " " + (a.discrete ? "{" + a.values.join(",") + "}" : "[" + r6(a.a) + "-" + r6(a.b) + "]")).join(" · ");
}

module.exports = { COUPLING, MAX_DIMS, MAX_LEVELS, MAX_COMBOS, catalogue, expand, variant, describe, rngFor };
