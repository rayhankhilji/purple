// PURPLE concept race, "Qualifying lap" mode (docs/concept/RACE.md): every car's best 2026 British GP qualifying lap (OpenF1) plus
// PURPLE (the demo's best car, physics lap sim) and the RB22 baseline (sim) on ONE replay clock from the same line. Truthfulness:
// each ghost's finish, measured on the replay clock the game view runs (js/conceptrace.js timeline + crossingExact), equals its
// source lap time within 1 ms at any playback rate, and the finish order is the demo leaderboard's order. No browser, no network.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
global.window = global.window || globalThis;
require("../js/data/racepace2026.js"); require("../js/data/season2026.js");
const EI = globalThis.EI;
const CR = require("../js/conceptrace.js");
const RP = require("../concept/race/payload.js");
const design = require("../concept/design.js");

const RACE = EI.RACEPACE.silverstone;
const telemetry = {};
for (const code of Object.keys(RACE.q)) { const f = path.join(ROOT, RP.qualiFile(code)); if (fs.existsSync(f)) telemetry[code] = JSON.parse(fs.readFileSync(f, "utf8")); }
const deleted = JSON.parse(fs.readFileSync(path.join(ROOT, "concept/data/telemetry/silverstone-2026-q-index.json"), "utf8")).deleted_lap_times;

// the demo's best car: the recorded live run the demo replays (concept/demo/replays), its peak decision's params on the RB22 baseline
const REPLAY = JSON.parse(fs.readFileSync(path.join(ROOT, "concept/demo/replays/trained-corrections-seed12.json"), "utf8"));
const peakDecision = REPLAY.decisions.find((d) => d.peak_after === REPLAY.peak.node && d.kept && d.params);
const bestDesign = design.applyChanges(design.baseline({ team: "redbull" }), peakDecision.params.map(([k, v]) => { const [part, param] = k.split("."); return { part, param, to: v }; })).design;
const ENGINE_LAP = REPLAY.peak.lap_s;   // the "best lap now" the demo shows at the end of the replay
const built = RP.buildPayload({ design: bestDesign, ref: "redbull" });

// the replay clock as the game view runs it: fixed 120 Hz steps x playback rate from the run-up, finish solved inside the step
function finishes(payload, rate) {
  return payload.cars.map((car) => {
    const tl = CR.timeline(car), h = rate / 120; let t = -2, f = null;
    while (f == null && t < 300) { const t2 = t + h; f = CR.crossingExact(tl, t, t2, tl.L); t = t2; }
    return { car, f };
  });
}
const order = (fin) => fin.slice().sort((a, b) => (Math.round(a.f * 1e6) - Math.round(b.f * 1e6)) || a.car.rank - b.car.rank).map((x) => x.car.code);

