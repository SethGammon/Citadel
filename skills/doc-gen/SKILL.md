---
name: doc-gen
description: >-
  Documentation generator with three modes: function-level (JSDoc/docstrings),
  module-level (directory READMEs), and API reference (endpoints/exports).
  Reads existing project doc style and matches it. Never generates docs that
  just restate what the signature already says.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - document
  - docs
  - docstring
  - jsdoc
  - readme
  - api docs
last-updated: 2026-03-20
---

# /doc-gen — Documentation Generator

## When to Use

- Add JSDoc/docstrings to functions in a file or set of files
- Write a README for a module or directory
- Document an HTTP API or exported library surface

Mode auto-detected from target:
- **File path** → function-level mode
- **Directory path** → module-level mode
- **Route file or API directory** → API reference mode
- **Explicit override**: `/doc-gen --mode function|module|api [target]`

## Commands

| Command | Behavior |
|---|---|
| `/doc-gen [file]` | Function-level docs for a file |
| `/doc-gen [directory]` | Module-level README for a directory |
| `/doc-gen --api [target]` | API reference for endpoints or exports |
| `/doc-gen --mode [mode] [target]` | Force a specific mode |
| `/doc-gen --dry-run [target]` | Show what would be documented without writing |

## Protocol

### Phase 1: DETECT STYLE

1. Read CLAUDE.md for doc conventions
2. Search for existing doc comments in the target area — note density, tone, tags used, and line length
3. Default when no existing docs: JSDoc (`@param`, `@returns`, `@throws`, `@example`) for TS/JS; Google-style for Python; idiomatic format for others

Apply detected style consistently across all generated docs.

### Phase 2: ANALYZE TARGET

#### Function-Level Mode

For each function:

1. Read the full body, not just the signature
2. Classify:
   - **Trivial**: simple getters/setters, one-line wrappers with obvious names — SKIP
   - **Non-trivial**: document purpose, parameter semantics (not types — TS has those), return guarantees, throws/errors, side effects, non-obvious edge cases, and `@example` when usage is non-obvious
3. Write using detected style

**Core rule:** every doc must add information beyond what the signature already says. If you cannot, skip it.

#### Module-Level Mode

1. Read all files in the directory (one level deep)
2. Identify: problem space, key exports, internal files, external dependencies, and what imports this module
3. README schema: `# {Module Name}` | one-paragraph description | `## Key Exports` table (name, description) | `## Architecture` (only if non-obvious internal structure) | `## Usage` (real import paths) | `## Dependencies` (non-obvious only)
4. If a README already exists, update rather than replace — preserve sections not covered by your analysis

#### API Reference Mode

For HTTP endpoints: method + path, description, path/query/body params (with types), response shape and status codes, errors, auth level, and a curl/fetch example for non-trivial endpoints.

For exported libraries: name and kind (function/class/constant/type), description, parameters/properties with semantics, return type with guarantees, import and usage example.

Structure as a single reference document with a table of contents.

### Phase 3: WRITE

1. Apply detected style consistently
2. Function-level: insert doc comments above each function
3. Module-level: write or update README.md in the target directory
4. API reference: write to `docs/api/` or adjacent to route files
5. Run typecheck after writing (malformed JSDoc can cause TS errors)

### Phase 4: VERIFY

Re-read every doc comment. For each: "Does this add information beyond the signature?" If not, delete it. Check accuracy: parameter names, return types, side effects, and that examples would actually compile/run.

## Contextual Gates

**Disclosure:** "Generating documentation for [target]. Source files will be modified."
**Reversibility:** amber — adds JSDoc/docstrings to source files; undo with `git checkout` on modified files.
**Trust gates:**
- Any: additive doc generation on undocumented functions.
- Familiar (5+ sessions): rewriting existing docstrings that may discard prior content.

## Quality Gates

- Every doc comment adds information beyond the signature; if not, delete it
- Docs match actual code behavior — wrong docs are worse than no docs
- Style matches the project's existing convention throughout
- No `@param name - The name` filler; omit parameters when their name is self-explanatory
- Typecheck passes after insertion
- At least some functions skipped as trivial — if every function was documented, you over-documented

## Exit Protocol

```
=== Doc-Gen Report ===
Mode: {function-level | module-level | api-reference}
Target: {path}
Style: {detected style}
Documented: {N functions ({M} skipped as trivial) | README.md ({N} exports) | {N} endpoints}
Skipped: {item}: {reason}
```

```
---HANDOFF---
- Generated {mode} docs for {target}
- Matched existing {style} convention
- {what was skipped and why}
- Reversibility: amber — undo with `git checkout` on modified source files
---
```
