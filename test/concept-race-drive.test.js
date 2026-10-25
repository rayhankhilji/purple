// PURPLE concept race, "Drive it yourself" (time trial) and "Race the grid" (docs/concept/RACE.md). The result card's numbers come
// from their sources (the physics-sim ghost ends at exactly the URL's lap, the real pole at exactly 88.111 s), the player's car gets
// the Game race mode's multipliers, the race grid is real 2026 qualifying with PURPLE placed by its sim lap, and the game file is
// gated: nothing of the drive modes runs without ?concept=1 (and never with ?lab=1). No browser, no network.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
require("../server/game-headless.js").load();   // the game's lap model: bench.v0Multipliers (the Game race mapping) needs it
global.window = global.window || globalThis;
require("../js/data/racepace2026.js");
const EI = globalThis.EI;
const CR = require("../js/conceptrace.js");
const RP = require("../concept/race/payload.js");
const DR = require("../concept/race/drive.js");
const design = require("../concept/design.js");

const RACE = EI.RACEPACE.silverstone;
const telemetry = JSON.parse(fs.readFileSync(path.join(ROOT, RP.TELEMETRY_PATH), "utf8"));
// the demo's best car (as test/concept-race-quali.test.js): the recorded live run's peak decision on the RB22 baseline
const REPLAY = JSON.parse(fs.readFileSync(path.join(ROOT, "concept/demo/replays/trained-corrections-seed12.json"), "utf8"));
const peak = REPLAY.decisions.find((d) => d.peak_after === REPLAY.peak.node && d.kept && d.params);
const best = design.applyChanges(design.baseline({ team: "redbull" }), peak.params.map(([k, v]) => { const [part, param] = k.split("."); return { part, param, to: v }; })).design;
const URL_LAP = REPLAY.peak.lap_s;
const built = RP.buildPayload({ design: best, ref: "redbull", telemetry });

// the ghost's finish as the game view measures it: 120 Hz steps from the run-up, finish solved inside the step
function finish(car) { const tl = CR.timeline(car), h = 1 / 120; let t = -DR.RUNUP_S, f = null; while (f == null && t < 300) { const t2 = t + h; f = CR.crossingExact(tl, t, t2, tl.L); t = t2; } return f; }

test("time trial payload: the player's car takes the Game race multipliers; ghosts end at exactly their source laps", () => {
  assert.equal(built.ok, true, (built.errors || []).join("; "));
  assert.equal(built.cinematic.ok, true, built.cinematic.error);
  const r = DR.drivePayload(built.payload, { lap_s: URL_LAP, pole_s: RACE.pole.s, multipliers: built.cinematic.multipliers });
  assert.equal(r.ok, true, r.errors.join("; "));
  const P = r.payload;
  assert.equal(P.mode, "drive"); assert.equal(P.kind, "trial");
  assert.deepEqual(P.player.aero, built.cinematic.multipliers, "the same mapping as the Game race mode");
  assert.ok(P.player.design && P.player.design.params, "the player's car carries the design (its body in the game view)");
  const sim = P.cars.find((c) => c.id === "concept"), pole = P.cars.find((c) => c.id === "pole"), ref = P.cars.find((c) => c.id === "ref");
  assert.equal(P.sim_lap_s, URL_LAP); assert.equal(sim.lap_s, URL_LAP); assert.equal(sim.t[sim.t.length - 1], URL_LAP);
  assert.equal(P.pole_lap_s, 88.111); assert.equal(pole.lap_s, 88.111); assert.equal(pole.t[pole.t.length - 1], 88.111); assert.equal(pole.L, P.line.L);
  assert.ok(ref && Math.abs(ref.lap_s - 88.745) < 0.01, "the optional RB22 ghost: the baseline sim lap");
  for (const c of P.cars) assert.ok(Math.abs(finish(c) - c.lap_s) < 0.001, c.id + ": the ghost crosses the line at its lap time");
});

