# Silverstone 2026 qualifying telemetry

Real car telemetry from qualifying for the 2026 British Grand Prix (Silverstone, Saturday 4 July 2026, OpenF1 `session_key` 11322). It is here so the physics lap simulator's corner speeds, braking points and straight-line speeds can be checked against real laps.

Accessed **2026-10-24**. Nothing in this folder is synthesised. Every number comes from the public feeds listed below, through `fetch/fetch_openf1.py`.

## Source, licence and attribution

- **Telemetry, laps, sectors, speed traps, tyres, weather and race control**: [OpenF1](https://openf1.org), at `https://api.openf1.org/v1`, endpoints `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data` and `location`. OpenF1 is an independent community project and is not associated with Formula 1, the FIA or FOM. The underlying timing data belongs to Formula 1, and F1 / FORMULA ONE are trade marks of Formula One Licensing B.V. OpenF1 says its free tier is for "educational purposes, personal learning projects, research, and non-commercial fan engagement", and asks other uses to contact them about licensing. This hackathon concept falls within that scope. Any commercial use needs a fresh clearance.
- **Corner markers**: the MultiViewer circuit API (`api.multiviewer.app/api/v1/circuits/2/2026`). FastF1's `Session.get_circuit_info()` uses this same source, with thanks to MultiViewer (multiviewer.app). The service returned the layout record dated 2022. The circuit has not changed since then, and the markers line up with the 2026 X/Y traces to within 6.6 m.
- **Why FastF1 was not used**: FastF1 3.9.0 supports the 2026 season and loads the schedule and driver list. However, the F1 live-timing archive it reads (`livetiming.formula1.com/static/2026/...`) returned **HTTP 401** from CloudFront to anonymous requests on 2026-10-24. 2025 returned 401 as well. FastF1 then logs "No F1 account credentials available. Set the environment variables F1_USERNAME and F1_PASSWORD." No credentials were used, so OpenF1 served as the alternative public source. OpenF1 serves the same timing feed.

## Files

| File | Content | Size |
|---|---|---|
| `silverstone-2026-q-ant.json` | **Pole lap**: Antonelli (Mercedes), lap 18, 88.111 s, SOFT | 58.8 KB |
| `silverstone-2026-q-{lec,had,nor,law,bor,gas,bea,sai,bot,str}.json` | Fastest qualifying lap of each team's faster driver: LEC Ferrari 88.286, HAD Red Bull 88.746, NOR McLaren 88.877, LAW Racing Bulls 89.300, BOR Audi 89.461, GAS Alpine 90.063, BEA Haas 90.501, SAI Williams 90.562, BOT Cadillac 91.227, STR Aston Martin 92.863. All laps on SOFT tyres | 58.4 to 58.9 KB each |
| `silverstone-2026-q-index.json` | Index of the telemetry laps, best valid lap per driver (all 22, with sectors and speed trap), session-max speed trap per driver, and the lap times race control deleted | 6.7 KB |
| `silverstone-2026-q-weather.json` | 80 one-minute weather samples, 14:50 to 16:10 UTC | 5.7 KB |
| `silverstone-circuit.json` | 18 corner markers (number, angle, x/y in metres, distance on the pole lap) | 3.1 KB |

### Lap file format

Each lap file contains `driver` (code, name, team), `lap` (lap time, three sector times, speed trap / i1 / i2 speeds, compound, tyre age at stint start, UTC start time), `processing` (method notes and raw sample counts) and the `channels` object. The channels are parallel arrays on a **5 m distance grid** of about 1,166 points:

`distance_m, time_s, speed_kmh, throttle_pct, brake (bool), gear, rpm, x_m, y_m`

- **Distance**: OpenF1 has no distance channel, so distance is the trapezoidal integral of speed over time from the lap start. Lap lengths come out at 5806 to 5840 m. The X/Y path length agrees to within 0.3% (pole lap: 5824.6 m from speed, 5823.7 m from X/Y). The published track length of 5891 m is measured on the centre line, while these laps follow the racing line.
- **Sample rate**: `car_data` arrives at about 3.7 Hz, which gives 320 to 338 samples per lap, or one every 20 to 25 m at 300 km/h. The 5 m grid is linear interpolation in time for speed, throttle, rpm and X/Y. Brake and gear use the last sample before each grid point. Braking points are therefore uncertain by roughly ±20 m. `brake` is on/off in the source data (0 or 100).
- **X/Y**: these are the F1 timing frame divided by 10 to give metres. Start and end positions of every lap agree to within 1 to 4 m, which confirms the lap boundaries.
- **DRS / active aero**: OpenF1's `drs` field is null for every sample of these laps, so no flag is stored. 2026 cars have no DRS, and the feed does not carry the active-aero mode.

## Weather (qualifying session)

There was no rain (rainfall 0 throughout). Air temperature was 24.9 to 25.9 °C, track temperature 38.2 to 44.4 °C, humidity 46 to 50%, pressure 1007.4 to 1007.8 mbar, and wind 0.3 to 4.9 m/s with variable direction. The sample nearest the pole lap (16:06:54 UTC) read: air 25.4 °C, track 41.2 °C, humidity 49.3%, wind 2.2 m/s from 105°.

## Pole lap: key corners (Antonelli, 88.111 s)

Distances are measured along the pole trace from the timing line. "Marker" is the MultiViewer corner position projected onto the trace. "Entry speed" is the highest speed in the 50 m before the braking point. Corner names follow the usual Silverstone numbering: Maggotts T10/11, Becketts T12/13, Chapel T14, Club T17/18. Where a corner has no local speed minimum, because the car is flat out or accelerating through it, the table gives the speed at the marker instead.

| Corner (Tn) | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| Abbey (T1) | 440 | 300 | 7 | 440 | - | - | - | flat, speed at marker |
| Farm (T2) | 605 | 285 | 7 | 605 | - | - | - | flat, speed at marker |
| Village (T3) | 860 | 108 | 2 | 910 | 775 | 780 | 272 | |
| The Loop (T4) | 1030 | 87 | 2 | 1035 | 945 | 980 | 140 | slowest point of the lap |
| Aintree (T5) | 1220 | 237 | 5 | 1220 | - | - | - | accelerating, speed at marker |
| Wellington Straight end | - | - | - | - | 1830 | 1865 | 288 | peak 310 km/h at 1655 m |
| Brooklands (T6) | 1950 | 167 | 4 | 1990 | 1830 | 1865 | 288 | |
| Luffield (T7) | 2175 | 114 | 2 | 2155 | 2060 | 2065 | 185 | |
| Woodcote (T8) | 2515 | 290 | 7 | 2515 | - | - | - | accelerating, speed at marker |
| Copse (T9) | 3040 | 282 | 7 | 3105 | - | - | - | flat (throttle ≥ 95% throughout) |
| Maggotts (T10/11) | 3590/3680 | 285/278 | 7 | - | - | - | - | flat, speeds at markers |
| Becketts (T12/13) | 3825/3970 | 219 | 5 | 4015 | 3790 | 3895 | 259 | brief brake application |
| Chapel (T14) | 4120 | 254 | 6 | 4120 | - | - | - | accelerating, speed at marker |
| Hangar Straight end | - | - | - | - | 4885 | 4900 | 300 | peak 305 km/h at 4520 m |
| Stowe (T15) | 4980 | 236 | 6 | 5015 | 4885 | 4900 | 300 | |
| Vale (T16) | 5435 | 102 | 2 | 5480 | 5380 | 5380 | 260 | |
| Club (T17/18) | 5520/5670 | 128/214 | 2/5 | - | - | - | - | T17 at 40% throttle, T18 at 100% |

### Straights and speed trap

| Straight | Peak km/h | Peak at m | Speed at lift/brake point km/h | At m |
|---|---|---|---|---|
| Hamilton (pit) straight | 313 | 240 | 300 (Abbey, still flat) | 440 |
| Wellington Straight | 310 | 1655 | 285 | 1825 |
| Hangar Straight | 305 | 4520 | 299 | 4880 |
| Woodcote to Copse (lap maximum) | 317 | 2810 | - | - |

- **Speed trap**: the official trap on the pole lap read **302 km/h** (OpenF1 `st_speed`; intermediates i1 295 and i2 268 km/h). OpenF1 does not publish where the trap is. Fitting all 11 team laps' trap readings to their traces gives a best position of **4780 m**, on the Hangar Straight about 110 m before the braking point for Stowe (RMS 0.8 km/h). The pole trace reads 303 km/h at that point.
- **Speed falls on the straights with the throttle at 100%**: the pit straight drops from 313 km/h at 240 m to 276 km/h at 720 m, the Wellington from 310 to 285, and the Hangar from 305 to 299. This fits the 2026 power units' electrical deployment tapering off late on a straight, plus cornering load through Abbey and Farm. A simulator that only balances power against drag will overestimate the speed at the end of each straight at Silverstone.
- **Full throttle** (≥ 99%) covers **63.8% of lap time** and 74.5% of distance (65.5% of raw samples). The brake is on for 10.8% of lap time.
- **Sectors**: S1 28.348 s, S2 35.521 s, S3 24.242 s, totalling 88.111 s. S1 ends at about 1805 m and S2 at about 4240 m along the trace.
- Antonelli lifts to 0% throttle at about 5770 m, roughly 55 m before the line, with no brake. None of the other ten laps does this.

## Cross-check against `js/data/racepace2026.js`

- **Pole**: ANT 88.111 s in both sources. **Lap times**: 21 of 22 drivers match `q` to the millisecond.
- **PER differs (+0.489 s)**: the repo has 91.451. Race control deleted that lap ("CAR 11 (PER) TIME 1:31.451 DELETED - TRACK LIMITS AT TURN 9"), and his best valid lap in OpenF1 is 91.940. ALO's 1:32.888 was also deleted, and the repo correctly uses his 93.025. The deleted laps are listed in `silverstone-2026-q-index.json`.
- **Speed trap**: OpenF1 gives whole km/h, while the repo's `speedTrapQuali` has one decimal place. For all 22 drivers the OpenF1 session maximum is 0.0 to 0.9 km/h below the repo value, which fits truncation. For example, ANT reads 302 against 302.6 and HAM 317 against 317.9. No driver differs by 1 km/h or more.

## Reproduce

```sh
python3 fetch/fetch_openf1.py --cache /some/scratch/dir   # stdlib only; ~30 requests, paced to OpenF1's 30 req/min
python3 fetch/derive.py                                    # prints the tables above (no network)
```

Behind a TLS-intercepting proxy, set `SSL_CERT_FILE` to its CA bundle. `urllib` also honours `HTTPS_PROXY`.
