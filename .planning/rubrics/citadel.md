# Rubric: citadel

> Target: The Citadel product (repo, docs, demo, skills, hooks, UI)
> Created: 2026-03-28
> Version: 1
> Status: approved

## Scoring Protocol

Three independent evaluator agents score every axis. Personas:

- **Evaluator A — Builder**: Senior engineer, 6+ months with Claude Code, hitting scaling walls. Evaluates whether Citadel solves real orchestration problems they've already experienced.
- **Evaluator B — Newcomer**: Developer who heard about Claude Code last week. Evaluates whether Citadel is approachable without prior context.
- **Evaluator C — Decision-maker**: CTO or team lead evaluating whether to adopt this for a team of 5-10 engineers. Evaluates whether Citadel is trustworthy, maintainable, and worth the dependency.

Final score per axis = **minimum** of three evaluators (not median).
A low score from any evaluator represents a genuine unresolved problem. Averaging would hide it.
Disagreement > 3 points between any two evaluators = flag the axis as `needs-refinement` (anchors are insufficiently precise). The minimum score still applies.

Programmatic checks run in parallel with evaluator scoring. Any programmatic failure caps the axis score at 5 regardless of evaluator scores.

Behavioral simulation runs in Phase 4 verify for applicable axes. A behavioral FAIL overrides a passing perceptual score.

---

## Category: Developer Experience

### Axis: onboarding_friction
Weight: 0.95
Category: experience

#### Anchors
- **0**: User clones repo, gets errors on install or hook setup. Prerequisites are unclear or version-mismatched. No clear path from install to first working command. User gives up or opens an issue.
- **5**: User follows QUICKSTART.md, hits 1-2 recoverable snags (wrong Node version, hook path issue). Gets to first `/do` command in under 10 minutes. Understands that something happened but not why it matters.
- **10**: `git clone` → `claude --plugin-dir` → `/do setup` → first successful `/do review` in under 3 minutes. Zero errors. Setup detects stack correctly. The demo task runs on the user's actual code and produces a result that immediately demonstrates value. User thinks "I need this."

#### Verification
- **programmatic**: Clone repo into clean temp directory, run install-hooks.js, verify exit 0. Run `/do setup` simulation against a sample TypeScript project, measure wall time. Verify every command in QUICKSTART.md is copy-pasteable (no placeholder paths without explanation).
- **structural**: Every prerequisite is version-pinned. Every error the setup can produce has a recovery instruction. The QUICKSTART.md step count is ≤ 6. No step requires the user to understand git worktrees, hooks, or plugin internals.
- **perceptual**: Panel scores "would a developer with Node.js and Claude Code installed succeed on first attempt without external help?"

#### Research inputs
- .planning/research/fleet-citadel-ui-arch/ (competitor onboarding flows)
- GitHub issues tagged "setup", "install", "getting started"
- QUICKSTART.md (current state)

---

### Axis: error_recovery
Weight: 0.8
Category: experience

#### Anchors
- **0**: Errors produce raw stack traces or silent failures. User has no idea what went wrong or what to do. Hooks fail and block work with no explanation. Campaign enters a broken state with no recovery path.
- **5**: Most errors produce a message identifying the problem. Some suggest fixes. Circuit breaker fires but the user doesn't understand why. Stale coordination claims require manual cleanup.
- **10**: Every error the system can produce includes: what happened, why, and what to do next. Circuit breaker messages reference the specific tool and suggest a concrete alternative. Stale state is auto-cleaned. Campaign files in broken states are detected and the user is offered recovery options (resume, archive, investigate). No error requires the user to read source code to recover.

#### Verification
- **programmatic**: Inject synthetic failures (malformed campaign file, missing harness.json, dead worktree, corrupt telemetry JSONL). Verify each produces a user-facing message, not a stack trace. Count error paths in hooks_src/ that have no stdout.write message.
- **structural**: Every catch block in hooks either logs a user-facing message or is explicitly marked non-critical with a comment explaining why silence is correct. Every campaign status transition has a defined recovery path in docs.
- **perceptual**: Panel scores "if something breaks during a fleet session, can the user recover without reading the source?"

#### Research inputs
- hooks_src/ (all catch blocks and error paths)
- GitHub issues tagged "bug", "error", "crash"

---

### Axis: command_discoverability
Weight: 0.7
Category: experience

#### Anchors
- **0**: User knows Citadel is installed but has no idea what commands exist. `/do --list` output is a wall of text with no grouping or context. Skill names are cryptic. No guidance on which tool fits which problem.
- **5**: `/do --list` groups skills by category. Skill descriptions exist but are generic. User can find the right skill if they already know the concept (e.g., "I need a code review" → `/review`). Users who don't know the concept ("my code keeps breaking between sessions") can't find the solution (campaigns).
- **10**: `/do --list` is organized by user intent, not system taxonomy. Entry points are task-oriented: "I want to review code", "I want to build something new", "I want to debug a problem." Each entry includes a one-line example. The `/do` router handles natural language well enough that the user never needs to know skill names. Typing `/do what should I work on next` produces a useful answer.

#### Verification
- **programmatic**: Feed 20 natural-language task descriptions to the `/do` router's Tier 2 keyword matcher. Measure match rate. Target: ≥ 80% route to the correct skill.
- **structural**: Every skill has a description in frontmatter that contains at least one verb phrase a user would actually say. `/do --list` output groups skills by user intent, not internal category. Every group has ≤ 8 items.
- **perceptual**: Panel scores "could a user who has never read the docs find the right skill for their task?"

#### Research inputs
- skills/ (all frontmatter descriptions)
- docs/SKILLS.md

---

## Category: Documentation

### Axis: documentation_coverage
Weight: 0.85
Category: documentation

#### Anchors
- **0**: README exists but docs are sparse or outdated. Most skills have no usage examples. Hook behavior is undocumented. Campaign file format is described only in agent definitions that users never read. New users are forced to read source code.
- **5**: Core concepts are documented (skills, hooks, campaigns, fleet). Each has a dedicated doc file. But docs describe the system's internals rather than answering user questions. Examples exist but are canned, not drawn from real usage. No troubleshooting section.
- **10**: Documentation is task-oriented. Every common question has an answer findable within 2 clicks from the README. Every skill has at least one real-world example showing input and output. Every hook has a "what you'll see" section showing the actual message it produces. Campaign and fleet docs include a worked example walking through a real multi-session workflow. Troubleshooting section covers the top 10 issues from GitHub.

#### Verification
- **programmatic**: Count ratio of skills with usage examples to total skills. Target: 100%. Count ratio of hooks with "what you'll see" documentation to total hooks. Verify every internal link in docs/ resolves. Verify every code example in docs is syntactically valid.
- **structural**: Every doc file has a "When to use this" section. No doc file exceeds 300 lines (split if longer). Every doc references at most 2 prerequisite concepts (if more, add a "Prerequisites" link list). Table of contents exists for any doc over 100 lines.
- **perceptual**: Panel scores "can a user answer their question from the docs without opening source code or asking on GitHub?"

#### Research inputs
- docs/ (all files)
- GitHub issues tagged "documentation", "question", "how to"
- README.md, QUICKSTART.md, CONTRIBUTING.md

---

### Axis: documentation_accuracy
Weight: 0.9
Category: documentation

#### Anchors
- **0**: Docs describe features that don't exist, reference old file paths, or show commands that error. Code examples use APIs that have changed. Docs and source code disagree on behavior.
- **5**: Docs are mostly accurate but lag behind recent changes. Some examples reference old patterns. File paths are correct but some behavior descriptions are stale. A careful reader would notice discrepancies.
- **10**: Every claim in the docs is verifiable against the current source. Every code example runs without modification. Every file path exists. Every command produces the output the docs say it will. Docs and source are checked against each other in CI (or by a test script).