test("result card: your lap · physics sim of this car = the URL's lap · real pole 88.111", () => {
  const P = DR.drivePayload(built.payload, { lap_s: URL_LAP, pole_s: RACE.pole.s }).payload;
  const card = DR.resultCard({ lap_s: 91.23449, sim_lap_s: P.sim_lap_s, pole_lap_s: P.pole_lap_s, ref_lap_s: P.ref_lap_s });
  assert.equal(card.headline, "your lap 91.234 s · physics sim of this car " + URL_LAP.toFixed(3) + " s · real pole 88.111 s");
  assert.equal(card.sim, URL_LAP); assert.equal(card.pole, 88.111);
  assert.equal(card.rows.find((x) => x.key === "sim").d, Math.round((91.234 - URL_LAP) * 1000) / 1000);
  assert.equal(card.rows.find((x) => x.key === "pole").d, 3.123);
  assert.equal(card.label, "game handling model: your lap mixes the car with your driving; the sim lap is the physics lap sim · model prediction");
  assert.equal(card.personal_best, true);
  assert.equal(DR.resultCard({ lap_s: 92, sim_lap_s: 87.7, pole_lap_s: 88.111, prev_best_s: 91 }).personal_best, false);
  assert.match(DR.resultCard({ lap_s: 85.5, deleted: true, sim_lap_s: 87.7, pole_lap_s: 88.111 }).headline, /^your lap 85\.500 s \(track limits\)/);
  // the URL's lap wins over a re-run that differs: the ghost is time-scaled to it and says so
  const odd = URL_LAP + 0.25, r2 = DR.drivePayload(built.payload, { lap_s: odd, pole_s: 88.111 });
  const g = r2.payload.cars.find((c) => c.id === "concept");
  assert.equal(r2.payload.sim_lap_s, odd); assert.equal(g.t[g.t.length - 1], odd); assert.equal(g.time_scaled, true); assert.match(r2.notes.join(" "), /time-scaled/);
  assert.equal(DR.resultCard({ lap_s: 90, sim_lap_s: r2.payload.sim_lap_s, pole_lap_s: r2.payload.pole_lap_s }).sim, Math.round(odd * 1000) / 1000);
});

test("race the grid: real 2026 qualifying order, PURPLE placed by its sim lap in Hadjar's seat; result card", () => {
  const o = DR.gridOrder(RACE.q, 87.7);
  assert.equal(o.length, Object.keys(RACE.q).length, "21 real drivers + PURPLE (HAD's seat is the player's)");
  assert.ok(!o.some((r) => r.code === "HAD"));
  assert.equal(o[0].code, "PRPL"); assert.equal(o[1].code, "ANT");
  const o2 = DR.gridOrder(RACE.q, 88.47);
  assert.deepEqual(o2.slice(0, 5).map((r) => r.code), ["ANT", "LEC", "HAM", "PRPL", "RUS"]);
  assert.equal(DR.gridOrder({ ANT: 88.111 }, 88.111)[0].code, "PRPL", "ties: PURPLE first, as on the demo board");
  for (let i = 1; i < o.length; i++) assert.ok(o[i].s >= o[i - 1].s);
  const g = DR.gridPayload(built.payload, { lap_s: URL_LAP, q: RACE.q, multipliers: built.cinematic.multipliers });
  assert.equal(g.ok, true); assert.equal(g.payload.kind, "grid"); assert.equal(g.payload.laps, 3); assert.equal(g.payload.difficulty, "official");
  assert.equal(g.payload.player.replace, "HAD"); assert.deepEqual(g.payload.player.aero, built.cinematic.multipliers);
  assert.equal(g.payload.honest, "game race · AI pace scaled to real 2026 qualifying times · your car uses the optimised design's aero and mass; not a prediction of a real race");
  assert.match(g.payload.grid_note, /PURPLE placed by its sim lap/);
  assert.equal(DR.gridPayload(built.payload, { q: {} }).ok, false);
  const c = DR.gridResultCard({ position: 3, field: 22, finished: true, laps: [95.12345, 90.5, 90.25], best_lap: 90.25 });
  assert.equal(c.headline, "P3 of 22 · best lap 90.250 s");
  assert.equal(c.lap_text, "L1 95.123 · L2 90.500 · L3 90.250");
});

