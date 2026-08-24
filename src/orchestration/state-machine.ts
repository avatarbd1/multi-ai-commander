export type OrchestrationState =
  | 'TASK'
  | 'TARGET_LOCK'
  | 'TARGET_ACCESS_VERIFY'
  | 'BUILD'
  | 'VERIFY'
  | 'PUBLISH'
  | 'CI'
  | 'REVIEW'
  | 'COMPLETE'
  | 'ERROR'
  | 'BLOCKED';

const FORWARD_TRANSITIONS: Readonly<Record<OrchestrationState, readonly OrchestrationState[]>> = {
  TASK: ['TARGET_LOCK', 'BLOCKED', 'ERROR'],
  TARGET_LOCK: ['TARGET_ACCESS_VERIFY', 'ERROR'],
  TARGET_ACCESS_VERIFY: ['BUILD', 'ERROR'],
  BUILD: ['VERIFY', 'ERROR'],
  VERIFY: ['PUBLISH', 'ERROR'],
  PUBLISH: ['CI', 'ERROR'],
  CI: ['REVIEW', 'ERROR'],
  REVIEW: ['COMPLETE', 'BLOCKED', 'ERROR'],
  COMPLETE: [],
  ERROR: [],
  BLOCKED: [],
};

export function canTransitionOrchestrationState(
  from: OrchestrationState,
  to: OrchestrationState,
): boolean {
  return FORWARD_TRANSITIONS[from].includes(to);
}

export function transitionOrchestrationState(
  from: OrchestrationState,
  to: OrchestrationState,
): OrchestrationState {
  if (!canTransitionOrchestrationState(from, to)) {
    throw new Error(`INVALID_ORCHESTRATION_TRANSITION:${from}->${to}`);
  }
  return to;
}

export function isTerminalOrchestrationState(state: OrchestrationState): boolean {
  return state === 'COMPLETE' || state === 'ERROR' || state === 'BLOCKED';
}
