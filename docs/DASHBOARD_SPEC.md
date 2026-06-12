# Citadel Dashboard Specification (R1: v0.1 read-only)

`citadel dashboard` (also `npm run dashboard:web`) serves a local web app that renders the
project's `.planning/` state and telemetry live. It is the visible form of the harness:
campaigns, fleet, loops, hooks, costs, and handoffs in one glanceable surface.

This document specifies v0.1 (read-only) and names the contracts that v0.2+ (two-way) will
build on. Roadmap context lives in [ROADMAP.md](ROADMAP.md) R1 and R3.

## Principles

1. **Files are canonical.** The dashboard is a view over `.planning/` markdown and JSON plus
   telemetry JSONL. Deleting the dashboard loses nothing. It never holds state the files do
   not.
2. **One contract for terminal and browser.** In v0.2, browser actions write intent files
   into `.planning/` that hooks and agents consume. The dashboard never gets a private API
   into the runtime; if the terminal cannot do it through files, neither can the browser.
3. **Honesty over polish.** Unknown state renders as unknown, never green. Every cost figure
   derived from token math carries an "est." label. Every claim links to its evidence: the
   diff, the file, the telemetry line.
4. **Local only.** Binds to `127.0.0.1`. No auth layer in v0.1 because there is no remote
   access. Adding remote access in any form is out of scope for this spec and gated on the
   threat model (ROADMAP R4).

## Architecture

```
.planning/** + telemetry JSONL + OTLP receiver
        │ (fs.watch, debounced — reuse scripts/local-watch.js pattern)
        ▼
scripts/dashboard-server.js     Node, stdlib only, no new runtime deps
  ├── normalizers (core/…)      parse-campaign, loops, fleet, telemetry readers
  ├── GET /api/*                normalized JSON snapshots
  ├── GET /api/events           SSE: push invalidation keys on file change
  ├── POST /otlp/v1/metrics     OTLP/HTTP receiver (cost mode, see below)
  └── static /                  single-bundle SPA (no CDN, works offline)
```

- Server start must not scan the world: index `.planning/` lazily, cache parsed records
  keyed by mtime, and re-parse only changed files on watch events.
- The SPA receives SSE invalidation keys (`campaigns`, `loops`, `cost`, ...) and refetches
  only the affected `/api/*` snapshot. No polling loops.
- Reuse existing parsers (`core/campaigns/parse-campaign`, evidence contracts, loops
  registry readers). The dashboard adds normalizers, not new interpretations of state.
- Port: default `4180`, `--port` to override, fail with a clear message if taken.

## Data contracts (v0.1 endpoints)

All endpoints return `{ generated_at, source_files: [...], data }`. Shapes are versioned
with a top-level `schema: 1` so v0.2 can evolve without breaking saved clients.

| Endpoint | Source | `data` shape (summary) |
|---|---|---|
| `/api/overview` | all below | `{ needs_you: Item[], active: {campaigns, fleet_agents, loops}, cost_today, last_verify }` |
| `/api/campaigns` | `.planning/campaigns/*.md` | `[{ id, title, status, phase: {n, of, title}, progress, started_at, last_handoff, evidence }]` |
| `/api/campaigns/:id` | campaign file + handoffs | full phase list, exit conditions, decisions, artifacts |
| `/api/fleet` | `.planning/fleet/` | `[{ session, agents: [{ name, scope, worktree, status, last_discovery }], wave, merge_queue }]` |
| `/api/loops` | `.planning/loops/*.json`, `daemon.json` | `[{ id, type, trigger, budget: {kind, total, spent}, verifier, last_run: {at, status}, stop_state }]` |
| `/api/hooks/feed` | telemetry JSONL | last N hook events: `{ at, event, decision, reason, target }` (blocks first) |
| `/api/handoffs` | `.planning/handoffs/`, campaign records | timeline of `{ at, campaign, summary, path }` |
| `/api/cost` | OTLP receiver + transcript fallback | see Cost modes |

`needs_you` is the product. It aggregates anything waiting on a human: campaign phase gates,
fleet merge reviews, loops in `needs-human-review` or `blocked`, stale approvals. Sorted by
age. The dashboard's home answers "do I need to do anything?" in one glance.

## Cost modes

