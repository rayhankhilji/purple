// PURPLE CONCEPT - more-factors v1 (docs/concept/FACTORS.md): gear ratios (final drive + spacing), roll stiffness split, heave
// rate and brake balance. Each reaches the sim through a stated mechanism with the documented sign, is checked against the FIA
// 2026 rules it touches, leaves the calibrated baselines unchanged, and is non-additive where the physics couples it.
// Lap-level signs are read with the sim's smooth "marginal" energy plan: the default "regulated" plan can jump by ~0.07 s
// between nearby cars (FACTORS.md §4), which would drown a small mechanism. Capacity-level checks (sim.capacity) have no
// energy plan at all.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const design = require("../concept/design.js"), parts = require("../concept/parts.js"), aeromap = require("../concept/aeromap.js");
const physical = require("../concept/physical.js"), regs = require("../concept/regs.js"), sim = require("../concept/sim/index.js");
const lapsim = require("../concept/sim/lapsim.js"), F = require("../concept/surrogate/features.js");
const ROOT = path.join(__dirname, "..");

const RB = design.baseline({ team: "redbull" }), GEN = design.baseline();
const ap = (d, ch) => design.applyChanges(d, ch.map(([part, param, to]) => ({ part, param, to }))).design;
const PC = d => physical.physical(d);
const lapR = d => sim.simulateLap(PC(d), "silverstone").lap_s;
const lapM = d => sim.simulateLap(PC(d), "silverstone", null, { strategy: "marginal" }).lap_s;
const ids = d => regs.check(d).map(v => v.id);
const NEW = ["gearbox.top_kmh", "gearbox.step", "setup.roll_front", "setup.heave_n_mm", "setup.brake_bias"];

test("baselines: physical(baseline) carries the anchor's gearing, lltd, 3500 N/mm and bias = its reference; laps 88.100 / 88.745 s (refit, RB22 sheet inputs)", () => {
  for (const [d, team, want] of [[GEN, null, 88.100], [RB, "redbull", 88.745]]) {
    const pc = PC(d), A = physical.anchor(team);
    assert.deepEqual(pc.gearing.rpm_per_kmh, A.gearing.rpm_per_kmh); assert.equal(pc.gearing.shift_rpm, A.gearing.shift_rpm);
    assert.equal(pc.suspension.lltd_front, A.suspension ? A.suspension.lltd_front : pc.weight_dist_front); assert.equal(pc.aero.heave_n_per_mm, 3500); assert.equal(pc.aero.dyn_compression_mm, 5);
    assert.equal(pc.brakes.bias_front, pc.brakes.bias_ref);
    assert.ok(Math.abs(lapR(d) - want) < 0.0005, (team || "generic") + " " + lapR(d));
  }
  // every new parameter is in the catalogue with a base on its step grid, and the baseline sits on it
  for (const k of NEW) { const [part, param] = k.split("."), s = parts.BY_ID[part].params[param]; assert.ok(s && Number.isInteger(+((s.base - s.min) / s.step).toFixed(9)), k); assert.equal(GEN.params[part][param], s.base); }
});

test("RB22 data sheet inputs: 775 kg, the eight ratios measured on all RB laps, the sheet's 55 % roll split; the fit's elastic share matches physical()", () => {
  const A = physical.anchor("redbull"), fit = require("../concept/sim/fit.js");
  assert.equal(A.mass_kg, 775);
  const want = [8.417, 10.546, 12.971, 15.636, 18.605, 21.838, 25, 27.975].map(k => 1000 / k);
  A.gearing.rpm_per_kmh.forEach((k, i) => assert.ok(Math.abs(k - want[i]) < 1e-3, "gear " + (i + 1) + " " + k));
  assert.equal(A.suspension.roll_stiffness_front, 0.55);
  const e = PC(RB).suspension.elastic_share; assert.ok(Math.abs(A.suspension.lltd_front - (0.45 + 0.10 * e)) < 0.002, "anchor lltd " + A.suspension.lltd_front + " vs elastic " + e);
  assert.equal(physical.anchor(null).suspension, undefined, "the generic anchor declares no split (lltd = its weight split)");
  // the team fit is made with those inputs merged in, so the RB22 still laps HAD's 88.746 s
  assert.ok(Math.abs(sim.simulateLap(A, "silverstone").lap_s - 88.746) < 0.01);
  assert.ok(fit.derivedOverrides("redbull").gearing.source.includes("kmh_per_1000rpm_by_gear_all_RB_laps"));
});

