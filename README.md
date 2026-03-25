# Citadel — Agent Orchestration Harness for Claude Code

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-compatible-blueviolet.svg)](https://docs.anthropic.com/en/docs/claude-code)

Run autonomous coding campaigns with Claude Code. Route any task through the right tool at the right scale — from a one-line fix to a multi-day parallel campaign.

**25 skills | 4 autonomous agents | 10 lifecycle hooks | campaign persistence | fleet coordination**

<img src="assets/citadel-overview.svg" width="100%" alt="Citadel system overview — app creation pipeline and safety systems" />

## Quickstart

**Prerequisites:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) + [Node.js 18+](https://nodejs.org/)

Citadel is a Claude Code **plugin** — install once, works across all your projects. No per-project file copying.

```bash
# 1. Clone Citadel
git clone https://github.com/SethGammon/Citadel.git

# 2. Launch Claude Code with the plugin loaded
claude --plugin-dir /path/to/Citadel

# 3. Install hooks into your project (one-time per project)
node /path/to/Citadel/scripts/install-hooks.js

# 4. Run setup
/do setup

# 5. Try something
/do review src/main.ts
```

For persistent plugin install across all sessions, use the marketplace method inside Claude Code:
```
/plugin marketplace add /path/to/Citadel
/plugin install citadel@citadel-local
/reload-plugins
```

> **Note:** The hook installer (step 3) is required until [a known upstream bug](https://github.com/anthropics/claude-code/issues/24529) is resolved. It writes Citadel's hook config into your project's `.claude/settings.json` with resolved paths. `/do setup` will also run this automatically.

[Full install guide →](QUICKSTART.md)

## Try These First

```
/do fix the typo on line 42        # Direct edit, zero overhead
/do review the auth module         # 5-pass structured code review
/do why is the API returning 500   # Root cause analysis
/do build a caching layer          # Multi-step orchestrated build
```

Say what you want. `/do` routes it to the cheapest tool that can handle it.

## How It Works

You type what you want. `/do` classifies your intent and picks the cheapest tool that can handle it — no menus, no flags, no routing decisions on your end.

```
You say:                               Citadel runs:
─────────────────────────────────────────────────────────────
"fix the typo on line 42"          →   Direct edit (zero overhead)
"review the auth module"           →   /review (5-pass code review)
"add payments to my app"           →   /create-app tier 5 (feature addition)
"build me a recipe app"            →   /create-app → /prd → /architect → /archon
"overhaul all three services"      →   /fleet (parallel agents)
```

Simple tasks get simple tools. Complex tasks get campaigns with phases, verification, and self-correction. You never have to choose.

## The Orchestration Ladder

Four tiers. Use the cheapest one that fits.

<table>
<tr>
<td width="50%" align="center">
<img src="assets/card-skill.svg" width="400" alt="Skill — Domain Expert" />
</td>
<td width="50%" align="center">
<img src="assets/card-marshal.svg" width="400" alt="Marshal — Session Commander" />
</td>
</tr>
<tr>
<td width="50%" align="center">
<img src="assets/card-archon.svg" width="400" alt="Archon — Autonomous Strategist" />
</td>
<td width="50%" align="center">
<img src="assets/card-fleet.svg" width="400" alt="Fleet — Parallel Coordinator" />
</td>
</tr>
</table>

## Skills (25)

### App Creation (3)
| Skill | What It Does | Invoke |
|---|---|---|
| PRD | Generates a Product Requirements Document from an app description | `/prd` |
| Architect | Converts a PRD into file tree, build phases, and end conditions | `/architect` |
| Create App | End-to-end app creation with 5 tiers: blank, guided, templated, generated, or feature addition | `/create-app` |

### Core (6)
| Skill | What It Does | Invoke |
|---|---|---|
| Code Review | 5-pass structured review (correctness, security, performance, readability, consistency) | `/review` |
| Test Generation | Generates tests that run. Detects your framework, iterates up to 3x on failures. | `/test-gen` |
| Documentation | Function-level, module-level, or API reference. Matches your doc style. | `/doc-gen` |
| Refactoring | Safe multi-file refactoring. Typechecks before and after. Reverts on failure. | `/refactor` |
| Scaffolding | Project-aware file generation. Reads your conventions and matches them. | `/scaffold` |
| Skill Creator | Creates new skills from your repeating patterns. | `/create-skill` |

### Research & Debugging (4)
| Skill | What It Does | Invoke |
|---|---|---|
| Research | Structured investigation with confidence levels and sources | `/research` |
| Research Fleet | Parallel multi-scout research with wave compression | `/research-fleet` |
| Experiment | Optimization loops with scalar fitness functions in isolated worktrees | `/experiment` |
| Systematic Debugging | 4-phase root cause analysis. Emergency stop after 2 failed fixes. | `/systematic-debugging` |

### Orchestration (5)
| Skill | What It Does | Invoke |
|---|---|---|
| `/do` | Universal router — classifies intent and dispatches to cheapest capable path | `/do [anything]` |
| Marshal | Single-session orchestrator. Chains skills autonomously. | `/marshal` |
| Archon | Multi-session campaigns with self-correction and quality gates | `/archon` |
| Fleet | Parallel agents with discovery sharing and coordination safety | `/fleet` |
| Autopilot | Intake-to-delivery pipeline for pending work items | `/autopilot` |

### Quality & Verification (3)
| Skill | What It Does | Invoke |
|---|---|---|
| Design | Generates and maintains a design manifest for visual consistency | `/design` |
| QA | Browser-based interaction testing via Playwright (optional dependency) | `/qa` |
| Postmortem | Auto-generates structured postmortems from completed campaigns | `/postmortem` |

### Maintenance (1)
| Skill | What It Does | Invoke |
|---|---|---|
| Triage | GitHub issue and PR investigator. Classifies, investigates root cause, reviews contributed code. | `/triage` |

### Utilities (4)
| Skill | What It Does | Invoke |
|---|---|---|
| Live Preview | Mid-build visual verification via screenshots | `/live-preview` |
| Session Handoff | Context transfer between sessions | `/session-handoff` |
| Setup | First-run harness configuration | `/do setup` |

## Hooks (10)

Automated quality enforcement that runs without you thinking about it.

| Hook | When | What It Does |
|---|---|---|
| Per-file typecheck | Every edit | Catches type errors at write-time, design manifest deviations |
| Circuit breaker | Tool failure | After 3 failures: "try a different approach" |
| Quality gate | Session end | Scans for anti-patterns in modified files |
| Intake scanner | Session start | Reports pending work items |
| File protection | Before edit/read | Blocks edits to protected files, blocks reads on .env secrets |
| Pre-compaction save | Before context compaction | Saves session state so nothing is lost |
| Post-compaction restore | After context compaction | Restores session state from saved snapshot |
| Worktree setup | Agent spawn | Auto-installs deps in parallel agent worktrees |
| Smoke test | On demand | Validates all hooks load, parse, and resolve (`node hooks_src/smoke-test.js`) |
| External action gate | Before bash (opt-in) | Blocks push/PR/comment until user approves |
| Init project | Session start | Auto-scaffolds `.planning/` and `.citadel/scripts/` per-project |

## Sub-Agents (4)

Specialized agents that Archon and Fleet spawn as sub-processes. You don't invoke these directly — they're internal workers.

| Agent | What It Does |
|---|---|
| Archon | Autonomous campaign executor — decomposes phases, delegates, reviews, self-corrects |
| Fleet | Parallel coordinator — runs 2-3 agents in isolated worktrees per wave |
| Arch Reviewer | Read-only architecture auditor — checks boundary violations and import rules |
| Knowledge Extractor | Extracts reusable patterns and decisions from completed work into the knowledge base |

## Campaign Persistence

Work survives across sessions. Close the terminal, come back tomorrow, `/do continue` picks up where you left off.

Campaigns track phases, decisions, feature status, and continuation state in markdown files. See [docs/CAMPAIGNS.md](docs/CAMPAIGNS.md).

## Fleet Parallelism

Run 2-3 agents simultaneously in isolated worktrees. Discoveries compress into ~500-token briefs and relay between waves. See [docs/FLEET.md](docs/FLEET.md).

## FAQ

**How is this different from CLAUDE.md?** — CLAUDE.md tells Claude about your project. The harness tells Claude *how to work*: routing, persistence, quality enforcement, parallel coordination.

**Do I need to learn all 25 skills?** — No. Just use `/do` and describe what you want in plain English. The router picks the right skill. You can go months without ever typing a skill name directly.

**What if `/do` routes to the wrong tool?** — Tell it. "Wrong tool" or "just do it yourself" and it adjusts. You can also invoke any skill directly: `/review`, `/archon`, etc. The router is a convenience, not a gate.

**How much does it cost in tokens?** — Skills cost zero when not loaded. The `/do` router costs ~500 tokens only at Tier 3. Hooks add ~100 tokens per edit. The main cost is the work itself.

**Can I use this with other AI tools?** — Designed for Claude Code specifically. The concepts are portable but the implementation uses Claude Code's extension points.

**Does this work on Windows?** — Yes. All hooks and scripts run on Node.js. As a plugin, it installs identically on all platforms.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting issues, PRs, and new skills.

## Learn More

- [Full install guide](QUICKSTART.md)
- [Skills reference](docs/SKILLS.md)
- [Hooks reference](docs/HOOKS.md)
- [Campaign guide](docs/CAMPAIGNS.md)
- [Fleet guide](docs/FLEET.md)

## License

MIT
