#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { buildPackIndex, certifyPack, inspectPack, packDirectories, verifyPack, verifyRegistryFile } = require('../core/packs');
const { installPack, readInstallIndex, uninstallPack } = require('../core/packs/lifecycle');

function parseArgs(argv) {
  const command = argv[2];
  const registryCommand = command === 'registry' ? argv[3] : null;
  const takesSubject = ['inspect', 'verify', 'certify', 'install', 'uninstall'].includes(command);
  const args = { command, registryCommand, subject: takesSubject ? argv[3] : null, root: process.cwd(), json: false };
  for (let index = command === 'registry' || takesSubject ? 4 : 3; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--root') { args.root = path.resolve(value); index++; }
    else if (arg === '--project') { args.project = path.resolve(value); index++; }
    else if (arg === '--runtime') { args.runtime = value; index++; }
    else if (arg === '--digest') { args.expectedDigest = value; index++; }
    else if (arg === '--version') { args.version = value; index++; }
    else if (arg === '--registry') { args.registry = path.resolve(value); index++; }
    else if (arg === '--trust-roots') { args.trustRootFile = path.resolve(value); index++; }
    else if (arg === '--force') args.force = true;
    else if (arg === '--json') args.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/packs.js list [--root path] [--json]',
    '       node scripts/packs.js inspect <id|name|path> [--root path] [--json]',
    '       node scripts/packs.js verify <id|name|path> [--runtime codex] [--digest sha256] [--json]',
    '       node scripts/packs.js certify <id|name|path> [--runtime codex] [--json]',
    '       node scripts/packs.js install <id|name|path> --project path --runtime codex [--json]',
    '       node scripts/packs.js uninstall <publisher/name> --project path [--version x.y.z] [--force] [--json]',
    '       node scripts/packs.js installed --project path [--json]',
    '       node scripts/packs.js registry verify --registry file --trust-roots file [--json]',
    '       node scripts/packs.js registry inspect --registry file --trust-roots file [--json]',
  ].join('\n');
}

function resolvePack(subject, root) {
  if (!subject) throw new Error('Pack id, name, or path is required');
  const asPath = path.resolve(root, subject);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isDirectory()) return asPath;
  const matches = packDirectories(root).filter((dir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'citadel.pack.json'), 'utf8'));
    return manifest.id === subject || manifest.name === subject;
  });
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous Pack: ${subject}` : `Pack not found: ${subject}`);
  return matches[0];
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (!args.command || args.command === 'help' || args.command === '--help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  let result;
  if (args.command === 'list') result = buildPackIndex(args.root);
  else if (args.command === 'inspect') result = inspectPack(resolvePack(args.subject, args.root), { projectRoot: args.root });
  else if (args.command === 'verify') result = verifyPack(resolvePack(args.subject, args.root), {
    projectRoot: args.root, runtime: args.runtime, expectedDigest: args.expectedDigest,
  });
  else if (args.command === 'certify') result = certifyPack(resolvePack(args.subject, args.root), {
    projectRoot: args.root, runtime: args.runtime,
  });
  else if (args.command === 'install') {
    if (!args.project || !args.runtime) throw new Error('install requires --project and --runtime');
    result = installPack(resolvePack(args.subject, args.root), args.project, {
      sourceProjectRoot: args.root, runtime: args.runtime, expectedDigest: args.expectedDigest,
    });
  } else if (args.command === 'uninstall') {
    if (!args.project) throw new Error('uninstall requires --project');
    result = uninstallPack(args.project, args.subject, { version: args.version, force: args.force });
  } else if (args.command === 'installed') {
    if (!args.project) throw new Error('installed requires --project');
    result = readInstallIndex(args.project);
  } else if (args.command === 'registry') {
    if (!['verify', 'inspect'].includes(args.registryCommand)) throw new Error('registry command must be verify or inspect');
    if (!args.registry || !args.trustRootFile) throw new Error('registry command requires --registry and --trust-roots');
    result = verifyRegistryFile(args.registry, args.trustRootFile);
  } else throw new Error(`Unknown command: ${args.command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`packs: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ main, parseArgs, resolvePack, usage });
