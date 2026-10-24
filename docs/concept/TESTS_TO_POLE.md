# PURPLE · TESTS TO POLE — does Claude-through-Mubit get to pole in fewer physics tests?

Version 1 · 2026-10-24 · branch `claude/tests-to-pole` · code `concept/benchmark/` · chart data `concept/benchmark/curves.json` ·
test `test/tests-to-pole.test.js`.

Every lap number here is a **physics lap sim, Silverstone, model prediction** (quasi-steady-state point mass, calibrated to 2026
British GP qualifying). The target is Antonelli's real 2026 British GP pole, **88.111 s**. A surrogate value is a ranking, never a
reported lap.

## 1. The answer

**No.** On the same physics-test budget, engine v2 steered by Claude (Haiku 4.5) through Mubit needed **more** physics laps to
beat 88.111 s than the same engine with no AI, and it ended slower at every budget, on every one of the three seeds. It did beat the
other baseline, CMA-ES, on every seed.

| mean ± sd over seeds 7, 11, 12 | physics laps to beat 88.111 s | best lap after 1,000 laps | best lap at the end of the steered run's own lap count |
|---|---|---|---|
| Steered (Claude via Mubit), recorded live runs | 781 ± 779 (197 / 1,666 / 480) | 87.895 ± 0.448 s | 87.635 ± 0.219 s |
| Same engine v2, no AI (seeded random direction) | **216 ± 144** (92 / 374 / 183) | **87.543 ± 0.190 s** | **87.454 ± 0.110 s** |
| CMA-ES (concept campaign optimiser) | 1,723 ± 1,471 (560 / 3,376 / 1,232) | 88.120 ± 0.200 s | 87.950 ± 0.114 s |

Seed by seed, the no-AI engine beat pole in 2.1×, 4.5× and 2.6× fewer physics laps than the steered engine, and at the steered run's
own final lap count it was 0.063 s, 0.169 s and 0.309 s faster. Over eight no-AI seeds on the seed-11/12 physics (§4.5), the
slowest no-AI run beat pole after 825 laps and its slowest final lap was 87.525 s. Steered seed 11 needed 1,666 laps and ended at
87.698 s; steered seed 12 ended at 87.815 s. So both of those steered runs sit outside the whole no-AI range, not only below its mean.

Paired, steered minus no AI at the same lap count (negative = steered faster): **+0.292 ± 0.184 s** at 500 laps, **+0.353 ± 0.260 s**
at 1,000, **+0.266 ± 0.048 s** at 2,000 (seeds 11 and 12 only: seed 7's run ended at 1,219 laps), **+0.180 ± 0.123 s** at the steered
run's own total. Against CMA-ES the steered engine is ahead: −0.365 ± 0.289 s at 500 laps, −0.315 ± 0.164 s at its own total.

What this says: in these runs the gain comes from **the engine** (subspace screening of thousands of variants with the surrogate,
then physics confirmation of the best 24 + 4 unranked per decision, keep / revert / fork). Claude's directions did worse than random
directions inside that engine. The steered engine beats CMA-ES because the engine beats CMA-ES (the no-AI engine beats it by more).
There are three steered runs, all made with one trained model and one prompt, so this is evidence about these runs, not a law. It is
consistent across every seed and every budget, though, and the reasons are visible in the runs (§5).

## 2. What was compared

| | Steered | Same engine, no AI | CMA-ES |
|---|---|---|---|
| source | recorded live trained runs `docs/concept/loop-runs/trained-engineer-seed{7,11,12}/`, no new Mubit call | run locally here | run locally here |
| who picks the direction | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) through Mubit, one call per decision, 40 / 120 / 120 calls with real `mreq_` ids | the engine's own fallback in `concept/engineer/engine.js`: a seeded `design.mutate` step of the head, 1-3 random catalogue parameters, Gaussian step of 6 % of the range | CMA-ES over all parameters at once |
| what happens after | engine v2: subspace (proposed + coupled, ≤ 8 dims), 3,000 variants screened (FIA checks + guards + surrogate), top 24 + 4 unranked + proposal + projection confirmed on the physics sim, interactions, keep / revert / fork (patience 3) | identical engine, identical settings | λ = 16, surrogate pre-screen ×4 (it ranks 4λ, ¾ of the physics slots go to its best, ¼ random), restarts (baseline, wide, local, random legal); learns only from physics laps |
| team, start car | Red Bull RB22 baseline | same | same |
| physics, legality | the bench (FIA 2026 Section C checks, homologated PU, material guard, physics lap sim) | same code | same code |
| parameter catalogue and box | `concept/parts.js` PARAMS in the FIA-tightened box of `concept/campaign/space.js` | same | same |
| stop | decision cap: 40 decisions (seed 7, 1,219 laps), 120 decisions (seeds 11 / 12, 3,429 / 3,494 laps) | 3,500 physics laps (≈ 119-130 decisions) | 3,500 physics laps |
| workers | 4 worker threads | 4 | 4 |

