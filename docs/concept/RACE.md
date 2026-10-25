# PURPLE · concept race: the concept car on the game's 3D Silverstone

`/concept/race/?design=<base64url JSON Design>&ref=redbull` loads a concept design into Equation I's real 3D Silverstone and shows what
its numbers mean. Four modes, each labelled on screen with its source:

| Mode | What drives the cars | Times are | Label |
|---|---|---|---|
| **Qualifying lap** (`?mode=quali`; the demo's "Watch the lap on Silverstone" opens it) | every driver's best 2026 British GP qualifying lap (OpenF1 distance / time samples) + PURPLE (the best car's physics-sim trace) + the RB22 baseline sim, replayed kinematically on ONE clock from the same line (ghost laps) | real laps: the classified time (js/data/racepace2026.js, the demo leaderboard's source); PURPLE / RB22: physics-sim seconds | "real 2026 qualifying · OpenF1" / "physics lap sim · model prediction"; "all laps start together; no overtaking or traffic is modelled" |
| **Physics replay** (default) | the physics lap sim's own speed trace (`concept/sim` `simulateLap`), replayed kinematically | physics-sim seconds | "physics lap sim · Silverstone · <conditions>" |
| **Game race** | the game's AI + game lap model, concept (candidate) vs the team baseline, `?lab=1` broadcast race | game seconds | "cinematic — game lap model, mixes car and driver" |
| **2026 grid** | the game's AI + game lap model, the concept aero on HAD's RB22 in the real 2026 field (`?lab=1&mode=grid`) | game seconds | same |

## URL contract

```
/concept/race/?design=<base64url JSON Design>          (optional; missing or "baseline" = the ref team's baseline design)
               &ref=redbull                             (redbull | generic: the reference ghost, baselineCar(ref) in the sim)
               [&conditions=<base64url JSON>]           (merged over the sim's 2026 British GP qualifying conditions)
               [&wind_ms=3&wind_from_deg=105]           (shortcuts; also air_temp_c, air_pressure_hpa)
               [&mode=replay|quali|race|grid] [&rate=1] (start mode; replay playback speed 0.25-32)
               [&lap=87.700]                            (the engine's lap for the design: the quali mode checks the re-run against it)
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
   Independent check: ∫ds/v over the trace's speeds agrees within a few ms (g37.4: 88.297 s against the sim's 88.294 s).
   The pole ghost uses OpenF1's own clock, which ends at 88.111 s = the official lap.
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
6. **Car models.** The concept car and the RB22 ghost are `EI.conceptView.buildCar(design, { lod })` (docs/concept/VIEW.md; view v3:
   built procedurally from the design parameters at true dimensions), placed in the game car's group (same frame: +x forward, +y up,
   +z right, ground y = 0), Straight Mode flaps driven by the sim's aero mode with a 400 ms swing. Its clear-coat paint takes the
   game's own paint level (envMapIntensity 0.62) under the game's sky. The ghost's materials are cloned and translucent. The pole ghost
   is the game's GLB car in Mercedes livery, forced to its one-draw-call LOD and translucent. Wheels are not animated on the buildCar
   bodies. If `buildCar` is missing or fails, the game's car stays (warning in the console). With the flag, `js/conceptrace.js` loads
   `concept/{regs,materials,parts,aeromap,design}.js` and `concept/view/{mesh3d,car3d,parts3d,view3d}.js`.

## Qualifying lap: how it works (truthful to the numbers)

`payload.qualiPayload(replayPayload, { lap_s, racepace, season, telemetry, deleted })` builds it from the physics-replay payload (same
sim run, same line) and the 22 OpenF1 lap files `concept/data/telemetry/silverstone-2026-q-<code>.json`:

- **Real cars**: each driver's own distance / time samples; the distance axis is scaled onto the sim's line (each lap's own length,
  5806-5885 m, onto 5824.6 m) and the clock onto the **classified time** from `js/data/racepace2026.js` (the demo leaderboard), so the
  last sample is exactly (L, lap). 19 of 22 OpenF1 clocks end on the classified time already; RUS (+3 ms), OCO (+5 ms) and PER are
  flagged "time-scaled". PER: racepace2026 / the demo board list 91.451, which OpenF1 lists as deleted by race control; his OpenF1
  best valid lap is 91.940, so his trace is time-scaled to 91.451 and the tower says so (the order is the same either way: P21).
  A driver without telemetry would drive the pole lap's profile scaled to his time (label "ANT profile, time-scaled"); none today.
- **PURPLE**: the best car's physics-sim trace from the URL's design, ending at its sim lap. `&lap=` carries the lap the demo shows;
  if a re-run ever differs by > 0.5 ms the trace is time-scaled to the engine's lap and the banner says so (today: 87.700 = 87.700).
  **RB22**: the baseline sim (88.745), a ghost without a position, shown only when it differs from PURPLE (as on the demo board).
- **One clock**: every car crosses the control line at t = 0 (2 s run-up = the end of its own lap); the finish is solved exactly
  inside the replay step (`crossingExact`: bisection of the car's distance function), so each measured finish equals its source
  lap to < 1 ms at any playback rate. Finish order = `payload.boardRows` (the function the demo board now uses): time, ties PURPLE →
  RB22 → real. The tower beside the view ranks by distance covered while the lap runs, then by measured finish, and checks the
  finish order against the demo board at the end.
- **Same sim as the engine**: the engine runs in Node, where `fit.js derivedOverrides()` reads the RB22 anchor's measured gear
  ratios, mass (775 kg sheet) and roll-stiffness split from `concept/data/*.json` with fs. The browser could not, so before this
  change the race page lapped the demo's best car in **87.815 s against the engine's 87.700 s** (and any design that moves the
  gearbox or roll split differed). `concept/sim/team-overrides.js` (generated by `concept/sim/build-team-overrides.js`; a test
  fails on drift) now carries those overrides to the browser; the race page loads it before `fit.js`. Browser = Node = 87.700.
  The concept lab page does not load it yet (its in-browser optimiser still runs the older anchor; integrator's call).
- **No F1 / FIA marks**: with `?concept=1` the loading splash's F1 logo and championship line are removed and the trackside F1 logo
  boards draw nothing (EI.Ads painter wrapped from js/conceptrace.js; that page load only).

Test: `test/concept-race-quali.test.js` (finish within 1 ms at 1x / 4x / 16x, order = demo board, missing-telemetry path, lap
mismatch path, URL). Screenshots: `docs/concept/dashboard-shots/race-*.png`.

## Game race (cinematic)

`payload.cinematic()` maps the design's PhysicalCar onto the game's per-car multipliers with the bench's `v0Multipliers` (the team
baseline maps to exactly 1.0) and loads `index.html?lab=1&…&mult_baseline=…&mult_candidate=…` (race) or `…&mode=grid&driver=HAD`
(grid). Only `{ df, cd, a0, b0 }` reach the game: mass, power and Straight Mode deltas do not (sim v0 folds them into its own lap
model; the game's car cannot take them). The race posts `purple:result` / `purple:grid` to the page, shown as game seconds with the
cinematic label. In race mode the two cars keep the lab's liveries (baseline Williams blue, candidate McLaren orange).

## Drive it yourself (time trial) and Race the grid (the visitor drives)

Two more tabs, `?mode=drive` and `?mode=racegrid`, plus a **"Drive it yourself →"** button in the stage header of the Qualifying lap
(and Physics replay) view. Link from the concept lab (integrator: the lab is not this helper's file) with
`EI.concept.race.url(bestDesign, { base: "../race/", ref: "redbull", mode: "drive", lap_s: bestLap })`
→ `/concept/race/?design=…&ref=redbull&mode=drive&lap=87.700` (or `mode: "racegrid"`).

| Mode | Who drives | Times are | Label |
|---|---|---|---|
| **Drive it** (`drive`) | the visitor (keyboard W A S D / arrows, Shift Straight Mode, Space ERS, C camera; the game's touch buttons and gamepad as in the game), game car physics with the design's v0 multipliers | game seconds at the sim's control line; ghosts: physics-sim / OpenF1 seconds on the same clock | "game handling model: your lap mixes the car with your driving; the sim lap is the physics lap sim · model prediction" |
| **Race the grid** (`racegrid`) | the visitor vs the game's 21 AI drivers (Official level: pace from each driver's real 2026 qualifying time), 3 laps, the player in Hadjar's RB22 seat | game seconds (the game's own timing at the painted line) | "game race · AI pace scaled to real 2026 qualifying times · your car uses the optimised design's aero and mass; not a prediction of a real race" |

- **The player's car** (both modes): the game's car (`js/car.js` physics, unchanged) with `car.aero` = the design's
  `bench.v0Multipliers(physical).mult` `{ df, cd, a0, b0 }`: the same mapping the Game race mode uses (mass folded into `df` via
  the mass ratio, tyre load sensitivity into `a0` / `b0`; power and Straight Mode deltas do not reach the game car). Its body is the
  design's own (`EI.conceptView.buildCar`, RB22 livery as in the Qualifying lap mode: there is no separate PURPLE livery); wheels
  of that body are not animated; the cockpit camera shows no cockpit.
- **Time trial**: rolling start where PURPLE's sim lap is 4 s before the sim's control line, at its speed, after a 3-2-1 freeze. Each
  lap is timed at that control line (game s 84.6, the line the ghosts are timed at); ghosts restart from the line with every lap the
  visitor starts (classic time-trial ghosts), so all share one clock: **PURPLE · sim** (the design's physics-sim trace, ending at
  exactly the URL's `&lap`; time-scaled to it and flagged if a re-run differs by > 0.5 ms), **ANT · pole** (OpenF1, ending at exactly
  88.111 s) and **RB22 · sim** (88.745). Live delta to each ghost at your position (game s → sim s by inverting the line mapping).
  Track limits as the game's stewards judge them (no part of the car on the track for 0.12 s) mark the lap "track limits": it is not
  a best. Result card over the view: "your lap X.XXX s · physics sim of this car 87.700 s · real pole 88.111 s", deltas, **Drive
  again** (rolling start) and **Back to the engineer** (`../lab/`); the best per design + lap is kept in `localStorage`
  (`purple-drive-best:<id>:<lap>`, try/catch).
- **Game seconds vs real seconds**: the game's Official AI laps the real 2026 times on this clock (js/ai.js calibration), while the
  game car at its limit laps 80.8 s (LIMIT_LAP): a skilled player in the game car can beat the real pole. The label says the lap
  mixes the car with the driving; it is a ghost comparison, not a prediction.
- **Race the grid**: `startRace({ players: [PURPLE in Red Bull seat HAD], bots: 21, difficulty: 'official', laps: 3 })`, then the grid
  is re-ordered (`race.placeGrid`) by real 2026 British GP qualifying (`js/data/racepace2026.js`) with PURPLE inserted **by its sim
  lap** (87.700 → P1; ties PURPLE first, as the demo board). Lights, rules, timing tower (F1 logo hidden), toasts and touch buttons
  are the game's. At the flag the page shows position, lap times, best lap and the top 5 (`purple:drive-finish`, again when
  classified). AI cars run mediums, as in every game race.
- **Game hooks**: all in `js/conceptrace.js` behind `?concept=1&drive=trial|grid` (never with `?lab=1`); `index.html`, `main.js`,
  `race.js`, `car.js`, `ai.js` unchanged. The time trial swaps `race.cars` to the player only around the game's own `race.update`
  (ghosts are drawn but never in physics, collisions or positions); Esc / P pause and R restart are this page's, every other key is
  the game's. Messages: game → page `purple:drive-lap`, `purple:drive-finish`, `purple:drive-state` (2 Hz); page → game the payload
  (`mode: "drive"`, `kind: "trial" | "grid"`) and `purple:concept-cmd` (`restart`, `pause`, `cam`).
- Code: `concept/race/drive.js` (payloads, result cards, grid order, best-lap storage), `concept/race/race.js` (tabs, card, panel),
  `js/conceptrace.js` (the runtime). Test: `test/concept-race-drive.test.js` (card numbers = URL lap / 88.111, ghosts finish at their
  laps, multipliers = Game race mapping, grid order, storage, flag gating in a sandbox page, honest words). Shots:
  `docs/concept/dashboard-shots/drive-*.png` (laps there are driven by the game's own AI at the player's wheel, fast-forwarded, as
  headless Chromium cannot be steered by hand).

## Game hooks (opt-in)

- `index.html`: `<script src="js/conceptrace.js">` before `main.js`. Without `?concept=1` the file only defines `EI.ConceptRace`
  (helpers, `active: false`).
- `js/main.js`: `const CONCEPT = !LAB && EI.ConceptRace && EI.ConceptRace.active ? EI.ConceptRace : null;` and, in `hideLoading`,
  `else if (CONCEPT) CONCEPT.start(EI.debug);`. Nothing else in the game changed; `?lab=1` takes precedence.
- With the flag, `js/conceptrace.js` loads the design layer and the view scripts for `buildCar`, hides
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

## Verification (2026-10-24, headless Chromium / SwiftShader at ~2 fps, playback 16x, `docs/concept/race-shots/`)

| Run | sim lap | replay finish (clock) | Δ | console errors |
|---|---|---|---|---|
| optimised design g37.4 (`node concept/cli.js --gens 40 --seed 7 --baseline redbull --sim physics`, view v3 body) | 88.294 | 88.294 | 0.000 | 0 |
| ↳ RB22 ghost (sim, `baselineCar("redbull")`) | 88.747 | 88.747 | 0.000 | |
| ↳ ANT pole ghost (real, OpenF1) | 88.111 | 88.109 | −0.002 | |

Earlier in the session (view v2, sim before the v2 merge) the RB22 baseline design (`?design` omitted) replayed 88.750 / 88.750 and an
optimised design 88.086 / 88.086, both with 0 console errors. After the merge that older optimised design is illegal under the
tightened front-wing check (REG-C-FW-PROFILES-Z) and the page refuses it with the violation in the banner, as intended.
The pole ghost's few-ms difference is the replay's linear interpolation inside one 16x step across the telemetry's speed jump at the
line (ANT lifted before the line: 247 km/h at the end of the lap, 267 km/h at its start). Both concept bodies came from
`EI.conceptView.buildCar` (`EI.ConceptRace.bodies` = 2). Plain `/` with no flag: menu shown, `EI.ConceptRace.active === false`, no
concept HUD, 0 console errors. `?lab=1` broadcast race (seed 7, 1 lap, multipliers ×1 vs { df 1.05, cd 1.02 }): fast-forwarded through the
game's own `race.update` and posted by the real render loop, the `purple:result` from this branch is **byte-identical** to the one
from the integration head's `index.html` + `main.js` (served side by side; baseline 84.362 s, candidate 85.444 s game seconds;
vmax / vmin null on both because the fast-forward skips main.js's per-step sampler). `?lab=1&mode=grid&driver=HAD` (the 2026 grid
cinematic) starts racing with 0 console errors (`cinematic-grid.jpg`). Shots: `v3best-*` (optimised design g37.4 with the view v3 body: chase on the Hamilton Straight, TV, T-cam on the Hangar Straight
in Straight Mode, the finish), `cinematic-grid` (the 2026 grid mode), `check-plain-game-menu`.

Tests: `test/concept-race.test.js` (payload, legality, URL round trip, wind, mapping on the game's geometry, replay clock, hooks
opt-in, honesty words).

## Limits

- The sim's racing line is one averaged path for every car; in 12 % of samples it leaves the game's modelled asphalt and is pulled in
  (≤ 4.5 m). The game's track is the OSM centreline at a constant 15 m width.
- The replay is kinematic: body roll / pitch come from the trace's accelerations, steering from path curvature; no tyre or suspension
  model is drawn.
- Headless SwiftShader renders the scene at well under 1 fps; on a laptop GPU the game's own frame rate applies.
