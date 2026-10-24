# PURPLE: 3-minute video script (submission MP4)

Version 1 · 2026-10-24 · for the Discord `/submit` video (MP4 or MOV, **3:00 max**). Story: the concept lab first (Mubit in the loop),
the 5-knob research lab as the first proof. Companion files: `docs/deck/slides.md` (same numbers), `docs/demo-script.md` (live demo).

**Rules for every word and caption** (EVAL_GUARDRAILS §5): never the words CFD, wind tunnel, validated, aerodynamically tested;
every number on screen carries its source label; our car is a "model prediction ± band", never "we beat F1"; Try-models and exam
scores as n/N, never %; Equation I disclosed in the first 20 s. Mubit has no outcome-feedback API: say "the result travels in the
next call's input", never "Mubit is told the result".

Source labels to use verbatim in captions:
- our laps: **physics lap sim · Silverstone · 2026 British GP qualifying conditions**
- real laps: **real 2026 qualifying · OpenF1 / formula1.com**
- game-race footage (only if used): **cinematic · game lap model, mixes car and driver**

## Before recording

1. `npm ci`, `server/.env` with `MUBIT_API_KEY`, then `npm run dev` (**not** `MUBIT_MOCK`; the autonomous shot must show real
   `mreq_` ids). Browser 1440×900 or 1920×1080, DevTools closed, zoom 100 %.
2. Open three tabs: `http://127.0.0.1:8788/concept/lab/` (Engine panel), the Mubit console (logged in, designer task open),
   `docs/deck/purple-deck.pdf` page 8 (result) as the fallback card.
3. Decide the call mode for shot 3. **Recommended: "live · untrained"** (no trained budget, nothing stored by Mubit beyond
   metadata; the caption says so). If the owner wants the take to add trained examples: "live · TRAINED", tick the box, type
   `TRAIN 10`; the caption then says "trained". Budget as of 09:53 UTC: 430 of 2,500 trained calls used.
4. Warm the server: open Engine → Red Bull car sheet once (first sim build ~1 s).
5. Record each shot as its own clip; the edit joins them. Speed-ups are allowed only with an on-screen "×N time-lapse" caption.

## Running order

| # | Time | Dur | Shot | Screen |
|---|---|---|---|---|
| 1 | 0:00 | 0:12 | Hook | concept lab, 3D RB22, leaderboard |
| 2 | 0:12 | 0:08 | Disclosure | same frame + disclosure caption |
| 3 | 0:20 | 0:35 | Mubit in the loop, live | Engine → Autonomous · Mubit |
| 4 | 0:55 | 0:20 | Mubit console | console: designer task, session, kept, adapter, Try models |
| 5 | 1:15 | 0:22 | Speed run | Engine → Speed run |
| 6 | 1:37 | 0:23 | Garage hot swap | Engine → Garage + 3D car |
| 7 | 2:00 | 0:30 | Watch on Silverstone | `/concept/race/` replay with the pole ghost |
| 8 | 2:30 | 0:20 | The result and its limits | result card (deck p. 8) |
| 9 | 2:50 | 0:10 | First proof + close | `/lab/` research lab, then end card |

Voice-over total ≈ 380 words (≈ 2:32 at 150 words/min), leaving room for pauses on the replay and the result.

## Shots

### 1 · 0:00–0:12 · Hook

**On screen:** `/concept/lab/`, baseline Red Bull RB22. 3D car rotating slowly; right column: real 2026 Silverstone qualifying
leaderboard with our RB22 baseline inserted at P6. Caption bottom-left: *"real 2026 qualifying · OpenF1 / formula1.com"*.

**Voice-over:** "PURPLE is an AI race engineer. It takes Red Bull's 2026 car, keeps its engine, and redesigns it to beat the
real Silverstone pole, with Mubit in the loop."

### 2 · 0:12–0:20 · Disclosure (inside the first 20 s, G-HON-04)

**On screen:** same frame. Full-width caption card, 8 s:
*"Built on Equation I, our team's browser F1 game from before this weekend. New this weekend: concept/, server/, lab/, test/,
docs/ and opt-in game hooks (?lab=1, ?concept=1)."*

**Voice-over:** "The 3D Silverstone is from Equation I, our game from before this weekend; everything else here is new."

### 3 · 0:20–0:55 · Mubit in the loop, live

