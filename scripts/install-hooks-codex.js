#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { installCodexHooks } = require('../runtimes/codex/generators/install-hooks');

const CITADEL_ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const JSON_OUTPUT = args.includes('--json');
const PROJECT_ROOT = args.find((a) => !a.startsWith('-')) || process.cwd();

function main() {
  try {
    const hooksTemplatePath = path.join(CITADEL_ROOT, 'hooks', 'hooks-template.json');
    const hooksTemplate = JSON.parse(fs.readFileSync(hooksTemplatePath, 'utf8'));
    const adapterScriptPath = path.join(CITADEL_ROOT, 'hooks_src', 'codex-adapter.js');
    const outputPath = path.join(PROJECT_ROOT, '.codex', 'hooks.json');
    const existingHooks = fs.existsSync(outputPath)
      ? (JSON.parse(fs.readFileSync(outputPath, 'utf8')).hooks || {})
      : {};

    const result = installCodexHooks({
      hooksTemplate,
      adapterScriptPath,
      existingHooks,
      outputPath,
    });

    if (JSON_OUTPUT) {
      process.stdout.write(JSON.stringify({
        outputPath,
        installed: result.installed,
        skipped: result.skipped,
        warnings: result.warnings || [],
      }, null, 2) + '\n');
      return;
    }

    console.log(`Citadel Codex hooks installed to ${outputPath}`);
    console.log(`  ${result.installed.length} Citadel hooks translated for Codex`);
    if (result.skipped.length > 0) {
      console.log(`  ${result.skipped.length} hook mappings skipped due to missing Codex lifecycle equivalents`);
    }

    if (VERBOSE) {
      if (result.installed.length > 0) {
        console.log('\nInstalled:');
        for (const entry of result.installed) {
          console.log(`  - ${entry.hook} (${entry.event})`);
        }
      }
      if (result.skipped.length > 0) {
        console.log('\nSkipped:');
        for (const entry of result.skipped) {
          console.log(`  - ${entry.hook} (Citadel event: ${entry.event}) — ${entry.reason}`);
        }
      }
      if (result.warnings && result.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const w of result.warnings) console.log(`  - ${w}`);
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
