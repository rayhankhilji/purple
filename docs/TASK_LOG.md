# PURPLE — Task Log

Version 1.1 · Started 2026-10-23 22:45 London · Update after every task. This file is the team's memory across sessions.
Multi-agent rule (decision 2026-10-23 23:20): lane agents write `docs/agents/lanes/<lane>.md`; only the integrator edits this file and `docs/agents/HANDOVER.md` when merging. See `docs/agents/PARALLEL_PLAN.md`.

## Status

| Field | Value |
|---|---|
| Current phase | **P2 — The lab you can watch** (P1 exit criteria met 01:25: demo experiment raced in the ledger, 19 % agreement; v1 training). P1.T4/T5 remain human items |
| Mubit task name | **Research engineer of F1** (console label; prompt "You are the research engineer of an F1 setup lab"; "Grouped: same instructions and tools") |
| Model | `claude-haiku-4-5` (served by Mubit as `claude-haiku-4-5-20251001`; PRD A3 fallback not needed) |
| Prompt | `lab/prompt.js` PROMPT_VERSION 1, 851 chars ≈ 210 tokens; scenario inputs 120–180 tokens |
| Kept examples | 43 kept of 57 requests at 23:58 (v1); 99 trained calls sent in total after v2 at 01:50 (console count pending) |
| Adapter version / result | v1 training since 23:58; v2 examples collected 01:50 (40 scenarios, rule R-01, promote-biased) |
| Next deadline | `/checkin` #1 by Sat 12:00 (text in docs/checkins/checkin-1.md); `/checkin` #2 12:00–18:00; `/submit` by Sat 23:59 |

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

