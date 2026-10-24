# CONCEPT campaign: can a legal 2026 car with the same engine beat the real Silverstone qualifying laps?

Version 1 · 2026-10-24 · branch `claude/beat-pole` · code `concept/campaign/`, guards in `concept/bench.js` and `concept/optimize.js`.
Every lap number below is labelled with its source. The source of every final number is **"physics lap sim · quasi-steady-state
point mass · Silverstone OSM centreline · calibrated to 2026 British GP qualifying"** (`concept/sim/`, docs/concept/SIM.md), run in
the 2026 British GP qualifying conditions (§3). The surrogate is used only to pre-screen candidates (§2); no reported number is a
surrogate value.

**The question.** Real 2026 Silverstone qualifying: pole ANT 88.111 s (Mercedes), HAD 88.746 s (Red Bull RB22, P5). Can a car that
obeys the FIA 2026 technical regulations (Section C, Issue 19, the issue in force at Silverstone) and keeps the baseline team's own
power unit (the Red Bull Ford DM01 for the RB22 baseline) lap faster on the physics lap sim?

<!-- RESULTS -->

## 1. Guards: same engine, legal car, permitted materials, energy limits

All four guards sit in `concept/bench.js`, so every caller (the campaign, `concept/optimize.js`, the Mubit designer loop, the lab)
gets them. The optimiser refuses to run with any of them off. Tests: `test/concept-optimize-guards.test.js` (7),
`test/concept-campaign.test.js` (7).

| Guard | What it checks | Where | On failure |
|---|---|---|---|
| **Same engine** (`PU-HOMOLOGATED`) | the PhysicalCar's PU equals `bench.homologatedPU(team)` exactly: ICE kW (the anchor car's: 399.84 kW for the DM01, the sim's inferred RB22 PU; 400 kW generic), MGU-K 350 kW (C5.2.7), ES window 4 MJ (C5.2.9), recharge 8.5 MJ (C5.2.10), deploy 12.5 MJ; no other PU field (e.g. `superclip_kw`); calibration `power_scale` = 1; PU part masses 118.5 / 12 / 20 / 35 / 5.7 kg and MGU-K transmission option a (C5.5.1, C5.18.7, C5.17.9, C5.3.4); no override on a PU part; the car anchored on its own team | `bench.checkPU`, in every `bench()` call before the sim | illegal, no lap, the sim is never called |
| **FIA legality** | every rule in `concept/regs.js` (Section C articles + the three concept model rules) | `regs.checkFacts`, every `bench()` call | illegal, no lap |
| **Materials** (`MAT-C15`) | a non-baseline material must be marked `permitted` (C15.2) in `concept/data/materials-2026.json`; the survival cell, nose and rear impact structure keep their baseline laminate (campaign rule, conservative: their lay-ups are homologated with the crash tests) | `bench.checkMaterials`; `esProposer(λ, { materials: true })` and the campaign only draw allowed ones | illegal, no lap |
| **Energy limits** (`ENERGY-LIMIT`) | on the sim's own report: recharge ≤ min(8.5 MJ, the session limit 6.5 MJ), deployment ≤ recharge + 4 MJ | `bench.checkEnergy`, after every physics lap | illegal, not scored |

Why a design cannot reach the PU: `concept/physical.js` builds `pu` from the anchor car (ICE), the part catalogue (MGU-K) and the
regulation constants (energy). A design moves the ICE only through the cooling derate, and a derating design also fails the
`PKG-COOLING` model rule; a calibration `power_scale` is the only other route, and the guard rejects it. Fuel flow (C5.2.3-4) and the
MGU-K speed taper (C5.2.8) are constants inside the sim (`REGS`), not PhysicalCar fields. The test runs 1,200 seeded mutations and
random walks (materials on, both baselines): every legal one carries the homologated PU exactly, the PU masses never move.

**Energy strategy.** The sim offers three deployment strategies, all inside the energy budget: `threshold` (the calibrated default),
`marginal` and `optimal` (SIM.md §3). The team cars, and so the real-lap comparison, are calibrated with `threshold` only. Switching
strategy alone moves the unmodified RB22 from 88.749 s to 87.579 s (`marginal`) or 87.521 s (`optimal`): that is a change of
calibration, not of car, so the campaign scores with `threshold` and reports the other two only as differences to the baseline under
the same strategy (§4, sensitivity). `--strategy` exists on the CLI for studies.

**Bug found (not fixed here, `concept/materials.js` is read-only for this task).** `materials.problem(part, id)` checks only the
material's form, not its FIA status, so `design.validate` accepts and `design.mutate(d, rng, step, { materials: true })` draws
`cfrp_m60j` (status forbidden: fibre modulus 588 GPa > 550, C15.2.3(b)(i)), `albemet_am162` (forbidden, C15.1.4) and `al_li_2195`
(not_listed, C15.2.1(b)). `concept/regs.js` has no C15 check yet. The bench's `MAT-C15` guard now rejects them; the FIA-checklist
helper's C15 rules should replace that guard when they land.

