// PURPLE - node server/scripts/snapshot.js [--out docs/ledger-snapshot] [--label freeze] [--data data]   (PURPLE_DATA_DIR is ignored on purpose: pass --data)
// P3.T6 freeze step: copies the ledger judges will see (data/ledger.jsonl, calls.jsonl, rules.json, status.json, exam.json, state.json)
// into docs/ledger-snapshot/<UTC timestamp>[-label]/ with a README.md of row counts, so the numbers in the deck and the video are
// reproducible from the repo. Read-only on data/ (copies only); never deletes anything; refuses to overwrite an existing snapshot dir.
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const FILES = ["ledger.jsonl", "calls.jsonl", "rules.json", "status.json", "exam.json", "state.json"];
const abs = p => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const readJsonl = f => fs.readFileSync(f, "utf8").split("\n").filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch (e) { return null; } });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const count = (arr, f) => arr.filter(f).length;
// { dir, files: [{ name, bytes, rows }], counts } -> README text; exported for the test
function snapshot(opts) {
  opts = opts || {};
  const dataDir = abs(opts.data || "data"), outRoot = abs(opts.out || "docs/ledger-snapshot");
  const at = opts.at || new Date(), stamp = at.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19) + "Z";
  const name = stamp + (opts.label ? "-" + String(opts.label).replace(/[^A-Za-z0-9_-]+/g, "-") : ""), dir = path.join(outRoot, name);
  if (fs.existsSync(dir)) throw new Error("snapshot dir exists, refusing to overwrite: " + dir);
  fs.mkdirSync(dir, { recursive: true });
  const files = [], missing = [];
  for (const f of FILES) {
    const src = path.join(dataDir, f); if (!fs.existsSync(src)) { missing.push(f); continue; }
    fs.copyFileSync(src, path.join(dir, f)); const bytes = fs.statSync(src).size;
    files.push({ name: f, bytes, sha256: crypto.createHash("sha256").update(fs.readFileSync(src)).digest("hex") });
  }
  const has = f => files.some(x => x.name === f);
  const ledgerRaw = has("ledger.jsonl") ? readJsonl(path.join(dataDir, "ledger.jsonl")) : [], ledgerRows = ledgerRaw.filter(Boolean);
  const byId = new Map(); for (const r of ledgerRows) byId.set(r.id, r); const experiments = [...byId.values()];
  const calls = has("calls.jsonl") ? readJsonl(path.join(dataDir, "calls.jsonl")).filter(Boolean) : [];
  const rules = has("rules.json") ? readJson(path.join(dataDir, "rules.json"), []) : [], status = has("status.json") ? readJson(path.join(dataDir, "status.json"), {}) : {}, exam = has("exam.json") ? readJson(path.join(dataDir, "exam.json"), []) : [];
  const statusOf = {}; for (const x of experiments) statusOf[x.status || "unknown"] = (statusOf[x.status || "unknown"] || 0) + 1;
  const kinds = {}; for (const c of calls) { const k = c.kind || "unknown"; kinds[k] = kinds[k] || { total: 0, trained: 0, untrained: 0 }; kinds[k].total++; if (c.trained === true) kinds[k].trained++; else kinds[k].untrained++; }
  const counts = {
    ledger_rows: ledgerRows.length, ledger_torn_lines: ledgerRaw.length - ledgerRows.length, experiments: experiments.length,
    by_status: statusOf, raced: count(experiments, x => x.measured), with_agreement_pct: count(experiments, x => x.measured && x.measured.agreement_pct != null), overruled: count(experiments, x => x.overrule), parse_error: statusOf.parse_error || 0,
    unique_session_ids: new Set(experiments.map(x => x.session_id).filter(Boolean)).size, mubit_request_ids: count(experiments, x => /^mreq_/.test(x.mubit_request_id || "")),
    calls: { total: calls.length, trained: count(calls, c => c.trained === true), untrained: count(calls, c => c.trained !== true), by_kind: kinds },
    rules: { total: rules.length, active: count(rules, r => r.active) }, exam_items: Array.isArray(exam) ? exam.length : 0,
    status: { task_name: status.task_name || null, kept_examples: status.kept_examples ?? null, adapter_version: status.adapter_version || null, test_result: status.test_result || null, exam: status.exam || null, last_console_read_at: status.last_console_read_at || null },
  };
  let commit = null; try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (e) { /* no git */ }
  let promptHash = null; try { promptHash = require("./prompt-hash.js").check().hash; } catch (e) { /* keep null */ }
  const model = "reduced-order lap model · calibrated to 2026 pole laps · aero map v1";
  const lines = [
    `# PURPLE ledger snapshot ${name}`, "",
    `Taken ${at.toISOString()} from \`${path.relative(ROOT, dataDir) || "data"}/\`${commit ? " at commit `" + commit + "`" : ""}. Copies only; the live files stay in \`data/\` (gitignored).`,
    promptHash ? `Frozen task key: \`lab/prompt.js\` sha256 \`${promptHash}\`.` : "", `Evaluator label: ${model}.`, "",
    "## Files", "", "| File | Bytes | sha256 |", "|---|---|---|", ...files.map(f => `| \`${f.name}\` | ${f.bytes} | \`${f.sha256.slice(0, 16)}…\` |`),
    missing.length ? `\nNot present in data/: ${missing.map(m => "`" + m + "`").join(", ")}.` : "", "",
    "## Counts", "",
    `- Ledger: ${counts.ledger_rows} rows (append-only; later rows with the same id supersede) → **${counts.experiments} experiments**${counts.ledger_torn_lines ? ` (${counts.ledger_torn_lines} unreadable lines skipped)` : ""}.`,
    `- By status: ${Object.entries(statusOf).sort().map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`,
    `- Raced (measured block): ${counts.raced}, with agreement_pct: ${counts.with_agreement_pct}; overruled: ${counts.overruled}; parse errors: ${counts.parse_error}.`,
    `- Session ids: ${counts.unique_session_ids} unique of ${counts.experiments} (G-MUBIT-03); rows with an \`mreq_\` id: ${counts.mubit_request_ids}.`,
    `- Mubit calls: ${counts.calls.total} (${counts.calls.trained} trained, ${counts.calls.untrained} untrained). By kind: ${Object.entries(kinds).sort().map(([k, v]) => `${k} ${v.total} (${v.trained} trained)`).join(", ") || "none"}.`,
    `- Rules: ${counts.rules.total} (${counts.rules.active} active). Exam items: ${counts.exam_items}.`,
    `- Console (status.json): task "${counts.status.task_name || "—"}", kept examples ${counts.status.kept_examples ?? "—"}, adapter ${counts.status.adapter_version || "—"}, test result ${counts.status.test_result || "—"}, exam ${counts.status.exam ? JSON.stringify(counts.status.exam) : "—"}, last console read ${counts.status.last_console_read_at || "—"}.`,
    "", "Every number in the lab, the deck and this snapshot comes from the reduced-order lap model named above (its label travels with every value) and from the measured game races.", "",
  ].filter(l => l !== null && l !== undefined);
  fs.writeFileSync(path.join(dir, "README.md"), lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"));
  fs.writeFileSync(path.join(dir, "counts.json"), JSON.stringify(counts, null, 2) + "\n");
  return { dir, name, files, missing, counts };
}
module.exports = { snapshot, FILES };
if (require.main === module) {
  try {
    const r = snapshot({ out: arg("out"), label: arg("label"), data: arg("data") });
    console.log(`snapshot ${path.relative(ROOT, r.dir)}: ${r.files.length} files copied${r.missing.length ? " (missing: " + r.missing.join(", ") + ")" : ""}; ${r.counts.experiments} experiments, ${r.counts.calls.total} calls (${r.counts.calls.trained} trained), ${r.counts.rules.total} rules, ${r.counts.exam_items} exam items. README.md + counts.json written.`);
  } catch (e) { console.error("snapshot FAILED: " + e.message); process.exit(1); }
}
