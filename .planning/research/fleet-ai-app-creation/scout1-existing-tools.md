# Scout 1: Existing "Describe an App, Get an App" Tools

Research date: 2026-03-22

---

## 1. Bolt.new (by StackBlitz)

### What it actually does under the hood

Bolt is built on **WebContainers** -- a Rust/WASM-based Node.js runtime that runs entirely in the browser. StackBlitz spent 7 years building this technology before pivoting to Bolt. The pipeline is:

1. User enters a natural language prompt
2. Prompt is sent to an LLM (Anthropic Claude Sonnet 3.5) with a **single, meticulously crafted system prompt**
3. While waiting for LLM output, the browser boots a WebContainer VM
4. LLM generates code + terminal commands as structured text (using implicit tool calling via XML-like tags like `<boltAction type="file" filePath="...">`)
5. A parser extracts file writes and shell commands from the output
6. WebContainer executes setup (npm install, file creation) and runs the app
7. Live preview renders in-browser

### Task decomposition

Bolt uses **chain-of-thought reasoning tokens** -- the LLM outlines its plan before generating code. However, this is a single LLM call with a very long system prompt, NOT a multi-agent orchestration. There is no separate planning agent or task breakdown step. The system prompt includes escalating priority directives like "ULTRA IMPORTANT: Think first and reply with the artifact."

### Architecture: single-shot generation

- **Single-shot with iterative repair.** One prompt, one LLM call generates the full app. If errors occur, the user can click "attempt fix" which sends a new prompt with error context.
- **No evaluation system** -- there is no automated verification before showing the preview. If imports are invalid or logic is broken, it just shows errors.
- **No memory between sessions** -- each conversation starts fresh.
- **No fine-tuned models** -- relies entirely on prompt engineering.

### Where it breaks

- **Context window collapse at scale**: Projects with 15-20+ components experience severe context loss. The AI forgets patterns, creates duplicates, loses consistency.
- **Authentication is a nightmare**: Supabase auth integration is notoriously unreliable, consuming 3-8M tokens in debugging loops.
- **No verification pipeline**: Invalid imports, broken logic, and framework conflicts persist because there's no automated checking.
- **Token burn**: Users report losing 1.3M tokens in a single day to debugging loops. Success rates drop to ~31% for enterprise-grade features.
- **Deployment failures**: Blank screens, missing files, and partial deployments on larger projects.

### Stack constraints

Multi-framework support: React, Vue, Svelte, Next.js, Remix. Backend limited to Supabase integration. Deploys to Netlify. Everything runs in-browser (WebContainer), so no native system access.

### Pricing

| Plan | Price | Tokens |
|------|-------|--------|
| Free | $0 | 1M/month (300K/day cap) |
| Pro | $25/mo | 10M/month |
| Pro+ | $50/mo | 26M/month |
| Pro Ultra | $100/mo | 52M/month |
| Pro Max | $200/mo | 120M/month |
| Teams | $30/member/mo | Shared workspace |

Paid tokens roll over for one additional month.

---

## 2. v0 by Vercel

### What it actually does under the hood

v0 uses a **composite model architecture** with three distinct layers:

1. **RAG + Context Injection**: Detects intent via embeddings and keyword matching. Injects relevant documentation (AI SDK docs, UI examples, Vercel knowledge) into the prompt. Avoids web search to prevent "bad game of telephone" with summarized results. Hand-curated code examples live in a read-only filesystem for pattern discovery.

2. **Base LLM Generation**: Routes to one of several models:
   - `v0-1.5-md` and `v0-1.5-lg`: Claude Sonnet 4
   - `v0-1.0-md`: Claude Sonnet 3.7

3. **LLM Suspense (streaming manipulation layer)**: While the model streams tokens, v0 performs real-time corrections:
   - Deterministic find-and-replace for known incorrect imports
   - Rewrites non-existent Lucide React icons to closest semantic matches via embedding search
   - Shortens long URLs to reduce token costs (~10s savings per URL)
   - All corrections execute within ~100ms without additional model calls

4. **AutoFix model** (`vercel-autofixer-01`): A custom model trained via reinforcement fine-tuning on Fireworks AI. Runs mid-stream AND post-generation:
   - Parses ASTs to detect structural issues
   - Wraps React Query hooks in required providers
   - Updates package.json dependencies
   - Repairs JSX/TypeScript errors
   - Achieves 86.14% error-free output, runs 10-40x faster than gpt-4o-mini
   - Final linting pass catches remaining style issues

### Task decomposition

