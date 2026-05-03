---
name: wiki
description: >-
  Markdown-first knowledge base where the LLM acts as librarian. Ingests raw
  sources, compiles and interlinks topic files, self-maintains an index. No
  vector DB or embeddings required -- uses LLM-native navigation over structured
  markdown up to ~400K words.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - wiki
  - knowledge base
  - llm wiki
  - project wiki
  - build a wiki
  - maintain knowledge
  - knowledge management
  - llm-wiki
  - karpathy wiki
last-updated: 2026-04-06
---

# /wiki -- LLM-Native Knowledge Base

## Orientation

**Use when:** building and querying a markdown-first knowledge base -- ingests raw notes, deduplicates, surfaces answers.
**Don't use when:** capturing session learnings into the evolve pipeline (use /learn); generating structured code documentation (use /doc-gen).

## Directory Structure

```text
wiki/
  index.md              # Master index
  raw/                  # Unprocessed sources (timestamped files)
  topics/               # Compiled topic files (one per topic, interlinked)
  .wiki-meta.json       # Stats: topic count, source count, last compaction
```

## Commands

| Command | Behavior |
|---|---|
| `/wiki` | Status overview: topic count, last update, pending raw sources |
| `/wiki --add [source]` | Ingest a new source into the wiki |
| `/wiki --query [question]` | Answer a question using wiki knowledge |
| `/wiki --status` | Detailed wiki health: topic count, staleness, orphan detection |
| `/wiki --compact` | Merge, deduplicate, and reorganize topics |
| `/wiki --rebuild-index` | Regenerate index.md from current topic files |
| `/wiki init [path]` | Initialize a new wiki at the specified path |

## Protocol

### Command: `/wiki init [path]`

Create `wiki/`, `wiki/raw/`, `wiki/topics/`, an empty `wiki/index.md`, and `wiki/.wiki-meta.json` with fields: `created`, `lastUpdated`, `topicCount: 0`, `sourceCount: 0`, `totalWords: 0`, `lastCompaction: null`. Default path: `wiki/` at project root.

### Command: `/wiki --add [source]`

Ingest a new source into the wiki.

**Step 1:** Determine source type — URL (fetch with WebFetch), file path (read), raw text (use directly), no argument (ask user).

**Step 2:** Write raw content to `wiki/raw/source-{timestamp}.md` with header: title/URL, ingested date, type, original reference.

**Step 3:** Identify 1-5 topics. For each: check if a topic file already exists — append to existing or create `wiki/topics/{slug}.md`.

**Step 4:** Each topic file has: title, `> Last updated`, `> Sources`, compiled content, and `## Related Topics` with `[[slug]]` cross-links. Scan existing topics for cross-links when writing.

**Step 5:** Regenerate `wiki/index.md` with stats header, Topics table (`[[slug]]` | summary | last updated), and Recent Sources table.

**Step 6:** Update `wiki/.wiki-meta.json` with new counts.

**Step 7:** Output: source description, topics created, topics updated, index counts.

### Command: `/wiki --query [question]`

1. Read `wiki/index.md`, identify 1-5 relevant topic files, explain reasoning briefly
2. Read those topics; follow `[[cross-links]]` up to 2 hops if relevant
3. Produce a clear answer citing specific topic files used
4. If the wiki lacks enough information: state what it knows, list gaps, suggest `/wiki --add` for missing areas

### Command: `/wiki --status`

Read meta, count topic files and raw sources, check for orphaned topics, broken cross-links, and stale topics (30+ days). Output: topic/source/word counts, last updated/compaction dates, and health issues with counts and lists.

### Command: `/wiki --compact`

1. Read `wiki/index.md` and all topic files
2. Identify: merge candidates (overlapping subjects), split candidates (multiple distinct subjects), stale/outdated content, duplicates
3. For each change: describe what and why, make the change, update all affected cross-links
4. Rebuild `wiki/index.md` and update `wiki/.wiki-meta.json` with `lastCompaction` and new counts
5. Output: topics merged/split/removed/resolved, final count, estimated words

### Command: `/wiki --rebuild-index`

Read all topic files, extract title/summary/date, write a fresh `wiki/index.md`. Output: "Index rebuilt with {count} topics."

## Fringe Cases

- **`.planning/` does not exist**: Run `/do setup` first to initialize the harness state directory.
- **No wiki directory**: Prompt to run `/wiki init`. Do not auto-create on query or status.
- **Source >50K words**: Split into sections, warn the user.
- **Topic name collision**: Merge into existing topic, do not overwrite.
- **Empty wiki queried**: "The wiki is empty. Add sources with `/wiki --add`."
- **Broken cross-link**: During compaction/rebuild — flag. During --add — create stub `[[missing-topic]] (stub -- needs content)` if no context.
- **URL fetch fails**: Report failure, suggest pasting content directly.
- **Wiki >~400K words**: Warn during --status, suggest archiving or `/wiki --compact`.

## Contextual Gates

**Disclosure:** "Updating wiki at `.planning/wiki/`. Files will be created or modified."
**Reversibility:** amber — creates and modifies `.planning/wiki/` files; undo by deleting or reverting changed files.
**Trust gates:**
- Any: all wiki commands (init, add, query, status, compact, rebuild-index).

## Quality Gates

- Every topic file must have a title, last-updated date, and sources list
- Every topic file must have at least one cross-link to another topic (unless it is the only topic)
- The index must accurately reflect all topic files (no orphans after --add or --compact)
- No duplicate topic files (same slug = same file)
- Raw sources are preserved in wiki/raw/ and never deleted
- The --query command must cite specific topic files, not fabricate information

## Exit Protocol

Output a summary appropriate to the command executed, then:

```
---HANDOFF---
- Wiki: {command executed} at {wiki path}
- Topics: {count} total, {new/updated/merged count} changed
- Status: {healthy | needs compaction | has orphans/broken links}
---
```
