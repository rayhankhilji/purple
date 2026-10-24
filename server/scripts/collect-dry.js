// PURPLE - node server/scripts/collect-dry.js --n 40 --seed 2 [--promote-bias 0.3] [--circuit silverstone] [--list] [--data data]
// Dry run of `npm run collect`: the same seeds, generator and evaluator, but NO Mubit call and NO write to data/. Prints the verdict
// mix the truth rule would give (promote / retest / reject), the delta_lap range, the conditions mix and the parameters moved, so the
// v2 collection can be previewed before Saturday's budget is spent. The real run is `npm run collect -- --n 40 --with-rules --promote-bias 0.3`.
const path = require("path");
require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, "..", ".env") });
const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; }; const flag = k => args.includes("--" + k);
const n = parseInt(arg("n", "40"), 10), seed = parseInt(arg("seed", "2"), 10), promote_bias = parseFloat(arg("promote-bias", "0")), circuit = arg("circuit", "silverstone");
if (!Number.isInteger(n) || n < 1) { console.error("collect-dry: --n must be an integer >= 1"); process.exit(1); }
if (!Number.isFinite(promote_bias) || promote_bias < 0 || promote_bias > 1) { console.error("collect-dry: --promote-bias must be a number between 0 and 1"); process.exit(1); }
const dataArg = (() => { const a = process.argv.slice(2), i = a.indexOf("--data"); return i >= 0 ? a[i + 1] : null; })(); if (dataArg) process.env.PURPLE_DATA_DIR = dataArg;   // --data <dir> wins over PURPLE_DATA_DIR; MUBIT_MOCK=1 without either -> data-mock/
const { createApp } = require("../app.js");
const noMubit = { callMubit: async () => { throw new Error("collect-dry never calls Mubit"); } };   // belt and braces: no planner at all
const { dryCollect, db } = createApp({ mubit: noMubit, log: () => {} });
const r = dryCollect(n, { seed, promote_bias, circuit });
const pct = v => (100 * v / Math.max(1, r.items.length)).toFixed(0) + " %";
console.log(`collect-dry: n=${n} seed=${seed} circuit=${circuit} promote_bias=${promote_bias} (same seeds as npm run collect; no Mubit call, nothing written to ${db.dir})`);
console.log(`verdicts (truth rule, |Δ| 0.03 s): promote ${r.verdicts.promote} (${pct(r.verdicts.promote)}), retest ${r.verdicts.retest} (${pct(r.verdicts.retest)}), reject ${r.verdicts.reject} (${pct(r.verdicts.reject)})`);
console.log(`delta_lap: min ${r.delta_lap.min} s, max ${r.delta_lap.max} s, mean ${r.delta_lap.mean} s; promote-biased draws ${r.biased}; illegal retries ${r.illegal_retries}`);
console.log(`conditions: dry ${r.conditions.dry}, wind ${r.conditions.wind}, wet ${r.conditions.wet}; parameters moved: ${Object.entries(r.parameters).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + v).join(", ")}`);
if (flag("list")) for (const it of r.items) console.log(`  ${it.seed}  ${it.verdict.padEnd(7)} ${String(it.delta_lap).padStart(7)}  ${it.candidate_source.padEnd(13)} ${it.change}${it.conditions.wet ? "  wet" : it.conditions.wind_ms ? "  wind " + it.conditions.wind_ms + " m/s from " + it.conditions.wind_from_deg + "°" : ""}`);
