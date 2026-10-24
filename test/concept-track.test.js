// PURPLE concept - track model and corner statistics (concept/track/, docs/concept/TRACK.md)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const track = require("../concept/track/track.js");
const builder = require("../concept/track/build.js");

const TEL = path.join(__dirname, "..", "concept", "data", "telemetry");
const model = track.load("silverstone");
const byId = id => model.corners.find(c => c.id === id);
const lapFile = code => JSON.parse(fs.readFileSync(path.join(TEL, "silverstone-2026-q-" + code + ".json"), "utf8"));
const kmhToMs = v => v / 3.6;

test("stats: mean, sample std, min, max, n; nulls ignored", () => {
  const s = track._.stats([1, 2, 3, 4, null, NaN], 3);
  assert.deepEqual(s, { mean: 2.5, std: 1.291, min: 1, max: 4, n: 4 });
  assert.deepEqual(track._.stats([]), { mean: null, std: null, min: null, max: null, n: 0 });
  assert.equal(track._.stats([7]).std, 0);
});

test("geometry: fused centreline length within 1 % of the official 5.891 km", () => {
  const g = model.geometry;
  assert.equal(g.source, "osm");
  assert.equal(model.official.centreline_length_m, 5891);
  assert.ok(Math.abs(g.length_m - 5891) / 5891 < 0.01, "length " + g.length_m);
  assert.ok(Math.abs(g.length_vs_official_pct) < 1);
  // about 2 m spacing, closed loop
  assert.ok(Math.abs(g.centreline.step_m - 2) < 0.01);
  assert.equal(g.centreline.x.length, g.centreline.n);
  const c = g.centreline, n = c.n, gap = Math.hypot(c.x[0] - c.x[n - 1], c.y[0] - c.y[n - 1]);
  assert.ok(gap < 3, "closing gap " + gap);
});

test("geometry: Silverstone is clockwise, the OSM fit is a rigid move at ~unit scale, the racing line stays near the centreline", () => {
  const g = model.geometry;
  assert.equal(g.sense, "clockwise");
  assert.ok(Math.abs(g.net_turning_deg + 360) < 10, "net turning " + g.net_turning_deg);
  assert.equal(g.alignment.mirrored, false);
  assert.ok(Math.abs(g.alignment.similarity_scale - 1) < 0.01);
  assert.ok(g.alignment.racing_line_to_centreline_rms_m < 6);
  const off = model.field.racing_line_offset_m.mean.filter(Number.isFinite);
  assert.ok(Math.max(...off.map(Math.abs)) < 12, "racing line within ~track width of the OSM centreline");
});

test("geometry: sector lines found from the timing data land on the FIA's published split points (+-30 m)", () => {
  const pub = model.sectors.published_splits_m;
  assert.deepEqual(pub, [1823, 4287]);
  model.sectors.splits_m.forEach((s, i) => assert.ok(Math.abs(s.mean - pub[i]) < 30, "split " + i + " " + s.mean));
});

test("corners: 18 markers, known directions (FIA map), types from apex speed", () => {
  assert.equal(model.corners.length, 18);
  const dir = { T3: "right", T4: "left", T6: "left", T7: "right", T9: "right", T10: "left", T11: "right", T12: "left", T13: "right", T14: "left", T15: "right", T16: "left", T17: "right" };
  for (const [id, d] of Object.entries(dir)) assert.equal(byId(id).direction, d, id + " " + byId(id).name);
  assert.equal(byId("T9").name, "Copse");
  for (const c of model.corners) {
    const v = c.apex_speed_kmh.mean;
    assert.equal(c.type, v < 150 ? "slow" : v > 230 ? "fast" : "medium");
    assert.ok(c.entry_m <= c.apex_m && c.apex_m <= c.exit_m, c.id);
    assert.ok([1, 2, 3].includes(c.sector));
  }
  assert.equal(byId("T4").type, "slow"); assert.equal(byId("T9").type, "fast"); assert.equal(byId("T15").type, "medium");
});

test("corners: apex radii in plausible ranges (TRACK.md: R in [v^2/(6 g), v^2/(1.5 g)] at the field's apex speed, plus slow-corner bounds)", () => {
  // centreline (geometric) minimum radius: the hairpin-like corners are tight, the fast ones are not
  const geom = { T3: [12, 45], T4: [12, 45], T16: [12, 45], T7: [30, 80], T6: [25, 80], T9: [45, 200], T15: [45, 200], T13: [40, 150], T11: [40, 200] };
  for (const [id, [lo, hi]] of Object.entries(geom)) { const r = byId(id).apex_radius_geom_m; assert.ok(r >= lo && r <= hi, id + " R_geom " + r); }
  // effective radius v^2 / a_lat from the field must sit between the 6 g and 1.5 g circles at the apex speed
  for (const c of model.corners.filter(k => k.turn_angle_deg > 45)) {
    const v = kmhToMs(c.apex_speed_kmh.mean), r = c.r_eff_m.mean;
    assert.ok(r >= (v * v) / (6 * 9.80665) && r <= (v * v) / (1.5 * 9.80665), c.id + " R_eff " + r);
  }
  // the racing line opens up the slow corners: R_eff >= the centreline radius there
  for (const id of ["T3", "T4", "T16"]) assert.ok(byId(id).r_eff_m.mean >= byId(id).apex_radius_geom_m, id);
});

