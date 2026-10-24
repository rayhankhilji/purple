// PURPLE CONCEPT - regression tests for the reviewed core defects and reward-hacking guards (docs/concept/CONCEPT.md §2, §6).
// Each test fails on the pre-fix core (bb79cdb) and passes after.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("path"), { spawnSync } = require("child_process");
const EI = require("../server/game-headless.js").load();
const regs = require("../concept/regs.js"), parts = require("../concept/parts.js"), design = require("../concept/design.js"), aeromap = require("../concept/aeromap.js");
const physical = require("../concept/physical.js"), bench = require("../concept/bench.js"), optimize = require("../concept/optimize.js");
const B = design.baseline();
const withParam = (part, param, v) => { const d = design.clone(B); d.params[part][param] = v; return d; };
const withOverride = (part, o) => { const d = design.clone(B); d.overrides = Object.assign({}, d.overrides, { [part]: o }); return d; };
const ids = (d, opts) => regs.check(d, opts).map(v => v.id);
const factsIds = (mut, opts) => { const f = design.facts(B, opts); mut(f); return regs.checkFacts(f, opts).map(v => v.id); };

test("guard 1: ICE group and MGU-K minimum masses are checked as a C5.5.1 + C5.18.7 pair; the ICE group includes the TC", () => {
  const m = design.facts(B).mass;
  assert.equal(m.mguk_transmission, parts.PU.mguk_transmission);
  assert.equal(m.ice_group_kg, m.ice_kg + m.tc_kg);
  const pair = regs.MGUK_TRANSMISSION[m.mguk_transmission];
  assert.ok(m.ice_group_kg >= pair.ice_kg && m.mguk_kg >= pair.mguk_kg, "baseline satisfies its own option");
  for (const k of ["a", "b", "c"]) assert.equal(regs.MGUK_TRANSMISSION[k].ice_kg + regs.MGUK_TRANSMISSION[k].mguk_kg, 150, "option " + k);
  // option a needs MGU-K ≥ 20: 18 kg (only legal under option c) must fail, though it clears the lowest floor (16)
  assert.ok(ids(withOverride("pu_mguk", { mass_kg: 18 })).includes("REG-C-MGUK-MASS"));
  // the TC is inside the ICE group: an ICE part that alone clears 130 kg but whose group is under 130 is still legal only by the group
  assert.ok(!ids(B).includes("REG-C-ICE-MASS"));
  assert.ok(ids(withOverride("pu_ice", { mass_kg: 117 })).includes("REG-C-ICE-MASS"), "117 + 12 = 129 < 130");
  // other options, through the facts
  const opt = (o, ice, k) => factsIds(f => { f.mass.mguk_transmission = o; f.mass.ice_group_kg = ice; f.mass.mguk_kg = k; });
  assert.deepEqual(opt("b", 134, 16).filter(i => /ICE|MGUK/.test(i)), []);
  assert.deepEqual(opt("c", 132, 18).filter(i => /ICE|MGUK/.test(i)), []);
  assert.ok(opt("c", 131, 18).includes("REG-C-ICE-MASS"), "131 + 18 satisfies no option");
  assert.ok(opt("b", 132, 18).includes("REG-C-ICE-MASS"));
  assert.ok(opt("b", 134, 15).includes("REG-C-MGUK-MASS"));
  const unknown = opt("z", 140, 30); assert.ok(unknown.includes("REG-C-ICE-MASS") && unknown.includes("REG-C-MGUK-MASS"));
  assert.equal(opt("toString", 140, 30).includes("REG-C-ICE-MASS"), true, "inherited names are not options");
});

