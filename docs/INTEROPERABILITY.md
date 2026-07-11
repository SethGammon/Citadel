# Interoperability

Citadel accepts a standard external `SKILL.md` with the portable `name` and
`description` frontmatter fields. The compatibility proof copies the source
unchanged into isolated Claude Code and Codex discovery trees, verifies the
copied digest, routes an explicit invocation, executes a deterministic
instruction contract, records local-only telemetry, emits a Citadel handoff,
and removes the temporary runtime tree.

## Reproduce the proof

```bash
node scripts/generate-distribution-metadata.js --check
node scripts/test-ecosystem-compat.js
```

The fixture at
`scripts/fixtures/ecosystem/anthropics-template-skill/` is the unmodified
Anthropic Agent Skills template. Its provenance record includes the public
source URL, repository ref, license basis, retrieval date, and SHA-256 digest.
The digest identifies the tested bytes and the fixture is pinned to Anthropic's immutable
commit `9d2f1ae187231d8199c64b5b762e1bdf2244733d`; a GitHub contents lookup at that
commit returned blob `50a4f9b104357d96361e257adb70454604cd15c0`, whose UTF-8 bytes match the
recorded SHA-256. The Apache-2.0
label is inferred for this non-document template from the primary repository
README's licensing statement; no root license file was verified.

## Security boundary

- Source and destination paths must remain inside real, non-symlink roots.
- Tests block Node HTTP, HTTPS, TCP, and `fetch`; the proof needs no network.
- Telemetry stores request and source digests, never prompt contents or secrets.
- The fixture source is read-only by contract and re-hashed after execution.
- Cleanup removes the entire temporary runtime tree; only proof telemetry and
  the handoff remain in the caller-owned evidence directory.

## What this proves

The local Claude Code skill-directory contract and Citadel's Codex projection
contract both pass. This does **not** claim acceptance by any remote plugin
registry, marketplace review, profile scanner, or third-party runtime. Those
remain external distribution checks. Immutable upstream provenance is locally verified;
publisher identity and registry acceptance remain external gates rather than inferred claims.

## Live registry inspection (2026-07-11)

- [ClaudePluginHub](https://www.claudepluginhub.com/plugins/sethgammon-citadel) indexes
  `sethgammon/citadel` as version `1.1.0`, attributes it to SethGammon, and exposes 49
  skills, 7 agents, 1 hook group, and 2 MCP servers. The listing also shows “Own this
  plugin? Sign in to claim,” so the publisher account is not verified. Its install count
  is zero; indexing and stars are not install or runtime proof.
- [HOL](https://hol.org/registry/plugins/citadel%2Fcitadel) lists `citadel/citadel` as safe
  with trust score 92, but its registry snapshot is still version `1.0.0` and explicitly
  reports publisher verification `No`.

These pages prove discoverability and scanner acceptance. They also directly contradict the
milestone's verified-publisher/current-version requirement, so the registry gate remains failed
until ownership is claimed and HOL refreshes to the released version.
