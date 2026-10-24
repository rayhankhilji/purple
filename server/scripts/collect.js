// PURPLE - npm run collect -- --n 50 --confirm-trained [--with-rules] [--seed 7] [--circuit silverstone] [--promote-bias 0.3] [--data data] : scenario generator -> /api/plan, concurrency 2.
// Trained calls (no metadata header): these are the examples the Mubit task learns from. Check the console's Tasks page after.
const path = require("path");
require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, "..", ".env") });
const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; }; const flag = k => args.includes("--" + k);
if (!process.env.MUBIT_API_KEY && process.env.MUBIT_MOCK !== "1") { console.error("collect: MUBIT_API_KEY missing (server/.env)"); process.exit(1); }
const dataArg = (() => { const a = process.argv.slice(2), i = a.indexOf("--data"); return i >= 0 ? a[i + 1] : null; })(); if (dataArg) process.env.PURPLE_DATA_DIR = dataArg;   // --data <dir> wins over PURPLE_DATA_DIR; MUBIT_MOCK=1 without either -> data-mock/
const { createApp } = require("../app.js");
(async () => {
  const n = parseInt(arg("n", "50"), 10), seed = parseInt(arg("seed", String(Date.now() % 100000)), 10), promote_bias = parseFloat(arg("promote-bias", "0"));
  // audit item 2: trained calls are the task's examples and spend the budget. Say so, stay under the per-request cap, and never run past the budget.
  const MAX_N = 60, TRAINED_BUDGET = parseInt(process.env.PURPLE_TRAINED_BUDGET || "250", 10);   // 250 = the integrator's hackathon ceiling for trained calls in calls.jsonl
  if (!flag("confirm-trained")) { console.error(`collect: refusing. This sends ${n} TRAINED Mubit calls (task examples, budget). Re-run with --confirm-trained.`); process.exit(1); }
  if (!Number.isInteger(n) || n < 1 || n > MAX_N) { console.error(`collect: --n must be an integer between 1 and ${MAX_N} per run`); process.exit(1); }
  if (!Number.isFinite(promote_bias) || promote_bias < 0 || promote_bias > 1) { console.error("collect: --promote-bias must be a number between 0 and 1"); process.exit(1); }
  const { collect, db, statusView } = createApp();
  const trainedRows = db.readCalls().filter(c => c.trained === true).length, remaining = TRAINED_BUDGET - trainedRows;
  console.log(`collect: trained budget ${remaining} of ${TRAINED_BUDGET} remaining (${trainedRows} trained rows in ${db.dir}/calls.jsonl); this run sends up to ${n}`);
  if (n > remaining) { console.error(`collect: refusing. ${n} calls would exceed the remaining trained budget of ${remaining}. Lower --n, or raise PURPLE_TRAINED_BUDGET after a logged decision.`); process.exit(3); }
  console.log(`collect: n=${n} seed=${seed} circuit=${arg("circuit", "silverstone")} with_rules=${flag("with-rules")} promote_bias=${promote_bias} concurrency=2 data=${db.dir}${process.env.MUBIT_MOCK === "1" ? " [MUBIT_MOCK]" : ""}`);
  const t0 = Date.now();
  const res = await collect(n, { with_rules: flag("with-rules"), seed, circuit: arg("circuit", "silverstone"), promote_bias, pauseMs: parseInt(arg("pause", "0"), 10) });
  const s = statusView();
  console.log(`collect done in ${((Date.now() - t0) / 1000).toFixed(1)}s: sent ${res.sent}, ok ${res.ok}, parse_error ${res.parse_error}, mubit_error ${res.mubit_error}, illegal retries ${res.illegal_retries}, promote-biased ${res.biased}`);
  console.log(`calls.jsonl now ${s.calls_total} rows (${s.calls_trained} trained). Next: open the console's Tasks page, read the kept-examples count and the status line into TASK_LOG.md.`);
  if (res.mubit_error) process.exit(2);
})();
