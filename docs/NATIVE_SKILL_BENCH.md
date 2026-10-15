# Candidate skill and native hook release check

`scripts/skill-bench-native.js` checks the four experiment planning scenarios
against a local Codex app-server. It supplements the existing benchmark runner;
it does not prove optimizer utility, actual source preservation, or hosted release
acceptance. Use an existing authenticated native Codex executable.

Commit the candidate first, then prepare one disposable fixture:

```text
node scripts/skill-bench-native.js --prepare
node scripts/skill-bench-native.js --preflight --project <prepared-project> --codex-bin <codex.exe> --out <new-evidence-directory>
```

Preparation uses the existing compatibility generator, governed bundle command,
and native hook installer. It records the candidate revision and exact skill and
hook hashes. The fixture remains available for ordinary native runtime review
and approval. If preflight reports untrusted hooks, review them through Codex's
native hook interface in this exact project, then rerun preflight. This tool
does not persist trust, bypass trust, change user configuration, or count installed
plugin hooks as candidate hooks. Preflight consumes no model turn.

Run one scenario per invocation after preflight succeeds:

```text
node scripts/skill-bench-native.js --project <prepared-project> --codex-bin <codex.exe> --scenario no-metric --out <new-evidence-directory>
```

The other exact scenario names are `dirty-workspace`, `evaluator-tampering`, and
`with-metric`. Each invocation requests Astra/ultra with default service tier,
retains runtime configuration and permissions, and declines command approval
requests rather than silently expanding permissions. Served tier is not inferred.
The runtime receives an explicit candidate skill input and the exact pinned skill
contents as controlled input. The native completed user-message echo must match
that text exactly. All model tool/action items are forbidden, including actions
observed before completion but omitted from the terminal item list. This proves
controlled delivery rather than spontaneous skill selection. The installed
`citadel@citadel-local` plugin is excluded only for this invocation, and discovery
must confirm its hooks are absent, so this explicit fallback does not double-run
the installed version. These are response scenarios, not mutation experiments.

A pass requires the exact completed native thread/turn, candidate-content echo,
all scenario assertions, paired successful candidate `userPromptSubmit` and
`stop` hook events for the same thread, no incomplete/error candidate hook pairs,
and increased timing telemetry without new hook errors. Turn IDs are checked
when supplied by the native protocol. Raw requests, native events, responses,
discovery, candidate hashes and result are retained in a new directory. Existing
directories are never reused. Candidate source and fixture identities are checked
again after execution. Shutdown has its own deadline; forced or uncertain cleanup
cannot pass. Static or preflight success cannot substitute for these
four actual runs. Preserve failures alongside later results.

This is a source development/release utility. The slim distribution intentionally
does not include the benchmark runner or this companion.
