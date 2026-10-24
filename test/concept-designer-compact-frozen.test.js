// PURPLE CONCEPT - the "changes only" designer task (concept/designer/prompt-compact.js, version "compact-1", owner decision
// 2026-10-24) is frozen: its task key sha256 is pinned here, like test/concept-designer-frozen.test.js pins v1's. Any change to its
// system prompt, model, max_tokens or temperature would silently start yet another Mubit task. v1 stays as it is (its own test).
const test = require("node:test"), assert = require("node:assert/strict");
const compact = require("../concept/designer/prompt-compact.js"), v1 = require("../concept/designer/prompt.js");
const FROZEN_SHA = "0a15ee5dde74f2ab66b9f4caf888e43b0bdba2088331c3dd6f0eeb45097e5489";

test("compact designer task is frozen: task-key sha256 pinned, not a DRAFT, its own task next to v1", () => {
  assert.equal(compact.DRAFT, false); assert.equal(compact.DESIGNER_PROMPT_VERSION, "compact-1"); assert.equal(compact.OUTPUT, "compact");
  assert.equal(compact.taskKeySha256(), FROZEN_SHA, "the compact task key changed: that is a NEW Mubit task; revert, or bump the version on purpose and log it in TASK_LOG");
  assert.equal(compact.MODEL, "claude-haiku-4-5"); assert.equal(compact.MAX_TOKENS, 120); assert.equal(compact.TEMPERATURE, 0);
  // a separate task: different key, different first 8 words (Mubit's task name hint); v1 untouched
  assert.notEqual(compact.taskKeySha256(), v1.taskKeySha256());
  assert.equal(compact.TASK_NAME_HINT, "You are the compact concept designer of a");
  assert.notEqual(compact.TASK_NAME_HINT, v1.TASK_NAME_HINT);
  assert.equal(v1.DESIGNER_PROMPT_VERSION, "1");
  // the brief asks for exactly one change and nothing else
  assert.match(compact.SYSTEM_PROMPT, /exactly one change/); assert.match(compact.SYSTEM_PROMPT, /No hypothesis, no prose, no code fences\./);
  assert.ok(!/1-3|1 to 3/.test(compact.SYSTEM_PROMPT));
  assert.deepEqual(Object.keys(JSON.parse(compact.taskKey())), ["system", "model", "max_tokens", "temperature", "tools", "response_format"]);
});
