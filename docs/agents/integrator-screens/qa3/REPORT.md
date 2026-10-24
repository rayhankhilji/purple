# QA3: lab page after the UI/CAR3D helper fixes

- **HEAD tested: `bcd714a`** (branch `claude/qa3`). Read-only on code.
- Setup: mock planner only (`MUBIT_MOCK=1`, health `mock:true`), API on 8851 with a fresh isolated data dir per viewport under the session scratchpad (`exam.json` from `data/`, `status.json` from `docs/ledger-snapshot/2026-10-24_02-37-26Z-0530-windcap-exam/`), static on 8852, page `http://127.0.0.1:8852/lab/?api=http://127.0.0.1:8851`. Nothing touched `data/` or `data-mock/`. No real Mubit calls. Race results came from `fake-race.js --port 8851 --id <exp> --seed 7`. Headless Chromium (SwiftShader) via Playwright.
- Another session's `pkill -f "node server/index.js"` killed the QA API once, mid-run at 1920. That run was thrown away and repeated with wrapper entrypoints. It is not reported as a defect.
- Viewports: 1440×900 and 1280×800 with motion. **1920×1080 with `reducedMotion: reduce`**: with motion on, SwiftShader at 1920 could not keep up (screenshot and click timeouts), so motion at 1920 is untested.
- The mock gives every call a 1 ms latency and an `mreq_test00000N` id that restarts after a server restart. Request ids therefore repeat after the down/up step. This is a mock artefact, not a UI duplicate.

## PASS / FAIL

