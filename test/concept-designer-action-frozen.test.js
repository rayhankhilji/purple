// PURPLE CONCEPT - the "action-choosing" designer task (concept/designer/prompt-action.js, version "action-1", 2026-10-25) is frozen:
// its task key sha256 is pinned here, like test/concept-designer-frozen.test.js (v1) and concept-designer-compact-frozen.test.js
// (compact-1) pin theirs. Any change to its system prompt, model, max_tokens or temperature would silently start yet another Mubit task.
const test = require("node:test"), assert = require("node:assert/strict");
const action = require("../concept/designer/prompt-action.js"), v1 = require("../concept/designer/prompt.js"), compact = require("../concept/designer/prompt-compact.js");
const FROZEN_SHA = "8b431d24d96e18fbe87a2b6d706ff0c23f4b75d8a6649b1d214ee5f41cad08be";

test("action designer task is frozen: task-key sha256 pinned, not a DRAFT, its own task next to v1 and compact", () => {
  assert.equal(action.DRAFT, false); assert.equal(action.DESIGNER_PROMPT_VERSION, "action-1"); assert.equal(action.OUTPUT, "action");
  assert.equal(action.taskKeySha256(), FROZEN_SHA, "the action task key changed: that is a NEW Mubit task; revert, or bump the version on purpose and log it in TASK_LOG");
  assert.equal(action.MODEL, "claude-haiku-4-5"); assert.equal(action.MAX_TOKENS, 16); assert.equal(action.TEMPERATURE, 0);
  // a separate task: different key, different first 8 words (Mubit's task name hint); v1 and compact untouched
  assert.notEqual(action.taskKeySha256(), v1.taskKeySha256()); assert.notEqual(action.taskKeySha256(), compact.taskKeySha256());
  assert.equal(action.TASK_NAME_HINT, "You are the action-choosing concept designer of a");
  assert.notEqual(action.TASK_NAME_HINT, v1.TASK_NAME_HINT); assert.notEqual(action.TASK_NAME_HINT, compact.TASK_NAME_HINT);
  assert.equal(v1.DESIGNER_PROMPT_VERSION, "1"); assert.equal(compact.DESIGNER_PROMPT_VERSION, "compact-1");
  // the brief asks for one code from the menu and nothing else
  assert.match(action.SYSTEM_PROMPT, /ACTION MENU/); assert.match(action.SYSTEM_PROMPT, /exactly one action from the menu/);
  assert.match(action.SYSTEM_PROMPT, /Return ONLY the code of one action from the menu, for example A07\. No JSON, no prose, no code fences\./);
  assert.ok(!/1-3|1 to 3|hypothesis \(/.test(action.SYSTEM_PROMPT));
  assert.ok(!/\bCFD\b|wind tunnel|validated/i.test(action.SYSTEM_PROMPT));
  assert.deepEqual(Object.keys(JSON.parse(action.taskKey())), ["system", "model", "max_tokens", "temperature", "tools", "response_format"]);
});
