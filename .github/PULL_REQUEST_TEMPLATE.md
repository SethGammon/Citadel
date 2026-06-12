## What changed

<!-- A few sentences. Link the issue if one exists. -->

## Verification

- [ ] `npm test` passes locally
- [ ] Tested on: <!-- Windows / macOS / Linux -->
- [ ] No hardcoded Unix paths; `path.join()` for separators; `execFileSync` over `execSync`
- [ ] Hook changes: `node hooks_src/smoke-test.js` passes and hooks-template.json is updated
- [ ] Skill changes: `node scripts/skill-lint.js {name}` passes
- [ ] Security-relevant changes: the [SECURITY.md checklist](../SECURITY.md#security-checklist-for-harness-changes) is covered and THREAT_MODEL.md updated if boundaries moved

## Notes for the reviewer

<!-- Tradeoffs, things you were unsure about, follow-ups deliberately left out. -->
