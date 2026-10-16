'use strict';

// Loaded by Node before the declared adapter entry point. Do not propagate the
// registration into descendants or allow adapter execution after a failed write.
const fs = require('fs');
const registration = JSON.parse(process.env.CITADEL_CHECKPOINT_REGISTRATION);
delete process.env.CITADEL_CHECKPOINT_REGISTRATION;
const fd = fs.openSync(registration.file, 'wx', 0o600);
try {
  fs.writeFileSync(fd, JSON.stringify({ schema: 1, pid: process.pid, payload_digest: registration.payload_digest }) + '\n');
  fs.fsyncSync(fd);
} finally { fs.closeSync(fd); }
