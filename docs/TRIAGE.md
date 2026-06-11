# Triage Reference

> last-updated: 2026-06-11

Reference companion for `/triage`, the GitHub issue and PR investigator. The
execution protocol, classification taxonomy, and gates live in
`skills/triage/SKILL.md`; this doc holds the full output templates the skill
points to.

## PR Resolution Template

Phase 1b produces one resolution block per reviewed PR:

```markdown
## PR #<N>: <title>

**Author:** <username>
**Type:** bugfix | feature | refactor | docs | infra
**Files changed:** <count>
**Mergeable:** yes | no

### What it does
<1-3 sentences>

### Review findings
- <finding with file:line reference>

### Issues found
- **Critical:** <blocks merge>
- **Non-critical:** <nice to fix but not blocking>

### Recommendation
- [ ] Approve
- [ ] Request changes: <specific changes needed>
- [ ] Close: <reason>
```

## Issue Resolution Plan Template

Phase 4 produces one resolution plan per investigated issue:

```markdown
## Issue #<N>: <title>

**Type:** bug | feature | question | docs | infra
**Severity:** critical | high | medium | low
**Component:** <affected directory/file>
**Reproducible:** yes | no | not-attempted

### Root Cause
<1-3 sentences explaining WHY>

### Affected Code
- `<file>:<line>` — <what's wrong here>

### Proposed Fix
<Specific code changes with file:line references>

### Impact
- Who is affected: <scope>
- Workaround exists: yes/no
- Breaking change: yes/no

### Recommended Action
- [ ] Fix in next release
- [ ] Needs more info from reporter
- [ ] Won't fix — <reason>
- [ ] Duplicate of #<N>
```

## Triage Summary Example

Phase 6 reports a summary table for the batch:

```
## Triage Summary

| # | Title | Type | Severity | Action | Status |
|---|-------|------|----------|--------|--------|
| 10 | Cannot find module | bug | high | Auto-fixed → PR #11 | Done |
```
