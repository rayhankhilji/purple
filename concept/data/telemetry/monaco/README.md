# Monaco 2026 qualifying telemetry

Real car telemetry from the 2026 Monaco Grand Prix: qualifying on Saturday 6 June 2026 (OpenF1 `session_key` 11295, meeting 1286, scheduled 14:00 to 15:00 UTC). It is one of four contrasting circuits (Monza, Monaco, Spa, Red Bull Ring) collected so the car-identification models can separate engine power, drag and downforce per car. The Silverstone folder's README (`../README.md`) holds the licence and attribution text, the file format and the reasons FastF1 was not used; all of that applies here unchanged, and the notes below cover what differs.

Accessed **2026-10-24**. Nothing in this folder is synthesised. Every number comes from OpenF1 (`api.openf1.org/v1`: `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data`, `location`), the MultiViewer circuit API (corner markers) or the formula1.com classification page (cross-check only), through `../fetch/fetch_circuit.py`. OpenF1 is not associated with Formula 1, the FIA or FOM; F1 and FORMULA ONE are trade marks of Formula One Licensing B.V.; non-commercial use only, as in `../README.md`.

## Files

| File | Content | Size |
|---|---|---|
| `monaco-2026-q-<code>.json` x 22 | Best valid qualifying lap of every driver, ranked in `monaco-2026-q-index.json`; all SOFT. Pole: `monaco-2026-q-ant.json` (`is_pole_lap`). `is_team_best` is set for ANT, VER, HAM, PIA, GAS, LAW, ALB, HUL, OCO, PER, ALO | 42.3 to 43.4 KB each |
| `monaco-2026-q-index.json` | Session info, best valid lap per driver (sectors, i1, i2, trap, compound), session-maximum i1/i2/trap per driver, lap times deleted by race control, every race-control message containing DELETED, per-file dropout lists | 18.0 KB |
| `monaco-2026-q-weather.json` | 80 one-minute weather samples, 13:50 to 15:09 UTC | 5.7 KB |
| `monaco-circuit.json` | 19 corner markers (number, angle, x/y in metres, distance on the pole lap, match error) | 3.3 KB |
| `monaco-2026-q-official.json` | The formula1.com qualifying classification (Q1/Q2/Q3 as printed), used only for the cross-check below | 4.0 KB |

Whole folder: 989 KB. The lap files follow the Silverstone format (`driver`, `lap`, `processing`, `channels` on a 5 m grid of 655 to 660 points, `raw_car_data`) with these differences:

- `raw_car_data` is present in all 22 files.
- `processing.dropouts` lists telemetry dropouts and `processing.raw_car_samples_excluded_invalid` counts the samples removed; channels are `null` inside a gap (see Data quality). `lap.compound` and `lap.tyre_age_at_stint_start_laps` come from the OpenF1 stints.
- `drs` is null in the feed for every sample, as at Silverstone, so no DRS or active-aero flag is stored.

## Session

**Pole**: Antonelli (Mercedes), lap 27, 72.051 s on SOFT; Verstappen was second at 72.094 s (+0.043 s) and Hamilton third at 72.279 s.