#### Verification
- **programmatic**: Extract every file path mentioned in docs/*.md and verify it exists in the repo. Extract every bash command in docs and verify it parses (shellcheck or equivalent). Run test-demo.js to verify the demo page routing matches docs. Cross-reference skill names in docs/SKILLS.md against actual skills/ directory contents.
- **structural**: Every doc file has a `last-updated` field. No doc has a last-updated date older than 30 days from the most recent commit that touched files it describes.
- **perceptual**: Panel scores "did you encounter any claim in the docs that contradicts what the code actually does?"

#### Research inputs
- docs/ cross-referenced with skills/, hooks_src/, scripts/

---

## Category: Technical Quality

### Axis: test_coverage
Weight: 0.85
Category: technical

#### Anchors
- **0**: No tests, or tests exist but most are broken or skipped. Adding a new hook or skill has no way to verify it works without manual testing. Regressions are discovered by users.
- **5**: Hook smoke tests exist and pass. Skill lint validates structure. Integration tests cover the main hook pipeline. But edge cases (malformed input, missing files, concurrent access) are untested. New skills can be added without tests.
- **10**: Every hook has smoke tests AND integration tests covering normal, error, and edge-case paths. Every skill has at least one benchmark scenario. The test suite runs in under 60 seconds with no network or LLM dependency. Adding a new hook or skill without tests causes CI to warn. Test coverage is tracked numerically and visible.

#### Verification
- **programmatic**: Run `node scripts/test-all.js`, count pass/fail/skip. Calculate ratio of hooks with dedicated test cases to total hooks. Calculate ratio of skills with benchmark scenarios to total skills. Measure test suite wall time.
- **structural**: Every hook in hooks_src/ has a corresponding test sequence in integration-test.js or smoke-test.js. Every skill in skills/ has a `__benchmarks__/` directory (may be empty but must exist). test-all.js exits non-zero on any failure.
- **perceptual**: Panel scores "would you trust this test suite to catch a regression you introduced?"

#### Research inputs
- scripts/test-all.js, scripts/integration-test.js, hooks_src/smoke-test.js
- skills/*/__benchmarks__/

---

### Axis: hook_reliability
Weight: 0.8
Category: technical

#### Anchors
- **0**: Hooks crash on unexpected input, block the user's work with unhelpful errors, or silently fail to fire. The circuit breaker doesn't trip when it should. Protected files can be edited through indirect paths.
- **5**: Hooks handle normal cases correctly. Most edge cases are covered. Security hooks (protect-files, external-action-gate) block direct violations but miss indirect paths (e.g., `cat .env` was missed until recently). Hooks are fast enough on small projects but untested on large repos.
- **10**: Every hook handles: valid input, malformed input, missing dependencies, large files, concurrent execution, and the "file doesn't exist anymore" race condition. Security hooks cover direct and indirect paths (no known bypasses). Post-edit typecheck completes in under 5 seconds on repos with 1000+ files. Every hook failure mode is documented and tested.

#### Verification
- **programmatic**: Run integration-test.js, count pass/fail. Inject malformed JSON into every hook via stdin, verify none crash (exit 0 or exit 2, never unhandled exception). Time post-edit.js on a large TypeScript project (>500 files), verify < 5s. Attempt `cat .env`, `head .env`, `grep -r API_KEY .env*` through Bash tool, verify all blocked.
- **structural**: Every hook's main() function has a try/catch at the top level. Every catch either exits 0 (non-critical) or exits 2 (security-critical) with a message. No hook uses `execSync` (injection risk), all use `execFileSync`. Every hook that reads config handles missing harness.json gracefully.
- **perceptual**: Panel scores "do you trust these hooks to protect your project without getting in your way?"

#### Research inputs
- hooks_src/ (all files)
- docs/HOOKS.md
- GitHub issues tagged "hook", "security"

---

### Axis: api_surface_consistency
Weight: 0.65
Category: technical

