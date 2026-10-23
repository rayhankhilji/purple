# PURPLE — Task Log

Version 1.0 · Started 2026-10-23 22:45 London · Update after every task. This file is the team's memory across sessions.

## Status

| Field | Value |
|---|---|
| Current phase | P0 — Examples flowing |
| Mubit task name | (fill after the first real call; it is the first words of the prompt) |
| Model | claude-haiku-4-5 (PRD A3 fallback: gpt-6-luna) |
| Kept examples | 0 |
| Adapter version / result | none |
| Next deadline | Sat 01:00 London — Friday UTC training budget rolls |

## Checklist (current phase: P0)

- [ ] P0.T0 Repo `purple`, Equation I imported, `/team create`, README disclosure
- [ ] P0.T1 `package.json`, `npm ci`, `npm run smoke` prints `mreq_` ID
- [ ] P0.T2 `lab/prompt.js` frozen (PROMPT_VERSION 1), `lab/schema.js`, schema tests green
- [ ] P0.T3 `lab/aero.js`; `buildSpeedProfile` takes `aero`/`wind`; `profileFor` key; `EI.buildSpeedProfile` exported
- [ ] P0.T4 `server/game-headless.js`, `lab/evaluator.js`; baseline Silverstone within ±1.0 s of 80.8
- [ ] P0.T5 server routes + `server/mubit.js` + JSONL writers; T-F03-AC1
- [ ] P0.T6 scenario generator; `npm run collect -- --n 50`; console ≥ 25 kept examples; tag `v1-collected`

## Blockers

| When | What | Owner | Resolution |
|---|---|---|---|
| — | none yet | — | — |

## Decisions

| When | Decision | Why | Reversible? |
|---|---|---|---|
| 2026-10-23 22:30 | Research-agent decision is the one Mubit task; evaluator is deterministic | Verified outcome per decision; judges' criteria | No (task key) |
| 2026-10-23 22:30 | Five setup parameters, Silverstone + Monza only | 24-hour scope | Yes |
| 2026-10-23 22:30 | No Blender; the game's procedural car is the 3D model | It already has wing `aoa` parameters | Yes |
| 2026-10-23 22:30 | Corrections = pit-wall rules in the task input (+ console if offered); honest "rule-conditioned learning" | Eldar: no corrections API; adapters graded vs provider | Yes |

## Session log

### 2026-10-23 22:45 — kickoff
- Build docs written (PRD, ARCHITECTURE, INSTRUCTIONS, ROADMAP, TESTING_GUIDE, EVAL_GUARDRAILS, DESIGN_SYSTEM).
- Equation I inspected: `buildSpeedProfile` lap model, per-driver traits, procedural car, 7 circuits, seeded races, replay recorder.
- Next: P0.T0.
