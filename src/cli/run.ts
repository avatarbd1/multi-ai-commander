#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import type { TaskContract, Verdict, ReviewReport } from '../commander/types.js';
import { normalizeTaskContract, validateTaskContract } from '../commander/task-contract.js';
import type { OrchestrationState } from '../orchestration/state-machine.js';
import {
  runManagedCommander,
  type ManagedCommanderDependencies,
  type ManagedCommanderResult,
} from '../orchestration/run-managed.js';
import { ManagedBuilderRunner } from '../execution/managed-builder-runner.js';
import type { ActiveReviewProvider, BuilderProvider } from '../providers/provider.js';
import type { BuilderRequest, BuilderResponse } from '../execution/managed-builder-runner.js';
import type { IndependentReviewInput } from '../review/independent-reviewer-runner.js';
import { PublicationOrchestrator } from '../publication/publication-orchestrator.js';
import { IndependentReviewerRunner } from '../review/independent-reviewer-runner.js';
import type { GitHubRestClient } from '../github/client.js';
import { createGitHubAppClient } from '../github/app-client.js';
import { LiveInstallationVerifier, DEFAULT_REQUIREMENTS } from '../auth/live-installation.js';
import type { EnvironmentConfig } from '../auth/setup.js';
import {
  loadRuntimeConfigFromEnv,
  type ProviderCommandConfig,
  type RuntimeConfig,
} from '../config/runtime-config.js';
import { ClaudeBuilderAdapter } from '../providers/claude-builder-adapter.js';
import { IndependentReviewerAdapter } from '../providers/independent-reviewer-adapter.js';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

export interface CliRunResult {
  status: 'HUMAN_GATE' | 'BLOCKED' | 'ERROR';
  taskId?: string;
  target?: string;
  state?: OrchestrationState;
  /** Total builder invocations actually executed (initial + repairs). Absent for a pre-flight ERROR. */
  attempts?: number;
  verdict?: Verdict;
  /** Concise reason the run stopped BLOCKED/ERROR -- never a raw log. */
  lastFailure?: string;
  reasons?: string[];
  /** The exact commit SHA the final decision/blocker applies to, when a publish happened. */
  finalSha?: string;
  pullRequest?: { number: number; url: string; headSha: string; draft: boolean };
  githubAppValidation?: { satisfied: boolean; violations: string[] };
  auditEventCount?: number;
  error?: string;
}

export interface CliDependencies {
  env: Record<string, string | undefined>;
  readTaskFile: (path: string) => Promise<string>;
  loadRuntimeConfig: (env: Record<string, string | undefined>) => RuntimeConfig;
  createGitHubClient: (config: EnvironmentConfig) => Promise<GitHubRestClient>;
  createBuilderProvider: (config: ProviderCommandConfig) => BuilderProvider<BuilderRequest, BuilderResponse>;
  createReviewerProvider: (
    config: ProviderCommandConfig,
  ) => ActiveReviewProvider<IndependentReviewInput, ReviewReport>;
  verifyGitHubApp: (
    config: EnvironmentConfig,
    client: GitHubRestClient,
    repository: string,
  ) => Promise<{ satisfied: boolean; violations: string[] }>;
  /**
   * Invokes the managed-execution pipeline. Defaults to the real
   * runManagedCommander() -- its own correctness is covered by
   * tests/managed-execution.test.mjs. Overriding this in a test exercises
   * only the CLI's own responsibility (input handling, config loading,
   * GitHub App validation gating, dependency wiring, result/exit-code
   * shaping) without needing a real GitHub App, network, or Git remote.
   */
  runOrchestration: (
    task: TaskContract,
    dependencies: ManagedCommanderDependencies,
  ) => Promise<ManagedCommanderResult>;
}

function defaultDependencies(): CliDependencies {
  return {
    env: process.env,
    readTaskFile: (path) => readFile(path, 'utf8'),
    loadRuntimeConfig: (env) => loadRuntimeConfigFromEnv(env),
    createGitHubClient: (config) => createGitHubAppClient(config),
    createBuilderProvider: (config) => new ClaudeBuilderAdapter(config),
    createReviewerProvider: (config) => new IndependentReviewerAdapter(config),
    verifyGitHubApp: (config, client, repository) =>
      LiveInstallationVerifier.verify(client, repository, config.installationId, {
        ...DEFAULT_REQUIREMENTS,
        requireBranchProtection: false,
      }),
    runOrchestration: (task, dependencies) => runManagedCommander(task, dependencies),
  };
}

export interface ParsedCliArgs {
  taskPath: string;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  if (argv[0] !== 'run') {
    throw new Error('Usage: commander run --task <task-contract.json>');
  }
  let taskPath: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--task') {
      taskPath = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith('--task=')) {
      taskPath = arg.slice('--task='.length);
    }
  }
  if (!taskPath || taskPath.trim() === '') {
    throw new Error('--task <task-contract.json> is required');
  }
  return { taskPath };
}

// normalizeTaskContract now lives in ../commander/task-contract.js (shared
// with the planner, which needs the exact same raw-JSON -> TaskContract
// normalization for a planner's output as the CLI uses for a human-authored
// task file). Re-exported here so existing imports of it from this module
// keep working.
export { normalizeTaskContract };

