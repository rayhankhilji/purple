# Lane QA

Status: done (end-to-end lab loop, 2026-10-24, HEAD e764820). Owner: QA agent (session_01U2tgEhT5Kgr4kE9kJ4Psw4 subagent). Branch: claude/amazing-planck-804i13 (local commit, not pushed).

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

## 2026-10-24 03:40 London (02:40 UTC) — QA — end-to-end lab loop, headless Chromium, mock planner

- Status: done. Read-only on code. Files changed: this file + `docs/agents/lanes/qa-screens/*.png` (16 screenshots; the integrator's commits 2578d34/dc8c68c had already swept the pass-1 set in, pass 2 overwrites them).
- **Code under test: HEAD `e764820`** (after UI PR #29: budget line, race clock, overlays hidden while racing, `setBaseline` ghost). Pass 1 ran on `4887f53` five minutes earlier; where the two differ it is noted.
- Setup: `MUBIT_MOCK=1 PURPLE_PORT=8797 PURPLE_DATA_DIR=<scratchpad>/qa-data node server/index.js` (a fresh, isolated data dir instead of `data-mock/`, which was empty and is untouched; the real `data/` was never touched), `PURPLE_STATIC_PORT=8798 node server/static.js`, page `http://127.0.0.1:8798/lab/?api=http://127.0.0.1:8797`. `lab/lab.js` l.7 reads `?api=` (default `http://127.0.0.1:8787`), so the override exists: not a defect. Nothing answered on 8787. playwright-core + `/opt/pw-browsers/chromium` (SwiftShader), 1440×900, `waitUntil: 'load'`, 5–6 s settle. No real Mubit call, no `npm run collect`. Race result posted with `node server/scripts/fake-race.js --port 8797` (the real game loaded in the iframe and started lap 1, but I did not wait for a lap). Both servers killed at the end.

### Pass / fail (HEAD e764820)

| # | Step (AC) | Result | Evidence | Screenshot (`docs/agents/lanes/qa-screens/`) |
|---|---|---|---|---|
| 1 | Empty state (F-06.AC1) | PASS | all four cards `empty` with one sentence + action; ledger "No experiments yet — run one"; no banner; SSE "live"; 3D canvas 897×560, 23 % non-black pixels after 6 s | `01-empty.png` |
| 2 | Run → loading + pending trace (F-06.AC2) → success | PASS | (`/api/plan` delayed 2.5 s by a route) DESIGN `is-loading` "asking the agent" + progress bar, EVALUATE "evaluating", Run disabled, trace pending line `PLAN client c78a0… POST /api/plan` with pulse; then DESIGN + EVALUATE `success` (rear wing +6: Δ +0.322), pending line gone, ledger row 1 | `02a-run-loading.png`, `02b-run-success.png` |
| 3a | Race it → iframe `?lab=1` | PASS | `../index.html?lab=1&exp=…&seed=1103884844&laps=3&circuit=silverstone&baseline=…&candidate=…&mult_baseline=…&mult_candidate=…`: all 9 params present, the 4 b64 blobs decode to JSON (candidate df 1.108 / cd 1.066); RACE card "racing" + elapsed clock; game frame has a canvas, LAP 1/3; lab overlays hidden | `03a-racing.png` |
| 3b | fake-race → RACE card measured Δ + agreement, ledger row | PASS | RACE `success`: measured +0.369, predicted +0.322, `agreement 15 %` (green), 3 sector Δ, both cars; ledger row → +0.369 · 15 % · RACED | `03b-race-result.png` |
| 3c | Broadcast iframe NOT unloaded the instant the result arrives | **FAIL** | MutationObserver: iframe `src` removed and `hidden` set 146 ms after the result POST (pass 1: 160 ms) → B2 | `03b-race-result.png` |
| 4 | Overrule with reason → chip, rules toggle, next scenario carries rule (F-05.AC1) | PASS | R-01 chip in DESIGN, LEARN and ledger; toggle off → API `R-01:false`, row `r off`; on → `R-01:true`; next Run `GET /api/ledger?limit=1` → `.scenario.rules = ["Weigh straight-line drag against corner gain; judge on full-lap delta."]`, `rules_applied: ["R-01"]` | `04a-overrule.png`, `04b-rule-off.png`, `04c-next-run-with-rule.png` |
| 5 | Promote → baseline changes | PASS | `GET /api/state` baseline brake bias 57 → 59 = the candidate; LEARN "promoted", Promote disabled, ledger PROMOTED | `05-promote.png` |
| 6a | ConditionsBar → POST /api/state | PASS | wind 8 m/s, from 90°, wet, monza, TD-01 each reflected in `GET /api/state`; header badges + `#condSrc` follow | `06a-conditions.png` |
| 6b | TD-01 + `EI.lab.run({candidate: rw 25})` → TD-01 label (F-09.AC1) | PASS (see S4) | DESIGN `error`: `ILLEGAL_SETUP · POST /api/plan`, badge `TD-01` "Technical directive TD-01: rear wing capped at 20°"; banner; trace ERROR line; setup table 25° red, range 5–20° TD-01; `calls.jsonl` `kind: illegal, trained: false, violations: [TD-01]` | `06b-td01-illegal.png` |
| 7 | 3D car non-black after 6 s; rw 30 changes the mesh (F-07.AC1) | PASS (weak, see S5) | non-black 23 %. Isolated (`setSetup(…, {animate:false})`, reduced motion): noise 0.00 %, rw 20→30 changes 0.53 % of #car3d pixels (pass 1 without the ghost: 0.05 %); swap 6.5–17 ms, first frame 25 ms (< 200 ms). The change that shows is mostly the purple baseline ghost; the main plane barely moves | `07a-car3d-after-rw30.png`, `07b-car3d-rw20-vs-rw30.png` (2× crop, left rw 20, right rw 30) |
| 8 | Server down → banner names endpoint, action re-enabled (F-06.AC3) | PASS | banner `POST /api/plan · NETWORK · cannot reach http://127.0.0.1:8797 …`; DESIGN `error`, Retry enabled; API dot red; trace "reconnecting"; wet toggle → banner `POST /api/state`, checkbox reverted | `08-server-down.png` |
| 9a | Console errors / warnings (DESIGN_SYSTEM §8: none) | FAIL (nits) | 0 page errors, 0 warnings. Errors: `favicon.ico 404` on every load (N1); `POST /api/plan 422` on the TD-01 demo (N2); and, expected while the server was killed, `ERR_INCOMPLETE_CHUNKED_ENCODING /api/stream` + 4× `ERR_CONNECTION_REFUSED`. Nothing from the game iframe in its ~5 s | — |
| 9b | Every number has its source label (G-HON-01) | **FAIL** | labels are in the DOM, but the DESIGN, EVALUATE and RACE cards clip them below the fold (body scrollHeight 256 / 211 / 247 vs clientHeight 179 / 179 / 184) → B1; ledger numbers have no visible label → S8 | `09-labels-raced-row.png`, `02b-run-success.png` |
| 9c | No forbidden words (CFD, wind tunnel, validated) | PASS | 0 matches in `document.body.innerText` all session | — |
| 10 | Widget: task, kept, exam "n/20 verdicts · n/20 next-step", budget, "updated from console" | **FAIL** | after the ✎ form: kept 43, v1, "Below target", `provider 20/20 verdicts · 10/20 next-step`, "updated from console 02:34", "budget today (UTC) · trained 2 · untrained 0 · resets 00:00" all render, but the **task name is invisible** (B3, a PR #29 regression); calls + budget counters stale (S2) | `10-widget.png`, `01-empty.png` |

### Defects, ranked

**Blocking for the demo**

- **B1 · Source labels clipped off the three number cards (G-HON-01).** Repro: Run once at 1440×900, or select a raced row. Expected: each card shows its label ("research agent · claude-haiku-4-5 via Mubit · mreq… · ms"; "reduced-order lap model · calibrated to 2026 pole laps · aero map v1 · vmin at …"; "measured in race, seed N · agreement = …"). Actual: the card `.body` is `overflow:auto` and `.src` sits below the visible area. DESIGN's and RACE's labels are fully hidden; EVALUATE's is cut at "aero". Owner: UI (`lab/lab.css`, `lab/lab.js` render*). Fix: move each card's `.src` into the fixed `.foot` row (or make it `position: sticky; bottom: 0`) and clamp the hypothesis to one line.
- **B2 · Broadcast iframe torn down ~150 ms after the result.** Repro: Race it, then post a result (from the game or `fake-race.js`). Expected: the race view stays up (finish, results screen) until the engineer leaves it. Actual: the SSE `race` handler (lab.js ~l.335) and `postRaceResult` set `S.racing = null`, and `renderMain` (l.199) removes the iframe `src` at once. The chequered flag and the game's results screen never reach the camera (demo-script §RACE: "then the finish"). Owner: UI. Fix: keep a separate `S.raceView` that only "Back to 3D view" (or a 10 s hold) clears; `S.racing` drives only the card state.
- **B3 · Widget task name collapsed to 0.8 px (regression from PR #29).** Repro: open the lab (HEAD e764820), or set the task name with ✎. Expected: "Research engineer of F1" under MUBIT · TASK (DESIGN_SYSTEM §8). Actual: `.widget` is a fixed 140 px flex column with `overflow:hidden`; the new budget line overflows it, so flex shrinks `.task` to 0.78 px (DOM-measured). Pass 1 on 4887f53 showed it. Owner: UI (`lab/lab.css` l.151/154). Fix: `.widget .task { flex-shrink: 0 }` plus `flex: 0 0 auto` / `min-height: 156px` on `.widget`, or put the budget on the "updated from console" line.

**Should fix**

- **S1 · Overrule and promote show up as extra "PLAN" Mubit lines in the trace.** Repro: Run, then Overrule, then Promote. Expected: one PLAN line per Mubit call. Actual: each status change appends another `PLAN exp-… mreq_test0… 1 ms reject` line with the same request id and latency, so one call shows as 3 PLAN lines (`04a`, `05`). In a trace labelled "Mubit calls" this overstates the calls. Owner: UI (`traceExperiment`, keyed on status). Fix: trace `overruled`/`promoted` rows as kind `overrule`/`promote` without requestId/latency (the `rule` line already covers the overrule).
- **S2 · Widget calls counter and budget line are stale.** Repro: fresh data, Run twice. Expected: "2 · 2 trained" and "budget today · trained 2". Actual: "0 · 0 trained" and "trained 0" (`05`). They refresh only when a `status` SSE event fires (here, after a conditions change). Owner: SERVER (or UI). Fix: `emit("status", statusView())` after every `calls.jsonl` append, or have the lab refetch `/api/status` on each `plan` event.
- **S4 · The TD-01 illegal moment contradicts itself.** Repro: TD-01 on, then `EI.lab.run({candidate: {…, rear_wing_deg: 25}})`. Expected: every panel shows the illegal candidate. Actual: DESIGN says ILLEGAL_SETUP TD-01 and the setup table shows 25° in red. But EVALUATE still shows the previous experiment's +0.006 with a green **legal** badge, and the corner badge and 3D car still show the previous candidate (`06b`). Owner: UI. Fix: when `S.illegalCandidate` is set, render EVALUATE as "illegal · TD-01 · no lap time" and pass the illegal setup to the 3D view and corner badge.
- **S5 · The rear-wing angle change itself is hard to see; the ghost draws through the body.** Repro: select rw 30 against a rw 20 baseline. Expected: an obvious main-plane angle change. Actual: the main plane barely moves at the hero angle (0.05 % of pixels without the ghost). The new baseline ghost carries the visible change, but it ghosts the front wing as well even when only the rear changed, and it renders through the nose and sidepods (no depth test) (`03b`, `07b`). Owner: CAR3D (`lab/car3d.js`, `js/carmodel.js`). Fix: exaggerate the displayed AoA (×2–3, say so in `#mainSrc`) or frame the rear wing nearer to profile; ghost only the wing whose value differs, with `depthTest` on.
- **S6 · Layout jumps.** Repro: load (rail 180 px), Run (rail 256 px), then trigger any error. Expected: a fixed 180 px rail (DESIGN_SYSTEM §4) and a stable main area. Actual: the rail grows by 76 px once a plan lands, and the banner pushes the page down 42 px; the 3D view shrinks from 560 to 484 px and re-frames. Owner: UI (`lab/lab.css`). Fix: a fixed rail height with the card contents fitted (see B1), and the banner as an overlay.
- **S8 · Ledger numbers have no visible source label.** Repro: any ledger with rows. Expected: pred Δ / meas Δ / agree labelled (G-HON-01). Actual: only `title` tooltips; the meta reads "n experiments · newest first". Owner: UI. Fix: meta text "pred Δ = lap model · meas Δ = race · n experiments".

**Nits**

- **N1 · `favicon.ico` 404 console error on every lab load.** Owner: UI. Fix: `<link rel="icon" href="data:,">` in `lab/index.html`.
- **N2 · `422` resource error in the console on the TD-01 demo.** This is the API contract (422 ILLEGAL_SETUP), but DevTools is not clean. Owner: SERVER/UI. Fix: accept it; keep DevTools closed in the video and note it in the shot list.
- **N3 · Ledger verdict and rule columns overflow.** "reject → promote" shows as "reject →…" and the R-01 chip spills into the status column (`04a`). Owner: UI (`lab.css` column widths). Fix: widen `c-v`/`c-rule`, or put the overrule verdict on a second line.
- **N4 · RACE card header row duplicates "baseline".** It reads "baseline | lap · vmax / vmin" above "baseline | 80.654 …", and "213 km/h" wraps. Owner: UI (`lab.js` renderRace kv). Fix: a blank key (or "car") for the header row.
- **N5 · Trace rule lines run off the right edge with no ellipsis** ("…judge on full-lap de"). Owner: UI. Fix: `text-overflow: ellipsis` on `.tl .m .muted`.
- **N6 · A first Run on fresh state can pick an ERS-only change** (pass 1: `ers_deploy +0.2`). The lap model has no ERS, so predicted Δ = +0.000 and RACE agreement reads "n/a". Owner: SERVER/EVAL (`scenarios.perturb`). Fix: skip zero-effect (ERS-only) random candidates, or drive the demo with a fixed seed or a wing candidate.
- **N7 · Before the console read, the widget's task name is the prompt's first 8 words** (`TASK_NAME_HINT` + "…"), which reads like placeholder text. It is invisible now anyway (B3). Owner: SERVER/UI. Fix: "task name not read from the console yet" until `task_name` is set.
- **N8 · DESIGN card rows wrap.** "next" sits on its own line above the value, and "expect … S3" wraps (`02b`). Owner: UI (`lab.css .row .k`). Fix: a fixed-width key column with nowrap.
- **N9 · While racing, the `#mainSrc` label "Equation I · ?lab=1 broadcast mode" overlaps the game's minimap (bottom-left)** (`03a`). Owner: UI. Fix: move `#mainSrc` to bottom-right while racing.

**Fixed between pass 1 and pass 2 (PR #29, verified):** the widget budget line is present; the lab corner badge and setup table no longer cover the game HUD while racing; `setBaseline` is called, so the baseline ghost shows.

- Not defects: the rules switch's `<input>` sits under `span.tk` (clicks go through the label, keyboard works); the `?api=` override works; the F-09.AC1 trace marking (ERROR ILLEGAL_SETUP line) is present.
- Decisions proposed: none.
- Blockers / questions for Tanuj: none.
- Next three actions (whoever picks QA up): re-run after UI fixes B1–B3/S1/S4/S6/S8 and CAR3D fixes S5 (driver pattern: route-delay `/api/plan` for the loading state, MutationObserver on `#game`, `setSetup({animate:false})` + reduced motion for the 3D diff, DOM-measure `.src` and `.task` visibility); one real 3-lap browser race at 1× for T-F04-AC1/AC3; watch the game iframe console over a full race.

## Template for a session entry

### YYYY-MM-DD HH:MM London — <agent/session> — <task id>
- Status: in_progress | done | blocked: <what, who>
- Files changed:
- Verify step run + output:
- Decisions proposed (for the integrator to log in TASK_LOG):
- Blockers / questions for Tanuj:
- Next three actions:
