#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

function repositoryPath(uri, root = process.cwd()) {
  if (typeof uri !== 'string' || !uri) return null;
  let candidate = uri;
  try {
    if (/^file:/i.test(candidate)) candidate = fileURLToPath(candidate);
    else candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  const relative = path.relative(path.resolve(root), absolute);
  if (!relative || relative === '.') return '.';
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

function coordinates(sarif, root = process.cwd()) {
  const rows = [];
  for (const run of Array.isArray(sarif?.runs) ? sarif.runs : []) {
    for (const result of Array.isArray(run?.results) ? run.results : []) {
      const location = result?.locations?.[0]?.physicalLocation;
      const line = location?.region?.startLine;
      rows.push({
        ruleId: typeof result?.ruleId === 'string' ? result.ruleId : null,
        level: ['none', 'note', 'warning', 'error'].includes(result?.level) ? result.level : null,
        path: repositoryPath(location?.artifactLocation?.uri, root),
        line: Number.isInteger(line) && line > 0 ? line : null,
      });
    }
  }
  return rows;
}

function main(argv = process.argv.slice(2)) {
  const file = argv[0];
  if (!file || !fs.existsSync(file)) {
    process.stdout.write('[]\n');
    return;
  }
  const sarif = JSON.parse(fs.readFileSync(file, 'utf8'));
  process.stdout.write(`${JSON.stringify(coordinates(sarif))}\n`);
}

if (require.main === module) main();

module.exports = { coordinates, repositoryPath };
