# Monza 2026 qualifying telemetry

Real car telemetry from the 2026 Italian Grand Prix: qualifying on Saturday 5 September 2026 (OpenF1 `session_key` 11357, meeting 1293, scheduled 14:00 to 15:00 UTC). It is one of four contrasting circuits (Monza, Monaco, Spa, Red Bull Ring) collected so the car-identification models can separate engine power, drag and downforce per car. The Silverstone folder's README (`../README.md`) holds the licence and attribution text, the file format and the reasons FastF1 was not used; all of that applies here unchanged, and the notes below cover what differs.

Accessed **2026-10-24**. Nothing in this folder is synthesised. Every number comes from OpenF1 (`api.openf1.org/v1`: `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data`, `location`), the MultiViewer circuit API (corner markers) or the formula1.com classification page (cross-check only), through `../fetch/fetch_circuit.py`. OpenF1 is not associated with Formula 1, the FIA or FOM; F1 and FORMULA ONE are trade marks of Formula One Licensing B.V.; non-commercial use only, as in `../README.md`.

## Files

| File | Content | Size |
|---|---|---|
| `monza-2026-q-<code>.json` x 22 | Best valid qualifying lap of every driver, ranked in `monza-2026-q-index.json`; all SOFT. Pole: `monza-2026-q-gas.json` (`is_pole_lap`). `is_team_best` is set for GAS, RUS, PIA, LEC, VER, LIN, BOR, BEA, SAI, BOT, ALO | 67.7 to 69.6 KB each |
| `monza-2026-q-index.json` | Session info, best valid lap per driver (sectors, i1, i2, trap, compound), session-maximum i1/i2/trap per driver, lap times deleted by race control, every race-control message containing DELETED, per-file dropout lists | 16.6 KB |
| `monza-2026-q-weather.json` | 73 one-minute weather samples, 13:50 to 15:02 UTC | 5.2 KB |
| `monza-circuit.json` | 11 corner markers (number, angle, x/y in metres, distance on the pole lap, match error) | 2.0 KB |
| `monza-2026-q-official.json` | The formula1.com qualifying classification (Q1/Q2/Q3 as printed), used only for the cross-check below | 4.0 KB |

Whole folder: 1558 KB. The lap files follow the Silverstone format (`driver`, `lap`, `processing`, `channels` on a 5 m grid of 1141 to 1157 points, `raw_car_data`) with these differences:

- `raw_car_data` is present in all 22 files.
- `processing.dropouts` lists telemetry dropouts and `processing.raw_car_samples_excluded_invalid` counts the samples removed; channels are `null` inside a gap (see Data quality). `lap.compound` and `lap.tyre_age_at_stint_start_laps` come from the OpenF1 stints.
- `drs` is null in the feed for every sample, as at Silverstone, so no DRS or active-aero flag is stored.

OpenF1 lists Lawson at Red Bull Racing and Tsunoda at Racing Bulls for this session, and no Hadjar; the file names and `team` fields follow OpenF1 for this session (`monza-2026-q-law.json` is team Red Bull Racing). The formula1.com classification agrees.

## Session

**Pole**: Gasly (Alpine), lap 17, 81.786 s on SOFT; Russell was second at 81.846 s (+0.060 s), Antonelli third on 81.882 s (his best lap came in Q2, lap 10, and he was P7 in the classification on his slower Q3 lap) and Piastri fourth at 81.966 s.

