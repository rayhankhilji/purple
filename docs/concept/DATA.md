# CONCEPT data: Silverstone 2026, the grid, and the 2026 rules

Researched 2026-10-24 (all sources accessed that day). Every number in `concept/data/*.json` has a source id, and each source id maps to a URL in that file's `sources`/`docs` block. Anything that could not be confirmed is `null` with a note, or marked `unverified` / `reported`.

Status words used in the files:

- **official / verified**: read in an FIA document (fia.com PDF) or on formula1.com. For regulations, `verified: true` means the clause was read in the FIA PDF itself and the `quote` field is copied from it (a script checked every quote against the extracted PDF text).
- **derived**: arithmetic on official numbers, with the method stated (for example, sector split points summed from sector lengths).
- **reported**: journalism or Wikipedia.
- **unverified**: not confirmed; the value is null.

## Files

| File | Holds |
|---|---|
| `concept/data/silverstone-2026-weekend.json` | Round 9 (3-5 July 2026, sprint format): session dates/times, FIA weather per session, Pirelli compounds and tyre prescriptions, circuit length/laps/lap record, sector lengths and timing points, the four straight-mode (active aero) zones, Overtake detection/activation, the Silverstone ERS energy limits, FP1, Sprint Qualifying, Sprint, Qualifying (Q1/Q2/Q3, best sectors, speed traps), starting grid, race result (fastest laps, speed traps, best sectors, penalties, VSC/SC), and the upgrades each team declared. |
| `concept/data/grid-2026.json` | Per team: FIA entrant and constructor names, chassis and PU (Wikipedia, matches `js/data/season2026.js`), drivers at Silverstone, Silverstone Q1/Q2/Q3 and best lap per driver, team max speed trap (Q and race), declared Silverstone upgrades, Monza 2026 team top speeds (FIA), reported car mass vs minimum (RacingNews365, April), reported PU power (Mercedes/Audi only, rumour grade), and a concept note carried from the repo. |
| `concept/data/regs-2026-key.json` | 59 regulation items (52 verified in the FIA PDF): minimum mass and mass distribution, fundamental dimensions, rim dimensions, front/rear wing reference boxes and active-aero states, floor-body envelope, plank, PU (fuel energy flow, MGU-K 350 kW and speed taper, 4 MJ state-of-charge window, 8.5 MJ/lap recharge, torque, masses), fuel properties. Issue in force at Silverstone: Section C Issue 19 (2026-06-25) and Section B Issue 07 (2026-06-25); Section C Issue 21 (2026-10-19) checked for changes. |

## Cross-check: `js/data/racepace2026.js` (EI.RACEPACE.silverstone) vs official

Official sources: FIA Final Qualifying Classification (Doc 63), formula1.com qualifying page (both agree on every Q1/Q2/Q3 time), formula1.com fastest laps plus FIA Final Race Classification (agree on every time), FIA timing "Race Maximum Speeds" and "Qualifying Session Maximum Speeds" (speed trap 140 m before T15). URLs are in `silverstone-2026-weekend.json` under `sources` (`fia_q_class`, `f1_quali`, `f1_fastest`, `fia_r_class`, `fia_t_r_speeds`, `fia_t_q_speeds`).

**Pole:** repo `{code: ANT, s: 88.111}`; official ANT 1:28.111 (Q3). Match.

**Result: 0 mismatches** across pole, 22 `q` values, 22 `fastestLap` values, 22 `speedTrap` (race) values and 22 `speedTrapQuali` values. The repo has no extra or missing driver codes.

