# Singapore (Marina Bay) 2026 qualifying telemetry

Real car telemetry from qualifying for the 2026 Singapore Grand Prix at Marina Bay, Saturday 10 October 2026 (OpenF1 `session_key` **11384**). 21 drivers, best valid lap of each, all on SOFT. Marina Bay is the street circuit of this set: 19 corners (the 2023 layout), the lowest top speed (308 km/h) and the highest humidity. **HAD has no file**: he did not set a lap time (classified RT, no Q1 time; OpenF1 holds only a 263.003 s lap 2 with a first sector and nothing else). The car data is mostly clean; GAS, COL, ALO and STR have one or two gaps of 2 to 5 s.

## Source, licence and attribution

- **Telemetry, laps, sectors, speed traps, tyres, weather and race control**: [OpenF1](https://openf1.org), `https://api.openf1.org/v1`, endpoints `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data` and `location`. OpenF1 is an independent community project and is not associated with Formula 1, the FIA or FOM. The underlying timing data belongs to Formula 1, and F1 / FORMULA ONE are trade marks of Formula One Licensing B.V. OpenF1 says its free tier is for "educational purposes, personal learning projects, research, and non-commercial fan engagement"; this hackathon concept falls within that scope, and any commercial use needs a fresh clearance.
- **Corner markers**: the MultiViewer circuit API (`api.multiviewer.app/api/v1/circuits/61/2026`), the source FastF1's `get_circuit_info()` uses. The service returned the layout record dated 2023.
- **Official classification and track length**: formula1.com (https://www.formula1.com/en/results/2026/races/1296/singapore/qualifying) and the circuit entry on formula1.com's race page, read on 2026-10-24. FIA PDFs were not fetched.
- **Why not FastF1**: its live-timing archive answered HTTP 401 to anonymous requests on 2026-10-24 (see `../README.md`). OpenF1 served the same timing feed.
- Accessed **2026-10-24**. Nothing here is synthesised. `../fetch/fetch_set_b.py` regenerates every file from the public feeds.

## Files

| File | Content |
|---|---|
| `singapore-2026-q-<code>.json` x 21 | Best valid qualifying lap of every driver who set one, with 5 m grid channels, lap and sector times, speed trap, compound and processing notes. Pole lap: `singapore-2026-q-ver.json`. `is_team_best` marks each team's faster driver |
| `singapore-2026-q-index.json` | Index: per-lap times, sectors, speed trap, compound, distance and dropout figures, file sizes; session-max speed trap per driver; every race-control "DELETED" message with the lap it was matched to |
| `singapore-2026-q-weather.json` | 88 one-minute weather samples (13:17 to 14:44 UTC) |
| `singapore-circuit.json` | 19 corner markers (number, angle, x/y in metres, distance on the pole lap) |

Folder size (JSON files): 1.31 MB (1277 KB); largest lap file 60.4 KB. No file needed its raw samples dropped for the 80 KB limit.

### Lap file format

Same layout as the Silverstone files (see `../README.md`): `driver`, `lap`, `processing`, `channels` on a **5 m grid** (`distance_m, time_s, speed_kmh, throttle_pct, brake, gear, rpm, x_m, y_m`) and `raw_car_data` (the un-interpolated OpenF1 samples inside the lap). Differences in this set:

- **Car-data dropouts.** OpenF1's `car_data` sometimes freezes: the feed repeats one sample and marks it with throttle 104 and/or brake 104 (valid throttle is 0 to 100, brake 0 or 100). Such samples, and any run of three or more identical (speed, rpm, throttle, gear) samples after the first, are dropped. Where the remaining samples are more than 1.5 s apart, the grid values of `speed_kmh`, `throttle_pct`, `brake`, `gear` and `rpm` are **null**. Nothing is filled in. `processing.dropouts` lists each gap (time and distance), and `invalid_car_samples_dropped` counts the discarded samples. `x_m` and `y_m` come from the separate `location` feed and stay populated.
- **Distance across a dropout** is the X/Y arc length over the gap instead of the speed integral, so the axis stays aligned to the lap. `processing.length_m` is the axis length, `length_m_xy_path` the X/Y path length, `distance_from_xy_during_dropouts_m` the part taken from X/Y.
- Lap validity: a lap needs a time, all three sector times, no pit-out flag, and no race-control deletion. This excludes laps cut short by a stoppage (see Singapore).
- DRS: OpenF1's `drs` field is null for every sample, as at Silverstone. No active-aero or Overtake channel exists.
- Brake is on/off in the source (0 or 100); braking points are uncertain by about 20 m at the 3.7 Hz feed rate.

## Session and weather

OpenF1 lists the session as 13:00 to 14:00 UTC, but the laps and race-control messages show it ran later: **Q1 13:30 to 13:48, Q2 13:55 to 14:10, Q3 14:17 to 14:30 UTC** (21:30 local). The weather file therefore runs to 14:44 UTC. No rain. Air 29.6 to 30.0 degC, track 38.2 to 42.4 degC, humidity 73 to 77.7%, pressure 1009.6 to 1010.6 mbar, wind 0.8 to 2.5 m/s from 116 to 185 degrees. **One sample (14:36:51 UTC, after Q3) reads track temperature 0.0 degC**, a sensor dropout kept as sent. The sample nearest the pole lap (14:19:51 UTC): air 29.7 degC, track 39.6 degC, humidity 73.8%, wind 1.9 m/s from 165 degrees. All 21 laps are SOFT.

## Pole lap and lap length

**Pole: Max Verstappen (Red Bull Racing), lap 11, 1:31.373, SOFT** (Q3). Second LEC 1:31.427 (+0.054), third HAM 1:31.496. Sectors S1 27.002, S2 38.531, S3 25.840 s.

Lap length: the 5 m axis is **4881 m** on the pole lap against the official **4.927 km** (0.9% short); X/Y path 4854 m. Over the 21 laps the axis runs 4836 to 4898 m (median 4879) and the X/Y path median is 4860 m, with one outlier: **STR's axis is 4684 m** while his X/Y path is 4848 m. About 165 m is missing between 4000 and 4125 m (81.6 to 84.8 s), where the car-data timing and the X/Y feed disagree, so treat STR's distance axis after 4000 m as unreliable.

## Key corners, pole lap

Distances run along the lap trace from the timing line. The MultiViewer marker is the corner-number position projected onto the trace; it can sit before or after the apex, so the speed minimum is searched within 110 m of it (and no further than half-way to the next marker). "Lift" is where throttle first drops below 95% before the braking point, "braking starts" the first brake-on sample of the zone, and "entry speed" the highest speed in the 50 m before it. Where the car never slows to a local minimum (flat, or only a lift), the table gives the speed at the marker instead. Two markers that share a braking zone say so in the Note column, with the same entry figures.

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| T1 | 395 | 133 | 3 | 415 | 280 | 300 | 307 |  |
| T2 | 460 | 160 | 3 | 460 | - | - | - | no local minimum: speed at marker, throttle 84% |
| T3 | 535 | 89 | 2 | 555 | 460 | 485 | 163 |  |
| T4 | 685 | 214 | 4 | 685 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T5 | 955 | 144 | 4 | 955 | 830 | 870 | 261 |  |
| T6 | 1375 | 298 | 8 | 1375 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T7 | 1750 | 118 | 3 | 1775 | 1595 | 1675 | 285 |  |
| T8 | 1980 | 78 | 2 | 1980 | 1870 | 1905 | 212 |  |
| T9 | 2165 | 130 | 3 | 2170 | 2085 | 2115 | 195 |  |
| T10 | 2595 | 139 | 3 | 2610 | 2490 | 2515 | 282 |  |
| T11 | 2755 | 112 | 3 | 2760 | 2685 | 2695 | 171 |  |
| T12 | 2840 | 181 | 4 | 2840 | - | - | - | no local minimum: speed at marker, throttle 88% |
| T13 | 3005 | 64 | 1 | 3025 | 2890 | 2915 | 218 |  |
| T14 | 3570 | 89 | 2 | 3555 | 3410 | 3430 | 292 |  |
| T15 | 3785 | 253 | 6 | 3785 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T16 | 4280 | 110 | 3 | 4295 | 4150 | 4165 | 302 |  |
| T17 | 4355 | 136 | 3 | 4355 | - | - | - | no local minimum: speed at marker, throttle 47% |
| T18 | 4605 | 196 | 5 | 4655 | 4565 | 4605 | 257 |  |
| T19 | 4730 | 229 | 5 | 4730 | - | - | - | no local minimum: speed at marker, throttle 100% |

### Straights, peak and end speeds

Runs of 300 m or more at 95% throttle or above with no brake. Marina Bay has three; none is long.

| Straight | From m | To m | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Drop peak to end |
|---|---|---|---|---|---|---|---|---|
| T5 to T7 | 1000 | 1590 | 590 | 171 | 308 | 1590 | 308 | 0 |
| T13 to T14 | 3085 | 3405 | 320 | 143 | 289 | 3405 | 289 | 0 |
| T14 to T16 | 3605 | 4145 | 540 | 138 | 302 | 4135 | 302 | 0 |

In every run the speed is still at its peak when the driver lifts (308 km/h at 1590 m, 289 at 3405 m, 302 at 4135 m): the runs are too short for the electrical deployment to run out, so Singapore shows no clipping on the pole lap. T6 (1375 m) is taken flat at 298 km/h inside the T5 to T7 run. The slowest points are T13 (64 km/h, 1st gear) and T8 (78 km/h).

### Full throttle and sectors

Full throttle (>=99%): 43.1% of valid lap time, 54.5% of valid distance; raw-sample share 47.3%. Brake on 22.2% of valid time. Valid coverage 100.0% of time, 100.0% of distance.

Sectors: S1 27.002 S2 38.531 S3 25.840 (sum 91.373)

**Speed trap.** On the pole lap the official trap read **304 km/h** (i1 307, i2 285 km/h). Trap readings on the 21 best laps run 293 (STR) to 304 (VER, RUS, LAW); session maxima per driver run 295 (STR) to 305 (RUS). The trace peaks at 308 km/h at 1590 m. OpenF1 does not publish where the trap is.

## Cross-check against official classifications

Every best valid lap matches the formula1.com qualifying classification to the millisecond: **21 of 21 classified drivers** (HAD is RT on formula1.com, with no time). "F1.com best" is the fastest of each driver's Q1, Q2 and Q3 times. Three drivers (LAW, LIN, COL) set their fastest lap in an earlier session than the one that classified them: LAW's 1:32.319 (Q2) beat his Q3 1:32.369, LIN's 1:32.498 (Q2) beat his Q3 1:32.781, and COL's 1:33.261 came in Q1 against 1:33.787 in Q2. The file always holds the fastest valid lap. Grid position follows the classification.

| Grid | Driver | Team | Lap | OpenF1 best s | F1.com best s | Diff s | Q | S1 | S2 | S3 | Trap | Axis length m | Dropout s | File KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | VER | Red Bull Racing | 11 | 91.373 | 91.373 | +0.000 | Q3 | 27.002 | 38.531 | 25.840 | 304 | 4881 | 0.0 | 59.6 |
| 2 | LEC | Ferrari | 24 | 91.427 | 91.427 | +0.000 | Q3 | 27.025 | 38.401 | 26.001 | 300 | 4898 | 0.0 | 59.8 |
| 3 | HAM | Ferrari | 21 | 91.496 | 91.496 | +0.000 | Q3 | 27.273 | 38.258 | 25.965 | 301 | 4898 | 0.0 | 59.9 |
| 4 | ANT | Mercedes | 19 | 91.562 | 91.562 | +0.000 | Q3 | 27.156 | 38.452 | 25.954 | 302 | 4886 | 0.0 | 59.8 |
| 5 | NOR | McLaren | 20 | 91.712 | 91.712 | +0.000 | Q3 | 27.193 | 38.471 | 26.048 | 303 | 4874 | 0.0 | 59.8 |
| 6 | RUS | Mercedes | 19 | 91.747 | 91.747 | +0.000 | Q3 | 27.177 | 38.675 | 25.895 | 304 | 4867 | 0.0 | 59.3 |
| 7 | PIA | McLaren | 21 | 91.860 | 91.860 | +0.000 | Q3 | 27.200 | 38.376 | 26.284 | 302 | 4882 | 0.0 | 59.9 |
| 8 | GAS | Alpine | 21 | 92.225 | 92.225 | +0.000 | Q3 | 27.177 | 38.775 | 26.273 | 303 | 4852 | 2.0 | 58.9 |
| 9 | LAW | Racing Bulls | 14 | 92.319 | 92.319 | +0.000 | Q2 | 27.305 | 38.909 | 26.105 | 304 | 4878 | 0.0 | 60.0 |
| 10 | LIN | Racing Bulls | 14 | 92.498 | 92.498 | +0.000 | Q2 | 27.331 | 38.964 | 26.203 | 302 | 4881 | 0.0 | 60.1 |
| 11 | HUL | Audi | 18 | 92.784 | 92.784 | +0.000 | Q2 | 27.462 | 39.173 | 26.149 | 298 | 4888 | 0.0 | 60.2 |
| 12 | BEA | Haas F1 Team | 11 | 92.908 | 92.908 | +0.000 | Q2 | 27.543 | 39.046 | 26.319 | 301 | 4887 | 0.0 | 60.2 |
| 16 | COL | Alpine | 7 | 93.261 | 93.261 | +0.000 | Q1 | 27.567 | 39.385 | 26.309 | 303 | 4836 | 2.8 | 59.1 |
| 13 | OCO | Haas F1 Team | 11 | 93.323 | 93.323 | +0.000 | Q2 | 27.828 | 39.091 | 26.404 | 299 | 4878 | 0.0 | 60.3 |
| 14 | SAI | Williams | 12 | 93.526 | 93.526 | +0.000 | Q2 | 27.682 | 39.402 | 26.442 | 301 | 4887 | 0.0 | 60.4 |
| 15 | BOR | Audi | 15 | 93.658 | 93.658 | +0.000 | Q2 | 27.670 | 39.484 | 26.504 | 295 | 4895 | 0.0 | 60.1 |
| 17 | ALO | Aston Martin | 8 | 94.223 | 94.223 | +0.000 | Q1 | 27.955 | 39.352 | 26.916 | 296 | 4805 | 3.0 | 59.0 |
| 18 | ALB | Williams | 9 | 94.289 | 94.289 | +0.000 | Q1 | 27.811 | 39.850 | 26.628 | 302 | 4879 | 0.0 | 59.7 |
| 19 | STR | Aston Martin | 4 | 94.946 | 94.946 | +0.000 | Q1 | 28.117 | 39.784 | 27.045 | 293 | 4684 | 5.4 | 57.5 |
| 20 | PER | Cadillac | 7 | 95.123 | 95.123 | +0.000 | Q1 | 28.031 | 40.017 | 27.075 | 300 | 4872 | 0.0 | 60.0 |
| 21 | BOT | Cadillac | 5 | 95.984 | 95.984 | +0.000 | Q1 | 28.415 | 40.507 | 27.062 | 300 | 4867 | 0.0 | 59.3 |

## Deleted laps (race control)

Race control sent 13 "DELETED" messages. Four are double-yellow deletions (PER, ALB, SAI, NOR) that fall in OpenF1 lap 1, an out-lap with no recorded time. Six resolve to laps with a time (ANT lap 7 at 1:32.818 against his kept 1:31.562; LIN laps 3 and 6, NOR lap 15, PIA lap 16 and STR lap 8, which are 112 to 133 s in-laps and out-laps), and three more are pit or partial laps (HAD lap 2, 263.003 s with only sector 1; PER lap 6; COL lap 9). None removes a best lap.

| Driver | Lap | Time s | Kept best s | Race-control message | How matched |
|---|---|---|---|---|---|
| PER | 1 | - | 95.123 | CAR 11 (PER) LAP DELETED - DOUBLE YELLOW AT TURN 12 LAP 2 21:32:22 | clock time in message |
| ALB | 1 | - | 94.289 | CAR 23 (ALB) LAP DELETED - DOUBLE YELLOW AT TURN 13 LAP 2 21:32:22 | clock time in message |
| SAI | 1 | - | 93.526 | CAR 55 (SAI) LAP DELETED - DOUBLE YELLOW AT TURN 11 LAP 2 21:32:26 | clock time in message |
| NOR | 1 | - | 91.712 | CAR 1 (NOR) LAP DELETED - DOUBLE YELLOW AT TURN 11 LAP 2 21:32:34 | clock time in message |
| LIN | 3 | 133.307 | 92.498 | CAR 41 (LIN) LAP DELETED - TRACK LIMITS AT TURN 5 LAP 4 21:34:30 (PIT) | clock time in message |
| HAD | 2 | 263.003 | - | CAR 6 (HAD) LAP DELETED - TRACK LIMITS AT TURN 11 LAP 3 21:35:19 (PIT) | clock time in message |
| LIN | 6 | 112.814 | 92.498 | CAR 41 (LIN) LAP DELETED - TRACK LIMITS AT TURN 11 LAP 7 21:41:03 (PIT) | clock time in message |
| ANT | 7 | 92.818 | 91.562 | CAR 12 (ANT) TIME 1:32.818 DELETED - TRACK LIMITS AT TURN 2 LAP 8 21:42:03 | lap time in message |
| PER | 6 | 282.414 | 95.123 | CAR 11 (PER) LAP DELETED - TRACK LIMITS AT TURN 1 LAP 9 21:47:46 (PIT) | clock time in message |
| STR | 8 | 128.045 | 94.946 | CAR 18 (STR) LAP DELETED - TRACK LIMITS AT TURN 11 LAP 9 21:50:10 (PIT) | clock time in message |
| COL | 9 | 509.586 | 93.261 | CAR 43 (COL) LAP DELETED - TRACK LIMITS AT TURN 11 LAP 12 22:01:04 (PIT) | clock time in message |
| NOR | 15 | 120.644 | 91.712 | CAR 1 (NOR) LAP DELETED - TRACK LIMITS AT TURN 16 LAP 16 22:04:01 (PIT) | clock time in message |
| PIA | 16 | 121.972 | 91.860 | CAR 81 (PIA) LAP DELETED - TRACK LIMITS AT TURN 2 LAP 17 22:09:14 (PIT) | clock time in message |

## Not available from the public feeds

- Overtake-mode, active-aero and DRS state; fuel mass; battery state of charge; ERS deployment.
- Telemetry faster than the public feed rate of about 3.7 Hz.
- HAD: no valid timed lap (RT in Q1).

## Reproduce

```sh
python3 ../fetch/fetch_set_b.py fetch --only singapore --cache /some/scratch/dir   # stdlib only, about 50 requests per circuit at the 30 req/min free tier
python3 ../fetch/fetch_set_b.py derive --circuit singapore    # prints the corner / straight tables (no network)
```
