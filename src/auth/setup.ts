import { GitHubAppCredentialBroker } from './credential-broker.js';
import { GitHubRestClient } from '../github/client.js';
import type { GitHubAuthValidationState } from './types.js';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

export interface EnvironmentConfig {
  appId: string;
  installationId: number;
  privateKey: string;
}

export function loadConfigFromEnv(env: Record<string, string | undefined> = process.env): EnvironmentConfig {
  const appId = env.COMMANDER_GH_APP_ID;
  const installationId = env.COMMANDER_GH_INSTALLATION_ID;
  const privateKey = env.COMMANDER_GH_PRIVATE_KEY;
  const missing: string[] = [];
  if (!appId) missing.push('COMMANDER_GH_APP_ID');
  if (!installationId) missing.push('COMMANDER_GH_INSTALLATION_ID');
  if (!privateKey) missing.push('COMMANDER_GH_PRIVATE_KEY');
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (!/^\d+$/.test(appId as string)) throw new Error('COMMANDER_GH_APP_ID must be numeric');
  if (!/^\d+$/.test(installationId as string) || Number(installationId) <= 0) {
    throw new Error('COMMANDER_GH_INSTALLATION_ID must be a positive integer');
  }
  return { appId: appId as string, installationId: Number(installationId), privateKey: privateKey as string };
}

export async function validateLocalConfiguration(config: EnvironmentConfig): Promise<GitHubAuthValidationState> {
  const broker = new GitHubAppCredentialBroker(config.appId, config.privateKey);
  await broker.validateConfiguration();
  return 'LOCAL_CONFIG_VALID';
}

export async function verifyLiveInstallation(
  config: EnvironmentConfig,
  repository: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<GitHubAuthValidationState> {
  if (!repository || !repository.includes('/')) throw new Error('COMMANDER_GH_VERIFY_REPOSITORY must be owner/repo');
  const brokerOptions = options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};
  const broker = new GitHubAppCredentialBroker(config.appId, config.privateKey, brokerOptions);
  await broker.validateConfiguration();
  const client = new GitHubRestClient({ broker, installationId: config.installationId }, options.fetchImpl ?? fetch);
  const resolved = await client.getRepository(repository);
  if (resolved.fullName.toLowerCase() !== repository.toLowerCase()) throw new Error('GitHub repository access verification failed');
  return 'LIVE_INSTALLATION_VERIFIED';
}

async function main(): Promise<void> {
  try {
    const config = loadConfigFromEnv();
    console.log(await validateLocalConfiguration(config));
    const repository = process.env.COMMANDER_GH_VERIFY_REPOSITORY;
    if (repository) console.log(await verifyLiveInstallation(config, repository));
    else console.log('LIVE_INSTALLATION_NOT_VERIFIED');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'GitHub App validation failed');
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
