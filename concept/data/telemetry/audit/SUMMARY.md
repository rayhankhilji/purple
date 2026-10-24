# Telemetry audit: PURPLE 2026 lap files

Read-only check of every lap file in `concept/data/telemetry/` (205 files: 30 Silverstone, 175 across eight circuits). Script: `concept/data/telemetry/audit/check_telemetry.js`. Per-file detail: `concept/data/telemetry/audit/telemetry_audit.csv`.

Each file gets PASS, WARN or FAIL per check C1 to C6, and an overall status (worst of the six). Lap-time references: official JSON (Austria, Monaco, Monza, Spa), README cross-check table (Hungaroring, Montreal, Singapore, Suzuka) and `js/data/racepace2026.js` (Silverstone). Race laps have no official reference, so C1 for them compares only with the race index.

## Totals by circuit

| Circuit | Files | PASS | WARN | FAIL |
|---|---:|---:|---:|---:|
| Silverstone (qualifying) | 22 | 4 | 14 | 4 |
| Silverstone race laps | 8 | 1 | 4 | 3 |
| Austria | 22 | 3 | 18 | 1 |
| Hungaroring | 22 | 2 | 17 | 3 |
| Monaco | 22 | 0 | 16 | 6 |
| Montreal | 22 | 0 | 20 | 2 |
| Monza | 22 | 1 | 16 | 5 |
| Singapore | 21 | 2 | 11 | 8 |
| Spa | 22 | 0 | 22 | 0 |
| Suzuka | 22 | 0 | 5 | 17 |
| **All** | **205** | **13** | **143** | **49** |

## Per-check status (files)

| Check | PASS | WARN | FAIL | n/a |
|---|---:|---:|---:|---:|
| C1 lap time (file vs index vs official) | 204 | 0 | 1 | 0 |
| C2 grid and time | 201 | 3 | 1 | 0 |
| C3 channel ranges, nulls, raw flags | 149 | 29 | 27 | 0 |
| C4 physics (accel, lateral g, jumps) | 17 | 158 | 30 | 0 |
| C5 sectors vs lap time | 205 | 0 | 0 | 0 |
| C6 duplicates and identity | 205 | 0 | 0 | 0 |

## Every FAIL

49 files have at least one FAIL. Reasons are listed per file (all checks that FAILed).