- **Deleted laps**: Race control deleted **12 lap times** (track limits at T1, T10 or T16) that OpenF1 still carries in `laps`: ANT lap 7 (94.829); BOR lap 9 (95.069); HAM lap 8 (96.716); HUL lap 12 (94.493); OCO lap 9 (81.099); PER lap 4 (90.897); RUS lap 1 (95.179); RUS lap 2 (93.532); RUS lap 4 (99.599); RUS lap 5 (93.562); RUS lap 18 (81.611); STR lap 9 (77.435). Every one is slower than that driver's best valid lap, the closest being STR's 77.435 against 76.061 (+1.374 s), so none changes a best lap, but they are excluded by rule. The index lists them under `deleted_lap_times`, with the 14 race-control messages that name a lap time (12 unique times, as RUS and STR each have one time deleted twice) and the 12 that read "LAP DELETED ... (PIT)" with no time, under `race_control_deleted_messages`.
- **Lap times against the official classification**: all 22 best valid laps match the formula1.com Q1/Q2/Q3 times to the millisecond (table below; each driver's best is the fastest of his Q1, Q2 and Q3 times).
- **Cross-check against `js/data/racepace2026.js`** (`monaco`): all 22 qualifying times and the pole (ANT 72.051) agree to the millisecond. OpenF1's session-maximum speed trap is 0.1 to 0.9 km/h below the repo's one-decimal `speedTrapQuali` for all 22 drivers, which fits truncation to whole km/h, as at Silverstone.
- **Lap length**: the speed integral gives 3,273 m on the pole lap and 3,270 to 3,295 m over the 22 laps, against 3,337 m official, which is 1.9% shorter. The X/Y path agrees (3,272 m on the pole lap), so the speed trace is not the cause: the official length is measured on the centre line and the cars take a tighter line through the many corners. Silverstone was 1.1% short by the same measure.
- **Weather** (80 samples, 13:50 to 15:09 UTC): rainfall max 0; air 23.0 to 24.5 degC; track 32.3 to 47.4 degC; humidity 49.9 to 61.3 %; pressure 1017.3 to 1017.7 mbar; wind 0.0 to 2.9 m/s. Sample nearest the end of this lap (15:07:16 UTC): air 23.3, track 32.5, humidity 59.3 %, wind 0.9 m/s from 208 deg, rainfall 0.

## Lap length and processing

Pole lap: Kimi ANTONELLI (Mercedes) lap 27, 72.051 s, SOFT. Lap length: 3273.1 m speed integral, 3272.3 m X/Y path, official 3337 m (speed integral -1.91%, X/Y path -1.94%).

Lap length over 22 laps: speed integral 3270 to 3295 m, X/Y path 3258 to 3279 m. 22 laps without a dropout: speed integral 3270 to 3295 m, median 3279 m; X/Y median 3268 m.  
Laps with a dropout: none.

Distance is the trapezoidal integral of speed over time from the lap start (as at Silverstone), and the 5 m grid, interpolation rules and X/Y units are unchanged. Official length is 3,337 m (centre line); the cars run a racing line, so a measured length a little below it is expected.

## Pole lap: key corners

Distances are along the pole trace from the timing line. "Marker" is the MultiViewer corner position projected onto the trace (match error at most 3.5 m; the layout year served was 2022). "Entry speed" is the highest speed in the 50 m before the braking point. Where there is no local speed minimum because the car is flat out, the row gives the speed at the marker. Brake is on/off in the source, so braking points carry about +-20 m of uncertainty. Corner names are given only where the speed trace makes the match certain (Sainte Devote T1, the Grand Hotel hairpin T6, Portier T8, the Nouvelle Chicane T10/11, Tabac T12, Rascasse T18, Anthony Noghes T19). The marker source supplies numbers only.

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| Sainte Devote (T1) | 185 | 112 | 2 | 200 | 75 | 95 | 276 |  |
| T2 | 570 | 268 | 6 | 570 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| T3 | 740 | 157 | 3 | 795 | 655 | 655 | 272 |  |
| T4 | 860 | 139 | 3 | 885 | 800 | 835 | 166 |  |
| T5 | 1090 | 76 | 1 | 1115 | 1005 | 1005 | 221 |  |
| Grand Hotel hairpin (T6) | 1220 | 45 | 1 | 1235 | 1155 | 1165 | 143 |  |
| T7 | 1290 | 76 | 1 | 1255 | 1255 | - | - | lift, no brake |
| Portier (T8) | 1380 | 82 | 1 | 1390 | 1335 | 1345 | 126 |  |
| T9 | 1710 | 267 | 7 | 1710 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| Nouvelle Chicane (T10/11) | 2040/2095 | 70 | 1 | 2075 | 1940 | 1950 | 289 |  |
| Tabac (T12) | 2320 | 169 | 4 | 2325 | - | 2255 | 238 |  |
| T13 | 2470 | 233 | 6 | 2470 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 71% |
| T14 | 2500 | 231 | 6 | 2570 | 2550 | 2570 | 248 |  |
| T15 | 2640 | 130 | 2 | 2650 | 2570 | 2570 | 248 |  |
| T16 | 2660 | 123 | 2 | 2670 | 2650 | 2660 | 168 |  |
| T17 | 2735 | 138 | 2 | 2700 | 2700 | - | - | lift, no brake |
| Rascasse (T18) | 2855 | 60 | 1 | 2865 | 2795 | 2795 | 207 |  |
| Anthony Noghes (T19) | 2940 | 84 | 1 | 2945 | 2900 | 2905 | 117 |  |

## Straights, peak speed and energy clipping

A straight here is a stretch of at least 200 m with throttle at 95% or more and no brake. "Peak minus end" is the speed lost between the peak and the lift or brake point with the throttle still down.

| Straight (from m to m) | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Peak minus end km/h | Lift or brake at m |
|---|---|---|---|---|---|---|---|
| 235 to 610 | 375 | 144 | 272 | 610 | 272 | 0 | 615 |
| 1425 to 1935 | 510 | 119 | 288 | 1935 | 288 | 0 | 1940 |
| 2985 to 3273 | 288 | 136 | 268 | 3273 | 268 | 0 | 3273 |

Lap maximum: 289 km/h at 1945 m. Minimum: 45 km/h at 1235 m.  
Trap readings (OpenF1) on this lap: i1 215, i2 203, finish line/trap st_speed 282 km/h.  
Full throttle (>= 99%): 33.0% of valid lap time, 46.1% of valid distance (valid = 100.0% of the lap's time); raw-sample share 37.1%. Brake on: 25.9% of valid time.  
Sectors: S1 18.934, S2 33.989, S3 19.128 s (sum 72.051); S1/S2 end at about 1040 m / 2425 m.

Monaco has no straight long enough to show the effect. The tunnel straight (1425 to 1935 m) is still accelerating when the car brakes for the chicane (288 km/h at the end, equal to its peak), and the pit straight ends at its peak of 272 km/h. Full throttle is only 33.0% of lap time and 46.1% of distance, the lowest of the four circuits, and the brake is on for 25.9% of the lap.

**Speed trap.** Best-fit trap position over 22 laps: 1830 m on the pole trace (RMS 0.8 km/h); pole trace there: 281.9 km/h. OpenF1 does not publish where the trap is; the fit uses every driver's trap reading against his own trace.

## Best valid lap per driver

| Driver | Team | Lap | Best Q lap s | Compound | S1 | S2 | S3 | i1 | i2 | trap | max trap in session |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ANT | Mercedes | 27 | 72.051 | SOFT | 18.934 | 33.989 | 19.128 | 215 | 203 | 282 | 283 |
| VER | Red Bull Racing | 25 | 72.094 | SOFT | 18.827 | 34.184 | 19.083 | 218 | 203 | 280 | 282 |
| HAM | Ferrari | 27 | 72.279 | SOFT | 19.103 | 33.957 | 19.219 | 220 | 205 | 280 | 281 |
| LEC | Ferrari | 27 | 72.351 | SOFT | 19.042 | 34.035 | 19.274 | 220 | 205 | 279 | 281 |
| HAD | Red Bull Racing | 24 | 72.434 | SOFT | 19.001 | 34.202 | 19.231 | 219 | 201 | 281 | 282 |
| RUS | Mercedes | 27 | 72.445 | SOFT | 18.970 | 34.253 | 19.222 | 219 | 206 | 281 | 283 |
| PIA | McLaren | 28 | 72.624 | SOFT | 19.047 | 34.288 | 19.289 | 212 | 208 | 281 | 282 |
| NOR | McLaren | 24 | 72.765 | SOFT | 19.124 | 34.297 | 19.344 | 219 | 203 | 280 | 281 |
| GAS | Alpine | 31 | 73.226 | SOFT | 19.278 | 34.512 | 19.436 | 213 | 195 | 284 | 284 |
| LAW | Racing Bulls | 28 | 73.412 | SOFT | 19.302 | 34.755 | 19.355 | 213 | 201 | 282 | 284 |
| ALB | Williams | 23 | 73.787 | SOFT | 19.350 | 34.774 | 19.663 | 215 | 194 | 283 | 285 |
| SAI | Williams | 22 | 73.815 | SOFT | 19.342 | 34.796 | 19.677 | 214 | 200 | 282 | 285 |
| HUL | Audi | 16 | 73.902 | SOFT | 19.565 | 34.871 | 19.466 | 215 | 198 | 282 | 284 |
| COL | Alpine | 21 | 73.995 | SOFT | 19.481 | 35.010 | 19.504 | 204 | 196 | 283 | 284 |
| LIN | Racing Bulls | 15 | 74.248 | SOFT | 19.495 | 35.153 | 19.600 | 209 | 197 | 282 | 283 |
| BOR | Audi | 4 | 74.683 | SOFT | 19.493 | 35.314 | 19.876 | 212 | 200 | 284 | 284 |
| OCO | Haas F1 Team | 10 | 74.722 | SOFT | 19.620 | 35.247 | 19.855 | 210 | 196 | 281 | 282 |
| PER | Cadillac | 9 | 74.747 | SOFT | 19.485 | 35.304 | 19.958 | 217 | 195 | 282 | 282 |
| BEA | Haas F1 Team | 13 | 74.814 | SOFT | 19.699 | 35.214 | 19.901 | 211 | 200 | 281 | 281 |
| BOT | Cadillac | 12 | 75.283 | SOFT | 19.862 | 35.430 | 19.991 | 210 | 190 | 280 | 281 |
| ALO | Aston Martin | 9 | 75.349 | SOFT | 19.764 | 35.556 | 20.029 | 208 | 192 | 278 | 278 |
| STR | Aston Martin | 5 | 76.061 | SOFT | 20.050 | 35.799 | 20.212 | 209 | 193 | 276 | 276 |

## Cross-check: official classification

Source: https://www.formula1.com/en/results/2026/races/1286/monaco/qualifying (read on 2026-10-24 with WebFetch, which returns the page through a summarising model; the 22 of 22 match to OpenF1 is the check on that transcription).

| Pos | Driver | Q1 | Q2 | Q3 | Official best s | OpenF1 best valid s | diff ms | Lap in OpenF1 |
|---|---|---|---|---|---|---|---|---|
| 1 | ANT | 1:13.599 | 1:12.704 | 1:12.051 | 72.051 | 72.051 | +0 | 27 |
| 2 | VER | 1:13.490 | 1:12.499 | 1:12.094 | 72.094 | 72.094 | +0 | 25 |
| 3 | HAM | 1:13.777 | 1:12.934 | 1:12.279 | 72.279 | 72.279 | +0 | 27 |
| 4 | LEC | 1:13.293 | 1:12.774 | 1:12.351 | 72.351 | 72.351 | +0 | 27 |
| 5 | HAD | 1:14.408 | 1:12.722 | 1:12.434 | 72.434 | 72.434 | +0 | 24 |
| 6 | RUS | 1:14.214 | 1:13.238 | 1:12.445 | 72.445 | 72.445 | +0 | 27 |
| 7 | PIA | 1:14.159 | 1:12.983 | 1:12.624 | 72.624 | 72.624 | +0 | 28 |
| 8 | NOR | 1:13.630 | 1:12.919 | 1:12.765 | 72.765 | 72.765 | +0 | 24 |
| 9 | GAS | 1:14.469 | 1:13.762 | 1:13.226 | 73.226 | 73.226 | +0 | 31 |
| 10 | LAW | 1:14.498 | 1:13.471 | 1:13.412 | 73.412 | 73.412 | +0 | 28 |
| 11 | ALB | 1:14.321 | 1:13.787 | - | 73.787 | 73.787 | +0 | 23 |
| 12 | SAI | 1:14.348 | 1:13.815 | - | 73.815 | 73.815 | +0 | 22 |
| 13 | HUL | 1:13.923 | 1:13.902 | - | 73.902 | 73.902 | +0 | 16 |
| 14 | COL | 1:14.573 | 1:13.995 | - | 73.995 | 73.995 | +0 | 21 |
| 15 | LIN | 1:14.685 | 1:14.248 | - | 74.248 | 74.248 | +0 | 15 |
| 16 | BOR | 1:14.683 | - | - | 74.683 | 74.683 | +0 | 4 |
| 17 | OCO | 1:14.722 | - | - | 74.722 | 74.722 | +0 | 10 |
| 18 | PER | 1:14.747 | - | - | 74.747 | 74.747 | +0 | 9 |
| 19 | BEA | 1:14.814 | - | - | 74.814 | 74.814 | +0 | 13 |
| 20 | BOT | 1:15.283 | - | - | 75.283 | 75.283 | +0 | 12 |
| 21 | ALO | 1:15.349 | - | - | 75.349 | 75.349 | +0 | 9 |
| 22 | STR | 1:16.061 | - | - | 76.061 | 76.061 | +0 | 5 |

## Data quality: telemetry dropouts

No dropout was found: no sample has throttle above 100 or brake other than 0 or 100, and no run of identical speed and rpm. All 22 laps have complete channels.

## Not available from the public feeds

Overtake-mode, active-aero and DRS state; fuel mass; battery state of charge and ERS deployment; telemetry faster than the feed rate of about 3.7 Hz.

## Reproduce

```sh
python3 fetch/fetch_circuit.py --circuit monaco --session_key 11295 --cache /some/scratch/dir   # stdlib only, ~55 requests at the 30 req/min free tier
python3 fetch/derive_circuit.py --circuit monaco --official-m 3337 --racepace-key monaco   # prints the tables above (no network)
```

The corner groups and names in the key-corner table are `derive_circuit.py --groups` arguments (see its docstring). Behind a TLS-intercepting proxy, set `SSL_CERT_FILE` to its CA bundle.
