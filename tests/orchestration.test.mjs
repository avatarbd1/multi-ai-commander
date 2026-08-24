import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTargetForBuild } from '../dist/orchestration/prepare-target.js';
import {
  canTransitionOrchestrationState,
  isTerminalOrchestrationState,
  transitionOrchestrationState,
} from '../dist/orchestration/state-machine.js';
import { resolveTargetRepository } from '../dist/orchestration/target-resolver.js';
import { verifyLiveTargetAccess } from '../dist/orchestration/live-target-access.js';

test('target resolver locks Commander, Owner, and ClinicOS to exact repositories', () => {
  assert.equal(resolveTargetRepository('Commander').repository, 'avatarbd1/multi-ai-commander');
  assert.equal(resolveTargetRepository('Owner').repository, 'avatarbd1/relife-owner-app');
  assert.equal(resolveTargetRepository('ClinicOS').repository, 'avatarbd1/relife-clinic-os');
});

test('target resolver accepts canonical repository names and rejects unknown targets', () => {
  assert.equal(
    resolveTargetRepository('avatarbd1/relife-owner-app').alias,
    'Owner',
  );
  assert.throws(() => resolveTargetRepository('avatarbd1/other-repo'), /UNSUPPORTED_TARGET_REPOSITORY/);
});

test('state machine allows only forward gated transitions', () => {
  assert.equal(canTransitionOrchestrationState('TARGET_LOCK', 'TARGET_ACCESS_VERIFY'), true);
  assert.equal(canTransitionOrchestrationState('TARGET_ACCESS_VERIFY', 'BUILD'), true);
  assert.equal(canTransitionOrchestrationState('BUILD', 'PUBLISH'), false);
  assert.throws(
    () => transitionOrchestrationState('BUILD', 'PUBLISH'),
    /INVALID_ORCHESTRATION_TRANSITION/,
  );
  assert.equal(isTerminalOrchestrationState('HUMAN_GATE'), true);
  assert.equal(isTerminalOrchestrationState('BLOCKED'), true);
});

test('live target access succeeds only when GitHub returns the locked repository', async () => {
  const target = resolveTargetRepository('Owner');
  const client = {
    async getRepository(repository) {
      return { fullName: repository };
    },
  };
  const result = await verifyLiveTargetAccess(client, target);
  assert.equal(result.authorized, true);
  assert.equal(result.code, 'LIVE_TARGET_ACCESS_VERIFIED');
});

test('live target access fails closed on GitHub errors or repository mismatch', async () => {
  const target = resolveTargetRepository('ClinicOS');
  const denied = await verifyLiveTargetAccess(
    { async getRepository() { throw new Error('denied'); } },
    target,
  );
  assert.equal(denied.authorized, false);
  assert.equal(denied.code, 'TARGET_REPOSITORY_NOT_AUTHORIZED');

  const mismatch = await verifyLiveTargetAccess(
    { async getRepository() { return { fullName: 'avatarbd1/relife-owner-app' }; } },
    target,
  );
  assert.equal(mismatch.authorized, false);
  assert.equal(mismatch.code, 'TARGET_REPOSITORY_NOT_AUTHORIZED');
});

test('prepare target advances to BUILD only after live access verification', async () => {
  const allowed = await prepareTargetForBuild(
    { async getRepository(repository) { return { fullName: repository }; } },
    'Owner',
  );
  assert.equal(allowed.state, 'BUILD');
  assert.equal(allowed.target?.repository, 'avatarbd1/relife-owner-app');
  assert.equal(allowed.access?.code, 'LIVE_TARGET_ACCESS_VERIFIED');

  const blocked = await prepareTargetForBuild(
    { async getRepository() { throw new Error('not installed'); } },
    'ClinicOS',
  );
  assert.equal(blocked.state, 'BLOCKED');
  assert.equal(blocked.access?.code, 'TARGET_REPOSITORY_NOT_AUTHORIZED');
});

test('prepare target blocks unsupported repositories before any GitHub call', async () => {
  let calls = 0;
  const result = await prepareTargetForBuild(
    { async getRepository() { calls += 1; return { fullName: 'unexpected' }; } },
    'avatarbd1/untrusted-repo',
  );
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.errorCode, 'UNSUPPORTED_TARGET_REPOSITORY');
  assert.equal(calls, 0);
});