The no-AI proposer is the engine's own non-LLM path, which a decision takes when the model call fails. It uses **no canned proposal**.
The scripted mock (`concept/designer/loop.js` `mockLlm`) was **not** used: it walks a PLAYBOOK of hand-picked target values (for
example rear-wing setting 30°, floor width 1,540 mm), which are known-good moves, so it would not be "the algorithm alone".

Counting. A **physics lap** is one evaluation on the bench, as both the engine and the campaign count them. That includes an illegal
car, which the bench refuses before the lap sim runs, so it gets no lap time. The tables therefore also give **legal laps**, which
are laps the sim actually ran. **Screens** are the cheap pre-tests before the physics sim (FIA checks, PU / material guards and the
µs surrogate), counted separately. The start car's own lap is not counted for any method. The verdict is the same whether you count
physics laps or legal laps.

## 3. Is the comparison fair? What was fixed and what remains

- **Same physics as the recorded runs: fixed, and checked.** Seed 7 ran at 13:32 on 2026-10-24, before the redesigns merge, on the
  older physics: 23 catalogue parameters and a baseline of 88.763 s. Seeds 11 and 12 ran on the current physics: 36 parameters and
  88.745 s. Seed 7's baselines therefore run on that commit's `concept/` (`git archive 5bf4b1c concept js data` into a scratch
  directory, passed as `--root 7=<dir>`, in a process of its own; see the note in `run.js`). Seeds 11 and 12 run on this checkout.
  **Replay check:** each recorded run's own Mubit proposals, read from `events.jsonl`, were fed back to the engine and physics used
  for its baselines, with no Mubit call. All three reproduced the recorded run exactly: 87.391 s at 1,219 laps, 87.698 s at 3,429,
  and 87.815 s at 3,494, matching every decision's peak. So the baselines ran on exactly the code and physics the steered runs used.
- **Different stopping rules: stated, and compared at equal counts.** The steered runs stopped at their decision cap, not at a lap
  budget. A fixed-budget column past the end of a steered run reads "—". It is never carried forward, because that would credit
  tests that were never run. The column "@ steered's total" compares every method at exactly the steered run's lap count. Seed 7's
  steered run ended at 1,219 laps while it was still improving, so its 2,000 and 3,500 values do not exist.
- **Search space.** The two engines search the same catalogue in the same box. CMA-ES also uses that catalogue and box, but moves all
  23 or 36 dimensions at once, where the engine works in subspaces of 8 or fewer. That difference is the algorithm, not an unfairness.
  None of the methods here swaps materials. The campaign's post-seed refinement (volume-count combinations, concept switches,
  materials, coordinate search on the best of several seeds) is not part of a per-seed budget and was not run.
- **Screens are not equal.** The engine screens about 100 variants per physics lap and CMA-ES about 4. Screens cost microseconds,
  not tests, so they are reported but not charged. If screens counted, CMA-ES would look better on that column.
