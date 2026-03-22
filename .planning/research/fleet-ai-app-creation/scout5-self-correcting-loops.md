# Scout 5: Self-Correcting and Looping Systems

**Research date:** 2026-03-22
**Scope:** Systems that keep going until done — autonomous retry, self-healing, campaign persistence, quality gates

---

## 1. The Core Loop Patterns

### 1a. Action-Observation Loop (SWE-agent, OpenHands)

The foundational pattern. The agent takes an action, observes the result, and decides what to do next. Every modern coding agent uses some variant of this.

**SWE-agent** (Princeton, NeurIPS 2024):
- Agent operates in an observe-act-observe cycle against a real codebase
- Custom Agent-Computer Interface (ACI) gives the model shell, editor, and navigation tools
- Each "turn" produces one action; the environment returns an observation
- No explicit retry logic — the LLM decides whether to try again based on observations
- **Doneness detection:** The agent issues a `submit` command when it believes the patch is correct
- **Infinite loop prevention:** Hard cap on turns (typically 30-50)
- **Max autonomous runtime:** Single-issue scope; typically 5-15 minutes per issue
- **Cascading failure handling:** None explicit — the agent sees error output and reasons about it

**Live-SWE-agent** (2025) extends this with self-evolution: the agent modifies its own scaffold code while solving problems. Achieved 77.4% on SWE-bench Verified. The self-reflection loop is embedded in the problem-solving context itself rather than running as a separate offline pipeline.

**OpenHands / CodeAct** (ICLR 2025):
- Event-stream abstraction: all actions and observations are events in a typed stream
- Agent reads event history and produces the next atomic action
- CodeAct consolidates all agent actions into a unified code action space (Python + bash)
- Delegation via `AgentDelegateAction` — agents can spawn sub-agents for specialized tasks
- **Doneness:** Agent emits a completion event
- **Loop prevention:** Max steps configuration

