# PURPLE docs: what to read

The product, its results and its limits are in the [project README](../README.md). This page says which docs describe the product as it is now, and which are earlier plans kept for history.

## The current product

| Doc | What it covers |
|---|---|
| [`../README.md`](../README.md) | The product, the results, Mubit's models, honest limits, how to run it |
| [`video-script.md`](video-script.md) | The 2-minute submission video, with the source of every number on screen |
| [`concept/ENGINE_V2.md`](concept/ENGINE_V2.md) | The engine: one decision, screen and confirm, the design tree, parallel rounds, the "kept" training rule, shared memory (§10) |
| [`concept/TESTS_TO_POLE.md`](concept/TESTS_TO_POLE.md) | The engine with a model against no AI and a standard optimiser, in physics laps to pole; corrections (§9) |
| [`EVAL_GUARDRAILS.md`](EVAL_GUARDRAILS.md) | The rules that still hold: Mubit task integrity, security, cost, honesty (§2 to §5) |
| [`DEPLOY.md`](DEPLOY.md) | The live site on Vercel: routes, environment variable names, limits |
| [`concept/loop-runs/`](concept/loop-runs/) | The logs of the live runs and the training harvests (every call, its request ID, every verdict) |

Reference for the parts the engine is built on:

| Doc | What it covers |
|---|---|
| [`concept/SIM.md`](concept/SIM.md) | The physics lap sim of Silverstone and how it was fitted |
| [`concept/FIA_CHECKLIST.md`](concept/FIA_CHECKLIST.md) | Every FIA 2026 rule the rules check enforces, with its test |
| [`concept/RACE.md`](concept/RACE.md) | Step 4: the best cars on the game's 3D Silverstone, and Drive it |
| [`concept/RB22_SHEET.md`](concept/RB22_SHEET.md), [`concept/REDBULL.md`](concept/REDBULL.md), [`concept/REDBULL-DERIVED.md`](concept/REDBULL-DERIVED.md) | The Red Bull RB22 start car: public data and values derived from telemetry |
| [`concept/DATA.md`](concept/DATA.md), [`concept/TRACK.md`](concept/TRACK.md), [`concept/IDENTIFY.md`](concept/IDENTIFY.md), [`concept/PRIORS.md`](concept/PRIORS.md) | Silverstone, the 2026 grid and the rules: sources and fits |
| [`concept/CONCEPT.md`](concept/CONCEPT.md), [`concept/COUPLING.md`](concept/COUPLING.md), [`concept/MASS.md`](concept/MASS.md), [`concept/MATERIALS.md`](concept/MATERIALS.md), [`concept/FACTORS.md`](concept/FACTORS.md), [`concept/REDESIGNS.md`](concept/REDESIGNS.md) | The concept car: parts, masses, materials, set-up and concept families |
| [`concept/SURROGATE.md`](concept/SURROGATE.md), [`concept/WEEKEND.md`](concept/WEEKEND.md), [`concept/VIEW.md`](concept/VIEW.md) | The fast estimate used to screen ideas, the race weekend model, the 3D car |
| [`equation-i/README.md`](equation-i/README.md) | Equation I, the team's older browser game that the 3D Silverstone runs in |

The code for the Model GP is in [`../concept/gp/`](../concept/gp/), the exam in [`../concept/exam/`](../concept/exam/).

## History

Kept so the work can be traced. Each one that could mislead has a status line at the top.

| Doc | What it was |
|---|---|
| [`PRD.md`](PRD.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`ROADMAP.md`](ROADMAP.md), [`INSTRUCTIONS.md`](INSTRUCTIONS.md), [`TESTING_GUIDE.md`](TESTING_GUIDE.md), [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | The first night's plan for the research lab (`/lab/`, no longer linked from the site). ARCHITECTURE §9, the game files the project may touch, still applies. |
| [`concept/DESIGNER.md`](concept/DESIGNER.md), [`concept/LOOP.md`](concept/LOOP.md), [`concept/DASHBOARD.md`](concept/DASHBOARD.md) | The concept designer and its first loop with Mubit, before the engine replaced them |
| [`concept/CAMPAIGN.md`](concept/CAMPAIGN.md) | The optimiser campaign of 24 October, with no language model in the loop |
| [`demo-script.md`](demo-script.md) | The 24 October live demo plan |
| [`checkins/`](checkins/) | The check-ins posted during the event |
| [`deck/`](deck/) | 24 October presentation material, not part of the submission |
| [`try-models/`](try-models/), [`ledger-snapshot/`](ledger-snapshot/) | The research lab's hand-scoring sheet and ledger snapshots |
| [`TASK_LOG.md`](TASK_LOG.md), [`agents/`](agents/) | The team's working log and the parallel agent lanes |
