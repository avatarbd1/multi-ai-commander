export interface GitHubAppConfig {
  appId: string;
  installationId: number;
  privateKey: string;
}

export interface GitHubInstallationToken {
  token: string;
  expiresAt: number;
}

/**
 * Effective GitHub App installation permissions, keyed by the real GitHub
 * permission scope names (e.g. "contents", "pull_requests", "checks") as
 * returned by the GitHub REST API's installation access-token response.
 * A scope absent from this map means the installation was not granted it.
 */
export interface GitHubInstallationPermissions {
  [scope: string]: 'read' | 'write' | 'admin';
}

export interface CredentialBroker {
  getInstallationToken(installationId: number): Promise<string>;
  getInstallationPermissions(installationId: number): Promise<GitHubInstallationPermissions>;
  validateConfiguration(): Promise<void>;
  clearTokenCache(): void;
}

export type GitHubAuthValidationState = 'LOCAL_CONFIG_VALID' | 'LIVE_INSTALLATION_VERIFIED';

export interface AuthenticationResult {
  success: boolean;
  authenticated: boolean;
  installationId?: number;
  expiresAt?: number;
  error?: string;
}
