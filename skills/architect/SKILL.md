---
name: architect
description: >-
  Given a PRD, produces an implementation architecture: file tree, component
  breakdown, data model, and a phased build plan with end conditions that
  Archon can execute directly. Multi-candidate evaluation for key decisions.
user-invocable: true
auto-trigger: false
effort: high
---

# /architect — Implementation Architecture from PRD

## When to Use

- After /prd produces an approved PRD (greenfield or feature mode)
- When the user has a clear direction + existing codebase (no PRD needed)
- When /do routes a build request
- When the user has a spec and wants a build plan

## Inputs

One of:
1. A PRD file path (from /prd) — preferred, contains structured requirements
2. A user-provided spec or description + an existing codebase — sufficient
3. Neither — suggest /prd first, but don't hard-gate. If the user has a clear
   direction ("add auth to my app"), that + the existing code IS the input.

## Mode Detection

**Greenfield mode**: PRD exists with `Mode: greenfield`, or no existing source files.
Produces a complete architecture from scratch.

**Feature mode**: PRD exists with `Mode: feature`, OR the user describes a feature
and the project has existing source files. The architecture describes changes to
existing code, not a standalone system.

In feature mode:
- Read the existing file tree FIRST — understand the current architecture before planning changes
- Read key files (package.json, tsconfig, main entry points, existing patterns)
- The File Tree section shows ONLY new and modified files, not the entire project
- Phases include a Phase 0: "Baseline" that records current typecheck/test state
- Every phase's end conditions include "no new typecheck errors" and "existing tests pass"
- The Risk Register includes "regression in existing functionality" as a default risk

## Protocol

### Step 1: READ

**If PRD exists**, read it. Extract:
- Core features (the numbered list)
- Technical decisions (stack choices)
- End conditions (what "done" looks like)
- Out of scope (what NOT to build)
- Integration points (feature mode)

**If no PRD**, read the codebase instead:
- Scan the file tree for structure and conventions
- Read package.json / equivalent for dependencies and scripts
- Read the main entry point(s) to understand the architecture
- Use the user's description as the feature spec
- Infer end conditions from the description ("add auth" → "protected routes return 401 without token")

### Step 2: EVALUATE OPTIONS (for non-trivial decisions)

For decisions with multiple valid approaches — state management, API structure, auth pattern, DB schema, routing — generate 2-3 candidates. Assess each on complexity, risk, maintainability, and LLM-friendliness. Pick the winner and document why. Reject alternatives with reasoning.

Simple decisions (file naming, folder structure, CSS) don't need this — use the PRD's stack choices and move on.

### Step 3: PRODUCE

Write to `.planning/architecture-{slug}.md`:

```markdown
# Architecture: {App Name}
> PRD: .planning/prd-{slug}.md  |  Date: {ISO date}

## File Tree
{Greenfield: complete file tree for v1, every file listed.
Feature mode: ONLY new (+) and modified (~) files.}

## Component Breakdown
### Feature: {name}
- Files: | Dependencies: | Complexity: {low/medium/high}

## Data Model
### {Entity name}
- Fields: {name: type}  |  Relationships: {connections}
{Omit section if no database.}

## Key Decisions
### {Decision}: {chosen approach}
- **Chosen**: {approach} — {reasoning}
- **Rejected**: {alternative} — {why not}

## Build Phases
### Phase N: {name}
- **Goal**: {one sentence}
- **Files**: | **Dependencies**: {or "none"}
- **End Conditions**: [ ] {machine-verifiable}

## Phase Dependency Graph
{Text format: Phase 1 → Phase 2 → Phase 3 / Phase 3 + 4 → Phase 5}

## Risk Register
1. {risk}: {mitigation}
2. {risk}: {mitigation}
3. {risk}: {mitigation}

## Deployment Strategy
{Skip if "deploy later" or static-only.}
- **Platform**: | **Method**: | **Environment variables**: | **Pre-deploy checks**:
{Final phase is "Deploy" when a platform is specified. A failed deploy does NOT fail the campaign.}
```

### Step 4: CONNECT TO CAMPAIGN

Each build phase becomes a campaign phase; end conditions carry over; the dependency graph determines ordering; parallel-safe phases flagged for Fleet.

Present summary to user (file count, phase count, key decisions, estimated complexity) and ask: "Ready to build? This will create an Archon campaign." If approved, write the campaign file.

### Step 5: HANDOFF

```
---HANDOFF---
- Architecture: {app name}
- Document: .planning/architecture-{slug}.md
- Phases: {count}
- Estimated complexity: {low/medium/high}
- Next: Archon campaign ready to execute
- Reversibility: green — delete .planning/architecture-{slug}.md to undo
---
```

## Contextual Gates

**Disclosure:** "Generating architecture plan for [description]. No files modified until you approve."
**Reversibility:** green — creates `.planning/architecture-{slug}.md` only; undo with `rm .planning/architecture-{slug}.md`.
**Trust gates:**
- Any: generate architecture document, evaluate options, connect to campaign.

## Quality Gates

- Every phase has at least one machine-verifiable end condition
- Every key decision documents what was rejected and why
- File tree is complete (no "etc." or "..." placeholders)
- Phase dependencies are explicit (no implicit ordering)
- Risk register has at least 2 entries

## Fringe Cases

**No PRD:** Treat user description + existing codebase as the spec; read file tree and package.json; proceed without requiring a PRD.

**Project already has code:** Use feature mode; read existing architecture first; file tree shows only new/modified files; Phase 0 records baseline typecheck/test state.

**Vague description:** Ask at most 2 clarifying questions; don't block on perfect clarity.

**`.planning/` missing:** Create it; if not possible, output the architecture inline and instruct the user to save it.

## Exit Protocol

```
---HANDOFF---
- Architecture: {app name}
- Document: .planning/architecture-{slug}.md
- Phases: {count}
- Estimated complexity: {low/medium/high}
- Next: Archon campaign ready to execute
- Reversibility: green — delete .planning/architecture-{slug}.md to undo
---
```
