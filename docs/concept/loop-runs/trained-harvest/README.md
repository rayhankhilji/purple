# Harvest of physics-approved designer decisions (2026-10-24, 17:00–18:15Z)

Engine CLI `--record-good --screen direct --mix 2`, 40-decision runs from fresh cars, seeds 201–206 and 401+, up to 10 runs at once
(owner raised Mubit concurrency to 10). Every designer call was UNTRAINED (`x-middleware-record: metadata`); a decision whose
proposal, exactly as proposed, was legal and faster on the physics lap sim was sent again as a TRAINED call (same request; the
model answers at temperature 0). Only these re-sent calls are Mubit examples.

- `calls.jsonl`: the trained re-sends (one row each; `same_answer: false` marks the few whose answer differed from the approved one).
- `good.jsonl`: decision, seed, lap delta as proposed (s), the untrained and the trained `mubit_request_id`.
- Totals: 8,933 Claude decisions, 751 physics-approved (8.4 %), 13 re-sends answered differently.
The full per-run logs (342 MB) stayed in the integrator's scratchpad.
