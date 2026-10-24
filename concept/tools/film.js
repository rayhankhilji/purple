#!/usr/bin/env node
// PURPLE CONCEPT - the concept-evolution film: the concept car changing shape, generation by generation, as the optimiser reshapes it.
//
//   node concept/tools/film.js                      # whole pipeline: optimise (seed 1, 200 gens) -> frames -> mp4 + webm + posters
//   node concept/tools/film.js --sim ./concept/sim/index.js   # re-render with another lap simulator (see --sim below)
//
// Pipeline (all local, no network, no Mubit, never touches data/):
//   1. run the shape optimiser (concept/optimize.js, the same call concept/cli.js makes) with the chosen sim, or --lineage DIR to
//      replay an existing `node concept/cli.js --out DIR` run (lineage.jsonl + best.json);
//   2. replay every KEPT generation onto the baseline with design.applyChanges (what concept/view/index.html parseFile does);
//   3. render frames in headless Chromium at 1920x1080 from a stage page this script serves virtually from the static server
//      (server/static.js, started on --port and killed by PID at the end): the real concept view (concept/view/view3d.js) with a
//      slow hero orbit, the baseline outline (purple) on, the parts that just changed highlighted (amber), and a lower-third drawn
//      in the page: generation n/200, lap time and delta vs baseline, parts changed k of 23, the last change in plain words, and the
//      honesty lines (G-HON-01/02: geometry label + "lap times: <sim label>");
//   4. assemble with ffmpeg (mp4 H.264 + webm VP9; needs ffmpeg on PATH or --ffmpeg) and export two posters.
// Frames are rendered deterministically (requestAnimationFrame is stubbed; the script drives camera, morph and overlay per frame), so
// the same lineage gives the same film. The number on screen are the lineage's own (sim label printed on screen, never "CFD", "wind
// tunnel" or "validated": the script refuses to render if any on-screen text would contain those words).
//
// Options:
//   --seed S (1) --gens N (200) --circuit silverstone      the optimiser run (ignored with --lineage)
//   --sim MODULE        a lap simulator: a path (relative to the cwd) or package whose export is sim(physicalCar, trackId, conditions)
//                       (module.exports = fn, or { sim }, or { default }), the CONCEPT.md sim contract. It is passed to
//                       optimize({ bench: { sim } }); the label on screen is the sim's own `label` (sim result, else module.label).
//                       Default: the stand-in sim v0 (concept/bench.js simV0).
//   --lineage DIR       replay DIR/lineage.jsonl + DIR/best.json instead of optimising (the sim label is read from best.json)
//   --out DIR           media directory (docs/deck/film)             --name NAME (concept-evolution)
//   --work DIR          scratch for lineage, frames (<os tmp>/purple-concept-film)
//   --seconds T (20)    film length  --fps F (30)  --width 1920 --height 1080
//   --formats mp4,webm  --crf N (20)    --frames N   render only the first N frames (test)   --keep-frames   --poster-only   --no-poster
//   --shots 0,300,599   render only these frame numbers to <work>/shots/ and stop (a quick look; no mp4)
//   --poster-view hero  one of EI.conceptView.VIEWS (the baseline-vs-best poster's camera)
//   --port 8892  --ffmpeg PATH  --browser-path PATH (or CHROME_PATH)  --headed
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), http = require("http");
const ROOT = path.join(__dirname, "..", "..");
const design = require(path.join(ROOT, "concept", "design.js")), parts = require(path.join(ROOT, "concept", "parts.js"));
const optimize = require(path.join(ROOT, "concept", "optimize.js")), bench = require(path.join(ROOT, "concept", "bench.js"));

