# Harvest of the action designer task (2026-10-25 03:02Z – 05:00Z)

Task `action-1` (concept/designer/prompt-action.js: one action code per answer, A01–A72, max 16 tokens), record-good exact, direct screen, mix 2, 40-decision runs from fresh cars, 16 runs at once, seeds 7001–10822 (2,445 runs). Stopped at its 05:00Z end time.

- Totals: 48,878 Claude decisions, 16,981 physics-approved and sent to Mubit as trained calls, 0 re-sends answered differently, 0 call errors.
- Every answer was served by the provider (Claude Haiku 4.5): no Mubit adapter answered any call.
- Built so a small model can match the provider exactly: a short code, not free text, is what Mubit's own test compares.
- `calls.jsonl`: the trained re-sends; `good.jsonl`: seed, decision, lap delta as proposed, request ids.