function errorResult(error: unknown, exitCode: number): { exitCode: number; result: CliRunResult } {
  return {
    exitCode,
    result: { status: 'ERROR', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
  };
}

/**
 * The one runnable control surface for Commander's managed execution
 * pipeline: `commander run --task <task-contract.json>`.
 *
 *   TASK -> TARGET_LOCK -> TARGET_ACCESS_VERIFY -> BUILD -> VERIFY ->
 *   PUBLISH -> CI -> REVIEW -> VERDICT -> HUMAN_GATE
 *
 * This function performs no orchestration itself beyond input validation,
 * config loading, and wiring: the pipeline above is entirely
 * runManagedCommander() plus the existing engines it composes
 * (ManagedBuilderRunner, PublicationOrchestrator, IndependentReviewerRunner,
 * the commit-bound CI gate). Returns an exit code rather than calling
 * process.exit so it stays testable: 0 only when the run reaches
 * HUMAN_GATE, 1 when the orchestration legitimately blocked at some stage,
 * 2 for a pre-flight input/config/GitHub-App-validation failure.
 */
export async function runCli(
  argv: string[],
  overrides: Partial<CliDependencies> = {},
): Promise<{ exitCode: number; result: CliRunResult }> {
  const deps: CliDependencies = { ...defaultDependencies(), ...overrides };

  let parsedArgs: ParsedCliArgs;
  try {
    parsedArgs = parseCliArgs(argv);
  } catch (error) {
    return errorResult(error, 2);
  }

  let rawTask: unknown;
  try {
    const contents = await deps.readTaskFile(parsedArgs.taskPath);
    rawTask = JSON.parse(contents);
  } catch (error) {
    return errorResult(
      new Error(`TASK_FILE_INVALID: ${error instanceof Error ? error.message : 'could not be read'}`),
      2,
    );
  }

  let task: TaskContract;
  try {
    task = normalizeTaskContract(rawTask);
  } catch (error) {
    return errorResult(error, 2);
  }

  const contractErrors = validateTaskContract(task);
  if (contractErrors.length > 0) {
    return errorResult(new Error(`TASK_CONTRACT_INVALID: ${contractErrors.join('; ')}`), 2);
  }

  let runtimeConfig: RuntimeConfig;
  try {
    runtimeConfig = deps.loadRuntimeConfig(deps.env);
  } catch (error) {
    return errorResult(error, 2);
  }

  let client: GitHubRestClient;
  try {
    client = await deps.createGitHubClient(runtimeConfig.githubApp);
  } catch (error) {
    return errorResult(error, 2);
  }

  let githubAppValidation: { satisfied: boolean; violations: string[] };
  try {
    githubAppValidation = await deps.verifyGitHubApp(runtimeConfig.githubApp, client, task.targetRepository);
  } catch (error) {
    return errorResult(error, 2);
  }
  if (!githubAppValidation.satisfied) {
    return {
      exitCode: 2,
      result: {
        status: 'ERROR',
        taskId: task.id,
        target: task.targetRepository,
        githubAppValidation,
        error: `GITHUB_APP_VALIDATION_FAILED: ${githubAppValidation.violations.join('; ')}`,
      },
    };
  }

  let builderProvider: BuilderProvider<BuilderRequest, BuilderResponse>;
  let reviewerProvider: ActiveReviewProvider<IndependentReviewInput, ReviewReport>;
  try {
    builderProvider = deps.createBuilderProvider(runtimeConfig.builder);
    reviewerProvider = deps.createReviewerProvider(runtimeConfig.reviewer);
  } catch (error) {
    return errorResult(error, 2);
  }

  const run = await deps.runOrchestration(task, {
    client,
    builderRunner: new ManagedBuilderRunner(builderProvider),
    publication: new PublicationOrchestrator(client),
    reviewer: new IndependentReviewerRunner(reviewerProvider, client),
    ci: runtimeConfig.ci,
    repairPolicy: runtimeConfig.repairPolicy,
  });

  const result: CliRunResult = {
    status: run.state === 'HUMAN_GATE' ? 'HUMAN_GATE' : 'BLOCKED',
    taskId: task.id,
    target: task.targetRepository,
    state: run.state,
    attempts: run.attempts,
    ...(run.decision ? { verdict: run.decision.verdict, reasons: run.decision.reasons } : {}),
    ...(run.blocker ? { lastFailure: run.blocker } : {}),
    ...(run.finalSha ? { finalSha: run.finalSha } : {}),
    ...(run.pullRequest
      ? {
          pullRequest: {
            number: run.pullRequest.number,
            url: run.pullRequest.url,
            headSha: run.pullRequest.headSha,
            draft: run.pullRequest.draft,
          },
        }
      : {}),
    githubAppValidation,
    auditEventCount: run.audit.all().length,
  };

  return { exitCode: run.state === 'HUMAN_GATE' ? 0 : 1, result };
}

async function main(): Promise<void> {
  const { exitCode, result } = await runCli(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