- **Granularity.** Engine curves have one point per decision (about 25-35 laps, confirmed in parallel). CMA-ES curves have one point
  per generation (16-64 laps). That gives CMA-ES at most about one decision's worth of resolution advantage in "laps to beat pole",
  which is far below the gaps measured.
- **Seeds are labels, not shared luck.** The seed sets the engine's screening samples (and, for no AI, its random step). Claude's
  answers are not seeded. Results are paired by seed because each seed fixes the physics version, not because the random streams
  match. That is why §4.5 adds six more no-AI and CMA-ES seeds on the seed-11/12 physics, to show the spread.
- **Steered extras not charged.** The steered runs also re-simulated the head and the best car for a per-segment report (`moves`).
  Those are not new cars, and the engine does not count them as physics laps, so they are not counted here either. The baselines ran
  with that report off, because it only feeds the scenario text, which the no-AI run never reads.
- **Wall clock is not the metric.** The steered runs also spent 2-3 s per Mubit call (seed 7: 94 s of model time in 136 s).

## 4. Results (physics lap sim, Silverstone, model prediction)

### 4.1 Seed 7 · pre-redesigns physics, 23-parameter catalogue (commit 5bf4b1c), baseline 88.763 s

| method | physics laps to beat 88.111 s (legal laps · screens) | physics laps to its best | best lap (s) | @500 | @1,000 | @2,000 | @3,500 | @ steered's total (1,219) |
|---|---|---|---|---|---|---|---|---|
| Steered (Claude via Mubit) | 197 (191 · 17,917) | 1,219 | 87.391 | 87.640 | 87.407 | — | — | 87.391 |
| Same engine, no AI | 92 (91 · 6,459) | 3,383 | 87.291 | 87.507 | 87.328 | 87.315 | 87.291 | 87.328 |
| CMA-ES | 560 (452 · 2,240) | 3,184 | 87.654 | 88.312 | 87.891 | 87.730 | 87.654 | 87.838 |

Replay check: reproduced exactly (87.391 s at 1,219 laps).

### 4.2 Seed 11 · redesigns physics, 36-parameter catalogue (this checkout), baseline 88.745 s

| method | physics laps to beat 88.111 s (legal laps · screens) | physics laps to its best | best lap (s) | @500 | @1,000 | @2,000 | @3,500 | @ steered's total (3,429) |
|---|---|---|---|---|---|---|---|---|
| Steered (Claude via Mubit) | 1,666 (1,637 · 170,485) | 3,071 | 87.698 | 88.355 | 88.287 | 87.790 | — | 87.698 |
| Same engine, no AI | 374 (365 · 30,485) | 3,454 | 87.525 | 87.861 | 87.691 | 87.558 | 87.525 | 87.529 |
| CMA-ES | 3,376 (2,772 · 13,504) | 3,440 | 88.048 | 88.453 | 88.259 | 88.259 | 88.048 | 88.065 |

Replay check: reproduced exactly (87.698 s at 3,429 laps).

### 4.3 Seed 12 · redesigns physics, 36-parameter catalogue (this checkout), baseline 88.745 s

| method | physics laps to beat 88.111 s (legal laps · screens) | physics laps to its best | best lap (s) | @500 | @1,000 | @2,000 | @3,500 | @ steered's total (3,494) |
|---|---|---|---|---|---|---|---|---|
| Steered (Claude via Mubit) | 480 (468 · 47,801) | 3,438 | 87.815 | 88.045 | 87.992 | 87.838 | — | 87.815 |
| Same engine, no AI | 183 (178 · 17,465) | 3,110 | 87.506 | 87.797 | 87.609 | 87.538 | 87.506 | 87.506 |
| CMA-ES | 1,232 (1,003 · 4,928) | 3,488 | 87.947 | 88.369 | 88.210 | 87.982 | 87.947 | 87.947 |

Replay check: reproduced exactly (87.815 s at 3,494 laps).

### 4.4 Mean ± sd over seeds 7, 11, 12

