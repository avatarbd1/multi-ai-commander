export interface MonitoringEvent {
  type: MonitoringEventType;
  occurredAt: string;
  source: 'github-app' | 'ci' | 'reviewer' | 'setup';
  details: Record<string, unknown>;
}

export type MonitoringEventType =
  | 'token_refresh_requested'
  | 'token_refresh_succeeded'
  | 'token_refresh_failed'
  | 'installation_verified'
  | 'installation_verification_failed'
  | 'branch_protection_verified'
  | 'branch_protection_verification_failed'
  | 'ci_evidence_collected'
  | 'ci_evidence_collection_failed'
  | 'review_evidence_collected'
  | 'configuration_validated'
  | 'configuration_validation_failed'
  | 'credential_rotation_initiated'
  | 'credential_rotation_completed'
  | 'credential_rotation_failed'
  | 'secret_detected_in_error'
  | 'fail_closed_triggered';

export interface TokenRefreshEvent extends MonitoringEvent {
  type: 'token_refresh_requested' | 'token_refresh_succeeded' | 'token_refresh_failed';
  details: {
    installationId: number;
    reason?: string;
    duration?: number;
    error?: string;
  };
}

export interface InstallationVerificationEvent extends MonitoringEvent {
  type: 'installation_verified' | 'installation_verification_failed';
  details: {
    repository: string;
    installationId: number;
    permissions?: Record<string, string>;
    error?: string;
  };
}

export interface BranchProtectionEvent extends MonitoringEvent {
  type: 'branch_protection_verified' | 'branch_protection_verification_failed';
  details: {
    repository: string;
    branch: string;
    violations?: string[];
    error?: string;
  };
}

export interface CiEvidenceEvent extends MonitoringEvent {
  type: 'ci_evidence_collected' | 'ci_evidence_collection_failed';
  details: {
    repository: string;
    commit: string;
    checkRun?: string;
    status?: string;
    error?: string;
  };
}

export interface ReviewEvidenceEvent extends MonitoringEvent {
  type: 'review_evidence_collected';
  details: {
    repository: string;
    pullRequest: number;
    reviewCount?: number;
    verdict?: string;
  };
}

export interface ConfigurationEvent extends MonitoringEvent {
  type: 'configuration_validated' | 'configuration_validation_failed';
  details: {
    configType: 'local' | 'live' | 'full';
    error?: string;
  };
}

export interface CredentialRotationEvent extends MonitoringEvent {
  type: 'credential_rotation_initiated' | 'credential_rotation_completed' | 'credential_rotation_failed';
  details: {
    credentialType: string;
    status?: string;
    error?: string;
  };
}

export interface SecretDetectionEvent extends MonitoringEvent {
  type: 'secret_detected_in_error';
  details: {
    location: string;
    pattern: string;
    redacted: boolean;
  };
}

export interface FailClosedEvent extends MonitoringEvent {
  type: 'fail_closed_triggered';
  details: {
    reason: string;
    blocking: boolean;
  };
}

export type SpecificEvent =
  | TokenRefreshEvent
  | InstallationVerificationEvent
  | BranchProtectionEvent
  | CiEvidenceEvent
  | ReviewEvidenceEvent
  | ConfigurationEvent
  | CredentialRotationEvent
  | SecretDetectionEvent
  | FailClosedEvent;
