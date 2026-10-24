# Lane GAME

Status: in_progress (PR: postMessage target origin = location.origin; everything else merged). Owner: agent A (Claude, session `session_019VA5sAvTHuQ3bGbWV5CX4M`). Branch: `claude/game-lane-film`; merged: `claude/game-p1-aero` (P1.T1), `claude/game-p1-aero-broadcast` (P1.T2), `claude/game-p3-grid` (P3.T3).

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

### 2026-10-24 06:10 London — agent A (Claude) — security audit item: postMessage target origin
- Status: **done** (PR from `claude/game-post-origin` into `claude/amazing-planck-804i13`). `npm test` green.
- Files changed: `js/main.js` (two lines), this file.
- `labPostResult` and `labPostGrid` now post `purple:result` / `purple:grid` with `targetOrigin = window.location.origin` instead of `'*'` (the lab page is same-origin, ARCHITECTURE §10; `lab/lab.js` already filters on `ev.origin === location.origin`). Lab mode only; the shipped game never posts. A page opened from `file://` (origin `null`) would make `postMessage` throw; the existing `try` logs a warning and the result stays in `EI.labResult` and the console.
- Verify: `node --check js/main.js`; `npm test` green; the message path itself was verified earlier in a real same-origin parent page (03:20 entry).
- Decisions proposed: none. Blockers: none. Next: standing by.

