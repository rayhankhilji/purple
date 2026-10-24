# PURPLE · CONCEPT LOOP (the closed learning loop with Mubit)

Version 1 · 2026-10-24 · branch `claude/mubit-loop` · status: **built and proven with the scripted mock and a dry run only. No
Mubit or Anthropic call has been made (no `MUBIT_API_KEY` in this environment). The designer prompt is still a DRAFT, so trained
calls are refused by the code.**
Label on every lap number: **"physics lap sim · quasi-steady-state point mass · Silverstone OSM centreline · calibrated to 2026
British GP qualifying"** (the sim's own `LABEL`); concept car numbers also carry the concept label of `concept/bench.js`.

## 1. What the loop does

Each iteration sends the current best car **and the changes already tried with their simulated Silverstone results** to Mubit,
gets the next proposal back, measures it (FIA 2026 legality + PhysicalCar + the physics lap sim), and puts that measured result
into the input of the next Mubit call. One run is one Mubit session. Every lineage row stores the `x-middleware-request-id` of
the call made in its iteration and the id of the later call whose input carried its result back.

```
             ┌────────────────────── iteration k ───────────────────────┐
 lineage ──▶ │ scenario.js: best car + tested[...k-1] with measured       │
 (rows 1..k-1)│   d_lap_s, ds (S1-S3), kept, FIA articles, gain/loss segs │
             │                     │ user message (≤ 1,600 chars)          │
             │                     ▼                                       │
             │ server/mubit.js  POST api.mubit.ai/anthropic/v1/messages   │
             │   system = designer prompt (DRAFT), metadata.user_id = run │──▶ x-middleware-request-id ─┐
             │   x-middleware-record: metadata (untrained, default)       │                             │
             │                     │ proposal JSON                         │                             │
             │                     ▼                                       │                             │
             │ schema.js strict ─ refused? ─▶ seeded fallback step        │                             │
             │                     ▼                                       │                             │
             │ regs.js + physical() + physics lap sim (Silverstone)       │                             │
             │   lap / sector / segment deltas, legality                  │                             │
             │                     ▼                                       │                             │
             │ kept = legal && score_after > score_before (numbers only)  │                             │
             └─────────────────────┬─────────────────────────────────────┘                             │
                                   ▼                                                                    │
                     lineage row k: changes, measured, kept, loop.mubit_request_id ◀───────────────────┘
                                   │
                                   └──▶ last `tested` entry of iteration k+1's scenario  ──▶ row k.loop.fed_to = { k+1, request id }
```

The verdict is never the model's: the output schema has no verdict field (a `kept` or `verdict` key is a parse error and the
seeded fallback is measured instead), and `kept` is computed in `concept/optimize.js` from the simulator's numbers. The weekend
score it compares is monotonic in the simulated lap, so kept means "legal and the simulated lap got faster".

## 2. One iteration, exactly (dry run)

`node concept/designer/loop-cli.js --dry-run --json --iterations 2 --seed 1 --run-id loop-dryrun-seed1` builds every request
with `server/mubit.js` (`buildRequest` and the Anthropic SDK itself, caught by a stub `fetch`: nothing leaves the process, no key
is needed). Iteration 2 of that run, the request that carries iteration 1's result:

```http
POST https://api.mubit.ai/anthropic/v1/messages
accept: application/json
anthropic-version: 2023-06-01
content-type: application/json
user-agent: Anthropic/JS 0.137.0
x-api-key: <MUBIT_API_KEY>
x-middleware-record: metadata
x-stainless-arch: x64
x-stainless-lang: js
x-stainless-os: Linux
x-stainless-package-version: 0.137.0
x-stainless-retry-count: 0
x-stainless-runtime: node
x-stainless-runtime-version: v22.22.0
x-stainless-timeout: 60
```

```json
{
 "model": "claude-haiku-4-5",
 "max_tokens": 250,
 "temperature": 0,
 "system": "<the designer SYSTEM_PROMPT below, 997 chars>",
 "messages": [{ "role": "user", "content": "<the scenario below, one line, 1,102 chars ≈ 276 tokens>" }],
 "metadata": { "user_id": "loop-dryrun-seed1" }
}
```

The user message (line breaks added here):

```json
{"best":{"lap_s":88.695,"gap_s":0.584,"kg":770,"front":0.448,"params":{"layout":{"wheelbase_mm":3400},
 "survival_cell":{"front_axle_offset_mm":75,"cockpit_len_mm":1930,"bulkhead_gap_mm":380},
 "front_wing":{"span_mm":1300,"chord_mm":580,"aoa_deg":25,"elements":3,"sm_delta_deg":4},
 "rear_wing":{"span_mm":1100,"chord_mm":420,"aoa_deg":20,"elements":2,"endplate_top_mm":860,"sm_delta_deg":22.5},
 "floor":{"width_mm":1450,"throat_mm":100,"ride_height_mm":35},"diffuser":{"expansion_deg":14},
 "sidepods":{"inlet_cm2":650,"undercut_mm":100},"ballast":{"x_frac":0.05,"extra_kg":0}}},
 "tested":[{"change":"rear_wing.sm_delta_deg 15->22.5","d_lap_s":-0.054,"ds":[-0.028,-0.02,-0.007],"kept":true,
            "gain":["Wellington Str -0.015","Copse-Maggotts -0.014"],"loss":["Luffield-Woodcote +0.004","Loop +0.001"]}],
 "refused":[],
 "near":["front_wing.elements 3 (max 3 C3.10.1(b))","layout.wheelbase_mm 3400 (max 3400 C2.3.3)",
         "front_wing.chord_mm 580 (max 594 C3.10.1(a))","survival_cell.bulkhead_gap_mm 380 (min 360 C2.3.6)",
         "front_wing.span_mm 1300 (max 1350 C3.10.1(a))","rear_wing.endplate_top_mm 860 (max 880 C3.11.2(a))"]}
```

`tested[-1]` is iteration 1's measured result: the change (from → to), the simulated lap delta (s, negative is faster), the
three sector deltas, kept, and the two segments of the lap that gained and lost most (named corner complexes and straights cut
from the sim's own time-at-distance, `concept/designer/segments.js`). An illegal result carries `illegal: [FIA article, ...]`
instead of a lap; a result the seeded fallback produced carries `by: "fallback"`. Up to three tested rows travel (oldest first);
`fit()` trims the oldest first to stay ≤ 1,600 chars and never drops the current car or the latest result.

The system prompt (DRAFT, `concept/designer/prompt.js`, 997 chars, not frozen):

```text
You are the concept designer of a 2026-style F1 car. Goal: beat the real 2026 Silverstone pole lap by the largest margin while the car stays legal under the FIA 2026 technical regulations.
You receive one scenario as JSON: the current best car (parameters by part), its simulated lap and gap to pole (negative is ahead), recent tested changes (lap and sector deltas in s, negative is faster; kept or not; violated articles; the last is the result of the previous proposal, with the lap segments that gained or lost most), refused proposals, parameters near a limit. Use the measured results. Propose the next change: 1 to 3 parameters of the current best car. A simulator measures it and keeps it only if the lap improves and the car is legal; you do not decide. Never repeat a tested change.
Return ONLY a JSON object with exactly these keys: changes (array of 1-3 {part, param, to}), hypothesis (string, max 160 chars), expected ({lap_delta_s: -1|0|1, sector: 1|2|3}). No prose outside the JSON.
```

What came back in the dry run (the scripted mock, not a model) and what was measured:

```
<- proposal: rear_wing.sm_delta_deg 22.5->30 · "Last change gained -0.054 s (Wellington Str -0.015, Copse-Maggotts -0.014); push the same way."
== measured: lap 88.695 -> 88.692 s (-0.003), sectors [-0.002,0.005,-0.005], gained Hangar Str -0.007, Woodcote-Copse -0.004,
   lost Copse-Maggotts +0.004, Farm +0.002 · legal · KEPT   -> tested[-1] of iteration 3's request
```

## 3. What Mubit receives and what it stores

| Mode | Sent | What Mubit keeps (per its docs) |
|---|---|---|
| `--dry-run`, mock (UI and CLI) | nothing; the request is built and shown | nothing |
| live, untrained (**default**) | the request above, `x-middleware-record: metadata` | It passes the full request on to Anthropic and returns the answer and `x-middleware-request-id`. It keeps a record of the call **without** its request and answer, does not list it in Requests, and it is never a kept example. The loop is closed in the model's input; Mubit's stored record holds no changes and no results. |
| live, trained (`--confirm-trained`, owner approval, frozen prompt only) | the same request without the `x-middleware-record` header | Mubit records request and reply, groups the call into the **designer task** (system prompt + model; separate from the research agent's task), gives it the session `metadata.user_id` = run id, lists it in Requests, and may keep it as an example. Here the stored request of call k+1 **contains call k's proposal (as `tested[-1].change`) and its measured result**. |

Sources: [API reference, request headers](https://docs.mubit.ai/reference/api) ("`metadata` is the same as
`x-middleware-store: false`"; Mubit "keeps a record of the call without its request and answer"); [Find calls in
Requests](https://docs.mubit.ai/guides/requests) ("Mubit keeps no request or answer for such a call, and never lists it");
[Connect Anthropic](https://docs.mubit.ai/guides/connect-anthropic) ("A call recorded without its request and reply is never a kept
example"); [Tasks and sessions](https://docs.mubit.ai/guides/tasks-and-sessions) (task = instructions + tools + tool choice +
output format + model; on Anthropic the session is `metadata.user_id`).

## 4. Outcome feedback: what Mubit supports

I read Mubit's public docs in full ([docs.mubit.ai](https://docs.mubit.ai), the generated full text at
[docs.mubit.ai/llms-full.txt](https://docs.mubit.ai/llms-full.txt), 2026-10-24). Plainly:

- **There is no API to attach a measured outcome, reward, score or label to a recorded call.** The API reference lists only the
  provider paths (`/anthropic/v1/messages`, `count_tokens`, `models`), two request headers that can only lower what is recorded
  (`x-middleware-store`, `x-middleware-record`) and the `x-middleware-request-id` response header. No feedback endpoint exists.
- The console's Requests page has a manual **"Rate this reply: `Good` or `Bad`"** per call and a `Rating` column
  ([Requests](https://docs.mubit.ai/guides/requests)). The docs do not say whether a rating changes which calls become kept
  examples or how adapters train, and they document no API for it. It is a human click, not something this code can send.
- Adapters train on **kept examples** ("the recorded calls Mubit accepts for a task"; Mubit selects them, a task first trains at
  25) and each version is **tested against the provider model's answers** ([Concepts](https://docs.mubit.ai/concepts),
  [First adapter](https://docs.mubit.ai/guides/first-adapter)). Learning is imitation of the provider model on the task's inputs,
  not optimisation of an outcome we report.
- Sessions group a conversation's calls and "Mubit sets a task's test cases aside by session"
  ([Tasks and sessions](https://docs.mubit.ai/guides/tasks-and-sessions)).

So the real mechanism, and the one implemented: **the outcome of call k is part of the input of call k+1 in the same session.**
The model reads it at once (in-context, every mode that reaches the model), and in trained mode Mubit's stored record of call k+1
holds it, so a kept example pairs "here is what the last changes did on the simulator" with "the next proposal".
Alternatives considered and not used:

- A follow-up "result" message as its own call: untrained it stores nothing; trained it would add an example to the designer task
  whose input is a result and whose answer is noise, and spend a call. The next proposal call already carries the result.
- A growing multi-turn conversation (assistant turns + result turns): Requests shows only the last user message of a call, the
  input grows every iteration, and each kept example stops being self-contained. The single-message scenario keeps the last three
  results with their numbers, which is what the proposal should depend on.

## 5. How adapters would learn from it (trained mode, after the freeze)

Each kept example is (scenario with the measured history) → (Haiku's proposal). An adapter trained on them learns to produce the
proposals Haiku produces **given** measured lap, sector and segment deltas, kept flags and FIA articles: e.g. push a change that
gained, reverse one that lost, stay off an article that refused. It learns from the outcomes only through what is written in the
input and through how Haiku reacted to it. Mubit decides which calls it keeps; this code cannot tell it "this proposal was good".

If the team wants the stored examples biased toward proposals that worked, the honest option within Mubit's API (not
implemented, needs an owner decision) is outcome-filtered replay: run untrained, then re-send only the calls whose proposal was
kept, with the same input, as trained calls. At temperature 0 the answer is usually the same; the replay is a second provider call
and its answer is what Mubit records (it can differ, which the lineage would show).

Note on sessions: one session per run (owner's requirement) means a whole run lands on one side of Mubit's train / test split, so
use several runs (seeds), not one long run, before the first training.

## 6. Proof chain (what to show a judge)

- Lineage row k (`lineage.jsonl`, the UI card): `changes`, `measured` (lap before / after, `d_lap_s`, `d_sectors_s`, segments,
  `legality` with articles), `kept`, `loop.session_id` (= run id), `loop.mubit_request_id` (this iteration's call),
  `loop.scenario` (the exact user message sent), `loop.fed_to` (`{ iteration: k+1, mubit_request_id }`: the call whose input
  carried this result).
- `calls.jsonl`: one row per call, `kind: "design"`, `trained`, `session_id`, `mubit_request_id`, tokens, latency.
- Console (trained calls only; untrained calls are not listed): Requests → Session filter = the run id → "Requests in this
  session". The console's own Request ID under Details is not the `x-middleware-request-id` (Requests docs), so match a call by
  session, time and its Request text (the scenario).

## 7. Run it

| What | Command |
|---|---|
| UI (mock) | `MUBIT_MOCK=1 npm run dev` → http://127.0.0.1:8788/concept/lab/?loop=1 (or the orange **Mubit loop** button) → Start loop |
| Dry run (prints every request) | `node concept/designer/loop-cli.js --dry-run --iterations 10 --seed 1` |
| Mock run (quiet) | `node concept/designer/loop-cli.js --mock --iterations 10 --seed 1` |
| API | `POST /api/concept/loop {iterations, seed, mode: "mock"\|"live", trained:false, pace_ms}` → `GET /api/concept/loop/<id>/stream` (SSE: start, request, response, proposal, result, link, done, end) |
| Tests | `node --test test/concept-loop.test.js test/concept-designer.test.js` |

Files: `concept/designer/loop.js` (the loop, the scripted mock, measurement), `concept/designer/segments.js` (named lap segments),
`concept/designer/loop-cli.js`, `server/concept.js` (routes, the live caller, the request preview), `server/mubit.js` (`task`
argument, `buildRequest`, `captureRequest`), `concept/lab/loop-panel.js` (the drawer). Runs from the server write
`<data dir>/concept-loops/<run id>/{events,lineage,calls}.jsonl` and `run.json`: `data-mock/` for mock runs (never `data/`),
the server's data dir for live runs. The CLI writes to `<os tmp>/purple-loop/<run id>` or `--out` (never `data/`, `data-mock/`).
Screenshots: `docs/concept/loop-shots/` (headless Chromium, mock server, 0 console errors).

## 8. Going live (owner)

1. Put the key in `server/.env`: `MUBIT_API_KEY=mbt_...` (never commit it; `.gitignore` covers `server/.env`).
2. Dry run first, nothing sent: `node concept/designer/loop-cli.js --dry-run --iterations 3 --seed 1`.
3. First untrained live run (10 calls, each `x-middleware-record: metadata`, nothing stored by Mubit beyond metadata):
   `node concept/designer/loop-cli.js --live --iterations 10 --seed 1 --out /tmp/purple-loop/live-1`, or `npm run dev`
   **without** `MUBIT_MOCK`, open the concept lab, Mubit loop, mode "live (untrained)", Start.
   Read `calls.jsonl`: real `input_tokens` (the ≈ 650-token estimate below is chars/4), parse failures, fences.
4. Adjust the DRAFT prompt or `LIMITS.chars` if needed (free until the first trained call).
5. Freeze (Tanuj + integrator): `DRAFT = false`, `DESIGNER_PROMPT_VERSION = "1"`, pin `fileSha256()` in a freeze test, TASK_LOG line.
6. Trained runs only with the owner's go: `node concept/designer/loop-cli.js --live --confirm-trained --iterations 15 --seed N`
   (the server route needs `trained: true, confirm: "trained"`). Each call is recorded in session = run id.

## 9. Trained-call budget it would use

| Phase | Calls | Tokens (estimate) |
|---|---|---|
| Untrained live checks | 2 runs × 10 = 20 | ≈ 20 × (650 in + 150 out) ≈ 16k |
| Trained collection (after freeze) | 4 runs × 15 = **60 trained** (4 sessions, so Mubit can set a run aside for tests) | ≈ 60 × (650 in + ≤ 250 out) ≈ 54k |

Input per call ≈ 250 tokens of system prompt + ≤ 400 of scenario (1,600 chars / 4); JSON may tokenise denser, so read
`input_tokens` on step 3. The 60 trained calls count against the project's ≤ 250 trained-call total (EVAL_GUARDRAILS §4), which
the research agent already uses; they share the starter credit and the 3 adapter starts per UTC day. The research agent's exam
and demo calls come first. The task first trains at 25 kept examples (Mubit's default); not every call is kept.

## 10. Limits

- The mock is scripted (it pushes a change that gained, reverses one that lost, otherwise walks a playbook, and sometimes returns
  prose, broken JSON or an illegal value). Its numbers say nothing about Haiku or an adapter.
- Every lap is a reduced-order physics lap sim result at Silverstone, not a real car's lap.
- A refused answer (parse, duplicate, illegal, provider error) is replaced by one seeded fallback step so the loop keeps going; the
  row says `proposer: "fallback"` and the next scenario marks it `by: "fallback"`.
- The research agent's requests are byte-identical to before the `task` argument (sha256 of the body pinned in
  `test/concept-loop.test.js`, measured on a loopback stand-in); `lab/prompt.js` is untouched.
