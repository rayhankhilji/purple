# PURPLE · DEPLOY (Vercel)

Production: **https://purple-wine.vercel.app** · Vercel project `purple` (`prj_cxnDyBZwQJcRboRkjW5zJgDoFn1B`, team
`team_owbc2LUSFCa7ZB6ZV1Z6gwm9`, account `rayhankhilji`) · region iad1 · Fluid compute · Node 24.x.

| Page | URL |
|---|---|
| Concept lab (the product; the site root redirects here) | `/` → `/concept/lab/?api=/` |
| The game (Equation I, pre-existing) | `/index.html` |
| Research lab | `/lab/` (redirects to `/lab/?api=/` so the page talks to this site's API, not 127.0.0.1:8787) |
| Concept lab (Mubit loop drawer, Engine dashboard) | `/concept/lab/` (same redirect; `?engine=1` etc. are kept) |
| 3D viewer | `/concept/view/` |
| Silverstone race replay | `/concept/race/` |
| Unlock live Mubit calls | `/unlock` → `/api/unlock` |
| What this deployment is (limits, snapshot, live on/off) | `/api/deploy` |

Local `npm run dev` is unchanged: `server/vercel.js` is only loaded by the Vercel function.

## 1. Redeploy (one command)

```bash
VERCEL_TOKEN=... npm run deploy      # = node server/vercel.js deploy -> npx vercel@65.2.0 deploy --prod --yes
```

Put the token in the environment (for example `set -a; . /path/outside/the/repo/vercel.env; set +a`), never in a file in the
repo or in a commit. The script writes `.vercel/project.json` (gitignored) from the project ids above when it is missing, because
a user-scoped token cannot run `vercel link` (it lists teams and gets a 403). The upload is what `.vercelignore` allows; Vercel
runs `npm ci` and `node server/vercel.js build` (copies the static site into `public/`) and bundles `api/index.js`.

## 2. How it is put together

- **Static site** (`node server/vercel.js build` → `public/`): `index.html`, `js/`, `css/`, `vendor/`, `assets/`, `lab/`,
  `concept/`. Left out: `server/`, `data/`, `docs/`, `test/`, `tools/`, the two frozen prompts (`lab/prompt.js`,
  `concept/designer/prompt.js`; no page loads them) and the 13 MB telemetry archive except
  `concept/data/telemetry/silverstone-2026-q-*.json` (the race replay fetches the pole lap). Caching: `vendor/` immutable 1 year,
  `assets/` 1 day + SWR, `concept/data/` 1 hour + SWR, everything else Vercel's default (revalidate every load), `/api/*` no-store.
- **API**: one Node function, `api/index.js` → `server/vercel.js` → `createApp()` of `server/app.js`. `vercel.json` rewrites
  `/api/*` to it; `maxDuration` 300 s (Fluid compute). The bundle includes `server/`, `lab/`, `concept/` (no telemetry, no
  PNGs), `js/`, `vendor/three.min.js`, `test/mocks/` (the mock planner), `docs/ledger-snapshot/`, `docs/concept/COUPLING.md`
  and `docs/concept/loop-runs/` (counted by the engine's trained-call budget).
- Hooks added for this (no change to local behaviour): `createApp({ hostOk })` (the loopback Host guard accepts this site's host on
  Vercel), and `server/concept.js` passes `shouldStop` to the loop (set only by the adapter's time box).

## 3. Environment variables (names only)

| Name | Where | Notes |
|---|---|---|
| `MUBIT_API_KEY` | production + preview, sensitive | read only by `server/mubit.js`; never sent to the browser or logged (G-SEC-02) |
| `PURPLE_PASSCODE` | production + preview, sensitive | the live-call passcode (below) |
| `MUBIT_MOCK` | **must not be set** | if set, live calls are refused (`/api/deploy` says why) |
| optional: `PURPLE_LIVE_PER_IP_HOUR`, `PURPLE_LIVE_GLOBAL_HOUR`, `PURPLE_CPU_RUNS_PER_IP_HOUR`, `PURPLE_CPU_RUNS_GLOBAL_HOUR`, `PURPLE_TIME_BOX_S` | | override the limits in §5 |

Change one: `npx vercel@65.2.0 env rm NAME production --yes --token "$VERCEL_TOKEN"`, then add it again piping the value on
stdin (`printf %s "$VALUE" | npx vercel@65.2.0 env add NAME production --sensitive --token "$VERCEL_TOKEN"`), then redeploy.

## 4. Live Mubit calls and the passcode

- Without the passcode every Mubit call from the public site is **mock**: the research lab runs on the mock planner (request ids
  `mock-…`, never `mreq_…`), the concept loop and the engine's autonomous mode run with `mode/llm: "mock"`, and asking for
  `live` answers **403 `PASSCODE_REQUIRED`** with a pointer to `/unlock`.
- **The passcode** is held by the owner (the integrator hands it over; it is not in the repo or in this file). Type it once at
  `https://purple-wine.vercel.app/unlock`: the browser gets an HttpOnly, Secure, SameSite=Strict cookie (`purple_live`, path
  `/api`, 12 h; an HMAC, not the passcode). Scripts can send the header `x-purple-passcode` instead. `/api/lock` clears the cookie.
  10 wrong tries per IP per 10 min, then 429. To rotate it: change `PURPLE_PASSCODE` (§3) and redeploy; old cookies stop working.
- With the passcode, live calls are **untrained** (`x-middleware-record: metadata`) unless the existing confirm rules are met:
  concept loop / engine `trained: true` + `confirm: "trained"` (+ `confirm_text "TRAIN n"` for the engine), designer prompt frozen
  (v1). Research `/api/plan` calls train by design (`lab/prompt.js`), so they go live only with the passcode **and** the header
  `x-purple-confirm: trained`; the research lab's Run button (cookie only) stays on the mock planner. `/api/exam/run` (20
  untrained calls) and `/api/collect` (needs `confirm: "trained"` as before) go live with the passcode.
- Verified on 2026-10-24: one live untrained designer call through `/api/concept/loop` (`mode: "live"`, 1 iteration) returned
  `mreq_01a16d59e6e57aa3b8498ca1a014580e` with `x-middleware-record: metadata` (first deploy, where the run started on the
  POST's instance). The start-at-stream path of the current deploy is covered by `test/vercel.test.js` against a loopback Mubit
  stub (exactly one call per iteration, all from the stream's run); it has not spent a second real call.

## 5. Limits

| Limit | Value | Notes |
|---|---|---|
| live Mubit calls per IP | 30 / hour | reserved up front: concept loop = `iterations`, engine auto = `max_calls` (default 20, trained 10), `/api/plan` = 2, exam = 20, collect = `n` |
| live Mubit calls, whole site | 120 / hour | |
| engine runs (speed or auto) per IP / whole site | 6 / 30 per hour | CPU: each can use a whole function invocation |
| run time box | 240 s | a concept loop or engine run gets one function invocation; then it stops cleanly (`stop_reason` says so), the engine re-scores the best car so far |
| engine workers | 1 worker thread | one vCPU per function (body `workers` is clamped to 0-1) |
| Mubit concurrency | 2 in flight per instance | `server/mubit.js` (G-MUBIT-05) |
| one concept loop and one engine run at a time | per instance | as locally ("already running") |

The counters live **in memory, per instance**. Fluid compute reuses instances, but a cold start or a second instance starts at 0,
so the real ceiling can be a small multiple of these numbers. The trained-call budget (100,000, per-run cap 2,000) is enforced by the
engine as locally, but on Vercel it counts only the call files in the bundle and in `/tmp`: the research agent's `data/calls.jsonl`
is not deployed, and trained calls made here vanish with the instance. **Reconcile trained calls made on Vercel from the Mubit
console**; prefer trained runs locally.

## 6. What is ephemeral

- Storage is the instance's `/tmp`: the research ledger starts from the newest `docs/ledger-snapshot/<run>/` (now
  `2026-10-24_02-37-26Z-0530-windcap-exam`, copied read-only into the bundle); experiments, races, rules, status edits, concept-loop
  and engine run folders written on the site live only in that instance's `/tmp`, are not shared with other instances and vanish
  when Vercel recycles it. Every JSON answer says so in `deploy.storage` (and the header `x-purple-storage: ephemeral`). The real
  `data/` is never read or written.
- Runs live in one instance's memory, and Vercel does route a run's stream to another instance than its POST (seen in testing).
  The stream URL carries a signed ticket (2 min). A mock or speed run starts on the POST's instance (kept alive with `waitUntil`)
  and, if the stream lands elsewhere, is replayed there from the ticket (deterministic per seed; the original stops when nobody
  follows it for 20 s). A **live run always starts where its stream is opened**: the POST only validates it (and reserves the
  rate limit); the run it creates is stopped before any call and cannot reach Mubit (calls are allowed only for runs started from
  a stream), so a live run never makes double Mubit calls. Its Mubit session id is the id of the run the stream started (shown on
  every iteration card), not the `run_id` the POST returned; both ids work for state / stop on the instance that holds the run.
  Stop / state (`/api/concept/engine/run/:id[/stop]`, `/api/concept/loop/:id`) on another instance answer 404.
- The research lab's `/api/stream` ends cleanly after 280 s; EventSource reconnects by itself ("reconnecting" for a moment).

## 7. What works / what does not on Vercel

| Works | Notes |
|---|---|
| all five pages, 0 console errors in headless Chromium | |
| research lab: ledger, rules, status, state, plan (mock), race result, promote, overrule | writes are ephemeral |
| concept loop drawer: mock and live (untrained) | live after `/unlock` |
| engine: info, budget, timings, car sheet, garage (one physics lap per click, ~0.3 s), autonomous mode (mock; live with the passcode) | |
| engine speed run | **time-boxed to 240 s on one vCPU** (≈ 10k physics laps at ~20 ms), stops cleanly with the best car re-scored. A full multi-seed campaign (`evals` 1500 × 4 seeds + refine) needs the local server or a browser path |

| Does not / caveats | |
|---|---|
| speed run in the browser | not built: `concept/campaign/*` is Node code (worker_threads, require). For the integrator: a Web Worker build of `concept/sim` + `concept/campaign/cmaes.js` driven from `concept/lab/engine-panel.js` would remove the time box |
| a missing static file | Vercel answers it with the game's `index.html` (status 200) instead of a 404, despite `public/404.html`; pages load no missing file today |
| preview deployments | protected by Vercel Authentication (project default); production is public |
