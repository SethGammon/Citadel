#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { createIntegrityRecord } = require('../telemetry/integrity');
const { createLoopContract } = require('../loops/contract');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'item';
}

function nowIso(options = {}) {
  return options.now || new Date().toISOString();
}

function planningDir(projectRoot, ...parts) {
  return path.join(projectRoot || process.cwd(), '.planning', ...parts);
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, 'utf8');
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n', 'utf8');
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function readJsonIfExists(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const json = options.allowLineComment ? raw.replace(/^\/\/.*\n/, '') : raw;
  return JSON.parse(json);
}

function createAutomationPlan(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const type = options.type || 'schedule';
  const command = options.command || '/do status';
  const cadence = options.cadence || options.interval || 'manual';
  const id = options.id || `codex-${type}-${slugify(command)}-${nowIso(options).replace(/[:.]/g, '-')}`;
  const target = options.target || (type === 'daemon' ? 'background-worktree' : 'local-project');

  const prompts = {
    schedule: `Create a Codex automation for ${projectRoot}. On ${cadence}, run: ${command}. Record the result in .planning/codex-automations/${id}.json and summarize any action taken.`,
    daemon: `Create a Codex automation that continues Citadel daemon work for ${projectRoot}. Each run should read .planning/daemon.json, continue only when the daemon is running, respect budget gates, and append a run summary to .planning/codex-automations/${id}.json.`,
    'pr-watch': `Create a Codex automation for PR monitoring in ${projectRoot}. On ${cadence}, inspect the PR checks and review comments, apply safe targeted fixes only when confidence is high, and record each run in .planning/codex-automations/${id}.json.`,
  };

  const plan = {
    id,
    type,
    projectRoot,
    target,
    cadence,
    command,
    surface: 'codex-app-automation',
    prompt: prompts[type] || prompts.schedule,
    improvesOnLocalOnly: [
      'Codex owns the schedule instead of relying on a live terminal loop.',
      'Citadel still keeps the durable run log in .planning.',
      'The prompt is explicit enough to recreate the automation without re-explaining the harness.',
    ],
    status: 'planned',
    createdAt: nowIso(options),
    runs: [],
  };

  const loop = createLoopContract({
    id: `loop-${id}`,
    type: `codex-${type}`,
    title: `Codex automation: ${type}`,
    goal: command,
    command,
    cadence,
    triggerKind: 'codex-automation',
    verifierProfile: type,
    maxAttempts: type === 'pr-watch' ? 3 : 1,
    statePath: path.join('.planning', 'codex-automations', `${id}.json`).replace(/\\/g, '/'),
    stopConditions: type === 'daemon'
      ? ['done', 'budget-exhausted', 'no-active-work', 'needs-human-review']
      : ['done', 'blocked', 'needs-human-review', 'attempt-limit'],
    now: options.now,
  });
  plan.loopId = loop.id;
  plan.loopType = loop.type;
  plan.loopTitle = loop.title;
  plan.loopStatus = loop.status;
  plan.loopBudget = loop.budget;
  plan.loopVerifier = loop.verifier;
  plan.loopStopConditions = loop.stopConditions;

  if (options.write) {
    writeJson(path.join(planningDir(projectRoot, 'codex-automations'), `${id}.json`), plan);
  }
  return plan;
}

function recordAutomationRun(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const id = options.id;
  if (!id) throw new Error('recordAutomationRun requires id');

  const filePath = path.join(planningDir(projectRoot, 'codex-automations'), `${id}.json`);
  const plan = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
    : createAutomationPlan({ ...options, id, write: false });

  const run = {
    status: options.status || 'recorded',
    summary: options.summary || '',
    evidence: options.evidence || [],
    recordedAt: nowIso(options),
  };
  plan.status = run.status;
  plan.runs = [...(plan.runs || []), run];
  writeJson(filePath, plan);
  return plan;
}

