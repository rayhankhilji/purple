// PURPLE - server entry: env checks (ARCHITECTURE §10, §11), then the Hono app on 127.0.0.1:PURPLE_PORT.
const path = require("path");
require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, ".env") });
const prompt = require("../lab/prompt.js");
const mock = process.env.MUBIT_MOCK === "1";
// the mock planner must never write into the real ledger: without an explicit PURPLE_DATA_DIR it uses data-mock/ (gitignored)
if (mock && !process.env.PURPLE_DATA_DIR) process.env.PURPLE_DATA_DIR = "./data-mock";
if (!mock && !process.env.MUBIT_API_KEY) { console.error("PURPLE: MUBIT_API_KEY is not set (server/.env). Refusing to start. Use MUBIT_MOCK=1 for the no-network drill."); process.exit(1); }
if (process.env.PURPLE_MODEL && process.env.PURPLE_MODEL !== prompt.MODEL) { console.error(`PURPLE: PURPLE_MODEL=${process.env.PURPLE_MODEL} differs from lab/prompt.js MODEL=${prompt.MODEL}; the model is part of the frozen task key. Refusing to start.`); process.exit(1); }
// G-MUBIT-01: the prompt file is the frozen task key; a changed hash means a new Mubit task at 0 examples. Refuse unless explicitly allowed.
const ph = require("./scripts/prompt-hash.js").check();
console.log(`PURPLE prompt sha256 ${ph.hash} (PROMPT_VERSION ${ph.version})${ph.ok ? "" : "  !! differs from the frozen task key " + ph.expected.slice(0, 12) + "…"}`);
if (!ph.ok && process.env.PURPLE_ALLOW_PROMPT_CHANGE !== "1") { console.error("PURPLE: lab/prompt.js or PROMPT_VERSION differs from the frozen Mubit task key (EVAL_GUARDRAILS G-MUBIT-01). Refusing to start. Revert the file, or set PURPLE_ALLOW_PROMPT_CHANGE=1 only after a logged team decision."); process.exit(1); }
if (!ph.ok) console.error("PURPLE: WARNING prompt change allowed by PURPLE_ALLOW_PROMPT_CHANGE=1: every call now trains a NEW Mubit task.");
const { serve } = require("@hono/node-server");
const { createApp } = require("./app.js");
const port = parseInt(process.env.PURPLE_PORT || "8787", 10);
const { app, db } = createApp();
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, info => {
  console.log(`PURPLE server http://127.0.0.1:${info.port}  model ${prompt.MODEL}  prompt v${prompt.PROMPT_VERSION}  data ${db.dir}${mock ? "  [MUBIT_MOCK]" : ""}`);
});
