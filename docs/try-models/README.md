# Try models — how to score v1 and v2 by hand (P3.T1)

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
