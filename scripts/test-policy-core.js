#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
  checkProtectedBranchDeletion,
  detectExternalAction,
  readExternalActionPolicy,
  stripQuotedContent,
} = require('../core/policy/external-actions');

const defaultPolicy = readExternalActionPolicy({});
assert(defaultPolicy.protectedBranches.includes('main'), 'default policy should protect main');
assert.equal(
  checkProtectedBranchDeletion('git push origin --delete main', defaultPolicy.protectedBranches),
  'main'
);

const stripped = stripQuotedContent('echo "gh pr merge" && git push origin feat/test');
assert(!stripped.includes('gh pr merge'), 'quoted content should be stripped before matching');

const secret = detectExternalAction('cat .env.local', defaultPolicy);
assert.equal(secret.kind, 'secret', 'secret reads should be detected');

const protectedBranch = detectExternalAction('git push origin --delete main', defaultPolicy);
assert.equal(protectedBranch.kind, 'protected-branch', 'protected branch deletion should be detected');

const soft = detectExternalAction('git push origin feat/test', defaultPolicy);
assert.equal(soft.tier, 'allow', 'git push should be allowed by default');

const prCreate = detectExternalAction('gh pr create --title test --body test', defaultPolicy);
assert.equal(prCreate.tier, 'allow', 'gh pr create should be allowed by default');

const hard = detectExternalAction('gh release create v1.0.0', defaultPolicy);
assert.equal(hard.tier, 'hard', 'release create should be hard-tier by default');

console.log('policy core tests passed');
