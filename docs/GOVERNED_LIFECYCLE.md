# Governed Citadel Lifecycle

Citadel is an execution harness, not the owner of your product intent, evidence
requirements, repository, or runtime. The governed lifecycle makes that
boundary executable:

```text
choose operating policy
-> plan the exact footprint
-> apply and verify
-> execute beneath the authority ceiling
-> issue subject-bound proof
-> update, roll back, or leave from the active receipt
```

## What is authoritative

Citadel keeps four kinds of truth separate:

| Question | Authority |
|---|---|
| What may run here? | resolved operating policy |
| What actually happened? | immutable evidence observations |
| May this work advance or merge? | deterministic control decision |
| What does Citadel own in this project? | active adoption receipt |

Markdown summaries, dashboards, branch names, clean merges, and successful
transport calls are projections. They cannot manufacture passed evidence.

Only current, subject-bound, complete `passed` evidence may authorize advance,
terminal success, delivery, or merge. Timeout, malformed output, missing proof,
stale proof, unavailable trust, and absent votes remain `unknown`.

## Operating profiles and product bundles

Profiles decide how Citadel proceeds after an observation:

- `strict-supervised@1.0.0` holds at evidence, architecture, and integration
  boundaries.
- `standard@1.0.0` retries bounded unknown results and continues only verified
  dependency-independent work.
- `experimental@1.0.0` permits more reversible independent execution inside an
  explicit budget. It still cannot convert unknown or partial proof into
  success.

Product bundles decide which surfaces are active:

```text
core
`-- persistence
    |-- parallel
    `-- operations
        `-- delivery
```

Core is always active. New Express adoption selects Standard plus Core and
Persistence. Existing unversioned installations resolve as
`legacy@1.0.0` with their current footprint until the owner approves an explicit
migration plan.

Use the config command to inspect before changing anything:

The relative delegate commands below require an initialized project and must be run from that project's root. Before first initialization, generated recovery hints use the active Citadel installation instead and bind the target with `--project-root`.

```bash
node .citadel/scripts/citadel-config.js show --project-root .
node .citadel/scripts/citadel-config.js migrate --project-root .
node .citadel/scripts/citadel-config.js enable parallel --project-root .
node .citadel/scripts/citadel-config.js enable parallel --project-root . --apply
```

Disabled or unsupported bundles do not execute. A degraded bundle names the
adapter and missing host support; it is never silently described as full.

## Plan-first adoption and exact exit

The adoption CLI treats every mutation as a checked transaction:

```bash
node scripts/adopt.js plan path/to/Citadel --target . --out ../citadel-adoption.plan.json --json
node scripts/adopt.js apply ../citadel-adoption.plan.json --confirm <plan-token> --json
node scripts/adopt.js doctor --target . --json
node scripts/adopt.js update plan path/to/Citadel-v2 --migration migration.json --target . --out ../citadel-update.plan.json --json
node scripts/adopt.js rollback plan --target . --out ../citadel-rollback.plan.json --json
node scripts/adopt.js leave plan --target . --out ../citadel-leave.plan.json --json
node scripts/adopt.js leave apply ../citadel-leave.plan.json --confirm <plan-token> --json
```

A plan records source and target identity, proposed effects, pre-images,
footprint ownership, verification, rollback, and a canonical digest. Planning
does not write target state. Save the plan outside the target repository;
creating it inside the target changes the preflight snapshot and causes apply
to reject `TARGET_DRIFT`. Apply rejects source, plan, or target drift and records
a write-ahead journal plus observed receipt.

Leave removes only unchanged receipt-owned artifacts and Citadel-owned members
of shared files. Modified, user-owned, or ambiguous material is retained with
an explicit conflict. Portable history is archived under a new versioned name;
an older archive is never overwritten.

Legacy installations without a receipt cannot claim exact removal. Start with
`adopt import plan`, review every owned/shared/ambiguous classification, apply
the inventory, and only then create a leave plan. The one-major
`unharness --legacy-apply` fallback is deliberately labeled inexact.

## External control planes

The alpha Governance Port lets an external system own:

- immutable operation intent;
- scope and permitted actions;
- signed authority;
- required proof policy; and
- acceptance of the final proof.

Citadel owns execution attempts, persistence, recovery, handoffs, events, and
receipts behind that port. External adapters depend on the public contract, not
Operation Graph, Forks, Packs, Mission Control, runtime handles, or `core/*`.

The alpha surface provides handshake, operation submission/read, typed intent
submission, event replay, and proof retrieval. Every mutation independently
requires valid pinned authority, an idempotency key, and the expected revision.
Events are ordered, replayable, and at-least-once. The signed terminal bundle
cross-links the operation, proof policy, authority, intents, attempts, evidence,
handoffs, and receipt.

This boundary is `0.1`, not stable `1.0`. The dependency-free
`packages/contracts` package can be packed and installed without Citadel's
`core/` tree, but no registry publication or independently owned repository is
claimed yet. It remains alpha until an independently owned repository passes
behavioral conformance using a digest-pinned package artifact.
Run the local behavioral contract with:

```bash
node scripts/control-plane-conformance.js
node scripts/control-plane-stdio.js --help
```

## Product proof

Engineering fixtures, human utility, retention, and replaceability are separate
evidence layers:

1. readiness inspection verifies the local product machinery;
2. fixture automation rehearses exact workflows;
3. a controlled trial compares bare and Citadel runs on externally selected
   tasks;
4. D7/D30 retention requires another meaningful verified task in a fixed
   window; and
5. the exit trial proves receipt-owned removal and restore.

The v2 trial instrument is local-first. It records bounded statuses, counts, and
durations, not prompts, paths, repository names, commands/output, source, diffs,
identities, credentials, or secrets. Public exports are aggregate-only and
suppress cells smaller than five. Sharing is manual; purge is explicit.

Fixture success does not establish a user-utility claim. A pilot validates the
instrument but is excluded from confirmatory rates. Missing, abandoned,
rejected, and timed-out randomized attempts remain in intention-to-treat
denominators.

## Local real-use proof

Run the complete local user journey with:

```bash
npm run test:governed-lifecycle
```

The command creates isolated Git projects, uses the public `citadel` CLI, packs
and installs `@citadel/contracts` into an external scratch package, restarts the
NDJSON control plane, and exercises the proof instrument. It writes a
privacy-bounded result to
`.planning/verification/governed-lifecycle.json`. The record stores command and
output digests, not prompts, repository paths, file contents, or personal
identifiers.

Five scenarios must pass: governance/Fleet merge authority, progressive
activation, adoption/update/rollback/leave/restore, public package plus control
plane, and Real User Proof v2 suppression/purge. The record also keeps the
non-local boundary explicit: it does not prove registry publication,
independently owned repository conformance, a human pilot, a 36-user cohort,
D7/D30 retention, comparative utility, or a stable `1.0` adapter.

## Version compatibility

The lifecycle adds independent version axes. It does not silently redefine the
Operations Protocol `0.1`, App Contract `1`, or Supervisor API `1`.

Unknown future config or contract versions block mutation. Existing records are
retained with migration provenance; Citadel never rewrites old proof history in
place.

## Claim boundary

The implementation and local use-case fixtures can prove:

- fail-honest contract behavior;
- plan/receipt/journal recovery;
- effective bundle enforcement;
- control-plane authority and proof linkage;
- privacy and scoring contract behavior; and
- exact local exit.

They cannot prove a population-level utility improvement or independently owned
adapter compatibility. Those claims require the preregistered human cohort and
an external repository, respectively.
