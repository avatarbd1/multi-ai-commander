import assert from 'node:assert/strict';
import test from 'node:test';
import { ManagedBuilderRunner } from '../dist/execution/managed-builder-runner.js';
import { PublicationOrchestrator } from '../dist/publication/publication-orchestrator.js';
import { evaluateCommitBoundCi } from '../dist/ci/commit-bound-gate.js';
import { IndependentReviewerRunner } from '../dist/review/independent-reviewer-runner.js';
import { runManagedCommander } from '../dist/orchestration/run-managed.js';

const target = {
  alias: 'Commander',
  repository: 'avatarbd1/multi-ai-commander',
  baseBranch: 'main',
  locked: true,
};

const task = {
  id: 'T-managed',
  title: 'Managed execution test',
  targetRepository: target.repository,
  baseBranch: 'main',
  objective: 'Prove managed build through human gate',
  acceptanceCriteria: [{ id: 'A1', requirement: 'managed flow works', evidenceRequired: ['ci'] }],
  constraints: [],
  riskLevel: 'low',
  productionMutationAllowed: false,
};

test('ManagedBuilderRunner invokes active builder and executes verification automatically', async () => {
  let cleaned = false;
  const workspace = {
    async prepare() { return { path: process.cwd(), branch: 'commander/T-managed-deadbeef' }; },
    async collectChanges() { return [{ path: 'src/new.ts', status: 'added', content: 'export {};' }]; },
    async cleanup() { cleaned = true; },
  };
  const planner = {
    async plan() {
      return [{ name: 'test', executable: process.execPath, args: ['-e', 'process.exit(0)'] }];
    },
  };
  const provider = {
    name: 'builder-a',
    mode: 'active',
    async build(input) {
      assert.equal(input.baseSha, 'deadbeef');
      return {
        provider: 'builder-a',
        capturedAt: new Date().toISOString(),
        payload: { summary: 'built safely', knownLimitations: [] },
      };
    },
  };
  const runner = new ManagedBuilderRunner(provider, workspace, planner);
  const result = await runner.run(task, target, 'deadbeef');
  assert.equal(result.tests[0].conclusion, 'success');
  assert.deepEqual(result.changedFiles, ['src/new.ts']);
  assert.equal(cleaned, true);
});

test('ManagedBuilderRunner repair continuity: workspace starts from the previous attempt\'s exact SHA, not the original base', async () => {
  let prepareArgs;
  const workspace = {
    async prepare(taskId, tgt, baseSha, start) {
      prepareArgs = { taskId, baseSha, start };
      return { path: process.cwd(), branch: 'commander/T-managed-deadbeef' };
    },
    async collectChanges(_path, diffBase) {
      assert.equal(diffBase, 'sha-1', 'changes must be collected relative to the previous attempt, not the original base');
      return [{ path: 'src/b.ts', status: 'added', content: 'export const b = 2;' }];
    },
    async cleanup() {},
  };
  const planner = { async plan() { return [{ name: 'test', executable: process.execPath, args: ['-e', 'process.exit(0)'] }]; } };
  const provider = {
    name: 'builder-a',
    mode: 'active',
    async build(input) {
      assert.equal(input.baseSha, 'sha-1', 'the Builder is told its workspace starts at the previous attempt\'s SHA');
      assert.equal(input.repair.kind, 'repair');
      return { provider: 'builder-a', capturedAt: new Date().toISOString(), payload: { summary: 'fixed b', knownLimitations: [] } };
    },
  };
  const repair = {
    kind: 'repair', attempt: 2, task, acceptanceCriteria: task.acceptanceCriteria,
    previousBuilderSummary: 'built a', previousChangedFiles: ['src/a.ts'],
    previousBuilderSha: 'sha-1', pullRequestNumber: 5, pullRequestHeadSha: 'sha-1',
    failingLocalChecks: [], reviewerFindings: [{ name: 'bug:medium', detail: 'fix b' }], verdictReasons: ['NEEDS_FIX'],
  };

  const runner = new ManagedBuilderRunner(provider, workspace, planner);
  const result = await runner.run(task, target, 'deadbeef', repair);

  assert.equal(prepareArgs.baseSha, 'deadbeef', 'the deterministic branch name is still derived from the ORIGINAL locked base');
  assert.deepEqual(prepareArgs.start, { ref: 'commander/T-managed-deadbeef', sha: 'sha-1' });
  assert.equal(result.baseSha, 'sha-1');
  assert.deepEqual(result.changedFiles, ['src/b.ts'], 'only the true incremental repair delta, not a reconstruction of attempt 1');
});

