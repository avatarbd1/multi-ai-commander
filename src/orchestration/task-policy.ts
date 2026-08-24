import type { TaskContract } from '../commander/types.js';

export type TaskPolicyBlockCode = 'DUPLICATE_TASK' | 'HARMFUL_TASK';

export function isExplicitlyHarmfulTask(task: TaskContract): boolean {
  return task.constraints.some((constraint) => constraint.trim().toUpperCase() === 'HARMFUL_TASK');
}

export function hasCriticalHarmFinding(findings: ReadonlyArray<{ severity: string }>): boolean {
  return findings.some((finding) => finding.severity.trim().toLowerCase() === 'critical');
}
