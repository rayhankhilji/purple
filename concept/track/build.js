#!/usr/bin/env node
// PURPLE CONCEPT - builds the per-circuit track models (docs/concept/TRACK.md).
//   node concept/track/build.js                 every circuit found under concept/data/telemetry/
//   node concept/track/build.js silverstone     one circuit
//   node concept/track/build.js --check         rebuild in memory and fail if a committed model differs (no writes)
//   node concept/track/build.js --telemetry DIR  read circuits from DIR (same layout) instead of concept/data/telemetry/
// A circuit is any `<id>-circuit.json` (corner markers) in concept/data/telemetry/ or a sub-folder of it, with its qualifying lap
// files `<id>-<year>-q-<code>.json` (and optional race laps `<id>-<year>-r-<code>-lapNN.json`) beside it, in the format of
// concept/data/telemetry/README.md. Optional extras: the OSM centreline js/data/<id>.js (read through a window shim) and the
// weekend facts concept/data/<id>-<year>-weekend.json. Output: concept/data/tracks/<id>.json. Reads only; writes only that folder.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const track = require("./track.js");

const REPO = path.join(__dirname, "..", "..");
const TEL_DEFAULT = path.join(REPO, "concept", "data", "telemetry");
let TEL = TEL_DEFAULT;   // --telemetry <dir>: read the same layout from another checkout (paths are still recorded repo-relative)
const OUT = path.join(REPO, "concept", "data", "tracks");

// corner names (FIA / MultiViewer numbering) - only where the numbering is settled; otherwise "T<n>". Silverstone: FIA circuit
// map; Monza, Monaco, Spa: the mapping in concept/data/telemetry/<circuit>/README.md (matched to the speed minima there)
const NAMES = {
  monza: { 1: "Variante del Rettifilo", 2: "Variante del Rettifilo", 3: "Curva Grande", 4: "Variante della Roggia", 5: "Variante della Roggia", 6: "Lesmo 1", 7: "Lesmo 2", 8: "Ascari", 9: "Ascari", 10: "Ascari", 11: "Parabolica" },
  monaco: { 1: "Sainte Devote", 6: "Grand Hotel hairpin", 8: "Portier", 10: "Nouvelle Chicane", 11: "Nouvelle Chicane", 12: "Tabac", 18: "Rascasse", 19: "Anthony Noghes" },
  spa: { 1: "La Source", 2: "Eau Rouge", 3: "Raidillon", 4: "Raidillon", 5: "Les Combes", 6: "Les Combes", 7: "Malmedy", 8: "Rivage", 10: "Pouhon", 11: "Pouhon", 12: "Fagnes", 13: "Fagnes", 14: "Stavelot", 15: "Paul Frere", 16: "Blanchimont", 17: "Blanchimont", 18: "Bus Stop", 19: "Bus Stop" },
  silverstone: { 1: "Abbey", 2: "Farm", 3: "Village", 4: "The Loop", 5: "Aintree", 6: "Brooklands", 7: "Luffield", 8: "Woodcote", 9: "Copse", 10: "Maggotts", 11: "Maggotts", 12: "Becketts", 13: "Becketts", 14: "Chapel", 15: "Stowe", 16: "Vale", 17: "Club", 18: "Club" },
};

const sha256 = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const rel = f => {
  const inTel = path.relative(TEL, f);
  const r = !inTel.startsWith("..") && !path.isAbsolute(inTel) ? path.join("concept", "data", "telemetry", inTel) : path.relative(REPO, f);
  return r.split(path.sep).join("/");
};

// official centre-line lengths where no <id>-<year>-weekend.json exists (formula1.com circuit pages, "Circuit Length")
const OFFICIAL_LENGTH_M = { monza: 5793, monaco: 3337, spa: 7004, austria: 4318, suzuka: 5807, hungaroring: 4381, montreal: 4361, singapore: 4927 };
const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));

// js/data/<id>.js defines EI.TRACKS[id] on `window`; evaluate it in a sandbox whose global is its own window (no document)
function loadOsm(id) {
  const f = path.join(REPO, "js", "data", id + ".js");
  if (!fs.existsSync(f)) return null;
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f }); } catch (e) { return null; }
  const t = ctx.EI && ctx.EI.TRACKS && ctx.EI.TRACKS[id];
  return t && Array.isArray(t.center) ? { file: f, data: JSON.parse(JSON.stringify({ center: t.center, elevation: t.elevation || null, lapLength: t.lapLength })) } : null;
}

