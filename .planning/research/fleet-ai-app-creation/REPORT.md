# Research Fleet: Autonomous App Creation from Single Prompt

> Question: How do existing AI systems handle autonomous app creation from a single prompt or minimal input?
> Date: 2026-03-22
> Scouts: 5 across 1 wave
> Confidence: overall: high

## Consensus Findings

These findings were confirmed independently by 2+ scouts:

### 1. "Single prompt to app" is a marketing myth
Every tool that ships working software requires 10-50 iterative prompts. Bolt, Lovable, v0 — all market one-shot generation but deliver conversation-driven iteration. The first 70-80% happens fast; the remaining 20-30% costs more time and tokens than building from scratch. (S1, S3, S4)

### 2. Verification is THE differentiator, not generation quality
v0's composite correction pipeline (86% error-free via AST parsing + AutoFix model), Replit's Playwright self-testing (90% success), and AlphaCodium's flow engineering (19% -> 44% on CodeContests) all prove the same thing: wrapping LLMs in automated verification matters far more than the base model. Tools without verification (Bolt, Smol Developer) burn enormous user time on debugging. (S1, S2, S4)

### 3. Context window is the hard ceiling
Every tool degrades severely at 15-20+ components. No tool has solved large/existing codebase integration. This is the architectural barrier that no amount of prompt engineering can overcome. (S1, S3)

### 4. Naive self-repair loops hit diminishing returns after 1-2 iterations
The ICLR 2024 paper "Is Self-Repair a Silver Bullet?" definitively shows that spending the same compute budget on independent sampling (without repair) often matches or exceeds repair-based approaches. The bottleneck is diagnosis quality, not repair quality. Systems need external signals (test results, type errors, static analysis), not LLM self-assessment. (S2, S5)

### 5. Plan-Review-Execute with externalized persistent plans is the winning pattern
Cursor, Claude Code, Devin, Replit, Codex — all serious tools now have an explicit planning phase with user review. Adaptive plans outperform static ones (ADaPT: +28-33% over static). Plans written to persistent files (not just context window) survive session boundaries. The granularity sweet spot is milestones with acceptance criteria, broken into file-level tasks. (S4, S5)

### 6. The death loop is the #1 failure mode
AI introduces a bug, attempts to fix it, breaks something else, enters an infinite cycle while burning credits. Lovable users report spending 10-20 credits per fix loop. Bolt users burn 3-8M tokens on Supabase auth alone. An entire repair industry has emerged (FixBrokenAIApps.com, VibeCheetah) to fix output from these tools. (S1, S3, S5)

### 7. No system generates complete applications from specifications
All current academic benchmarks (SWE-bench, HumanEval, MBPP, CodeContests) test bug fixing or function-level synthesis. The gap between competitive programming benchmarks (90%+) and real engineering tasks (20-50%) is enormous. Application-level generation has no rigorous benchmark. (S2, S4)

### 8. Security is systematically broken
2.74x more vulnerabilities in AI-generated code vs human-written (Veracode 2025). AI fails to secure against XSS 86% of the time. CVE-2025-48757 exposed 170+ Lovable-built production apps. Enrichlead (Cursor-built) shut down in 72 hours due to client-side-only security. Amazon's Kiro caused 4 Sev-1 incidents including a 13-hour AWS outage. (S1, S3)

### 9. Cost unpredictability is universal
Token/credit-based pricing with opaque consumption means users cannot predict costs. Replit's "effort-based pricing" is worst (users report $1K/week after Agent 3). Devin had a 70% task failure rate at $500/month. The sunk-cost dynamic benefits platforms, not users. (S1, S3)

### 10. Flow/pipeline engineering > prompt engineering
AlphaCodium's 19% -> 44% improvement comes entirely from orchestration, not better prompts. v0's composite model family wraps generation in deterministic fixers. The architecture of the generation flow matters more than the prompt at any individual step. (S1, S2)

## Conflicts

### Simple vs Complex Pipelines
- **S2 finding**: Agentless (simple 3-phase pipeline at $0.70/run) matches or exceeds complex agent architectures for well-scoped bug-fixing tasks.
- **S1/S4 finding**: Tools with sophisticated multi-agent pipelines (Replit's scope-isolated agents, v0's composite correction) have measurably better outcomes for app generation.
- **Resolution**: Simple pipelines win for well-scoped, single-issue tasks. Multi-step app generation requires more sophisticated orchestration. The key variable is task scope, not inherent superiority of either approach.

### Agent Autonomy Level
- **S1/S5**: Higher autonomy systems (Cursor 52-hour agents, Replit 200-minute sessions, Devin) can accomplish more without human intervention.
- **S3**: Higher autonomy directly correlates with higher risk — Replit's database deletion, Amazon's Kiro outage, Cursor's silent code reversions all stem from unchecked autonomy.
- **Resolution**: Autonomy needs graduated gates, not binary on/off. The missing piece is confidence-calibrated escalation.

