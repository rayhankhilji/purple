# Lane SERVER

Status: in_progress — PRs #2, #3, #5, #6, #10, #13 merged; open: #20 (status deep merge + UI review, branch `claude/server-p2-status-merge`) and the data-mock PR (branch `claude/server-p2-datadir`). Both cut from the integration branch, independent (their lane-file entries will touch the same lines; take both).

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

## Sessions

### 2026-10-24 03:25 London — agent B (Claude) — mock data dir rule for every script (integrator request)
- Status: done, PR open into `claude/amazing-planck-804i13` (branch `claude/server-p2-datadir`, cut from 37b8275; independent of #20).
- Files changed: `server/app.js` (createApp default: `opts.dataDir` → `PURPLE_DATA_DIR` → `data-mock/` when `MUBIT_MOCK=1`, else `data/`), `server/scripts/smoke.js` (same rule), `server/scripts/collect.js`, `exam.js`, `collect-dry.js` (`--data <dir>` wins over `PURPLE_DATA_DIR`), `server/scripts/fake-race.js` (comment: no data dir of its own, it writes wherever the running server points), `test/server.test.js` (+1), this file. `server/index.js` keeps the integrator's line (the startup log shows the resolved dir either way).
- Audit: `collect`, `exam`, `collect-dry` go through `createApp()` and inherit the rule; `smoke` opens the store itself and now applies it; `snapshot` takes `--data`/`PURPLE_DATA_DIR` (defaults to the real `data/`, which is what a freeze wants); `fake-race` is an HTTP client (the server's dir); `prompt-hash`, `fixtures` touch no data.
- Verify step run + output: `npm test` → 75/75 (new test: createApp resolves `data-mock/` under `MUBIT_MOCK=1` with no env, `data/` otherwise, explicit env/opts win; `server/index.js` startup line prints `data <root>/data-mock`; `collect.js --data` beats `PURPLE_DATA_DIR` and the other dir stays empty; `collect-dry.js --data` reported in its line; `.gitignore` has `data-mock/`).
- Decisions proposed: D-S16 the data-dir precedence above, for every CLI.
- Blockers / questions for Tanuj: none.
- Next three actions: (1) respond to review on #20 and this PR; (2) re-check `lab/lab.js` after the UI fixes (findings 1, 2, 4 in the UI review on #20); (3) T-F04-AC2 with a real browser post.

### 2026-10-24 02:30 London — agent B (Claude) — P3.T6 prep: `server/scripts/snapshot.js` (freeze step); PR #10 closed as merged by hand
- Status: done, PR open into `claude/amazing-planck-804i13` (branch `claude/server-p3-snapshot`, cut from the integration branch at 103d066). PR #10 was merged by the integrator by hand (9cea07d, keeping both `itemSeed` and the rng warm-up); I closed the GitHub PR and dropped my two later commits on that branch (they would have undone the integrator's resolution). My 02:10 entry below describes a state that never reached the integration branch; D-S12 as logged by the integrator (both fixes) is the truth.
- Files changed: `server/scripts/snapshot.js` (new), `test/snapshot.test.js` (new, +2), this file. No snapshot directory is committed here: the integrator runs it at the freeze.
- `node server/scripts/snapshot.js [--label freeze] [--out docs/ledger-snapshot] [--data data]` → `docs/ledger-snapshot/<YYYY-MM-DD_HH-MM-SSZ>[-label]/` with byte-for-byte copies of `ledger.jsonl`, `calls.jsonl`, `rules.json`, `status.json`, `exam.json`, `state.json` (missing ones listed, not an error), `README.md` (files + sha256; experiments deduped by id and by status; raced / with agreement_pct / overruled / parse errors; unique session ids and `mreq_` ids; calls by kind with trained/untrained; rules total/active; exam items; console values from status.json; git commit; prompt hash; evaluator label) and `counts.json` (the same numbers as JSON for the deck). Refuses to overwrite an existing directory; never writes to `data/`; torn ledger lines are skipped and counted.
- Verify step run + output: `npm test` → 73/73 pass. CLI on a scratch data dir: `snapshot …/2026-10-23_23-49-14Z-demo: 4 files copied (missing: status.json, exam.json); 1 experiments, 1 calls (1 trained), 2 rules, 0 exam items. README.md + counts.json written.` README renders the tables and the counts; a second run into the same stamp → exit 1 `refusing to overwrite`.
- Decisions proposed: D-S14 snapshot layout as above; proposed `package.json` line: `"snapshot": "node server/scripts/snapshot.js"`. Freeze command for P3.T6: `npm run snapshot -- --label freeze` then commit `docs/ledger-snapshot/`.
- Blockers / questions for Tanuj: none.
- Next three actions: (1) review `lab/lab.js` fetches against the envelope and error codes when the UI PR appears (integrator will ping); (2) respond to review on this PR; (3) T-F04-AC2 with a real browser post once UI's Race-it URL carries `exp`.

### 2026-10-24 01:55 London — agent B (Claude) — collect-dry preview, seed mixing, GAME PR #8 payload review
- Status: done, PR open into `claude/amazing-planck-804i13` (branch `claude/server-p1-dry`, cut from the integration branch after #6 merged; nothing stacked).
- Files changed: `server/app.js` (`dryCollect`, `itemSeed`; `collect()` uses the mixed seed), `server/scripts/collect-dry.js` (new), `test/server.test.js` (+2), this file. `server/scenarios.js` untouched.
- **Finding (needs a TASK_LOG line):** the game's `U.rng` is xorshift32 and its FIRST output is ~linear in the seed (`U.rng(2000..2039)()` all = 0.124; seed0 1 → 0.062, 3 → 0.186). `collect()` seeded items as `seed0*1000+i`, so every item of a run shared its first draw: **in v1 all 50 candidates moved the same first parameter (front wing)**, and with `promote_bias` the gate (the generator's first draw) would have been all-or-nothing per run (seed 2 → 100 % biased, seed 42 → 0 %). Fix: `itemSeed(seed0, i)` = murmur3 finaliser of `seed0*1000+i` (31-bit). Rows stay replayable from their own `seed` (test), v1 rows keep their recorded seeds. Future `--seed N` runs give different candidates than before (nothing recorded depends on that). EVAL's perturb()-level seed compatibility is unaffected.
- `node server/scripts/collect-dry.js --n 40 --seed 2 --promote-bias 0.3 [--list]`: same seeds as `npm run collect`, no Mubit call, nothing written (verified: data dir stays empty; the CLI runs without a key or mock). Output for the planned v2 run:
  ```
  collect-dry: n=40 seed=2 circuit=silverstone promote_bias=0.3 (same seeds as npm run collect; no Mubit call, nothing written to …)
  verdicts (truth rule, |Δ| 0.03 s): promote 11 (28 %), retest 7 (18 %), reject 22 (55 %)
  delta_lap: min -0.175 s, max 0.62 s, mean 0.078 s; promote-biased draws 10; illegal retries 0
  conditions: dry 24, wind 10, wet 6; parameters moved: ride_height_mm 20, ers_deploy 11, front_wing_deg 10, brake_bias_pct 10, rear_wing_deg 8
  ```
  Same seed, bias 0: promote 7 (18 %), retest 14, reject 19. Bias 0.3 with seeds 1 / 3 / 7: promote 16 / 16 / 17 of 40 (40–43 %), biased draws 16 / 14 / 15. EVAL's 37 % estimate holds; seed 2 is on the low side (11 promote) because only 10 of its 40 gates fire. If the integrator wants ≥ 15 promotes in v2, seed 1 or 3 does it; `--list` shows every row (seed, verdict, Δ, source, change, conditions) before spending.
- **GAME PR #8 (`purple:result`) against `POST /api/race/result`:** the shape passes the validator as posted (`experiment_id, seed, cars[2]{ role, lap, sectors[3], vmax_kmh, vmin_becketts_kmh }`; the extra keys `type, circuit, laps`, per-car `laps[], laps_deleted, finished, setup, aero` are ignored; `seed = (cfg.seed || Date.now() & 0xffff) >>> 0` is an integer; `vmin` is from the best lap's window so `vmin ≤ vmax` holds). Two ways it **would** 400, both value-level, not shape-level:
  1. `experiment_id` is `LAB.exp` from `?exp=`; without it the message carries `null` → 400 `experiment_id must be a non-empty string`. UI lane: put `&exp=<id>` on the "Race it" URL **and** fall back to the lab page's current experiment id when relaying (GAME decision 5 says the same).
  2. A car with no completed lap / no telemetry sample posts `lap: null`, `vmax_kmh: null`, `vmin_becketts_kmh: null` or a `null` sector → 400 naming that field. Cannot happen in a finished 3-lap race; if a car never finishes the UI should show the 400 text rather than retry.
  No change needed in GAME for the server contract. Headless numbers in their lane file (Δ +0.518 s vs predicted +0.436 → agreement ≈ 19 %) match what the route computes.
- Verify step run + output: `npm test` → 67/67 pass. `collect-dry.js` with no `MUBIT_API_KEY` and no `MUBIT_MOCK` → exit 0, data dir untouched; `--n 0` → exit 1.
- Decisions proposed: D-S12 per-item seed mixing in `collect()` (above); D-S13 `collect-dry` is the required step before any trained collection (`npm run collect:dry -- --n 40 --seed 2 --promote-bias 0.3`); proposed `package.json` line: `"collect:dry": "node server/scripts/collect-dry.js"`.
- Blockers / questions for Tanuj: none.
- Next three actions: (1) when #7/#8 merge: run the broadcast page in the browser against the mock server, post one real `purple:result`, record T-F04-AC2 here; (2) respond to review on the collect-dry PR; (3) exam dry-run (`MUBIT_MOCK=1`, temp data dir) against `data/exam.json` to confirm the `status.exam` write path (the live exam already ran from the integrator's side: 20/20).

### 2026-10-24 01:35 London — agent B (Claude) — promote_bias wiring for the v2 collection (integrator request, EVAL D-E1)
- Status: done, on the status-widget PR #6 (branch `claude/server-p1-status`). Branches `claude/server-p1-rules` and `claude/server-p1-status` both merged with `origin/claude/amazing-planck-804i13` (no conflicts).
- Files changed: `server/app.js` (`collect()` takes `promote_bias`, `biasApplied` replay, `runPlan` honours an internal `candidate_source`; `POST /api/collect` accepts `promote_bias`), `server/scripts/collect.js` (`--promote-bias <0..1>`), `test/server.test.js` (+2), this file. `server/scenarios.js` untouched.
- How "random-biased" is decided: `perturb()`'s first `rng()` is the bias draw, and it uses a promote move only when that class is non-empty. `collect()` replays `U.rng(seed)()` < bias and checks the class is non-empty with `scenarios.movesByVerdict` (cached). The test with bias 1 confirms every biased candidate is in the promote class, and with 0.3 the count matches the replay.
- Verify step run + output: `npm test` → 65/65 pass (after merging the integration branch: 63 before my change). CLI test (`MUBIT_MOCK=1`, temp data dir): `collect: n=4 seed=3 circuit=silverstone with_rules=false promote_bias=0.5 concurrency=2 … [MUBIT_MOCK]`; `--promote-bias 3` → exit 1. Bias 0 reproduces the no-bias candidates exactly.
- v2 command (integrator, Saturday budget): `npm run collect -- --n 40 --with-rules --promote-bias 0.3`. `POST /api/collect` equivalent: `{ n: 40, with_rules: true, promote_bias: 0.3, confirm: "trained" }`.
- Decisions proposed: D-S11 `candidate_source` gains the value `"random-biased"` (ledger rows); `collect()` result gains `promote_bias` and `biased`.
- Blockers / questions for Tanuj: none.
- Next three actions: (1) review responses on PRs #5/#6; (2) GAME P1.T2 payload check against `/api/race/result`; (3) `npm run exam` dry run with `MUBIT_MOCK=1` against the committed `data/exam.json` in a temp data dir.

### 2026-10-24 01:25 London — agent B (Claude) — status widget plumbing (F-06 widget data)
- Status: done, PR open into `claude/amazing-planck-804i13` (branch `claude/server-p1-status`, stacked on `claude/server-p1-rules`; merge #2, #3, #5 first).
- Files changed: `server/app.js` (`statusView`, `budgetView`, `POST /api/status`), `test/server.test.js` (+1 test), this file.
- Contract for the UI lane (`GET /api/status`, and the SSE `status` event, same view): existing fields plus
  - `prompt_hash`: sha256 of `lab/prompt.js` (`6c5be1a3…ce6a`); the widget can show the first 8 chars next to `prompt_version`.
  - `last_console_read_at`: ISO time of the last `POST /api/status` that carried a console field (`task_name`, `kept_examples`, `adapter_version`, `test_result`, `exam`); `null` until Tanuj enters the first read-out. An explicit `last_console_read_at` in the body wins; a bad string → 400.
  - `budget: { day_utc, trained_today_utc, untrained_today_utc, resets_at, boundary: "00:00 UTC = 01:00 London" }` from `calls.jsonl` rows whose `created_at` falls on today's UTC day (`illegal` rows excluded; they never reached Mubit).
  - Computed fields (`budget`, `prompt_hash`, `model`, `prompt_version`, `calls_*`, `experiments`) cannot be overwritten through `POST /api/status`.
- Verify step run + output: `npm test` → 52/52 pass. Mock server: one `/api/plan`, then `POST /api/status {task_name, kept_examples: 43, adapter_version: "v1"}`, then `GET /api/status` → `kept_examples 43, prompt_hash 6c5be1a3…, last_console_read_at 2026-10-23T23:27:26Z, budget {day_utc 2026-10-23, trained_today_utc 1, untrained_today_utc 0, resets_at 2026-10-24T00:00:00.000Z}`.
- Decisions proposed (for the integrator to log in TASK_LOG): D-S9: budget counters are per UTC calendar day of `calls.jsonl` rows (matches ROADMAP "00:00 UTC = 01:00 London"); D-S10: `last_console_read_at` is stamped server-side on any console-field update (additive to ARCH §5 status shape).
- Blockers / questions for Tanuj: none. Note for the integrator: `data/calls.jsonl` on your machine has the 57 trained Friday-budget rows, so `trained_today_utc` reads 57 until 01:00 London, then 0.
- Next three actions: (1) respond to review on PRs #2/#3/#5/status; (2) when GAME P1.T2 lands, post one real `purple:result` payload through `/api/race/result` in the browser and record T-F04-AC2 here; (3) when EVAL ships `data/exam.json`, dry-run `npm run exam` with `MUBIT_MOCK=1` and check the `status.exam` write (no live exam calls without the integrator's go).

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
