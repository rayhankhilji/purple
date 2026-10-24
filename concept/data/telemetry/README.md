# Silverstone 2026 qualifying telemetry

Real car telemetry from the 2026 British Grand Prix at Silverstone: qualifying on Saturday 4 July 2026 (OpenF1 `session_key` 11322) and selected Red Bull Racing race laps on Sunday 5 July (11326). It is here so the physics lap simulator's corner speeds, braking points and straight-line speeds can be checked against real laps.

Accessed **2026-10-24**. Nothing in this folder is synthesised. Every number comes from the public feeds listed below, through `fetch/fetch_openf1.py`.

## Source, licence and attribution

- **Telemetry, laps, sectors, speed traps, tyres, weather and race control**: [OpenF1](https://openf1.org), at `https://api.openf1.org/v1`, endpoints `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data` and `location`. OpenF1 is an independent community project and is not associated with Formula 1, the FIA or FOM. The underlying timing data belongs to Formula 1, and F1 / FORMULA ONE are trade marks of Formula One Licensing B.V. OpenF1 says its free tier is for "educational purposes, personal learning projects, research, and non-commercial fan engagement", and asks other uses to contact them about licensing. This hackathon concept falls within that scope. Any commercial use needs a fresh clearance.
- **Corner markers**: the MultiViewer circuit API (`api.multiviewer.app/api/v1/circuits/2/2026`). FastF1's `Session.get_circuit_info()` uses this same source, with thanks to MultiViewer (multiviewer.app). The service returned the layout record dated 2022. The circuit has not changed since then, and the markers line up with the 2026 X/Y traces to within 6.6 m.
- **Why FastF1 was not used**: FastF1 3.9.0 supports the 2026 season and loads the schedule and driver list. However, the F1 live-timing archive it reads (`livetiming.formula1.com/static/2026/...`) returned **HTTP 401** from CloudFront to anonymous requests on 2026-10-24. 2025 returned 401 as well. FastF1 then logs "No F1 account credentials available. Set the environment variables F1_USERNAME and F1_PASSWORD." No credentials were used, so OpenF1 served as the alternative public source. OpenF1 serves the same timing feed.

## Files

| File | Content | Size |
|---|---|---|
| `silverstone-2026-q-ant.json` | **Pole lap**: Antonelli (Mercedes), lap 18, 88.111 s, SOFT | 69.4 KB |
| `silverstone-2026-q-{had,ver}.json` | **Red Bull Racing (demo team)**: HAD lap 17, 88.746 s; VER lap 17, 88.893 s. Both SOFT | 69.1 KB / 69.0 KB |
| `silverstone-2026-q-<code>.json` × 19 more | Best valid qualifying lap of every other driver, all on SOFT: LEC 88.286, HAM 88.458, RUS 88.481, NOR 88.877, PIA 89.032, LAW 89.300, LIN 89.305, BOR 89.461, HUL 89.539, GAS 90.063, BEA 90.501, SAI 90.562, ALB 90.638, OCO 90.680, BOT 91.227, COL 91.321, PER 91.940, STR 92.863, ALO 93.025. These can serve as held-out checks. `is_team_best` marks each team's faster driver | 68.3 to 69.8 KB each |
| `silverstone-2026-q-index.json` | Index of the 22 telemetry laps, best valid lap per driver (with sectors and speed trap), session-max speed trap per driver, and the lap times race control deleted | 9.0 KB |
| `silverstone-2026-r-{ver,had}-lapNN.json` × 8 | **Race laps, Red Bull**: the 3 fastest green laps of each driver plus one Overtake-candidate lap each. See [Race laps](#race-laps-red-bull-racing) | 69.6 to 70.1 KB each |
| `silverstone-2026-r-index.json` | Every race lap of VER and HAD: time, green flag, compound, tyre age, stint, raw full-throttle share, passes made, minimum gap to the car ahead. Also the neutralised periods and the selection rules | 18.3 KB |
| `silverstone-2026-q-weather.json` | 80 one-minute weather samples, 14:50 to 16:10 UTC | 5.7 KB |
| `silverstone-circuit.json` | 18 corner markers (number, angle, x/y in metres, distance on the pole lap) | 3.1 KB |

### Lap file format

Each lap file contains `driver` (code, name, team), `lap` (lap time, three sector times, speed trap / i1 / i2 speeds, compound, tyre age at stint start, UTC start time), `processing` (method notes and raw sample counts) and the `channels` object. The channels are parallel arrays on a **5 m distance grid** of about 1,166 points:

`distance_m, time_s, speed_kmh, throttle_pct, brake (bool), gear, rpm, x_m, y_m`

Each file also holds `raw_car_data`, the un-interpolated OpenF1 samples inside the lap: `time_s, distance_m, speed_kmh, throttle_pct, brake (0/100), gear, rpm`. The per-gear tables below are computed from these raw samples. Race lap files add `role` and `race_context`: lap number, race laps, laps remaining, stint, compound, tyre age, full-throttle share, passes and minimum gap ahead.

- **Distance**: OpenF1 has no distance channel, so distance is the trapezoidal integral of speed over time from the lap start. Lap lengths come out at 5806 to 5842 m. The X/Y path length agrees to within 0.5% (pole lap: 5824.6 m from speed, 5823.7 m from X/Y). The published track length of 5891 m is measured on the centre line, while these laps follow the racing line. **Outlier: OCO** measures 5885 m by speed and 5852 m by X/Y, so treat his distance axis with care.
- **Sample rate**: `car_data` arrives at about 3.7 Hz, which gives 320 to 353 samples per lap, or one every 20 to 25 m at 300 km/h. The 5 m grid is linear interpolation in time for speed, throttle, rpm and X/Y. Brake and gear use the last sample before each grid point. Braking points are therefore uncertain by roughly ±20 m. `brake` is on/off in the source data (0 or 100).
- **X/Y**: these are the F1 timing frame divided by 10 to give metres. Start and end positions agree to within 0.3 to 6 m on 29 of the 30 laps, which confirms the lap boundaries. **The exception is HAD race lap 40, with a 10.8 m gap**, so its lap boundary is about 0.1 s off.
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

- **Speed trap**: the official trap on the pole lap read **302 km/h** (OpenF1 `st_speed`; intermediates i1 295 and i2 268 km/h). OpenF1 does not publish where the trap is. Fitting all 22 qualifying laps' trap readings to their traces gives a best position of **4780 m**, on the Hangar Straight about 110 m before the braking point for Stowe (RMS 0.8 km/h). The pole trace reads 303 km/h at that point.
- **Speed falls on the straights with the throttle at 100%**: the pit straight drops from 313 km/h at 240 m to 276 km/h at 720 m, the Wellington from 310 to 285, and the Hangar from 305 to 299. This fits the 2026 power units' electrical deployment tapering off late on a straight, plus cornering load through Abbey and Farm. A simulator that only balances power against drag will overestimate the speed at the end of each straight at Silverstone.
- **Full throttle** (≥ 99%) covers **63.8% of lap time** and 74.5% of distance (65.5% of raw samples). The brake is on for 10.8% of lap time.
- **Sectors**: S1 28.348 s, S2 35.521 s, S3 24.242 s, totalling 88.111 s. S1 ends at about 1805 m and S2 at about 4240 m along the trace.
- Antonelli lifts to 0% throttle at about 5770 m, roughly 55 m before the line, with no brake. None of the other ten laps does this.

## Cross-check against `js/data/racepace2026.js`

- **Pole**: ANT 88.111 s in both sources. **Lap times**: 21 of 22 drivers match `q` to the millisecond.
- **PER differs (+0.489 s)**: the repo has 91.451. Race control deleted that lap ("CAR 11 (PER) TIME 1:31.451 DELETED - TRACK LIMITS AT TURN 9"), and his best valid lap in OpenF1 is 91.940. ALO's 1:32.888 was also deleted, and the repo correctly uses his 93.025. The deleted laps are listed in `silverstone-2026-q-index.json`.
- **Speed trap**: OpenF1 gives whole km/h, while the repo's `speedTrapQuali` has one decimal place. For all 22 drivers the OpenF1 session maximum is 0.0 to 0.9 km/h below the repo value, which fits truncation. For example, ANT reads 302 against 302.6 and HAM 317 against 317.9. No driver differs by 1 km/h or more.

## Race laps: Red Bull Racing

The race (OpenF1 `session_key` 11326, Sunday 5 July 2026) ran 52 laps, with VSC on lap 22, VSC on lap 39, and the safety car from lap 48 to the flag. **HAD** finished P5 with 52 laps and pitted on laps 19, 38 and 47. **VER** is a DNF, classified with 46 laps. OpenF1 has lap rows for him up to lap 47, and he pitted on laps 17 and 38.

- **Green laps** are used for selection. A green lap is not lap 1, not a pit in-lap or out-lap, does not overlap a neutralised period (VSC: deployed to "ENDING" + 20 s; SC: deployed to "IN THIS LAP" + 120 s), and does not have its time deleted by race control. VER's lap 34 time of 1:34.444 was deleted for track limits.
- **Overtake mode is not in OpenF1.** The feed has no Overtake-mode, DRS or active-aero channel, and its `drs` field is null throughout. The "overtake" lap is therefore the green lap, excluding the three fastest, with the highest full-throttle share among laps in which OpenF1 `overtakes` records an on-track pass by that driver. Passes on a car that pitted within 60 s are ignored. Both chosen laps had the car within 1 s of the car ahead (`intervals`), which is when Overtake would be available. That this is likely Overtake use is an inference: the data does not show it.
- **Fuel load is not published.** The available proxies are lap number, laps remaining and pit history. Tyre age is the stint's starting age plus the laps run in that stint.

| File | Driver | Role | Lap | Lap time s | Compound | Tyre age (laps) | Laps remaining | Full throttle (raw share) | Passes in lap | Min gap ahead s |
|---|---|---|---|---|---|---|---|---|---|---|
| `silverstone-2026-r-ver-lap40.json` | VER | fastest1 | 40 | 92.101 | MEDIUM | 1 | 12 | 60.5% | - | 8.961 |
| `silverstone-2026-r-ver-lap44.json` | VER | fastest2 | 44 | 92.390 | MEDIUM | 5 | 8 | 59.4% | - | 6.622 |
| `silverstone-2026-r-ver-lap42.json` | VER | fastest3 | 42 | 92.544 | MEDIUM | 3 | 10 | 58.3% | - | 7.682 |
| `silverstone-2026-r-ver-lap03.json` | VER | overtake | 3 | 95.127 | MEDIUM | 2 | 49 | 56.6% | HAD | 0.274 |
| `silverstone-2026-r-had-lap40.json` | HAD | fastest1 | 40 | 92.268 | MEDIUM | 1 | 12 | 59.0% | - | 12.048 |
| `silverstone-2026-r-had-lap45.json` | HAD | fastest2 | 45 | 92.481 | MEDIUM | 6 | 7 | 57.6% | - | 10.731 |
| `silverstone-2026-r-had-lap44.json` | HAD | fastest3 | 44 | 92.693 | MEDIUM | 5 | 8 | 55.4% | - | 10.843 |
| `silverstone-2026-r-had-lap43.json` | HAD | overtake | 43 | 92.895 | MEDIUM | 4 | 9 | 56.9% | ANT | 0.171 |

VER's 92.101 s on lap 40 matches `fastestLap.VER` in `js/data/racepace2026.js`, and HAD's 92.268 s matches `fastestLap.HAD`. All six fastest laps came on new MEDIUMs late in the race, with the lightest fuel load.

## Red Bull qualifying laps: gears and full-throttle segments

These are computed from `raw_car_data`, so there is no interpolation. Speed per 1000 rpm uses samples whose two neighbours are in the same gear, with no brake and rpm above 5000; it is quoted as median and interquartile range. The upshift columns give the last sample before each upshift (excluding samples under braking). At 3.7 Hz that sample can be up to about 0.27 s before the actual shift, so **shift rpm is a lower bound**.

#### HAD, lap 17, 88.746 s (322 raw samples)

| Gear | Samples | rpm min to max | km/h per 1000 rpm, median (IQR, n) | km/h range | Upshift to next: rpm / km/h (median, n) |
|---|---|---|---|---|---|
| 2 | 13 | 7831 to 11274 | 10.52 (10.41 to 10.72, 8) | 86 to 133 | 11274 / 133 (1) |
| 3 | 50 | 7823 to 11971 | 13.04 (12.92 to 13.52, 34) | 105 to 160 | 11932 / 153 (3) |
| 4 | 22 | 9563 to 12118 | 15.73 (15.54 to 15.98, 12) | 131 to 202 | 11055 / 194 (3) |
| 5 | 22 | 10827 to 12336 | 18.72 (18.63 to 19.05, 12) | 195 to 231 | 11756 / 222 (4) |
| 6 | 45 | 8858 to 12122 | 21.85 (21.68 to 21.95, 32) | 169 to 266 | 11482 / 263 (4) |
| 7 | 79 | 8482 to 12205 | 24.99 (24.88 to 25.07, 62) | 156 to 307 | 11150 / 298 (4) |
| 8 | 91 | 7516 to 11413 | 27.97 (27.91 to 28.04, 78) | 192 to 316 | - |

Observed max rpm: 12336, in 5th at 226 km/h, at 4056 m (exit of Becketts).

| Full-throttle segment (≥ 99%) | Start m | End m | Length m | Entry km/h | Exit km/h | Peak km/h | Gears |
|---|---|---|---|---|---|---|---|
| Line → Village | 0 | 765 | 765 | 263 | 257 | 316 | 6-7-8 |
| Loop → Brooklands | 1110 | 1845 | 735 | 156 | 286 | 306 | 3-4-5-6-7-8 |
| Luffield → Copse | 2275 | 2975 | 700 | 188 | 301 | 310 | 4-5-6-7-8 |
| Copse → Maggotts | 3125 | 3790 | 665 | 281 | 270 | 297 | 7 |
| Becketts → Stowe | 4055 | 4875 | 820 | 226 | 304 | 306 | 5-6-7-8 |
| Stowe → Vale | 5095 | 5380 | 285 | 235 | 257 | 257 | 6-7 |
| Club → line | 5615 | 5840 | 225 | 173 | 243 | 243 | 4-5-6 |

#### VER, lap 17, 88.893 s (321 raw samples)

| Gear | Samples | rpm min to max | km/h per 1000 rpm, median (IQR, n) | km/h range | Upshift to next: rpm / km/h (median, n) |
|---|---|---|---|---|---|
| 2 | 14 | 7679 to 12703 | 10.37 (10.35 to 10.52, 10) | 84 to 132 | 12703 / 132 (1) |
| 3 | 45 | 7898 to 11859 | 12.93 (12.79 to 13.27, 28) | 104 to 158 | 11662 / 157 (3) |
| 4 | 22 | 9350 to 11750 | 15.71 (15.65 to 16.05, 11) | 146 to 194 | 11369 / 179 (3) |
| 5 | 21 | 9452 to 11838 | 18.58 (18.32 to 18.71, 10) | 152 to 227 | 11040 / 223 (4) |
| 6 | 53 | 9990 to 11788 | 21.86 (21.72 to 22.00, 39) | 207 to 265 | 11282 / 260 (4) |
| 7 | 51 | 9341 to 11751 | 24.89 (24.82 to 24.98, 37) | 169 to 295 | 10581 / 295 (5) |
| 8 | 115 | 8789 to 11342 | 27.97 (27.92 to 28.04, 99) | 190 to 316 | - |

Observed max rpm: 12703, in 2nd at 132 km/h, at 1091 m (the Loop exit, on the 2→3 upshift). The speed-to-rpm ratio of that sample (10.4) matches 2nd gear, so it is not wheelspin.

| Full-throttle segment (≥ 99%) | Start m | End m | Length m | Entry km/h | Exit km/h | Peak km/h | Gears |
|---|---|---|---|---|---|---|---|
| Line → Village | 0 | 770 | 770 | 264 | 252 | 316 | 6-7-8 |
| Loop → Brooklands | 1110 | 1830 | 720 | 155 | 287 | 305 | 3-4-5-6-7-8 |
| Luffield → Copse | 2280 | 2970 | 690 | 192 | 300 | 308 | 4-5-6-7-8 |
| Copse → Maggotts | 3160 | 3785 | 625 | 287 | 274 | 300 | 7-8-7 |
| Becketts → Stowe | 4055 | 4890 | 835 | 223 | 300 | 302 | 5-6-7-8 |
| Stowe → Vale | 5120 | 5375 | 255 | 236 | 253 | 253 | 6 |
| Club → line | 5605 | 5830 | 225 | 157 | 243 | 243 | 3-4-5-6 |

**What this means for the simulator.** The two cars' speed-per-rpm figures agree to within 1–2% in every gear, so they give an effective overall ratio set for the 2026 Red Bull. In km/h per 1000 rpm that set is about 10.4, 13.0, 15.7, 18.6, 21.9, 24.9 and 28.0 for gears 2–8. In 8th gear the cars top out at about 316 km/h and 11,300–11,400 rpm, below the 12,000+ rpm seen in lower gears, so top speed at Silverstone is limited by power and energy rather than by revs. Every long full-throttle segment exits below its peak, by 2 km/h on the Hangar Straight and by up to 64 km/h from the line to Village. This is the deployment fade described above.

## Not available from the public feeds

- Overtake-mode activation, active-aero mode and DRS: OpenF1 has no channel for them, and `drs` is null.
- Fuel mass, battery state of charge and ERS deployment.
- Telemetry faster than the public feed rate of about 3.7 Hz.
- VER race laps after lap 47 (DNF).

## Reproduce

```sh
python3 fetch/fetch_openf1.py --cache /some/scratch/dir   # stdlib only; ~110 requests (~4 min at the 30 req/min free tier)
python3 fetch/derive.py                                    # prints the tables above (no network)
```

Behind a TLS-intercepting proxy, set `SSL_CERT_FILE` to its CA bundle. `urllib` also honours `HTTPS_PROXY`.
