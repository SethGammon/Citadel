---
name: setup
license: MIT
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

Configures the harness for a specific project: installs hooks, detects stack, writes harness.json, and optionally demos the system on real code. Flag: `/do setup --express` skips mode selection and runs Express directly. Reference tables and layouts: docs/SETUP_REFERENCE.md.

## Orientation

**Use when:** first-run configuration of Citadel on a new project -- installs hooks, generates harness.json, scaffolds .planning/.
**Don't use when:** harness is already configured and you want to verify it (use /verify); adding a single skill to an existing project (copy SKILL.md manually).

## Protocol

### Step -1: ARCHIVE DETECTION (all modes, before anything else)

Run `ls docs/citadel/ 2>/dev/null`. If `docs/citadel/` exists and contains `.md` files with `citadel-archive: true` in frontmatter, extract the `exported-at` date and prompt once:

```
Found a Citadel archive from {exported-at date}.
  Campaigns: {N}  Postmortems: {N}  Backlog items: {N}  Research: {N}

Restore history into .planning/ during setup? [Y/n]
```

Y or Enter → set `restoreArchive = true`, restore after Step 1 (below). n → skip silently. No archive found → skip entirely, no output.

**ARCHIVE RESTORE** (runs after Step 1 if `restoreArchive = true`). Splitting: each `## Section Title` becomes one restored file; strip frontmatter before writing.

| File | Restore to |
|---|---|
| `campaigns.md` | Split sections → `.planning/campaigns/completed/{name}.md` |
| `postmortems.md` | Split sections → `.planning/postmortems/{name}.md` |
| `research.md` | Split sections → `.planning/research/{name}.md` |
| `backlog.md` | Split sections → `.planning/intake/{name}.md` |
| `discoveries.md` | Split sections → `.planning/discoveries/{name}.md` |
| `project.md` | Strip frontmatter → `.citadel/project.md` |
| `harness.json.md` | Strip frontmatter → `.claude/harness.json` |

After restore: `  ✓ Archive restored — {N} campaigns, {N} postmortems, {N} backlog items`

### Step 0: MODE SELECTION

```
Welcome to Citadel.

How would you like to get started?

  [1] Recommended  — auto-detect your stack, install hooks, live demo  (~3 min)
  [2] Full Tour    — everything in Recommended + guided skill walkthrough (~8 min)
  [3] Express      — zero questions, auto-detect, hooks installed, done  (~30 sec)

Press Enter for Recommended, or type 1, 2, or 3.
```

If harness.json already exists with full config, add: `  [4] Update — reconfigure existing setup (current: {language}, {skillCount} skills)`. Default: Recommended. If `--express` flag passed: skip mode selection, run Express.

### Step 1: INSTALL HOOKS (all modes, always first)

Hooks must be live before anything else. Run `node {citadel-root}/scripts/install-hooks.js`. Find `{citadel-root}`: read `.citadel/plugin-root.txt`; fallback: directory containing this SKILL.md. The installer reads `hooks/hooks-template.json`, resolves absolute paths, writes into `.claude/settings.json`, preserves non-Citadel settings, is idempotent.

**On success:** `  ✓ {N} hooks installed (protect-files, external-gate, circuit-breaker, quality-gate + more)`
**On failure:** output the error, explain manual install path (`node /path/to/Citadel/scripts/install-hooks.js`), continue — setup must not abort.

### Step 2: STACK DETECTION (all modes)

