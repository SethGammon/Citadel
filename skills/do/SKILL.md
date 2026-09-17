---
name: do
license: MIT
description: >-
  Unified router that auto-routes user intent to the right direct action, skill,
  orchestrator, or explicit Operation Control plan.
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
last-updated: 2026-07-31
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
| `/do preview <request>` | Show exact resolution or generated candidates and their boundary without executing |
| `/do --route /skill -- <request>` | Use an explicit validated route without bypassing activation or safety boundaries |
| `/do continue` | Resolve and run the deterministic continuation action |
| `/do --list` | Show all skills grouped by category with trigger keywords |
| `/do setup` | First-run experience — configure the harness for this project |

## Protocol

Classification runs top-to-bottom. Exact commands resolve first. Natural-language requests use keyword matches only as candidate evidence for semantic classification.

### Step 0: Skill Registry Check (Cost: ~0 on hit | ~50 tokens on miss)

Compare installed skill directories with `core/skills/routing-table.json`. If they
match, continue without reading skill bodies. For each unknown skill, read only
its frontmatter and use `name`, `description`, and `trigger_keywords` as session-local Tier 2 match targets, then report:
`"Discovered {N} new skill(s): {names}. Run /do setup to regenerate routing."`
Do not write registration fields into `harness.json`; schema-v2 config is exact and generated routing is a projection, not config authority.

### Tier 0: Exact Command Match (Cost: ~0 tokens | Latency: <1ms)

Normalize case, apostrophes, and whitespace, then compare the **entire input**.
Never match a Tier 0 command because its word appears inside a larger request.

<!-- BEGIN GENERATED: exact-command-table -->
| Exact normalized input | Action |
|---|---|
| "status", "dashboard", "what's happening", "what's going on", "show activity" | `node scripts/dashboard.js` |
| "next", "what should i do next", "fix harness state", "repair harness" | `node scripts/operator-console.js --run` |
| "operator", "operator console", "approval capsule", "what's up", "what should happen next" | `node scripts/operator-console.js` |
| "continue", "keep going" | `node scripts/continue-action.js --run` |
| "setup", "first run", "configure harness" | `/do setup` |
| "setup --express" | `/do setup --express` |
| "--list", "list", "list skills" | `/do --list` |
| "test", "tests", "run test", "run tests" | `npm run test` only when `package.json#scripts.test` exists; otherwise non-final |
| "build", "run build" | `npm run build` only when `package.json#scripts.build` exists; otherwise non-final |
| "typecheck", "type check", "run typecheck", "run type check" | `npm run typecheck` only when `package.json#scripts.typecheck` exists; otherwise non-final |
<!-- END GENERATED: exact-command-table -->

`/do preview <request>` strips the `preview` wrapper and reuses the shared exact command and built-in candidate preflight. It does **not** inspect Tier 1 active state,
discover project-local custom skills, or run the Tier 3 LLM classifier. Therefore every natural-language preview is non-final, has no command, and stops at
`semantic-classification-required`. `/do --route /skill -- <request>` passes the requested route through `scripts/route-preview.js --route`; an unknown route is rejected,
and a valid override still goes through activation, worktree, and approval boundaries.

If the whole input matches an exact command, execute it and stop. The `test`, `build`, and `typecheck` commands are final only when the target project's
`package.json` declares the corresponding non-empty script. Otherwise they remain non-executable. Do not execute a command merely because its word appears inside a larger request; continue to active-state and semantic routing.

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

### Tier 2: Skill Candidate Discovery (Cost: ~0 tokens | Latency: <10ms)

Match input against installed skill keywords from Citadel's built-in skills
and any project-level custom skills in `.claude/skills/`. These matches are
candidate evidence, never the final routing decision by themselves.

