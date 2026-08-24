export interface BranchProtectionPolicy {
  branch: string;
  repository: string;
  requiredStatusChecks: {
    strict: boolean;
    contexts: string[];
  };
  requiredPullRequestReviews: {
    dismissStaleReviews: boolean;
    requireCodeOwnerReviews: boolean;
    requiredApprovingReviewCount: number;
  };
  enforceAdmins: boolean;
  allowForcePushes: boolean;
  allowDeletions: boolean;
}

export interface BranchProtectionRequirement {
  name: string;
  description: string;
  isRequired: boolean;
  verify(policy: BranchProtectionPolicy): boolean | string;
}

export const RECOMMENDED_REQUIREMENTS: BranchProtectionRequirement[] = [
  {
    name: 'strict-status-checks',
    description: 'CI checks must pass on base branch before merge',
    isRequired: true,
    verify: (policy) => policy.requiredStatusChecks.strict === true,
  },
  {
    name: 'status-checks-defined',
    description: 'At least one required status check must be configured',
    isRequired: true,
    verify: (policy) => policy.requiredStatusChecks.contexts.length > 0,
  },
  {
    name: 'require-reviews',
    description: 'Pull requests must have at least one approval',
    isRequired: true,
    verify: (policy) => policy.requiredPullRequestReviews.requiredApprovingReviewCount > 0,
  },
  {
    name: 'dismiss-stale-reviews',
    description: 'Stale reviews must be dismissed on new commits',
    isRequired: true,
    verify: (policy) => policy.requiredPullRequestReviews.dismissStaleReviews === true,
  },
  {
    name: 'enforce-admins',
    description: 'Branch protection rules apply to repository administrators',
    isRequired: true,
    verify: (policy) => policy.enforceAdmins === true,
  },
  {
    name: 'disable-force-push',
    description: 'Force pushes are not allowed',
    isRequired: true,
    verify: (policy) => policy.allowForcePushes === false,
  },
  {
    name: 'disable-deletions',
    description: 'Branch deletion is not allowed',
    isRequired: true,
    verify: (policy) => policy.allowDeletions === false,
  },
];

export class BranchProtectionVerifier {
  public static verify(
    policy: BranchProtectionPolicy,
    requirements: BranchProtectionRequirement[] = RECOMMENDED_REQUIREMENTS,
  ): { satisfied: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const requirement of requirements) {
      if (!requirement.isRequired) continue;

      const result = requirement.verify(policy);
      if (result !== true) {
        violations.push(`${requirement.name}: ${typeof result === 'string' ? result : requirement.description}`);
      }
    }

    return {
      satisfied: violations.length === 0,
      violations,
    };
  }

  public static failClosed(
    policy: BranchProtectionPolicy | null,
    requirements: BranchProtectionRequirement[] = RECOMMENDED_REQUIREMENTS,
  ): { allowed: boolean; reason?: string } {
    if (!policy) return { allowed: false, reason: 'Branch protection policy not found' };

    const verification = this.verify(policy, requirements);
    if (!verification.satisfied) {
      return { allowed: false, reason: `Branch protection violations: ${verification.violations.join('; ')}` };
    }

    return { allowed: true };
  }
}
