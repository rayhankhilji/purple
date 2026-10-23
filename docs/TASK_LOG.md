# PURPLE — Task Log

Version 1.1 · Started 2026-10-23 22:45 London · Update after every task. This file is the team's memory across sessions.
Multi-agent rule (decision 2026-10-23 23:20): lane agents write `docs/agents/lanes/<lane>.md`; only the integrator edits this file and `docs/agents/HANDOVER.md` when merging. See `docs/agents/PARALLEL_PLAN.md`.

## Status

| Field | Value |
|---|---|
| Current phase | **P1 — The car is real** (P0 exit criteria passed 2026-10-23 23:58 London) |
| Mubit task name | **Research engineer of F1** (console label; prompt "You are the research engineer of an F1 setup lab"; "Grouped: same instructions and tools") |
| Model | `claude-haiku-4-5` (served by Mubit as `claude-haiku-4-5-20251001`; PRD A3 fallback not needed) |
| Prompt | `lab/prompt.js` PROMPT_VERSION 1, 851 chars ≈ 210 tokens; scenario inputs 120–180 tokens |
| Kept examples | **43 kept** of 57 requests (console → Tasks, 23:58 London) |
| Adapter version / result | **training v1** (status Training; Adapters tab visible = PRD A1 holds; Adapters serving 0) |
| Next deadline | Sat 01:00 London — Friday UTC training budget rolls; then P1 (Sat 01:00 → 12:00), `/checkin` #1 by Sat 12:00 |

## Checklist (current phase: P0)

- [x] P0.T0 Repo `purple`, Equation I imported (commit a711399), README disclosure. **`/team create` on Discord: Tanuj, not done by an agent.**
- [x] P0.T1 `package.json` pinned, `npm ci` clean, `npm run smoke` prints `mreq_` (live: `mreq_01a16ad3ef007011968f90d4c2fe5b7e`, 2,464 ms, 432/135 tokens, untrained)
- [x] P0.T2 `lab/prompt.js` frozen (PROMPT_VERSION 1), `lab/schema.js`, schema tests green
- [x] P0.T3 `lab/aero.js`; `buildSpeedProfile` takes `aero`/`wind`; `profileFor` key; `EI.buildSpeedProfile` exported; T-F01-AC1..3 green
- [x] P0.T4 `server/game-headless.js`, `lab/evaluator.js`; baseline Silverstone = 80.800 s (calibrated), T-F02-AC1..3 green
- [x] P0.T5 server routes + `server/mubit.js` + JSONL writers; T-F03-AC1, AC3, T-F05-AC1, T-F09-AC1 green (36/36 tests)
- [x] P0.T6 scenario generator, `npm run collect -- --n 50` ran live (43 ok / 7 parse_error / 57 trained calls); console: 43 kept examples, task Training v1; tag `v1-collected` (local; tag pushes are refused by the agent credential, Tanuj pushes it or it rides the PR)

Exit criteria: **all true at 23:58 London** (six verifies, task named from the prompt with 43 ≥ 25 kept examples, task name + model recorded here, prompt committed and tagged). Still owed by a human: `/team create` on Discord (P0.T0 verify).

## Checklist (current phase: P1)