function createPrReviewPlan(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const prNumber = options.prNumber || options.pr || 'current';
  const repo = options.repo || 'current-repo';
  const risk = options.risk || 'medium';
  const changedFiles = Number(options.changedFiles || 0);

  let decision = 'codex-review';
  const reasons = ['Codex GitHub review is native and reads AGENTS.md review guidance.'];
  if (risk === 'high' || changedFiles > 20) {
    decision = 'combined';
    reasons.push('High-risk or large PRs still need Citadel local review and verification state.');
  } else if (risk === 'local-only') {
    decision = 'local-review';
    reasons.push('The work depends on local state or unpushed changes Codex GitHub review cannot see.');
  }

  const plan = {
    repo,
    prNumber,
    decision,
    risk,
    changedFiles,
    command: decision === 'local-review' ? `/triage pr ${prNumber}` : '@codex review',
    followUpPrompt: decision === 'combined'
      ? `@codex review this PR. Focus on P0/P1 correctness and security issues. Citadel will also run local verification.`
      : `@codex review this PR. Follow the AGENTS.md review guidelines and focus comments on actionable P0/P1 issues.`,
    capturePath: path.join('.planning', 'pr-review', `${slugify(repo)}-${prNumber}.json`),
    reasons,
    improvesOnLocalOnly: [
      'Uses Codex native PR review for GitHub-visible diffs.',
      'Keeps Citadel responsible for merge readiness, local verification, and follow-up state.',
    ],
    createdAt: nowIso(options),
  };

  if (options.write) {
    writeJson(path.join(projectRoot, plan.capturePath), plan);
  }
  return plan;
}

function recordPrReviewResult(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const repo = options.repo || 'current-repo';
  const prNumber = options.prNumber || options.pr || 'current';
  const filePath = path.join(planningDir(projectRoot, 'pr-review'), `${slugify(repo)}-${prNumber}.json`);
  const current = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
    : createPrReviewPlan({ projectRoot, repo, prNumber });
  current.results = [...(current.results || []), {
    source: options.source || 'codex-review',
    status: options.status || 'recorded',
    summary: options.summary || '',
    recordedAt: nowIso(options),
  }];
  writeJson(filePath, current);
  return current;
}

function recordAppArtifact(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const artifact = createIntegrityRecord({
    schema: 1,
    kind: options.kind || 'artifact',
    path: options.path,
    workflow: options.workflow || 'qa',
    route: options.route || null,
    status: options.status || 'recorded',
    note: options.note || '',
    codexAppUse: options.codexAppUse || 'Open in the Codex app artifact viewer or in-app browser for review.',
    recordedAt: nowIso(options),
  }, {
    run_id: options.run_id,
    agent_id: options.agent_id,
    task_id: options.task_id,
    artifact_id: options.artifact_id,
    parent_id: options.parent_id,
    source_event_id: options.source_event_id,
    hmacKey: options.hmacKey,
    hmacKeyId: options.hmacKeyId,
  });
  if (!artifact.path) throw new Error('recordAppArtifact requires path');
  appendJsonl(path.join(planningDir(projectRoot, 'artifacts'), 'codex-app-evidence.jsonl'), artifact);
  return artifact;
}