test("smoothness in mass (regulated plan): monotone over ±4 kg in 0.5 kg steps, ±2 kg of fuel symmetric (no local peak at the baseline)", () => {
  for (const team of ["redbull", null]) {
    const A = physical.anchor(team), laps = [];
    for (let dm = -4; dm <= 4; dm += 0.5) { const c = JSON.parse(JSON.stringify(A)); c.mass_kg += dm; laps.push(sim.simulateLap(c, "silverstone").lap_s); }
    for (let i = 1; i < laps.length; i++) assert.ok(laps[i] >= laps[i - 1] - 0.001, (team || "generic") + " not monotone: " + laps.join(" "));
    const slope = (laps[laps.length - 1] - laps[0]) / 8; assert.ok(slope > 0.012 && slope < 0.04, "slope " + slope);
    const L = f => sim.simulateLap(A, "silverstone", { fuel_kg: f }).lap_s, lo = L(A.fuel_kg - 2) - L(A.fuel_kg), hi = L(A.fuel_kg + 2) - L(A.fuel_kg);
    assert.ok(lo < -0.02 && hi > 0.02 && Math.abs(lo + hi) < 0.01, (team || "generic") + " fuel ±2 kg: " + lo + " / " + hi);
  }
});

test("designs saved before more-factors v1 mean the baseline set-up: physical() reads the base, migrate() fills it in, validate() then passes", () => {
  const old = design.clone(RB); delete old.params.gearbox.top_kmh; delete old.params.gearbox.step; delete old.params.setup;
  assert.equal(design.validate(old).ok, false);
  assert.deepEqual(PC(old).gearing, PC(RB).gearing); assert.equal(lapR(old), lapR(RB));
  const m = design.migrate(old); assert.equal(design.validate(m).ok, true); assert.deepEqual(m.params, RB.params);
  assert.equal(m.migrated.length, 5);
  assert.deepEqual(design.migrate(RB).params, RB.params);
});

test("gearing: the final drive scales all eight ratios, the step spreads them about 8th; C9.8.2 and the season top-speed rule", () => {
  const g0 = PC(RB).gearing.rpm_per_kmh, gLong = PC(ap(RB, [["gearbox", "top_kmh", 370]])).gearing.rpm_per_kmh, gWide = PC(ap(RB, [["gearbox", "step", 1.18]])).gearing.rpm_per_kmh;
  for (let i = 0; i < 8; i++) assert.ok(Math.abs(gLong[i] / g0[i] - 336 / 370) < 1e-3, "uniform final drive, gear " + (i + 1));
  assert.ok(Math.abs(gWide[7] - g0[7]) < 1e-9 && gWide[0] > g0[0] && Math.abs(gWide[0] / g0[0] - Math.pow(1.18 / 1.156, 7)) < 1e-3, "spread about 8th");
  // design-level ratio set: RB22 reference (C9.6.2 nominated set)
  design.facts(RB).gearing.rpm_per_kmh.forEach((v, i) => assert.ok(Math.abs(v - parts.GEARS.ref_rpm_per_kmh[i]) < 1e-9));
  // PKG-GEAR-TOP: 8th at the 13 000 rpm limiter must reach 333.5 km/h (RB22 Monza race trap): 13000 / (35.746 · 336 / top) ≥ 333.5 → top ≥ 308.2
  assert.ok(ids(ap(RB, [["gearbox", "top_kmh", 308]])).includes("PKG-GEAR-TOP")); assert.deepEqual(ids(ap(RB, [["gearbox", "top_kmh", 309]])), []);
  // C9.8.2: every gear ≥ 80 km/h at 15 000 rpm (≤ 187.5 rpm per km/h): the measured 1st (118.8) leaves room, but a short final
  // drive with a wide box breaks it inside the domain
  const f = design.facts(RB); f.gearing = { rpm_per_kmh: [190].concat(f.gearing.rpm_per_kmh.slice(1)) };
  assert.ok(regs.checkFacts(f).some(v => v.id === "REG-C-GEAR-80KMH" && v.article === "C9.8.2"));
  const corner = ap(RB, [["gearbox", "top_kmh", 290], ["gearbox", "step", 1.24]]);
  assert.ok(design.facts(corner).gearing.rpm_per_kmh[0] > 187.5 && ids(corner).includes("REG-C-GEAR-80KMH"));
});