test("corners: per-corner driving statistics match the README's pole-lap readings", () => {
  const loop = byId("T4"), village = byId("T3");
  assert.equal(loop.apex_speed_kmh.n, 22);
  assert.equal(loop.min_gear.min, 2);
  assert.equal(loop.drivers_braking, 22);
  assert.equal(loop.by_driver.ANT.apex_kmh, 87);       // README: The Loop 87 km/h, the slowest point of the lap
  assert.equal(village.by_driver.ANT.apex_kmh, 108);   // README: Village 108 km/h
  assert.equal(model.lap.by_driver.ANT.lap_time_s, 88.111);
  assert.ok(Math.abs(model.lap.by_driver.ANT.full_throttle_pct - 63.8) < 1.5);   // README 63.8 % of lap time
  for (const c of model.corners.filter(k => k.drivers_braking >= 11)) {
    assert.ok(c.peak_decel_g.mean > 0.3 && c.peak_decel_g.mean < 6.5, c.id + " decel");
    assert.ok(c.brake_start_m.mean < c.apex_at_m.mean, c.id + " brakes before its apex");
    assert.ok(c.entry_speed_kmh.mean > c.apex_speed_kmh.mean, c.id);
  }
  for (const c of model.corners) { assert.ok(c.time_s.mean > 0 && c.time_s.mean < 6, c.id + " time"); assert.ok(c.lat_g_peak.mean > 1 && c.lat_g_peak.mean < 6.5, c.id + " lat g"); }
});

test("straights: speed falls at full throttle (energy clipping signature) and straight-mode zones overlay", () => {
  assert.ok(model.straights.length >= 4);
  const hangar = model.straights.find(s => s.to_corner === "T15");
  assert.ok(hangar, "Hangar Straight");
  assert.ok(hangar.peak_kmh.mean > 290 && hangar.peak_kmh.mean < 320);
  assert.deepEqual(hangar.straight_mode_zones, ["A4"]);
  const pit = model.straights.find(s => s.crosses_line);
  assert.ok(pit.loss_kmh.mean > 20, "pit straight loses speed at full throttle (README: 313 -> 276)");
  for (const s of model.straights) { assert.ok(s.loss_kmh.min >= 0); assert.ok(s.gear_at_peak.mean >= 6); }
  assert.equal(model.straight_mode_zones.length, 4);
  assert.ok(model.straight_mode_zones.every(z => Number.isFinite(z.activation_m)));
});

test("lap level: shares, sectors, speed trap", () => {
  const l = model.lap;
  assert.equal(l.lap_time_s.n, 22);
  assert.equal(l.lap_time_s.min, 88.111);
  assert.ok(l.full_throttle_pct.mean > 50 && l.full_throttle_pct.mean < 75);
  assert.ok(l.braking_pct.mean > 5 && l.braking_pct.mean < 20);
  assert.ok(l.full_throttle_pct.mean + l.braking_pct.mean + l.coasting_pct.mean < 100);
  const sum = l.sector_s.reduce((a, s) => a + s.mean, 0);
  assert.ok(Math.abs(sum - l.lap_time_s.mean) < 0.01);
  assert.ok(l.speed_trap_fit.rms_kmh < 2 && Math.abs(l.speed_trap_fit.at_m - byId("T15").marker_m) < 400, "trap on the Hangar Straight");
});

test("data quality: OCO's frozen speed channel into Vale is detected and dropped", () => {
  const oco = model.quality.frozen_speed.find(q => q.lap === "OCO");
  assert.ok(oco && oco.runs.some(r => r.speed_kmh === 253));
  assert.ok(byId("T16").apex_speed_kmh.max < 200);
});

test("determinism: two builds are byte-identical and equal the committed model", () => {
  const a = builder.serialise(builder.build("silverstone")), b = builder.serialise(builder.build("silverstone"));
  assert.equal(a, b);
  // every circuit whose telemetry is in this checkout: the committed model is exactly what the build makes
  for (const { id } of builder.discover()) {
    const committed = fs.readFileSync(path.join(__dirname, "..", "concept", "data", "tracks", id + ".json"), "utf8");
    assert.equal(id === "silverstone" ? a : builder.serialise(builder.build(id)), committed, id + ": run node concept/track/build.js");
  }
});