## 2. Method

**Search space** (`concept/campaign/space.js`): the 23 shape parameters of the part catalogue, each mapped to [0, 1] over the
catalogue's model domain **tightened by the single-number FIA limits** read from `regs.js` (wheelbase ≤ 3400 mm, front axle 0-150 mm,
cockpit 1830-2030 mm, bulkhead ≥ 360 mm, front span ≤ 1350 mm and ≤ 3 volumes, rear span ≤ 1150 mm, chord ≤ 465 mm, ≤ 3 volumes,
endplate ≤ 880 mm, floor body ≤ 1540 mm). Tightening never makes a car legal; the full check still runs on every candidate. Coupled
rules (front-wing envelope at the span, Straight Mode envelope, flap needs ≥ 2 volumes, mass and axle split, packaging, cooling,
floor stall, plank) are handled by the fitness: an illegal car ranks behind every legal one, by rules broken and relative excess.

**Per seed** (`runSeed`): CMA-ES (`cmaes.js`, Hansen's (μ/μ_w, λ) with rank-one and rank-μ updates, cyclic Jacobi eigendecomposition)
with restarts: from the baseline (σ 0.15, λ 16), wide from the baseline (σ 0.3, λ 32), local around the incumbent (σ 0.06), and from
a random legal point with λ doubling (IPOP-style); a restart ends after 25 generations without a 1 ms gain or when the search
distribution has collapsed (max std < 0.002). Each generation draws 4λ samples; the **surrogate** (`concept/surrogate`, physics
model) **pre-screens** them: the top ¾λ by surrogate lap plus a random ¼λ it never ranks are run on the **physics lap sim**, and
CMA-ES learns only from those physics laps. Outside the surrogate's training box (the best cars sit at its CLA and Straight Mode
balance edges) a candidate gets the batch's median rank, so the pre-screen is blind there rather than biased. Same seed, same run:
the rng is `design.seededRng(seed)` and every lap is a pure function of the design, so the worker count never changes a result
(tested with 0 and 2 workers).

**Refinement** of the best car over all seeds, all on the physics sim: (1) wing volume counts: a short CMA-ES (240 laps) for each of
the other 8 front/rear combinations (a single-volume wing loses its Straight Mode flap, C3.10.10(a)(i), C3.11.6(a)(i)); (2) material
swaps to every allowed material on every material part; (3) a coordinate pattern search, ± 1, 2, 4 … 32 quantisation steps on every
parameter; improving single moves are also combined cumulatively, best first. (2)-(3) repeat until neither improves or the budget
(3,000 laps) is spent.

**Final numbers** (`report`): the final design is benched again with the cache off, and `sim.simulateLap` is called directly on its
PhysicalCar; the two laps must be identical or the run fails. Sectors, trap and energy come from that lap; per-segment times from the
sim's time-at-distance (`concept/designer/segments.js`); grid slot = 1 + the number of the 22 real 2026 qualifying laps strictly
faster (`EI.RACEPACE.silverstone.q`, best lap per driver).

**Parallelism.** `pool.js` runs `bench()` in worker threads. On this machine (4 logical CPUs, ~1.4 effective cores in this
container) more workers do not raise throughput (measured: 68-70 physics laps/s with 1, 2 or 4 workers); the budget below is set
for that.

## 3. Commands

```bash
npm ci
node --test test/concept-optimize-guards.test.js test/concept-campaign.test.js     # the guards and the campaign (~25 s)
node concept/campaign/run.js --seeds 1,2,3,4 --evals 3500 --baselines redbull,generic \
  --refine-evals 3000 --combo-evals 240 --out /tmp/purple-campaign \
  --svg docs/concept/campaign-convergence.svg --summary /tmp/purple-campaign/summary.md
```

Writes `campaign.json` (everything: traces, kept candidates with their designs, legality reports, sensitivities), `summary.md` (the
tables in §4), `convergence.svg` and `best-<baseline>.json` (the final designs) to `--out`; refuses `data/` and `data-mock/`. No
network, no Mubit. Options: `--seeds`, `--evals` (physics laps per seed), `--lambda`, `--prescreen` (1 = no surrogate), `--workers`,
`--baselines`, `--refine-evals`, `--combo-evals`, `--strategy` (the sim's own; scoring with anything but `threshold` leaves the
calibration), `--no-sensitivity`, `--quiet`.

**Conditions** (`run.js qualiConditions`, from `concept/data/silverstone-2026-weekend.json` through the sim's
`loadWeekendConditions`): the 2026 British GP qualifying session, mid-range of the FIA weather chart: air 25.2 °C, track 40.4 °C
(chart 38.2-42.6 °C; the sim does not model track temperature), 1007.6 hPa, 48.2 % RH, dry, 6.5 MJ recharge limit. Wind: 0.3-4.9 m/s
with no published direction, so the scored laps use still air (as the sim's fit did) and §4 reports the wind sensitivity.
