# Citadel Roadmap: The Path to World Class

This is the working milestone plan for making Citadel the reference orchestration layer for
Claude Code and OpenAI Codex. It is sequenced by leverage: each milestone removes a class of
risk or unlocks a class of capability, and each has binary exit criteria so progress is
verifiable rather than vibes.

Origin: a full June 2026 audit of the harness (four deep-dive reviews plus an adversarial
verification pass over every major finding). The audit confirmed strong fundamentals
(near-total hook event coverage, quota-aware scheduling, tamper-evident telemetry, real tests)
and identified the gaps this plan closes.

## North Star Metrics

These are the numbers that define "world class" for a harness. Every milestone should move at
least one of them.

| Metric | Definition | Target |
|---|---|---|
| Install success rate | Fresh installs that reach a working `/do` without manual repair | > 95% |
| Time to first routed task | Install start to first successful `/do` dispatch | < 10 minutes |
| Campaign resume rate | Interrupted campaigns that resume correctly in a fresh session | > 95% |
| Safety net honesty | Quality gates that report "did not run" instead of silently passing | 100% |
| Doc drift | Counts, lists, and tables that can disagree with the code | 0 (generated) |
| Hook overhead p95 | Added latency per tool call from the hook pipeline | < 200 ms |

## M0: Trust the Safety Net (shipped 2026-06-11)

The harness's value rests on its gates being real. This milestone makes every shipped gate do
what it claims, on every platform.

- Cross-platform post-edit typecheck with honest outcomes (pass, errors, unavailable, timeout).
  No silent passes, ever.
- Single source of truth for `/do` routing: keywords live in skill frontmatter, every surface
  (router table, route preview, demo) is generated, and a drift check runs in CI.
- Symmetric secrets protection: `.env` writes blocked by default across Edit, Write, and Bash;
  the native Claude Code memory directory is allowlisted; block reasons are visible on stderr.
- `/watch` intake dedup and cross-process locking implemented as documented.
- Fleet Teams Mode pilot scaffolding: protocol, rebalance hook, fallback, benchmark scenario.

**Exit criteria:** `npm test` green on Windows and POSIX including the new regression tests;
`generate-routing --check` wired into CI; the typecheck regression guard proves an unavailable
toolchain produces a visible advisory.

## M1: One Source of Truth (core shipped 2026-06-11)

Eliminate every place where documentation can drift from code, by construction rather than
discipline.

- Skill counts, skill lists, and hook event tables generated from the catalog into README,
  docs/SKILLS.md, and docs/ARCHITECTURE.md between markers.
- Fix AGENTS.md runtime paths; make it a thin dispatcher to CLAUDE.md and Codex equivalents.
- Consolidate INSTALL.md and QUICKSTART.md into one installation guide with per-runtime
  sections; DEMO.md becomes a short copyable script that links into it.
- Extend the routing generator pattern to all generated doc surfaces with one `--check`.

**Exit criteria:** a doc-drift test fails CI when any generated surface is stale; a new user
has exactly one obvious document to follow from clone to first `/do`.

## M2: Native Platform Spine (gates and contracts shipped 2026-06-11; plugin defaultEnabled deferred)

Adopt the platform primitives that replace prompt conventions with contracts.

- AskUserQuestion at every approval gate: `/improve` rubric approval, Archon phase boundaries,
  `/do` ambiguous-route confirmation. Multiple choice beats "STOP and wait".
- Structured outputs for judge agents (policy-enforcer, phase-validator): schema-enforced
  returns instead of "respond with ONLY this JSON".
- Native checkpoint and rewind awareness in Archon recovery, alongside the existing git stash
  checkpoints (stash for cross-session durability, rewind for in-session rollback).
- /reload-skills in the create-skill and evolve loops; plugin `defaultEnabled` for invasive
  components such as the Codex integration.
- Plan-mode-aware campaign design: spec-first flows start read-only.

**Exit criteria:** zero prompt-convention JSON parsing in judge agents; approval gates use
AskUserQuestion; Archon recovery documents both rollback paths; benchmarks cover the gates.

## M3: Teams-Native Fleet GA

Graduate the M0 pilot into the default coordination model where the runtime supports it.

- Run the Teams Mode pilot on a real multi-scope campaign; measure the success criteria
  (zero lost discoveries against the .planning mirror, reassignment latency on TeammateIdle,
  merge conflict rate no worse than classic).
- Native task spine: scopes and phases live as native tasks with dependency links during
  execution; `.planning/` remains the durable ledger and recovery source.
- Make teams mode the default on supporting Claude Code versions with automatic classic
  fallback; publish the pilot report.
- Slim fleet SKILL.md below 300 lines by moving protocol depth into docs/FLEET.md.

**Exit criteria:** pilot report committed with measured numbers; teams default behind version
detection; fleet SKILL.md under the line budget; campaign resume works mid-teams-session.

## M4: Observability That Sells

Turn the telemetry that already exists into something operators and teams can see.

- OTLP exporter that reads the JSONL telemetry and ships standard OpenTelemetry metrics
  (token spend, hook latency, agent runs, campaign phases). The hash-chained JSONL stays as
  the tamper-evident system of record.
- Dashboard upgrade: hook timing percentiles, campaign cost breakdown, gate outcomes,
  routine quota usage.
- Session-start health line: hooks installed, gates active, last verification result.
- State hygiene: expired consent markers and stale locks cleaned automatically.

**Exit criteria:** one command exports to a local OTEL collector demo; dashboard shows hook
p50/p95; no unbounded state files remain.

## M5: Skill Platform Hygiene

Make the skill collection sustainable as it grows.

- Line budget enforced by skill-lint: no SKILL.md over 300 lines; split fleet, setup,
  organize, and watch into core protocol plus linked appendices.
- Merge `/research` and `/research-fleet` behind one flag; resolve the `/organize` versus
  `/refactor` boundary (narrow organize or fold it in).
- Benchmark coverage at 100% for every state-changing or destructive skill (houseclean,
  organize, watch included).
- Skill lifecycle policy: versioning field, deprecation path, and router regeneration on any
  add, rename, or removal.

**Exit criteria:** lint enforces the budget; every destructive skill has scenarios; a skill
rename is a one-command operation that updates every surface.

## M6: Security Hardening v2

Extend the existing strong posture to the new execution models.

- Sandboxed bash profiles for risky campaign phases, loosening prompts for reversible work
  inside the sandbox.
- Threat model refresh covering Teams Mode, routines, and remote triggers.
- Permission audit reports compiled from the PermissionRequest and PermissionDenied hooks.
- A secrets-scanning pass in the quality gate (pattern-based, stdlib only).
- Release integrity: versioned releases of the plugin with checksums and migration notes.

**Exit criteria:** THREAT_MODEL.md v2 reviewed; sandbox profile shipped and documented; a
permission audit report renders from real session data.

## M7: Team and Distribution

Make Citadel adoptable by teams and discoverable by everyone else.

- Multi-operator campaign visibility: shared campaign state conventions for repos with more
  than one human operator.
- Policy templates per repository class (library, service, monorepo, app) installable at
  setup.
- Managed-settings guidance for organizations (version pinning, marketplace allowlists).
- Marketplace polish: accurate counts, per-skill context cost disclosure, screenshots, and a
  60-second demo.
- Contribution pipeline: good-first-skill issues, a skill submission checklist, and CI that
  runs the full lint and bench suite on PRs.

**Exit criteria:** at least two external contributors land skills through the pipeline; the
marketplace listing is accurate by generation, not by hand.

## Sequencing Notes

- M0 and M1 are foundation work: do not start M3 or M7 before they land. Shipping growth on
  top of silent gates or drifting docs compounds the debt.
- M2 and M4 can run in parallel after M0; they touch disjoint surfaces.
- M3 depends on M0 (pilot scaffolding) and benefits from M2 (structured outputs for the lead's
  judge calls).
- Reliability over novelty, always: a smaller harness that never lies beats a larger one that
  sometimes does.
