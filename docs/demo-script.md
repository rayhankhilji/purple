# PURPLE — 3-minute demo script (video P3.T4 and live P4)

Version 2.1 · 2026-10-24 · Owner: DEMO lane (agent G); Tanuj records. Replaces v1 (which promised sector colours and a v1/v2 verdict flip that the measurements do not support). v2.1 corrects the LEARN beat after the PRNG finding (TASK_LOG 01:45): the v1 front-wing skew was mostly the data we showed the agent, not the agent.

**Every claim below is one we have measured or can show on screen.** Numbers in square brackets do not exist yet; they are listed under "numbers owed" in `docs/agents/lanes/DEMO.md` and must be filled (or the line cut) before recording. Honesty rules G-HON-01..06 (`docs/EVAL_GUARDRAILS.md` §5) apply to every spoken word and every caption.

Source labels, verbatim, whenever a number is on screen:
- model numbers: **reduced-order lap model · calibrated to 2026 pole laps · aero map v1**
- race numbers: **measured in race, seed 42**
- grid race footage (if used): **cinematic — mixes car and driver**

Fixed facts the script is built on (all measured 2026-10-23/24, London):

| Fact | Value | Source |
|---|---|---|
| Mubit task | "Research engineer of F1", `claude-haiku-4-5`, frozen prompt v1 | console Tasks, 23:58 |
| Collection for v1 | 57 trained requests, 43 kept examples, status Training v1 | console Tasks, 23:58 |
| Demo experiment | ledger id `01M5NHXH4RSEQ50VM955FK20B7`, rear wing 20° → 28° (+8°), Silverstone, dry | TASK_LOG 01:25 |
| Predicted | +0.436 s; top speed 328.2 → 320.3 km/h; Becketts minimum 212.5 → 223.5 km/h | evaluator |
| Measured | +0.518 s (80.742 → 81.260); top speed 325.2 → 315.8; Becketts minimum 201.7 → 211.5; sectors 24.683 / 25.771 / 30.268 → 24.927 / 25.950 / 30.377 | race, seed 42, 3 laps, two identical neutral bots |
| Agreement | 19 % (target ≤ 25 %) | ledger `agreement_pct` |
| Agent on the demo experiment | verdict reject; next experiment rear_wing_deg decrease 4 | ledger row |
| v1 collection (Friday) | 50 scenarios, 43 valid plans, 57 trained calls. Verdicts 40 reject / 3 retest / 0 promote; next parameter front_wing 39, rear_wing 4. **94 % of the candidates were themselves front-wing moves** (a PRNG seeding defect, fixed 01:45), so v1 learned from skewed data | TASK_LOG 23:35, 01:45 |
| Exam, provider, untrained | verdicts 20/20; next experiment (parameter + direction) 10/20. On the 8 Try-models items: verdicts 8/8, next experiment **1/8** (only exam-rw8). On all 7 misses the evaluator's truth is a ride-height change; the provider proposed rear wing (5), front wing (1) or brake bias (1) instead | TASK_LOG 00:55, snapshot 0350-exam-details |
| The rule | "Weigh straight-line drag against corner gain; judge on full-lap delta." | P2.T4 |
| v2 collection (Saturday, 01:50) | 40 scenarios across all five parameters, rule R-01 in every input, promote-biased (0.3): 39 valid, 1 parse error. Evaluator truth promote 14 / retest 12 / reject 14; the agent's verdicts agreed on 38 of 39; its next parameter: ride_height 13, rear_wing 11, front_wing 7, brake_bias 6, ers 2 | TASK_LOG 01:50 |
| Try-models set (P3.T1) | 8 of the 20 exam items: exam-rw8, -03, -02, -14, -15, -16, -20, -05 (`docs/try-models/sheet.md`); scored verdict n/8 and next-step n/8 by `npm run exam:score` | EVAL |
| Grid race (F-10) | `index.html?lab=1&mode=grid&driver=VER&…`, VER P7 → P14 at seed 42, caption "Cinematic · mixes car and driver · Max Verstappen in the candidate car · reduced-order lap model" | GAME.md 02:55 |
| TD-01 | rear wing capped at 20°; label "Technical directive TD-01: rear wing capped at 20°" | `aero.describeViolation` |
| Monza | rear wing +8° costs +0.757 s there vs +0.436 s at Silverstone | evaluator |

