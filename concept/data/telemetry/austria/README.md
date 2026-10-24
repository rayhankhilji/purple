# Red Bull Ring (Spielberg) 2026 qualifying telemetry

Real car telemetry from the 2026 Austrian Grand Prix: qualifying on Saturday 27 June 2026 (OpenF1 `session_key` 11311, meeting 1288, scheduled 14:00 to 15:00 UTC). It is one of four contrasting circuits (Monza, Monaco, Spa, Red Bull Ring) collected so the car-identification models can separate engine power, drag and downforce per car. The Silverstone folder's README (`../README.md`) holds the licence and attribution text, the file format and the reasons FastF1 was not used; all of that applies here unchanged, and the notes below cover what differs.

Accessed **2026-10-24**. Nothing in this folder is synthesised. Every number comes from OpenF1 (`api.openf1.org/v1`: `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data`, `location`), the MultiViewer circuit API (corner markers) or the formula1.com classification page (cross-check only), through `../fetch/fetch_circuit.py`. OpenF1 is not associated with Formula 1, the FIA or FOM; F1 and FORMULA ONE are trade marks of Formula One Licensing B.V.; non-commercial use only, as in `../README.md`.

## Files

| File | Content | Size |
|---|---|---|
| `austria-2026-q-<code>.json` x 22 | Best valid qualifying lap of every driver, ranked in `austria-2026-q-index.json`; all SOFT. Pole: `austria-2026-q-rus.json` (`is_pole_lap`). `is_team_best` is set for RUS, LEC, VER, NOR, LAW, GAS, BOR, BEA, SAI, PER, ALO | 51.4 to 52.5 KB each |
| `austria-2026-q-index.json` | Session info, best valid lap per driver (sectors, i1, i2, trap, compound), session-maximum i1/i2/trap per driver, lap times deleted by race control, every race-control message containing DELETED, per-file dropout lists | 15.2 KB |
| `austria-2026-q-weather.json` | 77 one-minute weather samples, 13:50 to 15:06 UTC | 5.4 KB |
| `austria-circuit.json` | 10 corner markers (number, angle, x/y in metres, distance on the pole lap, match error) | 1.8 KB |
| `austria-2026-q-official.json` | The formula1.com qualifying classification (Q1/Q2/Q3 as printed), used only for the cross-check below | 4.0 KB |

Whole folder: 1185 KB. The lap files follow the Silverstone format (`driver`, `lap`, `processing`, `channels` on a 5 m grid of 851 to 863 points, `raw_car_data`) with these differences:

- `raw_car_data` is present in all 22 files.
- `processing.dropouts` lists telemetry dropouts and `processing.raw_car_samples_excluded_invalid` counts the samples removed; channels are `null` inside a gap (see Data quality). `lap.compound` and `lap.tyre_age_at_stint_start_laps` come from the OpenF1 stints.
- `drs` is null in the feed for every sample, as at Silverstone, so no DRS or active-aero flag is stored.

## Session

**Pole**: Russell (Mercedes), lap 19, 66.113 s on SOFT; Leclerc was second at 66.349 s (+0.236 s) and Hamilton third at 66.408 s.

