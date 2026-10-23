# PURPLE — Roadmap

Version 1.0 · 2026-10-23 · Times are London. Every task is one agent session or less. Phases are vertical slices: each ends with something a judge could see.

Deadlines that do not move: `/checkin` #1 by Sat 12:00 · `/checkin` #2 Sat 12:00–18:00 · `/submit` (MP4 ≤ 3 min + PDF) by Sat 23:59 · hard freeze Sun 05:00 · live expo Sun 10:30, finals 12:30.

The Mubit clock: training budgets reset 00:00 UTC = **01:00 London**. v1 must collect on Friday's budget (before 01:00 Sat), v2 on Saturday's.

## Phase 0 — Examples flowing (Fri 22:45 → Sat 01:00)

Goal: 50 real research-agent calls through Mubit before the budget rolls, with the task frozen. Nothing visual.

| Task | What | Verify | Refs |
|---|---|---|---|
| P0.T0 | Create public repo `purple`, import Equation I (INSTRUCTIONS §3), `/team create` with the repo URL, README disclosure line | `git log` shows the import commit; Discord team exists | INSTRUCTIONS §3 |
| P0.T1 | `package.json` with pinned deps, `npm ci` clean, `npm run smoke` makes one Mubit call with `x-middleware-record: metadata` and prints `x-middleware-request-id` | The printed request ID starts with `mreq_` (metadata-recorded calls are not listed in **Requests**, so the header is the proof); then one real call without the header appears in **Requests** | ARCH §7.1, T-SMOKE |
| P0.T2 (F-03) | `lab/prompt.js` (frozen text from ARCH §7.2, `PROMPT_VERSION = "1"`), `lab/schema.js` validators for `Setup`, `PlanOutput` | `npm test` schema suite green | ARCH §4.1, §4.6 |
| P0.T3 (F-01) | `lab/aero.js` per ARCH §8 (multipliers, legality, conditions). `js/ai.js`: `buildSpeedProfile` takes `aero`, `wind`; `profileFor` keys on them; `profileLap` caps at terminal speed; export `EI.buildSpeedProfile`, `EI.profileLap` | T-F01-AC1..3 | ARCH §8, §9 |
| P0.T4 (F-02) | `server/game-headless.js` loads `js/util.js`, `js/data/silverstone.js`, `js/data/monza.js`, `js/track.js`, `js/car.js` constants, `js/ai.js` under a THREE stub; `lab/evaluator.js` returns `Evaluation` with sectors from `track.sectors` | T-F02-AC1 (baseline within ±1.0 s of 80.8 s), T-F02-AC2 | ARCH §4.4, §2 |
| P0.T5 (F-03) | `server/index.js` with `/api/evaluate`, `/api/plan`, `/api/ledger`, `/api/rules`, `/api/status`, `/api/stream`; `server/mubit.js`; JSONL writers | T-F03-AC1 | ARCH §5, §6 |
| P0.T6 (F-03) | `server/scenarios.js` generator: random legal perturbations of 1–2 parameters, mixed conditions (70 % dry/no wind, 20 % wind 4–10 m/s, 10 % wet), each with a fresh session ID; `npm run collect -- --n 50` | T-F03-AC2; console **Tasks** shows the task with kept examples ≥ 25 | ARCH §4.5, §7.1 |

Exit criteria: all six verifies pass; console shows one task named from the prompt's first words with ≥ 25 kept examples; `TASK_LOG.md` records the task name and the model; the prompt file is committed and tagged `v1-collected`.

## Phase 1 — The car is real (Sat 01:00 → 12:00)

Goal: baseline vs candidate race in the game with per-car aero, numbers back in the ledger, check-in #1 sent.

| Task | What | Verify | Refs |
|---|---|---|---|
| P1.T1 (F-04) | `js/car.js` per-car `aero` multipliers (opt-in) | T-F04-AC3 precondition: a car with `df 1.3, cd 1.2` has lower top speed and higher Becketts min speed in a 1-lap headless-ish run | ARCH §9 |
| P1.T2 (F-04) | `js/main.js` + `js/race.js` broadcast mode `?lab=1…`: zero players, two bots with identical neutral driver (skill 100, form 0, all traits 0.5), given aero, TV camera, auto-start, `purple:result` postMessage with best lap, best sectors, `vmax_kmh`, `vmin_becketts_kmh` | T-F04-AC1, T-F04-AC2 | ARCH §6 step 7–8, §9 |
| P1.T3 (F-04) | `POST /api/race/result`, `agreement_pct`, SSE `race` | T-F04-AC2 | ARCH §5 |
| P1.T4 | Watch v1: when **Adapters** shows a version, record its test result in `status.json`; if `Below target`/`Prompt only`, run `npm run collect -- --n 30` immediately | `status.json.adapter_version = "v1"` | PRD §5 |
| P1.T5 | `/checkin` #1 in #max: task name, kept examples, v1 status, evaluator–race agreement number, next steps | Max replies | PRD §5 |