- **Deleted laps**: Race control deleted **3 lap times** (track limits at T1): NOR lap 2 (99.935); PIA lap 5 (107.848); VER lap 15 (447.050). VER's is a 447 s lap, evidently not a flying lap. All three are far slower than the driver's best, so none changes a best lap. Three more messages read "LAP DELETED ... (PIT)" with no time (LAW lap 18, PIA lap 19, ANT lap 19); none overlaps a selected lap.
- **Lap times against the official classification**: all 22 best valid laps match the formula1.com Q1/Q2/Q3 times to the millisecond (table below; each driver's best is the fastest of his Q1, Q2 and Q3 times).
- **Cross-check against `js/data/racepace2026.js`** (`monza`): all 22 qualifying times and the pole (GAS 81.786) agree to the millisecond. OpenF1's session-maximum speed trap is 0.0 to 0.9 km/h below the repo's one-decimal `speedTrapQuali` for all 22 drivers, which fits truncation to whole km/h, as at Silverstone.
- **Lap length**: the pole lap's speed integral is 5,743 m (X/Y path 5,755 m) against 5,793 m official (-0.9% and -0.7%). The 9 laps with no dropout give 5,754 to 5,775 m, median 5,763 m. The 13 laps with a dropout carry a distance that bridges the gap with the X/Y path (see Data quality) and sit between 5,698 and 5,778 m, a wider spread than the clean laps.
- **Weather** (73 samples, 13:50 to 15:02 UTC): rainfall max 0; air 33.6 to 34.2 degC; track 51.3 to 56.1 degC; humidity 32.1 to 35.5 %; pressure 994.4 to 994.9 mbar; wind 0.0 to 3.3 m/s. Sample nearest the end of this lap (15:00:47 UTC): air 34.1, track 51.8, humidity 33.9 %, wind 0.9 m/s from 213 deg, rainfall 0.

## Lap length and processing

Pole lap: Pierre GASLY (Alpine) lap 17, 81.786 s, SOFT. Lap length: 5743.2 m speed integral, 5755.4 m X/Y path, official 5793 m (speed integral -0.86%, X/Y path -0.65%).  
Telemetry dropouts on this lap: 1802 to 2109 m (5.3 s).

Lap length over 22 laps: speed integral 5698 to 5778 m, X/Y path 5746 to 5788 m. 9 laps without a dropout: speed integral 5754 to 5775 m, median 5763 m; X/Y median 5756 m.  
Laps with a dropout: GAS, RUS, PIA, COL, LIN, BOR, BEA, SAI, OCO, ALB, BOT, ALO, STR.

Distance is the trapezoidal integral of speed over time from the lap start (as at Silverstone), and the 5 m grid, interpolation rules and X/Y units are unchanged. Official length is 5,793 m (centre line); the cars run a racing line, so a measured length a little below it is expected.

## Pole lap: key corners

Distances are along the pole trace from the timing line. "Marker" is the MultiViewer corner position projected onto the trace (match error at most 2.1 m; the layout year served was 2021). "Entry speed" is the highest speed in the 50 m before the braking point. Where there is no local speed minimum because the car is flat out, the row gives the speed at the marker. Brake is on/off in the source, so braking points carry about +-20 m of uncertainty. Corner names are the usual Monza names matched to the speed minima (Variante del Rettifilo T1/2, Curva Grande T3, Variante della Roggia T4/5, Lesmo 1 T6, Lesmo 2 T7, Ascari T8/9/10, Parabolica T11).

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| Variante del Rettifilo (T1/2) | 885/945 | 72 | 1 | 945 | 740 | 930 | 107 |  |
| Curva Grande (T3) | 1455 | 302 | 8 | 1455 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| Variante della Roggia (T4/5) | 2010/2140 | 118 | 7 | 2110 | - | - | - | braking start falls in a telemetry dropout |
| Lesmo 1 (T6) | 2495 | 205 | 5 | 2500 | 2405 | 2420 | 234 |  |
| Lesmo 2 (T7) | 2820 | 184 | 4 | 2830 | 2730 | 2745 | 241 |  |
| Ascari (T8/9/10) | 3890/3980/4075 | 186 | 4 | 3900 | 3760 | 3790 | 326 |  |
| Parabolica (T11) | 5165 | 211 | 5 | 5120 | 4975 | 5000 | 315 |  |

**Roggia, from a second lap.** The pole lap loses its telemetry from 1,802 to 2,109 m (5.3 s), which covers the end of Curva Grande and the braking zone for the Roggia, so the first row above has no braking point and its "min speed" of 118 km/h is the first valid sample after the gap. Russell's second-fastest lap (81.846 s, dropout only at 4,173 to 4,241 m) gives for the Roggia: lift at 1,980 m, braking from 2,000 m at 308 km/h, minimum 109 km/h in 2nd gear at 2,125 m. Distances differ between laps by up to about 20 m, because each lap's distance axis is its own speed integral.


## Straights, peak speed and energy clipping

A straight here is a stretch of at least 300 m with throttle at 95% or more and no brake. "Peak minus end" is the speed lost between the peak and the lift or brake point with the throttle still down.

| Straight (from m to m) | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Peak minus end km/h | Lift or brake at m |
|---|---|---|---|---|---|---|---|
| 0 to 735 | 735 | 302 | 342 | 440 | 332 | 10 | 740 |
| 995 to 1800 | 805 | 135 | 307 | 1800 | 307 | 0 | 1805 (dropout) |
| 2850 to 3755 | 905 | 192 | 331 | 3450 | 326 | 5 | 3760 |
| 3975 to 4970 | 995 | 215 | 319 | 4870 | 313 | 6 | 4975 |
| 5170 to 5743 | 573 | 221 | 290 | 5743 | 290 | 0 | 5743 |

Lap maximum: 342 km/h at 440 m. Minimum: 72 km/h at 945 m.  
Trap readings (OpenF1) on this lap: i1 308, i2 327, finish line/trap st_speed 334 km/h.  
Full throttle (>= 99%): 73.6% of valid lap time, 80.8% of valid distance (valid = 93.4% of the lap's time); raw-sample share 76.8%. Brake on: 8.9% of valid time.  
Sectors: S1 26.817, S2 27.706, S3 27.263 s (sum 81.786); S1/S2 end at about 1865 m / 3690 m.

Monza shows little droop: 5 to 10 km/h between peak and the braking point on the three full straights (pit straight 342 to 332 km/h, Lesmo to Ascari 331 to 326, Ascari to Parabolica 319 to 313; Russell's lap: 343 to 336, 330 to 321, 327 to 321), against 38 to 45 km/h at Spa and Austria. The Curva Grande to Roggia straight ends inside the pole lap's dropout, so its end speed is not available there (Russell's lap: 309 to 303). The line straight from Parabolica is still accelerating (290 km/h) when the lap ends. Full throttle is 73.6% of valid lap time (80.8% of distance), the highest of the four circuits.

**Speed trap.** Best-fit trap position over 22 laps: 710 m on the pole trace (RMS 0.6 km/h); pole trace there: 334.0 km/h. OpenF1 does not publish where the trap is; the fit uses every driver's trap reading against his own trace.

## Best valid lap per driver

| Driver | Team | Lap | Best Q lap s | Compound | S1 | S2 | S3 | i1 | i2 | trap | max trap in session |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GAS | Alpine | 17 | 81.786 | SOFT | 26.817 | 27.706 | 27.263 | 308 | 327 | 334 | 334 |
| RUS | Mercedes | 16 | 81.846 | SOFT | 27.006 | 27.596 | 27.244 | 306 | 328 | 336 | 338 |
| ANT | Mercedes | 10 | 81.882 | SOFT | 26.957 | 27.684 | 27.241 | 301 | 319 | 330 | 330 |
| PIA | McLaren | 15 | 81.966 | SOFT | 26.931 | 27.742 | 27.293 | 308 | 323 | 325 | 327 |
| LEC | Ferrari | 14 | 82.004 | SOFT | 26.982 | 27.941 | 27.081 | 298 | 316 | 328 | 328 |
| HAM | Ferrari | 14 | 82.011 | SOFT | 26.925 | 27.867 | 27.219 | 300 | 318 | 330 | 330 |
| NOR | McLaren | 9 | 82.067 | SOFT | 26.921 | 27.823 | 27.323 | 308 | 326 | 327 | 327 |
| VER | Red Bull Racing | 13 | 82.070 | SOFT | 27.013 | 27.881 | 27.176 | 303 | 317 | 326 | 326 |
| COL | Alpine | 17 | 82.220 | SOFT | 26.874 | 27.840 | 27.506 | 308 | 328 | 332 | 335 |
| LIN | Racing Bulls | 17 | 82.286 | SOFT | 27.166 | 27.840 | 27.280 | 303 | 316 | 324 | 326 |
| BOR | Audi | 11 | 82.517 | SOFT | 27.155 | 27.859 | 27.503 | 303 | 319 | 326 | 327 |
| BEA | Haas F1 Team | 11 | 82.756 | SOFT | 27.169 | 28.181 | 27.406 | 299 | 314 | 328 | 332 |
| HUL | Audi | 11 | 82.779 | SOFT | 27.179 | 28.005 | 27.595 | 302 | 320 | 327 | 328 |
| LAW | Red Bull Racing | 16 | 82.821 | SOFT | 27.407 | 28.050 | 27.364 | 302 | 320 | 324 | 324 |
| SAI | Williams | 14 | 83.453 | SOFT | 27.096 | 28.353 | 28.004 | 304 | 322 | 328 | 333 |
| OCO | Haas F1 Team | 14 | 83.454 | SOFT | 27.283 | 28.487 | 27.684 | 298 | 309 | 325 | 326 |
| TSU | Racing Bulls | 2 | 83.755 | SOFT | 27.835 | 28.409 | 27.511 | 299 | 311 | 315 | 315 |
| ALB | Williams | 2 | 84.356 | SOFT | 27.232 | 28.751 | 28.373 | 307 | 322 | 329 | 329 |
| BOT | Cadillac | 8 | 84.364 | SOFT | 27.407 | 28.602 | 28.355 | 297 | 313 | 323 | 324 |
| PER | Cadillac | 8 | 84.595 | SOFT | 27.703 | 28.721 | 28.171 | 290 | 310 | 321 | 322 |
| ALO | Aston Martin | 5 | 85.150 | SOFT | 27.995 | 28.800 | 28.355 | 289 | 297 | 308 | 314 |
| STR | Aston Martin | 8 | 85.222 | SOFT | 28.084 | 28.775 | 28.363 | 287 | 304 | 309 | 313 |

## Cross-check: official classification

Source: https://www.formula1.com/en/results/2026/races/1293/italy/qualifying (read on 2026-10-24 with WebFetch, which returns the page through a summarising model; the 22 of 22 match to OpenF1 is the check on that transcription).

| Pos | Driver | Q1 | Q2 | Q3 | Official best s | OpenF1 best valid s | diff ms | Lap in OpenF1 |
|---|---|---|---|---|---|---|---|---|
| 1 | GAS | 1:22.612 | 1:22.077 | 1:21.786 | 81.786 | 81.786 | +0 | 17 |
| 2 | RUS | 1:22.779 | 1:22.161 | 1:21.846 | 81.846 | 81.846 | +0 | 16 |
| 3 | PIA | 1:22.924 | 1:22.017 | 1:21.966 | 81.966 | 81.966 | +0 | 15 |
| 4 | LEC | 1:22.902 | 1:22.509 | 1:22.004 | 82.004 | 82.004 | +0 | 14 |
| 5 | HAM | 1:22.847 | 1:22.516 | 1:22.011 | 82.011 | 82.011 | +0 | 14 |
| 6 | VER | 1:22.631 | 1:22.188 | 1:22.070 | 82.070 | 82.070 | +0 | 13 |
| 7 | ANT | 1:22.758 | 1:21.882 | 1:22.093 | 81.882 | 81.882 | +0 | 10 |
| 8 | COL | 1:22.662 | 1:22.400 | 1:22.220 | 82.220 | 82.220 | +0 | 17 |
| 9 | NOR | 1:22.659 | 1:22.067 | 1:22.256 | 82.067 | 82.067 | +0 | 9 |
| 10 | LIN | 1:22.727 | 1:22.345 | 1:22.286 | 82.286 | 82.286 | +0 | 17 |
| 11 | BOR | 1:22.946 | 1:22.517 | - | 82.517 | 82.517 | +0 | 11 |
| 12 | BEA | 1:22.906 | 1:22.756 | - | 82.756 | 82.756 | +0 | 11 |
| 13 | HUL | 1:23.440 | 1:22.779 | - | 82.779 | 82.779 | +0 | 11 |
| 14 | LAW | 1:22.989 | 1:22.821 | - | 82.821 | 82.821 | +0 | 16 |
| 15 | SAI | 1:23.616 | 1:23.453 | - | 83.453 | 83.453 | +0 | 14 |
| 16 | OCO | 1:23.466 | 1:23.454 | - | 83.454 | 83.454 | +0 | 14 |
| 17 | TSU | 1:23.755 | - | - | 83.755 | 83.755 | +0 | 2 |
| 18 | ALB | 1:24.356 | - | - | 84.356 | 84.356 | +0 | 2 |
| 19 | BOT | 1:24.364 | - | - | 84.364 | 84.364 | +0 | 8 |
| 20 | PER | 1:24.595 | - | - | 84.595 | 84.595 | +0 | 8 |
| 21 | ALO | 1:25.150 | - | - | 85.150 | 85.150 | +0 | 5 |
| 22 | STR | 1:25.222 | - | - | 85.222 | 85.222 | +0 | 8 |

## Data quality: telemetry dropouts

OpenF1 sometimes freezes `car_data`: speed, rpm and gear repeat the last value for seconds, and throttle and brake read 104, an error code and not a percentage (or the whole sample repeats with throttle 100 and brake 0). `fetch_circuit.py` removes those samples (throttle above 100, brake not 0 or 100, or 3 or more samples in a row with identical speed and rpm at 50 km/h or more). Where more than 0.8 s is left between valid samples, speed, throttle, brake, gear and rpm are `null` on the grid inside the gap (never interpolated), the distance across the gap is the X/Y path length between the two valid samples so the axis stays continuous, and `time_s` inside the gap is linear between them. A speed integral across a frozen stretch would otherwise overstate the lap: on a first pass without this handling the pole lap came out 128 m too long (5,883 m against 5,755 m by X/Y).

13 of 22 laps are affected:

| Driver | Lap time s | Gaps (distance m, duration s) |
|---|---|---|
| GAS | 81.786 | 1802 to 2109 m (5.3 s) |
| RUS | 81.846 | 4173 to 4241 m (0.9 s) |
| PIA | 81.966 | 1787 to 1904 m (1.4 s); 4582 to 4687 m (1.3 s) |
| COL | 82.220 | 1772 to 2088 m (5.8 s) |
| LIN | 82.286 | 4565 to 4676 m (1.3 s) |
| BOR | 82.517 | 2879 to 2937 m (1.0 s) |
| BEA | 82.756 | 4630 to 4732 m (1.2 s) |
| SAI | 83.453 | 1887 to 2203 m (5.8 s) |
| OCO | 83.454 | 4620 to 4721 m (1.2 s) |
| ALB | 84.356 | 1847 to 2148 m (7.3 s); 4615 to 4742 m (1.4 s) |
| BOT | 84.364 | 4604 to 4694 m (1.1 s) |
| ALO | 85.150 | 290 to 568 m (3.2 s); 1834 to 1943 m (1.4 s); 4197 to 4325 m (1.8 s); 4585 to 4696 m (1.4 s); 5414 to 5507 m (1.4 s) |
| STR | 85.222 | 283 to 398 m (1.3 s) |

Shorter invalid runs (under 0.8 s between valid samples) are bridged by linear interpolation and counted in `raw_car_samples_excluded_invalid`.

## Not available from the public feeds

Overtake-mode, active-aero and DRS state; fuel mass; battery state of charge and ERS deployment; telemetry faster than the feed rate of about 3.7 Hz.

## Reproduce

```sh
python3 fetch/fetch_circuit.py --circuit monza --session_key 11357 --cache /some/scratch/dir   # stdlib only, ~55 requests at the 30 req/min free tier
python3 fetch/derive_circuit.py --circuit monza --official-m 5793 --racepace-key monza   # prints the tables above (no network)
```

The corner groups and names in the key-corner table are `derive_circuit.py --groups` arguments (see its docstring). Behind a TLS-intercepting proxy, set `SSL_CERT_FILE` to its CA bundle.
