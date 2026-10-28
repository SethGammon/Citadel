# Architecture: Governed Citadel Lifecycle

> Spec: `.planning/research/fleet-governed-citadel/REPORT.md` | Date: 2026-07-30
> Mode: feature

## Baseline

- Repository: `<repository>` (redacted path placeholder)
- Branch: local `main`, behind recorded `origin/main` by four commits at research
  start; no fetch or branch mutation was authorized.
- Worktree: dirty with pre-existing security-assurance, documentation,
  metadata, evidence, CLI, skill, and test-aggregator work. Those changes are
  preserved and treated as constraints.
- `node scripts/test-all.js`: no failure output before the 180-second baseline
  observation limit, but the aggregate run did not terminate inside that limit.
  Focused suites and a longer final aggregate run are required before completion.

## File Tree

Only planned new (`+`) and modified (`~`) files are listed.

```text
+ core/config/contract.js
+ core/config/profiles.js
+ core/config/bundle-catalog.js
+ core/config/migrate.js
+ core/config/validate.js
+ core/config/resolve.js
+ core/config/index.js
+ core/governance/contracts.js
+ core/governance/evaluator.js
+ core/governance/journal.js
+ core/governance/index.js
+ core/adoption/contracts.js
+ core/adoption/preflight.js
+ core/adoption/planner.js
+ core/adoption/footprint.js
+ core/adoption/executor.js
+ core/adoption/index.js
+ core/control-plane/contracts.js
+ core/control-plane/authority.js
+ core/control-plane/proof-policy.js
+ core/control-plane/proof-bundle.js
+ core/control-plane/events.js
+ core/control-plane/service.js
+ core/control-plane/index.js
+ core/product-proof/trial-contract.js
+ core/product-proof/assignment.js
+ core/product-proof/scoring.js
+ core/product-proof/redaction.js
+ core/product-proof/index.js
+ schemas/harness-config-v2.schema.json
+ scripts/citadel-config.js
+ scripts/adopt.js
+ scripts/control-plane-conformance.js
+ scripts/product-proof-trial.js
+ scripts/test-governance-contracts.js
+ scripts/test-governance-integration.js
+ scripts/test-config-policy.js
+ scripts/test-adoption-lifecycle.js
+ scripts/test-control-plane.js
+ scripts/test-product-proof-v2.js
+ scripts/test-governed-lifecycle-usecases.js
+ docs/GOVERNED_LIFECYCLE.md
~ core/cli/package-cli.js
~ core/evidence/contracts.js
~ core/operations/graph-effects.js
~ hooks_src/harness-health-util.js
~ hooks_src/circuit-breaker.js
~ runtimes/claude-code/generators/install-hooks.js
~ runtimes/codex/generators/install-hooks.js
~ scripts/generate-routing.js
~ scripts/route-preview.js
~ scripts/unharness.js
~ scripts/product-proof-cohort.js
~ core/telemetry/activation.js
~ core/telemetry/activation-cohort.js
~ scripts/test-all.js
~ scripts/skill-lint.js
~ skills/setup/SKILL.md
~ skills/do/SKILL.md
~ skills/archon/SKILL.md
~ skills/fleet/SKILL.md
~ skills/unharness/SKILL.md
~ docs/OPERATIONS_PROTOCOL.md
~ docs/SETUP_REFERENCE.md
~ docs/USEFULNESS_TRIAL.md
~ docs/PRODUCT_PROOF_TRIAL.md
~ docs/BENCHMARK.md
~ PRIVACY.md
~ README.md
~ package.json
```

Shared dirty files are modified only after inspecting and preserving their
existing diff. If a lower-risk adapter can avoid a shared file, prefer it.

## Component Breakdown

### Feature: Operating Policy and Product Bundles

- Files: `core/config/*`, config schema, config CLI, setup/router/hook consumers.
- Dependencies: existing runtime capabilities and `core/team/policy.js`.
- Complexity: high.
- Responsibility: parse/migrate/validate one config, resolve immutable profile
  semantics and bundle dependency closure with provenance, expose one effective
  decision to all enforcement points.

### Feature: Governance Evidence

