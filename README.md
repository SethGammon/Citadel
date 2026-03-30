<img src="assets/citadel-hero.svg" width="100%" alt="Citadel - The Operating System for Autonomous Engineering" />

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-compatible-blueviolet.svg)](https://docs.anthropic.com/en/docs/claude-code)
[![Interactive Demo](https://img.shields.io/badge/▶_Try_the_Router-00d2ff.svg)](https://sethgammon.github.io/Citadel/)

*Stop re-explaining your codebase every session. Start compounding what your agents learn.*

</div>

## What Is Citadel

An agent orchestration harness for Claude Code. It coordinates multiple AI agents in parallel, persists memory across sessions, and routes your intent to the cheapest execution path automatically. You install it as a plugin and it works on any codebase.

## Why Citadel Exists

**Without Citadel**, every Claude Code session starts from zero. You re-explain architecture decisions. You re-discover that the auth module is fragile. You copy-paste the same review checklist. When a task is too big for one agent, you manually split it and lose context between the pieces. Your agents never get better at your codebase -- you just get better at prompting them.

**With Citadel**, sessions resume where they left off. A `/do review` runs a structured 5-pass review that remembers what broke last time. A `/do overhaul the API layer` spawns parallel agents in isolated worktrees, shares discoveries between them, and merges the results. Skills you build once compound across every future session. The system learns from its own mistakes through campaign persistence and telemetry.

The difference: CLAUDE.md tells Claude about your project. Citadel gives Claude the *infrastructure to work autonomously* -- routing, memory, safety hooks, and coordination that a `.md` file can't provide.

## Quickstart

**Prerequisites:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) + [Node.js 18+](https://nodejs.org/)

```bash
# 1. Clone Citadel
git clone https://github.com/SethGammon/Citadel.git

# 2. Launch Claude Code with the plugin loaded
claude --plugin-dir /path/to/Citadel

# 3. Run setup (installs hooks, scaffolds project state)
/do setup

# 4. Try something
/do review src/main.ts
```

[Full install guide with alternative methods](QUICKSTART.md)

## How It Works

Say what you want. `/do` routes it to the cheapest tool that can handle it.

```
/do fix the typo on line 42        # Direct edit, no model call
/do review the auth module         # 5-pass structured code review
/do why is the API returning 500   # Root cause analysis
/do build a caching layer          # Multi-step orchestrated build
/do overhaul all three services    # Parallel fleet with isolated worktrees
```

Classification runs across four tiers, each cheaper than the last:

1. **Pattern match** -- catches trivial commands with regex. Zero tokens, zero model calls, instant.
2. **Session state** -- checks if you're mid-campaign and resumes it. Still zero tokens.
3. **Keyword lookup** -- scans your input against installed skill keywords ("review", "test", "refactor") and routes directly. Still zero tokens.
4. **LLM classification** -- only when tiers 1-3 don't match, a structured complexity analysis (~500 tokens) determines whether you need a single-step Marshal, a multi-session Archon, or a parallel Fleet.

Most requests resolve at tiers 1-3 for free. Tier 4 is the exception, not the default. You never have to choose the tool.

**[See it route live](https://sethgammon.github.io/Citadel/)**

## The Orchestration Ladder

Four tiers. Use the cheapest one that fits.

<table>
<tr>
<td width="50%">
<img src="assets/card-skill.svg" width="100%" alt="Skill - Domain Expert" />
</td>
<td width="50%">
<img src="assets/card-marshal.svg" width="100%" alt="Marshal - Session Commander" />
</td>
</tr>
<tr>
<td width="50%">
<img src="assets/card-archon.svg" width="100%" alt="Archon - Autonomous Strategist" />
</td>
<td width="50%">
<img src="assets/card-fleet.svg" width="100%" alt="Fleet - Parallel Coordinator" />
</td>
</tr>
</table>

## What You Get

**Cost transparency.** Citadel reads Claude Code's native session files for exact token counts and computes real cost from API pricing. You see what every session, campaign, and agent actually costs. Use `/cost` for a full breakdown or `/dashboard` for the overview. A real-time tracker alerts you at configurable spend thresholds without interrupting your work.

**Safety hooks.** 15 lifecycle hooks run automatically. A consent system gates external actions (pushes, PRs, comments) with first-encounter choice -- always-ask, session-allow, or auto-allow. Protected branches can't be deleted. Path traversal and secrets exfiltration are blocked. A circuit breaker stops failure spirals before they burn tokens. All of this is configurable per-project in `harness.json`.

**Campaign persistence.** Multi-session work survives context compression and session boundaries. Start an architecture overhaul today, close your laptop, pick it up tomorrow -- the campaign state, decisions, and progress are all preserved. `/do continue` resumes exactly where you left off.

**Parallel coordination.** Fleet mode spawns multiple agents in isolated git worktrees, shares discoveries between them in real time, and merges results. One command, multiple agents, no conflicts.

## FAQ

**Is this for me?** If you're running Claude Code on a real codebase and finding that agents lose context, repeat mistakes, or can't work in parallel, yes. If you're just starting out with Claude Code, get a few sessions in first and come back when the friction shows up.

**How is this different from CLAUDE.md?** CLAUDE.md tells Claude about your project. Citadel tells Claude *how to work*: durable state, intelligent routing, automated safety, and native parallelism -- the infrastructure layer that CLAUDE.md assumes someone else built.

**Do I need to learn all 40 skills?** No. Just use `/do` and describe what you want in plain English. The router picks the right skill. You can go months without ever typing a skill name directly.

**What if `/do` routes to the wrong tool?** Tell it. "Wrong tool" or "just do it yourself" and it adjusts. You can also invoke any skill directly: `/review`, `/archon`, etc. The router is a convenience, not a gate.

**How much does it cost in tokens?** Citadel adds ~2.5% overhead to your session cost. Skills cost zero when not loaded. The `/do` router costs ~500 tokens only at Tier 4. Use `/cost` to see real token data and exact spend for any session or campaign.

**How is this different from CrewAI, LangChain, or Aider?** Those are agent frameworks: they give you primitives for building agents from scratch. Citadel is an *operating system for an existing agent* (Claude Code). You don't write agent code -- you install a plugin and get routing, persistence, parallelism, and safety hooks on top of the agent you already use. If you're building a custom agent, use a framework. If you're using Claude Code and want it to work better, use Citadel.

**Does this work on Windows?** Yes. All hooks and scripts run on Node.js. As a plugin, it installs identically on all platforms.

## Learn More

- [**Interactive routing demo**](https://sethgammon.github.io/Citadel/) -- type any task, watch the tier cascade animate
- [Full install guide](QUICKSTART.md)
- [Skills reference](docs/SKILLS.md) -- all 40 skills with invocation and examples
- [Hooks reference](docs/HOOKS.md) -- 15 event types, what each one enforces
- [Campaign guide](docs/CAMPAIGNS.md) -- persistent state, phases, AI amnesia prevention
- [Fleet guide](docs/FLEET.md) -- parallel agents, worktree isolation, discovery relay
- [Security model](SECURITY.md) -- path traversal, shell injection, and defensive measures
- [Contributing](CONTRIBUTING.md) -- how to submit issues, PRs, and new skills
- [External overview](https://repo-explainer.com/SethGammon/Citadel/) -- third-party writeup on the architecture and philosophy

## License

MIT
