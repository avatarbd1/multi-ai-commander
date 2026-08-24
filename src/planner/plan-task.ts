import type { TaskContract } from '../commander/types.js';
import { normalizeTaskContract, validateTaskContract } from '../commander/task-contract.js';
import { listSupportedTargets, resolveTargetRepository } from '../orchestration/target-resolver.js';
import type { PlannerProvider } from '../providers/provider.js';
import type { PlannerRequest } from './planner-request.js';

const TASK_CONTRACT_GUIDE = {
  requiredFields: [
    'id',
    'title',
    'targetRepository',
    'baseBranch',
    'objective',
    'acceptanceCriteria',
    'constraints',
    'riskLevel',
    'productionMutationAllowed',
  ],
  riskLevels: ['low', 'medium', 'high', 'critical'],
};

export interface PlanTaskInput {
  command: string;
  target?: string;
}

export interface PlanTaskDependencies {
  operatingConstitution: string;
  planner: PlannerProvider<PlannerRequest, TaskContract>;
}

export interface PlanTaskResult {
  status: 'PLANNED' | 'ERROR';
  task?: TaskContract;
  error?: string;
}

/**
 * The one Goal -> TaskContract planning stage that sits in front of
 * `commander run`. Bounds the planner's own output the same way a
 * human-authored task file is bounded: normalized and validated through
 * exactly the shared `commander/task-contract.js` pipeline, target resolved
 * through the exact same `target-resolver.js` every live orchestration run
 * uses, and `productionMutationAllowed` forced false because the
 * `workflow_dispatch` front door this feeds has no explicit-authorization
 * input. The planner never executes anything -- it can only return JSON,
 * which is untrusted until it passes every check below.
 */
export async function planTask(input: PlanTaskInput, dependencies: PlanTaskDependencies): Promise<PlanTaskResult> {
  const command = input.command.trim();
  if (command === '') {
    return { status: 'ERROR', error: 'COMMAND_REQUIRED' };
  }

  const trimmedTarget = input.target?.trim();
  if (trimmedTarget) {
    try {
      resolveTargetRepository(trimmedTarget);
    } catch {
      return { status: 'ERROR', error: `UNSUPPORTED_TARGET_REPOSITORY: ${trimmedTarget}` };
    }
  }

  const request: PlannerRequest = {
    kind: 'plan',
    command,
    ...(trimmedTarget ? { target: trimmedTarget } : {}),
    operatingConstitution: dependencies.operatingConstitution,
    supportedTargets: listSupportedTargets().map((target) => target.alias),
    taskContractGuide: TASK_CONTRACT_GUIDE,
  };

  let rawTask: TaskContract;
  try {
    const captured = await dependencies.planner.plan(request);
    rawTask = captured.payload;
  } catch (error) {
    return { status: 'ERROR', error: `PLANNER_COMMAND_FAILED: ${error instanceof Error ? error.message : 'unknown error'}` };
  }

  let task: TaskContract;
  try {
    task = normalizeTaskContract(rawTask);
  } catch (error) {
    return { status: 'ERROR', error: error instanceof Error ? error.message : 'PLANNER_OUTPUT_INVALID' };
  }

  // The front door exposes no explicit-authorization input, so a planner
  // can never turn production mutation on -- only a human, out of band.
  task = { ...task, productionMutationAllowed: false };

  if (trimmedTarget) {
    const hint = resolveTargetRepository(trimmedTarget);
    if (task.targetRepository !== hint.repository) {
      return {
        status: 'ERROR',
        error: `PLANNER_TARGET_MISMATCH: requested ${hint.repository}, planner returned ${task.targetRepository}`,
      };
    }
  }

  const contractErrors = validateTaskContract(task);
  if (contractErrors.length > 0) {
    return { status: 'ERROR', error: `TASK_CONTRACT_INVALID: ${contractErrors.join('; ')}` };
  }

  return { status: 'PLANNED', task };
}
