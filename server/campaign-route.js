// PURPLE - the concept ENGINE on the API (docs/concept/DASHBOARD.md): the dashboard in the concept lab starts, follows and stops it.
// Routes (all under /api/concept/engine; JSON envelope { ok, data } | { ok, error } like the rest of server/app.js):
//   GET  /info                  limits, defaults, machine (cpus), the active run, the trained-call budget, prompt version
//   GET  /budget                the project's trained-call budget (250), counted from the call files on disk (never a constant)
//   GET  /timings               live stage timings (mean / p95 / n / last) measured in this process
//   GET  /carsheet?team=redbull every number the physics sim uses for the RB22 / DM01 baseline, with source and FIA/EST/MODEL flag,
//                               and the "how a part moves the lap" table (mechanism from COUPLING.md, Δlap measured here, now)
//   GET  /garage/init?team=     the baseline design, the parameter catalogue, the permitted materials, the baseline lap and ranges
//   POST /garage/lap            { team, params } -> FIA verdict (articles), physics lap, sectors and per-corner deltas vs the
//                               baseline (sim contributions), legal range of every parameter (designer scenario ranges()), timings
//   POST /run                   { mode: "speed" | "auto", ... } -> { run_id, stream } (one engine run at a time)
//   POST /run/:id/stop          cooperative stop: the run ends after its current batch; the best car so far is re-scored
//   GET  /run/:id               the run's state;  GET /run/:id/stream: SSE (snapshot first, then live events, then "end")
//   GET  /runs                  the runs of this process
// Modes: "speed" = the CMA-ES campaign (concept/campaign/run.js) on worker threads, no LLM at all; "auto" = the hybrid self-improving
// loop: Mubit's designer task proposes (concept/designer/loop.js, the existing loop), a short local search of physics laps exploits
// the proposal (concept/campaign/local.js), the bench keeps it or not by the numbers, and the measured result is the next call's input.
// Every LLM call goes through server/mubit.js (server/concept.js designerLlm); "mock" uses the loop's scripted stand-in, no network.
// Trained designer calls need trained: true + confirm: "trained" + confirm_text "TRAIN <max_calls>" + max_calls ≤ TRAINED_RUN_CAP
// + enough of the project budget left; untrained live calls carry x-middleware-record: metadata. Mock runs and speed runs write to
// <os tmp>/purple-engine/<run id> (never data/); live runs to <data dir>/concept-engine/<run id> (counted by the budget).
"use strict";
const path = require("path"), fs = require("fs"), os = require("os");
const { performance } = require("perf_hooks");
const { streamSSE } = require("hono/streaming");
const { ulid } = require("ulid");
const design = require("../concept/design.js"), bench = require("../concept/bench.js"), regs = require("../concept/regs.js"), parts = require("../concept/parts.js");
const materials = require("../concept/materials.js"), phys = require("../concept/physical.js"), sim = require("../concept/sim/index.js");
const run = require("../concept/campaign/run.js"), space = require("../concept/campaign/space.js"), U = require("../concept/campaign/uncertainty.js");
const { Pool } = require("../concept/campaign/pool.js"), { localSearch } = require("../concept/campaign/local.js");
const loop = require("../concept/designer/loop.js"), scenario = require("../concept/designer/scenario.js"), designerPrompt = require("../concept/designer/prompt.js");
const conceptRoutes = require("./concept.js");

const CIRCUIT = "silverstone";
const BUDGET_TOTAL = 250;            // EVAL_GUARDRAILS §4: trained calls, the whole project (research agent + designer)
const TRAINED_RUN_CAP = 30;          // hard cap of trained calls in ONE engine run
const LIMITS = { evals: [20, 200000], seeds: 8, refine_evals: [0, 20000], combo_evals: [0, 2000], lambda: [4, 64], prescreen: [1, 8], iterations: [1, 500], patience: [1, 200], search_budget: [0, 3000], calls: [1, 200], pace_ms: [0, 3000] };
const SIM_LABEL = sim.LABEL + " · Silverstone · 2026 British GP qualifying conditions";
const REAL_LABEL = "real 2026 British GP qualifying · OpenF1 / formula1.com (js/data/racepace2026.js)";
const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const now = () => new Date().toISOString();
const hr = () => performance.now();

// ---- live stage timings (ring buffer per stage)
const STAGES = {
  legality: "FIA legality: regs.js checks + PU / material guards on one car (main thread)",
  physics_lap: "bench(): legality + PhysicalCar + one physics lap of Silverstone (worker thread in a run; main thread in the garage)",
  surrogate: "surrogate lap prediction for one car (pre-screen only; never a reported number)",
  contributions: "per-corner deltas vs the baseline: two traced physics laps (sim contributions)",
  ranges: "legal range of all 23 parameters (bisection on regs.check, designer scenario ranges())",
  mubit_call: "designer call latency through server/mubit.js (mock: the scripted stand-in, no network)",
  search_batch: "local-search batch: physics laps on the worker pool (autonomous mode)",
};
function Timings() {
  const m = new Map();
  return {
    add(stage, ms, meta) { if (typeof ms !== "number" || !isFinite(ms)) return; let s = m.get(stage); if (!s) { s = { xs: [], n: 0, meta: null }; m.set(stage, s); } s.xs.push(ms); if (s.xs.length > 400) s.xs.shift(); s.n++; s.last = ms; s.meta = meta || null; },
    view() {
      const out = {};
      for (const [k, s] of m) { const xs = s.xs.slice().sort((a, b) => a - b); const mean = xs.reduce((a, b) => a + b, 0) / xs.length; out[k] = { n: s.n, mean_ms: +mean.toFixed(3), p95_ms: +xs[Math.min(xs.length - 1, Math.floor(0.95 * (xs.length - 1) + 0.5))].toFixed(3), last_ms: +s.last.toFixed(3), window: xs.length, what: STAGES[k] || k, meta: s.meta || null }; }
      return out;
    },
  };
}

