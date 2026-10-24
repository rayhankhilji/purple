#!/usr/bin/env node
// PURPLE CONCEPT CAMPAIGN - can a car that obeys the FIA 2026 technical regulations and keeps the baseline team's own power unit
// beat the real 2026 Silverstone qualifying laps (pole ANT 88.111 s; Red Bull HAD 88.746 s) ON THE PHYSICS LAP SIM?
//   node concept/campaign/run.js --seeds 1,2,3,4 --evals 3000 --baselines redbull,generic --out /tmp/purple-campaign
// Method (docs/concept/CAMPAIGN.md):
//   - search space: the 23 shape parameters (concept/campaign/space.js, box tightened by the single-number FIA limits); materials
//     (only those the bench's material guard allows) and wing volume counts are searched in the refinement;
//   - per seed: CMA-ES with restarts (baseline, wide IPOP-style, local around the incumbent, random legal start), deterministic per
//     seed; each generation draws prescreen × λ samples, the SURROGATE (concept/surrogate, physics model) ranks them for
//     PRE-SCREENING ONLY (plus a random quarter it never ranks), and the λ chosen are run on the PHYSICS LAP SIM in worker threads
//     through concept/bench.js (FIA legality, PU and material guards, energy-limit re-check): CMA-ES learns only from physics laps;
//   - refinement of the best over all seeds: wing volume counts (short CMA-ES per combination), material swaps, then a coordinate
//     pattern search (± 1…32 quantisation steps), all on the physics sim;
//   - every final number is a fresh physics sim lap of the final design (never a surrogate value), with the full legality report,
//     the PU check against the homologated PU, sector and per-segment time, and the uncertainty band (concept/campaign/uncertainty.js).
// Options: --seeds a,b (1,2,3,4) · --evals N physics laps per seed (3000) · --lambda L (16) · --prescreen K (4; 1 = no surrogate)
// · --workers W (cpus) · --baselines redbull,generic · --refine-evals N (3000) · --combo-evals N (240) · --strategy threshold
// · --out DIR (<os tmp>/purple-campaign) · --svg FILE · --summary FILE · --quiet
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const design = require("../design.js"), bench = require("../bench.js"), phys = require("../physical.js"), regs = require("../regs.js"), parts = require("../parts.js");
const sim = require("../sim/index.js");
const space = require("./space.js"), { CMA } = require("./cmaes.js"), { Pool } = require("./pool.js"), U = require("./uncertainty.js");

const CIRCUIT = "silverstone";
const r3 = v => Math.round(v * 1000) / 1000;
const CAMPAIGN_LABEL = "concept campaign v1 · CMA-ES + surrogate pre-screen · every number re-scored on the physics lap sim";

// the qualifying session's conditions (concept/data/silverstone-2026-weekend.json, mid-range of the FIA weather chart for Q;
// wind 0: speed 0.3-4.9 m/s, no direction published; recharge limit 6.5 MJ). Track temperature is not modelled by the sim.
function qualiConditions() {
  const c = (sim.loadWeekendConditions && sim.loadWeekendConditions()) || Object.assign({}, sim.DEFAULT_CONDITIONS);
  const out = Object.assign({}, c); const source = out.source || "sim DEFAULT_CONDITIONS"; delete out.source;
  return { conditions: out, source };
}
function realLaps() {
  const RP = bench.racepace()[CIRCUIT];
  return { pole: { code: RP.pole.code, s: RP.pole.s }, had: { code: "HAD", s: RP.q.HAD }, q: RP.q };
}

// cheap pre-screen of one design: legality + PU + material guards (no lap), then the surrogate's lap (NaN outside its box)
function screen(d, pre) {
  const f = design.facts(d), v = regs.checkFacts(f), pc = phys.physical(d);
  for (const x of bench.checkPU(pc, d, f.mass)) v.push(x);
  for (const x of bench.checkMaterials(d)) v.push(x);
  if (v.length) return { legal: false, f: space.penalty(v) };
  const lap = pre ? pre(bench.guardEnergy(pc)) : NaN;
  return { legal: true, f: isFinite(lap) ? lap : null };
}
function makePrescreen(opt) {
  if (opt === false || opt === null) return null;
  if (typeof opt === "function") return opt;
  const S = require("../surrogate/surrogate.js");
  return pc => S.predictLap(pc, CIRCUIT, "physics");
}
const fitness = (res, x) => (res.legal ? res.lap_s : space.penalty(res.violations)) + (x ? 0.1 * space.outside(x) : 0);

