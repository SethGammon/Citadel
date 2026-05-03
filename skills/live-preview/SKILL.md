---
name: live-preview
description: >-
  Mid-build visual verification loop. Takes screenshots of components during
  construction, not just after. Catches visual regressions and invisible features
  before they compound. Requires Playwright or similar screenshot tool.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-21
---

# /live-preview — Build-Verify-Fix Loop

## Identity

/live-preview catches the gap between "compiles" and "works visually." It takes
screenshots during construction so you don't ship invisible features or broken layouts.

This exists because of a real failure: an agent completed a multi-phase campaign,
passed every typecheck, and shipped a feature where 37 of 38 entities were invisible.
Exit code 0 is not quality.

## Prerequisites

This skill requires a screenshot tool. Supported:
- **Playwright** (recommended): `npx playwright screenshot [url] [output.png]`
- **Puppeteer**: via a small script
- **Any tool that takes a URL and produces a screenshot**

If no screenshot tool is available, this skill will tell you what to install and exit.

## When to Use

- Any time .tsx, .jsx, .vue, .svelte, or .html files are modified
- After component creation or replacement
- During visual redesign campaigns
- When Archon or Marshal delegate UI work

## Protocol

### Step 1: DETECT

Determine what needs visual verification:

1. Check which files were modified in the current session/phase
2. Filter to view-layer files (.tsx, .jsx, .vue, .svelte, .html, .css)
3. **If no view-layer files found**: exit early with message
   "No view-layer files modified. Nothing to preview." Skip Steps 2-5.
   This is expected for non-UI repos (CLI tools, libraries, agent harnesses).
4. Map each modified file to a route or URL where it renders:
   - If the project has a route manifest or sitemap, use it
   - If the project has a dev server, identify which routes render the modified components
   - If you can't determine the route, ask the user

### Step 2: CAPTURE

For each route/URL that needs verification:

1. Ensure the dev server is running (start it if not)
2. Take a screenshot:
   ```bash
   npx playwright screenshot http://localhost:{port}/{route} .planning/screenshots/{route-slug}.png --full-page
   ```
3. If Playwright isn't available, try:
   ```bash
   # Check for playwright
   npx playwright --version 2>/dev/null
   # If not found, inform the user:
   # "live-preview needs Playwright for screenshots. Install with: npm i -D playwright"
   ```

### Step 3: VERIFY

For each screenshot:

1. Read the screenshot (vision). Check:
   - Does the component render? (not blank, not invisible)
   - Does it show real data or placeholder/empty states?
   - Are there obvious layout breaks (overlapping elements, overflow, missing sections)?
   - Does it match the intended design direction?
2. Record the result:
   - PASS: renders correctly, matches expectations
   - FAIL: describe what's wrong
   - BLANK: nothing rendered (critical failure)

### Step 4: FIX (if failures found)

For each FAIL or BLANK:

1. Diagnose: is it a data issue, a rendering issue, or a missing import?
2. Fix the root cause (not a band-aid)
3. Re-capture and re-verify
4. Maximum 2 fix attempts per component. If still failing, log it and move on.

### Step 5: ARTIFACT

Save verification artifacts:

1. Screenshots go to `.planning/screenshots/{campaign-slug}/` (if in a campaign)
   or `.planning/screenshots/` (if standalone)
2. Write a verification summary:
   ```markdown
   ## Visual Verification: {date}

   | Route | File Modified | Result | Notes |
   |-------|--------------|--------|-------|
   | /dashboard | Dashboard.tsx | PASS | Renders correctly |
   | /settings | SettingsPanel.tsx | FAIL → PASS | Fixed missing import, re-verified |
   | /profile | ProfileCard.tsx | BLANK → PASS | Component wasn't mounted, fixed export |
   ```

## Integration with Archon

When Archon delegates a build phase that modifies view files:

1. After the sub-agent completes, Archon invokes /live-preview on the modified routes
2. If any route is BLANK or FAIL, the phase is NOT marked complete
3. The fix cycle runs before proceeding to the next phase
4. This is part of Archon's Step 4 (Self-Correction) quality spot-check

## What This Prevents

- **Invisible features** (postmortem #17) — compiles but renders nothing
- **Layout regressions** — change in one component breaks another's layout
- **Empty states shipped as features** — data not connected, UI renders skeleton
- **"Works on my machine"** — screenshots are artifacts anyone can review

## Fringe Cases

- **Dev server is not running**: Offer to start it. Output: "Dev server not detected on localhost:{port}. Start it with `npm run dev` or equivalent, then re-run /live-preview." Do not attempt screenshots against a dead server.
- **Port is not 3000**: Check common alternatives (3001, 5173, 4173, 8080) before asking. Read `package.json` scripts for a `--port` flag or `PORT` env variable.
- **Screenshot tool unavailable** (Playwright not installed): Output what to check manually — list the modified routes, describe what each should render, and suggest installing Playwright: `npm i -D playwright`. Exit gracefully without crashing.
- **`.planning/screenshots/` does not exist**: Create the directory before writing artifacts. Never error on a missing output directory.
- **No view-layer files modified**: Exit immediately with "No view-layer files modified. Nothing to preview." This is expected and correct for non-UI repos.

## Contextual Gates

**Disclosure:** "Taking screenshots for visual verification. Images saved to `.planning/screenshots/`."
**Reversibility:** green — screenshots only; saves to `.planning/screenshots/`. No source files modified.
**Trust gates:**
- Any: full screenshot capture, verify, and fix workflow.

## Quality Gates

- Every modified view file must have a corresponding screenshot
- BLANK results are critical failures (never acceptable)
- Screenshots must be saved as artifacts (not just checked and discarded)
- Fix attempts capped at 2 per component (prevent infinite loops)

## Exit Protocol

```
---HANDOFF---
- Live Preview: {N} routes verified
- Results: {pass}/{total} passed
- Failures: {list of routes that failed and what was wrong}
- Screenshots: .planning/screenshots/{path}
- Reversibility: green — delete .planning/screenshots/ to remove artifacts; no source files modified
---
```
