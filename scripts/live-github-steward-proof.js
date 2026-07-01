#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENTS_SOURCE = path.join(PROJECT_ROOT, 'examples', 'berman-agents-md-only', 'AGENTS.md');

function parseArgs(argv) {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const args = {
    repoName: `citadel-berman-steward-proof-${timestamp}`,
    visibility: 'public',
    ciSleepSeconds: 12,
    pollMs: 5000,
    maxCycles: 120,
    firstReady: 3,
    totalPrs: 15,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--repo-name') { args.repoName = next; index += 1; }
    else if (arg === '--private') args.visibility = 'private';
    else if (arg === '--public') args.visibility = 'public';
    else if (arg === '--ci-sleep-seconds') { args.ciSleepSeconds = Number.parseInt(next, 10); index += 1; }
    else if (arg === '--poll-ms') { args.pollMs = Number.parseInt(next, 10); index += 1; }
    else if (arg === '--max-cycles') { args.maxCycles = Number.parseInt(next, 10); index += 1; }
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/live-github-steward-proof.js',
    '  node scripts/live-github-steward-proof.js --repo-name citadel-berman-proof --ci-sleep-seconds 12',
    '',
    'Creates a disposable GitHub repo, opens 15 real PRs, and runs the standalone',
    'AGENTS.md deploy steward against live GitHub PR state.',
  ].join('\n');
}