test("best lap storage: per design and lap, survives a missing or throwing localStorage", () => {
  const m = new Map(), store = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  const key = DR.bestKey(best, URL_LAP);
  assert.equal(DR.loadBest(store, key), null);
  assert.equal(DR.saveBest(store, key, 91.2344), true); assert.equal(DR.loadBest(store, key), 91.234);
  const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(DR.loadBest(bad, key), null); assert.equal(DR.saveBest(bad, key, 90), false);
});

// the game file in a sandbox page: what it does at load for a given query string
function loadGame(search) {
  const src = fs.readFileSync(path.join(ROOT, "js", "conceptrace.js"), "utf8"), seen = { listeners: [], head: [], body: [], read: 0 };
  const node = () => ({ style: {}, remove() {}, querySelectorAll: () => [], appendChild() {} });
  const document = { getElementById: () => { seen.read++; return null; }, createElement: (tag) => Object.assign(node(), { tag }), head: { appendChild: (e) => seen.head.push(e) }, body: { appendChild: (e) => seen.body.push(e) } };
  const ctx = { location: { search, origin: "http://127.0.0.1" }, document, URLSearchParams, console, Promise, setTimeout: () => 0, requestAnimationFrame: () => 0, performance: { now: () => 0 }, addEventListener: (t) => seen.listeners.push(t) };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  return { api: ctx.EI.ConceptRace, seen, style: (seen.head.find((e) => e.tag === "style") || {}).textContent || "" };
}

test("flag gating: the drive modes do nothing without ?concept=1 (and never with ?lab=1); the game files are untouched", () => {
  for (const q of ["", "?drive=trial", "?drive=grid&track=silverstone", "?concept=1&lab=1&drive=trial", "?lab=1&drive=grid"]) {
    const g = loadGame(q);
    assert.equal(g.api.active, false, q); assert.equal(g.api.drive, undefined, q);
    assert.equal(g.seen.listeners.length, 0, q + ": no key or message listener"); assert.equal(g.seen.head.length, 0, q + ": no style, no script"); assert.equal(g.seen.read, 0, q + ": the page is not touched");
  }
  const trial = loadGame("?concept=1&track=silverstone&drive=trial");
  assert.equal(trial.api.active, true); assert.equal(trial.api.drive, "trial");
  assert.match(trial.style, /^#menu,#viewports,#banner,#lights,#pause,#results,#pitui,#controls\{display:none!important\}/, "the time trial keeps the touch controls and toasts");
  const grid = loadGame("?concept=1&track=silverstone&drive=grid");
  assert.equal(grid.api.drive, "grid"); assert.match(grid.style, /^#menu,#banner,#pause,#results,#controls,\.tw-f1\{display:none!important\}/, "the race keeps the game's HUD but not its F1 logo");
  const replay = loadGame("?concept=1&track=silverstone");
  assert.equal(replay.api.drive, null); assert.match(replay.style, /^#menu,#viewports,#banner,#touch,#lights,#pause,#results,#pitui,#toasts,#controls\{/, "the replay modes as before");
  // no game file but js/conceptrace.js knows about the drive modes; index.html and main.js are unchanged by them
  for (const f of ["index.html", "js/main.js", "js/race.js", "js/car.js", "js/ai.js", "js/carmodel.js", "js/input.js"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /drive\.js|purple:drive|DRIVE_MODES/, f);
});

test("honest words: the drive modes say what drives the numbers and never overclaim", () => {
  const page = ["concept/race/drive.js", "concept/race/race.js", "concept/race/index.html", "js/conceptrace.js"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  assert.doesNotMatch(page, /\bCFD\b|wind tunnel|validated/i);
  assert.match(DR.TRIAL_FOOT, /not associated with Formula 1, the FIA or FOM/);
  assert.match(DR.GRID_FOOT, /AI pace scaled to real 2026 qualifying times/);
  const html = fs.readFileSync(path.join(ROOT, "concept/race/index.html"), "utf8");
  assert.match(html, /id="btnDrive"/); assert.match(html, /<script src="drive\.js"><\/script>/);
  assert.match(html, /href="\.\.\/lab\/"[^>]*>Back to the engineer|id="cardBack" href="\.\.\/lab\/">Back to the engineer/);
});
