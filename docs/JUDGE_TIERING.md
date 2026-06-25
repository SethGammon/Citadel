# Judge Tiering

> How Citadel tiers the judges in a loop. The verification move of a loop is "the thing that can say
> no." This doc says *which* judge says no to *what* — and why using one model for everything is a
> mistake in both directions.

## The principle

"Judging" is two different jobs, and they want different judges:

| Verification class | Examples | Right judge | Why |
|---|---|---|---|
| **Objective / verifiable** | tests pass, lint clean, exit code, file exists, metric ≥ threshold | **A deterministic command** (no LLM) → else a **small, fast model** | The judge reads a result and compares to a condition; it does not reason. A deterministic check has infinite reliability on what it measures and zero self-praise. |
| **Holistic / subjective** | architecturally sound? subtle bug? does it still cohere with the rest of the system? right, not just green? | **A strong, different-*family*, *acting* judge** (the `arbiter`) | Holistic judgment scales with model capability; a weak model rubber-stamps. This judge re-runs the gates itself rather than trusting prose. |

The mistake to avoid runs in **both** directions:
- Spending a strong model (or any LLM) on an objective check a command could decide — wasteful.
- Spending a weak model on a holistic call it cannot actually make — a rubber stamp that lets bad
  work through.

## The two judges in Citadel

- **`phase-validator`** (small, read-only, e.g. Haiku) — the **mechanical** judge. Reads a HANDOFF and
  checks whether it credibly claims the exit conditions were met. Its verdict is **advisory and
  retryable**: the orchestrator may accept a `partial` over its `fail`. Right-sized for prose checks;
  wrong tier for "is this actually good?".
- **`arbiter`** (strong, different-family, *acting*) — the **holistic** judge. Re-runs the objective
  gates itself (typecheck/tests/lint/the phase's command conditions), reads the real diff, and judges
  architecture / subtle correctness / coherence. Its `verdict: "block"` is **binding** — the
  orchestrator may not accept around it. Invoked: after a worker's retries are exhausted; as the
  completion judge for a holistic run-until condition; and as a coherence critic after a deterministic
  gate passes.

## Why a *different family*, not a weaker model

The point of a second model is **decorrelated blind spots**, not a cheaper bill. The same model — even
with stricter instructions — keeps its blind spots where they were; a different *lineage* has
different ones. So pair a strong judge of the **opposite family** to the generator: if the worker is
gpt-5.x, the arbiter is a strong Claude; if the worker is Claude, the arbiter is a strong gpt-5.x
(e.g. via `codex exec --output-schema`). Decorrelation comes from the lineage; keep the capability
high.

## Why not cheap out on the holistic judge

The arbiter is the **floor of every unattended loop**. A loop is valuable because it runs many times
unattended — but that means a *bad judgment is executed many times*. The judge runs **once per
artifact** and mostly reads a diff plus a result, so a strong model there is a rounding error against
generator spend. It is the single worst place to save tokens. Push everything you can into
deterministic + small-model gates; escalate only the irreducible holistic calls to the strong arbiter.

## Invocation map

| Decision | Judge | Binding? |
|---|---|---|
| Does the HANDOFF claim the exit conditions were met? | `phase-validator` (mechanical) | no (retryable) |
| Did the objective gates actually pass? | a deterministic command, re-run by the `arbiter` | n/a |
| Is the work sound / correct / coherent (binding accept)? | `arbiter` (holistic) | **yes** |
| Holistic run-until completion ("is it right yet?") | `arbiter` | **yes** |
