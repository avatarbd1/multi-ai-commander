export type CredentialState = 'active' | 'rotation_pending' | 'rotated' | 'revoked' | 'expired';

export interface CredentialMetadata {
  credentialType: 'app_id' | 'installation_id' | 'private_key';
  createdAt: string;
  lastRotatedAt?: string;
  expiresAt?: string;
  state: CredentialState;
  rotationNotes?: string;
}

export interface RotationRequest {
  credentialType: string;
  reason: string;
  requestedAt: string;
  requesterEmail: string;
  approvalRequired: boolean;
}

export interface RotationPlan {
  credentialType: string;
  currentState: CredentialState;
  proposedRotationDate: string;
  steps: RotationStep[];
  estimatedDowntime: number;
  rollbackPlan: string;
}

export interface RotationStep {
  order: number;
  description: string;
  action: 'generate' | 'validate' | 'deploy' | 'verify' | 'revoke' | 'document';
  requiresApproval: boolean;
}

export class CredentialRotationTracker {
  private readonly credentials: Map<string, CredentialMetadata> = new Map();
  private readonly rotationHistory: RotationRequest[] = [];

  public track(identifier: string, metadata: CredentialMetadata): void {
    this.credentials.set(identifier, metadata);
  }

  public requestRotation(request: RotationRequest): boolean {
    const credential = this.credentials.get(request.credentialType);
    if (!credential) return false;

    this.rotationHistory.push(request);
    credential.state = 'rotation_pending';
    return true;
  }

  public completeRotation(credentialType: string, newMetadata: CredentialMetadata): void {
    const credential = this.credentials.get(credentialType);
    if (credential) {
      credential.state = 'rotated';
      credential.lastRotatedAt = new Date().toISOString();
    }
    this.credentials.set(credentialType, newMetadata);
  }

  public getCredentialState(credentialType: string): CredentialState | undefined {
    return this.credentials.get(credentialType)?.state;
  }

  public getRotationHistory(): readonly RotationRequest[] {
    return this.rotationHistory;
  }

  public getMetadata(credentialType: string): CredentialMetadata | undefined {
    return this.credentials.get(credentialType);
  }

  public needsRotation(credentialType: string, dayThreshold = 90): boolean {
    const metadata = this.credentials.get(credentialType);
    if (!metadata || !metadata.createdAt) return false;

    const createdTime = new Date(metadata.createdAt).getTime();
    const nowTime = Date.now();
    const daysSinceCreation = (nowTime - createdTime) / (1000 * 60 * 60 * 24);

    return daysSinceCreation >= dayThreshold;
  }

  public isExpired(credentialType: string): boolean {
    const metadata = this.credentials.get(credentialType);
    if (!metadata || !metadata.expiresAt) return false;

    return new Date(metadata.expiresAt).getTime() < Date.now();
  }
}

export function createRotationPlan(
  credentialType: string,
  reason: string,
  options: { requireApproval?: boolean; estimatedDowntime?: number } = {},
): RotationPlan {
  return {
    credentialType,
    currentState: 'active',
    proposedRotationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    steps: [
      {
        order: 1,
        description: 'Generate new credential via GitHub App settings',
        action: 'generate',
        requiresApproval: options.requireApproval ?? true,
      },
      {
        order: 2,
        description: 'Store in secure credential management system',
        action: 'validate',
        requiresApproval: false,
      },
      {
        order: 3,
        description: 'Deploy to all production environments',
        action: 'deploy',
        requiresApproval: true,
      },
      {
        order: 4,
        description: 'Verify connectivity with new credential',
        action: 'verify',
        requiresApproval: false,
      },
      {
        order: 5,
        description: 'Revoke old credential from GitHub App',
        action: 'revoke',
        requiresApproval: true,
      },
      {
        order: 6,
        description: 'Document rotation in audit log',
        action: 'document',
        requiresApproval: false,
      },
    ],
    estimatedDowntime: options.estimatedDowntime ?? 5,
    rollbackPlan: `If verification fails, switch back to previous credential immediately and investigate. Do not proceed with revocation until verification succeeds.`,
  };
}