test('ManagedBuilderRunner repair continuity: a repair before any publish (no previous SHA) still starts from the locked base', async () => {
  let prepareArgs;
  const workspace = {
    async prepare(taskId, tgt, baseSha, start) { prepareArgs = { baseSha, start }; return { path: process.cwd(), branch: 'commander/T-managed-deadbeef' }; },
    async collectChanges(_path, diffBase) { assert.equal(diffBase, 'deadbeef'); return [{ path: 'src/a.ts', status: 'added', content: 'export const a = 1;' }]; },
    async cleanup() {},
  };
  const planner = { async plan() { return [{ name: 'test', executable: process.execPath, args: ['-e', 'process.exit(0)'] }]; } };
  const provider = { name: 'builder-a', mode: 'active', async build() { return { provider: 'builder-a', capturedAt: new Date().toISOString(), payload: { summary: 'fixed', knownLimitations: [] } }; } };
  const repair = {
    kind: 'repair', attempt: 2, task, acceptanceCriteria: task.acceptanceCriteria,
    previousBuilderSummary: 'attempt 1 failed local verification', previousChangedFiles: ['src/a.ts'],
    failingLocalChecks: [{ name: 'test', detail: 'failure (exit=1)' }], reviewerFindings: [], verdictReasons: [],
  };

  const runner = new ManagedBuilderRunner(provider, workspace, planner);
  const result = await runner.run(task, target, 'deadbeef', repair);

  assert.equal(prepareArgs.start, undefined, 'no prior publish means no prior SHA to start from');
  assert.equal(result.baseSha, 'deadbeef');
});

test('ManagedBuilderRunner repair continuity fails closed when previousBuilderSha and pullRequestHeadSha disagree', async () => {
  const workspace = {
    async prepare() { throw new Error('must not be reached: the mismatch is caught before touching the workspace'); },
    async collectChanges() { throw new Error('unreachable'); },
    async cleanup() {},
  };
  const planner = { async plan() { return []; } };
  const provider = { name: 'builder-a', mode: 'active', async build() { throw new Error('must not be reached'); } };
  const repair = {
    kind: 'repair', attempt: 2, task, acceptanceCriteria: task.acceptanceCriteria,
    previousBuilderSummary: 's', previousChangedFiles: [],
    previousBuilderSha: 'sha-1', pullRequestNumber: 5, pullRequestHeadSha: 'sha-DIFFERENT',
    failingLocalChecks: [], reviewerFindings: [], verdictReasons: [],
  };

  const runner = new ManagedBuilderRunner(provider, workspace, planner);
  await assert.rejects(
    () => runner.run(task, target, 'deadbeef', repair),
    (error) => error instanceof Error && error.message === 'REPAIR_EVIDENCE_SHA_MISMATCH',
  );
});

test('PublicationOrchestrator publishes file changes and binds BuilderOutput to exact PR head', async () => {
  let currentSha = 'base-sha';
  const calls = [];
  const client = {
    async createBranch(repository, branch, baseSha) { calls.push(['branch', repository, branch, baseSha]); return baseSha; },
    async getFileMetadata(_repository, path) {
      if (path === 'old.ts' || path === 'delete.ts') return { sha: `blob-${path}` };
      return null;
    },
    async createOrUpdateFile(input) { calls.push(['write', input.path]); currentSha = `sha-${calls.length}`; return { commitSha: currentSha }; },
    async deleteFile(input) { calls.push(['delete', input.path]); currentSha = `sha-${calls.length}`; return { commitSha: currentSha }; },
    async createPullRequest(repository, input) {
      calls.push(['pr', input.draft]);
      return {
        repository, number: 8, title: task.title, state: 'open', headSha: currentSha,
        headBranch: input.head, baseBranch: input.base, draft: true,
        changedFiles: ['new.ts', 'old.ts', 'delete.ts'], url: 'https://example/pr/8',
      };
    },
  };
  const work = {
    taskId: task.id, provider: 'builder-a', summary: 'done', branch: 'commander/T-managed-base', baseSha: 'base-sha',
    changedFiles: ['new.ts', 'old.ts', 'delete.ts'],
    changes: [
      { path: 'new.ts', status: 'added', content: 'new' },
      { path: 'old.ts', status: 'modified', content: 'changed' },
      { path: 'delete.ts', status: 'deleted' },
    ],
    tests: [{ name: 'test', command: 'npm test', conclusion: 'success' }], knownLimitations: [],
  };
  const published = await new PublicationOrchestrator(client).publish(task, target, work);
  assert.equal(published.builder.commitSha, currentSha);
  assert.equal(published.pullRequest.draft, true);
  assert.equal(published.builder.pullRequestNumber, 8);
});

