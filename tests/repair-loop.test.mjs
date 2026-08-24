import assert from 'node:assert/strict';
import test from 'node:test';
import { runManagedCommander } from '../dist/orchestration/run-managed.js';
import { createRepairPolicy } from '../dist/orchestration/repair-policy.js';
import { IndependentReviewerRunner } from '../dist/review/independent-reviewer-runner.js';

const target = { alias: 'Commander', repository: 'avatarbd1/multi-ai-commander', baseBranch: 'main', locked: true };
const BRANCH = 'commander/t-repair-basehead';

function makeTask(overrides = {}) {
  return {
    id: 'T-repair',
    title: 'Repair loop test',
    targetRepository: target.repository,
    baseBranch: 'main',
    objective: 'Prove the bounded self-correcting repair loop',
    acceptanceCriteria: [{ id: 'A1', requirement: 'the task is actually done', evidenceRequired: ['ci'] }],
    constraints: [],
    riskLevel: 'low',
    productionMutationAllowed: false,
    ...overrides,
  };
}

function makeClient({ baseHeads = ['basehead'], ciByCommit = {}, ciCalls } = {}) {
  let baseHeadCallIndex = 0;
  return {
    async getRepository() {
      return { fullName: target.repository };
    },
    async getBranchHead() {
      const value = baseHeads[Math.min(baseHeadCallIndex, baseHeads.length - 1)];
      baseHeadCallIndex += 1;
      return value;
    },
    async getCiEvidence(_repository, sha) {
      if (ciCalls) ciCalls.push(sha);
      return ciByCommit[sha] ?? { commitSha: sha, checks: [] };
    },
  };
}

