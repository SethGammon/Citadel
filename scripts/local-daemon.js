#!/usr/bin/env node

/**
 * local-daemon.js -- Quota-free replacement for /daemon start.
 *
 * Cross-platform Node port of scripts/daemon-tick.ps1. Spawns a fresh
 * `claude -p "/do continue"` subprocess, waits for it to finish, applies a
 * cooldown, and repeats until daemon.json reports the daemon is no longer
 * running (campaign completed, budget exhausted, level-up pending, etc).
 *
 * The SessionStart hook (init-project.js) reads .planning/daemon.json on
 * every session start and instructs Archon to continue, so this loop just
 * needs to spawn blank sessions at the right cadence. It does NOT use
 * RemoteTrigger, so it consumes zero Anthropic routine quota.
 *
 * Usage:
 *   node scripts/local-daemon.js                   # Default 60s cooldown
 *   node scripts/local-daemon.js --cooldown 30     # 30s between sessions
 *   node scripts/local-daemon.js --max-sessions 10 # Safety cap
 *   node scripts/local-daemon.js --dry-run         # Print what it would do
 *
 * Start with `/daemon start` first (or manually populate daemon.json) to
 * establish the campaign and budget. This runner only drives the tick loop.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DAEMON_PATH = path.join(ROOT, '.planning', 'daemon.json');
const LOG_PATH = path.join(ROOT, '.planning', 'daemon-runs.log');

const args = process.argv.slice(2);
const opts = {
    cooldown: parseInt(getFlag('--cooldown', '60'), 10) * 1000,
    maxSessions: parseInt(getFlag('--max-sessions', '0'), 10),
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h'),
};

function getFlag(name, fallback) {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    return args[i + 1] ?? fallback;
}

if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).join('\n').replace(/^ \*\/?/gm, ''));
    process.exit(0);
}

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch { /* ignore */ }
}

function readDaemon() {
    if (!fs.existsSync(DAEMON_PATH)) return null;
    try { return JSON.parse(fs.readFileSync(DAEMON_PATH, 'utf8')); }
    catch (e) { log(`daemon.json parse error: ${e.message}`); return null; }
}

function runSession() {
    return new Promise((resolve) => {
        const cmd = 'claude';
        const cliArgs = ['--dangerously-skip-permissions', '-p', '/do continue'];
        if (opts.dryRun) {
            log(`DRY RUN would spawn: ${cmd} ${cliArgs.join(' ')}`);
            return resolve(0);
        }
        const proc = spawn(cmd, cliArgs, {
            cwd: ROOT,
            stdio: 'inherit',
            env: { ...process.env, CLAUDE_NON_INTERACTIVE: '1' },
            shell: process.platform === 'win32',
        });
        proc.on('close', (code) => resolve(code ?? 0));
        proc.on('error', (err) => { log(`spawn error: ${err.message}`); resolve(1); });
    });
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
    log(`local-daemon starting. root=${ROOT} cooldown=${opts.cooldown}ms`);
    let sessions = 0;
    while (true) {
        const state = readDaemon();
        if (!state) { log('No daemon.json found. Exiting.'); break; }
        if (state.status !== 'running') {
            log(`Daemon status is "${state.status}". Reason: ${state.stopReason ?? 'n/a'}. Exiting.`);
            break;
        }
        if (opts.maxSessions > 0 && sessions >= opts.maxSessions) {
            log(`Reached --max-sessions (${opts.maxSessions}). Exiting.`);
            break;
        }
        sessions += 1;
        log(`Starting session #${sessions} (daemon session count: ${state.sessionCount ?? 0})`);
        const code = await runSession();
        log(`Session #${sessions} exited with code ${code}`);
        log(`Cooldown ${opts.cooldown / 1000}s...`);
        await sleep(opts.cooldown);
    }
    log(`local-daemon stopped after ${sessions} session(s).`);
}

main().catch((err) => { log(`fatal: ${err.stack ?? err.message}`); process.exit(1); });

process.on('SIGINT', () => { log('received SIGINT, stopping after current session'); process.exit(0); });