test("gearing in the sim: the rev limiter caps the top speed, and over-revving above the shift rpm costs ICE power", () => {
  // a top gear short enough to reach the limiter on the Hangar straight (illegal by PKG-GEAR-TOP; the sim laps it for this check)
  const short = ap(RB, [["gearbox", "top_kmh", 290]]), pcS = PC(short), k8 = pcS.gearing.rpm_per_kmh[7];
  const r = sim.simulateLap(pcS, "silverstone", null, { trace: true }), vLim = lapsim.MODEL.rev.limit_rpm / k8;
  assert.ok(r.vmax_kmh <= vLim + 0.5, "vmax " + r.vmax_kmh + " at a " + vLim.toFixed(1) + " km/h limiter");
  assert.ok(Math.max(...r.trace.rpm) <= lapsim.MODEL.rev.limit_rpm + 1 && Math.max(...r.trace.rpm) > pcS.gearing.shift_rpm, "runs above the shift rpm, never past the limiter");
  // the same car without the limiter / over-rev model (an absent gearing switches both off) is faster on the straights
  const noGear = JSON.parse(JSON.stringify(pcS)); delete noGear.gearing;
  assert.ok(sim.simulateLap(noGear, "silverstone").vmax_kmh > r.vmax_kmh + 2);
  // the baseline gearing never reaches the shift rpm in 8th, so neither term touches the calibrated laps (tested above)
  const rb = sim.simulateLap(PC(RB), "silverstone", null, { trace: true }); assert.ok(Math.max(...rb.trace.rpm) <= PC(RB).gearing.shift_rpm);
});

test("interaction (gearing × drag): a lower-drag rear wing buys top speed only up to the limiter, so the two do not add", () => {
  // tyres held at the baseline's: the lower rear wing moves the aero balance outside the driver's window (difficulty v1,
  // concept/physical.js BALANCE_WINDOW), whose grip loss would lower the exit speeds before the straights; this test isolates drag
  const vmax = d => sim.simulateLap(Object.assign(PC(d), { tyres: PC(RB).tyres }), "silverstone").vmax_kmh;
  const gainAt = top => vmax(ap(RB, [["gearbox", "top_kmh", top], ["rear_wing", "aoa_deg", 14]])) - vmax(ap(RB, [["gearbox", "top_kmh", top]]));
  const free = gainAt(336), capped = gainAt(292);
  assert.ok(free > 3, "low-drag wing at the RB22 final drive: +" + free.toFixed(1) + " km/h");
  assert.ok(capped < 0.5 * free, "at a limiter-bound final drive the same wing gains only +" + capped.toFixed(1) + " km/h");
});

test("roll stiffness split: lltd = weight split + (share − reference) × elastic share; front grip and rear traction trade off", () => {
  const pc0 = PC(RB), pc1 = PC(ap(RB, [["setup", "roll_front", 50]]));
  assert.ok(pc0.suspension.elastic_share > 0.6 && pc0.suspension.elastic_share < 0.85, "elastic share " + pc0.suspension.elastic_share);
  assert.ok(Math.abs(pc1.suspension.lltd_front - (pc0.suspension.lltd_front - 0.05 * pc0.suspension.elastic_share)) < 1e-5);
  // the RB22 is front-limited at speed (aero balance 0.4415 < weight 0.45): less front transfer raises its lateral limit
  const ay = (pc, k) => sim.capacity(pc, k).ay_g;
  assert.ok(ay(pc1, 250) > ay(pc0, 250), "lateral limit at 250 km/h " + ay(pc1, 250) + " vs " + ay(pc0, 250));
  // lap (marginal plan): an interior optimum: 40 % beats the sheet's 55 % (front grip), 30 % loses to 40 % (rear traction: RK)
  const L55 = lapM(RB), L40 = lapM(ap(RB, [["setup", "roll_front", 40]])), L30 = lapM(ap(RB, [["setup", "roll_front", 30]])), L65 = lapM(ap(RB, [["setup", "roll_front", 65]]));
  assert.ok(L40 < L55 - 0.05 && L30 > L40 + 0.05 && L65 > L55 + 0.05, [L30, L40, L55, L65].join(" "));
});