// ---- one seed: CMA-ES with restarts
async function runSeed(ctx, seed) {
  const o = ctx.opts, rng = design.seededRng(seed), base = ctx.base, x0 = space.encode(base);
  let best = { x: x0, design: base, res: ctx.baseRes, lap: ctx.baseRes.lap_s };
  let evals = 0, screened = 0;
  const trace = [{ evals: 0, best_s: best.lap }], kept = [], restarts = [];
  for (let r = 0; evals < o.evals; r++) {
    let start = x0, sigma0 = 0.15, lam = o.lambda, kind = "baseline";
    if (r === 1) { sigma0 = 0.3; lam = o.lambda * 2; kind = "baseline-wide"; }
    else if (r > 1 && r % 2 === 0) { start = best.x; sigma0 = 0.06; kind = "local"; }
    else if (r > 1) {
      kind = "random-legal"; sigma0 = 0.25; lam = Math.min(64, o.lambda * Math.pow(2, Math.floor(r / 2)));
      for (let t = 0; t < 300; t++) { const x = space.VARS.map(() => rng()); if (screen(space.decode(x, base), null).legal) { start = x; break; } }
    }
    const cma = CMA({ x0: start, sigma0, lambda: lam, rng });
    let rBest = Infinity, stale = 0, gens = 0, rEvals = 0;
    const K = ctx.pre ? Math.max(1, o.prescreen) : 1;
    while (evals < o.evals) {
      gens++;
      const xs = cma.ask(lam * K);
      let chosen;
      if (K > 1) {
        const sc = xs.map(x => screen(space.decode(x, base), ctx.pre)); screened += xs.length;
        // outside the surrogate's training box (NaN) a legal candidate gets the batch's median surrogate lap: the pre-screen is
        // blind there, so it neither favours nor buries it (the physics sim decides)
        const inBox = sc.filter(z => z.legal && z.f != null).map(z => z.f).sort((a, b) => a - b), med = inBox.length ? inBox[Math.floor(inBox.length / 2)] : 500;
        const rank = i => (sc[i].legal ? (sc[i].f == null ? med : sc[i].f) : sc[i].f);
        const order = xs.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
        const nTop = Math.ceil(0.75 * lam), rest = order.slice(nTop);
        chosen = order.slice(0, nTop);
        while (chosen.length < lam && rest.length) chosen.push(rest.splice(Math.floor(rng() * rest.length) % rest.length, 1)[0]);   // exploration: never ranked by the surrogate
      } else chosen = xs.map((_, i) => i);
      const cx = chosen.map(i => xs[i]), designs = cx.map((x, j) => space.decode(x, base, { id: "s" + seed + ".r" + r + ".g" + gens + "." + j }));
      const res = await ctx.pool.evaluate(designs, ctx.benchOpts);
      cma.tell(cx, res.map((q, j) => fitness(q, cx[j])));
      for (let j = 0; j < res.length; j++) {
        evals++; rEvals++;
        const q = res[j];
        if (q.legal && q.lap_s < best.lap - 1e-9) {
          best = { x: cx[j].map(space.clip01), design: designs[j], res: q, lap: q.lap_s };
          kept.push({ evals, restart: r, gen: gens, lap_s: q.lap_s, design: { params: designs[j].params, team: designs[j].team || null } });
        }
        if (q.legal && q.lap_s < rBest - 0.001) { rBest = q.lap_s; stale = -1; }
      }
      stale++;
      trace.push({ evals, best_s: best.lap });
      const st = cma.state();
      if (st.max_std < 2e-3 || stale >= o.patience) break;
    }
    restarts.push({ restart: r, kind, lambda: lam, sigma0, generations: gens, physics_laps: rEvals, best_s: isFinite(rBest) ? rBest : null });
    if (!o.quiet) process.stderr.write("  " + ctx.label + " seed " + seed + " restart " + r + " (" + kind + ", λ " + lam + "): " + gens + " gens, best " + (isFinite(rBest) ? rBest.toFixed(3) : "—") + " · seed best " + best.lap.toFixed(3) + " · " + evals + " laps\n");
  }
  return { seed, best_s: best.lap, best: best.design, best_res: best.res, physics_laps: evals, surrogate_screened: screened, restarts, trace, kept };
}

// ---- refinement on the physics sim: evaluate single moves, then cumulative combinations of the improving ones; take the best
async function neighbourhood(ctx, cur, moves, tag) {
  const designs = moves.map((m, i) => design.applyChanges(cur.design, m, { id: tag + "." + i }).design);
  const res = await ctx.pool.evaluate(designs, ctx.benchOpts);
  const good = res.map((q, i) => ({ i, q })).filter(z => z.q.legal && z.q.lap_s < cur.lap - 1e-6).sort((a, b) => a.q.lap_s - b.q.lap_s || a.i - b.i);
  let laps = res.length;
  if (!good.length) return { cur, improved: false, laps };
  let bestC = { design: designs[good[0].i], res: good[0].q, lap: good[0].q.lap_s, moves: [moves[good[0].i]] };
  if (good.length > 1) {
    const combos = [], used = [];
    let acc = cur.design;
    const seenParam = new Set();
    for (const g of good.slice(0, 10)) {
      const key = moves[g.i].map(c => c.part + "." + c.param).join(","); if (seenParam.has(key)) continue; seenParam.add(key);
      acc = design.applyChanges(acc, moves[g.i], { id: tag + ".c" + combos.length }).design; used.push(moves[g.i]);
      if (used.length >= 2) combos.push({ design: acc, moves: used.slice() });
    }
    const cres = await ctx.pool.evaluate(combos.map(c => c.design), ctx.benchOpts); laps += cres.length;
    cres.forEach((q, i) => { if (q.legal && q.lap_s < bestC.lap - 1e-9) bestC = { design: combos[i].design, res: q, lap: q.lap_s, moves: combos[i].moves }; });
  }
  return { cur: { design: bestC.design, res: bestC.res, lap: bestC.lap }, improved: true, laps, moves: bestC.moves };
}
function coordinateMoves(d) {
  const out = [];
  for (const v of space.VARS) {
    const c = d.params[v.part][v.param], mult = v.int ? [1, 2] : [1, 2, 4, 8, 16, 32];
    for (const m of mult) for (const s of [-1, 1]) { const to = c + s * m * v.step; if (to >= v.lo - 1e-9 && to <= v.hi + 1e-9) out.push([{ part: v.part, param: v.param, to }]); }
  }
  return out;
}
function materialMoves(d) {
  const out = [], M = require("../materials.js");
  for (const p of space.MATERIAL_PARTS) { const cur = M.materialOf(d.params, p); for (const id of space.materialOptions(p)) if (id !== cur) out.push([{ part: p, param: "material", to: id }]); }
  return out;
}
async function refine(ctx, start) {
  const o = ctx.opts, log = [];
  let cur = { design: start.design, res: start.res, lap: start.lap }, laps = 0;
  const step = (stage, r) => { laps += r.laps; if (r.improved) { cur = r.cur; log.push({ stage, lap_s: cur.lap, laps, moves: r.moves, design: { params: cur.design.params, team: cur.design.team || null } }); } return r.improved; };
  // 1. wing volume counts: a short CMA-ES from the incumbent for every other (front, rear) combination (single-volume wings lose
  //    their straight-mode flap: C3.10.10(a)(i), C3.11.6(a)(i))
  const combos = [];
  const vol = k => space.VARS.find(v => v.key === k), fv = vol("front_wing.elements"), rv = vol("rear_wing.elements");
  for (let fe = fv.lo; fe <= fv.hi; fe++) for (let re = rv.lo; re <= rv.hi; re++) {
    if (fe === cur.design.params.front_wing.elements && re === cur.design.params.rear_wing.elements) continue;
    combos.push([fe, re]);
  }
  for (let ci = 0; ci < combos.length && o.combo_evals > 0; ci++) {
    const [fe, re] = combos[ci], ch = [{ part: "front_wing", param: "elements", to: fe }, { part: "rear_wing", param: "elements", to: re }];
    if (fe < 2) ch.push({ part: "front_wing", param: "sm_delta_deg", to: 0 }); if (re < 2) ch.push({ part: "rear_wing", param: "sm_delta_deg", to: 0 });
    const d0 = design.applyChanges(cur.design, ch).design, x0 = space.encode(d0), rng = design.seededRng(1000 + ci);
    const lockI = space.VARS.findIndex(v => v.key === "front_wing.elements"), lockJ = space.VARS.findIndex(v => v.key === "rear_wing.elements");
    const cma = CMA({ x0, sigma0: 0.05, lambda: 12, rng });
    let cb = null, n = 0;
    while (n < o.combo_evals) {
      const xs = cma.ask().map(x => { const y = x.slice(); y[lockI] = x0[lockI]; y[lockJ] = x0[lockJ]; return y; });
      const ds = xs.map((x, j) => space.decode(x, d0, { id: "combo" + fe + re + "." + n + "." + j }));
      const res = await ctx.pool.evaluate(ds, ctx.benchOpts); n += res.length; laps += res.length;
      cma.tell(xs, res.map((q, j) => fitness(q, xs[j])));
      res.forEach((q, j) => { if (q.legal && (!cb || q.lap_s < cb.lap - 1e-9)) cb = { design: ds[j], res: q, lap: q.lap_s }; });
      if (cma.state().max_std < 2e-3) break;
    }
    log.push({ stage: "volumes " + fe + "/" + re, lap_s: cb ? cb.lap : null, laps, accepted: !!(cb && cb.lap < cur.lap - 1e-9) });
    if (cb && cb.lap < cur.lap - 1e-9) { cur = cb; log[log.length - 1].design = { params: cur.design.params, team: cur.design.team || null }; }
  }
  // 2-3. materials, then coordinates, until neither improves (or the budget is spent)
  for (let round = 0; round < 6 && laps < o.refine_evals; round++) {
    let any = false;
    if (step("materials", await neighbourhood(ctx, cur, materialMoves(cur.design), "mat" + round))) any = true;
    for (let sweep = 0; sweep < 40 && laps < o.refine_evals; sweep++) { if (!step("coordinate", await neighbourhood(ctx, cur, coordinateMoves(cur.design), "co" + round + "." + sweep))) break; any = true; }
    if (!any) break;
  }
  return { best: cur.design, best_res: cur.res, best_s: cur.lap, physics_laps: laps, log };
}