function readAppArtifacts(projectRoot = process.cwd()) {
  const filePath = path.join(planningDir(path.resolve(projectRoot), 'artifacts'), 'codex-app-evidence.jsonl');
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function verifyAppArtifacts(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const artifacts = readAppArtifacts(projectRoot);
  const allowedStatuses = new Set(['pass', 'fail', 'skipped', 'recorded', 'planned']);
  const checks = [];

  for (const artifact of artifacts) {
    const artifactPath = path.isAbsolute(artifact.path)
      ? artifact.path
      : path.join(projectRoot, artifact.path || '');
    checks.push({
      id: `path:${artifact.path}`,
      pass: Boolean(artifact.path) && (!options.requireExistingPaths || fs.existsSync(artifactPath)),
      detail: fs.existsSync(artifactPath) ? 'exists' : 'missing',
    });
    checks.push({
      id: `status:${artifact.path}`,
      pass: allowedStatuses.has(artifact.status),
      detail: artifact.status,
    });
  }

  if (artifacts.length === 0) {
    checks.push({
      id: 'manifest',
      pass: !options.requireArtifacts,
      detail: 'no Codex app artifacts recorded',
    });
  }

  return {
    projectRoot,
    count: artifacts.length,
    checks,
    pass: checks.every((check) => check.pass),
  };
}

function createPluginMarketplace(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const pluginName = options.pluginName || 'citadel';
  const marketplacePath = path.join(projectRoot, '.agents', 'plugins', 'marketplace.json');
  const pluginPath = options.pluginPath || './.agents';
  const displayName = options.displayName || 'Citadel Harness';
  const pluginRoot = path.join(projectRoot, pluginPath.replace(/^\.\//, ''));
  const pluginManifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  const marketplace = {
    name: options.marketplaceName || 'citadel-local',
    interface: {
      displayName: options.marketplaceDisplayName || 'Citadel Local Plugins',
    },
    plugins: [
      {
        name: pluginName,
        source: {
          source: 'local',
          path: pluginPath,
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Developer Tools',
        interface: {
          displayName,
        },
      },
    ],
  };

  const checks = [
    {
      id: 'plugin-manifest',
      pass: fs.existsSync(pluginManifestPath),
      detail: pluginManifestPath,
    },
    {
      id: 'source-path-relative',
      pass: pluginPath.startsWith('./') && !pluginPath.includes('..'),
      detail: pluginPath,
    },
  ];

  const result = {
    projectRoot,
    marketplacePath,
    marketplace,
    checks,
    pass: checks.every((check) => check.pass),
    codexCliCommands: [
      `codex plugin marketplace add ${projectRoot}`,
      'codex plugin marketplace --help',
      'codex',
      '/plugins',
    ],
    codexAppSteps: [
      'Restart Codex after adding or changing the local marketplace.',
      'Open Plugins, select the Citadel Local Plugins marketplace, and install Citadel Harness.',
      'Start a new thread and explicitly invoke Citadel or one of its bundled skills if needed.',
    ],
  };

  if (options.write) {
    writeJson(marketplacePath, marketplace);
  }
  return result;
}

function buildGitHubReviewFetchCommands(options = {}) {
  const repo = options.repo;
  const prNumber = options.prNumber || options.pr;
  if (!repo || !prNumber) throw new Error('buildGitHubReviewFetchCommands requires repo and prNumber');
  return [
    ['gh', ['api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate']],
    ['gh', ['api', `repos/${repo}/pulls/${prNumber}/comments`, '--paginate']],
    ['gh', ['api', `repos/${repo}/pulls/${prNumber}/reviews`, '--paginate']],
  ];
}

function normalizeReviewItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.comments)) return raw.comments;
  if (Array.isArray(raw.reviews)) return raw.reviews;
  if (Array.isArray(raw.items)) return raw.items;
  return [raw];
}

function itemAuthor(item) {
  return item.author?.login || item.user?.login || item.user || item.author || '';
}

function itemBody(item) {
  return item.body || item.comment || item.review || item.message || '';
}

function looksLikeCodexReviewItem(item, authorHint = 'codex') {
  const author = String(itemAuthor(item)).toLowerCase();
  const body = String(itemBody(item)).toLowerCase();
  const hint = String(authorHint || 'codex').toLowerCase();
  return author.includes(hint) || body.includes('@codex') || body.includes('codex review');
}

function severityForBody(body) {
  const match = String(body || '').match(/\b(P0|P1|P2|P3)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function ingestCodexReview(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const repo = options.repo || 'current-repo';
  const prNumber = options.prNumber || options.pr || 'current';
  const authorHint = options.authorHint || 'codex';
  const raw = typeof options.input === 'string' ? JSON.parse(options.input) : (options.input || []);
  const allItems = normalizeReviewItems(raw);
  const findings = allItems
    .filter((item) => looksLikeCodexReviewItem(item, authorHint))
    .map((item) => {
      const body = itemBody(item);
      return {
        id: item.id || item.node_id || null,
        source: item.source || item.type || 'github-review',
        author: itemAuthor(item),
        severity: severityForBody(body),
        path: item.path || null,
        line: item.line || item.original_line || null,
        url: item.html_url || item.url || null,
        body,
      };
    });

  const counts = findings.reduce((acc, finding) => {
    const key = finding.severity || 'unclassified';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const nextActions = [];
  if ((counts.P0 || 0) + (counts.P1 || 0) > 0) {
    nextActions.push('Run local Citadel verification before merge.');
    nextActions.push(`Consider commenting "@codex fix the P1/P0 issue" only after confirming the finding belongs.`);
  }
  if (findings.length === 0) {
    nextActions.push('No Codex review findings were detected in the provided input.');
  }

  const result = {
    repo,
    prNumber,
    source: 'codex-github-review',
    ingestedAt: nowIso(options),
    totalItems: allItems.length,
    codexItems: findings.length,
    counts,
    findings,
    nextActions,
  };

  if (options.write) {
    const filePath = path.join(planningDir(projectRoot, 'pr-review'), `${slugify(repo)}-${prNumber}.json`);
    const current = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
      : createPrReviewPlan({ projectRoot, repo, prNumber });
    current.codexReview = result;
    current.results = [...(current.results || []), {
      source: 'codex-github-review',
      status: findings.length > 0 ? 'findings' : 'clean',
      summary: `${findings.length} Codex review finding(s) ingested`,
      recordedAt: result.ingestedAt,
    }];
    writeJson(filePath, current);
  }

  return result;
}

function buildCodexExecArgs(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const sandbox = options.sandbox || 'read-only';
  const args = ['exec'];

  if (options.resumeSessionId || options.resumeLast) {
    args.push('resume');
    args.push('--cd', projectRoot);
    if (options.resumeLast) args.push('--last');
    if (options.resumeSessionId) args.push(options.resumeSessionId);
    if (options.prompt) args.push(options.prompt);
    return args;
  }

  args.push('--cd', projectRoot);
  args.push('--sandbox', sandbox);
  args.push('--color', 'never');
  args.push('--skip-git-repo-check');
  if (options.json !== false) args.push('--json');
  if (options.model) args.push('--model', options.model);
  if (options.profile) args.push('--profile', options.profile);
  if (options.outputLastMessagePath) args.push('--output-last-message', options.outputLastMessagePath);
  if (options.allowHookTrust) args.push('--dangerously-bypass-hook-trust');
  args.push(options.prompt || 'Run the benchmark scenario and report the result.');
  return args;
}

function createFleetExecutionPlan(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const plan = {
    mode: options.mode || 'codex-subagents',
    projectRoot,
    waveSize: Number(options.waveSize || 3),
    nativeAgentDir: path.join('.codex', 'agents'),
    nativeWorktreeSurface: 'Codex app worktrees when available; Citadel worktrees as CLI fallback.',
    citadelValueLayer: ['campaign state', 'discovery relay', 'scope claims', 'merge-review'],
    prompt: 'Use projected .codex/agents for specialized subagents. Preserve Citadel .planning state and discovery relay across waves.',
    createdAt: nowIso(options),
  };
  if (options.write) {
    writeJson(path.join(planningDir(projectRoot, 'fleet'), 'codex-native-plan.json'), plan);
  }
  return plan;
}

function detectWindowsCodexSetup(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const configPath = options.configPath || path.join(projectRoot, '.codex', 'config.toml');
  const config = readTextIfExists(configPath);
  const isWindows = platform === 'win32';
  const isWsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  const sandboxMatch = config.match(/^\s*sandbox\s*=\s*"(elevated|unelevated)"/m);
  const hasNativeSandboxMode = Boolean(sandboxMatch);
  const shellLooksWindowsSafe = /agent_shell\s*=\s*"git-bash"/.test(config) || /powershell|pwsh|bash/i.test(config);

  const checks = [
    {
      id: 'platform',
      pass: isWindows || isWsl,
      detail: isWindows ? 'native Windows' : (isWsl ? 'WSL2-like environment' : platform),
    },
    {
      id: 'windows-sandbox',
      pass: !isWindows || hasNativeSandboxMode,
      detail: sandboxMatch ? sandboxMatch[1] : 'missing [windows] sandbox = "elevated" or "unelevated"',
    },
    {
      id: 'shell',
      pass: !isWindows || shellLooksWindowsSafe,
      detail: shellLooksWindowsSafe ? 'Codex shell configuration found' : 'no Windows-safe shell hint found',
    },
  ];

  return {
    projectRoot,
    isWindows,
    isWsl,
    configPath,
    checks,
    pass: checks.every((check) => check.pass),
    recommendation: isWindows
      ? 'Prefer [windows] sandbox = "elevated"; use "unelevated" only when elevated setup is blocked.'
      : 'Native Windows sandbox checks are advisory outside Windows.',
  };
}

function createAppServerProbe(options = {}) {
  const listen = options.listen || 'stdio://';
  const args = ['app-server', '--listen', listen];
  if (options.wsAuth) args.push('--ws-auth', options.wsAuth);
  if (options.wsTokenFile) args.push('--ws-token-file', path.resolve(options.wsTokenFile));

  return {
    command: 'codex',
    args,
    localOnly: listen === 'stdio://' || listen.startsWith('unix://') || listen.startsWith('ws://127.0.0.1') || listen.startsWith('ws://localhost'),
    warning: listen.startsWith('ws://') && !options.wsAuth
      ? 'WebSocket app-server probes should use a local listener or explicit auth.'
      : null,
    improvesOnScraping: 'App-server emits structured protocol events instead of requiring terminal scraping.',
  };
}

function parseAppServerMessages(input) {
  if (Array.isArray(input)) return input;
  return String(input || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function summarizeAppServerEvents(input) {
  const lines = parseAppServerMessages(input);
  const summary = {
    messageCount: lines.length,
    threads: new Set(),
    turns: new Set(),
    approvals: 0,
    commandOutputBytes: 0,
    fileChanges: 0,
    methods: {},
  };

  for (const msg of lines) {
    const method = msg.method || 'response';
    summary.methods[method] = (summary.methods[method] || 0) + 1;
    const params = msg.params || {};
    const threadId = params.threadId || params.thread?.id || msg.result?.thread?.id;
    const turnId = params.turnId || params.turn?.id || msg.result?.turn?.id;
    if (threadId) summary.threads.add(threadId);
    if (turnId) summary.turns.add(turnId);
    if (method.startsWith('serverRequest/') || method.toLowerCase().includes('approval')) summary.approvals += 1;
    if (method === 'item/commandExecution/outputDelta') {
      summary.commandOutputBytes += String(params.delta || params.text || '').length;
    }
    if (method.startsWith('item/fileChange') || method === 'turn/diff/updated') {
      summary.fileChanges += 1;
    }
  }

  return {
    ...summary,
    threads: [...summary.threads],
    turns: [...summary.turns],
    usefulForDashboard: summary.messageCount > 0 && (summary.threads.size > 0 || Object.keys(summary.methods).length > 0),
  };
}

function isAppServerApprovalRequest(msg) {
  return Boolean(
    msg
    && msg.id !== undefined
    && (
      msg.method === 'item/commandExecution/requestApproval'
      || msg.method === 'item/fileChange/requestApproval'
    ),
  );
}

function normalizeAvailableApprovalDecisions(availableDecisions) {
  if (!Array.isArray(availableDecisions)) return null;
  return availableDecisions
    .map((entry) => (typeof entry === 'string' ? entry : entry?.type || entry?.decision || entry?.id))
    .filter(Boolean);
}

function normalizeAppServerApprovalDecision(decision, availableDecisions) {
  const requested = decision || 'decline';
  const allowed = ['accept', 'acceptForSession', 'decline', 'cancel'];
  if (!allowed.includes(requested)) {
    throw new Error(`Unsupported app-server approval decision: ${requested}`);
  }
  const available = normalizeAvailableApprovalDecisions(availableDecisions);
  if (!available || available.length === 0 || available.includes(requested)) return requested;
  for (const fallback of ['decline', 'cancel']) {
    if (available.includes(fallback)) return fallback;
  }
  return available[0];
}

function buildAppServerApprovalResponse(msg, options = {}) {
  if (!isAppServerApprovalRequest(msg)) return null;
  const decision = normalizeAppServerApprovalDecision(options.decision || 'decline', msg.params?.availableDecisions);
  if (msg.method === 'item/fileChange/requestApproval') {
    return {
      id: msg.id,
      result: { decision },
    };
  }
  return {
    id: msg.id,
    result: decision,
  };
}

function verifyAppServerCapture(input, options = {}) {
  let messages;
  const checks = [];
  const add = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail });

  try {
    messages = parseAppServerMessages(input);
    add('jsonl-readable', true, `${messages.length} message(s)`);
  } catch (err) {
    add('jsonl-readable', false, err.message);
    return {
      pass: false,
      checks,
      summary: summarizeAppServerEvents([]),
    };
  }

  const initializeId = Number(options.initializeId || 1);
  const threadStartId = Number(options.threadStartId || 2);
  const turnStartId = Number(options.turnStartId || 3);
  const requireThread = options.requireThread !== false;
  const requireTurn = Boolean(options.requireTurn);
  const requireTurnCompleted = Boolean(options.requireTurnCompleted);
  const requireApproval = Boolean(options.requireApproval);
  const initializeResponse = messages.find((msg) => msg.id === initializeId && msg.result);
  add(
    'initialize-response',
    initializeResponse && (initializeResponse.result.userAgent || initializeResponse.result.platformFamily),
    initializeResponse ? 'initialize result received' : `missing response id ${initializeId}`,
  );

  if (requireThread) {
    const threadResponse = messages.find((msg) => msg.id === threadStartId && msg.result?.thread?.id);
    const threadNotification = messages.find((msg) => msg.method === 'thread/started');
    add(
      'thread-start-response',
      threadResponse,
      threadResponse ? threadResponse.result.thread.id : `missing response id ${threadStartId}`,
    );
    add(
      'thread-started-notification',
      threadNotification,
      threadNotification ? threadNotification.params?.thread?.id : 'missing thread/started notification',
    );
  }

  if (requireTurn) {
    const turnResponse = messages.find((msg) => msg.id === turnStartId && !msg.error);
    const turnStarted = messages.find((msg) => msg.method === 'turn/started');
    add(
      'turn-start-response',
      turnResponse,
      turnResponse ? `response id ${turnStartId}` : `missing response id ${turnStartId}`,
    );
    add(
      'turn-started-notification',
      turnStarted,
      turnStarted ? turnStarted.params?.turn?.id : 'missing turn/started notification',
    );
  }

  if (requireTurnCompleted) {
    const turnCompleted = messages.find((msg) => msg.method === 'turn/completed');
    add(
      'turn-completed-notification',
      turnCompleted,
      turnCompleted ? (turnCompleted.params?.turn?.status || 'completed') : 'missing turn/completed notification',
    );
  }

  if (requireApproval) {
    const approvalRequest = messages.find((msg) => isAppServerApprovalRequest(msg));
    add(
      'approval-request',
      approvalRequest,
      approvalRequest ? `${approvalRequest.method} id ${approvalRequest.id}` : 'missing command/file approval request',
    );
  }

  const summary = summarizeAppServerEvents(messages);
  add(
    'dashboard-useful',
    summary.usefulForDashboard,
    summary.usefulForDashboard ? `${summary.messageCount} message(s)` : 'capture has no dashboard signal',
  );

  return {
    pass: checks.every((check) => check.pass),
    checks,
    summary,
  };
}

function renderAppServerDashboard(summary, options = {}) {
  const rows = Object.entries(summary.methods || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([method, count]) => `<tr><td>${escapeHtml(method)}</td><td>${count}</td></tr>`)
    .join('\n');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>Citadel Codex App-Server Dashboard</title>',
    '<style>',
    'body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:32px;max-width:960px;color:#17202a;background:#f8fafc}',
    'main{display:grid;gap:24px}',
    'section{background:#fff;border:1px solid #d8dee8;border-radius:8px;padding:20px}',
    'dl{display:grid;grid-template-columns:180px 1fr;gap:8px 16px}',
    'dt{font-weight:650;color:#39485a}dd{margin:0}',
    'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e5e9f0;padding:8px;text-align:left}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>Codex App-Server Event Summary</h1>`,
    '<section>',
    '<dl>',
    `<dt>Source</dt><dd>${escapeHtml(options.source || 'app-server JSONL')}</dd>`,
    `<dt>Messages</dt><dd>${summary.messageCount}</dd>`,
    `<dt>Threads</dt><dd>${escapeHtml(summary.threads.join(', ') || 'none')}</dd>`,
    `<dt>Turns</dt><dd>${escapeHtml(summary.turns.join(', ') || 'none')}</dd>`,
    `<dt>Approvals</dt><dd>${summary.approvals}</dd>`,
    `<dt>Command output bytes</dt><dd>${summary.commandOutputBytes}</dd>`,
    `<dt>File change events</dt><dd>${summary.fileChanges}</dd>`,
    '</dl>',
    '</section>',
    '<section>',
    '<h2>Methods</h2>',
    '<table><thead><tr><th>Method</th><th>Count</th></tr></thead><tbody>',
    rows || '<tr><td colspan="2">No methods recorded</td></tr>',
    '</tbody></table>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function writeAppServerDashboard(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const summary = options.summary || summarizeAppServerEvents(options.input || []);
  const outDir = options.outDir || path.join(planningDir(projectRoot, 'app-server'));
  const summaryPath = path.join(outDir, 'summary.json');
  const dashboardPath = path.join(outDir, 'dashboard.html');
  writeJson(summaryPath, summary);
  writeText(dashboardPath, renderAppServerDashboard(summary, { source: options.source }));
  return {
    projectRoot,
    summaryPath,
    dashboardPath,
    summary,
  };
}

function checkCodexReadiness(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const checks = [];
  const add = (id, pass, detail, improvement) => checks.push({ id, pass: Boolean(pass), detail, improvement });

  const manifestPath = path.join(projectRoot, '.codex-plugin', 'plugin.json');
  const manifest = readJsonIfExists(manifestPath, { allowLineComment: true });
  add('plugin-manifest', Boolean(manifest), manifestPath, 'Codex can discover Citadel as a plugin instead of ad hoc prompts.');
  if (manifest) {
    const skillsPath = manifest.skills ? path.resolve(projectRoot, manifest.skills) : null;
    const hooksPath = manifest.hooks ? path.resolve(projectRoot, manifest.hooks) : null;
    const mcpPath = manifest.mcpServers ? path.resolve(projectRoot, manifest.mcpServers) : null;
    add('plugin-description', !/claude/i.test(manifest.description || '') && /codex/i.test(`${manifest.description || ''} ${manifest.interface?.shortDescription || ''}`), manifest.description, 'Prevents Codex users from seeing stale Claude-specific packaging.');
    add('plugin-skills-path', skillsPath && fs.existsSync(skillsPath), skillsPath || 'missing', 'Skills are loaded from a real plugin path.');
    add('plugin-hooks-path', hooksPath && fs.existsSync(hooksPath), hooksPath || 'missing', 'Lifecycle safety hooks are bundled with the plugin.');
    add('plugin-mcp-path', mcpPath && fs.existsSync(mcpPath), mcpPath || 'missing', 'Codex can load Citadel state through MCP.');
  }

  const configPath = path.join(projectRoot, '.codex', 'config.toml');
  const config = readTextIfExists(configPath);
  add('codex-config', Boolean(config), configPath, 'Project installs have Codex feature flags and MCP wiring.');
  add('feature-hooks', /\bhooks\s*=\s*true\b/.test(config) && !/\bcodex_hooks\s*=\s*true\b/.test(config), 'canonical hooks feature', 'Uses the current hooks feature key and rejects deprecated output.');
  add('mcp-citadel-state', /\[mcp_servers\.citadel-state\]/.test(config), 'citadel-state MCP config', 'Codex can query planning and verification state directly.');

  const agentsDir = path.join(projectRoot, '.codex', 'agents');
  const agentCount = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((name) => name.endsWith('.toml')).length
    : 0;
  add('codex-agents', agentCount > 0, `${agentCount} agent manifest(s)`, 'Citadel agents can map to native Codex subagents.');

  const agentsMd = path.join(projectRoot, 'AGENTS.md');
  const agentsText = readTextIfExists(agentsMd);
  add('agents-guidance', Boolean(agentsText), agentsMd, 'Codex gets project and review guidance before work starts.');
  add('review-guidelines', /review guidelines/i.test(agentsText), 'Review guidelines section', 'Codex GitHub review can follow repository-specific review rules.');

  const artifacts = verifyAppArtifacts({ projectRoot, requireExistingPaths: false });
  add('artifact-manifest-readable', artifacts.pass, `${artifacts.count} artifact record(s)`, 'Codex app evidence can be discovered after QA and live-preview runs.');

  const report = {
    projectRoot,
    checkedAt: nowIso(options),
    checks,
    pass: checks.every((check) => check.pass),
  };

  if (options.write) {
    writeJson(path.join(planningDir(projectRoot, 'verification'), 'codex-readiness.json'), report);
  }
  return report;
}

module.exports = Object.freeze({
  buildGitHubReviewFetchCommands,
  buildAppServerApprovalResponse,
  buildCodexExecArgs,
  checkCodexReadiness,
  createPluginMarketplace,
  createAppServerProbe,
  createAutomationPlan,
  createFleetExecutionPlan,
  createPrReviewPlan,
  detectWindowsCodexSetup,
  ingestCodexReview,
  readAppArtifacts,
  recordAppArtifact,
  recordAutomationRun,
  recordPrReviewResult,
  parseAppServerMessages,
  summarizeAppServerEvents,
  verifyAppServerCapture,
  verifyAppArtifacts,
  writeAppServerDashboard,
});
