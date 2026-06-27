# codebase-memory MCP server

An **optional, read-only, repo-agnostic** orientation layer for agents working a
cold or large repository. It lets an agent answer structural questions — *who
imports this, what does it depend on, what breaks if I change it* — by querying a
graph instead of grepping and reading file after file into context.

It is **not** a replacement for `CLAUDE.md` / `AGENTS.md` / capability manifests
(those are human-authored doctrine). This is mechanical structure. The two are
complementary; never auto-write a manifest from this index.

## How it works

It reuses Citadel's existing `core/map` index generator (tree-walked
exports/imports/symbols/roles + a resolved forward dependency graph, cached at
`.planning/map/index.json`) and adds the query surface `core/map` doesn't expose:
reverse edges, path tracing, and change-impact. Pure Node, **no dependencies**,
MCP `2024-11-05` JSON-RPC over stdio. The index is local and derived; nothing
leaves the machine.

The tool's value is highest on repos with little documentation — it does not
displace the docs-first orientation Citadel already encourages, it backstops it.

## Tools

| tool | returns |
|------|---------|
| `get_architecture` | language/role stats, top fan-in files, routes, verification commands — start here on a cold repo |
| `search_symbols` | ranked file pointers for symbol/export/route terms (where is X) |
| `who_imports` | reverse lookup — which files import a given file |
| `dependencies_of` | forward — which internal files a given file imports |
| `trace_path` | shortest dependency path between two files (BFS) |
| `impact_of_change` | changed files vs a git base → direct importers, fan-in risk-ranked |
| `index_status` | index location, file count, staleness (added/removed/changed) |
| `reindex` | force a rebuild after a large pull/branch switch |

## Accuracy model

- **Import/dependency graph is accurate** for relative/internal imports
  (`who_imports`, `dependencies_of`, `trace_path`).
- It is **file-granular**, inheriting `core/map`'s regex extraction — it answers
  "which *file* imports this file", not "which *function* calls this function".
  `impact_of_change` dependents are direct (1-hop) importers.
- `search_symbols` is a ranked heuristic over extracted symbols, not a type-aware
  index. Treat results as leads.

## Enable it

Already registered in this repo's `.mcp.json`. For another project, add:

```json
{
  "mcpServers": {
    "codebase-memory": {
      "command": "node",
      "args": ["mcp-servers/codebase-memory/index.js"],
      "env": { "CITADEL_PROJECT_ROOT": "." }
    }
  }
}
```

`CITADEL_PROJECT_ROOT` defaults to the process working directory.

## Verify

```bash
node mcp-servers/codebase-memory/smoke-test.js
```

Drives a full JSON-RPC handshake + tool calls against this repo and asserts the
responses.
