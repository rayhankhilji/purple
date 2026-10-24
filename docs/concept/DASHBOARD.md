# PURPLE · ENGINE DASHBOARD (run the whole concept engine from the concept lab)

Version 1 · 2026-10-24 · branch `claude/engine-dashboard` · status: **built, tested with the scripted mock and an injected stand-in
for `server/mubit.js`; no live Mubit call was made by this work.**
Label on every lap: **"physics lap sim · quasi-steady-state point mass · Silverstone · 2026 British GP qualifying conditions"**;
every leaderboard time: **"real 2026 British GP qualifying · OpenF1 / formula1.com (js/data/racepace2026.js)"**. Our car is always a
model prediction ± band, never a claim about a real car.

## 1. Open it

```bash
MUBIT_MOCK=1 npm run dev          # API :8787 + static :8788 (no network; the designer is the scripted stand-in)
# open http://127.0.0.1:8788/concept/lab/  → header button "Engine"   (or ?engine=speed | auto | garage | sheet)
```

Without `MUBIT_MOCK` (key in `server/.env`) the autonomous mode also offers live calls. One engine run at a time; the page re-attaches
to a running run after a reload (`GET /api/concept/engine/info` → `active`). The browser never calls Mubit.

| Tab | Exact clicks |
|---|---|
| **Speed run** | Engine → Speed run → seeds `1,2,3,4`, laps per seed `1500`, baseline, refinement laps → **START SPEED RUN**. **STOP** at any time: the run ends after its current batch (≤ λ laps) and the best car so far is still re-scored. "continuous until Stop" keeps adding seeds. |
| **Autonomous · Mubit** | Engine → Autonomous · Mubit → LLM `mock` (default), search laps / call, scope, stop conditions (lap ≤ target, no gain for N, call budget, max iterations) → **START AUTONOMOUS LOOP** → **STOP** any time. Trained: LLM `live · TRAINED` → tick "I want trained calls" → type `TRAIN <call budget>` (≤ 30) → Start. |
| **Garage** | Engine → Garage → drag a slider (commit on release) or type a value, or pick a material (permitted ones only). Undo · Reset to RB22 · **Send this car to Mubit →** (the autonomous tab then starts from it: "start from: the garage car"). 3D modes: solid · x-ray mass · materials. |
| **Red Bull car sheet** | Engine → Red Bull car sheet (measured on open, ≈ 1 s). |

## 2. Speed run (no LLM)

The CMA-ES campaign of `docs/concept/CAMPAIGN.md` (`concept/campaign/run.js`, unchanged method) on the server's worker threads, with
three hooks added for the dashboard (none changes a result: `test/concept-campaign.test.js` still proves 0 and 2 workers identical):
`onProgress` (per generation / refinement step / phase), `shouldStop` (checked between batches) and `timer` (legality and surrogate
timings; the pool reports each lap's bench time inside its worker). Streamed live: physics laps, laps/s (last 3 s; average over the
run at the end), best legal lap, Δ baseline, Δ real pole, the phase (seed · restart · generation · legal in batch), the convergence
chart (best legal lap vs physics laps), the best car's changed parameters. **Final**: the campaign's own `report()`: a fresh physics
lap of the final design (equal to a direct `sim.simulateLap` call or the run fails), the uncertainty band (`uncertainty.js`: transfer
error of sector changes, fit residual RMS, sim noise measured on the car; surrogate 0), verdicts vs pole / HAD, grid range, the full
legality report (pass / FAIL / not enforced yet), the PU identical to the homologated DM01. Run folder: `<os tmp>/purple-engine/<run
id>/` (`events.jsonl`, `campaign.json`, `summary.md`, `run.json`), never `data/`.

Measured here (4 CPUs shared with other jobs, load average 10-16, headless browser open): seeds 1-4 × 1,500 laps + 600 refinement
= **6,740 physics laps in 184 s (37 laps/s average)** → RB22 concept **87.462 s ± 0.136 (1σ), 95 % band 87.196-87.728 s**, P1 on the
real 2026 Q order (95 %: P1-P1), every check passes. CAMPAIGN.md's full run (44,810 laps) measured 58-82 laps/s on a quieter machine.

## 3. Autonomous mode (the hybrid self-improving Mubit loop)

Mubit sets the direction, the fast search exploits it. One iteration:

1. the designer task (`concept/designer/loop.js`, the existing loop; frozen prompt v1, `concept/designer/prompt.js` untouched) gets
   the current best car and the last measured results (`scenario.js`, unchanged) and proposes 1-3 parameter changes;
