// PURPLE concept - lap-sim public API (docs/concept/SIM.md). One entry point for Node and the browser.
//   simulateLap(car, trackId, conditions?, opts?) - trackId: silverstone, monza, monaco, spa, hungaroring (SIM.md "Multi-track") -> { lap_s, sectors_s, vmax_kmh, speed_trap_kmh, vmin_kmh, energy, trace?, label, ... }
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
  // multi-track (SIM.md "Multi-track"): per-circuit set-up and fit (setup.js, multitrack.js, fitted-tracks.js)
  if (typeof require === "function" && !EI.CONCEPT_SIM_TRACK_FIT) { try { require("./fitted-tracks.js"); } catch (e) { /* no multi-track fit yet */ } }
  // browser: load concept/sim/{setup,multitrack,fitted-tracks}.js before this file for the multi-track API (absent: Silverstone only)
  const SU = EI.conceptSimSetup || (typeof require === "function" ? require("./setup.js") : null);
  const MT = EI.conceptSimMulti || (typeof require === "function" ? require("./multitrack.js") : null);
  const need = (m, file) => { if (!m) throw new Error("concept sim: load concept/sim/" + file + ".js for the multi-track API"); return m; };

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
      return tr.corners.map(k => ({ name: ((tr.frame === "f1" ? (tr.corner_names || {})[k.n] : TNAMES[k.n]) || "T") + " (T" + k.n + ")", n: k.n, marker_s: k.d, s0: k.d - 70, s1: k.d + 90 }));
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

  // ---- contributions: where a car gains or loses time against a reference car, corner by corner and straight by straight. The
  // lap (telemetry line) is cut into corner zones (each MultiViewer marker -100 / +100 m, never past halfway to its neighbours)
  // and the straights between them; each segment's time comes from the two cars' own time traces, so the segment deltas add up
  // exactly to the lap delta. contributions(car, refCar?, conditions?, opts?) - refCar defaults to the baseline car.
  function segmentsOf(tr) {
    const K = (tr.corners || []).filter(k => k.d != null).slice().sort((a, b) => a.d - b.d), L = tr.L, out = [];
    if (!K.length) return [{ kind: "lap", name: "lap", s0: 0, s1: L }];
    const names = S.CORNER_NAMES[tr.id] || tr.corner_names || {}, nm = k => (names[k.n] || "T") + " (T" + k.n + ")";
    const zone = K.map((k, i) => {
      const prev = K[(i - 1 + K.length) % K.length].d - (i === 0 ? L : 0), next = K[(i + 1) % K.length].d + (i === K.length - 1 ? L : 0);
      return { kind: "corner", name: nm(k), n: k.n, s0: Math.max(k.d - 100, (prev + k.d) / 2), s1: Math.min(k.d + 100, (k.d + next) / 2) };
    });
    zone.forEach((z, i) => {
      out.push(z);
      const nx = zone[(i + 1) % zone.length], a = z.s1, b = nx.s0 + (i === zone.length - 1 ? L : 0);
      if (b - a > 1) out.push({ kind: "straight", name: "T" + z.n + " -> T" + nx.n, s0: a, s1: b });
    });
    return out;
  }
  function contributions(car, refCar, conditions, opts) {
    opts = opts || {};
    const trackId = opts.trackId || "silverstone", tr = T.buildTrack(trackId);
    const run = c => S.simulateLap(c, trackId, conditions, Object.assign({}, opts.simOpts || {}, { trace: true }));
    const a = run(car), b = run(refCar || S.baselineCar());
    const L = tr.L, n = a.trace.t_s.length, step = L / n;
    const tAt = (r, s) => { const x = (((s % L) + L) % L) / step, i = Math.floor(x) % n, f = x - Math.floor(x), j = (i + 1) % n; const t0 = r.trace.t_s[i], t1 = j === 0 ? r.lap_s : r.trace.t_s[j]; return t0 + f * (t1 - t0); };
    const dur = (r, s0, s1) => { const d = tAt(r, s1) - tAt(r, s0); return d < 0 ? d + r.lap_s : d; };
    const vmin = (r, s0, s1) => { let m = Infinity; for (let s = s0; s <= s1; s += step) m = Math.min(m, r.trace.v_kmh[Math.round((((s % L) + L) % L) / step) % n]); return m; };
    const r3 = x => Math.round(x * 1000) / 1000;
    const segments = segmentsOf(tr).map(g => {
      const ta = dur(a, g.s0, g.s1), tb = dur(b, g.s0, g.s1);
      return { kind: g.kind, name: g.name, s0_m: Math.round(((g.s0 % L) + L) % L), s1_m: Math.round(((g.s1 % L) + L) % L), time_s: r3(ta), ref_time_s: r3(tb), delta_s: r3(ta - tb), min_kmh: vmin(a, g.s0, g.s1), ref_min_kmh: vmin(b, g.s0, g.s1) };
    });
    return { lap_s: a.lap_s, ref_lap_s: b.lap_s, delta_s: r3(a.lap_s - b.lap_s), segments, label: S.LABEL };
  }

  const api = Object.assign({}, S, {
    contributions, segmentsOf,
    calibrate: F.calibrate, fitTeams: F.fitTeams, teamCar: F.teamCar, teamCars: F.teamCars, teamTargets: F.teamTargets,
    fitted: F.fitted, reference: F.reference, heldOut: F.heldOut, cornerTable, CORNERS, buildTrack: T.buildTrack,
    // baselineCar(teamId?, trackId?): with a circuit, the team's car with its fitted set-up there (multitrack.teamCarAt)
    baselineCar: (teamId, trackId) => (teamId ? (trackId && trackId !== "silverstone" ? MT.teamCarAt(teamId, trackId) : F.teamCar(teamId)) : S.baselineCar()),
    CIRCUITS: MT ? MT.CIRCUITS : ["silverstone"],
    setupCar: (...a) => need(SU, "setup").setupCar(...a), wingCurve: (...a) => need(SU, "setup").wingCurve(...a), wingFactors: (...a) => need(SU, "setup").wingFactors(...a),
    trackGrip: (...a) => need(SU, "setup").trackGrip(...a), teamSetup: (...a) => need(SU, "setup").teamSetup(...a), fittedTracks: (...a) => need(SU, "setup").fittedTracks(...a),
    teamCarAt: (...a) => need(MT, "multitrack").teamCarAt(...a), teamCarsAt: trackId => F.fitted().teams.map(t => need(MT, "multitrack").teamCarAt(t.team, trackId)), optimalWing: (...a) => need(MT, "multitrack").optimalWing(...a), ourDriver: (...a) => need(MT, "multitrack").ourDriver(...a),
  });
  EI.conceptSim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
