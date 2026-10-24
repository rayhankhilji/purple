# PURPLE · concept race: the concept car on the game's 3D Silverstone

`/concept/race/?design=<base64url JSON Design>&ref=redbull` loads a concept design into Equation I's real 3D Silverstone and shows what
its numbers mean. Two modes, each labelled on screen with its source:

| Mode | What drives the cars | Times are | Label |
|---|---|---|---|
| **Physics replay** (default) | the physics lap sim's own speed trace (`concept/sim` `simulateLap`), replayed kinematically | physics-sim seconds | "physics lap sim · Silverstone · <conditions>" |
| **Game race** | the game's AI + game lap model, concept (candidate) vs the team baseline, `?lab=1` broadcast race | game seconds | "cinematic — game lap model, mixes car and driver" |
| **2026 grid** | the game's AI + game lap model, the concept aero on HAD's RB22 in the real 2026 field (`?lab=1&mode=grid`) | game seconds | same |

## URL contract

```
/concept/race/?design=<base64url JSON Design>          (optional; missing or "baseline" = the ref team's baseline design)
               &ref=redbull                             (redbull | generic: the reference ghost, baselineCar(ref) in the sim)
               [&conditions=<base64url JSON>]           (merged over the sim's 2026 British GP qualifying conditions)
               [&wind_ms=3&wind_from_deg=105]           (shortcuts; also air_temp_c, air_pressure_hpa)
               [&mode=replay|race|grid] [&rate=1]       (start mode; replay playback speed 0.25-32)
```

base64url = standard base64 with `-` / `_`, no padding, of the UTF-8 JSON. The Design needs `params` (+ `team`, `overrides`, `id`,
`label`, `livery`, `driver` when present). **For the concept lab's "Watch it on Silverstone" link** use the helper rather than
building the string:

```html
<script src="../race/payload.js"></script>   <!-- after design.js / bench.js; needs nothing else to build a URL -->
```
```js
a.href = EI.concept.race.url(bestDesign, { base: "../race/", ref: "redbull" });   // + conditions: {...} when the lab has wind
```

Illegal designs get no lap (same rule as the lab) and the page says so; malformed parameters are reported in the banner.

## Physics replay: how it works

1. **The page** (`concept/race/index.html`, `race.js`, `payload.js`) loads the sim and the design layer like the concept lab and runs,
   for the design: `bench.bench(d, { sim: "physics", objective: "quali", conditions })` (legality + the lap the lab shows) and
   `simulateLap(bench.guardEnergy(physical), "silverstone", conditions, { trace: true, debug: true })` (the same lap, traced; the
   test asserts the two lap times are identical). The reference ghost is `simulateLap(guardEnergy(baselineCar("redbull")))`. The
   real pole lap is `concept/data/telemetry/silverstone-2026-q-ant.json` (ANT 88.111 s, OpenF1 car_data on a 5 m grid).
2. **Time per sample** is the sim's own forward-pass clock (`debug.tAt`, shifted to the control line); last sample `(L, lap_s)`.
   Independent check: ∫ds/v over the trace's speeds gives 88.751 s for the RB22 (sim 88.749) and 88.088 s for the optimised design
   (sim 88.085). The pole ghost uses OpenF1's own clock, which ends at 88.111 s = the official lap.
3. **The game view** is `index.html?concept=1&track=silverstone` in an iframe. `js/conceptrace.js` receives the payload by
   `postMessage` (same origin, from the parent only), builds three cars with the lab grid builder, then **replaces `race.update` on
   that race instance**: every 120 Hz step sets each car's position, heading, speed, gear, rpm, Straight Mode flap and ERS state
   from its trace at the replay clock. No AI, no car physics, no game timing. Clock = sim seconds × playback rate. Laps repeat;
   a 2 s run-up (the end of the identical previous lap) precedes the control line.
4. **Mapping (sim distance → game track).** The sim's racing line is OpenF1 X/Y mapped into the OSM frame of `js/data/silverstone.js`,
   which is also the game's world frame. Each line sample is projected onto the game's centreline (game s, lateral offset); the
   offset is clamped to ±6.4 m (asphalt half width − 1.1 m) where the averaged telemetry line leaves the game's 15 m track. The car is
   drawn there; the sim's distance and time are kept. Measured (Node test and the browser agree):

   | Mapping error | value |
   |---|---|
   | drawn car vs the sim's line point, RMS / max | **0.62 m / 4.52 m** |
   | line samples pulled onto the asphalt | 12 % |
   | sim line off the game centreline, RMS / max (a racing line, not an error) | 4.38 / 10.93 m |
   | game s vs a linear scale of sim s (start aligned, scaled by length), RMS / max | 4.44 / 11.51 m |
   | lengths: sim line / game centreline | 5824.6 / 5881.2 m (× 1.00973) |
   | sim control line (OpenF1 timing line) in game s / game painted start line | 84.6 m / 260 m (175 m apart) |

   Laps are timed at the sim's control line, not the game's painted start line.
