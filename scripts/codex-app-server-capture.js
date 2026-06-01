#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  buildAppServerApprovalResponse,
  createAppServerProbe,
  verifyAppServerCapture,
  writeAppServerDashboard,
} = require('../core/codex/native-integrations');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultOutPath(projectRoot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(projectRoot, '.planning', 'app-server', `capture-${stamp}.jsonl`);
}

function resolveCodexInvocation(codexBin) {
  if (codexBin) return { command: codexBin, prefixArgs: [], shell: process.platform === 'win32' };
  if (process.platform === 'win32' && process.env.APPDATA) {
    const codexJs = path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (fs.existsSync(codexJs)) {
      return { command: process.execPath, prefixArgs: [codexJs], shell: false };
    }
  }
  return { command: 'codex', prefixArgs: [], shell: process.platform === 'win32' };
}

function jsonl(messages) {
  return messages.map((msg) => JSON.stringify(msg)).join('\n') + (messages.length ? '\n' : '');
}

function sandboxPolicyFor(value, projectRoot) {
  if (!value) return null;
  if (value === 'readOnly') return { type: 'readOnly' };
  if (value === 'workspaceWrite') {
    return {
      type: 'workspaceWrite',
      writableRoots: [projectRoot],
      networkAccess: false,
    };
  }
  if (value === 'dangerFullAccess') return { type: 'dangerFullAccess' };
  throw new Error(`Unsupported --turn-sandbox value: ${value}`);
}

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/codex-app-server-capture.js [--project-root PATH] [--out PATH] [--handshake-only] [--turn "prompt"]');
  console.log('       [--turn-file PATH] [--turn-approval-policy on-request|untrusted|granular|never] [--turn-sandbox readOnly|workspaceWrite]');
  console.log('       [--expect-approval] [--approval-decision decline|cancel|accept|acceptForSession]');
  console.log('       node scripts/codex-app-server-capture.js --dry-run');
  process.exit(0);
}

const projectRoot = path.resolve(arg('--project-root', process.cwd()));
const listen = arg('--listen', 'stdio://');
const outPath = path.resolve(arg('--out', defaultOutPath(projectRoot)));
const requestsPath = path.resolve(arg('--requests-out', outPath.replace(/\.jsonl$/i, '.requests.jsonl')));
const timeoutMs = Number(arg('--timeout-ms', 15000));
const settleMs = Number(arg('--settle-ms', 750));
const startThread = !process.argv.includes('--handshake-only');
const turnFile = arg('--turn-file', null);
const turnText = turnFile ? fs.readFileSync(turnFile, 'utf8') : arg('--turn', null);
const approvalDecision = arg('--approval-decision', 'decline');
const expectApproval = process.argv.includes('--expect-approval');
const turnApprovalPolicy = arg('--turn-approval-policy', null);
const turnSandbox = arg('--turn-sandbox', null);
const turnSandboxPolicy = sandboxPolicyFor(turnSandbox, projectRoot);

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({
    ...createAppServerProbe({ listen }),
    projectRoot,
    outPath,
    requestsPath,
    startThread,
    startsTurn: Boolean(turnText),
    approvalDecision,
    expectApproval,
    turnApprovalPolicy,
    turnSandbox,
    timeoutMs,
  }, null, 2));
  process.exit(0);
}

if (listen !== 'stdio://') {
  console.error('Live capture currently supports stdio:// only. Use codex-app-server-probe.js for WebSocket or Unix socket probes.');
  process.exit(1);
}

const invocation = resolveCodexInvocation(arg('--codex-bin', null));
const proc = spawn(invocation.command, [...invocation.prefixArgs, 'app-server'], {
  cwd: projectRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: invocation.shell,
});

const serverMessages = [];
const clientMessages = [];
const stderrChunks = [];
const ignoredStdout = [];
const approvalResponses = [];
const unhandledServerRequests = [];
let stdoutBuffer = '';
let finished = false;
let threadId = null;
let timeoutHandle = null;
let finishHandle = null;

