---
name: create-app
description: >-
  End-to-end app creation from a single description. Four tiers: blank project,
  guided, templated, or fully generated. Routes through PRD, architecture, and
  Archon campaign with verification at every step.
user-invocable: true
auto-trigger: false
effort: max
---

# /create-app — From Description to Verified Application

## Identity

/create-app is the full pipeline from "I want an app that does X" to a verified,
working application. It integrates /prd, /architect, and /archon into a single
flow with human checkpoints at the right moments.

This exists because no tool has built the complete pipeline. They either generate
fast with no verification (Bolt, v0) or run autonomously with no guardrails
(Devin, Replit Agent). This does both: fast generation with phase-by-phase
verification, self-correction, and circuit breakers.

## Tier Detection

Classify the user's input into one of four tiers:

### Tier 1: Blank Project
- Trigger: "create a blank project", "new project", "scaffold"
- Action: Run /scaffold with stack detection. No PRD, no architecture.
- Use when: The user knows what they're building and just wants the infrastructure.

### Tier 2: Guided
- Trigger: "I want to build...", "help me create...", description with questions
- Action: Run /prd (asks clarifying questions) → user approves → /architect → user approves → /archon
- Use when: The user has an idea but needs help structuring it.
- Human checkpoints: after PRD, after architecture, before each major phase.

### Tier 3: Templated
- Trigger: Describes a well-known app type ("a todo app", "a blog", "a dashboard with auth")
- Action: Load template PRD if available → /architect with template defaults → /archon
- Use when: The app shape is known and common. Speeds up the planning phase.
- Template detection: check `.planning/_templates/app-types/` for matching templates.
  If no template matches, fall through to Tier 2.

### Tier 4: Generated (Full Autonomy)
- Trigger: "build me [detailed description]", "create [app] and deploy it"
- Action: /prd (minimal questions) → /architect (auto-approve if confidence high) → /archon with self-correction loop
- Use when: The user wants maximum autonomy. Trust the pipeline.
- Human checkpoints: after PRD only. Architecture and execution are autonomous.
- Safety: all Archon self-correction mechanisms active. Direction alignment every
  2 phases. Quality spot-checks every phase. Circuit breakers armed.

### Tier Classification

| Input Pattern | Tier |
|---|---|
| "blank project", "scaffold", "new empty" | 1 |
| "help me build", "I want to create", "guide me" | 2 |
| "todo app", "blog", "dashboard", well-known app type | 3 |
| "build me [detailed]", "create [app]", confident description | 4 |
| Ambiguous | Default to Tier 2 (safest) |

## Protocol

### Step 1: CLASSIFY

Read the user's input. Determine the tier. Announce:
"This sounds like a [tier name]. I'll [brief description of what happens next]."

If the classification is wrong, the user can override:
"Actually, just scaffold it" → Tier 1
"Walk me through it" → Tier 2
"Just build it" → Tier 4

### Step 2: EXECUTE TIER

**Tier 1:** Invoke /scaffold. Done.

**Tier 2:**
1. Invoke /prd with the user's description
2. Wait for user approval of the PRD
3. Invoke /architect with the approved PRD
4. Wait for user approval of the architecture
5. Create Archon campaign from the architecture
6. Execute campaign with standard Archon protocol
7. After each major phase: brief the user on progress

**Tier 3:**
1. Check `.planning/_templates/app-types/` for a matching template
2. If found: present the template PRD, ask "Does this match? What would you change?"
3. User approves or modifies → /architect with template defaults
4. Brief architecture review (faster than Tier 2 since the shape is known)
5. Create and execute Archon campaign

**Tier 4:**
1. Invoke /prd in express mode (ask at most 1 question, or 0 if the description is complete)
2. User approves PRD (this is the only mandatory human checkpoint)
3. Invoke /architect (auto-approve if all end conditions are machine-verifiable)
4. Create Archon campaign with ALL safety systems active:
   - Direction alignment every 2 phases
   - Quality spot-check every phase
   - Regression guard every build phase
   - Anti-pattern scan every build phase
   - Circuit breakers: 3 failures = new approach, 5+ type errors = park
   - Phase end conditions must pass before proceeding
5. Execute autonomously until complete or parked
6. On completion: run full verification of all end conditions from the PRD
7. Present results to user

### Step 3: VERIFY (All Tiers except 1)

After the campaign completes:

1. Read the PRD's End Conditions
2. Check each one:
   - Run commands, check file existence, invoke /live-preview for visual checks
3. Report:
   - PASS: all end conditions met. App is v1-complete.
   - PARTIAL: some conditions met, some failed. List what's missing.
   - FAIL: critical conditions not met. Suggest next steps.

### Step 4: DELIVER

Present the final state:
- What was built (feature ledger from the campaign)
- What was verified (end conditions that passed)
- What needs attention (anything that failed or was sent to Review Queue)
- How to run it (the command to start the app)
- How to continue (what v2 could look like)

## Safety Systems

All of Archon's existing safety applies. Additionally:

- **PRD as contract**: the PRD's end conditions are the acceptance criteria.
  The app is not "done" until those conditions pass. This prevents the 80% wall.
- **No stack lock-in**: /architect chooses the stack based on the PRD, not a
  hardcoded default. Different apps get different stacks.
- **Graduated autonomy**: Tier 2 has 3 human checkpoints. Tier 4 has 1.
  The user chooses how much control to keep.
- **Circuit breakers prevent death loops**: if the build enters a fix-break cycle,
  the circuit breaker parks the campaign instead of burning tokens.

## What /create-app Does NOT Do

- Skip the PRD (even Tier 4 generates one)
- Build without end conditions (every phase has verifiable criteria)
- Choose a stack without reasoning (every choice is justified)
- Run fully unsupervised (Tier 4 still has PRD approval + all Archon safety)
- Deploy without verification (deployment is an end condition, not automatic)

## Quality Gates

- PRD exists and is approved before any code is written
- Architecture exists before Archon starts
- Every campaign phase has machine-verifiable end conditions
- Final verification checks all PRD end conditions
- User receives a clear report of what was built and what needs attention
