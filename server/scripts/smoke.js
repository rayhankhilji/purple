// PURPLE - npm run smoke: ONE live Mubit call, untrained (x-middleware-record: metadata), prints the x-middleware-request-id (T-SMOKE).
const path = require("path");
require("dotenv").config({ path: process.env.PURPLE_ENV_FILE || path.join(__dirname, "..", ".env") });
const { ulid } = require("ulid");
const headless = require("../game-headless.js"), store = require("../store.js"), prompt = require("../../lab/prompt.js");
const { mockMode, resolveDataDir } = require("../app.js");   // the same MUBIT_MOCK validation and data-dir rule as the server
const mubit = mockMode() ? require("../../test/mocks/mubit.js") : require("../mubit.js");   // MUBIT_MOCK=1: the drill / the trained:false test, no network
(async () => {
  const EI = headless.load(); const { aero, schema, evaluator } = EI;
  const rd = resolveDataDir({ mock: !!mubit.CANNED }); if (rd.redirected) console.error("smoke: MUBIT_MOCK=1 with the real data/ -> using data-mock/ instead"); const db = store.open(rd.dir);
  const circuit = "silverstone", conditions = { circuit, wet: false, wind_ms: 0, wind_from_deg: 0 }, baseline = aero.BASELINE, candidate = Object.assign({}, baseline, { rear_wing_deg: 28 });
  const evaluation = evaluator.evaluate(circuit, candidate, conditions, { baseline });
  const scenario = schema.buildScenario({ circuit, conditions, baseline, baselineEval: evaluation.baseline, candidate, evaluation, rules: [], history: [] });
  const userContent = schema.serializeScenario(scenario), session_id = "smoke-" + ulid();
  console.log(`smoke: ${userContent.length} chars ≈ ${schema.approxTokens(userContent)} tokens, model ${prompt.MODEL}, untrained${mubit.CANNED ? " [MUBIT_MOCK]" : ""}`);
  try {
    const r = await mubit.callMubit({ userContent, sessionId: session_id, trained: false, kind: "smoke" });
    const v = schema.validatePlanOutput(r.text);
    db.appendCall({ id: ulid(), created_at: new Date().toISOString(), kind: "smoke", session_id, mubit_request_id: r.mubit_request_id, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, status: v.ok ? "ok" : "parse_error", trained: false });
    console.log(`smoke ${session_id} ${r.mubit_request_id} ${r.latency_ms}ms ${v.ok ? v.value.verdict : "parse_error"} untrained`);
    console.log(`x-middleware-request-id: ${r.mubit_request_id}`);
    console.log(`model: ${r.model}  tokens in/out: ${r.input_tokens}/${r.output_tokens}`);
    console.log(`output: ${r.text.slice(0, 400)}`);
    if (!v.ok) console.log(`validation: ${v.error}`);
    if (!/^mreq_/.test(r.mubit_request_id || "")) { console.error("FAIL: request id does not start with mreq_"); process.exit(1); }
    console.log("OK: metadata-recorded calls are not listed in the console's Requests page; the mreq_ id above is the proof.");
  } catch (e) { console.error(`smoke FAILED: ${e.code || ""} ${e.status || ""} ${e.message}`); if (e.code === "starter_credit_model") console.error("-> the model is not served on the starter credit (PRD A3): stop and ask Eldar/Anil."); process.exit(1); }
})();
