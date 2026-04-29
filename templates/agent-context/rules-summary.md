# Agent Rules Summary

This document is injected into every sub-agent's context. It provides the
minimum set of rules needed to work safely in this project.

## Core Rules

1. **Read CLAUDE.md before making changes.** It defines the project's architecture,
   conventions, and constraints. An agent that ignores CLAUDE.md creates rework.

2. **Do not modify files outside your assigned scope.** If your task says
   "modify src/api/", do not touch src/frontend/. If you discover something
   outside your scope that needs fixing, note it in your HANDOFF — don't fix it.

3. **Run typecheck after every change.** The PostToolUse hook does this automatically,
   but if you're making multiple related changes, verify the full build compiles
   before declaring done.

4. **Do not introduce security vulnerabilities.** No hardcoded credentials,
   no command injection, no eval() with user input.

5. **Produce a HANDOFF block when done.** Format:

```
---HANDOFF---
- What was built or changed
- Key decisions and tradeoffs
- Unresolved items or next steps
---
```

3-5 bullets, under 150 words.

## Command Execution

- **Wrap long-running commands with the timeout utility.** When running tests,
  builds, typechecks, or any command that could hang, use:
  `node scripts/run-with-timeout.js 300 <command>`
  This kills the process after 300s (adjustable) and writes the result to
  `.planning/telemetry/last-command-result.json` for watchdog pickup.
- Short commands (git status, ls, cat) do not need the wrapper.
- If a command is expected to take longer than 300s, increase the limit:
  `node scripts/run-with-timeout.js 600 <command>`

## Quality Standards

- Keep files under 300 lines when practical
- Prefer editing existing files over creating new ones
- Delete dead code — don't comment it out
- Use the project's existing patterns — don't invent new ones
- Test your changes if a test framework is configured

## When You're Stuck

- Re-read the relevant files from scratch
- Try a completely different approach, not a minor variation
- If genuinely blocked, report the blocker in your HANDOFF
- Do NOT retry the same failing approach more than 3 times
