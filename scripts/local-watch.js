#!/usr/bin/env node

/**
 * local-watch.js -- Quota-free replacement for /watch start.
 *
 * Real-time filesystem watcher that triggers scripts/watch.js --scan on
 * debounced change events. Uses built-in fs.watch (no external deps) in
 * recursive mode. Works on Windows and macOS natively; on Linux, falls back
 * to a polling loop at the configured interval.
 *
 * Unlike CronCreate, this does not consume Anthropic routine quota.
 *
 * Usage:
 *   node scripts/local-watch.js              # Watch with default 2s debounce
 *   node scripts/local-watch.js --debounce 5 # 5s debounce between scans
 *   node scripts/local-watch.js --poll 30    # Force polling mode, 30s interval
 *   node scripts/local-watch.js --intake     # Generate intake items on scan
 *   node scripts/local-watch.js --once       # Run one scan and exit
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const SCAN_SCRIPT = path.join(__dirname, 'watch.js');

const args = process.argv.slice(2);
const opts = {
    debounce: parseInt(getFlag('--debounce', '2'), 10) * 1000,
    poll: parseInt(getFlag('--poll', '0'), 10) * 1000,
    intake: args.includes('--intake'),
    once: args.includes('--once'),
    help: args.includes('--help') || args.includes('-h'),
};

function getFlag(name, fallback) {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    return args[i + 1] ?? fallback;
}

if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 20).join('\n').replace(/^ \*\/?/gm, ''));
    process.exit(0);
}

const IGNORED = /(^|[\\/])(\.git|node_modules|\.planning|dist|build|\.next|coverage)([\\/]|$)/;

function runScan() {
    const scanArgs = ['--scan'];
    if (opts.intake) scanArgs.push('--intake');
    const proc = spawn(process.execPath, [SCAN_SCRIPT, ...scanArgs], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    });
    return new Promise((resolve) => proc.on('close', resolve));
}

if (opts.once) {
    runScan().then((code) => process.exit(code ?? 0));
    return;
}

let pending = null;
let scanning = false;

function schedule() {
    if (pending) return;
    pending = setTimeout(async () => {
        pending = null;
        if (scanning) { schedule(); return; }
        scanning = true;
        try { await runScan(); } finally { scanning = false; }
    }, opts.debounce);
}

console.log(`[local-watch] root: ${ROOT}`);
console.log(`[local-watch] debounce: ${opts.debounce}ms  intake: ${opts.intake}`);

// fs.watch recursive works on Windows and macOS. On Linux, recursive is not
// supported -- fall back to polling.
const supportsRecursive = process.platform === 'win32' || process.platform === 'darwin';

if (supportsRecursive && opts.poll === 0) {
    console.log('[local-watch] mode: filesystem events (recursive)');
    try {
        fs.watch(ROOT, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            if (IGNORED.test(filename)) return;
            schedule();
        });
    } catch (err) {
        console.error(`[local-watch] fs.watch failed: ${err.message}. Falling back to polling.`);
        startPolling(30000);
    }
} else {
    const interval = opts.poll || 30000;
    console.log(`[local-watch] mode: polling every ${interval / 1000}s`);
    startPolling(interval);
}

function startPolling(ms) {
    setInterval(async () => {
        if (scanning) return;
        scanning = true;
        try { await runScan(); } finally { scanning = false; }
    }, ms);
}

// Run an initial scan so the user sees immediate output
schedule();

process.on('SIGINT', () => { console.log('\n[local-watch] stopped'); process.exit(0); });