Two user populations, two units. Mode is detected per session and shown explicitly.

**API-key mode (unit: estimated USD).**
- Source of truth: OTLP metrics from the runtime. Setup wires the env vars
  (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`,
  `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`,
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4180/otlp`) opt-in during `/do setup`.
- Metrics consumed: `claude_code.cost.usage` (USD), `claude_code.token.usage`, and request
  events carrying `cost_usd` with `skill.name` / `agent.name` / `mcp_server.name` / model /
  effort attribution. Attribution powers per-skill and per-campaign-phase cost breakdowns.
- Every dollar figure renders with "est." and a tooltip: estimates are computed locally
  from token counts and can differ from the bill; the Console is authoritative.
- Burn rate and projected cost-to-finish are derived from the active campaign's phase
  history. Projections are labeled as projections.

**Subscription mode (unit: plan window).**
- Pro/Max users do not pay per token; dollars are the wrong unit. Render plan-window
  consumption (session tokens, share of recent usage by skill/agent, activity over 24h/7d)
  from the same token telemetry, mirroring how `/usage` treats subscribers.
- Optional delight stat: "this campaign would have cost ~$X at API prices, included in
  your plan." Same "est." discipline.
- Window-percentage math is an estimate from local history (other devices not visible);
  say so in the UI.

**Fallbacks.** No OTLP: parse transcript JSONL usage fields where available. Bedrock,
Vertex, and Foundry emit no cost metrics: tokens-only with a note. Codex: token usage via
the Codex adapter; cost treated as API mode when a key is configured. Unknown: render
"telemetry off" with the one-line instruction to enable it, never zeros.

## Panels (v0.1)

| Panel | Content | Evidence links |
|---|---|---|
| Needs You (home) | aggregated interrupts, age-sorted, count in tab title | each item links to its file/diff |
| Campaigns | cards: phase progress, status, last handoff, evidence freshness | campaign md, handoff md |
| Fleet | agents, scopes, worktrees, wave status, merge queue preview | worktree paths, discovery log |
| Loops | contract cards: budget burn-down, verifier history, stop-state badge | loop JSON, review artifact |
| Cost | mode-appropriate spend, per-skill attribution, burn rate | telemetry lines |
| Hook feed | recent decisions, blocks first, friendly reason text | rule + target file |

Multi-project switching, fortress view, and any write action are explicitly v0.2+
(ROADMAP R3). Ship the six panels well.

## Quality bars

**Performance budgets (enforced by a perf check in CI against a generated fixture
project with 1,000 planning files):**
- Cold start to first render: < 1 s. Server RSS: < 50 MB. File-change to UI update:
  < 500 ms. Interaction latency: < 100 ms.
- No layout-forcing reads in render loops; SSE invalidation, never polling.

**Design language.** Dark-first with a real light mode. The four tier colors are semantic
everywhere (cyan skill, blue marshal, orange archon, purple fleet); color is never
decoration. Mono for data, sans for prose, tabular numerals for every figure. Motion only
narrates state change: 150-250 ms transitions, transforms and opacity only,
`prefers-reduced-motion` respected, 60 fps or the animation ships disabled.

**Copy voice.** Calm operator. "Archon finished phase 3. Two files need review." Numbers
over adjectives. Every empty state teaches (shows the command that would populate it);
every error names the next action.

**Keyboard.** `?` overlay, j/k through the needs-you queue, Enter to open evidence, cmd+K
switcher reserved for v0.2.

## Verification

- Unit: normalizers against fixture `.planning/` trees (healthy, mid-campaign, corrupted,
  empty) — corrupted files render as "unreadable: <path>" rows, never crash the panel.
- Contract: every `/api/*` response validates against its schema; schema files live next
  to the server and are the v0.2 compatibility baseline.
- Perf: budget script in CI per the table above.
- Visual: screenshot pass on the fixture project (the make-frame technique from the README
  work) checked at desktop and 380 px widths, dark and light.
- Manual exit check (matches ROADMAP R1): a person who has never seen Citadel opens the
  dashboard on a live project and explains what is happening within 60 seconds.

## Out of scope for v0.1

Write actions of any kind, remote access, auth, hosted anything, fortress view,
multi-project aggregation, Repobeats-style public embeds. Each is either R3 work or parked
per the roadmap.
