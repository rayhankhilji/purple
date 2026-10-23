// PURPLE - G-MUBIT-01: lab/prompt.js is the frozen Mubit task key. Any edit to it (prompt text, model, max_tokens, temperature,
// even a comment) changes the sha256 below and fails CI. A legitimate change is a team decision: TASK_LOG Decisions line,
// PROMPT_VERSION bump, and new constants here AND in server/scripts/prompt-hash.js in the same commit.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const FROZEN_SHA256 = "6c5be1a3f4ed0f5fb21226363fa3524404996558628bc8cba119677dfc37ce6a";   // computed 2026-10-24 after the first trained call (P0.T6)
const ph = require("../server/scripts/prompt-hash.js");

test("G-MUBIT-01 lab/prompt.js sha256 is the frozen task key and PROMPT_VERSION is \"1\"", () => {
  const bytes = fs.readFileSync(path.join(ROOT, "lab", "prompt.js"));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), FROZEN_SHA256, "lab/prompt.js changed: this creates a NEW Mubit task at 0 examples. Revert it (EVAL_GUARDRAILS G-MUBIT-01).");
  const prompt = require("../lab/prompt.js");
  assert.equal(prompt.PROMPT_VERSION, "1"); assert.equal(prompt.MODEL, "claude-haiku-4-5"); assert.equal(prompt.MAX_TOKENS, 400); assert.equal(prompt.TEMPERATURE, 0);
  assert.match(prompt.SYSTEM_PROMPT, /^You are the research engineer of an F1 setup lab\./); assert.equal(prompt.SYSTEM_PROMPT.split("\n").length, 3);
});
test("server/scripts/prompt-hash.js pins the same constants; check() passes on the real file and fails on a changed copy", () => {
  assert.equal(ph.EXPECTED_SHA256, FROZEN_SHA256); assert.equal(ph.EXPECTED_VERSION, "1");
  const r = ph.check(); assert.equal(r.ok, true); assert.equal(r.hash, FROZEN_SHA256); assert.equal(r.version, "1");
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "purple-prompt-")), "prompt.js"); fs.writeFileSync(copy, fs.readFileSync(ph.PROMPT_FILE, "utf8").replace("Promote only if", "Promote if"));
  const bad = ph.check(copy); assert.equal(bad.ok, false); assert.notEqual(bad.hash, FROZEN_SHA256);
  const cli = spawnSync(process.execPath, [path.join(ROOT, "server", "scripts", "prompt-hash.js"), "--file", copy], { encoding: "utf8" }); assert.equal(cli.status, 1); assert.match(cli.stdout, /G-MUBIT-01 VIOLATION/);
  const okCli = spawnSync(process.execPath, [path.join(ROOT, "server", "scripts", "prompt-hash.js")], { encoding: "utf8" }); assert.equal(okCli.status, 0); assert.match(okCli.stdout, new RegExp("prompt sha256 " + FROZEN_SHA256 + " \\(PROMPT_VERSION 1\\) == frozen task key, OK"));
});
test("G-MUBIT-01 git history: lab/prompt.js has exactly one commit touching it (or git is unavailable)", () => {
  const r = spawnSync("git", ["log", "--format=%h", "--", "lab/prompt.js"], { cwd: ROOT, encoding: "utf8" }); if (r.status !== 0) return;
  const commits = r.stdout.trim().split("\n").filter(Boolean); assert.ok(commits.length <= 1, "lab/prompt.js was edited after its first commit: " + commits.join(", "));
});
