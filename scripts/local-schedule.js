#!/usr/bin/env node

/**
 * local-schedule.js -- Quota-free replacement for /schedule add.
 *
 * Installs scheduled tasks using the host OS's native scheduler (Windows
 * Task Scheduler or Unix cron) rather than Anthropic's CronCreate. Does not
 * consume routine quota. Survives session end, machine sleep (wakes the
 * system if configured), and reboots.
 *
 * Each scheduled task runs:
 *   claude --plugin-dir <project-root> --dangerously-skip-permissions -p "<command>"
 *
 * Usage:
 *   node scripts/local-schedule.js add "<cron-or-human>" "<claude-command>"
 *   node scripts/local-schedule.js add "every 30m" "/pr-watch"
 *   node scripts/local-schedule.js add "0 9 * * *" "/do continue"
 *   node scripts/local-schedule.js list
 *   node scripts/local-schedule.js remove <id>
 *
 * IDs are prefixed `citadel-` on both platforms so they're easy to find.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const IS_WIN = process.platform === 'win32';

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).join('\n').replace(/^ \*\/?/gm, ''));
    process.exit(cmd ? 0 : 1);
}

function toCron(expr) {
    const t = expr.trim().toLowerCase();
    const map = {
        'every minute': '* * * * *',
        'every 5m': '*/5 * * * *', 'every 5 minutes': '*/5 * * * *',
        'every 15m': '*/15 * * * *', 'every 15 minutes': '*/15 * * * *',
        'every 30m': '*/30 * * * *', 'every 30 minutes': '*/30 * * * *',
        'hourly': '0 * * * *', 'every hour': '0 * * * *',
        'every 2h': '0 */2 * * *', 'every 2 hours': '0 */2 * * *',
        'every 6h': '0 */6 * * *', 'every 6 hours': '0 */6 * * *',
        'daily': '0 9 * * *', 'every day': '0 9 * * *',
        'every weekday': '0 9 * * 1-5',
    };
    if (map[t]) return map[t];
    if (/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(expr.trim())) return expr.trim();
    throw new Error(`Could not parse schedule "${expr}". Use a 5-field cron expression or a phrase like "every 30m".`);
}

function newId() {
    return `citadel-${crypto.randomBytes(4).toString('hex')}`;
}

function claudeInvocation(claudeCommand) {
    const plugin = ROOT.replace(/"/g, '\\"');
    return `claude --plugin-dir "${plugin}" --dangerously-skip-permissions -p "${claudeCommand.replace(/"/g, '\\"')}"`;
}

// --- Windows: schtasks -------------------------------------------------------

function winAdd(cronExpr, claudeCommand) {
    const parts = cronExpr.split(/\s+/);
    const [minute, hour] = parts;
    const id = newId();
    const invocation = claudeInvocation(claudeCommand);
    // schtasks supports basic minute/hourly/daily triggers. For arbitrary cron,
    // we map common cases. Complex expressions are approximated to MINUTE.
    let schtasksArgs;
    if (parts.join(' ') === '* * * * *') {
        schtasksArgs = ['/Create', '/SC', 'MINUTE', '/MO', '1', '/TN', id, '/TR', `cmd /c cd /d "${ROOT}" && ${invocation}`, '/F'];
    } else if (/^\*\/\d+$/.test(minute) && hour === '*') {
        const mo = minute.slice(2);
        schtasksArgs = ['/Create', '/SC', 'MINUTE', '/MO', mo, '/TN', id, '/TR', `cmd /c cd /d "${ROOT}" && ${invocation}`, '/F'];
    } else if (minute === '0' && /^\*\/\d+$/.test(hour)) {
        schtasksArgs = ['/Create', '/SC', 'HOURLY', '/MO', hour.slice(2), '/TN', id, '/TR', `cmd /c cd /d "${ROOT}" && ${invocation}`, '/F'];
    } else if (minute === '0' && /^\d+$/.test(hour)) {
        schtasksArgs = ['/Create', '/SC', 'DAILY', '/ST', `${hour.padStart(2, '0')}:00`, '/TN', id, '/TR', `cmd /c cd /d "${ROOT}" && ${invocation}`, '/F'];
    } else {
        throw new Error(`Windows Task Scheduler mapping not supported for "${cronExpr}". Use: every {N}m, every {N}h, or daily at {H}.`);
    }
    execFileSync('schtasks', schtasksArgs, { stdio: 'inherit' });
    console.log(`Scheduled. ID: ${id}`);
    console.log(`Remove with: node scripts/local-schedule.js remove ${id}`);
}

function winList() {
    const out = spawnSync('schtasks', ['/Query', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const lines = (out.stdout || '').split('\n').filter((l) => l.includes('citadel-'));
    if (!lines.length) { console.log('No Citadel schedules found.'); return; }
    for (const line of lines) console.log(line.trim());
}

function winRemove(id) {
    execFileSync('schtasks', ['/Delete', '/TN', id, '/F'], { stdio: 'inherit' });
    console.log(`Removed ${id}`);
}

// --- Unix: crontab -----------------------------------------------------------

const CRON_MARKER_START = '# CITADEL-SCHEDULES-START';
const CRON_MARKER_END = '# CITADEL-SCHEDULES-END';

function readCrontab() {
    const r = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout : '';
}

function writeCrontab(content) {
    const r = spawnSync('crontab', ['-'], { input: content, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`crontab install failed: ${r.stderr}`);
}

function unixAdd(cronExpr, claudeCommand) {
    const id = newId();
    const current = readCrontab();
    const line = `${cronExpr} cd "${ROOT}" && ${claudeInvocation(claudeCommand)} # ${id}`;
    let updated;
    if (current.includes(CRON_MARKER_START)) {
        updated = current.replace(CRON_MARKER_END, `${line}\n${CRON_MARKER_END}`);
    } else {
        updated = current + (current.endsWith('\n') || !current ? '' : '\n') +
            `${CRON_MARKER_START}\n${line}\n${CRON_MARKER_END}\n`;
    }
    writeCrontab(updated);
    console.log(`Scheduled. ID: ${id}`);
    console.log(`Remove with: node scripts/local-schedule.js remove ${id}`);
}

function unixList() {
    const current = readCrontab();
    const lines = current.split('\n').filter((l) => l.includes('# citadel-'));
    if (!lines.length) { console.log('No Citadel schedules found.'); return; }
    for (const line of lines) console.log(line);
}

function unixRemove(id) {
    const current = readCrontab();
    const updated = current.split('\n').filter((l) => !l.includes(`# ${id}`)).join('\n');
    writeCrontab(updated);
    console.log(`Removed ${id}`);
}

// --- Dispatch ----------------------------------------------------------------

try {
    if (cmd === 'add') {
        const [expr, claudeCommand] = rest;
        if (!expr || !claudeCommand) { console.error('Usage: add "<cron>" "<claude command>"'); process.exit(1); }
        const cron = toCron(expr);
        console.log(`Installing: ${cron} -> ${claudeCommand}`);
        IS_WIN ? winAdd(cron, claudeCommand) : unixAdd(cron, claudeCommand);
    } else if (cmd === 'list') {
        IS_WIN ? winList() : unixList();
    } else if (cmd === 'remove') {
        const id = rest[0];
        if (!id) { console.error('Usage: remove <id>'); process.exit(1); }
        IS_WIN ? winRemove(id) : unixRemove(id);
    } else {
        console.error(`Unknown command: ${cmd}. Use add|list|remove.`);
        process.exit(1);
    }
} catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
}
