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
| `harness.json.md` | Strip frontmatter → `.claude/harness.json` (Citadel's shared config path for all runtimes, including Codex) |

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

Hooks must be live before anything else. Run `node {citadel-root}/scripts/install-hooks.js`. Find `{citadel-root}`: read `.citadel/plugin-root.txt`; fallback: directory containing this SKILL.md. The installer resolves the current config (or the bootstrap Standard + Core + Persistence default), writes `.citadel/effective-config.json`, installs only hooks owned by effective bundles, preserves non-Citadel settings, and is idempotent.

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

Create `.planning/tmp/citadel-stack.json` with only the detected compatibility
fields below. This input is not authoritative and must not contain profile,
bundle, consent, trust, or policy fields:

```json
{
  "language": "typescript",
  "framework": "react",
  "packageManager": "npm",
  "typecheck": { "command": "npx tsc --noEmit", "perFile": false, "timeoutMs": 25000 },
  "test": { "command": "npm test", "framework": "vitest" },
  "qualityRules": { "builtIn": ["no-confirm-alert", "no-transition-all"], "custom": [] },
  "protectedFiles": [".claude/harness.json", ".claude/settings.json"],
  "features": { "intakeScanner": true, "telemetry": true },
  "registeredSkills": ["do", "review"],
  "registeredSkillCount": 2,
  "agentTimeouts": { "skill": 600000, "research": 900000, "build": 1800000 }
}
```

Substitute the detected values and complete skill list; use JSON `null` when no
framework or test framework is detected.

Preview the deterministic version-2 config migration without writing:

```bash
node {citadelRoot}/scripts/citadel-config.js initialize \
  --input .planning/tmp/citadel-stack.json --runtime {claude-code|codex|opencode} --json
```

Show profile, bundles, source/candidate digests, and changed fields. Apply only
after the selected setup mode authorizes this exact plan:

```bash
node {citadelRoot}/scripts/citadel-config.js initialize \
  --input .planning/tmp/citadel-stack.json --runtime {claude-code|codex|opencode} --apply --json
```

Recommended and Express use `standard@1.0.0` with Core + Persistence. Full Tour
may preview Parallel and Operations, but each bundle needs an explicit enable
plan. If the runtime is partial, show the named adapter and require
`--allow-degraded-runtime`; never silently describe degraded support as full.
Delivery remains off until the user explicitly enables it.

The apply creates a sibling backup when replacing an existing config, validates
the observed digest, rolls back a failed write, and reconciles
`.citadel/effective-config.json`. Re-run `install-hooks.js` after the final
bundle choice so disabled hook families are removed from the generated runtime
projection.

Note: `perFile` applies to Python checkers only; TypeScript always runs a project-scope incremental check and ignores `perFile` with an advisory.

**Skill registry rebuild:** populate `registeredSkills` from every directory under `{citadelRoot}/skills/` plus `.claude/skills/`. Set `registeredSkillCount` to match.

**Routing table regeneration:** run `node {citadelRoot}/scripts/generate-routing.js`, then verify with `node {citadelRoot}/scripts/generate-routing.js --check` — exit 0 means all routing surfaces are in sync (what it regenerates: docs/SETUP_REFERENCE.md#routing-surfaces). If the script is missing (older Citadel install), skip this step silently.

**Dependency pattern suggestions (Recommended + Full Tour only):** read package.json for `@tanstack/react-query`, `zustand`, `date-fns`, `zod`. For each match ask: `"I see {package} installed. Warn agents when they use {anti-pattern}? [y/n]"` and add accepted patterns to `dependencyPatterns` in harness.json (anti-pattern and message table: docs/SETUP_REFERENCE.md#dependency-pattern-suggestions).

### Step 4: CLAUDE.md + AGENTS.md (all modes)

Run `node {citadelRoot}/scripts/bootstrap-project-guidance.js --project-root {projectRoot}` — creates `.citadel/project.md` and compatible `CLAUDE.md` plus `AGENTS.md` guidance. Safe to run — it preserves user-authored files.

Claude Code v2.1.277 or later can use only `AGENTS.md`, but the version alone does not prove the built-in support is available in the current environment. When the operator has confirmed the **Project instructions** setting or an `AGENTS.md loaded` startup notice, run `node {citadelRoot}/scripts/bootstrap-project-guidance.js --project-root {projectRoot} --claude-agents-md-supported`. The script detects the installed Claude Code version, migrates only byte-for-byte unchanged Citadel guidance, and retains `CLAUDE.md` when the version or capability is unknown or project guidance would take precedence.

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

### Step 5b: CROSS-CLONE MEMORY (Recommended + Full Tour only)

Run `node {citadelRoot}/scripts/repository-memory.js status --project-root {projectRoot} --json`.

- Already `enabled`: report the stored file/version counts and do not prompt.
- `unavailable`: skip the prompt; this optional capability requires Node.js 22.13+.
- Otherwise ask: `"Preserve completed Citadel lessons across disposable clones in a local user-level SQLite database? [y/N]"`

On yes, run:

```bash
node {citadelRoot}/scripts/repository-memory.js enable --project-root {projectRoot}
```

State exactly what is stored: completed campaigns, postmortems, research,
discoveries, backlog Markdown, and `.citadel/project.md`. State what is excluded:
active work, telemetry, worktrees, consent, runtime config, and credentials. Raw
remote URLs and clone paths are excluded as identity metadata, but allowlisted
documents are stored verbatim and may mention either. Express mode never opts in
automatically, but an already-enabled repository continues to restore and sync
through lifecycle hooks.

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

**harness.json is protected and Write tool is blocked:** Do not bypass the hook.
Use the plan-first `citadel-config.js initialize` flow above.

**Existing CLAUDE.md with no blank line at end:** Append newline before `## Citadel Harness` section.

**Stack detection fails entirely:** Fall back to: `"What's your primary language? (typescript / javascript / python / go / rust / other)"`

**Re-running setup on configured project (Update mode):** Show diff of what would change. Don't silently overwrite. Confirm each change.

**`bootstrap-project-guidance.js` not found:** Skip silently — fall back to manual CLAUDE.md template.

## Contextual Gates

**Disclosure:** "Configuring Citadel for this project. Will preview a versioned config, reconcile the effective receipt, and install hooks owned by the selected bundles."
**Reversibility:** amber. Writes receipted config/hook state and creates `.planning/`; undo through `node scripts/adopt.js leave plan --target . --out ../citadel-leave.plan.json`, then apply that reviewed plan with its exact token
**Trust gates:**
- Any: first-run configuration; expected to modify settings and install hooks

## Quality Gates

- Hooks must be installed before any other step completes
- harness.json must validate as schema v2 and contain `registeredSkillCount` matching actual skill count
- `.citadel/effective-config.json` must be current for the harness source digest
- installed hooks must belong only to effective bundles
- CLAUDE.md must not lose existing content
- Demo must run on real user code, not a canned example
- Reference card must show accurate skill and hook counts
- Closing line must confirm hooks are live

## Exit Protocol

Do not output a HANDOFF block. Setup is the beginning.
After the closing line, wait for the user's next command.
