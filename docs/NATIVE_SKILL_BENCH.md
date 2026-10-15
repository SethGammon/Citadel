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
The runtime receives an explicit candidate skill input; a successful command must
also expose its complete current contents. Only one read is authorized before
the planning response. These are response scenarios, not mutation experiments.

A pass requires a completed native turn, candidate skill-content read evidence,
all scenario assertions, paired successful candidate `userPromptSubmit` and
`stop` hook events for the same thread, no incomplete/error candidate hook pairs,
and increased timing telemetry without new hook errors. Turn IDs are checked
when supplied by the native protocol. Raw requests, native events, responses,
discovery, candidate hashes and result are retained in a new directory. Existing
directories are never reused. Candidate source and fixture identities are checked
again after execution. Static or preflight success cannot substitute for these
four actual runs. Preserve failures alongside later results.

This is a source development/release utility. The slim distribution intentionally
does not include the benchmark runner or this companion.