v0 does NOT do multi-step task decomposition. It generates UI code in a single pass, enhanced by the composite pipeline. The "intelligence" is in the correction layers, not in planning.

### Architecture: single-shot with layered correction

This is the most sophisticated error-correction pipeline of any tool surveyed. The key insight: instead of trying to make the LLM generate perfect code, v0 wraps it in deterministic and ML-based fixers that catch the ~10% baseline error rate.

### Where it breaks

- **Frontend-only**: No backend generation, no database setup, no auth flows. You get React components, not apps.
- **Opaque token costs**: Even short prompts consume significant tokens due to system-level instructions injected behind the scenes.
- **Credit unpredictability**: Token-based billing swings wildly based on complexity.
- **Stack lock-in**: React + Tailwind + shadcn/ui only. No Vue, Svelte, or Angular.
- **Pricing shock**: Moved from free to strict credit-based pricing, breaking prototyping loops for solo devs.

### Stack constraints

React + TypeScript + Tailwind CSS + shadcn/ui. Next.js for full-page apps. Deploys to Vercel. No backend generation (must pair with other tools for full-stack).

### Pricing

| Plan | Price | Credits |
|------|-------|---------|
| Free | $0 | $5/month in credits |
| Pro | $20/mo | More credits + v0-1.5-lg access |
| Team | $30/user/mo | Pooled credits |

Credits do not roll over. Large models (v0-1.5-lg) cost up to $75/1M tokens.

---

## 3. Lovable (formerly GPT Engineer)

### What it actually does under the hood

Lovable generates full-stack applications with a fixed stack: React + TypeScript + Tailwind CSS + shadcn/ui frontend, Supabase backend (PostgreSQL, Auth, Edge Functions, Realtime). The pipeline:

1. User describes app in chat
2. AI parses intent, generates database schema based on data needs
3. Frontend generated with React/Vite (hot-reloads in browser)
4. Backend auto-provisioned via Supabase: tables, auth flows, Edge Functions, RLS policies
5. GitHub sync for code management
6. One-click deployment via Lovable Cloud

Multiple input modalities: Figma designs (via Builder.io), Excalidraw sketches, website screenshots, or plain text.

### Task decomposition

Lovable has two modes:
- **Chat Mode**: Interactive, multi-step reasoning with user in the loop
- **Agent Mode**: Autonomous -- explores codebases, debugs proactively, searches the web for solutions

The agent mode represents genuine multi-step decomposition: it plans, executes, tests, and iterates. However, details of the internal planner are not publicly documented.

### Architecture: agentic with fixed stack

More autonomous than Bolt or v0, with genuine agent capabilities. Uses RAG for documentation retrieval. The fixed React+Supabase stack is both a strength (deep integration) and limitation (no flexibility).

### Where it breaks

- **Credit waste loops**: AI gets stuck trying to fix bugs, re-introduces old errors while consuming credits. This is the #1 complaint.
- **AI hallucinations**: Incorrectly reports bugs as fixed, leading to false confidence and wasted credits.
- **Enterprise gaps**: No governance guardrails, poor integration with existing enterprise data sources.
- **Scaling ceiling**: Basic hosting. High-traffic apps need migration to AWS/Vercel.
- **Stack lock-in**: React + Supabase only. No Vue, Angular, or alternative backends.

### Stack constraints

React + TypeScript + Tailwind CSS + shadcn/ui + Vite (frontend). Supabase (backend: PostgreSQL, Auth, Edge Functions, Storage, Realtime). GitHub for version control. No framework choice.

### Pricing

| Plan | Price | Credits |
|------|-------|---------|
| Free | $0 | 5/day |
| Starter | $20/mo | Basic credits |
| Launch | $50/mo | More credits |
| Scale | $100/mo | High volume |
| Enterprise | Custom | Custom |

A basic MVP typically consumes 150-300 credits. Five daily free credits disappear fast during iteration.

---

## 4. Replit Agent

### What it actually does under the hood

Replit Agent uses a **multi-agent architecture** built on LangGraph with LangSmith for observability. The key innovation is **scope isolation** -- each sub-agent has minimum necessary tools visible to it.

Architecture:
1. **Manager Agent**: Oversees workflow, delegates tasks
2. **Editor Agents**: Handle specific coding tasks with minimal tool exposure
3. **Verifier Agent**: Checks code AND falls back to asking the user (human-in-the-loop)
4. **Self-testing loop (Agent 3)**: Uses Playwright to test its own output, fixing errors autonomously

### Task decomposition

