---
name: with-metric
skill: experiment
description: experiment produces iterations and measurement plan for a bundle-size reduction goal
tags: [happy-path]
behavior: invariant
input: /experiment reduce bundle size, baseline 450kb
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

A user provides a concrete optimization goal with a baseline metric. The skill must
generate at least one experiment iteration with a measurement plan and hypothesis.

## Expected Behavior

1. Acknowledges the baseline: 450kb bundle size
2. Proposes at least one iteration (e.g., code-split a heavy dependency, lazy-load a route)
3. Includes a way to measure the result (bundle analyzer, build output)
4. Structures output as experiment iterations, not a free-form essay
5. No crash or raw error output
