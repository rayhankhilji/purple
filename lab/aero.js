// PURPLE - the aero map (F-01): five setup numbers -> physics multipliers + legality. ARCHITECTURE §8 is the spec.
// Reduced-order and documented; every number that is a model assumption lives HERE with its reasoning. Label on screen:
// "reduced-order lap model · calibrated to 2026 pole laps · aero map v1". Never CFD, never wind tunnel.
// Dual browser / Node: attaches to window.EI.aero and to module.exports.
(function () {
  // ---- regulation subset (ARCHITECTURE §4.1). Ranges are inclusive; the rule ID is what the UI and the agent see on a violation.
  const RANGES = {
    front_wing_deg: { min: 10, max: 40, base: 25, step: 1, rule: "REG-FW" },
    rear_wing_deg: { min: 5, max: 35, base: 20, step: 1, rule: "REG-RW" },
    ride_height_mm: { min: 25, max: 60, base: 35, step: 1, rule: "REG-RH" },
    brake_bias_pct: { min: 52, max: 62, base: 57, step: 1, rule: "REG-BB" },
    ers_deploy: { min: 0, max: 1, base: 0.5, step: 0.1, rule: "REG-ERS" },
  };
  const KEYS = Object.keys(RANGES);
  const BASELINE = Object.freeze(Object.fromEntries(KEYS.map(k => [k, RANGES[k].base])));
  // technical directive TD-01 (F-09): rear wing capped at 20° while active
  const TD01_RW_MAX = 20;

  // ---- sensitivities (per unit from the baseline). Chosen to reproduce published setup folklore: ~0.5-1.0 % of lap per 2° of rear
  // wing at Silverstone and ~3 km/h of straight-line speed per 2° (ARCHITECTURE §8). Drag enters as CD·cd, so the terminal speed is
  // VMAX · cd^(-1/3): +2° rear wing -> cd 1.022 -> -0.7 % top speed ≈ -2.4 km/h at 331 km/h. Downforce enters as GRIP.a1·df and
  // BRAKE.b1·df (the v² terms of the lateral and braking limits), which is where aero load acts in the game's model.
  const SENS = {
    rear_wing_deg: { df: 0.018, cd: 0.011 },     // the rear wing is the big lever: most load, most drag
    front_wing_deg: { df: 0.010, cd: 0.004 },    // the front wing adds less of both; its main job is balance (below)
    ride_height_mm: { df: -0.006, cd: 0 },       // lower = more floor load (ground effect); no drag change in this order of model
  };
  // bottoming: below 30 mm the floor stalls / the plank touches; mechanical grip (a0) falls 1.2 % per mm below 30
  const BOTTOMING = { below_mm: 30, a0_per_mm: 0.012 };
  // brake bias: 57 % front is the balanced point; every % away costs 0.4 % of the low-speed braking limit (b0): lock-ups one end
  const BIAS = { base_pct: 57, b0_per_pct: 0.004 };
  // aero balance: a front/rear mismatch (degrees) costs mechanical grip (understeer or oversteer the driver has to manage)
  const BALANCE = { fw_w: 0.6, rw_w: 0.4, a0_per_deg: 0.004 };
  // conditions: wet tyres and standing water (a0 mechanical grip, df aero load, b0 braking); wind acts in the drag term per sample
  const WET = { a0: 0.82, df: 0.90, b0: 0.85 };
  // multipliers never leave this band: beyond it the game's calibration constants stop meaning anything
  const CLAMP = { min: 0.6, max: 1.6 };
  // where the evaluator measures "minimum corner speed" (F-01.AC3, F-04.AC3): the fast complex, as metres along the track's centreline
  // (track.s frame, same as js/data/*.js corners[].s). Silverstone: Maggotts-Becketts-Chapel. Monza: the two Lesmos.
  const REF_CORNER = { silverstone: { name: "Maggotts-Becketts", s0: 3600, s1: 4200 }, monza: { name: "Lesmo 1-2", s0: 2150, s1: 2700 } };
  // the straight the wind test blows down (F-02.AC3): Hangar Straight at Silverstone, the main straight at Monza
  const REF_STRAIGHT = { silverstone: { name: "Hangar Straight", s0: 4300, s1: 5000 }, monza: { name: "Rettifilo Tribune", s0: 5300, s1: 5790 } };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const round = (v, dp) => { const m = Math.pow(10, dp); return Math.round(v * m) / m; };

  // legality: regulation subset + TD-01. Returns rule IDs; empty = legal.
  function violations(setup, opts) {
    const out = [];
    for (const k of KEYS) {
      const r = RANGES[k], v = setup ? setup[k] : undefined;
      if (typeof v !== "number" || !isFinite(v)) { out.push(r.rule === "REG-ERS" ? "REG-ERS" : r.rule + "-MIN"); continue; }
      if (k === "ers_deploy") { if (v < r.min || v > r.max) out.push("REG-ERS"); continue; }
      if (v < r.min) out.push(r.rule + "-MIN");
      if (v > r.max) out.push(r.rule + "-MAX");
    }
    if (opts && opts.td01 && setup && setup.rear_wing_deg > TD01_RW_MAX) out.push("TD-01");
    return out;
  }

  // setup (+ conditions) -> AeroMultipliers (ARCHITECTURE §4.3)
  function toMultipliers(setup, conditions, opts) {
    const viol = violations(setup, opts);
    if (viol.length) return { df: 1, cd: 1, a0: 1, b0: 1, legal: false, violations: viol };
    const fw = setup.front_wing_deg - RANGES.front_wing_deg.base, rw = setup.rear_wing_deg - RANGES.rear_wing_deg.base;
    const rh = setup.ride_height_mm, drh = rh - RANGES.ride_height_mm.base, bb = setup.brake_bias_pct;
    let df = 1 + SENS.rear_wing_deg.df * rw + SENS.front_wing_deg.df * fw + SENS.ride_height_mm.df * drh;
    let cd = 1 + SENS.rear_wing_deg.cd * rw + SENS.front_wing_deg.cd * fw + SENS.ride_height_mm.cd * drh;
    let a0 = 1, b0 = 1;
    if (rh < BOTTOMING.below_mm) a0 *= 1 - BOTTOMING.a0_per_mm * (BOTTOMING.below_mm - rh);
    const imb = BALANCE.fw_w * fw - BALANCE.rw_w * rw;
    a0 *= 1 - BALANCE.a0_per_deg * Math.abs(imb);
    b0 *= 1 - BIAS.b0_per_pct * Math.abs(bb - BIAS.base_pct);
    if (conditions && conditions.wet) { a0 *= WET.a0; df *= WET.df; b0 *= WET.b0; }
    const c = v => round(clamp(v, CLAMP.min, CLAMP.max), 4);
    return { df: c(df), cd: c(cd), a0: c(a0), b0: c(b0), legal: true, violations: [] };
  }

  // terminal speed of a setup (m/s): PM / v = CD·cd·v²  ->  v = VMAX · cd^(-1/3)
  function terminalSpeed(cd, vmax) { return (vmax || 92) * Math.pow(cd, -1 / 3); }

  // ---- wind. Conditions carry the compass direction the wind blows FROM (0 = north, 90 = east). Track headings are atan2(dz, dx)
  // in the game's frame (+x east, +z south). The headwind a car feels at heading h is wind_ms · sin(from - h') where h' is the
  // car's compass bearing; derived below without trig identities so the sign is checkable: travel · windVector, negated.
  function headwind(conditions, headingRad) {
    const ms = conditions && +conditions.wind_ms || 0; if (!ms) return 0;
    const th = ((conditions.wind_from_deg || 0) * Math.PI) / 180;
    // unit vector pointing to where the wind comes from: north = (0, -1), east = (1, 0) in (x, z)
    const fx = Math.sin(th), fz = -Math.cos(th);
    // wind velocity blows away from there; headwind = -(travel · windVel) = travel · from
    return ms * (Math.cos(headingRad) * fx + Math.sin(headingRad) * fz);
  }
  // compass bearing (deg) of a track heading, for tests: "wind from the direction the straight points" = headwind on it
  function bearingOfHeading(headingRad) { const east = Math.cos(headingRad), north = -Math.sin(headingRad); return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360; }
  // per-sample headwind array for a track, keyed so profile caches can tell conditions apart
  function windField(track, conditions) {
    const ms = conditions && +conditions.wind_ms || 0; if (!ms) return null;
    const w = new Float32Array(track.n);
    for (let i = 0; i < track.n; i++) w[i] = headwind(conditions, track.heading[i]);
    w.key = ms + "@" + (conditions.wind_from_deg || 0);
    return w;
  }

  // ---- one-line human labels for rule IDs (F-09, the UI's violation badge). Numbers come from RANGES so the label and the check
  // can never disagree; unknown IDs come back unchanged.
  const LABELS = { front_wing_deg: ["Front wing", "°"], rear_wing_deg: ["Rear wing", "°"], ride_height_mm: ["Ride height", " mm"], brake_bias_pct: ["Brake bias", " % front"] };
  function describeViolation(id) {
    if (id === "TD-01") return "Technical directive TD-01: rear wing capped at " + TD01_RW_MAX + "°";
    if (id === "REG-ERS") return "ERS deploy outside " + RANGES.ers_deploy.min + "–" + RANGES.ers_deploy.max + " (regulation)";
    const m = /^(REG-[A-Z]+)-(MIN|MAX)$/.exec(id || ""); if (!m) return String(id);
    const k = KEYS.find(key => RANGES[key].rule === m[1]); if (!k || !LABELS[k]) return String(id);
    const [name, unit] = LABELS[k], r = RANGES[k];
    return m[2] === "MIN" ? name + " below " + r.min + unit + " (regulation)" : name + " above " + r.max + unit + " (regulation)";
  }

  const api = { RANGES, KEYS, BASELINE, SENS, BOTTOMING, BIAS, BALANCE, WET, CLAMP, TD01_RW_MAX, REF_CORNER, REF_STRAIGHT, violations, toMultipliers, terminalSpeed, headwind, bearingOfHeading, windField, describeViolation };
  const root = typeof window !== "undefined" ? window : globalThis;
  root.EI = root.EI || {}; root.EI.aero = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
