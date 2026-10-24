// PURPLE CONCEPT - surrogate feature map. Two layers over a PhysicalCar (concept/physical.js):
//   RAW      the 22 independent physical inputs the design of experiments varies (mass, aero levels, balance, power, tyres, ...),
//            each read from / written to a PhysicalCar. The training box and the extrapolation check live in this space.
//   FEATURES the dimensionless groups the models are fitted on: forces over the car's weight at a reference speed, power over
//            weight × reference speed, energy over kinetic energy, balances and ratios. A lap sim is (very nearly) a function of
//            these groups: two cars with the same downforce/weight, drag/weight, power/weight and μ corner, brake and accelerate
//            alike, so the fitted surfaces are smoother in them than in the raw SI fields, and a quadratic goes further.
// Pure and fast (no allocation with a caller-supplied output array). Dual browser / Node: window.EI.concept.surrogateFeatures
// and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const VERSION = "surrogate features v3";

  // reference constants. Changing any of them changes every feature: bump VERSION (saved models record it and refuse a mismatch).
  const K = Object.freeze({
    rho: 1.225,          // kg/m³, ISA sea-level air: only scales the aero groups (a constant factor, not a weather model)
    g: 9.81,             // m/s²
    v_ref: 60,           // m/s (216 km/h): a characteristic medium-fast corner speed; q_ref = ½ ρ v_ref² ≈ 2205 Pa
    bal_ref: -0.0033,    // aero balance − weight distribution of the baseline concept car (0.4467 − 0.4500, physical() on the sim v2 anchor car): the reference set-up
    rh_ref_mm: 35,       // baseline static ride height
    bottoming_mm: 30,    // below this static ride height the plank works the ground (lab/aero.js BOTTOMING, sim v0 grip term)
    load_ref_n: 1000,    // tyre load-sensitivity unit (load_sens is μ fraction lost per kN)
    stall_nominal_mm: 5, // stall margin assumed for a car that does not report one (unstalled; the concept baseline has 3.67)
  });

  const sumC = pc => pc.aero.corner.CLA_front_m2 + pc.aero.corner.CLA_rear_m2;
  const sumS = pc => pc.aero.straight.CLA_front_m2 + pc.aero.straight.CLA_rear_m2;
  // stall_margin_mm is additive to the contract (a sim's own cars may not carry it): absent -> the nominal value K.stall_nominal_mm,
  // or −K.stall_nominal_mm when the car says the floor is stalled
  const stallMargin = pc => (typeof pc.aero.stall_margin_mm === "number" ? pc.aero.stall_margin_mm : (pc.aero.floor_stalled || pc.floor_stalled ? -K.stall_nominal_mm : K.stall_nominal_mm));
  const stalled = pc => !!(pc.aero.floor_stalled || pc.floor_stalled);

  // ---- RAW: the DOE coordinates. get(pc) -> number; set(pc, v, x) writes it (x = the whole raw vector by name, for coupled fields)
  const RAW = [
    { name: "mass_kg", unit: "kg", get: pc => pc.mass_kg, set: (pc, v) => { pc.mass_kg = v; } },
    { name: "fuel_kg", unit: "kg", get: pc => pc.fuel_kg, set: (pc, v) => { pc.fuel_kg = v; } },
    { name: "wheelbase_m", unit: "m", get: pc => pc.wheelbase_m, set: (pc, v) => { pc.wheelbase_m = v; } },
    { name: "cog_height_m", unit: "m", get: pc => pc.cog_height_m, set: (pc, v) => { pc.cog_height_m = v; } },
    { name: "weight_dist_front", unit: "", get: pc => pc.weight_dist_front, set: (pc, v) => { pc.weight_dist_front = v; } },
    { name: "cla_corner_m2", unit: "m²", get: sumC, set: () => {} },          // written with the balance below
    { name: "balance_corner", unit: "", get: pc => pc.aero.corner.CLA_front_m2 / sumC(pc), set: () => {} },
    { name: "cda_corner_m2", unit: "m²", get: pc => pc.aero.corner.CDA_m2, set: (pc, v) => { pc.aero.corner.CDA_m2 = v; } },
    { name: "sm_cla_ratio", unit: "", get: pc => sumS(pc) / sumC(pc), set: () => {} },
    { name: "sm_balance_shift", unit: "", get: pc => pc.aero.straight.CLA_front_m2 / sumS(pc) - pc.aero.corner.CLA_front_m2 / sumC(pc), set: () => {} },
    { name: "sm_cda_ratio", unit: "", get: pc => pc.aero.straight.CDA_m2 / pc.aero.corner.CDA_m2, set: () => {} },
    { name: "ride_height_mm", unit: "mm", get: pc => pc.aero.ride_height_mm, set: (pc, v) => { pc.aero.ride_height_mm = v; } },
    { name: "ride_sens_per_mm", unit: "1/mm", get: pc => pc.aero.ride_sens_per_mm, set: (pc, v) => { pc.aero.ride_sens_per_mm = v; } },
    { name: "stall_margin_mm", unit: "mm", get: stallMargin, set: (pc, v) => { pc.aero.stall_margin_mm = v; pc.aero.floor_stalled = v < 0; } },
    { name: "ice_kw", unit: "kW", get: pc => pc.pu.ice_kw, set: (pc, v) => { pc.pu.ice_kw = v; } },
    { name: "mguk_kw", unit: "kW", get: pc => pc.pu.mguk_kw, set: (pc, v) => { pc.pu.mguk_kw = v; } },
    { name: "es_deploy_mj", unit: "MJ", get: pc => pc.pu.es_deploy_mj_per_lap, set: (pc, v) => { pc.pu.es_deploy_mj_per_lap = v; } },
    { name: "es_harvest_mj", unit: "MJ", get: pc => pc.pu.es_harvest_mj_per_lap, set: (pc, v) => { pc.pu.es_harvest_mj_per_lap = v; } },
    { name: "mu_x", unit: "", get: pc => pc.tyres.mu_x, set: (pc, v) => { pc.tyres.mu_x = v; } },   // the brake system cap (brakes.max_decel_g_mech, sim v2: 5 g) is the template car's, not μx
    { name: "mu_y", unit: "", get: pc => pc.tyres.mu_y, set: (pc, v) => { pc.tyres.mu_y = v; } },
    { name: "load_sens", unit: "1/kN", get: pc => pc.tyres.load_sens, set: (pc, v) => { pc.tyres.load_sens = v; } },
    { name: "drivetrain_eff", unit: "", get: pc => pc.drivetrain_eff, set: (pc, v) => { pc.drivetrain_eff = v; } },
  ];
  const RAW_NAMES = RAW.map(r => r.name);
  const RI = {}; RAW_NAMES.forEach((n, i) => { RI[n] = i; });
  // fields a PhysicalCar carries that the DOE holds fixed (physical() never varies them); the box check flags a car that differs
  const FIXED = [
    { name: "track_front_m", get: pc => pc.track_front_m, rel_tol: 0.02 },
    { name: "track_rear_m", get: pc => pc.track_rear_m, rel_tol: 0.02 },
    { name: "tyres.radius_m", get: pc => pc.tyres.radius_m, rel_tol: 0.02 },
  ];

  function rawVector(pc, out) {
    out = out || new Float64Array(RAW.length);
    for (let i = 0; i < RAW.length; i++) out[i] = RAW[i].get(pc);
    return out;
  }
  // a raw vector -> a full PhysicalCar, every other field (label, session, sources, fixed fields) copied from `template`
  function fromRaw(x, template, id) {
    const pc = JSON.parse(JSON.stringify(template));
    for (let i = 0; i < RAW.length; i++) RAW[i].set(pc, x[i]);
    const cla = x[RI.cla_corner_m2], bal = x[RI.balance_corner], claS = cla * x[RI.sm_cla_ratio], balS = bal + x[RI.sm_balance_shift];
    pc.aero.corner.CLA_front_m2 = cla * bal; pc.aero.corner.CLA_rear_m2 = cla * (1 - bal);
    pc.aero.straight.CLA_front_m2 = claS * balS; pc.aero.straight.CLA_rear_m2 = claS * (1 - balS);
    pc.aero.straight.CDA_m2 = x[RI.cda_corner_m2] * x[RI.sm_cda_ratio];
    pc.id = id || "doe"; pc.label = "surrogate DOE point (PhysicalCar fields set directly, not from a design)";
    return pc;
  }

  // ---- FEATURES: name, formula, why. m = mass + fuel, W = m g, q = ½ ρ v_ref², P = power at the wheels.
  const FEATURES = [
    { name: "mu_y", why: "lateral tyre friction: mechanical cornering grip (g)" },
    { name: "mu_x", why: "longitudinal friction: braking and traction limit (g)" },
    { name: "aero_load", why: "q·ClA_corner / W: downforce over weight at v_ref (how much the wings add to grip)" },
    { name: "aero_grip", why: "μy·q·ClA / W: the aero share of lateral force at v_ref (the ClA·μ/m group)" },
    { name: "corner_grip", why: "μy·(1 + q·ClA/W): total lateral capacity at v_ref over weight" },
    { name: "drag", why: "q·CdA_corner / W: drag over weight at v_ref (CdA/m)" },
    { name: "power", why: "P_ice·η / (W·v_ref): ICE tractive force at v_ref over weight (power-to-mass)" },
    { name: "hybrid_power", why: "P_mguk·η / (W·v_ref): MGU-K tractive force at v_ref over weight" },
    { name: "deploy_energy", why: "E_deploy / (½ m v_ref²): ERS energy per lap over the car's kinetic energy at v_ref" },
    { name: "harvest_energy", why: "E_harvest / (½ m v_ref²): recharge per lap over the same kinetic energy" },
    { name: "top_speed_index", why: "(P_ice·η / (q·CdA·v_ref))^(1/3): v_max / v_ref of a pure power-drag balance" },
    { name: "balance_offset", why: "aero balance − weight distribution: understeer / oversteer tendency at speed" },
    { name: "balance_misfit", why: "|balance_offset − baseline offset|: departure from the reference set-up either way costs grip (a kink, not a square)" },
    { name: "weight_dist_front", why: "static front axle share" },
    { name: "sm_drag_ratio", why: "CdA_straight / CdA_corner: drag relief of Straight Mode" },
    { name: "sm_load_ratio", why: "ClA_straight / ClA_corner: downforce kept in Straight Mode (braking into a zone's end)" },
    { name: "sm_balance_shift", why: "straight − corner aero balance" },
    { name: "wb_over_track", why: "wheelbase / mean track: agility (yaw response) proxy" },
    { name: "cog_over_track", why: "CoG height / mean track: lateral load transfer index" },
    { name: "ride_height_rel", why: "static ride height / baseline 35 mm" },
    { name: "bottoming", why: "max(0, 30 mm − ride height) / 10 mm: plank on the ground, a one-sided hinge (zero above 30 mm)" },
    { name: "ride_sensitivity", why: "|d ln downforce / d ride height| × 10 mm: aero platform sensitivity per cm" },
    { name: "stall_margin", why: "floor stall margin / 10 mm" },
    { name: "floor_stalled", why: "1 if the floor is stalled at the dynamic ride height, else 0" },
    { name: "load_sens_loss", why: "load_sens × (W/4) / 1 kN: fractional μ lost to the static wheel load" },
  ];
  const NAMES = FEATURES.map(f => f.name);

  // features(pc, out?) -> Float64Array in NAMES order
  function features(pc, out) {
    out = out || new Float64Array(FEATURES.length);
    const A = pc.aero, c = A.corner, s = A.straight, pu = pc.pu, ty = pc.tyres;
    const m = pc.mass_kg + pc.fuel_kg, W = m * K.g, q = 0.5 * K.rho * K.v_ref * K.v_ref, ke = 0.5 * m * K.v_ref * K.v_ref;
    const cla = c.CLA_front_m2 + c.CLA_rear_m2, claS = s.CLA_front_m2 + s.CLA_rear_m2, bal = c.CLA_front_m2 / cla;
    const eta = pc.drivetrain_eff, track = 0.5 * (pc.track_front_m + pc.track_rear_m);
    const load = q * cla / W, off = bal - pc.weight_dist_front, rh = A.ride_height_mm;
    out[0] = ty.mu_y;
    out[1] = ty.mu_x;
    out[2] = load;
    out[3] = ty.mu_y * load;
    out[4] = ty.mu_y * (1 + load);
    out[5] = q * c.CDA_m2 / W;
    out[6] = pu.ice_kw * 1e3 * eta / (W * K.v_ref);
    out[7] = pu.mguk_kw * 1e3 * eta / (W * K.v_ref);
    out[8] = pu.es_deploy_mj_per_lap * 1e6 / ke;
    out[9] = pu.es_harvest_mj_per_lap * 1e6 / ke;
    out[10] = Math.cbrt(pu.ice_kw * 1e3 * eta / (q * c.CDA_m2 * K.v_ref));
    out[11] = off;
    out[12] = Math.abs(off - K.bal_ref);
    out[13] = pc.weight_dist_front;
    out[14] = s.CDA_m2 / c.CDA_m2;
    out[15] = claS / cla;
    out[16] = s.CLA_front_m2 / claS - bal;
    out[17] = pc.wheelbase_m / track;
    out[18] = pc.cog_height_m / track;
    out[19] = rh / K.rh_ref_mm;
    out[20] = rh < K.bottoming_mm ? (K.bottoming_mm - rh) / 10 : 0;
    out[21] = A.ride_sens_per_mm * 10;
    out[22] = stallMargin(pc) / 10;
    out[23] = stalled(pc) ? 1 : 0;
    out[24] = ty.load_sens * (W / 4) / K.load_ref_n;
    return out;
  }

  const api = { VERSION, K, stallMargin, stalled, RAW, RAW_NAMES, RI, FIXED, FEATURES, NAMES, rawVector, fromRaw, features };
  C.surrogateFeatures = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
