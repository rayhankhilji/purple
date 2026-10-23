# PURPLE — Product Requirements

Version 1.0 · 2026-10-23 · Profile: AI agent product + simulation, scope **hackathon demo (Night Shift, Mubit)** · Owner: Tanuj

> *Purple sector* = the fastest sector of the session. PURPLE is an autonomous F1 engineering research lab that chases purple sectors: it redesigns a car, measures it, races it, gets corrected by a human engineer, and — through Mubit — learns to choose better experiments.

## 1. Summary

PURPLE is a new layer on top of **Equation I**, an existing browser F1 game (plain JS + three.js, seven real circuits, bots calibrated to real 2026 pole laps, every real 2026 driver as a trait-indexed profile). The lab runs a four-stage research loop:

1. **DESIGN** — a research agent (an LLM routed through Mubit) proposes a setup change to a parametric car (wings, ride height, brake bias, ERS deployment).
2. **EVALUATE** — the game's own calibrated lap-time model scores the candidate in milliseconds: lap time, sector times, top speed, minimum corner speed, legality against a subset of the 2026 technical regulations.
3. **RACE** — the candidate races the baseline in the game, same neutral driver, same seed, broadcast camera, 3D car showing the actual wing angles. A second, cinematic race puts the candidate on the real 2026 grid.
4. **LEARN** — the human engineer corrects a bad research decision. The correction enters Mubit. Mubit trains a new adapter version of the research agent. The new version is compared against the old one on held-out scenarios.

The product is a **playthrough with a side panel**: not a playable game. The side panel streams numbers, model traces, Mubit task status and the experiment ledger in real time while the race runs.

The hackathon brief is "route your LLM calls through Mubit and turn corrections into model updates for a recurring task." The recurring task is **the research agent's experiment decision**. Everything else exists to make that decision visible, measurable and correctable.

## 2. Target users

| User | Job to be done | Why PURPLE |
|---|---|---|
| Night Shift judges (Mubit team) | See a correction become a model update, on a real recurring task, live | The decision has a deterministic ground truth (the lap model), so "did the correction help?" is a number, not an opinion |
| Sim-racing / Formula Student setup engineers (future) | Find a better setup without trial-and-error on track | A research agent that learns the team's engineering priors |
| Vehicle-dynamics learners (future) | See the downforce-vs-drag trade-off happen | Every experiment shows corner gain vs straight loss, per sector |

## 3. Features

Priority: P0 ships for the Saturday-midnight submission; P1 only if P0 is done and verified; P2 is a slide titled "Next".

### F-01 · Parametric car and aero map (P0)
A car setup is five bounded numbers. An aero map converts them into physics multipliers (downforce, drag, mechanical grip, braking) and a legality verdict.
- **F-01.AC1** Given a setup inside bounds, when evaluated, then `legal = true` and multipliers are returned.
- **F-01.AC2** Given `rear_wing_deg` above 35, when evaluated, then `legal = false` with reason `REG-RW-MAX` and no lap time is produced.
- **F-01.AC3** Given two setups differing only in `rear_wing_deg` (+5), when both are evaluated at Silverstone, then the higher wing has a lower top speed and a higher minimum corner speed.

### F-02 · Evaluator (P0)
The game's `buildSpeedProfile` lap model, extended to accept per-setup aero multipliers and conditions (wind, wet). Returns lap, three sectors, top speed, min corner speed, and the baseline deltas. Labelled on screen as "reduced-order lap model, calibrated to 2026 pole laps".
- **F-02.AC1** Given the baseline setup, dry, no wind, at Silverstone, when evaluated, then lap time is within ±1.0 s of the game's own `LIMIT_LAP.silverstone` (80.8 s).
- **F-02.AC2** Given any setup, when evaluated twice, then results are byte-identical (deterministic).
- **F-02.AC3** Given a 10 m/s headwind on the Hangar Straight, when evaluated, then sector 2 top speed is lower than with no wind.

