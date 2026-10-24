# PURPLE · CONCEPT race weekend model (Silverstone)

Version 0 · 2026-10-24 · branch `claude/concept-weekend` · file `concept/weekend/weekend.js` · tests `test/concept-weekend.test.js`
Label on every number: **"concept weekend model · &lt;sim label&gt; · real 2026 British GP lap data"**

## 1. What it is

`concept/bench.js` turns a car into one qualifying lap. This module turns that lap into a **weekend**: a qualifying position among
the real 2026 British GP qualifying laps, and a 52-lap race against the real 2026 field. It produces the single **weekend score** the
optimiser maximises. It is a reduced-order race-pace model built on public lap data. It does not model tyre temperatures, ERS
deployment, safety cars or overtaking moves. Competitors are not simulated cars: each real driver runs at their own measured 2026 race
pace (`EI.RACEPACE.silverstone.r`) through the same fuel and tyre model as our car. The result is **relative** and calibrated to the
real field.

```
car (PhysicalCar | Design | { lap_s }) ──sim(pc @ 10 kg, softs, "silverstone", conditions)──▶ quali lap (real s)
  ├─ qualifying: insert among the real 2026 best quali laps q ──▶ grid slot, gap to pole
  └─ race: our median race lap = quali lap + field-median (r − q) gap; per lap = base + fuel + compound + degradation
           real drivers: per lap = r − model median excess + the same fuel/compound/degradation
           strategy = min total time over every 1- and 2-stop (two compounds); lap 1 spread by grid slot; dirty air within 1 s
           ──▶ classification, our position, gap to winner ──▶ weekend_score
```

## 2. API (`window.EI.concept.weekend` / `require("./concept/weekend/weekend.js")`)

| Call | Returns |
|---|---|
| `qualifying(car, { sim, conditions, replace })` | `{ lap_s, pos, field_size, pole_s, pole_code, gap_to_pole_s, grid: [{ pos, code, lap_s }], label }` |
| `race(car, { sim, laps = 52, conditions, seed, noise_s = 0, strategy, fuel, replace, params })` | `{ total_s, pos, field_size, grid, gap_to_winner_s, gap_to_best_other_s, best_other, winner, strategy: { name, stops, stints, pit_laps, chosen_by, alternatives }, pace: { race_lap_median_s, race_mode_offset_s, fuel_s_per_kg, fuel_basis, dirty_air_laps, fastest_lap_s }, classification, label }` |
| `score(car, opts)` (same opts) | `{ quali: { lap_s, pos, field_size, gap_to_pole_s, pole_code }, race: { total_s, pos, field_size, grid, gap_to_winner_s, gap_to_best_other_s, winner, strategy, pace, classification }, weekend_score, components: { quali_margin_s, race_margin_s_per_lap, weights, definition }, params_from, label, ms }` |
| `calibration(opts)` | the field-vs-model table of §4 |
| `strategies(params)`, `params(overrides)`, `PARAMS`, `tyreLoss`, `fuelAt` | internals, exported for tests and the lab UI |

- `car`: a `PhysicalCar` (the bench contract), a `Design` (converted with `concept/physical.js`, qualifying session) or `{ lap_s }`
  (a lap already run, e.g. `bench(...).circuits.silverstone`). This module does not check legality. `bench()` does that, and an
  illegal car has no lap to score.
- `sim`: default `bench.simV0`. The concept/sim/ physics sim plugs in through the same argument, with no other change. The sim is
  called **once** per weekend: `sim({ ...pc, fuel_kg: 10, tyres: { ...pc.tyres, compound: "soft" } }, "silverstone", conditions)`.
  With `fuel: "sim"` it is called a second time at the 70 kg start fuel (see §3).
- `strategy`: omit it to get the minimum-time choice. A number forces the best plan with that many stops. A stint list
  `[{ compound, laps }]` forces that exact plan.
- `replace`: driver code(s) to drop from the real field (our car takes that seat). By default our car is a 23rd entry.
- `seed` only matters with `noise_s > 0` (seeded Gaussian per-lap noise, `design.seededRng`). The default race is fully
  deterministic, and the same inputs give byte-identical output.
- `conditions` goes straight to the sim. sim v0 accepts dry, still air only.

## 3. The model and every parameter

**Qualifying.** Our lap goes into the real best qualifying laps (best per driver across Q1–Q3, `EI.RACEPACE.silverstone.q`). Grid
slot = 1 + the number of real laps strictly faster, so a tie goes to our car, exactly as `bench.weekend()` does. Grid order is
by best lap. The real grid had penalties (GAS +3, STR to the back), and they are not applied.

**Race lap time.** For car *i* on lap *L* (compound *c*, tyre age *a* laps, fuel *f(L)*):

