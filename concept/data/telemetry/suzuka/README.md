# Suzuka 2026 qualifying telemetry (Japanese Grand Prix)

Real car telemetry from qualifying for the 2026 Japanese Grand Prix at Suzuka, Saturday 28 March 2026 (OpenF1 `session_key` **11249**). All 22 drivers, best valid lap of each, all on SOFT. Suzuka is the flowing circuit of this set: a long run of fast corners (Esses, Degner, Spoon, 130R), one hairpin and two straights of about 450 and 1200 m.

**Read this first: Suzuka's `car_data` is badly affected by dropouts.** 19 of the 22 laps lose between 1.5 and 33 s of speed, throttle, brake, gear and rpm to frozen samples. **The pole lap loses 28.6 s**: valid car data covers only 0 to 451 m and 676 to 4014 m (65% of the distance), and nothing after 62.9 s, which hides the Spoon exit, 130R and the final chicane. Only PIA, NOR and HAM have no gap longer than the 1.5 s limit (PIA, HAM and NOR still lose a few samples). Corner and straight tables below therefore use PIA's lap (P3, 0.354 s off pole, 100% valid coverage) as the complete reference, and the pole lap's own table is given beside it. Per-lap coverage is in the `Dropout s` column of the cross-check table and in `processing.dropouts`.

## Source, licence and attribution

