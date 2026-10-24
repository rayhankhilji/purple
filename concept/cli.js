#!/usr/bin/env node
// PURPLE CONCEPT - run the shape optimiser from the terminal.
//   node concept/cli.js --gens 200 --seed 1 --baseline redbull --sim physics --out /tmp/concept-run
// Options: --gens N (200) · --seed S (1) · --baseline redbull|generic (redbull: the RB22 / DM01 demo car) · --sim physics|v0|auto
// (auto: physics when concept/sim/ loads) · --objective weekend|quali (weekend) · --circuits a,b (silverstone; the score is always
// Silverstone's unless --score names another circuit) · --out DIR (default: <os tmp>/purple-concept/seed-S) · --lambda L (8) ·
// --sigma X (0.08) · --until gens|converged (gens) · --patience P (60) · --quiet.
// Writes DIR/lineage.jsonl (one row per generation), DIR/best.json (best design, its bench result, the diff from the baseline) and
// prints a summary table. Never writes into the repo's data/ or data-mock/ (the ledger lives there). No network.
const fs = require("fs"), os = require("os"), path = require("path");
const optimize = require("./optimize.js"), design = require("./design.js"), bench = require("./bench.js");
const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const a = { gens: 200, seed: 1, circuits: ["silverstone"], score: "silverstone", out: null, lambda: 8, sigma: 0.08, until: "gens", patience: 60, quiet: false, baseline: "redbull", sim: "auto", objective: "weekend" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--gens") { a.gens = +v; i++; } else if (k === "--seed") { a.seed = +v; i++; } else if (k === "--circuits") { a.circuits = String(v).split(",").map(s => s.trim()).filter(Boolean); i++; }
    else if (k === "--score") { a.score = v; i++; } else if (k === "--out") { a.out = v; i++; } else if (k === "--lambda") { a.lambda = +v; i++; } else if (k === "--sigma") { a.sigma = +v; i++; }
    else if (k === "--until") { a.until = v; i++; } else if (k === "--patience") { a.patience = +v; i++; } else if (k === "--quiet") a.quiet = true;
    else if (k === "--baseline") { a.baseline = v; i++; } else if (k === "--sim") { a.sim = v; i++; } else if (k === "--objective") { a.objective = v; i++; }
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error("unknown option " + k);
  }
  if (!(a.gens >= 1) || !Number.isInteger(a.gens)) throw new Error("--gens must be a positive integer");
  if (!Number.isInteger(a.seed)) throw new Error("--seed must be an integer");
  if (!["gens", "converged"].includes(a.until)) throw new Error("--until gens|converged");
  for (const c of a.circuits) if (!["silverstone", "monza"].includes(c)) throw new Error("circuit " + c + ": silverstone or monza");
  if (!["silverstone", "monza"].includes(a.score)) throw new Error("--score " + a.score + ": silverstone or monza");
  if (!["generic"].concat(Object.keys(design.TEAMS)).includes(a.baseline)) throw new Error("--baseline generic|" + Object.keys(design.TEAMS).join("|"));
  if (!["physics", "v0", "auto"].includes(a.sim)) throw new Error("--sim physics|v0|auto");
  if (!["weekend", "quali"].includes(a.objective)) throw new Error("--objective weekend|quali");
  if (!a.circuits.includes(a.score)) a.circuits.unshift(a.score);
  a.out = path.resolve(a.out || path.join(os.tmpdir(), "purple-concept", "seed-" + a.seed));
  return a;
}
// the experiment ledger lives in data/ (and the mock one in data-mock/): refuse to write anywhere inside them
function assertSafeOut(dir) {
  const real = p => { try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); } };
  let probe = dir; while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const resolved = path.join(real(probe), path.relative(probe, dir));
  for (const forbidden of ["data", "data-mock"].map(d => real(path.join(ROOT, d)))) {
    const rel = path.relative(forbidden, resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw new Error("refusing to write into " + forbidden + " (the ledger); pick another --out");
  }
  return resolved;
}