`t = base_i + k_fuel · (f(L) − 10 kg) + offset_c + deg_c · a + cliff_c · max(0, a − cliffLap_c)`  (+ lap-1, pit, dirty-air terms)

- Real driver *i*: `base_i = r_i − E_med`. `E_med` is the model's median fuel + tyre excess over green laps on the reference
  strategy. The driver's modelled median green lap is therefore their real `r_i`.
- Our car: `base = q_sim + RMO`, with `RMO = median_i(r_i − q_i) − E_med` (the **race-mode offset**). Our median race lap is
  therefore our sim quali lap plus the field's median race-vs-quali gap.

In the default fuel mode `E_med` cancels: our pace relative to driver *i* is `(q_sim − q_i) + (median gap − gap_i)` on every lap.

**Lap 1.** Grid order is kept through lap 1. The field finishes lap 1 spread by `grid_spread_s_per_slot` per slot on top of the pace
differences, and every car pays `start_lap_extra_s`. **Dirty air**: a car that starts a lap less than `dirty_air_gap_s` behind
the car ahead (by cumulative time) loses `dirty_air_s` on that lap. Nothing else models overtaking. A car passes when its cumulative
time drops below the car ahead's. Because of this, a car that is less than 0.25 s/lap quicker stays parked about 1 s behind, and
a car that is quicker than that gets through. The **pit loss** is added to the in-lap. **Strategy** is the minimum of tyre time
plus pit losses over every one-stop and two-stop plan (all compound sequences that use two compounds, every pit lap, stints of 5
laps or more), computed in clean air. Fuel does not depend on the strategy and every car shares the tyre model, so the optimum is the
same for every car. The strategy is computed once and cached.

| Parameter | Value | Status | Source / basis |
|---|---|---|---|
| `laps` | 52 | official | formula1.com circuit page, FIA final race classification. Read from `concept/data/silverstone-2026-weekend.json` (`circuit.race_laps`) when that file is present |
| `pit_loss_s` | 20.0 s | reported | formula1.com, "Need to know … ahead of the 2026 British Grand Prix": "Pit stop time loss – 20 seconds (includes 2.5s stop)". The 2025 preview gave 19.9 s. A pre-event figure, not measured in this race. Overridden by `race.pit_loss_s` in the weekend data file if that field ever appears |
| `quali_fuel_kg` | 10 kg | assumption | `concept/physical.js` `REF.fuel_kg` (estimate). The sim's quali lap and the real `q` laps are taken to be at this load |
| `start_fuel_kg` | 70 kg | assumption | Widely reported 2026 figure (down from about 100–110 kg). Not in Section C |
| `end_fuel_kg` | 1 kg | assumption | FIA fuel sample at the flag. Burn = (70 − 1) / 52 = 1.33 kg per lap, constant |
| `fuel_s_per_kg` | 0.030 s/kg | assumption | Common rule of thumb, also cited in CONCEPT.md. Applied to every car. `fuel: "sim"` uses the sim's own slope for our car instead (sim v0: 0.0122 s/kg, see §5) |
| `compounds` | soft C3: +0.00 s, 0.090 s/lap, cliff after 20 laps · medium C2: +0.35 s, 0.035 s/lap, cliff 33 · hard C1: +0.65 s, 0.025 s/lap, cliff 45 · post-cliff +0.4 s/lap per lap | compound names official, numbers assumption | C1/C2/C3 is Pirelli's Silverstone 2026 selection (weekend data file `tyres`, formula1.com preview). Offsets, linear degradation and cliffs are assumptions tuned to three targets. (a) A C3+C2 one-stop is fastest, which is what Pirelli expected ("one-stop … C2 and C3 the main choices"). (b) The best two-stop is clearly slower: model +7.9 s. Pirelli's 2023 Silverstone estimate was one-stop ≈ 13 s faster. (c) Fuel + tyres explain a minority of the real race-vs-quali gap (§4) |
| `two_compound_rule` | true | reported | Long-standing Sporting Regulations rule (at least two dry compounds in a dry race). The 2026 article was not read |
| `start_lap_extra_s` | 4.0 s | assumption | Standing-start lap 1 over a flying lap. The same for every car, so it moves totals, never positions |
| `grid_spread_s_per_slot` | 0.5 s | assumption | Typical dry-start lap-1 gaps. No start-reaction model, no lap-1 incidents |
| `dirty_air_gap_s` | 1.0 s | official | 2026 overtake-mode detection gap (weekend data file `overtake_mode.detection_gap_s`, Sporting Regs B7.2), used as the close-following threshold |
| `dirty_air_s` | 0.25 s/lap | assumption | Following loss inside 1 s, net of the follower's overtake-mode energy |
| `max_stops` | 2 | assumption | 0-stop plans are illegal under the two-compound rule. 3-stop plans are not searched: with no safety car and this degradation a third pit loss never pays |
| `min_stint_laps` | 5 | assumption | Shortest stint the search considers |
| `weights` | quali 0.4, race 0.6 | assumption | See §6 |