test('PublicationOrchestrator repair publish updates the SAME PR/branch with only the repair delta, leaving attempt-1 files untouched', async () => {
  // Simulates the branch's real remote state after attempt 1 already
  // published a.ts: it exists on the branch. The repair's own diff (item
  // 3/6 of the fix) only concerns b.ts -- a.ts must never be written again
  // or otherwise erased just because it isn't part of this attempt's delta.
  let currentSha = 'sha-1';
  const calls = [];
  const client = {
    async createBranch() { throw new Error('must not create a new branch on a repair'); },
    async getFileMetadata(_repository, path) {
      if (path === 'a.ts') return { sha: 'blob-a-from-attempt-1' };
      return null;
    },
    async createOrUpdateFile(input) {
      calls.push(input.path);
      assert.equal(input.path, 'b.ts', 'attempt 1\'s a.ts must never be re-written by a repair that did not touch it');
      currentSha = 'sha-2';
      return { commitSha: currentSha };
    },
    async deleteFile() { throw new Error('the repair delta has no deletions'); },
    async createPullRequest() { throw new Error('must reuse the existing PR, not create a new one'); },
    async getPullRequest(repository, number) {
      assert.equal(number, 5);
      return {
        repository, number, title: task.title, state: 'open', headSha: currentSha,
        headBranch: 'commander/T-managed-base', baseBranch: 'main', draft: true,
        changedFiles: ['a.ts', 'b.ts'], url: 'https://example/pr/5',
      };
    },
  };
  const repairWork = {
    taskId: task.id, provider: 'builder-a', summary: 'fixed b', branch: 'commander/T-managed-base', baseSha: 'sha-1',
    changedFiles: ['b.ts'],
    changes: [{ path: 'b.ts', status: 'added', content: 'export const b = 2;' }],
    tests: [{ name: 'test', command: 'npm test', conclusion: 'success' }], knownLimitations: [],
  };
  const published = await new PublicationOrchestrator(client).publish(task, target, repairWork, {
    branch: 'commander/T-managed-base', pullRequestNumber: 5,
  });
  assert.deepEqual(calls, ['b.ts']);
  assert.equal(published.builder.commitSha, 'sha-2');
  assert.equal(published.pullRequest.number, 5);
});

test('LocalGitWorkspaceManager fails closed when the locked base SHA no longer matches the real remote branch', async () => {
  const { LocalGitWorkspaceManager } = await import('../dist/execution/managed-builder-runner.js');
  const manager = new LocalGitWorkspaceManager();
  await assert.rejects(
    () => manager.prepare('T-git-check', target, '0000000000000000000000000000000000000000'),
    (error) => error instanceof Error && error.message === 'BASE_SHA_MOVED',
  );
});

test('LocalGitWorkspaceManager fails closed when a repair\'s expected previous SHA does not match the real remote branch', async () => {
  const { LocalGitWorkspaceManager } = await import('../dist/execution/managed-builder-runner.js');
  const manager = new LocalGitWorkspaceManager();
  await assert.rejects(
    () => manager.prepare('T-git-check', target, 'deadbeef', { ref: 'main', sha: '0000000000000000000000000000000000000000' }),
    (error) => error instanceof Error && error.message === 'REPAIR_START_SHA_MISMATCH',
  );
});

