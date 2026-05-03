---
name: create-app
description: >-
  End-to-end app creation from a single description. Five tiers: blank project,
  guided, templated, fully generated, or feature addition to existing codebase.
  Routes through PRD, architecture, and Archon campaign with verification at every step.
user-invocable: true
auto-trigger: false
effort: max
---

# /create-app — From Description to Verified Application

## Identity

/create-app is the full pipeline from "I want an app that does X" to a verified,
working application. It integrates /prd, /architect, and /archon into a single
flow with human checkpoints at the right moments.

## Tier Detection

Use when the user wants to create an app, add a feature, or scaffold a project. Classify the input into one of five tiers:

### Tier 1: Blank Project
- Trigger: "create a blank project", "new project", "scaffold"
- Action: Run /scaffold with stack detection. No PRD, no architecture.

### Tier 2: Guided
- Trigger: "I want to build...", "help me create...", description with questions
- Action: /prd → user approves → /architect → user approves → /archon
- Human checkpoints: after PRD, after architecture, before each major phase.

### Tier 3: Templated
- Trigger: Describes a well-known app type ("a todo app", "a blog", "a dashboard with auth")
- Action: Load template PRD if available → /architect with template defaults → /archon
- Template detection: check `.planning/_templates/app-types/` for matching templates.
  If no template matches, fall through to Tier 2.

### Tier 4: Generated (Full Autonomy)
- Trigger: "build me [detailed description]", "create [app] and deploy it"
- Action: /prd (minimal questions) → /architect (auto-approve if confidence high) → /archon with self-correction loop
- Human checkpoints: after PRD only. Architecture and execution are autonomous.
- Safety: all Archon self-correction mechanisms active. Direction alignment every
  2 phases. Quality spot-checks every phase. Circuit breakers armed.

### Tier 5: Feature Addition (Existing Codebase)
- Trigger: existing project + feature description ("add auth", "add a dashboard", "add dark mode")
- Detection: project has source files (src/, app/, lib/, package.json with deps) AND description is a feature, not a standalone app
- Action: /prd in feature mode → /architect in existing codebase mode → /archon
- Key differences from greenfield tiers:
  - PRD reads existing codebase before asking questions
  - Architecture describes changes to existing files, not a standalone system
  - Phase 0 is always "Baseline" — record current typecheck/test state
  - Every phase end condition includes "no new typecheck errors" + "existing tests pass"
  - Risk register always includes "regression in existing functionality"
- Human checkpoints: after feature spec (PRD). Architecture can auto-approve if
  the feature is well-scoped and all conditions are machine-verifiable.

### Tier Classification

| Input Pattern | Tier |
|---|---|
| "blank project", "scaffold", "new empty" | 1 |
| "help me build", "I want to create", "guide me" | 2 |
| "todo app", "blog", "dashboard", well-known app type | 3 |
| "build me [detailed]", "create [app]", confident description | 4 |
| "add [feature]", "implement [feature]", existing project + feature description | 5 |
| Ambiguous | Default to Tier 2 (safest) |

## Protocol

### Step 1: CLASSIFY

Read the user's input. Determine the tier. Announce what you'll do in plain language — not tier numbers. If the classification is wrong, accept user overrides ("just scaffold it" → Tier 1, "just build it" → Tier 4).

### Step 2: EXECUTE TIER

**Tier 1:** Invoke /scaffold. Done.

**Tier 2:** /prd → user approves → /architect → user approves → Archon campaign → brief user after each major phase.

**Tier 3:** Check `.planning/_templates/app-types/` for template → present PRD, ask for changes → /architect with template defaults → Archon campaign.

**Tier 4:**
1. /prd express mode (0-1 questions)
2. User approves PRD (only mandatory checkpoint)
3. /architect (auto-approve if all end conditions are machine-verifiable)
4. Archon campaign with ALL safety systems active:
   - Direction alignment every 2 phases, quality spot-check every phase
   - Circuit breakers: 3 failures = new approach, 5+ type errors = park
5. Execute autonomously until complete or parked
6. Run full verification of all PRD end conditions, present results

**Tier 5 (Feature Addition):**
1. Read existing codebase — file tree, package.json, key entry points, existing patterns
2. /prd in feature mode (max 2 questions)
3. User approves feature spec (one mandatory checkpoint)
4. /architect in existing codebase mode — Phase 0 always "Baseline" (run typecheck + tests, record counts). Auto-approve if machine-verifiable.
5. Archon campaign — every phase end condition includes "no new typecheck errors vs baseline" and "existing tests pass"
6. On completion: verify all feature end conditions + baseline regression check, present results

### Step 3: VERIFY (All Tiers except 1)

Check each PRD end condition (run commands, check files, invoke /live-preview for visual checks). Report PASS / PARTIAL / FAIL with specifics.

### Step 4: DELIVER

Present: what was built, what was verified, what needs attention, how to run it, and suggested next step (e.g., /postmortem or deploy command).

## Quality Gates

- PRD exists and is approved before any code is written
- Architecture exists before Archon starts
- Every campaign phase has machine-verifiable end conditions
- Final verification checks all PRD end conditions
- User receives a clear report of what was built and what needs attention

## Fringe Cases

**Vague requirements**: Default to Tier 2 and ask clarifying questions before producing the PRD.

**Project already initialized**: Existing source files (src/, app/, package.json with deps) → automatically classify as Tier 5. Do not scaffold over an existing project.

**If .planning/ does not exist**: /prd and /architect will create it. If not possible, present inline and ask the user to run `/do setup` first.

**Tier misclassification**: Switch immediately on user correction without re-reading the input.

## Exit Protocol

After the campaign completes and verification runs, output:

```
---HANDOFF---
- App: {name}
- Built: {feature ledger summary}
- Verified: {N}/{total} end conditions passed
- Status: {complete | partial | failed}
- To run: {start command}
- Next: {suggested next step, e.g., /postmortem or deploy command}
- Reversibility: amber -- multi-tier creation, revert the creation commits
---
```
