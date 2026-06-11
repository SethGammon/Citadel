---
name: research
license: MIT
description: >-
  Focused research investigations. Converts questions into structured findings
  with confidence levels and source citations. Single agent by default; with
  --parallel (or when the question decomposes into 3+ independent angles) it
  spawns scout agents whose findings are compressed into a unified brief.
  Does not make decisions; produces information that informs the next step.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - research
  - investigate
  - look into
  - find out
  - research fleet
  - parallel research
  - multi-angle research
  - compare options
last-updated: 2026-06-11
---

# /research — Focused Investigation

## When to Use

- Evaluating whether a dependency has a newer version or has been superseded
- Finding community best practices for a specific technical problem
- Reading official documentation for an API or library
- Investigating how other projects solve a similar problem
- Checking if a pattern used in the codebase has known issues
- Any time you need external information before making a decision

**Don't use when:** you need to act on findings immediately (use /marshal which calls /research internally).

## Modes

**Single (default):** one agent, 2-4 queries, 3-6 sources. Steps 1-5 below.

**Parallel (`/research --parallel`):** scout agents investigate independent
angles of the same question using Fleet wave mechanics. See Parallel Mode
below. Without the flag, prefer parallel mode (and say so in the plan) when
the question naturally decomposes into 3+ independent angles: evaluating
multiple competing technologies or approaches, distinct sub-questions that
don't depend on each other, or time-sensitive research where parallel
execution matters.

If the question is narrow and focused, stay single-agent. Don't parallelize
what a single agent can answer in 5 minutes.

## Protocol (Single Mode)

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

The WebFetch Restrictions under Parallel Mode apply in single mode too: never
WebFetch rendered GitHub pages.

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

## Parallel Mode (--parallel)

Formerly /research-fleet, which is now a deprecated stub pointing here. Spawns
multiple scout agents, each investigating a different angle of the same
question. Findings are compressed between waves. Produces a unified research
brief from multiple independent perspectives.

**Inputs:** the question, plus optional **angles** (specific sub-questions to
investigate). If not provided, decompose the question into 3-5 angles
automatically.

### Step P1: DECOMPOSE

Break the research question into 3-5 independent angles:

Example: "Should we migrate from Express to Fastify?"
- Scout 1: Performance benchmarks (Express vs Fastify vs Hono, latest data)
- Scout 2: Migration effort (breaking changes, middleware compatibility, ecosystem)
- Scout 3: Community health (GitHub stars trend, npm downloads, maintainer activity)
- Scout 4: Production war stories (who migrated, what broke, was it worth it)

Each angle must be:
- Independent (scout doesn't need another scout's findings to do its work)
- Specific (one clear question per scout)
- Answerable (3-6 sources should be sufficient)

### Step P2: DEPLOY WAVE 1

Spawn one scout agent per angle using Fleet wave mechanics:

For each scout:
1. Create an isolated worktree
2. Inject the scout's specific angle as the research question
3. Each scout follows the single-mode protocol (formulate, search, extract, write)
4. Each scout writes its findings to `.planning/research/fleet-{slug}/{angle-slug}.md`

All scouts run in parallel. Wait for all to complete.

### Step P3: COMPRESS

After Wave 1 completes:

1. Read all scout findings
2. Identify:
   - **Consensus**: findings that multiple scouts independently confirmed
   - **Conflicts**: findings that contradict each other (flag these prominently)
   - **Gaps**: angles that didn't produce strong results (consider a Wave 2)
   - **Surprises**: unexpected findings that change the framing of the question
3. Compress into a unified brief (~500 tokens)

### Step P4: WAVE 2 (Optional)

If gaps or conflicts exist:

1. Spawn targeted scouts to resolve specific conflicts or fill gaps
2. Each Wave 2 scout receives the compressed brief from Wave 1 as context
3. Wave 2 scouts don't re-research what Wave 1 already covered

Skip Wave 2 if Wave 1 produced clear, consistent findings.

### Step P5: REPORT

Write the unified report to `.planning/research/fleet-{slug}/REPORT.md`:

```markdown
# Research Fleet: {Topic}

> Question: {The original question}
> Date: {ISO date}
> Scouts: {N} across {waves} wave(s)
> Confidence: {overall: high/medium/low}

## Consensus Findings
{Findings confirmed by 2+ scouts}

## Conflicts
{Findings where scouts disagreed — present both sides}

## Key Findings by Angle

### {Angle 1}: {title}
{Summary from scout 1}
Source: {scout report path}

### {Angle 2}: {title}
{Summary from scout 2}
Source: {scout report path}

...

## Recommendation
{2-3 sentences: what the evidence says, what the recommendation is}

## Open Questions
{What couldn't be resolved — needs human judgment}
```