function run(command, commandArgs, options = {}) {
  const result = childProcess.spawnSync(command, commandArgs, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    input: options.input,
    stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${commandArgs.join(' ')} failed with exit ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout || '';
}

function gh(args, options = {}) {
  return run('gh', args, options).trim();
}

function git(args, cwd) {
  return run('git', args, { cwd }).trim();
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function extractStewardScript(agentsMd) {
  const match = agentsMd.match(/<!-- BEGIN_STEWARD_SCRIPT -->\s*```js\n([\s\S]*?)\n```\s*<!-- END_STEWARD_SCRIPT -->/);
  assert(match, 'standalone AGENTS.md must contain steward script block');
  return match[1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupInitialRepo(workDir, args) {
  const agentsMd = fs.readFileSync(AGENTS_SOURCE, 'utf8');
  writeFile(path.join(workDir, 'AGENTS.md'), agentsMd);
  writeFile(path.join(workDir, 'package.json'), `${JSON.stringify({
    name: 'citadel-berman-steward-proof',
    private: true,
    scripts: {
      test: 'node scripts/check.js',
      deploy: 'node .agent-steward/fake-deploy.cjs',
    },
  }, null, 2)}\n`);
  writeFile(path.join(workDir, 'scripts', 'check.js'), [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const featureDir = path.join(process.cwd(), 'features');",
    "if (fs.existsSync(featureDir)) {",
    "  for (const file of fs.readdirSync(featureDir)) {",
    "    const text = fs.readFileSync(path.join(featureDir, file), 'utf8');",
    "    if (!/^agent \\d+\\n$/.test(text)) throw new Error(`bad feature file ${file}`);",
    "  }",
    "}",
    "console.log('proof check passed');",
    '',
  ].join('\n'));
  writeFile(path.join(workDir, '.github', 'workflows', 'ci.yml'), [
    'name: ci',
    '',
    'on:',
    '  pull_request:',
    '    branches: [main]',
    '  push:',
    '    branches: [main]',
    '',
    'jobs:',
    '  ci:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 22',
    `      - run: sleep ${args.ciSleepSeconds}`,
    '      - run: npm test',
    '',
  ].join('\n'));
  writeFile(path.join(workDir, 'README.md'), [
    '# Citadel Berman Steward Proof',
    '',
    'Disposable live proof repo for post-PR deploy steward behavior.',
    '',
  ].join('\n'));

  const stewardScript = extractStewardScript(agentsMd);
  writeFile(path.join(workDir, '.agent-steward', 'deploy-steward.cjs'), stewardScript);
  writeFile(path.join(workDir, '.agent-steward', 'fake-deploy.cjs'), [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const out = path.join(process.cwd(), '.agent-steward', 'live-deploys.jsonl');",
    "fs.mkdirSync(path.dirname(out), { recursive: true });",
    "fs.appendFileSync(out, `${JSON.stringify({ ts: new Date().toISOString() })}\\n`);",
    "console.log('fake deploy complete');",
    '',
  ].join('\n'));

  git(['init', '-b', 'main'], workDir);
  git(['config', 'user.name', 'Citadel Steward Proof'], workDir);
  git(['config', 'user.email', 'citadel-steward-proof@example.com'], workDir);
  git(['add', 'AGENTS.md', 'README.md', 'package.json', 'scripts/check.js', '.github/workflows/ci.yml'], workDir);
  git(['commit', '-m', 'init steward proof repo'], workDir);
}

function createGitHubRepo(workDir, owner, repoName, visibility) {
  gh(['repo', 'create', `${owner}/${repoName}`, `--${visibility}`, '--source', workDir, '--remote', 'origin', '--push'], { cwd: workDir });
  return `https://github.com/${owner}/${repoName}`;
}

function protectMain(owner, repoName) {
  const protection = {
    required_status_checks: {
      strict: true,
      contexts: ['ci'],
    },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
  gh(['api', '-X', 'PUT', `repos/${owner}/${repoName}/branches/main/protection`, '--input', '-'], {
    input: JSON.stringify(protection),
  });
}

function createAgentPr(workDir, owner, repoName, number) {
  const branch = `agent/${number}`;
  git(['checkout', 'main'], workDir);
  git(['checkout', '-B', branch], workDir);
  writeFile(path.join(workDir, 'features', `agent-${String(number).padStart(2, '0')}.txt`), `agent ${number}\n`);
  git(['add', 'features'], workDir);
  git(['commit', '-m', `agent ${number} change`], workDir);
  const head = git(['rev-parse', 'HEAD'], workDir);
  git(['push', '-u', 'origin', branch], workDir);
  const prUrl = gh([
    'pr',
    'create',
    '--repo',
    `${owner}/${repoName}`,
    '--head',
    branch,
    '--base',
    'main',
    '--title',
    `Agent ${number} proof PR`,
    '--body',
    `Agent ${number} PR for live deploy steward proof.`,
  ], { cwd: workDir });
  writeJson(path.join(workDir, '.agent-steward', 'ready', `pr-${number}.json`), {
    id: `pr-${number}`,
    pr: prUrl,
    branch,
    head,
    ready: true,
    verification: 'GitHub Actions ci',
    createdAt: new Date().toISOString(),
  });
  return { number, branch, head, prUrl };
}

function runStewardCycle(workDir, cycle) {
  const stdout = run(process.execPath, [
    path.join(workDir, '.agent-steward', 'deploy-steward.cjs'),
    '--root',
    workDir,
    '--scan',
    '--run',
    '--deploy',
    'node .agent-steward/fake-deploy.cjs',
    '--cycle',
    String(cycle),
  ], { cwd: workDir });
  return JSON.parse(stdout);
}

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split(/\r?\n/).map((line) => JSON.parse(line));
}

function collectProof(workDir, owner, repoName, repoUrl, transcript, args) {
  const queue = readJson(path.join(workDir, '.agent-steward', 'queue.json'));
  const events = parseJsonl(path.join(workDir, '.agent-steward', 'events.jsonl'));
  const deploys = parseJsonl(path.join(workDir, '.agent-steward', 'live-deploys.jsonl'));
  const prs = JSON.parse(gh(['pr', 'list', '--repo', `${owner}/${repoName}`, '--state', 'all', '--json', 'number,state,mergedAt,headRefName,url']));
  const proof = {
    generatedAt: new Date().toISOString(),
    repo: `${owner}/${repoName}`,
    repoUrl,
    localWorkDir: workDir,
    settings: args,
    summary: {
      prs: prs.length,
      mergedPrs: prs.filter((pr) => pr.state === 'MERGED').length,
      landedQueueItems: queue.filter((item) => item.status === 'landed').length,
      deploys: deploys.length,
      updatedBranchEvents: events.filter((event) => event.type === 'updated-branch').length,
      waitingEvents: events.filter((event) => event.type === 'waiting-for-checks').length,
      repairEvents: events.filter((event) => event.type === 'repair-needed').length,
    },
    prs,
    queue,
    events,
    deploys,
    transcript,
  };
  const outDir = path.join(PROJECT_ROOT, '.planning', 'live-proof');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${repoName}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return { proof, outPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const owner = gh(['api', 'user', '--jq', '.login']);
  const workDir = path.join(os.tmpdir(), args.repoName);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  console.log(`workDir=${workDir}`);
  setupInitialRepo(workDir, args);
  const repoUrl = createGitHubRepo(workDir, owner, args.repoName, args.visibility);
  console.log(`repo=${repoUrl}`);
  protectMain(owner, args.repoName);
  console.log('protected main with strict ci status checks');

  const createdPrs = [];
  for (let number = 1; number <= args.firstReady; number += 1) {
    const pr = createAgentPr(workDir, owner, args.repoName, number);
    createdPrs.push(pr);
    console.log(`created PR ${number}: ${pr.prUrl}`);
  }

  const transcript = [];
  for (let cycle = 1; cycle <= args.maxCycles; cycle += 1) {
    if (cycle === 3) {
      for (let number = args.firstReady + 1; number <= args.totalPrs; number += 1) {
        const pr = createAgentPr(workDir, owner, args.repoName, number);
        createdPrs.push(pr);
        console.log(`created PR ${number}: ${pr.prUrl}`);
      }
    }

    let result;
    try {
      result = runStewardCycle(workDir, cycle);
    } catch (error) {
      transcript.push({ cycle, error: error.message });
      throw error;
    }
    const entry = {
      cycle,
      outcome: result.outcome,
      statuses: result.queue.map((item) => ({ id: item.id, status: item.status, reason: item.reason || null })),
    };
    transcript.push(entry);
    console.log(`cycle ${cycle}: ${result.outcome.action}${result.outcome.item ? ` ${result.outcome.item}` : ''}`);

    const landed = result.queue.filter((item) => item.status === 'landed').length;
    if (result.queue.length === args.totalPrs && landed === args.totalPrs) {
      console.log(`all ${args.totalPrs} PRs landed at cycle ${cycle}`);
      break;
    }
    await sleep(args.pollMs);
  }

  const { proof, outPath } = collectProof(workDir, owner, args.repoName, repoUrl, transcript, args);
  assert.equal(proof.summary.prs, args.totalPrs, 'expected 15 PRs');
  assert.equal(proof.summary.mergedPrs, args.totalPrs, 'expected all PRs merged');
  assert.equal(proof.summary.landedQueueItems, args.totalPrs, 'expected all queue items landed');
  assert.equal(proof.summary.deploys, args.totalPrs, 'expected deploy after every merge');
  assert(proof.summary.updatedBranchEvents >= args.totalPrs - 1, 'expected stale branch updates');
  assert.equal(proof.summary.repairEvents, 0, 'expected no repair events in happy-path live proof');
  console.log(`proof=${outPath}`);
  console.log(JSON.stringify(proof.summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
