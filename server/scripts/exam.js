// PURPLE - npm run exam: 20 exam scenarios on the provider, untrained; prints n/20 (F-08). Needs data/exam.json (P2.T5).
const path = require("path");
require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, "..", ".env") });
const { createApp } = require("../app.js");
(async () => {
  const { runExam } = createApp();
  try { const r = await runExam(); console.log(`exam provider: ${r.provider}/${r.total} verdicts (${r.provider_param}/${r.total} next-parameter+direction)`); }
  catch (e) { console.error("exam: " + (e.message || e)); process.exit(2); }
})();
