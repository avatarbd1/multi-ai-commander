import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli, parseCliArgs, normalizeTaskContract } from '../dist/cli/run.js';

const VALID_ENV = {
  COMMANDER_GH_APP_ID: '123456',
  COMMANDER_GH_INSTALLATION_ID: '99',
  COMMANDER_GH_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  COMMANDER_PLANNER_COMMAND: '/usr/bin/true',
  COMMANDER_BUILDER_COMMAND: '/usr/bin/true',
  COMMANDER_REVIEWER_COMMAND: '/usr/bin/true',
};

const VALID_TASK = {
  id: 'T-cli',
  title: 'CLI test task',
  targetRepository: 'Commander',
  objective: 'Prove the CLI wiring works',
  acceptanceCriteria: [{ id: 'A1', requirement: 'CLI reaches human gate', evidenceRequired: ['pr'] }],
  constraints: [],
  riskLevel: 'low',
  productionMutationAllowed: false,
};

function makeRuntimeConfig() {
  return {
    planner: { name: 'chatgpt-planner', executable: '/usr/bin/true', args: [], env: {}, timeoutMs: 1000, maxOutputBytes: 1024 },
    builder: { name: 'claude', executable: '/usr/bin/true', args: [], env: {}, timeoutMs: 1000, maxOutputBytes: 1024 },
    reviewer: { name: 'independent-reviewer', executable: '/usr/bin/true', args: [], env: {}, timeoutMs: 1000, maxOutputBytes: 1024 },
    ci: { maxAttempts: 1, intervalMs: 0 },
    githubApp: { appId: '123456', installationId: 99, privateKey: 'fake' },
    repairPolicy: { maxRepairCycles: 2 },
  };
}

function humanGateResult() {
  return {
    state: 'HUMAN_GATE',
    attempts: 1,
    finalSha: 'deadbeef',
    decision: {
      taskId: VALID_TASK.id,
      verdict: 'PASS',
      reasons: ['All acceptance criteria and CI gates passed'],
      humanGateRequired: true,
      automaticProductionDeploy: false,
      evaluatedAt: new Date().toISOString(),
    },
    pullRequest: {
      repository: 'avatarbd1/multi-ai-commander',
      number: 42,
      title: VALID_TASK.title,
      state: 'open',
      headSha: 'deadbeef',
      headBranch: 'commander/t-cli',
      baseBranch: 'main',
      draft: true,
      changedFiles: ['a.ts'],
      url: 'https://example.test/pr/42',
    },
    audit: { all: () => [1, 2, 3] },
  };
}

function blockedResult() {
  return {
    state: 'BLOCKED',
    attempts: 3,
    blocker: 'REPAIR_LIMIT_EXCEEDED',
    audit: { all: () => [1] },
  };
}

function fullMockDeps(overrides = {}) {
  return {
    env: { ...VALID_ENV },
    readTaskFile: async () => JSON.stringify(VALID_TASK),
    loadRuntimeConfig: () => makeRuntimeConfig(),
    createGitHubClient: async () => ({ marker: 'fake-client' }),
    createBuilderProvider: () => ({ name: 'claude', mode: 'active', build: async () => { throw new Error('unused in this test'); } }),
    createReviewerProvider: () => ({ name: 'independent-reviewer', mode: 'active', review: async () => { throw new Error('unused in this test'); } }),
    verifyGitHubApp: async () => ({ satisfied: true, violations: [] }),
    runOrchestration: async () => humanGateResult(),
    ...overrides,
  };
}

test('parseCliArgs requires the run subcommand', () => {
  assert.throws(() => parseCliArgs([]), /Usage: commander run/);
  assert.throws(() => parseCliArgs(['status']), /Usage: commander run/);
});

test('parseCliArgs requires --task with a value', () => {
  assert.throws(() => parseCliArgs(['run']), /--task/);
  assert.throws(() => parseCliArgs(['run', '--task']), /--task/);
});

test('parseCliArgs accepts --task <path> and --task=<path> forms', () => {
  assert.deepEqual(parseCliArgs(['run', '--task', 'x.json']), { taskPath: 'x.json' });
  assert.deepEqual(parseCliArgs(['run', '--task=x.json']), { taskPath: 'x.json' });
});

test('normalizeTaskContract resolves a supported alias to its canonical repository', () => {
  const task = normalizeTaskContract({ ...VALID_TASK, targetRepository: 'commander' });
  assert.equal(task.targetRepository, 'avatarbd1/multi-ai-commander');
  assert.equal(task.baseBranch, 'main');
});

test('CLI input validation: missing --task argument fails closed with exit code 2', async () => {
  const { exitCode, result } = await runCli(['run'], fullMockDeps());
  assert.equal(exitCode, 2);
  assert.equal(result.status, 'ERROR');
  assert.match(result.error, /--task/);
});

