# More factors: gearing, roll stiffness split, heave stiffness, brake balance

Version: **more-factors v1** · 2026-10-24 · branch `claude/more-factors` (from `claude/happy-darwin-eoivl5` f932a5f, merged with
1cd63d5: the RB22 data sheet). Label on every number below: **"concept · design deltas (part-mass, concept aero map v1, set-up v1
estimates) on the physics sim's estimated car"**.

The owner asked for factors that make the model more accurate, not more numerous. Each factor here had to pass three tests:

1. it is a real design or set-up choice a 2026 team makes;
2. it is checked against the FIA 2026 Technical Regulations (Section C, Issue 19, 25 June 2026) where the rules touch it;
3. it changes the simulated lap through physics that is in the sim (or added to it here), with sources or flagged estimates.

Five parameters passed (23 → 28). Eight candidates were rejected or left fixed (§5). The design space grows from about
10^38.7 to **10^48.5** discrete shape and set-up combinations (×10^15.9 for the material choices on 13 parts). Their RB22
baselines are the RB22 data sheet's (`concept/data/rb22-sheet.json`, docs/concept/RB22_SHEET.md): ratios measured on all 25
Red Bull laps, roll split 55 %, heave 3500 N/mm, brake balance 57 % (the last three are the sheet's estimates; no team publishes them).

The same pass also took the RB22 sheet's contradicting inputs into the sim and removed the energy plan's jumps (§4), then re-estimated
the baseline and refit the team cars (`node concept/sim/build-fit.js`): **generic baseline 88.100 s** (pole 88.111; was 88.107),
**RB22 88.745 s** (HAD 88.746; was 88.763), held-out mean speed RMS 9.88 km/h (was 10.10), held-out sector bias +0.144 / +0.042 /
−0.191 s (was +0.172 / +0.015 / −0.192).

Code: `concept/parts.js` (catalogue, `GEARS`, `SETUP`, `gearSet`, `heaveRatio`, `val`), `concept/physical.js` (mapping),
`concept/aeromap.js` (dynamic compression), `concept/sim/lapsim.js` (`MODEL.rev`, `brakeBias`, LLTD, `RK`, platform onset, plan
smoothing), `concept/sim/fit.js` (RB22 sheet inputs, team fit with them), `concept/regs.js` (`SETUP_RULES`),
`concept/surrogate/features.js` (v5). Tests: `test/concept-factors.test.js` (14 tests), rows in `test/concept-coupling.test.js`, the
oracle in `test/concept-regs-checklist.test.js`.

## 1. The factor table

Δlap is measured one change at a time from the RB22 baseline, at −10 % / +10 % of the baseline value (for `gearbox.step`, ±10 % of
the spread `step − 1`; a step of 1 means no spread). Three columns:

- **reg** = the default `"regulated"` plan on the RB22 anchor (what the bench scores);
- **marg** = the `"marginal"` plan on the RB22 anchor (a second energy policy: where the two disagree, the effect runs through the
  energy plan rather than through grip or drag);
- **gen** = `"regulated"` on the generic anchor.

† = the changed car is illegal (the bench would not score it; the sim laps it for this audit).

| Parameter | RB22 base (source) | Why it is real | Regulations | Mechanism in the sim | Δlap −10 % (reg / marg / gen) | Δlap +10 % (reg / marg / gen) | Status of the numbers |
|---|---|---|---|---|---|---|---|
| `gearbox.top_kmh` (final drive: 8th-gear km/h at 12 000 rpm) | 336 (12 000 / 35.75 rpm per km/h, all 25 RB laps, `redbull-2026.json` `kmh_per_1000rpm_by_gear_all_RB_laps`) | teams nominate one ratio set and final drive for the season | C9.6.1 (8 ratios), C9.6.2 (nominated, one change in 2026), C9.8.2 (80 km/h at 15 000 rpm), PKG-GEAR-TOP | all eight ratios scale → engine speed at a given car speed: the fuel-energy-flow ramp below 10 500 rpm (C5.2.4), how many up-shifts the lap needs (each a 30 ms drive cut), the over-rev loss above the shift rpm and the rev limiter | 302 †: +0.049 / −0.234 / +0.042 | 370: +0.001 / −0.001 / −0.010 | ratios measured; 13 000 rpm limiter and 3 %/1000 rpm over-rev loss estimates; 30 ms cut an existing sim estimate |
| `gearbox.step` (mean ratio step 4th→8th) | 1.156 ((63.96 / 35.75)^(1/4), same row; the measured low gears are wider) | gear-pair choice: spacing vs engine speed after each shift | C9.6.1-C9.6.3, C9.8.2 | ratios spread about 8th: a closer box makes the low gears longer (slow corners at low rpm, on the C5.2.4 ramp); a wider box drops below 10 500 rpm after each shift and, with a short final drive, breaks C9.8.2 in 1st | 1.140: +0.003 / +0.026 / 0.000 | 1.172: +0.035 / +0.057 / +0.027 | as above |
| `setup.roll_front` (front share of roll stiffness, % front) | 55 (RB22 sheet `setup.roll_stiffness_front_share`, range 45-65, estimate) | anti-roll bars and springs are the main balance trim; COUPLING.md §6 flagged the sim's untrimmed axle-balance kink | C10.2.2 (axles independent), C10.2.5 (no adjustment in motion), C10.4.3 (springs, torsion bars allowed) | front share of lateral load transfer `lltd = anchor lltd + Δweight split + (share − 55 %) × elastic share`; the RB22 anchor carries the sheet's split (`lltd = 0.45 + (0.55 − 0.45) × 0.715 = 0.5215`); load-sensitive tyres lose grip on the axle that takes more transfer; exit traction reads the rear axle's own lateral utilisation (`RK`) | 49.5: −0.073 / −0.091 / −0.013 | 60.5: +0.101 / +0.095 / +0.056 | elastic share 0.715 from the mass sheet with 40 mm roll centres (estimate) |
| `setup.heave_n_mm` (whole-car heave stiffness at the tyre contact) | 3500 N/mm (RB22 sheet `setup.heave_stiffness`, range 2000-6000, estimate = the sim's platform) | ground-effect cars are run on stiff heave springs to hold the floor's gap | C10.2.6(c) (no ride-height control), C10.4.3 (springs only, no fluid springs), PKG-FLOOR-STALL | platform stiffness = anchor 3500 × design / 3500: squat under aero load → ride-height downforce (0.6 %/mm) and the floor's stall margin (design layer: dynamic compression 5 mm × 3500 / k); the stall onset as a squat is geometric and does not move | 3150: −0.001 / −0.015 / −0.001 | 3850: +0.005 / +0.009 / +0.003 | effective value of the model (a physical series rate of springs and ~330 N/mm tyres would sit below ~1300 N/mm: the 5 mm squat is relative to the static reference) |
| `setup.brake_bias` (brake balance, % front) | 57 (RB22 sheet `brake.balance_front`, range 52-62, estimate) | the balance bar and brake-by-wire set the front/rear split | C11.1.1 (one pedal, one circuit per axle), C11.1.4 (driver's direct input), C11.6 (rear BBW ≤ 1.2 × driver pressure) | a fixed front share brakes at `min(F_front / b, F_rear / (1 − b))` with the axle loads moved by the car's own deceleration, relative to the same at 57 %; the MGU-K harvests from the rear share `1 − b` | 51.25: +0.074 / −0.004 / +0.061 | 62.75: +0.120 / +0.144 / +0.121 | physics exact for a fixed balance; one balance for the lap is conservative (drivers trim it, BBW migrates it) |

Reading the table: the roll split is the strongest new lever. The sheet's 55 % leaves the RB22 front-limited (aero balance 0.441 <
weight 0.45, and more front transfer on top); trimming to 42-45 % is worth ≈ −0.10 s (regulated), and below ≈ 40 % the rear axle's
traction utilisation takes over. Brake balance has a broad optimum at 55-59 %; a front-heavy balance costs > 0.1 s. Heave is small
and monotone (softer: more ride-height downforce) until PKG-FLOOR-STALL binds (3000 N/mm is legal at 35 mm, illegal at 34 mm).
Gearing acts mostly through the up-shift count and the energy plan: its ±10 % numbers are "small and plan-dependent", not a slope.

## 2. Each factor in detail

### 2.1 Gear ratios (`gearbox.top_kmh`, `gearbox.step`)

- **Data.** km/h per 1000 rpm by gear on all 25 Red Bull laps (17 qualifying laps at 9 circuits + 8 Silverstone race laps; steady
  gear, no brake, rpm > 6000): 8.417, 10.546, 12.971, 15.636, 18.605, 21.838, 25.0, 27.975 → 118.8 … 35.75 rpm per km/h. The
  earlier single-lap row (HAD Q, gears 4-8, 1-3 extrapolated) was up to 23 % off in 1st (RB22_SHEET.md). `parts.GEARS`.
- **Mapping.** Design ratios `k_g = ref_g × (336 / top_kmh) × (step / 1.156)^(8 − g)`; `physical()` applies the same scale and
  spread to the anchor's own ratios, so the baseline is the anchor exactly. Shift rpm stays the anchor's (PU and calibration locked).
- **Sim (`MODEL.rev`).** Above the shift rpm (only reachable in 8th) ICE power falls 3 % per 1000 rpm (estimate: friction power
  rises ≈ N², about 9 kW per 1000 rpm at 12 000 rpm for 1.6 L at ≈ 3.5 bar FMEP); the drive (ICE and MGU-K, which both drive through
  the gearbox) is cut over the last 200 rpm before a 13 000 rpm limiter (estimate: Section C has no rev cap, C5.14 only a 750 rpm
  band; the highest 2026 Silverstone Q rpm seen is 12 579). The baseline never reaches its shift rpm in 8th.
- **Rules.** `REG-C-GEAR-80KMH` (C9.8.2: every gear ≥ 80 km/h at 15 000 rpm, i.e. ≤ 187.5 rpm per km/h; the measured 1st leaves
  room, a 290 km/h final drive with a 1.24 step breaks it). `PKG-GEAR-TOP` (concept rule from C9.6.2: one ratio set for the whole
  season, so 8th at the limiter must reach the RB22's best 2026 trap, 333.5 km/h at Monza: `top_kmh ≥ 309`). `REG-C-GEARS` (info).
- **Honesty note.** With the up-shift cut set to zero the final drive moves the regulated lap by only a few ms across 306-380 km/h:
  at Silverstone in qualifying the car is energy-limited on the straights, so the C5.2.4 ramp mostly costs superclip headroom. The
  response is a staircase (≈ 7 ms per up-shift saved) whose size is set by the 30 ms cut assumption; the marginal plan reads a short
  final drive as much faster (−0.23 s at 302 km/h), the regulated plan as slower: the effect runs through the energy policy.

### 2.2 Roll stiffness split (`setup.roll_front`)

- **Physics.** The total transfer moment `m a h` splits between the axles by the roll stiffness split (elastic part), the roll
  centres (geometric part) and the unsprung masses. Elastic share = `m_s (h_s − h_rc) / (m h)` from the mass sheet (roll centres
  40 mm, estimate) = 0.715 on the RB22: `lltd = weight split + (roll share − weight split) × elastic`.
- **Anchors.** The RB22 team car carries the sheet's 55 % (`concept/sim/fit.js` → `suspension.lltd_front` 0.5215) and was refit with
  it; the generic car declares none (lltd = its weight split, as the calibration assumed). `physical()` adds the design's change.
- **Sim.** `buildTables` uses `lltd` for the per-axle transfer in both tyre laws (each axle still makes `m_axle·a`). The rear axle's
  lateral limit at the weight-split transfer over its limit at this split (`RK`) scales the friction-ellipse utilisation used for
  traction, so taking transfer off the front costs exit traction: an interior optimum, not "always further rearwards".
- **Rules.** `REG-C-SUSP-PASSIVE` (info: C10.2.2, C10.2.4-C10.2.6, C10.4.3). An anti-roll bar is a spring between the two rockers
  of one axle: legal (C10.2.2 forbids coupling the axles, not the wheels of one axle); no adjustment while moving: one value per lap.

### 2.3 Heave stiffness (`setup.heave_n_mm`)

- **Physics.** The platform's vertical stiffness sets the squat under aero load: the sim's 3500 N/mm (≈ 5 mm under ≈ 17.5 kN), which
  the RB22 sheet adopts. A design's platform = anchor × (design / 3500).
- **Two layers, one geometry.** The design layer's dynamic compression becomes `5 mm × 3500 / k`, so the stall margin (and the
  diffuser's best angle, which depends on the dynamic gap) follow the springs; PKG-FLOOR-STALL then binds a soft car at a lower
  ride height and lets a stiff one run lower (32.5 mm is illegal at 3500 N/mm, legal at 7000). The sim's stall onset as a squat is
  `5 × 3500 / k + margin` = the same geometric gap for any springs; only how far the car squats at a given speed changes.
- **Considered, not added.** Tyre load variation over bumps (stiffer, larger load swings, the power-law tyre loses a little mean
  grip): ≈ 0.02 % of grip per doubling at a 10 % load swing, and the swing would need a road-roughness input that is not available.
- **Rules.** `REG-C-SUSP-PASSIVE` (info), `PKG-FLOOR-STALL` (concept model, unchanged rule; the margin it reads now depends on the
  springs). REG-C-PLANK still reads the static ride height (no existing rule weakened).

### 2.4 Brake balance (`setup.brake_bias`)

- **Physics.** With a fixed balance `b` the car brakes until the first axle saturates: `F = min(F_front / b, F_rear / (1 − b))`,
  the axle loads moved by `m·a·h / wheelbase` at the car's own deceleration (fixed point, 4 iterations). The calibration fitted the
  braking capacity with an ideal balance; the real car ran its own balance, so the sim scales the calibrated capacity by
  `F(b) / F(57 %)` per speed. Best fixed balance for the RB22 below the 5 g brake cap: 59 % at 80-200 km/h; above ≈ 250 km/h the
  5 g cap binds whatever the balance. The MGU-K harvests from the rear share `1 − b`.
- **Rules.** `REG-C-BRAKE-BALANCE` (info: C11.1.1, C11.1.4, C11.6).

## 3. Interactions (combined ≠ sum)

| Interaction | Mechanism | Measured (RB22) | Test |
|---|---|---|---|
| Roll split × aero balance | the best split is where neither axle limits first; more front wing wants more front roll stiffness | best split at 220 km/h: 30 % (front wing 22°) → 32.5 % (25°) → 60 % (29°); lap (marginal): roll 45 % −0.148 s, front wing 27° −0.332 s, both −0.218 s (int +0.262 s) | `concept-factors` "roll split × aero balance"; `concept-coupling` front × rear wing at 45 % |
| Brake balance × CoG height | a higher CoG moves more load forward under braking, so the best fixed balance moves forward | best balance at 120 km/h: 57.5 % (h 0.27 m), 59 % (0.30), 61.5 % (0.36) | "brake balance × CoG height" |
| Heave × ride height (legality) | the stall margin loses both the static-height and the squat millimetres | 3000 N/mm: −0.83 mm margin; ride height 34: −1.00 mm; alone legal, together PKG-FLOOR-STALL | "heave" |
| Final drive × drag | a lower-drag rear wing buys top speed only until the limiter | rear wing 14°: +3.3 km/h vmax at the RB22 final drive, +0.3 km/h at a 292 km/h final drive | "gearing × drag" |

## 4. The energy plan's jumps, found and removed

The RB22 baseline sat on a local lap-time peak in mass (±2 kg of fuel both ≈ 0.045 s faster) and 0.5 kg of extra ballast made it
0.058 s **faster**. Traced to five hard switches in the `"regulated"` plan (`concept/sim/lapsim.js`), each now continuous:

| Switch | What jumped | Fix (MODEL constant) |
|---|---|---|
| Part-throttle harvest at an apex the car only just touches | a whole 2.5 m step of ICE surplus (16 kJ at Becketts) appeared or vanished | scaled by how much speed the grip limit took off the step (`sens_reset_dv` 1.5 m/s) |
| Value-of-a-joule reset at grip-limited points | a one-point touch cut the costate in two (×3 at Maggotts) | soft reset by the same measure |
| ERS-K reaching 100 kW inside a rate-limited period (C5.12.6) | a 146 kW step one grid point earlier or later | the step's power is the time-weighted mix at the crossing |
| Clip threshold from the recharge allowance | the sens of the point that filled the allowance (a staircase) | interpolated within that point |
| The store's binding trough; the C5.12.7 speed threshold; a period's initial step | the binding minimum switching troughs; a 1.5 km/h move across 300 km/h; a 2 kW dip triggering a 150 kW cut | soft minimum over troughs (`soc_soft_mj` 0.03 MJ, conservative: the true minimum stays ≥ 0); ±3 km/h blend (`reg_vthr_band_kmh`); initial step scaled by the dip (`reg_start_ramp_kw` 20 kW) |

After the fixes, mass is monotone over ±4 kg in 0.5 kg steps on both anchors (tested), ±2 kg of fuel is −0.040 / +0.039 s on the
RB22 (symmetric), and a 1e-7 rounding of the aero coefficients moves the lap by ≤ 0.001 s (was 0.011 s). The mass slope is
**0.0195 s/kg** on the RB22 (0.019 generic; the `"marginal"` and `"threshold"` plans give 0.021-0.023). That is below the public
rule of thumb (0.025-0.035 s/kg, a fuel-effect figure from race stints on pre-2026 cars); in this model a 2026 qualifying lap is
energy-limited and the plan re-optimises deployment for a heavier car. Not tuned.

**Braking target (BRAKE_TELEMETRY).** The field-wide 4.01 g is the median of each lap's single-interval peak deceleration in the
Village zone (740-860 m); on 0.16-0.8 s samples that estimator is biased high by noise (per-lap values 2.9-6.2 g). A two-interval
peak gives a field median of 3.16 g (RB: HAD 3.48, VER 2.74, matching the sheet's 3.1-3.3 g). The like-for-like comparison is the
same estimator on the sim's own trace: 4.2-4.5 g two-interval (RB22 4.23-4.37), i.e. the sim brakes ≈ 1 g harder into Village than
the cars did (no brake-pressure rise time in a QSS model). For the team cars the term does not enter at all (they share the
baseline's μx and are fitted on lap and trap only). The right target for the calibration is the two-interval median through the
same estimator on the sim trace; changing it re-estimates μx for every car, so it is left as a recommendation (not done here).

## 5. Rejected or left fixed

| Candidate | Decision | Why |
|---|---|---|
| Differential (entry / exit lock; sheet estimate 0.3 / 0.6) | rejected | C9.9.1 only allows torque to go from the faster to the slower wheel (locking). The sim's traction is already the axle total (a locked-diff idealisation); what a diff setting trades (entry stability, mid-corner rotation against exit traction) is yaw dynamics a point-mass QSS sim does not have, so a lock parameter could only be monotone: an exploit, not physics. `REG-C-TORQUE-TRANSFER` records the rule. |
| Rake (sheet estimate 0.7°), anti-dive / anti-squat | rejected | The sim has no pitch degree of freedom and the aero map no rake term; the design layer's single ride height is a mid-plank value. C10.2.6(b) permits fixed anti-geometries; noted for a future pitch model. |
| Energy deployment map / harvest split | rejected | Not a free design choice in the model: the sim solves the plan per car under C5.12 (value of a joule, power-reduction periods) and the C5.2 limits; exposing its policy widths could only detune it. |
| Brake duct size | rejected | No brake thermal model (the sheet rates Silverstone's brake demand low); without one, duct drag would be free to cut. Disc / caliper sizes are fixed by C11.3. |
| Cooling louvres / bodywork exit area | rejected | The sidepod inlet already prices cooling drag against the PU derate (PKG-COOLING); an exit-area term needs an internal-flow model the aero map does not have. |
| Front-wing flap gap / overlap, rear-wing main-plane / flap split | rejected | The concept aero map cannot price their Corner Mode cost (separation, slot effects); a larger flap would only gain Straight Mode relief: an exploit. |
| Tyre pressures and camber | fixed | Set by the tyre supplier's prescriptions (minimum pressures, maximum camber); teams run at those limits. No contact-patch or camber-thrust model. |
| Tyre load variation with spring rate | not added | Computed ≈ 0.02 % grip per doubling; needs a road-roughness input (§2.3). |

## 6. Contract changes

**PhysicalCar** (all additive; the sim reads each only when present, so a car without them laps as before):

| Field | Meaning | Read by the sim | In `bench.js simKey` today? |
|---|---|---|---|
| `gearing.rpm_per_kmh[8]` | now moved by the design (final drive, spread) | yes (existing) | yes (`g`) |
| `gearing.rev_limit_rpm` (optional) | overrides `MODEL.rev.limit_rpm` | yes | yes (`g`) |
| `suspension.lltd_front` | front share of lateral load transfer | **yes** | **no: add `pc.suspension`** |
| `suspension.{roll_stiffness_front, elastic_share, heave_n_mm}` | the inputs, for display | no | — |
| `aero.heave_n_per_mm` | platform stiffness (was read, now set) | yes (existing) | yes (`a`) |
| `aero.dyn_compression_mm` | the design layer's dynamic compression | no (the sim derives it from `heave_n_per_mm`) | — |
| `brakes.bias_front`, `brakes.bias_ref` | fixed brake balance and the reference it is measured against | yes | yes (`b: pc.brakes`) |

**Designs.** `params.gearbox.{top_kmh, step}` and `params.setup.{roll_front, heave_n_mm, brake_bias}`. A design saved before
v1 has none of them: `parts.val()` reads the catalogue base, `design.migrate()` fills them in, `design.validate()` asks for them.

**Surrogate features v5.** RAW gains `lltd_offset`, `heave_n_per_mm`, `brake_bias_front`, `gear_top_kmh`, `gear_step` (27);
FEATURES gains `lltd_offset`, `balance_trim`, `heave_compliance`, `brake_bias_front`, `gear_top_rel`, `gear_step` (31).
SURROGATE_NUMBERS_PLACEHOLDER
