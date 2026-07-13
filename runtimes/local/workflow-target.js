'use strict';

const operations = require('../../core/operations');

const CAPABILITIES = Object.freeze([
  'ordered_steps', 'verifier', 'evidence_states', 'failure_status',
  'cancellation_status', 'receipt_path',
]);

function compile({ workflow, core, semantics, compilerVersion }) {
  const document = {
    schema_version: 1,
    target: 'local',
    compiler_version: compilerVersion,
    core_contract: core,
    semantic_contract: semantics,
    execution: {
      mode: 'argv',
      verifier: { ...workflow.verifier },
      evidence: { ...semantics.evidence, states: [...semantics.evidence.states] },
      outcomes: { ...semantics.outcomes },
      steps: workflow.steps.map((step) => ({
        id: step.id, name: step.name, argv: [...step.argv], evidence_type: step.evidence_type,
      })),
      receipt: { path: core.receipt_path, issuer_id: workflow.receipt.issuer_id,
        required_for_pass: semantics.receipt.required_for_pass,
        missing_status: semantics.receipt.missing_status },
    },
  };
  return {
    output_path: `.citadel/workflows/${workflow.operation.operation_id}.json`,
    media_type: 'application/json',
    content: `${JSON.stringify(document, null, 2)}\n`,
  };
}

function inspect(content) {
  const document = JSON.parse(content);
  const steps = document.execution.steps;
  return {
    core_contract: document.core_contract,
    semantic_contract: {
      schema_version: 1,
      operation_id: document.core_contract.operation_id,
      step_ids: steps.map((step) => step.id),
      step_commands_digest: operations.sha256Digest(steps.map((step) => ({ id: step.id, argv: step.argv }))),
      verifier: document.execution.verifier,
      evidence: document.execution.evidence,
      outcomes: document.execution.outcomes,
      receipt: {
        path: document.execution.receipt.path,
        required_for_pass: document.execution.receipt.required_for_pass,
        missing_status: document.execution.receipt.missing_status,
      },
    },
    step_ids: steps.map((step) => step.id),
    step_commands_digest: operations.sha256Digest(steps.map((step) => ({ id: step.id, argv: step.argv }))),
    verifier: document.execution.verifier,
    executable_guard: false,
    artifact_digest: operations.sha256Digest(document),
  };
}

module.exports = Object.freeze({ id: 'local', capabilities: CAPABILITIES, compile, inspect });
