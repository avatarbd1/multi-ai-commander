import { loadConfigFromEnv, type EnvironmentConfig } from '../auth/setup.js';
import { createRepairPolicy, type RepairPolicy } from '../orchestration/repair-policy.js';

declare const process: { env: Record<string, string | undefined> };

export interface ProviderCommandConfig {
  name: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface CiPollingConfig {
  maxAttempts: number;
  intervalMs: number;
}

export interface RuntimeConfig {
  planner: ProviderCommandConfig;
  builder: ProviderCommandConfig;
  reviewer: ProviderCommandConfig;
  ci: CiPollingConfig;
  githubApp: EnvironmentConfig;
  repairPolicy: RepairPolicy;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_CI_MAX_ATTEMPTS = 30;
const DEFAULT_CI_INTERVAL_MS = 10_000;

function requireEnv(env: Record<string, string | undefined>, key: string, missing: string[]): string {
  const value = env[key];
  if (!value || value.trim() === '') {
    missing.push(key);
    return '';
  }
  return value;
}

function parsePositiveInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalInt(env: Record<string, string | undefined>, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${key} must be an integer`);
  }
  return parsed;
}

function parseArgs(env: Record<string, string | undefined>, key: string): string[] {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${key} must be a JSON array of strings`);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`${key} must be a JSON array of strings`);
  }
  return parsed;
}

function providerEnvironment(
  env: Record<string, string | undefined>,
  prefix: 'PLANNER' | 'BUILDER' | 'REVIEWER',
  name: string,
): Record<string, string> {
  const output: Record<string, string> = { COMMANDER_PROVIDER_NAME: name };
  if (prefix === 'BUILDER') {
    const key = env.COMMANDER_BUILDER_ANTHROPIC_API_KEY;
    if (key) output.ANTHROPIC_API_KEY = key;
  } else {
    const key = env[`COMMANDER_${prefix}_OPENAI_API_KEY`];
    if (key) output.OPENAI_API_KEY = key;
    const model = env[`COMMANDER_${prefix}_OPENAI_MODEL`];
    if (model) output.OPENAI_MODEL = model;
  }
  return output;
}

function parseProviderCommandConfig(
  env: Record<string, string | undefined>,
  prefix: 'PLANNER' | 'BUILDER' | 'REVIEWER',
  defaultName: string,
  missing: string[],
): ProviderCommandConfig {
  const executable = requireEnv(env, `COMMANDER_${prefix}_COMMAND`, missing);
  const rawName = env[`COMMANDER_${prefix}_NAME`];
  const name = rawName && rawName.trim() !== '' ? rawName.trim() : defaultName;
  return {
    name,
    executable,
    args: parseArgs(env, `COMMANDER_${prefix}_ARGS`),
    env: providerEnvironment(env, prefix, name),
    timeoutMs: parsePositiveInt(env, `COMMANDER_${prefix}_TIMEOUT_MS`, DEFAULT_TIMEOUT_MS),
    maxOutputBytes: parsePositiveInt(env, `COMMANDER_${prefix}_MAX_OUTPUT_BYTES`, DEFAULT_MAX_OUTPUT_BYTES),
  };
}

/** Loads Commander's runtime config and fails closed on missing commands/auth or identity collisions. */
export function loadRuntimeConfigFromEnv(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const missing: string[] = [];
  const planner = parseProviderCommandConfig(env, 'PLANNER', 'chatgpt-planner', missing);
  const builder = parseProviderCommandConfig(env, 'BUILDER', 'claude', missing);
  const reviewer = parseProviderCommandConfig(env, 'REVIEWER', 'independent-reviewer', missing);

  let githubApp: EnvironmentConfig | undefined;
  let githubAppError: string | undefined;
  try {
    githubApp = loadConfigFromEnv(env);
  } catch (error) {
    githubAppError = error instanceof Error ? error.message : 'GitHub App configuration invalid';
  }

  if (missing.length > 0) throw new Error(`Missing required runtime configuration: ${missing.join(', ')}`);
  if (!githubApp) throw new Error(githubAppError ?? 'GitHub App configuration invalid');

  if (builder.name.trim().toLowerCase() === reviewer.name.trim().toLowerCase()) {
    throw new Error('COMMANDER_BUILDER_NAME and COMMANDER_REVIEWER_NAME must be different provider identities');
  }
  if (planner.name.trim().toLowerCase() === builder.name.trim().toLowerCase()) {
    throw new Error('COMMANDER_PLANNER_NAME and COMMANDER_BUILDER_NAME must be different provider identities');
  }
  if (planner.name.trim().toLowerCase() === reviewer.name.trim().toLowerCase()) {
    throw new Error('COMMANDER_PLANNER_NAME and COMMANDER_REVIEWER_NAME must be different provider identities');
  }

  const ci: CiPollingConfig = {
    maxAttempts: parsePositiveInt(env, 'COMMANDER_CI_MAX_ATTEMPTS', DEFAULT_CI_MAX_ATTEMPTS),
    intervalMs: parsePositiveInt(env, 'COMMANDER_CI_INTERVAL_MS', DEFAULT_CI_INTERVAL_MS),
  };
  const repairPolicy = createRepairPolicy(parseOptionalInt(env, 'COMMANDER_MAX_REPAIR_CYCLES'));
  return { planner, builder, reviewer, ci, githubApp, repairPolicy };
}