- `silverstone-2026-q-alb.json` (silverstone qualifying): C3: raw brake has 1 value(s) outside 0/100 (104) that reached the grid; C3: 1 run(s) of 5+ identical raw samples (frozen-feed signature)
- `silverstone-2026-q-oco.json` (silverstone qualifying): C3: raw brake has 2 value(s) outside 0/100 (104) that reached the grid
- `silverstone-2026-q-per.json` (silverstone qualifying): C1: file vs official 489.0 ms (official 91.451 s)
- `silverstone-2026-q-str.json` (silverstone qualifying): C3: raw brake has 1 value(s) outside 0/100 (104) that reached the grid
- `silverstone-2026-r-had-lap45.json` (silverstone race lap): C3: raw brake has 1 value(s) outside 0/100 (104) that reached the grid
- `silverstone-2026-r-ver-lap42.json` (silverstone race lap): C3: raw brake has 1 value(s) outside 0/100 (104) that reached the grid
- `silverstone-2026-r-ver-lap44.json` (silverstone race lap): C3: raw brake has 1 value(s) outside 0/100 (104) that reached the grid
- `austria-2026-q-per.json` (austria qualifying): C4: 11 longitudinal accel points outside -6.5/+1.8 g (0 braking, 11 accel)
- `hungaroring-2026-q-alb.json` (hungaroring qualifying): C4: 11 longitudinal accel points outside -6.5/+1.8 g (0 braking, 11 accel)
- `hungaroring-2026-q-ant.json` (hungaroring qualifying): C4: 12 longitudinal accel points outside -6.5/+1.8 g (0 braking, 12 accel)
- `hungaroring-2026-q-per.json` (hungaroring qualifying): C4: 11 longitudinal accel points outside -6.5/+1.8 g (0 braking, 11 accel)
- `monaco-2026-q-alb.json` (monaco qualifying): C4: 14 longitudinal accel points outside -6.5/+1.8 g (0 braking, 14 accel)
- `monaco-2026-q-ant.json` (monaco qualifying): C4: 16 longitudinal accel points outside -6.5/+1.8 g (0 braking, 16 accel); C4: 3 points with lateral g above 7 g (max 7.02 g, smoothed)
- `monaco-2026-q-bea.json` (monaco qualifying): C4: 11 longitudinal accel points outside -6.5/+1.8 g (0 braking, 11 accel); C4: 3 points with lateral g above 7 g (max 8.20 g, smoothed)
- `monaco-2026-q-bot.json` (monaco qualifying): C4: 17 longitudinal accel points outside -6.5/+1.8 g (0 braking, 17 accel)
- `monaco-2026-q-lin.json` (monaco qualifying): C4: 18 longitudinal accel points outside -6.5/+1.8 g (0 braking, 18 accel)
- `monaco-2026-q-sai.json` (monaco qualifying): C4: 21 longitudinal accel points outside -6.5/+1.8 g (0 braking, 21 accel); C4: 4 points with lateral g above 7 g (max 7.52 g, smoothed)
- `montreal-2026-q-per.json` (montreal qualifying): C4: 15 longitudinal accel points outside -6.5/+1.8 g (2 braking, 13 accel); C4: 2 speed jump(s) > 25 km/h per 5 m (max 29.5)
- `montreal-2026-q-pia.json` (montreal qualifying): C4: 13 longitudinal accel points outside -6.5/+1.8 g (0 braking, 13 accel)
- `monza-2026-q-alb.json` (monza qualifying): C3: null run 300 m (limit 200 m)
- `monza-2026-q-alo.json` (monza qualifying): C3: null run 280 m (limit 200 m)
- `monza-2026-q-col.json` (monza qualifying): C3: null run 315 m (limit 200 m); C4: 7 longitudinal accel points outside -6.5/+1.8 g (5 braking, 2 accel); C4: 4 points with lateral g above 7 g (max 14.87 g, smoothed); C4: 5 speed jumps > 25 km/h per 5 m (max 33.7)
- `monza-2026-q-gas.json` (monza qualifying): C3: null run 305 m (limit 200 m)
- `monza-2026-q-sai.json` (monza qualifying): C3: null run 315 m (limit 200 m)
- `singapore-2026-q-alo.json` (singapore qualifying): C4: 17 longitudinal accel points outside -6.5/+1.8 g (0 braking, 17 accel)
- `singapore-2026-q-col.json` (singapore qualifying): C4: 20 longitudinal accel points outside -6.5/+1.8 g (0 braking, 20 accel)
- `singapore-2026-q-gas.json` (singapore qualifying): C4: 37 longitudinal accel points outside -6.5/+1.8 g (4 braking, 33 accel)
- `singapore-2026-q-ham.json` (singapore qualifying): C4: 14 longitudinal accel points outside -6.5/+1.8 g (2 braking, 12 accel)
- `singapore-2026-q-nor.json` (singapore qualifying): C4: 15 longitudinal accel points outside -6.5/+1.8 g (0 braking, 15 accel)
- `singapore-2026-q-per.json` (singapore qualifying): C4: 11 longitudinal accel points outside -6.5/+1.8 g (0 braking, 11 accel)
- `singapore-2026-q-sai.json` (singapore qualifying): C4: 18 longitudinal accel points outside -6.5/+1.8 g (0 braking, 18 accel)
- `singapore-2026-q-str.json` (singapore qualifying): C2: length 4684 m is -4.9% vs official 4927 m; C2: distance axis 4684 m vs X/Y path 4848 m (-3.4%); C4: 22 longitudinal accel points outside -6.5/+1.8 g (1 braking, 21 accel); C4: 1 speed jump(s) > 25 km/h per 5 m (max 28.6)
- `suzuka-2026-q-alb.json` (suzuka qualifying): C3: null run 775 m (limit 200 m); C4: 11 longitudinal accel points outside -6.5/+1.8 g (0 braking, 11 accel); C4: 6 points with lateral g above 7 g (max 7.98 g, smoothed)
- `suzuka-2026-q-alo.json` (suzuka qualifying): C3: null run 220 m (limit 200 m)
- `suzuka-2026-q-ant.json` (suzuka qualifying): C3: null run 1768 m (limit 200 m)
- `suzuka-2026-q-bea.json` (suzuka qualifying): C3: null run 300 m (limit 200 m)
- `suzuka-2026-q-bor.json` (suzuka qualifying): C3: null run 1800 m (limit 200 m)
- `suzuka-2026-q-bot.json` (suzuka qualifying): C3: null run 240 m (limit 200 m); C4: 13 longitudinal accel points outside -6.5/+1.8 g (0 braking, 13 accel); C4: 13 points with lateral g above 7 g (max 8.39 g, smoothed)
- `suzuka-2026-q-col.json` (suzuka qualifying): C3: null run 560 m (limit 200 m); C4: 15 longitudinal accel points outside -6.5/+1.8 g (0 braking, 15 accel); C4: 9 points with lateral g above 7 g (max 9.77 g, smoothed)
- `suzuka-2026-q-gas.json` (suzuka qualifying): C3: null run 570 m (limit 200 m); C4: 12 longitudinal accel points outside -6.5/+1.8 g (2 braking, 10 accel); C4: 11 points with lateral g above 7 g (max 9.95 g, smoothed)
- `suzuka-2026-q-hul.json` (suzuka qualifying): C3: null run 900 m (limit 200 m); C4: 16 longitudinal accel points outside -6.5/+1.8 g (1 braking, 15 accel); C4: 7 points with lateral g above 7 g (max 9.60 g, smoothed); C4: 1 speed jump(s) > 25 km/h per 5 m (max 25.2)
- `suzuka-2026-q-law.json` (suzuka qualifying): C3: null run 405 m (limit 200 m); C4: 12 longitudinal accel points outside -6.5/+1.8 g (0 braking, 12 accel); C4: 10 points with lateral g above 7 g (max 10.42 g, smoothed)
- `suzuka-2026-q-lec.json` (suzuka qualifying): C3: null run 415 m (limit 200 m)
- `suzuka-2026-q-lin.json` (suzuka qualifying): C3: null run 580 m (limit 200 m); C4: 11 longitudinal accel points outside -6.5/+1.8 g (1 braking, 10 accel); C4: 10 points with lateral g above 7 g (max 7.75 g, smoothed)
- `suzuka-2026-q-oco.json` (suzuka qualifying): C3: null run 530 m (limit 200 m)
- `suzuka-2026-q-per.json` (suzuka qualifying): C4: 12 longitudinal accel points outside -6.5/+1.8 g (0 braking, 12 accel); C4: 7 points with lateral g above 7 g (max 7.33 g, smoothed)
- `suzuka-2026-q-rus.json` (suzuka qualifying): C3: null run 285 m (limit 200 m)
- `suzuka-2026-q-sai.json` (suzuka qualifying): C3: null run 355 m (limit 200 m); C4: 17 longitudinal accel points outside -6.5/+1.8 g (0 braking, 17 accel); C4: 4 points with lateral g above 7 g (max 7.99 g, smoothed)
- `suzuka-2026-q-str.json` (suzuka qualifying): C3: null run 550 m (limit 200 m)

