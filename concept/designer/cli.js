#!/usr/bin/env node
// PURPLE CONCEPT DESIGNER - run the LLM-designer loop from the terminal. Mock only for now (no Mubit or Anthropic call here).
//   node concept/designer/cli.js --mock --gens 30 --seed 1 --out /tmp/designer-run
// Options: --mock (required until the live wrapper exists) · --gens N (30) · --seed S (1) · --out DIR (default:
// <os tmp>/purple-designer/seed-S) · --quiet. Writes DIR/lineage.jsonl (one row per generation, with proposer llm|fallback and the
// designer note), DIR/calls.jsonl (one row per mock LLM call: session id, trained:false, scenario size, ok/reason) and DIR/best.json.
// Never writes into the repo's data/ or data-mock/ (the ledger). The mock LLM is scripted and seeded: it mostly proposes plausible
// moves but also returns prose, broken JSON, duplicates, illegal values, out-of-domain values and unknown parameters, so every
// guard in proposer.js runs.
const fs = require("fs"), os = require("os"), path = require("path");
const designer = require("./proposer.js"), designMod = require("../design.js"), conceptCli = require("../cli.js"), bench = require("../bench.js");
const prompt = require("./prompt.js");

// ---- the mock LLM: (scenarioText, { sessionId, trained }) -> text, seeded, deterministic for a given call sequence
// heuristic playbook (the mock's "taste"; directions only, the bench decides): [key, target]
const PLAYBOOK = [
  ["rear_wing.sm_delta_deg", 30], ["front_wing.sm_delta_deg", 20], ["floor.ride_height_mm", 30], ["floor.width_mm", 1900],
  ["rear_wing.chord_mm", 300], ["diffuser.expansion_deg", 17], ["sidepods.inlet_cm2", 570], ["sidepods.undercut_mm", 155],
  ["front_wing.span_mm", 1350], ["rear_wing.span_mm", 1150], ["rear_wing.endplate_top_mm", 880], ["floor.throat_mm", 80],
  ["rear_wing.aoa_deg", 22], ["front_wing.chord_mm", 520], ["front_wing.aoa_deg", 29],
];
const ILLEGAL = [["front_wing.span_mm", 1400], ["rear_wing.elements", 4], ["floor.width_mm", 2000], ["rear_wing.endplate_top_mm", 920], ["layout.wheelbase_mm", 3500]];
function mockLlm(seed, rates) {
  const R = Object.assign({ prose: 0.06, broken: 0.06, duplicate: 0.08, illegal: 0.08, clamp: 0.05, unknown: 0.03 }, rates || {});
  const rng = designMod.seededRng(((seed | 0) * 7919 + 17) >>> 0);
  const fence = s => (rng() < 0.5 ? "```json\n" + s + "\n```" : s);
  const out = (changes, hypothesis, sign, sector) => fence(JSON.stringify({ changes, hypothesis, expected: { lap_delta_s: sign, sector } }));
  const get = (sc, key) => { const [p, k] = key.split("."); return sc.best.params[p] && sc.best.params[p][k]; };
  return async function llm(text) {
    const sc = JSON.parse(text);
    let r = rng();
    if ((r -= R.prose) < 0) return "Sure! I would try a lower ride height. " + out([{ part: "floor", param: "ride_height_mm", to: 31 }], "Lower floor, more load.", -1, 2);
    if ((r -= R.broken) < 0) return "```json\n{\"changes\": [{\"part\": \"floor\", \"param\": \"width_mm\", \"to\": 18";
    if ((r -= R.duplicate) < 0 && sc.tested.length) {
      // repeat the last tested change: the same design again (rejected row) or a no-op on the new parent (kept row)
      const changes = sc.tested[sc.tested.length - 1].change.split("; ").filter(s => s.includes("->")).map(s => { const [key, ft] = s.split(" "); const [part, param] = key.split("."); return { part, param, to: +ft.split("->")[1] }; });
      if (changes.length) return out(changes, "Retry the last change.", -1, 1);
    }
    if ((r -= R.illegal) < 0) { const [key, to] = ILLEGAL[Math.floor(rng() * ILLEGAL.length)]; const [part, param] = key.split("."); return out([{ part, param, to }], "Push " + key + " past its limit for more load.", -1, 2); }
    if ((r -= R.clamp) < 0) return out([{ part: "rear_wing", param: "sm_delta_deg", to: 45 }], "Maximum straight-mode flap relief on the rear wing.", -1, 3);
    if ((r -= R.unknown) < 0) return out([{ part: "front_wing", param: "twist_deg", to: 3 }], "Twist the front wing.", -1, 1);
    // plausible move: 1-2 playbook entries not yet at their target, a fraction of the way there
    const open = PLAYBOOK.filter(([key, target]) => get(sc, key) != null && Math.abs(get(sc, key) - target) > 1e-9);
    const pool = open.length ? open : PLAYBOOK;
    const n = rng() < 0.7 ? 1 : 2, changes = [], used = new Set();
    for (let i = 0; i < n; i++) {
      const [key, target] = pool[Math.floor(rng() * pool.length)]; if (used.has(key)) continue; used.add(key);
      const [part, param] = key.split("."), cur = get(sc, key), frac = [0.25, 0.5, 1][Math.floor(rng() * 3)];
      changes.push({ part, param, to: +(cur + (target - cur) * frac).toFixed(2) });
    }
    const sector = 1 + Math.floor(rng() * 3);
    return out(changes, "Move " + changes.map(c => c.part + "." + c.param).join(" and ") + " toward the playbook target; expect a small gain.", -1, sector);
  };
}

