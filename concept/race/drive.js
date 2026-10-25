// PURPLE concept race - "Drive it yourself" (time trial) and "Race the grid" (docs/concept/RACE.md "Drive it yourself").
// Pure data for the race page (concept/race/race.js) and the game view (js/conceptrace.js, ?concept=1&drive=trial|grid):
//   drivePayload(replayPayload, opts)  -> the time trial: the player's car (the design's v0 multipliers, as the Game race mode maps
//                                         them) + ghosts on one clock: PURPLE's physics-sim lap (ending at exactly the URL's lap),
//                                         the real 2026 pole lap (OpenF1, ending at exactly 88.111 s) and optionally the RB22 sim lap
//   gridPayload(replayPayload, opts)   -> the wheel-to-wheel race against the game's AI 2026 field (real qualifying order)
//   resultCard(r) / gridResultCard(r)  -> the numbers and words of the result cards (unit-tested: test/concept-race-drive.test.js)
//   gridOrder(q, simLap, replace)      -> the starting order: real 2026 qualifying times + PURPLE placed by its sim lap
//   loadBest / saveBest                -> the visitor's best lap in localStorage (try/catch: private windows have none)
// Dual browser / Node: window.EI.concept.drive and module.exports. Deterministic; no network.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const RP = () => C.race || (typeof require === "function" ? require("./payload.js") : null);

  const TRIAL_LABEL = "game handling model: your lap mixes the car with your driving; the sim lap is the physics lap sim · model prediction";
  const GRID_LABEL = "game race · AI pace scaled to real 2026 qualifying times · your car uses the optimised design's aero and mass; not a prediction of a real race";
  const TRIAL_FOOT = "Drive it yourself: your lap = the game's handling model (Equation I) with the design's aero and mass folded into its grip and drag multipliers (as the Game race mode maps them; power and Straight Mode changes do not reach the game car), timed at the sim's control line in game seconds. Ghosts: PURPLE and RB22 = physics lap sim · model prediction; ANT = real 2026 qualifying · OpenF1 (openf1.org, an independent community project, not associated with Formula 1, the FIA or FOM). A ghost comparison, not a prediction of a real lap.";
  const GRID_FOOT = "Race the grid: " + GRID_LABEL + ". The field = the game's AI drivers at its Official level (each car's pace set from its real 2026 qualifying time, js/data/racepace2026.js), on the game's lap model; contact, tyres and strategy are the game's. Your car replaces Hadjar's RB22 seat.";
  const RUNUP_S = 4;              // the time trial's rolling start: the player starts where PURPLE's sim lap is this many seconds before the line
  const GRID_LAPS = 3;
  const REPLACE = "HAD";          // the seat the player takes in the 2026 field (the RB22 is the design's baseline)
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const f3 = (x) => (x == null || !isFinite(x) ? "—" : (+x).toFixed(3));
  const sg = (x) => (x == null || !isFinite(x) ? "—" : (x < 0 ? "−" : "+") + Math.abs(x).toFixed(3));

  // the time trial. P = the physics-replay payload (payload.js buildPayload), opts = { lap_s (the URL's &lap), pole_s (racepace pole),
  // multipliers (cinematic().multipliers), withRef (default true), name }
  function drivePayload(P, opts) {
    opts = opts || {};
    const R = RP(), errors = [], notes = [], L = P.line.L;
    const src = P.cars.find((c) => c.id === "concept"), ref = P.cars.find((c) => c.id === "ref"), pole = P.cars.find((c) => c.id === "pole");
    if (!src) return { ok: false, errors: ["drive: no PURPLE lap in the payload"] };
    const CH = ["s", "t", "v", "gear", "rpm", "aero", "ers", "L", "design", "num", "team", "sectors_s"];
    const pick = (c) => { const x = {}; for (const k of CH) if (c[k] !== undefined) x[k] = c[k]; return x; };
    // PURPLE's ghost: the sim lap; the engine's lap from the URL is the number the visitor was shown, so the ghost ends there
    let pg = pick(src), simLap = src.lap_s, scaled = false;
    if (typeof opts.lap_s === "number" && isFinite(opts.lap_s) && Math.abs(opts.lap_s - src.lap_s) > 0.0005) {
      pg = R.rescale(pg, L, opts.lap_s); simLap = opts.lap_s; scaled = true;
      notes.push("PURPLE: the re-run sim lap " + f3(src.lap_s) + " s differs from the engine's " + f3(opts.lap_s) + " s; the ghost is time-scaled to the engine's lap");
    }
    const cars = [Object.assign(pg, { id: "concept", kind: "sim", short: "PURPLE · sim", code: "PRPL", color: "#b26cff", lap_s: simLap, source: R.QUALI_SIM + (scaled ? " · time-scaled to the engine's lap" : ""), time_scaled: scaled })];
    let poleLap = null;
    if (pole) {
      poleLap = typeof opts.pole_s === "number" && isFinite(opts.pole_s) ? opts.pole_s : pole.lap_s;
      cars.push(Object.assign(R.rescale(pick(pole), L, poleLap), { id: "pole", kind: "real", short: "ANT · pole", code: "ANT", team: "mercedes", num: 12, color: "#27f4d2", lap_s: poleLap, source: R.QUALI_REAL, time_scaled: false }));
    } else errors.push("drive: the real 2026 pole lap (OpenF1) did not load: no pole ghost");
    if (ref && opts.withRef !== false) cars.push(Object.assign(pick(ref), { id: "ref", kind: "sim", short: "RB22 · sim", code: "RB22", color: "#3671c6", lap_s: ref.lap_s, source: R.QUALI_SIM, time_scaled: false }));
    const mult = opts.multipliers || null;
    const payload = {
      version: 1, mode: "drive", kind: "trial", track: P.track, line: P.line, timing: P.timing, runup_s: RUNUP_S,
      label: "Drive it yourself · time trial · Silverstone", honest: TRIAL_LABEL, foot: TRIAL_FOOT,
      sim_lap_s: simLap, pole_lap_s: poleLap, ref_lap_s: ref ? ref.lap_s : null,
      player: { name: opts.name || "PURPLE", team: "redbull", replace: REPLACE, tyre: "soft", assist: "full", aero: mult, design: src.design || null },
      cars,
    };
    return { ok: errors.length === 0, errors, notes, payload };
  }

  // the race: the real 2026 qualifying order with PURPLE inserted by its sim lap (ties: PURPLE first, as on the demo board); the
  // driver whose seat the player takes is not in the field
  function gridOrder(q, simLap, replace) {
    const rows = Object.keys(q || {}).filter((c) => c !== (replace || REPLACE) && typeof q[c] === "number" && isFinite(q[c])).map((code) => ({ code, s: q[code], kind: "real" }));
    rows.push({ code: "PRPL", s: simLap, kind: "player" });
    rows.sort((a, b) => a.s - b.s || (a.kind === "player" ? -1 : b.kind === "player" ? 1 : 0));
    rows.forEach((r, i) => { r.pos = i + 1; });
    return rows;
  }
  function gridPayload(P, opts) {
    opts = opts || {};
    const src = P.cars.find((c) => c.id === "concept");
    if (!src) return { ok: false, errors: ["race the grid: no PURPLE lap in the payload"] };
    const simLap = typeof opts.lap_s === "number" && isFinite(opts.lap_s) ? opts.lap_s : src.lap_s;
    const q = opts.q || {};
    if (!Object.keys(q).length) return { ok: false, errors: ["race the grid: js/data/racepace2026.js (real 2026 qualifying times) not loaded"] };
    const order = gridOrder(q, simLap, REPLACE), me = order.find((r) => r.code === "PRPL");
    return { ok: true, errors: [], notes: [], payload: {
      version: 1, mode: "drive", kind: "grid", track: P.track, laps: opts.laps || GRID_LAPS, difficulty: "official", seed: opts.seed || 2026,
      label: "Race the grid · " + (opts.laps || GRID_LAPS) + " laps · Silverstone", honest: GRID_LABEL, foot: GRID_FOOT,
      sim_lap_s: simLap, grid_order: order.map((r) => r.code), grid_note: "grid: real 2026 British GP qualifying order; PURPLE placed by its sim lap (" + f3(simLap) + " s) at P" + me.pos,
      player: { name: opts.name || "PURPLE", team: "redbull", replace: REPLACE, tyre: "medium", assist: "full", aero: opts.multipliers || null, design: src.design || null },
    } };
  }

  // the time trial's result card. r = { lap_s, deleted, sim_lap_s, pole_lap_s, ref_lap_s, best_s, prev_best_s }
  function resultCard(r) {
    const lap = r3(r.lap_s), sim = r.sim_lap_s == null ? null : r3(r.sim_lap_s), pole = r.pole_lap_s == null ? null : r3(r.pole_lap_s);
    const parts = ["your lap " + f3(lap) + " s" + (r.deleted ? " (track limits)" : ""), "physics sim of this car " + f3(sim) + " s"];
    if (pole != null) parts.push("real pole " + f3(pole) + " s");
    const rows = [
      { key: "you", k: "your lap · game seconds", v: f3(lap) + " s", d: null, src: "game handling model" + (r.deleted ? " · off the track: not a best" : "") },
      { key: "sim", k: "physics sim of this car", v: f3(sim) + " s", d: sim == null ? null : r3(lap - sim), src: "physics lap sim · model prediction" },
    ];
    if (pole != null) rows.push({ key: "pole", k: "real pole · ANT 2026", v: f3(pole) + " s", d: r3(lap - pole), src: "real 2026 qualifying · OpenF1" });
    if (r.ref_lap_s != null) rows.push({ key: "ref", k: "RB22 baseline · sim", v: f3(r.ref_lap_s) + " s", d: r3(lap - r.ref_lap_s), src: "physics lap sim · model prediction" });
    const pb = !r.deleted && (r.prev_best_s == null || lap < r.prev_best_s);
    return { headline: parts.join(" · "), lap, sim, pole, rows, personal_best: pb, best_s: r.best_s == null ? null : r3(r.best_s), label: TRIAL_LABEL,
      delta_text: rows.slice(1).map((x) => sg(x.d) + " vs " + x.k.split(" · ")[0]).join(" · ") };
  }
  // the race's result card. r = { position, field, laps[], best_lap, finished, penalty_s, sim_lap_s }
  function gridResultCard(r) {
    const laps = (r.laps || []).map(r3), best = r.best_lap > 0 ? r3(r.best_lap) : null;
    const head = (r.finished ? "P" + r.position + " of " + r.field : "running P" + r.position + " of " + r.field) + " · best lap " + f3(best) + " s" + (r.penalty_s ? " · +" + r.penalty_s + " s penalties" : "");
    return { headline: head, position: r.position, field: r.field, laps, best, lap_text: laps.map((x, i) => "L" + (i + 1) + " " + f3(x)).join(" · "), label: GRID_LABEL };
  }

  // the visitor's best lap for one design, in localStorage (per browser; try/catch: storage may be missing or blocked)
  function bestKey(design, lap_s) { return "purple-drive-best:" + ((design && design.id) || "design") + ":" + (lap_s == null ? "" : (+lap_s).toFixed(3)); }
  function loadBest(store, key) { try { const v = parseFloat((store || root.localStorage).getItem(key)); return isFinite(v) && v > 0 ? v : null; } catch (e) { return null; } }
  function saveBest(store, key, lap) { try { (store || root.localStorage).setItem(key, String(r3(lap))); return true; } catch (e) { return false; } }

  const api = { TRIAL_LABEL, GRID_LABEL, TRIAL_FOOT, GRID_FOOT, RUNUP_S, GRID_LAPS, REPLACE, drivePayload, gridPayload, gridOrder, resultCard, gridResultCard, bestKey, loadBest, saveBest };
  C.drive = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