// ------------------------------------------------------------------------------------------------------------------ options
function parseArgs(argv) {
  const a = { seed: 1, gens: 200, circuit: "silverstone", sim: null, lineage: null, out: path.join(ROOT, "docs", "deck", "film"), name: "concept-evolution", work: path.join(os.tmpdir(), "purple-concept-film"), seconds: 20, fps: 30, width: 1920, height: 1080, formats: ["mp4", "webm"], crf: 20, frames: 0, shots: null, keepFrames: false, posterOnly: false, poster: true, posterView: "hero", port: 8892, ffmpeg: "ffmpeg", browserPath: process.env.CHROME_PATH || undefined, headed: false };
  const num = (k, v) => { const n = +v; if (!isFinite(n)) throw new Error(k + " needs a number"); return n; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], next = () => { const v = argv[++i]; if (v == null) throw new Error("missing value for " + k); return v; };
    switch (k) {
      case "--seed": a.seed = num(k, next()); break; case "--gens": a.gens = num(k, next()); break; case "--circuit": a.circuit = next(); break;
      case "--sim": a.sim = next(); break; case "--lineage": a.lineage = path.resolve(next()); break;
      case "--out": a.out = path.resolve(next()); break; case "--name": a.name = next(); break; case "--work": a.work = path.resolve(next()); break;
      case "--seconds": a.seconds = num(k, next()); break; case "--fps": a.fps = num(k, next()); break; case "--width": a.width = num(k, next()); break; case "--height": a.height = num(k, next()); break;
      case "--formats": a.formats = next().split(",").map(s => s.trim()).filter(Boolean); break; case "--crf": a.crf = num(k, next()); break; case "--frames": a.frames = num(k, next()); break;
      case "--shots": a.shots = next().split(",").map(s => +s); break; case "--keep-frames": a.keepFrames = true; break; case "--poster-only": a.posterOnly = true; break; case "--no-poster": a.poster = false; break; case "--poster-view": a.posterView = next(); break;
      case "--port": a.port = num(k, next()); break; case "--ffmpeg": a.ffmpeg = next(); break; case "--browser-path": a.browserPath = next(); break; case "--headed": a.headed = true; break;
      case "-h": case "--help": a.help = true; break;
      default: throw new Error("unknown option " + k);
    }
  }
  for (const f of a.formats) if (!["mp4", "webm"].includes(f)) throw new Error("--formats: mp4 and/or webm");
  if (!(a.seconds > 4) || !(a.fps >= 1)) throw new Error("--seconds must exceed 4 and --fps be positive");
  return a;
}

// ---------------------------------------------------------------------------------------------------------- honesty guard
const BANNED = /\bCFD\b|wind[ -]?tunnel|validated|aerodynamically tested/i;
const GEOMETRY_LABEL = "concept geometry from the design parameters · schematic, not a CAD model";
function assertClean(text, what) { if (BANNED.test(text)) throw new Error("honesty guard: " + what + " contains a banned word (CFD / wind tunnel / validated): " + JSON.stringify(text)); return text; }

