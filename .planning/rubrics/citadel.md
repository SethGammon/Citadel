# Rubric: citadel

> Target: The Citadel product (repo, docs, demo, skills, hooks, UI)
> Created: 2026-03-28
> Version: 2
> Status: approved (level 2)

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
- **5**: Every error the system can produce includes: what happened, why, and what to do next. Circuit breaker messages reference the specific tool and suggest a concrete alternative. Stale state is auto-cleaned. Campaign files in broken states are detected and the user is offered recovery options (resume, archive, investigate). No error requires the user to read source code to recover. *(This was the Level 1 ceiling — now the floor for Level 2.)*
- **10**: Every error message is context-specific: it names the specific file, campaign, or state that caused the problem — not a generic category. No two failure modes share the same message template. Synthetic failure injection tests cover all documented failure modes in the test suite; every failure produces an actionable message verified programmatically. Campaign files in broken states are self-healing: the system attempts auto-recovery before surfacing the error to the user.

#### Verification
- **programmatic**: Inject synthetic failures (malformed campaign file, missing harness.json, dead worktree, corrupt telemetry JSONL). Verify each produces a user-facing message that names the specific artifact, not a stack trace. Verify no two injected failures produce identical message text. Count error paths in hooks_src/ that have no stdout.write message.
- **structural**: Every catch block in hooks either logs a user-facing message or is explicitly marked non-critical with a comment explaining why silence is correct. Every campaign status transition has a defined recovery path in docs.
- **perceptual**: Panel scores "if something breaks during a fleet session, can the user recover without reading the source? Does the error message tell you exactly what broke?"

#### Research inputs
- hooks_src/ (all catch blocks and error paths)
- GitHub issues tagged "bug", "error", "crash"

---

### Axis: command_discoverability
Weight: 0.7
Category: experience

#### Anchors
- **0**: User knows Citadel is installed but has no idea what commands exist. `/do --list` output is a wall of text with no grouping or context. Skill names are cryptic. No guidance on which tool fits which problem.
- **5**: `/do --list` groups skills by user intent. Each entry has a one-line example. The `/do` router handles natural language well enough that the user rarely needs to know skill names. *(This was the Level 1 ceiling — now the floor for Level 2.)*
- **10**: The `/do` router demonstrates ≥90% correct routing on a held-out test set of 50 real-world task descriptions. When routing confidence is low, the router surfaces multiple skill options with a brief explanation of when each applies. `/do --list` reflects real usage: telemetry-informed "most used" and contextually relevant suggestions based on the project's current state. A developer new to Citadel can find the right skill for any common task in under 30 seconds without reading docs.

#### Verification
- **programmatic**: Feed 50 natural-language task descriptions (not the original 20) to the `/do` router. Measure match rate. Target: ≥ 90% route to the correct skill. Verify router surfaces alternatives when confidence is low.
- **structural**: Every skill has a description in frontmatter that contains at least one verb phrase a user would actually say. `/do --list` output groups skills by user intent, not internal category. Every group has ≤ 8 items.
- **perceptual**: Panel scores "could a user who has never read the docs find the right skill for their task? When the router is unsure, does it help or confuse?"

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
- **5**: Documentation is task-oriented. Every common question has an answer findable within 2 clicks from the README. Every skill has at least one real-world example. Every hook has a "what you'll see" section. Troubleshooting section covers the top 10 issues. *(This was the Level 1 ceiling — now the floor for Level 2.)*
- **10**: Every skill's usage example matches a real workflow that exists or has existed in the repo's git log — no fabricated examples. Every hook's "what you'll see" section includes the literal message text, not a description of it. A coverage check script (not manual audit) verifies example presence and recency. Any new skill or hook added without an example causes CI to warn. Documentation gaps are found by the system before users encounter them.

