# Twelve-Month Unlocks Completion Audit

Date: 2026-07-13
Baseline: `origin/main` at `cc14589`
Worktree: `C:\tmp\citadel-12-month-unlocks`

## Baseline verification

`node scripts/test-all.js` completed every aggregate check. All checks passed except the Codex runtime test, which could not create a temporary fixture inside the restricted sandbox. The exact failing test was rerun outside that filesystem restriction with `node scripts/test-codex-runtime.js` and passed. This establishes a clean behavioral baseline with one documented environment-only aggregate failure.

## Requirement-by-requirement verdict

| # | Step | Current verdict | What exists now | Locally achievable completion work | Genuine external gate |
|---:|---|---|---|---|---|
| 1 | Finish activation cohort and speak to installers | Mechanism complete, evidence collecting | Privacy-safe stages, share bundles, cohort ingest, decision gates, dashboard view | Read-only Discussion collector and decision reporting can be strengthened | 25 independent installs, interviews, seven-day eligibility and return require real users and elapsed time |
| 2 | Conventional CLI artifact and provenance | Incomplete | Clone-based runtime installers, deterministic GitHub release, update and rollback | npm CLI, auto-detection, `bin`, file allowlist, packed smoke test, provenance-ready workflow | npm name ownership and publication require authenticated maintainer action |
| 3 | One proof-producing starter journey | Incomplete | Strong skills and operating proof primitives | Pack contract, one-command CI Recovery journey, artifact and receipt | Independent usefulness and return require users |
| 4 | Receipt envelope attached to journey | Incomplete | Hook envelopes, HMAC telemetry, Ed25519 benchmark attestation | Canonical receipt schema, signing, redaction, verifier, emission | Public transparency integration is optional and external |
| 5 | Three outcome Packs | Not started as Packs | CI repair, refactor and deploy-steward skills | Three manifests, workflows, permissions, conformance, resume and failure tests | 100 external runs and repeat use require users |
| 6 | Real-run evidence including failures and unknowns | Partial | Deterministic fixtures and maintainer operational proof | Receipt-backed proof bundles, classifications and generated public ledger | Independent proof cannot be self-awarded |
| 7 | Operations Protocol v0.1 | Partial primitives | Runtime, event, loop, project and evidence contracts | Unified versioned operation, run, step, intent, evidence and receipt contracts | None |
| 8 | Compile one workflow across three targets | Not achieved | Guidance and asset projections for Claude and Codex | Canonical workflow plus local, interactive-runtime and GitHub projections | Live marketplace adoption is external, compilation is local |
| 9 | Narrow GitHub verification Action | Not achieved | Citadel's own CI and evidence validation | Reusable Action, stable inputs/outputs, read-only fixture consumer | Marketplace publication requires GitHub-side action |
| 10 | Typed MCP control plane | Partial | Read-mostly `citadel-state` MCP server | Shared schemas, validated outputs, revision-safe intent submission and control tools | None |
| 11 | Durable journal and chaos recovery | Partial and workflow-specific | Campaign stash guidance, loop records, claims and steward lease | Hash-chained journal, checkpoints, idempotency, effects, recovery planner and fault injection | None |
| 12 | Actionable Mission Control | Read-only product complete, controls absent | Fast honest local dashboard with SSE and evidence views | Safe intent API, CSRF/origin/revision gates, controls and browser interaction tests | Stranger comprehension metric ultimately requires people |
| 13 | Certified Pack alpha | Partial foundations | Skill scaffold, lint, benchmarks, digest provenance and dual-runtime compatibility | Pack schema, installer, trust, certification and local index | Outside authors and independent packages require contributors |
| 14 | Protocol 1.0 and conformance | Not achieved | Initial public contracts package | Stabilize protocol, migrations, compatibility policy and conformance suite after v0.1 | External implementer validation is valuable but not required to ship locally |
| 15 | Signed Pack registry and contributor ownership | Not achieved | Skill catalog and external skill digest verification | Signed local index, publisher identities, permissions, revocation, governance and publication workflow | Independent publishers and meaningful installs require contributors and users |
| 16 | Five-person, ten-repository milestone | Experimental team primitives only | Fleet teams pilot, claims, worktrees, discovery relay and teammate events | Multi-operator schemas, policies, pilot kit, simulator, metrics and export | Five real people using ten real repositories for 30 days cannot be simulated as adoption proof |
| 17 | Relay after demand gate | Correctly parked | Local-first architecture and roadmap gate | Demand schema, local transport interface, encrypted envelope contract, export and outage conformance can be built | Recurring team requests, waitlist, hosting, uptime and paying partners require external demand and operations |
| 18 | Reliability intelligence after sufficient consented evidence | Not begun | Activation, benchmark, cost, OTLP and proof telemetry | Privacy-safe local dataset contract, sufficiency gate, deterministic analyzer, confidence and held-out evaluation | Representative cross-repository consented evidence requires external use |

## Shared architecture decision

All locally achievable work will converge on one contract stack:

1. `OperationSpec` defines the workflow, policy, permissions, budget, verifier and stopping conditions.
2. `OperationRun` owns identity, revision and terminal state.
3. `StepAttempt` owns checkpoints, idempotency and effect classification.
4. `Intent` is the only mutation path for MCP and Mission Control.
5. `EvidenceEnvelope` distinguishes passed, failed, blocked and unknown.
6. `ExecutionReceipt` is the canonical portable proof.
7. Packs, compiler targets, team policy, Relay messages and reliability records reference these contracts rather than inventing parallel models.

## Dependency-ordered build slices

1. Protocol validators, canonicalization and public schemas.
2. Journal, effects, idempotency, recovery and receipts.
3. CLI product boundary and first three Pack manifests.
4. Canonical verification workflow and three compiler projections.
5. Reusable GitHub Action.
6. Typed MCP intent tools.
7. Mission Control write path and interaction controls.
8. Pack certification, signed registry and contributor governance.
9. Team policies, pilot simulator and metrics.
10. Relay demand gate and local-first transport contract.
11. Reliability dataset, sufficiency and recommendation engine.
12. Full conformance, documentation, visual QA and release verification.

## Completion standard

Local implementation is complete only when the relevant contract, CLI or UI exists and its negative paths pass. External thresholds remain open until current evidence proves them. Fixtures may validate mechanics, but they may not be counted as independent adoption, retention, comprehension, contributor, team, demand, or customer evidence.