const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
function table(res, args) {
  const b = res.baseline_result, x = res.best_result, lines = [];
  lines.push("PURPLE concept · seed " + args.seed + " · " + res.generations + " generations (" + res.stopped + ") · " + res.kept + " kept · proposer " + res.proposer + " · baseline " + (res.baseline.label || res.baseline.id));
  lines.push(bench.LABEL);
  lines.push("sim: " + (x.sim_label || "") + " (" + x.sim + ") · objective: " + x.objective);
  lines.push("");
  lines.push(pad("", 30) + lpad("baseline", 12) + lpad("best", 14) + lpad("delta", 10));
  for (const c of Object.keys(x.circuits)) {
    const p = b.circuits[c], q = x.circuits[c];
    lines.push(pad(c + " lap (s)", 30) + lpad(p.lap_s.toFixed(3), 12) + lpad(q.lap_s.toFixed(3), 14) + lpad((q.lap_s - p.lap_s).toFixed(3), 10));
    lines.push(pad(c + " speed trap (km/h)", 30) + lpad(p.speed_trap_kmh, 12) + lpad(q.speed_trap_kmh, 14) + lpad((q.speed_trap_kmh - p.speed_trap_kmh).toFixed(1), 10));
    lines.push(pad(c + " min corner (km/h)", 30) + lpad(p.vmin_kmh, 12) + lpad(q.vmin_kmh, 14) + lpad((q.vmin_kmh - p.vmin_kmh).toFixed(1), 10));
  }
  lines.push(pad("gap to real 2026 pole (s)", 30) + lpad(b.weekend.gap_to_pole_s.toFixed(3), 12) + lpad(x.weekend.gap_to_pole_s.toFixed(3), 14) + "  · pole " + b.weekend.pole_code + " " + b.weekend.pole_s.toFixed(3));
  lines.push(pad(x.objective === "weekend" ? "weekend score (s)" : "pole-margin score (s)", 30) + lpad(b.score.toFixed(3), 12) + lpad(x.score.toFixed(3), 14) + lpad((x.score - b.score).toFixed(3), 10));
  lines.push(pad("grid slot (real 2026 Q)", 30) + lpad("P" + b.weekend.grid_position, 12) + lpad("P" + x.weekend.grid_position, 14) + (x.sim === "v0" ? "  · baseline anchored at pole by construction (sim v0)" : ""));
  if (b.weekend_model && x.weekend_model) {
    const bm = b.weekend_model, xm = x.weekend_model;
    lines.push(pad("weekend: quali / race", 30) + lpad("P" + bm.quali_pos + " / P" + bm.race_pos, 12) + lpad("P" + xm.quali_pos + " / P" + xm.race_pos, 14) + "  · field " + xm.field.frame + (xm.field.replaced.length ? ", our car replaces " + xm.field.replaced.join(",") : "") + " · fuel " + xm.fuel_s_per_kg + " s/kg (" + xm.fuel_basis + ")");
  }
  lines.push(pad("legal", 30) + lpad(b.legal, 12) + lpad(x.legal, 14) + "  · " + (x.violations.length ? x.violations.map(v => v.id).join(", ") : "no violations"));
  lines.push(pad("mass (kg, mass sheet)", 30) + lpad(b.mass.total_kg, 12) + lpad(x.mass.total_kg, 14) + lpad((x.mass.total_kg - b.mass.total_kg).toFixed(1), 10));
  lines.push(pad("ballast (kg)", 30) + lpad(b.mass.ballast_kg, 12) + lpad(x.mass.ballast_kg, 14) + lpad((x.mass.ballast_kg - b.mass.ballast_kg).toFixed(1), 10));
  lines.push(pad("front weight share", 30) + lpad(b.mass.front_share, 12) + lpad(x.mass.front_share, 14));
  lines.push(pad("CLA corner (m²)", 30) + lpad(cla(b.physical.aero.corner), 12) + lpad(cla(x.physical.aero.corner), 14));
  lines.push(pad("CDA corner / straight (m²)", 30) + lpad(r3(b.physical.aero.corner.CDA_m2) + "/" + r3(b.physical.aero.straight.CDA_m2), 12) + lpad(r3(x.physical.aero.corner.CDA_m2) + "/" + r3(x.physical.aero.straight.CDA_m2), 14));
  lines.push("");
  lines.push("What changed (largest moves first, share of the parameter's domain):");
  for (const d of res.diff.slice().sort((p, q) => Math.abs(q.domain_frac) - Math.abs(p.domain_frac))) lines.push("  " + design.describeChange(d) + "  (" + (d.domain_frac * 100).toFixed(0) + " %)");
  return lines.join("\n");
}
const cla = a => (a.CLA_front_m2 + a.CLA_rear_m2).toFixed(3), r3 = v => (+v).toFixed(3);

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 10).map(l => l.replace(/^\/\/ ?/, "")).join("\n")); return 0; }
  const out = assertSafeOut(args.out);
  fs.mkdirSync(out, { recursive: true });
  const lineagePath = path.join(out, "lineage.jsonl"); fs.writeFileSync(lineagePath, "");
  const t0 = Date.now();
  const res = optimize.optimize({
    gens: args.gens, seed: args.seed, lambda: args.lambda, sigma: args.sigma, until: args.until, patience: args.patience,
    team: args.baseline === "generic" ? null : args.baseline,
    bench: { circuit: args.score, circuits: args.circuits, sim: args.sim, objective: args.score === "silverstone" ? args.objective : "quali" },
    onGeneration(row) { fs.appendFileSync(lineagePath, JSON.stringify(row) + "\n"); if (!args.quiet && row.kept) process.stderr.write("gen " + row.gen + " kept  score " + row.score_after.toFixed(3) + "  " + row.hypothesis + "\n"); },
  });
  const strip = r => JSON.parse(JSON.stringify(r, (k, v) => (k === "ms" ? undefined : v)));
  fs.writeFileSync(path.join(out, "best.json"), JSON.stringify({ seed: args.seed, generations: res.generations, kept: res.kept, stopped: res.stopped, proposer: res.proposer, objective: res.objective, label: res.label, sim: res.sim, sim_label: res.sim_label, team: res.team, best: res.best, best_result: strip(res.best_result), baseline_result: strip(res.baseline_result), diff: res.diff, describe: design.describe(res.best) }, null, 2) + "\n");
  console.log(table(res, args));
  const cs = bench.cacheStats();
  if (!args.quiet) console.log("\n" + ((Date.now() - t0) / 1000).toFixed(1) + " s · physics laps run " + cs.misses + " (cache hits " + cs.hits + ")");
  console.log("\nwrote " + lineagePath + " and " + path.join(out, "best.json"));
  return 0;
}
if (require.main === module) { try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error("concept cli: " + (e.message || e)); process.exitCode = 1; } }
module.exports = { parseArgs, assertSafeOut, table, main };
