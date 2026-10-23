// PURPLE - npm run collect -- --n 50 [--with-rules] [--seed 7] [--circuit silverstone] : scenario generator -> /api/plan, concurrency 2.
// Trained calls (no metadata header): these are the examples the Mubit task learns from. Check the console's Tasks page after.
const path = require("path");
require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, "..", ".env") });
const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; }; const flag = k => args.includes("--" + k);
if (!process.env.MUBIT_API_KEY && process.env.MUBIT_MOCK !== "1") { console.error("collect: MUBIT_API_KEY missing (server/.env)"); process.exit(1); }
const { createApp } = require("../app.js");
(async () => {
  const n = parseInt(arg("n", "50"), 10), seed = parseInt(arg("seed", String(Date.now() % 100000)), 10);
  const { collect, db, statusView } = createApp();
  console.log(`collect: n=${n} seed=${seed} circuit=${arg("circuit", "silverstone")} with_rules=${flag("with-rules")} concurrency=2 data=${db.dir}${process.env.MUBIT_MOCK === "1" ? " [MUBIT_MOCK]" : ""}`);
  const t0 = Date.now();
  const res = await collect(n, { with_rules: flag("with-rules"), seed, circuit: arg("circuit", "silverstone"), pauseMs: parseInt(arg("pause", "0"), 10) });
  const s = statusView();
  console.log(`collect done in ${((Date.now() - t0) / 1000).toFixed(1)}s: sent ${res.sent}, ok ${res.ok}, parse_error ${res.parse_error}, mubit_error ${res.mubit_error}, illegal retries ${res.illegal_retries}`);
  console.log(`calls.jsonl now ${s.calls_total} rows (${s.calls_trained} trained). Next: open the console's Tasks page, read the kept-examples count and the status line into TASK_LOG.md.`);
  if (res.mubit_error) process.exit(2);
})();