## Running order

| Time | Beat | Lane action that triggers it |
|---|---|---|
| 0:00 | Hook + disclosure | lab page open, baseline car |
| 0:20 | Run → DESIGN | press **Run** |
| 0:45 | EVALUATE | arrives with the plan |
| 1:05 | RACE | press **Race it** |
| 1:35 | LEARN: what v1 learned, the rule, v2 | **Overrule** form, then **Run next**, console Adapters |
| 2:10 | Try models | console Try models tab |
| 2:35 | Directive + Monza | TD-01 toggle, **Run**; circuit switch |
| 2:50 | Close | grid race footage or RACE card |

## Script

### 0:00–0:20 — Hook and disclosure (G-HON-04)

**On screen:** `lab/index.html` at 1440×900. Stage rail DESIGN · EVALUATE · RACE · LEARN, all dim. 3D car on the three-quarter rear hero angle, baseline setup (rear wing 20°). Mubit widget top-right (orange rule): task "Research engineer of F1", kept examples [≈ 80 after v2; 43 at 23:58], adapter v1 [+ v2], exam `provider 20/20 verdicts · 10/20 next-step`.

**Say:** "Can a model learn from an engineer's correction and make better decisions next time? This is PURPLE, an F1 setup research lab that chases purple sectors. It sits on Equation I, a browser F1 game our team built before this weekend. The lab, the evaluator and the Mubit research agent are new tonight."

**Trigger:** none. Cursor rests on the widget so the task name and kept-examples count are readable.

### 0:20–0:45 — Run → DESIGN

**On screen:** The setup table (bottom-left of the main area) shows baseline 20° and candidate 28° rear wing in purple. Press **Run** (P2.T1 has no candidate editor: the demo candidate goes in through `EI.lab.run({ candidate: { front_wing_deg: 25, rear_wing_deg: 28, ride_height_mm: 35, brake_bias_pct: 57, ers_deploy: 0.5 }, seed: 42 })`, pre-typed in the DevTools console off-screen, or a preset button if the UI lane adds one for P3.T2). DESIGN card lights, progress bar, then the plan: verdict **reject**, next experiment **rear wing · decrease · 4°**, hypothesis text. Trace stream: a new line with the `mreq_` id and latency (about 2 s). 3D car rebuilds the rear wing to 28°.

**Say:** "One experiment: eight degrees more rear wing at Silverstone. The research agent is Claude Haiku routed through Mubit, one frozen task. It reads the baseline, the candidate and the evaluator's deltas, and answers with a verdict and the single next experiment. Every call is a line in this trace with its Mubit request id."

**Trigger:** `POST /api/plan` with the candidate from the sliders. One trained call.

### 0:45–1:05 — EVALUATE (G-HON-01)

**On screen:** EVALUATE card: lap **+0.436 s**, top speed 328 → 320 km/h, Becketts minimum 213 → 224 km/h. Label under the numbers: "reduced-order lap model · calibrated to 2026 pole laps · aero map v1".

**Say:** "The evaluator is the game's own lap model, reduced-order, calibrated so the neutral car laps Silverstone in 80.800, the game's pole-anchored limit lap. It says: eleven km/h faster through Becketts, eight slower on the straights, and the lap is four tenths slower. The agent agreed: reject, and try less wing next. Now we check it in the race."

**Trigger:** none; the evaluation arrives on the same SSE `plan` event as the DESIGN card.

### 1:05–1:35 — RACE (G-HON-01, G-HON-05)

**On screen:** Press **Race it**. The game iframe opens in broadcast mode, TV camera, two cars: baseline (Williams livery) and candidate (McLaren livery), identical neutral drivers, seed 42, 3 laps. **Video cut:** start, one pass through Maggotts–Becketts, one pass down the Hangar Straight, then the finish (a real-time 3-lap race is over four minutes). RACE card fills: measured **+0.518 s**, agreement **19 %**, Becketts minimum 201.7 → 211.5 km/h, top speed 325.2 → 315.8 km/h, sectors 24.683 / 25.771 / 30.268 vs 24.927 / 25.950 / 30.377. Label: "measured in race, seed 42". Ledger row `01M5NHXH…` gains the measured column.

