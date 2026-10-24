# CONCEPT surrogate models

Every surrogate number carries the label **"surrogate of ‹sim label› · RMSE x ms"** (x = held-out lap RMSE against that sim).

A surrogate is a fitted formula that imitates a lap simulator: one call takes microseconds instead of 10–45 ms, so the concept
optimiser and uncertainty studies can run millions of evaluations. **A surrogate is only as good as the sim it imitates.** Every
error below is measured against the sim, never against a real car; the sim's own limits (docs/concept/SIM.md §7, CONCEPT.md §2)
pass straight through, plus the surrogate's own error.

| Sim | Model file | Role | Centre car | Lap RMSE near the centre / whole box | Ranking ρ |
|---|---|---|---|---|---|
| physics lap sim (`concept/sim/`) | `models/physics-silverstone.json` (364 KB) | **primary** | `baselineCar("redbull")` | 22–29 ms / 102 ms | 0.995 |
| sim v0 (game lap model, `concept/bench.js`) | `models/v0-silverstone.json`, `models/v0-monza.json` (64 KB each) | secondary | `physical(design.baseline())` | 17–22 ms / 226 ms (Silverstone) | 0.994 |

## 1. Files and API

| File | What |
|---|---|
| `concept/surrogate/features.js` | `RAW` (the 22 physical inputs the design of experiments varies, read from / written to a PhysicalCar), `FEATURES` (25 dimensionless groups the models are fitted on), `rawVector`, `fromRaw`, `features` |
| `concept/surrogate/train.js` | the trainer (CLI and `train(opts)`): box, DOE, sim runs in worker threads, three model classes, selection, report, checks |
| `concept/surrogate/surrogate.js` | prediction: `predict`, `predictLap`, `predictWithUncertainty`, `asSim`, `inBox`, `relativeCar`, `timing`, `load` / `register` / `available` |
| `concept/surrogate/models/<sim>-<circuit>.json` | one saved model per (sim, circuit): box, feature scaling, the kept model per target, the full report |
| `test/concept-surrogate.test.js` | 11 tests, ~3.5 s (loads the saved models; never retrains them) |

```js
const S = require("./concept/surrogate/surrogate.js");
S.predict(pc, "silverstone")                         // default sim "physics" (env PURPLE_SURROGATE_SIM or S.setDefaultSim to change)
// -> { ok, lap_s, sectors_s: [3], speed_trap_kmh, vmin_kmh, vmax_kmh, deployed_mj, harvested_mj, speeds_kmh: {...}, apex_kmh: {...},
//      extrapolating, out_of_box: [{ field, value, lo, hi }], distance, label: "surrogate of physics lap sim · ... · RMSE 102.0 ms" }
S.predict(pc, "monza", { sim: "v0" })                 // a named sim
S.predict(pc, "silverstone", { model: "quadratic" })  // force the quadratic surface for every target (fastest)
S.predictLap(pc, "silverstone", "physics")            // lap only, NaN outside the box: the optimiser's fast path
S.predictWithUncertainty(pcMean, pcStd, 10000, { circuit: "silverstone", sim: "physics", seed: 1 })
bench.bench(design, { sim: S.asSim("silverstone", { sim: "v0", fallback: bench.simV0 }) })
bench.bench(design, { sim: S.asSim("silverstone", { sim: "physics", relativeTo: physical(design.baseline()) }) })
```

`predict` returns `sectors_s` (the sim contract's name), per-corner `apex_kmh` (physics sim: the minimum speed in each of its 18
corner windows, the same number `cornerTable()` reports as `sim_min_kmh`) and `speeds_kmh` (the intermediates).