// ---- the trained-call budget, counted from files (never a constant): research ledger data/calls.jsonl, designer runs committed
// under docs/concept/loop-runs/trained-*/calls.jsonl, and the server's own concept-loops / concept-engine run folders
function readJsonl(f) { const out = []; try { for (const l of fs.readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch (e) { /* torn line */ } } } catch (e) { /* missing */ } return out; }
function subdirs(d) { try { return fs.readdirSync(d, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => path.join(d, x.name)); } catch (e) { return []; } }
function trainedBudget(root, dataDirs) {
  const files = [{ file: path.join(root, "data", "calls.jsonl"), source: "data/calls.jsonl (research agent)" }];
  for (const d of subdirs(path.join(root, "docs", "concept", "loop-runs")).filter(d => /^trained-/.test(path.basename(d)))) files.push({ file: path.join(d, "calls.jsonl"), source: path.relative(root, d) + "/calls.jsonl" });
  for (const dd of Array.from(new Set(dataDirs.filter(Boolean).map(d => path.resolve(d))))) for (const sub of ["concept-loops", "concept-engine"]) for (const d of subdirs(path.join(dd, sub))) files.push({ file: path.join(d, "calls.jsonl"), source: path.relative(root, d) + "/calls.jsonl" });
  const seen = new Set(), by = []; let used = 0;
  for (const f of files) {
    let n = 0;
    for (const row of readJsonl(f.file)) {
      if (row.trained !== true) continue;
      const k = row.mubit_request_id ? "id:" + row.mubit_request_id : null;
      if (k && seen.has(k)) continue; if (k) seen.add(k);
      n++;
    }
    if (n) by.push({ source: f.source, trained_calls: n });
    used += n;
  }
  return { total: BUDGET_TOTAL, used, remaining: Math.max(0, BUDGET_TOTAL - used), by_source: by, files_read: files.length, run_cap: TRAINED_RUN_CAP, counted_at: now(), rule: "rows with trained: true (any status, conservative), de-duplicated by x-middleware-request-id, in " + files.length + " call files" };
}

// ---- shared helpers
const teamOf = t => (t === "generic" || t === null ? null : t === undefined ? "redbull" : t);
function checkTeam(t) { const x = teamOf(t); if (x !== null && !design.TEAMS[x]) throw new Error("team must be \"redbull\" or \"generic\""); return x; }
function qualiBench() { const { conditions } = run.qualiConditions(); return { circuit: CIRCUIT, sim: "physics", objective: "quali", conditions }; }
const RP = () => bench.racepace()[CIRCUIT];
function gridOf(lap) { const q = RP().q; return 1 + Object.values(q).filter(x => x < lap - 1e-9).length; }
function violationRows(vs) {
  return (vs || []).map(v => { const r = regs.BY_ID[v.id] || {}; return { id: v.id, article: v.article || r.article || null, text: r.text || v.message || null, value: v.value === undefined ? null : v.value, limit: v.limit === undefined ? null : v.limit, model_rule: /^concept|^PKG/.test(String(v.article || r.article || v.id)) }; });
}
// fresh physics re-score of a best car against its baseline, with the campaign's uncertainty band (CAMPAIGN.md §2)
function rescore(best, base, team) {
  const bo = Object.assign(qualiBench(), { cache: false });
  const R = bench.bench(best, bo), B = bench.bench(base, bo);
  if (!R.legal) return { legal: false, violations: violationRows(R.violations) };
  const c = R.circuits[CIRCUIT], b = B.circuits[CIRCUIT];
  // and the raw sim call itself (no bench, no cache in between): must be the same lap (CAMPAIGN.md "Final numbers")
  const direct = sim.simulateLap(bench.guardEnergy(phys.physical(best)), CIRCUIT, bo.conditions);
  if (Math.abs(direct.lap_s - c.lap_s) > 1e-9) throw new Error("engine rescore: bench lap " + c.lap_s + " differs from the sim's own " + direct.lap_s);
  const noise = U.measureNoise(bench.guardEnergy(R.physical), bo.conditions);
  const unc = U.band({ lap_s: c.lap_s, sectors_s: c.sectors_s }, { lap_s: b.lap_s, sectors_s: b.sectors_s }, team, { noise_s: noise.sigma_s, noise });
  const rp = RP(), pole = rp.pole.s, had = rp.q.HAD;
  return {
    legal: true, source: "re-scored: a direct sim.simulateLap call, equal to the bench lap · " + SIM_LABEL, direct_sim_lap_s: direct.lap_s, label: sim.LABEL,
    lap_s: c.lap_s, sectors_s: c.sectors_s, speed_trap_kmh: c.speed_trap_kmh, energy: c.energy, mass_kg: R.mass.total_kg,
    baseline: { lap_s: b.lap_s, sectors_s: b.sectors_s, label: base.label },
    delta_to_baseline_s: r3(c.lap_s - b.lap_s), delta_to_pole_s: r3(c.lap_s - pole), delta_to_had_s: r3(c.lap_s - had), pole: { code: rp.pole.code, s: pole }, had_s: had,
    sigma_s: unc.sigma_s, band95_s: unc.band95_s, components: unc.components, verdict_pole: U.verdict(unc, pole), verdict_had: U.verdict(unc, had),
    grid_position: gridOf(c.lap_s), grid_range_95: [gridOf(unc.band95_s[0]), gridOf(unc.band95_s[1])],
    pu_identical: bench.checkPU(R.physical, best, null).length === 0, changes: design.diff(base, best).map(d => Object.assign({}, d, { text: design.describeChange(d) })),
    checks: { rules: (regs.ALL_RULES || regs.RULES).length, fails: 0 },
    honesty: "model prediction ± band (physics lap sim's own measured errors; the concept aero map's coefficients are estimates and are not inside the band), not a real car's lap",
  };
}

