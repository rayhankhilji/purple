// PURPLE CONCEPT - machine-readable subset of the 2026 FIA Formula 1 Technical Regulations that constrains shape and mass.
// Source of every `verified: true` figure: FIA, "2026 Formula 1 Regulations - Section C [Technical]", Issue 19, published
// 25/06/2026 (WMSC approval 23/06/2026): the issue in force at the British GP (3-5 July 2026). Fetched from fia.com on 2026-10-24
// (PDF sha256 8751d3d4...b52ad0a) and read directly; article numbers below are that issue's. Every article cited here reads the
// same in Issue 17 (28/04/2026, the issue this file first cited) apart from wording this model does not use (C5.2.3 adds a
// 550 MJ/h per-cylinder cap; C5.2.10 adds "no Recharge limit behind the safety car in Low Grip conditions").
// Anything not read in that document is `verified: false` with its basis stated. Never claims more.
// FIA checklist pass (2026-10-24, docs/concept/FIA_CHECKLIST.md: one row per article the concept can touch, with the check and the
// test that covers it): COMBO_RULES (wing X+Z envelope, straight-mode direction, volume minimums, plank holes, sidepod inlet,
// suspension width, part-mass sanity, the PU lock PKG-PU-FIXED), MATERIAL_RULES (C15 and the component material articles, against
// concept/data/materials-2026.json), checkPU (C5.2 figures handed to the lap sims) and NaN-safe comparisons throughout.
// test/concept-regs-checklist.test.js re-implements every checked limit independently and compares verdicts on random and extreme
// designs. Issue 21 (19/10/2026) reads the same for every article checked here (it changes C5.2.10(ii), 5 -> 4 MJ, and C5.2.8(iii),
// neither of which is checked).
// Dual browser / Node: attaches to window.EI.concept.regs and to module.exports (same pattern as lab/aero.js).
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const SOURCE = "FIA 2026 F1 Regulations - Section C [Technical], Issue 19, 25/06/2026";
  const DOC = { title: "2026 Formula 1 Regulations - Section C [Technical]", issue: 19, date: "2026-06-25", wmsc: "2026-06-23", fetched: "2026-10-24", url: "https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_19_-_2026-06-25.pdf", previously_cited: "Issue 17, 2026-04-28" };
  const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

  // Nominal Tyre Mass (C4.7) is measured and published by the tyre supplier, not written in Section C. 44 kg is an ESTIMATE:
  // the widely reported 2026 "768 kg" headline minus C4.1's 724 kg race figure. Unverified; swap it when the published value is known.
  const NOMINAL_TYRE_MASS = { value: 44, unit: "kg", verified: false, article: "C4.7 (value published by the tyre supplier)", source: "estimate: 768 kg press headline (FIA/F1 2024 announcements, Pirelli 2026 preview) minus C4.1 724 kg" };

  // C4.1 / C4.2 sessions: the 726 kg minimum and the axle split apply in Qualifying and Sprint Qualifying; every other session
  // (race, sprint, practice) has the 724 kg minimum and no axle-split rule. Unknown or missing session = "qualifying" (the lap
  // model is a pole-lap model).
  const QUALI_SESSIONS = ["qualifying", "sprint_qualifying"];
  const SESSIONS = QUALI_SESSIONS.concat(["race", "sprint", "practice"]);
  const isQuali = session => session == null || !SESSIONS.includes(session) || QUALI_SESSIONS.includes(session);

  // C5.5.1 (ICE) and C5.18.7 (MGU-K) minimum masses are PAIRED by where the speed ratio of the MGU-K Mechanical Transmission sits.
  // Each pair sums to 150 kg. The concept car uses option a (fixed, see parts.PU); the check reads the option from the mass sheet.
  const MGUK_TRANSMISSION = {
    a: { ice_kg: 130, mguk_kg: 20, where: "all of the speed ratio in RV-PU-ERS" },
    b: { ice_kg: 134, mguk_kg: 16, where: "all of the speed ratio in RV-PU-ICE" },
    c: { ice_kg: 132, mguk_kg: 18, where: "part of the speed ratio in both RV-PU-ICE and RV-PU-ERS" },
  };

  // RV-FW-PROFILES (App. C2 §22): the §22.1 section (Y 0-675) extruded from XF=-1250 to XF=-475 (§22.2), trimmed in front by the
  // vertical plane RS-FW-SECTION through [XF=-1250, Y=100] and [XF=-1025, Y=700] (§21.1, §22.3) and behind by the vertical plane
  // through [XF=-750, Y=0] and [XF=-500, Y=400] (§22.4). The X extent available at a given |Y|:
  function fwEnvelopeX(y) {
    const front = y <= 100 ? -1250 : -1250 + (225 / 600) * (y - 100), rear = Math.min(-475, -750 + (250 / 400) * y);
    return rear - front;   // 500 mm at Y=0, 637.5 at Y=400, 647.5 at Y=440 (the widest), 559.4 at Y=675
  }
  // the concept's front-wing chord is the MEAN X extent over the span (planform / span); its limit is the mean of the trimmed
  // envelope's X extent over |Y| <= span/2 (Simpson's rule on a 1 mm grid of the piecewise-linear extent: exact to < 0.01 mm)
  function fwChordLimit(span_mm) {
    const h = Math.min(675, Math.max(1, span_mm / 2)), n = Math.max(2, 2 * Math.ceil(h / 2)), dy = h / n;
    let s = fwEnvelopeX(0) + fwEnvelopeX(h);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * fwEnvelopeX(i * dy);
    return (s * dy) / 3 / h;
  }
  // front flaps in Straight Mode must stay inside RV-FW-PROFILES (C3.10.10(s)(i), physical stops (u)). Model: the flap volumes
  // carry (n-1)/n of the chord, sit at a geometric angle equal to the wing setting (the lab's degree units read as degrees) and
  // rotate about their leading edge (C3.10.10(d)(ii): the axis is within 25 mm of it), so flattening by delta lengthens their X
  // projection by cos(theta - delta) / cos(theta). The straight-mode X extent must fit the same envelope.
  function fwStraightExtent(fw) {
    const n = fw.elements, share = n >= 2 ? (n - 1) / n : 0, th = (fw.aoa_deg * Math.PI) / 180, de = ((fw.sm_delta_deg || 0) * Math.PI) / 180;
    return fw.chord_mm * (1 - share) + fw.chord_mm * share * (Math.cos(th - de) / Math.cos(th));
  }
  const FLOOR_BODY_MAX_Y = 770;   // App. C2 §4.9: the floor-body plan polygon reaches Y=770 at XF=1100 (Floor Foot / Board to 890 only between XF 650 and 1350)

  // ---- wing profiles in Z (combination of span, chord, setting and volume count; FIA checklist pass, docs/concept/FIA_CHECKLIST.md)
  // RV-FW-PROFILES (App. C2 §22.1) is the [Y, Z] polygon [0,60] [100,60] [675,115] [675,275] [400,300] [0,200] extruded along X and
  // trimmed only by VERTICAL planes (§22.3, §22.4), so at a given |Y| its Z range is the same at every X:
  function fwSectionZ(y) { return { lo: y <= 100 ? 60 : 60 + (55 / 575) * (y - 100), hi: y <= 400 ? 200 + y / 4 : 300 - (25 / 275) * (y - 400) }; }
  // RV-RW-PROFILES (App. C2 §30.1-30.2): cuboid XR 165..630, Y 0..575, Z 725..880, material below the plane through
  // [165,150,725] [165,575,785] [630,575,785] discarded; that plane is Z = 725 + 60·(Y − 150)/425 at every X.
  function rwSectionZ(y) { return { lo: Math.max(725, 725 + (60 / 425) * (y - 150)), hi: 880 }; }
  // the flap model of REG-C-FW-SM-ENVELOPE applied to Corner Mode: the forwardmost volume lies flat (for the rear wing C3.11.1(d)
  // keeps its trailing-edge tangent within 10° of X), the remaining volumes carry (n−1)/n of the chord at a geometric angle equal to
  // the wing setting (the lab's degree units read as degrees), so the profiles rise chord·share·tan(setting) in Z. A single volume
  // carries the whole setting (share 1). Per |Y| the local chord must fit both the X extent and the Z height of the volume:
  // c(Y) ≤ min(Xext(Y), H(Y) / (share·tan θ)); the concept's mean chord can only fit if it is ≤ the span-mean of that minimum.
  const zShare = n => (n >= 2 ? (n - 1) / n : 1);
  // exact mean over [0, h] of min(fa, fb) for two functions that are linear between the given breakpoints
  function meanMin(h, breaks, fa, fb) {
    const xs = [0].concat(breaks.filter(b => b > 0 && b < h), [h]); let s = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i], b = xs[i + 1], da = fa(a) - fb(a), db = fa(b) - fb(b), m = (x, d) => (d <= 0 ? fa(x) : fb(x));
      if ((da <= 0) === (db <= 0)) s += 0.5 * (b - a) * (m(a, da) + m(b, db));
      else { const t = a + ((b - a) * da) / (da - db), v = fa(t); s += 0.5 * (t - a) * (m(a, da) + v) + 0.5 * (b - t) * (v + m(b, db)); }
    }
    return s / h;
  }
  // mean-chord limit of the front wing in Corner Mode: X (trimmed envelope) and Z (section height) together
  function fwProfilesChordLimit(fw) {
    const h = Math.min(675, Math.max(1, fw.span_mm / 2)), k = zShare(fw.elements) * Math.tan((fw.aoa_deg * Math.PI) / 180);
    if (!(k > 0)) return k <= 0 ? fwChordLimit(fw.span_mm) : NaN;
    return meanMin(h, [100, 400, 440], fwEnvelopeX, y => { const z = fwSectionZ(y); return (z.hi - z.lo) / k; });
  }
  // the same for the rear wing (X extent 465 mm at every |Y|, §30.1)
  function rwProfilesChordLimit(rw) {
    const h = Math.min(575, Math.max(1, rw.span_mm / 2)), k = zShare(rw.elements) * Math.tan((rw.aoa_deg * Math.PI) / 180);
    if (!(k > 0)) return k <= 0 ? 465 : NaN;
    return meanMin(h, [150], () => 465, y => { const z = rwSectionZ(y); return (z.hi - z.lo) / k; });
  }
  // C3.6.1(c): the rearmost plank hole sits at 470 ≤ XPU ≤ 630 and on or ahead of XR = −500, so XR − XPU ≥ 470 + 500
  const PLANK_HOLE = { xpu_min: 470, ahead_of_xr: 500 };
  // C3.16.9: Sidepod Inlet aperture ≤ 80,000 mm² per side (concept inlet_cm2 is both sides: ≤ 1600 cm²)
  const SIDEPOD_INLET_MAX_CM2 = 2 * 800;
  // C10.10.1: Wheel Coordinate System origin (inboard rim plane, C2.1.3(a)) at |Y| ≤ 603 front / 525 rear. Applied to the mass
  // sheet's wheel rows when they carry y_mm (wheel centre plane): inboard plane = y − half the rim overall width (C10.7.2(a): 334 /
  // 420.3 mm ref.).
  const SUSP_WIDTH = { wheels_front: { max_y: 603, half_rim: 167 }, wheels_rear: { max_y: 525, half_rim: 210.15 } };
  // the PU lock (PKG-PU-FIXED): the baseline team's PU as concept/parts.js massSheet builds it (kg, anchor plane, X offset, Z);
  // test/concept-regs-checklist.test.js checks this table against the baseline mass sheet so the two cannot drift apart
  const PU_LOCK = {
    mguk_transmission: "a",
    rows: { pu_ice: { kg: 118.5, at: "XPU", dx: 310, z: 230 }, pu_turbo: { kg: 12, at: "XPU", dx: 600, z: 430 }, pu_mguk: { kg: 20, at: "XPU", dx: 150, z: 180 }, pu_es: { kg: 35, at: "XC", dx: 120, z: 150 }, pu_electronics: { kg: 5.7, at: "XC", dx: 250, z: 250 } },
  };
  // RV-FLOOR-BODY roof (App. C2 §4.5, §4.11): Z = 75 at the centreline section from XF=1775 (§4.11; XF=1450 for the §4.1 part) to
  // XR=−600, the section is extruded across Y, and Floor Body must lie inside it (C3.5.1(a)). See REG-C-FLOOR-ROOF.
  const FLOOR_ROOF_Z = 75;
  // C15.5.1(f): CC-UHS = woven carbon cloth, fibre Ftu > 6250 MPa, epoxy prepreg (the survival-cell skin material, C15.5.3)
  const CC_UHS_FTU_MPA = 6250;

  // kind: "max" | "min" | "range" | "count-max" | "requires" | "info". `info` rules are recorded for the UI and the docs but are not
  // checkable with this model's degrees of freedom (stated in `modelled_as`). Values in mm / kg unless `unit` says otherwise.
  const RULES = [
    { id: "REG-C-WIDTH", article: "C2.3.1", kind: "max", value: 950, unit: "mm from Y=0", text: "No part (except tyres, rims, rim-attached parts) more than 950 mm from the car centre plane", verified: true },
    { id: "REG-C-WB", article: "C2.3.3", kind: "max", value: 3400, unit: "mm", text: "Wheelbase (XF=0 to XR=0) at most 3400 mm", verified: true },
    { id: "REG-C-FRONT-AXLE", article: "C2.3.4", kind: "range", min: 0, max: 150, unit: "mm behind XA=0", text: "Front axle plane XF=0 between XA=0 (front of the survival cell) and XA=150", verified: true },
    { id: "REG-C-COCKPIT", article: "C2.3.5", kind: "range", min: 1830, max: 2030, unit: "mm", text: "Distance XA=0 to XC=0 (rear of cockpit) between 1830 and 2030 mm", verified: true },
    { id: "REG-C-BULKHEAD", article: "C2.3.6", kind: "min", value: 360, unit: "mm", text: "Distance XC=0 to XPU=0 (ICE mounting face) at least 360 mm", verified: true },
    { id: "REG-C-FLOOR-WIDTH", article: "C3.5.1(a), App. C2 §4.9", kind: "max", value: 2 * FLOOR_BODY_MAX_Y, unit: "mm (2 × |Y|)", text: "Floor Body within RV-FLOOR-BODY, whose plan reaches Y=770 (floor body width ≤ 1540 mm)", verified: true, modelled_as: "floor.width_mm is the floor body's maximum width (2 × its largest |Y|); the Floor Foot and Floor Board volumes (Y ≤ 890 between XF 650 and 1350, App. C2 §6-7) are not part of the parameter" },
    { id: "REG-C-FW-ELEMENTS", article: "C3.10.1(b)", kind: "count-max", value: 3, unit: "volumes", text: "Front Wing Profiles: up to three non-intersecting volumes", verified: true },
    { id: "REG-C-FW-SPAN", article: "C3.10.1(a), App. C2 §22.1", kind: "max", value: 1350, unit: "mm", text: "Front Wing Profiles within RV-FW-PROFILES, which reaches Y=675 (span ≤ 1350 mm)", verified: true },
    { id: "REG-C-FW-CHORD", article: "C3.10.1(a), App. C2 §21.1, §22.1-22.4", kind: "max", value: +fwChordLimit(1350).toFixed(1), unit: "mm mean X extent (at 1350 mm span; depends on span)", text: "Front Wing Profiles within the trimmed RV-FW-PROFILES: X extent 500 mm at Y=0, widest 647.5 mm at Y=440, 559 mm at Y=675; the concept's mean chord must not exceed the envelope's mean X extent over the wing's span", verified: true, modelled_as: "chord_mm = planform / span (mean X extent); limit = mean of the trimmed envelope's X extent over |Y| ≤ span/2 (fwChordLimit)" },
    { id: "REG-C-FW-SM-ENVELOPE", article: "C3.10.10(s)(i), (u)", kind: "max", value: +fwChordLimit(1350).toFixed(1), unit: "mm mean X extent in Straight Mode", text: "FW Primary / Secondary Flaps must remain within RV-FW-PROFILES in every position (physical stops required): the straight-mode X extent must fit the trimmed envelope", verified: true, modelled_as: "flaps = (n−1)/n of the chord at a geometric angle equal to the wing setting, rotating about their leading edge; straight-mode extent = chord·(1−share) + chord·share·cos(θ−δ)/cos θ (fwStraightExtent) against fwChordLimit(span)" },
    { id: "REG-C-RW-ELEMENTS", article: "C3.11.1(b)", kind: "count-max", value: 3, unit: "volumes", text: "Rear Wing Profiles: up to three non-intersecting volumes", verified: true },
    { id: "REG-C-RW-SPAN", article: "C3.11.1(a), App. C2 §30.1", kind: "max", value: 1150, unit: "mm", text: "Rear Wing Profiles within RV-RW-PROFILES, which reaches Y=575 (span ≤ 1150 mm)", verified: true },
    { id: "REG-C-RW-CHORD", article: "C3.11.1(a), App. C2 §30.1-30.2", kind: "max", value: 465, unit: "mm", text: "RV-RW-PROFILES spans XR=165 to XR=630 (465 mm in X at every Y; its §30.2 trim is in Z only); the concept treats it as the chord limit", verified: true },
    { id: "REG-C-RW-ENDPLATE", article: "C3.11.2(a), App. C2 §31.1", kind: "max", value: 880, unit: "mm above Z=0", text: "Rear Wing Endplate Body within RV-RWEP-BODY, top at Z=880", verified: true },
    { id: "REG-C-FW-FLAP", article: "C3.10.10(a)(i)", kind: "requires", value: 2, unit: "volumes", text: "Front-wing Straight Mode moves the FW Primary/Secondary Flap, which excludes the forwardmost volume: needs ≥ 2 volumes", verified: true },
    { id: "REG-C-RW-FLAP", article: "C3.11.6(a)(i)", kind: "requires", value: 2, unit: "volumes", text: "Rear-wing Straight Mode moves the RW Flap, which excludes the forwardmost volume: needs ≥ 2 volumes", verified: true },
    { id: "REG-C-RW-FLAP-SPAN", article: "C3.11.6(a)(ii)-(iii)", kind: "info", value: 535, unit: "mm (|Y|)", text: "RW Flap excludes all remaining volumes outboard of Y=535 and includes all inboard of Y=530: the wing tips do not move", verified: true, modelled_as: "the rear flap's share of the wing is (n−1)/n × min(1, 535 / half-span) (concept/aeromap.js flapShare)" },
    { id: "REG-C-AERO-MODES", article: "C3.10.10(n)-(o), C3.11.6(c)-(d)", kind: "info", value: 400, unit: "ms transition", text: "Movable wing flaps have exactly two positions (Corner Mode, Straight Mode = lower incidence by a constant amount), ≤ 400 ms between them, deployed only inside Activation Zones (C3.10.10(w), C3.11.6(j); zones per Sporting Regulations B7.1.1(d), not read here)", verified: true, modelled_as: "one straight-mode flap angle per wing; Straight Mode downforce and drag both applied only on the model's activation zones (long low-curvature runs); transition time not modelled" },
    { id: "REG-C-PLANK", article: "C3.6.1(d)", kind: "max", value: 2, unit: "mm wear", text: "Plank Assembly 10 mm ±0.2 thick when new, 8 mm accepted with wear (2 mm wear allowance)", verified: true, modelled_as: "wear allowance checked against the concept plank-wear estimate (a function of static ride height; the estimate itself is a model assumption)" },
    { id: "REG-C-MASS-MIN", article: "C4.1", kind: "min", value: 726, unit: "kg + Nominal Tyre Mass", text: "Car Mass (incl. tyres, driver, driver ballast; without fuel) ≥ 726 kg + Nominal Tyre Mass in (Sprint) Qualifying; 724 kg + NTM in other sessions", verified: true, race_value: 724 },
    { id: "REG-C-MASS-FRONT", article: "C4.2(i)", kind: "min", value: 0.44, unit: "× Minimum Mass", text: "Qualifying and Sprint Qualifying: mass on the front axle ≥ 0.44 × Minimum Mass", verified: true, sessions: QUALI_SESSIONS },
    { id: "REG-C-MASS-REAR", article: "C4.2(ii)", kind: "min", value: 0.54, unit: "× Minimum Mass", text: "Qualifying and Sprint Qualifying: mass on the rear axle ≥ 0.54 × Minimum Mass", verified: true, sessions: QUALI_SESSIONS },
    { id: "REG-C-DRIVER-MASS", article: "C4.5.2", kind: "min", value: 82, unit: "kg", text: "Reference driver mass plus driver ballast ≥ 82 kg", verified: true },
    { id: "REG-C-PU-MASS", article: "C5.5.2", kind: "min", value: 185, unit: "kg", text: "Overall Power Unit mass ≥ 185 kg", verified: true },
    { id: "REG-C-ICE-MASS", article: "C5.5.1", kind: "min", value: 130, unit: "kg (by MGU-K transmission option)", text: "ICE PU Mass group (ICE + TC + Powerbox, App. C3 Drawing 9) ≥ 130 / 134 / 132 kg when the MGU-K transmission speed ratio sits in RV-PU-ERS (a) / RV-PU-ICE (b) / both (c); paired with C5.18.7", verified: true, by_option: MGUK_TRANSMISSION, modelled_as: "mass sheet ice_group_kg = pu_ice (ICE + Powerbox) + pu_turbo" },
    { id: "REG-C-TC-MASS", article: "C5.3.4", kind: "min", value: 12, unit: "kg", text: "Turbocharger mass ≥ 12 kg", verified: true },
    { id: "REG-C-MGUK-MASS", article: "C5.18.7", kind: "min", value: 16, unit: "kg (by MGU-K transmission option)", text: "MGU-K mass group ≥ 20 / 16 / 18 kg for transmission option a / b / c; paired with C5.5.1", verified: true, by_option: MGUK_TRANSMISSION },
    { id: "REG-C-ES-MASS", article: "C5.17.9", kind: "min", value: 35, unit: "kg", text: "Energy Store main-enclosure mass group ≥ 35 kg", verified: true },
    { id: "REG-C-PU-COG", article: "C5.5.3", kind: "min", value: 200, unit: "mm (Z)", text: "Centre of gravity of the PU (ICE and TC groups) above Z=200", verified: true },
    { id: "REG-C-DRIVELINE-MASS", article: "C9.5.2", kind: "min", value: 22, unit: "kg", text: "Driveline and gear-change components ≥ 22 kg", verified: true },
    { id: "REG-C-RIMS", article: "C10.7.2", kind: "info", value: 463, unit: "mm rim diameter", text: "Wheel rims: diameter 462.5/463 mm; tyre mounting width 315 (front) / 401.3 (rear) mm", verified: true, modelled_as: "wheels are fixed catalogue parts (no shape parameters)" },
    { id: "REG-C-ERS-K", article: "C5.2.7", kind: "info", value: 350, unit: "kW", text: "ERS-K DC power ≤ 350 kW", verified: true, modelled_as: "not modelled: the lap model is the game's mode 1 (full throttle, no ERS)" },
    { id: "REG-C-ERS-K-TAPER", article: "C5.2.8(i)", kind: "info", value: 345, unit: "km/h (ERS-K propulsion power 0 at and above)", text: "Without Overtake, ERS-K propulsion power ≤ 1800 − 5·v(km/h) kW below 340 km/h, ≤ 6900 − 20·v between 340 and 345, 0 from 345 km/h", verified: true, modelled_as: "passed to the physics sim through PhysicalCar.pu; the v0 game lap model has no ERS" },
    { id: "REG-C-ES-SOC", article: "C5.2.9", kind: "info", value: 4, unit: "MJ", text: "ES state-of-charge window (max − min) ≤ 4 MJ on track", verified: true, modelled_as: "PhysicalCar.pu energy figures; not used by v0" },
    { id: "REG-C-ES-RECHARGE", article: "C5.2.10", kind: "info", value: 8.5, unit: "MJ per lap", text: "Recharge ≤ 8.5 MJ per lap (may be cut to 7 MJ at some events, and to no less than 5 MJ in Sprint Qualifying and Qualifying)", verified: true, modelled_as: "PhysicalCar.pu.es_harvest_mj_per_lap; not used by v0" },
    { id: "REG-C-FUEL-FLOW", article: "C5.2.3", kind: "info", value: 3000, unit: "MJ/h", text: "Fuel energy flow ≤ 3000 MJ/h (≤ 550 MJ/h per cylinder)", verified: true, modelled_as: "not modelled: ICE power is an estimate (PhysicalCar.pu.ice_kw)" },
  ];
  // concept-model constraints: physics/packaging consequences of the regulation, NOT regulation text. Same violation channel.
  const MODEL_RULES = [
    { id: "PKG-WB", article: "concept packaging model v0", kind: "min", unit: "mm", text: "Wheelbase must fit front-axle offset + cockpit + bulkhead gap + ICE + gearbox to the final drive", verified: false, source: "concept packaging model v0 (ICE and gearbox lengths are estimates)" },
    { id: "PKG-COOLING", article: "concept thermal model v0", kind: "min", value: 1.05, unit: "× the PU's cooling need", text: "Cooling capacity must cover the PU's need with a 5 % margin (ambient and traffic not modelled)", verified: false, source: "concept aero map v0 COOLING.margin (assumption)" },
    { id: "PKG-FLOOR-STALL", article: "concept floor model v0", kind: "min", value: 2, unit: "mm above the stall gap", text: "Floor effective gap at the dynamic ride height (static − 5 mm high-speed compression) must stay ≥ 2 mm above the modelled stall onset (porpoising region)", verified: false, source: "concept aero map v0 FLOOR.dyn_compression_mm / stall_margin_mm (assumptions)" },
  ];
  // FIA checklist pass (docs/concept/FIA_CHECKLIST.md, 2026-10-24): combinations of parameters, input sanity and the remaining
  // geometric limits the concept's parameters touch. Kept apart from RULES (whose list the optimiser's proposer context and the
  // designer scenario are built from) so their budgets are unchanged; BY_ID, checkFacts and the checklist cover every list.
  const COMBO_RULES = [
    { id: "REG-C-FW-PROFILES-Z", article: "C3.10.1(a), App. C2 §22.1-22.4", kind: "max", value: +fwProfilesChordLimit({ span_mm: 1300, aoa_deg: 25, elements: 3 }).toFixed(1), unit: "mm mean chord (at the baseline 1300 mm span, 25°, 3 volumes; depends on span, setting and volume count)", text: "Front Wing Profiles within RV-FW-PROFILES in X AND Z: Z range 60-200 at Y=0, 60-300 at Y=400 (the tallest, 211 mm), 115-275 at Y=675; the flap volumes rise chord·(n−1)/n·tan(setting), so a steeper or longer wing must be shorter", verified: true, modelled_as: "per |Y| the chord fits min(X extent, Z height / ((n−1)/n·tan θ)) (one volume: share 1); the mean chord must not exceed that minimum's mean over |Y| ≤ span/2 (fwProfilesChordLimit). The flap model (forwardmost volume flat, flaps straight at the setting) is the one REG-C-FW-SM-ENVELOPE uses" },
    { id: "REG-C-RW-PROFILES-Z", article: "C3.11.1(a), (d), App. C2 §30.1-30.2", kind: "info", value: +rwProfilesChordLimit({ span_mm: 1100, aoa_deg: 20, elements: 2 }).toFixed(1), unit: "mm chord (at the baseline 1100 mm span, 20°, 2 volumes; depends on span, setting and volume count)", text: "Rear Wing Profiles within RV-RW-PROFILES in X AND Z: Z from 725 (|Y| ≤ 150) rising to 785 at Y=575, top 880, so 155 mm of height inboard and 95 mm at the tip; the forwardmost section's trailing edge is within 10° of X (C3.11.1(d)) and the flaps rise chord·(n−1)/n·tan(setting)", verified: true, modelled_as: "as REG-C-FW-PROFILES-Z with the 465 mm X extent: mean over |Y| ≤ span/2 of min(465, H(Y) / ((n−1)/n·tan θ)) (rwProfilesChordLimit). Straight Mode is exempt from C3.11.1 (C3.11.6(g)(ii)). NOT ENFORCED: the aero map gives the rear setting a 5° zero-lift offset (concept/aeromap.js WING.rear_wing.a_zl), so it is not a geometric angle, and the fixed (n−1)/n flap share would rule out most settings above ≈ 25°; computed and reported (rwProfilesChordLimit) until the aero-map owner defines the rear setting's geometry (FIA_CHECKLIST.md)" },
    { id: "REG-C-SM-DIRECTION", article: "C3.10.10(n)(ii), C3.11.6(c)(ii)", kind: "min", value: 0, unit: "° (straight-mode change)", text: "Straight Mode must DECREASE the flap incidence relative to Corner Mode: a negative straight-mode change (more incidence on the straights) is not a permitted position", verified: true },
    { id: "REG-C-ELEMENTS-MIN", article: "C3.10.1(b), (d); C3.11.1(b), C3.11.7(b)", kind: "min", value: 1, unit: "volumes (integer; front ≥ 1, rear ≥ 2)", text: "Each wing has a whole number of profile volumes: the front at least one (Front Wing Profiles must obscure RS-FW-PROFILES from above, C3.10.1(d)); the rear at least two, because 3-5 pairs of Rear Wing Separators MUST be fitted, each joining the forwardmost volume to the RW Flap (C3.11.7(b)), and the RW Flap excludes the forwardmost volume (C3.11.6(a)(i))", verified: true, modelled_as: "front_wing.elements integer ≥ 1, rear_wing.elements integer ≥ 2 (the ≤ 3 side is REG-C-FW-ELEMENTS / REG-C-RW-ELEMENTS)" },
    { id: "REG-C-PLANK-HOLES", article: "C3.6.1(c)", kind: "min", value: PLANK_HOLE.xpu_min + PLANK_HOLE.ahead_of_xr, unit: "mm (XR − XPU)", text: "The rearmost plank hole lies between XPU=470 and XPU=630 and on or ahead of XR=−500, so the rear axle must be at least 970 mm behind the ICE mounting face", verified: true },
    { id: "REG-C-SIDEPOD-INLET", article: "C3.16.9", kind: "max", value: SIDEPOD_INLET_MAX_CM2, unit: "cm² (both sides)", text: "Sidepod Inlet aperture ≤ 80,000 mm² per side, above Z=275", verified: true, modelled_as: "sidepods.inlet_cm2 (both sides) ≤ 1600 cm²; the Z=275 and RV position conditions are not parameters" },
    { id: "REG-C-SUSP-WIDTH", article: "C10.10.1, C2.1.3(a), C10.7.2(a)", kind: "max", value: 603, unit: "mm |Y| of the wheel coordinate origin (front 603, rear 525)", text: "Front Wheel Coordinate System origin (inboard rim plane) not outboard of Y=603, rear not outboard of Y=525", verified: true, modelled_as: "checked on the mass sheet's wheel rows when they carry y_mm (wheel centre plane − half the rim overall width 334 / 420.3 mm); concept/parts.js does not expose y_mm yet (see FIA_CHECKLIST.md)" },
    { id: "REG-C-FLOOR-ROOF", article: "C3.5.1(a), App. C2 §4.5, §4.11", kind: "max", value: FLOOR_ROOF_Z, unit: "mm (Z) between XF=1775 and XR=−600", text: "Floor Body lies within RV-FLOOR-BODY, whose roof is Z=75 from XF=1775 to XR=−600 at every Y, so no floor channel can be more than 75 mm above Z=0 there", verified: true, modelled_as: "floor.throat_mm (the venturi roof's height above Z=0, concept/parts.js; v2 parameterisation, domain 40-75) ≤ 75" },
    { id: "REG-C-HEAT-HAZARD", article: "C4.1, C4.6(a)", kind: "info", value: 5, unit: "kg", text: "When a Heat Hazard is declared, the Minimum Mass rises by 5 kg", verified: true, modelled_as: "not modelled: no Heat Hazard in the concept's Silverstone sessions (qualifying air 25.2 °C)" },
    { id: "REG-C-BALLAST", article: "C4.3.1-C4.3.3", kind: "info", text: "Ballast fixed to the sprung mass with tools needed to remove it; driver ballast between the ends of the cockpit entry template, on the survival cell, density > 7500 kg/m³ (C4.3.2); ballast ahead of XA=0 must be present in the front impact test (C4.3.3)", verified: true, modelled_as: "ballast sits between XF=0 and XR (x_frac 0-1), never ahead of XA=0; driver ballast at XC−750 (in the cockpit); densities checked when materials are assigned (REG-C-MAT-DENSITY)" },
    { id: "PKG-PU-FIXED", article: "concept PU lock (owner constraint: the baseline team's homologated PU, C5.5.7, App. C4)", kind: "requires", text: "The power unit is the baseline team's, unchanged: every PU part's mass and position (relative to XPU=0 / XC=0), the MGU-K transmission option and the PU energy figures handed to the lap sims must equal the baseline's (only the cooling derate may lower ICE power)", verified: false, source: "owner brief 2026-10-24 (same PU as the baseline team); PU rows of concept/parts.js massSheet (concept part masses v1, MASS.md)" },
    { id: "PKG-PART-MASS", article: "concept mass model v1", kind: "min", value: 0, unit: "kg per part", text: "Every part on the mass sheet has a finite, non-negative mass and position (overrides cannot delete mass to buy free ballast)", verified: false, source: "concept mass model (physical sanity, not regulation text)" },
  ];
  // C15 materials (Issue 19 pp. C156-C166) and the component-specific material articles. Checked against the materials table
  // (concept/data/materials-2026.json: [{ id, name, density_kg_m3, E_GPa, ... }]) for every part a design assigns a material to.
  const MATERIAL_RULES = [
    { id: "REG-C-MAT-SPECIFIC-MODULUS", article: "C15.1.4", kind: "max", value: 40, unit: "GPa/(g/cm³), metallic materials", text: "No part may be made from a metallic material whose specific modulus of elasticity exceeds 40 GPa/(g/cm³) (rules out beryllium and Be-Al alloys, boron/Al and other stiff MMCs)", verified: true },
    { id: "REG-C-MAT-PERMITTED", article: "C15.1.1, C15.1.3, C15.2, C15.4", kind: "requires", text: "Outside the PU perimeter only the C15.2 materials (iron alloys; listed aluminium, magnesium, Ni/Co, titanium, copper < 2.5 % Be, tungsten alloys; SupremEX 225XE/XF; listed AM metals; polymer composites with listed matrices and fibres, PAN carbon ≤ 550 GPa / ≤ 7100 MPa / ≤ 1.92 g/cm³; cores; polymers) or the C15.4 exceptions; commercially available", verified: true },
    { id: "REG-C-MAT-PROHIBITED", article: "C15.3.1-C15.3.2", kind: "requires", text: "Forbidden outside the PU: shape-memory materials (except piezo sensors), AM materials containing beryllium, alloys with > 5 % Pt+Ru+Ir+Re+Au, foil metallurgy, intermetallic alloys", verified: true },
    { id: "REG-C-MAT-PU", article: "C15.6.1", kind: "requires", text: "Inside the PU perimeter: no magnesium alloys, MMCs (> 2 % v/v insoluble phase), intermetallics, > 5 % Pt/Ru/Ir/Re, Cu alloys > 2.2 % Be, other alloys > 0.25 % Be, tungsten-base alloys, ceramics/CMC, Al alloys > 1 % Li or > 1 % Ag, nanomaterials, density > 18,400 kg/m³, polymer composites not in C15.2.3", verified: true },
    { id: "REG-C-MAT-COMPONENT", article: "C10.7.1, C7.4.1(a)-(b), C11.2.2, C15.5.3, C3.19.1, C12.4.2, C3.6.2(a), C3.6.3(d), C15.3.3, C15.3.4, C9.6.4, C9.10", kind: "requires", text: "Component-specific materials: rims AZ70/AZ80 magnesium; heat-exchanger cores aluminium, not additive manufactured; brake calipers aluminium; survival cell carbon-composite homologated laminates; front wing endplate PL-ANTISPLINTER laminate; halo the FIA-designated titanium part; plank SG 1.30-1.45; skids Ti6Al4V or 17-4PH; uprights listed Al/Ti/MMC grades; primary roll structure no particulate reinforcement; gear pairs and driveshafts steel", verified: true },
    { id: "REG-C-MAT-DENSITY", article: "C4.3.2(d), C5.5.8(d)", kind: "min", value: 7500, unit: "kg/m³", text: "Driver ballast (and ICE ballast) must have a density greater than 7500 kg/m³", verified: true },
  ];
  const ALL_RULES = RULES.concat(MODEL_RULES, COMBO_RULES, MATERIAL_RULES);
  const BY_ID = Object.create(null); for (const r of ALL_RULES) BY_ID[r.id] = Object.assign({ source: SOURCE }, r);

  // Minimum Mass for a session ("qualifying" default: the lap model is a pole-lap model). Returns kg and how it was built.
  function minMass(session) {
    const r = BY_ID["REG-C-MASS-MIN"], q = isQuali(session), base = q ? r.value : r.race_value;
    return { kg: base + NOMINAL_TYRE_MASS.value, base_kg: base, ntm_kg: NOMINAL_TYRE_MASS.value, axle_split: q, session: q ? (session && QUALI_SESSIONS.includes(session) ? session : "qualifying") : session, verified: false, note: "base verified (" + r.article + "); Nominal Tyre Mass estimated" };
  }

  const r1 = v => Math.round(v * 10) / 10;
  function viol(id, value, limit, extra) { const r = BY_ID[id]; return Object.assign({ id, article: r.article, value: typeof value === "number" ? r1(value) : value, limit, message: describeViolation(id, value, limit) }, extra || {}); }

  // ---- C15 materials ------------------------------------------------------------------------------------------------------
  // The table (concept/data/materials-2026.json) is read lazily and tolerantly: an array, { materials: [...] }, { items: [...] } or
  // an object keyed by id. Contract fields: id, name, density_kg_m3, E_GPa. Optional fields refine the classification: class /
  // category / type, family, grade, uns, metallic, be_pct, li_pct, ag_pct, pgm_pct (Pt+Ru+Ir+Re+Au), mmc_vol_pct, fibre (fiber),
  // fibre_modulus_GPa, fibre_strength_MPa, fibre_density_kg_m3, precursor, matrix, additive, shape_memory, intermetallic,
  // nanomaterial, foil_metallurgy, commercially_available. Without the file nothing is checked unless a design assigns a material,
  // which is then illegal (C15.1.1: only listed materials; an unknown one cannot be shown to be listed). setMaterials(table)
  // installs a table explicitly (browser, tests).
  let matTable = null, matLoaded = false;
  function normTable(t) {
    if (!t || typeof t !== "object") return null;
    const arr = Array.isArray(t) ? t : Array.isArray(t.materials) ? t.materials : Array.isArray(t.items) ? t.items
      : Object.keys(t).filter(k => k[0] !== "_" && t[k] && typeof t[k] === "object" && !Array.isArray(t[k])).map(k => Object.assign({ id: k }, t[k]));
    const list = arr.filter(m => m && typeof m === "object"), byId = Object.create(null);
    for (const m of list) if (m.id != null) byId[String(m.id)] = m;
    return { list, byId };
  }
  function setMaterials(table) { matTable = normTable(table); matLoaded = true; return matTable; }
  function materialTable() {
    if (!matLoaded) {
      matLoaded = true; let t = C.materials_table || (C.materials && C.materials.MATERIALS) || null;   // concept/materials.js (browser copy)
      if (!t && typeof require === "function") { try { t = require("./materials.js").MATERIALS; } catch (e) { t = null; } }
      if (!t && typeof require === "function") { try { t = require("./data/materials-2026.json"); } catch (e) { t = null; } }
      matTable = normTable(t);
    }
    return matTable;
  }
  function findMaterial(ref) {
    const T = materialTable(); if (!T || ref == null) return null;
    if (typeof ref === "object") return ref;   // an inline material record
    if (typeof ref === "number") { const byCode = T.list.find(m => m.code === ref || m.index === ref); return byCode || (Number.isInteger(ref) && ref >= 0 && ref < T.list.length ? T.list[ref] : null); }
    const s = String(ref); return own(T.byId, s) ? T.byId[s] : T.list.find(m => String(m.id).toLowerCase() === s.toLowerCase()) || null;
  }
  // carbon fibres by grade: [tensile modulus GPa, tensile strength MPa, density g/cm³, precursor] (manufacturer datasheets, secondary)
  const FIBRES = [
    [/\bt300\b/i, 230, 3530, 1.76, "PAN"], [/\bt700/i, 230, 4900, 1.80, "PAN"], [/\bt800/i, 294, 5880, 1.81, "PAN"], [/\bt1000/i, 294, 6370, 1.80, "PAN"],
    [/\bt1100/i, 324, 7000, 1.79, "PAN"], [/\bim7\b/i, 276, 5670, 1.78, "PAN"], [/\bim10\b/i, 310, 6964, 1.79, "PAN"], [/\bmr70\b/i, 324, 7000, 1.82, "PAN"],
    [/\bm40j\b/i, 377, 4400, 1.75, "PAN"], [/\bm46j\b/i, 436, 4200, 1.84, "PAN"], [/\bm55j\b/i, 540, 4020, 1.91, "PAN"], [/\bm60j\b/i, 588, 3920, 1.93, "PAN"],
    [/\bk13|\bxn-?\d{2}|\bys-?\d{2}|\bp-?1[02]0\b|\bpitch/i, 900, 3800, 2.2, "pitch"],
  ];
  const GRADES = {
    // C15.2.1(c) magnesium (outside the PU) and C10.7.1 rims
    mg: [[/\bwe-?43\s?-?[bc]\b|\bm1843[24]\b/i, "WE43B/C"], [/\bwe-?54\s?-?a?\b|\bm18410\b/i, "WE54A"], [/\baz-?80\s?-?a?\b|\bm11800\b/i, "AZ80A"]],
    rim: [/\baz-?(70|80)/i],
    // C15.2.1(e) titanium (and C15.2.2(d) for additive manufacture)
    ti: [/commercially pure|\bcp\b|grade ?[1-4]\b|\bgr\.? ?[1-4]\b/i, /grade ?9\b|ti-?3al-?2\.?5v/i, /grade ?(5|23)\b|ti-?6al-?4v|\bti-?64\b/i, /ti-?6-?2-?4-?2|ti6242|\br54620\b/i, /ti-?6-?2-?4-?6|ti6246|\br56260\b/i, /ti-?10-?2-?3|\br56410\b/i, /ti-?15-?3-?3-?3|\br58153\b/i, /38-?644|\br58640\b|beta ?c\b/i, /ti-?5-?5-?5-?3|ti5553|ti-5al-5mo-5v-3cr/i, /21s\b/i, /ti-?1100\b|timetal 1100/i, /ti-?6cr-?5mo-?5v-?4al/i],
    ti_am: [/grade ?[12]\b/i, /ti-?6al-?4v|\bti-?64\b|eli\b/i, /ti-?5-?5-?5-?3|ti5553/i, /ti-?6-?2-?4-?2|ti6242/i],
    // C15.2.1(d) Ni / Co superalloys, C15.2.2(g) AM, C15.4(p) Stellite on or above Z=0
    ni: [/inconel ?625|\bn06625\b|\bin625\b/i, /inconel ?718|\bn07718\b|\bin718\b/i, /waspaloy|\bn07001\b/i, /mp-?35n|\br30035\b/i, /mp-?159|\br30159\b/i],
    ni_am: [/cobalt.?chrom|\bcocr/i], stellite: [/stellite ?(6|12)\b|\br300(06|16|12)\b|\br30106\b/i],
    // C15.2.1(h) and C15.2.2(b): the only particulate-reinforced Al matrix composites
    mmc: [/supremex ?225 ?x[ef]\b/i], mmc_am: [/\ba20x\b|2024-?ram2|6061-?ram2/i],
    // C15.2.1(b)(iii)-(v): the Al-Li alloys listed by name
    alli: [/\b2050\b/, /\b2055\b/, /\b2099\b/],
    // C15.2.2(a), (c) AM aluminium; (e) AM steels
    al_am: [/alsi10mg|alsi7mg|cl-?30al|p339|2139 ?am|aheadd|scalmalloy|7a77/i], fe_am: [/\b316\b|\b304\b|\bms1\b|15-?5 ?ph|17-?4 ?ph/i],
    // C3.6.3(d) skids; C15.3.3 uprights (wrought Al grades)
    skid: [/ti-?6al-?4v|\bti-?64\b|grade ?5\b/i, /17-?4 ?ph/i], upright_al: [/\b2014\b|\ba92014\b|\b2618\b|\ba92618\b|\b7075\b|\ba97075\b|\b7022\b/i],
  };
  const any = (rxs, s) => rxs.some(r => (Array.isArray(r) ? r[0] : r).test(s));
  // classify a table record: { family, metallic, fibre, ... }. Family order matters (Be-Al before aluminium, C/C before CFRP, MMC
  // before ceramic, carbide before tungsten).
  function classify(mat) {
    const fib = mat.fibre && typeof mat.fibre === "object" ? mat.fibre : null;
    const s = [mat.id, mat.name, mat.family, mat.class, mat.category, mat.type, mat.grade, mat.uns, fib ? fib.name : mat.fibre, mat.fiber, mat.matrix].filter(v => v != null).join(" ");
    const cls = String([mat.class, mat.category, mat.type, mat.family].filter(v => v != null).join(" ")).toLowerCase();
    const T = (rx) => rx.test(s);
    let family = "unknown", fibre = null;
    if (mat.shape_memory === true || T(/nitinol|\bniti\b|shape.?memory/i)) family = "shape_memory";
    else if (cls === "carbon_carbon" || T(/carbon.?carbon|\bc\/c\b|\bc-c composite/i)) family = "carbon_carbon";
    else if (cls === "core") family = "core";
    else if (T(/ceramic.?matrix|\bcmc\b|\bc\/sic\b|\bsic\/sic\b/i)) family = "cmc";
    else if (T(/metal.?matrix|\bmmc\b|supremex|particulate.?reinforc|\bram2\b|\ba20x\b|boron.?alumin|\bb\/al\b|sic.?(particle|reinforced)/i)) family = "mmc";
    else if (T(/cu-?be\b|copper.?berylli|berylli\w*.?copper|\bc17[25]00\b/i)) family = "copper";
    else if (T(/berylli|albemet|\bbe-?al\b|\bal-?be\b|\bberyl/i)) family = "beryllium";
    else if (mat.intermetallic === true || T(/intermetallic|gamma.?tial|\btial\b|\bnial\b|\bti3al\b/i)) family = "intermetallic";
    else if (T(/cfrp|carbon.?fib|carbon\/|carbon.?(composite|epoxy|prepreg|laminate)|graphite.?epoxy/i) || any(FIBRES, s)) { family = "composite"; fibre = "carbon"; }
    else if (T(/aramid|kevlar|twaron|technora/i)) { family = "composite"; fibre = "aramid"; }
    else if (T(/zylon|\bpbo\b/i)) { family = "composite"; fibre = "pbo"; }
    else if (T(/dyneema|spectra|uhmwpe fib|polyethylene fib/i)) { family = "composite"; fibre = "pe"; }
    else if (T(/polypropylene fib|\bpp fib/i)) { family = "composite"; fibre = "pp"; }
    else if (T(/glass.?fib|\bgfrp\b|\b[esq]-?glass\b|\bbf-?glass\b|fibreglass|fiberglass/i)) { family = "composite"; fibre = "glass"; }
    else if (T(/basalt|boron fib|quartz fib|silicon carbide fib/i)) { family = "composite"; fibre = "unlisted"; }
    else if (T(/\bflax\b|\bhemp\b|\blinen\b|\bcotton\b|\bbamboo\b|natural.?fib/i)) { family = "composite"; fibre = "natural"; }
    else if (T(/honeycomb|nomex|\bfoam\b|rohacell|balsa|syntactic/i)) family = "core";
    else if (T(/tungsten.?carbide|\bwc-?co\b|ceramic|alumina\b|zirconia|silicon.?carbide|\bsic\b|silicon.?nitride|boron.?carbide|\bb4c\b/i)) family = "ceramic";
    else if (T(/tungsten|\bw-?ni|densimet|heavy.?alloy|\bwha\b/i)) family = "tungsten";
    else if (T(/magnesium|\baz-?\d\d|\bwe-?\d\d|\bzk-?\d\d|elektron|\bam-?60/i)) family = "magnesium";
    else if (T(/titanium|\bti-?\d|\bti64\b|ti6al4v|timetal|allvac/i)) family = "titanium";
    else if (T(/inconel|waspaloy|mp-?35n|mp-?159|hastelloy|nimonic|\brene ?\d|haynes|superalloy|cobalt.?chrom|stellite/i)) family = "superalloy";
    else if (T(/copper|bronze|brass\b/i)) family = "copper";
    else if (T(/alumin|\bal-?li\b|alsi10mg|scalmalloy|\b[1-8]\d{3}-?t\d/i)) family = "aluminium";
    else if (T(/steel|\biron\b|maraging|17-?4 ?ph|15-?5 ?ph|\b4340\b|\b300m\b/i)) family = "iron";
    else if (T(/platinum|iridium|rhenium|ruthenium|\bgold\b/i)) family = "precious";
    else if (T(/peek|pekk|nylon|polyamide|\bpa-?\d|\babs\b|polycarbonate|ptfe|acetal|delrin|ultem|\bpei\b|thermoplastic|thermoset|polymer|elastomer|rubber|resin/i)) family = "polymer";
    else if (/metal|alloy/.test(cls) || mat.metallic === true) family = "metal_unknown";
    else if (/composite/.test(cls)) { family = "composite"; fibre = "unknown"; }
    if (family === "composite" && fib && fibre !== "carbon" && /carbon|\(pan\)|pitch/i.test(fib.name || "")) fibre = "carbon";
    const METALS = ["iron", "aluminium", "magnesium", "titanium", "superalloy", "copper", "tungsten", "beryllium", "mmc", "intermetallic", "precious", "shape_memory", "metal_unknown"];
    const metallic = mat.metallic === true || (mat.metallic !== false && METALS.includes(family));
    const top = v => (Array.isArray(v) ? num(v[v.length - 1]) : num(v));   // C15.1.9: the whole declared range must be inside the limit
    let be = mat.be_pct != null ? top(mat.be_pct) : top(mat.be_wt_pct); if (be == null) be = family === "beryllium" ? (T(/albemet|\bal-?be\b|\bbe-?al\b/i) ? 62 : 100) : family === "copper" && T(/cu-?be|berylli/i) ? 2.0 : 0;
    let li = mat.li_pct != null ? top(mat.li_pct) : top(mat.li_wt_pct); if (li == null) li = family === "aluminium" && T(/al-?li\b|lithium|\b(2050|2055|2099|2195|2196|2198|2090|2091|8090)\b/) ? (T(/\b2050\b/) ? 1.3 : T(/\b2055\b/) ? 1.3 : 2.0) : 0;
    return { family, fibre, metallic, be, li, ag: num(mat.ag_pct) || 0, pgm: num(mat.pgm_pct) || (family === "precious" ? 100 : 0), text: s };
  }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  // the material classes of the concept's parts (part ids of concept/parts.js; extra ids for future sub-parts)
  const PU_PARTS = ["pu_ice", "pu_turbo", "pu_mguk", "pu_es", "pu_electronics"];
  const EXEMPT_PARTS = { electronics: "C15.4(d) (electrical components)", fuel_system: "C15.4(l) (regulated fuel bladder)", seat_safety: "C15.4(e), (l) (seals, regulated headrest / padding / extinguishant)", driver: "not a car part" };
  // C15.2 (outside the PU): is this classified material permitted? -> null or a reason string
  function c152(c, mat) {
    const s = c.text, am = mat.additive === true;
    switch (c.family) {
      case "iron": return am && !any(GRADES.fe_am, s) ? "additive-manufactured steel not in C15.2.2(e)" : null;
      case "aluminium":
        if (am) return any(GRADES.al_am, s) ? null : "additive-manufactured aluminium not in C15.2.2(a)/(c)";
        if (/\b8\d{3}\b/.test(s)) return "8xxx-series aluminium is not listed in C15.2.1(b)";
        return c.li >= 1 && !any(GRADES.alli, s) ? "aluminium alloy with ≥ 1 % lithium not listed in C15.2.1(b)" : null;
      case "magnesium": return am ? "no additive-manufactured magnesium in C15.2.2" : any(GRADES.mg, s) ? null : "magnesium grade not in C15.2.1(c) (WE43B, WE43C, WE54A, AZ80A only)";
      case "superalloy": return any(GRADES.stellite, s) ? null : any(am ? GRADES.ni.concat(GRADES.ni_am) : GRADES.ni, s) ? null : "Ni/Co alloy not in C15.2.1(d)" + (am ? "/C15.2.2(g)" : "");
      case "titanium": return any(am ? GRADES.ti_am : GRADES.ti, s) ? null : "titanium grade not in C15.2.1(e)" + (am ? "/C15.2.2(d)" : "") + " (or grade not stated)";
      case "copper": return am ? (c.be > 0 ? "AM copper alloy containing beryllium (C15.2.2(f), C15.3.1(b))" : null) : c.be >= 2.5 ? "copper alloy with ≥ 2.5 % beryllium (C15.2.1(f))" : null;
      case "tungsten": return null;
      case "mmc": return any(am ? GRADES.mmc_am : GRADES.mmc, s) ? null : "metal matrix composite other than SupremEX 225XE/XF (C15.2.1(h)) or A20X / 2024-RAM2 / 6061-RAM2 (C15.2.2(b))";
      case "composite": {
        const mx = mat.matrix != null ? String(mat.matrix).toLowerCase() : null;
        if (mx && !/epoxy|cyanate|bismaleimide|\bbmi\b|phenolic|polyurethane|polyester|thermoplastic|peek|pekk|pps|\bpa\b|polyamide|bio/.test(mx)) return "matrix " + mat.matrix + " not in C15.2.3(a)";
        if (c.fibre === "carbon") {
          const f = FIBRES.find(x => x[0].test(s)), fo = mat.fibre && typeof mat.fibre === "object" ? mat.fibre : {};
          const pick = (...vs) => { for (const v of vs) if (num(v) != null) return num(v); return null; };
          const E = pick(mat.fibre_modulus_GPa, fo.E_GPa, f && f[1]), Ft = pick(mat.fibre_strength_MPa, fo.tensile_MPa, f && f[2]);
          const rhoKg = pick(mat.fibre_density_kg_m3, fo.density_kg_m3), rho = rhoKg != null ? rhoKg / 1000 : f ? f[3] : null;
          const pre = String(mat.precursor || (/pitch/i.test(fo.name || "") ? "pitch" : f ? f[4] : "PAN"));
          if (!/pan|polyacrylonitrile/i.test(pre)) return "carbon fibre not from a PAN precursor (" + pre + ") (C15.2.3(b)(i))";
          if (E != null && E > 550) return "carbon fibre modulus " + E + " GPa > 550 GPa (C15.2.3(b)(i))";
          if (Ft != null && Ft > 7100) return "carbon fibre strength " + Ft + " MPa > 7100 MPa (C15.2.3(b)(i))";
          if (rho != null && rho > 1.92 + 1e-9) return "carbon fibre density " + rho + " g/cm³ > 1.92 (C15.2.3(b)(i))";
          // fibre not named: a laminate stiffer than 0.6 × 550 GPa needs a fibre above the limit (≤ 60 % fibre volume, assumption)
          if (E == null && num(mat.E_GPa) != null && mat.E_GPa > 330) return "laminate modulus " + mat.E_GPa + " GPa implies a carbon fibre above 550 GPa (C15.2.3(b)(i))";
          return null;
        }
        if (c.fibre === "glass") return /\b(e|s|q|bf)-?glass\b|glass.?fib|gfrp|fibreglass|fiberglass/i.test(s) && !/\b(c|ar|d|r|ecr)-?glass\b/i.test(s) ? null : "glass fibre type not E, S, Q or BF (C15.2.3(b)(vi))";
        if (c.fibre === "aramid" || c.fibre === "pbo" || c.fibre === "pe" || c.fibre === "pp" || c.fibre === "natural") return null;
        return "reinforcing fibre not listed in C15.2.3(b) (or not stated)";
      }
      case "core": case "polymer": return null;
      case "carbon_carbon": return "carbon-carbon only for friction materials (C15.4(c))";
      case "cmc": return "ceramic matrix composites only for friction materials, seals and thermal insulation (C15.4(b))";
      case "ceramic": return "monolithic ceramics only for bearings, fuel-pump elements, electrical parts, insulation, clutch friction (C15.4(a))";
      case "beryllium": return "beryllium and its alloys are not listed in C15.2 (copper < 2.5 % Be only)";
      default: return "material not identifiable as a C15.2 material";
    }
  }
  // violations of one part's material. part: concept part id; mat: the table record (or null when unknown)
  function materialViolations(part, ref) {
    const out = [], ex = { part, material: typeof ref === "object" && ref ? ref.id : ref };
    const mat = findMaterial(ref);
    if (!mat) { out.push(viol("REG-C-MAT-PERMITTED", String(ex.material), materialTable() ? "not in the materials table" : "no materials table loaded", ex)); return out; }
    const rho = num(mat.density_kg_m3), E = num(mat.E_GPa), c = classify(mat), s = c.text;
    if (rho == null || !(rho > 0) || E == null || !(E >= 0)) { out.push(viol("REG-C-MAT-PERMITTED", String(mat.id), "density_kg_m3 and E_GPa must be finite (cannot classify)", ex)); return out; }
    if (mat.commercially_available === false) out.push(viol("REG-C-MAT-PERMITTED", String(mat.id), "not commercially available (C15.1.3)", ex));
    const sm = E / (rho / 1000);
    if (c.metallic && !(sm <= 40 + 1e-9)) out.push(viol("REG-C-MAT-SPECIFIC-MODULUS", sm, 40, Object.assign({}, ex, { value: +sm.toFixed(1) })));
    if (own(EXEMPT_PARTS, part)) return out;
    if (PU_PARTS.includes(part)) {   // C15.6.1
      const why = c.family === "magnesium" ? "magnesium alloy (a)" : c.family === "mmc" && !(num(mat.mmc_vol_pct) != null && mat.mmc_vol_pct <= 2) ? "metal matrix composite (b)" : c.family === "intermetallic" ? "intermetallic (c)"
        : c.pgm > 5 ? "> 5 % Pt/Ru/Ir/Re (d)" : c.family === "copper" && c.be > 2.2 ? "copper alloy > 2.2 % Be (e)" : c.family !== "copper" && c.be > 0.25 ? "> 0.25 % Be (f)" : c.family === "tungsten" ? "tungsten-base alloy (g)"
        : ["ceramic", "cmc", "carbon_carbon"].includes(c.family) ? "ceramic / ceramic matrix composite (h)" : c.family === "aluminium" && c.li > 1 ? "aluminium alloy > 1 % Li (i)" : mat.nanomaterial === true ? "nanomaterial (j)"
        : rho > 18400 ? "density > 18,400 kg/m³ (l)" : c.family === "aluminium" && c.ag > 1 ? "aluminium alloy > 1 % Ag (m)" : c.family === "composite" && c152(c, mat) ? "polymer composite not in C15.2.3 (n)"
        : ["unknown", "metal_unknown", "shape_memory", "precious"].includes(c.family) ? "material not identifiable (C15.1.8: FIA-approved PU materials only)" : null;
      if (why) out.push(viol("REG-C-MAT-PU", String(mat.id), why, ex));
      return out;
    }
    // C15.3.1-C15.3.2 prohibitions (outside the PU)
    const proh = c.family === "shape_memory" ? "shape-memory material (C15.3.1(a))" : mat.additive === true && c.be > 0 ? "additive-manufactured material containing beryllium (C15.3.1(b))"
      : c.pgm > 5 ? "alloy with > 5 % Pt+Ru+Ir+Re+Au (C15.3.2(a))" : mat.foil_metallurgy === true ? "foil metallurgy (C15.3.2(b))" : c.family === "intermetallic" ? "intermetallic alloy (C15.3.2(c))" : null;
    if (proh) { out.push(viol("REG-C-MAT-PROHIBITED", String(mat.id), proh, ex)); return out; }
    const comp = msg => out.push(viol("REG-C-MAT-COMPONENT", String(mat.id), msg, ex));
    // component-specific articles (these replace the general list where they name the material)
    if (part === "wheels_front" || part === "wheels_rear") { if (!(c.family === "magnesium" && any(GRADES.rim, s))) comp("wheel rims must be AZ70 or AZ80 magnesium alloy (C10.7.1)"); return out; }
    if (part === "cooling") { if (c.family !== "aluminium" || mat.additive === true) comp("primary heat exchanger cores and header tanks: aluminium alloy, not additive manufactured (C7.4.1(a)-(b))"); return out; }
    if (part === "halo") { if (!(c.family === "titanium" && /ti-?6al-?4v|\bti-?64\b|grade ?5\b/i.test(s))) comp("the halo is the FIA-designated FIA 8869-2018 part (C12.4.2), titanium Ti6Al4V (secondary: widely reported)"); return out; }
    if (part === "plank") { if (!(rho >= 1300 - 1e-9 && rho <= 1450 + 1e-9)) comp("plank must be homogeneous with specific gravity 1.30-1.45 (C3.6.2(a))"); return out; }
    if (part === "skids") { if (!any(GRADES.skid, s)) comp("metallic skids: Ti6Al4V or 17-4PH only (C3.6.3(d))"); return out; }
    if (/uprights?$/.test(part)) { const ok = (c.family === "aluminium" && any(GRADES.upright_al, s) && mat.additive !== true) || (c.family === "titanium" && !c152(c, mat)) || (c.family === "mmc" && !c152(c, mat)) || (mat.additive === true && ["aluminium", "titanium"].includes(c.family) && !c152(c, mat)); if (!ok) comp("suspension uprights: wrought 2014/2618/7075/7022 aluminium, C15.2.1(e) titanium, C15.2.1(h) MMC or C15.2.2 AM Al/Ti (C15.3.3)"); return out; }
    if (/^(gear_pairs|gears|driveshafts)$/.test(part)) { if (c.family !== "iron") comp("gear ratio pairs and driveshafts must be steel (C9.6.4, C9.10)"); return out; }
    if (part === "survival_cell") {
      // C15.5.3: the homologated survival-cell laminates use CC-UHS skins, "woven carbon cloth, fibre Ftu > 6250MPa, epoxy prepreg"
      // (C15.5.1(f)): a carbon composite whose fibre strength is not shown to exceed 6250 MPa cannot be one (T800S: 5880 MPa)
      const fo = mat.fibre && typeof mat.fibre === "object" ? mat.fibre : {}, fr = FIBRES.find(x => x[0].test(s));
      const ft = num(mat.fibre_strength_MPa) != null ? mat.fibre_strength_MPa : num(fo.tensile_MPa) != null ? fo.tensile_MPa : fr ? fr[2] : null;
      if (!(c.family === "composite" && c.fibre === "carbon")) comp("survival cell homologated laminates are carbon-fibre composite skins (CC-UHS) on aluminium honeycomb (C15.5.3)");
      else if (!(ft != null && ft > CC_UHS_FTU_MPA)) comp("survival cell skins must be CC-UHS: carbon fibre Ftu > " + CC_UHS_FTU_MPA + " MPa (C15.5.1(f), C15.5.3); this fibre: " + (ft == null ? "not stated" : ft + " MPa"));
    }
    if (part === "front_wing" && c.family !== "composite") comp("the front wing assembly includes the endplate, which must be made to laminate PL-ANTISPLINTER (C3.19.1, C15.5.2(b))");
    if (/roll_?(hoop|structure)/.test(part) && (c.family === "mmc" || (mat.particulate === true))) comp("the Primary Roll Structure may not use particulate-reinforced materials (C15.3.4)");
    if (part === "driver_ballast" && !(rho > 7500)) out.push(viol("REG-C-MAT-DENSITY", rho, 7500, ex));
    // brake discs and pads: C15.4(b)-(c) friction materials; calipers aluminium (C11.2.2)
    if (/^brakes/.test(part) && (c.family === "carbon_carbon" || c.family === "cmc")) return out;
    const why = c152(c, mat);
    if (why) out.push(viol("REG-C-MAT-PERMITTED", String(mat.id), why, ex));
    return out;
  }
  // { part: material ref } from facts: f.materials, then a `material` field on any part's params (f.params or the wing/floor facts)
  function materialsOf(f) {
    const out = {}; let n = 0;
    const add = (part, ref) => { if (ref != null && ref !== "" && !own(out, part)) { out[part] = ref; n++; } };
    if (f.materials && typeof f.materials === "object") for (const k of Object.keys(f.materials)) add(k, f.materials[k]);
    // the mass sheet's material summary (concept/parts.js massSheet: every material-able part, its named or baseline material)
    const ms = f.mass && f.mass.materials && typeof f.mass.materials === "object" ? f.mass.materials : null;
    if (ms) for (const k of Object.keys(ms)) add(k, ms[k] && typeof ms[k] === "object" ? ms[k].material : ms[k]);
    const ps = f.params && typeof f.params === "object" ? f.params : { front_wing: f.front_wing, rear_wing: f.rear_wing, floor: f.floor };
    for (const k of Object.keys(ps)) { const p = ps[k]; if (p && typeof p === "object" && own(p, "material")) add(k, p.material); }
    return n ? out : null;
  }
  function checkMaterials(assign) { const out = []; for (const part of Object.keys(assign || {})) for (const v of materialViolations(part, assign[part])) out.push(v); return out; }

  // ---- PU energy figures handed to the lap sims (PhysicalCar.pu): the Section C limits the scorer relies on
  // checkPU(pu, { recharge_limit_mj }) -> violations (ids of the info rules REG-C-ERS-K, -ES-SOC, -ES-RECHARGE, -FUEL-FLOW)
  function checkPU(pu, opts) {
    const out = []; if (!pu) return out;
    // C5.2.10: the declared harvest capability is checked against the 8.5 MJ/lap maximum; a session's lower limit (e.g. 6.5 MJ in
    // Silverstone qualifying, conditions.recharge_limit_mj) binds what a LAP recharges, so it is checked against opts.harvested_mj
    // (the lap sim's energy.harvested_mj) when given, never against the declared capability (every PhysicalCar declares 8.5)
    const rec = opts && num(opts.recharge_limit_mj) != null ? Math.min(8.5, opts.recharge_limit_mj) : 8.5;
    if (!(pu.mguk_kw <= 350 + 1e-9)) out.push(viol("REG-C-ERS-K", pu.mguk_kw, 350));
    if (pu.es_soc_window_mj != null && !(pu.es_soc_window_mj <= 4 + 1e-9)) out.push(viol("REG-C-ES-SOC", pu.es_soc_window_mj, 4));
    if (!(pu.es_harvest_mj_per_lap <= 8.5 + 1e-9)) out.push(viol("REG-C-ES-RECHARGE", pu.es_harvest_mj_per_lap, 8.5));
    if (opts && opts.harvested_mj != null && !(opts.harvested_mj <= rec + 1e-6)) out.push(viol("REG-C-ES-RECHARGE", opts.harvested_mj, rec + " (session limit, lap recharge)"));
    // what a lap can deploy is bounded by the 4 MJ window plus that lap's recharge (C5.2.9, C5.2.10; no separate deploy cap)
    if (!(pu.es_deploy_mj_per_lap <= 4 + 8.5 + 1e-9)) out.push(viol("REG-C-ES-SOC", pu.es_deploy_mj_per_lap, "4 + 8.5 = 12.5 MJ/lap deployable"));
    // the ICE cannot deliver more shaft power than the fuel energy flow it may burn: 3000 MJ/h = 833.3 kW (C5.2.3)
    if (!(pu.ice_kw <= 3000 / 3.6 + 1e-9)) out.push(viol("REG-C-FUEL-FLOW", pu.ice_kw, +(3000 / 3.6).toFixed(1)));
    return out;
  }
  // checkPhysical(pc): a PhysicalCar (concept/physical.js) against the limits the lap sims rely on: its PU block (checkPU) and the
  // C10.10.1 suspension width through its track widths (wheel centre plane = Wheel Coordinate System origin + half the rim overall
  // width, C2.1.3(a), C10.7.2(a): front track ≤ 2 × (603 + 167) = 1540 mm, rear ≤ 2 × (525 + 210.15) = 1470.3 mm)
  // opts.pu_ref: the baseline team's PhysicalCar.pu; with it the PU lock applies (PKG-PU-FIXED): MGU-K power and the energy
  // figures equal, ICE power not above the reference (the cooling derate may only lower it)
  function checkPhysical(pc, opts) {
    const out = checkPU(pc && pc.pu, opts); if (!pc) return out;
    const ref = opts && opts.pu_ref, pu = pc.pu || {};
    if (ref) {
      for (const k of ["mguk_kw", "es_deploy_mj_per_lap", "es_harvest_mj_per_lap", "es_soc_window_mj"]) if (ref[k] !== undefined && !(Math.abs(pu[k] - ref[k]) <= 1e-9)) out.push(viol("PKG-PU-FIXED", "pu." + k + " " + pu[k], ref[k], { field: "pu." + k }));
      if (!(pu.ice_kw <= ref.ice_kw + 1e-9)) out.push(viol("PKG-PU-FIXED", "pu.ice_kw " + pu.ice_kw, "≤ " + ref.ice_kw, { field: "pu.ice_kw" }));
    }
    for (const [k, w] of [["track_front_m", SUSP_WIDTH.wheels_front], ["track_rear_m", SUSP_WIDTH.wheels_rear]]) {
      if (pc[k] === undefined) continue;
      const o = (pc[k] * 1000) / 2 - w.half_rim; if (over(o, w.max_y)) out.push(viol("REG-C-SUSP-WIDTH", o, w.max_y + " (" + k + " " + pc[k] + " m)", { field: k }));
    }
    return out;
  }
  // C5.2.8(i)-(ii): ERS-K propulsion power limit (kW) at a car speed (km/h), without / with Overtake
  function mgukLimitKw(v, overtake) {
    const p = overtake ? (v < 355 ? 7100 - 20 * v : 0) : v < 340 ? 1800 - 5 * v : v < 345 ? 6900 - 20 * v : 0;
    return Math.max(0, Math.min(350, p));
  }

  // facts: what the module computed about a design (design.facts(design) builds it: geometry, wing/floor params, mass sheet, aero).
  // Returns violations [{ id, article, value, limit, message }]; empty = legal.
  // Every comparison is written so that a non-finite input (NaN, undefined, a string) FAILS the rule it feeds: `!(x <= max)`
  // rather than `x > max` (FIA checklist pass: a NaN override used to pass every mass rule).
  const over = (x, max) => !(x <= max + 1e-9), under = (x, min) => !(x >= min - 1e-9);
  function checkFacts(f, opts) {
    const out = [], g = f.geometry, m = f.mass, fw = f.front_wing, rw = f.rear_wing, fl = f.floor, a = f.aero;
    const mm = minMass(opts && opts.session);
    if (over(g.half_width_mm, 950)) out.push(viol("REG-C-WIDTH", g.half_width_mm, 950));
    if (over(g.wheelbase_mm, 3400)) out.push(viol("REG-C-WB", g.wheelbase_mm, 3400));
    if (under(g.front_axle_offset_mm, 0) || over(g.front_axle_offset_mm, 150)) out.push(viol("REG-C-FRONT-AXLE", g.front_axle_offset_mm, "0-150"));
    if (under(g.cockpit_len_mm, 1830) || over(g.cockpit_len_mm, 2030)) out.push(viol("REG-C-COCKPIT", g.cockpit_len_mm, "1830-2030"));
    if (under(g.bulkhead_gap_mm, 360)) out.push(viol("REG-C-BULKHEAD", g.bulkhead_gap_mm, 360));
    if (fl && over(fl.width_mm, 2 * FLOOR_BODY_MAX_Y)) out.push(viol("REG-C-FLOOR-WIDTH", fl.width_mm, 2 * FLOOR_BODY_MAX_Y));
    if (over(fw.elements, 3)) out.push(viol("REG-C-FW-ELEMENTS", fw.elements, 3));
    if (over(fw.span_mm, 1350)) out.push(viol("REG-C-FW-SPAN", fw.span_mm, 1350));
    const fwLim = fwChordLimit(fw.span_mm);
    if (over(fw.chord_mm, fwLim)) out.push(viol("REG-C-FW-CHORD", fw.chord_mm, r1(fwLim)));
    if (!(fw.sm_delta_deg <= 0)) { const ext = fwStraightExtent(fw); if (over(ext, fwLim)) out.push(viol("REG-C-FW-SM-ENVELOPE", ext, r1(fwLim))); }
    if (over(rw.elements, 3)) out.push(viol("REG-C-RW-ELEMENTS", rw.elements, 3));
    if (over(rw.span_mm, 1150)) out.push(viol("REG-C-RW-SPAN", rw.span_mm, 1150));
    if (over(rw.chord_mm, 465)) out.push(viol("REG-C-RW-CHORD", rw.chord_mm, 465));
    if (over(rw.endplate_top_mm, 880)) out.push(viol("REG-C-RW-ENDPLATE", rw.endplate_top_mm, 880));
    if (!(fw.sm_delta_deg <= 0) && !(fw.elements >= 2)) out.push(viol("REG-C-FW-FLAP", fw.elements, "≥ 2 with straight mode"));
    if (!(rw.sm_delta_deg <= 0) && !(rw.elements >= 2)) out.push(viol("REG-C-RW-FLAP", rw.elements, "≥ 2 with straight mode"));
    if (over(f.plank_wear_mm, 2)) out.push(viol("REG-C-PLANK", f.plank_wear_mm, 2));
    if (under(m.total_kg, mm.kg)) out.push(viol("REG-C-MASS-MIN", m.total_kg, mm.kg));
    if (mm.axle_split) {
      if (under(m.front_kg, 0.44 * mm.kg)) out.push(viol("REG-C-MASS-FRONT", m.front_kg, r1(0.44 * mm.kg)));
      if (under(m.rear_kg, 0.54 * mm.kg)) out.push(viol("REG-C-MASS-REAR", m.rear_kg, r1(0.54 * mm.kg)));
    }
    if (!(m.driver_kg >= 82)) out.push(viol("REG-C-DRIVER-MASS", m.driver_kg, 82));
    if (!(m.pu_kg >= 185)) out.push(viol("REG-C-PU-MASS", m.pu_kg, 185));
    // C5.5.1 + C5.18.7: one transmission option, both floors from it (an unknown option fails both)
    // the ICE PU Mass group includes the TC and the Powerbox (App. C3 Drawing 9)
    const iceGroup = typeof m.ice_group_kg === "number" ? m.ice_group_kg : m.ice_kg + m.tc_kg;
    const opt = own(MGUK_TRANSMISSION, m.mguk_transmission) ? MGUK_TRANSMISSION[m.mguk_transmission] : null, tag = " (option " + m.mguk_transmission + ")";
    if (!opt) { out.push(viol("REG-C-ICE-MASS", iceGroup, "unknown MGU-K transmission option " + m.mguk_transmission)); out.push(viol("REG-C-MGUK-MASS", m.mguk_kg, "unknown MGU-K transmission option " + m.mguk_transmission)); }
    else {
      if (under(iceGroup, opt.ice_kg)) out.push(viol("REG-C-ICE-MASS", iceGroup, opt.ice_kg + tag));
      if (under(m.mguk_kg, opt.mguk_kg)) out.push(viol("REG-C-MGUK-MASS", m.mguk_kg, opt.mguk_kg + tag));
    }
    if (!(m.tc_kg >= 12)) out.push(viol("REG-C-TC-MASS", m.tc_kg, 12));
    if (!(m.es_kg >= 35)) out.push(viol("REG-C-ES-MASS", m.es_kg, 35));
    if (!(m.pu_cog_z_mm > 200)) out.push(viol("REG-C-PU-COG", m.pu_cog_z_mm, 200));
    if (!(m.driveline_kg >= 22)) out.push(viol("REG-C-DRIVELINE-MASS", m.driveline_kg, 22));
    if (under(g.wheelbase_mm, g.wheelbase_min_mm)) out.push(viol("PKG-WB", g.wheelbase_mm, r1(g.wheelbase_min_mm)));
    if (a && a.cooling && under(a.cooling.capacity, a.cooling.required)) out.push(viol("PKG-COOLING", a.cooling.capacity / a.cooling.need, BY_ID["PKG-COOLING"].value, { value: +(a.cooling.capacity / a.cooling.need).toFixed(3) }));
    if (a && a.stall_margin_mm !== undefined && under(a.stall_margin_mm, BY_ID["PKG-FLOOR-STALL"].value)) out.push(viol("PKG-FLOOR-STALL", a.stall_margin_mm, BY_ID["PKG-FLOOR-STALL"].value));
    // ---- FIA checklist pass: combinations, input sanity and the remaining geometric limits (COMBO_RULES)
    if (!(fw.sm_delta_deg >= 0) || !(rw.sm_delta_deg >= 0)) out.push(viol("REG-C-SM-DIRECTION", Math.min(fw.sm_delta_deg, rw.sm_delta_deg), "≥ 0 (Straight Mode lowers incidence)"));
    if (!(Number.isInteger(fw.elements) && fw.elements >= 1)) out.push(viol("REG-C-ELEMENTS-MIN", fw.elements, "front: integer ≥ 1", { wing: "front_wing" }));
    if (!(Number.isInteger(rw.elements) && rw.elements >= 2)) out.push(viol("REG-C-ELEMENTS-MIN", rw.elements, "rear: integer ≥ 2 (C3.11.7(b))", { wing: "rear_wing" }));
    const fwZ = fwProfilesChordLimit(fw);
    if (over(fw.chord_mm, fwZ)) out.push(viol("REG-C-FW-PROFILES-Z", fw.chord_mm, r1(fwZ)));
    if (under(g.XR - g.XPU, PLANK_HOLE.xpu_min + PLANK_HOLE.ahead_of_xr)) out.push(viol("REG-C-PLANK-HOLES", g.XR - g.XPU, PLANK_HOLE.xpu_min + PLANK_HOLE.ahead_of_xr));
    if (fl && over(fl.throat_mm, FLOOR_ROOF_Z)) out.push(viol("REG-C-FLOOR-ROOF", fl.throat_mm, FLOOR_ROOF_Z));
    const sp = (f.params && f.params.sidepods) || f.sidepods;
    if (sp && over(sp.inlet_cm2, SIDEPOD_INLET_MAX_CM2)) out.push(viol("REG-C-SIDEPOD-INLET", sp.inlet_cm2, SIDEPOD_INLET_MAX_CM2));
    for (const r of m.parts || []) {
      if (own(SUSP_WIDTH, r.id) && r.y_mm !== undefined) { const w = SUSP_WIDTH[r.id], o = Math.abs(r.y_mm) - w.half_rim; if (over(o, w.max_y)) out.push(viol("REG-C-SUSP-WIDTH", o, w.max_y + " (" + r.id + ")", { part: r.id })); }
      // a part outside the car's extent: XF −1300 (front wing from XF=−1250, App. C2 §22) to XR + 800 (rear wing endplate to
      // XR+750, §31.2), Z from the ground to 1000 (roll hoop to Z=970, App. C2 §33.5)
      const inX = r.x_mm >= -1300 && r.x_mm <= (g.XR || 0) + 800, inZ = r.z_mm >= (typeof m.ground_z_mm === "number" ? m.ground_z_mm : -100) - 1e-9 && r.z_mm <= 1000;
      if (!(r.mass_kg >= 0) || !inX || !inZ) out.push(viol("PKG-PART-MASS", r.mass_kg, "finite ≥ 0 kg inside the car (" + r.id + " at x " + r.x_mm + ", z " + r.z_mm + ")", { part: r.id }));
    }
    // the PU lock: any change to a PU part (mass, position) or to the transmission option is rejected (PKG-PU-FIXED)
    for (const id of Object.keys(PU_LOCK.rows)) {
      const ref = PU_LOCK.rows[id], r = (m.parts || []).find(x => x.id === id), x0 = g[ref.at] + ref.dx;
      if (!r) { out.push(viol("PKG-PU-FIXED", "missing", id, { part: id })); continue; }
      if (!(Math.abs(r.mass_kg - ref.kg) <= 0.006) || !(Math.abs(r.x_mm - x0) <= 0.51) || !(Math.abs(r.z_mm - ref.z) <= 0.51))
        out.push(viol("PKG-PU-FIXED", id + " " + r.mass_kg + " kg at x " + r.x_mm + ", z " + r.z_mm, ref.kg + " kg at " + ref.at + "+" + ref.dx + ", z " + ref.z, { part: id }));
    }
    if (m.mguk_transmission !== PU_LOCK.mguk_transmission) out.push(viol("PKG-PU-FIXED", "transmission option " + m.mguk_transmission, PU_LOCK.mguk_transmission, { part: "pu_mguk" }));
    const mats = materialsOf(f);
    if (mats) for (const v of checkMaterials(mats)) out.push(v);
    return out;
  }
  // check(design): violations of a Design (needs concept/design.js for the facts; lazy so the files can load in any order). The
  // design's own params and materials are attached when design.facts() does not carry them (sidepod inlet, materials).
  function check(design, opts) {
    const D = C.design || (typeof require === "function" ? require("./design.js") : null);
    const f = D.facts(design, opts);
    if (!f.params && design && design.params) f.params = design.params;
    if (!f.materials && design && design.materials) f.materials = design.materials;
    return checkFacts(f, opts);
  }

  // one-line human label for a violation id (like lab/aero.js describeViolation); unknown ids come back unchanged
  function describeViolation(id, value, limit) {
    const r = own(BY_ID, id) ? BY_ID[id] : null; if (!r) return String(id);
    const tail = value != null ? " (is " + (typeof value === "number" ? r1(value) : value) + (limit != null ? ", limit " + limit : "") + ")" : "";
    const tag = r.article.indexOf("concept") === 0 ? "concept model" : "FIA 2026 " + r.article;
    return r.text + tail + " [" + tag + "]";
  }

  const api = {
    SOURCE, DOC, NOMINAL_TYRE_MASS, QUALI_SESSIONS, SESSIONS, MGUK_TRANSMISSION, FLOOR_BODY_MAX_Y, RULES, MODEL_RULES, COMBO_RULES, MATERIAL_RULES, ALL_RULES, BY_ID,
    PLANK_HOLE, SIDEPOD_INLET_MAX_CM2, SUSP_WIDTH, FLOOR_ROOF_Z, CC_UHS_FTU_MPA, PU_PARTS, PU_LOCK, isQuali, minMass, fwEnvelopeX, fwChordLimit, fwStraightExtent, fwSectionZ, rwSectionZ,
    fwProfilesChordLimit, rwProfilesChordLimit, setMaterials, materialTable, findMaterial, classify, materialViolations, materialsOf, checkMaterials, checkPU, checkPhysical,
    mgukLimitKw, checkFacts, check, describeViolation,
  };
  C.regs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
