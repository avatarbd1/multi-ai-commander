import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createVerify, generateKeyPairSync } from 'node:crypto';

const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

test('GitHub App JWT uses RS256 and safe clock claims', async () => {
  const { GitHubAppCredentialBroker } = await import('../dist/auth/credential-broker.js');
  const nowMs = Date.parse('2026-08-24T00:00:00Z');
  let capturedJwt = '';
  const broker = new GitHubAppCredentialBroker('123456', TEST_PRIVATE_KEY, {
    now: () => nowMs,
    fetchImpl: async (_url, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      capturedJwt = authorization?.replace(/^Bearer /, '') ?? '';
      return jsonResponse({ token: 'installation-token', expires_at: '2026-08-24T01:00:00Z' }, 201);
    },
  });

  await broker.getInstallationToken(42);
  const parts = capturedJwt.split('.');
  assert.equal(parts.length, 3);
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  const nowSeconds = Math.floor(nowMs / 1000);
  assert.equal(header.alg, 'RS256');
  assert.equal(header.typ, 'JWT');
  assert.equal(payload.iss, '123456');
  assert.equal(payload.iat, nowSeconds - 60);
  assert(payload.exp <= nowSeconds + 10 * 60);
  assert(payload.exp > nowSeconds);

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  assert.equal(verifier.verify(TEST_PUBLIC_KEY, Buffer.from(parts[2], 'base64url')), true);
});

test('GitHub App broker accepts PKCS1 RSA private keys emitted by GitHub-style tooling', async () => {
  const { GitHubAppCredentialBroker } = await import('../dist/auth/credential-broker.js');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const broker = new GitHubAppCredentialBroker('123456', privateKey);
  await broker.validateConfiguration();
});

test('installation token expiry is parsed from expires_at and cache refreshes before expiry', async () => {
  const { GitHubAppCredentialBroker } = await import('../dist/auth/credential-broker.js');
  let nowMs = Date.parse('2026-08-24T00:00:00Z');
  let calls = 0;
  const broker = new GitHubAppCredentialBroker('123456', TEST_PRIVATE_KEY, {
    now: () => nowMs,
    refreshSkewMs: 60_000,
    fetchImpl: async () => {
      calls += 1;
      const expiresAt = new Date(nowMs + 5 * 60_000).toISOString();
      return jsonResponse({ token: `token-${calls}`, expires_at: expiresAt }, 201);
    },
  });

  assert.equal(await broker.getInstallationToken(7), 'token-1');
  assert.equal(await broker.getInstallationToken(7), 'token-1');
  assert.equal(calls, 1);

  nowMs += 4 * 60_000 + 1;
  assert.equal(await broker.getInstallationToken(7), 'token-2');
  assert.equal(calls, 2);
});

test('concurrent refreshes use single-flight token exchange', async () => {
  const { GitHubAppCredentialBroker } = await import('../dist/auth/credential-broker.js');
  const nowMs = Date.parse('2026-08-24T00:00:00Z');
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const broker = new GitHubAppCredentialBroker('123456', TEST_PRIVATE_KEY, {
    now: () => nowMs,
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return jsonResponse({ token: 'one-token', expires_at: '2026-08-24T01:00:00Z' }, 201);
    },
  });

  const first = broker.getInstallationToken(9);
  const second = broker.getInstallationToken(9);
  setTimeout(() => release(), 10);
  const [firstToken, secondToken] = await Promise.all([first, second]);
  assert.equal(firstToken, 'one-token');
  assert.equal(secondToken, 'one-token');
  assert.equal(calls, 1);
});

test('token exchange API errors do not echo response bodies or credential-shaped values', async () => {
  const { GitHubAppCredentialBroker } = await import('../dist/auth/credential-broker.js');
  const secret = 'github_pat_SHOULD_NOT_APPEAR';
  const broker = new GitHubAppCredentialBroker('123456', TEST_PRIVATE_KEY, {
    fetchImpl: async () => new Response(`server reflected ${secret}`, { status: 401 }),
  });

  await assert.rejects(
    () => broker.getInstallationToken(1),
    (error) => error instanceof Error && error.message.includes('(401)') && !error.message.includes(secret),
  );
});

test('local configuration errors identify variables without echoing invalid values', async () => {
  const { loadConfigFromEnv, validateLocalConfiguration } = await import('../dist/auth/setup.js');
  const badAppId = 'github_pat_APPID_SECRET';
  assert.throws(
    () => loadConfigFromEnv({
      COMMANDER_GH_APP_ID: badAppId,
      COMMANDER_GH_INSTALLATION_ID: '99',
      COMMANDER_GH_PRIVATE_KEY: TEST_PRIVATE_KEY,
    }),
    (error) => error instanceof Error && error.message.includes('COMMANDER_GH_APP_ID') && !error.message.includes(badAppId),
  );

  const badInstallation = 'token_INSTALLATION_SECRET';
  assert.throws(
    () => loadConfigFromEnv({
      COMMANDER_GH_APP_ID: '123456',
      COMMANDER_GH_INSTALLATION_ID: badInstallation,
      COMMANDER_GH_PRIVATE_KEY: TEST_PRIVATE_KEY,
    }),
    (error) => error instanceof Error && error.message.includes('COMMANDER_GH_INSTALLATION_ID') && !error.message.includes(badInstallation),
  );

  const invalidPrivateKey = 'PRIVATE_KEY_SECRET_VALUE';
  await assert.rejects(
    () => validateLocalConfiguration({ appId: '123456', installationId: 99, privateKey: invalidPrivateKey }),
    (error) => error instanceof Error && error.message.includes('COMMANDER_GH_PRIVATE_KEY') && !error.message.includes(invalidPrivateKey),
  );
});

