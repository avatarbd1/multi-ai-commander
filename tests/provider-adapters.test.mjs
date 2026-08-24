import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeBuilderAdapter } from '../dist/providers/claude-builder-adapter.js';
import { IndependentReviewerAdapter } from '../dist/providers/independent-reviewer-adapter.js';

const target = {
  alias: 'Commander',
  repository: 'avatarbd1/multi-ai-commander',
  baseBranch: 'main',
  locked: true,
};

const task = {
  id: 'T-adapter',
  title: 'Adapter test',
  targetRepository: target.repository,
  baseBranch: 'main',
  objective: 'Prove adapters delegate correctly',
  acceptanceCriteria: [{ id: 'A1', requirement: 'adapters work', evidenceRequired: ['diff'] }],
  constraints: [],
  riskLevel: 'low',
  productionMutationAllowed: false,
};

function baseConfig(overrides = {}) {
  return {
    name: 'test-provider',
    executable: process.execPath,
    args: [],
    env: {},
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
    ...overrides,
  };
}

// Builder script: reads a BuilderRequest on stdin, reports whether GitHub
// credential-shaped keys leaked into its own environment, and returns a
// BuilderResponse.
const BUILDER_ECHO_SCRIPT =
  "const fs=require('fs');" +
  "const input=JSON.parse(fs.readFileSync(0,'utf8'));" +
  "const leaked=['GITHUB_TOKEN','GH_TOKEN','COMMANDER_GH_APP_ID','COMMANDER_GH_INSTALLATION_ID','COMMANDER_GH_PRIVATE_KEY']" +
  ".filter((k)=>process.env[k]!==undefined);" +
  "process.stdout.write(JSON.stringify({summary:'built '+input.task.id+' leaked='+JSON.stringify(leaked),knownLimitations:[]}));";

const REVIEWER_ECHO_SCRIPT =
  "const fs=require('fs');" +
  "const input=JSON.parse(fs.readFileSync(0,'utf8'));" +
  "const leaked=['GITHUB_TOKEN','GH_TOKEN','COMMANDER_GH_APP_ID','COMMANDER_GH_INSTALLATION_ID','COMMANDER_GH_PRIVATE_KEY']" +
  ".filter((k)=>process.env[k]!==undefined);" +
  "process.stdout.write(JSON.stringify({" +
  "taskId:input.task.id,provider:'test-provider',independentFromBuilder:true,findings:[]," +
  "requirements:input.task.acceptanceCriteria.map((c)=>({criterionId:c.id,satisfied:true,evidence:['diff']}))," +
  "recommendation:'approve'," +
  "_leaked:leaked," +
  "_sawWorkspacePath:Object.prototype.hasOwnProperty.call(input,'workspacePath')," +
  "}));";

const NEVER_EXITS_SCRIPT = 'setInterval(() => {}, 100000);';
const INVALID_JSON_SCRIPT = "process.stdout.write('this is not json');";

test('ClaudeBuilderAdapter requires a configured executable and fails closed without one', () => {
  assert.throws(
    () => new ClaudeBuilderAdapter(baseConfig({ executable: '' })),
    (error) => error instanceof Error && error.message === 'CLAUDE_BUILDER_COMMAND_REQUIRED',
  );
});

test('IndependentReviewerAdapter requires a configured executable and fails closed without one', () => {
  assert.throws(
    () => new IndependentReviewerAdapter(baseConfig({ executable: '' })),
    (error) => error instanceof Error && error.message === 'INDEPENDENT_REVIEWER_COMMAND_REQUIRED',
  );
});

test('ClaudeBuilderAdapter delegates to the configured command and returns a captured BuilderResponse', async () => {
  const adapter = new ClaudeBuilderAdapter(baseConfig({ name: 'claude', args: ['-e', BUILDER_ECHO_SCRIPT] }));
  const captured = await adapter.build({ task, target, workspacePath: process.cwd(), baseSha: 'deadbeef', branch: 'commander/test' });
  assert.equal(captured.provider, 'claude');
  assert.match(captured.payload.summary, /built T-adapter/);
  assert.match(captured.payload.summary, /leaked=\[\]/);
});

test('IndependentReviewerAdapter delegates to the configured command and returns a captured ReviewReport', async () => {
  const adapter = new IndependentReviewerAdapter(baseConfig({ name: 'reviewer', args: ['-e', REVIEWER_ECHO_SCRIPT] }));
  const builder = { taskId: task.id, provider: 'claude', summary: 'done', branch: 'b', commitSha: 'abc', changedFiles: [], tests: [], knownLimitations: [] };
  const pullRequest = { repository: target.repository, number: 1, title: 'PR', state: 'open', headSha: 'abc', headBranch: 'b', baseBranch: 'main', draft: true, changedFiles: [], url: 'https://example/pr/1' };
  const ci = { commitSha: 'abc', checks: [{ name: 'verify', conclusion: 'success' }] };
  const captured = await adapter.review({ task, builder, pullRequest, ci, diff: 'diff --git a/x b/x\n' });
  assert.equal(captured.provider, 'reviewer');
  assert.equal(captured.payload.recommendation, 'approve');
});