test("build: discovers circuits generically; the OSM shim never defines document", () => {
  const ids = builder.discover().map(c => c.id);
  assert.ok(ids.includes("silverstone"));
  for (const id of ids) assert.ok(fs.existsSync(path.join(__dirname, "..", "concept", "data", "tracks", id + ".json")), id + " model built");
  const osm = builder.loadOsm("silverstone");
  assert.ok(osm && osm.data.center.length > 100);
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(builder.loadOsm("no-such-circuit"), null);
});

test("compare: a real lap against itself gives ~0 error", () => {
  const d = model.drivers.ANT, s_m = d.speed.map((_, k) => k * model.field.step_m);
  const self = track.compare({ s_m, v_kmh: d.speed }, "silverstone", { driver: "ANT" });
  assert.equal(self.basis, "model");
  assert.equal(self.vs_driver.rms_kmh, 0);
  assert.equal(self.vs_driver.corner_rms_kmh, 0);
  assert.ok(self.corners.every(c => c.delta_driver_kmh === 0));
  // the raw lap file through the model's own pipeline, and through the driver's distance basis
  const lap = lapFile("ant");
  const viaPipeline = track.compare(track.traceFromLap(lap, model), model, { driver: "ANT" });
  assert.ok(viaPipeline.vs_driver.rms_kmh < 0.05, "pipeline " + viaPipeline.vs_driver.rms_kmh);
  const viaBasis = track.compare({ distance_m: lap.channels.distance_m, speed_kmh: lap.channels.speed_kmh }, model, { driver: "ANT", basis: "driver:ANT" });
  assert.ok(viaBasis.vs_driver.rms_kmh < 0.1, "driver basis " + viaBasis.vs_driver.rms_kmh);
  assert.ok(Math.abs(self.lap_time_from_speed_s.sim - 88.111) < 0.5);
});

test("compare: a different lap shows real, signed deltas vs the field and the driver", () => {
  const had = track.traceFromLap(lapFile("had"), model);
  const r = track.compare(had, model, { driver: "ANT" });
  assert.ok(r.vs_driver.rms_kmh > 1 && r.vs_field.rms_kmh > 1);
  assert.equal(r.corners.length, 18); assert.equal(r.straights.length, model.straights.length);
  const loop = r.corners.find(c => c.id === "T4");
  assert.ok(Math.abs(loop.delta_field_kmh) < 10 && Number.isFinite(loop.z));
  // a fraction basis is chosen automatically when the trace length differs; bad inputs are refused
  const lap = lapFile("had");
  assert.equal(track.compare({ distance_m: lap.channels.distance_m, speed_kmh: lap.channels.speed_kmh }, model).basis, "fraction");
  assert.throws(() => track.compare({ s_m: [1, 2], v_kmh: [1, 2] }, model), /equal-length/);
  assert.throws(() => track.compare(had, model, { driver: "XXX" }), /no lap/);
  assert.throws(() => track.load("../etc"), /bad circuit id/);
});

test("every committed circuit model: length near official, whole turns, 20+ laps, corners from markers", () => {
  const dir = path.join(__dirname, "..", "concept", "data", "tracks");
  const files = fs.readdirSync(dir).filter(n => n.endsWith(".json"));
  assert.ok(files.includes("silverstone.json"));
  for (const f of files) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.equal(m.schema, "purple.track/1");
    assert.ok(Number.isFinite(m.official.centreline_length_m), f + " official length");
    // an OSM centreline is the track's centre line (within 1 %); a circuit without one uses the racing line, which runs short
    const tol = m.geometry.source === "osm" ? 1 : 2;
    assert.ok(Math.abs(m.geometry.length_vs_official_pct) < tol, f + " " + m.geometry.length_vs_official_pct + " %");
    const turns = m.geometry.net_turning_deg / 360;   // +-1 for a loop, 0 for a figure of eight (Suzuka)
    assert.ok(Math.abs(turns - Math.round(turns)) < 0.003 && Math.abs(Math.round(turns)) <= 1, f + " net turning");
    assert.equal(m.geometry.sense, Math.round(turns) === 0 ? "figure-eight" : turns < 0 ? "clockwise" : "anticlockwise");
    assert.ok(m.corners.length >= 10 && m.straights.length >= 2, f);
    assert.ok(Object.keys(m.drivers).length >= 20, f);
    for (const c of m.corners) assert.ok(c.apex_speed_kmh.n >= 10 && c.apex_speed_kmh.mean > 40 && c.apex_speed_kmh.mean < 340, f + " " + c.id);
  }
});

test("API: corners() / straights() default to the last loaded model; race laps are kept as traces", () => {
  track.load("silverstone");
  assert.equal(track.corners(), model.corners);
  assert.equal(track.straights("silverstone").length, model.straights.length);
  assert.ok(Object.keys(model.race_laps).includes("VER-R40"));
  const r = track.compare({ s_m: model.drivers.VER.speed.map((_, k) => k * model.field.step_m), v_kmh: model.race_laps["VER-R40"].speed }, model, { driver: "VER-R40" });
  assert.equal(r.vs_driver.rms_kmh, 0);
});
