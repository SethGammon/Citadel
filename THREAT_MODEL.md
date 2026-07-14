# Threat Model

Version 3.0 (2026-07-13). Version 1 covered the core hook, campaign, and fleet
surfaces. Version 2 adds Teams Mode coordination, routine and daemon
automation, generated routing surfaces, the native memory write allowlist, and
the accepted residuals from the June 2026 audit. Version 3 adds Operation Fork,
cross-runtime worktrees, signed comparison evidence, local selection, landing,
and redacted replay.

Citadel is an agent orchestration harness for local coding runtimes. It adds
skills, hooks, scripts, generated configuration, and repo-local state so an AI
coding agent can route work, preserve context, coordinate campaigns, verify
changes, and produce handoffs.

This document describes the trust boundaries Citadel creates. It is not a
guarantee that every downstream project is safe. The repository being worked on,
the active coding runtime, installed tools, and user approvals remain part of
the security boundary.

## Security Goals

Citadel should:

- keep local project automation inspectable and reviewable
- keep destructive or externally visible actions behind approval boundaries
- avoid reading or publishing protected files by default
- make generated state easy to find before a user shares or commits it
- fail closed when a hook cannot validate a sensitive action
- leave enough telemetry and handoff evidence to audit what happened

Citadel does not try to:

- sandbox the entire operating system
- make an untrusted repository safe to run
- prevent every possible prompt-injection attempt
- replace the security model of Claude Code, OpenAI Codex, git, npm, shells, or
  other local tools
- guarantee that generated reports are free of private data

## Primary Assets

| Asset | Why it matters |
|---|---|
| Source files | The agent can modify code, docs, tests, and generated artifacts. |
| Secrets and credentials | `.env` files, tokens, keys, and private config must not be copied into prompts, logs, or public artifacts. |
| Repo-local planning state | `.planning/` can contain campaign details, research, screenshots, telemetry, cost data, local paths, and handoffs. |
| Runtime configuration | `.codex/`, `.claude/`, `.mcp.json`, and generated hook config influence future agent behavior. |
| Git branches and worktrees | Fleet and PR workflows can create, inspect, and coordinate parallel work. |
| External services | GitHub, package registries, MCP servers, and browser targets may have side effects or expose data. |

## Trust Boundaries

### User and Runtime

The user approves or denies actions through the active coding runtime. Citadel
can recommend commands and write approval capsules, but it should not hide the
scope or side effects of a privileged action.

### Repository

The current repository is trusted enough to inspect and modify. That does not
mean its scripts are safe. Package scripts, hooks, test commands, and project
instructions can still perform arbitrary local actions.

### Citadel Hooks

Hooks run inside the local development environment. They can inspect tool
requests, block actions, write telemetry, and add context. Hook failures should
prefer blocking or surfacing a repair over silently allowing sensitive actions.

### Generated State

Citadel writes state under paths such as `.planning/`, `.citadel/`, `.codex/`,
and `.claude/`. These files are useful for continuity, but they may contain
private project details. Users should review them before publishing.

### Agents and Sub-Agents

Parallel agents, Fleet sessions, and campaign continuations inherit project
context and may produce independent diffs or discoveries. Their output should be
merged only through reviewable branches, worktrees, review packages, or PRs.

### External Inputs

Issues, PR comments, webpages, dependency docs, local markdown, generated
reports, and screenshots are untrusted content. They may contain instructions
that conflict with user, system, runtime, or repository policy.

## Threats and Mitigations

| Threat | Example | Mitigation |
|---|---|---|
| Path traversal | A tool request tries to read `../../../secret` | protected-file and project-root validation |
| Protected file read | A prompt asks the agent to dump `.env` | protected-file rules and secret guidance |
| Shell injection | A branch name or file path is interpolated into a shell string | prefer argument-array process APIs and command validators |
| Prompt injection | A README or issue tells the agent to ignore instructions | instruction hierarchy, review posture, explicit trust boundaries |
| Unsafe package install | A task asks for dependency installation without durable project changes | approval gates and dependency drift checks |
| Public leak | A PR includes `.planning/telemetry` or screenshots with private details | ignored generated paths and manual review before publishing |
| Automation overreach | A campaign continues after scope has changed | campaign files, approval capsules, operator console, and PR readiness gates |
| Stale evidence | A readiness report refers to an old branch head | stack readiness checks and rerun requirements |
| Unreviewed merge | Fleet worktrees are accepted blindly | merge-review queues and explicit human approval boundaries |
| Fork comparison spoofing | A runtime claims success without equivalent proof | shared contract digests, signed receipts, required evidence coverage, and explicit unknown states |
| Duplicate landing | Recovery repeats a merge after losing state | persist unknown before the effect, block ambiguous recovery, and require idempotency |
| Replay leak | A public comparison exposes prompts, source, paths, or credentials | strict output allowlist, digest projection, and secret-like value rejection |

## Expanded Surfaces (v2)

Each surface below lists the attack, the existing mitigation, and the residual
risk that remains after the mitigation.

### Teams Mode coordination

