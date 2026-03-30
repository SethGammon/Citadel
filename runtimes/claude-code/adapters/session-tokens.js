#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const HARDCODED_PRICING = {
  'claude-opus-4-6': { input: 5.00, output: 25.00, cacheCreation: 6.25, cacheRead: 0.50 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheCreation: 3.75, cacheRead: 0.30 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00, cacheCreation: 1.25, cacheRead: 0.10 },
  _default: { input: 3.00, output: 15.00, cacheCreation: 3.75, cacheRead: 0.30 },
};

function loadPricing() {
  try {
    const pricingPath = path.join(__dirname, 'pricing.json');
    if (fs.existsSync(pricingPath)) {
      const data = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
      const merged = { ...HARDCODED_PRICING };
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('_') && key !== '_default') continue;
        if (value && typeof value === 'object' && typeof value.input === 'number') {
          merged[key] = value;
        }
      }
      return merged;
    }
  } catch {}

  return HARDCODED_PRICING;
}

const PRICING = loadPricing();

function normalizeModel(model) {
  if (!model) return '_default';
  const normalized = model.toLowerCase();
  if (normalized.includes('opus')) return 'claude-opus-4-6';
  if (normalized.includes('sonnet')) return 'claude-sonnet-4-6';
  if (normalized.includes('haiku')) return 'claude-haiku-4-5';
  return '_default';
}

function getPricing(model) {
  return PRICING[normalizeModel(model)] || PRICING._default;
}

function getProjectSlug() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const normalized = projectDir.replace(/\\/g, '/');
  return normalized.replace(/^\//, '').replace(/:/g, '-').replace(/\//g, '-');
}

function getSessionsDir() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const slug = getProjectSlug();
  return path.join(home, '.claude', 'projects', slug);
}

function listSessionIds(sessionsDir) {
  if (!fs.existsSync(sessionsDir)) return [];
  return fs.readdirSync(sessionsDir)
    .filter((fileName) => fileName.endsWith('.jsonl') && !fileName.includes('subagent'))
    .map((fileName) => fileName.replace('.jsonl', ''))
    .sort();
}

function parseTokensFromFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    messages: 0,
    models: {},
    first_timestamp: null,
    last_timestamp: null,
  };

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const usage = entry.message?.usage;
    if (!usage) continue;

    totals.input_tokens += usage.input_tokens || 0;
    totals.output_tokens += usage.output_tokens || 0;
    totals.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
    totals.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
    totals.messages++;

    const model = entry.message?.model || 'unknown';
    totals.models[model] = (totals.models[model] || 0) + 1;

    if (entry.timestamp) {
      if (!totals.first_timestamp || entry.timestamp < totals.first_timestamp) {
        totals.first_timestamp = entry.timestamp;
      }
      if (!totals.last_timestamp || entry.timestamp > totals.last_timestamp) {
        totals.last_timestamp = entry.timestamp;
      }
    }
  }

  return totals.messages > 0 ? totals : null;
}

function readSessionTokens(sessionId, sessionsDir) {
  const dir = sessionsDir || getSessionsDir();
  const mainFile = path.join(dir, `${sessionId}.jsonl`);
  const main = parseTokensFromFile(mainFile);
  if (!main) return null;

  const subagentDir = path.join(dir, sessionId, 'subagents');
  const subagents = [];
  if (fs.existsSync(subagentDir)) {
    const files = fs.readdirSync(subagentDir).filter((fileName) => fileName.endsWith('.jsonl'));
    for (const fileName of files) {
      const tokens = parseTokensFromFile(path.join(subagentDir, fileName));
      if (!tokens) continue;
      subagents.push({
        agentId: fileName.replace('.jsonl', ''),
        ...tokens,
      });
    }
  }

  const combined = {
    input_tokens: main.input_tokens,
    output_tokens: main.output_tokens,
    cache_creation_input_tokens: main.cache_creation_input_tokens,
    cache_read_input_tokens: main.cache_read_input_tokens,
    messages: main.messages,
    models: { ...main.models },
    first_timestamp: main.first_timestamp,
    last_timestamp: main.last_timestamp,
  };

  for (const subagent of subagents) {
    combined.input_tokens += subagent.input_tokens;
    combined.output_tokens += subagent.output_tokens;
    combined.cache_creation_input_tokens += subagent.cache_creation_input_tokens;
    combined.cache_read_input_tokens += subagent.cache_read_input_tokens;
    combined.messages += subagent.messages;
    for (const [model, count] of Object.entries(subagent.models)) {
      combined.models[model] = (combined.models[model] || 0) + count;
    }
    if (subagent.first_timestamp && (!combined.first_timestamp || subagent.first_timestamp < combined.first_timestamp)) {
      combined.first_timestamp = subagent.first_timestamp;
    }
    if (subagent.last_timestamp && (!combined.last_timestamp || subagent.last_timestamp > combined.last_timestamp)) {
      combined.last_timestamp = subagent.last_timestamp;
    }
  }

  return { main, subagents, combined };
}

