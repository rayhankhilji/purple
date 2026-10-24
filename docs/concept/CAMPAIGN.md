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

Every guard runs inside `concept/bench.js` `bench()`, so every caller (the campaign, `concept/optimize.js`, the Mubit designer
loop, the lab) gets it, and an illegal car never reaches the sim (no lap, no score). The optimiser refuses to run with the guards
off (`pu_guard: false` / `material_guard: false` throw). Tests: `test/concept-optimize-guards.test.js` (8),
`test/concept-campaign.test.js` (7).

| Guard | What it checks | Where | On failure |
|---|---|---|---|
| **FIA legality** | every checkable rule in `concept/regs.js` (`ALL_RULES`: Section C articles, the FIA-checklist combination rules incl. the X+Z front-wing envelope, rear wing ≥ 2 volumes, plank holes, sidepod inlet, the C15 material rules, the `PKG-PU-FIXED` PU lock on PU part masses and positions, and the concept model rules) | `regs.checkFacts` | illegal, no lap |
| **FIA checklist on the PhysicalCar** | `regs.checkPhysical(pc, { pu_ref })`: Section C PU / energy limits and the PU lock against the homologated PU. `REG-C-SUSP-WIDTH` is **not enforced yet** (`bench.PHYSICAL_SKIP`): every car fails it until the track-width fix (`claude/sim-v3-fia`) lands. `recharge_limit_mj` is not passed: `es_harvest_mj_per_lap` is the car's C5.2.10 cap (8.5 MJ); the session's 6.5 MJ applies to the energy a lap actually harvests (next-but-one row) | `bench()` | illegal, no lap |
| **Same engine** (`PU-HOMOLOGATED`, backstop) | the PhysicalCar's PU equals `bench.homologatedPU(team)` **exactly**: ICE kW (the anchor car's: 398.6 kW for the DM01 = the sim v2 RB22 fit; 400 kW generic), MGU-K 350 kW (C5.2.7), ES window 4 MJ (C5.2.9), recharge cap 8.5 MJ (C5.2.10), deploy 12.5 MJ; no other PU field (e.g. `superclip_kw`, which `regs.checkPhysical` does not look at but the sim reads); calibration `power_scale` = 1; PU part masses 118.5 / 12 / 20 / 35 / 5.7 kg and MGU-K transmission option a; no override on a PU part; the car anchored on its own team | `bench.checkPU` | illegal, no lap |
| **Materials** (`MAT-C15`, backstop) | a non-baseline material must be `permitted` (C15.2) in `concept/data/materials-2026.json`; the survival cell, nose and rear impact structure keep their baseline laminate (campaign rule, conservative: their lay-ups are homologated with the crash tests) | `bench.checkMaterials`; the campaign and `esProposer(λ, { materials: true })` only draw allowed ones | illegal, no lap |
| **Energy limits** (`ENERGY-LIMIT`) | on the sim's own report of every lap: recharge ≤ min(8.5 MJ, the session limit 6.5 MJ), deployment ≤ recharge + 4 MJ | `bench.checkEnergy` | illegal, not scored |

