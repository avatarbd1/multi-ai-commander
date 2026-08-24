import type { AcceptanceCriterion, RiskLevel, TaskContract } from './types.js';
import { resolveTargetRepository, type TargetLock } from '../orchestration/target-resolver.js';

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function validateTaskContract(contract: TaskContract): string[] {
  const errors: string[] = [];

  if (!contract.id.trim()) errors.push('task.id is required');
  if (!contract.title.trim()) errors.push('task.title is required');
  if (!contract.objective.trim()) errors.push('task.objective is required');
  if (!REPOSITORY_PATTERN.test(contract.targetRepository)) {
    errors.push('task.targetRepository must use owner/repository format');
  }
  if (!contract.baseBranch.trim()) errors.push('task.baseBranch is required');
  if (contract.acceptanceCriteria.length === 0) {
    errors.push('at least one acceptance criterion is required');
  }

  const ids = new Set<string>();
  for (const criterion of contract.acceptanceCriteria) {
    if (!criterion.id.trim()) errors.push('acceptance criterion id is required');
    if (!criterion.requirement.trim()) errors.push(`acceptance criterion ${criterion.id} requires text`);
    if (ids.has(criterion.id)) errors.push(`duplicate acceptance criterion id: ${criterion.id}`);
    ids.add(criterion.id);
  }

  return errors;
}

function normalizeAcceptanceCriterion(entry: unknown): AcceptanceCriterion {
  const record = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
  return {
    id: typeof record.id === 'string' ? record.id : '',
    requirement: typeof record.requirement === 'string' ? record.requirement : '',
    evidenceRequired: Array.isArray(record.evidenceRequired)
      ? record.evidenceRequired.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/**
 * Turns a raw parsed JSON object (a human-authored task file, or a
 * planner's raw JSON output) into a TaskContract. `targetRepository` may
 * be a supported alias (Commander/Owner/ClinicOS) or an exact `owner/repo`
 * string -- resolved here through the same target-resolver every live
 * orchestration run uses, so this is normalization, not a second source of
 * truth about which targets are supported. Unknown/unsupported targets
 * fail closed with UNSUPPORTED_TARGET_REPOSITORY before anything else
 * runs. Missing optional fields get safe, explicit defaults; missing
 * required fields are left blank and caught uniformly by
 * validateTaskContract right after this returns.
 */
export function normalizeTaskContract(raw: unknown): TaskContract {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('TASK_CONTRACT_MUST_BE_A_JSON_OBJECT');
  }
  const record = raw as Record<string, unknown>;

  if (typeof record.targetRepository !== 'string' || record.targetRepository.trim() === '') {
    throw new Error('task.targetRepository is required');
  }
  let target: TargetLock;
  try {
    target = resolveTargetRepository(record.targetRepository);
  } catch {
    throw new Error(`UNSUPPORTED_TARGET_REPOSITORY: ${record.targetRepository}`);
  }

  const riskLevel: RiskLevel = RISK_LEVELS.includes(record.riskLevel as RiskLevel)
    ? (record.riskLevel as RiskLevel)
    : 'low';

  return {
    id: typeof record.id === 'string' ? record.id : '',
    title: typeof record.title === 'string' ? record.title : '',
    targetRepository: target.repository,
    baseBranch:
      typeof record.baseBranch === 'string' && record.baseBranch.trim() !== '' ? record.baseBranch : target.baseBranch,
    objective: typeof record.objective === 'string' ? record.objective : '',
    acceptanceCriteria: Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria.map((entry) => normalizeAcceptanceCriterion(entry))
      : [],
    constraints: Array.isArray(record.constraints)
      ? record.constraints.filter((entry): entry is string => typeof entry === 'string')
      : [],
    riskLevel,
    productionMutationAllowed: record.productionMutationAllowed === true,
  };
}
