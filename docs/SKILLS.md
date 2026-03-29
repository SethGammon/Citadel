# Writing Skills

> last-updated: 2026-03-24

Skills are the building blocks of the harness. Each skill is a markdown protocol
that loads into Claude's context when invoked, giving it domain-specific expertise.

## Why Skills?

Without skills, you re-explain the same patterns every session. With skills,
you explain once, encode it in a file, and every future session starts with
that knowledge already loaded.

Skills cost zero tokens when not active. They're loaded on demand.

## Skill File Format

Built-in Citadel skills live in the plugin's `skills/` directory. Custom project skills are created at `.claude/skills/{name}/SKILL.md` in your project:

```markdown
---
name: skill-name
description: >-
  One-paragraph description of what this skill does and when to use it.
  This appears in /do --list and helps the router classify intent.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-20
---

# /skill-name — Display Name

## Identity

Who is this skill? What perspective does it bring? This sets the tone
for how Claude approaches the work.

Example: "You are a security auditor. You look for vulnerabilities
with the skepticism of a penetration tester, not the optimism of a
developer."

## Orientation

When should this skill be used? What problems does it solve?
What does it NOT do? Clear boundaries prevent misuse.

## Protocol

Step-by-step instructions. This is what Claude follows.

1. Read CLAUDE.md to understand project conventions
2. {Specific action}
3. {Specific action}
4. ...

Use numbered steps, decision trees, and specific actions.
The protocol is a recipe, not a suggestion.

## Quality Gates

What must be true before this skill can declare "done"?

- {Concrete, verifiable criterion}
- {Concrete, verifiable criterion}

"The code looks good" is not a quality gate.
"Typecheck passes with zero errors" is a quality gate.

## Exit Protocol

What does the skill output when it's finished?

- Summary format
- Artifacts created
- HANDOFF block if applicable
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Skill identifier (used in `/skill-name` invocation) |
| `description` | yes | One paragraph. Shown in `/do --list`. Helps router classify. |
| `user-invocable` | yes | `true` if users can invoke directly with `/name` |
| `auto-trigger` | no | `true` if the skill should auto-activate on certain inputs |
| `last-updated` | no | Date for tracking freshness |

## The Five Sections

### Identity

Set the perspective. "You are a..." tells Claude what lens to use.

Bad: "This skill reviews code."
Good: "You are a senior engineer performing a pre-merge review. You've seen
production outages caused by the exact patterns you're looking for."

### Orientation

Define the boundaries. When to use, when NOT to use, what's in scope.

This prevents the skill from being invoked for the wrong task and sets
expectations for what it will produce.

### Protocol

The recipe. Numbered steps that Claude follows in order.

**Tips for good protocols:**
- Start with "Read CLAUDE.md" — every skill should respect project conventions
- Be specific: "Run `npm test`" not "verify the code works"
- Include decision points: "If tests fail, try X. If X fails, report and stop."
- Include iteration limits: "Retry up to 3 times" prevents infinite loops

### Quality Gates

The Definition of Done. Concrete, verifiable criteria.

**Good gates:**
- "All generated tests must pass"
- "Typecheck returns zero errors"
- "Every finding cites a specific file:line"

**Bad gates:**
- "Code quality is improved"
- "Documentation is complete"
- "The refactoring is clean"

### Exit Protocol

What the skill outputs when done. Standardize this so orchestrators
(Marshal, Archon, Fleet) can parse the output.

Always include a HANDOFF block for orchestrator consumption:

```
---HANDOFF---
- What was done
- Key decisions
- Remaining work
---
```

## Creating Skills with /create-skill

The fastest way to create a new skill is `/create-skill`. It interviews you
about the domain, patterns, and mistakes, then generates a complete skill file.

Run it when you notice:
- You keep explaining the same patterns to Claude
- The agent keeps making the same mistakes
- You have a workflow that could be codified

## Skill Discovery

The `/do` router finds built-in skills from the Citadel plugin and custom
skills by scanning `.claude/skills/*/SKILL.md` in your project.
When you create a new skill, it's automatically available to the router.

The skill's `name` and `description` in the frontmatter determine how
the router matches it to user intent.

## Examples

The harness ships with 33 built-in skills. Here are 6 core examples:

| Skill | Type | What It Does |
|-------|------|-------------|
| `/review` | Read-only | 5-pass structured code review |
| `/test-gen` | Generative | Generate tests that actually run |
| `/doc-gen` | Generative | Documentation in 3 modes |
| `/refactor` | Transformative | Safe multi-file refactoring |
| `/scaffold` | Structural | Project-aware scaffolding |
| `/create-skill` | Meta | Create new skills from patterns |

Read their SKILL.md files for examples of well-written protocols.
