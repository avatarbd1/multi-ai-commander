import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCommanderDecision } from '../dist/commander/verdict.js';

const task = {
  id: 'TASK-1',
  title: 'Test feature',
  targetRepository: 'avatarbd1/relife-owner-app',
  baseBranch: 'main',
  objective: 'Ship a safe change',
  acceptanceCriteria: [{ id: 'AC1', requirement: 'Tests pass', evidenceRequired: ['CI'] }],
  constraints: ['No production deploy'],
  riskLevel: 'medium',
  productionMutationAllowed: false,
};
const builder = {
  taskId: 'TASK-1', provider: 'builder-ai', summary: 'Implemented', branch: 'feat/test', commitSha: 'abc123',
  changedFiles: ['src/a.ts'], tests: [{ name: 'unit', command: 'npm test', conclusion: 'success' }], knownLimitations: [],
};
const review = {
  taskId: 'TASK-1', provider: 'reviewer-ai', independentFromBuilder: true, findings: [],
  requirements: [{ criterionId: 'AC1', satisfied: true, evidence: ['CI green'] }], recommendation: 'approve',
};
const ci = { commitSha: 'abc123', checks: [
  { name: 'lint', conclusion: 'success' }, { name: 'typecheck', conclusion: 'success' },
  { name: 'test', conclusion: 'success' }, { name: 'build', conclusion: 'success' },
] };

test('PASS when contract, independent review, requirements and CI all pass', () => {
  const result = evaluateCommanderDecision({ task, builder, review, ci, now: '2026-08-24T00:00:00.000Z' });
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.humanGateRequired, true);
  assert.equal(result.automaticProductionDeploy, false);
});

test('BLOCKED when CI fails', () => {
  const result = evaluateCommanderDecision({ task, builder, review, ci: { ...ci, checks: [{ name: 'test', conclusion: 'failure' }] } });
  assert.equal(result.verdict, 'BLOCKED');
});

test('BLOCKED when builder and reviewer are the same provider', () => {
  const result = evaluateCommanderDecision({ task, builder, review: { ...review, provider: builder.provider }, ci });
  assert.equal(result.verdict, 'BLOCKED');
});

test('NEEDS_FIX when an acceptance criterion is unsatisfied', () => {
  const result = evaluateCommanderDecision({
    task, builder, review: { ...review, requirements: [{ criterionId: 'AC1', satisfied: false, evidence: [] }] }, ci,
  });
  assert.equal(result.verdict, 'NEEDS_FIX');
});

test('BLOCKED when CI evidence targets a different commit', () => {
  const result = evaluateCommanderDecision({ task, builder, review, ci: { ...ci, commitSha: 'different' } });
  assert.equal(result.verdict, 'BLOCKED');
});