#### Verification
- **programmatic**: Run coverage check script. Count ratio of skills with real-workflow examples to total skills. Target: 100%. Count ratio of hooks with literal message text in docs to total hooks. Verify every internal link in docs/ resolves. Verify every code example in docs is syntactically valid. Verify CI fails on new skill without example.
- **structural**: Every doc file has a "When to use this" section. No doc file exceeds 300 lines. Every doc references at most 2 prerequisite concepts. Table of contents exists for any doc over 100 lines.
- **perceptual**: Panel scores "can a user answer their question from the docs without opening source code or asking on GitHub? Are the examples recognizably real, not fabricated?"

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
- **10**: Beyond structure validation, tests verify semantic correctness: the `/do` router test confirms it routes "review my code" to `/review`, not just that a route was selected. Campaign state tests verify a campaign can be paused, serialized, and resumed with identical state. Fleet merge tests verify discovery relay actually propagates findings across agents. Every major system behavior (routing, state persistence, agent coordination) has at least one test that would fail if the behavior were broken — not just if the file were absent.

#### Verification
- **programmatic**: Run `node scripts/test-all.js`, count pass/fail/skip. Verify router tests use real input strings and assert specific skill targets. Verify campaign state round-trip test exists. Verify fleet discovery relay test exists. Measure test suite wall time.
- **structural**: Every hook in hooks_src/ has a corresponding test sequence. Every skill in skills/ has a `__benchmarks__/` directory. test-all.js exits non-zero on any failure. Every major system behavior is named and covered in a test comment.
- **perceptual**: Panel scores "would you trust this test suite to catch a regression in routing, campaign state, or fleet coordination?"

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
- **5**: Within 10 seconds of landing on the README or demo page, a reader understands: (1) what Citadel does, (2) what pain it eliminates, (3) why existing alternatives don't solve it. The differentiation is demonstrated, not claimed. *(This was the Level 1 ceiling — now the floor for Level 2.)*
- **10**: The README contains a concrete "before/after" workflow comparison — a specific real workflow (e.g., multi-file refactor with session context loss) shown with and without Citadel, with measurable differences (context preserved, work recovered, agents coordinated). A developer who has used Claude Code for any purpose can identify at least 3 limitations of vanilla Claude Code that Citadel solves, from the README alone. Competitive comparison names specific competitor limitations with links to their documentation, not vague claims.

#### Verification
- **programmatic**: Measure README word count before first code block (target: < 100 words to first value statement). Verify demo page loads in < 2 seconds. Verify before/after section exists in README. Verify competitive comparison contains at least 3 external links.
- **structural**: README contains a "Why Citadel Exists" section in the first 3 sections. That section references a concrete pain point with a before/after contrast. Competitive comparison names specific competitor limitations by name.
- **perceptual**: Panel scores "after 30 seconds with the README, can you explain to a colleague what Citadel does that CLAUDE.md alone doesn't? Does the before/after make the value obvious?"

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
- **10**: Demo page contains at least 3 realistic output previews — actual or near-actual outputs from Citadel features, not wireframes or placeholder text. A visitor understands what they'll get before installing. The routing demo shows realistic skill descriptions and realistic responses. No sign-up or authentication required to see any content. Page load ≤ 2 seconds cold. Every interactive element works without a backend connection. The page ends with a single copy-pasteable install command.

#### Verification
- **programmatic**: Lighthouse performance score ≥ 90. Lighthouse accessibility score ≥ 85. Zero JavaScript console errors. Page load under 2 seconds on 3G throttle. All interactive elements respond to input without network calls. No authentication prompt or paywall of any kind.
- **structural**: Page has exactly one CTA. CTA is a copy-pasteable install command. At least 3 output previews contain realistic Citadel output text. Page contains no more than 3 scroll-lengths of content.
- **perceptual**: Panel scores "after using the demo page, do you understand what Citadel actually produces? Does the page make you want to install it?"

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
- **10**: README opens with a single paragraph that articulates a pain point every Claude Code user has felt — not a feature description, a problem. The pain point is concrete enough that a reader thinks "that happened to me." Quickstart is ≤ 4 steps, all copy-pasteable. Feature section uses static visuals that communicate scale without requiring JavaScript. The README makes sense printed on paper: no "click here" or "try the demo" without a fallback. Closes with a single copy-pasteable install command. The writing resonates with the universal developer experience of losing context, not with enterprise jargon.

