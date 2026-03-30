# PR: Security fixes — shell injection, path traversal, and supply chain risks

**Branch:** `security/fix-injection-risks`
**Target:** `main`

---

## Summary

Security audit identified 2 high-severity and 3 medium-severity issues across
5 files. All fixes are surgical, backwards-compatible, and all existing tests pass.

---

## Fixes

### 🔴 HIGH: Shell injection via `execSync(templateString)` — `scripts/watch.js`

`execSync(string)` passes its argument to `/bin/sh -c`, making any interpolated
variable a potential injection vector. `lastCommit` (from `git rev-parse HEAD`) was
interpolated directly:

```js
// Before — shell-interpolated, dangerous
execSync(`git diff --name-only ${lastCommit} HEAD`)
```

If `lastCommit` contains shell metacharacters (e.g. from a poisoned `.git/HEAD`
or `ORIG_HEAD` in a malicious repository), arbitrary commands could execute.

```js
// After — array args, bypasses shell entirely
execFileSync('git', ['diff', '--name-only', lastCommit, 'HEAD'])
```

All `gitExec()` calls converted to `execFileSync` with array arguments.

---

### 🔴 HIGH: Path traversal not blocked by `validatePath()` — `hooks_src/harness-health-util.js`

`validatePath()` only checked for shell metacharacters. A path like
`../../etc/shadow` would return `{ safe: true }`. Hook code passes validated paths
to typecheck tools (`mypy`, `tsc`, `go vet`), which would process the traversed path.

```js
// Added to _validateInput for label === 'path':
const PATH_TRAVERSAL_RE = /\.\.[/\\]/;
// paths containing ../ or ..\ are now rejected
```

---

### 🟡 MEDIUM: `stripQuotedContent()` missed single-quoted `$(...)` and backticks — `hooks_src/external-action-gate.js`

The function only stripped double-quoted `$(...)` subshells before running
blocked-pattern checks. Single-quoted subshells and backtick expressions were not
neutralised, creating potential bypasses for the `.env` exfiltration detection.

Added two new stripping passes (before generic string stripping):
1. Single-quoted subshells: `'$(...)'` → `''`
2. Backtick subshells: `` `...` `` → ` `` `

---

### 🟡 MEDIUM: Campaign filename injected unsanitized into LLM-facing messages — `hooks_src/protect-files.js`

Campaign filenames (agent-writable) were rendered directly into hook output
messages that Claude reads. An adversarially-named campaign file could inject
instructions into the agent's context.

```js
// Before
campaignName = file.replace(/\.md$/, '');

// After — only alphanumeric, hyphens, underscores allowed
campaignName = rawName.replace(/[^a-zA-Z0-9_\-]/g, '_');
```

---

### 🟡 MEDIUM: Auto `pip install` without verifying `requirements.txt` provenance — `hooks_src/worktree-setup.js`

`worktree-setup.js` ran `pip install -r requirements.txt` automatically when a
worktree contained that file. Agents can write `requirements.txt`. A malicious
package with code in `setup.py` or `__init__.py` would execute on the developer's
machine during worktree setup — a supply chain attack vector.

**Fix:** Check if `requirements.txt` is tracked in git before installing. Untracked
files trigger a warning and skip install. Opt-out via `CITADEL_ALLOW_UNTRACKED_PIP=true`
(for greenfield projects where the file hasn't been committed yet).

---

## Testing

```bash
node scripts/test-all.js  # PASS — hook smoke test, skill lint, demo routing check
```

No existing behaviour changed for the common case (clean git repos, tracked files,
non-adversarial inputs).

---

## How this was found

Manual security audit. All findings were reasoned from first principles and code review,
cross-validated against OWASP and Node.js security best practices.