## Key Findings by Angle

### Scout 1: Existing Tools — What They Actually Do
The landscape splits into three tiers:
1. **Single-shot + repair** (Bolt, v0): One LLM call generates everything. Speed-optimized, prototype-quality.
2. **Agentic with fixed stack** (Lovable, Replit): Multi-step with planning, verification, and self-correction. Better for MVPs.
3. **Fully autonomous** (Devin): VM-based, hours of autonomous operation. Best for well-scoped engineering tasks, not app generation.

The real differentiator is the correction pipeline: v0's AutoFix (86% error-free, 10-40x faster than gpt-4o-mini), Replit's Playwright self-testing, and Devin's multi-agent error handling. Supabase monoculture in Bolt + Lovable creates fragile auth/database generation.

Source: `.planning/research/fleet-ai-app-creation/scout1-existing-tools.md`

### Scout 2: Academic Research — What Science Says
The field is converging on these validated patterns:
- **Test-driven iterative refinement** consistently beats single-shot (AlphaCodium, AgentCoder, MapCoder)
- **Multi-agent separation of concerns** outperforms monolithic agents (MapCoder 93.9% HumanEval, AgentCoder +32.7% over baseline GPT-4)
- **Structured context retrieval** (AST-aware, class-hierarchy-aware) dramatically outperforms flat text search (AutoCodeRover)
- **Multi-candidate generation + filtering** outperforms single-candidate refinement at fixed compute budget (Agentless)

Critical open problem: the feedback/diagnosis step is the bottleneck in all self-repair systems. Better error analysis, not more repair iterations, is the path forward.

Source: `.planning/research/fleet-ai-app-creation/scout2-academic-research.md`

### Scout 3: Community Experience — What Actually Breaks
10 distinct failure patterns documented across Reddit, HN, blogs, and incident reports:

| Pattern | Impact |
|---------|--------|
| Death loop (fix-break cycle) | #1 complaint across all tools |
| 80% wall (demo-to-production gap) | Remaining 20% costs more than building from scratch |
| Security by omission | 2.74x more vulnerabilities, CVEs in production |
| Uncontrolled autonomy | Database deletions, 13-hour outages |
| Credit drain | $1K/week, unpredictable burn |
| Code unmaintainability | 3x technical debt accumulation rate |
| Production-scale failure | Amazon: 6.3M lost orders across 4 Sev-1 incidents |

**Success pattern**: AI builders work when scope is simple, stakes are low, and the alternative is building nothing. Plinq (Lovable, 10K users, $456K ARR) succeeded because the founder had no engineering alternative.

Source: `.planning/research/fleet-ai-app-creation/scout3-community-failures.md`

### Scout 4: Decomposition — How Systems Plan
The decomposition spectrum runs from no planning (Bolt single-shot) to rigorous spec-driven phased planning (GitHub Spec Kit, OpenAI ExecPlans).

