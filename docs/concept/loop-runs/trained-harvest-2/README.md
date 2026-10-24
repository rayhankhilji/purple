# Harvest 2 (2026-10-24, 19:50–21:30Z)

Same method as `../trained-harvest/README.md` (record_good, direct screen, mix 2, 40-decision runs from fresh cars), 20 runs at once (owner: concurrency up to 100; 100 overloaded the 4-core machine, so 20), seeds 1001+ and 2001+.

- Totals: 22352 Claude decisions, 1858 physics-approved and sent to Mubit as trained calls, 15 re-sends answered differently.
- `calls.jsonl`: the trained re-sends; `good.jsonl`: decision, seed, lap delta as proposed, request ids.