5. **HUD** (in the game view): timing tower (gap = time the car ahead needed to reach this car's distance), speed, gear, Straight /
   Corner mode (the sim's per-sample `aero_mode`), ERS state, the lap clock, the sim's sector times as the car crosses each line
   (purple = quickest of the three), live delta to each ghost at the concept car's distance, car tags, camera / speed keys
   (C camera, A director, Space pause, R replay, 1 2 4 8 speed). A broadcast "director" cuts between the game's TV, chase and T-cams.
   ERS state is **derived** from the sim's threshold strategy (deploy below v\*, superclip above it when the lap superclips, harvest
   where the car slows): the sim reports v\* and the totals, not a per-sample flag; the tooltip and the car panel say so. The pole
   ghost has no aero / ERS channel (OpenF1 carries neither).
6. **Car models.** The concept car and the RB22 ghost are `EI.conceptView.buildCar(design, { lod })` (docs/concept/VIEW.md: the
   game's car deformed and rebuilt from the design parameters), placed in the game car's group (same frame), Straight Mode flaps
   driven by the sim's aero mode with a 400 ms swing. The ghost's materials are cloned and translucent. The pole ghost is the game's
   GLB car in Mercedes livery, forced to its one-draw-call LOD and translucent. Wheels do not turn on the buildCar bodies (static
   mesh). If `buildCar` is missing or fails, the game's car stays (warning in the console).

## Game race (cinematic)

`payload.cinematic()` maps the design's PhysicalCar onto the game's per-car multipliers with the bench's `v0Multipliers` (the team
baseline maps to exactly 1.0) and loads `index.html?lab=1&…&mult_baseline=…&mult_candidate=…` (race) or `…&mode=grid&driver=HAD`
(grid). Only `{ df, cd, a0, b0 }` reach the game: mass, power and Straight Mode deltas do not (sim v0 folds them into its own lap
model; the game's car cannot take them). The race posts `purple:result` / `purple:grid` to the page, shown as game seconds with the
cinematic label. In race mode the two cars keep the lab's liveries (baseline Williams blue, candidate McLaren orange).

## Game hooks (opt-in)

- `index.html`: `<script src="js/conceptrace.js">` before `main.js`. Without `?concept=1` the file only defines `EI.ConceptRace`
  (helpers, `active: false`).
- `js/main.js`: `const CONCEPT = !LAB && EI.ConceptRace && EI.ConceptRace.active ? EI.ConceptRace : null;` and, in `hideLoading`,
  `else if (CONCEPT) CONCEPT.start(EI.debug);`. Nothing else in the game changed; `?lab=1` takes precedence.
- With the flag, `js/conceptrace.js` loads `concept/{regs,parts,aeromap,design}.js` + `concept/view/view3d.js` for `buildCar`, hides
  the game's menu / HUD panels, and takes the keys it uses (so the game's pause menu or R-restart cannot start an AI race).

## Messages

| Direction | type | content |
|---|---|---|
| game → page | `purple:concept-ready` | scene built, send the payload |
| page → game | `purple:concept-race` | `{ payload }` (cars with s/t/v/gear/rpm/aero/ers, the line, timing, labels) |
| game → page | `purple:concept-started` | mapping stats |
| game → page | `purple:concept-state` | 2 Hz: clock, rate, camera, distances |
| game → page | `purple:concept-finish` | each car's sim lap, replay finish (clock), difference |
| page → game | `purple:concept-cmd` | `restart`, `pause`, `rate` (value), `cam` (`auto`, `tv`, `chase`, `tcam`) |

## Verification (2026-10-24, headless Chromium / SwiftShader at ~2-3 fps, playback 16x, `docs/concept/race-shots/`)

| Run | sim lap | replay finish (clock) | Δ | console errors |
|---|---|---|---|---|
| optimised design g39.4 (`node concept/cli.js --gens 40 --seed 7 --baseline redbull --sim physics`) | 88.086 | 88.086 | 0.000 | 0 |
| ↳ RB22 ghost (sim) | 88.750 | 88.750 | 0.000 | |
| ↳ ANT pole ghost (real, OpenF1) | 88.111 | 88.108 | −0.003 | |
| RB22 baseline design (`?design` omitted) | 88.750 | 88.750 | 0.000 | 0 |
| ↳ ANT pole ghost | 88.111 | 88.109 | −0.002 | |

The pole ghost's few-ms difference is the replay's linear interpolation inside one 16x step across the telemetry's speed jump at the
line (ANT lifted before the line: 247 km/h at the end of the lap, 267 km/h at its start). Both concept bodies came from
`EI.conceptView.buildCar` (`EI.ConceptRace.bodies` = 2). Plain `/` with no flag: menu shown, `EI.ConceptRace.active === false`, no
concept HUD, 0 console errors. Shots: `best-*` (optimised design: chase at the Loop, TV at Brooklands, chase after Copse, T-cam on the
Hangar Straight in Straight Mode, the finish), `baseline-*`, `cinematic-grid` (the 2026 grid mode), `check-plain-game-menu`.

Tests: `test/concept-race.test.js` (payload, legality, URL round trip, wind, mapping on the game's geometry, replay clock, hooks
opt-in, honesty words).

## Limits

- The sim's racing line is one averaged path for every car; in 12 % of samples it leaves the game's modelled asphalt and is pulled in
  (≤ 4.5 m). The game's track is the OSM centreline at a constant 15 m width.
- The replay is kinematic: body roll / pitch come from the trace's accelerations, steering from path curvature; no tyre or suspension
  model is drawn.
- Headless SwiftShader renders the scene at well under 1 fps; on a laptop GPU the game's own frame rate applies.
