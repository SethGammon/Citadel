---
name: with-metric
skill: experiment
description: experiment produces iterations and measurement plan for a bundle-size reduction goal
tags: [happy-path]
behavior: invariant
input: /experiment plan only for a described repository; do not run commands or create files. Reduce bundle size within src/** using node tools/bundle-size.cjs which prints bytes, lower is better, budget 2 iterations. The reported incumbent is 450kb; explain how to verify the baseline and propose an iteration with a measurement plan.
state: clean
assert-contains:
  - bundle
  - baseline
  - iteration
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
---

## What This Tests

A user provides a concrete optimization goal, metric command, scope and budget.
The skill must propose an experiment iteration with a measurement plan and hypothesis.
The reported number is context; it is not a freshly verified baseline.

## Expected Behavior

1. Acknowledges the reported baseline: 450kb bundle size, to be measured in isolation
2. Proposes at least one iteration (e.g., code-split a heavy dependency, lazy-load a route)
3. Includes a way to measure the result (bundle analyzer, build output)
4. Structures output as experiment iterations, not a free-form essay
5. No crash or raw error output
