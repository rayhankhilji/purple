// PURPLE CONCEPT - physical(design) -> PhysicalCar: the design as SI physical quantities, the contract a lap simulator consumes
// (concept/sim/ physics sim; concept/bench.js sim v0 as the fallback).
//
// CALIBRATION (docs/concept/CONCEPT.md §0): the design layer does NOT set absolute levels of its own. Each design is mapped onto an
// ANCHOR car of the physics lap sim, the car the sim estimated from the 2026 British GP pole lap (sim.baselineCar()) or, for a team
// baseline, that team's inferred car (sim.baselineCar("redbull")). The design's team baseline (design.baseline({ team })) maps onto
// its anchor EXACTLY, so physical(baseline) laps the sim's baseline time; every other design is the anchor plus RELATIVE deltas
// from the part catalogue (mass sheet) and the concept aero map:
//   corner CLA = anchor CLA × df · cla_scale,  CDA = anchor CDA × cd · cda_scale   (df, cd relative to the reference design)
//   front share = anchor front share + (balance − reference balance)              (both modes)
//   Straight Mode = anchor corner × the concept map's straight-mode coefficient − E × φ (see flapDeployment below): the reference
//     flap (front 4°, rear 15°) gives the anchor's Straight Mode exactly, no flap gives Corner Mode, flaps opened past the reference
//     gain only through the concept map's own flap model (a conservative extrapolation)
//   mass, CoG height, front weight share = anchor + (design − reference design)    ICE kW = anchor × cooling power factor
//     (from the UNROUNDED mass sheet, parts.massSheet().exact, so a 1 mm part move is a smooth change, not a staircase)
//   materials (params.<part>.material, concept/materials.js) reach the car through the mass sheet (part mass → ballast, CoG,
//     axle split) and the aero map (wing wash-out, floor flex); coupling v1 additive fields: yaw_inertia_kgm2, cog_x_m,
//     unsprung_kg, sprung_cog_height_m, aero.balance_corner / front_wing_ground_effect / material_flex, materials
//     (docs/concept/COUPLING.md)
//   tyres (μ, load sensitivity), brakes, track widths, drivetrain, gearing: the anchor's (no design parameter moves them)
//   energy (regulation semantics, FIA 2026 Section C): es_harvest = 8.5 MJ/lap recharge cap (C5.2.10; the session limit, 6.5 MJ in
//     Silverstone qualifying, comes in through the sim's conditions), es_deploy = 4 MJ SoC window (C5.2.9) + 8.5 = 12.5 MJ/lap
//     (no separate deploy cap exists; the sim needs ≥ 4 + 6.5 = 10.5). Energy is regulation, never a design parameter.
// Without the sim loaded (a page without concept/sim/*.js) the anchor is the UNCALIBRATED v0 estimate (REF_V0 below); sim v0 only
// uses ratios to the baseline, so it is unaffected. A reduced-order model: no flow is solved anywhere.
// Dual browser / Node: window.EI.concept.physical and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const parts = req("parts", "./parts.js"), aeromap = req("aeromap", "./aeromap.js"), design = req("design", "./design.js");
  const LABEL = "concept · PhysicalCar v1 · design deltas (part-mass and concept aero map estimates) on the physics sim's estimated car";
  const LABEL_V0 = "concept · PhysicalCar v0 · part-mass and aero-level estimates (not measured; physics sim not loaded)";

  // the energy rules (FIA 2026 Section C, Issue 19): regulation, not design
  const ENERGY = Object.freeze({ soc_window_mj: 4, recharge_max_mj: 8.5, deploy_mj: 12.5, mguk_max_kw: 350, basis: "C5.2.9 SoC window 4 MJ; C5.2.10 recharge ≤ 8.5 MJ/lap (Silverstone qualifying 6.5 MJ via conditions.recharge_limit_mj); deploy = window + recharge = 12.5 MJ/lap (no separate deploy cap); C5.2.7 MGU-K 350 kW" });
  // v0 absolute levels: used only when the physics sim is not loaded (uncalibrated estimates; see SOURCES)
  const REF_V0 = { CLA_m2: 3.8, CDA_m2: 1.1, sm_cla_ratio: 0.6, sm_cda_ratio: 0.8, fuel_kg: 8, mass_kg: 770, track_front_m: 1.54, track_rear_m: 1.47, cog_height_m: 0.325, weight_dist_front: 0.4492, mu_x: 1.75, mu_y: 1.8, load_sens: 0.04, drivetrain_eff: 0.95, ice_kw: 400, decel_g: 5 };
  const REF = REF_V0;   // kept for callers of the v0 API
  const SOURCES = {
    mass_kg: { verified: false, basis: "the anchor car's mass (physics sim: generic 770 kg = C4.1 726 kg + 44 kg Nominal Tyre Mass estimate; RB22 775 kg, the RB22 data sheet's mass.car_no_fuel, concept/data/rb22-sheet.json) + the design's mass-sheet change from its baseline (concept part-mass estimates + automatic ballast to the C4.1 minimum; the C4.1 check itself uses the mass sheet, 770 kg in qualifying)" },
    fuel_kg: { verified: false, basis: "8 kg qualifying-run fuel: the physics sim's assumption; fuel is outside Car Mass (Section C definitions)" },
    wheelbase_m: { verified: true, basis: "design parameter; C2.3.3 caps it at 3.400 m (the sim's point mass does not use it; sim v0 does)" },
    track_m: { verified: true, basis: "the anchor car's track widths: 1.540 / 1.470 m, the widest C10.10.1 allows (Wheel Coordinate System origin at |Y| ≤ 603 / 525 mm + half the C10.7.2(a) rim overall width; concept/parts.js wheel centres at |y| 770 / 735 mm)" },
    cog_height_m: { verified: false, basis: "anchor CoG height (physics sim assumption 0.30 m) + the design's mass-sheet CoG change from its baseline (Z frame + 10 mm plank + static ride height)" },
    weight_dist_front: { verified: false, basis: "anchor front share + the design's static axle-load change from its baseline (C4.2 bounds the mass sheet in qualifying)" },
    aero: { verified: false, basis: "the physics sim's estimated effective coefficients for the anchor car (estimated on the 2026 British GP pole lap; the values are concept/sim/fitted.js baseline_estimate), times the concept aero map v0's relative change from the baseline design; the baseline's front 4° / rear 15° flap is the reference Straight Mode setting. Effective values of a point-mass model, not wind-on-car measurements. floor_stalled / stall_margin_mm: the floor's gap at the dynamic ride height against the modelled stall onset" },
    pu: { verified: "partial", basis: "ICE: the anchor's (400 kW reported generic 2026 figure × the team's inferred PU scale) × the cooling derate; MGU-K 350 kW (C5.2.7); " + ENERGY.basis },
    tyres: { verified: false, basis: "the anchor's tyre friction, load sensitivity (power-law tyre, sim v3) and slip angle at the limit, estimated by the physics sim on the pole lap (concept/sim/fitted.js baseline_estimate.tyres)" },
    brakes: { verified: false, basis: "the anchor's mechanical deceleration cap (physics sim assumption 5 g); braking is tyre-limited below it" },
    drivetrain_eff: { verified: false, basis: "0.95: physics sim assumption for gearbox and driveline efficiency" },
    yaw_inertia_kgm2: { verified: false, basis: "the design's mass sheet: Σ m·((x − x_cog)² + y²) over the part point masses (no part's own inertia; concept part masses v1, estimates). Absolute, not anchored (no anchor car carries one); the physics sim does not read it yet" },
    unsprung_kg: { verified: false, basis: "wheels + brakes + 40 % of each suspension group (uprights, hubs, half the links; estimate) from the mass sheet; the physics sim does not read it yet" },
    cog_x_m: { verified: false, basis: "mass-sheet CoG behind the front axle (absolute; weight_dist_front is the anchored quantity the sim reads)" },
    materials: { verified: false, basis: "concept materials v1 (concept/materials.js, concept/data/materials-2026.json): a non-baseline material re-gauges the part's walls to keep its baseline stiffness and strength (within gauge limits; estimates), so it changes part mass (→ ballast, CoG, axle split) and, through the stiffness ratio, wing wash-out and floor flex" },
    gearing: { verified: false, basis: "the anchor's gearing (measured rpm per km/h on the pole lap (generic) or on all 25 Red Bull laps (RB22), concept/data/redbull-2026.json kmh_per_1000rpm_by_gear_all_RB_laps; Node only, the browser uses the generic ratios: 0.001 s on the RB22 lap) × the design's final drive (gearbox.top_kmh) and ratio spread (gearbox.step) relative to its baseline; shift rpm the anchor's (PU locked)" },
    suspension: { verified: false, basis: "more-factors v1: lltd_front = anchor lltd + weight-split change + (roll stiffness front share − baseline share) × elastic share (anchor: RB22 = weight split + (0.55 − weight split) × elastic, the sheet's split; generic = its weight split); elastic share = sprung mass × (sprung CoG − 40 mm roll centre, estimate) / (mass × CoG height) from the mass sheet; heave_n_mm the design's whole-car heave stiffness (RB22 sheet 3500 N/mm; aero.heave_n_per_mm carries the platform stiffness the sim reads, anchor × design change)" },
    brakes_bias: { verified: false, basis: "more-factors v1: brakes.bias_front = the design's brake balance (% front / 100), bias_ref = its baseline's (57 % front, RB22 sheet brake.balance_front); the sim scales the calibrated braking capacity by the fixed-balance capacity ratio" },
  };
  // more-factors v1: roll centres ≈ 40 mm above the ground at both axles (ESTIMATE: F1 wishbone geometry keeps them low; not
  // published), and the platform stiffness the sim was calibrated with (concept/sim/lapsim.js MODEL.heave_n_per_mm, 3500 N/mm)
  const SUSP = Object.freeze({ roll_centre_mm: 40, platform_n_per_mm: 3500 });
  const DEFAULT_CALIBRATION = Object.freeze({ cla_scale: 1, cda_scale: 1, power_scale: 1, mu_scale: 1 });
  const r6 = v => Math.round(v * 1e6) / 1e6, r4 = v => Math.round(v * 10000) / 10000;

  // ---- the physics sim (optional): Node require, browser window.EI.conceptSim (concept/sim/index.js)
  let simCache;
  function sim() {
    if (EI.conceptSim && typeof EI.conceptSim.simulateLap === "function" && typeof EI.conceptSim.baselineCar === "function" && EI.conceptSim.teamCar) return EI.conceptSim;
    if (simCache !== undefined) return simCache;
    simCache = null;
    if (typeof require === "function") { try { simCache = require("./sim/index.js"); } catch (e) { simCache = null; } }
    return simCache;
  }
  // anchor cars, cached per team (teamCar reads the team dossier from disk in Node); returned as copies
  const anchorCache = {};
  function anchor(team) {
    const key = team || "generic";
    if (anchorCache[key]) return anchorCache[key];
    const S = sim(); if (!S) return null;
    const car = key === "generic" ? S.baselineCar() : S.baselineCar(key);
    return (anchorCache[key] = JSON.parse(JSON.stringify(car)));
  }
  // the reference design (the team's baseline) and its facts, cached per team and session
  const refCache = {};
  function reference(team, session) {
    const key = (team || "generic") + "|" + (session || "qualifying");
    if (refCache[key]) return refCache[key];
    const d = design.baseline(team ? { team } : undefined);
    return (refCache[key] = { design: d, facts: design.facts(d, { session }) });
  }

  // Straight Mode. The concept aero map explains only part of the anchor's Straight Mode relief (its flaps remove ~16 % of the
  // load and ~7 % of the drag; the sim's estimate is ~61 % and ~45 %). Mapping, per coefficient Q (CLA total, CDA):
  //   Q_straight = Q_anchor,corner × q_sm − E × φ        E = Q_anchor,corner × q_sm,ref − Q_anchor,straight
  // q_sm is the concept map's straight-mode coefficient relative to the reference design (so every shape change acts at the same
  // m²-per-unit scale as in Corner Mode, and a lower wing lowers straight-mode drag too), E is the rest of the anchor's relief
  // (active aero beyond the concept map's flap model) and φ ∈ [0, 1] is how far the flaps are deployed against the reference
  // setting: per wing min(1, flap angle / reference angle) (0 for a single-volume wing: no flap), weighted by each wing's share of
  // the reference flap relief. The reference design maps exactly onto the anchor; no flap means Straight = Corner Mode; opening the
  // flaps past the reference gains only through the concept map (E is capped): a conservative extrapolation.
  function flapDeployment(p, ra, key) {
    const ref = design.REF_STRAIGHT_MODE, b = ra.breakdown, w = {}, phi = {};
    let tot = 0;
    for (const id of ["front_wing", "rear_wing"]) {
      w[id] = Math.max(0, b[id][key] - b[id][key + "_sm"]); tot += w[id];
      const s = p[id].sm_delta_deg, s0 = ref[id];
      phi[id] = p[id].elements < 2 || !(s > 0) ? 0 : s0 > 0 ? Math.min(1, s / s0) : 1;
    }
    return tot > 0 ? (w.front_wing * phi.front_wing + w.rear_wing * phi.rear_wing) / tot : (phi.front_wing + phi.rear_wing) / 2;
  }
  function straightValue(Qc, Qs, qsm, qsmRef, phi) {
    const E = Qc * qsmRef - Qs;
    return Qc * qsm - E * phi;
  }

  // design -> PhysicalCar. opts: { calibration: { cla_scale, cda_scale, power_scale, mu_scale }, session: "qualifying"|"race",
  // team?: override the design's team (anchor), anchor?: a PhysicalCar to anchor on (tests) }
  function physical(d, opts) {
    opts = opts || {}; const cal = Object.assign({}, DEFAULT_CALIBRATION, opts.calibration || {});
    const team = opts.team !== undefined ? opts.team : (d && d.team) || null;
    const f = design.facts(d, opts), m = f.mass, a = f.aero, p = d.params;
    const A = opts.anchor || anchor(team);
    const R = reference(team, m.session);
    const ra = R.facts.aero, rm = R.facts.mass, mx = m.exact, rmx = rm.exact;
    // anchor coefficients: the sim's car, or the uncalibrated v0 levels when the sim is not loaded
    const V = REF_V0, Q = A
      ? { cla: A.aero.corner.CLA_front_m2 + A.aero.corner.CLA_rear_m2, claS: A.aero.straight.CLA_front_m2 + A.aero.straight.CLA_rear_m2, cda: A.aero.corner.CDA_m2, cdaS: A.aero.straight.CDA_m2, bal: A.aero.corner.CLA_front_m2 / (A.aero.corner.CLA_front_m2 + A.aero.corner.CLA_rear_m2), balS: A.aero.straight.CLA_front_m2 / Math.max(1e-9, A.aero.straight.CLA_front_m2 + A.aero.straight.CLA_rear_m2) }
      : { cla: V.CLA_m2, claS: V.CLA_m2 * V.sm_cla_ratio * (ra.df_sm / ra.df), cda: V.CDA_m2, cdaS: V.CDA_m2 * V.sm_cda_ratio * (ra.cd_sm / ra.cd), bal: ra.balance, balS: ra.balance_sm };
    const base = A
      ? { mass_kg: A.mass_kg, fuel_kg: A.fuel_kg, cog: A.cog_height_m, wdf: A.weight_dist_front, tf: A.track_front_m, tr: A.track_rear_m, mu_x: A.tyres.mu_x, mu_y: A.tyres.mu_y, ls: A.tyres.load_sens, slip: A.tyres.slip_angle_rad, radius: A.tyres.radius_m, decel: A.brakes.max_decel_g_mech, eta: A.drivetrain_eff, ice: A.pu.ice_kw, gearing: A.gearing ? JSON.parse(JSON.stringify(A.gearing)) : undefined }
      : { mass_kg: V.mass_kg, fuel_kg: V.fuel_kg, cog: V.cog_height_m, wdf: V.weight_dist_front, tf: V.track_front_m, tr: V.track_rear_m, mu_x: V.mu_x, mu_y: V.mu_y, ls: V.load_sens, radius: parts.WHEEL.tyre_radius_mm / 1000, decel: V.decel_g, eta: V.drivetrain_eff, ice: V.ice_kw };
    // relative aero against the reference design (the team baseline)
    const df = a.df / ra.df, cd = a.cd / ra.cd, dfS = a.df_sm / ra.df, cdS = a.cd_sm / ra.cd, dfSRef = ra.df_sm / ra.df, cdSRef = ra.cd_sm / ra.cd;
    const cla = Q.cla * df * cal.cla_scale, cda = Q.cda * cd * cal.cda_scale;
    const phiDf = flapDeployment(p, ra, "df"), phiCd = flapDeployment(p, ra, "cd");
    const claS = Math.min(cla, Math.max(0.05 * cla, straightValue(Q.cla, Q.claS, dfS, dfSRef, phiDf) * cal.cla_scale));
    const cdaS = Math.min(cda, Math.max(0.05 * cda, straightValue(Q.cda, Q.cdaS, cdS, cdSRef, phiCd) * cal.cda_scale));
    // Straight Mode balance: the anchor's, moved by the design's change, blended towards Corner Mode as the flaps close (φ → 0)
    const bal = Q.bal + (a.balance - ra.balance), balS = (1 - phiDf) * bal + phiDf * (Q.balS + (a.balance_sm - ra.balance_sm));
    const corner = { CLA_front_m2: r6(cla * bal), CLA_rear_m2: r6(cla * (1 - bal)), CDA_m2: r6(cda) };
    const straight = { CLA_front_m2: r6(claS * balS), CLA_rear_m2: r6(claS * (1 - balS)), CDA_m2: r6(cdaS) };
    const iceKw = base.ice * a.cooling.power_factor * cal.power_scale;
    const out = {
      id: d.id || null,
      label: A ? LABEL : LABEL_V0,
      team: team || null,
      anchor: A ? { id: A.id, label: A.label } : null,
      session: m.session,
      // deltas from the UNROUNDED mass sheet (m.exact): the rounded front share (1e-4) and CoG height (1 mm) made a staircase
      mass_kg: r6(base.mass_kg + (mx.total_kg - rmx.total_kg)),
      fuel_kg: base.fuel_kg,
      wheelbase_m: r4(p.layout.wheelbase_mm / 1000),
      track_front_m: base.tf,
      track_rear_m: base.tr,
      cog_height_m: r6(base.cog + (mx.cog_height_mm - rmx.cog_height_mm) / 1000),
      weight_dist_front: r6(base.wdf + (mx.front_share - rmx.front_share)),
      // additive (coupling v1, for a sim with yaw / pitch / heave dynamics; the current sim ignores them): the design's own mass
      // sheet values (no anchor carries them): yaw inertia about the CoG, the CoG's x behind the front axle, unsprung mass per axle
      // (wheels, brakes, 40 % of the suspension: estimate) and the sprung mass's CoG height above the ground
      yaw_inertia_kgm2: r4(mx.izz_kgm2),
      cog_x_m: r6(mx.cog_x_mm / 1000),
      unsprung_kg: { front: r4(mx.unsprung_front_kg), rear: r4(mx.unsprung_rear_kg) },
      sprung_cog_height_m: r6(base.cog + (mx.sprung_cog_height_mm - rmx.cog_height_mm) / 1000),
      aero: {
        corner, straight,
        ride_height_mm: p.floor.ride_height_mm,
        ride_sens_per_mm: r4(aeromap.rideSensitivity(p)),
        floor_stalled: a.floor_stalled,
        stall_margin_mm: r4(a.stall_margin_mm),
        // additive (coupling v1): the lever-rule front share of the corner downforce and its change from the reference design, the
        // front wing's ground-effect factor, and the material flex terms (docs/concept/COUPLING.md)
        balance_corner: r6(bal), front_wing_ground_effect: r6(a.front_wing_ground_effect), material_flex: a.material_flex,
      },
      materials: m.materials,
      pu: { ice_kw: r4(iceKw), mguk_kw: Math.min(ENERGY.mguk_max_kw, parts.BY_ID.pu_mguk.power_kw) * cal.power_scale, es_deploy_mj_per_lap: ENERGY.deploy_mj, es_harvest_mj_per_lap: ENERGY.recharge_max_mj, es_soc_window_mj: ENERGY.soc_window_mj },
      tyres: Object.assign({ mu_x: r4(base.mu_x * cal.mu_scale), mu_y: r4(base.mu_y * cal.mu_scale), load_sens: base.ls, radius_m: base.radius, compound: "soft" }, base.slip != null ? { slip_angle_rad: base.slip } : {}),
      brakes: { max_decel_g_mech: base.decel },
      drivetrain_eff: base.eta,
      calibration: cal,
      sources: SOURCES,
    };
    // ---- more-factors v1 (docs/concept/FACTORS.md): gearing, roll stiffness split, heave rate, brake balance
    // gearing: the anchor's measured ratios × the design's final-drive scale and spread relative to the reference design (the
    // anchor's own pattern of steps is kept); the shift rpm is the anchor's (the PU and its calibration are locked)
    if (base.gearing) {
      const gs = parts.gearSet(p), gr = parts.gearSet(R.design.params);
      out.gearing = Object.assign({}, base.gearing, { rpm_per_kmh: base.gearing.rpm_per_kmh.map((k, i, a) => r4(k * (gs.scale / gr.scale) * Math.pow(gs.spread / gr.spread, a.length - 1 - i))) });
    }
    // lateral load transfer distribution: the elastic share of the transfer moment follows the roll stiffness split, the rest
    // (unsprung mass, roll-centre / geometric transfer) follows the axle masses: lltd = weight split + (roll share − weight split)
    // × elastic, elastic = m_s (h_s − h_rc) / (m h) from the mass sheet (roll centres SUSP.roll_centre_mm, ESTIMATE). Mapped
    // onto the anchor: the anchor's own lltd (the RB22 car carries the sheet's 55 % split, concept/sim/fit.js; the generic car none,
    // i.e. lltd = its weight split) + the design's change of weight split + (share − reference share) × elastic.
    const kRoll = parts.val(p, "setup", "roll_front") / 100, kRoll0 = parts.val(R.design.params, "setup", "roll_front") / 100;   // % front -> share
    const hS = mx.sprung_cog_height_mm, hT = mx.cog_height_mm, mS = mx.total_kg - mx.unsprung_front_kg - mx.unsprung_rear_kg;
    const elastic = Math.max(0, Math.min(1, (mS * Math.max(0, hS - SUSP.roll_centre_mm)) / (mx.total_kg * hT)));
    const lltdA = A && A.suspension && typeof A.suspension.lltd_front === "number" ? A.suspension.lltd_front : base.wdf;
    out.suspension = { roll_stiffness_front: kRoll, elastic_share: r4(elastic), lltd_front: r6(lltdA + (out.weight_dist_front - base.wdf) + (kRoll - kRoll0) * elastic), heave_n_mm: parts.val(p, "setup", "heave_n_mm") };
    // heave: the anchor's platform stiffness (the sim's 3500 N/mm when it carries none) × the design's change of whole-car stiffness
    const khA = A && A.aero && typeof A.aero.heave_n_per_mm === "number" ? A.aero.heave_n_per_mm : SUSP.platform_n_per_mm;
    out.aero.heave_n_per_mm = r4(khA * parts.heaveRatio(p) / parts.heaveRatio(R.design.params));
    out.aero.dyn_compression_mm = r4(a.dyn_compression_mm);
    // brake balance: declared with its reference, so the sim brakes the reference car exactly as calibrated
    out.brakes.bias_front = r6(parts.val(p, "setup", "brake_bias") / 100); out.brakes.bias_ref = r6(parts.val(R.design.params, "setup", "brake_bias") / 100);
    return out;
  }

  const api = { LABEL, LABEL_V0, REF, REF_V0, ENERGY, SUSP, SOURCES, DEFAULT_CALIBRATION, physical, anchor, reference, flapDeployment, straightValue, sim };
  C.physical = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
