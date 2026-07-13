# External milestone gates

Citadel does not turn fixtures, maintainer runs, stars, clones, or internal simulations into adoption evidence.

`node scripts/milestone-readiness.js --json` reports which long-horizon milestones still await independent evidence. Supply a local JSON file with `--evidence FILE` to evaluate current counts. The command performs no network requests and does not infer missing values.

The six gates cover activation, Pack adoption, ecosystem participation, a real team pilot, Relay demand, and a representative reliability dataset. A missing metric is zero. A gate remains `awaiting_external_evidence` until every declared threshold is met. Relay demand is the one exception: either ten recurring team requests or a qualified waitlist of 200 clears its demand gate.

This command answers whether external proof exists. It does not prevent Citadel from building and testing the local machinery needed to collect that proof.