#### Anchors
- **0**: Skills use different section names, different frontmatter fields, different output formats. Some skills produce HANDOFF blocks, some don't. Campaign files have inconsistent field names. The system feels like 30 tools written by 30 people.
- **5**: Most skills follow the five-section format (Identity, Orientation, Protocol, Quality Gates, Exit Protocol). Most produce HANDOFF blocks. But naming conventions vary (some use camelCase, some snake_case in state files). Some skills have undocumented commands.
- **10**: Every skill follows the identical five-section format with identical frontmatter schema. Every skill that modifies files produces a HANDOFF block. Every campaign file uses identical field names with identical casing. Every telemetry event follows the schema v1 format. A developer reading any skill can predict the structure of every other skill.

#### Verification
- **programmatic**: Run skill-lint.js, count PASS/WARN/FAIL. Verify every skill has all five required sections. Verify every skill's frontmatter has name, description, user-invocable. Verify every telemetry entry in a sample JSONL file validates against telemetry-schema.js.
- **structural**: Grep all campaign files for field name patterns, verify consistent casing. Grep all skills for HANDOFF block, verify presence in every skill that modifies files. Check that all agent definitions use identical tool lists where applicable.
- **perceptual**: Panel scores "does the system feel like one coherent product or a collection of scripts?"

#### Research inputs
- skills/ (all SKILL.md files)
- scripts/skill-lint.js
- scripts/telemetry-schema.js

---

## Category: Competitive Positioning

### Axis: differentiation_clarity
Weight: 0.9
Category: positioning

#### Anchors
- **0**: README reads like a feature list. No clear statement of what problem Citadel solves that alternatives don't. A reader can't distinguish Citadel from CrewAI, LangChain, or a well-configured CLAUDE.md in under 30 seconds.
- **5**: README explains what Citadel does and mentions unique features (campaign persistence, fleet coordination). But the "why this over alternatives" isn't explicit. A reader who hasn't used Claude Code extensively wouldn't understand why these features matter.
- **10**: Within 10 seconds of landing on the README or demo page, a reader understands: (1) what Citadel does, (2) what pain it eliminates, (3) why existing alternatives don't solve it. The differentiation is demonstrated, not claimed. The demo page lets someone experience the routing system. The README's opening paragraph contains a concrete "before Citadel / after Citadel" contrast that any Claude Code user recognizes.

#### Verification
- **programmatic**: Measure README word count before first code block (target: < 100 words to first value statement). Verify demo page loads in < 2 seconds. Verify demo page interactive elements function without JavaScript errors.
- **structural**: README contains a "Why Citadel Exists" section in the first 3 sections. That section references a concrete pain point, not an abstract capability. Demo page has an interactive element, not just text. Competitive comparison exists somewhere accessible (FAQ, docs, or dedicated page).
- **perceptual**: Panel scores "after 30 seconds with the README, can you explain to a colleague what Citadel does that CLAUDE.md alone doesn't?"

#### Research inputs
- .planning/research/fleet-citadel-ui-arch/ (competitor analysis)
- README.md
- docs/index.html (demo page)

---

### Axis: competitive_feature_coverage
Weight: 0.7
Category: positioning

#### Anchors
- **0**: Competitors offer features Citadel doesn't have, and Citadel's docs don't address the gap. A CTO comparing options sees missing checkboxes with no explanation.
- **5**: Citadel covers most features competitors offer, with gaps in areas like visual workflow builders or no-code interfaces. Gaps are acknowledged in FAQ but not positioned.
- **10**: Every feature a competitor claims is either (a) implemented in Citadel, (b) explicitly addressed as out of scope with reasoning ("we don't do X because Y"), or (c) on a public roadmap with a timeline. Citadel's unique features (campaign persistence, speculative fleet, discovery relay) are prominently documented. The comparison is honest: Citadel loses on some axes and wins on others, and the positioning makes clear who should choose Citadel vs. alternatives.

#### Verification
- **programmatic**: Parse competitive research matrix. For each competitor feature, verify Citadel has either an implementation, a documented "not applicable" response, or a roadmap entry.
- **structural**: FAQ addresses "How is this different from [X]" for the top 3 competitors (CrewAI, LangChain, Superpowers). Each answer references specific Citadel capabilities, not vague claims.
- **perceptual**: Panel scores "if you were choosing between Citadel and CrewAI, does the documentation give you enough information to decide?"

