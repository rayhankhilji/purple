# Montreal 2026 qualifying telemetry (Canadian Grand Prix)

Real car telemetry from qualifying for the 2026 Canadian Grand Prix at the Circuit Gilles Villeneuve, Montreal, Saturday 23 May 2026 (OpenF1 `session_key` **11287**). All 22 drivers, best valid lap of each, all on SOFT. Montreal is the stop-start circuit of this set with a 1 km back straight, and the highest peak speed (332 km/h on the pole lap). The car data is the cleanest of the four: no dropouts.

## Source, licence and attribution

- **Telemetry, laps, sectors, speed traps, tyres, weather and race control**: [OpenF1](https://openf1.org), `https://api.openf1.org/v1`, endpoints `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data` and `location`. OpenF1 is an independent community project and is not associated with Formula 1, the FIA or FOM. The underlying timing data belongs to Formula 1, and F1 / FORMULA ONE are trade marks of Formula One Licensing B.V. OpenF1 says its free tier is for "educational purposes, personal learning projects, research, and non-commercial fan engagement"; this hackathon concept falls within that scope, and any commercial use needs a fresh clearance.
- **Corner markers**: the MultiViewer circuit API (`api.multiviewer.app/api/v1/circuits/23/2026`), the source FastF1's `get_circuit_info()` uses. The service returned the layout record dated 2022.
- **Official classification and track length**: formula1.com (https://www.formula1.com/en/results/2026/races/1285/canada/qualifying) and the circuit entry on formula1.com's race page, read on 2026-10-24. FIA PDFs were not fetched.
- **Why not FastF1**: its live-timing archive answered HTTP 401 to anonymous requests on 2026-10-24 (see `../README.md`). OpenF1 served the same timing feed.
- Accessed **2026-10-24**. Nothing here is synthesised. `../fetch/fetch_set_b.py` regenerates every file from the public feeds.

## Files

| File | Content |
|---|---|
| `montreal-2026-q-<code>.json` x 22 | Best valid qualifying lap of every driver who set one, with 5 m grid channels, lap and sector times, speed trap, compound and processing notes. Pole lap: `montreal-2026-q-rus.json`. `is_team_best` marks each team's faster driver |
| `montreal-2026-q-index.json` | Index: per-lap times, sectors, speed trap, compound, distance and dropout figures, file sizes; session-max speed trap per driver; every race-control "DELETED" message with the lap it was matched to |
| `montreal-2026-q-weather.json` | 76 one-minute weather samples (19:51 to 21:06 UTC) |
| `montreal-circuit.json` | 14 corner markers (number, angle, x/y in metres, distance on the pole lap) |

Folder size (JSON files): 1.19 MB (1164 KB); largest lap file 52.1 KB. No file needed its raw samples dropped for the 80 KB limit.

### Lap file format

Same layout as the Silverstone files (see `../README.md`): `driver`, `lap`, `processing`, `channels` on a **5 m grid** (`distance_m, time_s, speed_kmh, throttle_pct, brake, gear, rpm, x_m, y_m`) and `raw_car_data` (the un-interpolated OpenF1 samples inside the lap). Differences in this set:

- **Car-data dropouts.** OpenF1's `car_data` sometimes freezes: the feed repeats one sample and marks it with throttle 104 and/or brake 104 (valid throttle is 0 to 100, brake 0 or 100). Such samples, and any run of three or more identical (speed, rpm, throttle, gear) samples after the first, are dropped. Where the remaining samples are more than 1.5 s apart, the grid values of `speed_kmh`, `throttle_pct`, `brake`, `gear` and `rpm` are **null**. Nothing is filled in. `processing.dropouts` lists each gap (time and distance), and `invalid_car_samples_dropped` counts the discarded samples. `x_m` and `y_m` come from the separate `location` feed and stay populated.
- **Distance across a dropout** is the X/Y arc length over the gap instead of the speed integral, so the axis stays aligned to the lap. `processing.length_m` is the axis length, `length_m_xy_path` the X/Y path length, `distance_from_xy_during_dropouts_m` the part taken from X/Y.
- Lap validity: a lap needs a time, all three sector times, no pit-out flag, and no race-control deletion. This excludes laps cut short by a stoppage (see Singapore).
- DRS: OpenF1's `drs` field is null for every sample, as at Silverstone. No active-aero or Overtake channel exists.
- Brake is on/off in the source (0 or 100); braking points are uncertain by about 20 m at the 3.7 Hz feed rate.

## Session and weather

Qualifying ran on Saturday 23 May 2026: Q1 20:00 to 20:18, Q2 20:25 to 20:40, Q3 20:47 to 21:00 UTC. Dry for the pole lap. **One sample flags rain (20:34:40 UTC, during Q2)**; the other 75 read dry. Air 20.9 to 22.0 degC, track 29.8 to 31.5 degC, humidity 23 to 27%, pressure 1028.5 to 1028.9 mbar, wind 0.0 to 2.5 m/s, direction variable. The sample nearest the pole lap (20:59:41 UTC): air 21.5 degC, track 30.7 degC, humidity 24.4%, wind 0.5 m/s from 266 degrees. All 22 laps are SOFT.

## Pole lap and lap length

**Pole: George Russell (Mercedes), lap 23, 1:12.578, SOFT** (Q3). Second ANT 1:12.646 (+0.068), third NOR 1:12.729. Sectors S1 20.600, S2 22.902, S3 29.076 s.

Lap length: the 5 m axis is **4321 m** on the pole lap against the official **4.361 km** (0.9% short); X/Y path 4303 m. Over the 22 laps the axis runs 4293 to 4339 m (median 4321) and the X/Y path median is 4311 m. NOR and PIA have a 30 to 38 m gap between the start and end X/Y positions (the other laps are within 11 m), so their lap boundaries are about 0.4 s off.

## Key corners, pole lap

Distances run along the lap trace from the timing line. The MultiViewer marker is the corner-number position projected onto the trace; it can sit before or after the apex, so the speed minimum is searched within 110 m of it (and no further than half-way to the next marker). "Lift" is where throttle first drops below 95% before the braking point, "braking starts" the first brake-on sample of the zone, and "entry speed" the highest speed in the 50 m before it. Where the car never slows to a local minimum (flat, or only a lift), the table gives the speed at the marker instead. Two markers that share a braking zone say so in the Note column, with the same entry figures.

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| T1 | 215 | 169 | 4 | 215 | - | - | - | no local minimum: speed at marker, throttle 0% |
| T2 | 320 | 75 | 1 | 315 | 135 | 155 | 282 |  |
| T3 | 700 | 140 | 3 | 710 | 565 | 620 | 236 |  |
| T4 | 755 | 165 | 3 | 755 | - | - | - | no local minimum: speed at marker, throttle 68% |
| T5 | 980 | 253 | 6 | 980 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T6 | 1200 | 96 | 2 | 1230 | 1110 | 1130 | 252 |  |
| T7 | 1285 | 150 | 2 | 1285 | - | - | - | no local minimum: speed at marker, throttle 67% |
| T8 | 1975 | 134 | 3 | 1980 | 1875 | 1880 | 291 |  |
| T9 | 2050 | 181 | 4 | 2050 | - | - | - | no local minimum: speed at marker, throttle 83% |
| T10 | 2650 | 61 | 1 | 2655 | 2535 | 2535 | 288 |  |
| T11 | 2750 | 184 | 4 | 2750 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T12 | 3115 | 315 | 8 | 3115 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T13 | 3840 | 153 | 3 | 3840 | - | - | - | no local minimum: speed at marker, throttle 0% |
| T14 | 3875 | 140 | 3 | 3885 | 3740 | 3740 | 317 |  |

### Straights, peak and end speeds

Runs of 300 m or more at 95% throttle or above with no brake.

| Straight | From m | To m | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Drop peak to end |
|---|---|---|---|---|---|---|---|---|
| T4 to T6 | 785 | 1105 | 320 | 183 | 253 | 975 | 250 | 3 |
| T7 to T8 | 1335 | 1870 | 535 | 188 | 296 | 1785 | 278 | 18 |
| T9 to T10 | 2060 | 2530 | 470 | 189 | 290 | 2365 | 279 | 11 |
| T10 to T13 | 2715 | 3735 | 1020 | 138 | 332 | 3350 | 307 | 25 |
| T14 to line | 3920 | 4300 | 380 | 164 | 277 | 4300 | 277 | 0 |

**Energy clipping.** The back straight (T10 to T13, 1020 m) peaks at 332 km/h at 3350 m and is at 307 km/h when RUS lifts at 3735 m, 25 km/h lower with the throttle at 95% or more over the last 385 m. The T7 to T8 run falls from 296 to 278 km/h (18 lower) and T9 to T10 from 290 to 279 (11 lower). The T4 to T6 run ends within 3 km/h of its peak, and the final run into the line (T14 to line) is still accelerating at the line (277 km/h).

### Full throttle and sectors

Full throttle (>=99%): 56.6% of valid lap time, 69.3% of valid distance; raw-sample share 60.3%. Brake on 18.8% of valid time. Valid coverage 100.0% of time, 100.0% of distance.

Sectors: S1 20.600 S2 22.902 S3 29.076 (sum 72.578)

**Speed trap.** On the pole lap the official trap read **320 km/h** (i1 249, i2 289 km/h). Trap readings on the 22 best laps run 307 (BOT) to 321 (LEC); session maxima per driver run 314 (STR) to 329 (BOR). The pole trace peaks at 332 km/h at 3350 m on the back straight. OpenF1 does not publish where the trap is.

## Cross-check against official classifications

Every best valid lap matches the formula1.com qualifying classification to the millisecond: **22 of 22 drivers**. "F1.com best" is the fastest of each driver's Q1, Q2 and Q3 times, and every driver's fastest lap came in the segment that classified him. Grid position follows the classification.

| Grid | Driver | Team | Lap | OpenF1 best s | F1.com best s | Diff s | Q | S1 | S2 | S3 | Trap | Axis length m | Dropout s | File KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | RUS | Mercedes | 23 | 72.578 | 72.578 | +0.000 | Q3 | 20.600 | 22.902 | 29.076 | 320 | 4321 | 0.0 | 51.8 |
| 2 | ANT | Mercedes | 23 | 72.646 | 72.646 | +0.000 | Q3 | 20.547 | 23.061 | 29.038 | 319 | 4318 | 0.0 | 52.1 |
| 3 | NOR | McLaren | 23 | 72.729 | 72.729 | +0.000 | Q3 | 20.619 | 22.967 | 29.143 | 315 | 4319 | 0.0 | 51.5 |
| 4 | PIA | McLaren | 28 | 72.781 | 72.781 | +0.000 | Q3 | 20.774 | 22.926 | 29.081 | 316 | 4318 | 0.0 | 50.9 |
| 5 | HAM | Ferrari | 23 | 72.868 | 72.868 | +0.000 | Q3 | 20.606 | 23.029 | 29.233 | 318 | 4330 | 0.0 | 51.6 |
| 6 | VER | Red Bull Racing | 22 | 72.907 | 72.907 | +0.000 | Q3 | 20.580 | 23.155 | 29.172 | 318 | 4339 | 0.0 | 51.9 |
| 7 | HAD | Red Bull Racing | 21 | 72.935 | 72.935 | +0.000 | Q3 | 20.549 | 23.218 | 29.168 | 320 | 4325 | 0.0 | 52.0 |
| 8 | LEC | Ferrari | 28 | 72.976 | 72.976 | +0.000 | Q3 | 20.656 | 23.169 | 29.151 | 321 | 4324 | 0.0 | 52.1 |
| 9 | LIN | Racing Bulls | 27 | 73.280 | 73.280 | +0.000 | Q3 | 20.654 | 23.309 | 29.317 | 320 | 4321 | 0.0 | 52.0 |
| 10 | COL | Alpine | 22 | 73.697 | 73.697 | +0.000 | Q3 | 21.040 | 23.407 | 29.250 | 320 | 4312 | 0.0 | 51.7 |
| 11 | HUL | Audi | 20 | 73.886 | 73.886 | +0.000 | Q2 | 21.108 | 23.357 | 29.421 | 316 | 4323 | 0.0 | 51.7 |
| 12 | LAW | Racing Bulls | 21 | 73.897 | 73.897 | +0.000 | Q2 | 20.886 | 23.528 | 29.483 | 315 | 4318 | 0.0 | 51.6 |
| 13 | BOR | Audi | 21 | 74.071 | 74.071 | +0.000 | Q2 | 21.168 | 23.432 | 29.471 | 320 | 4322 | 0.0 | 51.3 |
| 14 | GAS | Alpine | 19 | 74.187 | 74.187 | +0.000 | Q2 | 21.270 | 23.396 | 29.521 | 316 | 4321 | 0.0 | 51.9 |
| 15 | SAI | Williams | 20 | 74.273 | 74.273 | +0.000 | Q2 | 21.483 | 23.333 | 29.457 | 317 | 4314 | 0.0 | 51.7 |
| 16 | BEA | Haas F1 Team | 21 | 74.416 | 74.416 | +0.000 | Q2 | 21.143 | 23.631 | 29.642 | 315 | 4321 | 0.0 | 51.6 |
| 17 | OCO | Haas F1 Team | 11 | 74.845 | 74.845 | +0.000 | Q1 | 21.351 | 23.731 | 29.763 | 315 | 4317 | 0.0 | 51.8 |
| 18 | ALB | Williams | 9 | 74.851 | 74.851 | +0.000 | Q1 | 21.253 | 23.795 | 29.803 | 314 | 4323 | 0.0 | 51.9 |
| 19 | ALO | Aston Martin | 10 | 75.196 | 75.196 | +0.000 | Q1 | 21.420 | 23.893 | 29.883 | 320 | 4318 | 0.0 | 51.4 |
| 20 | PER | Cadillac | 9 | 75.429 | 75.429 | +0.000 | Q1 | 21.429 | 24.034 | 29.966 | 312 | 4328 | 0.0 | 52.0 |
| 21 | STR | Aston Martin | 8 | 76.195 | 76.195 | +0.000 | Q1 | 21.774 | 24.196 | 30.225 | 310 | 4309 | 0.0 | 51.7 |
| 22 | BOT | Cadillac | 5 | 76.272 | 76.272 | +0.000 | Q1 | 21.847 | 24.184 | 30.241 | 307 | 4293 | 0.0 | 51.8 |

## Deleted laps (race control)

Race control sent 21 "DELETED" messages (all track limits). **Fourteen resolve to timed laps**; none was faster than the driver's kept best (LEC's 1:16.346 against 1:12.976, for example, and HUL's 1:16.884 against 1:13.886). HUL lap 5 and BEA lap 17 are pit laps, and GAS lap 10 has no recorded time. Two further messages (LIN, PIA) repeat a lap already deleted.  Two messages cannot be tied to a lap (they are not in the count of 14): STR ("LAP 11 16:17:39 (PIT)", a clock time outside every recorded lap of his) and LAW ("TIME DELETED ... (Q2)", no time or lap given, posted after the session). Both are Q1/Q2 laps and neither changes any best lap, as all 22 official times match.

| Driver | Lap | Time s | Kept best s | Race-control message | How matched |
|---|---|---|---|---|---|
| LEC | 3 | 76.346 | 72.976 | CAR 16 (LEC) TIME 1:16.346 DELETED - TRACK LIMITS AT TURN 14 LAP 4 16:06:29 | lap time in message |
| HUL | 5 | 247.396 | 73.886 | CAR 27 (HUL) LAP DELETED - TRACK LIMITS AT TURN 1 LAP 6 16:07:37 (PIT) | clock time in message |
| BOR | 5 | 79.122 | 74.071 | CAR 5 (BOR) TIME 1:19.122 DELETED - TRACK LIMITS AT TURN 4 LAP 6 16:08:01 | lap time in message |
| HAM | 9 | 90.923 | 72.868 | CAR 44 (HAM) TIME 1:30.923 DELETED - TRACK LIMITS AT TURN 1 LAP 10 16:13:55 | lap time in message |
| BOT | 9 | 102.934 | 76.272 | CAR 77 (BOT) TIME 1:42.934 DELETED - TRACK LIMITS AT TURN 1 LAP 10 16:14:45 | lap time in message |
| LIN | 11 | 74.785 | 73.280 | CAR 41 (LIN) TIME 1:14.785 DELETED - TRACK LIMITS AT TURN 14 LAP 12 16:16:36 | lap time in message |
| LIN | 11 | 74.785 | 73.280 | CAR 41 (LIN) LAP DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP PIT) | inferred: lap that ended last before the message |
| PIA | 10 | 76.976 | 72.781 | CAR 81 (PIA) TIME 1:16.976 DELETED - TRACK LIMITS AT TURN 14 LAP 11 16:17:57 | lap time in message |
| GAS | 10 | - | 74.187 | CAR 10 (GAS) LAP DELETED - TRACK LIMITS AT TURN 4 LAP 11 16:16:25 | clock time in message |
| PIA | 10 | 76.976 | 72.781 | CAR 81 (PIA) LAP DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP PIT) | inferred: lap that ended last before the message |
| STR | - | - | 76.195 | CAR 18 (STR) LAP DELETED - TRACK LIMITS AT TURN 4 LAP 11 16:17:39 (PIT) | unresolved |
| LAW | 15 | 76.871 | 73.897 | CAR 30 (LAW) TIME 1:16.871 DELETED - TRACK LIMITS AT TURN 14 LAP 16 16:29:48 | lap time in message |
| VER | 8 | 87.471 | 72.907 | CAR 3 (VER) TIME 1:27.471 DELETED - TRACK LIMITS AT TURN 1 LAP 9 16:29:11 | lap time in message |
| BEA | 17 | 158.297 | 74.416 | CAR 87 (BEA) LAP DELETED - TRACK LIMITS AT TURN 8 LAP 18 16:32:20 (PIT) | clock time in message |
| RUS | 13 | 90.454 | 72.578 | CAR 63 (RUS) TIME 1:30.454 DELETED - TRACK LIMITS AT TURN 1 LAP 14 16:36:38 | lap time in message |
| HUL | 18 | 76.884 | 73.886 | CAR 27 (HUL) TIME 1:16.884 DELETED - TRACK LIMITS AT TURN 14 LAP 19 16:36:52 | lap time in message |
| BEA | 19 | 78.636 | 74.416 | CAR 87 (BEA) TIME 1:18.636 DELETED - TRACK LIMITS AT TURN 14 LAP 20 16:36:59 | lap time in message |
| HUL | 19 | 94.852 | 73.886 | CAR 27 (HUL) TIME 1:34.852 DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP) | lap time in message |
| LEC | 4 | 96.518 | 72.976 | CAR LEC TIME 1:36.518 DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP) (Q1) | lap time in message |
| LAW | - | - | 73.897 | CAR LAW TIME DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP PIT) (Q2) | unresolved |
| BEA | 20 | 99.643 | 74.416 | CAR BEA TIME 1:39.643 DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP) (Q2) | lap time in message |

## Not available from the public feeds

- Overtake-mode, active-aero and DRS state; fuel mass; battery state of charge; ERS deployment.
- Telemetry faster than the public feed rate of about 3.7 Hz.

## Reproduce

```sh
python3 ../fetch/fetch_set_b.py fetch --only montreal --cache /some/scratch/dir   # stdlib only, about 50 requests per circuit at the 30 req/min free tier
python3 ../fetch/fetch_set_b.py derive --circuit montreal    # prints the corner / straight tables (no network)
```
