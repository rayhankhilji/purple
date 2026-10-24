# Spa-Francorchamps 2026 qualifying telemetry

Real car telemetry from the 2026 Belgian Grand Prix: qualifying on Saturday 18 July 2026 (OpenF1 `session_key` 11330, meeting 1290, scheduled 14:00 to 15:00 UTC). It is one of four contrasting circuits (Monza, Monaco, Spa, Red Bull Ring) collected so the car-identification models can separate engine power, drag and downforce per car. The Silverstone folder's README (`../README.md`) holds the licence and attribution text, the file format and the reasons FastF1 was not used; all of that applies here unchanged, and the notes below cover what differs.

Accessed **2026-10-24**. Nothing in this folder is synthesised. Every number comes from OpenF1 (`api.openf1.org/v1`: `sessions`, `drivers`, `laps`, `stints`, `race_control`, `weather`, `car_data`, `location`), the MultiViewer circuit API (corner markers) or the formula1.com classification page (cross-check only), through `../fetch/fetch_circuit.py`. OpenF1 is not associated with Formula 1, the FIA or FOM; F1 and FORMULA ONE are trade marks of Formula One Licensing B.V.; non-commercial use only, as in `../README.md`.

## Files

| File | Content | Size |
|---|---|---|
| `spa-2026-q-<code>.json` x 22 | Best valid qualifying lap of every driver, ranked in `spa-2026-q-index.json`; all SOFT. Pole: `spa-2026-q-ant.json` (`is_pole_lap`). `is_team_best` is set for ANT, VER, NOR, LEC, LIN, BOR, GAS, SAI, BEA, BOT, ALO | 70.8 to 72.3 KB each |
| `spa-2026-q-index.json` | Session info, best valid lap per driver (sectors, i1, i2, trap, compound), session-maximum i1/i2/trap per driver, lap times deleted by race control, every race-control message containing DELETED, per-file dropout lists | 14.5 KB |
| `spa-2026-q-weather.json` | 84 one-minute weather samples, 13:50 to 15:13 UTC | 5.9 KB |
| `spa-circuit.json` | 19 corner markers (number, angle, x/y in metres, distance on the pole lap, match error) | 3.3 KB |
| `spa-2026-q-official.json` | The formula1.com qualifying classification (Q1/Q2/Q3 as printed), used only for the cross-check below | 4.0 KB |

Whole folder: 1625 KB. The lap files follow the Silverstone format (`driver`, `lap`, `processing`, `channels` on a 5 m grid of 1382 to 1395 points, `raw_car_data`) with these differences:

- **`raw_car_data` is omitted from all 22 files**: with it each file would exceed the 80 KB limit (the 5 m grid alone is 71 to 72 KB). `processing.raw_car_samples_in_lap` still gives the sample count, and `processing.raw_car_data` says it was left out.
- `processing.dropouts` lists telemetry dropouts and `processing.raw_car_samples_excluded_invalid` counts the samples removed; channels are `null` inside a gap (see Data quality). `lap.compound` and `lap.tyre_age_at_stint_start_laps` come from the OpenF1 stints.
- `drs` is null in the feed for every sample, as at Silverstone, so no DRS or active-aero flag is stored.

The session ran past its scheduled 15:00 UTC end: the last selected lap finishes at 15:10:25 UTC. The weather file therefore extends to 15:13 UTC. The OpenF1 `laps` rows and race control show no track-limit deletions in this session.

## Session

**Pole**: Antonelli (Mercedes), lap 14, 104.361 s on SOFT; Verstappen was second at 104.678 s (+0.317 s) and Norris third at 104.801 s.

