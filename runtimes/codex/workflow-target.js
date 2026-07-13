'use strict';

const operations = require('../../core/operations');

const CAPABILITIES = Object.freeze([
  'ordered_steps', 'verifier', 'evidence_states', 'failure_status',
  'cancellation_status', 'receipt_path',
]);

function compile({ workflow, core, semantics, compilerVersion }) {
  const document = {
    schema_version: 1,
    target: 'codex',
    compiler_version: compilerVersion,
    core_contract: core,
    semantic_contract: semantics,
    invocation: {
      operation: workflow.operation.operation_id,
      execution_mode: 'interactive-argv',
      steps: workflow.steps.map((step) => ({
        id: step.id, name: step.name, argv: [...step.argv], evidence_type: step.evidence_type,
      })),
      verifier: { ...workflow.verifier },
      evidence: { ...semantics.evidence, states: [...semantics.evidence.states] },
      outcomes: { ...semantics.outcomes },
      receipt: { path: core.receipt_path, issuer_id: workflow.receipt.issuer_id,
        required_for_pass: semantics.receipt.required_for_pass,
        missing_status: semantics.receipt.missing_status },
    },
  };
  return {
    output_path: `.codex/workflows/${workflow.operation.operation_id}.json`,
    media_type: 'application/json',
    content: `${JSON.stringify(document, null, 2)}\n`,
  };
}

function inspect(content) {
  const document = JSON.parse(content);
  const steps = document.invocation.steps;
  return {
    core_contract: document.core_contract,
    semantic_contract: {
      schema_version: 1,
      operation_id: document.core_contract.operation_id,
      step_ids: steps.map((step) => step.id),
      step_commands_digest: operations.sha256Digest(steps.map((step) => ({ id: step.id, argv: step.argv }))),
      verifier: document.invocation.verifier,
      evidence: document.invocation.evidence,
      outcomes: document.invocation.outcomes,
      receipt: {
        path: document.invocation.receipt.path,
        required_for_pass: document.invocation.receipt.required_for_pass,
        missing_status: document.invocation.receipt.missing_status,
      },
    },
    step_ids: steps.map((step) => step.id),
    step_commands_digest: operations.sha256Digest(steps.map((step) => ({ id: step.id, argv: step.argv }))),
    verifier: document.invocation.verifier,
    executable_guard: false,
    artifact_digest: operations.sha256Digest(document),
  };
}

module.exports = Object.freeze({ id: 'codex', capabilities: CAPABILITIES, compile, inspect });