Every parameter can be overridden per call: `opts.params = { pit_loss_s: 22, compounds: { soft: { deg_s_per_lap: 0.12 } } }`.
`score().params_from` lists any value the weekend data file supplied.

## 4. Calibration evidence: real field vs model

Data: `EI.RACEPACE.silverstone` (2026 British GP): `q` is the best qualifying lap, `r` is the median green-flag race lap,
`fastestLap` is the fastest race lap.
The race was dry. It had two VSCs and a late Safety Car (weekend data file), and those laps are not green-flag laps.

**Field distribution of the race-vs-quali gap (r − q), 22 drivers:** median **5.942 s**, P10 5.538, P90 6.424, min 4.459 (COL),
max 6.481 (HUL). This is a big gap. 2026 race laps are energy-limited (8 MJ recharge per lap in the race vs 6.5 in qualifying,
lift-and-coast) and tyre-managed.

**Model decomposition of the median gap:**

| Component | Model | Note |
|---|---|---|
| Fuel at the median green lap | 0.705 s | ≈ 33.5 kg above the quali load × 0.03 s/kg |
| Compound + degradation at the median green lap | 0.665 s | reference strategy 1-stop S18–M34 |
| **Model excess (fuel + tyres)** | **1.370 s** | `E_med` |
| **Race-mode offset (RMO)** | **4.572 s** | = 5.942 − 1.370. This is everything the fuel and tyre terms leave out: race energy management, tyre-saving pace, engine modes, and traffic inside the real medians |

**Per driver: our car's rule applied to each real driver.** Model r = q + field-median gap, against real r:

| Driver | q | r (real) | r − q | model r | residual |
|---|---|---|---|---|---|
| LEC | 88.286 | 93.940 | 5.654 | 94.228 | −0.288 |
| ANT | 88.111 | 94.058 | 5.947 | 94.053 | +0.005 |
| HAM | 88.458 | 94.138 | 5.680 | 94.400 | −0.262 |
| VER | 88.893 | 94.176 | 5.283 | 94.835 | −0.659 |
| RUS | 88.481 | 94.483 | 6.002 | 94.423 | +0.060 |
| NOR | 88.877 | 94.723 | 5.846 | 94.819 | −0.096 |
| HAD | 88.746 | 94.745 | 5.999 | 94.688 | +0.057 |
| PIA | 89.032 | 94.990 | 5.958 | 94.974 | +0.016 |
| LAW | 89.300 | 95.637 | 6.337 | 95.242 | +0.395 |
| BOR | 89.461 | 95.667 | 6.206 | 95.403 | +0.264 |
| GAS | 90.063 | 95.675 | 5.612 | 96.005 | −0.330 |
| LIN | 89.305 | 95.681 | 6.376 | 95.247 | +0.434 |
| COL | 91.321 | 95.780 | 4.459 | 97.263 | −1.483 |
| HUL | 89.539 | 96.020 | 6.481 | 95.481 | +0.539 |
| ALB | 90.638 | 96.457 | 5.819 | 96.580 | −0.123 |
| SAI | 90.562 | 96.499 | 5.937 | 96.504 | −0.005 |
| OCO | 90.680 | 96.514 | 5.834 | 96.622 | −0.108 |
| BEA | 90.501 | 96.925 | 6.424 | 96.443 | +0.482 |
| PER | 91.451 | 96.989 | 5.538 | 97.393 | −0.404 |
| BOT | 91.227 | 97.675 | 6.448 | 97.169 | +0.506 |
| ALO | 93.025 | 98.775 | 5.750 | 98.967 | −0.192 |
| STR | 92.863 | 98.907 | 6.044 | 98.805 | +0.102 |

Mean absolute residual **0.310 s/lap**. That is how far a driver's race form can sit from their quali form. Our car's race pace
inherits this uncertainty: the model gives it the field-median race form. COL is the outlier: he qualified poorly and raced well.

**Strategy.** Model best: 1-stop S18–M34 (tyre and pit time 65.3 s). Medium–hard one-stop +0.2 s. Best two-stop
S12–M20–M20 +7.9 s. The pit-loss sweep is 5 / 10 s → two-stop and 15–30 s → one-stop. Pirelli expected a one-stop on C2/C3 for
2026, so the model matches.