function parseArgs(argv) {
  const a = { mock: false, gens: 30, seed: 1, out: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--mock") a.mock = true; else if (k === "--gens") { a.gens = +v; i++; } else if (k === "--seed") { a.seed = +v; i++; }
    else if (k === "--out") { a.out = v; i++; } else if (k === "--quiet") a.quiet = true; else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error("unknown option " + k);
  }
  if (!(a.gens >= 1) || !Number.isInteger(a.gens)) throw new Error("--gens must be a positive integer");
  if (!Number.isInteger(a.seed)) throw new Error("--seed must be an integer");
  a.out = path.resolve(a.out || path.join(os.tmpdir(), "purple-designer", "seed-" + a.seed));
  return a;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 9).map(l => l.replace(/^\/\/ ?/, "")).join("\n")); return 0; }
  if (!args.mock) throw new Error("only --mock is available: the live designer needs the server/mubit.js change in docs/concept/DESIGNER.md and a frozen prompt for trained calls");
  const out = conceptCli.assertSafeOut(args.out);
  fs.mkdirSync(out, { recursive: true });
  const lineagePath = path.join(out, "lineage.jsonl"), callsPath = path.join(out, "calls.jsonl");
  fs.writeFileSync(lineagePath, "");
  const res = await designer.runDesigner({
    gens: args.gens, seed: args.seed, bench: { circuit: "silverstone" },
    designer: { llm: mockLlm(args.seed), trained: false, runId: "mock-seed" + args.seed },
    onGeneration(row) {
      fs.appendFileSync(lineagePath, JSON.stringify(row) + "\n");
      if (!args.quiet) process.stderr.write("gen " + String(row.gen).padStart(3) + "  " + row.proposer.padEnd(8) + (row.kept ? " kept " : " -    ") + (row.delta_score == null ? "   illegal" : ((-row.delta_score >= 0 ? "+" : "") + (-row.delta_score).toFixed(3) + " s").padStart(10)) + (row.designer.reason ? "  (" + row.designer.reason + ")" : "") + "\n");
    },
  });
  fs.writeFileSync(callsPath, res.calls.map(c => JSON.stringify(c)).join("\n") + (res.calls.length ? "\n" : ""));
  const strip = r => JSON.parse(JSON.stringify(r, (k, v) => (k === "ms" ? undefined : v)));
  fs.writeFileSync(path.join(out, "best.json"), JSON.stringify({ seed: args.seed, mock: true, prompt_version: res.prompt_version, generations: res.generations, kept: res.kept, designer: res.designer, label: res.label, best: res.best, best_result: strip(res.best_result), baseline_result: strip(res.baseline_result), diff: res.diff }, null, 2) + "\n");
  const b = res.baseline_result.weekend, x = res.best_result.weekend, s = res.designer;
  console.log("PURPLE concept designer · MOCK LLM (no network) · prompt " + prompt.DESIGNER_PROMPT_VERSION + (prompt.DRAFT ? " (DRAFT)" : "") + " · seed " + args.seed);
  console.log(bench.LABEL);
  console.log("generations " + res.generations + " · kept " + res.kept + " · llm calls " + s.llm_calls + " · llm proposals measured " + s.llm_accepted + " · fallback " + s.fallback + " · reasons " + JSON.stringify(s.reasons));
  console.log("Silverstone lap " + b.lap_s.toFixed(3) + " s -> " + x.lap_s.toFixed(3) + " s (" + (x.lap_s - b.lap_s).toFixed(3) + " s), gap to the real 2026 pole " + x.gap_to_pole_s.toFixed(3) + " s, P" + x.grid_position);
  console.log("kept by proposer: " + JSON.stringify(res.lineage.filter(r => r.kept).reduce((m, r) => { m[r.proposer] = (m[r.proposer] || 0) + 1; return m; }, {})));
  console.log("wrote " + lineagePath + ", " + callsPath + " and " + path.join(out, "best.json"));
  return 0;
}
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error("designer cli: " + (e.message || e)); process.exitCode = 1; });
module.exports = { mockLlm, parseArgs, main, PLAYBOOK, ILLEGAL };