Teams Mode (docs/FLEET.md) swaps the fleet coordination spine to native
messaging: `SendMessage` carries discoveries, and the TeammateIdle hook
(`hooks_src/teammate-idle.js`) appends idle signals to
`.planning/fleet/rebalance.jsonl`.

| Attack | Mitigation | Residual |
|---|---|---|
| `SendMessage` spoofing: a teammate, or injected content inside one, sends a forged discovery or status claim to the lead | Messages are ephemeral and never authoritative. The lead mirrors every discovery to `.planning/fleet/<session>/discoveries/`, and recovery reconciles only from the mirror, never from message history. Merges still pass human review. | No cryptographic teammate identity exists. A convincing forged message can waste lead turns and steer attention before review catches it. |
| `rebalance.jsonl` tampering: anything with project write access can append fake idle lines | The hook is observer-only; reassignment is always the lead's decision. Lines without teammate identity are skipped, and idle lines are ignored when nothing is reassignable. | Forged idle lines can cause reassignment churn. The file is telemetry, not an authorization channel, and must never become one without authentication. |
| Discovery-mirror poisoning: fake discovery files written directly into the mirror | Mirror content is untrusted input under the External Inputs boundary. Work merges only through reviewable branches and worktrees. | Poisoned discoveries are a prompt-injection vector into the lead before any human reviews the merge. |

### Routines, RemoteTrigger, and the daemon

`/daemon` (skills/daemon/SKILL.md) chains unattended sessions, by default
through a local runner (`scripts/local-daemon.js`) and optionally through
Anthropic's RemoteTrigger routine system (docs/ROUTINE-QUOTA.md).

| Attack | Mitigation | Residual |
|---|---|---|
| Unattended session chains: poisoned campaign state keeps a chain alive doing attacker-directed work overnight | Every tick passes status, lock, budget, and campaign gates. The SessionStart bridge in `hooks_src/init-project.js` independently re-checks lock, budget, and campaign liveness in code before prompting `/do continue`. Trust gating blocks the daemon for new operators. | Most tick gates are protocol the model follows, not code. Only the init-project bridge is enforced in code. |
| Quota exhaustion: RemoteTrigger runs count against the account-wide cap of 15 routine runs per 24 hours; a runaway chain pauses every routine on the account | The local runner is the default path. `--remote` requires an explicit warning and user confirmation. | An approved `--remote` daemon can still exhaust the cap in one overnight run. Accepted as a documented trade-off. |
| Budget tampering: `.planning/daemon.json` holds `budget` and `estimatedSpend`; any project write can raise the cap or reset spend | The file is plain, reviewable repo-local state. The daemon discloses its budget at start, and real session costs are recorded separately in `.planning/telemetry/session-costs.jsonl`. | The budget is an honest-operator control, not a security boundary against an agent that already has project write access. Accepted. |

### Generated routing surfaces

`scripts/generate-routing.js` compiles `trigger_keywords` frontmatter from
every skill into `core/skills/routing-table.json`, the `/do` table in
`skills/do/SKILL.md`, and demo data in `docs/index.html`.
`scripts/generate-doc-surfaces.js` rewrites doc-count markers the same way.

- Attack: poisoned skill frontmatter (for example a malicious skill PR) flows
  into routing keywords and descriptions that the router reads as trusted
  instructions, or into doc-count markers.
- Mitigation: generation is deterministic, and drift checks (`--check` mode,
  `scripts/test-routing-sync.js`, `scripts/test-doc-surfaces.js`, enforced by
  `scripts/test-all.js`) guarantee generated surfaces match the reviewable
  frontmatter exactly. Nothing diverges silently between review and runtime.
- Residual: drift checks prove provenance, not safety. A malicious description
  that survives PR review reaches the routing surfaces verbatim. Review of
  skill frontmatter remains the real boundary.

### Native memory write allowlist

`hooks_src/protect-files.js` blocks Edit/Write outside the project root, with
one carve-out: `isNativeMemoryPath` permits writes into the Claude Code native
auto-memory directory, `<home>/.claude/projects/<slug>/memory/`.

- Why it is bounded: the path is normalized and traversal-checked first, the
  slug must be a single path segment, and `memory` must be the segment
  immediately after it. `.env` reads remain blocked everywhere by basename.
- Residual: the allowlist matches any project slug, not only the current
  project, and allowlisted writes skip the protected-pattern check. Memory
  files are prompt context, so a poisoned memory write is an injection vector
  into future sessions. Accepted as low risk: memory is plain markdown,
  reviewable, and never executed.

### Operation Fork

Operation Fork stores its canonical manifest, private objective and workflow, signing key,
events, and receipts under `.planning/operation-forks/`. Runtime worktrees live under a
separate configured root. Mission Control projects the manifest and may record selection,
but it cannot execute landing.

