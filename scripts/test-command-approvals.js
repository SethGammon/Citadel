#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { approvalHint } = require('../core/security/command-approvals');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-approval-hints-'));
const project = path.join(fixture, "project ' $(touch project-marker) `touch backtick-marker`");
fs.mkdirSync(project);
let passed = 0;

try {
  const capture = path.join(fixture, 'capture.js');
  fs.writeFileSync(capture, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const script = path.resolve(__dirname, 'approve-command.js');
  const commands = [
    "echo '$(touch command-marker)'",
    'echo `touch backtick-marker`',
    'echo "quoted"; touch separator-marker',
    "echo 'single' \\path $HOME & | < >\nsecond line",
  ];
  const shells = process.platform === 'win32'
    ? [
      { shell: 'powershell', bin: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command'] },
      // Git Bash, rather than Windows' WSL launcher. Optional locally; POSIX CI exercises bash directly.
      ...(fs.existsSync('C:/Program Files/Git/bin/bash.exe')
        ? [{ shell: 'posix', bin: 'C:/Program Files/Git/bin/bash.exe', args: ['--noprofile', '--norc', '-c'] }]
        : []),
    ]
    : [{ shell: 'posix', bin: '/bin/sh', args: ['-c'] }];

  for (const { shell, bin, args } of shells) {
    const shellArgs = (source) => shell === 'powershell'
      ? ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')]
      : [...args, source];
    // Capture argv after the shell parses the actual generated hint, without
    // granting an approval. Both paths and commands contain shell syntax.
    const wrapper = shell === 'powershell'
      // Capture shell arguments directly: Windows PowerShell 5.1's legacy
      // native argument marshalling otherwise strips embedded double quotes.
      ? 'function node { [Console]::Write((ConvertTo-Json -Compress -InputObject @($args))) }; '
      : `node() { '${process.execPath.replace(/\\/g, '/').replace(/'/g, `'"'"'`)}' '${capture.replace(/\\/g, '/').replace(/'/g, `'"'"'`)}' "$@"; }; `;
    for (const command of commands) {
      const hint = approvalHint('loop', command, project, { shell });
      const result = spawnSync(bin, shellArgs(wrapper + hint), {
        cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 10000,
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.deepStrictEqual(JSON.parse(result.stdout.trim()), [
        script, 'approve', 'loop', '--project-root', fs.realpathSync(project), '--command', command,
      ]);
      for (const marker of ['project-marker', 'command-marker', 'backtick-marker', 'separator-marker']) {
        assert(!fs.existsSync(path.join(fixture, marker)), `${shell}: hint executed ${marker}`);
      }
      passed++;
    }
    // Copying a hint to the real CLI with piped stdin must refuse approval,
    // and must not execute substitutions before the TTY check.
    const hint = approvalHint('loop', commands[0], project, { shell });
    const result = spawnSync(bin, shellArgs(hint + (shell === 'powershell' ? '; exit $LASTEXITCODE' : '')), {
      cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 10000, input: '',
      env: { ...process.env, CITADEL_COMMAND_APPROVALS: path.join(fixture, 'approvals.json'), MSYS_NO_PATHCONV: '1' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /interactive terminal/);
    assert(!fs.existsSync(path.join(fixture, 'command-marker')));
    assert(!fs.existsSync(path.join(fixture, 'project-marker')));
    assert(!fs.existsSync(path.join(fixture, 'backtick-marker')));
    assert(!fs.existsSync(path.join(fixture, 'approvals.json')));
    passed++;
  }
  console.log(`command approval hint tests passed (${passed})`);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