test("interaction (roll split × aero balance): the best roll split moves with the front wing (the trim the sim used to lack)", () => {
  const ay = (d, k) => sim.capacity(PC(d), k).ay_g;
  const best = base => { let b = null; for (let x = 30; x <= 60; x += 2.5) { const v = ay(ap(base, [["setup", "roll_front", x]]), 220); if (!b || v > b[1]) b = [x, v]; } return b[0]; };
  const lowFw = best(ap(RB, [["front_wing", "aoa_deg", 22]])), hiFw = best(ap(RB, [["front_wing", "aoa_deg", 29]]));
  assert.ok(hiFw > lowFw, "more front wing -> more front roll stiffness wanted: " + lowFw + " -> " + hiFw);
});

test("heave rate: softer squats more (more ride-height downforce, less stall margin); stall rule binds with ride height", () => {
  const P = k => PC(ap(RB, [["setup", "heave_n_mm", k]])), soft = P(3000), base = PC(RB), stiff = P(6000);
  assert.ok(soft.aero.heave_n_per_mm < 3500 && stiff.aero.heave_n_per_mm > 3500);
  assert.ok(soft.aero.stall_margin_mm < base.aero.stall_margin_mm && stiff.aero.stall_margin_mm > base.aero.stall_margin_mm);
  // the sim's stall onset (as a squat) is geometric: unchanged by the springs; only how far the car squats changes
  const on = pc => lapsim.platform(pc).onset; assert.ok(Math.abs(on(soft) - on(base)) < 1e-3 && Math.abs(on(stiff) - on(base)) < 1e-3, on(soft) + " " + on(base) + " " + on(stiff));   // PhysicalCar rounds to 1e-4
  const qa = 0.5 * 1.17 * 80 * 80 * 5.3;   // N, ≈ 290 km/h Corner Mode
  assert.ok(lapsim.platform(soft).factorAt(qa) > lapsim.platform(base).factorAt(qa) && lapsim.platform(base).factorAt(qa) > lapsim.platform(stiff).factorAt(qa));
  assert.equal(P(7000).aero.heave_n_per_mm, 7000);   // whole-car stiffness: the anchor's 3500 × the design's change
  // lap (marginal plan): monotone in the unstalled range, softer is faster
  const laps = [3000, 3500, 4500, 6000].map(k => lapM(ap(RB, [["setup", "heave_n_mm", k]])));
  for (let i = 1; i < laps.length; i++) assert.ok(laps[i] > laps[i - 1], laps.join(" "));
  // legality AND: soft springs or a lower car alone are legal, together they break PKG-FLOOR-STALL
  assert.deepEqual(ids(ap(RB, [["setup", "heave_n_mm", 3000]])), []); assert.deepEqual(ids(ap(RB, [["floor", "ride_height_mm", 34]])), []);
  assert.ok(ids(ap(RB, [["setup", "heave_n_mm", 3000], ["floor", "ride_height_mm", 34]])).includes("PKG-FLOOR-STALL"));
  // and a stiff platform lets the car run lower: ride height 32.5 is illegal on the sheet's 3500 N/mm, legal at 7000 N/mm
  assert.ok(ids(ap(RB, [["floor", "ride_height_mm", 32.5]])).includes("PKG-FLOOR-STALL"));
  assert.deepEqual(ids(ap(RB, [["floor", "ride_height_mm", 32.5], ["setup", "heave_n_mm", 7000]])), []);
});