| Attack | Mitigation | Residual |
|---|---|---|
| Runtime branch escapes into the main repository or another branch | Worktree roots must resolve outside the project. IDs and refs use strict patterns. Existing path segments reject symlinks. Every process receives one contained working directory. | The agent runtime still has the operating-system permissions granted by the user. Citadel is not an OS sandbox. |
| Malicious objective or verifier injects a shell command | Runtime prompts go through stdin. Verifiers are an executable plus literal argument array and run with `shell: false`. | A declared executable can itself be malicious, including package scripts in an untrusted repository. The repository and chosen verifier remain trusted inputs. |
| One branch fabricates a better result | Comparison requires the shared contract digest, a locally verified signed receipt, complete required evidence, and a conclusive verifier status. Cost and speed cannot outrank missing proof. | The local signing key proves Citadel produced the receipt, not that an external auditor trusted the project or verifier. Independent trust roots remain a separate milestone. |
| Crash after a nonrepeatable effect causes duplicate work | Citadel writes the in-progress state before runtime or merge effects. Recovery blocks an ambiguous effect and never invokes it again. Idempotency keys make completed selection and landing calls stable. | Ambiguous state needs human inspection. Citadel deliberately trades automatic recovery for avoiding a repeated merge or external effect. |
| Browser selection becomes an unreviewed merge | The endpoint accepts six exact fields, checks origin, process nonce, JSON size, fork revision, and branch evidence, and returns `landing_effect: none`. Landing exists only in the CLI and requires a fresh confirmation token. | Any local process under the same user can potentially interact with localhost. The process nonce and strict origin reduce browser abuse but are not cross-user authentication. |
| Public replay leaks project information | Replay is built from a fixed allowlist and digests. It excludes objective text, operation title, source, diffs, worktree and branch refs, repository identity, paths, environment, command output, reasons, raw revisions, credentials, and signer material. A secret-like scan fails closed. | Opaque IDs, timing, counts, and digests can still reveal operational shape. Operators should inspect every public artifact before sharing. |

## Accepted Residuals (June 2026 audit)

These were found, analyzed, and explicitly accepted. They are not open bugs.

- Quoted-target Bash bypass: `echo X > ".env"` passes the external action gate
  because `stripQuotedContent` in `core/policy/external-actions.js` erases
  quoted strings before pattern matching, which erases the quoted redirect
  target. Accepted: quote stripping is what prevents false positives on commit
  messages and documentation strings, the Edit/Write path still blocks `.env`,
  and this vector writes secrets rather than reading them.
- Copy-from and uncommon-tool read vectors: `cp .env /tmp/x`, `dd if=.env`,
  and `sed`-style reads are not in `SECRETS_PATTERNS`. The list covers the
  read commands agents actually emit (cat, source, head, tail, grep, less,
  more) and the write vectors (redirect, tee, cp/mv with `.env` as target).
  Accepted: enumerating every exfiltration tool with regex is not achievable;
  covering arbitrary shell belongs to the runtime sandbox, which remains part
  of the security boundary.
- Per-tool-call hook process spawn: every gated tool call spawns fresh Node
  processes for its hooks. This is the dominant harness overhead. Accepted for
  now: fail-closed correctness outweighs latency. The overhead is tracked as
  the "Hook overhead p95" North Star metric in docs/ROADMAP.md (target under
  200 ms per tool call). No dispatcher consolidation has shipped, and none is
  committed beyond meeting that metric.

## Approval-Bound Actions

Citadel should preserve approval boundaries around actions that are destructive,
externally visible, networked, credential-sensitive, or hard to undo.

Examples:

- deleting, moving, or rewriting broad file trees
- installing dependencies or changing lockfiles
- running unfamiliar project scripts
- pushing branches, opening PRs, merging PRs, publishing packages, or creating
  releases
- changing hook policy, runtime configuration, or MCP server setup
- sending outreach, email, API requests, or other external communications
- exposing local app servers outside loopback

## Generated Artifact Review

Before publishing a PR or sharing a demo, inspect generated artifacts for local
paths, private project names, secrets, screenshots, or unrelated findings.

High-risk generated paths include:

- `.planning/research/`
- `.planning/telemetry/`
- `.planning/screenshots/`
- `.planning/handoffs/`
- `.planning/review-packages/`
- `.planning/pr-readiness/`
- `.planning/approval-capsules/`

These paths are valuable evidence, not automatically public documentation.

## Contributor Checklist

When a PR changes security-sensitive behavior, the PR should answer:

- Which trust boundary changed?
- What user-visible approval or report proves the boundary?
- What happens when validation fails?
- Which tests cover the sensitive path?
- Which generated files might contain private data?
- Does the change affect Claude Code, OpenAI Codex, or both?

Run:

```bash
npm run test
```

For hook-specific changes, also run:

```bash
node hooks_src/smoke-test.js
node scripts/verify-hooks.js
node scripts/integration-test.js
```

## Current Review Posture

Citadel review should be strict around:

- hook behavior
- runtime adapters
- installer output
- generated config
- file protection
- command execution
- MCP surfaces
- Fleet and campaign automation
- PR readiness and merge approval

Documentation changes should avoid overclaiming safety. If a guarantee depends
on the active runtime or project scripts, say so directly.
