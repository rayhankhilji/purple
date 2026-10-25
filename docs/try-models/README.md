# Try models — how to score v1 and v2 by hand (P3.T1)

> Status: the first night's hand-scoring sheet for the research lab task, kept for history. The current product is in [README.md](../../README.md).

One page for Tanuj. The exam's 8 hardest scenarios are in `sheet.md` (regenerate: `npm run exam:sheet`). You paste each scenario into the Mubit console's **Try models**, write down what the adapter answers, and run the scorer. Nothing here trains the task: Try models calls are marked *not stored · trains nothing* and never appear in **Requests**.

## What is verified against docs.mubit.ai (read 2026-10-24, `/guides/first-adapter` §4 and "What each test result means", `/guides/model-ids`)

1. **Open the task.** Console → **Tasks** → *Research engineer of F1*. The task's status line reads `Collecting examples` → `Reviewing examples` → `Training` → `Testing`, or `Can't train` (then the page shows *No adapter yet:* with a reason; no button retries, only new calls do).
2. **Find a passing version.** Select the adapter, open **History**. Each version shows one test result: `Passed`, `Below target`, `Malformed tool calls`, `Prompt only`, `Not tested`. Only a **`Passed`** version can be tried. A `Prompt only` version cannot be tried in Try models (the docs say so explicitly). On **Overview** the line reads "v1 passed its tests" when it is ready.
3. **Open Try models.** On the passing version select **Compare with your provider**. Try models opens with **Side by side** on: provider model on the left, the adapter version on the right.
4. **Paste only the user message.** Copy the JSON block under the scenario in `sheet.md` (the whole `{"objective":"min lap",…}` line) into the message box. **Do not paste the system prompt**: the docs say "Try models adds the task's instructions", i.e. the frozen `lab/prompt.js` text is applied by the task itself. Pasting it again would make the message a different task.
5. **Send to both.** Both replies appear; they should be JSON (Haiku usually wraps it in a ```json fence; that is fine). Read `verdict`, `next_parameter`, `direction`.
6. **Write the answers into `sheet.md`.** In the scenario's table fill the `provider`, `v1` (and later `v2`) rows: verdict, next_parameter, direction. The score card at the top also accepts free text per cell ("reject, rear_wing_deg decrease"). Blank, `-` or `—` = no answer.
7. **Score.** `node server/scenarios.js --score docs/try-models/sheet.md` prints `verdict n/8` and `next-step n/8` per model and the `POST /api/status` body (plus a ready `curl`). Truth comes from `data/exam.json`, not from the sheet. The route replaces the whole `exam` object, so the printed body already carries the current `data/status.json` values (provider score from `npm run exam` included); if the server runs with another `PURPLE_DATA_DIR`, pass `--status <dir>/status.json`.
8. **Repeat for v2** once its version shows `Passed`: same sheet, fill the `v2` rows, score again.

Timing notes from the docs: the first start of Try models "can take a few minutes" (the page resends your message every 15 s for up to 20 minutes). The organization has a **daily Try models call limit that resets at 00:00 UTC**: 8 scenarios × 2 models × (v1, v2) = 32 sends; do not burn them on retries. Try models runs the provider side on Mubit's key. If an adapter is "unavailable in Try models" the docs list the reasons: Try models is off for the workspace, the version is not `Passed`/is `Prompt only`, it cannot run adapters yet, or the daily limit is spent.

## What could NOT be verified (say so, don't guess)

- The exact button labels beyond those quoted above (`Compare with your provider`, `Side by side`, `Send to both`, `History`, `Overview`) and whether a version picker exists inside Try models when several versions have passed. If v1 and v2 have both passed, open Try models **from the version's own row in History** so the right one is on the right-hand side; take a screenshot that shows the version label for the deck.
- Whether Try models applies the task's `temperature`/`max_tokens` (they are not part of the task key per `/guides/tasks-and-sessions`). Our live calls use temperature 0; a Try models answer may therefore differ slightly in wording. Only `verdict / next_parameter / direction` are scored.
- There is **no model id for an adapter** ("you can't send a call to an adapter by naming it as the model", `/guides/model-ids`), so the exam cannot be run against v1/v2 from `npm run exam`; the sheet is the only way to score adapters, which is why this page exists.

## Scoring rules (same as `runExam`)

