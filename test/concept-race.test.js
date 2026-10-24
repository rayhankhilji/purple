// PURPLE concept race (docs/concept/RACE.md): the physics-replay data (concept/race/payload.js) and the game-side helpers
// (js/conceptrace.js) in Node, on the game's real Silverstone geometry (server/game-headless.js). No browser.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const G = require("../server/game-headless.js").load();
const CR = require("../js/conceptrace.js");
const RP = require("../concept/race/payload.js");
const design = require("../concept/design.js"), bench = require("../concept/bench.js"), sim = require("../concept/sim/index.js");
const tel = JSON.parse(fs.readFileSync(path.join(ROOT, RP.TELEMETRY_PATH), "utf8"));

// a legal design that differs from the baseline: a few seeded mutations kept only while legal
function variant() {
  const rng = design.seededRng(11); let d = design.baseline("redbull");
  for (let i = 0; i < 40; i++) { const m = design.mutate(d, rng, 0.08), c = m.design || m; if (bench.bench(c, { sim: "physics", objective: "quali" }).legal) d = c; }
  d.id = "variant"; return d;
}
let base, opt;
test("payload: baseline + real pole; timelines end at their laps", () => {
  base = RP.buildPayload({ ref: "redbull", telemetry: tel });
  assert.equal(base.ok, true, base.errors.join("; "));
  const [c, r, p] = base.payload.cars;
  assert.deepEqual([c.id, r.id, p.id], ["concept", "ref", "pole"]);
  assert.equal(c.lap_s, sim.simulateLap(bench.guardEnergy(sim.baselineCar("redbull")), "silverstone").lap_s);   // the RB22 baseline design laps its anchor
  assert.equal(c.lap_s, r.lap_s);
  assert.equal(p.lap_s, 88.111); assert.equal(p.source, "real 2026 qualifying telemetry · OpenF1"); assert.equal(p.time_check_s, 0);
  for (const car of base.payload.cars) {
    const tl = CR.timeline(car);
    assert.ok(Math.abs(tl.lap - car.lap_s) < 1e-9, car.id + " timeline lap");
    assert.ok(Math.abs(tl.L - base.payload.line.L) < 1, car.id + " lap length");
    car.sector_line_times_s.forEach((x, j) => { const cum = car.sectors_s.slice(0, j + 1).reduce((a, b) => a + b, 0); assert.ok(Math.abs(x - cum) < 0.03, car.id + " sector " + (j + 1) + ": " + x + " vs " + cum); });
  }
  assert.ok(Math.abs(c.time_method.integrated_lap_s - c.lap_s) < 0.05, "∫ds/v of the trace agrees with the sim lap");
  assert.match(base.payload.label, /^physics lap sim · Silverstone · /);
  assert.ok(c.design && c.design.params && r.design && r.design.params, "designs for EI.conceptView.buildCar");
});

