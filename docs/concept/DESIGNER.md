# PURPLE · CONCEPT DESIGNER (LLM proposer, second Mubit task)

Version 0-draft · 2026-10-24 · branch `claude/concept-designer` · owner Tanuj (approved an LLM steering the shape) · status:
**built and tested with a mock LLM only; no Mubit or Anthropic call has been made; the prompt is a DRAFT and is not frozen.**
Label on every number: **"concept · reduced-order lap model · calibrated to 2026 pole laps · concept aero map v0"**.

## 1. What it is

The concept optimiser (`concept/optimize.js`, `docs/concept/CONCEPT.md`) asks a *proposer* for the next shape change, measures
it on the bench and keeps it only if the car is legal and the Silverstone weekend score improves. The default proposer is a seeded
evolution strategy. The designer is a second proposer: **an LLM proposes the next 1–3 part changes, the deterministic simulator
scores them, and the optimiser's number comparison decides kept / rejected.** Routed through Mubit as its own task, every decision
is recorded, so later adapter versions can propose better changes from the same kind of context.

```
lineage + current best ─▶ scenario.js (≤ 350 tokens) ─▶ llm(scenario, { sessionId, trained }) ─▶ schema.js (strict)
     ▲                                                                                             │
     │                         refused (duplicate / illegal / parse / llm error) ─▶ fallback (seeded mutate)
     │                                                                                             ▼
 lineage row ◀── kept iff legal && score_after > score_before ◀── bench (regs + PhysicalCar + sim) ◀── one proposal
 (proposer: llm | fallback, designer note: session id, expected vs measured, refusal reason)
```

The verdict is never the model's: the output schema has no verdict field (an extra `verdict` or `kept` key is a parse error),
and `kept` is computed in `concept/optimize.js` from simulator numbers.

## 2. Why a separate Mubit task

Mubit keys a task on system prompt + tools + output format + model. The research agent's task (`lab/prompt.js`, PROMPT_VERSION 1,
99 trained examples, sha-pinned by `test/prompt-frozen.test.js` and the server's startup check) must not change (G-MUBIT-01).
The designer has a different job (propose shape changes, not judge a setup experiment), a different input and a different
output, so it needs its own system prompt, which is automatically a **different task key**: its calls never add to, dilute or
retrain the research agent's examples, and the research agent's adapters are unaffected. Nothing in this module touches
`lab/prompt.js` or `server/mubit.js`.

## 3. Task design (same discipline as ARCHITECTURE §4.5–4.6 and §7)

### 3.1 System prompt (DRAFT, `concept/designer/prompt.js`, 856 chars, no tools, no response_format)

```text
You are the concept designer of a 2026-style F1 car. Goal: beat the real 2026 Silverstone pole lap by the largest margin while the car stays legal under the FIA 2026 technical regulations.
You receive one scenario as JSON: the current best car (parameters by part), its lap and gap to pole (negative is ahead), recent tested changes (lap delta in s, negative is faster; kept or not; violated articles), refused proposals, and parameters near a limit. Propose the next change: 1 to 3 parameters of the current best car. A simulator measures it and keeps it only if the lap improves and the car is legal; you do not decide. Never repeat a tested change.
Return ONLY a JSON object with exactly these keys: changes (array of 1-3 {part, param, to}), hypothesis (string, max 160 chars), expected ({lap_delta_s: -1|0|1, sector: 1|2|3}). No prose outside the JSON.
```
`MODEL = "claude-haiku-4-5"`, `MAX_TOKENS = 250`, `TEMPERATURE = 0`, `DRAFT = true`, `DESIGNER_PROMPT_VERSION = "0-draft"`.
`taskKeySha256()` hashes the canonical task key and `fileSha256()` the file, ready for a freeze test like
`test/prompt-frozen.test.js`. **Do not freeze it until Tanuj and the integrator have reviewed the text.** Everything variable
(parameter list, limits, history) is in the scenario, so the prompt does not need to change when the catalogue does, except the
parameter names the model echoes back, which come from the scenario's `best.params`.

### 3.2 Scenario (user message, `concept/designer/scenario.js`)

Built from the current best design, its bench summary, the last 3 lineage rows, the designer's last refused proposal and the
parameters whose legal headroom (domain ∩ FIA 2026 limits from `concept/regs.js`, plus the packaging minimum wheelbase) is ≤ 10 %
of the domain, regulation limits first. Example (mock run, seed 1, generation 15: 1,205 chars ≈ 302 tokens):

```json
{"best":{"lap_s":87.573,"gap_s":-0.538,"kg":770,"front":0.45,"params":{"layout":{"wheelbase_mm":3400},"survival_cell":{"front_axle_offset_mm":75,"cockpit_len_mm":1930,"bulkhead_gap_mm":380},"front_wing":{"span_mm":1280,"chord_mm":650,"aoa_deg":29,"elements":2,"sm_delta_deg":20},"rear_wing":{"span_mm":1100,"chord_mm":405,"aoa_deg":20,"elements":2,"endplate_top_mm":880,"sm_delta_deg":0},"floor":{"width_mm":1900,"throat_mm":90,"ride_height_mm":35},"diffuser":{"expansion_deg":17},"sidepods":{"inlet_cm2":570,"undercut_mm":130},"ballast":{"x_frac":0.05,"extra_kg":0}}},
 "tested":[{"change":"diffuser.expansion_deg 14->17","d_lap_s":-0.048,"kept":true},{"change":"front_wing.aoa_deg 29->22.5","d_lap_s":0.049,"kept":false},{"change":"floor.throat_mm 90->92; diffuser.expansion_deg 17->20; floor.width_mm 1900->1860","d_lap_s":0.099,"kept":false}],
 "refused":[{"change":"layout.wheelbase_mm 3400->3500","why":"illegal C2.3.3"}],
 "near":["floor.width_mm 1900 (max 1900 C2.3.1)","layout.wheelbase_mm 3400 (max 3400 C2.3.3)","rear_wing.endplate_top_mm 880 (max 880 C3.11.2(a))","survival_cell.bulkhead_gap_mm 380 (min 360 C2.3.6)","ballast.extra_kg 0 (min 0 domain)","front_wing.sm_delta_deg 20 (max 20 domain)"]}
```
(line breaks added here; the real message is one line.)

Size (the project's chars/4 estimate, as `lab/schema.js` `approxTokens`): baseline 212 tokens; the largest in the mock runs 326;
a constructed worst case (three illegal 3-change rows naming every article, a 3-change refused entry, six near-limit lines) is
433 tokens untrimmed and **328 after `fit()`**, which drops the oldest tested rows first and never the current car. Articles are
capped at 3 per entry. The real token count is only known from the first untrained call (`input_tokens`, which also includes the
≈ 200-token system prompt); JSON digits and underscores may tokenise denser than 4 chars per token, so read it on the dry run and
lower `LIMITS.chars` if needed.

### 3.3 Output (`concept/designer/schema.js`)

`{ changes: [{ part, param, to }] (1–3, distinct, existing parameters, finite numbers), hypothesis (≤ 160 chars), expected: { lap_delta_s: -1|0|1, sector: 1|2|3 } }`.
Strict: prose before or after, a second fence, unknown or extra keys (including any verdict), unknown parameters, a repeated
parameter, 0 or 4 changes, non-numeric values → rejected with the field named. Tolerances, each recorded on the lineage row: one
` ```json ` fence is stripped (Haiku adds one, HANDOVER §5); out-of-domain values are clamped to the model domain and quantised
(`clamped: true` on the change); an overlong hypothesis is trimmed (as `lab/schema.js` decided on 2026-10-23); a numeric
`lap_delta_s` is reduced to its sign. Legality is not the schema's job; the proposer checks it on the applied design.

### 3.4 Loop guards (`concept/designer/proposer.js`)

| Guard | Behaviour |
|---|---|
| Duplicate | Every parent and every handed-over design is remembered by its canonical parameter string. A proposal that lands on one (including a no-op on the parent) is refused as `duplicate`. Tests replay whole lineages and prove no design is measured twice. |
| Illegal | The applied design is checked with `concept/regs.js` before the bench; refused with its articles, which the next scenario shows (`refused`). |
| Parse / provider error | `parse` (schema error text kept) or `llm_error` (message kept). |
| Fallback | On any refusal, one seeded `design.mutate` step from the optimiser's rng, drawn until it is untested and legal (8 draws, then up to 40 for untested). Deterministic for a seed. |
| Failure cap | 3 consecutive failures pause the LLM for 5 generations (`llm_paused`), then it is tried again. |
| Budget | `maxCalls` caps LLM calls per run (`llm_budget` after). |
| Training | `trained: true` throws while `DRAFT` is true. One session id per decision (`dsg-<runId>-g<gen>`). |

Every row gets `proposer: "llm" | "fallback"` and a `designer` note: `{ proposer, reason, session_id, scenario_tokens, trained,
expected, measured: { lap_delta_sign, sector }, expected_hit: { sign, sector }, refused?, clamped?, design_hash }`.

## 4. Files and how to run

| File | What |
|---|---|
| `concept/designer/prompt.js` | DRAFT system prompt, task constants, sha256 helpers |
| `concept/designer/scenario.js` | `build`, `fit` (≤ 1,400 chars), `nearLimits`, `ranges`, `testedRow` |
| `concept/designer/schema.js` | `validate(text)` strict output check |
| `concept/designer/proposer.js` | `llmProposer({ llm, trained, maxCalls, ... })`, `runDesigner(opts)` (optimizeAsync, one proposal per generation, annotates rows) |
| `concept/designer/cli.js` | `node concept/designer/cli.js --mock --gens 30 --seed 1 --out DIR`; seeded mock LLM (`mockLlm`) that also returns prose, broken JSON, duplicates, illegal, out-of-domain and unknown parameters |
| `test/concept-designer.test.js` | 15 tests (§8) |

The CLI writes `lineage.jsonl`, `calls.jsonl` and `best.json` to `--out` and refuses `data/` and `data-mock/`. Without `--mock` it
exits with an error: there is no live path yet. Mock runs, 30 generations (≈ 0.5 s each): seed 1 −0.821 s (18 kept: 16 llm, 2
fallback), seed 2 −1.145 s, seed 3 −0.833 s, seed 4 −1.013 s vs the baseline 88.111 s. These numbers measure the mock's
scripted taste, not an LLM.

## 5. The server/mubit.js change needed (not made here)

`callMubitNow` hard-codes `prompt.SYSTEM_PROMPT / MODEL / MAX_TOKENS / TEMPERATURE` from `lab/prompt.js`, and G-MUBIT-06 says
Mubit is called only from `server/mubit.js`. Minimal change: an optional `task` argument. Without it the request is byte-identical
(checked on a local loopback server against a copy of the file: same body and headers for the research call; the designer call
carried the designer prompt, `max_tokens` 250, `x-middleware-record: metadata` and `metadata.user_id`; a trained call with the
DRAFT prompt threw `draft_prompt` before any request).

```diff
--- a/server/mubit.js
+++ b/server/mubit.js
@@ -1,6 +1,8 @@
 // PURPLE - the ONE place that calls Mubit (EVAL_GUARDRAILS G-MUBIT-06). ARCHITECTURE §7.1.
 // Anthropic SDK pointed at Mubit's Anthropic path. The task key (system prompt, model, max_tokens, no tools) comes from
 // lab/prompt.js and is frozen. Calls that must not train carry x-middleware-record: metadata. Never log the key or full prompts.
+// A second, separate task (the concept designer, concept/designer/prompt.js) passes `task`; without `task` every call is
+// byte-identical to before (the research agent's frozen task). A DRAFT task can never make a trained call.
 const Anthropic = require("@anthropic-ai/sdk");
 const prompt = require("../lab/prompt.js");
 const DEFAULT_BASE_URL = "https://api.mubit.ai/anthropic";
@@ -34,12 +36,15 @@
     retryAfter: headerOf(e && e.headers, "retry-after"),
   });
 }
-// { userContent, sessionId, trained, kind } -> { text, kind, session_id, mubit_request_id, model, input_tokens, output_tokens, latency_ms, trained, stop_reason }
+// { userContent, sessionId, trained, kind, task? } -> { text, kind, session_id, mubit_request_id, model, input_tokens, output_tokens, latency_ms, trained, stop_reason }
+// task = { SYSTEM_PROMPT, MODEL, MAX_TOKENS, TEMPERATURE, DRAFT? } (default: lab/prompt.js)
 async function callMubit(args) { return withSlot(() => callMubitNow(args)); }
-async function callMubitNow({ userContent, sessionId, trained, kind }) {
+async function callMubitNow({ userContent, sessionId, trained, kind, task }) {
+  const t = task || prompt;
+  if (trained && t.DRAFT) throw new MubitError("trained call refused: the task prompt is a DRAFT", { code: "draft_prompt", status: 0 });
   const params = {
-    model: prompt.MODEL, max_tokens: prompt.MAX_TOKENS, temperature: prompt.TEMPERATURE,
-    system: prompt.SYSTEM_PROMPT,
+    model: t.MODEL, max_tokens: t.MAX_TOKENS, temperature: t.TEMPERATURE,
+    system: t.SYSTEM_PROMPT,
     messages: [{ role: "user", content: userContent }],
     metadata: { user_id: sessionId },
   };
@@ -60,7 +65,7 @@
   const mubit_request_id = headerOf(response && response.headers, "x-middleware-request-id") || data._request_id || null;
   const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
   return {
-    text, kind, session_id: sessionId, mubit_request_id, model: data.model || prompt.MODEL,
+    text, kind, session_id: sessionId, mubit_request_id, model: data.model || t.MODEL,
     input_tokens: data.usage && data.usage.input_tokens, output_tokens: data.usage && data.usage.output_tokens,
     latency_ms, trained: !!trained, stop_reason: data.stop_reason,
   };
```

Then the live `llm` is a server-side one-liner (Node only, never from the browser; the shared concurrency slots of 2 still apply):

```js
const { callMubit } = require("../mubit.js"), task = require("../../concept/designer/prompt.js");
const llm = (scenario, { sessionId, trained }) => callMubit({ userContent: scenario, sessionId, trained, kind: "design", task });
// proposer.js accepts the returned object and records its mubit_request_id; use a ulid for runId in real runs
```
Write its call log to the run's `--out` directory or a separate `calls` file with `kind: "design"`, not the research agent's
`data/calls.jsonl`, unless the integrator decides otherwise.

## 6. Trained / untrained plan and budget

1. **Untrained dry runs first** (every call carries `x-middleware-record: metadata`, the default): 2 runs × 15 generations = 30
   calls. Read real `input_tokens` / `output_tokens`, the parse-error rate and the fence behaviour; adjust the DRAFT prompt and
   `LIMITS.chars` (still free: nothing trained yet).
2. **Freeze**: Tanuj and the integrator review the text, set `DRAFT = false` and `DESIGNER_PROMPT_VERSION = "1"`, pin
   `fileSha256()` in a new freeze test (the `test/prompt-frozen.test.js` pattern) and log the decision in TASK_LOG. After the
   first trained call the prompt, model, max_tokens and output format never change (G-MUBIT-01 for this task).
3. **Trained collection** only after the freeze: ≤ 60 trained calls (e.g. 2 seeds × 30 generations), ≈ 550 input + ≤ 250
   output tokens each (≈ 50k tokens). This shares the starter credit, the per-org Try-models cap and the **3 adapter starts per UTC
   day** with the research agent (EVAL_GUARDRAILS §4); the research agent's exam and demo calls come first. Budget decision: Tanuj.
4. What the adapter can learn: each recorded example pairs a context that already contains measured outcomes (Δ lap, kept,
   violated articles, refused proposals) with the next proposal. Mubit decides which recorded calls it keeps; this module does not
   send the simulator's verdict to Mubit as a label, and nothing here claims it does.

## 7. Risks

- **Loops.** A model at temperature 0 sees similar scenarios and repeats itself. Mitigated by the duplicate guard, the refused
  entry in the scenario, the failure cap and the seeded fallback; tested by replaying lineages.
- **Reward hacking against the simulator's approximations.** The score is a reduced-order lap model with guessed coefficients
  (CONCEPT.md §2, §5): straight-mode gains are optimistic, mass is under-charged (≈ 0.013 s/kg), the floor stall onset and the
  cooling derate are smooth guesses. An LLM will find the same cheap gains the ES finds (and say so convincingly in its hypothesis).
  The hypothesis is text, the bench is the measurement, and every number carries the label; present results as "better under this
  model", never as a real car's performance.
- **Parameters pinned at bounds.** Several best values sit on model-domain edges (straight-mode flaps, rear chord, throat) that
  are modelling choices. The scenario marks domain edges as `domain`, distinct from FIA articles, so neither the model nor a
  reader mistakes one for the other.
- **Scenario size.** Estimated, not measured on the provider; check `input_tokens` on the dry run.
- **Task confusion.** A copy-paste of the research agent's prompt or model into `prompt.js` would merge nothing (different text
  is a different task), but changing `lab/prompt.js` would break the research task; nothing here imports or edits it.

## 8. How judges see it

Each lineage row shows **who proposed** (`proposer: llm | fallback`), **what changed** (`part.param from → to`, `clamped`), the
model's **hypothesis** and **expected** sign and sector next to the **measured** Δ lap and sector (`expected_hit`), and **kept**,
computed from the simulator. Refused proposals show why (duplicate, or illegal with the FIA article). The CLI summary counts kept
changes by proposer, so "the LLM's ideas that survived the bench" is a number, not a claim.

Tests (`test/concept-designer.test.js`, 15): prompt DRAFT / size / content and its separation from the research task; no provider
call outside `server/mubit.js`; scenario content, mapping and worst-case size; schema accept / reject (24 rejection cases);
duplicate, parse-pause, illegal, provider-error, DRAFT-training and budget guards; numeric verdict and clamped flags; mock
determinism and guard coverage; CLI outputs and refusals; no G-HON-02 wording.
