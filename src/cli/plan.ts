#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import type { TaskContract } from '../commander/types.js';
import { planTask } from '../planner/plan-task.js';
import type { PlannerRequest } from '../planner/planner-request.js';
import {
  loadRuntimeConfigFromEnv,
  type ProviderCommandConfig,
  type RuntimeConfig,
} from '../config/runtime-config.js';
import { PlannerAdapter } from '../providers/planner-adapter.js';
import type { PlannerProvider } from '../providers/provider.js';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

export interface CliPlanResult {
  status: 'PLANNED' | 'ERROR';
  task?: TaskContract;
  error?: string;
}

export interface ParsedPlanArgs {
  command: string;
  target?: string;
  outPath?: string;
}

export function parsePlanArgs(argv: string[]): ParsedPlanArgs {
  if (argv[0] !== 'plan') {
    throw new Error('Usage: commander plan --command "<natural language command>" [--target <alias>] [--out <path>]');
  }
  let command: string | undefined;
  let target: string | undefined;
  let outPath: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--command') {
      command = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith('--command=')) {
      command = arg.slice('--command='.length);
    } else if (arg === '--target') {
      target = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith('--target=')) {
      target = arg.slice('--target='.length);
    } else if (arg === '--out') {
      outPath = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
    }
  }
  if (!command || command.trim() === '') {
    throw new Error('--command "<natural language command>" is required');
  }
  return {
    command,
    ...(target && target.trim() !== '' ? { target } : {}),
    ...(outPath && outPath.trim() !== '' ? { outPath } : {}),
  };
}

export interface PlanCliDependencies {
  env: Record<string, string | undefined>;
  readOperatingConstitution: () => Promise<string>;
  loadRuntimeConfig: (env: Record<string, string | undefined>) => RuntimeConfig;
  createPlannerProvider: (config: ProviderCommandConfig) => PlannerProvider<PlannerRequest, TaskContract>;
  writeTaskFile: (path: string, contents: string) => Promise<void>;
}

function defaultDependencies(): PlanCliDependencies {
  return {
    env: process.env,
    readOperatingConstitution: () => readFile(new URL('../../OPERATING_CONSTITUTION.md', import.meta.url), 'utf8'),
    loadRuntimeConfig: (env) => loadRuntimeConfigFromEnv(env),
    createPlannerProvider: (config) => new PlannerAdapter(config),
    writeTaskFile: (path, contents) => writeFile(path, contents, 'utf8'),
  };
}

function errorResult(error: unknown): { exitCode: number; result: CliPlanResult } {
  return { exitCode: 2, result: { status: 'ERROR', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' } };
}

/**
 * The one runnable control surface for the Goal -> TaskContract planning
 * stage: `commander plan --command "<owner command>" [--target <alias>]
 * [--out <path>]`. Performs no planning itself: the request/response bounds
 * and validation live entirely in planTask(). Returns an exit code rather
 * than calling process.exit so it stays testable: 0 only when planning
 * produced a valid TaskContract, 1 when planning legitimately failed closed
 * (unsupported target, invalid planner output, missing acceptance
 * criteria), 2 for a pre-flight input/config failure.
 */
export async function runPlanCli(
  argv: string[],
  overrides: Partial<PlanCliDependencies> = {},
): Promise<{ exitCode: number; result: CliPlanResult }> {
  const deps: PlanCliDependencies = { ...defaultDependencies(), ...overrides };

  let parsedArgs: ParsedPlanArgs;
  try {
    parsedArgs = parsePlanArgs(argv);
  } catch (error) {
    return errorResult(error);
  }

  let operatingConstitution: string;
  try {
    operatingConstitution = await deps.readOperatingConstitution();
  } catch (error) {
    return errorResult(
      new Error(`OPERATING_CONSTITUTION_UNREADABLE: ${error instanceof Error ? error.message : 'could not be read'}`),
    );
  }

  let runtimeConfig: RuntimeConfig;
  try {
    runtimeConfig = deps.loadRuntimeConfig(deps.env);
  } catch (error) {
    return errorResult(error);
  }

  let plannerProvider: PlannerProvider<PlannerRequest, TaskContract>;
  try {
    plannerProvider = deps.createPlannerProvider(runtimeConfig.planner);
  } catch (error) {
    return errorResult(error);
  }

  const planResult = await planTask(
    { command: parsedArgs.command, ...(parsedArgs.target ? { target: parsedArgs.target } : {}) },
    { operatingConstitution, planner: plannerProvider },
  );

  if (planResult.status === 'ERROR' || !planResult.task) {
    return {
      exitCode: 1,
      result: { status: 'ERROR', ...(planResult.error ? { error: planResult.error } : {}) },
    };
  }

  if (parsedArgs.outPath) {
    try {
      await deps.writeTaskFile(parsedArgs.outPath, `${JSON.stringify(planResult.task, null, 2)}\n`);
    } catch (error) {
      return errorResult(
        new Error(`TASK_FILE_WRITE_FAILED: ${error instanceof Error ? error.message : 'unknown error'}`),
      );
    }
  }

  return { exitCode: 0, result: { status: 'PLANNED', task: planResult.task } };
}

async function main(): Promise<void> {
  const { exitCode, result } = await runPlanCli(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