test("payload: a changed design laps what the bench says; ERS / aero channels; cinematic links", () => {
  const d = variant(); opt = RP.buildPayload({ design: d, ref: "redbull", telemetry: tel });
  assert.equal(opt.ok, true, opt.errors.join("; "));
  const b = bench.bench(d, { sim: "physics", objective: "quali" });
  assert.equal(opt.payload.cars[0].lap_s, b.circuits.silverstone.lap_s);
  assert.notEqual(opt.payload.cars[0].lap_s, opt.payload.cars[1].lap_s);
  const c = opt.payload.cars[0];
  for (const k of ["aero", "ers", "gear"]) assert.equal(c[k].length, c.s.length, k);
  assert.ok(c.aero.includes("straight") && c.aero.includes("corner"));
  assert.ok(c.ers.includes("deploy") && c.ers.includes("harvest"));
  const C = opt.cinematic; assert.equal(C.ok, true); assert.equal(C.label, "cinematic — game lap model, mixes car and driver");
  const mc = new URLSearchParams(C.race.split("?")[1]);
  assert.equal(mc.get("lab"), "1"); assert.deepEqual(RP.decodeParam(mc.get("mult_candidate")), C.multipliers); assert.deepEqual(RP.decodeParam(mc.get("mult_baseline")), { df: 1, cd: 1, a0: 1, b0: 1 });
  // the game's own ?lab=1 decoder (js/main.js LAB: atob after - -> +, _ -> /) reads the same object
  const atobLab = (v) => JSON.parse(Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1"));
  assert.deepEqual(atobLab(mc.get("mult_candidate")), C.multipliers);
  assert.equal(new URLSearchParams(C.grid.split("?")[1]).get("driver"), "HAD");
});

test("URL contract round trip; bad input is reported, not thrown", () => {
  const d = design.baseline("redbull"); d.id = "rt";
  const u = RP.url(d, { conditions: { wind_ms: 3, wind_from_deg: 105 } });
  assert.match(u, /^\/concept\/race\/\?design=[A-Za-z0-9_-]+&ref=redbull&conditions=/);
  const q = RP.parseQuery(u.split("?")[1]);
  assert.deepEqual(q.errors, []); assert.deepEqual(q.design.params, d.params); assert.equal(q.ref, "redbull"); assert.deepEqual(q.conditions, { wind_ms: 3, wind_from_deg: 105 });
  assert.equal(q.mode, "replay");
  const bad = RP.parseQuery("design=%%%&ref=nope&wind_ms=x");
  assert.equal(bad.errors.length, 3);
  assert.deepEqual(RP.parseQuery("").errors, []);
});

test("wind goes through to the sim and into the label", () => {
  const w = RP.buildPayload({ ref: "redbull", conditions: { wind_ms: 4, wind_from_deg: 200 } });
  assert.equal(w.ok, true);
  assert.notEqual(w.payload.cars[0].lap_s, base.payload.cars[0].lap_s);
  assert.match(w.payload.conditions_label, /wind 4\.0 m\/s from 200°/);
});

test("illegal or malformed designs get no lap", () => {
  const r = RP.buildPayload({ design: { params: {} }, ref: "redbull" });
  assert.equal(r.ok, false); assert.equal(r.payload, undefined);
});

test("mapping onto the game's Silverstone: sub-metre RMS, bounded, start line offset reported", () => {
  const track = G.evaluator.trackFor("silverstone");
  const m = CR.mapLine(track, base.payload.line), s = m.stats;
  assert.ok(s.position_rms_m < 1.0, "RMS " + s.position_rms_m);
  assert.ok(s.position_max_m < 6, "max " + s.position_max_m);
  assert.ok(s.clamped_share < 0.25);
  assert.ok(Math.abs(s.scale - track.length / base.payload.line.L) < 0.002);
  assert.ok(Math.abs(s.control_line_game_s - 80.4) < 10, "control line near OSM s 80.4: " + s.control_line_game_s);
  // every shown position is on the asphalt, heading follows the path
  for (let k = 0; k < m.n; k += 7) { const pr = track.project(m.px[k], m.pz[k], null, {}); assert.ok(Math.abs(pr.lat) <= s.clamp_limit_m + 0.3, "sample " + k + " lat " + pr.lat); }
  const p = m.pose(1000), q = m.pose(1002); assert.ok(Math.abs(Math.atan2(q.z - p.z, q.x - p.x) - p.heading) < 0.1);
});

test("replay clock: the finish is the sim's lap time (stepped at 120 Hz x 4)", () => {
  for (const car of opt.payload.cars) {
    const tl = CR.timeline(car); let t = -2, d = tl.dist(t), fin = null; const h = 4 / 120;
    while (fin == null && t < 200) { const t2 = t + h, d2 = tl.dist(t2); fin = CR.crossing(d, d2, t, t2, tl.L); t = t2; d = d2; }
    assert.ok(Math.abs(fin - car.lap_s) < 0.05, car.id + ": " + fin + " vs " + car.lap_s);
    assert.ok(Math.abs(tl.dist(car.lap_s + 10) - (tl.L + tl.dist(10))) < 1e-6, "laps repeat");
    assert.ok(tl.dist(-1) < 0, "the run-up is the end of the lap before");
  }
});

test("game hooks are opt-in: no flag, no behaviour", () => {
  assert.equal(CR.active, false);
  const main = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8"), html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(main, /const CONCEPT = !LAB && EI\.ConceptRace && EI\.ConceptRace\.active \? EI\.ConceptRace : null;/);
  assert.match(main, /if \(LAB\) labStart\(\); else if \(CONCEPT\) CONCEPT\.start\(EI\.debug\);/);
  assert.equal((main.match(/CONCEPT/g) || []).length, 5, "CONCEPT appears only in the hook comments and the two hook lines");
  assert.ok(html.indexOf("js/conceptrace.js") > 0 && html.indexOf("js/conceptrace.js") < html.indexOf("js/main.js"));
  const page = fs.readFileSync(path.join(ROOT, "concept", "race", "index.html"), "utf8") + fs.readFileSync(path.join(ROOT, "concept", "race", "race.js"), "utf8") + fs.readFileSync(path.join(ROOT, "js", "conceptrace.js"), "utf8") + fs.readFileSync(path.join(ROOT, "concept", "race", "payload.js"), "utf8");
  assert.doesNotMatch(page, /\bCFD\b|wind tunnel|validated/i);
});
