'use strict';

// Engine compatibility entrypoint. The public package owns the dependency-free
// contract implementation so desktop and browser consumers never reach into core/.
module.exports = require('../../packages/contracts/app');
