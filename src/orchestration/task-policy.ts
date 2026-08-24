import type { TaskContract } from '../commander/types.js';

export type TaskPolicyBlockCode = 'DUPLICATE_TASK' | 'HARMFUL_TASK';
export type TaskPolicyDisposition = 'ALLOW' | TaskPolicyBlockCode;

export interface TaskPolicyGuard {
  evaluate(task: TaskContract): Promise<TaskPolicyDisposition>;
  release?(task: TaskContract): Promise<void> | void;
}

function taskKey(task: TaskContract): string {
  return `${task.targetRepository.trim().toLowerCase()}::${task.id.trim().toLowerCase()}`;
}

export function isExplicitlyHarmfulTask(task: TaskContract): boolean {
  return task.constraints.some((constraint) => constraint.trim().toUpperCase() === 'HARMFUL_TASK');
}

export function hasCriticalHarmFinding(findings: ReadonlyArray<{ severity: string }>): boolean {
  return findings.some((finding) => finding.severity.trim().toLowerCase() === 'critical');
}

export class InMemoryTaskPolicyGuard implements TaskPolicyGuard {
  private readonly reserved = new Set<string>();

  public async evaluate(task: TaskContract): Promise<TaskPolicyDisposition> {
    if (isExplicitlyHarmfulTask(task)) return 'HARMFUL_TASK';
    const key = taskKey(task);
    if (this.reserved.has(key)) return 'DUPLICATE_TASK';
    this.reserved.add(key);
    return 'ALLOW';
  }

  public release(task: TaskContract): void {
    this.reserved.delete(taskKey(task));
  }
}
