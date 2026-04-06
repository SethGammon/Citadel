# `@citadel/client`

Public client surface for transporting Citadel events and metadata beyond the local harness.

## Purpose

This package will own the normalized client-facing emission layer between local Citadel activity and optional remote sinks.

Initial scope:

- local event normalization
- sink interfaces for local-only and cloud delivery
- transport-agnostic event submission primitives

## Source Inputs

Initial implementation work should draw from:

- `core/telemetry/*`
- `core/hooks/normalize-event.js`
- selected runtime adapter behavior in `runtimes/*`

## Boundary Rule

This package should not contain hosted logic. It should provide a clean client-side integration surface that works with local-only sinks and future Cloud sinks.
