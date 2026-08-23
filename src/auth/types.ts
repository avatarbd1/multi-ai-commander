export interface GitHubAppConfig {
  appId: string;
  installationId: number;
  privateKey: string;
}

export interface GitHubInstallationToken {
  token: string;
  expiresAt: number;
}

export interface CredentialBroker {
  getInstallationToken(installationId: number): Promise<string>;
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
