# PURPLE — Agent Instructions

Version 1.0 · 2026-10-23 · Read this first. It is short on purpose; it points at the documents that hold the detail.

## 0. What this is

PURPLE is an autonomous F1 engineering research lab built as a new layer on top of **Equation I**, an existing browser F1 game by the same team. It is a 24-hour hackathon build (Night Shift, London, built around Mubit). Submission: MP4 ≤ 3 min + PDF deck by **Saturday 2026-10-24 23:59 London**; hard code freeze **Sunday 05:00**. Live demo Sunday morning.

## 1. Read order

1. `INSTRUCTIONS.md` (this file)
2. `PRD.md` — what we are building, feature IDs `F-xx`, what is out of scope
3. `ARCHITECTURE.md` — data shapes, routes, the aero map, the Mubit contract, the game hooks. **Wins every conflict.**
4. `ROADMAP.md` — phases `P0`–`P4` with timed tasks and exit criteria
5. `TASK_LOG.md` — current state; update it after every task
6. `TESTING_GUIDE.md`, `EVAL_GUARDRAILS.md`, `DESIGN_SYSTEM.md` — as the task needs them

## 2. Operating loop

1. Open `TASK_LOG.md`, take the first unblocked task of the current phase, mark it `in_progress`.
2. Read the task's referenced sections before writing code.
3. Build it. Run its verify step from `TESTING_GUIDE.md`.
4. Append to `TASK_LOG.md`: what changed, which verify passed, any decision made.
5. Commit with the task ID in the message (`P0.T3: expose EI.buildSpeedProfile with aero`).
6. Do not start the next phase until the current phase's exit criteria are all true.

## 3. Repo setup (first task of P0, do it exactly)

```bash
# new public repo, created on GitHub first, named "purple"
git clone https://github.com/<org>/purple.git && cd purple
# bring in the game as the base layer (pre-existing tooling, declared)
git clone --depth 1 https://github.com/rayhankhilji/equation-i.git /tmp/ei
rsync -a --exclude .git /tmp/ei/ ./
git add -A && git commit -m "P0.T0: import Equation I as the base layer (pre-existing tooling)"
mkdir -p lab server data && touch data/.gitkeep
```
README must open with: *"PURPLE is built on Equation I (pre-existing, by this team). Everything under `lab/`, `server/`, and the hooks listed in ARCHITECTURE §9 was written during Night Shift."*

## 4. Stack (no substitutions)

| Layer | Exactly |
|---|---|
| Game | Equation I as imported: plain JS, three.js r128 (`vendor/three.min.js`), no build step |
| Lab UI | plain JS/CSS in `lab/`, loads the game's scripts in the same order as `index.html` |
| Evaluator | `lab/evaluator.js` + `lab/aero.js`, plain JS, dual browser/Node |
| Server | Node 22, `hono`, `@hono/node-server`, `@anthropic-ai/sdk`, `dotenv`, `ulid` |
| Storage | JSONL/JSON files in `data/` |
| LLM | `claude-haiku-4-5` through Mubit's Anthropic path, temperature 0, server-side only |
| Tests | `node --test` (built-in), no extra framework |

No TypeScript, no bundler, no React, no database, no other model, no Mubit SDK. The game has no build step and neither do we.

## 5. Structure

```
purple/
  index.html, js/, css/, vendor/, assets/   # Equation I (base layer; touch only files named in ARCHITECTURE §9)
  lab/
    index.html        # the lab page (side panel + 3D view + game iframe)
    lab.js, lab.css
    aero.js           # setup -> multipliers + legality (ARCHITECTURE §8)
    evaluator.js      # evaluate(circuit, setup, conditions) -> Evaluation
    prompt.js         # SYSTEM_PROMPT, frozen; PROMPT_VERSION constant
    schema.js         # validatePlanOutput(), validateSetup()
  server/
    index.js          # hono app, routes from ARCHITECTURE §5
    mubit.js          # the one place that calls Mubit
    game-headless.js  # loads util/track data/track/ai into Node with a THREE stub
    scenarios.js      # generator for collection + exam truth
    .env.example
  data/               # ledger.jsonl calls.jsonl rules.json exam.json status.json
  test/               # node --test files
  docs/               # the build docs (this set) + deck sources
```

## 6. Commands

```bash
npm ci                      # install (lockfile committed)
npm run dev                 # server :8787 + static :8788
npm test                    # node --test test/
npm run collect -- --n 50   # scenario generator -> /api/plan, concurrency 2
npm run exam                # 20 exam calls on the provider, not trained
npm run smoke               # one Mubit call with x-middleware-record: metadata, prints request id
```

## 7. Coding standards

- Match the game's style: one IIFE per file attaching to `window.EI`, `const`, early returns, dense but commented. Lab files may use ES2022 (optional chaining, etc.); the game's files keep their existing style.
- Every number that is a model assumption lives in `lab/aero.js` with a comment naming its source or reasoning. No magic numbers in UI or server.
- Deterministic: anything random takes a seed (`seed` is on every ledger row).
- All server responses use the envelope in ARCHITECTURE §5. All errors have a `code` from that list.
- Log one line per Mubit call to stdout: `plan exp-01J… mreq_… 812ms promote`. Never log the key or full prompts.
- Keep each `/api/plan` input under 350 tokens (ARCHITECTURE §4.5). Shorten before adding.

## 8. Prohibited

- Changing `lab/prompt.js` text, the model ID, `max_tokens`, or adding tools/`response_format` after the first real call. This creates a new Mubit task at 0 examples. If a change is unavoidable, it is a team decision logged in `TASK_LOG.md` Decisions with the time.
- Calling Mubit or any LLM from the browser.
- Editing calibration constants in `js/car.js` / `js/ai.js` globally. Aero is per-car and opt-in.
- Sending debugging, exam or test calls without `x-middleware-record: metadata`.
- Claiming CFD, wind-tunnel or "aerodynamically validated" anywhere in UI, deck or README. The label is "reduced-order lap model, calibrated to 2026 pole laps".
- Adding circuits beyond Silverstone (P0) and Monza (P1), parameters beyond the five, or any P2 feature.
- `rm -rf` of game folders; rewriting game files not listed in ARCHITECTURE §9.
- Committing `server/.env` or anything under `data/` except `.gitkeep` and `exam.json`.

## 9. When stuck

- A Mubit call fails: read the `code` (ARCHITECTURE §7.1; docs.mubit.ai/troubleshooting). `starter_credit_model` → the model isn't served, see PRD A3 and stop; `starter_credit_busy` → wait `retry-after`, retry once.
- The task isn't training: open **Tasks** in the console and read the status line verbatim into `TASK_LOG.md` Blockers. "Waiting for more examples" → run `npm run collect`. "examples too long" → cut the scenario.
- The evaluator disagrees with the race by > 25 %: check that the bot's profile was built with the same `aero` (ARCHITECTURE §9, `profileFor` cache key) before touching the aero map.
- Anything that would change ARCHITECTURE: write the proposed change in `TASK_LOG.md` Decisions and ask the dev lead; do not silently diverge.
- The Mubit team (Eldar, Anil) is at the venue. For anything about corrections, training budget or Try models, ask them in person before guessing.
