<img src="assets/citadel-hero.svg" width="100%" alt="Citadel - The Operating System for Autonomous Engineering" />

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-compatible-blueviolet.svg)](https://docs.anthropic.com/en/docs/claude-code)
[![Add to Claude Code](https://img.shields.io/badge/Add_to-Claude_Code-blueviolet.svg)](docs/CLAUDE_INSTALLATION_GUIDE.md)
![Codex](https://img.shields.io/badge/Codex-compatible-5865F2.svg)
[![Add to Codex](https://img.shields.io/badge/Add_to-Codex-5865F2.svg)](docs/CODEX_INSTALLATION_GUIDE.md)
[![Interactive Demo](https://img.shields.io/badge/▶_Try_the_Router-00d2ff.svg)](https://sethgammon.github.io/Citadel/)

*Stop re-explaining your codebase every session. Start compounding what your agents learn.*

---

**[Follow on X](https://x.com/SethGammon)** for updates · **[Join the discussion](https://github.com/SethGammon/Citadel/discussions)**

</div>

## What Is Citadel

An agent orchestration harness for Claude Code and OpenAI Codex. It coordinates multiple AI agents in parallel, persists memory across sessions, and routes your intent to the cheapest execution path automatically. Citadel adapts itself to each runtime: plugin-first for Claude Code and plugin-first for Codex, with generated project artifacts as a fallback.

## Why Citadel Exists

**Without Citadel**, every agent session starts from zero. You re-explain architecture decisions. You re-discover that the auth module is fragile. You copy-paste the same review checklist. When a task is too big for one agent, you manually split it and lose context between the pieces. Your agents never get better at your codebase — you just get better at prompting them.

**With Citadel**, sessions resume where they left off. A `/do review` runs a structured 5-pass review that remembers what broke last time. A `/do overhaul the API layer` spawns parallel agents in isolated worktrees, shares discoveries between them, and merges the results. Skills you build once compound across every future session. The system learns from its own mistakes through campaign persistence and telemetry.

The difference: `CLAUDE.md` and `AGENTS.md` tell the runtime about your project. Citadel gives the runtime the *infrastructure to work autonomously* — routing, memory, safety hooks, and coordination that a single guidance file can't provide.

## Install In One Minute

**Prerequisites:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://developers.openai.com/codex/quickstart) + [Node.js 18+](https://nodejs.org/)

<table>
<tr>
<th width="50%">OpenAI Codex</th>
<th width="50%">Claude Code</th>
</tr>
<tr>
<td>

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
cd /path/to/your-project
node ~/Citadel/scripts/install.js --runtime codex --add-marketplace
codex
```

Open **Plugins**, choose **Citadel Local Plugins**, select **Add to Codex**, start a new thread.

</td>
<td>

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
cd /path/to/your-project
node ~/Citadel/scripts/install.js --runtime claude --install --scope local
claude
```

The installer validates the marketplace, installs the plugin locally, and writes resolved hooks for this project.

</td>
</tr>
</table>

Then run the same harness commands in either runtime:

```text
/do setup --express
/do review src/main.ts
```

Citadel's installers keep the trust boundary explicit: they prepare and verify local files, then use each runtime's plugin install flow. Use `--dry-run --json` on either path to see exactly what would change before writing anything.

**What gets checked:** plugin manifest, local marketplace, skill paths, hook bundle, MCP config, project guidance, runtime-specific shell/sandbox settings, and readiness evidence under `.planning/verification/`.

[Install](INSTALL.md) · [Quickstart for both runtimes](QUICKSTART.md) · [Claude Code installation guide](docs/CLAUDE_INSTALLATION_GUIDE.md) · [Codex installation guide](docs/CODEX_INSTALLATION_GUIDE.md) · [Codex native integration matrix](docs/CODEX_NATIVE_INTEGRATIONS.md)

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

1. **Pattern match** — catches trivial commands with regex. Zero tokens, zero model calls, instant.
2. **Session state** — checks if you're mid-campaign and resumes it. Still zero tokens.
3. **Keyword lookup** — scans your input against installed skill keywords ("review", "test", "refactor") and routes directly. Still zero tokens.
4. **LLM classification** — only when tiers 1-3 don't match, a structured complexity analysis (~500 tokens) determines whether you need a single-step Marshal, a multi-session Archon, or a parallel Fleet.

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

**Cost transparency.** Citadel reads runtime-native session artifacts and computes real cost from API pricing. You see what every session, campaign, and agent actually costs. Use `/cost` for a full breakdown or `/dashboard` for the overview. A real-time tracker alerts you at configurable spend thresholds without interrupting your work.

**Safety hooks.** 32 hooks across 29 lifecycle events run automatically. A consent system gates external actions (pushes, PRs, comments) with first-encounter choice — always-ask, session-allow, or auto-allow. Protected branches can't be deleted. Path traversal and secrets exfiltration are blocked. A circuit breaker stops failure spirals before they burn tokens. All of this is configurable per-project in `harness.json`.

**Campaign persistence.** Multi-session work survives context compression and session boundaries. Start an architecture overhaul today, close your laptop, pick it up tomorrow — the campaign state, decisions, and progress are all preserved. `/do continue` resumes exactly where you left off.

**Parallel coordination.** Fleet mode spawns multiple agents in isolated git worktrees, shares discoveries between them in real time, and merges results. One command, multiple agents, no conflicts.

**Autonomous quality improvement.** `/evolve` is a research-driven improvement director that scores the harness against a rubric, forms causal hypotheses about why scores are low, validates them with scout agents before spending fleet budget, and runs improvement cycles until it hits a ceiling or budget. It accumulates a persistent belief model and transferable pattern library across sessions — so each run compounds on what prior runs learned.

## FAQ

**Is this for me?** If you're running Claude Code or Codex on a real codebase and finding that agents lose context, repeat mistakes, or can't work in parallel, yes. If you're just starting out with either runtime, get a few sessions in first and come back when the friction shows up.

**How is this different from `CLAUDE.md` or `AGENTS.md`?** Those files tell the runtime about your project. Citadel tells the runtime *how to work*: durable state, intelligent routing, automated safety, and native parallelism — the infrastructure layer those files assume someone else built.

**Do I need to learn all 45 skills?** No. Just use `/do` and describe what you want in plain English. The router picks the right skill. You can go months without ever typing a skill name directly.

**What if `/do` routes to the wrong tool?** Tell it. "Wrong tool" or "just do it yourself" and it adjusts. You can also invoke any skill directly: `/review`, `/archon`, etc. The router is a convenience, not a gate.

**How much does it cost in tokens?** Citadel adds ~2.5% overhead to your session cost. Skills cost zero when not loaded. The `/do` router costs ~500 tokens only at Tier 4. Use `/cost` to see real token data and exact spend for any session or campaign.

**How is this different from CrewAI, LangChain, or Aider?** Those are agent frameworks: they give you primitives for building agents from scratch. Citadel is an *operating system for an existing agent* (Claude Code or Codex). You don't write agent code — you install a plugin and get routing, persistence, parallelism, and safety hooks on top of the agent you already use. If you're building a custom agent, use a framework. If you're using Claude Code or Codex and want it to work better, use Citadel.

**Does it work with Claude Code?** Yes. Citadel ships a Claude Code marketplace and plugin manifest, and `scripts/claude-install.js --install --scope local` validates the marketplace, installs the plugin into the target project scope, and writes resolved hook paths before you run `/do setup`.

**Does it work with OpenAI Codex?** Yes. Citadel ships as a Codex plugin with bundled skills, hooks, MCP config, and install-surface metadata. `scripts/codex-install.js` prepares the local marketplace and verifies the target project so the remaining Codex app step is the normal **Add to Codex** install click.

**Does this work on Windows?** Yes. All hooks and scripts run on Node.js. The Codex installer also runs the Windows sandbox/shell readiness check when it runs on Windows.

## Learn More

- [**Interactive routing demo**](https://sethgammon.github.io/Citadel/) — type any task, watch the tier cascade animate
- [Install](INSTALL.md) — fastest path for Codex or Claude Code
- [Quickstart](QUICKSTART.md) — first-run paths for both Claude Code and Codex
- [Claude Code installation guide](docs/CLAUDE_INSTALLATION_GUIDE.md) — Claude-specific plugin setup and hooks
- [Codex installation guide](docs/CODEX_INSTALLATION_GUIDE.md) — Codex-specific setup, hooks, and verification
- [Skills reference](docs/SKILLS.md) — all 45 skills with invocation and examples
- [Hooks reference](docs/HOOKS.md) — 29 lifecycle events, 32 hooks, what each one enforces
- [Campaign guide](docs/CAMPAIGNS.md) — persistent state, phases, AI amnesia prevention
- [Fleet guide](docs/FLEET.md) — parallel agents, worktree isolation, discovery relay
- [Security model](SECURITY.md) — path traversal, shell injection, and defensive measures
- [Contributing](CONTRIBUTING.md) — how to submit issues, PRs, and new skills

## Community

- **[X / Twitter](https://x.com/SethGammon)** — follow for updates and what's being built
- **[GitHub Discussions](https://github.com/SethGammon/Citadel/discussions)** — use cases, questions, requests, show and tell

Have a use case, a bug, or a workflow you want optimized? Open a Discussion. If you're using this in production, say so — it helps prioritize what gets built next.

[![Star on GitHub](https://img.shields.io/github/stars/SethGammon/Citadel?style=social)](https://github.com/SethGammon/Citadel)

### Roadmap

- [x] Multi-runtime support (Claude Code + Codex CLI)
- [x] Fleet mode with worktree isolation
- [x] Campaign persistence across sessions
- [x] Desktop app for campaign management
- [x] Autonomous quality improvement engine (`/evolve` — research-driven multi-cycle director)
- [x] Governance layer (3-tier policy constitution, policy-enforcer agent, immutable audit log)
- [ ] Campaign recovery and rollback
- [ ] Web dashboard (Citadel Cloud)
- [ ] Team collaboration features

### Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to:
- Submit issues with bug reports or feature requests
- Create pull requests for skills, hooks, or docs
- Share your use cases and workflows

---

## License

MIT

