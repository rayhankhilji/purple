# PURPLE — prompt for the next integrator (session 4)

The owner pastes the text between the `---` lines as the first message, with the three secrets filled in. **The secrets are never
committed:** this file keeps placeholders; the filled copy lives only in the chat.

---
You are the integrator of PURPLE, a 24-hour hackathon build (Night Shift, London, judged by the Mubit team). The owner delegates routine
decisions to you and wants real questions asked, batched, in plain short English (no jargon walls).

**Repo:** `rayhankhilji/purple`. **Start from branch `claude/happy-darwin-eoivl5`** (the integration head; everything is merged there).
If your session is assigned another branch, create it from `origin/claude/happy-darwin-eoivl5` and push only to your assigned branch.
`claude/amazing-planck-804i13` (PR #1) is stale; the owner is retargeting PR #1.

**Secrets (never commit, print, log or put in a URL; `server/.env` and the Vercel env are the only places they live):**
- Mubit API key: `<MUBIT_API_KEY>` → write it to `server/.env` as `MUBIT_API_KEY=…` (umask 077; `server/.env` is gitignored; copy the
  other lines from `server/.env.example`). Check: `npm run smoke` makes ONE untrained call and prints an `mreq_` id.
- Vercel token: `<VERCEL_TOKEN>` → keep it in a file outside the repo (e.g. your scratchpad, mode 600) and pass it as an env var:
  `VERCEL_TOKEN=… npm run deploy` (project `purple`, `prj_cxnDyBZwQJcRboRkjW5zJgDoFn1B`, team `team_owbc2LUSFCa7ZB6ZV1Z6gwm9`, account
  `rayhankhilji`). `MUBIT_API_KEY` and `PURPLE_PASSCODE` are already set as sensitive Vercel env vars.
- Site passcode for live Mubit calls on https://purple-wine.vercel.app: `<PURPLE_PASSCODE>` (open `/unlock` once, or header
  `x-purple-passcode`). Give it to no one else.
Before every commit: `git grep -nE "mbt_mw-app_[0-9a-f]{16}_|vcp_[A-Za-z0-9]{20}|vck_[A-Za-z0-9]{20}"` must print nothing.

**Read, in this order, before touching anything:**
1. `docs/agents/HANDOVER.md` §1 (live state at handover: product, Mubit, physics, WIP patches, open items) and §5 (hard-won facts).
2. `docs/TASK_LOG.md`: the Decisions table and the session log from "06:14Z — integrator session 3" onward.
3. `docs/ARCHITECTURE.md` (wins every conflict), `docs/EVAL_GUARDRAILS.md` (honesty + Mubit rules are absolute; trained budget now
   2,500), `docs/DEPLOY.md`.
4. `docs/concept/`: CONCEPT, LOOP, DASHBOARD, CAMPAIGN (§4.0), SIM (v3), FIA_CHECKLIST, COUPLING, MATERIALS, RB22_SHEET, RACE, VIEW.

**Then, in this order:**
1. `npm ci && npm test` (expect all green; `test/snapshot.test.js` and two timing tests can flake under load: re-run alone).
   Write `server/.env`, run `npm run smoke`.
2. **Redeploy now** (`VERCEL_TOKEN=… npm run deploy`): production is from an older commit. Check the six pages load, `/api/health`.
3. **Hybrid Mubit result → uncertainty band.** `docs/concept/loop-runs/trained-hybrid-seed41/` (live trained, Mubit proposes → 600-lap
   legal local search → kept by the numbers → next call): 88.763 → **87.282 s** in 45 iterations / 35 calls / 25,856 laps, stopped by
   the owner. Re-score its best car with the campaign's `report()` (concept/campaign) for a ± band, and put it in CAMPAIGN.md, the deck
   (slide 6/11), README, video script and check-in 2 as **the Mubit-directed result**. The plain CMA-ES best (87.235 ± 0.154) is the
   optimiser's, not Mubit's: keep saying so.
4. **WIP patches** (HANDOVER §1d): `docs/agents/wip-patches/more-factors.patch` (new real factors + the RB22-sheet sim fixes: mass 775,
   measured gears 1–5) and `view-rb22.patch` (3D car matched to RB22 photos; the owner said the current car "looks terrible"). For each:
   new branch, `git apply --3way`, finish, tests green, retrain surrogates if physical()/sim changed
   (`node concept/surrogate/train.js --sim physics` and `--sim v0` in parallel), re-run the campaign
   (`node concept/campaign/run.js --seeds 1,2,3,4 --evals 5000 --baselines redbull,generic --refine-evals 3000 --combo-evals 240`),
   update docs, merge, redeploy. Use helpers in worktrees (`.claude/worktrees/`, add to `.git/info/exclude`), local branches, you merge.
5. **Check-in #2 by 18:00 BST** (draft `docs/checkins/checkin-2.md`): give the owner a short plain-English version with the numbers
   (hybrid Mubit result, trained calls, kept rate, best lap vs pole with band, deployed URL). Max (the judge bot) asked for a number.
6. Help the owner fill the FILL boxes (Mubit console: designer kept examples, adapter status, Try models provider vs adapter as n/N;
   research adapters), re-export the deck PDF, and record the video from `docs/video-script.md`. `/submit` (MP4/MOV ≤ 3 min + PDF)
   opens 20:00 BST; first wave Sun 00:00 BST; code freeze Sun 05:00 GMT.
7. More trained designer data if useful: prefer the hybrid mode (server route `POST /api/concept/engine/run` `{ mode: "auto", llm:
   "live", trained: true, confirm: "trained", confirm_text: "TRAIN <n>", max_calls: n, search_budget: 600, scope: "wide", seed, team:
   "redbull" }` on a local `PURPLE_PORT=… node server/index.js`), copy each run dir from `data/concept-engine/<id>` to
   `docs/concept/loop-runs/trained-hybrid-seed<N>/` (the budget counter only sees `trained-*` folders) and commit.

**Hard rules:**
- Never change `lab/prompt.js` (research task, sha 6c5be1a3) or `concept/designer/prompt.js` (designer task v1, sha 71d48c5a): a changed
  task key is a new Mubit task. Mubit is called only from `server/mubit.js`.
- Non-decision Mubit calls are untrained (`x-middleware-record: metadata`). Trained designer calls are approved by the owner (budget
  2,500 total; 465 used at handover). Concurrency ≤ 2.
- `MUBIT_MOCK=1` writes to `data-mock/`; never point mock mode at `data/`. Restore the research ledger if `data/` is empty:
  `cp docs/ledger-snapshot/2026-10-24_02-37-26Z-0530-windcap-exam/*.json* data/ && rm data/counts.json`.
- Never the words CFD, wind tunnel, validated; exam/Try-models scores as n/N, never %. Every number carries its source label.
  "Model prediction ± band", never "we beat F1" as fact. Equation I is pre-existing: disclose it (deck slide 2, README, video first 20 s).
- Never `pkill`/`killall`: kill only PIDs you started. Stamp the log with `date -u`. Commit and push after each step (a stop hook
  checks); never commit secrets.

**Owed by the owner (ask once, batched):** Mubit console numbers (above); confirm new designer calls land under the existing designer
task; check-in #2; ask an organiser about building on Equation I; the video, `/team create`, `/submit`; retarget PR #1; after the event,
rotate the Mubit keys and delete the Vercel tokens (they were pasted in chat).

**When your budget runs low:** refresh HANDOVER §1, save WIP as patches under `docs/agents/wip-patches/`, push, and give the owner this
file's prompt with the secrets filled in.
---
