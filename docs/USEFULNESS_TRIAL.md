# Usefulness Trial

Citadel's first-use trial answers one practical question:

> Can a real user ask for useful work, understand what Citadel will do next,
> verify it, and resume from inspectable evidence?

Run it from a Citadel clone. To evaluate Citadel itself:

```bash
node scripts/usefulness-trial.js --write --run-verification
```

To evaluate another project, point the trial at that project:

```bash
node scripts/usefulness-trial.js --project-root ../my-project --write --run-verification
```

Use `--task` to test a different plain-English request:

```bash
node scripts/usefulness-trial.js --write --run-verification --task "review README.md for first-time developer friction"
```

The report is written to:

```text
.planning/usefulness-trial/latest.md
```

## Decisions

The trial returns one of four decisions:

| Decision | Meaning |
|---|---|
| `ready-for-dogfood` | Setup, next action, routing, verification, and durable evidence are all present. |
| `setup-needed` | Citadel can guide the user to `/do setup --express`, but the project is not initialized yet. |
| `incomplete-evidence` | Citadel can operate, but the run is missing a proof artifact or verification evidence. |
| `blocked` | A required usefulness criterion failed. Fix the failed criterion before using the project as proof. |

## Criteria

The trial checks five user-facing criteria:

1. The user can get to a working setup path.
2. The user can understand the next action and risk boundary.
3. The user can ask a plain-English task without choosing a skill first.
4. Citadel selects or runs a project-specific verification command.
5. The run leaves inspectable local evidence for another session.

## When To Use It

Use this after landing a stack that changes onboarding, routing, verification,
operator output, reporting, or public proof. It is stricter than a smoke test:
it treats Citadel as an experience a builder has to understand, not only a set
of scripts that pass.

Installer output alone is not enough for `ready-for-dogfood`. A freshly
prepared Codex project may have plugin files, hooks, and readiness artifacts but
still need `/do setup --express` before Citadel has complete operating state.
In that case the trial should return `setup-needed`, not `blocked`.

The expected post-landing flow is:

```text
/do setup --express
/do next
/do review README.md for first-time developer friction
/do identify the project's safest verification command and run it
node path/to/Citadel/scripts/usefulness-trial.js --project-root path/to/project --write --run-verification
```

The generated report is the artifact to inspect before claiming the first-use
experience is actionably useful.