// ----------------------------------------------------------------------------------------------------- run or load the lineage
function loadSim(spec) {
  if (!spec) return { sim: null, label: null };
  const p = spec.startsWith(".") || path.isAbsolute(spec) ? path.resolve(spec) : spec, m = require(p);
  const sim = typeof m === "function" ? m : typeof m.sim === "function" ? m.sim : m.default && typeof m.default === "function" ? m.default : null;
  if (!sim) throw new Error("--sim " + spec + ": the module must export sim(physicalCar, trackId, conditions) (function, { sim } or { default })");
  return { sim, label: m.label || null };
}
function strip(r) { return JSON.parse(JSON.stringify(r, (k, v) => (k === "ms" ? undefined : v))); }
function runOptimiser(a) {
  const s = loadSim(a.sim), out = path.join(a.work, "run-seed" + a.seed + (a.sim ? "-sim" : "")); fs.mkdirSync(out, { recursive: true });
  const lp = path.join(out, "lineage.jsonl"); fs.writeFileSync(lp, "");
  const benchOpts = { circuit: a.circuit, circuits: [a.circuit] }; if (s.sim) benchOpts.sim = s.sim;
  const t0 = Date.now();
  const res = optimize.optimize({ gens: a.gens, seed: a.seed, bench: benchOpts, onGeneration(row) { fs.appendFileSync(lp, JSON.stringify(row) + "\n"); } });
  fs.writeFileSync(path.join(out, "best.json"), JSON.stringify({ seed: a.seed, generations: res.generations, kept: res.kept, stopped: res.stopped, proposer: res.proposer, objective: res.objective, label: res.label, best: res.best, best_result: strip(res.best_result), baseline_result: strip(res.baseline_result), diff: res.diff }, null, 2) + "\n");
  console.log("film: optimised seed " + a.seed + ", " + res.generations + " generations, " + res.kept + " kept, in " + ((Date.now() - t0) / 1000).toFixed(1) + " s -> " + out);
  return { dir: out, simLabelFallback: s.label };
}
function loadRun(dir, a) {
  const rows = fs.readFileSync(path.join(dir, "lineage.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const bj = JSON.parse(fs.readFileSync(path.join(dir, "best.json"), "utf8"));
  if (!rows.length || rows[0].gen == null) throw new Error(dir + "/lineage.jsonl is not a lineage file");
  const circuit = (bj.best_result && bj.best_result.weekend && bj.best_result.weekend.circuit) || a.circuit;
  const baseLap = bj.baseline_result.circuits[circuit].lap_s, simLabel = bj.baseline_result.circuits[circuit].label || bj.best_result.sim_label || bj.baseline_result.sim_label;
  return { rows, bj, circuit, baseLap, simLabel };
}

// ------------------------------------------------------------------------------------------------- plain words for a change
const PART_WORD = { layout: "layout", survival_cell: "survival cell", front_wing: "front wing", rear_wing: "rear wing", floor: "floor", diffuser: "diffuser", sidepods: "sidepods", ballast: "ballast" };
const PARAM_WORD = {
  "layout.wheelbase_mm": "wheelbase", "survival_cell.front_axle_offset_mm": "survival cell front-axle offset", "survival_cell.cockpit_len_mm": "cockpit length", "survival_cell.bulkhead_gap_mm": "cockpit-to-engine gap",
  "front_wing.span_mm": "front wing span", "front_wing.chord_mm": "front wing chord", "front_wing.aoa_deg": "front wing setting", "front_wing.elements": "front wing profile volumes", "front_wing.sm_delta_deg": "front wing straight-mode flap angle",
  "rear_wing.span_mm": "rear wing span", "rear_wing.chord_mm": "rear wing chord", "rear_wing.aoa_deg": "rear wing setting", "rear_wing.elements": "rear wing profile volumes", "rear_wing.endplate_top_mm": "rear wing endplate height", "rear_wing.sm_delta_deg": "rear wing straight-mode flap angle",
  "floor.width_mm": "floor width", "floor.throat_mm": "floor venturi throat height", "floor.ride_height_mm": "ride height", "diffuser.expansion_deg": "diffuser expansion angle",
  "sidepods.inlet_cm2": "sidepod cooling inlet area", "sidepods.undercut_mm": "sidepod undercut depth", "ballast.x_frac": "ballast position", "ballast.extra_kg": "ballast above the minimum",
};
const num2 = v => String(Math.round(v * 100) / 100);
function say(c) {
  const key = c.part + "." + c.param, s = design.spec(c.part, c.param), word = PARAM_WORD[key] || (PART_WORD[c.part] || c.part) + " " + s.label.split(" (")[0].toLowerCase();
  const u = s.unit === "°" ? "°" : s.unit === "× WB" ? " × wheelbase" : s.unit ? " " + s.unit : "";
  return word + " " + num2(c.from) + " → " + num2(c.to) + u;
}
const domainFrac = c => { const s = design.spec(c.part, c.param); return Math.abs(c.to - c.from) / (s.max - s.min); };

// ---------------------------------------------------------------------------------------------------- the kept-design replay
function replay(run, a) {
  const base = design.baseline(), P = parts.PARAMS.length;
  const steps = [{ gen: 0, design: base, changes: [], lap: run.baseLap, changed: 0, partsHit: [] }];
  let d = design.clone(base);
  for (const r of run.rows) {
    if (!r.kept || r.legal === false) continue;
    d = design.applyChanges(d, r.changes.map(c => ({ part: c.part, param: c.param, to: c.to })), { id: r.id, label: "generation " + r.gen }).design;
    const lap = r.result && r.result.lap_s != null ? r.result.lap_s : null;
    if (lap == null) throw new Error("lineage row " + r.gen + " has no lap_s (was it written by a bench that returns lap_s?)");
    const ch = r.changes.slice().sort((x, y) => domainFrac(y) - domainFrac(x));
    steps.push({ gen: r.gen, design: design.clone(d), changes: ch, lap, changed: design.diff(base, d).length, partsHit: Array.from(new Set(ch.map(c => c.part))) });
  }
  if (steps.length < 2) throw new Error("no kept generation in the lineage: nothing to film");
  return { steps, P, gens: a.gens || run.rows.length, bestGen: steps[steps.length - 1].gen };
}

// ----------------------------------------------------------------------------------------------------------- the timeline
const lerp = (a, b, t) => a + (b - a) * t, smooth = t => t * t * (3 - 2 * t), clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function mixDesign(a, b, e) {
  const out = {};
  for (const part of Object.keys(b.params)) { out[part] = {}; for (const k of Object.keys(b.params[part])) { const x = a.params[part][k], y = b.params[part][k], sp = parts.BY_ID[part].params[k]; out[part][k] = sp.int ? (e < 0.5 ? x : y) : lerp(x, y, e); } }
  return { id: "film", label: "film", params: out };
}
// time budget: intro hold on the baseline, N kept steps (early ones slower so the first changes can be read, later ones faster), outro hold
function timeline(rp, a) {
  const T = a.seconds, intro = 1.4, outro = 3.2, n = rp.steps.length - 1, body = T - intro - outro;
  const w = Array.from({ length: n }, (_, i) => 1 - 0.7 * (n > 1 ? i / (n - 1) : 0)), sw = w.reduce((x, y) => x + y, 0);
  const starts = []; let t = intro; for (let i = 0; i < n; i++) { starts.push(t); t += body * w[i] / sw; }
  return { T, intro, outro, starts, endBody: t };
}
function frameState(rp, tl, run, a, f) {
  const t = f / a.fps, n = rp.steps.length - 1, S = rp.steps;
  let i = -1; for (let k = 0; k < n; k++) if (t >= tl.starts[k]) i = k; // step index being morphed in (0-based over kept steps), -1 = intro
  let d, lap, gen, changed, hl, main, sub, phase = "step";
  if (i < 0) { d = S[0].design; lap = S[0].lap; gen = 0; changed = 0; hl = []; main = "baseline concept car"; sub = "the optimiser starts here"; phase = "intro"; }
  else {
    const end = i + 1 < n ? tl.starts[i + 1] : tl.endBody, k = clamp((t - tl.starts[i]) / (end - tl.starts[i]), 0, 1), e = smooth(k), from = S[i], to = S[i + 1];
    d = mixDesign(from.design, to.design, e); lap = lerp(from.lap, to.lap, e);
    gen = to.gen; hl = to.partsHit; main = say(to.changes[0]); sub = to.changes.slice(1).map(say).join("  ·  ");
    changed = e < 0.5 ? from.changed : to.changed;
    if (t >= tl.endBody) { d = to.design; lap = to.lap; phase = "outro"; main = "best design: generation " + rp.bestGen + " · " + n + " of " + rp.gens + " kept"; sub = ""; gen = rp.gens; hl = []; changed = to.changed; }
    else if (to.changes.length > 1) sub = "also: " + sub;
  }
  const prog = i < 0 ? 0 : t >= tl.endBody ? rp.gens : (gen);
  const sw = Math.max(1, 1.6 / (a.width / a.height));   // narrow frames: the view's own fit factor
  const u = clamp(t / tl.T, 0, 1), ease = u * u * (3 - 2 * u) * 0.5 + u * 0.5;   // slow orbit, slightly eased at both ends
  const cam = { azim: lerp(2.72, 0.95, ease), elev: lerp(0.29, 0.21, ease), radius: lerp(9.2, 8.5, ease) * sw, target: [0.05, -0.38, 0] };
  const delta = lap - run.baseLap;
  return { t, phase, params: d.params, highlight: hl, gen, progress: prog, lap, delta, changed, main: assertClean(main, "change text"), sub: assertClean(sub, "change text"), cam, step: i + 1 };
}

// --------------------------------------------------------------------------------------------------------------- the pages
const STYLE = `
:root{--bg:#0a0a0c;--panel:#121216;--line:#26262c;--text:#e8e8ec;--muted:#9a9aa6;--purple:#b26cff;--amber:#fbbf24;--green:#4ade80}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:var(--bg);color:var(--text);overflow:hidden;font-family:Inter,"DejaVu Sans",system-ui,sans-serif}
.num{font-variant-numeric:tabular-nums}
`;
const SCRIPTS = `<script src="/vendor/three.min.js"></script><script src="/concept/regs.js"></script><script src="/concept/parts.js"></script><script src="/concept/aeromap.js"></script><script src="/concept/design.js"></script><script src="/concept/view/view3d.js"></script>`;
function stagePage(a, meta) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>PURPLE concept film</title><style>${STYLE}
#car{position:absolute;inset:0}
#shade{position:absolute;left:0;right:0;bottom:0;height:46%;background:linear-gradient(to top,rgba(10,10,12,.96) 0%,rgba(10,10,12,.82) 45%,rgba(10,10,12,0) 100%);pointer-events:none}
#brand{position:absolute;left:56px;top:40px;font-weight:700;font-size:22px;letter-spacing:.16em;text-transform:uppercase}
#brand b{color:var(--purple)}#brand span{display:block;margin-top:6px;font-weight:500;font-size:15px;letter-spacing:.06em;color:var(--muted);text-transform:none}
#key{position:absolute;right:56px;top:40px;font-size:17px;color:var(--muted);text-align:right;line-height:1.7}
#key i{display:inline-block;width:26px;height:0;border-top:3px solid;vertical-align:middle;margin-right:10px}
#lt{position:absolute;left:56px;right:56px;bottom:34px}
#bar{position:relative;height:6px;border-radius:3px;background:#22222a;margin-bottom:22px}
#bar .fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--purple)}
#cols{display:grid;grid-template-columns:260px 330px 250px 1fr;gap:0 36px;align-items:start}
.cap{font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:6px}
.big{font-size:60px;line-height:1;font-weight:700;letter-spacing:-.01em}.big small{font-size:28px;font-weight:500;color:var(--muted);letter-spacing:0}
.dl{margin-top:8px;font-size:24px;font-weight:600}.dl.neg{color:var(--green)}.dl.zero{color:var(--muted)}.dl em{font-style:normal;color:var(--muted);font-weight:500;font-size:18px}
.sub{margin-top:8px;font-size:18px;color:var(--muted)}
#main{font-size:34px;line-height:1.18;font-weight:600;color:var(--amber);min-height:40px}#sub2{margin-top:8px;font-size:19px;color:var(--muted);min-height:24px}
#hon{margin-top:20px;padding-top:12px;border-top:1px solid var(--line);font-size:16px;line-height:1.5;color:var(--muted)}#hon b{color:var(--text);font-weight:600}
</style></head><body>
<div id="car"></div><div id="shade"></div>
<div id="brand"><b>PURPLE</b> &middot; concept car<span>optimiser replay &middot; ${meta.seedText}</span></div>
<div id="key"><div><i style="border-color:var(--purple)"></i>baseline car outline</div><div><i style="border-color:var(--amber)"></i>parts changed in this generation</div></div>
<div id="lt"><div id="bar"><div class="fill" id="fill"></div></div>
<div id="cols">
 <div><div class="cap">Generation</div><div class="big num"><span id="gen">0</span><small> / ${meta.gens}</small></div><div class="sub" id="gsub"></div></div>
 <div><div class="cap">Lap time &middot; ${meta.circuitName}</div><div class="big num"><span id="lap">0</span><small> s</small></div><div class="dl num zero" id="dl"></div></div>
 <div><div class="cap">Parts changed</div><div class="big num"><span id="chg">0</span><small> of ${meta.P}</small></div><div class="sub">design parameters moved from the baseline</div></div>
 <div><div class="cap">Last change</div><div id="main"></div><div id="sub2"></div></div>
</div>
<div id="hon"><b>${esc(GEOMETRY_LABEL)}</b><br>lap times: ${esc(meta.simLabel)}</div></div>
${SCRIPTS}
<script>
window.__ready = false;
window.setup = function (base) {
  window.BASE = base; window.cv = EI.conceptView.mount(document.getElementById("car"), { design: base, baseline: base, orbit: false, label: false, legend: false, view: "hero" });
  EI.conceptView.VIEWS.film = { azim: 2.7, elev: 0.29, radius: 7.7, target: [0.05, 0.12, 0] };
  window.cv.setAero("corner"); window.__hl = ""; window.__ready = true; return window.cv.state().layout ? true : true;
};
const $ = id => document.getElementById(id), fmt = (v, d) => v.toFixed(d).replace("-", "\\u2212");
window.frame = function (s) {
  const V = EI.conceptView.VIEWS.film; V.azim = s.cam.azim; V.elev = s.cam.elev; V.radius = s.cam.radius; V.target = s.cam.target;
  cv.setView("film", { animate: false });
  const hl = s.highlight.join(","); if (hl !== window.__hl) { cv.setHighlight(s.highlight); window.__hl = hl; }
  cv.setDesign({ id: "film", label: "film", params: s.params }, { animate: false, baseline: BASE });
  if (hl) cv.setHighlight(s.highlight);
  cv.render();
  $("gen").textContent = s.gen; $("fill").style.width = (100 * s.progress / ${meta.gens}) + "%";
  $("gsub").textContent = s.phase === "intro" ? "baseline" : s.phase === "outro" ? "finished" : "kept generations only";
  $("lap").textContent = s.lap.toFixed(3); $("chg").textContent = s.changed;
  const d = $("dl"), z = Math.abs(s.delta) < 0.0005; d.className = "dl num " + (z ? "zero" : s.delta < 0 ? "neg" : "");
  d.innerHTML = z ? "baseline" : fmt(s.delta, 3) + " s <em>vs baseline</em>";
  $("main").textContent = s.main; $("sub2").textContent = s.sub;
  return true;
};
</script></body></html>`;
}
function posterPage(a, meta) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>PURPLE concept poster</title><style>${STYLE}
#head{position:absolute;left:56px;top:36px;right:56px;display:flex;justify-content:space-between;align-items:baseline}
#head h1{margin:0;font-size:26px;letter-spacing:.16em;text-transform:uppercase;font-weight:700}#head h1 b{color:var(--purple)}#head div{font-size:17px;color:var(--muted)}
.pane{position:absolute;top:96px;height:700px;width:900px}#L{left:56px}#R{left:964px}
.pane .car{position:absolute;inset:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.tag{position:absolute;left:18px;top:16px;font-size:15px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--muted);z-index:2}.tag.b{color:var(--amber)}
.stats{position:absolute;top:812px;width:900px;display:grid;grid-template-columns:auto auto 1fr;gap:0 48px;align-items:start}#SL{left:56px}#SR{left:964px}
.cap{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:4px}.big{font-size:44px;font-weight:700;line-height:1}.big small{font-size:22px;color:var(--muted);font-weight:500}
.dl{font-size:20px;font-weight:600;margin-top:6px;color:var(--green)}.dl em{font-style:normal;color:var(--muted);font-weight:500;font-size:16px}
#key{position:absolute;left:964px;top:758px;width:900px;font-size:15px;color:var(--muted);text-align:right;z-index:2;padding-right:18px}#key i{display:inline-block;width:22px;border-top:3px solid;vertical-align:middle;margin:0 8px 0 18px}
#hon{position:absolute;left:56px;right:56px;bottom:30px;padding-top:12px;border-top:1px solid var(--line);font-size:16px;line-height:1.5;color:var(--muted)}#hon b{color:var(--text);font-weight:600}
#chg{position:absolute;left:964px;top:918px;width:900px;font-size:17px;color:var(--amber);line-height:1.4}
</style></head><body>
<div id="head"><h1><b>PURPLE</b> &middot; concept car</h1><div>baseline vs the optimiser's best &middot; ${meta.seedText} &middot; same camera, same scale</div></div>
<div class="pane" id="L"><div class="tag">Baseline concept car</div><div class="car" id="cL"></div></div>
<div class="pane" id="R"><div class="tag b">Best design &middot; generation ${meta.bestGen} of ${meta.gens}</div><div class="car" id="cR"></div></div>
<div id="key"><i style="border-color:var(--purple)"></i>baseline outline<i style="border-color:var(--amber)"></i>changed parts</div>
<div class="stats" id="SL"><div><div class="cap">Lap time &middot; ${meta.circuitName}</div><div class="big num">${meta.baseLap.toFixed(3)}<small> s</small></div><div class="dl num" style="color:var(--muted)">baseline</div></div><div><div class="cap">Parts changed</div><div class="big num">0<small> of ${meta.P}</small></div></div><div></div></div>
<div class="stats" id="SR"><div><div class="cap">Lap time &middot; ${meta.circuitName}</div><div class="big num">${meta.bestLap.toFixed(3)}<small> s</small></div><div class="dl num">${(meta.bestLap - meta.baseLap).toFixed(3).replace("-", "−")} s <em>vs baseline</em></div></div><div><div class="cap">Parts changed</div><div class="big num">${meta.bestChanged}<small> of ${meta.P}</small></div></div><div></div></div>
<div id="chg"></div>
<div id="hon"><b>${esc(GEOMETRY_LABEL)}</b><br>lap times: ${esc(meta.simLabel)}</div>
${SCRIPTS}
<script>
window.setup = function (base, best, view, hl, chg) {
  const W = EI.conceptView.VIEWS, V = W[view]; W.poster = { azim: V.azim, elev: V.elev, radius: V.radius * 0.95, target: V.target.slice() };   // one shared camera, a little closer than the app's view
  const L = EI.conceptView.mount(document.getElementById("cL"), { design: base, baseline: null, orbit: false, label: false, legend: false, view: "poster" });
  const R = EI.conceptView.mount(document.getElementById("cR"), { design: best, baseline: base, orbit: false, label: false, legend: false, view: "poster" });
  for (const v of [L, R]) { v.setAero("corner"); v.setView("poster", { animate: false }); }
  R.setHighlight(hl); L.render(); R.render(); document.getElementById("chg").textContent = chg; window.cvs = [L, R]; return true;
};
window.again = () => { for (const v of window.cvs) v.render(); return true; };
</script></body></html>`;
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// ------------------------------------------------------------------------------------------------------- server + browser
function loadPlaywright() {
  const tries = [() => require("playwright"), () => require(path.join(cp.execSync("npm root -g").toString().trim(), "playwright")), () => require("/opt/node-tools/node_modules/playwright")];
  for (const t of tries) { try { return t(); } catch (e) { /* next */ } }
  throw new Error("playwright not found: npm i -g playwright (browsers are not installed by this script) or set NODE_PATH");
}
function startStatic(port) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [path.join(ROOT, "server", "static.js")], { env: Object.assign({}, process.env, { PURPLE_STATIC_PORT: String(port) }), stdio: ["ignore", "pipe", "pipe"] });
    let done = false, err = "";
    child.stderr.on("data", d => { err += d; });
    child.on("exit", code => { if (!done) { done = true; reject(new Error("static server exited " + code + ": " + err.trim().split("\n").pop() + " (port " + port + " busy? use --port)")); } });
    (function poll(n) {
      http.get({ host: "127.0.0.1", port, path: "/concept/parts.js" }, res => { res.resume(); if (!done) { done = true; resolve(child); } }).on("error", () => { if (n > 60) { if (!done) { done = true; child.kill(); reject(new Error("static server did not start")); } } else setTimeout(() => poll(n + 1), 100); });
    })(0);
  });
}

