// PURPLE CONCEPT DESIGNER - the "action-choosing" designer task (a THIRD Mubit designer task; owner request 2026-10-25).
// FROZEN · DESIGNER_PROMPT_VERSION "action-1" · 2026-10-25. Never edit SYSTEM_PROMPT, MODEL, MAX_TOKENS or TEMPERATURE: the task key
// sha256 is pinned in test/concept-designer-action-frozen.test.js. Same API as concept/designer/prompt.js (v1) and prompt-compact.js
// (compact-1), both frozen and untouched. Same engineering brief and scenario (concept/engineer/scenario.js) as they have; the user
// message adds the ACTION MENU (concept/designer/actions.js: every legal one-step change of the current best car, one line each, with a
// code that never changes between states) and the answer is ONLY one code, e.g. A07: a classification over a small stable set of
// choices, at temperature 0, with a very short answer, which is the form Mubit's small adapter can match most often.
// Its own task key (different system prompt and max_tokens); the first 8 words (Mubit's task name hint) differ from v1's and compact's.
// Parsed by concept/designer/schema.js validateAction (OUTPUT "action"), which maps the code to { part, param, to } through the
// call's own menu; an unknown code or one that is not on the menu is a parse failure (the engine's labelled fallback; never trained).
// No tools, no response_format. Dual browser / Node: window.EI.concept.designerPromptAction and module.exports.
(function () {
  const DRAFT = false;   // FROZEN 2026-10-25; sha pinned in test/concept-designer-action-frozen.test.js
  const DESIGNER_PROMPT_VERSION = "action-1";
  const OUTPUT = "action";   // which validator reads the answer (schema.validatorFor)
  const SYSTEM_PROMPT = [
    "You are the action-choosing concept designer of a 2026 F1 car. Goal: beat the real 2026 Silverstone pole lap by the largest margin while the car stays legal under the FIA 2026 technical regulations.",
    "You receive one scenario as JSON: the current best car, its simulated lap and gap to pole (negative is ahead), recent tested changes (lap and sector deltas in s, negative is faster; kept or not; violated articles; the last is your previous proposal's result, with the segments that gained or lost most), refused proposals, near (parameters at their legal limit for this car: never go past one). After it comes the ACTION MENU: one line per legal one-step change of the current best car (code, parameter, step, new value). Use the measured results. Choose the next change: exactly one action from the menu. A simulator measures it and keeps it only if it is legal and faster; you do not decide. Never repeat a tested change.",
    "Return ONLY the code of one action from the menu, for example A07. No JSON, no prose, no code fences.",
  ].join("\n");
  const MODEL = "claude-haiku-4-5";   // same provider model as v1 and compact; the task differs by system prompt and max_tokens
  const MAX_TOKENS = 16;              // one code is ~3 tokens
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
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {}); C.designerPromptAction = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