// ---- reporting on the final design: every number a fresh physics sim lap
function ruleValue(id, f) {
  const g = f.geometry, m = f.mass, fw = f.front_wing, rw = f.rear_wing, a = f.aero;
  const V = {
    "REG-C-WIDTH": g.half_width_mm, "REG-C-WB": g.wheelbase_mm, "REG-C-FRONT-AXLE": g.front_axle_offset_mm, "REG-C-COCKPIT": g.cockpit_len_mm, "REG-C-BULKHEAD": g.bulkhead_gap_mm,
    "REG-C-FLOOR-WIDTH": f.floor.width_mm, "REG-C-FW-ELEMENTS": fw.elements, "REG-C-FW-SPAN": fw.span_mm, "REG-C-FW-CHORD": fw.chord_mm, "REG-C-FW-SM-ENVELOPE": r3(regs.fwStraightExtent(fw)),
    "REG-C-RW-ELEMENTS": rw.elements, "REG-C-RW-SPAN": rw.span_mm, "REG-C-RW-CHORD": rw.chord_mm, "REG-C-RW-ENDPLATE": rw.endplate_top_mm,
    "REG-C-FW-FLAP": fw.elements + " volumes, flap " + fw.sm_delta_deg + "°", "REG-C-RW-FLAP": rw.elements + " volumes, flap " + rw.sm_delta_deg + "°", "REG-C-PLANK": f.plank_wear_mm,
    "REG-C-MASS-MIN": m.total_kg, "REG-C-MASS-FRONT": m.front_kg, "REG-C-MASS-REAR": m.rear_kg, "REG-C-DRIVER-MASS": m.driver_kg, "REG-C-PU-MASS": m.pu_kg,
    "REG-C-ICE-MASS": m.ice_group_kg, "REG-C-TC-MASS": m.tc_kg, "REG-C-MGUK-MASS": m.mguk_kg, "REG-C-ES-MASS": m.es_kg, "REG-C-PU-COG": m.pu_cog_z_mm, "REG-C-DRIVELINE-MASS": m.driveline_kg,
    "PKG-WB": g.wheelbase_mm, "PKG-COOLING": a && a.cooling ? r3(a.cooling.capacity / a.cooling.need) : null, "PKG-FLOOR-STALL": a ? r3(a.stall_margin_mm) : null,
    "REG-C-FW-PROFILES-Z": fw.chord_mm + " mm (limit here " + (regs.fwProfilesChordLimit ? r3(regs.fwProfilesChordLimit(fw)) : "—") + ")", "REG-C-SM-DIRECTION": "front " + fw.sm_delta_deg + "°, rear " + rw.sm_delta_deg + "°",
    "REG-C-ELEMENTS-MIN": "front " + fw.elements + ", rear " + rw.elements, "REG-C-PLANK-HOLES": g.XR - g.XPU, "REG-C-SIDEPOD-INLET": f.params && f.params.sidepods ? f.params.sidepods.inlet_cm2 : null,
    "REG-C-FLOOR-ROOF": "floor.throat_mm " + f.floor.throat_mm + " (\"above Z=0\" by its label)", "PKG-PU-FIXED": "PU rows and option as the baseline",
    "REG-C-MAT-PERMITTED": Object.keys(m.materials || {}).map(k => k + ": " + m.materials[k].material).join(", ") || "baseline materials",
  };
  return Object.prototype.hasOwnProperty.call(V, id) ? V[id] : null;
}
function ruleLimit(r, f) {
  const mm = regs.minMass("qualifying");
  if (r.id === "REG-C-FW-CHORD" || r.id === "REG-C-FW-SM-ENVELOPE") return "≤ " + r3(regs.fwChordLimit(f.front_wing.span_mm)) + " mm (at this span)";
  if (r.id === "REG-C-MASS-MIN") return "≥ " + mm.kg + " kg (726 + NTM " + mm.ntm_kg + ", estimate)";
  if (r.id === "REG-C-MASS-FRONT") return "≥ " + r3(0.44 * mm.kg) + " kg";
  if (r.id === "REG-C-MASS-REAR") return "≥ " + r3(0.54 * mm.kg) + " kg";
  if (r.id === "PKG-WB") return "≥ " + r3(f.geometry.wheelbase_min_mm) + " mm";
  if (r.kind === "range") return r.min + "–" + r.max + " " + (r.unit || "");
  if (r.value === undefined) return r.kind === "requires" ? "required" : "—";
  const op = { max: "≤", min: "≥", "count-max": "≤", requires: "≥", info: "" }[r.kind] || "";
  return (op ? op + " " : "") + r.value + " " + (r.unit || "");
}
// the full legality report: every rule regs.js knows (FIA articles + model rules), plus the campaign guards
function legalityReport(d, violations, pc) {
  const f = design.facts(d), vio = new Map(); for (const v of violations) vio.set(v.id, v);
  if (!f.params) f.params = d.params;
  // info rules regs.checkPhysical does check on the PhysicalCar (bench runs it on every car)
  const PHYS = ["REG-C-ERS-K", "REG-C-ES-SOC", "REG-C-ES-RECHARGE", "REG-C-FUEL-FLOW"];
  const NOT_CHECKED = { "REG-C-FLOOR-ROOF": "NOT CHECKED: parameter definition conflict (FIA_CHECKLIST.md); fix pending in claude/sim-v3-fia" };
  const rows = (regs.ALL_RULES || regs.RULES.concat(regs.MODEL_RULES)).map(r => ({
    id: r.id, article: r.article, kind: r.kind, verified: r.verified, text: r.text, limit: ruleLimit(r, f),
    value: { "REG-C-ERS-K": pc.pu.mguk_kw, "REG-C-ES-SOC": pc.pu.es_soc_window_mj, "REG-C-ES-RECHARGE": pc.pu.es_harvest_mj_per_lap + " (cap; the lap's own: ENERGY-LIMIT)", "REG-C-FUEL-FLOW": "ICE " + pc.pu.ice_kw + " kW (fuel-flow curve inside the sim)" }[r.id] !== undefined
      ? { "REG-C-ERS-K": pc.pu.mguk_kw, "REG-C-ES-SOC": pc.pu.es_soc_window_mj, "REG-C-ES-RECHARGE": pc.pu.es_harvest_mj_per_lap + " (cap; the lap's own: ENERGY-LIMIT)", "REG-C-FUEL-FLOW": "ICE " + pc.pu.ice_kw + " kW (fuel-flow curve inside the sim)" }[r.id] : ruleValue(r.id, f),
    status: vio.has(r.id) ? "FAIL" : (bench.PHYSICAL_SKIP || []).includes(r.id) ? "not enforced yet (model input pending)" : NOT_CHECKED[r.id] ? NOT_CHECKED[r.id] : PHYS.includes(r.id) && regs.checkPhysical ? "pass (regs.checkPhysical on the PhysicalCar; the lap's energy: ENERGY-LIMIT)" : r.kind === "info" ? "info (recorded; " + (r.modelled_as ? "not a shape/mass check" : "not checkable here") + ")" : "pass",
  }));
  const H = bench.homologatedPU(d.team || null);
  rows.push({ id: "PU-HOMOLOGATED", article: bench.PU_RULE, kind: "campaign", verified: true, text: "PhysicalCar PU = the homologated " + H.name + " (ICE, MGU-K, ES figures, PU masses, MGU-K transmission option)", limit: "identical", value: "ICE " + pc.pu.ice_kw + " kW, MGU-K " + pc.pu.mguk_kw + " kW, ES " + pc.pu.es_soc_window_mj + " / " + pc.pu.es_harvest_mj_per_lap + " MJ", status: vio.has("PU-HOMOLOGATED") ? "FAIL" : "pass" });
  rows.push({ id: "MAT-C15", article: "C15 (materials data fia.status; homologated safety structures fixed)", kind: "campaign", verified: false, text: "Every non-baseline material is marked permitted under C15.2 in concept/data/materials-2026.json (verified: false there)", limit: "permitted", value: Object.keys(f.mass.materials || {}).map(p => p + ": " + f.mass.materials[p].material).join(", ") || "baseline materials", status: vio.has("MAT-C15") ? "FAIL" : "pass" });
  return rows;
}
function puReport(pc, team) {
  const H = bench.homologatedPU(team), sheet = null;
  return { homologated: H, car: pc.pu, identical: bench.checkPU(pc, { team, params: {} }, sheet).length === 0,
    fields: bench.PU_FIELDS.map(k => ({ field: k, homologated: H[k], car: pc.pu[k], same: Math.abs(pc.pu[k] - H[k]) <= 1e-6 * Math.max(1, Math.abs(H[k])) })) };
}
function gridOf(lap, q) { return 1 + Object.values(q).filter(x => x < lap - 1e-9).length; }

