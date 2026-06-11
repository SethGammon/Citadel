# OTEL Collector Demo

Two commands take Citadel telemetry from the hash-chained JSONL files under
`.planning/telemetry/` into a real OpenTelemetry Collector. The JSONL files
stay canonical; the exporter only reads them.

## 1. Start a collector (Docker)

From the repo root:

```bash
docker run --rm -p 4318:4318 \
  -v "$PWD/examples/otel-collector/otel-collector-config.yaml:/etc/otelcol/config.yaml" \
  otel/opentelemetry-collector:latest
```

PowerShell equivalent:

```powershell
docker run --rm -p 4318:4318 -v "${PWD}\examples\otel-collector\otel-collector-config.yaml:/etc/otelcol/config.yaml" otel/opentelemetry-collector:latest
```

The config receives OTLP over HTTP on port 4318 and prints every metric to
the collector's stdout (debug exporter, nothing stored or forwarded).

## 2. Export telemetry

In a second terminal, from the repo root:

```bash
node scripts/telemetry-otlp-export.js --endpoint http://localhost:4318
```

The exporter appends `/v1/metrics` to the endpoint, POSTs new records as
`citadel.session.cost.usd`, `citadel.session.tokens`, `citadel.hook.duration.ms`,
and `citadel.agent.runs`, then advances byte offsets in
`.planning/telemetry/otlp-export-state.json`. Repeat runs send only new
records. Run with `--reset` first to re-export everything from the start.

You should see the data points in the collector terminal within a second.

## No Docker?

Preview the exact OTLP JSON payload without a collector. This never POSTs
and never advances state:

```bash
node scripts/telemetry-otlp-export.js --dry-run
```

See `node scripts/telemetry-otlp-export.js --help` for all flags and the
OTLP section of `skills/telemetry/SKILL.md` for the metric mapping.
