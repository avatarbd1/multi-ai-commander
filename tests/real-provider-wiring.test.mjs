import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadRuntimeConfigFromEnv } from '../dist/config/runtime-config.js';

const app = {
  COMMANDER_GH_APP_ID: '123',
  COMMANDER_GH_INSTALLATION_ID: '456',
  COMMANDER_GH_PRIVATE_KEY: 'fake-private-key',
};

function env(overrides = {}) {
  return {
    ...app,
    COMMANDER_PLANNER_COMMAND: 'node',
    COMMANDER_PLANNER_NAME: 'openai-planner',
    COMMANDER_PLANNER_ARGS: '["scripts/providers/openai-planner.mjs"]',
    COMMANDER_BUILDER_COMMAND: 'node',
    COMMANDER_BUILDER_NAME: 'claude',
    COMMANDER_BUILDER_ARGS: '["scripts/providers/claude-builder.mjs"]',
    COMMANDER_REVIEWER_COMMAND: 'node',
    COMMANDER_REVIEWER_NAME: 'openai-reviewer',
    COMMANDER_REVIEWER_ARGS: '["scripts/providers/openai-reviewer.mjs"]',
    COMMANDER_PLANNER_OPENAI_API_KEY: 'openai-secret',
    COMMANDER_BUILDER_ANTHROPIC_API_KEY: 'anthropic-secret',
    COMMANDER_REVIEWER_OPENAI_API_KEY: 'openai-secret',
    ...overrides,
  };
}

test('runtime config gives each provider only its own AI credential class', () => {
  const config = loadRuntimeConfigFromEnv(env());
  assert.equal(config.planner.env.OPENAI_API_KEY, 'openai-secret');
  assert.equal(config.planner.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(config.builder.env.ANTHROPIC_API_KEY, 'anthropic-secret');
  assert.equal(config.builder.env.OPENAI_API_KEY, undefined);
  assert.equal(config.reviewer.env.OPENAI_API_KEY, 'openai-secret');
  for (const provider of [config.planner, config.builder, config.reviewer]) {
    assert.equal(provider.env.COMMANDER_GH_PRIVATE_KEY, undefined);
    assert.equal(provider.env.GITHUB_TOKEN, undefined);
    assert.equal(provider.env.GH_TOKEN, undefined);
  }
});

test('Commander Run is prewired to bundled providers and requires only AI secrets', async () => {
  const workflow = await readFile('.github/workflows/commander-run.yml', 'utf8');
  assert.match(workflow, /COMMANDER_PLANNER_ARGS: '\["scripts\/providers\/openai-planner\.mjs"\]'/);
  assert.match(workflow, /COMMANDER_BUILDER_ARGS: '\["scripts\/providers\/claude-builder\.mjs"\]'/);
  assert.match(workflow, /COMMANDER_REVIEWER_ARGS: '\["scripts\/providers\/openai-reviewer\.mjs"\]'/);
  assert.match(workflow, /secrets\.OPENAI_API_KEY/);
  assert.match(workflow, /secrets\.ANTHROPIC_API_KEY/);
  assert.doesNotMatch(workflow, /vars\.COMMANDER_(?:PLANNER|BUILDER|REVIEWER)_COMMAND/);
});

test('provider wrappers never reference GitHub credentials', async () => {
  for (const path of [
    'scripts/providers/openai-planner.mjs',
    'scripts/providers/openai-reviewer.mjs',
    'scripts/providers/claude-builder.mjs',
  ]) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /COMMANDER_GH_|GITHUB_TOKEN|GH_TOKEN/);
  }
});
