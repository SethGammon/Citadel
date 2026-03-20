# Claude Harness

An agent orchestration system for [Claude Code](https://claude.ai/claude-code). Route any task through the right tool at the right scale — from a one-line fix to a multi-day parallel campaign.

Built from running 198 autonomous agents across 32 parallel sessions on a production codebase. 27 postmortems worth of lessons baked into every hook and skill.

**The harness is simple. The knowledge that shaped it isn't.**

## Quickstart

**Requires:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed, [Node.js 18+](https://nodejs.org/) (for hooks and scripts)

```bash
git clone https://github.com/DevMoses/claude-harness.git
cp -r claude-harness/.claude ./
cp -r claude-harness/.planning ./
cp -r claude-harness/scripts ./
```

Then open your project in Claude Code (`cd your-project && claude`) and run:

```
/do setup
```

Setup detects your stack, configures hooks, and runs a live demo on your code. Five minutes to working harness.

---

## The Orchestration Ladder

Four tiers. Use the cheapest one that fits.

<table>
<tr>
<td width="25%" align="center">
<img src="assets/card-skill.svg" width="200" alt="Skill — Domain Expert" />
</td>
<td width="25%" align="center">
<img src="assets/card-marshal.svg" width="200" alt="Marshal — Session Commander" />
</td>
<td width="25%" align="center">
<img src="assets/card-archon.svg" width="200" alt="Archon — Autonomous Strategist" />
</td>
<td width="25%" align="center">
<img src="assets/card-fleet.svg" width="200" alt="Fleet — Parallel Coordinator" />
</td>
</tr>
</table>

---

## The `/do` Router

One command. Say what you want. The system figures out the rest.

```
/do fix the typo on line 42          → Direct edit (0 tokens)
/do review the auth module           → /review skill
/do build a caching layer            → /marshal (multi-step)
/do finish the API redesign          → /archon (multi-session campaign)
/do overhaul all three services      → /fleet (parallel agents)
```

**Four-tier classification**, each cheaper than the last:

1. **Pattern Match** (~0 tokens) — Regex catches trivial commands
2. **Active State** (~0 tokens) — Resumes in-progress campaigns
3. **Skill Keywords** (~0 tokens) — Matches against installed skills
4. **LLM Classifier** (~500 tokens) — Structured complexity analysis

The router biases toward under-routing. It's cheaper to re-invoke than to waste 100K tokens on a typo fix.

**Commands:**

| Command | What It Does |
|---|---|
| `/do [anything]` | Route to the right tool |
| `/do status` | Show active campaigns, sessions, pending work |
| `/do continue` | Resume where you left off |
| `/do --list` | Show all installed skills |
| `/do setup` | First-run configuration |

**Escape hatches:** Direct invocation (`/marshal`, `/archon`, `/fleet`, `/review`) always bypasses the router.

---

## Built-In Skills (6)

| Skill | What It Does | Invoke |
|---|---|---|
| **Code Review** | 5-pass structured review: correctness, security, performance, readability, consistency. Every finding cites a specific line. | `/review` |
| **Test Generation** | Generates tests that actually run. Detects your test framework, covers happy path + edge cases + error paths. Iterates up to 3x if tests fail. | `/test-gen` |
| **Documentation** | Three modes: function-level docstrings, module READMEs, API reference. Matches your existing doc style. | `/doc-gen` |
| **Refactoring** | Safe multi-file refactoring. Typechecks before AND after. If tests fail, reverts and reports. Handles import path updates. | `/refactor` |
| **Scaffolding** | Project-aware file generation. Reads your existing structure and matches it. Generates wiring, exports, tests. | `/scaffold` |
| **Skill Creator** | Creates new skills from your patterns. Asks what you keep repeating, what mistakes happen, produces a complete skill file. | `/create-skill` |

These are not skeletons. Each produces real, substantive output on any codebase.

---

## Hooks (8 Lifecycle Events)

Automated quality enforcement that runs without you thinking about it.

| Hook | When | What It Does |
|---|---|---|
| Per-file typecheck | Every edit | Catches type errors at write-time, not build-time |
| Circuit breaker | Tool failure | After 3 failures: "try a different approach" |
| Quality gate | Session end | Scans for anti-patterns in modified files |
| Intake scanner | Session start | Reports pending work items |
| File protection | Before edit | Blocks edits to protected files |
| Context preservation | Before/after compaction | Saves and restores session state |
| Worktree setup | Agent spawn | Auto-installs deps in parallel agent worktrees |

**Language-adaptive:** The typecheck hook detects your stack (TypeScript, Python, Go, Rust) and runs the right checker.

**Configurable:** Add custom quality rules in `harness.json`. See [docs/HOOKS.md](docs/HOOKS.md).

---

## Campaign Persistence

Work that survives across sessions.

```markdown
# Campaign: API Auth Overhaul

Status: active
Direction: "Replace basic auth with JWT"

## Phases
1. [complete] Research: audit existing auth
2. [in-progress] Build: JWT middleware
3. [pending] Wire: connect to routes

## Feature Ledger
| Feature | Status | Phase |
|---------|--------|-------|
| JWT middleware | complete | 2 |

## Decision Log
- Chose jose over jsonwebtoken (ESM native, better types)

## Active Context
Building refresh token endpoint. Middleware done.

## Continuation State
Phase: 2, Sub-step: refresh endpoint
```

Close the session. Come back tomorrow. `/do continue` picks up exactly where you left off.

See [docs/CAMPAIGNS.md](docs/CAMPAIGNS.md) and [examples/campaign-example.md](examples/campaign-example.md).

---

## Fleet Parallelism

Run multiple agents simultaneously with discovery sharing.

```
Wave 1: Agent A (src/api/) + Agent B (src/ui/)
  ← Compress discoveries: "API uses jose for JWT, 15min expiry"
  ← Merge branches

Wave 2: Agent C (integration) ← starts with Wave 1's knowledge
  ← Builds refresh logic knowing the token expiry
```

Agents run in isolated git worktrees. Dependencies auto-installed. Discovery briefs (~500 tokens each) relay knowledge between waves.

See [docs/FLEET.md](docs/FLEET.md).

---

## Writing Your Own Skills

The harness ships with 6 skills. You'll want more.

```
/create-skill
```

This interviews you about patterns you keep repeating and generates a complete skill file. Every skill you create follows the standard format, making the format the standard by adoption.

Or write one manually — it's just a markdown file with 5 sections:

```markdown
## Identity      ← Who is this skill?
## Orientation   ← When to use it?
## Protocol      ← Step-by-step instructions
## Quality Gates ← What must be true when done?
## Exit Protocol ← What to output?
```

See [docs/SKILLS.md](docs/SKILLS.md) for the full guide.

---

## Project Structure

```
.claude/
  settings.json           Hook lifecycle configuration
  harness.json            Project config (generated by /do setup)
  hooks/                  8 lifecycle hooks
  skills/                 Skill protocols (6 built-in + your own)
  agents/                 Agent definitions (archon, fleet, etc.)
  agent-context/          Context injected into sub-agents

.planning/
  intake/                 Work items pending processing
  campaigns/              Active + completed campaign files
  fleet/                  Fleet session state + discovery briefs
  coordination/           Multi-instance scope claims
  telemetry/              Agent run + hook timing logs

scripts/
  coordination.js         Multi-instance coordination CLI
  compress-discovery.cjs  Discovery brief compression
  telemetry-log.cjs       Agent and campaign event logging
  telemetry-report.cjs    Performance summaries
```

---

## Telemetry & Cost Tracking

The harness logs agent events, hook timing, and discovery compression to `.planning/telemetry/` (JSONL format, never leaves your machine).

```bash
npm run telemetry:report           # Agent run summary
npm run telemetry:report -- --hooks       # Hook timing averages
npm run telemetry:report -- --compression # Discovery compression ratios
```

Archon and Fleet log campaign start/complete, wave events, and per-agent results automatically. Hooks log their own timing on every invocation.

Token counts are logged when available. Claude Code doesn't currently surface per-session token usage to hooks, so cost tracking depends on your plan's usage dashboard.

---

## FAQ

**How is this different from just using CLAUDE.md?**

CLAUDE.md tells Claude about your project. The harness tells Claude *how to work* — routing decisions through the right tool, persisting state across sessions, enforcing quality through hooks, and coordinating parallel agents. CLAUDE.md is one piece. The harness is the operating system around it.

**How much does this cost in tokens?**

Skills cost zero tokens when not loaded — they're on-demand. The `/do` router costs ~500 tokens only when it needs Tier 3 classification (most requests resolve at Tier 0-2 for free). Hooks add minimal overhead (~100 tokens per edit for typecheck feedback). The main cost is the work itself, which you'd pay regardless.

**Can I use this with other AI coding tools?**

The harness is designed for Claude Code specifically. The skills, hooks, and agent definitions use Claude Code's extension points. The *concepts* (campaign files, quality gates, discovery relay) are portable, but the implementation assumes Claude Code.

**What's the difference between a skill and an agent?**

Skills load instructions into the current Claude session (no new process). Agents spawn a new Claude process with its own context window. Skills are cheap and fast. Agents are expensive but isolated.

---

## License

MIT

## Author

Seth Gammon ([@DevMoses](https://github.com/DevMoses))

Built while managing a 180K-line codebase solo. The harness is the distillation of what actually works when you run agents at scale.