#### Verification
- **programmatic**: First paragraph passes the "pain point test" (contains a concrete user frustration, not a capability claim). Quickstart steps ≤ 4. Every command in quickstart is copy-pasteable. All images are static SVG (no JS-rendered content). All links resolve. README renders correctly on GitHub.
- **structural**: README sections in order: hero, why (pain point), quickstart, how it works, FAQ, links. No section exceeds 30 lines. Hero image exists and is SVG. Badges are ≤ 4.
- **perceptual**: Panel scores "does this README make you feel understood as a developer? Does the opening paragraph match something you've experienced?"

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

### Axis: decomposition_quality
Weight: 0.85
Category: process

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

#### Anchors
- **0**: Verify phase runs the existing test suite and declares pass. The tests don't test what changed. A regression in the targeted axis would pass all checks. The verification is orthogonal to the attack.
- **5**: Verify phase runs the test suite AND a perceptual spot-check on the targeted axis. But the spot-check evaluates the axis generally rather than specifically testing the changed artifact. If the change were reverted, the spot-check might not catch it.
- **10**: Verify phase: (1) runs programmatic checks that would specifically fail if the change were reverted, (2) includes behavioral simulation for applicable axes, (3) confirms the change is detectable — not just that the axis score didn't drop. If the change cannot be detected by the verification, the verification is declared insufficient and the loop re-designs the check.

#### Verification
- **programmatic**: Loop log "Verification results" contains at least one check specifically tied to the changed artifact (not just the full test suite). For doc changes: link verification. For code changes: the specific function/path is tested.
- **structural**: Behavioral simulation result is present in the loop log for applicable axes. The verify section names the specific changed file or behavior being tested, not just "test suite passed."
- **perceptual**: Evaluator scores "if this change were reverted, would the verification catch it?"

---

## Category: Compounding Value

### Axis: compound_value_visibility
Weight: 0.75
Category: compounding

#### Anchors
- **0**: Each feature (skills, hooks, campaigns, fleet) appears standalone in docs and README. No demonstration of how they layer. A reader sees a list of tools, not a system.
- **5**: README and docs mention that features work together. A developer who reads the full docs understands the layering. But the first impression doesn't communicate compounding — only the full-read version does.
- **10**: The value stack is visible immediately. A reader sees that skills enable campaigns, campaigns enable fleet, fleet enables institutional-scale throughput — and each layer multiplies the value of the one below it. One diagram or demonstration communicates the full compound effect without requiring the full docs. A developer can explain the compounding to a colleague from memory, from the README alone.

#### Verification
- **programmatic**: README contains a visual or diagram showing the skill → campaign → fleet value stack. That diagram exists in SVG or equivalent (not just text). Demo page references layered value in at least one visible element.
- **structural**: "How it works" section of README shows the stack progression, not a flat feature list. Each layer's description references how it builds on the previous.
- **perceptual**: Panel scores "from the README alone, can you explain why fleet is more powerful than skills alone? Does the compounding feel obvious or buried?"

#### Research inputs
- README.md
- docs/index.html

---

### Axis: team_adoption_friction
Weight: 0.70
Category: compounding

> **V4+ note**: Scores above 5 require features that are not yet built (shared campaign state committed to repo, team harness.json, per-member onboarding). Score current state honestly against these anchors; don't inflate because the features are planned.

#### Anchors
- **0**: No guidance on team setup. Each developer configures Citadel independently. No shared config. No onboarding path for new team members. One developer using Citadel provides zero benefit to colleagues.
- **5**: Documentation covers individual install. A team lead can write setup instructions for others by following QUICKSTART.md. But shared campaign state, shared quality rules, and team conventions must be invented by each team — no official path exists.
- **10**: A dedicated "team setup" guide exists. Shared campaign state can be committed to the repo and visible to all team members. A new team member can join a running project and see existing campaigns, fleet sessions, and telemetry. The harness.json has documented team-configuration options. A team lead can set standards (protected files, quality rules, approved skills) that apply uniformly to all members without per-member setup.