**Winning patterns**:
1. Plan-Review-Execute with human approval gate (Cursor, Claude Code, Devin, Replit)
2. Adaptive plans that evolve during execution (Windsurf's background planner, Codex living documents, ADaPT recursive decomposition)
3. Externalized plans written to persistent files, not just context (Deep Agents, Codex ExecPlans, Claude Code)
4. Milestones with observable acceptance criteria (Codex: "navigating to localhost:8080/health returns HTTP 200")
5. Fixed stack removes architecture paralysis (Lovable, Bolt — opinionated defaults work)

**The plan is not a prompt, it's a contract** — readable by humans, executable by agents, verifiable by tests.

Source: `.planning/research/fleet-ai-app-creation/scout4-decomposition.md`

### Scout 5: Self-Correcting Loops — The "Keep Going Until Done" Pattern
Four core loop patterns exist across 11 analyzed systems:

1. **Action-Observe** (SWE-agent, OpenHands): Agent acts, observes result, decides next action
2. **Generate-Check-Reflect** (LangGraph): Explicit generation/evaluation nodes in a graph
3. **External Verify** (Ralph Loop): External machine-verifiable criteria, git as persistence
4. **Sub-Agent Cycle** (ADK LoopAgent): Framework-level loop primitive wrapping probabilistic agents

Autonomous runtime has exploded: from ~15 min (SWE-agent) to 52+ hours (Cursor). The Ralph Loop (external verification + git persistence + iteration caps) is the most relevant pattern for CLI agent contexts.

**Citadel's harness is already state-of-the-art** for campaign persistence and multi-session continuity. Archon's campaign file system, circuit breaker, quality gates, and regression guard are more sophisticated than anything in the public ecosystem. Fleet's parallel coordination with discovery relay goes beyond published alternatives.

Source: `.planning/research/fleet-ai-app-creation/scout5-self-correcting-loops.md`

## What Exists vs What's Missing

### Already Solved (by someone)
- Single-pass UI generation (v0, Bolt)
- Layered correction pipelines (v0 AutoFix)
- Multi-agent scope isolation (Replit)
- Browser-based self-testing (Replit Agent 3)
- External verification loops (Ralph Loop)
- Plan-Review-Execute with living documents (Codex ExecPlans)
- Framework-level loop primitives (ADK LoopAgent, LangGraph)
- Long-running autonomous agents (Cursor 52hr, Replit 200min)

### Nobody Has Solved
1. **Application-level generation from spec** — No benchmark, no rigorous system. All research targets bug fixing or function synthesis.
2. **Semantic regression detection** — No system detects that fixing auth broke payments when there's no test for that interaction. Requires dependency-graph-aware impact analysis.
3. **Cross-session learning** — No system automatically extracts failure patterns into future constraints. GUARDRAILS.md exists but is manual.
4. **Adaptive loop strategy** — All systems use fixed retry logic. No system classifies failure type and routes to different recovery (quick-fix vs re-plan vs human escalation).
5. **Partial success recovery** — When 7/10 tasks succeed and 3 fail, no system gracefully commits the successes and isolates failures for targeted retry.
6. **Confidence-calibrated escalation** — Devin has binary confidence; no system has graduated tiers (high=proceed, medium=extra verification, low=ask human).
7. **Real-time inter-agent communication** — Parallel agents can't share discoveries mid-execution. Only between waves.
8. **Loop-aware context compression** — As iterations accumulate, context windows fill with failed attempts. No system intelligently compresses previous iteration context while preserving causal reasoning.

### Citadel Already Has (That Others Don't)
- **Campaign persistence** with multi-session continuity via file-based state
- **Circuit breaker** with escalation ladder (3 failures = new approach, 5 = hard stop)
- **Regression guard** comparing error counts to baseline
- **Direction alignment** checking scope drift every 2 phases
- **Fleet parallel coordination** with discovery relay between waves
- **Scope isolation** via claims system preventing file-level conflicts
- **Hook-based quality enforcement** (post-edit typecheck, anti-pattern scanning)
- **Quality gate with loop prevention** (stop hook can't trigger itself)

## Recommendation

**Citadel's approach is genuinely novel in three areas:**

1. **Campaign-style persistence** — No other public system has file-based multi-session campaign state with circuit breakers, regression guards, and direction alignment. LangGraph Platform offers framework-level persistence, but Citadel's is more sophisticated for autonomous development campaigns.

2. **Hook-based quality enforcement** — Claude Code hooks are the mechanism, but Citadel's specific implementation (per-edit typecheck + circuit breaker + anti-pattern scanning + loop prevention) is more comprehensive than any documented alternative.

3. **Parallel coordination with discovery sharing** — Fleet's wave mechanics with compressed discovery relay between waves, scope claims, and dead instance recovery goes beyond published multi-agent coordination systems.

**What Citadel should learn from others:**

1. **v0's composite correction pipeline** — Layered deterministic fixers (regex replacement, icon resolution) + trained AutoFix model running mid-stream. This is a powerful pattern for catching the ~10% error rate that LLMs can't avoid.

2. **The Ralph Loop's external verification** — External machine-verifiable criteria as the doneness signal, not agent self-assessment. This could strengthen Archon's completion detection.

3. **Codex ExecPlans' observable outcomes** — Each milestone has a machine-verifiable acceptance criterion ("HTTP 200 at /health"). This bridges the gap between human-readable plans and automated verification.

4. **ADaPT's recursive decomposition** — Decompose only when stuck, not upfront. Try the task first; if it fails, break it down further. This is more efficient than always planning everything upfront.

5. **AlphaCodium's multi-candidate generation** — Generate multiple approaches and filter via testing, rather than iteratively refining one candidate. Diversity of approaches beats depth of refinement.

**The biggest opportunity**: Nobody has built the full pipeline from natural-language spec to verified, deployed application with campaign persistence, quality gating, and self-correction. The pieces exist in isolation across different systems. The integration is the moat.

## Open Questions

1. **Can the diagnosis bottleneck be solved without a specialized model?** v0 trained a custom AutoFix model. Is prompt-based diagnosis sufficient for app-level generation, or does this need a fine-tuned component?

2. **What's the right autonomy level for app creation?** Cursor's 52-hour agents and Amazon's Kiro outage represent opposite ends of the same spectrum. Where should the human review gates be?

3. **Should the plan be generated or templated?** GitHub Spec Kit uses templates for common patterns. Codex generates plans from scratch. For app creation from a single prompt, is there a middle ground (template selection + customization)?

4. **How do you handle the Supabase monoculture problem?** Bolt and Lovable both locked to Supabase because it reduces the decision space. But this creates fragile auth generation. Is an opinionated but broader backend abstraction possible?

5. **What would an app-level benchmark look like?** SWE-bench tests bug fixing. HumanEval tests functions. What would a benchmark for "generate a complete app from this spec" need to measure? (Functionality, security, maintainability, performance, accessibility?)
