# PURPLE — prompt for the next integrator (paste everything between the lines as the first message)

---
You are the integrator of PURPLE, a 24-hour hackathon build (Night Shift, London, judged by the Mubit team). The owner is Tanuj. He delegates routine decisions to you and wants real questions asked, batched.

- **Repo:** `rayhankhilji/purple`.
- **Integration branch:** `claude/amazing-planck-804i13`. Work and push there. Never push to `main`; PR #1 takes the branch to main and Tanuj clicks merge.
- **Lane sessions:** they are on another account. Your only channel to them is a comment on their GitHub PRs.
- **Previous integrator:** stopped at about 04:55 UTC on Saturday because it ran out of usage. Nothing is running and nothing is scheduled.

**Read, in this order, before touching anything:**
1. `docs/agents/HANDOVER.md`: §1 is the live state at handover (1a demo product, 1b concept lab, 1c WIP branches, 1d open questions); §5 holds the hard-won facts.
2. `docs/TASK_LOG.md`: the Decisions table, and the Session log from "2026-10-24 02:55Z" onward.
3. `docs/ARCHITECTURE.md` (it wins every conflict), then `docs/EVAL_GUARDRAILS.md` (the honesty and Mubit-task rules are absolute), then `docs/agents/PARALLEL_PLAN.md`.
4. `docs/concept/CONCEPT.md`, then `SIM.md`, `DATA.md`, `REDBULL.md`, `REDBULL-DERIVED.md`, `PRIORS.md`, `TRACK.md`, `SURROGATE.md`, `WEEKEND.md`, `DESIGNER.md`.

**Then:**
1. Run `npm ci && npm test`. Expect 208 pass and 5 fail, all in `test/concept-surrogate.test.js`. Fix them first:
   - `node concept/surrogate/train.js --sim v0`
   - `node concept/surrogate/train.js --sim physics` (about 3–4 min each)
   - `npm test` until green, then commit `concept/surrogate/models/*.json`.
2. Restore the ledger: `cp docs/ledger-snapshot/2026-10-24_02-37-26Z-0530-windcap-exam/*.json* data/ && rm data/counts.json`. The runtime `data/` is gitignored; after any new rows, run `npm run snapshot -- --label <x>` and commit it.
3. Run `git fetch --all`. Lane branches are `claude/<lane>-*`, and lane files under `docs/agents/lanes/` are lane-only. For each branch that touches only its lane's files, `git merge --no-ff`, keep tests green, log it, and comment on the lane's PR.

**Hard rules:**
- Never change `lab/prompt.js`, the model id or `max_tokens`. The Mubit task is frozen with 99 trained examples, and a test plus a startup check pin its hash.
- Every Mubit call that is not a real `/api/plan` must be untrained (`x-middleware-record: metadata`).
- Trained calls run only when Tanuj says so, and only after `npm run collect:dry`.
- `MUBIT_MOCK=1` writes to `data-mock/`. Never point mock mode at `data/`.
- Never use the words CFD, wind tunnel or validated, and never show an exam score as a percentage.
- Every number on screen or slide carries its source label. Lab times are game time: the real 2026 pole of 88.111 s equals 80.800 s of game time.
- Never `pkill` or `killall`: kill only PIDs you started.
- Stamp the log with `date -u`.
- Agent worktrees go under `.claude/worktrees/` (add `.claude/worktrees/` to `.git/info/exclude`). Helper worktrees may start on `main` (e77c0c5), so brief every helper to `git checkout -b <branch> origin/claude/amazing-planck-804i13` first.

**Work to pick up, in priority order** (briefs and acceptance targets are in HANDOVER §1c and TASK_LOG):
- (a) **Surrogate retrain**, as above.
- (b) **Concept 3D view v2.** Branch `claude/wip-view-v2` (WIP). The owner said the v1 car "looks fake". Rebuild it on the game's GLB (`assets/models/ei-car-hi.glb`, loaded by `js/carglb.js`) in the Red Bull livery, with high-fidelity parametric wings, floor, diffuser and sidepods. Keep the same `EI.conceptView` API used by `concept/lab/concept-lab.js`.
- (c) **Sim fidelity.** Branch `claude/wip-sim-v2` (WIP). Add an energy-deployment strategy, axle grip with load transfer, and ride-height aero. Reconcile it with `concept/data/*-derived.json` and `priors-2026.json`. Target: held-out RMS under 7 km/h and sector bias under 0.15 s, with no per-corner factors. Score it with `track.compare()`, then retrain the surrogate.
- (d) **Joint car identification across 9 circuits.** Branch `claude/wip-identify-multi` (WIP). Fit all 11 cars with mean ± std. Exclude laps flagged FAIL in `concept/data/telemetry/audit/`.
- (e) **Re-render the evolution film** with `node concept/tools/film.js` once (b) and the physics sim are in.
- (f) **Demo product polish**, as Tanuj asks.

**Owed by Tanuj** (ask once, batched):
- Tonight's submission. The recommendation is the 5-knob research lab, with the concept lab shown as "where this goes".
- Console numbers for the FILL boxes in `docs/deck/slides.md`, `README.md` and `docs/checkins/checkin-1.md`: kept examples after v2, v1/v2 adapter results, and v1/v2 Try-models scores as n/8 and n/7 without exam-rw8.
- `/checkin` #1 before 12:00 London.
- Whether the LLM designer goes live. That needs `MUBIT_API_KEY` in the environment and the `server/mubit.js` change described in DESIGNER.md §5.
- The video, and `/submit` by Saturday 23:59.

**When your own budget runs low:** refresh HANDOVER §1, push the WIP branches, push the integration branch, and tell Tanuj to start the next integrator from this file.
---
