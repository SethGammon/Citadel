# Skill and Memory Visibility

Citadel already has two local inventories that make agent behavior inspectable:
the skill catalog and the compiled memory index. Use them before changing
routing, adding skills, or trusting a long-running campaign handoff.

This is an operator workflow, not a new runtime mode. It answers three questions:

1. Which skills can Citadel choose from?
2. What project memory is currently available to agents?
3. Which entries are fresh enough to trust?

## Skill Visibility

Run the catalog from a Citadel clone:

```bash
node scripts/skill-catalog.js
```

Use filters when the list is too broad:

```bash
node scripts/skill-catalog.js --task-class quality
node scripts/skill-catalog.js --risk-level high
node scripts/skill-catalog.js --json
```

The catalog is useful when:

- reviewing whether `/do` is likely to route to the right capability
- checking whether a skill declares task class, risk level, benchmarks, and
  expected artifacts
- finding adjacent skills before writing "do not use when" guidance
- auditing whether a high-risk skill has enough verification commands

Treat missing metadata as a review prompt, not a runtime failure. Existing skills
can still work without complete packaging fields, but public or high-risk skills
should make their risk, artifacts, neighbors, and verification path explicit.

## Memory Visibility

Compiled memory blocks are listed with:

```bash
node scripts/memory-compile.js list
```

Useful filters:

```bash
node scripts/memory-compile.js list --scope verification
node scripts/memory-compile.js list --query "Fleet readiness"
node scripts/memory-compile.js list --json
```

Each memory block should be judged by:

- `id`: stable handle for citation and follow-up
- `type`: decision, rule, failure pattern, preference, recipe, or other category
- `scope`: where the memory applies
- `owner`: who or what owns the claim
- `confidence`: how strongly Citadel should trust it
- `last_verified`: freshness date for drift-prone claims
- `sources`: files or artifacts that support the memory

Use the JSON view for automated checks and the text view for human triage.
Memory is only useful when a future agent can tell where a claim came from and
whether it may have drifted.

## Lint Before Trusting

Before relying on memory during a larger campaign, run:

```bash
node scripts/memory-compile.js lint
```

Lint output should be treated as an operator warning. A lint failure does not
mean the repository is broken, but it does mean a campaign may inherit stale,
unsupported, or conflicting context.

## Private State Boundary

Project memory commonly lives under `.planning/`. That directory can contain
campaign notes, telemetry summaries, research, and project-specific operational
state. Do not copy raw `.planning/` content into public docs without reviewing
for private repo names, local paths, secrets, customer data, or unfinished
decisions.

For public explanation, prefer summarizing the workflow and showing sanitized
command output shapes. Keep raw memory as repo-local operating state.

## Change Review Checklist

When a PR changes skill or memory behavior, review these before merge:

- Does the skill catalog still run?
- Did new skills declare task class, risk level, artifacts, and verification
  commands when appropriate?
- Does memory lint pass, or are warnings explicitly explained?
- Are memory claims sourced to durable files rather than chat-only statements?
- Are private `.planning/` details kept out of public-facing docs?

## Expected Outcome

This visibility layer makes Citadel easier to trust without asking users to read
every skill or state file. Operators can inspect the agent's available tools,
see the memory it may rely on, and catch stale or under-specified context before
it influences a campaign.
