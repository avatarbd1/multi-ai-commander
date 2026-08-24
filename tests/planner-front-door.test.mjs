import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planTask } from '../dist/planner/plan-task.js';
import { runPlanCli } from '../dist/cli/plan.js';
import { runCli } from '../dist/cli/run.js';
import { PlannerAdapter } from '../dist/providers/planner-adapter.js';

const OPERATING_CONSTITUTION = 'test operating constitution text';
const REPO_ROOT = process.cwd();
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'commander-run.yml');

function stubPlanner(planFn, overrides = {}) {
  return { name: 'stub-planner', mode: 'active', plan: planFn, ...overrides };
}

function validTaskPayload(overrides = {}) {
  return {
    id: 'T-planner-1',
    title: 'Planner test task',
    targetRepository: 'Commander',
    baseBranch: 'main',
    objective: 'Prove planner wiring works',
    acceptanceCriteria: [{ id: 'A1', requirement: 'planner output normalizes', evidenceRequired: ['pr'] }],
    constraints: [],
    riskLevel: 'low',
    productionMutationAllowed: false,
    ...overrides,
  };
}

function capturedFrom(payload) {
  return { provider: 'stub-planner', capturedAt: new Date().toISOString(), payload };
}

// --- 1: NL command accepted --------------------------------------------

test('planTask accepts a natural-language command and forwards it to the planner untouched', async () => {
  let seenCommand;
  const planner = stubPlanner(async (input) => {
    seenCommand = input.command;
    return capturedFrom(validTaskPayload());
  });
  const result = await planTask(
    { command: 'Complete T2-01 staff tenant membership and take it to HUMAN_GATE.' },
    { operatingConstitution: OPERATING_CONSTITUTION, planner },
  );
  assert.equal(seenCommand, 'Complete T2-01 staff tenant membership and take it to HUMAN_GATE.');
  assert.equal(result.status, 'PLANNED');
});

test('planTask fails closed on an empty command without ever invoking the planner', async () => {
  let called = false;
  const planner = stubPlanner(async () => {
    called = true;
    return capturedFrom(validTaskPayload());
  });
  const result = await planTask({ command: '   ' }, { operatingConstitution: OPERATING_CONSTITUTION, planner });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.error, 'COMMAND_REQUIRED');
  assert.equal(called, false);
});

// --- 2: planner emits valid TaskContract --------------------------------

test('planTask normalizes and validates a well-formed planner response into a usable TaskContract', async () => {
  const planner = stubPlanner(async () => capturedFrom(validTaskPayload({ id: 'T2-01' })));
  const result = await planTask({ command: 'do the thing' }, { operatingConstitution: OPERATING_CONSTITUTION, planner });
  assert.equal(result.status, 'PLANNED');
  assert.equal(result.task.id, 'T2-01');
  assert.equal(result.task.targetRepository, 'avatarbd1/multi-ai-commander');
  assert.equal(result.task.acceptanceCriteria.length, 1);
  assert.equal(result.task.productionMutationAllowed, false);
});

// --- 3: invalid planner JSON rejected -----------------------------------

test('planTask rejects a planner response that is not a JSON object', async () => {
  const planner = stubPlanner(async () => capturedFrom('this is not a task contract'));
  const result = await planTask({ command: 'do the thing' }, { operatingConstitution: OPERATING_CONSTITUTION, planner });
  assert.equal(result.status, 'ERROR');
  assert.match(result.error, /TASK_CONTRACT_MUST_BE_A_JSON_OBJECT/);
});

// --- 4: missing acceptance criteria rejected ----------------------------

test('planTask rejects a planner response with no acceptance criteria', async () => {
  const planner = stubPlanner(async () => capturedFrom(validTaskPayload({ acceptanceCriteria: [] })));
  const result = await planTask({ command: 'do the thing' }, { operatingConstitution: OPERATING_CONSTITUTION, planner });
  assert.equal(result.status, 'ERROR');
  assert.match(result.error, /TASK_CONTRACT_INVALID/);
  assert.match(result.error, /acceptance criterion/);
});

