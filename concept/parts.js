// PURPLE CONCEPT - the part catalogue of a 2026-style F1 car: shape parameters (with the model's domain bounds), a mass ESTIMATE
// per part with its basis, and a position (x rearward from the front axle plane XF=0, z up from the reference plane Z=0, |y| from
// the centre plane; mm, FIA Car Coordinate System, C2.1.1). Real per-part masses are not public: every mass here is an estimate,
// tuned so the baseline car's parts sum to just under the 2026 qualifying minimum (teams were widely reported to struggle to reach
// the 2026 limit) and the static weight distribution sits inside the C4.2 window. Never quote these as measured.
// Domain bounds are what the parametric model can represent; they are deliberately WIDER than the regulations, so legality is a
// separate, visible check (concept/regs.js) and the optimiser has real limits to discover.
// Dual browser / Node: window.EI.concept.parts and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const regs = C.regs || (typeof require === "function" ? require("./regs.js") : null);
  const MASS_LABEL = "concept part-mass estimates v0 (not measured; per-part masses are not public)";

  // packaging lengths (mm), estimates: ICE block from its mounting face; gearbox from the bell housing to the final-drive axis,
  // which C9.5.1 puts within ±60 mm of the rear axle plane XR=0
  const PACK = { ice_len_mm: 620, gearbox_len_mm: 520, spacer_kg_per_mm: 0.012 };
  // the plank-wear estimate (concept model, used by REG-C-PLANK): wear grows 0.25 mm per mm of static ride height below 32 mm
  const PLANK = { free_mm: 32, wear_per_mm: 0.25 };

  // shape parameters: min/max = model domain, base = baseline car, step = mutation quantum, int = integer count
  const P = (min, max, base, step, unit, label, extra) => Object.assign({ min, max, base, step, unit, label }, extra || {});
  const CATALOGUE = [
    // ---- layout and chassis
    { id: "layout", name: "Overall layout", group: "chassis", params: { wheelbase_mm: P(3000, 3700, 3400, 5, "mm", "Wheelbase") }, basis: "no mass of its own; sets XR" },
    { id: "survival_cell", name: "Survival cell (monocoque, side impact structures, fuel-cell bay)", group: "chassis",
      params: { front_axle_offset_mm: P(0, 250, 75, 5, "mm", "Front axle behind cell front (XA→XF)"), cockpit_len_mm: P(1750, 2100, 1930, 5, "mm", "Cell front to cockpit rear (XA→XC)"), bulkhead_gap_mm: P(300, 600, 380, 5, "mm", "Cockpit rear to ICE face (XC→XPU)") },
      basis: "70 kg at a 2310 mm tub (estimate from public composite-monocoque figures plus inserts and SIS); 60 % fixed, 40 % ∝ tub length" },
    { id: "nose", name: "Nose and front impact structure", group: "chassis", params: {}, basis: "8 kg estimate" },
    { id: "halo", name: "Halo", group: "chassis", params: {}, basis: "7.5 kg estimate (public titanium-halo figures of about 7 kg, 2026 loads higher)" },
    { id: "rear_impact", name: "Rear impact structure and crash structures", group: "chassis", params: {}, basis: "6 kg estimate" },
    // ---- aero
    { id: "front_wing", name: "Front wing assembly (profiles, endplates, flap actuator)", group: "aero",
      params: { span_mm: P(1000, 1500, 1300, 10, "mm", "Span"), chord_mm: P(400, 900, 650, 5, "mm", "Chord (X extent)"), aoa_deg: P(10, 40, 25, 0.5, "°", "Wing setting (lab front_wing_deg units)"), elements: P(1, 4, 3, 1, "", "Profile volumes", { int: true }), sm_delta_deg: P(0, 20, 0, 0.5, "°", "Straight-mode flap incidence reduction") },
      basis: "9.5 kg of profiles at 0.845 m² planform and 3 volumes (∝ planform, +12 % per extra volume) + 2.0 kg endplates + 1.0 kg actuator if straight mode is used; estimate" },
    { id: "rear_wing", name: "Rear wing assembly (profiles, endplates, pylon, flap actuator)", group: "aero",
      params: { span_mm: P(900, 1300, 1100, 10, "mm", "Span"), chord_mm: P(300, 600, 420, 5, "mm", "Chord (X extent)"), aoa_deg: P(5, 35, 20, 0.5, "°", "Wing setting (lab rear_wing_deg units)"), elements: P(1, 4, 2, 1, "", "Profile volumes", { int: true }), endplate_top_mm: P(760, 960, 860, 5, "mm", "Endplate top (Z)"), sm_delta_deg: P(0, 30, 0, 0.5, "°", "Straight-mode flap incidence reduction") },
      basis: "7.0 kg of profiles at 0.462 m² and 2 volumes (∝ planform, +15 % per extra volume) + 2.4 kg endplates ∝ height + 1.0 kg pylon + 1.0 kg actuator if straight mode is used; estimate" },
    { id: "beam_wing", name: "Beam wing", group: "aero", params: {}, basis: "2.2 kg estimate; fixed geometry in this concept" },
    { id: "floor", name: "Floor (body, edge, fences, plank and skids)", group: "aero",
      params: { width_mm: P(1500, 2000, 1800, 10, "mm", "Floor width"), throat_mm: P(80, 130, 100, 1, "mm", "Venturi throat height above Z=0"), ride_height_mm: P(20, 70, 35, 0.5, "mm", "Static ride height at the plank") },
      basis: "25 kg of floor ∝ planform (length WB−300 mm × width) + 5 kg plank ∝ length (C3.6.2 fixes its specific gravity 1.3-1.45); estimate" },
    { id: "diffuser", name: "Diffuser", group: "aero", params: { expansion_deg: P(8, 22, 14, 0.5, "°", "Diffuser expansion angle") }, basis: "4 kg estimate, +2 % per degree of expansion" },
    { id: "sidepods", name: "Sidepods (bodywork, inlets, undercut)", group: "aero",
      params: { inlet_cm2: P(300, 1100, 650, 10, "cm²", "Cooling inlet area (both sides)"), undercut_mm: P(0, 220, 100, 5, "mm", "Undercut depth") },
      basis: "7 kg estimate; 30 % scales with inlet area" },
    { id: "engine_cover", name: "Engine cover, airbox and roll-hoop fairing", group: "aero", params: {}, basis: "6 kg estimate" },
    // ---- power unit (C5 mass floors are checked by concept/regs.js)
    { id: "pu_ice", name: "PU · ICE (1.6 L V6)", group: "power_unit", params: {}, basis: "131 kg: just above the C5.5.1 floor of 130 kg (estimate: manufacturers build to the floor)", power_kw: 400, power_basis: "≈ 400 kW: widely reported 2026 ICE output (FIA/F1 2024 announcements); not in Section C; estimate" },
    { id: "pu_turbo", name: "PU · turbocharger", group: "power_unit", params: {}, basis: "12 kg: the C5.3.4 floor" },
    { id: "pu_mguk", name: "PU · MGU-K", group: "power_unit", params: {}, basis: "18 kg: C5.18.7 option c floor", power_kw: 350, power_basis: "350 kW: C5.2.7 ERS-K DC power limit (verified)" },
    { id: "pu_es", name: "PU · energy store", group: "power_unit", params: {}, basis: "36 kg: just above the C5.17.9 floor of 35 kg" },
    { id: "pu_electronics", name: "PU · control electronics and HV cabling", group: "power_unit", params: {}, basis: "6 kg estimate" },
    // ---- transmission, suspension, wheels
    { id: "gearbox", name: "Gearbox, differential, driveshafts, oil", group: "transmission", params: {}, basis: "52 kg estimate (C9.5.2 floor for driveline + gear change alone is 22 kg) + 0.012 kg/mm of spacer when the wheelbase exceeds the packaging minimum" },
    { id: "front_suspension", name: "Front suspension and steering", group: "suspension", params: {}, basis: "26 kg estimate (uprights, wishbones, push/pull rods, rockers, dampers, rack)" },
    { id: "rear_suspension", name: "Rear suspension", group: "suspension", params: {}, basis: "24 kg estimate" },
    { id: "wheels_front", name: "Front wheels and tyres (×2)", group: "wheels", params: {}, basis: "2 × (10.0 kg rim, estimate) + 45 % of the Nominal Tyre Mass estimate" },
    { id: "wheels_rear", name: "Rear wheels and tyres (×2)", group: "wheels", params: {}, basis: "2 × (11.0 kg rim, estimate) + 55 % of the Nominal Tyre Mass estimate" },
    { id: "brakes_front", name: "Front brakes (×2)", group: "wheels", params: {}, basis: "15 kg estimate (carbon discs, pads, calipers, ducts)" },
    { id: "brakes_rear", name: "Rear brakes (×2)", group: "wheels", params: {}, basis: "12 kg estimate (brake-by-wire rear, smaller discs)" },
    // ---- systems
    { id: "cooling", name: "Cooling (radiators, intercooler, ERS cooling, fluids)", group: "systems", params: {}, basis: "38 kg at 650 cm² of inlet, ∝ inlet^0.8 (heat-exchanger capacity follows inlet area); estimate" },
    { id: "fuel_system", name: "Fuel system (cell, pumps, lines; empty)", group: "systems", params: {}, basis: "12 kg estimate; fuel itself is outside Car Mass (C1 definitions)" },
    { id: "hydraulics", name: "Hydraulics", group: "systems", params: {}, basis: "8 kg estimate" },
    { id: "electronics", name: "Electronics (SECU, loom, sensors, FIA cameras, ADR, radio, 12 V)", group: "systems", params: {}, basis: "24 kg estimate" },
    { id: "misc", name: "Paint, fasteners, brackets, sealant", group: "systems", params: {}, basis: "10 kg estimate" },
    // ---- driver
    { id: "driver", name: "Driver (reference mass)", group: "driver", params: {}, basis: "72 kg estimate of a reference driver mass incl. kit (C4.5.1 sets it per driver)" },
    { id: "driver_ballast", name: "Driver ballast", group: "driver", params: {}, basis: "tops driver + ballast up to the C4.5.2 floor of 82 kg; sits in the cockpit region (C4.3.2(a))" },
    { id: "seat_safety", name: "Seat, belts, headrest, pedals, extinguisher", group: "driver", params: {}, basis: "10 kg estimate" },
    // ---- ballast (free)
    { id: "ballast", name: "Ballast", group: "ballast", params: { x_frac: P(0, 1, 0.05, 0.01, "× WB", "Ballast position along the wheelbase"), extra_kg: P(0, 25, 0, 0.5, "kg", "Ballast above what the minimum needs") },
      basis: "automatic: whatever brings the car to the Minimum Mass (C4.1), plus extra_kg; low in the floor (C4.3.1)" },
  ];
  const BY_ID = {}; for (const p of CATALOGUE) BY_ID[p.id] = p;
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
    const fwS = (fw.span_mm * fw.chord_mm) / (1300 * 650), rwS = (rw.span_mm * rw.chord_mm) / (1100 * 420);
    const floorArea = (g.floor_len_mm * fl.width_mm) / (3100 * 1800), floorLen = g.floor_len_mm / 3100;
    const rows = [
      ["survival_cell", 70 * (0.6 + 0.4 * g.tub_len_mm / 2310), g.XA + 0.5 * g.tub_len_mm, 330, 0],
      ["nose", 8, g.XA - 500, 300, 0],
      ["halo", 7.5, g.XC - 500, 720, 0],
      ["rear_impact", 6, g.XR + 450, 250, 0],
      ["front_wing", 9.5 * fwS * (1 + 0.12 * (fw.elements - 3)) + 2.0 + (fw.sm_delta_deg > 0 ? 1.0 : 0), -860, 160, 0],
      ["rear_wing", 7.0 * rwS * (1 + 0.15 * (rw.elements - 2)) + 2.4 * (rw.endplate_top_mm / 860) + 1.0 + (rw.sm_delta_deg > 0 ? 1.0 : 0), g.XR + 400, rw.endplate_top_mm - 80, 0],
      ["beam_wing", 2.2, g.XR + 350, 330, 0],
      ["floor", 25 * floorArea + 5 * floorLen, 0.5 * g.XR + 200, 40, 0],
      ["diffuser", 4 * (1 + 0.02 * (params.diffuser.expansion_deg - 14)), g.XR - 150, 120, 0],
      ["sidepods", 7 * (0.7 + 0.3 * sp.inlet_cm2 / 650) * (1 - 0.001 * (sp.undercut_mm - 100)), g.XC + 250, 380, 550],
      ["engine_cover", 6, g.XPU + 350, 650, 0],
      ["pu_ice", 131, g.XPU + 310, 290, 0],
      ["pu_turbo", 12, g.XPU + 600, 430, 0],
      ["pu_mguk", 18, g.XPU + 150, 180, 120],
      ["pu_es", 36, g.XC + 120, 150, 0],
      ["pu_electronics", 6, g.XC + 250, 250, 150],
      // gearbox body anchored to the rear axle (final drive at XR, C9.5.1); the spacer sits between the ICE and the bell housing
      (() => { const ms = PACK.spacer_kg_per_mm * g.spacer_mm, xs = g.XPU + PACK.ice_len_mm + 0.5 * g.spacer_mm; return ["gearbox", 52 + ms, (52 * (g.XR - 230) + ms * xs) / (52 + ms), 270, 0]; })(),
      ["front_suspension", 26, 0, 280, 500],
      ["rear_suspension", 24, g.XR, 300, 500],
      ["wheels_front", 2 * 10.0 + 0.45 * ntm, 0, 353, 790],
      ["wheels_rear", 2 * 11.0 + 0.55 * ntm, g.XR, 353, 760],
      ["brakes_front", 15, 0, 353, 700],
      ["brakes_rear", 12, g.XR, 353, 700],
      ["cooling", 38 * Math.pow(sp.inlet_cm2 / 650, 0.8), g.XC + 250, 300, 500],
      ["fuel_system", 12, g.XC + 150, 350, 0],
      ["hydraulics", 8, g.XC + 100, 300, 0],
      ["electronics", 24, g.XC - 800, 280, 0],
      ["misc", 10, 0.40 * g.XR, 300, 0],
      ["driver", 72, g.XC - 750, 280, 0],
      ["seat_safety", 10, g.XC - 600, 320, 0],
    ].map(([id, kg, x, z, y]) => {
      const o = ov[id] || {};
      return { id, group: BY_ID[id].group, mass_kg: o.mass_kg != null ? o.mass_kg : kg, x_mm: o.x_mm != null ? o.x_mm : x, z_mm: o.z_mm != null ? o.z_mm : z, y_mm: y };
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
      parts: rows.map(r => ({ id: r.id, group: r.group, mass_kg: r2(r.mass_kg), x_mm: Math.round(r.x_mm), z_mm: Math.round(r.z_mm) })),
      parts_kg: r2(partsKg), ballast_kg: r2(ballastKg), total_kg: r2(M), min_kg: min.kg,
      front_kg: r2(front), rear_kg: r2(rear), front_share: Math.round((front / M) * 10000) / 10000,
      cog_x_mm: Math.round(xcg), cog_z_mm: Math.round(zcg), izz_kgm2: r2(izz),
      driver_kg: r2(kg("driver") + kg("driver_ballast")), pu_kg: r2(kg("pu_ice") + kg("pu_turbo") + kg("pu_mguk") + kg("pu_es") + kg("pu_electronics")),
      ice_kg: kg("pu_ice"), tc_kg: kg("pu_turbo"), mguk_kg: kg("pu_mguk"), es_kg: kg("pu_es"), driveline_kg: r2(kg("gearbox")),
      pu_cog_z_mm: Math.round((pu[0].mass_kg * pu[0].z_mm + pu[1].mass_kg * pu[1].z_mm) / (pu[0].mass_kg + pu[1].mass_kg)),
      label: MASS_LABEL,
    };
  }

  const api = { MASS_LABEL, PACK, PLANK, CATALOGUE, BY_ID, PARAMS, geometry, plankWear, massSheet };
  C.parts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