Auto-detect by scanning the project root. Never ask what can be read. (Readable tables: docs/SETUP_REFERENCE.md#stack-detection-tables.)

- **Language** (check in order): `tsconfig.json` → TypeScript; `package.json` without tsconfig → JavaScript; `requirements.txt` or `pyproject.toml` → Python; `go.mod` → Go; `Cargo.toml` → Rust; `pom.xml` or `build.gradle` → Java
- **Framework** (package.json dependencies): `next` → Next.js; `react` (no next) → React; `vue` → Vue; `svelte` → Svelte; `@angular/core` → Angular; `express` → Express; `fastify` → Fastify
- **Package manager**: `pnpm-lock.yaml` → pnpm; `yarn.lock` → yarn; `bun.lockb` → bun; `package-lock.json` → npm; `requirements.txt` → pip; `Pipfile` → pipenv
- **Test framework**: package.json devDependencies for `jest`, `vitest`, `mocha`, `jasmine`; Python: `pytest` in requirements.txt or pyproject.toml
- **Typecheck by language**: TypeScript `npx tsc --noEmit` (per-file: no, project-scope incremental); Python `mypy {file}` or `pyright {file}` (per-file: yes); Go `go vet ./...`, Rust `cargo check`, JavaScript none (per-file: no)

**Confirmation (Recommended + Full Tour only):** output `Detected: {language}{+ framework if any} · {packageManager} · {testFramework if any}`, then `Correct? [y/n/edit]`. y/Enter → proceed; n/edit → ask for corrections inline. Express: skip confirmation, use detected values.

### Step 3: GENERATE CONFIG (all modes)

Write `.claude/harness.json` using Node (not Write tool — harness.json is protected after first install):

```javascript
node -e "
const fs = require('fs');
const existing = fs.existsSync('.claude/harness.json') ? JSON.parse(fs.readFileSync('.claude/harness.json', 'utf8')) : {};
const skillDirs = fs.readdirSync('{citadelRoot}/skills', { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
const config = {
  language: '{detected}', framework: '{detected or null}', packageManager: '{detected}',
  typecheck: { command: '{command}', perFile: {bool}, timeoutMs: 25000 },
  test: { command: '{testCommand}', framework: '{testFramework}' },
  qualityRules: { builtIn: ['no-confirm-alert', 'no-transition-all'], custom: [] },
  protectedFiles: ['.claude/harness.json', '.claude/settings.json'],
  features: { intakeScanner: true, telemetry: true },
  registeredSkills: skillDirs, registeredSkillCount: skillDirs.length,
  agentTimeouts: { skill: 600000, research: 900000, build: 1800000 },
  trust: { sessionCount: existing.trust?.sessionCount || 0, campaignCount: existing.trust?.campaignCount || 0, level: existing.trust?.level || 'novice' },
  ...existing  // preserve consent, storage, policy
};
fs.writeFileSync('.claude/harness.json', JSON.stringify(config, null, 2));
"
```

Note: `perFile` applies to Python checkers only; TypeScript always runs a project-scope incremental check and ignores `perFile` with an advisory.

**Skill registry rebuild:** populate `registeredSkills` from every directory under `{citadelRoot}/skills/` plus `.claude/skills/`. Set `registeredSkillCount` to match.

**Routing table regeneration:** run `node {citadelRoot}/scripts/generate-routing.js`, then verify with `node {citadelRoot}/scripts/generate-routing.js --check` — exit 0 means all routing surfaces are in sync (what it regenerates: docs/SETUP_REFERENCE.md#routing-surfaces). If the script is missing (older Citadel install), skip this step silently.

**Dependency pattern suggestions (Recommended + Full Tour only):** read package.json for `@tanstack/react-query`, `zustand`, `date-fns`, `zod`. For each match ask: `"I see {package} installed. Warn agents when they use {anti-pattern}? [y/n]"` and add accepted patterns to `dependencyPatterns` in harness.json (anti-pattern and message table: docs/SETUP_REFERENCE.md#dependency-pattern-suggestions).

### Step 4: CLAUDE.md + AGENTS.md (all modes)

Run `node {citadelRoot}/scripts/bootstrap-project-guidance.js --project-root {projectRoot}` — creates `.citadel/project.md` and generates `CLAUDE.md` and `AGENTS.md`. Safe to run — only creates files that don't exist.

**Project description (Recommended + Full Tour only):** ask `"What's this project? One line is fine — or press Enter to use the package name."` Skip if CLAUDE.md already exists with content.

**CLAUDE.md merge rules:**
- Does not exist → generate the starter from docs/SETUP_REFERENCE.md#claudemd-starter-template: project name, description, Stack section (detected values), placeholder Conventions and Architecture sections, and a `## Citadel Harness` section noting the harness and `.claude/harness.json`
- Exists, no `## Citadel Harness` section → append that section at bottom only
- Exists with `## Citadel Harness` → skip, don't duplicate
- NEVER overwrite or delete existing content

### Step 5: OPTIONAL INTEGRATIONS (Recommended + Full Tour only)

Present as one prompt:

```
Optional integrations — choose any, or press Enter to skip all:
  [g] GitHub    — scaffold Claude triage workflow for issues + PRs
  [m] MCP       — create .mcp.json with common servers pre-configured
  [b] Both
  [s] Skip
```

**GitHub:** create `.github/workflows/` if missing; copy `.planning/_templates/claude-triage.yml` → `.github/workflows/claude-triage.yml` and `.planning/_templates/REVIEW.md` → `REVIEW.md` (skip any that already exist). Output: `"Add ANTHROPIC_API_KEY to Settings > Secrets > Actions to activate."`
**MCP:** copy `.planning/_templates/.mcp.json` → `.mcp.json` (skip if exists). Output: `"Edit .mcp.json to uncomment the servers you want."`

### Step 6: LIVE DEMO (Recommended + Full Tour only)

**Find target file:** `git diff --name-only HEAD~1 HEAD 2>/dev/null | head -5`, filter for source files, use the most recently changed. If no git history, use `find` for recently modified files.

**Pain point question:**

```
What's your biggest frustration with AI coding tools right now?

  [a] Repetitive context — I keep re-explaining my codebase
  [b] Quality — the agent breaks things or misses issues
  [c] Context loss — every new session starts from zero
  [d] Scale — fine for small tasks, falls apart on big ones
  [e] Something else / skip demo
```

**Demo by pain point** — execute on real code, show output:
- **(a)** run `/review` on target file — "This review uses the harness.json config you just set up — it already knows your stack, conventions, and quality rules."
- **(b)** run `/review` on target file — "The quality-gate hook just ran on every edit made during setup. Here's what that looks like on your code:"
- **(c)** show `.planning/` structure, explain campaigns — "Sessions now persist. Start a campaign today, close your laptop, resume tomorrow."
- **(d)** run `/review` on largest source file — "For bigger work: `/marshal` for multi-step sessions, `/archon` for multi-day campaigns, `/fleet` for parallel agents."
- **(e)** skip demo, continue to reference card

### Step 7: FULL TOUR WALKTHROUGH (Full Tour only)

Present the five skill families in order, using the per-skill one-liners and timings from docs/SETUP_REFERENCE.md#full-tour-walkthrough:

1. **Code Quality** (2 min): `/review`, `/test-gen`, `/systematic-debugging` — show by running `/review` on the Step 6 file if not already done
2. **Building** (2 min): `/scaffold`, `/refactor`, `/create-skill`
3. **Research** (1 min): `/research` (add `--parallel` for multi-scout), `/infra-audit`
4. **Orchestration** (1 min): `/marshal`, `/archon`, `/fleet`
5. **Observability** (1 min): `/do next`, `/dashboard`, `/cost`, `/learn`

After walkthrough: `That's the system. Everything routes through /do — you never have to choose the right tool.`

### Step 8: REFERENCE CARD (all modes)

Print the reference card using the canonical boxed layout at docs/SETUP_REFERENCE.md#reference-card, filled with actual counts from the detected config. It must contain, in order:

- Header: `CITADEL READY` — {N} skills · {N} hooks live · {language}{+ framework}
- THE ONE COMMAND: `/do [anything]` — describe what you want in plain English, the router handles the rest
- COMMON STARTING POINTS: `/do review [file]`, `/do fix [description]`, `/do why is [thing] broken`, `/do build [feature]`, `/do test [file]`, `/do next`, `/do status`, `/do continue`
- WHEN TASKS GET BIGGER: `/marshal` (multi-step, one session), `/archon` (multi-session campaign), `/fleet` (parallel agents)
- WHAT'S NOW PROTECTING YOUR SESSION: protect-files, external-gate, circuit-breaker, quality-gate, telemetry
- NEXT STEPS: add conventions to CLAUDE.md, `/do --list`, `/create-skill`, `/improve [target]`
- Footer: `docs/SKILLS.md · INSTALL.md · /do --list`

**Express mode**: print abbreviated card (THE ONE COMMAND + WHAT'S NOW PROTECTING only).

### Step 9: CLOSING LINE (all modes)

```
Express:      Done. {N} hooks live, {N} skills registered.
              Type /do [anything] to start.

Recommended:  Setup complete. Citadel is configured for {language}{+ framework}.
              {N} hooks are protecting this session. {N} skills are registered.
              Type /do [anything] to get started — or /do --list to browse all skills.

Full Tour:    Tour complete. You've seen the full system.
              {N} hooks live · {N} skills registered · trust level: {level}
              The best next thing: /do "review the most important file in this codebase"

Update:       Configuration updated. {N} hooks reinstalled, {N} skills re-registered.
              Changes: {list what changed vs previous config}
```

## Fringe Cases

**Plugin not found (`.citadel/plugin-root.txt` missing):** Prompt for Citadel install path. Write answer to `.citadel/plugin-root.txt`.

**Project has no source files:** Skip demo. Output: `"Once you have code, try /review [file] to see the harness in action."`

**harness.json is protected and Write tool is blocked:** Use `node -e "..."` via Bash — Node script bypasses the Write hook, which is correct since setup is the authorized path.

**Existing CLAUDE.md with no blank line at end:** Append newline before `## Citadel Harness` section.

**Stack detection fails entirely:** Fall back to: `"What's your primary language? (typescript / javascript / python / go / rust / other)"`

**Re-running setup on configured project (Update mode):** Show diff of what would change. Don't silently overwrite. Confirm each change.

**`bootstrap-project-guidance.js` not found:** Skip silently — fall back to manual CLAUDE.md template.

## Contextual Gates

**Disclosure:** "Configuring Citadel for this project. Will modify `.claude/settings.json` and install hooks."
**Reversibility:** amber — writes `.claude/settings.json`, installs hooks, creates `.planning/`; undo by running `/unharness`
**Trust gates:**
- Any: first-run configuration; expected to modify settings and install hooks

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
