# PURPLE

**An F1 engineer that learns from physics, through Mubit.**

**Try it: https://purple-wine.vercel.app** · Built at Night Shift London, 24 and 25 October 2026.

A language model proposes a change to the 2026 Red Bull RB22. The FIA 2026 rules and a physics lap sim of Silverstone decide if it is legal and faster. The verdict goes back into the next Mubit call, and only the ideas physics approved become Mubit training examples.

## What you see on the site

| Step | Page | What it shows |
|---|---|---|
| 1 Mubit engineer | `/concept/lab/` | The engine redesigning the RB22. A replay of a recorded live run opens first; **Go live** starts a new run (no passcode, rate limited). Pick the model next to Go live. The **Exam** tab holds the 30-problem exam. |
| 2 Which AI is best? | `/concept/gp/` | The Model GP: the same harness with five entrants. Last night's recorded race, or run all five live at once. |
| 3 vs no AI | `/concept/compare/` | The engine with the model against a standard optimiser and random changes, on one clock of physics laps. |
| 4 Race & drive | `/concept/race/` | The best cars on a qualifying lap of Silverstone in 3D against the real 2026 grid; then drive one yourself. |

Every decision card shows its Mubit request ID.

## Who uses it

A race team's performance or aero engineer. Every week they decide what to test next, and the rules give them a fixed testing allowance, so a test spent on a bad idea is gone.

