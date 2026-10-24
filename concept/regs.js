// PURPLE CONCEPT - machine-readable subset of the 2026 FIA Formula 1 Technical Regulations that constrains shape and mass.
// Source of every `verified: true` figure: FIA, "2026 Formula 1 Regulations - Section C [Technical]", Issue 19, published
// 25/06/2026 (WMSC approval 23/06/2026): the issue in force at the British GP (3-5 July 2026). Fetched from fia.com on 2026-10-24
// (PDF sha256 8751d3d4...b52ad0a) and read directly; article numbers below are that issue's. Every article cited here reads the
// same in Issue 17 (28/04/2026, the issue this file first cited) apart from wording this model does not use (C5.2.3 adds a
// 550 MJ/h per-cylinder cap; C5.2.10 adds "no Recharge limit behind the safety car in Low Grip conditions").
// Anything not read in that document is `verified: false` with its basis stated. Never claims more.
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
  const BY_ID = Object.create(null); for (const r of RULES.concat(MODEL_RULES)) BY_ID[r.id] = Object.assign({ source: SOURCE }, r);

  // Minimum Mass for a session ("qualifying" default: the lap model is a pole-lap model). Returns kg and how it was built.
  function minMass(session) {
    const r = BY_ID["REG-C-MASS-MIN"], q = isQuali(session), base = q ? r.value : r.race_value;
    return { kg: base + NOMINAL_TYRE_MASS.value, base_kg: base, ntm_kg: NOMINAL_TYRE_MASS.value, axle_split: q, session: q ? (session && QUALI_SESSIONS.includes(session) ? session : "qualifying") : session, verified: false, note: "base verified (" + r.article + "); Nominal Tyre Mass estimated" };
  }

  const r1 = v => Math.round(v * 10) / 10;
  function viol(id, value, limit, extra) { const r = BY_ID[id]; return Object.assign({ id, article: r.article, value: typeof value === "number" ? r1(value) : value, limit, message: describeViolation(id, value, limit) }, extra || {}); }

  // facts: what the module computed about a design (design.facts(design) builds it: geometry, wing/floor params, mass sheet, aero).
  // Returns violations [{ id, article, value, limit, message }]; empty = legal.
  function checkFacts(f, opts) {
    const out = [], g = f.geometry, m = f.mass, fw = f.front_wing, rw = f.rear_wing, fl = f.floor, a = f.aero;
    const mm = minMass(opts && opts.session);
    if (g.half_width_mm > 950) out.push(viol("REG-C-WIDTH", g.half_width_mm, 950));
    if (g.wheelbase_mm > 3400) out.push(viol("REG-C-WB", g.wheelbase_mm, 3400));
    if (g.front_axle_offset_mm < 0 || g.front_axle_offset_mm > 150) out.push(viol("REG-C-FRONT-AXLE", g.front_axle_offset_mm, "0-150"));
    if (g.cockpit_len_mm < 1830 || g.cockpit_len_mm > 2030) out.push(viol("REG-C-COCKPIT", g.cockpit_len_mm, "1830-2030"));
    if (g.bulkhead_gap_mm < 360) out.push(viol("REG-C-BULKHEAD", g.bulkhead_gap_mm, 360));
    if (fl && fl.width_mm > 2 * FLOOR_BODY_MAX_Y) out.push(viol("REG-C-FLOOR-WIDTH", fl.width_mm, 2 * FLOOR_BODY_MAX_Y));
    if (fw.elements > 3) out.push(viol("REG-C-FW-ELEMENTS", fw.elements, 3));
    if (fw.span_mm > 1350) out.push(viol("REG-C-FW-SPAN", fw.span_mm, 1350));
    const fwLim = fwChordLimit(fw.span_mm);
    if (fw.chord_mm > fwLim + 1e-9) out.push(viol("REG-C-FW-CHORD", fw.chord_mm, r1(fwLim)));
    if (fw.sm_delta_deg > 0) { const ext = fwStraightExtent(fw); if (ext > fwLim + 1e-9) out.push(viol("REG-C-FW-SM-ENVELOPE", ext, r1(fwLim))); }
    if (rw.elements > 3) out.push(viol("REG-C-RW-ELEMENTS", rw.elements, 3));
    if (rw.span_mm > 1150) out.push(viol("REG-C-RW-SPAN", rw.span_mm, 1150));
    if (rw.chord_mm > 465) out.push(viol("REG-C-RW-CHORD", rw.chord_mm, 465));
    if (rw.endplate_top_mm > 880) out.push(viol("REG-C-RW-ENDPLATE", rw.endplate_top_mm, 880));
    if (fw.sm_delta_deg > 0 && fw.elements < 2) out.push(viol("REG-C-FW-FLAP", fw.elements, "≥ 2 with straight mode"));
    if (rw.sm_delta_deg > 0 && rw.elements < 2) out.push(viol("REG-C-RW-FLAP", rw.elements, "≥ 2 with straight mode"));
    if (f.plank_wear_mm > 2) out.push(viol("REG-C-PLANK", f.plank_wear_mm, 2));
    if (m.total_kg < mm.kg - 1e-9) out.push(viol("REG-C-MASS-MIN", m.total_kg, mm.kg));
    if (mm.axle_split) {
      if (m.front_kg < 0.44 * mm.kg - 1e-9) out.push(viol("REG-C-MASS-FRONT", m.front_kg, r1(0.44 * mm.kg)));
      if (m.rear_kg < 0.54 * mm.kg - 1e-9) out.push(viol("REG-C-MASS-REAR", m.rear_kg, r1(0.54 * mm.kg)));
    }
    if (m.driver_kg < 82) out.push(viol("REG-C-DRIVER-MASS", m.driver_kg, 82));
    if (m.pu_kg < 185) out.push(viol("REG-C-PU-MASS", m.pu_kg, 185));
    // C5.5.1 + C5.18.7: one transmission option, both floors from it (an unknown option fails both)
    // the ICE PU Mass group includes the TC and the Powerbox (App. C3 Drawing 9)
    const iceGroup = typeof m.ice_group_kg === "number" ? m.ice_group_kg : m.ice_kg + m.tc_kg;
    const opt = own(MGUK_TRANSMISSION, m.mguk_transmission) ? MGUK_TRANSMISSION[m.mguk_transmission] : null, tag = " (option " + m.mguk_transmission + ")";
    if (!opt) { out.push(viol("REG-C-ICE-MASS", iceGroup, "unknown MGU-K transmission option " + m.mguk_transmission)); out.push(viol("REG-C-MGUK-MASS", m.mguk_kg, "unknown MGU-K transmission option " + m.mguk_transmission)); }
    else {
      if (iceGroup < opt.ice_kg - 1e-9) out.push(viol("REG-C-ICE-MASS", iceGroup, opt.ice_kg + tag));
      if (m.mguk_kg < opt.mguk_kg - 1e-9) out.push(viol("REG-C-MGUK-MASS", m.mguk_kg, opt.mguk_kg + tag));
    }
    if (m.tc_kg < 12) out.push(viol("REG-C-TC-MASS", m.tc_kg, 12));
    if (m.es_kg < 35) out.push(viol("REG-C-ES-MASS", m.es_kg, 35));
    if (m.pu_cog_z_mm <= 200) out.push(viol("REG-C-PU-COG", m.pu_cog_z_mm, 200));
    if (m.driveline_kg < 22) out.push(viol("REG-C-DRIVELINE-MASS", m.driveline_kg, 22));
    if (g.wheelbase_mm < g.wheelbase_min_mm - 1e-9) out.push(viol("PKG-WB", g.wheelbase_mm, r1(g.wheelbase_min_mm)));
    if (a && a.cooling && a.cooling.capacity < a.cooling.required - 1e-9) out.push(viol("PKG-COOLING", a.cooling.capacity / a.cooling.need, BY_ID["PKG-COOLING"].value, { value: +(a.cooling.capacity / a.cooling.need).toFixed(3) }));
    if (a && typeof a.stall_margin_mm === "number" && a.stall_margin_mm < BY_ID["PKG-FLOOR-STALL"].value - 1e-9) out.push(viol("PKG-FLOOR-STALL", a.stall_margin_mm, BY_ID["PKG-FLOOR-STALL"].value));
    return out;
  }
  // check(design): violations of a Design (needs concept/design.js for the facts; lazy so the files can load in any order)
  function check(design, opts) {
    const D = C.design || (typeof require === "function" ? require("./design.js") : null);
    return checkFacts(D.facts(design, opts), opts);
  }

  // one-line human label for a violation id (like lab/aero.js describeViolation); unknown ids come back unchanged
  function describeViolation(id, value, limit) {
    const r = own(BY_ID, id) ? BY_ID[id] : null; if (!r) return String(id);
    const tail = value != null ? " (is " + (typeof value === "number" ? r1(value) : value) + (limit != null ? ", limit " + limit : "") + ")" : "";
    const tag = r.article.indexOf("concept") === 0 ? "concept model" : "FIA 2026 " + r.article;
    return r.text + tail + " [" + tag + "]";
  }

  const api = { SOURCE, DOC, NOMINAL_TYRE_MASS, QUALI_SESSIONS, SESSIONS, MGUK_TRANSMISSION, FLOOR_BODY_MAX_Y, RULES, MODEL_RULES, BY_ID, isQuali, minMass, fwEnvelopeX, fwChordLimit, fwStraightExtent, checkFacts, check, describeViolation };
  C.regs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
