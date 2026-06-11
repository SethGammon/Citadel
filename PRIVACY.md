# Privacy

Citadel runs entirely on your machine. It does not collect, transmit, or sell
any data.

- All state lives in your repository under `.planning/` and `.claude/` or
  `.codex/`. Nothing is sent anywhere by Citadel itself.
- Telemetry (cost, hook timing, audit records) is written to local JSONL files
  in `.planning/telemetry/`. It never leaves your machine unless you run the
  optional OTLP exporter, which sends metrics only to the endpoint you specify.
- Model API calls are made by your runtime (Claude Code or OpenAI Codex) under
  your own account and their respective privacy policies. Citadel adds no
  additional services, accounts, or network calls.
- The interactive demo site is static and sets no cookies.

Questions: open an issue at https://github.com/SethGammon/Citadel/issues.
