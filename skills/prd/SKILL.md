---
name: prd
description: >-
  Generates a Product Requirements Document from a natural language app description.
  Asks clarifying questions, researches similar apps, defines scope, stack, architecture,
  and produces a structured PRD that Archon can decompose into a campaign.
user-invocable: true
auto-trigger: false
effort: high
---

# /prd — Product Requirements Document Generator

## Identity

/prd converts "I want an app that does X" into a structured document that Archon
can execute. It does NOT build anything. It produces the spec that drives the build.

## When to Use

- User describes an app or feature to build (greenfield or feature mode)
- Before any Archon campaign for a new project or feature

## Mode Detection

Before starting, determine the mode:

**Greenfield mode**: No existing source files, or user explicitly says "new app" / "from scratch."
Produces a full PRD as described below.

**Feature mode**: The project already has source files (check for `src/`, `app/`, `lib/`,
`package.json` with dependencies, or similar). The user describes a feature to add, not a
whole app ("add auth", "add a dashboard", "add payment processing").

In feature mode:
- Read the existing file tree and `package.json`/equivalent before asking questions
- The existing stack is a given — don't recommend alternatives
- "Architecture" section describes integration points with existing code, not standalone shape
- End conditions MUST include regression checks: "existing tests still pass", "typecheck has no new errors"
- "Out of Scope" is relative to the feature, not the whole app
- Technical Decisions only covers decisions the feature introduces (new dependencies, new patterns)

The PRD template below works for both modes. Feature mode just scopes it tighter.

## Protocol

### Step 1: UNDERSTAND

Determine mode (greenfield vs feature). Identify core functionality, target user, and success criteria (greenfield) or integration points and existing stack (feature). Ask up to 3 questions — only those that would change the architecture. Do not ask about tech stack in greenfield mode; in feature mode, the stack is already decided.

### Step 2: RESEARCH (Optional)

If the concept has well-known implementations, run /research to identify 2-3 reference apps and common expected features. Skip for simple concepts (landing page, personal tool, CRUD).

### Step 3: DEFINE

Produce a structured PRD. Write to `.planning/prd-{slug}.md`:

```markdown
# PRD: {App Name or Feature Name}

> Description: {One sentence}
> Author: {user}
> Date: {ISO date}
> Status: draft
> Mode: {greenfield | feature}

## Problem
{What problem does this solve? Why does the user want it?}

## Users
{Who uses this? One or two user types max.}

## Core Features
{Numbered list. Maximum 5 for v1. Each feature is one sentence.}
1. {Feature}: {what it does}
2. ...

## Out of Scope (v1)
{Things the user might expect but should NOT be built yet.
Being explicit about what's out prevents scope creep.}

## Technical Decisions
- **Frontend**: {recommendation with reasoning}
- **Backend**: {recommendation with reasoning, or "none" for static apps}
- **Database**: {recommendation with reasoning, or "none"}
- **Auth**: {recommendation, or "none" if no user accounts}
- **Deployment**: {recommendation}

{In feature mode, only list decisions the feature introduces.
Existing stack decisions are inherited, not re-evaluated.}

## Architecture
{High-level description. 3-5 sentences max. How the pieces connect.
NOT a file tree. NOT implementation details. Just the shape.}

{In feature mode: describe integration points with existing code.
"The new auth middleware hooks into the existing Express router at
src/routes/index.ts. User model extends the existing Prisma schema."}

## Integration Points (feature mode only)
{Skip this section in greenfield mode.}
- **Existing files modified**: {list of files the feature will touch}
- **New files created**: {list of new files}
- **Dependencies added**: {new packages, if any}
- **Patterns followed**: {existing patterns in the codebase this feature should match}

## End Conditions (Definition of Done)
{Machine-verifiable conditions that mean the feature/app is complete.}
- [ ] {condition 1: e.g., "Landing page renders at localhost:3000"}
- [ ] {condition 2: e.g., "User can create account and log in"}
- [ ] {condition 3: e.g., "Core feature X works end-to-end"}

{In feature mode, ALWAYS include these regression conditions:}
- [ ] Existing tests pass with 0 new failures
- [ ] Typecheck passes with 0 new errors

## Open Questions
{Anything the PRD author couldn't decide. These become questions
for the user before the campaign starts.}
```

### Step 4: REVIEW

Present: core features, tech stack decisions, out of scope, end conditions. Ask if it matches. On approval: PRD is ready for Archon. On changes: update and re-present changed sections only.

## Contextual Gates

**Disclosure:** "Generating PRD for [description]. Creates `.planning/prd-{name}.md`."
**Reversibility:** green — creates `.planning/prd-{slug}.md` only; undo by deleting the file.
**Trust gates:**
- Any: full PRD generation, clarifying questions, review cycle.

## Quality Gates

- Every Core Feature is one sentence
- Every technical decision has a reasoning ("because")
- End conditions are machine-verifiable
- Out of Scope has at least 2 items
- No more than 5 core features for v1

## Fringe Cases

**Vague description**: Ask up to 3 clarifying questions. Never produce a PRD with placeholder end conditions.

**Feature mode but no existing code**: Confirm with the user — switch to greenfield if confirmed.

**User says "skip the PRD"**: Even a minimal PRD is needed. Offer a 1-page express PRD (Tier 4 style).

**If .planning/ does not exist**: Create it before writing. If not possible, present inline and suggest `/do setup`.

## Exit Protocol

```
---HANDOFF---
- PRD: {app name}
- Document: .planning/prd-{slug}.md
- Status: {approved | needs-revision}
- Next: Run `/do build {app name}` or `/archon` with the PRD as direction
- Reversibility: green — delete .planning/prd-{slug}.md to undo
---
```

## Stack Selection Principles

Make opinionated recommendations with reasoning. Defaults: Next.js + Tailwind + shadcn/ui for web; Node/Express for JS backends, FastAPI for Python; SQLite for simple, PostgreSQL for multi-user; simplest auth for the stack. Always explain why.

Deployment defaults: static → Vercel/Netlify; full-stack with DB → Railway; API only → Railway or Fly.io; not deploying yet → local only. See `.planning/_templates/deploy/` for platform details.
