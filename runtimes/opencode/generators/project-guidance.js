#!/usr/bin/env node

'use strict';

// Writes the opencode-facing guidance file, and makes sure the canonical spec it
// renders from exists.
//
// Deliberately narrower than core/project/bootstrap-project-guidance.js, which
// writes both CLAUDE.md and AGENTS.md: an opencode install has no business
// creating a CLAUDE.md. The project spec bootstrap is reused rather than
// reimplemented, so `.citadel/project.md` is created the same way on every runtime.

const fs = require('fs');
const path = require('path');
const { ensureProjectSpec } = require('../../../core/project/bootstrap-project-guidance');
const { guidanceOwner, withGuidanceOwner } = require('../../../core/runtime/install-contract');
const { OPENCODE_GUIDANCE_TARGET } = require('../guidance/render');

function projectOpencodeGuidance(options = {}) {
  const citadelRoot = path.resolve(options.citadelRoot || path.resolve(__dirname, '..', '..', '..'));
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const dryRun = options.dryRun === true;
  const overwrite = options.overwriteGuidance === true;

  const filePath = path.join(projectRoot, OPENCODE_GUIDANCE_TARGET.filePath);
  const existed = fs.existsSync(filePath);

  // Refresh Citadel's projection for the installing runtime. Preserve files
  // without Citadel's ownership marker unless replacement was explicitly asked for.
  const existingOwner = existed ? guidanceOwner(fs.readFileSync(filePath, 'utf8')) : null;
  if (existed && existingOwner !== 'citadel:project-guidance' && !overwrite) {
    return {
      specPath: null,
      specCreated: false,
      filePath,
      written: false,
      skipped: true,
      reason: 'already exists; pass --overwrite-guidance to replace it',
    };
  }

  if (dryRun) {
    return {
      specPath: null,
      specCreated: false,
      filePath,
      written: false,
      skipped: false,
      dryRun: true,
      action: existed ? 'refresh' : 'create',
    };
  }

  const ensured = ensureProjectSpec({ citadelRoot, projectRoot, ...options });
  const content = withGuidanceOwner(OPENCODE_GUIDANCE_TARGET.render(ensured.loaded.spec));
  fs.writeFileSync(filePath, content, 'utf8');

  return {
    specPath: ensured.specPath,
    specCreated: ensured.created,
    filePath,
    written: true,
    skipped: false,
    bytes: Buffer.byteLength(content),
  };
}

module.exports = Object.freeze({
  projectOpencodeGuidance,
});
