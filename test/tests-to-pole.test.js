// PURPLE TESTS TO POLE (docs/concept/TESTS_TO_POLE.md): the steered curves reconstructed from the recorded live runs match what the
// runs streamed; the curve helpers never credit tests that were not run; the no-AI baseline really has no model in it; the committed
// curves.json is well formed and honestly labelled; the benchmark code cannot reach Mubit. No network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const C = require("../concept/benchmark/curves.js"), S = require("../concept/benchmark/steered.js"), B = require("../concept/benchmark/baselines.js");

const DIR = path.join(__dirname, "..", "concept", "benchmark");

test("steered: the recorded live runs reconstruct to their streamed peaks and physics-lap totals", () => {
  const exp = { 7: { laps: 1219, best: 87.391, base: 88.763, pole: 197 }, 11: { laps: 3429, best: 87.698, base: 88.745, pole: 1666 }, 12: { laps: 3494, best: 87.815, base: 88.745, pole: 480 } };
  for (const seed of [7, 11, 12]) {
    const r = S.loadRecorded(seed);   // throws if any decision's best differs from the streamed peak, or a request id is not Mubit's
    const sum = C.summarize(r.points, { pole_s: r.pole_s, budgets: [500, 3500] });
    assert.equal(r.pole_s, 88.111);
    assert.equal(r.baseline_s, exp[seed].base);
    assert.equal(sum.total_laps, exp[seed].laps);
    assert.equal(sum.best_s, exp[seed].best);
    assert.equal(sum.to_pole.laps, exp[seed].pole);
    assert.equal(sum.best_at[3500], null, "a run that ended before 3,500 laps has no value there");
    assert.equal(r.request_ids.length, r.calls);
  }
});

test("curves: strict beat, first reach of the best, no carry-forward past the end, truncation", () => {
  const pts = [{ laps: 0, legal_laps: 0, screened: 0, best_s: 89, step: 0 }, { laps: 30, legal_laps: 29, screened: 3000, best_s: 88.111, step: 1 }, { laps: 60, legal_laps: 58, screened: 6000, best_s: 88.0, step: 2 }, { laps: 90, legal_laps: 85, screened: 9000, best_s: 88.0, step: 3 }];
  assert.equal(C.reach(pts, 88.111).laps, 60, "equal to the pole is not beating it");
  assert.equal(C.reachBest(pts).laps, 60);
  assert.equal(C.bestAt(pts, 45), 88.111);
  assert.equal(C.bestAt(pts, 90), 88.0);
  assert.equal(C.bestAt(pts, 100), null);
  assert.equal(C.truncate(pts, 59).length, 2);
  const s = C.stats([1, 3, null]); assert.equal(s.n, 2); assert.equal(s.of, 3); assert.equal(s.mean, 2); assert.ok(Math.abs(s.sd - Math.SQRT2) < 1e-12);
});

test("no-AI baseline: every decision is the engine's own seeded step, none from a model or the scripted mock", async () => {
  await assert.rejects(B.noAiLlm()("{}", { gen: 1 }), e => e.code === "no_ai");
  const r = await B.runEngine({ seed: 3, budget: 40, workers: 0, llm: B.noAiLlm() });
  assert.ok(r.decisions >= 1);
  assert.deepEqual(r.by, { mubit: 0, mock: 0, engine: r.decisions });
  assert.ok(r.points[r.points.length - 1].laps >= 40);
  for (let i = 1; i < r.points.length; i++) { assert.ok(r.points[i].laps > r.points[i - 1].laps); assert.ok(r.points[i].best_s <= r.points[i - 1].best_s); }
});

test("curves.json: three methods per seed, monotone, budget-capped, labelled, no forbidden words", () => {
  const raw = fs.readFileSync(path.join(DIR, "curves.json"), "utf8");
  assert.doesNotMatch(raw, /\bCFD\b|wind tunnel|validated/i);
  const o = JSON.parse(raw);
  assert.equal(o.label, "physics lap sim, Silverstone, model prediction");
  assert.equal(o.pole.s, 88.111);
  assert.deepEqual(o.columns, ["laps", "legal_laps", "screened", "best_s"]);
  for (const seed of ["7", "11", "12"]) {
    const s = o.seeds[seed];
    for (const m of ["steered", "engine_noai", "cmaes"]) {
      const c = s.curves[m]; assert.ok(Array.isArray(c) && c.length > 10, seed + " " + m);
      assert.equal(c[0][0], 0); assert.equal(c[0][3], s.baseline_s);
      for (let i = 1; i < c.length; i++) { assert.ok(c[i][0] >= c[i - 1][0]); assert.ok(c[i][3] <= c[i - 1][3]); assert.ok(c[i][1] <= c[i][0]); }
      if (m !== "steered") assert.ok(c[c.length - 1][0] <= o.budget);
    }
    assert.equal(s.replay_check.reproduced, true, "seed " + seed + ": the baselines ran on the physics the steered run used");
  }
});

test("benchmark code has no route to Mubit", () => {
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(DIR, f), "utf8");
    assert.doesNotMatch(src, /require\([^)]*server|mubit\.js|api\.mubit|fetch\(|https?:\/\//i, f);
  }
});