function discover() {
  const out = [];
  const scan = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory() && e.name !== "fetch") scan(path.join(dir, e.name));
      else if (e.isFile() && /^[a-z0-9_]+-circuit\.json$/.test(e.name)) out.push({ id: e.name.replace(/-circuit\.json$/, ""), dir });
    }
  };
  scan(TEL);
  return out;
}

function inputsFor(c) {
  const files = fs.readdirSync(c.dir).sort();
  const q = files.filter(n => new RegExp("^" + c.id + "-(\\d{4})-q-[a-z]{3}\\.json$").test(n));
  const r = files.filter(n => new RegExp("^" + c.id + "-(\\d{4})-r-[a-z]{3}-lap\\d+\\.json$").test(n));
  if (!q.length) return null;
  const year = /-(\d{4})-q-/.exec(q[0])[1];
  const used = [path.join(c.dir, c.id + "-circuit.json")];
  const laps = q.map(n => { const f = path.join(c.dir, n); used.push(f); return readJson(f); }).filter(l => l.channels && Array.isArray(l.channels.x_m));
  const raceLaps = r.map(n => { const f = path.join(c.dir, n); used.push(f); return readJson(f); }).filter(l => l.channels && Array.isArray(l.channels.x_m));
  const osm = loadOsm(c.id); if (osm) used.push(osm.file);
  const wf = path.join(REPO, "concept", "data", c.id + "-" + year + "-weekend.json");
  const weekend = fs.existsSync(wf) ? readJson(wf) : null; if (weekend) used.push(wf);
  const circuit = readJson(path.join(c.dir, c.id + "-circuit.json"));
  const sources = [
    "Telemetry: OpenF1 (api.openf1.org/v1) via " + rel(c.dir) + " (see its README for licence and method)",
    "Corner markers: " + (circuit.source || "MultiViewer circuit API"),
  ];
  if (osm) sources.push("Centreline: OpenStreetMap (c) OpenStreetMap contributors, ODbL 1.0, via " + rel(osm.file));
  if (weekend) sources.push("Official length, sector splits and straight-mode zones: " + rel(wf) + " (FIA documents cited there)");
  else if (OFFICIAL_LENGTH_M[c.id]) sources.push("Official length: formula1.com circuit page (" + OFFICIAL_LENGTH_M[c.id] + " m)");
  return {
    id: c.id, name: c.id.charAt(0).toUpperCase() + c.id.slice(1) + " " + year + " qualifying", laps, raceLaps, circuit, osm: osm && osm.data, weekend,
    names: NAMES[c.id] || null, sources, official_length_m: weekend ? null : OFFICIAL_LENGTH_M[c.id] || null, files: used.map(f => ({ path: rel(f), sha256: sha256(f) })),
  };
}

function build(id) {
  const c = discover().find(x => x.id === id);
  if (!c) throw new Error("no telemetry circuit " + id);
  const inp = inputsFor(c); if (!inp) throw new Error("no qualifying laps for " + id);
  return track.buildModel(inp);
}
const serialise = m => JSON.stringify(m) + "\n";

function main(argv) {
  const ti = argv.indexOf("--telemetry");
  if (ti >= 0) { TEL = path.resolve(argv[ti + 1]); argv = argv.filter((_, i) => i !== ti && i !== ti + 1); }
  const check = argv.includes("--check"), ids = argv.filter(a => !a.startsWith("--"));
  const found = discover().map(c => c.id), todo = ids.length ? ids : found;
  let bad = 0;
  for (const id of todo) {
    const t0 = Date.now(), m = build(id), txt = serialise(m), f = path.join(OUT, id + ".json");
    if (check) {
      const same = fs.existsSync(f) && fs.readFileSync(f, "utf8") === txt;
      if (!same) bad++;
      console.log((same ? "ok   " : "DIFF ") + rel(f));
      continue;
    }
    fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(f, txt);
    const g = m.geometry;
    console.log(rel(f) + ": " + Object.keys(m.drivers).length + " laps, centreline " + g.length_m + " m (" + g.source + (g.length_vs_official_pct != null ? ", " + g.length_vs_official_pct + " % vs official" : "") + "), " +
      m.corners.length + " corners, " + m.straights.length + " straights, " + (txt.length / 1024).toFixed(0) + " KB, " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
  }
  if (bad) { console.error(bad + " model(s) out of date: run node concept/track/build.js"); process.exitCode = 1; }
}

module.exports = { discover, inputsFor, build, serialise, loadOsm, NAMES };
if (require.main === module) main(process.argv.slice(2));