**Backstops.** The two campaign guards speak only when regs.js found nothing, so a car regs.js rejects carries exactly regs.js's
verdict (the FIA helper's test "bench legality = regs.check" holds), and a car regs.js lets through still cannot carry a changed PU
or a disallowed material. Gaps regs.js leaves today that the backstops close: an extra PU field the sim reads (`superclip_kw`); a
C15-permitted but non-CC-UHS laminate on the survival cell, e.g. `cfrp_t800s` (fibre Ftu 5880 MPa < the 6250 MPa C15.5.1(f)
threshold: `regs.check` passes it, REG-C-MAT-COMPONENT does not catch it; reported to the FIA-checklist owner).

Why a design cannot reach the PU: `concept/physical.js` builds `pu` from the anchor car (ICE), the part catalogue (MGU-K) and the
regulation constants (energy). A design moves the ICE only through the cooling derate, and a derating design fails the
`PKG-COOLING` model rule; a calibration `power_scale` is the only other route, and both PKG-PU-FIXED and the backstop reject it.
Fuel flow (C5.2.3-4) and the MGU-K taper (C5.2.8) are constants inside the sim, not PhysicalCar fields. The test runs 1,200 seeded
mutations and random walks (materials on, both baselines): every legal one carries the homologated PU exactly; the PU masses and the
transmission option never move.

**Proposer limits** (`optimize.proposerLimits`, `honourLimits`): the default ES proposer's values are clamped into the catalogue
domain narrowed by the rules a proposer can honour directly: front-wing chord ≤ `regs.fwProfilesChordLimit` (X+Z envelope for that
span, setting and volume count), rear wing ≥ 2 volumes, Straight Mode change ≥ 0, sidepod inlet ≤ 1600 cm². `ctx.params` carries the
narrowed bounds and `ctx.rules` the non-info combination rules. Legality stays the bench's call.

**Energy strategy.** The sim offers three deployment strategies, all inside the energy budget: `threshold` (the calibrated default),
`marginal` and `optimal` (SIM.md §3.4). The team cars, and so the real-lap comparison, are calibrated with `threshold` only.
Switching strategy alone moves the unmodified RB22 (sim v2) from 88.752 s to 88.292 s (`marginal`) or 87.776 s (`optimal`): a change
of calibration, not of car. The campaign scores with `threshold` and reports the other two only as best − baseline under the same
strategy (§4). `--strategy` exists on the CLI for studies.

**Bug reports (files read-only for this task).**
- `concept/materials.js` `problem(part, id)` checks only the material's form, not its FIA status, so `design.validate` accepts and
  `design.mutate(d, rng, step, { materials: true })` draws `cfrp_m60j` (forbidden, C15.2.3(b)(i)), `albemet_am162` (forbidden,
  C15.1.4) and `al_li_2195` (not_listed). Since the FIA-checklist merge `regs.check` rejects all three (REG-C-MAT-*), so no scored car
  can carry them; the mutation still wastes laps on them.
- `regs.checkPhysical(pc, { recharge_limit_mj: 6.5 })` rejects every car (REG-C-ES-RECHARGE: the PhysicalCar declares the 8.5 MJ
  C5.2.10 cap). The bench therefore checks the session limit on the lap's harvested energy instead.
- `concept/optimize.js` `hypothesize()` crashed on a material change (no `spec` for `material`); fixed here.

## 2. Method

**Search space** (`concept/campaign/space.js`): the 23 shape parameters of the part catalogue, each mapped to [0, 1] over the
catalogue's model domain **tightened by the single-number FIA limits** read from `regs.js` (wheelbase ≤ 3400 mm, front axle 0-150 mm,
cockpit 1830-2030 mm, bulkhead ≥ 360 mm, front span ≤ 1350 mm and ≤ 3 volumes, rear span ≤ 1150 mm, chord ≤ 465 mm, 2-3 volumes,
endplate ≤ 880 mm, floor body ≤ 1540 mm, sidepod inlet ≤ 1600 cm²). Tightening never makes a car legal; the full check still runs on
every candidate. One coupled limit is **repaired** when a vector is decoded: the front-wing chord is capped at the X+Z envelope for the
wing's own span, setting and volume count (`regs.fwProfilesChordLimit`, `regs.fwChordLimit`), rounded down to its 5 mm step: without
it ~1 sample in 40 near the baseline was legal (the RB22 baseline sits exactly on that envelope). The other coupled rules (Straight
Mode envelope, flap needs ≥ 2 volumes, mass and axle split, packaging, cooling, floor stall, plank) are handled by the fitness: an
illegal car ranks behind every legal one, by rules broken and relative excess.

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
the other front (1-3) / rear (2-3) combinations (a single-volume front wing loses its Straight Mode flap, C3.10.10(a)(i); the rear
needs ≥ 2 volumes, C3.11.7(b)); (2) material
swaps to every allowed material on every material part; (3) a coordinate pattern search, ± 1, 2, 4 … 32 quantisation steps on every
parameter; improving single moves are also combined cumulatively, best first. (2)-(3) repeat until neither improves or the budget
(3,000 laps) is spent.

**Final numbers** (`report`): the final design is benched again with the cache off, and `sim.simulateLap` is called directly on its
PhysicalCar; the two laps must be identical or the run fails. Sectors, trap and energy come from that lap; per-segment time from the
sim's own `contributions(best, baseline)` (sim v2: each corner zone, marker ±100 m, and the straights between; the segment deltas
add up to the lap delta); grid slot = 1 + the number of the 22 real 2026 qualifying laps strictly faster
(`EI.RACEPACE.silverstone.q`, best lap per driver). Where the time comes from by part group: each group reverted to the baseline on
its own, the rest kept, re-lapped on the physics sim.

