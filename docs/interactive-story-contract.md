# Citadel Interactive Product Story v2

## Experience identity

| Variable | Status | Decision |
|---|---|---|
| Name | Decided | Citadel Interactive Product Story |
| Purpose | Decided | Let a stranger operate a deterministic Citadel journey and inspect why each state changes |
| Current problem | Decided | The existing site explains routing well but does not let visitors experience persistence, evidence, fleet coordination, or delivery proof as one system |
| Mode | Decided | Major refinement of the existing public site |

## User and emotional contract

| Variable | Status | Decision |
|---|---|---|
| Primary user | Decided | A Claude Code or Codex user who has felt context loss, manual workflow choice, weak handoffs, or multi-agent coordination overhead |
| First question | Decided | What does Citadel actually do that the runtime does not already do? |
| Trust question | Decided | Is this real behavior or an animated claim? |
| Emotional contract | Decided | Precise, calm, inspectable, and surprisingly capable |
| Rejected feeling | Rejected | Autonomous-agent spectacle, fake activity, or a cyberpunk dashboard with no evidence |

## Governing metaphor

| Variable | Status | Decision |
|---|---|---|
| Core metaphor | Decided | A protected operating lane through gates, checkpoints, work cells, and receipts |
| Router | Decided | Entry gate that selects the lightest capable lane |
| Campaign | Decided | Durable contract stored inside the repository |
| Fleet | Decided | Parallel work cells with isolated worktrees and a shared discovery relay |
| Verification | Decided | Checkpoint that requires a source before advancing |
| Deploy steward | Decided | Serialized mainline gate |
| Medieval ornament | Rejected | The metaphor changes structure and motion, not the page into fantasy art |

## Story sequence

1. **Choose a scenario.** The visitor selects a typo, review, persistent feature, fleet migration, or deploy lane.
2. **Route the request.** The tier cascade explains each evaluated gate and why it stopped.
3. **Inspect the contract.** The selected workflow exposes the repository files it owns.
4. **Advance work.** Deterministic phase events update tests, evidence, decisions, and next action.
5. **Close the session.** Chat state disappears while repository state remains visible.
6. **Open a fresh session.** `/do next` reads the active contract and restores the next action.
7. **Scale to a fleet.** Three worktrees execute independently and share one discovery.
8. **Challenge the evidence.** Removing a source changes verified state to `unknown`; restoring it permits verification.
9. **Replay the landing lane.** Fifteen PRs serialize through CI and deployment using the retained receipt counts.
10. **Install for the chosen runtime.** Claude Code and Codex tabs provide a specific first-success path.

## Information hierarchy

1. Operating promise
2. Interactive journey
3. Inspectable repository state
4. Fleet and evidence behavior
5. Public proof receipts
6. Installation and first success
7. Deeper documentation

Feature inventory is secondary and must not interrupt the first journey.

## Content model

Every interactive event contains:

```json
{
  "id": "route-tier-2",
  "kind": "route|state|agent|evidence|deploy",
  "label": "Tier 2 keyword match",
  "detail": "review matched /review without model classification",
  "source": "routing-table.json",
  "status": "pass|active|blocked|unknown|pending",
  "at": 1200
}
```

Every proof receipt contains:

- claim
- exact result
- source label
- inspect URL
- truth boundary

## Composition

| Layer | Decision |
|---|---|
| Global shell | Lightweight navigation with product, proof, install, release, and GitHub anchors |
| Hero | One command input, scenario presets, and bounded proof strip |
| Journey stage | Left timeline, central operating surface, right repository inspector on desktop |
| Mobile | One column with state tabs; no horizontal miniature desktop |
| Proof gallery | Receipt grid with one expanded artifact at a time |
| Installation | Runtime tabs followed by setup and first verified command |

## Visual language

- Graphite and stone surfaces from `.planning/design-manifest.md`
- Command cyan for active routing
- Evidence green only for sourced pass states
- Campaign amber for durable phase work
- Fleet violet for parallel coordination
- Unknown gray distinct from pending and failure
- Gate and lane geometry expressed through borders, alignment, and transitions
- No generic AI portraits, robots, floating brains, or decorative particle overload

## Motion system

The canonical motion sequence is:

`request → evaluate → select → execute → verify → persist`

Rules:

- standard durations are 160ms, 280ms, and 480ms
- every sequence can pause, replay, or jump to its final state
- no visitor waits more than 1.2 seconds for the next meaningful state
- no permanent loop except a restrained active indicator
- reduced motion applies the same state changes instantly with opacity only
- scroll never becomes a hidden custom navigation requirement

## Interaction model

- Scenario presets and text entry share the same deterministic state engine.
- Visitors can step forward, autoplay, pause, reset, or inspect the final state.
- Evidence challenge is reversible and never fabricates external telemetry.
- All controls are real buttons with visible focus and plain labels.
- URL hash preserves the selected exhibit for sharing.

## Responsiveness and accessibility

- Complete layouts at 1440px, 1024px, 768px, and 380px
- Keyboard path covers scenario selection, playback, inspector tabs, proof expansion, runtime tabs, and copy buttons
- Status always uses icon or text in addition to color
- `prefers-reduced-motion` retains all information
- Minimum 4.5:1 text contrast and 44px touch targets

## Performance budget

- No framework required unless the deterministic state engine becomes less maintainable in plain JavaScript
- Initial HTML, CSS, and JavaScript under 250KB uncompressed, excluding screenshots
- No autoplay video on first load
- No third-party analytics or remote font dependency
- Interactive state responds within 100ms after input

## Verification matrix

| State | Desktop | Mobile | Keyboard | Reduced motion | Source boundary |
|---|---:|---:|---:|---:|---:|
| Router | required | required | required | required | required |
| Campaign persistence | required | required | required | required | required |
| Fleet relay | required | required | required | required | required |
| Evidence unknown | required | required | required | required | required |
| Deploy replay | required | required | required | required | required |
| Install tabs | required | required | required | not applicable | required |

## Provisional and unknown decisions

| Variable | Status | Next evidence |
|---|---|---|
| Whether to split `docs/index.html` into modules | Provisional | Split if story engine exceeds 350 lines or testing requires DOM imports |
| Real screenshot use inside proof receipts | Provisional | Prefer cropped artifacts if mobile legibility survives |
| Sound | Rejected | Adds little explanatory value and creates accessibility cost |
| Visitor telemetry | Unknown | Remains out of scope until privacy and product-proof contracts define a public-site boundary |

## Build acceptance

The experience is ready only when a first-time visitor can answer these questions without opening the README:

1. What problem does Citadel solve?
2. Why did this request route where it did?
3. What survives after the session closes?
4. How do parallel agents avoid sharing one branch?
5. What happens when evidence is missing?
6. What real proof supports the claims?
7. How do I install it for my runtime and reach one verified success?