// --- 5: unsupported target rejected -------------------------------------

test('planTask rejects an unsupported target hint without ever invoking the planner', async () => {
  let called = false;
  const planner = stubPlanner(async () => {
    called = true;
    return capturedFrom(validTaskPayload());
  });
  const result = await planTask(
    { command: 'do the thing', target: 'SomeUnrelatedRepo' },
    { operatingConstitution: OPERATING_CONSTITUTION, planner },
  );
  assert.equal(result.status, 'ERROR');
  assert.match(result.error, /UNSUPPORTED_TARGET_REPOSITORY/);
  assert.equal(called, false);
});

test('planTask rejects a planner response naming an unsupported target', async () => {
  const planner = stubPlanner(async () => capturedFrom(validTaskPayload({ targetRepository: 'not-a-supported-target' })));
  const result = await planTask({ command: 'do the thing' }, { operatingConstitution: OPERATING_CONSTITUTION, planner });
  assert.equal(result.status, 'ERROR');
  assert.match(result.error, /UNSUPPORTED_TARGET_REPOSITORY/);
});

test('planTask fails closed when the planner drifts off the Owner-supplied target hint', async () => {
  const planner = stubPlanner(async () => capturedFrom(validTaskPayload({ targetRepository: 'Owner' })));
  const result = await planTask(
    { command: 'do the thing', target: 'Commander' },
    { operatingConstitution: OPERATING_CONSTITUTION, planner },
  );
  assert.equal(result.status, 'ERROR');
  assert.match(result.error, /PLANNER_TARGET_MISMATCH/);
});

// --- 8: workflow command cannot inject shell syntax ---------------------

test('commander-run.yml never interpolates workflow_dispatch inputs directly inside a run: script', async () => {
  const contents = await readFile(WORKFLOW_PATH, 'utf8');
  const steps = contents.split(/\n(?=      - name:)/g);
  assert.ok(steps.length > 1, 'expected to find workflow steps');
  for (const step of steps) {
    const runIndex = step.indexOf('run: |');
    if (runIndex === -1) continue;
    const body = step.slice(runIndex);
    assert.ok(
      !body.includes('${{'),
      `run: block must not directly interpolate a workflow expression:\n${body}`,
    );
  }
  // The command and target inputs must instead reach the shell through env:.
  assert.match(contents, /COMMANDER_COMMAND_INPUT:\s*\$\{\{\s*inputs\.command\s*\}\}/);
  assert.match(contents, /COMMANDER_TARGET_INPUT:\s*\$\{\{\s*inputs\.target\s*\}\}/);
  // And be referenced only as quoted shell variables, never bare.
  assert.match(contents, /"\$COMMANDER_COMMAND_INPUT"/);
});

// --- 9: secrets never appear in generated task/log/result ----------------

test('planner output never carries secret-shaped fields into the normalized TaskContract', async () => {
  const planner = stubPlanner(async () =>
    capturedFrom({
      ...validTaskPayload(),
      COMMANDER_GH_PRIVATE_KEY: 'super-secret-should-not-survive',
      apiKey: 'sk-should-not-survive-either',
    }),
  );
  const result = await planTask({ command: 'do the thing' }, { operatingConstitution: OPERATING_CONSTITUTION, planner });
  assert.equal(result.status, 'PLANNED');
  const serialized = JSON.stringify(result.task);
  assert.doesNotMatch(serialized, /super-secret-should-not-survive/);
  assert.doesNotMatch(serialized, /sk-should-not-survive-either/);
  assert.deepEqual(
    Object.keys(result.task).sort(),
    [
      'acceptanceCriteria',
      'baseBranch',
      'constraints',
      'id',
      'objective',
      'productionMutationAllowed',
      'riskLevel',
      'targetRepository',
      'title',
    ].sort(),
  );
});