**Say:** "Same driver, same seed, baseline against candidate. Measured: half a second slower. The model said four tenths; a nineteen percent gap, inside our twenty-five percent target. Faster through Becketts, as predicted, but every sector slower on the clock: the drag bill comes due on every straight. No purple sector today, and the agent knew that before the race."

**Trigger:** **Race it** builds the `?lab=1&exp=01M5NHXH4RSEQ50VM955FK20B7&seed=42&laps=3&circuit=silverstone&…` URL; the game posts `purple:result`; the lab page forwards it to `POST /api/race/result`. For the recording use the race already in the ledger, or re-run it on a laptop GPU (real time); under software GL the game runs at about a tenth of real time.

**Do not say:** "Becketts purple, Hangar red". All three measured sectors were slower for this candidate.

### 1:35–2:10 — LEARN: what v1 learned, the rule, v2 (G-HON-03)

**On screen:** Ledger, newest first, scrolled to the Friday rows: change column shows front-wing moves almost everywhere; verdict column `reject`. Widget exam line: `provider 20/20 verdicts · 10/20 next-step`. Open **Overrule** on the demo experiment: verdict stays **reject**, reason "Weigh straight-line drag against corner gain; judge on full-lap delta." Submit. A rule chip appears on the row (R-01 is already on this experiment from the first overrule at 01:45; a live re-enactment adds a second chip with the same text; say "the rule", not an id). LEARN card lights. Press **Run next**: the new trace line's input carries the rule under `rules`. Cut to the Saturday rows in the ledger: changes across ride height, rear wing, brake bias; verdicts now include `promote`. Then console → Adapters: v1 [result], v2 [status / result].

**Say:** "The verdict was right. The next experiment is where the agent is weak: on twenty held-out scenarios it gets every verdict and half the next steps. Version one also learned from our mistake: a seeding bug made ninety-four percent of Friday's candidates front-wing moves. We fixed the generator. The engineer kept the verdict and wrote the rule: weigh straight-line drag against corner gain, judge on the full-lap delta. The rule enters every later task input. Forty new scenarios across all five parameters, verdicts agreeing with the evaluator on thirty-eight of thirty-nine, and Mubit trains version two. That is rule-conditioned learning."

**Trigger:** `POST /api/overrule { experiment_id, verdict: "reject", reason }` → rule active → next `POST /api/plan` input includes it. v2 was collected at 01:50 with `npm run collect -- --n 40 --with-rules --promote-bias 0.3 --seed 2` (not live in the video; show the ledger rows and the Adapters page).

**Numbers owed:** v1 result from the Adapters tab; v2 status and result; kept-examples count after v2 (expected about 80).

**Do not say:** "the agent fixates on the front wing". 50 of the 53 v1 ledger rows touched `front_wing_deg` because of the generator, not the agent. The clean measure of next-step quality is the exam (10/20).

### 2:10–2:35 — Try models (G-HON-06)

**On screen:** Console → Try models, **Side by side**: provider on the left, the adapter version on the right, the same held-out scenario pasted as the user message only (the task adds its own instructions). Scenario to show: `exam-rw8`, the demo premise itself (truth: reject, next step rear wing decrease), then one of the five retest items (`exam-14`, rear wing −4°, truth retest / ride height decrease). Then the widget score line: next step provider 1/8 · v1 [n/8] · v2 [n/8]; verdict provider 8/8 · v1 [n/8] · v2 [n/8]. Always n/8, never a percentage.

**Say:** "Same unseen scenario to provider, version one and version two. Verdicts tie by design, the prompt states the thresholds; the score that matters is the next experiment. On eight hard held-out scenarios the provider gets one next step in eight: every miss wanted ride height and it reached for a wing. Version one: [n of eight]. Version two: [n of eight]."

**Trigger:** none in the lab; P3.T1 by hand per `docs/try-models/README.md` (sheet `docs/try-models/sheet.md`: exam-rw8, -03, -02, -14, -15, -16, -20, -05; five of the eight are retests on purpose), scored with `npm run exam:score`, which prints the `POST /api/status` body. Only a version marked `Passed` can be tried.

