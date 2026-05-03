---
name: create-skill
description: >-
  Creates new skills from the user's repeating patterns. Interview-driven:
  discovers the task, analyzes failure modes, generates a production SKILL.md,
  installs it, tests it on a real target, and teaches the user how to use it.
  Use when a user wants to encode a repeating workflow; do NOT use for one-off
  tasks or modifying existing skills.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - create skill
  - new skill
  - make a skill
  - teach the harness
  - custom skill
  - my own skill
  - skill for
  - automate this pattern
---

# /create-skill — Skill Creator

## Orientation

**Use when:**
- The user says "I keep doing this same thing" or "automate this for me"
- The user wants to encode a workflow they have refined through repetition
- The user says "create a skill for X" or "make a skill that does Y"

**Do NOT use when:**
- The user wants a one-off task done (just do it)
- The pattern has only happened once
- An existing skill already covers this
- The user wants to modify an existing skill (edit directly)

**Output:** A complete `.claude/skills/{name}/SKILL.md` in the project directory, tested and working.

## Protocol

### Step 1: DISCOVER — The Three Questions

Ask these three questions and wait for answers before proceeding.

**Q1: "What do you keep repeating?"**
Listen for: trigger, steps in order, scope, frequency. If vague, probe: "Walk me through the last time you did this."

**Q2: "What mistakes happen when you do it manually?"**
Listen for: forgotten steps, ordering mistakes, convention drift, edge cases. These become guardrails and quality gates.

**Q3: "What does 'done right' look like?"**
Listen for: observable outputs, quality signals, anti-patterns. These become quality gates and exit protocol.

### Step 2: ANALYZE — Extract the Skill's DNA

Internal working material — do not show to user.

**2a. Identity statement:** "You are a {role} that {does what} to ensure {outcome}." Must distinguish this skill from all others.

**2b. Trigger keywords (5-10):** Specific enough to avoid false matches. Check existing `.claude/skills/` for conflicts.

**2c. Protocol steps:** Transform "what I do" into numbered steps where:
- Each step has a clear input and output
- Decision points have explicit criteria ("IF x THEN y, ELSE z")
- Steps reference concrete things (file paths, commands, patterns)

Bad: "3. Review the code for issues."
Good: "3. Read every function. For each, check: (a) return type explicit, (b) error cases handled, (c) no input mutations. List violations with line numbers."

**2d. Quality gates:** Yes/no verifiable questions, no subjective criteria. Map each to a user "done right" criterion or common mistake.

**2e. Pitfalls:** From Q2. Become warnings or guard clauses in the protocol.

### Step 3: GENERATE — Write the SKILL.md

Every section required. File MUST be under 500 lines.

```markdown
---
name: {kebab-case-name}
description: >-
  {One to three sentences. Start with verb. Use when X; do NOT use for Y.}
user-invocable: true
auto-trigger: false
trigger_keywords:
  - {keyword 1}
  - {keyword 2}
---

# /{name} — {Readable Title}

## Orientation

**Use when:**
- {condition}

**Do NOT use when:**
- {exclusion}

**What this skill needs:**
- {required input}

## Protocol

### Step 1: {VERB — Name}
{Exact instructions. What to read, what to produce. No vague directives.}

### Step 2: {VERB — Name}
{Continue...}

## Quality Gates

- [ ] {Verifiable gate}

## Exit Protocol

{Exact output format}
```

**Writing rules:**
1. Steps must be reproducible by a different AI session with no memory of this conversation.
2. No hedge language — "do X" not "consider X".
3. No filler — delete sections that add no new information.
4. Include examples only where the pattern is non-obvious.
5. Encode the user's taste: "I hate when it does Z" → explicit prohibition.

### Step 4: INSTALL & REGISTER

1. Create `.claude/skills/{name}/`
2. Write the SKILL.md
3. Verify file exists and is readable
4. Register with router:
   a. Read `.claude/harness.json` (create with `{}` if missing)
   b. Add skill name to `registeredSkills` array
   c. Update `registeredSkillCount` to match array length
5. Only add to CLAUDE.md if it has an explicit skills section listing available skills.

### Step 5: VERIFY — Test on a Real Target

1. Find a real target in the current project the skill applies to.
2. Run the skill's protocol following the SKILL.md exactly — pretend you are a different AI session with no memory of this conversation.
3. Evaluate: did every step have enough information? Did any step require missing context? Did quality gates catch real issues?
4. If it fails or produces thin output, fix SKILL.md (common fixes: step too vague, step assumed context, gate not checkable, exit output missing fields).
5. Run again after fixes. Must pass on second attempt. If it fails twice, discuss scope with user.

### Step 6: TEACH — Explain What Was Built

**A. How to invoke:**
- Direct: `/{name}` or `/{name} [target]`
- Via router: `/do {natural language matching trigger keywords}`

**B. How it works (30-second version):**
- Steps summary, quality gates summary, exit output summary

**C. How to modify:**
- File: `.claude/skills/{name}/SKILL.md`
- Add step: new `### Step N` in Protocol
- Change quality standards: edit Quality Gates checkboxes
- Change trigger words: edit `trigger_keywords` in frontmatter
- Split if too large: create two skills, move steps between them

## Contextual Gates

**Disclosure:** "Creating skill '{name}'. Will create `skills/{name}/SKILL.md`."
**Reversibility:** green — creates `skills/{name}/SKILL.md` only; undo by deleting the directory.
**Trust gates:**
- Any: full skill creation, install, and teach workflow.

## Quality Gates

- [ ] Three discovery questions asked and answered
- [ ] Generated SKILL.md follows exact format (frontmatter + required sections)
- [ ] Frontmatter has: name, description, user-invocable, trigger_keywords
- [ ] Description includes use-when / do-not-use orientation
- [ ] Protocol steps specific enough for a different AI session to follow
- [ ] No steps contain vague directives ("review", "consider", "ensure quality")
- [ ] Quality gates all yes/no verifiable
- [ ] Trigger keywords do not conflict with existing skills
- [ ] SKILL.md is under 500 lines
- [ ] Skill tested on a real target in the current project
- [ ] Test produced meaningful output
- [ ] User taught invocation, mechanics, and modification
- [ ] File installed at `.claude/skills/{name}/SKILL.md`

## Exit Protocol

```
SKILL CREATED

Name: {name}
Path: .claude/skills/{name}/SKILL.md
Invoke: /{name} [target]
Route via: /do {example natural language}

What it does:
  {One sentence description}

Steps: {N} steps
Quality gates: {N} gates
Lines: {line count}/500

Tested on: {target description}
Test result: PASS

Trigger keywords: {comma-separated list}
Reversibility: green — delete skills/{name}/ to undo
```

```
Try it now: /{name} {suggested first target}
```
