# PURPLE

PURPLE is built on Equation I (pre-existing, by this team). Everything under `lab/`, `server/`, and the hooks listed in ARCHITECTURE §9 was written during Night Shift.

PURPLE is an autonomous F1 engineering research lab that chases purple sectors. A research agent (an LLM routed through Mubit) proposes a setup change to a parametric car; a reduced-order lap model, calibrated to 2026 pole laps, scores it; the game races baseline against candidate; a human engineer overrules bad decisions, and those corrections become the next adapter version through Mubit.

- Build docs: [`docs/INSTRUCTIONS.md`](docs/INSTRUCTIONS.md) (read first), then PRD → ARCHITECTURE → ROADMAP → TASK_LOG.
- Agent handover: [`docs/agents/HANDOVER.md`](docs/agents/HANDOVER.md).
- The game itself: [`docs/equation-i/README.md`](docs/equation-i/README.md).

## Run

```bash
npm ci
cp server/.env.example server/.env   # add MUBIT_API_KEY
npm run dev                          # server :8787 + static :8788
open http://localhost:8788/lab/
```

The lap numbers on screen come from a reduced-order lap model, calibrated to 2026 pole laps. It is not a high-fidelity aerodynamic simulation.
