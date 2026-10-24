# PURPLE — Guardrails and Definition of Done

Version 1.0 · 2026-10-23 · Short, because a hackathon has exactly three ways to lose: break the Mubit task, overclaim, or miss the upload.

## 1. Definition of done

A task is done when its verify step in `TESTING_GUIDE.md` passes and `TASK_LOG.md` says so. A phase is done when every exit criterion in `ROADMAP.md` is true. The project is done when:
- the loop runs live: Design → Evaluate → Race → Overrule → (console) v2 → Try models comparison;
- the console shows a task with ≥ 2 adapter versions, at least one `Passed`;
- the ledger has ≥ 1 experiment with both predicted and measured deltas;
- the MP4 and PDF are uploaded via `/submit` before Sat 23:59.

## 2. Mubit task integrity (the ones that cannot be undone)

| ID | Rule | Verify |
|---|---|---|
| G-MUBIT-01 | `lab/prompt.js`, model ID, `max_tokens`, no tools, no `response_format`: frozen after the first trained call | `git log -p lab/prompt.js` shows one commit; `PROMPT_VERSION` unchanged |
| G-MUBIT-02 | Every non-decision call (smoke, exam, debugging) carries `x-middleware-record: metadata` | `calls.jsonl` rows with `kind != plan` have `trained: false` |
| G-MUBIT-03 | One session ID per experiment (`metadata.user_id = exp-<ulid>`) | ledger `session_id` unique |
| G-MUBIT-04 | Scenario ≤ 350 tokens; history ≤ 3 items | schema test |
| G-MUBIT-05 | Concurrency ≤ 2; honour `retry-after`; retry once | collect script code review |
| G-MUBIT-06 | Mubit is called only from `server/mubit.js` | `grep -r "api.mubit.ai" --include=*.js .` returns one file |

## 3. Security

| ID | Rule |
|---|---|
| G-SEC-01 | `MUBIT_API_KEY` only in `server/.env` (gitignored); server exits if missing and `MUBIT_MOCK` unset |
| G-SEC-02 | Server binds `127.0.0.1`; no key ever reaches the browser or logs |
| G-SEC-03 | `postMessage` handler checks origin and `type === "purple:result"` |
| G-SEC-04 | No personal data in scenarios (Mubit records content by default) |

## 4. Cost

| Item | Budget |
|---|---|
| Tokens per plan call | ≤ 350 in, ≤ 250 out |
| Trained calls total | ≤ 100,000 (owner decisions 2026-10-24: 250 → 2,500 → 100,000; their own Anthropic key is the provider key inside Mubit). Per engine run ≤ 2,000. `npm run collect` keeps a 250 default for the research task (`PURPLE_TRAINED_BUDGET` overrides) |
| Try models calls | ≤ 20 for the exam and rehearsal, 4 reserved for the live demo (daily cap per org; resets 01:00 London) |
| Adapter starts | 3 per UTC day: 1 rehearsal Sunday morning, 1 live, 1 spare |

## 5. Honesty (judged under "technical execution")

| ID | Rule |
|---|---|
| G-HON-01 | Every number on screen carries its source label: "reduced-order lap model · calibrated to 2026 pole laps · aero map v1" or "measured in race, seed N" |
| G-HON-02 | Never the words CFD, wind tunnel, validated, aerodynamically tested |
| G-HON-03 | The correction mechanism is described as it is: rule enters the task input (and console if available) → provider answers change → kept examples → new adapter version. "Rule-conditioned learning" is the phrase |
| G-HON-04 | Equation I is disclosed as pre-existing on slide 2, in README, and in the first 20 seconds of the demo |
| G-HON-05 | The grid race is labelled "cinematic — mixes car and driver"; the baseline-vs-candidate race is the result |
| G-HON-06 | v1 vs v2 exam scores are shown with n (e.g. 6/8), never as percentages |

## 6. Error handling

- Server envelope and codes per ARCHITECTURE §5; every `/api/*` route catches and maps errors; nothing throws to the client as HTML.
- UI: each card has an error state naming the endpoint and a retry button; the trace stream shows failed calls in the error colour with the Mubit `code`.
- Mubit failures never crash the loop: `MUBIT_ERROR` rows stay in the ledger with `status: parse_error`, and the generator continues.
- Game iframe failing to post a result within 6 minutes → RACE card error state "No result received", ledger row stays `planned`.

## 7. Performance

| Budget | Value |
|---|---|
| `/api/evaluate` | < 20 ms (profile cached per track/aero key) |
| `/api/plan` end to end | < 3 s p95 (Haiku through Mubit ≈ 0.8–1.5 s) |
| Lab page first render | < 2 s on the demo laptop, game iframe loads lazily on "Race it" |
| 3D wing rebuild | < 200 ms |
| Collection run of 50 | < 4 min at concurrency 2 |

## 8. Demo-day failure drills

| If | Then |
|---|---|
| Mubit gateway down | Server `MUBIT_MOCK=1`; say so; show console screenshots + video |
| Adapter won't start in Try models | Show the screenshots from P3.T1 |
| Game iframe stalls | Evaluator numbers are already on screen; skip to the ledger |
| Laptop dies | Second laptop has the repo, `data/`, the video and the deck |