| Code | Q pos | repo q | official best (session) | repo fastestLap | official | repo speedTrap | official | repo speedTrapQuali | official | match |
|---|---|---|---|---|---|---|---|---|---|---|
| ANT | 1 | 88.111 | 88.111 (Q3) | 91.777 | 91.777 | 322.3 | 322.3 | 302.6 | 302.6 | yes |
| LEC | 2 | 88.286 | 88.286 (Q3) | 92.871 | 92.871 | 315.1 | 315.1 | 307.4 | 307.4 | yes |
| HAM | 3 | 88.458 | 88.458 (Q3) | 92.309 | 92.309 | 351.5 | 351.5 | 317.9 | 317.9 | yes |
| RUS | 4 | 88.481 | 88.481 (Q3) | 92.489 | 92.489 | 332.5 | 332.5 | 299.8 | 299.8 | yes |
| HAD | 5 | 88.746 | 88.746 (Q3) | 92.268 | 92.268 | 331.7 | 331.7 | 305.8 | 305.8 | yes |
| NOR | 6 | 88.877 | 88.877 (Q3) | 92.625 | 92.625 | 310.9 | 310.9 | 304.3 | 304.3 | yes |
| VER | 7 | 88.893 | 88.893 (Q3) | 92.101 | 92.101 | 330.8 | 330.8 | 304.3 | 304.3 | yes |
| PIA | 8 | 89.032 | 89.032 (Q3) | 92.917 | 92.917 | 338.9 | 338.9 | 308.2 | 308.2 | yes |
| LIN | 9 | 89.305 | 89.305 (Q3) | 93.632 | 93.632 | 331.6 | 331.6 | 306.9 | 306.9 | yes |
| LAW | 10 | 89.300 | 89.300 (Q1) | 93.648 | 93.648 | 317.4 | 317.4 | 306.0 | 306.0 | yes |
| BOR | 11 | 89.461 | 89.461 (Q2) | 93.650 | 93.650 | 332.1 | 332.1 | 298.5 | 298.5 | yes |
| GAS | 12 | 90.063 | 90.063 (Q2) | 94.179 | 94.179 | 344.0 | 344.0 | 307.0 | 307.0 | yes |
| HUL | 13 | 89.539 | 89.539 (Q1) | 93.433 | 93.433 | 339.3 | 339.3 | 300.1 | 300.1 | yes |
| BEA | 14 | 90.501 | 90.501 (Q2) | 94.455 | 94.455 | 339.4 | 339.4 | 302.0 | 302.0 | yes |
| SAI | 15 | 90.562 | 90.562 (Q1) | 92.734 | 92.734 | 338.9 | 338.9 | 315.2 | 315.2 | yes |
| ALB | 16 | 90.638 | 90.638 (Q1) | 93.867 | 93.867 | 305.5 | 305.5 | 296.9 | 296.9 | yes |
| OCO | 17 | 90.680 | 90.680 (Q1) | 94.792 | 94.792 | 332.8 | 332.8 | 298.3 | 298.3 | yes |
| BOT | 18 | 91.227 | 91.227 (Q1) | 95.893 | 95.893 | 316.1 | 316.1 | 304.7 | 304.7 | yes |
| COL | 19 | 91.321 | 91.321 (Q1) | 94.281 | 94.281 | 343.9 | 343.9 | 300.2 | 300.2 | yes |
| PER | 20 | 91.451 | 91.451 (Q1) | 95.520 | 95.520 | 325.2 | 325.2 | 303.9 | 303.9 | yes |
| STR | 21 | 92.863 | 92.863 (Q1) | 97.232 | 97.232 | 309.9 | 309.9 | 292.5 | 292.5 | yes |
| ALO | 22 | 93.025 | 93.025 (Q1) | 95.827 | 95.827 | 334.8 | 334.8 | 292.6 | 292.6 | yes |

Also checked against `js/data/season2026.js`: the round 9 `quali` order and `grid` order both equal the official qualifying classification and the formula1.com starting grid (GAS 12th to 15th, impeding penalty; STR 21st to 22nd, PU elements). Date 2026-07-05, winner LEC, podium LEC-RUS-HAM all match.

Not cross-checked: `r` (median green-flag race lap). It is a derived statistic and the script that made it (`gen/racepace.py`) is not in this repo; the FIA lap analysis PDF is listed on the FIA timing page if someone wants to recompute it. `pole2025` in season2026.js was not checked.

### Notes on meaning (not errors)