- **Telemetry, laps, sectors, speed traps, tyres, weather and race control**: [OpenF1](https://openf1.org), `https://api.openf1.org/v1`, endpoints `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data` and `location`. OpenF1 is an independent community project and is not associated with Formula 1, the FIA or FOM. The underlying timing data belongs to Formula 1, and F1 / FORMULA ONE are trade marks of Formula One Licensing B.V. OpenF1 says its free tier is for "educational purposes, personal learning projects, research, and non-commercial fan engagement"; this hackathon concept falls within that scope, and any commercial use needs a fresh clearance.
- **Corner markers**: the MultiViewer circuit API (`api.multiviewer.app/api/v1/circuits/46/2026`), the source FastF1's `get_circuit_info()` uses. The service returned the layout record dated 2025.
- **Official classification and track length**: formula1.com (https://www.formula1.com/en/results/2026/races/1281/japan/qualifying) and the circuit entry on formula1.com's race page, read on 2026-10-24. FIA PDFs were not fetched.
- **Why not FastF1**: its live-timing archive answered HTTP 401 to anonymous requests on 2026-10-24 (see `../README.md`). OpenF1 served the same timing feed.
- Accessed **2026-10-24**. Nothing here is synthesised. `../fetch/fetch_set_b.py` regenerates every file from the public feeds.

## Files

| File | Content |
|---|---|
| `suzuka-2026-q-<code>.json` x 22 | Best valid qualifying lap of every driver who set one, with 5 m grid channels, lap and sector times, speed trap, compound and processing notes. Pole lap: `suzuka-2026-q-ant.json`. `is_team_best` marks each team's faster driver |
| `suzuka-2026-q-index.json` | Index: per-lap times, sectors, speed trap, compound, distance and dropout figures, file sizes; session-max speed trap per driver; every race-control "DELETED" message with the lap it was matched to |
| `suzuka-2026-q-weather.json` | 73 one-minute weather samples (05:50 to 07:02 UTC) |
| `suzuka-circuit.json` | 18 corner markers (number, angle, x/y in metres, distance on the pole lap) |

Folder size (JSON files): 1.54 MB (1504 KB); largest lap file 68.5 KB. No file needed its raw samples dropped for the 80 KB limit.

### Lap file format

Same layout as the Silverstone files (see `../README.md`): `driver`, `lap`, `processing`, `channels` on a **5 m grid** (`distance_m, time_s, speed_kmh, throttle_pct, brake, gear, rpm, x_m, y_m`) and `raw_car_data` (the un-interpolated OpenF1 samples inside the lap). Differences in this set:

- **Car-data dropouts.** OpenF1's `car_data` sometimes freezes: the feed repeats one sample and marks it with throttle 104 and/or brake 104 (valid throttle is 0 to 100, brake 0 or 100). Such samples, and any run of three or more identical (speed, rpm, throttle, gear) samples after the first, are dropped. Where the remaining samples are more than 1.5 s apart, the grid values of `speed_kmh`, `throttle_pct`, `brake`, `gear` and `rpm` are **null**. Nothing is filled in. `processing.dropouts` lists each gap (time and distance), and `invalid_car_samples_dropped` counts the discarded samples. `x_m` and `y_m` come from the separate `location` feed and stay populated.
- **Distance across a dropout** is the X/Y arc length over the gap instead of the speed integral, so the axis stays aligned to the lap. `processing.length_m` is the axis length, `length_m_xy_path` the X/Y path length, `distance_from_xy_during_dropouts_m` the part taken from X/Y.
- Lap validity: a lap needs a time, all three sector times, no pit-out flag, and no race-control deletion. This excludes laps cut short by a stoppage (see Singapore).
- DRS: OpenF1's `drs` field is null for every sample, as at Silverstone. No active-aero or Overtake channel exists.
- Brake is on/off in the source (0 or 100); braking points are uncertain by about 20 m at the 3.7 Hz feed rate.

## Session and weather

Qualifying ran on Saturday 28 March 2026: Q1 06:00 to 06:18, Q2 06:25 to 06:40, Q3 06:47 to 07:00 UTC (race-control chequered flags). No rain (rainfall 0 throughout). Air 16.3 to 16.9 degC, track 26.1 to 32.7 degC, humidity 44 to 60%, pressure 1008.6 to 1008.8 mbar, wind 0.4 to 3.8 m/s, direction variable. The sample nearest the pole lap (06:49:59 UTC): air 16.4 degC, track 27.5 degC, humidity 50.8%, wind 1.3 m/s from 107 degrees. All 22 laps are SOFT.

## Pole lap and lap length

**Pole: Kimi Antonelli (Mercedes), lap 11, 1:28.778, SOFT** (Q3). Second RUS 1:29.076 (+0.298), third PIA 1:29.132. Sectors S1 31.855, S2 39.439, S3 17.484 s.

Lap length: the 5 m axis is **5778 m** on the pole lap (speed integral, with the X/Y arc length across its dropouts), against the official circuit length of **5.807 km**: 0.5% short, as a racing line should be. The X/Y path is 5767 m. Over the 22 laps the axis runs 5749 to 5797 m (median 5775) and the X/Y path median is 5769 m, so no lap is an outlier.

## Key corners, pole lap

The first table is the **pole lap** (ANT); rows without data lie inside a dropout. The second table, further down, is **PIA's lap** with the full lap covered. Distances run along the lap trace from the timing line. The MultiViewer marker is the corner-number position projected onto the trace; it can sit before or after the apex, so the speed minimum is searched within 110 m of it (and no further than half-way to the next marker). "Lift" is where throttle first drops below 95% before the braking point, "braking starts" the first brake-on sample of the zone, and "entry speed" the highest speed in the 50 m before it. Where the car never slows to a local minimum (flat, or only a lift), the table gives the speed at the marker instead. Two markers that share a braking zone say so in the Note column, with the same entry figures.

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| T1 | 700 | - | - | - | - | - | - | no data: car_data dropout in this lap |
| T2 | 825 | - | - | - | - | - | - | no data: car_data dropout in this lap |
| T3 | 1065 | 237 | 6 | 1065 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T4 | 1190 | 220 | 6 | 1190 | - | - | - | no local minimum: speed at marker, throttle 35% |
| T5 | 1350 | 211 | 5 | 1375 | 1295 | 1330 | 224 |  |
| T6 | 1510 | 184 | 4 | 1560 | 1440 | 1470 | 221 |  |
| T7 | 1845 | 254 | 6 | 1845 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T8 | 2250 | 263 | 7 | 2250 | - | - | - | no local minimum: speed at marker, throttle 0% |
| T9 | 2410 | 143 | 3 | 2445 | 2230 | 2355 | 242 |  |
| T10 | 2725 | 258 | 6 | 2725 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T11 | 2890 | 74 | 1 | 2900 | 2730 | 2775 | 258 |  |
| T12 | 3140 | 254 | 6 | 3140 | - | - | - | no local minimum: speed at marker, throttle 100% |
| T13 | 3770 | 241 | 6 | 3770 | - | - | - | no local minimum: speed at marker, throttle 5% |
| T14 | 3925 | - | - | - | - | - | - | no data: car_data dropout in this lap |
| T15 | 4965 | - | - | - | - | - | - | no data: car_data dropout in this lap |
| T16 | 5360 | - | - | - | - | - | - | no data: car_data dropout in this lap |
| T17 | 5430 | - | - | - | - | - | - | no data: car_data dropout in this lap |
| T18 | 5595 | - | - | - | - | - | - | no data: car_data dropout in this lap |

#### Complete reference lap: PIA, lap 16, 1:29.132 (P3)

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| T1 | 705 | 270 | 8 | 705 | - | - | - | no local minimum: speed at marker, throttle 4% |
| T2 | 830 | 162 | 4 | 855 | 670 | 710 | 285 |  |
| T3 | 1070 | 236 | 6 | 1070 | - | - | - | no local minimum: speed at marker, throttle 99% |
| T4 | 1200 | 219 | 6 | 1200 | - | - | - | no local minimum: speed at marker, throttle 22% |
| T5 | 1350 | 207 | 5 | 1360 | 1155 | - | - | no brake; 235 km/h at lift |
| T6 | 1520 | 187 | 5 | 1540 | 1155 | 1485 | 216 |  |
| T7 | 1845 | 251 | 7 | 1845 | - | - | - | no local minimum: speed at marker, throttle 99% |
| T8 | 2250 | 263 | 7 | 2250 | - | - | - | no local minimum: speed at marker, throttle 0% |
| T9 | 2415 | 146 | 4 | 2455 | 2220 | 2370 | 235 |  |
| T10 | 2720 | 259 | 7 | 2720 | - | - | - | no local minimum: speed at marker, throttle 70% |
| T11 | 2895 | 76 | 2 | 2915 | 2715 | 2800 | 253 |  |
| T12 | 3135 | 253 | 7 | 3135 | - | - | - | no local minimum: speed at marker, throttle 99% |
| T13 | 3780 | 237 | 6 | 3780 | - | - | - | no local minimum: speed at marker, throttle 0% |
| T14 | 3935 | 166 | 4 | 3975 | 3695 | 3885 | 216 |  |
| T15 | 4975 | 292 | 8 | 4975 | - | - | - | no local minimum: speed at marker, throttle 99% |
| T16 | 5380 | 102 | 2 | 5385 | 5240 | 5265 | 275 |  |
| T17 | 5445 | 94 | 2 | 5430 | 5240 | 5405 | 117 |  |
| T18 | 5610 | 229 | 6 | 5610 | - | - | - | no local minimum: speed at marker, throttle 99% |

PIA's lap has no gap longer than 1.5 s (four isolated bad samples were dropped). T5 shows "no brake": he lifts from 235 km/h and does not touch the pedal. The T1 marker sits in the braking zone for the first corner, so the minimum of 162 km/h is attributed to T2 (855 m); read T1 and T2 as one braking event from 710 m at 285 km/h. T16 and T17 are the two parts of the Casino chicane, T11 the hairpin (76 km/h, the slowest point of the lap), T15 is 130R (flat, 292 km/h at the marker).

### Straights, peak and end speeds

Straights are runs of 300 m or more with throttle at or above 95% and no brake (gaps up to 20 m bridged). These rows are PIA's lap. On the pole lap the first row reads 0 to 450 m only, because the car data is missing from 451 m, and the Spoon-to-line straights cannot be read at all.

| Straight | From m | To m | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Drop peak to end |
|---|---|---|---|---|---|---|---|---|
| line to T1 | 0 | 665 | 665 | 271 | 326 | 360 | 283 | 43 |
| T6 to T8 | 1770 | 2215 | 445 | 228 | 278 | 2040 | 273 | 5 |
| T11 to T13 | 2975 | 3690 | 715 | 154 | 301 | 3395 | 286 | 14 |
| T14 to T16 | 4025 | 5235 | 1210 | 194 | 324 | 4520 | 274 | 50 |

**Energy clipping.** On the pit straight PIA is at 326 km/h at 360 m and 283 km/h at 665 m, 43 km/h lower with the throttle still at 95% or more; on the back straight (T14 to T16) the peak of 324 km/h at 4520 m falls to 274 km/h by 5235 m, 50 km/h lower over 715 m. The shorter runs fade less (T11 to T13: 301 to 286; T6 to T8: 278 to 273). This is consistent with the 2026 power units' electrical deployment running out late on a straight; gradient, wind and the speed-dependent rise in drag also act here, and the feed cannot separate them. The pole lap's pit straight shows 321 km/h at 325 m and 320 km/h at 450 m, but its data stops there.

### Full throttle and sectors

Pole lap (ANT): full throttle 49.1% of valid lap time and 57.3% of valid distance, but valid coverage is only 67.6% of time, so the figure is not comparable. PIA (complete lap; the sector line below is also PIA's, the pole lap's sectors are in the section above):

Full throttle (>=99%): 55.1% of valid lap time, 64.4% of valid distance; raw-sample share 56.6%. Brake on 10.4% of valid time. Valid coverage 100.0% of time, 100.0% of distance.

Sectors: S1 31.963 S2 39.557 S3 17.612 (sum 89.132)

**Speed trap.** The official trap reading on the pole lap was **282 km/h** (OpenF1 `st_speed`; intermediates i1 280, i2 328 km/h). OpenF1 does not publish where the trap is. Across the 22 laps the trap on each best lap runs 276 (HAM) to 291 (SAI); the session maxima per driver run 277 (STR) to 291 (LAW, SAI). PIA's trace peaks at 326 km/h on the pit straight, well above the trap readings, so the trap is not at the point of maximum speed.

## Cross-check against official classifications

Every best valid lap matches the formula1.com qualifying classification to the millisecond: **22 of 22 drivers**. "F1.com best" is the fastest of each driver's Q1, Q2 and Q3 times. Five drivers set their fastest lap in an earlier session than the one that classified them (LEC, BOR, LIN, HUL and SAI); the file holds that faster lap. For example LEC's 1:29.303 came in Q2 and his Q3 time was 1:29.405. Grid position follows the classification. Sectors sum to the lap time on every lap.

| Grid | Driver | Team | Lap | OpenF1 best s | F1.com best s | Diff s | Q | S1 | S2 | S3 | Trap | Axis length m | Dropout s | File KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ANT | Mercedes | 11 | 88.778 | 88.778 | +0.000 | Q3 | 31.855 | 39.439 | 17.484 | 282 | 5778 | 28.6 | 65.8 |
| 2 | RUS | Mercedes | 17 | 89.076 | 89.076 | +0.000 | Q3 | 31.853 | 39.607 | 17.616 | 282 | 5780 | 3.7 | 68.0 |
| 3 | PIA | McLaren | 16 | 89.132 | 89.132 | +0.000 | Q3 | 31.963 | 39.557 | 17.612 | 283 | 5774 | 0.0 | 67.2 |
| 4 | LEC | Ferrari | 11 | 89.303 | 89.303 | +0.000 | Q2 | 31.778 | 39.855 | 17.670 | 283 | 5793 | 4.6 | 68.0 |
| 5 | NOR | McLaren | 16 | 89.409 | 89.409 | +0.000 | Q3 | 32.049 | 39.716 | 17.644 | 281 | 5764 | 0.0 | 68.2 |
| 6 | HAM | Ferrari | 16 | 89.567 | 89.567 | +0.000 | Q3 | 31.762 | 39.934 | 17.871 | 276 | 5773 | 0.0 | 67.8 |
| 7 | GAS | Alpine | 17 | 89.691 | 89.691 | +0.000 | Q3 | 32.143 | 40.029 | 17.519 | 285 | 5797 | 8.2 | 68.0 |
| 8 | HAD | Red Bull Racing | 14 | 89.978 | 89.978 | +0.000 | Q3 | 32.164 | 40.137 | 17.677 | 285 | 5777 | 2.6 | 68.2 |
| 9 | BOR | Audi | 13 | 89.990 | 89.990 | +0.000 | Q2 | 32.349 | 40.149 | 17.492 | 285 | 5770 | 26.6 | 66.1 |
| 10 | LIN | Racing Bulls | 14 | 90.109 | 90.109 | +0.000 | Q2 | 32.565 | 40.043 | 17.501 | 287 | 5789 | 17.1 | 67.1 |
| 11 | VER | Red Bull Racing | 11 | 90.262 | 90.262 | +0.000 | Q2 | 32.369 | 40.196 | 17.697 | 283 | 5775 | 2.0 | 68.2 |
| 12 | OCO | Haas F1 Team | 14 | 90.309 | 90.309 | +0.000 | Q2 | 32.561 | 40.048 | 17.700 | 281 | 5750 | 28.2 | 66.7 |
| 13 | HUL | Audi | 7 | 90.358 | 90.358 | +0.000 | Q1 | 32.486 | 40.231 | 17.641 | 282 | 5771 | 29.7 | 66.4 |
| 14 | LAW | Racing Bulls | 14 | 90.495 | 90.495 | +0.000 | Q2 | 32.791 | 40.175 | 17.529 | 285 | 5749 | 9.5 | 67.5 |
| 15 | COL | Alpine | 11 | 90.627 | 90.627 | +0.000 | Q2 | 32.584 | 40.433 | 17.610 | 282 | 5755 | 33.1 | 65.8 |
| 16 | SAI | Williams | 8 | 90.927 | 90.927 | +0.000 | Q1 | 32.917 | 40.434 | 17.576 | 291 | 5773 | 17.7 | 67.3 |
| 17 | ALB | Williams | 8 | 91.088 | 91.088 | +0.000 | Q1 | 32.858 | 40.489 | 17.741 | 283 | 5778 | 21.0 | 67.1 |
| 18 | BEA | Haas F1 Team | 8 | 91.090 | 91.090 | +0.000 | Q1 | 32.824 | 40.421 | 17.845 | 277 | 5750 | 8.9 | 68.2 |
| 19 | PER | Cadillac | 5 | 92.206 | 92.206 | +0.000 | Q1 | 33.512 | 40.667 | 18.027 | 283 | 5750 | 1.5 | 68.4 |
| 20 | BOT | Cadillac | 8 | 92.330 | 92.330 | +0.000 | Q1 | 33.362 | 41.021 | 17.947 | 285 | 5790 | 5.0 | 68.1 |
| 21 | ALO | Aston Martin | 8 | 92.646 | 92.646 | +0.000 | Q1 | 33.536 | 41.206 | 17.904 | 280 | 5782 | 3.2 | 68.5 |
| 22 | STR | Aston Martin | 5 | 92.920 | 92.920 | +0.000 | Q1 | 33.631 | 41.341 | 17.948 | 277 | 5786 | 9.1 | 68.0 |

## Deleted laps (race control)

Race control deleted one lap time in qualifying, found with the `race_control` feed: **LIN, lap 17, 1:31.537**, track limits at T13. It was slower than his kept best (1:30.109). OpenF1 times all other laps as valid.

| Driver | Lap | Time s | Kept best s | Race-control message | How matched |
|---|---|---|---|---|---|
| LIN | 17 | 91.537 | 90.109 | CAR 41 (LIN) TIME 1:31.537 DELETED - TRACK LIMITS AT TURN 13 LAP 18 15:50:40 | lap time in message |

## Not available from the public feeds

- Overtake-mode, active-aero and DRS state; fuel mass; battery state of charge; ERS deployment.
- Telemetry faster than the public feed rate of about 3.7 Hz.

## Reproduce

```sh
python3 ../fetch/fetch_set_b.py fetch --only suzuka --cache /some/scratch/dir   # stdlib only, about 50 requests per circuit at the 30 req/min free tier
python3 ../fetch/fetch_set_b.py derive --circuit suzuka [--lap PIA]    # prints the corner / straight tables (no network)
```
