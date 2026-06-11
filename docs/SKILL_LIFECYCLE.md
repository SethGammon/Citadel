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
