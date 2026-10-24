// PURPLE concept - per-circuit set-up of a fixed physical car (docs/concept/SIM.md "Multi-track"). A team brings the same car to
// every circuit and changes only what teams really change per track: the wing level (downforce / drag trim) and the ride height.
// setupCar(car, { wing_deg, ride_height_delta_mm }) -> a new PhysicalCar:
//   wing_deg: rear-wing setting change in degrees from the car's calibrated (Silverstone) level, the front wing moved with it so
//     the corner-mode aero balance stays where it was. The trade-off curve (relative CLA and CDA, Corner and Straight Mode) is the
//     design layer's own aero map (concept/aeromap.js evaluate() on the baseline design, the same wing slopes the design optimiser
//     and the lab use: +0.018 df / +0.011 cd per degree of rear wing, +0.010 / +0.004 per degree of front wing at the baseline),
//     tabulated every 0.25 deg over WING_RANGE and interpolated linearly. Both modes and both axles are scaled; balance unchanged.
//   ride_height_delta_mm: static ride height change; CLA and CDA scale by the aero map's ride-height ratio and the floor's stall
//     margin moves by the same millimetres (not fitted anywhere: no lap data separates it from the wing level; offered for the
//     season layer).
// trackGrip(trackId): the circuit's grip factor on both tyre mu (surface and temperature beyond MODEL.tyre_temp, shared by every
// team; fitted per circuit by concept/sim/build-fit-tracks.js, 1 at Silverstone). simulateLap applies it itself.
// Dual browser / Node: window.EI.conceptSimSetup and module.exports. Deterministic.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {});
  const WING_RANGE = [-12, 12], WING_STEP = 0.25;

  function aeroModules() {
    const C = EI.concept || {};
    if (C.aeromap && C.design) return { A: C.aeromap, D: C.design };
    if (typeof require !== "function") return null;
    try { return { A: require("../aeromap.js"), D: require("../design.js") }; } catch (e) { return null; }
  }
  let curve = null;
  // relative coefficients over the wing level, from the aero map: { w[], df[], cd[], df_sm[], cd_sm[], front_deg[] }
  function wingCurve() {
    if (curve) return curve;
    const M = aeroModules(); if (!M) throw new Error("concept sim setup: concept/aeromap.js and concept/design.js are needed for the wing curve");
    const base = M.D.baseline().params, e0 = M.A.evaluate(base), out = { w: [], df: [], cd: [], df_sm: [], cd_sm: [], front_deg: [], source: "concept/aeromap.js evaluate() on design.baseline(), rear wing ± w deg with the front wing moved to hold the corner-mode balance (" + e0.balance.toFixed(4) + ")" };
    for (let w = WING_RANGE[0]; w <= WING_RANGE[1] + 1e-9; w += WING_STEP) {
      const p = JSON.parse(JSON.stringify(base)); p.rear_wing.aoa_deg = base.rear_wing.aoa_deg + w;
      let lo = -25, hi = 25;   // bisection on the front-wing change that restores the balance (fixed count: deterministic)
      for (let it = 0; it < 48; it++) { const m = 0.5 * (lo + hi); p.front_wing.aoa_deg = base.front_wing.aoa_deg + m; if (M.A.evaluate(p).balance < e0.balance) lo = m; else hi = m; }
      p.front_wing.aoa_deg = base.front_wing.aoa_deg + 0.5 * (lo + hi);
      const e = M.A.evaluate(p), r = x => +x.toFixed(6);
      out.w.push(+w.toFixed(2)); out.df.push(r(e.df / e0.df)); out.cd.push(r(e.cd / e0.cd)); out.df_sm.push(r(e.df_sm / e0.df_sm)); out.cd_sm.push(r(e.cd_sm / e0.cd_sm)); out.front_deg.push(+(0.5 * (lo + hi)).toFixed(3));
    }
    return (curve = out);
  }
  function at(arr, w) {
    const C = wingCurve(), x = (Math.min(WING_RANGE[1], Math.max(WING_RANGE[0], w)) - WING_RANGE[0]) / WING_STEP, i = Math.min(C.w.length - 2, Math.floor(x)), t = x - i;
    return arr[i] + t * (arr[i + 1] - arr[i]);
  }
  // the four relative coefficients at a wing level (1 at 0)
  function wingFactors(w) { const C = wingCurve(); w = +w || 0; return { df: at(C.df, w), cd: at(C.cd, w), df_sm: at(C.df_sm, w), cd_sm: at(C.cd_sm, w) }; }
  let rideRef = null;
  function rideFactors(dmm) {
    if (!dmm) return { df: 1, cd: 1 };
    const M = aeroModules(); if (!M) throw new Error("concept sim setup: concept/aeromap.js is needed for the ride-height ratio");
    const base = M.D.baseline().params; rideRef = rideRef || M.A.evaluate(base);
    const p = JSON.parse(JSON.stringify(base)); p.floor.ride_height_mm = base.floor.ride_height_mm + dmm;
    const e = M.A.evaluate(p); return { df: e.df / rideRef.df, cd: e.cd / rideRef.cd };
  }
  function setupCar(car, setup) {
    setup = setup || {};
    const w = +setup.wing_deg || 0, dh = +setup.ride_height_delta_mm || 0;
    const c = JSON.parse(JSON.stringify(car));
    if (!w && !dh) return c;
    const f = wingFactors(w), rf = rideFactors(dh);
    for (const [mode, kd, kc] of [["corner", "df", "cd"], ["straight", "df_sm", "cd_sm"]]) {
      const a = c.aero[mode];
      a.CLA_front_m2 *= f[kd] * rf.df; a.CLA_rear_m2 *= f[kd] * rf.df; a.CDA_m2 *= f[kc] * rf.cd;
    }
    if (dh) {
      if (isFinite(+c.aero.ride_height_mm)) c.aero.ride_height_mm = +c.aero.ride_height_mm + dh;
      c.aero.stall_margin_mm = (isFinite(+c.aero.stall_margin_mm) ? +c.aero.stall_margin_mm : 3.67) + dh;
    }
    c.setup = { wing_deg: w, ride_height_delta_mm: dh };
    return c;
  }
  // the circuit's fitted grip factor (concept/sim/fitted-tracks.js), 1 when absent (Silverstone: the calibration circuit)
  function fittedTracks() { return EI.CONCEPT_SIM_TRACK_FIT || (typeof require === "function" ? (() => { try { return require("./fitted-tracks.js"); } catch (e) { return null; } })() : null); }
  function trackGrip(trackId) { const F = fittedTracks(), t = F && F.tracks && F.tracks[trackId]; return t && isFinite(+t.grip) ? +t.grip : 1; }
  // a team's fitted set-up at a circuit ({ wing_deg, ride_height_delta_mm }), zero at Silverstone or when not fitted
  function teamSetup(teamId, trackId) {
    const F = fittedTracks(), t = F && F.tracks && F.tracks[trackId], row = t && t.teams.find(x => x.team === teamId);
    return row ? { wing_deg: row.wing_deg, ride_height_delta_mm: 0 } : { wing_deg: 0, ride_height_delta_mm: 0 };
  }

  const api = { WING_RANGE, WING_STEP, wingCurve, wingFactors, rideFactors, setupCar, trackGrip, teamSetup, fittedTracks };
  EI.conceptSimSetup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
