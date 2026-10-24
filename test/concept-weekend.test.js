// PURPLE CONCEPT - the race weekend model (concept/weekend/weekend.js): qualifying among the real 2026 Silverstone laps, the
// deterministic race-pace model, strategy choice, calibration against the real field, determinism, pluggable sim and speed.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
require("../server/game-headless.js").load();
const W = require("../concept/weekend/weekend.js"), design = require("../concept/design.js"), physical = require("../concept/physical.js"), bench = require("../concept/bench.js");
const B = design.baseline(), PC = physical.physical(B);
const noMs = r => JSON.parse(JSON.stringify(r, (k, v) => (k === "ms" ? undefined : v)));
const RP = bench.racepace().silverstone;

test("weekend: the baseline concept car (sim v0) qualifies on pole and races at the front, score ≈ 0", () => {
  const s = W.score(PC, { sim: "v0" });
  // v0 anchors the baseline to the real 2026 pole (88.111 s); a tie goes to our car, as in bench.weekend()
  assert.equal(s.quali.lap_s, RP.pole.s); assert.equal(s.quali.pos, 1); assert.equal(s.quali.gap_to_pole_s, 0); assert.equal(s.quali.field_size, 23);
  assert.ok(s.race.pos <= 3, "race P" + s.race.pos); assert.equal(s.race.field_size, 23);
  assert.ok(Math.abs(s.weekend_score) < 0.1, "score " + s.weekend_score);
  // its median race lap is the pole lap + the field-median race-vs-quali gap: ANT's real race pace, LEC's is quicker
  assert.ok(Math.abs(s.race.pace.race_lap_median_s - (RP.pole.s + W.calibration().field.r_minus_q_median_s)) < 0.01);
  assert.equal(s.race.strategy.stops, 1);
  assert.match(s.label, /^concept weekend model · .*sim v0.* · real 2026 British GP lap data$/);
  assert.equal(s.race.classification.length, 23); assert.equal(s.race.classification[s.race.pos - 1].code, "CONCEPT");
  assert.equal(s.field.frame, "real"); assert.equal(s.field.fuel_basis, "coefficient");
});

test("weekend: a car with a midfield lap lands in the midfield in both sessions", () => {
  const s = W.score({ lap_s: 89.0 });
  assert.equal(s.quali.pos, 1 + Object.values(RP.q).filter(x => x < 89.0).length);
  assert.ok(s.race.pos >= 5 && s.race.pos <= 12, "race P" + s.race.pos);
  assert.ok(s.weekend_score < -0.5 && s.weekend_score > -1.5, "score " + s.weekend_score);
});

test("weekend: a faster car moves up (lap sweep and a real design change)", () => {
  const laps = [93, 92, 91, 90, 89.5, 89, 88.5, 88.111, 87.5];
  let prev = null;
  for (const lap of laps) {
    const s = W.score({ lap_s: lap });
    if (prev) {
      assert.ok(s.quali.pos <= prev.quali.pos, lap + ": quali"); assert.ok(s.race.pos <= prev.race.pos, lap + ": race");
      assert.ok(s.weekend_score > prev.weekend_score, lap + ": score " + s.weekend_score + " vs " + prev.weekend_score);
    }
    prev = s;
  }
  // straight-mode flaps make the concept car quicker under sim v0 -> a better weekend
  const d = design.clone(B); d.params.rear_wing.sm_delta_deg = 25; d.params.front_wing.sm_delta_deg = 12;
  const base = W.score(PC, { sim: "v0" }), fast = W.score(d, { sim: "v0" });   // a Design is accepted and converted with physical()
  assert.ok(fast.quali.lap_s < base.quali.lap_s); assert.ok(fast.weekend_score > base.weekend_score);
  assert.ok(fast.components.quali_margin_s > 0 && fast.components.race_margin_s_per_lap > 0);
});

test("weekend: strategy choice by minimum total time, two-compound rule, forced strategies cost time", () => {
  const p = W.params(), st = W.strategies(p);
  for (const s of st.by_stops) {
    assert.equal(s.stints.reduce((a, x) => a + x.laps, 0), p.laps);
    assert.ok(new Set(s.stints.map(x => x.compound)).size >= 2, s.name);
  }
  assert.equal(st.best.stops, 1); assert.deepEqual(st.best.stints.map(x => x.tyre).sort(), ["C2", "C3"]);   // Pirelli's 2026 expectation
  const two = st.by_stops.find(s => s.stops === 2); assert.ok(two.delta_to_best_s > 3 && two.delta_to_best_s < 15, "two-stop +" + two.delta_to_best_s);
  // a cheap pit lane makes the two-stop pay; a dearer one keeps the one-stop
  assert.equal(W.strategies(W.params({ pit_loss_s: 5 })).best.stops, 2);
  assert.equal(W.strategies(W.params({ pit_loss_s: 30 })).best.stops, 1);
  // heavy degradation everywhere pushes to two stops; no degradation and no two-compound rule: no stop
  const heavy = { soft: { deg_s_per_lap: 0.3 }, medium: { deg_s_per_lap: 0.2 }, hard: { deg_s_per_lap: 0.15 } };
  assert.equal(W.strategies(W.params({ compounds: heavy })).best.stops, 2);
  const flat = { soft: { deg_s_per_lap: 0, cliff_lap: 99 }, medium: { deg_s_per_lap: 0, cliff_lap: 99 }, hard: { deg_s_per_lap: 0, cliff_lap: 99 } };
  assert.equal(W.strategies(W.params({ compounds: flat, two_compound_rule: false })).best.stops, 0);
  // forcing the two-stop on the race costs the car time
  const base = W.race({ lap_s: 88.111 }), forced = W.race({ lap_s: 88.111 }, { strategy: 2 });
  assert.equal(forced.strategy.stops, 2); assert.match(forced.strategy.chosen_by, /forced/);
  assert.ok(forced.total_s > base.total_s + 3, "forced two-stop " + (forced.total_s - base.total_s).toFixed(3) + " s");
  const custom = W.race({ lap_s: 88.111 }, { strategy: [{ compound: "medium", laps: 26 }, { compound: "hard", laps: 26 }] });
  assert.deepEqual(custom.strategy.pit_laps, [26]);
});

