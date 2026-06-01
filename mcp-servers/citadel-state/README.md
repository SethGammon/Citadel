# citadel-state MCP server

`citadel-state` exposes Citadel planning state to Codex through MCP. It is intentionally read-mostly:

- `citadel_status` summarizes `.planning/`, campaigns, fleet sessions, telemetry, and app artifacts.
- `citadel_workflow_prompt` returns concise prompts for Citadel workflows such as `triage`, `pr-watch`, `daemon`, `schedule`, and `qa`.
- `citadel://status` is a resource view of the same state.

The server lets Codex use Citadel state without scraping terminal output or rereading the whole repository. It is bundled through `.mcp.json` and can also be configured in Codex `config.toml`.

Quick local protocol check:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | node mcp-servers/citadel-state/index.js
```
