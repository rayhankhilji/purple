// PURPLE CONCEPT - the virtual aero bench. bench(design, { circuit, sim }) = legality (concept/regs.js) + PhysicalCar
// (concept/physical.js) + a lap simulator sim(physicalCar, trackId, conditions) + the objective.
// Sims: "physics" (default when concept/sim/ is loaded): the physics lap sim (concept/sim/index.js simulateLap; Silverstone only,
// other circuits fall back to v0), behind a result cache keyed by the PhysicalCar, the circuit and the conditions, with the energy
// fields pinned to the regulation values (closes the es_harvest-lowering exploit, docs/concept/SIM.md). "v0": the game's own
// reduced-order lap model (js/ai.js buildSpeedProfile through lab/evaluator.js, both called read-only), driven by the ratio of
// this PhysicalCar to its baseline concept car; it stays as the fallback and for fast tests. A function: any sim with that contract.
// Objective: "weekend" (default at Silverstone when concept/weekend/weekend.js loads): the weekend score of the race-weekend model
// (qualifying among the real 2026 laps + the 52-lap race). "quali": the margin to the real 2026 pole (s). Both carry the grid slot.
// Deterministic. A reduced-order model: no flow is solved anywhere.
// Dual browser / Node: window.EI.concept.bench and module.exports. In the browser the game scripts, lab/aero.js, lab/evaluator.js
// and js/data/racepace2026.js must be loaded first (and js/data/silverstone.js + concept/sim/*.js for the physics sim).
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const regs = req("regs", "./regs.js"), design = req("design", "./design.js"), phys = req("physical", "./physical.js");
  const LABEL = "concept · reduced-order lap model · calibrated to 2026 pole laps · concept aero map v1";
  const V0_LABEL = LABEL + " · sim v0 (game lap model, relative to the baseline concept car)";
  const SCORE_LABEL = "qualifying score · Silverstone · margin to the real 2026 pole and projected grid slot vs the real 2026 qualifying laps (EI.RACEPACE)";
  const SCORE_LABEL_V0 = SCORE_LABEL + " · baseline anchored at pole by construction (sim v0)";

  // ---- the game, read-only. Node: the headless loader (server/game-headless.js). Browser: whatever the page loaded.
  function game() {
    const G = root.EI;
    if (G && G.evaluator && G.buildSpeedProfile && G.aero) return G;
    if (typeof require === "function") return require("../server/game-headless.js").load();
    throw new Error("concept bench: load three.js, js/util.js, js/data/*.js, js/track.js, js/car.js, js/ai.js, lab/aero.js, lab/evaluator.js first");
  }
  // real 2026 lap data. Node: evaluate js/data/racepace2026.js in a sandbox with a window shim (never touches the global EI)
  let racepaceCache = null;
  function racepace() {
    if (root.EI && root.EI.RACEPACE) return root.EI.RACEPACE;
    if (racepaceCache) return racepaceCache;
    if (typeof require !== "function") throw new Error("concept bench: js/data/racepace2026.js is not loaded");
    const fs = require("fs"), path = require("path"), vm = require("vm");
    const sandbox = {}; sandbox.window = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data", "racepace2026.js"), "utf8"), sandbox, { filename: "js/data/racepace2026.js" });
    return (racepaceCache = sandbox.EI.RACEPACE);
  }

  // ---- v0 constants (model assumptions; CONCEPT.md explains each)
  const V0 = {
    // aero balance vs weight distribution: every percentage point of change in (aero balance − weight distribution) away from the
    // baseline car's costs 0.3 % of mechanical grip (the driver manages under/oversteer). Guess, same spirit as lab/aero.js BALANCE.
    balance_a0_per_pp: 0.003,
    // agility: grip × (1 − 0.10 × (WB / WB_ref − 1)): a shorter car rotates more readily. Guess; the game's own steering geometry is untouched.
    agility_per_wb: 0.10,
    // activation zones (Straight Mode allowed): runs of the racing line with |curvature| < 1/1000 m⁻¹ at least 300 m long. The real
    // zones are set per event under the Sporting Regulations (B7.1.1(d)); this is a geometric stand-in.
    zone_k: 1 / 1000, zone_min_m: 300,
    iters: 8, tol_ms: 0.001,
    traction_cap: 14,   // js/ai.js forward pass: min(14, PM / max(v, 6)) - the game's traction cap, mass independent (μ·g-like)
  };

  const zoneCache = {};
  function activationZones(track, circuit) {
    if (zoneCache[circuit]) return zoneCache[circuit];
    const n = track.n, low = new Uint8Array(n), z = new Uint8Array(n);
    for (let i = 0; i < n; i++) low[i] = Math.abs(track.lineK[i]) < V0.zone_k ? 1 : 0;
    let start = 0; while (start < n && low[start]) start++;   // begin the scan at a non-zone sample so wrap-around runs are whole
    if (start === n) { z.fill(1); return (zoneCache[circuit] = z); }
    const minN = Math.ceil(V0.zone_min_m / track.ds);
    for (let j = 1; j <= n; j++) {
      const i = (start + j) % n; if (!low[i]) continue;
      let len = 0; while (len < n && low[(i + len) % n]) len++;
      if (len >= minN) for (let q = 0; q < len; q++) z[(i + q) % n] = 1;
      j += len - 1;
    }
    return (zoneCache[circuit] = z);
  }

  // the speed profile with mass, power and Straight Mode folded in. The game's model takes per-car multipliers { df, cd, a0, b0 }
  // and a per-sample headwind array w (m/s) that enters only the longitudinal drag term, cd·(v + w)·|v + w|, and the terminal-speed
  // cap. Mass scales the v² aero terms per unit mass (df / k, drag / k) and the power term (PM·p / k); Straight Mode lowers drag on
  // the activation zones. The power and drag changes cannot be expressed with the multipliers alone, so they go through w as an
  // equivalent airspeed offset: w is solved per sample so that cd·(v + w)² equals the drag-plus-lost-power the real car would see at
  // the profile's speed v, and the profile is rebuilt until it stops moving (fixed point, ≤ 8 passes, 1 mm/s). With k = p = 1 and no
  // Straight Mode this is exactly the evaluator's call (no w): the baseline laps the evaluator's lap to the millisecond.
  // Straight Mode also costs downforce (chan.df_sm: the df multiplier inside the zones). The game's model has one df for the lap, so
  // the zones' lower load is applied by zoneDownforce() after each build: the game's braking and acceleration passes re-run with the
  // straight-mode df on zone samples. Zones are runs with |curvature| < 1/1000 m⁻¹, below the game's aero corner-speed threshold
  // (k < grip·a1 there), so inside a zone downforce only acts through braking; the flaps are assumed to stay in Straight Mode for
  // the whole geometric zone, braking included (the Sporting Regulations' deactivation points are not modelled).
  function zoneDownforce(G, track, prof, mult, dfZone, z, w) {
    const n = track.n, ds = track.ds, B = G.CAR.BRAKE, dec = G.AI_CAL.DEC_REF, PM = G.CAR.PM, cd = G.CAR.CD * mult.cd, cap = V0.traction_cap;
    const b0 = B.b0 * mult.b0, v = Float32Array.from(prof);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 2 * n - 1; j >= 0; j--) {   // js/ai.js backward (braking) pass, per-sample df
        const i = j % n, nx = (i + 1) % n, b1 = B.b1 * (z[i] ? dfZone : mult.df);
        const de = Math.min(B.cap, b0 + b1 * v[nx] * v[nx]) * dec;
        v[i] = Math.min(v[i], Math.sqrt(v[nx] * v[nx] + 2 * de * ds));
      }
      for (let j = 0; j < 2 * n; j++) {   // js/ai.js forward (mode 1, aero on) pass, same headwind channel
        const i = j % n, pv = (i + n - 1) % n, vp = v[pv], va = vp + (w ? w[pv] || 0 : 0);
        const acc = Math.min(cap, PM / Math.max(vp, 6)) - cd * va * Math.abs(va);
        v[i] = Math.min(v[i], Math.sqrt(Math.max(1, vp * vp + 2 * acc * ds)));
      }
    }
    return v;
  }
  function profile(G, track, grip, mult, chan) {
    const dec = G.AI_CAL.DEC_REF, ceil = G.CAR.VMAX + 6;
    const z = chan.zones, dfZone = chan.df_sm == null ? mult.df : chan.df_sm, zoneDf = !!z && Math.abs(dfZone - mult.df) > 1e-12;
    const build = w => { const pr = G.buildSpeedProfile(track, dec, grip, ceil, 1, 0, mult, w); return zoneDf ? zoneDownforce(G, track, pr, mult, dfZone, z, w) : pr; };
    let prof = G.buildSpeedProfile(track, dec, grip, ceil, 1, 0, mult, null);
    const needW = chan.k !== 1 || chan.p !== 1 || (z && chan.cd_sm !== mult.cd) || zoneDf;
    if (!needW) return { prof, iters: 0 };
    if (zoneDf) prof = zoneDownforce(G, track, prof, mult, dfZone, z, null);
    const PM = G.CAR.PM, CD = G.CAR.CD, cdC = CD * mult.cd, n = track.n, cap = V0.traction_cap;
    let it = 0;
    for (; it < V0.iters; it++) {
      const w = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const v = prof[i], vv = Math.max(v, 6), cdi = CD * (z && z[i] ? chan.cd_sm : mult.cd);
        const D = Math.min(cap, PM / vv) - Math.min(cap, (PM * chan.p) / (chan.k * vv)) + (cdi / chan.k) * v * v;
        w[i] = Math.sqrt(Math.max(0, D) / cdC) - v;
      }
      const next = build(w);
      let dmax = 0; for (let i = 0; i < n; i++) { const d = Math.abs(next[i] - prof[i]); if (d > dmax) dmax = d; }
      prof = next; if (dmax < V0.tol_ms) { it++; break; }
    }
    return { prof, iters: it };
  }

  // the reference (baseline concept) car of the SAME session and team: C4.1 gives 726 kg + NTM in (Sprint) Qualifying, 724 kg + NTM
  // otherwise; a team design is measured against its own team baseline (the same anchor in concept/physical.js)
  const refCache = {};
  function refCar(cal, session, team) {
    const s = regs.minMass(session).session, key = JSON.stringify(cal || {}) + "|" + s + "|" + (team || "");
    return refCache[key] || (refCache[key] = phys.physical(design.baseline(team ? { team } : undefined), { calibration: cal, session: s }));
  }
  const clampBand = v => { const c = game().aero.CLAMP; return v < c.min ? c.min : v > c.max ? c.max : v; };

  // PhysicalCar -> the game model's per-car multipliers, relative to the baseline concept car (which maps to exactly 1.0). The game's
  // limit car stands for the pole car, which ran Straight Mode on its real lap, so the zone multipliers are relative to the baseline's
  // own Straight Mode (its reference flap setting): the baseline is 1.0 in both modes; a car without flaps is slower on the zones.
  function v0Multipliers(pc) {
    const G = game(), ref = refCar(pc.calibration, pc.session, pc.team), A = pc.aero, R = ref.aero;
    const claC = A.corner.CLA_front_m2 + A.corner.CLA_rear_m2, refC = R.corner.CLA_front_m2 + R.corner.CLA_rear_m2;
    const claS = A.straight.CLA_front_m2 + A.straight.CLA_rear_m2, refS = R.straight.CLA_front_m2 + R.straight.CLA_rear_m2;
    const k = (pc.mass_kg + pc.fuel_kg) / (ref.mass_kg + ref.fuel_kg);
    const p = (pc.pu.ice_kw * pc.drivetrain_eff) / (ref.pu.ice_kw * ref.drivetrain_eff);
    const ab = A.corner.CLA_front_m2 / claC, abRef = R.corner.CLA_front_m2 / refC;
    const pp = 100 * ((ab - pc.weight_dist_front) - (abRef - ref.weight_dist_front));
    // tyre load sensitivity: μ falls by load_sens per kN of extra static load per tyre (mass above the reference car's)
    const loadMu = 1 - pc.tyres.load_sens * (((pc.mass_kg + pc.fuel_kg) - (ref.mass_kg + ref.fuel_kg)) * 9.81) / 4 / 1000;
    let a0 = (pc.tyres.mu_y / ref.tyres.mu_y) * loadMu * (1 - V0.balance_a0_per_pp * Math.abs(pp)) * (1 - V0.agility_per_wb * (pc.wheelbase_m / ref.wheelbase_m - 1));
    const B = G.aero.BOTTOMING, rh = A.ride_height_mm;
    if (rh < B.below_mm) a0 *= 1 - B.a0_per_mm * (B.below_mm - rh);   // lab/aero.js bottoming, read-only
    const raw = { df: claC / refC / k, df_sm: claS / refS / k, cd: A.corner.CDA_m2 / R.corner.CDA_m2, cd_sm: A.straight.CDA_m2 / R.straight.CDA_m2, a0, b0: (pc.tyres.mu_x / ref.tyres.mu_x) * loadMu };
    const m = {}; let clamped = false;
    for (const key of Object.keys(raw)) { m[key] = +clampBand(raw[key]).toFixed(6); if (Math.abs(m[key] - raw[key]) > 1e-6) clamped = true; }
    if (Math.abs(raw.df - 1) < 1e-12) m.df = 1;   // keep the baseline's multipliers exactly 1 (float noise would leave the evaluator path)
    if (Math.abs(raw.df_sm - raw.df) < 1e-12) m.df_sm = m.df;
    return { mult: { df: m.df, cd: m.cd, a0: m.a0, b0: m.b0 }, cd_sm: m.cd_sm, df_sm: m.df_sm, k, p, balance_pp: +pp.toFixed(3), clamped };
  }

  // sim v0: (PhysicalCar, trackId, conditions) -> lap in REAL seconds. The game's lap is scaled by real 2026 pole / game limit lap
  // (88.111 / 80.8 at Silverstone): the game's limit car is the pole car, so the baseline concept car laps the real pole by
  // construction. v0 ranks changes; it does not place the baseline absolutely (the physics sim will). conditions: dry only.
  function simV0(pc, trackId, conditions) {
    const t0 = Date.now(), G = game(), ev = G.evaluator;
    if (conditions && (conditions.wet || conditions.wind_ms)) throw new Error("concept sim v0: dry, still air only");
    const track = ev.trackFor(trackId), cal = ev.calibrate(track, trackId);
    const mm = v0Multipliers(pc), zones = activationZones(track, trackId);
    const { prof, iters } = profile(G, track, cal.grip, mm.mult, { k: mm.k, p: mm.p, cd_sm: mm.cd_sm, df_sm: mm.df_sm, zones });
    const t = ev.timing(track, prof, Infinity, trackId);
    const RP = racepace()[trackId], pole = RP && RP.pole && RP.pole.s, limit = G.LIMIT_LAP[trackId];
    if (!(pole > 0) || !(limit > 0)) throw new Error("concept sim v0: no real pole / limit lap for " + trackId);
    const scale = pole / limit, r3 = v => Math.round(v * 1000) / 1000, kmh = v => Math.round(v * 36) / 10;
    let zoneM = 0; for (let i = 0; i < track.n; i++) if (zones[i]) zoneM += track.ds;
    return {
      lap_s: r3(t.lap * scale), sectors_s: t.sectors.map(s => r3(s * scale)),
      vmax_kmh: kmh(t.vmax), speed_trap_kmh: kmh(t.vmaxStraight), vmin_kmh: kmh(t.vminRef),
      energy: { deployed_mj: 0, harvested_mj: 0 },
      label: V0_LABEL,
      v0: { game_lap_s: r3(t.lap), scale: +scale.toFixed(6), multipliers: mm.mult, cd_straight: mm.cd_sm, df_straight: mm.df_sm, mass_ratio: +mm.k.toFixed(6), power_ratio: +mm.p.toFixed(6), balance_pp: mm.balance_pp, clamped: mm.clamped, straight_mode_zone_m: Math.round(zoneM), iterations: iters, ms: Date.now() - t0, note: "no ERS in v0 (game mode 1); speeds are the game's, not scaled" },
    };
  }

  // ---- the physics lap sim (concept/sim/, docs/concept/SIM.md): simulateLap(car, "silverstone", conditions). Silverstone only
  // (its racing line comes from the 2026 telemetry); other circuits use v0. ~6-22 ms a lap, so results are cached: the key is the
  // PhysicalCar's numbers (not its labels) + circuit + conditions, so the same design (or two designs with the same physics) is
  // simulated once. The energy fields are pinned to the regulation values (concept/physical.js ENERGY): energy is not a design
  // choice, and a car declaring a lower recharge cap must not run a different energy strategy (SIM.md: es_harvest lowering).
  const PHYSICS_CIRCUITS = ["silverstone"], CACHE_MAX = 6000;
  const physCache = new Map(), physStats = { hits: 0, misses: 0, ms: 0 };
  function physicsSim() { return phys.sim ? phys.sim() : null; }
  function simKey(pc, trackId, conditions) {
    const k = { m: pc.mass_kg, f: pc.fuel_kg, wb: pc.wheelbase_m, t: [pc.track_front_m, pc.track_rear_m], h: pc.cog_height_m, w: pc.weight_dist_front, a: [pc.aero.corner, pc.aero.straight, pc.aero.floor_stalled, pc.aero.ride_sens_per_mm, pc.aero.stall_margin_mm, pc.aero.heave_n_per_mm, pc.aero.floor_share, pc.aero.yaw_sens], pu: [pc.pu.ice_kw, pc.pu.mguk_kw], ty: pc.tyres, b: pc.brakes, e: pc.drivetrain_eff, g: pc.gearing || null };
    return trackId + "|" + JSON.stringify(conditions || null) + "|" + JSON.stringify(k);
  }
  function guardEnergy(pc) {
    const E = phys.ENERGY;
    return Object.assign({}, pc, { pu: Object.assign({}, pc.pu, { es_harvest_mj_per_lap: E.recharge_max_mj, es_deploy_mj_per_lap: E.deploy_mj, mguk_kw: Math.min(pc.pu.mguk_kw, E.mguk_max_kw) }) });
  }
  // simOpts (optional): { strategy } - one of the sim's own energy strategies (SIM.md §3; "threshold" is the calibrated default)
  function simPhysics(pc, trackId, conditions, simOpts) {
    if (!PHYSICS_CIRCUITS.includes(trackId)) return simV0(pc, trackId, conditions);
    const S = physicsSim(); if (!S) throw new Error("concept bench: the physics lap sim (concept/sim/index.js) is not loaded");
    const strategy = simOpts && simOpts.strategy ? String(simOpts.strategy) : null;
    const key = simKey(pc, trackId, conditions) + (strategy ? "|" + strategy : ""), hit = physCache.get(key);
    if (hit) { physStats.hits++; physCache.delete(key); physCache.set(key, hit); return Object.assign({}, hit); }
    const t0 = Date.now(), r = S.simulateLap(guardEnergy(pc), trackId, conditions || undefined, strategy ? { strategy } : undefined);
    physStats.misses++; physStats.ms += Date.now() - t0;
    const out = { lap_s: r.lap_s, sectors_s: r.sectors_s, vmax_kmh: r.vmax_kmh, speed_trap_kmh: r.speed_trap_kmh, vmin_kmh: r.vmin_kmh, energy: r.energy, speeds_kmh: r.speeds_kmh, air_density_kgm3: r.air_density_kgm3, label: r.label, sim: "physics" };
    physCache.set(key, out); if (physCache.size > CACHE_MAX) physCache.delete(physCache.keys().next().value);
    return Object.assign({}, out);
  }
  simPhysics.kind = "physics"; simV0.kind = "v0";

  // ---- SAME ENGINE: the PU homologation guard (docs/concept/CAMPAIGN.md §1). A design changes the chassis and the aero, never the
  // power unit: every PhysicalCar must carry exactly its team's homologated PU (the Red Bull baseline: the DM01 of the sim's inferred
  // RB22, sim.baselineCar("redbull"); the generic baseline: the sim's estimated 2026 PU). Checked: ICE kW (the anchor's; a cooling
  // derate or a calibration power_scale changes it, so both are rejected), MGU-K kW, the energy-store figures (C5.2.9, C5.2.10),
  // no extra PU field the sim could read (e.g. superclip_kw), the PU part masses and the MGU-K transmission option of the mass sheet
  // (C5.5, C5.18.7, C5.17.9, C5.3.4), no override on a PU part, and the anchor team. Fuel flow (C5.2.3-4) and the MGU-K taper
  // (C5.2.8) are constants inside the sim (REGS), not PhysicalCar fields, so no design reaches them.
  // checkPhysical rules not enforced yet (re-enable by emptying this list once the inputs are fixed; docs/concept/CAMPAIGN.md §3)
  const PHYSICAL_SKIP = [];   // emptied with sim v3: the PhysicalCar tracks (1.540 / 1.470 m) fit C10.10.1
  const PU_PARTS = Object.freeze(["pu_ice", "pu_turbo", "pu_mguk", "pu_es", "pu_electronics"]);
  const PU_FIELDS = Object.freeze(["ice_kw", "mguk_kw", "es_deploy_mj_per_lap", "es_harvest_mj_per_lap", "es_soc_window_mj"]);
  const PU_RULE = "C5 · the baseline team's homologated power unit, unchanged (campaign rule: same engine)";
  const puCache = {};
  function homologatedPU(team) {
    team = team && team !== "generic" ? team : null;
    const key = team || "generic"; if (puCache[key]) return puCache[key];
    const A = phys.anchor(team), E = phys.ENERGY, parts = req("parts", "./parts.js");
    const ref = design.baseline(team ? { team } : undefined), sheet = design.facts(ref).mass;
    const mguk = Math.min(E.mguk_max_kw, parts.BY_ID.pu_mguk.power_kw);
    if (A && Math.abs(A.pu.mguk_kw - mguk) > 1e-9) throw new Error("concept bench: the anchor's MGU-K (" + A.pu.mguk_kw + " kW) differs from the catalogue's " + mguk + " kW");
    const masses = {}; for (const id of PU_PARTS) masses[id] = sheet.parts.find(p => p.id === id).mass_kg;
    const tm = team && design.TEAMS && design.TEAMS[team];
    const H = {
      team, name: tm ? tm.pu : (A ? "generic 2026 PU (the physics sim's estimate)" : "generic 2026 PU (v0 estimate)"),
      ice_kw: +(A ? A.pu.ice_kw : phys.REF_V0.ice_kw).toFixed(4), mguk_kw: mguk,
      es_deploy_mj_per_lap: E.deploy_mj, es_harvest_mj_per_lap: E.recharge_max_mj, es_soc_window_mj: E.soc_window_mj,
      masses_kg: masses, mguk_transmission: sheet.mguk_transmission, source: A ? "physics sim anchor " + (A.id || key) + " (" + (A.label || "") + ")" : "PhysicalCar v0 levels",
      basis: "ICE: the anchor car's (sim fit; DM01 PU scale for Red Bull); MGU-K C5.2.7; ES " + E.basis + "; masses: concept part catalogue (C5.5.1/C5.18.7 option " + sheet.mguk_transmission + ", C5.17.9, C5.3.4)",
    };
    return (puCache[key] = Object.freeze(H));
  }
  const near = (a, b) => typeof a === "number" && isFinite(a) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  function puViolation(value, limit, what) { return { id: "PU-HOMOLOGATED", article: PU_RULE, value, limit, message: "Power unit differs from the homologated " + what + " [" + PU_RULE + "]" }; }
  // checkPU(pc, design?, massSheet?) -> violations [] (empty = the team's homologated PU, exactly)
  function checkPU(pc, d, sheet) {
    const team = d ? (d.team || null) : ((pc && pc.team) || null), H = homologatedPU(team), out = [];
    if (!pc || !pc.pu) return [puViolation("missing", "pu", "PU (no pu block)")];
    if ((pc.team || null) !== (team || null)) out.push(puViolation(pc.team || "generic", team || "generic", "PU: the car is anchored on another team's car"));
    for (const k of PU_FIELDS) if (!near(pc.pu[k], H[k])) out.push(puViolation(pc.pu[k], H[k], H.name + " " + k + " (" + pc.pu[k] + " vs " + H[k] + ")"));
    for (const k of Object.keys(pc.pu)) if (!PU_FIELDS.includes(k)) out.push(puViolation(k, PU_FIELDS.join(", "), H.name + ": unknown PU field " + k));
    const cal = pc.calibration || {};
    if (cal.power_scale != null && cal.power_scale !== 1) out.push(puViolation(cal.power_scale, 1, H.name + " power (calibration power_scale " + cal.power_scale + ")"));
    if (sheet) {
      for (const id of PU_PARTS) { const row = (sheet.parts || []).find(p => p.id === id); if (!row || !near(row.mass_kg, H.masses_kg[id])) out.push(puViolation(row ? row.mass_kg : "missing", H.masses_kg[id], H.name + " " + id + " mass")); }
      if (sheet.mguk_transmission !== H.mguk_transmission) out.push(puViolation(sheet.mguk_transmission, H.mguk_transmission, H.name + " MGU-K transmission option"));
    }
    if (d && d.overrides) for (const id of PU_PARTS) if (d.overrides[id]) out.push(puViolation("override", "none", H.name + " " + id + " (override)"));
    return out;
  }
  // energy limits on a physics lap (C5.2.9 SoC window 4 MJ, C5.2.10 recharge ≤ 8.5 MJ and the session limit): the sim closes the
  // budget itself; this re-checks its own report so a lap that exceeds a limit is never scored. [] = within the limits.
  function checkEnergy(r, conditions) {
    const e = r && r.energy; if (!e || e.recharge_cap_mj == null) return [];
    const E = phys.ENERGY, lim = conditions && conditions.recharge_limit_mj != null ? +conditions.recharge_limit_mj : Infinity, cap = Math.min(E.recharge_max_mj, lim, e.recharge_cap_mj), out = [];
    const v = (val, limit, what) => ({ id: "ENERGY-LIMIT", article: "C5.2.9 / C5.2.10", value: val, limit, message: what + " (is " + val + ", limit " + limit + ") [FIA 2026 C5.2.9-C5.2.10]" });
    if (e.recharge_cap_mj > E.recharge_max_mj + 1e-9) out.push(v(e.recharge_cap_mj, E.recharge_max_mj, "Recharge cap above C5.2.10"));
    if (e.harvested_mj > cap + 0.002) out.push(v(e.harvested_mj, cap, "Recharge per lap above the limit"));
    if (e.deployed_mj > e.harvested_mj + E.soc_window_mj + 0.002) out.push(v(e.deployed_mj, +(e.harvested_mj + E.soc_window_mj).toFixed(3), "Deployment above the SoC window plus the recharge"));
    return out;
  }
  // materials: a non-baseline material must be one the materials data marks permitted under C15.2 (fia.status "permitted"), and
  // the FIA-homologated / tested safety structures (survival cell C15.5.3 + C13, nose and rear impact structures C13) keep their
  // baseline laminate (campaign rule, conservative: their lay-ups are homologated with the tests, not free choices).
  const MATERIAL_FIXED_STRUCTURES = Object.freeze(["survival_cell", "nose", "rear_impact"]);
  function materialAllowed(part, id) {
    const M = C.materials || (typeof require === "function" ? safeRequire("./materials.js") : null); if (!M) return false;
    if (id === M.baseOf(part)) return true;
    if (M.problem(part, id)) return false;
    if (MATERIAL_FIXED_STRUCTURES.includes(part)) return false;
    const m = M.get(id); return !!(m && m.fia && m.fia.status === "permitted");
  }
  function checkMaterials(d) {
    const M = C.materials || (typeof require === "function" ? safeRequire("./materials.js") : null), out = [];
    if (!M || !d || !d.params) return out;
    for (const part of Object.keys(d.params)) {
      const id = d.params[part] && d.params[part].material; if (typeof id !== "string" || materialAllowed(part, id)) continue;
      const m = M.get(id), why = MATERIAL_FIXED_STRUCTURES.includes(part) ? "homologated safety structure keeps its baseline laminate (campaign rule)" : "FIA status " + (m && m.fia ? m.fia.status : "unknown") + " (" + (m && m.fia ? m.fia.article : "C15") + ")";
      out.push({ id: "MAT-C15", article: (m && m.fia && m.fia.article) || "C15", value: id, limit: "permitted (C15.2)", message: part + " material " + id + ": " + why + " [FIA 2026 C15]" });
    }
    return out;
  }
  // opts.sim -> a sim function: "physics" | "v0" | "auto" (default: physics when concept/sim/ is loaded, else v0) | a function
  function resolveSim(s) {
    if (typeof s === "function") return s;
    if (s === "v0") return simV0;
    if (s === "physics") { if (!physicsSim()) throw new Error("concept bench: sim 'physics' requested but concept/sim/index.js is not loaded"); return simPhysics; }
    if (s == null || s === "auto") return physicsSim() ? simPhysics : simV0;
    throw new Error("concept bench: opts.sim is 'physics', 'v0', 'auto' or a function");
  }
  const simKind = s => (s && s.kind) || "custom";
  function cacheStats() { return { size: physCache.size, hits: physStats.hits, misses: physStats.misses, sim_ms: physStats.ms, bench_size: benchCache.size, bench_hits: physStats.bench_hits || 0 }; }
  function clearCache() { physCache.clear(); benchCache.clear(); physStats.hits = physStats.misses = physStats.ms = physStats.bench_hits = 0; }

  // the qualifying score at a circuit from a sim result: margin to the real 2026 pole (s, + = faster than pole) and the grid slot the
  // lap would have taken among the real 2026 qualifying laps (1 + number of real laps strictly faster)
  function weekend(lap_s, circuit, kind) {
    const RP = racepace()[circuit]; if (!RP || !RP.pole) return null;
    const q = Object.values(RP.q || {}).filter(x => x > 0).sort((a, b) => a - b), pole = RP.pole.s;
    const pos = 1 + q.filter(x => x < lap_s - 1e-9).length;
    return { circuit, lap_s, pole_s: pole, pole_code: RP.pole.code, gap_to_pole_s: +(lap_s - pole).toFixed(3), grid_position: pos, field_size: q.length, score: +(pole - lap_s).toFixed(3), label: kind === "v0" ? SCORE_LABEL_V0 : SCORE_LABEL };
  }
  // the race-weekend model (concept/weekend/weekend.js), optional
  function weekendModule() { const w = C.weekend || (typeof require === "function" ? safeRequire("./weekend/weekend.js") : null); return w && typeof w.score === "function" ? w : null; }
  function safeRequire(p) { try { return require(p); } catch (e) { return null; } }

  // bench(design, opts) -> BenchResult. opts: { circuit = "silverstone" (scored), circuits = [circuit] (all run), sim = "auto" |
  // "physics" | "v0" | fn, objective = "weekend" (Silverstone, weekend module loaded) | "quali", conditions, calibration,
  // session = "qualifying", mass_weight = 0 (s of score per kg above the minimum; 0: the sim already charges mass), cache = true }
  // Results are cached by design + options (deterministic), so re-benching a kept design costs nothing.
  const benchCache = new Map();
  function benchKey(d, opts, simFn) {
    if (opts.cache === false || (simFn !== simPhysics && simFn !== simV0)) return null;
    const o = { c: opts.circuit, cs: opts.circuits, k: simKind(simFn), ob: opts.objective, cd: opts.conditions, cal: opts.calibration, s: opts.session, mw: opts.mass_weight, wo: opts.weekend, st: opts.strategy, pg: opts.pu_guard, mg: opts.material_guard };
    return JSON.stringify([d.params, d.overrides || null, d.team || null, o]);
  }
  function bench(d, opts) {
    opts = opts || {}; const t0 = Date.now();
    const scored = opts.circuit || "silverstone", circuits = (opts.circuits || [scored]).slice(), sim = resolveSim(opts.sim);   // never mutate the caller's array
    if (!circuits.includes(scored)) circuits.unshift(scored);
    const v = design.validate(d);
    if (!v.ok) return { id: d && d.id, legal: false, errors: v.errors, violations: [], score: null, label: LABEL };
    const key = benchKey(d, opts, sim), hit = key && benchCache.get(key);
    if (hit) { physStats.bench_hits = (physStats.bench_hits || 0) + 1; const r = JSON.parse(hit); r.id = d.id || null; r.physical.id = d.id || null; r.ms = Date.now() - t0; return r; }
    const f = design.facts(d, opts), violations = regs.checkFacts(f, opts);
    const pc = phys.physical(d, opts);
    // FIA checklist on the PhysicalCar (regs.checkPhysical): the Section C PU / energy limits and the PU lock against the team's
    // homologated PU (PKG-PU-FIXED). recharge_limit_mj is NOT passed: es_harvest_mj_per_lap is the car's C5.2.10 cap (8.5 MJ); the
    // session's 6.5 MJ applies to what a lap harvests and is checked on the sim's report (checkEnergy). PHYSICAL_SKIP rules are
    // left out until their model inputs exist (REG-C-SUSP-WIDTH: track widths, claude/sim-v3-fia).
    if (regs.checkPhysical) for (const x of regs.checkPhysical(pc, { pu_ref: homologatedPU(d.team || null) })) if (!PHYSICAL_SKIP.includes(x.id)) violations.push(x);
    // same engine and permitted materials: BACKSTOPS on top of regs.js (PKG-PU-FIXED, the C15 rules). They speak only when regs.js
    // found nothing, so a car regs.js rejects carries exactly regs.js's verdict, and a car it lets through still cannot carry a
    // changed PU (exact ICE / MGU-K / ES figures, PU masses, no extra PU field, no power_scale) or a material the campaign does not
    // allow (FIA status other than permitted; homologated safety structures). On unless a what-if study turns them off;
    // concept/optimize.js never does.
    if (!violations.length && opts.pu_guard !== false) for (const x of checkPU(pc, d, f.mass)) violations.push(x);
    if (!violations.length && opts.material_guard !== false) for (const x of checkMaterials(d)) violations.push(x);
    const out = {
      id: d.id || null, label: LABEL, legal: violations.length === 0, violations,
      physical: pc, team: d.team || null,
      mass: { total_kg: f.mass.total_kg, parts_kg: f.mass.parts_kg, ballast_kg: f.mass.ballast_kg, min_kg: f.mass.min_kg, front_share: f.mass.front_share, cog_x_mm: f.mass.cog_x_mm, cog_z_mm: f.mass.cog_z_mm, izz_kgm2: f.mass.izz_kgm2, label: f.mass.label },
      aero: { df: +f.aero.df.toFixed(4), cd: +f.aero.cd.toFixed(4), df_sm: +f.aero.df_sm.toFixed(4), cd_sm: +f.aero.cd_sm.toFixed(4), balance: +f.aero.balance.toFixed(4), floor_stalled: f.aero.floor_stalled, stall_margin_mm: +f.aero.stall_margin_mm.toFixed(2), cooling_power_factor: +f.aero.cooling.power_factor.toFixed(4), cooling_capacity_over_need: +(f.aero.cooling.capacity / f.aero.cooling.need).toFixed(4), label: f.aero.version },
      circuits: {}, weekend: null, weekend_model: null, score: null, sim: simKind(sim), objective: null,
    };
    if (out.legal) {   // like the lab: an illegal car gets no lap time
      for (const c of circuits) out.circuits[c] = sim(pc, c, opts.conditions || null, opts.strategy ? { strategy: opts.strategy } : undefined);
      // energy limits re-checked on the sim's own report: a lap over a C5.2.9 / C5.2.10 limit is never scored
      const ev = [].concat(...circuits.map(c => checkEnergy(out.circuits[c], opts.conditions || (physicsSim() && physicsSim().DEFAULT_CONDITIONS))));
      if (ev.length) { out.legal = false; out.violations = violations.concat(ev); out.circuits = {}; out.ms = Date.now() - t0; return out; }
      const lap = out.circuits[scored].lap_s, w = weekend(lap, scored, simKind(sim));
      const extra = Math.max(0, f.mass.total_kg - f.mass.min_kg) * (opts.mass_weight || 0);
      const W = scored === "silverstone" && opts.objective !== "quali" ? weekendModule() : null;
      if (opts.objective === "weekend" && !W) throw new Error("concept bench: objective 'weekend' needs concept/weekend/weekend.js (Silverstone only)");
      if (W) {
        // the weekend model on this lap: the field in the sim's frame (physics) and our car in place of the team's own driver
        const tm = d.team && design.TEAMS && design.TEAMS[d.team], wo = Object.assign({ replace: tm ? tm.driver : undefined }, opts.weekend || {});
        const s = W.scoreLap(lap, Object.assign({ sim_kind: simKind(sim), sim_label: out.circuits[scored].label, team: d.team || null, conditions: opts.conditions || null }, wo));
        out.weekend_model = { weekend_score: s.weekend_score, quali_pos: s.quali.pos, quali_field: s.quali.field_size, gap_to_pole_s: s.quali.gap_to_pole_s, race_pos: s.race.pos, race_field: s.race.field_size, gap_to_winner_s: s.race.gap_to_winner_s, strategy: s.race.strategy.name, fuel_s_per_kg: s.race.pace.fuel_s_per_kg, fuel_basis: s.race.pace.fuel_basis, field: s.field, components: s.components, label: s.label };
        out.objective = "weekend"; out.score = +(s.weekend_score - extra).toFixed(3);
      } else { out.objective = "quali"; out.score = w ? +(w.score - extra).toFixed(3) : null; }
      if (w) w.score = out.objective === "quali" ? out.score : +(w.score - extra).toFixed(3);
      out.weekend = w; out.sim_label = out.circuits[scored].label;
    }
    if (key) { benchCache.set(key, JSON.stringify(out)); if (benchCache.size > CACHE_MAX) benchCache.delete(benchCache.keys().next().value); }
    out.ms = Date.now() - t0;
    return out;
  }

  const api = { LABEL, V0_LABEL, SCORE_LABEL, SCORE_LABEL_V0, V0, PHYSICS_CIRCUITS, game, racepace, activationZones, v0Multipliers, simV0, simPhysics, resolveSim, physicsSim, guardEnergy, cacheStats, clearCache, weekend, bench, profile, zoneDownforce, refCar,
    PU_PARTS, PU_FIELDS, PU_RULE, PHYSICAL_SKIP, homologatedPU, checkPU, checkEnergy, MATERIAL_FIXED_STRUCTURES, materialAllowed, checkMaterials };
  C.bench = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();