async function report(ctx, final, seeds, refineOut) {
  const best = final.design, cond = ctx.benchOpts.conditions, real = ctx.real;
  // fresh full bench (no cache) of the final design and the baseline: these are the numbers reported
  const R = bench.bench(best, Object.assign({}, ctx.benchOpts, { cache: false })), B = bench.bench(ctx.base, Object.assign({}, ctx.benchOpts, { cache: false }));
  if (!R.legal) throw new Error("concept campaign: the final design is not legal: " + R.violations.map(v => v.id).join(", "));
  const c = R.circuits[CIRCUIT], b = B.circuits[CIRCUIT];
  // and the raw sim call itself (no bench in between): must be the same lap
  const direct = sim.simulateLap(bench.guardEnergy(phys.physical(best)), CIRCUIT, cond, ctx.opts.strategy ? { strategy: ctx.opts.strategy } : undefined);
  if (Math.abs(direct.lap_s - c.lap_s) > 1e-9) throw new Error("concept campaign: bench lap " + c.lap_s + " differs from the sim's own " + direct.lap_s);
  const simOpts = ctx.opts.strategy ? { strategy: ctx.opts.strategy } : undefined;
  const noise = U.measureNoise(bench.guardEnergy(R.physical), cond, simOpts);
  const unc = U.band({ lap_s: c.lap_s, sectors_s: c.sectors_s }, { lap_s: b.lap_s, sectors_s: b.sectors_s }, ctx.team, { noise_s: noise.sigma_s, noise });
  // where the time comes from: the sim's own per-segment contributions (sim v2 contributions(car, ref): corner zones and the
  // straights between, from both cars' time traces; they add up to the lap delta), else the designer's segment cut
  let segDelta, segLabel;
  if (typeof sim.contributions === "function") {
    const k = sim.contributions(bench.guardEnergy(R.physical), bench.guardEnergy(B.physical), cond, { simOpts });
    segDelta = k.segments.map(g => ({ name: g.name, kind: g.kind, d_s: g.delta_s, s0_m: g.s0_m, s1_m: g.s1_m, min_kmh: g.min_kmh, ref_min_kmh: g.ref_min_kmh }));
    segLabel = "physics lap sim contributions(best, baseline): per corner zone (marker ±100 m) and straight, best − baseline; sum = lap delta " + k.delta_s + " s";
  } else {
    const segMod = require("../designer/segments.js"), segB = segMod.segmentTimes(ctx.base, { conditions: cond }), segX = segMod.segmentTimes(best, { conditions: cond });
    segDelta = segMod.segmentDelta(segB, segX); segLabel = "per-segment time, physics sim time-at-distance (concept/designer/segments.js), best − baseline";
  }
  const diff = design.diff(ctx.base, best).map(d0 => {
    const v = space.VARS.find(q => q.part === d0.part && q.param === d0.param);
    const edge = v && v.tightened_by.length && (Math.abs(d0.to - v.hi) < 1e-9 || Math.abs(d0.to - v.lo) < 1e-9) ? v.tightened_by.join("; ") : v && (Math.abs(d0.to - v.domain[0]) < 1e-9 || Math.abs(d0.to - v.domain[1]) < 1e-9) ? "model domain edge" : null;
    return Object.assign({}, d0, { text: design.describeChange(d0), at_limit: edge });
  });
  // surrogate's view of the final car (information only)
  let surrogate = null;
  try { const S = require("../surrogate/surrogate.js"); const p = S.predictLap(bench.guardEnergy(R.physical), CIRCUIT, "physics"); surrogate = { lap_s: isFinite(p) ? r3(p) : null, minus_physics_s: isFinite(p) ? r3(p - c.lap_s) : null }; } catch (e) { surrogate = { error: String(e.message || e) }; }
  // sensitivities (physics sim, same final design): wind, energy strategy, the concept aero map's gains halved
  const sens = {};
  if (!ctx.opts.no_sensitivity) {
    const wind = [];
    for (let deg = 0; deg < 360; deg += 45) {
      const co = Object.assign({}, cond, { wind_ms: 2.6, wind_from_deg: deg }), o2 = Object.assign({}, ctx.benchOpts, { conditions: co, cache: false });
      const x = bench.bench(best, o2), y = bench.bench(ctx.base, o2);
      wind.push({ from_deg: deg, best_s: x.legal ? x.circuits[CIRCUIT].lap_s : null, baseline_s: y.circuits[CIRCUIT].lap_s, delta_s: x.legal ? r3(x.circuits[CIRCUIT].lap_s - y.circuits[CIRCUIT].lap_s) : null });
    }
    sens.wind = { wind_ms: 2.6, basis: "mid of the Q chart's 0.3-4.9 m/s; direction not published (chart: variable, E/S to N/W), so 8 directions", rows: wind };
    sens.strategy = ["threshold", "marginal", "optimal"].map(s => {
      const o2 = Object.assign({}, ctx.benchOpts, { strategy: s, cache: false }), x = bench.bench(best, o2), y = bench.bench(ctx.base, o2);
      return { strategy: s, calibrated: s === "threshold", best_s: x.legal ? x.circuits[CIRCUIT].lap_s : null, baseline_s: y.circuits[CIRCUIT].lap_s, delta_s: x.legal ? r3(x.circuits[CIRCUIT].lap_s - y.circuits[CIRCUIT].lap_s) : null, energy_ok: x.legal };
    });
    const pB = phys.physical(ctx.base), pX = phys.physical(best), lerp = (a, z, t) => a + t * (z - a), half = JSON.parse(JSON.stringify(pX));
    for (const mode of ["corner", "straight"]) for (const k of Object.keys(pX.aero[mode])) half.aero[mode][k] = lerp(pB.aero[mode][k], pX.aero[mode][k], 0.5);
    const hl = sim.simulateLap(bench.guardEnergy(half), CIRCUIT, cond).lap_s;
    // where the time comes from, by part group: revert ONE group to the baseline, keep the rest, re-lap (physics sim). A revert that
    // makes the car illegal (e.g. a flap left on a single-volume wing) is reported as such, not lapped.
    const GROUPS = [
      ["Straight Mode flap angles", ["front_wing.sm_delta_deg", "rear_wing.sm_delta_deg"]],
      ["front wing (span, chord, setting, volumes)", ["front_wing.span_mm", "front_wing.chord_mm", "front_wing.aoa_deg", "front_wing.elements"]],
      ["rear wing (span, chord, setting, volumes, endplate)", ["rear_wing.span_mm", "rear_wing.chord_mm", "rear_wing.aoa_deg", "rear_wing.elements", "rear_wing.endplate_top_mm"]],
      ["floor and diffuser (width, throat, ride height, expansion)", ["floor.width_mm", "floor.throat_mm", "floor.ride_height_mm", "diffuser.expansion_deg"]],
      ["floor throat only (REG-C-FLOOR-ROOF not yet checkable)", ["floor.throat_mm"]],
      ["sidepods (inlet, undercut)", ["sidepods.inlet_cm2", "sidepods.undercut_mm"]],
      ["packaging (wheelbase, survival cell)", ["layout.wheelbase_mm", "survival_cell.front_axle_offset_mm", "survival_cell.cockpit_len_mm", "survival_cell.bulkhead_gap_mm"]],
      ["ballast (position, extra)", ["ballast.x_frac", "ballast.extra_kg"]],
      ["materials", "materials"],
    ];
    const M = require("../materials.js");
    sens.revert_group = GROUPS.map(([name, keys]) => {
      const ch = keys === "materials"
        ? parts.MATERIAL_PARTS.filter(p => M.materialOf(best.params, p) !== M.materialOf(ctx.base.params, p)).map(p => ({ part: p, param: "material", to: M.materialOf(ctx.base.params, p) }))
        : keys.map(k => { const [p, q] = k.split("."); return { part: p, param: q, to: ctx.base.params[p][q] }; });
      const d2 = design.applyChanges(best, ch).design, x = bench.bench(d2, Object.assign({}, ctx.benchOpts, { cache: false }));
      return { group: name, changed: design.diff(d2, best).length, lap_s: x.legal ? x.circuits[CIRCUIT].lap_s : null, cost_s: x.legal ? r3(x.circuits[CIRCUIT].lap_s - c.lap_s) : null, illegal: x.legal ? null : x.violations.map(v => v.id) };
    });
    sens.aero_half = { lap_s: hl, delta_vs_baseline_s: r3(hl - b.lap_s), basis: "what-if: the final car with its aero coefficient changes (corner and Straight Mode CLA front/rear, CDA) halved, mass and CoG as designed; physics sim" };
  }
  const H = bench.homologatedPU(ctx.team);
  return {
    team: ctx.team || "generic", baseline_label: ctx.base.label, label: CAMPAIGN_LABEL, sim_label: c.label, conditions: cond, conditions_source: ctx.conditions_source,
    strategy: ctx.opts.strategy || "threshold (the sim's calibrated default)",
    baseline: { lap_s: b.lap_s, sectors_s: b.sectors_s, speed_trap_kmh: b.speed_trap_kmh, grid_position: gridOf(b.lap_s, real.q), legal: B.legal },
    best: {
      lap_s: c.lap_s, sectors_s: c.sectors_s, speed_trap_kmh: c.speed_trap_kmh, vmax_kmh: c.vmax_kmh, vmin_kmh: c.vmin_kmh, energy: c.energy, source: "physics lap sim (fresh call, no cache) · " + CIRCUIT + " · Q conditions",
      delta_to_pole_s: r3(c.lap_s - real.pole.s), delta_to_had_s: r3(c.lap_s - real.had.s), delta_to_baseline_s: r3(c.lap_s - b.lap_s),
      sector_delta_to_baseline_s: c.sectors_s.map((s, i) => r3(s - b.sectors_s[i])),
      grid_position: gridOf(c.lap_s, real.q), grid_range_95: [gridOf(unc.band95_s[0], real.q), gridOf(unc.band95_s[1], real.q)],
      direct_sim_lap_s: direct.lap_s, mass_kg: R.mass.total_kg, ballast_kg: R.mass.ballast_kg, front_share: R.mass.front_share,
      cla_corner_m2: r3(R.physical.aero.corner.CLA_front_m2 + R.physical.aero.corner.CLA_rear_m2), cda_corner_m2: r3(R.physical.aero.corner.CDA_m2),
      cla_straight_m2: r3(R.physical.aero.straight.CLA_front_m2 + R.physical.aero.straight.CLA_rear_m2), cda_straight_m2: r3(R.physical.aero.straight.CDA_m2),
      design: { id: "campaign-best-" + (ctx.team || "generic"), label: "campaign best (" + (ctx.team || "generic") + ")", team: best.team || null, params: best.params },
    },
    baseline_physical: { cla_corner_m2: r3(B.physical.aero.corner.CLA_front_m2 + B.physical.aero.corner.CLA_rear_m2), cda_corner_m2: r3(B.physical.aero.corner.CDA_m2), cla_straight_m2: r3(B.physical.aero.straight.CLA_front_m2 + B.physical.aero.straight.CLA_rear_m2), cda_straight_m2: r3(B.physical.aero.straight.CDA_m2) },
    real: { pole: real.pole, had: real.had },
    uncertainty: unc, verdict_pole: U.verdict(unc, real.pole.s), verdict_had: U.verdict(unc, real.had.s),
    pu: Object.assign(puReport(R.physical, ctx.team), { name: H.name, guard_violations: bench.checkPU(R.physical, best, R.mass && design.facts(best).mass).length }),
    energy_check: bench.checkEnergy(c, cond),
    legality: legalityReport(best, R.violations, R.physical),
    changes: diff, segments: segDelta, segments_label: segLabel,
    surrogate, sensitivity: sens,
    seeds: seeds.map(s => ({ seed: s.seed, best_s: s.best_s, physics_laps: s.physics_laps, surrogate_screened: s.surrogate_screened, restarts: s.restarts, runtime_s: s.runtime_s })),
    refine: { start_s: refineOut.start_s, best_s: refineOut.best_s, physics_laps: refineOut.physics_laps, log: refineOut.log.map(l => ({ stage: l.stage, lap_s: l.lap_s, laps: l.laps, accepted: l.accepted, moves: l.moves })) },
  };
}

