# MCP protocol support

Citadel's local MCP servers support two protocol eras over newline-delimited
JSON-RPC 2.0 on stdio. This contract applies to:

- `mcp-servers/citadel-state/index.js`
- `mcp-servers/codebase-memory/index.js`
- `context-compress` (source-local)

The servers expose the same tools, resources, schemas, project boundaries, and
authorization behavior in every supported revision. Protocol negotiation may
change the wire envelope; it must not widen what a server can read or mutate.
No Citadel MCP server in this contract exposes HTTP, SSE, or another transport.

## Distribution status

`citadel-state` and `codebase-memory` are the two distributed servers. They are
registered by `.claude-plugin/.mcp.json`, projected into Codex configuration,
and shipped by both the private local `npm pack` boundary and the supported
GitHub Release artifact. Each artifact includes their entrypoints and the
shared `mcp-servers/protocol-adapter.js` they import.

`context-compress` is source-local. It is available from a full checkout but is
not registered by the bundled Claude/Codex MCP manifests and is not included in
either distribution artifact. This is a distribution distinction only: its
source entrypoint implements the same protocol revisions and stdio-only
transport contract.

## Supported revisions

| Revision | Era | Lifecycle | Status |
|---|---|---|---|
| `2024-11-05` | handshake | `initialize`, then `notifications/initialized` | supported |
| `2025-03-26` | handshake | `initialize`, then `notifications/initialized` | supported |
| `2025-06-18` | handshake | `initialize`, then `notifications/initialized` | supported |
| `2025-11-25` | handshake | `initialize`, then `notifications/initialized` | supported |
| `2026-07-28` | modern | per-request metadata; optional `server/discover` | supported |

The date strings above are an allowlist, not a date comparison. A future,
unknown, malformed, or otherwise unlisted value is unsupported.

## Era selection

One shared protocol adapter owns parsing, era selection, version validation,
response decoration, and JSON-RPC errors for all three servers. Application
handlers receive normalized method and parameter values and do not implement
version negotiation themselves.

For stdio, the first era-defining message selects the connection's behavior:

- `initialize` selects the handshake era.
- `server/discover` carrying modern request metadata selects the modern era.
- Any other request carrying
  `params._meta["io.modelcontextprotocol/protocolVersion"]` selects the modern
  era directly; discovery is recommended but not required.
- A bare application request remains accepted as handshake-era traffic for
  compatibility with existing Citadel clients that do not enforce lifecycle
  ordering.

Once selected, a connection cannot switch eras. A modern connection does not
gain handshake semantics, and an initialized handshake connection does not
gain modern semantics. Every modern request is still validated independently;
connection selection is not a substitute for its required metadata.

## Handshake-era behavior

An `initialize` request whose `params.protocolVersion` is one of the four
handshake revisions receives that exact revision in the result. An unsupported
explicit revision receives `2025-11-25`, the newest handshake revision the
server supports; the client must disconnect if it cannot use the returned
revision. `2026-07-28` is not negotiable through `initialize`.

For compatibility with the current direct-wire tests and older minimal clients,
an omitted `params.protocolVersion` is tolerated and selects `2024-11-05`.
This tolerance is not advertised as protocol-conformant client behavior.

The initialize result preserves each server's existing `capabilities`,
`serverInfo`, and optional `instructions`. `notifications/initialized` is
accepted without a response. Existing clients may continue to send application
requests without modern metadata. Unknown requests return JSON-RPC
`-32601` (`Method not found`); unknown notifications receive no response.

## Modern behavior (`2026-07-28`)

The modern era has no `initialize`/`notifications/initialized` handshake and no
protocol-level session. Each request carries, inside `params._meta`:

- `io.modelcontextprotocol/protocolVersion`: required and exactly
  `2026-07-28`;
- `io.modelcontextprotocol/clientCapabilities`: required object;
- `io.modelcontextprotocol/clientInfo`: optional, but validated when present.

`server/discover` is implemented by every server. It returns:

- `resultType: "complete"`;
- `supportedVersions: ["2026-07-28"]` (only per-request-metadata revisions are
  advertised here; handshake revisions remain available through `initialize`);
- the same server capabilities and instructions used by its initialize result;
- `_meta["io.modelcontextprotocol/serverInfo"]` with the server's existing name
  and version;
- `ttlMs: 0` and `cacheScope: "private"`, the conservative no-reuse defaults.

Discovery is optional. A conformant modern client may send `tools/list`,
`tools/call`, `resources/list`, or `resources/read` directly with the required
metadata. Every successful modern result includes `resultType: "complete"` and
the server-info result metadata. Cacheable list and resource-read results also
include `ttlMs: 0` and `cacheScope: "private"`. Tool ordering remains stable.

A message on a modern connection, or one that otherwise declares modern
metadata, is rejected with JSON-RPC `-32602` (`Invalid params`) before dispatch
when any required envelope structure is invalid. This includes missing or
non-object `params._meta`, missing or non-string
`io.modelcontextprotocol/protocolVersion`, and missing or non-object
`io.modelcontextprotocol/clientCapabilities`. A present but malformed
`io.modelcontextprotocol/clientInfo` is invalid for the same reason.

Only a structurally valid envelope whose string protocol version is not on the
allowlist is rejected with JSON-RPC error `-32022` (`Unsupported protocol
version`) and data:

```json
{
  "supported": ["2026-07-28"],
  "requested": "the supplied unsupported version"
}
```

No application handler runs after this rejection. A modern `initialize`
request is rejected as method-not-found. The removed
`notifications/initialized` notification has no lifecycle effect.

