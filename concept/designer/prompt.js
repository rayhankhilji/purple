// PURPLE CONCEPT DESIGNER - the designer's system prompt and the constants that would form its Mubit task key.
// FROZEN · DESIGNER_PROMPT_VERSION "1" · 2026-10-24 (owner approved the live loop and trained designer calls). Never edit SYSTEM_PROMPT, MODEL, MAX_TOKENS or TEMPERATURE: the task key
// sha256 is pinned in test/concept-designer-frozen.test.js (like lab/prompt.js). History: "0-draft" was used for untrained calls only;
// trained calls are allowed from version "1" (they still need --confirm-trained / confirm: "trained").
// This is a SEPARATE Mubit task from the research agent (lab/prompt.js, frozen, never touched by this module): a different system
// prompt is a different task key, so the research agent's kept examples are unaffected. Anything variable goes in the user message
// (the scenario, concept/designer/scenario.js), never here. No tools, no response_format.
// The prompt never asks the model for a verdict: the simulator measures every proposal and keeps it only on the numbers.
// Dual browser / Node: window.EI.concept.designerPrompt and module.exports (never window.EI.prompt, which is the research agent's).
(function () {
  const DRAFT = false;   // FROZEN 2026-10-24 (owner approved going live + trained designer calls); sha pinned in test/concept-designer-frozen.test.js
  const DESIGNER_PROMPT_VERSION = "1";
  const SYSTEM_PROMPT = [
    "You are the concept designer of a 2026 F1 car. Goal: beat the real 2026 Silverstone pole lap by the largest margin while the car stays legal under the FIA 2026 technical regulations.",
    "You receive one scenario as JSON: the current best car, its simulated lap and gap to pole (negative is ahead), recent tested changes (lap and sector deltas in s, negative is faster; kept or not; violated articles; the last is your previous proposal's result, with the segments that gained or lost most), refused proposals, near (parameters at their legal limit for this car: never go past one). Use the measured results. Propose the next change: 1 to 3 parameters of the current best car. A simulator measures it and keeps it only if it is legal and faster; you do not decide. Never repeat a tested change.",
    "Return ONLY a JSON object with exactly these keys: changes (array of 1-3 {part, param, to}), hypothesis (string, max 160 chars), expected ({lap_delta_s: -1|0|1, sector: 1|2|3}). No prose outside the JSON.",
  ].join("\n");
  const MODEL = "claude-haiku-4-5";   // same provider model as the research agent (HANDOVER §5); the task differs by system prompt
  const MAX_TOKENS = 250;             // EVAL_GUARDRAILS §4: ≤ 250 out
  const TEMPERATURE = 0;
  const TASK_NAME_HINT = SYSTEM_PROMPT.split(" ").slice(0, 8).join(" ");

  // the task key as one canonical string: what Mubit keys a task on (system prompt + tools + output format + model) plus our
  // max_tokens / temperature. Hash it to freeze it later; do not freeze while DRAFT.
  const taskKey = () => JSON.stringify({ system: SYSTEM_PROMPT, model: MODEL, max_tokens: MAX_TOKENS, temperature: TEMPERATURE, tools: [], response_format: null });
  function nodeCrypto() { if (typeof require !== "function") throw new Error("designer prompt: sha256 needs Node (crypto)"); return require("crypto"); }
  const taskKeySha256 = () => nodeCrypto().createHash("sha256").update(taskKey()).digest("hex");
  // sha256 of this file's bytes (the lab/prompt.js freeze test pins the file hash; the designer freeze test should do the same)
  function fileSha256(file) {
    const fs = require("fs");
    return nodeCrypto().createHash("sha256").update(fs.readFileSync(file || __filename)).digest("hex");
  }

  const api = { DRAFT, DESIGNER_PROMPT_VERSION, SYSTEM_PROMPT, DESIGNER_SYSTEM_PROMPT: SYSTEM_PROMPT, MODEL, MAX_TOKENS, TEMPERATURE, TASK_NAME_HINT, taskKey, taskKeySha256, fileSha256 };
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {}); C.designerPrompt = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
