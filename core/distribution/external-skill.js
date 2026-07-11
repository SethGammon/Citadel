'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveExistingFile, resolveTarget } = require('./fs-safety');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseExternalSkill(content) {
  const normalized = String(content).replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('External skill must contain YAML frontmatter');
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key && value) frontmatter[key] = value;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name || '')) {
    throw new Error('External skill name must be lowercase kebab-case');
  }
  if (!frontmatter.description) throw new Error('External skill description is required');
  if (!match[2].trim()) throw new Error('External skill instructions are required');
  return { frontmatter, body: match[2].trim(), content: normalized };
}

function renderOpenAiYaml(skill) {
  const display = skill.frontmatter.name.replace(/"/g, '\\"');
  const description = skill.frontmatter.description.replace(/"/g, '\\"');
  return `interface:\n  display_name: "${display}"\n  short_description: "${description}"\npolicy:\n  allow_implicit_invocation: true\n`;
}

function installSkill(sourceFile, runtimeRoot, runtime, skill) {
  const prefix = runtime === 'claude' ? '.claude/skills' : '.agents/skills';
  const relative = `${prefix}/${skill.frontmatter.name}/SKILL.md`;
  const target = resolveTarget(runtimeRoot, relative, `${runtime} skill target`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(sourceFile, target, fs.constants.COPYFILE_EXCL);
  if (runtime === 'codex') {
    const yaml = resolveTarget(runtimeRoot,
      `${prefix}/${skill.frontmatter.name}/agents/openai.yaml`, 'Codex projection');
    fs.mkdirSync(path.dirname(yaml), { recursive: true });
    fs.writeFileSync(yaml, renderOpenAiYaml(skill), { encoding: 'utf8', flag: 'wx' });
  }
  return relative;
}

function scanInstalledSkill(runtimeRoot, runtime, relative, expectedDigest) {
  const installed = resolveExistingFile(runtimeRoot, relative, `${runtime} installed skill`);
  const content = fs.readFileSync(installed);
  const parsed = parseExternalSkill(content.toString('utf8'));
  if (sha256(content) !== expectedDigest) throw new Error(`${runtime} install digest mismatch`);
  if (runtime === 'codex') {
    const yamlRelative = path.posix.join(path.posix.dirname(relative), 'agents/openai.yaml');
    const yaml = fs.readFileSync(resolveExistingFile(runtimeRoot, yamlRelative, 'Codex openai.yaml'), 'utf8');
    if (!yaml.includes(`display_name: "${parsed.frontmatter.name}"`)) {
      throw new Error('Codex projection does not identify the installed skill');
    }
  }
  return { runtime, name: parsed.frontmatter.name, digest: expectedDigest, discovered: true };
}

function routeSkill(request, skill) {
  const normalized = String(request || '').toLowerCase();
  const name = skill.frontmatter.name.toLowerCase();
  if (!normalized.includes(name)) throw new Error(`Request did not route to ${name}`);
  return { selected_skill: name, reason: 'explicit-name-match' };
}

function executeSkill(skill) {
  const heading = skill.body.match(/^#\s+(.+)$/m);
  if (!heading) throw new Error('External skill has no executable instruction heading');
  return {
    status: 'completed',
    instruction_heading: heading[1].trim(),
    instruction_digest: sha256(skill.body),
  };
}

function writeEvidence(evidenceRoot, events, handoff) {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const telemetry = resolveTarget(evidenceRoot, 'telemetry.jsonl', 'telemetry');
  const handoffPath = resolveTarget(evidenceRoot, 'HANDOFF.md', 'handoff');
  fs.writeFileSync(telemetry, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(handoffPath, `${handoff}\n`, 'utf8');
}

function runExternalSkillProof(options) {
  const fixtureRoot = options.fixtureRoot;
  const sourceFile = resolveExistingFile(fixtureRoot, 'SKILL.md', 'fixture skill');
  const provenanceFile = resolveExistingFile(fixtureRoot, 'provenance.json', 'fixture provenance');
  const source = fs.readFileSync(sourceFile);
  const sourceDigest = sha256(source);
  const provenance = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'));
  if (provenance.sha256 !== sourceDigest) throw new Error('Fixture provenance digest mismatch');
  const skill = parseExternalSkill(source.toString('utf8'));
  const runtimeRoot = resolveTarget(options.runRoot, 'runtime', 'runtime workspace');
  const evidenceRoot = resolveTarget(options.runRoot, 'evidence', 'evidence workspace');
  const timestamp = options.timestamp || '1970-01-01T00:00:00.000Z';
  const requestDigest = sha256(String(options.request || ''));
  let report;
  fs.mkdirSync(runtimeRoot, { recursive: true });
  try {
    const scans = ['claude', 'codex'].map((runtime) => {
      const relative = installSkill(sourceFile, runtimeRoot, runtime, skill);
      return scanInstalledSkill(runtimeRoot, runtime, relative, sourceDigest);
    });
    const route = routeSkill(options.request, skill);
    const executions = scans.map(({ runtime }) => ({ runtime, ...executeSkill(skill) }));
    const events = executions.map((execution) => ({
      schema_version: 1,
      timestamp,
      event: 'external_skill_execution',
      runtime: execution.runtime,
      skill: skill.frontmatter.name,
      request_sha256: requestDigest,
      source_sha256: sourceDigest,
      status: execution.status,
    }));
    const handoff = [
      '---HANDOFF---',
      `- External skill: ${skill.frontmatter.name}`,
      '- Claude local scan: pass',
      '- Codex local scan: pass',
      `- Source digest preserved: ${sourceDigest}`,
      '---',
    ].join('\n');
    writeEvidence(evidenceRoot, events, handoff);
    report = { source: { ...provenance, sha256: sourceDigest }, scans, route, executions,
      telemetry: events, handoff, cleanup: { runtime_removed: false }, request_sha256: requestDigest };
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
  report.cleanup.runtime_removed = !fs.existsSync(runtimeRoot);
  report.cleanup.source_digest_preserved = sha256(fs.readFileSync(sourceFile)) === sourceDigest;
  if (!report.cleanup.runtime_removed || !report.cleanup.source_digest_preserved) {
    throw new Error('External skill proof cleanup or source integrity failed');
  }
  return report;
}

module.exports = Object.freeze({
  executeSkill,
  parseExternalSkill,
  routeSkill,
  runExternalSkillProof,
  scanInstalledSkill,
  sha256,
});