### F-03 · Research agent through Mubit (P0)
One frozen task. Input: compact scenario JSON. Output: a verdict and the next experiment, as JSON. Every call goes through Mubit server-side with a per-scenario session ID. The task name, model and system prompt never change after the first call.
- **F-03.AC1** Given a scenario, when `/api/plan` is called, then the response is valid against `PlanOutput` and the Mubit `x-middleware-request-id` is stored on the ledger row.
- **F-03.AC2** Given 50 generated scenarios, when the collection script runs, then 50 rows appear in `data/calls.jsonl` and the Mubit console task shows ≥ 25 kept examples.
- **F-03.AC3** Given the agent's output is not valid JSON, when parsed, then the row is marked `parse_error`, the call is retried once, and the UI shows the error state.

### F-04 · Broadcast race, baseline vs candidate (P0)
The game runs with zero players, TV camera, two bots with identical neutral driver profiles and seed; one car carries the baseline aero, the other the candidate. Best lap and best sectors per car are posted back to the lab.
- **F-04.AC1** Given a candidate, when "Race it" is pressed, then the game opens in broadcast mode with both cars and finishes 3 laps without input.
- **F-04.AC2** Given the race finishes, when results post, then the ledger row gains `measured.lap`, `measured.sectors` for both cars and `agreement_pct = 100·|measured Δ − predicted Δ| / |predicted Δ|` is shown.
- **F-04.AC3** Given the candidate has more rear wing, when the race runs, then its minimum speed through Maggotts–Becketts is higher and its Hangar Straight top speed is lower than the baseline's (telemetry sampled from the replay recorder).

### F-05 · Correction loop (P0)
The engineer overrules a research decision in the side panel. The overrule becomes a pit-wall rule, is written to the Mubit console as a correction (if the console offers one) and is included in every subsequent scenario input. The ledger shows which decisions were made before and after each rule.
- **F-05.AC1** Given a decision, when "Overrule" is submitted with a verdict and a reason, then `data/rules.json` gains a rule with `created_at`, and every later `/api/plan` input contains it.
- **F-05.AC2** Given a rule exists, when 40 further scenarios are collected, then the Mubit task shows a new adapter version (v2) in the console.
- **F-05.AC3** Given v1 and v2 exist, when the held-out exam scenario "Silverstone, rear wing +8°" is sent to both in Try models, then v2's verdict is `reject` and v1's is `promote` (screenshot captured for the deck).

### F-06 · Side panel and ledger (P0)
Four stage cards (DESIGN / EVALUATE / RACE / LEARN), a live trace stream of every Mubit call (input summary, verdict, request ID, latency), the model-status widget (task name, kept examples, adapter version, test result — copied from the console), and the experiment ledger table.
- **F-06.AC1** Given the lab page loads with no experiments, when rendered, then each card shows its empty state and the ledger shows "No experiments yet — run one".
- **F-06.AC2** Given `/api/plan` is in flight, when rendered, then the DESIGN card shows a loading state and the trace stream shows the pending call.
- **F-06.AC3** Given the server is down, when any action is pressed, then an error banner names the failed endpoint and the action is re-enabled.

### F-07 · 3D car view (P0)
The game's procedural car model rendered in its own scene inside the lab page. Front-wing and rear-wing angle of attack and ride height update the mesh live when a candidate is selected.
- **F-07.AC1** Given a candidate with `rear_wing_deg = 30`, when selected, then the rear main plane's angle visibly changes relative to the baseline within 200 ms.

### F-08 · Exam: decision quality score (P1)
Twenty fixed scenarios whose correct verdict is derived from the evaluator. The provider model is scored automatically; adapter versions are scored by hand in Try models (8–10 scenarios) and entered into the widget.
- **F-08.AC1** Given the exam runs on the provider model, when complete, then the widget shows `provider: n/20`.