test('setup validation distinguishes local config from live installation verification', async () => {
  const { validateLocalConfiguration, verifyLiveInstallation } = await import('../dist/auth/setup.js');
  const config = { appId: '123456', installationId: 12, privateKey: TEST_PRIVATE_KEY };
  assert.equal(await validateLocalConfiguration(config), 'LOCAL_CONFIG_VALID');

  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).includes('/access_tokens')) {
      return jsonResponse({ token: 'live-token', expires_at: new Date(Date.now() + 60 * 60_000).toISOString() }, 201);
    }
    return jsonResponse({ full_name: 'avatarbd1/multi-ai-commander' });
  };
  assert.equal(
    await verifyLiveInstallation(config, 'avatarbd1/multi-ai-commander', { fetchImpl }),
    'LIVE_INSTALLATION_VERIFIED',
  );
  assert.equal(calls, 2);
});

test('broker-backed GitHub client refreshes token after authoritative expiry window', async () => {
  const { GitHubAppCredentialBroker } = await import('../dist/auth/credential-broker.js');
  const { GitHubRestClient } = await import('../dist/github/client.js');
  let nowMs = Date.parse('2026-08-24T00:00:00Z');
  let tokenCalls = 0;
  const broker = new GitHubAppCredentialBroker('123456', TEST_PRIVATE_KEY, {
    now: () => nowMs,
    refreshSkewMs: 60_000,
    fetchImpl: async () => {
      tokenCalls += 1;
      return jsonResponse({
        token: `token-${tokenCalls}`,
        expires_at: new Date(nowMs + 3 * 60_000).toISOString(),
      }, 201);
    },
  });

  const seen = [];
  const apiFetch = async (_url, init) => {
    seen.push(new Headers(init?.headers).get('Authorization'));
    return jsonResponse({ full_name: 'avatarbd1/multi-ai-commander' });
  };
  const client = new GitHubRestClient({ broker, installationId: 55 }, apiFetch);

  await client.getRepository('avatarbd1/multi-ai-commander');
  nowMs += 2 * 60_000 + 1;
  await client.getRepository('avatarbd1/multi-ai-commander');
  assert.deepEqual(seen, ['Bearer token-1', 'Bearer token-2']);
  assert.equal(tokenCalls, 2);
});

test('required GitHub read/write operations all use broker-backed authentication', async () => {
  const { GitHubRestClient } = await import('../dist/github/client.js');
  const broker = {
    async getInstallationToken() { return 'broker-token'; },
    async validateConfiguration() {},
    clearTokenCache() {},
  };
  const seen = [];
  const apiFetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    seen.push({ path: parsed.pathname, method: init.method ?? 'GET', auth: new Headers(init.headers).get('Authorization') });
    const path = parsed.pathname;
    if (path.endsWith('/check-runs')) return jsonResponse({ check_runs: [] });
    if (path.endsWith('/git/refs')) return jsonResponse({ ref: 'refs/heads/test', object: { sha: 'abc' } }, 201);
    if (path.includes('/contents/')) return jsonResponse({ content: { sha: 'blob' }, commit: { sha: 'commit' } }, 201);
    if (path.endsWith('/pulls') && init.method === 'POST') return jsonResponse({ number: 3 }, 201);
    if (path.endsWith('/pulls/3') && init.method === 'PATCH') return jsonResponse({});
    if (path.endsWith('/pulls/3')) {
      return jsonResponse({
        number: 3,
        title: 'draft',
        state: 'open',
        draft: true,
        html_url: 'https://example.test/pr/3',
        head: { sha: 'head', ref: 'feature' },
        base: { ref: 'main' },
      });
    }
    if (path.endsWith('/pulls/3/files')) return jsonResponse([]);
    if (path.endsWith('/issues/3/comments')) return jsonResponse({ id: 8, html_url: 'https://example.test/comment/8' }, 201);
    if (path.endsWith('/repos/avatarbd1/multi-ai-commander')) return jsonResponse({ full_name: 'avatarbd1/multi-ai-commander' });
    throw new Error(`Unhandled test request: ${path}`);
  };
  const client = new GitHubRestClient({ broker, installationId: 77 }, apiFetch);

  await client.getRepository('avatarbd1/multi-ai-commander');
  await client.getCiEvidence('avatarbd1/multi-ai-commander', 'head');
  await client.createBranch('avatarbd1/multi-ai-commander', 'feature', 'base');
  await client.createOrUpdateFile({
    repository: 'avatarbd1/multi-ai-commander',
    path: 'docs/test.md',
    content: 'test',
    message: 'test',
    branch: 'feature',
  });
  await client.createPullRequest('avatarbd1/multi-ai-commander', {
    title: 'draft',
    head: 'feature',
    base: 'main',
    draft: true,
  });
  await client.updatePullRequest('avatarbd1/multi-ai-commander', 3, { title: 'updated' });
  await client.createPullRequestComment('avatarbd1/multi-ai-commander', 3, 'review');

  assert(seen.length >= 10);
  assert(seen.every((request) => request.auth === 'Bearer broker-token'));
});
