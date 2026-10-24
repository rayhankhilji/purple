PURPLE is built on Equation I (pre-existing, by this team). Everything under `lab/`, `server/`, `concept/`, and the hooks listed in ARCHITECTURE §9 was written during Night Shift.

# PURPLE

PURPLE is an agent-driven F1 engineering research lab that chases purple sectors (the fastest sector of a session). A research agent, an LLM routed through Mubit, proposes a setup change to a parametric car. A reduced-order lap model scores it in milliseconds, on the game's time scale (80.800 s game time = real 2026 Silverstone pole 88.111 s). The game races baseline against candidate. A human engineer overrules bad decisions, and those corrections enter the task input as pit-wall rules (rule-conditioned learning); the kept examples train the next adapter version through Mubit. The agent's decision has a model-defined answer (the reduced-order lap model), so "did the correction help?" is a count, not an opinion.

Built for Night Shift, London, 2026-10-24. Judges: the Mubit team.

## How Mubit is used

- **One recurring task.** Mubit task **"Research engineer of F1"**. Input: baseline and candidate setups, the evaluator's lap and sector deltas, active pit-wall rules, the last 3 experiments. Output: strict JSON with a verdict and the single next experiment.
- **One model, one frozen prompt.** `claude-haiku-4-5` (served as `claude-haiku-4-5-20251001`), temperature 0, through the Mubit gateway, called from `server/mubit.js` only. The prompt in `lab/prompt.js` is pinned by sha256 `6c5be1a3f4ed0f5fb21226363fa3524404996558628bc8cba119677dfc37ce6a` (PROMPT_VERSION 1). `npm test` and `npm start` fail if it changes.
- **Trained vs untrained calls.** 99 trained calls: 57 on Friday (43 kept examples, console shows Training v1), 1 demo experiment, 41 on Saturday for v2. 61 untrained calls (smoke test, exam runs) carry `x-middleware-record: metadata` and train nothing. Source: `calls.jsonl` in the frozen snapshot `docs/ledger-snapshot/2026-10-24_02-37-26Z-0530-windcap-exam/` (the live `data/` ledger is gitignored).
- **Corrections are rule-conditioned learning.** The engineer's overrule becomes a pit-wall rule. The rule enters the task input (the newest 3 active rules are sent). The provider's answers change. Those kept examples train the next adapter version. There is no gradient from the engineer's click. Rule R-01: *"Weigh straight-line drag against corner gain; judge on full-lap delta."*
- **v1 and v2 adapters.** v1 trained on the Friday collection. Our seeding bug made 50 of 53 candidates front-wing moves; it is fixed. v2's 40 scenarios carry R-01 in every input and span all five parameters.
- **Exam.** 20 scenarios, truth from the evaluator. The 8 hardest go to Mubit **Try models** by hand (`docs/try-models/README.md`). Scores are counts, n/8, never percentages. The provider (untrained) scores verdicts 8/8 and next experiment 2/8 on those 8 (the prompt states the verdict thresholds). exam-rw8 is the demo experiment; its call is in v2's recorded data, so it is not held out for v2. Sheet score also shown without it: n/7 (provider 7/7 verdicts, 1/7 next experiment).

**Still pending (needs the Mubit console, not invented here):**

> **[PENDING]** kept examples after v2: `___` · adapter v1 test result: `___` · adapter v2 test result: `___`
> **[PENDING]** Try models on the 8 sheet scenarios: v1 next experiment `_/8`, v1 verdict `_/8`, v2 next experiment `_/8`, v2 verdict `_/8`; without exam-rw8: v1 `_/7` / `_/7`, v2 `_/7` / `_/7`
> Source when filled: Mubit console, Tasks / Adapters / Try models, scored with `npm run exam:score`.

If v2 does not beat v1, the numbers go in as they come.

## The loop

1. **DESIGN**: the research agent proposes a setup change; the trace shows the Mubit request id.
2. **EVALUATE**: the reduced-order lap model (calibrated to 2026 pole laps · aero map v1) gives lap, sectors, top speed, Becketts minimum speed and legality, in game seconds.
3. **RACE**: baseline vs candidate, identical neutral bots, same seed, broadcast camera.
4. **LEARN**: the engineer overrules, the rule enters every later task input, Mubit trains the next version from the kept examples.

## Numbers