## 10 worst WARN files

Files whose overall status is WARN (no FAIL), ranked by the number of WARN checks, then by the number of WARN reasons, then by the size of the physics flags (accel violations + speed jumps + lateral flag points).

| # | File | WARN checks | Reasons |
|---:|---|---:|---|
| 1 | `suzuka-2026-q-ver.json` | 2 | C3: null run 115 m (speed/throttle/brake/gear/rpm); C4: 10 longitudinal accel points outside -6.5/+1.8 g (0 braking, 10 accel); C4: 16 points with lateral g above 7 g (max 8.98 g, smoothed) |
| 2 | `suzuka-2026-q-had.json` | 2 | C3: null run 170 m (speed/throttle/brake/gear/rpm); C4: 3 longitudinal accel points outside -6.5/+1.8 g (0 braking, 3 accel); C4: 20 points with lateral g above 7 g (max 8.33 g, smoothed) |
| 3 | `spa-2026-q-lec.json` | 2 | C3: null run 100 m (speed/throttle/brake/gear/rpm); C4: 7 longitudinal accel points outside -6.5/+1.8 g (2 braking, 5 accel); C4: 10 points with lateral g above 7 g (max 7.73 g, smoothed) |
| 4 | `spa-2026-q-col.json` | 2 | C3: null run 190 m (speed/throttle/brake/gear/rpm); C4: 4 longitudinal accel points outside -6.5/+1.8 g (0 braking, 4 accel); C4: 12 points with lateral g above 7 g (max 8.75 g, smoothed) |
| 5 | `spa-2026-q-alo.json` | 2 | C3: null run 95 m (speed/throttle/brake/gear/rpm); C4: 7 longitudinal accel points outside -6.5/+1.8 g (2 braking, 5 accel); C4: 4 points with lateral g above 7 g (max 8.10 g, smoothed) |
| 6 | `monaco-2026-q-ver.json` | 2 | C2: distance axis 3295 m vs X/Y path 3260 m (1.1%); C4: 6 longitudinal accel points outside -6.5/+1.8 g (0 braking, 6 accel); C4: 4 points with lateral g above 7 g (max 9.71 g, smoothed) |
| 7 | `spa-2026-q-hul.json` | 2 | C3: null run 75 m (speed/throttle/brake/gear/rpm); C4: 3 longitudinal accel points outside -6.5/+1.8 g (0 braking, 3 accel); C4: 7 points with lateral g above 7 g (max 7.93 g, smoothed) |
| 8 | `spa-2026-q-sai.json` | 2 | C3: null run 100 m (speed/throttle/brake/gear/rpm); C4: 2 longitudinal accel points outside -6.5/+1.8 g (0 braking, 2 accel); C4: 6 points with lateral g above 7 g (max 7.73 g, smoothed) |
| 9 | `spa-2026-q-alb.json` | 2 | C3: null run 110 m (speed/throttle/brake/gear/rpm); C4: 4 longitudinal accel points outside -6.5/+1.8 g (0 braking, 4 accel); C4: 3 points with lateral g above 7 g (max 7.83 g, smoothed) |
| 10 | `spa-2026-q-oco.json` | 2 | C3: null run 90 m (speed/throttle/brake/gear/rpm); C4: 2 longitudinal accel points outside -6.5/+1.8 g (0 braking, 2 accel); C4: 4 points with lateral g above 7 g (max 7.71 g, smoothed) |

