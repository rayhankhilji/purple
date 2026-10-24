// PURPLE CONCEPT - physical(design) -> PhysicalCar: the design as SI physical quantities, the contract a lap simulator consumes
// (concept/bench.js v0 today, the concept/sim/ physics sim later). Built from the part catalogue (mass, CoG, weight distribution),
// the concept aero map (shape -> relative downforce/drag, both aero modes) and the PU parts. The ABSOLUTE levels (CLA, CDA, μ, power)
// are public-magnitude ESTIMATES for a 2026 car and are expected to be calibrated by the sim (the `calibration` hook scales them);
// do not hand-tune them to a lap time here. Every figure's basis is in SOURCES; regulation figures cite Section C Issue 19.
// Dual browser / Node: window.EI.concept.physical and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const parts = req("parts", "./parts.js"), aeromap = req("aeromap", "./aeromap.js"), design = req("design", "./design.js");
  const LABEL = "concept · PhysicalCar v0 · part-mass and aero-level estimates (not measured)";

  // baseline absolute levels (Corner Mode, baseline concept car). Estimates, see SOURCES.
  const REF = { CLA_m2: 3.8, CDA_m2: 1.1, fuel_kg: 10, track_front_m: 1.58, track_rear_m: 1.52, mu_x: 1.75, mu_y: 1.8, load_sens: 0.04, radius_m: parts.WHEEL.tyre_radius_mm / 1000, drivetrain_eff: 0.95, es_deploy_mj: 8.5, es_harvest_mj: 8.5 };
  const SOURCES = {
    mass_kg: { verified: false, basis: "sum of concept part-mass estimates + automatic ballast to the C4.1 Minimum Mass of the session (Qualifying / Sprint Qualifying: 726 kg + Nominal Tyre Mass estimate 44 kg = 770 kg; other sessions 768 kg)" },
    fuel_kg: { verified: false, basis: "10 kg: estimate of a qualifying-run fuel load; fuel is outside Car Mass (Section C definitions)" },
    wheelbase_m: { verified: true, basis: "design parameter; C2.3.3 caps it at 3.400 m" },
    track_m: { verified: false, basis: "1.58 m front / 1.52 m rear: estimate (C2.3.1 limits bodywork to 950 mm from Y=0, tyres and rims excluded; C10.7.2 rim widths 315 / 401.3 mm)" },
    cog_height_m: { verified: false, basis: "mass-sheet CoG height above the GROUND: CoG in the Z frame (Z=0 = top of the plank, C3.6.1(a)) + 10 mm plank (C3.6.1(d)) + static ride height; unsprung parts (wheels, brakes) at tyre radius above the ground" },
    weight_dist_front: { verified: false, basis: "static axle loads from the mass sheet (C4.2 bounds it in qualifying)" },
    aero: { verified: false, basis: "CLA 3.8 m² / CDA 1.1 m² in Corner Mode for the baseline: estimates in line with the public 2026 aim of less downforce and markedly less drag than 2025 cars; scaled by the concept aero map v0 from the part shapes. Straight Mode from the same map with the wing flaps at reduced incidence (C3.10.10, C3.11.6; rear tips outboard of Y=535 fixed). floor_stalled / stall_margin_mm: the floor's effective gap at the dynamic ride height (static − 5 mm, assumption) against the modelled stall onset" },
    pu: { verified: "partial", basis: "ice_kw 400: widely reported 2026 figure, not in Section C (estimate), × the cooling derate; mguk_kw 350: C5.2.7 (verified); es_harvest 8.5 MJ/lap: C5.2.10 (verified; can be cut to ≥ 5 MJ in qualifying at some events); es_deploy 8.5 MJ/lap: assumes deploy = harvest over a lap, with C5.2.9's 4 MJ SoC window as the buffer (assumption)" },
    tyres: { verified: false, basis: "μx 1.75, μy 1.8, load sensitivity 4 %/kN, radius 0.353 m: public-magnitude estimates for 18-inch slicks (tyre data is not public)" },
    brakes: { verified: false, basis: "mechanical (zero-downforce) deceleration limit = μx; brakes are tyre-limited" },
    drivetrain_eff: { verified: false, basis: "0.95: estimate of gearbox and driveline efficiency" },
  };
  const DEFAULT_CALIBRATION = Object.freeze({ cla_scale: 1, cda_scale: 1, power_scale: 1, mu_scale: 1 });
  const r4 = v => Math.round(v * 10000) / 10000;

  // design -> PhysicalCar. opts: { calibration: { cla_scale, cda_scale, power_scale, mu_scale }, session: "qualifying"|"race" }
  function physical(d, opts) {
    opts = opts || {}; const cal = Object.assign({}, DEFAULT_CALIBRATION, opts.calibration || {});
    const f = design.facts(d, opts), m = f.mass, a = f.aero, p = d.params;
    const cla = REF.CLA_m2 * a.df * cal.cla_scale, claS = REF.CLA_m2 * a.df_sm * cal.cla_scale;
    const iceKw = parts.BY_ID.pu_ice.power_kw * a.cooling.power_factor * cal.power_scale;
    return {
      id: d.id || null,
      label: LABEL,
      session: m.session,
      mass_kg: m.total_kg,
      fuel_kg: REF.fuel_kg,
      wheelbase_m: r4(p.layout.wheelbase_mm / 1000),
      track_front_m: REF.track_front_m,
      track_rear_m: REF.track_rear_m,
      cog_height_m: r4(m.cog_height_mm / 1000),
      weight_dist_front: m.front_share,
      aero: {
        corner: { CLA_front_m2: r4(cla * a.balance), CLA_rear_m2: r4(cla * (1 - a.balance)), CDA_m2: r4(REF.CDA_m2 * a.cd * cal.cda_scale) },
        straight: { CLA_front_m2: r4(claS * a.balance_sm), CLA_rear_m2: r4(claS * (1 - a.balance_sm)), CDA_m2: r4(REF.CDA_m2 * a.cd_sm * cal.cda_scale) },
        ride_height_mm: p.floor.ride_height_mm,
        ride_sens_per_mm: r4(aeromap.rideSensitivity(p)),
        floor_stalled: a.floor_stalled,
        stall_margin_mm: r4(a.stall_margin_mm),
      },
      pu: { ice_kw: r4(iceKw), mguk_kw: parts.BY_ID.pu_mguk.power_kw * cal.power_scale, es_deploy_mj_per_lap: REF.es_deploy_mj, es_harvest_mj_per_lap: REF.es_harvest_mj },
      tyres: { mu_x: r4(REF.mu_x * cal.mu_scale), mu_y: r4(REF.mu_y * cal.mu_scale), load_sens: REF.load_sens, radius_m: REF.radius_m, compound: "soft" },
      brakes: { max_decel_g_mech: r4(REF.mu_x * cal.mu_scale) },
      drivetrain_eff: REF.drivetrain_eff,
      calibration: cal,
      sources: SOURCES,
    };
  }

  const api = { LABEL, REF, SOURCES, DEFAULT_CALIBRATION, physical };
  C.physical = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