test('Reviewer input never carries a workspacePath -- the reviewer cannot address the builder workspace', async () => {
  const adapter = new IndependentReviewerAdapter(baseConfig({ name: 'reviewer', args: ['-e', REVIEWER_ECHO_SCRIPT] }));
  const builder = { taskId: task.id, provider: 'claude', summary: 'done', branch: 'b', commitSha: 'abc', changedFiles: [], tests: [], knownLimitations: [] };
  const pullRequest = { repository: target.repository, number: 1, title: 'PR', state: 'open', headSha: 'abc', headBranch: 'b', baseBranch: 'main', draft: true, changedFiles: [], url: 'https://example/pr/1' };
  const ci = { commitSha: 'abc', checks: [{ name: 'verify', conclusion: 'success' }] };
  const captured = await adapter.review({ task, builder, pullRequest, ci, diff: 'diff --git a/x b/x\n' });
  assert.equal(captured.payload._sawWorkspacePath, false);
});

test('Builder credential firewall: GitHub credential-shaped env vars in this process are not inherited by the builder command', async () => {
  const savedGithubToken = process.env.GITHUB_TOKEN;
  const savedGhToken = process.env.GH_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_should_not_leak';
  process.env.GH_TOKEN = 'gho_should_not_leak';
  try {
    const adapter = new ClaudeBuilderAdapter(baseConfig({ args: ['-e', BUILDER_ECHO_SCRIPT] }));
    const captured = await adapter.build({ task, target, workspacePath: process.cwd(), baseSha: 'deadbeef', branch: 'commander/test' });
    assert.match(captured.payload.summary, /leaked=\[\]/);
  } finally {
    if (savedGithubToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = savedGithubToken;
    if (savedGhToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedGhToken;
  }
});

test('Reviewer credential firewall: GitHub credential-shaped env vars in this process are not inherited by the reviewer command', async () => {
  const savedGithubToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_should_not_leak';
  try {
    const adapter = new IndependentReviewerAdapter(baseConfig({ args: ['-e', REVIEWER_ECHO_SCRIPT] }));
    const builder = { taskId: task.id, provider: 'claude', summary: 'done', branch: 'b', commitSha: 'abc', changedFiles: [], tests: [], knownLimitations: [] };
    const pullRequest = { repository: target.repository, number: 1, title: 'PR', state: 'open', headSha: 'abc', headBranch: 'b', baseBranch: 'main', draft: true, changedFiles: [], url: 'https://example/pr/1' };
    const ci = { commitSha: 'abc', checks: [{ name: 'verify', conclusion: 'success' }] };
    const captured = await adapter.review({ task, builder, pullRequest, ci, diff: 'diff --git a/x b/x\n' });
    assert.deepEqual(captured.payload._leaked, []);
  } finally {
    if (savedGithubToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = savedGithubToken;
  }
});

test('Builder adapter fails closed when config.env explicitly carries a forbidden GitHub credential key', async () => {
  const adapter = new ClaudeBuilderAdapter(baseConfig({ args: ['-e', BUILDER_ECHO_SCRIPT], env: { COMMANDER_GH_APP_ID: 'x' } }));
  await assert.rejects(
    () => adapter.build({ task, target, workspacePath: process.cwd(), baseSha: 'deadbeef', branch: 'commander/test' }),
    (error) => error instanceof Error && error.message === 'FORBIDDEN_PROVIDER_ENV_KEY:COMMANDER_GH_APP_ID',
  );
});

test('Reviewer adapter fails closed when config.env explicitly carries a forbidden GitHub credential key', async () => {
  const adapter = new IndependentReviewerAdapter(baseConfig({ args: ['-e', REVIEWER_ECHO_SCRIPT], env: { GITHUB_TOKEN: 'x' } }));
  const builder = { taskId: task.id, provider: 'claude', summary: 'done', branch: 'b', commitSha: 'abc', changedFiles: [], tests: [], knownLimitations: [] };
  const pullRequest = { repository: target.repository, number: 1, title: 'PR', state: 'open', headSha: 'abc', headBranch: 'b', baseBranch: 'main', draft: true, changedFiles: [], url: 'https://example/pr/1' };
  const ci = { commitSha: 'abc', checks: [{ name: 'verify', conclusion: 'success' }] };
  await assert.rejects(
    () => adapter.review({ task, builder, pullRequest, ci, diff: 'diff --git a/x b/x\n' }),
    (error) => error instanceof Error && error.message === 'FORBIDDEN_PROVIDER_ENV_KEY:GITHUB_TOKEN',
  );
});

test('Provider command timeout is enforced and bounded', async () => {
  const adapter = new ClaudeBuilderAdapter(baseConfig({ args: ['-e', NEVER_EXITS_SCRIPT], timeoutMs: 150 }));
  await assert.rejects(
    () => adapter.build({ task, target, workspacePath: process.cwd(), baseSha: 'deadbeef', branch: 'commander/test' }),
    (error) => error instanceof Error && error.message === 'PROVIDER_COMMAND_TIMEOUT',
  );
});

test('Invalid (non-JSON) provider output is rejected rather than silently accepted', async () => {
  const adapter = new ClaudeBuilderAdapter(baseConfig({ args: ['-e', INVALID_JSON_SCRIPT] }));
  await assert.rejects(
    () => adapter.build({ task, target, workspacePath: process.cwd(), baseSha: 'deadbeef', branch: 'commander/test' }),
    (error) => error instanceof Error && error.message === 'PROVIDER_COMMAND_INVALID_JSON',
  );
});
