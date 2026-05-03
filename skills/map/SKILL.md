---
name: map
description: >-
  Structural codebase index generator. Builds a compact JSON map of files,
  exports, imports, dependency graph, and roles. Queryable by keyword. Injected
  into fleet agents as context slices to reduce token usage on code navigation.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-29
---

# /map -- Codebase Intelligence

## Orientation

Use `/map` when:
- Starting work on an unfamiliar codebase (build the index first)
- A fleet or archon campaign needs agents to know "what files matter for X"
- You want a quick structural overview (stats, roles, dependency graph)
- You need to find files related to a keyword without exploratory reads

Do not use `/map` for:
- Reading file contents (use Read)
- Searching for string patterns inside files (use Grep)
- Single-file edits where you already know the path

## Commands

| Command | Behavior |
|---|---|
| `/map` | Generate or refresh the index (skips if cache is fresh) |
| `/map --force` | Rebuild the index even if cache is fresh |
| `/map query <terms>` | Search the index for files matching keywords |
| `/map stats` | Print summary statistics (files, lines, languages, roles) |
| `/map slice <terms>` | Output a compact context slice for agent injection |

## Protocol

### Step 1: GENERATE INDEX

Run the index generator:

```bash
node scripts/map-index.js --generate --root .
```

Add `--force` if the user requested a fresh rebuild or if the index is stale.

The generator:
1. Walks the project tree (respects `.gitignore`, skips `node_modules`, `dist`, etc.)
2. Extracts exports, imports, and symbols from each source file
3. Infers a role for each file (component, hook, store, route, test, config, etc.)
4. Builds a dependency graph from resolved import paths
5. Writes the index to `.planning/map/index.json`

**Supported languages:** TypeScript, JavaScript, Python, Go, Rust.

**Cache behavior:** The index is cached for 5 minutes. Subsequent runs within
that window exit immediately unless `--force` is passed.

If `.planning/map/` does not exist, the generator creates it automatically.

### Step 2: QUERY (when user provides search terms)

```bash
node scripts/map-index.js --query "<terms>"
```

The query engine scores files by:
- Path match: +3 per term
- Export match: +5 per term
- Symbol match: +2 per term
- Role match: +1 per term

Results are sorted by score and capped at 20 files (configurable with `--max-files`).
Output is budget-capped at 8000 characters to stay injection-safe.

### Step 3: STATS (structural overview)

```bash
node scripts/map-index.js --stats
```

Outputs: file count, line count, export count, dependency edge count,
breakdown by language and by role.

### Step 4: SLICE (agent context injection)

When another skill or orchestrator needs a map slice for agent injection:

1. Run `node scripts/map-index.js --query "<scope terms>" --max-files 15`
2. Format the results as a compact block:

```
=== MAP SLICE: <terms> ===
<score> <role>  <path>  [<top exports>]  (<lines>L)
...
=== END MAP SLICE ===
```

3. The calling skill injects this block into the agent's prompt alongside
   CLAUDE.md and rules-summary.md

**Token budget:** A 15-file slice is typically 800-1200 tokens. This replaces
2000-5000 tokens of exploratory Glob/Grep results that agents would otherwise
spend finding relevant files.

## Fleet Integration

Fleet agents receive map slices automatically when `/map` index exists:

1. Before spawning each wave, Fleet checks if `.planning/map/index.json` exists
2. If it exists: Fleet runs a query scoped to each agent's assigned domain
3. The resulting slice is prepended to the agent's context alongside CLAUDE.md
   and rules-summary.md
4. If the index does not exist: Fleet proceeds without a map slice (no error)

**Context injection order:**
1. CLAUDE.md content
2. `.claude/agent-context/rules-summary.md`
3. **Map slice** (scoped to agent's domain/direction)
4. Campaign-specific direction and scope
5. Discovery briefs from previous waves

## Contextual Gates

**Disclosure:** "Generating codebase map. Creates `.planning/map/index.json`."
**Reversibility:** green — creates `.planning/map/index.json` only; undo by deleting `.planning/map/`.
**Trust gates:**
- Any: generate index, query, stats, slice.

## Quality Gates

- Index must generate without errors on any supported project
- Query must return results sorted by relevance score
- Stats output must be human-scannable in under 5 seconds
- Slice output must stay under 2000 tokens for a 15-file result
- Index must handle 100K+ line repos without hanging (iterative walker, no recursion limits)
- Cache must prevent redundant regeneration within the TTL window

## Fringe Cases

- **No source files found**: Generator writes an empty index (`fileCount: 0`). Query returns no results. Not an error.
- **`.planning/` does not exist**: Generator creates `.planning/map/` automatically via `mkdirSync({ recursive: true })`.
- **Index file missing when querying**: Error message: "Index not found. Run `node scripts/map-index.js --generate` first."
- **Binary or unsupported files**: Silently skipped. Only files with recognized language extensions are indexed.
- **Very large repos (10K+ files)**: The walker is iterative (stack-based), not recursive. No stack overflow risk. May take 5-10 seconds on first run.
- **Windows paths**: All stored paths use forward slashes for cross-platform consistency.

## Exit Protocol

After generation:
```
Map index generated: <file count> files, <edge count> dependency links
Languages: <breakdown>
Roles: <breakdown>
```

After query:
```
Results for "<terms>" (<count> matches):
  Score  Role        Path
  -----------------------------------------------
  <results>
```

After stats: print the full statistics block.

After slice: output the formatted slice block ready for injection.

Reversibility: green — delete `.planning/map/` to remove all generated artifacts; no source files modified.
