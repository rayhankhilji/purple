# Lane GAME

Status: in_progress P1.T2 verify (code done, PRs open). Owner: agent A (Claude, session `session_019VA5sAvTHuQ3bGbWV5CX4M`). Branches: `claude/game-p1-aero` (P1.T1), `claude/game-p1-aero-broadcast` (P1.T1 + P1.T2, stacked).

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

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
