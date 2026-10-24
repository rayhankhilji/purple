# PURPLE — 3-minute demo script (video P3.T4 and live P4)

Version 2.0 · 2026-10-24 · Owner: DEMO lane (agent G); Tanuj records. Replaces v1 (which promised sector colours and a v1/v2 verdict flip that the measurements do not support).

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
| Live decisions, v1 collection | 43 valid plans: verdicts 40 reject / 3 retest / 0 promote; next parameter front_wing 39, rear_wing 4 | TASK_LOG 23:35 |
| Exam, provider, untrained | verdicts 20/20; next experiment (parameter + direction) 10/20 | TASK_LOG 00:55 |
| The rule | "Weigh straight-line drag against corner gain; judge on full-lap delta." | P2.T4 |
| v2 collection | 40 calls, rule active, promote-biased scenarios (bias 0.3) | TASK_LOG 01:10 |
| TD-01 | rear wing capped at 20°; label "Technical directive TD-01: rear wing capped at 20°" | `aero.describeViolation` |
| Monza | rear wing +8° costs +0.757 s there vs +0.436 s at Silverstone | evaluator |

## Running order

| Time | Beat | Lane action that triggers it |
|---|---|---|
| 0:00 | Hook + disclosure | lab page open, baseline car |
| 0:20 | Run → DESIGN | press **Run** |
| 0:45 | EVALUATE | arrives with the plan |
| 1:05 | RACE | press **Race it** |
| 1:35 | LEARN: overrule, rule, v2 | **Overrule** form, then next **Run**, Adapters page |
| 2:10 | Try models | console Try models tab |
| 2:35 | Directive + Monza | TD-01 toggle, **Run**; circuit switch |
| 2:50 | Close | grid race footage or RACE card |

## Script

### 0:00–0:20 — Hook and disclosure (G-HON-04)

**On screen:** `lab/index.html` at 1440×900. Stage rail DESIGN · EVALUATE · RACE · LEARN, all dim. 3D car on the three-quarter rear hero angle, baseline setup (rear wing 20°). Mubit widget top-right: task "Research engineer of F1", 43 kept examples, adapter v1, exam 20/20 · 10/20.

**Say:** "Can a model learn from an engineer's correction and make better decisions next time? This is PURPLE, an F1 setup research lab that chases purple sectors. It sits on Equation I, a browser F1 game our team built before this weekend. The lab, the evaluator and the Mubit research agent are new tonight."

**Trigger:** none. Cursor rests on the widget so the task name and kept-examples count are readable.

### 0:20–0:45 — Run → DESIGN

**On screen:** SetupSliders show the candidate: rear wing 20 → 28°. Press **Run**. DESIGN card lights, progress bar, then the plan: verdict **reject**, next experiment **rear_wing_deg · decrease · 4**, hypothesis text. Trace stream: a new line with the `mreq_` id and latency (about 2 s). 3D car rebuilds the rear wing to 28°.

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

### 1:35–2:10 — LEARN: overrule, rule, v2 (G-HON-03)

**On screen:** Ledger, newest first. Point at the next-experiment column: on the v1 collection the agent proposed a front-wing change 39 times out of 43. Widget exam line: verdicts 20/20, next step 10/20. Open **Overrule** on the demo experiment: verdict stays **reject**, reason "Weigh straight-line drag against corner gain; judge on full-lap delta." Submit. Rule chip **R-01** appears on the row; LEARN card lights. Press **Run** once more: expand the trace line's input; the scenario JSON now carries the rule in `rules`. Cut to console → Adapters: v1 [result], v2 [status / result].

**Say:** "The verdict was right. The next experiment is where the agent is weak: on forty-three live decisions it proposed a front-wing change thirty-nine times; on twenty held-out scenarios, every verdict right, half the next steps. It knows when to reject, not what to try next. So the engineer keeps the verdict and writes the rule: weigh straight-line drag against corner gain, judge on the full-lap delta. The rule enters every later task input. Forty more scenarios with it active, and Mubit trains version two. That is the mechanism: rule-conditioned learning."

**Trigger:** `POST /api/overrule { experiment_id, verdict: "reject", reason }` → rule active → next `POST /api/plan` input includes it. v2 was collected with `npm run collect -- --n 40 --with-rules --promote-bias 0.3` on the Saturday budget (not live in the video; show the Adapters page).

