# PURPLE · ENGINE v2 — the autonomous engineer

Version 1 · 2026-10-24 · branch `claude/engine-v2` · status: **built, tested with a mocked LLM (`test/engineer.test.js`, 8 tests),
mock runs measured; no live Mubit call has been made by engine v2 yet** (no key in the build environment). The public site
therefore replays the two recorded live engine-v1 hybrid runs until a live v2 run is recorded (§6).

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
- **Live (after `/unlock`, or a local server with `MUBIT_API_KEY`):** "Go live" posts `{ mode: "engineer", llm: "live" }` (20 untrained
  calls, `x-middleware-record: metadata`). Trained engineer runs need `trained: true, confirm: "trained", confirm_text: "TRAIN n"`,
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
peak, 15), workers, resume_from | resume_state }` → SSE events `start, request, proposal, progress, screen, decision, revert, done,
final`. Files per run: `calls.jsonl, decisions.jsonl, events.jsonl, state.json (resumable), tree.json, run.json` (live runs under the
data dir's `concept-engine/`, counted by the trained-call budget; mock runs under the OS temp dir).
Code: `concept/engineer/{engine,tree,subspace,screen,screen-worker,scenario,replay}.js`, `server/campaign-route.js`
(`startEngineer`), `server/vercel.js` (engineer mode; a resumed run is served only by the instance that took its POST; live resume is
local only), `concept/lab/engineer-panel.{js,css}`. Tests: `node --test test/engineer.test.js`.
