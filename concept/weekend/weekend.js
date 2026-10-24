// PURPLE CONCEPT - the race weekend model at Silverstone. Turns a car's lap simulation into a full weekend outcome against the real
// 2026 British GP field: qualifying (our lap inserted among the real 2026 qualifying laps) and a 52-lap race (deterministic lap-by-lap
// race-pace model: fuel burn, tyre degradation per compound with a cliff, one- or two-stop strategy by minimum total time, the
// Silverstone pit-lane loss, a first-lap spread by grid slot and a dirty-air penalty within 1 s), and the single "weekend score" the
// optimiser maximises. Competitors run the same fuel/tyre model on their own real race pace (EI.RACEPACE.silverstone r), so the
// model is relative and calibrated to the real field. A reduced-order model: no flow is solved, no car is "simulated" beyond the
// pluggable lap sim. docs/concept/WEEKEND.md documents every parameter (source or "assumption") and the calibration.
// The lap sim is pluggable: sim(physicalCar, trackId, conditions) -> { lap_s, label, ... } (concept/bench.js contract), or "physics"
// / "v0" / "auto". Default "auto": the concept/sim/ physics lap sim (bench.simPhysics) when it is loaded, else bench.simV0.
// With the physics sim (WEEKEND.md §6): the fuel effect is the physics sim's own fuel-mass slope on the anchor car, applied to every
// car (so the field calibration stays consistent), and the real qualifying field is placed in the sim's frame through the fitted
// team cars (concept/sim fitted(): each real lap moves by its team's fit residual, ≤ 0.05 s), so our sim lap is compared with laps
// in the same model. scoreLap(lap_s, opts) scores a lap the bench already ran (no second sim call).
// Dual browser / Node: window.EI.concept.weekend and module.exports. Pure and deterministic.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const VERSION = "concept weekend model v0";
  const DATA_LABEL = "real 2026 British GP lap data";
  const CIRCUIT = "silverstone";

  // ---- parameters. Every entry: value, status (official | reported | derived | assumption), basis. WEEKEND.md repeats them.
  const PARAMS = {
    laps: { value: 52, status: "official", basis: "2026 British GP race distance, 52 laps (formula1.com circuit page; FIA final race classification). Read from concept/data/silverstone-2026-weekend.json circuit.race_laps when that file is present" },
    pit_loss_s: { value: 20.0, status: "reported", basis: "formula1.com 'Need to know … ahead of the 2026 British Grand Prix': 'Pit stop time loss – 20 seconds (includes 2.5s stop)' (2025 preview: 19.9 s). A pre-event estimate, not measured in this race" },
    quali_fuel_kg: { value: 8, status: "assumption", basis: "qualifying fuel load: the physics lap sim's assumption (concept/sim priorCar fuel_kg 8; concept/physical.js uses the anchor car's); the sim's quali lap and the real q laps are taken to be at this load" },
    start_fuel_kg: { value: 70, status: "assumption", basis: "race start fuel. 2026 cars are widely reported to carry ≈ 70 kg of fuel (down from ≈ 100–110 kg); not in Section C" },
    end_fuel_kg: { value: 1, status: "assumption", basis: "fuel left at the flag (sample for the FIA); burn per lap = (start − end) / laps, constant" },
    fuel_s_per_kg: { value: 0.03, status: "assumption", basis: "lap-time cost of fuel mass, ≈ 0.03 s/kg, the common rule of thumb (CONCEPT.md quotes it; sim v0 itself charges ≈ 0.013 s/kg). Used for every car unless fuel: 'sim'" },
    compounds: {
      value: {
        soft: { tyre: "C3", offset_s: 0, deg_s_per_lap: 0.09, cliff_lap: 20, cliff_s_per_lap: 0.4 },
        medium: { tyre: "C2", offset_s: 0.35, deg_s_per_lap: 0.035, cliff_lap: 33, cliff_s_per_lap: 0.4 },
        hard: { tyre: "C1", offset_s: 0.65, deg_s_per_lap: 0.025, cliff_lap: 45, cliff_s_per_lap: 0.4 },
      },
      status: "assumption",
      basis: "compound names official (Pirelli C1/C2/C3 for Silverstone 2026); pace offsets vs a new soft, linear degradation (s per lap of tyre age), cliff lap and post-cliff slope are assumptions, chosen so that (a) a one-stop on C3 + C2 is fastest, as Pirelli expected for Silverstone 2026 ('one-stop … C2 and C3 the main choices', formula1.com 2026 preview), with the medium-hard one-stop close behind and the best two-stop clearly slower (≈ 8 s; Pirelli's 2023 Silverstone estimate was one-stop ≈ 13 s faster), (b) no optimal stint runs into its cliff, and (c) the fuel + tyre excess at the median race lap stays a minority of the real field's race-vs-quali gap (WEEKEND.md §4)",
    },
    two_compound_rule: { value: true, status: "reported", basis: "a dry race must use at least two different dry compounds (long-standing Sporting Regulations rule; the 2026 article was not read here)" },
    start_lap_extra_s: { value: 4.0, status: "assumption", basis: "extra time of the standing-start lap 1 over a flying lap at the same fuel/tyres; the same for every car, so it shifts total times, never positions" },
    grid_spread_s_per_slot: { value: 0.5, status: "assumption", basis: "first-lap model: grid order is kept through lap 1 and the field ends lap 1 spread by 0.5 s per grid slot (typical dry-start lap-1 gaps); pace differences on lap 1 still apply. No start-reaction or lap-1 incident model" },
    dirty_air_gap_s: { value: 1.0, status: "official", basis: "1 s: the 2026 overtake-mode detection gap (silverstone-2026-weekend.json overtake_mode.detection_gap_s, B7.2); used as the 'close following' threshold" },
    dirty_air_s: { value: 0.25, status: "assumption", basis: "per-lap time lost by a car starting a lap within 1 s of the car ahead (dirty air, net of the follower's overtake-mode energy). No other overtaking model: a car passes when its cumulative time drops below the car ahead's" },
    max_stops: { value: 2, status: "assumption", basis: "strategies searched: every one-stop and two-stop compound sequence and pit lap. Three-stops are not searched (no SC, deg too low to pay a 3rd pit loss)" },
    min_stint_laps: { value: 5, status: "assumption", basis: "shortest stint the strategy search considers" },
    weights: { value: { quali: 0.4, race: 0.6 }, status: "assumption", basis: "weekend score weights: the race counts more than qualifying (both terms in seconds per lap)" },
  };
  const DEF = {}; for (const k of Object.keys(PARAMS)) DEF[k] = PARAMS[k].value;

  const r3 = v => Math.round(v * 1000) / 1000;
  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

  // ---- data: the real 2026 lap data (EI.RACEPACE, read-only through bench.racepace's sandbox) and the optional weekend facts file
  function bench() { const b = req("bench", "../bench.js"); if (!b) throw new Error("concept weekend: concept/bench.js is not loaded"); return b; }
  function racepace() { const RP = bench().racepace()[CIRCUIT]; if (!RP || !RP.q || !RP.r) throw new Error("concept weekend: no EI.RACEPACE." + CIRCUIT); return RP; }
  let factsCache;
  function weekendData() {
    if (factsCache !== undefined) return factsCache;
    if (C.weekendData) return (factsCache = C.weekendData);
    factsCache = null;
    if (typeof require === "function") {
      try {
        const fs = require("fs"), path = require("path"), f = path.join(__dirname, "..", "data", "silverstone-2026-weekend.json");
        if (fs.existsSync(f)) factsCache = JSON.parse(fs.readFileSync(f, "utf8"));
      } catch (e) { factsCache = null; }
    }
    return factsCache;
  }
  // parameters = defaults < facts file (race laps, compound letters) < caller's opts.params
  function params(over) {
    const p = JSON.parse(JSON.stringify(DEF)), d = weekendData(), from = {};
    if (d) {
      const laps = d.circuit && d.circuit.race_laps && d.circuit.race_laps.value;
      if (laps > 0) { p.laps = laps; from.laps = "silverstone-2026-weekend.json circuit.race_laps"; }
      const tc = d.tyres && d.tyres.compounds;
      if (tc) for (const c of Object.keys(p.compounds)) if (tc[c]) p.compounds[c].tyre = tc[c];
      const pit = d.race && d.race.pit_loss_s && d.race.pit_loss_s.value;
      if (pit > 0) { p.pit_loss_s = pit; from.pit_loss_s = "silverstone-2026-weekend.json race.pit_loss_s"; }
    }
    if (over) for (const k of Object.keys(over)) {
      if (k === "compounds") for (const c of Object.keys(over.compounds)) p.compounds[c] = Object.assign({}, p.compounds[c] || {}, over.compounds[c]);
      else p[k] = over[k];
    }
    p._from = from;
    return p;
  }

  // ---- the lap sim. o.sim: a function, "physics", "v0" or "auto" (default: physics when concept/sim/ is loaded). o.sim_kind names
  // the sim that ran a lap passed in as { lap_s } (scoreLap); a bare { lap_s } with neither is a "given" lap (real field, coefficient).
  function simOf(o) { return bench().resolveSim(o && o.sim); }
  function kindOf(car, o) {
    if (o && o.sim_kind) return o.sim_kind;
    const given = typeof car === "number" || (car && typeof car.lap_s === "number" && !car.aero);
    if (given && !(o && o.sim)) return "given";
    return simOf(o).kind || "custom";
  }
  // the physics sim's fuel-mass slope (s/kg) on the anchor car (concept/physical.js anchor(team)): lap at start fuel vs quali fuel.
  // Two sim laps, cached per team and conditions; applied to every car so the field calibration stays consistent.
  const slopeCache = {};
  function physicsFuelSlope(team, conditions, p) {
    const key = (team || "generic") + "|" + JSON.stringify(conditions || null) + "|" + p.quali_fuel_kg + "|" + p.start_fuel_kg;
    if (slopeCache[key] != null) return slopeCache[key];
    const B = bench(), ph = req("physical", "../physical.js"), car = ph.anchor(team || null);
    if (!car || !B.physicsSim()) return null;
    const lap = f => B.simPhysics(Object.assign({}, car, { fuel_kg: f }), CIRCUIT, conditions || null).lap_s;
    return (slopeCache[key] = +((lap(p.start_fuel_kg) - lap(p.quali_fuel_kg)) / (p.start_fuel_kg - p.quali_fuel_kg)).toFixed(5));
  }
  // the qualifying field's frame. "real": the real 2026 laps. "sim": each real lap moved by its team's residual in the physics sim's
  // team fit (q_sim − q_real of the fitted driver, applied to both team drivers; concept/sim fitted().teams), so the field and our
  // sim lap sit in the same model. Default: "sim" when the physics sim ran the lap, else "real".
  let seasonCache;
  function season() {
    if (EI.SEASON) return EI.SEASON;
    if (seasonCache !== undefined) return seasonCache;
    seasonCache = null;
    if (typeof require === "function") {
      try {
        const fs = require("fs"), path = require("path"), vm = require("vm"), sb = {}; sb.window = sb;
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "js", "data", "season2026.js"), "utf8"), sb, { filename: "js/data/season2026.js" });
        seasonCache = sb.EI.SEASON || null;
      } catch (e) { seasonCache = null; }
    }
    return seasonCache;
  }
  let shiftCache;
  function simFieldShift() {
    if (shiftCache !== undefined) return shiftCache;
    shiftCache = null;
    const S = bench().physicsSim(), F = S && S.fitted ? S.fitted() : null, SE = season();
    if (!F || !F.teams || !SE || !SE.teams) return null;
    const out = {};
    for (const t of F.teams) {
      const st = SE.teams.find(x => x.id === t.team), d = +(t.q_sim_s - t.q_real_s).toFixed(3);
      for (const code of (st && st.drivers) || [t.driver]) out[code] = { shift_s: d, team: t.team, fitted_driver: t.driver };
    }
    return (shiftCache = out);
  }
  // options for one weekend: the field frame and, with the physics sim, its fuel slope for every car (into o.params so that the
  // calibration sees it too)
  function prepare(car, o) {
    o = Object.assign({}, o || {}); const kind = kindOf(car, o);
    const base = params(withLaps(o));
    o.field = o.field || (kind === "physics" && simFieldShift() ? "sim" : "real");
    if (kind === "physics" && o.fuel !== "coefficient" && o.fuel !== "sim" && !(o.params && o.params.fuel_s_per_kg != null)) {
      const slope = physicsFuelSlope(o.team || (car && car.team) || null, o.conditions || null, base);
      if (slope != null) { o.params = Object.assign({}, o.params || {}, { fuel_s_per_kg: slope }); o.fuel_basis = "physics sim (anchor car, every car)"; }
    }
    o.sim_kind = kind;
    return o;
  }

  // ---- the car -> our sim laps. car: a PhysicalCar, a Design (converted with concept/physical.js), or { lap_s } (a lap already run)
  function toPhysical(car) {
    if (car && car.aero && car.pu && car.tyres) return car;
    if (car && car.params) return req("physical", "../physical.js").physical(car, { session: "qualifying" });
    return null;
  }
  function carLaps(car, o, p) {
    if (typeof car === "number") car = { lap_s: car };
    const basis0 = o.fuel_basis || "coefficient";
    if (car && typeof car.lap_s === "number" && !car.aero) {
      return { quali_lap_s: car.lap_s, fuel_s_per_kg: p.fuel_s_per_kg, fuel_basis: basis0, sim_label: car.label || o.sim_label || "given lap" };
    }
    const pc = toPhysical(car); if (!pc) throw new Error("concept weekend: car must be a PhysicalCar, a Design or { lap_s }");
    const sim = simOf(o), cond = o.conditions || null;
    const q = sim(Object.assign({}, pc, { fuel_kg: p.quali_fuel_kg, tyres: Object.assign({}, pc.tyres, { compound: "soft" }) }), CIRCUIT, cond);
    if (!q || !(q.lap_s > 0)) throw new Error("concept weekend: the sim returned no lap");
    let slope = p.fuel_s_per_kg, basis = basis0;
    if (o.fuel === "sim") {   // the sim's own fuel-mass sensitivity for THIS car: lap at start fuel vs quali fuel (our car only)
      const full = sim(Object.assign({}, pc, { fuel_kg: p.start_fuel_kg, tyres: Object.assign({}, pc.tyres, { compound: "soft" }) }), CIRCUIT, cond);
      slope = (full.lap_s - q.lap_s) / (p.start_fuel_kg - p.quali_fuel_kg); basis = "sim";
    }
    return { quali_lap_s: q.lap_s, fuel_s_per_kg: slope, fuel_basis: basis, sim_label: q.label || "sim", sim_result: q };
  }

  // ---- qualifying: our lap among the real 2026 qualifying laps (best lap per driver across Q1-Q3, as concept/bench.js weekend()),
  // in the frame o.field ("real" | "sim", see simFieldShift)
  function realQuali(o) {
    const RP = racepace(), ex = new Set([].concat(o && o.replace || [])), sh = o && o.field === "sim" ? simFieldShift() || {} : {};
    return Object.keys(RP.q).filter(c => RP.q[c] > 0 && !ex.has(c)).map(c => ({ code: c, lap_s: r3(RP.q[c] + (sh[c] ? sh[c].shift_s : 0)), real_s: RP.q[c] })).sort((a, b) => a.lap_s - b.lap_s || (a.code < b.code ? -1 : 1));
  }
  function qualiFrom(lap, o) {
    const field = realQuali(o), best = field[0];
    const pos = 1 + field.filter(x => x.lap_s < lap - 1e-9).length;   // a tie goes to our car, as in bench.weekend()
    const grid = field.slice(); grid.splice(pos - 1, 0, { code: "CONCEPT", lap_s: lap });
    return { lap_s: r3(lap), pos, field_size: grid.length, pole_s: best.lap_s, pole_code: best.code, gap_to_pole_s: r3(lap - best.lap_s), field: (o && o.field) || "real", grid: grid.map((g, i) => ({ pos: i + 1, code: g.code, lap_s: g.lap_s, real_s: g.real_s })) };
  }
  function qualifying(car, o) {
    o = prepare(car, o); const p = params(withLaps(o)), L = carLaps(car, o, p), q = qualiFrom(L.quali_lap_s, o);
    q.label = label(L.sim_label); return q;
  }

  // ---- tyre / fuel model. Time over the reference condition (quali fuel, new soft), per lap.
  function fuelAt(p, lap) { const burn = (p.start_fuel_kg - p.end_fuel_kg) / p.laps; return p.start_fuel_kg - burn * (lap - 0.5); }   // mean fuel over lap `lap` (1-based)
  function tyreLoss(cp, age) { return cp.offset_s + cp.deg_s_per_lap * age + (age > cp.cliff_lap ? cp.cliff_s_per_lap * (age - cp.cliff_lap) : 0); }   // age 0 = first lap on the set
  function stintCost(cp, len) { let s = 0; for (let a = 0; a < len; a++) s += tyreLoss(cp, a); return s; }

  // strategy search: every compound sequence with 1..max_stops stops (two-compound rule) and every pit lap; minimum tyre time + pit
  // losses. Fuel is strategy-independent, and every car shares the tyre model, so the optimum is the same for every car.
  const stratCache = {};
  function strategies(p) {
    const key = JSON.stringify([p.laps, p.pit_loss_s, p.compounds, p.max_stops, p.min_stint_laps, p.two_compound_rule]);
    if (stratCache[key]) return stratCache[key];
    const names = Object.keys(p.compounds), N = p.laps, m = p.min_stint_laps;
    const cost = {}; for (const c of names) { cost[c] = [0]; for (let len = 1; len <= N; len++) cost[c][len] = cost[c][len - 1] + tyreLoss(p.compounds[c], len - 1); }
    const best = {};   // best per stop count
    const consider = (seq, lens) => {
      if (p.two_compound_rule && new Set(seq).size < 2) return;
      let t = (seq.length - 1) * p.pit_loss_s; for (let i = 0; i < seq.length; i++) t += cost[seq[i]][lens[i]];
      const k = seq.length - 1;
      if (!best[k] || t < best[k].tyre_and_pit_s - 1e-9) best[k] = { stops: k, stints: seq.map((c, i) => ({ compound: c, tyre: p.compounds[c].tyre, laps: lens[i] })), tyre_and_pit_s: t };
    };
    const seqs = (n) => { let out = [[]]; for (let i = 0; i < n; i++) { const nx = []; for (const s of out) for (const c of names) nx.push(s.concat(c)); out = nx; } return out; };
    for (let stops = 0; stops <= p.max_stops; stops++) {
      for (const seq of seqs(stops + 1)) {
        if (stops === 0) { consider(seq, [N]); continue; }
        if (stops === 1) { for (let a = m; a <= N - m; a++) consider(seq, [a, N - a]); continue; }
        for (let a = m; a <= N - 2 * m; a++) for (let b = m; b <= N - a - m; b++) consider(seq, [a, b, N - a - b]);
      }
    }
    const list = Object.values(best).sort((x, y) => x.tyre_and_pit_s - y.tyre_and_pit_s);
    for (const s of list) { s.tyre_and_pit_s = r3(s.tyre_and_pit_s); s.pit_laps = []; let l = 0; for (let i = 0; i < s.stints.length - 1; i++) { l += s.stints[i].laps; s.pit_laps.push(l); } s.delta_to_best_s = r3(s.tyre_and_pit_s - list[0].tyre_and_pit_s); s.name = s.stops + "-stop " + s.stints.map(x => x.compound[0].toUpperCase() + x.laps).join("-"); }
    return (stratCache[key] = { best: list[0], by_stops: list });
  }

  // the lap-by-lap "excess" over the reference condition for a strategy: fuel + compound + degradation (no pit, no lap-1 extra)
  function excess(p, strat, fuelSlope) {
    const out = [], pit = new Set(), N = p.laps; let lap = 0;
    strat.stints.forEach((s, i) => { for (let a = 0; a < s.laps; a++) { lap++; out.push({ lap, compound: s.compound, age: a, e: fuelSlope * (fuelAt(p, lap) - p.quali_fuel_kg) + tyreLoss(p.compounds[s.compound], a) }); } if (i < strat.stints.length - 1) pit.add(lap); });
    if (lap !== N) throw new Error("concept weekend: strategy covers " + lap + " of " + N + " laps");
    return { laps: out, pit };
  }
  // green-flag laps for the medians: not lap 1, not an in-lap, not an out-lap (the pit loss sits on the in-lap here; the out-lap is
  // excluded anyway, as the real medians are of green-flag laps that also drop pit laps)
  function greenLaps(ex) { return ex.laps.filter(l => l.lap > 1 && !ex.pit.has(l.lap) && !ex.pit.has(l.lap - 1)); }

  // calibration against the real field: race-mode offset = (r − q) − median model excess. r: median green-flag race lap; q: best quali lap
  const calCache = {};
  function calibration(o) {
    o = o || {}; const p = params(o.params), key = JSON.stringify(p) + JSON.stringify(o.replace || []);
    if (calCache[key]) return calCache[key];
    const RP = racepace(), st = strategies(p), ex = excess(p, st.best, p.fuel_s_per_kg), green = greenLaps(ex).map(l => l.e);
    const eMed = median(green), eMin = Math.min.apply(null, green);
    const fuelMed = median(greenLaps(ex).map(l => p.fuel_s_per_kg * (fuelAt(p, l.lap) - p.quali_fuel_kg)));
    const ex2 = new Set([].concat(o.replace || []));
    const rows = Object.keys(RP.r).filter(c => RP.q[c] > 0 && RP.r[c] > 0 && !ex2.has(c)).map(c => ({ code: c, q: RP.q[c], r: RP.r[c], fastest: RP.fastestLap && RP.fastestLap[c] || null, r_minus_q: r3(RP.r[c] - RP.q[c]), race_mode_offset_s: r3(RP.r[c] - RP.q[c] - eMed) }));
    const gaps = rows.map(x => x.r_minus_q), rmo = median(rows.map(x => x.race_mode_offset_s));
    const fl = rows.filter(x => x.fastest).map(x => x.r - x.fastest);
    const gMed = median(gaps), mae = rows.reduce((s, x) => s + Math.abs(x.r_minus_q - gMed), 0) / rows.length;
    for (const x of rows) { x.model_r_s = r3(x.q + gMed); x.residual_s = r3(x.r - x.model_r_s); }
    const sorted = gaps.slice().sort((a, b) => a - b), qt = f => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))];
    const out = {
      strategy: st.best.name, by_stops: st.by_stops.map(s => ({ name: s.name, delta_to_best_s: s.delta_to_best_s })),
      field: { n: rows.length, r_minus_q_median_s: r3(median(gaps)), r_minus_q_p10_s: r3(qt(0.1)), r_minus_q_p90_s: r3(qt(0.9)), r_minus_q_min_s: r3(sorted[0]), r_minus_q_max_s: r3(sorted[sorted.length - 1]), r_minus_fastest_median_s: r3(median(fl)), r_from_q_mae_s: r3(mae) },
      model: { excess_median_s: r3(eMed), fuel_median_s: r3(fuelMed), tyre_median_s: r3(eMed - fuelMed), excess_min_s: r3(eMin), median_minus_fastest_s: r3(eMed - eMin), race_mode_offset_s: r3(rmo) },
      rows: rows.sort((a, b) => a.r - b.r),
      note: "race_mode_offset = field-median (r − q) − model median excess: everything the fuel/tyre model does not explain (2026 race energy management, tyre-saving pace, engine modes, traffic in the real medians). Our car gets the field median; each real driver keeps their own (their real r).",
    };
    return (calCache[key] = out);
  }

  // ---- the race. Deterministic: same inputs -> same output. seed only matters with opts.noise_s > 0 (seeded per-lap noise).
  function raceFrom(L, o, p) {
    const RP = racepace(), cal = calibration(o), st = strategies(p);
    const ourStrat = o.strategy ? resolveStrategy(o.strategy, p, st) : st.best;
    const exField = excess(p, st.best, p.fuel_s_per_kg);
    const eMedField = cal.model.excess_median_s;
    const exUs = excess(p, ourStrat, L.fuel_s_per_kg);
    // our car: quali lap + the field's median race-mode offset + our excess; each real driver: r − median excess + excess (= their r
    // at their median lap). In "sim" fuel mode only our fuel slope changes; the offset stays the field's.
    const q = qualiFrom(L.quali_lap_s, o);
    const cars = q.grid.map(g => {
      if (g.code === "CONCEPT") return { code: g.code, grid: g.pos, base: L.quali_lap_s + cal.model.race_mode_offset_s, ex: exUs, strat: ourStrat, us: true };
      return { code: g.code, grid: g.pos, base: RP.r[g.code] - eMedField, ex: exField, strat: st.best, us: false };
    }).filter(c => c.us || RP.r[c.code] > 0);
    const noise = o.noise_s || 0, rng = noise > 0 ? req("design", "../design.js").seededRng(o.seed == null ? 1 : o.seed) : null;
    const gauss = noise > 0 ? req("design", "../design.js").gauss : null;
    for (const c of cars) { c.cum = 0; c.laps = []; c.dirty_laps = 0; }
    for (let lap = 1; lap <= p.laps; lap++) {
      const order = cars.slice().sort((a, b) => a.cum - b.cum || a.grid - b.grid);
      for (let i = 0; i < order.length; i++) {
        const c = order[i], e = c.ex.laps[lap - 1];
        let t = c.base + e.e;
        if (lap === 1) t += p.start_lap_extra_s + p.grid_spread_s_per_slot * (c.grid - 1);
        else if (i > 0 && c.cum - order[i - 1].cum < p.dirty_air_gap_s) { t += p.dirty_air_s; c.dirty_laps++; }
        if (c.ex.pit.has(lap)) t += p.pit_loss_s;
        if (rng) t += noise * gauss(rng);
        c.laps.push(t);
      }
      for (const c of cars) c.cum += c.laps[lap - 1];
    }
    const cls = cars.slice().sort((a, b) => a.cum - b.cum || a.grid - b.grid);
    const winner = cls[0], us = cars.find(c => c.us), bestOther = cls.find(c => !c.us);
    const pos = cls.indexOf(us) + 1;
    return {
      total_s: r3(us.cum), pos, field_size: cls.length, grid: us.grid,
      gap_to_winner_s: r3(us.cum - winner.cum), gap_to_best_other_s: r3(us.cum - bestOther.cum), best_other: bestOther.code,
      winner: winner.code,
      strategy: { name: ourStrat.name, stops: ourStrat.stops, stints: ourStrat.stints, pit_laps: ourStrat.pit_laps, chosen_by: o.strategy ? "forced (opts.strategy)" : "minimum total time (clean air)", alternatives: st.by_stops.map(s => ({ name: s.name, stops: s.stops, delta_to_best_s: s.delta_to_best_s })) },
      pace: { race_lap_median_s: r3(L.quali_lap_s + cal.model.race_mode_offset_s + median(greenLaps(exUs).map(l => l.e))), race_mode_offset_s: cal.model.race_mode_offset_s, fuel_s_per_kg: +L.fuel_s_per_kg.toFixed(5), fuel_basis: L.fuel_basis, dirty_air_laps: us.dirty_laps, fastest_lap_s: r3(Math.min.apply(null, us.laps.slice(1).filter((t, i) => !us.ex.pit.has(i + 2)))) },
      classification: cls.map((c, i) => ({ pos: i + 1, code: c.code, grid: c.grid, total_s: r3(c.cum), gap_s: r3(c.cum - winner.cum) })),
      quali_pos: q.pos,
    };
  }
  function resolveStrategy(s, p, st) {
    if (typeof s === "number") { const f = st.by_stops.find(x => x.stops === s); if (!f) throw new Error("concept weekend: no " + s + "-stop strategy"); return f; }
    const stints = s.stints || s; const lens = stints.map(x => x.laps);
    const out = { stops: stints.length - 1, stints: stints.map(x => ({ compound: x.compound, tyre: p.compounds[x.compound].tyre, laps: x.laps })), pit_laps: [] };
    let l = 0; for (let i = 0; i < lens.length - 1; i++) { l += lens[i]; out.pit_laps.push(l); }
    out.name = out.stops + "-stop " + out.stints.map(x => x.compound[0].toUpperCase() + x.laps).join("-") + " (forced)";
    return out;
  }
  const withLaps = o => Object.assign({}, o.params, o.laps ? { laps: o.laps } : {});
  function race(car, o) {
    o = prepare(car, o); const po = withLaps(o), p = params(po), L = carLaps(car, o, p);
    const r = raceFrom(L, Object.assign({}, o, { params: po }), p);
    r.label = label(L.sim_label); return r;
  }

  // ---- the weekend score (seconds per lap; + = beating every real 2026 car):
  //   weekend_score = w_q · (best real quali lap − our quali lap) + w_r · (best real race total − our race total) / laps
  // with w_q = 0.4, w_r = 0.6. The race term uses the best real competitor's total in OUR simulated race (traffic included).
  function score(car, o) {
    const t0 = Date.now(); o = prepare(car, o);
    const po = withLaps(o), p = params(po), L = carLaps(car, o, p);
    const oo = Object.assign({}, o, { params: po });
    const q = qualiFrom(L.quali_lap_s, oo), r = raceFrom(L, oo, p), w = p.weights;
    const qm = -q.gap_to_pole_s, rm = -r.gap_to_best_other_s / p.laps;
    const ws = r3(w.quali * qm + w.race * rm);
    const lab = label(L.sim_label);
    return {
      quali: { lap_s: q.lap_s, pos: q.pos, field_size: q.field_size, gap_to_pole_s: q.gap_to_pole_s, pole_code: q.pole_code, pole_s: q.pole_s, grid: q.grid },
      field: { frame: q.field, replaced: [].concat(o.replace || []), sim: o.sim_kind, fuel_s_per_kg: +L.fuel_s_per_kg.toFixed(5), fuel_basis: L.fuel_basis, note: q.field === "sim" ? "real 2026 qualifying laps moved by their team's fit residual in the physics sim (concept/sim fitted().teams, ≤ 0.05 s)" : "real 2026 qualifying laps" },
      race: { total_s: r.total_s, pos: r.pos, field_size: r.field_size, grid: r.grid, gap_to_winner_s: r.gap_to_winner_s, gap_to_best_other_s: r.gap_to_best_other_s, winner: r.winner, strategy: r.strategy, pace: r.pace, classification: r.classification },
      weekend_score: ws,
      components: { quali_margin_s: r3(qm), race_margin_s_per_lap: r3(rm), weights: w, definition: "weekend_score = " + w.quali + " × (best real 2026 quali lap − our quali lap) + " + w.race + " × (best real competitor's race time − our race time) / " + p.laps + " laps; seconds per lap, positive = beating every real 2026 car" },
      params_from: Object.assign({ defaults: "concept/weekend/weekend.js PARAMS" }, p._from),
      label: lab, ms: Date.now() - t0,
    };
  }
  function label(simLabel) { return "concept weekend model · " + simLabel + " · " + DATA_LABEL; }
  // a lap the bench already ran: opts.sim_kind ("physics" | "v0" | ...) and opts.sim_label say which sim made it
  function scoreLap(lap_s, o) { o = o || {}; return score({ lap_s, label: o.sim_label }, o); }

  const api = { VERSION, PARAMS, params, strategies, calibration, qualifying, race, score, scoreLap, physicsFuelSlope, simFieldShift, tyreLoss, fuelAt, weekendData, label };
  C.weekend = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
