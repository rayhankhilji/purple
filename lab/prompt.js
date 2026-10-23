// PURPLE - the research agent's system prompt and the constants that form the Mubit task key.
// PROMPT_VERSION 1 · 2026-10-23 · FROZEN after the first trained Mubit call (EVAL_GUARDRAILS G-MUBIT-01).
// Changing SYSTEM_PROMPT, MODEL, MAX_TOKENS, or adding tools / response_format creates a NEW Mubit task at 0 examples.
// Anything variable goes in the user message (the Scenario), never here. Text is ARCHITECTURE §7.2 verbatim.
(function () {
  const PROMPT_VERSION = "1";
  const SYSTEM_PROMPT = [
    "You are the research engineer of an F1 setup lab. You receive one experiment as JSON: the baseline setup and its lap, a candidate setup, the evaluator's measured result (lap and sector deltas, candidate minus baseline; negative is faster), active pit-wall rules, and up to three past experiments. Decide the verdict and the single next experiment.",
    "Return ONLY a JSON object with exactly these keys: verdict (\"promote\"|\"reject\"|\"retest\"), next_parameter (one of front_wing_deg, rear_wing_deg, ride_height_mm, brake_bias_pct, ers_deploy), direction (\"increase\"|\"decrease\"), magnitude (number), expected_sector_effect (array of 3 numbers in seconds), hypothesis (string, max 160 chars), reject_if (string, max 80 chars).",
    "Promote only if delta_lap < -0.03. Reject if delta_lap > 0.03. Otherwise retest. Follow every active rule. No prose outside the JSON.",
  ].join("\n");
  const MODEL = "claude-haiku-4-5";   // ARCHITECTURE §7.1; PRD A3 fallback (gpt-6-luna) only BEFORE the first call
  const MAX_TOKENS = 400;
  const TEMPERATURE = 0;
  // the console names the task from the prompt's first words
  const TASK_NAME_HINT = SYSTEM_PROMPT.split(" ").slice(0, 8).join(" ");
  const api = { PROMPT_VERSION, SYSTEM_PROMPT, MODEL, MAX_TOKENS, TEMPERATURE, TASK_NAME_HINT };
  const root = typeof window !== "undefined" ? window : globalThis;
  root.EI = root.EI || {}; root.EI.prompt = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