test('runPlanCli never lets a GitHub App secret leak into the CLI result even when present in the process environment', async () => {
  const planner = stubPlanner(async () => capturedFrom(validTaskPayload()));
  const { result } = await runPlanCli(['plan', '--command', 'do the thing'], {
    env: { COMMANDER_GH_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nshould-not-leak\n-----END PRIVATE KEY-----' },
    readOperatingConstitution: async () => OPERATING_CONSTITUTION,
    loadRuntimeConfig: () => minimalRuntimeConfig(),
    createPlannerProvider: () => planner,
    writeTaskFile: async () => {},
  });
  assert.doesNotMatch(JSON.stringify(result), /should-not-leak/);
});

// --- 10: generated task reaches the existing commander CLI ---------------

function minimalRuntimeConfig() {
  return {
    planner: { name: 'stub', executable: '/bin/true', args: [], env: {}, timeoutMs: 1000, maxOutputBytes: 1024 },
    builder: { name: 'claude', executable: '/bin/true', args: [], env: {}, timeoutMs: 1000, maxOutputBytes: 1024 },
    reviewer: { name: 'independent-reviewer', executable: '/bin/true', args: [], env: {}, timeoutMs: 1000, maxOutputBytes: 1024 },
    ci: { maxAttempts: 1, intervalMs: 0 },
    githubApp: { appId: '123456', installationId: 99, privateKey: 'fake' },
    repairPolicy: { maxRepairCycles: 2 },
  };
}

test('a planner-generated task reaches the existing commander run CLI unchanged through the shared normalization pipeline', async () => {
  const planner = stubPlanner(async () => capturedFrom(validTaskPayload({ id: 'T2-01', title: 'Staff tenant membership' })));
  let writtenPath;
  let writtenContents;
  const planOutcome = await runPlanCli(
    ['plan', '--command', 'Complete T2-01 staff tenant membership and take it to HUMAN_GATE.', '--out', 'task.json'],
    {
      env: {},
      readOperatingConstitution: async () => OPERATING_CONSTITUTION,
      loadRuntimeConfig: () => minimalRuntimeConfig(),
      createPlannerProvider: () => planner,
      writeTaskFile: async (filePath, contents) => {
        writtenPath = filePath;
        writtenContents = contents;
      },
    },
  );
  assert.equal(planOutcome.exitCode, 0);
  assert.equal(writtenPath, 'task.json');

  let receivedTask;
  const runOutcome = await runCli(['run', '--task', 'task.json'], {
    env: {},
    readTaskFile: async (filePath) => {
      assert.equal(filePath, 'task.json');
      return writtenContents;
    },
    loadRuntimeConfig: () => minimalRuntimeConfig(),
    createGitHubClient: async () => ({}),
    createBuilderProvider: () => ({ name: 'claude', mode: 'active', build: async () => ({}) }),
    createReviewerProvider: () => ({ name: 'independent-reviewer', mode: 'active', review: async () => ({}) }),
    verifyGitHubApp: async () => ({ satisfied: true, violations: [] }),
    runOrchestration: async (task) => {
      receivedTask = task;
      return { state: 'HUMAN_GATE', attempts: 1, audit: { all: () => [] } };
    },
  });

  assert.equal(runOutcome.exitCode, 0);
  assert.equal(receivedTask.id, 'T2-01');
  assert.equal(receivedTask.targetRepository, 'avatarbd1/multi-ai-commander');
});

// --- 11 / 12: HUMAN_GATE and BLOCKED surface through the summary script --

async function runSummaryScript(stage, result) {
  const dir = await mkdtemp(path.join(tmpdir(), 'commander-summary-'));
  try {
    const resultPath = path.join(dir, 'result.json');
    const summaryPath = path.join(dir, 'summary.md');
    await writeFile(resultPath, JSON.stringify(result));
    await writeFile(summaryPath, '');
    const proc = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'write-run-summary.mjs'), stage, resultPath, summaryPath],
      { encoding: 'utf8' },
    );
    assert.equal(proc.status, 0, proc.stderr);
    return readFile(summaryPath, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('HUMAN_GATE result surfaces the pull request URL and final SHA in the workflow summary', async () => {
  const summary = await runSummaryScript('run', {
    status: 'HUMAN_GATE',
    taskId: 'T2-01',
    target: 'avatarbd1/relife-owner-app',
    attempts: 2,
    verdict: 'PASS',
    finalSha: 'deadbeefcafef00d',
    pullRequest: { number: 42, url: 'https://github.com/avatarbd1/relife-owner-app/pull/42', headSha: 'deadbeefcafef00d', draft: true },
  });
  assert.match(summary, /HUMAN_GATE/);
  assert.match(summary, /https:\/\/github\.com\/avatarbd1\/relife-owner-app\/pull\/42/);
  assert.match(summary, /deadbeefcafef00d/);
});

test('BLOCKED result surfaces a concise blocker in the workflow summary', async () => {
  const summary = await runSummaryScript('run', {
    status: 'BLOCKED',
    taskId: 'T2-01',
    target: 'avatarbd1/relife-owner-app',
    attempts: 3,
    lastFailure: 'CI_NOT_SUCCESS',
  });
  assert.match(summary, /BLOCKED/);
  assert.match(summary, /CI_NOT_SUCCESS/);
});

// --- 13 / 14: no auto-merge, no auto-deploy -------------------------------

test('commander-run.yml never merges a pull request and never deploys anything', async () => {
  const contents = await readFile(WORKFLOW_PATH, 'utf8');
  for (const forbidden of [/merge_pull_request/i, /gh pr merge/i, /git push/i, /vercel/i, /render\.com/i, /supabase/i, /deploy/i]) {
    assert.doesNotMatch(contents, forbidden);
  }
  assert.match(contents, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(contents, /contents:\s*write/);
  assert.doesNotMatch(contents, /pull-requests:\s*write/);
});

// --- 15: missing real provider command fails closed -----------------------

test('PlannerAdapter requires a configured executable and fails closed without one', () => {
  assert.throws(
    () => new PlannerAdapter({ name: 'chatgpt-planner', executable: '', args: [], env: {}, timeoutMs: 1000, maxOutputBytes: 1024 }),
    (error) => error instanceof Error && error.message === 'PLANNER_COMMAND_REQUIRED',
  );
});

const PLANNER_ECHO_SCRIPT =
  "const fs=require('fs');" +
  "const input=JSON.parse(fs.readFileSync(0,'utf8'));" +
  "const leaked=['GITHUB_TOKEN','GH_TOKEN','COMMANDER_GH_APP_ID','COMMANDER_GH_INSTALLATION_ID','COMMANDER_GH_PRIVATE_KEY']" +
  ".filter((k)=>process.env[k]!==undefined);" +
  "process.stdout.write(JSON.stringify({" +
  "id:'T-echo',title:'echo',targetRepository:input.command.includes('Owner')?'Owner':'Commander'," +
  "baseBranch:'main',objective:input.command,acceptanceCriteria:[{id:'A1',requirement:'r',evidenceRequired:['pr']}]," +
  "constraints:[],riskLevel:'low',productionMutationAllowed:false,_leaked:leaked}));";

test('PlannerAdapter delegates to the configured command, returns a captured TaskContract, and forwards no GitHub credentials', async () => {
  const savedGithubToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_should_not_leak';
  try {
    const adapter = new PlannerAdapter({
      name: 'chatgpt-planner',
      executable: process.execPath,
      args: ['-e', PLANNER_ECHO_SCRIPT],
      env: {},
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
    });
    const captured = await adapter.plan({
      kind: 'plan',
      command: 'Complete T2-01 staff tenant membership and take it to HUMAN_GATE.',
      operatingConstitution: OPERATING_CONSTITUTION,
      supportedTargets: ['Commander', 'Owner', 'ClinicOS'],
      taskContractGuide: { requiredFields: [], riskLevels: ['low', 'medium', 'high', 'critical'] },
    });
    assert.equal(captured.provider, 'chatgpt-planner');
    assert.equal(captured.payload.targetRepository, 'Commander');
    assert.deepEqual(captured.payload._leaked, []);
  } finally {
    if (savedGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedGithubToken;
  }
});
