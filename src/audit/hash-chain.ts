export interface AuditRecord<T = unknown> {
  sequence: number;
  eventType: string;
  occurredAt: string;
  previousHash: string | null;
  payload: T;
  hash: string;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashRecord(input: Omit<AuditRecord, 'hash'>): Promise<string> {
  return sha256(stableStringify(input));
}

export class AuditChain {
  private readonly records: AuditRecord[] = [];

  public async append<T>(eventType: string, payload: T, occurredAt = new Date().toISOString()): Promise<AuditRecord<T>> {
    const sequence = this.records.length + 1;
    const previousHash = this.records.at(-1)?.hash ?? null;
    const unsigned = { sequence, eventType, occurredAt, previousHash, payload };
    const record: AuditRecord<T> = { ...unsigned, hash: await hashRecord(unsigned) };
    this.records.push(record);
    return record;
  }

  public all(): readonly AuditRecord[] {
    return this.records;
  }

  public toJsonl(): string {
    return this.records.map((record) => JSON.stringify(record)).join('\n') + (this.records.length ? '\n' : '');
  }

  public async verify(): Promise<boolean> {
    for (let index = 0; index < this.records.length; index += 1) {
      const record = this.records[index];
      if (!record) return false;
      const expectedPrevious = index === 0 ? null : this.records[index - 1]?.hash ?? null;
      if (record.previousHash !== expectedPrevious) return false;
      const { hash, ...unsigned } = record;
      if ((await hashRecord(unsigned)) !== hash) return false;
    }
    return true;
  }
}