Replit's approach is the most sophisticated decomposition of the tools surveyed:
- Manager agent breaks task into minimal subtasks
- Each subtask assigned to a scoped editor agent
- **Custom Python DSL for tool invocation**: Instead of standard function calling APIs, the LLM generates restricted Python code that represents tool invocations. This is parsed and validated on the backend. This proved more reliable than standard tool calling.
- XML tags structure prompts to guide model understanding
- Few-shot examples + long task-specific instructions

### Architecture: multi-agent with checkpointing

- Multi-agent with scope isolation
- Automatic git commits at every major step (time-travel rollback)
- Self-testing via Playwright (Agent 3)
- ~90% tool invocation success rate
- ~90% autonomy success rate
- Can work autonomously for up to 200 minutes

### Where it breaks

- **Unpredictable costs**: "Effort-based pricing" means no cost estimates before running a prompt. A single prompt can cost $20 if the agent decides to autonomously redesign your UI.
- **Runaway agent behavior**: Agent changes things without permission, fine-tuned work gets overwritten. Rollback sometimes fails if the agent has broken everything thoroughly.
- **Looping**: Agent mode gets stuck in fix loops.
- **Cost explosion**: Users report spending $1,000/week after Agent 3 launch (up from ~$200/month).
- **No enterprise compliance**: No VPC isolation, no compliance certifications on standard plans.

### Stack constraints

Most flexible -- supports multiple languages and frameworks. Full development environment with shell, package management, and deployment. Built-in databases (PostgreSQL via Neon). Not locked to any specific frontend framework.

### Pricing

| Plan | Price | Details |
|------|-------|---------|
| Starter | Free | Limited Agent trial, 10 dev apps |
| Core | $20/mo | Full Agent, $25 usage credits |
| Pro | $100/mo | Teams (up to 15), tiered credits |
| Enterprise | Custom | SSO, SCIM, privacy controls |

Effort-based pricing: simple edits ~$0.10, complex features $5+. Credits do NOT roll over on Core.

---

## 5. Devin by Cognition

### What it actually does under the hood

Devin is fundamentally different from the other tools -- it's an **autonomous AI software engineer** rather than an app builder. It operates in a cloud-based sandboxed VM with shell, code editor, and browser.

Architecture:
1. User assigns a task via chat (Slack, web UI, or API)
2. Devin plans the approach using long-horizon reasoning
3. Executes in an isolated VM with full dev tools
4. Can browse documentation, read code, write code, run tests, debug
5. Submits PRs to GitHub when done
6. Multi-agent operation: can dispatch subtasks to other Devin instances
7. Self-assessed confidence evaluation: asks for clarification when uncertain
8. Automatic repo indexing every few hours (generates wikis, architecture diagrams)

### Task decomposition

Devin uses genuine long-horizon planning. It can make "thousands of decisions" for complex engineering tasks. Uses reinforcement learning for planning. Can recall relevant context at every step. However, the internal planning mechanism is proprietary and not publicly documented.

### Architecture: fully autonomous agent in sandboxed VM

- Full VM with shell, editor, browser
- MCP (Model Context Protocol) for external tool integration
- Multi-agent parallel execution
- Automatic repo wiki generation
- 67% PR merge rate (up from 34% in prior year)
- 4x faster problem solving vs v1

### Where it breaks

- **Unpredictable failures**: In Answer.AI's test of 20 tasks, 14 failed with no discernible pattern. Tasks similar to previous successes failed unexpectedly.
- **Doesn't know when to stop**: Spent over a day attempting impossible deployments instead of recognizing platform limitations.
- **Slow iteration**: 12-15 minutes between iterations (vs instant feedback in Cursor/Copilot).
- **Code quality**: ~1.5-2x higher defect rate than senior-developer code. Introduces technical debt through verbose solutions.
- **Large codebase degradation**: Failure rates roughly double on large monorepos that exceed context windows.
- **Not for visual work**: Poor at implementing Figma designs or visual polish.
- **Best as junior engineer**: Works on clear, well-scoped tasks. Fails on ambiguous problems.

### Stack constraints

No stack constraints -- works with any language, framework, or toolchain since it operates in a full VM. However, quality varies significantly by ecosystem (best with Python, JavaScript/TypeScript).

### Pricing

| Plan | Price | Details |
|------|-------|---------|
| Core | $20/mo minimum | $2.25/ACU (Agent Compute Unit) |
| Team | $500/mo | 250 ACUs included, $2/additional ACU |
| Enterprise | Custom | API access, security controls |

Previously $500/mo minimum. The Core plan cannot access the API (Team+ only).

---

## 6. Smol Developer (by swyx / smol-ai)

### What it actually does under the hood