test('CLI input validation: malformed task JSON fails closed with exit code 2', async () => {
  const { exitCode, result } = await runCli(['run', '--task', 'x.json'], fullMockDeps({ readTaskFile: async () => '{not json' }));
  assert.equal(exitCode, 2);
  assert.match(result.error, /TASK_FILE_INVALID/);
});

test('CLI input validation: incomplete task contract fails closed with exit code 2', async () => {
  const incomplete = { ...VALID_TASK, acceptanceCriteria: [] };
  const { exitCode, result } = await runCli(['run', '--task', 'x.json'], fullMockDeps({ readTaskFile: async () => JSON.stringify(incomplete) }));
  assert.equal(exitCode, 2);
  assert.match(result.error, /TASK_CONTRACT_INVALID/);
});

test('unsupported target repository fails closed with exit code 2 before any provider or GitHub call', async () => {
  const badTarget = { ...VALID_TASK, targetRepository: 'not-a-real-target' };
  let githubCalled = false;
  const { exitCode, result } = await runCli(
    ['run', '--task', 'x.json'],
    fullMockDeps({
      readTaskFile: async () => JSON.stringify(badTarget),
      createGitHubClient: async () => { githubCalled = true; return { marker: 'fake' }; },
    }),
  );
  assert.equal(exitCode, 2);
  assert.match(result.error, /UNSUPPORTED_TARGET_REPOSITORY/);
  assert.equal(githubCalled, false);
});

test('missing runtime configuration fails closed with exit code 2', async () => {
  const { exitCode, result } = await runCli(
    ['run', '--task', 'x.json'],
    fullMockDeps({
      loadRuntimeConfig: () => { throw new Error('Missing required runtime configuration: COMMANDER_BUILDER_COMMAND'); },
    }),
  );
  assert.equal(exitCode, 2);
  assert.match(result.error, /Missing required runtime configuration/);
});

test('same Builder/Reviewer identity is rejected end-to-end through the real runtime config loader', async () => {
  // Deliberately omit loadRuntimeConfig from the overrides so runCli falls
  // through to its real default (loadRuntimeConfigFromEnv), proving the
  // collision is caught by the actual production config loader, not a mock.
  const { loadRuntimeConfig, ...withoutConfigMock } = fullMockDeps({
    env: { ...VALID_ENV, COMMANDER_BUILDER_NAME: 'shared', COMMANDER_REVIEWER_NAME: 'shared' },
  });
  const { exitCode, result } = await runCli(['run', '--task', 'x.json'], withoutConfigMock);
  assert.equal(exitCode, 2);
  assert.match(result.error, /different provider identities/i);
});

test('a GitHub App authentication failure (broker/client construction itself fails) is BLOCKED/ERROR with zero repair attempts', async () => {
  let orchestrationCalled = false;
  const { exitCode, result } = await runCli(
    ['run', '--task', 'x.json'],
    fullMockDeps({
      createGitHubClient: async () => { throw new Error('COMMANDER_GH_PRIVATE_KEY is not a valid RSA private key'); },
      runOrchestration: async () => { orchestrationCalled = true; return humanGateResult(); },
    }),
  );
  assert.equal(exitCode, 2);
  assert.equal(result.status, 'ERROR');
  assert.match(result.error, /COMMANDER_GH_PRIVATE_KEY/);
  assert.equal(result.attempts, undefined);
  assert.equal(orchestrationCalled, false);
});

test('GitHub App installation/permission failure fails closed with exit code 2 and never reaches the pipeline (zero repair attempts)', async () => {
  let orchestrationCalled = false;
  const { exitCode, result } = await runCli(
    ['run', '--task', 'x.json'],
    fullMockDeps({
      verifyGitHubApp: async () => ({ satisfied: false, violations: ["Installation permission 'contents' is 'read', requires at least 'write'"] }),
      runOrchestration: async () => { orchestrationCalled = true; return humanGateResult(); },
    }),
  );
  assert.equal(exitCode, 2);
  assert.match(result.error, /GITHUB_APP_VALIDATION_FAILED/);
  assert.equal(result.githubAppValidation.satisfied, false);
  assert.equal(result.attempts, undefined);
  assert.equal(orchestrationCalled, false);
});

test('successful mocked end-to-end run reaches HUMAN_GATE with exit code 0', async () => {
  const { exitCode, result } = await runCli(['run', '--task', 'x.json'], fullMockDeps());
  assert.equal(exitCode, 0);
  assert.equal(result.status, 'HUMAN_GATE');
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.pullRequest.number, 42);
  assert.equal(result.auditEventCount, 3);
  assert.equal(result.attempts, 1);
  assert.equal(result.finalSha, 'deadbeef');
});

test('a failing pipeline stage returns BLOCKED with a nonzero exit code', async () => {
  const { exitCode, result } = await runCli(['run', '--task', 'x.json'], fullMockDeps({ runOrchestration: async () => blockedResult() }));
  assert.equal(exitCode, 1);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.lastFailure, 'REPAIR_LIMIT_EXCEEDED');
  assert.equal(result.attempts, 3);
});