**Sources:**
- [SWE-agent GitHub](https://github.com/SWE-agent/SWE-agent)
- [SWE-agent paper (arXiv)](https://arxiv.org/abs/2405.15793)
- [Live-SWE-agent paper](https://arxiv.org/html/2511.13646v3)
- [OpenHands CodeAct 2.1 blog](https://openhands.dev/blog/openhands-codeact-21-an-open-state-of-the-art-software-development-agent)

---

### 1b. Generate-Check-Reflect Loop (LangGraph)

A more structured variant where generation and evaluation are explicit, separate nodes in a graph.

**LangGraph self-correcting pattern:**
- **Generate node:** LLM produces code
- **Check node:** Attempts to execute/test the code
- **Reflect node:** If check fails, a separate LLM call analyzes the error
- **Conditional edge:** Routes back to generate (with reflection context) or to output (on success)
- **Doneness:** Check node passes (tests pass, code executes without error)
- **Loop prevention:** `error_count` field in state, conditional edge routes to graceful termination after N failures
- **State management:** LangGraph's `StateGraph` holds all state as a typed dict; LangGraph Platform provides built-in persistence to databases

**Key insight:** The conditional edge is what makes self-correction possible. It's a first-class primitive in the framework, not something bolted on.

**Open SWE** (LangChain, March 2026) builds on this:
- Four-agent architecture: research, plan, code, review — each with own state
- Runs on LangGraph Platform with built-in persistence for long-running tasks (up to 1 hour)
- Every task gets a GitHub tracking issue, updated with status throughout
- Asynchronous execution — fire and forget, comes back with a PR
- **Doneness:** PR opened and linked to tracking issue
- **Persistence:** LangGraph Platform handles state across potential interruptions

**Sources:**
- [LangGraph self-correcting RAG agent tutorial](https://learnopencv.com/langgraph-self-correcting-agent-code-generation/)
- [ActiveWizards deep dive on LangGraph self-correction](https://activewizards.com/blog/a-deep-dive-into-langgraph-for-self-correcting-ai-agents)
- [Open SWE announcement](https://blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent/)
- [Open SWE GitHub](https://github.com/langchain-ai/open-swe)

---

### 1c. The Ralph Loop (Community Pattern, 2025-2026)

A viral pattern for Claude Code and similar CLI agents. Named after Ralph Wiggum — "I'm in danger" but keeps going.

**Core mechanism:**
1. Define machine-verifiable completion criteria (tests pass, typecheck clean, etc.)
2. Feed the agent a prompt with the project context and task
3. Agent works until it thinks it's done
4. External verification runs (not self-assessment)
5. If verification fails, re-feed the agent with error output and context
6. Repeat until verification passes or max iterations hit

**Key properties:**
- **Doneness detection:** External verification, not self-assessment. This is the critical insight — agents are bad at knowing when they're done, but test suites are good at it.
- **Trigger for next iteration:** Verification failure output becomes input for next cycle
- **Infinite loop prevention:** Max iterations (default ~20), time limits, idle detection (no new commit in N iterations)
- **Persistence across sessions:** Git commit history serves as implicit persistence — each iteration's changes are committed, so the next iteration can inspect diffs
- **Max autonomous runtime:** Hours (L3-L4 autonomy level — "AFK coding")
- **Cascading failures:** Not explicitly handled; relies on test suite to catch regressions

**Implementations:**
- [snarktank/ralph](https://github.com/snarktank/ralph) — original implementation
- [vercel-labs/ralph-loop-agent](https://github.com/vercel-labs/ralph-loop-agent) — Vercel's AI SDK version
- [frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code) — Claude Code specific with exit detection
- [mikeyobrien/ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator) — improved orchestration

**ASDLC integration:** The Ralph Loop operates as a "lane" in the Autonomous Software Development Lifecycle, running at L3-L4 autonomy alongside a traditional human lane at L1-L2. Both converge at adversarial review.

**Sources:**
- [Ralph Loop pattern (ASDLC.io)](https://asdlc.io/patterns/ralph-loop/)
- [Ralph Wiggum Loop (Agent Factory docs)](https://agentfactory.panaversity.org/docs/General-Agents-Foundations/general-agents/ralph-wiggum-loop)
- [DEV Community: Running AI agents for hours](https://dev.to/sivarampg/the-ralph-wiggum-approach-running-ai-coding-agents-for-hours-not-minutes-57c1)
- [ralph-wiggum.ai](https://ralph-wiggum.ai/)

---

### 1d. Google ADK LoopAgent (2025)

Google's framework-level primitive for iterative agent execution.

**Architecture:**
- `LoopAgent` is a workflow agent that runs sub-agents in sequence, repeatedly
- Sub-agents share state through a common context object
- Typical pattern: `[Generator, Critic, DecisionMaker]` as sub-agents in the loop

**Termination mechanisms:**
- `max_iterations` — hard cap on loop count
- Early exit via `escalate=True` in `EventActions` — any sub-agent can signal "quality threshold met"
- Custom event or flag in shared context checked by a decision-maker sub-agent
- Return value inspection

**Key design choice:** The loop is deterministic infrastructure wrapping probabilistic agents. The framework guarantees the loop structure; the LLM agents handle the creative work within each iteration.

**Sources:**
- [ADK LoopAgent docs](https://google.github.io/adk-docs/agents/workflow-agents/loop-agents/)
- [Google Developers Blog: Multi-agent patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/)
- [Noble Ackerson: Build agents that self-correct (Medium)](https://medium.com/google-developer-experts/build-ai-agents-that-self-correct-until-its-right-adk-loopagent-f620bf351462)

---

## 2. Extended Autonomous Runtime Systems

### 2a. Devin (Cognition Labs)

The first agent marketed as capable of "thousands of steps" autonomously.

**Self-correction architecture:**
- Multi-agent internal architecture: `command_line_agent`, `error_handling_agent`, `code_editor_agent`
- Error handling agent reads output + memory to diagnose failures
- Code editor agent applies suggested fixes
- Iterative refinement loop between these internal agents
- Later versions added self-assessed confidence evaluation — asks for human help when not confident

**Doneness:** Task completion as defined by the user prompt. Self-assessed.
**Max runtime:** Extended (hours), but specific limits not publicly documented.
**Cascading failures:** The error handling agent has access to memory, allowing it to see past fix attempts.
**Persistence:** Full persistent environment (VM with shell, editor, browser).

**Sources:**
- [Devin AI Wikipedia](https://en.wikipedia.org/wiki/Devin_AI)
- [Devin Agents 101](https://devin.ai/agents101)
- [Deep dive into Devin 2.0 (Medium)](https://medium.com/@takafumi.endo/agent-native-development-a-deep-dive-into-devin-2-0s-technical-design-3451587d23c0)

---

### 2b. Replit Agent 3 (2025)

**Self-healing loop:**
- Generates code, executes it, identifies errors, applies fixes, reruns
- "App Testing" feature: agent autonomously navigates the app it built in a live browser
- Finds broken UI, broken functionality, and fixes without prompting
- 10x more autonomous than Agent 2

**Key numbers:**
- **Max autonomous runtime:** 200 minutes continuous
- **Performance:** 3x faster, 1/10 cost vs earlier computer-use models
- **Doneness:** App works in browser testing + passes defined criteria

**Sources:**
- [Replit Agent 3 announcement](https://blog.replit.com/introducing-agent-3-our-most-autonomous-agent-yet)
- [Replit Agent 3 review (leaveit2ai)](https://leaveit2ai.com/ai-tools/code-development/replit-agent-v3)

---

### 2c. Cursor Long-Running Agents (February 2026)

**The most extreme autonomous runtime to date:**
- Runs autonomously for 25-52+ hours producing PRs
- 151,000+ lines of code in single runs
- Event-triggered via "Automations" (March 2026): agents self-trigger on events

**Self-correction:**
- Agents run tests before alerting humans (self-verification)
- Selective notification — only high-risk findings escalate
- Memory-based learning — agents improve from past runs
- Transparent logging to Notion/Linear for audit trails

**Doneness:** PR created and tests pass. Human review at the end.
**Persistence:** Full cloud execution environment that persists across hours/days.

**Sources:**
- [TechCrunch: Cursor Automations](https://techcrunch.com/2026/03/05/cursor-is-rolling-out-a-new-system-for-agentic-coding/)
- [Cursor: Scaling Agents](https://cursor.com/blog/scaling-agents)
- [Cursor long-running agents explained](https://www.adwaitx.com/cursor-long-running-agents-autonomous-coding/)

---

## 3. Quality Gates and Self-Healing Patterns

### 3a. Hook-Based Quality Enforcement (Claude Code)

Claude Code hooks (released 2025-2026) provide lifecycle interception points for automated quality enforcement.

**Hook types and their role in self-correction:**

| Hook Event | Self-Correction Role |
|---|---|
| `PostToolUse` | Run typecheck/lint after every edit — immediate feedback |
| `PostToolUseFailure` | Track consecutive failures, suggest different approaches (circuit breaker) |
| `Stop` | Scan for anti-patterns before finalizing; inject fix instructions |
| `SessionStart` | Load context, pull in bug reports, restore state |

**The Citadel harness** (this repo) implements a sophisticated version:
- `post-edit.js`: Per-file typecheck on every Edit/Write operation, plus performance lint and dependency pattern detection
- `circuit-breaker.js`: Tracks consecutive tool failures. After 3 failures, suggests a different approach. After 5 trips, escalates to "stop and fundamentally rethink."
- `quality-gate.js`: Stop hook that scans changed files for anti-patterns (confirm/alert, transition-all, magic intervals). Injects fix instructions if violations found.

**Key design insight from Citadel:** The quality gate has a loop-prevention check — `if (ctx.stop_hook_active) process.exit(0)` — preventing the stop hook from triggering itself recursively.

**Sources:**
- [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [eesel.ai Claude Code hooks guide](https://www.eesel.ai/blog/hooks-in-claude-code)
- [Pixelmojo: All 12 hook events](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns)

---

### 3b. GUARDRAILS.md Pattern

A file-based safety protocol that persists learned constraints across context resets.

**Structure:**
- Each "Sign" is a discrete safety constraint with: trigger condition, instruction, reasoning, provenance
- Acts as the agent's externalized memory for failure modes
- Prevents the same mistake from recurring across sessions

**Key insight:** AI agents fail stochastically, not deterministically. Without externalized state, they repeat failures indefinitely. GUARDRAILS.md is the agent's "conscience" that persists across context windows.

**Sources:**
- [guardrails.md specification](https://guardrails.md/)

---

### 3c. FAILURE.md Pattern

A companion to GUARDRAILS.md specifically for documenting and learning from failure modes.

**Sources:**
- [failure.md specification](https://failure.md/)

---

## 4. Campaign Persistence and Multi-Session Systems

### 4a. File-Based Campaign State (Citadel Archon)

The Archon skill in this repo implements a complete multi-session campaign system.

**How it detects "not done yet":**
- Campaign file has phases with status (pending/complete/partial/failed)
- On wake-up, reads campaign file and checks Active Context section
- Continuation State written before context runs low

**What triggers the next iteration:**
- Manual re-invocation (`/archon` with no args resumes active campaign)
- Campaign file acts as the "program counter" — the agent reads it and knows where it left off

**Infinite loop prevention:**
- Circuit breaker: 3+ consecutive failures on same approach = park
- Direction alignment check every 2 phases catches scope drift
- Quality spot-check every phase catches quality degradation
- Regression guard: 5+ new typecheck errors = park campaign
- "Never re-delegate the same failing work without changing the approach"

**Session persistence:**
- Campaign file in `.planning/campaigns/{slug}.md`
- Active Context section updated after every phase
- Continuation State with: current phase/sub-step, files modified, blocking issues, next actions
- Scope claims in `.planning/coordination/claims/` prevent conflicts with other agents

**Cascading failure handling:**
- Regression guard compares error count to baseline
- Escalation ladder: 1-2 errors = fix, 3-4 = warn + attempt, 5+ = park
- Anti-pattern scan after every build phase

### 4b. Fleet Parallel Persistence (Citadel Fleet)

Extends campaign persistence to parallel execution.

**Additional patterns:**
- Session file at `.planning/fleet/session-{slug}.md` tracks all waves and agents
- Discovery relay: compressed findings from each wave injected into next wave's context
- Dead instance recovery: checks for orphaned claims from crashed agents
- Scope overlap detection prevents two agents from editing the same files
- Instance IDs for traceability: `fleet-{session-slug}-{wave}-{agent-index}`

### 4c. Framework-Level Persistence (LangGraph Platform, Strands Agents)

**LangGraph Platform:**
- Built-in persistence for long-running agents
- SessionManager saves complete history to S3 or similar
- State checkpointing enables resume after interruption
- Production deployments at Uber, JP Morgan, LinkedIn, Klarna

**AWS Strands Agents 1.0** (2025):
- Production-ready multi-agent orchestration
- Session state management as a first-class primitive

**Microsoft Agent Framework:**
- Thread-based state management
- Agent memory with chat history persistence
- Session restore from storage backends

**Sources:**
- [AgentMemo state management guide](https://agentmemo.ai/blog/agent-state-management-guide.html)
- [Microsoft Agent Framework sessions](https://learn.microsoft.com/en-us/agent-framework/user-guide/agents/agent-memory)
- [OpenAI Agents SDK sessions](https://openai.github.io/openai-agents-python/sessions/)
- [AWS Strands Agents](https://aws.amazon.com/blogs/opensource/introducing-strands-agents-1-0-production-ready-multi-agent-orchestration-made-simple/)

---

## 5. Infinite Loop Prevention Strategies (Across All Systems)

| Strategy | Used By | Mechanism |
|---|---|---|
| Max iterations | ADK LoopAgent, Ralph, SWE-agent | Hard cap (20-50 typical) |
| Time limit | Replit (200min), Cursor (52hr) | Kill after elapsed time |
| Idle detection | Ralph variants | No new commit in N iterations = stop |
| Error count escalation | LangGraph, Citadel Archon | Counter increments on failure, routes to termination after N |
| Circuit breaker | Citadel harness | 3 consecutive failures = suggest new approach, 5 trips = hard stop |
| Fingerprint dedup | Various | Track tool-call + result hash; 3 repeats = loop detected |
| Confidence threshold | Devin 2.0 | Agent asks for human help when confidence drops |
| Scope drift detection | Citadel Archon | Direction alignment check every 2 phases |
| Cost budget | Production deployments | Token/dollar limit per task |

---

## 6. Cascading Failure Handling (Cross-System Analysis)

The "fix one thing, break another" problem is the hardest unsolved challenge.

**Current approaches:**

1. **Test suite as regression oracle** (Ralph, Cursor, Replit): Run full test suite after each change. If new tests fail, the fix introduced a regression. Problem: only catches what tests cover.

2. **Typecheck baseline comparison** (Citadel Archon): Record error count at campaign start. Compare after each phase. Escalation ladder based on delta. Problem: only catches type-level regressions.

3. **Layered defense** (OWASP ASI08 pattern): Architectural isolation + runtime verification + observability + kill switches. Problem: heavy infrastructure, designed for production services not development agents.

4. **Memory-based avoidance** (Devin, GUARDRAILS.md): Record past failures so the agent doesn't repeat them. Problem: doesn't prevent novel cascading failures.

5. **Scope isolation** (Citadel Fleet): Prevent multiple agents from touching the same files. Problem: doesn't help within a single agent's scope.

**What nobody does well:** Detecting that a fix to file A caused a behavioral regression in file B when there are no tests covering that interaction. This requires understanding the dependency graph at a semantic level, not just a file level.

---

## 7. Comparative Summary

| System | Loop Type | Max Runtime | Persistence | Quality Gates | Cascading Prevention |
|---|---|---|---|---|---|
| SWE-agent | Action-observe | ~15 min | None (single issue) | Submit = done | None |
| OpenHands | Event-stream | Configurable | None built-in | Agent-decided | None |
| LangGraph | Generate-check-reflect | Hours (Platform) | LGP checkpoints | Conditional edges | Error count |
| ADK LoopAgent | Sub-agent cycle | Configurable | Shared context | Escalate signal | Max iterations |
| Ralph Loop | External verify | Hours | Git commits | Test suite | Test suite |
| Devin | Multi-agent internal | Hours | Full VM | Self-assessed confidence | Memory |
| Replit Agent 3 | Browser test loop | 200 min | Full environment | Live browser testing | App testing |
| Cursor Agents | Event-driven | 52+ hours | Cloud environment | Self-verification | Test + notify |
| Open SWE | Four-agent pipeline | ~1 hour | LGP persistence | Multi-agent review | Agent review step |
| Citadel Archon | Campaign phases | Multi-session | File-based campaigns | Typecheck + anti-pattern + direction | Regression guard + escalation |
| Citadel Fleet | Parallel waves | Multi-session | Session files + claims | All of Archon + scope isolation | Scope isolation + merge review |

---

## 8. The 80% Problem (Addy Osmani)

Worth calling out separately: Addy Osmani's observation that "agents can rapidly generate 80% of the code, but the remaining 20% requires deep knowledge of context, architecture, and trade-offs." The engineers thriving in 2026 aren't just using better tools — they've reconceptualized their role from implementer to orchestrator.

This frames the self-correcting loop problem: the loop handles the 80% well. The question is whether the loop can also handle the 20%, or whether that always requires human judgment at review boundaries.

**Sources:**
- [Addy Osmani: Self-Improving Coding Agents](https://addyosmani.com/blog/self-improving-agents/)
- [Addy Osmani: The 80% Problem](https://addyo.substack.com/p/the-80-problem-in-agentic-coding)

---

## 9. Gap Analysis: What Hasn't Been Built Yet

### Gap 1: Semantic Regression Detection
No system detects behavioral regressions that aren't covered by tests. If fixing auth breaks the payment flow and there's no test for that interaction, every system misses it. Needed: dependency-graph-aware impact analysis that flags "this change to module A could affect modules B and C" before the fix is applied, not after.

### Gap 2: Adaptive Loop Strategy
All current systems use fixed loop strategies (retry N times, then stop). No system adapts its strategy based on the type of failure. A syntax error should retry immediately; an architectural mismatch should escalate to planning. Needed: failure classification that routes to different recovery strategies (quick-fix vs. re-plan vs. human escalation).

### Gap 3: Cross-Session Learning
GUARDRAILS.md and FAILURE.md are manual. No system automatically extracts "what went wrong and why" from a failed session and encodes it as a constraint for future sessions. Citadel's campaign system preserves state but doesn't learn from failures across campaigns. Needed: automated failure-pattern extraction that generates new quality rules from observed failures.

### Gap 4: Partial Success Recovery
When an agent completes 7 of 10 tasks and fails on 3, most systems either park everything or keep retrying. No system gracefully commits the 7 successes, isolates the 3 failures, and presents a focused retry scope. Needed: granular success tracking with selective rollback and retry.

### Gap 5: Multi-Agent Conflict Resolution
Fleet-style parallel systems detect scope overlap at the file level, but two agents can create semantic conflicts without touching the same files (e.g., one changes an API contract, another depends on it). Needed: interface-level conflict detection, not just file-level.

### Gap 6: Confidence-Calibrated Escalation
Devin 2.0 has self-assessed confidence, but it's binary (confident enough / not confident enough). No system has a graduated confidence model where different confidence levels trigger different behaviors: high = proceed, medium = run extra verification, low = ask human, very low = refuse to act. Needed: multi-tier confidence routing.

### Gap 7: Loop-Aware Context Management
As loops iterate, context windows fill with failed attempts. No system intelligently summarizes/compresses previous iteration context to maximize useful signal in the context window. The Ralph Loop uses git commits as implicit compression, but that loses the reasoning about why something failed. Needed: iteration-aware context compression that preserves causal reasoning while discarding redundant code diffs.

### Gap 8: Real-Time Collaboration Between Loops
Multiple agents can run in parallel (Fleet, Cursor), but they don't communicate during execution — only between waves. If Agent A discovers something mid-execution that would save Agent B from a dead end, there's no mechanism to share it in real time. Needed: live discovery broadcast between concurrent agents.
