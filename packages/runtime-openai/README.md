# `@citadel/runtime-openai`

Public runtime adapter surface for OpenAI Responses API integration.

## Purpose

This package exposes the stable runtime-facing pieces needed to describe and
configure Citadel's OpenAI integration without reaching into repo internals.

It targets the **OpenAI Responses API** (2025+), which provides:

- Built-in agent execution loop
- Shell tool for command execution
- Hosted container workspace
- Context compaction
- Reusable agent skills

## Usage

```js
const { runtime } = require('@citadel/runtime-openai');

console.log(runtime.id);           // 'openai'
console.log(runtime.displayName);  // 'OpenAI Responses API'
console.log(runtime.capabilities); // { guidance: { support: 'full', ... }, ... }
```

## Configuration

The runtime reads model configuration from environment variables:

| Variable | Default | Description |
|---|---|---|
| `CITADEL_OPENAI_MODEL` | `gpt-5.4` | Primary model for agent execution |
| `CITADEL_OPENAI_API_KEY` | (none) | OpenAI API key (required) |
| `CITADEL_OPENAI_BASE_URL` | `https://api.openai.com/v1` | API base URL for custom endpoints |
| `CITADEL_OPENAI_REASONING_EFFORT` | `high` | Reasoning effort level: low, medium, high |

Do **not** hardcode model names. When Spud (GPT-5.5/6) ships, update the
`CITADEL_OPENAI_MODEL` environment variable or config. The runtime itself is
model-agnostic.

## Responses API Features

The runtime is designed to degrade gracefully when advanced Responses API features
are unavailable:

| Feature | Available | Degradation |
|---|---|---|
| Shell tool | Yes (Responses API) | Falls back to standard tool calling |
| Hosted container | Yes (Responses API) | Falls back to local workspace |
| Context compaction | Yes (Responses API) | Falls back to Citadel-managed compaction |
| Reusable agent skills | Yes (Responses API) | Falls back to projected SKILL.md files |
| Agent execution loop | Yes (Responses API) | Falls back to single-turn tool use |

## Capability Matrix

See `docs/architecture/capability-matrix.md` for the full cross-runtime comparison.

## Source Inputs

- `runtimes/openai/*`
- `core/contracts/runtime.js`
- `core/contracts/capabilities.js`
- `core/contracts/provider.js`

## Boundary Rule

This package presents a clean runtime integration API. The private Cloud repo
and any OpenAI-targeting products should depend on this package surface, not
on repo internals.

## Provider Contract

The OpenAI provider is registered in `core/contracts/provider.js` with:

- Provider ID: `openai`
- Kind: `managed-api`
- Access modes: `api_key`, `hosted`
- Runtime IDs: `codex`, `openai`

## Codex CLI Compatibility

When used with the Codex CLI, this runtime is detected by `scripts/codex-compat.js`.
The model mapping uses this runtime's suggested defaults:

| Citadel Model Tier | OpenAI Model |
|---|---|
| `opus` | `gpt-5.4` |
| `sonnet` | `gpt-5.4-mini` |
| `haiku` | `gpt-5.4-mini` |

These mappings are configurable via `CITADEL_OPENAI_MODEL` for the primary tier.