#### Research inputs
- .planning/research/fleet-citadel-ui-arch/ (all scout reports)

---

## Category: Content and Presentation

### Axis: demo_page_effectiveness
Weight: 0.85
Category: presentation

#### Anchors
- **0**: Demo page is static text or a non-functional mockup. Doesn't demonstrate Citadel's actual behavior. Loads slowly or has broken elements.
- **5**: Demo page has interactive elements (the routing demo works). Visual design is competent. But the page doesn't create desire to install. A visitor understands what Citadel does but not why they should care. The demo shows capability without showing value.
- **10**: Demo page creates an "I need to try this" reaction. The routing demo lets visitors type their own task descriptions and see the tier cascade animate in real time. The page loads in under 2 seconds, works on mobile, and has zero JavaScript errors. Visual design matches the positioning (developer tool, not enterprise SaaS). The page ends with a single clear CTA: install command, copy-pasteable.

#### Verification
- **programmatic**: Lighthouse performance score ≥ 90. Lighthouse accessibility score ≥ 85. Zero JavaScript console errors. Page load under 2 seconds on 3G throttle. All interactive elements respond to input. Mobile viewport renders without horizontal scroll.
- **structural**: Page has exactly one CTA. CTA is a copy-pasteable install command, not a "sign up" button. Interactive demo accepts arbitrary text input, not just pre-set examples. Page contains no more than 3 scroll-lengths of content.
- **perceptual**: Panel scores "after using the demo page, do you want to install Citadel?"

#### Research inputs
- docs/index.html
- docs/FACELIFT_PLAN.md
- .planning/research/fleet-citadel-ui-arch/ (competitor demo pages)

---

### Axis: readme_quality
Weight: 0.8
Category: presentation

#### Anchors
- **0**: README is a wall of text, a feature dump, or mostly badges. No visual hierarchy. No clear entry point. A reader scrolls past without understanding what the project does.
- **5**: README has structure: hero image, description, quickstart, feature list. Content is accurate. But it reads like technical documentation, not a landing page. The tone is neutral and informational. A reader understands the project but isn't excited.
- **10**: README is the best single page about Citadel. Opens with a visual that communicates scale and sophistication. First paragraph answers "what is this and why should I care" in under 30 words. Quickstart is ≤ 5 steps, all copy-pasteable. Feature section shows, doesn't tell (the orchestration ladder with card visuals). FAQ addresses real objections. Closes with links to deeper docs, not a feature dump. The README makes a developer want to star the repo.

#### Verification
- **programmatic**: Word count of first paragraph ≤ 50. Quickstart steps ≤ 6. Every command in quickstart is copy-pasteable. All images load (no broken src). All links resolve. README renders correctly on GitHub (no raw HTML artifacts).
- **structural**: README sections in order: hero, why, quickstart, how it works, FAQ, links. No section exceeds 30 lines. Hero image exists and is SVG (scales on all displays). Badges are ≤ 4 (more is clutter).
- **perceptual**: Panel scores "does this README make you want to star the repo?"

#### Research inputs
- README.md
- assets/ (hero image, card SVGs)

---

### Axis: visual_coherence
Weight: 0.6
Category: presentation

#### Anchors
- **0**: Visual assets are inconsistent. README hero doesn't match demo page style. Card SVGs use different color palettes. No consistent visual language across the project's public face.
- **5**: Visual assets share a general style (dark theme, similar colors). But there's no documented design system. New assets are created by feel, not by reference. The demo page and README look like they belong together but aren't precisely coordinated.
- **10**: All public-facing visuals (hero SVG, card SVGs, demo page, docs) use identical color palette, consistent typography, and shared visual motifs. A design manifest exists documenting colors, fonts, and spacing. New visual assets can be created by referencing the manifest and matching existing work. The visual identity is distinctive enough that someone who's seen the README would recognize the demo page as the same project.

