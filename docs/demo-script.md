# PURPLE: live demo script (3 minutes)

> Status: the 24 October live demo plan, kept for history. The submission is the video: [video-script.md](video-script.md). The current product is in [README.md](../README.md).

Version 3 · 2026-10-24 · replaces v2.1 (the 5-knob research-lab demo; its beats are kept in the appendix). The story now leads with
the **concept lab**: an AI race engineer redesigns the 2026 Red Bull RB22 (same Red Bull Ford DM01, FIA 2026 Section C legal) to
beat the real 2026 Silverstone qualifying lap, with Mubit in the loop. The research lab is the first proof that Mubit learns from a
human rule. The recorded video follows `docs/video-script.md`; this file is for presenting live, with fallbacks.

**Every claim below is measured or shown on screen.** Honesty rules G-HON-01..06 (`docs/EVAL_GUARDRAILS.md` §5) apply to every
word: never the words CFD, wind tunnel, validated, aerodynamically tested; our car is a "model prediction ± band"; scores as n/N.

Source labels, verbatim, whenever a number is on screen:
- our laps: **physics lap sim · Silverstone · 2026 British GP qualifying conditions**
- real laps: **real 2026 qualifying · OpenF1 / formula1.com**
- research lab: **reduced-order lap model · calibrated to 2026 pole laps · aero map v1** (game seconds) and **measured in race, seed 42**
- game-race footage: **cinematic · game lap model, mixes car and driver**

## Facts the demo is built on

| Fact | Value | Source |
|---|---|---|
| Real 2026 Silverstone qualifying | pole ANT 88.111 s; HAD (RB22) 88.746 s, P5 | OpenF1 / formula1.com (CAMPAIGN.md) |
| RB22 baseline on the sim | 88.763 s (P6 on the real order) | CAMPAIGN.md §4.0, SIM.md §0 |
| Best legal RB22 / DM01 car | **87.235 ± 0.154 s**, 95 % 86.933–87.537; Δ pole −0.876, Δ HAD −1.511; P1 across the band | CAMPAIGN.md §4.0 |
| Same car, aero map gains halved | 87.893 s | CAMPAIGN.md §4.0 |
| Biggest per-corner gains | Stowe −0.258, Brooklands −0.215, Becketts T13 −0.212, Luffield −0.197, Village −0.163 s | CAMPAIGN.md §4.0 |
| Sim accuracy | held-out speed RMS 10.1 km/h (target < 7: missed); sector bias +0.172 / +0.015 / −0.192 s | SIM.md §0 |
| FIA checklist | 94 rows, Section C Issue 19 | FIA_CHECKLIST.md |
| Mubit designer calls (as of 09:53 UTC) | 331 trained in 16 sessions, 331 unique request ids; 13 untrained; Mubit loop best 88.292 s (seed 29, −0.471 vs 88.763) | `docs/concept/loop-runs/*` |
| Dashboard speed run | 6,740 laps in 184 s → 87.462 ± 0.136 s | DASHBOARD.md §2 |
| Garage round trip | 180–210 ms | DASHBOARD.md §5 |
| Research task | 99 trained calls; exam provider 20/20 verdicts, 10/20 next step | TASK_LOG, ledger snapshot |
| Console (owner) | designer kept **FILL designer-kept** · adapter **FILL designer-adapter** · Try models provider **FILL n/N** vs adapter **FILL n/N** | Mubit console |

## Setup (5 minutes before)

1. `npm run dev` with `MUBIT_API_KEY` in `server/.env` (not `MUBIT_MOCK`). `http://127.0.0.1:8788/concept/lab/` open, Engine panel
   closed. Second tab: the Mubit console on the designer task. Third tab: `docs/deck/purple-deck.pdf`.
2. Open Engine → Red Bull car sheet once (warms the sim, ~1 s).
3. If the network is unreliable: `MUBIT_MOCK=1 npm run dev` and **say** "this run uses the scripted stand-in; the real calls are in
   the console and in docs/concept/loop-runs/".

## Running order

| Time | Beat | Action |
|---|---|---|
| 0:00 | Hook + disclosure | concept lab, RB22, leaderboard |
| 0:20 | Mubit in the loop | Engine → Autonomous · Mubit → Start |
| 1:00 | Console | Mubit console tab |
| 1:20 | Speed run | Engine → Speed run → Start, let it run behind the garage |
| 1:40 | Garage | Engine → Garage, hot swap + illegal car |
| 2:05 | Silverstone | "watch on Silverstone →" |
| 2:35 | Result + limits | deck p. 8 / p. 11 |
| 2:55 | Close | research lab one line |

### 0:00–0:20 · Hook and disclosure (G-HON-04)

**Say:** "PURPLE is an AI race engineer. It takes Red Bull's 2026 car, keeps its Red Bull Ford engine, and redesigns it inside the
FIA 2026 rules to beat the real Silverstone pole, with Mubit in the loop. The 3D Silverstone comes from Equation I, a game our team
built before this weekend; the concept lab, the server, the physics, the Mubit loop and the tests are new this weekend."

### 0:20–1:00 · Mubit in the loop

**Do:** Engine → **Autonomous · Mubit**; LLM **live · untrained**; search laps / call 200; call budget 10; **START AUTONOMOUS
LOOP**. Point at an iteration row: `mreq_` id, proposal, measured lap and sectors, `kept` or not, "this result went to Mubit in
#k+1's request". Open the **Mubit loop** drawer and expand **exact request** on one row.