test("guard 2: C4.1 minimum and C4.2 axle split by session; the v0 reference car is built per session", () => {
  assert.equal(regs.minMass().kg, 770); assert.equal(regs.minMass("sprint_qualifying").kg, 770);
  for (const s of ["race", "sprint", "practice"]) assert.equal(regs.minMass(s).kg, 768, s);
  const fwd = withOverride("pu_es", { x_mm: 3300 });   // front axle under 0.44 × minimum
  assert.ok(ids(fwd).includes("REG-C-MASS-FRONT")); assert.ok(ids(fwd, { session: "sprint_qualifying" }).includes("REG-C-MASS-FRONT"));
  assert.ok(!ids(fwd, { session: "race" }).includes("REG-C-MASS-FRONT"), "C4.2 applies in (Sprint) Qualifying only");
  assert.ok(!ids(withOverride("pu_ice", { x_mm: 500 }), { session: "sprint" }).includes("REG-C-MASS-REAR"));
  // the mass sheet carries the session minimum; the PhysicalCar is the anchor car + the design's change from its own session baseline
  assert.equal(design.facts(B, { session: "race" }).mass.min_kg, 768); assert.ok(design.facts(B, { session: "race" }).mass.total_kg >= 768); assert.equal(design.facts(B, { session: "qualifying" }).mass.total_kg, 770);
  assert.equal(bench.refCar(undefined, "race").session, "race"); assert.equal(bench.refCar(undefined, "qualifying").session, "qualifying");
  assert.equal(bench.refCar(undefined, "race").mass_kg, bench.refCar(undefined, "qualifying").mass_kg, "each session's baseline maps onto the anchor");
  const r = bench.bench(B, { session: "race", sim: "v0" });
  assert.equal(r.legal, true); assert.equal(r.physical.session, "race"); assert.equal(r.mass.min_kg, 768);
  assert.equal(r.circuits.silverstone.v0.mass_ratio, 1, "the race-session baseline is its own reference");
  assert.deepEqual(r.circuits.silverstone.v0.multipliers, { df: 1, cd: 1, a0: 1, b0: 1 });
  assert.equal(r.circuits.silverstone.lap_s, 88.111);
});

test("guard 3: applyChanges / validate reject inherited names and non-finite values (LLM proposer safety)", () => {
  for (const [part, param] of [["rear_wing", "toString"], ["rear_wing", "constructor"], ["rear_wing", "hasOwnProperty"], ["rear_wing", "__proto__"], ["toString", "length"], ["constructor", "name"], ["__proto__", "x"]])
    assert.throws(() => design.applyChanges(B, [{ part, param, to: 1 }]), /unknown parameter/, part + "." + param);
  for (const to of [NaN, Infinity, -Infinity, null, undefined, "abc", "", true, {}, []])
    assert.throws(() => design.applyChanges(B, [{ part: "rear_wing", param: "aoa_deg", to }]), /non-finite/, String(to));
  assert.throws(() => design.applyChanges(B, [null]), /must be an object/);
  assert.equal(design.applyChanges(B, [{ part: "rear_wing", param: "aoa_deg", to: "21" }]).design.params.rear_wing.aoa_deg, 21);
  assert.equal(design.spec("rear_wing", "toString"), null); assert.equal(design.spec("hasOwnProperty", "x"), null);
  // validate: NaN anywhere, unknown parameter keys, unknown parts
  const nan = design.clone(B); nan.params.rear_wing.aoa_deg = NaN; assert.equal(design.validate(nan).ok, false);
  const extra = design.clone(B); extra.params.rear_wing.toString = 5; assert.equal(design.validate(extra).ok, false);
  const extraNaN = design.clone(B); extraNaN.params.floor.bogus = NaN; assert.match(design.validate(extraNaN).errors.join(";"), /unknown parameter floor\.bogus/);
  const part = design.clone(B); part.params.constructor = {}; assert.match(design.validate(part).errors.join(";"), /unknown part constructor/);
  assert.equal(regs.describeViolation("toString"), "toString");
  // through the loop: junk proposals are recorded as errors, never measured or kept
  const junk = optimize.optimize({ gens: 1, proposer: { name: "junk", propose: () => [{ changes: [{ part: "rear_wing", param: "toString", to: 1 }] }, { changes: [{ part: "rear_wing", param: "aoa_deg", to: NaN }] }, { changes: "nope" }] } });
  assert.equal(junk.kept, 0); assert.equal(junk.lineage[0].n_measured, 0);
  for (const c of junk.lineage[0].candidates) assert.ok(c.error, JSON.stringify(c));
});

