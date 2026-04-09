---
name: do
description: >-
  Unified router that auto-routes user intent to the right orchestrator or skill.
  Classifies input by scope, complexity, persistence needs, and parallelism, then
  dispatches to the cheapest path that can handle it: direct command, skill, marshal,
  archon, or fleet. Single entry point for all work.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-20
---

# /do — Unified Intent Router

## Identity

You are the single entry point for all work. The user says what they want.
You figure out which orchestrator or skill handles it. No more choosing between
`/marshal`, `/archon`, `/fleet`, or individual skills.

## Orientation

Use `/do` when the user wants something done but doesn't know (or care) which
tool handles it. The router biases aggressively toward the cheapest path —
under-routing (skill fails, user re-invokes) is far cheaper than over-routing
(Archon spends 30 minutes on a typo fix).

## Commands

| Command | Behavior |
|---|---|
| `/do [anything]` | Classify intent, route to cheapest capable path |
| `/do status` | Show full harness dashboard (/dashboard) |
| `/do continue` | Resume most recent active campaign or fleet session |
| `/do --list` | Show all skills grouped by category with trigger keywords |
| `/do setup` | First-run experience — configure the harness for this project |

## Protocol

Classification runs top-to-bottom. First match wins. Each tier is cheaper than the next.

### Step 0: Skill Registry Check (Cost: ~0 on hit | ~50 tokens on miss)

Before routing, check if new skills have been added since last registration.