**Real field alone.** Run with our car far behind so that it never interacts, the model order is ANT LEC HAM VER RUS HAD NOR PIA LAW
LIN BOR GAS HUL COL SAI ALB OCO BEA PER BOT STR ALO. LEC has the best race pace (93.940) but sits within 1 s behind ANT (pole) and
does not have the 0.25 s/lap needed to pass. The real result was LEC RUS HAM NOR HAD LAW LIN BOR COL GAS PIA … ANT 15th. That
result was shaped by the Safety Car (it compressed the top 16 to 8.2 s), a 5 s penalty for ANT and pit timing. The model has none of
these, so the real classification is **not** a target. The real winning time, 1:27:11.335, includes VSC and SC laps. The model's
green race is about 4,930 s against 5,231 s.

**Not explained: median vs fastest lap.** The real fastest race laps are a median 2.03 s quicker than each driver's median lap.
The model's quickest green lap is only 0.12 s under its median. The fuel burn-off (−0.04 s/lap) and the tyre degradation largely
cancel, so the model never produces the real push laps (overtake mode, tow, fresh tyres after the late SC). It reports
`pace.fastest_lap_s` as a model value only and does not use it in the score.

## 5. Results with sim v0 (bench default, 2026-10-24)

| Car | Quali lap | Quali | Race | Gap to best other (s) | weekend_score |
|---|---|---|---|---|---|
| **Baseline concept car** | 88.111 | **P1** (tie with ANT, ours by rule) | **P1** | −1.26 | **+0.015** |
| Straight-mode flaps (front 12°, rear 20°) | 87.804 | P1 | P1 | — | +0.319 |
| `{ lap_s: 88.2 }` | 88.200 | P2 | P3 | +6.1 | −0.106 |
| `{ lap_s: 88.5 }` | 88.500 | P5 | P6 | +25.5 | −0.449 |
| `{ lap_s: 89.0 }` | 89.000 | P8 | P8 | +49.5 | −0.926 |
| `{ lap_s: 90.0 }` | 90.000 | P13 | P14 | +109.2 | −2.016 |
| `{ lap_s: 92.0 }` | 92.000 | P21 | P21 | +212.0 | −4.001 |
| Baseline, forced two-stop | 88.111 | P1 | P4 | +8.9 s vs its 1-stop | −0.089 |

**Why the baseline is at the front.** sim v0 anchors the baseline concept car to the real 2026 pole by construction (CONCEPT.md §2).
It therefore laps 88.111 s (= ANT's pole), qualifies P1, and races at q + 5.942 s = 94.053 s median. That is ANT's real race pace,
which is 0.11 s/lap slower than LEC's. From pole it keeps LEC behind in dirty air and wins by 1.3 s. A score of ≈ 0 means "level
with the best real 2026 car", which is what v0 claims for the baseline. The physics sim (concept/sim/) will place the baseline
absolutely, and the weekend model needs no change for it.

**`fuel: "sim"`** uses the sim's own fuel-mass sensitivity for our car. sim v0 charges 0.0122 s/kg against 0.03 s/kg for the field,
so our car gains about 0.5 s/lap at race start for free (baseline then wins by 24 s, score +0.282). That is why it is not the default.
Use it with a physics sim whose mass sensitivity is trusted, or calibrate `fuel_s_per_kg` to that sim.

Speed: about 2–5 ms per full weekend after warm-up with sim v0 (one sim call, 23 cars × 52 laps). The first call loads the game,
about 0.3 s.

## 6. The weekend score

```
weekend_score = 0.4 × (best real 2026 quali lap − our quali lap)
              + 0.6 × (best real competitor's race time − our race time) / 52
```

The unit is seconds per lap. **Positive means the car beats every real 2026 car**: a margin to pole and a per-lap winning margin.
Negative is the per-lap deficit to the best real car. The race term uses the best real competitor in **our simulated race**, traffic
included. It is continuous where the car is in clean air. It is flat where the car is stuck in a train (a little more pace buys
nothing until it is enough to pass), which is the real behaviour and also a plateau for the optimiser. The weights are an
assumption and can be overridden with `params.weights`.

## 7. Limits

- Relative model: competitors are their measured 2026 race pace, not cars. Our car gets the field-median race form; a real driver's
  form varies by ±0.3 s/lap (§4).
- No safety car, VSC, weather change, retirements, penalties, start reactions or lap-1 incidents. No undercut or overcut, because
  everyone pits on the same lap and the strategy is chosen in clean air. No lapping or blue flags. No tyre warm-up or out-lap loss
  beyond the 20 s pit loss.
- Tyre numbers are assumptions tuned to strategy expectations, not tyre data (no public degradation data was used). The
  dirty-air rule is the only overtaking model.
- Qualifying is one lap against best laps. It has no Q1/Q2 knockout and no track evolution.
- In the default fuel mode the sim affects the weekend only through the quali lap. Compound effects are this module's offsets, and the
  sim is always run on softs, so a physics sim's compound model is not double-counted.
- sim v0 places the baseline at the real pole by construction (CONCEPT.md §2), so v0 weekend positions rank designs. They do not
  predict where a 2026 car would really finish.
