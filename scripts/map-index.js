#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_CACHE_MAX_AGE_MS,
  createMapSlice,
  defaultOutputPath,
  detectMapStaleness,
  generateMapIndex,
  isMapIndexFresh,
  loadMapIndex,
  mapStats,
  queryMapIndex,
  writeMapIndex,
} = require('../core/map');

function parseArgs(argv) {
  const opts = {
    mode: 'generate',
    root: process.cwd(),
    output: null,
    force: false,
    query: '',
    maxFiles: 20,
    json: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--generate') opts.mode = 'generate';
    else if (arg === '--query') {
      opts.mode = 'query';
      opts.query = argv[++i] || '';
    } else if (arg === '--slice') {
      opts.mode = 'slice';
      opts.query = argv[++i] || '';
      if (opts.maxFiles === 20) opts.maxFiles = 15;
    } else if (arg === '--stats') opts.mode = 'stats';
    else if (arg === '--stale') opts.mode = 'stale';
    else if (arg === '--root') opts.root = path.resolve(argv[++i] || '.');
    else if (arg === '--output') opts.output = path.resolve(argv[++i] || '');
    else if (arg === '--force') opts.force = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--max-files') opts.maxFiles = parseInt(argv[++i], 10) || opts.maxFiles;
    else if (!arg.startsWith('--')) {
      if (!opts.query) opts.query = arg;
    }
    i++;
  }

  if (!opts.output) opts.output = defaultOutputPath(opts.root);
  return opts;
}

function printStats(stats) {
  console.log('\nCodebase Index Statistics\n' + '='.repeat(40));
  console.log(`Files:    ${stats.files}`);
  console.log(`Lines:    ${stats.lines.toLocaleString()}`);
  console.log(`Exports:  ${stats.exports}`);
  console.log(`Edges:    ${stats.edges} (dependency links)`);
  console.log(`Routes:   ${stats.routes}`);
  console.log(`Scripts:  ${stats.packageScripts}`);
  console.log(`Verify:   ${stats.verificationCommands} commands`);

  console.log('\nBy language:');
  for (const [lang, count] of Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${lang.padEnd(14)} ${count}`);
  }

  console.log('\nBy role:');
  for (const [role, count] of Object.entries(stats.byRole).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role.padEnd(14)} ${count}`);
  }
  console.log('');
}

function loadRequiredIndex(outputPath) {
  if (!fs.existsSync(outputPath)) {
    console.error(`Index not found at ${outputPath}. Run --generate first.`);
    process.exit(1);
  }
  return loadMapIndex(outputPath);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === 'generate') {
    if (!opts.force && isMapIndexFresh(opts.output, DEFAULT_CACHE_MAX_AGE_MS)) {
      const age = Date.now() - fs.statSync(opts.output).mtimeMs;
      console.log(`Index is fresh (${Math.round(age / 1000)}s old). Use --force to rebuild.`);
      process.exit(0);
    }

    console.log(`Scanning ${opts.root} ...`);
    const index = generateMapIndex(opts.root);
    writeMapIndex(index, opts.output);
    console.log(`Index written: ${opts.output}`);
    console.log(`  ${index.fileCount} files, ${index.graphEdgeCount} dependency links`);
    console.log(`  ${index.routes.length} routes, ${index.verificationCommands.length} verification commands`);
    process.exit(0);
  }

  const index = loadRequiredIndex(opts.output);

  if (opts.mode === 'stale') {
    const report = detectMapStaleness(opts.root, index);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else if (report.stale) {
      console.log('Map index is stale.');
      if (report.changed.length) console.log(`Changed: ${report.changed.join(', ')}`);
      if (report.added.length) console.log(`Added: ${report.added.join(', ')}`);
      if (report.removed.length) console.log(`Removed: ${report.removed.join(', ')}`);
    } else {
      console.log('Map index is current.');
    }
    process.exit(report.stale ? 2 : 0);
  }

  if (opts.mode === 'stats') {
    const stats = mapStats(index);
    if (opts.json) console.log(JSON.stringify(stats, null, 2));
    else printStats(stats);
    process.exit(0);
  }

  if (opts.mode === 'slice') {
    if (!opts.query) {
      console.error('Usage: --slice <terms>');
      process.exit(1);
    }
    console.log(createMapSlice(index, opts.query, { maxFiles: opts.maxFiles }));
    process.exit(0);
  }

  if (opts.mode === 'query') {
    if (!opts.query) {
      console.error('Usage: --query <terms>');
      process.exit(1);
    }

    const results = queryMapIndex(index, opts.query, opts.maxFiles);
    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      process.exit(0);
    }

    if (results.length === 0) {
      console.log(`No results for "${opts.query}".`);
      process.exit(0);
    }

    console.log(`\nResults for "${opts.query}" (${results.length} matches):\n`);
    console.log('  Score  Role        Path');
    console.log('  ' + '-'.repeat(60));
    for (const result of results) {
      const exportsStr = result.exports.length > 0
        ? `  [${result.exports.slice(0, 5).join(', ')}${result.exports.length > 5 ? ', ...' : ''}]`
        : '';
      const routesStr = result.routes.length > 0 ? `  routes=${result.routes.slice(0, 3).join(',')}` : '';
      console.log(`  ${String(result.score).padStart(3)}  ${String(result.role).padEnd(10)}  ${result.relPath}${exportsStr}${routesStr}  (${result.lines}L)`);
    }
    console.log('');
    process.exit(0);
  }
}

main();