function makeBuilderRunner(handlers) {
  let call = 0;
  const repairContexts = [];
  const runner = {
    async run(task, tgt, baseSha, repair) {
      const index = Math.min(call, handlers.length - 1);
      call += 1;
      repairContexts.push(repair);
      const handler = handlers[index];
      const outcome = handler({ callIndex: call, repair, baseSha });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return { runner, repairContexts, get callCount() { return call; } };
}

function makePublication(results) {
  let call = 0;
  const calls = [];
  const stub = {
    async publish(task, tgt, work, existing) {
      calls.push({ branch: work.branch, existing });
      const index = Math.min(call, results.length - 1);
      call += 1;
      const outcome = results[index];
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return { stub, calls };
}

// Builds an ActiveReviewProvider ({name, mode, review()}) -- the protocol
// IndependentReviewerRunner actually drives -- not the Runner itself.
function makeReviewer(results, name = 'reviewer-b') {
  let call = 0;
  const calls = [];
  const provider = {
    name,
    mode: 'active',
    async review(input) {
      calls.push({ pullRequestHeadSha: input.pullRequest.headSha, ciCommitSha: input.ci.commitSha });
      const index = Math.min(call, results.length - 1);
      call += 1;
      const outcome = results[index];
      if (outcome instanceof Error) throw outcome;
      return { provider: name, capturedAt: new Date().toISOString(), payload: outcome };
    },
  };
  return { provider, calls };
}

function work(overrides = {}) {
  return {
    taskId: 'T-repair',
    provider: 'builder-a',
    summary: 'did the work',
    branch: BRANCH,
    baseSha: 'basehead',
    changedFiles: ['a.ts'],
    changes: [{ path: 'a.ts', status: 'added', content: 'v1' }],
    tests: [{ name: 'test', command: 'npm test', conclusion: 'success', evidence: 'exit=0' }],
    knownLimitations: [],
    ...overrides,
  };
}

function pr(overrides = {}) {
  return {
    repository: target.repository,
    number: 1,
    title: 'Repair loop test',
    state: 'open',
    headSha: 'sha-1',
    headBranch: BRANCH,
    baseBranch: 'main',
    draft: true,
    changedFiles: ['a.ts'],
    url: 'https://example.test/pr/1',
    ...overrides,
  };
}

function approveReview(overrides = {}) {
  return {
    taskId: 'T-repair',
    provider: 'reviewer-b',
    independentFromBuilder: true,
    findings: [],
    requirements: [{ criterionId: 'A1', satisfied: true, evidence: ['ci'] }],
    recommendation: 'approve',
    ...overrides,
  };
}

function needsFixReview(overrides = {}) {
  return {
    taskId: 'T-repair',
    provider: 'reviewer-b',
    independentFromBuilder: true,
    findings: [{ id: 'F1', severity: 'medium', category: 'bug', message: 'off-by-one in the loop' }],
    requirements: [{ criterionId: 'A1', satisfied: false, evidence: [] }],
    recommendation: 'changes_requested',
    ...overrides,
  };
}

// --- 1. first attempt succeeds -> HUMAN_GATE, attempts = 1 ---

test('first attempt succeeds -> HUMAN_GATE with attempts = 1', async () => {
  const client = makeClient({ ciByCommit: { 'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'success' }] } } });
  const { runner } = makeBuilderRunner([() => work()]);
  const { stub: publication } = makePublication([{ builder: { taskId: 'T-repair', provider: 'builder-a', summary: 'did the work', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: work().tests, knownLimitations: [] }, pullRequest: pr() }]);
  const { provider: reviewer } = makeReviewer([approveReview()]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'HUMAN_GATE');
  assert.equal(result.attempts, 1);
  assert.equal(result.decision.verdict, 'PASS');
  assert.equal(result.finalSha, 'sha-1');
});

// --- 2. local verification fails -> repair -> verification succeeds -> CI PASS -> review PASS -> HUMAN_GATE ---

test('local verification failure repairs, then reaches HUMAN_GATE', async () => {
  const client = makeClient({ ciByCommit: { 'sha-2': { commitSha: 'sha-2', checks: [{ name: 'verify', conclusion: 'success' }] } } });
  const { runner, repairContexts } = makeBuilderRunner([
    () => work({ tests: [{ name: 'test', command: 'npm test', conclusion: 'failure', evidence: 'exit=1' }] }),
    ({ repair }) => {
      assert.equal(repair.kind, 'repair');
      assert.equal(repair.attempt, 2);
      assert(repair.failingLocalChecks.length > 0);
      assert.equal(repair.pullRequestNumber, undefined, 'no PR exists yet before the first successful publish');
      return work({ changes: [{ path: 'a.ts', status: 'added', content: 'v2-fixed' }] });
    },
  ]);
  const { stub: publication, calls: publishCalls } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 'did the work', branch: BRANCH, commitSha: 'sha-2', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-2' }) },
  ]);
  const { provider: reviewer } = makeReviewer([approveReview()]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'HUMAN_GATE');
  assert.equal(result.attempts, 2);
  assert.equal(publishCalls.length, 1, 'publish only happens once local verification actually passes');
  assert.equal(repairContexts.length, 2);
  assert.equal(repairContexts[0], undefined, 'first call carries no repair context');
});

// --- 3. CI fails on SHA-1 -> repair creates SHA-2 -> SHA-2 CI PASS -> Reviewer reviews SHA-2 -> HUMAN_GATE ---

test('CI failure on SHA-1 repairs to SHA-2, which passes CI and is reviewed', async () => {
  const ciCalls = [];
  const client = makeClient({
    ciCalls,
    ciByCommit: {
      'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'failure' }] },
      'sha-2': { commitSha: 'sha-2', checks: [{ name: 'verify', conclusion: 'success' }] },
    },
  });
  const { runner } = makeBuilderRunner([
    () => work(),
    ({ repair }) => {
      assert.equal(repair.ciFailure.commitSha, 'sha-1');
      assert(repair.ciFailure.failingChecks.some((d) => d.name === 'verify'));
      return work({ changes: [{ path: 'a.ts', status: 'added', content: 'v2-fixed' }] });
    },
  ]);
  const { stub: publication, calls: publishCalls } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 'did the work', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-1', number: 5 }) },
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 'did the work', branch: BRANCH, commitSha: 'sha-2', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-2', number: 5 }) },
  ]);
  const { provider: reviewer, calls: reviewCalls } = makeReviewer([approveReview()]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'HUMAN_GATE');
  assert.equal(result.attempts, 2);
  assert.equal(result.finalSha, 'sha-2');
  assert.equal(ciCalls[0], 'sha-1');
  assert.equal(ciCalls[1], 'sha-2');
  assert.equal(reviewCalls.length, 1, 'the reviewer is never invoked for the failing SHA-1 attempt');
  assert.equal(reviewCalls[0].pullRequestHeadSha, 'sha-2');
  assert.equal(reviewCalls[0].ciCommitSha, 'sha-2');
  // item D: the second publish updates the SAME PR/branch, not a new one.
  assert.equal(publishCalls[1].existing.pullRequestNumber, 5);
  assert.equal(publishCalls[1].existing.branch, BRANCH);
});

// --- 4. Reviewer NEEDS_FIX -> structured repair request -> Builder fixes -> new exact SHA -> Reviewer PASS -> HUMAN_GATE ---

test('Reviewer NEEDS_FIX repairs to a new exact SHA that the reviewer then approves', async () => {
  const client = makeClient({
    ciByCommit: {
      'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'success' }] },
      'sha-2': { commitSha: 'sha-2', checks: [{ name: 'verify', conclusion: 'success' }] },
    },
  });
  const { runner } = makeBuilderRunner([
    () => work(),
    ({ repair }) => {
      assert.equal(repair.kind, 'repair');
      assert(repair.reviewerFindings.length > 0);
      assert(repair.verdictReasons.length > 0);
      assert.equal(repair.previousBuilderSha, 'sha-1');
      assert.equal(repair.pullRequestHeadSha, 'sha-1');
      return work({ changes: [{ path: 'a.ts', status: 'added', content: 'v2-fixed' }] });
    },
  ]);
  const { stub: publication } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 'did the work', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-1', number: 7 }) },
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 'did the work', branch: BRANCH, commitSha: 'sha-2', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-2', number: 7 }) },
  ]);
  const { provider: reviewer } = makeReviewer([needsFixReview(), approveReview()]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'HUMAN_GATE');
  assert.equal(result.attempts, 2);
  assert.equal(result.decision.verdict, 'PASS');
});

// --- 5. Reviewer repeatedly NEEDS_FIX -> repair limit reached -> BLOCKED ---

test('repeated NEEDS_FIX exhausts the default repair limit and stops BLOCKED (never HUMAN_GATE)', async () => {
  const client = makeClient({
    ciByCommit: {
      'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'success' }] },
      'sha-2': { commitSha: 'sha-2', checks: [{ name: 'verify', conclusion: 'success' }] },
      'sha-3': { commitSha: 'sha-3', checks: [{ name: 'verify', conclusion: 'success' }] },
    },
  });
  const { runner } = makeBuilderRunner([
    () => work({ changes: [{ path: 'a.ts', status: 'added', content: 'v1' }] }),
    () => work({ changes: [{ path: 'a.ts', status: 'added', content: 'v2' }] }),
    () => work({ changes: [{ path: 'a.ts', status: 'added', content: 'v3' }] }),
  ]);
  const { stub: publication } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-1', number: 9 }) },
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-2', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-2', number: 9 }) },
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-3', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-3', number: 9 }) },
  ]);
  // Distinct finding text each time so the change (not the outcome) is what varies -- proves this is the LIMIT, not no-progress detection.
  const { provider: reviewer } = makeReviewer([
    needsFixReview({ findings: [{ id: 'F1', severity: 'medium', category: 'bug', message: 'issue 1' }] }),
    needsFixReview({ findings: [{ id: 'F2', severity: 'medium', category: 'bug', message: 'issue 2' }] }),
    needsFixReview({ findings: [{ id: 'F3', severity: 'medium', category: 'bug', message: 'issue 3' }] }),
  ]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
    repairPolicy: createRepairPolicy(2),
  });

  assert.equal(result.state, 'BLOCKED');
  assert.notEqual(result.state, 'HUMAN_GATE');
  assert.equal(result.blocker, 'REPAIR_LIMIT_EXCEEDED');
  assert.equal(result.attempts, 3);
});

