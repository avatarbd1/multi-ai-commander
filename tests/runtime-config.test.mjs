import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRuntimeConfigFromEnv } from '../dist/config/runtime-config.js';
import { createRepairPolicy, DEFAULT_MAX_REPAIR_CYCLES, HARD_MAX_REPAIR_CYCLES } from '../dist/orchestration/repair-policy.js';

const VALID_GITHUB_APP_ENV = {
  COMMANDER_GH_APP_ID: '123456',
  COMMANDER_GH_INSTALLATION_ID: '99',
  COMMANDER_GH_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
};

function baseEnv(overrides = {}) {
  return {
    ...VALID_GITHUB_APP_ENV,
    COMMANDER_PLANNER_COMMAND: '/usr/bin/true',
    COMMANDER_BUILDER_COMMAND: '/usr/bin/true',
    COMMANDER_REVIEWER_COMMAND: '/usr/bin/true',
    ...overrides,
  };
}

test('loadRuntimeConfigFromEnv fails closed when the builder command is missing', () => {
  const env = baseEnv({ COMMANDER_BUILDER_COMMAND: undefined });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && error.message.includes('COMMANDER_BUILDER_COMMAND'),
  );
});

test('loadRuntimeConfigFromEnv fails closed when the reviewer command is missing', () => {
  const env = baseEnv({ COMMANDER_REVIEWER_COMMAND: undefined });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && error.message.includes('COMMANDER_REVIEWER_COMMAND'),
  );
});

test('loadRuntimeConfigFromEnv fails closed when GitHub App configuration is missing', () => {
  const env = baseEnv({ COMMANDER_GH_APP_ID: undefined, COMMANDER_GH_INSTALLATION_ID: undefined, COMMANDER_GH_PRIVATE_KEY: undefined });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && error.message.includes('COMMANDER_GH_APP_ID'),
  );
});

test('loadRuntimeConfigFromEnv rejects a builder/reviewer provider identity collision', () => {
  const env = baseEnv({ COMMANDER_BUILDER_NAME: 'same-name', COMMANDER_REVIEWER_NAME: 'Same-Name' });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && /different provider identities/i.test(error.message),
  );
});

test('loadRuntimeConfigFromEnv fails closed when the planner command is missing', () => {
  const env = baseEnv({ COMMANDER_PLANNER_COMMAND: undefined });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && error.message.includes('COMMANDER_PLANNER_COMMAND'),
  );
});

test('loadRuntimeConfigFromEnv rejects a planner/builder provider identity collision', () => {
  const env = baseEnv({ COMMANDER_PLANNER_NAME: 'same-name', COMMANDER_BUILDER_NAME: 'Same-Name' });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && /different provider identities/i.test(error.message),
  );
});

test('loadRuntimeConfigFromEnv rejects a planner/reviewer provider identity collision', () => {
  const env = baseEnv({ COMMANDER_PLANNER_NAME: 'same-name', COMMANDER_REVIEWER_NAME: 'Same-Name' });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && /different provider identities/i.test(error.message),
  );
});

test('loadRuntimeConfigFromEnv applies safe defaults and reports both required-value gaps together', () => {
  const env = baseEnv({ COMMANDER_BUILDER_COMMAND: undefined, COMMANDER_REVIEWER_COMMAND: undefined });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error.message.includes('COMMANDER_BUILDER_COMMAND') && error.message.includes('COMMANDER_REVIEWER_COMMAND'),
  );
});

test('loadRuntimeConfigFromEnv returns a fully-populated config with correct defaults', () => {
  const config = loadRuntimeConfigFromEnv(baseEnv());
  assert.equal(config.planner.name, 'chatgpt-planner');
  assert.equal(config.planner.executable, '/usr/bin/true');
  assert.equal(config.builder.name, 'claude');
  assert.equal(config.builder.executable, '/usr/bin/true');
  assert.deepEqual(config.builder.args, []);
  assert.equal(config.builder.timeoutMs, 600000);
  assert.equal(config.builder.maxOutputBytes, 1024 * 1024);
  assert.equal(config.reviewer.name, 'independent-reviewer');
  assert.equal(config.ci.maxAttempts, 30);
  assert.equal(config.ci.intervalMs, 10000);
  assert.equal(config.githubApp.appId, '123456');
  assert.equal(config.githubApp.installationId, 99);
});