test("guard 4: floor body width is capped by RV-FLOOR-BODY (App. C2 §4.9, Y ≤ 770)", () => {
  assert.equal(regs.FLOOR_BODY_MAX_Y, 770);
  assert.ok(B.params.floor.width_mm <= 1540);
  assert.ok(!ids(withParam("floor", "width_mm", 1540)).includes("REG-C-FLOOR-WIDTH"));
  assert.ok(ids(withParam("floor", "width_mm", 1550)).includes("REG-C-FLOOR-WIDTH"));
  assert.ok(parts.BY_ID.floor.params.width_mm.max > 1540, "the domain is wider than the rule (legality stays a visible check)");
});

test("guard 5: one vertical frame - wheels at the loaded radius above the ground, CoG height includes plank and ride height", () => {
  for (const rh of [25, 35, 50]) {
    const m = design.facts(withParam("floor", "ride_height_mm", rh)).mass, ground = parts.PLANK.thickness_mm + rh;
    for (const id of ["wheels_front", "wheels_rear", "brakes_front", "brakes_rear"]) {
      const z = m.parts.find(p => p.id === id).z_mm;
      assert.equal(z + ground, parts.WHEEL.tyre_radius_mm - parts.WHEEL.deflection_mm, id + " height above the ground at rh " + rh);
    }
    assert.ok(Math.abs(m.cog_height_mm - (m.cog_z_mm + ground)) <= 1, "cog height = Z-frame CoG + 10 mm plank + ride height");
    assert.equal(m.ground_z_mm, -ground);
  }
  const lo = design.facts(withParam("floor", "ride_height_mm", 30)).mass, hi = design.facts(withParam("floor", "ride_height_mm", 40)).mass;
  const rise = hi.cog_height_mm - lo.cog_height_mm; assert.ok(rise > 6 && rise < 10, "only the sprung mass rises: " + rise);
  const z0 = design.facts(B).mass.parts.find(p => p.id === "wheels_front").z_mm; assert.ok(Math.abs(z0 - 300) <= 2, "baseline axle at Z ≈ 300, got " + z0);
  // the PhysicalCar's CoG height is the anchor's plus the mass sheet's change from the baseline (same vertical frame)
  const pc = physical.physical(B), anchor = physical.anchor(null);
  if (anchor) assert.equal(pc.cog_height_m, anchor.cog_height_m);
  const up = physical.physical(withParam("floor", "ride_height_mm", 40)), dz = design.facts(withParam("floor", "ride_height_mm", 40)).mass.cog_height_mm - design.facts(B).mass.cog_height_mm;
  assert.ok(Math.abs((up.cog_height_m - pc.cog_height_m) * 1000 - dz) <= 0.1, "CoG change = mass-sheet change");
  assert.ok(design.facts(B).mass.cog_height_mm > design.facts(B).mass.cog_z_mm + B.params.floor.ride_height_mm, "the 10 mm plank is counted");
});

test("guard 6: bench never mutates the caller's circuits; the CLI validates --score", () => {
  const circuits = ["monza"]; const r = bench.bench(B, { circuit: "silverstone", circuits });
  assert.deepEqual(circuits, ["monza"]); assert.deepEqual(Object.keys(r.circuits).sort(), ["monza", "silverstone"]);
  const cli = require("../concept/cli.js");
  assert.throws(() => cli.parseArgs(["--score", "spa"]), /--score/);
  assert.deepEqual(cli.parseArgs(["--score", "monza", "--circuits", "silverstone"]).circuits, ["monza", "silverstone"]);
  const x = spawnSync(process.execPath, [path.join(__dirname, "..", "concept", "cli.js"), "--gens", "1", "--score", "nowhere", "--quiet"], { encoding: "utf8" });
  assert.equal(x.status, 1); assert.match(x.stderr, /--score/);
});