// ---- the car sheet (every number the sim reads for the baseline, with source and flag)
let couplingCache = null;
function couplingTable() {
  if (couplingCache) return couplingCache;
  const t0 = hr(), base = design.baseline({ team: "redbull" }), bo = qualiBench(), B = bench.bench(base, bo), b = B.circuits[CIRCUIT].lap_s;
  const mech = {};
  try {
    const md = fs.readFileSync(path.join(__dirname, "..", "docs", "concept", "COUPLING.md"), "utf8");
    for (const line of md.split("\n")) { const m = /^\| ([a-z_]+\.[a-z_0-9]+) \| [^|]* \| [^|]* \| ([^|]*) \| ([^|]*) \|/.exec(line); if (m) mech[m[1]] = { mechanism: m[2].trim().replace(/\*\*/g, ""), expected: m[3].trim() }; }
  } catch (e) { /* the doc is optional */ }
  const rows = parts.PARAMS.map(s => {
    const key = s.part + "." + s.param, v = base.params[s.part][s.param];
    const step = s.int ? 1 : Math.max(s.step, Math.abs(v) * 0.1);
    const one = to => { try { const d = design.applyChanges(base, [{ part: s.part, param: s.param, to }]).design; if (Math.abs(d.params[s.part][s.param] - v) < 1e-12) return { na: "at the model domain edge" }; const r = bench.bench(d, bo); return r.legal ? { to: d.params[s.part][s.param], d_lap_s: r3(r.circuits[CIRCUIT].lap_s - b) } : { to: d.params[s.part][s.param], illegal: r.violations.map(x => x.id) }; } catch (e) { return { na: String(e.message || e).slice(0, 80) }; } };
    return { key, label: s.label, unit: s.unit, base: v, minus: one(v - step), plus: one(v + step), step: +step.toFixed(4), mechanism: (mech[key] || {}).mechanism || null, expected: (mech[key] || {}).expected || null };
  });
  couplingCache = { rows, baseline_lap_s: b, ms: Math.round(hr() - t0), source: "Δlap: measured now on the " + sim.LABEL + " (RB22 / DM01 baseline, Q conditions), one parameter at a time, ± 10 % of its baseline value (one step for counts); illegal = the bench gives no lap. Mechanism: docs/concept/COUPLING.md §2", measured_at: now() };
  return couplingCache;
}
function carSheet(team) {
  const base = design.baseline(team ? { team } : undefined), pc = phys.physical(base), S = pc.sources || phys.SOURCES, f = sim.fitted(), tf = team ? (f.teams || []).find(t => t.team === team) : null;
  const est = f.baseline_estimate || {}, M = sim.MODEL, R = sim.REGS, cond = run.qualiConditions();
  const lapB = bench.bench(base, qualiBench()).circuits[CIRCUIT];
  const row = (group, name, value, unit, flag, source) => ({ group, name, value, unit, flag, source });
  const fitSrc = "physics sim fit (concept/sim/fitted.js): generic car estimated on the 2026 British GP pole lap (ANT)" + (tf ? ", × the " + tf.chassis + " scales fitted to " + tf.driver + "'s real Q lap " + tf.q_real_s + " s + speed trap " + tf.trap_real_kmh + " km/h (CLA × " + tf.cla_scale + ", CDA × " + tf.cda_scale + ", PU × " + tf.pu_scale + ")" : "");
  const cla = a => a.CLA_front_m2 + a.CLA_rear_m2;
  const g = pc.gearing || {};
  const rows = [
    row("mass", "Car mass in the sim (no fuel)", pc.mass_kg, "kg", "EST", S.mass_kg.basis),
    row("mass", "Minimum mass, qualifying (C4.1, excl. tyres)", R.min_mass_q_kg_excl_tyres, "kg", "FIA", "FIA 2026 Section C, C4.1 (sim REGS)"),
    row("mass", "Fuel on board (Q run)", pc.fuel_kg, "kg", "MODEL", S.fuel_kg.basis),
    row("mass", "CoG height", pc.cog_height_m, "m", "MODEL", S.cog_height_m.basis),
    row("mass", "CoG behind the front axle", r3(pc.cog_x_m), "m", "MODEL", S.cog_x_m.basis),
    row("mass", "Weight distribution, front", pc.weight_dist_front, "share", "EST", S.weight_dist_front.basis + " · C4.2 front ≥ " + R.front_mass_min_frac + ", rear ≥ " + R.rear_mass_min_frac),
    row("mass", "Wheelbase", pc.wheelbase_m, "m", "FIA", S.wheelbase_m.basis),
    row("mass", "Track front / rear", pc.track_front_m + " / " + pc.track_rear_m, "m", "MODEL", S.track_m.basis),
    row("pu", "ICE power (≥ 10,500 rpm)", pc.pu.ice_kw, "kW", "EST", S.pu.basis + (tf ? " · " + tf.pu + " PU scale " + tf.pu_scale : "")),
    row("pu", "MGU-K power", pc.pu.mguk_kw, "kW", "FIA", "C5.2.7 (350 kW DC)"),
    row("pu", "MGU-K taper with speed", "1800 − 5·v (kW, v in km/h)", "", "FIA", "C5.2.8: full to 290 km/h, zero from 345 km/h (sim mgukTaperKw)"),
    row("pu", "Fuel energy flow cap", R.fuel_energy_flow_mj_h, "MJ/h", "FIA", "C5.2.3 (0.27·N + 165 below 10,500 rpm, C5.2.4)"),
    row("pu", "ERS electrical → mechanical efficiency", R.ers_eff, "", "FIA", "C5.2.21 (fixed 0.97)"),
    row("pu", "ES state-of-charge window", pc.pu.es_soc_window_mj, "MJ", "FIA", "C5.2.9"),
    row("pu", "Recharge cap per lap", pc.pu.es_harvest_mj_per_lap, "MJ", "FIA", "C5.2.10"),
    row("pu", "Recharge limit, Silverstone qualifying", cond.conditions.recharge_limit_mj, "MJ", "FIA", "FIA event document 7, Silverstone 2026 (" + cond.source + ")"),
    row("pu", "Deployable per lap", pc.pu.es_deploy_mj_per_lap, "MJ", "MODEL", "SoC window + recharge cap (no separate deploy cap in Section C)"),
    row("pu", "Full-throttle harvest ('super clipping') power", M.superclip_kw, "kW", "MODEL", "physics sim MODEL.superclip_kw"),
    row("driveline", "Gears", (g.rpm_per_kmh || []).length, "forward", "FIA", "C9.6.1 (8 forward gears)"),
    row("driveline", "rpm per km/h, gears 1-8", (g.rpm_per_kmh || []).join(" / "), "rpm/(km/h)", "EST", (g.source || "") + " · measured gears 4-8 on HAD's Q lap (OpenF1), others extrapolated with the mean ratio step (sim fit.js)"),
    row("driveline", "km/h per 1000 rpm, gears 1-8", (g.rpm_per_kmh || []).map(x => (1000 / x).toFixed(2)).join(" / "), "km/h", "EST", "1000 ÷ the row above"),
    row("driveline", "Max rpm (upshift)", g.shift_rpm, "rpm", "EST", "HAD's peak on his Q3 lap (concept/data/redbull-2026.json); Section C sets no rev limit (C5.14 band only)"),
    row("driveline", "Drivetrain efficiency", pc.drivetrain_eff, "", "MODEL", S.drivetrain_eff.basis),
    row("driveline", "Rolling radius", pc.tyres.radius_m, "m", "EST", "18 in rim (C10.7.2) and a ~707 mm tyre (press figure), loaded"),
    row("tyres", "Braking limit (mechanical)", pc.brakes.max_decel_g_mech, "g", "MODEL", S.brakes.basis),
    row("tyres", "μx (longitudinal, effective)", pc.tyres.mu_x, "", "EST", fitSrc),
    row("tyres", "μy (lateral, effective)", pc.tyres.mu_y, "", "EST", fitSrc),
    row("tyres", "Load sensitivity", pc.tyres.load_sens, "", "EST", fitSrc + (est.tyres ? " (generic estimate " + est.tyres.load_sens + ")" : "")),
    row("aero", "CLA, corner mode (front + rear)", r3(cla(pc.aero.corner)) + " (" + r3(pc.aero.corner.CLA_front_m2) + " + " + r3(pc.aero.corner.CLA_rear_m2) + ")", "m²", "EST", fitSrc + " · effective coefficients of a point-mass model"),
    row("aero", "CDA, corner mode", r3(pc.aero.corner.CDA_m2), "m²", "EST", fitSrc),
    row("aero", "CLA, straight mode (front + rear)", r3(cla(pc.aero.straight)) + " (" + r3(pc.aero.straight.CLA_front_m2) + " + " + r3(pc.aero.straight.CLA_rear_m2) + ")", "m²", "EST", fitSrc),
    row("aero", "CDA, straight mode", r3(pc.aero.straight.CDA_m2), "m²", "EST", fitSrc),
    row("aero", "Drag ratio straight / corner", r3(pc.aero.straight.CDA_m2 / pc.aero.corner.CDA_m2), "", "EST", "CDA straight ÷ CDA corner (rows above)"),
    row("aero", "Aero balance (front share of corner CLA)", pc.aero.balance_corner, "", "EST", "generic estimate on the pole lap (" + (f.baseline_estimate_scales ? f.baseline_estimate_scales.balance : "—") + "); not separable from telemetry"),
    row("aero", "Ride height", pc.aero.ride_height_mm, "mm", "MODEL", "design parameter floor.ride_height_mm (baseline)"),
    row("aero", "Ride height sensitivity of CLA", pc.aero.ride_sens_per_mm, "per mm", "MODEL", "concept aero map (the lab's slope, COUPLING.md §2)"),
    row("aero", "Floor stall margin", pc.aero.stall_margin_mm, "mm", "MODEL", "concept floor model (gap at the dynamic ride height vs the stall onset)"),
    row("sim", "Rolling resistance Crr", M.crr, "", "MODEL", "physics sim MODEL"),
    row("sim", "Rotating-mass factor", M.rot_mass_factor, "", "MODEL", "physics sim MODEL"),
    row("sim", "Air density at Q conditions", r3(lapB.air_density_kgm3), "kg/m³", "EST", "air " + cond.conditions.air_temp_c + " °C, " + cond.conditions.air_pressure_hpa + " hPa, " + cond.conditions.humidity_pct + " % RH (" + cond.source + ")"),
  ];
  return {
    team: team || "generic", car: base.label, pu: bench.homologatedPU(team).name, rows,
    lap: { lap_s: lapB.lap_s, sectors_s: lapB.sectors_s, speed_trap_kmh: lapB.speed_trap_kmh, label: SIM_LABEL },
    fit: tf ? { driver: tf.driver, q_real_s: tf.q_real_s, q_sim_s: tf.q_sim_s, trap_real_kmh: tf.trap_real_kmh, trap_sim_kmh: tf.trap_sim_kmh, heldout_trace_rms_kmh: tf.heldout && tf.heldout.trace_rms_kmh, sector_residuals_s: tf.heldout && tf.heldout.sector_residuals_s } : null,
    flags: { FIA: "set by the FIA 2026 regulations (Section C Issue 19) or an FIA event document", EST: "estimated from public data (telemetry fit, reported figures); uncertain", MODEL: "a modelling assumption or a value the concept model derives" },
  };
}

