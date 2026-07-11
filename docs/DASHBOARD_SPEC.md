# Citadel Dashboard Specification (R1: schema 1 read-only)

`citadel dashboard` (also `npm run dashboard:web`) serves a local web app that renders the
project's `.planning/` state and telemetry live. It is the visible form of the harness:
campaigns, fleet, loops, hooks, costs, and handoffs in one glanceable surface.

This document specifies the read-only schema-1 projection and names the contracts that v0.2+ (two-way) will
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

All endpoints return `{ schema: 1, generated_at, source_files: [...], data }`. Shapes are versioned
with a top-level `schema: 1` so v0.2 can evolve without breaking saved clients.

Every panel payload includes `state: { path, status, detail, count, unreadable }`. Status is
`healthy`, `empty`, `mid-run`, `unknown`, or `unreadable`. Missing input is `unknown`, malformed
input is `unreadable`, and neither may be presented as a green zero.

| Endpoint | Source | `data` shape (summary) |
|---|---|---|
| `/api/overview` | all below | `{ needs_you: Item[], active: {campaigns, fleet_agents, loops}, cost_today, last_verify }` |
| `/api/campaigns` | `.planning/campaigns/*.md` | `[{ id, title, status, phase: {n, of, title}, progress, started_at, last_handoff, evidence }]` |
| `/api/fleet` | `.planning/fleet/` | `[{ session, agents: [{ name, scope, worktree, status, last_discovery }], wave, merge_queue }]` |
| `/api/loops` | `.planning/loops/*.json`, `daemon.json` | `[{ id, type, trigger, budget: {kind, total, spent}, verifier, last_run: {at, status}, stop_state }]` |
| `/api/hooks/feed` | telemetry JSONL | last N hook events: `{ at, event, decision, reason, target }` (blocks first) |
| `/api/handoffs` | `.planning/handoffs/`, campaign records | timeline of `{ at, campaign, summary, path }` |
| `/api/cost` | OTLP receiver + transcript fallback | see Cost modes |
| `/api/activation` | activation report or local activation JSONL | redacted totals by stage, status, failure, and acquisition source |

`needs_you` is the product. It aggregates anything waiting on a human: campaign phase gates,
fleet merge reviews, loops in `needs-human-review` or `blocked`, stale approvals. Sorted by
age. The dashboard's home answers "do I need to do anything?" in one glance.

## Cost modes

Two user populations, two units. Mode is detected per session and shown explicitly.

**API-key mode (unit: estimated USD).**
- Source of truth in schema 1 is local session cost telemetry. An OTLP receiver is a future
  extension and is not exposed by the read-only server.
- Current projections aggregate `session-costs.jsonl` and label campaign totals as estimates.
- Every dollar figure renders with "est." and a tooltip: estimates are computed locally
  from token counts and can differ from the bill; the Console is authoritative.

**Subscription mode (unit: plan window).**
- Pro/Max users do not pay per token; the current UI calls estimated dollars plan-load
  indicators rather than charges. Plan-window percentages remain future work.

**Fallbacks.** When no local cost telemetry is available, render unknown with a one-line
instruction to enable it, never zero. Provider-specific token and OTLP adapters remain future work.

## Panels (v0.1)

| Panel | Content | Evidence links |
|---|---|---|
| Needs You (home) | aggregated interrupts, age-sorted, count in tab title | each item links to its file/diff |
| Campaigns | cards: phase progress, status, last handoff, evidence freshness | campaign md, handoff md |
| Fleet | agents, scopes, worktrees, wave status, merge queue preview | worktree paths, discovery log |
| Loops | contract cards: budget burn-down, verifier history, stop-state badge | loop JSON, review artifact |
| Cost | tracked or estimated session and campaign spend, explicitly labeled | telemetry lines |
| Hook feed | recent decisions, blocks first, friendly reason text | rule + target file |
| Activation | local redacted funnel totals and acquisition source counts | activation report JSON |

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
- Contract: every documented projection endpoint returns a schema-1 envelope and explicit source state.
- Perf: budget script in CI per the table above.
- Visual: screenshot pass on the fixture project (the make-frame technique from the README
  work) checked at desktop and 380 px widths, dark and light.
- Manual exit check (matches ROADMAP R1): a person who has never seen Citadel opens the
  dashboard on a live project and explains what is happening within 60 seconds.

### Current evidence (2026-07-10)

- `node scripts/test-dashboard-web.js`: healthy, initialized-empty, absent, mid-run, and
  corrupt fixtures pass; all nine API projections return schema 1 with explicit source state.
- `node scripts/test-dashboard-perf.js`: deterministic 1,000-file Windows focused runs after
  update-path caching measured 251.9-588.4 ms cold and 110.8-228.5 ms invalidated updates.
  Absolute RSS was 53.3-55.2 MB across focused and aggregate runs, so the strict
  `<50 MB` target is **not proven** on this runtime. The portable test gates dashboard-attributed
  overhead and reports the absolute result for CI/platform evaluation.
- `node scripts/test-dashboard-visual.js`: dark/light desktop and 380 px design-token/layout
  baselines plus keyboard and reduced-motion contracts pass. This is browserless structural
  evidence, not a pixel screenshot baseline; pixel captures remain pending a browser runtime.
- Human comprehension remains external: the 8/10 first-time-user result and the under-60-second
  explanation check are not yet proven.

## Out of scope for v0.1

Write actions of any kind, remote access, auth, hosted anything, fortress view,
multi-project aggregation, Repobeats-style public embeds. Each is either R3 work or parked
per the roadmap.
