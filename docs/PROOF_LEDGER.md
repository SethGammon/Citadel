# Citadel Proof Ledger Fixture

This ledger is generated from strict proof records and offline-verified ExecutionReceipt envelopes.

## Denominators

- All records: 4
- Verified receipts: 4
- Fixture: 4
- Maintainer: 0
- Independent: 0

## Outcomes

| Record | Classification | Receipt trust | Outcome |
|---|---|---|---|
| Fixture blocked operation | fixture | verified | blocked |
| Fixture failed operation | fixture | verified | failed |
| Fixture passed operation | fixture | verified | passed |
| Fixture unknown operation | fixture | verified | unknown |

## Outcome denominators

- passed: 1/4 (0.25)
- failed: 1/4 (0.25)
- blocked: 1/4 (0.25)
- unknown: 1/4 (0.25)

## Interpretation limits

- Fixture, maintainer, and independent evidence are separate origin-bound classifications.
- Unknown includes missing, altered, unsafe, or untrusted receipts and is never counted as passed.
- A verified receipt proves integrity against a declared offline trust root, not product usefulness by itself.
- Independent records require a trust-root file pinned outside the proof bundle. Bundle-controlled keys cannot declare independent trust.