// ---- the garage (manual edits, one physics lap per click)
function catalogue() {
  return parts.PARAMS.map(s => ({ part: s.part, param: s.param, key: s.part + "." + s.param, label: s.label, unit: s.unit, step: s.step, min: s.min, max: s.max, int: !!s.int, base: s.base }));
}
function materialChoices() {
  const out = {};
  for (const p of space.MATERIAL_PARTS) out[p] = { base: materials.baseOf(p), options: space.materialOptions(p).filter(id => !materials.problem(p, id)).map(id => { const m = materials.BY_ID[id]; return { id, name: m.name, fia: m.fia ? m.fia.status + " (" + m.fia.article + ")" : null }; }) };
  return out;
}
function designFrom(team, params) {
  const base = design.baseline(team ? { team } : undefined), ch = [];
  if (params && typeof params === "object") {
    for (const s of parts.PARAMS) { const p = params[s.part]; if (p && p[s.param] !== undefined && p[s.param] !== base.params[s.part][s.param]) { const v = Number(p[s.param]); if (!isFinite(v)) throw new Error(s.part + "." + s.param + " must be a number"); ch.push({ part: s.part, param: s.param, to: v }); } }
    for (const part of parts.MATERIAL_PARTS) { const p = params[part]; if (p && typeof p.material === "string" && p.material !== materials.materialOf(base.params, part)) { const why = materials.problem(part, p.material); if (why) throw new Error(why); ch.push({ part, param: "material", to: p.material }); } }
  }
  return { base, d: ch.length ? design.applyChanges(base, ch, { id: "garage", label: "garage car" }).design : design.clone(base), changes: ch };
}
function garageLap(team, params, timings) {
  const { base, d } = designFrom(team, params), bo = qualiBench();
  const t0 = hr();
  const f = design.facts(d), v = regs.check(d); const pcL = phys.physical(d);
  for (const x of bench.checkPU(pcL, d, f.mass)) v.push(x); for (const x of bench.checkMaterials(d)) v.push(x);
  const legalityMs = hr() - t0; timings.add("legality", legalityMs);
  // a lap the bench's physics cache already holds is not a lap: only a cache miss is a physics_lap timing sample
  const miss0 = bench.cacheStats().misses, t1 = hr(); const R = bench.bench(d, Object.assign({}, bo, { cache: false })); const lapMs = hr() - t1;
  const lapCached = bench.cacheStats().misses === miss0; if (!lapCached && R.legal) timings.add("physics_lap", lapMs, { where: "garage (main thread)" });
  const B = bench.bench(base, bo), b = B.circuits[CIRCUIT];
  const out = { legal: !!R.legal, violations: violationRows(R.legal ? [] : R.violations.length ? R.violations : v), rules_checked: (regs.ALL_RULES || regs.RULES).length, label: SIM_LABEL,
    baseline: { lap_s: b.lap_s, sectors_s: b.sectors_s, speed_trap_kmh: b.speed_trap_kmh, label: base.label }, design: { params: d.params, team: d.team || null, livery: base.livery || null },
    diff: design.diff(base, d).map(x => Object.assign({}, x, { text: design.describeChange(x) })), mass: R.mass ? { total_kg: R.mass.total_kg, ballast_kg: R.mass.ballast_kg, front_share: R.mass.front_share } : null };
  let surMs = null, conMs = null;
  if (R.legal) {
    const c = R.circuits[CIRCUIT];
    Object.assign(out, { lap_s: c.lap_s, sectors_s: c.sectors_s, speed_trap_kmh: c.speed_trap_kmh, vmin_kmh: c.vmin_kmh, energy: c.energy, d_lap_s: r3(c.lap_s - b.lap_s), d_sectors_s: c.sectors_s.map((s, i) => r3(s - b.sectors_s[i])), grid_position: gridOf(c.lap_s), delta_to_pole_s: r3(c.lap_s - RP().pole.s) });
    try { const S = require("../concept/surrogate/surrogate.js"); const t2 = hr(); const p = S.predictLap(bench.guardEnergy(R.physical), CIRCUIT, "physics"); surMs = hr() - t2; timings.add("surrogate", surMs); out.surrogate = { lap_s: isFinite(p) ? r3(p) : null, note: "surrogate prediction, information only (outside its training box: no value)" }; } catch (e) { out.surrogate = null; }
    const t3 = hr(); const k = sim.contributions(bench.guardEnergy(R.physical), bench.guardEnergy(B.physical), bo.conditions); conMs = hr() - t3; timings.add("contributions", conMs);
    out.segments = k.segments.map(s => ({ name: s.name, kind: s.kind, d_s: s.delta_s, s0_m: s.s0_m, s1_m: s.s1_m, min_kmh: s.min_kmh, ref_min_kmh: s.ref_min_kmh }));
    out.segments_label = "physics lap sim contributions(car, baseline): corner zones (marker ±100 m) and the straights between; sum = lap delta " + k.delta_s + " s";
  }
  const t4 = hr(); out.ranges = scenario.ranges(d); const rMs = hr() - t4; timings.add("ranges", rMs);
  out.ranges_note = regs.check(d).length ? "the car is illegal: ranges show the single-number limits only (the combined limits are bisected from a legal car)" : "legal range of each parameter with every other parameter held (bisection on regs.check; FIA article or model rule at each end)";
  out.timings_ms = { legality: r3(legalityMs), physics_lap: r3(lapMs), physics_lap_cached: lapCached, surrogate: r3(surMs), contributions: r3(conMs), ranges: r3(rMs) };
  return out;
}