test("weekend: calibration against the real 2026 field (r vs q)", () => {
  const c = W.calibration();
  assert.equal(c.field.n, 22);
  assert.ok(c.field.r_minus_q_median_s > 5 && c.field.r_minus_q_median_s < 7, "median r−q " + c.field.r_minus_q_median_s);
  // fuel + tyres explain a minority of the gap; the rest is the race-mode offset, positive
  assert.ok(c.model.excess_median_s > 0.8 && c.model.excess_median_s < c.field.r_minus_q_median_s / 2);
  assert.ok(Math.abs(c.model.race_mode_offset_s - (c.field.r_minus_q_median_s - c.model.excess_median_s)) < 0.002);
  assert.ok(c.field.r_from_q_mae_s < 0.5, "MAE " + c.field.r_from_q_mae_s);
  // every real driver runs at their own real race pace: alone (concept car far behind) the model's leader is within the real top 4
  const solo = W.race({ lap_s: 200 });
  assert.equal(solo.classification[solo.classification.length - 1].code, "CONCEPT");
  assert.ok(["LEC", "ANT", "HAM", "VER"].includes(solo.classification[0].code));
});

test("weekend: deterministic; seeded noise is reproducible; replace drops a real driver", () => {
  assert.deepEqual(noMs(W.score(PC)), noMs(W.score(PC)));
  const a = W.race({ lap_s: 88.6 }, { noise_s: 0.2, seed: 7 }), b = W.race({ lap_s: 88.6 }, { noise_s: 0.2, seed: 7 }), c = W.race({ lap_s: 88.6 }, { noise_s: 0.2, seed: 8 });
  assert.deepEqual(a, b); assert.notEqual(a.total_s, c.total_s);
  const r = W.score({ lap_s: 88.2 }, { replace: "ANT" });
  assert.equal(r.quali.field_size, 22); assert.equal(r.quali.pos, 1); assert.equal(r.quali.pole_code, "LEC");
  assert.ok(!r.race.classification.some(x => x.code === "ANT"));
});

test("weekend: the sim is pluggable - sim(physicalCar, trackId, conditions) at quali fuel on softs", () => {
  const calls = [];
  const qf = W.params().quali_fuel_kg;
  const fake = (pc, track, cond) => { calls.push({ fuel: pc.fuel_kg, compound: pc.tyres.compound, track, cond }); return { lap_s: 88.4 + 0.01 * (pc.fuel_kg - qf), label: "fake sim" }; };
  const s = W.score(PC, { sim: fake, conditions: { wet: false } });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], { fuel: qf, compound: "soft", track: "silverstone", cond: { wet: false } });
  assert.equal(s.quali.lap_s, 88.4); assert.equal(s.quali.pos, 3); assert.equal(s.quali.gap_to_pole_s, 0.289);
  assert.equal(s.label, "concept weekend model · fake sim · real 2026 British GP lap data");
  // fuel: "sim" measures the sim's own fuel-mass sensitivity (lap at start fuel vs quali fuel)
  calls.length = 0; const f = W.race(PC, { sim: fake, fuel: "sim" });
  assert.equal(calls.length, 2); assert.equal(calls[1].fuel, W.params().start_fuel_kg);
  assert.equal(f.pace.fuel_basis, "sim"); assert.ok(Math.abs(f.pace.fuel_s_per_kg - 0.01) < 1e-9);
  assert.equal(W.qualifying(PC, { sim: fake }).pos, 3);
});

test("weekend: < 200 ms per full weekend after warm-up (sim v0)", () => {
  W.score(PC, { sim: "v0" });
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 10; i++) W.score(PC, { sim: "v0" });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 10;
  assert.ok(ms < 200, ms.toFixed(1) + " ms");
});

test("weekend: honest wording in labels, parameters and docs", () => {
  const banned = /\bCFD\b|wind tunnel|validated|aerodynamically tested/i;
  const s = W.score(PC);
  assert.doesNotMatch(JSON.stringify(s), banned); assert.doesNotMatch(JSON.stringify(W.PARAMS), banned);
  for (const k of Object.keys(W.PARAMS)) { assert.ok(W.PARAMS[k].basis, k); assert.match(W.PARAMS[k].status, /^(official|reported|derived|assumption)$/, k); }
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "concept", "WEEKEND.md"), "utf8");
  assert.doesNotMatch(doc, banned);
  for (const k of Object.keys(W.PARAMS)) assert.ok(doc.includes(k), "WEEKEND.md documents " + k);
});
