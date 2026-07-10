'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const API_VERSION = '2026-03-10';
const USER_AGENT = 'Citadel-Acquisition-Snapshot/1.1';

function parseRepository(value) {
  if (typeof value !== 'string') throw new Error('Repository must be an owner/repo string');
  const parts = value.trim().split('/');
  if (parts.length !== 2) throw new Error('Repository must use the owner/repo format');
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
    throw new Error('Repository owner is invalid');
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
    throw new Error('Repository name is invalid');
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': API_VERSION,
  };
}

function requestGitHub({ path: requestPath, headers }) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: 'api.github.com', method: 'GET', path: requestPath, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        } catch {
          reject(new Error(`GitHub returned invalid JSON (HTTP ${response.statusCode})`));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const hints = {
            401: 'the token is missing, invalid, or expired',
            403: 'the token needs repository write access to read traffic data',
            404: 'the repository is unavailable to this token',
          };
          reject(new Error(`GitHub API request failed (HTTP ${response.statusCode}): ${hints[response.statusCode] || payload?.message || 'request denied'}`));
          return;
        }
        resolve(payload);
      });
    });
    request.on('error', error => reject(new Error(`GitHub API request failed: ${error.message}`)));
    request.end();
  });
}

function redactSecrets(value, secrets = []) {
  let message = String(value instanceof Error ? value.message : value);
  for (const secret of secrets) {
    if (secret) message = message.split(String(secret)).join('[REDACTED]');
  }
  return message.replace(/(Bearer|token)\s+[A-Za-z0-9_.-]{12,}/gi, '$1 [REDACTED]');
}

async function fetchCombinedResponse(repository, options = {}) {
  const parsed = parseRepository(repository);
  const token = options.token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('Live GitHub traffic capture requires GH_TOKEN or GITHUB_TOKEN with repository write access');
  }
  const requestFn = options.requestFn || requestGitHub;
  const base = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
  const endpoints = {
    repository: base,
    views: `${base}/traffic/views`,
    clones: `${base}/traffic/clones`,
    referrers: `${base}/traffic/popular/referrers`,
    popular_paths: `${base}/traffic/popular/paths`,
    recent_events: `${base}/events?per_page=100`,
  };
  try {
    const entries = await Promise.all(Object.entries(endpoints).map(async ([key, requestPath]) => [
      key,
      await requestFn({ method: 'GET', path: requestPath, headers: githubHeaders(token) }),
    ]));
    return Object.fromEntries(entries.map(([key, response]) => [key, response?.data ?? response]));
  } catch (error) {
    throw new Error(redactSecrets(error, [token]));
  }
}

function count(value, label) {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be a non-negative number`);
  return result;
}

function timestamp(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO timestamp`);
  return date.toISOString();
}

function trafficSummary(value, collection, label) {
  const source = value && typeof value === 'object' ? value : {};
  const rows = Array.isArray(source[collection]) ? source[collection] : [];
  return {
    count: count(source.count, `${label}.count`),
    uniques: count(source.uniques, `${label}.uniques`),
    [collection]: rows.map((row, index) => ({
      timestamp: timestamp(row.timestamp, `${label}.${collection}[${index}].timestamp`),
      count: count(row.count, `${label}.${collection}[${index}].count`),
      uniques: count(row.uniques, `${label}.${collection}[${index}].uniques`),
    })),
  };
}