async function runBaseline(team, opts, pool, pre) {
  const t0 = Date.now(), { conditions, source } = qualiConditions();
  const benchOpts = { circuit: CIRCUIT, sim: "physics", objective: "quali", conditions };
  if (opts.strategy) benchOpts.strategy = opts.strategy;
  const base = design.baseline(team ? { team } : undefined);
  const [baseRes] = await pool.evaluate([base], benchOpts);
  if (!baseRes.legal) throw new Error("concept campaign: the " + (team || "generic") + " baseline is not legal");
  const ctx = { opts, team: team || null, base, baseRes, benchOpts, pool, pre, label: team || "generic", real: realLaps(), conditions_source: source };
  const seeds = [];
  for (const seed of opts.seeds) { const s0 = Date.now(); const s = await runSeed(ctx, seed); s.runtime_s = +((Date.now() - s0) / 1000).toFixed(1); seeds.push(s); }
  const top = seeds.slice().sort((a, b) => a.best_s - b.best_s || a.seed - b.seed)[0];
  const r0 = Date.now();
  const ref = await refine(ctx, { design: top.best, res: top.best_res, lap: top.best_s });
  ref.start_s = top.best_s; ref.runtime_s = +((Date.now() - r0) / 1000).toFixed(1);
  const rep = await report(ctx, { design: ref.best }, seeds, ref);
  rep.kept = seeds.flatMap(s => s.kept.map(k => Object.assign({ seed: s.seed }, k))).concat(ref.log.filter(l => l.design).map(l => ({ seed: "refine", stage: l.stage, lap_s: l.lap_s, design: l.design })));
  rep.trace = seeds.map(s => ({ seed: s.seed, points: s.trace }));
  rep.refine_trace = ref.log.map(l => ({ laps: l.laps, lap_s: l.lap_s }));
  rep.runtime_s = +((Date.now() - t0) / 1000).toFixed(1); rep.refine.runtime_s = ref.runtime_s;
  rep.physics_laps = seeds.reduce((s, x) => s + x.physics_laps, 0) + ref.physics_laps + 1;
  return rep;
}

