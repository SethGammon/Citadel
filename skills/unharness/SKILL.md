---
name: unharness
description: >-
  Remove Citadel from a project. Exports valuable state (campaigns, postmortems,
  research, backlog, discoveries) to docs/citadel/ as human-readable markdown,
  then removes all harness files and hooks. The archive is detected by /do setup
  on re-install and offered for restore.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - unharness
  - remove citadel
  - uninstall citadel
  - clean up citadel
  - remove harness
  - uninstall harness
last-updated: 2026-04-30
---

# /unharness — Remove Citadel from a Project

## Identity

You are the clean exit. Your job is to export everything worth keeping, then
remove every harness file and hook without leaving a mess. The user should end
up with either a clean project or a clean project plus a readable archive —
never a half-removed harness.

## Invocation Forms

```
/unharness               # Export archive, then remove harness
/unharness --export-only # Export to docs/citadel/ without removing anything
```

---

## Protocol

### Step 1: FIND CITADEL ROOT

Read `.citadel/plugin-root.txt` to locate the Citadel install.
If missing, use the directory containing this SKILL.md as the fallback.

```bash
cat .citadel/plugin-root.txt 2>/dev/null || echo "fallback"
```

Store as `{citadelRoot}`.

---

### Step 2: RUN UNHARNESS SCRIPT

```bash
node {citadelRoot}/scripts/unharness.js
```

For `--export-only`:

```bash
node {citadelRoot}/scripts/unharness.js --export-only
```

The script:
1. Scans `.planning/` for valuable content (campaigns, postmortems, research, backlog, discoveries)
2. Reads `.citadel/project.md` and `.claude/harness.json` for project metadata
3. Writes `docs/citadel/{category}.md` files with `citadel-archive: true` frontmatter
4. Removes `.planning/`, `.citadel/`, `.claude/agent-context/`
5. Strips Citadel hook entries from `.claude/settings.json` (preserves user hooks)
6. Prints a summary of what was exported and removed

Print the script output verbatim.

---

### Step 3: CLOSING MESSAGE

After the script completes, print:

**If archive was written:**
```
Archive is at docs/citadel/ — commit it, delete it, or leave it.
Run /do setup again anytime to reinstall Citadel.
If you run setup in this project, it will find the archive and offer to restore your history.
```

**If nothing was exported (empty project):**
```
Citadel removed. No history to archive.
Run /do setup again anytime to reinstall.
```

**If --export-only:**
```
Archive written to docs/citadel/. Harness files left in place.
Run /unharness without --export-only to complete the removal.
```

---

## Fringe Cases

**Script not found:**
Report the error and explain the user can run the hook installer manually:
`node /path/to/Citadel/scripts/unharness.js`

**No .planning/ directory (harness was installed but never used):**
The script handles this gracefully — it skips the export and proceeds to cleanup.
Nothing special needed.

**docs/citadel/ already exists from a previous unharness:**
The script overwrites with the current timestamp. Prior archives are replaced.
If the user wants to keep prior archives, they should commit `docs/citadel/` to git first.

**User runs unharness on a project that was never set up:**
The script exits cleanly with "Nothing to export." and nothing is deleted that shouldn't be.

---

## Quality Gates

- Never prompt the user before running — the export is the safety net, not a confirmation dialog
- Always print the script output so the user can see exactly what happened
- If the script errors, surface the error directly — don't swallow it

## Exit Protocol

After the closing message in Step 3, output nothing further. Unharness is a terminal action — no HANDOFF block, no next-step suggestions. The session is now running without hooks.
