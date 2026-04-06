---
name: setup
description: >-
  First-run experience for the harness. Three modes: Recommended (guided,
  ~3 min), Full Tour (guided + skill walkthrough, ~8 min), and Express
  (zero questions, ~30 sec). Installs hooks first, detects stack, configures
  harness.json, runs a live demo on real code, and prints a reference card.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - setup
  - first run
  - configure harness
  - install citadel
  - getting started
last-updated: 2026-04-06
---

# /do setup — First-Run Experience

## Identity

You are the setup wizard. Your job is to get someone from zero to a fully
configured, hook-protected, skill-routed session in under 5 minutes — with
hooks live before the first question is asked.

The experience should feel like a competent colleague walking them through
their own codebase, not a generic installer.

## Orientation

Run `/do setup` on any project after loading Citadel as a plugin. This
configures the harness for the specific project — detecting the stack,
installing hooks with resolved paths, registering skills, and optionally
demonstrating the system on real code.

Flag: `/do setup --express` skips mode selection and runs Express directly.

---

## Protocol

### Step 0: MODE SELECTION

Before anything else, present three modes. This is the only required
interaction before hooks install.

```
Welcome to Citadel.

How would you like to get started?

  [1] Recommended  — auto-detect your stack, install hooks, live demo  (~3 min)
  [2] Full Tour    — everything in Recommended + guided skill walkthrough (~8 min)
  [3] Express      — zero questions, auto-detect, hooks installed, done  (~30 sec)

Press Enter for Recommended, or type 1, 2, or 3.
```

**If harness.json already exists with a full config**, present a fourth option:

```
  [4] Update — reconfigure existing setup (current: {language}, {skillCount} skills)
```

Store the chosen mode. Default to Recommended if no input.

**If `--express` flag was passed**: skip mode selection, run Express directly.

---

### Step 1: INSTALL HOOKS (all modes, always first)

**Run hook installer immediately** — before any other questions or detection.
Hooks being live for the rest of the session is more important than anything else.

```bash
node {citadel-root}/scripts/install-hooks.js
```

Find `{citadel-root}`:
1. Read `.citadel/plugin-root.txt` (written by init-project on session start)
2. Fallback: use the directory containing this SKILL.md (Citadel plugin root)