// runCampaign(opts) -> { label, opts, results: { <team>: report }, runtime_s }
async function runCampaign(opts) {
  opts = Object.assign({ seeds: [1, 2, 3, 4], evals: 3000, lambda: 16, prescreen: 4, patience: 25, workers: Math.min(4, os.cpus().length), baselines: ["redbull", "generic"], refine_evals: 3000, combo_evals: 240, quiet: true }, opts || {});
  const t0 = Date.now(), pool = new Pool(opts.workers), pre = opts.prescreen > 1 ? makePrescreen(opts.surrogate) : null;
  const results = {};
  try { for (const b of opts.baselines) results[b] = await runBaseline(b === "generic" ? null : b, opts, pool, pre); }
  finally { await pool.close(); }
  return { label: CAMPAIGN_LABEL, sim_label: sim.LABEL, opts: Object.assign({}, opts, { surrogate: typeof opts.surrogate === "function" ? "custom" : opts.prescreen > 1 ? "physics surrogate (concept/surrogate/models/physics-silverstone.json)" : "none" }), results, runtime_s: +((Date.now() - t0) / 1000).toFixed(1), machine: { cpus: os.cpus().length, workers: opts.workers, node: process.version } };
}

// ---- text summary (markdown tables; docs/concept/CAMPAIGN.md quotes it)
function summaryMarkdown(out) {
  const L = [], f3 = v => (v == null ? "—" : (+v).toFixed(3)), sg = v => (v > 0 ? "+" : "") + (+v).toFixed(3);
  L.push("Source of every lap: **" + out.sim_label + "** · Silverstone · 2026 British GP qualifying conditions · " + out.label + ".", "");
  for (const k of Object.keys(out.results)) {
    const r = out.results[k], u = r.uncertainty;
    L.push("### Baseline: " + r.baseline_label, "");
    L.push("| | Lap (s) | S1 / S2 / S3 (s) | Trap (km/h) | Δ pole " + r.real.pole.s + " | Δ HAD " + r.real.had.s + " | Grid (real 2026 Q) |", "|---|---|---|---|---|---|---|");
    L.push("| baseline | " + f3(r.baseline.lap_s) + " | " + r.baseline.sectors_s.map(f3).join(" / ") + " | " + r.baseline.speed_trap_kmh + " | " + sg(r.baseline.lap_s - r.real.pole.s) + " | " + sg(r.baseline.lap_s - r.real.had.s) + " | P" + r.baseline.grid_position + " |");
    L.push("| **campaign best** | **" + f3(r.best.lap_s) + "** ± " + f3(u.sigma_s) + " (1σ) | " + r.best.sectors_s.map(f3).join(" / ") + " | " + r.best.speed_trap_kmh + " | " + sg(r.best.delta_to_pole_s) + " | " + sg(r.best.delta_to_had_s) + " | P" + r.best.grid_position + " (95 %: P" + r.best.grid_range_95[0] + "–P" + r.best.grid_range_95[1] + ") |", "");
    L.push("95 % band " + u.band95_s.map(f3).join("–") + " s. vs pole: " + r.verdict_pole.text + ". vs HAD: " + r.verdict_had.text + ".", "");
    L.push("Uncertainty components (s): transfer " + f3(u.components.transfer_s) + " (k = " + u.components.transfer_k + " × sector changes " + u.components.sector_change_s.map(sg).join(" / ") + "), fit residual RMS " + f3(u.components.fit_residual_rms_s) + ", sim noise " + f3(u.components.sim_noise_s) + " (measured on the final car), surrogate 0. Sim's held-out trace RMS " + u.heldout_trace_rms_kmh + " km/h. Known bias: anchor residual " + sg(u.anchor.residual_s) + " s (" + u.anchor.driver + "); anchor-relative lap " + f3(u.anchor.anchor_relative_lap_s) + " s; held-out sector bias " + u.sector_bias.mean_s.map(sg).join(" / ") + " s, bias-corrected sectors " + u.sector_bias.corrected_sectors_s.map(f3).join(" / ") + " s.", "");
    L.push("PU: " + r.pu.name + " — " + (r.pu.identical && r.pu.guard_violations === 0 ? "identical to the homologated PU" : "DIFFERS") + " (" + r.pu.fields.map(x => x.field + " " + x.car).join(", ") + "). Energy: deployed " + r.best.energy.deployed_mj + " MJ, recharged " + r.best.energy.harvested_mj + " MJ of " + r.best.energy.recharge_cap_mj + " MJ (" + (r.energy_check.length ? "OVER A LIMIT" : "within C5.2.9 / C5.2.10") + ").", "");
    L.push("| Part · parameter | From → to | At a limit |", "|---|---|---|");
    for (const d of r.changes.slice().sort((a, b) => Math.abs(b.domain_frac || 0) - Math.abs(a.domain_frac || 0))) L.push("| " + d.text.split(" · ")[0] + " · " + d.param + " | " + d.text.split(" · ").slice(1).join(" · ") + " | " + (d.at_limit || "") + " |");
    L.push("", "Where the time comes from (" + r.segments_label + "):", "", "| Segment | Δ time (s) |", "|---|---|");
    for (const s of r.segments) L.push("| " + s.name + " (" + s.kind + (s.s0_m != null ? ", " + s.s0_m + "–" + s.s1_m + " m" : "") + ") | " + sg(s.d_s) + (s.min_kmh != null ? " (min " + s.ref_min_kmh + " → " + s.min_kmh + " km/h)" : "") + " |");
    L.push("", "| Seed | Best lap (s) | Physics laps | Surrogate-screened | Restarts | Runtime (s) |", "|---|---|---|---|---|---|");
    for (const s of r.seeds) L.push("| " + s.seed + " | " + f3(s.best_s) + " | " + s.physics_laps + " | " + s.surrogate_screened + " | " + s.restarts.length + " | " + s.runtime_s + " |");
    L.push("| refine | " + f3(r.refine.best_s) + " (from " + f3(r.refine.start_s) + ") | " + r.refine.physics_laps + " | — | — | " + r.refine.runtime_s + " |", "");
    if (r.sensitivity.wind) {
      const ds = r.sensitivity.wind.rows.map(w => w.delta_s);
      L.push("Sensitivity (physics sim): wind " + r.sensitivity.wind.wind_ms + " m/s from 8 directions moves best − baseline between " + sg(Math.min(...ds)) + " and " + sg(Math.max(...ds)) + " s (still air " + sg(r.best.delta_to_baseline_s) + "). Strategy: " + r.sensitivity.strategy.map(s => s.strategy + (s.calibrated ? " (calibrated)" : "") + " best " + f3(s.best_s) + " / baseline " + f3(s.baseline_s) + " (Δ " + sg(s.delta_s) + ")").join("; ") + ". Aero-map gains halved: " + f3(r.sensitivity.aero_half.lap_s) + " s (Δ " + sg(r.sensitivity.aero_half.delta_vs_baseline_s) + " vs baseline). Surrogate on the final car: " + f3(r.surrogate && r.surrogate.lap_s) + " s (" + (r.surrogate && r.surrogate.minus_physics_s != null ? sg(r.surrogate.minus_physics_s) : "—") + " vs physics, information only).", "");
    }
    if (r.sensitivity.revert_group) {
      L.push("| Revert one group to the baseline (rest kept) | Lap (s) | Time the group is worth (s) |", "|---|---|---|");
      for (const g of r.sensitivity.revert_group) L.push("| " + g.group + (g.changed ? "" : " (unchanged)") + " | " + (g.lap_s == null ? "illegal (" + g.illegal.join(", ") + ")" : f3(g.lap_s)) + " | " + (g.cost_s == null ? "—" : sg(-g.cost_s)) + " |");
      L.push("");
    }
    const fails = r.legality.filter(x => x.status === "FAIL");
    L.push("Legality: " + (fails.length ? fails.length + " FAIL" : "every check passes") + " (" + r.legality.filter(x => x.status === "pass").length + " checks pass, " + r.legality.filter(x => /^info/.test(x.status)).length + " info rules recorded). Runtime " + r.runtime_s + " s, " + r.physics_laps + " physics laps.", "");
  }
  return L.join("\n");
}