| # | Check | 1440 | 1280 | 1920 | Measurement | Screens |
|---|---|---|---|---|---|---|
| 1 | Empty state | PASS | PASS | PASS | 4 cards empty, each with one sentence and an action; ledger "No experiments yet — run one"; SSE live | `1440-01-empty` |
| 2 | Run: loading, then success | PASS | PASS | PASS | `/api/plan` delayed 2.5 s: DESIGN "asking the agent", EVALUATE "evaluating", 2 px bars, pending trace line with pulse; then success with 1 PLAN line | `1440-02a`, `1440-02b` |
| 3 | Race it, result, Back to 3D | PASS | PASS | PASS | iframe URL carries all 9 params; RACE card shows racing and the clock; after the result the iframe **stays** (hidden=false) until "Back to 3D view" (B2 fixed) | `1440-03a`, `1440-03b`, `1280-03b` |
| 4 | Overrule; rule appears in the next scenario | PASS | PASS | PASS | R-01 chip in DESIGN, LEARN and ledger; next run `scenario.rules = ["Weigh straight-line drag…"]`, `rules_applied ["R-01"]` | `1440-04a`, `1920rm-04a` |
| 5 | Promote | PASS | PASS | PASS | `/api/state` baseline equals the candidate exactly | `1440-05` |
| 6 | Conditions: wind 8 m/s from 90°, wet, monza | PASS | PASS | PASS | `/api/state` matches; header badge and `#condSrc` follow; EVALUATE shows "vmin at Lesmo 1-2"; RACE shows the "still air" flag and note | `1440-06b` |
| 7 | TD-01 illegal (S4) | PASS | PASS | PASS | DESIGN error + TD-01 badge; EVALUATE "illegal · TD-01 · no lap time"; RACE "Nothing to race"; corner "illegal candidate · rear wing 25° · TD-01"; table 25° in red; 3D setup rw 25 | `1440-07`, `1280-07`, `1920rm-07` |
| 8 | Selecting a row clears the stale banner (N-C) | PASS | PASS | PASS | banner null after the row click | — |
| 9 | Server down, then up | PASS | PASS | PASS | banner `POST /api/plan · NETWORK …`; Retry enabled; API dot red; "reconnecting"; wet toggle → banner `POST /api/state` and the checkbox reverts; after restart SSE is "live" again, Retry succeeds, banner clears | `1440-08a`, `1440-08b` |
| 10 | Source labels visible (B1) | PASS | PASS | PASS | every visible `.src` in every card in every state: **0.0 px hidden**; card body scroll 0; no foot overflow | all |
| 11 | Rail height constant (S6, D-I2) | PASS | PASS | PASS | rail top 52 / height **248** in all 15 states; main area constant 505.7 / 402.6 / 704 px | — |
| 12 | Banner does not move the layout | PASS | PASS | PASS | rail shift 0, main shift 0 (banner sits inside the header, 28 px) | `1440-07`, `1440-08a` |
| 13 | Widget lines (B3/N-A) | PASS | PASS | PASS | task 15.6 px; head/facts/exam/console/budget all inside the widget, none clipped; widget 145.6 px (1280: 176.1) | `1440-13` |
| 14 | One PLAN trace line per call (S1) | PASS | PASS | PASS | 4 calls → 4 PLAN lines; overrule/promote/rule get their own kinds without a request id; the 422 shows as an ERROR line, not PLAN | `1440-05` |
| 15 | 3D wing change (pixel diff, reduced motion, 897×504) | PASS | — | — | noise 0.000 %; rw 20→30 without ghost **0.474 %**, with ghost **1.588 %**; fw 25→35 0.244 %; swap 7.8 ms | `1440-09a/b/c` |
| 16 | Rear / front close-up focus | PASS | — | — | motion on: `focus()` = rear (rear only changed) or front (front only), from about 0.8–1.0 s to 4.8 s after Run; reduced motion: null throughout | `1440-11-focus-rear/front` |
| 17 | Ledger columns and overflow | PASS | **FAIL** | PASS | change column 107 / **50** / 280 px; at 1280 "CHANGE" and every change read "rear_…" / "front…" → S-1 | `1280-03b`, `1280-07` |
| 18 | 3-row and 60-row ledger | PASS | — | — | 63 experiments: meta "63 experiments", 50 rows (#63 to #14), scrolls inside the wrap (1169/159), sticky header 0 px, no page scroll | `1440-14`, `1440-14b` |
| 19 | Keyboard focus order and rings | PASS | — | — | 24 stops in reading order (DESIGN → EVALUATE → RACE → LEARN form → conditions → widget ✎ → trace mreq → ledger rows), all 2 px `--purple` rings; switches ring the `.tk` | `1440-12-focus-tab13` |
| 20 | Contrast vs DESIGN_SYSTEM §7 | FAIL (nit) | — | — | 183 text nodes: `--muted` on panel 5.0–5.7:1; one fail, the **budget line 4.18:1** (orange at opacity .85, 11 px) → N-3 | `1440-13` |
| 21 | Console | PASS* | PASS* | PASS* | 0 page errors. Only: N2 (422 on TD-01, accepted), the expected connection errors while the server was down, and **4 "GL Driver Message … GPU stall due to ReadPixels" warnings ≈5 s after load** (no screenshot involved) → N-4 | — |
| 22 | Forbidden words (CFD, wind tunnel, validated, aerodynamically tested) | PASS | PASS | PASS | 0 matches in `innerText` across 45 states; exam shown as n/20, no % | — |
| 23 | Number formatting | FAIL (should) | same | same | lap times 3 dp; deltas signed with U+2212; km/h integers; " %" spaced. But the change strings use raw keys and ASCII "-": "brake_bias_pct -2", "rear_wing_deg -4" → S-2 | `1440-02b` |
| 24 | Reduced motion | PASS | — | — | pulse is a static "…"; progress bar and card transitions 0 s; no camera focus | `1440-10` |
| 25 | Widget counters agree | FAIL (should) | | | after 5 plans and 1 illegal: "CALLS 6 · 5 trained" next to "budget · trained 5 · untrained 0" → S-3 | `1440-13` |

## New defects

**Blocking:** none. B1, B2, B3, S1, S4, S6 and N-C are verified fixed.

**Should fix**
- **S-1 · The ledger "change" column is 50 px at 1280×800**, so every change reads "rear_…" and the header reads "CHAN…" (`1280-03b`). The fixed columns add up to 396 of the 446 px. Fix (`lab/lab.css`, `@media (max-width:1299px)`): `.ledger col.c-d{width:50px} .c-agr{width:38px} .c-v{width:62px} .c-rule{width:40px} .c-st{width:66px} .c-n{width:26px}`. That gives the change column about 105 px. S-2 (shorter text) also helps.
- **S-2 · Change strings are raw server keys with an ASCII hyphen-minus and no units**: "candidate · front_wing_deg -2, ers_deploy +0.2" (DESIGN, corner badge, ledger, PROMOTE trace). Everything else on the page reads "rear wing −4°". Fix (`lab/lab.js`): add a `fmtChange(x)` that builds the text from `x.candidate` vs `x.baseline` with `pname`/`punit`/`fmtSetupV` and "−", and use it wherever `x.change` is shown.
- **S-3 · The widget "calls" count includes illegal 422 attempts that never reached Mubit.** It reads 6 · 5 trained while the budget line reads trained 5 · untrained 0. Fix (`server/app.js` l.103): `calls_total: calls.filter(x => x.kind !== "illegal").length`, matching `budgetView`.
- **S-4 · A selected experiment's circuit and conditions are not shown with its numbers.** After a Monza/wet/8 m/s row is selected while the bar is set to Silverstone dry, the header says "silverstone · min lap" but EVALUATE shows 78.695 s with only "vmin at Lesmo 1-2" as a clue (`1440-08a`). Fix (`lab.js renderEvaluate`): add the experiment's `circuit · wet/dry · wind` to the EVALUATE source label.
- **S-5 · The 3D ghost and the setup table disagree once the baseline has moved.** The ghost uses `x.baseline` (the experiment's baseline) while the table uses `S.state.baseline`. Right after Promote, the table shows baseline = candidate (22° / 22°) while the 3D view zooms to the front wing with a purple "baseline's wing" ghost at 25° (`1280-05`, `1440-05`). Fix (`lab.js renderMain` l.274): `ghost = (ill || x) ? base : null`, so the ghost uses the same baseline as the table (`S.state.baseline`). After a promote that is the candidate itself, so no ghost appears.

**Nits**
- **N-1 · The corner badge and setup table sit over the car during close-ups.** The front close-up puts the nose through the badge text, and the rear close-up puts the tyre under the table (`1280-05`, `1440-11-focus-rear`). Fix (`lab.css`): `.main .corner .badge{background:rgba(10,10,12,.85)}` and set the `.setup-table` background alpha to .9.
- **N-2 · The 3D label appears twice**: top-right `.car3d-label` and bottom-left `#mainSrc` use the same words. Fix: `#mainSrc` = "procedural car · Equation I model" only.
- **N-3 · Budget line contrast is 4.18:1.** Fix (`lab.css`): drop `opacity:.85` from `.widget .budget` (5.4:1).
- **N-4 · 4 WebGL "GPU stall due to ReadPixels" warnings on every load**, most likely 2D-canvas `getImageData` readbacks in the livery pipeline (`js/carglb.js` l.407/430/621/707/781). Fix: `getContext('2d', { willReadFrequently: true })` on canvases that are read back. Check DevTools on the demo laptop: these may be SwiftShader-only.
- **N-5 · Retry on ILLEGAL_SETUP re-sends the same illegal candidate (another 422).** Fix (`lab.js runPlan`): for ILLEGAL_SETUP, make the action "Run" (the agent's next step) instead of Retry.
- **N-6 · The ledger shows the newest 50 rows only** (63 → #14); #1–#13 cannot be reached. Fix: "showing 50 of 63" in the meta.
- **N-7 · Minor:** the DESIGN "expect" S3 wraps to a second line at 1440; the LEARN foot buttons sit 3 px lower than the other cards'; ledger "—" is muted in meas Δ but full-white in agree.

## Not testable here
- Motion at 1920 (SwiftShader too slow; tested with reduced motion), a real 3-lap race to the chequered flag, the game iframe console over a full race, real `mreq_` ids and latencies (mock), and real-GPU DevTools warnings.
- At 1440/1280 the ledger row reached RACED later than 1.5 s after the result while the game iframe ran (at 1920 with reduced motion it was immediate). This is likely CPU starvation under SwiftShader; recheck on the laptop.
