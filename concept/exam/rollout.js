// PURPLE designer exam, column C through a Mubit partial rollout: while the owner has a rollout of the designer adapter running in the
// Mubit console, each exam question is sent through the normal API (untrained: x-middleware-record: metadata) and repeated until a
// reply comes from the adapter, not the provider. Provider replies carry Anthropic's response headers (anthropic-organization-id,
// a req_ request-id); a reply without them is counted as the adapter's. Writes an answers file that run.js --column adapter grades.
//   node concept/exam/rollout.js [--n 30] [--tries 12] [--out concept/exam/answers-adapter-rollout.json]
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
require("dotenv").config({ path: path.join(ROOT, "server", ".env") });
const Anthropic = require("@anthropic-ai/sdk");
const P = require("../designer/prompt.js");

function args(argv) {
  const a = { n: 30, tries: 12, out: path.join(__dirname, "answers-adapter-rollout.json") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--n") a.n = +argv[++i]; else if (argv[i] === "--tries") a.tries = +argv[++i]; else if (argv[i] === "--out") a.out = argv[++i];
  }
  return a;
}
const servedBy = h => (h.get("anthropic-organization-id") || /^req_/.test(h.get("request-id") || "") ? "provider" : "adapter");

async function main() {
  const a = args(process.argv.slice(2));
  if (process.env.MUBIT_MOCK === "1") throw new Error("rollout exam needs the live gateway (unset MUBIT_MOCK)");
  if (!process.env.MUBIT_API_KEY) throw new Error("MUBIT_API_KEY missing (server/.env)");
  const qf = require("./questions.json"), qs = (qf.questions || qf).slice(0, a.n);
  const client = new Anthropic({ apiKey: process.env.MUBIT_API_KEY, baseURL: process.env.MUBIT_BASE_URL || "https://api.mubit.ai/anthropic", maxRetries: 0, timeout: 60000 });
  const out = fs.existsSync(a.out) ? JSON.parse(fs.readFileSync(a.out, "utf8")) : {};
  const log = [];
  for (const q of qs) {
    if (out[q.id] && out[q.id].text) continue;
    for (let t = 1; t <= a.tries; t++) {
      const t0 = Date.now();
      const { data, response } = await client.messages.create(
        { model: P.MODEL, max_tokens: P.MAX_TOKENS, temperature: P.TEMPERATURE, system: P.SYSTEM_PROMPT, messages: [{ role: "user", content: q.text }] },
        { headers: { "x-middleware-record": "metadata" } }).withResponse();
      const who = servedBy(response.headers), text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const row = { id: q.id, try: t, served_by: who, model: data.model, mubit_request_id: response.headers.get("x-middleware-request-id"), ms: Date.now() - t0 };
      log.push(row); console.log(JSON.stringify(row));
      if (who === "adapter") { out[q.id] = { text, served_by: who, model: data.model, mubit_request_id: row.mubit_request_id, at: new Date().toISOString() }; fs.writeFileSync(a.out, JSON.stringify(out, null, 1)); break; }
    }
  }
  const got = qs.filter(q => out[q.id]).length;
  fs.writeFileSync(a.out.replace(/\.json$/, "-log.json"), JSON.stringify(log, null, 1));
  console.log("rollout exam: adapter answers " + got + "/" + qs.length + " · calls " + log.length + " (provider " + log.filter(r => r.served_by === "provider").length + ") -> " + path.relative(ROOT, a.out));
}
main().catch(e => { console.error("rollout exam:", e.status || "", e.message); process.exit(2); });
