# PURPLE

**An AI race engineer that redesigns the 2026 Red Bull RB22 to beat the real 2026 Silverstone qualifying lap, with Mubit in the loop.** The car keeps its own Red Bull Ford DM01 power unit and must pass a 94-row FIA 2026 Section C checklist. Each Mubit call (Claude Haiku 4.5 through Mubit, frozen designer prompt) receives the current best car plus the last changes tried and their simulated results; Mubit proposes the next change; a physics lap sim of Silverstone measures it; the simulator, not the model, decides what is kept; and that measured result travels into the next call. Trained calls are stored by Mubit with that history, which is what its kept examples and adapters learn from. Best legal RB22 / DM01 car so far: **87.235 ± 0.154 s** (95 % band 86.933–87.537 s) against the real 2026 pole of 88.111 s: a **model prediction ± band** (physics lap sim · Silverstone · 2026 British GP qualifying conditions), not a claim about a real car.

> **Fresh-code disclosure.** PURPLE is built on **Equation I**, our team's pre-existing browser F1 game (`js/`, `css/`, `assets/`, `vendor/`, `tools/`, `index.html`), imported as one commit (`a711399`, Fri 2026-10-23 21:54 UTC). **New this weekend:** everything under `concept/`, `server/`, `lab/`, `test/` and `docs/`, plus opt-in game hooks in 7 game files (+633 / −48 lines): `?lab=1` (race result to the lab), `?concept=1` (concept replay, new `js/conceptrace.js`), aero inputs in `js/car.js`, `js/ai.js`, `js/carmodel.js`, `js/race.js`, one script tag in `index.html` (ARCHITECTURE.md §9). Without the flags the game behaves as before.

Built for Night Shift, London, 2026-10-24. Judges: the Mubit team. Deployed: **https://purple-wine.vercel.app** (live Mubit calls need the team passcode; mock otherwise)

## Run it

Node 22 or newer.

```bash
npm ci
cp server/.env.example server/.env   # set MUBIT_API_KEY=mbt_...; server/.env is gitignored
npm run dev                          # API 127.0.0.1:8787 + static 127.0.0.1:8788
npm test                             # 326 tests, no network
```

| URL | What |
|---|---|
| <http://127.0.0.1:8788/concept/lab/> → **Engine** button | the engine dashboard: **Speed run** (CMA-ES, no LLM), **Autonomous · Mubit** (Mubit proposes, a legal-only local search exploits, the sim keeps), **Garage** (hot swap any part or material, FIA verdict + per-corner deltas), **Red Bull car sheet**. The orange **Mubit loop** button opens the plain designer loop with the exact request of every call. |
| <http://127.0.0.1:8788/concept/race/> | the physics-sim lap replayed on the game's 3D Silverstone, ghosts RB22 (sim) and ANT's real 2026 pole lap (OpenF1); the concept lab's "watch on Silverstone" link opens it with the current best car |
| <http://127.0.0.1:8788/lab/> | the 5-knob research lab (the first Mubit task) |

`MUBIT_MOCK=1 npm run dev` runs everything without a key (the designer is a scripted stand-in; nothing is sent). Live designer calls are untrained by default; trained calls need an explicit confirmation (`TRAIN <n>`) and count against the project budget (EVAL_GUARDRAILS §4).

## How Mubit is used

**Task 2: the concept designer (the closed loop).** `concept/designer/`, called only through `server/mubit.js`.

- **Model and prompt.** `claude-haiku-4-5`, `max_tokens` 250, temperature 0, no tools; designer prompt v1 frozen (994 chars, task-key sha256 `71d48c5a…`, pinned by `test/concept-designer-frozen.test.js`).
- **What each call receives** (one user message, ≤ 1,800 chars): the current best car (23 parameters by part, lap, gap to pole, mass, weight split), the last 3 tested changes with their **measured** physics-sim lap delta, sector deltas, kept flag, FIA articles violated and the lap segments that gained or lost most, refused proposals with the reason, and the parameters sitting at a legal limit. A real one: `docs/concept/loop-runs/trained-seed11/lineage.jsonl`, `loop.scenario` of any row (deck slide 5 shows iteration 3).
- **What comes back:** 1–3 parameter changes, a hypothesis, an expected direction. There is no verdict field: `kept = legal && faster` is computed from the simulator's numbers (`concept/optimize.js`). A refused answer (parse error, illegal, duplicate) is replaced by one seeded fallback step, marked `by: "fallback"` in the next input.
- **Session per run, request id per result.** `metadata.user_id` = run id = one Mubit session. Every lineage row stores its call's `x-middleware-request-id` (`loop.mubit_request_id`) and the id of the later call whose input carried its result (`loop.fed_to`).
- **Outcome feedback, honestly.** Mubit has no API to attach an outcome or reward to a call. The result travels in the next call's input; on trained calls Mubit stores that input with the next proposal, and adapters train on the kept examples Mubit selects (docs/concept/LOOP.md §4, with links to Mubit's docs).

