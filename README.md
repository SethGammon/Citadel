# Citadel — Agent Orchestration for Claude Code

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-compatible-blueviolet.svg)](https://docs.anthropic.com/en/docs/claude-code)

Run autonomous coding campaigns with Claude Code. Route any task through the right tool at the right scale — from a one-line fix to a multi-day parallel campaign.

**21 skills | 3 autonomous agents | 8 lifecycle hooks | campaign persistence | fleet coordination**

## Quickstart

**Prerequisites:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) + [Node.js 18+](https://nodejs.org/)

```bash
# 1. Clone and copy into your project
git clone https://github.com/SethGammon/Citadel.git
cp -r Citadel/.claude Citadel/.planning Citadel/scripts your-project/

# 2. Run setup (inside Claude Code)
/do setup

# 3. Try something
/do review src/main.ts
```

That's it. [Full install guide →](QUICKSTART.md)

## Try These First

```
/do fix the typo on line 42        # Direct edit, zero overhead
/do review the auth module         # 5-pass structured code review
/do why is the API returning 500   # Root cause analysis
/do build a caching layer          # Multi-step orchestrated build
```

Say what you want. `/do` routes it to the cheapest tool that can handle it.

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

## Skills (21)

### App Creation (3)
| Skill | What It Does | Invoke |
|---|---|---|
| PRD | Generates a Product Requirements Document from an app description | `/prd` |
| Architect | Converts a PRD into file tree, build phases, and end conditions | `/architect` |
| Create App | End-to-end app creation with 4 tiers: blank, guided, templated, generated | `/create-app` |

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

### Utilities (3)
| Skill | What It Does | Invoke |
|---|---|---|
| Live Preview | Mid-build visual verification via screenshots | `/live-preview` |
| Session Handoff | Context transfer between sessions | `/session-handoff` |
| Setup | First-run harness configuration | `/do setup` |

## Hooks (8)

Automated quality enforcement that runs without you thinking about it.

| Hook | When | What It Does |
|---|---|---|
| Per-file typecheck | Every edit | Catches type errors at write-time |
| Circuit breaker | Tool failure | After 3 failures: "try a different approach" |
| Quality gate | Session end | Scans for anti-patterns in modified files |
| Intake scanner | Session start | Reports pending work items |
| File protection | Before edit/read | Blocks edits to protected files, blocks reads on .env secrets |
| Context preservation | Before/after compaction | Saves and restores session state |
| Worktree setup | Agent spawn | Auto-installs deps in parallel agent worktrees |

## Campaign Persistence

Work survives across sessions. Close the terminal, come back tomorrow, `/do continue` picks up where you left off.

Campaigns track phases, decisions, feature status, and continuation state in markdown files. See [docs/CAMPAIGNS.md](docs/CAMPAIGNS.md).

## Fleet Parallelism

Run 2-3 agents simultaneously in isolated worktrees. Discoveries compress into ~500-token briefs and relay between waves. See [docs/FLEET.md](docs/FLEET.md).

## FAQ

**How is this different from CLAUDE.md?** — CLAUDE.md tells Claude about your project. The harness tells Claude *how to work*: routing, persistence, quality enforcement, parallel coordination.

**How much does it cost in tokens?** — Skills cost zero when not loaded. The `/do` router costs ~500 tokens only at Tier 3. Hooks add ~100 tokens per edit. The main cost is the work itself.

**Can I use this with other AI tools?** — Designed for Claude Code specifically. The concepts are portable but the implementation uses Claude Code's extension points.

## Learn More

- [Full install guide](QUICKSTART.md)
- [Skills reference](docs/SKILLS.md)
- [Hooks reference](docs/HOOKS.md)
- [Campaign guide](docs/CAMPAIGNS.md)
- [Fleet guide](docs/FLEET.md)

## License

MIT