### F-09 · Fast refresh: regulation change or circuit switch (P1)
A "technical directive" button caps `rear_wing_deg` at 20, or the objective switches to Monza. The task keeps collecting; the widget shows the new examples counting toward the next version.
- **F-09.AC1** Given the directive is active, when the agent proposes 25°, then the evaluator returns `legal = false, reason = TD-01` and the trace marks the decision as a violation.

### F-10 · Grid race (P1)
The candidate car with a real 2026 driver profile races the full 2026 grid at Silverstone, broadcast camera, for the cinematic close. Clearly labelled "cinematic — mixes car and driver".

### F-11 · Free-form bodywork, CFD, seasons, tyre temperature (P2)
Slides only.

## 4. Out of scope

- Real aerodynamic validation, CFD, Blender, mesh generation. The aero map is a documented reduced-order model.
- Training driver models. Drivers are profiles from real 2026 data already in the game.
- Calling a Mubit adapter from the app (not possible; adapters run only in Try models).
- Mubit memory/patterns SDK. Only the gateway + adapters.
- Accounts, auth, multi-user, hosting beyond the demo laptop + the existing Vercel static site.
- Changing the game's calibration constants globally. Aero is per-car and opt-in.
- Any circuit other than Silverstone (P0) and Monza (P1).

## 5. Success metrics

| Metric | Target | How measured |
|---|---|---|
| End-to-end loop live | Design → Evaluate → Race → Correct → Mubit v2 → Try models comparison, in one 3-minute run | Rehearsed twice Saturday evening, recorded once |
| Mubit kept examples before v1 | ≥ 25 by Sat 01:00 London; v1 trained by Sat 12:00 | Console |
| Adapter v2 after correction | Trained by Sat 20:00 | Console |
| Evaluator–race agreement | measured Δ within 25 % of predicted Δ for the demo candidate | Ledger `agreement_pct` |
| Decision quality | v2 beats v1 on the held-out exam (hand-scored, ≥ 8 scenarios) | Widget |
| Submission | MP4 ≤ 3 min + PDF deck uploaded via `/submit` by Sat 23:59; hard freeze Sun 05:00 | Discord |
| Check-ins | `/checkin` by Sat 12:00 and between 12:00–18:00, each naming the Mubit task, kept examples and adapter version | Discord #max |

## 6. Assumptions

| # | Assumption | Default if wrong |
|---|---|---|
| A1 | Mubit workspace has training on (console shows **Adapters**) | Ask Eldar/Anil in person tonight; nothing else works without it |
| A2 | Console offers a per-task Corrections/Rules field (Eldar: "corrections are made in the Mubit console") | Rule lives only in the user message; still a model update once v2 trains |
| A3 | `claude-haiku-4-5` is served on the starter credit | Use `gpt-6-luna` via the OpenAI path, change nothing else, before the first call |
| A4 | A planner call of ≤ 350 input tokens is short enough to be a kept example | Shrink scenario JSON further; drop the history array |
| A5 | Daily training budget allows v1 (Fri UTC day) and v2 (Sat UTC day) | If v1 slips past 01:00 London, push collection harder Saturday morning |
| A6 | The game runs headless-ish in a hidden iframe at 1× speed; 3 laps ≈ 4.5 min | Reduce to 2 laps for the demo race; evaluator supplies the numbers first |
| A7 | Equation I is allowed as pre-existing tooling (rules: "your own tooling is fine") | State it on slide 2 and in README; the lab is 100 % new code |

## 7. Open questions

| Q | Owner | Default | Decide by |
|---|---|---|---|
| Does a console correction get injected into live calls, and is it part of the task key? | Dev lead, ask Eldar at the venue | Assume injected, not part of key; keep the rule in the user message too | Sat 10:00 |
| Try models daily call cap for our org | Dev lead | Budget 12 calls for the exam, 4 for rehearsal, 4 for the live demo | Sat 18:00 |
