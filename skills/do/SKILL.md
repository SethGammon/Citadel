---
name: do
license: MIT
description: >-
  Unified router that auto-routes user intent to the right orchestrator or skill.
  Classifies input by scope, complexity, persistence needs, and parallelism, then
  dispatches to the cheapest path that can handle it: direct command, skill, marshal,
  archon, or fleet. Single entry point for all work.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - route this
  - which tool
  - auto-route
  - unified router
last-updated: 2026-03-20
---

# /do — Unified Intent Router

## Orientation

Use `/do` when the user wants something done but doesn't know (or care) which tool handles it.
**Don't use when:** you know the destination — invoke /marshal, /archon, /fleet, or any skill directly.

## Commands

| Command | Behavior |
|---|---|
| `/do [anything]` | Classify intent, route to cheapest capable path |
| `/do status` | Show full harness dashboard (/dashboard) |
| `/do next` | Run the decision-first operator console for the next useful harness action |
| `/do operator` | Show the operator console without executing repairs |
| `/do preview <request>` | Show route, alternatives, boundary, and verification without executing |
| `/do continue` | Resolve and run the deterministic continuation action |
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
   f. Log to the user: `"Discovered {N} new skill(s): {names}. Run /do setup to rebuild the registry and regenerate the routing table from skill frontmatter."`
   g. Update `registeredSkillCount` and `registeredSkills` array in harness.json

**This means:**
- 99% of invocations: one number comparison, zero file reads
- New skill dropped in: reads only the new frontmatter, routes immediately
- `/do setup` rebuilds the registry and runs `node scripts/generate-routing.js`, which regenerates the Tier 2 table below from each skill's `trigger_keywords` frontmatter

### Tier 0: Pattern Match (Cost: ~0 tokens | Latency: <1ms)

Regex/keyword on raw input. Catches trivial commands:

| Pattern | Action |
|---|---|
| "typecheck" or "type check" | Run the project's typecheck command |
| "build" | Run the project's build command |
| "test" or "tests" | Run the project's test command |
| "loop", "repeat until", "retry until", "until tests pass", "max attempts" | Run `/loop` for bounded foreground repetition |
| "status", "dashboard", "what's happening", "what's going on", "show activity" | Show full harness dashboard (/dashboard) |
| "next", "what should I do next", "fix harness state", "repair harness" | Run `node scripts/operator-console.js --run`; if it stops on a skill route or human-review action, report the boundary, risk, next command, and verification profile |
| "operator", "operator console", "what's up", "what should happen next", "approval capsule" | Run `node scripts/operator-console.js`; report the decision, boundary, artifact freshness, and verification profile |
| "preview route", "route preview", "dry run route", "what would /do do" | Run `node scripts/route-preview.js -- "<request>"`; report selected route, alternatives, boundary, and verification profile |
| "continue" or "keep going" | Run `node scripts/continue-action.js --run`; invoke the returned skill route if it prints `/archon continue` or `/fleet continue` |
| "setup" | Run `/do setup` first-run experience |
| "deliver <intake-file>" | Run `node scripts/deliver.js --intake <file>` to create an evidence-backed delivery campaign |
| "deliver intake" or "deliver next intake" | Run `node scripts/deliver.js --next` to create an evidence-backed delivery campaign from the highest-priority pending intake item |
| "package delivery" or "review package" | Run `node scripts/package-delivery.js <campaign-slug>` to create a local review handoff and update campaign evidence |
| "pr ready" or "ready for review" | Run `node scripts/pr-ready.js --pr <pull-request-url> --run-verification` to produce an approval-readiness handoff |
| "--list" or "list" | Show all available skills |
| "fix typo in X" or "rename X to Y" | Direct edit (no orchestrator needed) |
| "commit" | Stage and commit changes |
| "rollback", "undo phase", "restore checkpoint" | Find active campaign, read latest checkpoint ref, run git stash pop |

If matched → execute directly. Done.

### Tier 1: Active State Short-Circuit (Cost: ~0 tokens | Latency: <100ms)

Check for active campaigns or fleet sessions that match the input scope:

0. For input exactly equivalent to `continue`, first run:
   ```bash
   node scripts/continue-action.js --run
   ```
   - If it executes a local command such as `node scripts/package-delivery.js <slug>`, report the output and stop.
   - If it returns `/archon continue`, invoke `/archon continue`.
   - If it returns `/fleet continue`, invoke `/fleet continue`.
   - If it returns no command, output "No active campaign or fleet session found. Nothing to continue."
1. Read `.planning/campaigns/` for files with `Status: active` or `status: active` in frontmatter
2. Read `.planning/fleet/` for session files with `status: active` or `needs-continue`
3. **Review-package campaigns:** if the campaign status is `needs-review-package`
   or its `review-package` Exit Evidence row is pending while prior phases are
   complete, route to `node scripts/package-delivery.js <slug>` before Archon.
4. **Improve campaigns (type: improve):** if the active campaign has `type: improve` in
   frontmatter, route to `/improve {target} --continue` where `{target}` is the campaign's
   `target` field. Do NOT route improve campaigns to archon -- improve is its own orchestrator.
5. If input scope matches a non-improve active campaign → `/archon continue`
6. If fleet session needs continuation → `/fleet continue`
7. If input mentions a campaign by name → resume it (check type field for routing)
8. **If input is "continue" but NO active campaign or fleet session found:**
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