- `q` is the driver's fastest lap over Q1-Q3, not the lap that set the classification. For LAW (Q1 1:29.300 vs Q3 1:29.716), HUL (Q1 1:29.539 vs Q2 1:30.076), SAI (Q1 1:30.562 vs Q2 1:30.623) and ALB (Q1 1:30.638 vs Q2 1:31.341) these differ, which is why `q` is not monotonic in grid order (LAW < LIN, HUL < GAS).
- Sprint Qualifying times are not in `q` (correct: the SQ pole was HAM 1:28.376; LAW's SQ3 1:28.927 is faster than any of his GP qualifying laps).
- Race speed traps (`speedTrap`) run much higher than qualifying ones (HAM 351.5 vs 317.9). These are maxima over the race, with tow and Overtake energy; quali values are single-lap maxima. A lap simulator calibrated to qualifying should use `speedTrapQuali`.
- Fastest-lap lap numbers: formula1.com and the FIA classification disagree by 1-3 laps for PIA, BEA, OCO, PER, BOT, ALO, STR, ALB, HUL (mostly cars that were lapped). Times agree. The repo stores no lap numbers, so nothing to fix.

### Suggested changes to `js/data/racepace2026.js` (not applied)

1. No value changes needed for Silverstone `pole`, `q`, `fastestLap`, `speedTrap`, `speedTrapQuali`.
2. Optional: document in the header comment that `q` = min(Q1, Q2, Q3) and that `speedTrap` is the race maximum at the FIA speed trap (140 m before T15).
3. Optional: add the session of each `q` (Q1/Q2/Q3) so consumers do not read `q` as grid order. The values are in `silverstone-2026-weekend.json` `qualifying.rows[].best_session`.

## What is verified, reported, missing

### silverstone-2026-weekend.json

- **Official (read in FIA / formula1.com documents):** session dates and local start times (FIA Timetable V5); weather per session from the five FIA weather reports (air and track temperature, humidity, wind speed, air pressure min/max; all five sessions dry); compounds C1/C2/C3 (hard/medium/soft), mandatory race tyres C1 and C2, Q3 tyre C3, minimum pressures and camber limits (FIA Pirelli Preview); centreline length 5.891 km; 52 laps, 306.198 km, first GP 1950, race lap record 1:27.097 (VER, 2020); sector lengths 1.823 / 2.464 / 1.604 km; intermediate 1 at 110 m before T6, intermediate 2 at 50 m after T14, speed trap at 140 m before T15; straight-mode zones A1 (65 m after T18), A2 (55 m after T5), A3 (155 m after T7), A4 (65 m after T14) with low-grip activation points (A3 has none); Overtake detection at the exit of T17 (5560 m, marked TBC in the source) and activation 95 m after T17 (5631 m), detection gap 1.0 s; recharge limits 8.0 MJ (race/sprint, Overtake off), 8.5 MJ (Overtake on), 6.5 MJ (SQ/Q), 8.5 MJ (FP); classifications for FP1, SQ, Sprint, Q, grid, race; best sectors (Q and race); four speed points per driver (Q and race); penalties and VSC/SC times; declared upgrades for all 11 teams.
- **Derived:** sector split points 1.823 km and 4.287 km from the control line.
- **Approximate (read from a chart):** wind direction per session. The FIA publishes only a plot, so the value is null and the note describes the plot.
- **Missing / unverified:** where each straight-mode zone ends (only activation points are published); the timezone is not printed on the timetable (BST assumed); sector split lap distances are not published as such.

### grid-2026.json

- **Official:** entrant and constructor names (FIA entry list), drivers and car numbers, all Silverstone times and speed traps, upgrades, Monza 2026 team top speeds (FIA timing).
- **Reported:** chassis and PU names (Wikipedia, same as the repo); car mass vs the 768 kg limit (RacingNews365, 2 April 2026, an early-season estimate from unnamed sources); Mercedes 420 kW / 571 bhp and Audi 540-550 bhp (PlanetF1, October 2025, relaying an unnamed Italian report; it is not stated whether these are ICE-only); concept notes copied from `js/data/season2026.js`. That file cites the-race.com and racefans.net, which were not opened again here.
- **Missing:** PU power for Ferrari, Red Bull Ford and Honda (an f1oversteer.com piece on a Ferrari deficit returned HTTP 403); official car masses (the FIA does not publish them); Monza team mapping for Red Bull and Racing Bulls cars 30 and 22 comes from the repo, since the Monza entry list was not read.

### regs-2026-key.json

- **Verified in FIA Section C Issue 19 / Section B Issue 07:** 52 items. Key ones:
  - Mass: minimum mass 726 kg (SQ/Q) or 724 kg (other sessions) plus Nominal Tyre Mass (C4.1). Front axle ≥ 0.44 and rear axle ≥ 0.54 of the minimum (C4.2). Driver plus ballast ≥ 82 kg (C4.5.2). PU ≥ 185 kg (C5.5.2).
  - Dimensions: half-width ≤ 950 mm (C2.3.1). Wheelbase ≤ 3400 mm (C2.3.3).
  - Rims: diameter 462.5/463 mm, tyre mounting width 315 mm front and 401.3 mm rear (C10.7.2).
  - Wings: front-wing box XF−1250 to −475, Y 0-675, Z 60-300 (App. C2 §22). Rear-wing box XR+165 to +630, Y 0-575, Z 725-880 (App. C2 §30). Up to 3 elements each.
  - Active aero: two fixed positions per wing, Corner and Straight Mode, change ≤ 400 ms, failure returns to Corner Mode (C3.10.10, C3.11.6). Low grip allows only partial (front) activation (B7.1.2).
  - Plank: 10 ± 0.2 mm, at least 8 mm when worn (C3.6.1).
  - PU: fuel energy flow ≤ 3000 MJ/h (C5.2.3). MGU-K ≤ 350 kW (C5.2.7), tapering with speed: 1800−5v below 340 km/h, zero at 345 km/h, or with Overtake 7100−20v, zero at 355 km/h (C5.2.8). State-of-charge window 4 MJ (C5.2.9). Recharge ≤ 8.5 MJ/lap (C5.2.10). MGU-K torque ≤ 500 Nm (C5.2.11).
  - Fuel: LHV 38-41 MJ/kg (C16.2).
- **Changed in Issue 21 (2026-10-19, after Silverstone):** C5.2.10 ii, where the Q/SQ recharge floor goes from 5 to 4 MJ (struck through in the marked-up PDF), and C5.2.8 iii, which adds "during any power limited period".
- **Reported:** the 768 kg total minimum (press figure).
- **Unverified / missing:** Nominal Tyre Mass value (published outside Section C; not found). Tyre widths and diameters (Section C leaves them to the supplier; press figures conflict). ICE power (no cap in the rules; no official figure found). Per-lap deployment cap (none in C5.2). Maximum race fuel mass (not found in C Iss 19 or B Iss 07). Straight-mode flap angle (not fixed by the rules).

## How the files were made

The FIA PDFs and formula1.com pages were downloaded and converted to text with `pdftotext -layout`, then parsed by a script. The script also:

- asserted that the FIA and formula1.com qualifying times agree;
- produced the cross-check above;
- checked every typed weather number against the FIA text;
- checked every `verified: true` regulation quote against the Issue 19 / Issue 07 text, and against Issue 21 for the `same_in_iss21` flag.

The scripts were scratch tools and are not committed.
