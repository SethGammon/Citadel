---
name: research-fleet
description: >-
  Parallel research using Fleet wave mechanics. Spawns multiple scout agents,
  each investigating a different angle of the same question. Findings are
  compressed between waves. Produces a unified research brief from multiple
  independent perspectives.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-21
---

# /research-fleet — Parallel Multi-Scout Research

## When to Use Over /research

- Evaluating multiple competing technologies or approaches
- Researching a topic with distinct sub-questions that don't depend on each other
- Time-sensitive research where parallel execution matters
- Any research question that naturally decomposes into 3+ independent angles

If the question is narrow and focused, use /research instead. Don't parallelize
what a single agent can answer in 5 minutes.

## Inputs

The user provides:
1. **question**: The research topic or question
2. **angles** (optional): Specific sub-questions to investigate. If not provided,
   the skill decomposes the question into 3-5 angles automatically.

## Protocol

### Step 1: DECOMPOSE

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

### Step 2: DEPLOY WAVE 1

Spawn one scout agent per angle using Fleet wave mechanics:

For each scout:
1. Create an isolated worktree
2. Inject the scout's specific angle as the research question
3. Each scout follows the /research protocol (formulate, search, extract, write)
4. Each scout writes its findings to `.planning/research/fleet-{slug}/{angle-slug}.md`

All scouts run in parallel. Wait for all to complete.

### Step 3: COMPRESS

After Wave 1 completes:

1. Read all scout findings
2. Identify:
   - **Consensus**: findings that multiple scouts independently confirmed
   - **Conflicts**: findings that contradict each other (flag these prominently)
   - **Gaps**: angles that didn't produce strong results (consider a Wave 2)
   - **Surprises**: unexpected findings that change the framing of the question
3. Compress into a unified brief (~500 tokens)

### Step 4: WAVE 2 (Optional)

If gaps or conflicts exist:

1. Spawn targeted scouts to resolve specific conflicts or fill gaps
2. Each Wave 2 scout receives the compressed brief from Wave 1 as context
3. Wave 2 scouts don't re-research what Wave 1 already covered

Skip Wave 2 if Wave 1 produced clear, consistent findings.

### Step 5: REPORT

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

## Safety Rules

- Maximum 5 scouts per wave (don't burn tokens on diminishing angles)
- Maximum 2 waves (if Wave 2 doesn't resolve it, the question needs human judgment)
- Each scout follows /research quality gates (sources, confidence, evidence)
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

## Fringe Cases

- **No web access available**: Run all scouts in local-only mode. Each scout searches the codebase, reads docs, and produces findings from local sources. Note the limitation in the final REPORT's confidence level.
- **Search returns nothing relevant for a scout angle**: The scout should broaden its query, try one alternative angle, and if still empty, report "No strong evidence found for this angle" rather than fabricating findings. The gap becomes an Open Question in the final report.
- **`.planning/research/` does not exist**: Create it (including the `fleet-{slug}/` subdirectory) before any scout writes its findings. Never error on a missing output directory.
- **A scout times out**: Treat its angle as a gap. Record it in the final report's Open Questions section. Do not block the rest of the wave.
- **Question decomposes into fewer than 3 independent angles**: Fall back to `/research` (single agent) rather than forcing artificial parallelism.

## Quality Gates

- Every scout must produce a findings document
- Conflicts must be explicitly flagged, not silently resolved
- The compressed brief must be written before spawning Wave 2
- The final report must answer the original question or state why it can't

## Contextual Gates

**Disclosure:** Writes report to `.planning/research/fleet-{slug}/REPORT.md`. No source files modified.
**Reversibility:** green — creates report files only; delete the directory to undo.
**Trust gates:** Any — no restrictions.

## Exit Protocol

```
---HANDOFF---
- Research Fleet: {topic}
- Scouts: {N} across {waves} wave(s)
- Consensus: {one-line summary of agreed findings}
- Conflicts: {any unresolved disagreements}
- Recommendation: {one-line}
- Report: .planning/research/fleet-{slug}/REPORT.md
- Reversibility: green — delete `.planning/research/fleet-{slug}/` to undo
---
```
