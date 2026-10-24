// PURPLE concept - physics lap-time simulator (docs/concept/SIM.md). simulateLap(car, "silverstone", conditions, opts) ->
// { lap_s, sectors_s, vmax_kmh, speed_trap_kmh, vmin_kmh, energy, trace?, label }.
// Quasi-steady-state point mass on a minimum-curvature racing line (concept/sim/track.js): aero load per axle, load-sensitive
// tyres with a friction ellipse, drag + rolling resistance + grade, power-limited traction (ICE + MGU-K under the FIA 2026
// speed taper), harvest under braking and superclipping, a lap energy budget solved by one deploy/clip speed threshold, and
// 2026 Straight / Corner Mode aero. Backward (braking) and forward (traction) passes; apex limits from the GG envelope.
// Deterministic: no randomness, fixed iteration counts. No network, no Mubit. Numbers, not an LLM.
// Dual browser / Node: attaches to window.EI.conceptSim and to module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {});
  const T = EI.conceptSimTrack || (typeof require === "function" ? require("./track.js") : null);
  if (!T) throw new Error("concept sim: load concept/sim/track.js first");

  const LABEL = "physics lap sim · quasi-steady-state point mass · Silverstone OSM centreline · calibrated to 2026 British GP qualifying";
  const G = 9.81;

  // ---- regulation numbers (FIA 2026 F1 Regulations Section C, Issue 20, 05 Aug 2026; verified against the PDF text)
  const REGS = {
    mguk_max_kw: 350,           // C5.2.7  ERS-K DC power <= 350 kW
    es_soc_window_mj: 4,        // C5.2.9  max - min state of charge <= 4 MJ while on track
    recharge_max_mj: 8.5,       // C5.2.10 recharge <= 8.5 MJ per lap (FIA may set 7 MJ, and lower in qualifying)
    ers_eff: 0.97,              // C5.2.21 fixed electrical <-> mechanical correction used by the standard ECU
    fuel_energy_flow_mj_h: 3000, // C5.2.3
    min_mass_q_kg_excl_tyres: 726, // C4.1 (qualifying); + Nominal Tyre Mass
    wheelbase_max_m: 3.4,       // C2.3.3
    front_mass_min_frac: 0.44, rear_mass_min_frac: 0.54, // C4.2 (of the minimum mass, qualifying)
  };
  // C5.2.8: ERS-K propulsion power limit vs car speed (kW); overtake = C5.2.8.ii
  function mgukTaperKw(vKmh, overtake) {
    if (overtake) return vKmh < 355 ? 7100 - 20 * vKmh : 0;
    if (vKmh < 340) return 1800 - 5 * vKmh;
    if (vKmh < 345) return 6900 - 20 * vKmh;
    return 0;
  }

  // ---- model assumptions (not regulation; SIM.md §4 lists each with its reasoning)
  const MODEL = {
    crr: 0.012,                 // rolling resistance coefficient on the normal load (tyre + bearing losses)
    rot_mass_factor: 1.03,      // effective mass factor for wheel / driveline rotational inertia
    rear_brake_share: 0.43,     // fraction of braking force on the rear axle (57 % front bias, lab/aero.js BASELINE) - the K harvests from it
    superclip_kw: 350,          // full-throttle harvest power when superclipping (reported 2026 change; Section B, unverified)
    wet_mu: 0.75,               // tyre friction multiplier on a wet track (intermediates; assumption)
    wet_crr: 1.5,               // rolling resistance multiplier in the wet (standing water)
    slip_angle_rad: 0.08,       // tyre slip angle at the lateral limit, for slip drag (assumption, as concept/tools/derive-car.js; 0.04-0.12)
    // aero platform (ride-height-dependent aero, SIM.md §3.1): the aero load squats the car by dh = F / heave_n_per_mm; the CLA
    // grows by ride_sens_per_mm per mm of squat (PhysicalCar.aero.ride_sens_per_mm; priors-2026 0.3-0.8 %/mm) until the floor
    // reaches its stall gap, then the floor's share of the load rolls off (concept/aeromap.js FLOOR: quadratic over 25 mm to 0.4).
    // heave_n_per_mm: assumption, ~5 mm of squat under the ~17 kN Corner Mode load at 300 km/h, the dynamic compression the design
    // layer assumes (concept/aeromap.js FLOOR.dyn_compression_mm = 5); car.aero.heave_n_per_mm overrides. Stall onset: the design
    // layer's dynamic stall margin (aero.stall_margin_mm, judged at static - 5 mm) + those 5 mm.
    heave_n_per_mm: 3500,
    floor: { share: 0.55, dyn_mm: 5, stall_w_mm: 25, stall_floor: 0.4, margin_default_mm: 3.67 },   // share: priors-2026 0.45-0.65
    floor_stall_cla_factor: 0.5, // a stalled floor (PhysicalCar.floor_stalled) keeps half of the car's CLA (assumption: floor ~50-60 % of load)
    aero_switch_s: 0.4,         // Corner -> Straight Mode transition time (C3.10.10 o / C3.11.6 d: at most 400 ms; worst case used)
    straight_lat_frac: 0.5,     // Straight Mode is closed if lateral demand exceeds this share of Straight Mode grip
    u_max: 115, du: 0.5,        // air-speed table range and step (m/s)
    vcap: 105,                  // apex-limit search ceiling (m/s, 378 km/h)
    pressure_hpa: 1007.6,       // used when the conditions give neither density nor pressure (2026 British GP qualifying mid-range)
    default_strategy: "threshold", // energy strategy used when opts.strategy is not given (see section 3)
    clip_rho: 1,                // "marginal" strategy: superclip where sensitivity < rho x deploy threshold (cal.clip_rho overrides)
    lambda_iters: 22,           // bisection iterations of the strategy threshold
    opt_soft: 0.25,             // "optimal": width (in log sens) of the soft switch between deploy, neutral and superclip
    opt_refine: 0,              // "optimal": re-derive the value of a joule on the solved lap this many times (0: not self-consistent, it can flip)
    clip_search: 5,             // golden-section evaluations of the superclip amount (phi)
    clip_search_iters: 10,      // bisection iterations inside that search (0.1 m/s on the threshold; the final solve uses lambda_iters)
    // upshift torque cut (s): no drive force for this long after each upshift (assumption: 2026 seamless-shift gearboxes cut very
    // little; capped at the 200 ms upshift the brief allows). Only with PhysicalCar.gearing, default strategy only.
    upshift_cut_s: 0.03, upshift_cut_max_s: 0.2,
    // tyre grip vs track temperature (ESTIMATE, no public 2026 Pirelli number found): mu x (1 - k (T - T_ref)^2), floored; T_ref is
    // the calibration session's track temperature (2026 British GP qualifying 40.4 C), so the calibrated car is unchanged there
    tyre_temp: { ref_c: 40.4, k_per_c2: 1.3e-4, floor: 0.85 },
    // crosswind yaw (ESTIMATE): downforce x (1 - yaw_sens x |yaw deg|), floored at 0.5, with PhysicalCar.aero.yaw_sens (per degree;
    // default 0 = no yaw effect, contract request). Yaw = atan(crosswind / air speed along the heading).
    yaw_sens_default: 0, yaw_floor: 0.5,
  };
  // default conditions = 2026 British GP qualifying (4 Jul 2026, 16:00-17:00), mid-range of the FIA Qualifying Weather Report as
  // transcribed in concept/data/silverstone-2026-weekend.json (sessions[Qualifying].weather): air 24.6-25.8 C, track 38.2-42.6 C,
  // pressure 1007.4-1007.8 mbar, humidity 46.2-50.2 %, wind 0.3-4.9 m/s with no published direction (-> 0), dry.
  // recharge_limit_mj: Silverstone qualifying recharge limit 6.5 MJ/lap (FIA Power Unit Information doc, same file, energy_limits).
  const DEFAULT_CONDITIONS = Object.freeze({ air_temp_c: 25.2, track_temp_c: 40.4, air_pressure_hpa: 1007.6, humidity_pct: 48.2, wind_ms: 0, wind_from_deg: 0, wet: false, recharge_limit_mj: 6.5 });
  // Timing frame used with the OSM-centreline racing line (opts.line = "osm"; the default telemetry line carries its own, measured
  // on the pole lap - concept/sim/line-silverstone.js). The alignment of the OpenF1 pole trace with the OSM frame puts the
  // control line at OSM s = 80.4 m (Procrustes fit, RMS 5.3 m; build-line.js), not at the game's startFinish 260 m. Lap
  // distances along the pole trace (sector lines 1807.5 / 4239.1 m, trap 4780 m, intermediates 1840 / 4170 m) are scaled by
  // the length ratio 5880.66 / 5824.6.
  const K_TR = 5880.66 / 5824.6, C0 = 80.4;
  const TIMING = {
    silverstone: { control_s: C0, sectors: [C0 + 1807.5 * K_TR, C0 + 4239.1 * K_TR], trap_s: C0 + 4780 * K_TR, i1_s: C0 + 1840 * K_TR, i2_s: C0 + 4170 * K_TR, source: "pole-lap timing mapped to the OSM frame" },
  };

  // corner names by FIA / MultiViewer number (T1..T18), used for the per-corner output
  const CORNER_NAMES = { silverstone: { 1: "Abbey", 2: "Farm", 3: "Village", 4: "The Loop", 5: "Aintree", 6: "Brooklands", 7: "Luffield", 8: "Woodcote", 9: "Copse", 10: "Maggotts", 11: "Maggotts", 12: "Becketts", 13: "Becketts", 14: "Chapel", 15: "Stowe", 16: "Vale", 17: "Club", 18: "Club" } };

  // ---- a plausible 2026 car (SIM.md §3 has the source / status of every number)
  // generic prior (sourced magnitudes / assumptions); baselineCar() replaces the estimated fields with fitted.js values
  // v2: central values of concept/data/priors-2026.json (recommended_fit_priors) where it has one; SIM.md §4.2 lists each
  function priorCar() {
    return {
      id: "prior-2026", label: "generic 2026 prior car (sourced magnitudes, not estimated)",
      mass_kg: 770,              // C4.1 qualifying 726 kg + Nominal Tyre Mass 44 kg; priors 770-780 (Mercedes reported at the minimum)
      fuel_kg: 8,                // qualifying run fuel (assumption; concept/weekend quali_fuel_kg uses the same 8 kg)
      wheelbase_m: 3.4,          // C2.3.3 maximum
      track_front_m: 1.6, track_rear_m: 1.55, // assumption (1900 mm max car width)
      cog_height_m: 0.30,        // priors 0.27-0.34 m above the ground (central)
      weight_dist_front: 0.45,   // priors 0.44-0.46 (C4.2 floor)
      aero: {
        // priors: Corner Mode CLA 3.2-4.6 (3.9) m2 with front share 0.435; CDA 0.75-1.25 (1.0) m2
        corner: { CLA_front_m2: 1.70, CLA_rear_m2: 2.20, CDA_m2: 1.0 },
        // priors: Straight Mode CLA x 0.72 (0.68-0.80), CDA x 0.82 (0.75-0.92); derived activation step dCdA 0.27 +- 0.06 m2
        straight: { CLA_front_m2: 1.22, CLA_rear_m2: 1.58, CDA_m2: 0.80 },
        // static ride height of the CLA above; ride sensitivity 0.6 %/mm and dynamic stall margin 3.67 mm are concept/aeromap.js at
        // the baseline design (35 mm), so physical(baseline) carries the same platform (priors-2026 ride sensitivity 0.3-0.8 %/mm)
        ride_height_mm: 35, ride_sens_per_mm: 0.006, stall_margin_mm: 3.67,
      },
      pu: { ice_kw: 400, mguk_kw: 350, es_deploy_mj_per_lap: 12.5, es_harvest_mj_per_lap: 8.5 },   // ICE: the FIA 2026 design figure 400 kW (priors 385-430), not estimated
      tyres: { mu_x: 1.75, mu_y: 1.8, load_sens: 0.086, radius_m: 0.348, compound: "soft" },      // priors mu 1.6-2.0 / 1.5-1.9 at 2 kN; 4.5 %/kN
      brakes: { max_decel_g_mech: 5.0 },
      drivetrain_eff: 0.95,
    };
  }
  // the baseline: the prior with the parameters nobody publishes (CLA, CDA, tyre friction, load sensitivity, gearing) replaced
  // by their estimates from the 2026 British GP pole lap (fitted.js baseline_estimate, made by build-fit.js). It stands for the
  // pole car (Mercedes W17, Antonelli) in this model; no global correction factor is applied on top of it.
  function baselineCar() {
    const c = priorCar(), f = fittedData(), e = f && f.baseline_estimate;
    c.id = "baseline-2026"; c.label = "baseline 2026 car (prior + parameters estimated from the 2026 British GP pole lap)";
    if (e) {
      c.aero.corner = Object.assign({}, e.aero.corner); c.aero.straight = Object.assign({}, e.aero.straight);
      Object.assign(c.tyres, e.tyres); if (e.pu) Object.assign(c.pu, e.pu);
      if (e.gearing) c.gearing = JSON.parse(JSON.stringify(e.gearing));
    }
    return c;
  }
  function fittedData() { return EI.CONCEPT_SIM_FIT || (typeof require === "function" ? safeRequire("./fitted.js") : null); }

  // the calibration in force (concept/sim/fitted.js, produced by concept/sim/build-fit.js); identity if absent
  function activeCal() {
    const f = fittedData();
    return (f && f.global) || { grip_scale: 1, drag_scale: 1 };
  }
  function safeRequire(p) { try { return require(p); } catch (e) { return null; } }

  // moist-air density: dry partial pressure / (Rd T) + vapour partial pressure / (Rv T); Magnus formula for saturation pressure
  function airDensity(c) {
    if (c && +c.air_density_kgm3 > 0) return +c.air_density_kgm3;
    const tC = c && isFinite(+c.air_temp_c) ? +c.air_temp_c : DEFAULT_CONDITIONS.air_temp_c, tK = 273.15 + tC;
    const p = 100 * (c && +c.air_pressure_hpa > 0 ? +c.air_pressure_hpa : MODEL.pressure_hpa);
    const rh = c && isFinite(+c.humidity_pct) ? Math.min(100, Math.max(0, +c.humidity_pct)) : 0;
    const e = (rh / 100) * 610.94 * Math.exp((17.625 * tC) / (tC + 243.04));
    return (p - e) / (287.05 * tK) + e / (461.5 * tK);
  }
  // same convention as lab/aero.js headwind(): > 0 blows into the car; heading = atan2(dz, dx) in (x east, z south)
  function headwind(c, headingRad) {
    const ms = c && +c.wind_ms || 0; if (!ms) return 0;
    const th = ((c.wind_from_deg || 0) * Math.PI) / 180, fx = Math.sin(th), fz = -Math.cos(th);
    return ms * (Math.cos(headingRad) * fx + Math.sin(headingRad) * fz);
  }
  // crosswind component (m/s, magnitude) at a heading: the wind normal to the direction of travel
  function crosswind(c, headingRad) {
    const ms = c && +c.wind_ms || 0; if (!ms) return 0;
    const th = ((c.wind_from_deg || 0) * Math.PI) / 180, fx = Math.sin(th), fz = -Math.cos(th);
    return Math.abs(ms * (-Math.sin(headingRad) * fx + Math.cos(headingRad) * fz));
  }
  // tyre friction factor at a track temperature (MODEL.tyre_temp, an estimate): 1 at the calibration session's track temperature
  function tyreTempFactor(trackC) {
    const T = MODEL.tyre_temp; if (!isFinite(+trackC)) return 1;
    return Math.max(T.floor, 1 - T.k_per_c2 * (+trackC - T.ref_c) ** 2);
  }

  function num(v, name) { if (typeof v !== "number" || !isFinite(v)) throw new Error("concept sim: car." + name + " must be a finite number"); return v; }
  function checkCar(car) {
    if (!car || typeof car !== "object") throw new Error("concept sim: car required");
    for (const k of ["mass_kg", "fuel_kg", "cog_height_m", "weight_dist_front", "track_front_m", "track_rear_m", "drivetrain_eff"]) num(car[k], k);
    for (const m of ["corner", "straight"]) for (const k of ["CLA_front_m2", "CLA_rear_m2", "CDA_m2"]) num(car.aero && car.aero[m] && car.aero[m][k], "aero." + m + "." + k);
    for (const k of ["ice_kw", "mguk_kw", "es_deploy_mj_per_lap", "es_harvest_mj_per_lap"]) num(car.pu && car.pu[k], "pu." + k);
    for (const k of ["mu_x", "mu_y", "load_sens"]) num(car.tyres && car.tyres[k], "tyres." + k);
    num(car.brakes && car.brakes.max_decel_g_mech, "brakes.max_decel_g_mech");
  }

  // ---- aero platform: ride-height-dependent aero (SIM.md §3.1). The aero load F squats the car by dh = F / k (mm); the CLA at the
  // static ride height grows by ride_sens_per_mm per mm of squat (the design layer's d(df)/d(rh), concept/aeromap.js
  // rideSensitivity), and once the squat passes the stall onset (5 mm + the design's dynamic stall margin) the floor's share of
  // the load rolls off quadratically over 25 mm to 40 % (concept/aeromap.js FLOOR). factorAt(qa) solves k dh = qa factor(dh) for the
  // first equilibrium by bisection (qa = q x CLA at the static ride height, N) and returns factor(dh); squatAt returns dh.
  function platform(car) {
    const a = car.aero || {}, FL = MODEL.floor;
    const kh = isFinite(+a.heave_n_per_mm) && +a.heave_n_per_mm > 50 ? +a.heave_n_per_mm : MODEL.heave_n_per_mm;
    const rs = isFinite(+a.ride_sens_per_mm) && a.ride_sens_per_mm !== null ? Math.max(0, +a.ride_sens_per_mm) : 0;
    const share = isFinite(+a.floor_share) && a.floor_share !== null ? Math.min(1, Math.max(0, +a.floor_share)) : FL.share;
    const sm = isFinite(+a.stall_margin_mm) && a.stall_margin_mm !== null ? +a.stall_margin_mm : FL.margin_default_mm;
    const onset = Math.max(0, FL.dyn_mm + sm);
    const factor = dh => {
      const over = dh - onset, st = over <= 0 ? 1 : Math.max(FL.stall_floor, 1 - (over / FL.stall_w_mm) ** 2);
      return (1 + rs * dh) * (1 - share + share * st);
    };
    function squatAt(qa) {
      if (!(qa > 0)) return 0;
      let lo = 0, hi = (qa * 2) / kh;
      for (let it = 0; it < 30; it++) { const mid = 0.5 * (lo + hi); if (kh * mid < qa * factor(mid)) lo = mid; else hi = mid; }
      return 0.5 * (lo + hi);
    }
    return { kh, rs, share, onset, factor, squatAt, factorAt: qa => factor(squatAt(qa)) };
  }

  // ---- per-call tables over air speed u: downforce per axle, lateral limit, traction / braking capacity, drag, rolling
  function buildTables(car, rho, cal, muWet, crrMul) {
    const NU = Math.round(MODEL.u_max / MODEL.du) + 1, m = car.mass_kg + car.fuel_kg;
    const wf = car.weight_dist_front, wr = 1 - wf, h = car.cog_height_m, ls = car.tyres.load_sens;
    const wb = isFinite(+car.wheelbase_m) && +car.wheelbase_m > 1 ? +car.wheelbase_m : REGS.wheelbase_max_m;
    const mux = car.tyres.mu_x * cal.grip_scale * muWet, muy = car.tyres.mu_y * cal.grip_scale * muWet;
    // CLA values are taken AT the static aero.ride_height_mm (the design layer, concept/aeromap.js, evaluates them there); the
    // platform model below adds the squat under aero load (ride_sens_per_mm) and the floor stall beyond the stall margin.
    // floor stall (PhysicalCar.floor_stalled, read defensively: absent = not stalled): a stalled ground-effect floor loses most
    // of its load; the sim multiplies every CLA (both modes, both axles) by MODEL.floor_stall_cla_factor. Drag is unchanged.
    const rhf = car.floor_stalled === true || (car.aero && car.aero.floor_stalled === true) ? MODEL.floor_stall_cla_factor : 1;   // aero.floor_stalled (core) or top-level
    const Fz0f = (m * G * wf) / 2, Fz0r = (m * G * wr) / 2;   // nominal (static) load per tyre
    const out = [];
    // Straight Mode only lowers wing incidence (C3.10.10 n, C3.11.6 c): it can never add load or drag, so its coefficients are
    // capped at the Corner Mode values (closes an optimiser exploit: no straight-mode drag without its downforce loss and v.v.)
    const cm = car.aero.corner, sm0 = car.aero.straight;
    const smCapped = { CLA_front_m2: Math.min(sm0.CLA_front_m2, cm.CLA_front_m2), CLA_rear_m2: Math.min(sm0.CLA_rear_m2, cm.CLA_rear_m2), CDA_m2: Math.min(sm0.CDA_m2, cm.CDA_m2) };
    const pf = platform(car), aeroFactor = rhf === 1 ? pf.factorAt : () => 1;   // a stalled floor (rhf) has no platform model on top
    for (const mode of ["corner", "straight"]) {
      const a = mode === "corner" ? cm : smCapped, AY = new Float64Array(NU), AYR = new Float64Array(NU), TR = new Float64Array(NU), BR = new Float64Array(NU), DR = new Float64Array(NU), RR = new Float64Array(NU);
      for (let k = 0; k < NU; k++) {
        const u = k * MODEL.du, q = 0.5 * rho * u * u;
        // aero platform (v2): CLA x factor(squat), the squat solved from k dh = q CLA factor(dh) (platform())
        const qa = q * (a.CLA_front_m2 + a.CLA_rear_m2) * rhf, hv = aeroFactor(qa);
        const Fzf = m * G * wf + q * a.CLA_front_m2 * rhf * hv, Fzr = m * G * wr + q * a.CLA_rear_m2 * rhf * hv;
        // axle lateral capacity with load sensitivity and lateral load transfer (split by axle mass share):
        // F = mu [Fz (1 + ls) - ls (Fz^2/2 + 2 dF^2) / Fz0], dF = m_axle a h / track  ->  quadratic in a
        const axle = (Fz, Fz0, mAx, tw, mu) => {
          const C = mu * (Fz * (1 + ls) - (ls * Fz * Fz) / (2 * Fz0)), c2 = (2 * mu * ls * (mAx * h / tw) ** 2) / Fz0;
          if (C <= 0) return 0;
          return c2 > 1e-12 ? (-mAx + Math.sqrt(mAx * mAx + 4 * c2 * C)) / (2 * c2) : C / mAx;
        };
        const ayf = axle(Fzf, Fz0f, m * wf, car.track_front_m, muy), ayr = axle(Fzr, Fz0r, m * wr, car.track_rear_m, muy);
        AY[k] = Math.min(ayf, ayr); AYR[k] = ayr;
        const cap = (Fz, Fz0) => (Fz > 0 ? Math.max(0, Fz * (1 + ls) - (ls * Fz * Fz) / (2 * Fz0)) : 0);
        DR[k] = q * a.CDA_m2 * cal.drag_scale;
        RR[k] = MODEL.crr * crrMul * (m * G + qa * hv);
        // longitudinal load transfer dF = m a_x h / wheelbase (v2): under braking the front axle gains what the rear loses, under
        // traction the driven rear axle gains. With load-sensitive tyres this lowers the braking capacity a little and raises
        // low-speed traction; fixed point (4 iterations) on the car's own deceleration / acceleration. Ideal brake balance.
        let ab = (mux * (cap(Fzf, Fz0f) + cap(Fzr, Fz0r)) + DR[k] + RR[k]) / m, Fb = 0;
        for (let it = 0; it < 4; it++) { const d = Math.min(Fzr, (m * ab * h) / wb); Fb = mux * (cap(Fzf + d, Fz0f) + cap(Fzr - d, Fz0r)); ab = (Fb + DR[k] + RR[k]) / m; }
        BR[k] = Fb;
        let at = (mux * cap(Fzr, Fz0r)) / m, Ft = 0;
        for (let it = 0; it < 4; it++) { const d = Math.min(Fzf, (m * Math.max(0, at) * h) / wb); Ft = mux * cap(Fzr + d, Fz0r); at = (Ft - DR[k] - RR[k]) / m; }
        TR[k] = Ft;                                          // rear-wheel drive
      }
      out.push({ AY, AYR, TR, BR, DR, RR });
    }
    return out;
  }

  function simulateLap(car, trackId, conditions, opts) {
    opts = opts || {}; trackId = trackId || "silverstone";
    if (typeof trackId !== "string" || !/^[a-z0-9_]+$/.test(trackId)) throw new Error("concept sim: trackId must be a circuit id such as 'silverstone' (signature: simulateLap(car, trackId, conditions, opts))");
    checkCar(car);
    const c = Object.assign({}, DEFAULT_CONDITIONS, conditions || {});
    const cal = opts.cal || activeCal();
    const tr = T.buildTrack(trackId, opts.line ? { line: opts.line } : undefined), n = tr.n;
    const fuel = c.fuel_kg != null && isFinite(+c.fuel_kg) ? +c.fuel_kg : car.fuel_kg;
    const carF = fuel === car.fuel_kg ? car : Object.assign({}, car, { fuel_kg: fuel });
    const m = carF.mass_kg + carF.fuel_kg, me = m * MODEL.rot_mass_factor, rho = airDensity(c);
    const muT = tyreTempFactor(c.track_temp_c);
    const tab = buildTables(carF, rho, cal, (c.wet ? MODEL.wet_mu : 1) * muT, c.wet ? MODEL.wet_crr : 1);
    const du = MODEL.du, NU = tab[0].AY.length;
    // linear interpolation in a table at air speed u
    const L = (arr, u) => { let x = u / du; if (x < 0) x = 0; if (x > NU - 1.001) x = NU - 1.001; const i = x | 0, t = x - i; return arr[i] + t * (arr[i + 1] - arr[i]); };
    // opts.grade_scale (default 1) scales the track gradient (0 = a flat track; for studies and tests)
    const gs = opts.grade_scale != null && isFinite(+opts.grade_scale) ? +opts.grade_scale : 1;
    const kap = tr.kappa, seg = tr.seg, grade = gs === 1 ? tr.grade : tr.grade.map(g => g * gs), zone = tr.straightZone;
    const w = new Float64Array(n);
    if (c.wind_ms) for (let i = 0; i < n; i++) w[i] = headwind(c, tr.heading[i]);
    // crosswind yaw on downforce (estimate; off unless the car has aero.yaw_sens > 0 and there is wind): grip tables are read at
    // the air speed sqrt(yaw factor) x u, so downforce scales by the factor while drag stays at u
    const ys = carF.aero && isFinite(+carF.aero.yaw_sens) ? Math.max(0, +carF.aero.yaw_sens) : MODEL.yaw_sens_default;
    const cw = c.wind_ms && ys > 0 ? new Float64Array(n) : null;
    if (cw) for (let i = 0; i < n; i++) cw[i] = crosswind(c, tr.heading[i]);
    const ugOf = cw ? (i, u) => { if (!cw[i] || u <= 0) return u; const f = Math.max(MODEL.yaw_floor, 1 - (ys * Math.atan(cw[i] / Math.max(u, 1)) * 180) / Math.PI); return u * Math.sqrt(f); } : (i, u) => u;
    const mechB = carF.brakes.max_decel_g_mech * G * m;
    // tyre slip drag (v2): cornering at lateral acceleration a_y with slip angle alpha costs F = m a_y tan(alpha), alpha growing
    // with the share r of the lateral limit used (alpha = MODEL.slip_angle_rad at the limit). It is why real 2026 laps lose
    // speed at full throttle through Abbey, Farm, Copse and Maggotts.
    // tan(alpha) by its 3-term series (alpha <= 0.12 rad: error < 1e-5 relative), cheaper in the hot loops
    const slipA = MODEL.slip_angle_rad, slipDrag = (ay, r) => { const al = slipA * (r < 1 ? r : 1), a2 = al * al; return m * ay * al * (1 + a2 * (1 / 3 + a2 * 0.13333333)); };

    // 1. apex limits: largest v with v^2 |kappa| <= ay_max(v + headwind), Corner Mode
    const vlim = new Float64Array(n), C0 = tab[0];
    let iMin = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.abs(kap[i]);
      if (k * MODEL.vcap * MODEL.vcap <= L(C0.AY, ugOf(i, MODEL.vcap + w[i]))) { vlim[i] = MODEL.vcap; }
      else {
        let lo = 0, hi = MODEL.vcap;
        for (let it = 0; it < 30; it++) { const v = 0.5 * (lo + hi); if (v * v * k <= L(C0.AY, ugOf(i, Math.max(0, v + w[i])))) lo = v; else hi = v; }
        vlim[i] = lo;
      }
      if (vlim[i] < vlim[iMin]) iMin = i;
    }
    // 2. backward pass (braking, Corner Mode: the wings close on the brakes), one lap from the slowest apex
    const vb = new Float64Array(n);
    vb[iMin] = vlim[iMin];
    for (let k = 1; k < n; k++) {
      const i = (iMin - k + n) % n, j = (i + 1) % n, v = vb[j], u = Math.max(0, v + w[j]);
      const ug = ugOf(j, u), ay = v * v * Math.abs(kap[j]), aym = L(C0.AY, ug), r = aym > 0 ? Math.min(1, ay / aym) : 1;
      const Fb = Math.min(L(C0.BR, ug) * Math.sqrt(1 - r * r), mechB);
      const dec = (Fb + L(C0.DR, u) + L(C0.RR, u) + slipDrag(ay, r) + m * G * grade[i]) / me;
      const v2 = v * v + 2 * seg[i] * Math.max(dec, 0);
      vb[i] = Math.min(vlim[i], Math.sqrt(v2));
    }
    // 3. forward pass with the energy strategy, one lap from the slowest apex. The lap energy budget (deployed <= SOC window +
    //    harvested, harvested <= recharge cap) is closed by bisection on ONE threshold x of the chosen strategy:
    //    "threshold" (default, the calibrated model of 2026 qualifying): deploy while v < x, superclip while v >= x - the
    //       speed plateau that real 2026 qualifying traps show (SIM.md §4.3);
    //    "optimal": equal-marginal-value rule - sens[i] ~ lap time gained per joule at i (sum of ds / v^3 to the next braking
    //       point on a reference lap); deploy where sens >= x, superclip where sens < x * eta^2, cheapest points first.
    const pu = carF.pu, eff = carF.drivetrain_eff, ETA = REGS.ers_eff;
    const Pice = pu.ice_kw * 1e3, kKw = Math.min(pu.mguk_kw, REGS.mguk_max_kw);
    // optional gearing (PhysicalCar.gearing = { rpm_per_kmh: [8 ratios, 1st..8th], shift_rpm }): the driver holds the lowest gear
    // under shift_rpm; below 10 500 rpm the fuel energy flow (so ICE power) is limited to (0.27 N + 165) / 3000 (C5.2.4)
    const gr = carF.gearing && Array.isArray(carF.gearing.rpm_per_kmh) && carF.gearing.rpm_per_kmh.length ? carF.gearing : null;
    const gearOf = vk => { const k = gr.rpm_per_kmh; for (let g = 0; g < k.length; g++) if (k[g] * vk <= gr.shift_rpm) return g; return k.length - 1; };
    const iceFactor = vk => { if (!gr) return 1; const N = gr.rpm_per_kmh[gearOf(vk)] * vk; return N >= 10500 ? 1 : Math.max(0.3, (0.27 * N + 165) / 3000); };
    const clipKw = Math.min(pu.superclip_kw != null ? pu.superclip_kw : MODEL.superclip_kw, kKw);
    const recLim = c.recharge_limit_mj != null && isFinite(+c.recharge_limit_mj) ? +c.recharge_limit_mj : Infinity;
    const harvCap = Math.min(pu.es_harvest_mj_per_lap, recLim, REGS.recharge_max_mj) * 1e6, depCap = pu.es_deploy_mj_per_lap * 1e6, soc = REGS.es_soc_window_mj * 1e6;
    // the store at the start of the flying lap (conditions.es_start_mj, default: the full C5.2.9 window) and the timing frame
    const socWin = soc, socStart = c.es_start_mj != null && isFinite(+c.es_start_mj) ? Math.min(socWin, Math.max(0, +c.es_start_mj * 1e6)) : socWin;
    const tim = tr.timing || TIMING[trackId] || { control_s: tr.sf, sectors: tr.sectors, trap_s: tr.sf, i1_s: tr.sectors[0], i2_s: tr.sectors[1], source: "game data sf + sector lines" };
    const iCtl = tr.idxAtS(tim.control_s);
    const strat = opts.strategy || MODEL.default_strategy;
    if (["threshold", "marginal", "optimal"].indexOf(strat) < 0) throw new Error("concept sim: opts.strategy is 'marginal', 'threshold' or 'optimal'");
    const overtake = !!opts.overtake, noClip = !!opts.no_superclip, clipGate = ETA * ETA, optimal = strat === "optimal", marginal = strat === "marginal";
    const clipRho = cal.clip_rho != null ? cal.clip_rho : MODEL.clip_rho;
    const vf = new Float64Array(n), tAt = new Float64Array(n), modeAt = new Uint8Array(n), brk = new Uint8Array(n), sens = new Float64Array(n);

    // the recharge cap is a lap total: braking harvest is free, so superclipping may only fill what braking (estimated on the
    // reference lap) leaves of it
    let clipCap = harvCap, clipSens = Infinity, clipFrac = 1, clipFracOf = () => 1, phiOut = 1;
    // hot loop: tables share one air-speed grid, so each step computes its grid index once; drag + rolling are pre-summed
    const RES0 = new Float64Array(NU), RES1 = new Float64Array(NU);
    for (let k = 0; k < NU; k++) { RES0[k] = tab[0].DR[k] + tab[0].RR[k]; RES1[k] = tab[1].DR[k] + tab[1].RR[k]; }
    const AY0 = tab[0].AY, AY1 = tab[1].AY, TR0 = tab[0].TR, TR1 = tab[1].TR;
    const gF = new Float64Array(n), absK = new Float64Array(n);
    for (let i = 0; i < n; i++) { gF[i] = m * G * grade[i]; absK[i] = Math.abs(kap[i]); }
    const inv = 1 / du, uTop = NU - 1.001, swS = MODEL.aero_switch_s, latF = MODEL.straight_lat_frac;
    const PclipMax = Math.min(clipKw * 1e3, ETA * Pice), rbs = ETA * eff * MODEL.rear_brake_share, kW = kKw * 1e3;
    function forward(x, record) {   // x < 0: reference lap (deploy everywhere, no superclip)
      let v = vb[iMin], t = 0, Edep = 0, Eclip = 0, EharvBrake = 0, zoneT = zone[iMin] ? -1e9 : Infinity;
      if (record) { vf[iMin] = v; tAt[iMin] = 0; }
      const PclipThr = noClip || x < 0 || optimal ? 0 : clipFracOf(x) * PclipMax;
      for (let k = 0, i = iMin; k < n; k++) {
        const j = i + 1 === n ? 0 : i + 1, ds = seg[i];
        let u = v + w[i]; if (u < 0) u = 0;
        let xg = u * inv; if (xg > uTop) xg = uTop;
        const g0 = xg | 0, ft = xg - g0;
        const ay = v * v * absK[i];
        // Straight Mode only inside an FIA zone, after the <= 400 ms switch (C3.10.10 o; modelled as Corner Mode until it completes)
        let md = 0;
        if (!zone[i]) zoneT = Infinity;
        else { if (zoneT === Infinity) zoneT = t; if (t - zoneT >= swS && ay <= latF * (AY1[g0] + ft * (AY1[g0 + 1] - AY1[g0]))) md = 1; }
        const AY = md ? AY1 : AY0, TR = md ? TR1 : TR0, RES = md ? RES1 : RES0;
        const aym = AY[g0] + ft * (AY[g0 + 1] - AY[g0]);
        const r = aym > 0 ? (ay < aym ? ay / aym : 1) : 1;
        const Ftrac = (TR[g0] + ft * (TR[g0 + 1] - TR[g0])) * Math.sqrt(1 - r * r);
        const vv = v > 3 ? v : 3;
        // deploy (K power limited by the C5.2.8 taper) or superclip
        let PkMech = 0, PclipElec = 0;
        if (x < 0 || (optimal || marginal ? sens[i] >= x : v < x)) { const tp = mgukTaperKw(v * 3.6, overtake); PkMech = ETA * 1e3 * (tp < kKw ? (tp > 0 ? tp : 0) : kKw); }
        else if (optimal) { if (!noClip && Eclip < clipCap && sens[i] < x * clipGate && sens[i] < clipSens) PclipElec = PclipMax; }
        else if (!marginal || sens[i] < x * clipRho) PclipElec = PclipThr;   // threshold / marginal: uniform power share
        const PiceN = gr ? Pice * iceFactor(v * 3.6) : Pice;
        if (PclipElec > ETA * PiceN) PclipElec = ETA * PiceN;
        const Fice = (eff * (PiceN - PclipElec / ETA)) / vv, Ffull = Fice + (eff * PkMech) / vv;
        const Fx = Ffull < Ftrac ? Ffull : Ftrac;
        const PkUsed = Fx > Fice ? Math.min(PkMech, ((Fx - Fice) * vv) / eff) : 0;
        const a = (Fx - (RES[g0] + ft * (RES[g0 + 1] - RES[g0])) - slipDrag(ay, r) - gF[i]) / me;
        const v2 = v * v + 2 * a * ds;
        let vn = v2 > 1 ? Math.sqrt(v2) : 1, dt;
        if (vn > vb[j]) {
          // braking or part throttle: follow the backward-pass speed; the K harvests from the rear-axle brake force
          vn = vb[j]; dt = (2 * ds) / (v + vn);
          let u0 = 0.5 * (v + vn) + w[i]; if (u0 < 0) u0 = 0;
          let x0 = u0 * inv; if (x0 > uTop) x0 = uTop;
          const h0 = x0 | 0, f0 = x0 - h0;
          const Fbrake = (me * (v * v - vn * vn)) / (2 * ds) - (RES0[h0] + f0 * (RES0[h0 + 1] - RES0[h0])) - slipDrag(ay, r) - gF[i];
          if (Fbrake > 0 && EharvBrake < harvCap) {
            const P = Math.min(kW, rbs * Fbrake * 0.5 * (v + vn));
            EharvBrake = Math.min(harvCap, EharvBrake + P * dt);
          }
          if (record) { modeAt[i] = 0; brk[i] = 1; }
        } else {
          dt = (2 * ds) / (v + vn);
          Edep += (PkUsed / ETA) * dt;
          if (PclipElec > 0) Eclip += PclipElec * dt;
          if (record) { modeAt[i] = md; brk[i] = 0; }
        }
        t += dt; v = vn;
        if (record && k < n - 1) { vf[j] = v; tAt[j] = t; }
        i = j;
      }
      const Eharv = Math.min(harvCap, EharvBrake + Eclip);
      return { t, Edep, Eharv, EharvBrake, Eclip, EharvPart: 0, vEnd: v };
    }
    // ---- v2 "optimal" strategy (the default): bang-bang deployment and superclip chosen by the lap-time value of a joule.
    // forwardOpt(x, y): the K deploys (C5.2.8 taper, traction permitting) where sens >= x and superclips at full clip power where
    // 0 < sens <= y; x < 0 is the reference lap (deploy everywhere, no clip). Where the speed is set by grip (braking, or part
    // throttle through a corner) the K harvests for free: the rear-axle share of the brake force, and at part throttle the ICE's
    // surplus over what the corner lets the car use (the ICE stays at full fuel flow; C5.2.10 counts all of it as Recharge).
    const lim = new Uint8Array(n), tl = new Uint8Array(n), pw = new Float64Array(n);
    const shiftS = Math.min(MODEL.upshift_cut_max_s, Math.max(0, MODEL.upshift_cut_s));
    const partHarv = opts.part_throttle_harvest !== false;
    // per-segment energy flows of the last forward pass (J, electrical): deploy, harvest under braking, at part throttle, superclip
    const eD = new Float64Array(n), eB = new Float64Array(n), eP = new Float64Array(n), eC = new Float64Array(n);
    function forwardOpt(x, y, record) {
      let v = vb[iMin], t = 0, zoneT = zone[iMin] ? -1e9 : Infinity, cut = 0;
      const lx = x > 0 ? Math.log(x) : 0, ly = y > 0 ? Math.log(y) : -Infinity, isoft = 1 / MODEL.opt_soft;
      const cutOn = !!gr && shiftS > 0; let gHeld = cutOn ? gearOf(v * 3.6) : 0;   // the gear held (hysteresis: no re-cut on a dip)
      if (record) { vf[iMin] = v; tAt[iMin] = 0; }
      for (let k = 0, i = iMin; k < n; k++) {
        const j = i + 1 === n ? 0 : i + 1, ds = seg[i];
        let u = v + w[i]; if (u < 0) u = 0;
        let xg = u * inv; if (xg > uTop) xg = uTop;
        const g0 = xg | 0, ft = xg - g0;
        // grip tables at the yaw-corrected air speed (= u without crosswind yaw)
        let gg = g0, gt = ft; if (cw) { let xq = ugOf(i, u) * inv; if (xq > uTop) xq = uTop; gg = xq | 0; gt = xq - gg; }
        const ay = v * v * absK[i];
        let md = 0;
        if (!zone[i]) zoneT = Infinity;
        else { if (zoneT === Infinity) zoneT = t; if (t - zoneT >= swS && ay <= latF * (AY1[gg] + gt * (AY1[gg + 1] - AY1[gg]))) md = 1; }
        const AY = md ? AY1 : AY0, TR = md ? TR1 : TR0, RES = md ? RES1 : RES0;
        const aym = AY[gg] + gt * (AY[gg + 1] - AY[gg]);
        const r = aym > 0 ? (ay < aym ? ay / aym : 1) : 1;
        const Ftrac = (TR[gg] + gt * (TR[gg + 1] - TR[gg])) * Math.sqrt(1 - r * r);
        const vv = v > 3 ? v : 3, s = sens[i];
        let PkMech = 0, PclipElec = 0;
        // soft bang-bang: the share of full deployment / full superclip is a logistic function of log(sens) around the thresholds
        // (width MODEL.opt_soft), so the lap is a smooth function of the car (a hard switch made 0.1 s jumps between nearby cars)
        let fd = 1, fc = 0;
        if (x >= 0) { fd = s > 0 ? 1 / (1 + Math.exp((lx - Math.log(s)) * isoft)) : 0; if (!noClip && s > 0 && y > 0) fc = (1 - fd) / (1 + Math.exp((Math.log(s) - ly) * isoft)); }
        if (fd > 1e-4) { const tp = mgukTaperKw(v * 3.6, overtake); PkMech = fd * ETA * 1e3 * (tp < kKw ? (tp > 0 ? tp : 0) : kKw); }
        if (fc > 1e-4) PclipElec = fc * PclipMax;
        const PiceN = gr ? Pice * iceFactor(v * 3.6) : Pice;
        if (PclipElec > ETA * PiceN) PclipElec = ETA * PiceN;
        const Fice = (eff * (PiceN - PclipElec / ETA)) / vv, Ffull = Fice + (eff * PkMech) / vv;
        // upshift torque cut: no drive force (ICE or K) for the share phi of this step that is still inside a cut (continuous in
        // the car's parameters: the cut is consumed in fractions of a step)
        const dtE = ds / vv, phi = cut > 0 ? (cut < dtE ? cut / dtE : 1) : 0;
        const Fx = (1 - phi) * (Ffull < Ftrac ? Ffull : Ftrac);
        const PkUsed = Fx > Fice ? Math.min(PkMech, ((Fx - Fice) * vv) / eff) : 0;
        const resF = RES[g0] + ft * (RES[g0 + 1] - RES[g0]);
        const slip = slipDrag(ay, r), a = (Fx - resF - slip - gF[i]) / me;
        const v2 = v * v + 2 * a * ds;
        let vn = v2 > 1 ? Math.sqrt(v2) : 1, dt;
        eD[i] = 0; eB[i] = 0; eP[i] = 0; eC[i] = 0;
        if (vn > vb[j]) {
          vn = vb[j]; dt = (2 * ds) / (v + vn);
          const vm = 0.5 * (v + vn);
          let u0 = vm + w[i]; if (u0 < 0) u0 = 0;
          let x0 = u0 * inv; if (x0 > uTop) x0 = uTop;
          const h0 = x0 | 0, f0 = x0 - h0, R0 = md ? RES1 : RES0;
          const Freq = (me * (vn * vn - v * v)) / (2 * ds) + (R0[h0] + f0 * (R0[h0 + 1] - R0[h0])) + slip + gF[i];   // > 0: part throttle
          if (Freq < 0) eB[i] = Math.min(kW, rbs * -Freq * vm) * dt;
          else {
            const crank = (Freq * vm) / eff;   // crank power the corner lets the car use
            if (crank > PiceN) eD[i] = ((crank - PiceN) / ETA) * dt;   // the K tops up (counted against the budget)
            else if (partHarv) eP[i] = Math.min(kW, ETA * (PiceN - crank)) * dt;
          }
          if (record) { modeAt[i] = md; brk[i] = Freq < 0 ? 1 : 0; lim[i] = 1; tl[i] = 0; pw[i] = 0; }
          if (cutOn) { const gn = gearOf(vn * 3.6); if (gn < gHeld) gHeld = gn; }   // downshifts follow the speed (no cut)
        } else {
          dt = (2 * ds) / (v + vn);
          if (phi > 0) cut -= phi * dtE;
          if (cutOn) { const gn = gearOf(vn * 3.6); if (gn > gHeld) { cut += shiftS * (gn - gHeld); gHeld = gn; } }
          eD[i] = (PkUsed / ETA) * dt;
          if (PclipElec > 0) eC[i] = PclipElec * dt;
          if (record) { modeAt[i] = md; brk[i] = 0; lim[i] = 0; tl[i] = Ffull >= Ftrac ? 1 : 0; pw[i] = Ffull * vv; }
        }
        t += dt; v = vn;
        if (record && k < n - 1) { vf[j] = v; tAt[j] = t; }
        i = j;
      }
      return Object.assign(ledger(), { t, vEnd: v });
    }
    // the energy store over the flying lap, from the control line (C5.2.9 / C5.2.10): it starts at socStart (default the full
    // 4 MJ window, charged on the out-lap) and may never go below empty; harvest is stored only while the store is below the
    // top of its window and the lap's recharge total is below the cap (the rest is not harvested: friction brakes / no clip).
    // feasible: the store never runs empty and deployment stays within the car's own cap.
    function ledger() {
      let soc = socStart, Edep = 0, H = 0, hB = 0, hP = 0, hC = 0, socMin = socStart;
      for (let k = 0; k < n; k++) {
        const i = (iCtl + k) % n, h = eB[i] + eP[i] + eC[i];
        if (h > 0) {
          const st = Math.min(h, harvCap - H, socWin - soc);
          if (st > 0) { const f = st / h; H += st; soc += st; hB += eB[i] * f; hP += eP[i] * f; hC += eC[i] * f; }
        }
        if (eD[i] > 0) { soc -= eD[i]; Edep += eD[i]; if (soc < socMin) socMin = soc; }
      }
      return { Edep, Eharv: H, EharvBrake: hB, EharvPart: hP, Eclip: hC, socMin, socEnd: soc, ok: socMin >= -1 && Edep <= depCap + 1 };
    }
    // costate of kinetic energy along a recorded lap (seconds gained per J/kg added at i): backward recursion
    // sens_i = ds/v^3 + sens_{i+1} (1 + ds dF/de), dF/de = (dF_prop/dv - dF_res/dv) / (m_e v), with dF_prop/dv = -P/v^2 when
    // power-limited and 0 when traction-limited; reset to 0 where the speed is set by grip (braking or a corner). Two sweeps so
    // the lap wrap-around settles. This is the adjoint of the forward pass: deploying where it is largest buys the most time per
    // joule, and superclipping where it is smallest costs the least - deploy hard early on a straight, harvest at its end.
    function computeSens() {
      let acc = 0; sMin = Infinity; sMax = 0;
      for (let sweep = 0; sweep < 2; sweep++) for (let k = n - 1; k >= 0; k--) {
        const i = (iMin + k) % n;
        if (lim[i]) acc = 0;
        else {
          const v = vf[i] > 3 ? vf[i] : 3, R = modeAt[i] ? RES1 : RES0;
          let x0 = (v + w[i] > 0 ? v + w[i] : 0) * inv; if (x0 > uTop) x0 = uTop;
          const h0 = x0 | 0, dRes = (R[h0 + 1] - R[h0]) * inv, dProp = tl[i] ? 0 : -pw[i] / (v * v);
          const f = 1 + (seg[i] * (dProp - dRes)) / (me * v);
          acc = acc * (f > 0 ? f : 0) + seg[i] / (v * v * v);
        }
        sens[i] = acc;
      }
      for (let i = 0; i < n; i++) if (sens[i] > 0) { if (sens[i] < sMin) sMin = sens[i]; if (sens[i] > sMax) sMax = sens[i]; }
    }
    // superclip threshold that fills what free harvest leaves of the recharge cap, on a recorded lap (cheapest joules first)
    function clipCapSens(r) {
      const left = harvCap - (r.EharvBrake + r.EharvPart);
      if (noClip || left <= 0) return 0;
      const pts = [];
      for (let i = 0; i < n; i++) if (!lim[i] && sens[i] > 0) {
        const j = (i + 1) % n, P = Math.min(PclipMax, ETA * (gr ? Pice * iceFactor(vf[i] * 3.6) : Pice));
        pts.push([sens[i], (P * 2 * seg[i]) / (vf[i] + vf[j])]);
      }
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let e = 0; for (const [sv, de] of pts) { e += de; if (e >= left) return sv; }
      return Infinity;
    }
    const budget = r => Math.min(depCap, soc + r.Eharv);
    let sMin = Infinity, sMax = 0, yOut = null;
    let res = optimal ? forwardOpt(-1, 0, true) : forward(-1, true), lam = -1;   // reference lap: deploy everywhere, no superclip
    // lap-time sensitivity per joule from the reference lap (two sweeps so the wrap-around settles)
    if (res.Edep > budget(res) && marginal) {
      // soft reset: the running sum decays with the reference lap's deceleration (none while coasting below 1 m/s2, full above
      // 5 m/s2), so a marginal lift does not split a straight - sens stays a continuous function of the car
      let acc = 0;
      for (let sweep = 0; sweep < 2; sweep++) for (let k = n - 1; k >= 0; k--) {
        const i = (iMin + k) % n, j = (i + 1) % n, v = Math.max(vf[i], 3);
        const dec = (vf[i] * vf[i] - vf[j] * vf[j]) / (2 * seg[i]), keep = 1 - Math.min(1, Math.max(0, (dec - 1) / 4));
        acc = keep * acc + seg[i] / (v * v * v); sens[i] = acc;
      }
      for (let i = 0; i < n; i++) if (sens[i] > 0) { if (sens[i] < sMin) sMin = sens[i]; if (sens[i] > sMax) sMax = sens[i]; }
    }
    if (res.Edep > budget(res) && !optimal) {
      // "marginal" / "threshold": one bisection on the threshold x. The superclip share is a closed-form function of x, fixed on
      // the reference lap: share(x) = clipCapRef / (P_clip,max * time the reference lap spends at full throttle in the clip set
      // of x), so superclip fills what braking (reference lap) leaves of the recharge cap. No fixed-point iteration: the result
      // is a single-valued, near-continuous function of the car (an iterated split had two stable solutions 0.1 s apart).
      clipCap = Math.max(0, harvCap - res.EharvBrake);
      const keys = [], dts = [];
      for (let i = 0; i < n; i++) if (!brk[i]) { const j = (i + 1) % n; keys.push(marginal ? sens[i] : vf[i]); dts.push((2 * seg[i]) / (vf[i] + vf[j])); }
      const ord = keys.map((v, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
      const sk = ord.map(i => keys[i]), cum = new Float64Array(ord.length + 1);
      for (let k = 0; k < ord.length; k++) cum[k + 1] = cum[k] + dts[ord[k]];
      // reference time in the clip set: marginal -> keys below x; threshold -> keys (speeds) at or above x
      const tClip = x => { let lo = 0, hi = sk.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sk[m] < x) lo = m + 1; else hi = m; } return marginal ? cum[lo] : cum[sk.length] - cum[lo]; };
      // superclip is optional: the share fills phi x clipCap, and phi in [0, 1] is chosen for the fastest lap (golden-section,
      // MODEL.clip_search evaluations, each a bisection on x). More recharge allowance then cannot force a materially slower lap (search tolerance ~0.01 s).
      let phi = 1;
      clipFracOf = x => { const tc = tClip(x); return tc > 0 ? Math.min(1, (phi * clipCap) / (PclipMax * tc)) : 1; };
      const X = v => (marginal ? Math.exp(v) : v);
      const solve = iters => {
        let lo, hi;
        if (marginal) { lo = Math.log(sMin) - 1; hi = Math.log(sMax) + 1; } else { lo = 0; hi = MODEL.vcap + 5; }
        // marginal: infeasible at lo (deploy everywhere), feasible at hi; threshold: feasible at lo (no deploy), infeasible at hi
        for (let it = 0; it < iters; it++) {
          const mid = 0.5 * (lo + hi), r = forward(X(mid), false), ok = r.Edep <= budget(r);
          if (marginal) { if (ok) hi = mid; else lo = mid; } else { if (ok) lo = mid; else hi = mid; }
        }
        return X(marginal ? hi : lo);
      };
      if (!noClip && clipCap > 0) {
        const lapAt = p => { phi = p; return forward(solve(MODEL.clip_search_iters), false).t; };
        const gr = 0.6180339887;
        let a = 0, b = 1, c1 = b - gr * (b - a), c2 = a + gr * (b - a), f1 = lapAt(c1), f2 = lapAt(c2);
        for (let k = 2; k < MODEL.clip_search; k++) {
          if (f1 <= f2) { b = c2; c2 = c1; f2 = f1; c1 = b - gr * (b - a); f1 = lapAt(c1); }
          else { a = c1; c1 = c2; f1 = f2; c2 = a + gr * (b - a); f2 = lapAt(c2); }
        }
        const fEnd = lapAt(1), best = f1 <= f2 ? c1 : c2;
        phi = Math.min(f1, f2) < fEnd ? best : 1; phiOut = phi;
      }
      lam = solve(MODEL.lambda_iters);
      res = forward(lam, true);
      clipFrac = clipFracOf(lam);
    } else if (optimal && !res.ok) {
      // "optimal" (v2 default): equal marginal value. Deploy where sens >= x; superclip where sens <= y = min(x eta^2, y_cap):
      // a superclipped joule costs sens/eta of mechanical work and returns eta of it when deployed, so clipping pays only below
      // x eta^2, and y_cap stops it at what free harvest leaves of the recharge cap. Raising x lowers deployment and raises
      // clipping, so the store (ledger(): never empty within the lap, recharge cap) closes by one bisection on x. MODEL.opt_refine re-derives sens and y_cap on the solved lap.
      for (let pass = 0; pass <= MODEL.opt_refine; pass++) {
        computeSens();
        const yCap = clipCapSens(res);
        let lo = Math.log(sMin) - 1, hi = Math.log(sMax) + 1;   // feasible at hi (no deploy), infeasible at lo
        const yOf = x => Math.min(x * clipGate, yCap);
        for (let it = 0; it < MODEL.lambda_iters; it++) { const mid = 0.5 * (lo + hi), x = Math.exp(mid), r = forwardOpt(x, yOf(x), false); if (r.ok) hi = mid; else lo = mid; }
        lam = Math.exp(hi); yOut = yOf(lam);
        res = forwardOpt(lam, yOut, true);
      }
    }

    // 4. outputs in the FIA timing frame (TIMING): S1 control line -> sector line 1, S2 -> line 2, S3 -> control line
    const tOf = s => tAt[tr.idxAtS(s)], vAt = s => vf[tr.idxAtS(s)], lap = res.t;
    const t0 = tOf(tim.control_s), t1 = tOf(tim.sectors[0]), t2 = tOf(tim.sectors[1]);
    const wrap = x => ((x % lap) + lap) % lap;
    const s1 = wrap(t1 - t0), s2 = wrap(t2 - t1), s3 = lap - s1 - s2;
    let vmax = 0, vmin = 1e9; for (let i = 0; i < n; i++) { if (vf[i] > vmax) vmax = vf[i]; if (vf[i] < vmin) vmin = vf[i]; }
    const r3 = x => Math.round(x * 1000) / 1000, r1 = x => Math.round(x * 10) / 10;
    const out = {
      lap_s: r3(lap), sectors_s: [r3(s1), r3(s2), r3(s3)],
      vmax_kmh: r1(vmax * 3.6), speed_trap_kmh: r1(vAt(tim.trap_s) * 3.6), vmin_kmh: r1(vmin * 3.6),
      energy: { deployed_mj: r3(res.Edep / 1e6), harvested_mj: r3(res.Eharv / 1e6), harvested_braking_mj: r3(Math.min(res.EharvBrake, res.Eharv) / 1e6), harvested_superclip_mj: r3(Math.max(0, res.Eharv - Math.min(res.EharvBrake, res.Eharv) - (res.EharvPart || 0)) / 1e6), harvested_part_throttle_mj: r3((res.EharvPart || 0) / 1e6), recharge_cap_mj: r3(harvCap / 1e6), superclip_share: optimal ? null : r3(clipFrac), superclip_fill: optimal ? null : r3(phiOut), energy_limited: lam >= 0, soc_start_mj: optimal ? r3(socStart / 1e6) : null, soc_min_mj: optimal ? r3(res.socMin / 1e6) : null, soc_end_mj: optimal ? r3(res.socEnd / 1e6) : null, strategy: strat, deploy_ceiling_kmh: strat === "threshold" && lam >= 0 ? r1(lam * 3.6) : null },
      speeds_kmh: { intermediate_1: r1(vAt(tim.i1_s) * 3.6), intermediate_2: r1(vAt(tim.i2_s) * 3.6), finish_line: r1(vAt(tim.control_s) * 3.6) },
      air_density_kgm3: r3(rho), label: LABEL,
    };
    if (opts.trace) {
      // s_m from the control line along the centreline frame; one sample per track point
      const i0 = tr.idxAtS(tim.control_s), s_m = new Array(n), v_kmh = new Array(n), mode = new Array(n);
      for (let k = 0; k < n; k++) { const i = (i0 + k) % n; s_m[k] = r1(k * tr.ds); v_kmh[k] = r1(vf[i] * 3.6); mode[k] = modeAt[i] ? "straight" : "corner"; }
      const t_s = new Array(n); for (let k = 0; k < n; k++) t_s[k] = Math.round(wrap(tAt[(i0 + k) % n] - t0) * 1e4) / 1e4;
      out.trace = { s_m, v_kmh, t_s, aero_mode: mode };
      if (gr) { out.trace.gear = v_kmh.map(v => gearOf(v) + 1); out.trace.rpm = v_kmh.map(v => Math.round(gr.rpm_per_kmh[gearOf(v)] * v)); }
    }
    // per corner (telemetry line: the MultiViewer markers; window 70 m before to 90 m after the marker): minimum speed and where,
    // apex speed (at the line's tightest point) and the lateral g there
    if (tr.corners && tr.corners.length && tr.corners[0].d != null) {
      const names = CORNER_NAMES[trackId] || {};
      out.corners = tr.corners.map(k => {
        let vm = Infinity, sm = 0, kb = 0, ia = tr.idxAtS(k.d);
        for (let d = k.d - 70; d <= k.d + 90; d += tr.ds) { const i = tr.idxAtS(d); if (vf[i] < vm) { vm = vf[i]; sm = d; } const kk = Math.abs(kap[i]); if (kk > kb) { kb = kk; ia = i; } }
        return { n: k.n, name: (names[k.n] || "T") + " (T" + k.n + ")", marker_m: k.d, min_kmh: r1(vm * 3.6), min_at_m: r1(((sm % tr.L) + tr.L) % tr.L), apex_kmh: r1(vf[ia] * 3.6), apex_radius_m: Math.round(1 / Math.max(kb, 1e-6)), apex_lat_g: Math.round(((vf[ia] * vf[ia] * kb) / G) * 100) / 100 };
      });
    }
    if (opts.debug) out.debug = { vf, vb, vlim, tAt, sens, track: tr, iMin, lambda: lam, clip_threshold: yOut, lim, modeAt };
    return out;
  }

  // grip envelope of a car at one speed (still air, default conditions unless given): lateral limit (Corner Mode, min of the
  // axles), braking deceleration (tyres + drag + rolling, capped by brakes.max_decel_g_mech), traction-limited acceleration. In g.
  // Used to compare the sim's cars with model-independent telemetry measurements (lateral limit vs speed, braking).
  function capacity(car, kmh, conditions) {
    checkCar(car);
    const c = Object.assign({}, DEFAULT_CONDITIONS, conditions || {}), rho = airDensity(c), m = car.mass_kg + car.fuel_kg;
    const tab = buildTables(car, rho, { grip_scale: 1, drag_scale: 1 }, (c.wet ? MODEL.wet_mu : 1) * tyreTempFactor(c.track_temp_c), c.wet ? MODEL.wet_crr : 1)[0];
    const x = Math.min(tab.AY.length - 1.001, kmh / 3.6 / MODEL.du), i = x | 0, f = x - i, L = a => a[i] + f * (a[i + 1] - a[i]);
    const Fb = Math.min(L(tab.BR), car.brakes.max_decel_g_mech * G * m);
    return { ay_g: L(tab.AY) / G, brake_g: (Fb + L(tab.DR) + L(tab.RR)) / (m * MODEL.rot_mass_factor * G), traction_g: (L(tab.TR) - L(tab.DR) - L(tab.RR)) / (m * MODEL.rot_mass_factor * G) };
  }

  // ---- weekend conditions from concept/data (Node only, optional). Reads concept/data/silverstone-2026-weekend.json when
  // present (qualifying weather mid-range + the qualifying recharge limit); otherwise null and DEFAULT_CONDITIONS apply.
  function mid(r) { return r && isFinite(+r.min) && isFinite(+r.max) ? (+r.min + +r.max) / 2 : null; }
  function parseWeekend(j, session) {
    if (!j || !Array.isArray(j.sessions)) return null;
    const ses = j.sessions.find(x => x.session === (session || "Qualifying"));
    if (!ses || !ses.weather) return null;
    const w = ses.weather, out = {};
    const r1 = x => Math.round(x * 100) / 100;
    if (mid(w.air_temp_c) != null) out.air_temp_c = r1(mid(w.air_temp_c));
    if (mid(w.track_temp_c) != null) out.track_temp_c = r1(mid(w.track_temp_c));
    if (mid(w.air_pressure_mbar) != null) out.air_pressure_hpa = r1(mid(w.air_pressure_mbar));
    if (mid(w.humidity_pct) != null) out.humidity_pct = r1(mid(w.humidity_pct));
    out.wind_ms = 0; out.wind_from_deg = 0;   // no numeric wind direction is published (chart only)
    out.wet = typeof w.rainfall === "string" ? !/^dry/i.test(w.rainfall) : false;
    const lim = j.energy_limits && j.energy_limits.max_recharge_per_lap_MJ;
    if (lim && isFinite(+lim.sprint_qualifying_and_qualifying)) out.recharge_limit_mj = +lim.sprint_qualifying_and_qualifying;
    return out;
  }
  function loadWeekendConditions(dir) {
    if (typeof require !== "function") return null;
    try {
      const fs = require("fs"), path = require("path");
      const f = path.join(dir || path.join(__dirname, "..", "data"), "silverstone-2026-weekend.json");
      if (!fs.existsSync(f)) return null;
      const out = parseWeekend(JSON.parse(fs.readFileSync(f, "utf8")));
      if (out) out.source = "concept/data/silverstone-2026-weekend.json";
      return out;
    } catch (e) { return null; }
  }

  const api = { LABEL, REGS, MODEL, DEFAULT_CONDITIONS, TIMING, CORNER_NAMES, mgukTaperKw, capacity, crosswind, tyreTempFactor, platform, parseWeekend, baselineCar, priorCar, simulateLap, airDensity, headwind, loadWeekendConditions, activeCal };
  EI.conceptSim = Object.assign(EI.conceptSim || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
