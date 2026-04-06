/**
 * COMPAT-10: Campaign state portability
 * Validates that campaign files contain no runtime-specific content.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

async function run() {
  const errors = [];
  const templatesDir = path.join(__dirname, '..', '..', '.planning', '_templates');

  // Check campaign template is runtime-agnostic
  const campaignTemplate = path.join(templatesDir, 'campaign.md');
  if (!fs.existsSync(campaignTemplate)) {
    return { pass: true, message: 'No campaign template found (acceptable -- templates may not exist yet)' };
  }

  const content = fs.readFileSync(campaignTemplate, 'utf8');

  // Should not contain runtime-specific references
  const runtimeRefs = ['claude-code', 'codex', '.claude/', '.codex/'];
  for (const ref of runtimeRefs) {
    if (content.toLowerCase().includes(ref)) {
      errors.push(`Campaign template contains runtime-specific reference: "${ref}"`);
    }
  }

  // Check fleet session template too
  const fleetTemplate = path.join(templatesDir, 'fleet-session.md');
  if (fs.existsSync(fleetTemplate)) {
    const fleetContent = fs.readFileSync(fleetTemplate, 'utf8');
    for (const ref of runtimeRefs) {
      if (fleetContent.toLowerCase().includes(ref)) {
        errors.push(`Fleet template contains runtime-specific reference: "${ref}"`);
      }
    }
  }

  if (errors.length > 0) {
    return { pass: false, message: errors.join('; ') };
  }
  return { pass: true, message: 'Campaign templates are runtime-agnostic' };
}

module.exports = { run };
