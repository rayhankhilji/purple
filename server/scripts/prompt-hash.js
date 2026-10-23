// PURPLE - G-MUBIT-01: lab/prompt.js is the frozen Mubit task key. This module pins its sha256 and PROMPT_VERSION.
// Used by server/index.js (refuses to start on a mismatch unless PURPLE_ALLOW_PROMPT_CHANGE=1), test/prompt-frozen.test.js (CI),
// and as a CLI: `node server/scripts/prompt-hash.js [--file path]` prints the hash and exits 1 on a mismatch.
// Changing the prompt creates a NEW Mubit task at 0 examples: if that is ever a team decision, log it in TASK_LOG Decisions,
// bump PROMPT_VERSION in lab/prompt.js, and update both constants here and in the test in the same commit.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const PROMPT_FILE = path.join(__dirname, "..", "..", "lab", "prompt.js");
const EXPECTED_SHA256 = "6c5be1a3f4ed0f5fb21226363fa3524404996558628bc8cba119677dfc37ce6a";   // first trained call 2026-10-23 23:33 London
const EXPECTED_VERSION = "1";
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file || PROMPT_FILE)).digest("hex");
function check(file) {
  const hash = sha256(file);
  const version = file ? null : require(PROMPT_FILE).PROMPT_VERSION;
  const ok = hash === EXPECTED_SHA256 && (file ? true : version === EXPECTED_VERSION);
  return { ok, hash, expected: EXPECTED_SHA256, version, expected_version: EXPECTED_VERSION, file: file || PROMPT_FILE };
}
module.exports = { PROMPT_FILE, EXPECTED_SHA256, EXPECTED_VERSION, sha256, check };
if (require.main === module) {
  const i = process.argv.indexOf("--file"); const r = check(i >= 0 ? process.argv[i + 1] : undefined);
  console.log(`prompt sha256 ${r.hash}${r.version ? " (PROMPT_VERSION " + r.version + ")" : ""} ${r.ok ? "== frozen task key, OK" : "!= frozen " + r.expected.slice(0, 12) + "… (G-MUBIT-01 VIOLATION)"}`);
  process.exit(r.ok ? 0 : 1);
}