test("guard 7: front-wing chord limit is the trimmed RV-FW-PROFILES envelope (§21.1, §22.3-22.4), straight mode included", () => {
  assert.equal(regs.fwEnvelopeX(0), 500); assert.equal(regs.fwEnvelopeX(400), 637.5); assert.equal(regs.fwEnvelopeX(440), 647.5); assert.ok(Math.abs(regs.fwEnvelopeX(675) - 559.375) < 1e-9);
  const lim = regs.fwChordLimit(1300); assert.ok(lim > 590 && lim < 600, String(lim));
  assert.ok(B.params.front_wing.chord_mm <= lim);
  assert.ok(ids(withParam("front_wing", "chord_mm", 650)).includes("REG-C-FW-CHORD"), "650 mm fit the untrimmed 775 mm box but not the trimmed envelope");
  // straight mode lengthens the flaps' X projection; it must still fit
  const sm = withParam("front_wing", "sm_delta_deg", 20); sm.params.front_wing.chord_mm = 590;
  assert.ok(regs.fwStraightExtent(sm.params.front_wing) > 590); assert.ok(ids(sm).includes("REG-C-FW-SM-ENVELOPE"));
  const ok = withParam("front_wing", "sm_delta_deg", 10); ok.params.front_wing.chord_mm = 540; assert.ok(!ids(ok).includes("REG-C-FW-SM-ENVELOPE"));
});

test("guard 8: cooling margin is not free - PKG-COOLING rule and a linear derate below need × 1.05", () => {
  const c = inlet => aeromap.evaluate(withParam("sidepods", "inlet_cm2", inlet).params).cooling;
  assert.equal(c(650).power_factor, 1); assert.equal(c(650).margin_ok, true);
  assert.ok(ids(withParam("sidepods", "inlet_cm2", 550)).includes("PKG-COOLING"), "550 cm² was a free 0.18 s before");
  const just = c(570); assert.equal(just.margin_ok, false); assert.ok(just.power_factor < 0.985, "linear term: " + just.power_factor);
  assert.ok(!ids(withParam("sidepods", "inlet_cm2", 590)).includes("PKG-COOLING"));
  // the reviewer's case: 550 cm² is now illegal, so no score
  assert.equal(bench.bench(withParam("sidepods", "inlet_cm2", 550)).score, null);
});

test("guard 9: floor stall judged at the dynamic ride height with a margin; PhysicalCar carries floor_stalled and stall_margin_mm", () => {
  const pc = physical.physical(B);
  assert.equal(pc.aero.floor_stalled, false); assert.ok(pc.aero.stall_margin_mm >= 2, String(pc.aero.stall_margin_mm));
  assert.ok(pc.aero.ride_sens_per_mm > 0, "ride_sens_per_mm keeps its sign");
  const hack = withParam("floor", "ride_height_mm", 30); hack.params.floor.throat_mm = 48;   // (v1: 80) the reviewer's best design: static gap 55.3 mm
  const ph = physical.physical(hack);
  assert.equal(ph.aero.floor_stalled, true); assert.ok(ph.aero.stall_margin_mm < 0); assert.ok(ph.aero.ride_sens_per_mm >= 0);
  assert.ok(ids(hack).includes("PKG-FLOOR-STALL"));
  const edge = withParam("floor", "ride_height_mm", 33); assert.ok(ids(edge).includes("PKG-FLOOR-STALL"), "1.67 mm margin < 2");
  assert.ok(!ids(withParam("floor", "ride_height_mm", 34)).includes("PKG-FLOOR-STALL"));
  for (const k of ["mass_kg", "fuel_kg", "wheelbase_m", "cog_height_m", "weight_dist_front", "aero", "pu", "tyres", "brakes", "drivetrain_eff", "calibration", "sources"]) assert.ok(k in pc, k);
  for (const k of ["corner", "straight", "ride_height_mm", "ride_sens_per_mm"]) assert.ok(k in pc.aero, k);
});

