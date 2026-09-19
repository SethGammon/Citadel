# opencode Runtime Support — Investigation and Plan

Date: 2026-09-10
Status: phases 1-6 landed; 1-5 live-verified on opencode 1.18.30 / Bun 1.4.2, all three phase-5 follow-ups closed, phase 6 delivered by deferred injection (re-prompt deliberately declined)

2026-09-17 correction: external installs now copy skills to
`.citadel/skills`, install thin utility delegates in `.citadel/scripts`, and
rewrite allowlisted canonical `node scripts/...` routes to explicit
`node .citadel/scripts/...` delegate paths in that generated projection only.
The plugin does not rewrite `bash` commands, because a target repository can have
its own `scripts/dashboard.js`. A `shell.env` hook supplies OpenCode
runtime/project identity. The readiness check executes `/do status`'s dashboard
route instead of proving discovery alone.

Verified against the opencode source at `anomalyco/opencode@dev` (shallow clone,
2026-09-10), specifically `packages/plugin/src/index.ts`,
`packages/opencode/src/plugin/index.ts`, `packages/opencode/src/session/tools.ts`,
`packages/opencode/src/session/prompt.ts`, `packages/opencode/src/skill/index.ts`,
`packages/opencode/src/session/instruction.ts`, `packages/opencode/src/config/`,
and `packages/web/src/content/docs/plugins.mdx` (the published
https://opencode.ai/docs/plugins/ page).

## 1. Verdict

Yes. opencode is a better fit for Citadel than Codex was, with one structural
difference that drives the whole design: **opencode has no command hooks.**
Claude Code and Codex both run `node hooks_src/<hook>.js`, feed it JSON on
stdin, and read exit code 2 as "block". opencode has **in-process plugins** —
async JS/TS functions loaded into the agent process (Bun) that mutate a shared
`output` object and `throw` to block.

So the adapter sits one layer lower than `hooks_src/codex-adapter.js`. Instead
of translating a hook *config map* into a runtime's hook config, we ship an
actual opencode plugin that **spawns the existing `hooks_src/*.js` processes**
and translates their exit codes and stderr back into opencode's
throw/mutate semantics. Every one of the 30+ existing hooks is reused
unchanged; no hook logic is rewritten.

Non-hook surfaces are close to free:

| Surface | opencode native path | Citadel work |
|---|---|---|
| Guidance | `AGENTS.md`, then `CLAUDE.md` (`session/instruction.ts:61-68`) | **its own renderer.** This row first said "reuse Codex's `AGENTS.md` renderer"; both target `AGENTS.md`, but the Codex output calls itself the Codex projection and tells the reader to invoke skills as `$skill-name`, which is wrong for opencode. Rendered from `.citadel/project.md`, never overwriting an existing file |
| Skills | also every path in `skills.paths`, scanned `**/SKILL.md` (`skill/index.ts:211-219`) | Copy a machine-local projection to `.citadel/skills`, register that relative path, and install utility delegates. Needs opencode >= 1.18.30 |
| Agents | `.opencode/{agent,agents}/**/*.md` (`config/agent.ts:13`) | thin projector, mirror `runtimes/codex/generators/project-agents.js` |
| Commands | `.opencode/{command,commands}/**/*.md` | Generate `.opencode/commands/*.md` wrappers. OpenCode skills have no slash-command argument channel; each wrapper passes `$ARGUMENTS` into the corresponding skill prompt. |
| MCP | `opencode.json` `mcp` block | config emit for `citadel-state`, `codebase-memory` |
| Plugin install | `.opencode/{plugin,plugins}/*.{ts,js}` auto-discovered, or `plugin: []` in `opencode.json` (`config/config.ts:476`, `config/plugin.ts:21`) | emit one file |

## 2. The hook mechanism, precisely

### 2.1 Contract

`packages/plugin/src/index.ts` — every lifecycle hook is
`(input, output) => Promise<void>`. `packages/opencode/src/plugin/index.ts`
dispatches them:

```ts
for (const hook of s.hooks) {
  const fn = hook[name] as any
  if (!fn) continue
  yield* Effect.promise(async () => fn(input, output))
}
return output
```

Three consequences that shape the adapter:

1. **Hooks are sequential and awaited.** Ordering is deterministic; a slow hook
   stalls the turn. opencode applies **no timeout**. The adapter must enforce
   the per-hook timeouts already declared in `hooks/hooks-template.json`.
2. **Blocking is `throw`.** `Effect.promise` turns a rejection into a defect.
   Confirmed scoped, not fatal, by opencode's own test
   (`test/tool/code-mode.test.ts:429`): *"a failing before hook fails only that
   child call as a catchable in-program error"*. The thrown message reaches the
   model as the tool result. This is exactly Citadel's exit-2 + stderr contract.
3. **Mutation is in place, on the same object.** `session/tools.ts:104-112`:

   ```ts
   const ctx = context(args, options)
   yield* plugin.trigger("tool.execute.before", { tool: item.id, ... }, { args })
   const result = yield* item.execute(args, ctx)
   ```

   `item.execute` receives the original `args`, not `output.args`. **Mutating
   `output.args.command` works; reassigning `output.args = {...}` is silently
   discarded.** Same pattern for `chat.message`: `prompt.ts:999` passes
   `resolvedParts` and then iterates that same array, so *pushing* a part
   injects context, *replacing* `output.parts` does not. This is a sharp edge
   worth a comment in the adapter and a regression test.

   **The pushed part must be a materialized `Part`, not the input shape.**
   Observed on 1.18.30 in phase 6: `output.parts` holds parts carrying `id`
   (`^prt`), `sessionID` and `messageID`, and `createUserMessage` validates every
   entry before saving. A part missing them does not degrade quietly — the whole
   prompt request fails with HTTP 500 and the turn never runs. See phase 6.

### 2.2 Event mapping

`tool.execute.before` fires from four call sites — the generic tool wrapper
(`session/tools.ts:107`), MCP resource tools (`:176`, `:259`, `:339`, `:403`),
the `task` subagent path (`session/prompt.ts:308`), and code-mode
(`tool/code-mode.ts:142`) — so coverage of tool calls is complete. It runs
**before** the tool's own `ctx.ask()` permission prompt, which makes it a
stronger gate than Claude Code's `PermissionRequest`.

| Citadel event | opencode | Support | Note |
|---|---|---|---|
| `pre_tool` | `tool.execute.before` | full | throw = block; in-place arg mutation |
| `post_tool` | `tool.execute.after` | full | can rewrite `output.output`/`title`/`metadata` |
| `user_prompt_submit` | `chat.message` | partial | push a full `Part` (id/sessionID/messageID) onto `output.parts`; no block |
| `session_start` | plugin init function | full | runs once per project directory per server instance |
| `session_end` | `dispose()` | partial | instance teardown, not per-session |
| `pre_compact` | `experimental.session.compacting` | partial | experimental; can append context or replace prompt |
| `post_compact` | `session.compacted` event | partial | observe-only |
| `stop` | `session.idle` event | **degraded** | observe-only; see 2.4 |
| `config_change` | `config` hook | full | receives full resolved config |
| `file_changed` | `file.edited`, `file.watcher.updated` events | full | observe-only |
| `permission_request` | `permission.asked` event | **degraded** | see 2.3 |
| `permission_denied` | `permission.replied` event | partial | observe-only, and **not** statically mapped: a reply may allow or deny, so only the adapter can tell whether it is a denial |
| `task_created` / `task_completed` | `session.created`, `task` tool hooks | partial | |
| `post_tool_batch`, `post_tool_failure`, `stop_failure`, `user_prompt_expansion`, `instructions_loaded`, `cwd_changed`, `elicitation*`, `teammate_idle`, `worktree_*` | — | none | no equivalent; skip with a recorded warning, same as the Codex installer does |

### 2.3 `permission.ask` is a trap

The SDK declares
`"permission.ask"?: (input: Permission, output: { status: "ask"|"deny"|"allow" })`.
It is **never triggered** — `grep -rn '"permission.ask"' packages/opencode/src`
returns nothing outside the type definition. Upstream issues
[#7006](https://github.com/anomalyco/opencode/issues/7006) and
[#9229](https://github.com/anomalyco/opencode/issues/9229) (closed as
duplicate) confirm the active permission module only publishes `permission.asked`
bus events. **Do not build the security gate on this hook.** Citadel's
`protect-files` and `external-action-gate` must ride `tool.execute.before`,
where blocking is real and tested. `permission-request.js` degrades to
observe-only on the `event` hook.

### 2.4 `stop` cannot block

`plugin/index.ts` dispatches bus events fire-and-forget:

```ts
for (const hook of hooks) {
  void hook["event"]?.({ event: { id: event.id, type: event.type, properties: event.data } as any })
}
```

`void` — not awaited, rejections swallowed. So `session.idle` is pure
observation and `quality-gate` loses its ability to force continuation. Two
recoveries, in order of preference:

1. **Deferred injection (phase 2).** Persist gate findings and push them onto
   `output.parts` in the next `chat.message`. Same information, one turn late,
   zero new machinery.
2. **Re-prompt (phase 3, validate first).** The SDK exposes
   `POST /session/{id}/prompt_async`, `/tui/append-prompt`, `/tui/submit-prompt`
   (`packages/sdk/openapi.json`). On `session.idle` with a failing gate, the
   plugin can re-prompt via `ctx.client`. This restores Stop-blocking behavior
   but needs a loop guard (cap re-prompts per session, never re-prompt a
   re-prompt) before it goes anywhere near a default.

Either way the capability contract must say `hooks: partial` with
`stop-cannot-block` in `degradations`. Claiming parity here would be false.

### 2.5 Tool and argument naming

opencode tool ids are lowercase and its file argument is `filePath`, not
`file_path`. Confirmed ids: `read`, `write`, `edit`, `bash`
(`tool/shell/id.ts:16`), `glob`, `grep`, `task`, `apply_patch`, `skill`,
`webfetch`, `websearch`, `todowrite`, `question`, `plan_exit`, `execute`
(code-mode). `apply_patch` is only registered for GPT-family models
(`tool/registry.ts:297-300`), so the Codex adapter's patch-splitting logic is
needed here too, but conditionally.

`core/hooks/normalize-event.js` already has a `TOOL_MAP` and
`normalizePathFields`. Both need extending, and `createEnvelope` needs to stop
choosing the map with `runtime === 'codex' ? CODEX : CLAUDE` and switch on the
runtime id properly.

## 3. Architecture

```
opencode process (Bun)
  └─ .opencode/plugin/citadel.js                 ← new, generated
       └─ runtimes/opencode/plugin/index.mjs     ← new, the adapter
            ├─ normalizeOpencodeHookInput()      ← new, reuses core/hooks/normalize-event
            └─ spawn node hooks_src/<hook>.js    ← unchanged, 30+ existing hooks
                 exit 2 + stderr  →  throw new Error(stderr)
                 exit 0 + stdout  →  mutate output in place
```

The plugin is ESM (Bun), the hooks are CommonJS Node scripts. Bun supports
`node:child_process`, so the boundary is an `execFile` with `input`, a timeout
from the template, and `CLAUDE_PROJECT_DIR` in the env — the same contract
`hooks_src/codex-adapter.js` already implements, minus the exit-code plumbing
and plus promise-based timeouts so the agent's event loop is never blocked
synchronously.

Reusing `hooks_src/*.js` as subprocesses, rather than porting them into the
plugin, is the whole point: one security implementation, one telemetry writer,
one set of tests. The cost is process spawn latency per tool call (~30-60ms for
Node startup). `pre_tool` fires on every tool call, so this is the main
performance risk and the reason for 6.3 below.

## 4. Files

New:

```
runtimes/opencode/runtime.js                      capability contract
runtimes/opencode/index.js                        barrel, mirrors runtimes/codex/index.js
runtimes/opencode/adapters/hook-input.js          envelope normalization
runtimes/opencode/plugin/index.mjs                the adapter plugin
runtimes/opencode/plugin/citadel-plugin.js        generated stub for .opencode/plugin/
runtimes/opencode/generators/install-plugin.js    writes the stub + opencode.json
runtimes/opencode/generators/project-agents.js    .opencode/agent/*.md
(no project-commands.js — opencode derives commands from skills, and an
 explicit command file shadows the live skill)
runtimes/opencode/guidance/render.js              re-export of the AGENTS.md renderer
scripts/opencode-install.js                       install entry, mirrors codex-install.js
scripts/opencode-readiness-check.js               verification
scripts/test-opencode-adapter.js                  adapter unit tests
docs/OPENCODE_INSTALLATION_GUIDE.md
```

Modified:

```
core/contracts/runtime.js          add 'opencode' to RUNTIME_IDS + adapter matrix
core/runtime/registry.js           register the runtime
core/runtime/detect-runtime.js     .opencode marker + process-tree, checked BEFORE codex
core/hooks/normalize-event.js      OPENCODE_EVENT_MAP, lowercase tools, filePath
scripts/install.js                 --runtime opencode
citadel-metadata.json              runtime_support.opencode
package.json                       files[], opencode:install, opencode:verify
scripts/test-runtime-registry.js   assertions
scripts/test-runtime-matrix.js     matrix row
docs/HOOKS.md, README.md, INSTALL.md
```

`packages/contracts/vendor/` is generated — run
`node scripts/generate-public-contracts.js` after touching `core/contracts/`.

## 5. Phases

Each phase is independently shippable and under the 35-minute execution
boundary from `CLAUDE.md`.

**Phase 1 — contract and detection. DONE.** Added `opencode` to `RUNTIME_IDS`,
the adapter matrix (`level: hook-enabled`, missing: Stop-blocking, permission
gating), `runtimes/opencode/runtime.js`, the registry, and detection. Vendored
contracts regenerated.

Implementation note the plan missed: runtime resolution is duplicated across
**three** sites, not one. `core/runtime/detect-runtime.js` (process tree +
marker recency) is what the plan described, but `core/config/runtime.js`
`detectRuntimeContract` is the one hooks, the dashboard, and the MCP server
actually call, and `scripts/citadel-config.js` carries a third copy of the
`runtimeContract` switch. All three now resolve `opencode`; without the second,
`CITADEL_RUNTIME=opencode` would have reported a capability-free unknown
runtime to every hook. The two marker scans deliberately keep different
tiebreaks — `detect-runtime.js` picks the most recently touched marker
directory, `config/runtime.js` stays unknown when several are present — so
both were generalized rather than merged.

`core/cli/package-cli.js` still normalizes only `claude` and `codex`, so
`citadel install --runtime opencode` fails with `RUNTIME_NOT_FOUND`. Left
deliberately: it is install plumbing with no installer behind it yet, and a
clean error beats a half-wired path. Phase 4 owns it, along with
`markerRuntimes` and the two runtime error messages that name only the two
runtimes.

*Exit met:* `test-runtime-registry.js`, `test-runtime-matrix.js`,
`test-runtime-contracts.js`, `test-config-consumers.js`,
`test-adoption-lifecycle.js`, `integration-test.js`, `test-cli-package.js`,
`test-backward-compat.js`, and `generate-public-contracts.js --check` all pass;
`CITADEL_RUNTIME=opencode` and a lone `.opencode` marker both resolve to the
opencode contract.

**Phase 2 — event normalization. DONE.** Added `OPENCODE_EVENT_MAP`, lowercase
tool ids, `filePath` → `file_path` canonicalization, and
`normalizeOpencodeHookInput`. `createEnvelope` now selects its event map from an
`EVENT_MAPS` registry instead of `runtime === 'codex' ? CODEX : CLAUDE`.

The adapter absorbs opencode's field names (`sessionID`, `callID`, `tool`,
`args`, `directory`, and the `{providerID, modelID}` model object) so phase 3
can pass `{ ...input, args: output.args }` straight through. It keeps `raw` as
the caller's own object rather than a copy, because the plugin has to mutate
opencode's argument object in place — the only mutation opencode honors.

`task` maps to `Agent`, so the governance hook's existing `Agent` matcher fires
on opencode subagent spawns. `apply_patch` is deliberately *not* in the tool
map: adapters split it into per-target Edit/Write projections, which needs the
native id to survive normalization.

Correction to the event table in 2.2: `permission_denied` ← `permission.replied`
was wrong. A reply may allow or deny, so a static mapping would mislabel
allowed actions as denials half the time. `permission.replied` is now
deliberately unmapped, and resolving a denial is the phase-3 adapter's job.
`session.error` is likewise unmapped — a session failure is not Claude Code's
`StopFailure`, which fires when the stop hook itself fails. The fixture records
every deliberate omission with its reason, and the test fails if any of them
silently acquires an event id.

*Exit met:* `scripts/fixtures/opencode-hook-events.json` drives a cross-runtime
equivalence test — each opencode payload and its Claude Code twin must reduce to
identical envelope fields — plus drift detection between the fixture's mapped
list and the shipped map. Beyond the stated exit, the real hooks were driven
with opencode-shaped payloads end to end: `protect-files` blocks a `read` of
`.env` and allows `README.md`; `external-action-gate` blocks
`git push --force origin main` (P-001) and `gh pr merge 1`, and allows a plain
`git push`, which is tier `allow` by default.

**Phase 3 — the plugin adapter.** `runtimes/opencode/plugin/index.mjs` wiring
`tool.execute.before` (throw on exit 2), `tool.execute.after`, `chat.message`,
`event`, `config`, plugin-init as session start, `dispose` as session end.
Per-hook timeouts from `hooks-template.json`. `apply_patch` target splitting,
reusing the Codex parser.
*Exit:* `scripts/test-opencode-adapter.js` proves a `protect-files` block
throws with the hook's stderr as the message, a non-security hook failure does
not throw, an in-place `args` mutation survives, and a timeout is enforced.

**Phase 3 — the plugin adapter. DONE.** Landed as two files rather than one:
`runtimes/opencode/plugin/hook-runner.js` (CommonJS) holds the logic, and
`runtimes/opencode/plugin/index.mjs` is the thin ESM module opencode loads. The
split is what makes the phase testable: the Citadel suite exercises the runner
and, via a require-cache stub, the shim's contract under plain Node, with no Bun
and no opencode install.

Two corrections to the plan:

*The plan said never to `require()` Citadel CommonJS from plugin scope.* That was
wrong, and following it would have meant duplicating the event map and the legacy
payload projection inside the plugin, which defeats phase 2's single
normalization and would drift. `createRequire` works under Bun, and the modules
needed (`normalize-event`, `hook-context`, `bundles`) are pure logic with no
native dependencies. The real constraint is narrower: do no work at import time,
and resolve a Node binary explicitly rather than trusting `process.execPath`,
which under Bun is the Bun binary.

*`apply_patch` needed a matcher alias, which the plan did not mention.* The
template's matchers are `Edit|Write`, `Read`, `Bash`, `Agent` — `apply_patch`
matches none of them, so selecting hooks by the native tool id gated it with
nothing at all. The alias is applied at match time (`apply_patch` also matches
`Edit` and `Write`), and each selected entry's matcher is re-checked against the
individual projected target so a `Write`-only matcher cannot fire on an `Edit`
projection.

Blocking is narrower than the plan implied. Only `tool.execute.before` can abort
a call, so that is the single member of `BLOCKING_OPENCODE_EVENTS`. Throwing from
`tool.execute.after` would report a tool that already succeeded as failed, so
post-tool findings are appended to the output text the model sees instead. Hooks
that fail on a non-blocking event never break the turn.

Security hooks (`protect-files`, `external-action-gate`) fail closed on a
blocking event: a missing implementation, a crash, a non-2 exit, a timeout, or an
unparseable `apply_patch` body all refuse the action. Observers never do. Because
opencode enforces no hook timeout of its own, the adapter enforces the per-hook
timeouts from `hooks-template.json` itself, with async spawn so a 30-second
`post-edit` cannot stall opencode's event loop.

Known fail-open, and not fixable from inside the plugin: if the module fails to
load, opencode publishes a plugin error and continues with no Citadel gating.
The load path is kept minimal to reduce the chance, and the runtime contract
already declares `plugin-adapter-required-for-hook-parity`.

*Exit met:* `scripts/test-opencode-adapter.js`, registered in `test-all.js`,
drives the real `hooks_src` processes — `protect-files` blocks a `.env` read and
allows `README.md`; `external-action-gate` blocks a force-push; an `apply_patch`
touching `.env` is blocked, as is an unparseable patch body; a missing or
timed-out security hook fails closed; `tool.execute.after` never blocks. Eight
deliberate mutations were each confirmed to fail the suite, including removing
the `apply_patch` alias, letting post-tool block, replacing `output.parts`
instead of pushing, and snapshotting `output.args` instead of passing the live
reference. `node scripts/test-all.js --strict` passes.

**Phase 4 — install and projection.** `install-plugin.js` writing
`.opencode/plugin/citadel.js` and merging `opencode.json` (preserving
user keys, same merge discipline as `core/hooks/install.js`), agent and command
projectors, MCP config, `scripts/opencode-install.js`,
`scripts/opencode-readiness-check.js`.
*Exit:* `--dry-run` lists exact writes; `opencode:verify` passes on a scratch
project.

**Phase 4 — install and projection. DONE.** `scripts/opencode-install.js` writes
`.opencode/plugin/citadel.js`, merges `opencode.json`, and projects agents into
`.opencode/agent`. `scripts/opencode-readiness-check.js` verifies a project and
ends with a live probe that the pre-tool gate actually refuses a `.env` read.
`--runtime opencode` now works through `scripts/install.js`, and
`core/cli/package-cli.js` recognizes the runtime, the `.opencode` marker, and
probes the right binary — closing the gap phase 1 left open.

Three corrections to the plan:

*`project-commands.js` must not exist.* `command/index.ts:134-151` registers
every discovered skill as a command (`source: "skill"`), and opencode already
reads `.claude/skills/**/SKILL.md`, so all Citadel skills become opencode
commands with no projection. Worse, the loop is `if (commands[item.name])
continue` — an explicit command file **shadows** the skill, so a projected copy
would go stale and silently override the live one. The generator was dropped and
a test asserts the file stays absent.

*The MCP config shape in the plan would have broken every install.* opencode's
`McpLocalConfig` (`core/v1/config/mcp.ts`) takes a single `command` argv array —
there is no `args` key — plus `environment` rather than `env`. It is a plain
`Schema.Struct`, so an unknown key fails the decode and opencode hard-fails at
startup. Asserted key by key in the tests.

*Command frontmatter is strict where agent frontmatter is not.* `ConfigCommandV1`
is a plain Struct and its loader throws `InvalidError` on an unknown key, while
`ConfigAgentV1` carries a Record rest that folds unknown keys into `options`.
Only agents are projected, so only the lenient surface is written — but the
distinction matters for phase 6.

The agent projector emits what opencode expects: the name comes from the
filename (not frontmatter), the body is the prompt, and `mode: subagent`.
`opencode.json` is merged key by key because it is user-owned and opencode
hard-fails on invalid content; an unparseable file is refused rather than
clobbered, and a second install is a no-op.

**A pre-existing parser bug was fixed beyond this phase's scope**, because the
projection put it in front of users: `core/agents/parse-agent.js` treated YAML
`#` comments as keys (producing frontmatter entries literally named `"# model"`)
and its folded-scalar regex swallowed trailing comments into `description`. The
arbiter's description was 1408 characters of mostly YAML comments, and opencode
shows `description` in its `@` autocomplete. Two precise fixes — skip comment
lines when parsing keys, and terminate a folded scalar at a column-0 `#` — cut it
to 611 characters and removed the junk keys. This also improves the existing
Codex projection, which shared the bug; `test-codex-runtime`,
`test-agent-projections`, and `test-codex-native-integrations` all still pass.

*Exit met:* `--dry-run` lists exact writes and provably creates nothing;
`opencode:verify` passes on a scratch project, including the live gate probe.
`scripts/test-opencode-install.js` is registered in `test-all.js`, and five
mutations were each confirmed to fail it — an `args`-key MCP config, a merge that
drops user MCP servers, a merge that replaces the whole config, clobbering an
unparseable `opencode.json`, and a dry run that writes anyway.

**Phase 5 — live verification and docs. DONE.** Run against **opencode 1.18.30,
Bun 1.4.2, Node 24.12.0, Windows 11** on 2026-09-10, in a scratch project
installed with `scripts/opencode-install.js`. The plan was written against
`anomalyco/opencode@dev` as of 2026-09-10; 1.18.30 is the released build closest
to it.

Method note: opencode's headless server (`opencode serve --print-logs
--log-level DEBUG`) plus its HTTP API was used instead of the TUI, because it
makes every claim observable — the log shows plugin load, `/agent`, `/skill` and
`/command` enumerate what the `@` and `/` menus render, and `/session/{id}/
prompt_async` drives a real turn. No Anthropic credentials were available, so a
local Ollama model (`qwen3.5:9b`, registered through a `provider` block in the
project's `opencode.json`) supplied the model-driven items. That is sufficient:
every item here is about opencode's plumbing, not about model quality.

| # | Claim | Result |
|---|---|---|
| 1 | The plugin loads at all | **PASS** |
| 2 | `resolveNodeBinary()` falls through to `which node` | **PASS** |
| 3 | A thrown block reaches the model | **PASS** |
| 4 | In-place `args` mutation is honored | **PASS** (both halves) |
| 5 | Spawn latency is tolerable | **PASS**, ~50 ms per hook |
| 6 | Agents render in the `@` menu | **PASS** |
| 7 | Skills appear as commands | **MECHANISM PASSES, OUTCOME FAILS** |
| 8 | Telemetry lands | **PASS** |

The three blocking items (1-3) all pass, so the runtime contract's
`hooks: partial` claim stands and needs no narrowing. Two new degradations were
found and are recorded below.

**1 — plugin loads.** Positive evidence, not absence of errors. The plugin logs
through opencode's own logger at init:

```
level=INFO message="citadel session start" messages="[\"[citadel] hooks ok (24 recent events), gates active, last verify: none\"]"
```

`createRequire` reaching the CommonJS runner works under Bun. Corroborated by
side effect: a bare scratch project gained `.planning/`, `.citadel/` and
`.claude/` at 17:31:38.5, filling the 9.6-second gap between config load
(17:31:29.2) and `init` (17:31:38.9) — the `init-project` session-start hook
running inside opencode's bootstrap.

**2 — Node resolution.** `opencode-readiness-check.js` reports
`node binary resolved for hooks — C:\nvm4w\nodejs\node.exe`. A real Node, not
the Bun binary. The `basename === 'node'` branch never fires under Bun as
predicted, and the `where`/`which` probe is what runs.

**3 — a thrown block reaches the model.** A real turn, prompted to read `.env`:

```
TOOL read  status=error
  input : {"filePath":"...\\oc-project\\.env"}
  error : "[protect-files] Blocked: cannot read .env — .env files contain secrets."
ASSISTANT: The `.env` file was blocked from being read by the security system...
```

The exit-2 to `throw` translation lands as a tool **error**, carries the hook's
own stderr, the model reads it, and the session continues rather than dying.
This also confirms the `filePath` to `file_path` canonicalization end to end.
The block is recorded in `.planning/telemetry/hook-errors.jsonl` as
`{"hook":"protect-files","action":"blocked","detail":"Read .env (.env secrets)"}`.

**4 — in-place mutation, both halves.** Citadel's own adapter never rewrites
args — `runHooksForEvent` blocks or appends messages, and the phase-3 test
asserts only that the live reference survives. So this was verified with a
standalone probe plugin on `tool.execute.before`, driving real model-issued
`bash` calls:

- `output.args.command = "echo MUTATION_HONORED_INPLACE"` — the tool ran the
  rewritten command. **Honored.**
- `output.args = { command: "echo MUTATION_HONORED_REPLACE" }` — the tool ran
  the *original* `echo PROBE_REPLACE`. **Silently discarded.**

The aliasing in `normalizeOpencodeHookInput` is load-bearing exactly as
documented. Do not "clean it up".

**5 — spawn latency, measured.** One Node process per matching hook, timed
against the real plugin under Bun:

| Tool | Hooks | Latency |
|---|---|---|
| `glob`, `grep`, `webfetch` | 0 | ~0 ms |
| `read` | 1 (`protect-files`) | mean 51 ms |
| `bash` | 2 (`external-action-gate`, `governance`) | mean 99 ms |
| `edit`/`write` | 2 (`protect-files`, `governance`) | ~100 ms |

Plugin init is 214 ms warm. Tools with no matching matcher cost nothing, which
keeps the common read-only path free.

*Correction to this item's suggested remedy.* The plan proposed comparing
against a session with `CITADEL_BUNDLES` trimmed. That does nothing: every
pre-tool hook is in `CORE_BUNDLE`, so a core-only selection picks exactly the
same hooks for `Read`, `Bash`, `Edit` and `Write`. Bundle trimming is not a
latency lever at pre-tool. A persistent hook worker is the only real follow-up.

**6 — agents render.** `GET /agent` returns 14: opencode's five built-ins
(`build`, `plan`, `compaction`, `summary`, `title`), its `explore` and `general`,
and exactly the seven Citadel agents projected into `.opencode/agent`. All carry
short readable descriptions. The `parse-agent.js` fix from phase 4 is confirmed
live: arbiter's description is **611 characters**, matching the phase-4 note
exactly, with no `"# model"` junk keys.

**7 — skills. The mechanism works; the outcome does not.** This is the
phase's contradiction, and the reason the item is not a plain PASS.

`GET /skill` in the installed project returned 13 skills, and **not one was
Citadel's**: twelve came from the user's global `~/.claude/skills`, one
(`customize-opencode`) is an opencode built-in. The project had no
`.claude/skills` directory at all.

Section 1's table says skills need "none — opencode reads Citadel's existing
`.claude/skills/` projection directly". **There is no such projection.**
Citadel's 48 skills live in `Citadel/skills/`, and under Claude Code they reach
a session through the plugin marketplace, which opencode has no equivalent of.
Nothing in `opencode-install.js` writes them, and the Citadel repo itself has no
`.claude/skills`. The consequence: a correct install yields zero Citadel skills
and therefore zero Citadel slash commands.

The reading of `command/index.ts` was right — copying one skill
(`skills/architect`) into the project's `.claude/skills/` made opencode expose it
both as a skill and as a command with `source: "skill"`, unshadowed, with the
body as the template. Only the projection step was missing. Phase 4 was right to
drop `project-commands.js`; what it needed instead was a *skills* projector.

*Originally resolved after phase 5 with an absolute checkout path; superseded by
the portable project-local projection.* opencode's config has a
`skills.paths` array, scanned `**/SKILL.md` (`skill/index.ts:211-219`), so the
installer adds `./.citadel/skills` and all skills are discovered from the
project-local copy. Reinstall refreshes it idempotently. The array is user-owned,
so Citadel appends and dedupes rather than replacing; `--skip-skills` omits the
key entirely.

This needs opencode >= 1.18.30. The top-level config is a plain `Schema.Struct`,
so on a build predating `skills.paths` the key would fail the decode and opencode
would refuse to start. `core/v1/config/skills.ts` was checked at tag v1.18.30 —
the build this phase ran against — *before* relying on the key, because the MCP
`args` mistake in phase 4 was exactly this failure mode found too late.

One consequence worth knowing: `skills.paths` is scanned **last**, after global
and project `.claude`/`.agents` and the `.opencode` dirs, and `add()` overwrites
on a name collision. So the Citadel entry wins over a project-local copy of the
same skill. (This also corrects the note above: on a duplicate, the *later* scan
wins, not the first.) To customize a skill, point `skills.paths` at your own
directory rather than editing a copy that will be overridden.

**8 — telemetry lands.** `.planning/telemetry/` in the **project** fills with
`audit.jsonl`, `hook-timing.jsonl`, `hook-errors.jsonl`, `session-costs.jsonl`.
Entries carry `"project":"oc-project"` and canonical tool names (`Bash`, not
`bash`); no path resolves back to the Citadel checkout.

**Which opencode events actually fire.** The plan asked for this to be recorded
rather than fixed. Observed from `hook-timing.jsonl` over the session, every
mapped event fired:

| opencode | Citadel hook | Seen |
|---|---|---|
| plugin init | session-start chain | yes |
| `tool.execute.before` | `protect-files`, `external-action-gate`, `governance` | yes |
| `tool.execute.after` | observers | yes |
| `chat.message` | `user-prompt-submit` | yes (x4) |
| `session.idle` | `quality-gate` | yes (x10), observational |
| `config` | `config-change` | yes (x5) |
| `dispose` | `session-end` | yes (x3) |

`intake-scanner` also ran (x6). Nothing in the map failed to fire.

**Two new degradations, neither in the plan.**

*The `!` shell bypasses the gate.* `POST /session/{id}/shell` — the TUI's
`!command` — does **not** fire `tool.execute.before`. `git push --force origin
main` issued through it ran ungated (it failed only on git's own refspec error),
and a probe plugin on `tool.execute.before` recorded nothing for those calls.
Section 2.2 lists four call sites and concludes "coverage of tool calls is
complete"; the shell endpoint is a fifth path that does not go through the tool
wrapper. This does not weaken gating of *agent* actions — model-issued `bash`
goes through the wrapper and is gated, verified in item 4 — but a human typing
`!` is outside Citadel's reach on this runtime. Worth a `degradations` entry.

*Plugin discovery is per process, not per instance.* Dropping a new plugin into
`.opencode/plugin/` and recreating the project instance via `/instance/dispose`
re-runs each **already-loaded** plugin's init but does not rescan the directory
— the new plugin never loaded, and, exactly as trap 1 warns, said nothing. Only
a full opencode restart picked it up. Installing Citadel into a project while
opencode is running therefore leaves the session ungated with no error. The
installation guide says to restart.

**Guidance had the same gap as skills, and the readiness check could not pass.**
`runtimes/opencode/guidance/render.js` exported a working
`OPENCODE_GUIDANCE_TARGET`, but `opencode-install.js` never invoked it — section 1
and the installer both filed guidance under "no projection". Rendering it also
needed a `.citadel/project.md` spec the opencode install path did not create.

*Resolved after phase 5.* A new `generators/project-guidance.js` renders
`AGENTS.md`, reusing `ensureProjectSpec` from the shared bootstrap so the spec is
created the same way on every runtime. It writes only `AGENTS.md` — unlike
`bootstrap-project-guidance.js`, which also writes `CLAUDE.md`; an opencode
install has no business creating that.

Two things the "unreachable code" framing missed. First, the renderer was not
merely dead, it was **wrong**: a re-export of the Codex renderer, whose output
announces itself as "the Codex-facing projection", carries a "## Codex Notes"
section, and instructs the reader to use `$skill-name` — while phase 5 verified
opencode registers skills as `/` commands. Wiring it in unchanged would have
handed opencode users a misleading file, so it was rewritten rather than simply
called. Second, an existing `AGENTS.md` must not be touched: it is opencode's
primary guidance file and is often hand-written, so the generator skips it unless
`--overwrite-guidance` is passed, and a test asserts the existing bytes survive.

With this, a default install passes all readiness checks — `READY.` with no
advisory gaps — and `--strict` passes too. `--skip-guidance` and `--skip-skills`
each produce a WARN that `--strict` refuses.

The consequence is worth stating plainly: `opencode-readiness-check.js` asserted
`guidance file present` and `skills discoverable by opencode`, and the installer
deliberately produces neither, so **a fresh correct install failed its own
readiness check and the script exited 1**.

*Resolved after phase 5.* The check now carries two severities. **Required**
covers what `opencode-install.js` guarantees it wrote — the plugin stub, a
parseable `opencode.json`, the `citadel-state` MCP entry, a resolved Node binary —
plus the live proof that the pre-tool gate blocks a `.env` read; only these set
the exit code. **Advisory** covers capability a project gains by supplying
something Citadel does not project: guidance, skills, and agents (the last
because `--skip-agents` is a supported choice). Advisory failures render as WARN
with a remedy line and still exit 0; `--strict` makes them fatal for CI.

Downgrading is not hiding: both gaps are still reported on every run, each with
what to do about it, and a test asserts they appear as WARN with a remedy.
Restoring either to required, downgrading a required check, ignoring `--strict`,
or dropping the remedy text each fail the suite.

The root cause was a test fixture, not the check. `scratchProject()` in
`scripts/test-opencode-install.js` hand-created `AGENTS.md` and
`.claude/skills/do/SKILL.md` and then asserted the readiness check passed — it
encoded the assumption instead of testing it, and hid the gap for a whole phase.
The fixture is now deliberately bare, with a separate `furnishedProject()` for
the case where every advisory check should also pass.

*Exit met:* `docs/OPENCODE_INSTALLATION_GUIDE.md` written from these
observations. Items 1-3 pass, so `hooks: partial` stands unchanged;
`shell-endpoint-not-gated` and `plugin-discovery-requires-restart` were added to
the runtime contract's `degradations`, which was the only code change this phase
made. The skills gap (7), the guidance gap, and the readiness-check contradiction
were the three follow-ups this phase surfaced; **all three are now closed** — see
the resolution notes above. A default install passes all readiness checks.
The runtime contract itself was unchanged by those fixes beyond the two
degradations this phase added.

**Phase 6 — Stop recovery. DONE, by deferred injection only.**

opencode dispatches bus events fire-and-forget, so by the time `quality-gate` has
a verdict the turn is over and nothing can be refused. Before this phase the
verdict was *discarded*. Now it is persisted and delivered on the next turn.

A prerequisite bug surfaced while wiring it. Citadel hooks answer on stdout with a
JSON envelope, not plain text — `{hookSpecificOutput: {additionalContext}}` for a
non-blocking finding, `{decision: 'block', reason}` for a blocking one,
`{hook, action, message}` for the UI shape. The adapter was taking
`firstLine(stdout)`, so the *raw JSON envelope* was what reached the model. The
findings were already arriving, just unreadably. `messageFromStdout` now unwraps
all three shapes, and an envelope it does not recognize is dropped rather than
shown raw.

`plugin/pending-notices.js` holds the store at
`.planning/opencode/pending-notices.json`. Notices are deduped by content, because
`session.idle` fired ten times in the phase-5 session and the verdict is usually
identical — without dedupe the model would see ten copies. They are capped at 20,
newest kept, so a long session cannot build an unbounded prompt injection, and
each notice is truncated at 4000 characters. A corrupt store reads as empty rather
than throwing: losing a deferred notice is bad, breaking the session is worse.
Draining happens after the caller has the contents, so a render failure cannot
lose them.

*Re-prompt via `ctx.client` was deliberately not implemented.* The plan said
"validate first", and this environment has neither Bun nor opencode nor model
credentials, so it cannot be validated here. It would drive real model turns and
spend tokens autonomously, and the loop guard — cap per session, never re-prompt a
re-prompt — is both the dangerous part and exactly what cannot be tested without a
live session. Shipping an unvalidated autonomous re-prompt loop would be worse
than not shipping it. The stated exit condition does not require it.

The runtime contract is unchanged: `stop-cannot-block` still holds, because a
finding delivered on the next turn is delivery, not enforcement. Claiming
otherwise would be the kind of over-statement this document exists to prevent.

*Exit met:* `scripts/test-opencode-adapter.js` drives the real `quality-gate` hook
against a fixture with a genuine violation, confirms the finding is human text
rather than a JSON blob, fires `session.idle` twice and asserts one notice is
recorded, then asserts the finding is pushed onto the next `chat.message`'s
existing parts array and not repeated on the turn after. Seven mutations were each
confirmed to fail: showing the envelope raw, removing the dedupe, removing the
cap, a drain that does not clear, a corrupt store that throws, not persisting idle
findings, and replacing `output.parts` instead of pushing.

### Phase 6 live verification — one claim was wrong

Run 2026-09-10 against **opencode 1.18.30, Bun 1.4.2, Node 24.12.0, Windows 11**,
in a scratch project installed by `scripts/opencode-install.js`, driven through
`opencode serve --print-logs --log-level DEBUG` and `POST /session/{id}/message`,
with a local Ollama model (`qwen3.5:9b`) as in phase 5. The finding was produced
the documented way: `{"qualityRules":{"builtIn":["no-confirm-alert"],"blocking":false}}`
in the project's `.claude/harness.json`, a committed `.js` file, a `confirm()` call
appended to it.

**Claim 3 was false as shipped, and its failure mode was the opposite of the one
predicted.** The plan said replacing `output.parts` is *silently discarded*, so
pushing is the safe move. Pushing is indeed the right move, but the pushed object
was wrong: opencode hands `chat.message` **materialized `Part`s**, and validates
every entry of the array in `createUserMessage` before saving. The shipped part —
`{ type: 'text', text }` — failed that schema:

```
level=ERROR message="invalid user part before save" partID=undefined partType=text index=1
  cause="SchemaError: Missing key at [\"id\"] / [\"sessionID\"] / [\"messageID\"]"
level=ERROR message=failed error="EventV2.InvalidDurableEvent: Expected string aggregate field sessionID"
  at Session.updatePart / SessionPrompt.createUserMessage / SessionPrompt.prompt
```

The turn returned **HTTP 500 and never ran**. So the real behaviour was worse than
a silent no-op on two counts: every turn following a recorded finding was dead,
and because `drain()` ran *before* the push, the notice was consumed and lost. A
user would have seen an unexplained server error and no finding, forever.

Two fixes, both in `plugin/index.mjs`:

- The part is built with `id`, `sessionID` and `messageID`. The ids come off a
  sibling part first (what opencode itself just wrote), then `output.message`,
  then the hook input — all three were observed to carry them. The `id` is
  generated, since opencode exposes no id factory to plugins; it leads with `z`
  so it sorts after every real part id, whose 12-char time segment is a hex
  millisecond clock and starts with a digit.
- Notices are **peeked, not drained**, until the push is known to be possible,
  and the hook pushes nothing at all when no identity can be derived. A partial
  part is not a degraded delivery, it is a dead turn.

| # | Claim | Result |
|---|---|---|
| 1 | A finding recorded at the end of a turn appears at the start of the next | **PASS** (after the fix) |
| 2 | It is not repeated on the turn after | **PASS** |
| 3 | The pushed part does not break prompt assembly | **FAILED as shipped**, fixed and re-verified |
| 4 | The store lands in the project, not the Citadel checkout | **PASS** |

**1 and 3 — delivery.** Turn A (`ALPHA`) ended, `session.idle` fired, and
`.planning/opencode/pending-notices.json` gained one notice at 17:48:17Z. `app.js`
was then reverted so no *new* finding could be generated. Turn B asked the model
to quote any Quality Gate text in its input; it returned the injection verbatim,
`[Citadel] Findings from the end of the previous turn…` through to
`app.js: [performance] Uses confirm() — use an in-app modal`. HTTP 200, zero
errors in the server log for the whole run.

**2 — drains.** Read back from `GET /session/{id}/message`, which is the direct
evidence rather than the model's answer:

```
user msg …1ac1Qj  1 part   (turn A: nothing pending yet)
user msg …muSMGz  2 parts  prt_08c6f830c… synthetic=false  "Without using any tools, quote…"
                           prt_z9facbba2… synthetic=true   "[Citadel] Findings from the end…"
user msg …xN7ufg  1 part   (turn C: not repeated)
```

Turn C's model answer *did* still quote the finding — from conversation history,
since the injected part persists as a real user-message part. That is why the
message record, not the model, is the evidence here.

**4 — store location.** `.planning/opencode/pending-notices.json` was created in
the scratch project only. The Citadel checkout never grew a `.planning/opencode/`
directory across the whole run.

*Incidental confirmations.* The plugin's own `client.app.log` line
(`message="citadel session.idle" messages="[\"[Quality Gate] …\"]"`) is positive
evidence of load, alongside `.planning/` appearing during bootstrap. The
`messageFromStdout` unwrapping works live: the notice is human text, not a JSON
envelope. `chat.message`'s `input` carries `{sessionID, agent, model, messageID,
variant}` — both ids are available there as a fallback.

*Open question answered.* `.planning/opencode/` is now in `.gitignore`, matching
how `.planning/telemetry/`, `.planning/discoveries/` and the other transient
subtrees are already handled. It is per-session state with a lifetime of one turn.
Note this covers the Citadel repo only: `opencode-install.js` writes no
`.gitignore` into consuming projects, so a consuming project has to add the line
itself.

### Phase 6b — re-prompt via `ctx.client`. DONE, opt-in, validated live

The reason this was deferred was that it could not be validated: no live session,
no model. Both existed once phase 6 was verified, so it was built and run.

**It is off unless a project turns it on.** Section 2.4 said the loop guard has to
exist "before it goes anywhere near a default", and a feature that spends tokens
without a human asking should not arrive with an install. Projects opt in through
`.claude/harness.json`:

```json
{ "opencode": { "repromptOnStopFindings": true, "maxRepromptsPerSession": 2 } }
```

Anything other than a literal `true` — an absent file, an absent block, a corrupt
file, the string `"yes"` — reads as off. `maxRepromptsPerSession` defaults to 2
and is clamped to a hard ceiling of 5 that config cannot lift, because the cap is
the thing bounding autonomous spending.

*Observed API, not inferred.* `client.session.promptAsync({ path: { id }, body: {
parts } })`; `path.id`, not `path.sessionID`, despite the route being
`/session/{sessionID}/prompt_async`. `session.idle` carries exactly
`{ sessionID }`. `ctx` also carries `serverUrl`, so a raw `fetch` is a fallback if
the SDK shape moves. The body needs no `model` or `agent`: opencode uses the
session's own.

*The re-prompt does not restate the finding.* It starts a turn; the finding rides
into that turn through the same `chat.message` injection a human-typed prompt
would carry. Restating it would double it.

**Two guards, and the live run moved one of them.**

1. *A per-session cap.* Spent at the moment of the decision, not on a confirmed
   send, so a failed send costs a re-prompt rather than risking an extra one.
2. *Never re-prompt a re-prompt.* Sending marks the session; the next
   `session.idle` for it is declined and the mark consumed.

Guard 2 was wired to run only on idles that carried a finding. The live run showed
why that is wrong: **a re-prompt that works ends with the model having fixed the
finding, so the idle it produces is silent.** In the first run the model went
`grep` → `read` → `edit` and replaced the `confirm()` call with a modal, entirely
on its own. That silent idle never reached the guard, the mark survived, and it
would have eaten the *next* legitimate re-prompt instead. The guard now sees every
idle and the `hasFinding` flag is a parameter. This was found by watching, not by
reading — a plain unit test with a stub that always reports a finding passes
either way.

*Live sequence*, cap 2, opencode 1.18.30 / Ollama `qwen3.5:9b`, driven by human
turns with the violation left in place throughout:

```
citadel reprompt sent     sessionID=ses_f736ea… sent=1 cap=2
citadel reprompt skipped  reason=idle-follows-reprompt
citadel reprompt sent     sessionID=ses_f736ea… sent=2 cap=2
citadel reprompt skipped  reason=idle-follows-reprompt
citadel reprompt skipped  reason=cap-reached
```

Every branch of the policy observed in one session, in order, with zero server
errors. The `idle-follows-reprompt` lines are the guard on its hard case: those
re-prompt turns did *not* fix the violation, so their idles carried the finding
again and were declined anyway. `cap-reached` is the budget ending it for good.
The re-prompt turn's user message holds two parts — the re-prompt text and the
injected finding — exactly as a human turn would.

*Operational caveat found in the same run.* A re-prompt starts a turn nobody is
watching, and that turn can hit an opencode permission prompt — here
`permission=external_directory`, because the then-current `skills.paths` pointed
at the Citadel checkout and the model followed it. Current installs use a
project-local projection. Under `opencode serve` there is no one to
answer, so the session sits `busy` indefinitely and further prompts to it return
nothing; `POST /session/{id}/abort` clears it. This is not caused by re-prompting,
but re-prompting is what makes it happen unattended. Anyone enabling this in a
headless setup should pre-approve the permissions their project needs.

*Tested without opencode too.* `testRepromptPolicy` drives the decision half
directly, including 500 consecutive findings converging on exactly the cap, and
the same alternating quiet and loud. `testRepromptWiring` drives the plugin with a
fake client through the real sequence: finding, silent idle, finding again. Ten
mutations were each confirmed to fail — removing either guard, defaulting to
enabled, a corrupt config reading as enabled, config lifting the hard ceiling, the
plugin ignoring the verdict, consuming the mark only on findings, re-prompting on
a silent idle, not forwarding silent idles, targeting the wrong session, and
restating the finding in the re-prompt text.

*The degradation does not move.* `stop-cannot-block` still holds, and this is the
important thing not to overstate. Re-prompting shortens the wait for the next turn
from "whenever a human types" to "immediately". It does not make `session.idle`
refusable: turn one still ended with the violation in place, and the runtime
contract says so.

*The degradation does not move.* `stop-cannot-block` still holds. A finding
delivered on the next turn is delivery, not enforcement, and this run makes that
concrete: `session.idle` could not stop turn A from ending with the violation in
place.

### Phase 6c — two review findings, both real

Automated review on the upstream PR raised two P1s. Both were verified against the
code before acting, and both were genuine.

**1. Deferred findings were not scoped to a session.** The store lives at
`.planning/opencode/pending-notices.json`, one file per *project* — but opencode
runs many sessions inside one project, and `record`/`peek`/`drain` all ignored the
`sessionID` that both `session.idle` and `chat.message` were already carrying. A
prompt in session B therefore drained session A's finding: B got an instruction
about work it had not done, and A was never told at all. Reproduced in three
lines against the real store before fixing.

Notices now carry the session whose idle produced them, and only that session can
collect them. Two consequences fall out and are tested:

- **Dedupe is per session.** The same finding in two sessions is not a duplicate;
  each has to hear about it.
- **The cap is per session.** A global cap let one noisy session evict a quiet
  one's only finding.

Notices written before scoping carry no `sessionID`. Rather than strand them they
are delivered to whoever asks next — the store is transient, so this matters for
exactly one upgrade.

*Verified live*, two concurrent sessions in one project, both with the violation
present:

```
store after A's turn : 1 notice, owner=ses_…HnK6 (A)
B takes a turn       : B's user message has 1 part — no injection
store after B's turn : 2 notices, owner=A and owner=B
A takes a turn       : A's user message has 2 parts — prompt + [INJECTED]
store after A's turn : 1 left, owner=B  (untouched)
```

Zero server errors. Before the fix, B's turn would have consumed A's notice.

**2. `opencode` was missing from the activation runtime enum.**
`scripts/install.js` `normalizeRuntime()` returns `'opencode'`, but
`core/telemetry/activation.js` accepted only `claude-code`, `codex`, `unknown` and
`other`. Validation threw for both the `install_started` and `install_completed`
events, and `install.js`'s `recordSafely` catches everything and returns
`{recorded: false}` — so **every opencode install was silently absent from
activation metrics**, with no error surfaced anywhere. Reproduced directly:

```
claude-code  recorded=true
codex        recorded=true
opencode     THREW: runtime must be one of: claude-code, codex, unknown, other
```

`'opencode'` is now in the list. The regression test asserts the actual invariant
rather than the literal list — that every runtime `normalizeRuntime()` can emit is
one `activation.RUNTIMES` accepts — so the next runtime to be added cannot repeat
this silently.

Six mutations were confirmed to fail for the scoping fix (any session draining any
notice, the plugin not passing the session id on record or on drain, a global cap,
a global dedupe, and stranding legacy notices) and one for the enum.

### Phase 6d — two maintainer blockers, both real

Review on the upstream PR reproduced two P1s at `41937b0`. Both were confirmed
against a live opencode 1.18.30 before being fixed, and both were coverage gaps
that the existing tests actively concealed.

**1. The adapter read the wrong apply_patch argument.** `parseApplyPatchOperations`
was fed `tool_input.command`, but opencode's apply_patch tool supplies
`patchText` (`packages/opencode/src/tool/apply_patch.ts` in 1.18.30). The
splitter therefore never found the patch body and failed closed, so a valid
harmless patch was refused *before any hook ran*:

```
opencode shape { patchText }: blocked=true  [citadel] could not parse apply_patch targets:
                                            apply_patch args.command must be a non-empty string
adapter shape  { command }:   blocked=false
```

The tests used the `command` fixture too, which is why this passed CI: they
tested a shape opencode never sends. `patchText` is now canonicalized to
`command` in `normalizePathFields`, alongside the existing `filePath` to
`file_path` mapping, so the Codex adapter and the splitter keep reading one key.
After the fix, on real `patchText` payloads:

| Patch | Result |
|---|---|
| `*** Update File: src/app.js` | passes |
| `*** Add File: src/new.js` | passes |
| `*** Update File: .env` | blocked by `protect-files` |
| `*** Update File: src/a.js` + `*** Move to: .env` | blocked by `protect-files` |
| unparseable body, or neither argument present | blocked, fails closed |

**2. Agent tool restrictions were dropped in projection.** Citadel agents declare
access the Claude Code way — a `tools` allow-list and a `disallowedTools`
deny-list. `renderOpencodeAgent` emitted only `description` and `mode`. Dropping
the restrictions does not degrade to "restricted", it degrades to opencode's
defaults, which allow edits and shell. The canonical read-only reviewer was
projected with no permission policy at all.

*The mapping was read off a live instance, not guessed.* Two probe agents were
projected and resolved through `GET /agent`:

- `permission: {edit: deny, bash: deny, webfetch: deny}` compiles to exactly those
  three `{permission, pattern: '*', action: 'deny'}` rules.
- `tools: {write: false}` compiles to **no rule at all** — opencode has no
  separate write permission; `edit` covers writes.

So the deny-list is expressed through `permission`, and `Write`/`NotebookEdit`
map onto `edit`. A permission is denied when a disallowed tool maps to it, or
when an allow-list exists and grants nothing that maps to it. The seven shipped
agents resolve to:

```
arch-reviewer, policy-enforcer, phase-validator, knowledge-extractor
                       edit=deny bash=deny webfetch=deny
arbiter                edit=deny webfetch=deny          (its allow-list grants Bash)
archon, fleet          (unrestricted — no permission block)
```

*Verified live, with a control.* Same prompt, two agents:

```
archon        (unrestricted) : wrote notes-ctl.txt              — file exists on disk
arch-reviewer (restricted)   : "I don't have access to a write tool
                               in my available functions"       — no file written
archon        (unrestricted) : ran bash, reported SHELL_OK_archon
arch-reviewer (restricted)   : "the bash tool isn't available in this environment"
```

opencode does not merely refuse the call — it withholds the tool from the agent
entirely, which is stronger. Note the first attempt at this proved nothing: asked
to create `breach.txt`, the model refused on its own judgment. A restriction has
to be demonstrated against a control that *succeeds*, or you are testing the
model's manners rather than the permission layer.

**A follow-on hole in fix 2, found by asking what was still open.** The first
version of the mapping covered `edit`, `bash` and `webfetch` — and left the
`task` tool untouched, because no Citadel tool obviously named it. But five of
the seven agents forbid `Agent`, and a subagent runs with **its own** permissions,
not its caller's. So the restriction was decorative:

```
arch-reviewer tools: … read, skill, task, todowrite      <- task present
prompt: delegate to archon and have it write escaped.txt
result: "The archon subagent successfully created the escaped.txt file"
        escaped.txt exists on disk
```

A read-only reviewer denied `edit` and `bash` simply handed the work to something
that had them. opencode does support `task` as a permission — a probe agent
declaring `permission: {task: deny}` compiles to a `task=deny` rule — so `Agent`
and `Task` now map onto it. Re-verified live: `task` is gone from the reviewer's
toolset and the same prompt writes nothing.

This is worth stating plainly: denying edit and bash while leaving delegation open
is not a partial restriction, it is no restriction. The tool list is the thing to
check, not the deny list.

**Made exhaustive.** The map now covers every tool Citadel's frontmatter can
name — `read`, `grep`, `glob`, `edit`, `bash`, `webfetch`, `task`, `skill` — so an
allow-list grants exactly what it lists. `arch-reviewer` live, before and after:

```
before: … glob, grep, read, skill, task, todowrite
after : … glob, grep, read, todowrite            (skill and task withheld)
```

A skill is instructions rather than a capability, and what it asks for still goes
through the permissions above, so it is not an escape the way `task` was. It is
denied anyway: "harmless in the cases we thought of" is not a reason to grant
something the allow-list never granted.

*MCP was the remaining path, caught in review.* The first version left MCP tools
ungated on the grounds that frontmatter cannot name them. But opencode's default
allows them, and `citadel-state_citadel_intent_submit` reached the adapter with
no pre-tool matcher covering it. The server validates the intent, not the
caller's role, so a read-only reviewer could write control intents.

opencode gates an MCP tool by its `<server>_<tool>` name; the generic `mcp` key
does not reach it. Probed live on 1.18.30, same prompt, local model:

```
no permission block          : all 9 citadel-state tools, citadel_status called
"citadel-state_*": deny      : NONE
"citadel-state_citadel_intent_submit": deny
                             : the other 8 — an exact name withholds only itself
mcp: deny (with the wildcard): resource tools still present
```

So any agent restricted in anything now also gets `"citadel-state_*": deny`.
The wildcard covers control actions added later. archon and fleet grant every
tool Citadel can name, project with no permission block, and keep the server.
A test runs the real server's `tools/list`, checks that the wildcard covers every
tool name as opencode derives it and no built-in, that every restricted
shipped agent denies it, and that archon and fleet stay unrestricted.

*Verified through the path Citadel actually uses.* Citadel agents are subagents,
and `opencode run --agent arch-reviewer` does not run arch-reviewer: it prints
`agent "arch-reviewer" is a subagent, not a primary agent. Falling back to default
agent` and carries on as the default agent, with every tool. The first live check
of the real projection fell into exactly this and appeared to show the deny
failing. Driven through `task` from a primary instead:

```
task → arch-reviewer : NONE
task → archon        : all 9 citadel-state tools, citadel_status called
```

Five more mutations were each confirmed to fail: dropping the deny, a misspelled
server prefix, an over-broad `*`, gating the orchestrators too, and emitting the
key unquoted.

*Still ungated, deliberately.* `todowrite`, which frontmatter cannot name. And
opencode's MCP resource tools — `list_mcp_resources`, `read_mcp_resource`,
`list_mcp_resource_templates`: neither `mcp` nor their own names withheld them
live. They are read-only, and citadel-state's one resource (`citadel://status`)
is the same summary `citadel_status` returns.

*One trap found while doing this.* opencode compiles **any** key in an agent's
`permission` map into a rule, including nonsense: a probe declaring
`invalidkey: deny` produced an `invalidkey=deny` rule that gates nothing. A typo
in the map would therefore look exactly like a working restriction. The map is now
held to a list of keys observed on a live instance, and a test catches a key
opencode would silently ignore.

Eight mutations were each confirmed to fail: reverting either blocker fix, an
allow-list that stops being exhaustive, `Write` no longer mapping onto `edit`,
unmapping delegation, unmapping skill, a granted read tool being denied anyway,
and a permission key opencode does not honour.

## 6. Risks

1. **Upstream API churn.** Six hooks are `experimental.*` and `permission.ask`
   is declared-but-dead. Depend only on `tool.execute.before/after`,
   `chat.message`, `event`, `config`, `dispose`; treat everything else as
   optional and feature-detect. Pin the `@opencode-ai/plugin` version in the
   generated config.
2. **Mutate-in-place vs reassign.** Silent no-op if an author reassigns
   `output.args`. Mitigation: a regression test per mutating hook, and a comment
   at each mutation site.
3. **Spawn latency on `pre_tool`.** ~30-60ms of Node startup per tool call.
   Mitigation: bundle-filter so only enabled hooks spawn; measure in phase 5;
   if it bites, a persistent hook worker is a follow-up, not a prerequisite.
4. **Bun/Node boundary.** The plugin runs in Bun, hooks in Node. Keep the
   plugin dependency-free and ESM-only; never `require()` Citadel CommonJS from
   plugin scope — cross the boundary only by spawning `process.execPath`
   equivalents, resolving the Node binary explicitly rather than assuming
   `process.execPath` is Node (under Bun it is `bun`).
5. **Detection collision.** `detect-runtime.js` tests `includes('codex')` then
   `includes('claude')`. "opencode" matches neither, but the opencode check must
   still come first, and `.opencode` must join the `.claude`/`.codex`
   marker-recency logic rather than bypassing it.
6. **Honest capability reporting.** `hooks: partial`, with
   `stop-cannot-block`, `permission-gate-not-native`, and
   `no-batch-or-failure-events` in `degradations`. Citadel's value here is
   accurate degradation reporting, not claimed parity.

## 7. Effort

| Phase | Estimate |
|---|---|
| 1 contract + detection | 0.5d |
| 2 normalization | 0.5d |
| 3 plugin adapter | 1.5d |
| 4 install + projection | 1d |
| 5 live verify + docs | 1d |
| 6 Stop recovery (optional) | 1d |

~4.5 days to a verified integration, ~5.5 with Stop recovery. Cheaper than the
Codex work because guidance and skills need no projection at all.