| method | laps to beat pole | legal laps to beat pole | screens to beat pole | laps to its best | best lap (s) | @500 | @1,000 | @2,000 | @3,500 |
|---|---|---|---|---|---|---|---|---|---|
| Steered (Claude via Mubit) | 781 ± 779 | 765 ± 767 | 78,734 ± 80,851 | 2,576 ± 1,189 | 87.635 ± 0.219 | 88.013 ± 0.359 | 87.895 ± 0.448 | 87.814 ± 0.034 (n = 2 of 3) | none (0 of 3) |
| Same engine, no AI | 216 ± 144 | 211 ± 140 | 18,136 ± 12,027 | 3,316 ± 182 | 87.441 ± 0.130 | 87.722 ± 0.189 | 87.543 ± 0.190 | 87.470 ± 0.135 | 87.441 ± 0.130 |
| CMA-ES | 1,723 ± 1,471 | 1,409 ± 1,212 | 6,891 ± 5,883 | 3,371 ± 163 | 87.883 ± 0.205 | 88.378 ± 0.071 | 88.120 ± 0.200 | 87.990 ± 0.265 | 87.883 ± 0.205 |

The "best lap" column is the end of each run, and the runs ended at different counts: 1,219, 3,429 and 3,494 laps for steered, 3,500
for the others. The steered runs at 3,500 read "none" because none of them reached 3,500. Seed 7 starts 18 ms slower than seeds 11
and 12, so the paired differences below are the fairer read.

Paired: steered − baseline best lap at the same physics-lap count (s; negative = steered faster)

| vs | @500 | @1,000 | @2,000 | @3,500 | @ steered's own total |
|---|---|---|---|---|---|
| Same engine, no AI | +0.292 ± 0.184 | +0.353 ± 0.260 | +0.266 ± 0.048 (n = 2 of 3) | none (0 of 3) | +0.180 ± 0.123 |
| CMA-ES | −0.365 ± 0.289 | −0.225 ± 0.256 | −0.306 ± 0.230 (n = 2 of 3) | none (0 of 3) | −0.315 ± 0.164 |

### 4.5 Context: the algorithm alone over 8 seeds on the seed-11/12 physics (seeds 1-6, 11, 12)

| method | runs | laps to beat pole | slowest run's laps to beat pole | best lap at 3,500 (s) | slowest run's best (s) | @500 | @1,000 | @2,000 |
|---|---|---|---|---|---|---|---|---|
| Same engine, no AI | 8 | 309 ± 222 | 825 | 87.486 ± 0.024 | 87.525 | 87.861 ± 0.166 | 87.673 ± 0.138 | 87.540 ± 0.021 |
| CMA-ES | 8 | 2,128 ± 1,104 | 3,376 | 87.963 ± 0.128 | 88.095 | 88.460 ± 0.090 | 88.224 ± 0.112 | 88.122 ± 0.195 |

Per seed (laps to beat pole · best at 3,500): no AI: seed 1 126 · 87.484, seed 2 207 · 87.479, seed 3 203 · 87.452, seed 4 285 ·
87.471, seed 5 825 · 87.468, seed 6 267 · 87.504. CMA-ES: seed 1 864 · 87.699, seed 2 3,152 · 88.095, seed 3 1,136 · 88.055,
seed 4 2,880 · 87.939, seed 5 1,200 · 87.889, seed 6 3,184 · 88.036. The two steered runs on this physics (1,666 laps · 87.698 s and
480 laps · 87.815 s) are both slower at the end than all eight no-AI runs. Seed 11 also took longer to beat pole than any of them.

## 5. Why (read from the recorded runs)

| | seed 7 | seed 11 | seed 12 |
|---|---|---|---|
| steered decisions · kept · illegal as proposed | 40 · 26 · 26 | 120 · 48 · 64 | 120 · 42 · 64 |
| distinct parameters Claude ever proposed (of 23 / 36) | 14 | 18 | 19 |
| most-proposed parameter (decisions that named it) | `sidepods.inlet_cm2` (25 of 40) | `rear_wing.aoa_deg` (96 of 120) | `rear_wing.aoa_deg` (93 of 120) |
| no-AI decisions · kept (3,500 laps) | 119 · 34 | 127 · 59 | 130 · 45 |

