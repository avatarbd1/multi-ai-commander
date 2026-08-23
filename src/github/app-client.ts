import { GitHubRestClient } from './client.js';
import type { GitHubAppConfig } from '../auth/types.js';
import { GitHubAppCredentialBroker } from '../auth/credential-broker.js';

declare const process: { env: Record<string, string | undefined> };

export async function createGitHubAppClient(config: GitHubAppConfig): Promise<GitHubRestClient> {
  const broker = new GitHubAppCredentialBroker(config.appId, config.privateKey);
  await broker.validateConfiguration();
  return new GitHubRestClient(undefined, broker, config.installationId);
}

export async function createGitHubAppClientFromEnv(): Promise<GitHubRestClient> {
  const appId = process.env.COMMANDER_GH_APP_ID;
  const installationId = process.env.COMMANDER_GH_INSTALLATION_ID;
  const privateKey = process.env.COMMANDER_GH_PRIVATE_KEY;
  if (!appId || !installationId || !privateKey) throw new Error('GitHub App credentials missing from environment');
  if (!/^\d+$/.test(appId)) throw new Error('COMMANDER_GH_APP_ID must be numeric');
  if (!/^\d+$/.test(installationId) || Number(installationId) <= 0) {
    throw new Error('COMMANDER_GH_INSTALLATION_ID must be a positive integer');
  }
  return createGitHubAppClient({ appId, installationId: Number(installationId), privateKey });
}