// ------------------------------------------------------------------------------------------------------------------- main
async function main(argv) {
  const a = parseArgs(argv);
  if (a.help) { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 44).map(l => l.replace(/^\/\/ ?/, "")).join("\n")); return 0; }
  fs.mkdirSync(a.work, { recursive: true }); fs.mkdirSync(a.out, { recursive: true });
  let dir = a.lineage, simFallback = null;
  if (!dir) { const r = runOptimiser(a); dir = r.dir; simFallback = r.simLabelFallback; }
  const run = loadRun(dir, a), rp = replay(run, a);
  const best = rp.steps[rp.steps.length - 1];
  if (!run.simLabel && simFallback) run.simLabel = simFallback;
  if (!run.simLabel) throw new Error("no sim label: the sim result must carry `label` (CONCEPT.md sim contract)");
  assertClean(run.simLabel, "sim label");
  const circuitName = run.circuit.charAt(0).toUpperCase() + run.circuit.slice(1);
  const meta = { gens: a.gens, P: rp.P, seedText: "seed " + (run.bj.seed != null ? run.bj.seed : a.seed) + " · " + (run.bj.proposer || "es"), circuitName, simLabel: run.simLabel, baseLap: run.baseLap, bestLap: best.lap, bestChanged: best.changed, bestGen: best.gen };
  meta.gens = run.bj.generations || run.rows.length;
  console.log("film: " + (rp.steps.length - 1) + " kept generations, lap " + run.baseLap.toFixed(3) + " -> " + best.lap.toFixed(3) + " s, " + best.changed + " of " + rp.P + " parameters changed");
  console.log("film: sim label on screen: " + run.simLabel);

  const server = await startStatic(a.port);
  let browser;
  const cleanup = () => { try { if (browser) browser.close().catch(() => {}); } catch (e) { /* gone */ } try { server.kill(); } catch (e) { /* gone */ } };
  try {
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: !a.headed, executablePath: a.browserPath, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
    const origin = "http://127.0.0.1:" + a.port;
    const newPage = async (html, w, h, p) => {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: "dark" });
      await page.addInitScript(() => { window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {}; });   // deterministic: the script drives every frame
      page.on("pageerror", e => { console.error("page error: " + e.message); });
      page.on("console", m => { if (m.type() === "error") console.error("page console: " + m.text()); });
      await page.route(origin + p, r => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
      await page.goto(origin + p, { waitUntil: "load" });
      return page;
    };
    const base = design.baseline();

    // ---- posters
    if (a.poster || a.posterOnly) {
      const hlParts = Array.from(new Set(rp.steps.slice(1).flatMap(s => s.partsHit))).filter(p => design.diff(base, best.design).some(d => d.part === p));
      const top = design.diff(base, best.design).sort((x, y) => Math.abs(y.domain_frac) - Math.abs(x.domain_frac)).slice(0, 3).map(d => say({ part: d.part, param: d.param, from: d.from, to: d.to }));
      const chg = "largest moves: " + top.join(" · "); assertClean(chg, "poster text");
      const page = await newPage(posterPage(a, meta), 1920, 1080, "/concept/tools/film-poster.html");
      await page.evaluate(([b, d, v, h, c]) => window.setup(b, d, v, h, c), [base, best.design, a.posterView, hlParts, chg]);
      await page.evaluate(() => window.again()); await page.waitForTimeout(200);
      const f = path.join(a.out, "concept-baseline-vs-best.png"); await page.screenshot({ path: f }); console.log("film: wrote " + f + " (" + kb(f) + ")");
      await page.close();
      if (a.posterOnly) return 0;
    }

    // ---- frames
    const tl = timeline(rp, a), total = a.frames > 0 ? a.frames : Math.round(a.seconds * a.fps), frames = path.join(a.work, "frames");
    fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
    const page = await newPage(stagePage(a, meta), a.width, a.height, "/concept/tools/film-stage.html");
    await page.evaluate(b => window.setup(b), base);
    if (a.shots) {
      const dirS = path.join(a.work, "shots"); fs.mkdirSync(dirS, { recursive: true });
      for (const f of a.shots) { await page.evaluate(s => window.frame(s), frameState(rp, tl, run, a, f)); const o = path.join(dirS, "frame-" + String(f).padStart(4, "0") + ".png"); await page.screenshot({ path: o }); console.log("film: wrote " + o); }
      return 0;
    }
    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      const s = frameState(rp, tl, run, a, f);
      await page.evaluate(s => window.frame(s), s);
      await page.screenshot({ path: path.join(frames, String(f).padStart(4, "0") + ".png") });
      if (f % 20 === 0 || f === total - 1) { const el = (Date.now() - t0) / 1000; console.log("film: frame " + (f + 1) + "/" + total + "  " + el.toFixed(0) + " s elapsed, ~" + (el / (f + 1) * (total - f - 1)).toFixed(0) + " s left"); }
    }
    if (a.poster || !a.posterOnly) {
      // film poster: the last frame (the best design with the lower-third), same look as the clip
      fs.copyFileSync(path.join(frames, String(total - 1).padStart(4, "0") + ".png"), path.join(a.out, a.name + "-poster.png")); console.log("film: wrote " + path.join(a.out, a.name + "-poster.png"));
    }
    await page.close();

    // ---- assemble
    for (const fmt of a.formats) {
      const f = path.join(a.out, a.name + "." + fmt);
      const args = ["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(a.fps), "-i", path.join(frames, "%04d.png")];
      if (fmt === "mp4") args.push("-c:v", "libx264", "-preset", "slow", "-crf", String(a.crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart");
      else args.push("-c:v", "libvpx-vp9", "-crf", String(a.crf + 10), "-b:v", "0", "-pix_fmt", "yuv420p", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2");
      args.push(f);
      const r = cp.spawnSync(a.ffmpeg, args, { stdio: "inherit" });
      if (r.status !== 0) throw new Error("ffmpeg failed for " + fmt + " (is ffmpeg installed? --ffmpeg PATH)");
      const mb = fs.statSync(f).size / 1048576; console.log("film: wrote " + f + " (" + kb(f) + ")"); if (mb >= 15) console.warn("film: WARNING " + f + " is " + mb.toFixed(1) + " MB (> 15 MB): raise --crf");
    }
    if (!a.keepFrames) fs.rmSync(frames, { recursive: true, force: true });
    return 0;
  } finally { cleanup(); }
}
const kb = f => { const b = fs.statSync(f).size; return b > 1048576 ? (b / 1048576).toFixed(2) + " MB" : Math.round(b / 1024) + " KB"; };
if (require.main === module) main(process.argv.slice(2)).then(c => { process.exitCode = c; }, e => { console.error("film: " + (e.message || e)); process.exitCode = 1; });
module.exports = { parseArgs, replay, timeline, frameState, say, assertClean };