function parseArgs(argv) {
  const a = { seeds: [1, 2, 3, 4], evals: 3000, lambda: 16, prescreen: 4, patience: 25, workers: Math.min(4, os.cpus().length), baselines: ["redbull", "generic"], refine_evals: 3000, combo_evals: 240, out: null, svg: null, summary: null, quiet: false, strategy: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1], num = () => { const x = +v; if (!isFinite(x)) throw new Error(k + " needs a number"); i++; return x; };
    if (k === "--seeds") { a.seeds = String(v).split(",").map(Number); i++; if (!a.seeds.every(Number.isInteger)) throw new Error("--seeds a,b,c (integers)"); }
    else if (k === "--evals") a.evals = num(); else if (k === "--lambda") a.lambda = num(); else if (k === "--prescreen") a.prescreen = num(); else if (k === "--patience") a.patience = num();
    else if (k === "--workers") a.workers = num(); else if (k === "--refine-evals") a.refine_evals = num(); else if (k === "--combo-evals") a.combo_evals = num();
    else if (k === "--baselines") { a.baselines = String(v).split(",").map(s => s.trim()); i++; }
    else if (k === "--out") { a.out = v; i++; } else if (k === "--svg") { a.svg = v; i++; } else if (k === "--summary") { a.summary = v; i++; }
    else if (k === "--strategy") { a.strategy = v; i++; } else if (k === "--quiet") a.quiet = true; else if (k === "--no-sensitivity") a.no_sensitivity = true;
    else if (k === "--help" || k === "-h") a.help = true; else throw new Error("unknown option " + k);
  }
  for (const b of a.baselines) if (b !== "generic" && !design.TEAMS[b]) throw new Error("--baselines generic|" + Object.keys(design.TEAMS).join("|"));
  if (a.strategy && !["threshold", "marginal", "optimal"].includes(a.strategy)) throw new Error("--strategy threshold|marginal|optimal (the sim's own)");
  a.out = path.resolve(a.out || path.join(os.tmpdir(), "purple-campaign"));
  return a;
}
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 19).map(l => l.replace(/^\/\/ ?/, "")).join("\n")); return 0; }
  const out = require("../cli.js").assertSafeOut(args.out); fs.mkdirSync(out, { recursive: true });
  const res = await runCampaign(args);
  fs.writeFileSync(path.join(out, "campaign.json"), JSON.stringify(res, null, 1) + "\n");
  for (const k of Object.keys(res.results)) fs.writeFileSync(path.join(out, "best-" + k + ".json"), JSON.stringify(res.results[k].best.design, null, 2) + "\n");
  const md = summaryMarkdown(res); fs.writeFileSync(path.join(out, "summary.md"), md + "\n");
  const svg = require("./plot.js").convergenceSvg(res);
  fs.writeFileSync(path.join(out, "convergence.svg"), svg);
  if (args.svg) fs.writeFileSync(path.resolve(args.svg), svg);
  if (args.summary) fs.writeFileSync(path.resolve(args.summary), md + "\n");
  console.log(md);
  console.log("\n" + res.runtime_s + " s total · wrote " + out + "/{campaign.json, summary.md, convergence.svg, best-*.json}");
  return 0;
}
if (require.main === module) main(process.argv.slice(2)).then(c => { process.exitCode = c; }, e => { console.error("concept campaign: " + (e.stack || e)); process.exitCode = 1; });
module.exports = { runCampaign, runSeed, refine, report, screen, legalityReport, summaryMarkdown, parseArgs, qualiConditions, CAMPAIGN_LABEL };
