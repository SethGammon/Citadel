/**
 * COMPAT-16: Size limit guard
 * Validates AGENTS.md truncation at 32 KiB.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const MAX_SIZE = 32 * 1024; // 32 KiB

async function run() {
  const errors = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-size-test-'));

  try {
    // Test 1: File under limit should be unchanged
    const smallContent = '# Small AGENTS.md\n\nThis is fine.\n';
    const smallPath = path.join(tmpDir, 'AGENTS-small.md');
    fs.writeFileSync(smallPath, smallContent);

    const smallSize = fs.statSync(smallPath).size;
    if (smallSize > MAX_SIZE) {
      errors.push('Small test file unexpectedly exceeds 32 KiB');
    }

    // Test 2: File over limit should be detectable
    const bigContent = '# Large AGENTS.md\n\n' + 'x'.repeat(MAX_SIZE + 1000) + '\n';
    const bigPath = path.join(tmpDir, 'AGENTS-big.md');
    fs.writeFileSync(bigPath, bigContent);

    const bigSize = fs.statSync(bigPath).size;
    if (bigSize <= MAX_SIZE) {
      errors.push('Large test file should exceed 32 KiB');
    }

    // Test 3: Truncation logic
    const truncated = bigContent.slice(0, MAX_SIZE - 50) + '\n<!-- truncated by Citadel -->\n';
    if (truncated.length >= MAX_SIZE + 100) {
      errors.push('Truncation logic should produce content under the limit');
    }
    if (!truncated.includes('<!-- truncated by Citadel -->')) {
      errors.push('Truncated content should include marker');
    }

    // Test 4: Verify the guard function works
    function guardAgentsMd(content) {
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes <= MAX_SIZE) return { truncated: false, content };
      const marker = '\n<!-- truncated by Citadel -->\n';
      const trimmedContent = content.slice(0, MAX_SIZE - Buffer.byteLength(marker, 'utf8'));
      return { truncated: true, content: trimmedContent + marker };
    }

    const r1 = guardAgentsMd(smallContent);
    if (r1.truncated) errors.push('Small content should not be truncated');
    if (r1.content !== smallContent) errors.push('Small content should be unchanged');

    const r2 = guardAgentsMd(bigContent);
    if (!r2.truncated) errors.push('Large content should be truncated');
    if (!r2.content.includes('<!-- truncated by Citadel -->')) {
      errors.push('Truncated content should include marker');
    }
    if (Buffer.byteLength(r2.content, 'utf8') > MAX_SIZE) {
      errors.push('Truncated content should be under 32 KiB');
    }

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (errors.length > 0) {
    return { pass: false, message: errors.join('; ') };
  }
  return { pass: true, message: 'AGENTS.md size guard works correctly' };
}

module.exports = { run };