function send(message) {
  clientMessages.push(message);
  proc.stdin.write(`${JSON.stringify(message)}\n`);
}

function scheduleFinish(reason) {
  if (finishHandle || finished) return;
  finishHandle = setTimeout(() => finish(reason), settleMs);
}

function finish(reason) {
  if (finished) return;
  finished = true;
  clearTimeout(timeoutHandle);
  clearTimeout(finishHandle);
  try {
    proc.stdin.end();
  } catch {}
  try {
    proc.kill();
  } catch {}

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, jsonl(serverMessages), 'utf8');
  ensureDir(path.dirname(requestsPath));
  fs.writeFileSync(requestsPath, jsonl(clientMessages), 'utf8');
  const verification = verifyAppServerCapture(serverMessages, {
    requireThread: startThread,
    requireTurn: Boolean(turnText),
    requireTurnCompleted: Boolean(turnText),
    requireApproval: expectApproval,
  });
  const dashboard = writeAppServerDashboard({
    projectRoot,
    source: outPath,
    summary: verification.summary,
  });

  const report = {
    pass: verification.pass,
    reason,
    projectRoot,
    outPath,
    requestsPath,
    dashboardPath: dashboard.dashboardPath,
    summaryPath: dashboard.summaryPath,
    serverMessages: serverMessages.length,
    clientMessages: clientMessages.length,
    approvalResponses,
    unhandledServerRequests,
    ignoredStdout,
    stderr: stderrChunks.join('').slice(0, 4000),
    verification,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () => {
    process.exit(verification.pass ? 0 : 1);
  });
}

function handleMessage(msg) {
  serverMessages.push(msg);
  const approvalResponse = buildAppServerApprovalResponse(msg, { decision: approvalDecision });
  if (approvalResponse) {
    approvalResponses.push({
      requestId: msg.id,
      method: msg.method,
      itemId: msg.params?.itemId || null,
      decision: approvalResponse.result?.decision || approvalResponse.result,
    });
    send(approvalResponse);
    return;
  }
  if (msg.id !== undefined && msg.method) {
    unhandledServerRequests.push({
      id: msg.id,
      method: msg.method,
    });
  }
  if (msg.id === 1 && msg.result) {
    send({ method: 'initialized', params: {} });
    if (startThread) {
      send({ method: 'thread/start', id: 2, params: { cwd: projectRoot } });
    } else {
      scheduleFinish('initialize-complete');
    }
  }

  if (msg.id === 2 && msg.result?.thread?.id) {
    threadId = msg.result.thread.id;
    if (turnText) {
      const params = {
        threadId,
        input: [{ type: 'text', text: turnText }],
      };
      if (turnApprovalPolicy) params.approvalPolicy = turnApprovalPolicy;
      if (turnSandboxPolicy) params.sandboxPolicy = turnSandboxPolicy;
      send({
        method: 'turn/start',
        id: 3,
        params,
      });
    } else {
      scheduleFinish('thread-started');
    }
  }

  if (turnText && msg.method === 'turn/completed') {
    scheduleFinish('turn-completed');
  }
}

proc.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk.toString();
  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() || '';
  for (const line of lines.filter(Boolean)) {
    try {
      handleMessage(JSON.parse(line));
    } catch {
      ignoredStdout.push(line.slice(0, 500));
    }
  }
});

proc.stderr.on('data', (chunk) => {
  stderrChunks.push(chunk.toString());
});

proc.on('error', (err) => {
  stderrChunks.push(err.message);
  finish('spawn-error');
});

proc.on('exit', () => {
  if (!finished && serverMessages.length > 0) finish('process-exit');
});

timeoutHandle = setTimeout(() => {
  finish('timeout');
}, timeoutMs);

send({
  method: 'initialize',
  id: 1,
  params: {
    clientInfo: {
      name: 'citadel_app_server_capture',
      title: 'Citadel App Server Capture',
      version: '0.1.0',
    },
  },
});
