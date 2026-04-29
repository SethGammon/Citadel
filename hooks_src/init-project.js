#!/usr/bin/env node

/**
 * init-project.js — SessionStart hook
 *
 * Auto-scaffolds per-project Citadel state on first use.
 * Copies templates and utility scripts from the plugin root.
 * Idempotent — skips existing directories, overwrites scripts
 * to keep them in sync with plugin version.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const PLANNING_DIRS = [
  '.planning',
  '.planning/campaigns',
  '.planning/campaigns/completed',
  '.planning/coordination',
  '.planning/coordination/instances',
  '.planning/coordination/claims',
  '.planning/discoveries',
  '.planning/fleet',
  '.planning/fleet/briefs',
  '.planning/fleet/outputs',
  '.planning/intake',
  '.planning/postmortems',
  '.planning/research',
  '.planning/screenshots',
  '.planning/telemetry',
];

function shouldSyncScripts() {
  try {
    const pkgPath = path.join(PLUGIN_ROOT, 'package.json');
    if (!fs.existsSync(pkgPath)) return true; // can't determine — sync to be safe
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const pluginVersion = pkg.version || '0.0.0';

    const versionFile = path.join(PROJECT_ROOT, '.citadel', 'version.txt');
    if (!fs.existsSync(versionFile)) return true;

    const installedVersion = fs.readFileSync(versionFile, 'utf8').trim();
    return installedVersion !== pluginVersion;
  } catch {
    return true; // on any error, sync to be safe
  }
}

function writeVersionFile(pluginRoot, projectRoot) {
  try {
    const pkgPath = path.join(pluginRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    fs.writeFileSync(path.join(projectRoot, '.citadel', 'version.txt'), pkg.version || '0.0.0');
  } catch { /* non-fatal */ }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy files from src to dest, but only if they don't already exist.
 * Preserves user customizations to templates.
 */
