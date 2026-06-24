# Skill Lifecycle

How skills enter, change, and leave this repo. Companion to `docs/SKILLS.md`.

## Line budget

Every `skills/{name}/SKILL.md` body stays under **300 lines**.

`node scripts/skill-lint.js` WARNs on any skill over budget. CI strict mode
(`--warn-as-fail`) turns the WARN into a failure.

Stays in SKILL.md:
- Protocol steps, commands, invocation forms
- Quality Gates, Contextual Gates, Exit Protocol
- Fringe cases the agent must handle inline

Moves to a docs companion (`docs/{TOPIC}.md`, linked from the skill):
- Rationale, history, and benchmarks behind a decision
- Long reference tables, migration guides, sample transcripts
- Anything the agent does not need on every invocation

Trim by deleting, not by compressing prose into ambiguity. Stale or vague
guidance actively degrades agent accuracy.

## No-op detection

A "no-op" is an instruction aimed at the agent's own disposition or effort with
no specific, checkable criterion: "be thorough", "make it high-quality", "write
clean code". Delete the line and a competent agent behaves the same (Pocock's
ablation test). No-ops burn tokens and dilute the load-bearing instructions
around them, so they are removed on sight - the same rule as the line budget:
trim by deleting, not by softening.

The pipeline is three tiers, cheap to expensive. Each tier only sees what the
one before it surfaced, so cost stays bounded:

| Tier | Command | Cost | Role |
|---|---|---|---|
| 1 - Static | `npm run noop:scan` | free, no LLM | Flag candidate lines (vocab hit, no anchor, not a guard). Advisory. |
| 2 - Judge | `npm run noop:judge` | 1 batched `claude` call for ALL candidates | Adjudicate each: delete / trim / keep, with a reason. |
| 3 - Ablation | `npm run noop:ablate -- --skill X` | ~2 calls per skill (batch+bisect) | Empirical Pocock test: rerun benchmarks with the line removed; same assertion vector => confirmed no-op. |
| 4 - Apply | `npm run noop:apply -- --skill X` | free | Apply confirmed removals; bumps `last-updated`. |

The detector (`core/skills/noop-detect.js`) is calibrated against
`core/skills/noop-calibration.json` and regression-tested by
`scripts/test-noop-detect.js`, which runs inside `node scripts/test-all.js`.
The hard invariant: it must NEVER flag a fringe-case guard (the most dangerous
false positive - it would delete a safeguard).

Two facts make this affordable:
- Static pre-filter means the LLM/ablation tiers only ever touch a handful of
  lines, never the whole corpus.
- Ablation removes ALL of a skill's candidates at once and runs the benchmarks
  once; only a behavioral change triggers bisection. Most candidates are real
  no-ops, so the single-pass branch dominates.

Cadence:
- **Every commit (free):** `test-all.js` runs the calibration test. `noop:scan`
  is advisory - run it when editing skills.
- **Pre-release:** run `noop:judge` on the current candidates; apply confirmed
  trims/deletes.
- **Audit / low-confidence:** escalate to `noop:ablate` for the empirical test.

When a removal is confirmed, add the line (and any new false-positive pattern
the scan surfaced) to `noop-calibration.json` so the detector keeps that
knowledge - the calibration set is the contract and it only grows.

## Adding a skill

1. Scaffold:
   `node scripts/skill-scaffold.js --name {name} --description "..." [--with-benchmark] --write`
2. Frontmatter requirements: `name` (must match the directory), `description`,
   `user-invocable`, `auto-trigger`, `last-updated`, and `trigger_keywords`.
   `trigger_keywords` is mandatory for any routable skill: the routing
   generator throws if a non-excluded skill has none.
3. Regenerate derived surfaces:
   - `node scripts/generate-routing.js`
   - `node scripts/generate-doc-surfaces.js`
4. Verify:
   - `node scripts/skill-lint.js {name}` (structure)
   - `node scripts/skill-bench.js --skill {name}` (after adding scenarios under
     `skills/{name}/__benchmarks__/{scenario}.md`)
   - `node scripts/test-all.js` before shipping

## Renaming a skill

The dangerous one. Routing tables, docs, and benchmarks all key on the name.

1. Rename the directory `skills/{old}/` to `skills/{new}/`.
2. Update `name:` in frontmatter to match the new directory.
3. Rerun both generators: `node scripts/generate-routing.js` and
   `node scripts/generate-doc-surfaces.js`.
4. Run `node scripts/test-routing-sync.js`. It fails if any routing surface
   still references the old name.
5. Grep the repo for the old name: `docs/`, `README.md`, other skills'
   `neighbor-skills` frontmatter, benchmark scenario `skill:` fields, and
   `hooks_src/`.
6. Run `node scripts/skill-lint.js {new}` to confirm name-matches-dir passes.

## Deprecating a skill

The research-fleet pattern. Stub first; never delete outright.

1. Replace SKILL.md with a stub under 25 lines: frontmatter plus a pointer to
   the replacement skill.
2. Prefix the description with `DEPRECATED:` and name the replacement.
3. Remove `trigger_keywords` so /do stops routing to it.
4. Add the skill to `EXCLUDED_SKILLS` in `scripts/generate-routing.js` in the
   same change. Without the exclusion, the generator throws on the missing
   keywords. Then rerun both generators.
5. Keep the stub for two releases, then delete the directory and remove the
   exclusion entry.

## Versioning

- Every SKILL.md carries `last-updated: YYYY-MM-DD` in frontmatter.
- Any change to Protocol, Quality Gates, or Exit Protocol REQUIRES bumping
  `last-updated` in the same edit. Typo and formatting fixes do not.
- A `last-updated` more than 90 days old is a review trigger: re-read the
  skill against observed behavior, then either update it or re-confirm the
  date.