**If v2 does not beat v1:** say so. "Version two did not beat version one on this exam; here is the number." The loop is the product; the honesty is the pitch.

### 2:35–2:50 — Technical directive and Monza (F-09)

**On screen:** ConditionsBar: toggle **TD-01**; header badge `TD-01 active · rear wing ≤ 20°`, the setup table's rear-wing legal range shrinks to 5–20°. Run a 25° candidate (`EI.lab.run({ candidate: { …, rear_wing_deg: 25 } })`, the D-U3 hook; the random generator respects TD-01 so it never produces one). DESIGN card error state `ILLEGAL_SETUP · POST /api/plan`, badge `TD-01`, label "Technical directive TD-01: rear wing capped at 20°". Trace stream: `error ILLEGAL_SETUP`, no `mreq_` id (no Mubit call is made for an illegal candidate). Press **Run random**: a legal candidate, a real call, the widget's trained count ticks. Then circuit `monza` in the ConditionsBar and the same +8° rear wing: EVALUATE says **+0.757 s**.

**Say:** "Suppose a technical directive caps the rear wing at twenty degrees. One toggle. A proposal over the cap is refused before it reaches the model, and the task keeps collecting under the new rules. At Monza the same eight degrees cost three quarters of a second, not four tenths. The rules change, the loop keeps going."

**Trigger:** `POST /api/state { td01: true }`, `POST /api/plan` (422 `ILLEGAL_SETUP`, `calls.jsonl` row `kind: illegal`), `POST /api/plan { random: true }`; `POST /api/state { conditions: { circuit: "monza" } }` then `EI.lab.run` with the +8° candidate (1 trained call) or `POST /api/evaluate` for the number alone.

### 2:50–3:00 — Close

**On screen:** Grid race (P3.T3, merged): Verstappen in the candidate car on the real 2026 British GP grid, TV camera, lights out; the game's own caption bottom-left "Cinematic · mixes car and driver · Max Verstappen in the candidate car · reduced-order lap model" stays in frame (G-HON-05). URL and settings: `docs/agents/lanes/GAME.md` "How to film it", Shot B. Fallback: hold on the RACE card with the measured numbers and the ledger.

**Say:** "A research agent that proposes experiments, a deterministic evaluator that grades them, a race that checks the evaluator, and an engineer whose corrections become the next version of the model, scored on a held-out exam. PURPLE."

**Trigger:** none.

## Recording notes (video P3.T4)

- 1080p, 1440×900 browser window scaled; DevTools closed; no console warnings on screen (DESIGN_SYSTEM §8).
- Before recording: `MUBIT_MOCK` **off** (real `mreq_` ids in the trace); `data/` holds the real ledger; widget fields current from the console.
- Budget for the recording: 0:20 Run, 1:35 Run next, 2:35 Run random, 2:47 Monza run = 4 trained calls per take. The TD-01 refusal makes no call. Try models sends count against the console's daily limit (32 for the full sheet), so do not re-send on camera.
- Game footage (shots 5–8 and 15) is filmed from the plain game page per GAME.md "How to film it" (Graphics High, 1920×1080); the lab's own iframe is for the RACE card result, not for the b-roll.
- Captions carry the source label; the voice does not need to read the label every time, but it must be legible in every shot with numbers.
- Shot-by-shot list with URLs and dependencies: `docs/deck/shot-list.md`.

## Self-check against EVAL_GUARDRAILS §5

- G-HON-01: every number shot carries its label (EVALUATE, RACE, Try models, Monza).
- G-HON-02: the words CFD, wind tunnel, validated, aerodynamically tested do not appear. "Calibrated" is the only quality word, and it describes what was done (80.800 s anchor).
- G-HON-03: 1:35 beat says rule → task input → provider answers → kept examples → new adapter version, and names "rule-conditioned learning".
- G-HON-04: disclosure at 0:00–0:20 and on slide 2.
- G-HON-05: grid footage captioned "cinematic — mixes car and driver"; the result is the baseline-vs-candidate race.
- G-HON-06: Try models scores are n/8, never %.