**Say:** "Each Mubit call gets the current best car and the last changes we tried with their simulated results: lap and sector
deltas, the corners that gained or lost, kept or not, and any FIA article broken. Mubit proposes the next change; the physics lap
sim measures it; only a legal, faster car is kept, and that result goes into the next call. One run is one Mubit session; every
result carries its request id."

### 1:00–1:20 · Mubit console

**Do:** console tab: designer task → kept examples; Requests → session filter = a run id (e.g. `loop-01m5pn1ahpse8bq6brfp3433bx`,
seed 29); Adapters; Try models side by side.

**Say:** "Mubit has no API to attach a result to a call, so the result travels in the next call's input. Trained calls store that
history with the next proposal: 331 trained designer calls in 16 sessions. Kept examples: **FILL designer-kept**. Adapter:
**FILL designer-adapter**. On the same scenarios, provider **FILL n/N**, adapter **FILL n/N**." (Cut any number not yet read.)

### 1:20–1:40 · Speed run

**Do:** Engine → **Speed run**, seeds `1,2,3,4`, laps per seed `1500` → **START SPEED RUN**. Show laps/s and the convergence chart
crossing the real pole line; leave it running.

**Say:** "This asks how far the physics lets the car go: a CMA-ES search over legal cars only, the engine locked, every lap on the
physics sim. We come back to the number."

### 1:40–2:05 · Garage hot swap

**Do:** Engine → **Garage**: floor width 1450 → 1540 (3D flash, per-corner bars, "FIA: legal"); sidepods material → T1100G
laminate; wheelbase → 3600: "FIA: illegal · C2.3.3", no lap; Reset to RB22. Then back to Speed run: read the MODEL PREDICTION
card (band, vs pole, vs HAD).

**Say:** "Any idea can be checked by hand: change a part or material, the 3D car rebuilds that part, the FIA check runs and every
corner updates in a fifth of a second. Break a rule and the car gets no lap."

### 2:05–2:35 · Watch on Silverstone

**Do:** **watch on Silverstone →**. Physics replay, director camera; ghosts RB22 (sim) and ANT POLE (real 2026 lap, OpenF1).
Press 4 for ×4 through the middle sector, back to 1 for Stowe and the finish.

**Say:** "Not the game driving: the simulator's own lap, replayed on the game's Silverstone, against Red Bull's baseline and the
real pole lap. The time comes from Stowe, Brooklands, Becketts and Luffield."

### 2:35–2:55 · Result and limits

**Do:** deck page 8, then page 11.

**Say:** "Best legal RB22 with the same engine: 87.235, plus or minus 0.15, against a real pole of 88.111. A model prediction, not
a real car. The simulator misses its own accuracy target, 10 km/h against 7; with our aero gains halved it still laps 87.9. The
Mubit loop alone reached 88.29; the search found the rest."

### 2:55–3:00 · Close

**Say:** "Our first Mubit task, a five-knob setup lab, showed Mubit learning from an engineer's rule. PURPLE puts that loop on a
whole car."

## Failure drills

| If | Then |
|---|---|
| Mubit gateway down | `MUBIT_MOCK=1`, say so; show the console and `docs/concept/loop-runs/trained-seed11/lineage.jsonl` (deck slide 5) |
| Speed run too slow on this laptop | laps per seed 500; or show `docs/concept/dashboard-shots/02-speed-finished.png` |
| Replay stutters | lower Graphics; or `docs/concept/race-shots/v3best-*.jpg` (candidate g37.4, 88.294 s: say so) |
| Laptop dies | second laptop has the repo, the video and the deck |

## Appendix: the research lab (first Mubit task), for questions

| Fact | Value | Source |
|---|---|---|
| Mubit task | "Research engineer of F1", `claude-haiku-4-5`, frozen prompt v1 (sha 6c5be1a3) | console, `lab/prompt.js` |
| Collection | 99 trained calls: 57 Friday (43 kept examples, Training v1), 1 demo experiment, 41 Saturday with the rule | ledger snapshot `2026-10-24_02-37-26Z-0530-windcap-exam` |
| The rule (rule-conditioned learning) | "Weigh straight-line drag against corner gain; judge on full-lap delta." enters every later task input | TASK_LOG |
| v2 collection | 40 scenarios, all five parameters; the provider's verdicts agreed with the evaluator on 38 of 39 | TASK_LOG 01:50 |
| v1 data skew | a seeding bug made 50 of 53 Friday candidates front-wing moves (fixed); the agent is not to blame for that skew | TASK_LOG 01:45 |
| Exam | provider 20/20 verdicts, 10/20 next step; Try-models sheet (8): 8/8, 2/8 (7/7, 1/7 without exam-rw8, the demo item, which is in v2's data) | snapshot `0530-windcap-exam` |
| Demo experiment | rear wing +8° at Silverstone: predicted +0.436, measured +0.518 game s (seed 42, n = 1), 19 % apart | ledger `01M5NHXH4RSEQ50VM955FK20B7` |
| Console | kept after v2 **FILL research-kept** · v1 / v2 **FILL research-adapters** · Try models v1 / v2 next step **FILL n/8 (n/7)** | console, `npm run exam:score` |

Lab URL: `http://127.0.0.1:8788/lab/`. Do not say "the agent fixates on the front wing" (the generator did); scores are n/8 and n/7,
never %. The game race there is a measurement only for baseline vs candidate; the grid race is cinematic.