// ---- mount
function mount(app, o) {
  const { ok, body, ApiError } = o;
  const root = o.root || path.join(__dirname, "..");
  const log = o.log || (() => {});
  const timings = o.timings || Timings();
  const runs = new Map();
  let active = null;
  const bad = m => new ApiError("BAD_INPUT", m);
  const int = (b, k, def, [lo, hi]) => { const v = b[k] == null ? def : b[k]; if (!Number.isInteger(v) || v < lo || v > hi) throw bad(k + " must be an integer " + lo + "-" + hi); return v; };
  const budget = () => trainedBudget(root, [o.dataDir, path.join(root, "data")]);
  const tmpBase = o.tmpDir || path.join(os.tmpdir(), "purple-engine");
  const view = r => ({ run_id: r.id, mode: r.mode, llm: r.llm || null, trained: !!r.trained, status: r.status, stop_reason: r.stop_reason || null, started_at: r.started_at, finished_at: r.finished_at || null, error: r.error || null, dir: r.dir, opts: r.opts, stream: "/api/concept/engine/run/" + r.id + "/stream" });

  function newRun(mode, opts, dir) {
    const id = "eng-" + ulid().toLowerCase();
    const d = path.join(dir, id); fs.mkdirSync(d, { recursive: true });
    const r = { id, mode, opts, status: "running", started_at: now(), dir: d, events: [], listeners: new Set(), state: { trace: {}, best: {}, baseline: {}, laps: 0, rate: null }, stopRequested: false, seq: 0 };
    r.push = (type, data, keep) => {
      const ev = Object.assign({ seq: r.seq++, at: now() }, data, { type });
      if (keep !== false) { r.events.push(ev); if (r.events.length > 4000) r.events.splice(0, r.events.length - 4000); }
      for (const l of r.listeners) l(ev);
      if (keep !== false) try { fs.appendFileSync(path.join(d, "events.jsonl"), JSON.stringify(ev) + "\n"); } catch (e) { /* the run goes on */ }
    };
    runs.set(id, r); active = r;
    return r;
  }
  function finish(r, p) {
    return p.then(() => { if (r.status === "running") r.status = r.stopRequested ? "stopped" : "done"; }, e => { r.status = "error"; r.error = String(e && e.message || e); r.push("error", { error: r.error }); log("concept engine " + r.id + " error " + r.error); })
      .finally(() => { r.finished_at = now(); if (active === r) active = null; try { fs.writeFileSync(path.join(r.dir, "run.json"), JSON.stringify(Object.assign(view(r), { final: r.final || null }), null, 2) + "\n"); } catch (e) { /* fine */ } r.push("end", { status: r.status, stop_reason: r.stop_reason || null }, false); for (const l of r.listeners) l(null); });
  }
  // laps per second over the last ~3 s of the pool's finished laps
  function rateOf(r, pool) {
    const t = Date.now(), w = r.rateWin || (r.rateWin = []); w.push([t, pool.done]); while (w.length > 2 && t - w[0][0] > 3000) w.shift();
    const dt = (t - w[0][0]) / 1000; return dt > 0.2 ? +((pool.done - w[0][1]) / dt).toFixed(1) : null;
  }

  // ---------- speed run: the campaign with progress, stop and the final re-score
  function startSpeed(b) {
    const seeds = b.seeds == null ? [1, 2, 3, 4] : b.seeds;
    if (!Array.isArray(seeds) || !seeds.length || seeds.length > LIMITS.seeds || !seeds.every(s => Number.isInteger(s) && s >= 0 && s <= 999999)) throw bad("seeds must be 1-" + LIMITS.seeds + " integers 0-999999");
    const baselines = b.baselines == null ? ["redbull"] : b.baselines;
    if (!Array.isArray(baselines) || !baselines.length || !baselines.every(x => x === "redbull" || x === "generic") || new Set(baselines).size !== baselines.length) throw bad("baselines must be [\"redbull\"], [\"generic\"] or both");
    const opts = {
      seeds, baselines, evals: int(b, "evals", 1500, LIMITS.evals), lambda: int(b, "lambda", 16, LIMITS.lambda), prescreen: int(b, "prescreen", 4, LIMITS.prescreen), patience: 25,
      refine_evals: int(b, "refine_evals", 600, LIMITS.refine_evals), combo_evals: int(b, "combo_evals", 0, LIMITS.combo_evals), workers: int(b, "workers", o.workers == null ? Math.min(4, os.cpus().length) : o.workers, [0, 16]),
      continuous: b.continuous === true, no_sensitivity: b.sensitivity !== true, quiet: true,
    };
    const r = newRun("speed", opts, tmpBase); r.llm = "none (no LLM in a speed run)";
    log("concept engine " + r.id + " speed run " + JSON.stringify(opts));
    let last = 0, pool = null;
    const onProgress = ev => {
      const team = ev.team, st = r.state; st.laps = ev.total_laps; if (pool) st.rate = rateOf(r, pool);
      if (ev.type === "phase" && ev.phase === "baseline") { st.baseline[team] = ev.baseline; st.trace[team] = [[ev.total_laps, ev.baseline.lap_s]]; st.best[team] = Object.assign({ legal: true }, ev.baseline); }
      const improved = ev.best && ev.best.lap_s < ((st.best[team] || {}).lap_s || Infinity) - 1e-9;
      if (improved) { st.best[team] = Object.assign({ legal: true, at_laps: ev.total_laps, seed: ev.seed, stage: ev.stage || null }, ev.best); (st.trace[team] = st.trace[team] || []).push([ev.total_laps, ev.best.lap_s]); }
      const t = Date.now();
      if (ev.type === "phase" || improved || t - last > 250) {
        last = t;
        const slim = Object.assign({}, ev, { kind: ev.type }); delete slim.best; delete slim.type;   // the SSE event type is "progress"; ev.type (gen | refine | phase) travels as kind
        r.push("progress", Object.assign(slim, { laps: ev.total_laps, laps_per_s: st.rate, best_s: (st.best[team] || {}).lap_s, best: improved ? st.best[team] : undefined, grid_position: st.best[team] ? gridOf(st.best[team].lap_s) : null, timings: t - (r.lastT || 0) > 1000 ? (r.lastT = t, timings.view()) : undefined }), ev.type === "phase" || improved);
      }
    };
    r.push("start", { mode: "speed", opts, label: SIM_LABEL, real_label: REAL_LABEL, machine: { cpus: os.cpus().length, workers: opts.workers } });
    const p = new Promise(res => setImmediate(res)).then(() => run.runCampaign(Object.assign({}, opts, {
      onProgress, onPool: x => { pool = x; }, timer: (stage, ms) => timings.add(stage, ms),
      shouldStop: () => (r.stopRequested ? (r.stop_reason = r.stop_reason || "stopped by user") : null),
    }))).then(res => {
      const final = {};
      for (const k of Object.keys(res.results)) {
        const x = res.results[k], u = x.uncertainty;
        final[k] = {
          baseline_label: x.baseline_label, source: x.best.source, label: x.sim_label, lap_s: x.best.lap_s, sectors_s: x.best.sectors_s, speed_trap_kmh: x.best.speed_trap_kmh,
          sigma_s: u.sigma_s, band95_s: u.band95_s, components: u.components, baseline: x.baseline, delta_to_baseline_s: x.best.delta_to_baseline_s, delta_to_pole_s: x.best.delta_to_pole_s, delta_to_had_s: x.best.delta_to_had_s,
          verdict_pole: x.verdict_pole, verdict_had: x.verdict_had, grid_position: x.best.grid_position, grid_range_95: x.best.grid_range_95, pu_identical: x.pu.identical && x.pu.guard_violations === 0, pu_name: x.pu.name,
          legality: { pass: x.legality.filter(l => l.status === "pass").length, fail: x.legality.filter(l => l.status === "FAIL").map(l => l.id), info: x.legality.filter(l => /^info/.test(l.status)).length, not_enforced: x.legality.filter(l => /not enforced|NOT CHECKED/.test(l.status)).map(l => l.id) },
          changes: x.changes.map(c => ({ part: c.part, param: c.param, from: c.from, to: c.to, text: c.text, at_limit: c.at_limit })), segments: x.segments, segments_label: x.segments_label, physics_laps: x.physics_laps, runtime_s: x.runtime_s, stopped: x.stopped || null, refine: { start_s: x.refine.start_s, best_s: x.refine.best_s, physics_laps: x.refine.physics_laps },
          design: x.best.design, honesty: "model prediction ± band (physics lap sim's own measured errors; the concept aero map's coefficients are estimates and are not inside the band), not a real car's lap",
        };
      }
      r.final = { results: final, runtime_s: res.runtime_s, stopped: res.stopped || null, laps: Object.values(res.results).reduce((s, x) => s + x.physics_laps, 0), machine: res.machine };
      try { fs.writeFileSync(path.join(r.dir, "campaign.json"), JSON.stringify(res, null, 1) + "\n"); fs.writeFileSync(path.join(r.dir, "summary.md"), run.summaryMarkdown(res) + "\n"); } catch (e) { /* fine */ }
      r.push("final", Object.assign({ timings: timings.view() }, r.final));
    });
    finish(r, p);
    return r;
  }

  // ---------- autonomous: the hybrid self-improving Mubit loop
  function startAuto(b) {
    const mode = b.llm == null ? "mock" : b.llm;
    if (!["mock", "live"].includes(mode)) throw bad("llm must be \"mock\" or \"live\"");
    if (b.trained !== undefined && typeof b.trained !== "boolean") throw bad("trained must be a boolean");
    const trained = b.trained === true, team = checkTeam(b.team);
    const max_calls = int(b, "max_calls", trained ? 10 : mode === "live" ? 20 : 60, LIMITS.calls);
    const opts = {
      llm: mode, trained, team: team || "generic", seed: int(b, "seed", 1, [0, 999999]), max_calls, max_iterations: int(b, "max_iterations", 200, LIMITS.iterations), patience: int(b, "patience", 8, LIMITS.patience),
      target_lap_s: b.target_lap_s == null ? null : +b.target_lap_s, search_budget: int(b, "search_budget", 200, LIMITS.search_budget), scope: b.scope == null ? "proposal" : b.scope,
      pace_ms: int(b, "pace_ms", 0, LIMITS.pace_ms), workers: int(b, "workers", o.workers == null ? Math.min(4, os.cpus().length) : o.workers, [0, 16]), start: b.start_params ? "garage car" : "baseline",
    };
    if (opts.target_lap_s != null && !(isFinite(opts.target_lap_s) && opts.target_lap_s > 60 && opts.target_lap_s < 120)) throw bad("target_lap_s must be a lap time in s (60-120) or null");
    if (!["proposal", "wide"].includes(opts.scope)) throw bad("scope must be \"proposal\" or \"wide\"");
    if (mode === "live" && o.mock) throw bad("live mode is off: this server runs with MUBIT_MOCK=1 (no Mubit calls). Use llm \"mock\".");
    if (mode === "live" && !o.mubit && !process.env.MUBIT_API_KEY) throw bad("live mode needs MUBIT_API_KEY in server/.env");
    let bud = null;
    if (trained) {
      if (mode !== "live") throw bad("trained calls are live calls: set llm \"live\"");
      if (b.confirm !== "trained") throw bad("confirm must be \"trained\": trained designer calls are recorded by Mubit as examples of the designer task");
      if (max_calls > TRAINED_RUN_CAP) throw bad("max_calls for a trained run is capped at " + TRAINED_RUN_CAP + " (hard per-run cap)", { cap: TRAINED_RUN_CAP });
      if (b.confirm_text !== "TRAIN " + max_calls) throw bad("type the confirmation exactly: TRAIN " + max_calls);
      if (designerPrompt.DRAFT) throw bad("trained calls are refused while the designer prompt is a DRAFT");
      bud = budget();
      if (bud.remaining < max_calls) throw bad("not enough trained-call budget left: " + bud.remaining + " of " + bud.total + " remain, this run asks for " + max_calls, { budget: bud });
    }
    let start = null;
    if (b.start_params) {
      let g; try { g = designFrom(team, b.start_params); } catch (e) { throw bad("start_params: " + (e.message || e)); }
      const x = bench.bench(g.d, { circuit: CIRCUIT }); if (!x.legal) throw bad("start_params: the garage car is illegal (" + x.violations.map(v => v.id).join(", ") + "); the loop starts only from a legal car");
      start = g.d;
    }
    const dir = mode === "live" ? path.join(o.dataDir, "concept-engine") : tmpBase;
    const r = newRun("auto", opts, dir); r.llm = mode; r.trained = trained;
    const calls = { n: 0 };
    const write = (f, row) => { try { fs.appendFileSync(path.join(r.dir, f), JSON.stringify(row) + "\n"); } catch (e) { /* fine */ } };
    fs.writeFileSync(path.join(r.dir, "calls.jsonl"), "");
    const caller = mode === "mock" ? loop.mockCaller(opts.seed) : conceptRoutes.designerLlm(o.mubit, designerPrompt);   // Mubit only through server/mubit.js
    const llm = async (text, meta) => {
      if (calls.n >= max_calls) { const e = new Error("call budget of this run spent"); e.code = "run_cap"; throw e; }   // belt and braces (shouldStop ends the run first)
      calls.n++;
      const row = { created_at: now(), kind: "design", engine: "auto", session_id: meta.sessionId, iteration: meta.gen, trained: !!meta.trained, mock: mode === "mock" };
      const t0 = hr();
      try { const res = await caller(text, meta); const ms = hr() - t0; timings.add("mubit_call", mode === "mock" ? ms : (res.latency_ms == null ? ms : res.latency_ms), { mode }); write("calls.jsonl", Object.assign(row, { mubit_request_id: res.mubit_request_id, model: res.model, input_tokens: res.input_tokens, output_tokens: res.output_tokens, latency_ms: res.latency_ms == null ? Math.round(ms) : res.latency_ms, status: "ok" })); return res; }
      catch (e) { write("calls.jsonl", Object.assign(row, { mubit_request_id: e.requestId || null, status: "error", mubit_code: e.code || null, http_status: e.status || null })); throw e; }
    };
    let pool = null, lastP = 0;
    const st = r.state;
    const shouldStop = ({ gen, lineage, best }) => {
      let why = null;
      if (r.stopRequested) why = "stopped by user";
      else if (opts.target_lap_s != null && best && best.lap_s <= opts.target_lap_s) why = "target lap " + opts.target_lap_s + " s reached";
      else if (calls.n >= max_calls) why = "call budget of " + max_calls + " spent";
      else if (gen > opts.max_iterations) why = "iteration cap " + opts.max_iterations;
      else { let stale = 0; for (let i = lineage.length - 1; i >= 0 && !lineage[i].kept; i--) stale++; if (stale >= opts.patience) why = "no improvement for " + opts.patience + " iterations"; }
      if (why) r.stop_reason = why;
      return why;
    };
    const search = opts.search_budget > 0 ? ctx => localSearch({
      parent: ctx.parent, changes: ctx.changes, pool, benchOpts: ctx.benchOpts, budget: opts.search_budget, scope: opts.scope, seed: opts.seed * 100003 + ctx.gen, stop: () => r.stopRequested,
      onBatch: ev => { timings.add("search_batch", ev.ms, { laps: ev.n }); st.laps = pool.laps; st.rate = rateOf(r, pool); const t = Date.now(); if (t - lastP > 250) { lastP = t; r.push("progress", { iteration: ctx.gen, stage: ev.stage, search_laps: ev.laps, search_budget: ev.budget, search_best_s: ev.best_s, laps: pool.laps, laps_per_s: st.rate }, false); } },
    }) : null;
    log("concept engine " + r.id + " auto " + JSON.stringify(opts));
    const p = new Promise(res => setImmediate(res)).then(async () => {
      pool = new Pool(opts.workers);
      try {
        r.push("start", { mode: "auto", opts, label: SIM_LABEL, real_label: REAL_LABEL, budget: bud || budget(), prompt_version: designerPrompt.DESIGNER_PROMPT_VERSION, machine: { cpus: os.cpus().length, workers: opts.workers } });
        const tick = () => new Promise(res => setImmediate(res));
        const res = await loop.runLoop({
          iterations: opts.max_iterations, seed: opts.seed, runId: r.id, team, trained, start, llm, preview: conceptRoutes.previewer(designerPrompt), pace_ms: opts.pace_ms, yield: tick, maxCalls: max_calls,
          search, shouldStop,
          onEvent: (type, data) => {
            if (type === "start") { st.baseline.loop = data.baseline; st.best.loop = { lap_s: data.baseline.lap_s }; st.trace.loop = [[0, data.baseline.lap_s, 0]]; }
            if (type === "result") {
              const row = data.row;
              if (row.kept) { try { loopBest.d = design.applyChanges(loopBest.d, row.changes.map(c => ({ part: c.part, param: c.param, to: c.to }))).design; } catch (e) { /* display only */ } }
              if (row.kept && data.best) st.best.loop = Object.assign({}, data.best, { iteration: data.iteration, params: loopBest.d.params });
              (st.trace.loop = st.trace.loop || []).push([data.iteration, data.best.lap_s, pool ? pool.laps : 0]);
              data = Object.assign({}, data, { laps: pool ? pool.laps : 0, laps_per_s: st.rate, calls: calls.n, grid_position: gridOf(data.best.lap_s), best_params: row.kept ? loopBest.d.params : undefined });
            }
            r.push(type === "error" ? "loop_error" : type, data);
          },
        });
        try { fs.writeFileSync(path.join(r.dir, "lineage.jsonl"), res.lineage.map(x => JSON.stringify(x)).join("\n") + "\n"); } catch (e) { /* fine */ }
        if (!r.stop_reason) r.stop_reason = res.stopped || "iteration cap";
        const s = loop.summaryOf(res), base = start || design.baseline(team ? { team } : undefined);
        const base0 = design.baseline(team ? { team } : undefined);
        r.final = { summary: s, calls: calls.n, laps: pool.laps, stop_reason: r.stop_reason, rescore: rescore(res.best, base0, team), from_start: start ? { start_lap_s: bench.bench(base, { circuit: CIRCUIT }).circuits[CIRCUIT].lap_s } : null, best_params: res.best.params };
        r.push("final", Object.assign({ timings: timings.view(), budget: budget() }, r.final));
      } finally { await pool.close(); }
    });
    const loopBest = { d: start || design.baseline(team ? { team } : undefined) };
    finish(r, p);
    return r;
  }

  // ---------- routes
  app.get("/api/concept/engine/info", c => ok(c, {
    mock: !!o.mock, live_available: !o.mock && !!(o.mubit || process.env.MUBIT_API_KEY), cpus: os.cpus().length, workers_default: o.workers == null ? Math.min(4, os.cpus().length) : o.workers,
    active: active ? view(active) : null, budget: budget(), trained_run_cap: TRAINED_RUN_CAP, limits: LIMITS, prompt_version: designerPrompt.DESIGNER_PROMPT_VERSION, prompt_draft: !!designerPrompt.DRAFT,
    label: SIM_LABEL, real_label: REAL_LABEL, real: { pole: RP().pole, q: RP().q }, stages: STAGES,
  }));
  app.get("/api/concept/engine/budget", c => ok(c, budget()));
  app.get("/api/concept/engine/timings", c => ok(c, { stages: timings.view(), what: STAGES }));
  app.get("/api/concept/engine/carsheet", c => {
    let team; try { team = checkTeam(c.req.query("team") || "redbull"); } catch (e) { throw bad(e.message); }
    return ok(c, Object.assign(carSheet(team), { coupling: team === "redbull" ? couplingTable() : null }));
  });
  app.get("/api/concept/engine/garage/init", c => {
    let team; try { team = checkTeam(c.req.query("team") || "redbull"); } catch (e) { throw bad(e.message); }
    const lap = garageLap(team, null, timings);
    return ok(c, Object.assign(lap, { catalogue: catalogue(), materials: materialChoices(), team: team || "generic" }));
  });
  app.post("/api/concept/engine/garage/lap", async c => {
    const b = await body(c); let team, out;
    try { team = checkTeam(b.team); } catch (e) { throw bad(e.message); }
    if (b.params != null && (typeof b.params !== "object" || Array.isArray(b.params))) throw bad("params must be an object { part: { param: value, material? } }");
    try { out = garageLap(team, b.params || null, timings); } catch (e) { throw bad(String(e.message || e)); }
    return ok(c, out);
  });
  app.post("/api/concept/engine/run", async c => {
    const b = await body(c);
    if (active) throw new ApiError("BAD_INPUT", "an engine run is already running: " + active.id + " (stop it first)", { run_id: active.id });
    const mode = b.mode;
    const r = mode === "speed" ? startSpeed(b) : mode === "auto" ? startAuto(b) : (() => { throw bad("mode must be \"speed\" or \"auto\""); })();
    return ok(c, view(r));
  });
  app.post("/api/concept/engine/run/:id/stop", c => {
    const r = runs.get(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "no engine run " + c.req.param("id"));
    if (r.status === "running" && !r.stopRequested) { r.stopRequested = true; r.stop_reason = "stopped by user"; r.push("stopping", { reason: r.stop_reason }); log("concept engine " + r.id + " stop requested"); }
    return ok(c, view(r));
  });
  app.get("/api/concept/engine/runs", c => ok(c, Array.from(runs.values()).map(view).reverse()));
  app.get("/api/concept/engine/run/:id", c => {
    const r = runs.get(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "no engine run " + c.req.param("id"));
    return ok(c, Object.assign(view(r), { state: r.state, final: r.final || null, events: r.events.length }));
  });
  app.get("/api/concept/engine/run/:id/stream", c => {
    const r = runs.get(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "no engine run " + c.req.param("id"));
    return streamSSE(c, async stream => {
      const queue = r.events.slice(); let wake = null, closed = false, ended = r.status !== "running";
      const listener = ev => { if (ev === null) ended = true; else if (ev.type !== "end") queue.push(ev); if (wake) { const w = wake; wake = null; w(); } };
      r.listeners.add(listener);
      stream.onAbort(() => { closed = true; r.listeners.delete(listener); if (wake) wake(); });
      try {
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(Object.assign(view(r), { state: r.state, final: r.final || null })) });
        while (!closed) {
          while (queue.length) { const ev = queue.shift(); await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev), id: String(ev.seq) }); }
          if (ended) { await stream.writeSSE({ event: "end", data: JSON.stringify({ run_id: r.id, status: r.status, stop_reason: r.stop_reason || null }) }); break; }
          await new Promise(res => { wake = res; const t = setTimeout(res, 15000); if (t.unref) t.unref(); });
          if (!queue.length && !ended && !closed) await stream.writeSSE({ event: "ping", data: now() });
        }
      } finally { r.listeners.delete(listener); }
    });
  });
  return { runs, timings, active: () => active, budget, startSpeed, startAuto, garageLap: (team, params) => garageLap(team, params, timings), carSheet, couplingTable };
}

module.exports = { mount, trainedBudget, Timings, carSheet, couplingTable, rescore, BUDGET_TOTAL, TRAINED_RUN_CAP, LIMITS, STAGES };