// --- 6. same failure / no meaningful progress -> BLOCKED early ---

test('an identical repeated local failure with no diff change is detected as no-progress and stops early', async () => {
  const client = makeClient();
  const identicalFailure = () => work({
    changes: [{ path: 'a.ts', status: 'added', content: 'same-content' }],
    tests: [{ name: 'test', command: 'npm test', conclusion: 'failure', evidence: 'exit=1' }],
  });
  const { runner } = makeBuilderRunner([identicalFailure, identicalFailure, identicalFailure]);
  const { stub: publication } = makePublication([]);
  const { provider: reviewer } = makeReviewer([]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
    repairPolicy: createRepairPolicy(2),
  });

  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.blocker, 'NO_PROGRESS_DETECTED');
  // With a repair limit of 2, exhausting it would take 3 attempts; stopping
  // at 2 proves detection short-circuited the loop rather than running it out.
  assert.equal(result.attempts, 2);
});

// --- 9. Builder/Reviewer same identity -> zero repair attempts ---

test('a builder/reviewer identity collision is non-retryable: zero repair attempts', async () => {
  const client = makeClient({ ciByCommit: { 'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'success' }] } } });
  const { runner } = makeBuilderRunner([() => work({ provider: 'same-name' })]);
  const { stub: publication } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'same-name', summary: 's', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-1' }) },
  ]);
  const collidingReviewer = { name: 'same-name', mode: 'active', async review() { throw new Error('must not be called'); } };

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(collidingReviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.blocker, 'REVIEWER_NOT_INDEPENDENT');
  assert.equal(result.attempts, 1);
});

// --- 10. SHA mismatch -> zero repair attempts ---

test('a publication SHA mismatch is non-retryable: zero repair attempts', async () => {
  const client = makeClient();
  const { runner } = makeBuilderRunner([() => work()]);
  const { stub: publication } = makePublication([new Error('PUBLISHED_PR_HEAD_MISMATCH')]);
  const { provider: reviewer } = makeReviewer([]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.blocker, 'PUBLISHED_PR_HEAD_MISMATCH');
  assert.equal(result.attempts, 1);
});

// --- 11. stale CI from a prior attempt is never accepted ---

test('CI evidence is always fetched fresh per exact SHA -- a repair never reuses the prior attempt\'s CI result', async () => {
  const ciCalls = [];
  const client = makeClient({
    ciCalls,
    ciByCommit: {
      'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'failure' }] },
      'sha-2': { commitSha: 'sha-2', checks: [{ name: 'verify', conclusion: 'success' }] },
    },
  });
  const { runner } = makeBuilderRunner([() => work(), () => work({ changes: [{ path: 'a.ts', status: 'added', content: 'v2' }] })]);
  const { stub: publication } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-1' }) },
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-2', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-2' }) },
  ]);
  const { provider: reviewer, calls: reviewCalls } = makeReviewer([approveReview()]);

  await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.deepEqual(ciCalls, ['sha-1', 'sha-2']);
  assert.equal(reviewCalls.every((call) => call.ciCommitSha !== 'sha-1'), true, 'the stale sha-1 CI evidence never reaches the reviewer');
});