## WARN patterns

| Pattern | WARN reasons | Files affected |
|---|---:|---:|
| accel outside -6.5/+1.8 g (1-10 points) | 155 | 155 |
| lateral g above 7 g (smoothed) | 59 | 59 |
| null run (documented dropout gap) | 29 | 29 |
| speed jump > 25 km/h (1-4) | 3 | 3 |
| lap length 2-3% short of official | 2 | 2 |
| distance axis vs X/Y path 1-3% | 2 | 2 |

## Method notes and caveats

- Circuit lengths: silverstone 5891 m (silverstone README ('published track length of 5891 m')); austria 4318 m (austria README (4,318 m)); hungaroring 4381 m (hungaroring README (4.381 km)); monaco 3337 m (monaco README (3,337 m)); montreal 4361 m (montreal README (4.361 km)); monza 5793 m (monza README (5,793 m)); singapore 4927 m (singapore README (4.927 km)); spa 7004 m (spa README (7,004 m)); suzuka 5807 m (suzuka README (5.807 km)).
- Lap length: the READMEs say racing-line laps run about 0.5 to 2% short of the centre-line length, so WARN starts at 2% short and FAIL at 3%. The distance axis is also compared with the X/Y path length (WARN above 1%, FAIL above 3%), which catches axis errors directly.
- Thresholds marked [spec] in the script come from the brief (5 m grid, 0-380 km/h, 0-100 %, 0-8 gear, 0-14000 rpm, -6.5/+1.8 g, 7 g lateral flag, 25 km/h jump, 0.05 s end-time tolerance). Other thresholds are the auditor's choices and are listed at the top of `check_telemetry.js`.
- Longitudinal accel is the raw speed/time difference between consecutive grid points. It is noisy because OpenF1 speed arrives at about 3.7 Hz and the grid interpolates it linearly. Most violations are positive values of 1.8 to about 2.5 g on single 0.07 to 0.13 s steps; a few are braking spikes of -7 to -8 g. The count thresholds (1-10 WARN, >10 FAIL) are auditor choices made with that noise in mind.
- Lateral g uses Menger curvature over +/-4 grid points (20 m each side) times v^2, followed by a 5-point median. X/Y positions look good to a few tenths of a metre, but at 5 m spacing the curvature estimate still moves by a few g from point to point (estimated, not measured). Treat the 7 g flag as a sign that X/Y is noisy, not as a measured peak. Peak lateral g is not reliable from this data.
- Spa lap files omit `raw_car_data` by design (per the Spa README), so the raw-sample checks show n/a for Spa.
- Silverstone lap files have no `processing.dropouts` or dropout rule, so their raw samples are not filtered the same way as the other circuits (see C3 raw brake).
- Duplicate check: byte hashes, exact speed and position traces, near-identical speed traces with the same lap time, and equal lap times within a circuit. No byte-identical files or identical traces were found.

