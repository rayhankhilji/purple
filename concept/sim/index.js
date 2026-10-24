// PURPLE concept - lap-sim public API (docs/concept/SIM.md). One entry point for Node and the browser.
//   simulateLap(car, "silverstone", conditions?, opts?) -> { lap_s, sectors_s, vmax_kmh, speed_trap_kmh, vmin_kmh, energy, trace?, label, ... }
//   baselineCar(), calibrate(opts?), fitTeams(opts?), teamCar(teamId), teamCars(), cornerTable(car?), LABEL, fitted()
// Node:    const sim = require("./concept/sim/index.js");
// Browser: load js/data/silverstone.js, then concept/sim/{track,lapsim,fitted,fit,index}.js in that order -> window.EI.conceptSim
// (js/data/racepace2026.js and season2026.js are needed only for calibrate / fitTeams).
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {});
  const T = EI.conceptSimTrack || require("./track.js");
  const S = EI.conceptSim && EI.conceptSim.simulateLap ? EI.conceptSim : require("./lapsim.js");
  if (typeof require === "function" && !EI.CONCEPT_SIM_FIT) { try { require("./fitted.js"); } catch (e) { /* no fit yet: identity calibration */ } }
  const F = EI.conceptSimFit || require("./fit.js");

  // named corner windows (centreline s frame) for the radius table; names follow js/data/silverstone.js corners[]
  const CORNERS = {
    silverstone: [
      { name: "Abbey (T1)", s0: 380, s1: 560 }, { name: "Farm (T2)", s0: 600, s1: 800 }, { name: "Village (T3)", s0: 900, s1: 1050 },
      { name: "The Loop (T4)", s0: 1050, s1: 1200 }, { name: "Aintree (T5)", s0: 1250, s1: 1420 }, { name: "Brooklands (T6)", s0: 1950, s1: 2150 },
      { name: "Luffield (T7)", s0: 2150, s1: 2400 }, { name: "Woodcote (T8)", s0: 2500, s1: 2750 }, { name: "Copse (T9)", s0: 3050, s1: 3250 },
      { name: "Maggotts (T10)", s0: 3600, s1: 3850 }, { name: "Becketts (T11-12)", s0: 3880, s1: 4030 }, { name: "Chapel (T13-14)", s0: 4030, s1: 4300 },
      { name: "Stowe (T15)", s0: 5030, s1: 5250 }, { name: "Vale (T16-17)", s0: 5450, s1: 5700 }, { name: "Club (T18)", s0: 5700, s1: 5880 },
    ],
  };

  // minimum radius per corner (OSM centreline vs the sim's racing line) and the sim's minimum speed in that window
  // corner names for the FIA / MultiViewer numbering (T1..T18) used by the telemetry markers
  const TNAMES = { 1: "Abbey", 2: "Farm", 3: "Village", 4: "The Loop", 5: "Aintree", 6: "Brooklands", 7: "Luffield", 8: "Woodcote", 9: "Copse", 10: "Maggotts", 11: "Maggotts", 12: "Becketts", 13: "Becketts", 14: "Chapel", 15: "Stowe", 16: "Vale", 17: "Club", 18: "Club" };
  function cornerWindows(tr, trackId) {
    if (tr.line === "telemetry" && tr.corners && tr.corners.length && tr.corners[0].d != null)
      return tr.corners.map(k => ({ name: (TNAMES[k.n] || "T") + " (T" + k.n + ")", n: k.n, marker_s: k.d, s0: k.d - 70, s1: k.d + 90 }));
    return CORNERS[trackId] || [];
  }
  function cornerTable(car, trackId, conditions) {
    trackId = trackId || "silverstone";
    const tr = T.buildTrack(trackId), wins = cornerWindows(tr, trackId), rows = T.cornerRadii(tr, wins).map((r, i) => Object.assign({ marker_s: wins[i].marker_s }, r));
    const ref = tr.reference;
    const r = S.simulateLap(car || S.baselineCar(), trackId, conditions, { debug: true });
    const vf = r.debug.vf;
    return rows.map(row => {
      let vmin = Infinity;
      for (let i = tr.idxAtS(row.s0); i !== tr.idxAtS(row.s1); i = (i + 1) % tr.n) if (vf[i] < vmin) vmin = vf[i];
      const va = vf[tr.idxAtS(row.s_apex)];   // speed where the racing line is tightest, and the lateral g it implies
      const o = { sim_apex_kmh: +(va * 3.6).toFixed(1), sim_min_kmh: +(vmin * 3.6).toFixed(1), apex_lat_g: +((va * va) / row.r_line_m / 9.81).toFixed(2) };
      if (ref) {   // the pole lap's own minimum in the same window (telemetry frame = trace distance)
        let rm = Infinity; for (let k = 0; k < ref.d.length; k++) if (ref.d[k] >= row.s0 && ref.d[k] <= row.s1) rm = Math.min(rm, ref.ref_v_kmh[k]);
        const vr = ref.ref_v_kmh[Math.min(ref.d.length - 1, Math.round(row.s_apex / 5))] / 3.6;
        Object.assign(o, { real_min_kmh: rm, diff_min_kmh: +(o.sim_min_kmh - rm).toFixed(1), real_apex_lat_g: +((vr * vr) / row.r_line_m / 9.81).toFixed(2) });
      }
      return Object.assign(row, o);
    });
  }

  const api = Object.assign({}, S, {
    calibrate: F.calibrate, fitTeams: F.fitTeams, teamCar: F.teamCar, teamCars: F.teamCars, teamTargets: F.teamTargets,
    fitted: F.fitted, reference: F.reference, heldOut: F.heldOut, cornerTable, CORNERS, buildTrack: T.buildTrack,
    baselineCar: teamId => (teamId ? F.teamCar(teamId) : S.baselineCar()),
  });
  EI.conceptSim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
