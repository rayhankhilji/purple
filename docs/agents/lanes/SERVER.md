# Lane SERVER

Status: in_progress (PRs #2 P1.T3, #3 guards, P2.T3 server side open; next: status widget plumbing). Owner: agent B (Claude, session_01Tq3p158ophv4wuU2ibcJbj). Branches: `claude/server-p1-race` → `claude/server-p1-guards` → `claude/server-p1-rules` (stacked branches `claude/server-p1-*` follow, one PR per task into `claude/amazing-planck-804i13`).

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

## Sessions

### 2026-10-24 01:10 London — agent B (Claude) — P2.T3 server side (F-05 correction loop)
- Status: done, PR open into `claude/amazing-planck-804i13` (branch `claude/server-p1-rules`, stacked on `claude/server-p1-guards`; merge #2, #3 first).
- Files changed: `server/app.js` (overrule + rules routes), `test/server.test.js` (+4 tests), this file.
- Contract for the UI lane:
  - `POST /api/overrule { experiment_id, verdict, reason, by? }` → `{ rule, experiment }` (experiment = the overruled row; `experiment` is additive to ARCH §5's `{ rule }`). Rule text = reason with whitespace collapsed, cut at 160 chars, trimmed. 400 names the bad field; 404 unknown experiment. SSE: `rule` (the new rule) then `plan` (the row with `status: "overruled"`).
  - Rule ids: `R-xx` = max existing number + 1 (a deleted or hand-edited `rules.json` never produces a duplicate id).
  - `GET /api/rules?active=1` → active rules only (exactly what the next scenario carries, in id order); `?active=0` → inactive; no query → all. `POST /api/rules/:id { active: boolean }` → the rule (`updated_at` set), emits SSE `rule`; non-boolean → 400 `active must be a boolean`.
- Verify step run + output: `npm test` → 51/51 pass. Mock server + curl: overrule with `"  Judge   on the\n full lap.  "` → rule `R-01` text `Judge on the full lap.`, experiment `overruled`; second overrule → `R-02`; toggle `R-01` off → `GET /api/rules?active=1` → `['R-02']`; `{"active":"x"}` → 400 `active must be a boolean`.
- Decisions proposed (for the integrator to log in TASK_LOG): D-S6: `/api/overrule` returns `{ rule, experiment }` (additive); D-S7: `POST /api/rules/:id` requires a boolean `active` (was `!!active`); D-S8: `GET /api/rules?active=1|0` added (additive to ARCH §5).
- Blockers / questions for Tanuj: none.
- Next three actions: (1) `/api/status` widget fields (`last_console_read_at`, `prompt_hash`, `budget` by UTC day) + tests; (2) review the GAME lane's P1.T2 payload against the P1.T3 contract when it lands; (3) P2.T5 `npm run exam` wiring once EVAL ships `data/exam.json` (route and CLI already exist; verify n/20 output and the status write).

### 2026-10-24 00:50 London — agent B (Claude) — task-integrity guards (EVAL_GUARDRAILS G-MUBIT-01..05)
- Status: done, PR open into `claude/amazing-planck-804i13` (branch `claude/server-p1-guards`, stacked on `claude/server-p1-race`; merge PR #2 first).
- Files changed: `server/scripts/prompt-hash.js` (new: pins sha256 `6c5be1a3…ce6a` + PROMPT_VERSION "1"; module + CLI), `server/index.js` (logs the hash at start; refuses to start on a mismatch unless `PURPLE_ALLOW_PROMPT_CHANGE=1`), `server/app.js` (`POST /api/collect` requires `{ confirm: "trained" }`, integer `1 ≤ n ≤ 60`; `db.appendCall` throws on any non-plan row without `trained: false`), `server/scripts/smoke.js` (`MUBIT_MOCK=1` uses the mock; absolute `PURPLE_DATA_DIR` honoured), `test/prompt-frozen.test.js` (new), `test/server.test.js` (+3 tests), this file.
- Verify step run + output: `npm test` → 47/47 pass. `node server/scripts/prompt-hash.js` → `… == frozen task key, OK` exit 0. Temporary comment appended to a prompt copy: server prints `!! differs from the frozen task key` and exits 1; with `PURPLE_ALLOW_PROMPT_CHANGE=1` it starts with a WARNING line; `lab/prompt.js` restored (`git checkout`), hash back to `6c5be1a3…`. `POST /api/collect {"n":3}` → 400 `confirm must be "trained"…`; `{"n":99,"confirm":"trained"}` → 400 `n must be <= 60 per request (budget guard)`.
- Decisions proposed (for the integrator to log in TASK_LOG):
  - D-S4: `POST /api/collect` contract tightened (ARCH §5): body must carry `confirm: "trained"`, `n` ≤ 60. The CLI `npm run collect` calls `collect()` directly and is unchanged (integrator's path).
  - D-S5: a changed `lab/prompt.js` now fails `npm test` and blocks `npm start`; the only override is `PURPLE_ALLOW_PROMPT_CHANGE=1` after a logged decision (then update the constant in `server/scripts/prompt-hash.js` and `test/prompt-frozen.test.js`).
  - Proposed `package.json` line: `"prompt:check": "node server/scripts/prompt-hash.js"`.
- Blockers / questions for Tanuj: none.
- Next three actions: (1) P2.T3 server side (rule trimming, `R-xx` by max id, `GET /api/rules?active=1`, SSE `rule`/`plan` tests); (2) `/api/status` widget fields; (3) review GAME lane's P1.T2 postMessage payload against the contract in the P1.T3 entry when it lands.

### 2026-10-24 00:25 London — agent B (Claude) — P1.T3 (F-04 race result)
- Status: done, PR open into `claude/amazing-planck-804i13` (branch `claude/server-p1-race`).
- Files changed: `server/app.js` (route `POST /api/race/result` rewritten: `validateRaceResult`, `agreementPct`), `server/scripts/fake-race.js` (new), `test/server.test.js` (+5 tests), this file.
- What the route now does (contract for GAME and UI lanes):
  - Accepts exactly `{ experiment_id: string, seed: integer, cars: [2 × { role: "baseline"|"candidate", lap > 0, sectors: [3 numbers ≥ 0], vmax_kmh > 0, vmin_becketts_kmh > 0 (≤ vmax) }] }`. Any other shape → 400 `BAD_INPUT` whose message names the field (`cars[1].sectors must be an array of 3 non-negative numbers`). Unknown id → 404. Nothing is written on a 4xx.
  - `measured` on the row: `{ baseline: {lap, sectors, vmax_kmh, vmin_becketts_kmh}, candidate: {…}, measured_delta, predicted_delta, measured_sector_deltas[3], agreement_pct, seed, at, label: "measured in race, seed N", supersedes }`. `agreement_pct = round(100·|measuredΔ − predictedΔ| / |predictedΔ|)` (0 = perfect); `null` when the evaluator predicted exactly 0.
  - Status becomes `raced`, except an `overruled` or `promoted` experiment keeps that status (the engineer's verdict outranks the race) and gains `measured`.
  - A second post for the same experiment appends a new ledger row with the same id; `store.readLedger()` returns the latest (`measured.supersedes` = previous `measured.at`).
  - SSE `race` event = the full experiment row (plan, evaluation, scenario, measured), same as the response.
- `node server/scripts/fake-race.js [--id X] [--seed 7] [--factor 1.2] [--noise 0.02] [--port 8787]`: posts a plausible seeded result for the newest ledger row to a running server (measured Δ = predicted Δ × factor ± noise; laps/sectors/vmax/vmin derived from the evaluation). UI lane: `MUBIT_MOCK=1 npm run dev`, press Run (or `curl -X POST :8787/api/plan`), then run the script to see the RACE card, `agreement_pct` and the SSE `race` event without the game.
- Verify step run + output: `npm test` → 41/41 pass, 0 fail (1.6 s). `MUBIT_MOCK=1 PURPLE_PORT=8797 node server/index.js` + `POST /api/plan` + `POST /api/race/result {"seed":"3"}` → `{"ok":false,"error":{"code":"BAD_INPUT","message":"seed must be an integer"}}`; `node server/scripts/fake-race.js --port 8797 --seed 5` → `predicted Δ 0.143 s, measured Δ 0.183 s, agreement_pct 28, status raced`; `GET /api/ledger?limit=1` shows `raced 28 "measured in race, seed 5"`.
- Decisions proposed (for the integrator to log in TASK_LOG):
  - D-S1: `measured` carries extra fields beyond ARCH §4.7 (`vmax_kmh`, `vmin_becketts_kmh` per car, `measured_delta`, `predicted_delta`, `measured_sector_deltas`, `supersedes`, `label`); additive, §4.7 keys unchanged. F-04.AC3 (Becketts vmin ↑, Hangar vmax ↓) can be read straight off the row.
  - D-S2: `agreement_pct` is `null` (not 0 or ∞) when `predicted_delta` is 0; UI should render "n/a".
  - D-S3: racing an `overruled`/`promoted` experiment keeps that status; `measured` is added. ARCH §4.7 status enum unchanged otherwise.
  - Proposed `package.json` script line (integrator): `"fake-race": "node server/scripts/fake-race.js"`.
- Blockers / questions for Tanuj: none. GAME lane: please post `seed` as an integer and `sectors` as 3 numbers (best sectors may come from different laps; the server does not require them to sum to `lap`).
- Next three actions: (1) task-integrity guards (prompt hash test + startup check, `/api/collect` confirm + cap, non-plan calls `trained:false` test); (2) P2.T3 server side (rule trimming, `R-xx` numbering by max id, `GET /api/rules?active=1`, SSE `rule`/`plan` tests); (3) `/api/status` widget fields (`last_console_read_at`, `prompt_hash`, `budget` by UTC day).

## Template for a session entry

### YYYY-MM-DD HH:MM London — <agent/session> — <task id>
- Status: in_progress | done | blocked: <what, who>
- Files changed:
- Verify step run + output:
- Decisions proposed (for the integrator to log in TASK_LOG):
- Blockers / questions for Tanuj:
- Next three actions:
