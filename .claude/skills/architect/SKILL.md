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

## Identity

/architect converts a PRD into a buildable plan. It decides HOW to implement
what the PRD describes. Its output is a campaign-ready architecture document
that Archon reads and executes.

## When to Use

- After /prd produces an approved PRD
- When /do routes a build request that has a PRD
- When the user has a spec and wants a build plan

## Inputs

A PRD file path (from /prd) or a user-provided spec. If neither exists, tell
the user to run /prd first.

## Protocol

### Step 1: READ

Read the PRD. Extract:
- Core features (the numbered list)
- Technical decisions (stack choices)
- End conditions (what "done" looks like)
- Out of scope (what NOT to build)

### Step 2: EVALUATE OPTIONS (for non-trivial decisions)

For any architectural decision where multiple valid approaches exist:

1. Generate 2-3 candidate approaches
2. For each candidate, assess:
   - Complexity to implement (how many files, how many concepts)
   - Risk (what could go wrong, what's the failure mode)
   - Maintainability (how easy to modify later)
   - LLM-friendliness (how well can an agent implement this without confusion)
3. Pick the winner. Document why in the architecture doc.

This is based on AlphaCodium's finding that multi-candidate evaluation
outperforms single-candidate refinement. Don't commit to the first idea.

Key decisions that warrant multi-candidate evaluation:
- State management approach
- API structure (REST vs tRPC vs GraphQL)
- Auth implementation pattern
- Database schema design
- Routing strategy

Simple decisions (file naming, folder structure, CSS approach) don't need this.
Use the PRD's stack choices and move on.

### Step 3: PRODUCE

Write to `.planning/architecture-{slug}.md`:

```markdown
# Architecture: {App Name}

> PRD: .planning/prd-{slug}.md
> Date: {ISO date}

## File Tree (Target State)
{The complete file tree of the finished v1. Every file listed.
This is the map. Agents read this before creating files.}

## Component Breakdown
{For each core feature from the PRD:}
### Feature: {name}
- Files: {list of files this feature touches}
- Dependencies: {what must exist before this can be built}
- Complexity: {low/medium/high}

## Data Model
{If the app has a database:}
### {Entity name}
- Fields: {name: type}
- Relationships: {how it connects to other entities}

{If no database: skip this section}

## Key Decisions
{Architecture decisions that were evaluated:}
### {Decision}: {What was chosen}
- **Chosen**: {approach} — because {reasoning}
- **Rejected**: {alternative} — because {why not}

## Build Phases
{Ordered phases that Archon will execute. Each phase has:}

### Phase 1: {name}
- **Goal**: {one sentence}
- **Files**: {files created or modified}
- **Dependencies**: {what must exist first, or "none"}
- **End Conditions**:
  - [ ] {machine-verifiable condition}
  - [ ] {machine-verifiable condition}

### Phase 2: {name}
...

## Phase Dependency Graph
{Which phases depend on which. Simple text format:}
Phase 1 → Phase 2 → Phase 3
                  → Phase 4 (parallel with 3)
Phase 3 + 4 → Phase 5

## Risk Register
{Top 3 things most likely to go wrong:}
1. {risk}: {mitigation}
2. {risk}: {mitigation}
3. {risk}: {mitigation}
```

### Step 4: CONNECT TO CAMPAIGN

Convert the architecture into a campaign-ready format:

1. Each build phase becomes a campaign phase
2. End conditions from the architecture become Phase End Conditions in the campaign
3. The dependency graph determines phase ordering
4. Parallel-safe phases get flagged for potential Fleet execution

Present the architecture summary to the user:
- File count and structure
- Number of phases
- Key decisions made and why
- Estimated complexity

Ask: "Ready to build? This will create an Archon campaign."

If approved: write the campaign file using the architecture as the direction.

### Step 5: HANDOFF

```
---HANDOFF---
- Architecture: {app name}
- Document: .planning/architecture-{slug}.md
- Phases: {count}
- Estimated complexity: {low/medium/high}
- Next: Archon campaign ready to execute
---
```

## What /architect Does NOT Do

- Build anything (produces the plan, not the code)
- Skip multi-candidate evaluation for key decisions
- Create phases without end conditions
- Ignore the PRD's "out of scope" section
- Produce a file tree without knowing what each file does

## Quality Gates

- Every phase has at least one machine-verifiable end condition
- Every key decision documents what was rejected and why
- File tree is complete (no "etc." or "..." placeholders)
- Phase dependencies are explicit (no implicit ordering)
- Risk register has at least 2 entries