**Uncertainty band** (`concept/campaign/uncertainty.js`), only from the sim's own measured errors (`concept/sim/fitted.js`):
(a) transfer error of a lap-time change: the sim's held-out sector times on the 10 team laps that entered the fit only through lap
time and trap; for each team and sector the predicted difference to the anchor team is compared with the real one, k = √(Σ(Δsim −
Δreal)² / ΣΔsim²) (sim v2: k = 0.166 against the RB22, 0.194 against the generic car), and a design that changes sector i by g_i
carries k·|g_i|, sectors in quadrature; (b) the RMS of the 11 team-lap fit residuals (sim v2: 0.018 s); (c) the sim's numerical
noise measured at the final car (21 laps over ±0.2 % CLA, RMS residual about a straight line; floor 0.005 s); (d) surrogate 0 (no
final number is a surrogate value). σ = √(a² + b² + c²); band ±1.96 σ. Reported beside it, not inside: the anchor's own fit
residual, the held-out sector bias (sim v2: −0.17 / +0.50 / −0.34 s, every team the same sign: the sim is S2-slow, S1/S3-fast) with
bias-corrected sectors, and the held-out speed-trace RMS (12.5 km/h). **Not covered**: the concept aero map's relative coefficients
(guesses, CONCEPT.md §5), part-mass estimates, and what the point-mass sim leaves out; §4 gives the what-if with the aero map's gains
halved.

**Parallelism.** `pool.js` runs `bench()` in worker threads. On this machine (4 logical CPUs, ~1.4 effective cores in this
container, shared with other jobs) more workers raise throughput only a little (measured: 58-82 physics laps/s with 1-4 workers);
the budget below is set for that.

## 3. Commands

```bash
npm ci
node --test test/concept-optimize-guards.test.js test/concept-campaign.test.js     # the guards and the campaign (~25 s)
node concept/campaign/run.js --seeds 1,2,3,4 --evals 5000 --baselines redbull,generic \
  --refine-evals 3000 --combo-evals 240 --out /tmp/purple-campaign \
  --svg docs/concept/campaign-convergence.svg --summary /tmp/purple-campaign/summary.md
```

**After a sim or regulation change** (e.g. `claude/sim-v3-fia`: track widths and the floor-throat roof): merge, then
1. if the track-width fix makes `regs.checkPhysical` pass `REG-C-SUSP-WIDTH` for the baselines, empty `PHYSICAL_SKIP` in
   `concept/bench.js` (the guard test fails on purpose to remind you); if `REG-C-FLOOR-ROOF` becomes a checked rule, nothing to do
   (the campaign reads `regs.ALL_RULES` and the box follows the catalogue domain);
2. retrain the physics surrogate if the sim changed (`node concept/surrogate/train.js --sim physics`; the campaign only uses it to
   pre-screen, a stale one costs laps, never accuracy);
3. `npm test`, then the campaign command above (~10-14 min here), and paste `/tmp/purple-campaign/summary.md` into §4 below.
The uncertainty band, the anchor laps and the held-out errors are read from the sim's fit at run time, so they follow the sim.

Writes `campaign.json` (everything: traces, kept candidates with their designs, legality reports, sensitivities), `summary.md` (the
tables in §4), `convergence.svg` and `best-<baseline>.json` (the final designs) to `--out`; refuses `data/` and `data-mock/`. No
network, no Mubit. Options: `--seeds`, `--evals` (physics laps per seed), `--lambda`, `--prescreen` (1 = no surrogate), `--workers`,
`--baselines`, `--refine-evals`, `--combo-evals`, `--strategy` (the sim's own; scoring with anything but `threshold` leaves the
calibration), `--no-sensitivity`, `--quiet`.

**Conditions** (`run.js qualiConditions`, from `concept/data/silverstone-2026-weekend.json` through the sim's
`loadWeekendConditions`): the 2026 British GP qualifying session, mid-range of the FIA weather chart: air 25.2 °C, track 40.4 °C
(chart 38.2-42.6 °C; the sim does not model track temperature), 1007.6 hPa, 48.2 % RH, dry, 6.5 MJ recharge limit. Wind: 0.3-4.9 m/s
with no published direction, so the scored laps use still air (as the sim's fit did) and §4 reports the wind sensitivity.