#### Verification
- **programmatic**: "Team setup" guide exists in docs/. Verify harness.json schema includes at least one team-scoping field. Check if campaign state files are designed to be committed (no absolute paths, no per-user secrets).
- **structural**: CONTRIBUTING.md or an equivalent doc describes how to introduce Citadel to a team. No step in the team guide requires each member to run a different command.
- **perceptual**: Panel scores "if your team lead said 'we're adopting Citadel,' how much work would fall on each developer individually?"

#### Research inputs
- QUICKSTART.md, CONTRIBUTING.md
- .claude/harness.json (schema)

---

### Axis: skill_authoring_quality
Weight: 0.65
Category: compounding

> **Cap note**: Score is capped at 6-7 until behavioral instrumentation exists to verify that skills authored by external users perform as well as built-in skills. The 10 anchor describes the target state; reaching it requires telemetry that doesn't exist yet.

#### Anchors
- **0**: Writing a new skill requires reading existing skills to understand the format. /create-skill produces boilerplate. Skills written without guidance produce inconsistent results. No feedback on whether a skill was well-written. New skills work syntactically but often fail at the protocol level.
- **5**: /create-skill produces a valid skill structure. skill-lint.js validates format. But the quality of the protocol depends entirely on the author's domain expertise. No guidance on what makes a good protocol versus a bad one. New skills pass lint but may not perform as well as built-in skills.
- **10**: The skill authoring workflow teaches good skill design. /create-skill interviews the author about failure modes, not just happy paths. skill-lint.js flags weak protocols (protocol with no decision points, quality gates that aren't verifiable, identity section that doesn't set a perspective). A first-time skill author who follows the workflow produces a skill that performs comparably to built-in skills on the first try — measurable via telemetry showing task completion rates.

#### Verification
- **programmatic**: /create-skill interview flow includes at least one question about failure modes. skill-lint.js checks for decision points in protocol section, verifiable quality gates, and identity perspective statement. Telemetry tracks per-skill task completion rate (if instrumentation exists).
- **structural**: docs/SKILLS.md contains an "anti-patterns" section listing common skill authoring mistakes. /create-skill output is validated by skill-lint.js before writing to disk.
- **perceptual**: Panel scores "after following the skill authoring workflow, could a developer with no prior Citadel experience write a skill that actually works?"

#### Research inputs
- skills/improve.md, skills/review.md (examples of high-quality skills)
- scripts/skill-lint.js
- docs/SKILLS.md

---

## Axis Priority (for /improve selection)

| Axis | Weight | Category | Level |
|------|--------|----------|-------|
| security_posture | 0.95 | security | 1 |
| onboarding_friction | 0.95 | experience | 1 |
| documentation_accuracy | 0.90 | documentation | 1 |
| differentiation_clarity | 0.90 | positioning | 1 |
| decomposition_quality | 0.85 | process | 2 |
| documentation_coverage | 0.85 | documentation | 1 |
| test_coverage | 0.85 | technical | 1 |
| demo_page_effectiveness | 0.85 | presentation | 1 |
| verification_depth | 0.80 | process | 2 |
| error_recovery | 0.80 | experience | 1 |
| hook_reliability | 0.80 | technical | 1 |
| readme_quality | 0.80 | presentation | 1 |
| compound_value_visibility | 0.75 | compounding | 2 |
| scope_appropriateness | 0.75 | process | 2 |
| command_discoverability | 0.70 | experience | 1 |
| competitive_feature_coverage | 0.70 | positioning | 1 |
| team_adoption_friction | 0.70 | compounding | 2 |
| api_surface_consistency | 0.65 | technical | 1 |
| skill_authoring_quality | 0.65 | compounding | 2 |
| visual_coherence | 0.60 | presentation | 1 |

Level 1 axes: active. Level 2 axes: active (approved via Level-Up Protocol).

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