test("guard 10: sim v0 charges straight-mode downforce on the zones; rear flap tips outboard of Y=535 stay put", () => {
  assert.ok(Math.abs(aeromap.flapShare("rear_wing", { elements: 2, span_mm: 1150 }) - 0.5 * 535 / 575) < 1e-12);
  assert.equal(aeromap.flapShare("rear_wing", { elements: 2, span_mm: 1000 }), 0.5);
  assert.equal(aeromap.flapShare("front_wing", { elements: 3, span_mm: 1350 }), 2 / 3);
  const d = withParam("rear_wing", "sm_delta_deg", 25), r = bench.bench(d, { sim: "v0" }), x = r.circuits.silverstone;
  assert.ok(x.v0.df_straight < x.v0.multipliers.df, "straight mode lowers zone downforce");
  // the same car without the zone downforce charge is faster: the charge is real
  const G = EI, track = G.evaluator.trackFor("silverstone"), cal = G.evaluator.calibrate(track, "silverstone"), zones = bench.activationZones(track, "silverstone");
  const lap = df_sm => G.evaluator.timing(track, bench.profile(G, track, cal.grip, x.v0.multipliers, { k: x.v0.mass_ratio, p: x.v0.power_ratio, cd_sm: x.v0.cd_straight, df_sm, zones }).prof, Infinity, "silverstone").lap;
  const charged = lap(x.v0.df_straight), free = lap(x.v0.multipliers.df);
  assert.ok(charged >= free - 1e-9, charged + " vs " + free); assert.ok(Math.abs(charged - x.v0.game_lap_s) < 0.002);
  // the channel itself: with every sample a zone, lower zone downforce lengthens every grip-limited braking phase
  const all = new Uint8Array(track.n).fill(1), one = { df: 1, cd: 1, a0: 1, b0: 1 };
  const lapAll = df_sm => G.evaluator.timing(track, bench.profile(G, track, cal.grip, one, { k: 1, p: 1, cd_sm: 1, df_sm, zones: all }).prof, Infinity, "silverstone").lap;
  assert.ok(lapAll(0.7) > lapAll(1) + 0.05, lapAll(0.7) + " vs " + lapAll(1));
  assert.ok(lapAll(0.85) > lapAll(1) && lapAll(0.85) < lapAll(0.7));
  // a zone df equal to the corner df changes nothing (the channel is inert without straight-mode load loss)
  const noSm = bench.bench(B, { sim: "v0" }).circuits.silverstone; assert.equal(noSm.v0.df_straight, 1); assert.equal(noSm.lap_s, 88.111);
});

test("guard 11: wing profile drag depends on the setting, so a short steep wing pays for its load", () => {
  const rw = (chord, aoa) => aeromap.wing("rear_wing", Object.assign({}, B.params.rear_wing, { chord_mm: chord, aoa_deg: aoa }));
  const base = rw(420, 20);
  let lo = 5, hi = 35; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (rw(300, m).df < base.df) lo = m; else hi = m; }
  const steep = rw(300, (lo + hi) / 2);
  assert.ok(Math.abs(steep.df - base.df) < 1e-6);
  assert.ok(steep.cd > base.cd + 0.01, "same load from a short steep wing costs drag: " + steep.cd + " vs " + base.cd);
  const fw = (chord, aoa) => aeromap.wing("front_wing", Object.assign({}, B.params.front_wing, { chord_mm: chord, aoa_deg: aoa }));
  assert.ok(fw(580, 30).cd - fw(580, 25).cd > fw(580, 25).cd - fw(580, 20).cd, "drag grows faster than linearly with setting");
  assert.equal(aeromap.WING.rear_wing.kp, 0.5);
});
