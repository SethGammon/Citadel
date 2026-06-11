# Setup Reference

> last-updated: 2026-06-11

Companion reference for `/do setup` (`skills/setup/SKILL.md`). The skill holds
the executable protocol; this file holds the lookup tables, templates, and
output layouts it references.

## Modes

| Mode | What happens | Time |
|---|---|---|
| Recommended | Auto-detect stack, install hooks, live demo | ~3 min |
| Full Tour | Everything in Recommended + guided skill walkthrough | ~8 min |
| Express | Zero questions, auto-detect, hooks installed, done | ~30 sec |
| Update | Reconfigure an existing setup (offered when harness.json already has full config) | varies |

## Stack Detection Tables

Setup never asks what can be read from the project root.

### Language (check in order)

| File | Language |
|---|---|
| `tsconfig.json` | TypeScript |
| `package.json` (no tsconfig) | JavaScript |
| `requirements.txt` or `pyproject.toml` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pom.xml` or `build.gradle` | Java |

### Framework (read package.json dependencies)

| Dependency | Framework |
|---|---|
| `next` | Next.js |
| `react` (no next) | React |
| `vue` | Vue |
| `svelte` | Svelte |
| `@angular/core` | Angular |
| `express` | Express |
| `fastify` | Fastify |

### Package manager

| File | Manager |
|---|---|
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lockb` | bun |
| `package-lock.json` | npm |
| `requirements.txt` | pip |
| `Pipfile` | pipenv |

### Test framework

Read `package.json` devDependencies for `jest`, `vitest`, `mocha`, `jasmine`.
Python: check `pytest` in requirements.txt or pyproject.toml.

### Typecheck config by language

| Language | Command | Per-file |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | yes |
| Python + mypy | `mypy {file}` | yes |
| Python + pyright | `pyright {file}` | yes |
| Go | `go vet ./...` | no |
| Rust | `cargo check` | no |
| JavaScript | (none) | no |

Note: `perFile` applies to Python checkers only; TypeScript always runs a
project-scope incremental check and ignores `perFile` with an advisory.

## Routing Surfaces

`node {citadelRoot}/scripts/generate-routing.js` regenerates the routing
keyword surfaces inside the Citadel install from each skill's
`trigger_keywords` frontmatter:

- `core/skills/routing-table.json` (consumed by `scripts/route-preview.js`)
- The Tier 2 table in `skills/do/SKILL.md`
- The demo routing data in `docs/index.html`

Verify with `node {citadelRoot}/scripts/generate-routing.js --check` — exit 0
means all three surfaces are in sync.

## Dependency Pattern Suggestions

During setup (Recommended + Full Tour), `package.json` is checked for known
libraries; each match prompts
`"I see {package} installed. Warn agents when they use {anti-pattern}? [y/n]"`
and accepted patterns are added to `dependencyPatterns` in harness.json.

| If installed | Suggest warning | Message |
|---|---|---|
| `@tanstack/react-query` | raw `fetch(` / `axios` | Use tanstack query instead of raw fetch |
| `zustand` | `React.createContext` | Use Zustand instead of React Context |
| `date-fns` | `new Date().toLocaleDateString` | Use date-fns for date formatting |
| `zod` | `typeof ` / `instanceof ` | Use Zod for runtime validation |

## CLAUDE.md Starter Template

Generated when no CLAUDE.md exists:

```markdown
# {Project Name}

{Description}

## Stack
- Language: {detected}
- Framework: {detected}
- Package manager: {detected}
- Test framework: {detected}

## Conventions
(Add your coding conventions, architecture rules, and patterns here.)

## Architecture
(Describe your directory structure and layer boundaries here.)

## Citadel Harness

This project uses the [Citadel](https://github.com/SethGammon/Citadel) agent
orchestration harness. Configuration is in `.claude/harness.json`.
```

## Full Tour Walkthrough

The Full Tour presents five skill families, in this order:

**Family 1: Code Quality (2 min)**
```
/review [file]         — 5-pass review: correctness, security, perf, readability, consistency
/test-gen [file]       — generate tests matched to your test framework
/systematic-debugging  — 4-phase root cause: observe → hypothesize → verify → fix
```
Show: run `/review` on the demo file if not already done.

**Family 2: Building (2 min)**
```
/scaffold [thing]      — generate new files matching project conventions
/refactor [scope]      — safe multi-file refactoring with rollback checkpoints
/create-skill          — capture a repeated pattern as a reusable skill
```

**Family 3: Research (1 min)**
```
/research [question]   — structured investigation with confidence levels
/research --parallel   — parallel scouts, multiple angles, synthesized findings
/infra-audit           — maps infrastructure from config files
```

**Family 4: Orchestration (1 min)**
```
/marshal [thing]       — multi-step, one session, costs ~$2-5
/archon [thing]        — multi-session campaign, survives context limits
/fleet [thing]         — parallel agents in isolated git worktrees
```

**Family 5: Observability (1 min)**
```
/do next               — operator console: next action, risk, verification
/dashboard             — live view of campaigns, costs, hooks value, queues
/cost                  — session and campaign cost breakdown from real token data
/learn                 — extract reusable patterns from a completed campaign
```

After the walkthrough: `That's the system. Everything routes through /do — you never have to choose the right tool.`

## Reference Card

Printed at the end of every setup, filled with actual counts from the
detected config:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  CITADEL READY                                           │
│  {N} skills · {N} hooks live · {language}{+ framework}  │
│                                                          │
│  THE ONE COMMAND                                         │
│  /do [anything]     Describe what you want in plain      │
│                     English. The router handles the rest.│
│                                                          │
│  COMMON STARTING POINTS                                  │
│  /do review [file]           5-pass code review          │
│  /do fix [description]       Debug + fix                 │
│  /do why is [thing] broken   Root cause analysis         │
│  /do build [feature]         Scaffold + implement        │
│  /do test [file]             Generate tests              │
│  /do next                    What should happen next     │
│  /do status                  What's happening            │
│  /do continue                Resume active campaign      │
│                                                          │
│  WHEN TASKS GET BIGGER                                   │
│  /marshal [thing]    Multi-step, one session             │
│  /archon [thing]     Multi-session campaign              │
│  /fleet [thing]      Parallel agents                     │
│                                                          │
│  WHAT'S NOW PROTECTING YOUR SESSION                      │
│  ✓ protect-files      blocks edits to secrets + config  │
│  ✓ external-gate      all pushes/PRs need your approval │
│  ✓ circuit-breaker    stops failure spirals             │
│  ✓ quality-gate       runs on every session stop        │
│  ✓ telemetry          logging locally to .planning/     │
│                                                          │
│  NEXT STEPS                                              │
│  1. Add your conventions to CLAUDE.md                    │
│  2. /do --list    see all {N} skills                     │
│  3. /create-skill capture a repeated pattern             │
│  4. /improve [target]   autonomous quality loop          │
│                                                          │
│  docs/SKILLS.md · INSTALL.md · /do --list               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Express mode prints an abbreviated card: only the THE ONE COMMAND and
WHAT'S NOW PROTECTING YOUR SESSION blocks.