function copyDirIfMissing(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirIfMissing(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Generate a thin delegate wrapper that forwards execution to the real script
 * in the Citadel install. This avoids copying scripts that import from
 * ../core/ and ../runtimes/ — paths that only exist inside the Citadel repo.
 */
function generateDelegate(scriptName) {
  return (
    "#!/usr/bin/env node\n" +
    "'use strict';\n" +
    "const { spawnSync } = require('child_process');\n" +
    "const fs = require('fs');\n" +
    "const path = require('path');\n" +
    "const pluginRoot = fs.readFileSync(path.join(__dirname, '..', 'plugin-root.txt'), 'utf8').trim();\n" +
    "const real = path.join(pluginRoot, 'scripts', " + JSON.stringify(scriptName) + ");\n" +
    "const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });\n" +
    "process.exit(r.status ?? 0);\n"
  );
}

function main() {
  try {
    // 1. Create .planning/ directory tree
    for (const dir of PLANNING_DIRS) {
      ensureDir(path.join(PROJECT_ROOT, dir));
    }

    // 1b. Sweep stale coordination claims from crashed sessions
    try {
      const coordScript = path.join(PROJECT_ROOT, '.citadel', 'scripts', 'coordination.js');
      const sweepScript = path.join(PLUGIN_ROOT, 'scripts', 'coordination.js');
      const script = fs.existsSync(coordScript) ? coordScript : sweepScript;
      if (fs.existsSync(script)) {
        require('child_process').spawnSync('node', [script, 'sweep'], {
          cwd: PROJECT_ROOT,
          env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
          timeout: 5000,
        });
      }
    } catch { /* non-fatal — don't block session start */ }

    // 2. Copy templates from plugin to project (only if missing or version changed)
    const pluginTemplates = path.join(PLUGIN_ROOT, '.planning', '_templates');
    const projectTemplates = path.join(PROJECT_ROOT, '.planning', '_templates');
    if (fs.existsSync(pluginTemplates)) {
      copyDirIfMissing(pluginTemplates, projectTemplates);
    }

    // 3. Copy intake template if missing
    const intakeTemplate = path.join(PROJECT_ROOT, '.planning', 'intake', '_TEMPLATE.md');
    const pluginIntakeTemplate = path.join(PLUGIN_ROOT, '.planning', 'intake', '_TEMPLATE.md');
    if (!fs.existsSync(intakeTemplate) && fs.existsSync(pluginIntakeTemplate)) {
      fs.copyFileSync(pluginIntakeTemplate, intakeTemplate);
    }

    // 4. Sync utility scripts to .citadel/scripts/ (version-gated to avoid unnecessary I/O)
    //
    // Scripts are generated as thin delegates rather than copied verbatim.
    // Copied scripts import from ../core/ and ../runtimes/ which only exist
    // inside the Citadel install, not inside the target project. Delegates
    // read plugin-root.txt at runtime and spawn the real script via the
    // Citadel install, so imports always resolve correctly.
    if (shouldSyncScripts()) {
      const pluginScripts = path.join(PLUGIN_ROOT, 'scripts');
      const projectScripts = path.join(PROJECT_ROOT, '.citadel', 'scripts');
      if (fs.existsSync(pluginScripts)) {
        ensureDir(projectScripts);
        for (const file of fs.readdirSync(pluginScripts)) {
          if (file.endsWith('.js') || file.endsWith('.cjs')) {
            fs.writeFileSync(
              path.join(projectScripts, file),
              generateDelegate(file)
            );
          }
        }
      }
      writeVersionFile(PLUGIN_ROOT, PROJECT_ROOT);
    }

    // 5. Copy agent-context if missing
    const agentContext = path.join(PROJECT_ROOT, '.claude', 'agent-context');
    const pluginAgentContext = path.join(PLUGIN_ROOT, '.claude', 'agent-context');
    if (!fs.existsSync(agentContext) && fs.existsSync(pluginAgentContext)) {
      copyDirRecursive(pluginAgentContext, agentContext);
    }

    // 6. Write .citadel-root marker (plugin path for reference)
    const citadelDir = path.join(PROJECT_ROOT, '.citadel');
    ensureDir(citadelDir);
    fs.writeFileSync(
      path.join(citadelDir, 'plugin-root.txt'),
      PLUGIN_ROOT
    );

    // 7. Watchdog — check for stale command results from a previous session
    checkStaleCommandResult();

    // 8. Daemon bootstrap — detect active daemon and prompt continuation
    checkDaemonState();

  } catch (err) {
    // Non-fatal — don't block session start
    process.exit(0);
  }
}

/**
 * Watchdog: check for stale command results from a previous session.
 *
 * If last-command-result.json exists and is older than 10 minutes,
 * the previous session may have completed a command that wasn't seen.
 * Surface it so the user knows what happened.
 */
function checkStaleCommandResult() {
  try {
    const resultPath = path.join(PROJECT_ROOT, '.planning', 'telemetry', 'last-command-result.json');
    if (!fs.existsSync(resultPath)) return;

    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (!result.timestamp) return;

    const ageMs = Date.now() - new Date(result.timestamp).getTime();
    const STALE_THRESHOLD = 10 * 60 * 1000; // 10 minutes

    if (ageMs > STALE_THRESHOLD) {
      const ageMins = Math.round(ageMs / 60000);
      const exitCode = result.exitCode !== null && result.exitCode !== undefined ? result.exitCode : 'unknown';
      const duration = result.durationSec || '?';
      const cmd = (result.command || 'unknown').slice(0, 100);

      const parts = [`[watchdog] A previous command completed ${ageMins}m ago but may not have been seen.`];
      parts.push(`  Command: ${cmd}`);
      parts.push(`  Exit code: ${exitCode}, duration: ${duration}s`);

      if (result.timedOut) {
        parts.push(`  NOTE: This command was killed by timeout after ${result.timeoutLimit}s.`);
      }

      parts.push(`  Check .planning/telemetry/last-command-result.json for details.`);

      process.stdout.write(parts.join('\n') + '\n');

      // Clean up so we don't warn again
      fs.unlinkSync(resultPath);
    }
  } catch {
    // Non-fatal — don't block session start
  }
}

/**
 * Daemon bridge: if a daemon is running, notify the user.
 *
 * Interactive sessions (user at the keyboard) get a notification only --
 * no tokens spent without explicit intent. The user runs /do continue.
 *
 * Non-interactive sessions (claude -p, RemoteTrigger, cron) get a command
 * the agent acts on automatically -- that's the overnight-factory use case.
 */
function checkDaemonState() {
  try {
    const daemonPath = path.join(PROJECT_ROOT, '.planning', 'daemon.json');
    if (!fs.existsSync(daemonPath)) return;

    const daemon = JSON.parse(fs.readFileSync(daemonPath, 'utf8'));

    // Only bootstrap if daemon is actively running
    if (daemon.status !== 'running') return;

    // Lock check: if another session is active (lastTickAt within 2 min), don't overlap
    if (daemon.lastTickAt && daemon.lastTickStatus === 'running') {
      const elapsed = Date.now() - new Date(daemon.lastTickAt).getTime();
      if (elapsed < 120000) return; // another session is working
    }

    // Budget check: don't start if budget exhausted
    if (typeof daemon.budget === 'number' && daemon.estimatedSpend >= daemon.budget) return;

    // Campaign check: verify campaign is still active
    const slug = daemon.campaignSlug;
    if (!slug) return;
    const campaignPath = path.join(PROJECT_ROOT, '.planning', 'campaigns', `${slug}.md`);
    const campaignExists = fs.existsSync(campaignPath);
    const campaignActive = campaignExists
      && /status:\s*active/i.test(fs.readFileSync(campaignPath, 'utf8'));

    if (!campaignActive) {
      // Campaign is done but daemon.json still says running -- stop the daemon.
      // This prevents idle loops where sessions spawn, find no work, and exit.
      try {
        daemon.status = 'stopped';
        daemon.stoppedAt = new Date().toISOString();
        daemon.stopReason = 'no-active-work';
        fs.writeFileSync(daemonPath, JSON.stringify(daemon, null, 2));
        process.stdout.write(
          `[daemon] Stopped -- campaign "${slug}" is no longer active. ` +
          `Reason: ${campaignExists ? 'campaign completed/parked' : 'campaign file not found'}.\n`
        );
      } catch { /* non-fatal */ }
      return;
    }

    // All gates pass -- determine session type
    const remaining = typeof daemon.budget === 'number'
      ? ` Budget: $${daemon.estimatedSpend}/$${daemon.budget}.`
      : '';
    const sessions = daemon.sessionCount || 0;

    // Non-interactive: CLAUDE_NON_INTERACTIVE env var set by the scheduled task script.
    // Auto-execute is appropriate here (cron, RemoteTrigger, overnight factory).
    // Note: process.argv won't contain parent's -p flag -- hooks are child processes.
    const isNonInteractive = process.env.CLAUDE_NON_INTERACTIVE === '1';

    if (isNonInteractive) {
      process.stdout.write(
        `[daemon] Active campaign: ${slug} (session #${sessions + 1}).${remaining}\n` +
        `Run: /do continue\n`
      );
    } else {
      // Interactive: notify only. No tokens spent without explicit intent.
      process.stdout.write(
        `[daemon] Active campaign: ${slug} (loop ${daemon.log ? daemon.log.length + 1 : '?'} pending)${remaining}\n` +
        `  Run /do continue to resume, or /daemon stop to cancel.\n`
      );
    }
  } catch {
    // Non-fatal — if daemon state is corrupt, don't block session start
  }
}

main();
