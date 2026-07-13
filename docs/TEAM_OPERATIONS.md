# Team operations

Citadel team operation remains local first. Organization and repository policies narrow runtime access, required capabilities, approval actions, parallelism, budget, source upload, and telemetry. Child policies can make a parent stricter, but they cannot broaden a parent allowance.

Policy evaluation accepts an exact request schema with typed runtime, capability, action, limit,
source-upload, and approval fields. Missing, additional, or incorrectly typed fields fail closed.
Telemetry inheritance keeps the more restrictive mode, so a child cannot widen `off` or `local`
into export.

`node scripts/team-pilot.js simulate` exercises the five-operator, ten-repository reporting shape. Its output is always labeled `simulation` and does not count as team adoption. A real pilot supplies privacy-safe events with `report --input events.json` and remains subject to the external milestone gate.

The report measures discovery loss, reassignment latency, merge conflict rate, campaign resumes, and approval delivery. It contains opaque operator and repository identifiers, not names, paths, prompts, source, or credentials.
