'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const cohort = require('./activation-cohort');

const REPOSITORY = 'SethGammon/Citadel';
const DISCUSSION_NUMBER = 182;
const API_ENDPOINT = `/repos/${REPOSITORY}/discussions/${DISCUSSION_NUMBER}/comments?per_page=100`;

function extractFencedJson(body) {
  const blocks = [];
  const pattern = /```json[ \t]*\r?\n([\s\S]*?)\r?\n```/gi;
  let match;
  while ((match = pattern.exec(String(body || ''))) !== null) blocks.push(match[1].trim());
  return blocks;
}

function flattenPages(value) {
  if (!Array.isArray(value)) throw new Error('GitHub Discussion response must be an array');
  if (value.every(Array.isArray)) return value.flat();
  return value;
}

function parseApiPayload(raw) {
  let value;
  try { value = JSON.parse(String(raw)); }
  catch (error) { throw new Error(`GitHub Discussion response is invalid JSON: ${error.message}`); }
  return flattenPages(value);
}

function rateLimitError(error) {
  const text = [error.message, error.stderr, error.stdout].filter(Boolean).join(' ');
  if (/rate.?limit|secondary rate|abuse detection|HTTP 403|HTTP 429/i.test(text)) {
    const limited = new Error('GitHub API rate limit prevented activation cohort collection');
    limited.code = 'rate_limited';
    return limited;
  }
  return error;
}

function fetchDiscussionComments(options = {}) {
  const execFile = options.execFile || childProcess.execFile;
  return new Promise((resolve, reject) => {
    const args = [
      'api', API_ENDPOINT, '--paginate', '--slurp',
      '-H', 'Accept: application/vnd.github+json',
      '-H', 'X-GitHub-Api-Version: 2022-11-28',
    ];
    execFile('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { reject(rateLimitError(error)); return; }
      try { resolve(parseApiPayload(stdout)); }
      catch (parseError) { reject(parseError); }
    });
  });
}

function commentUrl(comment) {
  return typeof comment?.html_url === 'string' ? comment.html_url : '';
}

function candidateIsNewer(candidate, previous) {
  if (!previous) return true;
  if (candidate.submission.observation_day !== previous.submission.observation_day) {
    return candidate.submission.observation_day > previous.submission.observation_day;
  }
  const candidateTime = Date.parse(candidate.comment_updated_at || '') || 0;
  const previousTime = Date.parse(previous.comment_updated_at || '') || 0;
  if (candidateTime !== previousTime) return candidateTime > previousTime;
  return candidate.evidence_url.localeCompare(previous.evidence_url) > 0;
}

function parseComments(comments, options = {}) {
  const now = options.now || new Date();
  const selected = new Map();
  const stats = {
    comments_seen: 0,
    deleted_or_empty: 0,
    comments_without_fenced_json: 0,
    fenced_blocks_seen: 0,
    invalid_json: 0,
    invalid_submission: 0,
    valid_submissions: 0,
    duplicate_or_older_submissions: 0,
  };

  for (const comment of comments) {
    stats.comments_seen += 1;
    if (!comment || typeof comment !== 'object' || comment.deleted === true || typeof comment.body !== 'string' || !comment.body.trim()) {
      stats.deleted_or_empty += 1;
      continue;
    }
    const evidenceUrl = commentUrl(comment);
    const blocks = extractFencedJson(comment.body);
    if (!blocks.length) {
      stats.comments_without_fenced_json += 1;
      continue;
    }
    for (const block of blocks) {
      stats.fenced_blocks_seen += 1;
      let submission;
      try { submission = JSON.parse(block); }
      catch { stats.invalid_json += 1; continue; }
      try { cohort.validateSubmission(submission); }
      catch { stats.invalid_submission += 1; continue; }
      let envelope;
      try {
        envelope = cohort.validateEnvelope({
          schema: cohort.SCHEMA,
          kind: 'activation_cohort_evidence',
          evidence_url: evidenceUrl,
          captured_at: now.toISOString(),
          submission,
        });
      } catch {
        stats.invalid_submission += 1;
        continue;
      }
      stats.valid_submissions += 1;
      const candidate = { ...envelope, comment_updated_at: comment.updated_at || comment.created_at || null };
      const previous = selected.get(submission.submission_id);
      if (candidateIsNewer(candidate, previous)) selected.set(submission.submission_id, candidate);
      else stats.duplicate_or_older_submissions += 1;
    }
  }
  const envelopes = [...selected.values()]
    .sort((a, b) => a.submission.submission_id.localeCompare(b.submission.submission_id))
    .map(({ comment_updated_at, ...envelope }) => envelope);
  return { envelopes, stats };
}

function readExisting(file) {
  return fs.existsSync(file) ? cohort.parseJsonl(fs.readFileSync(file, 'utf8')) : [];
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, file);
}

function reconcile(root, envelopes, options = {}) {
  const paths = cohort.sharePaths(root);
  const existing = readExisting(paths.cohort);
  const previousUrls = new Set(existing.map((item) => item.evidence_url));
  const currentUrls = new Set(envelopes.map((item) => item.evidence_url));
  const report = cohort.cohortReport(envelopes);
  const result = {
    records: envelopes.length,
    added_sources: [...currentUrls].filter((url) => !previousUrls.has(url)).length,
    removed_sources: [...previousUrls].filter((url) => !currentUrls.has(url)).length,
    report,
    cohort_file: paths.cohort,
    report_file: paths.report,
    written: !options.dryRun,
  };
  if (!options.dryRun) {
    const jsonl = envelopes.length ? `${envelopes.map((item) => JSON.stringify(item)).join('\n')}\n` : '';
    writeAtomic(paths.cohort, jsonl);
    writeAtomic(paths.report, `${JSON.stringify(report, null, 2)}\n`);
  }
  return result;
}

async function collect(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  let comments;
  let source;
  if (options.fixture) {
    source = 'fixture';
    comments = parseApiPayload(fs.readFileSync(path.resolve(options.fixture), 'utf8'));
  } else {
    source = 'github_discussion';
    comments = await fetchDiscussionComments({ execFile: options.execFile });
  }
  const parsed = parseComments(comments, { now: options.now });
  const reconciled = reconcile(root, parsed.envelopes, { dryRun: options.dryRun });
  return {
    schema: 1,
    kind: 'activation_discussion_collection',
    source,
    discussion: cohort.DISCUSSION_URL,
    dry_run: Boolean(options.dryRun),
    stats: parsed.stats,
    reconciliation: reconciled,
  };
}

module.exports = Object.freeze({
  API_ENDPOINT,
  DISCUSSION_NUMBER,
  REPOSITORY,
  candidateIsNewer,
  collect,
  extractFencedJson,
  fetchDiscussionComments,
  flattenPages,
  parseApiPayload,
  parseComments,
  rateLimitError,
  reconcile,
});
