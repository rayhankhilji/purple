// PURPLE - npm run exam: 20 exam scenarios on the provider, untrained; prints n/20 (F-08). Needs data/exam.json (P2.T5).
const path = require("path");
require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, "..", ".env") });
const dataArg = (() => { const a = process.argv.slice(2), i = a.indexOf("--data"); return i >= 0 ? a[i + 1] : null; })(); if (dataArg) process.env.PURPLE_DATA_DIR = dataArg;   // --data <dir> wins over PURPLE_DATA_DIR; MUBIT_MOCK=1 without either -> data-mock/
const { createApp } = require("../app.js");
(async () => {
  const { runExam } = createApp();
  try { const r = await runExam(); console.log(`exam provider: ${r.provider}/${r.total} verdicts (${r.provider_param}/${r.total} next-parameter+direction)`); }
  catch (e) { console.error("exam: " + (e.message || e)); process.exit(2); }
})();
