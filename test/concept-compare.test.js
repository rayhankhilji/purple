// PURPLE side by side (/concept/compare/): the page's data reproduces the measured races of docs/concept/TESTS_TO_POLE.md.
//   lane A (PURPLE · Claude through Mubit) = the recorded live run, point for point (concept/benchmark/steered.js), laps to pole as
//   curves.json; lane B (CMA-ES) = the curves.json CMA-ES curve for that seed, point for point, laps to pole as curves.json; every lane's
//   per-car record is consistent with its best-so-far line and its designs. No network, no Mubit: build.js and compare.js reach neither.
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "concept", "compare");
const curves = require("../concept/benchmark/curves.json");
const steered = require("../concept/benchmark/steered.js");
const C = require("../concept/benchmark/curves.js");
const index = JSON.parse(fs.readFileSync(path.join(DIR, "data", "index.json"), "utf8"));
const load = s => JSON.parse(fs.readFileSync(path.join(DIR, "data", "seed" + s + ".json"), "utf8"));

test("index: seed 12 is shown first; the footer numbers are TESTS_TO_POLE.md §1", () => {
  assert.equal(index.default, 12);
  assert.ok(index.seeds.some(s => s.seed === 12));
  const P = index.tests_to_pole.to_pole_laps;
  assert.deepEqual([P.steered.mean, P.steered.sd], [781, 779]);
  assert.deepEqual([P.cmaes.mean, P.cmaes.sd], [1723, 1471]);
  assert.deepEqual([P.engine_noai.mean, P.engine_noai.sd], [216, 144]);
});

for (const { seed } of index.seeds) {
  const D = load(seed), ref = curves.seeds[seed];
  test("seed " + seed + ": labels, pole, budget", () => {
    assert.equal(D.label, "physics lap sim · Silverstone · model prediction");
    assert.equal(D.pole.s, 88.111); assert.equal(D.pole.code, "ANT");
    assert.equal(D.budget, 3500);
    assert.equal(D.caption, "Same physics simulator, same Silverstone lap, same test budget.");
    assert.ok(D.lanes.purple && D.lanes.cmaes, "lanes A and B present");
  });

  test("seed " + seed + ": lane A is the recorded live run, laps to pole as TESTS_TO_POLE.md", () => {
    const A = D.lanes.purple, rec = steered.loadRecorded(seed);
    const pts = rec.points.slice(1);
    assert.equal(A.steps.length, pts.length);
    A.steps.forEach((s, i) => { assert.equal(s[0], pts[i].laps); assert.ok(Math.abs(s[1] - pts[i].best_s) < 5e-4); });
    const reach = C.reach(rec.points, 88.111);
    assert.equal(A.to_pole.laps, reach.laps);
    assert.equal(A.to_pole.laps, ref.summary.steered.to_pole.laps);
    assert.equal(A.end_laps, ref.summary.steered.total_laps);
    assert.ok(Math.abs(A.final_s - ref.summary.steered.best_s) < 5e-4);
    assert.equal(A.calls, rec.request_ids.length);
  });

  test("seed " + seed + ": lane B is the CMA-ES curve of TESTS_TO_POLE.md, laps to pole equal", () => {
    const B = D.lanes.cmaes, cm = ref.curves.cmaes.slice(1);   // [laps, legal_laps, screened, best_s]
    assert.equal(B.steps.length, cm.length);
    B.steps.forEach((s, i) => { assert.equal(s[0], cm[i][0]); assert.ok(Math.abs(s[1] - cm[i][3]) < 5e-4, "generation " + (i + 1)); });
    assert.equal(B.to_pole ? B.to_pole.laps : null, ref.summary.cmaes.to_pole ? ref.summary.cmaes.to_pole.laps : null);
    // legal laps per the per-car record = curves.json's legal_laps column
    let legal = 0, k = 0;
    for (const t of B.tries) { if (t[1] != null) legal++; if (k < cm.length && t[0] === cm[k][0]) { assert.equal(legal, cm[k][1], "legal laps at " + t[0]); k++; } }
    assert.equal(k, cm.length);
  });

  for (const id of Object.keys(D.lanes)) {
    test("seed " + seed + " lane " + id + ": every car tested agrees with the best-so-far line and the designs", () => {
      const L = D.lanes[id];
      assert.equal(L.tries.length, L.end_laps);
      L.tries.forEach((t, i) => assert.equal(t[0], i + 1));
      let best = L.baseline_s, k = 0;
      for (const t of L.tries) {
        if (t[1] != null && t[1] < best) best = t[1];
        if (k < L.steps.length && t[0] === L.steps[k][0]) { assert.ok(Math.abs(L.steps[k][1] - best) < 5e-4, id + " step " + k); k++; }
      }
      assert.equal(k, L.steps.length);
      assert.equal(L.steps[L.steps.length - 1][0], L.end_laps);
      assert.ok(L.end_laps <= D.budget);
      // designs: the start car, then one per new best, at the step that found it, with that best
      assert.equal(L.designs[0].laps, 0);
      for (let j = 1; j < L.designs.length; j++) {
        const d = L.designs[j], st = L.steps.find(s => s[0] === d.laps);
        assert.ok(st, "design at " + d.laps + " closes a step"); assert.ok(Math.abs(st[1] - d.best_s) < 5e-4);
        assert.ok(d.laps > L.designs[j - 1].laps && d.best_s < L.designs[j - 1].best_s);
        assert.ok(d.params && d.params.rear_wing && typeof d.params.rear_wing.aoa_deg === "number");
      }
      assert.ok(Math.abs(L.designs[L.designs.length - 1].best_s - L.final_s) < 5e-4);
      if (L.to_pole) { const st = L.steps.find(s => s[1] < 88.111); assert.equal(L.to_pole.laps, st[0]); } else assert.ok(L.steps.every(s => s[1] >= 88.111));
    });
  }
}

test("lane A rebuilt from the recorded files equals the data file (seed 12)", () => {
  const B = require("../concept/compare/build.js");
  const A = B.lanePurple(12), F = load(12).lanes.purple;
  assert.deepEqual(A.steps, F.steps); assert.deepEqual(A.tries, F.tries); assert.deepEqual(A.designs, F.designs);
});

test("the page: no network beyond its own data, no Mubit, no forbidden words, the honest footer", () => {
  const js = fs.readFileSync(path.join(DIR, "compare.js"), "utf8"), html = fs.readFileSync(path.join(DIR, "index.html"), "utf8"), build = fs.readFileSync(path.join(DIR, "build.js"), "utf8");
  for (const src of [js, build]) { assert.ok(!/mubit\.ai|server\/|https?:\/\//i.test(src.replace(/\/\/.*$/gm, "")), "no server / network reference"); }
  assert.deepEqual((js.match(/getJson\("([^"]+)/g) || []).map(s => s.slice(9)).sort(), ['data/index.json', 'data/seed']);
  for (const src of [js, html, fs.readFileSync(path.join(DIR, "compare.css"), "utf8")]) assert.ok(!/\bCFD\b|wind tunnel|validated/i.test(src));
  assert.match(js, /Our engine with random directions was faster still on this cheap simulator/);
  assert.match(html, /Same physics simulator, same Silverstone lap, same test budget\./);
  assert.ok(!/beats every/i.test(js + html));
  for (const s of index.seeds) assert.ok(!/\bCFD\b|wind tunnel|validated/i.test(JSON.stringify(load(s.seed))));
});
