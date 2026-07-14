<img src="assets/citadel-hero.svg" width="100%" alt="Citadel - orchestration for Claude Code and OpenAI Codex" />

<div align="center">

[![Tests](https://github.com/SethGammon/Citadel/actions/workflows/tests.yml/badge.svg)](https://github.com/SethGammon/Citadel/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)
[![Interactive demo](https://img.shields.io/badge/Interactive_demo-00d2ff.svg)](https://sethgammon.github.io/Citadel/)

**Repository-level orchestration for Claude Code and OpenAI Codex.**

Citadel adds repeatable workflows, persistent project state, safety hooks, verification, cost reporting, and coordinated agents to an existing repository. Its operations layer can also run the same objective through isolated runtimes and compare their results under one contract.

[Quick install](#quick-install) · [First run](#first-run) · [Operations](#portable-operations) · [How it works](#how-do-works) · [Documentation](#documentation)

</div>

## Quick install

**Requires:** Claude Code or OpenAI Codex, Node.js 18+, and a git repository.

Open the repository you want Citadel to manage, then paste this into your coding agent:

```text
Install Citadel in this repository.

Use https://github.com/SethGammon/Citadel as the source. If a local clone
already exists, reuse it or update it. Detect whether this session is running
in OpenAI Codex or Claude Code. From this project's root, run the matching
Citadel installer and follow any printed plugin enable step.

After Citadel is enabled in a fresh thread, run:

/do setup --express

Use the current repository as the target project. Do not require placeholder
path edits.
```

When the installer finishes, follow any printed plugin-enable step and start a fresh session if prompted. Then run:

```text
/do setup --express
```

This initializes Citadel for the repository, installs its hooks, and creates the local state used to resume work later.

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

For dry runs, runtime-specific setup, generated paths, and rollback instructions, see the [installation guide](INSTALL.md).

## First run

<img src="assets/terminal-demo.svg" width="100%" alt="A Citadel terminal session routing a request, running checks, and writing a handoff" />

You can work through `/do` without learning Citadel's individual skills first:

```text
/do next
/do review README.md
/do generate tests for the changed files
/cost
```

| Command | Purpose |
|---|---|
| `/do <request>` | Select and run the appropriate workflow |
| `/do next` | Show current work, risks, and the next recommended action |
| `/dashboard` | Inspect campaigns, agents, operations, hooks, handoffs, and source health |
| `/cost` | Report token use and session cost from available telemetry |

The [demo workflow](DEMO.md) provides a copyable walkthrough for a real repository.

## What Citadel adds

| Capability | How it helps |
|---|---|
| **Request routing** | `/do` maps a plain-language request to a direct action, focused skill, campaign, or parallel fleet |
| **Continuity** | Campaigns, discoveries, operations, and handoffs are stored in repo-local `.planning/` files and can be resumed in a fresh session |
| **Project safeguards** | <!-- GENERATED: hook-script-count -->35<!-- /GENERATED --> hook scripts across <!-- GENERATED: hook-event-count -->29<!-- /GENERATED --> lifecycle events protect configured files, gate risky actions, run checks, and record outcomes |
| **Parallel work** | Fleet agents use isolated git worktrees and share discoveries between coordinated waves |
| **Portable operations** | Typed contracts, durable journals, signed receipts, and deterministic recovery make a workflow inspectable across execution targets |
| **Operational visibility** | Mission Control, `/dashboard`, and `/cost` expose current state, missing evidence, controls, token use, and session spend |
| **Extensible workflows** | <!-- GENERATED: skill-count -->49<!-- /GENERATED --> included skills and three first-party Outcome Packs cover common engineering and project operations |

Citadel does not replace `CLAUDE.md` or `AGENTS.md`. Those files describe the project and its rules; Citadel provides the workflows and state used to carry them out consistently.

## Portable operations

Citadel supports longer-lived work that needs a defined contract, durable recovery, or more than one executor. These features are optional; ordinary repository work still starts with `/do`.

### Compare runtimes with Operation Fork

Operation Fork creates isolated Claude Code and Codex worktrees from the same commit, runs both against one objective, verifies each result, and presents an evidence-bound comparison.

```text
citadel fork start "Find and eliminate the authentication race"
citadel fork status fork-find-and-eliminate-the-authentication-race
citadel fork compare fork-find-and-eliminate-the-authentication-race
```

<img src="output/playwright/operation-fork-comparison.png" width="100%" alt="Operation Fork comparing Claude Code and Codex branches under one shared contract" />

Missing receipts remain `unknown`; equal verified outcomes remain a tie. Selection records an operator decision but does not merge code. Landing is a separate action that rechecks the selected receipt, fork revision, target revision, clean worktree, and confirmation token.

```text
citadel fork select ID --branch branch-codex --expected-revision 6 --idempotency-key choose-codex-001
citadel fork land plan ID
citadel fork land apply ID --expected-revision 7 --target-revision SHA --confirm TOKEN --idempotency-key land-codex-001
citadel fork replay ID --output operation-fork-replay.json
```

The replay excludes prompts, source, repository identity, paths, credentials, reasons, raw revisions, and signing keys. See the [Operation Fork contract](docs/OPERATION_FORK.md) for the complete lifecycle and trust boundaries.

### Run a defined Outcome Pack

The Operations Protocol defines typed specs, runs, attempts, intents, evidence, and receipts. Outcome Packs package that contract for a specific result, including permissions, dependencies, verification, and stopping conditions.

```text
citadel pack inspect ci-recovery
citadel journey start --run-id run-ci-recovery --pack ci-recovery --runtime codex --project .
citadel receipt verify --input .planning/operations/run-ci-recovery/receipt.json
```

| Layer | Current role |
|---|---|
| **Operations Protocol v0.1** | Six strict contracts, compatibility rules, conformance checks, journals, and recovery |
| **Outcome Packs** | First-party CI recovery, migration campaign, and release steward workflows |
| **Mission Control** | Typed pause, resume, stop, retry, and runtime comparison controls with revision checks |
| **Proof ledger** | Deterministic projections of passed, failed, blocked, and unknown outcomes |
| **GitHub verification Action** | A narrow read-only target that runs a declared workflow and emits a receipt |

<img src="output/playwright/mission-control-confirmation-fixed.png" width="100%" alt="Mission Control showing a running operation and an explicit stop confirmation" />

The CLI and provenance workflow are implemented in this repository. Registry publication, outside Pack authors, hosted Relay, and independent adoption remain external milestones rather than shipped claims.

## How `/do` works

### 1. Route the request

<img src="assets/routing-flow.svg" width="100%" alt="A request moving through pattern, active-state, keyword, and classifier routing tiers" />

The router checks inexpensive local signals first: direct patterns, active campaign state, and known workflow keywords. It uses an LLM classifier only when those checks cannot determine the appropriate path.

### 2. Run the workflow

Citadel chooses among four execution levels based on the scope of the request:

<table>
<tr>
<td width="50%"><img src="assets/card-skill.svg" width="100%" alt="Skill - a focused workflow for one domain" /></td>
<td width="50%"><img src="assets/card-marshal.svg" width="100%" alt="Marshal - coordinates several workflows in one session" /></td>
</tr>
<tr>
<td width="50%"><img src="assets/card-archon.svg" width="100%" alt="Archon - manages work that continues across sessions" /></td>
<td width="50%"><img src="assets/card-fleet.svg" width="100%" alt="Fleet - coordinates parallel agents in isolated worktrees" /></td>
</tr>
</table>

- **Skill:** one focused task, such as a review or refactor.
- **Marshal:** several related tasks completed in one session.
- **Archon:** a campaign that persists across multiple sessions.
- **Fleet:** parallel work with explicit ownership and shared discoveries.

You can invoke these directly, but `/do` is the normal entry point.

### 3. Verify and preserve the result

<img src="assets/loop-flow.svg" width="100%" alt="The Citadel lifecycle: route, execute, protect, verify, record, and resume" />

Hooks apply the repository's safety rules, capture verification results, and write the handoff and next action to disk. A later session reads that state before deciding what to do next.

## Files added to a project

Citadel keeps operational state separate from application code:

```text
.planning/                 Campaigns, operations, fleet sessions, intake, and telemetry
.citadel/scripts/          Project-local coordination and reporting utilities
.claude/agent-context/     Rules supplied to delegated agents
.claude/harness.json       Project configuration generated by setup
```

Runtime-specific adapters may also create Claude Code or Codex configuration files. The [installation guide](INSTALL.md) lists each generated path and the rollback procedure.

## Verification and scope

The automated suite covers hooks, skills, generated runtime artifacts, operation contracts, recovery, receipts, Packs, the GitHub Action, and full pre-tool/post-tool sequences. The [golden-path matrix](docs/GOLDEN_PATH.md) checks installation, setup, routing, verification, handoff, resume, and rollback for Claude Code and Codex fixtures across Windows, Linux, and macOS.

Run the repository checks locally with:

```bash
npm test
```

Fixture results verify Citadel's contracts; they do not measure human adoption or guarantee the quality of an agent's code. Citadel operates with the permissions of the underlying runtime, and consequential changes still require review. See the [security model](SECURITY.md), [threat model](THREAT_MODEL.md), and [external milestone gates](docs/EXTERNAL_MILESTONE_GATES.md) for the boundaries.

If Citadel has completed a real task in your repository, `node .citadel/scripts/activation-telemetry.js share` creates a local, reviewable cohort bundle. Nothing is transmitted automatically. See the [activation cohort protocol](docs/PRODUCT_PROOF_TRIAL.md) before choosing whether to share it.

## Documentation

| Start here | Operate Citadel | Protocols and evaluation |
|---|---|---|
| [Installation](INSTALL.md) | [Campaigns](docs/CAMPAIGNS.md) | [Operation Fork](docs/OPERATION_FORK.md) |
| [Demo workflow](DEMO.md) | [Fleet coordination](docs/FLEET.md) | [Operations Protocol](docs/OPERATIONS_PROTOCOL.md) |
| [Interactive routing demo](https://sethgammon.github.io/Citadel/) | [Skills](docs/SKILLS.md) | [Outcome Packs](docs/PACKS.md) |
| [Routing preview](docs/ROUTING_PREVIEW.md) | [Hooks](docs/HOOKS.md) | [GitHub verification Action](docs/ACTION.md) |
| [Choosing Citadel](docs/CHOOSING_CITADEL.md) | [Reports and telemetry](docs/REPORT_ARTIFACTS.md) | [Golden-path verification](docs/GOLDEN_PATH.md) |
| [CLI reference](docs/CLI.md) | [Mission Control](docs/DASHBOARD_SPEC.md) | [Product benchmark](docs/BENCHMARK.md) |
| [FAQ below](#faq) | [Operation recovery](docs/OPERATION_RECOVERY.md) | [Roadmap](docs/ROADMAP.md) |

The complete documentation index is available in [`docs/`](docs/).

## FAQ

<details>
<summary><strong>Who is Citadel for?</strong></summary>

<br>

Developers using Claude Code or Codex on repositories where work spans repeated tasks, multiple sessions, portable operations, or parallel changes. A single short coding task usually does not need a harness.

</details>

<details>
<summary><strong>How is Citadel different from Superpowers, CrewAI, or LangGraph?</strong></summary>

<br>

Citadel operates coding agents inside an existing repository. Superpowers provides a development methodology and can run alongside Citadel. CrewAI, LangChain, and LangGraph are frameworks for building agent applications or runtimes. The [comparison guide](docs/CHOOSING_CITADEL.md) covers cases where another tool is a better fit.

</details>

<details>
<summary><strong>Do I need to learn every skill or operation command?</strong></summary>

<br>

No. Start with `/do` and describe the outcome you want. Operation commands are for work that specifically needs durable contracts, receipts, or runtime comparison.

</details>

<details>
<summary><strong>Does Citadel work on Windows?</strong></summary>

<br>

Yes. The hooks and scripts run on Node.js, and the Codex installer includes Windows-specific readiness checks.

</details>

<details>
<summary><strong>How do I remove it?</strong></summary>

<br>

Use `/unharness` to export useful state and remove Citadel-managed project files. The [installation guide](INSTALL.md) also documents exact rollback paths.

</details>

## Community and contributing

- [GitHub Discussions](https://github.com/SethGammon/Citadel/discussions) for questions, use cases, and workflow requests
- [Contributing guide](CONTRIBUTING.md) for issues, pull requests, skills, and documentation
- [Activation cohort protocol](docs/PRODUCT_PROOF_TRIAL.md) for optional, privacy-bounded real-use evidence

## License

[MIT](LICENSE)