- **Deleted laps**: **No lap time deleted by race control.** The session has 11 messages containing DELETED, none with a lap time: two "LAP DELETED ... (PIT)" for track limits (HAM lap 7, COL lap 12) and nine "LAP DELETED - DOUBLE YELLOW AT TURN 9" for HAD, HAM, LAW, LEC, NOR, PIA, LIN, ANT and RUS, stamped 15:08:05 to 15:08:20 UTC, after every selected lap had finished (the last ends at 15:00:46 UTC). No selected lap overlaps any of them, and the 22 of 22 match to the official times below agrees.
- **Lap times against the official classification**: all 22 best valid laps match the formula1.com Q1/Q2/Q3 times to the millisecond (table below; each driver's best is the fastest of his Q1, Q2 and Q3 times).
- **`js/data/racepace2026.js`** has no Austria entry (`EI.RACEPACE` holds silverstone, monaco, monza, spa, cota and mexico), so the only external cross-check is the formula1.com classification.
- **Lap length**: 4,297 m from the speed integral on the pole lap (X/Y path 4,290 m) against 4,318 m official (-0.5% and -0.7%). The 19 laps with no dropout give 4,253 to 4,309 m, median 4,296 m.
- **Weather** (77 samples, 13:50 to 15:06 UTC): rainfall max 0; air 32.5 to 33.7 degC; track 50.7 to 53.5 degC; humidity 24.3 to 26.7 %; pressure 942.8 to 943.2 mbar; wind 0.0 to 3.0 m/s. Sample nearest the end of this lap (15:00:42 UTC): air 33.4, track 50.8, humidity 24.7 %, wind 0.9 m/s from 136 deg, rainfall 0.

## Lap length and processing

Pole lap: George RUSSELL (Mercedes) lap 19, 66.113 s, SOFT. Lap length: 4297.3 m speed integral, 4289.6 m X/Y path, official 4318 m (speed integral -0.48%, X/Y path -0.66%).

Lap length over 22 laps: speed integral 4246 to 4309 m, X/Y path 4268 to 4297 m. 19 laps without a dropout: speed integral 4253 to 4309 m, median 4296 m; X/Y median 4287 m.  
Laps with a dropout: COL, BOT, ALO.

Distance is the trapezoidal integral of speed over time from the lap start (as at Silverstone), and the 5 m grid, interpolation rules and X/Y units are unchanged. Official length is 4,318 m (centre line); the cars run a racing line, so a measured length a little below it is expected.

## Pole lap: key corners

Distances are along the pole trace from the timing line. "Marker" is the MultiViewer corner position projected onto the trace (match error at most 3.7 m; the layout year served was 2022). "Entry speed" is the highest speed in the 50 m before the braking point. Where there is no local speed minimum because the car is flat out, the row gives the speed at the marker. Brake is on/off in the source, so braking points carry about +-20 m of uncertainty. The marker source supplies corner numbers only, so none are named here.

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| T1 | 440 | 134 | 3 | 455 | 320 | 335 | 309 |  |
| T2 | 1075 | 326 | 8 | 1075 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| T3 | 1375 | 72 | 1 | 1385 | 1260 | 1260 | 309 |  |
| T4 | 2180 | 106 | 2 | 2205 | 2045 | 2075 | 319 |  |
| T5 | 2375 | 236 | 6 | 2375 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| T6 | 2705 | 183 | 4 | 2720 | 2575 | 2590 | 259 |  |
| T7 | 3025 | 207 | 5 | 3020 | 2930 | 2950 | 237 |  |
| T8 | 3225 | 268 | 6 | 3225 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| T9 | 3760 | 231 | 5 | 3785 | 3550 | 3725 | 278 |  |
| T10 | 3955 | 185 | 4 | 3980 | 3875 | 3890 | 239 |  |

## Straights, peak speed and energy clipping

A straight here is a stretch of at least 300 m with throttle at 95% or more and no brake. "Peak minus end" is the speed lost between the peak and the lift or brake point with the throttle still down.

| Straight (from m to m) | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Peak minus end km/h | Lift or brake at m |
|---|---|---|---|---|---|---|---|
| 0 to 315 | 315 | 283 | 310 | 260 | 304 | 6 | 320 |
| 505 to 1255 | 750 | 172 | 329 | 1025 | 286 | 43 | 1260 |
| 1460 to 2040 | 580 | 161 | 324 | 1925 | 315 | 9 | 2045 |
| 2255 to 2570 | 315 | 150 | 259 | 2560 | 259 | 0 | 2575 |
| 3090 to 3545 | 455 | 226 | 311 | 3545 | 311 | 0 | 3550 |

Lap maximum: 329 km/h at 1025 m. Minimum: 72 km/h at 1385 m.  
Trap readings (OpenF1) on this lap: i1 316, i2 227, finish line/trap st_speed 323 km/h.  
Full throttle (>= 99%): 57.4% of valid lap time, 66.1% of valid distance (valid = 100.0% of the lap's time); raw-sample share 58.1%. Brake on: 15.4% of valid time.  
Sectors: S1 16.424, S2 29.620, S3 20.069 s (sum 66.113); S1/S2 end at about 1210 m / 2900 m.

Two straights show it. T1 to T3 (505 to 1,255 m) peaks at 329 km/h at 1,025 m and is down to 286 km/h at the braking point, 43 km/h lower, with the throttle at 100%; the T3 to T4 straight (1,460 to 2,040 m) drops from 324 to 315 km/h (9 km/h). The pit straight (0 to 315 m, 310 km/h peak, 304 at the end) and T8 to T9 (3,090 to 3,545 m, still 311 km/h at the end) show none. Wind, gradient and cornering exit also move these numbers, and OpenF1 has no deployment channel, so the cause is inferred from the trace.

**Speed trap.** Best-fit trap position over 22 laps: 1980 m on the pole trace (RMS 0.7 km/h); pole trace there: 323.0 km/h. OpenF1 does not publish where the trap is; the fit uses every driver's trap reading against his own trace.

## Best valid lap per driver

| Driver | Team | Lap | Best Q lap s | Compound | S1 | S2 | S3 | i1 | i2 | trap | max trap in session |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RUS | Mercedes | 19 | 66.113 | SOFT | 16.424 | 29.620 | 20.069 | 316 | 227 | 323 | 323 |
| LEC | Ferrari | 14 | 66.349 | SOFT | 16.485 | 29.632 | 20.232 | 310 | 223 | 307 | 308 |
| HAM | Ferrari | 13 | 66.408 | SOFT | 16.521 | 29.690 | 20.197 | 310 | 221 | 307 | 314 |
| ANT | Mercedes | 13 | 66.414 | SOFT | 16.564 | 29.852 | 19.998 | 319 | 229 | 321 | 321 |
| VER | Red Bull Racing | 8 | 66.475 | SOFT | 16.501 | 29.719 | 20.255 | 317 | 224 | 316 | 316 |
| NOR | McLaren | 14 | 66.502 | SOFT | 16.576 | 29.642 | 20.284 | 311 | 227 | 315 | 315 |
| PIA | McLaren | 13 | 66.511 | SOFT | 16.636 | 29.742 | 20.133 | 309 | 229 | 316 | 317 |
| HAD | Red Bull Racing | 17 | 66.632 | SOFT | 16.717 | 29.787 | 20.128 | 312 | 223 | 311 | 314 |
| LAW | Racing Bulls | 17 | 66.955 | SOFT | 16.693 | 29.937 | 20.325 | 322 | 226 | 315 | 316 |
| LIN | Racing Bulls | 17 | 67.007 | SOFT | 16.592 | 29.992 | 20.423 | 320 | 223 | 315 | 315 |
| GAS | Alpine | 11 | 67.223 | SOFT | 16.716 | 30.001 | 20.506 | 318 | 224 | 319 | 319 |
| BOR | Audi | 11 | 67.293 | SOFT | 16.749 | 30.036 | 20.508 | 317 | 225 | 311 | 311 |
| BEA | Haas F1 Team | 11 | 67.523 | SOFT | 16.759 | 30.118 | 20.646 | 315 | 222 | 309 | 310 |
| HUL | Audi | 14 | 67.611 | SOFT | 16.866 | 30.170 | 20.575 | 315 | 230 | 311 | 311 |
| OCO | Haas F1 Team | 14 | 67.817 | SOFT | 16.804 | 30.341 | 20.672 | 313 | 221 | 307 | 308 |
| COL | Alpine | 5 | 67.894 | SOFT | 16.692 | 30.421 | 20.781 | 322 | 224 | 319 | 319 |
| SAI | Williams | 8 | 68.252 | SOFT | 16.845 | 30.504 | 20.903 | 314 | 221 | 317 | 317 |
| ALB | Williams | 5 | 68.509 | SOFT | 16.854 | 30.625 | 21.030 | 312 | 221 | 314 | 316 |
| PER | Cadillac | 5 | 68.945 | SOFT | 16.941 | 30.827 | 21.177 | 312 | 218 | 308 | 310 |
| BOT | Cadillac | 5 | 69.030 | SOFT | 16.928 | 30.725 | 21.377 | 312 | 215 | 309 | 313 |
| ALO | Aston Martin | 8 | 69.942 | SOFT | 17.188 | 31.165 | 21.589 | 307 | 214 | 301 | 301 |
| STR | Aston Martin | 5 | 70.363 | SOFT | 17.362 | 31.311 | 21.690 | 301 | 217 | 297 | 299 |

## Cross-check: official classification

Source: https://www.formula1.com/en/results/2026/races/1288/austria/qualifying (read on 2026-10-24 with WebFetch, which returns the page through a summarising model; the 22 of 22 match to OpenF1 is the check on that transcription).

| Pos | Driver | Q1 | Q2 | Q3 | Official best s | OpenF1 best valid s | diff ms | Lap in OpenF1 |
|---|---|---|---|---|---|---|---|---|
| 1 | RUS | 1:07.398 | 1:06.979 | 1:06.113 | 66.113 | 66.113 | +0 | 19 |
| 2 | LEC | 1:07.543 | 1:07.030 | 1:06.349 | 66.349 | 66.349 | +0 | 14 |
| 3 | HAM | 1:07.290 | 1:06.994 | 1:06.408 | 66.408 | 66.408 | +0 | 13 |
| 4 | ANT | 1:07.083 | 1:06.763 | 1:06.414 | 66.414 | 66.414 | +0 | 13 |
| 5 | VER | 1:07.407 | 1:07.183 | 1:06.475 | 66.475 | 66.475 | +0 | 8 |
| 6 | NOR | 1:07.259 | 1:06.897 | 1:06.502 | 66.502 | 66.502 | +0 | 14 |
| 7 | PIA | 1:07.487 | 1:06.890 | 1:06.511 | 66.511 | 66.511 | +0 | 13 |
| 8 | HAD | 1:07.408 | 1:07.086 | 1:06.632 | 66.632 | 66.632 | +0 | 17 |
| 9 | LAW | 1:07.385 | 1:07.136 | 1:06.955 | 66.955 | 66.955 | +0 | 17 |
| 10 | LIN | 1:07.549 | 1:07.155 | 1:07.007 | 67.007 | 67.007 | +0 | 17 |
| 11 | GAS | 1:08.038 | 1:07.223 | - | 67.223 | 67.223 | +0 | 11 |
| 12 | BOR | 1:08.035 | 1:07.293 | - | 67.293 | 67.293 | +0 | 11 |
| 13 | BEA | 1:08.061 | 1:07.523 | - | 67.523 | 67.523 | +0 | 11 |
| 14 | HUL | 1:08.066 | 1:07.611 | - | 67.611 | 67.611 | +0 | 14 |
| 15 | OCO | 1:08.231 | 1:07.817 | - | 67.817 | 67.817 | +0 | 14 |
| 16 | COL | 1:07.894 | 1:08.171 | - | 67.894 | 67.894 | +0 | 5 |
| 17 | SAI | 1:08.252 | - | - | 68.252 | 68.252 | +0 | 8 |
| 18 | ALB | 1:08.509 | - | - | 68.509 | 68.509 | +0 | 5 |
| 19 | PER | 1:08.945 | - | - | 68.945 | 68.945 | +0 | 5 |
| 20 | BOT | 1:09.030 | - | - | 69.030 | 69.030 | +0 | 5 |
| 21 | ALO | 1:09.942 | - | - | 69.942 | 69.942 | +0 | 8 |
| 22 | STR | 1:10.363 | - | - | 70.363 | 70.363 | +0 | 5 |

## Data quality: telemetry dropouts

OpenF1 sometimes freezes `car_data`: speed, rpm and gear repeat the last value for seconds, and throttle and brake read 104, an error code and not a percentage (or the whole sample repeats with throttle 100 and brake 0). `fetch_circuit.py` removes those samples (throttle above 100, brake not 0 or 100, or 3 or more samples in a row with identical speed and rpm at 50 km/h or more). Where more than 0.8 s is left between valid samples, speed, throttle, brake, gear and rpm are `null` on the grid inside the gap (never interpolated), the distance across the gap is the X/Y path length between the two valid samples so the axis stays continuous, and `time_s` inside the gap is linear between them. A speed integral across a frozen stretch would otherwise overstate the lap.

3 of 22 laps are affected:

| Driver | Lap time s | Gaps (distance m, duration s) |
|---|---|---|
| COL | 67.894 | 1802 to 1894 m (1.0 s); 2931 to 3113 m (3.3 s) |
| BOT | 69.030 | 3347 to 3451 m (1.2 s) |
| ALO | 69.942 | 2939 to 3067 m (2.3 s); 3318 to 3410 m (1.2 s) |

Shorter invalid runs (under 0.8 s between valid samples) are bridged by linear interpolation and counted in `raw_car_samples_excluded_invalid`.

## Not available from the public feeds

Overtake-mode, active-aero and DRS state; fuel mass; battery state of charge and ERS deployment; telemetry faster than the feed rate of about 3.7 Hz.

## Reproduce

```sh
python3 fetch/fetch_circuit.py --circuit austria --session_key 11311 --cache /some/scratch/dir   # stdlib only, ~55 requests at the 30 req/min free tier
python3 fetch/derive_circuit.py --circuit austria --official-m 4318   # prints the tables above (no network)
```

The corner groups and names in the key-corner table are `derive_circuit.py --groups` arguments (see its docstring). Behind a TLS-intercepting proxy, set `SSL_CERT_FILE` to its CA bundle.