test('commit-bound CI gate fails closed and passes only exact all-success evidence', () => {
  assert.equal(evaluateCommitBoundCi('abc', { commitSha: 'def', checks: [] }).code, 'CI_SHA_MISMATCH');
  assert.equal(evaluateCommitBoundCi('abc', { commitSha: 'abc', checks: [] }).code, 'CI_MISSING');
  assert.equal(evaluateCommitBoundCi('abc', { commitSha: 'abc', checks: [{ name: 'verify', conclusion: 'pending' }] }).code, 'CI_PENDING');
  assert.equal(evaluateCommitBoundCi('abc', { commitSha: 'abc', checks: [{ name: 'verify', conclusion: 'success' }] }).passed, true);
});

test('IndependentReviewerRunner fetches exact remote diff and enforces provider independence', async () => {
  let diffFetched = false;
  const builder = {
    taskId: task.id, provider: 'builder-a', summary: 'done', branch: 'branch', commitSha: 'abc',
    changedFiles: ['a.ts'], tests: [], knownLimitations: [],
  };
  const pullRequest = {
    repository: target.repository, number: 9, title: 'PR', state: 'open', headSha: 'abc', headBranch: 'branch',
    baseBranch: 'main', draft: true, changedFiles: ['a.ts'], url: 'https://example/pr/9',
  };
  const ci = { commitSha: 'abc', checks: [{ name: 'verify', conclusion: 'success' }] };
  const provider = {
    name: 'reviewer-b', mode: 'active',
    async review(input) {
      assert.match(input.diff, /diff --git/);
      return {
        provider: 'reviewer-b', capturedAt: new Date().toISOString(),
        payload: {
          taskId: task.id, provider: 'reviewer-b', independentFromBuilder: true,
          findings: [], requirements: [{ criterionId: 'A1', satisfied: true, evidence: ['diff', 'ci'] }],
          recommendation: 'approve',
        },
      };
    },
  };
  const runner = new IndependentReviewerRunner(provider, {
    async getPullRequestDiff() { diffFetched = true; return 'diff --git a/a.ts b/a.ts\n'; },
  });
  const report = await runner.run({ task, builder, pullRequest, ci });
  assert.equal(diffFetched, true);
  assert.equal(report.recommendation, 'approve');
});

test('runManagedCommander integrates build, publish, CI, independent review, verdict and human gate', async () => {
  const client = {
    async getRepository(repository) { return { fullName: repository }; },
    async getBranchHead() { return 'base123'; },
    async getCiEvidence(_repository, sha) { return { commitSha: sha, checks: [{ name: 'verify', conclusion: 'success' }] }; },
  };
  const work = {
    taskId: task.id, provider: 'builder-a', summary: 'done', branch: 'commander/T-managed-base123', baseSha: 'base123',
    changedFiles: ['a.ts'], changes: [{ path: 'a.ts', status: 'added', content: 'x' }],
    tests: [{ name: 'test', command: 'npm test', conclusion: 'success' }], knownLimitations: [],
  };
  const builder = {
    taskId: task.id, provider: 'builder-a', summary: 'done', branch: work.branch, commitSha: 'head123', pullRequestNumber: 10,
    changedFiles: ['a.ts'], tests: work.tests, knownLimitations: [],
  };
  const pullRequest = {
    repository: target.repository, number: 10, title: task.title, state: 'open', headSha: 'head123',
    headBranch: work.branch, baseBranch: 'main', draft: true, changedFiles: ['a.ts'], url: 'https://example/pr/10',
  };
  const review = {
    taskId: task.id, provider: 'reviewer-b', independentFromBuilder: true, findings: [],
    requirements: [{ criterionId: 'A1', satisfied: true, evidence: ['ci'] }], recommendation: 'approve',
  };
  const result = await runManagedCommander(task, {
    client,
    builderRunner: { async run() { return work; } },
    publication: { async publish() { return { builder, pullRequest }; } },
    reviewer: { async run() { return review; } },
    ci: { maxAttempts: 1, intervalMs: 0 },
  });
  assert.equal(result.state, 'HUMAN_GATE');
  assert.equal(result.decision.verdict, 'PASS');
  assert.equal(result.pullRequest.number, 10);
});
