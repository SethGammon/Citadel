# Scout 4: Decomposition and Planning Approaches

How existing systems break down "build me an app" into actionable steps.

---

## 1. Academic / Research Frameworks

### Plan-and-Solve Prompting (2023)
- **How it decomposes**: Two-phase — first devise a plan to divide the task into subtasks, then execute subtasks according to the plan. Addresses missing-step errors in zero-shot Chain-of-Thought.
- **Validates plan?** No explicit validation gate; the plan is generated and immediately executed.
- **Handles ambiguity?** Relies on the LLM's reasoning to fill gaps during plan generation.
- **Granularity**: Step-level (individual reasoning steps, not file-level).
- **Adapts?** No — plan is static once generated.
- **Source**: [arxiv.org/abs/2305.04091](https://arxiv.org/abs/2305.04091)

### Decomposed Prompting (DecomP)
- **How it decomposes**: Modular approach — breaks complex tasks into sub-tasks, delegates each to specialized LLM prompts or handlers best suited to solve them.
- **Validates plan?** Each sub-handler returns results that feed the next; implicit validation through composition.
- **Granularity**: Sub-task level; each sub-task maps to a distinct prompt/handler.
- **Adapts?** Sub-tasks are predefined by the decomposer; no runtime adaptation.
- **Source**: [openreview.net](https://openreview.net/forum?id=_nGgzQjzaRy)

### ADaPT — As-Needed Decomposition and Planning (2023)
- **How it decomposes**: Recursive. The executor LLM tries the task directly. If it fails (self-assessed), a separate planner LLM decomposes it further. This recurses until atomic skills suffice.
- **Validates plan?** Yes — the executor self-assesses success/failure after each attempt. Failure triggers further decomposition.
- **Handles ambiguity?** By attempting execution first and only decomposing when stuck — naturally adapts to both task complexity and model capability.
- **Granularity**: Dynamic — starts coarse and refines to atomic skills only as needed.
- **Adapts?** Core design principle. Improves GPT-3.5 performance by 28-33% over static approaches.
- **Source**: [arxiv.org/abs/2311.05772](https://arxiv.org/abs/2311.05772)

### TDAG — Task Decomposition with Agent Generation (2025)
- **How it decomposes**: Dynamically breaks complex tasks into subtasks and generates a specialized sub-agent for each subtask.
- **Validates plan?** Each sub-agent is purpose-built and tested against the subtask.
- **Adapts?** Yes — agent generation is dynamic, adapting to diverse real-world scenarios.

### Massively Decomposed Agentic Processes (MDAPs)
- **How it decomposes**: Extreme parallelism — tasks decompose into many parallel subtasks, each handled by independent agents.
- **Granularity**: Very fine-grained; aims for maximum parallelism.
- **Key insight**: Autonomous Manager Agents decompose goals into task graphs, allocate to workers, monitor progress, adjust to conditions.

**Takeaway from research**: The trend is moving from static plan-then-execute toward recursive/adaptive decomposition where the plan evolves based on execution feedback.

---

## 2. Product-Level AI Coding Tools

### Cursor Agent Mode
- **How it decomposes**: Agent begins in "plan mode" — uses semantic search and grep to explore the codebase, identifies relevant files, then generates a detailed Markdown implementation plan.
- **Validates plan?** Yes — the plan opens as an editable Markdown file. User reviews and approves before execution begins. Acts as a "contract between human and agent."
- **Handles ambiguity?** Through codebase exploration (indexing, semantic search) before planning. Can launch 3 parallel agents implementing different strategies and compare outcomes.
- **Granularity**: File-level with function signatures — specifies "file names, function signatures, and logic."
- **Adapts?** Plan is static once approved, but agent can deviate during execution. Debug mode added for runtime issues.
- **Architect pattern**: Use a powerful model (Claude Opus) for planning, then hand the plan to a faster/cheaper model (Sonnet, GPT-5.2) for execution. Developer becomes architect-reviewer.
- **Sources**: [cursor.com/product](https://cursor.com/product), [subramanya.ai](https://subramanya.ai/2026/01/04/a-year-with-cursor-how-my-workflow-evolved-from-agent-to-architect/)

### Windsurf Cascade
- **How it decomposes**: Dual-agent architecture — a specialized planning agent continuously refines the long-term plan in the background while the selected model takes short-term actions based on that plan.
- **Validates plan?** Creates a visible Todo list within the conversation to track progress. No separate approval gate.
- **Handles ambiguity?** "Flow" paradigm — indexes the project automatically, builds "Codemaps" (visual representations of code architecture), uses M-Query retrieval to pull relevant context. Memories system persists context across conversations.
- **Granularity**: Action-level (read files, write files, run commands). The planning agent thinks in terms of goals, the executor thinks in terms of tool calls.
- **Adapts?** Yes — the background planning agent continuously refines the plan as new information emerges during execution.
- **Source**: [docs.windsurf.com](https://docs.windsurf.com/windsurf/cascade/cascade)

### Claude Code
- **How it decomposes**: Plan Mode separates research from execution. Claude analyzes the codebase with read-only operations, creates a plan, then executes only after user approval.
- **Validates plan?** User explicitly approves the plan before execution begins.
- **Handles ambiguity?** Through codebase exploration, file reading, and grep during plan mode.
- **Granularity**: Task-level with dependency chains — uses `addBlockedBy` to create task graphs. Git worktrees for parallel task execution.
- **Adapts?** "Planning with Files" pattern maintains `task_plan.md`, `findings.md`, `progress.md` as living documents that persist across context windows and sessions.
- **Source**: [code.claude.com/docs](https://code.claude.com/docs/en/common-workflows)

### OpenAI Codex — ExecPlans
- **How it decomposes**: Top-down into milestones (narrative scope with acceptance criteria) and progress items (granular checkboxes with timestamps). Each milestone must be "independently verifiable and incrementally implement the overall goal."
- **Validates plan?** Multiple mechanisms: observable outcomes (e.g., "navigating to localhost:8080/health returns HTTP 200"), continuous test verification at each stopping point, evidence capture (terminal output, diffs, logs).
- **Handles ambiguity?** Plan must be "fully self-contained" with all knowledge needed for a novice to succeed. When ambiguities arise, the plan "resolves it autonomously" rather than deferring to user.
- **Granularity**: Very specific — exact commands, working directories, expected transcripts, observable outputs.
- **Adapts?** Yes — ExecPlans are "living documents" with Decision Log, Surprises & Discoveries, and Progress sections updated continuously. Prototyping milestones validate feasibility before full implementation.
- **Depth-first strategy**: Break larger goals into smaller building blocks (design, code, review, test), build those blocks, use them to unlock more complex tasks.
- **Source**: [developers.openai.com/cookbook/articles/codex_exec_plans](https://developers.openai.com/cookbook/articles/codex_exec_plans)

### Devin (Cognition)
- **How it decomposes**: Proactively researches the codebase, then develops a detailed plan showing relevant files, findings, and preliminary steps. Uses reinforcement learning + LLM combination.
- **Validates plan?** Yes — presents plan to user for modification before autonomous execution. "Users can modify the plan to ensure Devin's understanding is aligned."
- **Handles ambiguity?** Through proactive codebase research and user plan review.
- **Granularity**: Engineering-task level — plans and executes "thousands of decisions" for complex tasks.
- **Adapts?** Has full environment (shell, editor, browser) for runtime adaptation. Can debug and iterate autonomously.
- **Source**: [cognition.ai/blog/devin-2](https://cognition.ai/blog/devin-2)

### Replit Agent
- **How it decomposes**: Three explicit modes — Plan mode (brainstorm and plan without code changes), Build mode (create and iterate), Edit mode (targeted modifications).
- **Validates plan?** Yes — Plan mode creates an ordered task list. User reviews and approves before Agent starts building.
- **Handles ambiguity?** Natural language input with no technical knowledge required. Agent determines tech stack automatically (e.g., React + Express + PostgreSQL + Stripe).
- **Granularity**: Full-stack project level — generates project structure, installs deps, creates DB schema, sets up auth, builds frontend, deploys.
- **Adapts?** Agent "checks its work and fixes problems" during execution.
- **Source**: [docs.replit.com/replitai/agent](https://docs.replit.com/replitai/agent)

### Bolt.new (StackBlitz)
- **How it decomposes**: Single meticulously crafted system prompt to Claude 3.5 Sonnet. Does NOT orchestrate multiple LLM calls — the entire app springs from one prompt.
- **Validates plan?** No explicit plan review. Generation is near-instant with WebContainers preview.
- **Handles ambiguity?** The system prompt encodes strong defaults. Recommended workflow: scaffold basics first, then add features iteratively.
- **Granularity**: Whole-app generation in one shot, then iterative refinement.
- **Adapts?** Through conversation — user refines by describing changes, each turn generates new code.
- **Key difference**: No planning phase at all. Speed over planning. Relies on the LLM's single-pass capability.
- **Source**: [newsletter.posthog.com/p/from-0-to-40m-arr-inside-the-tech](https://newsletter.posthog.com/p/from-0-to-40m-arr-inside-the-tech)

### Lovable.dev
- **How it decomposes**: Three modes — Agent Mode (autonomous), Chat Mode (collaborative planning), Visual Edits (direct manipulation).
- **Validates plan?** Plan mode between build blocks. Recommendation: "break work into smaller, testable chunks rather than implementing 5 things at once, using Plan mode between each block to validate."
- **Architecture decisions**: Fixed stack (React + Tailwind + Supabase). No architecture decision-making — opinionated defaults.
- **Adapts?** Agent Mode includes proactive debugging.
- **Source**: [lovable.dev/blog/how-to-develop-an-app-with-ai](https://lovable.dev/blog/how-to-develop-an-app-with-ai)

### V0 (Vercel)
- **How it decomposes**: Prompt-to-component refinement loop. Does not plan a full app — generates individual UI components.
- **Granularity**: Component-level only. Frontend/UI layer.
- **Adapts?** Through iterative prompt refinement and variation selection.
- **Source**: [lovable.dev/guides/lovable-vs-v0](https://lovable.dev/guides/lovable-vs-v0)

---

## 3. Multi-Agent Frameworks (Open Source)

### MetaGPT / MGX
- **How it decomposes**: Simulates a software company with role-based agents — Product Manager, Architect, Project Manager, Engineer, QA Engineer. Assembly-line paradigm with SOPs.
- **Workflow**: User request -> ProductManager (requirements analysis + feasibility) -> Architect (system blueprint) -> ProjectManager (task list from design) -> Engineers (file-level implementation) -> QA (testing).
- **Validates plan?** Each role's structured output serves as input to the next role, creating implicit validation at each handoff.
- **Handles ambiguity?** Product Manager performs feasibility analysis. Structured communication minimizes ambiguities.
- **Granularity**: Down to individual classes and functions — "specific classes and functions are assigned as tasks to individual Engineer agents."
- **Adapts?** SOPs guide each role; MGX adds scalability through parallel subtasks, traceability through logged decisions, adaptability through plug-and-play skills.
- **Source**: [arxiv.org/html/2308.00352v6](https://arxiv.org/html/2308.00352v6)

### ChatDev (2024)
- **How it decomposes**: Assigns different roles to multiple agents across the software development lifecycle.
- **Granularity**: Role-based phases (design, coding, testing, deployment).
- **Source**: Referenced in MGX survey literature.

### Deep Agents (LangChain/LangGraph)
- **How it decomposes**: Four pillars — externalized planning, hierarchical task decomposition, delegation to sub-agents, virtual workspace for state management.
- **Externalized planning**: Plan written to observable environment (not just in-context). `write_todos` tool creates and tracks discrete steps.
- **Hierarchical delegation**: Spawns specialized sub-agents for context isolation. Main agent stays clean while sub-agents go deep.
- **Virtual workspace**: File-system backend prevents context overflow. Pluggable backends (in-memory, local disk, LangGraph store, sandboxes).
- **Adapts?** Plans evolve as new information emerges during execution.
- **Source**: [github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)

### GitHub Spec Kit
- **How it decomposes**: Four gated phases — Specify (goals + user journeys) -> Plan (architecture, stack, constraints) -> Tasks (small, reviewable units) -> Implement.
- **Validates plan?** Explicit checkpoints between each phase. Spec is the "single source of truth."
- **Handles ambiguity?** Spec captures the stable "what," plan and tasks drive the flexible "how."
- **Granularity**: Tasks are "small, reviewable chunks that each solve a specific piece of the puzzle."
- **Adapts?** Three scenarios supported: greenfield, feature work in existing systems, legacy modernization.
- **Open source**: MIT-licensed, 28K+ GitHub stars. Works with Copilot, Claude Code, Gemini CLI.
- **Source**: [github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)

### MAAD (2025)
- **How it decomposes**: Knowledge-driven multi-agent system for automated architecture design. Four role-dedicated agents collaborate to decompose Software Requirements Specifications into architectural artifacts.
- **Granularity**: Architecture-level (not code-level).

---

## 4. PRD Generation Tools

Several tools convert natural language to structured PRDs:

| Tool | Approach | Output |
|------|----------|--------|
| **ChatPRD** | Transforms rough ideas/meeting notes into comprehensive PRDs | Objectives, user stories, technical specs, GTM briefs |
| **Figma AI PRD** | NLP analysis of product inputs | Structured PRD with goals, features, audience |
| **WriteMyPRD** | ChatGPT-powered | Standard PRD format |
| **Miro AI PRD** | Template-driven generation | Collaborative PRD documents |

These are prompt-to-document tools, not planning systems. They generate a static artifact that a human (or agent) then acts on. None of them connect to execution.

---

## 5. Synthesis: What Works Best

### Decomposition Spectrum

```
Single-shot generation          Spec-driven phased planning
(Bolt.new)                      (GitHub Spec Kit, OpenAI ExecPlans)
    |                                        |
    v                                        v
Fast, simple apps               Complex, maintainable systems
No plan review                  Multiple validation gates
Fixed stack                     Architecture decisions explicit
Iterative refinement            Upfront design
```

### Key Patterns That Emerge

**1. Plan-Review-Execute is the dominant pattern.**
Nearly every serious tool (Cursor, Claude Code, Devin, Replit, Codex) now has an explicit planning phase where the user can review and modify the plan before execution begins. The tools that skip this (Bolt, V0) are positioned for speed/prototyping, not production work.

**2. Adaptive > Static plans.**
The best-performing approaches (ADaPT, Windsurf's background planner, Codex ExecPlans as living documents) allow the plan to evolve during execution. Static plan-then-execute breaks down on complex tasks where discoveries change the approach.

**3. Externalized plans outperform in-context plans.**
Deep Agents, Codex ExecPlans, and Claude Code's "Planning with Files" all write the plan to a persistent artifact (markdown file, filesystem) rather than keeping it only in the context window. This survives context limits and enables cross-session continuity.

**4. Role-based decomposition adds structure but overhead.**
MetaGPT's software company simulation (PM -> Architect -> PM -> Engineer -> QA) produces more structured outputs but adds latency and cost. For solo-developer tools, a single agent with plan/execute modes is more practical.

**5. Granularity sweet spot: milestone + file-level.**
- Too coarse (whole-app): Bolt's single-shot works for simple apps but fails on complex ones.
- Too fine (line-level): Wastes planning tokens and over-constrains the executor.
- Sweet spot: Milestones with acceptance criteria, broken into file-level tasks with function signatures (Cursor, Codex pattern).

**6. Fixed stack removes a decision point.**
Lovable (React + Tailwind + Supabase), Bolt (WebContainers + Vite), and Replit all make opinionated stack choices. This eliminates architecture paralysis and lets the LLM focus on business logic. Tools that support arbitrary stacks (Cursor, Claude Code, Codex) need more planning upfront.

**7. Validation mechanisms matter enormously.**
Codex's approach of requiring "observable outcomes" (HTTP 200 at a URL, test passes) for each milestone is the most rigorous. Cursor's editable markdown plan is the most human-friendly. The best system would combine both: human-reviewable plan with machine-verifiable acceptance criteria.

### Recommendations for a New System

Based on this research, an effective decomposition pipeline would:

1. **Specify** — Generate a structured spec from natural language (PRD-like, but focused on what the user actually needs, not boilerplate). Ask clarifying questions for ambiguous requirements.
2. **Decide Architecture** — Choose stack and structure based on project requirements. Use opinionated defaults with escape hatches. Make decisions explicit and reviewable.
3. **Plan** — Break into milestones with acceptance criteria. Each milestone specifies files to create/modify, key function signatures, and observable verification steps. Write the plan to a persistent file.
4. **Validate** — Human reviews plan. Machine checks for completeness (are all spec requirements covered?). Prototype milestone validates feasibility of risky decisions.
5. **Execute** — Work milestone by milestone. Each milestone verified before moving to the next. Plan adapts based on discoveries (Decision Log pattern from Codex).
6. **Retrospect** — Capture what worked and what didn't for future planning improvement.

The critical insight: **the plan is not a prompt, it's a contract**. It should be readable by humans, executable by agents, and verifiable by tests.
