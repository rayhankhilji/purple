// PURPLE CONCEPT - the part catalogue of a 2026-style F1 car: shape parameters (with the model's domain bounds), a mass per part
// with its kind, sources and basis, and a position (x rearward from the front axle plane XF=0, z up from the reference plane Z=0,
// |y| from the centre plane; mm, FIA Car Coordinate System, C2.1.1).
// ONE vertical frame: Z=0 is the upper surface of the Plank Assembly (C3.6.1(a)), which sits plank thickness (10 mm, C3.6.1(d)) +
// static ride height above the ground. Sprung parts have a fixed Z; unsprung parts (wheels, brakes) sit at the loaded tyre radius
// above the GROUND, i.e. at Z = loaded radius − 10 − ride height (≈ 300 at the baseline), so raising the ride height lifts the
// sprung mass only. massSheet reports cog_z_mm (Z frame) and cog_height_mm (above the ground). Suspension members are carried in
// the sprung frame (an approximation: uprights are unsprung).
// Masses: "concept part masses v1" (concept/data/parts-mass-2026.json, docs/concept/MASS.md, researched 2026-10-24). Each part has
// a `kind` (regulation | official | reported | engineering estimate) and `sources` (source ids of that JSON). Teams do not publish
// per-part masses: regulation floors are used where they exist, the rest are reported figures or engineering estimates reconciled
// to reported 2026 car weights (parts sum 767.9 kg against the 770 kg qualifying minimum). Never quote these as measured.
// Domain bounds are what the parametric model can represent; they are deliberately WIDER than the regulations, so legality is a
// separate, visible check (concept/regs.js) and the optimiser has real limits to discover.
// Dual browser / Node: window.EI.concept.parts and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const regs = C.regs || (typeof require === "function" ? require("./regs.js") : null);
  const MASS_LABEL = "concept part masses v1 · researched · regulation floors where they exist, otherwise reported or engineering estimates reconciled to reported 2026 car weights · not measured";
  const MASS_SOURCE = "concept/data/parts-mass-2026.json, docs/concept/MASS.md (concept part masses v1, 2026-10-24)";

  // packaging lengths (mm), estimates: ICE block from its mounting face; gearbox from the bell housing to the final-drive axis,
  // which C9.5.1 puts within ±60 mm of the rear axle plane XR=0
  const PACK = { ice_len_mm: 620, gearbox_len_mm: 520, spacer_kg_per_mm: 0.012 };
  // the plank-wear estimate (concept model, used by REG-C-PLANK): wear grows 0.25 mm per mm of static ride height below 32 mm
  const PLANK = { free_mm: 32, wear_per_mm: 0.25, thickness_mm: 10 };
  // unsprung parts: tyre radius 353 mm (≈ 705 mm OD; PhysicalCar tyres.radius_m), 8 mm static deflection (estimate) -> wheel
  // centres 345 mm above the ground, Z ≈ 300 at the baseline (10 mm plank + 35 mm ride height below Z=0)
  const WHEEL = { tyre_radius_mm: 353, deflection_mm: 8 };
  // C5.5.1 / C5.18.7 MGU-K Mechanical Transmission option of the concept PU: fixed at "a" (all of the speed ratio in RV-PU-ERS:
  // ICE group ≥ 130 kg, MGU-K ≥ 20 kg; MASS.md §6). Every option's pair sums to 150 kg, so the choice only moves mass between the
  // two groups; it is a fixed design decision, not an optimiser parameter. The ICE "PU Mass group" is ICE + TC + Powerbox
  // (App. C3 Drawing 9): pu_ice (118.5 kg, ICE + Powerbox) + pu_turbo (12 kg) = 130.5 kg.
  const PU = { mguk_transmission: "a" };

  // shape parameters: min/max = model domain, base = baseline car, step = mutation quantum, int = integer count
  const P = (min, max, base, step, unit, label, extra) => Object.assign({ min, max, base, step, unit, label }, extra || {});
  const EST = "engineering estimate", REGK = "regulation", REP = "reported";
  const CATALOGUE = [
    // ---- layout and chassis
    { id: "layout", name: "Overall layout", group: "chassis", params: { wheelbase_mm: P(3000, 3700, 3400, 5, "mm", "Wheelbase") }, kind: null, sources: [], basis: "no mass of its own; sets XR" },
    { id: "survival_cell", name: "Survival cell (monocoque, side impact structures, anti-intrusion panels, fuel-cell bay)", group: "chassis",
      params: { front_axle_offset_mm: P(0, 250, 75, 5, "mm", "Front axle behind cell front (XA→XF)"), cockpit_len_mm: P(1750, 2100, 1930, 5, "mm", "Cell front to cockpit rear (XA→XC)"), bulkhead_gap_mm: P(300, 600, 380, 5, "mm", "Cockpit rear to ICE face (XC→XPU)") },
      kind: EST, sources: ["F1DICT-TUB"], basis: "71.7 kg at a 2310 mm tub (MASS.md: bottom-up 50 kg reconciled to reported car weights); 60 % fixed, 40 % ∝ tub length" },
    { id: "nose", name: "Nose and front impact structure", group: "chassis", params: {}, kind: EST, sources: [], basis: "7.2 kg (MASS.md)" },
    { id: "halo", name: "Halo", group: "chassis", params: {}, kind: REP, sources: ["AUTOSPORT-HALO", "GPFANS-WEIGHT", "MOTORSPORT-ES-WEIGHT"], basis: "9.9 kg: reported 7 kg titanium halo plus mounts and fairing (MASS.md)" },
    { id: "rear_impact", name: "Rear impact structure and crash structures", group: "chassis", params: {}, kind: EST, sources: [], basis: "5.7 kg (MASS.md)" },
    // ---- aero (no beam wing: Section C3.11 has none in 2026)
    { id: "front_wing", name: "Front wing assembly (profiles, endplates, flap actuator)", group: "aero",
      params: { span_mm: P(1000, 1500, 1300, 10, "mm", "Span"), chord_mm: P(400, 900, 580, 5, "mm", "Mean chord (planform / span, X extent)"), aoa_deg: P(10, 40, 25, 0.5, "°", "Wing setting (lab front_wing_deg units)"), elements: P(1, 4, 3, 1, "", "Profile volumes", { int: true }), sm_delta_deg: P(0, 20, 0, 0.5, "°", "Straight-mode flap incidence reduction") },
      kind: REP, sources: ["GPFANS-WEIGHT", "MOTORSPORT-ES-WEIGHT"], basis: "10.0 kg without actuator (reported ≈ 10 kg): 8.0 kg of profiles at the baseline 0.754 m² planform (1300 × 580 mm) and 3 volumes (∝ planform, +12 % per extra volume) + 2.0 kg endplates; + 0.8 kg actuator if straight mode is used" },
    { id: "rear_wing", name: "Rear wing assembly (profiles, endplates, brace, pylon, flap actuator)", group: "aero",
      params: { span_mm: P(900, 1300, 1100, 10, "mm", "Span"), chord_mm: P(300, 600, 420, 5, "mm", "Chord (X extent)"), aoa_deg: P(5, 35, 20, 0.5, "°", "Wing setting (lab rear_wing_deg units)"), elements: P(1, 4, 2, 1, "", "Profile volumes", { int: true }), endplate_top_mm: P(760, 960, 860, 5, "mm", "Endplate top (Z)"), sm_delta_deg: P(0, 30, 0, 0.5, "°", "Straight-mode flap incidence reduction") },
      kind: EST, sources: [], basis: "11.5 kg without actuator (MASS.md): 7.6 kg of profiles at 0.462 m² and 2 volumes (∝ planform, +15 % per extra volume) + 2.9 kg endplates ∝ height + 1.0 kg pylon and brace; + 1.0 kg actuator if straight mode is used" },
    { id: "floor", name: "Floor (body, foot, edge, boards, fences, plank and skids)", group: "aero",
      params: { width_mm: P(1200, 1700, 1450, 10, "mm", "Floor body width (2 × max |Y|)"), throat_mm: P(80, 130, 100, 1, "mm", "Venturi throat height above Z=0"), ride_height_mm: P(20, 70, 35, 0.5, "mm", "Static ride height at the plank") },
      kind: EST, sources: ["FIA-C-ISS20"], basis: "31.4 kg (MASS.md): 24.4 kg of floor at the baseline planform (3100 × 1450 mm), ∝ planform (length WB−300 mm × floor body width) + 7 kg plank assembly ∝ length (regulation geometry, C3.6; specific gravity 1.30-1.45)" },
    { id: "diffuser", name: "Diffuser", group: "aero", params: { expansion_deg: P(8, 22, 14, 0.5, "°", "Diffuser expansion angle") }, kind: EST, sources: [], basis: "5.0 kg (MASS.md), +2 % per degree of expansion" },
    { id: "sidepods", name: "Sidepods (bodywork, inlets, undercut)", group: "aero",
      params: { inlet_cm2: P(300, 1100, 650, 10, "cm²", "Cooling inlet area (both sides)"), undercut_mm: P(0, 220, 100, 5, "mm", "Undercut depth") },
      kind: EST, sources: [], basis: "8.6 kg (MASS.md); 30 % scales with inlet area" },
    { id: "engine_cover", name: "Engine cover, airbox and roll-hoop fairing", group: "aero", params: {}, kind: EST, sources: [], basis: "8.6 kg (MASS.md)" },
    // ---- power unit (C5 mass floors are checked by concept/regs.js; groups per App. C3 Drawing 9 and App. C4)
    { id: "pu_ice", name: "PU · ICE (1.6 L V6) incl. Powerbox, less TC", group: "power_unit", params: {}, kind: REGK, sources: ["FIA-C-ISS20"], basis: "118.5 kg: with the 12 kg TC the ICE PU Mass group (ICE + TC + Powerbox, App. C3 Drawing 9) is 130.5 kg, at the C5.5.1(a) floor of 130 kg for transmission option a; CoG ≈ 140 mm above the Z=90 crank axis (C5.4.5; estimate)", power_kw: 400, power_basis: "≈ 400 kW: widely reported 2026 ICE output (FIA/F1 2024 announcements); not in Section C; estimate" },
    { id: "pu_turbo", name: "PU · turbocharger", group: "power_unit", params: {}, kind: REGK, sources: ["FIA-C-ISS20"], basis: "12 kg: the C5.3.4 floor; part of the ICE PU Mass group (Drawing 9)" },
    { id: "pu_mguk", name: "PU · MGU-K", group: "power_unit", params: {}, kind: REGK, sources: ["FIA-C-ISS20"], basis: "20 kg: the C5.18.7(a) floor, paired with the ICE group's C5.5.1(a) floor (transmission option a)", power_kw: 350, power_basis: "350 kW: C5.2.7 ERS-K DC power limit (verified)" },
    { id: "pu_es", name: "PU · energy store (incl. CU-K and DC-DC)", group: "power_unit", params: {}, kind: REGK, sources: ["FIA-C-ISS20", "MCLAREN-SPEC", "RACETECH-SPECS"], basis: "35 kg: the C5.17.9 ES Main Enclosure floor; App. C4 items 39 (CU-K) and 40 (DC-DC) are inside it" },
    { id: "pu_electronics", name: "PU items outside the mass groups (tailpipe, intake upstream of the compressor, breather, studs)", group: "power_unit", params: {}, kind: EST, sources: ["FIA-C-ISS20"], basis: "5.7 kg (MASS.md; App. C4 items 72-76)" },
    // ---- transmission, suspension, wheels
    { id: "gearbox", name: "Gearbox, differential, driveshafts, oil", group: "transmission", params: {}, kind: REP, sources: ["GPFANS-WEIGHT", "MOTORSPORT-ES-WEIGHT"], basis: "48.6 kg (MASS.md: gearbox ≈ 40 kg reported, plus driveshafts and oil; C9.5.2 floor for driveline + gear change is 22 kg) + 0.012 kg/mm of spacer when the wheelbase exceeds the packaging minimum" },
    { id: "front_suspension", name: "Front suspension and steering (incl. steering wheel)", group: "suspension", params: {}, kind: EST, sources: ["GPFANS-WEIGHT", "MOTORSPORT-ES-WEIGHT"], basis: "30.7 kg (MASS.md: uprights, wishbones, push/pull rods, rockers, dampers, rack, 1.3 kg steering wheel)" },
    { id: "rear_suspension", name: "Rear suspension", group: "suspension", params: {}, kind: EST, sources: [], basis: "27.2 kg (MASS.md)" },
    { id: "wheels_front", name: "Front wheels and tyres (×2)", group: "wheels", params: {}, kind: EST, sources: ["FIA-C-ISS20", "MCLAREN-SPEC", "MERCEDES-TYRES", "PIRELLI-2026", "RACEFANS-HORNER"], basis: "2 × 10.0 kg magnesium rim (C10.7 dimensions) + 45.5 % of the Nominal Tyre Mass estimate (split by tyre cross-section); unsprung: centre at the loaded radius above the ground" },
    { id: "wheels_rear", name: "Rear wheels and tyres (×2)", group: "wheels", params: {}, kind: EST, sources: ["FIA-C-ISS20", "MERCEDES-TYRES", "PIRELLI-2026", "RACEFANS-HORNER"], basis: "2 × 11.4 kg magnesium rim (C10.7 dimensions) + 54.5 % of the Nominal Tyre Mass estimate; unsprung: centre at the loaded radius above the ground" },
    { id: "brakes_front", name: "Front brakes (×2)", group: "wheels", params: {}, kind: REP, sources: ["THERACE-BRAKES", "THEDRIVE-BREMBO", "GASGOO-BREMBO"], basis: "11.9 kg (MASS.md: reported 2026 disc 2.0 kg, caliper ≈ 2.0 kg, ≈ 4.5 kg per corner, plus ducts)" },
    { id: "brakes_rear", name: "Rear brakes (×2)", group: "wheels", params: {}, kind: EST, sources: ["FIA-C-ISS20"], basis: "11.5 kg (MASS.md; C11.3.3 disc sizes)" },
    // ---- systems
    { id: "cooling", name: "Cooling (radiators, intercooler, ERS cooling, fluids)", group: "systems", params: {}, kind: EST, sources: [], basis: "40.2 kg at 650 cm² of inlet (MASS.md), ∝ inlet^0.8 (heat-exchanger capacity follows inlet area)" },
    { id: "fuel_system", name: "Fuel system (cell, pumps, lines; empty)", group: "systems", params: {}, kind: EST, sources: ["FIA-C-ISS20"], basis: "10 kg (MASS.md; FT5-1999 bladder, C6.1.1); all fuel ahead of XPU=0 (C6.1.2); fuel itself is outside Car Mass" },
    { id: "hydraulics", name: "Hydraulics", group: "systems", params: {}, kind: EST, sources: [], basis: "10 kg (MASS.md)" },
    { id: "electronics", name: "Electronics (SECU, loom, sensors, FIA cameras, ADR, radio, 12 V)", group: "systems", params: {}, kind: EST, sources: ["LOOM-LENGTH", "FIA-C-ISS20"], basis: "25.8 kg (MASS.md)" },
    { id: "misc", name: "Paint, fasteners, brackets, sealant, mirrors, lights", group: "systems", params: {}, kind: EST, sources: ["RN365-PAINT"], basis: "12.2 kg (MASS.md; full livery paint ≈ 6 kg reported)" },
    // ---- driver
    { id: "driver", name: "Driver (reference mass incl. seat and kit)", group: "driver", params: {}, kind: EST, sources: ["FIA-C-ISS20", "F1-KIT-2014"], basis: "75 kg: the Section C 'Mass of the Driver' includes the seat and driving equipment, excludes the harness (driver ≈ 68 + kit 4-5 + seat ≈ 2.5; MASS.md)" },
    { id: "driver_ballast", name: "Driver ballast", group: "driver", params: {}, kind: REGK, sources: ["FIA-C-ISS20"], basis: "tops driver + ballast up to the C4.5.2 floor of 82 kg (7 kg); in the cockpit-entry-template X range, fixed to the survival cell, density > 7500 kg/m³ (C4.3.2)" },
    { id: "seat_safety", name: "Harness, headrest, pedals, extinguisher, drink system", group: "driver", params: {}, kind: EST, sources: ["FIA-C-ISS20"], basis: "10 kg (MASS.md; C14.1 FIA 8876-2022 harness); the seat is in the driver's reference mass" },
    // ---- ballast (free)
    { id: "ballast", name: "Ballast", group: "ballast", params: { x_frac: P(0, 1, 0.05, 0.01, "× WB", "Ballast position along the wheelbase"), extra_kg: P(0, 25, 0, 0.5, "kg", "Ballast above what the minimum needs") },
      kind: REGK, sources: ["FIA-C-ISS20"], basis: "automatic: whatever brings the car to the Minimum Mass (C4.1), plus extra_kg; low in the floor (C4.3.1)" },
  ];
  const BY_ID = Object.create(null); for (const p of CATALOGUE) BY_ID[p.id] = p;
  // every optimisable parameter, flattened: [{ part, param, ...spec }]
  const PARAMS = []; for (const p of CATALOGUE) for (const k of Object.keys(p.params)) PARAMS.push(Object.assign({ part: p.id, param: k }, p.params[k]));

  // geometry anchors (mm, X from the front axle XF=0) from a design's params (C2.2 planes)
  function geometry(params) {
    const sc = params.survival_cell, wb = params.layout.wheelbase_mm;
    const XA = -sc.front_axle_offset_mm, XC = XA + sc.cockpit_len_mm, XPU = XC + sc.bulkhead_gap_mm;
    const wbMin = XPU + PACK.ice_len_mm + PACK.gearbox_len_mm;
    const fw = params.front_wing, rw = params.rear_wing, fl = params.floor;
    return {
      XA, XC, XPU, XR: wb, wheelbase_mm: wb, wheelbase_min_mm: wbMin, spacer_mm: Math.max(0, wb - wbMin),
      front_axle_offset_mm: sc.front_axle_offset_mm, cockpit_len_mm: sc.cockpit_len_mm, bulkhead_gap_mm: sc.bulkhead_gap_mm,
      half_width_mm: Math.max(fl.width_mm, fw.span_mm, rw.span_mm) / 2,
      floor_len_mm: wb - 300, tub_len_mm: XPU - XA,
    };
  }
  const plankWear = rh => Math.max(0, PLANK.free_mm - rh) * PLANK.wear_per_mm;

  // the mass sheet: every part's mass (kg), x/z/|y| (mm), and the totals the regulations and the lap model need
  function massSheet(params, opts) {
    const g = geometry(params), ntm = regs.NOMINAL_TYRE_MASS.value, ov = (opts && opts.overrides) || {};
    const fw = params.front_wing, rw = params.rear_wing, fl = params.floor, sp = params.sidepods;
    const fwS = (fw.span_mm * fw.chord_mm) / (1300 * 580), rwS = (rw.span_mm * rw.chord_mm) / (1100 * 420);
    const floorArea = (g.floor_len_mm * fl.width_mm) / (3100 * 1450), floorLen = g.floor_len_mm / 3100;
    const ground = PLANK.thickness_mm + fl.ride_height_mm, zWheel = WHEEL.tyre_radius_mm - WHEEL.deflection_mm - ground;   // unsprung centres in the Z frame
    const rows = [
      ["survival_cell", 71.7 * (0.6 + 0.4 * g.tub_len_mm / 2310), g.XA + 0.5 * g.tub_len_mm, 330, 0],
      ["nose", 7.2, g.XA - 500, 300, 0],
      ["halo", 9.9, g.XC - 500, 720, 0],
      ["rear_impact", 5.7, g.XR + 450, 250, 0],
      ["front_wing", 8.0 * fwS * (1 + 0.12 * (fw.elements - 3)) + 2.0 + (fw.sm_delta_deg > 0 ? 0.8 : 0), -860, 160, 0],
      ["rear_wing", 7.6 * rwS * (1 + 0.15 * (rw.elements - 2)) + 2.9 * (rw.endplate_top_mm / 860) + 1.0 + (rw.sm_delta_deg > 0 ? 1.0 : 0), g.XR + 400, rw.endplate_top_mm - 80, 0],
      ["floor", 24.4 * floorArea + 7 * floorLen, 0.5 * g.XR + 200, 40, 0],
      ["diffuser", 5 * (1 + 0.02 * (params.diffuser.expansion_deg - 14)), g.XR - 150, 120, 0],
      ["sidepods", 8.6 * (0.7 + 0.3 * sp.inlet_cm2 / 650) * (1 - 0.001 * (sp.undercut_mm - 100)), g.XC + 250, 380, 550],
      ["engine_cover", 8.6, g.XPU + 350, 650, 0],
      ["pu_ice", 118.5, g.XPU + 310, 230, 0],
      ["pu_turbo", 12, g.XPU + 600, 430, 0],
      ["pu_mguk", 20, g.XPU + 150, 180, 120],
      ["pu_es", 35, g.XC + 120, 150, 0],
      ["pu_electronics", 5.7, g.XC + 250, 250, 150],
      // gearbox body anchored to the rear axle (final drive at XR, C9.5.1); the spacer sits between the ICE and the bell housing
      (() => { const ms = PACK.spacer_kg_per_mm * g.spacer_mm, xs = g.XPU + PACK.ice_len_mm + 0.5 * g.spacer_mm; return ["gearbox", 48.6 + ms, (48.6 * (g.XR - 230) + ms * xs) / (48.6 + ms), 270, 0]; })(),
      ["front_suspension", 30.7, 0, 280, 500],
      ["rear_suspension", 27.2, g.XR, 300, 500],
      ["wheels_front", 2 * 10.0 + 0.455 * ntm, 0, zWheel, 790],
      ["wheels_rear", 2 * 11.4 + 0.545 * ntm, g.XR, zWheel, 760],
      ["brakes_front", 11.9, 0, zWheel, 700],
      ["brakes_rear", 11.5, g.XR, zWheel, 700],
      ["cooling", 40.2 * Math.pow(sp.inlet_cm2 / 650, 0.8), g.XC + 250, 300, 500],
      ["fuel_system", 10, g.XC + 190, 350, 0],
      ["hydraulics", 10, g.XC + 100, 300, 0],
      ["electronics", 25.8, g.XC - 800, 280, 0],
      ["misc", 12.2, 0.40 * g.XR, 300, 0],
      ["driver", 75, g.XC - 750, 280, 0],
      ["seat_safety", 10, g.XC - 600, 320, 0],
    ].map(([id, kg, x, z, y]) => {
      const o = ov[id] || {};
      return { id, group: BY_ID[id].group, kind: BY_ID[id].kind, mass_kg: o.mass_kg != null ? o.mass_kg : kg, x_mm: o.x_mm != null ? o.x_mm : x, z_mm: o.z_mm != null ? o.z_mm : z, y_mm: y };
    });
    const driver = rows.find(r => r.id === "driver");
    rows.push({ id: "driver_ballast", group: "driver", mass_kg: Math.max(0, 82 - driver.mass_kg), x_mm: g.XC - 750, z_mm: 60, y_mm: 0 });
    const partsKg = rows.reduce((s, r) => s + r.mass_kg, 0);
    const min = regs.minMass(opts && opts.session);
    const ballastKg = Math.max(0, min.kg - partsKg) + params.ballast.extra_kg;
    rows.push({ id: "ballast", group: "ballast", mass_kg: ballastKg, x_mm: params.ballast.x_frac * g.XR, z_mm: 30, y_mm: 0 });
    const M = rows.reduce((s, r) => s + r.mass_kg, 0);
    const xcg = rows.reduce((s, r) => s + r.mass_kg * r.x_mm, 0) / M, zcg = rows.reduce((s, r) => s + r.mass_kg * r.z_mm, 0) / M;
    const izz = rows.reduce((s, r) => s + r.mass_kg * (Math.pow((r.x_mm - xcg) / 1000, 2) + Math.pow(r.y_mm / 1000, 2)), 0);
    const rear = M * xcg / g.XR, front = M - rear;
    const kg = id => rows.filter(r => r.id === id).reduce((s, r) => s + r.mass_kg, 0);
    const pu = ["pu_ice", "pu_turbo"].map(id => rows.find(r => r.id === id));
    const r2 = v => Math.round(v * 100) / 100;
    return {
      parts: rows.map(r => ({ id: r.id, group: r.group, kind: BY_ID[r.id].kind, sources: BY_ID[r.id].sources.slice(), mass_kg: r2(r.mass_kg), x_mm: Math.round(r.x_mm), z_mm: Math.round(r.z_mm) })),
      parts_kg: r2(partsKg), ballast_kg: r2(ballastKg), total_kg: r2(M), min_kg: min.kg, session: min.session,
      front_kg: r2(front), rear_kg: r2(rear), front_share: Math.round((front / M) * 10000) / 10000,
      cog_x_mm: Math.round(xcg), cog_z_mm: Math.round(zcg), cog_height_mm: Math.round(zcg + ground), ground_z_mm: -ground, izz_kgm2: r2(izz),
      driver_kg: r2(kg("driver") + kg("driver_ballast")), pu_kg: r2(kg("pu_ice") + kg("pu_turbo") + kg("pu_mguk") + kg("pu_es") + kg("pu_electronics")),
      ice_kg: kg("pu_ice"), tc_kg: kg("pu_turbo"), ice_group_kg: r2(kg("pu_ice") + kg("pu_turbo")), mguk_kg: kg("pu_mguk"), mguk_transmission: PU.mguk_transmission, es_kg: kg("pu_es"), driveline_kg: r2(kg("gearbox")),
      pu_cog_z_mm: Math.round((pu[0].mass_kg * pu[0].z_mm + pu[1].mass_kg * pu[1].z_mm) / (pu[0].mass_kg + pu[1].mass_kg)),
      label: MASS_LABEL,
    };
  }

  const api = { MASS_LABEL, MASS_SOURCE, PACK, PLANK, WHEEL, PU, CATALOGUE, BY_ID, PARAMS, geometry, plankWear, massSheet };
  C.parts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
