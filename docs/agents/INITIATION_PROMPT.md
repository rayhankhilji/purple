# PURPLE — Initiation prompt (paste this as the first message of a new agent session)

Copy everything between the lines. Fill the two brackets. One agent = one lane; two agents never share a lane.

---
You are joining PURPLE, a 24-hour hackathon build (Night Shift, London, Mubit). Repo: `rayhankhilji/purple`. Work on the branch this session was given; branch from `origin/main` (or from `origin/claude/amazing-planck-804i13` if main is behind it, check `git log`). Your lane is **[LANE]** and your first task is **[TASK ID from docs/ROADMAP.md, e.g. P1.T2]**.

Do this, in order, before writing any code:
1. Read `docs/agents/HANDOVER.md`, then `CLAUDE.md`, then `docs/INSTRUCTIONS.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md` (it wins every conflict), `docs/ROADMAP.md`, `docs/TASK_LOG.md`. Then your lane file `docs/agents/lanes/[LANE].md` and `docs/agents/PARALLEL_PLAN.md`.
2. `npm ci && npm test` must be green before you start. If `server/.env` is missing, ask Tanuj for the key; never commit it, never paste it into chat; `MUBIT_MOCK=1` runs everything without it.
3. Mark your task `in_progress` in your lane file and commit that first (so nobody else takes it).

Rules that are not negotiable:
- Never edit `lab/prompt.js`, the model id, `max_tokens`, or add tools/response_format: the Mubit task is frozen and already holds examples.
- Never send a Mubit call for debugging/tests without `x-middleware-record: metadata` (use `npm run smoke` or `MUBIT_MOCK=1`). Trained calls (`npm run collect`) only when your task says so.
- Only touch the files your lane owns (PARALLEL_PLAN §2). If you must touch another lane's file, write the proposed change in your lane file and stop; do not silently diverge from ARCHITECTURE.
- Game files: only the ones in ARCHITECTURE §9, opt-in only; default behaviour must stay identical.
- No CFD / wind tunnel / validated wording anywhere. The label is "reduced-order lap model · calibrated to 2026 pole laps · aero map v1".
- `data/` is the ledger judges will see: never delete it; tests use temp dirs.

Operating loop: build the task → run its verify step from `docs/TESTING_GUIDE.md` → commit with the task id (`P1.T2: broadcast mode …`) → push → update your lane file (dated section on top: status, files changed, verify output, decisions proposed, blockers, next three actions) → open a PR to `main` titled with the task id → tell Tanuj in one short message what shipped and what is blocked on a human. Then take the next task in your lane.

Ask Tanuj every question you have, batched, at the moment it blocks you; make routine calls yourself and log them in your lane file. Stop and ask before anything irreversible (a trained Mubit call outside your task, deleting data, force-pushing).
---
