# Red Bull RB22 / Red Bull Ford DM01: the data sheet

This is the one sheet every model in the repo should take its Red Bull numbers from. It covers engine speed, transmission,
energy, mass, tyres, brakes, acceleration, cornering, aero and setup, and says for each number whether it is a rule, an official
figure, a press report, a measurement from public telemetry, a fit made in this repo, or an estimate. Every unpublished
quantity has an estimate with a range. Nothing here is team data.

| | |
|---|---|
| Data | `concept/data/rb22-sheet.json`: 108 entries `{ id, group, label, value, unit, sd_or_range, kind, sources[], derivation, used_by[] }`, the cited sources (URL + what was read), the full telemetry analysis, and the sim check |
| Tool | `node concept/tools/rb22-sheet.js` prints the table and the sim check; `--write` regenerates the JSON (deterministic, ~3 s); `--check` fails if it is stale |
| Test | `test/concept-rb22-sheet.test.js`: schema, wording, the telemetry block reproduces exactly, every sim input classified and the contradiction list current |
| Built on | [REDBULL.md](REDBULL.md) (public dossier), [REDBULL-DERIVED.md](REDBULL-DERIVED.md) (one-lap inverse dynamics), [IDENTIFY.md](IDENTIFY.md) (9-circuit fit), [SIM.md](SIM.md) (physics sim v3), [PRIORS.md](PRIORS.md), [MASS.md](MASS.md), [DATA.md](DATA.md) |
| Researched | 2026-10-24 (all web sources accessed that day; new ones: Brembo's 2026 circuit pages, The Race on 2026 rake, wheelbase tables) |

**Kinds.** `regulation`: FIA 2026 Section C, Issue 19 (in force at Silverstone; unchanged in Issue 21 unless noted).
`official`: FIA, F1, team, Pirelli or supplier document. `reported`: press, third-party simulations, forums (grade in each
source's `how`). `derived`: computed here from public telemetry or regulation numbers. `fitted`: a model estimate made in this
repo; it is an *effective* value of that model. `estimate`: judgement where nothing is public, always with a range.

## Telemetry used

All 25 Red Bull Racing laps in `concept/data/telemetry` (OpenF1, ~3.7 Hz `car_data`), with the team taken from each lap file
per event:

- **Qualifying, 17 laps at 9 circuits.** HAD and VER at Silverstone, Red Bull Ring, Hungaroring, Monaco, Montreal, Spa and
  Suzuka. LAW and VER at Monza, where OpenF1 has LAW in the Red Bull. VER only at Singapore, where HAD had a powertrain
  failure in Q1.
- **Silverstone race, 8 laps.** HAD laps 40/43/44/45 and VER laps 3/40/42/44, on medium tyres with race fuel.

The audit policy is the one in `concept/identify/data.js`: only FAILs act. Three race laps (HAD 45, VER 42 and 44) carry the raw
brake 104 code, so their brake channel is excluded. The WARN-level dropouts on the Suzuka laps are masked point by point. No
Red Bull lap is excluded outright. Spa's files have no raw samples, so Spa gives gearing from the 5 m grid but no braking peaks.

Shift points, gear ratios and braking peaks come from the raw samples. Acceleration, clipping and cornering come from the 5 m
grid with the identify conditioning: a ±0.45 s local quadratic for dv/dt, a +1.8 / −6.5 g plausibility mask, and
x/y smoothing over max(6 m, 0.3 s·v) for curvature.

## Summary

± is one sd unless a range is given. The JSON holds the full derivation, every source and the files that use each number.

| Quantity | Value ± | Kind | Source |
|---|---|---|---|
| ICE crank power (≥ 10,500 rpm) | **410 ± 15 kW** (385–430) | estimate | FIA design 400; ADUO: DM01 best ICE; press 421; identify 424 ± 19; sim 396 |
| ICE efficiency at full fuel flow | 0.492 ± 0.018 | estimate | 410 / 833.3 kW (C5.2.3) |
| ICE power curve | 0.492·(0.27N + 165)/3.6 kW below 10,500 rpm, flat 410 above | derived | C5.2.4 shape × efficiency |
| ICE torque | 373 Nm at 10,500 rpm (388 at 6000, 306 at 12,800) | derived | P/ω of the curve |
| Peak crank power (ICE + MGU-K) | 749.5 ± 15 kW | derived | 410 + 350 × 0.97 (redbull.com: ~745) |
| Rev limit (rules) | none (C5.14 band only) | regulation | Section C |
| Highest rpm seen | 12,857 (race); Q max 12,808; median of lap maxima 12,403 | derived | 25 laps |
| Upshift rpm | **12,045 ± 573** (p10–p90 11,402–12,811) | derived | 465 upshifts |
| Downshift landing rpm | 10,564 ± 850 | derived | 358 downshifts |
| MGU-K | 350 kW DC, 500 Nm, taper 1800 − 5v (0 at 345 km/h) | regulation | C5.2.7–8, C5.2.11 |
| Energy store window / recharge cap | 4 MJ / 8.5 MJ (Silverstone Q 6.5) | regulation / official | C5.2.9–10, FIA PU info |
| Superclip power | 350 kW (250 before Miami) | reported | Crash.net, The Race |
| Energy deployed, Silverstone Q lap | 5.95 ± 1.0 MJ (max possible 10.5) | fitted | derive-car |
| Clipping, Silverstone Q | 380 m per lap, from ~297 km/h, −0.13 g | derived | telemetry |
| Gears | 8 forward; ≤ 200 ms up / 300 ms down | regulation | C9.6.1, C9.8.4 |
| km/h per 1000 rpm, gears 1–8 | 8.42 / 10.55 / 12.97 / 15.64 / 18.61 / 21.84 / 25.00 / 27.98 | derived | all laps |
| Final drive | 3.7 (3.0–4.5) | estimate | not identifiable; only the product is |
| Ratio change in 2026 (C9.6.2) | none in gears 6–8 (8th spread 0.34 % over 8 circuits) | derived | telemetry |
| Torque cut per upshift | 0.02 s (0.005–0.05) | estimate | seamless shift (forum, unverified) |
| Driveline efficiency | 0.95 ± 0.01 | estimate | priors |
| Mass with driver, no fuel | **775 ± 4 kg** (770–780) | estimate | RN365 +9/10 kg (Apr), The Race +6/7 (Jun) |
| Qualifying fuel | 6 ± 2 kg | estimate | judgement |
| Front weight share | 0.45 ± 0.007 | estimate | C4.2 window; McLaren 44–46 %; mass sheet 0.4496 |
| CoG height | 0.29 ± 0.025 m | estimate | academic 0.30; mass sheet 0.280 |
| Yaw inertia | 540 (480–620) kg·m² | estimate | academic, scaled |
| Unsprung mass | 64 / 69 kg (±20 %) | estimate | MASS.md |
| Wheelbase | 3.400 m | reported | third-party tables = C2.3.3 max |
| Track front / rear | 1.540 / 1.470 m | regulation | C10.10.1 maxima |
| Tyres front / rear | 280 × 705 / 375 × 710 mm, 18 in | official | Mercedes F1, Pirelli |
| Loaded radius | 0.348 ± 0.006 m | estimate | half the published diameters minus deflection |
| μ_y / μ_x (physical, at the static load) | 1.8 ± 0.1 / 1.75 ± 0.1 | estimate | academic F1 tyre |
| Load sensitivity | 4.5 ± 0.75 %/kN | estimate | academic 4.9–5.0 |
| Peak deceleration, hardest stop | **4.0 ± 0.5 g** | derived | telemetry 4.19 (two-interval) / 4.39 (one-interval); Brembo sim 3.8 |
| Brake balance (front, friction + regen) | 0.57 ± 0.03 | estimate | axle loads at 4 g |
| Brake cap | 5.0 g (4.5–6.0), non-binding | estimate | judgement |
| Full-throttle accel 100–150 / 150–200 / 200–250 / 250–300 / 300+ km/h | 1.47 / 1.25 / 0.75 / 0.32 / 0.03 g | derived | 9 circuits |
| Corner-exit accel 60–160 km/h | 1.16–1.20 g (p90 1.35–1.55) | derived | 9 circuits |
| Wheel power, 150–250 km/h (p90) | 676–685 kW (max possible 712) | derived | dE/dt + drag (CdA 1.20) |
| Lateral g at corner minima, 50–100 / 100–150 / 150–200 / 200–250 km/h | 2.87 / 3.39 / 4.36 / 5.32 g | derived | v²·max\|κ\| (reads 20–40 % high) |
| Lateral limit at 100 / 200 / 250 km/h | 3.09 / 4.95 / 5.75 g (±0.06–0.12) | fitted | identify |
| Top speed, Silverstone Q lap | 316 km/h (FIA trap HAD 305.8 / VER 304.3; race 331.7) | derived / official | telemetry, FIA |
| ClA, Corner Mode, physical | 3.9 (3.2–4.6) m² | estimate | priors |
| ClA, sim-effective | 5.316 m² | fitted | sim (5.32 × 0.9992) |
| CdA Corner / Straight, effective | **1.20 ± 0.15 / 0.95 ± 0.15 m²** | fitted | derive-car 1.23, identify 1.26, sim 1.23 |
| Straight Mode ΔCdA | 0.27 ± 0.06 m² | derived | activation step, 22 laps |
| CdA / ClA Straight ÷ Corner | 0.80 ± 0.05 / 0.72 ± 0.04 | reported | two third-party simulations |
| Aero balance (front) | 0.44 ± 0.02 | estimate | worked examples 0.41–0.44 |
| Floor share of downforce | 0.55 (0.45–0.65) | reported | simulation 47 %, reports ~60 % |
| Ride-height sensitivity | 0.5 (0.3–0.8) %/mm | estimate | no public number |
| Ride height front / rear, rake | 30 (20–45) / 70 (50–95) mm, 0.7° (0.3–1.2) | estimate | The Race: rear higher than 2025 |
| Heave stiffness | 3500 (2000–6000) N/mm | estimate | ~5 mm squat at 300 km/h |
| Roll stiffness, front share | 0.55 (0.45–0.65) | estimate | judgement |
| Diff locking on / off throttle | 0.6 (0.4–0.9) / 0.3 (0.1–0.5) | estimate | judgement |
| Silverstone wing level (identify trims) | downforce trim +0.05 ± 0.11, drag trim +0.24 ± 0.11 | fitted | identify |

## 1. Engine (Red Bull Ford DM01)

The rules fix the shape of the ICE power curve. Fuel energy flow is capped at 3000 MJ/h at 10,500 rpm and above, and at
0.27N + 165 MJ/h below that (C5.2.3–4). Only the efficiency is unknown.

| rpm | 6000 | 7000 | 8000 | 9000 | 10,000 | 10,500 | 11,000 | 12,000 | 12,800 |
|---|---|---|---|---|---|---|---|---|---|
| Fuel power, kW (regulation) | 496 | 571 | 646 | 721 | 796 | 833 | 833 | 833 | 833 |
| ICE, kW (× 0.492) | 244 | 281 | 318 | 355 | 392 | **410** | 410 | 410 | 410 |
| Torque, Nm | 388 | 383 | 379 | 376 | 374 | 373 | 356 | 326 | 306 |

- **410 kW ± 15 is an estimate.** No Red Bull or Ford figure exists. The FIA ADUO review places the DM01 at the top of the
  ICE ranking (Mercedes 2–4 % below, the rest more than 4 % below), so it sits at or above the generic 400 kW.
- **Cross-check.** The three repo fits bracket the estimate: identify 424 ± 19 kW (prior-dominated), sim 396 kW, derive-car
  396 kW (an assumed efficiency). Speed traces cannot split ICE power from drag (IDENTIFY.md). The better-determined
  combination is P/CdA = 340 ± 35 kW/m².
- **Engine speed.** The rules set no rev cap. Fuel flow is flat above 10,500 rpm, so the useful band is 10,500 to ~12,800 rpm.
- **Shift points.** The median upshift is 12,045 rpm, between a lower bound of 11,274 (last sample before the shift) and an
  upper bound of 12,754 (first sample after it, converted back to the old gear). Downshifts land at ~10,560 rpm.
- **Earlier figure.** derive-car's "shift 11,480 rpm" is the lower bound.

## 2. Energy

- **Rules.** MGU-K 350 kW (339.5 kW mechanical), 500 Nm, taper 1800 − 5v (Overtake 7100 − 20v), 4 MJ window, 8.5 MJ recharge
  per lap, 6.5 MJ in Silverstone qualifying. The C5.12 power-reduction rates and the Silverstone sector tables are in
  `ers.power_reduction_rules`.
- **Deployment (fitted, derive-car).** About 6 MJ on the Silverstone Q lap. The full 350 kW goes only out of slow corners onto
  long straights. The physics sim's own plan deploys 8.0 MJ. That is a model output, not an input.
- **Clipping (derived).** Speed falls at full throttle on the straights. Per circuit:

| | Silverstone | Austria | Hungaroring | Montreal | Monza | Spa | Suzuka | Monaco / Singapore |
|---|---|---|---|---|---|---|---|---|
| m per Q lap | 380 | 208 | 83 | 398 | 563 | 993 | 610 | 0 |
| onset km/h | 297 | 316 | 330 | 296 | 321 | 300 | 303 | – |
| deceleration g | 0.13 | 0.36 | 0.40 | 0.25 | 0.05 | 0.13 | 0.14 | – |

The signature also contains the C5.2.8 taper above 290 km/h, Straight Mode closing, wind and grade. None of those has a channel.

## 3. Transmission

| Gear | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| km/h per 1000 rpm | 8.42 | 10.55 | 12.97 | 15.64 | 18.61 | 21.84 | 25.00 | 27.98 |
| ± (between laps) | 0.33 | 0.20 | 0.14 | 0.21 | 0.14 | 0.07 | 0.05 | 0.02 |
| rpm per km/h | 118.8 | 94.8 | 77.1 | 64.0 | 53.8 | 45.8 | 40.0 | 35.75 |
| Overall ratio (r 0.348 m) | 15.59 | 12.44 | 10.12 | 8.39 | 7.05 | 6.01 | 5.25 | 4.69 |
| km/h at 12,000 rpm | 101 | 127 | 156 | 188 | 223 | 262 | 300 | 336 |
| laps with the gear | 10 | 21 | 23 | 24 | 25 | 25 | 25 | 23 |

- **1st gear** is used only at the slow circuits (Monaco, Montreal, Monza, Singapore, Spa, Suzuka).
- **Low-gear spread.** Low gears spread more because wheelspin lowers km/h per rpm.
- **No ratio change detected.** 8th gear is the same within 0.34 % from Suzuka (March) to Singapore (October), so Red Bull
  shows no change of final drive or top-gear pairs. A change of a low pair smaller than ~2 % cannot be ruled out.
- **What cannot be split.** The gearbox / final-drive split is not observable. Any split with the same product drives the same.
- **Speed traps.** Silverstone Q 305.8 / 304.3 km/h (HAD / VER), race 331.7 / 330.8. Monza Q 326.7, race 333.5 (FIA).

## 4. Mass, geometry, tyres

- **Mass, 775 ± 4 kg (estimate).** The car was reported +9/10 kg over 768 in April and ~+6/7 in June, with more weight due off at
  Austria. The sim uses the generic 770 kg (see contradictions). derive-car and identify use the April figure (779.5 kg).
- **Front axle share and CoG.** The C4.2 window leaves 0.44–0.46 front. The CoG is 0.29 ± 0.025 m.
- **Geometry.** The wheelbase is 3.400 m (reported, equal to the C2.3.3 maximum). The track widths, 1.540 / 1.470 m, are the
  C10.10.1 maxima. derive-car's 1.58 / 1.52 m was outside the rule and is corrected on this branch.
- **Tyres.** 280 × 705 mm front and 375 × 710 mm rear on 18 in rims (official). Silverstone minimum start pressures are 28 / 26
  psi and the camber limits −2.75° / −1.5°.
- **Physical μ and load sensitivity.** These are estimates in the academic band. Each model's effective μ is listed with it in
  the JSON.

## 5. Brakes

The sim's v3 braking term contradicts Brembo's simulated figures: the sim uses 4.01 g, measured, against Brembo's 3.1–3.8 g.
This section resolves that by matching, at each circuit, the Red Bull stop nearest Brembo's simulated hardest stop:

| Circuit | Brembo (simulated) | Measured entry → min km/h | one-interval peak g | two-interval peak g | mean g | Brembo g |
|---|---|---|---|---|---|---|
| Silverstone | 268 → 116 | 254 → 110 | 3.27 | 3.11 | 1.54 | 3.1 |
| Red Bull Ring | 306 → 149 | 283 → 133 | 4.25 | 3.79 | 2.17 | 3.8 |
| Hungaroring | 332 → 99 | 308 → 98 | 4.75 | 4.26 | 1.98 | 4.0 |
| Monaco | 276 → 132 | 278 → 114 | 3.74 | 3.17 | 2.03 | 4.0 |
| Montreal | 306 → 147 | 308 → 139 | 4.91 | 4.19 | 2.23 | 3.7 |
| Monza | 318 → 87 | 325 → 77 | 4.97 | 4.26 | 2.01 | 3.8 |
| Singapore | 298 → 144 | 307 → 134 | 4.39 | 4.35 | 2.36 | 4.0 |
| Spa | 285 → 86 | no raw samples | – | – | – | 3.6 |

- **Reading.** The one-interval peak over ~0.27 s (the sim's `BRAKE_TELEMETRY` method) takes the maximum of a noisy difference,
  so it reads high: median 4.39 g. The two-interval peak over ~0.5 s reads 4.19 g, and Brembo's simulations 3.8 g. Silverstone
  and Austria agree with Brembo to 0.01 g. The sheet's 4.0 ± 0.5 g covers all three. The sim's own tyre-limited capacity at
  226 km/h is 4.42 g: inside.
- **Village (T3).** The two Red Bull laps read 3.27 / 3.11 g at Village, where the sim's 4.01 g was taken over all 22 laps.
  For Red Bull the disagreement with Brembo's 2.9–3.1 g is smaller than that field median suggests.
- **Brake-on time per lap.** Measured and Brembo agree within 1.6 s at Austria (10.4 / 10.5 s), Hungary (15.9 / 16.7),
  Montreal (13.4 / >14), Singapore (21.9 / 21.6) and Monaco (17.9 / 16.3). At Silverstone (10.2 / 6.5) and Monza (10.4 / <8.5)
  the flag also counts light dabs that Brembo's 3 and 5 zones leave out.
- **Brake-on times per stop** are shorter than Brembo's, because the flag drops before the minimum speed.
- **Peak deceleration by speed** (all stops, including light ones), two-interval: 1.9 g at 120–180 km/h, 2.9 g at 180–240,
  3.0 g at 240–300. Race laps are lower: median peak 2.3 g against 3.2 in Q.
- **Balance and cap (estimates).** Brake balance is 0.57 front. The 5 g mechanical cap is above the tyre limit, so it never binds.

## 6. Acceleration and power

| Speed band km/h | 100–150 | 150–200 | 200–250 | 250–300 | 300–350 |
|---|---|---|---|---|---|
| Full-throttle accel, g (median) | 1.47 | 1.25 | 0.75 | 0.32 | 0.03 |
| ± / p90 | 0.11 / 1.66 | 0.25 / 1.55 | 0.34 / 1.07 | 0.30 / 0.66 | 0.18 / 0.37 |
| Kinetic power m·a·v, kW | 459 | 497 | 383 | 191 | 23 |
| Wheel power (+ drag, CdA 1.20), kW | 505 | 589 | 559 | 481 | 410 |
| Wheel power p90, kW | 565 | 676 | 685 | 666 | 641 |

- **Exits.** Below 100 km/h the throttle is rarely at 99 %. Corner exits at 60–160 km/h (≥ 50 % throttle) average 1.16–1.20 g,
  with p90 1.35–1.55 g.
- **Wheel power.** The 150–250 km/h p90 of ~680 kW matches full ICE plus near-full MGU-K: (410 + 339.5) × 0.95 = 712 kW. The
  fall above 290 km/h is the C5.2.8 taper plus clipping.
- **Conditional figure.** Kinetic power is model-free given the mass. Wheel power depends on CdA: ±0.15 m² moves it ±45 kW at
  250 km/h.

## 7. Cornering

**Lateral g at grip-limited corner minima.** 9 circuits, Q laps. The estimator is v²·max|κ| on each lap's own x/y, the same as
concept/identify. It reads ~20–40 % above an x/y-acceleration estimate:

| km/h | 50–100 | 100–150 | 150–200 | 200–250 | 250–330 |
|---|---|---|---|---|---|
| a_y g (median ± sd) | 2.87 ± 0.38 | 3.39 ± 0.76 | 4.36 ± 0.62 | 5.32 ± 0.65 | 5.42 (n = 4) |
| sim capacity at mid-band | 2.14 | 2.65 | 3.42 | 4.43 | – |
| ratio | 1.34 | 1.28 | 1.28 | 1.20 | – |

The ratio is the documented scale between the two estimators, and the sim check bounds it to 1.1–1.45.

**Silverstone corners.** Red Bull Q laps, HAD and VER, which differ by ≤ 6 km/h. "Flat" means throttle ≥ 95 % through the
corner, so its lateral g is a lower bound.

| T | Corner | Min km/h | a_y g | | T | Corner | Min km/h | a_y g |
|---|---|---|---|---|---|---|---|---|
| 1 | Abbey | 293 | 2.97 (flat) | | 10 | Maggotts | 283 | 5.65 (flat) |
| 2 | Farm | 279 | 4.37 (flat) | | 11 | Maggotts | 272 | 2.91 (flat) |
| 3 | Village | 110 | 2.67 | | 12 | Becketts | 232 | 5.34 |
| 4 | The Loop | 86 | 2.93 | | 13 | Becketts | 211 | 4.64 |
| 5 | Aintree | 193 | 2.59 (flat) | | 14 | Chapel | 224 | 4.77 (flat) |
| 6 | Brooklands | 164 | 4.04 | | 15 | Stowe | 223 | 5.68 |
| 7 | Luffield | 112 | 2.99 | | 16 | Vale | 104 | 2.24 |
| 8 | Woodcote | 270 | 2.34 (flat) | | 17 | Club | 104 | 2.24 |
| 9 | Copse | 282 | 6.34 | | 18 | Club | 162 | 3.59 |

The other 8 circuits' corner tables are in `lat.corners_by_circuit`. From the 9-circuit identify fit, Red Bull's lateral limit is
3.09 / 4.95 / 5.75 g at 100 / 200 / 250 km/h. That puts it in the leading group at high speed. In qualifying it lost its time
to pole in Becketts and Stowe (REDBULL.md).

## 8. Aero

| | Value | Kind | Note |
|---|---|---|---|
| ClA Corner Mode, physical | 3.9 (3.2–4.6) m² | estimate | sourced prior; not public for any car |
| ClA, sim-effective | 5.316 m² | fitted | absorbs the sim line's curvature and its tyre law (~1.36 × physical) |
| ClA, identify / derive-car | 7.36 ± 0.97 / 2.86 ± 0.94 m² | fitted | each effective for its own tyre law |
| CdA Corner, effective | 1.20 ± 0.15 m² | fitted | derive-car 1.23, identify 1.26, sim 1.23; includes scrub and cooling |
| CdA Straight, effective | 0.95 ± 0.15 m² | fitted | sim 0.99, derive-car 0.96, identify 0.91 |
| ΔCdA Straight Mode | 0.27 ± 0.06 m² | derived | power step at activation, 22 laps |
| Straight ÷ Corner: CdA / ClA | 0.80 ± 0.05 / 0.72 ± 0.04 | reported | third-party simulations −18/−21 % drag, −25/−31 % downforce |
| Aero balance front | 0.44 ± 0.02 | estimate | not separable from these data |
| Floor share | 0.55 (0.45–0.65) | reported | |
| Silverstone trim vs 9-circuit mean | downforce e^0.05, drag e^0.24 | fitted | the drag trim also absorbs deployment strategy |

- **Effective values.** Every absolute aero number is an effective value of a model. Compare cars through the lateral envelope
  a_y(v) and P/CdA, not through ClA.

## 9. Setup values (for the setup-factor work)

The sim does not read any of these yet. Each is an estimate, with a range, for wiring gear ratios, roll stiffness split,
heave / spring / rake, brake bias and ducts, the diff and the energy map:

| Quantity | Value (range) | Basis |
|---|---|---|
| Gear ratios | the table in §3 (measured) | telemetry |
| Final drive | 3.7 (3.0–4.5) | only gear × final drive is observable |
| Ride height front / rear | 30 (20–45) / 70 (50–95) mm | 2026 cars run higher rear ride heights than 2025 (The Race) |
| Rake | 0.7° (0.3–1.2) | (70 − 30) / 3400 mm |
| Heave stiffness | 3500 (2000–6000) N/mm | ~5 mm squat at 300 km/h; 2026 platforms less stiff |
| Roll stiffness front share | 0.55 (0.45–0.65) | front-biased to protect rear traction |
| Brake balance front | 0.57 (0.52–0.62) | axle loads at 4 g; rear includes regen |
| Brake cooling, Silverstone | low (Brembo index 1/5) | ducts can run small; disc window 400–800 °C |
| Diff locking on / off throttle | 0.6 (0.4–0.9) / 0.3 (0.1–0.5) | hydraulic diff, driver-adjusted per phase |
| Energy map, Silverstone Q | 6.5 + 4 MJ; full 350 kW out of Village/Loop, Luffield and Club; superclip at the ends of the long straights | derive-car, FIA tables |
| Suspension | pushrod front and rear (reported; Wikipedia says pull-rod front) | Gary Anderson |

## 10. The physics sim's RB22 against this sheet

`simCheck()` classifies every number the physics sim uses for the RB22. That is 49 inputs: the car's fields from
`baselineCar("redbull")`, the MODEL constants, the REGS constants and the default conditions. Each comes out equal (23),
inside the sheet's sd (13), mapped by a documented rule (7), or contradicting the sheet (6).

- **Agrees with the sheet (by construction).** Where nothing better is public, the sheet takes the sim's own assumption, with
  the reasoning: floor share 0.55, heave 3500 N/mm, brake balance 0.57.
- **Mapped.** CLA (effective, equal to the sheet's sim-effective entry), the static ride height, the stall margin, the
  non-binding 12.5 MJ deploy cap, the 8.5 MJ harvest cap (min with the event's 6.5), C_rr and the rotating-mass factor.

**Contradictions** (`sim_check.contradictions`; lap effect = the sim lap with the sheet value substituted):

| Sim input | Sim | Sheet | z | Lap effect | Where it comes from |
|---|---|---|---|---|---|
| `mass_kg` | 770 | 775 ± 4 | −1.25 | +0.034 s | the generic prior's 770 kg; the RB-specific excess is not applied (physical.js says "768 kg" in its basis text) |
| `gearing.rpm_per_kmh[1]` | 91.69 | 118.8 ± 4.6 | −5.9 | −0.018 s | extrapolated in `fit.js derivedOverrides` from the HAD row (gears 4–8 only) |
| `gearing.rpm_per_kmh[2]` | 80.13 | 94.82 ± 1.8 | −8.4 | +0.023 s | same |
| `gearing.rpm_per_kmh[3]` | 70.03 | 77.10 ± 0.8 | −8.5 | +0.017 s | same |
| `gearing.rpm_per_kmh[4]` | 61.2 | 63.96 ± 0.85 | −3.3 | −0.008 s | `redbull-2026.json rpm_per_kmh_by_gear_HAD_Q` (≥ 99 % throttle on one lap) |
| `gearing.rpm_per_kmh[5]` | 53.1 | 53.75 ± 0.41 | −1.6 | 0.000 s | same |

All six together, with the measured shift point, change the RB22 lap by **+0.042 s**. The fix for the integrator is to replace
`rpm_per_kmh_by_gear_HAD_Q` with the measured 8-gear row `kmh_per_1000rpm_by_gear_all_RB_laps` (as 1000 / value), set the mass
to 775 kg, and re-pin the RB22 lap in `test/concept-coupling.test.js`. That test pins 88.763 s to 0.5 ms, which is why this
branch reports the fix instead of making it.

**Effects in the sim found while checking.** These are not sheet contradictions. `sim_check.lap_sensitivity_per_sd` moves one
sheet quantity by ±1 sd at a time:

| Quantity (±1 sd) | +1 sd | −1 sd |
|---|---|---|
| ICE ±15 kW | −0.61 s | +0.60 s |
| CdA ±12.5 % | +1.44 s | −1.49 s |
| μ_y ±0.1 | −1.13 s | +1.13 s |
| CLA ±5 % | −0.48 s | +0.40 s |
| ΔCdA Straight Mode ±0.06 m² | −0.31 s | +0.32 s |
| μ_x ±0.1 | −0.28 s | +0.31 s |
| driveline efficiency ±0.01 | −0.26 s | +0.22 s |
| aero balance ±0.02 | +0.03 s | +0.27 s |
| front weight ±0.007 | +0.08 s | −0.17 s |
| CoG ±25 mm | −0.02 s | −0.06 s |
| mass ±4 kg | +0.01 s | −0.09 s |
| fuel ±2 kg | −0.04 s | −0.05 s |

- **A ridge in the energy plan.** Adding 2 kg of fuel *and* removing 2 kg both make the lap faster, by ~0.045 s, and so does
  ±25 mm of CoG. The RB22 baseline sits on a ridge of the regulated energy plan, larger than the ~0.015 s step noise SIM.md
  states.
- **Mass slope.** Over ±10 kg the slope is 0.019 s/kg, below the public 0.025–0.035 s/kg (Horner, Michelin).
- **What dominates.** Drag, tyre grip and ICE power dominate the remaining uncertainty. The sheet's ±1 sd on each is worth
  0.5–1.5 s of lap time. That is why CdA is quoted as an effective value with three cross-checks, and why grip is quoted as a
  measured envelope.

## 11. How part changes move these numbers

Design changes reach the car through `concept/physical.js` as anchor + (design − baseline). [COUPLING.md](COUPLING.md) lists,
for each of the 23 shape parameters, which PhysicalCar fields it moves and the lap effect on the RB22 anchor. In terms of this
sheet:

| Sheet quantity | Moved by (COUPLING.md §2) | Not moved by any part (fixed here) |
|---|---|---|
| `mass.car_no_fuel`, `mass.cog_height`, `mass.weight_dist_front`, `mass.yaw_inertia`, `mass.unsprung` | every part's mass and position via `parts.massSheet` (wheelbase, cockpit length, bulkhead gap, wings, floor, sidepods), with automatic ballast to C4.1 | the mass anchor itself |
| `aero.cla_*`, `aero.balance_front`, `aero.cda_*` | wing span, chord, AoA and elements; floor width, throat and ride height; diffuser expansion; sidepod inlet (cooling drag) | the effective scale (sim fit) |
| `aero.straight_mode_delta_cda`, `aero.straight_over_corner_*` | front / rear flap angles (`sm_delta_deg`), rear-wing elements (1 element: no Straight Mode) | |
| `pu.ice_power_peak` | cooling derate from the sidepod inlet (PKG-COOLING) | the 410 kW / 396 kW anchor; fuel-flow shape (regulation) |
| `setup.ride_height_*`, `aero.ride_height_sensitivity` | `floor.ride_height_mm` (one static value) | front/rear split and rake (not in the design yet) |
| `tx.gear*`, `pu.upshift_rpm`, `tyre.*`, `brake.*`, `tx.drivetrain_efficiency`, `geom.track_*` | none: "the anchor's (no design parameter moves them)" (physical.js) | all of these, until the setup-factor work wires gear ratios, roll split, heave/rake, brake bias, diff and energy map from §9 |

Sizes from this sheet:

- 1 kg is worth ~0.02 s per lap in the sim (0.025–0.035 in public estimates).
- 1 % of ICE power is worth ~0.15 s (also Michelin's 2018 figure).
- 1 % of CdA is worth ~0.12 s; 1 % of CLA ~0.09 s.
- A 0.01 shift in front weight share is worth 0.1–0.2 s, because the sim takes the weaker axle with no setup trim
  (COUPLING.md §6). That is the main reason the roll-stiffness split and brake balance in §9 are needed.

## 12. What stays unknowable from public data

- **The DM01's actual ICE power, efficiency map and torque curve.** Only the regulated fuel-flow shape and a ranking are
  public. The power-to-drag ratio is identifiable; the split between the two is not.
- **Absolute CdA and ClA per mode, and the aero balance.** Every value here is effective for a model. Straight Mode ΔCdA is the
  one aero number measured directly.
- **The gearbox / final-drive split and the nominated ratio set.** Overall ratios are measured to 0.02–0.3 %.
- **Exact car mass, CoG height, yaw inertia, unsprung mass.** The FIA does not publish masses.
- **Setup.** Ride heights, rake, spring / heave / roll rates, diff maps, brake balance per corner, wing level. Estimates only.
- **Deployment and harvest maps per circuit.** Inferred from the power balance, not known.
- **Energy-store cell supplier and chemistry.** Nothing in the lap models depends on it.
- **Nominal Tyre Mass and Pirelli's 2026 friction and load-sensitivity data.**
- **Telemetry limits.** Shift times shorter than ~0.27 s cannot be measured at 3.7 Hz.
