# Golden path verification

Citadel's golden-path tooling has two deliberately separate proof layers:

1. **Fixture automation** checks deterministic product seams without a model or hosted service.
2. **Stranger trials** measure whether a new person can reach value with real Claude or Codex sessions.

Fixture results are useful engineering evidence. They are not substitutes for the three-OS,
real-runtime, first-time-user evidence required for the Citadel 1.1 product milestone.

## Deterministic fixture journey

Run the same prepared project through one runtime surface:

```sh
node scripts/golden-path.js --runtime claude --fixture scripts/fixtures/golden-path/minimal-node.json --json
node scripts/golden-path.js --runtime codex --fixture scripts/fixtures/golden-path/minimal-node.json --json
```

The runner uses an isolated temporary copy and exercises real local Citadel seams:

1. runtime-specific project preparation without marketplace or plugin registration;
2. session-start project bootstrap and generated guidance;
3. deterministic route selection for the fixture task;
4. the fixture repository's real verification command;
5. operator-console and usefulness-trial durable evidence;
6. a handoff containing the required `HANDOFF` block;
7. a fresh process resolving the active campaign to `/archon continue`;
8. removal of the temporary workspace and comparison with the pristine fixture digest.

Every result is labeled `fixture-automation`. Its elapsed times measure local automation only;
they are not human install-to-value timings and must not be presented as such.

Use `--output <result.json>` to retain a result outside the temporary workspace. `--keep-temp`
is for debugging and intentionally changes rollback status from exact to retained.

## Failure contract

Failures contain one closed machine-readable code and one exact recovery action. The contract
includes invalid fixture, install, setup, route, verification, handoff, resume, rollback, and
unexpected-error cases. There is no generic "try again" state.

## Local repetitions and cross-OS aggregation

Run five repetitions for both runtime preparation paths on the current operating system:

```sh
node scripts/golden-path-matrix.js --fixture scripts/fixtures/golden-path/minimal-node.json --runtime both --repeat 5 --output .planning/product-proof/golden-path-matrix-windows.json
```

The command records only the platform that actually ran. It cannot manufacture Linux or macOS
evidence from Windows. Merge independently produced platform reports and require the complete
2 runtimes × 3 operating systems × 5 repetitions grid:

```sh
node scripts/golden-path-matrix.js --merge .planning/product-proof/golden-path-matrix-windows.json,.planning/product-proof/golden-path-matrix-linux.json,.planning/product-proof/golden-path-matrix-macos.json --output .planning/product-proof/golden-path-matrix-complete.json --require-complete
```

The complete-grid gate requires more than 95% successful fixture journeys, exact rollback for
every retained result, median fixture install-to-route below ten minutes, and p90 fixture
install-to-handoff below fifteen minutes. Those thresholds catch product regressions; the final
milestone still requires separate stranger timings.

## What remains human evidence

Fixture automation cannot prove:

- real marketplace registration or host plugin enablement;
- the interactive `/do setup --express` interview;
- LLM task quality or autonomous Archon progress;
- a person's comprehension of the next action;
- first-time-user timing or fourteen-day return behavior.

Those claims require the documented trial cohort and raw run records. Citadel should show fixture
and human evidence side by side, never blend them into one conversion rate.