Designer runs (as of 2026-10-24 09:53 UTC; source `docs/concept/loop-runs/*/{calls,lineage,summary}`):

| Runs | Sessions | Iterations | Mubit calls | Trained | LLM proposal used | Kept (LLM-proposed) | Best lap (physics lap sim) |
|---|---|---|---|---|---|---|---|
| live untrained, prompt tuning | 3 | 13 | 13 | 0 | 7 of 13 | 3 (3) | 88.667 s (baseline 88.752) |
| trained, frozen v1, sim v2 (seeds 11–14) | 4 | 60 | 60 | 60 | 52 of 60 | 9 (9) | 88.612 s (baseline 88.752) |
| trained, big run, sim v3 (seeds 21–32) | 12 | 300 | 271 | 271 | 199 of 271 | 66 (39) | 88.292 s (baseline 88.763) |

331 trained designer calls, 331 unique request ids, 16 sessions; 315 results carried into a later call. In the big run 63 answers were illegal and 9 duplicates (seeded fallback instead), and 29 iterations made no call (the designer pauses after 3 failures in a row). The Mubit loop alone, 25 calls a run, reaches 88.292 s (+0.181 s to pole); the 87.235 s car comes from the speed run. Trained-call budget: 99 research + 331 designer = 430 of 2,500.

**Still pending (Mubit console, read by the owner, not invented here):**

> **FILL** designer task: kept examples `___` · adapter status / test result `___` · Try models on the same scenarios, legal-and-faster proposals: provider `_/_`, adapter `_/_`

