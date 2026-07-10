'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
assert(readme.includes('deterministic local preparation'));
process.stdout.write('minimal fixture verification passed\n');
