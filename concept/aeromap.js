// PURPLE CONCEPT - concept aero map v1: part shape parameters -> downforce and drag RELATIVE to the baseline concept car (1.0 = the
// car the game's lap model is calibrated on), in Corner Mode and Straight Mode, plus aero balance and the cooling/thermal factor.
// Reduced-order and documented. Every coefficient below is a model assumption, not a measurement; the component shares are public
// folklore-level estimates for a 2026-style car. The wing and ride-height slopes are chosen so that at the baseline they reproduce
// the lab's aero map v1 (lab/aero.js SENS: +0.010 df / +0.004 cd per degree of front wing, +0.018 / +0.011 per degree of rear wing,
// -0.006 df per mm of ride height), so the concept and the lab agree where they overlap. test/concept.test.js checks it.
// v1 (docs/concept/COUPLING.md) adds the interaction terms: lever-rule axle split of each component (wheelbase × balance), the
// front wing in ground effect (ride height × front wing × balance), diffuser expansion × floor gap (best angle and stall onset),
// endplate × span (Hoerner-form aspect-ratio gain) and material stiffness → wing wash-out / floor flex (concept/materials.js).
// The baseline is unchanged (1.0, balance 43.5 %, the same lab slopes).
// Dual browser / Node: window.EI.concept.aeromap and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const VERSION = "concept aero map v1";
  let matsReq = null;
  if (!C.materials && typeof require === "function") { try { matsReq = require("./materials.js"); } catch (e) { matsReq = null; } }
  const mats = () => C.materials || matsReq;

  // shares of the baseline car's total downforce / drag by component (sum to 1; estimates). There is no beam wing in 2026 (Section
  // C3.11 lists none): its former 3 % of downforce and 3 % of drag sit in `body` (rear bodywork, tail, wheel-wake devices), which
  // keeps the wing and floor slopes calibrated to the lab and, with the body's front share 0.3125, the baseline balance at 43.5 %.
  const DF_SHARE = { front_wing: 0.25, rear_wing: 0.27, floor: 0.40, body: 0.08 };
  const CD_SHARE = { wheels: 0.34, body: 0.28, cooling: 0.07, front_wing: 0.08, rear_wing: 0.12, floor: 0.07, misc: 0.04 };
  // share of each component's downforce that acts on the front axle, from its centre of pressure x by the lever rule about the
  // axles: front share = (WB − x_cp) / WB. The wings are placed by the regulations relative to their own axle (RV-FW-PROFILES spans
  // XF −1250 to −475, so its CoP is taken at XF −860, the mass-sheet position; RV-RW-PROFILES spans XR 165-630, CoP at XR +400),
  // so a wing ahead of the front axle loads it by MORE than its own downforce (1 + 860/WB) and the rear wing, behind the rear axle,
  // unloads the front (−400/WB): a longer wheelbase shortens both levers relative to WB. The floor and body CoPs scale with the
  // wheelbase (fixed fractions); the floor's (0.3213, i.e. CoP at 0.679·WB, behind mid-wheelbase as a venturi floor's is) is set
  // so the baseline balance stays 43.5 % front. CoP positions are estimates. FRONT keeps the baseline (WB 3400) shares.
  const LEVER = { fw_x_mm: -860, rw_dx_mm: 400, body_front: 0.3125, base_balance: 0.435, base_wb: 3400 };
  LEVER.floor_front = (LEVER.base_balance - DF_SHARE.front_wing * (1 - LEVER.fw_x_mm / LEVER.base_wb) - DF_SHARE.rear_wing * (-LEVER.rw_dx_mm / LEVER.base_wb) - DF_SHARE.body * LEVER.body_front) / DF_SHARE.floor;
  function frontShares(wb) { return { front_wing: 1 - LEVER.fw_x_mm / wb, rear_wing: -LEVER.rw_dx_mm / wb, floor: LEVER.floor_front, body: LEVER.body_front }; }
  const FRONT = frontShares(LEVER.base_wb);
  // wings: lift is linear in the setting from a zero-lift setting a_zl (front 0, rear 5: chosen so the baseline slopes match the lab),
  // with a stall that starts at a_st(n) = st_base + st_per_el·(n − n_base) and rolls off quadratically over `stall_w` degrees.
  // More volumes: +6 % load at the same setting, later stall, +10 % profile drag per volume.
  // Wing drag (relative to the wing's own baseline drag) = profile + induced:
  //   profile = (1 − induced)·S·(1 + el_drag·Δn)·(1 + kp·(cl² − 1))   cl = section loading relative to the baseline wing's
  //   induced = induced·(cl·S)²·(span_ref/span)² / endplate factor
  // kp = 0.5 (assumption): a multi-element section's profile drag grows with its loading (viscous losses and separation rise
  // with setting), so a short, steep wing pays for its load and a long, shallow one is not free either; for a given load the
  // profile+induced drag is lowest near S·cl = load at cl ≈ 1. `induced` is then set so that the baseline cd slopes still equal
  // the lab's (share·2·(dcl/da)·(kp·(1 − induced) + induced) = 0.004 front, 0.011 rear): slope_share 0.625 / 0.6875 (the induced
  // share the map used before the profile term), induced = (slope_share − kp) / (1 − kp) = 0.25 / 0.375.
  const KP = 0.5, inducedFor = slope => (slope - KP) / (1 - KP);
  const WING = {
    front_wing: { base: { span_mm: 1300, chord_mm: 580, aoa_deg: 25, elements: 3 }, a_zl: 0, st_base: 34, st_per_el: 5, stall_w: 10, el_load: 0.06, el_drag: 0.10, kp: KP, slope_share: 0.625, induced: inducedFor(0.625) },
    rear_wing: { base: { span_mm: 1100, chord_mm: 420, aoa_deg: 20, elements: 2, endplate_top_mm: 860 }, a_zl: 5, st_base: 28, st_per_el: 5, stall_w: 10, el_load: 0.06, el_drag: 0.10, kp: KP, slope_share: 0.6875, induced: inducedFor(0.6875), flap_max_y_mm: 535 },
  };
  // ENDPLATE × SPAN (interaction). The endplate raises the wing's effective aspect ratio by e = 1 + k·h/b (the classical endplate
  // correction, form after Hoerner & Borst, Fluid-Dynamic Lift, 1985: k ≈ 1.9 for small h/b), h = endplate top − Z 725 (the
  // bottom of RV-RW-PROFILES, App. C2 §30.1; the lowest element sits there, estimate), b = span. Induced drag ∝ 1/e, relative to
  // the baseline (e0 = 1.233). A given endplate is worth more on a shorter wing (h/b larger): span and endplate do not add.
  const ENDPLATE = { k: 1.9, z_ref_mm: 725 };
  const endplateE = p => 1 + ENDPLATE.k * Math.max(0, p.endplate_top_mm - ENDPLATE.z_ref_mm) / p.span_mm;
  // floor: ground effect ~ 1/(ride height + c) with c = throat_k · throat height; c = 31.7 mm at the baseline throat makes
  // (v2 parameterisation, 2026-10-24 FIA pass: the throat is the venturi roof's height above Z=0, which C3.5.1(a) caps at the
  // RV-FLOOR-BODY roof, Z=75; the old 80-130 mm domain "above Z=0" lay above that roof. Rescaled ×0.6 with throat_k ÷ 0.6, so
  // c, and every aero number, is unchanged for a v1 design moved to throat_v2 = 0.6 × throat_v1: base 100 -> 60, 80 -> 48)
  // d(df)/d(rh) = -0.006 per mm at 35 mm, as in the lab. Below an effective gap of stall_mm the floor starts to stall (porpoising
  // region): load falls off quadratically. The stall is judged at the DYNAMIC ride height: static minus dyn_compression_mm (5 mm,
  // assumption: suspension and tyre compression under high-speed aero load), and the model rule PKG-FLOOR-STALL wants the dynamic
  // gap at least stall_margin_mm (2 mm, assumption) above stall_mm. The ground-effect term itself stays on the static height (the
  // lab calibration). Diffuser expansion peaks at 18°. Undercut feeds the floor edge (+0.02 % /mm) and trims body drag (-0.05 %/mm)
  // but past 140 mm it eats radiator volume (cooling capacity -1/3 % per mm).
  const FLOOR = { throat_k: 0.3167 / 0.6, base_rh: 35, base_throat: 60, stall_mm: 58, stall_w: 25, stall_floor: 0.4, base_len_mm: 3100, base_width_mm: 1450, dyn_compression_mm: 5, stall_margin_mm: 2 };
  // FRONT WING IN GROUND EFFECT (interaction ride height × front wing × balance). An inverted wing near the ground gains load as
  // its height-to-chord ratio h/c falls (Zerihan & Zhang 2000, J. Aircraft 37(6), single-element wing in ground effect: the
  // force-enhancement region above h/c ≈ 0.1). Modelled as lift × ((h0/c0) / (h/c))^n with n = 0.25 (estimate read off the
  // trend of that study, not a fit), h = static ride height + 10 mm plank + 85 mm (mean Z of the lowest edge of RV-FW-PROFILES,
  // Z 60 at the centre to 115 outboard, App. C2 §22.1). Drag is left at the free-stream value (estimate). So a higher ride height
  // now also unloads the front wing and moves the balance rearwards. To keep the baseline's TOTAL ride-height slope equal to the
  // lab's (lab/aero.js SENS, −0.006 df per mm, tested), the floor's ground-effect term becomes G^β with β set from the two slopes.
  const FW_GE = { n: 0.25, z_low_mm: 85, plank_mm: 10 };
  FW_GE.h0_mm = FLOOR.base_rh + FW_GE.plank_mm + FW_GE.z_low_mm;
  FLOOR.ge_beta = 1 - (DF_SHARE.front_wing * FW_GE.n / FW_GE.h0_mm) / (DF_SHARE.floor / (FLOOR.base_rh + FLOOR.throat_k * FLOOR.base_throat));
  // DIFFUSER × FLOOR GAP (interaction expansion × ride height × throat). D = 1 + quad·(2·p·e − e²), e = expansion − 14°, peaks at
  // e = p: 4° (18°) at the baseline gap. A smaller effective gap pushes the floor's suction up and leaves the diffuser less
  // pressure rise to recover before it separates, so (a) the best expansion falls by peak_per_mm = 0.1° per mm of dynamic gap
  // lost and (b) a steeper diffuser stalls at a larger gap: the stall onset rises stall_per_deg = 0.5 mm per degree above 14°.
  // Direction from the diffuser ground-effect studies (Senior & Zhang 2001, Exp. Fluids 31; Ruhrmann & Zhang 2003, J. Fluids Eng.
  // 125: the force-reduction phenomenon sets in at larger ride heights for steeper diffusers); both magnitudes are estimates.
  const DIFFUSER = { base: 14, lin: 0.03, quad: 0.00375, drag_per_deg: 0.02, peak_per_mm: 0.1, stall_per_deg: 0.5 };
  const UNDERCUT = { base: 100, df_per_mm: 0.0002, body_cd_per_mm: 0.0005, cool_free_mm: 140, cool_per_mm: 1 / 300 };
  // cooling: capacity ∝ inlet area × undercut efficiency; the baseline (650 cm²) has capacity 1.0 against a need of 0.85. The PU
  // needs a 5 % margin over that (ambient, traffic: assumption): required = need × 1.05 = 0.8925, and the model rule PKG-COOLING makes
  // anything below it illegal. Below `required` the PU also derates, with a LINEAR term so the first square centimetre short already
  // costs power: power × (1 − 1.0·shortfall − 1.5·shortfall²), shortfall = (required − capacity) / required, floored at 0.5.
  // Cooling drag ∝ inlet area; sidepod body drag 20 % ∝ inlet.
  // difficulty v1 (docs/concept/REDESIGNS.md §4): PARC FERMÉ. The car that qualifies is the car that races (the Sporting Regulations'
  // parc fermé conditions fix the set-up and bodywork from qualifying to the race, cooling openings included except for a change
  // of weather), so the cooling must be sized for the RACE, not for one qualifying lap: need 0.95 (ASSUMPTION: sustained race power
  // and running in traffic need ≈ 12 % more heat rejection than the 0.85 of a qualifying lap), required = 0.95 × 1.05 = 0.9975.
  // The baseline (capacity 1.0) is a car sized to that: the 12 % of inlet the optimiser used to cut for free is no longer free.
  const COOLING = { base_cm2: 650, need: 0.95, need_quali: 0.85, margin: 0.05, derate_lin: 1.0, derate_k: 1.5, derate_floor: 0.5 };

  // ---- redesigns v1 (docs/concept/REDESIGNS.md §2): CONCEPT FAMILIES. Each code's effect on the components, relative to the
  // baseline code (an empty entry = the baseline). df / cd: multipliers on a component's downforce / drag (both modes); flap:
  // multiplier on a wing's straight-mode relief; undercut_gain: multiplier on the undercut's floor-load and body-drag slopes;
  // stall_mm: shift of the floor's stall onset (mm of gap; + = stalls sooner); ge_beta: multiplier on the floor's ground-effect
  // exponent (> 1 = peakier, more ride-height sensitive); fw_ge_n: multiplier on the front wing's ground-effect exponent;
  // floor_front: change of the floor's front share of load (lever rule); cool: multiplier on cooling capacity; cool_free_dmm: shift
  // of the undercut depth past which the undercut eats radiator volume; rw_stall_deg: shift of the rear wing's stall setting.
  // EVERY MAGNITUDE IS AN ASSUMPTION of this concept map (directions from public 2022-2026 technical analysis of the concepts named;
  // sizes chosen as a few per cent of the component they act on, so that no concept dominates on its own). No flow is solved; nothing is measured.
  const CONCEPT_IDS = {
    sidepods: ["downwash", "zeropod", "ramp"], nose: ["long_low", "short_high"], fw_endplate: ["open_outwash", "closed_inwash"],
    rw_style: ["low_drag", "medium", "high_df"], floor_edge: ["simple", "scrolled"], cooling: ["standard", "airbox_gills", "compact"],
    cover: ["high_fin", "low_narrow"], fsusp: ["pushrod", "pullrod"],
  };
  const CONCEPT_AT = { sidepods: ["sidepods", "concept", 0], nose: ["nose", "concept", 0], fw_endplate: ["front_wing", "endplate", 0], rw_style: ["rear_wing", "style", 1], floor_edge: ["floor", "edge", 0], cooling: ["cooling", "layout", 0], cover: ["engine_cover", "style", 0], fsusp: ["suspension", "front", 0] };
  const REDESIGN = {
    sidepods: {
      downwash: {},
      // zeropod: far less pod body (body drag −7 %) but the floor edge loses the pod's downwash conditioning (floor −2.5 %), the
      // undercut has less to act on (half its slopes) and the floor stalls 1 mm sooner (the 2022 zeropod's porpoising lesson)
      zeropod: { df: { floor: 0.975 }, cd: { body: 0.93 }, undercut_gain: 0.5, stall_mm: 1.0 },
      // ramp: deep undercut under a wide pod with a top ramp: more flow to the floor edge (+2 %) and to the rear wing's lower
      // surface (+1.2 %), a wider body (+3 % body drag), the undercut works harder (×1.3) but eats radiator volume 30 mm sooner,
      // and the sealed edge stalls 0.5 mm later
      ramp: { df: { floor: 1.02, rear_wing: 1.012 }, cd: { body: 1.03 }, undercut_gain: 1.3, cool_free_dmm: -30, stall_mm: -0.5 },
    },
    // short high nose: more air under the nose to the floor (+1.5 %), the front wing's centre section loses its nose junction
    // (−2 %); the wing centre sits less in ground effect (exponent × 0.85); slightly less nose wetted area (body −0.5 %)
    nose: { long_low: {}, short_high: { df: { front_wing: 0.98, floor: 1.015 }, cd: { body: 0.995 }, fw_ge_n: 0.85 } },
    // closed inwash endplate: a sealed tip (front wing load +2 %, its drag −5 %), but the front tyre wake is no longer pushed
    // outboard: wheels drag +3 %, floor load −1.5 %; the sealed tip feels the ground more (exponent × 1.2)
    fw_endplate: { open_outwash: {}, closed_inwash: { df: { front_wing: 1.02, floor: 0.985 }, cd: { front_wing: 0.95, wheels: 1.03 }, fw_ge_n: 1.2 } },
    rw_style: {
      // low-drag spoon: −14 % rear wing load, −16 % rear wing drag, less flap to open (relief × 0.8)
      low_drag: { df: { rear_wing: 0.86 }, cd: { rear_wing: 0.84 }, flap: { rear_wing: 0.8 } },
      medium: {},
      // high downforce: +12 % load, +17 % drag (the extra camber is paid in profile and induced drag), a bigger flap to open
      // (relief × 1.1) and an earlier stall (−3° of setting)
      high_df: { df: { rear_wing: 1.12 }, cd: { rear_wing: 1.17 }, flap: { rear_wing: 1.1 }, rw_stall_deg: -3 },
    },
    // multi-fence scrolled edge: edge vortices seal the floor (+3.5 % floor load, 0.8 mm later stall) at +6 % floor drag; the
    // fences sit ahead of the rear tyre, so the floor's load moves rearwards (front share −0.02) and the floor gets peakier
    // (ground-effect exponent × 1.10: more ride-height sensitive)
    floor_edge: { simple: {}, scrolled: { df: { floor: 1.035 }, cd: { floor: 1.06 }, floor_front: -0.02, stall_mm: -0.8, ge_beta: 1.1 } },
    cooling: {
      standard: {},
      // large airbox + gills: an extra radiator in the roll-hoop airbox and gill exits (capacity × 1.12) for more cooling and body
      // drag (+10 % / +1.5 %) and a bigger wake ahead of the rear wing (−1 %)
      airbox_gills: { cool: 1.12, cd: { cooling: 1.1, body: 1.015 }, df: { rear_wing: 0.99 } },
      // compact, louvred engine cover: the cores move under the cover (no pod packaging loss, see COOL_PACK) with louvre exits
      // (capacity × 0.90: the cores sit next to the hot engine and the louvres exit into its bay, a smaller temperature difference;
      // cooling drag −8 %, body −1 %); hot louvre outflow over the rear wing's centre (−1.5 %)
      compact: { cool: 0.9, cd: { cooling: 0.92, body: 0.99 }, df: { rear_wing: 0.985 } },
    },
    // low narrow engine cover: −2.5 % body drag, cleaner flow to the rear wing's centre (+1.5 %); a tighter engine bay with less
    // internal exit area (cooling capacity × 0.96); no fin: less yaw stability, so the driver's aero-balance window loses 0.004 on
    // the forward (oversteer) side (concept/physical.js BALANCE_WINDOW) and the car becomes yaw-sensitive in a crosswind (downforce
    // × (1 − 0.003 per degree of yaw): the sim's aero.yaw_sens; the fin car is the reference at 0)
    cover: { high_fin: {}, low_narrow: { cd: { body: 0.975 }, df: { rear_wing: 1.015 }, cool: 0.96, window_fwd: -0.004, yaw_sens: 0.003 } },
    // pullrod front: the upper wishbone can sit higher (cleaner path to the floor's leading edge, +0.6 %) with a low rocker fairing
    // (+0.4 % body drag); rods in tension: a stiffer installation (platform × 1.05, concept/parts.js heaveRatio)
    fsusp: { pushrod: {}, pullrod: { df: { floor: 1.006 }, cd: { body: 1.004 }, heave: 1.05 } },
  };
  // pod packaging × cooling layout: share of the radiator capacity a pod concept can package with each layout (zeropod's narrow pod
  // cannot hold the standard cores; the compact layout puts them under the engine cover, so it does not depend on the pod)
  const COOL_PACK = { downwash: { standard: 1, airbox_gills: 1, compact: 1 }, zeropod: { standard: 0.78, airbox_gills: 0.92, compact: 1 }, ramp: { standard: 0.94, airbox_gills: 0.98, compact: 1 } };
  // interactions between families (assumptions): a scrolled edge gives the zeropod back half of its floor loss; a low narrow
  // cover has less louvre area for the compact layout (capacity × 0.95)
  const CONCEPT_COMBOS = { zeropod_scrolled_floor: 1.0125, lownarrow_compact_cool: 0.95 };
  function conceptCode(p, fam) {
    const at = CONCEPT_AT[fam], q = p && p[at[0]], v = q && typeof q[at[1]] === "number" && isFinite(q[at[1]]) ? Math.round(q[at[1]]) : at[2];
    const ids = CONCEPT_IDS[fam]; return ids[Math.max(0, Math.min(ids.length - 1, v))];
  }
  // the design's concept families, combined: { ids, df, cd, flap, ... } (identity for the baseline codes)
  function conceptEffects(p) {
    const ids = {}, df = { front_wing: 1, rear_wing: 1, floor: 1, body: 1 }, cd = { wheels: 1, body: 1, cooling: 1, front_wing: 1, rear_wing: 1, floor: 1, misc: 1 };
    const o = { ids, df, cd, flap: { front_wing: 1, rear_wing: 1 }, undercut_gain: 1, stall_mm: 0, ge_beta: 1, fw_ge_n: 1, floor_front: 0, cool: 1, cool_free_dmm: 0, rw_stall_deg: 0, window_fwd: 0, yaw_sens: 0, heave: 1 };
    for (const fam of Object.keys(REDESIGN)) {
      const id = (ids[fam] = conceptCode(p, fam)), e = REDESIGN[fam][id] || {};
      for (const k of Object.keys(e.df || {})) df[k] *= e.df[k];
      for (const k of Object.keys(e.cd || {})) cd[k] *= e.cd[k];
      for (const k of Object.keys(e.flap || {})) o.flap[k] *= e.flap[k];
      for (const k of ["undercut_gain", "ge_beta", "fw_ge_n", "cool", "heave"]) if (typeof e[k] === "number") o[k] *= e[k];
      for (const k of ["stall_mm", "floor_front", "cool_free_dmm", "rw_stall_deg", "window_fwd", "yaw_sens"]) if (typeof e[k] === "number") o[k] += e[k];
    }
    o.cool *= COOL_PACK[ids.sidepods][ids.cooling];
    if (ids.sidepods === "zeropod" && ids.floor_edge === "scrolled") df.floor *= CONCEPT_COMBOS.zeropod_scrolled_floor;
    if (ids.cover === "low_narrow" && ids.cooling === "compact") o.cool *= CONCEPT_COMBOS.lownarrow_compact_cool;
    return o;
  }
  // ---- difficulty v1 (docs/concept/REDESIGNS.md §4): costs at the range edges the map used to give away. Past a reference value the
  // extra planform / endplate / flap opening counts at EDGE.k (half) of its in-range rate (ASSUMPTIONS):
  //   front wing span past 1300 mm and rear wing span past 1100 mm: the outboard tips work in the tyres' wake (load only; the
  //     profile drag of the real area is kept);  floor body width past 1450 mm: the floor edge meets the front tyre's wake and the
  //     rear tyre squirt (load only);  rear endplate top past 860 mm: the endplate's aspect-ratio gain;
  //   Straight Mode flap opening past the reference (front 4°, rear 15°, concept/design.js REF_STRAIGHT_MODE): the slot flow
  //     separates from the opened flap, so each further degree sheds half as much loading
  // The baselines sit at the references, so they are unchanged.
  const EDGE = { k: 0.5, fw_span_mm: 1300, rw_span_mm: 1100, floor_width_mm: 1450, endplate_top_mm: 860, sm_ref_deg: { front_wing: 4, rear_wing: 15 } };
  const soft = (v, ref) => (v > ref ? ref + EDGE.k * (v - ref) : v);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function wingLift(spec, a, n) {
    const st = spec.st_base + spec.st_per_el * (n - spec.base.elements), over = Math.max(0, a - st);
    return Math.max(0, (a - spec.a_zl) - (over * over) / (2 * spec.stall_w)) * (1 + spec.el_load * (n - spec.base.elements));
  }
  // share of the wing's setting that Straight Mode removes: the flap volumes are every volume but the forwardmost ((n−1)/n of the
  // loading, C3.10.10(a)(i), C3.11.6(a)(i)); on the rear wing the flap also excludes everything outboard of Y=535 (C3.11.6(a)(ii)),
  // so the tips stay in Corner Mode: × min(1, 535 / half-span) (uniform spanwise loading, an assumption).
  function flapShare(id, p) {
    const n = p.elements; if (!(n >= 2)) return 0;
    const s = WING[id], span = s.flap_max_y_mm ? Math.min(1, s.flap_max_y_mm / (p.span_mm / 2)) : 1;
    return ((n - 1) / n) * span;
  }
  // one wing: relative downforce (corner, straight) and relative drag (corner, straight). ctx (optional, from evaluate):
  //   ride_height_mm: front wing ground effect (FW_GE);  flex_deg: the wing's in-service flex (concept/materials.js, baseline
  //   material = flex0) - a stiffer wing washes out less, so its effective setting is aoa + flex0 − flex (both modes)
  function wing(id, p, ctx) {
    const b = WING[id].base, n = p.elements, ce = ctx && ctx.concepts;
    const s = ce && id === "rear_wing" && ce.rw_stall_deg ? Object.assign({}, WING[id], { st_base: WING[id].st_base + ce.rw_stall_deg }) : WING[id];
    const S = (p.span_mm * p.chord_mm) / (b.span_mm * b.chord_mm), spanR = b.span_mm / p.span_mm;
    // difficulty v1 (EDGE): the load-carrying planform counts the span past the reference at half rate (tips in the tyre wake)
    const SL = (soft(p.span_mm, id === "front_wing" ? EDGE.fw_span_mm : EDGE.rw_span_mm) * p.chord_mm) / (b.span_mm * b.chord_mm);
    // rear endplate gain with the height past 860 mm at half rate (EDGE); endplateE (exported) stays the plain Hoerner form
    const ar = id === "rear_wing" ? endplateE(Object.assign({}, p, { endplate_top_mm: soft(p.endplate_top_mm, EDGE.endplate_top_mm) })) / endplateE(b) : 1;
    const L0 = wingLift(WING[id], b.aoa_deg, b.elements);
    const dA = ctx && ctx.flex_delta_deg ? ctx.flex_delta_deg : 0, a = p.aoa_deg + dA;
    // Straight Mode: the opening past the reference sheds half as much (EDGE); the concept's flap multiplier on top
    const aSM = a - soft(p.sm_delta_deg, EDGE.sm_ref_deg[id]) * flapShare(id, p) * (ce ? ce.flap[id] : 1);
    let ge = 1;
    if (id === "front_wing" && ctx && typeof ctx.ride_height_mm === "number") {
      const h = ctx.ride_height_mm + FW_GE.plank_mm + FW_GE.z_low_mm;
      ge = Math.pow((FW_GE.h0_mm / b.chord_mm) / (h / p.chord_mm), FW_GE.n * (ce ? ce.fw_ge_n : 1));
    }
    const clC = wingLift(s, a, n) / L0, clS = wingLift(s, aSM, n) / L0;
    const prof = cl => (1 - s.induced) * S * (1 + s.el_drag * (n - b.elements)) * (1 + s.kp * (cl * cl - 1));
    const ind = cl => (s.induced * Math.pow(cl * SL, 2) * spanR * spanR) / ar;
    return { df: SL * clC * ge, df_sm: SL * clS * ge, cd: prof(clC) + ind(clC), cd_sm: prof(clS) + ind(clS), cl: clC, cl_sm: clS, ground_effect: ge, aoa_eff_deg: a };
  }
  // floor: planform × ground effect (G^β) × stall × diffuser × undercut. flexMm: extra in-service floor flex from the floor's
  // material (concept/materials.js; 0 for the baseline material) - it adds to the dynamic compression, so it eats stall margin.
  // HEAVE (more-factors v1, docs/concept/FACTORS.md): the dynamic compression scales inversely with the platform stiffness (heave
  // springs + packers in series with the tyres, concept/parts.js heaveRatio; 1 at the reference set-up), so a softer car squats
  // more under the same aero load: 5 mm at the reference becomes 5 / ratio. Designs without setup parameters read the reference.
  let partsMod = null;
  const heaveRatio = p => { const P = partsMod || (partsMod = C.parts || (typeof require === "function" ? require("./parts.js") : null)); return P && P.heaveRatio ? P.heaveRatio(p) : 1; };
  function floorLoad(p, wb, flexMm, ce) {
    ce = ce || conceptEffects(p);
    const area = ((wb - 300) / FLOOR.base_len_mm) * (p.floor.width_mm / FLOOR.base_width_mm);
    // difficulty v1 (EDGE): the load-carrying width past 1450 mm counts at half rate (tyre wake / squirt); drag keeps the real area
    const areaL = ((wb - 300) / FLOOR.base_len_mm) * (soft(p.floor.width_mm, EDGE.floor_width_mm) / FLOOR.base_width_mm);
    const c = FLOOR.throat_k * p.floor.throat_mm, c0 = FLOOR.throat_k * FLOOR.base_throat, h = p.floor.ride_height_mm + c;
    const comp = FLOOR.dyn_compression_mm / heaveRatio(p) + (flexMm || 0);
    const hd = h - comp;   // effective gap at the dynamic ride height
    const hd0 = FLOOR.base_rh + c0 - FLOOR.dyn_compression_mm;
    const G = Math.pow((FLOOR.base_rh + c0) / h, FLOOR.ge_beta * ce.ge_beta);
    const e = p.diffuser.expansion_deg - DIFFUSER.base;
    const stallAt = FLOOR.stall_mm + DIFFUSER.stall_per_deg * e + ce.stall_mm;   // a steeper diffuser stalls at a larger gap (+ the concepts' shift)
    const S = hd >= stallAt ? 1 : Math.max(FLOOR.stall_floor, 1 - Math.pow((stallAt - hd) / FLOOR.stall_w, 2));
    const pk = DIFFUSER.lin / (2 * DIFFUSER.quad) + DIFFUSER.peak_per_mm * (hd - hd0);   // best expansion (above 14°) at this gap
    const D = 1 + DIFFUSER.quad * (2 * pk * e - e * e);
    const U = 1 + UNDERCUT.df_per_mm * ce.undercut_gain * (p.sidepods.undercut_mm - UNDERCUT.base);
    return { df: areaL * G * S * D * U, cd: area * (1 + DIFFUSER.drag_per_deg * e) * (0.7 + 0.3 * G * S), stalled: hd < stallAt, gap_mm: h, gap_dyn_mm: hd, stall_onset_mm: stallAt, stall_margin_mm: hd - stallAt, dynamic_ride_height_mm: p.floor.ride_height_mm - comp, dyn_compression_mm: comp - (flexMm || 0), diffuser_peak_deg: DIFFUSER.base + pk };
  }
  function cooling(p, ce) {
    ce = ce || conceptEffects(p);
    const u = p.sidepods.undercut_mm, eta = 1 - Math.max(0, u - (UNDERCUT.cool_free_mm + ce.cool_free_dmm)) * UNDERCUT.cool_per_mm;
    const cap = (p.sidepods.inlet_cm2 / COOLING.base_cm2) * eta * ce.cool, req = COOLING.need * (1 + COOLING.margin), short = Math.max(0, (req - cap) / req);
    return { capacity: cap, need: COOLING.need, required: req, layout_factor: ce.cool, margin_ok: cap >= req - 1e-9, power_factor: Math.max(COOLING.derate_floor, 1 - COOLING.derate_lin * short - COOLING.derate_k * short * short) };
  }

  // params: a Design's params. Returns relative coefficients (baseline = 1.0) and the per-component breakdown.
  // material flex (concept/materials.js): change of the wings' effective setting (deg) and of the floor's dynamic compression (mm)
  // against the baseline material; all 0 when the design names no material or the module is not loaded
  function materialFlex(params) {
    const M = mats(), out = { front_wing_deg: 0, rear_wing_deg: 0, floor_mm: 0 };
    if (!M) return out;
    for (const id of ["front_wing", "rear_wing", "floor"]) {
      if (!(params[id] && typeof params[id].material === "string")) continue;
      const base = M.PARTS[id].flex.base, now = M.flex(params, id);
      if (id === "floor") out.floor_mm = now - base;
      else out[id + "_deg"] = base - now;   // less flex (stiffer) = less wash-out = a higher effective setting
    }
    return out;
  }
  function evaluate(params) {
    const wb = params.layout.wheelbase_mm, rh = params.floor.ride_height_mm, mf = materialFlex(params), ce = conceptEffects(params);
    const fw = wing("front_wing", params.front_wing, { ride_height_mm: rh, flex_delta_deg: mf.front_wing_deg, concepts: ce }), rw = wing("rear_wing", params.rear_wing, { flex_delta_deg: mf.rear_wing_deg, concepts: ce });
    const fl = floorLoad(params, wb, mf.floor_mm, ce), cool = cooling(params, ce), u = (params.sidepods.undercut_mm - UNDERCUT.base) * ce.undercut_gain;
    const FR = Object.assign({}, frontShares(wb)); FR.floor += ce.floor_front;
    const inlet = params.sidepods.inlet_cm2 / COOLING.base_cm2;
    const comp = {
      front_wing: { df: fw.df, df_sm: fw.df_sm, cd: fw.cd, cd_sm: fw.cd_sm },
      rear_wing: { df: rw.df, df_sm: rw.df_sm, cd: rw.cd, cd_sm: rw.cd_sm },
      floor: { df: fl.df, df_sm: fl.df, cd: fl.cd, cd_sm: fl.cd },
      body: { df: 1, df_sm: 1, cd: (1 - UNDERCUT.body_cd_per_mm * u) * (0.8 + 0.2 * inlet), cd_sm: (1 - UNDERCUT.body_cd_per_mm * u) * (0.8 + 0.2 * inlet) },
      cooling: { df: 0, df_sm: 0, cd: inlet, cd_sm: inlet },
      wheels: { df: 0, df_sm: 0, cd: 1, cd_sm: 1 },
      misc: { df: 0, df_sm: 0, cd: 1, cd_sm: 1 },
    };
    let df = 0, dfs = 0, cd = 0, cds = 0, front = 0, frontS = 0;
    const breakdown = {};
    // redesigns v1: the concept families' multipliers on each component (identity at the baseline codes)
    for (const k of Object.keys(comp)) { const c = comp[k], m = ce.df[k] || 1, n = ce.cd[k] || 1; c.df *= m; c.df_sm *= m; c.cd *= n; c.cd_sm *= n; }
    for (const k of Object.keys(comp)) {
      const ds = DF_SHARE[k] || 0, cs = CD_SHARE[k] || 0, c = comp[k];
      df += ds * c.df; dfs += ds * c.df_sm; cd += cs * c.cd; cds += cs * c.cd_sm;
      front += ds * c.df * (FR[k] || 0); frontS += ds * c.df_sm * (FR[k] || 0);
      breakdown[k] = { df: +(ds * c.df).toFixed(4), cd: +(cs * c.cd).toFixed(4), df_sm: +(ds * c.df_sm).toFixed(4), cd_sm: +(cs * c.cd_sm).toFixed(4) };
    }
    return {
      df, df_sm: dfs, cd, cd_sm: cds, balance: front / df, balance_sm: dfs > 0 ? frontS / dfs : 0,
      floor_gap_mm: fl.gap_mm, floor_gap_dyn_mm: fl.gap_dyn_mm, floor_stalled: fl.stalled, stall_margin_mm: fl.stall_margin_mm, dynamic_ride_height_mm: fl.dynamic_ride_height_mm,
      flap_share: { front_wing: flapShare("front_wing", params.front_wing), rear_wing: flapShare("rear_wing", params.rear_wing) },
      stall_onset_mm: fl.stall_onset_mm, dyn_compression_mm: fl.dyn_compression_mm, diffuser_peak_deg: fl.diffuser_peak_deg, front_wing_ground_effect: fw.ground_effect, front_shares: FR, material_flex: mf,
      cooling: cool, breakdown, version: VERSION,
      // redesigns v1: the concept families in force and what they changed (for the engine's explanations and the dashboard)
      concepts: { ids: ce.ids, df: ce.df, cd: ce.cd, flap: ce.flap, undercut_gain: ce.undercut_gain, stall_mm: ce.stall_mm, ge_beta: ce.ge_beta, fw_ge_n: ce.fw_ge_n, floor_front: ce.floor_front, cool: ce.cool, cool_free_dmm: ce.cool_free_dmm, rw_stall_deg: ce.rw_stall_deg, window_fwd: ce.window_fwd, yaw_sens: ce.yaw_sens, heave: ce.heave },
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

  const api = { VERSION, heaveRatio, REDESIGN, COOL_PACK, CONCEPT_COMBOS, CONCEPT_IDS, EDGE, conceptEffects, DF_SHARE, CD_SHARE, FRONT, LEVER, FW_GE, ENDPLATE, WING, FLOOR, DIFFUSER, UNDERCUT, COOLING, frontShares, endplateE, materialFlex, evaluate, rideSensitivity, rideOptimum, wing, flapShare, floorLoad, cooling };
  C.aeromap = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
