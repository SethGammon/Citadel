<img src="assets/citadel-hero.svg" width="100%" alt="Citadel, an operating layer for Claude Code and OpenAI Codex" />

<div align="center">

[![Tests](https://github.com/SethGammon/Citadel/actions/workflows/tests.yml/badge.svg)](https://github.com/SethGammon/Citadel/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)
[![Interactive demo](https://img.shields.io/badge/Interactive_demo-00d2ff.svg)](https://sethgammon.github.io/Citadel/)

**An open-source operating layer for Claude Code and OpenAI Codex.**

Citadel helps coding agents work reliably across real repositories. It routes requests, preserves project state between sessions, coordinates parallel work, applies repository safeguards, and records verification and handoffs.

[Quick install](#quick-install) | [Start using it](#start-using-it) | [Is it a fit?](#when-citadel-is-useful) | [Portable operations](#portable-operations) | [Documentation](#choose-your-documentation)

</div>

## Quick install

**Requires:** Claude Code or OpenAI Codex, Node.js 18+, and a git repository.

Open the repository you want Citadel to manage, then paste this into your coding agent:

```text
Install Citadel in this repository.

Use https://github.com/SethGammon/Citadel as the source. If a local clone
already exists, reuse it or update it. Detect whether this session is running
in OpenAI Codex or Claude Code. From this project's root, run the matching
Citadel installer and report any plugin-enable or restart step it prints.

Use the current repository as the target. Do not require placeholder paths.
```

Follow any printed enable step, start a fresh session if prompted, then run:

```text
/do setup --express
```

Setup installs the project hooks and creates the repo-local state Citadel uses to resume work later.

<details>
<summary><strong>Manual installation</strong></summary>

<br>

Clone Citadel once:

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
```

From the repository you want Citadel to manage, run the installer for your runtime.

**OpenAI Codex**

```bash
node ~/Citadel/scripts/install.js --runtime codex --add-marketplace
```

**Claude Code**

```bash
node ~/Citadel/scripts/install.js --runtime claude --install --scope local
```

Start a fresh session in the same repository and run `/do setup --express`.

</details>

Dry runs, generated paths, runtime-specific setup, and rollback are documented in [Installation](INSTALL.md).

## Start using it

<img src="assets/terminal-demo.svg" width="100%" alt="A Citadel terminal session routing a request, running checks, and writing a handoff" />

You do not need to learn the skill catalog. Start with `/do` and describe the outcome:

```text
/do review README.md
/do generate tests for the changed files
/do next
```

| Command | What it gives you |
|---|---|
| `/do <request>` | Selects and runs the appropriate workflow |
| `/do next` | Shows active work, risks, and the next useful action |
| `/dashboard` | Opens Mission Control for campaigns, agents, operations, hooks, and handoffs |
| `/cost` | Reports token use and session cost from available local telemetry |

For a copyable walkthrough in a real repository, use the [demo workflow](DEMO.md).

## When Citadel is useful

Citadel is most useful when coding-agent work extends beyond a single prompt:

| You are dealing with... | Citadel adds... |
|---|---|
| Repeated setup and lost context | Repo-local campaigns, decisions, discoveries, and handoffs |
| Unclear workflow choice | One natural-language entry point through `/do` |
| Risky or multi-step changes | Approval boundaries, lifecycle hooks, and explicit verification |
| Several agents or branches | Isolated worktrees, ownership, and shared discoveries |
| Work that must survive interruption | Durable state, recovery, and a concrete next action |

For a short, one-off edit, your coding agent may already be enough. Citadel becomes valuable when the operating discipline around the agent is the hard part.

Citadel does not replace `CLAUDE.md` or `AGENTS.md`. Those files describe the project and its rules. Citadel supplies the workflows and state used to carry them out consistently.

## One operating loop

<img src="assets/loop-flow.svg" width="100%" alt="The Citadel lifecycle: route, execute, protect, verify, record, and resume" />

1. **Route:** `/do` chooses a focused skill, a coordinated session, a persistent campaign, or a parallel fleet.
2. **Execute and verify:** hooks apply repository rules, gate consequential actions, and capture required checks.
3. **Record and resume:** Citadel writes the result, handoff, and next action to the repository for the next session.

The repository remains the source of truth. Citadel adds an operating layer around the coding agent rather than replacing its runtime.

## Portable operations

Portable operations are optional. They are for work that needs a stable contract, durable recovery, comparable executors, or a verifiable receipt. Ordinary repository work still begins with `/do`.

<img src="output/playwright/operation-fork-comparison.png" width="100%" alt="Operation Fork comparing Claude Code and Codex branches under one shared contract" />

| If you need to... | Start here |
|---|---|
| Run the same objective through isolated Claude Code and Codex branches | [Operation Fork](docs/OPERATION_FORK.md) |
| Package a repeatable result with permissions, checks, and stopping conditions | [Outcome Packs](docs/PACKS.md) |
| Inspect or control a running operation | [Mission Control](docs/DASHBOARD_SPEC.md) |

The underlying [Operations Protocol](docs/OPERATIONS_PROTOCOL.md) defines the runtime-neutral contracts for operations, attempts, intents, evidence, and receipts. Most users do not need those internals to use Citadel.

## Trust and scope

- Citadel runs with the permissions of Claude Code or Codex. It does not replace code review, branch protection, or repository-specific checks.
- Verification artifacts report `passed`, `failed`, `blocked`, or `unknown`. Missing evidence is not promoted to success.
- Project state and telemetry stay local by default. Nothing is transmitted automatically.
- The automated suite validates Citadel's contracts and supported fixtures. It does not guarantee the quality of an agent's code.

Read [Security](SECURITY.md), the [threat model](THREAT_MODEL.md), and [golden-path verification](docs/GOLDEN_PATH.md) for the full boundaries.

## Choose your documentation

| Goal | Recommended path |
|---|---|
| Install or evaluate Citadel | [Installation](INSTALL.md), [Demo](DEMO.md), [Choosing Citadel](docs/CHOOSING_CITADEL.md) |
| Operate day to day | [Campaigns](docs/CAMPAIGNS.md), [Fleet](docs/FLEET.md), [Hooks](docs/HOOKS.md), [Mission Control](docs/DASHBOARD_SPEC.md) |
| Use portable operations | [Operation Fork](docs/OPERATION_FORK.md), [Outcome Packs](docs/PACKS.md), [Recovery](docs/OPERATION_RECOVERY.md) |
| Integrate or verify | [CLI reference](docs/CLI.md), [Interoperability](docs/INTEROPERABILITY.md), [Reports](docs/REPORT_ARTIFACTS.md) |

The complete reference is in [`docs/`](docs/).

<details>
<summary><strong>Project footprint</strong></summary>

<br>

The current package includes <!-- GENERATED: skill-count -->49<!-- /GENERATED --> workflows and <!-- GENERATED: hook-script-count -->35<!-- /GENERATED --> hook scripts across <!-- GENERATED: hook-event-count -->29<!-- /GENERATED --> lifecycle events. `/do` selects among them; they are not a prerequisite checklist.

Citadel keeps operational state separate from application code:

```text
.planning/                 Campaigns, operations, fleet sessions, intake, and telemetry
.citadel/scripts/          Project-local coordination and reporting utilities
.claude/agent-context/     Rules supplied to delegated agents
.claude/harness.json       Project configuration generated by setup
```

Runtime adapters may add Claude Code or Codex configuration files. [Installation](INSTALL.md) lists every generated path and its rollback procedure.

</details>

## Common questions

<details>
<summary><strong>Do I need to learn every skill or operation command?</strong></summary>

<br>

No. Start with `/do`. Operation commands are only for work that needs durable contracts, receipts, recovery, or runtime comparison.

</details>

<details>
<summary><strong>Does Citadel work on Windows?</strong></summary>

<br>

Yes. The hooks and scripts run on Node.js, and the Codex installer includes Windows-specific readiness checks.

</details>

<details>
<summary><strong>How do I remove it?</strong></summary>

<br>

Use `/unharness` to export useful state and remove Citadel-managed project files. [Installation](INSTALL.md) also documents the exact rollback paths.

</details>

## Community

- [GitHub Discussions](https://github.com/SethGammon/Citadel/discussions) for questions, use cases, and workflow requests
- [Contributing](CONTRIBUTING.md) for issues, pull requests, skills, and documentation
- [MIT License](LICENSE)
