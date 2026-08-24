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
