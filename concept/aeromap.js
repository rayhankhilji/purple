// PURPLE CONCEPT - concept aero map v0: part shape parameters -> downforce and drag RELATIVE to the baseline concept car (1.0 = the
// car the game's lap model is calibrated on), in Corner Mode and Straight Mode, plus aero balance and the cooling/thermal factor.
// Reduced-order and documented. Every coefficient below is a model assumption, not a measurement; the component shares are public
// folklore-level estimates for a 2026-style car. The wing and ride-height slopes are chosen so that at the baseline they reproduce
// the lab's aero map v1 (lab/aero.js SENS: +0.010 df / +0.004 cd per degree of front wing, +0.018 / +0.011 per degree of rear wing,
// -0.006 df per mm of ride height), so the concept and the lab agree where they overlap. test/concept.test.js checks it.
// Dual browser / Node: window.EI.concept.aeromap and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const VERSION = "concept aero map v0";

  // shares of the baseline car's total downforce / drag by component (sum to 1; estimates)
  const DF_SHARE = { front_wing: 0.25, rear_wing: 0.27, beam_wing: 0.03, floor: 0.40, body: 0.05 };
  const CD_SHARE = { wheels: 0.34, body: 0.25, cooling: 0.07, front_wing: 0.08, rear_wing: 0.12, beam_wing: 0.03, floor: 0.07, misc: 0.04 };
  // share of each component's downforce that acts on the front axle (centre of pressure); estimates
  const FRONT = { front_wing: 1.0, rear_wing: 0.0, beam_wing: 0.0, floor: 0.40, body: 0.5 };
  // wings: lift is linear in the setting from a zero-lift setting a_zl (front 0, rear 5: chosen so the baseline slopes match the lab),
  // with a stall that starts at a_st(n) = st_base + st_per_el·(n − n_base) and rolls off quadratically over `stall_w` degrees.
  // More volumes: +6 % load at the same setting, later stall, +10 % profile drag per volume. `induced` = induced share of the
  // wing's own baseline drag (front 0.625, rear 0.6875: highly loaded low-aspect wings are induced-drag dominated; with the drag
  // shares above these are exactly what makes the baseline cd slopes match the lab: share·induced·2·(dCL/CL) = 0.004 and 0.011).
  const WING = {
    front_wing: { base: { span_mm: 1300, chord_mm: 650, aoa_deg: 25, elements: 3 }, a_zl: 0, st_base: 34, st_per_el: 5, stall_w: 10, el_load: 0.06, el_drag: 0.10, induced: 0.625 },
    rear_wing: { base: { span_mm: 1100, chord_mm: 420, aoa_deg: 20, elements: 2, endplate_top_mm: 860 }, a_zl: 5, st_base: 28, st_per_el: 5, stall_w: 10, el_load: 0.06, el_drag: 0.10, induced: 0.6875, endplate_ar_per_mm: 0.002 },
  };
  // floor: ground effect ~ 1/(ride height + c) with c = throat_k · throat height; c = 31.7 mm at the baseline throat (100 mm) makes
  // d(df)/d(rh) = -0.006 per mm at 35 mm, as in the lab. Below an effective gap of stall_mm the floor starts to stall (porpoising
  // region): load falls off quadratically. Diffuser expansion peaks at 18°. Undercut feeds the floor edge (+0.02 % /mm) and
  // trims body drag (-0.05 %/mm) but past 140 mm it eats radiator volume (cooling capacity -1/3 % per mm).
  const FLOOR = { throat_k: 0.3167, base_rh: 35, base_throat: 100, stall_mm: 58, stall_w: 25, stall_floor: 0.4, base_len_mm: 3100, base_width_mm: 1800 };
  const DIFFUSER = { base: 14, lin: 0.03, quad: 0.00375, drag_per_deg: 0.02 };
  const UNDERCUT = { base: 100, df_per_mm: 0.0002, body_cd_per_mm: 0.0005, cool_free_mm: 140, cool_per_mm: 1 / 300 };
  // cooling: capacity ∝ inlet area × undercut efficiency; the baseline (650 cm²) has 15 % margin over what the PU needs. Below the
  // need the PU derates: power × (1 − 1.5·shortfall²), floored at 0.5. Cooling drag ∝ inlet area; sidepod body drag 20 % ∝ inlet.
  const COOLING = { base_cm2: 650, need: 0.85, derate_k: 1.5, derate_floor: 0.5 };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function wingLift(spec, a, n) {
    const st = spec.st_base + spec.st_per_el * (n - spec.base.elements), over = Math.max(0, a - st);
    return Math.max(0, (a - spec.a_zl) - (over * over) / (2 * spec.stall_w)) * (1 + spec.el_load * (n - spec.base.elements));
  }
  // one wing: relative downforce (corner, straight) and relative drag (corner, straight)
  function wing(id, p) {
    const s = WING[id], b = s.base, n = p.elements;
    const S = (p.span_mm * p.chord_mm) / (b.span_mm * b.chord_mm), spanR = b.span_mm / p.span_mm;
    const ar = id === "rear_wing" ? 1 + s.endplate_ar_per_mm * (p.endplate_top_mm - b.endplate_top_mm) : 1;
    const L0 = wingLift(s, b.aoa_deg, b.elements);
    const flapShare = n >= 2 ? (n - 1) / n : 0, aSM = p.aoa_deg - p.sm_delta_deg * flapShare;
    const clC = wingLift(s, p.aoa_deg, n) / L0, clS = wingLift(s, aSM, n) / L0;
    const prof = (1 - s.induced) * S * (1 + s.el_drag * (n - b.elements));
    const ind = cl => (s.induced * Math.pow(cl * S, 2) * spanR * spanR) / ar;
    return { df: S * clC, df_sm: S * clS, cd: prof + ind(clC), cd_sm: prof + ind(clS) };
  }
  function floorLoad(p, wb) {
    const area = ((wb - 300) / FLOOR.base_len_mm) * (p.floor.width_mm / FLOOR.base_width_mm);
    const c = FLOOR.throat_k * p.floor.throat_mm, c0 = FLOOR.throat_k * FLOOR.base_throat, h = p.floor.ride_height_mm + c;
    const G = (FLOOR.base_rh + c0) / h;
    const S = h >= FLOOR.stall_mm ? 1 : Math.max(FLOOR.stall_floor, 1 - Math.pow((FLOOR.stall_mm - h) / FLOOR.stall_w, 2));
    const e = p.diffuser.expansion_deg - DIFFUSER.base, D = 1 + DIFFUSER.lin * e - DIFFUSER.quad * e * e;
    const U = 1 + UNDERCUT.df_per_mm * (p.sidepods.undercut_mm - UNDERCUT.base);
    return { df: area * G * S * D * U, cd: area * (1 + DIFFUSER.drag_per_deg * e) * (0.7 + 0.3 * G * S), stalled: h < FLOOR.stall_mm, gap_mm: h };
  }
  function cooling(p) {
    const u = p.sidepods.undercut_mm, eta = 1 - Math.max(0, u - UNDERCUT.cool_free_mm) * UNDERCUT.cool_per_mm;
    const cap = (p.sidepods.inlet_cm2 / COOLING.base_cm2) * eta, short = Math.max(0, (COOLING.need - cap) / COOLING.need);
    return { capacity: cap, need: COOLING.need, power_factor: Math.max(COOLING.derate_floor, 1 - COOLING.derate_k * short * short) };
  }

  // params: a Design's params. Returns relative coefficients (baseline = 1.0) and the per-component breakdown.
  function evaluate(params) {
    const wb = params.layout.wheelbase_mm, fw = wing("front_wing", params.front_wing), rw = wing("rear_wing", params.rear_wing);
    const fl = floorLoad(params, wb), cool = cooling(params), u = params.sidepods.undercut_mm - UNDERCUT.base;
    const inlet = params.sidepods.inlet_cm2 / COOLING.base_cm2;
    const comp = {
      front_wing: { df: fw.df, df_sm: fw.df_sm, cd: fw.cd, cd_sm: fw.cd_sm },
      rear_wing: { df: rw.df, df_sm: rw.df_sm, cd: rw.cd, cd_sm: rw.cd_sm },
      beam_wing: { df: 1, df_sm: 1, cd: 1, cd_sm: 1 },
      floor: { df: fl.df, df_sm: fl.df, cd: fl.cd, cd_sm: fl.cd },
      body: { df: 1, df_sm: 1, cd: (1 - UNDERCUT.body_cd_per_mm * u) * (0.8 + 0.2 * inlet), cd_sm: (1 - UNDERCUT.body_cd_per_mm * u) * (0.8 + 0.2 * inlet) },
      cooling: { df: 0, df_sm: 0, cd: inlet, cd_sm: inlet },
      wheels: { df: 0, df_sm: 0, cd: 1, cd_sm: 1 },
      misc: { df: 0, df_sm: 0, cd: 1, cd_sm: 1 },
    };
    let df = 0, dfs = 0, cd = 0, cds = 0, front = 0, frontS = 0;
    const breakdown = {};
    for (const k of Object.keys(comp)) {
      const ds = DF_SHARE[k] || 0, cs = CD_SHARE[k] || 0, c = comp[k];
      df += ds * c.df; dfs += ds * c.df_sm; cd += cs * c.cd; cds += cs * c.cd_sm;
      front += ds * c.df * (FRONT[k] || 0); frontS += ds * c.df_sm * (FRONT[k] || 0);
      breakdown[k] = { df: +(ds * c.df).toFixed(4), cd: +(cs * c.cd).toFixed(4), df_sm: +(ds * c.df_sm).toFixed(4), cd_sm: +(cs * c.cd_sm).toFixed(4) };
    }
    return {
      df, df_sm: dfs, cd, cd_sm: cds, balance: front / df, balance_sm: dfs > 0 ? frontS / dfs : 0,
      floor_gap_mm: fl.gap_mm, floor_stalled: fl.stalled, cooling: cool, breakdown, version: VERSION,
    };
  }
  // fractional change of total corner downforce per mm of ride height at the design's ride height (|d ln df / d rh|, central diff)
  function rideSensitivity(params) {
    const at = rh => evaluate(Object.assign({}, params, { floor: Object.assign({}, params.floor, { ride_height_mm: rh }) })).df;
    const rh = params.floor.ride_height_mm, h = 0.5;
    return Math.abs((at(rh + h) - at(rh - h)) / (2 * h)) / at(rh);
  }
  // ride height (mm, 0.5 mm grid inside the floor's domain) at which the corner downforce peaks for this design
  function rideOptimum(params) {
    let best = null, bestDf = -Infinity;
    for (let rh = 20; rh <= 70; rh += 0.5) { const d = evaluate(Object.assign({}, params, { floor: Object.assign({}, params.floor, { ride_height_mm: rh }) })).df; if (d > bestDf + 1e-12) { bestDf = d; best = rh; } }
    return best;
  }

  const api = { VERSION, DF_SHARE, CD_SHARE, FRONT, WING, FLOOR, DIFFUSER, UNDERCUT, COOLING, evaluate, rideSensitivity, rideOptimum, wing, floorLoad, cooling };
  C.aeromap = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
