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
    env: {},
    timeoutMs: parsePositiveInt(env, `COMMANDER_${prefix}_TIMEOUT_MS`, DEFAULT_TIMEOUT_MS),
    maxOutputBytes: parsePositiveInt(env, `COMMANDER_${prefix}_MAX_OUTPUT_BYTES`, DEFAULT_MAX_OUTPUT_BYTES),
  };
}

/**
 * Loads Commander's managed-execution runtime configuration from the trusted
 * environment. Fails closed: any missing required value (a provider command,
 * or the GitHub App broker configuration) throws rather than silently
 * defaulting, and builder/reviewer provider identity collision is rejected
 * here so it can never reach a live run.
 */
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

  if (missing.length > 0) {
    throw new Error(`Missing required runtime configuration: ${missing.join(', ')}`);
  }
  if (!githubApp) {
    throw new Error(githubAppError ?? 'GitHub App configuration invalid');
  }

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
