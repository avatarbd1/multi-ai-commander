import type { GitHubBranchProtectionResponse } from '../github/client.js';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Maps GitHub's raw branch-protection REST response (nested, snake_case)
 * into the internal camelCase `BranchProtectionPolicy` domain type.
 *
 * `required_status_checks` and `required_pull_request_reviews` may
 * legitimately be absent/null when GitHub has no such requirement
 * configured — that maps to the least-protected values and is left for
 * `BranchProtectionVerifier` to flag as a violation. `enforce_admins`,
 * `allow_force_pushes` and `allow_deletions` are always present on a real
 * branch-protection response; a response missing them, or with the wrong
 * shape, is treated as malformed and this function throws so the caller
 * fails closed instead of silently treating it as compliant.
 */
export function mapGitHubBranchProtectionResponse(
  repository: string,
  branch: string,
  raw: GitHubBranchProtectionResponse | Record<string, unknown>,
): BranchProtectionPolicy {
  if (!isRecord(raw)) {
    throw new Error('Malformed GitHub branch protection response: expected an object');
  }

  const requiredStatusChecks = raw.required_status_checks;
  if (requiredStatusChecks !== null && requiredStatusChecks !== undefined && !isRecord(requiredStatusChecks)) {
    throw new Error('Malformed GitHub branch protection response: required_status_checks');
  }

  const requiredPullRequestReviews = raw.required_pull_request_reviews;
  if (
    requiredPullRequestReviews !== null &&
    requiredPullRequestReviews !== undefined &&
    !isRecord(requiredPullRequestReviews)
  ) {
    throw new Error('Malformed GitHub branch protection response: required_pull_request_reviews');
  }

  const enforceAdmins = raw.enforce_admins;
  if (!isRecord(enforceAdmins) || typeof enforceAdmins.enabled !== 'boolean') {
    throw new Error('Malformed GitHub branch protection response: enforce_admins');
  }

  const allowForcePushes = raw.allow_force_pushes;
  if (!isRecord(allowForcePushes) || typeof allowForcePushes.enabled !== 'boolean') {
    throw new Error('Malformed GitHub branch protection response: allow_force_pushes');
  }

  const allowDeletions = raw.allow_deletions;
  if (!isRecord(allowDeletions) || typeof allowDeletions.enabled !== 'boolean') {
    throw new Error('Malformed GitHub branch protection response: allow_deletions');
  }

  const contexts =
    isRecord(requiredStatusChecks) && Array.isArray(requiredStatusChecks.contexts)
      ? requiredStatusChecks.contexts.filter((context): context is string => typeof context === 'string')
      : [];

  return {
    repository,
    branch,
    requiredStatusChecks: {
      strict: isRecord(requiredStatusChecks) ? requiredStatusChecks.strict === true : false,
      contexts,
    },
    requiredPullRequestReviews: {
      dismissStaleReviews: isRecord(requiredPullRequestReviews)
        ? requiredPullRequestReviews.dismiss_stale_reviews === true
        : false,
      requireCodeOwnerReviews: isRecord(requiredPullRequestReviews)
        ? requiredPullRequestReviews.require_code_owner_reviews === true
        : false,
      requiredApprovingReviewCount:
        isRecord(requiredPullRequestReviews) &&
        typeof requiredPullRequestReviews.required_approving_review_count === 'number'
          ? requiredPullRequestReviews.required_approving_review_count
          : 0,
    },
    enforceAdmins: enforceAdmins.enabled === true,
    allowForcePushes: allowForcePushes.enabled === true,
    allowDeletions: allowDeletions.enabled === true,
  };
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