**On screen:** click **Engine** → **Autonomous · Mubit**. LLM: **live · untrained** (or TRAINED, see "Before recording"), seed 1,
search laps / call 200, scope "the proposed parameters", stop when: no gain for 8, call budget 10, start from RB22 baseline →
**START AUTONOMOUS LOOP**. Hold on the ITERATIONS list as rows arrive: each shows the `mreq_…` id, the proposal (1–3 parameters),
the measured lap with sectors, `kept` / `not faster` / `fallback`, and "this result went to Mubit in #k+1's request". At ~0:40 open
the orange **Mubit loop** drawer on a finished row and expand **exact request**: the JSON with `best`, `tested` (measured
`d_lap_s`, sector deltas, `kept`, gained / lost segments), `refused`, `near`. Best-lap chart steps down behind it.
Caption: *"live Mubit calls (untrained) · laps: physics lap sim · Silverstone · 2026 British GP qualifying conditions"*.

**Voice-over:** "Every iteration, Mubit gets the current best car and the last changes we tried with their simulated results: lap
and sector deltas, the corners that gained or lost, whether it was kept, and any FIA article it broke. It proposes the next change.
The physics simulator measures it, and only legal and faster changes are kept: the verdict is never the model's. That result goes
into the next Mubit call. One run is one Mubit session, and every result is tied to its request id."

### 4 · 0:55–1:15 · Mubit console (owner records this clip)

**On screen:** Mubit console. (a) Tasks → the **designer task** ("You are the concept designer of a 2026…"): requests and kept
examples **FILL designer-kept**. (b) Requests → Session filter = one big-run session id (e.g. seed 29's
`loop-01m5pn1ahpse8bq6brfp3433bx`) → its 25 requests; open one and scroll to the `tested` block. (c) Adapters: status / test result
**FILL designer-adapter**. (d) Try models on the same scenario: provider vs adapter side by side; sheet score
**FILL provider n/N** vs **FILL adapter n/N** (legal-and-faster proposals, counts, never %).
Caption: *"Mubit console · designer task · 331 trained designer calls in 16 sessions (as of 09:53 UTC)"*.

**Voice-over:** "Mubit has no API for results, so the result travels in the next call's input. Trained calls store that history
with the next proposal: 331 so far, in 16 sessions. Those kept examples train the adapter, shown here against the provider."
(If an adapter number is not in yet, cut (c)–(d) and the last sentence; never guess.)

### 5 · 1:15–1:37 · Speed run

**On screen:** Engine → **Speed run**: seeds `1,2,3,4`, laps per seed `1500`, baseline Red Bull RB22 · DM01 → **START SPEED RUN**.
Show the live tiles (physics laps, laps/s, best lap, Δ real pole) and the convergence chart crossing the dashed "real pole ANT
88.111" line. Time-lapse the middle (caption *"×8 time-lapse"*); end on the MODEL PREDICTION card (band, verdict vs pole and HAD,
"PU identical to the homologated DM01"). DASHBOARD.md measured 6,740 laps in 184 s → 87.462 ± 0.136 s for this setting; read
the number off the screen, do not say it before it appears.
Caption: *"physics lap sim · Silverstone · 2026 British GP qualifying conditions · model prediction ± band"*.

**Voice-over:** "The speed run asks how far the physics lets this car go. A CMA-ES search runs thousands of legal laps on the
simulator, dozens a second, with the engine locked. It crosses the real pole line, and the final car is
re-scored with its own error band."

### 6 · 1:37–2:00 · Garage hot swap with the 3D car

**On screen:** Engine → **Garage**. Drag *floor · width* 1450 → 1540: the floor flashes and rebuilds in the 3D car with a
"from → to" tag; lap, sector deltas and the PER CORNER bars update (~200 ms); "FIA: legal". Then switch the sidepods material to
the T1100G laminate, a permitted material (materials mode shows the swap). Then drag *layout · wheelbase* to 3600: **"FIA: illegal · C2.3.3"**, no lap.
Click **Reset to RB22**.
Caption: *"garage lap: physics lap sim · Silverstone · per-corner deltas sum to the lap delta · 3D: concept geometry built to the
design's dimensions, not a team CAD model"*.

**Voice-over:** "An engineer can check any idea by hand. Change a part or its material: the 3D car rebuilds that part, the FIA check
runs, and the lap and every corner update in a fifth of a second. Break a rule, like a wheelbase over 3.4 metres, and the car gets
no lap at all."

### 7 · 2:00–2:30 · Watch it on Silverstone