// --- 12. stale Reviewer evidence from a prior attempt is never accepted ---

test('the reviewer is always invoked with the current attempt\'s exact PR head -- never a prior attempt\'s', async () => {
  const client = makeClient({
    ciByCommit: {
      'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'success' }] },
      'sha-2': { commitSha: 'sha-2', checks: [{ name: 'verify', conclusion: 'success' }] },
    },
  });
  const { runner } = makeBuilderRunner([() => work(), () => work({ changes: [{ path: 'a.ts', status: 'added', content: 'v2' }] })]);
  const { stub: publication } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-1', number: 3 }) },
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-2', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-2', number: 3 }) },
  ]);
  const { provider: reviewer, calls: reviewCalls } = makeReviewer([needsFixReview(), approveReview()]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'HUMAN_GATE');
  assert.deepEqual(reviewCalls.map((call) => call.pullRequestHeadSha), ['sha-1', 'sha-2']);
});

// --- 13. repair produces no new commit/diff -> BLOCKED ---

test('a repair that produces no changes at all is non-retryable: BLOCKED', async () => {
  const client = makeClient();
  const { runner } = makeBuilderRunner([
    () => work({ tests: [{ name: 'test', command: 'npm test', conclusion: 'failure', evidence: 'exit=1' }] }),
    () => new Error('BUILDER_PRODUCED_NO_CHANGES'),
  ]);
  const { stub: publication } = makePublication([]);
  const { provider: reviewer } = makeReviewer([]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.blocker, 'BUILDER_PRODUCED_NO_CHANGES');
  assert.equal(result.attempts, 2);
});

