# Lane QA

Status: done (end-to-end lab loop pass 1, 2026-10-24). Owner: QA agent (session_01U2tgEhT5Kgr4kE9kJ4Psw4 subagent). Branch: claude/amazing-planck-804i13 (local commit, not pushed).

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

## 2026-10-24 03:30 London (02:30 UTC) — QA — end-to-end lab loop, headless Chromium, mock planner

- Status: done. Read-only on code; files changed: this file + `docs/agents/lanes/qa-screens/*.png` (16 screenshots).
- Setup: `MUBIT_MOCK=1 PURPLE_PORT=8797 PURPLE_DATA_DIR=<scratchpad>/qa-data node server/index.js` (a fresh, isolated data dir instead of `data-mock/`, which was already empty and is untouched; the real `data/` was never touched), `PURPLE_STATIC_PORT=8798 node server/static.js`, page `http://127.0.0.1:8798/lab/?api=http://127.0.0.1:8797`. `lab/lab.js` line 7 reads `?api=` (default `http://127.0.0.1:8787`), so the override exists: not a defect. Nothing answered on 8787. playwright-core + `/opt/pw-browsers/chromium` (SwiftShader GL), 1440×900, `waitUntil: 'load'`, 5–6 s settle. No real Mubit call, no `npm run collect`. The race result was posted with `node server/scripts/fake-race.js --port 8797` (the real game was loaded in the iframe and started lap 1, but not waited for). Both servers killed at the end.

### Pass / fail

| # | Step (AC) | Result | Evidence | Screenshot |
|---|---|---|---|---|
| 1 | Empty state (F-06.AC1) | PASS | all four cards `empty` with one sentence + action; ledger "No experiments yet — run one"; no banner; SSE "live"; 3D canvas 897×560 with 23 % non-black pixels | `qa-screens/01-empty.png` |
| 2 | Run → loading + pending trace (F-06.AC2) → success | PASS | (plan request delayed 2.5 s with a route) DESIGN `is-loading` "asking the agent" + progress bar, EVALUATE "evaluating", Run disabled, trace pending line `PLAN client 3b231… POST /api/plan` with pulse; then DESIGN + EVALUATE `success`, pending line removed, ledger row 1 | `02a-run-loading.png`, `02b-run-success.png` |
| 3a | Race it → iframe `?lab=1` | PASS | src `../index.html?lab=1&exp=…&seed=…&laps=3&circuit=silverstone&baseline=…&candidate=…&mult_baseline=…&mult_candidate=…`; all 9 params present and the 4 b64 blobs decode to JSON; RACE card "racing"; game frame has a canvas and shows LAP 1/3 | `03a-racing.png` |
| 3b | fake-race → RACE card measured Δ + agreement, ledger row | PASS | RACE `success`: measured Δ, predicted Δ, agreement badge, 3 sector Δ, both cars; ledger row → meas Δ + agree + RACED (pass 1: predicted +0.079, measured +0.077, agreement 3 %; pass 2: predicted +0.000 → agreement "n/a", see N6) | `03b-race-result.png` |
| 3c | Broadcast iframe NOT unloaded the instant the result arrives | **FAIL** | MutationObserver: iframe `src` removed and `hidden` set 160 ms after the result POST (defect B2) | `03b-race-result.png` |
| 4 | Overrule with reason → chip, rules toggle, next scenario carries rule (F-05.AC1) | PASS | R-01 chip in DESIGN, LEARN and ledger; toggle off → API `R-01:false`, row class `r off`; on → `R-01:true`; next Run's `GET /api/ledger?limit=1` → `.scenario.rules = ["Weigh straight-line drag against corner gain; judge on full-lap delta."]`, `rules_applied: ["R-01"]` | `04a-overrule.png`, `04b-rule-off.png`, `04c-next-run-with-rule.png` |
| 5 | Promote → baseline changes | PASS | `GET /api/state` baseline brake 57→60, ERS 0.5→0.8, equal to the candidate; LEARN "promoted", Promote disabled, ledger PROMOTED | `05-promote.png` |
| 6a | ConditionsBar → POST /api/state | PASS | wind 8 m/s, from 90°, wet, monza, TD-01 each reflected in `GET /api/state`; header badges + `#condSrc` update | `06a-conditions.png` |
| 6b | TD-01 + `EI.lab.run({candidate: rw 25})` → TD-01 label (F-09.AC1) | PASS (with S4) | DESIGN `error`: `ILLEGAL_SETUP · POST /api/plan`, badge `TD-01` "Technical directive TD-01: rear wing capped at 20°"; banner; trace ERROR line; setup table rear wing 25° red, range 5–20° TD-01; `calls.jsonl` row `kind: illegal, trained: false, violations: [TD-01]` | `06b-td01-illegal.png` |
| 7 | 3D car non-black after 6 s; rw 30 changes the mesh (F-07.AC1) | PARTIAL | non-black 23 % at load. Isolated swap (`setSetup(…, {animate:false})`, reduced motion): noise 0.00 %, rw 20→30 changes **0.05 %** of #car3d pixels (a 119×24 px edge between the endplates); swap 7–10 ms (< 200 ms). Measurable, barely visible (defect S5). In the full loop the hero ease moves the camera so the diff (13 % vs 4 % noise) is mostly camera | `07a-car3d-after-rw30.png`, `07b-car3d-rw20-vs-rw30.png` (2× crop, left rw 20, right rw 30) |
| 8 | Server down → banner names endpoint, action re-enabled (F-06.AC3) | PASS | banner `POST /api/plan NETWORK · cannot reach http://127.0.0.1:8797 …`; DESIGN `error` with Retry enabled; API dot red; trace "reconnecting"; wet toggle → banner `POST /api/state`, checkbox reverted | `08-server-down.png` |
| 9a | Console errors / warnings (DESIGN_SYSTEM §8: none) | FAIL (nits) | 0 page errors, 0 warnings. Errors: `favicon.ico 404` (every load, N1); `POST /api/plan 422` (TD-01 demo, N2); and, expected while the server was killed, `ERR_INCOMPLETE_CHUNKED_ENCODING /api/stream` + 4× `ERR_CONNECTION_REFUSED`. Nothing from the game iframe in its 5 s | — |
| 9b | Every number has its source label (G-HON-01) | **FAIL** | the labels exist in the DOM but DESIGN, EVALUATE and RACE cards clip them below the fold at 1440×900 (body scrollHeight 256 / 211 / 247 vs clientHeight 179 / 179 / 184) (B1); ledger numbers have no visible label (S8) | `09-labels-raced-row.png`, `02b-run-success.png` |
| 9c | No forbidden words (CFD, wind tunnel, validated) | PASS | 0 matches in `document.body.innerText` across the session | — |
| 10 | Widget: task, kept, exam "n/20 verdicts · n/20 next-step", budget, "updated from console" | PARTIAL | after the ✎ form: "Research engineer of F1", kept 43, v1, "Below target", `provider 20/20 verdicts · 10/20 next-step`, "updated from console 02:28" all render. **No budget line** (S3); calls counter stale (S2) | `10-widget.png` |

