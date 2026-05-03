---
name: qa
description: >-
  Browser-based QA verification. Launches a real browser, navigates the app,
  clicks buttons, fills forms, and tests user flows. Works as a standalone
  skill or as a phase end condition in campaigns. Requires Playwright
  (optional dependency, graceful skip if not installed).
user-invocable: true
auto-trigger: false
effort: high
---

# /qa — Browser QA Verification

## Identity

/qa tests your app the way a user would: by actually using it. It launches a
browser, navigates to pages, clicks buttons, fills forms, and verifies that
interactions work. Screenshots catch visual bugs. QA catches interaction bugs.

## Dependency: Playwright

/qa requires Playwright. It's an optional dependency.

**If Playwright is installed:** full browser QA works.
**If Playwright is NOT installed:** the skill offers to install it, or falls
back to /live-preview (screenshot-only verification).

Detection:
```bash
npx playwright --version 2>/dev/null
```

Installation (if user agrees):
```bash
npm install -D playwright
npx playwright install chromium
```

Only installs Chromium (smallest download, ~150MB). Not Firefox or WebKit
unless the user asks for cross-browser testing.

**/do setup integration:** During setup, if the project is a web app (has
React, Next.js, Vue, Svelte, or HTML files), offer to install Playwright:
"I see this is a web project. Want to enable browser QA testing? This installs
Playwright (~150MB) for interaction testing. (y/n)"

If they say no, /qa falls back to /live-preview. No pressure.

## When to Use

- After building a feature (verify it actually works in a browser)
- As a phase end condition: "QA verification passes for [flow]"
- When /do routes "qa", "test the app", "does it work", "click through it"
- When /create-app campaigns reach the verification phase
- After /live-preview shows something renders but you need to verify interactions

## Protocol

### Step 1: DISCOVER

Before testing, understand what to test:

1. Read the project's routes/pages (from file tree, router config, or package.json scripts)
2. Read the PRD or campaign file (if exists) for expected user flows
3. Identify testable flows:
   - Page loads and renders (baseline)
   - Navigation between pages
   - Form submissions
   - Button click handlers
   - Auth flows (login, logout, protected routes)
   - CRUD operations (create, read, update, delete)
   - Error states (invalid input, network errors)

If no PRD or campaign exists, ask: "What should I test? Give me 1-3 user flows."

### Step 2: START THE APP

Before testing, the app needs to be running:

1. Check if a dev server is already running (try curl localhost:3000, 5173, 8080)
2. If not running, check package.json for start/dev scripts
3. Start it: `npm run dev` or equivalent, in background
4. Wait for the server to be ready (poll the health endpoint or main URL)
5. If the app won't start, report the error and stop. Don't test a broken app.

Track whether the agent started the server. If so, kill it on completion.

### Step 3: TEST

For each flow identified in Step 1, write and run a Playwright script:

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate
  await page.goto('http://localhost:3000');

  // Verify page loaded
  const title = await page.title();

  // Test interactions
  await page.click('button[data-testid="add-todo"]');
  await page.fill('input[name="title"]', 'Test todo');
  await page.click('button[type="submit"]');

  // Verify result
  const todoText = await page.textContent('.todo-item:last-child');

  // Screenshot for evidence
  await page.screenshot({ path: '.planning/screenshots/qa-flow-1.png' });

  await browser.close();
})();
```

For each test:
- Navigate to the relevant page
- Perform the user action (click, fill, submit)
- Verify the expected outcome (element appears, text changes, navigation occurs)
- Take a screenshot as evidence
- Log: PASS or FAIL with description

### Step 4: REPORT

Write results to `.planning/qa-report-{date}.md`:

```markdown
# QA Report: {App Name or Feature}

> Date: {ISO date}
> Flows tested: {N}
> Passed: {N}
> Failed: {N}
> Screenshots: .planning/screenshots/qa-*.png

## Results

### Flow 1: {description}
- Steps: {what was done}
- Expected: {what should happen}
- Actual: {what did happen}
- Result: PASS / FAIL
- Screenshot: {path}
- Notes: {any observations}

### Flow 2: ...
```

### Step 5: CAMPAIGN INTEGRATION

When running as a phase end condition:

The campaign file can specify QA conditions:
```
| 3 | qa_verify | /qa passes for: add todo, complete todo, delete todo |
```

/qa reads the condition, runs those specific flows, and reports pass/fail.
The phase is complete only if all specified flows pass.

## Cookie and Auth Support

For apps with authentication:

1. First run the auth flow: navigate to login, fill credentials, submit
2. Save the browser context (cookies + localStorage state)
3. Use the saved context for all subsequent tests
4. This means authenticated flows work without re-logging-in per test

Test credentials should come from `.env.example` or the campaign file.
NEVER read from `.env` (protected by the hook). Use test accounts only.

## Fallback: No Playwright

If Playwright isn't installed and the user declines installation:

1. Fall back to /live-preview (screenshot-only)
2. Report: "Browser QA unavailable (Playwright not installed). Visual verification only."
3. Take screenshots of each page that would have been tested
4. Mark interaction tests as SKIPPED, visual tests as PASS/FAIL

## What /qa Does NOT Do

- Install Playwright without asking
- Test in production (localhost only, unless user explicitly provides a URL)
- Replace unit/integration tests (this is user-flow testing, not code testing)
- Run on every edit (too expensive — invoked explicitly or as phase end condition)
- Access .env files (uses .env.example or test credentials from campaign)

## Quality Gates

- Every tested flow has all fields filled (steps, expected, actual, result)
- Screenshots are taken for every flow (pass or fail)
- Failed flows have enough detail to reproduce the issue
- The app is actually running before tests execute (not testing a dead server)

## Fringe Cases

**Playwright not installed and user declines**: Fall back to /live-preview. Mark all interaction tests as SKIPPED in the report. Visual-only verification still runs.

**Dev server won't start**: Report the startup error and stop. Do not attempt to test a server that isn't running. Suggest the user fix the startup error first.

**No routes or pages discoverable**: Ask the user for 1-3 flows to test. Do not guess at routes.

**No UI (API-only project)**: Report "No UI detected — /qa requires a browser-accessible interface. Use typecheck and unit tests for API verification." Then stop gracefully.

**If .planning/screenshots/ does not exist**: Create it before saving screenshots. If `.planning/` doesn't exist, save screenshots to a `qa-screenshots/` directory in the project root and note the path in the report.

## Contextual Gates

**Disclosure:** May start a dev server; saves screenshots and report to `.planning/`. States server ownership before starting.
**Reversibility:** amber — creates report and screenshots; dev server stopped only if this skill started it. Delete generated files to undo.
**Trust gates:** Any. Familiar (5+) to run against external/production URLs.

## Exit Protocol

```
---HANDOFF---
- QA Report: .planning/qa-report-{date}.md
- Flows tested: {N}
- Passed: {N} | Failed: {N} | Skipped: {N}
- Screenshots: .planning/screenshots/qa-*.png
- Server: {started by agent (killed) | was already running (left running)}
- Reversibility: amber — delete `.planning/qa-report-{date}.md` and `screenshots/qa-*.png` to undo
---
```