Smol Developer is an **open-source**, minimalist code generation tool (~200 lines of Python). It represents the simplest possible architecture:

1. **Planning**: User prompt + model ID sent to GPT-4 (default: gpt-4-0613). LLM generates a high-level architecture description and a `shared_dependencies.md` file.
2. **File specification**: LLM returns an array of filenames needed for the project, using OpenAI's Function Calling API to guarantee valid JSON output.
3. **Code generation**: A for-loop iterates over filenames, sending each one to the LLM with the original requirement, architecture plan, and dependency file as context. Each file is generated independently.

### Task decomposition

Three-phase sequential: plan -> enumerate files -> generate each file (parallelizable). This is the most transparent decomposition of any tool -- you can read the entire pipeline in ~200 lines.

### Architecture: multi-shot with shared context

- Multi-shot (one call per file), NOT single-shot
- Shared context via `shared_dependencies.md` acts as a coordination mechanism between independent file generations
- No verification, no testing, no error correction
- No sandbox or execution environment
- Human-in-the-loop: designed for developer to take over and refine

### Where it breaks

- **Slow feedback loop**: 2-4 minutes to generate a full program even with parallelization
- **Dependency coordination is fragile**: `shared_dependencies.md` sometimes misses hard dependencies between files
- **No execution or verification**: Generated code is never run or tested
- **Stale**: Last significant activity was 2023. The ecosystem has moved far beyond this approach.
- **No iterative refinement**: No built-in way to fix errors or iterate (though a `debugger.py` exists)

### Stack constraints

None -- stack-agnostic since it just generates text files. Quality depends entirely on the LLM's knowledge of the target stack.

### Pricing

Free and open source. You pay for your own LLM API calls (GPT-4 at ~$0.03/1K input tokens when it launched).

---

## 7. Other Notable Tools

### Cursor / Windsurf
IDE-based AI assistants rather than "describe and get an app" tools. They augment existing developer workflows with inline completions, chat, and agentic editing. Not app generators but increasingly capable of building from scratch in agent mode.

### Emergent
Uses multiple specialized AI agents (Builder, Designer, Quality, Deploy) that collaborate to plan, code, test, and launch. Generates React/Next.js and Node/Python codebases. Newer entrant.

### Claude Code (Anthropic)
Terminal-first agent with VS Code extension. Not an app builder per se, but can scaffold entire projects via agentic workflows. Operates on the user's actual filesystem.

---

## Comparison Table

| Dimension | Bolt.new | v0 (Vercel) | Lovable | Replit Agent | Devin | Smol Developer |
|---|---|---|---|---|---|---|
| **Architecture** | Single-shot + iterative repair | Single-shot + layered correction pipeline | Agentic (Chat + Agent modes) | Multi-agent with scope isolation | Fully autonomous agent in VM | Multi-shot with shared context file |
| **Planning step** | Chain-of-thought in prompt | None (correction-focused) | Agent mode has planner | Manager agent decomposes tasks | Long-horizon RL-based planning | Explicit architecture generation step |
| **Verification** | None (user clicks "fix") | AST parsing + AutoFix model (86% error-free) | Agent debugs proactively | Playwright self-testing (90% success) | Runs tests, browses docs | None |
| **Base LLM** | Claude Sonnet 3.5 | Claude Sonnet 4 / 3.7 | Undisclosed (likely Anthropic) | Undisclosed | Custom + GPT-4 class | GPT-4 (configurable) |
| **Execution env** | In-browser WebContainer (WASM) | Vercel cloud preview | Lovable Cloud (Vite) | Full cloud IDE + VM | Isolated cloud VM | None (generates files only) |
| **Frontend stack** | React, Vue, Svelte, Next.js, Remix | React + Tailwind + shadcn/ui only | React + Tailwind + shadcn/ui only | Any | Any | Any |
| **Backend** | Supabase only | None (frontend only) | Supabase only | Built-in (Neon PostgreSQL) | Any | None |
| **Full-stack** | Yes (with Supabase) | No | Yes (with Supabase) | Yes (native) | Yes (any stack) | Partial (no backend infra) |
| **Deployment** | Netlify one-click | Vercel one-click | Lovable Cloud | Replit hosting | Any (submits PRs) | Manual |
| **Free tier** | 1M tokens/mo | $5 credits/mo | 5 credits/day | Limited trial | None | OSS (pay for API) |
| **Paid entry** | $25/mo | $20/mo | $20/mo | $20/mo | $20/mo | Free |
| **Open source** | No (WebContainer is OSS) | No | No | No | No | Yes |
| **Autonomy level** | Low (user-driven) | Low (user-driven) | Medium (agent mode) | High (200min autonomous) | Highest (hours of autonomous work) | Low (one-shot generation) |
| **Best for** | Quick prototypes, multi-framework | UI component generation | Full-stack MVPs (React+Supabase) | Full autonomous app building | Async engineering tasks, PRs | Learning, simple scaffolding |
| **Worst at** | Complex apps, auth, debugging | Backend, full apps | Non-React stacks, enterprise | Cost predictability | Visual work, ambiguous tasks | Anything beyond scaffolding |

