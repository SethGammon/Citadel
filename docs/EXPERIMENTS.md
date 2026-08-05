# Citadel proof experiments

This page separates repeatable engineering evidence from promising pilots and
unmeasured product claims. The frozen experiment contract is
`benchmarks/citadel-proof-experiments/experiment-manifest.json`. Only
observed gates support public claims. Missing human, provider, or remote-system
evidence remains unknown or blocked.

## Repeatable local results

| Experiment | Observed result | What it proves | Boundary |
|---|---|---|---|
| Journaled recovery | The naive restart control duplicated 3 non-repeatable effects. Treatment duplicated 0, recovered all 6 safe cases, blocked 4 ambiguous non-repeatable outcomes, detected 2/2 journal tamper cases, and leaked no private error text. | The journal and recovery implementation preserves its declared invariants at every deterministic in-process fault boundary in the fixture. | This is not a process-kill, power-loss, or cross-filesystem result. |
| Safety gates | Across 6 malicious and 6 benign matched cases, treatment had 100% malicious recall, 0% benign false positives, 0 canary effects, and 0 unknown-to-pass conversions. | The tested hooks and governance evaluator discriminate the declared cases and fail closed on missing or malformed evidence. | Dangerous commands were never executed. This is not exploit containment or cross-OS proof. |
| Deploy steward | Across three matched 15-PR batches per arm, both arms landed 45/45 simulated PRs. Independent loops produced 315 stale-head race attempts and 315 interventions; the leased steward produced 0 of each and exactly one deploy per merge. | The real steward state machine and lease seam serialize the deterministic fake-provider workload. | This is not GitHub, Actions, branch-protection, API-race, or real-deployment evidence. |
| Protected GitHub deploy steward | Across three valid matched public runs, both arms merged 45/45 PRs through strict GitHub Actions checks and recorded exactly one successful GitHub Deployment per merge SHA. Controls produced 106 failed merge races, 315 stale updates, and 421 interventions. Stewards produced 0 of each, with 0 repairs. | Under this bounded live workload, the leased steward eliminated the independent controls' racing merge attempts and corrective interventions while preserving complete merges and deployment records in every valid run. | Six disposable repositories under one GitHub account, generated workloads, and GitHub Deployment API records. One invalid run is disclosed and excluded. This is not production deployment, controlled performance, cost, outage-resilience, human-utility, or broad reliability evidence. |
| npm distribution | The installed tarball is more than 5% smaller and ships 66 fewer files than the frozen baseline. Six installed CLI surfaces, 21 control-plane checks, and all 17 offline proof checks pass. | Source-only site media, skill benchmarks, and private workspace adapters need not ship in the runtime tarball. The focused experiment tests stay because the strict suite exercises them. | The files remain hash-accounted in source. One Windows and Node environment was measured; no second release artifact or cross-OS claim was tested. |

The package experiment also rejected a tempting invalid optimization. Editing
`package.json` reduced bytes but broke its frozen public-proof source binding.
Scoped `.npmignore` files achieved the kept result while preserving the signed
`package.json` digest exactly. The excluded source-only inventory is still
accounted for: 101 files and 836,818 bytes remain in source with stable hashes.

## Instruments that are not yet product proof

| Instrument | Observed pilot | Missing promotion evidence |
|---|---|---|
| Acting-arbiter JudgeEval | On one sealed 8-case, same-family trial, exact accuracy was 0.625 for prose-only validation and 1.0 for the acting arbiter; unknown rate fell from 0.50 to 0.125. Both arms had zero false accepts, so the preregistered false-accept improvement failed. | Human-calibrated labels, pinned different-family judges, at least three trials, latency and cost, and a non-saturated false-accept corpus. |
| Fleet isolation ablation | Both arms completed two matched tasks with no conflicts. Serial time was 196,834 ms; isolated parallel time was 154,023 ms, 21.75% lower. | Repeated externally selected suites, independent acceptance, representative task sizes, and token and cost telemetry. |
| Real User Proof v2 | The manifest-bound instrument recorded 0 scored attempts out of 4 assignments, suppressed its share preview, and emitted no utility claim. | Independent repository owners, real counterbalanced attempts, blinded judgments, and elapsed D7 retention. |

## Run deterministic arms and validate the instruments

```bash
node scripts/experiment-contracts.js verify
node scripts/experiment-operation-recovery.js run
node scripts/experiment-operation-recovery.js verify
node scripts/experiment-safety-gates.js run
node scripts/experiment-safety-gates.js verify
node scripts/experiment-deploy-steward.js run
node scripts/experiment-deploy-steward.js verify
node scripts/live-github-steward-ab-proof.js --run-id <stable-id>
node scripts/test-live-github-steward-ab-proof.js
node scripts/experiment-package-bloat.js verify
node scripts/experiment-package-bloat.js metric
node scripts/test-experiment-judge-eval.js
node scripts/test-experiment-fleet-ablation.js
node scripts/test-product-proof-v2.js
npm run grant:verify
node scripts/test-all.js --strict
```

The local runners regenerate detailed deterministic traces under
`.planning/research/`. JudgeEval and Fleet observations require new agent trials;
their focused tests validate the sealed instrument without pretending to replay
the prior agents. Generated traces are intentionally ignored. Git retains the
compact contract, baseline, package result, scripts, fixtures, and tests instead
of accumulating run transcripts.

## Method choices

The program follows four current evaluation practices:

1. Report trials and reliability, not a single best attempt. Both `pass@k` and
   `pass^k` matter for non-deterministic agents, so one-trial pilots stay
   instrument-only. See Anthropic's
   [agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
2. Evaluate the evaluator. Judge labels are sealed from judge prompts, and a
   judge result cannot become a claim until the judge is calibrated. This
   follows the separate JudgeEval pattern in
   [OpenAI PaperBench](https://openai.com/index/paperbench/).
3. Keep outcome and trajectory evidence. Tests establish the artifact outcome;
   journals, receipts, interventions, and unknown states explain how it was
   reached.
4. Match isolation to risk. Worktree isolation prevents cross-arm contamination
   for ordinary coding trials. Host, tool, and network isolation remain explicit
   promotion requirements for adversarial evaluation, consistent with the
   [AISI sandboxing protocol](https://www.aisi.gov.uk/blog/the-inspect-sandboxing-toolkit-scalable-and-secure-ai-agent-evaluations).

Task length is also a study variable, not background noise. Future external
trials should stratify by human completion time instead of extrapolating from
two tiny tasks; [METR's time-horizon work](https://metr.org/time-horizons/)
shows why reliability changes with task duration.

## Next experiments worth funding

1. Run the externally owned, counterbalanced Real User Proof trial. This is the
   shortest path to a defensible product-utility claim.
2. Replicate the protected GitHub deploy experiment under an independent account
   and externally selected repository policy, then test interruption recovery
   without conflating it with the coordination comparison.
3. Expand JudgeEval to at least 40 human-labeled cases, including clean controls
   and enough green-but-wrong failures to measure false-accept improvement.
4. Repeat Fleet across externally selected tasks stratified by human task time,
   with identical model identities, budgets, and complete cost telemetry.
