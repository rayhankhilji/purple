// PURPLE - scenario generator for example collection and the exam (F-03, ARCHITECTURE §4.5, §6 step 1).
// Random legal perturbations of 1-2 setup parameters around the baseline; mixed conditions. Everything takes the seeded rng.
const aero = require("../lab/aero.js");
// step menus per parameter (whole units; ers in tenths): big enough to move the lap, small enough to stay in the legal range
const STEPS = { front_wing_deg: [2, 3, 4, 5, 6, 8], rear_wing_deg: [2, 3, 4, 5, 6, 8], ride_height_mm: [2, 3, 4, 5, 6, 8], brake_bias_pct: [1, 2, 3], ers_deploy: [0.1, 0.2, 0.3] };
const MIX = { two_params: 0.4, dry: 0.70, wind: 0.20, wind_ms: [4, 10] };   // 70 % dry/no wind, 20 % wind 4-10 m/s, 10 % wet (ROADMAP P0.T6)
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const quant = (k, v) => { const r = aero.RANGES[k]; return +(Math.round(v / r.step) * r.step).toFixed(r.step < 1 ? 1 : 0); };
// one candidate: 1 or 2 parameters moved, clamped to the regulation range, never equal to the baseline, legal under td01
function perturb(baseline, rng, opts) {
  for (let tries = 0; tries < 50; tries++) {
    const keys = aero.KEYS.slice(), chosen = [pick(rng, keys)];
    if (rng() < MIX.two_params) { const rest = keys.filter(k => k !== chosen[0]); chosen.push(pick(rng, rest)); }
    const c = Object.assign({}, baseline);
    for (const k of chosen) { const r = aero.RANGES[k], sign = rng() < 0.5 ? -1 : 1; c[k] = quant(k, Math.min(r.max, Math.max(r.min, baseline[k] + sign * pick(rng, STEPS[k])))); }
    if (aero.KEYS.every(k => c[k] === baseline[k])) continue;
    if (aero.violations(c, opts).length) continue;
    return c;
  }
  throw new Error("scenarios.perturb: no legal candidate found");
}
function conditions(rng, circuit) {
  const u = rng();
  if (u < MIX.dry) return { circuit, wet: false, wind_ms: 0, wind_from_deg: 0 };
  if (u < MIX.dry + MIX.wind) return { circuit, wet: false, wind_ms: Math.round(MIX.wind_ms[0] + rng() * (MIX.wind_ms[1] - MIX.wind_ms[0])), wind_from_deg: Math.round(rng() * 36) * 10 % 360 };
  return { circuit, wet: true, wind_ms: 0, wind_from_deg: 0 };
}
function generate(rng, opts) {
  const circuit = opts.circuit || "silverstone", baseline = opts.baseline || aero.BASELINE;
  return { candidate: perturb(baseline, rng, { td01: !!opts.td01 }), conditions: conditions(rng, circuit) };
}
module.exports = { STEPS, MIX, perturb, conditions, generate };
