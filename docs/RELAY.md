# Citadel Relay contract

Relay remains demand-gated and optional. The local repository is authoritative whether Relay is available, unavailable, or never configured.

The local contract encrypts bounded operation events with AES-256-GCM and queues them under `.planning/relay/outbox/`. An outage retains every message locally. Successful delivery removes only the accepted outbox copy. Relay payloads recursively reject prompts, source, tokens, secrets, credentials, and absolute paths. Outbox filenames are derived only from validated message IDs, and outbox readers reject symlinked entries.

This is a transport seam, not a hosted service. Hosting, identity, mobile delivery, retention, support, and uptime remain external work until the Relay demand gate is met.