Exit criteria: a judge-shaped sentence is true — "the candidate with +8° rear wing was predicted +0.19 s and measured +0.23 s" — and it is in `ledger.jsonl`. v1 exists or is training.

## Phase 2 — The lab you can watch (Sat 12:00 → 18:00)

Goal: the side panel, the 3D car, the correction flow, the exam, v2 collecting. Check-in #2.

| Task | What | Verify | Refs |
|---|---|---|---|
| P2.T1 (F-06) | `lab/index.html` + `lab.js` + `lab.css`: four stage cards with empty/loading/error/success states, ledger table, trace stream from SSE, model-status widget, buttons Run / Race it / Promote / Overrule | T-F06-AC1..3 | DESIGN_SYSTEM §5–6 |
| P2.T2 (F-07) | 3D car view: game's `EI.carModel` in its own scene, `rebuildWings(setup)` on candidate select, ride height translate | T-F07-AC1 | ARCH §9 carmodel row |
| P2.T3 (F-05) | Overrule → `POST /api/overrule` → rule active → included in next scenario; if the console has a per-task correction field, the dev lead pastes the same text there and records it in `TASK_LOG.md` | T-F05-AC1 | ARCH §5, PRD A2 |
| P2.T4 (F-05) | The demo correction: run the lab until the agent promotes/retests a high-wing candidate at Silverstone that the evaluator shows is slower on the full lap; overrule with "Weigh straight-line drag against corner gain; judge on full-lap delta."; then `npm run collect -- --n 40 --with-rules` | T-F05-AC2 (console shows v2 queued/training) | PRD F-05 |
| P2.T5 (F-08) | `data/exam.json` (20 scenarios, truth from evaluator), `npm run exam` on the provider, widget shows `provider: n/20` | T-F08-AC1 | ARCH §4.10 |
| P2.T6 (F-09) | Conditions in the UI (wind slider 0–12 m/s + direction, wet toggle) and the technical-directive toggle `TD-01` | T-F09-AC1 | ARCH §4.2, §8 |
| P2.T7 | `/checkin` #2: v1 result, correction made, v2 status, exam score, what's left | Max replies | PRD §5 |

Exit criteria: full loop clickable end to end on the laptop without touching a terminal; v2 training or trained; exam provider score recorded.

## Phase 3 — Polish, video, deck, submit (Sat 18:00 → 23:59)

| Task | What | Verify | Refs |
|---|---|---|---|
| P3.T1 | Try models: run the exam's 8 hardest scenarios against v1, v2 and provider; screenshot each; enter `exam.v1`, `exam.v2` in status | Widget shows all three scores | PRD F-05.AC3 |
| P3.T2 | Visual polish per DESIGN_SYSTEM: purple-sector accents, number formatting, trace stream timing, the 3D hero shot | Design checklist in DESIGN_SYSTEM §8 | DESIGN_SYSTEM |
| P3.T3 (F-10) | (P1 feature) Grid race: candidate + a real 2026 driver profile vs the full grid, labelled "cinematic" | Runs 2 laps without input | PRD F-10 |
| P3.T4 | Record the 3-minute video following the script in `docs/demo-script.md` (PRD-derived; owner: Tanuj); export MP4 1080p | File ≤ 3:00, plays | PRD §5 |
| P3.T5 | PDF deck (8 slides: problem, what Mubit does here, the loop, the numbers, v1 vs v2, fast refresh, honesty slide, next) | PDF opens | PRD §5 |
| P3.T6 | `/submit` upload; tag `submitted`; freeze `data/` by copying to `docs/ledger-snapshot/` | Discord confirms | PRD §5 |

Exit criteria: submission confirmed before 23:59; `git tag submitted` pushed.

## Phase 4 — Rehearsal only (Sun 08:00 → 10:30)

No new code. Start the server, keep the Try models tab open with v2 warm (3 adapter starts per UTC day; the first takes minutes), run the loop twice, have the video on a second laptop as fallback. Lines for questions: evaluator assumptions, why rule-conditioned learning is honest, what Equation I is.

## Not scheduled (PRD out of scope / P2)

Free-form bodywork, CFD, Blender, seasons, tyre temperature, other circuits, training driver models, calling adapters from the app.
