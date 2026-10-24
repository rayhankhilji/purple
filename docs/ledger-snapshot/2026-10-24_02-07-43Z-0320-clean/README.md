# PURPLE ledger snapshot 2026-10-24_02-07-43Z-0320-clean

Taken 2026-10-24T02:07:43.509Z from `data/` at commit `eb16a20`. Copies only; the live files stay in `data/` (gitignored).
Frozen task key: `lab/prompt.js` sha256 `6c5be1a3f4ed0f5fb21226363fa3524404996558628bc8cba119677dfc37ce6a`.
Evaluator label: reduced-order lap model · calibrated to 2026 pole laps · aero map v1.

## Files

| File | Bytes | sha256 |
|---|---|---|
| `ledger.jsonl` | 215144 | `60bc81d8ea9c0bb4…` |
| `calls.jsonl` | 40223 | `3abc84caf3140630…` |
| `rules.json` | 233 | `1eac65852148a584…` |
| `status.json` | 249 | `03e0fdd61e9b8e6d…` |
| `exam.json` | 25013 | `c0ccb551a3520912…` |
| `state.json` | 298 | `534131973ad8f618…` |

## Counts

- Ledger: 93 rows (append-only; later rows with the same id supersede) → **91 experiments**.
- By status: overruled 1, parse_error 8, planned 82.
- Raced (measured block): 1, with agreement_pct: 1; overruled: 1; parse errors: 8.
- Session ids: 91 unique of 91 (G-MUBIT-03); rows with an `mreq_` id: 91.
- Mubit calls: 120 (99 trained, 21 untrained). By kind: exam 20 (0 trained), plan 99 (99 trained), smoke 1 (0 trained).
- Rules: 1 (1 active). Exam items: 20.
- Console (status.json): task "Research engineer of F1", kept examples 43, adapter —, test result training v1, exam {"provider":20,"total":20,"provider_param":10}, last console read —.

Every number in the lab, the deck and this snapshot comes from the reduced-order lap model named above (its label travels with every value) and from the measured game races.
