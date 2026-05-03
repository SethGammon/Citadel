# context-compress MCP server

Provides `smart_read` and `smart_bash` tools that compress large file reads and
command outputs before they land in Claude's context window.

## Why

Context rot degrades all models as context grows (Morph, 2026). Raw file reads
and verbose command outputs are the primary blowout vectors in long campaign
sessions. This server intercepts those operations at the source, returning
structure instead of raw bytes.

## Compression tiers

| Output size | Strategy |
|---|---|
| < 300 lines (read) / < 100 lines (bash) | Full content -- no compression |
| 300-1000 lines / 100-500 lines | Head + tail + structural index |
| > 1000 lines / > 500 lines | Head + tail + index + section guide |

No LLM call needed -- compression uses structural heuristics (function/class
names, error lines, section headings).

## Enable globally

Add to `~/.claude/settings.json`:

```json
"mcpServers": {
  "context-compress": {
    "command": "node",
    "args": ["C:/Users/gammo/Desktop/Citadel/mcp-servers/context-compress/index.js"]
  }
}
```

## Enable for one project only

Add to `.claude/settings.json` in the project root instead.

## Usage

Claude will see `smart_read` and `smart_bash` as available tools. Prompt Claude
to prefer them for large-file reads and verbose commands:

> "When reading files that may be large, use smart_read. For commands that produce
> verbose output (typecheck, build, find, grep across many files), use smart_bash."

Or add to the project's CLAUDE.md (no global instruction needed if Claude Code
loads the tool description, which includes the "Use instead of..." guidance).

## When NOT to use

- Targeted reads where you know offset/limit: use native Read
- Short commands: use native Bash
- Any operation where you need exact raw output (e.g. checking a specific line)

## No dependencies

Pure Node.js, no npm install required.
