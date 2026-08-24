import { AuditChain } from './hash-chain.js';
import type { MonitoringEvent } from '../monitoring/event-types.js';

export interface AuditEventContext {
  sessionId?: string;
  userId?: string;
  repository?: string;
  installationId?: number;
}

export type SecretRedactionPattern = RegExp | ((value: unknown) => boolean);

export class AuditEventLogger {
  private readonly auditChain: AuditChain;
  private readonly redactionPatterns: SecretRedactionPattern[] = [
    /github_pat_[A-Za-z0-9_]+/gi,
    /github_.*_secret/gi,
    /private_key/gi,
  ];
  private context: AuditEventContext = {};

  constructor(auditChain?: AuditChain) {
    this.auditChain = auditChain ?? new AuditChain();
  }

  public setContext(context: AuditEventContext): void {
    this.context = context;
  }

  public addRedactionPattern(pattern: SecretRedactionPattern): void {
    this.redactionPatterns.push(pattern);
  }

  private redactValue(value: unknown): unknown {
    if (typeof value === 'string') {
      let redacted = value;
      for (const pattern of this.redactionPatterns) {
        if (pattern instanceof RegExp) {
          redacted = redacted.replace(pattern, '[REDACTED]');
        } else if (typeof pattern === 'function' && pattern(value)) {
          return '[REDACTED]';
        }
      }
      return redacted;
    }

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map((v) => this.redactValue(v));
      }
      const record = value as Record<string, unknown>;
      const redacted: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(record)) {
        redacted[key] = this.redactValue(val);
      }
      return redacted;
    }

    return value;
  }

  public async logEvent(event: MonitoringEvent): Promise<void> {
    const redactedEvent = {
      ...event,
      details: this.redactValue(event.details),
      context: this.context,
    };
    await this.auditChain.append(event.type, redactedEvent, event.occurredAt);
  }

  public async logTokenRefresh(
    installationId: number,
    succeeded: boolean,
    duration?: number,
    error?: string,
  ): Promise<void> {
    await this.logEvent({
      type: succeeded ? 'token_refresh_succeeded' : 'token_refresh_failed',
      occurredAt: new Date().toISOString(),
      source: 'github-app',
      details: {
        installationId,
        duration,
        error: error ? '[REDACTED]' : undefined,
      },
    });
  }

  public async logInstallationVerification(
    repository: string,
    installationId: number,
    succeeded: boolean,
    error?: string,
  ): Promise<void> {
    await this.logEvent({
      type: succeeded ? 'installation_verified' : 'installation_verification_failed',
      occurredAt: new Date().toISOString(),
      source: 'setup',
      details: {
        repository,
        installationId,
        error: error ? '[REDACTED]' : undefined,
      },
    });
  }

  public async logBranchProtectionVerification(
    repository: string,
    branch: string,
    satisfied: boolean,
    violations?: string[],
  ): Promise<void> {
    await this.logEvent({
      type: satisfied ? 'branch_protection_verified' : 'branch_protection_verification_failed',
      occurredAt: new Date().toISOString(),
      source: 'setup',
      details: {
        repository,
        branch,
        violations: violations?.length ? violations : undefined,
      },
    });
  }

  public async logConfigurationValidation(
    configType: 'local' | 'live' | 'full',
    succeeded: boolean,
    error?: string,
  ): Promise<void> {
    await this.logEvent({
      type: succeeded ? 'configuration_validated' : 'configuration_validation_failed',
      occurredAt: new Date().toISOString(),
      source: 'setup',
      details: {
        configType,
        error: error ? '[REDACTED]' : undefined,
      },
    });
  }

  public async logFailClosed(reason: string): Promise<void> {
    await this.logEvent({
      type: 'fail_closed_triggered',
      occurredAt: new Date().toISOString(),
      source: 'github-app',
      details: {
        reason,
        blocking: true,
      },
    });
  }

  public getAuditChain(): AuditChain {
    return this.auditChain;
  }

  public async getAuditLog(): Promise<string> {
    return this.auditChain.toJsonl();
  }

  public async verifyAuditLog(): Promise<boolean> {
    return this.auditChain.verify();
  }
}