function computeCostWithPricing(tokens, pricing) {
  const million = 1_000_000;
  const cost =
    (tokens.input_tokens / million) * pricing.input +
    (tokens.output_tokens / million) * pricing.output +
    (tokens.cache_creation_input_tokens / million) * pricing.cacheCreation +
    (tokens.cache_read_input_tokens / million) * pricing.cacheRead;
  return Math.round(cost * 10000) / 10000;
}

function computeCost(tokens) {
  if (!tokens || tokens.messages === 0) return 0;

  const modelNames = Object.keys(tokens.models);
  if (modelNames.length <= 1) {
    return computeCostWithPricing(tokens, getPricing(modelNames[0]));
  }

  let dominantModel = modelNames[0];
  let maxCount = 0;
  for (const [model, count] of Object.entries(tokens.models)) {
    if (count > maxCount) {
      dominantModel = model;
      maxCount = count;
    }
  }

  return computeCostWithPricing(tokens, getPricing(dominantModel));
}

function getLatestSessionId() {
  const sessionsDir = getSessionsDir();
  const ids = listSessionIds(sessionsDir);
  if (ids.length === 0) return null;

  let latest = null;
  let latestMtime = 0;
  for (const id of ids) {
    try {
      const stat = fs.statSync(path.join(sessionsDir, `${id}.jsonl`));
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latest = id;
      }
    } catch {}
  }

  return latest;
}

function getCurrentSessionId() {
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return getLatestSessionId();
}

function readAllSessions(opts = {}) {
  const sessionsDir = getSessionsDir();
  const ids = listSessionIds(sessionsDir);
  const sessions = [];
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    messages: 0,
    total_cost: 0,
    session_count: 0,
    subagent_count: 0,
  };

  for (const id of ids) {
    if (opts.since) {
      try {
        const stat = fs.statSync(path.join(sessionsDir, `${id}.jsonl`));
        if (stat.mtime < new Date(opts.since)) continue;
      } catch {
        continue;
      }
    }

    const result = readSessionTokens(id, sessionsDir);
    if (!result) continue;

    const cost = computeCost(result.combined);
    const duration = result.combined.first_timestamp && result.combined.last_timestamp
      ? (new Date(result.combined.last_timestamp) - new Date(result.combined.first_timestamp)) / 60000
      : 0;

    sessions.push({
      sessionId: id,
      ...result.combined,
      cost,
      duration_minutes: Math.round(duration),
      subagent_count: result.subagents.length,
    });

    totals.input_tokens += result.combined.input_tokens;
    totals.output_tokens += result.combined.output_tokens;
    totals.cache_creation_input_tokens += result.combined.cache_creation_input_tokens;
    totals.cache_read_input_tokens += result.combined.cache_read_input_tokens;
    totals.messages += result.combined.messages;
    totals.total_cost += cost;
    totals.session_count++;
    totals.subagent_count += result.subagents.length;
  }

  totals.total_cost = Math.round(totals.total_cost * 100) / 100;
  return { sessions, totals };
}

module.exports = {
  PRICING,
  computeCost,
  computeCostWithPricing,
  getCurrentSessionId,
  getLatestSessionId,
  getPricing,
  getSessionsDir,
  listSessionIds,
  normalizeModel,
  readAllSessions,
  readSessionTokens,
};