#### Verification
- **programmatic**: Extract all hex colors from SVG assets and demo page CSS. Verify they share a common palette (≤ 12 unique colors across all assets). Verify font families used across assets are ≤ 2.
- **structural**: A design manifest exists (.planning/design-manifest.md or equivalent). The manifest is referenced by the /design skill. All SVG assets use CSS classes or variables, not inline colors.
- **perceptual**: Panel scores "do all the visual elements look like they're from the same product?"

#### Research inputs
- assets/ (all SVGs)
- docs/index.html (demo page CSS)
- .planning/design-manifest.md (if exists)

---

## Category: Security and Trust

### Axis: security_posture
Weight: 0.95
Category: security

#### Anchors
- **0**: Hooks use execSync (shell injection risk). .env files are readable by agents. Protected files have known bypass paths. No input validation on hook payloads. A malicious skill could instruct an agent to exfiltrate code.
- **5**: Hooks use execFileSync. .env reads are blocked. Protected file patterns work for direct access. Input validation exists (validatePath, validateCommand). But bypass paths exist for indirect access. No audit trail for security-relevant events. Skills are loaded without any trust verification.
- **10**: Every hook uses execFileSync with validated inputs. .env access is blocked for both Read tool and Bash tool (cat, head, grep, source, env). Protected file patterns support recursive globs. Every security-relevant event (block, scope violation, external action gate) is logged to audit.jsonl. All hook scripts fail-closed on unexpected errors. Skills loaded from external sources have SHA-256 verification. No known bypass paths exist for any security control.

#### Verification
- **programmatic**: Grep all hooks_src/ for execSync (must be 0 occurrences outside of execFileSync). Attempt .env access through 5 known indirect paths, verify all blocked. Verify audit.jsonl receives entries for every blocked action. Verify protect-files handles ** glob patterns. Verify external-action-gate blocks git push, PR creation, and issue comments.
- **structural**: Every hook that can block (exit 2) logs to audit.jsonl. Every hook has input validation before processing. harness-health-util.js validatePath and validateCommand are used by every hook that handles file paths or commands. CONTRIBUTING.md documents security requirements for new hooks.
- **perceptual**: Panel scores "would you trust Citadel to run autonomous agents on a production codebase?"

#### Research inputs
- hooks_src/ (all files)
- docs/HOOKS.md
- CONTRIBUTING.md (security section)

---

## Category: Process Quality

> These axes are **Level 2+ only**. They are not scored until the Level-Up Protocol triggers
> and human approval adds them to the active rubric. They are defined here so the level-up
> proposals have concrete drafts to work from, not blank space.

### Axis: decomposition_quality
Weight: 0.85
Category: process
Level: 2+

#### Anchors
- **0**: Attack begins immediately without diagnosis. The change is a guess. No evidence that the right problem was identified before the first edit. Root cause is assumed, not established.
- **5**: Problem was identified correctly but the solution approach was not tested against alternatives. Attack started before the failure mode was fully understood. The change addresses the symptom but may not address the root cause.
- **10**: Before any changes: the loop documents what specific gap exists, what the root cause is, what approaches were considered, and why the chosen approach addresses the root cause. Every changed line is traceable to the diagnosis. If the diagnosis were wrong, the change would be visibly wrong too.

#### Verification
- **programmatic**: Loop log "Attack summary" section contains: (1) root cause identified, (2) at least one alternative approach considered, (3) chosen approach rationale. Check for presence, not quality.
- **structural**: The attack's first tool calls are Read/Grep/Bash (analysis) before any Edit/Write. A loop where the first tool call is Edit scores a maximum of 3 on this axis.
- **perceptual**: Evaluator scores "did the attack clearly understand the problem before solving it? Could you trace the change back to the diagnosis?"

---

### Axis: scope_appropriateness
Weight: 0.75
Category: process
Level: 2+

