import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGitHubConclusion, toCiEvidence } from '../dist/github/types.js';

test('pending check is fail-closed as pending', () => {
  assert.equal(normalizeGitHubConclusion('in_progress', null), 'pending');
});

test('unknown completed conclusion is normalized to failure', () => {
  assert.equal(normalizeGitHubConclusion('completed', 'timed_out'), 'failure');
});

test('GitHub check runs normalize into CI evidence', () => {
  const evidence = toCiEvidence('abc', [{ name: 'web-ci', status: 'completed', conclusion: 'success' }]);
  assert.deepEqual(evidence, { commitSha: 'abc', checks: [{ name: 'web-ci', conclusion: 'success' }] });
});
