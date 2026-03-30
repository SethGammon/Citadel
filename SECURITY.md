# Security

This document describes Citadel's security model and defensive measures against common attack vectors.

## Threat Model

Citadel hooks run in the same security context as Claude Code itself. The primary threats are:

1. **Path Traversal** — Malicious or confused agents attempting to access files outside the project root
2. **Shell Injection** — Command injection via unsanitized user/agent input in shell commands
3. **Secret Leakage** — Agents inadvertently reading .env files or other credential stores
4. **Untracked Dependencies** — Installing packages not declared in version control

## Defenses

### 1. Path Traversal Protection (`protect-files.js`)

All file operations (Read/Write/Edit) are validated before execution:

```javascript
// Blocks: ../../../etc/passwd
// Blocks: /etc/passwd (absolute path outside project)
// Allows: src/components/Button.tsx (relative to project root)
```

**Implementation:**
- Regex-based detection of `../` and `..\` sequences
- Absolute path validation against `PROJECT_ROOT`
- Fail-closed design: unexpected errors block the action

**Test coverage:** `scripts/test-security.js` validates traversal attacks are blocked

### 2. Shell Injection Prevention

All git operations use `execFileSync` with array arguments instead of shell strings:

```javascript
// ✅ Safe (no shell interpretation):
execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })

// ❌ Vulnerable (shell injection risk):
execSync(`git rev-parse ${branch}`)  // if branch = "; rm -rf /"
```

**Files using execFileSync:**
- `quality-gate.js` — git operations for lint checks
- `harness-health-util.js` — git status queries
- `post-edit.js` — file tracking

**Test coverage:** `scripts/test-security.js` verifies safe APIs are used

### 3. Secret Protection

`.env` files and variants (`.env.local`, `.env.production`, etc.) are blocked from Read operations:

```javascript
// Blocks: .env, .env.local, .env.production
// Allows: README.md, src/config.ts
```

**Rationale:** Prevents accidental credential leakage in agent conversations or logs.

**Test coverage:** `scripts/test-security.js` validates .env reads are blocked

### 4. Pip Gate (Untracked Dependencies)

Before allowing `pip install`, checks if `requirements.txt` is tracked by git:

```javascript
// ✅ Allows: pip install when requirements.txt is committed
// ⚠️  Warns:  pip install when requirements.txt exists but is untracked
// ✅ Allows: pip install when no requirements.txt exists yet
```

**Rationale:** Prevents dependency drift and ensures reproducible builds.

**Implementation:** `quality-gate.js` checks `git ls-files requirements.txt`

## Test Suite

### Run Security Tests

```bash
# Security tests only
node scripts/test-security.js

# Full suite (includes security)
node scripts/test-all.js
```

### What Gets Tested

1. **Path Traversal**
   - `../../../etc/passwd` → blocked
   - `/etc/passwd` → blocked
   - `src/file.ts` → allowed

2. **Shell Injection**
   - Verify `execFileSync` usage (safe)
   - Reject `execSync` usage (unsafe)
   - Validate git commands use array args

3. **Secret Protection**
   - `.env` reads → blocked
   - Regular file reads → allowed

4. **Glob Pattern Security**
   - `secrets/**` patterns work correctly
   - Recursive `**` globs match expected files

### Exit Codes

- `0` — All tests pass
- `1` — One or more tests failed (DO NOT SHIP)

## Fail-Closed Design

All security hooks follow a **fail-closed** approach:

- Unexpected errors → **block** the action (exit 2)
- Parse failures → **block** the action
- Missing validation → **block** the action

This prevents security bypasses via error conditions.

## Reporting Vulnerabilities

If you discover a security issue:

1. **Do not** open a public GitHub issue
2. Email: security@citadel.dev (or create private security advisory)
3. Include: steps to reproduce, impact assessment, suggested fix

We'll respond within 48 hours and coordinate disclosure timing.

## Audit Log

All security-relevant events are logged to `.planning/telemetry/audit.jsonl`:

```json
{
  "schema": 1,
  "event": "blocked",
  "hook": "protect-files",
  "reason": "path traversal sequence",
  "file": "../../../etc/passwd",
  "timestamp": "2026-03-30T12:05:00.000Z"
}
```

Use this log for forensic analysis and security monitoring.

## Security Checklist for New Hooks

When adding a new hook that handles user/agent input:

- [ ] Use `health.validatePath()` for all file paths
- [ ] Use `health.validateCommand()` for all shell commands
- [ ] Use `execFileSync` with array args (not `execSync` or `exec`)
- [ ] Fail closed: unexpected errors exit 2 (block), not 0 (allow)
- [ ] Add test cases to `scripts/test-security.js`
- [ ] Document security assumptions in hook header comment

## Further Reading

- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [Shell Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
- [Principle of Least Privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege)