**Built-in skill triggers** (generated from each skill's `trigger_keywords` frontmatter; edit the frontmatter, then run `node scripts/generate-routing.js` to refresh this table):

<!-- BEGIN GENERATED: routing-table -->
| Input Contains | Route To | Product Bundle |
|---|---|---|
| "architect", "architecture", "design the system", "file structure", "plan the build" | `/architect` | `core` |
| "campaign", "multi-session", "phases" | `/archon` | `operations` |
| "ascii diagram", "ascii art", "box diagram", "architecture diagram", "flow diagram", "sequence diagram", "draw a diagram", "text diagram" | `/ascii-diagram` | `core` |
| "intake", "process pending", "pipeline" | `/autopilot` | `operations` |
| "cost", "costs", "cost breakdown", "campaign cost", "token usage", "burn rate", "model breakdown" | `/cost` | `persistence` |
| "create app", "build app", "build me", "make an app", "new app", "generate app", "add auth", "add payments", "integrate" | `/create-app` | `core` |
| "create skill", "new skill", "make a skill", "teach the harness", "custom skill", "my own skill", "skill for", "automate this pattern", "repeated pattern" | `/create-skill` | `core` |
| "daemon", "continuous", "run overnight", "keep running", "24/7", "unattended", "run autonomously", "daemon start", "daemon stop", "daemon status" | `/daemon` | `operations` |
| "dashboard", "what's happening", "what's going on", "show activity", "harness state", "show me status" | `/dashboard` | `persistence` |
| "decision map", "plan this out", "figure this out", "investigation plan", "planning map" | `/decision-map` | `persistence` |
| "deploy steward", "deploy queue", "merge steward", "mainline steward", "land prs", "land PRs", "deploy prs", "deploy PRs", "merge queue", "release train" | `/deploy-steward` | `delivery` |
| "design", "style guide", "design manifest", "visual consistency" | `/design` | `core` |
| "document", "docs", "docstring", "jsdoc", "readme", "api docs" | `/doc-gen` | `core` |
| "evolve", "sustained improve", "improvement director", "research-driven improve", "multi-cycle improve", "run until done", "improve until ceiling", "keep improving", "hypothesis", "belief model", "scout agents" | `/evolve` | `operations` |
| "experiment", "optimize", "try", "A/B", "measure" | `/experiment` | `operations` |
| "parallel", "simultaneous", "multiple agents", "at the same time" | `/fleet --quick` | `parallel` |
| "grill me", "grill", "stress-test the plan", "sharpen the plan", "pressure-test", "interview me" | `/grill` | `core` |
| "houseclean", "house clean", "disk space", "free space", "c drive full", "drive full", "running out of space", "clean up disk", "orphaned worktrees", "clean worktrees", "disk audit", "storage audit", "move to another drive", "free up space" | `/houseclean` | `core` |
| "improve", "improvement loop", "quality loop", "rubric", "score against", "run improvement", "improve citadel" | `/improve` | `operations` |
| "infra", "infrastructure", "what databases", "what systems", "docker-compose", "infra audit", "map infrastructure", "what does this connect to" | `/infra-audit` | `core` |
| "learn", "extract patterns", "learn from that", "save what worked", "patterns from campaign" | `/learn` | `persistence` |
| "preview", "screenshot", "visual check", "does it render" | `/live-preview` | `core` |
| "loop", "repeat until", "until tests pass", "until lint passes", "max attempts", "retry until" | `/loop` | `operations` |
| "map", "index codebase", "codebase map", "structural index", "scan codebase", "map stats", "map query" | `/map` | `core` |
| "orchestrate", "chain skills", "multi-step" | `/marshal` | `operations` |
| "merge review", "check merges", "any conflicts", "fleet conflicts", "pending branches", "safe to merge" | `/merge-review` | `parallel` |
| "organize", "directory structure", "folder structure", "project structure", "file organization", "organize directories", "organize files", "cleanup directories", "directory convention", "where should this go", "messy project" | `/organize` | `core` |
| "postmortem", "retro", "what broke", "what happened", "debrief" | `/postmortem` | `persistence` |
| "watch pr", "watch ci", "monitor pr", "fix ci", "ci failing", "pr failing", "auto-fix", "auto fix pr", "pr is red", "checks failing" | `/pr-watch` | `delivery` |
| "prd", "requirements", "spec", "plan an app", "design an app" | `/prd` | `core` |
| "qa", "test the app", "click through", "does it work", "browser test" | `/qa` | `core` |
| "refactor", "rename", "extract", "inline", "move file", "split file", "merge files" | `/refactor` | `core` |
| "research", "investigate", "look into", "find out", "research fleet", "parallel research", "multi-angle research", "compare options" | `/research` | `core` |
| "/review", "code review", "review this", "review PR", "review" | `/review` | `core` |
| "scaffold", "generate component", "generate module", "generate service", "new component", "new module", "new route", "new service", "create component", "stub out", "bootstrap" | `/scaffold` | `core` |
| "schedule", "recurring", "every N minutes", "cron", "set a reminder", "run periodically" | `/schedule` | `operations` |
| "handoff", "session summary" | `/session-handoff` | `persistence` |
| "setup", "first run", "configure harness", "install citadel", "getting started" | `/setup` | `core` |
| "debug", "root cause", "diagnose", "why is", "investigate bug" | `/systematic-debugging` | `core` |
| "telemetry", "what did this cost", "session cost", "how much did that cost", "how much have I spent", "what hooks fired", "trust level", "show me telemetry", "spending", "session stats", "what telemetry", "verify audit", "audit integrity", "check audit", "tampered records" | `/telemetry` | `persistence` |
| "/test-gen", "generate tests", "write tests", "add tests", "test" | `/test-gen` | `core` |
| "triage", "open issues", "unlabeled issues", "review pr", "review prs", "investigate issue" | `/triage` | `delivery` |
| "unharness", "remove citadel", "uninstall citadel", "clean up citadel", "remove harness", "uninstall harness" | `/unharness` | `core` |
| "verify", "verify hooks", "hook health", "self-test", "check hooks", "harness health" | `/verify` | `core` |
| "watch", "watch files", "watch changes", "file sentinel", "monitor files", "watch start", "watch stop", "watch scan", "marker comments", "@citadel" | `/watch` | `operations` |
| "wiki", "knowledge base", "llm wiki", "project wiki", "build a wiki", "maintain knowledge", "knowledge management", "llm-wiki", "karpathy wiki" | `/wiki` | `persistence` |
| "workspace", "multi-repo", "cross-repo", "across repos", "multiple repos", "coordinate repos", "add redis and snowflake", "split into repos" | `/workspace` | `parallel` |
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

Carry every matching route and the exact matched phrases to Tier 3. A single candidate narrows the semantic decision but does not turn substring evidence into execution authority.
Multiple candidates are disambiguated semantically, not by generated-table order.

### Tier 3: LLM Complexity Classifier (Cost: ~500 tokens | Latency: ~1-2s)

For every non-exact request, classify intent across 6 dimensions. Use Tier 2
candidates as evidence when present; when none match, classify from the request:

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

**Important:** A repeated pattern complaint ("I keep doing X manually", "the agent always makes this mistake") should route to `/create-skill`. A repeated pattern
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

1. **Enforce product activation before invocation.** Run:
   `node {citadelRoot}/scripts/citadel-config.js check route {bare-skill-name} --runtime {claude-code|codex|opencode} --json`.
   `enabled` and explicitly named `degraded` routes may continue. For
   `disabled`, `unavailable`, or `blocked`, show the returned reason and
    activation plan; do not invoke the target. Enabling a bundle is a separate
    plan-first config mutation and never happens silently.
   An explicit `--route` override changes only route selection. It never skips
   this activation preflight or any worktree, approval, or verification boundary.
2. **Log routing decision** (fire-and-forget):
   `node .citadel/scripts/telemetry-log.cjs --event agent-complete --agent do-router --session routing --status success --meta '{"tier":N,"target":"[skill]","input_chars":M}'`

   Use `.citadel/scripts/telemetry-log.cjs` (the project-local copy). If it doesn't exist, skip logging silently — never block routing on telemetry failure.
3. **Announce the routing decision**: "Routing to [target] because [one-sentence reason]"
4. **Invoke the target** skill or orchestrator
5. If the target fails or the user says "wrong tool", try the next tier up. If the target is already Tier 3 (marshal fails or user explicitly escalates from a failed marshal attempt): re-route to `/archon` with the original input as context, then repeat activation preflight for that route.

## /do --list

Output a grouped skill list drawn from the system reminder's available skills. Group by category (Orchestration, App Creation, Code Quality, Research & Debugging, GitHub & CI, Infrastructure, Monitoring, Utilities, Observability). For each skill, show `/name  — one-line description` plus its product bundle. Include a footer: "Direct invocation bypasses routing, but not product-bundle activation or safety gates."

## Fringe Cases

- **`.planning/` does not exist**: The router works without `.planning/`. Tiers 0, 2, and 3 are fully independent of it. Tier 1 (active-state short-circuit) reads `.planning/campaigns/` and `.planning/fleet/` — if those directories are absent, skip Tier 1 gracefully and fall through to Tier 2. Never crash on a missing `.planning/` directory.
- **`harness.json` missing**: Use the bootstrap Standard + Core + Persistence
  activation preview. Core/Persistence routes may proceed; other bundles return
  an explicit activation plan. Do not write config during routing.
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
- A routed target must pass central activation preflight; fallback targets do
  not bypass this gate

## Exit Protocol

After routing and execution complete:
- If the routed skill/orchestrator produces a HANDOFF, relay it to the user
- If the task was trivial (Tier 0), just show the result
- Do not add overhead to simple tasks
- Telemetry is fire-and-forget — never surface telemetry errors to the user
