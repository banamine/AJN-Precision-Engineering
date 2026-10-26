import fs from 'node:fs';
import path from 'node:path';

export interface PhysicalEvent {
  requestId: string | null;
  attempt: number | null;
  maxAttempts: number | null;
  stage: string | null;
  startedAt: string;
  gapMs: number | null;
  waitMs: number;
  host: string;
  path: string;
  status: number;
  retryAfter: string | null;
  errorCode?: string | null;
}

const HEADER = [
  'started_at_utc', 'logical_operation', 'proxy_request_id', 'physical_request_id',
  'attempt', 'max_attempts', 'stage', 'host', 'path', 'status', 'delay_used_ms',
  'limiter_wait_ms', 'retry_after', 'error_code',
].join(',');

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function decodePhysicalEvents(value: string | null): PhysicalEvent[] {
  if (!value) return [];
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as PhysicalEvent[];
  if (!Array.isArray(parsed)) throw new Error('invalid physical request event header');
  return parsed;
}

export function appendPhysicalEvents(
  ledgerPath: string,
  logicalOperation: string,
  proxyRequestId: string | null,
  events: PhysicalEvent[],
): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const hasFile = fs.existsSync(ledgerPath);
  const rows = events.map((event) => [
    event.startedAt, logicalOperation, proxyRequestId, event.requestId,
    event.attempt, event.maxAttempts, event.stage, event.host, event.path,
    event.status, event.gapMs, event.waitMs, event.retryAfter, event.errorCode,
  ].map(csvCell).join(','));
  if (!hasFile) fs.writeFileSync(ledgerPath, `${HEADER}\n${rows.join('\n')}${rows.length ? '\n' : ''}`);
  else if (rows.length) fs.appendFileSync(ledgerPath, `${rows.join('\n')}\n`);
}
