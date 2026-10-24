# PURPLE

Read `docs/agents/HANDOVER.md` first (3 minutes), then `docs/INSTRUCTIONS.md` and its reading order (PRD → ARCHITECTURE → ROADMAP → TASK_LOG), then your lane file in `docs/agents/lanes/`. New lane agents start from `docs/agents/INITIATION_PROMPT.md`, a new integrator from `docs/agents/INTEGRATOR_PROMPT.md`; the lane split is `docs/agents/PARALLEL_PLAN.md`.

Never change `lab/prompt.js` or the model after the first trained Mubit call (it has them already). Never call Mubit from the browser or without `x-middleware-record: metadata` for anything that is not a real plan call. Only touch game files named in ARCHITECTURE §9, opt-in only. Update your lane file after every task; the integrator updates `docs/TASK_LOG.md`.

Commands: `npm ci`, `npm test`, `MUBIT_MOCK=1 npm run dev`, `npm run smoke`, `npm run collect -- --n N`.
