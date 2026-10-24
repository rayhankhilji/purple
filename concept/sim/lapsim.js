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
    floor_stall_cla_factor: 0.5, // a stalled floor (PhysicalCar.floor_stalled) keeps half of the car's CLA (assumption: floor ~50-60 % of load)
    aero_switch_s: 0.4,         // Corner -> Straight Mode transition time (C3.10.10 o / C3.11.6 d: at most 400 ms; worst case used)
    straight_lat_frac: 0.5,     // Straight Mode is closed if lateral demand exceeds this share of Straight Mode grip
    u_max: 115, du: 0.5,        // air-speed table range and step (m/s)
    vcap: 105,                  // apex-limit search ceiling (m/s, 378 km/h)
    pressure_hpa: 1007.6,       // used when the conditions give neither density nor pressure (2026 British GP qualifying mid-range)
    default_strategy: "threshold", // energy strategy used when opts.strategy is not given (see section 3)
    clip_rho: 1,                // "marginal" strategy: superclip where sensitivity < rho x deploy threshold (cal.clip_rho overrides)
    lambda_iters: 22,           // bisection iterations of the strategy threshold
    clip_search: 5,             // golden-section evaluations of the superclip amount (phi)
    clip_search_iters: 13,      // bisection iterations inside that search
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

  // ---- a plausible 2026 car (SIM.md §3 has the source / status of every number)
  // generic prior (sourced magnitudes / assumptions); baselineCar() replaces the estimated fields with fitted.js values
  function priorCar() {
    return {
      id: "prior-2026", label: "generic 2026 prior car (sourced magnitudes, not estimated)",
      mass_kg: 768,              // C4.1 qualifying: 726 kg + Nominal Tyre Mass (~42 kg assumed); car + driver, no fuel
      fuel_kg: 8,                // qualifying run fuel (assumption)
      wheelbase_m: 3.4,          // C2.3.3 maximum
      track_front_m: 1.6, track_rear_m: 1.55, // assumption (1900 mm max car width)
      cog_height_m: 0.28,        // assumption
      weight_dist_front: 0.45,   // between C4.2 limits (front >= 0.44, rear >= 0.54 of minimum mass)
      aero: {
        corner: { CLA_front_m2: 1.8, CLA_rear_m2: 2.3, CDA_m2: 1.0 },     // assumption: ~30 % less load than a ~5.5-6 m2 2025 car (FIA 2024 claim)
        straight: { CLA_front_m2: 0.8, CLA_rear_m2: 0.8, CDA_m2: 0.55 },  // assumption: wings opened (C3.10 / C3.11 Straight Mode), ~55 % less drag
        ride_height_mm: 35, ride_sens_per_mm: 0.006,                      // CLA above is at this ride height; sensitivity is informational
      },
      pu: { ice_kw: 400, mguk_kw: 350, es_deploy_mj_per_lap: 12.5, es_harvest_mj_per_lap: 8.5 },
      tyres: { mu_x: 1.7, mu_y: 1.8, load_sens: 0.15, radius_m: 0.36, compound: "soft" },
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
      Object.assign(c.tyres, e.tyres);
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

  function num(v, name) { if (typeof v !== "number" || !isFinite(v)) throw new Error("concept sim: car." + name + " must be a finite number"); return v; }
  function checkCar(car) {
    if (!car || typeof car !== "object") throw new Error("concept sim: car required");
    for (const k of ["mass_kg", "fuel_kg", "cog_height_m", "weight_dist_front", "track_front_m", "track_rear_m", "drivetrain_eff"]) num(car[k], k);
    for (const m of ["corner", "straight"]) for (const k of ["CLA_front_m2", "CLA_rear_m2", "CDA_m2"]) num(car.aero && car.aero[m] && car.aero[m][k], "aero." + m + "." + k);
    for (const k of ["ice_kw", "mguk_kw", "es_deploy_mj_per_lap", "es_harvest_mj_per_lap"]) num(car.pu && car.pu[k], "pu." + k);
    for (const k of ["mu_x", "mu_y", "load_sens"]) num(car.tyres && car.tyres[k], "tyres." + k);
    num(car.brakes && car.brakes.max_decel_g_mech, "brakes.max_decel_g_mech");
  }

  // ---- per-call tables over air speed u: downforce per axle, lateral limit, traction / braking capacity, drag, rolling
  function buildTables(car, rho, cal, muWet, crrMul) {
    const NU = Math.round(MODEL.u_max / MODEL.du) + 1, m = car.mass_kg + car.fuel_kg;
    const wf = car.weight_dist_front, wr = 1 - wf, h = car.cog_height_m, ls = car.tyres.load_sens;
    const mux = car.tyres.mu_x * cal.grip_scale * muWet, muy = car.tyres.mu_y * cal.grip_scale * muWet;
    // CLA values are taken AT aero.ride_height_mm (the design layer, concept/aeromap.js, already evaluates them there);
    // ride_sens_per_mm is carried for reporting only - the sim has no heave / ride-height-vs-speed model (SIM.md §7)
    // floor stall (PhysicalCar.floor_stalled, read defensively: absent = not stalled): a stalled ground-effect floor loses most
    // of its load; the sim multiplies every CLA (both modes, both axles) by MODEL.floor_stall_cla_factor. Drag is unchanged.
    const rhf = car.floor_stalled === true || (car.aero && car.aero.floor_stalled === true) ? MODEL.floor_stall_cla_factor : 1;   // aero.floor_stalled (core) or top-level
    const Fz0f = (m * G * wf) / 2, Fz0r = (m * G * wr) / 2;   // nominal (static) load per tyre
    const out = [];
    // Straight Mode only lowers wing incidence (C3.10.10 n, C3.11.6 c): it can never add load or drag, so its coefficients are
    // capped at the Corner Mode values (closes an optimiser exploit: no straight-mode drag without its downforce loss and v.v.)
    const cm = car.aero.corner, sm0 = car.aero.straight;
    const smCapped = { CLA_front_m2: Math.min(sm0.CLA_front_m2, cm.CLA_front_m2), CLA_rear_m2: Math.min(sm0.CLA_rear_m2, cm.CLA_rear_m2), CDA_m2: Math.min(sm0.CDA_m2, cm.CDA_m2) };
    for (const mode of ["corner", "straight"]) {
      const a = mode === "corner" ? cm : smCapped, AY = new Float64Array(NU), AYR = new Float64Array(NU), TR = new Float64Array(NU), BR = new Float64Array(NU), DR = new Float64Array(NU), RR = new Float64Array(NU);
      for (let k = 0; k < NU; k++) {
        const u = k * MODEL.du, q = 0.5 * rho * u * u;
        const Fzf = m * G * wf + q * a.CLA_front_m2 * rhf, Fzr = m * G * wr + q * a.CLA_rear_m2 * rhf;
        // axle lateral capacity with load sensitivity and lateral load transfer (split by axle mass share):
        // F = mu [Fz (1 + ls) - ls (Fz^2/2 + 2 dF^2) / Fz0], dF = m_axle a h / track  ->  quadratic in a
        const axle = (Fz, Fz0, mAx, tw, mu) => {
          const C = mu * (Fz * (1 + ls) - (ls * Fz * Fz) / (2 * Fz0)), c2 = (2 * mu * ls * (mAx * h / tw) ** 2) / Fz0;
          if (C <= 0) return 0;
          return c2 > 1e-12 ? (-mAx + Math.sqrt(mAx * mAx + 4 * c2 * C)) / (2 * c2) : C / mAx;
        };
        const ayf = axle(Fzf, Fz0f, m * wf, car.track_front_m, muy), ayr = axle(Fzr, Fz0r, m * wr, car.track_rear_m, muy);
        AY[k] = Math.min(ayf, ayr); AYR[k] = ayr;
        const cap = (Fz, Fz0) => Math.max(0, Fz * (1 + ls) - (ls * Fz * Fz) / (2 * Fz0));
        TR[k] = mux * cap(Fzr, Fz0r);                       // rear-wheel drive
        BR[k] = mux * (cap(Fzf, Fz0f) + cap(Fzr, Fz0r));    // ideal brake balance assumed
        DR[k] = q * a.CDA_m2 * cal.drag_scale;
        RR[k] = MODEL.crr * crrMul * (m * G + q * (a.CLA_front_m2 + a.CLA_rear_m2) * rhf);
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
    const tab = buildTables(carF, rho, cal, c.wet ? MODEL.wet_mu : 1, c.wet ? MODEL.wet_crr : 1);
    const du = MODEL.du, NU = tab[0].AY.length;
    // linear interpolation in a table at air speed u
    const L = (arr, u) => { let x = u / du; if (x < 0) x = 0; if (x > NU - 1.001) x = NU - 1.001; const i = x | 0, t = x - i; return arr[i] + t * (arr[i + 1] - arr[i]); };
    const kap = tr.kappa, seg = tr.seg, grade = tr.grade, zone = tr.straightZone;
    const w = new Float64Array(n);
    if (c.wind_ms) for (let i = 0; i < n; i++) w[i] = headwind(c, tr.heading[i]);
    const mechB = carF.brakes.max_decel_g_mech * G * m;

    // 1. apex limits: largest v with v^2 |kappa| <= ay_max(v + headwind), Corner Mode
    const vlim = new Float64Array(n), C0 = tab[0];
    let iMin = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.abs(kap[i]);
      if (k * MODEL.vcap * MODEL.vcap <= L(C0.AY, MODEL.vcap + w[i])) { vlim[i] = MODEL.vcap; }
      else {
        let lo = 0, hi = MODEL.vcap;
        for (let it = 0; it < 30; it++) { const v = 0.5 * (lo + hi); if (v * v * k <= L(C0.AY, Math.max(0, v + w[i]))) lo = v; else hi = v; }
        vlim[i] = lo;
      }
      if (vlim[i] < vlim[iMin]) iMin = i;
    }
    // 2. backward pass (braking, Corner Mode: the wings close on the brakes), one lap from the slowest apex
    const vb = new Float64Array(n);
    vb[iMin] = vlim[iMin];
    for (let k = 1; k < n; k++) {
      const i = (iMin - k + n) % n, j = (i + 1) % n, v = vb[j], u = Math.max(0, v + w[j]);
      const ay = v * v * Math.abs(kap[j]), aym = L(C0.AY, u), r = aym > 0 ? Math.min(1, ay / aym) : 1;
      const Fb = Math.min(L(C0.BR, u) * Math.sqrt(1 - r * r), mechB);
      const dec = (Fb + L(C0.DR, u) + L(C0.RR, u) + m * G * grade[i]) / me;
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
        const a = (Fx - (RES[g0] + ft * (RES[g0 + 1] - RES[g0])) - gF[i]) / me;
        const v2 = v * v + 2 * a * ds;
        let vn = v2 > 1 ? Math.sqrt(v2) : 1, dt;
        if (vn > vb[j]) {
          // braking or part throttle: follow the backward-pass speed; the K harvests from the rear-axle brake force
          vn = vb[j]; dt = (2 * ds) / (v + vn);
          let u0 = 0.5 * (v + vn) + w[i]; if (u0 < 0) u0 = 0;
          let x0 = u0 * inv; if (x0 > uTop) x0 = uTop;
          const h0 = x0 | 0, f0 = x0 - h0;
          const Fbrake = (me * (v * v - vn * vn)) / (2 * ds) - (RES0[h0] + f0 * (RES0[h0 + 1] - RES0[h0])) - gF[i];
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
      return { t, Edep, Eharv, EharvBrake, Eclip, vEnd: v };
    }
    const budget = r => Math.min(depCap, soc + r.Eharv);
    let res = forward(-1, true), lam = -1;   // reference lap: deploy everywhere, no superclip
    // lap-time sensitivity per joule from the reference lap (two sweeps so the wrap-around settles)
    let sMin = Infinity, sMax = 0;
    if (res.Edep > budget(res) && (optimal || marginal)) {
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
    } else if (res.Edep > budget(res)) {
      clipCap = Math.max(0, harvCap - res.EharvBrake);
      // superclip goes to the cheapest points first: the sensitivity below which clipping (on reference-lap times) fills clipCap,
      // so the cap is never used up early in lap order
      if (!noClip) {
        const pts = [];
        for (let i = 0; i < n; i++) if (!brk[i]) { const j = (i + 1) % n; pts.push([sens[i], (2 * seg[i]) / (vf[i] + vf[j])]); }
        pts.sort((a, b) => a[0] - b[0]);
        const P = Math.min(clipKw * 1e3, ETA * Pice); let e = 0; clipSens = Infinity;
        for (const [sv, dt] of pts) { e += P * dt; if (e >= clipCap) { clipSens = sv; break; } }
      }
      let lo = Math.log(sMin) - 1, hi = Math.log(sMax) + 1;   // feasible at hi (no deploy), infeasible at lo
      for (let it = 0; it < MODEL.lambda_iters; it++) { const mid = 0.5 * (lo + hi), r = forward(Math.exp(mid), false); if (r.Edep <= budget(r)) hi = mid; else lo = mid; }
      lam = Math.exp(hi);
      res = forward(lam, true);
    }

    // 4. outputs in the FIA timing frame (TIMING): S1 control line -> sector line 1, S2 -> line 2, S3 -> control line
    const tim = tr.timing || TIMING[trackId] || { control_s: tr.sf, sectors: tr.sectors, trap_s: tr.sf, i1_s: tr.sectors[0], i2_s: tr.sectors[1], source: "game data sf + sector lines" };
    const tOf = s => tAt[tr.idxAtS(s)], vAt = s => vf[tr.idxAtS(s)], lap = res.t;
    const t0 = tOf(tim.control_s), t1 = tOf(tim.sectors[0]), t2 = tOf(tim.sectors[1]);
    const wrap = x => ((x % lap) + lap) % lap;
    const s1 = wrap(t1 - t0), s2 = wrap(t2 - t1), s3 = lap - s1 - s2;
    let vmax = 0, vmin = 1e9; for (let i = 0; i < n; i++) { if (vf[i] > vmax) vmax = vf[i]; if (vf[i] < vmin) vmin = vf[i]; }
    const r3 = x => Math.round(x * 1000) / 1000, r1 = x => Math.round(x * 10) / 10;
    const out = {
      lap_s: r3(lap), sectors_s: [r3(s1), r3(s2), r3(s3)],
      vmax_kmh: r1(vmax * 3.6), speed_trap_kmh: r1(vAt(tim.trap_s) * 3.6), vmin_kmh: r1(vmin * 3.6),
      energy: { deployed_mj: r3(res.Edep / 1e6), harvested_mj: r3(res.Eharv / 1e6), harvested_braking_mj: r3(Math.min(res.EharvBrake, res.Eharv) / 1e6), harvested_superclip_mj: r3(Math.max(0, res.Eharv - res.EharvBrake) / 1e6), recharge_cap_mj: r3(harvCap / 1e6), superclip_share: optimal ? null : r3(clipFrac), superclip_fill: optimal ? null : r3(phiOut), energy_limited: lam >= 0, strategy: strat, deploy_ceiling_kmh: strat === "threshold" && lam >= 0 ? r1(lam * 3.6) : null },
      speeds_kmh: { intermediate_1: r1(vAt(tim.i1_s) * 3.6), intermediate_2: r1(vAt(tim.i2_s) * 3.6), finish_line: r1(vAt(tim.control_s) * 3.6) },
      air_density_kgm3: r3(rho), label: LABEL,
    };
    if (opts.trace) {
      // s_m from the control line along the centreline frame; one sample per track point
      const i0 = tr.idxAtS(tim.control_s), s_m = new Array(n), v_kmh = new Array(n), mode = new Array(n);
      for (let k = 0; k < n; k++) { const i = (i0 + k) % n; s_m[k] = r1(k * tr.ds); v_kmh[k] = r1(vf[i] * 3.6); mode[k] = modeAt[i] ? "straight" : "corner"; }
      out.trace = { s_m, v_kmh, aero_mode: mode };
      if (gr) { out.trace.gear = v_kmh.map(v => gearOf(v) + 1); out.trace.rpm = v_kmh.map(v => Math.round(gr.rpm_per_kmh[gearOf(v)] * v)); }
    }
    if (opts.debug) out.debug = { vf, vb, vlim, tAt, sens, track: tr, iMin, lambda: lam };
    return out;
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

  const api = { LABEL, REGS, MODEL, DEFAULT_CONDITIONS, TIMING, mgukTaperKw, parseWeekend, baselineCar, priorCar, simulateLap, airDensity, headwind, loadWeekendConditions, activeCal };
  EI.conceptSim = Object.assign(EI.conceptSim || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
