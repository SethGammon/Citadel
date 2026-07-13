# Choosing Citadel

Citadel is an operating layer for Claude Code and OpenAI Codex inside an existing software repository. It is not a framework for building a new agent application.

That distinction decides most comparisons.

## Choose by the job

| If you need to... | Start with... | Why |
|---|---|---|
| Make Claude Code or Codex remember, route, verify, and resume work in a repository | **Citadel** | It adds repo-local campaigns, `/do` routing, lifecycle hooks, evidence, cost telemetry, and isolated worktrees without replacing the coding agent. |
| Enforce a disciplined brainstorm, plan, TDD, review, and delivery method | **Superpowers** | It is a software-development methodology expressed as composable agent skills. It can be used alongside Citadel. |
| Build a custom Python multi-agent application or business automation | **CrewAI** | It provides agents, crews, flows, tools, memory, knowledge, processes, connectors, and deployment surfaces for applications you are creating. |
| Build a custom agent loop with model and tool integrations | **LangChain** | It provides application-level abstractions for models, tools, middleware, and agent loops. |
| Build a durable, stateful agent runtime with explicit graph control | **LangGraph** | It provides low-level orchestration, persistence, streaming, human oversight, and production runtime infrastructure. |
| Build a custom harness on top of LangGraph | **Deep Agents** | It adds planning, filesystems, context management, and subagents as an SDK for agents you are building. |

## Where Citadel is different

Citadel starts after you have chosen Claude Code or Codex.

You keep the runtime and your repository. Citadel adds the operating contract around them:

- one natural-language entry point through `/do`
- project state that survives a context reset or fresh session
- hooks that protect files, verify work, and record evidence
- campaigns and handoffs written into the repository
- coordinated agents working in isolated git worktrees
- local telemetry for cost, routing, and activation

The repository remains the source of truth. There is no hosted control plane required for the core workflow.

## Where other tools are better

Choose CrewAI, LangChain, or LangGraph when you need to ship an agent as part of your own product, define its runtime in application code, connect it to business systems, or operate it as a production service.

Choose Superpowers when your main problem is development discipline and you want an opinionated workflow centered on design, planning, TDD, review, and finishing branches. Citadel and Superpowers are complementary: one supplies operating infrastructure, the other supplies methodology.

Citadel also does not replace code review, sandbox an untrusted host, or prove that an agent's output is correct. It makes the work more persistent, inspectable, and enforceable.

## A practical rule

If you are **building an agent**, begin with a framework or runtime.

If you are **operating a coding agent on a repository**, try Citadel.

## Official sources

- [CrewAI documentation](https://docs.crewai.com/index)
- [LangChain frameworks, runtimes, and harnesses](https://docs.langchain.com/oss/python/concepts/products)
- [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [Superpowers README](https://github.com/obra/superpowers)
- [Citadel security boundaries](../SECURITY.md)

