export type OrchestrationState =
  | 'TASK'
  | 'TARGET_LOCK'
  | 'TARGET_ACCESS_VERIFY'
  | 'BUILD'
  | 'VERIFY'
  | 'PUBLISH'
  | 'CI'
  | 'REVIEW'
  | 'VERDICT'
  | 'HUMAN_GATE'
  | 'BLOCKED';

const FORWARD_TRANSITIONS: Readonly<Record<OrchestrationState, readonly OrchestrationState[]>> = {
  TASK: ['TARGET_LOCK', 'BLOCKED'],
  TARGET_LOCK: ['TARGET_ACCESS_VERIFY', 'BLOCKED'],
  TARGET_ACCESS_VERIFY: ['BUILD', 'BLOCKED'],
  BUILD: ['VERIFY', 'BLOCKED'],
  VERIFY: ['PUBLISH', 'BLOCKED'],
  PUBLISH: ['CI', 'BLOCKED'],
  CI: ['REVIEW', 'BLOCKED'],
  REVIEW: ['VERDICT', 'BLOCKED'],
  VERDICT: ['HUMAN_GATE', 'BLOCKED'],
  HUMAN_GATE: [],
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
  return state === 'HUMAN_GATE' || state === 'BLOCKED';
}