- Verdict hit: the adapter's `verdict` equals the truth (`promote` if the evaluator's Δ < −0.03 s, `reject` if > +0.03, else `retest`).
- Next-step hit: `next_parameter` **and** `direction` both equal the truth (the single ±1-step move from the candidate with the best evaluator lap).
- The 8 items are the demo premise (`exam-rw8`) plus the seven whose Δ is closest to the ±0.03 thresholds (five are retests). They are deliberately hard; 4/8 on verdicts is not a bad adapter, it is the exam. Compare models against each other and against the provider's 20/20 on the full exam.
- Context for v1: it was trained on the Friday collection, 94 % front-wing candidates and no promote (consecutive xorshift seeds; fixed for v2). Expect `front_wing_deg` answers. v2 saw promote_bias 0.3 and rule R-01.

Screenshots for the deck (P3.T1): one per model with the Side by side view showing the JSON answer, plus the console's History row with the version's `Passed` result.

## What to expect, item by item (the provider's actual answers)

The provider (claude-haiku-4-5, untrained, temperature 0) scored **20/20 verdicts and 10/20 next-steps** on the full exam (`npm run exam` re-run after the evaluator's wind-cap fix, 2026-10-24T02:37:26.427Z; identical to the first run; per-item answers in `status.exam.details`, copy in `docs/ledger-snapshot/2026-10-24_02-37-26Z-0530-windcap-exam/status.json`).

**Provider tally on the 8 sheet items: verdicts 8/8, next steps 2/8** (hits on `exam-rw8` and `exam-12`; the 6 misses all have a ride-height truth and the provider answered `rear_wing_deg decrease` on 5 of them, `brake_bias_pct increase` on the other). That is the baseline an adapter has to beat: 8/8 on verdicts is the bar, 3/8 on next steps already beats the provider.

**Held-out note:** exam-rw8 is the demo experiment; its call is in v2's recorded data, so it is not held out for v2. Sheet score also shown without it: n/7. Provider without exam-rw8: verdicts 7/7, next step 1/7 (exam-12 only). Report v1 and v2 both ways (n/8 and n/7: drop the exam-rw8 row from the scorer's tally by hand).

| # | id | Δ lap (s) | truth verdict | truth next step | provider verdict | provider next step | next step |
|---|---|---|---|---|---|---|---|
| 1 | `exam-rw8` | +0.436 | **reject** | rear_wing_deg decrease | reject ✓ | rear_wing_deg decrease | ✓ hit |
| 2 | `exam-14` | +0.011 | **retest** | ride_height_mm decrease | retest ✓ | rear_wing_deg decrease | ✗ miss |
| 3 | `exam-15` | +0.009 | **retest** | ride_height_mm decrease | retest ✓ | brake_bias_pct increase | ✗ miss |
| 4 | `exam-02` | -0.008 | **retest** | ride_height_mm decrease | retest ✓ | rear_wing_deg decrease | ✗ miss |
| 5 | `exam-16` | -0.001 | **retest** | ride_height_mm decrease | retest ✓ | rear_wing_deg decrease | ✗ miss |
| 6 | `exam-20` | -0.001 | **retest** | ride_height_mm decrease | retest ✓ | rear_wing_deg decrease | ✗ miss |
| 7 | `exam-05` | +0.071 | **reject** | ride_height_mm increase | reject ✓ | rear_wing_deg decrease | ✗ miss |
| 8 | `exam-12` | -0.078 | **promote** | ride_height_mm decrease | promote ✓ | ride_height_mm decrease | ✓ hit |

How to read a Side-by-side live:

- **Verdict**: the provider column equals the truth on all eight, so an adapter verdict that differs from the provider's is a miss. 5 items are `retest` with Δ inside ±0.03 s; an adapter trained only on rejects (v1 saw 40 reject / 3 retest / 0 promote) will tend to say `reject` on those, and `reject` on the promote item `exam-12` too, landing near 2/8. That is the expected v1 picture. v2 saw 14 promote / 12 retest / 14 reject, so its retest verdicts and `exam-12` are the things to watch.
- **Next step**: 7 of eight truths are a `ride_height_mm` move; the provider's reflex is `rear_wing_deg decrease` and it only finds ride height when the candidate already moved it (`exam-12`). An adapter that answers `ride_height_mm` on any of items 2–7 has learned something the provider has not. `front_wing_deg` answers are v1's habit from its front-wing-only data.
- Off the sheet the provider's next step was also wrong on `exam-03`, `exam-09`, `exam-10`, `exam-11` (its 10/20 overall).

Sheet composition note: after the evaluator's wind-cap fix (2026-10-24) the tailwind case `exam-03` moved from Δ +0.037 to +0.133 and left the hardest eight; `exam-12` (a promote at Δ −0.078) took its place. Regenerate this table after a provider re-run from `status.exam.details` (`GET /api/status`); the sheet's truth column never changes unless `data/exam.json` is rebuilt.
