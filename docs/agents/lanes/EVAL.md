# Lane EVAL

Status: done through P3.T1 + audit item (newest-3 rules; PR open); idle until v2 trains. Owner: agent C (session `session_01Ma6U13odw1SA1vFhepRj8u`). Branch: `claude/eval-p3-rules`.

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

### 2026-10-24 04:35 London — agent C (EVAL) — guardrail audit item: newest 3 active rules in the scenario (lab/schema.js)
- Status: done; `npm test` 80/80. Branch `claude/eval-p3-rules` (from the integration branch at 2578d34). No Mubit calls; `lab/prompt.js` untouched (rules are user-message content, not the task key).
- Files changed: `lab/schema.js` (`selectRules`, `LIMITS.rules = 3`, `LIMITS.rule_chars = 160`), `test/schema.test.js` (+2), this file.
- What changed: `buildScenario` used `rules.slice(0, 5)` = the five OLDEST rules, so a sixth correction never reached the agent, and five 160-char rules pushed the input to ≈ 384 tokens (> 350). Now `schema.selectRules(rules)`: drop `active: false`, sort by `created_at` (array order when absent, so plain strings still work), keep the NEWEST `LIMITS.rules` (3), oldest first so the agent reads them in the order they were given; rule text is cut to 160 chars as a last guard (the overrule route already trims). `app.js` passes `db.readRules().filter(r => r.active)` and needs no change.
- Verify: `npm test` 80/80; worst case (3 maximal 160-char rules + 3 history items + wet + wind + two-parameter candidate) serialises to **1,216 chars ≈ 304 tokens** (< 1,400 / 350); a test pins it. Selection test: six rules with the third inactive → `rule 4, rule 5, rule 6` regardless of array order.
- Decision proposed (for TASK_LOG): the agent sees the newest 3 active rules, oldest first; a fourth active rule silently drops the oldest from the input (it stays in `rules.json` and the UI). If the team wants more than 3, the budget is ~55 tokens per rule; 4 rules fit (≈ 345 tokens worst case) but with no margin. Reversible (`LIMITS.rules`).
- Blockers / questions for Tanuj: none. Next: idle until v2 trains; `npm run exam:score` then.
Status: wind-cap fix + exam rebuild (PR open, priority), newest-3 rules (PR #32 open); idle until v2 trains. Owner: agent C (session `session_01Ma6U13odw1SA1vFhepRj8u`). Branch: `claude/eval-p3-windcap`.

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

### 2026-10-24 04:45 London — agent C (EVAL) — evaluator wind-cap bug (confirmed by the correctness review), exam rebuilt
- Status: done; `npm test` 80/80. Branch `claude/eval-p3-windcap` (from the integration branch at 2578d34; independent of the open rules PR #32). No Mubit calls. **No aero constant changed, label stays "aero map v1"** (integrator decision: evaluator timing bug, not a model change); fixtures untouched and byte-identical.
- Bug: `evaluateOne` passed the still-air terminal speed as `vcap` into `timing()`, which clamps every sample at it, while the profile (js/ai.js) already caps each sample at its own terminal speed against the local headwind. Tailwind samples were clipped back to 331.2 km/h, so every windy lap leaned slow. Reproduced (Silverstone baseline, 10 m/s on the Hangar Straight): head 80.830, tail 81.354, cross 81.025; still air 80.800.
- Fix: `timing(track, prof, Infinity, circuit)`; `terminal_kmh` still reports the still-air terminal for display. After: head **80.805**, tail **81.103**, cross **80.943**, still air **80.800** (unchanged; a new test asserts lap/sectors/vmax/vmin/multipliers byte-identical to both fixtures). Tailwind straight vmax now 349.1 km/h (> still-air terminal, as it should be with 10 m/s behind). New test: tailwind raises the Hangar sector's vmax above still air.
- Exam rebuilt (`npm run exam:build`, seed 2026): **all 20 truths unchanged**; ids unchanged; the three wind items' scenario numbers changed: `exam-02` Δ −0.015 → −0.008, `exam-03` Δ +0.037 → +0.133, `exam-04` Δ +0.105 → +0.098 (verdicts retest / reject / reject as before). Still 4 promote / 5 retest / 11 reject. The provider's stored answers for 02/03/04 were given to the old scenario text: a provider re-run is the integrator's call (truths did not move, so the 20/20 · 10/20 score is very likely to stand).
- Sheet regenerated (`npm run exam:sheet`): hardest eight are now `exam-rw8, 14, 15, 02, 16, 20, 05, 12` (`exam-03` at +0.133 is no longer near a threshold; `exam-12`, a promote at Δ −0.078, replaces it). README "What to expect" table rebuilt from `status.exam.details`; wind items marked † (pre-fix scenario text).
- **Collected data, logged not hidden**: the v1 collection had ~11 windy scenarios of 50 and v2 had 5 of 40; their `result.delta_lap` and `vmax_kmh` carried the slightly-slow wind numbers (laps up to ~0.25 s slow in a strong tailwind, deltas off by a few hundredths at most since both baseline and candidate were clipped alike). They stay as collected in the ledger and in the Mubit task; the verdict labels are unaffected in all but borderline cases.
- Decision proposed (for TASK_LOG): D-E? "wind cap fix is an evaluator bug fix, no aero-map version bump; exam.json rebuilt with unchanged truths; sheet hardest-8 changed (exam-03 out, exam-12 in)".
- Blockers / questions for Tanuj: none. Next: PR #32 (newest-3 rules) is already open and independent; idle until v2 trains.

### 2026-10-24 03:55 London — agent C (EVAL) — Try-models README: real provider answers in "What to expect"
- Status: done; `npm test` 74/74. Branch `claude/eval-p3-expect2` (from the integration branch after PR #19 and SERVER's exam-details persistence merged). Docs only; no Mubit calls.
- What: the "What to expect" table now shows the provider's actual answers from `status.exam.details` (snapshot `docs/ledger-snapshot/2026-10-24_02-14-07Z-0350-exam-details/status.json`, exam re-run 20/20 · 10/20): verdict right on all 8 sheet items, next step right only on `exam-rw8`; `rear_wing_deg decrease` on 02, 05, 14, 16, 20, `front_wing_deg increase` on 03, `brake_bias_pct increase` on 15 (truth: `ride_height_mm` on all seven). Reading notes for a live Side-by-side kept; the earlier "not persisted" wording removed.
- Blockers / questions for Tanuj: none. Next: idle until v2 trains; then `npm run exam:score`.

### 2026-10-24 02:30 London — agent C (EVAL) — Try-models README "What to expect" (optional item from the integrator)
- Status: done; `npm test` 74/74. Branch `claude/eval-p3-expect` (from the integration branch after PR #15 merged). No Mubit calls; nothing but `docs/try-models/README.md` and this file changed.
- What: a per-item table for the 8 sheet scenarios: Δ lap, truth verdict and next step, and what a wrong adapter answer looks like, plus the reading of the eight together (five retest items; a reject-only adapter scores ~3/8 by construction). Derived only: the provider's per-item answers are **not persisted** anywhere (`calls.jsonl` exam rows hold ids/tokens/status, `status.json` holds the 20/20 · 10/20 totals; the ledger has no exam rows), so they are not quoted; because the provider was 20/20 on verdicts, its verdict on every sheet item equals the truth column, which the README says.
- Proposed for SERVER: persist `runExam()`'s `details` array as `status.exam.details` (one line in `runExam`) so the next provider run records the actual answers and the README can quote them.
- Blockers / questions for Tanuj: none. Next: idle until v2 trains; then score the sheet with `npm run exam:score`.

### 2026-10-24 02:20 London — agent C (EVAL) — P3.T1 Try-models scorer + README
- Status: done; `npm test` 72/72. Branch `claude/eval-p3-score` (from the integration branch after PR #9 merged). No Mubit calls; `lab/prompt.js`, aero constants, `data/exam.json`, `sheet.md` untouched.
- Files changed: `server/scenarios.js` (parseSheet, scoreSheet, CLI `--score`), `test/fixtures/try-sheet.filled.md` (new), `test/evaluator.test.js` (+1), `docs/try-models/README.md` (new), this file.
- Verify step run + output:
  - `node server/scenarios.js --score test/fixtures/try-sheet.filled.md` → `provider verdict 8/8 next-step 7/8 · v1 4/8 0/8 · v2 7/8 5/8`, then the `POST /api/status` body `{"exam":{"v1":4,"v1_param":0,"v1_total":8,"v2":7,"v2_param":5,"v2_total":8,"provider_sheet":8,"provider_sheet_param":7}}` and a ready `curl`. On the blank `docs/try-models/sheet.md` it prints 0 answered and an empty patch.
  - `npm test` → `# tests 72 / # pass 72 / # fail 0`.
- How the scorer reads the sheet (format kept stable): per scenario section "### n. `exam-id`" the rows `| provider | verdict | next_parameter | direction | …`; fallback = the score card's provider / v1 / v2 cells with free text ("Reject — front_wing_deg increase"). Cells accept the three verdict words and "param direction" in any order/case; blank, `-`, `—` = unanswered. Truth is taken from `data/exam.json`, never from the sheet (a test edits the sheet's truth column and the score does not move). Unknown ids are reported, not scored.
- Status route caveat (SERVER lane, FYI): `POST /api/status` does `Object.assign(status, patch)`, so `{ exam: {...} }` **replaces** the whole exam object; the scorer therefore merges over the current `data/status.json` (`--status <file>` for another `PURPLE_DATA_DIR`) before printing. A deep merge of `exam` in the route would make this unnecessary (2 lines; SERVER's call). Field names: `exam.v1`, `exam.v2`, `exam.v1_param`, `exam.v2_param`, plus `*_total` (8) and `provider_sheet(_param)` for the provider's answers on the same 8.
- README (`docs/try-models/README.md`), verified on docs.mubit.ai 2026-10-24 (`/guides/first-adapter` §4, "What each test result means", `/guides/model-ids`): Tasks → adapter → **History** → a version with test result **Passed** → **Compare with your provider** → Try models opens **Side by side** → paste **only the user message** (the docs: "Try models adds the task's instructions", so the frozen system prompt is NOT pasted) → **Send to both** → read the JSON. Calls are "not stored · trains nothing", a `Prompt only` version cannot be tried, first start can take minutes (auto-resend 15 s / 20 min), **daily Try models call limit resets 00:00 UTC** (our plan: 8 × 2 × 2 = 32 sends). Not verifiable from the docs and said so in the README: a version picker inside Try models when two versions have passed (advice: open from the version's History row, screenshot the label), whether temperature/max_tokens apply, and there is **no adapter model id** (`/guides/model-ids`: "you can't send a call to an adapter by naming it as the model"), so `npm run exam` can never score v1/v2; the sheet is the only way.
- Decisions proposed (for TASK_LOG): scorer field names above; the sheet scores adapters on 8 items while the provider is scored on 20 by `npm run exam` (the README says to compare like with like: `provider_sheet` is the provider on the same 8).
- Blockers / questions for Tanuj: none. When v1 shows `Passed`, follow `docs/try-models/README.md`; it takes ~15 minutes for one model.
- Next three actions: (1) integrator merges PR; optional `"exam:score": "node server/scenarios.js --score docs/try-models/sheet.md"` in package.json. (2) EVAL idle until v2 trains; available to review UI/SERVER PRs against ARCHITECTURE. (3) After Tanuj fills the sheet: run the scorer, paste the body, screenshot for the deck.

### 2026-10-24 01:50 London — agent C (EVAL) — P3.T1 prep (Try-models sheet), v2 dry run, Monza check, PRNG alignment with app.js
- Status: done; `npm test` 61/61. Branch `claude/eval-p2-trysheet`, PR #9 (updated after the integrator's seededRng landed on the integration branch). No Mubit calls; `lab/prompt.js`, aero constants and `data/exam.json` untouched (exam.json byte-identical to the integration branch; the provider exam's 20/20 verdicts / 10/20 next-step stand).
- Files changed: `server/scenarios.js` (hardestItems, trySheet, dryRun, `seededRng`, CLIs `--try-sheet`, `--dry-run`), `docs/try-models/sheet.md` (new; path granted to EVAL), `test/evaluator.test.js` (+3), this file.
- Verify step run + output:
  - `node server/scenarios.js --try-sheet docs/try-models/sheet.md` → `exam-rw8, exam-03, exam-02, exam-14, exam-15, exam-16, exam-20, exam-05` (the demo premise + the 7 items whose `delta_lap` is closest to the ±0.03 thresholds: five retests at Δ −0.015 … +0.011, two rejects at +0.037 / +0.071). Per item: the exact user-message JSON (tested verbatim against `serializeScenario`), the truth, blank provider / v1 / v2 rows, a score card, and the context note that v1's data was 94 % front-wing candidates. Regenerate with the same command if `data/exam.json` is ever rebuilt.
  - `node server/scenarios.js --dry-run --n 40 --seed 2 --promote-bias 0.3` (collection seeds 2000–2039 through `seededRng`, exactly as `app.js collect()`; evaluator only) → **promote 14 / retest 12 / reject 14**, dry 27 / wind 5 / wet 8, Δ −0.118 … +0.431, longest input 519 chars — the same mix the integrator measured. Rows:
```

```
  - `npm test` → `# tests 61 / # pass 61 / # fail 0`.
- PRNG finding, aligned with the integrator's fix: `U.rng(seed)` (xorshift32) returns ≈ 0.124 as its FIRST output for neighbouring integer seeds, so the generator's first `pick(rng, KEYS)` always chose `front_wing_deg` (replaying seeds 1000–1049: 50/50 touched the front wing; ledger: 94 %), and a bias coin would land on every seed (an un-warmed dry run gave 40/40 promote). The integrator put a mixed + warmed `seededRng` in `server/app.js` (`runPlan`, `collect`). `server/scenarios.js` now carries the **same function** (`scenarios.seededRng(U, seed)`, murmur3 finaliser + 16 discarded draws) for `--dry-run` and tests; `perturb()` itself does not warm up, so its first `rng()` stays the bias draw that `app.js biasApplied()` replays for `candidate_source: "random-biased"`. (An earlier revision of this PR warmed inside `perturb`; removed because it would have desynchronised that replay.) Bias 0 with a raw `U.rng` still reproduces v1 byte-for-byte (tested).
- `buildExam` and the first draw: the exam uses one seed (2026), not consecutive seeds, so only its very first `pick()` (the candidate for the headwind case `exam-02`) was taken at u ≈ 0.12; every later draw is uniform. The items are sound (quotas met, each truth has margin ≥ 0.003, the demo and curated cases are fixed by construction), so **`data/exam.json` is kept unchanged** and the provider result stands. If it is ever rebuilt, use `--build-exam` as before; a test pins the file to the builder.
- Monza check (circuit switch, F-09): fixture `baseline.monza.json` lap 76.650, sectors 28.158 / 25.948 / 22.544, vmax 330.7, Lesmo vmin 174.2, straight vmax 328.1, grip 1.125, all reproduced. `REF_CORNER.monza` 2,150–2,700 m holds Lesmo 1 (2,185) and Lesmo 2 (2,550); the window's minimum is at s 2,580 (Lesmo 2 apex, 174 km/h) with the edges at 277 / 246 km/h, so it is a true corner minimum. `REF_STRAIGHT.monza` 5,300–5,790 m is the Rettifilo Tribune before the line at a constant bearing 3–6°; the lap's absolute peak (330.7) is on the same straight just after the line (s 528, braking for the Variante at 600), outside the window by design (the window ends before the braking point; same at Silverstone: peak s 5,053, window to 5,000). Rear wing +5 at Monza: straight 328.1 → 322.8, Lesmo vmin 174.2 → 177.5, Δ +0.458. No constant changed; a test guards it.
- Decisions proposed (for TASK_LOG):
  1. Hardness ranking for Try models = distance of `delta_lap` from the nearest ±0.03 threshold, tie-break by next-move margin, `exam-rw8` always first. Reversible.
  2. `scenarios.seededRng` is the canonical copy of the mixed rng; suggest `server/app.js` import it (`scenarios.seededRng(U, seed)`) so there is one implementation (SERVER lane, 2-line change, behaviour identical). `data/exam.json` kept as is.
- Proposed `package.json` lines (integrator): `"exam:sheet": "node server/scenarios.js --try-sheet docs/try-models/sheet.md"`, `"collect:dry": "node server/scenarios.js --dry-run --n 40 --seed 2 --promote-bias 0.3"`.
- Blockers / questions for Tanuj: none. FYI for the deck's honesty slide: v1 = 43 kept examples, 94 % front-wing experiments, no promote seen; v2 = mixed moves (ride height, wing, bias), ~14 promotes in 40, plus pit-wall rule R-01.
- Next three actions:
  1. Integrator merges PR #9; Tanuj uses `docs/try-models/sheet.md` once v2 is trained (P3.T1); enter `exam.v1` / `exam.v2`.
  2. EVAL (on request): `violation_labels` on the Evaluation via `aero.describeViolation`; `--baseline` flag for `--dry-run` if a promote changes the baseline before v2 runs.
  3. EVAL: review UI/SERVER PRs against ARCHITECTURE §4/§8 while idle.

### 2026-10-24 00:40 London — agent C (EVAL) — P2.T5 exam.json + generator promote bias, P2.T6 TD-01/conditions semantics
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