The installer:
- Reads `hooks/hooks-template.json`
- Resolves absolute paths (workaround for anthropics/claude-code#24529)
- Writes into this project's `.claude/settings.json`
- Preserves existing non-Citadel settings
- Is idempotent — safe to re-run

**On success**, output a compact status line:
```
  ✓ {N} hooks installed (protect-files, external-gate, circuit-breaker, quality-gate + more)
```

**On failure** (script not found, permission error):
- Output the error
- Explain that hooks can be installed manually: `node /path/to/Citadel/scripts/install-hooks.js`
- Continue with the rest of setup — hooks are important but setup should not abort

---

### Step 2: STACK DETECTION (all modes)

Auto-detect by scanning the project root. Never ask what can be read.

**Language detection (check in order):**
| File | Language |
|---|---|
| `tsconfig.json` | TypeScript |
| `package.json` (no tsconfig) | JavaScript |
| `requirements.txt` or `pyproject.toml` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pom.xml` or `build.gradle` | Java |

**Framework detection (read package.json dependencies):**
| Dependency | Framework |
|---|---|
| `next` | Next.js |
| `react` (no next) | React |
| `vue` | Vue |
| `svelte` | Svelte |
| `@angular/core` | Angular |
| `express` | Express |
| `fastify` | Fastify |

**Package manager:**
| File | Manager |
|---|---|
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lockb` | bun |
| `package-lock.json` | npm |
| `requirements.txt` | pip |
| `Pipfile` | pipenv |

**Test framework:**
Read `package.json` devDependencies for `jest`, `vitest`, `mocha`, `jasmine`.
Python: check for `pytest` in requirements.txt or pyproject.toml.

**Typecheck config by language:**
| Language | Command | Per-file |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | yes |
| Python + mypy | `mypy {file}` | yes |
| Python + pyright | `pyright {file}` | yes |
| Go | `go vet ./...` | no |
| Rust | `cargo check` | no |
| JavaScript | (none) | no |

**Confirmation (Recommended + Full Tour only):**
Output one line: `Detected: {language}{+ framework if any} · {packageManager} · {testFramework if any}`
Then: `Correct? [y/n/edit]`
- `y` or Enter: proceed
- `n` or `edit`: ask for corrections inline
- Express: skip confirmation entirely, use detected values

---

### Step 3: GENERATE CONFIG (all modes)

Write `.claude/harness.json` using Node (not Write tool — harness.json is a
protected file after first install):

```javascript
node -e "
const fs = require('fs');
const existing = fs.existsSync('.claude/harness.json')
  ? JSON.parse(fs.readFileSync('.claude/harness.json', 'utf8'))
  : {};

// Count skills
const skillDirs = fs.readdirSync('{citadelRoot}/skills', { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name);

const config = {
  language: '{detected}',
  framework: '{detected or null}',
  packageManager: '{detected}',
  typecheck: { command: '{command}', perFile: {bool} },
  test: { command: '{testCommand}', framework: '{testFramework}' },
  qualityRules: { builtIn: ['no-confirm-alert', 'no-transition-all'], custom: [] },
  protectedFiles: ['.claude/harness.json', '.claude/settings.json'],
  features: { intakeScanner: true, telemetry: true },
  registeredSkills: skillDirs,
  registeredSkillCount: skillDirs.length,
  agentTimeouts: { skill: 600000, research: 900000, build: 1800000 },
  trust: {
    sessionCount: existing.trust?.sessionCount || 0,
    campaignCount: existing.trust?.campaignCount || 0,
    level: existing.trust?.level || 'novice'
  },
  ...existing  // preserve consent, storage, policy
};
fs.writeFileSync('.claude/harness.json', JSON.stringify(config, null, 2));
"
```

**Skill registry rebuild:** populate `registeredSkills` with every directory
name under `{citadelRoot}/skills/` plus any custom skills in `.claude/skills/`.
Set `registeredSkillCount` to match. This is the full rebuild `/do`'s Step 0 defers to.

**Dependency pattern suggestions (Recommended + Full Tour only):**
After writing harness.json, read `package.json` and check for known libraries:

| If installed | Suggest warning | Message |
|---|---|---|
| `@tanstack/react-query` | raw `fetch(` / `axios` | Use tanstack query instead of raw fetch |
| `zustand` | `React.createContext` | Use Zustand instead of React Context |
| `date-fns` | `new Date().toLocaleDateString` | Use date-fns for date formatting |
| `zod` | `typeof ` / `instanceof ` | Use Zod for runtime validation |

For each match, ask before adding: `"I see {package} installed. Warn agents when they use {anti-pattern}? [y/n]"`
Add accepted patterns to `dependencyPatterns` in harness.json.

---

### Step 4: CLAUDE.md + AGENTS.md (all modes)

**Seed the canonical project spec:**
```bash
node {citadelRoot}/scripts/bootstrap-project-guidance.js --project-root {projectRoot}
```
This creates `.citadel/project.md` (source of truth) and generates `CLAUDE.md`
and `AGENTS.md` from it. Safe to run — only creates files that don't exist.

**Project description (Recommended + Full Tour only):**
Ask: `"What's this project? One line is fine — or press Enter to use the package name."`
- Use their answer (or package.json name) to seed the project description
- If CLAUDE.md already exists with content, skip this question

**CLAUDE.md merge rules:**
- Does not exist → generate starter with detected stack + description
- Exists, no `## Citadel Harness` section → append that section at the bottom only
- Exists with `## Citadel Harness` already → skip, don't duplicate
- NEVER overwrite or delete existing CLAUDE.md content

Starter template:
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

---

### Step 5: OPTIONAL INTEGRATIONS (Recommended + Full Tour only)

Present as a group, not individually — one prompt:

```
Optional integrations — choose any, or press Enter to skip all:

  [g] GitHub    — scaffold Claude triage workflow for issues + PRs
  [m] MCP       — create .mcp.json with common servers pre-configured
  [b] Both
  [s] Skip

```

**GitHub integration (if chosen):**
1. Create `.github/workflows/` if missing
2. Copy `.planning/_templates/claude-triage.yml` → `.github/workflows/claude-triage.yml` (skip if exists)
3. Copy `.planning/_templates/REVIEW.md` → `REVIEW.md` (skip if exists)
4. Output: `"Add ANTHROPIC_API_KEY to Settings > Secrets > Actions to activate."`

**MCP integration (if chosen):**
1. Copy `.planning/_templates/.mcp.json` → `.mcp.json` (skip if exists)
2. Output: `"Edit .mcp.json to uncomment the servers you want."`

**Skip**: move on silently.

---

### Step 6: LIVE DEMO (Recommended + Full Tour only)

**Find a target file:**
Run `git diff --name-only HEAD~1 HEAD 2>/dev/null | head -5` to get recently changed files.
Filter for source files (not lock files, not generated files).
Pick the most recently changed source file. If no git history, use `find` to get recently modified files.

**Pain point question:**
```
What's your biggest frustration with AI coding tools right now?

  [a] Repetitive context — I keep re-explaining my codebase
  [b] Quality — the agent breaks things or misses issues
  [c] Context loss — every new session starts from zero
  [d] Scale — fine for small tasks, falls apart on big ones
  [e] Something else / skip demo

```

**Demo selection by pain point:**

| Pain point | Demo | Script |
|---|---|---|
| (a) Repetitive context | Run `/review` on the target file | "This review uses the harness.json config you just set up — it already knows your stack, conventions, and quality rules. You won't re-explain these." |
| (b) Quality | Run `/review` on the target file | "The quality-gate hook just ran on every edit made during setup. Here's what that looks like on your code:" |
| (c) Context loss | Show `.planning/` structure, explain campaigns | "Sessions now persist. Start a campaign today, close your laptop, resume tomorrow. The agent picks up exactly where it left off." |
| (d) Scale | Run `/review` on the largest/most complex source file | "For bigger work: `/marshal` for multi-step single sessions, `/archon` for multi-day campaigns, `/fleet` for parallel agents with shared discovery." |
| (e) / skip | Skip demo | Continue to reference card |

Execute the demo on real code. Show output. Don't summarize it — let it land.

---

### Step 7: FULL TOUR WALKTHROUGH (Full Tour only)

After the demo, walk through five skill families. For each, show one example
relevant to their detected stack. This is not a lecture — it's a quick show-and-tell.

**Family 1: Code Quality (2 min)**
```
/review [file]         — 5-pass review: correctness, security, perf, readability, consistency
/test-gen [file]       — generate tests that actually run, matched to your test framework
/systematic-debugging  — 4-phase root cause: observe → hypothesize → verify → fix
```
Show: Run `/review` on the file from Step 6 if not already done.

**Family 2: Building (2 min)**
```
/scaffold [thing]      — generate new files matching your project's conventions
/refactor [scope]      — safe multi-file refactoring with rollback checkpoints
/create-skill          — capture a repeated pattern as a reusable skill
```
Show: Describe what scaffold would generate for their stack.

**Family 3: Research (1 min)**
```
/research [question]   — structured investigation with confidence levels
/research-fleet        — parallel scouts, multiple angles, synthesized findings
/infra-audit           — maps infrastructure from config files
```

**Family 4: Orchestration (1 min)**
```
/marshal [thing]       — multi-step, one session, costs ~$2-5
/archon [thing]        — multi-session campaign, survives context limits
/fleet [thing]         — parallel agents in isolated git worktrees
```
Show: Explain the cost ladder. `/marshal` for anything that needs 3+ steps.
`/archon` when the work spans days. `/fleet` when sub-tasks are independent.

**Family 5: Observability (1 min)**
```
/dashboard             — live view of campaigns, costs, hooks value, queues
/cost                  — session and campaign cost breakdown from real token data
/learn                 — extract reusable patterns from a completed campaign
```
Show: Run `/dashboard` to show their live state.

After the walkthrough:
```
That's the system. Everything routes through /do — you never have to choose
the right tool. Just describe what you want and let the router decide.
```

---

### Step 8: REFERENCE CARD (all modes)

Print the reference card. Populate actual counts from detected config.

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
│  docs/SKILLS.md · QUICKSTART.md · /do --list            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Express mode**: print an abbreviated card (just THE ONE COMMAND section + WHAT'S NOW PROTECTING).

---

### Step 9: CLOSING LINE (all modes)

Print the appropriate closing based on mode:

**Express:**
```
Done. {N} hooks live, {N} skills registered.
Type /do [anything] to start.
```

**Recommended:**
```
Setup complete. Citadel is configured for {language}{+ framework}.
{N} hooks are protecting this session. {N} skills are registered.
Type /do [anything] to get started — or /do --list to browse all skills.
```

**Full Tour:**
```
Tour complete. You've seen the full system.
{N} hooks live · {N} skills registered · trust level: {level}

The best next thing: /do "review the most important file in this codebase"
```

**Update:**
```
Configuration updated. {N} hooks reinstalled, {N} skills re-registered.
Changes: {list what changed vs previous config}
```

---

## Fringe Cases

**Plugin not found (`.citadel/plugin-root.txt` missing):**
Prompt: `"Where is Citadel installed? (e.g. ~/Citadel or C:/tools/Citadel)"`
Use their answer for all subsequent path operations. Write it to `.citadel/plugin-root.txt`.

**Project has no source files (empty repo):**
Skip the demo entirely. Output: `"Once you have code, try /review [file] to see the harness in action."`

**harness.json is protected and Write tool is blocked:**
Use `node -e "..."` via Bash to write it directly — the Node script bypasses the Write hook, which is correct behavior since setup is the one authorized path to modify harness.json.

**Existing CLAUDE.md with no blank line at end:**
Append a newline before the `## Citadel Harness` section.

**Stack detection fails entirely:**
Fall back to asking: `"What's your primary language? (typescript / javascript / python / go / rust / other)"`

**Re-running setup on a configured project (Update mode):**
Show a diff of what would change. Don't silently overwrite. Let the user confirm each change.

**`bootstrap-project-guidance.js` not found:**
Skip it silently — CLAUDE.md/AGENTS.md generation falls back to the manual template.

---

## Quality Gates

- Hooks must be installed before any other step completes
- harness.json must contain `registeredSkillCount` matching actual skill count
- CLAUDE.md must not lose existing content
- Demo must run on real user code, not a canned example
- Reference card must show accurate skill and hook counts
- Closing line must confirm hooks are live

## Exit Protocol

Do not output a HANDOFF block. Setup is the beginning.
After the closing line, wait for the user's next command.