**Task 1: the research engineer (first proof, the 5-knob lab).** Mubit task "Research engineer of F1", same model, frozen prompt `lab/prompt.js` (sha256 `6c5be1a3…`). 99 trained calls: 57 on Friday (43 kept examples, Training v1), 1 demo experiment, 41 on Saturday with the engineer's pit-wall rule *"Weigh straight-line drag against corner gain; judge on full-lap delta."* in every input (**rule-conditioned learning**: the rule enters the task input, the provider's answers change, those kept examples train the next adapter version; nothing trains on a click). 61 untrained calls (smoke, exam). Exam, 20 scenarios, truth from the evaluator: provider verdicts 20/20, next experiment 10/20; Try-models sheet of the 8 hardest: provider 8/8 verdicts, 2/8 next step (7/7 and 1/7 without exam-rw8, the demo experiment, whose call is in v2's recorded data). Source: `docs/ledger-snapshot/2026-10-24_02-37-26Z-0530-windcap-exam/`.

> **FILL** research task: kept examples after v2 `___` · adapter v1 / v2 test result `___` · Try models next step v1 `_/8` (`_/7`), v2 `_/8` (`_/7`); verdict v1 `_/8` (`_/7`), v2 `_/8` (`_/7`) (score with `npm run exam:score`)

## The result

Source of every lap below: **physics lap sim · Silverstone · 2026 British GP qualifying conditions** (docs/concept/CAMPAIGN.md §4.0); real laps: **real 2026 qualifying · OpenF1 / formula1.com**.

| Car | Lap | Δ real pole (ANT 88.111) | Δ real HAD RB22 (88.746) | Grid on the real 2026 Q order |
|---|---|---|---|---|
| RB22 baseline (sim) | 88.763 s | +0.652 | +0.017 | P6 |
| **best legal RB22 / DM01 car** | **87.235 ± 0.154 s** (95 % 86.933–87.537) | **−0.876** | **−1.511** | **P1** (95 %: P1–P1) |
| same car, concept aero map gains halved | 87.893 s | −0.218 | −0.853 | |

- PU identical to the homologated DM01 (ICE 396.08 kW, MGU-K 350 kW, ES 4 MJ window); energy 7.633 MJ deployed, 3.657 of 6.5 MJ recharged.
- Biggest per-corner gains (best − baseline): Stowe −0.258, Brooklands −0.215, Becketts (T13) −0.212, Luffield −0.197, Village −0.163, The Loop −0.115 s; the fastest straights give a little back (T9→T10 +0.038 s).
- Floor width, rear-wing span and endplate, front-wing span and the bulkhead gap end at their FIA limits; floor throat 66.5 mm under the 75 mm roof.
- 4 seeds × 5,000 physics laps + refinement (CMA-ES with a surrogate pre-screen; every reported number re-run on the physics sim). The band covers the sim's measured transfer error, fit residual and noise, **not** the concept aero map's coefficients (hence the halved-gains row).

## The physics

- **Physics lap sim v3** (`concept/sim/`, docs/concept/SIM.md): quasi-steady point mass with axle load transfer, power-law tyre load sensitivity, ride-height aero and floor stall, Straight / Corner Mode in the FIA zones only, the C5.12 power-reduction rules, wind, density, gradient. No per-corner factors. Four unknowns estimated on ANT's pole lap only; held out on the other 10 teams' laps: **speed RMS 10.1 km/h (target < 7: missed)**, sector bias +0.172 / +0.015 / −0.192 s. RB22 baseline 88.763 s vs HAD's real 88.746 s.
- **FIA 2026 checklist** (docs/concept/FIA_CHECKLIST.md): 94 rows against Section C Issue 19, enforced in `concept/regs.js`; same-engine and material guards in `concept/bench.js`. An illegal car gets no lap.
- **Materials** (MATERIALS.md, 23 materials with their C15 reading), **coupling** (COUPLING.md: all 23 shape parameters reach the simulated car), **identification** of 11 cars over 9 circuits from 194 OpenF1 laps (IDENTIFY.md).
- **3D car** (VIEW.md): built procedurally from the design at true size (meshes within 1 mm of the parameters on 11 test designs); "concept geometry built to the design's dimensions · FIA 2026 frame · not a team CAD model".

## Honest limits

- The sim misses its own accuracy target (held-out RMS 10.1 vs < 7 km/h); corner-mode downforce sits outside its sourced prior (5.32 vs 4.6 m², widened with the reason in SIM.md §4.2). It is a reduced-order model; no part of it is a flow solution or was measured on a real car.
- The concept aero map's component shares and slopes are estimates; part masses are labelled estimates.
- Mubit learns by imitation of kept examples; it has no outcome API. The LLM predicted a faster lap for 250 of its 251 used trained proposals; the sim measured 48 faster. The simulator decides.
- The grid / game-race modes are cinematic ("game lap model, mixes car and driver"); the physics replay is the result.
- Equation I is pre-existing. "Model prediction ± band", never "we beat F1".

## Repo map

| Path | What |
|---|---|
| `concept/` | design layer, FIA rules (`regs.js`), materials, physics lap sim (`sim/`), campaign (`campaign/`), Mubit designer loop (`designer/`), engine dashboard + lab (`lab/`), 3D car (`view/`), Silverstone replay (`race/`), telemetry and data (`data/`) |
| `server/` | Hono API, the only Mubit client (`mubit.js`), concept and engine routes |
| `lab/` | the 5-knob research lab (prompt frozen, aero map, evaluator) |
| `test/` | `node --test` suites (29 files, 326 tests) |
| `docs/` | build docs, concept docs, deck, demo and video scripts, run logs (`docs/concept/loop-runs/`), ledger snapshots |
| `js/`, `css/`, `assets/`, `vendor/`, `tools/`, `index.html` | Equation I, the game (pre-existing; opt-in hooks only) |

## Docs

- Concept: [`CAMPAIGN.md`](docs/concept/CAMPAIGN.md) (the result) · [`LOOP.md`](docs/concept/LOOP.md) (the Mubit loop) · [`DASHBOARD.md`](docs/concept/DASHBOARD.md) · [`SIM.md`](docs/concept/SIM.md) · [`FIA_CHECKLIST.md`](docs/concept/FIA_CHECKLIST.md) · [`RACE.md`](docs/concept/RACE.md) · [`VIEW.md`](docs/concept/VIEW.md)
- Deck: [`docs/deck/slides.md`](docs/deck/slides.md) → `docs/deck/purple-deck.pdf` · video: [`docs/video-script.md`](docs/video-script.md) · live demo: [`docs/demo-script.md`](docs/demo-script.md)
- Honesty rules: [`docs/EVAL_GUARDRAILS.md`](docs/EVAL_GUARDRAILS.md) · decisions and session log: [`docs/TASK_LOG.md`](docs/TASK_LOG.md)
- The game: [`docs/equation-i/README.md`](docs/equation-i/README.md) · credits: [`CREDITS.md`](CREDITS.md)
