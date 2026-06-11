#!/usr/bin/env node

'use strict';

// OTLP/HTTP metrics exporter for Citadel JSONL telemetry.
//
// The hash-chained JSONL files under .planning/telemetry/ remain the system
// of record. This script translates new records into the protobuf-JSON
// encoding of ExportMetricsServiceRequest and POSTs them to an OTLP/HTTP
// collector. A state file holds a byte offset per source file so repeat runs
// export only new records. On any failed POST the state is not advanced, so
// the next run retries the same records.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const { resolveTelemetryPaths } = require('../core/telemetry/log');

const STATE_FILE_NAME = 'otlp-export-state.json';
const SCOPE_NAME = 'citadel.telemetry-otlp-export';
const SCOPE_VERSION = '1.0.0';
const AGGREGATION_TEMPORALITY_DELTA = 1;
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_OTLP_METRICS_PATH = '/v1/metrics';

function parseArgs(argv) {
  const args = {
    projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    endpoint: null,
    dryRun: false,
    reset: false,
    help: false,
    errors: [],
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--endpoint') {
      args.endpoint = argv[index + 1] || null;
      index++;
    } else if (arg === '--project-root') {
      args.projectRoot = path.resolve(argv[index + 1] || process.cwd());
      index++;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--reset') {
      args.reset = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      args.errors.push(`unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return [
    'Usage: node scripts/telemetry-otlp-export.js [--endpoint url] [--dry-run] [--reset] [--project-root path]',
    '',
    'Exports new Citadel telemetry JSONL records as OTLP/HTTP JSON metrics.',
    '',
    '  --endpoint url      OTLP collector base url. Defaults to OTEL_EXPORTER_OTLP_ENDPOINT.',
    `                      When the url has no path, ${DEFAULT_OTLP_METRICS_PATH} is appended.`,
    '  --dry-run           Print the OTLP JSON payload to stdout. No POST, state not advanced.',
    '  --reset             Clear stored byte offsets so the next export starts from the beginning.',
    '  --project-root path Project root containing .planning/telemetry (default: cwd).',
    '',
    'The JSONL files stay canonical; this exporter never modifies them.',
  ].join('\n');
}

function toUnixNano(timestamp) {
  if (typeof timestamp !== 'string' || !timestamp) return null;
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return null;
  return (BigInt(Math.trunc(ms)) * 1000000n).toString();
}

function toAttributes(pairs) {
  const attributes = [];
  for (const [key, raw] of Object.entries(pairs)) {
    if (raw === null || raw === undefined) continue;
    attributes.push({ key, value: { stringValue: String(raw) } });
  }
  return attributes;
}

function createMetricSet() {
  return {
    'citadel.session.cost.usd': { unit: 'USD', type: 'sum', monotonic: true, dataPoints: [] },
    'citadel.session.tokens': { unit: '{token}', type: 'sum', monotonic: true, dataPoints: [] },
    'citadel.hook.duration.ms': { unit: 'ms', type: 'gauge', dataPoints: [] },
    'citadel.agent.runs': { unit: '{run}', type: 'sum', monotonic: true, dataPoints: [] },
  };
}

// session-costs.jsonl (schema 2): timestamp, session_id, campaign_slug,
// estimated_cost, override_cost, real_cost, input_tokens, output_tokens,
// cache_creation_input_tokens, cache_read_input_tokens, ...
function mapSessionCost(record, metrics) {
  const nano = toUnixNano(record.timestamp);
  if (!nano) return null;

  let points = 0;
  const base = {
    'session.id': record.session_id,
    'campaign.slug': record.campaign_slug,
  };

  let cost = null;
  let source = null;
  if (typeof record.real_cost === 'number' && Number.isFinite(record.real_cost)) {
    cost = record.real_cost;
    source = 'real';
  } else if (typeof record.override_cost === 'number' && Number.isFinite(record.override_cost)) {
    cost = record.override_cost;
    source = 'override';
  } else if (typeof record.estimated_cost === 'number' && Number.isFinite(record.estimated_cost)) {
    cost = record.estimated_cost;
    source = 'estimated';
  }

  if (cost !== null) {
    metrics['citadel.session.cost.usd'].dataPoints.push({
      startTimeUnixNano: nano,
      timeUnixNano: nano,
      asDouble: cost,
      attributes: toAttributes({ ...base, 'cost.source': source }),
    });
    points++;
  }

  const tokenFields = [
    ['input', record.input_tokens],
    ['output', record.output_tokens],
    ['cache_creation', record.cache_creation_input_tokens],
    ['cache_read', record.cache_read_input_tokens],
  ];
  for (const [tokenType, value] of tokenFields) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    metrics['citadel.session.tokens'].dataPoints.push({
      startTimeUnixNano: nano,
      timeUnixNano: nano,
      asInt: String(Math.round(value)),
      attributes: toAttributes({ ...base, 'token.type': tokenType }),
    });
    points++;
  }

  return points;
}

// hook-timing.jsonl (schema 1): timing entries carry hook + duration_ms,
// counter entries carry hook + metric and have no duration mapping.
function mapHookTiming(record, metrics) {
  const nano = toUnixNano(record.timestamp);
  if (!nano) return null;
  if (record.event !== 'timing') return 0;
  if (typeof record.duration_ms !== 'number' || !Number.isFinite(record.duration_ms)) return 0;
  if (typeof record.hook !== 'string' || !record.hook) return 0;

  metrics['citadel.hook.duration.ms'].dataPoints.push({
    timeUnixNano: nano,
    asDouble: record.duration_ms,
    attributes: toAttributes({ 'hook.name': record.hook }),
  });
  return 1;
}

// agent-runs.jsonl (schema 1): timestamp, event (agent-start, agent-complete,
// agent-fail, campaign-*, wave-*, agent-timeout), agent, status, campaign_slug.
function mapAgentRun(record, metrics) {
  const nano = toUnixNano(record.timestamp);
  if (!nano) return null;
  if (typeof record.event !== 'string' || !record.event) return 0;

  metrics['citadel.agent.runs'].dataPoints.push({
    startTimeUnixNano: nano,
    timeUnixNano: nano,
    asInt: '1',
    attributes: toAttributes({
      'agent.name': record.agent || 'unknown',
      'run.event': record.event,
      'run.status': record.status || 'unknown',
      'campaign.slug': record.campaign_slug,
    }),
  });
  return 1;
}

// Reads bytes appended since storedOffset. Returns only complete lines; an
// unterminated tail is included only when it already parses as JSON, otherwise
// it is left for the next run. When the file shrank below the stored offset
// (truncation or rotation) the offset resets to 0.
function readNewChunk(filePath, storedOffset) {
  if (!fs.existsSync(filePath)) {
    return { lines: [], nextOffset: 0, reset: storedOffset > 0 };
  }

  const size = fs.statSync(filePath).size;
  let offset = storedOffset;
  let reset = false;
  if (size < offset) {
    offset = 0;
    reset = true;
  }
  if (size === offset) {
    return { lines: [], nextOffset: offset, reset };
  }

  const buffer = Buffer.alloc(size - offset);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    fs.closeSync(fd);
  }

  const chunk = buffer.toString('utf8');
  const segments = chunk.split('\n');
  let rawLines;
  let consumedBytes;

  if (chunk.endsWith('\n')) {
    rawLines = segments.slice(0, -1);
    consumedBytes = buffer.length;
  } else {
    const tail = segments[segments.length - 1];
    let tailParses = false;
    try {
      JSON.parse(tail);
      tailParses = true;
    } catch (error) {
      tailParses = false;
    }
    if (tailParses) {
      rawLines = segments;
      consumedBytes = buffer.length;
    } else {
      rawLines = segments.slice(0, -1);
      consumedBytes = buffer.length - Buffer.byteLength(tail, 'utf8');
    }
  }

  const lines = rawLines
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.trim() !== '');

  return { lines, nextOffset: offset + consumedBytes, reset };
}

function loadState(stateFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.offsets && typeof parsed.offsets === 'object') {
      return { version: 1, offsets: parsed.offsets };
    }
  } catch (error) {
    // Missing or corrupt state file: start from the beginning of each file.
  }
  return { version: 1, offsets: {} };
}

function saveState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}

function buildPayload(metrics, projectName) {
  const metricEntries = [];
  for (const [name, def] of Object.entries(metrics)) {
    if (def.dataPoints.length === 0) continue;
    const entry = { name, unit: def.unit };
    if (def.type === 'gauge') {
      entry.gauge = { dataPoints: def.dataPoints };
    } else {
      entry.sum = {
        aggregationTemporality: AGGREGATION_TEMPORALITY_DELTA,
        isMonotonic: def.monotonic === true,
        dataPoints: def.dataPoints,
      };
    }
    metricEntries.push(entry);
  }

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: toAttributes({
            'service.name': 'citadel',
            'citadel.project': projectName,
          }),
        },
        scopeMetrics: [
          {
            scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
            metrics: metricEntries,
          },
        ],
      },
    ],
  };
}

function resolveEndpoint(raw) {
  const url = new URL(raw);
  if (!url.pathname || url.pathname === '/') {
    url.pathname = DEFAULT_OTLP_METRICS_PATH;
  }
  return url;
}

function postPayload(endpointUrl, payload) {
  return new Promise((resolve, reject) => {
    const transport = endpointUrl.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const request = transport.request(
      endpointUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    request.on('error', reject);
    request.end(data);
  });
}

function summarize(metrics, malformed) {
  const parts = [];
  for (const [name, def] of Object.entries(metrics)) {
    if (def.dataPoints.length > 0) parts.push(`${name}: ${def.dataPoints.length}`);
  }
  const pointsLine = parts.length > 0 ? parts.join(', ') : 'no data points';
  const malformedLine = `Skipped ${malformed} malformed line(s).`;
  return { pointsLine, malformedLine };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.errors.length > 0) {
    for (const error of args.errors) console.error(`error: ${error}`);
    console.error(usage());
    return 1;
  }

  const paths = resolveTelemetryPaths(args.projectRoot);
  const stateFile = path.join(paths.telemetryDir, STATE_FILE_NAME);

  if (args.reset) {
    saveState(stateFile, { version: 1, offsets: {} });
    console.log(`State offsets cleared: ${stateFile}`);
    if (!args.dryRun && !args.endpoint && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      return 0;
    }
  }

  const sources = [
    { name: 'session-costs.jsonl', file: paths.sessionCosts, map: mapSessionCost },
    { name: 'hook-timing.jsonl', file: paths.hookTiming, map: mapHookTiming },
    { name: 'agent-runs.jsonl', file: paths.agentRuns, map: mapAgentRun },
  ];

  const state = loadState(stateFile);
  const metrics = createMetricSet();
  const nextOffsets = { ...state.offsets };
  let malformed = 0;
  let totalPoints = 0;

  for (const source of sources) {
    const stored = Number.isFinite(state.offsets[source.name]) ? state.offsets[source.name] : 0;
    const { lines, nextOffset, reset } = readNewChunk(source.file, stored);
    if (reset) {
      console.error(`note: ${source.name} is smaller than the stored offset, re-reading from the start`);
    }
    for (const line of lines) {
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        malformed++;
        continue;
      }
      const points = source.map(record, metrics);
      if (points === null) {
        malformed++;
        continue;
      }
      totalPoints += points;
    }
    nextOffsets[source.name] = nextOffset;
  }

  const payload = buildPayload(metrics, path.basename(args.projectRoot));
  const { pointsLine, malformedLine } = summarize(metrics, malformed);

  if (args.dryRun) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    console.error(`Dry run: ${totalPoints} data point(s) (${pointsLine}). ${malformedLine} State not advanced.`);
    return 0;
  }

  if (totalPoints === 0) {
    saveState(stateFile, { version: 1, offsets: nextOffsets });
    console.log(`No new data points to export. ${malformedLine}`);
    return 0;
  }

  const rawEndpoint = args.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!rawEndpoint) {
    console.error('error: no endpoint. Use --endpoint <url> or set OTEL_EXPORTER_OTLP_ENDPOINT.');
    console.error(usage());
    return 1;
  }

  let endpointUrl;
  try {
    endpointUrl = resolveEndpoint(rawEndpoint);
  } catch (error) {
    console.error(`error: invalid endpoint url: ${rawEndpoint}`);
    return 1;
  }

  let response;
  try {
    response = await postPayload(endpointUrl, payload);
  } catch (error) {
    console.error(`error: POST ${endpointUrl.href} failed: ${error.message}`);
    console.error('State not advanced. The next run will retry the same records.');
    return 1;
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const detail = (response.body || '').slice(0, 300);
    console.error(`error: collector returned HTTP ${response.statusCode}${detail ? `: ${detail}` : ''}`);
    console.error('State not advanced. The next run will retry the same records.');
    return 1;
  }

  saveState(stateFile, { version: 1, offsets: nextOffsets });
  console.log(`Exported ${totalPoints} data point(s) to ${endpointUrl.href} (${pointsLine}). ${malformedLine}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
