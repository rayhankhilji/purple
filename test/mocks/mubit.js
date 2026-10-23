// PURPLE - Mubit stand-in for contract tests and MUBIT_MOCK=1 (TESTING_GUIDE §4). Same shape as server/mubit.js callMubit.
const CANNED = { verdict: "reject", next_parameter: "rear_wing_deg", direction: "decrease", magnitude: 4, expected_sector_effect: [0.05, -0.2, 0.03], hypothesis: "Mock: long straights punish drag more than the fast corners reward load.", reject_if: "delta_lap > 0" };
let n = 0; const queue = []; const inputs = [];
async function callMubit({ userContent, sessionId, trained, kind }) {
  n++; inputs.push({ userContent, sessionId, trained, kind });
  const next = queue.length ? queue.shift() : null;
  if (next instanceof Error) throw next;
  const text = next != null ? next : JSON.stringify(CANNED);
  return { text, kind, session_id: sessionId, mubit_request_id: "mreq_test" + String(n).padStart(6, "0"), model: "mock", input_tokens: Math.ceil(userContent.length / 4), output_tokens: 60, latency_ms: 1, trained: !!trained, stop_reason: "end_turn", mock: true };
}
module.exports = { callMubit, CANNED, queue: (...texts) => queue.push(...texts), inputs, count: () => n, reset: () => { n = 0; queue.length = 0; inputs.length = 0; } };
