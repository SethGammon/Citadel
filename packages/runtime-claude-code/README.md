# `@citadel/runtime-claude-code`

Public runtime adapter surface for Claude Code integration.

## Purpose

This package will expose the stable runtime-facing pieces needed to install, configure, and describe Citadel's Claude Code integration without reaching into repo internals.

Initial scope:

- runtime metadata
- hook install entrypoints
- guidance generation entrypoints
- compatibility helpers

## Source Inputs

- `runtimes/claude-code/*`
- `core/runtime/registry.js`
- `core/hooks/install.js`

## Boundary Rule

This package should present a clean runtime integration API while allowing the repo to keep richer internal implementation details private to the OSS codebase.