- [ ] P1.T1 (F-04) `js/car.js` per-car `aero` (GAME lane, in progress)
- [ ] P1.T2 (F-04) broadcast mode `?lab=1`, `purple:result` postMessage (GAME lane, in progress)
- [x] P1.T3 (F-04) `POST /api/race/result` hardened, `agreement_pct`, SSE `race`, `npm run fake-race` (SERVER lane, merged 00:32 from PR #2; 41/41 tests)
- [ ] P1.T4 watch v1 in **Adapters** (Tanuj screenshot → `status.json`); if Below target / Prompt only → `npm run collect -- --n 30` on the Saturday budget
- [ ] P1.T5 `/checkin` #1 in #max by Sat 12:00 (Tanuj)

## Blockers

| When | What | Owner | Resolution |
|---|---|---|---|
| 2026-10-23 23:05 | Mubit key is not visible to the first cloud session (env vars reach only new sessions); key was pasted in chat instead | Tanuj | Key lives in `server/.env` (gitignored) on the build machine. **Rotate it in console → Mubit keys after the hackathon.** |
| 2026-10-23 23:10 | `/team create` (Discord) needs a human | Tanuj | Console read-out done 23:58 (43 kept, Training v1). Discord team still open |

## Decisions

| When | Decision | Why | Reversible? |
|---|---|---|---|
| 2026-10-23 22:30 | Research-agent decision is the one Mubit task; evaluator is deterministic | Verified outcome per decision; judges' criteria | No (task key) |
| 2026-10-23 22:30 | Five setup parameters, Silverstone + Monza only | 24-hour scope | Yes |
| 2026-10-23 22:30 | No Blender; the game's procedural car is the 3D model | It already has wing `aoa` parameters | Yes |
| 2026-10-23 22:30 | Corrections = pit-wall rules in the task input (+ console if offered); honest "rule-conditioned learning" | Eldar: no corrections API; adapters graded vs provider | Yes |
| 2026-10-23 22:55 | Build docs live in `docs/`; the game's own README moved to `docs/equation-i/` | Root README must open with the disclosure line | Yes |
| 2026-10-23 23:12 | Headless loader uses the real `vendor/three.min.js` r128 in Node, not a THREE stub (ARCH §2 said stub) | It loads cleanly; the evaluator then sees byte-identical track geometry to the browser. No DOM is defined (the Anthropic SDK refuses "browser-like" processes) | Yes |
| 2026-10-23 23:14 | Evaluator calibration: solve the corner-grip scale per track so the neutral car laps `LIMIT_LAP` exactly (80.8 Silverstone → grip 1.137; 76.65 Monza → 1.125) | The profile lap at the game's C_LIMIT is a few % off the sim lap; "calibrated to 2026 pole laps" is then literally true and T-F02-AC1 is a regression guard via fixtures | Yes (`npm run fixtures` + a line here) |
| 2026-10-23 23:14 | `vmin_kmh` = minimum speed in the Maggotts–Becketts complex (s 3,600–4,200 m), `vmin_lap_kmh` = whole-lap minimum | The slowest corner is steering-lock limited and does not respond to wing; F-04.AC3 measures Becketts anyway. Monza: Lesmo 1–2 | Yes |
| 2026-10-23 23:14 | Sectors = the game's `track.sectors` (thirds of length in the track frame), attributed S/F-aligned as `race.js` times them; Hangar Straight is in S3 | ARCH §4.4 says sectors from `track.sectors`; Silverstone data has no real sector lines | Yes |
| 2026-10-23 23:15 | Aero in the lap model only scales a0/a1/b0/b1/cd; GRIP.cap / BRAKE.cap are not scaled | Measured: wing already moves vmax and Becketts vmin the right way; caps are tyre limits | Yes |
| 2026-10-23 23:16 | `validatePlanOutput` tolerates a single ```json fence; prose is still rejected | Haiku returns a fenced object (seen in the live smoke); a fence is not prose; parse_error rate would otherwise be 100 % | Yes |
| 2026-10-23 23:18 | Additive route `GET/POST /api/state` (baseline, conditions, td01, reset_plan) and `data/state.json` | The UI and TD-01 demo need to set conditions; not in ARCH §5 | Yes |
| 2026-10-23 23:18 | `@anthropic-ai/sdk` 0.137.0 (latest 0.x per ARCH), `dotenv` 16.6.1 (17+ prints a banner on stdout) | Stack says pinned; the stdout log line format is a standard | Yes |
| 2026-10-23 23:20 | Multi-agent protocol: lanes with exclusive file ownership; lane agents own `docs/agents/lanes/<lane>.md`; integrator owns TASK_LOG + HANDOVER | 10 agents cannot all edit one log without conflicts | Yes |


## Session log

### 2026-10-23 22:45 — kickoff
- Build docs written (PRD, ARCHITECTURE, INSTRUCTIONS, ROADMAP, TESTING_GUIDE, EVAL_GUARDRAILS, DESIGN_SYSTEM).
- Equation I inspected: `buildSpeedProfile` lap model, per-driver traits, procedural car, 7 circuits, seeded races, replay recorder.
- Next: P0.T0.

### 2026-10-23 22:50 → 23:35 — session 1 (Claude, branch `claude/amazing-planck-804i13`): P0.T0 → P0.T6 code
- P0.T0: Equation I imported as one commit (314 files), docs under `docs/`, README disclosure, `.gitignore` for `server/.env` and `data/*`.
- Key check: one untrained curl through Mubit → HTTP 200, `mreq_01a16ac42b11783384f4009410fb706f`, model `claude-haiku-4-5-20251001`. A3 holds.
- P0.T1–T5 built and committed with task IDs; `npm test` 36/36 green in < 1 s.
- Evaluator numbers (Silverstone, dry): baseline 80.800 s, sectors 25.094 / 25.582 / 30.125, vmax 328.2, terminal 331.2, Becketts vmin 212.5 km/h.
  Rear wing +8°: +0.436 s, vmax 320.3, vmin 223.5 (demo premise holds). Monza rear wing +8°: +0.757 s. 10 m/s headwind on Hangar: S3 vmax 328 → 318. Wet: 83.854 s.
  Baseline is near the rear-wing optimum (−4° = +0.011 s); lower ride height 30–34 mm and small front-wing moves are where "promote" lives.
- Live smoke (`npm run smoke`): `mreq_01a16ad3ef007011968f90d4c2fe5b7e`, 2,464 ms, verdict reject, untrained. Scenario 495 chars ≈ 124 tokens.
- P0.T6: generator + `npm run collect` written; live run of 50 started 23:33 London with `--seed 1` (result below).
- **P0.T6 live result (23:33–23:34 London, Friday budget):** `npm run collect -- --n 50 --seed 1` → 50 sent, 43 ok, 7 parse_error, 0 Mubit errors, 0 illegal retries, 57.5 s at concurrency 2. `calls.jsonl`: 58 rows, 57 trained (50 + 7 retries), 1 untrained smoke; 51 unique session ids. Latency p50 1.9 s, p95 4.2 s; inputs 432–524 tokens including the system prompt (scenario ≈ 125–215). Mix: 37 dry / 11 wind / 2 wet. Verdicts: 40 reject, 3 retest, 0 promote (no random candidate beat the baseline by > 0.03 s; range −0.028 … +0.323 s). `next_parameter`: front_wing 39, rear_wing 4.
- All 7 parse errors were `hypothesis` > 160 or `reject_if` > 80 chars (the model's slips); fixed by trimming instead of rejecting (Decision 23:50). Mubit recorded those calls regardless.
- Tagged `v1-collected` at the collection commit. **Open:** console → Tasks read-out (name, kept examples, status line) by Tanuj; `/team create`.

| 2026-10-23 23:50 | `validatePlanOutput` trims overlong `hypothesis`/`reject_if` to their limits (`trimmed` flag) instead of rejecting | 7/50 live answers overran by a few words; a same-input retry at temperature 0 repeats it; the decision fields are intact | Yes |
| 2026-10-24 00:30 | D-S1 `measured` carries additive fields beyond ARCH §4.7 (per-car vmax/vmin, measured_delta, predicted_delta, measured_sector_deltas, supersedes, label) | F-04.AC3 readable off the row; §4.7 keys unchanged | Yes |
| 2026-10-24 00:30 | D-S2 `agreement_pct` is `null` when the predicted delta is 0 (UI shows n/a) | The F-04.AC2 formula divides by it | Yes |
| 2026-10-24 00:30 | D-S3 racing an `overruled`/`promoted` experiment keeps that status and gains `measured` | The engineer's verdict outranks the race | Yes |
| 2026-10-24 00:40 | D-S4 `POST /api/collect` requires `confirm: "trained"` and caps n at 60; the CLI `npm run collect` is unchanged | Trained calls spend budget and shape the task | Yes |
| 2026-10-24 00:40 | D-S5 a changed `lab/prompt.js` fails `npm test` (sha256 pin 6c5be1a3…ce6a) and blocks `npm start` unless `PURPLE_ALLOW_PROMPT_CHANGE=1` after a logged decision | G-MUBIT-01 enforced by machine, not memory | Yes |

### 2026-10-23 23:58 — console read-out (Tanuj, screenshot)
- Overview: 57 total requests, median response 1.80 s, errors 0, adapters serving 0. Tasks: 1 task **Research engineer of F1**, status **Training** ("training v1"), examples **43 kept**, requests 57, models asked claude-haiku-4-5 100 %. Task rules: "Grouped: same instructions and tools", "Named from its instructions". Figures panel said "Figures unavailable" (console hiccup, details still shown).
- P0 exit criteria pass → Phase 1 open. Integrator decision: integration branch `claude/amazing-planck-804i13`; lanes GAME, SERVER, EVAL spawned with GO; this session stays integrator.

### 2026-10-24 00:32 — integrator — merged SERVER P1.T3 (PR #2, branch `claude/server-p1-race`)
- `POST /api/race/result` validates every field (BAD_INPUT names it), writes the §4.7 measured block + agreement_pct + label, second post supersedes, SSE `race` carries the full row. `server/scripts/fake-race.js` (`npm run fake-race`) posts a seeded plausible result for the newest ledger row so the UI lane can work without the game. 41/41 tests after merge.
- SERVER lane next: task-integrity guards, P2.T3 server side, `/api/status` widget fields.

### 2026-10-24 00:40 — integrator — merged SERVER task-integrity guards (PR #3, branch `claude/server-p1-guards`)
- `test/prompt-frozen.test.js` pins the prompt hash; `server/index.js` logs it and refuses a changed prompt; `npm run prompt:check`; `/api/collect` needs `confirm: "trained"`, n ≤ 60; `store.appendCall` throws on any non-plan row without `trained: false`. 47/47 tests after merge; real-env startup prints the hash. SERVER next: P2.T3 server side, `/api/status` widget fields.