## Key Patterns Across All Tools

1. **Single-prompt-to-app is a lie.** Every tool that ships working apps requires iterative conversation. The marketing says "one prompt," reality is 10-50 prompts to get something usable.

2. **The real innovation is in the correction pipeline, not the generation.** v0's composite model (RAG + LLM Suspense + AutoFix) and Replit's multi-agent scope isolation show that wrapping LLMs in guardrails matters more than the base model.

3. **Supabase is the default backend.** Both Bolt and Lovable lock you into Supabase. This creates a monoculture risk and means auth/database quality depends on the LLM's Supabase-specific training data.

4. **Context window is the hard ceiling.** Every tool degrades severely once the project exceeds the LLM's context window (15-20+ components). No tool has solved this.

5. **Verification is the differentiator.** Tools without automated verification (Bolt, Smol) waste enormous user time/credits on debugging. Tools with it (v0's AutoFix, Replit's Playwright testing) have measurably higher success rates.

6. **Cost unpredictability is universal.** Token/credit-based pricing combined with opaque LLM consumption means users cannot predict costs. Replit's "effort-based pricing" is the worst offender.

7. **None handle large/existing codebases well.** All tools are optimized for greenfield. Working with existing code, maintaining conventions, and understanding large architectures remain unsolved.

---

## Sources

- [How bolt.new works - PostHog Newsletter](https://newsletter.posthog.com/p/from-0-to-40m-arr-inside-the-tech)
- [How AI Prototyping Tools Actually Work - Aman Khan](https://amankhan1.substack.com/p/how-ai-prototyping-tools-actually)
- [The Architecture Behind Lovable and Bolt - Beam](https://www.beam.cloud/blog/agentic-apps)
- [Introducing the v0 composite model family - Vercel](https://vercel.com/blog/v0-composite-model-family)
- [How we made v0 an effective coding agent - Vercel](https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent)
- [40X Faster AutoFix - Fireworks x Vercel](https://fireworks.ai/blog/vercel)
- [Replit Agent Case Study - LangChain](https://www.langchain.com/breakoutagents/replit)
- [Replit: Building Reliable Multi-Agent Systems - ZenML](https://www.zenml.io/llmops-database/building-reliable-ai-agents-for-application-development-with-multi-agent-architecture)
- [Replit Agent 3 - InfoQ](https://www.infoq.com/news/2025/09/replit-agent-3/)
- [Replit Effort-Based Pricing](https://blog.replit.com/effort-based-pricing)
- [Devin 2.0 Technical Design - Medium](https://medium.com/@takafumi.endo/agent-native-development-a-deep-dive-into-devin-2-0s-technical-design-3451587d23c0)
- [Devin's 2025 Performance Review - Cognition](https://cognition.ai/blog/devin-annual-performance-review-2025)
- [Thoughts On A Month With Devin - Answer.AI](https://www.answer.ai/posts/2025-01-08-devin.html)
- [Devin AI Review - Trickle](https://trickle.so/blog/devin-ai-review)
- [Devin 2.0 pricing - VentureBeat](https://venturebeat.com/programming-development/devin-2-0-is-here-cognition-slashes-price-of-ai-software-engineer-to-20-per-month-from-500)
- [Smol Developer - GitHub](https://github.com/smol-ai/developer)
- [How Smol AI Developer Works - callmephilip](https://callmephilip.com/posts/how-smol-ai-developer-works/)
- [Bolt Limitations Guide](https://www.p0stman.com/guides/bolt-limitations/)
- [Bolt.new Review - Trickle](https://trickle.so/blog/bolt-new-review)
- [Lovable Honest Review - eesel.ai](https://www.eesel.ai/blog/lovable)
- [Lovable vs Bolt vs v0 - Particula](https://particula.tech/blog/lovable-vs-bolt-vs-v0-ai-app-builders)
- [Replit Review 2026 - Hackceleration](https://hackceleration.com/replit-review/)
- [Devin AI Aftermath - SitePoint](https://www.sitepoint.com/devin-ai-engineers-production-realities/)
