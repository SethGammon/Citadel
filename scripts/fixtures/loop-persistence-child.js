'use strict';

// Owned child process for the persistence tests. Fault injection pauses after
// real filesystem operations, without adding test switches to production code.
const fs = require('fs');
const path = require('path');
const registry = require('../../core/loops/registry');
const [mode, root, id, argument] = process.argv.slice(2);
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function pause(stage) {
  fs.writeFileSync(path.join(root, `stage-${stage}`), String(process.pid));
  while (true) Atomics.wait(waitBuffer, 0, 0, 1000);
}

function interruptAt(stage) {
  const originalOpen = fs.openSync;
  const originalWrite = fs.writeFileSync;
  const originalRename = fs.renameSync;
  const temporaries = new Set();
  fs.openSync = function (file, ...args) {
    const descriptor = originalOpen.call(fs, file, ...args);
    if (String(file).endsWith('.tmp')) temporaries.add(descriptor);
    return descriptor;
  };
  fs.writeFileSync = function (file, data, ...args) {
    if (stage === 'partial' && temporaries.has(file)) {
      originalWrite.call(fs, file, String(data).slice(0, Math.floor(data.length / 2)), ...args);
      pause(stage);
    }
    return originalWrite.call(fs, file, data, ...args);
  };
  fs.renameSync = function (...args) {
    if (stage === 'before-rename') pause(stage);
    const result = originalRename.apply(fs, args);
    if (stage === 'after-rename') pause(stage);
    return result;
  };
  registry.updateLoop(root, id, { title: 'replacement', notes: ['x'.repeat(65536)] });
}

process.once('message', () => {
  let disconnectOnReturn = true;
  try {
    let result;
    if (mode === 'append') {
      let appended = 0;
      for (let index = 0; index < Number(argument); index++) {
        try {
          registry.appendLoopRun(root, id, { status: 'running', summary: `${process.pid}:${index}` });
          appended++;
        } catch (error) {
          if (error.code !== 'LOOP_TERMINAL') throw error;
          break;
        }
      }
      result = { appended };
    } else if (mode === 'register') {
      result = registry.registerLoop(root, { id, title: String(process.pid) });
    } else if (mode === 'cas') {
      result = registry.updateLoop(root, id, { title: String(process.pid) }, { expectedRevision: Number(argument) });
    } else if (mode === 'stop') {
      result = registry.stopLoop(root, id, 'stopped', 'concurrent test stop');
    } else if (mode === 'hold-reader') {
      const descriptor = fs.openSync(registry.loopPath(root, id), 'r');
      fs.writeFileSync(path.join(root, 'reader-open'), String(process.pid));
      setTimeout(() => {
        fs.writeFileSync(path.join(root, 'reader-releasing'), String(process.pid));
        fs.closeSync(descriptor);
        process.send({ result: { closed: true } });
        process.disconnect();
      }, Number(argument));
      disconnectOnReturn = false;
      return;
    } else if (mode === 'interrupt') {
      interruptAt(argument);
    } else {
      throw new Error(`Unknown test child mode ${mode}`);
    }
    process.send({ result });
  } catch (error) {
    process.send({ error: { code: error.code, message: error.message } });
  } finally {
    if (disconnectOnReturn) process.disconnect();
  }
});
process.send({ ready: true });
