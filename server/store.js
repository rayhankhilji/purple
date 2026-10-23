// PURPLE - JSONL / JSON storage under data/ (ARCHITECTURE §4, §2). Append-only JSONL; a later row with the same id supersedes.
const fs = require("fs"), path = require("path");
function open(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = name => path.join(dir, name);
  const appendJsonl = (name, obj) => fs.appendFileSync(f(name), JSON.stringify(obj) + "\n");
  const readJsonl = name => { if (!fs.existsSync(f(name))) return []; const out = []; for (const line of fs.readFileSync(f(name), "utf8").split("\n")) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch (e) { /* skip a torn line */ } } return out; };
  const readJson = (name, def) => { try { return JSON.parse(fs.readFileSync(f(name), "utf8")); } catch (e) { return def; } };
  const writeJson = (name, obj) => { const tmp = f(name) + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, f(name)); return obj; };
  // ledger rows deduped by id (last wins), newest first
  const readLedger = opts => { const m = new Map(); for (const r of readJsonl("ledger.jsonl")) m.set(r.id, r); const rows = [...m.values()].sort((a, b) => (a.id < b.id ? 1 : -1)); return opts && opts.limit ? rows.slice(0, opts.limit) : rows; };
  return {
    dir,
    appendLedger: o => appendJsonl("ledger.jsonl", o), readLedger,
    findExperiment: id => readLedger().find(x => x.id === id) || null,
    appendCall: o => appendJsonl("calls.jsonl", o), readCalls: () => readJsonl("calls.jsonl"),
    readRules: () => readJson("rules.json", []), writeRules: r => writeJson("rules.json", r),
    readStatus: () => readJson("status.json", {}), writeStatus: s => writeJson("status.json", s),
    readState: def => Object.assign({}, def, readJson("state.json", {})), writeState: s => writeJson("state.json", s),
    readExam: () => readJson("exam.json", null), writeExam: e => writeJson("exam.json", e),
  };
}
module.exports = { open };
