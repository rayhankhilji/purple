# Lane EVAL

Status: done P2.T5, P2.T6, P3.T1 prep (PR open into `claude/amazing-planck-804i13`); next: idle until v2 is trained (Try models sheet ready in `docs/try-models/sheet.md`). Owner: agent C (session `session_01Ma6U13odw1SA1vFhepRj8u`). Branch: `claude/eval-p2-exam`.

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

##### 2026-10-24 01:30 London — agent C (EVAL) — P3.T1 prep (Try-models sheet), v2 dry run, Monza check; rng warm-up finding
- Status: done; `npm test` 61/61. Branch `claude/eval-p2-trysheet` (from the integration branch after PR #4 merged). No Mubit calls; `lab/prompt.js` and aero constants untouched (label still "aero map v1"; `data/exam.json` unchanged, still in sync).
- Files changed: `server/scenarios.js` (hardestItems, trySheet, dryRun, RNG_WARM warm-up, CLIs `--try-sheet`, `--dry-run`), `docs/try-models/sheet.md` (new; path granted to EVAL by the integrator), `test/evaluator.test.js` (+3), this file.
- Verify step run + output:
  - `node server/scenarios.js --try-sheet docs/try-models/sheet.md` → `exam-rw8, exam-03, exam-02, exam-14, exam-15, exam-16, exam-20, exam-05` (8 items: the demo premise + the 7 whose `delta_lap` is closest to the ±0.03 thresholds; five are retests at Δ −0.015 … +0.011, two rejects at +0.037 / +0.071). Per item the sheet carries the exact user-message JSON (`serializeScenario`, tested verbatim), the truth, and blank provider / v1 / v2 rows. Regenerate with the same command if `data/exam.json` is rebuilt.
  - `node server/scenarios.js --dry-run --n 40 --seed 2 --promote-bias 0.3` (collection seeds 2000–2039, evaluator only, no Mubit) → **promote 13 / retest 10 / reject 17**; dry 30, wind 9, wet 1; Δ −0.122 … +0.343; longest input 522 chars. Parameters touched: ride height 27, rear wing 7, front wing 6, brake bias/ERS the rest. Rows:
```

```
  - `npm test` → `# tests 61 / # pass 61 / # fail 0`.
- **Finding (affects how v1 should be read, and v2): the collection's seeds are degenerate without a warm-up.** `U.rng(seed)` is xorshift32; for every seed in the collection's range (seed0·1000+i ≈ 1,000–50,000) its FIRST output is ≈ 0.12, so the generator's first `pick(rng, KEYS)` always lands on index 0 = `front_wing_deg`. Replaying v1's seeds 1000–1049: **50 of 50 candidates moved the front wing** (20 of them a second parameter too), which is why v1 saw Δ −0.028 … +0.323 and 0 promotes, and why the model answered `front_wing` 39/43 times: it learned on front-wing experiments. One burn-in draw already makes the next output uniform across consecutive seeds (measured: deciles 39/39/39/36/39/39/44/39/40/46 over 400 seeds). Fix shipped: `perturb` burns `RNG_WARM = 8` draws when `promote_bias > 0` (or `opts.warm`); at bias 0 nothing changes, so v1 seeds, the exam and all earlier tests reproduce byte-for-byte. Without the warm-up the bias coin landed on every seed (first dry run: 40/40 promote), so **the v2 collection must run with promote_bias > 0 (0.3 as decided) or `warm: true`**; the dry run above is what v2 will send.
- Monza check (circuit switch, F-09): fixture `baseline.monza.json` lap 76.650, sectors 28.158 / 25.948 / 22.544, vmax 330.7, Lesmo vmin 174.2, straight vmax 328.1, grip 1.125, all reproduced. `REF_CORNER.monza` 2,150–2,700 m holds Lesmo 1 (2,185) and Lesmo 2 (2,550); the window's minimum is at s 2,580 (Lesmo 2 apex, 174 km/h) with the edges at 277 / 246 km/h, so it is a true corner minimum, not a clipped edge. `REF_STRAIGHT.monza` 5,300–5,790 m is the Rettifilo Tribune before the line at a constant bearing 3–6°; the lap's absolute peak (330.7 km/h) is at s 528 on the same straight after the line (braking for the Variante at 600), outside the window by design (the window ends before the braking point; same at Silverstone: peak at s 5,053, window to 5,000). Rear wing +5 at Monza: straight vmax 328.1 → 322.8, Lesmo vmin 174.2 → 177.5, Δ +0.458. No constant changed; a test now guards all of this.
- Decisions proposed (for TASK_LOG):
  1. Hardness ranking for Try models = distance of `delta_lap` from the nearest ±0.03 threshold, tie-break by next-move margin, `exam-rw8` always first. Reversible (`--k`, rebuild).
  2. `RNG_WARM = 8` burn-in draws in `perturb` when `promote_bias > 0` or `opts.warm`; bias 0 unchanged. Reversible. Record the v1 degeneracy (front wing on 50/50) as a known property of the v1 example set.
- Proposed lines for other lanes: `package.json` `"exam:sheet": "node server/scenarios.js --try-sheet docs/try-models/sheet.md"` and `"collect:dry": "node server/scenarios.js --dry-run --n 40 --seed 2 --promote-bias 0.3"` (integrator); SERVER's `--promote-bias` wiring needs nothing else (`generate()` warms itself when the bias is on).
- Blockers / questions for Tanuj: none. FYI only: the v1 adapter was trained on front-wing-only experiments (above); the deck's honesty slide can say v1 = 43 front-wing experiments, v2 = mixed moves with promotes and the pit-wall rule.
- Next three actions:
  1. Integrator merges this PR; run `npm run exam` result → widget; Tanuj uses `docs/try-models/sheet.md` once v2 is trained (P3.T1).
  2. EVAL: if the UI wants it, `evaluator.evaluate` can return `violation_labels` via `aero.describeViolation` (one line); `MIX.retest_bias` if the team wants more retest examples (the dry run already shows 10/40 at bias 0.3, so probably not needed).
  3. EVAL: after v2 training, re-run `--dry-run` with the new baseline if a promote changed it (`--baseline` flag is a 3-line addition if asked).

# 2026-10-24 00:40 London — agent C (EVAL) — P2.T5 exam.json + generator promote bias, P2.T6 TD-01/conditions semantics
- Status: done (both tasks), `npm test` 47/47 green. No Mubit calls were made; `lab/prompt.js` untouched; no aero constant changed (label stays "aero map v1", fixtures untouched).
- Files changed: `server/scenarios.js` (buildExam, truthFor, movesByVerdict, menuMoves, MIX.promote_bias, CLI), `data/exam.json` (new, committed, seed 2026), `lab/aero.js` (describeViolation), `lab/evaluator.js` (TD-01 grandfathered-baseline rule), `test/aero.test.js` (+1), `test/evaluator.test.js` (+10), this file.
- Verify step run + output:
  - `npm test` → `# tests 47 / # pass 47 / # fail 0` (was 36).
  - `node server/scenarios.js --build-exam data/exam.json --seed 2026` → `exam: 20 items … promote 4 / retest 5 / reject 11; wind 3, wet 2, monza 2; longest 521 chars`. `exam-rw8` truth = reject / rear_wing_deg / decrease (Δ +0.436 s, margin 0.036). Two Monza cases: rw −4° → promote (Δ −0.230), rw +8° → reject (Δ +0.757).
  - `node server/scenarios.js --faster-moves` → Silverstone: 948 legal menu moves (1 or 2 parameters from `STEPS`), 97 promote (10.2 %), 121 retest, 730 reject.
  - Seed compatibility: `generate()` with `promote_bias` 0 reproduces the v1 generator byte-for-byte on 300 seeds (1000–1299, compared against `git show be04109:server/scenarios.js`); replaying the live collection's seeds 1000–1049 gives 0 promote, 3 retest, range −0.028 … +0.323 s, exactly what TASK_LOG recorded.
- How the exam is built (ARCHITECTURE §4.10, `server/scenarios.js buildExam(rng, evaluator, opts)`):
  - `scenario` is `schema.buildScenario(...)` with `rules: []`, `history: []`, so `serializeScenario(item.scenario)` in `runExam` is byte-identical to a live plan input (a test checks this per item). Items carry an extra `meta` (tag, change, delta_lap, best_step_delta, margin, chars) for humans picking the 8 hardest for Try models (P3.T1); `truth` has exactly the three keys.
  - Truth: verdict from `delta_lap` (< −0.03 promote, > 0.03 reject, else retest); `next_parameter/direction` = the single ±1 `RANGES[k].step` move from the **candidate** with the lowest evaluator lap under the same conditions. Ties resolve KEYS-order, increase-first (deterministic). Fillers require a best-vs-second-best margin ≥ 0.003 s so no exam item is a coin flip; `ers_deploy` never wins (the evaluator ignores it by design).
  - Fixed cases: `exam-rw8` (dry); 3 wind cases on the Hangar Straight: 10 m/s head (from the straight's bearing), 8 m/s tail, 6 m/s cross; 2 wet; 2 Monza (rw −4°, rw +8°). Then 12 dry Silverstone fillers drawn with the rng from the verdict class furthest under quota (≥ 4 promote / 4 retest / 8 reject).
  - Regenerate when (and only when) the aero map or calibration changes: `node server/scenarios.js --build-exam data/exam.json --seed 2026`; a test fails if `data/exam.json` drifts from the builder.
- **Generator bias (decision needed): table of moves faster than the baseline at Silverstone, dry, evaluator aero map v1**

  | Move (from `STEPS`) | Δ lap (s) |
  |---|---|
  | rear_wing −3 + ride_height −5 | −0.162 |
  | rear_wing −2 + ride_height −5 | −0.156 |
  | rear_wing −4 + ride_height −5 | −0.154 |
  | rear_wing −5 + ride_height −5 | −0.147 |
  | rear_wing −2/−3 + ride_height −4 | −0.130 / −0.129 |
  | **ride_height −5** (single) | **−0.121** |
  | ride_height −4 (single) | −0.100 |
  | ride_height −3 (single) | −0.078 |
  | front_wing −2 + ride_height −5 | −0.078 |
  | front_wing +2 + ride_height −5 | −0.075 |
  | ride_height −2 (single) | −0.052 |
  | ride_height −6 (single) | −0.048 |
  | front_wing +3 + ride_height −4 (slowest promote) | −0.031 |

  Single-parameter sweep (whole range): ride height is the only parameter with a promote band (29–33 mm: −0.048 … −0.121 s; 30 mm is the optimum, 28 mm is already +0.028 because bottoming starts below 30). Rear wing 17–19° is −0.001 … −0.012 (retest band); every front-wing single is slower (24° = +0.027); brake bias ±5 % costs ≤ 0.015 s; ERS is invisible to the evaluator. So HANDOVER §5's "small front-wing moves" only promote when paired with a ride-height cut. All 97 promote moves lower the ride height: families rh+ers 30, rh+bb 30, rw+rh 24, fw+rh 8, rh alone 5 (a test asserts "every faster menu move lowers the ride height"). Monza, for reference: 295 of 948 menu moves promote (any rear-wing cut; fastest rw −8 + rh −5 = −0.537 s).

  Measured promote share of the generator by `promote_bias` (2,000 draws, seed 99, dry Silverstone): 0 → 9.2 % (~4 of 40; the live v1 run got 0 of 50 by bad luck, P ≈ 1 %), 0.25 → 33 % (~13/40), **0.3 → 37 % (~15/40)**, 0.4 → 46 % (~18/40), 0.5 → 55 % (~22/40).

  **Recommendation for v2 (`npm run collect -- --n 40 --with-rules`, Saturday budget): `promote_bias: 0.3`.** ~15 correct promotes, ~3 retests, ~22 rejects in 40 calls: the model finally sees "promote" as a real class, rejects stay the majority (as in the real landscape, 77 % of menu moves), and the overrule rule "judge on full-lap delta" still has plenty of high-wing rejects to bite on. Default stays 0 so nothing about v1 seeds, tests or the exam moves. Retest stays rare either way (the ±0.03 band is 13 % of moves); if you want it taught too, say so and I add `MIX.retest_bias` the same way (20 lines).
- Decisions proposed (for the integrator to log in TASK_LOG):
  1. `MIX.promote_bias` (default 0) in `server/scenarios.js`; v2 collection runs with 0.3. Reversible.
  2. Exam truth tie-break and the ≥ 0.003 s margin filter for filler items (above). Reversible (rebuild with another seed).
  3. TD-01 semantics: the directive constrains **candidates**; a grandfathered baseline above the cap is still evaluated (without the directive) so `delta_lap` exists; a baseline outside the regulation throws `evaluator: baseline is illegal` instead of producing NaN deltas. Reversible.
  4. `aero.describeViolation(id)` is the UI's label source (REG-RW-MAX → "Rear wing above 35° (regulation)", TD-01 → "Technical directive TD-01: rear wing capped at 20°"); the numbers come from `RANGES` so label and check cannot disagree.
- Proposed contract / script changes (SERVER lane and integrator; I did not touch `package.json`, `server/app.js`, `server/scripts/*`):
  - `package.json`: `"exam:build": "node server/scenarios.js --build-exam data/exam.json --seed 2026"`.
  - `server/scripts/collect.js`: flag `--promote-bias 0.3` → `collect(n, { …, promote_bias })`; `server/app.js collect()`: pass `promote_bias: o.promote_bias` into `scenarios.generate(rng, { circuit, baseline, td01, promote_bias })` (the generator finds the evaluator on the global `EI` the headless loader sets; `opts.evaluator` also works). Log the bias in the `collect:` stdout line and on the ledger row's `candidate_source` ("random" vs "random-biased") if the integrator wants it visible.
  - `server/app.js runExam()` needs nothing: it already reads `item.id / scenario / truth`. `npm run exam` is the SERVER lane's live step (untrained header); not run by me.
  - UI (`lab/lab.js`): `EI.aero.describeViolation(id)` for the DESIGN-card violation badge (browser: `lab/aero.js` is already loaded by the lab page).
- Blockers / questions for Tanuj: none blocking. One call to make: approve `promote_bias 0.3` for v2 (or pick another row from the table) before the Saturday collection.
- Next three actions:
  1. Integrator merges this PR; SERVER lane adds `exam:build` + `--promote-bias` (lines above); run `npm run exam` once on the provider (untrained) and read `provider: n/20` into the widget.
  2. EVAL: after v2 training, pick the 8 hardest exam items for Try models by `meta.margin` (smallest first: exam-13 0.003, exam-11/12 0.009, exam-15 0.013 …) and write the list into this file for P3.T1.
  3. EVAL: if the UI lane needs it, `evaluator.evaluate` could return `violation_labels` alongside `violations` (one-liner); and `MIX.retest_bias` if the team wants retests taught.

## Template for a session entry

### YYYY-MM-DD HH:MM London — <agent/session> — <task id>
- Status: in_progress | done | blocked: <what, who>
- Files changed:
- Verify step run + output:
- Decisions proposed (for the integrator to log in TASK_LOG):
- Blockers / questions for Tanuj:
- Next three actions:
