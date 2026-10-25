# PURPLE · ENGINE v2 — the autonomous engineer

Version 1 · 2026-10-24 · branch `claude/engine-v2` · status: **built, tested with a mocked LLM (`test/engineer.test.js`, 8 tests),
mock runs measured; no live Mubit call has been made by engine v2 yet** (no key in the build environment). The public site
therefore replays the two recorded live engine-v1 hybrid runs until a live v2 run is recorded (§6).
Update 2026-10-24 (`claude/fast-live`): **§9 parallel rounds** (K ideas from Mubit at once per round, each with its own focus line) and the
**"kept" training rule** (an idea trains Mubit when physics kept a faster legal car from it); Go live = 10 rounds × 4 ideas in ≈ 50 s.

Label on every lap number: **"physics lap sim · quasi-steady-state point mass · Silverstone · calibrated to 2026 British GP
qualifying"**. A surrogate value is a ranking, never a reported lap. Model predictions, not a real car's lap.

## 1. What changed from v1 and why

The v1 hybrid (Mubit proposes → 600-lap local search → kept by the numbers) reached 87.282 s (seed 41) and 87.683 s (seed 42), but
the evidence in the recorded runs is that **most of the gain was not Mubit's**: Mubit's proposals were illegal 14/45 and 7/18 times,
each illegal proposal was *discarded* and a seeded random step measured instead, and only **13 % (seed 41) and 7 % (seed 42) of the
kept lap-time gain** came from Mubit-directed iterations (computed by `concept/engineer/replay.js` from the recorded events; the
replays show these numbers on the page). v2 changes three things:

1. **A proposal is a direction, never discarded.** As proposed it is measured; if it is illegal it is projected onto the legal space
   (furthest legal point on its line) or *repaired* (the fastest legal variant that still moves every proposed parameter the way the
   proposal did), and its whole subspace is explored either way. The only engine-chosen direction is after a **parse error or an
   LLM error** (labelled `by: "engine"` everywhere; its gains are never credited to Mubit).
2. **Scale.** Each decision screens thousands of variants (default 3,000) with the µs surrogate and confirms the best on the physics
   sim, instead of a few hundred physics laps in a blind local search.
3. **A design tree with automatic branching.** Peak, head, branches, revert to the peak, fork from the best other car; the state goes
   into the next scenario.

## 2. One decision

```
           ┌──────────────────────────── decision k (concept/engineer/engine.js) ─────────────────────────────┐
 tree ───▶ │ scenario (engineer/scenario.js, ≤ 1,800 chars): best = branch HEAD car, tree = {peak, head vs peak,  │
 (peak,    │   fails, abandoned branches, last move}, tested = this branch's last decisions + measured results    │
  head,    │                       │ one call, FROZEN designer task (prompt.js untouched), server/mubit.js          │
  branches)│                       ▼                                                                               │
           │ MUBIT DECIDES: {changes 1-3, hypothesis, expected}  ── parse / LLM error ─▶ engine fallback (labelled) │
           │                       ▼                                                                               │
           │ ENGINE: subspace = proposed params + coupled params (rear wing → rest of rear wing, diffuser, FW setting) │
           │   as proposed ─▶ physics;  illegal? ─▶ projection / repair ─▶ physics                                 │
           │   screen 3,000 variants: FIA checks + PU / material guards + surrogate lap (worker threads)            │
           │   confirm top 24 (+4 unranked, + every slot the surrogate could not fill) on the physics sim + FIA      │
           │   interactions: best car's changes grouped by part, each alone vs together → term (s)                 │
           │   KEEP by the numbers: legal && lap < head − 0.1 ms → head moves (peak too if fastest)                 │
           │   3 decisions on a branch without a kept car → revert to peak, or fork from the best other car         │
           └───────────────────────┬──────────────────────────────────────────────────────────────────────────────┘
                                   ▼  decision row (request id, hypothesis, as proposed, subspace, screened, laps, best,
                                      interaction, kept / reverted) → tested[-1] of decision k+1's scenario
```

| Mubit decides | The engine does |
|---|---|
| which parts / parameters to change and which way, how far (the direction) | turns it into a subspace (proposed + coupled; discrete params enumerated, continuous sampled) |
| its hypothesis and expected sign / sector (recorded, compared, never used to decide) | screens thousands of variants, confirms the best on the physics sim, measures interactions |
| reads the tree state, its own previous results, abandoned branches | keeps or rejects by the numbers; reverts / forks automatically; reports it back as state |

The scenario reports state and results only (the test asserts no instruction words such as "should", "try", "avoid"). The system
prompt is the frozen v1 designer prompt (task-key sha `71d48c5a…`, `test/concept-designer-frozen.test.js`); `best` is now the branch
head car, which is "the current best car" of its branch.

## 3. Subspace (`concept/engineer/subspace.js`)

The parameter list is read from `concept/parts.js` `PARAMS` every time (joined with the FIA-tightened box of
`concept/campaign/space.js`), so new parameters need no code change. **Integer parameters with ≤ 12 levels are discrete and
enumerated** (profile volumes; the redesigns concept families `sidepods.concept`, `nose.concept`, `front_wing.endplate`,
`rear_wing.style`, `floor.edge`, `cooling.layout`, `engine_cover.style`, `suspension.front` from `docs/concept/REDESIGNS.md §1`, labels
from `parts.CONCEPTS` when present): the first `combos` variants cover every combination. Continuous parameters are sampled in a
window (proposed: around the proposal's target, half gaussian, half uniform; coupled: 40 % at the head's value, else uniform).
Coupling table (`COUPLING`): rear wing ↔ diffuser, front-wing setting, engine cover; front wing ↔ nose, rear-wing setting, ride
height; floor ↔ diffuser, rear-wing setting, suspension; sidepods ↔ cooling, engine cover, floor width; layout ↔ survival cell,
ballast; … ≤ 8 dimensions. Variant *i* is a pure function of (subspace, seed, *i*), so worker threads and a resumed run regenerate it.

## 4. Screen and confirm (`concept/engineer/screen.js`)

Per variant: `design.applyChanges` → `regs.checkFacts` + homologated-PU + material guards → `physical()` → surrogate
`predictLap` (physics-silverstone model). **Outside the surrogate's training box it refuses (no extrapolation)**: such legal cars are
counted `oob` and only reach the physics sim unranked (4 explore slots, plus every top-K slot the surrogate could not fill). Chunks
of 250 variants with fixed boundaries run on worker threads; the merge is by (surrogate lap, index), so the screened set and top-K
are identical for any worker count (tested with 0 and 2). Every reported number is a physics lap (`concept/campaign/pool.js` →
`concept/bench.js`, worker threads). Known limit: once the car drifts far from the RB22 the surrogate's box no longer covers it
(it was trained around the baseline) and the screen goes blind; then the confirm slots are filled with unranked legal variants.
Retraining the surrogate around the current peak is the fix (not done).

## 5. Speed (measured, this machine: 4 CPUs, 4 worker threads, mock LLM, 30 decisions)

| | value |
|---|---|
| variants screened | 76,457 distinct (90,000 generated) in 8.3 s → **≈ 9,200 variants / s** |
| physics laps (FIA-checked) | 747 in 9.1 s → **≈ 82 physics laps / s** |
| one decision | ≈ 0.7 s without the LLM (live Haiku adds 2-3 s per call) |
| result (mock directions) | 88.763 → 87.376 s, 17 kept, 1 revert, 2 forks, 4 branches, illegal proposals 11 → 7 projected / repaired; 96.5 % of the kept gain from model-directed decisions (the mock, here) |

Single-thread screening is ≈ 2,400-5,000 variants / s. On Vercel (one vCPU, one worker) expect ≈ 2,000 variants / s and ≈ 15 laps / s:
a 3,000-variant decision takes ≈ 3-4 s plus the call. The run checks the time box between decisions (adapter `PURPLE_TIME_BOX_S`,
default 240 s; ≤ 270 s) and stops cleanly; the final event carries a resumable state.

## 6. Public site: replay, live, offline demo

- **Replay (default, no passcode):** `concept/lab/replays/*.json`, built by `node concept/engineer/replay.js` from recorded **live**
  runs only (every call must carry a real `mreq_…` id, else the run is refused). The bar says "replay of a recorded live Mubit run ·
  date · n calls · request ids". Bundled now: `trained-hybrid-seed41` (35 trained calls, 87.282 s), `trained-hybrid-seed42` (18 calls,
  87.683 s), `trained-seed29` (pure designer loop, 88.292 s). All are engine v1: the cards say so, and the share of kept gain directed
  by Mubit (13 %, 7 %, 77 %) is shown, not hidden.
- **Live (after `/unlock`, or a local server with `MUBIT_API_KEY`):** "Go live" on the Mubit-first lab posts parallel rounds (§9):
  `{ mode: "engineer", llm: "live", record_good: "kept", ideas: 4, rounds: 5 | 10 | 20, max_calls: 4 × rounds, variants: 600,
  confirm_k: 8, explore: 2 }` (default 10 rounds = 40 untrained calls, `x-middleware-record: metadata`). The older one-at-a-time form
  `{ mode: "engineer", llm: "live" }` (20 untrained calls) still works. Trained engineer runs need `trained: true, confirm: "trained", confirm_text: "TRAIN n"`,
  `n ≤ 2,000`, budget left (same rules as `auto`; not exposed on the main page).
- **Offline demo (mock):** an explicit button; the bar says "the proposals come from a SCRIPTED MOCK, not a model".
- To publish a new live v2 run: copy `<data dir>/concept-engine/<run id>/` to `docs/concept/loop-runs/<name>/`, run
  `node concept/engineer/replay.js`, commit `concept/lab/replays/`. v2 runs are listed first.

## 7. Learning

- **Within a run** (in-context): decision k's measured result (as proposed, projection, subspace best, interaction term, kept, segments
  gained / lost) is `tested[-1]` of decision k+1's scenario, the tree state tells the model where the peak is, how far the head is
  behind it and which branches were abandoned with which parts. One run = one Mubit session (`metadata.user_id` = run id).
- **Across runs** (Mubit): trained calls are stored by Mubit as examples of the designer task (scenario with measured history →
  proposal). Mubit selects kept examples and trains an adapter on them (imitation of Haiku on these inputs; LOOP.md §4-5: there is no
  outcome / reward API). v2's scenarios carry richer state, so the examples pair "this is what the tree looks like and what the last
  subspaces measured" with the next direction.

## 8. API, files, tests

`POST /api/concept/engine/run { mode: "engineer", llm: "mock" | "live", trained, confirm, confirm_text, max_calls, max_decisions,
seed, team, variants (100-50,000), confirm_k (4-128), explore, patience (fails before revert, 3), stop_after (decisions without a new
peak, 15; rounds in round mode), workers, resume_from | resume_state, record_good (true = "kept" | "kept" | "exact"), ideas (1-8,
default 1), rounds (1-50; max_calls defaults to ideas × rounds), time_box_s (10-3,600) }` → SSE events `start, request, proposal,
progress, screen, decision, revert, done, final` (+ `round, tested, round_done` with ideas > 1, `training_example` with record_good). Files per run: `calls.jsonl, decisions.jsonl, events.jsonl, state.json (resumable), tree.json, run.json` (live runs under the
data dir's `concept-engine/`, counted by the trained-call budget; mock runs under the OS temp dir).
Code: `concept/engineer/{engine,tree,subspace,screen,screen-worker,scenario,replay}.js`, `server/campaign-route.js`
(`startEngineer`), `server/vercel.js` (engineer mode; a resumed run is served only by the instance that took its POST; live resume is
local only), `concept/lab/engineer-panel.{js,css}`. Tests: `node --test test/engineer.test.js`.

## 9. Parallel rounds and the "kept" training rule (2026-10-24, branch `claude/fast-live`)

Why: on the public site (1 vCPU, 240 s time box) Go live made one call, then screened 3,000 versions and drove ~30 physics laps, one
decision at a time (≈ 5.5 s each with a 2.3 s call): 40 or 120 decisions could not finish, and nearly every card read "✗ slower …
correction: not trained" even when the engine had kept a faster car from that idea.

**A round** (`ideas` K = 2-8, `concept/engineer/engine.js`): K designer calls go out AT ONCE, all from the same head car. At
temperature 0 identical inputs give identical answers, so call *i*'s scenario starts with one more fact, `focus: "<area>"`
(`concept/engineer/scenario.js` FOCUS: "front wing and nose" · "rear wing and diffuser" · "floor, sidepods and cooling" ·
"suspension, set-up and gearbox", then four more for K = 5-8, all distinct; K < 4 rotates through the first four by round). Only the
user message changes: the frozen designer task (system prompt, model, max_tokens, temperature; `concept/designer/prompt.js`) is the
same on every call (`test/engineer-rounds.test.js`). The focus line also spreads the ideas over the car instead of the rear-wing
fixation measured in `TESTS_TO_POLE.md`. The engine then tests every idea exactly as in §2 (as written, projection / repair, screen,
confirm, interactions; its own decision row with `round, slot, of, focus`), takes the round's fastest legal car, keeps it if it beats
the head (one tree step per round: `patience` and `stop_after` count rounds), and the round ends. Rows also carry `found_faster` (the
idea's best legal version beat the head by > 0.5 ms) and `round_best`. SSE adds `round` (focus list), `tested` (per idea) and
`round_done` (kept, Δ, versions, laps, ms). Calls in flight: ≤ 8 per run (the route's slot limit for the K calls and the trained
re-sends; `server/mubit.js` SLOTS 2 → 8, G-MUBIT-05). `time_box_s` (the Vercel adapter sends its time box − 10 s): the run stops
cleanly BEFORE a round that would end after it, judged on the slowest of the last three rounds: "stopped at the time limit after N
rounds".

**Training rule** (`record_good`, `concept/engineer/record-good.js`), a named option:
- `"kept"` (the default for live runs; `record_good: true` means it): an idea becomes a Mubit training example when **physics kept a
  faster legal car from it**: the engine's best legal version of the idea (as written, made legal, or a screened variant of its
  subspace) beat the head car it started from by more than 0.5 ms. That is what the card's main chip says ("✓ kept −0.021 s", or
  "✓ faster car −0.012 s" when another idea of the same round was faster still).
- `"exact"` (the harvest's, `concept/engineer/cli.js --record-good`, and `recorder()`'s default): the idea exactly as written was
  legal and faster.
Either way the trained call re-sends the identical request (same user content incl. its focus line, same session, same frozen task;
temperature 0, so the same answer), the as-written lap stays on the card as the grey line "as written: +0.19 s", ideas from the
engine's own fallback step (`by: "engine"`) are never trained, and every rejected idea stays an untrained call whose measured result
goes back to Claude in the next scenario ("correction: back to Claude"). Honest reading: under "kept" the example says "this
direction led the engine to a faster car", not "this exact change was faster"; the harvest keeps the stricter rule.

**Go live** (Mubit-first lab): 5 / 10 / 20 rounds × 4 ideas (default 10 = 40 calls), 600 versions screened and 8 (+ 2 explore)
confirmed per idea. The public site reserves ideas × rounds live calls of its hourly limit (`server/vercel.js`; defaults raised to
160 per IP / 800 site-wide per hour); the trained re-sends are counted by the project's trained-call budget (the route checks
`TRAIN <max_calls>` and the remaining budget as before).

Measured on this machine (4 CPUs, the run pinned to ONE CPU with `taskset`, engine workers 1 like a Vercel function, a stub Mubit that
sleeps 2.3 s per call and answers with the scripted mock; another session's browser was running on the machine at the same time):

| run | total (incl. start + final re-score) | per round / decision | versions · physics laps | calls (+ trained re-sends) |
|---|---|---|---|---|
| **Go live 10 rounds × 4** (stub 2.3 s) | **49.5 s** | 4.47 s mean (first 7.2 s, then 4.2 s; 2.3 s of it the 4 calls at once) | 22,921 · 467 | 40 (+33) |
| Go live 20 rounds × 4 (stub 2.3 s) | 83.5 s | 4.07 s | 46,008 · 903 | 80 (+48) |
| 20 × 4 with time_box_s 60 | 60.1 s: "stopped at the time limit after 13 rounds" | 4.28 s | 29,727 · 603 | 52 (+41) |
| offline demo 10 × 4 (mock, no delay) | 22.2 s | 2.0 s | 23,492 · 480 | 40 |
| old Go live: 12 decisions one at a time, 3,000 versions / 24 confirmed (stub 2.3 s) | 71.5 s | 5.54 s per decision (40 would need ≈ 220 s) | 34,088 · 343 | 12 (+10) |

So 40 Mubit ideas now take about 50 s instead of ≈ 220 s, and the default run fits the 230 s engine time box with about 4.5× margin
(20 rounds: 2.7×). A Vercel vCPU may be slower than this machine's core; the time box stop covers that.

## 10. Shared memory: precedents from physics-approved decisions (2026-10-25, branch `claude/memory-harness`)

Why: on the designer exam (30 held-out car states, physics-graded) Haiku 4.5 keeps 9/30 ideas exactly as proposed. The harvests
already hold 10,188 decisions whose change, exactly as proposed, was legal and faster on the physics lap sim. The memory gives every
model the same access to them, model-agnostic: one index, one retrieval, one block in the user message.

- **Index** `concept/engineer/memory/approved.json` (1.35 MB; built by `node concept/engineer/memory/build.js --runs DIR`,
  deterministic; DIR holds the harvests' per-run logs `harvest/ harvest2/ harvest3/ harvest-compact/run-seed<N>/`, kept outside the
  repo). Joins each `good.jsonl` row of `docs/concept/loop-runs/{trained-harvest,-2,-3,trained-compact-harvest}` with its run's
  `request` (head car), `proposal` (change) and decision row (as proposed: legal, d_lap_s; checked against good.jsonl). 10,183 of
  10,188 rows joined (5 rows' run logs are missing), 8,261 entries on 7,565 distinct head cars after dedupe (same change on the same car).
  **Held out:** rows from the exam's source seeds 101-110 and rows whose head car equals an exam question's head car are dropped
  (none occurred: the harvests used other seeds); `test/engineer-memory.test.js` checks the committed file and a fixture build.
- **Retrieval** `concept/engineer/memory.js retrieve({ head, decisions, k: 6, chars: 1200 })`: distance = mean |Δ| over the 36
  parameters normalised by their model ranges; only precedents whose changed parameters started from THIS car's values (so the
  change applies exactly as approved); a change already proposed in the run, a no-op or out-of-range change is left out; the same
  change on several cars is one candidate, support Σ n·exp(−distance/0.005); the top candidates that pass the engine's own FIA /
  PU / materials check on this car (no lap is run), one per parameter, ≤ 6 lines, ≤ 1,200 chars. Line:
  `similar car (distance 0.118, 127 cars): rear_wing.endplate_top_mm 870->880 legal, -0.003 s`. Facts only.
  The settings were chosen on DEV states (the exam's own procedure on seeds 9101-9110), never on the exam: there the top precedent was
  legal and faster on 23/30 states (106/179 of all lines).
- **Scenario** `fit({ ..., memory: { decisions } })` appends `"precedents": [lines]` LAST (after corrections); engine
  `opts.memory` (default **false**: every scenario byte for byte as before), `runEngine({ memory })`, CLI `--memory on|off` (off).
  The frozen task is untouched; server route defaults unchanged.
- **Exam** `node concept/exam/run.js --build-questions --memory` → `concept/exam/questions-memory.json` (the same 30 states;
  text minus the block = questions-corrections.json, checked; block 425-579 chars, 5-6 precedents; whole message 3,293-3,718 chars).
  `--column base --model ID --memory` → `results-base-<slug>-memory.json`; `--column memory` → `results-memory-only.json`, the
  **"Memory only (no model)"** baseline (the first precedents line applied as listed, no call): **26/30 kept as proposed**
  (early 10/10, mid 8/10, late 8/10), legal 30/30, mean gain 0.0147 s; No AI on the same set 3/30 (`results-none-memory.json`, as on the other sets: it never reads the message).
  The Exam tab has a third question-set button "with shared memory" and "All three side by side" (plain · + corrections ·
  + corrections + memory, kept as proposed per column).
- Live (integrator; untrained, `x-middleware-record: metadata`): `node concept/exam/run.js --column base --model claude-haiku-4-5 --memory`
  (and `claude-sonnet-5-5`, `claude-opus-5-5`); an engine run with memory: `node concept/engineer/cli.js --live --memory on --seed N --out DIR`.
