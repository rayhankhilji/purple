// PURPLE - server entry: env checks (ARCHITECTURE §10, §11), then the Hono app on 127.0.0.1:PURPLE_PORT.
const path = require("path");
require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, ".env") });
const prompt = require("../lab/prompt.js");
const mock = process.env.MUBIT_MOCK === "1";
if (!mock && !process.env.MUBIT_API_KEY) { console.error("PURPLE: MUBIT_API_KEY is not set (server/.env). Refusing to start. Use MUBIT_MOCK=1 for the no-network drill."); process.exit(1); }
if (process.env.PURPLE_MODEL && process.env.PURPLE_MODEL !== prompt.MODEL) { console.error(`PURPLE: PURPLE_MODEL=${process.env.PURPLE_MODEL} differs from lab/prompt.js MODEL=${prompt.MODEL}; the model is part of the frozen task key. Refusing to start.`); process.exit(1); }
const { serve } = require("@hono/node-server");
const { createApp } = require("./app.js");
const port = parseInt(process.env.PURPLE_PORT || "8787", 10);
const { app, db } = createApp();
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, info => {
  console.log(`PURPLE server http://127.0.0.1:${info.port}  model ${prompt.MODEL}  prompt v${prompt.PROMPT_VERSION}  data ${db.dir}${mock ? "  [MUBIT_MOCK]" : ""}`);
});