| Number | Value | Source label |
|---|---|---|
| Baseline lap, Silverstone | 80.800 s | evaluator: reduced-order lap model · calibrated to 2026 pole laps · aero map v1 · game time scale: the real 2026 Silverstone pole 88.111 s maps to 80.800 s |
| Demo experiment, rear wing +8°: predicted lap delta | +0.436 s (game seconds; ×1.09 ≈ +0.475 s real scale) | evaluator, same label |
| Demo experiment: measured lap delta | +0.518 s (80.742 s → 81.260 s, game seconds) | measured in race, seed 42 (3 laps, two identical neutral bots) |
| Prediction vs race | 19 % apart (target ≤ 25 %; one experiment, n = 1) | measured in race, seed 42 vs evaluator |
| Same experiment, other seeds | +0.515 s (seed 7), +0.696 s (seed 1234) | measured in race, headless; 60 % from the prediction on seed 1234 |
| Exam, full 20, verdicts | 20/20 | exam: provider untrained calls, truth from the evaluator |
| Exam, full 20, next experiment | 10/20 | exam: provider untrained calls |
| Exam, hardest 8, verdicts / next experiment | 8/8 / 2/8 | exam: provider untrained calls |
| Same sheet without exam-rw8 (the demo experiment, in v2's recorded data) | 7/7 / 1/7 | exam: provider untrained calls |
| v2 collection: agent verdict agrees with evaluator | 38 of 39 valid plans | `ledger.jsonl` in `docs/ledger-snapshot/2026-10-24T0215-after-v2/`, evaluator truth |
| Tests | 118 pass | `npm test`, no network |

The race was the only check on the evaluator. One demo experiment is a sample, not a calibration.

## Concept lab (in progress)

`concept/` lets an optimiser change the car itself, part by part, instead of five setup numbers. Not finished, off the demo's main path, and no LLM is involved.

- **Adaptable concept car.** 33 parts, 23 shape parameters: wing spans, chords, settings and element counts, straight-mode flap angles, floor, ride height, diffuser, sidepods, wheelbase, ballast.
- **FIA 2026 constraints.** A machine-readable subset of the 2026 F1 Technical Regulations, Section C, Issue 17 (28/04/2026). Each rule carries its article id. Figures not in Section C are flagged unverified (for example, nominal tyre mass is an estimate of 44 kg).
- **Part masses are labelled estimates.** Real per-part masses are not public. The baseline sums to 764.9 kg plus 5.1 kg ballast, the 770 kg qualifying minimum.
- **Optimiser.** A seeded (1+8) evolution strategy keeps a change only if it is legal and the numeric score improves. Every generation is recorded.
- **Physics lap simulator, being calibrated** to the real 2026 British GP (pole 88.111 s and speed traps). It is not merged yet. Until then the bench is the lab's own lap model scaled to real seconds, which places the baseline at the real pole by construction. It ranks changes. It does not say where a 2026 car would qualify.
- **What it measured so far.** Label: concept · reduced-order lap model · calibrated to 2026 pole laps · concept aero map v0. A 200-generation run (seed 1) ends 1.225 s under the concept baseline at Silverstone. Straight-mode gains are optimistic, and several best values sit on model edges. Read it as a ranking, not a prediction.

Details, limits and the rule-by-rule verified list: [`docs/concept/CONCEPT.md`](docs/concept/CONCEPT.md).

## Run it

Node 22 or newer.

```bash
npm ci
cp server/.env.example server/.env   # add MUBIT_API_KEY; server/.env is gitignored
npm test                             # 118 tests, no network
MUBIT_MOCK=1 npm run dev             # canned planner, no key needed
```

Open <http://127.0.0.1:8788/lab/> (API on 127.0.0.1:8787). Mock mode writes to `data-mock/` and never touches the real ledger.

```bash
npm run dev                          # real Mubit calls (needs the key; plan calls are trained calls)
npm run smoke                        # one untrained call, prints the mreq_ id
npm run prompt:check                 # verifies the frozen prompt sha
npm run exam:score                   # scores docs/try-models/sheet.md (verdict n/8, next step n/8)
npm run concept -- --gens 200 --seed 1 --circuits silverstone,monza --out /tmp/concept-run
npm run test:concept                 # the concept module's 21 tests
```

`npm run collect` and `POST /api/collect` send trained calls. They need an explicit confirmation flag. Read `docs/agents/HANDOVER.md` §3 first.

## Repo map

| Path | What |
|---|---|
| `lab/` | prompt (frozen), aero map, evaluator, schema, the lab page and 3D car view |
| `server/` | Hono API, Mubit client (`mubit.js`), scenario generator, ledger store, CLIs |
| `concept/` | concept car: parts, FIA rule subset, aero map v0, optimiser, CLI |
| `js/`, `css/`, `vendor/`, `assets/`, `index.html` | Equation I, the game (pre-existing; opt-in hooks in ARCHITECTURE §9) |
| `test/` | `node --test` suites, Mubit mock, baseline fixtures |
| `data/` | exam set (`exam.json`); the runtime ledger is gitignored |
| `docs/` | build docs, deck, demo script, ledger snapshots |

## Honest limits

- **The evaluator is a reduced-order lap model**, not a high-fidelity aerodynamic simulation. Its 80.800 s is the game's time scale, anchored to the real 2026 pole (88.111 s). The race is our only check on it: 19 % apart on the demo experiment, 60 % on seed 1234.
- **Corrections are rule-conditioned learning.** Nothing trains on the click itself. The v1 and v2 adapter results are pending, and v2 may not beat v1.
- **The verdict is the easy part.** The prompt states the thresholds, so the provider already gets 20/20. The next experiment is what the exam measures, and v1's data was skewed by our seeding bug.
- **The concept lab is in progress.** Part masses are estimates, the physics simulator is not merged, and its numbers rank changes only.
- **Equation I is pre-existing.** The grid race is cinematic and mixes car and driver. The baseline-vs-candidate race is the result. A real-time 3-lap race needs a laptop GPU.

## Docs

- Build docs, read first: [`docs/INSTRUCTIONS.md`](docs/INSTRUCTIONS.md), then [`docs/PRD.md`](docs/PRD.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/TASK_LOG.md`](docs/TASK_LOG.md) (decisions and session log)
- Honesty rules: [`docs/EVAL_GUARDRAILS.md`](docs/EVAL_GUARDRAILS.md) · tests: [`docs/TESTING_GUIDE.md`](docs/TESTING_GUIDE.md)
- Demo: [`docs/demo-script.md`](docs/demo-script.md) · deck source: [`docs/deck/slides.md`](docs/deck/slides.md)
- Try models scoring: [`docs/try-models/README.md`](docs/try-models/README.md) · exam sheet: [`docs/try-models/sheet.md`](docs/try-models/sheet.md)
- Concept lab: [`docs/concept/CONCEPT.md`](docs/concept/CONCEPT.md)
- Agent handover and run commands: [`docs/agents/HANDOVER.md`](docs/agents/HANDOVER.md)
- The game: [`docs/equation-i/README.md`](docs/equation-i/README.md) · credits: [`CREDITS.md`](CREDITS.md)
