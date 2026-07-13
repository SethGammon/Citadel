#!/usr/bin/env node

'use strict';

const { main } = require('../core/cli/package-cli');

Promise.resolve(main(process.argv.slice(2))).then((status) => {
  if (Number.isInteger(status) && status !== 0) process.exitCode = status;
}).catch((error) => {
  process.stderr.write(`citadel: ${error.message}\n`);
  process.exitCode = 1;
});