test('loadRuntimeConfigFromEnv honors overrides for names, args, timeouts and CI polling', () => {
  const config = loadRuntimeConfigFromEnv(baseEnv({
    COMMANDER_PLANNER_NAME: 'chatgpt',
    COMMANDER_BUILDER_NAME: 'claude-builder',
    COMMANDER_REVIEWER_NAME: 'gpt-reviewer',
    COMMANDER_BUILDER_ARGS: '["--flag","value"]',
    COMMANDER_BUILDER_TIMEOUT_MS: '5000',
    COMMANDER_REVIEWER_MAX_OUTPUT_BYTES: '2048',
    COMMANDER_CI_MAX_ATTEMPTS: '3',
    COMMANDER_CI_INTERVAL_MS: '250',
  }));
  assert.equal(config.planner.name, 'chatgpt');
  assert.equal(config.builder.name, 'claude-builder');
  assert.equal(config.reviewer.name, 'gpt-reviewer');
  assert.deepEqual(config.builder.args, ['--flag', 'value']);
  assert.equal(config.builder.timeoutMs, 5000);
  assert.equal(config.reviewer.maxOutputBytes, 2048);
  assert.equal(config.ci.maxAttempts, 3);
  assert.equal(config.ci.intervalMs, 250);
});

test('loadRuntimeConfigFromEnv fails closed on a malformed args value', () => {
  const env = baseEnv({ COMMANDER_BUILDER_ARGS: 'not-json' });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && error.message.includes('COMMANDER_BUILDER_ARGS'),
  );
});

test('loadRuntimeConfigFromEnv fails closed on a non-positive CI polling value', () => {
  const env = baseEnv({ COMMANDER_CI_MAX_ATTEMPTS: '0' });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && error.message.includes('COMMANDER_CI_MAX_ATTEMPTS'),
  );
});

// --- Bounded repair policy (14: invalid repair-limit config -> fail closed) ---

test('createRepairPolicy defaults to 2 and enforces a hard maximum of 3', () => {
  assert.equal(DEFAULT_MAX_REPAIR_CYCLES, 2);
  assert.equal(HARD_MAX_REPAIR_CYCLES, 3);
  assert.equal(createRepairPolicy().maxRepairCycles, 2);
  assert.equal(createRepairPolicy(0).maxRepairCycles, 0);
  assert.equal(createRepairPolicy(3).maxRepairCycles, 3);
});

test('createRepairPolicy fails closed above the hard maximum', () => {
  assert.throws(() => createRepairPolicy(4), /must be an integer between 0 and 3/);
  assert.throws(() => createRepairPolicy(100), /must be an integer between 0 and 3/);
});

test('createRepairPolicy fails closed on negative or non-integer values -- never an unlimited loop', () => {
  assert.throws(() => createRepairPolicy(-1), /must be an integer/);
  assert.throws(() => createRepairPolicy(1.5), /must be an integer/);
  assert.throws(() => createRepairPolicy(Infinity), /must be an integer/);
  assert.throws(() => createRepairPolicy(Number.NaN), /must be an integer/);
});

test('loadRuntimeConfigFromEnv reads COMMANDER_MAX_REPAIR_CYCLES and defaults it to 2', () => {
  assert.equal(loadRuntimeConfigFromEnv(baseEnv()).repairPolicy.maxRepairCycles, 2);
  assert.equal(loadRuntimeConfigFromEnv(baseEnv({ COMMANDER_MAX_REPAIR_CYCLES: '0' })).repairPolicy.maxRepairCycles, 0);
  assert.equal(loadRuntimeConfigFromEnv(baseEnv({ COMMANDER_MAX_REPAIR_CYCLES: '3' })).repairPolicy.maxRepairCycles, 3);
});

test('loadRuntimeConfigFromEnv fails closed when COMMANDER_MAX_REPAIR_CYCLES exceeds the hard maximum', () => {
  const env = baseEnv({ COMMANDER_MAX_REPAIR_CYCLES: '4' });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && error.message.includes('between 0 and 3'),
  );
});

test('loadRuntimeConfigFromEnv fails closed when COMMANDER_MAX_REPAIR_CYCLES is not an integer', () => {
  const env = baseEnv({ COMMANDER_MAX_REPAIR_CYCLES: 'unlimited' });
  assert.throws(
    () => loadRuntimeConfigFromEnv(env),
    (error) => error instanceof Error && error.message.includes('COMMANDER_MAX_REPAIR_CYCLES must be an integer'),
  );
});
