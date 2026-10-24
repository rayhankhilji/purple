// PURPLE CONCEPT - the designer's Mubit task key is frozen (version "1", 2026-10-24): trained designer calls exist from here on,
// so any change to the system prompt, model, max_tokens or temperature would silently start a new task. Like test/prompt-frozen.test.js.
const test = require("node:test"), assert = require("node:assert/strict");
const prompt = require("../concept/designer/prompt.js");
const FROZEN_SHA = "71d48c5addf4fa4e65f6aad45f557615f526cf669c3d28da97ec8a749a2ab920";

test("designer prompt v1 is frozen: task-key sha256 pinned, not a DRAFT", () => {
  assert.equal(prompt.DRAFT, false); assert.equal(prompt.DESIGNER_PROMPT_VERSION, "1");
  assert.equal(prompt.taskKeySha256(), FROZEN_SHA, "the designer task key changed: that is a NEW Mubit task; revert, or bump the version on purpose and log it in TASK_LOG");
  assert.equal(prompt.MODEL, "claude-haiku-4-5"); assert.equal(prompt.MAX_TOKENS, 250); assert.equal(prompt.TEMPERATURE, 0);
});