**Built-in skill triggers** (generated from each skill's `trigger_keywords` frontmatter; edit the frontmatter, then run `node scripts/generate-routing.js` to refresh this table):

<!-- BEGIN GENERATED: routing-table -->
| Input Contains | Route To |
|---|---|
| "architect", "architecture", "design the system", "file structure", "plan the build" | `/architect` |
| "campaign", "multi-session", "phases" | `/archon` |
| "ascii diagram", "ascii art", "box diagram", "architecture diagram", "flow diagram", "sequence diagram", "draw a diagram", "text diagram" | `/ascii-diagram` |
| "intake", "process pending", "pipeline" | `/autopilot` |
| "cost", "costs", "cost breakdown", "campaign cost", "token usage", "burn rate", "model breakdown" | `/cost` |
| "create app", "build app", "build me", "make an app", "new app", "generate app", "add auth", "add payments", "integrate" | `/create-app` |
| "create skill", "new skill", "make a skill", "teach the harness", "custom skill", "my own skill", "skill for", "automate this pattern", "repeated pattern" | `/create-skill` |
| "daemon", "continuous", "run overnight", "keep running", "24/7", "unattended", "run autonomously", "daemon start", "daemon stop", "daemon status" | `/daemon` |
| "dashboard", "what's happening", "what's going on", "show activity", "harness state", "show me status" | `/dashboard` |
| "decision map", "plan this out", "figure this out", "investigation plan", "planning map" | `/decision-map` |
| "design", "style guide", "design manifest", "visual consistency" | `/design` |
| "document", "docs", "docstring", "jsdoc", "readme", "api docs" | `/doc-gen` |
| "evolve", "sustained improve", "improvement director", "research-driven improve", "multi-cycle improve", "run until done", "improve until ceiling", "keep improving", "hypothesis", "belief model", "scout agents" | `/evolve` |
| "experiment", "optimize", "try", "A/B", "measure" | `/experiment` |
| "parallel", "simultaneous", "multiple agents", "at the same time" | `/fleet --quick` |
| "grill me", "grill", "stress-test the plan", "sharpen the plan", "pressure-test", "interview me" | `/grill` |
| "houseclean", "house clean", "disk space", "free space", "c drive full", "drive full", "running out of space", "clean up disk", "orphaned worktrees", "clean worktrees", "disk audit", "storage audit", "move to another drive", "free up space" | `/houseclean` |
| "improve", "improvement loop", "quality loop", "rubric", "score against", "run improvement", "improve citadel" | `/improve` |
| "infra", "infrastructure", "what databases", "what systems", "docker-compose", "infra audit", "map infrastructure", "what does this connect to" | `/infra-audit` |
| "learn", "extract patterns", "learn from that", "save what worked", "patterns from campaign" | `/learn` |
| "preview", "screenshot", "visual check", "does it render" | `/live-preview` |
| "loop", "repeat until", "until tests pass", "until lint passes", "max attempts", "retry until" | `/loop` |
| "map", "index codebase", "codebase map", "structural index", "scan codebase", "map stats", "map query" | `/map` |
| "orchestrate", "chain skills", "multi-step" | `/marshal` |
| "merge review", "check merges", "any conflicts", "fleet conflicts", "pending branches", "safe to merge" | `/merge-review` |
| "organize", "directory structure", "folder structure", "project structure", "file organization", "organize directories", "organize files", "cleanup directories", "directory convention", "where should this go", "messy project" | `/organize` |
| "postmortem", "retro", "what broke", "what happened", "debrief" | `/postmortem` |
| "watch pr", "watch ci", "monitor pr", "fix ci", "ci failing", "pr failing", "auto-fix", "auto fix pr", "pr is red", "checks failing" | `/pr-watch` |
| "prd", "requirements", "spec", "plan an app", "design an app" | `/prd` |
| "qa", "test the app", "click through", "does it work", "browser test" | `/qa` |
| "refactor", "rename", "extract", "inline", "move file", "split file", "merge files" | `/refactor` |
| "research", "investigate", "look into", "find out", "research fleet", "parallel research", "multi-angle research", "compare options" | `/research` |
| "/review", "code review", "review this", "review PR", "review" | `/review` |
| "scaffold", "generate component", "generate module", "generate service", "new component", "new module", "new route", "new service", "create component", "stub out", "bootstrap" | `/scaffold` |
| "schedule", "recurring", "every N minutes", "cron", "set a reminder", "run periodically" | `/schedule` |
| "handoff", "session summary" | `/session-handoff` |
| "setup", "first run", "configure harness", "install citadel", "getting started" | `/setup` |
| "debug", "root cause", "diagnose", "why is", "investigate bug" | `/systematic-debugging` |
| "telemetry", "what did this cost", "session cost", "how much did that cost", "how much have I spent", "what hooks fired", "trust level", "show me telemetry", "spending", "session stats", "what telemetry", "verify audit", "audit integrity", "check audit", "tampered records" | `/telemetry` |
| "/test-gen", "generate tests", "write tests", "add tests", "test" | `/test-gen` |
| "triage", "open issues", "unlabeled issues", "review pr", "review prs", "investigate issue" | `/triage` |
| "unharness", "remove citadel", "uninstall citadel", "clean up citadel", "remove harness", "uninstall harness" | `/unharness` |
| "verify", "verify hooks", "hook health", "self-test", "check hooks", "harness health" | `/verify` |
| "watch", "watch files", "watch changes", "file sentinel", "monitor files", "watch start", "watch stop", "watch scan", "marker comments", "@citadel" | `/watch` |
| "wiki", "knowledge base", "llm wiki", "project wiki", "build a wiki", "maintain knowledge", "knowledge management", "llm-wiki", "karpathy wiki" | `/wiki` |
| "workspace", "multi-repo", "cross-repo", "across repos", "multiple repos", "coordinate repos", "add redis and snowflake", "split into repos" | `/workspace` |
<!-- END GENERATED: routing-table -->

**Script routes** (hand-maintained; these dispatch to local scripts, not skills):

| Input Contains | Route To |
|---|---|
| "deliver", "deliver intake", "intake to pr", "intake to PR" | `node scripts/deliver.js --next` when no file is named, or `node scripts/deliver.js --intake <file>` when a file is named, then `/do continue` |
| "package delivery", "review package", "local handoff" | `node scripts/package-delivery.js <campaign-slug>` after build and verification, or include `--pr <url>` when a PR exists |
| "pr ready", "ready for review", "finalize pr", "approval ready" | `node scripts/pr-ready.js --pr <pull-request-url> --run-verification` after the branch is pushed |
| "next", "what should I do next", "repair harness", "fix harness state" | `node scripts/operator-console.js --run`; auto-runs deterministic local repairs and stops at skill/human routes with a console report |
| "operator", "operator console", "what's up", "what should happen next", "approval capsule" | `node scripts/operator-console.js`; inspect-only decision cockpit |
| "preview route", "route preview", "dry run route", "what would /do do" | `node scripts/route-preview.js -- "<request>"`; route preflight without execution |

If ONE skill matches with high confidence → invoke it directly. Done.
High confidence = evaluator assigns ≥ 0.85 probability to exactly one skill. Below 0.85, or multiple skills above 0.70, fall through to Tier 3.
If MULTIPLE skills match → carry the candidate set to Tier 3. Tier 3 disambiguates between candidates only, not from scratch. Tie-break: prefer the candidate with fewer trigger keywords.

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

**Ambiguity gate:** When multiple Tier 2 candidates survive or classifier confidence is below 0.7, and the AskUserQuestion tool is available: present the top 2-3 candidate routes as options, each with a label and a one-line tradeoff, and route to the user's pick. When unavailable, apply the rules above unchanged (tie-break, then `/marshal` default).

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

When 2+ independent tasks detected (non-overlapping scopes, complexity >= 3, not already routed to full Fleet), read `consent.fleetSpawn` from harness.json:
- `auto-allow` → route directly to `/fleet --quick`
- `always-ask` or `null` → show prompt: "These look independent — run in parallel? [1=yes  2=always  3=no]"
  - 1: route to `--quick`, preference unchanged
  - 2: route to `--quick`, write `writeConsent('fleetSpawn', 'auto-allow')`
  - 3: run sequentially; if "don't ask again", write `always-ask`

`readConsent`/`writeConsent` are in `hooks_src/harness-health-util.js`.

**Trust level:** Read from `harness.json` `trust` object. Levels: novice (0-4 sessions), familiar (5-19), trusted (20+ with 2+ campaigns). `trust.override` takes precedence.

### Step 4: After Classification

1. **Log routing decision** (fire-and-forget):
   `node .citadel/scripts/telemetry-log.cjs --event agent-complete --agent do-router --session routing --status success --meta '{"tier":N,"target":"[skill]","input_chars":M}'`

   Use `.citadel/scripts/telemetry-log.cjs` (the project-local copy). If it doesn't exist, skip logging silently — never block routing on telemetry failure.

2. **Announce the routing decision**: "Routing to [target] because [one-sentence reason]"
3. **Invoke the target** skill or orchestrator
4. If the target fails or the user says "wrong tool", try the next tier up. If the target is already Tier 3 (marshal fails or user explicitly escalates from a failed marshal attempt): re-route to `/archon` with the original input as context.

## /do --list

Output a grouped skill list drawn from the system reminder's available skills. Group by category (Orchestration, App Creation, Code Quality, Research & Debugging, GitHub & CI, Infrastructure, Monitoring, Utilities, Observability). For each skill, show `/name  — one-line description`. Include a footer: "Direct invocation (/skill-name) always bypasses the router."

## Fringe Cases

- **`.planning/` does not exist**: The router works without `.planning/`. Tiers 0, 2, and 3 are fully independent of it. Tier 1 (active-state short-circuit) reads `.planning/campaigns/` and `.planning/fleet/` — if those directories are absent, skip Tier 1 gracefully and fall through to Tier 2. Never crash on a missing `.planning/` directory.
- **`harness.json` missing**: Skip the Skill Registry Check and proceed directly to Tier 0. Announce discovered skills from the filesystem if counts can be read, otherwise route from built-in keywords.
- **Multiple skills match at Tier 2**: Carry candidates to Tier 3 per Tier 2 disambiguation rule above.
- **User input is empty or whitespace**: Respond with the `--list` output and a prompt to provide a direction.
- **Routed skill not found**: Report "Skill not found" and fall back to Marshal as the safe default.

## Contextual Gates

**Disclosure:** "Routing to [skill]. See that skill's contextual gates for reversibility."
**Reversibility:** depends on routed skill — check the routed skill's reversibility
**Trust gates:**
- Any: routing and dispatch; inherits trust gates from the routed skill.

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