- Files: `core/governance/*`, evidence adapter, Campaign/Fleet skill semantics.
- Dependencies: Operations Protocol identities and existing evidence contracts.
- Complexity: high.
- Responsibility: preserve evidence truth, coverage, subject generation, and
  control disposition as separate exact contracts; make pass/advance/merge
  truth-table behavior executable.

### Feature: Receipt-Owned Adoption

- Files: `core/adoption/*`, `scripts/adopt.js`, uninstall adapter.
- Dependencies: config resolver, filesystem and runtime installers.
- Complexity: high.
- Responsibility: create no-write plans, exact footprints, write-ahead
  journals, observed receipts, conflict-aware leave, and recovery.

### Feature: Governance Port Alpha

- Files: `core/control-plane/*`, conformance CLI, Operation Graph receipt
  integration.
- Dependencies: Operations Protocol, Ed25519 helpers, App Contract handoffs,
  governance evaluator.
- Complexity: high.
- Responsibility: keep external intent/authority/proof ownership separate from
  replaceable execution strategy; provide idempotency, revision checks, replay,
  and independently verifiable proof bundles.

### Feature: Real User Proof v2

- Files: `core/product-proof/*`, trial CLI, activation/benchmark/retention
  adapters.
- Dependencies: adoption receipts, canonical digests, signing helpers.
- Complexity: medium-high.
- Responsibility: exact privacy-minimal trial records, balanced assignments,
  intention-to-treat scoring, meaningful retention, redaction, small-cell
  suppression, and purge.

### Feature: Integrated Product Surface

- Files: CLI, setup/do/unharness skills, documentation, test aggregator.
- Dependencies: all prior features.
- Complexity: high.
- Responsibility: expose coherent plan-first commands and truthful guidance;
  prevent disabled surfaces or incomplete evidence from appearing successful.

## Data Model

### ResolvedConfigReceipt

- Fields: schema version, source digest, package version, immutable profile
  reference/digest, requested/effective/degraded/unavailable bundles, runtime
  contract, resolved policy values with provenance, reconciliation timestamp,
  receipt digest.
- Relationships: derives from `HarnessConfigV2`; constrains all local
  enforcement points; may be further restricted by external policy.

### EvidenceObservation

- Fields: contract version, ID, subject/digest/generation, attempt, producer and
  contract digest, truth status, coverage, reason code, artifact digests,
  timestamps, digest.
- Relationships: many observations are evaluated against one `GatePolicy`.

### ControlDecision

- Fields: contract version, ID, subject identity/generation, policy and
  observation digests, truth, coverage, disposition, reason, currency,
  timestamp, digest.
- Relationships: the only authority for advance/merge; projected into campaign,
  Fleet, dashboard, and receipt surfaces.

### AdoptionPlan and AdoptionReceipt

- Plan fields: source/target/runtime identities, preflight digests, effects,
  footprint preview, migrations, verification, rollback, digest.
- Receipt fields: plan digest, observed effects, active footprint, config
  receipt, verification, journal head, state, signature.
- Relationships: one active receipt owns later doctor/update/rollback/leave.

### ControlPlaneSubmission and ProofBundle

- Submission fields: alpha contract version, operation, proof policy, scope,
  authority-policy digest, signed grant, submission time.
- Proof bundle fields: operation, policy, accepted intents/grants, run, attempts,
  evidence, handoffs, plan digest, policy evaluation, execution receipt,
  bundle digest, signature.
- Relationships: authority, request idempotency, operation revision, and proof
  linkage are independently validated.

### Trial Protocol and Records

- Entities: protocol, assignment, stage, score, artifact, exit, retention.
- Relationships: every attempt belongs to one frozen protocol and assignment;
  aggregate scoring includes every assigned attempt; public export contains
  aggregate cells only.

## Key Decisions

### One resolver with local enforcement

- **Chosen:** pure central resolver with provenance; hooks/routers/CLIs enforce
  its output locally.
- **Rejected:** independent config interpretation in every consumer. It already
  causes key aliases and semantic drift.
- **Rejected:** external policy engine dependency in v1. Citadel needs the
  separation of decision and enforcement, not a new runtime dependency.