- **Deleted laps**: **None found.** OpenF1 `race_control` holds no message containing DELETED for this session, so no lap was excluded. The 22 of 22 match to the official times below confirms that no faster deleted lap was missed.
- **Lap times against the official classification**: all 22 best valid laps match the formula1.com Q1/Q2/Q3 times to the millisecond (table below; each driver's best is the fastest of his Q1, Q2 and Q3 times).
- **Cross-check against `js/data/racepace2026.js`** (`spa`): all 22 qualifying times and the pole (ANT 104.361) agree to the millisecond. OpenF1's session-maximum speed trap is 0.0 to 0.9 km/h below the repo's one-decimal `speedTrapQuali` for all 22 drivers, which fits truncation to whole km/h, as at Silverstone.
- **Lap length**: 6,948 m from the speed integral on the pole lap (X/Y path 6,951 m) against 7,004 m official (-0.8%). The 14 laps with no dropout give 6,944 to 6,968 m.
- **Weather** (84 samples, 13:50 to 15:13 UTC): rainfall max 0; air 19.8 to 22.5 degC; track 33.7 to 39.3 degC; humidity 53.5 to 57.6 %; pressure 968.2 to 968.6 mbar; wind 0.3 to 4.6 m/s. Sample nearest the end of this lap (15:09:35 UTC): air 20.7, track 35.2, humidity 56.9 %, wind 2.4 m/s from 323 deg, rainfall 0.

## Lap length and processing

Pole lap: Kimi ANTONELLI (Mercedes) lap 14, 104.361 s, SOFT. Lap length: 6948.2 m speed integral, 6951.0 m X/Y path, official 7004 m (speed integral -0.80%, X/Y path -0.76%).

Lap length over 22 laps: speed integral 6902 to 6968 m, X/Y path 6937 to 6954 m. 14 laps without a dropout: speed integral 6944 to 6968 m, median 6950 m; X/Y median 6946 m.  
Laps with a dropout: LEC, COL, HUL, SAI, ALB, OCO, ALO, STR.

Distance is the trapezoidal integral of speed over time from the lap start (as at Silverstone), and the 5 m grid, interpolation rules and X/Y units are unchanged. Official length is 7,004 m (centre line); the cars run a racing line, so a measured length a little below it is expected.

## Pole lap: key corners

Distances are along the pole trace from the timing line. "Marker" is the MultiViewer corner position projected onto the trace (match error at most 4.8 m; the layout year served was 2021). "Entry speed" is the highest speed in the 50 m before the braking point. Where there is no local speed minimum because the car is flat out, the row gives the speed at the marker. Brake is on/off in the source, so braking points carry about +-20 m of uncertainty. Corner names are the usual Spa names matched to the speed minima and order (La Source T1, Eau Rouge and Raidillon T2 to T4, Les Combes T5/6, Malmedy T7, Rivage T8, Pouhon T10/11, Fagnes T12/13, Stavelot T14, Paul Frere T15, Blanchimont T16/17, the Bus Stop chicane T18/19). T9 is the kink after Rivage. The marker source supplies numbers only, so the mapping of names to numbers is mine.

| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |
|---|---|---|---|---|---|---|---|---|
| La Source (T1) | 365 | 80 | 1 | 380 | 245 | 265 | 283 |  |
| Eau Rouge - Raidillon (T2/3/4) | 1040/1145/1240 | 325 | 8 | 1040 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| Les Combes (T5/6) | 2385/2465 | 155 | 3 | 2415 | 2295 | 2310 | 299 |  |
| Malmedy (T7) | 2630 | 209 | 5 | 2630 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| Rivage (T8) | 3020 | 125 | 2 | 3030 | 2915 | 2925 | 241 |  |
| T9 | 3260 | 195 | 4 | 3260 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 52% |
| Pouhon (T10/11) | 3780/4020 | 275 | 7 | 3780 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| Fagnes (T12/13) | 4450/4610 | 179 | 4 | 4510 | - | 4385 | 258 |  |
| Stavelot (T14) | 4900 | 177 | 4 | 4910 | 4840 | 4845 | 223 |  |
| Paul Frere (T15) | 5145 | 267 | 7 | 5145 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| Blanchimont (T16/17) | 5860/6140 | 323 | 8 | 5860 | - | - | - | no slowing (throttle >= 95% in the window): speed at marker, throttle 100% |
| Bus Stop (T18/19) | 6675/6745 | 76 | 1 | 6745 | 6575 | 6605 | 292 |  |

## Straights, peak speed and energy clipping

A straight here is a stretch of at least 300 m with throttle at 95% or more and no brake. "Peak minus end" is the speed lost between the peak and the lift or brake point with the throttle still down.

| Straight (from m to m) | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Peak minus end km/h | Lift or brake at m |
|---|---|---|---|---|---|---|---|
| 450 to 2290 | 1840 | 162 | 330 | 890 | 292 | 38 | 2295 |
| 3290 to 4380 | 1090 | 205 | 280 | 3595 | 244 | 36 | 4385 |
| 4965 to 6570 | 1605 | 194 | 336 | 5675 | 291 | 45 | 6575 |

Lap maximum: 336 km/h at 5675 m. Minimum: 76 km/h at 6745 m.  
Trap readings (OpenF1) on this lap: i1 311, i2 220, finish line/trap st_speed 309 km/h.  
Full throttle (>= 99%): 67.1% of valid lap time, 77.6% of valid distance (valid = 100.0% of the lap's time); raw-sample share 68.5%. Brake on: 8.7% of valid time.  
Sectors: S1 30.160, S2 46.059, S3 28.142 s (sum 104.361); S1/S2 end at about 2240 m / 5040 m.

Spa shows the clearest energy clipping of the set. On the Kemmel straight (La Source to Les Combes, 450 to 2,290 m) the pole lap peaks at 330 km/h at 890 m and is down to 292 km/h at the braking point, 38 km/h lower, with the throttle at 100% throughout. The Blanchimont straight (4,965 to 6,570 m) peaks at 336 km/h at 5,675 m and ends at 291 km/h, 45 km/h lower. A simulator that only balances power against drag overestimates the speed at the end of both. Wind and gradient also move these numbers; OpenF1 has no battery or deployment channel, so the cause is inferred from the shape of the trace, not measured.

**Speed trap.** Best-fit trap position over 22 laps: 1320 m on the pole trace (RMS 2.1 km/h); pole trace there: 307.6 km/h. OpenF1 does not publish where the trap is; the fit uses every driver's trap reading against his own trace.

## Best valid lap per driver

| Driver | Team | Lap | Best Q lap s | Compound | S1 | S2 | S3 | i1 | i2 | trap | max trap in session |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ANT | Mercedes | 14 | 104.361 | SOFT | 30.160 | 46.059 | 28.142 | 311 | 220 | 309 | 310 |
| VER | Red Bull Racing | 11 | 104.678 | SOFT | 30.443 | 46.050 | 28.185 | 303 | 222 | 297 | 297 |
| NOR | McLaren | 8 | 104.801 | SOFT | 30.314 | 46.100 | 28.387 | 301 | 213 | 310 | 311 |
| RUS | Mercedes | 17 | 104.869 | SOFT | 30.136 | 46.224 | 28.509 | 311 | 219 | 311 | 311 |
| LEC | Ferrari | 14 | 104.893 | SOFT | 30.294 | 46.217 | 28.382 | 301 | 220 | 307 | 308 |
| HAM | Ferrari | 14 | 104.895 | SOFT | 30.197 | 46.140 | 28.558 | 308 | 222 | 308 | 308 |
| PIA | McLaren | 16 | 105.016 | SOFT | 30.287 | 46.127 | 28.602 | 302 | 215 | 312 | 312 |
| LIN | Racing Bulls | 17 | 105.143 | SOFT | 30.130 | 46.602 | 28.411 | 306 | 218 | 315 | 315 |
| BOR | Audi | 17 | 105.628 | SOFT | 30.490 | 46.599 | 28.539 | 305 | 215 | 309 | 309 |
| HAD | Red Bull Racing | 8 | 105.823 | SOFT | 30.632 | 46.600 | 28.591 | 302 | 220 | 295 | 297 |
| LAW | Racing Bulls | 11 | 106.120 | SOFT | 30.590 | 46.876 | 28.654 | 304 | 217 | 313 | 314 |
| GAS | Alpine | 11 | 106.331 | SOFT | 30.467 | 47.311 | 28.553 | 314 | 216 | 303 | 305 |
| COL | Alpine | 11 | 106.392 | SOFT | 30.410 | 47.352 | 28.630 | 315 | 214 | 306 | 306 |
| HUL | Audi | 11 | 106.671 | SOFT | 30.778 | 47.017 | 28.876 | 306 | 213 | 309 | 310 |
| SAI | Williams | 11 | 106.777 | SOFT | 30.586 | 47.534 | 28.657 | 314 | 210 | 307 | 307 |
| BEA | Haas F1 Team | 11 | 106.779 | SOFT | 30.713 | 47.395 | 28.671 | 302 | 214 | 304 | 304 |
| ALB | Williams | 5 | 107.120 | SOFT | 30.603 | 47.747 | 28.770 | 312 | 213 | 304 | 307 |
| OCO | Haas F1 Team | 5 | 107.801 | SOFT | 30.912 | 47.963 | 28.926 | 298 | 216 | 303 | 303 |
| BOT | Cadillac | 7 | 107.823 | SOFT | 30.711 | 48.149 | 28.963 | 309 | 211 | 307 | 307 |
| PER | Cadillac | 7 | 107.971 | SOFT | 30.764 | 48.154 | 29.053 | 309 | 211 | 304 | 305 |
| ALO | Aston Martin | 5 | 110.002 | SOFT | 31.226 | 49.299 | 29.477 | 296 | 210 | 301 | 301 |
| STR | Aston Martin | 7 | 110.177 | SOFT | 31.369 | 49.199 | 29.609 | 297 | 208 | 298 | 298 |

## Cross-check: official classification

Source: https://www.formula1.com/en/results/2026/races/1290/belgium/qualifying (read on 2026-10-24 with WebFetch, which returns the page through a summarising model; the 22 of 22 match to OpenF1 is the check on that transcription).

| Pos | Driver | Q1 | Q2 | Q3 | Official best s | OpenF1 best valid s | diff ms | Lap in OpenF1 |
|---|---|---|---|---|---|---|---|---|
| 1 | ANT | 1:46.304 | 1:45.142 | 1:44.361 | 104.361 | 104.361 | +0 | 14 |
| 2 | VER | 1:45.930 | 1:45.589 | 1:44.678 | 104.678 | 104.678 | +0 | 11 |
| 3 | NOR | 1:45.865 | 1:45.454 | 1:44.801 | 104.801 | 104.801 | +0 | 8 |
| 4 | RUS | 1:46.185 | 1:45.689 | 1:44.869 | 104.869 | 104.869 | +0 | 17 |
| 5 | LEC | 1:46.278 | 1:45.397 | 1:44.893 | 104.893 | 104.893 | +0 | 14 |
| 6 | HAM | 1:46.124 | 1:45.543 | 1:44.895 | 104.895 | 104.895 | +0 | 14 |
| 7 | PIA | 1:46.433 | 1:45.671 | 1:45.016 | 105.016 | 105.016 | +0 | 16 |
| 8 | LIN | 1:46.191 | 1:45.629 | 1:45.143 | 105.143 | 105.143 | +0 | 17 |
| 9 | BOR | 1:46.609 | 1:46.082 | 1:45.628 | 105.628 | 105.628 | +0 | 17 |
| 10 | HAD | 1:46.062 | 1:45.823 | - | 105.823 | 105.823 | +0 | 8 |
| 11 | LAW | 1:46.501 | 1:46.120 | - | 106.120 | 106.120 | +0 | 11 |
| 12 | GAS | 1:46.679 | 1:46.331 | - | 106.331 | 106.331 | +0 | 11 |
| 13 | COL | 1:46.795 | 1:46.392 | - | 106.392 | 106.392 | +0 | 11 |
| 14 | HUL | 1:46.893 | 1:46.671 | - | 106.671 | 106.671 | +0 | 11 |
| 15 | SAI | 1:47.080 | 1:46.777 | - | 106.777 | 106.777 | +0 | 11 |
| 16 | BEA | 1:47.113 | 1:46.779 | - | 106.779 | 106.779 | +0 | 11 |
| 17 | ALB | 1:47.120 | - | - | 107.120 | 107.120 | +0 | 5 |
| 18 | OCO | 1:47.801 | - | - | 107.801 | 107.801 | +0 | 5 |
| 19 | BOT | 1:47.823 | - | - | 107.823 | 107.823 | +0 | 7 |
| 20 | PER | 1:47.971 | - | - | 107.971 | 107.971 | +0 | 7 |
| 21 | ALO | 1:50.002 | - | - | 110.002 | 110.002 | +0 | 5 |
| 22 | STR | 1:50.177 | - | - | 110.177 | 110.177 | +0 | 7 |

## Data quality: telemetry dropouts

OpenF1 sometimes freezes `car_data`: speed, rpm and gear repeat the last value for seconds, and throttle and brake read 104, an error code and not a percentage (or the whole sample repeats with throttle 100 and brake 0). `fetch_circuit.py` removes those samples (throttle above 100, brake not 0 or 100, or 3 or more samples in a row with identical speed and rpm at 50 km/h or more). Where more than 0.8 s is left between valid samples, speed, throttle, brake, gear and rpm are `null` on the grid inside the gap (never interpolated), the distance across the gap is the X/Y path length between the two valid samples so the axis stays continuous, and `time_s` inside the gap is linear between them. A speed integral across a frozen stretch would otherwise overstate the lap.

8 of 22 laps are affected:

| Driver | Lap time s | Gaps (distance m, duration s) |
|---|---|---|
| LEC | 104.893 | 4866 to 4966 m (1.7 s) |
| COL | 106.392 | 724 to 914 m (2.3 s) |
| HUL | 106.671 | 2061 to 2136 m (1.0 s) |
| SAI | 106.777 | 748 to 846 m (1.2 s) |
| ALB | 107.120 | 728 to 838 m (1.3 s) |
| OCO | 107.801 | 2638 to 2703 m (1.2 s); 5409 to 5496 m (1.1 s) |
| ALO | 110.002 | 694 to 790 m (1.2 s); 1538 to 1584 m (0.9 s); 1962 to 2041 m (0.9 s) |
| STR | 110.177 | 1982 to 2083 m (1.2 s); 5773 to 5882 m (1.2 s) |

Shorter invalid runs (under 0.8 s between valid samples) are bridged by linear interpolation and counted in `raw_car_samples_excluded_invalid`.

## Not available from the public feeds

Overtake-mode, active-aero and DRS state; fuel mass; battery state of charge and ERS deployment; telemetry faster than the feed rate of about 3.7 Hz.

## Reproduce

```sh
python3 fetch/fetch_circuit.py --circuit spa --session_key 11330 --cache /some/scratch/dir   # stdlib only, ~55 requests at the 30 req/min free tier
python3 fetch/derive_circuit.py --circuit spa --official-m 7004 --racepace-key spa   # prints the tables above (no network)
```

The corner groups and names in the key-corner table are `derive_circuit.py --groups` arguments (see its docstring). Behind a TLS-intercepting proxy, set `SSL_CERT_FILE` to its CA bundle.
