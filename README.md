# PURPLE

**An F1 engineer that learns from physics, through Mubit.**

**Try it: https://purple-wine.vercel.app**

The site opens on a replay of a real recorded run. Every decision you see was a live Mubit call, and each card shows its Mubit request ID. **Go live** on the same page starts a new live run (rate limited). The older research lab needs the team passcode for live calls; we give it to the judges directly, and it is never in this repo.

Built at Night Shift London, 24–25 October 2026.

---

## Who uses it

A race team's performance or aero engineer. Every week of the season they decide what to test next on the car, and the rules give them a fixed testing allowance, so every test spent on a bad idea is gone.

What PURPLE saves them:

- **Fewer wasted tests.** On 30 car situations it had never seen, Claude Haiku 4.5 with our harness proposed a change that was legal and faster on 23/30. Random changes managed 3/30.
- **Ideas that come with reasons.** Every proposal says what it changes, why, and what it expects; the physics verdict sits next to it.
- **Corrections that stick.** A verdict goes back into the next call, so the same illegal idea is not proposed again and again.
- **A model the team owns, once Mubit trains it.** Only the physics-approved decisions are sent to Mubit as training examples. Mubit has not trained a passing model yet (see [Mubit's models](#mubits-models)).

## What it does

1. **Claude, through Mubit, proposes a change** to the 2026 Red Bull RB22: a new sidepod concept, a bigger rear wing, a lower floor. It keeps the RB22's own engine.
2. **Physics checks it.** First the 2026 FIA rules, then a lap of Silverstone on our physics simulator. The car on screen changes shape as it improves.
3. **Physics decides what Mubit learns.** If an idea is legal and faster, it becomes a Mubit training example. If it isn't, the verdict goes back into the next call as a correction, and the idea is never trained on.

The goal is the real 2026 Silverstone pole: Antonelli, 88.111 s.

The site has four steps: **1 Mubit engineer** (the replay and Go live), **2 Which AI is best?** (the Model GP), **3 vs no AI**, and **4 Race & drive**, where the best car laps Silverstone against the real 2026 grid and **Drive it** lets you drive it yourself.

## How a physics verdict changes a later answer

This happens in our harness today, at two levels. The third level, Mubit's own model, is waiting for Mubit to train.

1. **Inside a run: corrections.** Every physics verdict of the run so far (what was kept, what was rejected, which proposed values were illegal and the legal range for the current car) goes into the next Mubit call ([`concept/engineer/scenario.js`](concept/engineer/scenario.js), the `corrections` block). Same start car, same model, same seed 11: without it, Claude asked to shrink the sidepod inlet from 650 to 640 or 630 cm² 47 times in 120 decisions, illegal every time. With it, Claude asked for that once in 118 decisions and moved the inlet up to 670–700 cm² instead. Illegal ideas per run fell from 64 to 3–8 ([`docs/concept/loop-runs/trained-engineer-seed11`](docs/concept/loop-runs/trained-engineer-seed11) vs [`trained-corrections-seed11`](docs/concept/loop-runs/trained-corrections-seed11), [`docs/concept/TESTS_TO_POLE.md`](docs/concept/TESTS_TO_POLE.md) §9).
2. **Across runs: shared memory.** Physics-approved decisions from earlier runs are built into an index ([`concept/engineer/memory/build.js`](concept/engineer/memory/build.js)): 8,261 distinct approved changes from 10,183 approved decisions. Each call then carries the most similar ones as precedents ([`concept/engineer/memory.js`](concept/engineer/memory.js)). The index is rebuilt offline from the run logs, so a run's own approvals reach the precedents at the next rebuild, not during that run (inside a run, the memory only skips changes already tried). Example, held-out exam question 29 (start car 88.224 s): with corrections only, Haiku proposed a wider rear wing with a longer chord and a wider front wing, 0.303 s slower. With the precedent "sidepods undercut 100 → 140 mm, legal, −0.094 s" in the call, it proposed that change plus two small ones: legal and 0.117 s faster.
3. **In Mubit's model: pending.** The approved decisions were sent to Mubit as trained calls (27,169 in the harvest logs). When Mubit trains a designer adapter from them, the same exam runs on it with one command ([below](#mubits-models)). Until then, every answer in this repo was served by the provider model.

## The main path in the code

One live decision, end to end:

1. **Browser:** [`concept/lab/mubit-first.js`](concept/lab/mubit-first.js) (Go live) posts to `/api/concept/engine/run`. The browser never calls Mubit (a test checks it).
2. **API route:** [`server/campaign-route.js`](server/campaign-route.js) starts the engine with the designer caller from [`server/concept.js`](server/concept.js).
3. **Engine:** [`concept/engineer/engine.js`](concept/engineer/engine.js) builds the call's text from the current car, the run so far and the corrections ([`concept/engineer/scenario.js`](concept/engineer/scenario.js)), plus the shared memory when that option is on ([`concept/engineer/memory.js`](concept/engineer/memory.js); on in the Model GP and the exam, off in Go live).
4. **Mubit:** [`server/mubit.js`](server/mubit.js), the only file that calls Mubit, sends the frozen designer task ([`concept/designer/prompt.js`](concept/designer/prompt.js): Claude Haiku 4.5, temperature 0) untrained, with `x-middleware-record: metadata`.
5. **Rules:** the answer is parsed and checked against the 2026 FIA technical rules, the homologated power unit and materials ([`concept/regs.js`](concept/regs.js), via `violations()` in `engine.js`).
6. **Physics:** hundreds to thousands of versions of the idea are screened (rules plus a fast estimate), and the best legal ones are run on the physics lap sim of Silverstone ([`concept/bench.js`](concept/bench.js) → [`concept/sim/index.js`](concept/sim/index.js)). The car is kept only if it is legal and faster ([`concept/engineer/tree.js`](concept/engineer/tree.js)).
7. **Learning:** an approved decision is re-sent as the identical trained call ([`concept/engineer/record-good.js`](concept/engineer/record-good.js)); every verdict goes into the next call's corrections.

**See it without keys** (no network; a scripted stand-in plays Mubit's part, everything after the call is the real code):

```bash
npm ci && npm test
node concept/engineer/cli.js --mock scripted --seed 11 --max-decisions 5 --budget 300 --memory on --out /tmp/purple-e2e
```

The second command runs five decisions of the engine (about 15 s): call text with corrections and precedents, rules check, physics laps, keep or revert. It prints one line per decision and writes the full logs to `/tmp/purple-e2e/run-seed11/`. `test/engineer-record-good.test.js` drives the API route with a stub Mubit and checks that only an approved decision makes one extra trained call. `MUBIT_MOCK=1 npm run dev` serves the whole site locally on http://127.0.0.1:8788/concept/lab/ with no keys; live calls are off in that mode. `npm run smoke` makes one call of the first-night research task (with `MUBIT_MOCK=1`, no network).

## Why use AI, and not just an algorithm?

On our simulator, one test takes about 20 milliseconds, so a plain algorithm does fine. We measured it (below). A real team's test takes hours, and it only gets a limited number of them. When every test counts:

- **Claude's ideas, with physics corrections, pass physics three times as often as random changes do:** 10/30 vs 3/30 on 30 car situations it had never seen. With the shared memory as well: 23/30.
- **They gain about 20 times more lap time per test** (0.031 s vs 0.002 s per idea).
- **It explains every change in plain engineering language.**
- **You can correct it.** Feeding the physics verdicts back cut its illegal ideas from about 64 per run to 3–8.

## Where Mubit sits

- **Every model call goes through Mubit.** There is exactly one call site, [`server/mubit.js`](server/mubit.js), and a test fails if any other JavaScript file names Mubit's address.
- **Mubit tasks:**
  - the concept designer (Claude Haiku 4.5, frozen prompt), plus two shorter answer formats for the same job (compact and action);
  - the research engineer from the first night;
  - the Model GP and the exams call other models through the same gateway, untrained.
- **Trained calls in the logs:** 28,440 designer (5,386 on the first designer task, 6,073 compact, 16,981 action) + 99 research.
- **How examples are chosen:** every call is first made untrained. Only the ones physics approves are sent again as identical trained calls. The model answers at temperature 0, and the re-send gave the same answer 27,124 times out of 27,169.

## Results

All lap times come from our physics lap sim of Silverstone. They are model predictions, not a real car's lap. Real lap times come from OpenF1, 2026 qualifying.

| | Lap |
|---|---|
| RB22 as raced (sim) | 88.745 s |
| Real pole (Antonelli) | 88.111 s |
| Best car from a live Mubit-directed run (seed 11, 120 calls) | **87.698 ± 0.122 s** |

### The exam: base model vs the same model with our harness

The same 30 held-out car situations for every column. Each answer is tested on physics, exactly as proposed. Kept = legal and faster.

| | Plain | + corrections | + corrections + memory |
|---|---|---|---|
| No AI (random change) | 3/30 | | |
| Haiku 4.5 | 9/30 | 10/30 | **23/30** |
| Sonnet 5.5 | 19/30 | 19/30 | 22/30 |
| Opus 5.5 | 16/30 | 22/30 | **23/30** |
| Memory only, no model | | | 26/30 |

Memory alone picks a safe past change more often, but the models gain 4 to 5 times more lap time per idea (0.063 to 0.070 s against 0.015 s). Files: [`concept/exam/`](concept/exam/) (`results-*.json`).

Haiku in detail:

| | No AI (random change) | Haiku | Haiku + physics corrections |
|---|---|---|---|
| Kept as proposed | 3/30 | 9/30 | **10/30** |
| Legal as proposed | 30/30 | 17/30 | **25/30** |
| Average time gained per idea | 0.002 s | 0.019 s | **0.031 s** |

**The control, which we report because it matters:** with a 20 ms test, our engine plus random ideas reaches pole in fewer laps (about 300, mean of 8 seeds) than our engine plus Claude (about 800, mean of 3 runs). Testing is cheap enough that brute force wins. Full numbers: [`docs/concept/TESTS_TO_POLE.md`](docs/concept/TESTS_TO_POLE.md).

### Which model is the best race engineer? The Model GP

Every model runs through the same harness: the same frozen prompt, the same engine, the same physics corrections and the same shared memory (8,261 approved changes; the exam situations are held out). Each one gets 150 physics laps, three times. Then their best cars race on Silverstone. On the site: **2 Which AI is best?**, then **Race them**.

| | Median best lap | vs real pole |
|---|---|---|
| GPT-6 Luna (OpenAI route via Mubit) | **87.818 s** | -0.293 s |
| Sonnet 5.5 | 87.941 s | -0.170 s |
| No AI (random directions, same engine) | 87.961 s | -0.150 s |
| Opus 5.5 | 88.244 s | +0.133 s |
| Haiku 4.5 | 88.315 s | +0.204 s |

Two models beat the no-AI control, two did not. We show that as it came out. Three seeds is a small sample; the full table, every seed and every call is in [`concept/gp/data/`](concept/gp/data/).

### Mubit's models

| Task | Trained on | Mubit's own test | Status |
|---|---|---|---|
| Designer v1 | 98 examples | 5/19 (26%), not passed | Mubit kept Claude answering |
| Designer v1 | 4,115 physics-approved examples, from 48,250 decisions | not run yet | sent; waiting for Mubit to train |
| Compact | 6,073 physics-approved, from 24,975 | not run yet | sent; waiting for Mubit to train |
| Action (one code per answer) | 16,981 physics-approved, from 48,878 | not run yet | sent; built so a small model can match Claude exactly |

Mubit scores its small model by how often it gives exactly Claude's answer. A free-text design answer is hard to match word for word, so we added two shorter answer formats for the same job. Source: Mubit console, 24 and 25 October; the examples are in [`docs/concept/loop-runs/`](docs/concept/loop-runs/) (`trained-harvest*`, `trained-compact-harvest`, `trained-action-harvest`). No call in any log was answered by a Mubit adapter yet, so there is no trained-model score to show.

**When Mubit's designer v1 adapter is live,** the trained model takes the same 30-question exam, in all three columns, with one command (untrained calls, repeated until the adapter answers; graded on the physics sim like every other column):

```bash
node concept/exam/adapter-exam.js        # --dry prints the steps without running them
```

## Honest limits

- The simulator is a simplified physics model. On laps it was not fitted to, its speed is off by about 10 km/h on average. The aero gains from new concepts are estimates.
- Results are model predictions, not claims about a real car.
- **Equation I**, the 3D game that the Silverstone replay runs in, was written before the event (`js/`, `css/`, `assets/`, `index.html`). Everything else was built this weekend.

## For developers

```bash
npm ci && npm test
```

Design docs live in [`docs/`](docs/). Start with [`docs/concept/ENGINE_V2.md`](docs/concept/ENGINE_V2.md) and [`docs/EVAL_GUARDRAILS.md`](docs/EVAL_GUARDRAILS.md).