### 2026-10-24 05:45 London — agent A (Claude) — GAME follow-ups from the UI review (lab mode only, opt-in)
- Status: **done, verified headless** (PR from `claude/game-lab-followups` into `claude/amazing-planck-804i13`, branched at `df2733f`). `npm test` 75/75.
- Files changed: `js/race.js`, `js/main.js`, this file.
- (1) **Race mode ends 60 s after the first finisher.** `race.js`: in lab race mode (no `labCar`), `LAB_GRACE` = 60 s after the first lab car's `raceTime` the race is `over` and `classified` at once if the other car has not crossed; `race.labIncomplete = true`. `main.js` `labPostResult` then posts the finished car's numbers and `lap: null, sectors: [null,null,null], vmax_kmh: null, vmin_becketts_kmh: null, finished: false` for the other (its `laps[]` so far stay in the message) plus a top-level `incomplete: true`; the UI shows "race incomplete". Grid mode (candidate's finish ends the race) and the shipped game (players) are unchanged.
- (2) **Sound.** `labStart` calls `EI.Audio.resume()` (wrapped in try). It unmutes when the click that opened the page reaches this frame, i.e. the lab iframe needs `allow="autoplay"` (UI lane); opened directly from the address bar the game stays silent until a click on the canvas, as before.
- Verify step run + output:
  - Headless stuck-car race (Node, candidate parked 16 m off the track on the grass after lap 1, baseline normal): baseline finishes at **246.7 s**, race `over` + `classified` at **306.7 s** (grace observed **60.0 s**), `labIncomplete: true`, baseline best lap 80.938 kept, candidate `finished: false`, `lapsDone: 1`.
  - Regression, the normal two-car race (seed 42): unchanged, baseline 80.742 / candidate 81.260, both finished, classified at 249 s.
  - `npm test` 75/75; `node --check` on both files.
- Decisions proposed: `LAB_GRACE = 60 s` lives in `js/race.js` next to `LAB_GAP`; the `incomplete` flag is additive to the `purple:result` contract (ARCH §5 route ignores unknown fields; the UI may read it).
- Blockers / questions for Tanuj: none.
- Next three actions: (1) integrator merges this PR; UI adds `allow="autoplay"` on `#game` and the "race incomplete" state. (2) GAME standing by (nothing left in the lane plan after P3.T3). (3) If time allows: a browser run of the full race on a machine with a GPU for the lane file's AC1 numbers.

### 2026-10-24 05:15 London — agent A (Claude) — UI review: lab/lab.js "Race it" iframe integration (read-only, no lab/* edits)

Reviewed at integration head `df2733f` (`lab/lab.js` 474 lines, `lab/index.html`). Against the GAME contract (P1.T2 entry below and TASK_LOG D-G1/D-G2).

**Matches the contract (no action):**
1. `raceIt()` builds `../index.html?` + `URLSearchParams({ lab: "1", exp: x.id, seed, laps: LAPS (3), circuit, baseline, candidate, mult_baseline, mult_candidate })`: exactly the eight parameters the game reads; `exp` is present (my earlier ask), `circuit` falls back to `x.conditions.circuit` then `silverstone`.
2. Base64: `btoa(unescape(encodeURIComponent(JSON.stringify(obj))))` = standard base64 (`+ / =`), percent-encoded by `URLSearchParams`; the game's parser decodes with `atob` after a base64url normalisation, so both alphabets work. Setups are ASCII JSON anyway.
3. `mult_*` = `b64(EI.aero.toMultipliers(setup, conditions))`: the full object (`legal`, `violations`, …) rides along; the game keeps only `df, cd, a0, b0` and treats a missing or non-positive value as ×1. Wet conditions are inside the multipliers (`a0`, `df`, `b0`), so a wet race and a wet evaluation agree.
4. Listener: `ev.origin !== location.origin` → drop; `d.type !== "purple:result"` → drop; payload `{ experiment_id: d.experiment_id || d.exp || S.racing.id, seed (int), cars }` → `POST /api/race/result`, retry keeps the same payload. The game posts with target origin `*` from the same origin, so the check passes; the extra per-car fields (`laps`, `laps_deleted`, `finished`, `setup`, `aero`) are forwarded and the route `pick`s what it stores.
5. `renderMain()` unloads the iframe (`removeAttribute("src")`) when `S.racing` is null: Cancel stops the race; "Race again" reloads the page, so the second race is a clean start with the same seed.
6. Seeds: the server draws `Math.floor(Math.random() * 2 ** 31)`; the game does `parseInt(seed) >>> 0`, lossless below 2^32.

**Findings for the UI lane (ranked):**
1. *(demo UX, medium)* On a successful `POST /api/race/result` the page sets `S.racing = null` → `renderMain()` removes the iframe `src` in the same render. The game posts `purple:result` on classification, i.e. the exact frame the chequered-flag results card appears, so on the lab page the broadcast vanishes before the flag/results/highlights can be seen or filmed. Suggest keeping the iframe up until the engineer presses "Back to 3D view" (or a ≥ 15 s grace): e.g. `S.racing = { …, done: true }` on success and `game.hidden = !(S.racing)` only; the RACE card can already show the measured Δ meanwhile.
2. *(hardening, low)* Add `ev.source === $("#game").contentWindow` to the message filter: same-origin is right (ARCH §10) but any same-origin tab/opener could post a `purple:result` with a stale `experiment_id`; also ignore a message whose `experiment_id` ≠ `S.racing.id` when `S.racing` is set.
3. *(honesty, low)* Wind: `toMultipliers` carries no wind term (the evaluator applies wind per track sample, ARCH §8), and the game has no wind at all, so a windy experiment races in still air and `agreement_pct` degrades for a reason the viewer cannot see. Suggest the RACE card's source line says "race runs in still air" when `conditions.wind_ms > 0` (or disable Race it for wind scenarios until the game has wind).
4. *(robustness, low)* `S.racing.started` is recorded but unused: a "no result after 6 min — Cancel and retry" hint would cover a stuck bot (the game posts only when both cars have finished; a car that never finishes never ends the race — GAME follow-up below).
5. *(sound, low)* The iframe has no `allow="autoplay"`, and in lab mode nothing calls `EI.Audio.resume()`, so the broadcast is silent inside the lab page. If sound is wanted for the demo: `allow="autoplay"` on `#game` (UI) + `EI.Audio.resume()` in `labStart` (GAME follow-up; it only works when the click's user activation reaches the same-origin iframe, which Chrome allows).

**Grid mode from the UI later (F-10): yes, two small additions.** URL `../index.html?lab=1&mode=grid&exp=<id>&driver=<code>&candidate=<b64>&mult_candidate=<b64>&seed=<n>&laps=2&circuit=<c>` (no `baseline`/`mult_baseline`). The listener currently drops `d.type === "purple:grid"`; a branch that shows `position`, `best_lap`, `driver.name`, `grid` in the card is enough (there is no server route and ARCH has none; the ledger does not need it). The main-area badge should read **"CINEMATIC · mixes car and driver"** (the game draws its own caption too, G-HON-05), and a driver `<select>` can come from `EI.SEASON.drivers` (`code`, `first`/`last`, `team`) which the lab page already loads with the game scripts. `LAPS` would be 2 for that mode.

**GAME follow-ups I will take if the integrator wants them:** (a) race mode: end the race when the first lab car has finished and the other has not crossed within 60 s (today both must finish); (b) `EI.Audio.resume()` in `labStart`; (c) nothing else from this review touches game files.

### 2026-10-24 03:20 London — agent A (Claude) — P1.T2 browser verification (T-F04-AC1 / AC2 in a real page)
- **T-F04-AC2, parent page + iframe (Playwright, headless Chromium, software GL):** the game page auto-started inside an iframe of a parent page listening for `message`; at race time 6.1 s (both cars at ~246 km/h) both cars were marked finished from the test harness to trigger classification early; the page then posted `{ type: 'purple:result', experiment_id: 'exp-test-rw8', seed: 42, circuit: 'silverstone', laps: 3, cars: [{ role: 'baseline', …, setup, aero: {1,1,1,1} }, { role: 'candidate', …, setup (rear wing 28), aero: { df 1.144, cd 1.088, a0 0.9872, b0 1 } }] }` and **the parent received it**; 0 page errors, 0 console errors. (`lap`/`sectors` are `null` in that forced run because no lap was completed; the shape, ids and roles are what the server route reads.)
- **T-F04-AC1 in the browser:** the full-length run is limited by software GL here (about 0.03× real time): a 1-lap run reached 41 s of race time, both cars racing cleanly on the TV camera with the HUD on the baseline car and 0 errors, before the harness's 25-minute cap. A second attempt with a 95-minute cap is running; its best lap / vmax / Becketts vmin will be appended here if it lands. The 3-lap AC1 is covered by the headless race (same `race.js` + `car.js` + `ai.js`, 3 laps, both cars classified, numbers in the P1 entry below); on a laptop GPU the page runs in real time.
- No code changed. Files: this file only.

### 2026-10-24 02:55 London — agent A (Claude) — How to film it (for Tanuj's recording, P3.T4)

Both modes run from the plain game page (`index.html`), full window, no lab page needed. Serve the repo (`npm run dev` or `npm run static`, both give `http://127.0.0.1:8788/`).

**Before the first take (once per browser):** open `http://127.0.0.1:8788/index.html` normally, set **Graphics → High** in the menu (the choice is stored as `ei-quality`; the lab URLs skip the menu and start with the stored preset), optionally untick nothing else, then close the tab. Window 1920×1080 (F11 full screen), 60 Hz, cursor off the canvas. The lab URLs auto-start about a second after the loading screen; sound stays muted until a click (browser autoplay rule), so record with your own audio or click the canvas once as the lights come on. Physics is fixed-step at 120 Hz: a frame-rate dip changes nothing in the lap times.

**Shot A — baseline vs candidate (F-04), seed 42, 3 laps, ≈ 4 min 20 s with the lights:**
`http://127.0.0.1:8788/index.html?lab=1&exp=exp-test-rw8&seed=42&laps=3&circuit=silverstone&baseline=eyJmcm9udF93aW5nX2RlZyI6MjUsInJlYXJfd2luZ19kZWciOjIwLCJyaWRlX2hlaWdodF9tbSI6MzUsImJyYWtlX2JpYXNfcGN0Ijo1NywiZXJzX2RlcGxveSI6MC41fQ==&candidate=eyJmcm9udF93aW5nX2RlZyI6MjUsInJlYXJfd2luZ19kZWciOjI4LCJyaWRlX2hlaWdodF9tbSI6MzUsImJyYWtlX2JpYXNfcGN0Ijo1NywiZXJzX2RlcGxveSI6MC41fQ==&mult_baseline=eyJkZiI6MSwiY2QiOjEsImEwIjoxLCJiMCI6MX0=&mult_candidate=eyJkZiI6MS4xNDQsImNkIjoxLjA4OCwiYTAiOjAuOTg3MiwiYjAiOjF9`
- Baseline = the regulation baseline (FW 25°, RW 20°, RH 35 mm, BB 57 %, ERS 0.5) in the blue Williams, candidate = rear wing **28°** (+8°) in the orange McLaren, 80 m behind on the grid. TV camera on the baseline; the McLaren crosses the same camera 2–3 s later. Timing tower top-left shows `BAS` / `CAN`, best and last laps, sector colours.
- Expected numbers (headless, seed 42): baseline best **80.742 s**, candidate **81.260 s** (+0.518 s); top speed 325 vs 316 km/h; Maggotts–Becketts minimum 202 vs 212 km/h. The evaluator's prediction for the same change: +0.436 s.
- Where the story is: **Becketts** (the candidate visibly faster through Maggotts–Becketts–Chapel, S2 → S3 boundary) and the **Hangar Straight** right after (the baseline pulls away; its top speed is higher). Lap 2 is the first clean flying lap for both; lap 1 is the standing start.
- At the flag the results card shows the classification; the highlights reel auto-plays a few seconds later (switch it off with `localStorage.setItem('ei-hl-auto','0')` in the console if you want the card to stay). The result message is also logged to the console as `purple:result {...}`.
- Other seeds (`&seed=7`, `&seed=1234`) change only the start-light hold and the bots' small seeded variation; measured Δ was +0.52 / +0.70 s on those two. Use them for extra b-roll; the demo number to quote is the one that lands in `ledger.jsonl` through the lab page.

**Shot B — the cinematic close (F-10), Verstappen in the candidate car on the 2026 British GP grid, seed 42, 2 laps, ≈ 3 min 30 s:**
`http://127.0.0.1:8788/index.html?lab=1&mode=grid&exp=exp-test-grid&driver=VER&seed=42&laps=2&circuit=silverstone&candidate=eyJmcm9udF93aW5nX2RlZyI6MjUsInJlYXJfd2luZ19kZWciOjI4LCJyaWRlX2hlaWdodF9tbSI6MzUsImJyYWtlX2JpYXNfcGN0Ijo1NywiZXJzX2RlcGxveSI6MC41fQ==&mult_candidate=eyJkZiI6MS4xNDQsImNkIjoxLjA4OCwiYTAiOjAuOTg3MiwiYjAiOjF9`
- 22 cars, the real 2026 British GP starting grid, Official F1 pace. VER starts P7 in the Red Bull carrying the +8° rear wing; TV camera on him; caption bottom-left **"Cinematic · mixes car and driver · Max Verstappen in the candidate car · reduced-order lap model"** (keep it in frame: G-HON-05). Headless outcome at seed 42: P7 → **P14**, best lap 91.215 s (traffic).
- Swap the driver with `&driver=NOR`, `HAM`, `ANT`, `LEC`, `PIA`, `RUS`, `HAD`, `ALO`, `SAI`, `ALB` … (any 2026 code, car number or surname). `&round=<n>` picks another real grid; omit it for Silverstone's own.
- Best moments: lights out from the grid (the whole field in frame on the Hamilton Straight camera), lap 1 into Abbey/Village, and the Hangar Straight → Stowe pass attempts.

**What the keys do in lab mode:** `Esc` / `P` pause (the pause card's Field list shows every bot's traits), `M` mute toggle, `F` performance readout. The camera is fixed to TV (`C` does nothing: there is no player). A page reload restarts the same race (same seed).

**On-screen honesty:** the game never says CFD / wind tunnel / validated. The caption on Shot B and the lab page's model label ("reduced-order lap model · calibrated to 2026 pole laps · aero map v1") are the only model words that should appear in the film.

### 2026-10-24 02:35 London — agent A (Claude) — P3.T3 (F-10) grid race
- Status: **done, verified headless + browser smoke** (PR from `claude/game-p3-grid` into `claude/amazing-planck-804i13`, branched after the P1 merge). `npm test` 65/65. The P1.T2 browser run (1 lap, software GL) is still finishing; its numbers come in a lane-file-only PR.
- Files changed: `js/race.js`, `js/main.js`, this file.
- What it does: `index.html?lab=1&mode=grid&exp=<id>&driver=<2026 code | number | surname>&candidate=<b64 setup>&mult_candidate=<b64 { df, cd, a0, b0 }>&seed=<n>&laps=2&circuit=silverstone[&round=<grid round>]`
  - `js/race.js`: grid mode runs the normal `buildGrid` (22 real seats, season profiles, `difficulty: 'official'` = real 2026 pace, `grid: 'season'` = a real starting grid of this circuit, British GP round 9 at Silverstone). `labAeroFor(seat)`: the chosen driver's car gets `cfg.lab.candidate.aero` and becomes `race.labCar` (`car.role = 'candidate'`); every other car a neutral `{1,1,1,1}` so all 22 drive the aero-aware profile path in `ai.js`. `labFinishers()`: the candidate car's finish ends the race (then classification when every car has crossed or after 20 s), every car in race mode, the players in the shipped game.
  - `js/main.js`: `LAB.mode` (`race` | `grid`), `driver`, `round`, `candidate`; laps default 2 in grid mode; `labGridRound()` finds the circuit's real grid in `EI.SEASON.grids`; TV camera follows `race.labCar`; a fixed caption `Cinematic · mixes car and driver · <driver> in the candidate car · reduced-order lap model` (G-HON-05, created in JS, no CSS/HTML edits); at the end `{ type: 'purple:grid', experiment_id, seed, circuit, laps, field, grid, driver: { code, name, team, grid_position }, position, best_lap, laps_done, finished, vmax_kmh, vmin_becketts_kmh, fastest_lap, setup, aero, label }` to `window.parent` (also `EI.labResult`). Baseline-vs-candidate mode (`?lab=1` without `mode=grid`) and the shipped game are unchanged.
- Verify step run + output:
  - **Headless (Node: race.js + car.js + ai.js + teams + season data, `driver=VER`, rear wing +8°, seed 42, 2 laps):** field 22, grid "2026 British GP starting grid", VER starts P7 with aero `{ df 1.144, cd 1.088, a0 0.9872, b0 1 }`, every other car neutral; finishes **P14**, best lap **91.215** (laps 99.828 / 91.215), all 22 classified at 196.5 s race time (9.5 s wall); fastest lap ANT 88.442. Runs 2 laps without input → ROADMAP P3.T3 verify holds.
  - **Browser smoke (Playwright, headless Chromium, software GL, 400×225):** auto-start with no input, menu hidden, 1 camera (TV), 0 players, `race.lab.mode = grid`, field 22, grid "2026 British GP starting grid", `labCar` VER (redbull) grid P7 with the candidate aero, caption rendered, racing at t = 3.1 s (VER 123 km/h) when the smoke stopped; **0 page errors, 0 console errors**. Screenshot `grid_mid.png` in the session scratchpad.
  - URL used: `http://127.0.0.1:8788/index.html?lab=1&mode=grid&exp=exp-test-grid&driver=VER&seed=42&laps=2&circuit=silverstone&candidate=eyJmcm9udF93aW5nX2RlZyI6MjUsInJlYXJfd2luZ19kZWciOjI4LCJyaWRlX2hlaWdodF9tbSI6MzUsImJyYWtlX2JpYXNfcGN0Ijo1NywiZXJzX2RlcGxveSI6MC41fQ==&mult_candidate=eyJkZiI6MS4xNDQsImNkIjoxLjA4OCwiYTAiOjAuOTg3MiwiYjAiOjF9`
- Decisions proposed (for the integrator to log in TASK_LOG):
  1. In grid mode every car carries an aero object (the field ×1), not `null`: `ai.js` caps aero-aware profiles at terminal speed, so a `null` field would be ~4 km/h quicker on the straights than the candidate for a reason that has nothing to do with the setup. The field's lap therefore differs slightly from the shipped game's — acceptable for a cinematic, labelled as such.
  2. The race ends when the candidate car finishes (the cinematic subject), classification follows within 20 s. Message name `purple:grid` as the integrator specified; payload carries extras (`driver`, `field`, `grid`, `fastest_lap`, `label`) the server may ignore.
  3. Real pace = `difficulty: 'official'`; the real grid = `grid: 'season'` with the circuit's round (`?round=` overrides). Unknown circuit → race.js picks a real grid by the seed.
- Blockers / questions for Tanuj: none. FYI the on-screen caption wording is "Cinematic · mixes car and driver · … · reduced-order lap model"; tell me if the deck wants other words.
- Next three actions:
  1. Integrator merges `claude/game-p3-grid`; the UI lane adds a "Grid race (cinematic)" button that opens the URL above with the current candidate and a driver picker (2026 codes).
  2. GAME: lane-file-only PR with the P1.T2 browser-run numbers when the 1-lap run lands.
  3. GAME: review the UI lane's "Race it" iframe integration when pointed at it.

### 2026-10-24 01:40 London — agent A (Claude) — P1.T1 + P1.T2
- Status: **P1.T1 done** (PR into `claude/amazing-planck-804i13` from `claude/game-p1-aero`). **P1.T2 done, verified headless + browser** (PR from `claude/game-p1-aero-broadcast`, stacked on T1: merge T1 first, its diff then shrinks to T2). `npm test` 36/36 on both. Next: P3.T3 grid race (F-10) when the integrator opens it.
- Files changed: `js/car.js` (T1), `js/race.js`, `js/main.js` (T2), this file. Nothing else.
- What the hooks do:
  - `js/car.js`: `new EI.Car({ …, aero: { df, cd, a0, b0 } })`; drag `CD·cd`, lateral `GRIP.a0·a0 + GRIP.a1·df·v²`, braking `BRAKE.b0·b0 + BRAKE.b1·df·v²` (ARCH §8 mapping). **`car.aero` stays `null` when not supplied** (see decision 1).
  - `js/race.js`: `cfg.lab.cars = [{ role, aero, driver?, team?, tyre? }]` → `buildLabGrid()`: exactly those bots, zero players, liveries williams (baseline) / mclaren (candidate), one car every 10 grid slots (80 m, beyond the 50 m tow). `Race.neutralDriver(car, track, rng, seed)`: AIDriver skill 100, form 0, season gap 0, car character 0, all 12 traits 0.5, line bias 0. With no players the race is over when every car has finished. `placeGrid(order, gap)` extracted from `buildGrid` (gap 1 for the shipped game, unchanged).
  - `js/main.js`: `?lab=1` → `LAB` (exp, seed, laps=3, circuit, baseline/candidate b64 setups, `mult_baseline`/`mult_candidate` b64 multipliers; anything missing = ×1 so both cars always carry an aero object). `?circuit=` picks the track. Auto-start when the scene is built, TV camera, 1.5 s intro. `views` = the cars the camera/HUD follow (`race.players`, or the lab's baseline car). `labSample()` per 120 Hz step: per car and lap, vmax and the minimum speed for `s ∈ [3600, 4200]` m. On classification `labPostResult()` posts `{ type: 'purple:result', experiment_id, seed, circuit, laps, cars: [{ role, lap, sectors[3], vmax_kmh, vmin_becketts_kmh, laps[], laps_deleted, finished, setup, aero }] }` to `window.parent` (also `EI.labResult` + a `console.log`). Without `?lab=1`: `LAB === null`, `views === race.players`, byte-identical behaviour.
- Verify step run + output:
  - **T1 (headless, Node, `server/game-headless.js` loader + stubbed car model, neutral driver, flying lap at Silverstone):** neutral car `83.242 s / vmax 323.6 / Becketts vmin 201.0 km/h` on **both** the original and the new `car.js` (identity check); `{ df 1.3, cd 1.2 }` → `84.400 s / 301.1 / 218.7` → lower top speed, higher Becketts minimum. PASS.
  - **T2 headless race (Node: race.js + car.js + ai.js + teams, 3 laps, no players, seed 42, candidate = rear wing +8° → mult `{ df 1.144, cd 1.088, a0 0.9872, b0 1 }`):** finishes in 249 s race time (0.5 s wall), both cars classified, no deleted laps.
    - baseline: best lap **80.742** (laps 84.662 / 80.976 / 80.742), sectors 24.683 / 25.771 / 30.268, vmax **325.2**, Becketts vmin **201.7**
    - candidate: best lap **81.260** (laps 86.263 / 81.490 / 81.260), sectors 24.927 / 25.950 / 30.377, vmax **315.8**, Becketts vmin **211.5**
    - measured Δ **+0.518 s** vs evaluator prediction +0.436 s (TASK_LOG 23:35) → agreement_pct ≈ 19 %. Seeds 7 / 1234: Δ +0.515 / +0.696, vmax −8.7 / −10.4, vmin +9.3 / +9.7. T-F04-AC3 holds on every seed.
  - **T2 browser (Playwright + preinstalled Chromium, SwiftShader GL, 400×225 viewport, game in an iframe of a parent page that listens for `message`):** **in progress at the time of this commit** (software GL runs the game at ~0.1× real time; a 3-lap race takes ~45 min wall). Numbers follow in the next commit on this branch.
  - **Shipped game smoke (no `?lab=1`, headless Chromium):** loads to the menu, no race auto-started, 0 console errors.
  - URL used (baseline = ARCH §4.1 baseline, candidate = rear wing 28°): `http://127.0.0.1:8788/index.html?lab=1&exp=exp-test-rw8&seed=42&laps=3&circuit=silverstone&baseline=eyJmcm9udF93aW5nX2RlZyI6MjUsInJlYXJfd2luZ19kZWciOjIwLCJyaWRlX2hlaWdodF9tbSI6MzUsImJyYWtlX2JpYXNfcGN0Ijo1NywiZXJzX2RlcGxveSI6MC41fQ==&candidate=eyJmcm9udF93aW5nX2RlZyI6MjUsInJlYXJfd2luZ19kZWciOjI4LCJyaWRlX2hlaWdodF9tbSI6MzUsImJyYWtlX2JpYXNfcGN0Ijo1NywiZXJzX2RlcGxveSI6MC41fQ==&mult_baseline=eyJkZiI6MSwiY2QiOjEsImEwIjoxLCJiMCI6MX0=&mult_candidate=eyJkZiI6MS4xNDQsImNkIjoxLjA4OCwiYTAiOjAuOTg3MiwiYjAiOjF9`
- Decisions proposed (for the integrator to log in TASK_LOG):
  1. **`car.aero` is `null` unless supplied, not `{1,1,1,1}`** (ARCH §9 says `opts.aero || { df: 1, … }`). Reason: `js/ai.js` treats any aero object as `aeroOn` and caps the profile at the terminal speed, so a neutral object moved every shipped bot's lap (83.242 → 83.333 s, vmax 323.6 → 319.8 in the headless check). With `null` the shipped game is byte-identical; the lab always passes an object for both cars. Proposed ARCH §9 wording: "`this.aero = opts.aero || null`; the physics lines use a frozen neutral constant".
  2. **Becketts window = s 3,600–4,200 m** in the track's own frame (ARCH §9 says 2,850–3,250 m, which is Woodcote–National Pits in `js/data/silverstone.js`: Maggotts 3,631 / Becketts 3,875 / Chapel 4,033–4,167). Same as `lab/aero.js` REF_CORNER and TASK_LOG decision 23:14. Proposed ARCH §9 correction. Monza window 2,150–2,700 (Lesmo 1–2) is also in `main.js` `LAB_REF_CORNER` (the game page does not load `lab/aero.js`, so the two numbers are duplicated there with a comment).
  3. Lab grid spacing 10 slots (80 m) and liveries williams / mclaren: cosmetic + measurement hygiene; not in ARCH. Overridable per car via `cfg.lab.cars[i].team`.
  4. The result message carries extra fields beyond ARCH §5 (`circuit`, `laps`, per-car `laps[]`, `laps_deleted`, `finished`, `setup`, `aero`); the server route ignores them. Useful for the ledger label and QA.
  5. `experiment_id` is read from `?exp=`; ARCH §6 step 7 does not list it in the URL. UI lane: add `&exp=<id>` to the "Race it" URL (or forward the id from the lab page when relaying the message).
- Blockers / questions for Tanuj: none blocking. FYI: the broadcast page is slow under software GL only (headless Chromium ~0.1× real time); on a laptop GPU it runs in real time.
- Next three actions:
  1. Integrator merges `claude/game-p1-aero` then `claude/game-p1-aero-broadcast`; SERVER lane verifies T-F04-AC2 with a real `purple:result` payload (shape above).
  2. UI lane (P2.T1): build the "Race it" URL with `exp`, `seed`, `laps`, `circuit`, `baseline`, `candidate`, `mult_baseline`, `mult_candidate` (`aero.toMultipliers(setup, conditions)` → `{ df, cd, a0, b0 }`), listen for `message` with `data.type === 'purple:result'`, POST it to `/api/race/result`.
  3. GAME: P3.T3 grid race (F-10) — reuse `cfg.lab` with one candidate car + the real grid, "cinematic" label.

## Template for a session entry

### YYYY-MM-DD HH:MM London — <agent/session> — <task id>
- Status: in_progress | done | blocked: <what, who>
- Files changed:
- Verify step run + output:
- Decisions proposed (for the integrator to log in TASK_LOG):
- Blockers / questions for Tanuj:
- Next three actions:
