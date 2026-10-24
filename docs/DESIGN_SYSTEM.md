# PURPLE — Design System

Version 1.0 · 2026-10-23 · For the lab page only (`lab/`). The game keeps its own look.

## 1. Direction

**A pit-wall timing screen, not a dashboard.** Black background, dense mono numbers, one accent: the purple of a fastest sector. The 3D car is the only thing with colour depth. Motion is informational (numbers settle, traces arrive) never decorative. If it would look at home on an F1 timing wall at 2 a.m., it is right; if it looks like a SaaS admin panel, it is wrong.

Three visual ideas carry the whole demo:
1. **The stage rail** — DESIGN · EVALUATE · RACE · LEARN as four cards in a row; the active one is lit, the others dim. The loop is the layout.
2. **The trace stream** — every Mubit call arrives as a line in a monospace log with its request ID and latency. Judges see the integration breathe.
3. **Purple deltas** — a faster sector is purple, slower is grey-red, unchanged is grey. The whole product is about chasing purple.

## 2. Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0a0c` | page |
| `--panel` | `#121216` | cards |
| `--line` | `#26262c` | borders, table rules |
| `--text` | `#e8e8ec` | primary |
| `--muted` | `#8a8a94` | labels, secondary |
| `--purple` | `#b26cff` | fastest / promoted / active stage |
| `--purple-dim` | `#3a2460` | active card background tint |
| `--green` | `#4ade80` | personal best, legal |
| `--amber` | `#fbbf24` | retest, pending, TD active |
| `--red` | `#f0506e` | slower, reject, error, illegal |
| `--mubit` | `#ff4500` | Mubit widget accent (their brand orange) |

Single theme (dark). No light mode.

## 3. Typography

| Role | Font | Size / weight |
|---|---|---|
| Numbers, traces, ledger | `"JetBrains Mono", ui-monospace, Menlo` | 13 px / 500; big deltas 28 px / 600 |
| Labels, headings | `"Inter", system-ui` | 11 px uppercase tracking 0.08em for labels; 16 px / 600 headings |
| Stage names | Inter | 13 px / 700 uppercase |

Times always `80.812` (3 dp) and deltas always signed with a leading sign: `−0.214` / `+0.188`. Speeds integer km/h.

## 4. Spacing and shape

4-px grid. Card padding 16. Gap between cards 12. Radius 6 everywhere (nothing pill-shaped). Borders 1 px `--line`; active card border `--purple`. No shadows.

Layout at 1440×900 (the demo laptop): left 64 % = stage rail (top, 180 px tall) over the main area (3D car view by default; game iframe when racing); right 36 % = Mubit widget (top, 140 px), trace stream (middle, flexible), ledger (bottom, 220 px). Below 1200 px wide the right column stacks under.

## 5. Motion

| Pattern | Spec |
|---|---|
| Number settle | new value fades from `--muted` to `--text` over 240 ms, `cubic-bezier(.2,.8,.2,1)`; no counting animation |
| Trace arrival | line slides in from 8 px below, 160 ms, same easing; pending line has a 1 Hz dot pulse |
| Stage activation | border and tint change over 200 ms; a 2 px progress bar under the card during loading |
| Delta reveal | sector cells flash `--purple-dim` for 400 ms when a purple sector lands |
| Wing rebuild | mesh swaps instantly; camera does a 600 ms ease to a three-quarter rear view on candidate select |
| Reduced motion | `prefers-reduced-motion`: all durations 0, pulse replaced by a static "…" |

## 6. Components

- **StageCard** `{ name, state: empty|loading|error|success, body }` — empty shows one sentence and the action button; error shows `code · endpoint` and Retry.
- **DeltaCell** `{ value, unit }` — signed, coloured by sign; threshold ±0.03 s shows grey.
- **TraceLine** `{ kind, session, requestId, latencyMs, verdict|error, trained }` — `mreq_…` truncated to 10 chars with copy on click; untrained calls shown in `--muted` italic.
- **MubitWidget** `{ taskName, keptExamples, adapterVersion, testResult, exam }` — orange accent, "updated from console HH:MM" line; edit icon opens the status form.
- **LedgerTable** columns: `#`, change, predicted Δ, measured Δ, agreement, verdict, rule, status. Newest first; overruled rows show the rule ID chip.
- **SetupSliders** five rows, label · current · baseline ghost tick · legal range shaded; illegal values turn the row red with the `REG-*` code.
- **ConditionsBar** wind dial (0–12 m/s, from-direction), wet toggle, TD-01 toggle.

## 7. Accessibility

Contrast ≥ 4.5:1 for all text on `--panel` (verified: `--muted` on `--panel` = 4.9:1). Colour never alone: deltas carry a sign, verdicts carry text, legality carries a code. All buttons keyboard-reachable; the Overrule form is a native `<form>` with labels. Live regions: the trace stream has `aria-live="polite"`.

## 8. Checklist before the video

- Every number has its source label (G-HON-01).
- No placeholder text, no "lorem", no console warnings in DevTools.
- The 3D view opens on the three-quarter rear hero angle with the rear wing in frame.
- Trace stream shows real `mreq_` IDs.
- Widget shows task name, examples, v1/v2, exam n/8.
