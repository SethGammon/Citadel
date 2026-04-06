# `@citadel/contracts`

Public contract surface for Citadel runtimes, clients, and future hosted products.

## Purpose

This package will expose the stable schemas and types that external consumers are allowed to depend on.

Initial scope:

- event envelope definitions
- runtime capability contracts
- skill and agent manifest contracts
- project spec contracts

## Source of Truth

Initial implementations should be adapted from:

- `core/contracts/events.js`
- `core/contracts/runtime.js`
- `core/contracts/capabilities.js`
- `core/contracts/skill-manifest.js`
- `core/contracts/project-spec.js`
- `core/contracts/agent-role.js`

## Boundary Rule

This package should be smaller and more stable than the internal `core/contracts` implementation surface.

Cloud and external integrations should depend on this package, not on `core/*`.