2. **local search** (`concept/campaign/local.js`, new): up to *search laps / call* physics laps (default 200) around the proposal,
   legal cars only, on the worker pool: the proposal's own direction (t = 0.25 … 3, t = 1 is the proposal), then coordinate moves
   (± 1-16 steps) on the proposed parameters and the improving ones combined; scope `wide` adds a small CMA-ES (σ 0.04) on all 23
   parameters for the remaining budget. Deterministic per (parent, proposal, seed). Never slower than the proposal itself;
3. the bench measures the searched car against its parent: **kept = legal && faster** (`concept/optimize.js`, numbers only);
4. that measured row is the last `tested` row of the next call's input (the loop's existing `fed_to` chain).

**Stops** on whichever comes first: Stop, best lap ≤ target, N iterations without a kept change, the call budget, max iterations.
A refused answer (parse / duplicate / illegal) or a paused designer (3 failures in a row) falls back to one seeded step, which the
search refines too; the row says `fallback` and "no call" when no call was made. **Final**: the best car re-scored on the physics sim
(direct `sim.simulateLap` = bench lap) with the same uncertainty band as the campaign.

**What changes in the call's input (integrator: read this).** `scenario.js` is not changed and builds the same JSON; but in hybrid
mode the `tested[].change` row is the **refined** change the bench measured (parent → searched car), not the literal proposal, and
`best` moves further per iteration. With scope `proposal` (default) the refined change touches only the proposed parameters, so rows
stay 1-3 parameters; with scope `wide` a row can list many parameters and `fit()` then drops older rows to stay ≤ 1,800 chars. The
UI shows both (proposal and measured change) per iteration; the lineage row carries `search` (proposal, refined, laps, laps' lap
before / after). With search laps 0 the loop is exactly the old loop.

**Calls and budget.** Every LLM call goes through `server/mubit.js` (`server/concept.js designerLlm`, designer task, session = run
id); `mock` uses the loop's scripted stand-in and sends nothing. Untrained live calls carry `x-middleware-record: metadata`.
**Trained** needs, all on the server: `llm: "live"`, `trained: true`, `confirm: "trained"`, `confirm_text: "TRAIN <max_calls>"`,
`max_calls ≤ 30` (hard per-run cap; the run stops at it and the caller refuses call n+1), and `max_calls ≤` the remaining project budget.
The budget (250 trained calls) is **counted from files, never a constant**: rows with `trained: true` in `data/calls.jsonl` (research
agent), `docs/concept/loop-runs/trained-*/calls.jsonl` (designer runs) and the server's `concept-loops/` and `concept-engine/` run
folders, de-duplicated by `x-middleware-request-id`. In the main checkout today that is 99 research + 60 designer = **159 / 250**
(this worktree has no `data/calls.jsonl`, so it shows 60). Run folders: mock → `<os tmp>/purple-engine/<id>/`; live →
`<data dir>/concept-engine/<id>/` (`calls.jsonl`, `events.jsonl`, `lineage.jsonl`, `run.json`), so the counter sees them.