test("brake balance: a fixed front share brakes at min(front cap / b, rear cap / (1 − b)), relative to the reference; harvest follows the rear share", () => {
  const pc = b => { const c = PC(RB); c.brakes.bias_front = b; return c; }, bg = (c, k) => sim.capacity(c, k).brake_g;
  assert.equal(bg(pc(0.57), 120), bg(PC(RB), 120));
  // below the 5 g mechanical cap the best fixed balance for this car is ≈ 59 % front; far from it the car brakes worse
  assert.ok(bg(pc(0.59), 120) > bg(pc(0.57), 120) && bg(pc(0.57), 120) > bg(pc(0.66), 120) && bg(pc(0.57), 120) > bg(pc(0.50), 120));
  assert.ok(bg(pc(0.50), 120) / bg(pc(0.57), 120) < 0.95);
  // at 300 km/h the brake system's 5 g cap binds whatever the balance
  assert.equal(bg(pc(0.62), 300), bg(pc(0.57), 300));
  // lap (marginal plan): a front-heavy balance is clearly slower; the rear side is flat within ~0.01 s down to 50 % (the 5 g cap and
  // the larger rear harvest share offset the lost front capacity)
  const L = lapM(RB); assert.ok(lapM(ap(RB, [["setup", "brake_bias", 62.75]])) > L + 0.05 && Math.abs(lapM(ap(RB, [["setup", "brake_bias", 51.25]])) - L) < 0.03);
});

test("interaction (brake balance × CoG height): a higher CoG moves load forward under braking, so the best balance moves forward", () => {
  const best = h => { let b = null; for (let x = 0.5; x <= 0.7; x += 0.005) { const c = PC(RB); c.cog_height_m = h; c.brakes.bias_front = x; const g = sim.capacity(c, 120).brake_g; if (!b || g > b[1] + 1e-12) b = [x, g]; } return b[0]; };
  assert.ok(best(0.36) > best(0.27), best(0.27) + " -> " + best(0.36));
});

test("determinism, speed, simKey inputs and the surrogate's raw round-trip for the new fields", () => {
  const d = ap(RB, [["gearbox", "top_kmh", 350], ["gearbox", "step", 1.16], ["setup", "roll_front", 48], ["setup", "heave_n_mm", 4000], ["setup", "brake_bias", 58]]);
  const pc = PC(d); assert.equal(JSON.stringify(sim.simulateLap(pc, "silverstone")), JSON.stringify(sim.simulateLap(pc, "silverstone")));
  for (let i = 0; i < 3; i++) sim.simulateLap(pc, "silverstone");
  const t0 = Date.now(); for (let i = 0; i < 5; i++) sim.simulateLap(pc, "silverstone"); assert.ok((Date.now() - t0) / 5 < 60, "lap time " + (Date.now() - t0) / 5 + " ms");
  // the surrogate's raw vector reads every new input and writes it back
  const x = F.rawVector(pc), back = F.fromRaw(x, PC(RB)), y = F.rawVector(back);
  for (const n of ["lltd_offset", "heave_n_per_mm", "brake_bias_front", "gear_top_kmh", "gear_step"]) { const i = F.RI[n]; assert.ok(Math.abs(x[i] - y[i]) < 1e-9 * (1 + Math.abs(x[i])), n + " " + x[i] + " vs " + y[i]); }
  assert.ok(Math.abs(x[F.RI.lltd_offset]) > 0.01 && x[F.RI.heave_n_per_mm] > 3500 && x[F.RI.brake_bias_front] === 0.58);
  for (let i = 0; i < 8; i++) assert.ok(Math.abs(back.gearing.rpm_per_kmh[i] - pc.gearing.rpm_per_kmh[i]) < 1e-3);
});

test("docs: FACTORS.md lists every new parameter with its article and keeps the honesty rules", () => {
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated"].join("|"), "i");
  const doc = fs.readFileSync(path.join(ROOT, "docs/concept/FACTORS.md"), "utf8");
  assert.equal(banned.exec(doc), null);
  for (const k of NEW) assert.ok(doc.includes(k), "FACTORS.md row for " + k);
  for (const a of ["C9.6", "C9.8.2", "C10.2", "C11.1", "C9.9.1"]) assert.ok(doc.includes(a), "FACTORS.md cites " + a);
  for (const r of regs.SETUP_RULES) assert.ok(doc.includes(r.id), "FACTORS.md names " + r.id);
});