### Defects, ranked

**Blocking for the demo**

- **B1 · Source labels clipped off the three number cards (G-HON-01).** Repro: Run once at 1440×900 (also select a raced row). Expected: each card shows its label ("research agent · claude-haiku-4-5 via Mubit · mreq… · ms", "reduced-order lap model · calibrated to 2026 pole laps · aero map v1 · vmin at …", "measured in race, seed N · agreement = …"). Actual: the card `.body` is `overflow:auto` and the `.src` line sits below the visible area (DESIGN's label fully hidden, EVALUATE's cut mid-line at "aero", RACE's fully hidden). Owner: UI (`lab/lab.css`, `lab/lab.js` render*). Fix: move each card's `.src` into the fixed `.foot` row (or `position: sticky; bottom: 0`) and clamp the hypothesis to one line.
- **B2 · Broadcast iframe torn down 160 ms after the result.** Repro: Race it, then post a result (game or `fake-race.js`). Expected: the race view stays up (finish / results screen) until the engineer leaves it. Actual: the SSE `race` handler sets `S.racing = null` (lab.js ~l.329, also `postRaceResult` l.394) and `renderMain` (l.198) removes the iframe `src` at once, so the chequered flag and the game's results screen are never on camera (demo-script: "then the finish"). Owner: UI. Fix: keep a separate `S.raceView` that only "Back to 3D view" (or a 10 s hold) clears; `S.racing` controls only the card state.

**Should fix**

- **S1 · Overrule and promote show up as extra "PLAN" Mubit lines in the trace.** Repro: Run, Overrule, Promote. Expected: one PLAN line per Mubit call. Actual: each status change appends another `PLAN exp-… mreq_test0… 1 ms reject` line with the same request id and latency (3 PLAN lines for 1 call; `04a`, `05`). Owner: UI (`traceExperiment` keyed on status). Fix: for `overruled`/`promoted` rows trace kind `overrule`/`promote` without requestId/latency (the `rule` line already covers overrule).
- **S2 · Widget "calls" counter is stale.** Repro: fresh data, Run twice. Expected: "2 · 2 trained". Actual: "0 · 0 trained" (`04c`); later "3 · 2" after 6 calls (`07a`). It only refreshes when a `status` SSE event fires. Owner: SERVER (or UI). Fix: `emit("status", statusView())` after every `calls.jsonl` append (or the lab refetches `/api/status` on each `plan` event).
- **S3 · Widget has no budget line.** Repro: open the lab. Expected: a budget line. Actual: none, although `GET /api/status` returns `budget: { trained_today_utc, untrained_today_utc, resets_at, boundary: "00:00 UTC = 01:00 London" }`. Owner: UI (`renderWidget`). Fix: add "budget today · n trained · m untrained · resets 01:00 London".
- **S4 · TD-01 illegal moment contradicts itself.** Repro: TD-01 on, `EI.lab.run({candidate: {…, rear_wing_deg: 25}})`. Expected: every panel shows the illegal candidate. Actual: DESIGN says ILLEGAL_SETUP TD-01 and the setup table shows 25° in red, but EVALUATE still shows the previous experiment's +0.009 with a green **legal** badge, and the corner badge + 3D car still show the previous candidate (`06b`). Owner: UI. Fix: when `S.illegalCandidate` is set, render EVALUATE as "illegal · TD-01 · no lap time" and pass the illegal setup to the 3D view and corner badge.
- **S5 · Rear-wing change is barely visible in the 3D view (F-07.AC1 "visibly").** Repro: `EI.labCar3D.setSetup` rw 20 then 30 at the hero angle. Expected: an obvious angle change. Actual: 0.05 % of pixels change (a thin edge between the endplates); timing passes (7–10 ms). Also `lab.js` never calls `EI.labCar3D.setBaseline`, so the baseline ghost never shows. Owner: CAR3D (display AoA gain / hero framing) + UI (call `setBaseline(S.state.baseline)` in `renderMain`). Fix: exaggerate the displayed AoA (×2–3, labelled) or frame the rear wing in profile, and turn on the baseline ghost.
- **S6 · Layout jumps.** Repro: load (rail 180 px), Run (rail 256 px), trigger any error. Expected: a fixed 180 px rail (DESIGN_SYSTEM §4) and a stable main area. Actual: the rail grows by 76 px once a plan lands and the banner pushes the page down 42 px; the 3D view shrinks from 560 to 484 px and re-frames. Owner: UI (`lab/lab.css`). Fix: fixed rail height with the card contents fitted (see B1), banner as an overlay.
- **S7 · Lab overlays cover the game HUD while racing.** Repro: Race it. Expected: a clean broadcast frame. Actual: the corner badge "RACE · baseline vs candidate" sits on the game's standings tower (top-left) and the setup table covers the game's minimap (bottom-left) (`03a`). Owner: UI. Fix: hide `#setupBox` while racing and move `#mainCorner` to the bottom-right, or out of the iframe area.
- **S8 · Ledger numbers have no visible source label.** Repro: any ledger with rows. Expected: pred Δ / meas Δ / agreement labelled. Actual: only `title` tooltips; the meta says "n experiments · newest first". Owner: UI. Fix: meta text "pred Δ = lap model · meas Δ = race · n experiments".

**Nits**

- **N1 · `favicon.ico` 404 console error on every lab load.** Owner: UI. Fix: `<link rel="icon" href="data:,">` in `lab/index.html`.
- **N2 · `422` resource error in the console on the TD-01 demo.** It is the API contract (422 ILLEGAL_SETUP), but DevTools is not clean. Owner: SERVER/UI. Fix: accept it and keep DevTools closed in the video (note it in the shot list).
- **N3 · Ledger verdict/rule columns overflow.** "reject → promote" shows as "reject →…" and the R-01 chip spills into the status column (`04a`). Owner: UI (`lab.css` col widths). Fix: widen `c-v`/`c-rule`, or show the overrule verdict as a second line.
- **N4 · RACE card header row reads "baseline | lap · vmax / vmin" above "baseline | 80.654 …".** The header key should be blank; "213 km/h" wraps. Owner: UI (`lab.js` l.163). Fix: key `""` (or "car") for the header row.
- **N5 · Trace rule lines run off the right edge without an ellipsis.** ("…judge on full-lap de"). Owner: UI. Fix: `text-overflow: ellipsis` on `.tl .m .muted`.
- **N6 · A first Run on fresh state can pick an ERS-only change.** The lap model has no ERS, so predicted Δ is +0.000 and RACE agreement reads "n/a" (pass 2: `ers_deploy +0.2`). Owner: SERVER/EVAL (`scenarios.perturb`). Fix: exclude zero-effect (ERS-only) random candidates, or have the demo use a fixed seed or a wing candidate.
- **N7 · Before the console read, the widget task name is the prompt's first line** ("You are the research engineer of an F1…", `TASK_NAME_HINT`), which reads like placeholder text. Owner: SERVER/UI. Fix: show "task name not read from the console yet" until `task_name` is set.
- **N8 · DESIGN card rows wrap.** "next" sits on its own line above the value, and "expect … S3" wraps (`02b`). Owner: UI (`lab.css .row .k`). Fix: a fixed-width key column, nowrap.

- Not defects: the rules switch's `<input>` sits under `span.tk` (clicks go through the label; keyboard works); `?api=` override works; F-09.AC1 trace marking (ERROR ILLEGAL_SETUP line) is present.
- Decisions proposed: none.
- Blockers / questions for Tanuj: none.
- Next three actions (for whoever picks QA up): re-run this pass after UI fixes B1/B2/S1–S8 (driver script pattern: route-delay `/api/plan` for the loading state, MutationObserver on `#game`, `setSetup({animate:false})` + reduced motion for the 3D diff); one real 3-lap browser race at 1× for T-F04-AC1/AC3; check the game iframe console over a full race.

## Template for a session entry

### YYYY-MM-DD HH:MM London — <agent/session> — <task id>
- Status: in_progress | done | blocked: <what, who>
- Files changed:
- Verify step run + output:
- Decisions proposed (for the integrator to log in TASK_LOG):
- Blockers / questions for Tanuj:
- Next three actions:
