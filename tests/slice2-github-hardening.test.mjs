import { test } from 'node:test';
import { strict as assert } from 'node:assert';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Branch protection policy verifier rejects policies with insufficient requirements', async () => {
  const { BranchProtectionVerifier, RECOMMENDED_REQUIREMENTS } = await import(
    '../dist/auth/branch-protection-policy.js'
  );

  const policyMissingStrictChecks = {
    branch: 'main',
    repository: 'test/repo',
    requiredStatusChecks: { strict: false, contexts: ['ci'] },
    requiredPullRequestReviews: { dismissStaleReviews: true, requireCodeOwnerReviews: false, requiredApprovingReviewCount: 1 },
    enforceAdmins: true,
    allowForcePushes: false,
    allowDeletions: false,
  };

  const result = BranchProtectionVerifier.verify(policyMissingStrictChecks, RECOMMENDED_REQUIREMENTS);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('strict')));
});

test('Branch protection policy verifier accepts fully compliant policies', async () => {
  const { BranchProtectionVerifier, RECOMMENDED_REQUIREMENTS } = await import(
    '../dist/auth/branch-protection-policy.js'
  );

  const compliantPolicy = {
    branch: 'main',
    repository: 'test/repo',
    requiredStatusChecks: { strict: true, contexts: ['ci/lint', 'ci/test'] },
    requiredPullRequestReviews: { dismissStaleReviews: true, requireCodeOwnerReviews: false, requiredApprovingReviewCount: 1 },
    enforceAdmins: true,
    allowForcePushes: false,
    allowDeletions: false,
  };

  const result = BranchProtectionVerifier.verify(compliantPolicy, RECOMMENDED_REQUIREMENTS);
  assert.equal(result.satisfied, true);
  assert.equal(result.violations.length, 0);
});

test('Branch protection fail-closed rejects null policy', async () => {
  const { BranchProtectionVerifier } = await import('../dist/auth/branch-protection-policy.js');

  const result = BranchProtectionVerifier.failClosed(null);
  assert.equal(result.allowed, false);
  assert(result.reason);
});

test('Live installation verifier requires repository access', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const { GitHubRestClient } = await import('../dist/github/client.js');

  let capturedUrl = '';
  const broker = { async getInstallationToken() { return 'test-token'; } };
  const failingApiFetch = async (url) => {
    capturedUrl = String(url);
    return new Response('Unauthorized', { status: 401 });
  };
  const client = new GitHubRestClient({ broker, installationId: 1 }, failingApiFetch);

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1);
  assert.equal(result.satisfied, false);
  assert(result.violations.length > 0);
});

test('Credential rotation tracker tracks rotation state changes', async () => {
  const { CredentialRotationTracker } = await import('../dist/auth/secret-rotation.js');

  const tracker = new CredentialRotationTracker();
  tracker.track('app_id', {
    credentialType: 'app_id',
    createdAt: '2026-01-01T00:00:00Z',
    state: 'active',
  });

  assert.equal(tracker.getCredentialState('app_id'), 'active');

  const rotationRequested = tracker.requestRotation({
    credentialType: 'app_id',
    reason: 'Quarterly rotation',
    requestedAt: new Date().toISOString(),
    requesterEmail: 'admin@example.com',
    approvalRequired: true,
  });
  assert.equal(rotationRequested, true);
  assert.equal(tracker.getCredentialState('app_id'), 'rotation_pending');
});

test('Credential rotation tracker detects credentials needing rotation', async () => {
  const { CredentialRotationTracker } = await import('../dist/auth/secret-rotation.js');

  const tracker = new CredentialRotationTracker();
  const oldCreatedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  tracker.track('old_key', {
    credentialType: 'old_key',
    createdAt: oldCreatedAt,
    state: 'active',
  });

  assert.equal(tracker.needsRotation('old_key', 90), true);
});

test('Credential rotation creates procedure plan with approval gates', async () => {
  const { createRotationPlan } = await import('../dist/auth/secret-rotation.js');

  const plan = createRotationPlan('private_key', 'Security enhancement', { requireApproval: true });
  assert.equal(plan.credentialType, 'private_key');
  assert.equal(plan.steps.length, 6);
  assert(plan.steps.some((s) => s.requiresApproval));
  assert(plan.rollbackPlan);
});

test('Audit event logger redacts secrets from event details', async () => {
  const { AuditEventLogger } = await import('../dist/audit/event-logger.js');

  const logger = new AuditEventLogger();
  await logger.logTokenRefresh(42, false, undefined, 'github_pat_FAKE_SECRET_KEY');

  const log = await logger.getAuditLog();
  assert(log);
  assert(!log.includes('github_pat_FAKE_SECRET_KEY'));
  assert(log.includes('[REDACTED]'));
});

test('Audit event logger maintains hash chain integrity', async () => {
  const { AuditEventLogger } = await import('../dist/audit/event-logger.js');

  const logger = new AuditEventLogger();
  await logger.logTokenRefresh(1, true, 100);
  await logger.logInstallationVerification('test/repo', 1, true);
  await logger.logConfigurationValidation('local', true);

  const verified = await logger.verifyAuditLog();
  assert.equal(verified, true);
});

test('Audit event logger sets context on all events', async () => {
  const { AuditEventLogger } = await import('../dist/audit/event-logger.js');

  const logger = new AuditEventLogger();
  logger.setContext({ sessionId: 'sess-123', repository: 'test/repo' });
  await logger.logTokenRefresh(1, true, 50);

  const log = await logger.getAuditLog();
  assert(log.includes('sess-123'));
  assert(log.includes('test/repo'));
});

test('Monitoring event types discriminate between success and failure variants', async () => {
  const { MonitoringEvent } = await import('../dist/monitoring/event-types.js');

  const successEvent = {
    type: 'token_refresh_succeeded',
    occurredAt: new Date().toISOString(),
    source: 'github-app',
    details: { installationId: 1, duration: 150 },
  };
  const failureEvent = {
    type: 'token_refresh_failed',
    occurredAt: new Date().toISOString(),
    source: 'github-app',
    details: { installationId: 1, error: '[REDACTED]' },
  };

  assert.notEqual(successEvent.type, failureEvent.type);
  assert(!successEvent.details.error);
  assert(failureEvent.details.error);
});

test('Live installation verification with branch protection integration', async () => {
  const { verifyInstallationWithBranchProtection } = await import('../dist/auth/setup.js');
  const config = { appId: '123456', installationId: 1, privateKey: 'FAKE_KEY' };

  const mockFetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.includes('/repos/')) return jsonResponse({ full_name: 'test/repo' });
    return jsonResponse({});
  };

  try {
    await verifyInstallationWithBranchProtection(config, 'test/repo', 'main', { fetchImpl: mockFetch });
  } catch (error) {
    assert(error instanceof Error);
    assert(error.message.includes('COMMANDER_GH_PRIVATE_KEY'));
  }
});

test('Fail-closed semantics: missing branch protection blocks deployment', async () => {
  const { BranchProtectionVerifier } = await import('../dist/auth/branch-protection-policy.js');

  const result = BranchProtectionVerifier.failClosed(null);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /not found/);
});

test('Fail-closed semantics: insufficient permissions block deployment', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');

  const verification = {
    satisfied: false,
    violations: ['Repository access verification failed: connection timeout'],
  };
  const result = LiveInstallationVerifier.failClosed(verification);
  assert.equal(result.allowed, false);
});

// --- Installation permission verification (real GitHub App permission scopes) ---

function makeStubClient({
  installationId = 1,
  repoFullName = 'test/repo',
  permissions = { contents: 'write', pull_requests: 'write', checks: 'read' },
  permissionsError = null,
  branchProtection = null,
  branchProtectionError = null,
} = {}) {
  return {
    installationId,
    async getRepository() {
      return { fullName: repoFullName };
    },
    async getInstallationPermissions() {
      if (permissionsError) throw permissionsError;
      return permissions;
    },
    async getBranchProtectionPolicy() {
      if (branchProtectionError) throw branchProtectionError;
      return branchProtection;
    },
  };
}

const NO_BRANCH_PROTECTION_REQUIREMENTS = {
  minContentsPermission: 'write',
  minPullRequestsPermission: 'write',
  minChecksPermission: 'read',
  requireBranchProtection: false,
  requiredBranch: 'main',
};

test('Live installation verifier fails when contents permission is insufficient', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ permissions: { contents: 'read', pull_requests: 'write', checks: 'read' } });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1, NO_BRANCH_PROTECTION_REQUIREMENTS);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes("'contents'")));
});

test('Live installation verifier fails when pull_requests permission is insufficient', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ permissions: { contents: 'write', pull_requests: 'read', checks: 'read' } });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1, NO_BRANCH_PROTECTION_REQUIREMENTS);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes("'pull_requests'")));
});

test('Live installation verifier fails when checks permission is insufficient', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ permissions: { contents: 'write', pull_requests: 'write', checks: undefined } });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1, NO_BRANCH_PROTECTION_REQUIREMENTS);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes("'checks'")));
});

test('Live installation verifier passes when all required permissions are met', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ permissions: { contents: 'admin', pull_requests: 'write', checks: 'read' } });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1, NO_BRANCH_PROTECTION_REQUIREMENTS);
  assert.equal(result.satisfied, true);
  assert.equal(result.violations.length, 0);
});

test('Live installation verifier fails closed when the permissions API errors', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ permissionsError: new Error('GitHub request failed (500)') });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1, NO_BRANCH_PROTECTION_REQUIREMENTS);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('Installation permission verification failed')));
});

test('Live installation verifier fails closed on a supplied-installation-ID mismatch', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ installationId: 1 });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 999, NO_BRANCH_PROTECTION_REQUIREMENTS);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('Installation ID mismatch')));
});

// --- Branch protection: raw GitHub response mapping (blocker: no `as any`) ---

function rawProtection(overrides = {}) {
  return {
    required_status_checks: { strict: true, contexts: ['ci/lint', 'ci/test'] },
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 1,
    },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    ...overrides,
  };
}

test('Branch protection mapper: fully compliant GitHub response maps to a passing policy', async () => {
  const { mapGitHubBranchProtectionResponse, BranchProtectionVerifier } = await import(
    '../dist/auth/branch-protection-policy.js'
  );
  const policy = mapGitHubBranchProtectionResponse('test/repo', 'main', rawProtection());
  const result = BranchProtectionVerifier.verify(policy);
  assert.equal(result.satisfied, true);
  assert.equal(result.violations.length, 0);
});

test('Branch protection mapper: strict=false fails verification', async () => {
  const { mapGitHubBranchProtectionResponse, BranchProtectionVerifier } = await import(
    '../dist/auth/branch-protection-policy.js'
  );
  const policy = mapGitHubBranchProtectionResponse(
    'test/repo',
    'main',
    rawProtection({ required_status_checks: { strict: false, contexts: ['ci'] } }),
  );
  const result = BranchProtectionVerifier.verify(policy);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('strict-status-checks')));
});

test('Branch protection mapper: no required status check contexts fails verification', async () => {
  const { mapGitHubBranchProtectionResponse, BranchProtectionVerifier } = await import(
    '../dist/auth/branch-protection-policy.js'
  );
  const policy = mapGitHubBranchProtectionResponse(
    'test/repo',
    'main',
    rawProtection({ required_status_checks: { strict: true, contexts: [] } }),
  );
  const result = BranchProtectionVerifier.verify(policy);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('status-checks-defined')));
});

test('Branch protection mapper: zero required approving reviews fails verification', async () => {
  const { mapGitHubBranchProtectionResponse, BranchProtectionVerifier } = await import(
    '../dist/auth/branch-protection-policy.js'
  );
  const policy = mapGitHubBranchProtectionResponse(
    'test/repo',
    'main',
    rawProtection({
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        require_code_owner_reviews: false,
        required_approving_review_count: 0,
      },
    }),
  );
  const result = BranchProtectionVerifier.verify(policy);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('require-reviews')));
});

test('Branch protection mapper: stale-review dismissal disabled fails verification', async () => {
  const { mapGitHubBranchProtectionResponse, BranchProtectionVerifier } = await import(
    '../dist/auth/branch-protection-policy.js'
  );
  const policy = mapGitHubBranchProtectionResponse(
    'test/repo',
    'main',
    rawProtection({
      required_pull_request_reviews: {
        dismiss_stale_reviews: false,
        require_code_owner_reviews: false,
        required_approving_review_count: 1,
      },
    }),
  );
  const result = BranchProtectionVerifier.verify(policy);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('dismiss-stale-reviews')));
});

test('Branch protection mapper: admin enforcement disabled fails verification', async () => {
  const { mapGitHubBranchProtectionResponse, BranchProtectionVerifier } = await import(
    '../dist/auth/branch-protection-policy.js'
  );
  const policy = mapGitHubBranchProtectionResponse(
    'test/repo',
    'main',
    rawProtection({ enforce_admins: { enabled: false } }),
  );
  const result = BranchProtectionVerifier.verify(policy);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('enforce-admins')));
});

test('Branch protection mapper: force pushes allowed fails verification', async () => {
  const { mapGitHubBranchProtectionResponse, BranchProtectionVerifier } = await import(
    '../dist/auth/branch-protection-policy.js'
  );
  const policy = mapGitHubBranchProtectionResponse(
    'test/repo',
    'main',
    rawProtection({ allow_force_pushes: { enabled: true } }),
  );
  const result = BranchProtectionVerifier.verify(policy);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('disable-force-push')));
});

test('Branch protection mapper: deletions allowed fails verification', async () => {
  const { mapGitHubBranchProtectionResponse, BranchProtectionVerifier } = await import(
    '../dist/auth/branch-protection-policy.js'
  );
  const policy = mapGitHubBranchProtectionResponse(
    'test/repo',
    'main',
    rawProtection({ allow_deletions: { enabled: true } }),
  );
  const result = BranchProtectionVerifier.verify(policy);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('disable-deletions')));
});

test('Branch protection mapper: malformed GitHub response fails closed by throwing', async () => {
  const { mapGitHubBranchProtectionResponse } = await import('../dist/auth/branch-protection-policy.js');

  assert.throws(() => mapGitHubBranchProtectionResponse('test/repo', 'main', null));
  assert.throws(() => mapGitHubBranchProtectionResponse('test/repo', 'main', { enforce_admins: 'not-an-object' }));
  assert.throws(() =>
    mapGitHubBranchProtectionResponse('test/repo', 'main', rawProtection({ allow_force_pushes: { enabled: 'yes' } })),
  );
});

test('Live installation verifier fails closed when branch protection is missing (404)', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ branchProtection: null });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1, {
    ...NO_BRANCH_PROTECTION_REQUIREMENTS,
    requireBranchProtection: true,
  });
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('not enforced')));
});

test('Live installation verifier passes when branch protection response is fully compliant', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ branchProtection: rawProtection() });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1, {
    ...NO_BRANCH_PROTECTION_REQUIREMENTS,
    requireBranchProtection: true,
  });
  assert.equal(result.satisfied, true);
  assert.equal(result.violations.length, 0);
});

// --- Repository identity must be an exact match, not a substring match ---

test('repositoryIdentitiesMatch: case-insensitive exact match succeeds', async () => {
  const { repositoryIdentitiesMatch } = await import('../dist/auth/live-installation.js');
  assert.equal(repositoryIdentitiesMatch('test/repo', 'TEST/REPO'), true);
});

test('repositoryIdentitiesMatch: rejects a prefixed lookalike repository', async () => {
  const { repositoryIdentitiesMatch } = await import('../dist/auth/live-installation.js');
  assert.equal(repositoryIdentitiesMatch('test/repo', 'evil-test/repo'), false);
});

test('repositoryIdentitiesMatch: rejects a suffixed lookalike repository', async () => {
  const { repositoryIdentitiesMatch } = await import('../dist/auth/live-installation.js');
  assert.equal(repositoryIdentitiesMatch('test/repo', 'test/repository'), false);
});

test('Live installation verifier fails closed on a substring-lookalike repository', async () => {
  const { LiveInstallationVerifier } = await import('../dist/auth/live-installation.js');
  const client = makeStubClient({ repoFullName: 'evil-test/repo' });

  const result = await LiveInstallationVerifier.verify(client, 'test/repo', 1, NO_BRANCH_PROTECTION_REQUIREMENTS);
  assert.equal(result.satisfied, false);
  assert(result.violations.some((v) => v.includes('does not match requested repository')));
});