On stdio, a dual-era client should probe with `server/discover`. A valid
discovery result confirms the modern era. Error `-32022` confirms a modern
server but an unsupported version and must not trigger legacy fallback. Any
other error or timeout may be treated by the client as a legacy server and
retried with `initialize`; fallback must not depend on one legacy error code.

## Wire and product invariants

- Stdout contains only one complete JSON-RPC message per line. Diagnostics go
  to stderr. Parse failures use `-32700`; invalid requests use `-32600`.
- Request IDs are echoed without coercion. Notifications never receive JSON-RPC
  responses.
- Existing tool names, descriptions, input schemas, resource URIs, response
  content, and MCP error behavior remain unchanged apart from required modern
  result fields.
- `citadel-state` keeps its fixed project boundary, activation checks,
  capability checks, immutable intent queue, and prohibition on command or
  campaign-file execution.
- `codebase-memory` remains local and read-oriented apart from rebuilding its
  derived map index. Its git-ref validation is unchanged.
- `context-compress` continues to require a fixed absolute project root and to
  reject traversal, symlink escape, dotenv files, credentials, keys, and
  private runtime state.
- The adapter never interprets client or server identity as authorization.
- The modern path is exercised directly at the wire level and cannot depend on
  Codex experimental feature flags.

## Dependency decision

Use a shared, dependency-free local protocol adapter rather than the official
MCP SDK.

This repository currently has no runtime dependencies: `package.json` declares
none and `package-lock.json` contains only the root package. The MCP entrypoints
are plain Node.js files, the private npm allowlist ships bundled MCP sources
directly, and the GitHub release artifact does not embed `node_modules`.
Preserving that property keeps offline installation, startup, packaging, and
the existing clients unchanged. The three servers expose a small subset of MCP
(tools and, for two servers, one resource), so implementing the two lifecycle
eras in one focused adapter is economically smaller than adopting and packaging
the SDK's server, transport, and schema layers.

The tradeoff is that Citadel owns protocol drift and schema accuracy. Mitigate
that with a single version allowlist, a single adapter, pinned raw-wire fixtures
for both eras, direct tests of every supported revision, and negative tests for
missing/unknown versions, cross-era switching, and response decoration. Revisit
the official SDK if Citadel adds HTTP transport, server-to-client interactions,
extensions, or enough protocol surface that the local adapter stops being
smaller and auditable.

## Conformance approach

Conformance is wire-first. Tests spawn each real stdio entrypoint and assert the
newline-delimited JSON-RPC messages without relying on a client SDK.

The full source checkout includes a maintainer-only external conformance runner
that is not included in the slim npm or GitHub Release payload. It downloads
the official protocol schema for every advertised revision from an immutable
`modelcontextprotocol/modelcontextprotocol` commit, verifies the committed
SHA-256 digest before parsing, and validates real transcripts from all three
Citadel stdio processes against the corresponding lifecycle and result
definitions. It fails closed on provenance drift, a missing schema definition,
bad framing, process failure, response-ID drift, negotiation drift, or missing
modern result and server-identity fields. A successful run writes its detailed
per-revision/per-server counts to
`.planning/verification/mcp-external-conformance.json`.

The pin manifest also verifies the official
`modelcontextprotocol/conformance` README at an immutable commit. At that pin,
the documented server runner accepts `--url` for an HTTP endpoint; it does not
document a stdio-server mode. Upstream issue
[`modelcontextprotocol/conformance#258`](https://github.com/modelcontextprotocol/conformance/issues/258)
tracks the stdio-server request. Consequently, this gate is pinned external
schema conformance plus Citadel-owned stdio wire validation. It is not an
official upstream server certification. Routine `test-all` runs only the
offline pin-manifest trust check and never depend on the network.
The runner and its pin manifest are repository verification infrastructure;
they are not part of the end-user npm or GitHub Release payload.

The required matrix is:

1. Initialize each handshake revision and assert exact version echo plus the
   unchanged server capabilities.
2. Preserve the existing omitted-version and legacy application-call flows.
3. Probe `server/discover` with a complete modern envelope and assert the exact
   discovery, identity, cache, and capability shape.
4. Invoke each server's representative tools and resources directly in the
   modern era and assert required result metadata without changing payloads.
5. Reject malformed versions and incomplete envelopes with `-32602`; reject a
   well-formed unsupported version with `-32022`; and reject modern
   `initialize` and cross-era switching before dispatch.
6. Run the existing server and integration suites to catch compatibility,
   security-boundary, packaging, and runtime-registration regressions.

Baseline at commit `a4c5158fa1729a04dd0b660494d79722ab4cc187` on Windows:

| Command | Exit status | Result |
|---|---:|---|
| Citadel-state MCP suite | 0 | 21 JSON-RPC calls passed |
| Codebase-memory smoke suite | 0 | 9 smoke checks passed |
| Context-compress MCP suite | 0 | 21 calls and 2 link checks passed |
| Codex native integration suite | 0 | native integration tests passed |

The codebase-memory run emitted only local Git global-ignore permission
warnings; they did not affect its exit status or assertions.

## Non-goals

This work does not add HTTP, SSE, OAuth, remote hosting, protocol sessions,
server-to-client requests, MRTR application flows, subscriptions, prompts,
tasks, extensions, or new resources. It does not change tool schemas,
authorization, project boundaries, Codex feature flags, publishing, pushing,
CI configuration, or release ownership.

## Protocol references

- [MCP 2026-07-28 discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [MCP 2026-07-28 stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
