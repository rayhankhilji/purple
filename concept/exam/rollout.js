// PURPLE designer exam, column C through a Mubit partial rollout: while the owner has a rollout of the designer adapter running in the
// Mubit console, each exam question is sent through the normal API (untrained: x-middleware-record: metadata) and repeated until a
// reply comes from the adapter, not the provider. server/mubit.js marks each reply served_by provider (Anthropic's own headers / msg_ id) or adapter. Writes an answers file that run.js --column adapter grades.
//   node concept/exam/rollout.js [--n 30] [--tries 12] [--questions concept/exam/questions-corrections.json] [--out FILE]
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
require("dotenv").config({ path: path.join(ROOT, "server", ".env") });
const { callMubit } = require("../../server/mubit.js");   // the only Mubit call site (G-MUBIT-06)
const P = require("../designer/prompt.js");

function args(argv) {
  const a = { n: 30, tries: 12, out: path.join(__dirname, "answers-adapter-rollout.json"), questions: path.join(__dirname, "questions.json") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--n") a.n = +argv[++i]; else if (argv[i] === "--tries") a.tries = +argv[++i]; else if (argv[i] === "--out") a.out = argv[++i]; else if (argv[i] === "--questions") a.questions = path.resolve(argv[++i]);
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (process.env.MUBIT_MOCK === "1") throw new Error("rollout exam needs the live gateway (unset MUBIT_MOCK)");
  if (!process.env.MUBIT_API_KEY) throw new Error("MUBIT_API_KEY missing (server/.env)");
  const qf = require(a.questions), qs = (qf.questions || qf).slice(0, a.n);
  const sessionId = "exam-rollout-" + Date.now().toString(36);
  const out = fs.existsSync(a.out) ? JSON.parse(fs.readFileSync(a.out, "utf8")) : {};
  const log = [];
  for (const q of qs) {
    if (out[q.id] && out[q.id].text) continue;
    for (let t = 1; t <= a.tries; t++) {
      const r = await callMubit({ userContent: q.text, sessionId, trained: false, kind: "exam-rollout", task: P });   // untrained: metadata header
      const who = r.served_by, text = r.text;
      const row = { id: q.id, try: t, served_by: who, model: r.model, mubit_request_id: r.mubit_request_id, ms: r.latency_ms };
      log.push(row); console.log(JSON.stringify(row));
      if (who === "adapter") { out[q.id] = { text, served_by: who, model: r.model, mubit_request_id: row.mubit_request_id, at: new Date().toISOString() }; fs.writeFileSync(a.out, JSON.stringify(out, null, 1)); break; }
    }
  }
  const got = qs.filter(q => out[q.id]).length;
  fs.writeFileSync(a.out.replace(/\.json$/, "-log.json"), JSON.stringify(log, null, 1));
  console.log("rollout exam: adapter answers " + got + "/" + qs.length + " · calls " + log.length + " (provider " + log.filter(r => r.served_by === "provider").length + ") -> " + path.relative(ROOT, a.out));
}
main().catch(e => { console.error("rollout exam:", e.status || "", e.message); process.exit(2); });
