---
marp: true
theme: default
paginate: true
size: 16:9
title: PURPLE — Night Shift deck
style: |
  /* DESIGN_SYSTEM.md tokens: a pit-wall timing screen, not a dashboard */
  :root { --bg:#0a0a0c; --panel:#121216; --line:#26262c; --text:#e8e8ec; --muted:#8a8a94; --purple:#b26cff; --purple-dim:#3a2460; --green:#4ade80; --amber:#fbbf24; --red:#f0506e; --mubit:#ff4500; }
  section { background: var(--bg); color: var(--text); font-family: "Inter", system-ui, sans-serif; font-size: 21px; padding: 40px 56px 84px; }
  section.dense { font-size: 18px; } section.dense li { margin: 4px 0; }
  h1 { color: var(--text); font-size: 40px; font-weight: 600; margin-bottom: 8px; }
  h1 small, .label { display:block; color: var(--muted); font-size: 13px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 20px; }
  h2 { color: var(--purple); font-size: 26px; font-weight: 600; }
  ul { margin-top: 12px; } li { margin: 6px 0; }
  code, .num { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: 0.9em; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; color: var(--text); }
  table { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: 16px; border-collapse: collapse; margin: 8px 0; }
  table tr, table tr:nth-child(even), table tr:nth-child(odd) { background: transparent; }
  table td, table th { background: var(--panel) !important; color: var(--text); }
  th { color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
  td, th { border: 1px solid var(--line); padding: 4px 12px; }
  .purple { color: var(--purple); } .red { color: var(--red); } .amber { color: var(--amber); } .muted { color: var(--muted); } .mubit { color: var(--mubit); }
  .src { position: absolute; left: 56px; right: 96px; bottom: 24px; color: var(--muted); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; }
  section::after { color: var(--muted); font-family: "JetBrains Mono", monospace; font-size: 12px; }
  img[alt~="shot"] { border: 1px solid var(--line); border-radius: 6px; }
  .note { display: block; color: var(--muted); font-size: 14px; line-height: 1.35; margin-top: 4px; }
  .fill { background: var(--amber); color: #000; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.8em; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
  section.lead h1 { font-size: 64px; } section.lead .tag { color: var(--purple); font-size: 28px; }
---

<!-- _paginate: false -->

<span class="label">PURPLE · Night Shift · London · 2026-10-24 · built around Mubit</span>

# 1 · The problem
<small>Setup engineering is a loop of expensive guesses</small>

- An F1 setup is five numbers (wings, ride height, brake bias, ERS); each run is a lap-time bet on the downforce-vs-drag trade.
- The decision that matters is not "was it faster?" but **what to try next**: a bad research direction burns the session.
- Today that judgement lives in a senior engineer's head and leaves with them.
- **PURPLE**: a research agent that **proposes experiments**, is **graded by a deterministic evaluator**, is **checked by a race**, and **takes the engineer's corrections as rules** in its input; Mubit trains the next version from the recorded calls.

![shot bg right:46% fit](shots/lab-full.png)

<!--
Speaker notes: The recurring task is the research agent's experiment decision: verdict on the last experiment plus the single next experiment. The evaluator is deterministic, so every decision has a model-defined truth (the reduced-order lap model) and "did the correction help?" is a number, not an opinion. Figure: the lab's stage rail, DESIGN EVALUATE RACE LEARN.
-->

---

<!-- _class: dense -->

# 2 · What Mubit does here
<small>One frozen task, every call recorded</small>

- Mubit task **"Research engineer of F1"**: `claude-haiku-4-5`, frozen prompt v1, temperature 0, server-side only.
- Input: baseline and candidate setups, the evaluator's lap and sector deltas, active pit-wall rules, last 3 experiments. Output: strict JSON, verdict + next experiment.
- **99 trained calls**: Friday **57 → 43 kept examples** (Training v1), the demo experiment, Saturday **41** with the engineer's rule in every input, collected for v2. **61 untrained** (smoke test, exam runs) train nothing.
- Kept examples after v2: <span class="fill">FILL kept-after-v2</span> · adapter v1: <span class="fill">FILL v1-result</span> · v2: <span class="fill">FILL v2-result</span>
- Corrections never patch the prompt: they enter the task input as rules; Mubit trains the next version from the recorded calls.
- **Disclosure:** PURPLE sits on Equation I, our team's pre-existing browser F1 game. The lab, evaluator wrapper and Mubit agent are new tonight.

<span class="src">kept examples, adapter results: Mubit console → Tasks / Adapters · call counts: data/calls.jsonl (every call with its mreq_ id) · frozen prompt sha 6c5be1a3</span>

![shot bg right:36% fit](shots/console-tasks.png)

<!--
Speaker notes: Equation I is ours and predates the weekend; everything under lab/ and server/ is new. The prompt is frozen by a hash check in the test suite. Figure: console Tasks page (task name, requests, kept examples, status), shot after v2. Owed: the three amber FILL values from Tasks and Adapters.
-->

---

# 3 · The loop
<small>DESIGN → EVALUATE → RACE → LEARN</small>

| Stage | What happens | Who |
|---|---|---|
| DESIGN | agent proposes a setup change; `mreq_` id in the trace | Mubit |
| EVALUATE | reduced-order lap model scores it in ms: lap, sectors, vmax, Becketts vmin, legality | evaluator |
| RACE | baseline vs candidate, identical neutral bots, same seed, broadcast camera | the game |
| LEARN | engineer overrules → pit-wall rule → every later task input → next adapter version | engineer + Mubit |

- Evaluator anchored so the neutral car laps Silverstone in **80.800 s game time = real 2026 pole 88.111 s** (the game's limit-car lap, mapped linearly); times and deltas are game seconds.
- The race is the check on the evaluator (one experiment, n = 1); the exam is the check on the agent.

<span class="src">reduced-order lap model · calibrated to 2026 pole laps · aero map v1</span>

<!--
Speaker notes: Each stage is a card in the lab and a line in the ledger. The evaluator is the game's own lap model with an aero map on top; we label it exactly that, never more. The race measures what the model predicted. Figure: this table, or the lab page with four cards lit (integrator-screens/lab-1440-0505-merged.png, re-shot on real data).
-->

---

# 4 · The numbers
<small>One experiment, end to end · rear wing +8° at Silverstone</small>

| | predicted | measured in race |
|---|---|---|
| lap delta (game s) | <span class="red">+0.436 s</span> | <span class="red">+0.518 s</span> |
| top speed | 328.2 → 320.3 km/h | 325.2 → 315.8 km/h |
| Becketts minimum | 212.5 → 223.5 km/h | 201.7 → 211.5 km/h |
| sectors (measured, game s) | | 24.683 / 25.771 / 30.268 → 24.927 / 25.950 / 30.377 |
| agreement | | **19 %** (target ≤ 25 %; one experiment, n = 1) |

- Agent's answer: **reject**, next experiment **rear wing · decrease · 4°**. Correct on both.
- Faster through Becketts, slower in every sector: the drag bill is paid on every straight, not one.

<span class="src">left: reduced-order lap model · calibrated to 2026 pole laps · aero map v1 · right: measured in race, seed 42 · ledger 01M5NHXH4RSEQ50VM955FK20B7 · game seconds; ×1.09 ≈ real scale: +0.436 ≈ +0.475 s</span>

![shot bg right:30% fit](shots/lab-race-card.png)

<!--
Speaker notes: Two identical neutral bots, seed 42, three laps. The model predicted four tenths, the race measured half a second: 19 percent apart, inside the 25 percent target. No purple sector for this candidate, and the agent knew it before the race. Figure: lab RACE card plus the ledger row.
-->

---

<!-- _class: dense -->

# 5 · v1 vs v2
<small>The story is the next experiment, not the verdict</small>

- Exam: 20 scenarios, truth from the evaluator. Provider (untrained): verdicts **20/20** (the prompt states the thresholds), next experiment **10/20**. On the 8 hardest, all 6 misses wanted **ride height**.
- **v1 learned from our mistake:** a seeding bug made 50 of 53 Friday candidates front-wing moves; the agent answered "front wing" 39 times in 43. Fixed before v2.
- **v2's examples carry the engineer's rule** *"Weigh straight-line drag against corner gain; judge on full-lap delta."* in all 40 inputs: verdicts agree with the evaluator 38 of 39. **Rule-conditioned learning.**

| Try models, 8 hardest | provider | v1 | v2 |
|---|---|---|---|
| next experiment | **2/8** · 1/7 | <span class="fill">FILL v1-next</span> · <span class="fill">/7</span> | <span class="fill">FILL v2-next</span> · <span class="fill">/7</span> |
| verdict | 8/8 · 7/7 | <span class="fill">FILL v1-verdict</span> · <span class="fill">/7</span> | <span class="fill">FILL v2-verdict</span> · <span class="fill">/7</span> |

<span class="note">n/8 · n/7 without exam-rw8. exam-rw8 is the demo experiment; its call is in v2's recorded data, so it is not held out for v2. Sheet score also shown without it: n/7.</span>

<span class="src">truth: reduced-order lap model · calibrated to 2026 pole laps · aero map v1 · game seconds · data/exam.json · provider: untrained calls (snapshot 0530-windcap-exam) · v1/v2: Try models by hand, npm run exam:score</span>

![shot bg right:34% fit](shots/try-models-side-by-side.png)

<!--
Speaker notes: Same scenario to provider, v1 and v2 in Try models. exam-rw8 is the demo experiment; its call is in v2's recorded data, so it is not held out for v2. Sheet score also shown without it: n/7 (provider 7/7 verdicts, 1/7 next step: exam-12 only). On these eight the provider gets every verdict and two next steps; on all six misses the truth is ride height and it proposes rear wing or brake bias. Counts, never percentages; if v2 loses, we show it. Figure: Try models on exam-rw8, version label visible.
-->

---

# 6 · Fast refresh
<small>When the rules or the circuit change, the task keeps collecting</small>

- **Technical directive TD-01** (a demo directive we wrote, not an FIA document) caps the rear wing at 20°. One toggle in the lab.
- A 25° proposal is refused before it reaches the model: <span class="red">"Technical directive TD-01: rear wing capped at 20°"</span>, an `illegal` trace line, no Mubit call spent.
- The next legal candidate goes out as usual; new examples count toward the next adapter version.
- **Circuit switch:** at Monza the same rear wing +8° costs <span class="red">+0.757 game s ≈ +0.808 s</span> (vs +0.436 game s ≈ +0.475 s at Silverstone). Same task, same prompt, new objective.

<span class="src">reduced-order lap model · calibrated to 2026 pole laps · aero map v1 · game time scale: real 2026 pole 88.111 s = 80.800 s (Silverstone), 81.786 s = 76.650 s (Monza)</span>

![shot bg right:36% fit](shots/lab-design-td01.png)

<!--
Speaker notes: Regulation changes are the normal case in F1. The directive is a legality rule in the aero map, so an illegal candidate never costs a trained call, and the collection continues under the new rules. Monza shows the objective moving without touching the task key. Figure: DESIGN card with the TD-01 violation in red.
-->

---

# 7 · What this is and is not
<small>Honesty slide</small>

- The evaluator is a **reduced-order lap model, calibrated to 2026 pole laps, aero map v1**. It is not a high-fidelity aerodynamic simulation; the race is our only check on it (19 % apart on the demo candidate, in game seconds, measured in race, seed 42; one experiment, n = 1).
- Corrections are **rule-conditioned learning**: the rule enters the task input, the provider's answers change, those kept examples train the next adapter version. There is no gradient from the engineer's click.
- Exam scores are **counts** (n/20, n/8, n/7 without the demo item), never percentages; truth comes from the evaluator, not from us. v1's data was skewed by our seeding bug; we say so.
- Equation I (game, physics, circuits, drivers) is **pre-existing**; `lab/`, `server/`, the aero map and the Mubit agent are new tonight.
- The grid race is **cinematic · mixes car and driver** (its own caption says so). The baseline-vs-candidate race is the result.

<!--
Speaker notes: We would rather be judged on a small true thing than a large claimed one. Every number on screen carries its source label. The data directory with the ledger and every Mubit request id is frozen into docs/ledger-snapshot at submission. No figure on this slide.
-->

---

<!-- _class: dense -->

# 8 · Next
<small>What a week would add</small>

- **More corrections, more versions:** a correction per session, v3 and v4 scored on the same exam; the exam grows with each new circuit.
- **Richer objective:** wind and wet already in the scenario; add tyre temperature and a stint, not a lap.
- **Grid race: cinematic today, a measurement only once a stint model exists:** today Verstappen in the candidate car on the real 2026 British GP grid is a cinematic (P7 → P14 at seed 42, labelled); a stint model could make it a measurement.
- **Future work, any team's priors:** the pit-wall rules are plain text; a Formula Student or sim-racing team could train their own research engineer from their own corrections.
- `github.com/rayhankhilji/purple` · every Mubit request id, ledger row and rule frozen in `docs/ledger-snapshot/`

<span class="src">grid race: cinematic · mixes car and driver · headless run, seed 42 · wind and wet: reduced-order lap model · aero map v1</span>

![shot bg right:36% fit](shots/ledger-row.png)

<!--
Speaker notes: The loop is the product. Everything we would add is more of the same loop: more corrections, more versions, a larger exam, more circuits. Figure: the ledger with the demo row, its rule chip and the measured column. Thank you.
-->