test("quali payload: PURPLE at the engine's lap, the RB22 baseline sim, every real driver at the classified time", () => {
  assert.equal(built.ok, true, (built.errors || []).join("; "));
  assert.equal(built.payload.cars[0].lap_s, ENGINE_LAP, "the re-run sim lap of the demo's best car is the lap the demo shows");
  const Q = RP.qualiPayload(built.payload, { lap_s: ENGINE_LAP, racepace: RACE, season: EI.SEASON, telemetry, deleted });
  assert.equal(Q.ok, true, Q.errors.join("; "));
  const cars = Q.payload.cars;
  assert.equal(cars[0].id, "concept"); assert.equal(cars[0].lap_s, ENGINE_LAP); assert.equal(cars[0].source, "physics lap sim · model prediction"); assert.equal(cars[0].time_scaled, false);
  const rb = cars.find((c) => c.id === "ref"); assert.equal(rb.lap_s, 88.745); assert.equal(rb.source, "physics lap sim · model prediction"); assert.equal(rb.pos, null);
  const real = cars.filter((c) => c.kind === "real");
  assert.equal(real.length, Object.keys(RACE.q).length, "every driver with a qualifying time");
  for (const c of real) {
    assert.equal(c.lap_s, RACE.q[c.code], c.code + " finishes at the classified time");
    assert.match(c.source, /^real 2026 qualifying · OpenF1/);
    assert.equal(c.s[c.s.length - 1], Q.payload.line.L); assert.equal(c.t[c.t.length - 1], c.lap_s);
  }
  // every driver has telemetry in the repo; only laps whose OpenF1 clock differs from the classified time by > 1.5 ms are flagged
  assert.deepEqual(real.filter((c) => c.time_scaled).map((c) => c.code).sort(), ["OCO", "PER", "RUS"]);
  assert.match(Q.notes.join(" "), /PER: OpenF1 lap 91\.940 s, classified 91\.451 s \(OpenF1 lists 91\.451 as deleted/);
  assert.equal(Q.payload.ghost_line, "all laps start together; no overtaking or traffic is modelled");
  assert.doesNotMatch(JSON.stringify({ f: Q.payload.foot, l: Q.payload.label, n: Q.notes, s: cars.map((c) => c.source) }), /\bCFD\b|wind tunnel|validated/i);
});

test("each ghost's finish on the replay clock equals its source lap time within 1 ms (rates 1x, 4x, 16x); order = the demo leaderboard", () => {
  const Q = RP.qualiPayload(built.payload, { lap_s: ENGINE_LAP, racepace: RACE, season: EI.SEASON, telemetry, deleted });
  const want = RP.boardRows(RACE.q, ENGINE_LAP, 88.745).map((r) => (r.code === "BASE" ? "RB22" : r.code));
  const byInput = Q.payload.cars.slice().sort((a, b) => a.lap_s - b.lap_s || a.rank - b.rank).map((c) => c.code);
  assert.deepEqual(byInput, want, "input times sorted = the demo leaderboard");
  assert.equal(want[0], "PRPL", "PURPLE first only because its sim lap is the fastest number");
  for (const rate of [1, 4, 16]) {
    const fin = finishes(Q.payload, rate);
    for (const { car, f } of fin) assert.ok(Math.abs(f - car.lap_s) < 0.001, rate + "x " + car.code + ": finish " + f + " vs lap " + car.lap_s);
    assert.deepEqual(order(fin), want, rate + "x finish order");
  }
  // positions are the demo's: PURPLE P1, the real pole sitter P2, the RB22 baseline unnumbered
  assert.deepEqual(Q.order.slice(0, 2).map((o) => [o.code, o.pos]), [["PRPL", 1], ["ANT", 2]]);
});

test("PURPLE behind the pole when its sim lap is slower; finish order follows the numbers, not the label", () => {
  const base = RP.buildPayload({ ref: "redbull" });   // PURPLE = the RB22 baseline design itself (88.745)
  const Q = RP.qualiPayload(base.payload, { lap_s: 88.745, racepace: RACE, season: EI.SEASON, telemetry, deleted });
  assert.equal(Q.ok, true);
  assert.equal(Q.payload.cars.find((c) => c.id === "ref"), undefined, "no RB22 ghost when PURPLE is the baseline (as the demo hides the row)");
  const fin = finishes(Q.payload, 8), got = order(fin);
  assert.deepEqual(got, RP.boardRows(RACE.q, 88.745, 88.745).map((r) => r.code));
  assert.equal(got.indexOf("PRPL"), 4, "88.745: behind ANT LEC HAM RUS, ahead of HAD 88.746");
});

test("a driver without telemetry drives the pole profile scaled to his real time; an engine lap that differs scales PURPLE and says so", () => {
  const tel = Object.assign({}, telemetry); delete tel.STR;
  const Q = RP.qualiPayload(built.payload, { lap_s: 87.65, racepace: RACE, season: EI.SEASON, telemetry: tel, deleted });
  const str = Q.payload.cars.find((c) => c.code === "STR");
  assert.equal(str.time_scaled, true); assert.match(str.source, /ANT profile, time-scaled/); assert.equal(str.lap_s, RACE.q.STR);
  const me = Q.payload.cars[0]; assert.equal(me.lap_s, 87.65); assert.equal(me.time_scaled, true); assert.match(Q.notes.join(" "), /re-run sim lap 87\.700 s differs from the engine's 87\.650 s/);
  for (const { car, f } of finishes(Q.payload, 2)) assert.ok(Math.abs(f - car.lap_s) < 0.001, car.code + " " + f);
});

test("URL: the demo's link opens the qualifying lap with the engine's lap; the page reads both", () => {
  const u = RP.url(bestDesign, { base: "../race/", ref: "redbull", mode: "quali", lap_s: ENGINE_LAP });
  const q = RP.parseQuery(u.split("?")[1]);
  assert.deepEqual(q.errors, []); assert.equal(q.mode, "quali"); assert.equal(q.lap_s, 87.7); assert.deepEqual(q.design.params, bestDesign.params);
  assert.match(fs.readFileSync(path.join(ROOT, "concept/demo/demo.js"), "utf8"), /mode: "quali", lap_s: S\.final \? S\.final\.lap_s : S\.best/);
  assert.equal(RP.parseQuery("mode=quali&lap=abc").errors.length, 1);
});

test("the browser's RB22 anchor = the engine's: concept/sim/team-overrides.js is what fit.js derivedOverrides() reads in Node", () => {
  const B = require("../concept/sim/build-team-overrides.js");
  assert.equal(fs.readFileSync(path.join(ROOT, "concept/sim/team-overrides.js"), "utf8"), B.source(B.build()), "re-run node concept/sim/build-team-overrides.js");
  assert.match(fs.readFileSync(path.join(ROOT, "concept/race/index.html"), "utf8"), /<script src="\.\.\/sim\/team-overrides\.js"><\/script>[^\n]*\n<script src="\.\.\/sim\/fit\.js">/);
});
