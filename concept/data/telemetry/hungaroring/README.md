# Hungaroring 2026 qualifying telemetry (Hungarian Grand Prix)

Real car telemetry from qualifying for the 2026 Hungarian Grand Prix, Saturday 25 July 2026 (OpenF1 `session_key` **11338**). All 22 drivers, best valid lap of each, all on SOFT. The Hungaroring is the twistiest circuit in this set: no straight longer than about 450 m, 14 corners and the lowest full-throttle share (40% of lap time). The car data is clean: only three laps (GAS, COL, OCO) have one gap of exactly 1.52 s, and nothing longer.

## Source, licence and attribution

- **Telemetry, laps, sectors, speed traps, tyres, weather and race control**: [OpenF1](https://openf1.org), `https://api.openf1.org/v1`, endpoints `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data` and `location`. OpenF1 is an independent community project and is not associated with Formula 1, the FIA or FOM. The underlying timing data belongs to Formula 1, and F1 / FORMULA ONE are trade marks of Formula One Licensing B.V. OpenF1 says its free tier is for "educational purposes, personal learning projects, research, and non-commercial fan engagement"; this hackathon concept falls within that scope, and any commercial use needs a fresh clearance.
- **Corner markers**: the MultiViewer circuit API (`api.multiviewer.app/api/v1/circuits/4/2026`), the source FastF1's `get_circuit_info()` uses. The service returned the layout record dated 2021.
- **Official classification and track length**: formula1.com (https://www.formula1.com/en/results/2026/races/1291/hungary/qualifying) and the circuit entry on formula1.com's race page, read on 2026-10-24. FIA PDFs were not fetched.
- **Why not FastF1**: its live-timing archive answered HTTP 401 to anonymous requests on 2026-10-24 (see `../README.md`). OpenF1 served the same timing feed.
- Accessed **2026-10-24**. Nothing here is synthesised. `../fetch/fetch_set_b.py` regenerates every file from the public feeds.

## Files

| File | Content |
|---|---|
| `hungaroring-2026-q-<code>.json` x 22 | Best valid qualifying lap of every driver who set one, with 5 m grid channels, lap and sector times, speed trap, compound and processing notes. Pole lap: `hungaroring-2026-q-nor.json`. `is_team_best` marks each team's faster driver |
| `hungaroring-2026-q-index.json` | Index: per-lap times, sectors, speed trap, compound, distance and dropout figures, file sizes; session-max speed trap per driver; every race-control "DELETED" message with the lap it was matched to |
| `hungaroring-2026-q-weather.json` | 73 one-minute weather samples (13:50 to 15:02 UTC) |
| `hungaroring-circuit.json` | 16 corner markers (number, angle, x/y in metres, distance on the pole lap) |

Folder size (JSON files): 1.20 MB (1168 KB); largest lap file 52.6 KB. No file needed its raw samples dropped for the 80 KB limit.

### Lap file format

Same layout as the Silverstone files (see `../README.md`): `driver`, `lap`, `processing`, `channels` on a **5 m grid** (`distance_m, time_s, speed_kmh, throttle_pct, brake, gear, rpm, x_m, y_m`) and `raw_car_data` (the un-interpolated OpenF1 samples inside the lap). Differences in this set:

- **Car-data dropouts.** OpenF1's `car_data` sometimes freezes: the feed repeats one sample and marks it with throttle 104 and/or brake 104 (valid throttle is 0 to 100, brake 0 or 100). Such samples, and any run of three or more identical (speed, rpm, throttle, gear) samples after the first, are dropped. Where the remaining samples are more than 1.5 s apart, the grid values of `speed_kmh`, `throttle_pct`, `brake`, `gear` and `rpm` are **null**. Nothing is filled in. `processing.dropouts` lists each gap (time and distance), and `invalid_car_samples_dropped` counts the discarded samples. `x_m` and `y_m` come from the separate `location` feed and stay populated.
- **Distance across a dropout** is the X/Y arc length over the gap instead of the speed integral, so the axis stays aligned to the lap. `processing.length_m` is the axis length, `length_m_xy_path` the X/Y path length, `distance_from_xy_during_dropouts_m` the part taken from X/Y.
- Lap validity: a lap needs a time, all three sector times, no pit-out flag, and no race-control deletion. This excludes laps cut short by a stoppage (see Singapore).
- DRS: OpenF1's `drs` field is null for every sample, as at Silverstone. No active-aero or Overtake channel exists.
- Brake is on/off in the source (0 or 100); braking points are uncertain by about 20 m at the 3.7 Hz feed rate.

## Session and weather

Qualifying ran on Saturday 25 July 2026: Q1 14:00 to 14:18, Q2 14:25 to 14:40, Q3 14:47 to 15:00 UTC. No rain. Air 26.4 to 27.2 degC, track 42.0 to 50.0 degC, humidity 22 to 24%, pressure 984.0 to 984.5 mbar, wind 0.0 to 4.2 m/s, direction variable. The sample nearest the pole lap (14:59:35 UTC): air 26.4 degC, track 42.4 degC, humidity 24.0%, wind 0.4 m/s from 1 degree. The track cooled by several degrees over the session. All 22 laps are SOFT.

## Pole lap and lap length

**Pole: Lando Norris (McLaren), lap 15, 1:17.207, SOFT** (Q3). Second HAM 1:17.219 (+0.012), third LEC 1:17.445. Sectors S1 27.364, S2 27.621, S3 22.222 s.

Lap length: the 5 m axis is **4340 m** on the pole lap against the official **4.381 km** (0.9% short). The X/Y path is 4324 m. Over the 22 laps the axis runs 4336 to 4359 m (median 4345) and the X/Y path median is 4324 m.

## Key corners, pole lap

Distances run along the lap trace from the timing line. The MultiViewer marker is the corner-number position projected onto the trace; it can sit before or after the apex, so the speed minimum is searched within 110 m of it (and no further than half-way to the next marker). "Lift" is where throttle first drops below 95% before the braking point, "braking starts" the first brake-on sample of the zone, and "entry speed" the highest speed in the 50 m before it. Where the car never slows to a local minimum (flat, or only a lift), the table gives the speed at the marker instead. Two markers that share a braking zone say so in the Note column, with the same entry figures.

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| T1 | 625 | 92 | 2 | 635 | 455 | 480 | 330 |  |
| T1A | 810 | 243 | 6 | 810 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T2 | 1120 | 121 | 3 | 1155 | 970 | 1005 | 280 |  |
| T3 | 1305 | 233 | 6 | 1305 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T4 | 1775 | 250 | 8 | 1775 | - | - | - | no local minimum: speed at marker, throttle 10% |
| T5 | 2020 | 150 | 4 | 2040 | 1905 | 1945 | 239 |  |
| T6 | 2355 | 112 | 3 | 2365 | 2255 | 2280 | 246 |  |
| T7 | 2395 | 133 | 3 | 2395 | - | - | - | no local minimum: speed at marker, throttle 24% |
| T8 | 2565 | 168 | 4 | 2585 | 2495 | 2520 | 208 |  |
| T9 | 2700 | 154 | 4 | 2710 | 2495 | 2520 | 208 | same braking zone as T8 |
| T10 | 2895 | 252 | 7 | 2895 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T11 | 3090 | 221 | 6 | 3080 | 2985 | 3005 | 266 |  |
| T12 | 3490 | 115 | 3 | 3505 | 3380 | 3395 | 284 |  |
| T12A | 3620 | 208 | 5 | 3620 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T13 | 3760 | 98 | 2 | 3760 | 3640 | 3655 | 219 |  |
| T14 | 4045 | 132 | 4 | 4040 | 3915 | 3940 | 216 |  |

### Straights, peak and end speeds

Runs of 300 m or more at 95% throttle or above with no brake. Only two exist on this circuit.

| Straight | From m | To m | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Drop peak to end |
|---|---|---|---|---|---|---|---|---|
| line to T1 | 0 | 450 | 450 | 284 | 331 | 360 | 325 | 6 |
| T2 to T4 | 1210 | 1625 | 415 | 170 | 309 | 1620 | 308 | 1 |

The pit straight peaks at 331 km/h at 360 m and is still at 325 km/h when NOR lifts at 450 m (braking from 480 m at 330 km/h for T1), so no fade is visible on a run this short. The T2 to T4 run reaches 309 km/h with no loss. T4 (1775 m) is taken at 250 km/h in 8th gear with the throttle lifted to 10%.

### Full throttle and sectors

Full throttle (>=99%): 40.3% of valid lap time, 49.8% of valid distance; raw-sample share 45.5%. Brake on 19.3% of valid time. Valid coverage 100.0% of time, 100.0% of distance.

Sectors: S1 27.364 S2 27.621 S3 22.222 (sum 77.207)

**Speed trap.** On the pole lap the official trap read **327 km/h** (i1 307, i2 260 km/h). Trap readings on the 22 best laps run 320 (ALO, STR) to 335 (GAS, COL); session maxima per driver run 321 (STR) to 336 (COL). The trace peaks at 331 km/h at 360 m on the pit straight. OpenF1 does not publish where the trap is.

## Cross-check against official classifications

Every best valid lap matches the formula1.com qualifying classification to the millisecond: **22 of 22 drivers**. "F1.com best" is the fastest of each driver's Q1, Q2 and Q3 times. Two drivers (HUL and BOR) set their fastest lap in an earlier session than the one that classified them: HUL's best is his Q2 1:18.639 (his Q3 was 1:18.686) and BOR's is his Q1 1:19.069 (Q2 1:19.105). The file always holds the fastest valid lap. Grid position follows the classification.

| Grid | Driver | Team | Lap | OpenF1 best s | F1.com best s | Diff s | Q | S1 | S2 | S3 | Trap | Axis length m | Dropout s | File KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | NOR | McLaren | 15 | 77.207 | 77.207 | +0.000 | Q3 | 27.364 | 27.621 | 22.222 | 327 | 4340 | 0.0 | 52.1 |
| 2 | HAM | Ferrari | 11 | 77.219 | 77.219 | +0.000 | Q3 | 27.329 | 27.842 | 22.048 | 329 | 4359 | 0.0 | 51.8 |
| 3 | LEC | Ferrari | 16 | 77.445 | 77.445 | +0.000 | Q3 | 27.542 | 27.775 | 22.128 | 327 | 4345 | 0.0 | 52.0 |
| 4 | ANT | Mercedes | 19 | 77.479 | 77.479 | +0.000 | Q3 | 27.426 | 27.781 | 22.272 | 329 | 4345 | 0.0 | 52.0 |
| 5 | PIA | McLaren | 12 | 77.684 | 77.684 | +0.000 | Q3 | 27.572 | 27.646 | 22.466 | 328 | 4340 | 0.0 | 51.5 |
| 6 | VER | Red Bull Racing | 14 | 77.725 | 77.725 | +0.000 | Q3 | 27.593 | 27.654 | 22.478 | 325 | 4347 | 0.0 | 51.8 |
| 7 | RUS | Mercedes | 16 | 77.760 | 77.760 | +0.000 | Q3 | 27.440 | 27.849 | 22.471 | 331 | 4343 | 0.0 | 52.2 |
| 8 | HAD | Red Bull Racing | 10 | 77.856 | 77.856 | +0.000 | Q3 | 27.588 | 27.974 | 22.294 | 330 | 4351 | 0.0 | 51.9 |
| 9 | LIN | Racing Bulls | 14 | 78.281 | 78.281 | +0.000 | Q3 | 27.811 | 28.022 | 22.448 | 327 | 4348 | 0.0 | 51.9 |
| 10 | HUL | Audi | 11 | 78.639 | 78.639 | +0.000 | Q2 | 27.818 | 28.154 | 22.667 | 329 | 4353 | 0.0 | 51.8 |
| 11 | LAW | Racing Bulls | 11 | 78.765 | 78.765 | +0.000 | Q2 | 28.013 | 28.216 | 22.536 | 327 | 4356 | 0.0 | 52.2 |
| 12 | GAS | Alpine | 11 | 78.844 | 78.844 | +0.000 | Q2 | 27.641 | 28.462 | 22.741 | 335 | 4336 | 1.5 | 52.1 |
| 13 | COL | Alpine | 11 | 79.027 | 79.027 | +0.000 | Q2 | 27.900 | 28.415 | 22.712 | 335 | 4341 | 1.5 | 52.0 |
| 14 | BOR | Audi | 5 | 79.069 | 79.069 | +0.000 | Q1 | 27.755 | 28.469 | 22.845 | 331 | 4354 | 0.0 | 52.4 |
| 15 | OCO | Haas F1 Team | 11 | 79.734 | 79.734 | +0.000 | Q2 | 28.154 | 28.739 | 22.841 | 329 | 4339 | 1.5 | 52.0 |
| 16 | ALO | Aston Martin | 14 | 79.808 | 79.808 | +0.000 | Q2 | 28.248 | 28.560 | 23.000 | 320 | 4345 | 0.0 | 52.0 |
| 17 | BEA | Haas F1 Team | 5 | 80.233 | 80.233 | +0.000 | Q1 | 28.229 | 28.862 | 23.142 | 332 | 4351 | 0.0 | 52.4 |
| 18 | SAI | Williams | 8 | 80.621 | 80.621 | +0.000 | Q1 | 28.262 | 28.934 | 23.425 | 330 | 4339 | 0.0 | 52.4 |
| 19 | ALB | Williams | 8 | 80.658 | 80.658 | +0.000 | Q1 | 28.266 | 28.965 | 23.427 | 332 | 4355 | 0.0 | 52.6 |
| 20 | STR | Aston Martin | 5 | 80.659 | 80.659 | +0.000 | Q1 | 28.402 | 29.019 | 23.238 | 320 | 4348 | 0.0 | 52.0 |
| 21 | BOT | Cadillac | 9 | 80.886 | 80.886 | +0.000 | Q1 | 28.271 | 29.277 | 23.338 | 330 | 4345 | 0.0 | 52.4 |
| 22 | PER | Cadillac | 8 | 81.322 | 81.322 | +0.000 | Q1 | 28.355 | 29.665 | 23.302 | 331 | 4342 | 0.0 | 52.5 |

## Deleted laps (race control)

Race control sent 10 "DELETED" messages (track limits except one double-yellow). Nine resolve to timed laps and none of them was faster than the driver's kept best: ANT (laps 6, 7, 10), BOR, COL, GAS, LEC, RUS, SAI. The tenth, PIA lap 11, is a 632.7 s pit-related lap that carries no flying time.

| Driver | Lap | Time s | Kept best s | Race-control message | How matched |
|---|---|---|---|---|---|
| SAI | 2 | 83.576 | 80.621 | CAR 55 (SAI) TIME 1:23.576 DELETED - TRACK LIMITS AT TURN 4 LAP 3 16:02:17 | lap time in message |
| LEC | 2 | 78.878 | 77.445 | CAR 16 (LEC) TIME 1:18.878 DELETED - TRACK LIMITS AT TURN 3 LAP 3 16:04:20 | lap time in message |
| BOR | 2 | 79.476 | 79.069 | CAR 5 (BOR) TIME 1:19.476 DELETED - TRACK LIMITS AT TURN 4 LAP 3 16:08:40 | lap time in message |
| GAS | 3 | 110.027 | 78.844 | CAR 10 (GAS) LAP DELETED - TRACK LIMITS AT TURN 1 LAP 4 16:08:19 (PIT) | clock time in message |
| COL | 3 | 143.229 | 79.027 | CAR 43 (COL) LAP DELETED - TRACK LIMITS AT TURN 7 LAP 4 16:09:25 (PIT) | clock time in message |
| ANT | 6 | 78.554 | 77.479 | CAR 12 (ANT) TIME 1:18.554 DELETED - TRACK LIMITS AT TURN 14 LAP 7 16:16:02 | lap time in message |
| ANT | 7 | 138.409 | 77.479 | CAR 12 (ANT) LAP DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP PIT) | inferred: lap that ended last before the message |
| RUS | 9 | 102.565 | 77.760 | CAR 63 (RUS) TIME 1:42.565 DELETED - DOUBLE YELLOW AT TURN 12 | lap time in message |
| ANT | 10 | 78.178 | 77.479 | CAR 12 (ANT) TIME 1:18.178 DELETED - TRACK LIMITS AT TURN 7 LAP 11 16:30:53 | lap time in message |
| PIA | 11 | 632.711 | 77.684 | CAR 81 (PIA) LAP DELETED - TRACK LIMITS AT TURN 1 LAP 16 16:59:52 (PIT) | clock time in message |

## Not available from the public feeds

- Overtake-mode, active-aero and DRS state; fuel mass; battery state of charge; ERS deployment.
- Telemetry faster than the public feed rate of about 3.7 Hz.

## Reproduce

```sh
python3 ../fetch/fetch_set_b.py fetch --only hungaroring --cache /some/scratch/dir   # stdlib only, about 50 requests per circuit at the 30 req/min free tier
python3 ../fetch/fetch_set_b.py derive --circuit hungaroring    # prints the corner / straight tables (no network)
```