function normalizeSnapshot(raw, repository, capturedAt = new Date().toISOString()) {
  const requested = parseRepository(repository);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Combined response must be an object');
  const metadata = raw.repository || {};
  const canonical = metadata.full_name || requested.fullName;
  if (canonical.toLowerCase() !== requested.fullName.toLowerCase()) {
    throw new Error(`GitHub response repository mismatch: expected ${requested.fullName}, received ${canonical}`);
  }
  const referrers = Array.isArray(raw.referrers) ? raw.referrers : [];
  const popularPaths = Array.isArray(raw.popular_paths) ? raw.popular_paths : (Array.isArray(raw.paths) ? raw.paths : []);
  const events = Array.isArray(raw.recent_events) ? raw.recent_events : (Array.isArray(raw.events) ? raw.events : []);
  return {
    schema: 1,
    captured_at: timestamp(capturedAt, 'captured_at'),
    repository: canonical,
    stars: count(metadata.stargazers_count, 'repository.stargazers_count'),
    forks: count(metadata.forks_count, 'repository.forks_count'),
    watchers: count(metadata.subscribers_count, 'repository.subscribers_count'),
    views: trafficSummary(raw.views, 'views', 'views'),
    clones: trafficSummary(raw.clones, 'clones', 'clones'),
    referrers: referrers.map((row, index) => ({
      referrer: String(row.referrer || ''),
      count: count(row.count, `referrers[${index}].count`),
      uniques: count(row.uniques, `referrers[${index}].uniques`),
    })),
    popular_paths: popularPaths.map((row, index) => ({
      path: String(row.path || ''),
      title: String(row.title || ''),
      count: count(row.count, `popular_paths[${index}].count`),
      uniques: count(row.uniques, `popular_paths[${index}].uniques`),
    })),
    recent_events: events.slice(0, 100).map((event, index) => ({
      type: String(event.type || ''),
      created_at: timestamp(event.created_at, `recent_events[${index}].created_at`),
    })),
  };
}

function validateHistory(history, expected) {
  if (!history || history.schema !== 1 || !Array.isArray(history.snapshots)) throw new Error('Existing acquisition history is corrupt or unsupported');
  if (history.date !== expected.date || history.repository !== expected.repository) {
    throw new Error(`Existing acquisition history mismatch for ${expected.repository} on ${expected.date}`);
  }
  for (const snapshot of history.snapshots) {
    let capturedAt;
    try {
      capturedAt = timestamp(snapshot?.captured_at, 'history snapshot captured_at');
    } catch {
      throw new Error('Existing acquisition history contains a corrupt snapshot');
    }
    const trafficValid = summary => summary && Number.isFinite(summary.count) && Number.isFinite(summary.uniques);
    const metricsValid = ['stars', 'forks', 'watchers'].every(key => Number.isFinite(snapshot?.[key]));
    const listsValid = ['referrers', 'popular_paths', 'recent_events'].every(key => Array.isArray(snapshot?.[key]));
    if (snapshot?.schema !== 1 || snapshot.repository !== expected.repository || !capturedAt.startsWith(`${expected.date}T`)
      || !metricsValid || !trafficValid(snapshot.views) || !trafficValid(snapshot.clones) || !listsValid) {
      throw new Error('Existing acquisition history contains a mismatched snapshot');
    }
  }
}

function appendSnapshot(snapshot, outputRoot = process.cwd()) {
  if (!snapshot || snapshot.schema !== 1) throw new Error('Snapshot schema must be 1');
  parseRepository(snapshot.repository);
  timestamp(snapshot.captured_at, 'snapshot.captured_at');
  const date = snapshot.captured_at.slice(0, 10);
  const directory = path.resolve(outputRoot, '.planning', 'acquisition');
  const filePath = path.join(directory, `${date}.json`);
  fs.mkdirSync(directory, { recursive: true });
  let history = { schema: 1, date, repository: snapshot.repository, snapshots: [] };
  if (fs.existsSync(filePath)) {
    try {
      history = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      throw new Error(`Existing acquisition history is corrupt: ${filePath}`);
    }
    validateHistory(history, { date, repository: snapshot.repository });
  }
  history.snapshots.push(snapshot);
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(history, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
  return { filePath, history };
}

module.exports = {
  API_VERSION,
  appendSnapshot,
  fetchCombinedResponse,
  githubHeaders,
  normalizeSnapshot,
  parseRepository,
  redactSecrets,
  requestGitHub,
  validateHistory,
};
