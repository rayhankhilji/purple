#!/usr/bin/env node
// PURPLE TESTS TO POLE - build concept/benchmark/curves.json (dashboard chart data) and the tables of docs/concept/TESTS_TO_POLE.md
// from the recorded steered runs and the raw baseline runs written by concept/benchmark/run.js.
//   node concept/benchmark/report.js --raw <out dir of run.js> [--extra <dir> 1,2,3,4,5,6] [--write]
//   (prints the markdown tables; --write saves curves.json; --extra adds baseline-only seeds on this checkout's physics as context)
"use strict";
const fs = require("fs"), path = require("path");
const C = require("./curves.js"), S = require("./steered.js");

const LABEL = "physics lap sim, Silverstone, model prediction";
const BUDGETS = [500, 1000, 2000, 3500];
const METHODS = {
  steered: "Engine v2 steered by Claude (Haiku 4.5) through Mubit: recorded live trained runs (no new calls)",
  engine_noai: "Same engine v2, no AI: every direction is the engine's seeded random step (design.mutate), no canned proposals",
  cmaes: "CMA-ES with restarts (concept campaign per-seed search), surrogate pre-screen ×4, all 36 / 23 catalogue parameters at once",
};
const PHYSICS = {
  7: "pre-redesigns physics and 23-parameter catalogue (commit 5bf4b1c, the code the live seed-7 run used; baseline 88.763 s)",
  11: "redesigns physics and 36-parameter catalogue (this checkout; baseline 88.745 s)",
  12: "redesigns physics and 36-parameter catalogue (this checkout; baseline 88.745 s)",
};
const COLS = ["laps", "legal_laps", "screened", "best_s"];
const pack = pts => pts.map(p => [p.laps, p.legal_laps, p.screened, C.r3(p.best_s)]);

