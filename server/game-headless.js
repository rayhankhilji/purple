// PURPLE - loads the game's lap model into Node (ARCHITECTURE §2, P0.T4).
// Decision (TASK_LOG 2026-10-23): the real vendor/three.min.js r128 loads in Node as a UMD module and only its math classes run on
// this path (Track geometry: CatmullRomCurve3, Vector3, Group), so the evaluator sees byte-identical track geometry to the browser.
// No DOM is touched: Track.build() (meshes) is never called here, and no document global is defined (the Anthropic SDK would
// otherwise mistake the process for a browser and refuse to run).
const path = require("path"), fs = require("fs"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const FILES = ["js/util.js", "js/data/silverstone.js", "js/data/monza.js", "js/track.js", "js/car.js", "js/ai.js"];
let loaded = null;

function load() {
  if (loaded) return loaded;
  const g = globalThis;
  g.window = g; g.self = g;
  try { if (!g.navigator) g.navigator = { maxTouchPoints: 0, userAgent: "node" }; } catch (e) { /* read-only in some Node builds */ }
  g.THREE = require(path.join(ROOT, "vendor/three.min.js"));
  for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
  // the lab layer (dual-mode files attach to window.EI as in the browser)
  require(path.join(ROOT, "lab/aero.js"));
  require(path.join(ROOT, "lab/schema.js"));
  require(path.join(ROOT, "lab/prompt.js"));
  require(path.join(ROOT, "lab/evaluator.js"));
  g.EI.__headless = true;
  loaded = g.EI;
  return loaded;
}
module.exports = { load, ROOT, FILES };