1. Count installed Citadel skills (built-in from plugin + custom in project's `.claude/skills/`)
2. Read `registeredSkillCount` from `.claude/harness.json`
3. **If counts match**: continue to Tier 0. Zero cost.
4. **If counts differ** (or harness.json doesn't exist yet):
   a. Read the `registeredSkills` array from harness.json (default: `[]`)
   b. Diff skill names against the registered list
   c. For each unknown skill: read ONLY lines 1-10 of its `SKILL.md` (frontmatter)
   d. Extract `name` and `description` from frontmatter
   e. Add the skill to the Tier 2 keyword table for this session using its
      `name` and `description` words as match targets
   f. Log to the user: `"Discovered {N} new skill(s): {names}. Run /do setup to permanently register routing keywords."`
   g. Update `registeredSkillCount` and `registeredSkills` array in harness.json

**This means:**
- 99% of invocations: one number comparison, zero file reads
- New skill dropped in: reads only the new frontmatter, routes immediately
- `/do setup` does a full registry rebuild with permanent keyword assignment

### Tier 0: Pattern Match (Cost: ~0 tokens | Latency: <1ms)

Regex/keyword on raw input. Catches trivial commands:

| Pattern | Action |
|---|---|
| "typecheck" or "type check" | Run the project's typecheck command |
| "build" | Run the project's build command |
| "test" or "tests" | Run the project's test command |
| "status", "dashboard", "what's happening", "what's going on", "show activity" | Show full harness dashboard (/dashboard) |
| "continue" or "keep going" | Resume active campaign or fleet session |
| "setup" | Run `/do setup` first-run experience |
| "--list" or "list" | Show all available skills |
| "fix typo in X" or "rename X to Y" | Direct edit (no orchestrator needed) |
| "commit" | Stage and commit changes |
| "rollback", "undo phase", "restore checkpoint" | Find active campaign, read latest checkpoint ref, run git stash pop |

If matched → execute directly. Done.

### Tier 1: Active State Short-Circuit (Cost: ~0 tokens | Latency: <100ms)

Check for active campaigns or fleet sessions that match the input scope:

1. Read `.planning/campaigns/` for files with `Status: active` or `status: active` in frontmatter
2. Read `.planning/fleet/` for session files with `status: active` or `needs-continue`
3. **Improve campaigns (type: improve):** if the active campaign has `type: improve` in
   frontmatter, route to `/improve {target} --continue` where `{target}` is the campaign's
   `target` field. Do NOT route improve campaigns to archon -- improve is its own orchestrator.
4. If input scope matches a non-improve active campaign → `/archon continue`
5. If fleet session needs continuation → `/fleet continue`
6. If input mentions a campaign by name → resume it (check type field for routing)
7. **If input is "continue" but NO active campaign or fleet session found:**
   - Output: "No active campaign or fleet session found. Nothing to continue."
   - **If `.planning/daemon.json` exists with `status: "running"`:** the daemon spawned
     this session but there's no work to do. Update daemon.json:
     `status: "stopped"`, `stopReason: "no-active-work"`,
     `stoppedAt: "{ISO timestamp}"`. Delete both triggers if IDs are present.
     Output: "[daemon] Stopped -- no active campaign found. The work is done."
   - Exit. Do NOT fall through to Tier 2 or 3.

If matched → resume the active work. Done.

### Tier 2: Skill Keyword Match (Cost: ~0 tokens | Latency: <10ms)

Match input against installed skill keywords from Citadel's built-in skills
and any project-level custom skills in `.claude/skills/`.

**Built-in skill triggers:**

| Input Contains | Route To |
|---|---|
| "prd", "requirements", "spec", "plan an app", "design an app" | `/prd` |
| "architect", "architecture", "design the system", "file structure", "plan the build" | `/architect` |
| "create app", "build app", "build me", "make an app", "new app", "generate app" | `/create-app` |
| "add [feature]", "implement [feature]", "add auth", "add payments", "integrate [x]" | `/create-app` (Tier 5 — feature mode) |
| "review", "code review" | `/review` |
| "test", "generate tests", "write tests" | `/test-gen` |
| "document", "docs", "docstring", "readme" | `/doc-gen` |
| "refactor", "rename", "extract", "split file" | `/refactor` |
| "scaffold", "new module", "new component", "bootstrap" | `/scaffold` |
| "create skill", "new skill", "repeated pattern" | `/create-skill` |
| "handoff", "session summary" | `/session-handoff` |
| "orchestrate", "chain skills", "multi-step" | `/marshal` |
| "campaign", "multi-session", "phases" | `/archon` |
| "parallel", "simultaneous", "multiple agents", "at the same time", "both ... and" | `/fleet --quick` |
| "intake", "process pending", "pipeline" | `/autopilot` |
| "setup", "first run", "configure harness" | `/setup` |
| "research", "investigate", "look into", "find out" | `/research` |
| "experiment", "optimize", "try", "A/B", "measure" | `/experiment` |
| "debug", "root cause", "diagnose", "why is", "investigate bug" | `/systematic-debugging` |
| "research fleet", "parallel research", "multi-angle research", "compare options" | `/research-fleet` |
| "preview", "screenshot", "visual check", "does it render" | `/live-preview` |
| "postmortem", "retro", "what broke", "what happened", "debrief" | `/postmortem` |
| "design", "style guide", "design manifest", "visual consistency" | `/design` |
| "qa", "test the app", "click through", "does it work", "browser test" | `/qa` |
| "triage", "open issues", "unlabeled issues", "review pr", "review prs", "investigate issue" | `/triage` |
| "watch pr", "watch ci", "monitor pr", "fix ci", "ci failing", "pr failing", "auto-fix", "auto fix pr", "pr is red", "checks failing" | `/pr-watch` |
| "dashboard", "what's happening", "what's going on", "show activity", "harness state", "show me status" | `/dashboard` |
| "learn", "extract patterns", "learn from that", "save what worked", "patterns from campaign" | `/learn` |
| "schedule", "recurring", "every N minutes", "cron", "set a reminder", "run periodically" | `/schedule` |
| "merge review", "check merges", "any conflicts", "fleet conflicts", "pending branches", "safe to merge" | `/merge-review` |
| "ascii diagram", "ascii art", "box diagram", "architecture diagram", "flow diagram", "draw a diagram", "text diagram", "sequence diagram" | `/ascii-diagram` |
| "improve", "improvement loop", "quality loop", "rubric", "score against", "run improvement", "improve citadel" | `/improve` |
| "organize", "directory structure", "folder structure", "project structure", "file organization", "where should this go", "cleanup directories" | `/organize` |
| "houseclean", "house clean", "disk space", "free space", "drive full", "running out of space", "clean up disk", "clean worktrees", "disk audit", "storage audit", "move to another drive", "free up space", "c drive full", "orphaned worktrees" | `/houseclean` |
| "daemon", "continuous", "run overnight", "keep running", "24/7", "unattended", "run autonomously", "daemon start", "daemon stop", "daemon status" | `/daemon` |
| "map", "index codebase", "codebase map", "structural index", "scan codebase", "map stats", "map query" | `/map` |
| "watch", "watch files", "watch changes", "file sentinel", "monitor files", "watch start", "watch stop", "watch scan", "marker comments", "@citadel" | `/watch` |
| "infra", "infrastructure", "what databases", "what systems", "docker-compose", "infra audit", "map infrastructure", "what does this connect to" | `/infra-audit` |
| "workspace", "multi-repo", "cross-repo", "across repos", "multiple repos", "coordinate repos", "add redis and snowflake", "split into repos" | `/workspace` |

If ONE skill matches with high confidence → invoke it directly. Done.
If MULTIPLE skills match → fall through to Tier 3.

### Tier 3: LLM Complexity Classifier (Cost: ~500 tokens | Latency: ~1-2s)

When Tiers 0-2 don't resolve, classify across 6 dimensions:

```
SCOPE: single-file | single-domain | cross-domain | platform-wide
COMPLEXITY: 1 (trivial) | 2 (simple) | 3 (moderate) | 4 (complex) | 5 (campaign)
INTENT: fix | build | create | add | audit | redesign | research | improve | wire | prune
REQUIRES_PERSISTENCE: true | false (multi-session?)
REQUIRES_PARALLEL: true | false (independent sub-tasks?)
REQUIRES_TASTE: true | false (quality judgment beyond tests?)
```

**Routing rules (first match wins):**

| Condition | Route |
|---|---|
| INTENT is "create", Complexity >= 3 | `/create-app` |
| INTENT is "create", Complexity <= 2 | `/scaffold` |
| INTENT is "add", existing source files present | `/create-app` (Tier 5 — feature mode) |
| INTENT is "add", no existing source files | `/scaffold` |
| Complexity 1, single skill match | Skill directly |
| Complexity 1, no skill match | Do it yourself (direct edit) |
| Complexity 2, single domain | `/marshal` |
| Complexity 2-3, known skill domain | Skill, with marshal fallback |
| Complexity 3, cross-domain | `/marshal` |
| Complexity 3-4, requires persistence | `/archon` |
| Complexity 4, requires taste/judgment | `/archon` |
| Complexity 4-5, requires parallel | `/fleet` |
| Complexity 5, platform-wide | `/fleet` |
| Confidence < 0.7 | `/marshal` (safe default) |

**Important:** A repeated pattern complaint ("I keep doing X manually", "the agent
always makes this mistake") should route to `/create-skill`. A repeated pattern
is a skill waiting to be extracted.

### Step 3.5: Proportionality Check

After classification and before execution, verify the response is proportional to the input:

**Downgrade triggers (apply in order):**

| Condition | Action |
|---|---|
| Input < 20 words AND routed to Archon or Fleet | Downgrade to Marshal. Log: "Input too brief for campaign-level orchestration." |
| Input mentions a single file AND routed to Fleet | Downgrade to Marshal or skill. Log: "Single-file scope doesn't warrant parallel agents." |
| Estimated sessions > 5 AND user is Novice trust level | Cap at 3 sessions. Log: "Capping sessions for novice user. Run more to unlock higher budgets." |
| Routed to Daemon AND user is Novice trust level | Block. Output: "Daemon mode requires familiarity with the harness. Complete a few sessions first." |
| Estimated cost > $50 AND no explicit budget flag | Confirm with user regardless of trust level. |

**Upgrade triggers:**

| Condition | Action |
|---|---|
| Input complexity >= 4 AND routed to a bare skill | Suggest Marshal. "This looks complex enough for orchestration. Route to /marshal instead?" |
| Input mentions "overnight" or "continuous" AND routed to Archon | Suggest daemon. "This sounds like continuous work. Want to run it as a daemon?" (skip if Novice) |
| Input contains 2+ clearly independent tasks AND complexity >= 3 | Run Fleet auto-decomposition (see below). |

**Fleet auto-decomposition — 1/2/3 confirmation prompt:**

When `/do` detects two or more tasks with non-overlapping file scopes and complexity >= 3,
check the stored Fleet preference before routing:

Read `consent.fleetSpawn` from harness.json via `readConsent('fleetSpawn')`:
- `auto-allow` → skip prompt, route directly to `/fleet --quick`
- `always-ask` or `null` (first encounter) → show the prompt below

```
These look independent — I could run them in parallel:
  1. {task A description}
  2. {task B description}

Run in parallel? [1=yes  2=always  3=no]
```

Handle the response:
- **1 (yes once):** Route to `/fleet --quick`. Preference unchanged.
- **2 (always):** Route to `/fleet --quick`. Write preference: `writeConsent('fleetSpawn', 'auto-allow')`.
- **3 (no):** Run sequentially. If user adds "don't ask again", write `writeConsent('fleetSpawn', 'always-ask')`.

`readConsent` and `writeConsent` are in `hooks_src/harness-health-util.js`. Import them via
`require('../hooks_src/harness-health-util')` when running as a Node script, or reference
them conceptually when routing as an LLM skill (use `node -e "..."` to read/write via Bash).

This check only fires when:
- Two or more independent tasks detected (different files/domains)
- Complexity is 3+ (not trivial single-step work)
- Not already routed to full Fleet (complexity 4+)

**Trust level integration:**
Read trust level from `harness.json` (via the `trust` object):
- Compute level: novice (0-4 sessions), familiar (5-19), trusted (20+ with 2+ campaigns)
- If `trust.override` is set, use that level
- Apply the trust-gated rules from the tables above

### Step 4: After Classification

1. **Log the routing decision to telemetry** (cost: ~0, fire-and-forget):
   ```bash
   node .citadel/scripts/telemetry-log.cjs --event agent-complete --agent do-router --session routing --status success --meta '{"tier":N,"target":"[skill-name]","input_chars":M}'
   ```
   Where:
   - `N` = the tier number that matched (0, 1, 2, or 3)
   - `[skill-name]` = the target skill or orchestrator being invoked (e.g., "marshal", "archon", "commit")
   - `M` = character count of the user's input (use `input.length` conceptually — approximate is fine)

   Use `.citadel/scripts/telemetry-log.cjs` (the project-local copy). If it doesn't exist, skip logging silently — never block routing on telemetry failure.

2. **Announce the routing decision**: "Routing to [target] because [one-sentence reason]"
3. **Invoke the target** skill or orchestrator
4. If the target fails or the user says "wrong tool", try the next tier up

## /do status

Routes directly to `/dashboard`. `/do status` is an alias — invoke `/dashboard`
and display its full output. See `skills/dashboard/SKILL.md` for the complete
protocol and output format.

## /do --list

List all installed skills (Citadel built-in + project custom):

```
=== Installed Skills ===

ORCHESTRATION
  /do [intent]          Universal router
  /marshal [direction]  Single-session orchestrator
  /archon [direction]   Multi-session campaigns
  /fleet [direction]    Parallel campaigns with coordination safety
  /workspace [direction] Multi-repo campaign coordinator (fleet, one level up)
  /autopilot            Intake-to-delivery pipeline

APP CREATION
  /prd                  Product requirements document
  /architect            Implementation architecture from PRD
  /create-app           End-to-end app creation (5 tiers, greenfield or existing codebase)

SKILLS
  /review               5-pass structured code review
  /test-gen             Generate tests that actually run
  /doc-gen              Documentation generation (3 modes)
  /refactor             Safe multi-file refactoring
  /scaffold             Project-aware scaffolding
  /create-skill         Create new skills from patterns

RESEARCH & DEBUGGING
  /research             Structured investigation with findings
  /research-fleet       Parallel multi-scout research
  /experiment           Metric-driven optimization loops
  /systematic-debugging Root cause analysis (4-phase)
  /live-preview         Mid-build visual verification

QUALITY & VERIFICATION
  /improve [target]     Autonomous quality engine -- score, select, attack, verify, loop
  /design               Design manifest generator (extract or generate)
  /qa                   Browser QA via Playwright (optional dependency)
  /postmortem           Campaign postmortem from telemetry + git history

GITHUB & CI
  /triage [issue|pr]    GitHub issue and PR investigator
  /pr-watch [number]    Local PR auto-fix — watches CI, fixes failures, offers merge

INFRASTRUCTURE
  /infra-audit          Map current infrastructure from config files, flag opportunities
  /workspace [direction] Coordinate campaigns across multiple repos

MONITORING & ORGANIZATION
  /watch [command]      File sentinel — detects changes and @citadel: markers, routes to skills
  /organize [--audit]   Directory convention scanner, enforcer, and cleanup
  /houseclean           Cross-drive storage audit: worktrees, AI caches, project artifacts

UTILITIES
  /session-handoff      Session context transfer
  /setup                First-run harness configuration
  /schedule [action]    Manage recurring tasks (CronCreate/Delete/List)
  /merge-review         Fleet worktree merge conflict analysis
  /ascii-diagram        Perfectly aligned ASCII diagrams via character grid
  /do rollback          Restore to last campaign checkpoint (git stash pop)

OBSERVABILITY & LEARNING
  /dashboard            Real-time harness dashboard — campaigns, events, health
  /learn                Extract patterns from completed campaigns into knowledge base

Direct invocation (/skill-name) always bypasses the router.
```

## Escape Hatches

Direct invocation ALWAYS works and bypasses the router:
- `/marshal [thing]` — force Marshal
- `/archon [thing]` — force Archon
- `/fleet [thing]` — force Fleet
- `/[skill-name]` — force specific skill

The router is additive, not a gate. Power users who know what they want
should use direct invocation.

## Fringe Cases

- **`.planning/` does not exist**: The router works without `.planning/`. Tiers 0, 2, and 3 are fully independent of it. Tier 1 (active-state short-circuit) reads `.planning/campaigns/` and `.planning/fleet/` — if those directories are absent, skip Tier 1 gracefully and fall through to Tier 2. Never crash on a missing `.planning/` directory.
- **`harness.json` missing**: Skip the Skill Registry Check and proceed directly to Tier 0. Announce discovered skills from the filesystem if counts can be read, otherwise route from built-in keywords.
- **Multiple skills match at Tier 2**: Fall through to Tier 3 for disambiguation rather than picking arbitrarily.
- **User input is empty or whitespace**: Respond with the `--list` output and a prompt to provide a direction.
- **Routed skill not found**: Report "Skill not found" and fall back to Marshal as the safe default.

## Quality Gates

- Tier 0-2 must resolve in under 1 second
- Tier 3 classification must be transparent (announce reasoning)
- Never route a trivial task (complexity 1) to Archon or Fleet
- Never route a multi-session task to a bare skill
- If routing fails, default to Marshal (safe middle ground)

## Exit Protocol

After routing and execution complete:
- If the routed skill/orchestrator produces a HANDOFF, relay it to the user
- If the task was trivial (Tier 0), just show the result
- Do not add overhead to simple tasks
- Telemetry is fire-and-forget — never surface telemetry errors to the user