Mock run here (seed 1, 200 search laps / call, stop after 8 iterations without gain): 22 iterations, 13 designer calls, 762 physics
laps, best 88.255 s ± 0.053 (from the RB22's 88.752 s); stop reason "no improvement for 8 iterations". The scripted mock says
nothing about Haiku or an adapter.

## 4. Garage

`POST /api/concept/engine/garage/lap { team, params }`: the design is the RB22 baseline with every differing parameter (and
`params[part].material`, permitted materials only: `space.materialOptions` ∩ the part's form) applied. Returned: the FIA verdict with
articles (`regs.check` + PU / material guards; the bench never laps an illegal car), lap, sectors and their deltas vs the baseline,
the per-corner deltas (`sim.contributions(car, baseline)`, corner zones and straights, sum = lap Δ), grid slot, the legal range of
all 23 parameters for this car (`designer/scenario.js ranges()`: bisection on `regs.check` for combined limits, FIA article or model
rule at each end; for an illegal car only the single-number limits), and the server timings. The slider track is the model domain,
the bright band the legal range now, the tick the RB22 value. The 3D car (view v3, `EI.conceptView`) rebuilds only the changed parts
and tags the last change; modes solid / x-ray mass / materials.

## 5. Stage timings strip ("how fast is this")

Measured live, mean / p95 / n (`GET /api/concept/engine/timings`, last 400 samples per stage; the browser adds its own two):

| Stage | What is timed | Measured here (loaded machine) |
|---|---|---|
| legality check | `regs` checks + PU / material guards on one car, main thread | 0.13-0.9 ms |
| physics lap | one `bench()` (legality + PhysicalCar + lap) in a worker; garage: main thread, cache misses only | 56-97 ms mean (p95 ≈ 260 ms) |
| surrogate prediction | `predictLap` for one car (pre-screen only) | 0.01-0.27 ms |
| 3D rebuild | `EI.conceptView.setDesign` in the browser | 33-245 ms (headless SwiftShader) |
| Mubit call | designer call latency (mock: the stand-in; the untrained live runs took 3-4 s per call) | 0.35-0.54 ms (mock) |
| local-search batch | one batch of physics laps on the pool | 155-290 ms |
| per-corner deltas | `sim.contributions` (two traced laps) | 126-138 ms |
| legal ranges | `ranges()` for 23 parameters | 12-18 ms |
| garage round trip | click to answer in the browser (HTTP + all of the above) | 180-210 ms |

The line under the strip turns the measured rate into "1,000 laps ≈ … s · a 5,000-lap seed ≈ … min" for this machine.

## 6. Red Bull car sheet

`GET /api/concept/engine/carsheet?team=redbull`: every number the physics sim reads for the RB22 / Red Bull Ford DM01 baseline
(`physical(design.baseline({ team: "redbull" }))`, `sim.MODEL`, `sim.REGS`, the fit): mass, minimum mass, fuel, CoG height and x,
weight distribution, wheelbase, tracks, ICE / MGU-K power and taper, fuel energy flow, ERS efficiency, ES window, recharge cap and the
Silverstone Q limit, deploy, super-clip power, gears, rpm per km/h and km/h per 1000 rpm, max rpm, drivetrain efficiency, rolling
radius, brake limit, μx, μy, load sensitivity, CLA / CDA in corner and straight mode, drag ratio, aero balance, ride height and its
sensitivity, stall margin, Crr, rotating-mass factor, air density; each with its source text and a flag **FIA** (regulation or FIA
event document), **EST** (estimated from public data) or **MODEL** (assumption / concept model). Plus the fit check (sim 88.747 s vs
HAD's real 88.746 s, held-out sector residuals and trace RMS) and **how a part moves the lap**: for each of the 23 parameters the
mechanism and expected effect from `COUPLING.md` §2 and the Δlap at ± 10 % **measured on open** on the current sim (illegal = no lap).

## 7. API

| Route | |
|---|---|
| `GET /api/concept/engine/info` | limits, cpus, active run, budget, prompt version, real Q order |
| `GET /api/concept/engine/budget` · `/timings` · `/carsheet?team=` · `/garage/init?team=` | |
| `POST /api/concept/engine/garage/lap` | `{ team, params }` |
| `POST /api/concept/engine/run` | `{ mode: "speed", seeds, evals, baselines, refine_evals, combo_evals, lambda, prescreen, workers, continuous, sensitivity }` or `{ mode: "auto", llm: "mock" \| "live", trained, confirm, confirm_text, max_calls, max_iterations, patience, target_lap_s, search_budget, scope, seed, team, start_params, pace_ms, workers }` |
| `POST /api/concept/engine/run/:id/stop` | cooperative stop |
| `GET /api/concept/engine/run/:id` · `/run/:id/stream` (SSE) · `/runs` | stream: `snapshot` first, then `start`, `progress` (`kind`: gen / refine / phase / search), the loop's `request` `response` `proposal` `search` `result` `link` `done`, `final`, `stopping`, `end` |

Files: `server/campaign-route.js` (routes; wired with 2 lines in `server/app.js`), `concept/campaign/local.js` (local search),
hooks in `concept/campaign/run.js`, `pool.js`, `worker.js`, `concept/designer/loop.js` (`search`, `shouldStop`),
`concept/lab/engine-panel.js` + `.css`. Tests: `node --test test/concept-dashboard.test.js` (9: budget from files, local search
determinism and legality, garage / car sheet routes, trained guards and cap, budget refusal before any call, a deterministic ~10
iteration mock autonomous run that writes nothing to `data/`, stop conditions and a trained run through an injected
`server/mubit.js` stand-in, a short speed run, banned words). Screenshots: `docs/concept/dashboard-shots/` (headless Chromium,
`MUBIT_MOCK=1` server, reduced motion, 0 console errors).

## 8. Limits

- Every lap is a reduced-order physics lap sim result at Silverstone; the band covers the sim's measured errors, not the concept aero
  map's coefficients (CAMPAIGN.md §2).
- The speed run uses all worker threads; a garage lap during a run competes for the CPU (it still answers, slower).
- Stop is cooperative: up to one batch (≤ λ laps, or one local-search batch) plus the final re-score (≈ 1-3 s).
- Runs live in the server process: a server restart ends them (their folders stay).
