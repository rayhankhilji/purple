# Track model and corner statistics

`concept/track/` turns real 2026 qualifying telemetry into a measured description of each circuit: its geometry, and how the real field drives it. The physics lap simulator uses it for held-out checks (`track.compare`), and the car-identification work uses it to see where each car gains or loses time.

Nothing here is simulated. Every number comes from the OpenF1 telemetry in `concept/data/telemetry/` (licence, method and caveats are in that folder's README), the MultiViewer corner markers, the OpenStreetMap centrelines in `js/data/<circuit>.js` (© OpenStreetMap contributors, ODbL 1.0) and the FIA facts in `concept/data/silverstone-2026-weekend.json`.

| File | What |
|---|---|
| `concept/track/track.js` | All algorithms plus the read API. UMD module: `window.EI.concept.track` in the browser, `module.exports` in Node |
| `concept/track/build.js` | CLI that builds `concept/data/tracks/<circuit>.json` for every circuit it finds |
| `concept/data/tracks/<circuit>.json` | Generated models: Silverstone; Monza, Monaco, Spa, Austria (telemetry set A); Suzuka, Hungaroring, Singapore, Montreal (telemetry set B) |
| `test/concept-track.test.js` | Geometry, statistics, determinism and `compare()` tests (16) |

```sh
node concept/track/build.js                      # every circuit under concept/data/telemetry/ (and its sub-folders)
node concept/track/build.js silverstone          # one circuit
node concept/track/build.js --check              # rebuild in memory; exit 1 if a committed model differs
node concept/track/build.js --telemetry DIR      # read the same layout from another checkout
```

## API

```js
const track = require("./concept/track/track.js");   // browser: window.EI.concept.track
const m = track.load("silverstone");                 // Node reads the JSON. Browser: await track.loadAsync(id) or track.register(json)
track.corners();                                     // corner table of the last loaded model (or pass an id / model)
track.straights("silverstone");                      // straight / clipping table
track.compare(simTrace, "silverstone", { driver: "HAD" });
track.traceFromLap(lapJson, m);                      // a real lap projected onto the model's distance axis, built the same way
```

`compare(simTrace, circuit, opts)` takes `{ s_m | distance_m, v_kmh | speed_kmh }` (the lap sim's `trace` has this shape). It returns:

- `vs_field` and `vs_driver`: RMS, mean and largest speed error over the whole lap, plus the RMS of the per-corner deltas.
- `corners[]`: for each corner, the sim's minimum speed in that corner's window against the field mean (with the field std and a z-score) and against the chosen driver.
- `straights[]`: peak and end-of-straight speed deltas.
- `lap_time_from_speed_s`: lap times from integrating each speed trace along the field-mean racing-line length.

Distance basis (`opts.basis`):

- `"model"` (the default when the trace is within 0.5 % of the model length): the trace is already on the model's axis.
- `"fraction"` (the default otherwise): the trace is scaled by lap fraction.
- `"driver:ANT"`: the trace is on that driver's speed-integral axis (the lap sim's telemetry line). The driver's stored warp maps it onto the model's axis.

`opts.driver` can be a qualifying code (`"HAD"`) or a race lap (`"VER-R40"`).

## Method

### Distance axis

Every model quantity is placed by **s, metres along the model centreline from the timing line**. Each lap's own distance is a speed integral of a 3.7 Hz feed and follows the racing line, so it is between 5806 m and 5885 m at Silverstone. Each lap is therefore projected onto the centreline through its X/Y, one point after another within a moving search window. A smooth, monotone warp then maps the lap's speed-integral distance to s, using offsets equal to the median of (projected s − d) in windows around knots every 100 m, pinned so the lap spans exactly [0, L]. The warp keeps the speed integral's local smoothness and takes its absolute position from the X/Y. All channels are resampled onto a common grid of about 5 m (`L / round(L / 5)`). This grid uses linear interpolation for speed, throttle, rpm and time, and the last sample at or before each point for brake and gear. The raw 3.7 Hz samples are also mapped to s; braking points, minima, decelerations and gears come from those raw samples.

### Fused centreline

1. The **field racing line** is the per-point median, across the 22 laps, of X/Y at equal fractions of each lap's own length.
2. The **OSM centreline** is converted to (east, north) and fitted onto that racing line. A coarse search covers cyclic shift, travel direction and mirror on 400 arc-length stations. This search solves 2-D Procrustes for each candidate. Twelve rounds of ICP against a 2 m resampling of the OSM line follow. The move applied is **rigid**: rotation and translation only, so the OSM lengths and radii are kept. The fitted similarity scale is reported only as a check. At Silverstone it is 1.0027 with no mirror and 1.38° of rotation, and the racing line sits 4.2 m RMS from the centreline. That figure is the real racing-line offset plus X/Y noise, not only fit error.
3. The fitted line is resampled to about 2 m (`L / round(L / 2)`), oriented in the driving direction and rotated so that index 0 is the timing line (the median of the laps' first X/Y).
4. A circuit with no OSM file (Austria, Suzuka, Hungaroring, Singapore, Montreal) uses the smoothed field-median racing line as its centreline and says so in `geometry.source`. That line is shorter than the official centre line, by 0.75 % to 1.55 %.

The **racing-line offset** (signed, left positive, mean and std across the field, on the 5 m grid) is the fused product: it shows where the field sits within the track.

**Elevation**: `js/data/silverstone.js` carries a relative height profile with 120 m spacing. It is mapped by lap fraction into `geometry.elevation`. The repo does not document where that profile comes from, so it is labelled indicative and no statistic uses it.

**Smoothing for curvature**: the OSM polyline is piecewise straight, with corner nodes about 6 m apart and up to 186 m apart on straights. Curvature is therefore taken after a periodic Gaussian smoothing with σ = 8 m. Turning angles use the heading change of the smoothed curve, which sums to exactly ±360.0° at every circuit (0° at Suzuka, whose figure of eight crosses itself; `geometry.sense` says `figure-eight`). Integrating κ·ds instead overcounts tight corners, because the smoothing shortens the curve's own arc. Sensitivity of the minimum centreline radius (m) to σ = 4 / 8 / 12 / 16 m:

| Corner | σ 4 | σ 8 (used) | σ 12 | σ 16 |
|---|---|---|---|---|
| T3 Village | 21 | 24 | 24 | 24 |
| T4 The Loop | 18 | 19 | 19 | 19 |
| T7 Luffield | 41 | 48 | 48 | 48 |
| T16 Vale | 17 | 19 | 20 | 22 |
| T9 Copse | 54 | 69 | 80 | 88 |
| T15 Stowe | 51 | 73 | 80 | 82 |
| T1 Abbey | 36 | 48 | 56 | 64 |

Slow corners are stable. In fast, short-arc corners the minimum radius depends on the smoothing, so the table also gives the mean radius (arc ÷ turn angle) in the JSON as `mean_radius_geom_m`.

### Corners

The MultiViewer markers are projected onto the centreline. Each corner has a geometric window that reaches up to 150 m from its marker and never more than halfway to a neighbouring marker. **Entry** and **exit** are where 5 % and 95 % of the window's signed heading change is reached. The **geometric apex** is the point of maximum curvature between them. **Direction** is the sign of the heading change, and the **turn angle** is its size. The `apex_radius_geom_m` value is 1 / κmax on the centreline.

Driving statistics use a **driving window**, which is the geometric window widened by 40 m each way and capped at halfway to the neighbouring apexes, because the field's minimum often sits just past a tight corner's geometric exit. Per driver:

- **Braking**: the last brake-on raw sample up to the speed minimum, walked back across gaps of up to 2 samples. The brake must be on within 250 m of the minimum and after the previous corner's apex. **Lift**: the same walk-back for throttle under 95 %, which must still be on within 40 m of the minimum. **Entry speed** is the highest raw speed in the 50 m before the braking (else lift) point.
- **Apex speed**: if the driver lifted or braked and the raw speed has a true local minimum (both neighbouring samples higher), the apex is that minimum. Otherwise the apex is the point of peak lateral acceleration in the geometric window, which covers flat-out corners and minima that sit on a window edge while the car is still slowing for the next corner. `min_speed_kmh` (the plain window minimum) is kept as well.
- **Lateral acceleration**: from each lap's X/Y against time. The X/Y is resampled to 0.05 s and smoothed with a Gaussian of σ = 0.3 s, a little more than the 0.27 s sample interval. Then a_lat = (vₓa_y − v_ya_x)/|v|. The values reported are `lat_g_apex` (mean over ±5 m at the apex, toward the inside of the corner) and `lat_g_peak` (the maximum in the geometric window).
- **Effective radius** `r_eff_m` = v_apex² / a_lat at the apex: the radius the field actually drives, which can differ from the centreline's.
- **Peak deceleration**: the largest drop in raw speed between consecutive 3.7 Hz samples from braking to the minimum, in g. See the limitations below.
- **Minimum gear**: from braking to the window's end. **Full throttle again**: the first raw sample at or above 98 % after the minimum (only for corners with a lift or brake). **Time through the corner**: geometric entry to exit.

Each statistic is given as `{mean, std (n−1), min, max, n}` across drivers, `by_team` (apex speed and time) and `by_driver` (apex, brake point, gear, time). **Type** comes from the field-mean apex speed: slow below 150 km/h, fast above 230 km/h, medium in between. **Sector** comes from the apex position against the sector lines found from the timing data (below).

### Straights

A straight is a run of grid points where at least half the field is at 98 % throttle or more. Runs with gaps under 15 m are joined, a run may cross the timing line, and only runs of 200 m or more count. For each driver, the longest run of their own at 98 % or more that overlaps the straight (searched 150 m either side) gives:

- start, end and duration
- entry speed
- peak speed and its position
- the gear and rpm at the peak
- the speed at the end of the run
- the **loss at full throttle**: peak minus end, with the throttle still at 98 % or more (the energy-clipping signature)

Each FIA straight-mode activation point ("65m after T18") is placed at the corner's marker plus that distance and attached to the straight that contains it.

### Lap level

Lap-level shares are time-weighted on each lap's grid:

- **full throttle**: throttle at 98 % or more
- **braking**: brake on
- **coasting**: throttle under 5 % with the brake off

Distance share at full throttle is also given. The lap-level statistics also cover:

- lap and sector times
- speed trap, i1 and i2 readings
- each lap's speed-integral length
- a **trap position fit**: the s at which the drivers' speeds best match their own trap readings (RMS)

### Data quality

Two kinds of bad data are handled:

- **Frozen speed channel**: four or more consecutive raw samples with the identical speed, either while the brake is on (2 or more samples) or across a downshift. A real car cannot hold its speed exactly while braking or changing down. Those samples are removed and the lap's grid speed is set to null in that stretch, so it drops out of the field statistics there. At Silverstone this catches **OCO** (253 km/h × 6 samples into Vale, which is why his speed-integral length is 5885 m) and **ALB** (300 km/h × 7 through Copse). The model lists them under `quality.frozen_speed`.
- **Dropouts** (the set A circuits carry null channels inside gaps): a gap of more than 1.5 s between raw samples, anywhere from 300 m before a corner's minimum to the end of its window, removes that driver from that corner. Silverstone's feed has natural gaps of up to about 1.2 s. The corner `n` shows how many drivers remain.

## Checks

| Check | Silverstone result |
|---|---|
| Centreline length | 5879.7 m against the official 5891 m (−0.19 %); the OSM polyline is 5880.7 m |
| Sector lines found from the drivers' sector times | 1825.3 ± 5.3 m and 4283.0 ± 5.1 m, against the FIA map's 1823 m and 4287 m |
| Net turning | −360.0° (clockwise) |
| OSM fit | scale 1.0027 (diagnostic), not mirrored, racing line 4.2 m RMS from the centreline |
| Pole-lap cross-check with the telemetry README | ANT The Loop 87 km/h, Village 108 km/h, 64.5 % full throttle (README: 87, 108, 63.8 % at ≥ 99 %) |
| Speed-trap fit | best match at 4815 m (RMS 0.74 km/h) on the Hangar Straight. The FIA puts the trap 140 m before T15 (4880 m against the T15 marker at 5020 m). i1 fits at 1795 m (FIA: 110 m before T6, i.e. 1861 m) and i2 at 4240 m (FIA: 50 m after T14, i.e. 4208 m). The markers are not the FIA's own reference points, so these differences of 30 to 65 m are reported, not corrected |
| `compare()` of a lap against itself | stored trace: RMS 0 exactly; raw lap file through `traceFromLap`: RMS 0.009 km/h; raw file on its own distance axis with `basis: "driver:ANT"`: 0.03 km/h |

**Plausible apex radii.** A search on 2026-10-24 turned up no published table of Silverstone corner radii. The test ranges therefore come from first principles and published load figures:

- **Effective radius**: an F1 car's lateral acceleration lies between about 1.5 g (slow corners) and about 6 g (the highest single-moment readings reported). A team figure for the 2024 British GP expected a 5 g peak at Turn 11 in Maggotts–Becketts ([formulacritica.it](https://formulacritica.it/en/gp-great-britain-2024-f1-at-the-silverstone-challenge/f1)), and an article built on a 2019 Ferrari data overlay reports a 6.5 g single-moment peak, with an onboard example peaking at 5.3 g ([oversteer48.com](https://oversteer48.com/?p=8414)). For every corner over 45° the effective radius must therefore lie between v²/(6 g) and v²/(1.5 g) at the field's own apex speed.
- **Centreline radius**: the bounds are 12–45 m for the hairpin-like Village, The Loop and Vale, 30–80 m for Luffield, 25–80 m for Brooklands, and 45–200 m for Copse, Stowe and Maggotts. Copse is described as taken at about 290 km/h in public track guides (for example [F1 Chronicle](https://f1chronicle.substack.com/p/silverstone-track-guide-a-corner)); the field here averages 275 km/h at its apex.
- **Directions**: the corner directions are taken from the FIA circuit map turn numbering (right: Village, Luffield, Copse, Stowe, Club; left: The Loop, Brooklands, Becketts T12, Chapel, Vale).

The measured lateral peaks (Abbey 5.2 g, Copse 4.8 g, Becketts T12 4.2 g, Maggotts T11 4.0 g) sit below the 5 g figure. 0.3 s smoothing at 3.7 Hz cuts short peaks, and 2026 cars run less downforce than the 2024 car that figure describes.

## Silverstone 2026 qualifying: corner table

Mean ± std across the 22 best laps (n is 21 where a lap's frozen speed channel voids the corner). Distances are s on the centreline. R geom is the centreline minimum radius (σ = 8 m), and R eff is v_apex² / a_lat at the apex. Braking columns are given where at least 11 drivers brake.

| Corner | Dir | Turn ° | Entry / apex / exit m | R geom m | R eff m | Apex km/h | Type | Lat g at apex | Braking (n of 22) | Brake start m | Entry km/h | Peak decel g | Min gear | Full throttle again m | Entry→exit s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 Abbey | R | 62 | 376 / 390 / 470 | 48 | 140 ± 8 | 304 ± 5 | fast | 5.22 ± 0.33 | 1 | - | - | - | 7–8 | - | 1.10 ± 0.02 |
| T2 Farm | L | 48 | 566 / 658 / 674 | 117 | 163 ± 9 | 283 ± 6 | fast | 3.86 ± 0.26 | 0 | - | - | - | 7–8 | - | 1.36 ± 0.03 |
| T3 Village | R | 112 | 858 / 890 / 914 | 24 | 43 ± 4 | 108 ± 3 | slow | 2.11 ± 0.18 | 22 | 785 ± 13 | 270 ± 9 | 4.00 ± 0.73 | 2–3 | 1109 ± 49 | 1.63 ± 0.06 |
| T4 The Loop | L | 148 | 1008 / 1038 / 1094 | 19 | 27 ± 4 | 85 ± 1 | slow | 2.14 ± 0.29 | 22 | 981 ± 8 | 142 ± 4 | 1.44 ± 0.37 | 2–2 | 1123 ± 14 | 3.15 ± 0.05 |
| T5 Aintree | L | 63 | 1158 / 1242 / 1262 | 42 | 147 ± 11 | 234 ± 11 | fast | 2.93 ± 0.19 | 0 | - | - | - | 2–4 | - | 1.67 ± 0.05 |
| T6 Brooklands | L | 123 | 1896 / 2006 / 2016 | 40 | 70 ± 7 | 160 ± 5 | medium | 2.88 ± 0.33 | 22 | 1865 ± 12 | 288 ± 8 | 2.85 ± 0.66 | 3–4 | 2218 ± 107 | 2.28 ± 0.08 |
| T7 Luffield | R | 197 | 2098 / 2170 / 2264 | 48 | 37 ± 2 | 110 ± 4 | slow | 2.59 ± 0.19 | 22 | 2086 ± 5 | 177 ± 6 | 1.60 ± 0.38 | 2–3 | 2288 ± 10 | 4.52 ± 0.11 |
| T8 Woodcote | R | 58 | 2410 / 2428 / 2618 | 146 | 258 ± 13 | 285 ± 4 | fast | 2.49 ± 0.17 | 0 | - | - | - | 5–6 | - | 2.67 ± 0.04 |
| T9 Copse | R | 79 | 3022 / 3038 / 3154 | 69 | 144 ± 26 | 275 ± 10 | fast | 4.28 ± 0.82 | 4 | - | - | - | 7–8 | - | 1.68 ± 0.05 |
| T10 Maggotts | L | 29 | 3570 / 3604 / 3648 | 133 | 467 ± 52 | 288 ± 6 | fast | 1.34 ± 0.40 | 1 | - | - | - | 6–8 | - | 0.98 ± 0.02 |
| T11 Maggotts | R | 51 | 3676 / 3694 / 3736 | 61 | 156 ± 9 | 279 ± 4 | fast | 3.93 ± 0.22 | 0 | - | - | - | 6–8 | - | 0.77 ± 0.01 |
| T12 Becketts | L | 59 | 3816 / 3896 / 3912 | 75 | 124 ± 9 | 254 ± 8 | fast | 4.13 ± 0.39 | 6 | - | - | - | 6–7 | - | 1.33 ± 0.03 |
| T13 Becketts | R | 96 | 3956 / 3962 / 4068 | 62 | 93 ± 11 | 201 ± 10 | medium | 3.46 ± 0.46 | 22 | 3940 ± 8 | 245 ± 8 | 1.07 ± 0.32 | 4–6 | 4079 ± 9 | 1.92 ± 0.09 |
| T14 Chapel | L | 29 | 4150 / 4176 / 4206 | 97 | 192 ± 15 | 246 ± 7 | fast | 2.51 ± 0.20 | 0 | - | - | - | 5–6 | - | 0.79 ± 0.02 |
| T15 Stowe | R | 121 | 4956 / 4992 / 5132 | 73 | 94 ± 9 | 216 ± 12 | medium | 3.96 ± 0.58 | 22 | 4932 ± 11 | 298 ± 5 | 2.02 ± 0.55 | 4–6 | 5137 ± 125 | 2.81 ± 0.13 |
| T16 Vale | L | 85 | 5488 / 5502 / 5522 | 19 | 51 ± 11 | 109 ± 17 | slow | 1.86 ± 0.42 | 21 | 5423 ± 14 | 254 ± 15 | 4.34 ± 1.51 | 2–3 | 5660 ± 15 | 1.03 ± 0.04 |
| T17 Club | R | 92 | 5558 / 5566 / 5630 | 30 | 43 ± 4 | 122 ± 7 | slow | 2.47 ± 1.07 | 2 | - | - | - | 2–3 | - | 1.98 ± 0.06 |
| T18 Club | R | 73 | 5660 / 5760 / 5776 | 39 | 127 ± 9 | 220 ± 6 | medium | 3.02 ± 0.22 | 0 | - | - | - | 2–4 | - | 2.05 ± 0.05 |

Reading notes:

- The racing line opens up the slow corners (R eff 43 against 24 m at Village, 51 against 19 m at Vale). In Luffield's long double apex the field is tighter than the centreline's minimum (37 against 48 m).
- Vale and Club T17 share one speed minimum at about 5525 m. A driver whose minimum falls in T17's window gets Vale's apex from the lateral-g peak, which explains Vale's ±17 km/h.
- Brake-on samples at Vale/Club are attributed to Vale (21 drivers). T17 is a lift for most drivers.
- Peak deceleration is low because of the sampling: see the limitations.

## Silverstone 2026 qualifying: clipping table (speed lost at full throttle)

| Straight | Field full throttle, m (length) | Peak km/h | Peak at m | End km/h | Loss at full throttle km/h | km/h lost per 100 m | Drivers losing > 2 km/h | Gear at peak | rpm at peak | Full-throttle time s | Straight-mode zone (activation m) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 T17 → T3 (pit straight, crosses the line) | 5655 to 765 (990) | 312.2 ± 4.9 | 286 ± 25 | 272.4 ± 18.9 | 39.9 ± 17.5 | 8.7 ± 3.1 | 20/22 | 7–8 | 11244 ± 469 | 11.75 ± 2.24 | A1 (5786) |
| S2 T4 → T6 (Wellington) | 1120 to 1845 (725) | 303.1 ± 6.5 | 1645 ± 31 | 283.5 ± 8.5 | 19.6 ± 8.2 | 10.1 ± 4.4 | 22/22 | 7–8 | 10984 ± 432 | 9.67 ± 0.36 | A2 (1285) |
| S3 T7 → T9 (National pit straight) | 2290 to 2985 (695) | 308.5 ± 6.5 | 2834 ± 47 | 294.5 ± 10.3 | 14.0 ± 11.3 | 7.0 ± 3.2 | 22/22 | 7–8 | 11106 ± 400 | 9.45 ± 0.94 | A3 (2351) |
| S4 T9 → T12 (Copse to Becketts) | 3120 to 3810 (690) | 297.0 ± 7.9 | 3283 ± 222 | 269.8 ± 4.4 | 27.2 ± 7.3 | 5.6 ± 1.2 | 22/22 | 7–8 | 11104 ± 443 | 9.04 ± 1.06 | - |
| S5 T13 → T15 (Hangar) | 4075 to 4915 (840) | 302.7 ± 4.6 | 4654 ± 117 | 295.9 ± 6.4 | 6.7 ± 5.2 | 2.7 ± 2.1 | 15/22 | 7–8 | 11014 ± 422 | 10.52 ± 0.30 | A4 (4223) |
| S6 T15 → T16 (Stowe to Vale) | 5110 to 5400 (290) | 257.0 ± 5.4 | 5360 ± 31 | 256.6 ± 5.3 | 0.4 ± 1.0 | 0.7 ± 1.3 | 1/21 | 6–7 | 11233 ± 443 | 4.06 ± 0.33 | - |

**On four of the six straights, 20 or more of the 22 drivers lose speed at full throttle.** The mean losses are 14 to 40 km/h, at 5.6 to 10 km/h per 100 m, with the throttle pinned and the car in 7th or 8th at around 11,000 rpm. On the Hangar Straight 15 of 22 lose speed, 6.7 km/h on average. A car limited by its rev limit or by power against drag would not do this. It fits the 2026 power units tapering electrical deployment late in a straight, as the telemetry README describes. On S1 and S4 it is mixed with cornering load through Abbey/Farm and Maggotts. The Hangar Straight, after the long Chapel exit, loses least. A simulator that balances only power against drag will overestimate end-of-straight speeds, and this table is the target that corrects it.

**Lap level** (mean ± std, 22 laps):

| Measure | Value |
|---|---|
| Lap time | 89.969 ± 1.438 s |
| Sectors | 28.683 ± 0.376 / 36.390 ± 0.642 / 24.896 ± 0.460 s |
| Full throttle | 61.2 ± 2.6 % of lap time, 71.7 ± 2.6 % of distance |
| Braking | 13.1 ± 1.5 % |
| Coasting | 3.0 ± 1.6 % |
| Speed trap | 299.8 ± 4.5 km/h; i1 295.0 ± 5.4, i2 263.2 ± 4.3 |
| Speed-integral lap length | 5832 ± 15 m |

Per-team figures are in `lap.by_team`. For example, Ferrari 88.372 ± 0.122 s, Mercedes 88.296 ± 0.262 s, Red Bull Racing 88.820 ± 0.104 s.

## Other circuits (telemetry sets A and B)

Built by the same code from `concept/data/telemetry/<circuit>/` (branches `claude/telemetry-set-a` and `claude/telemetry-set-b`, read with `--telemetry` from an extracted copy). Official lengths come from formula1.com's circuit pages; Singapore's 4927 m is the figure quoted in its telemetry README. These circuits have no weekend file yet. Corner names come from the set A READMEs where they give them; the rest are `T<n>`. The models are committed under `concept/data/tracks/`. With both branches' data in place, `--check` and the determinism test reproduce all nine byte for byte (checked before commit). Without that data, the tests check only the committed models' sanity.

| Circuit | Centreline | Length vs official | Corners / straights | Lap time | Full throttle | Slowest corner | Top straight peak |
|---|---|---|---|---|---|---|---|
| Monza | OSM, racing line 2.5 m RMS | 5791.8 / 5793 m (−0.02 %) | 11 / 5 | 82.971 ± 1.136 s | 71.6 ± 1.9 % | T2 Rettifilo | 333.5 km/h |
| Monaco | OSM, 3.6 m RMS | 3316.9 / 3337 m (−0.60 %) | 19 / 3 | 73.686 ± 1.200 s | 32.7 ± 2.0 % | T6 Grand Hotel hairpin (45 km/h) | 286.7 km/h |
| Spa | OSM, 2.8 m RMS | 6983.8 / 7004 m (−0.29 %) | 19 / 5 | 106.367 ± 1.627 s | 67.5 ± 2.0 % | T19 Bus Stop | 329.9 km/h |
| Austria | field-median racing line (no OSM file) | 4285.7 / 4318 m (−0.75 %) | 10 / 5 | 67.535 ± 1.205 s | 56.7 ± 3.4 % | T3 | 324.6 km/h |
| Suzuka | racing line; figure of eight | 5761.6 / 5807 m (−0.78 %) | 18 / 5 | 90.468 ± 1.183 s | 52.7 ± 4.8 % | T11 hairpin (74 km/h) | 319.3 km/h |
| Hungaroring | racing line | 4318.6 / 4381 m (−1.42 %) | 16 / 5 | 78.951 ± 1.341 s | 40.9 ± 2.6 % | T1 (90 km/h) | 333.3 km/h |
| Singapore (21 laps) | racing line; anticlockwise | 4850.6 / 4927 m (−1.55 %) | 19 / 6 | 92.964 ± 1.352 s | 42.1 ± 2.4 % | T13 (63 km/h) | 306.3 km/h |
| Montreal | racing line | 4305.5 / 4361 m (−1.27 %) | 14 / 6 | 73.951 ± 1.142 s | 55.3 ± 1.8 % | T10 hairpin (62 km/h) | 328.3 km/h |

Suzuka's corner counts drop to 11–19 drivers because of telemetry dropouts in that set. The racing-line circuits' geometric radii are those of the field's line, not of the centre line.

## Limitations

- **3.7 Hz.** The `car_data` feed gives one sample every 20–25 m at 300 km/h. The consequences:
  - Braking and lift points carry about ±20 m of uncertainty.
  - Minima can fall between samples, so apex speeds are an upper bound by a few km/h in short corners.
  - **Peak deceleration is a 0.27 s average** and is further smeared by the feed's speed smoothing. It reads 1–4 g where an F1 car's instantaneous peak from 300 km/h is higher. Treat it as a relative measure between drivers and corners, not as the car's peak.
  - Shift rpm is a lower bound.
  - `brake` is on/off only.
- **Distance from a speed integral.** Each lap's own distance drifts (5806–5885 m at Silverstone), and a frozen speed channel inflates it (OCO). The model replaces it with projected centreline distance, warped smoothly every 100 m, so local position errors of a few metres remain. The sector-line agreement (±5 m std) bounds them. A sim compared on a lap-fraction basis inherits up to about 10 m of local misplacement; use `basis: "driver:XXX"` or a model-axis trace when that matters.
- **X/Y noise.** The location feed has about 1–2 m of noise and 0.1 m quantisation. As a result:
  - Lateral acceleration needs 0.3 s smoothing, which lowers short peaks (Abbey, Copse, Maggotts).
  - The effective radius has a std of 5–25 %.
  - The racing-line offset carries both noise and any residual rotation of the OSM fit.
- **Geometry.** The OSM centreline is a volunteer-mapped line. Its local kinks set the fast corners' geometric minimum radius, which is sensitive to σ (table above). A circuit without OSM uses the racing line itself, which is up to about 1 % shorter than the official centre line.
- **Definitions matter.**
  - Corner windows come from markers and heading change, so a combined complex (Vale–Club, Becketts) can split one speed minimum across two corners.
  - Straights are field full-throttle runs. One that crosses the timing line joins the end of one lap to the start of the same lap, and those are not consecutive in time.
  - Coasting is throttle under 5 % with the brake off. The feed has no energy channel, so lift-and-coast for harvesting cannot be told apart from a plain lift.
- **What the feed does not carry**: straight-mode (active aero) state, Overtake mode, ERS deployment, fuel, tyre temperature. The clipping table shows the effect of deployment, not the deployment itself.
- **Qualifying only for field statistics.** The eight Red Bull race laps are kept as traces (`race_laps`) for `compare()`, but they do not enter any mean.