// extra (optional): { dir, seeds } of baseline-only runs on this checkout's physics (no steered run exists for those seeds): the
// spread of the algorithm alone, to place the steered seeds 11 and 12 in it
function build(rawDir, seeds, extra) {
  seeds = seeds || [7, 11, 12];
  const out = { label: LABEL, pole: null, budget: 3500, budgets: BUDGETS, columns: COLS, methods: METHODS, seeds: {}, aggregate: {}, paired: {} };
  for (const seed of seeds) {
    const st = S.loadRecorded(seed);
    out.pole = { code: "ANT", s: st.pole_s, what: "Antonelli's 2026 British GP pole lap (real), the target the physics lap sim's car must beat" };
    const runs = { steered: st };
    for (const m of ["engine_noai", "cmaes", "replay"]) { const f = path.join(rawDir, m + "-seed" + seed + ".json"); if (fs.existsSync(f)) runs[m] = JSON.parse(fs.readFileSync(f, "utf8")); }
    const s = { physics: PHYSICS[seed] || null, baseline_s: st.baseline_s, steered_run: { run_id: st.run_id, started_at: st.started_at, calls: st.calls, stop_reason: st.stop_reason, models: st.models }, curves: {}, summary: {} };
    const stTotal = st.points[st.points.length - 1].laps;
    for (const m of ["steered", "engine_noai", "cmaes"]) {
      if (!runs[m]) continue;
      if (runs[m].baseline_s !== st.baseline_s) throw new Error("tests-to-pole: seed " + seed + " " + m + " baseline " + runs[m].baseline_s + " != recorded " + st.baseline_s + " (different physics)");
      const full = runs[m].points, cap = m === "steered" ? null : out.budget;
      s.curves[m] = pack(cap == null ? full : C.truncate(full, cap));
      const sum = C.summarize(full, { pole_s: st.pole_s, budgets: BUDGETS, budget: cap });
      sum.best_at_steered_total = C.r3(C.bestAt(full, stTotal));
      if (m !== "steered") sum.runtime_s = runs[m].runtime_s;
      if (m === "engine_noai") Object.assign(sum, { decisions: runs[m].decisions, by: runs[m].by, kept: runs[m].kept, reverts: runs[m].reverts, forks: runs[m].forks });
      if (m === "cmaes") Object.assign(sum, { generations: runs[m].generations, restarts: runs[m].restarts.length });
      s.summary[m] = sum;
    }
    if (runs.replay) {
      const a = st.points, b = runs.replay.points;
      const same = a.length === b.length && a.every((p, i) => p.laps === b[i].laps && Math.abs(p.best_s - b[i].best_s) < 5e-4);
      s.replay_check = { reproduced: same, recorded_best_s: C.r3(a[a.length - 1].best_s), replay_best_s: C.r3(b[b.length - 1].best_s), recorded_laps: a[a.length - 1].laps, replay_laps: b[b.length - 1].laps, note: "the recorded Mubit proposals fed back to this engine/physics, no Mubit call" };
    }
    out.seeds[seed] = s;
  }
  // aggregates over seeds (lap COUNTS are comparable across the two physics versions; best-lap values are averaged per method too,
  // but seed 7 starts 18 ms slower, so the paired differences below are the fairer read)
  for (const m of Object.keys(METHODS)) {
    const rows = seeds.map(sd => out.seeds[sd].summary[m]).filter(Boolean);
    if (!rows.length) continue;
    const ag = {
      to_pole_laps: C.stats(rows.map(r => r.to_pole ? r.to_pole.laps : null)), to_pole_legal_laps: C.stats(rows.map(r => r.to_pole ? r.to_pole.legal_laps : null)),
      to_pole_screened: C.stats(rows.map(r => r.to_pole ? r.to_pole.screened : null)),
      to_best_laps: C.stats(rows.map(r => r.to_best.laps)), best_s: C.stats(rows.map(r => r.best_s)), best_at: {},
    };
    for (const B of BUDGETS) ag.best_at[B] = C.stats(rows.map(r => r.best_at[B]));
    out.aggregate[m] = ag;
  }
  // paired by seed: steered − baseline at the same physics-lap count (negative = steered faster)
  for (const m of ["engine_noai", "cmaes"]) {
    const d = {};
    for (const B of BUDGETS.concat(["steered_total"])) d[B] = C.stats(seeds.map(sd => { const x = out.seeds[sd].summary; if (!x[m]) return null; const a = B === "steered_total" ? x.steered.best_s : x.steered.best_at[B], b = B === "steered_total" ? x[m].best_at_steered_total : x[m].best_at[B]; return a == null || b == null ? null : a - b; }));
    out.paired[m] = d;
  }
  if (extra && extra.seeds && extra.seeds.length) {
    const ctx = { physics: PHYSICS[11], seeds: extra.seeds, budget: out.budget, curves: {}, summary: {}, aggregate: {} };
    for (const m of ["engine_noai", "cmaes"]) {
      ctx.curves[m] = {}; ctx.summary[m] = {};
      for (const seed of extra.seeds) {
        const f = path.join(extra.dir, m + "-seed" + seed + ".json"); if (!fs.existsSync(f)) continue;
        const r = JSON.parse(fs.readFileSync(f, "utf8"));
        if (r.baseline_s !== out.seeds[11].baseline_s) throw new Error("tests-to-pole: context seed " + seed + " ran on different physics");
        ctx.curves[m][seed] = pack(C.truncate(r.points, out.budget));
        ctx.summary[m][seed] = C.summarize(r.points, { pole_s: out.pole.s, budgets: BUDGETS, budget: out.budget });
      }
      // with seeds 11 and 12 (same physics) added: every algorithm-alone run on this checkout
      const rows = Object.values(ctx.summary[m]).concat([11, 12].filter(sd => out.seeds[sd] && out.seeds[sd].summary[m]).map(sd => out.seeds[sd].summary[m]));
      const ag = { n_runs: rows.length, to_pole_laps: C.stats(rows.map(r => r.to_pole ? r.to_pole.laps : null)), best_s: C.stats(rows.map(r => r.best_s)), best_at: {}, worst_best_s: C.r3(Math.max(...rows.map(r => r.best_s))), max_to_pole_laps: Math.max(...rows.map(r => r.to_pole ? r.to_pole.laps : Infinity)) };
      if (!isFinite(ag.max_to_pole_laps)) ag.max_to_pole_laps = null;
      for (const B of BUDGETS) ag.best_at[B] = C.stats(rows.map(r => r.best_at[B]));
      ctx.aggregate[m] = ag;
    }
    out.context = ctx;
  }
  return out;
}

const f3 = v => (v == null ? "—" : v.toFixed(3));
const fi = v => (v == null ? "—" : Math.round(v).toLocaleString("en-GB"));
const ms = (s, f) => (s.n ? f(s.mean) + (s.sd != null ? " ± " + (f === f3 ? s.sd.toFixed(3) : fi(s.sd)) : "") + (s.n < s.of ? " (n = " + s.n + " of " + s.of + ")" : "") : "none (0 of " + s.of + ")");

