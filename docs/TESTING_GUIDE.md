# PURPLE — Testing Guide

Version 1.0 · 2026-10-23 · Tests exist to answer one question per feature: is the number real?

## 1. Strategy

Three layers, all with `node --test`, no extra framework:
- **Model tests** (fast, no network): aero map monotonicity, legality, evaluator determinism and calibration.
- **Contract tests** (no network): schema validation of `PlanOutput`, server envelope, SSE event shapes, with the Mubit client stubbed.
- **Live checks** (network, manual or `npm run smoke`): one Mubit call, header present, console shows the task. Never run live tests without `x-middleware-record: metadata`.

Race-level checks (F-04) are run by hand in the browser and the result is pasted into `TASK_LOG.md`; they are too slow for CI.

## 2. Setup

```bash
npm ci
cp server/.env.example server/.env    # MUBIT_API_KEY needed only for live checks
```
Tests load the game headlessly through `server/game-headless.js` (THREE stub). No browser needed for layers 1–2.

## 3. Commands

| Command | Runs |
|---|---|
| `npm test` | all `test/*.test.js` |
| `npm run test:model` | `test/aero.test.js`, `test/evaluator.test.js` |
| `npm run test:contract` | `test/schema.test.js`, `test/server.test.js` |
| `npm run smoke` | one live Mubit call, untrained, prints request ID and latency |
| `npm run exam` | 20 exam calls on the provider, untrained, prints `n/20` |

## 4. Mocks

`test/mocks/mubit.js` replaces `server/mubit.js` with a function returning a canned `PlanOutput` and a fake `mreq_test…` ID; `MUBIT_MOCK=1` env switches the server to it. The game headless loader is real (it is the system under test).

## 5. Suites

### `test/aero.test.js` (F-01)
- `T-F01-AC1` baseline setup → all multipliers 1.0, `legal: true`.
- `T-F01-AC2` `rear_wing_deg: 36` → `legal: false`, violations include `REG-RW-MAX`.
- `T-F01-AC3` rear wing +5° → `df` and `cd` both increase; terminal speed decreases.
- Clamp: extreme combinations never leave `[0.6, 1.6]`.
- `TD-01` active → `rear_wing_deg: 25` is illegal with reason `TD-01`.

### `test/evaluator.test.js` (F-02)
- `T-F02-AC1` baseline, Silverstone, dry → `lap` within ±1.0 s of 80.8.
- `T-F02-AC2` same input twice → deep-equal output.
- `T-F02-AC3` 10 m/s headwind on the Hangar Straight (wind from the direction the straight points) → sector 2 `vmax` lower than no-wind.
- Sector sum equals lap within 0.001 s.
- Rear wing +8° at Silverstone → `delta_lap > 0` (the demo premise must hold in the model).
- Rear wing +8° at Monza → larger positive `delta_lap` than at Silverstone (fast-refresh premise).

### `test/schema.test.js` (F-03)
- Valid `PlanOutput` passes; missing key, wrong enum, `magnitude` out of range, extra prose before JSON → rejected with the field named.
- Scenario serialiser output < 350 tokens (approximate: < 1,400 chars) for a 3-item history.

### `test/server.test.js` (F-03, F-05, F-06) with `MUBIT_MOCK=1`
- `T-F03-AC1` `POST /api/plan` → 200 envelope, ledger row with `mubit_request_id`, SSE `plan` event received.
- `T-F03-AC3` mock returns prose → first retry, then `status: parse_error`, 502 `PARSE_ERROR`.
- `T-F05-AC1` `POST /api/overrule` → rule in `rules.json`; next `POST /api/plan` scenario contains the rule text.
- `POST /api/evaluate` with illegal setup → 422 `ILLEGAL_SETUP`.
- `T-F09-AC1` with `TD-01` active, plan candidate at 25° → 422 and a `calls.jsonl` row `kind: "illegal"`.
- Server without `MUBIT_API_KEY` → refuses to start (exit code 1) when `MUBIT_MOCK` is unset.

## 6. Acceptance matrix

| Test | Feature AC | Layer | Pass condition |
|---|---|---|---|
| T-F01-AC1 | F-01.AC1 | model | multipliers 1.0, legal |
| T-F01-AC2 | F-01.AC2 | model | `REG-RW-MAX` |
| T-F01-AC3 | F-01.AC3 | model | vmax ↓, vmin ↑ |
| T-F02-AC1 | F-02.AC1 | model | 79.8 ≤ lap ≤ 81.8 |
| T-F02-AC2 | F-02.AC2 | model | deep-equal |
| T-F02-AC3 | F-02.AC3 | model | S2 vmax ↓ |
| T-F03-AC1 | F-03.AC1 | contract | row + request id |
| T-F03-AC2 | F-03.AC2 | live, manual | console ≥ 25 kept |
| T-F03-AC3 | F-03.AC3 | contract | retry then parse_error |
| T-F04-AC1 | F-04.AC1 | browser, manual | 3 laps, no input |
| T-F04-AC2 | F-04.AC2 | browser, manual | `agreement_pct` on row |
| T-F04-AC3 | F-04.AC3 | browser, manual | Becketts min ↑, Hangar max ↓ |
| T-F05-AC1 | F-05.AC1 | contract | rule in next scenario |
| T-F05-AC2 | F-05.AC2 | live, manual | v2 in console |
| T-F05-AC3 | F-05.AC3 | live, manual | Try models screenshot |
| T-F06-AC1..3 | F-06 | browser, manual | states render |
| T-F07-AC1 | F-07.AC1 | browser, manual | wing moves < 200 ms |
| T-F08-AC1 | F-08.AC1 | live | `provider: n/20` |
| T-F09-AC1 | F-09.AC1 | contract | 422 `TD-01` |
| T-SMOKE | — | live | `mreq_` ID printed |

## 7. Expected outputs (fixtures)

`test/fixtures/baseline.silverstone.json` holds the first accepted baseline `Evaluation`; any later change that moves `lap` by more than 0.05 s fails the test unless the fixture is regenerated on purpose (`npm run fixtures`) with a `TASK_LOG.md` decision line. Same for `baseline.monza.json`.

## 8. Verification before each phase exit

1. `npm test` green.
2. `npm run smoke` prints an `mreq_` ID.
3. Console check (by hand): task name, kept examples, adapter version — copied into `status.json` and `TASK_LOG.md`.
4. For P1+: one browser race, result row pasted into `TASK_LOG.md` with `agreement_pct`.
5. For P2+: the four UI states of each card seen once (empty, loading, error with server stopped, success).
