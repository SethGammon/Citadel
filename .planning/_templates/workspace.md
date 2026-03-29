---
version: 1
id: "{uuid}"
status: active
started: "{ISO timestamp}"
completed_at: null
direction: "{one-line summary}"
repos:
  - path: "{absolute path}"
    name: "{repo name}"
    branch: "workspace/{slug}/{repo-name}"
wave_count: 0
current_wave: 1
campaigns_total: 0
campaigns_complete: 0
---

# Workspace: {Title}

## Direction
{Full direction from user}

## Repos
| Name | Path | Branch | Status |
|---|---|---|---|
| {name} | {path} | workspace/{slug}/{name} | pending |

## Work Queue
| # | Repo | Campaign Direction | Scope | Deps | Wave | Status |
|---|---|---|---|---|---|---|
| 1 | {repo} | {direction} | {repo}:{path} | -- | 1 | pending |

## Cross-Repo Contracts
| Producer | Consumer | Contract | Location | Verified |
|---|---|---|---|---|
| {repo-a} | {repo-b} | {what is produced/consumed} | {file path} | -- |

## Wave Execution Log

### Wave 1
- Status: pending
- Campaigns: {list}
- Started: --
- Completed: --
- Discovery brief: --

## Shared Context (Discovery Relay)

{Accumulated cross-repo discoveries from completed waves.
Each wave appends findings here so subsequent waves have full context.}
