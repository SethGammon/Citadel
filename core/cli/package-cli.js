'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const VERSION = require('../../package.json').version;
const EXIT = Object.freeze({ OK: 0, FAILURE: 1, USAGE: 64, UNAVAILABLE: 78 });
const CODE = Object.freeze({
  RUNTIME_NOT_FOUND: 'CITADEL_RUNTIME_NOT_FOUND',
  RUNTIME_AMBIGUOUS: 'CITADEL_RUNTIME_AMBIGUOUS',
  FEATURE_UNAVAILABLE: 'CITADEL_FEATURE_UNAVAILABLE',
  COMMAND_FAILED: 'CITADEL_COMMAND_FAILED',
});

const HELP = `Citadel ${VERSION}

Usage: citadel <command> [options]

Commands:
  install      Detect a local agent runtime and install Citadel
  doctor       Check package integrity and runtime availability
  update       Verify and apply a Citadel release archive
  rollback     Restore a backup made by the updater
  uninstall    Export project state and remove Citadel from a project
  pack         Inspect, verify, certify, install, or remove outcome Packs
  journey      Start or complete a receipt-backed Pack journey
  receipt      Verify an operation receipt offline
  fork         Run one operation through comparable isolated runtimes
  help         Show this help

Run citadel <command> --help for command-specific help.
`;

const COMMAND_HELP = Object.freeze({
  install: `Usage: citadel install [--runtime claude|codex] [--project-root PATH] [--dry-run] [--json]

Runtime is selected from --runtime, CITADEL_RUNTIME, project markers, or an
installed Claude Code or Codex command. Ambiguous detection fails closed.
`,
  doctor: 'Usage: citadel doctor [--project-root PATH] [--runtime claude|codex] [--json]\n',
  update: 'Usage: citadel update --archive <release.tar.gz> [--target PATH] [--apply] [--json]\n',
  rollback: 'Usage: citadel rollback <backup-path> --target PATH [--apply] [--json]\n',
  uninstall: 'Usage: citadel uninstall [PROJECT] [--project-root PATH] [--export-only] [--dry-run] [--json]\n',
  pack: 'Usage: citadel pack <list|inspect|verify|certify|install|installed|uninstall> [options]\n',
  journey: 'Usage: citadel journey <start|complete> --run-id ID [--pack NAME --runtime RUNTIME | --evidence FILE]\n',
  receipt: 'Usage: citadel receipt verify --input FILE [--public-key FILE]\n',
  fork: 'Usage: citadel fork <start|resume|status|compare|select|land|replay> [options]\n',
});

function has(args, flag) {
  return args.includes(flag);
}

function value(args, flag, fallback = null) {
  const inline = args.find((item) => item.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

function stripFlag(args, flag, takesValue = false) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === flag) {
      if (takesValue) index += 1;
      continue;
    }
    if (item.startsWith(`${flag}=`)) continue;
    output.push(item);
  }
  return output;
}

function normalizeRuntime(input) {
  const runtime = String(input || '').trim().toLowerCase();
  if (runtime === 'claude' || runtime === 'claude-code') return 'claude';
  if (runtime === 'codex') return 'codex';
  return null;
}

function commandAvailable(command, spawn = spawnSync) {
  const executable = process.platform === 'win32' ? 'where.exe' : command;
  const args = process.platform === 'win32' ? [command] : ['--version'];
  const result = spawn(executable, args, {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  });
  return !result.error && result.status === 0;
}

function markerRuntimes(projectRoot, fsImpl = fs) {
  const found = [];
  if (fsImpl.existsSync(path.join(projectRoot, '.claude'))) found.push('claude');
  if (fsImpl.existsSync(path.join(projectRoot, '.codex'))) found.push('codex');
  return found;
}

function runtimeError(code, candidates = []) {
  const messages = {
    [CODE.RUNTIME_NOT_FOUND]: 'Could not detect Claude Code or Codex. Install a runtime or pass --runtime.',
    [CODE.RUNTIME_AMBIGUOUS]: 'Both Claude Code and Codex are available. Pass --runtime to choose one.',
  };
  const error = new Error(messages[code]);
  error.code = code;
  error.candidates = candidates;
  return error;
}

