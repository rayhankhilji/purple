// PURPLE - the evaluator (F-02): evaluate(circuit, setup, conditions) -> Evaluation (ARCHITECTURE §4.4).
// Wraps the game's own lap model (js/ai.js buildSpeedProfile, mode 1 = full throttle, no ERS) with the aero map's multipliers and
// the conditions' wind field. Calibrated: the neutral setup, dry, no wind, laps exactly the game's LIMIT_LAP for the circuit
// (80.8 s Silverstone, the 2026-pole-anchored limit lap) by solving the corner-grip scale once per track. Deterministic.
// Label: "reduced-order lap model · calibrated to 2026 pole laps · aero map v1". The LLM never computes times; this does.
// Dual browser / Node (the browser must have loaded three.js, js/util.js, js/data/*.js, js/track.js, js/car.js, js/ai.js first).
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {});
  const aero = EI.aero || (typeof require === "function" ? require("./aero.js") : null);
  const MODEL_LABEL = "reduced-order lap model · calibrated to 2026 pole laps · aero map v1";
  const NEUTRAL = { df: 1, cd: 1, a0: 1, b0: 1 };
  const GRIP_SEARCH = { lo: 0.5, hi: 1.6, iters: 40 };   // the corner-grip scale is solved in this band (C_LIMIT is 1.1 at Silverstone)
  const tracks = {};
  const r3 = v => +v.toFixed(3), r1 = v => +v.toFixed(1), kmh = v => r1(v * 3.6);

  function trackFor(circuit) {
    if (tracks[circuit]) return tracks[circuit];
    const data = EI.TRACKS && EI.TRACKS[circuit];
    if (!data) throw new Error("evaluator: unknown circuit " + circuit);
    return (tracks[circuit] = new EI.Track(data));
  }
  const DEC = () => (EI.AI_CAL && EI.AI_CAL.DEC_REF) || 0.92;   // the braking level the game calibrates at
  function profileOf(track, grip, mult, wind) { return EI.buildSpeedProfile(track, DEC(), grip, EI.CAR.VMAX + 6, 1, 0, mult, wind); }

  // sector of a sample: S1 from the start/finish line to sector line 1, S2 to line 2, S3 the rest (wraps through s = 0), as race.js times it
  function sectorIndex(track, s) {
    const sf = track.sf || 0, a = track.sectors[0], b = track.sectors[1];
    if (s >= sf && s < a) return 0; if (s >= a && s < b) return 1; return 2;
  }
  // drive the profile exactly, capped at the setup's terminal speed; returns times and the speeds the Evaluation reports
  function timing(track, prof, vcap, circuit) {
    const n = track.n, ds = track.ds, ref = aero.REF_CORNER[circuit], str = aero.REF_STRAIGHT[circuit];
    const sectors = [0, 0, 0], sectorVmax = [0, 0, 0];
    let lap = 0, vmax = 0, vminLap = Infinity, vminRef = Infinity, vmaxStraight = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.max(1, Math.min(vcap, prof[i])), s = i * ds, si = sectorIndex(track, s);
      const dt = ds / v; lap += dt; sectors[si] += dt;
      if (v > vmax) vmax = v; if (v < vminLap) vminLap = v; if (v > sectorVmax[si]) sectorVmax[si] = v;
      if (ref && s >= ref.s0 && s <= ref.s1 && v < vminRef) vminRef = v;
      if (str && s >= str.s0 && s <= str.s1 && v > vmaxStraight) vmaxStraight = v;
    }
    return { lap, sectors, vmax, vminLap, vminRef: isFinite(vminRef) ? vminRef : vminLap, sectorVmax, vmaxStraight };
  }
  // the corner-grip scale at which the neutral car, dry and still, laps the circuit's limit lap (once per track, cached on it)
  function calibrate(track, circuit) {
    if (track.__purpleGrip) return track.__purpleGrip;
    const target = (EI.LIMIT_LAP || {})[circuit];
    const lapAt = g => timing(track, profileOf(track, g, NEUTRAL, null), EI.CAR.VMAX, circuit).lap;
    let grip;
    if (!target) grip = (EI.AI_CAL && EI.AI_CAL.C_LIMIT && EI.AI_CAL.C_LIMIT[circuit]) || 1.1;
    else { let lo = GRIP_SEARCH.lo, hi = GRIP_SEARCH.hi; for (let it = 0; it < GRIP_SEARCH.iters; it++) { const mid = (lo + hi) / 2; if (lapAt(mid) > target) lo = mid; else hi = mid; } grip = (lo + hi) / 2; }
    return (track.__purpleGrip = { grip, target: target || null });
  }
  function evaluateOne(circuit, setup, conditions, opts) {
    const mult = aero.toMultipliers(setup, conditions, opts);
    if (!mult.legal) return { legal: false, violations: mult.violations, multipliers: mult };
    const track = trackFor(circuit), cal = calibrate(track, circuit);
    const wind = aero.windField(track, conditions);
    const prof = profileOf(track, cal.grip, mult, wind);
    // the setup's still-air terminal speed, reported as terminal_kmh. It is NOT used to cap the samples: the profile already caps each
    // sample at its own terminal speed against the local headwind (js/ai.js vTerm(w)), so a still-air cap here clipped tailwind samples
    // and made every windy lap lean slow (fixed 2026-10-24; still-air results are unchanged, the fixtures prove it).
    const vcap = aero.terminalSpeed(mult.cd, EI.CAR.VMAX);
    const t = timing(track, prof, Infinity, circuit);
    return {
      lap: r3(t.lap), sectors: t.sectors.map(r3), vmax_kmh: kmh(t.vmax), vmin_kmh: kmh(t.vminRef), vmin_lap_kmh: kmh(t.vminLap),
      terminal_kmh: kmh(vcap), sector_vmax_kmh: t.sectorVmax.map(kmh), straight_vmax_kmh: kmh(t.vmaxStraight),
      legal: true, violations: [], multipliers: mult,
    };
  }
  // Evaluation of a candidate against a baseline under the same conditions (ARCHITECTURE §4.4). opts: { baseline, td01 }
  function evaluate(circuit, setup, conditions, opts) {
    opts = opts || {}; conditions = conditions || {}; circuit = circuit || conditions.circuit || "silverstone";
    const baseline = opts.baseline || aero.BASELINE;
    const cand = evaluateOne(circuit, setup, conditions, opts);
    if (!cand.legal) return { legal: false, violations: cand.violations, lap: null, sectors: null, delta_lap: null, delta_sectors: null, model: MODEL_LABEL };
    // the baseline is what the car already runs: a directive (TD-01) constrains candidates, so a grandfathered baseline still gets its
    // lap (evaluated without the directive). A baseline outside the regulation itself is a caller error, never a silent NaN.
    let base = evaluateOne(circuit, baseline, conditions, opts);
    if (!base.legal && opts.td01) base = evaluateOne(circuit, baseline, conditions, Object.assign({}, opts, { td01: false }));
    if (!base.legal) throw new Error("evaluator: baseline is illegal (" + base.violations.join(", ") + ")");
    const out = Object.assign({}, cand, {
      delta_lap: r3(cand.lap - base.lap),
      delta_sectors: cand.sectors.map((s, i) => r3(s - base.sectors[i])),
      baseline: { lap: base.lap, sectors: base.sectors, vmax_kmh: base.vmax_kmh, vmin_kmh: base.vmin_kmh, sector_vmax_kmh: base.sector_vmax_kmh, straight_vmax_kmh: base.straight_vmax_kmh },
      grip_scale: r3(calibrate(trackFor(circuit), circuit).grip),
      model: MODEL_LABEL,
    });
    return out;
  }
  const api = { MODEL_LABEL, evaluate, evaluateOne, trackFor, calibrate, timing, sectorIndex };
  EI.evaluator = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