**On screen:** back on the concept lab with the best car loaded, click **watch on Silverstone →** (`/concept/race/`). Physics
replay, director camera; ghosts: **RB22** (sim baseline) and **ANT POLE** (real 2026 pole lap, OpenF1). Hold on the HUD: speed,
gear, Corner / Straight mode, ERS state, live delta to each ghost. Cut to the TV camera through Stowe (largest per-corner gain),
then the finish: the timing tower with the concept car, RB22 and ANT's 88.111.
Caption: *"physics replay: the sim's own lap on the game's 3D Silverstone, no game AI · pole ghost: real 2026 qualifying · OpenF1"*.

**Voice-over:** "This is not the game driving. It is the simulator's own lap, replayed on Equation I's Silverstone, against Red
Bull's baseline and the real pole lap from 2026 qualifying. The new car gains most where the downforce pays: Stowe, Brooklands,
Becketts and Luffield."

### 8 · 2:30–2:50 · The result and its limits

**On screen:** result card (deck page 8): baseline 88.763 → **87.235 ± 0.154 s**, 95 % band 86.933–87.537 s, Δ pole −0.876,
Δ HAD −1.511, "aero map gains halved: 87.893 s", per-corner bars. Then a limits line fades in:
*"held-out speed RMS 10.1 km/h (target < 7: missed) · the band does not cover the concept aero map · model prediction, not a real
car · Mubit loop alone: best 88.292 s; this car: speed run"*.
Caption: *"physics lap sim · Silverstone · 2026 British GP qualifying conditions · CAMPAIGN.md §4.0 · real laps: OpenF1 /
formula1.com"*.

**Voice-over:** "The best legal RB22, same engine, laps 87.235, plus or minus 0.15, against a real pole of 88.111: a model
prediction, not a real car. The simulator misses its own accuracy target, and with our aero gains halved it still laps 87.9."

### 9 · 2:50–3:00 · First proof and close

**On screen:** 2 s of `/lab/` (the 5-knob research lab: stage rail DESIGN · EVALUATE · RACE · LEARN), then the end card:
*"PURPLE · github.com/rayhankhilji/purple · FILL: deployed URL · built at Night Shift London with Mubit"*.
Caption on the lab: *"first Mubit task: 99 trained calls · rule-conditioned learning"*.

**Voice-over:** "Our first Mubit task, this five-knob lab, showed Mubit learning from an engineer's rule. PURPLE puts the same
loop on a whole car."

## Numbers used (and where they come from)

| Number | Value | Source |
|---|---|---|
| Real pole, HAD | 88.111 s (ANT), 88.746 s (HAD, RB22, P5) | real 2026 qualifying · OpenF1 / formula1.com (CAMPAIGN.md) |
| Best legal RB22 / DM01 car | 87.235 ± 0.154 s, 95 % 86.933–87.537, Δ pole −0.876, Δ HAD −1.511, P1 | CAMPAIGN.md §4.0 (physics lap sim v3) |
| Aero gains halved | 87.893 s | CAMPAIGN.md §4.0 |
| RB22 baseline (sim) | 88.763 s | CAMPAIGN.md §4.0, SIM.md §0 |
| Sim accuracy | held-out speed RMS 10.1 km/h vs target < 7 | SIM.md §0 |
| Dashboard speed run | 6,740 laps in 184 s, 37 laps/s → 87.462 ± 0.136 s | DASHBOARD.md §2 |
| Garage round trip | 180–210 ms | DASHBOARD.md §5 |
| Mubit designer calls | 331 trained, 16 sessions, 331 request ids; Mubit loop best 88.292 s (seed 29) | `docs/concept/loop-runs/*`, as of 09:53 UTC |
| Research task | 99 trained calls | TASK_LOG, ledger snapshot |
| Console numbers | **FILL designer-kept, FILL designer-adapter, FILL provider n/N, FILL adapter n/N, FILL deployed URL** | owner, from the Mubit console / Vercel |

## If something fails during the take

| If | Then |
|---|---|
| Mubit gateway slow or down | record shot 3 in `mock` mode **with the caption "scripted stand-in, no Mubit call"**, and use shot 4 (console) for the real calls |
| The speed run is slow on the recording laptop | lower laps per seed to 500 and time-lapse; read the final number off the screen |
| The replay stutters | lower Graphics in the game menu; or use `docs/concept/race-shots/v3best-*.jpg` stills with a caption naming the candidate (g37.4, 88.294 s) |
| An adapter number is missing | cut the console sub-shot and its sentence; never estimate it |