// --- 15. audit contains the complete multi-attempt sequence ---

test('the audit chain records the complete multi-attempt sequence and remains verifiable', async () => {
  const client = makeClient({
    ciByCommit: {
      'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'success' }] },
      'sha-2': { commitSha: 'sha-2', checks: [{ name: 'verify', conclusion: 'success' }] },
    },
  });
  const { runner } = makeBuilderRunner([() => work(), () => work({ changes: [{ path: 'a.ts', status: 'added', content: 'v2' }] })]);
  const { stub: publication } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-1', number: 4 }) },
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-2', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-2', number: 4 }) },
  ]);
  const { provider: reviewer } = makeReviewer([needsFixReview(), approveReview()]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'HUMAN_GATE');
  assert.equal(await result.audit.verify(), true);
  const eventTypes = result.audit.all().map((record) => record.eventType);
  for (const expected of [
    'task.contract', 'target.lock', 'orchestration.attempt', 'builder.work',
    'builder.output', 'pull_request.created', 'ci.evidence', 'review.report',
    'commander.verdict', 'orchestration.repair', 'pull_request.updated',
  ]) {
    assert(eventTypes.includes(expected), `expected audit to include ${expected}, got ${eventTypes.join(',')}`);
  }
  assert.equal(eventTypes.filter((t) => t === 'orchestration.attempt').length, 2);
  const repairEvent = result.audit.all().find((record) => record.eventType === 'orchestration.repair');
  assert.equal(repairEvent.payload.trigger, 'NEEDS_FIX');
  assert.equal(repairEvent.payload.fromAttempt, 1);
  assert.equal(repairEvent.payload.toAttempt, 2);
});

// --- 16. HUMAN_GATE is reached only after a final deterministic PASS ---

test('HUMAN_GATE is never reached without a final deterministic PASS verdict', async () => {
  const client = makeClient({ ciByCommit: { 'sha-1': { commitSha: 'sha-1', checks: [{ name: 'verify', conclusion: 'success' }] } } });
  const { runner } = makeBuilderRunner([() => work()]);
  const { stub: publication } = makePublication([
    { builder: { taskId: 'T-repair', provider: 'builder-a', summary: 's', branch: BRANCH, commitSha: 'sha-1', changedFiles: ['a.ts'], tests: [], knownLimitations: [] }, pullRequest: pr({ headSha: 'sha-1' }) },
  ]);
  const { provider: reviewer } = makeReviewer([needsFixReview()]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
    repairPolicy: createRepairPolicy(0),
  });

  // maxRepairCycles: 0 means no repair is ever attempted -- NEEDS_FIX with
  // no budget left must stop BLOCKED, not silently become HUMAN_GATE.
  assert.notEqual(result.state, 'HUMAN_GATE');
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.decision.verdict, 'NEEDS_FIX');
  assert.equal(result.attempts, 1);
});

// --- base branch drift (item G) ---

test('base branch drift before a repair publish fails closed instead of continuing on a stale assumption', async () => {
  const client = makeClient({ baseHeads: ['basehead', 'a-different-newer-basehead'] });
  const { runner } = makeBuilderRunner([
    () => work({ tests: [{ name: 'test', command: 'npm test', conclusion: 'failure', evidence: 'exit=1' }] }),
    () => work({ changes: [{ path: 'a.ts', status: 'added', content: 'v2' }] }),
  ]);
  const { stub: publication, calls: publishCalls } = makePublication([]);
  const { provider: reviewer } = makeReviewer([]);

  const result = await runManagedCommander(makeTask(), {
    client,
    builderRunner: runner,
    publication,
    reviewer: new IndependentReviewerRunner(reviewer, { getPullRequestDiff: async () => 'diff --git a/a.ts b/a.ts\n' }),
    ci: { maxAttempts: 1, intervalMs: 0 },
  });

  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.blocker, 'BASE_BRANCH_DRIFTED');
  assert.equal(publishCalls.length, 0, 'never publishes against a base that has since moved');
});