function detectRuntime(args, options = {}) {
  const explicitRaw = value(args, '--runtime');
  if (explicitRaw !== null) {
    const explicit = normalizeRuntime(explicitRaw);
    if (!explicit) throw runtimeError(CODE.RUNTIME_NOT_FOUND, [explicitRaw]);
    return { runtime: explicit, source: 'argument' };
  }

  const fromEnvironment = normalizeRuntime((options.env || process.env).CITADEL_RUNTIME);
  if (fromEnvironment) return { runtime: fromEnvironment, source: 'environment' };

  const projectRoot = path.resolve(value(args, '--project-root', value(args, '--target-project', options.cwd || process.cwd())));
  const markers = markerRuntimes(projectRoot, options.fsImpl || fs);
  if (markers.length === 1) return { runtime: markers[0], source: 'project-marker' };
  if (markers.length > 1) throw runtimeError(CODE.RUNTIME_AMBIGUOUS, markers);

  const probe = options.probe || ((command) => commandAvailable(command, options.spawn || spawnSync));
  const available = [
    probe('claude') ? 'claude' : null,
    probe('codex') ? 'codex' : null,
  ].filter(Boolean);
  if (available.length === 1) return { runtime: available[0], source: 'command' };
  if (available.length > 1) throw runtimeError(CODE.RUNTIME_AMBIGUOUS, available);
  throw runtimeError(CODE.RUNTIME_NOT_FOUND);
}

function writeJson(io, valueToWrite) {
  io.stdout.write(`${JSON.stringify(valueToWrite, null, 2)}\n`);
}

function reportError(io, json, error, command) {
  const code = error.code || CODE.COMMAND_FAILED;
  const payload = { ok: false, command, code, message: error.message };
  if (error.candidates?.length) payload.candidates = error.candidates;
  if (json) writeJson(io, payload);
  else io.stderr.write(`citadel ${command}: ${error.message} [${code}]\n`);
  return error.exitCode || EXIT.FAILURE;
}

