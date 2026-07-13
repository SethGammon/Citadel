#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { compileWorkflow } = require('../core/operations/compiler');

function value(args, flag, fallback = null) {
  const inline = args.find((item) => item.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
}

function usage() {
  return 'Usage: node scripts/compile-workflow.js --input <workflow.json> --target <local|codex|github-actions> [--output PATH] [--json]\n';
}

function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return 0;
  }
  const input = value(args, '--input');
  const target = value(args, '--target');
  if (!input || !target) throw new Error('--input and --target are required');
  const workflow = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const result = compileWorkflow(workflow, target);
  const output = value(args, '--output');
  if (output) {
    const destination = path.resolve(output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, result.content, 'utf8');
  }
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      target: result.target,
      output: output ? path.resolve(output) : null,
      output_path: result.output_path,
      operation_id: result.core_contract.operation_id,
      workflow_digest: result.core_contract.workflow_digest,
      semantic_proof_status: result.semantic_proof.status,
      artifact_digest: result.semantic_proof.artifact_digest,
    }, null, 2)}\n`);
  } else if (!output) process.stdout.write(result.content);
  else process.stdout.write(`Compiled ${result.target} workflow to ${path.resolve(output)}\n`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { process.stderr.write(`compile-workflow: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { main, usage, value };
