// PURPLE CONCEPT DESIGNER - the "changes only" designer task (a SECOND Mubit designer task; owner decision 2026-10-24 ~00:00 BST).
// FROZEN · DESIGNER_PROMPT_VERSION "compact-1" · 2026-10-24. Never edit SYSTEM_PROMPT, MODEL, MAX_TOKENS or TEMPERATURE: the task key
// sha256 is pinned in test/concept-designer-compact-frozen.test.js. Same API as concept/designer/prompt.js (v1, frozen, untouched,
// still the website's default task). Same engineering brief and scenario (the user message, concept/engineer/scenario.js) as v1;
// the answer is ONLY {"changes":[{"part","param","to"}]} with exactly ONE change (no hypothesis, no expected, no prose, no fences):
// one change in a deterministic format is far easier for Mubit's small adapter to match than v1's free-text hypothesis.
// Its own task key (different system prompt and max_tokens), so v1's kept examples are unaffected; the first 8 words (Mubit's task
// name hint) differ from v1's. Parsed by concept/designer/schema.js validateCompact (OUTPUT "compact"). No tools, no response_format.
// Dual browser / Node: window.EI.concept.designerPromptCompact and module.exports.
(function () {
  const DRAFT = false;   // FROZEN 2026-10-24; sha pinned in test/concept-designer-compact-frozen.test.js
  const DESIGNER_PROMPT_VERSION = "compact-1";
  const OUTPUT = "compact";   // which validator reads the answer (schema.validatorFor)
  const SYSTEM_PROMPT = [
    "You are the compact concept designer of a 2026 F1 car. Goal: beat the real 2026 Silverstone pole lap by the largest margin while the car stays legal under the FIA 2026 technical regulations.",
    "You receive one scenario as JSON: the current best car, its simulated lap and gap to pole (negative is ahead), recent tested changes (lap and sector deltas in s, negative is faster; kept or not; violated articles; the last is your previous proposal's result, with the segments that gained or lost most), refused proposals, near (parameters at their legal limit for this car: never go past one). Use the measured results. Propose the next change: exactly 1 parameter of the current best car. A simulator measures it and keeps it only if it is legal and faster; you do not decide. Never repeat a tested change.",
    "Return ONLY this JSON object: {\"changes\":[{\"part\":\"<part>\",\"param\":\"<param>\",\"to\":<number>}]} with exactly one change (one part, one parameter, one value; the number on the parameter's legal step). No hypothesis, no prose, no code fences.",
  ].join("\n");
  const MODEL = "claude-haiku-4-5";   // same provider model as v1; the task differs by system prompt and max_tokens
  const MAX_TOKENS = 120;             // one change is ~40 tokens
  const TEMPERATURE = 0;
  const TASK_NAME_HINT = SYSTEM_PROMPT.split(" ").slice(0, 8).join(" ");

  const taskKey = () => JSON.stringify({ system: SYSTEM_PROMPT, model: MODEL, max_tokens: MAX_TOKENS, temperature: TEMPERATURE, tools: [], response_format: null });
  function nodeCrypto() { if (typeof require !== "function") throw new Error("designer prompt: sha256 needs Node (crypto)"); return require("crypto"); }
  const taskKeySha256 = () => nodeCrypto().createHash("sha256").update(taskKey()).digest("hex");
  function fileSha256(file) {
    const fs = require("fs");
    return nodeCrypto().createHash("sha256").update(fs.readFileSync(file || __filename)).digest("hex");
  }

  const api = { DRAFT, DESIGNER_PROMPT_VERSION, OUTPUT, SYSTEM_PROMPT, DESIGNER_SYSTEM_PROMPT: SYSTEM_PROMPT, MODEL, MAX_TOKENS, TEMPERATURE, TASK_NAME_HINT, taskKey, taskKeySha256, fileSha256 };
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {}); C.designerPromptCompact = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
