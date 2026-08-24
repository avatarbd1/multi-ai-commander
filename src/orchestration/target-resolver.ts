export type TargetAlias = 'Commander' | 'Owner' | 'ClinicOS';

export interface TargetLock {
  readonly alias: TargetAlias;
  readonly repository: string;
  readonly baseBranch: 'main';
  readonly locked: true;
}

const TARGETS: readonly TargetLock[] = [
  {
    alias: 'Commander',
    repository: 'avatarbd1/multi-ai-commander',
    baseBranch: 'main',
    locked: true,
  },
  {
    alias: 'Owner',
    repository: 'avatarbd1/relife-owner-app',
    baseBranch: 'main',
    locked: true,
  },
  {
    alias: 'ClinicOS',
    repository: 'avatarbd1/relife-clinic-os',
    baseBranch: 'main',
    locked: true,
  },
];

export function resolveTargetRepository(input: string): TargetLock {
  const normalized = input.trim().toLowerCase();
  const target = TARGETS.find((candidate) => {
    return candidate.alias.toLowerCase() === normalized || candidate.repository.toLowerCase() === normalized;
  });

  if (!target) {
    throw new Error('UNSUPPORTED_TARGET_REPOSITORY');
  }

  return { ...target };
}

export function listSupportedTargets(): readonly TargetLock[] {
  return TARGETS.map((target) => ({ ...target }));
}
