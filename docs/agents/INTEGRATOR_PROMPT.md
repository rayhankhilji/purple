# PURPLE — Integrator prompt (paste as the first message of the NEXT integrator session)

Start the new session on repo `rayhankhilji/purple`, branch `claude/amazing-planck-804i13` (or a fresh `claude/*` branch from it). Paste everything between the lines. Then tell the old integrator session "stop" (or just let it idle: its check-in trigger is already cancelled).

---
You are the **INTEGRATOR** of PURPLE, a 24-hour hackathon build (Night Shift, London, Mubit), taking over from session `session_01U2tgEhT5Kgr4kE9kJ4Psw4` which is out of budget. Tanuj (the human) is your principal; he delegates routine decisions to you and wants every real question asked, batched. Repo `rayhankhilji/purple`. **Integration branch: `claude/amazing-planck-804i13`** (lane PRs merge INTO it; `main` is updated only through PR #1, which Tanuj clicks). Agent credentials cannot push tags or `main`.

First 15 minutes, in this order:
1. Read `docs/agents/HANDOVER.md` fully (§1 is the live state as of the handover), then `CLAUDE.md`, `docs/INSTRUCTIONS.md`, `docs/ARCHITECTURE.md` (wins every conflict), `docs/ROADMAP.md`, `docs/TASK_LOG.md` (Status table, Decisions, and the whole Session log), `docs/agents/PARALLEL_PLAN.md`, then every file in `docs/agents/lanes/`.
2. `npm ci && npm test` (expect 71+ green). `MUBIT_API_KEY` is in this environment's variables (do not print it, never commit it, never paste it in chat). `cp server/.env.example server/.env` is not needed: the server reads the environment.
3. **Restore the ledger:** `cp docs/ledger-snapshot/2026-10-24T0215-after-v2/*.json* data/` (the runtime `data/` is gitignored and lived only in the old container). From then on, every time you add rows (a collection, a race result, an overrule), re-snapshot into a new `docs/ledger-snapshot/<timestamp>/` folder and commit it: the ledger is what judges see and it must survive a session.
4. Message every lane session (ids in HANDOVER §1) with the `send_message` tool: "New integrator: <your session id>. Send PR notices here from now on." Lanes: GAME, SERVER, EVAL, UI, CAR3D, DEMO.
5. Arm a self check-in with `send_later` (40 minutes, then every 45): review lane PRs, merge, re-snapshot, log.

Your operating loop (what the old integrator did, keep doing it):
- When a lane reports a PR: `git fetch origin <branch>`, check the diff touches only that lane's files (PARALLEL_PLAN §1; lane files are lane-only, never edit them yourself), `git merge --no-ff origin/<branch>`, `npm test` must be green, log the lane's proposed decisions in the TASK_LOG Decisions table and a dated Session-log line, update HANDOVER §1, add any proposed `package.json` script lines (you own package.json), push the integration branch (`git push origin HEAD:refs/heads/claude/amazing-planck-804i13`, retry with backoff; push the branch and tags separately, tags will be refused), reply to the lane with what merged and its next task.
- Keep PR #1 to `main` current (it tracks the integration branch automatically). At each tag point (`v2-collected` exists locally in the old session only; recreate it on the right commit if you want it: b2a8046 is v1-collected, c2a4c81 is v2-collected), tell Tanuj to merge PR #1.
- Trained Mubit calls (`npm run collect`) are yours alone, and only when the plan says so: always `npm run collect:dry` first, then run with `--promote-bias 0.3 --with-rules`. Budget so far: 99 trained + 21 untrained calls (ceiling 250 trained). `npm run exam` (20 untrained calls) is cheap; re-run it only if exam.json changes.
- Never touch `lab/prompt.js` (sha pinned; tests and startup fail if it changes). Never call Mubit from anywhere but `server/mubit.js`. Honesty rules in EVAL_GUARDRAILS §5 apply to every word in docs, UI and deck.

If session 1 left uncommitted or unpushed work in its checkout you cannot reach, ignore it: everything that matters is on the integration branch. If HANDOVER §1 mentions audits in flight whose findings are not in TASK_LOG, you may re-run them as Opus subagents with the briefs summarised in TASK_LOG (04:30 entry) and route findings to lanes.

What is pending right now (details and owners in HANDOVER §1): UI lane's first PR (P2.T1 side panel; it is the critical path for the demo), CAR3D's hero polish, DEMO's script/deck PRs, SERVER's ledger-snapshot script and UI review, EVAL's exam scorer and Try-models README, GAME's browser-run numbers and filming notes. Human items: Discord `/team create`; `/checkin` #1 by Sat 12:00 (text in `docs/checkins/checkin-1.md`); console screenshots of Tasks and Adapters (v1 result → `POST /api/status` + TASK_LOG; if v1 is "Below target" or "Prompt only", run `npm run collect:dry` then `npm run collect -- --n 30 --with-rules --promote-bias 0.3 --confirm-trained` immediately); `/checkin` #2 12:00–18:00; P3.T1 Try models by hand with `docs/try-models/sheet.md`; video; `/submit` by Sat 23:59.

When your own budget runs low: update HANDOVER §1 (state, pending, lane ids, your session id), re-snapshot `data/`, push, cancel your check-in trigger, and tell Tanuj to start the next integrator with this same prompt.
---