- **Narrow.** Claude kept returning to the same few parameters: rear-wing angle in 96 and 93 of 120 decisions, sidepod inlet, brake
  bias and front roll split. It never named roughly half of the catalogue. The engine explores only the subspace it is pointed at,
  so the rest of the car is explored only through the coupling table. The random step reaches every parameter in turn.
- **Often illegal.** More than half of the proposals were illegal as proposed (26 of 40, 64 of 120, 64 of 120). The engine still
  explores them, by projection or repair, but the subspace then sits against an FIA limit.
- **The engine does the work.** Inside one decision, screening 3,000 variants and confirming 28 or more on the physics sim finds most
  of the gain wherever it is pointed. Since a random pointer works better, the direction is not what limits these runs.

This matches ENGINE_V2.md §1, where only 7-13 % of the v1 hybrid's gain came from Mubit-directed iterations. v2 credits 100 % of the
steered runs' kept gain to Mubit because Mubit chose every direction. Credit for a direction is not the same as a direction being
better than chance, and this benchmark measures the second.

What would change the answer (not tested here): directions that cover more of the car (for example a scenario that reports which
parameters were never tried), fewer illegal proposals, or a model that learns from the measured outcome. Mubit stores examples for
imitation, and there is no outcome / reward API (LOOP.md §4-5). Any such change has to be re-measured against this same no-AI
baseline, using `concept/benchmark/`.

## 6. Reproduce

```
# baselines + replay check for seeds 11, 12 on this checkout (≈ 2.5 min per seed, 4 CPUs)
MUBIT_MOCK=1 node concept/benchmark/run.js --seeds 11,12 --budget 3500 --workers 4 --out <scratch>/raw
# seed 7 on the code it ran on (its own process: the concept modules share a global registry)
git archive 5bf4b1c concept js data | tar -x -C <scratch>/old7
MUBIT_MOCK=1 node concept/benchmark/run.js --seeds 7 --budget 3500 --workers 4 --out <scratch>/raw --root 7=<scratch>/old7
# context seeds (baselines only)
MUBIT_MOCK=1 node concept/benchmark/run.js --seeds 1,2,3,4,5,6 --methods engine_noai,cmaes --budget 3500 --workers 4 --out <scratch>/raw-extra
# tables (stdout) + concept/benchmark/curves.json
node concept/benchmark/report.js --raw <scratch>/raw --extra <scratch>/raw-extra 1,2,3,4,5,6 --write
```

Every run is deterministic for its seed and gives the same result for any number of workers. No code path in `concept/benchmark/`
reaches `server/` or the network (the test checks this), and nothing is written to `data/`: `run.js` refuses an `--out` under `data/`.

## 7. Files

- `concept/benchmark/curves.js`: best-so-far curves, laps to a target, best at a budget (never carried past a run's end), stats.
- `concept/benchmark/steered.js`: reconstructs the steered curves from the recorded runs and checks every decision's best against
  the peak the run streamed, and the totals against `run.json`.
- `concept/benchmark/baselines.js`: the no-AI engine run, the CMA-ES run (`runSeed`, every physics batch logged), and the replay of
  recorded proposals.
- `concept/benchmark/run.js`, `concept/benchmark/report.js`: the CLI and the tables / chart data.
- `concept/benchmark/curves.json`, for a dashboard chart: `label`, `pole`, `columns` = `[laps, legal_laps, screened, best_s]`, and
  per seed `curves.{steered, engine_noai, cmaes}` (arrays of those columns, baselines cut at 3,500), `summary`, `replay_check`,
  `physics`. Also `aggregate`, `paired`, and `context` (seeds 1-6, baselines only). Chart: x = physics laps, y = best lap, with a
  horizontal line at 88.111 s labelled "Antonelli pole (real)", and the label "physics lap sim, Silverstone, model prediction".
- `test/tests-to-pole.test.js`.
