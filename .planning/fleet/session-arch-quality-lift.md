---
version: 1
id: "aql-2026-03-28"
status: active
started: "2026-03-28T00:00:00Z"
completed_at: null
direction: "Apply cross-codebase research findings to Citadel: shared UI utils, motion constants, Result<T> type, usePrefersReducedMotion, preload security, visual depth/polish on AppShell and ProjectSelector"
wave_count: 1
current_wave: 1
agents_total: 2
agents_complete: 0
---

# Fleet Session: arch-quality-lift

Status: active
Started: 2026-03-28T00:00:00Z
Direction: Apply research findings from Tailored Realms + Aggregator codebases to Citadel desktop app. Two parallel agents: foundations (shared utils, types, hooks, security) and visual layer (design tokens, depth polish, nav hierarchy).

## Work Queue

| # | Campaign | Scope | Deps | Status | Wave | Agent |
|---|----------|-------|------|--------|------|-------|
| 1 | foundations | src/shared/types.ts, src/renderer/utils/*, src/renderer/hooks/usePrefersReducedMotion.ts, src/preload/index.ts, screens/CampaignList.tsx, screens/CampaignDetail.tsx | none | pending | 1 | builder |
| 2 | visual-layer | index.html, src/renderer/AppShell.tsx, src/renderer/screens/ProjectSelector.tsx, src/renderer/chrome/SettingsPanel.tsx | none | pending | 1 | builder |

## Shared Context (Discovery Relay)

Research findings that inform both agents:
- App uses inline JS styles (no Tailwind, no separate CSS framework)
- Base CSS lives in index.html <style> block
- Colors are hardcoded across files (#0a0a0a, #1a1a1a, #e5e5e5, etc.)
- statusColor + formatDate are duplicated in CampaignList.tsx AND CampaignDetail.tsx
- All transitions hardcoded as '150ms' strings
- No CSS variable system yet
- Preload exposes all channels without an allowlist

## Continuation State
Next wave: 1
Blocked items: none
Auto-continue: false