function markdown(o) {
  const L = [], names = { steered: "Steered (Claude via Mubit)", engine_noai: "Same engine, no AI", cmaes: "CMA-ES" };
  for (const [seed, s] of Object.entries(o.seeds)) {
    L.push("### Seed " + seed + " · " + s.physics, "");
    L.push("| method | physics laps to beat " + o.pole.s + " s (legal laps · screens) | physics laps to its best | best lap (s) | @500 | @1,000 | @2,000 | @3,500 | @ steered's total (" + fi(s.summary.steered.total_laps) + ") |");
    L.push("|---|---|---|---|---|---|---|---|---|");
    for (const m of Object.keys(names)) {
      const r = s.summary[m]; if (!r) continue;
      const tp = r.to_pole ? fi(r.to_pole.laps) + " (" + fi(r.to_pole.legal_laps) + " · " + fi(r.to_pole.screened) + ")" : "not reached in " + fi(r.total_laps);
      L.push("| " + names[m] + " | " + tp + " | " + fi(r.to_best.laps) + " | " + f3(r.best_s) + " | " + BUDGETS.map(B => f3(r.best_at[B])).join(" | ") + " | " + f3(r.best_at_steered_total) + " |");
    }
    if (s.replay_check) L.push("", "Replay check: recorded proposals fed back to this engine → " + (s.replay_check.reproduced ? "reproduced exactly" : "NOT reproduced") + " (" + f3(s.replay_check.replay_best_s) + " s at " + fi(s.replay_check.replay_laps) + " laps vs recorded " + f3(s.replay_check.recorded_best_s) + " s at " + fi(s.replay_check.recorded_laps) + ").");
    L.push("");
  }
  L.push("### Mean ± sd over seeds 7, 11, 12", "");
  L.push("| method | laps to beat pole | legal laps to beat pole | screens to beat pole | laps to its best | best lap (s) | @500 | @1,000 | @2,000 | @3,500 |");
  L.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const m of Object.keys(names)) {
    const a = o.aggregate[m]; if (!a) continue;
    L.push("| " + names[m] + " | " + ms(a.to_pole_laps, fi) + " | " + ms(a.to_pole_legal_laps, fi) + " | " + ms(a.to_pole_screened, fi) + " | " + ms(a.to_best_laps, fi) + " | " + ms(a.best_s, f3) + " | " + BUDGETS.map(B => ms(a.best_at[B], f3)).join(" | ") + " |");
  }
  L.push("", "### Paired: steered − baseline best lap at the same physics-lap count (s; negative = steered faster)", "");
  L.push("| vs | @500 | @1,000 | @2,000 | @3,500 | @ steered's own total |", "|---|---|---|---|---|---|");
  for (const m of ["engine_noai", "cmaes"]) { const d = o.paired[m]; if (!d) continue; L.push("| " + names[m] + " | " + BUDGETS.concat(["steered_total"]).map(B => ms(d[B], f3)).join(" | ") + " |"); }
  if (o.context) {
    const c = o.context;
    L.push("", "### Context: the algorithm alone over " + (c.seeds.length + 2) + " seeds on the seed-11/12 physics (seeds " + c.seeds.join(", ") + ", 11, 12)", "");
    L.push("| method | runs | laps to beat pole | slowest run's laps to beat pole | best lap (s) | slowest run's best (s) | @500 | @1,000 | @2,000 | @3,500 |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const m of ["engine_noai", "cmaes"]) { const a = c.aggregate[m]; L.push("| " + names[m] + " | " + a.n_runs + " | " + ms(a.to_pole_laps, fi) + " | " + (a.max_to_pole_laps != null ? fi(a.max_to_pole_laps) : "not reached by every run") + " | " + ms(a.best_s, f3) + " | " + f3(a.worst_best_s) + " | " + BUDGETS.map(B => ms(a.best_at[B], f3)).join(" | ") + " |"); }
    L.push("", "Per seed (laps to beat pole · best lap at 3,500):", "");
    for (const m of ["engine_noai", "cmaes"]) L.push("- " + names[m] + ": " + c.seeds.filter(sd => c.summary[m][sd]).map(sd => { const r = c.summary[m][sd]; return "seed " + sd + " " + (r.to_pole ? fi(r.to_pole.laps) : "—") + " · " + f3(r.best_s); }).join("; "));
  }
  return L.join("\n");
}

if (require.main === module) {
  const argv = process.argv.slice(2), raw = argv[argv.indexOf("--raw") + 1];
  if (!argv.includes("--raw") || !raw) { console.error("usage: node concept/benchmark/report.js --raw <dir> [--extra <dir> <seeds>] [--write]"); process.exit(2); }
  const ei = argv.indexOf("--extra"), extra = ei >= 0 ? { dir: argv[ei + 1], seeds: argv[ei + 2].split(",").map(Number) } : null;
  const o = build(raw, null, extra);
  if (argv.includes("--write")) fs.writeFileSync(path.join(__dirname, "curves.json"), JSON.stringify(o) + "\n");
  console.log(markdown(o));
}
module.exports = { build, markdown, LABEL, BUDGETS, METHODS };