#### Anchors
- **0**: Change is larger than needed (rewrites when targeted edits suffice) or smaller than needed (patches a symptom without addressing the cause). The change radius does not match the problem radius. Unrelated improvements are included.
- **5**: Change is roughly proportional but includes minor scope creep (cleanup, refactoring not required by the axis gap) or is slightly too narrow (addresses the most visible symptom but leaves a related root cause untouched).
- **10**: Change touches exactly the files and lines needed to close the gap. No unrequested improvements. No under-specification. A reader can trace every changed line directly to the axis gap being closed. The diff is the minimal sufficient change.

#### Verification
- **programmatic**: `git diff --stat` shows changed file count. Loop log "Files modified" list maps every file directly to the axis gap. Files in the diff without explanation in the attack summary are a scope violation.
- **structural**: No file appears in the diff that isn't referenced in the attack summary's rationale. No TODO comments, reformatting, or style changes unrelated to the axis gap.
- **perceptual**: Evaluator scores "was every change necessary, and was nothing critical left out?"

---

### Axis: verification_depth
Weight: 0.80
Category: process
Level: 2+

#### Anchors
- **0**: Verify phase runs the existing test suite and declares pass. The tests don't test what changed. A regression in the targeted axis would pass all checks. The verification is orthogonal to the attack.
- **5**: Verify phase runs the test suite AND a perceptual spot-check on the targeted axis. But the spot-check evaluates the axis generally rather than specifically testing the changed artifact. If the change were reverted, the spot-check might not catch it.
- **10**: Verify phase: (1) runs programmatic checks that would specifically fail if the change were reverted, (2) includes behavioral simulation for applicable axes, (3) confirms the change is detectable — not just that the axis score didn't drop. If the change cannot be detected by the verification, the verification is declared insufficient and the loop re-designs the check.

#### Verification
- **programmatic**: Loop log "Verification results" contains at least one check specifically tied to the changed artifact (not just the full test suite). For doc changes: link verification. For code changes: the specific function/path is tested.
- **structural**: Behavioral simulation result is present in the loop log for applicable axes. The verify section names the specific changed file or behavior being tested, not just "test suite passed."
- **perceptual**: Evaluator scores "if this change were reverted, would the verification catch it?"

---

## Axis Priority (for /improve selection)

| Axis | Weight | Category | Level |
|------|--------|----------|-------|
| security_posture | 0.95 | security | 1 |
| onboarding_friction | 0.95 | experience | 1 |
| documentation_accuracy | 0.90 | documentation | 1 |
| differentiation_clarity | 0.90 | positioning | 1 |
| decomposition_quality | 0.85 | process | 2+ |
| documentation_coverage | 0.85 | documentation | 1 |
| test_coverage | 0.85 | technical | 1 |
| demo_page_effectiveness | 0.85 | presentation | 1 |
| verification_depth | 0.80 | process | 2+ |
| error_recovery | 0.80 | experience | 1 |
| hook_reliability | 0.80 | technical | 1 |
| readme_quality | 0.80 | presentation | 1 |
| scope_appropriateness | 0.75 | process | 2+ |
| command_discoverability | 0.70 | experience | 1 |
| competitive_feature_coverage | 0.70 | positioning | 1 |
| api_surface_consistency | 0.65 | technical | 1 |
| visual_coherence | 0.60 | presentation | 1 |

Level 1 axes are active now. Level 2+ axes activate after the Level-Up Protocol triggers and human approval moves them into the live rubric.

Selection formula: `(10 - current_score) × weight × effort_multiplier`

Effort multiplier: low = 1.0, medium = 0.7, high = 0.4

The system attacks the axis with the highest selection score.
An axis attacked in the previous loop gets a 0.5 penalty multiplier
(prevents oscillation between two axes).

---

## Rubric Evolution Protocol

After each loop, the scoring phase may propose new axes:

```
PROPOSED AXIS: {name}
Rationale: {why this emerged from the current loop}
Category: {which category}
Weight: {proposed weight}
Draft anchors: 0 / 5 / 10
```

Proposed axes are logged but NOT added to the rubric automatically.
They require human approval before inclusion. This prevents rubric
bloat and ensures every axis is genuinely worth optimizing.

Maximum axes: 20. If a new axis is more important than an existing
one, it should replace the lowest-weight axis, not be added on top.