Also log to `.planning/telemetry/agent-runs.jsonl`:
```json
{"event":"research-fleet-complete","slug":"{slug}","scouts":0,"waves":0,"timestamp":"ISO"}
```

### Safety Rules (Parallel Mode)

- Maximum 5 scouts per wave (don't burn tokens on diminishing angles)
- Maximum 2 waves (if Wave 2 doesn't resolve it, the question needs human judgment)
- Each scout follows the single-mode quality gates (sources, confidence, evidence)
- Scout findings are independent. No scout reads another scout's output during the same wave.
- **Scout timeout: 15 minutes** (configurable via `harness.json` `agentTimeouts.research`).
  If a scout exceeds its timeout, skip it and proceed with other scouts' results.
  A timed-out scout's angle becomes a "Gap" in the final report.

### WebFetch Restrictions

Every scout prompt MUST include this instruction:

> **Do NOT use WebFetch on GitHub repository pages** (github.com/{user}/{repo}).
> These pages are massive HTML documents (500KB+) that hang the fetcher indefinitely.
> Instead:
> - Use **WebSearch** to find information about repos (search snippets contain what you need)
> - If you need a repo's README content, fetch the **raw** URL:
>   `https://raw.githubusercontent.com/{user}/{repo}/{branch}/README.md`
> - Never fetch rendered GitHub pages: issues, pull requests, repo root, or file views

This restriction exists because a real research-fleet run hung for 38+ minutes
on `WebFetch(https://github.com/jehna/readme-best-practices)` with zero output.
The circuit breaker didn't catch it because the tool didn't *fail* — it just
never completed.

## What /research Does NOT Do

- Make architectural decisions (that's the caller's job)
- Install packages or modify code
- Search exhaustively (2-4 queries, 3-6 sources per agent, done)
- Evaluate subjective opinions as facts
- Recommend without evidence

## Fringe Cases

- **No web access available**: Fall back to local-only research. Search the codebase, read docs files, check `package.json`, and produce findings from local sources. In parallel mode, run all scouts in local-only mode. Note the limitation in the findings document's confidence level.
- **Search returns nothing relevant**: Broaden the query (remove version-specific terms, try synonyms), try one more angle. If still empty, report uncertainty explicitly: "No strong evidence found. Recommend human review." A parallel-mode scout that comes up empty reports "No strong evidence found for this angle" rather than fabricating findings; the gap becomes an Open Question in the final report.
- **`.planning/research/` does not exist**: Create it (in parallel mode, including the `fleet-{slug}/` subdirectory) before writing any findings. Never error on a missing output directory.
- **Conflicting sources**: Surface the conflict explicitly in the findings rather than silently picking one. Both sides belong in the document.
- **Question is too broad for 3-6 sources**: Escalate to parallel mode, or narrow to the single most important sub-question, answer it well, and note what was scoped out.
- **Question decomposes into fewer than 3 independent angles**: Stay in (or fall back to) single mode rather than forcing artificial parallelism, even if --parallel was passed.
- **A scout times out (parallel mode)**: Treat its angle as a gap. Record it in the final report's Open Questions section. Do not block the rest of the wave.

## Contextual Gates

**Reversibility:** Green. Writes files under `.planning/research/` only; delete to undo.
**Cost:** Single mode spawns no agents and needs no confirmation. Parallel mode spawns up to 5 scouts per wave (max 2 waves); state the scout count before deploying.
**Trust:** No gates. Read-only investigation plus report files, safe at all trust levels.

## Quality Gates

- Every finding must have a source URL
- Confidence levels must be justified (not guessed)
- Summary must answer the original question or state why it can't be answered
- Research document must be written before returning findings

Parallel mode additionally:
- Every scout must produce a findings document
- Conflicts must be explicitly flagged, not silently resolved
- The compressed brief must be written before spawning Wave 2

## Exit Protocol

Output findings summary, then the HANDOFF for the mode that ran.

Single mode:

```
---HANDOFF---
- Research: {topic}
- Findings: {count} sources analyzed
- Recommendation: {one-line summary}
- Document: .planning/research/{slug}.md
- Reversibility: green — one file written to .planning/research/; delete to undo
---
```

Parallel mode:

```
---HANDOFF---
- Research (parallel): {topic}
- Scouts: {N} across {waves} wave(s)
- Consensus: {one-line summary of agreed findings}
- Conflicts: {any unresolved disagreements}
- Recommendation: {one-line}
- Report: .planning/research/fleet-{slug}/REPORT.md
- Reversibility: green — delete `.planning/research/fleet-{slug}/` to undo
---
```
