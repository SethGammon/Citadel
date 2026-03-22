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

- User describes an app they want to build
- User has a vague idea that needs structure
- Before starting any Archon campaign for a new project
- When /do routes a "create app" or "build me" request

## Protocol

### Step 1: UNDERSTAND

Read the user's description. Identify:
- What the app does (core functionality)
- Who it's for (user type)
- What success looks like (the user's actual goal)

If any of these are unclear, ask up to 3 focused questions. Not a questionnaire.
Just the questions that would change the architecture. Examples:
- "Is this for you personally or will other people use it?"
- "Does this need user accounts and login?"
- "What's the one thing it absolutely has to do well?"

Do NOT ask about tech stack yet. That comes in Step 3.

### Step 2: RESEARCH (Optional)

If the app concept has well-known existing implementations:
- Run /research on "how do similar apps to [concept] typically work"
- Identify 2-3 reference apps (not to copy, but to understand patterns)
- Note common features users expect in this category

Skip this step if the concept is simple enough (landing page, personal tool, CRUD app).

### Step 3: DEFINE

Produce a structured PRD. Write to `.planning/prd-{slug}.md`:

```markdown
# PRD: {App Name}

> Description: {One sentence}
> Author: {user}
> Date: {ISO date}
> Status: draft

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

## Architecture
{High-level description. 3-5 sentences max. How the pieces connect.
NOT a file tree. NOT implementation details. Just the shape.}

## End Conditions (v1 Definition of Done)
{Machine-verifiable conditions that mean v1 is complete.}
- [ ] {condition 1: e.g., "Landing page renders at localhost:3000"}
- [ ] {condition 2: e.g., "User can create account and log in"}
- [ ] {condition 3: e.g., "Core feature X works end-to-end"}
- [ ] {condition 4: e.g., "Deploys to [platform] without errors"}

## Open Questions
{Anything the PRD author couldn't decide. These become questions
for the user before the campaign starts.}
```

### Step 4: REVIEW

Present the PRD summary to the user:
- Core features (the numbered list)
- Tech stack decisions
- What's explicitly out of scope
- The end conditions

Ask: "Does this match what you're thinking? Anything to change before we build?"

If the user approves: the PRD is ready for Archon.
If the user adjusts: update the PRD and re-present the changed sections only.

### Step 5: HANDOFF

The PRD is not the build. The PRD is the input to the build.

```
---HANDOFF---
- PRD: {app name}
- Document: .planning/prd-{slug}.md
- Status: {approved | needs-revision}
- Next: Run `/do build {app name}` or `/archon` with the PRD as direction
---
```

## What /prd Does NOT Do

- Build anything (that's Archon's job)
- Choose a stack without reasoning (every choice needs a "because")
- Ask more than 3 clarifying questions (this isn't a form)
- Produce a 20-page document (max 1-2 pages, scannable)
- Recommend stacks the user can't realistically use

## Quality Gates

- Every feature in Core Features is one sentence (not a paragraph)
- Every technical decision has a reasoning ("because")
- End conditions are machine-verifiable (not "app works well")
- Out of Scope section exists and has at least 2 items
- No more than 5 core features for v1

## Stack Selection Principles

Don't lock to one stack. But do make opinionated recommendations:
- If the user has no preference and it's a web app: Next.js + Tailwind + shadcn/ui is the safest default (most LLM training data, most community support)
- If they need a backend: recommend based on their language comfort. Node/Express for JS people, FastAPI for Python people.
- If they need auth: recommend the simplest option for their stack. Don't default to Supabase just because it's common.
- If they need a database: SQLite for simple, PostgreSQL for anything multi-user
- ALWAYS explain the reasoning. The user should understand why, not just what.
