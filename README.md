# PURPLE

**An F1 engineer that learns from physics, through Mubit.**

**Try it: https://purple-wine.vercel.app**

The site opens on a replay of a real recorded run. Every decision you see was a live Mubit call. To start a new live run, you need the team passcode; we give it to the judges directly, and it is never in this repo.

Built at Night Shift London, 24–25 October 2026.

---

## What it does

1. **Claude, through Mubit, proposes a change** to the 2026 Red Bull RB22: a new sidepod concept, a bigger rear wing, a lower floor. It keeps the RB22's own engine.
2. **Physics checks it.** First the 2026 FIA rules, then a lap of Silverstone on our physics simulator. The car on screen changes shape as it improves.
3. **Physics decides what Mubit learns.** If an idea is legal and faster, it becomes a Mubit training example. If it isn't, the verdict goes back into the next call as a correction, and the idea is never trained on.

The goal is the real 2026 Silverstone pole: Antonelli, 88.111 s.

You can watch the best car lap Silverstone against the real 2026 grid, or drive it yourself: **Watch on Silverstone →**, then **Drive it**.

## Why use AI, and not just an algorithm?

On our simulator, one test takes about 20 milliseconds, so a plain algorithm does fine. We measured it (below). A real team's test takes hours, and it only gets a limited number of them. When every test counts:

- **Claude's ideas pass physics three times as often as random changes do:** 10/30 vs 3/30 on 30 car situations it had never seen.
- **They gain about 20 times more lap time per test.**
- **It explains every change in plain engineering language.**
- **You can correct it in plain English.** Feeding the physics verdicts back cut its illegal ideas from about 64 per run to 3–8.

Mubit then takes only the physics-approved decisions and trains a smaller model that the team owns.

## Where Mubit sits

- **Every model call goes through Mubit.** There is exactly one call site, [`server/mubit.js`](server/mubit.js), and a test fails if any other file names Mubit's address. Every decision in the app shows its Mubit request ID.
- **Mubit tasks:**
  - the concept designer (Claude Haiku 4.5, frozen prompt), plus two shorter answer formats for the same job (compact and action);
  - the research engineer from the first night;
  - the Model GP and the exams call other models through the same gateway, untrained.
- **Trained calls:** 2,022 designer + 99 research.
- **Physics-approved training examples:** 4,115, taken from 48,250 designer decisions. Every call is first made untrained. Only the ones physics approves are sent again as trained calls; the model answers at temperature 0, so it gives the same answer.

## Results

All lap times come from our physics lap sim of Silverstone. They are model predictions, not a real car's lap. Real lap times come from OpenF1, 2026 qualifying.

| | Lap |
|---|---|
| RB22 as raced (sim) | 88.745 s |
| Real pole (Antonelli) | 88.111 s |
| Best car from a live Mubit-directed run | **87.698 ± 0.122 s** |

**The exam:** 30 car situations the engineer never saw, each answer tested on physics.

| | No AI (random change) | Claude | Claude + physics corrections |
|---|---|---|---|
| Kept as proposed | 3/30 | 9/30 | **10/30** |
| Legal as proposed | 30/30 | 17/30 | **25/30** |
| Average time gained per idea | 0.002 s | 0.019 s | **0.031 s** |

**The control, which we report because it matters:** with a 20 ms test, our engine plus random ideas reaches pole in fewer laps (about 300) than our engine plus Claude (about 800). Testing is cheap enough that brute force wins. Full numbers: [`docs/concept/TESTS_TO_POLE.md`](docs/concept/TESTS_TO_POLE.md).

**Which model is the best race engineer? The Model GP.** Every model runs through the same harness: the same frozen prompt, the same engine, the same physics corrections and the same shared memory of 8,261 physics-approved decisions (the exam situations are held out). Each one gets 150 physics laps, three times. Then their best cars race on Silverstone. Open it from the homepage: **Model GP →**, then **Race them**.

| | Median best lap | vs real pole |
|---|---|---|
| GPT-6 Luna (OpenAI route via Mubit) | **87.818 s** | -0.293 s |
| Sonnet 5.5 | 87.941 s | -0.170 s |
| No AI (random directions, same engine) | 87.961 s | -0.150 s |
| Opus 5.5 | 88.244 s | +0.133 s |
| Haiku 4.5 | 88.315 s | +0.204 s |

Two models beat the no-AI control, two did not. We show that as it came out. Three seeds is a small sample; the full table, every seed and every call is in [`concept/gp/data/`](concept/gp/data/).

**The exam with shared memory:** the same 30 held-out situations, each answer tested on physics, kept as proposed.

| | Plain | + corrections | + corrections + memory |
|---|---|---|---|
| No AI (random change) | 3/30 | | |
| Haiku 4.5 | 9/30 | 10/30 | **23/30** |
| Sonnet 5.5 | 19/30 | 19/30 | 22/30 |
| Opus 5.5 | 16/30 | 22/30 | **23/30** |
| Memory only, no model | | | 26/30 |

Memory alone picks a safe past change more often, but the models gain 4 to 5 times more lap time per idea (0.063 to 0.070 s against 0.015 s).

**Mubit's models:**

| Task | Trained on | Mubit's own test | Status |
|---|---|---|---|
| Designer v1 | 98 examples | 5/19 (26%), not passed | Mubit kept Claude answering |
| Designer v1 | 4,115 physics-approved examples, from 48,250 decisions | not run yet | sent; waiting for Mubit to train |
| Compact | 6,073 physics-approved, from 24,975 | not run yet | sent; waiting for Mubit to train |
| Action (one code per answer) | 16,981 physics-approved, from 48,878 | not run yet | sent; built so a small model can match Claude exactly |

Mubit scores its small model by how often it gives exactly Claude's answer. A free-text design answer is hard to match word for word, so we added two shorter answer formats for the same job. Source: Mubit console, 24 and 25 October.

## Honest limits

- The simulator is a simplified physics model. On laps it was not fitted to, its speed is off by about 10 km/h on average. The aero gains from new concepts are estimates.
- Results are model predictions, not claims about a real car.
- **Equation I**, the 3D game that the "watch on Silverstone" replay runs in, was written before the event (`js/`, `css/`, `assets/`, `index.html`). Everything else was built this weekend.

## For developers

```bash
npm ci && npm test
```

Design docs live in [`docs/`](docs/). Start with [`docs/concept/ENGINE_V2.md`](docs/concept/ENGINE_V2.md) and [`docs/EVAL_GUARDRAILS.md`](docs/EVAL_GUARDRAILS.md).
