# context-compress MCP server

Provides a `smart_read` tool that compresses large file reads before they land
in Claude's context window.

## Protocol and distribution

The server uses newline-delimited JSON-RPC 2.0 over stdio only. It supports
handshake revisions `2024-11-05`, `2025-03-26`, `2025-06-18`, and
`2025-11-25`, plus the per-request-metadata revision `2026-07-28`. The shared
adapter, lifecycle rules, modern metadata requirements, and error behavior are
documented in [`docs/MCP_PROTOCOL_SUPPORT.md`](../../docs/MCP_PROTOCOL_SUPPORT.md).

`context-compress` is source-local. It is not registered by Citadel's bundled
Claude/Codex MCP manifests and is not included in the private `npm pack`
boundary or the GitHub Release artifact. Run it from a full source checkout
with the fixed project-root configuration below.

## Why

Context rot degrades all models as context grows (Morph, 2026). Raw file reads
and verbose command outputs are the primary blowout vectors in long campaign
sessions. This server intercepts those operations at the source, returning
structure instead of raw bytes.

## Compression tiers

| Output size | Strategy |
|---|---|
| < 300 lines | Full content -- no compression |
| 300-1000 lines | Head + tail + structural index |
| > 1000 lines | Head + tail + index + section guide |

No LLM call needed -- compression uses structural heuristics (function/class
names, error lines, section headings).

## Required project-root boundary

`smart_read` requires `CITADEL_PROJECT_ROOT` to be set to one absolute,
existing project directory when the server starts. It fails closed when that
setting is missing, relative, or invalid. Relative read paths resolve against
that fixed root; absolute paths are accepted only when their canonical target
is still inside it.

Containment is checked again after resolving symlinks and Windows junctions.
The server also refuses every `.env*` variant and common credential, private
runtime-state, private-key, and keystore files. Protected names are omitted
from directory listings.

## Enable for a fixed project

Add to `~/.claude/settings.json`:

```json
"mcpServers": {
  "context-compress": {
    "command": "node",
    "args": ["/absolute/path/to/Citadel/mcp-servers/context-compress/index.js"],
    "env": {
      "CITADEL_PROJECT_ROOT": "C:/absolute/path/to/project"
    }
  }
}
```

A global registration is still bound to that one project root. Use separate
named registrations when you intentionally need the server for multiple
projects; do not omit the root and rely on the process working directory.

## Enable for one project only

Add the same server entry to `.claude/settings.json` in the project root
instead, with `CITADEL_PROJECT_ROOT` set to that project's absolute path.

## Usage

Claude will see `smart_read` as an available tool. Prompt Claude to prefer it
for large-file reads:

> "When reading files that may be large, use smart_read."

Or add to the project's CLAUDE.md (no global instruction needed if Claude Code
loads the tool description, which includes the "Use instead of..." guidance).

## When NOT to use

- Targeted reads where you know offset/limit: use native Read
- Any operation where you need exact raw file content (e.g. checking a specific line)

## Security boundary

This server intentionally exposes no command-execution tool. Shell commands must
use the runtime's native command tool so Citadel's command policy hooks remain in
the enforcement path.

## No dependencies

Pure Node.js, no npm install required.
