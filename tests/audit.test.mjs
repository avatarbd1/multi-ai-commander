import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditChain } from '../dist/audit/hash-chain.js';

test('audit chain is append-only and verifies', async () => {
  const audit = new AuditChain();
  const first = await audit.append('task.contract', { id: 'TASK-1' }, '2026-08-24T00:00:00.000Z');
  const second = await audit.append('review.report', { verdict: 'approve' }, '2026-08-24T00:01:00.000Z');
  assert.equal(second.previousHash, first.hash);
  assert.equal(await audit.verify(), true);
  assert.equal(audit.all().length, 2);
  assert.match(audit.toJsonl(), /task\.contract/);
});
