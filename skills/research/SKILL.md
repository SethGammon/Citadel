---
name: research
description: >-
  Focused research investigations. Converts questions into structured findings
  with confidence levels and source citations. Does not make decisions — produces
  information that informs the next step.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-21
---

# /research — Focused Investigation

## When to Use

- Evaluating whether a dependency has a newer version or has been superseded
- Finding community best practices for a specific technical problem
- Reading official documentation for an API or library
- Investigating how other projects solve a similar problem
- Checking if a pattern used in the codebase has known issues
- Any time you need external information before making a decision

## Protocol

### Step 1: FORMULATE

Convert the research question into 2-4 specific search queries:
- Official docs query (e.g., "express.js middleware error handling docs")
- Community/GitHub query (e.g., "express error middleware best practices site:github.com")
- Technical blog/comparison query (e.g., "express vs fastify error handling 2025")
- Release notes query if version-specific (e.g., "express 5.x changelog breaking changes")

State the question clearly in one sentence before searching.

### Step 2: SEARCH

Execute searches and read actual content (not just snippets):
- Use WebSearch for discovery, WebFetch for reading actual pages
- Evaluate source credibility: official docs > GitHub repos with stars > recent blog posts > forum answers
- Stop at 3-6 credible sources (not exhaustive — focused)
- If a source contradicts another, note the disagreement

### Step 3: EXTRACT

For each finding, record:
- **What**: The specific fact, recommendation, or pattern discovered
- **Source**: URL or reference
- **Relevance**: How this applies to the original question (one sentence)
- **Confidence**: high (official docs, verified), medium (community consensus), low (single source, opinion)
- **Action**: What the codebase should do with this information (or "informational only")

### Step 4: WRITE

Write findings to `.planning/research/{topic-slug}.md`:

````markdown
# Research: {Topic}

> Question: {The original question}
> Date: {ISO date}
> Confidence: {overall: high/medium/low}

## Findings

### 1. {Finding title}
**What:** {description}
**Source:** {URL}
**Confidence:** {high/medium/low}
**Action:** {recommendation or "informational"}

### 2. {Finding title}
...

## Summary
{2-3 sentences: what was learned, what the recommendation is}

## Open Questions
{Anything that couldn't be resolved — needs human judgment or deeper investigation}
````

### Step 5: RETURN

Return the summary and recommendation to the caller (user, Marshal, or Archon).
The research document persists for future reference.

## What /research Does NOT Do

- Make architectural decisions (that's the caller's job)
- Install packages or modify code
- Search exhaustively (2-4 queries, 3-6 sources, done)
- Evaluate subjective opinions as facts
- Recommend without evidence

## Fringe Cases

- **No web access available**: Fall back to local-only research. Search the codebase, read docs files, check `package.json`, and produce findings from local sources. Note the limitation in the research document's confidence level.
- **Search returns nothing relevant**: Broaden the query (remove version-specific terms, try synonyms), try one more angle. If still empty, report uncertainty explicitly: "No strong evidence found. Recommend human review."
- **`.planning/research/` does not exist**: Create it before writing the findings document. Never error on a missing output directory.
- **Conflicting sources**: Surface the conflict explicitly in the findings rather than silently picking one. Both sides belong in the document.
- **Question is too broad for 3-6 sources**: Narrow to the single most important sub-question, answer it well, and note what was scoped out. Suggest `/research-fleet` for multi-angle questions.

## Contextual Gates

**Reversibility:** Green — writes one file to `.planning/research/`; delete to undo.
**Cost:** No cost actions — web searches and one file write; no agents spawned, no confirmation needed.
**Trust:** No gates — read-only investigation, safe at all trust levels.

## Quality Gates

- Every finding must have a source URL
- Confidence levels must be justified (not guessed)
- Summary must answer the original question or state why it can't be answered
- Research document must be written before returning findings

## Exit Protocol

Output findings summary, then:

```
---HANDOFF---
- Research: {topic}
- Findings: {count} sources analyzed
- Recommendation: {one-line summary}
- Document: .planning/research/{slug}.md
- Reversibility: green — one file written to .planning/research/; delete to undo
---
```
