// PURPLE CONCEPT - the concept race page's data (docs/concept/RACE.md): a Design -> the physics lap sim's own lap (distance -> time,
// speed, gear, aero mode, ERS state) for the concept car and the reference team's baseline car, plus the real 2026 pole lap
// (OpenF1 telemetry), packed for js/conceptrace.js (the game-side physics replay). Also the URL contract and the cinematic
// (game lap model) links. Uses only public APIs: design.validate / design.baseline, bench.bench / bench.guardEnergy /
// bench.v0Multipliers, conceptSim.simulateLap / baselineCar / buildTrack. Deterministic; no network (the telemetry JSON is passed in).
// Dual browser / Node: window.EI.concept.race and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);

  const TRACK = "silverstone";
  const POLE_SOURCE = "real 2026 qualifying telemetry · OpenF1";
  const CINEMATIC_LABEL = "cinematic — game lap model, mixes car and driver";
  const TELEMETRY_PATH = "concept/data/telemetry/silverstone-2026-q-ant.json";   // repo-relative
  const REF_NAMES = { redbull: { name: "RB22 · Red Bull baseline", short: "RB22", team: "redbull", num: 6 }, generic: { name: "Generic 2026 baseline", short: "BASE", team: "williams", num: 98 } };

  // ---- URL contract: /concept/race/?design=<base64url JSON Design>&ref=redbull[&conditions=<base64url JSON>][&wind_ms=3&wind_from_deg=105][&mode=replay|quali|race|grid][&lap=87.700][&rate=1]
  function b64encode(str) {
    if (typeof Buffer !== "undefined" && typeof btoa !== "function") return Buffer.from(str, "utf8").toString("base64");
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(b) {
    if (typeof Buffer !== "undefined" && typeof atob !== "function") return Buffer.from(b, "base64").toString("utf8");
    const raw = atob(b); try { return decodeURIComponent(escape(raw)); } catch (e) { return raw; }
  }
  const toUrl = s => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromUrl = s => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return s; };
  function encodeParam(obj) { return toUrl(b64encode(JSON.stringify(obj))); }
  function decodeParam(v) { return JSON.parse(b64decode(fromUrl(v))); }
  // the slim Design for the URL (what bench / physical read): id, label, team, params, overrides
  function slimDesign(d) { const o = { id: d.id, label: d.label, team: d.team, params: d.params }; if (d.overrides) o.overrides = d.overrides; if (d.livery) o.livery = d.livery; if (d.driver) o.driver = d.driver; return o; }
  // the link the concept lab puts on "Watch it on Silverstone" (base: the page's path, e.g. "../race/" from concept/lab/)
  function url(design, opts) {
    opts = opts || {};
    const p = new URLSearchParams();
    if (design) p.set("design", encodeParam(slimDesign(design)));
    p.set("ref", opts.ref || (design && design.team) || "redbull");
    if (opts.conditions) p.set("conditions", encodeParam(opts.conditions));
    if (opts.mode) p.set("mode", opts.mode);
    if (typeof opts.lap_s === "number" && isFinite(opts.lap_s)) p.set("lap", opts.lap_s.toFixed(3));   // the engine's lap (the quali mode checks it)
    return (opts.base == null ? "/concept/race/" : opts.base) + "?" + p.toString();
  }
  // query string -> { design | null, ref, conditions | null, mode, rate, errors[] }
  function parseQuery(search) {
    const q = new URLSearchParams(search || ""), errors = [];
    let design = null;
    const dv = q.get("design");
    if (dv && dv !== "baseline") { try { design = decodeParam(dv); } catch (e) { errors.push("?design is not base64url JSON (" + e.message + ")"); } }
    const ref = (q.get("ref") || (design && design.team) || "redbull").toLowerCase();
    if (!REF_NAMES[ref]) errors.push("?ref=" + ref + ": known refs are " + Object.keys(REF_NAMES).join(", "));
    let conditions = null;
    if (q.get("conditions")) { try { conditions = decodeParam(q.get("conditions")); } catch (e) { errors.push("?conditions is not base64url JSON"); } }
    for (const k of ["wind_ms", "wind_from_deg", "air_temp_c", "air_pressure_hpa"]) {
      if (q.get(k) == null) continue; const v = parseFloat(q.get(k));
      if (!isFinite(v)) { errors.push("?" + k + " is not a number"); continue; }
      conditions = Object.assign({}, conditions || {}, { [k]: v });
    }
    const mode = ["replay", "quali", "race", "grid"].includes(q.get("mode")) ? q.get("mode") : "replay";
    const rate = Math.min(32, Math.max(0.25, parseFloat(q.get("rate")) || 1));
    let lap_s = null;
    if (q.get("lap") != null) { const v = parseFloat(q.get("lap")); if (isFinite(v) && v > 0) lap_s = v; else errors.push("?lap is not a lap time"); }
    return { design, ref, conditions, mode, rate, lap_s, errors };
  }

  function conditionsLabel(c, defaults) {
    const m = Object.assign({}, defaults || {}, c || {});
    const wind = m.wind_ms ? "wind " + (+m.wind_ms).toFixed(1) + " m/s from " + Math.round(m.wind_from_deg || 0) + "°" : "still air";
    const base = !c || !Object.keys(c).length ? "2026 British GP qualifying conditions" : "2026 British GP qualifying conditions, changed";
    return base + " · air " + (+m.air_temp_c).toFixed(1) + " °C · " + (+m.air_pressure_hpa).toFixed(1) + " hPa · " + wind + (m.wet ? " · wet" : " · dry");
  }

  // ERS state per trace sample, DERIVED from the sim's threshold strategy (the sim reports v* and the superclip share, not a
  // per-sample flag): harvest where the car slows (braking: the K harvests from the rear brake force), deploy below v*,
  // superclip at or above v* when the lap superclips. Labelled as derived on screen.
  function ersStates(v_kmh, energy) {
    const n = v_kmh.length, out = new Array(n), vStar = energy && energy.deploy_ceiling_kmh, clip = energy && energy.superclip_share > 0;
    for (let k = 0; k < n; k++) {
      const vn = v_kmh[(k + 1) % n];
      out[k] = vn < v_kmh[k] - 0.05 ? "harvest" : vStar != null && v_kmh[k] >= vStar ? (clip ? "superclip" : "deploy") : "deploy";
    }
    return out;
  }
  function ersNote(energy) {
    if (!energy) return "";
    return "ERS state derived from the sim's threshold strategy: deploy below " + (energy.deploy_ceiling_kmh != null ? energy.deploy_ceiling_kmh + " km/h" : "every speed (not energy limited)") +
      (energy.superclip_share > 0 ? ", superclip above it (share " + energy.superclip_share + ")" : "") + ", harvest under braking; lap totals " + energy.deployed_mj + " MJ deployed / " + energy.harvested_mj + " MJ harvested (physics lap sim)";
  }

  // a sim result with { trace, debug } -> the replay table. Time per sample: the sim's own forward-pass clock (debug.tAt), shifted to
  // the control line; the last sample is (L, lap_s). Fallback without debug: time integrated from the trace's speeds, scaled to lap_s.
  function simTable(r, track) {
    const tr = r.trace, n = tr.s_m.length, L = track.L, lap = r.lap_s, s = [], t = [], method = { kind: null, residual_s: null };
    const i0 = track.idxAtS(track.timing ? track.timing.control_s : 0);
    let integ = 0; const ti = [0];
    for (let k = 1; k < n; k++) { integ += (tr.s_m[k] - tr.s_m[k - 1]) / (((tr.v_kmh[k] + tr.v_kmh[k - 1]) / 2) / 3.6); ti.push(integ); }
    integ += (L - tr.s_m[n - 1]) / (((tr.v_kmh[0] + tr.v_kmh[n - 1]) / 2) / 3.6);
    method.integrated_lap_s = Math.round(integ * 1000) / 1000;
    if (r.debug && r.debug.tAt && r.debug.tAt.length === n) {
      const tAt = r.debug.tAt, t0 = tAt[i0];
      for (let k = 0; k < n; k++) { let x = tAt[(i0 + k) % n] - t0; if (x < 0) x += lap; s.push(tr.s_m[k]); t.push(x); }
      method.kind = "sim forward-pass clock (simulateLap debug.tAt)";
    } else {
      for (let k = 0; k < n; k++) { s.push(tr.s_m[k]); t.push((ti[k] * lap) / integ); }
      method.kind = "time integrated from the trace speeds, scaled to the sim lap (" + (integ - lap >= 0 ? "+" : "") + (integ - lap).toFixed(3) + " s)";
    }
    s.push(L); t.push(lap);
    const ch = (a, wrap) => (a ? a.concat([wrap ? a[0] : a[a.length - 1]]) : null);
    const ers = ersStates(tr.v_kmh, r.energy);
    return { s, t, v: ch(tr.v_kmh, true), gear: ch(tr.gear, true), rpm: ch(tr.rpm, true), aero: ch(tr.aero_mode, true), ers: ch(ers, true), L, time_method: method };
  }
  // the real lap: OpenF1 car_data on the 5 m grid (distance_m, time_s, speed_kmh, gear, rpm); its distance frame is the line's
  function telemetryTable(j) {
    const c = j.channels, n = c.distance_m.length, s = [], t = [], v = [], gear = [], rpm = [];
    for (let k = 0; k < n; k++) { if (k && !(c.distance_m[k] > s[s.length - 1] && c.time_s[k] > t[t.length - 1])) continue; s.push(+c.distance_m[k]); t.push(Math.max(0, +c.time_s[k])); v.push(+c.speed_kmh[k]); gear.push(c.gear[k]); rpm.push(c.rpm[k]); }
    return { s, t, v, gear, rpm, aero: null, ers: null, L: s[s.length - 1] };
  }
  // time when the car reaches distance x (linear in the table)
  function tAtS(tab, x) { const s = tab.s, t = tab.t; let i = 0; while (i < s.length - 2 && s[i + 1] < x) i++; return t[i] + ((x - s[i]) / (s[i + 1] - s[i])) * (t[i + 1] - t[i]); }

  // buildPayload({ design, ref, conditions, telemetry }) -> { ok, errors, payload, bench, cinematic }
  function buildPayload(opts) {
    const design = req("design", "../design.js"), bench = req("bench", "../bench.js");
    const S = EI.conceptSim && EI.conceptSim.simulateLap ? EI.conceptSim : (typeof require === "function" ? require("../sim/index.js") : null);
    if (!S || !design || !bench) return { ok: false, errors: ["concept race: load concept/sim/*.js, design.js, physical.js and bench.js first"] };
    const ref = opts.ref || "redbull", R = REF_NAMES[ref] || REF_NAMES.redbull;
    const d = opts.design || design.baseline(ref === "generic" ? undefined : { team: ref });
    const v = design.validate(d); if (!v.ok) return { ok: false, errors: v.errors };
    const cond = opts.conditions && Object.keys(opts.conditions).length ? opts.conditions : null;
    const b = bench.bench(d, { circuit: TRACK, sim: "physics", objective: "quali", conditions: cond || undefined });
    if (!b.legal) return { ok: false, errors: ["illegal design: no lap time (as in the concept lab)"].concat((b.violations || []).map(x => x.id + ": " + (x.text || x.message || JSON.stringify(x)))), bench: b };
    const run = car => S.simulateLap(bench.guardEnergy(car), TRACK, cond || undefined, { trace: true, debug: true });
    const rc = run(b.physical), rr = run(ref === "generic" ? S.baselineCar() : S.baselineCar(ref));
    const track = (rc.debug && rc.debug.track) || S.buildTrack(TRACK);
    if (!track.reference || !track.timing) return { ok: false, errors: ["concept race: the sim's telemetry racing line (concept/sim/line-silverstone.js) is not loaded"] };
    const tc = simTable(rc, track), trf = simTable(rr, track);
    const errors = [], refDesign = design.baseline(ref === "generic" ? undefined : { team: ref });
    if (Math.abs(rc.lap_s - b.circuits[TRACK].lap_s) > 1e-9) errors.push("the traced lap " + rc.lap_s + " differs from the bench's " + b.circuits[TRACK].lap_s);
    const cars = [
      Object.assign({ id: "concept", name: "Concept · " + (d.id || "design"), short: "CONCEPT", team: d.team === "redbull" || ref === "redbull" ? "redbull" : "lumi", num: 26, ghost: false, source: "physics lap sim", lap_s: rc.lap_s, sectors_s: rc.sectors_s, vmax_kmh: rc.vmax_kmh, speed_trap_kmh: rc.speed_trap_kmh, energy: rc.energy, design: slimDesign(Object.assign({ livery: d.livery, driver: d.driver }, d)) }, tc),
      Object.assign({ id: "ref", name: R.name + " · sim", short: R.short, team: R.team, num: R.num, ghost: true, source: "physics lap sim · inferred car (baselineCar('" + ref + "'))", lap_s: rr.lap_s, sectors_s: rr.sectors_s, vmax_kmh: rr.vmax_kmh, speed_trap_kmh: rr.speed_trap_kmh, energy: rr.energy, design: slimDesign(refDesign) }, trf),
    ];
    if (opts.telemetry) {
      const tt = telemetryTable(opts.telemetry), lap = opts.telemetry.lap || {};
      if (Math.abs(tt.L - track.L) > 1) errors.push("telemetry lap length " + tt.L + " m differs from the line's " + track.L + " m");
      cars.push(Object.assign({ id: "pole", name: "ANT · 2026 pole (real)", short: "ANT POLE", team: "mercedes", num: 12, ghost: true, source: POLE_SOURCE, lap_s: lap.lap_time_s, sectors_s: lap.sector_s, speed_trap_kmh: lap.speed_trap_kmh, time_check_s: Math.round((tt.t[tt.t.length - 1] - lap.lap_time_s) * 1000) / 1000 }, tt));
    }
    for (const c of cars) c.sector_line_times_s = track.timing.sectors.map(x => Math.round(tAtS(c, x) * 1000) / 1000);
    const conditions_label = conditionsLabel(cond, S.DEFAULT_CONDITIONS);
    const payload = {
      version: 1, track: TRACK, label: "physics lap sim · Silverstone · " + conditions_label.split(" · ")[0] + (cond && cond.wind_ms ? " · wind " + (+cond.wind_ms).toFixed(1) + " m/s" : ""),
      sim_label: rc.label, conditions: cond, conditions_label,
      line: { x: Array.from(track.x), z: Array.from(track.z), ds: track.ds, L: track.L, source: "the sim's racing line: mean of 11 team qualifying laps (OpenF1 X/Y), aligned to the OSM centreline" + (track.reference.alignment ? " (similarity fit: " + (track.reference.alignment.reflect ? "reflection, " : "") + track.reference.alignment.rotation_deg + "° rotation, " + track.reference.alignment.rms_m + " m RMS)" : "") },
      timing: { sectors: track.timing.sectors.slice(), L: track.L, note: "sim timing frame: metres from the OpenF1 control line" },
      ers_note: ersNote(rc.energy),
      car_note: "Car models: the concept car and the " + R.short + " ghost are built from their design parameters by EI.conceptView.buildCar (schematic, not a CAD model; wheels not animated in the replay); the pole ghost is the game's car in Mercedes livery.",
      cars,
    };
    return { ok: errors.length === 0, errors, payload, bench: b, design: d, cinematic: cinematic(b.physical, bench, ref) };
  }

  // the cinematic: the game's ?lab=1 broadcast race (two cars, game AI, game lap model) with the bench's v0 multipliers.
  // race: baseline (x1, the team baseline maps to exactly 1.0) vs candidate; grid: the candidate aero on HAD's RB22 in the real 2026 field.
  function cinematic(pc, bench, ref, opts) {
    opts = opts || {};
    let mm; try { mm = bench.v0Multipliers(pc); } catch (e) { return { ok: false, error: "v0 multipliers need the game's lap model (js/ai.js, lab/aero.js, lab/evaluator.js): " + e.message }; }
    const base = opts.base == null ? "../../index.html" : opts.base, seed = opts.seed || 2026, one = { df: 1, cd: 1, a0: 1, b0: 1 };
    const common = "lab=1&track=silverstone&circuit=silverstone&exp=concept-race&seed=" + seed;
    return {
      ok: true, label: CINEMATIC_LABEL, multipliers: mm.mult, clamped: mm.clamped, mass_ratio: mm.k, power_ratio: mm.p,
      note: "v0 multipliers { df, cd, a0, b0 } only: the game's car takes no mass, power or Straight Mode change (bench v0 folds those into its own lap model, the game race cannot)",
      race: base + "?" + common + "&laps=" + (opts.laps || 2) + "&mult_baseline=" + encodeParam(one) + "&mult_candidate=" + encodeParam(mm.mult),
      grid: base + "?" + common + "&mode=grid&driver=" + (ref === "redbull" ? "HAD" : "VER") + "&laps=" + (opts.laps || 2) + "&mult_candidate=" + encodeParam(mm.mult),
    };
  }

  // ================================================================ "Qualifying lap" mode (docs/concept/RACE.md): every car's best 2026 British GP
  // qualifying lap on ONE clock from the same control line, like overlaid ghost laps. Real cars: their own OpenF1 lap (distance / time
  // samples), the distance axis normalised onto the sim's line (s x L_line / L_lap) and the clock ending at exactly the classified time
  // (js/data/racepace2026.js, the demo leaderboard's source). A driver without telemetry drives the pole lap's profile scaled to his
  // time ("time-scaled"). PURPLE / RB22: the physics lap sim's traces from buildPayload, ending at the sim lap (or at the engine's lap
  // from the URL, scaled and flagged if a re-run ever differs). Nothing here invents a time: every lap_s is a source number.
  const QUALI_REAL = "real 2026 qualifying · OpenF1";
  const QUALI_SIM = "physics lap sim · model prediction";
  const QUALI_GHOST_LINE = "all laps start together; no overtaking or traffic is modelled";
  const QUALI_FOOT = "Qualifying lap: real laps = real 2026 qualifying · OpenF1 (openf1.org, an independent community project, not associated with Formula 1, the FIA or FOM), times as classified; PURPLE / RB22 = physics lap sim · model prediction, not a real car's lap. A lap-time comparison (ghosts): " + QUALI_GHOST_LINE + ".";
  const qualiFile = code => "concept/data/telemetry/silverstone-2026-q-" + String(code).toLowerCase() + ".json";
  const BOARD_RANK = { concept: 0, base: 1, real: 2 };
  // the demo leaderboard's order (concept/demo/demo.js renderBoard): real qualifying times + PURPLE (+ the RB22 baseline when it differs),
  // sorted by time, ties: PURPLE, then the baseline, then a real car. The baseline row carries no position.
  function boardRows(q, best, base) {
    const rows = Object.keys(q || {}).filter(c => typeof q[c] === "number" && isFinite(q[c])).map(code => ({ key: code, code, s: q[code], kind: "real" }));
    rows.push({ key: "PRPL", code: "PRPL", s: best, kind: "concept" });
    if (base != null && Math.abs(base - best) > 1e-9) rows.push({ key: "BASE", code: "BASE", s: base, kind: "base" });
    rows.sort((a, b) => a.s - b.s || BOARD_RANK[a.kind] - BOARD_RANK[b.kind]);
    let pos = 0; for (const r of rows) r.pos = r.kind === "base" ? null : ++pos;
    return rows;
  }
  // a distance / time table rescaled: distance onto length L, clock onto lap (the last sample becomes exactly (L, lap))
  function rescale(tab, L, lap) {
    const n = tab.s.length, sL = tab.s[n - 1], tL = tab.t[n - 1], ks = L / sL, kt = lap / tL;
    const s = tab.s.map(x => x * ks), t = tab.t.map(x => x * kt); s[n - 1] = L; t[n - 1] = lap;
    return Object.assign({}, tab, { s, t, L, lap_length_m: Math.round(sL * 10) / 10, clock_end_s: Math.round(tL * 1000) / 1000, time_scale: kt, distance_scale: ks });
  }
  // qualiPayload(replayPayload, { lap_s, racepace: { q, pole }, season: { teams, drivers }, telemetry: { CODE: lapJson }, deleted: [{code, lap_time_s}] })
  //   -> { ok, errors, notes, payload, order }  (payload.cars[0] = PURPLE, then the RB22 ghost when it differs, then every real driver)
  function qualiPayload(P, o) {
    o = o || {};
    const errors = [], notes = [], q = (o.racepace && o.racepace.q) || {}, tel = o.telemetry || {}, L = P.line.L;
    const teams = (o.season && o.season.teams) || [], drivers = (o.season && o.season.drivers) || [];
    const teamOf = code => teams.find(t => (t.drivers || []).includes(code)) || null;
    const driverOf = code => drivers.find(d => d && d.code === code) || null;
    const src = P.cars.find(c => c.id === "concept"), ref = P.cars.find(c => c.id === "ref");
    if (!src) return { ok: false, errors: ["qualifying lap: no PURPLE lap in the payload"] };
    const pick = (c, keys) => { const x = {}; for (const k of keys) if (c[k] !== undefined) x[k] = c[k]; return x; };
    const CH = ["s", "t", "v", "gear", "rpm", "aero", "ers", "L", "time_method", "design", "energy", "speed_trap_kmh", "vmax_kmh", "num", "team"];
    // PURPLE: the sim lap; the engine's lap from the URL must be the same number (3 dp) or the trace is scaled to it and flagged
    let purple = pick(src, CH), plap = src.lap_s, pscaled = false;
    if (typeof o.lap_s === "number" && isFinite(o.lap_s) && Math.abs(o.lap_s - src.lap_s) > 0.0005) {
      purple = rescale(purple, L, o.lap_s); plap = o.lap_s; pscaled = true;
      notes.push("PURPLE: the re-run sim lap " + src.lap_s.toFixed(3) + " s differs from the engine's " + o.lap_s.toFixed(3) + " s; its trace is time-scaled to the engine's lap");
    }
    const cars = [Object.assign(purple, { id: "concept", kind: "concept", name: "PURPLE · RB22 concept", short: "PURPLE", code: "PRPL", color: "#b26cff", ghost: false, delta: false,
      source: QUALI_SIM + (pscaled ? " · time-scaled to the engine's lap" : ""), lap_s: plap, sectors_s: pscaled ? null : src.sectors_s, time_scaled: pscaled })];
    if (ref && Math.abs(ref.lap_s - plap) > 1e-9) cars.push(Object.assign(pick(ref, CH), { id: "ref", kind: "base", name: "RB22 baseline (sim)", short: "RB22", code: "RB22", color: "#3671c6", ghost: true, delta: true, source: QUALI_SIM, lap_s: ref.lap_s, sectors_s: ref.sectors_s, time_scaled: false }));
    const poleCode = (o.racepace && o.racepace.pole && o.racepace.pole.code) || "ANT", poleJ = tel[poleCode];
    const deleted = {}; for (const x of o.deleted || []) deleted[x.code + ":" + x.lap_time_s] = true;
    for (const code of Object.keys(q)) {
      const lap = q[code]; if (typeof lap !== "number" || !isFinite(lap)) continue;
      const tm = teamOf(code), dr = driverOf(code), j = tel[code];
      let tab, source, scaled = false, why = null, sectors = null;
      if (j && j.channels) {
        tab = rescale(telemetryTable(j), L, lap); const own = j.lap && j.lap.lap_time_s;
        sectors = j.lap && j.lap.sector_s && Math.abs(own - lap) <= 0.0005 ? j.lap.sector_s.slice() : null;
        if (Math.abs(tab.clock_end_s - lap) > 0.0015) {
          scaled = true; why = "OpenF1 lap " + tab.clock_end_s.toFixed(3) + " s, classified " + lap.toFixed(3) + " s" + (deleted[code + ":" + lap] ? " (OpenF1 lists " + lap.toFixed(3) + " as deleted by race control)" : "") + ": trace time-scaled";
          notes.push(code + ": " + why);
        }
        source = QUALI_REAL + (scaled ? " · time-scaled" : "");
      } else if (poleJ && poleJ.channels) {
        tab = rescale(telemetryTable(poleJ), L, lap); scaled = true; why = "no telemetry: the pole lap's speed profile scaled to " + lap.toFixed(3) + " s";
        source = QUALI_REAL + " time · " + poleCode + " profile, time-scaled"; notes.push(code + ": " + why);
      } else { errors.push(code + ": no telemetry and no pole lap to scale"); continue; }
      cars.push(Object.assign(tab, { id: code.toLowerCase(), kind: "real", code, short: code, name: (dr && (dr.last || dr.name)) || code, team: tm ? tm.id : null, color: (tm && tm.colors && tm.colors.primary) || "#8a8a94",
        num: (dr && (dr.number || dr.num)) || null, ghost: true, delta: code === poleCode, source, lap_s: lap, sectors_s: sectors, time_scaled: scaled, scale_note: why }));
    }
    const order = boardRows(q, plap, ref ? ref.lap_s : null).map(r => ({ code: r.code === "PRPL" ? "PRPL" : r.code === "BASE" ? "RB22" : r.code, pos: r.pos, s: r.s, kind: r.kind }));
    for (const c of cars) { const r = order.find(x => x.code === c.code); c.pos = r ? r.pos : null; c.rank = BOARD_RANK[c.kind]; }
    const payload = Object.assign({}, P, {
      mode: "quali", label: "Qualifying lap · Silverstone · every car's best lap on one clock",
      ghost_line: QUALI_GHOST_LINE, foot: QUALI_FOOT, real_label: QUALI_REAL, sim_label_short: QUALI_SIM,
      car_note: "PURPLE is built from its design parameters (EI.conceptView.buildCar, schematic); the RB22 ghost likewise; real cars are the game's car in team colours, translucent.",
      order, cars,
    });
    return { ok: errors.length === 0, errors, notes, payload, order };
  }

  const api = { TRACK, POLE_SOURCE, QUALI_REAL, QUALI_SIM, QUALI_GHOST_LINE, QUALI_FOOT, qualiFile, boardRows, rescale, qualiPayload, CINEMATIC_LABEL, TELEMETRY_PATH, REF_NAMES, encodeParam, decodeParam, slimDesign, url, parseQuery, conditionsLabel, ersStates, ersNote, simTable, telemetryTable, tAtS, buildPayload, cinematic };
  C.race = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