- **Fewer wasted tests.** On 30 car situations it had never seen, Claude Haiku 4.5 with our harness proposed a legal, faster change 23 times out of 30. Random changes managed 3/30.
- **Ideas that come with reasons.** Every proposal says what it changes, why, and what it expects. The physics verdict sits next to it.
- **Corrections that stick.** A verdict goes into the next call, so the same illegal idea is not proposed again and again.
- **A model the team owns, once Mubit trains it.** Only physics-approved decisions are sent to Mubit as training examples. No trained model has passed yet ([Mubit's models](#mubits-models)).

## Why Mubit is central

- **One call site.** Every model call goes through [`server/mubit.js`](server/mubit.js). A test fails if any other JavaScript file names Mubit's address, and another checks the browser never calls Mubit.
- **The model is swappable.** `POST /api/concept/engine/run` takes `model`, an id from [`concept/gp/entrants.json`](concept/gp/entrants.json): Claude Haiku 4.5 (default), Claude Sonnet 5.5, Claude Opus 5.5, ChatGPT (GPT-6 Luna, through Mubit's OpenAI route), or No AI (the control, no call). Every model gets the same frozen prompt and the same message; only the model id changes, plus the temperature or token setting where a model needs it ([`server/campaign-route.js`](server/campaign-route.js) `entrantOf`, [`test/model-switcher.test.js`](test/model-switcher.test.js)).
- **Physics decides what Mubit learns.** Every call is first made untrained (`x-middleware-record: metadata`). Only decisions physics approved are re-sent as identical trained calls, and only on the default Haiku task. Other models always run untrained.
- **Every answer is traceable.** Each decision stores its Mubit request ID; the replays on the site are made of real calls.

## How a physics verdict changes a later answer

This works in our harness today at two levels. The third level, Mubit's own model, waits for Mubit to train.

1. **Inside a run: corrections.** Every verdict so far (what was kept, what was rejected, which values were illegal and the legal range) goes into the next call ([`concept/engineer/scenario.js`](concept/engineer/scenario.js), the `corrections` block). Same start car, same model, seed 11: without it, Claude asked to shrink the sidepod inlet from 650 to 640 or 630 cm² 47 times in 120 decisions, illegal every time. With it, once in 118 decisions; it moved the inlet up to 670 to 700 cm² instead. Illegal ideas per run fell from 64 to 3 to 8.
2. **Across runs: shared memory.** Physics-approved decisions from earlier runs are built into an index ([`concept/engineer/memory/build.js`](concept/engineer/memory/build.js)): 8,261 distinct approved changes from 10,183 approved decisions. Each call carries the most similar ones as precedents ([`concept/engineer/memory.js`](concept/engineer/memory.js)). The index is rebuilt offline, so a run's own approvals reach it at the next rebuild. Example, held-out exam question 29 (start car 88.224 s): with corrections only, Haiku proposed a wider rear wing and a wider front wing, 0.303 s slower. With the precedent "sidepods undercut 100 → 140 mm, legal, −0.094 s" in the call, it proposed that change plus two small ones: legal and 0.117 s faster.
3. **In Mubit's model: pending.** 27,169 approved decisions were sent to Mubit as trained calls. When Mubit trains an adapter from them, the same exam runs on it with one command.

## Results

All lap times come from our physics lap sim of Silverstone: model predictions, not a real car's lap. Real lap times come from OpenF1, 2026 qualifying.

### Best car against the real pole

| | Lap |
|---|---|
| RB22 as raced (physics lap sim) | 88.745 s |
| Real pole, Antonelli (OpenF1) | 88.111 s |
| Best car from a live Mubit-directed run (seed 11, 120 calls; physics lap sim) | **87.698 ± 0.122 s** |

### The exam: the same model with and without our harness

30 held-out car situations, the same for every row. Each answer is tested on physics exactly as proposed. Kept = legal and faster.

| | Plain | + corrections | + corrections + memory |
|---|---|---|---|
| No AI (random change) | 3/30 | | |
| Claude Haiku 4.5 | 9/30 | 10/30 | **23/30** |
| Claude Sonnet 5.5 | 19/30 | 19/30 | 22/30 |
| Claude Opus 5.5 | 16/30 | 22/30 | **23/30** |
| Memory only, no model | | | 26/30 |

Memory alone picks a safe past change more often, but the models gain about four times more lap time per idea: 0.063 to 0.070 s against 0.015 s. With corrections alone, Haiku's ideas gain 0.031 s per idea against 0.002 s for random changes, and 25/30 are legal as proposed (17/30 without).

### Which AI is best? The Model GP

Every entrant runs through the same harness: the same frozen prompt, engine, physics corrections and shared memory (8,261 approved changes; the exam situations are held out).

**Recorded race** (150 physics laps per run, 3 seeds, median best lap):

| | Median best lap | vs real pole |
|---|---|---|
| ChatGPT (GPT-6 Luna, OpenAI route via Mubit) | **87.818 s** | −0.293 s |
| Claude Sonnet 5.5 | 87.941 s | −0.170 s |
| No AI (random directions, same engine) | 87.961 s | −0.150 s |
| Claude Opus 5.5 | 88.244 s | +0.133 s |
| Claude Haiku 4.5 | 88.315 s | +0.204 s |

**Live race** on the deployed site, 25 October morning (all five at once, 100 generations each = 5 ideas × 20 rounds, about 4 minutes, 0 errors): Opus 87.593 s, No AI 87.620, Sonnet 87.627 (99/100 generations), ChatGPT 87.664 (95/100, stopped at the time limit), Haiku 87.763.

**What this shows, honestly:** the order changes from run to run, and the No-AI control is close every time. The claim is not "model X is best". It is that Mubit makes the model swappable and every model can be measured on the same harness, against the same physics.

### The control

With a 20 ms test, our engine plus random ideas reaches pole in fewer laps (about 300, mean of 8 seeds) than our engine plus Claude (about 800, mean of 3 runs). When testing is that cheap, brute force wins. A real team's test takes hours and is rationed; that is where 23/30 against 3/30 matters. Full numbers: [`docs/concept/TESTS_TO_POLE.md`](docs/concept/TESTS_TO_POLE.md).

## Mubit's models

| Task | Trained on | Mubit's own test | Status |
|---|---|---|---|
| Designer v1 | 98 examples | 5/19, not passed | Mubit kept the provider model answering |
| Designer v1 | 4,115 physics-approved, from 48,250 decisions | not run yet | sent; waiting for Mubit to train |
| Compact | 6,073 physics-approved, from 24,975 decisions | not run yet | sent; waiting for Mubit to train |
| Action (one code per answer) | 16,981 physics-approved, from 48,878 decisions | not run yet | sent; built so a small model can match exactly |

Total: 27,169 physics-approved trained calls. The model answers at temperature 0, and the trained re-send gave the same answer as the approved call 27,124 times. Mubit scores its small model by how often it matches the provider's answer exactly; a free-text design is hard to match word for word, so we added the two shorter formats for the same job.

No call in any log was answered by a Mubit adapter, so there is no trained-model score. When the designer adapter is live, it takes the same 30-problem exam with one command:

```bash
node concept/exam/adapter-exam.js        # --dry prints the steps without running them
```

## Honest limits

- The simulator is a simplified physics model. On laps it was not fitted to, its speed is off by about 10 km/h on average. Aero gains from new concepts are estimates.
- Results are model predictions, not claims about a real car.
- Three seeds and one live run are small samples, and the No-AI control is close.
- Mubit has not trained a passing model yet. Every answer so far came from the provider model.
- The 3D Silverstone runs in **Equation I**, the team's older browser game, written before the event (`js/`, `css/`, `assets/`, `index.html`). Everything else was built this weekend.

## For developers

```bash
npm ci && npm test                  # the full test suite, no keys, no network
MUBIT_MOCK=1 npm run dev            # the whole site on http://127.0.0.1:8788/concept/lab/, live calls off
node concept/engineer/cli.js --mock scripted --seed 11 --max-decisions 5 --budget 300 --memory on --out /tmp/purple-e2e
```

The last command runs five decisions of the real engine in about 15 s with a scripted stand-in in Mubit's place: call text with corrections and precedents, rules check, physics laps, keep or revert. It prints one line per decision and writes the logs to `/tmp/purple-e2e/run-seed11/`. [`test/engineer-record-good.test.js`](test/engineer-record-good.test.js) drives the API route with a stub Mubit and checks that only an approved decision makes one extra trained call.

### The main path in the code

One live decision, end to end:

1. **Browser:** [`concept/lab/mubit-first.js`](concept/lab/mubit-first.js) (Go live) posts to `/api/concept/engine/run`.
2. **API route:** [`server/campaign-route.js`](server/campaign-route.js) picks the model (`entrantOf`) and starts the engine with the designer caller from [`server/concept.js`](server/concept.js).
3. **Engine:** [`concept/engineer/engine.js`](concept/engineer/engine.js) builds the call from the current car, the run so far and the corrections ([`scenario.js`](concept/engineer/scenario.js)), plus the shared memory when it is on ([`memory.js`](concept/engineer/memory.js); on in the Model GP and the exam).
4. **Mubit:** [`server/mubit.js`](server/mubit.js) sends the frozen designer task ([`concept/designer/prompt.js`](concept/designer/prompt.js): Claude Haiku 4.5, temperature 0) untrained, with `x-middleware-record: metadata`. Another model keeps the same prompt with only the model swapped.
5. **Rules:** the answer is parsed and checked against the 2026 FIA technical rules, the homologated power unit and materials ([`concept/regs.js`](concept/regs.js)).
6. **Physics:** hundreds to thousands of versions of the idea are screened, and the best legal ones are run on the physics lap sim ([`concept/bench.js`](concept/bench.js) → [`concept/sim/index.js`](concept/sim/index.js)). The car is kept only if it is legal and faster ([`concept/engineer/tree.js`](concept/engineer/tree.js)).
7. **Learning:** an approved decision of the default task is re-sent as the identical trained call ([`concept/engineer/record-good.js`](concept/engineer/record-good.js)); every verdict goes into the next call's corrections.

More design notes: [`docs/README.md`](docs/README.md) maps which docs describe the current product.

## History

First night: a research lab on top of Equation I (`/lab/`, no longer linked from the site). Then a concept car designer with Mubit in the loop, then the autonomous engine with corrections and shared memory, then the model-agnostic Model GP.

## Sources

- Exam: [`concept/exam/results-*.json`](concept/exam/) (`summary.direct_kept`, `legal`, `direct_mean_gain_s`).
- Model GP, recorded: [`concept/gp/data/summary.json`](concept/gp/data/summary.json) and one file per entrant and seed.
- Model GP, live: the integrator's run on https://purple-wine.vercel.app, 25 October about 05:30 GMT. Not stored in the repo; a new live run will give different times.
- Best car 87.698 ± 0.122 s: [`docs/concept/loop-runs/trained-engineer-seed11/band.json`](docs/concept/loop-runs/trained-engineer-seed11/band.json). RB22 88.745 s and pole 88.111 s: `concept/gp/data/summary.json` (`baseline_s`, `pole_s`).
- Corrections (47 in 120, once in 118, 64 to 3 to 8): [`docs/concept/loop-runs/trained-engineer-seed11`](docs/concept/loop-runs/trained-engineer-seed11), [`trained-corrections-seed11`](docs/concept/loop-runs/trained-corrections-seed11), [`docs/concept/TESTS_TO_POLE.md`](docs/concept/TESTS_TO_POLE.md) §9.
- Shared memory 8,261 / 10,183: [`concept/engineer/memory/approved.json`](concept/engineer/memory/approved.json), [`docs/concept/ENGINE_V2.md`](docs/concept/ENGINE_V2.md) §10.
- Trained calls: `good.jsonl` and `README.md` in [`docs/concept/loop-runs/`](docs/concept/loop-runs/) `trained-harvest`, `-2`, `-3`, `trained-compact-harvest`, `trained-action-harvest`. Mubit's 5/19: Mubit console, 24 October.
- Control (about 300 vs about 800 laps): [`docs/concept/TESTS_TO_POLE.md`](docs/concept/TESTS_TO_POLE.md).
