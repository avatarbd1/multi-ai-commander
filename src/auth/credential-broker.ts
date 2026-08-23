import type { CredentialBroker } from './types.js';

export interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

export interface GitHubAppCredentialBrokerOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  refreshSkewMs?: number;
}

interface InstallationTokenResponse {
  token?: string;
  expires_at?: string;
}

const DEFAULT_REFRESH_SKEW_MS = 60_000;
const RSA_ALGORITHM_IDENTIFIER = new Uint8Array([
  0x30, 0x0d,
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  0x05, 0x00,
]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64UrlBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function pemBodyToDer(pem: string): { der: Uint8Array; kind: 'pkcs8' | 'pkcs1' } {
  const pkcs8 = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  const pkcs1 = pem.match(/-----BEGIN RSA PRIVATE KEY-----([\s\S]+?)-----END RSA PRIVATE KEY-----/);
  const match = pkcs8 ?? pkcs1;
  if (!match?.[1]) throw new Error('COMMANDER_GH_PRIVATE_KEY must be valid PEM format');
  const clean = match[1].replace(/\s+/g, '');
  try {
    const binary = atob(clean);
    return {
      der: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      kind: pkcs8 ? 'pkcs8' : 'pkcs1',
    };
  } catch {
    throw new Error('COMMANDER_GH_PRIVATE_KEY must be valid PEM format');
  }
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function derWrap(tag: number, content: Uint8Array): Uint8Array {
  const length = derLength(content.length);
  const output = new Uint8Array(1 + length.length + content.length);
  output[0] = tag;
  output.set(length, 1);
  output.set(content, 1 + length.length);
  return output;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const privateKey = derWrap(0x04, pkcs1);
  return derWrap(0x30, concatBytes(version, RSA_ALGORITHM_IDENTIFIER, privateKey));
}

/**
 * Security-focused GitHub App credential broker.
 * Installation tokens stay in memory and refresh from GitHub's authoritative
 * `expires_at` value. Concurrent refreshes for one installation are single-flight.
 */
export class GitHubAppCredentialBroker implements CredentialBroker {
  private readonly baseUrl = 'https://api.github.com';
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private readonly tokenCache = new Map<number, TokenCacheEntry>();
  private readonly refreshes = new Map<number, Promise<TokenCacheEntry>>();

  public constructor(
    private readonly appId: string,
    private readonly privateKey: string,
    options: GitHubAppCredentialBrokerOptions = {},
  ) {
    if (!appId || appId.trim() === '') throw new Error('COMMANDER_GH_APP_ID is required');
    if (!privateKey || privateKey.trim() === '') throw new Error('COMMANDER_GH_PRIVATE_KEY is required');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  }

  public async getInstallationToken(installationId: number): Promise<string> {
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new Error('COMMANDER_GH_INSTALLATION_ID must be a positive integer');
    }

    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > this.now() + this.refreshSkewMs) return cached.token;

    const inFlight = this.refreshes.get(installationId);
    if (inFlight) return (await inFlight).token;

    const refresh = this.requestFreshToken(installationId);
    this.refreshes.set(installationId, refresh);
    try {
      return (await refresh).token;
    } finally {
      this.refreshes.delete(installationId);
    }
  }

  private async requestFreshToken(installationId: number): Promise<TokenCacheEntry> {
    const appJwt = await this.signJwt();
    const fresh = await this.exchangeJwtForToken(appJwt, installationId);
    this.tokenCache.set(installationId, fresh);
    return fresh;
  }

  private async importSigningKey(): Promise<CryptoKey> {
    const parsed = pemBodyToDer(this.privateKey);
    const pkcs8 = parsed.kind === 'pkcs8' ? parsed.der : pkcs1ToPkcs8(parsed.der);
    try {
      return await globalThis.crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );
    } catch {
      throw new Error('COMMANDER_GH_PRIVATE_KEY is not a valid RSA private key');
    }
  }

  private async signJwt(): Promise<string> {
    const nowSeconds = Math.floor(this.now() / 1000);
    const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
    const payload = base64UrlJson({
      iss: this.appId,
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
    });
    const unsigned = `${header}.${payload}`;
    const key = await this.importSigningKey();
    try {
      const signature = await globalThis.crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        new TextEncoder().encode(unsigned),
      );
      return `${unsigned}.${base64UrlBytes(new Uint8Array(signature))}`;
    } catch {
      throw new Error('Failed to sign GitHub App JWT');
    }
  }

  private async exchangeJwtForToken(appJwt: string, installationId: number): Promise<TokenCacheEntry> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/app/installations/${installationId}/access_tokens`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch {
      throw new Error('GitHub installation token request failed');
    }

    if (!response.ok) throw new Error(`GitHub installation token request failed (${response.status})`);

    let data: InstallationTokenResponse;
    try {
      data = (await response.json()) as InstallationTokenResponse;
    } catch {
      throw new Error('GitHub installation token response was invalid');
    }

    if (!data.token || !data.expires_at) throw new Error('GitHub installation token response was incomplete');
    const expiresAt = Date.parse(data.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      throw new Error('GitHub installation token expiry was invalid');
    }
    return { token: data.token, expiresAt };
  }

  public async validateConfiguration(): Promise<void> {
    if (!/^\d+$/.test(this.appId)) throw new Error('COMMANDER_GH_APP_ID must be numeric');
    await this.importSigningKey();
    await this.signJwt();
  }

  public clearTokenCache(): void {
    this.tokenCache.clear();
  }

  public getCacheStats(): { cachedInstallations: number; validTokens: number } {
    const now = this.now();
    let validTokens = 0;
    for (const entry of this.tokenCache.values()) {
      if (entry.expiresAt > now + this.refreshSkewMs) validTokens += 1;
    }
    return { cachedInstallations: this.tokenCache.size, validTokens };
  }
}