function child(script, args, options = {}) {
  const spawn = options.spawn || spawnSync;
  const json = Boolean(options.json);
  const result = spawn(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: options.cwd || process.cwd(),
    encoding: json ? 'utf8' : undefined,
    shell: false,
    stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (json) {
    if (result.stdout) options.io.stdout.write(result.stdout);
    if (result.stderr) options.io.stderr.write(result.stderr);
  }
  if (result.error) {
    const error = new Error(result.error.message);
    error.code = CODE.COMMAND_FAILED;
    throw error;
  }
  return Number.isInteger(result.status) ? result.status : EXIT.FAILURE;
}

function install(args, context) {
  const json = has(args, '--json');
  let detection;
  try {
    detection = detectRuntime(args, context);
  } catch (error) {
    return reportError(context.io, json, error, 'install');
  }
  let forwarded = stripFlag(args, '--runtime', true);
  forwarded = forwarded.filter((item) => !item.startsWith('--runtime='));
  if (detection.runtime === 'claude' && !has(forwarded, '--install') && !has(forwarded, '--add-marketplace')) {
    forwarded.push('--install', '--scope', 'local');
  }
  if (detection.runtime === 'codex' && !has(forwarded, '--plugin-only') && !has(forwarded, '--add-marketplace')) {
    forwarded.push('--add-marketplace');
  }
  if (!json) context.io.stdout.write(`Citadel selected ${detection.runtime} from ${detection.source}.\n`);
  try {
    return child('install.js', ['--runtime', detection.runtime, ...forwarded], { ...context, json });
  } catch (error) {
    return reportError(context.io, json, error, 'install');
  }
}

function doctorReport(args, context = {}) {
  const packageFiles = [
    'package.json', 'scripts/install.js', 'scripts/claude-install.js',
    'scripts/codex-install.js', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json',
  ];
  const fsImpl = context.fsImpl || fs;
  const checks = packageFiles.map((relative) => ({
    name: `package:${relative}`,
    pass: fsImpl.existsSync(path.join(ROOT, relative)),
  }));
  const major = Number(process.versions.node.split('.')[0]);
  checks.unshift({ name: 'node>=18', pass: major >= 18, value: process.versions.node });
  let detection = null;
  let runtimeErrorCode = null;
  try {
    detection = detectRuntime(args, context);
  } catch (error) {
    runtimeErrorCode = error.code;
  }
  checks.push({
    name: 'runtime-selection',
    pass: Boolean(detection),
    runtime: detection?.runtime || null,
    source: detection?.source || null,
    code: runtimeErrorCode,
  });
  if (detection) {
    const probe = context.probe || ((command) => commandAvailable(command, context.spawn || spawnSync));
    checks.push({
      name: 'runtime-command',
      pass: probe(detection.runtime === 'claude' ? 'claude' : 'codex'),
      runtime: detection.runtime,
    });
  }
  return { schema: 1, command: 'doctor', version: VERSION, pass: checks.every((check) => check.pass), checks };
}

function doctor(args, context) {
  const report = doctorReport(args, context);
  if (has(args, '--json')) writeJson(context.io, report);
  else {
    context.io.stdout.write(`Citadel doctor ${VERSION}\n`);
    for (const check of report.checks) context.io.stdout.write(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.runtime ? ` (${check.runtime})` : ''}\n`);
  }
  return report.pass ? EXIT.OK : EXIT.FAILURE;
}

function delegateUpdate(command, args, context) {
  const json = has(args, '--json');
  let forwarded = stripFlag(stripFlag(args, '--json'), '--dry-run');
  if (command === 'rollback' && !value(forwarded, '--rollback')) {
    if (!forwarded[0] || forwarded[0].startsWith('--')) {
      const error = new Error('rollback requires a backup path');
      error.code = CODE.COMMAND_FAILED;
      return reportError(context.io, json, error, command);
    }
    forwarded = ['--rollback', forwarded[0], ...forwarded.slice(1)];
  }
  try {
    return child('update.js', forwarded, { ...context, json });
  } catch (error) {
    return reportError(context.io, json, error, command);
  }
}

function uninstall(args, context) {
  const json = has(args, '--json');
  const dryRun = has(args, '--dry-run');
  const configured = value(args, '--project-root', value(args, '--target-project'));
  const positional = args.find((item, index) => !item.startsWith('-') && (index === 0 || !['--project-root', '--target-project'].includes(args[index - 1])));
  const projectRoot = path.resolve(configured || positional || context.cwd || process.cwd());
  const plan = {
    schema: 1,
    command: 'uninstall',
    project_root: projectRoot,
    export_only: has(args, '--export-only'),
    dry_run: dryRun,
    will_export_state: true,
    will_remove_harness: !has(args, '--export-only'),
  };
  if (dryRun) {
    if (json) writeJson(context.io, plan);
    else context.io.stdout.write(`Uninstall plan for ${projectRoot}\nState will be exported before removal.\n`);
    return EXIT.OK;
  }
  const forwarded = [projectRoot];
  if (plan.export_only) forwarded.push('--export-only');
  if (!json) return child('unharness.js', forwarded, { ...context, json: false });
  const result = (context.spawn || spawnSync)(process.execPath, [path.join(ROOT, 'scripts', 'unharness.js'), ...forwarded], {
    cwd: context.cwd || process.cwd(), encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  writeJson(context.io, { ...plan, ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' });
  return result.status ?? EXIT.FAILURE;
}

function unavailable(command, args, context) {
  if (has(args, '--help') || has(args, '-h')) {
    context.io.stdout.write(COMMAND_HELP[command]);
    return EXIT.OK;
  }
  const error = new Error(`${command} support is not available in Citadel ${VERSION}`);
  error.code = CODE.FEATURE_UNAVAILABLE;
  error.exitCode = EXIT.UNAVAILABLE;
  return reportError(context.io, has(args, '--json'), error, command);
}

function main(argv = process.argv.slice(2), options = {}) {
  const context = {
    io: options.io || { stdout: process.stdout, stderr: process.stderr },
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    fsImpl: options.fsImpl || fs,
    spawn: options.spawn || spawnSync,
    probe: options.probe,
  };
  const command = argv[0] || 'help';
  const args = argv.slice(1);
  if (command === 'help' || command === '--help' || command === '-h') {
    context.io.stdout.write(HELP);
    return EXIT.OK;
  }
  if (command === '--version' || command === 'version') {
    context.io.stdout.write(`${VERSION}\n`);
    return EXIT.OK;
  }
  if (COMMAND_HELP[command] && (has(args, '--help') || has(args, '-h'))) {
    context.io.stdout.write(COMMAND_HELP[command]);
    return EXIT.OK;
  }
  if (command === 'install') return install(args, context);
  if (command === 'doctor') return doctor(args, context);
  if (command === 'update' || command === 'rollback') return delegateUpdate(command, args, context);
  if (command === 'uninstall') return uninstall(args, context);
  if (command === 'pack') return child('packs.js', args, { ...context, json: has(args, '--json') });
  if (command === 'journey') return child('start-journey.js', args, { ...context, json: has(args, '--json') });
  if (command === 'receipt') return child('receipt.js', args, { ...context, json: has(args, '--json') });
  if (command === 'fork') return child('operation-fork.js', args, { ...context, json: true });
  const error = new Error(`unknown command: ${command}`);
  error.code = CODE.COMMAND_FAILED;
  error.exitCode = EXIT.USAGE;
  return reportError(context.io, has(args, '--json'), error, command);
}

module.exports = {
  CODE, COMMAND_HELP, EXIT, HELP, ROOT, VERSION,
  commandAvailable, detectRuntime, doctorReport, main, markerRuntimes, normalizeRuntime,
};