**Numbers owed:** v1 result from the Adapters tab; v2 status and result.

### 2:10–2:35 — Try models (G-HON-06)

**On screen:** Console → Try models, side by side: provider / v1 / v2 on the same held-out scenario. Scenario to show: `exam-13` (ride height −4 mm, brake bias −3 %; truth: promote, next step ride height decrease). Then the score card in the widget: next step provider [n/8] · v1 [n/8] · v2 [n/8]; verdict provider [n/8] · v1 [n/8] · v2 [n/8]. Always n/8, never a percentage.

**Say:** "Same unseen scenario to the provider, version one and version two. Verdicts tie, by design: the prompt states the thresholds, so the score that matters is the next experiment. On the eight hardest held-out scenarios: [v1 n of eight], [v2 n of eight], against the evaluator's ground truth."

**Trigger:** none in the lab; P3.T1 (Try models, 8 hardest exam scenarios by margin: exam-13, -11, -12, -15, -07, -10, -02, -16) produces the scores, entered via `POST /api/status`.

**If v2 does not beat v1:** say so. "Version two did not beat version one on this exam; here is the number." The loop is the product; the honesty is the pitch.

### 2:35–2:50 — Technical directive and Monza (F-09)

**On screen:** ConditionsBar: toggle **TD-01**. Set the candidate rear wing to 25° (or let the agent's last plan apply) and press **Run**. DESIGN card shows the violation in red: "Technical directive TD-01: rear wing capped at 20°". Trace stream: an `illegal` line, no `mreq_` id (no Mubit call is made for an illegal candidate). Press **Run** again with a legal candidate: a real call goes out; the widget's trained-today counter ticks. Then the circuit switch: Monza, same +8° rear wing, evaluator says **+0.757 s**.

**Say:** "Suppose a technical directive caps the rear wing at twenty degrees. One toggle. The next proposal over the cap is refused before it reaches the model, and the task keeps collecting under the new rules. Switch to Monza and the same eight degrees cost three quarters of a second instead of four tenths. The rules change, the loop keeps going."

**Trigger:** `POST /api/state { td01: true }`, `POST /api/plan` (422 `ILLEGAL_SETUP`, `calls.jsonl` row `kind: illegal`), `POST /api/plan` legal; `POST /api/state { conditions: { circuit: "monza" } }` + `POST /api/evaluate`.

### 2:50–3:00 — Close

**On screen:** If P3.T3 landed: the candidate car with a real 2026 driver profile on the Silverstone grid, broadcast camera, caption "cinematic — mixes car and driver" (G-HON-05). Otherwise hold on the RACE card with the measured numbers and the ledger.

**Say:** "A research agent that proposes experiments, a deterministic evaluator that grades them, a race that checks the evaluator, and an engineer whose corrections become the next version of the model, scored on a held-out exam. PURPLE."

**Trigger:** none.

## Recording notes (video P3.T4)

- 1080p, 1440×900 browser window scaled; DevTools closed; no console warnings on screen (DESIGN_SYSTEM §8).
- Before recording: `MUBIT_MOCK` **off** (real `mreq_` ids in the trace); `data/` holds the real ledger; widget fields current from the console.
- Budget for the recording: 2 trained calls (0:20 Run, 1:35 second Run) + 1 trained call (2:35 legal Run) = 3 trained calls per take. TD-01 refusal makes no call.
- Captions carry the source label; the voice does not need to read the label every time, but it must be legible in every shot with numbers.
- Shot-by-shot list with URLs and dependencies: `docs/deck/shot-list.md`.

## Self-check against EVAL_GUARDRAILS §5

- G-HON-01: every number shot carries its label (EVALUATE, RACE, Try models, Monza).
- G-HON-02: the words CFD, wind tunnel, validated, aerodynamically tested do not appear. "Calibrated" is the only quality word, and it describes what was done (80.800 s anchor).
- G-HON-03: 1:35 beat says rule → task input → provider answers → kept examples → new adapter version, and names "rule-conditioned learning".
- G-HON-04: disclosure at 0:00–0:20 and on slide 2.
- G-HON-05: grid footage captioned "cinematic — mixes car and driver"; the result is the baseline-vs-candidate race.
- G-HON-06: Try models scores are n/8, never %.
