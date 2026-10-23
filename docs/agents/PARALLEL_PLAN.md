# PURPLE — Parallel plan for up to 10 agents (P1 → P3)

Principle: **lanes own files, not tasks.** Two agents never edit the same file. Everything meets on `main` through PRs merged by the integrator. If a lane is idle it helps by reviewing another lane's PR against ARCHITECTURE, not by editing its files.

## 1. Lanes

| Lane | Owner (session) | Owns (exclusive) | First tasks | Then |
|---|---|---|---|---|
| INTEGRATOR | the lead agent (continue session 1 or its successor) | `docs/TASK_LOG.md`, `docs/agents/HANDOVER.md`, `README.md`, `package.json`, merges to `main`, tags | P1.T4 watch v1 (with Tanuj), merge order below | status widget values, `v1-collected` → `v2-collected` → `submitted` tags |
| GAME | agent A | `js/car.js`, `js/race.js`, `js/main.js` | P1.T1 per-car aero (car.js), P1.T2 broadcast mode `?lab=1` + `purple:result` postMessage | P3.T3 grid race (F-10) |
| SERVER | agent B | `server/app.js`, `server/index.js`, `server/scripts/*`, `test/server.test.js`, `test/mocks/*` | P1.T3 `/api/race/result` polish (exists: verify T-F04-AC2 with the real payload), `/api/collect` guard rails, status fields the UI needs | P2.T5 `npm run exam` wiring, P2.T3 overrule flow server side |
| EVAL | agent C | `lab/aero.js`, `lab/schema.js`, `lab/evaluator.js`, `server/scenarios.js`, `server/game-headless.js`, `test/aero.test.js`, `test/evaluator.test.js`, `test/schema.test.js`, `test/fixtures/*` | P2.T5 `data/exam.json` generator (20 scenarios, truth from the evaluator, ARCH §4.10); generator bias for promote examples (decision needed) | P2.T6 TD-01 + conditions semantics |
| UI | agent D (+ agent E on `lab.css` only if needed) | `lab/index.html`, `lab/lab.js`, `lab/lab.css` | P2.T1 side panel: four StageCards, ledger, trace stream (SSE), widget, buttons Run / Race it / Promote / Overrule | P2.T6 conditions bar, P3.T2 polish |
| CAR3D | agent F | `js/carmodel.js` and a new `lab/car3d.js` | P2.T2 3D car in its own scene, `rebuildWings(setup)`, hero camera | P3.T2 hero shot |
| DEMO | agent G (docs/deck) | `docs/deck/*`, `docs/demo-script.md`, `docs/ledger-snapshot/` | P3.T5 deck sources (8 slides), honesty slide text, screenshots list | P3.T6 freeze `data/` into `docs/ledger-snapshot/` |
| QA | agent H | nothing in the repo; reviews PRs, runs `npm test` + browser checks, writes `docs/agents/lanes/QA.md` | manual T-F04-AC1..3, T-F06, T-F07 checklists as PRs land | rehearsal script P4 |
| HUMAN | Tanuj | Discord `/team create`, `/checkin` #1 and #2, console reads (Tasks, Adapters, Try models), the correction in the console if offered, the video (P3.T4), `/submit` | | |

Spare agents: pair one with UI (lab.css only) and one with GAME as reviewer. Do not open a tenth lane; conflicts cost more than hands save.

## 2. Collision rules

- A lane's PR may only change its own files plus its own lane file. The integrator rejects anything else.
- Shared contracts live in ARCHITECTURE (§4 shapes, §5 routes, §9 hooks). If you need a new field or route, write it in your lane file under "Proposed contract change", ping the integrator, keep building against your proposal behind a default.
- `docs/TASK_LOG.md` and `HANDOVER.md`: integrator only. Lane files: lane only. `package.json`: integrator only (ask for a dep; the stack says no new ones).
- Game files not in ARCHITECTURE §9: nobody.

## 3. Branches and PRs

- Base: `main`. Session 1's work is on `claude/amazing-planck-804i13`; the integrator merges it to `main` first (fast-forward), then everyone branches from `main`.
- Branch name = whatever the platform assigned; PR title = task id + what (`P1.T2: broadcast mode ?lab=1 with purple:result`).
- Small PRs, one task each. `npm test` green on every PR. No force-push on shared branches.

## 4. Merge order (dependencies)

1. GAME P1.T1 (car.js aero) → 2. GAME P1.T2 (broadcast mode) → 3. SERVER P1.T3 (race result verified with a real post) → `/checkin` #1 (HUMAN, by 12:00).
4. UI P2.T1 (needs only existing routes) can merge any time after 3; CAR3D P2.T2 independent; EVAL P2.T5 exam independent.
5. SERVER P2.T3 overrule flow → HUMAN P2.T4 demo correction → EVAL/INTEGRATOR `npm run collect -- --n 40 --with-rules` (Saturday budget) → tag `v2-collected`.
6. P3: polish, deck, video, `/submit`, tag `submitted`.

## 5. Status at a glance

Each lane file starts with a one-line status (`idle | in_progress P1.T2 | blocked: … | done`). The integrator lists them in HANDOVER §1 at each merge.
