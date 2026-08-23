import type { TaskContract } from './types.js';

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