- [x] P1.T1 (F-04) `js/car.js` per-car `aero` (GAME, merged 01:15 from PR #7)
- [x] P1.T2 (F-04) broadcast mode `?lab=1&exp=&seed=&laps=&circuit=&baseline=&candidate=&mult_baseline=&mult_candidate=`, two neutral bots, TV camera, auto-start, `purple:result` postMessage (GAME, merged 01:15 from PR #8). **Headless race, seed 42, rear wing +8°: baseline 80.742 s / vmax 325.2 / Becketts 201.7; candidate 81.260 s / 315.8 / 211.5 → measured Δ +0.518 s vs predicted +0.436 s, agreement 19 % (target ≤ 25 %). Seeds 7 / 1234: Δ +0.515 / +0.696. T-F04-AC3 holds on every seed.**
- [x] P1.T3 (F-04) `POST /api/race/result` hardened, `agreement_pct`, SSE `race`, `npm run fake-race` (SERVER lane, merged 00:32 from PR #2; 41/41 tests)
- [ ] P1.T4 watch v1 in **Adapters** (Tanuj screenshot → `status.json`); if Below target / Prompt only → `npm run collect -- --n 30` on the Saturday budget
- [ ] P1.T5 `/checkin` #1 in #max by Sat 12:00 (Tanuj) — text drafted in `docs/checkins/checkin-1.md`

## Checklist (P3 items already landed)

- [x] P3.T3 (F-10) grid race: `index.html?lab=1&mode=grid&exp=&driver=<2026 code>&candidate=&mult_candidate=&seed=&laps=2&circuit=silverstone`, candidate car with a real 2026 driver on the 22-car Official-pace grid, on-screen caption "Cinematic · mixes car and driver · …" (G-HON-05), posts `purple:grid` (GAME, merged 02:15 from PR #11; headless: VER rear wing +8°, seed 42, P7 → P14, best 91.215 s, 2 laps, 22 classified)

## Checklist (P2 items already landed)

- [x] P2.T3 server side: `POST /api/overrule` hardened (text collapsed/cut at 160, R-xx by max id, response { rule, experiment }, SSE rule then plan), `GET /api/rules?active=1`, boolean toggle (SERVER, merged 01:05 from PR #5). UI side open.
- [x] Status widget plumbing: `GET /api/status` + SSE status carry `prompt_hash`, `last_console_read_at`, `budget { day_utc, trained_today_utc, untrained_today_utc, resets_at }` (SERVER, merged 01:05 from PR #6).

- [x] P2.T5 data + F-08.AC1: `data/exam.json` (20 scenarios), `npm run exam:build`; **`npm run exam` on the provider (untrained, 00:55): verdicts 20/20, next-parameter+direction 10/20** → widget `exam.provider = 20`, `exam.provider_param = 10`.
- [x] P2.T6 model side: TD-01 + wind/wet semantics verified, `aero.describeViolation` (EVAL). UI side (sliders, toggles) still open.

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
| 2026-10-24 00:50 | D-E1 `MIX.promote_bias` in the generator (default 0, v1 seeds byte-identical); **v2 collection runs with 0.3** (every faster move at Silverstone lowers ride height: 97 of 948 menu moves) | v1 never saw a correct promote (0 of 50) | Yes |
| 2026-10-24 00:50 | D-E2 exam truth: tie-break + ≥ 0.003 s margin filter for filler items; 20 items = 4 promote / 5 retest / 11 reject, 3 wind, 2 wet, 2 Monza; `exam-rw8` truth reject/rear_wing_deg/decrease | ARCH §4.10; rebuild with `npm run exam:build` | Yes |
| 2026-10-24 00:50 | D-E3 TD-01 constrains candidates; a grandfathered baseline above the cap is still evaluated; a baseline outside the regulation throws instead of NaN deltas | F-09 semantics | Yes |
| 2026-10-24 00:50 | D-E4 `aero.describeViolation(id)` is the UI's label source; numbers come from `RANGES` | label and check cannot disagree | Yes |
| 2026-10-24 01:05 | Decisions proposed (for the integrator to log in TASK_LOG): D-S9: budget counters are per UTC calendar day of `calls.jsonl` rows (matches ROADMAP "00:00 UTC = 01:00 London"); D-S10: `last_console_read_at` is stamped server-side on any console-field update (add | SERVER lane, merged PR #5/#6 | Yes |
| 2026-10-24 01:05 | Decisions proposed (for the integrator to log in TASK_LOG): D-S6: `/api/overrule` returns `{ rule, experiment }` (additive); D-S7: `POST /api/rules/:id` requires a boolean `active` (was `!!active`); D-S8: `GET /api/rules?active=1/0` added (additive to ARCH §5) | SERVER lane, merged PR #5/#6 | Yes |
| 2026-10-24 01:10 | D-S11 ledger `candidate_source` = "random-biased" when the candidate came from the promote class; `npm run collect -- --promote-bias 0.3` and `POST /api/collect { promote_bias }` wired; bias 0 reproduces v1 exactly | v2 collection command is final | Yes |
| 2026-10-24 01:15 | D-G1 `car.aero` is `null` unless supplied (ARCH §9 said `opts.aero || {1,1,1,1}`) | js/ai.js treats any aero object as aero-on and caps at terminal speed; a neutral object moved every shipped bot's lap 83.242 → 83.333 s. Null keeps the game byte-identical | Yes |
| 2026-10-24 01:15 | D-G2 Becketts telemetry window = s 3,600–4,200 m (ARCH §9 said 2,850–3,250, which is Woodcote–National Pits); matches `aero.REF_CORNER` | Corner table in js/data/silverstone.js | Yes |
| 2026-10-24 01:15 | ARCH §6 step 7 URL gains `exp=` (experiment id) and `mult_baseline`/`mult_candidate` (precomputed multipliers; the game page does not load lab/aero.js) | The result must carry the experiment id back | Yes |
| 2026-10-24 01:45 | Scenario seeds are mixed (splitmix step) and the rng warmed by 16 draws (`seededRng` in server/app.js) before the generator uses it | The game's xorshift `U.rng` returns ≈ 0.124 as the first draw for neighbouring integer seeds; with consecutive collect seeds every v1 candidate's first pick was keys[0] = front wing (50 of 53 ledger rows) and a promote_bias coin would always land | Yes (v1 data stays as collected) |
| 2026-10-24 02:00 | D-E5 Try-models sheet ranks the 8 hardest exam items by margin to the verdict thresholds, exam-rw8 always included (`npm run exam:sheet` → docs/try-models/sheet.md) | P3.T1 needs paste-ready inputs | Yes |
| 2026-10-24 02:00 | D-E6 `perturb` burns 8 rng draws when promote_bias > 0 (RNG_WARM); plus D-S12 per-item seed mixer `itemSeed` in `collect()`/`dryCollect()`; plus the integrator's 16-draw `seededRng` on every seeded rng. Three layers against the same xorshift first-draw defect; v2 rows replay from their own seed only with all three | Belt and braces; all v2 rows were produced before D-E6/D-S12 landed, so replaying a v2 row needs commit 2c23957's code (noted, not needed) | Yes |
| 2026-10-24 02:00 | CORS: `app.use("/api/*", cors({ origin: 127.0.0.1/localhost on any port }))` with `x-client-id` allowed | The lab page (:8788) could not call the API (:8787) in a real browser; found by the UI lane | Yes |
| 2026-10-24 02:15 | **Canonical seeded rng = `scenarios.seededRng(U, seed)`** (murmur3-finaliser mix + 16 discards); app.js imports it, its local copy and the `itemSeed` mixer are gone; per-item seed = seed0·1000 + i. It is byte-identical to the code the v2 collection ran on, so every v2 row replays exactly from its own seed | Three lanes fixed the same defect three ways; one copy, and v2 reproducibility | Yes |

### 2026-10-23 23:58 — console read-out (Tanuj, screenshot)
- Overview: 57 total requests, median response 1.80 s, errors 0, adapters serving 0. Tasks: 1 task **Research engineer of F1**, status **Training** ("training v1"), examples **43 kept**, requests 57, models asked claude-haiku-4-5 100 %. Task rules: "Grouped: same instructions and tools", "Named from its instructions". Figures panel said "Figures unavailable" (console hiccup, details still shown).
- P0 exit criteria pass → Phase 1 open. Integrator decision: integration branch `claude/amazing-planck-804i13`; lanes GAME, SERVER, EVAL spawned with GO; this session stays integrator.

### 2026-10-24 00:32 — integrator — merged SERVER P1.T3 (PR #2, branch `claude/server-p1-race`)
- `POST /api/race/result` validates every field (BAD_INPUT names it), writes the §4.7 measured block + agreement_pct + label, second post supersedes, SSE `race` carries the full row. `server/scripts/fake-race.js` (`npm run fake-race`) posts a seeded plausible result for the newest ledger row so the UI lane can work without the game. 41/41 tests after merge.
- SERVER lane next: task-integrity guards, P2.T3 server side, `/api/status` widget fields.

### 2026-10-24 00:40 — integrator — merged SERVER task-integrity guards (PR #3, branch `claude/server-p1-guards`)
- `test/prompt-frozen.test.js` pins the prompt hash; `server/index.js` logs it and refuses a changed prompt; `npm run prompt:check`; `/api/collect` needs `confirm: "trained"`, n ≤ 60; `store.appendCall` throws on any non-plan row without `trained: false`. 47/47 tests after merge; real-env startup prints the hash. SERVER next: P2.T3 server side, `/api/status` widget fields.

### 2026-10-24 00:50 — integrator — merged EVAL P2.T5 + P2.T6 (PR #4, branch `claude/eval-p2-exam`)
- `buildExam` + CLI, `data/exam.json` committed (20 items), generator `promote_bias` (opt-in), TD-01/conditions tests, `describeViolation`. 58/58 tests after merge. Asked SERVER to wire `--promote-bias` into `collect.js`/`app.js collect()`. Lane files: restored GAME.md status line to the original so the GAME lane's PR merges cleanly (integrator no longer edits lane files).

### 2026-10-24 00:55 — integrator — provider exam (20 untrained calls, `npm run exam`)
- **Verdicts 20/20. Next experiment (parameter + direction) 10/20.** Latency 1.7–2.8 s, all `mreq_` ids in calls.jsonl with `trained: false`. `status.json.exam = { provider: 20, total: 20, provider_param: 10 }`.
- **Strategic finding for the demo and deck:** the frozen prompt states the verdict thresholds, so the provider (and therefore v1) already gets every verdict right; PRD F-05.AC3's "v2 reject / v1 promote on rear wing +8°" will not materialise on the verdict. The learnable, correctable part is the **next experiment**: today the agent proposes front-wing moves 39 times out of 43 and is right half the time. The pit-wall rule ("Weigh straight-line drag against corner gain; judge on full-lap delta.") and the promote-biased v2 collection target exactly that. Score and show the exam as two numbers, verdict n/20 and next-step n/20 (G-HON-06: with n, never %), and make the Try-models comparison (P3.T1) about the next step. DEMO lane to pick this up; demo-script 1:30–2:05 needs rewording.

### 2026-10-24 01:05 — integrator — merged SERVER PR #5 (P2.T3 server side) and PR #6 (status widget fields)
- 63/63 tests after both. Live status view: kept 43, exam provider 20/20 verdicts · 10/20 next-step, budget 57 trained / 21 untrained on the Friday UTC day, prompt hash 6c5be1a3. SERVER lane next: `--promote-bias` plumbing for the v2 collection, then review of GAME's P1.T2 payload.

### 2026-10-24 01:10 — integrator — merged SERVER promote-bias plumbing (PR #6 update). 65/65 tests. **v2 collection command (Saturday budget, after the demo correction P2.T4):** `npm run collect -- --n 40 --with-rules --promote-bias 0.3`.

### 2026-10-24 01:15 — integrator — merged GAME P1.T1 + P1.T2 (PR #7, #8; branch `claude/game-p1-aero-broadcast`)
- **P1 exit sentence is true in the headless race:** "the candidate with +8° rear wing was predicted +0.436 s and measured +0.518 s" (seed 42, agreement 19 %). It is not yet in `ledger.jsonl`: that needs the UI's Race it → postMessage → `POST /api/race/result` path, or `npm run fake-race` for a stand-in. 65/65 tests. GAME's Playwright browser run (software GL) still finishing; numbers to follow in the lane file.

### 2026-10-24 01:25 — integrator — the demo experiment is in the ledger (P1 exit criterion)
- `POST /api/plan` with candidate rear wing +8°, seed 42, dry Silverstone (1 trained call) → experiment **01M5NHXH4RSEQ50VM955FK20B7**, agent said reject / next rear_wing_deg decrease 4. Then `POST /api/race/result` with GAME's headless race numbers for the same setups and seed 42 (baseline 80.742 / 24.683 / 25.771 / 30.268 / 325.2 / 201.7; candidate 81.260 / 24.927 / 25.950 / 30.377 / 315.8 / 211.5) → `measured_delta` +0.518, `predicted_delta` +0.436, **`agreement_pct` 19**, status raced, label "measured in race, seed 42". The ROADMAP P1 exit sentence is now literally true in `ledger.jsonl`. The browser-iframe path (UI Race it → postMessage) will append a superseding row when it runs.
- `docs/checkins/checkin-1.md` drafted for Tanuj to paste into #max before 12:00 (two brackets to fill from the Adapters tab).

### 2026-10-24 01:45 — integrator — PRNG finding, rule R-01, v2 collection started
- **Finding:** the v1 collection's candidates were 94 % front-wing moves (50 of 53 ledger rows touch `front_wing_deg`), not by design: `U.rng(seed)` (the game's xorshift) gives the same first draw (≈ 0.124) for consecutive seeds, and `collect()` used `seed0·1000 + i`. So the agent's "front-wing fixation" in v1 is partly the data it was shown; the clean measure of its next-step quality is the exam (10/20). Fixed with `seededRng` (mixed seed + 16-draw warm-up) in `server/app.js` for both `/api/plan` random candidates and `collect()`. Dry run through the real path, 40 @ promote_bias 0.3, seed 2: truth mix promote 14 / retest 12 / reject 14; parameters bb 14 / rh 15 / ers 10 / fw 9 / rw 8; conditions dry 27 / wet 8 / wind 5; 8 rows promote-biased. Tests 65/65 after updating two SERVER tests (agreement tolerance ±1 for 3-dp rounding; bias replay uses `seededRng`).
- **Rule R-01** created via `POST /api/overrule` on the demo experiment: "Weigh straight-line drag against corner gain; judge on full-lap delta." (active). The UI demo will re-enact the overrule live; the rule is already in every scenario.
- **v2 collection started 01:47 London on the Saturday UTC budget:** `npm run collect -- --n 40 --with-rules --promote-bias 0.3 --seed 2` (log in the integrator's scratchpad; result appended below when done).

### 2026-10-24 01:50 — integrator — v2 collection done (Saturday UTC budget)
- `npm run collect -- --n 40 --with-rules --promote-bias 0.3 --seed 2` → 40 sent, 39 ok, 1 parse_error, 0 Mubit errors, 8 promote-biased, 40.4 s. **calls.jsonl: 120 rows, 99 trained** (57 v1 + 1 demo + 41 v2). Every v2 scenario carried rule R-01.
- Evaluator truth of the 40: promote 14 / retest 12 / reject 14. Agent verdicts: promote 14 / retest 10 / reject 15, agreeing with the truth on 38 of 39. Agent next_parameter: ride_height 13, rear_wing 11, front_wing 7, brake_bias 6, ers 2 (v1: front_wing 39 of 43). Candidates spanned all five parameters.
- Tagged `v2-collected` locally on this commit (tag pushes are refused for the agent credential; Tanuj pushes it from a laptop or it rides PR #1). **Open: console → Tasks kept-examples count (expect ≈ 80) and Adapters for v2 (Tanuj).**
- Status: v1 training since 23:58; v2 examples in. Remaining P2: UI (P2.T1/T6), 3D car (P2.T2), live overrule re-enactment (P2.T4 UI side), `/checkin` #2.

### 2026-10-24 02:00 — integrator — merged EVAL PR #9 (try-sheet, dry run, Monza) and SERVER PR #10 (collect-dry, per-item seed mixer); CORS fix
- Resolved the app.js overlap by keeping both the per-item `itemSeed` mixer and the 16-draw warm-up (`seededRng`) on every seeded rng, so `npm run collect:dry` previews exactly what `collect()` sends. Added CORS for the lab page with a test. `npm run exam:sheet`, `npm run collect:dry` in package.json. 69/69 tests. SERVER's payload review of GAME PR #8: passes the validator as posted; UI must put `&exp=<id>` on the Race-it URL.

### 2026-10-24 02:15 — integrator — merged EVAL PR #9 update and GAME PR #11; one seeded rng
- app.js now imports `scenarios.seededRng`; `itemSeed` removed; SERVER's re-based PR #10 branch is superseded by the integration branch (same semantics). 71/71 tests. v2 rows replay exactly with the canonical helper (checked against the ledger).
- GAME's P1.T2 browser-run numbers still pending (software GL, very slow); headless numbers stand.

### 2026-10-24 02:25 — integrator session 1 — handover
- Merged CAR3D PR #12 (3D car view; T-F07-AC1 10.8 ms; game default geometry hash-identical). 71/71.
- Froze `data/` into `docs/ledger-snapshot/2026-10-24T0215-after-v2/` (93 ledger rows, 120 calls). **The next integrator restores it first.**
- Wrote `docs/agents/INTEGRATOR_PROMPT.md`; HANDOVER §1 rewritten as the live state (lane session ids, pending work, human items). Session 1's check-in trigger cancelled; lanes still address session 1 until the new integrator introduces itself.
- CAR3D decisions D-C1..D-C4 are in docs/agents/lanes/CAR3D.md and still need copying into the Decisions table (next integrator).