### Exact CommonJS contracts without new production dependencies

- **Chosen:** repository-native CommonJS, exact allowlists, canonical JSON, and
  built-in cryptography/filesystem primitives.
- **Rejected:** adding a schema/runtime framework dependency. It expands supply
  chain and packaging risk without improving the first vertical slice.

### Receipt-owned mutations

- **Chosen:** proposed effects, pre-images, write-ahead journal, observed
  effects, active receipt, conflict-aware leave.
- **Rejected:** path-list uninstall and in-place best-effort update. They cannot
  distinguish user changes or prove recovery.

### Purposeful alpha Governance Port

- **Chosen:** transport-neutral governance conversation and public proof
  verification, versioned `0.1`.
- **Rejected:** exposing Operation Graph/Fork/Pack APIs. It freezes private
  strategies and makes both sides harder to replace.
- **Rejected:** declaring 1.0 before independent adapter conformance.

### Separate product evidence layers

- **Chosen:** fixture, pilot, controlled utility, retention, and exit remain
  distinct evidence kinds and denominators.
- **Rejected:** one composite readiness score. It could turn missing human
  evidence into a favorable product claim.

### Incremental integration over broad rewrite

- **Chosen:** add contract kernels and adapters, then replace consumers with
  focused tests.
- **Rejected:** rewrite Operations Protocol, setup, campaign, Fleet, and
  installers at once. It would discard working primitives and obscure
  regressions.

## Build Phases

### Phase 0: Baseline and Ownership

- **Goal:** record current state and protect unrelated work.
- **Files:** architecture/research documents only.
- **Dependencies:** none.
- **End Conditions:**
  - [x] Current branch/status and shared dirty-file diff recorded.
  - [x] Aggregate baseline observed for 180 seconds with no failure output;
        timeout recorded as inconclusive, not passed.
  - [ ] Focused pre-existing suites touching shared files pass before integration.

### Phase 1: Contract Kernels

- **Goal:** implement exact canonical config and governance contracts.
- **Files:** `core/config/*`, `core/governance/*`, schema, focused tests.
- **Dependencies:** Phase 0.
- **End Conditions:**
  - [ ] Unknown fields/future versions fail closed.
  - [ ] Legacy config resolves without writes or semantic relabeling.
  - [ ] Profile and bundle closure/provenance are deterministic.
  - [ ] Only passed + complete + current can advance or merge.
  - [ ] Focused contract tests pass.

### Phase 2: Governed Adoption

- **Goal:** ship a usable local-path plan/apply/doctor/leave lifecycle.
- **Files:** `core/adoption/*`, `scripts/adopt.js`, uninstall/CLI adapters/tests.
- **Dependencies:** Phase 1.
- **End Conditions:**
  - [ ] `plan` is byte-for-byte non-mutating.
  - [ ] Apply rejects target/plan drift and writes a journal plus active receipt.
  - [ ] Failure injection restores or leaves explicit recoverable state.
  - [ ] Leave preserves modified/ambiguous/user-owned material.
  - [ ] Fresh, dirty, unborn, modified-footprint, and exact-exit tests pass.

### Phase 3: Progressive Activation

- **Goal:** make config resolution authoritative in setup, routing, hooks, and
  direct invocation.
- **Files:** setup/router/hooks/config CLI/skill metadata/integration tests.
- **Dependencies:** Phases 1 and 2.
- **End Conditions:**
  - [ ] New Express plan resolves Standard + Core/Persistence.
  - [ ] Disabled bundles do not route or execute.
  - [ ] On-demand activation is diff-first and persistent.
  - [ ] Unsupported/degraded runtime states are truthful.
  - [ ] Legacy installs remain unchanged until explicit migration.

### Phase 4: Governance Port Alpha

- **Goal:** implement the public governance boundary and durable local reference
  service.
- **Files:** `core/control-plane/*`, graph integration, conformance tests/CLI.
- **Dependencies:** Phases 1 and 2.
- **End Conditions:**
  - [ ] Authority, expiry, idempotency, revision, privacy, and version cases pass.
  - [ ] Accepted intents appear in run and signed proof lineage.
  - [ ] Outbox restart, replay, duplicate delivery, and gap cases pass.
  - [ ] Missing proof is unknown; tamper verification fails.
  - [ ] External fixture imports public boundary only.

### Phase 5: Real User Proof v2

- **Goal:** implement the honest utility/retention/exit measurement instrument.
- **Files:** `core/product-proof/*`, trial CLI, telemetry/benchmark adapters/tests.
- **Dependencies:** Phases 1 and 2.
- **End Conditions:**
  - [ ] Assignment schedule is balanced and commitment detects mutation.
  - [ ] All assigned failures remain in intention-to-treat reporting.
  - [ ] False pass blocks readiness; unknown remains unknown.
  - [ ] D7/D30 require meaningful verified work in exact windows.
  - [ ] Public cells under five are suppressed; prohibited fields are rejected.
  - [ ] Detailed local data can be explicitly purged.

### Phase 6: Product Integration and Consistency

- **Goal:** expose the lifecycle coherently and remove live semantic
  contradictions.
- **Files:** CLI, skills, docs, aggregators, shared consumers.
- **Dependencies:** Phases 2, 3, 4, and 5.
- **End Conditions:**
  - [ ] CLI/package/help/docs expose plan-first commands and bounded claims.
  - [ ] Archon/Fleet/Quick Fleet use identical fail-honest semantics.
  - [ ] Semantic lint rejects timeout/missing/partial-to-pass language.
  - [ ] Existing focused suites and every new suite pass.
  - [ ] `node scripts/test-all.js` terminates and passes with a sufficient limit.
  - [ ] `git diff --check` passes.

### Phase 7: Real-Use Proof Preparation

- **Goal:** freeze executable use-case fixtures for the next verification goal.
- **Files:** `scripts/test-governed-lifecycle-usecases.js`, proof fixtures/docs.
- **Dependencies:** Phase 6.
- **End Conditions:**
  - [ ] Each research opportunity has a repeatable real-user-style scenario.
  - [ ] Every scenario emits durable machine-readable proof.
  - [ ] External-human and independent-repository evidence remains explicitly
        unclaimed.

## Phase Dependency Graph

```text
Phase 0 -> Phase 1 -> Phase 2 -> Phase 3
                  \-> Phase 4
                   \-> Phase 5
Phase 3 + Phase 4 + Phase 5 -> Phase 6 -> Phase 7
```

Phases 3, 4, and 5 are parallel-safe after the shared Phase 1/2 contracts, with
exclusive file ownership and integration deferred to Phase 6.

## Risk Register

1. **Regression in existing functionality:** establish focused baselines,
   additive modules, explicit adapters, and full final suite.
2. **Collision with unrelated dirty work:** inspect every shared diff, preserve
   existing hunks, and prefer new files until integration.
3. **False completion from breadth:** each phase has executable end conditions;
   independent/human evidence is a separate later gate.
4. **Semantic drift across prose/code:** executable evaluator is authoritative
   and repository-wide semantic lint checks distributed skills/docs.
5. **Unsafe filesystem lifecycle:** plan-only default, explicit target identity,
   pre-images, locks, journals, receipts, and conflict-aware leave.
6. **Contract lock-in:** independent version axes and alpha control-plane label
   until an external repository passes.
7. **Privacy leakage:** exact schemas, prohibited-key scanners, opaque IDs,
   local detail, aggregate-only export, and purge.
8. **Long aggregate test runtime:** run focused suites continuously and give the
   final aggregator a measured sufficient timeout rather than treating a
   timeout as pass or failure.

## Deployment Strategy

No hosted deployment is part of this goal. Delivery is a versioned local
package/repository change. Pre-release checks are focused suites, full aggregate
tests, package/release integrity, external-fixture package-boundary proof, and
the later real-use verification goal.

---HANDOFF---
- Architecture: Governed Citadel Lifecycle
- Document: `.planning/architecture-governed-citadel-lifecycle.md`
- Phases: 8 including baseline and real-use preparation
- Estimated complexity: high; additive kernels first, shared integrations last
- Next: execute Phases 1-7, then start the separate verification goal
---
