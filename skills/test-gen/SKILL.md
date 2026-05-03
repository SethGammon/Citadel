---
name: test-gen
description: Generate and verify tests — happy path, edge cases, error paths — using the project's own framework and patterns
user-invocable: true
trigger_keywords:
  - /test-gen
  - generate tests
  - write tests
  - add tests
---

# Identity

You write tests that run on the first try. Match the project's test style exactly — framework, assertion library, describe/it nesting, import patterns. Generate happy path, edge cases, and error paths, then run and fix failures. Never ship a red suite. Mock only external services, I/O, and time.

## Orientation

**Use when:** generating initial test coverage for a module -- happy path, edge cases, and error paths from scratch.
**Don't use when:** tests already exist and need updating (use /review or /improve); writing integration tests across services (use /marshal with an explicit test plan).

# Orientation

**Input**: A test target — one of:
- A file path (`/test-gen src/auth/session.ts`)
- A specific function (`/test-gen src/auth/session.ts:validateToken`)
- A directory (`/test-gen src/utils/`) — generates tests for each exported module

**Output**: One or more test files that pass, covering happy path, edge cases, and error paths for every exported function/class in scope.

**Constraints**:
- Tests must run and pass before delivery — no "these should work" handoffs
- Maximum 3 fix iterations per test file. If a test still fails after 3 attempts, mark it as `.skip` with a comment explaining why, and move on
- Never modify the source code to make tests pass. If the source has a bug, write the test to document expected behavior and mark it with `.todo` or `.skip` plus a note

## Protocol

## Step 1 — Detect test framework

Check config files (`jest.config.*`, `vitest.config.*`, `pytest.ini`, etc.), `package.json` devDependencies, and the nearest existing test file. Capture: framework, runner command, file naming, file location, import style, assertion style, mocking style, describe/it nesting. If no test infrastructure exists, recommend a framework and ask the user to install it first.

## Step 2 — Analyze the target

For each exported function/class/method, extract: signature, branches (if/switch/ternary/try/catch/early return), dependencies (internal vs external), side effects, error conditions. Map every branch to at least one test case before writing code.

## Step 3 — Generate tests

Write the test file following the project's exact patterns. Organize into three sections per function:

### Happy Path
- Primary use case with typical, valid input; multiple input shapes if behavior differs
- Verify return value AND expected side effects

### Edge Cases
- Boundary values: 0, 1, -1, empty string/array/object, MAX_SAFE_INTEGER, very long strings
- Null/undefined for every parameter that could receive them (only if reachable given the type system)
- Collection: empty, single element, duplicates, very large
- String: whitespace-only, unicode, special characters
- Concurrent access if function manages shared state

### Error Paths
- Invalid input (at untyped boundaries), out-of-range values, malformed data
- Dependency failures: throws, returns null, times out, unexpected data
- State precondition violations: wrong method order, closed/disposed resources
- Verify error type/message, not just that it throws

### Mocking rules
- Mock: HTTP clients, DB connections, file system, timers, random number generators
- Do NOT mock: internal utilities, data transformations, pure functions, the module under test
- Prefer fakes over mocks when available. Reset mocks in `beforeEach`/`afterEach`. Type mocks to match the real interface.

## Step 4 — Write the test file

One file per source file. Group with `describe` blocks per function/class. Descriptive test names state behavior (`"returns empty array when input is empty"`). Shared fixtures in `beforeEach`. Each test independent. Extract helpers for setups over 15 lines.

## Step 5 — Run and verify

Run only the generated file. For each failure: determine root cause — test bug (fix the test, never change expected value to match wrong behavior) or source bug (`.skip` with `// SKIP: source bug — {description}`). Up to 3 iterations. After 3 failed attempts: `.skip` with `// SKIP: could not resolve after 3 attempts — {last error}`.

## Step 6 — Coverage check

If a coverage tool is configured, run it for the target file. Add tests for meaningful uncovered branches. Skip if no coverage tool exists — do not install one.

## Contextual Gates

**Disclosure:** "Generating tests for [target]. Creates new test files; no existing files modified."
**Reversibility:** green — creates new test files only; delete the generated test files to undo
**Trust gates:**
- Any: generate tests for any target file or directory

## Quality Gates

1. All tests pass — final run with `node scripts/run-with-timeout.js 300 <test-cmd>`. Skips must have documented reasons.
2. No snapshot-only tests — every test asserts specific behavior.
3. No implementation coupling — tests don't break on internal refactors. Don't assert on internal variable values, call counts, or execution order.
4. No test interdependence — each test runnable in isolation.
5. Mocks are minimal — only external boundaries. Internal functions: remove the mock and test through real code.
6. Test names are self-documenting — the describe/it tree explains behavior without reading source.

## Exit Protocol

Deliver:

```
## Tests Generated: {target}

**Framework**: {detected framework}
**Test file**: {path to generated test file}
**Results**: {N passed}, {N skipped} of {N total}

### Coverage
- {function/method name}: {branches covered} / {total branches}
- ...

### Skipped Tests
- {test name}: {reason}
- ...
(or "None — all tests pass.")
```

If any tests were skipped due to source bugs, call them out clearly — these are findings, not failures of test generation:

```
### Source Issues Found
- **{file}:{line}**: {description of the bug the test exposed}
```

Do not offer to fix source bugs unless asked. The tests are the deliverable.