**Bench wiring (no edit to bench.js).** `asSim(circuit?, { sim, fallback, relativeTo })` returns a function with the sim contract
`sim(pc, trackId, conditions)`; the trackId bench passes selects the model. Outside the training box, or for wet / windy
conditions, it calls `fallback` (e.g. `bench.simV0`) when given and otherwise throws: it never extrapolates silently.
`relativeTo` is how a concept design reaches the physics surrogate: concept PhysicalCars are on the design layer's scale (CLA 3.8 m²,
load sensitivity 0.04) while the physics sim's cars are on its estimated scale (CLA 5.4 m², 0.106), so a concept car is outside the
physics box. `relativeCar(pc, ref, anchor)` carries the design's *difference* from the baseline concept car onto the Red Bull car
(ratios for levels: ClA, CdA, power, energy, μ, load sensitivity, efficiency, Straight Mode ratios; offsets for geometry and
balances), the same way sim v0 reads every design relative to the baseline. It is a modelling choice, not a calibration: the
physical() calibration hook (`{ cla_scale, cda_scale, power_scale, mu_scale }`) is the long-term route.

Optimiser example (sim v0, 100 generations, seed 1): 2.2 s with the sim, 0.21 s with the surrogate (the remaining time is the
bench's design / legality work); the surrogate run's best design laps 87.471 s on the surrogate and 87.472 s when re-run on sim v0.

## 2. Method

**Inputs.** 22 RAW fields of the PhysicalCar contract: mass, fuel, wheelbase, CoG height, weight distribution, corner ClA (total)
and aero balance, corner CdA, Straight Mode ClA ratio / balance shift / CdA ratio, ride height, ride sensitivity, stall margin, ICE
and MGU-K power, ES deploy / harvest per lap, μx, μy, load sensitivity, drivetrain efficiency. Track widths and tyre radius are held
fixed (checked within 2 %). Fields a sim reads as informational (e.g. ride sensitivity in the physics sim) are still varied, so the
model learns that they do not matter.

**Features** (`features.js`; m = mass + fuel, W = m g, q = ½ ρ v_ref², ρ = 1.225, v_ref = 60 m/s). A lap sim is close to a
function of a few dimensionless groups: two cars with the same downforce/weight, drag/weight, power/weight and μ corner, brake and
accelerate alike. Fitting in these groups makes the surfaces smoother than in raw SI fields, so a quadratic reaches further.

| Feature | Definition | Why |
|---|---|---|
| mu_y, mu_x | tyre friction | mechanical grip, braking / traction limit |
| aero_load | q·ClA / W | downforce over weight at v_ref |
| aero_grip | μy·q·ClA / W | the ClA·μ/m group: aero share of lateral force |
| corner_grip | μy·(1 + q·ClA/W) | total lateral capacity over weight |
| drag | q·CdA / W | CdA/m |
| power, hybrid_power | P·η / (W·v_ref) | power-to-mass as tractive force over weight |
| deploy_energy, harvest_energy | E / (½ m v_ref²) | ERS energy over kinetic energy |
| top_speed_index | (P·η / (q·CdA·v_ref))^⅓ | v_max / v_ref of a power-drag balance |
| balance_offset, balance_misfit | aero balance − weight distribution; its distance from the baseline's | under/oversteer; a kink either way |
| weight_dist_front, sm_drag_ratio, sm_load_ratio, sm_balance_shift | ratios | Straight Mode relief and what it keeps |
| wb_over_track, cog_over_track | lengths over mean track | agility; load transfer |
| ride_height_rel, bottoming | rh / 35 mm; max(0, 30 − rh) / 10 mm | ride height; plank-on-ground hinge |
| ride_sensitivity, stall_margin, floor_stalled, load_sens_loss | per cm; / 10 mm; flag; load_sens·(W/4)/1 kN | platform; stall; μ lost to static load |

**Training box** (the extrapolation limit). *physics:* centre `baselineCar("redbull")`, spanning the sim's 11 fitted team cars plus
margins: mass 760–798 kg, fuel 0–16 kg, ClA 3.33–6.75 m², balance 0.40–0.48, CdA 0.99–1.77 m², Straight Mode CdA ratio 0.45–0.65,
ICE 349–446 kW, MGU-K 320–380 kW, deploy 8.5–16.5 MJ, harvest 6–11 MJ, μx 1.72–1.96, μy 1.83–2.07, load sensitivity 0.064–0.149,
η 0.92–0.97, CoG 0.24–0.32 m, weight distribution 0.42–0.48, stall margin ≥ 0 (a stalled floor halves ClA in the physics sim: a
jump, kept out). *v0:* centre the baseline concept car, spanning `physical()` of 3,000 uniform random concept designs over the part
domains plus the same margins (ClA 0.96–7.3 m², ICE 160–440 kW: very wide). The margins (`MARGIN` in train.js) cover design changes,
calibration scales of about ±10 % and a telemetry-derived car's error bars; `HARD` caps them at physical limits.

**Design of experiments.** Seeded Latin hypercubes, 6,000 runs per (sim, circuit): 2,400 over the whole box, 1,800 over the centre
± 50 % of the way to each edge, 1,800 over ± 20 % (most runs where the optimiser works; the whole box keeps the edges honest). The sim
runs with its default conditions (physics: 2026 British GP qualifying weather, 6.5 MJ recharge limit). Split 70 / 15 / 15 into
train / validation / test.

**Model classes** (all plain JS, no dependencies), on standardised features:
- **(a) quadratic response surface** with all interactions (1 + 25 + 325 = 351 terms), ridge, λ chosen on validation;
- **(b) RBF kernel ridge, GP-lite**: a Gaussian kernel on 600 training points as centres, fitted to the residual of (a) (a GP
  posterior mean with a quadratic mean function and fixed hyperparameters; length scale and noise chosen on validation);
- **(c) MLP** 25 → 32 → 32 → all targets, tanh, Adam (cosine learning rate 3e-3 → 1e-5, batch 32, 400 epochs), weights of the best
  validation epoch kept.

Per target, the class with the lowest **validation** RMSE is kept; the tables report the **test** split, through the saved
model's own code path (coefficients rounded to 8 significant digits as stored). Every target also stores its quadratic, so
`{ model: "quadratic" }` is always available.

## 3. Accuracy against the physics sim (primary, Silverstone)

Test split, 900 DOE points spread over the whole box; RMSE · max |error| · R². Kept class in bold.

| Target | quadratic | RBF (GP-lite) | MLP 2×32 | Kept |
|---|---|---|---|---|
| lap_s (ms) | 121.1 · 601.2 · 0.997 | 117.5 · 601.9 · 0.997 | **102.0 · 654.1 · 0.998** | mlp |
| s1_s (ms) | 31.5 · 153.2 · 0.997 | **30.9 · 160.7 · 0.997** | 33.1 · 238.4 · 0.997 | rbf |
| s2_s (ms) | 73.3 · 325.1 · 0.994 | 72.1 · 325.8 · 0.995 | **53.6 · 309.9 · 0.997** | mlp |
| s3_s (ms) | 39.3 · 284.5 · 0.996 | 37.9 · 283.5 · 0.996 | **30.7 · 166.8 · 0.997** | mlp |
| speed_trap_kmh | 2.32 · 12.85 · 0.948 | 2.42 · 13.49 · 0.943 | **1.74 · 8.30 · 0.971** | mlp |
| vmin_kmh | 0.06 · 0.26 · 0.998 | **0.06 · 0.27 · 0.998** | 0.06 · 0.34 · 0.998 | rbf |
| vmax_kmh | 2.54 · 13.58 · 0.939 | 2.64 · 14.22 · 0.934 | **1.91 · 9.15 · 0.966** | mlp |
| deployed_mj (MJ) | 0.292 · 1.767 · 0.820 | 0.304 · 1.863 · 0.805 | **0.218 · 1.044 · 0.900** | mlp |
| harvested_mj (MJ) | 0.291 · 1.751 · 0.821 | 0.304 · 1.861 · 0.805 | **0.218 · 1.049 · 0.900** | mlp |
| speeds.intermediate_1 / _2 / finish_line (km/h) | 1.07 / 0.55 / 0.84 | 1.06 / 0.55 / 0.81 | **0.67 / 0.47 / 0.68** | mlp |
| apex: fast corners (Abbey, Copse, Maggotts T10/T11; km/h) | 3.0–3.7 · ≤ 21.9 · 0.93–0.96 | 2.9–3.5 · ≤ 22.2 · 0.94–0.96 | **1.0–1.2 · ≤ 7.2 · 0.99–0.995** | mlp |
| apex: Farm, Woodcote (km/h) | 1.97 / 0.66 | 1.86 / 0.70 | **1.21 / 0.57** | mlp |
| apex: the 12 slow and medium corners (km/h) | 0.06–0.59 | 0.06–0.56 | 0.07–0.52 | mlp (2 rbf) |

The full per-corner table is in the model file (`report.test.per_class`). The energy targets are the weakest (R² 0.90): the sim's
deploy / superclip split comes from a discrete golden-section search on φ (SIM.md §3), so nearby cars can land on different φ;
the speed trap and vmax inherit the same steps (up to ~3 km/h in the sim itself).

**Error vs distance from the centre** (RMS over the 22 RAW fields of |x − centre| / box half-width; 0 = the Red Bull car, ≈ 0.58 =
uniform over the box, 1 = corners):

| Distance | 0–0.1 | 0.1–0.2 | 0.2–0.3 | 0.3–0.4 | 0.4–0.5 | 0.5–0.6 | 0.6–1 |
|---|---|---|---|---|---|---|---|
| test points | 25 | 248 | 166 | 87 | 34 | 217 | 123 |
| lap RMSE (ms) | 21.6 | 29.0 | 56.7 | 68.7 | 124.9 | 134.2 | 174.8 |
| speed trap RMSE (km/h) | 1.20 | 1.50 | 1.36 | 1.45 | 2.25 | 1.95 | 2.28 |

**Fresh checks** (cars the DOE never drew, run through the live sim):

| Check | n (in box) | Lap RMSE | Lap max | Trap RMSE |
|---|---|---|---|---|
| the 11 fitted team cars (Mercedes 88.102 … Aston Martin 92.815 s) | 11 (11) | 27.3 ms | 59.8 ms | 3.0 km/h |
| concept designs, 1–4 ES mutations of the baseline, carried onto the Red Bull car (`relativeCar`) | 150 (130) | 17.6 ms | 69.8 ms | 1.8 km/h |
| uniform random concept designs, carried the same way | 150 (0) | — refused: outside the box | | |
| uncertainty, 300 paired samples around the Red Bull car (inputs below) | 300 (298) | 34 ms (bias +26 ms) | | |

**Ranking of candidate changes** (what the optimiser needs). 40 parents (random walks from the concept baseline) × 8 children
(`design.mutate`, σ 0.08, as the default (1+8) ES), carried onto the Red Bull car; Δlap = child − parent, surrogate vs sim:
**Spearman ρ 0.995** over 285 pairs; sign of Δlap agrees on 97.1 % of pairs with |Δ| > 2 ms; keep/reject decision agrees on 95.8 %;
mean within-generation ρ 0.977; the generation's best child is the same in 97.3 % of generations.

## 4. Accuracy against sim v0 (secondary)

Test split (whole box; v0's box is very wide and v0 clamps its multipliers to 0.6–1.6, so far points are kinked):

| Target | Silverstone quadratic | RBF | **MLP (kept, all targets)** | Monza MLP (kept) |
|---|---|---|---|---|
| lap_s (ms) | 423.5 · 2367 · 0.996 | 400.4 · 2419 · 0.996 | **225.8 · 1559 · 0.999** | 172.9 · 1283 · 0.999 |
| s1 / s2 / s3 (ms RMSE) | 111.0 / 149.9 / 204.4 | 104.2 / 147.1 / 188.4 | **60.8 / 97.5 / 80.9** | 63.7 / 52.7 / 68.0 |
| speed_trap_kmh | 2.41 · 18.8 · 0.992 | 2.37 · 18.8 · 0.993 | **0.80 · 5.1 · 0.999** | 0.69 · 4.3 · 0.999 |
| vmin_kmh | 4.75 · 22.9 · 0.921 | 3.97 · 17.4 · 0.945 | **0.60 · 5.4 · 0.999** | 0.39 · 2.6 · 0.999 |
| vmax_kmh | 2.42 · 18.9 · 0.992 | 2.38 · 18.8 · 0.993 | **0.84 · 5.3 · 0.999** | 0.74 · 6.0 · 0.999 |

Lap RMSE vs distance (Silverstone / Monza, ms): 0–0.1: 17 / 15 · 0.1–0.2: 22 / 13 · 0.2–0.3: 51 / 37 · 0.3–0.4: 67 / 38 ·
0.4–0.5: 229 / 298 · 0.5–0.6: 333 / 253 · 0.6–1: 391 / 279. Fresh checks, Silverstone / Monza: 150 concept mutations 26.8 / 19.3 ms
(all in box); 150 uniform random concept designs 85 / 74 ms; ranking ρ 0.994 / 0.994 (sign agreement 99.0 / 97.7 %, best child
the same in 92.5 % of generations). The baseline concept car is predicted at 88.111 s ± < 50 ms (the test checks it).

### 4a. Retrain 2026-10-24 06:14Z (features v2), after the concept-integrate merge

`physical()` now maps concept cars onto the physics sim's anchor car, so the saved models no longer matched. Changes:
`K.bal_ref` −0.0142 → −0.0110 (the baseline's aero balance − weight distribution is now 0.4390 − 0.4500), `VERSION`
"surrogate features v2", both sims retrained (seed 1, n 6000), and the test now expects the concept baseline to be inside the
physics box. Numbers from the retrain report (the tables above are from the first training and are kept for comparison):

| Check | physics | v0 Silverstone | v0 Monza |
|---|---|---|---|
| lap RMSE near the centre (distance 0–0.1) | 20.0 ms | 19.4 ms | 18.8 ms |
| 11 fitted team cars | 31.7 ms (max 65.2) · trap 3.0 km/h | — | — |
| 150 concept mutations | 16.5 ms (114 in box) | 91.2 ms (150 in box) | 168.7 ms (150 in box) |
| 150 uniform random concept designs | 1 in box (refused) | 150.4 ms (148 in box) | 225.1 ms (148 in box) |
| ranking ρ / sign agreement / best child same | 0.994 / 98.7 % / 93.9 % | 0.993 / 99.0 % / 95.0 % | 0.994 / 99.0 % / 97.5 % |

**v0's fresh-check errors grew** (concept mutations 26.8 / 19.3 ms → 91 / 169 ms): concept cars now land in a different part of
v0's wide, clamped box. v0 is the secondary sim; ranking agreement is unchanged. The physics surrogate (primary) is as accurate as before.

## 5. Speed

Node 22, one call, warm (median of batches; `report.machine.timing` in each file):

| | quadratic | RBF (600 centres) | MLP 2×32 | as saved (mixed) |
|---|---|---|---|---|
| lap only (`predictLap`), physics | **1.7 µs** | 34 µs | 7.3 µs | 7.5 µs |
| lap only, v0 | **1.9 µs** | 29 µs | 6.4 µs | 6.5 µs |
| all targets (`predict`), physics (30 targets) | 27 µs | | | 75 µs |
| all targets, v0 (7 targets) | 8.5 µs | | | 8.6 µs |
| the sims themselves | physics 10–45 ms; v0 3–13 ms | | | |

Training (this machine, ~1 effective core): physics 6,000 runs ≈ 1–2 min of sim time, fitting ≈ 35 s, checks ≈ 11 s; v0 ≈ 1 min per
circuit.

## 6. Uncertainty propagation

`predictWithUncertainty(pcMean, pcStd, n, { circuit, sim, seed })`: `pcStd` mirrors the PhysicalCar shape with a standard
deviation on any numeric leaf (e.g. a telemetry-derived car's error bars); leaves are sampled independently (normal, seeded), every
target gets mean / std / p05 / p95, plus `std_total` = √(std² + surrogate RMSE²) (parameter spread plus model error), and the share
of samples outside the box. Example, the Red Bull car with σ: mass 3 kg, ClA front / rear 0.07 / 0.09 m², CdA 0.027 m², μx and μy
0.03, ICE 8 kW (n = 10,000, 0.8 s): **lap 88.84 ± 0.54 s** (p05 87.97, p95 89.74), trap 307.6 ± 1.6 km/h, 0.3 % of samples outside
the box. On 300 paired samples the sim gives 88.767 ± 0.582 s and the surrogate 88.793 ± 0.589 s (per-sample RMSE 34 ms): the
spread is right, the mean carries the surrogate's +26 ms local bias. Correlated inputs are not modelled (sample them yourself and
call `predict`).

## 7. Retrain (one command)

```bash
node concept/surrogate/train.js --sim physics      # the physics sim: concept/sim/index.js simulateLap, Silverstone, Red Bull centre (~3-4 min)
node concept/surrogate/train.js --sim v0           # sim v0: Silverstone + Monza (~2 min)
# options: --circuits a,b  --n 6000  --seed 1  --workers N  --classes quadratic,rbf,mlp  --rbf-centres 600  --mlp-epochs 400  --quick
# any other sim with the contract sim(pc, trackId, conditions):
node concept/surrogate/train.js --sim-name mysim --sim-module concept/mysim/index.js --sim-export simulateLap --centre sim-baseline --box concept
```

The physics sim is still being improved (energy deployment strategy, axle grip). After any change to it, re-run the first command:
the box (team cars), the targets (whatever the sim returns: lap, sectors, speeds, energy, `speeds_kmh.*`, and per-corner apex
speeds from its `cornerTable` windows) and the report all follow the sim. Each model stores `sim_fingerprint` (the sim's lap, trap
and vmin for the centre car at training time); the tests compare it with the live sim and fail with the retrain command if they
differ, so a stale surrogate cannot pass unnoticed. For a given seed the file is byte-identical except `report.machine` (timings).
The trainer writes only to `--out` (default `concept/surrogate/models/`) and refuses `data/` and `data-mock/`. No network, no Mubit.

## 8. Limits

1. **It imitates a sim.** Its errors are against that sim; the sim's own gaps to real cars (SIM.md: 13 km/h speed RMS on held-out
   laps, mid-speed corners 20–40 km/h slow, v0's anchoring of the baseline at pole) are inherited unchanged.
2. **Accurate near the centre, coarse at the edges.** Lap RMSE 20–30 ms within 0.2 of the centre, 100–400 ms near the box corners.
   For a final answer, re-run the sim on the optimiser's best design (asSim's `fallback`, or bench with the real sim).
3. **No extrapolation.** Outside the box `predict` returns `ok: false` and names the fields; `predictLap` returns NaN; `asSim` throws
   or falls back. A stalled floor is outside the physics box. Concept cars reach the physics model only through `relativeCar`.
4. **Noise and steps in the sim.** The physics sim's energy strategy search makes the trap, vmax and energy targets step between
   nearby cars; the surrogate smooths these (energy R² 0.90).
5. **Dry, still air, the sim's default conditions only.** Weather, fuel or recharge-limit changes need a retrain with those
   conditions (or the sim itself).
6. **One circuit per model.** Physics: Silverstone (the sim's only track today). v0: Silverstone and Monza.
7. **Independent normal inputs** in the Monte Carlo; real error bars are often correlated (ClA and CdA move together).
