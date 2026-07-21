# Citadel App Experience Decision Model

> Date: 2026-07-14
> Experience: Citadel App
> Purpose: Make a multi-agent software factory visible, controllable, resumable, and trustworthy from one desktop surface.
> State: approved foundation; visual execution details remain provisional until the first native-shell prototype is verified.

## Experience Identity

- **Decided:** This is a local-first desktop operating environment for agent work, not a prettier dashboard and not a full IDE.
- **Decided:** The governing metaphor is a working citadel containing factories, crews, protocols, gates, memory, live operations, and reports.
- **Decided:** The emotional contract is calm command: density without chaos, power without hidden action, and proof instead of celebratory claims.
- **Rejected:** A chat window as the primary product surface.
- **Rejected:** Two separate Citadel Desktop and Citadel Studio applications.

## Questions Every Surface Must Answer

1. What is running, where, and for whom?
2. What changed, what evidence exists, and what remains unknown?
3. Does the operator need to decide or approve anything?
4. What will happen next, under which policy and budget?
5. Can this run be stopped, recovered, replayed, or handed off safely?

## Information Architecture

- **Decided global destinations:** Command Center, Factories, Agents, Runs, Review, Library, Memory, Settings.
- **Decided factory stations:** Input, Workspace, Crew, Protocol, Gates, Memory, Live View, Report.
- **Decided primary composition:** navigation/roster rail, central factory or run surface, contextual inspector, collapsible activity/transcript/diff console.
- **Provisional:** Factories is the default destination after a workspace is selected; Command Center is the default when active work needs attention.
- **Rejected:** Permanent navigation divided into Free and Pro feature lists.

## Content and Component Model

- **Decided:** Agent Profile, Agent Instance, Team, Factory, Operation, Handoff, Gate, Artifact, Approval, Receipt, Budget, and Workspace are first-class nouns.
- **Decided:** A profile is persistent identity; an instance is one runtime process. The UI must never conflate them.
- **Decided:** A handoff is a typed artifact with sender, recipient, outcome, decisions, blockers, artifacts, verification, and next action.
- **Decided:** Unknown, unreadable, blocked, and failed are visually distinct and never rendered as healthy zeroes.
- **Provisional:** A node canvas remains the strongest factory authoring surface, while run supervision may use a timeline/swarm view instead of editable nodes.

## Visual Direction

- **Decided:** Dark-first, real light mode, restrained glass only for hierarchy, high information density, calm operator copy, and semantic color.
- **Decided:** Motion narrates state transitions and work movement; it never exists as ambient decoration.
- **Decided:** Mono typography is reserved for evidence, paths, commands, revisions, cost, and time; prose and controls use a highly legible sans face.
- **Provisional:** Existing Citadel-Studio spatial tokens and node language are the starting design system.
- **Unknown:** Final icon family, type family licensing, product illustrations, and installer/OS integration assets.

## Interaction and Motion

- **Decided:** Command palette, full keyboard traversal, Escape restoration, attach/detach terminal, explicit destructive confirmations, and reversible navigation.
- **Decided:** Multiple app windows are clients of one supervisor, not separate execution owners.
- **Decided:** The interface may represent unlimited profiles and queued instances; admission and concurrency are resource-governed.
- **Provisional:** Drag-and-drop remains central to factory authoring but every graph mutation must have a keyboard-accessible equivalent.
- **Rejected:** Browser `confirm`, `alert`, and `prompt` for operation control.

## State Variants

- **Required:** first launch, no runtime installed, no workspace, empty roster, idle factory, running fleet, blocked approval, failed gate, disconnected runtime, crash recovery, update available, migration failed, read-only workspace, and corrupted artifact.
- **Required:** Windows scaling at 100, 150, and 200 percent; minimum supported window; ultrawide; reduced motion; high contrast; keyboard only.
- **Unknown:** Mobile control surface. Mobile is not a v1 execution owner and must not distort the desktop information architecture.

## Performance and Quality Bar

- **Decided:** Renderer interaction p95 under 100 ms for ordinary controls and under 250 ms for graph mutations on the 100-agent fixture.
- **Decided:** Live event projection must remain responsive at 1,000 events per minute without unbounded renderer memory growth.
- **Decided:** No operation is declared complete unless its configured evidence and handoff contracts are visible and inspectable.
- **Decided:** Visual acceptance requires real rendered screenshots and interaction capture, not source-token assertions alone.

## Remaining Unknowns That Block Final Visual Form

1. Native title bar versus custom title bar behavior across Windows and macOS.
2. Default split between authoring canvas, run timeline, swarm visualization, terminal, and diff review.
3. How much game-like agent identity survives professional enterprise presentation.
4. Whether Factory, Mission, and Campaign remain separate user-facing concepts or become saved, running, and long-lived states of one Operation noun.
